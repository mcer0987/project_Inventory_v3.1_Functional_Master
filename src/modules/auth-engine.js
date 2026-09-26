/**
 * auth-engine.js — Medipol Envanter Takip Sistemi
 * =================================================
 * v3.1 ESM Modüler Mimari — Phase 2: Kimlik Doğrulama & Yetkilendirme Motoru
 *
 * [WHY]: script.js içindeki auth mantığı (checkIsAdmin, checkAuth, handleLogin,
 *        updateNavbarUI, setupUI, checkAdminAndGo) hem güvenlik kritik hem de
 *        yeniden kullanılabilir işlemlerdir. Monolith'te gömülü olmaları;
 *        1) Test edilmelerini zorlaştırır,
 *        2) admin.html gibi farklı sayfalarda tekrar yazılmalarına yol açar,
 *        3) future Docker/MongoDB API geçişinde bağımlılık haritasını karmaşık hale getirir.
 * [HOW]: Her fonksiyon ayrı export edilir ve window'a da bağlanır (DUAL-EXPOSURE).
 *        Bağımlılıklar (SecurityConfig, showAppAlert, switchTab, updateNavbarUI)
 *        çalışma zamanında window üzerinden lazy-resolve edilir; bu sayede
 *        circular import riski ve dosya yükleme sırası sorunu ortadan kalkar.
 *
 * BAĞIMLILIKLAR (Çalışma zamanında window üzerinden çözülür):
 *   - window.SecurityConfig    ← security.js (klasik <script> tag)
 *   - window.showAppAlert      ← alert.js (klasik <script> tag)
 *   - window.startSessionTimer ← timer.js  (klasik <script> tag)
 *   - window.switchTab         ← script.js (geçiş sürecinde hâlâ orada)
 *   - window.checkPendingTasks ← todo-module.js
 *   - window._dx               ← script.js (güvenli kod input maskeleyici)
 */

// [WHY]: WebAuthn adımı kayıt akışı olmadan çalışıyor; bir cihaz sınıfında girişi engelliyor, diğerlerinde güvenlik sağlamıyor (AUTH-03).
// [HOW]: K2 kararı gelene kadar kapalı. true yapmak eski davranışı (kod + biyometrik) geri getirir.
const ENABLE_BIOMETRIC_LOGIN = false;

// ─────────────────────────────────────────────────────────────────────────────
// checkIsAdmin
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @function checkIsAdmin
 * @returns {boolean} Kullanıcının geçerli bir Firebase admin oturumu olup olmadığı
 *
 * [WHY]: LocalStorage üzerinden admin yetkisi almak (eski yöntem) DevTools
 *        konsolundan kolayca manipüle edilebiliyordu. Zero-Trust prensibine göre
 *        frontend'de sadece Firebase Auth objesi güvenilir kaynaktır.
 * [HOW]: window.userAuth varlığı ve UID doluluğu kontrol edilir.
 *        BAĞIMLILIK KORUMASI: timer.js ve todo-module.js gibi UI modülleri
 *        activeUser localStorage anahtarını beklediği için state okumaya devam edilir;
 *        ama yetki kararı yalnızca window.userAuth'a bağlıdır.
 */
export const checkIsAdmin = function () {
    try {
        const user = window.getActiveUser();
        if (user) window.currentUser = user;

        // [WHY]: Personelin anonim oturumu da uid taşıdığı için eski kontrol herkesi admin sayıyordu (AUTH-02).
        return window.isDbAdmin();
    } catch (e) {
        return false;
    }
};

// [COMPATIBILITY_BRIDGE]: script.js ve diğer dosyalar window.checkIsAdmin() çağırır.
window.checkIsAdmin = checkIsAdmin;

