/**
 * FIREBASE HANDLER - Medipol Envanter Takip Sistemi
 * ------------------------------------------------
 * @description Bu modül; veritabanı bağlantısı, admin yetkilendirme mimarisi 
 * ve bulut tabanlı anlık senkronizasyon (Realtime Sync) motorunu yönetir.
 * * GÜVENLİK NOTU: Admin hash'i kodun içinde değil, Firebase 'system_config' 
 * koleksiyonunda saklanır. Bu sayede manuel müdahale ile şifre sıfırlanabilir.
 */

// 1. MODÜLER FIREBASE IMPORTLARI (Versiyon 10+)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
    initializeFirestore,
    collection,
    onSnapshot,
    doc,
    getDoc,
    setDoc,
    writeBatch,
    runTransaction
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
export const COLLECTION_ROOT = (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname.includes('demo')
) ? "inventory_demo" : "inventory_v2";

// [ENV_GUARD] Aktif ortamı geliştirici konsoluna bildiren zorunlu init logu.
// Bu satırı hiçbir zaman kaldırma; üretimde yanlış kök aktifse anında fark edilir.
console.log(`🚀 ACTIVE DATABASE ROOT: ${COLLECTION_ROOT}`);

// [BUGFIX] Zero-Trust COLLECTION_ROOT freeze in window.AppEnv
// [WHY]: Zero-Trust rule requires that COLLECTION_ROOT must not be a bare global string to prevent console bypass.
// [HOW]: Store it in a frozen EnvConfig object exposed via window.AppEnv.
const EnvConfig = { COLLECTION_ROOT: COLLECTION_ROOT };
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

// [WHY]: Legacy loginAsAdmin function was referencing undefined hashing helpers in security.js.
// [HOW]: Refactored to use the modern SecurityConfig.authenticate (Invisible Email Illusion) for security compliance.
window.loginAsAdmin = async function (enteredCode) {
    if (typeof SecurityConfig !== 'undefined' && SecurityConfig.authenticate) {
        const success = await SecurityConfig.authenticate(enteredCode);
        if (success) {
            const expiry = new Date().getTime() + window.AppModules.Session.ADMIN_SESSION_MS;
            localStorage.setItem('admin_auth', JSON.stringify({ expiry: expiry }));
            window.location.href = 'admin.html';
        } else {
            alert("Hatalı kod!");
        }
    } else {
        alert("Güvenlik yapılandırması yüklenemedi!");
    }
};

