/**
 * utils/session-store.js — Oturum kimliğinin TEK kaynağı (klasik script, iki sayfada <head>'de İLK yüklenir)
 */
// [WHY]: Aynı kullanıcı dört farklı kaynaktan okunuyordu; activeUser maskeli yazılmaya başlayınca 12 okuyucu sessizce null aldı (KN-1, AUTH-01).
// [HOW]: localStorage.activeUser formatını yalnız bu dosya bilir. Herkes getActiveUser()/setActiveUser() kullanır;
//        eski maskeli ve düz JSON değerler okunur ve yeni biçime taşınır. Maskeleme güvenlik aracı değildir (K3).
(function () {
    const KEY = 'activeUser';
    const PREFIX = 'm2.';
    const MASK_SALT = 'x9k2mP@7vQ3sT1wZ';
    const ADMIN_EMAIL = 'admin@medipol.local';

    function xor(str) {
        let out = '';
        for (let i = 0; i < str.length; i++) out += String.fromCharCode(str.charCodeAt(i) ^ MASK_SALT.charCodeAt(i % MASK_SALT.length));
        return out;
    }

    // UTF-8 byte string first, so btoa never sees chars > 0xFF (Turkish names broke the old mask).
    // [WHY]: Faz 4B · J8 — oturum nesnesi personel kaydının kopyasıydı: giriş KODU da localStorage'a (maske güvenlik değil)
    //        ve window.currentUser'a gidiyordu; satın alma talebi createdBy alanıyla herkesin okuduğu belgelere taşınıyordu.
    // [HOW]: Oturuma yalnız kimlik alanları girer; code / password / token hiçbir zaman saklanmaz. Kodla eşleşen eski kayıtlar
    //        (satın alma, talep, şablon yetkisi) id ve ad yedekleriyle eşleşir (J9 uid'ye taşır).
    const SECRET_FIELDS = ['code', 'password', 'token'];
    function sanitizeUser(obj) {
        if (!obj || typeof obj !== 'object') return obj;
        const clean = { ...obj };
        SECRET_FIELDS.forEach(k => { delete clean[k]; });
        return clean;
    }

    function maskUserData(obj) {
        if (!obj || typeof obj !== 'object') return null;
        try {
            const clean = sanitizeUser(obj);
            return PREFIX + btoa(xor(unescape(encodeURIComponent(JSON.stringify(clean)))));
        } catch (e) {
            console.error('[session-store] mask failed:', e.message);
            return null;
        }
    }

    function unmaskUserData(str) {
        if (!str || typeof str !== 'string') return null;
        try {
            if (str.startsWith(PREFIX)) return JSON.parse(decodeURIComponent(escape(xor(atob(str.slice(PREFIX.length))))));
            if (str.trim().startsWith('{')) return JSON.parse(str);
            return JSON.parse(xor(atob(str)));
        } catch (e) {
            return null;
        }
    }

    function setActiveUser(user) {
        if (!user) return false;
        const clean = sanitizeUser(user);
        const masked = maskUserData(clean);
        if (!masked) return false;
        localStorage.setItem(KEY, masked);
        window.currentUser = clean;
        return true;
    }

    function getActiveUser() {
        const raw = localStorage.getItem(KEY);
        if (!raw) return null;
        const user = unmaskUserData(raw);
        if (!user || typeof user !== 'object') return null;
        // Eski biçim ya da J8 öncesi kodu taşıyan oturum → ayıklanıp yeniden yazılır (göç)
        if (!raw.startsWith(PREFIX) || SECRET_FIELDS.some(k => k in user)) { setActiveUser(user); return sanitizeUser(user); }
        return user;
    }

    function clearSession() {
        localStorage.removeItem(KEY);
        localStorage.removeItem('admin_auth');
        localStorage.removeItem('launchpadBypassed');
        sessionStorage.removeItem('adminVizesi');
        window.currentUser = null;
        setStaffAdminGrant(null, null);
    }

    function isAppLoggedIn() {
        return !!getActiveUser();
    }

    let liveAdminSession = null;

    function isPrimaryDbAdmin(user = window.userAuth) {
        return !!(user && !user.isAnonymous && user.email === ADMIN_EMAIL);
    }

    function setFirebaseAuthClaims(user, token) {
        const personId = token?.claims?.inventoryLiveAdmin;
        liveAdminSession = isStaffAccountSession(user) && token?.signInProvider === 'password'
            && typeof personId === 'string' && personId ? user : null;
    }

    // ─── İP-7 · Ana yöneticinin verdiği yönetici yetkisi (staffAccounts/{uid}.adminGranted) ─────────────────────
    // [WHY]: Kurallar ek yöneticiyi kendi eşleme belgesindeki adminGranted alanından tanır (firestore.rules isAdmin). Arayüz
    //        aynı kararı vermezse yetkili kişi "Panele Geç"i göremez ya da yetkisi alınmış kişi paneli açık tutar.
    // [HOW]: firebase-handler kendi eşlemesini sunucudan okuyup dinler ve setStaffAdminGrant'i çağırır. Yetki yalnız aynı
    //        personel oturumuna bağlıdır (oturum değişirse ya da çıkışta düşer); eşleme belgesi ortam köküne göre okunduğu için
    //        ortam başına ayrıdır (K3). Asıl kapı kurallardadır; bu yalnız arayüz kararıdır.
    let grantSession = null;
    let grantMapping = null;
    function setStaffAdminGrant(user, data) {
        const granted = !!(user && data && data.adminGranted === true && isStaffAccountSession(user));
        grantSession = granted ? user : null;
        grantMapping = granted ? {
            uid: user.uid, adminChangedBy: data.adminChangedBy || null, adminReason: data.adminReason || '', adminAuditId: data.adminAuditId || null,
        } : null;
    }
    function getStaffAdminGrant() {
        return grantSession !== null && grantSession === window.userAuth && grantMapping ? { ...grantMapping } : null;
    }

    function isDbAdmin() {
        return isPrimaryDbAdmin() || (window.AppEnv?.COLLECTION_ROOT === 'lifeserver_master'
            && liveAdminSession !== null && liveAdminSession === window.userAuth)
            || (grantSession !== null && grantSession === window.userAuth);
    }

    // İP-7 · K1: yönetici yetkisini yalnız ana yönetici hesabı verir ve geri alır; ek yöneticiler panelde salt okunur görür.
    function canManageAdmins() {
        return isPrimaryDbAdmin();
    }

    // [WHY]: Faz 4 · J1 (M1, M5) — Rules v2 personelin silme ve admin koleksiyonu yazmalarını reddediyor; birçok fonksiyon
    //        yalnız arayüzde kapılıydı (konsoldan ya da kapısız bir düğmeden çağrılınca kural reddi genel hata olarak düşüyordu).
    // [HOW]: Fonksiyonun başında tek kapı: admin oturumu değilse anlaşılır uyarı + false. İki sayfada da yüklü (auth-engine yalnız index'te).
    function requireDbAdmin(action) {
        const check = typeof window.isDbAdmin === 'function' ? window.isDbAdmin : isDbAdmin;   // tek tanım: window.isDbAdmin
        if (check()) return true;
        const msg = `🔒 ${action || 'Bu işlem'} yönetici oturumu gerektirir.`;
        if (typeof window.showAppAlert === 'function') window.showAppAlert(msg, 'error');
        return false;
    }

    // ─── Yönetici vizesi (localStorage.admin_auth) ────────────────────────────────────────────────
    // [WHY]: Faz 4 · J3 (AUTH-06, T4) — vize biçimi 5 dosyada ayrı ayrı okunup yazılıyordu; timer.js süresi DOLMUŞ vizeyi
    //        etkinlikle uzatıyordu (F5 / fare hareketi kilitli paneli canlandırıyordu).
    // [HOW]: Biçimi yalnız bu dosya bilir. Vize yetki DEĞİLDİR (yetki = isDbAdmin); yalnız admin oturumunun süresidir.
    const ADMIN_VISA_KEY = 'admin_auth';
    const adminSessionMs = () => (window.SessionConfig && window.SessionConfig.ADMIN_LOCK_TIME) || 10 * 60 * 1000;

    // Kalan süre (ms); vize yoksa ya da okunamıyorsa null. 0 veya negatif = süresi dolmuş.
    function getAdminVisaRemaining() {
        const raw = localStorage.getItem(ADMIN_VISA_KEY);
        if (!raw) return null;
        try {
            const expiry = Number(JSON.parse(raw).expiry);
            return Number.isFinite(expiry) ? expiry - Date.now() : null;
        } catch (e) {
            return null;
        }
    }

    function hasValidAdminVisa() {
        const left = getAdminVisaRemaining();
        return left !== null && left > 0;
    }

    function grantAdminVisa() {
        localStorage.setItem(ADMIN_VISA_KEY, JSON.stringify({ expiry: Date.now() + adminSessionMs() }));
    }

    // Yalnız GEÇERLİ vize uzar; süresi dolmuş ya da olmayan vize false döner (çağıran oturumu sonlandırır).
    function extendAdminVisa(ms) {
        if (!hasValidAdminVisa()) return false;
        localStorage.setItem(ADMIN_VISA_KEY, JSON.stringify({ expiry: Date.now() + (ms || adminSessionMs()) }));
        return true;
    }

    function clearAdminVisa() {
        localStorage.removeItem(ADMIN_VISA_KEY);
    }

    // [WHY]: Faz 4 · J4 (4.5 · K2, AUTH-03) — biyometrik adım kayıt akışı olmadan çalışıyordu (bir cihaz sınıfında girişi
    //        engelliyor, diğerlerinde her 5 karakteri kabul eden prompt'a düşüyordu). Bayrak auth-engine içinde ayrıca tanımlıydı.
    // [HOW]: TEK bayrak burada; auth-engine ve security-biometrics buradan okur. Gerçek WebAuthn kaydı (K2-b) bu fazda yok —
    //        sunucusuz ortamda yalnız bir UX kapısı olurdu (doğrulama sonucu istemcide, atlatılabilir).
    const ENABLE_BIOMETRIC_LOGIN = false;

    // ─── Personel giriş modu (Faz 4B · J8 → J10) ──────────────────────────────────────────────────
    // [WHY]: J8'de mod (anonim / hibrit / yalnız hesap) kademeli geçiş için ayarlanabilirdi. J10 (Aşama B kuralları) anonim
    //        oturumu ve kodla eşleşmeyi tamamen kaldırdı: kurallar yalnız personel kaydına bağlı Auth hesabını tanır.
    // [HOW]: Mod SABİT 'accounts'; system_config'teki eski staffAuthMode değeri yok sayılır (geri dönüş istemciden yapılamaz).
    const STAFF_AUTH_MODES = Object.freeze(['accounts']);
    const DEFAULT_STAFF_AUTH_MODE = 'accounts';
    const STAFF_EMAIL_DOMAIN = 'staff.medipol.local';
    function getStaffAuthMode() { return DEFAULT_STAFF_AUTH_MODE; }
    // Firebase oturumu bir personel hesabı mı (J7 sentetik e-postası, e-posta/parola)?
    function isStaffAccountSession(u = window.userAuth) {
        return !!(u && !u.isAnonymous && typeof u.email === 'string' && u.email.toLowerCase().endsWith('@' + STAFF_EMAIL_DOMAIN));
    }

    const Session = {
        ENABLE_BIOMETRIC_LOGIN,
        getActiveUser, setActiveUser, clearSession, isAppLoggedIn, isDbAdmin, isPrimaryDbAdmin, setFirebaseAuthClaims, requireDbAdmin,
        setStaffAdminGrant, getStaffAdminGrant, canManageAdmins,
        maskUserData, unmaskUserData, sanitizeUser, ADMIN_EMAIL,
        STAFF_AUTH_MODES, DEFAULT_STAFF_AUTH_MODE, getStaffAuthMode, isStaffAccountSession,
        getAdminVisaRemaining, hasValidAdminVisa, grantAdminVisa, extendAdminVisa, clearAdminVisa,
        get ADMIN_SESSION_MS() { return adminSessionMs(); },
    };

    window.AppModules = window.AppModules || {};
    window.AppModules.Session = Session;
    window.getActiveUser = getActiveUser;
    window.setActiveUser = setActiveUser;
    window.clearSession = clearSession;
    window.isAppLoggedIn = isAppLoggedIn;
    window.isDbAdmin = isDbAdmin;
    window.requireDbAdmin = requireDbAdmin;
})();