// ─────────────────────────────────────────────────────────────────────────────
// validateAdminAction
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @function validateAdminAction
 * @returns {boolean} İşleme devam edilip edilmeyeceği
 *
 * [WHY]: switchTab, deleteItem gibi kritik işlemlerin her birinde tekrar tekrar
 *        yetki kontrolü yazmak hata üretir. Merkezi bir guard fonksiyonu
 *        bu riskleri ortadan kaldırır.
 * [HOW]: checkIsAdmin() çağrılır; başarısızsa showAppAlert ile uyarı basılır
 *        ve false döndürülür. Arayan kod false'u görünce işlemi durdurur.
 */
export const validateAdminAction = function () {
    // [WHY]: Eskiden adminVizesi (sessionStorage) manipüle edilerek yetki aşılabiliyordu.
    // [HOW]: checkIsAdmin() doğrudan Firebase Auth'a bağlı hale getirildiği için,
    //        sadece onu çağırıyoruz. LocalStorage bypass edilemez.
    if (checkIsAdmin()) {
        return true;
    } else {
        if (typeof window.showAppAlert === 'function') {
            window.showAppAlert('Bu işlemi yapmaya yetkiniz bulunmamaktadır.', 'error');
        }
        return false;
    }
};

// [COMPATIBILITY_BRIDGE]: switchTab içinde validateAdminAction() çağrısı var.
window.validateAdminAction = validateAdminAction;

// ─────────────────────────────────────────────────────────────────────────────
// setupUI
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @function setupUI
 * @description Giriş sonrasında arayüzü kullanıcı yetkisine göre yapılandırır.
 *
 * [WHY]: Admin ve normal personelin görmesi gereken buton/panel alanları farklıdır.
 *        Bu ayrım her giriş sonrası güvenle uygulanmalıdır.
 * [HOW]: checkIsAdmin() sonucuna göre .admin-only CSS sınıflı tüm elemanlar
 *        display: inline-block veya none olarak set edilir.
 *        İki özel buton (adminRequestsBtn, btnAdminPanel) ayrıca ele alınır.
 */
export const setupUI = function () {
    const userObj = window.getActiveUser();
    if (!userObj) return;

    const isAdmin = checkIsAdmin();
    console.log('Arayüz yetkilendiriliyor. Admin mi?:', isAdmin);

    try {
        const adminBtn = document.getElementById('adminRequestsBtn');
        if (adminBtn) {
            adminBtn.style.setProperty('display', isAdmin ? 'inline-block' : 'none', 'important');
        }
        const dashboardBtn = document.getElementById('btnAdminPanel');
        if (dashboardBtn) {
            dashboardBtn.style.display = isAdmin ? 'inline-block' : 'none';
        }
        // [WHY]: Tüm .admin-only sınıflı elemanları tek geçişte işliyoruz;
        //        her biri için ayrı getElementById çağrısı yapmak bakım yüküdür.
        document.querySelectorAll('.admin-only').forEach(el => {
            el.style.setProperty('display', isAdmin ? 'inline-block' : 'none', 'important');
        });
    } catch (e) {
        console.error('setupUI hatası:', e);
    }
};

// [COMPATIBILITY_BRIDGE]: handleLogin ve firebase-handler.js'in onAuthStateChanged
// bloğu window.setupUI() çağırır.
window.setupUI = setupUI;

// ─────────────────────────────────────────────────────────────────────────────
// updateNavbarUI
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @function updateNavbarUI
 * @param {Object} user - activeUser objesi (name, role, code vb. alanlar)
 *
 * [WHY]: Giriş sonrası, localStorage storage eventi tetiklendiğinde ve
 *        firebase-handler.js'in onAuthStateChanged callbackinden navbar
 *        hem kullanıcı adını hem de admin butonunu doğru göstermelidir.
 * [HOW]: .header elementine #userDisplay div eklenir. Admin olanlar için
 *        "Panele Geç" butonu, tümü için çıkış butonu render edilir.
 *        Header geç yüklenirse 100ms sonra yeniden denenir (retry guard).
 */
