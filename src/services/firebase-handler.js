/**
 * FIREBASE HANDLER - Medipol Envanter Takip Sistemi
 * ------------------------------------------------
 * @description Bu modül; veritabanı bağlantısı, admin yetkilendirme mimarisi 
 * ve bulut tabanlı anlık senkronizasyon (Realtime Sync) motorunu yönetir.
 * * GÜVENLİK NOTU: Admin hash'i kodun içinde değil, Firebase 'system_config' 
 * koleksiyonunda saklanır. Bu sayede manuel müdahale ile şifre sıfırlanabilir.
 */

// 1. MODÜLER FIREBASE IMPORTLARI (Versiyon 10+)
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
    initializeAuth, onAuthStateChanged, connectAuthEmulator, setPersistence,
    browserSessionPersistence, browserLocalPersistence, indexedDBLocalPersistence, inMemoryPersistence,
    createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, updateEmail
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
    initializeFirestore,
    connectFirestoreEmulator,
    collection,
    onSnapshot,
    doc,
    getDoc,
    setDoc,
    writeBatch,
    runTransaction,
    deleteField,
    getDocs,
    query,
    orderBy,
    limit,
    serverTimestamp,
    Timestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ============================================================
// [ENV_GUARD] v3.1 Environment Isolation — Kritik Mimari Blok
// [WHY]: "inventory_v2" sabitini tüm dosyaya hardcode etmek,
//        localhost veya demo URL'lerinde yapılan her testin
//        doğrudan canlı üretim verisine yazmasına neden olur.
//        v3.1 ölçeğinde (1000+ kayıt) bu yıkıcı sonuçlar doğurabilir.
// [HOW]: window.location.hostname'i sayfa yüklenirken bir kez okuyup
//        COLLECTION_ROOT sabitine bağlıyoruz. Modül kapsamında
//        değişmez (const) olduğu için runtime'da kirletilemez.
// ============================================================
// [WHY]: Hibrit ESM Geçişi — Hem import hem de window erişimini desteklemek için
//        export const kullanılıyor. Eski legacy dosyalar window.COLLECTION_ROOT'u okumaya devam eder.
// [HOW]: Sabiti önce export const ile tanımlıyoruz, ardından window'a bağlıyoruz.
//        Bu dual-exposure, COMPATIBILITY_BRIDGE kuralını uygular.
// [WHY]: Canlı deneme dönemi (28.09.2026, sahibi): canlı site eski "inventory_v2" verisine dokunmadan, temiz ve
//        yalnız canlıda kullanılan "lifeserver_master" kökünde çalışır. localhost/demo hâlâ "inventory_demo".
export const LIVE_COLLECTION_ROOT = "lifeserver_master";
export const COLLECTION_ROOT = (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname.includes('demo')
) ? "inventory_demo" : LIVE_COLLECTION_ROOT;

// [WHY]: Faz 4 · J0 (KJ-1) — Firestore kuralları proje genelinde; Rules v2'yi ve admin oturumu isteyen akışları canlıya
//        yayınlamadan uçtan uca denemek için uygulama yerel Firebase Emulator'e bağlanabilmeli.
// [HOW]: Yalnız localhost/127.0.0.1'de ve açıkça ?emu=1 ile açılır; sekme boyunca sessionStorage'da kalır (index → admin
//        geçişinde kaybolmasın), ?emu=0 kapatır. Canlı ve demo alan adlarında hiçbir koşulda devreye girmez.
const EMULATOR_HOST = '127.0.0.1';
export const EMULATOR_MODE = (() => {
    if (!['localhost', '127.0.0.1'].includes(window.location.hostname)) return false;
    const q = new URLSearchParams(window.location.search).get('emu');
    try {
        if (q === '1') sessionStorage.setItem('emu', '1');
        if (q === '0') sessionStorage.removeItem('emu');
        return sessionStorage.getItem('emu') === '1';
    } catch (e) {
        return q === '1';
    }
})();

// [ENV_GUARD] Aktif ortamı geliştirici konsoluna bildiren zorunlu init logu.
// Bu satırı hiçbir zaman kaldırma; üretimde yanlış kök aktifse anında fark edilir.
console.log(`🚀 ACTIVE DATABASE ROOT: ${COLLECTION_ROOT}${EMULATOR_MODE ? ' @ EMULATOR (' + EMULATOR_HOST + ')' : ''}`);

// [BUGFIX] Zero-Trust COLLECTION_ROOT freeze in window.AppEnv
// [WHY]: Zero-Trust rule requires that COLLECTION_ROOT must not be a bare global string to prevent console bypass.
// [HOW]: Store it in a frozen EnvConfig object exposed via window.AppEnv.
const EnvConfig = { COLLECTION_ROOT: COLLECTION_ROOT, EMULATOR: EMULATOR_MODE };
Object.freeze(EnvConfig);
window.AppEnv = EnvConfig;

// [DUAL-EXPOSURE]: Legacy modüller (admin-backup.js vb.) window.COLLECTION_ROOT'u okur.
// Bu atamayı silme — script.js gibi non-ESM dosyalar buraya bağımlıdır.
window.COLLECTION_ROOT = COLLECTION_ROOT;

const firebaseConfig = {
    apiKey: "AIzaSyCz6BzD6OAGSj0C3gl0YvinizZZncd7I-w",
    authDomain: "medipol-inventory-v3.firebaseapp.com",
    projectId: "medipol-inventory-v3",
    storageBucket: "medipol-inventory-v3.firebasestorage.app",
    messagingSenderId: "434107090128",
    appId: "1:434107090128:web:3e9b228b407a31b8190ad5"
};



/**
 * @function validateAdminAction
 * @description Kritik işlemlerde (silme, düzenleme vb.) admin doğrulaması yapar.
 * 'SecurityConfig.getAdminHash()' üzerinden dinamik (bulut tabanlı) şifre kontrolü sağlar.
 */

// [WHY]: Faz 4 · J3 (M8, T3) — kapı yalnız localStorage.admin_auth süresine bakıyordu: vize başka sekmeden kalmışsa (ya da
//        elle yazılmışsa) panel, Firebase admin oturumu olmadan açılıyordu; süresi dolan vize ise signOut etmeden index'e
//        yönlendiriyordu (admin token'ı kalıcı oturumda yaşamaya devam ediyordu). Ölü loginAsAdmin (vizeyi ayrıca yazan
//        dördüncü yol) kaldırıldı.
// [HOW]: Vize hiç yok → index.html. Vize dolmuş → endAdminSession('expired') (kilit kartı). Geçerli vize → oturum hazır
//        olunca: Firebase admin değil (yeni sekme, sekmeye bağlı oturum yok) → kilit kartı / parola; admin ama kimlik yok →
//        bayat → endAdminSession('stale').
export const checkAdminAuth = function () {
    const Session = window.AppModules.Session;
    const left = Session.getAdminVisaRemaining();

    if (left === null) {
        window.location.replace('index.html');
        return;
    }
    if (left <= 0) {
        window.SecurityConfig.endAdminSession('expired');
        return;
    }

    // J10: anonim oturum yok — oturumsuz yeni sekmede whenAuthReady hiç çözülmezdi; kilit kartı oturum durumu BELLİ olunca gösterilir.
    whenAuthKnown().then(() => {
        const S = window.SecurityConfig;
        if (S.isSignInPending()) return;
        if (!window.isDbAdmin()) {
            console.warn('🔒 [checkAdminAuth] Bu sekmede yönetici oturumu yok — parola istenecek.');
            if (typeof window.showAdminLock === 'function') window.showAdminLock('not-admin');
            return;
        }
        if (!Session.hasValidAdminVisa() || !window.getActiveUser()) S.endAdminSession('stale');
    });
};

// 3. FIREBASE VE VERİTABANI BAŞLATMA
const app = initializeApp(firebaseConfig);
// [HOW]: App nesnesini global yapıyoruz, security.js buradan alıp oturum açacak.
window.firebaseApp = app;

/**
 * @constant db
 * @description Firestore instance. 
 * experimentalForceLongPolling: 'QUIC' ve 'Network Changed' hatalarını önlemek için 
 * WebSocket yerine HTTP Long Polling kullanır. Dengesiz ağlarda çok daha kararlıdır.
 */
export const fireDb = initializeFirestore(app, {
    experimentalForceLongPolling: true,
    useFetchStreams: false
});
// Emülatör bağlantısı ilk Firestore işleminden önce kurulmalı (J0).
if (EMULATOR_MODE) connectFirestoreEmulator(fireDb, EMULATOR_HOST, 8080);

// PM NOTU: global scriptler için db window'a bağlandı
window.fireDb = fireDb;

// [WHY]: system_config kökte ortam ayrımsızdı; localhost'tan kill switch / force logout / mesaj testi canlı kullanıcıları etkiliyordu (RULE-04, VIP-05).
// [HOW]: Tüm sistem ayarları ${COLLECTION_ROOT}/system_config/items/{admin_settings|admin_messages} altında. Kural: oturumlu okur, admin yazar.
export const systemConfigRef = window.systemConfigRef = (name) => doc(fireDb, COLLECTION_ROOT, 'system_config', 'items', name);

// ─── Denetim günlüğü (Faz 4 · J4 · 4.7, KJ-7, M14) ───────────────────────────────────────────────
// [WHY]: Self-approval günlüğü sessionStorage'daydı: sekme kapanınca kayboluyor, başka cihazdan görülemiyor, kullanıcı
//        tarafından silinebiliyordu; admin.html'de hiç yazılmıyordu (EBYS-04/05).
// [HOW]: ${ROOT}/auditLogs/items — yalnız EKLEME (setDoc ile yeni id; kural update/delete'i admin dahil reddeder).
//        COLLECTIONS'a bilerek EKLENMEZ: personel okuyamaz (dinleyici izin hatası verirdi), sürekli dinleyici kota yer;
//        saveData / yedek / geri yükleme yalnız COLLECTIONS'ı yazdığı için günlüğe dokunamaz. Alanlar kuraldaki listeyle
//        birebir; metinlerde "<" görsel eşdeğeriyle değişir (kural etiketli metni reddeder, kayıt düşmesin).
const AUDIT_RESULTS = ['blocked', 'approved', 'cancelled'];
const _auditText = v => (v === undefined || v === null || v === '') ? null : String(v).replace(/</g, '‹').slice(0, 300);
export const appendAuditLog = window.appendAuditLog = async function (entry = {}) {
    const u = window.userAuth;
    if (!u) return { ok: false, code: 'no-auth' };
    if (!AUDIT_RESULTS.includes(entry.result)) return { ok: false, code: 'invalid-argument' };
    const id = 'al_' + window.makeId();
    const qty = Number(entry.qty);
    const rec = {
        id,
        type: _auditText(entry.type),
        refCol: _auditText(entry.refCol),
        refId: _auditText(entry.refId),
        item: _auditText(entry.item),
        qty: Number.isFinite(qty) ? qty : null,
        actorName: _auditText(entry.actorName),
        actorPersonelId: _auditText(entry.actorPersonelId),
        uid: u.uid,
        authKind: u.isAnonymous ? 'anonymous' : (window.isDbAdmin() ? 'admin' : 'password'),
        result: entry.result,
        reason: _auditText(entry.reason),
        page: window.location.pathname.includes('admin.html') ? 'admin' : 'index',
        ts: serverTimestamp(),
    };
    try {
        await setDoc(doc(fireDb, COLLECTION_ROOT, 'auditLogs', 'items', id), rec);
        return { ok: true, id };
    } catch (e) {
        console.error('❌ [auditLogs] Denetim kaydı yazılamadı:', e.code || e.message, rec);
        return { ok: false, code: e.code || 'write-failed' };
    }
};

// Rapor ekranı: tek seferlik okuma (sürekli dinleyici yok → kota dostu). Kural: yalnız admin okur.
export const fetchAuditLogs = window.fetchAuditLogs = async function (max = 200) {
    const snap = await getDocs(query(collection(fireDb, COLLECTION_ROOT, 'auditLogs', 'items'), orderBy('ts', 'desc'), limit(max)));
    return snap.docs.map(d => ({ _docId: d.id, ...d.data() }));
};

// [WHY]: VIP panelinden "Force Logout" (Oturumu Sonlandır) komutu verilen kullanıcının tarayıcısında çıkış yapılması.
//        Eski alan (force_logout_user_id) hiç temizlenmiyor ve zaman/tekillik kontrolü yoktu: hedef kişi sonraki her
//        admin_settings snapshot'ında (kill switch, sayfa yenileme, yeniden giriş) tekrar atılıyordu; admin kendini
//        hedeflerse sürekli kilitleniyordu (VIP-06).
// [HOW]: Komut { targetId, issuedAt, nonce } nesnesidir. Yalnız taze (FORCE_LOGOUT_TTL_MS) ve bu tarayıcıda daha önce
//        işlenmemiş (nonce) komut uygulanır; Firebase admin oturumu hiçbir zaman atılmaz. Eski alan yok sayılır.
//        Kimlik: id, giriş kodu veya ad (sistem üçünü de farklı bağlamlarda kullanıyor).
export const handleForceLogoutCommand = window.handleForceLogoutCommand = function (cmd) {
    if (!cmd || !cmd.targetId || !cmd.nonce) return false;
    const FORCE_LOGOUT_TTL_MS = 10 * 60 * 1000;
    const doneKey = `force_logout_done_${cmd.nonce}`;
    const fresh = Number(cmd.issuedAt) > 0 && Math.abs(Date.now() - Number(cmd.issuedAt)) < FORCE_LOGOUT_TTL_MS;
    const isAdminSession = typeof window.isDbAdmin === 'function' && window.isDbAdmin();
    const localUser = window.currentUser || window.getActiveUser();
    const targetId = String(cmd.targetId);
    const isMatch = !!localUser && (
        (localUser.id   && String(localUser.id)   === targetId) ||
        (localUser.code && String(localUser.code) === targetId) ||
        (localUser.name && String(localUser.name) === targetId)
    );

    if (fresh && isMatch && !isAdminSession && localStorage.getItem(doneKey) !== '1') {
        localStorage.setItem(doneKey, '1');
        console.warn('🚨 [Force Logout] Bu oturum yönetici tarafından sonlandırıldı. Hedef ID:', targetId);
        if (typeof window.logout === 'function') {
            window.logout('force_logout');
        } else if (window.SecurityConfig && typeof window.SecurityConfig.endAdminSession === 'function') {
            // Fallback: logout köprüsü yüklenmemişse aynı tek sonlandırma yolu (J3)
            window.SecurityConfig.endAdminSession('force_logout');
        } else {
            window.clearSession();
            window.location.replace('index.html');
        }
        return true;
    }
    return false;
};


