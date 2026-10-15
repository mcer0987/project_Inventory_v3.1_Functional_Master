/**
 * services/staff-provisioning.js — Personel Firebase Auth hesabı açma altyapısı (Faz 4B · Tur J7 · 4.6 / K4)
 * Klasik script; iki sayfada <head>'de schema.js'ten sonra. firebase-handler.js Auth fonksiyonlarını enjekte eder ve
 * window.provisionStaffAccount / window.provisionMissingStaffAccounts köprülerini açar.
 *
 * [WHY]: Aşama A'da personel anonim oturumla çalışıyor: giriş, istemcide personel listesindeki düz metin kodla eşleştirme;
 *        kurallar kimin hangi talebin sahibi olduğunu bilemiyor (Faz 4 planı §6). Aşama B'nin ilk adımı her personele
 *        kendi Firebase Auth hesabını açmak. Admin panelinden ana Auth örneğiyle createUserWithEmailAndPassword çağrılırsa
 *        Firebase yeni hesapla OTURUM AÇAR — admin oturumu düşer.
 * [HOW]: - Hesap açma yalnız İKİNCİL bir app örneğinde ('provisioner', bellek içi kalıcılık): admin oturumu (ana örnek)
 *          hiç etkilenmez; ikincil örnek her işlemden sonra signOut eder, tarayıcı depolamasına hiçbir şey yazmaz.
 *        - E-posta  : p<personelId>@staff.medipol.local (sentetik, doğrulanmaz). id e-posta yerel kısmına güvenli değilse
 *                     (büyük harf, boşluk, Türkçe harf…) "p." + UTF-8 onaltılık kodlanır — iki farklı id asla aynı adrese düşmez.
 *        - Parola   : giriş kodu (girişteki gibi kırpılmış, büyük/küçük harf duyarlı) + sabit dolgu. Dolgu GİZLİ DEĞİLDİR
 *                     (istemci kodunda); yalnız Firebase'in ≥ 6 karakter kuralını sağlar. Güvenlik kodun kendisinden gelir.
 *        - Bağlama  : hesap açılınca personel.uid / authEmail yazılır. Sıra bilinçli: önce hesap, sonra bağlama. Bağlama
 *                     düşerse yeniden çalıştırma hesabı "zaten var" bulur, aynı parolayla uid'i alıp bağlar (idempotent).
 *        - Kota     : Firebase istemci tarafı hesap açmayı IP başına sınırlar; 'too-many-requests'te toplu iş DURUR ve
 *                     kalan sayıyı bildirir (yarım kalan iş sonra kaldığı yerden devam eder — açılmış olanlar bağlıdır).
 *        Saf çekirdek (staffEmail, staffPassword, planProvisioning, provisionOne, provisionMissing) window'a ve Firebase'e
 *        dokunmaz → tests/unit/staff-provisioning.test.mjs; gerçek Auth: tests/integration/staff-provisioning.emu.test.mjs.
 */