export const updateNavbarUI = function (user) {
    window.currentUser = user; // Global referansı güncelle

    const header = document.querySelector('.header');
    if (!header) {
        // [HOW]: Header DOM'a henüz eklenmemişse kısa gecikmeyle yeniden dene.
        setTimeout(() => updateNavbarUI(user), 100);
        return;
    }

    // Eskisi varsa temizle (Çakışma önleme)
    let userDisplay = document.getElementById('userDisplay');
    if (userDisplay) userDisplay.remove();

    userDisplay = document.createElement('div');
    userDisplay.id = 'userDisplay';
    userDisplay.style.cssText = `
        margin-left: auto; 
        display: flex; 
        align-items: center; 
        gap: 10px; 
        padding-right: 15px;
        z-index: 999;
    `;

    header.appendChild(userDisplay);

    // [WHY]: Admin butonu yalnızca Muhammed Cer veya Admin adlı kullanıcılara gösterilir.
    // [HOW]: İsim karşılaştırması; yetki kontrolünü Firebase Auth'tan değil
    //        localStorage objesinden yapıyor (UI-only karar, güvenlik değil).
    const isAdmin = (user.name === 'Muhammed Cer' || user.name === 'Admin');
    const adminButtonHTML = isAdmin ? `
        <button type="button" class="btn-admin-panel" 
                onclick="window.location.href='admin.html'" 
                style="padding: 6px 12px; width: auto; margin-top: 0; font-size: 12px; background: #3498db;">
                📊 Panele Geç
        </button>
    ` : '';

    userDisplay.innerHTML = `
        <div class="todo-nav-badge-container" id="nav-todo-badge" 
             onclick="if(typeof switchTab === 'function') switchTab('myTasksTab')" 
             style="margin-right: 10px;" title="Bekleyen Görevleriniz">
            <i class="fas fa-bell todo-nav-icon"></i>
            <span class="todo-nav-badge badge-hidden" id="nav-todo-count">0</span>
        </div>
        <span style="font-weight: bold; color: white; font-size: 14px;">👤 ${user.name}</span>
        ${adminButtonHTML}
        <button onclick="handleLogout()" 
                style="background: #e74c3c; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px;">
                Çıkış Yap
        </button>
    `;

    // Todo badge güncelle
    if (typeof window.checkPendingTasks === 'function') {
        window.checkPendingTasks();
    }
    if (window.todoModule && typeof window.todoModule.updateNavBadge === 'function') {
        window.todoModule.updateNavBadge();
    }
};

// [COMPATIBILITY_BRIDGE]: handleLogin, firebase-handler.js ve storage event listener
// doğrudan updateNavbarUI() çağırır.
window.updateNavbarUI = updateNavbarUI;

// ─────────────────────────────────────────────────────────────────────────────
// checkAuth
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @function checkAuth
 * @description Sayfa yüklenmesinde ve Firebase Auth durum değişiminde çalışır.
 *              Geçerli oturum varsa inventory ekranını açar, yoksa login modal gösterir.
 *
 * [WHY]: Arayüz çizimi (UI state) eski sistemde localStorage'a güveniyordu;
 *        bu durum DevTools üzerinden "admin" olarak geçinmeyi mümkün kılıyordu.
 * [HOW]: window.userAuth objesini (Firebase Auth tarafından set edilir) referans alıyoruz.
 *        localStorage verileri yardımcı modüller (timer.js, todo-module.js) için
 *        okunmaya devam ediyor ama yetki kararına dahil edilmiyor.
 */