if (!window.data) {
    window.data = { b1: [], b2: [], b3: [], personel: [], requests: [], productTypes: [], tasks: [], config: {}, assignments: [] };
}

window.isFirebaseLoaded = false;
window._dbMirror = {}; // YENİ: Firebase'den gelen saf verilerin kopyası (Değişiklik tespiti için)

// [WHY]: Koleksiyon listesi 3 yerde ayrı ayrı sabitti (dinleyici, saveData, göç); listede olmayan bir koleksiyona
//        hedefli kayıt sessizce hiçbir şey yazmıyordu (DATA-13, bkz. DATA-10 'archive').
// [HOW]: Tek, dondurulmuş liste. saveData listede olmayan koleksiyonu hata olarak reddeder.
// Faz 3.5 · veri revizyonu: bir snapshot geldiğinde veya yerel bir yazma window.data'yı değiştirdiğinde artar. Türetilmiş
// hesapların kısa ömürlü önbellekleri (ör. AssignmentService.activeDeviceUses) bununla geçersizleşir.
let _dataRevision = 0;
export const getDataRevision = window.getDataRevision = () => _dataRevision;
const _bumpDataRevision = () => { _dataRevision++; };

export const COLLECTIONS = window.COLLECTIONS = Object.freeze([
    'b1', 'b2', 'b3', 'personel', 'productTypes', 'purchaseOrders', 'serviceRecords',
    'staff', 'units', 'locations', 'tasks', 'requests', 'assignments'
]);

// ─── Dinleyici yönetimi (Faz 3.8 · DATA-11, EBYS-18) ─────────────────────────────────────────────
// [WHY]: Dinleyicilerin bir kısmı (şablonlar) senkron motorunun dışında, oturum açılmadan kaydoluyor ve izin hatasında
//        Firestore tarafından kalıcı olarak kapatılıyordu; çıkış yapıp girince yeniden başlamıyordu. İzin hatası yalnız
//        konsola düştüğü için kullanıcı boş listeyi "veri yok" sanıyordu.
// [HOW]: - registerSyncListener(key, subscribe): modüller ek dinleyicilerini buraya kaydeder; startRealtimeSync hepsini
//          oturum açıkken başlatır, stopRealtimeSync hepsini kapatır (çift dinleyici ve ölü dinleyici yok).
//        - whenAuthReady() / 'onAuthReady' olayı: oturum (anonim veya admin) her hazır olduğunda.
//        - reportListenerError: oturum açıkken gelen permission-denied ekranda "bağlantı yetkisi yok" bandı gösterir;
//          aynı dinleyiciden başarılı veri gelince band kalkar. Bilinçli çıkış sırasında (stopRealtimeSync) uyarı verilmez.
const _extraListeners = new Map();   // key -> subscribe():unsubscribe
let _syncUnsubscribers = [];
let _syncRunning = false;
let _syncUid = null;          // senkronun başlatıldığı oturum (J3 · M10)
let _syncStopping = false;
const _deniedListeners = new Set();

export const registerSyncListener = window.registerSyncListener = function (key, subscribe) {
    _extraListeners.set(key, subscribe);
    if (_syncRunning) {
        try { _syncUnsubscribers.push(subscribe()); } catch (e) { console.error(`❌ Dinleyici başlatılamadı (${key}):`, e); }
    }
};

function _renderSyncHealth() {
    const denied = [..._deniedListeners];
    let banner = document.getElementById('syncPermissionBanner');
    if (denied.length && !banner && document.body) {
        banner = document.createElement('div');
        banner.id = 'syncPermissionBanner';
        banner.setAttribute('role', 'alert');
        banner.style.cssText = 'position:fixed; left:16px; bottom:16px; z-index:12000; max-width:420px; padding:10px 14px; border-radius:8px; font-size:13px; background:var(--badge-rejected-bg,#fff5f5); color:var(--badge-rejected-text,#c92a2a); border:1px solid var(--color-danger,#e74c3c); box-shadow:0 4px 12px rgba(0,0,0,0.2);';
        document.body.appendChild(banner);
    }
    if (banner) {
        if (denied.length) banner.textContent = `⚠️ Veri bağlantısı yetkisi yok (${denied.join(', ')}). Sayfayı yenileyin veya yeniden giriş yapın.`;
        else banner.remove();
    }
    const syncText = document.getElementById('syncText');
    const dot = document.getElementById('syncIndicator');
    if (syncText) syncText.textContent = denied.length ? 'YETKİ YOK' : 'LIVE SYNC';
    if (dot) dot.classList.toggle('online', !denied.length);
}

export const reportListenerError = window.reportListenerError = function (name, err) {
    if (err && err.code === 'permission-denied') {
        if (_syncStopping || !window.userAuth) {
            console.warn(`⏳ [Güvenlik] ${name}: oturum kapalıyken yetki reddi (beklenen).`);
            return;
        }
        console.error(`⛔ [Güvenlik] ${name}: Firestore okuma yetkisi reddedildi.`, err);
        // J10: personel hesabıyla açılmış ama personel kaydına bağlı olmayan (ya da bağı kaldırılmış) oturum hiçbir şey okuyamaz.
        //      Boş ekranda "yetki yok" bandıyla beklemek yerine oturum kapatılır ve neden söylenir.
        if (name === 'personel' && window.AppModules && window.AppModules.Session && window.AppModules.Session.isStaffAccountSession()) {
            if (typeof window.showAppAlert === 'function') window.showAppAlert('Giriş hesabınız bir personel kaydına bağlı değil. Lütfen yöneticiye başvurun.', 'error');
            if (window.SecurityConfig) window.SecurityConfig.endAdminSession('stale');
            return;
        }
        _deniedListeners.add(name);
        _renderSyncHealth();
        return;
    }
    console.error(`❌ Dinleme hatası (${name}):`, err);
};

function _markListenerHealthy(name) {
    if (_deniedListeners.delete(name)) _renderSyncHealth();
}

window.getSyncHealth = () => ({ running: _syncRunning, denied: [..._deniedListeners], extra: [..._extraListeners.keys()] });

// [WHY]: Faz 4 · J3 (M10) — kilit artık signOut ediyor: kilit süresince senkron anonim oturumla yeniden başlar, kilit açılınca
//        (anonim → admin) Firestore aynı dinleyicileri yeni kimlikle sürdürür. Kilit sırasında bir dinleyici ölmüşse (izin
//        reddi) ya da senkron hiç başlamamışsa veri akışı kendiliğinden geri gelmezdi.
// [HOW]: Kilit açılınca çağrılır; yalnız gerekiyorsa (çalışmıyor ya da reddedilmiş dinleyici var) yeniden başlatır —
//        sağlıklı senkronu baştan okumak her kilit döngüsünde tüm koleksiyonları yeniden okumak demek (Spark kotası).
export const ensureRealtimeSync = window.ensureRealtimeSync = function () {
    if (!window.userAuth) return 'no-auth';
    if (_syncRunning && _deniedListeners.size === 0) return 'healthy';
    isSyncStarted = true;
    window.startRealtimeSync();
    return 'restarted';
};

let _authReadyResolvers = [];
export const whenAuthReady = window.whenAuthReady = function () {
    if (window.userAuth) return Promise.resolve(window.userAuth);
    return new Promise(resolve => _authReadyResolvers.push(resolve));
};
// J10: anonim oturum kalktı → sayfa oturumsuz da açılabilir. Firebase oturum durumunu İLK kez bildirdiğinde (kullanıcı ya da null)
// çözülür; "oturum yerleşti mi" sorusu (yönetici girişi, admin.html kapısı) artık buna bakar.
let _authKnown = false;
let _authKnownResolvers = [];
export const whenAuthKnown = window.whenAuthKnown = function () {
    if (_authKnown) return Promise.resolve(window.userAuth);
    return new Promise(resolve => _authKnownResolvers.push(resolve));
};
function _markAuthKnown() {
    _authKnown = true;
    const rs = _authKnownResolvers; _authKnownResolvers = [];
    rs.forEach(r => { try { r(window.userAuth); } catch (e) { } });
}

/**
 * @function startRealtimeSync
 * @description Uygulamanın 'Canlı Veri' motorudur. 'onSnapshot' kullanarak 
 * Firebase'deki her değişikliği anında (sayfa yenilemeden) arayüze yansıtır.
 */
// [WHY]: Oturum kapat/aç sonrası senkron yeniden başlatılınca eski dinleyiciler ölmemişse çift dinleyici oluşur.
// [HOW]: Her onSnapshot'ın unsubscribe'ı saklanır; yeniden başlatmada önce eskiler kapatılır (stopRealtimeSync).
export const stopRealtimeSync = window.stopRealtimeSync = function () {
    _syncStopping = true;
    _syncUnsubscribers.forEach(unsub => { try { unsub(); } catch (e) { } });
    _syncUnsubscribers = [];
    _syncRunning = false;
    _deniedListeners.clear();
    _renderSyncHealth();
    _syncStopping = false;
};

