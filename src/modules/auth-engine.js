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
// [HOW]: K2 kararı gelene kadar kapalı. Tek bayrak Session Store'da (Faz 4 · J4); burada yalnız okunur.
const ENABLE_BIOMETRIC_LOGIN = window.AppModules.Session.ENABLE_BIOMETRIC_LOGIN === true;

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
    // Faz 4B · J8: global referans kodsuz (session-store sanitizeUser) — giriş kodu window.currentUser'da tutulmaz
    user = window.AppModules.Session.sanitizeUser(user);
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

    // v3.8 UX-5 · Unified Glass Pill Dock: tüm kullanıcı alanı tek cam kapsül (stil: style.css › .nav-dock).
    //        Tüm mevcut ID/sınıf/onclick kancaları (#userDisplay, #nav-todo-badge, #nav-todo-count, .user-display-name,
    //        .btn-admin-panel, .user-logout-button) ve onNavbarRendered olayı korunur.
    userDisplay = document.createElement('div');
    userDisplay.id = 'userDisplay';
    userDisplay.className = 'nav-dock';
    userDisplay.setAttribute('role', 'group');
    userDisplay.setAttribute('aria-label', 'Kullanıcı işlemleri');

    header.appendChild(userDisplay);

    const isAdmin = window.isDbAdmin();
    const adminButtonHTML = isAdmin ? `
        <button type="button" class="btn-admin-panel user-action-button user-admin-button"
                aria-label="Yönetici paneline geç" title="Yönetici paneline geç"
                onclick="window.location.href='admin.html'">
                <i class="fas fa-chart-column" aria-hidden="true"></i><span>Panele Geç</span>
        </button>
    ` : '';

    // Avatar çipi: ad ve soyadın baş harfleri (tek sözcükse tek harf); metin escapeHtml'den geçer.
    const initialsOf = String(user.name || '').trim().split(/\s+/).filter(Boolean);
    const initials = (initialsOf.length > 1
        ? Array.from(initialsOf[0])[0] + Array.from(initialsOf[initialsOf.length - 1])[0]
        : Array.from(initialsOf[0] || '?')[0]).toLocaleUpperCase('tr-TR');

    userDisplay.innerHTML = `
        <button type="button" class="todo-nav-badge-container user-tasks-button" id="nav-todo-badge"
             aria-label="Görevlerim: bekleyen görevleri göster" title="Bekleyen Görevleriniz"
             onclick="if(typeof switchTab === 'function') switchTab('myTasksTab')">
            <i class="fas fa-bell todo-nav-icon" aria-hidden="true"></i>
            <span class="todo-nav-badge badge-hidden" id="nav-todo-count">0</span>
        </button>
        <span class="nav-dock-sep" aria-hidden="true"></span>
        <span class="nav-dock-user">
            <span class="nav-dock-avatar" aria-hidden="true">${escapeHtml(initials)}</span>
            <span class="user-display-name" title="${escapeHtml(user.name)}">${escapeHtml(user.name)}</span>
        </span>
        <span class="nav-dock-actions">${adminButtonHTML}</span>
        <span class="nav-dock-sep" aria-hidden="true"></span>
        <button type="button" class="user-action-button user-logout-button" aria-label="Oturumu kapat" title="Oturumu kapat" onclick="handleLogout()">
                <i class="fas fa-right-from-bracket" aria-hidden="true"></i><span>Çıkış Yap</span>
        </button>
    `;

    // Todo badge güncelle
    if (typeof window.checkPendingTasks === 'function') {
        window.checkPendingTasks();
    }
    if (window.todoModule && typeof window.todoModule.updateNavBadge === 'function') {
        window.todoModule.updateNavBadge();
    }

    // [WHY]: auth-engine bu fonksiyonu içeriden çağırdığı için window.updateNavbarUI sarmalayıcıları hiç çalışmıyordu (EBYS-05).
    window.dispatchEvent(new CustomEvent('onNavbarRendered', { detail: { user } }));
};

