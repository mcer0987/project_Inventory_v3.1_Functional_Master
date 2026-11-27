/**
 * services/staff-lifecycle-service.js — v3.8 · VP-3 · Personel Hesap Yaşam Döngüsü Servisi.
 * ES modülü; main.js (index.html) ve admin-main.js (admin.html) içe aktarır → window.AppModules.StaffLifecycleService.
 * Arayüz (src/ui/staff-lifecycle-panel.js ve auth-engine.js) Firebase SDK'ya doğrudan dokunmaz, yalnız bu servisi kullanır.
 *
 * [WHY]: 24 saat limitli şifre sıfırlama talepleri, süreli tek kullanımlık geçici PIN, bilinen kodla Auth yenileme,
 *        personelin ilk girişte kendi kodunu değiştirmesi ve geçmişi bozmadan hesap askıya alma / açma işlemleri
 *        atomik transaction + auditLogs + Zero-Trust kurallarıyla yürütülmelidir.
 * [HOW]: - Tüm yollar window.AppEnv.COLLECTION_ROOT üzerinden kurulur (sabit kök adı yasaktır).
 *        - Oturumsuz sıfırlama talebi tek tip nötr mesaj döner (hesap varlığı / 24 saat durumu sızdırılmaz).
 *        - Düz metin parola/PIN hiçbir noktada Firestore'a, auditLogs'a, URL'ye veya konsola yazılmaz.
 */
import {
    doc, collection, getDocFromServer, getDocsFromServer, setDoc, updateDoc,
    runTransaction, serverTimestamp, Timestamp
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

export class StaffLifecycleError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'StaffLifecycleError';
        this.code = code;
    }
}

const LOCK_COLLECTIONS = ['personel', 'staffAccounts'];
const DEMO_RESET_STORAGE_KEY = 'medipol_demo_reset_requests_v1';
const REAUTH_TEXT = {
    suspend: ['Personel Hesabını Askıya Al', 'Seçilen personelin sistem erişimi kapatılacak; geçmiş zimmet, talep ve EBYS kayıtları korunacaktır. Devam etmek için yönetici parolanızı doğrulayın.'],
    reactivate: ['Personel Hesabını Yeniden Aktifleştir', 'Askıdaki personelin sistem erişimi yeniden açılacaktır. Devam etmek için yönetici parolanızı doğrulayın.'],
    tempPin: ['Geçici PIN / Kod Yenileme Onayı', 'Seçilen personel için süreli tek kullanımlık geçici kod tanımlanacaktır. Devam etmek için yönetici parolanızı doğrulayın.'],
};

const _newAuditId = prefix => `${prefix}_${Date.now().toString(36)}_${(globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function')
        ? globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 12)
        : Math.random().toString(36).slice(2, 12)
    }`;

const _toMillis = ts => {
    if (!ts) return null;
    if (typeof ts.toMillis === 'function') return ts.toMillis();
    if (typeof ts === 'number' && Number.isFinite(ts)) return ts;
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? null : d.getTime();
};