export const checkAuth = function () {
    const authData = localStorage.getItem('admin_auth');
    const activeUser = window.getActiveUser();
    const adminVizesi = sessionStorage.getItem('adminVizesi') === 'true';

    const loginModal = document.getElementById('loginModal');
    const inventoryScreen = document.getElementById('inventory-screen');

    let isAuthValid = false;

    // GERÇEK GÜVENLİK BARİYERİ: Firebase'den oturum yoksa kapı duvar.
    if (window.isDbAdmin()) {
        isAuthValid = true;

        // Yardımcı modüller için UI state'lerini yenile (Güvenli şekilde)
        if (!activeUser) window.setActiveUser({ name: 'Admin', role: 'admin' });
        if (!adminVizesi) sessionStorage.setItem('adminVizesi', 'true');
    }

    if (isAuthValid) {
        let userObj = activeUser;
        if (!userObj && (authData || adminVizesi)) {
            userObj = { name: 'Admin', role: 'admin' };
        }
        if (userObj) {
            updateNavbarUI(userObj);
        }

        // Şablon motoru varsa yükle
        if (typeof window.loadTemplates === 'function') {
            window.loadTemplates();
        }

        // [DECOMMISSIONED] Launchpad kaldırıldı
        const lpView = document.getElementById('launchpad-view');
        if (lpView) lpView.style.display = 'none';

        if (inventoryScreen) {
            // [WHY]: Başarılı auth sonrası bulanıklık filtresi kaldırılır ve kullanıcı etkileşimi yeniden etkinleşir.
            // [HOW]: filter, pointer-events ve user-select property override'ları silinerek normal görünüme dönülür.
            inventoryScreen.style.setProperty('display', 'block', 'important');
            inventoryScreen.style.removeProperty('filter');
            inventoryScreen.style.removeProperty('pointer-events');
            inventoryScreen.style.removeProperty('user-select');
        }

        if (loginModal) {
            loginModal.classList.add('hidden-modal');
            setTimeout(() => {
                loginModal.style.setProperty('display', 'none', 'important');
            }, 400);
        }

        // [WHY]: İlk yüklemede sekme render'ını yalnızca bir kez tetikliyoruz.
        //        onSnapshot her veri gelişinde bu kodu çalıştırmasın; modal kapanmasın.
        // [HOW]: _initialRenderDone bayrağı ile idempotent render sağlanır.
        if (!window._initialRenderDone) {
            window._initialRenderDone = true;
            const activeTabEl = document.querySelector('.tab-content.active');
            const activeTabId = activeTabEl ? activeTabEl.id : 'b1';
            setTimeout(() => {
                if (typeof window.switchTab === 'function') window.switchTab(activeTabId);
            }, 100);
        }
    } else {
        // ❗ AUTH YOKSA — ekranı kilitle, login modal göster
        window.isFirebaseLoaded = false;
        window._initialRenderDone = false;

        if (inventoryScreen) {
            // [WHY]: Boş beyaz ekran yerine içerik arka planı frosted glass görünümüyle
            //        gösterilir; kullanıcı sistemi görür ama etkileşime giremez.
            // [HOW]: CSS filter blur ve pointer-events: none dinamik olarak uygulanır.
            inventoryScreen.style.setProperty('display', 'block', 'important');
            inventoryScreen.style.setProperty('filter', 'blur(12px)', 'important');
            inventoryScreen.style.setProperty('pointer-events', 'none', 'important');
            inventoryScreen.style.setProperty('user-select', 'none', 'important');
        }

        // [DECOMMISSIONED] Launchpad Gate kaldırıldı. Klasik Login Modal kullanılıyor.
        const lpView = document.getElementById('launchpad-view');
        if (lpView) lpView.style.display = 'none';

        if (loginModal) {
            loginModal.classList.remove('hidden-modal');
            loginModal.style.setProperty('display', 'flex', 'important');
        }
    }
};

// [COMPATIBILITY_BRIDGE]: firebase-handler.js'in onAuthStateChanged bloğu
// window.checkAuth() çağırır. Bu bağlama kritik öneme sahiptir.
window.checkAuth = checkAuth;

// ─────────────────────────────────────────────────────────────────────────────
// handleLogin
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @function handleLogin
 * @param {Event} event - Form submit eventi
 *
 * [WHY]: Personel girişi. Admin girişi ayrı akıştadır (checkAdminAndGo).
 * [HOW]: 5 haneli kod personel listesinde aranır; bulunursa Session Store'a yazılır.
 *        Biyometrik adım ENABLE_BIOMETRIC_LOGIN ile kontrol edilir.
 */