export const checkAdminAuth = function () {
    const authData = localStorage.getItem('admin_auth');
    const now = new Date().getTime();

    if (!authData) {
        window.location.replace('index.html');
        return;
    }

    const auth = JSON.parse(authData);
    if (now > auth.expiry) {
        localStorage.removeItem('admin_auth');
        window.location.replace('index.html');
        return;
    }
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

// PM NOTU: global scriptler için db window'a bağlandı
window.fireDb = fireDb;

if (!window.data) {
    window.data = { b1: [], b2: [], b3: [], personel: [], requests: [], productTypes: [], tasks: [], config: {}, assignments: [] };
}

window.isFirebaseLoaded = false;
window._dbMirror = {}; // YENİ: Firebase'den gelen saf verilerin kopyası (Değişiklik tespiti için)

/**
 * @function startRealtimeSync
 * @description Uygulamanın 'Canlı Veri' motorudur. 'onSnapshot' kullanarak 
 * Firebase'deki her değişikliği anında (sayfa yenilemeden) arayüze yansıtır.
 */
// [WHY]: Oturum kapat/aç sonrası senkron yeniden başlatılınca eski dinleyiciler ölmemişse çift dinleyici oluşur.
// [HOW]: Her onSnapshot'ın unsubscribe'ı saklanır; yeniden başlatmada önce eskiler kapatılır.
let _syncUnsubscribers = [];

window.startRealtimeSync = function () {
    _syncUnsubscribers.forEach(unsub => { try { unsub(); } catch (e) { } });
    _syncUnsubscribers = [];

    const statusDiv = document.getElementById('loginStatus');
    // [WHY]: Support 'access-val-node' ID which is used in index.html for security obfuscation.
    // [HOW]: Query both ID possibilities to retrieve the actual login input element.
    const loginInput = document.getElementById('loginCode') || document.getElementById('access-val-node');

    if (loginInput) {
        loginInput.disabled = true;
        loginInput.placeholder = "Veriler senkronize ediliyor...";
    }

    // A. ENVANTER VERİLERİNİ DİNLE (COLLECTION_ROOT alt koleksiyonları)
    // [ENV_GUARD] Sabit "inventory_v2" yerine COLLECTION_ROOT kullanılıyor.
    // Bu, demo/localhost ortamında yanlışlıkla üretim verisi dinlenmesini engeller.
    const collectionsToListen = ['b1', 'b2', 'b3', 'personel', 'productTypes', 'purchaseOrders', 'serviceRecords', 'staff', 'units', 'locations', 'tasks', 'requests', 'assignments'];

    collectionsToListen.forEach(colName => {
        _syncUnsubscribers.push(onSnapshot(collection(fireDb, COLLECTION_ROOT, colName, "items"), (snapshot) => {
            console.log(`[DB-PATH-CHECK] Şu an aktif olarak dinlenen koleksiyon: ${COLLECTION_ROOT}/${colName}/items`);

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
                items.push(docSnap.data());
            });

            // Veriyi global hafızaya ve Mirror'a (kopya) al
            window.data[colName] = items;
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

                if (statusDiv) {
                    // [WHY]: Increase sync status visibility duration so the user can easily notice the change.
                    // [HOW]: Change setTimeout delay from 1500ms to 4000ms.
                    statusDiv.innerHTML = '✅ Sistem Hazır.';
                    statusDiv.style.color = "#27ae60";
                    setTimeout(() => { statusDiv.style.display = 'none'; }, 4000);
                }

                if (loginInput) {
                    // [WHY]: Re-enable access code input and present a descriptive, premium placeholder.
                    // [HOW]: Set disabled to false and update placeholder text.
                    loginInput.disabled = false;
                    loginInput.placeholder = "Erişim Kodu Giriniz";
                }
            }
        }, (err) => {
            if(err.code !== "permission-denied") console.error(err);
        }));
    });

    // B. SİSTEM AYARLARINI DİNLE
    _syncUnsubscribers.push(onSnapshot(doc(fireDb, "system_config", "admin_settings"), (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();
            window.data.config = data;
            console.log("⚙️ Hash updated.");

            // [DECOMMISSIONED] Launchpad global şalter dinleme mantığı kaldırıldı.
            if (data.hasOwnProperty('launchpadDisabledGlobal')) {
                localStorage.setItem('launchpadDisabledGlobal', data.launchpadDisabledGlobal);
                if (typeof window.updateActionButtonsState === 'function') {
                    window.updateActionButtonsState();
                }
            }

            // [WHY]: Kill Switch entegrasyonu. Firestore'daki 'maintenance' bayrağını dinleyerek normal kullanıcıları bakım moduna alırız.
            // [HOW]: Admin vizesi (admin_auth) yoksa ve maintenance aktifse localStorage'a yazar ve sayfayı yenileriz.
            if (data.hasOwnProperty('maintenance')) {
                const isMaintenance = data.maintenance === true;

                let isAdmin = false;
                const authData = localStorage.getItem('admin_auth');
                if (authData) {
                    try {
                        const auth = JSON.parse(authData);
                        isAdmin = new Date().getTime() <= auth.expiry;
                    } catch(e) {}
                }

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

            // [WHY]: VIP panelinden "Force Logout" (Oturumu Sonlandır) komutu verilen kullanıcının
            //        tarayıcısında anında çıkış yapılması gerekiyor. Firebase'e yazılan force_logout_user_id
            //        alanı tüm açık client'lara broadcast edilir; bu blok kendi ID'siyle eşleşen kullanıcıyı yakalar.
            // [HOW]: window.currentUser null-guard'ı ile korunur (sayfa yüklenmeden önce null olabilir).
            //        Kullanıcı kimliği için id, code ve name alanlarının üçü de karşılaştırılır;
            //        bu, sistemin farklı bağlamlarda (personel id'si, giriş kodu, isim) kayıt tutmasından kaynaklanır.
            if (data.force_logout_user_id) {
                const targetId = data.force_logout_user_id;

                // 🛡️ NULL-GUARD: window.currentUser henüz yüklenmemiş olabilir (async Firebase init race condition).
                // localStorage'dan da okuyarak ikincil güvenlik ağı kuruyoruz.
                const localUser = window.currentUser || window.getActiveUser();

                if (localUser) {
                    const isMatch = (
                        (localUser.id   && String(localUser.id)   === String(targetId)) ||
                        (localUser.code && String(localUser.code) === String(targetId)) ||
                        (localUser.name && String(localUser.name) === String(targetId))
                    );

                    if (isMatch) {
                        console.warn('🚨 [Force Logout] Bu oturum yönetici tarafından sonlandırıldı. Hedef ID:', targetId);
                        if (typeof window.logout === 'function') {
                            window.logout('force_logout');
                        } else {
                            // Fallback: logout fonksiyonu henüz yüklenmemişse manuel temizle
                            window.clearSession();
                            window.location.replace('index.html');
                        }
                    }
                }
            }
        }
    }, (err) => {
        if (err.code === "permission-denied") console.warn("⏳ [Güvenlik] Firebase yetki onayı bekleniyor (admin_settings)...");
        else console.error("Dinleme hatası:", err);
    }));

    // C. SİSTEM MESAJLARINI DİNLE
    // [WHY]: God-Eye panelinden gönderilen yönetici mesajlarını gerçek zamanlı yakalamak için.
    // [HOW]: system_config/admin_messages belgesindeki target_user_id ile mevcut kullanıcının id/code/name alanlarını karşılaştırır ve eşleşirse alert gösterir.
    _syncUnsubscribers.push(onSnapshot(doc(fireDb, "system_config", "admin_messages"), (docSnap) => {
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
    }, (err) => {
        if(err.code !== "permission-denied") console.error("Sistem mesajı dinleme hatası:", err);
    }));
};