// [COMPATIBILITY_BRIDGE]: handleLogin, firebase-handler.js ve storage event listener
// doğrudan updateNavbarUI() çağırır.
window.updateNavbarUI = updateNavbarUI;

// [WHY]: İP-7 — yönetici yetkisi oturum açıkken verilebilir ya da geri alınabilir (firebase-handler kendi eşlemesini dinler).
//        "Panele Geç" düğmesi ve .admin-only öğeleri yalnız girişte kuruluyordu; yetki düşse de görünür kalırdı.
// [HOW]: 'onAdminGrantChanged' gelince giriş yapmış kullanıcı için navbar ve setupUI yeniden çizilir. Yetki verildiyse yönetici
//        vizesi yazılır (admin.html girişte vizeyi arar — handleLogin'deki "isDbAdmin → grantAdminVisa" ile aynı); düştüyse silinir.
window.addEventListener('onAdminGrantChanged', ev => {
    const user = window.getActiveUser();
    if (!user || !document.body.classList.contains('logged-in')) return;
    const granted = !!(ev && ev.detail && ev.detail.isAdmin);
    const Session = window.AppModules.Session;
    if (granted) Session.grantAdminVisa(); else Session.clearAdminVisa();
    updateNavbarUI(user);
    setupUI();
    if (typeof window.showAppAlert === 'function') {
        window.showAppAlert(granted ? 'Hesabınıza yönetici yetkisi verildi; "Panele Geç" ile yönetici paneline geçebilirsiniz.'
            : 'Hesabınızın yönetici yetkisi geri alındı ya da askıya alındı.', granted ? 'success' : 'warning');
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// releaseAuthHydration (v3.8 · UX-3 Sıfır-Flicker Soft Geçiş)
// ─────────────────────────────────────────────────────────────────────────────
// [WHY]: Admin → Index geçişinde veya yenilemede Firebase Auth çözülene kadar #loginModal
//        göz kırpmasını önleyen geçiş perdesini güvenli ve yumuşak biçimde kaldırır.
// [HOW]: Emniyet zamanlayıcısını temizler, html.auth-hydrating sınıfını siler ve
//        #indexTransitionLoader'ı opacity:0 ile kapatır; Zero-Trust bariyerini değiştirmez.
export const releaseAuthHydration = function () {
    if (window.__authHydratingTimer) {
        clearTimeout(window.__authHydratingTimer);
        window.__authHydratingTimer = null;
    }
    document.documentElement.classList.remove('auth-hydrating');
    const loader = document.getElementById('indexTransitionLoader');
    if (loader && !loader.classList.contains('is-hidden')) {
        loader.classList.add('is-hidden');
        loader.setAttribute('aria-hidden', 'true');
        setTimeout(() => {
            if (!document.documentElement.classList.contains('auth-hydrating')) {
                document.documentElement.classList.remove('auth-transition-ready');
            }
        }, 320);
    } else if (!document.documentElement.classList.contains('auth-hydrating')) {
        document.documentElement.classList.remove('auth-transition-ready');
    }
};
window.releaseAuthHydration = releaseAuthHydration;

// [WHY]: v3.8 UX-3 · Admin Operasyon Merkezi'ndeki "Hızlı Envanter Çıkış Masası" ile gelindiğinde,
//        oturum doğrulandığı anda çıkış modalını göz kırpmasız ve pürüzsüz açar.
// [HOW]: sessionStorage.pendingQuickExit === '1' varsa ve openExitModal hazırsa bayrağı tüketip
//        sonraki çizim karesinde açar; henüz hazır değilse script.js yedeğine bırakır.
function _flushPendingQuickExit() {
    try {
        if (sessionStorage.getItem('pendingQuickExit') !== '1') return;
        if (typeof window.openExitModal !== 'function') return;
        sessionStorage.removeItem('pendingQuickExit');
        requestAnimationFrame(() => {
            try { window.openExitModal(); } catch (e) { console.error('[auth-engine] pendingQuickExit açılamadı:', e); }
        });
    } catch (e) { /* depolama kapalıysa sorun değil */ }
}

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
    let activeUser = window.getActiveUser();

    const loginModal = document.getElementById('loginModal');
    const inventoryScreen = document.getElementById('inventory-screen');

    let isAuthValid = false;

    // GERÇEK GÜVENLİK BARİYERİ: Firebase'den oturum yoksa kapı duvar.
    // [WHY]: Faz 4 · J3 (M9, AUTH-05) — kalıcı admin token'ı, vizesi dolmuş ya da kimliği silinmiş olsa bile buradan
    //        sanal "Admin" kimliği ve adminVizesi bayrağı üretiyordu: tarayıcıyı kapatıp açan herkes admin olarak giriyordu.
    // [HOW]: Admin oturumu yalnız geçerli vize + parola sonrası atanmış kimlikle geçerlidir. Biri eksikse oturum "bayat" →
    //        endAdminSession('stale') Firebase oturumunu da kapatır (yoksa kimliksiz bir DB-admin token'ı kalırdı).
    //        Giriş sürerken (vize henüz yazılmadı) karar ertelenir.
    if (window.AppModules.Session.isPrimaryDbAdmin()) {
        const S = window.SecurityConfig;
        if (S && S.isSignInPending()) return;
        if (window.AppModules.Session.hasValidAdminVisa() && activeUser) {
            isAuthValid = true;
        } else {
            console.warn('🔒 [auth-engine] Bayat yönetici oturumu (vize/kimlik yok) — kapatılıyor.');
            releaseAuthHydration();
            if (S) {
                S.endAdminSession('stale').then(() => {
                    if (typeof window.showAppAlert === 'function') window.showAppAlert('Yönetici oturumunun süresi dolmuş. Lütfen yeniden giriş yapın.', 'warning');
                });
            }
            return;
        }
    }

    // [WHY]: Faz 4B · J8 (K5) — personel oturumu yenilemede kayboluyordu: localStorage'daki activeUser yetki kaynağı sayılmadığı
    //        (J3) için anonim personel her F5'te yeniden kod giriyordu.
    // [HOW]: Personel HESABI oturumunda kimlik Firebase'in kendi kalıcılığından gelir ve personel listesinden uid ile bulunur
    //        (activeUser'a güvenilmez, yeniden yazılır). Liste henüz gelmediyse personel yüklenince yeniden denenir; uid hiçbir
    //        personele bağlı değilse (silinmiş personel, yabancı hesap) ya da mod 'anonymous'a alındıysa oturum kapatılır.
    //        Anonim (eski yol) personel oturumu bilinçli olarak eskisi gibi yenilemede geri yüklenmez.
    if (!isAuthValid && window.AppModules.Session.isStaffAccountSession()) {
        const S = window.SecurityConfig;
        const uid = window.userAuth.uid;
        const list = window.data && window.data.personel;
        if (!window.isFirebaseLoaded || !Array.isArray(list)) { _recheckAuthWhenPersonelLoaded(); return; }
        const person = list.find(p => p && p.uid && String(p.uid) === String(uid));
        if (!person) {
            console.warn('🔒 [auth-engine] Personel hesabı oturumu geçersiz (personele bağlı değil) — kapatılıyor.');
            releaseAuthHydration();
            if (S) S.endAdminSession('stale');
            return;
        }
        window.setActiveUser(person);
        activeUser = window.getActiveUser();
        isAuthValid = true;
        document.body.classList.add('logged-in');
    }

    if (isAuthValid) {
        const wasHydrating = document.documentElement.classList.contains('auth-hydrating');
        updateNavbarUI(activeUser);

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
            if (wasHydrating) {
                loginModal.style.setProperty('display', 'none', 'important');
            } else {
                setTimeout(() => {
                    loginModal.style.setProperty('display', 'none', 'important');
                }, 400);
            }
        }

        releaseAuthHydration();
        _flushPendingQuickExit();

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
        // [WHY]: v3.8 UX-3 · Geçiş/yenileme sırasında Firebase Auth ilk yanıtını henüz vermediyse
        //        #loginModal'ı erken açıp göz kırptırma; ekran perde arkasında kilitli bekler (Zero-Trust korunur).
        if (document.documentElement.classList.contains('auth-hydrating') && !window.__authKnownResolved) {
            if (inventoryScreen) {
                inventoryScreen.style.setProperty('display', 'block', 'important');
                inventoryScreen.style.setProperty('pointer-events', 'none', 'important');
                inventoryScreen.style.setProperty('user-select', 'none', 'important');
            }
            return;
        }
        releaseAuthHydration();

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

// J8: personel hesabı oturumu geri yüklenirken personel listesi henüz gelmemişse, ilk personel snapshot'ında bir kez yeniden dene.
let _authRecheckPending = false;
function _recheckAuthWhenPersonelLoaded() {
    if (_authRecheckPending) return;
    _authRecheckPending = true;
    const onData = e => {
        if (!e || !e.detail || e.detail.collection !== 'personel') return;
        window.removeEventListener('onInventoryDataUpdated', onData);
        _authRecheckPending = false;
        setTimeout(checkAuth, 0);
    };
    window.addEventListener('onInventoryDataUpdated', onData);
}

// ─────────────────────────────────────────────────────────────────────────────
// Giriş durumu ve hazır olma (Faz 4 kapanış hotfix'i · saha bulgusu 07.10.2026)
// ─────────────────────────────────────────────────────────────────────────────
// [WHY]: Çıkıştan hemen sonra (F5'siz) giriş "takılıyordu": (1) #loginStatus sayfa açılışından 4 sn sonra gizleniyor ve bir daha
//        görünür yapılmıyordu — "Veriler henüz hazır değil" ve "Hatalı Giriş Kodu" mesajları görünmez kutuya yazılıyordu;
//        (2) çıkışla başlayan anonim oturum + veri yenilemesi (canlıda birkaç saniye) bitmeden yapılan giriş beklemek yerine
//        reddediliyordu.
// [HOW]: Mesajlar her zaman görünür yazılır (bekleyen gizleme iptal edilir). Giriş, oturum ve personel listesi hazır olana kadar
//        "Oturum hazırlanıyor" diyerek bekler ve kendiliğinden devam eder; çift tıklama tek giriş sayılır.
function setLoginStatus(html) {
    const el = document.getElementById('loginStatus');
    if (!el) return;
    clearTimeout(window._loginStatusHideTimer);
    el.style.display = '';
    el.innerHTML = html;
    if (html) el.dataset.loginMsg = '1'; else delete el.dataset.loginMsg;   // firebase-handler bu mesajın üstüne "Sistem Hazır" yazmaz
}

// ─── Personel girişi: kurumsal kimlik (PRI) + kod (Faz 4B · J10, PRI revizyonu) ──────────────────────────
// [WHY]: Anonim oturum kaldırıldı (Aşama B). J10'un ilk sürümündeki oturumsuz "adını seç" listesi KVKK ve kullanım açısından
//        iptal edildi: giriş ekranı veritabanından hiçbir şey okumaz, personel listesi gösterilmez.
// [HOW]: İki kutu: kurumsal kimlik (#login-pri, ör. ayse.yilmaz) ve giriş kodu (#access-val-node, maskeli). Giriş doğrudan
//        signInWithEmailAndPassword(<pri>@staff.medipol.local, kod + dolgu) — PRI, üretimdeki normalizasyonla (Türkçe harfler
//        arındırılır, küçük harf) okunur. Yönetici aynı kod kutusuna parolasını yazıp "Yönetici Paneli"ne basar (değişmedi).

// Faz 3.5 · otomatik odak izolasyonu: odak yalnız kullanıcı sayfayla henüz etkileşmediyse ve sayfa başına bir kez verilir;
// giriş alanlarının kendisine tıklamak etkileşim sayılmaz. J10 PRI: odak, oturum olmadığı kesinleşince kimlik kutusuna gider.
let _userInteracted = false;
let _loginAutoFocused = false;
const _loginFieldIds = ['login-pri', 'access-val-node'];
function _markUserInteraction(e) {
    if (e && e.target && _loginFieldIds.includes(e.target.id)) return;
    _userInteracted = true;
    ['pointerdown', 'keydown'].forEach(t => document.removeEventListener(t, _markUserInteraction, true));
}
['pointerdown', 'keydown'].forEach(t => document.addEventListener(t, _markUserInteraction, true));
function _autoFocusLogin() {
    const el = document.getElementById('login-pri');
    const active = document.activeElement;
    if (!_loginAutoFocused && !_userInteracted && el && el.offsetParent !== null && (!active || active === document.body)) {
        _loginAutoFocused = true;
        try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
    }
}

let _loginInFlight = false;

// ─────────────────────────────────────────────────────────────────────────────
// handleLogin
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @function handleLogin — personel girişi (J10 PRI): kurumsal kimlik + kod → Firebase Auth (signInWithEmailAndPassword).
 * Veritabanı okunmaz. Admin girişi ayrı akıştadır (checkAdminAndGo; aynı parola kutusunu kullanır).
 */
export const handleLogin = async function (event) {
    if (event) { event.preventDefault(); event.stopPropagation(); }

    const priInput = document.getElementById('login-pri');
    const codeInput = document.getElementById('access-val-node');
    const loginModal = document.getElementById('loginModal');

    // [R-SYS]: Güvenli kod maskeleyiciden değeri al; yoksa input'tan oku.
    const code = window._dx ? window._dx._g('access-val-node') : (codeInput ? codeInput.value.trim() : '');

    if (_loginInFlight) return;
    _loginInFlight = true;
    try {
        const SP = window.StaffProvisioning;
        if (!SP) { setLoginStatus(_LOGIN_MSG.contact); return; }
        const pri = SP.normalizePri(priInput ? priInput.value : '');
        if (!pri) {
            setLoginStatus(_LOGIN_MSG.pri);
            if (priInput) priInput.focus();
            return;
        }
        if (!SP.isValidPri(pri)) {
            setLoginStatus(_LOGIN_MSG.priFormat);
            if (priInput) priInput.focus();
            return;
        }
        await completeStaffLogin(pri, code, { priInput, codeInput, loginModal });
    } finally {
        _loginInFlight = false;
    }
};

// Hatalı/reddedilen giriş: modal açık kalır, kod kutusu sarsılır ve temizlenir (kurumsal kimlik korunur).
function _rejectStaffLogin(html, codeInput) {
    setLoginStatus(html);
    if (codeInput) {
        codeInput.style.transform = 'translateX(10px)';
        setTimeout(() => codeInput.style.transform = 'translateX(-10px)', 50);
        setTimeout(() => codeInput.style.transform = 'translateX(0)', 100);
        codeInput.value = '';
        if (window._dx) window._dx._r('access-val-node');
        codeInput.focus();
    }
}
const _LOGIN_MSG = {
    pri: "<span style='color:var(--warning-color); font-weight:bold;'>👤 Kurumsal kimliğinizi (ad.soyad) girin.</span><br><span style='font-size:12px;'>Yönetici iseniz yalnız parolayı girip \"Yönetici Paneli\"ne basın.</span>",
    priFormat: "<span style='color:var(--warning-color); font-weight:bold;'>👤 Kurumsal kimlik ad.soyad biçiminde olmalı (ör. ayse.yilmaz).</span>",
    invalid: "<span style='color:var(--danger-color); font-weight:bold;'>❌ Kurumsal kimlik ya da giriş kodu hatalı!</span>",
    contact: "<span style='color:var(--danger-color); font-weight:bold;'>⚠️ Giriş yapılamadı, lütfen yöneticiye başvurun.</span>",
    disabled: "<span style='color:var(--danger-color); font-weight:bold;'>⛔ Giriş hesabınız devre dışı. Lütfen yöneticiye başvurun.</span>",
    rateLimited: "<span style='color:var(--danger-color); font-weight:bold;'>⏳ Çok fazla deneme yapıldı. Birkaç dakika sonra tekrar deneyin.</span>",
    network: "<span style='color:var(--danger-color)'>⚠️ Sunucuya bağlanılamadı. Bağlantınızı kontrol edip tekrar deneyin.</span>",
    gateClosed: "<span style='color:var(--warning-color); font-weight:bold;'>🔒 Personel erişimi şu an kapalı (sistem geçişi sürüyor). Lütfen daha sonra yeniden deneyin.</span>",
};
// Firebase Auth hata kodu → kullanıcı mesajı. Yanlış kod ile var olmayan kimlik aynı mesajı alır (hesap varlığı sızdırılmaz).
function _staffLoginError(code) {
    const c = String(code || '').replace(/^auth\//, '');
    if (['invalid-credential', 'invalid-login-credentials', 'wrong-password', 'user-not-found', 'invalid-email', 'invalid-password'].includes(c)) return _LOGIN_MSG.invalid;
    if (c === 'too-many-requests') return _LOGIN_MSG.rateLimited;
    if (c === 'user-disabled') return _LOGIN_MSG.disabled;
    if (c === 'network-request-failed' || c === 'unavailable') return _LOGIN_MSG.network;
    return _LOGIN_MSG.contact;
}

async function completeStaffLogin(pri, code, { priInput, codeInput, loginModal }) {
    // [WHY]: Faz 4B · J10 — kod veritabanında aranmaz, kişi listeden seçilmez; kodlar personel kaydından silinebilir (Kod Temizliği).
    // [HOW]: <pri>@staff.medipol.local hesabına kod + dolgu ile ANA Auth örneğinde giriş. Firebase'in kendi hata ve deneme sınırı
    //        (too-many-requests) işletilir. Girişten sonra personel listesi gelince checkAuth (K5) oturumu uid ile personel
    //        kaydına bağlar; bağ yoksa (hesap personele bağlı değil) kurallar okumayı reddeder → oturum kapanır.
    //        Biyometrik adım (ENABLE_BIOMETRIC_LOGIN) personel girişinde yok (K2-b kaydı yapılmadı).
    const Session = window.AppModules.Session;
    const SP = window.StaffProvisioning;
    const email = SP.staffEmail(pri);
    const password = SP.staffPassword(code);
    if (!email || !password) { _rejectStaffLogin(_LOGIN_MSG.invalid, codeInput); return; }

    setLoginStatus("<span style='color:var(--warning-color)'>⏳ Giriş yapılıyor…</span>");
    // Aynı sekmede açık kalmış başka bir oturum (başka personel / yönetici) önce kapatılır: kimlikler karışmasın.
    if (window.userAuth && window.SecurityConfig) await window.SecurityConfig.logout();
    try {
        await window.signInStaffAccount(email, password);
    } catch (e) {
        console.warn('🔒 [auth-engine] Personel girişi reddedildi:', e && e.code);
        _rejectStaffLogin(_staffLoginError(e && e.code), codeInput);
        return;
    }

    // J11 · P0: girişten SONRA (zero-lookup korunur) personel erişim kilidi okunur. Kapalıysa (doküman yok / false / geçersiz) ya da
    // kural kimliği tanımıyorsa oturum sessizce kesilir ve neden giriş ekranında söylenir; veri ekrana hiç gelmez.
    if (typeof window.readStaffAccessGate === 'function') {
        const gate = await window.readStaffAccessGate();
        if (gate.state !== 'open' && gate.state !== 'unknown') {
            const reason = gate.state === 'denied' ? 'unlinked' : 'gate-closed';
            if (typeof window.revokeStaffAccess === 'function') await window.revokeStaffAccess(reason, { silent: true });
            else if (window.userAuth && window.SecurityConfig) await window.SecurityConfig.logout();
            _rejectStaffLogin(reason === 'gate-closed' ? _LOGIN_MSG.gateClosed : _LOGIN_MSG.contact, codeInput);
            return;
        }
    }

    // Kimlik: personel listesi gelince checkAuth K5 yolu setActiveUser(personel) yapar (uid eşleşmesiyle).
    const bound = () => {
        const u = window.getActiveUser();
        return !!(u && window.userAuth && Session.isStaffAccountSession() && String(u.uid || '') === String(window.userAuth.uid));
    };
    const t = Date.now();
    while (!bound() && window.userAuth && Date.now() - t < 20000) await new Promise(r => setTimeout(r, 100));
    if (!bound()) {
        console.warn('🔒 [auth-engine] Hesap bir personel kaydına bağlanamadı; oturum kapatılıyor.');
        if (window.userAuth && window.SecurityConfig) await window.SecurityConfig.logout();
        // Bekleme sırasında kilit kapanmış olabilir (dinleyici reddi → revokeStaffAccess): nedeni doğru söyle
        const rv = typeof window.getStaffRevocation === 'function' ? window.getStaffRevocation() : null;
        _rejectStaffLogin(rv && rv.reason === 'gate-closed' && Date.now() - rv.at < 60000 ? _LOGIN_MSG.gateClosed : _LOGIN_MSG.contact, codeInput);
        return;
    }
    const user = window.getActiveUser();
    if (window.isDbAdmin()) Session.grantAdminVisa();

    // ─── BAŞARILI GİRİŞ ───
    setLoginStatus('');
    if (codeInput) { codeInput.value = ''; if (window._dx) window._dx._r('access-val-node'); }
    if (priInput) priInput.value = '';   // ortak bilgisayarda bir sonraki kişiye önceki kimlik görünmesin
    document.body.classList.add('logged-in');
    if (typeof window.startSessionTimer === 'function') window.startSessionTimer();
    if (loginModal) loginModal.style.setProperty('display', 'none', 'important');

    const inventoryScreen = document.getElementById('inventory-screen');
    const lpView = document.getElementById('launchpad-view');
    if (lpView) lpView.style.display = 'none';   // [DECOMMISSIONED] Launchpad kaldırıldı
    if (inventoryScreen) {
        inventoryScreen.style.setProperty('display', 'block', 'important');
        inventoryScreen.style.removeProperty('filter');
        inventoryScreen.style.removeProperty('pointer-events');
        inventoryScreen.style.removeProperty('user-select');
        if (typeof window.switchTab === 'function') window.switchTab('b1');
    }

    updateNavbarUI(user);
    setupUI();
    if (typeof window.loadTemplates === 'function') await window.loadTemplates();
    if (typeof window.showAppAlert === 'function') window.showAppAlert(`Hoş geldin, ${user.name}`, 'success');
}

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
    if (_loginInFlight) return;
    _loginInFlight = true;
    try {
        // J10: giriş öncesi veri yok; oturum durumunun yerleşmesini SecurityConfig.authenticate kendisi bekler (waitForAuthSettled).
        await completeAdminLogin(code);
    } finally {
        _loginInFlight = false;
    }
};

async function completeAdminLogin(code) {
    // [WHY]: Frontend hash kaldırıldı. Backend (Firebase Admin SDK) onayı zorunludur.
    // [HOW]: window.SecurityConfig lazy-resolve — security.js bu nesneyi window'a atar.
    // J3: authenticate parolayı denetler (≥12 karakter) ve vizeyi oturumla birlikte yazar.
    const isAdminPass = await window.SecurityConfig.authenticate(code);

    if (isAdminPass) {
        // J10: personel listesi ancak oturum açıldıktan sonra gelir — yönetici kimliği için en fazla 10 sn beklenir.
        const t0 = Date.now();
        while (!(window.isFirebaseLoaded === true && Array.isArray(window.data && window.data.personel)) && Date.now() - t0 < 10000) await new Promise(r => setTimeout(r, 100));
        // [WHY]: Personel listesinde admin kaydı yoksa (ör. boş demo DB) giriş sessizce hiçbir şey yapmıyordu.
        const user = window.SecurityConfig.resolveAdminIdentity();

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
                await window.SecurityConfig.endAdminSession('manual');
                return;
            }
        }

        if (typeof window.AdminQuickUnlock?.offerPinSetup === 'function') {
            try {
                await window.AdminQuickUnlock.offerPinSetup(code);
            } catch (error) {
                console.error('[auth-engine] İlk giriş hızlı PIN kurulumu başarısız:', error);
            }
        }

        window.setActiveUser(user);

        if (typeof updateNavbarUI === 'function') updateNavbarUI(user);
        window.location.href = 'admin.html';
    } else {
        if (typeof window.showAppAlert === 'function') {
            window.showAppAlert(window.SecurityConfig.lastErrorMessage || 'Admin yetkisi yok', 'danger');
        }
    }
}

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
        // J3 (M9): depolama bayrağından sanal "Admin" çizilmez; yalnız kayıtlı kimlik.
        const cachedUser = window.getActiveUser();
        if (cachedUser) {
            updateNavbarUI(cachedUser);
        }
    } catch (e) { /* Önbellek okuma hatası kritik değil */ }

    // 2. GERÇEK AUTH KONTROLÜ
    checkAuth();

    // 3. v3.8 UX-3 + J10 PRI: Firebase Auth ilk yanıtını verdiğinde geçiş perdesini kesin sonuca bağla;
    //    oturum yoksa login modalı aç ve kurumsal kimlik kutusuna odakla.
    const resolveWhenAuthKnown = () => {
        if (typeof window.whenAuthKnown !== 'function') { setTimeout(resolveWhenAuthKnown, 50); return; }
        window.whenAuthKnown().then(u => {
            window.__authKnownResolved = true;
            if (!u || document.documentElement.classList.contains('auth-hydrating')) {
                checkAuth();
            }
            if (!u && document.getElementById('login-pri')) _autoFocusLogin();
        });
    };
    resolveWhenAuthKnown();
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
 *        2) Küresel state değişkenleri (isFirebaseLoaded vb.) sıfırlanır.
 *        3) SecurityConfig.endAdminSession: clearSession → await signOut → 'onAppLogout' (tek sonlandırma yolu, J3).
 *           main.js üzerindeki Observer, sayfa yenilemeden (Soft Reset) UI sıfırlamasını yapar.
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
    if (typeof window.logInterval !== 'undefined') clearInterval(window.logInterval);

    // 1. Küresel Uygulama State'lerini Sıfırla (userAuth'u yalnız onAuthStateChanged yönetir — AUTH-10)
    window._initialRenderDone = false;
    window.isFirebaseLoaded = false;
    window._launchpadTriggered = false;
    document.body.classList.remove('logged-in');
    releaseAuthHydration();

    // 2. TEK SONLANDIRMA YOLU (Faz 4 · J3): zamanlayıcılar → clearSession() → await signOut (yerel kalıcılığa dönerek) →
    //    'onAppLogout'. main.js gözlemcisi bu olayla sayfa yenilemeden (Soft Reset) giriş ekranını açar.
    if (window.SecurityConfig && typeof window.SecurityConfig.endAdminSession === 'function') {
        await window.SecurityConfig.endAdminSession(reason);
    } else {
        window.clearSession();
        window.dispatchEvent(new CustomEvent('onAppLogout', { detail: { reason } }));
    }

    // 3. Uyarı Mesajı Göster
    if (typeof window.showAppAlert === 'function') {
        const msg = reason === 'timeout'
            ? "Oturum süresi dolduğu için güvenli çıkış yapıldı."
            : "Oturum başarıyla kapatıldı.";
        window.showAppAlert(msg, reason === 'timeout' ? "warning" : "success");
    }
};

// [COMPATIBILITY_BRIDGE] & [DUAL-EXPOSURE]:
// HTML onclick ve eski legacy modüller için window bağlamalarını yapıyoruz.
window.handleLogout = handleLogout;
window.logout = handleLogout;