export const handleLogin = async function (event) {
    if (event) { event.preventDefault(); event.stopPropagation(); }

    const statusDiv = document.getElementById('loginStatus');
    const codeInput = document.getElementById('access-val-node');
    const loginModal = document.getElementById('loginModal');

    // [R-SYS]: Güvenli kod maskeleyiciden değeri al; yoksa input'tan oku.
    const code = window._dx ? window._dx._g('access-val-node') : (codeInput ? codeInput.value.trim() : '');

    // GÜVENLİK KONTROLÜ: Veriler yüklenmeden giriş yaptırma
    if (!window.isFirebaseLoaded || !window.data || !window.data.personel) {
        if (statusDiv) {
            statusDiv.innerHTML = "<span style='color:var(--warning-color)'>⏳ Veriler henüz hazır değil, bekleyin...</span>";
        }
        return;
    }

    // [WHY]: Her personel girişi admin hesabına bir parola denemesi yapıyordu (AUTH-04).
    // [HOW]: Bu form yalnız personel kodunu doğrular; admin girişi yalnız "Yönetici Paneli" (checkAdminAndGo) akışındadır.
    const user = window.data.personel.find(p => p.code === code);

    if (user) {
        // [SECURITY_GUARD]: K2 kararına kadar biyometrik adım bayrakla kapalı (bkz. ENABLE_BIOMETRIC_LOGIN).
        if (ENABLE_BIOMETRIC_LOGIN) {
            if (typeof window.verifyBiometrics !== 'function') {
                console.error('[auth-engine] Biometric module not loaded!');
                if (statusDiv) {
                    statusDiv.innerHTML = "<span style='color:var(--danger-color)'>❌ Güvenlik modülü yüklenemedi!</span>";
                }
                return;
            }

            // [BUGFIX] Bug 8: WebAuthn iptal/başarısızlıkta oturum tamamen geri alınır.
            let biometricSuccess = false;
            try {
                biometricSuccess = await window.verifyBiometrics({ timeout: 60000 });
            } catch (error) {
                console.error('[auth-engine] WebAuthn exception during login verification:', error);
                biometricSuccess = false;
            }

            if (!biometricSuccess) {
                if (statusDiv) {
                    statusDiv.innerHTML = "<span style='color:var(--danger-color)'>❌ Biyometrik doğrulama başarısız!</span>";
                }
                if (codeInput) {
                    codeInput.value = '';
                    codeInput.focus();
                }
                if (typeof window.handleLogout === 'function') {
                    await window.handleLogout('manual');
                } else if (typeof window.logout === 'function') {
                    await window.logout('manual');
                }
                if (typeof window.showAppAlert === 'function') {
                    window.showAppAlert('Yetkili oturum açmanız gerekmektedir.', 'error');
                } else {
                    alert('Yetkili oturum açmanız gerekmektedir.');
                }
                return;
            }
        }

        // ─── BAŞARILI GİRİŞ (KOD + BIYOMETRIK) ───
        window.setActiveUser(user);

        document.body.classList.add('logged-in');

        // Güvenlik timer'ını başlat (timer.js)
        if (typeof window.startSessionTimer === 'function') {
            window.startSessionTimer();
        }

        if (loginModal) loginModal.style.setProperty('display', 'none', 'important');

        const inventoryScreen = document.getElementById('inventory-screen');
        const lpView = document.getElementById('launchpad-view');

        // [DECOMMISSIONED] Launchpad kaldırıldı
        if (lpView) lpView.style.display = 'none';

        if (inventoryScreen) {
            // [WHY]: Giriş formundan başarılı submit sonrası ekran bulanıklığını kaldır
            //        ve kullanıcı etkileşimini (pointer, select) yeniden etkinleştir.
            // [HOW]: setProperty override'ları removeProperty ile temizlenir.
            inventoryScreen.style.setProperty('display', 'block', 'important');
            inventoryScreen.style.removeProperty('filter');
            inventoryScreen.style.removeProperty('pointer-events');
            inventoryScreen.style.removeProperty('user-select');
            if (typeof window.switchTab === 'function') window.switchTab('b1');
        }

        updateNavbarUI(user);
        setupUI();

        // Şablon motoru varsa yükle
        if (typeof window.loadTemplates === 'function') {
            await window.loadTemplates();
        }

        if (typeof window.showAppAlert === 'function') {
            window.showAppAlert(`Hoş geldin, ${user.name}`, 'success');
        }
    } else {
        // ─── HATALI GİRİŞ ─── Modalı ASLA kapatma
        if (statusDiv) {
            statusDiv.innerHTML = "<span style='color:var(--danger-color); font-weight:bold;'>❌ Hatalı Giriş Kodu!</span>";
        }
        if (codeInput) {
            // Hafif sarsılma animasyonu (shake feedback)
            codeInput.style.transform = 'translateX(10px)';
            setTimeout(() => codeInput.style.transform = 'translateX(-10px)', 50);
            setTimeout(() => codeInput.style.transform = 'translateX(0)', 100);
            codeInput.value = '';
            codeInput.focus();
        }
    }
};

