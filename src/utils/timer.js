// 🛡️ MERKEZİ OTURUM AYARLARI
window.SessionConfig = {
    WAREHOUSE_TIME: 3 * 60 * 1000,   // Depo/Ana Sayfa oturum süresi (3 dk)
    ADMIN_LOCK_TIME: 10 * 60 * 1000, // Admin kilit süresi (10 dk)
    WARNING_BEFORE: 1 * 60 * 1000,   // Kapanmadan 1 dakika önce uyarı
    CHECK_INTERVAL: 3000
};

// Global değişkenlere taşıyoruz (Diğer scriptlerin de görebilmesi için)
window.sessionTimer = null;
window.warningTimeout = null;
let lastResetTime = 0;

/**
 * Mevcut sayfanın Admin paneli olup olmadığını belirler
 */
function getActiveSessionTime() {
    const isAdminPath = window.location.pathname.includes('admin.html');
    const isAdminAuth = localStorage.getItem('admin_auth');

    // Hem path hem de auth kontrolü ile daha güvenilir tespit
    const isActuallyAdmin = isAdminPath || isAdminAuth;

    return isActuallyAdmin ? window.SessionConfig.ADMIN_LOCK_TIME : window.SessionConfig.WAREHOUSE_TIME;
}

/**
 * Ekranda aktif bir modal olup olmadığını kontrol eder
 */
function isAnyModalOpen() {
    const modals = document.querySelectorAll('.modal, .modern-modal, .app-modal, .checklist-modal');
    for (let m of modals) {
        if (m.id === 'loginModal') continue;
        const style = window.getComputedStyle(m);
        if (style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) !== 0) {
            return true;
        }
    }
    return false;
}

// Admin kilit kartı açık mı (admin.html). Kilitliyken etkinlik vizeyi uzatmaz ve zamanlayıcı kurulmaz.
function isAdminLocked() {
    const lock = document.getElementById('adminLockModal');
    return !!lock && lock.style.display === 'flex';
}

function startSessionTimer() {
    // 🛡️ [GÜVENLİK] Eğer kullanıcı giriş yapmamışsa timer başlatma!
    if (!localStorage.getItem('activeUser') && !localStorage.getItem('admin_auth')) {
        console.log("🛡️ [TIMER] Oturum yok, başlatılmadı.");
        return;
    }
    if (isAdminLocked()) return;

    const totalTime = getActiveSessionTime();
    const warningTime = totalTime - window.SessionConfig.WARNING_BEFORE;

    // 🔄 [SYNC] Admin vizesi etkinlikle uzar — yalnız süresi DOLMAMIŞSA (Faz 4 · J3, T4 / AUTH-06). Dolmuş vize F5 ya da
    //    fare hareketiyle canlanmaz; oturum tek yoldan sonlandırılır.
    const Session = window.AppModules && window.AppModules.Session;
    if (Session && localStorage.getItem('admin_auth') && !Session.extendAdminVisa(totalTime)) {
        const pending = window.SecurityConfig && window.SecurityConfig.isSignInPending();
        if (!pending) {
            console.warn("🔒 [TIMER] Admin vizesi dolmuş; uzatılmadı.");
            endSession('expired');
            return;
        }
    }

    clearTimeout(window.sessionTimer);
    clearTimeout(window.warningTimeout);

    // console.log(`🛡️ [TIMER] Başlatıldı. Toplam: ${totalTime / 60000} dk | Uyarı: ${warningTime / 60000} dk`);

    // Uyarı süresi
    window.warningTimeout = setTimeout(() => {
        if (isAnyModalOpen()) {
            console.log("🛡️ [TIMER] Modal açık, uyarı ertelendi.");
            resetSessionTimer(true);
            return;
        }
        console.warn("⚠️ [TIMER] Oturumun kapanmasına az kaldı!");

        const warningDiv = document.getElementById('sessionWarning');
        if (warningDiv) warningDiv.style.display = 'block';
    }, warningTime);

    // Çıkış süresi
    window.sessionTimer = setTimeout(() => {
        if (isAnyModalOpen()) {
            console.log("🛡️ [TIMER] Modal açık, çıkış iptal edildi.");
            resetSessionTimer(true);
            return;
        }
        console.error("🚨 [TIMER] Süre doldu!");
        logout('timeout');
    }, totalTime);
}

