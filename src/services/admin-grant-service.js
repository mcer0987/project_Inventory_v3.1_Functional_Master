/**
 * services/admin-grant-service.js — İP-7 · Ana yöneticinin verdiği yönetici yetkisi: listeleme, verme, geri alma.
 * ES modülü; admin.html'de admin-main.js içe aktarır → window.AppModules.AdminGrantService. Arayüz (src/ui/admin-grant-panel.js)
 * SDK'ya dokunmaz, yalnız bu servisi çağırır. Saf karar mantığı src/utils/admin-grants.js'tedir (window.AppModules.AdminGrants).
 *
 * [WHY]: Yetki claim'deydi ve repo dışındaki bir Admin SDK betiğiyle yazılıyordu: panelden verilemiyor, geri alınamıyor, iz
 *        bırakmıyordu. Spark planında Cloud Functions yok; yetki istemci transaction'ıyla yazılır, kurallar doğrular.
 * [HOW]: grantAdmin / revokeAdmin sırası:
 *          1) istemci kapıları — ana yönetici oturumu (canManageAdmins), toplu yazma kilidi yok, bakım modu kapalı, gerekçe geçerli;
 *          2) taze parola doğrulaması (SecurityConfig.promptAdminReauth) — kural auth_time ≤ 10 dk ister;
 *          3) tek transaction: personel + eşleme SUNUCUDAN taze okunur → AdminGrants.planGrant / planRevoke → eşleme yaması
 *             (adminChangedAt = serverTimestamp) + aynı commit'te denetim kaydı (buildAuditRecord, önceden üretilmiş kimlikle).
 *        Kural reddi anlaşılır Türkçe iletiye çevrilir. Bağımlılıklar createAdminGrantService'e verilebilir (emülatör testi).
 */
import { doc, collection, query, where, getDocFromServer, getDocsFromServer, runTransaction, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

export class AdminGrantError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'AdminGrantError';
        this.code = code;
    }
}

const LOCK_COLLECTIONS = ['personel', 'staffAccounts'];
const REAUTH_TEXT = {
    grant: ['Yönetici yetkisi ver', 'Seçilen personele yönetici yetkisi verilecek. Onay için ana yönetici parolanızı yeniden girin; işlem Güvenlik Raporu\'na yazılır.'],
    revoke: ['Yönetici yetkisini geri al', 'Seçilen hesabın yönetici yetkisi geri alınacak. Onay için ana yönetici parolanızı yeniden girin; işlem Güvenlik Raporu\'na yazılır.'],
};
const DENIED_TEXT = 'Kurallar yazımı reddetti. Parola doğrulaması 10 dakikadan eski olabilir, kişi artık uygun olmayabilir ya da oturumunuz ana yönetici değildir. Paneli yenileyip yeniden deneyin.';

const _gateOpenOf = state => (state === 'open' ? true : ['closed', 'missing', 'invalid'].includes(state) ? false : undefined);
const _newAuditId = () => 'al_ip7_' + (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function'
    ? globalThis.crypto.randomUUID().replace(/-/g, '')
    : Date.now().toString(36) + Math.random().toString(36).slice(2, 12));

/**
 * [WHY]: Servis tarayıcıda window köprülerine, emülatör testinde gerçek SDK + test oturumuna bağlanır; mantık tek kopya kalsın.
 * [HOW]: Her bağımlılık çağrı anında çözülür (modül yüklenirken window.fireDb henüz hazır olmayabilir).
 * @param {object} deps  { fns, db, root, grants, session, actorUid, actor, auditRecord, reauth, isLocked, inMaintenance,
 *                         accountEmail, readGate, refreshToken, makeAuditId }
 */