// [COMPATIBILITY_BRIDGE]: index.html'deki login formu onsubmit="window.handleLogin(event)" çağırır.
window.handleLogin = handleLogin;

// ─────────────────────────────────────────────────────────────────────────────
// checkAdminAndGo
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @function checkAdminAndGo
 * @description Admin kimliğini doğrulayıp admin.html'e yönlendirir.
 *
 * [WHY]: Kullanıcı aynı login kutusunu hem personel girişi hem de admin paneline
 *        geçiş için kullanır. Ayrı bir doğrulama akışı gereklidir.
 * [HOW]: SecurityConfig.authenticate çağrılır; başarılıysa admin_auth set edilip
 *        admin.html'e yönlendirilir.
 */
export const checkAdminAndGo = async function () {
    const codeInput = document.getElementById('access-val-node');
    const code = window._dx ? window._dx._g('access-val-node') : (codeInput ? codeInput.value.trim() : '');

    if (!code) return;

    // [WHY]: Frontend hash kaldırıldı. Backend (Firebase Admin SDK) onayı zorunludur.
    // [HOW]: window.SecurityConfig lazy-resolve — security.js bu nesneyi window'a atar.
    const isAdminPass = await window.SecurityConfig.authenticate(code);

    if (isAdminPass) {
        // [WHY]: Personel listesinde admin kaydı yoksa (ör. boş demo DB) giriş sessizce hiçbir şey yapmıyordu.
        const user = (window.data.personel || []).find(
            p => p.name === 'Muhammed Cer' || p.name === 'Admin'
        ) || { name: 'Admin', code: 'ADMIN', yetki: 'admin' };

        if (ENABLE_BIOMETRIC_LOGIN) {
            if (typeof window.verifyBiometrics !== 'function') {
                console.error('[auth-engine] Biometric module not loaded!');
                if (typeof window.showAppAlert === 'function') {
                    window.showAppAlert('Güvenlik modülü yüklenemedi!', 'error');
                }
                return;
            }
            const biometricSuccess = await window.verifyBiometrics({ timeout: 60000 });
            if (!biometricSuccess) {
                if (typeof window.showAppAlert === 'function') {
                    window.showAppAlert('Biyometrik doğrulama başarısız!', 'error');
                }
                return;
            }
        }

        window.setActiveUser(user);
        const expiry = new Date().getTime() + window.AppModules.Session.ADMIN_SESSION_MS;
        localStorage.setItem('admin_auth', JSON.stringify({ expiry }));

        if (typeof updateNavbarUI === 'function') updateNavbarUI(user);
        window.location.href = 'admin.html';
    } else {
        if (typeof window.showAppAlert === 'function') {
            window.showAppAlert('Admin yetkisi yok', 'danger');
        }
    }
};

// [COMPATIBILITY_BRIDGE]: HTML onclick ile çağrılabilir.
window.checkAdminAndGo = checkAdminAndGo;

