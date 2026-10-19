/**
 * services/staff-provisioning.js — Personel Firebase Auth hesapları ve kurumsal kimlik (PRI) (Faz 4B · J7 → J10 PRI revizyonu)
 * Klasik script; iki sayfada <head>'de schema.js'ten sonra. firebase-handler.js Auth fonksiyonlarını enjekte eder ve
 * window.provisionStaffAccount / window.planStaffAccounts / window.applyStaffAccounts köprülerini açar.
 *
 * [WHY]: Aşama B'de her personel kendi Firebase Auth hesabıyla girer; kurallar kimliği uid ile tanır. J10'un ilk sürümündeki
 *        oturumsuz "adını seç" listesi (giriş rehberi) KVKK ve kullanım açısından iptal edildi: personel giriş ekranında yalnız
 *        kurumsal kimliğini (PRI, ör. ayse.yilmaz) ve kodunu yazar; giriş veritabanına hiç bakmadan Auth'a gider.
 *        Admin panelinden ana Auth örneğiyle createUserWithEmailAndPassword çağrılırsa Firebase yeni hesapla OTURUM AÇAR — admin
 *        oturumu düşer.
 * [HOW]: - PRI     : addan üretilir (generateStaffPri): Türkçe harfler arındırılır, küçük harf; iki kelime → ad.soyad, daha fazla
 *                    → ilk.son; başka personelde varsa sonuna artan numara (ayse.yilmaz2). Yönetici hesap açılana kadar düzenler.
 *        - E-posta : <pri>@staff.medipol.local (sentetik, doğrulanmaz). Giriş ekranı adresi PRI'dan kurar.
 *        - Parola  : giriş kodu (kırpılmış, büyük/küçük harf duyarlı) + sabit dolgu. Dolgu GİZLİ DEĞİLDİR (istemci kodunda);
 *                    yalnız Firebase'in ≥ 6 karakter kuralını sağlar. Güvenlik kodun kendisinden gelir.
 *        - Hesap açma yalnız İKİNCİL bir app örneğinde ('provisioner', bellek içi kalıcılık): admin oturumu (ana örnek) hiç
 *          etkilenmez; ikincil örnek her işlemden sonra signOut eder, tarayıcı depolamasına hiçbir şey yazmaz.
 *        - Bağlama : önce kuralların kimlik eşlemesi (staffAccounts/{uid} → personelId, pri), sonra personel.uid / authEmail / pri.
 *                    Bağlama düşerse yeniden çalıştırma hesabı "zaten var" bulur, aynı parolayla uid'i alıp bağlar (idempotent).
 *        - J7 hesabı (p<id>@…, PRI öncesi): uid KORUNARAK e-postası PRI adresine taşınır (yeni hesap açılsaydı uid değişir, J9
 *                    sahiplik alanları sahipsiz kalırdı). Eski kod gerekir → Kod Temizliğinden ÖNCE.
 *        - Kota    : Firebase istemci tarafı hesap açmayı IP başına sınırlar; 'too-many-requests'te toplu iş DURUR ve kalan
 *                    sayıyı bildirir (yarım kalan iş sonra kaldığı yerden devam eder — açılmış olanlar bağlıdır).
 *        Saf çekirdek window'a ve Firebase'e dokunmaz → tests/unit/staff-provisioning.test.mjs; gerçek Auth:
 *        tests/integration/staff-provisioning.emu.test.mjs.
 */