function resetSessionTimer(force = false) {
    // 🛡️ [GHOST LOGOUT FIX] Eğer kullanıcı oturum açmamışsa timer'ı asla sıfırlama/başlatma!
    if (!localStorage.getItem('activeUser') && !localStorage.getItem('admin_auth')) {
        return;
    }
    if (isAdminLocked()) return;

    const now = Date.now();
    if (!force && now - lastResetTime < 2000) return;
    lastResetTime = now;

    const warningDiv = document.getElementById('sessionWarning');
    if (warningDiv && warningDiv.style.display !== 'none') {
        warningDiv.style.display = 'none';
        console.log("✅ [TIMER] Kullanıcı aktif, süre sıfırlandı.");
    }

    startSessionTimer();
}

// Event Listeners
document.addEventListener('click', () => resetSessionTimer());
document.addEventListener('mousemove', () => resetSessionTimer(), { passive: true });
document.addEventListener('keydown', () => resetSessionTimer(), { passive: true });
document.addEventListener('scroll', () => resetSessionTimer(), { passive: true });

function showNotification(message, type = 'info') {
    const notif = document.createElement('div');
    notif.textContent = message;
    notif.className = `notification-toast toast-${type}`;
    notif.style.cssText = `
        position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
        padding: 12px 25px; border-radius: 8px; color: white; font-weight: bold;
        z-index: 100000; box-shadow: 0 10px 25px rgba(0,0,0,0.2);
        background: ${type === 'error' ? 'var(--color-danger, #e74c3c)' : 'var(--color-success, #27ae60)'};
    `;
    document.body.appendChild(notif);
    setTimeout(() => {
        notif.style.opacity = '0';
        notif.style.transition = 'opacity 0.5s ease';
        setTimeout(() => notif.remove(), 500);
    }, 4000);
}

// Yönetici oturumunun TEK sonlandırma yolu (security.js · SecurityConfig.endAdminSession). Güvenlik modülü yüklenmemişse
// en azından yerel kimlik silinir ve giriş sayfasına dönülür.
function endSession(reason) {
    if (window.SecurityConfig && typeof window.SecurityConfig.endAdminSession === 'function') {
        return window.SecurityConfig.endAdminSession(reason);
    }
    window.clearSession();
    window.location.replace('index.html');
    return Promise.resolve();
}

async function logout(reason = 'manual') {
    // [COMPATIBILITY_BRIDGE]: ESM v3.1 yapısına geçildiği için, eğer auth-engine.js yüklenmişse
    // çıkış işlemini merkezi motora ve Observer mekanizmasına (Soft Reset) yönlendir.
    if (typeof window.handleLogout === 'function' && window.handleLogout !== logout) {
        return window.handleLogout(reason);
    }

    // Eğer bir işlem modalı açıksa ve bu bir timeout ise, süreyi uzat (Kullanıcı veri giriyor olabilir)
    if (reason === 'timeout' && isAnyModalOpen()) {
        console.log("🛡️ [TIMER] Modal açık, timeout ertelendi.");
        resetSessionTimer(true);
        return;
    }

    console.warn(`🚪 [LOGOUT] İşlem başlatılıyor... Sebep: ${reason}`);
    if (typeof window.logInterval !== 'undefined') clearInterval(window.logInterval);
    document.body.classList.remove('logged-in');
    window._launchpadTriggered = false;

    // [WHY]: Faz 4 · J3 — bu yol (admin.html) signOut'u beklemeden kilit kartını gösteriyordu; admin token'ı kartın arkasında
    //        geçerli kalıyordu (T3). Şimdi: clearSession → await signOut → onAppLogout → kilit kartı (endAdminSession).
    await endSession(reason);

    // auth-engine yüklenemediyse (index'te main.js gözlemcisi yok) giriş ekranı burada açılır.
    const loginModal = document.getElementById('loginModal');
    if (loginModal) {
        loginModal.classList.remove('hidden-modal');
        loginModal.style.setProperty('display', 'flex', 'important');
        if (window._dx) window._dx._r('access-val-node');
        const userDisplay = document.getElementById('userDisplay');
        if (userDisplay) userDisplay.style.display = 'none';
    }
}

// Global'e aç
window.logout = logout;
window.handleLogout = logout;

window.addEventListener('load', () => {
    if (localStorage.getItem('activeUser') || localStorage.getItem('admin_auth')) {
        startSessionTimer();
    }
});