window.startRealtimeSync = function () {
    stopRealtimeSync();
    _syncRunning = true;
    _syncUid = window.userAuth ? window.userAuth.uid : null;

    // J10: senkron yalnız oturum açıldıktan sonra çalışır; giriş ekranı (rehber, kutu, odak) auth-engine'de yönetilir.

    // A. ENVANTER VERİLERİNİ DİNLE (COLLECTION_ROOT alt koleksiyonları)
    // [ENV_GUARD] Sabit "inventory_v2" yerine COLLECTION_ROOT kullanılıyor.
    // Bu, demo/localhost ortamında yanlışlıkla üretim verisi dinlenmesini engeller.
    COLLECTIONS.forEach(colName => {
        _syncUnsubscribers.push(onSnapshot(collection(fireDb, COLLECTION_ROOT, colName, "items"), (snapshot) => {
            console.log(`[DB-PATH-CHECK] Şu an aktif olarak dinlenen koleksiyon: ${COLLECTION_ROOT}/${colName}/items`);
            _markListenerHealthy(colName);

            let hasModifications = false;
            let changesPayload = [];

            // [WHY]: Flicker-free (titremesiz) DOM yaması için sadece değişen dökümanları yakala
            // [HOW]: snapshot.docChanges() ile dönen array içinde "modified" olanları süzüp changesPayload dizisine atıyoruz.
            snapshot.docChanges().forEach((change) => {
                if (change.type === "modified") {
                    hasModifications = true;
                    changesPayload.push({
                        id: change.doc.id,
                        data: change.doc.data()
                    });
                }
            });

            const items = [];
            snapshot.forEach(docSnap => {
                // Kayıtta id alanı yoksa doküman id'si kullanılır; aksi halde düzenleme/silme hedefsiz kalıyor ve kayıt temp_ id ile çoğalıyordu.
                items.push({ id: docSnap.id, ...docSnap.data() });
            });

            // Veriyi global hafızaya ve Mirror'a (kopya) al
            window.data[colName] = items;
            _bumpDataRevision();
            // [PERFORMANCE_GUARD]: Modern structuredClone is used to avoid main-thread blocking on large datasets (1000+ items), with a safe fallback to JSON copy for older browsers.
            window._dbMirror[colName] = typeof structuredClone === "function" ? structuredClone(items) : JSON.parse(JSON.stringify(items));

            console.log(`📥 Veri Çekildi: ${colName}`, items.length);
            if (typeof window.updateSyncStatus === 'function') window.updateSyncStatus();

            // YENI YAPI: PubSub (Event) Mimarisi
            // [HOW]: isPatch bayrağı ile sadece modifikasyon olan durumlarda Targeted Patching devreye girer
            const isInitialLoad = !window.isFirebaseLoaded; // Basit bir kontrol
            const isTargetedPatch = hasModifications && snapshot.docChanges().every(c => c.type === 'modified');

            window.dispatchEvent(new CustomEvent('onInventoryDataUpdated', {
                detail: {
                    collection: colName,
                    isPatch: isTargetedPatch,
                    changes: changesPayload
                }
            }));

            // ✅ Koleksiyon yüklendi olarak işaretle
            if (window.LoadingCoordinator) {
                window.LoadingCoordinator.markLoaded(colName);
            }

            // Personel koleksiyonu yüklendiğinde sistemi hazır hale getir
            if (colName === 'personel' && items.length >= 0) {
                window.isFirebaseLoaded = true;
            }
        }, (err) => reportListenerError(colName, err)));
    });

    // B. SİSTEM AYARLARINI DİNLE
    _syncUnsubscribers.push(onSnapshot(systemConfigRef("admin_settings"), (docSnap) => {
        _markListenerHealthy('admin_settings');
        if (docSnap.exists()) {
            const data = docSnap.data();
            window.data.config = data;
            console.log("⚙️ Hash updated.");
            // VIP-07: kill switch butonu her zaman sunucudaki gerçek durumu gösterir (admin.html'de tanımlı).
            if (typeof window.renderKillSwitchButton === 'function') window.renderKillSwitchButton(data.maintenance === true);

            // Launchpad bayrağı artık dinlenmez (VIP-10 / K9-a); eski istemcilerdeki kopyası temizlenir.
            localStorage.removeItem('launchpadDisabledGlobal');

            // [WHY]: Kill Switch entegrasyonu. Firestore'daki 'maintenance' bayrağını dinleyerek normal kullanıcıları bakım moduna alırız.
            // [HOW]: Firebase admin oturumu yoksa ve maintenance aktifse localStorage'a yazar ve sayfayı yenileriz.
            if (data.hasOwnProperty('maintenance')) {
                const isMaintenance = data.maintenance === true;

                // Faz 4 · J3: muafiyet elle yazılabilen admin_auth vizesine değil Firebase admin oturumuna bağlı (kural da öyle).
                const isAdmin = window.isDbAdmin();

                const prevMaintenance = localStorage.getItem("system_maintenance_mode") === "true";

                if (isMaintenance && !isAdmin) {
                    localStorage.setItem("system_maintenance_mode", "true");
                    if (!prevMaintenance) {
                        console.warn("🚨 [Kill Switch] Sistem bakım moduna alındı. Sayfa yeniden yükleniyor.");
                        window.location.reload();
                    }
                } else {
                    localStorage.removeItem("system_maintenance_mode");
                    if (prevMaintenance) {
                        console.log("✅ [Kill Switch] Sistem normale döndü. Sayfa yeniden yükleniyor.");
                        window.location.reload();
                    }
                }
            }

            // Force logout: tek seferlik, taze komut (VIP-06) — bkz. handleForceLogoutCommand
            handleForceLogoutCommand(data.force_logout);

            // Faz 5 denetimi · P0: yarım kalmış toplu yazma kilidi → yönetici sekmesinde otomatik kurtarma
            if (data.restoreLock) _scheduleBulkRecovery();
        }
    }, (err) => reportListenerError('admin_settings', err)));

    // C. SİSTEM MESAJLARINI DİNLE
    // [WHY]: God-Eye panelinden gönderilen yönetici mesajlarını gerçek zamanlı yakalamak için.
    // [HOW]: system_config/admin_messages belgesindeki target_user_id ile mevcut kullanıcının id/code/name alanlarını karşılaştırır ve eşleşirse alert gösterir.
    _syncUnsubscribers.push(onSnapshot(systemConfigRef("admin_messages"), (docSnap) => {
        _markListenerHealthy('admin_messages');
        if (docSnap.exists()) {
            const data = docSnap.data();
            
            const localUser = window.currentUser || window.getActiveUser();

            if (localUser && data.timestamp && data.message) {
                const targetId = data.target_user_id;
                const isMatch = (
                    targetId === 'broadcast' ||
                    (localUser.id   && String(localUser.id)   === String(targetId)) ||
                    (localUser.code && String(localUser.code) === String(targetId)) ||
                    (localUser.name && String(localUser.name) === String(targetId))
                );
                
                if (isMatch) {
                    const msgTime = data.timestamp?.seconds || data.timestamp;
                    const msgKey = `last_msg_ts_${msgTime}`;
                    
                    if (localStorage.getItem(msgKey) !== 'true') {
                        localStorage.setItem(msgKey, 'true');
                        if (typeof showAppAlert === 'function') {
                            showAppAlert(`✉️ Yönetici Mesajı:\n${data.message}`, 'info');
                        } else {
                            alert(`Yönetici Mesajı:\n${data.message}`);
                        }
                    }
                }
            }
        }
    }, (err) => reportListenerError('admin_messages', err)));

    // D. MODÜLLERİN KAYDETTİĞİ EK DİNLEYİCİLER (ör. iş akışı şablonları)
    _extraListeners.forEach((subscribe, key) => {
        try { _syncUnsubscribers.push(subscribe()); } catch (e) { console.error(`❌ Dinleyici başlatılamadı (${key}):`, e); }
    });
};

/**
 * @function saveData (v2 · Faz 3.1)
 * @description Bir koleksiyonun (veya tüm window.data'nın) istenen son halini Firestore'a yazar.
 *
 * Kullanım (geriye uyumlu):
 *   saveData('requests', dizi)            → yalnız o koleksiyon
 *   saveData(window.data)                 → tüm koleksiyonlar (her biri ayrı ayrı karşılaştırılır)
 *   saveData('requests', dizi, opts) / saveData(window.data, opts)
 *     opts.strict          varsayılan true (H2 sonu): hata SaveDataError olarak fırlatılır. false → hata olursa false döner.
 *     opts.allowBulkDelete true → toplu silme kilidini açar (yalnız kullanıcı onaylı toplu silmeler için).
 *
 * Dönüş: başarıda { written, deleted, unchanged, collections: { [col]: {written, deleted, unchanged} } } (truthy),
 *        başarısızlıkta false (strict değilse). Mevcut `=== false` kontrolleri aynen çalışır.
 */
// [WHY]: v1 her çağrıda hedef koleksiyonun TÜM dokümanlarını yeniden yazıyordu; 19 yerde bütün veritabanı yazılıyordu
//        (DATA-01) — Spark kotası bu desenle hızla tükenir, kota bitince tüm yazmalar gün sonuna kadar başarısız olur.
//        Hatalar yalnız false olarak dönüyordu ve bilinmeyen koleksiyon sessizce hiçbir şey yazmıyordu (DATA-02, DATA-13).
// [HOW]: Her doküman, Firestore'dan gelen son kopyayla (_dbMirror) anahtar sırasından bağımsız JSON olarak karşılaştırılır;
//        yalnız yeni veya değişen dokümanlar yazılır, mirror'da olup dizide olmayanlar silinir.
//        Maskeleme çifti: yazma yalnız değişene inince tek tehlikeli davranış silme kalır — tüm dizi yerine bir alt küme
//        gönderen çağıran geri kalan her şeyi siler. Bu yüzden TOPLU SİLME KİLİDİ: bir çağrıda bir koleksiyondan 1'den
//        fazla VE (5'ten fazla VEYA koleksiyonun %20'sinden fazla) kayıt silinecekse, allowBulkDelete verilmedikçe
//        HİÇBİR yazma yapılmaz. Tek kayıt silme her zaman serbest.
//        Faz 3.5 (denetim): oran kuralı yalnız 10'dan fazla kayıtlı koleksiyonda uygulanır. 2-4 kayıtlı küçük koleksiyonlarda
//        (units, productTypes) meşru 2 silme %20'yi aştığı için kilitleniyordu; ≤10 kayıtta yalnız mutlak sınır (5) geçerli.
//        Başarılı yazmadan sonra mirror güncellenir: snapshot gelene kadar yapılan ikinci kayıt aynı dokümanları
//        tekrar yazmaz ve silme hesabı yeni eklenenleri "silinmiş" saymaz.
const BULK_DELETE_MAX = 5;
const BULK_DELETE_RATIO = 0.2;
const BULK_DELETE_RATIO_MIN_TOTAL = 10;   // oran kuralı yalnız bundan büyük koleksiyonlarda
export const isBulkDeleteBlocked = window.isBulkDeleteBlocked = (deletes, total) =>
    deletes > 1 && (deletes > BULK_DELETE_MAX || (total > BULK_DELETE_RATIO_MIN_TOTAL && deletes > total * BULK_DELETE_RATIO));

export class SaveDataError extends Error {
    constructor(code, message, details) {
        super(message);
        this.name = 'SaveDataError';
        this.code = code;
        this.details = details || null;
    }
}
window.SaveDataError = SaveDataError;

// [WHY]: H2 sonunda strict varsayılan oldu (karar 1). Sonucu `=== false` ile kontrol edip telafi yapan çağıranlar (stok geri
//        alma, talebi geri döndürme) hata fırlatılınca o dalı hiç çalıştırmazdı; sonucu hiç kontrol etmeyen çağıranlar ise
//        başarısız yazmada kullanıcıya hiçbir şey göstermeden dururdu.
// [HOW]: writeOk(p) — yazma sözünü true/false'a çevirir (yalnız SaveDataError'ı yakalar); telafi yapan çağıranlar bunu
//        kullanır. Yakalanmamış SaveDataError'lar genel yakalayıcıda kullanıcıya gösterilir (işlem de orada durur).
export const writeOk = window.writeOk = p => Promise.resolve(p).then(r => r !== false, e => {
    if (e && e.name === 'SaveDataError') return false;
    throw e;
});
// [WHY]: Faz 4 · J1 (M2) — Rules v2 bakım modunda personel yazmasını, her zaman da yetkisiz koleksiyon / etiketli metin
//        yazmasını reddeder. Ret "Firestore yazması başarısız: Missing or insufficient permissions" olarak görünüyordu;
//        çağıranların çoğu writeOk ile bunu genel "kaydedilemedi"ye çeviriyor ve gerçek sebep kayboluyordu.
// [HOW]: permission-denied → bakım açıksa 'maintenance', değilse 'forbidden'; gerçek sebep veri katmanında bir kez gösterilir
//        (toplu silme kilidindeki gibi). Bakımda personel yazması Firestore'a hiç gönderilmez (kural yayınlanmadan da aynı davranış).
export const MAINTENANCE_WRITE_MESSAGE = '🛠️ Sistem bakımda: şu an kayıt yapılamıyor. Bakım bitince tekrar deneyin.';
export const FORBIDDEN_WRITE_MESSAGE = '🔒 Kayıt reddedildi: bu işlem için yetkiniz yok ya da metinde etiket benzeri "<" ifadesi var.';
const _maintenanceBlocksWrite = () => !!(window.data && window.data.config && window.data.config.maintenance === true)
    && !(typeof window.isDbAdmin === 'function' && window.isDbAdmin());
function _deniedFailure(e) {
    if (!e || e.code !== 'permission-denied') return null;
    return _maintenanceBlocksWrite()
        ? { code: 'maintenance', message: MAINTENANCE_WRITE_MESSAGE }
        : { code: 'forbidden', message: FORBIDDEN_WRITE_MESSAGE };
}
const _SHOWN_BY_DATA_LAYER = ['bulk-delete-blocked', 'maintenance', 'forbidden', 'bulk-locked'];
function _announceDenied(code, message) {
    if (code !== 'maintenance' && code !== 'forbidden' && code !== 'bulk-locked') return;
    if (typeof window.showAppAlert === 'function') window.showAppAlert(message, 'error');
}

// [WHY]: Faz 5 denetimi · P0 — tek batch'e sığmayan geri yükleme/içe aktarma (atomic-writer.js) parça parça yazılırken
//        başka bir istemcinin aynı koleksiyona yazması, olası geri almada o yazmanın ezilmesi demek; yarım kalmış (geri
//        alınmayı bekleyen) bir işin üstüne yazmak ise yarım veriyi kalıcılaştırır.
// [HOW]: Motor kilidi admin_settings.restoreLock'a yazar (tüm istemciler bu dokümanı zaten dinliyor → window.data.config).
//        Kilit varken kilitli koleksiyonlara giden saveData / applyItemOps / runStockOps yazmaları Firestore'a gönderilmez.
//        Kilidi tutan sekme bu yolları kullanmaz (motor kendi batch'lerini yazar); _bulkActive yerel kopyadır (snapshot
//        gelmeden önceki kısa aralık için).
export const BULK_LOCK_MESSAGE = '🔒 Toplu geri yükleme / içe aktarma sürüyor ya da geri alınmayı bekliyor; bu koleksiyona şu an yazılamıyor. Birkaç dakika sonra tekrar deneyin.';
let _bulkActive = null;   // { collections } — bu sekmede çalışan motor işi
function _bulkLockBlocks(cols) {
    const L = (window.data && window.data.config && window.data.config.restoreLock) || _bulkActive;
    if (!L) return false;
    const locked = Array.isArray(L.collections) && L.collections.length ? L.collections : null;
    return !locked || cols.some(c => locked.includes(c));
}

window.addEventListener('unhandledrejection', ev => {
    const e = ev.reason;
    if (!e || e.name !== 'SaveDataError') return;
    ev.preventDefault();
    if (_SHOWN_BY_DATA_LAYER.includes(e.code)) return; // veri katmanı kendi uyarısını zaten gösterdi
    const text = e.code === 'no-auth' ? 'Oturum yok; kayıt yapılamadı. Sayfayı yenileyip tekrar giriş yapın.'
        : e.code === 'not-found' ? 'Kayıt bulunamadı; başka biri değiştirmiş veya silmiş olabilir.'
        : `Kayıt yapılamadı: ${e.message}`;
    if (typeof window.showAppAlert === 'function') window.showAppAlert(text, 'error');
});

// Anahtar sırasından bağımsız, kararlı JSON. '__' ile başlayan yardımcı (render) alanları karşılaştırmaya girmez.
function _stableStringify(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(_stableStringify).join(',') + ']';
    return '{' + Object.keys(value)
        .filter(k => !k.startsWith('__') && value[k] !== undefined)
        .sort()
        .map(k => JSON.stringify(k) + ':' + _stableStringify(value[k]))
        .join(',') + '}';
}
const _clean = item => JSON.parse(JSON.stringify(item, (k, v) => v === undefined ? "" : v));
const _docRef = (colName, id) => doc(fireDb, COLLECTION_ROOT, colName, "items", String(id).replace(/\//g, '_'));
const _clone = v => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));