// ─────────────────────────────────────────────────────────────────────────────
// DOMContentLoaded — Sayfa Başlangıç Auth Akışı
// ─────────────────────────────────────────────────────────────────────────────
// [WHY]: Sayfa yüklendiğinde iki görevi yerine getirmeliyiz:
//        1. localStorage'da önbelleğe alınmış kullanıcı varsa navbar'ı hemen çiz
//           (Optimistic Render — Firebase Auth beklenmeden anında UI göster).
//        2. checkAuth() ile gerçek Firebase Auth durumunu kontrol et.
// [HOW]: DOMContentLoaded eventi ile DOM hazır olur olmaz akışı tetikliyoruz.
//        firebase-handler.js'in onAuthStateChanged'i checkAuth()'u da çağıracak;
//        bu ikili-tetikleme sistem genelinde auth state tutarlılığını garanti eder.
document.addEventListener('DOMContentLoaded', () => {

    // 1. OPTIMISTIC NAVBAR RENDER (İyimser Çizim)
    // [WHY]: Firebase Auth asenkron; kullanıcı veri yüklenene kadar navbar boş kalır.
    // [HOW]: LocalStorage önbelleği ile anında UI çiziyoruz. Güvenlik firebase-handler'da.
    try {
        const cachedUser = window.getActiveUser();
        if (cachedUser) {
            updateNavbarUI(cachedUser);
        } else if (localStorage.getItem('admin_auth') || sessionStorage.getItem('adminVizesi') === 'true') {
            updateNavbarUI({ name: 'Admin', role: 'admin' });
        }
    } catch (e) { /* Önbellek okuma hatası kritik değil */ }

    // 2. GERÇEK AUTH KONTROLÜ
    checkAuth();
});

// ─────────────────────────────────────────────────────────────────────────────
// Storage Event — Çok Sekme Senkronizasyonu
// ─────────────────────────────────────────────────────────────────────────────
// [WHY]: Kullanıcı başka bir sekmede giriş/çıkış yaparsa, aktif sekmedeki
//        navbar güncellenmeden eski kullanıcı bilgisini gösterir.
// [HOW]: localStorage'daki 'activeUser' değişikliklerini dinleyerek navbar
//        anında senkronize edilir.
window.addEventListener('storage', () => {
    const user = window.getActiveUser();
    if (user) {
        try { updateNavbarUI(user); } catch (e) { }
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// handleLogout
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @function handleLogout
 * @param {string|Event} reason - Çıkış sebebi ('manual', 'timeout' veya DOM Event)
 * @description Kullanıcı oturumunu güvenli bir şekilde kapatır ve uygulama state'ini sıfırlar.
 *
 * [WHY]: Oturum kapatma mantığı (timer, auth sıfırlama, storage temizleme) eskiden timer.js
 *        monolith parçası içinde bulunuyordu. ESM v3.1 mimarisinde tüm kimlik doğrulama
 *        ve oturum yönetimi işlevleri auth-engine.js altında tek bir sorumluluk alanında toplanır.
 * [HOW]: 1) Açık işlem modalları varsa ve bu bir timeout çıkışıysa işlem bölünmez (süre uzatılır).
 *        2) LocalStorage ve SessionStorage üzerindeki oturum belirteçleri silinir.
 *        3) window.SecurityConfig.logout() veya Firebase Auth signOut tetiklenir.
 *        4) Küresel state değişkenleri (currentUser, isFirebaseLoaded vb.) sıfırlanır.
 *        5) Gevşek bağlılık (Loose Coupling) için 'onAppLogout' custom event'i tetiklenir.
 *           Böylece main.js üzerindeki Observer, sayfa yenilemeden (Soft Reset) UI sıfırlamasını yapar.
 */