/**
 * @function saveData
 * @description Verileri hem yerel hem de Firebase (Batch Write) üzerine kaydeder.
 * 
 * 🛠️ [AKILLI YAPI NOTU]: Bu fonksiyon 'Overloading' prensibiyle çalışır. 
 * Eskiden sadece tüm veri objesini kabul ederken, artık tekil depo güncellemelerini de
 * (örn: saveData('b1', data)) anlayarak diğer depoların (b2, b3 vb.) üzerine yazılmasını engeller.
 * 
 * 🛡️ [3 KATMANLI VERİ KORUMA KALKANI]:
 * 1. MERGE KALKANI: Sadece belirtilen odayı/depoyu günceller, diğerlerini 'undefined' ise atlar (Ezilme engellenir).
 * 2. ATOMİK KALKAN: 'writeBatch' kullanarak ya hep ya hiç kuralını uygular (Yarım kalmış kayıt oluşamaz).
 * 3. TEMİZLİK KALKANI: Firebase uyumsuz 'undefined' değerleri kayıttan önce JSON sterilizasyonu ile temizler.
 */
// [WHY]: Hibrit ESM geçişi — saveData artık import ile kullanılabilir.
// [HOW]: DUAL-EXPOSURE: export const hem ESM import'a hem window erişimine açar.
//        window.saveData ataması LEGACY uyumluluk için korunur.
export const saveData = window.saveData = async function (arg1, arg2) {
    // [WHY]: Gelen verinin tipine göre davranış belirlemeden önce, giriş yetkisi (Auth) olup olmadığını kontrol et.
    // [HOW]: Eğer window.userAuth yoksa, veritabanına yazma işlemini anında reddet (Frontend Guard).
    if (!window.userAuth) {
        console.error("❌ Yetkisiz Yazma Denemesi: Oturum bulunamadı.");
        return false;
    }

    // [ADIM 1] Akıllı Parametre Yönetimi: Gelen verinin tipine göre davranış belirle
    if (typeof arg1 === 'string' && arg2 !== undefined) {
        // Hedefli Güncelleme: Diğer koleksiyonlara dokunmadan sadece ilgili alanı tazele
        window.data[arg1] = arg2;
    } else if (typeof arg1 === 'object' && arg1 !== null) {
        // Toplu Güncelleme: Tüm veritabanı objesini ana hafızaya al
        window.data = arg1;
    }

    try {
        const collections = ['b1', 'b2', 'b3', 'personel', 'productTypes', 'purchaseOrders', 'serviceRecords', 'staff', 'units', 'locations', 'tasks', 'requests', 'assignments'];

        const operations = []; // Tüm işlemleri bir havuzda topla

        collections.forEach(colName => {
            // [BUGFIX] Bug 3 (Overloading Fix): Eğer hedefli kaydetme (örn: saveData('purchaseOrders', data))
            // yapılıyorsa, diğer koleksiyonları (b1, b2, personel vb.) kesinlikle atla ki yetki hatasına takılmasın.
            if (typeof arg1 === 'string' && colName !== arg1) return;

            // [KALKAN 1] MERGE - Veri hafızada yoksa (undefined) atla
            if (window.data[colName] === undefined) return;

            const itemsToSave = window.data[colName] || [];
            const mirrorItems = window._dbMirror[colName] || [];

            // Farkları (Diff) bul
            const saveIds = new Set(itemsToSave.map(i => i.id));
            const toDeleteIds = mirrorItems.filter(i => !saveIds.has(i.id)).map(i => i.id);

            // Silinecekler
            toDeleteIds.forEach(id => {
                if (!id) return; // Güvenlik: Boş ID'leri atla
                // [FIX]: TypeError ve Firestore kural hatalarını önlemek için String dönüşümü ve '/' karakter koruması eklendi.
                const safeId = String(id).replace(/\//g, '_');
                // [ENV_GUARD] Silme işlemi her zaman aktif ortamın root'una gider.
                // COLLECTION_ROOT, modül yüklenirken bir kez belirlenir ve değişmez.
                operations.push({
                    type: 'delete',
                    ref: doc(fireDb, COLLECTION_ROOT, colName, "items", safeId)
                });
            });

            // Eklenecekler / Güncellenecekler (Upsert)
            itemsToSave.forEach(item => {
                if (!item || typeof item !== 'object') return; // Güvenlik: Yalnızca objeleri işle

                // ID yoksa otomatik ata (hata olmaması için önlem)
                if (!item.id || String(item.id).trim() === '') {
                    item.id = 'temp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
                }

                // [KALKAN 3] TEMİZLİK - undefined olanları sil (Firebase sessiz reddetmesini önler)
                const cleanItem = JSON.parse(JSON.stringify(item, (k, v) => v === undefined ? "" : v));

                // Firestore id içinde '/' veya geçersiz karakter kullanımına izin vermez
                const safeId = String(item.id).replace(/\//g, '_');

                // [ENV_GUARD] Kayıt (set) işlemi yalnızca aktif ortam root'una yazılır.
                // Bu blok, v3.1 ölçeğinde yanlışlıkla üretim üzerine yazma riskini sıfırlar.
                operations.push({
                    type: 'set',
                    ref: doc(fireDb, COLLECTION_ROOT, colName, "items", safeId),
                    data: cleanItem
                });
            });
        });

        // [KALKAN 2] BATCH CHUNKING (500 limitini aşmamak için)
        const CHUNK_SIZE = 490;
        for (let i = 0; i < operations.length; i += CHUNK_SIZE) {
            const batch = writeBatch(fireDb);
            const chunk = operations.slice(i, i + CHUNK_SIZE);

            chunk.forEach(op => {
                if (op.type === 'delete') {
                    batch.delete(op.ref);
                } else {
                    batch.set(op.ref, op.data, { merge: true });
                }
            });

            await batch.commit();
        }

        console.log(`☁️ Firebase Senkronize Edildi (Chunked): ${arg1 || 'Toplu Kayıt'}`);
        return true;
    } catch (e) {
        // [WHY]: Hata yutulduğu için çağıranlar başarısız kaydı "başarılı" gösteriyordu (DATA-02); sonuç artık döndürülüyor.
        console.error("❌ Kayıt Hatası:", e);
        return false;
    }
};

// [WHY]: Uygulama açılır açılmaz verileri çekmek 'Missing Permissions' hatasına sebep oluyordu.
// [HOW]: Auth durumunu (onAuthStateChanged) dinleyerek sadece oturum açan kullanıcılara veriyi açıyoruz.
const auth = getAuth(app);
window.userAuth = null;
let isSyncStarted = false;

// [BUGFIX] Bug 1: Expose isSyncStarted reset so onAppLogout can clear it.
// [WHY]: After logout(), all onSnapshot listeners die with permission-denied.
//        Without resetting this flag, onAuthStateChanged won't restart them on re-login.
// [HOW]: Listen for the 'onAppLogout' custom event (fired by auth-engine.js handleLogout)
//        and reset isSyncStarted=false so the next successful Firebase auth triggers a fresh startRealtimeSync().
window.addEventListener('onAppLogout', () => {
    console.warn('🔄 [firebase-handler] onAppLogout alındı — isSyncStarted sıfırlanıyor. Yeniden giriş, listener motoru yeniden başlatacak.');
    isSyncStarted = false;
});

onAuthStateChanged(auth, async (user) => {
    if (user) {
        window.userAuth = user;
        console.log("✅ [Auth] Firebase Oturumu Doğrulandı UID:", user.uid);

        // [BUGFIX] Bug 1: isSyncStarted=false (reset by onAppLogout) allows this block
        // to re-fire startRealtimeSync() after a logout+re-login without a page refresh.
        if (!isSyncStarted) {
            isSyncStarted = true;
            window.startRealtimeSync();
        }

        // [WHY]: When Firebase Auth is successfully verified/changed asynchronously, we must re-evaluate the routing and view states in script.js.
        // [HOW]: We call window.checkAuth() if script.js has registered it to globally trigger the UI state transition.
        if (typeof window.checkAuth === 'function') {
            window.checkAuth();
        }
    } else {
        window.userAuth = null;
        console.warn("⚠️ [Auth] Oturum Yok Veya Kapandı. Anonim oturum başlatılıyor...");
        // [WHY]: Normal personeller giriş yapmadan personel listesini çekemiyordu. 'Veriler Senkronize Ediliyor' kilidini açmak zorundayız.
        // [HOW]: Kullanıcının aktif bir token'ı yoksa, sadece okuma yetkisine sahip bir Anonim Oturum (Anonymous Auth) başlatıyoruz.
        try {
            await signInAnonymously(auth);
            console.log("✅ [Auth] Anonim Oturum (Okuma Yetkili) başarıyla açıldı.");
        } catch (error) {
            console.error("❌ [Auth] Anonim oturum açılamadı:", error.message);
        }
    }
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
    const collections = ['b1', 'b2', 'b3', 'personel', 'productTypes', 'purchaseOrders', 'serviceRecords', 'staff', 'units', 'locations', 'tasks', 'requests', 'assignments'];

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

// ✅ FIREBASE TRANSACTION: Yarış Durumunu (Race Condition) Önleme Mimari Servisi
// [WHY]: updateStock ve addExit fonksiyonları client-side bellek üzerinden saveData çalıştırdığı için aynı anda iki personel çıkış yaparsa birinin verisi diğerini eziyordu.
// [HOW]: Firebase'in kendi runTransaction metodunu kullanarak doğrudan sunucudan (Atomik) okuma/yazma yaparak negatif stoklara inilmesini engelliyoruz.
// [WHY]: Hibrit ESM geçişi — inventory-logic.js bu fonksiyonu import edebilsin.
// [HOW]: DUAL-EXPOSURE: export const + window bağlaması. Fonksiyon mantığına DOKUNULMADI.
export const runStockTransaction = window.runStockTransaction = async function (colName, docId, delta) {
    if (!window.userAuth) throw new Error("Yetkisiz İşlem: Firebase oturumu yok.");
    if (!docId) throw new Error("Geçersiz Doküman ID.");

    // [ENV_GUARD] runStockTransaction — Atomik stok güncelleme her zaman
    // aktif ortam root'una yönlendirilir. Prod/demo karışımını önler.
    const docRef = doc(fireDb, COLLECTION_ROOT, colName, "items", String(docId));

    await runTransaction(fireDb, async (transaction) => {
        const sfDoc = await transaction.get(docRef);
        if (!sfDoc.exists()) {
            throw new Error("İlgili stok kaydı veritabanında bulunamadı!");
        }

        const data = sfDoc.data();
        let currentQty = parseInt(data.adet || data.qty || 0);
        let newQty = currentQty + delta;

        if (newQty < 0) {
            throw new Error("Yetersiz Stok! Ürün stoku 0'ın altına düşemez.");
        }

        let newStatus = newQty > 0 ? 'Kullanıma Hazır' : 'Tükendi / Pasif';
        if (newQty === 0 && delta < 0) {
            newStatus = 'Tükendi';
        }

        // Atomik Güncelleme
        const updateData = {};
        if (data.adet !== undefined) updateData.adet = newQty;
        if (data.qty !== undefined) updateData.qty = newQty;
        updateData.durumu = newStatus;
        updateData.status = newStatus;

        transaction.update(docRef, updateData);
    });

    console.log(`✅ [TRANSACTION BAŞARILI] ${colName}/${docId} stoğu güncellendi. Delta: ${delta}`);
};