export const saveData = window.saveData = async function (arg1, arg2, arg3) {
    const isTargeted = typeof arg1 === 'string';
    const opts = (isTargeted ? arg3 : arg2) || {};
    const strict = opts.strict !== false; // H2 sonu (karar 1): varsayılan strict — hata SaveDataError olarak fırlatılır

    const fail = (code, message, details) => {
        const err = new SaveDataError(code, message, details);
        console.error(`❌ saveData [${code}]: ${message}`, details || '');
        if (strict) throw err;
        return false;
    };

    // [WHY]: Oturum yokken yazma denemesi sessizce "başarısız" dönüyordu; artık kodlu hata (strict'te fırlatılır).
    if (!window.userAuth) return fail('no-auth', 'Oturum bulunamadı; yazma reddedildi.');

    let targets;
    if (isTargeted) {
        if (!COLLECTIONS.includes(arg1)) return fail('unknown-collection', `Bilinmeyen koleksiyon: "${arg1}"`, { collection: arg1 });
        if (!Array.isArray(arg2)) return fail('invalid-argument', `saveData('${arg1}', …) bir dizi bekliyor.`);
        window.data[arg1] = arg2;
        _bumpDataRevision();
        targets = [arg1];
    } else if (arg1 && typeof arg1 === 'object') {
        window.data = arg1;
        _bumpDataRevision();
        targets = COLLECTIONS.filter(c => Array.isArray(window.data[c]));
    } else {
        return fail('invalid-argument', 'saveData koleksiyon adı + dizi veya window.data bekliyor.');
    }

    // 1. Plan: her koleksiyon için yazılacak / silinecek dokümanlar
    const plans = [];
    for (const colName of targets) {
        const items = window.data[colName] || [];
        const mirror = window._dbMirror[colName] || [];
        const mirrorById = new Map(mirror.filter(m => m && m.id != null && m.id !== '').map(m => [String(m.id), m]));

        const writes = [];
        const keep = new Set();
        let unchanged = 0;
        for (const item of items) {
            if (!item || typeof item !== 'object') continue;
            if (item.id == null || String(item.id).trim() === '') {
                item.id = typeof window.makeId === 'function' ? window.makeId() : Date.now() * 1000 + Math.floor(Math.random() * 1000);
            }
            const key = String(item.id);
            keep.add(key);
            const clean = _clean(item);
            const prev = mirrorById.get(key);
            if (prev && _stableStringify(_clean(prev)) === _stableStringify(clean)) { unchanged++; continue; }
            writes.push({ key, data: clean });
        }
        const deletes = [...mirrorById.keys()].filter(k => !keep.has(k));

        // Faz 3.5/K2 · şema muhafızı (b3, b1, b2): yeni doküman tam 'set' sözleşmesinden geçer; var olan (eski biçimli
        // olabilir) dokümanda yalnız yeni eklenen alan adları denetlenir (değişikliğe eski/bilinmeyen alan adı giremez).
        // İhlalde hiçbir koleksiyon yazılmaz.
        // [Faz 5 denetimi · P1]: K2'deki b1/b2 istisnası kaldırıldı — yeni b1/b2 dokümanı da tam sözleşmeden geçer (içe
        // aktarma artık Schema.toCanonicalStock + atomicInsertItems kullanıyor). Ayrıca kanonik bir b1/b2 kaydı bu yoldan
        // kanonik olmayana dönüştürülemez: saveData merge yazdığı için kaydın yazma SONRASI hâli tam sözleşmeyle denetlenir.
        if (colName === 'b3' || colName === 'b1' || colName === 'b2') {
            const stock = colName !== 'b3';
            const guard = _schemaGuardError(writes.map(w => {
                const prev = mirrorById.get(w.key);
                if (!prev) return { op: 'set', col: colName, id: w.key, data: w.data };
                if (stock && !_stockViolation({ op: 'set', col: colName, data: prev })) {
                    return { op: 'set', col: colName, id: w.key, data: { ...prev, ...w.data } };
                }
                const added = Object.fromEntries(Object.entries(w.data).filter(([k]) => !(k in prev)));
                return { op: 'update', col: colName, id: w.key, data: added };
            }), opts);
            if (guard) return fail(guard.code, guard.message, guard.details);
        }
        // Faz 4B · J9: sahiplik alanları (personelUid/createdByUid/creatorUid) değiştirilemez; tam yazmada eski değer taşınır.
        const owner = _ownerGuardError(writes.map(w => ({ op: 'set', col: colName, id: w.key, data: w.data })));
        if (owner) return fail(owner.code, owner.message, owner.details);

        const bulk = isBulkDeleteBlocked(deletes.length, mirror.length);
        if (bulk && opts.allowBulkDelete !== true) {
            if (typeof window.showAppAlert === 'function') {
                window.showAppAlert(`Güvenlik kilidi: tek işlemde "${colName}" koleksiyonundan ${deletes.length} kayıt silinmek istendi. İşlem durduruldu, hiçbir şey yazılmadı.`, 'error');
            }
            return fail('bulk-delete-blocked',
                `"${colName}": tek çağrıda ${deletes.length}/${mirror.length} kayıt silinecekti (sınır: ${BULK_DELETE_MAX} kayıt; ${BULK_DELETE_RATIO_MIN_TOTAL} kayıttan büyük koleksiyonda ayrıca %${BULK_DELETE_RATIO * 100}).`,
                { collection: colName, deletes: deletes.length, total: mirror.length, ids: deletes.slice(0, 20) });
        }
        plans.push({ colName, writes, deletes, unchanged });
    }

    // 2. Yazma (500 işlem sınırı için parçalı batch)
    const ops = [];
    plans.forEach(p => {
        p.deletes.forEach(key => ops.push({ type: 'delete', ref: _docRef(p.colName, key) }));
        p.writes.forEach(w => ops.push({ type: 'set', ref: _docRef(p.colName, w.key), data: w.data }));
    });
    if (ops.length && _maintenanceBlocksWrite()) {
        _announceDenied('maintenance', MAINTENANCE_WRITE_MESSAGE);
        return fail('maintenance', MAINTENANCE_WRITE_MESSAGE);
    }
    if (ops.length && _bulkLockBlocks(plans.map(p => p.colName))) {
        _announceDenied('bulk-locked', BULK_LOCK_MESSAGE);
        return fail('bulk-locked', BULK_LOCK_MESSAGE);
    }
    try {
        const CHUNK_SIZE = 490;
        for (let i = 0; i < ops.length; i += CHUNK_SIZE) {
            const batch = writeBatch(fireDb);
            ops.slice(i, i + CHUNK_SIZE).forEach(op => op.type === 'delete' ? batch.delete(op.ref) : batch.set(op.ref, op.data, { merge: true }));
            await batch.commit();
        }
    } catch (e) {
        const denied = _deniedFailure(e);
        if (denied) { _announceDenied(denied.code, denied.message); return fail(denied.code, denied.message, { code: e.code }); }
        return fail('write-failed', `Firestore yazması başarısız: ${e.message}`, { code: e.code });
    }

    // 3. Mirror'ı yazılanla güncelle (snapshot gelene kadar tutarlı karşılaştırma için)
    const result = { written: 0, deleted: 0, unchanged: 0, collections: {} };
    plans.forEach(p => {
        const byId = new Map((window._dbMirror[p.colName] || []).map(m => [String(m.id), m]));
        p.deletes.forEach(k => byId.delete(k));
        p.writes.forEach(w => byId.set(w.key, { ...(byId.get(w.key) || {}), ..._clone(w.data) }));
        window._dbMirror[p.colName] = [...byId.values()];

        result.collections[p.colName] = { written: p.writes.length, deleted: p.deletes.length, unchanged: p.unchanged };
        result.written += p.writes.length;
        result.deleted += p.deletes.length;
        result.unchanged += p.unchanged;
        if (p.writes.length || p.deletes.length) {
            console.log(`☁️ saveData(${p.colName}): ${p.writes.length} yazıldı · ${p.deletes.length} silindi · ${p.unchanged} değişmedi`);
        }
    });
    if (!result.written && !result.deleted) console.log(`☁️ saveData(${isTargeted ? arg1 : 'window.data'}): değişiklik yok, yazma yapılmadı.`);
    return result;
};

// ─── Tek-doküman API (Faz 3.2 · DATA-01, DATA-06) ────────────────────────────────────────────────
// [WHY]: Tek bir kaydı değiştirmek için bile çağıranlar koleksiyonun (çoğu zaman tüm veritabanının) son halini diziyle
//        gönderiyordu; silme/düzenleme dizi indeksiyle hedefleniyordu ve her snapshot diziyi yeniden kurduğu için yanlış
//        kaydı vurabiliyordu (KN-5).
// [HOW]: İşlemler koleksiyon + id ile tarif edilir ve tek bir writeBatch'te (Firestore'da atomik: ya hepsi ya hiçbiri)
//        yazılır. Böylece "hedefe ekle + kaynaktan sil" (sevk) gibi çok dokümanlı işlemler de yarım kalmaz.
//          applyItemOps([{op:'set', col, item} | {op:'update', col, id, fields} | {op:'delete', col, id}], opts)
//          upsertItem(col, item)       → dokümanın tamamı yazılır (merge YOK: kayıttan çıkarılan alan Firestore'da da gider)
//          appendItem(col, item)       → yeni kayıt; id yoksa makeId(); aynı id zaten varsa 'duplicate-id'
//          updateItems(col, [{id, fields}]) / updateItem(col, id, fields) → yalnız verilen alanlar (başka alanlara dokunmaz;
//                                        eşzamanlı başka düzenlemeleri ezmez); kayıt yoksa 'not-found'
//          removeItem(col, id)         → tek silme
//          bulkRemove(col, ids)        → bilinçli toplu silme (çağıranın kullanıcı onayı alması beklenir)
//        '__' ile başlayan render alanları yazılmaz. Başarıdan sonra window.data ve mirror hemen güncellenir (arayüz
//        snapshot'ı beklemeden doğru çizilir). Hata sözleşmesi saveData ile aynı: false veya strict'te SaveDataError.
const _stripRenderFields = item => Object.fromEntries(Object.entries(item).filter(([k]) => !k.startsWith('__')));
const _sameId = id => x => x && String(x.id) === String(id);

// ─── Faz 3.5 · B3 çalışma zamanı muhafızı (denetim bulgusu) ──────────────────────────────────────
// [WHY]: Kanonik b3 şeması (3.6) yalnız çağıranların Schema.buildB3Entry kullanmasına ve sözleşme testine dayanıyordu;
//        kurucuyu atlayan bir kod (ya da ajan) eski/eksik biçimde b3 yazabilirdi ve bu ancak ekranda fark edilirdi.
// [HOW]: b3'e giden her yazma Firestore'a gitmeden burada denetlenir — applyItemOps, runStockOps (çıkış, sepet, onay, zimmet
//        bu yoldan yazar) ve saveData. 'set' → Schema.validateB3 (tam sözleşme); 'update' → yalnız kanonik alan adları.
//        İhlalde hiçbir şey yazılmaz: SaveDataError('schema-violation'). Eski kayıtların göçü (VIP Şema Göçü) açık bir
//        bayrakla ({ b3Legacy: true }) yalnız eski kayıtlara tanınan gevşekliği (deposu bilinmeyen kayıt, kimliksiz eski
//        demirbaş) kullanır; eksik alan / eski alan adı yine reddedilir.
function _b3Violation(p, opts = {}) {
    if (p.col !== 'b3' || p.op === 'delete') return null;
    const S = window.Schema;
    if (!S || typeof S.validateB3 !== 'function') return ['şema modülü (schema.js) yüklenmemiş'];
    if (p.op === 'set') {
        const errors = S.validateB3(p.data, { legacy: opts.b3Legacy === true });
        return errors.length ? errors : null;
    }
    const bad = Object.keys(p.data || {}).filter(k => !S.B3_KEYS.includes(k));
    return bad.length ? bad.map(k => (S.B3_LEGACY_KEYS.includes(k) ? `eski alan: ${k}` : `bilinmeyen alan: ${k}`)) : null;
}
// ─── Faz 5 · K2 · B1/B2 çalışma zamanı muhafızı (5.8) ─────────────────────────────────────────────
// [WHY]: B3'teki aynı sorun b1/b2'de de vardı — hiçbir yazma yolu Schema.validateB1/B2'den geçmiyordu; sevk/transfer ve
//        hurda akışları (K2) yeni kod ekledikçe şema dağınıklığı büyüyecekti.
// [HOW]: _b3Violation ile birebir aynı iki aşamalı desen ('set' → tam sözleşme, 'update' → yalnız bilinen alan adı).
//        planStockOps'un KENDİ hesapladığı stok deltası (patch/full) bu guard'ın kapsamı DIŞINDA kalır — tıpkı B3 guard'ının
//        da yalnız çağıranın `writes` dizisini denetleyip stok deltasını denetlemediği gibi (bkz. runStockOps).
//        Faz 5 denetimi (P1): 'set' için gevşetme bayrağı (stockLegacy) YOK — hiçbir yazma yolu eksik alanlı b1/b2 yazamaz.
function _stockViolation(p) {
    if (p.op === 'delete') return null;
    const S = window.Schema;
    const isB1 = p.col === 'b1';
    if (!S || typeof S[isB1 ? 'validateB1' : 'validateB2'] !== 'function') return ['şema modülü (schema.js) yüklenmemiş'];
    const KEYS = isB1 ? S.B1_KEYS : S.B2_KEYS;
    const LEGACY_KEYS = isB1 ? S.B1_LEGACY_KEYS : S.B2_LEGACY_KEYS;
    if (p.op === 'set') {
        const errors = (isB1 ? S.validateB1 : S.validateB2)(p.data);
        return errors.length ? errors : null;
    }
    const bad = Object.keys(p.data || {}).filter(k => !KEYS.includes(k));
    return bad.length ? bad.map(k => (LEGACY_KEYS.includes(k) ? `eski alan: ${k}` : `bilinmeyen alan: ${k}`)) : null;
}