// [WHY]: Servis hem tarayıcı köprülerine hem test ortamındaki bağımlılıklara enjekte edilebilir olmalı.
// [HOW]: Her bağımlılık çağrı anında çözülür (modül import anında window.fireDb henüz başlatılmamış olabilir).
export function createStaffLifecycleService(deps = {}) {
    const fns = deps.fns || {
        doc, collection, getDocFromServer, getDocsFromServer, setDoc, updateDoc,
        runTransaction, serverTimestamp, Timestamp,
    };
    const db = () => (deps.db ? deps.db() : window.fireDb);
    const root = () => {
        const r = deps.root ? deps.root() : (window.AppEnv && window.AppEnv.COLLECTION_ROOT);
        if (!r) throw new StaffLifecycleError('env-missing', 'Veritabanı ortam kökü hazır değil; sayfayı yenileyin.');
        return r;
    };
    const isEmulator = () => (deps.isEmulator ? !!deps.isEmulator() : !!(window.AppEnv && window.AppEnv.EMULATOR));
    const SL = () => {
        const mod = deps.lifecycle ? deps.lifecycle() : (window.AppModules && window.AppModules.StaffLifecycle);
        if (!mod) throw new StaffLifecycleError('not-loaded', 'Hesap yaşam döngüsü çekirdeği (staff-lifecycle.js) yüklenmemiş.');
        return mod;
    };
    const SP = () => {
        const mod = deps.provisioning ? deps.provisioning() : window.StaffProvisioning;
        if (!mod) throw new StaffLifecycleError('not-loaded', 'Hesap sağlama modülü (staff-provisioning.js) yüklenmemiş.');
        return mod;
    };
    const session = () => (deps.session ? deps.session() : (window.AppModules && window.AppModules.Session));
    const actorUid = () => (deps.actorUid ? deps.actorUid() : (window.userAuth && window.userAuth.uid));
    const actor = deps.actor || (() => (typeof window.getActiveUser === 'function' && window.getActiveUser()) || null);
    const auditRecord = deps.auditRecord || ((entry, opts) => window.buildAuditRecord(entry, opts));
    const appendAudit = deps.appendAudit || (entry => (typeof window.appendAuditLog === 'function' ? window.appendAuditLog(entry) : null));
    const reauth = deps.reauth || (async ({ title, message }) => (
        window.SecurityConfig && typeof window.SecurityConfig.promptAdminReauth === 'function'
            ? window.SecurityConfig.promptAdminReauth({ title, message })
            : 'unavailable'
    ));
    const isLocked = deps.isLocked || (() => typeof window.isBulkWriteLocked === 'function' && window.isBulkWriteLocked(LOCK_COLLECTIONS));
    const getProvisioner = deps.getProvisioner || (() => (typeof window.getStaffProvisioner === 'function' ? window.getStaffProvisioner() : null));
    const updateOwnPassword = deps.updateOwnPassword || (pw => window.updateOwnStaffPassword(pw));
    const makeAuditId = deps.makeAuditId || _newAuditId;
    const storage = () => (deps.storage ? deps.storage() : (typeof localStorage !== 'undefined' ? localStorage : null));
    const nowMs = () => (deps.nowMs ? Number(deps.nowMs()) : Date.now());
    const ref = (col, id) => fns.doc(db(), root(), col, 'items', String(id));

    // [WHY]: v3.8 HF-2 · Lokal testte (127.0.0.1 / localhost → inventory_demo) VP-3 firestore.rules henüz buluta
    //        deploy edilmediği için passwordResetRequests yazma/okuma permission-denied döner.
    // [HOW]: Yalnızca COLLECTION_ROOT === 'inventory_demo' VE hostname localhost/127.0.0.1 iken güvenli yerel demo yedeği
    //        devreye girer. Canlı lifeserver_master kökünde KESİNLİKLE kapalıdır.
    function isLocalDemoFallbackAllowed() {
        if (deps.allowLocalDemoFallback !== undefined) return !!deps.allowLocalDemoFallback;
        try {
            if (root() !== 'inventory_demo') return false;
            if (typeof window === 'undefined' || !window.location) return false;
            const host = window.location.hostname;
            return host === 'localhost' || host === '127.0.0.1';
        } catch (_) {
            return false;
        }
    }

    function _readDemoResetRequests() {
        const store = storage();
        if (!store || typeof store.getItem !== 'function') return [];
        try {
            const raw = store.getItem(DEMO_RESET_STORAGE_KEY);
            if (!raw) return [];
            const list = JSON.parse(raw);
            return Array.isArray(list) ? list.filter(x => x && x.pri) : [];
        } catch (_) {
            return [];
        }
    }

    function _writeDemoResetRequests(list) {
        const store = storage();
        if (!store || typeof store.setItem !== 'function') return;
        try {
            store.setItem(DEMO_RESET_STORAGE_KEY, JSON.stringify(Array.isArray(list) ? list : []));
        } catch (_) { /* kota/gizli mod */ }
    }

    function _upsertDemoResetRequest(entry) {
        const L = SL();
        const now = nowMs();
        const list = _readDemoResetRequests();
        const idx = list.findIndex(x => String(x.pri) === String(entry.pri));
        if (idx !== -1) {
            const prev = list[idx];
            if (prev.requestedAtMs && L.canResubmitResetRequest && !L.canResubmitResetRequest(prev.requestedAtMs, now).allowed) {
                return false;
            }
            list[idx] = { ...prev, ...entry };
        } else {
            list.unshift(entry);
        }
        _writeDemoResetRequests(list);
        return true;
    }

    function _resolveDemoResetRequest(priId, { status, resolutionNote = '', resolvedBy = '' } = {}) {
        const list = _readDemoResetRequests();
        const idx = list.findIndex(x => String(x.pri) === String(priId));
        if (idx === -1) return null;
        const now = nowMs();
        const updated = {
            ...list[idx],
            status,
            resolvedAtMs: now,
            resolvedBy: String(resolvedBy || ''),
            resolutionNote: String(resolutionNote || ''),
            source: 'local-demo-fallback',
        };
        list[idx] = updated;
        _writeDemoResetRequests(list);
        return updated;
    }

    const actorFields = () => {
        const me = actor();
        return {
            actorName: (me && me.name) || 'Yönetici',
            actorPersonelId: (me && me.id) || null,
        };
    };

    function requireAdmin() {
        const S = session();
        if (!S || !S.isDbAdmin()) {
            throw new StaffLifecycleError('forbidden', 'Bu işlem için aktif yönetici oturumu gerekir.');
        }
        return S;
    }

    function requireWritableAdmin() {
        const S = requireAdmin();
        if (isLocked()) {
            throw new StaffLifecycleError('bulk-locked', 'Toplu geri yükleme veya içe aktarma kilidi sürüyor; birkaç dakika sonra yeniden deneyin.');
        }
        return S;
    }

    async function stepUp(kind) {
        const [title, message] = REAUTH_TEXT[kind];
        const res = await reauth({ title, message });
        if (res === 'unavailable') return;
        if (res !== 'verified') {
            throw new StaffLifecycleError(
                res === 'failed' ? 'reauth-failed' : 'reauth-cancelled',
                res === 'failed' ? 'Yönetici parolası doğrulanamadı; işlem iptal edildi.' : 'Parola doğrulamasından vazgeçildi; işlem yapılmadı.'
            );
        }
    }

    // [WHY]: Oturumsuz giriş ekranında 24 saat limitli şifre sıfırlama talebi oluşturulur; hesap varlığı sızdırılmaz.
    // [HOW]: 1) Yerel anti-spam kilidi (checkLocalResetGuard) aynı PRI/cihazdan mükerrer tıklamaları Firestore'a gitmeden durdurur.
    //        2) setDoc ile passwordResetRequests/items/{priNorm} yazılır; hem başarı hem permission-denied (24s kilidi)
    //           aynı nötr kullanıcı mesajını döner (zero-enumeration).
    //        3) Yalnızca localhost + inventory_demo modunda bulut kuralları henüz deploy edilmemişse yerel demo yedeğine yazar.
    async function submitPasswordResetRequest({ pri, note = '' } = {}) {
        const L = SL();
        const plan = L.planResetRequest({ pri, note, now: fns.serverTimestamp() });
        if (!plan.ok) {
            return { ok: false, code: plan.code, message: plan.error };
        }
        const now = nowMs();
        const store = storage();
        if (typeof L.checkLocalResetGuard === 'function') {
            const guard = L.checkLocalResetGuard({ pri: plan.docId, storage: store, nowMs: now });
            if (!guard.allowed) {
                if (typeof L.recordLocalResetAttempt === 'function') {
                    L.recordLocalResetAttempt({ pri: plan.docId, allowed: false, outcome: guard.code, storage: store, nowMs: now });
                }
                return {
                    ok: true,
                    code: guard.code,
                    localBlocked: true,
                    remainingMs: guard.remainingMs,
                    message: guard.message || L.NEUTRAL_RESET_MESSAGE,
                };
            }
        }
        try {
            await fns.setDoc(ref('passwordResetRequests', plan.docId), plan.payload);
            if (typeof L.recordLocalResetAttempt === 'function') {
                L.recordLocalResetAttempt({ pri: plan.docId, allowed: true, outcome: 'submitted', storage: store, nowMs: now });
            }
            return { ok: true, code: 'submitted', message: L.NEUTRAL_RESET_MESSAGE };
        } catch (e) {
            const code = String((e && e.code) || '');
            if (code === 'permission-denied') {
                if (typeof L.recordLocalResetAttempt === 'function') {
                    L.recordLocalResetAttempt({ pri: plan.docId, allowed: true, outcome: 'permission-denied', storage: store, nowMs: now });
                }
                if (isLocalDemoFallbackAllowed()) {
                    _upsertDemoResetRequest({
                        id: plan.docId,
                        pri: plan.docId,
                        note: plan.payload.note,
                        status: 'pending',
                        requestedAt: null,
                        requestedAtMs: now,
                        resolvedAt: null,
                        resolvedAtMs: null,
                        resolvedBy: '',
                        resolutionNote: '',
                        source: 'local-demo-fallback',
                    });
                    return { ok: true, code: 'local-demo-fallback', message: L.NEUTRAL_RESET_MESSAGE };
                }
                return { ok: true, code: 'neutral-guarded', message: L.NEUTRAL_RESET_MESSAGE };
            }
            if (code === 'unavailable' || code === 'network-request-failed') {
                return { ok: false, code: 'network', message: 'Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edip tekrar deneyin.' };
            }
            return { ok: false, code: code || 'write-failed', message: 'Sıfırlama talebi şu anda iletilemedi; lütfen yöneticiye başvurun.' };
        }
    }

    // [WHY]: Yönetici açık ve geçmiş sıfırlama taleplerini sunucudan taze okur.
    // [HOW]: Ek bileşik indeks gerektirmemek için getDocsFromServer sonrası bellek içi zaman sırası uygulanır.
    //        Lokal demo modunda (inventory_demo @ localhost) bulut kuralları deploy edilene kadar yerel demo talepleriyle birleştirilir.
    async function listPasswordResetRequests() {
        requireAdmin();
        let serverRows = [];
        try {
            const snap = await fns.getDocsFromServer(fns.collection(db(), root(), 'passwordResetRequests', 'items'));
            serverRows = snap.docs.map(d => {
                const data = d.data() || {};
                return {
                    id: d.id,
                    pri: data.pri || d.id,
                    note: data.note || '',
                    status: data.status || 'pending',
                    requestedAt: data.requestedAt || null,
                    requestedAtMs: _toMillis(data.requestedAt),
                    resolvedAt: data.resolvedAt || null,
                    resolvedAtMs: _toMillis(data.resolvedAt),
                    resolvedBy: data.resolvedBy || '',
                    resolutionNote: data.resolutionNote || '',
                    source: 'firestore',
                };
            });
        } catch (e) {
            if (!(e && e.code === 'permission-denied' && isLocalDemoFallbackAllowed())) {
                throw e;
            }
        }
        if (isLocalDemoFallbackAllowed()) {
            const demoRows = _readDemoResetRequests();
            const byPri = new Map(serverRows.map(r => [String(r.pri), r]));
            for (const dr of demoRows) {
                if (!byPri.has(String(dr.pri))) {
                    byPri.set(String(dr.pri), { ...dr, source: 'local-demo-fallback' });
                }
            }
            serverRows = [...byPri.values()];
        }
        return serverRows.sort((a, b) => (b.requestedAtMs || 0) - (a.requestedAtMs || 0));
    }

    // [WHY]: Personel tablosu ve yaşam döngüsü kartı hesapların askı / geçici PIN durumunu bilmelidir.
    // [HOW]: staffAccounts/items sunucudan okunup uid → özet haritasına dönüştürülür (gizli bilgi içermez).
    async function listStaffAccountStates() {
        requireAdmin();
        let snap;
        try {
            snap = await fns.getDocsFromServer(fns.collection(db(), root(), 'staffAccounts', 'items'));
        } catch (e) {
            if (e && e.code === 'permission-denied' && isLocalDemoFallbackAllowed()) {
                return {};
            }
            throw e;
        }
        const map = {};
        snap.docs.forEach(d => {
            const data = d.data() || {};
            const expMs = _toMillis(data.tempPinExpiresAt);
            map[d.id] = {
                uid: d.id,
                personelId: data.personelId || '',
                pri: data.pri || '',
                adminGranted: data.adminGranted === true,
                status: data.status || 'active',
                statusReason: data.statusReason || '',
                statusChangedAtMs: _toMillis(data.statusChangedAt),
                mustChangeCode: data.mustChangeCode === true,
                tempPinExpiresAtMs: expMs,
                tempPinExpired: data.mustChangeCode === true && (!expMs || expMs <= Date.now()),
                tempPinIssuedAtMs: _toMillis(data.tempPinIssuedAt),
                codeChangedAtMs: _toMillis(data.codeChangedAt),
            };
        });
        return map;
    }

    // [WHY]: Yönetici bir sıfırlama talebini çözdüğünde veya kapattığında requestedAt korunmalı ve iz bırakılmalıdır.
    // [HOW]: Tek transaction içinde passwordResetRequests güncellenir ve auditLogs kaydı yazılır;
    //        lokal demo modunda yerel demo kaydı da çözümlenir.
    async function resolvePasswordResetRequest(priId, { status = 'resolved', resolutionNote = '' } = {}) {
        requireWritableAdmin();
        const L = SL();
        const cleanPri = L.normalizePri(priId);
        if (!L.isValidPriId(cleanPri)) throw new StaffLifecycleError('invalid-pri', 'Geçersiz kurumsal kimlik.');
        const uidActor = actorUid();
        const auditId = makeAuditId('al_vp3_rst');
        try {
            const res = await fns.runTransaction(db(), async tx => {
                const reqRef = ref('passwordResetRequests', cleanPri);
                const snap = await tx.get(reqRef);
                if (!snap.exists()) throw new StaffLifecycleError('not-found', 'Sıfırlama talebi bulunamadı.');
                const plan = L.planResetResolution({
                    current: { ...snap.data(), id: snap.id },
                    status,
                    resolutionNote,
                    actorUid: uidActor,
                    now: fns.serverTimestamp(),
                });
                if (!plan.ok) throw new StaffLifecycleError(plan.code, plan.error);
                const rec = auditRecord({ ...actorFields(), ...plan.audit }, { id: auditId });
                tx.set(reqRef, plan.patch);
                tx.set(ref('auditLogs', auditId), rec.data);
                return { ok: true, pri: cleanPri, status, auditId };
            });
            if (isLocalDemoFallbackAllowed()) {
                _resolveDemoResetRequest(cleanPri, { status, resolutionNote, resolvedBy: uidActor });
            }
            return res;
        } catch (e) {
            if (isLocalDemoFallbackAllowed() && ((e && e.code === 'not-found') || (e && e.code === 'permission-denied'))) {
                const resolvedLocal = _resolveDemoResetRequest(cleanPri, { status, resolutionNote, resolvedBy: uidActor });
                if (resolvedLocal) {
                    return { ok: true, pri: cleanPri, status, auditId, source: 'local-demo-fallback' };
                }
            }
            if (e instanceof StaffLifecycleError) throw e;
            if (e && e.code === 'permission-denied') {
                throw new StaffLifecycleError('forbidden', 'Kurallar talebi güncellemeyi reddetti. Yönetici oturumunuzu yenileyip tekrar deneyin.');
            }
            throw new StaffLifecycleError((e && e.code) || 'write-failed', 'Sıfırlama talebi güncellenemedi.');
        }
    }

    // [WHY]: Hesap askıya alma / yeniden aktifleştirme deleteDoc yapmaz; personel.active + staffAccounts.status + auditLogs atomik yazılır.
    // [HOW]: Parola yeniden doğrulaması + tek transaction; yerel window.data.personel kopyası da hemen senkronize edilir.
    async function setStaffAccountSuspended(personelId, { suspend, reason } = {}) {
        const S = requireWritableAdmin();
        const L = SL();
        const r = L.validateLifecycleReason(reason);
        if (!r.ok) throw new StaffLifecycleError('invalid-reason', r.error);
        if (personelId === undefined || personelId === null || String(personelId).trim() === '') {
            throw new StaffLifecycleError('invalid-argument', 'Personel seçilmedi.');
        }
        await stepUp(suspend ? 'suspend' : 'reactivate');

        const canEditAdmin = typeof S.isPrimaryDbAdmin === 'function' ? S.isPrimaryDbAdmin() : false;
        const uidActor = actorUid();
        const auditId = makeAuditId(suspend ? 'al_vp3_susp' : 'al_vp3_act');
        try {
            const result = await fns.runTransaction(db(), async tx => {
                const pRef = ref('personel', personelId);
                const pSnap = await tx.get(pRef);
                if (!pSnap.exists()) throw new StaffLifecycleError('not-found', 'Personel kaydı bulunamadı.');
                const person = { ...pSnap.data(), id: pSnap.id };

                let mRef = null;
                let mapping = null;
                if (person.uid) {
                    mRef = ref('staffAccounts', person.uid);
                    const mSnap = await tx.get(mRef);
                    if (mSnap.exists()) mapping = { ...mSnap.data(), id: mSnap.id };
                }

                const plan = L.planSuspendToggle({
                    person,
                    mapping,
                    suspend: !!suspend,
                    reason: r.value,
                    actorUid: uidActor,
                    canEditAdminAccount: canEditAdmin,
                    auditId,
                    now: fns.serverTimestamp(),
                });
                if (!plan.ok) throw new StaffLifecycleError(plan.code, plan.error);

                const rec = auditRecord({ ...actorFields(), ...plan.audit }, { id: auditId });
                tx.update(pRef, plan.personPatch);
                if (mRef && plan.accountPatch) tx.update(mRef, plan.accountPatch);
                tx.set(ref('auditLogs', auditId), rec.data);
                return {
                    ok: true,
                    personelId: String(person.id),
                    uid: person.uid || null,
                    active: !suspend,
                    status: suspend ? 'suspended' : 'active',
                    auditId,
                    name: person.name || '-',
                };
            });

            // Yerel önbelleği anında güncelle (mutasyon yok, yalnız ilgili öğenin active alanı yenilenir).
            if (typeof window !== 'undefined' && window.data && Array.isArray(window.data.personel)) {
                window.data.personel = window.data.personel.map(p => (
                    String(p && p.id) === String(result.personelId) ? { ...p, active: result.active } : p
                ));
            }
            return result;
        } catch (e) {
            if (e instanceof StaffLifecycleError) throw e;
            if (e && e.code === 'permission-denied') {
                throw new StaffLifecycleError('forbidden', 'Kurallar hesap durumu değişimini reddetti. Yönetici yetkili bir hesabı yalnızca ana yönetici askıya alabilir veya açabilir.');
            }
            throw new StaffLifecycleError((e && e.code) || 'write-failed', 'Hesap durumu güncellenemedi.');
        }
    }

    // [WHY]: Yönetici seçilen aktif personele süreli tek kullanımlık geçici PIN veya sıfırlama kodu tanımlar.
    // [HOW]: 1) Sunucudan kişi/eşleme doğrulanır; 2) Yönetici parolası doğrulanır; 3) Kriptografik kod üretilir;
    //        4) Mevcut kod verilmişse ikincil 'provisioner' ile Firebase Auth güncellenir, verilmemişse Spark çevrimdışı
    //           köprü komutu hazırlanır; 5) Tek transaction ile staffAccounts (mustChangeCode + tempPinExpiresAt) + auditLogs
    //           (+ varsa sıfırlama talebi çözümü) yazılır. Düz metin kod ASLA DB'ye/loga yazılmaz, yalnız 1 kez dönüşte verilir.
    async function issueTemporaryPinOrReset(personelId, {
        mode = 'tempPin',
        ttlMinutes = 60,
        currentCode = '',
        reason = '',
        resolveResetPri = '',
    } = {}) {
        const S = requireWritableAdmin();
        const L = SL();
        const P = SP();
        const ttlCheck = L.validateTempPinTtl(ttlMinutes);
        if (!ttlCheck.ok) throw new StaffLifecycleError('invalid-ttl', ttlCheck.error);
        const reasonCheck = L.validateLifecycleReason(reason);
        if (!reasonCheck.ok) throw new StaffLifecycleError('invalid-reason', reasonCheck.error);
        if (personelId === undefined || personelId === null || String(personelId).trim() === '') {
            throw new StaffLifecycleError('invalid-argument', 'Personel seçilmedi.');
        }

        const canEditAdmin = typeof S.isPrimaryDbAdmin === 'function' ? S.isPrimaryDbAdmin() : false;
        const uidActor = actorUid();

        // Ön doğrulama (parola sormadan ve Auth'a dokunmadan önce)
        const pPreSnap = await fns.getDocFromServer(ref('personel', personelId));
        if (!pPreSnap.exists()) throw new StaffLifecycleError('not-found', 'Personel kaydı bulunamadı.');
        const pPre = { ...pPreSnap.data(), id: pPreSnap.id };
        if (!pPre.uid) throw new StaffLifecycleError('no-account', 'Bu personelin bağlı giriş hesabı yok; önce "Hesap Aç" kullanın.');
        const mPreSnap = await fns.getDocFromServer(ref('staffAccounts', pPre.uid));
        const mPre = mPreSnap.exists() ? { ...mPreSnap.data(), id: mPreSnap.id } : null;

        // 24 saatlik sunucu kuralı için istemci saat kayması payı (30 sn)
        const ttlMs = Math.min(ttlCheck.minutes * 60 * 1000, L.RESET_COOLDOWN_MS - 30 * 1000);
        const expiresAtMs = Date.now() + ttlMs;
        const expiresAtTs = fns.Timestamp.fromMillis(expiresAtMs);

        const prePlan = L.planTempPinIssue({
            person: pPre,
            mapping: mPre,
            mode,
            ttlMinutes: ttlCheck.minutes,
            reason: reasonCheck.value,
            actorUid: uidActor,
            canEditAdminAccount: canEditAdmin,
            auditId: 'precheck',
            now: fns.serverTimestamp(),
            expiresAt: expiresAtTs,
        });
        if (!prePlan.ok) throw new StaffLifecycleError(prePlan.code, prePlan.error);

        await stepUp('tempPin');

        const cleanCurrent = String(currentCode || '').trim();
        let generatedCode = L.generateSecureCode({
            kind: mode === 'resetCode' ? 'code' : 'tempPin',
            forbidden: cleanCurrent ? [cleanCurrent] : [],
        });

        let authUpdated = false;
        let offlineRequired = false;
        let offlineCommand = '';

        if (cleanCurrent) {
            const provisioner = getProvisioner();
            if (!provisioner || typeof provisioner.updateAccountPassword !== 'function') {
                throw new StaffLifecycleError('not-supported', 'İkincil kimlik yenileme köprüsü hazır değil.');
            }
            const email = P.accountEmailOf(pPre);
            const oldPw = P.staffPassword(cleanCurrent);
            const newPw = P.staffPassword(generatedCode);
            if (!email || !oldPw || !newPw) {
                throw new StaffLifecycleError('invalid-code', 'Kurumsal kimlik veya mevcut giriş kodu biçimi geçersiz.');
            }
            try {
                await provisioner.updateAccountPassword(email, oldPw, newPw, { expectUid: pPre.uid });
                authUpdated = true;
            } catch (e) {
                generatedCode = '';
                const code = String((e && e.code) || '').replace(/^auth\//, '');
                if (['invalid-credential', 'invalid-login-credentials', 'wrong-password', 'user-not-found'].includes(code)) {
                    throw new StaffLifecycleError('wrong-current-code', 'Girilen mevcut/geçici kod doğrulanamadı. Eski kod bilinmiyorsa alanı boş bırakarak Spark çevrimdışı sıfırlama yolunu kullanın.');
                }
                if (code === 'too-many-requests') {
                    throw new StaffLifecycleError('rate-limited', 'Çok fazla deneme yapıldı. Birkaç dakika sonra tekrar deneyin.');
                }
                if (code === 'uid-mismatch') {
                    throw new StaffLifecycleError('uid-mismatch', 'Hesap kimliği (UID) personel kaydıyla uyuşmuyor; işlem durduruldu.');
                }
                throw new StaffLifecycleError('auth-failed', 'Firebase Auth parolası güncellenemedi. Bağlantınızı kontrol edip tekrar deneyin.');
            }
        } else {
            offlineRequired = true;
            offlineCommand = L.formatOfflineResetCommand(pPre.pri, { emulator: isEmulator() });
        }

        const auditId = makeAuditId(mode === 'resetCode' ? 'al_vp3_rst' : 'al_vp3_pin');
        const cleanResolvePri = resolveResetPri ? L.normalizePri(resolveResetPri) : '';

        try {
            await fns.runTransaction(db(), async tx => {
                const pSnap = await tx.get(ref('personel', personelId));
                if (!pSnap.exists()) throw new StaffLifecycleError('not-found', 'Personel kaydı bulunamadı.');
                const person = { ...pSnap.data(), id: pSnap.id };
                const mRef = ref('staffAccounts', person.uid);
                const mSnap = await tx.get(mRef);
                const mapping = mSnap.exists() ? { ...mSnap.data(), id: mSnap.id } : null;

                let reqRef = null;
                let reqSnap = null;
                if (cleanResolvePri && L.isValidPriId(cleanResolvePri)) {
                    reqRef = ref('passwordResetRequests', cleanResolvePri);
                    reqSnap = await tx.get(reqRef);
                }

                const plan = L.planTempPinIssue({
                    person,
                    mapping,
                    mode,
                    ttlMinutes: ttlCheck.minutes,
                    reason: reasonCheck.value,
                    actorUid: uidActor,
                    canEditAdminAccount: canEditAdmin,
                    auditId,
                    now: fns.serverTimestamp(),
                    expiresAt: expiresAtTs,
                });
                if (!plan.ok) throw new StaffLifecycleError(plan.code, plan.error);

                const rec = auditRecord({ ...actorFields(), ...plan.audit }, { id: auditId });
                tx.update(mRef, plan.accountPatch);
                tx.set(ref('auditLogs', auditId), rec.data);

                if (reqRef && reqSnap && reqSnap.exists()) {
                    const resNote = authUpdated
                        ? 'Yönetici tarafından yeni tek kullanımlık geçici kod tanımlandı'
                        : 'Geçici kod üretildi; çevrimdışı Auth sıfırlama adımı bekleniyor';
                    const resPlan = L.planResetResolution({
                        current: { ...reqSnap.data(), id: reqSnap.id },
                        status: 'resolved',
                        resolutionNote: resNote,
                        actorUid: uidActor,
                        now: fns.serverTimestamp(),
                    });
                    if (resPlan.ok) tx.set(reqRef, resPlan.patch);
                }
            });

            if (cleanResolvePri && isLocalDemoFallbackAllowed()) {
                const resNote = authUpdated
                    ? 'Yönetici tarafından yeni tek kullanımlık geçici kod tanımlandı'
                    : 'Geçici kod üretildi; çevrimdışı Auth sıfırlama adımı bekleniyor';
                _resolveDemoResetRequest(cleanResolvePri, {
                    status: 'resolved',
                    resolutionNote: resNote,
                    resolvedBy: uidActor,
                });
            }

            return {
                ok: true,
                oneTimeCode: generatedCode,
                mode,
                ttlMinutes: ttlCheck.minutes,
                expiresAtMs,
                authUpdated,
                offlineRequired,
                offlineCommand,
                auditId,
                pri: pPre.pri || '',
                name: pPre.name || '-',
            };
        } catch (e) {
            generatedCode = '';
            if (e instanceof StaffLifecycleError) throw e;
            if (e && e.code === 'permission-denied') {
                throw new StaffLifecycleError('forbidden', 'Kurallar geçici kod kaydını reddetti. Yönetici yetkili hesaplara yalnız ana yönetici işlem yapabilir.');
            }
            throw new StaffLifecycleError((e && e.code) || 'write-failed', 'Geçici kod kaydı veritabanına yazılamadı.');
        }
    }

    // [WHY]: Giriş yapan personel hesabı askıda mı ya da geçici PIN değişimi bekliyor mu sunucudan kontrol edilir.
    // [HOW]: Personel kendi staffAccounts/{uid} belgesini okuyabilir (firestore.rules: allow read uid == auth.uid).
    async function readOwnAccountLifecycle() {
        const uid = actorUid();
        if (!uid) return { exists: false, status: 'unknown', suspended: false, mustChangeCode: false, tempPinExpiresAtMs: null, tempPinExpired: false };
        try {
            const snap = await fns.getDocFromServer(ref('staffAccounts', uid));
            if (!snap.exists()) {
                return { exists: false, status: 'missing', suspended: false, mustChangeCode: false, tempPinExpiresAtMs: null, tempPinExpired: false };
            }
            const data = snap.data() || {};
            const expMs = _toMillis(data.tempPinExpiresAt);
            const mustChangeCode = data.mustChangeCode === true;
            return {
                exists: true,
                uid,
                personelId: data.personelId || '',
                pri: data.pri || '',
                status: data.status || 'active',
                suspended: data.status === 'suspended',
                mustChangeCode,
                tempPinExpiresAtMs: expMs,
                tempPinExpired: mustChangeCode && (!expMs || expMs <= Date.now()),
            };
        } catch (e) {
            return { exists: false, status: 'error', suspended: false, mustChangeCode: false, tempPinExpiresAtMs: null, tempPinExpired: false, errorCode: e && e.code };
        }
    }

    // [WHY]: Geçici PIN ile giriş yapan personel kendi yeni gizli kodunu belirleyip tek kullanımlık bayrağı kapatır.
    // [HOW]: 1) Zayıf kod süzgeci; 2) Kendi Auth oturumunda updatePassword (%100 Spark-native); 3) staffAccounts/{uid}
    //        üzerinde selfClearTempPinOk kuralıyla mustChangeCode:false + tempPinExpiresAt:null; 4) auditLogs kaydı.
    async function completeMandatoryCodeChange(newCode, { currentCode = '' } = {}) {
        const L = SL();
        const P = SP();
        const uid = actorUid();
        if (!uid) throw new StaffLifecycleError('unauthenticated', 'Aktif oturum bulunamadı; lütfen yeniden giriş yapın.');

        const check = L.validateNewCode(newCode, { forbidden: currentCode ? [currentCode] : [] });
        if (!check.ok) throw new StaffLifecycleError(check.reason || 'invalid-code', check.message);

        const nextPassword = P.staffPassword(String(newCode).trim());
        if (!nextPassword) throw new StaffLifecycleError('invalid-code', 'Yeni giriş kodu biçimi geçersiz.');

        try {
            await updateOwnPassword(nextPassword);
        } catch (e) {
            const code = String((e && e.code) || '').replace(/^auth\//, '');
            if (code === 'requires-recent-login') {
                throw new StaffLifecycleError('requires-recent-login', 'Güvenlik nedeniyle oturumunuz yenilenmelidir. Çıkış yapıp geçici kodunuzla yeniden giriş yapın.');
            }
            throw new StaffLifecycleError('auth-update-failed', 'Yeni giriş kodunuz kaydedilemedi. Lütfen tekrar deneyin.');
        }

        try {
            await fns.updateDoc(ref('staffAccounts', uid), {
                mustChangeCode: false,
                tempPinExpiresAt: null,
                codeChangedAt: fns.serverTimestamp(),
            });
        } catch (e) {
            if (e && e.code === 'permission-denied') {
                throw new StaffLifecycleError('expired', 'Geçici kodun süresi dolmuş veya hesap askıya alınmış. Lütfen yöneticiden yeni kod isteyin.');
            }
            throw new StaffLifecycleError((e && e.code) || 'clear-failed', 'Kod güncellendi ancak hesap durumu tamamlanamadı. Yeniden giriş yapın.');
        }

        try {
            await appendAudit({
                type: L.AUDIT_TYPES.SELF_CODE_CHANGE,
                refCol: 'staffAccounts',
                refId: String(uid),
                item: (window.userAuth && window.userAuth.email) || String(uid),
                result: 'approved',
                reason: 'Personel geçici kod sonrası kendi giriş kodunu belirledi',
                fromValue: 'gecici-kod-bekliyor',
                toValue: 'kisisel-kod-aktif',
            });
        } catch (_) {
            // Denetim günlüğü ekleme hatası tamamlanmış kod değişimini geri almaz.
        }

        return { ok: true, uid };
    }

    return Object.freeze({
        submitPasswordResetRequest,
        listPasswordResetRequests,
        listStaffAccountStates,
        resolvePasswordResetRequest,
        setStaffAccountSuspended,
        issueTemporaryPinOrReset,
        readOwnAccountLifecycle,
        completeMandatoryCodeChange,
    });
}

const staffLifecycleService = createStaffLifecycleService();
export const {
    submitPasswordResetRequest,
    listPasswordResetRequests,
    listStaffAccountStates,
    resolvePasswordResetRequest,
    setStaffAccountSuspended,
    issueTemporaryPinOrReset,
    readOwnAccountLifecycle,
    completeMandatoryCodeChange,
} = staffLifecycleService;

if (typeof window !== 'undefined') {
    window.AppModules = window.AppModules || {};
    window.AppModules.StaffLifecycleService = staffLifecycleService;
}