export function createAdminGrantService(deps = {}) {
    const fns = deps.fns || { doc, collection, query, where, getDocFromServer, getDocsFromServer, runTransaction, serverTimestamp };
    const db = () => (deps.db ? deps.db() : window.fireDb);
    const root = () => (deps.root ? deps.root() : window.AppEnv.COLLECTION_ROOT);
    const AG = () => {
        const g = deps.grants ? deps.grants() : (window.AppModules && window.AppModules.AdminGrants);
        if (!g) throw new AdminGrantError('not-loaded', 'Yönetici yetkisi modülü (admin-grants.js) yüklenmemiş; sayfayı yenileyin.');
        return g;
    };
    const session = () => (deps.session ? deps.session() : (window.AppModules && window.AppModules.Session));
    const actorUid = () => (deps.actorUid ? deps.actorUid() : (window.userAuth && window.userAuth.uid));
    const actor = deps.actor || (() => (typeof window.getActiveUser === 'function' && window.getActiveUser()) || null);
    const auditRecord = deps.auditRecord || ((entry, opts) => window.buildAuditRecord(entry, opts));
    const reauth = deps.reauth || (async ({ title, message }) => (window.SecurityConfig && typeof window.SecurityConfig.promptAdminReauth === 'function'
        ? window.SecurityConfig.promptAdminReauth({ title, message }) : 'unavailable'));
    const isLocked = deps.isLocked || (() => typeof window.isBulkWriteLocked === 'function' && window.isBulkWriteLocked(LOCK_COLLECTIONS));
    const inMaintenance = deps.inMaintenance || (() => !!(window.data && window.data.config && window.data.config.maintenance === true));
    const accountEmail = deps.accountEmail || (p => (window.StaffProvisioning ? window.StaffProvisioning.accountEmailOf(p) : null));
    const readGate = deps.readGate || (async () => (typeof window.readStaffAccessGate === 'function' ? window.readStaffAccessGate() : { state: 'unknown' }));
    const refreshToken = deps.refreshToken || (async () => { try { if (window.userAuth) await window.userAuth.getIdToken(); } catch (_) { /* kural yine denetler */ } });
    const makeAuditId = deps.makeAuditId || _newAuditId;
    const ref = (col, id) => fns.doc(db(), root(), col, 'items', String(id));

    function requireReader() {
        const S = session();
        if (!S || !S.isDbAdmin()) throw new AdminGrantError('forbidden', 'Yönetici yetkilerini görmek için yönetici oturumu gerekir.');
    }
    // [WHY]: Kural asıl kapıdır; istemci kapıları yalnız gereksiz parola sorusunu ve anlaşılmaz "permission-denied"i önler.
    // [HOW]: Ana yönetici değilse, toplu yazma kilidi ya da bakım varsa ya da gerekçe geçersizse parola sorulmadan durur.
    function requireOwner(reason) {
        const S = session();
        if (!S || !S.canManageAdmins()) throw new AdminGrantError('forbidden', 'Yönetici yetkisini yalnız ana yönetici hesabı verebilir ve geri alabilir.');
        if (isLocked()) throw new AdminGrantError('bulk-locked', 'Toplu geri yükleme / içe aktarma kilidi sürüyor; yetki değişikliği yapılmadı. Birkaç dakika sonra yeniden deneyin.');
        if (inMaintenance()) throw new AdminGrantError('maintenance', 'Sistem bakım modunda; yetki değişikliği bakım bitince yapılabilir.');
        const r = AG().validateReason(reason);
        if (!r.ok) throw new AdminGrantError('invalid-reason', r.error);
        return r.value;
    }
    async function stepUp(kind) {
        const [title, message] = REAUTH_TEXT[kind];
        const res = await reauth({ title, message });
        if (res !== 'verified') {
            throw new AdminGrantError(res === 'failed' ? 'reauth-failed' : 'reauth-cancelled',
                res === 'failed' ? 'Parola doğrulanamadı; yetki değişikliği yapılmadı.' : 'Parola doğrulamasından vazgeçildi; yetki değişikliği yapılmadı.');
        }
        await refreshToken();
    }
    const actorFields = () => {
        const me = actor();
        return { actorName: (me && me.name) || 'Ana yönetici', actorPersonelId: (me && me.id) || null };
    };
    async function commit(work) {
        try {
            return await fns.runTransaction(db(), work);
        } catch (e) {
            if (e instanceof AdminGrantError) throw e;
            if (e && e.code === 'permission-denied') throw new AdminGrantError('forbidden', DENIED_TEXT);
            throw new AdminGrantError((e && e.code) || 'write-failed', `Yetki değişikliği kaydedilemedi: ${(e && (e.message || e.code)) || 'bilinmeyen hata'}`);
        }
    }

    /**
     * Panel verisi (yazmaz): eşlemeler, personel ve erişim kilidi SUNUCUDAN taze okunur.
     * Dönüş: { root, canManage, gateState, gateOpen, rows (yetkili eşlemeler + durum), candidates (uygunlukla), revokedCount }
     */
    async function listAdminGrants() {
        requireReader();
        const [mapSnap, personSnap, gate] = await Promise.all([
            fns.getDocsFromServer(fns.collection(db(), root(), 'staffAccounts', 'items')),
            fns.getDocsFromServer(fns.collection(db(), root(), 'personel', 'items')),
            readGate(),
        ]);
        const mappings = mapSnap.docs.map(d => ({ ...d.data(), id: d.id }));
        const personel = personSnap.docs.map(d => ({ ...d.data(), id: d.id }));
        const gateOpen = _gateOpenOf(gate && gate.state);
        const G = AG();
        return {
            root: root(),
            canManage: !!session().canManageAdmins(),
            gateState: (gate && gate.state) || 'unknown',
            gateOpen,
            rows: G.adminRows({ mappings, personel, gateOpen }),
            candidates: G.candidates({ personel, mappings, accountEmail }),
            revokedCount: mappings.filter(m => m.adminGranted === false).length,
        };
    }
    /** Yalnız yetkili eşlemeler (where adminGranted == true) — hafif sorgu; panel dışındaki denetimler için. */
    async function listGrantedMappings() {
        requireReader();
        const snap = await fns.getDocsFromServer(fns.query(fns.collection(db(), root(), 'staffAccounts', 'items'), fns.where('adminGranted', '==', true)));
        return snap.docs.map(d => ({ ...d.data(), id: d.id }));
    }

    /** Personele yönetici yetkisi verir. Dönüş: { ok:true, uid, auditId, name }. Hata: AdminGrantError (code + Türkçe ileti). */
    async function grantAdmin(personelId, reason) {
        const clean = requireOwner(reason);
        if (personelId === undefined || personelId === null || String(personelId).trim() === '') throw new AdminGrantError('invalid-argument', 'Personel seçilmedi.');
        await stepUp('grant');
        const auditId = makeAuditId();
        const uidActor = actorUid();
        return commit(async t => {
            const pSnap = await t.get(ref('personel', personelId));
            if (!pSnap.exists()) throw new AdminGrantError('not-found', 'Personel kaydı bulunamadı (silinmiş olabilir).');
            const person = { ...pSnap.data(), id: pSnap.id };
            if (!person.uid) throw new AdminGrantError('no-account', AG().ELIGIBILITY_TEXT['no-account']);
            const mRef = ref('staffAccounts', person.uid);
            const mSnap = await t.get(mRef);
            const mapping = mSnap.exists() ? { ...mSnap.data(), id: mSnap.id } : null;
            const plan = AG().planGrant({ person, mapping, actorUid: uidActor, reason: clean, auditId, now: fns.serverTimestamp(), accountEmail });
            if (!plan.ok) throw new AdminGrantError(plan.code, plan.error);
            const rec = auditRecord({ ...actorFields(), ...plan.audit }, { id: auditId });
            t.update(mRef, plan.patch);
            t.set(ref('auditLogs', auditId), rec.data);
            return { ok: true, uid: plan.uid, auditId, name: plan.audit.item };
        });
    }

    /** Hesabın yönetici yetkisini geri alır (kişi pasif / silinmiş olsa da). Dönüş: { ok:true, uid, auditId, name }. */
    async function revokeAdmin(uid, reason) {
        const clean = requireOwner(reason);
        if (uid === undefined || uid === null || String(uid).trim() === '') throw new AdminGrantError('invalid-argument', 'Geri alınacak hesap seçilmedi.');
        await stepUp('revoke');
        const auditId = makeAuditId();
        const uidActor = actorUid();
        return commit(async t => {
            const mRef = ref('staffAccounts', uid);
            const mSnap = await t.get(mRef);
            const mapping = mSnap.exists() ? { ...mSnap.data(), id: mSnap.id } : null;
            let person = null;
            if (mapping && mapping.personelId !== undefined && mapping.personelId !== null && String(mapping.personelId) !== '') {
                const pSnap = await t.get(ref('personel', mapping.personelId));
                person = pSnap.exists() ? { ...pSnap.data(), id: pSnap.id } : null;
            }
            const plan = AG().planRevoke({ person, mapping, uid, actorUid: uidActor, reason: clean, auditId, now: fns.serverTimestamp() });
            if (!plan.ok) throw new AdminGrantError(plan.code, plan.error);
            const rec = auditRecord({ ...actorFields(), ...plan.audit }, { id: auditId });
            t.update(mRef, plan.patch);
            t.set(ref('auditLogs', auditId), rec.data);
            return { ok: true, uid: plan.uid, auditId, name: plan.audit.item };
        });
    }

    return Object.freeze({ listAdminGrants, listGrantedMappings, grantAdmin, revokeAdmin });
}

const adminGrantService = createAdminGrantService();
export const { listAdminGrants, listGrantedMappings, grantAdmin, revokeAdmin } = adminGrantService;

if (typeof window !== 'undefined') {
    window.AppModules = window.AppModules || {};
    window.AppModules.AdminGrantService = adminGrantService;
}