function _schemaViolation(p, opts) {
    if (p.col === 'b3') return _b3Violation(p, opts);
    if (p.col === 'b1' || p.col === 'b2') return _stockViolation(p);
    return null;
}
function _schemaGuardError(prepared, opts) {
    for (const p of prepared) {
        const errors = _schemaViolation(p, opts);
        if (errors) {
            return new SaveDataError('schema-violation',
                `${p.col} kaydı şema sözleşmesine uymuyor (${p.op} ${p.id}): ${errors.slice(0, 3).join('; ')}${errors.length > 3 ? ` (+${errors.length - 3})` : ''}`,
                { collection: p.col, id: p.id, op: p.op, errors });
        }
    }
    return null;
}

// ─── Faz 4B · J9 · sahiplik muhafızı ─────────────────────────────────────────────────────────────────────
// [WHY]: Sahiplik uid'leri (J10 kurallarının "kimin kaydı" kararı) bir kez yazıldıktan sonra değişmemeli (GPT-6 kural 1); tam
//        değiştirme yapan yollar (upsertItem, saveData) alanı bilmeyen eski bir yerel kopyayla sahipliği sessizce silebilirdi.
// [HOW]: Kural Ownership.ownerGuard'da (saf, birim testli). Firestore'daki son hâl (mirror) ile karşılaştırılır: dolu alan farklı
//        bir değerle → 'owner-immutable'; gönderilmemiş/boş → eski değer taşınır; var olan kayda ilk yazım yalnız yönetici;
//        yeni kayıtta yalnız oturumun kendi uid'si. Sunucu tarafı karşılığı firestore.rules (personel yazmaları).
//        Modül yüklenmemişse sahiplik koleksiyonlarına yazma kapalı (güvenli varsayılan).
function _ownerGuardError(prepared) {
    const touches = prepared.filter(p => p && p.op !== 'delete' && ['requests', 'purchaseOrders', 'tasks'].includes(p.col));
    if (!touches.length) return null;
    const O = window.Ownership;
    if (!O || typeof O.ownerGuard !== 'function') return new SaveDataError('write-failed', 'Sahiplik modülü (ownership.js) yüklenmemiş; kayıt yapılmadı.');
    const actorUid = window.userAuth ? window.userAuth.uid : null;
    const isAdmin = typeof window.isDbAdmin === 'function' && window.isDbAdmin();
    for (const p of touches) {
        const prev = (window._dbMirror[p.col] || []).find(_sameId(p.id)) || null;
        const e = O.ownerGuard({ col: p.col, op: p.op, data: p.data, prev, actorUid, isAdmin });
        if (e) return new SaveDataError(e.code, e.message, { collection: p.col, id: p.id, field: e.field });
    }
    return null;
}

function _applyLocal(colName, op) {
    _bumpDataRevision();
    for (const store of [window.data, window._dbMirror]) {
        const list = Array.isArray(store[colName]) ? store[colName] : (store[colName] = []);
        const idx = list.findIndex(_sameId(op.id));
        if (op.op === 'delete') { if (idx !== -1) list.splice(idx, 1); continue; }
        const next = op.op === 'update' ? { ...(idx !== -1 ? list[idx] : {}), ...op.data } : { ...op.data };
        const value = store === window._dbMirror ? _clone(next) : next;
        if (idx !== -1) list[idx] = value; else list.unshift(value);
    }
}

export const applyItemOps = window.applyItemOps = async function (ops, opts = {}) {
    const strict = opts.strict !== false; // H2 sonu (karar 1): varsayılan strict — hata SaveDataError olarak fırlatılır
    const fail = (code, message, details) => {
        const err = new SaveDataError(code, message, details);
        console.error(`❌ applyItemOps [${code}]: ${message}`, details || '');
        if (strict) throw err;
        return false;
    };
    if (!window.userAuth) return fail('no-auth', 'Oturum bulunamadı; yazma reddedildi.');
    if (!Array.isArray(ops) || ops.length === 0) return fail('invalid-argument', 'En az bir işlem gerekli.');

    const prepared = [];
    for (const o of ops) {
        if (!o || !COLLECTIONS.includes(o.col)) return fail('unknown-collection', `Bilinmeyen koleksiyon: "${o && o.col}"`, { collection: o && o.col });
        if (o.op === 'set') {
            if (!o.item || typeof o.item !== 'object') return fail('invalid-argument', 'set işlemi item bekliyor.');
            const item = _stripRenderFields(o.item);
            if (item.id == null || String(item.id).trim() === '') item.id = window.makeId();
            if (o.mustBeNew && (window._dbMirror[o.col] || []).some(_sameId(item.id))) {
                return fail('duplicate-id', `"${o.col}" içinde ${item.id} id'li kayıt zaten var.`, { collection: o.col, id: item.id });
            }
            prepared.push({ op: 'set', col: o.col, id: String(item.id), data: _clean(item) });
        } else if (o.op === 'update') {
            if (o.id == null || !o.fields || typeof o.fields !== 'object') return fail('invalid-argument', 'update işlemi id ve fields bekliyor.');
            const known = (window._dbMirror[o.col] || []).some(_sameId(o.id)) || (window.data[o.col] || []).some(_sameId(o.id));
            if (!known) return fail('not-found', `"${o.col}" içinde ${o.id} id'li kayıt bulunamadı; liste güncellenmiş olabilir.`, { collection: o.col, id: o.id });
            const fields = _clean(_stripRenderFields(o.fields));
            delete fields.id;
            prepared.push({ op: 'update', col: o.col, id: String(o.id), data: fields });
        } else if (o.op === 'delete') {
            if (o.id == null || String(o.id) === '') return fail('invalid-argument', 'delete işlemi id bekliyor.');
            prepared.push({ op: 'delete', col: o.col, id: String(o.id) });
        } else {
            return fail('invalid-argument', `Bilinmeyen işlem: "${o.op}"`);
        }
    }
    if (prepared.length > 490) return fail('invalid-argument', `Tek atomik işlemde en fazla 490 doküman yazılabilir (${prepared.length}).`);
    const guard = _schemaGuardError(prepared, opts);   // Faz 3.5/K2: b3/b1/b2 sözleşmesi — ihlalde batch'in hiçbir parçası yazılmaz
    if (guard) return fail(guard.code, guard.message, guard.details);
    const owner = _ownerGuardError(prepared);           // Faz 4B · J9: sahiplik alanları değiştirilemez
    if (owner) return fail(owner.code, owner.message, owner.details);
    if (_maintenanceBlocksWrite()) {
        _announceDenied('maintenance', MAINTENANCE_WRITE_MESSAGE);
        return fail('maintenance', MAINTENANCE_WRITE_MESSAGE);
    }
    if (_bulkLockBlocks(prepared.map(p => p.col))) {
        _announceDenied('bulk-locked', BULK_LOCK_MESSAGE);
        return fail('bulk-locked', BULK_LOCK_MESSAGE);
    }

    try {
        const batch = writeBatch(fireDb);
        prepared.forEach(p => {
            const ref = _docRef(p.col, p.id);
            if (p.op === 'set') batch.set(ref, p.data);
            else if (p.op === 'update') batch.update(ref, p.data);
            else batch.delete(ref);
        });
        await batch.commit();
    } catch (e) {
        if (e && e.code === 'not-found') return fail('not-found', 'Kayıt Firestore\'da bulunamadı; başka biri silmiş olabilir.', { code: e.code });
        const denied = _deniedFailure(e);
        if (denied) { _announceDenied(denied.code, denied.message); return fail(denied.code, denied.message, { code: e.code }); }
        return fail('write-failed', `Firestore yazması başarısız: ${e.message}`, { code: e && e.code });
    }

    const result = { written: 0, deleted: 0, collections: {} };
    prepared.forEach(p => {
        _applyLocal(p.col, p);
        const c = result.collections[p.col] || (result.collections[p.col] = { written: 0, deleted: 0 });
        if (p.op === 'delete') { c.deleted++; result.deleted++; } else { c.written++; result.written++; }
    });
    console.log('☁️ applyItemOps:', Object.entries(result.collections).map(([k, v]) => `${k} ${v.written}↑ ${v.deleted}✕`).join(' · '));
    result.ids = prepared.map(p => p.id);
    return result;
};

export const upsertItem = window.upsertItem = (col, item, opts) => applyItemOps([{ op: 'set', col, item }], opts);
export const appendItem = window.appendItem = (col, item, opts) => applyItemOps([{ op: 'set', col, item, mustBeNew: true }], opts);
export const updateItems = window.updateItems = (col, list, opts) => applyItemOps((list || []).map(x => ({ op: 'update', col, id: x.id, fields: x.fields })), opts);
export const updateItem = window.updateItem = (col, id, fields, opts) => applyItemOps([{ op: 'update', col, id, fields }], opts);
export const removeItem = window.removeItem = (col, id, opts) => applyItemOps([{ op: 'delete', col, id }], opts);
export const bulkRemove = window.bulkRemove = (col, ids, opts) => applyItemOps((ids || []).map(id => ({ op: 'delete', col, id })), opts);

// Id ile arama (render'lar data-id taşır; indeks yerine bu kullanılır).
export const findItem = window.findItem = (col, id) => (window.data[col] || []).find(_sameId(id)) || null;

// [WHY]: Uygulama açılır açılmaz verileri çekmek 'Missing Permissions' hatasına sebep oluyordu.
// [HOW]: Auth durumunu (onAuthStateChanged) dinleyerek sadece oturum açan kullanıcılara veriyi açıyoruz.
// [WHY]: Faz 4 · J3 (AUTH-05) — admin oturumu sekmeye bağlı (sessionStorage). Varsayılan getAuth açılışta önce IndexedDB'ye
//        bakar: başka bir sekmenin anonim oturumu orada olunca aynı sekmedeki admin oturumu F5'te yok sayılıp siliniyordu.
// [HOW]: Açılış sırası sekme → yerel → (eski istemcilerin) IndexedDB. Anonim oturum her zaman yerel kalıcılıkta açılır
//        (aşağıda, signInAnonymously öncesi); J3 öncesi istemcinin IndexedDB'de bıraktığı oturum okunur ve yerele taşınır.
//        security.js aynı örneği getAuth(app) ile alır.
const auth = initializeAuth(app, { persistence: [browserSessionPersistence, browserLocalPersistence, indexedDBLocalPersistence] });
// Emülatör: aynı Auth örneğini security.js / timer.js / auth-engine de getAuth(app) ile alır; bağlantı ilk işlemden önce.
if (EMULATOR_MODE) connectAuthEmulator(auth, `http://${EMULATOR_HOST}:9099`, { disableWarnings: true });
window.userAuth = null;
let isSyncStarted = false;

// [BUGFIX] Bug 1: Expose isSyncStarted reset so onAppLogout can clear it.
// [WHY]: After logout(), all onSnapshot listeners die with permission-denied.
//        Without resetting this flag, onAuthStateChanged won't restart them on re-login.
// [HOW]: Listen for the 'onAppLogout' custom event (fired by auth-engine.js handleLogout)
//        and reset isSyncStarted=false so the next successful Firebase auth triggers a fresh startRealtimeSync().
// J3: çıkış zinciri (SecurityConfig.logout) dinleyicileri signOut'tan ÖNCE zaten kapatır. Yeni anonim oturum bu olaydan önce
//     gelip senkronu kendi adına başlattıysa durdurulmaz (aksi halde kilit/çıkış süresince dinleyici kalmazdı).
window.addEventListener('onAppLogout', () => {
    const u = window.userAuth;
    if (_syncRunning && u && u.isAnonymous && _syncUid === u.uid) {
        console.log('🔄 [firebase-handler] onAppLogout: senkron yeni anonim oturumla zaten çalışıyor.');
        return;
    }
    console.warn('🔄 [firebase-handler] onAppLogout alındı — dinleyiciler kapatılıyor. Yeniden giriş, listener motoru yeniden başlatacak.');
    stopRealtimeSync();
    isSyncStarted = false;
});

onAuthStateChanged(auth, async (user) => {
    if (user) {
        window.userAuth = user;
        console.log("✅ [Auth] Firebase Oturumu Doğrulandı UID:", user.uid);

        // Faz 3.8: oturum hazır — bekleyenleri çöz ve olayı yayınla (anonim veya admin oturumu, her açılışta)
        const resolvers = _authReadyResolvers; _authReadyResolvers = [];
        resolvers.forEach(r => { try { r(user); } catch (e) { } });
        window.dispatchEvent(new CustomEvent('onAuthReady', { detail: { uid: user.uid, isAnonymous: !!user.isAnonymous } }));

        // [BUGFIX] Bug 1: isSyncStarted=false (reset by onAppLogout) allows this block
        // to re-fire startRealtimeSync() after a logout+re-login without a page refresh.
        // Faz 3.8: SecurityConfig.logout dinleyicileri kapatır (_syncRunning=false). Çıkış sonrası anonim oturum
        // 'onAppLogout' olayından önce gelse bile senkron yeniden başlar; aksi halde dinleyiciler ölü kalırdı.
        // J3 (M10): çıkış/kilit sonrası gelen YENİ anonim oturum, başka bir oturum adına açılmış (signOut ile ölmüş) senkronu
        //     devralmaz — yeniden başlatır. Anonim → admin geçişinde (giriş, kilit açma) Firestore aynı dinleyicileri yeni
        //     kimlikle sürdürür; orada yeniden okuma yapılmaz (kota), kilit açma ayrıca ensureRealtimeSync çağırır.
        if (!isSyncStarted || !_syncRunning || (user.isAnonymous && _syncUid !== user.uid)) {
            isSyncStarted = true;
            window.startRealtimeSync();
        }

        // [WHY]: When Firebase Auth is successfully verified/changed asynchronously, we must re-evaluate the routing and view states in script.js.
        // [HOW]: We call window.checkAuth() if script.js has registered it to globally trigger the UI state transition.
        if (typeof window.checkAuth === 'function') {
            window.checkAuth();
        }
    } else {
        // [WHY]: Faz 4B · J10 (Aşama B) — anonim oturum kaldırıldı: kurallar ziyaretçiye hiçbir şey açmaz (J10 PRI: giriş veritabanını okumaz) ve
        //        anonim sağlayıcı Console'da kapatılır. Eskiden burada her oturumsuz sayfa anonim oturum açıyordu.
        // [HOW]: Oturum yok → senkron durur, giriş ekranı gösterilir (checkAuth). Giriş = personel hesabı ya da yönetici.
        window.userAuth = null;
        console.warn("⚠️ [Auth] Oturum yok — giriş bekleniyor (anonim oturum açılmaz).");
        if (_syncRunning) stopRealtimeSync();
        isSyncStarted = false;
        window.isFirebaseLoaded = false;
        if (typeof window.checkAuth === 'function') window.checkAuth();
    }
    _markAuthKnown();
});

