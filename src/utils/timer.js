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

function startSessionTimer() {
    // 🛡️ [GÜVENLİK] Eğer kullanıcı giriş yapmamışsa timer başlatma!
    if (!localStorage.getItem('activeUser') && !localStorage.getItem('admin_auth')) {
        console.log("🛡️ [TIMER] Oturum yok, başlatılmadı.");
        return;
    }

    const totalTime = getActiveSessionTime();
    const warningTime = totalTime - window.SessionConfig.WARNING_BEFORE;

    // 🔄 [SYNC] localStorage'daki admin_auth süresini de güncelle (Admin paneliyle senkronizasyon için)
    const authData = localStorage.getItem('admin_auth');
    if (authData) {
        try {
            const auth = JSON.parse(authData);
            auth.expiry = Date.now() + totalTime;
            localStorage.setItem('admin_auth', JSON.stringify(auth));
            // console.log("🔄 [TIMER] localStorage admin_auth süresi güncellendi.");
        } catch (e) {
            console.error("❌ [TIMER] localStorage güncellenemedi:", e);
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

function logout(reason = 'manual') {
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

    // 1. Timers ve Uyarıları temizle
    if (typeof window.sessionTimer !== 'undefined') clearTimeout(window.sessionTimer);
    if (typeof window.warningTimeout !== 'undefined') clearTimeout(window.warningTimeout);
    if (typeof window.logInterval !== 'undefined') clearInterval(window.logInterval);

    const warningDiv = document.getElementById('sessionWarning');
    if (warningDiv) warningDiv.style.display = 'none';

    // 2. Kimlik verilerini temizle
    window.clearSession();

    // [WHY]: Clear the Firebase Auth session to prevent automatic re-login on page refresh.
    // [HOW]: Invoke window.SecurityConfig.logout() or dynamically import the auth SDK and sign out.
    if (window.SecurityConfig && typeof window.SecurityConfig.logout === 'function') {
        window.SecurityConfig.logout();
    } else {
        try {
            import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js").then(({ getAuth, signOut }) => {
                const auth = getAuth(window.firebaseApp || window.app);
                signOut(auth);
            });
        } catch (e) {
            console.error("❌ Firebase Auth signOut error during dynamic fallback:", e);
        }
    }

    // [WHY]: admin.html'de bu yol kullanılıyor ve olay yayınlanmadığı için firebase-handler senkronu sıfırlamıyor,
    //        signOut ile ölen dinleyiciler kilit açıldıktan sonra yeniden başlamıyordu (AUTH-08).
    window.dispatchEvent(new CustomEvent('onAppLogout', { detail: { reason } }));

    // 3. CSS Sınıfını Kaldır
    document.body.classList.remove('logged-in');
    window._launchpadTriggered = false;

    // 4. Launchpad görünürlük kontrolü [DECOMMISSIONED]
    const lpView = document.getElementById('launchpad-view');
    if (lpView) {
        lpView.style.display = 'none';
    }

    // 5. Modalı Ekrana Getir veya Redirect Et
    const loginModal = document.getElementById('loginModal');
    const adminLockModal = document.getElementById('adminLockModal');
    const inventoryScreen = document.getElementById('inventory-screen');

    if (loginModal) {
        loginModal.classList.remove('hidden-modal');
        loginModal.style.setProperty('display', 'flex', 'important');

        const codeInput = document.getElementById('access-val-node');
        if (codeInput) {
            codeInput.value = '';
            if (window._dx) window._dx._r('access-val-node');
        }

        const statusDiv = document.getElementById('loginStatus');
        if (statusDiv) {
            statusDiv.innerHTML = '';
        }

        if (inventoryScreen) {
            inventoryScreen.style.setProperty('display', 'block', 'important');
            inventoryScreen.style.setProperty('visibility', 'visible', 'important');
            inventoryScreen.style.setProperty('opacity', '1', 'important');
        }
        const userDisplay = document.getElementById('userDisplay');
        if (userDisplay) userDisplay.style.display = 'none';
        return;
    } else if (adminLockModal) {
        adminLockModal.style.setProperty('display', 'flex', 'important');
        console.log("🔒 [LOGOUT] Admin paneli kilitlendi.");
        return;
    } else {
        window.location.replace('index.html');
        return;
    }

    const userDisplay = document.getElementById('userDisplay');
    if (userDisplay) {
        userDisplay.innerHTML = '<span style="color:#e74c3c; font-weight:bold;">Oturum Kapalı</span>';
    }

    // 6. Launchpad kontrolü yoksa showAppAlert
    if (typeof showAppAlert === 'function') {
        const msg = reason === 'timeout'
            ? "Oturum süresi dolduğu için güvenli çıkış yapıldı."
            : "Oturum başarıyla kapatıldı.";
        showAppAlert(msg, reason === 'timeout' ? "warning" : "success");
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