export const handleLogout = async function (reason = 'manual') {
    // [WHY]: HTML onclick binding'lerinden Event objesi gelebilir; bunu standart 'manual' stringine çevirmeliyiz.
    // [HOW]: Event objesi tespiti ve preventDefault işlemi uygulanır.
    if (reason && typeof reason === 'object' && typeof reason.preventDefault === 'function') {
        reason.preventDefault();
        reason = 'manual';
    }
    if (typeof reason !== 'string') reason = 'manual';

    // [WHY]: Kullanıcı bir form veya transfer modalında işlem yaparken süre dolarsa, modalı kapatmak veri kaybına yol açar.
    // [HOW]: Ekranda loginModal harici açık modal varsa timeout ertelemesi yapılır ve süre sıfırlanır.
    if (reason === 'timeout' && typeof window.isAnyModalOpen === 'function' && window.isAnyModalOpen()) {
        console.log("🛡️ [auth-engine] Modal açık, timeout ertelendi.");
        if (typeof window.resetSessionTimer === 'function') window.resetSessionTimer(true);
        return;
    }

    console.warn(`🚪 [auth-engine] Logout işlemi başlatılıyor... Sebep: ${reason}`);

    // 1. Timers ve Uyarıları temizle
    if (typeof window.sessionTimer !== 'undefined') clearTimeout(window.sessionTimer);
    if (typeof window.warningTimeout !== 'undefined') clearTimeout(window.warningTimeout);
    if (typeof window.logInterval !== 'undefined') clearInterval(window.logInterval);

    const warningDiv = document.getElementById('sessionWarning');
    if (warningDiv) warningDiv.style.display = 'none';

    // 2. Kimlik verilerini ve önbelleği temizle
    window.clearSession();

    // 3. Küresel Uygulama State'lerini Sıfırla
    window.userAuth = null;
    window._initialRenderDone = false;
    window.isFirebaseLoaded = false;
    window._launchpadTriggered = false;

    // 4. CSS Sınıfını Kaldır
    document.body.classList.remove('logged-in');

    // 5. Firebase Auth Oturumunu Kapat
    // [WHY]: Sayfa yenilendiğinde otomatik re-login olmaması için Firebase Auth oturumu sonlandırılmalıdır.
    // [HOW]: SecurityConfig.logout veya dinamiğe bağlı signOut tetiklenir.
    if (window.SecurityConfig && typeof window.SecurityConfig.logout === 'function') {
        await window.SecurityConfig.logout();
    } else {
        try {
            const { getAuth, signOut } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js");
            const auth = getAuth(window.firebaseApp || window.app);
            await signOut(auth);
        } catch (e) {
            console.error("❌ Firebase Auth signOut error during dynamic fallback:", e);
        }
    }

    // 6. Uyarı Mesajı Göster
    if (typeof window.showAppAlert === 'function') {
        const msg = reason === 'timeout'
            ? "Oturum süresi dolduğu için güvenli çıkış yapıldı."
            : "Oturum başarıyla kapatıldı.";
        window.showAppAlert(msg, reason === 'timeout' ? "warning" : "success");
    }

    // 7. SOFT RESET TETİKLEYİCİSİ (Observer Notification)
    // [WHY]: location.reload() atmak SPA (Single Page Application) deneyimini bozar ve yavaştır.
    // [HOW]: 'onAppLogout' custom event'i yayınlanır. main.js içindeki Observer bunu yakalayarak
    //        ekranları bulandırır, modalları kapatır ve login modalını (veya initUI) tetikler.
    console.log("🔄 [auth-engine] Soft Reset tetikleyicisi yayınlanıyor: onAppLogout");
    window.dispatchEvent(new CustomEvent('onAppLogout', { detail: { reason } }));
};

// [COMPATIBILITY_BRIDGE] & [DUAL-EXPOSURE]:
// HTML onclick ve eski legacy modüller için window bağlamalarını yapıyoruz.
window.handleLogout = handleLogout;
window.logout = handleLogout;

// ─────────────────────────────────────────────────────────────────────────────
// Module init log
// ─────────────────────────────────────────────────────────────────────────────
console.log('✅ [auth-engine.js] Kimlik doğrulama motoru yüklendi (checkIsAdmin, checkAuth, handleLogin, updateNavbarUI, setupUI, checkAdminAndGo, handleLogout).');