(function () {
    const STAFF_EMAIL_DOMAIN = 'staff.medipol.local';
    const PASSWORD_PAD = 'Mdp!';
    const MIN_CODE_LENGTH = 4;          // kod + 4 karakter dolgu ≥ 8 (Firebase alt sınırı 6)
    const PROVISIONER_APP = 'provisioner';
    const PRI_MAX_BASE = 40;            // üretilen PRI tabanı; e-posta yerel kısmı en fazla 64
    const PRI_RE = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;   // firestore.rules isStaff deseniyle aynı

    class ProvisioningStop extends Error {
        constructor(code, message) { super(message); this.name = 'ProvisioningStop'; this.code = code; }
    }
    const blank = v => v === undefined || v === null || String(v).trim() === '';

    // ─── Kurumsal kimlik (PRI) ─────────────────────────────────────────────────────────────────────────
    const TR_FOLD = { 'ç': 'c', 'Ç': 'c', 'ğ': 'g', 'Ğ': 'g', 'ı': 'i', 'I': 'i', 'İ': 'i', 'ö': 'o', 'Ö': 'o', 'ş': 's', 'Ş': 's',
        'ü': 'u', 'Ü': 'u', 'â': 'a', 'Â': 'a', 'î': 'i', 'Î': 'i', 'û': 'u', 'Û': 'u' };
    /** Türkçe harfleri ASCII karşılığına indirir, diğer aksanları atar, küçük harfe çevirir ("İ".toLowerCase() tuzağı yok). */
    function foldTr(s) {
        return String(s === undefined || s === null ? '' : s)
            .replace(/[çÇğĞıIİöÖşŞüÜâÂîÎûÛ]/g, ch => TR_FOLD[ch])
            .normalize('NFD').replace(/[̀-ͯ]/g, '')
            .toLowerCase();
    }
    /** Girilen PRI → karşılaştırılabilir biçim (giriş ekranı ve doğrulama aynı normalizasyonu kullanır). */
    const normalizePri = s => foldTr(s).trim();
    /** Normalize edilmiş PRI geçerli mi (a-z, 0-9; parçalar arasında . _ -; ≤ 64). */
    const isValidPri = pri => typeof pri === 'string' && pri.length > 0 && pri.length <= 64 && PRI_RE.test(pri);

    /** Addan PRI tabanı: iki kelime → ad.soyad; daha fazla → ilk.son; tek kelime → kendisi. */
    function priBase(name) {
        const words = foldTr(name).split(/\s+/).map(w => w.replace(/[^a-z0-9]/g, '')).filter(Boolean);
        if (!words.length) return '';
        const base = words.length === 1 ? words[0] : `${words[0]}.${words[words.length - 1]}`;
        return base.slice(0, PRI_MAX_BASE).replace(/[._-]+$/, '');
    }

    /**
     * Addan tekil PRI üretir. taken: kullanılan PRI'lar (dizi / Set). Çakışmada sonuna 2, 3, … eklenir (ayse.yilmaz2).
     * Ad PRI'ya çevrilemiyorsa (ör. yalnız noktalama) taban "personel".
     */
    function generateStaffPri(name, taken = []) {
        const used = new Set([...taken].map(normalizePri).filter(Boolean));
        const base = priBase(name) || 'personel';
        if (!used.has(base)) return base;
        for (let n = 2; ; n++) { if (!used.has(base + n)) return base + n; }
    }

    /** Personel listesindeki PRI'lar (düzenlenen kişi hariç). */
    const takenPris = (personel, exceptId) => (personel || [])
        .filter(p => p && !blank(p.pri) && (exceptId === undefined || exceptId === null || String(p.id) !== String(exceptId)))
        .map(p => normalizePri(p.pri));

    /** Yöneticinin girdiği PRI'yi doğrular: biçim + tekillik. Dönen value normalize edilmiş PRI'dır. */
    function validatePri(input, personel, exceptId) {
        const value = normalizePri(input);
        if (!value) return { ok: false, value, message: 'Kurumsal kimlik (PRI) boş olamaz.' };
        if (!isValidPri(value)) return { ok: false, value, message: 'Kurumsal kimlik yalnız a-z, 0-9 ve parçalar arasında . _ - içerebilir (ör. ayse.yilmaz).' };
        const other = (personel || []).find(p => p && !blank(p.pri) && normalizePri(p.pri) === value
            && (exceptId === undefined || exceptId === null || String(p.id) !== String(exceptId)));
        if (other) return { ok: false, value, message: `Bu kurumsal kimlik başka bir personelde kayıtlı (${other.name || other.adSoyad || '-'}).` };
        return { ok: true, value };
    }

    // ─── E-posta ve parola ─────────────────────────────────────────────────────────────────────────────
    /** PRI → hesap e-postası; geçersizse null. */
    function staffEmail(pri) {
        const p = normalizePri(pri);
        return isValidPri(p) ? `${p}@${STAFF_EMAIL_DOMAIN}` : null;
    }
    /** Personel kaydının beklenen hesap e-postası (PRI'dan). Sahiplik / kod temizliği tutarlılık denetimi bunu kullanır. */
    const accountEmailOf = person => staffEmail(person && person.pri);

    // UTF-8 onaltılık (TextEncoder'a bağlı kalmadan): encodeURIComponent'in %XX'leri + kaçışsız ASCII karakterlerin kodu.
    const utf8Hex = s => encodeURIComponent(s).replace(/%([0-9A-F]{2})|[\s\S]/g, (m, h) => (h ? h.toLowerCase() : m.charCodeAt(0).toString(16).padStart(2, '0')));
    /** J7 (PRI öncesi) hesap e-postası: p<personelId>@… — yalnız eski hesapları tanıyıp taşımak için. */
    function legacyStaffEmail(personelId) {
        const id = personelId === undefined || personelId === null ? '' : String(personelId).trim();
        if (!id) return null;
        const local = /^[a-z0-9_-]+$/.test(id) ? `p${id}` : `p.${utf8Hex(id)}`;
        return local.length > 64 ? null : `${local}@${STAFF_EMAIL_DOMAIN}`;
    }

    // Girişteki normalizasyonla birebir (auth-engine completeStaffLogin: girilen kod → staffPassword → Firebase Auth).
    const normCode = code => (code === undefined || code === null ? '' : String(code).trim());

    /** Giriş kodu → hesap parolası; kod yok ya da MIN_CODE_LENGTH'ten kısaysa null. */
    function staffPassword(code) {
        const c = normCode(code);
        return c.length >= MIN_CODE_LENGTH ? c + PASSWORD_PAD : null;
    }

    const isStaffEmail = email => typeof email === 'string' && email.toLowerCase().endsWith('@' + STAFF_EMAIL_DOMAIN);

    const errCode = e => String((e && e.code) || '').replace(/^auth\//, '');
    const RATE_LIMIT = ['too-many-requests', 'quota-exceeded'];
    const SIGNUP_CLOSED = ['admin-restricted-operation', 'operation-not-allowed'];
    const WRONG_PASSWORD = ['wrong-password', 'invalid-credential', 'invalid-login-credentials', 'user-not-found'];

    // ─── Hesap açma (tek personel) ──────────────────────────────────────────────────────────────────────
    /**
     * Tek personel için <pri>@ hesabını açar (ya da var olanı bulur) ve bağlar.
     * @param {object} person                 { id, pri, uid?, code? }
     * @param {{createAccount:Function, findAccount:Function}} provisioner  (email, password) → uid
     * @param {Function} link                 (person, { uid, authEmail, pri, authProvisionedAt }) → Promise
     * @param {{now?:Function, code?:string}} [opts]  code: yöneticinin verdiği yeni kod (verilmezse eski kayıttaki kod)
     * @returns {Promise<{status:'created'|'relinked'|'already-linked'|'invalid'|'conflict'|'error'|'link-failed',
     *                    uid?:string, email?:string, reason?:string}>}
     * Toplu işi durdurması gereken hatalarda ProvisioningStop fırlatır ('rate-limited' | 'signup-disabled').
     */
    async function provisionOne(person, provisioner, link, { now = Date.now, code } = {}) {
        if (person && person.uid) return { status: 'already-linked', uid: person.uid };
        const pri = normalizePri(person && person.pri);
        const email = staffEmail(pri);
        const password = staffPassword(code !== undefined ? code : (person && person.code));
        if (!email || !password) return { status: 'invalid', reason: !email ? 'kurumsal kimlik (PRI) yok ya da geçersiz' : 'giriş kodu yok ya da kısa' };

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
                    return { status: 'conflict', email, reason: 'bu kurumsal kimlikle (PRI) Firebase\'de parolası farklı bir hesap var — PRI\'yi değiştirin ya da hesap yerel firebase-admin betiğiyle sıfırlanmalı' };
                }
                return { status: 'error', email, reason: c2 || (e2 && e2.message) || 'bilinmeyen hata' };
            }
        }
        try {
            await link(person, { uid, authEmail: email, pri, authProvisionedAt: now() });
        } catch (e) {
            return { status: 'link-failed', uid, email, reason: (e && (e.code || e.message)) || 'bağlama yazılamadı' };
        }
        return { status, uid, email };
    }

    /**
     * J7 hesabının (p<id>@) e-postasını uid'yi koruyarak PRI adresine taşır ve bağlar. Eski kod gerekir.
     * @returns {Promise<{status:'moved'|'conflict'|'error'|'link-failed'|'invalid', uid?, email?, reason?}>}
     * Kota / e-posta değişikliğinin projede kapalı olması → ProvisioningStop ('rate-limited' | 'email-change-blocked').
     */
    async function moveLegacyAccount(person, provisioner, link, { now = Date.now, code } = {}) {
        const pri = normalizePri(person && person.pri);
        const to = staffEmail(pri);
        const from = String((person && person.authEmail) || '').trim().toLowerCase() || legacyStaffEmail(person && person.id);
        const password = staffPassword(code !== undefined ? code : (person && person.code));
        if (!to || !from || !password || !person.uid) return { status: 'invalid', reason: !to ? 'kurumsal kimlik (PRI) yok ya da geçersiz' : 'eski hesap ya da giriş kodu yok' };
        let uid;
        try {
            uid = await provisioner.moveAccount(from, password, to, { expectUid: String(person.uid) });
        } catch (e) {
            const c = errCode(e);
            if (c === 'uid-mismatch') return { status: 'conflict', email: from, reason: 'eski e-postadaki hesap bu personele bağlı hesap değil (taşınmadı)' };
            if (RATE_LIMIT.includes(c)) throw new ProvisioningStop('rate-limited', 'Firebase deneme kotası doldu; bir süre sonra kaldığı yerden devam edin.');
            if (c === 'operation-not-allowed' || c === 'requires-recent-login') {
                throw new ProvisioningStop('email-change-blocked', 'Firebase bu projede doğrulamasız e-posta değişikliğine izin vermiyor (Authentication → Settings → "Email enumeration protection"). Kapatın ya da hesaplar yerel firebase-admin betiğiyle taşınmalı.');
            }
            if (c === 'email-already-in-use') return { status: 'conflict', email: to, reason: 'PRI adresinde başka bir hesap var — bu personel için farklı bir PRI seçin' };
            if (WRONG_PASSWORD.includes(c)) return { status: 'conflict', email: from, reason: 'eski hesabın parolası kayıttaki kodla eşleşmiyor' };
            return { status: 'error', email: to, reason: c || (e && e.message) || 'bilinmeyen hata' };
        }
        if (String(uid) !== String(person.uid)) return { status: 'conflict', email: from, reason: 'eski e-postadaki hesap bu personele bağlı hesap değil' };
        try {
            await link(person, { uid, authEmail: to, pri, authProvisionedAt: now() });
        } catch (e) {
            return { status: 'link-failed', uid, email: to, reason: (e && (e.code || e.message)) || 'bağlama yazılamadı' };
        }
        return { status: 'moved', uid, email: to };
    }

    // ─── PRI / hesap göç planı (VIP aracı) ─────────────────────────────────────────────────────────────
    // Önizleme ile uygulama arasında personel listesi değişti mi? (ad, PRI, hesap bağı, kodun varlığı — kodun kendisi değil)
    const accountsFingerprint = personel => (personel || []).filter(p => p && !blank(p.id))
        .map(p => JSON.stringify([String(p.id), foldTr(p.name || p.adSoyad || ''), normalizePri(p.pri), blank(p.uid) ? '' : String(p.uid),
            String(p.authEmail || '').toLowerCase(), !blank(p.code)]))
        .sort().join('\n');

    /**
     * Önizleme (SAF — yazmaz). Her personel için atanacak PRI ve hesap işlemi:
     *   ok        hesap PRI adresinde (yalnız kuralların kimlik eşlemesi yenilenir)
     *   create    hesap yok, kayıtta eski kod var → <pri>@ hesabı açılır
     *   move      J7 hesabı (p<id>@) → uid korunarak PRI adresine taşınır (eski kod gerekir)
     *   no-code   hesap yok, kod yok → yalnız PRI yazılır; hesap personel tablosundan "Hesap Aç" ile (yeni kod)
     *   blocked   bağ tutarsız (paylaşılan uid, tanınmayan e-posta) ya da eski hesabın kodu yok → dokunulmaz, raporlanır
     * PRI: geçerli ve tekil olan korunur (hesabı PRI adresinde olanlar önce ayrılır); eksik / geçersiz / çakışan için üretilir.
     * Satırlar kod içermez.
     */
    function planAccounts(personel) {
        const list = (personel || []).filter(p => p && typeof p === 'object' && !blank(p.id));
        const uidCount = new Map();
        list.forEach(p => { if (!blank(p.uid)) uidCount.set(String(p.uid), (uidCount.get(String(p.uid)) || 0) + 1); });
        const used = new Set(), keep = new Map();
        const reserve = p => { const v = normalizePri(p.pri); if (isValidPri(v) && !used.has(v)) { used.add(v); keep.set(String(p.id), v); } };
        list.filter(p => !blank(p.uid) && String(p.authEmail || '').toLowerCase() === staffEmail(p.pri)).forEach(reserve);
        list.forEach(p => { if (!keep.has(String(p.id))) reserve(p); });
        const rows = [];
        list.forEach(p => {
            const id = String(p.id);
            let pri = keep.get(id);
            if (!pri) { pri = generateStaffPri(p.name || p.adSoyad, used); used.add(pri); }
            const target = staffEmail(pri);
            const email = String(p.authEmail || '').trim().toLowerCase();
            const hasCode = !!staffPassword(p.code);
            let action, reason = null;
            if (!blank(p.uid)) {
                if (uidCount.get(String(p.uid)) > 1) { action = 'blocked'; reason = 'aynı giriş hesabı birden fazla personele bağlı'; }
                else if (email === target) action = 'ok';
                else if (email === legacyStaffEmail(p.id) || (!email && hasCode)) {
                    if (hasCode) action = 'move';
                    else { action = 'blocked'; reason = 'eski (J7) hesap taşınamıyor: kayıtta giriş kodu yok — yerel firebase-admin betiği gerekir'; }
                } else { action = 'blocked'; reason = 'hesap e-postası tanınmıyor (PRI adresi de J7 adresi de değil)'; }
            } else action = hasCode ? 'create' : 'no-code';
            rows.push({ id, name: p.name || p.adSoyad || '-', pri, priChange: p.pri !== pri, action, reason });
        });
        const counts = { total: rows.length, ok: 0, create: 0, move: 0, 'no-code': 0, blocked: 0, priWrites: 0 };
        rows.forEach(r => { counts[r.action]++; if (r.priChange) counts.priWrites++; });
        return { rows, counts, fingerprint: accountsFingerprint(list) };
    }

    /**
     * Planı uygular (sırayla). personelById: TAZE personel kayıtları (çağıran sunucudan okur). Kota / kapalı özelliklerde durur.
     * @returns {Promise<{results:{id, action, status, email?, reason?}[], counts:object, stopped:null|{code,message}, remaining:number}>}
     */
    async function applyAccounts(plan, personelById, provisioner, link, { writePri, onProgress, now } = {}) {
        // Tutarsız bağa dokunulmaz; hesapsız ve PRI'si zaten doğru kayıtta yapılacak iş yok.
        const todo = plan.rows.filter(r => r.action !== 'blocked' && !(r.action === 'no-code' && !r.priChange));
        const results = [];
        let stopped = null;
        for (let i = 0; i < todo.length; i++) {
            const row = todo[i];
            const fresh = personelById.get(row.id);
            const person = fresh && { ...fresh, id: row.id, pri: row.pri };
            try {
                let r;
                if (!fresh) r = { status: 'skipped', reason: 'personel kaydı bulunamadı' };
                else if (row.action === 'create') r = await provisionOne(person, provisioner, link, { now });
                else if (row.action === 'move') r = await moveLegacyAccount(person, provisioner, link, { now });
                else if (row.action === 'ok') { await link(person, { uid: person.uid, authEmail: staffEmail(row.pri), pri: row.pri }); r = { status: 'ok' }; }
                else { if (row.priChange) await writePri(person, row.pri); r = { status: row.priChange ? 'pri-written' : 'unchanged' }; }
                results.push({ id: row.id, action: row.action, ...r });
            } catch (e) {
                if (e && e.name === 'ProvisioningStop') { stopped = { code: e.code, message: e.message }; break; }
                results.push({ id: row.id, action: row.action, status: 'error', reason: (e && (e.code || e.message)) || 'bilinmeyen hata' });
            }
            if (onProgress) onProgress(i + 1, todo.length);
        }
        const counts = {};
        results.forEach(r => { counts[r.status] = (counts[r.status] || 0) + 1; });
        return { results, counts, stopped, remaining: todo.length - results.length };
    }

    // ─── Firebase bağdaştırıcısı (ikincil app örneği) ────────────────────────────────────────────────
    /**
     * fns: { initializeApp, getApps, initializeAuth, inMemoryPersistence, connectAuthEmulator,
     *        createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, updateEmail }
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
            // J7 → PRI: eski e-postayla girip e-postayı değiştirir; uid aynı kalır. Beklenen uid verilmişse ve tutmuyorsa
            // e-posta DEĞİŞTİRİLMEDEN 'uid-mismatch' fırlatır (başka bir hesap yanlışlıkla taşınmasın).
            moveAccount: (fromEmail, password, toEmail, { expectUid } = {}) => withSession(async a => {
                const cred = await fns.signInWithEmailAndPassword(a, fromEmail, password);
                if (expectUid && String(cred.user.uid) !== String(expectUid)) throw Object.assign(new Error('uid-mismatch'), { code: 'uid-mismatch' });
                await fns.updateEmail(cred.user, toEmail);
                return cred.user.uid;
            }),
            get auth() { return getAuthOnce(); },
        };
    }

    // ─── Arayüz yardımcıları (personel ekleme/düzenleme akışları) ────────────────────────────────────
    /** provisionOne / provisionStaffAccount sonucu → kullanıcı mesajı. Kod/parola hiçbir mesaja girmez. */
    function describe(r) {
        const retry = ' VIP → "PRI / Hesap Göç Aracı" ile tekrar denenebilir.';
        switch (r && r.status) {
            case 'created': return { ok: true, text: 'Giriş hesabı açıldı.' };
            case 'relinked': return { ok: true, text: 'Var olan giriş hesabı bağlandı.' };
            case 'already-linked': return { ok: true, text: 'Giriş hesabı zaten bağlı.' };
            case 'invalid': return { ok: false, text: `Giriş hesabı açılmadı: ${r.reason}.` };
            case 'conflict': return { ok: false, text: `Giriş hesabı açılmadı: ${r.reason || 'bu kurumsal kimlikle başka bir hesap var'}.` };
            case 'stopped': return { ok: false, text: `Giriş hesabı açılmadı: ${r.reason}${retry}` };
            // Hesap bu kodla AÇILDI: kod kaybolursa yeniden bağlanamaz → çağıran kodu yine bir kez gösterir; "Hesap Aç" + aynı kod bağlar
            case 'link-failed': return { ok: false, linkFailed: true, text: `Giriş hesabı açıldı ama personel kaydına bağlanamadı (${(r && r.reason) || 'yazma reddedildi'}). Bu kodu saklayın: personel tablosunda "Hesap Aç"a basıp AYNI kodu girerek yeniden bağlayın.` };
            default: return { ok: false, text: `Giriş hesabı açılamadı (${(r && r.reason) || 'bilinmeyen hata'}).${retry}` };
        }
    }

    /** Personel kaydedildikten sonra çağrılır; hata fırlatmaz (personel kaydı hesap açılamasa da geçerlidir). */
    async function provisionWithNotice(person, code) {
        if (typeof window.provisionStaffAccount !== 'function') return { ok: false, text: 'Giriş hesabı açılamadı (modül yüklenmedi). Personel tablosundan "Hesap Aç" ile açılabilir.' };
        try {
            return describe(await window.provisionStaffAccount(person, { code }));
        } catch (e) {
            // Kurallar J10 değilse (firebase-handler._requireStaffRules) açıklayıcı mesaj gösterilir; diğerlerinde hata kodu
            return describe({ status: 'error', reason: (e && (e.code === 'rules-not-deployed' ? e.message : (e.code || e.message))) || 'bilinmeyen hata' });
        }
    }

    const StaffProvisioning = {
        STAFF_EMAIL_DOMAIN, PASSWORD_PAD, MIN_CODE_LENGTH, PROVISIONER_APP, PRI_RE, ProvisioningStop,
        foldTr, normalizePri, isValidPri, priBase, generateStaffPri, takenPris, validatePri,
        staffEmail, accountEmailOf, legacyStaffEmail, staffPassword, isStaffEmail,
        provisionOne, moveLegacyAccount, planAccounts, applyAccounts, accountsFingerprint, createAuthProvisioner,
        describe, provisionWithNotice,
    };
    window.AppModules = window.AppModules || {};
    window.AppModules.StaffProvisioning = StaffProvisioning;
    window.StaffProvisioning = StaffProvisioning;
    window.generateStaffPri = generateStaffPri;
})();