// window.addEventListener("load", () => {
// DB kontrolü if (!window.db) { console.error("❌ Firebase DB bulunamadı!"); hata verirse

window.fbFunctions = {
    collection: collection,
    onSnapshot: onSnapshot,
    getDoc: getDoc,
    doc: doc,
    setDoc: setDoc
};

window.migrateDataFromOldToNew = async function () {
    console.log("🚀 MIGRATION BAŞLADI: Eski veriler Sub-collection'lara aktarılıyor...");
    const collections = COLLECTIONS;

    for (const colName of collections) {
        try {
            const oldDocRef = doc(fireDb, "inventory", colName);
            const oldDocSnap = await getDoc(oldDocRef);

            if (oldDocSnap.exists() && oldDocSnap.data().items) {
                const items = oldDocSnap.data().items;
                console.log(`⏳ ${colName} taşınıyor... (${items.length} kayıt)`);

                const operations = [];
                items.forEach(item => {
                    if (!item || typeof item !== 'object') return; // Sadece geçerli objeler

                    // [ID Fallback]
                    if (!item.id || String(item.id).trim() === '') {
                        item.id = 'temp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
                    }

                    // [Undefined Sanitization]
                    const cleanItem = JSON.parse(JSON.stringify(item, (k, v) => v === undefined ? "" : v));

                    // Firestore doküman yolları '/' barındıramaz, underscore ile değiştir
                    const safeId = String(item.id).replace(/\//g, '_');

                    // [ENV_GUARD] Migrasyon da her zaman aktif ortam root'una yazar.
                    operations.push({ ref: doc(fireDb, COLLECTION_ROOT, colName, "items", safeId), data: cleanItem });
                });

                const CHUNK_SIZE = 490;
                for (let i = 0; i < operations.length; i += CHUNK_SIZE) {
                    const batch = writeBatch(fireDb);
                    const chunk = operations.slice(i, i + CHUNK_SIZE);
                    chunk.forEach(op => batch.set(op.ref, op.data, { merge: true }));
                    await batch.commit();
                }
                console.log(`✅ ${colName} aktarıldı!`);
            } else {
                console.log(`⚠️ ${colName} için eski veri bulunamadı.`);
            }
        } catch (e) {
            console.error(`❌ ${colName} taşınırken hata:`, e);
        }
    }
    console.log("🎉 MIGRATION TAMAMLANDI! Sayfayı yenileyebilirsiniz.");
};

// ─── Stok durum mantığı (Faz 3.5 · DATA-05, INV-07) ───────────────────────────────────────────────
// [WHY]: Her stok hareketi durumu koşulsuz "Kullanıma Hazır" / "Tükendi" yapıyordu: "Pasif", "Hurda", "Servis Sürecinde"
//        gibi elle verilmiş durumlar ilk çıkışta siliniyordu; durum hem 'durumu' hem 'status' alanına yazıldığı için B1
//        kayıtlarına yabancı bir 'status' alanı ekleniyordu.
// [HOW]: Yalnız stoktan türeyen geçişler yapılır:
//          - stok 0'a düşerken durum bir "kullanılabilirlik" durumuysa ('', Kullanıma Hazır, Mevcut, Aktif) → "Tükendi";
//            önceki durum stokOncekiDurum alanında saklanır.
//          - durum "Tükendi" iken stok 0'ın üstüne çıkarsa → saklanan önceki durum (yoksa "Kullanıma Hazır").
//          - diğer tüm durumlar (Pasif, Hurda, Servis Sürecinde, Sıfır, Eski Cihaz, Yedek Parça…) HİÇ değiştirilmez.
//        Durum yalnız kaydın zaten kullandığı alan(lar)a yazılır (B2 'status', B1 'durumu'); lastUpdate güncellenir.
export const STOCK_AUTO_READY = Object.freeze(['', 'Kullanıma Hazır', 'Mevcut', 'Aktif']);
export const STOCK_AUTO_EMPTY = Object.freeze(['Tükendi', 'Tükendi / Pasif']);

export const computeStockPatch = window.computeStockPatch = function (colName, data, delta) {
    const qtyField = data.adet !== undefined ? 'adet' : (data.qty !== undefined ? 'qty' : 'adet');
    const before = parseInt(data[qtyField] ?? 0, 10) || 0;
    const after = before + delta;
    const statusFields = ['durumu', 'status'].filter(f => data[f] !== undefined);
    if (statusFields.length === 0) statusFields.push(colName === 'b2' ? 'status' : 'durumu');
    const current = String(data[statusFields[0]] ?? '').trim();

    const patch = { [qtyField]: after, lastUpdate: Date.now() };
    if (qtyField === 'adet' && data.qty !== undefined) patch.qty = after;
    let status = current, clearPrev = false;
    if (after === 0 && before > 0 && STOCK_AUTO_READY.includes(current)) {
        status = 'Tükendi';
        patch.stokOncekiDurum = current || 'Kullanıma Hazır';
    } else if (after > 0 && STOCK_AUTO_EMPTY.includes(current)) {
        status = data.stokOncekiDurum || 'Kullanıma Hazır';
        clearPrev = data.stokOncekiDurum !== undefined;
    }
    if (status !== current) statusFields.forEach(f => { patch[f] = status; });
    return { patch, clearPrev, before, after, statusBefore: current, statusAfter: status };
};

// ─── Atomik stok işlemleri (Faz 3.4 · DATA-09, INV-04, EBYS-21) ──────────────────────────────────
// [WHY]: Çıkış, sepet, zimmet ata/iade, talep onayı ve servisten dönüş stoğu bir transaction'la, hareket kaydını (b3,
//        assignments, requests, serviceRecords) ayrı bir yazmayla güncelliyordu; ikinci adım başarısız olursa stok düşmüş ama
//        kayıt yok kalıyordu (telafi de başarısız olabilirdi). Sepet stoğu istemcide hesaplayıp tüm veritabanını yazıyordu
//        (iki cihaz aynı anda çıkınca biri diğerini eziyordu); servisten dönüşte servis kaydı silinip ürün yazılamayınca ürün
//        kayboluyordu.
// [HOW]: runStockOps({stock, writes}) HEPSİNİ tek bir Firestore transaction'ında yapar: stok dokümanları sunucudan okunur,
//        yeterlilik orada kontrol edilir, stok + durum (computeStockPatch) ve tüm kayıt yazmaları birlikte işlenir — ya hepsi
//        ya hiçbiri. Eşzamanlı başka bir yazma olursa Firestore transaction'ı yeniden dener; stok asla eksiye düşmez.
//          stock:  [{ col, id, delta }]                   aynı doküman birden çok kez geçerse deltalar toplanır
//                  [{ col, id, delta, createIfMissing }]  doküman yoksa createIfMissing yazılır (servisten dönüş)
//          writes: [{ op:'set', col, item } | { op:'update', col, id, fields } | { op:'delete', col, id }]
//        Yalnız Firebase admin oturumu (karar 3: stok hareketleri Faz 4 yetki matrisine kadar yöneticide).
//        Dönüş: { stock: [{col, id, name, before, after, statusBefore, statusAfter, created}], ids: [yazılan kayıt id'leri] }
export const EXIT_ADMIN_ONLY_MESSAGE = window.EXIT_ADMIN_ONLY_MESSAGE = 'Çıkış işlemi yalnızca sistem yöneticisi tarafından yapılabilir.';
const STOCK_COLLECTIONS = ['b1', 'b2'];

// Transaction'ın saf hesaplama kısmı (okunan dokümanlar → yazılacak stok değişiklikleri). Sunucu verisiyle transaction
// içinde çağrılır; saf olduğu için ayrıca test edilebilir. Yetersiz stok veya eksik dokümanda SaveDataError fırlatır.
export const planStockOps = window.planStockOps = function (entries, datas) {
    return entries.map((e, i) => {
        const data = datas[i];
        if (!data) {
            if (!e.createIfMissing) throw new SaveDataError('not-found', `Stok kaydı bulunamadı (${e.col}/${e.id}); liste güncellenmiş olabilir.`);
            const item = _clean({ ..._stripRenderFields(e.createIfMissing), id: e.id, lastUpdate: Date.now() });
            return { col: e.col, id: e.id, name: item.ürün || item.name || e.id, before: 0, after: parseInt(item.adet ?? item.qty ?? 0, 10) || 0, created: true, full: item };
        }
        const name = data.ürün || data.name || e.id;
        const r = computeStockPatch(e.col, data, e.delta);
        if (r.after < 0) throw new SaveDataError('insufficient-stock', `Yetersiz stok: "${name}" (mevcut ${r.before}, istenen ${-e.delta}).`, { col: e.col, id: e.id, before: r.before });
        return { col: e.col, id: e.id, name, before: r.before, after: r.after, statusBefore: r.statusBefore, statusAfter: r.statusAfter, patch: r.patch, clearPrev: r.clearPrev };
    });
};

export const runStockOps = window.runStockOps = async function ({ stock = [], writes = [] } = {}, opts = {}) {
    const strict = opts.strict !== false;
    const fail = (code, message, details) => {
        const err = new SaveDataError(code, message, details);
        console.error(`❌ runStockOps [${code}]: ${message}`, details || '');
        if (strict) throw err;
        return false;
    };
    if (!window.userAuth) return fail('no-auth', 'Oturum bulunamadı; işlem yapılamadı.');
    if (!(typeof window.isDbAdmin === 'function' && window.isDbAdmin())) return fail('forbidden', opts.forbiddenMessage || EXIT_ADMIN_ONLY_MESSAGE);

    // Stok girdilerini doküman başına birleştir
    const stockByKey = new Map();
    for (const s of stock) {
        if (!s || !STOCK_COLLECTIONS.includes(s.col) || s.id == null || s.id === '') return fail('invalid-argument', 'Stok işlemi b1/b2 koleksiyonu ve ürün id bekliyor.', s);
        const delta = Number(s.delta || 0);
        if (!Number.isInteger(delta)) return fail('invalid-argument', 'Stok değişimi tam sayı olmalı.', s);
        const key = `${s.col}|${s.id}`;
        const prev = stockByKey.get(key);
        if (prev) prev.delta += delta;
        else stockByKey.set(key, { col: s.col, id: String(s.id), delta, createIfMissing: s.createIfMissing || null });
    }

    const prepared = [];
    for (const o of writes) {
        if (!o || !COLLECTIONS.includes(o.col)) return fail('unknown-collection', `Bilinmeyen koleksiyon: "${o && o.col}"`);
        if (o.op === 'set') {
            const item = _stripRenderFields(o.item || {});
            if (item.id == null || String(item.id).trim() === '') item.id = window.makeId();
            prepared.push({ op: 'set', col: o.col, id: String(item.id), data: _clean(item) });
        } else if (o.op === 'update') {
            const fields = _clean(_stripRenderFields(o.fields || {}));
            delete fields.id;
            prepared.push({ op: 'update', col: o.col, id: String(o.id), data: fields });
        } else if (o.op === 'delete') {
            prepared.push({ op: 'delete', col: o.col, id: String(o.id) });
        } else return fail('invalid-argument', `Bilinmeyen işlem: "${o.op}"`);
    }
    if (stockByKey.size + prepared.length === 0) return fail('invalid-argument', 'En az bir işlem gerekli.');
    const guard = _schemaGuardError(prepared, opts);   // Faz 3.5/K2: b3/b1/b2 sözleşmesi — ihlalde transaction hiç başlamaz (stok da değişmez)
    if (guard) return fail(guard.code, guard.message, guard.details);
    const owner = _ownerGuardError(prepared);           // Faz 4B · J9: sahiplik alanları değiştirilemez
    if (owner) return fail(owner.code, owner.message, owner.details);
    if (_bulkLockBlocks([...[...stockByKey.values()].map(s => s.col), ...prepared.map(p => p.col)])) {
        _announceDenied('bulk-locked', BULK_LOCK_MESSAGE);
        return fail('bulk-locked', BULK_LOCK_MESSAGE);
    }

    let stockResults;
    try {
        stockResults = await runTransaction(fireDb, async (tx) => {
            const entries = [...stockByKey.values()];
            const snaps = [];
            for (const e of entries) snaps.push(await tx.get(_docRef(e.col, e.id)));   // tüm okumalar yazmalardan önce
            const results = planStockOps(entries, snaps.map(sn => sn.exists() ? sn.data() : null));
            results.forEach(r => {
                const ref = _docRef(r.col, r.id);
                if (r.created) tx.set(ref, r.full);
                else tx.update(ref, r.clearPrev ? { ...r.patch, stokOncekiDurum: deleteField() } : r.patch);
            });
            prepared.forEach(p => {
                const ref = _docRef(p.col, p.id);
                if (p.op === 'set') tx.set(ref, p.data);
                else if (p.op === 'update') tx.update(ref, p.data);
                else tx.delete(ref);
            });
            return results;
        });
    } catch (e) {
        if (e && e.name === 'SaveDataError') return fail(e.code, e.message, e.details);
        if (e && e.code === 'permission-denied') return fail('forbidden', opts.forbiddenMessage || EXIT_ADMIN_ONLY_MESSAGE, { code: e.code });
        if (e && e.code === 'not-found') return fail('not-found', 'Güncellenecek kayıt bulunamadı; başka biri silmiş olabilir.', { code: e.code });
        return fail('write-failed', `İşlem kaydedilemedi: ${e && e.message}`, { code: e && e.code });
    }

    // Bellek ve mirror'ı hemen güncelle (snapshot beklenmeden doğru çizim)
    stockResults.forEach(r => {
        if (r.created) { _applyLocal(r.col, { op: 'set', id: r.id, data: r.full }); return; }
        _applyLocal(r.col, { op: 'update', id: r.id, data: r.patch });
        if (r.clearPrev) {
            [window.data, window._dbMirror].forEach(st => { const it = (st[r.col] || []).find(_sameId(r.id)); if (it) delete it.stokOncekiDurum; });
        }
    });
    prepared.forEach(p => _applyLocal(p.col, p));
    const out = { stock: stockResults.map(({ patch, full, clearPrev, ...rest }) => rest), ids: prepared.map(p => p.id) };
    console.log('☁️ runStockOps:', out.stock.map(s => `${s.col}/${s.id} ${s.before}→${s.after}`).join(' · '), '| kayıt:', prepared.map(p => `${p.op}:${p.col}`).join(', '));
    return out;
};

// Tekil çıkış: stok -qty + b3 hareket kaydı (+ isteğe bağlı ek yazmalar) tek transaction'da.
export const runExitTransaction = window.runExitTransaction = function ({ repo, productId, qty, b3Entry, extraWrites = [] }, opts) {
    return runStockOps({
        stock: [{ col: repo, id: productId, delta: -Math.abs(Number(qty) || 0) }],
        writes: [{ op: 'set', col: 'b3', item: { ...b3Entry, productId } }, ...extraWrites]
    }, opts);
};

// Tek ürün stok değişimi (FAB ±, telafiler). Aynı çekirdek (runStockOps): sunucuda doğrulama + 3.5 durum mantığı.
// Hata fırlatır (SaveDataError; message kullanıcıya gösterilebilir). Dönüş: { before, after, statusBefore, statusAfter }.
export const runStockTransaction = window.runStockTransaction = async function (colName, docId, delta) {
    if (!docId) throw new SaveDataError('invalid-argument', 'Geçersiz Doküman ID.');
    const res = await runStockOps({ stock: [{ col: colName, id: docId, delta }] }, { strict: true, forbiddenMessage: 'Stok işlemleri yalnızca sistem yöneticisi tarafından yapılabilir.' });
    return res.stock[0];
};

// ─── Hepsi-ya-da-hiçbiri toplu yazma (Faz 5 denetimi · P0/P1) ─────────────────────────────────────
// [WHY]: Yedekten geri yükleme ve CSV/Excel içe aktarma saveData'nın 490'lık bağımsız batch'leriyle yazılıyordu; ara bir
//        batch başarısız olursa Firestore'da yarım veri kalıyordu. Bkz. src/services/atomic-writer.js (günlük + geri alma).
// [HOW]: restoreCollections — koleksiyonları yedekteki hâline TAM DEĞİŞTİRMEYLE getirir (plan sunucudan taze okunur,
//        _dbMirror'a güvenilmez). atomicInsertItems — yeni kayıtları ekler. İkisi de yazmadan ÖNCE şema muhafızından geçer
//        (b1/b2 tam 'set' sözleşmesi, gevşetme yok) ve yalnız Firebase admin oturumuyla çalışır. Hata sözleşmesi saveData ile
//        aynı (strict → SaveDataError); motor kodları korunur: 'rolled-back' | 'rollback-pending' | 'pending-journal' | …
const _atomicStore = () => window.AtomicWriter.createFirestoreStore({
    db: fireDb, root: COLLECTION_ROOT, fns: { doc, collection, getDoc, getDocs, writeBatch, Timestamp },
});

// Toplu yazmanın şema muhafızı: b1/b2 → tam sözleşme ('set'); b3 → yeni doküman tam sözleşme, var olan dokümanda yalnız
// yeni alan adları (saveData ile aynı kural; geri yükleme eski göç kayıtları için b3Legacy verir).
function _bulkSchemaGuard(entries, opts) {
    const prepared = entries.filter(e => e.next).map(e => {
        if (e.col === 'b3' && e.prev) {
            return { op: 'update', col: e.col, id: e.id, data: Object.fromEntries(Object.entries(e.next).filter(([k]) => !(k in e.prev))) };
        }
        return { op: 'set', col: e.col, id: e.id, data: e.next };
    });
    return _schemaGuardError(prepared, opts);
}

async function _runBulk({ name, collections, entries, opts }) {
    const strict = opts.strict !== false;
    const fail = (code, message, details) => {
        const err = new SaveDataError(code, message, details);
        console.error(`❌ ${name} [${code}]: ${message}`, details || '');
        if (strict) throw err;
        return false;
    };
    if (!window.userAuth) return fail('no-auth', 'Oturum bulunamadı; yazma reddedildi.');
    if (!(typeof window.isDbAdmin === 'function' && window.isDbAdmin())) return fail('forbidden', 'Toplu yazma yalnız yönetici oturumuyla yapılabilir.');
    if (!window.AtomicWriter) return fail('write-failed', 'Toplu yazma motoru (atomic-writer.js) yüklenmemiş.');
    if (_bulkActive) return fail('bulk-locked', 'Bu sekmede başka bir toplu yazma sürüyor.');
    const unknown = collections.find(c => !COLLECTIONS.includes(c));
    if (unknown) return fail('unknown-collection', `Bilinmeyen koleksiyon: "${unknown}"`, { collection: unknown });

    _bulkActive = { collections };
    try {
        const res = await window.AtomicWriter.run({
            store: _atomicStore(), kind: name, collections, uid: window.userAuth.uid, entries,
            guard: list => _bulkSchemaGuard(list, opts),
        });
        console.log(`☁️ ${name}: ${res.written} yazıldı · ${res.deleted} silindi · ${res.chunks} parça${res.journaled ? ' (günlüklü)' : ' (tek atomik batch)'}`);
        return res;
    } catch (e) {
        if (e && e.name === 'SaveDataError') return fail(e.code, e.message, e.details);
        if (e && e.code === 'rollback-pending') setTimeout(() => _scheduleBulkRecovery(0, true), 30000);
        if (e && e.name === 'AtomicWriteError') return fail(e.code, e.message, e.details);
        const denied = _deniedFailure(e);
        if (denied) return fail(denied.code, denied.message, { code: e.code });
        return fail('write-failed', `Toplu yazma başarısız; hiçbir kayıt yazılmadı: ${e && e.message}`, { code: e && e.code });
    } finally {
        _bulkActive = null;
    }
}

/**
 * Koleksiyonları hedef içeriklerine (yedek) hepsi-ya-da-hiçbiri olarak getirir. Yalnız target'taki koleksiyonlar değişir.
 * @param {Object<string, object[]>} target
 * @param {{b3Legacy?:boolean, strict?:boolean}} [opts]
 */
export const restoreCollections = window.restoreCollections = async function (target, opts = {}) {
    const cols = Object.keys(target || {});
    if (!cols.length || cols.some(c => !Array.isArray(target[c]))) {
        if (opts.strict === false) return false;
        throw new SaveDataError('invalid-argument', 'restoreCollections { koleksiyon: dizi } bekliyor.');
    }
    const res = await _runBulk({
        name: 'restoreCollections', collections: cols, opts,
        entries: async store => window.AtomicWriter.planRestore({
            target, server: await window.AtomicWriter.readCollections(store, cols), makeId: window.makeId,
        }),
    });
    if (res) {
        cols.forEach(col => {
            window.data[col] = target[col].map(x => _clean(_stripRenderFields(x)));
            window._dbMirror[col] = _clone(window.data[col]);
        });
        _bumpDataRevision();
    }
    return res;
};

/** Yeni kayıtları (id'leri dolu ve benzersiz) hepsi-ya-da-hiçbiri olarak ekler — CSV/Excel içe aktarma. */
export const atomicInsertItems = window.atomicInsertItems = async function (col, items, opts = {}) {
    if (!Array.isArray(items) || !items.length || items.some(x => !x || x.id == null || String(x.id).trim() === '')) {
        if (opts.strict === false) return false;
        throw new SaveDataError('invalid-argument', 'atomicInsertItems id\'li kayıt dizisi bekliyor.');
    }
    const known = new Set([...(window._dbMirror[col] || []), ...(window.data[col] || [])].map(x => x && String(x.id)));
    const seen = new Set();
    for (const it of items) {
        const id = String(it.id);
        if (known.has(id) || seen.has(id)) {
            if (opts.strict === false) return false;
            throw new SaveDataError('duplicate-id', `"${col}" içinde ${id} id'li kayıt zaten var.`, { collection: col, id });
        }
        seen.add(id);
    }
    const clean = items.map(x => _clean(_stripRenderFields(x)));
    const res = await _runBulk({
        name: 'atomicInsertItems', collections: [col], opts,
        entries: clean.map(x => ({ col, id: String(x.id).replace(/\//g, '_'), prev: null, next: x })),
    });
    if (res) clean.forEach(x => _applyLocal(col, { op: 'set', id: x.id, data: x }));
    return res;
};

/** Yarım kalmış toplu yazmayı kurtarır (yazılmış parçaları geri alır ya da tamamlanmış işin günlüğünü temizler). */
export const recoverBulkWrite = window.recoverBulkWrite = async function ({ force = false } = {}) {
    if (!(typeof window.isDbAdmin === 'function' && window.isDbAdmin())) throw new SaveDataError('forbidden', 'Kurtarma yalnız yönetici oturumuyla yapılabilir.');
    if (_bulkActive) return { status: 'busy', retryInMs: 30000 };
    return window.AtomicWriter.recover({ store: _atomicStore(), force });
};

// Kilit görülünce (admin_settings snapshot'ı ya da admin oturumu açılışı) yönetici sekmesinde kurtarma otomatik denenir.
// Sahibi canlı olabilecek iş (son 2 dk içinde ilerlemiş) beklenir; yönetici olmayan sekme hiçbir şey yapmaz.
let _recoveryTimer = null;
function _scheduleBulkRecovery(delay = 3000, force = false) {
    if (_recoveryTimer) return;
    _recoveryTimer = setTimeout(async () => {
        _recoveryTimer = null;
        const L = window.data && window.data.config && window.data.config.restoreLock;
        if ((!L && !force) || _bulkActive || !window.AtomicWriter) return;
        if (!(typeof window.isDbAdmin === 'function' && window.isDbAdmin())) return;   // admin girişinde onAuthReady yeniden dener
        try {
            const r = await recoverBulkWrite({ force });
            if (r.status === 'busy') { _scheduleBulkRecovery(r.retryInMs); return; }
            if (r.status === 'rolled-back') {
                console.warn('♻️ [atomic-writer] Yarım kalmış toplu yazma geri alındı:', r.journal && r.journal.kind);
                if (typeof window.showAppAlert === 'function') window.showAppAlert('Yarım kalmış bir toplu yazma (geri yükleme / içe aktarma) geri alındı; veriler işlem öncesi hâline döndü.', 'warning');
            } else if (r.status === 'finalized') {
                console.log('♻️ [atomic-writer] Tamamlanmış toplu yazmanın günlüğü temizlendi.');
            }
        } catch (e) {
            console.error('❌ [atomic-writer] Kurtarma başarısız; 60 sn sonra yeniden denenecek.', e);
            _scheduleBulkRecovery(60000, force);
        }
    }, delay);
}
window.addEventListener('onAuthReady', () => {
    if (window.data && window.data.config && window.data.config.restoreLock) _scheduleBulkRecovery();
});

// ─── Personel Auth hesabı açma (Faz 4B · J7 · 4.6 / K4) ─────────────────────────────────────────────
// [WHY]: Aşama B'de her personelin kendi Firebase Auth hesabı olacak. Ana Auth örneğiyle hesap açmak, Firebase'in yeni
//        hesapla oturum açması demek — admin oturumu düşerdi.
// [HOW]: Hesaplar staff-provisioning.js'in ikincil app örneğinde ('provisioner', bellek içi kalıcılık) açılır. Bağlama ana
//        oturumdaki admin yazmasıdır, sırası bilinçli:
//          1) ${root}/staffAccounts/items/{uid} → { personelId, pri } — kuralların isStaff eşlemesi (PRI e-postasından personel
//             kaydının id'si türetilemez; uid → personel). Yalnız yönetici yazar ve okur.
//          2) personel.uid / authEmail / pri / authProvisionedAt (updateItem).
//        2. adım düşerse eşleme tek başına yetki vermez: kural personel kaydındaki uid ve PRI'yi de doğrular. Yalnız Firebase admin.
let _staffProvisioner = null;
const _getStaffProvisioner = () => _staffProvisioner || (_staffProvisioner = window.StaffProvisioning.createAuthProvisioner({
    fns: { initializeApp, getApps, initializeAuth, inMemoryPersistence, connectAuthEmulator, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, updateEmail },
    options: firebaseConfig,
    emulatorUrl: EMULATOR_MODE ? `http://${EMULATOR_HOST}:9099` : null,
}));
const _staffAccountRef = uid => doc(fireDb, COLLECTION_ROOT, 'staffAccounts', 'items', String(uid));
async function _linkStaffAccount(person, fields) {
    if (fields.uid) await setDoc(_staffAccountRef(fields.uid), { personelId: String(person.id), pri: fields.pri || person.pri, linkedAt: Date.now() });
    // Yalnız değişen alanlar yazılır (göç aracının "eşlemeyi yenile" geçişi personel kaydını gereksiz yere yazmasın)
    const live = (window.data.personel || []).find(_sameId(person.id)) || person;
    const changed = {};
    for (const [k, v] of Object.entries(fields)) if (k !== 'authProvisionedAt' && live[k] !== v) changed[k] = v;
    if (!Object.keys(changed).length) return;
    if (fields.authProvisionedAt !== undefined) changed.authProvisionedAt = fields.authProvisionedAt;
    await updateItem('personel', person.id, changed);
}
function _requireProvisioningAdmin() {
    if (!window.StaffProvisioning) throw new SaveDataError('write-failed', 'Hesap açma modülü (staff-provisioning.js) yüklenmemiş.');
    if (!(typeof window.isDbAdmin === 'function' && window.isDbAdmin())) throw new SaveDataError('forbidden', 'Personel hesabı yalnız yönetici oturumuyla açılabilir.');
}
// [WHY]: J10 istemcisi J10 kuralları yayınlanmamış bir projeye bağlıyken hesap AÇILIYOR ama eşleme yazılamıyordu (eski kurallarda
//        staffAccounts yok → permission-denied): Firebase Auth'ta bağsız, gerçek hesaplar kalıyordu (saha bulgusu).
// [HOW]: Hesap açmadan / taşımadan ÖNCE yönetici eşleme koleksiyonunu okuyabiliyor mu bakılır (J10 kuralı: yalnız admin okur).
//        Okuyamıyorsa hiçbir Auth işlemi yapılmaz. Başarı oturum boyunca hatırlanır.
let _staffRulesReady = false;
async function _requireStaffRules() {
    if (_staffRulesReady) return;
    try {
        await getDoc(_staffAccountRef('kural-denetimi'));
        _staffRulesReady = true;
    } catch (e) {
        const denied = e && e.code === 'permission-denied';
        throw new SaveDataError(denied ? 'rules-not-deployed' : 'write-failed', denied
            ? `Bu ortamın (${COLLECTION_ROOT}) Firestore kuralları J10 (PRI) sürümü değil; hesap AÇILMADI. Önce kurallar yayınlanmalı (emülatörde: adres ?emu=1 ile mi?).`
            : `Kurallar denetlenemedi (${(e && (e.code || e.message)) || 'bilinmeyen hata'}); hesap açılmadı.`);
    }
}

/** Tek personele <pri>@ hesabı açar/bağlar. Dönüş: StaffProvisioning.provisionOne sonucu; kota/kapalı sign-up → status 'stopped'. */
export const provisionStaffAccount = window.provisionStaffAccount = async function (person, { code } = {}) {
    _requireProvisioningAdmin();
    await _requireStaffRules();
    try {
        // J10: kod personel kaydında tutulmaz; yönetici yeni kodu burada verir (verilmezse eski kayıttaki kod — kod temizliğinden önce)
        return await window.StaffProvisioning.provisionOne(person, _getStaffProvisioner(), _linkStaffAccount, { code });
    } catch (e) {
        if (e && e.name === 'ProvisioningStop') return { status: 'stopped', code: e.code, reason: e.message };
        throw e;
    }
};

// ─── PRI / Hesap Göç Aracı (J10 PRI revizyonu) ──────────────────────────────────────────────────────────
// [WHY]: Var olan personelin PRI'si yok; J7'de açılmış hesaplar p<id>@ adresinde. Hepsi <pri>@ adresine geçmeli (uid korunarak).
// [HOW]: Önizleme yerel veriden, YAZMADAN (StaffProvisioning.planAccounts). Uygulama personel listesini sunucudan TAZE okur;
//        önizlemeden sonra değiştiyse hiç yazmadan durur (J9 kuralı). Satırlar sırayla; kota / kapalı özellikte durur, kalan
//        sayı bildirilir; yeniden çalıştırmak güvenlidir (bağlı ve PRI'si doğru personel yalnız eşlemesi yenilenerek geçilir).
export const planStaffAccounts = window.planStaffAccounts = function () {
    _requireProvisioningAdmin();
    return window.StaffProvisioning.planAccounts(window.data.personel || []);
};
export const applyStaffAccounts = window.applyStaffAccounts = async function (plan, { onProgress } = {}) {
    _requireProvisioningAdmin();
    await _requireStaffRules();
    const SP = window.StaffProvisioning;
    const snap = await getDocs(collection(fireDb, COLLECTION_ROOT, 'personel', 'items'));
    const fresh = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (SP.accountsFingerprint(fresh) !== plan.fingerprint) {
        return { aborted: true, results: [], counts: {}, stopped: { code: 'personel-changed', message: 'Personel listesi önizlemeden sonra değişti; aracı yeniden açın.' }, remaining: plan.rows.length };
    }
    const byId = new Map(fresh.map(p => [String(p.id), p]));
    const writePri = (person, pri) => updateItem('personel', person.id, { pri });
    return SP.applyAccounts(plan, byId, _getStaffProvisioner(), _linkStaffAccount, { writePri, onProgress });
};


// ─── Personel hesabıyla giriş (Faz 4B · J8 · 4.6 / K4) ─────────────────────────────────────────────
// [WHY]: J7 hesapları açtı; giriş hâlâ anonim oturumla yapılıyordu. Hesapla giriş, kurallara "kim" bilgisini taşır (J10) ve
//        sayfa yenilemede oturumun korunmasını (K5) Firebase'in kendi kalıcılığına bırakır.
// [HOW]: ANA Auth örneğinde (J7'deki ikincil örnek değil) yerel kalıcılıkla giriş: anonim oturum yerini personel hesabına
//        bırakır, Firestore dinleyicileri yeni kimlikle sürer (anonim → admin geçişindeki gibi). onAuthStateChanged'in
//        window.userAuth'u güncellemesi beklenir; çağıran uid bağını (personel.uid) ayrıca doğrular.
//        J10 PRI: giriş ekranı adresi kullanıcının yazdığı kurumsal kimlikten kurar (<pri>@staff.medipol.local); öncesinde
//        veritabanı okunmaz.
export const signInStaffAccount = window.signInStaffAccount = async function (email, password) {
    await setPersistence(auth, browserLocalPersistence);
    const cred = await signInWithEmailAndPassword(auth, email, password);
    const uid = cred.user.uid;
    const t = Date.now();
    while (!(window.userAuth && window.userAuth.uid === uid) && Date.now() - t < 10000) await new Promise(r => setTimeout(r, 50));
    return cred.user;
};


// ─── Sahiplik Göç Aracı (Faz 4B · J9) ─────────────────────────────────────────────────────────────────
// [WHY]: J9 öncesi kayıtların (talep, satın alma, görev, şablon/akış adımları) sahiplik uid'leri yok; J10 kuralları bunlar
//        olmadan sahibini tanıyamaz.
// [HOW]: Plan ve uygulama mantığı Ownership'te (saf, birim testli); burada yalnız Firestore bağdaştırıcısı ve yetki kapısı.
//        Önizleme yerel veriden, YAZMADAN; uygulama sunucudan taze okuyarak transaction'larla (bkz. Ownership.applyMigration).
const _ownershipStore = () => ({
    async readAll(col) {
        const snap = await getDocs(collection(fireDb, COLLECTION_ROOT, col, 'items'));
        return snap.docs.map(d => ({ id: d.id, data: d.data() }));
    },
    transaction: fn => runTransaction(fireDb, t => fn({
        async get(col, id) { const sn = await t.get(_docRef(col, id)); return sn.exists() ? { id: sn.id, ...sn.data() } : null; },
        update(col, id, patch) { t.update(_docRef(col, id), patch); },
    })),
});
function _requireOwnershipAdmin() {
    if (!window.Ownership) throw new SaveDataError('write-failed', 'Sahiplik modülü (ownership.js) yüklenmemiş.');
    if (!(typeof window.isDbAdmin === 'function' && window.isDbAdmin())) throw new SaveDataError('forbidden', 'Sahiplik göçü yalnız yönetici oturumuyla yapılabilir.');
}

/** Önizleme: hiçbir yere yazmaz (yerel veriden plan). */
export const planOwnershipMigration = window.planOwnershipMigration = function () {
    _requireOwnershipAdmin();
    const d = window.data || {};
    return window.Ownership.planMigration({
        data: { requests: d.requests || [], purchaseOrders: d.purchaseOrders || [], tasks: d.tasks || [], workflowTemplates: d.workflowTemplates || [] },
        personel: d.personel || [],
        accountEmail: window.StaffProvisioning ? window.StaffProvisioning.accountEmailOf : null,
    });
};

/** Uygulama: plan önizlemedeki haliyle; her kayıt transaction içinde yeniden doğrulanır. */
export const applyOwnershipMigration = window.applyOwnershipMigration = async function (plan, { onProgress } = {}) {
    _requireOwnershipAdmin();
    if (_bulkLockBlocks(['requests', 'purchaseOrders', 'tasks'])) throw new SaveDataError('bulk-locked', BULK_LOCK_MESSAGE);
    const res = await window.Ownership.applyMigration({
        plan, store: _ownershipStore(), onProgress,
        accountEmail: window.StaffProvisioning ? window.StaffProvisioning.accountEmailOf : null,
    });
    // Yazılanları yerel kopyaya hemen işle (snapshot beklenmeden; sonraki önizleme tutarlı olsun)
    res.written.forEach(w => {
        if (COLLECTIONS.includes(w.col)) { _applyLocal(w.col, { op: 'update', id: w.id, data: w.patch }); return; }
        const list = (window.data && window.data[w.col]) || [];
        const i = list.findIndex(_sameId(w.id));
        if (i !== -1) list[i] = { ...list[i], ...w.patch };
    });
    console.log(`🪪 Sahiplik göçü: ${res.status} · yazılan ${res.written.length} · atlanan ${res.skipped.length} · düşen ${res.failed.length} · denenmeyen ${res.notAttempted}`);
    return res;
};

// ─── Kod temizliği (Faz 4B · J10) ──────────────────────────────────────────────────────────────────────
// [WHY]: Giriş yalnız Firebase Auth ile yapılıyor; düz metin kodlar (personel.code, requests.personelKodu, eski
//        purchaseOrders.createdBy) veritabanında durmamalı. Kurallar kodun yeniden yazılmasını zaten reddeder.
// [HOW]: Plan Ownership.planCodeCleanse (saf). Önkoşul: tüm personelin geçerli hesabı var ve sahiplik göçünde yazılmamış kayıt
//        kalmadı. Yazma 400'lük batch'lerle (deleteField); her batch kendi içinde atomik, düşen batch ve sonrası raporlanır,
//        yeniden çalıştırma kalanları siler (idempotent). Yalnız Firebase admin.
export const planCodeCleanse = window.planCodeCleanse = function () {
    if (!(typeof window.isDbAdmin === 'function' && window.isDbAdmin())) throw new SaveDataError('forbidden', 'Kod temizliği yalnız yönetici oturumuyla yapılabilir.');
    const own = planOwnershipMigration();
    const d = window.data || {};
    return window.Ownership.planCodeCleanse({
        personel: d.personel || [], requests: d.requests || [], purchaseOrders: d.purchaseOrders || [],
        accountEmail: window.StaffProvisioning ? window.StaffProvisioning.accountEmailOf : null,
        ownershipPendingItems: own.items.length, ownershipIssues: own.issues.length,
    });
};
export const applyCodeCleanse = window.applyCodeCleanse = async function (plan, { onProgress } = {}) {
    if (!(typeof window.isDbAdmin === 'function' && window.isDbAdmin())) throw new SaveDataError('forbidden', 'Kod temizliği yalnız yönetici oturumuyla yapılabilir.');
    if (!plan || !plan.ready) throw new SaveDataError('invalid-argument', 'Kod temizliği önkoşulları sağlanmadı.');
    const ops = [
        ...plan.personel.map(x => ({ col: 'personel', id: x.id, data: { code: deleteField() } })),
        ...plan.requests.map(x => ({ col: 'requests', id: x.id, data: { personelKodu: deleteField() } })),
        ...plan.purchaseOrders.map(x => ({ col: 'purchaseOrders', id: x.id, data: { createdBy: x.replaceWith } })),
    ];
    const res = { written: 0, failed: 0, notAttempted: 0, error: null };
    for (let i = 0; i < ops.length; i += 400) {
        const chunk = ops.slice(i, i + 400);
        try {
            const b = writeBatch(fireDb);
            chunk.forEach(o => b.update(_docRef(o.col, o.id), o.data));
            await b.commit();
        } catch (e) {
            res.failed = chunk.length; res.notAttempted = ops.length - i - chunk.length;
            res.error = { code: (e && e.code) || 'write-failed', message: (e && e.message) || 'bilinmeyen hata' };
            break;
        }
        res.written += chunk.length;
        chunk.forEach(o => {
            for (const store of [window.data, window._dbMirror]) {
                const it = (store[o.col] || []).find(_sameId(o.id));
                if (!it) continue;
                if (o.col === 'personel') delete it.code; else if (o.col === 'requests') delete it.personelKodu; else it.createdBy = o.data.createdBy;
            }
        });
        if (onProgress) onProgress(res.written, ops.length);
    }
    console.log(`🧹 Kod temizliği: ${res.written} yazıldı · ${res.failed} düştü · ${res.notAttempted} denenmedi`);
    return res;
};