(function () {
    const STAFF_EMAIL_DOMAIN = 'staff.medipol.local';
    const PASSWORD_PAD = 'Mdp!';
    const MIN_CODE_LENGTH = 4;          // kod + 4 karakter dolgu ≥ 8 (Firebase alt sınırı 6)
    const PROVISIONER_APP = 'provisioner';

    class ProvisioningStop extends Error {
        constructor(code, message) { super(message); this.name = 'ProvisioningStop'; this.code = code; }
    }

    // ─── Saf çekirdek ──────────────────────────────────────────────────────────────────────────────────

    // UTF-8 onaltılık (TextEncoder'a bağlı kalmadan): encodeURIComponent'in %XX'leri + kaçışsız ASCII karakterlerin kodu.
    const utf8Hex = s => encodeURIComponent(s).replace(/%([0-9A-F]{2})|[\s\S]/g, (m, h) => (h ? h.toLowerCase() : m.charCodeAt(0).toString(16).padStart(2, '0')));

    /** Personel id → sentetik hesap e-postası; çevrilemiyorsa null. Güvenli id'ler '.' içermez → "p." ön eki çakışmaz. */
    function staffEmail(personelId) {
        const id = personelId === undefined || personelId === null ? '' : String(personelId).trim();
        if (!id) return null;
        const local = /^[a-z0-9_-]+$/.test(id) ? `p${id}` : `p.${utf8Hex(id)}`;
        if (local.length > 64) return null;   // RFC 5321 yerel kısım sınırı
        return `${local}@${STAFF_EMAIL_DOMAIN}`;
    }

    // Girişteki normalizasyonla birebir (auth-engine completeStaffLogin: p.code === code, kod kırpılmış girilir).
    const normCode = code => (code === undefined || code === null ? '' : String(code).trim());

    /** Giriş kodu → hesap parolası; kod yok ya da MIN_CODE_LENGTH'ten kısaysa null. */
    function staffPassword(code) {
        const c = normCode(code);
        return c.length >= MIN_CODE_LENGTH ? c + PASSWORD_PAD : null;
    }

    const isStaffEmail = email => typeof email === 'string' && email.toLowerCase().endsWith('@' + STAFF_EMAIL_DOMAIN);

    /**
     * Hangi personele hesap açılacağının planı (yazmaz).
     * @returns {{total:number, linked:object[], toCreate:{person:object, email:string}[],
     *            invalid:{person:object, reason:string}[], duplicateCodes:{code:string, ids:string[]}[]}}
     *          duplicateCodes kod DEĞERİNİ değil yalnız kaç kişide geçtiğini gösterir (code alanı arayüze/loga taşınmaz).
     */
    function planProvisioning(personel) {
        const plan = { total: 0, linked: [], toCreate: [], invalid: [], duplicateCodes: [] };
        const byCode = new Map();
        (personel || []).forEach(p => {
            if (!p || typeof p !== 'object') return;
            plan.total++;
            const c = normCode(p.code);
            if (c) byCode.set(c, [...(byCode.get(c) || []), String(p.id)]);
            if (p.uid) { plan.linked.push(p); return; }
            const email = staffEmail(p.id);
            if (!email) { plan.invalid.push({ person: p, reason: 'id yok ya da e-postaya çevrilemiyor' }); return; }
            if (!c) { plan.invalid.push({ person: p, reason: 'giriş kodu yok' }); return; }
            if (!staffPassword(c)) { plan.invalid.push({ person: p, reason: `giriş kodu ${MIN_CODE_LENGTH} karakterden kısa` }); return; }
            plan.toCreate.push({ person: p, email });
        });
        byCode.forEach(ids => { if (ids.length > 1) plan.duplicateCodes.push({ ids }); });
        return plan;
    }

    const errCode = e => String((e && e.code) || '').replace(/^auth\//, '');
    const RATE_LIMIT = ['too-many-requests', 'quota-exceeded'];
    const SIGNUP_CLOSED = ['admin-restricted-operation', 'operation-not-allowed'];
    const WRONG_PASSWORD = ['wrong-password', 'invalid-credential', 'invalid-login-credentials', 'user-not-found'];

    /**
     * Tek personel için hesap açar (ya da var olanı bulur) ve bağlar.
     * @param {object} person                 { id, code, uid? }
     * @param {{createAccount:Function, findAccount:Function}} provisioner  (email, password) → uid
     * @param {Function} link                 (person, { uid, authEmail, authProvisionedAt }) → Promise
     * @returns {Promise<{status:'created'|'relinked'|'already-linked'|'invalid'|'conflict'|'error'|'link-failed',
     *                    uid?:string, email?:string, reason?:string}>}
     * Toplu işi durdurması gereken hatalarda ProvisioningStop fırlatır ('rate-limited' | 'signup-disabled').
     */
    async function provisionOne(person, provisioner, link, { now = Date.now } = {}) {
        if (person && person.uid) return { status: 'already-linked', uid: person.uid };
        const email = staffEmail(person && person.id);
        const password = staffPassword(person && person.code);
        if (!email || !password) return { status: 'invalid', reason: !email ? 'id e-postaya çevrilemiyor' : 'giriş kodu yok ya da kısa' };

        let uid, status;
        try {
            uid = await provisioner.createAccount(email, password);
            status = 'created';
        } catch (e) {
            const c = errCode(e);
            if (RATE_LIMIT.includes(c)) throw new ProvisioningStop('rate-limited', 'Firebase hesap açma kotası doldu; bir süre sonra kaldığı yerden devam edin.');
            if (SIGNUP_CLOSED.includes(c)) throw new ProvisioningStop('signup-disabled', 'Firebase Console\'da e-posta/parola ile hesap oluşturma kapalı (Authentication → Settings → User actions).');
            if (c !== 'email-already-in-use') return { status: 'error', email, reason: c || (e && e.message) || 'bilinmeyen hata' };
            // Hesap zaten var (önceki koşuda açılmış, bağlama düşmüş olabilir): aynı parolayla girip uid'i al
            try {
                uid = await provisioner.findAccount(email, password);
                status = 'relinked';
            } catch (e2) {
                const c2 = errCode(e2);
                if (RATE_LIMIT.includes(c2)) throw new ProvisioningStop('rate-limited', 'Firebase giriş deneme kotası doldu; bir süre sonra devam edin.');
                if (WRONG_PASSWORD.includes(c2)) {
                    return { status: 'conflict', email, reason: 'hesap var ama parolası güncel giriş koduyla eşleşmiyor (kod değişmiş olabilir); yerel firebase-admin betiğiyle sıfırlanmalı' };
                }
                return { status: 'error', email, reason: c2 || (e2 && e2.message) || 'bilinmeyen hata' };
            }
        }
        try {
            await link(person, { uid, authEmail: email, authProvisionedAt: now() });
        } catch (e) {
            return { status: 'link-failed', uid, email, reason: (e && (e.code || e.message)) || 'bağlama yazılamadı' };
        }
        return { status, uid, email };
    }

    /**
     * Eksik hesapları sırayla açar. Kota/kapalı sign-up'ta durur; kalanlar bir sonraki koşuda açılır.
     * @returns {Promise<{plan, results:{id, status, email?, reason?}[], counts:object, stopped:null|{code, message}, remaining:number}>}
     */
    async function provisionMissing(personel, provisioner, link, { onProgress, now } = {}) {
        const plan = planProvisioning(personel);
        const results = [];
        let stopped = null;
        for (let i = 0; i < plan.toCreate.length; i++) {
            const { person } = plan.toCreate[i];
            try {
                const r = await provisionOne(person, provisioner, link, { now });
                results.push({ id: String(person.id), ...r });
            } catch (e) {
                if (e && e.name === 'ProvisioningStop') { stopped = { code: e.code, message: e.message }; break; }
                results.push({ id: String(person.id), status: 'error', reason: (e && e.message) || 'bilinmeyen hata' });
            }
            if (onProgress) onProgress(i + 1, plan.toCreate.length);
        }
        const counts = {};
        results.forEach(r => { counts[r.status] = (counts[r.status] || 0) + 1; });
        return { plan, results, counts, stopped, remaining: plan.toCreate.length - results.length };
    }

    /**
     * Faz 4B · J7.5 — personelin giriş kodunu değiştirir ve (hesabı varsa) Auth parolasını aynı koda taşır. Admin SDK yok:
     * ikincil örnekte ESKİ parolayla girilir → updatePassword → signOut. Sıra: önce Auth, sonra personel kaydı; kayıt
     * yazılamazsa parola eskiye geri alınır. Yarıda kalmış bir değişiklik (parola yeni, kayıt eski) yeniden çalıştırılınca
     * parola yeni kodla doğrulanır ve yalnız kayıt tamamlanır (idempotent).
     * @param {Function} write  (person, fields) → Promise  — fields: { code } (+ hesap ilk kez bulunduysa uid/authEmail)
     * @returns {Promise<{status:'changed'|'changed-code-only'|'invalid'|'auth-out-of-sync'|'write-failed'|'error',
     *                    uid?:string, email?:string, reverted?:boolean, reason?:string}>}
     * Kotada ProvisioningStop('rate-limited') fırlatır.
     */
    async function changeStaffCode(person, newCode, provisioner, write, { now = Date.now } = {}) {
        const email = staffEmail(person && person.id);
        const oldPw = staffPassword(person && person.code);
        const code = normCode(newCode);
        const newPw = staffPassword(code);
        if (!newPw) return { status: 'invalid', reason: 'yeni giriş kodu geçersiz' };
        if (!email) return { status: 'invalid', reason: 'id e-postaya çevrilemiyor' };

        let uid = person.uid || null, authUpdated = false;
        const outOfSync = { status: 'auth-out-of-sync', email, reason: 'giriş hesabının parolası mevcut kodla da yeni kodla da eşleşmiyor; değişiklik yapılmadı (yerel firebase-admin betiğiyle sıfırlanmalı)' };
        const stopIfRate = c => { if (RATE_LIMIT.includes(c)) throw new ProvisioningStop('rate-limited', 'Firebase giriş deneme kotası doldu; bir süre sonra devam edin.'); };
        try {
            if (!oldPw) throw Object.assign(new Error('eski kod parola üretmiyor'), { code: 'auth/invalid-credential' });
            uid = await provisioner.changePassword(email, oldPw, newPw);
            authUpdated = true;
        } catch (e) {
            const c = errCode(e);
            stopIfRate(c);
            if (!WRONG_PASSWORD.includes(c)) return { status: 'error', email, reason: c || (e && e.message) || 'bilinmeyen hata' };
            // Eski parola tutmadı: ya önceki yarım koşuda parola zaten yeni koda geçti, ya da hesap yok
            try {
                uid = await provisioner.findAccount(email, newPw);
                authUpdated = true;
            } catch (e2) {
                const c2 = errCode(e2);
                stopIfRate(c2);
                if (!WRONG_PASSWORD.includes(c2)) return { status: 'error', email, reason: c2 || (e2 && e2.message) || 'bilinmeyen hata' };
                if (person.uid) return outOfSync;   // bağlı hesap var ama iki parolayla da girilemiyor
                uid = null;                          // hesap yok: yalnız kod değişir (hesap sonra yeni kodla açılır)
            }
        }

        const fields = { code };
        if (authUpdated && !person.uid) Object.assign(fields, { uid, authEmail: email, authProvisionedAt: now() });
        try {
            await write(person, fields);
        } catch (e) {
            const reason = (e && (e.code || e.message)) || 'kayıt yazılamadı';
            if (!authUpdated) return { status: 'write-failed', email, reverted: true, reason };
            try {
                await provisioner.changePassword(email, newPw, oldPw);
                return { status: 'write-failed', email, reverted: true, reason };
            } catch (_) {
                return { status: 'write-failed', email, reverted: false, reason: `${reason} — hesap parolası yeni koda geçti, personel kaydı eski kodda kaldı; aynı yeni kodla tekrar uygulayın` };
            }
        }
        return { status: authUpdated ? 'changed' : 'changed-code-only', uid: uid || undefined, email };
    }

    // ─── Firebase bağdaştırıcısı (ikincil app örneği) ────────────────────────────────────────────────
    /**
     * fns: { initializeApp, getApps, initializeAuth, inMemoryPersistence, connectAuthEmulator,
     *        createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, updatePassword }
     *        — tarayıcıda CDN modülü, testte npm 'firebase'.
     * options: ana uygulamanın Firebase yapılandırması. emulatorUrl: yalnız emülatör modunda.
     */
    function createAuthProvisioner({ fns, options, emulatorUrl = null, name = PROVISIONER_APP }) {
        let auth = null;
        const getAuthOnce = () => {
            if (auth) return auth;
            const app = (fns.getApps ? fns.getApps().find(a => a.name === name) : null) || fns.initializeApp(options, name);
            // Bellek içi kalıcılık: ikincil oturum tarayıcı depolamasına yazılmaz, sekmeler arası sızmaz, ana oturumu ezmez.
            auth = fns.initializeAuth(app, { persistence: fns.inMemoryPersistence });
            if (emulatorUrl) fns.connectAuthEmulator(auth, emulatorUrl, { disableWarnings: true });
            return auth;
        };
        const withSession = async fn => {
            const a = getAuthOnce();
            try { return await fn(a); } finally { try { await fns.signOut(a); } catch (_) { /* yoksay */ } }
        };
        return {
            createAccount: (email, password) => withSession(async a => (await fns.createUserWithEmailAndPassword(a, email, password)).user.uid),
            findAccount: (email, password) => withSession(async a => (await fns.signInWithEmailAndPassword(a, email, password)).user.uid),
            // J7.5: eski parolayla taze giriş (updatePassword "yakın zamanda giriş" ister) → yeni parola → signOut
            changePassword: (email, oldPassword, newPassword) => withSession(async a => {
                const cred = await fns.signInWithEmailAndPassword(a, email, oldPassword);
                await fns.updatePassword(cred.user, newPassword);
                return cred.user.uid;
            }),
            get auth() { return getAuthOnce(); },
        };
    }

    // ─── Arayüz yardımcıları (personel ekleme/düzenleme akışları) ────────────────────────────────────
    /** provisionOne / provisionStaffAccount sonucu → kullanıcı mesajı. Kod/parola hiçbir mesaja girmez. */
    function describe(r) {
        const retry = ' VIP → "Auth Göç Aracı" ile tekrar denenebilir.';
        switch (r && r.status) {
            case 'created': return { ok: true, text: 'Giriş hesabı açıldı.' };
            case 'relinked': return { ok: true, text: 'Var olan giriş hesabı bağlandı.' };
            case 'already-linked': return { ok: true, text: 'Giriş hesabı zaten bağlı.' };
            case 'invalid': return { ok: false, text: `Giriş hesabı açılmadı: ${r.reason}.` };
            case 'conflict': return { ok: false, text: 'Giriş hesabı açılmadı: bu personel için hesap zaten var ama parolası güncel kodla eşleşmiyor (yönetici sıfırlaması gerekir).' };
            case 'stopped': return { ok: false, text: `Giriş hesabı açılmadı: ${r.reason}${retry}` };
            case 'link-failed': return { ok: false, text: `Giriş hesabı açıldı ama personel kaydına bağlanamadı.${retry}` };
            default: return { ok: false, text: `Giriş hesabı açılamadı (${(r && r.reason) || 'bilinmeyen hata'}).${retry}` };
        }
    }

    /** Personel kaydedildikten sonra çağrılır; hata fırlatmaz (personel kaydı hesap açılamasa da geçerlidir). */
    async function provisionWithNotice(person) {
        if (typeof window.provisionStaffAccount !== 'function') return { ok: false, text: 'Giriş hesabı açılamadı (modül yüklenmedi). VIP → "Auth Göç Aracı" ile açılabilir.' };
        try {
            return describe(await window.provisionStaffAccount(person));
        } catch (e) {
            return describe({ status: 'error', reason: (e && (e.code || e.message)) || 'bilinmeyen hata' });
        }
    }

    const StaffProvisioning = {
        STAFF_EMAIL_DOMAIN, PASSWORD_PAD, MIN_CODE_LENGTH, PROVISIONER_APP, ProvisioningStop,
        staffEmail, staffPassword, isStaffEmail, planProvisioning, provisionOne, provisionMissing, createAuthProvisioner,
        describe, provisionWithNotice, changeStaffCode,
    };
    window.AppModules = window.AppModules || {};
    window.AppModules.StaffProvisioning = StaffProvisioning;
    window.StaffProvisioning = StaffProvisioning;
})();
