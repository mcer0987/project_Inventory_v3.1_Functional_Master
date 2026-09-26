// =============================================================================
// ZERO PAGE / LAUNCHPAD LOGIC
// [WHY]: Sistemin ilk açılışında kullanıcıyı doğrudan karmaşık tablolarla 
//        boğmamak ve Premium Apple/Linear hissi vermek için izole edildi.
// [HOW]: initLaunchpad(), window.currentUser onaylandıktan hemen sonra tetiklenir.
//        Reaktif Skeleton Loading kullanılarak veriler geldiği an (timeout olmadan) yansıtılır.
// =============================================================================

window.initLaunchpadGate = function (mode) {
    const launchpadView = document.getElementById('launchpad-view');
    if (!launchpadView) return;

    const lpGate = document.getElementById('lp-gate-container');
    const lpBentoGrid = document.getElementById('lp-bento-grid');
    const lpNavGrid = document.getElementById('lp-nav-grid');
    const lpNavTitle = document.getElementById('lp-nav-title');
    const lpClassicToggle = document.getElementById('lp-classic-toggle');
    const lpTopWidgets = document.querySelector('.launchpad-top-widgets');
    const lpFooterBadges = document.querySelector('.launchpad-footer-badges');
    const lpHero = document.querySelector('.launchpad-hero');

    // Kullanıcı talebi: Parallax Organik animasyon kodda kalsın ama şimdilik pasif (yorum satırı) olsun.
    // initParallaxEffect();

    if (mode === 'no-auth') {
        // Show minimal login gate overlay
        if (lpGate) lpGate.style.display = 'flex';

        // Show background elements so they can be blurred by the Gate overlay
        if (lpBentoGrid) lpBentoGrid.style.display = 'grid';
        if (lpNavGrid) lpNavGrid.style.display = 'grid';
        if (lpNavTitle) lpNavTitle.style.display = 'block';
        if (lpTopWidgets) lpTopWidgets.style.display = 'flex';
        if (lpFooterBadges) lpFooterBadges.style.display = 'flex';
        if (lpHero) lpHero.style.display = 'block';

        if (lpClassicToggle) lpClassicToggle.style.display = 'flex';

        // Dinamik olarak Gate'i Hero ile Bento Grid arasına taşı (üst üste binmeyi önlemek için)
        if (lpGate && lpBentoGrid && lpGate.parentNode) {
            lpGate.parentNode.insertBefore(lpGate, lpBentoGrid);
        }

        // Mock veriler: Kullanıcı giriş yapmadığı için Skeleton/Bağlanıyor yazmasın
        const liveStatusEl = document.getElementById('launchpad-live-status');
        if (liveStatusEl) liveStatusEl.innerText = "Kimlik Doğrulaması Bekleniyor";

        const lpZimmet = document.getElementById('lp-zimmet-count');
        const lpTodo = document.getElementById('lp-todo-count');
        const lpTalep = document.getElementById('lp-talep-count');

        if (lpZimmet) {
            lpZimmet.innerHTML = '<i class="fas fa-lock" style="font-size:1.5rem; opacity:0.5;"></i>';
            lpZimmet.classList.remove('skeleton-pulse');
        }
        if (lpTodo) {
            lpTodo.innerHTML = '<i class="fas fa-lock" style="font-size:1.5rem; opacity:0.5;"></i>';
            lpTodo.classList.remove('skeleton-pulse');
        }
        if (lpTalep) {
            lpTalep.innerHTML = '<i class="fas fa-lock" style="font-size:1.5rem; opacity:0.5;"></i>';
            lpTalep.classList.remove('skeleton-pulse');
        }

        // Şifre girilmeden de saat ve hava durumu yüklensin
        initZenClock();
        initWeather();

        // Premium Stargaze Başlat
        if (typeof initPremiumStarfield === 'function') {
            initPremiumStarfield();
        }

        // Tema Seçici Başlat
        if (typeof initThemeSwitcher === 'function') {
            initThemeSwitcher();
        }

        // Keep hero visible but set text for gate
        if (lpHero) {
            lpHero.style.display = 'block';
            const personalGreetingEl = document.getElementById('launchpad-personal-greeting');
            const greetingEl = document.getElementById('launchpad-greeting');

            if (personalGreetingEl) {
                personalGreetingEl.innerText = "Kimlik Doğrulaması Gerekli";
            }
            if (greetingEl) {
                greetingEl.innerText = "Kozmos Kapısı";
                greetingEl.className = "anim-type-1"; // ensure it has an animation
            }
        }

        // Focus the input
        setTimeout(() => {
            const gateInput = document.getElementById('lp-gate-input');
            if (gateInput) gateInput.focus();
        }, 100);

        // 🛡️ DEVTOOLS ANTI-TAMPERING (DOM SECURITY)
        if (window._lpSecurityObserver) window._lpSecurityObserver.disconnect();
        window._lpSecurityObserver = new MutationObserver((mutations) => {
            if (!window.currentUser) {
                let tampered = false;
                for (let m of mutations) {
                    if (m.type === 'childList') {
                        for (let node of m.removedNodes) {
                            if (node.id === 'lp-gate-container' || node.id === 'launchpad-view') tampered = true;
                        }
                    } else if (m.type === 'attributes' && (m.attributeName === 'style' || m.attributeName === 'class')) {
                        const target = m.target;
                        if (target.id === 'lp-gate-container' || target.id === 'launchpad-view') {
                            const style = window.getComputedStyle(target);
                            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
                                tampered = true;
                            }
                        }
                    }
                }
                if (tampered) {
                    document.body.innerHTML = '';
                    window.location.reload();
                }
            }
        });

        if (launchpadView) {
            window._lpSecurityObserver.observe(launchpadView, { attributes: true, attributeFilter: ['style', 'class'] });
            if (launchpadView.parentNode) {
                window._lpSecurityObserver.observe(launchpadView.parentNode, { childList: true });
            }
        }
        if (lpGate) {
            window._lpSecurityObserver.observe(lpGate, { attributes: true, attributeFilter: ['style', 'class'] });
            if (lpGate.parentNode) {
                window._lpSecurityObserver.observe(lpGate.parentNode, { childList: true });
            }
        }

    } else if (mode === 'auth') {
        // User authenticated, safely disconnect observer before any legitimate DOM manipulation begins
        if (window._lpSecurityObserver) {
            window._lpSecurityObserver.disconnect();
            window._lpSecurityObserver = null;
        }

        // User authenticated, start boot sequence
        if (lpGate) lpGate.style.display = 'none';
        if (lpClassicToggle) lpClassicToggle.style.display = 'none';

        startBootSequence(() => {
            // After boot sequence, show Bento Grid and other elements
            if (lpBentoGrid) lpBentoGrid.style.display = 'grid';
            if (lpNavGrid) lpNavGrid.style.display = 'grid';
            if (lpNavTitle) lpNavTitle.style.display = 'block';
            if (lpTopWidgets) lpTopWidgets.style.display = 'flex';
            if (lpFooterBadges) lpFooterBadges.style.display = 'flex';
            if (lpHero) lpHero.style.display = 'block';

            // Also call the original initLaunchpad
            window.initLaunchpad();
        });
    }
};

window.setClassicMode = function () {
    localStorage.setItem('viewPref', 'basic');
    location.reload();
};

function startBootSequence(callback) {
    const bootOverlay = document.getElementById('lp-boot-sequence');
    const bootText = document.getElementById('boot-status-text');

    if (!bootOverlay) {
        if (callback) callback();
        return;
    }

    bootOverlay.style.display = 'flex';
    bootOverlay.style.opacity = '1';

    const messages = [
        "Kozmos Ağına Bağlanıyor...",
        "Veri Akışı Sağlanıyor...",
        "Erişim Onaylandı"
    ];

    let step = 0;
    bootText.innerText = messages[0];

    const interval = setInterval(() => {
        step++;
        if (step < messages.length) {
            bootText.innerText = messages[step];
        } else {
            clearInterval(interval);
            bootOverlay.style.opacity = '0';
            setTimeout(() => {
                bootOverlay.style.display = 'none';
                if (callback) callback();
            }, 500);
        }
    }, 600);
}

function initParallaxEffect() {
    const launchpadView = document.getElementById('launchpad-view');
    if (!launchpadView) return;

    if (!window._launchpadParallaxInit) {
        window._launchpadParallaxInit = true;

        let time = 0;
        let targetX = 0.5;
        let targetY = 0.5;
        let currentX = 0.5;
        let currentY = 0.5;

        document.addEventListener('mousemove', (e) => {
            if (launchpadView.style.display !== 'none' && !launchpadView.classList.contains('fade-out-scale')) {
                targetX = e.clientX / window.innerWidth;
                targetY = e.clientY / window.innerHeight;
            }
        });

        function animateParallax() {
            if (launchpadView.style.display !== 'none') {
                currentX += (targetX - currentX) * 0.05;
                currentY += (targetY - currentY) * 0.05;

                time += 0.005;
                const breathX = Math.sin(time) * 5;
                const breathY = Math.cos(time * 0.8) * 5;

                launchpadView.style.setProperty('--bg-x1', `${15 + (currentX - 0.5) * 20 + breathX}%`);
                launchpadView.style.setProperty('--bg-y1', `${50 + (currentY - 0.5) * 20 + breathY}%`);
                launchpadView.style.setProperty('--bg-x2', `${85 - (currentX - 0.5) * 30 - breathX}%`);
                launchpadView.style.setProperty('--bg-y2', `${30 - (currentY - 0.5) * 30 - breathY}%`);
            }
            requestAnimationFrame(animateParallax);
        }

        animateParallax();
    }
}

window.initLaunchpad = function () {
    const launchpadView = document.getElementById('launchpad-view');
    const greetingEl = document.getElementById('launchpad-greeting');
    const greetingTimeEl = document.getElementById('launchpad-time-greeting');

    if (!launchpadView) return;

    // 0. Micro-Widgets (Zen Clock & Weather) & Starfield
    initZenClock();
    initWeather();
    if (typeof initPremiumStarfield === 'function') {
        initPremiumStarfield();
    }

    // Tema Seçici Başlat
    if (typeof initThemeSwitcher === 'function') {
        initThemeSwitcher();
    }

    // Kullanıcı giriş yaptıysa Gate'i Biometrik Çıkışa dönüştür
    const gateContainer = document.getElementById('lp-gate-container');
    const gateCenter = document.querySelector('.lp-gate-center');
    const gateLeft = document.querySelector('.lp-gate-left');

    if (gateContainer && window.currentUser) {
        gateContainer.style.display = 'flex'; // Ensure visible

        if (gateCenter) {
            gateCenter.innerHTML = `
                <div class="premium-logout-wrapper" onclick="window.handleLaunchpadLogout(event)" title="Sistemi Güvenle Kapat">
                    <div class="logout-hologram">
                        <i class="fas fa-fingerprint base-icon"></i>
                        <i class="fas fa-power-off hover-icon"></i>
                        <div class="holo-ring-1"></div>
                        <div class="holo-ring-2"></div>
                        <div class="holo-ring-3"></div>
                    </div>
                </div>
            `;
        }

        if (gateLeft) {
            const title = gateLeft.querySelector('.gate-info-title');
            const desc = gateLeft.querySelector('.gate-info-desc');
            const icon = gateLeft.querySelector('.gate-info-box i');
            if (title && desc) {
                title.textContent = "Sistem Aktif";
                title.style.color = "var(--theme-accent-1-solid)";
                desc.textContent = "Güvenli bağlantı sağlandı. Oturumu sonlandırmak için sistemi kapatabilirsiniz.";
                if (icon) {
                    icon.className = "fas fa-shield-check";
                    icon.style.color = "var(--theme-accent-1-solid)";
                }
            }
        }
    }

    // 1. Karşılama Mesajı
    if (greetingEl && window.currentUser) {
        greetingEl.innerHTML = `Merkezi Sisteme Bağlandınız`;
        greetingEl.className = "anim-type-1";
    }

    if (greetingTimeEl && window.currentUser) {
        // İsim ve saat bilgisi
        const hour = new Date().getHours();
        let timeMsg = "İYİ GÜNLER";
        if (hour < 12) timeMsg = "GÜNAYDIN";
        else if (hour > 18) timeMsg = "İYİ AKŞAMLAR";

        greetingTimeEl.innerText = `${timeMsg}, ${window.currentUser.name}`;
    }

    // "Ana Depo (B1)" yönlendirme animasyonu (Kullanıcıya öneri)
    setTimeout(() => {
        // "b1" click parametresine sahip nav-card'ı bul
        const navCards = document.querySelectorAll('.nav-card');
        navCards.forEach(card => {
            if (card.getAttribute('onclick') && card.getAttribute('onclick').includes("'b1'")) {
                card.classList.add('suggested-route-pulse');
            }
        });
    }, 1500);

    // 2. Reaktif Skeleton Loading (Bekleme yok, veriyi dinler)
    let userName = window.currentUser?.name || window.currentUser?.displayName || "";
    const personalGreetingEl = document.getElementById('launchpad-personal-greeting');
    if (personalGreetingEl) {
        const hour = new Date().getHours();
        let timeGreeting = "MERHABA";
        if (hour >= 5 && hour < 12) timeGreeting = "GÜNAYDIN";
        else if (hour >= 12 && hour < 18) timeGreeting = "İYİ GÜNLER";
        else if (hour >= 18 && hour < 22) timeGreeting = "İYİ AKŞAMLAR";
        else timeGreeting = "İYİ GECELER";

        if (userName === "Kullanıcı" || userName === "Admin" || !userName) {
            personalGreetingEl.innerText = `${timeGreeting}, Yönetici`;
        } else {
            personalGreetingEl.innerText = `${timeGreeting}, ${userName}`;
        }
    }

    // 3. Soyut, Havalı Ana Karşılama (H1)
    let isNameValid = userName && userName !== "Kullanıcı" && userName !== "Admin";
    const finalGreetings = [
        "Kozmos Ağı Aktif",
        "Operasyon Alanınız Hazır",
        "Merkezi Sisteme Bağlandınız",
        "Yönetim Sahanıza Hoş Geldiniz"
    ];

    const randomGreeting = finalGreetings[Math.floor(Math.random() * finalGreetings.length)];

    if (greetingEl) {
        greetingEl.innerText = randomGreeting;
        greetingEl.className = "";
        const animIndex = Math.floor(Math.random() * 4) + 1;
        greetingEl.classList.add(`anim-type-${animIndex}`);
    }

    // 2. Reaktif Skeleton Loading (Bekleme yok, veriyi dinler)
    window.updateLaunchpadData();
};

window.updateLaunchpadData = function () {
    const launchpadView = document.getElementById('launchpad-view');

    // Sadece bir kere doldurmak için check koyuyoruz
    if (window._launchpadDataLoaded) return;

    // Verilerin yüklenmesini dinleyen reaktif interval (Firebase geldiği an yazar)
    const pollInterval = setInterval(() => {
        // window.data (b1, b2, b3, tasks, requests vs. objeleri mevcuttur)
        if (window.isFirebaseLoaded && window.data) {
            clearInterval(pollInterval);
            window._launchpadDataLoaded = true;

            const me = window.currentUser?.name;

            // CANLI VERİ WIDGET GÜNCELLEMESİ (Footer'daki Soyut Veriler)
            const liveStatusEl = document.getElementById('launchpad-live-status');
            if (liveStatusEl) {
                // Sayı yerine kullanıcının hoşuna gidecek soyut ve fütüristik durum bilgisi
                liveStatusEl.innerText = "Kesintisiz Aktarım";
            }

            // Rastgele Ping Dalgalanması (Footer için)
            if (!window._launchpadPingInterval) {
                window._launchpadPingInterval = setInterval(() => {
                    const pingEl = document.getElementById('launchpad-ping');
                    if (pingEl && launchpadView.style.display !== 'none') {
                        pingEl.innerText = (Math.floor(Math.random() * 8) + 8) + 'ms';
                    }
                }, 2000);
            }

            // Hesaplamalar
            let zimmetCount = 0;
            if (me && window.data.b3 && Array.isArray(window.data.b3)) {
                zimmetCount = window.data.b3.filter(x => x.personel === me).length;
            }

            let taskCount = 0;
            if (me && window.data.tasks && Array.isArray(window.data.tasks)) {
                taskCount = window.data.tasks.filter(t => t.assignedTo === me && t.status !== 'completed').length;
            }

            let reqCount = 0;
            if (me && window.data.requests && Array.isArray(window.data.requests)) {
                reqCount = window.data.requests.filter(r => r.personel === me && (r.durum === 'Bekliyor' || r.durum === 'Onaylandı')).length;
            }

            // DOM Güncellemeleri (Skeleton'ları gerçek değerlerle değiştir)
            const lpZimmet = document.getElementById('lp-zimmet-count');
            const lpTodo = document.getElementById('lp-todo-count');
            const lpTalep = document.getElementById('lp-talep-count');

            // Çok hafif sayma animasyonu efekti vermek isterseniz setTimeout vs. eklenebilir ama şu an direkt yazıyoruz.
            if (lpZimmet) lpZimmet.innerText = zimmetCount;
            if (lpTodo) lpTodo.innerText = taskCount;
            if (lpTalep) lpTalep.innerText = reqCount;
        }
    }, 100);

    // Her ihtimale karşı 10 saniye sonra intervali temizle (Memory leak olmasın)
    setTimeout(() => { clearInterval(pollInterval); }, 10000);
};

window.triggerLaunchModule = function (tabId) {
    // [WHY]: Strictly verify both local user state and Firebase session to prevent bypass.
    // [HOW]: Verify both window.currentUser and window.userAuth are populated.
    if (!window.currentUser || !window.userAuth) {
        if (typeof window.launchpadShowMessage === 'function') {
            window.launchpadShowMessage("Önce yetki doğrulamanız gerekmektedir.", "error");
        }
        return;
    }

    const launchpadView = document.getElementById('launchpad-view');
    const inventoryScreen = document.getElementById('inventory-screen');

    if (!launchpadView || !inventoryScreen) return;

    // 1. CSS Animasyonunu tetikle (Fade-out ve Scale-down)
    launchpadView.classList.add('fade-out-scale');

    // 2. Animasyon bittikten sonra asıl arayüzü göster (300ms transition)
    setTimeout(() => {
        launchpadView.style.display = 'none';
        // Asıl Inventory Screen zaten arkada display:block olarak bulunuyor (z-index ile örtüldü).
        // Yinede garantiye alalım.
        inventoryScreen.style.setProperty('display', 'block', 'important');

        // İlgili sekmeye geç
        localStorage.setItem('launchpadBypassed', 'true');
        if (typeof window.switchTab === 'function') {
            window.switchTab(tabId);
        }
    }, 300);
};

// =============================================================================
// MICRO-WIDGET LOGIC (CLOCK & WEATHER)
// =============================================================================

function initZenClock() {
    if (window._zenClockInterval) clearInterval(window._zenClockInterval);

    const timeEl = document.getElementById('zen-time');
    const dateEl = document.getElementById('zen-date');
    if (!timeEl || !dateEl) return;

    const days = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];
    const months = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

    function updateClock() {
        const now = new Date();
        const hours = String(now.getHours()).padStart(2, '0');
        const mins = String(now.getMinutes()).padStart(2, '0');
        const secs = String(now.getSeconds()).padStart(2, '0');

        timeEl.innerHTML = `${hours}:${mins}<span class="seconds">${secs}</span>`;

        const dayName = days[now.getDay()];
        const dayOfMonth = now.getDate();
        const monthName = months[now.getMonth()];

        dateEl.innerText = `${dayOfMonth} ${monthName} ${dayName}`;
    }

    updateClock(); // İlk tetikleme
    window._zenClockInterval = setInterval(updateClock, 1000);
}

async function initWeather() {
    const weatherWidget = document.getElementById('weather-widget');
    const weatherTemp = document.getElementById('weather-temp');
    const weatherIcon = document.getElementById('weather-icon');

    if (!weatherWidget || !weatherTemp || !weatherIcon) return;

    // Eğer daha önce yüklendiyse tekrar fetch atma (API koruması)
    if (weatherWidget.style.display === 'flex') return;

    try {
        // Eski tarayıcılarda AbortSignal hatası almamak için AbortController
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        // Open-Meteo API (Key gerektirmez) - Varsayılan: İstanbul
        const res = await fetch('https://api.open-meteo.com/v1/forecast?latitude=41.0082&longitude=28.9784&current_weather=true', { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!res.ok) throw new Error("Weather API Response Error");
        const data = await res.json();

        const current = data.current_weather;
        if (current && current.temperature !== undefined) {
            weatherTemp.innerText = `${Math.round(current.temperature)}°C`;

            // WMO Weather Code tabanlı ikon belirleme
            const code = current.weathercode;
            let iconClass = 'fas fa-sun';
            let iconColor = '#f1c40f';

            if (code === 0 || code === 1) { iconClass = 'fas fa-sun'; iconColor = '#f1c40f'; } // Güneşli
            else if (code === 2 || code === 3) { iconClass = 'fas fa-cloud-sun'; iconColor = '#f39c12'; } // Parçalı Bulutlu
            else if (code >= 45 && code <= 48) { iconClass = 'fas fa-smog'; iconColor = '#95a5a6'; } // Sis
            else if (code >= 51 && code <= 67) { iconClass = 'fas fa-cloud-rain'; iconColor = '#3498db'; } // Yağmur
            else if (code >= 71 && code <= 77) { iconClass = 'fas fa-snowflake'; iconColor = '#ecf0f1'; } // Kar
            else if (code >= 95) { iconClass = 'fas fa-bolt'; iconColor = '#f1c40f'; } // Fırtına
            else { iconClass = 'fas fa-cloud'; iconColor = '#bdc3c7'; } // Kapalı / Varsayılan

            weatherIcon.className = iconClass;
            weatherIcon.style.color = iconColor;

            weatherWidget.style.display = 'flex';
        }
    } catch (e) {
        console.warn("Hava durumu yüklenemedi (Sistem bloklanmadı). Detay:", e);
        weatherWidget.style.display = 'none';
    }
}

// =============================================================================
// PREMIUM STARFIELD (3-LAYER PARALLAX)
// =============================================================================
function initPremiumStarfield() {
    const launchpadView = document.getElementById('launchpad-view');
    if (!launchpadView) return;

    // Sadece bir kere oluştur
    if (document.getElementById('premium-stargaze-container')) return;

    const starContainer = document.createElement('div');
    starContainer.id = 'premium-stargaze-container';
    // Container'ı launchpad-view içine en alta (z-index 0 gibi) yerleştir
    starContainer.innerHTML = `
        <div id="stars-small"></div>
        <div id="stars-medium"></div>
        <div id="stars-large"></div>
    `;
    launchpadView.prepend(starContainer);

    // Box-shadow string üreten fonksiyon
    function generateStars(count) {
        let val = '';
        for (let i = 0; i < count; i++) {
            // Ekran çözünürlüğüne göre rastgele koordinatlar
            const x = Math.floor(Math.random() * 2000);
            const y = Math.floor(Math.random() * 2000);
            val += `${x}px ${y}px #FFF`;
            if (i < count - 1) val += ', ';
        }
        return val;
    }

    // Stil atamaları
    const smallStars = generateStars(300);
    const mediumStars = generateStars(100);
    const largeStars = generateStars(30);

    const style = document.createElement('style');
    style.innerHTML = `
        #premium-stargaze-container {
            position: absolute;
            top: 0; left: 0; width: 100%; height: 100%;
            overflow: hidden;
            z-index: 0; /* Arka planda kalması için */
            pointer-events: none;
            transition: opacity 0.6s ease;
        }

        #stars-small {
            width: 1px; height: 1px;
            background: transparent;
            box-shadow: ${smallStars};
            animation: stargazeAnim 100s linear infinite;
            opacity: 0.5;
        }
        #stars-small:after {
            content: " "; position: absolute; top: 2000px;
            width: 1px; height: 1px; background: transparent;
            box-shadow: ${smallStars};
        }

        #stars-medium {
            width: 2px; height: 2px;
            background: transparent;
            box-shadow: ${mediumStars};
            animation: stargazeAnim 70s linear infinite;
            opacity: 0.7;
        }
        #stars-medium:after {
            content: " "; position: absolute; top: 2000px;
            width: 2px; height: 2px; background: transparent;
            box-shadow: ${mediumStars};
        }

        #stars-large {
            width: 3px; height: 3px;
            background: transparent;
            box-shadow: ${largeStars};
            animation: stargazeAnim 40s linear infinite;
            opacity: 0.9;
        }
        #stars-large:after {
            content: " "; position: absolute; top: 2000px;
            width: 3px; height: 3px; background: transparent;
            box-shadow: ${largeStars};
        }

        @keyframes stargazeAnim {
            from { transform: translateY(0px); }
            to   { transform: translateY(-2000px); }
        }
    `;
    document.head.appendChild(style);
}

// =============================================================================
// ORBITAL THEME SWITCHER
// =============================================================================
function initThemeSwitcher() {
    const launchpadView = document.getElementById('launchpad-view');
    if (!launchpadView) return;

    // Sadece bir kere oluştur
    if (document.getElementById('theme-switcher-pill')) return;

    const themes = [
        { id: 'cosmos', title: 'Cosmos (Default)' },
        { id: 'theme-cyberneon', title: 'Cyber-Neon' },
        { id: 'theme-emerald', title: 'Emerald Matrix' },
        { id: 'theme-parallax', title: 'Organic Parallax (Eski)' },
        { id: 'theme-obsidian', title: 'Obsidian (Pure Dark)' }
    ];

    const switcher = document.createElement('div');
    switcher.id = 'theme-switcher-pill';
    switcher.className = 'theme-switcher-pill';

    // Mevcut kayıtlı temayı al, yoksa parallax kullan (Orijinal Premium Lacivert)
    const savedTheme = localStorage.getItem('launchpadTheme') || 'theme-parallax';

    // Temayı body'ye uygula
    function applyTheme(themeId) {
        // Mevcut tema class'larını temizle
        document.body.classList.remove('theme-cyberneon', 'theme-emerald', 'theme-parallax', 'theme-obsidian');

        if (themeId !== 'cosmos') {
            document.body.classList.add(themeId);
        }

        // Aktif dot'u güncelle
        document.querySelectorAll('.theme-dot').forEach(dot => {
            dot.classList.remove('active');
            if (dot.getAttribute('data-theme') === themeId) {
                dot.classList.add('active');
            }
        });

        localStorage.setItem('launchpadTheme', themeId);

        // Premium Stargaze Container
        const starContainer = document.getElementById('premium-stargaze-container');

        // Eğer tema parallax ise organik animasyonu (mouse takibi) aktifleştir, yıldızları gizle
        if (themeId === 'theme-parallax') {
            document.addEventListener('mousemove', handleParallaxMove);
            if (starContainer) starContainer.style.opacity = '0';
        } else {
            // Parallax değilse mouse takibini bırak ve pozisyonları sıfırla, yıldızları göster
            document.removeEventListener('mousemove', handleParallaxMove);
            launchpadView.style.setProperty('--bg-x1', '15%');
            launchpadView.style.setProperty('--bg-y1', '50%');
            launchpadView.style.setProperty('--bg-x2', '85%');
            launchpadView.style.setProperty('--bg-y2', '30%');
            if (starContainer) starContainer.style.opacity = '1';
        }
    }

    // Parallax mousemove handle
    function handleParallaxMove(e) {
        const x = e.clientX / window.innerWidth;
        const y = e.clientY / window.innerHeight;
        // Fare hareketine göre organik bir tepki
        launchpadView.style.setProperty('--bg-x1', `${10 + x * 20}%`);
        launchpadView.style.setProperty('--bg-y1', `${40 + y * 20}%`);
        launchpadView.style.setProperty('--bg-x2', `${80 - x * 10}%`);
        launchpadView.style.setProperty('--bg-y2', `${20 + y * 15}%`);
    }

    // Dotları oluştur
    themes.forEach(theme => {
        const dot = document.createElement('div');
        dot.className = 'theme-dot';
        dot.setAttribute('data-theme', theme.id);
        dot.title = theme.title;

        if (theme.id === savedTheme) {
            dot.classList.add('active');
        }

        dot.addEventListener('click', () => {
            applyTheme(theme.id);
        });

        switcher.appendChild(dot);
    });

    launchpadView.appendChild(switcher);

    // Başlangıçta kayitli temayi yükle
    applyTheme(savedTheme);
}

window.handleLaunchpadLogout = function (e) {
    if (e) e.preventDefault();
    if (typeof window.launchpadShowMessage === 'function') {
        window.launchpadShowMessage("Oturum güvenli bir şekilde kapatılıyor...", "warning", false);
    }
    setTimeout(() => {
        localStorage.removeItem('launchpadBypassed');
        if (typeof logout === 'function') {
            logout();
        } else {
            localStorage.removeItem('activeUser');
            localStorage.removeItem('viewPref');
            localStorage.removeItem('admin_auth');
            sessionStorage.removeItem('adminVizesi');
            localStorage.removeItem('lastUser');
            window.currentUser = null;
        }
        // Launchpade geri dön ve gate input göster
        if (typeof window.initLaunchpadGate === 'function') {
            window._launchpadTriggered = false;
            const lpView = document.getElementById('launchpad-view');
            if (lpView) lpView.style.display = 'flex';
            window.initLaunchpadGate('no-auth');
        } else {
            window.location.reload();
        }
    }, 1500);
};

window.launchpadResetMessage = function () {
    const leftGate = document.querySelector('.lp-gate-left');
    const title = document.querySelector('.gate-info-title');
    const desc = document.querySelector('.gate-info-desc');
    const icon = document.querySelector('.gate-info-box i');

    if (!leftGate || !title || !desc) return;

    if (window._lpMessageTimeout) clearTimeout(window._lpMessageTimeout);

    leftGate.classList.remove('pulse-message');
    leftGate.style.removeProperty('display'); // Revert to CSS

    if (window.currentUser) {
        title.textContent = "Sistem Aktif";
        title.style.color = "var(--theme-accent-1-solid)";
        desc.textContent = "Güvenli bağlantı sağlandı. Oturumu sonlandırmak için sistemi kapatabilirsiniz.";
        if (icon) {
            icon.className = "fas fa-shield-check";
            icon.style.color = "var(--theme-accent-1-solid)";
        }
    } else {
        title.textContent = "Sistem Erişimi Kısıtlı";
        title.style.color = "";
        desc.textContent = "Merkezi veritabanına bağlanmak için yetki doğrulama bekleniyor.";
        if (icon) {
            icon.className = "fas fa-shield-alt";
            icon.style.color = "";
        }
    }
};

/* Launchpad'e dönüş fonksiyonları */
window.showLaunchpad = function () {
    // [WHY]: Block Launchpad access if it has been globally disabled by admin.
    // [HOW]: Check localStorage status, show alert and return if true.
    if (localStorage.getItem('launchpadDisabledGlobal') === 'true') {
        if (typeof showAppAlert === 'function') {
            showAppAlert("Launchpad devre dışı bırakılmıştır.", "error");
        }
        return;
    }
    const lpView = document.getElementById('launchpad-view');
    const invScreen = document.getElementById('inventory-screen');
    if (lpView) {
        window._launchpadTriggered = false;
        lpView.style.display = 'flex';
        
        // [WHY]: Allow authenticated users to bypass the lock gate and go directly to Bento grid.
        // [HOW]: Verify if activeUser is set and load in 'auth' mode, otherwise fall back to 'no-auth' gate.
        const isAuthActive = !!localStorage.getItem('activeUser');
        if (isAuthActive) {
            window.initLaunchpadGate('auth');
        } else {
            window.initLaunchpadGate('no-auth');
        }
        if (invScreen) invScreen.style.display = 'none';
    }
};

window.returnToLaunchpad = function () {
    window.showLaunchpad();
};

/* loginModal idle timer: 3 dakika işlem yoksa launchpade dön */
(function initLoginModalIdleTimer() {
    let idleTimer = null;
    const IDLE_TIMEOUT = 3 * 60 * 1000; // 3 dakika

    function resetIdleTimer() {
        if (idleTimer) clearTimeout(idleTimer);
        const lpView = document.getElementById('launchpad-view');
        if (lpView && lpView.style.display !== 'none') return;
        idleTimer = setTimeout(() => {
            window.showLaunchpad();
        }, IDLE_TIMEOUT);
    }

    document.addEventListener('mousemove', resetIdleTimer);
    document.addEventListener('keydown', resetIdleTimer);
    document.addEventListener('click', resetIdleTimer);
    document.addEventListener('touchstart', resetIdleTimer);

    resetIdleTimer();
})();

window.handleFingerprintClick = function () {
    const input = document.getElementById('lp-gate-input');
    const actualCode = window._lpShadowPass !== undefined ? window._lpShadowPass : (input ? input.value : "");

    if (!input || !actualCode.trim()) {
        if (input) input.focus();
        return;
    }

    // Yalnızca handleLogin varsa tetikle
    if (typeof handleLogin === 'function') {
        const code = actualCode.trim();
        const classicInput = document.getElementById('access-val-node');
        if (classicInput) classicInput.value = code;
        if (window._dx && window._dx._b) window._dx._b['access-val-node'] = code;

        const prevUser = localStorage.getItem('activeUser');

        const originalShowAppAlert = window.showAppAlert;
        window.showAppAlert = function (msg, type) {
            if (type === 'error') {
                window.launchpadShowMessage(msg, 'error');
            } else {
                window.launchpadShowMessage(msg, 'success');
            }
        };

        // handleLogin asenkrondur, Promise döndürmeyebilir ancak biz await edelim
        (async () => {
            try {
                await handleLogin(new Event('submit'));
                const newUser = localStorage.getItem('activeUser');
                if (prevUser === newUser || !newUser) {
                    // Hatalı Giriş
                    window.launchpadShowMessage("Girdiğiniz erişim kodu geçersiz.", "error");
                    input.value = "";
                } else {
                    // Başarılı (showAppAlert zaten success fırlattı)
                }
            } catch (e) {
                console.error(e);
            } finally {
                window.showAppAlert = originalShowAppAlert;
            }
        })();
    }
};

window.handlePortalClick = async function () {
    // [WHY]: Portal button directly routes to admin.html, so we must strictly authenticate and verify admin credentials.
    // [HOW]: Verify password using SecurityConfig.authenticate(code) and only redirect if successful, else show access denied message.
    const input = document.getElementById('lp-gate-input');
    if (!input || !input.value.trim()) {
        if (input) input.focus();
        return;
    }

    const code = input.value.trim();

    try {
        const isAdminPass = await SecurityConfig.authenticate(code);

        if (isAdminPass) {
            // Find admin user in personel data or create virtual admin object
            let user = null;
            if (window.data && window.data.personel) {
                user = window.data.personel.find(p => p.name === 'Muhammed Cer' || p.name === 'Admin');
            }
            if (!user) {
                user = { name: "Admin", code: "ADMIN", yetki: "admin" };
            }

            localStorage.setItem('activeUser', JSON.stringify(user));
            window.currentUser = user;

            const expiry = new Date().getTime() + (10 * 60 * 1000); // 10 minutes session
            localStorage.setItem('admin_auth', JSON.stringify({ expiry }));
            sessionStorage.setItem('adminVizesi', 'true');

            if (typeof updateNavbarUI === "function") {
                updateNavbarUI(user);
            }

            window.launchpadShowMessage("Erişim onaylandı. Yönlendiriliyorsunuz...", "success");
            setTimeout(() => {
                window.location.href = 'admin.html';
            }, 1000);
        } else {
            window.launchpadShowMessage("Kurucu Ağına geçiş yetkiniz yok!", "error");
        }
    } catch (e) {
        console.error("Portal Click Error:", e);
        window.launchpadShowMessage("Erişim doğrulaması sırasında bir hata oluştu.", "error");
    }
};

// =============================================================================
// SHADOW INPUT (Tarayıcı İzolasyonu ve Caret Gizleme İçin Gölge State)
// =============================================================================
(function initShadowInput() {
    const input = document.getElementById('lp-gate-input');
    if (!input) return;

    window._lpShadowPass = "";

    function renderDots() {
        input.value = "•".repeat(window._lpShadowPass.length);
    }

    input.addEventListener('input', (e) => {
        const val = input.value;
        const inputType = e.inputType;
        const cursorPosition = input.selectionStart;
        const currentLen = val.length;
        const previousLen = window._lpShadowPass.length;

        // Ekleme yapıldıysa (Yazma veya Paste)
        if (currentLen > previousLen) {
            const addedText = val.replace(/•/g, ""); // yeni eklenen karakterleri filtrele
            if (addedText) {
                const cursorStart = cursorPosition - addedText.length;
                window._lpShadowPass = window._lpShadowPass.slice(0, cursorStart) + addedText + window._lpShadowPass.slice(cursorStart);
            } else {
                // Sadece noktalar kopyalanmışsa vs. geri çevir
                renderDots();
                input.setSelectionRange(cursorPosition, cursorPosition);
                return;
            }
        }
        // Silme yapıldıysa
        else if (currentLen < previousLen) {
            const deletedCount = previousLen - currentLen;
            window._lpShadowPass = window._lpShadowPass.slice(0, cursorPosition) + window._lpShadowPass.slice(cursorPosition + deletedCount);
        }

        // Max uzunluk limiti (5)
        if (window._lpShadowPass.length > 5) {
            window._lpShadowPass = window._lpShadowPass.substring(0, 5);
        }

        renderDots();
        // İmleci doğru konuma taşı
        let newCursor = cursorPosition;
        if (newCursor > window._lpShadowPass.length) newCursor = window._lpShadowPass.length;
        input.setSelectionRange(newCursor, newCursor);

        // Eski handleFingerprintClick için gizli aktarım
        const classicInput = document.getElementById('access-val-node');
        if (classicInput) classicInput.value = window._lpShadowPass;
    });

    // Copy-Paste güvenliği: Gerçek şifre kopyalanmasını veya noktanın kopyalanmasını engelle
    input.addEventListener('copy', (e) => {
        e.preventDefault();
    });

    input.addEventListener('cut', (e) => {
        e.preventDefault();
        window._lpShadowPass = "";
        renderDots();
    });
})();

// =============================================================================
// ANTI-TAMPERING (Frontend Güvenlik Zafiyeti - DOM İzleme)
// =============================================================================
(function initAntiTampering() {
    let observer = null;

    function startObserver() {
        const targetNode = document.body;
        const config = { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] };

        observer = new MutationObserver((mutations) => {
            // BAŞARILI LOGİN SONRASI: Memory leak engellemek için observer'ı öldür
            if (window.currentUser) {
                if (observer) {
                    observer.disconnect();
                    observer = null;
                }
                return;
            }

            const gateContainer = document.getElementById('lp-gate-container');
            if (!gateContainer) {
                // DOM'dan silinmiş! Güvenlik ihlali.
                window.location.reload();
                return;
            }

            // CSS ile gizlenmiş veya saydamlaştırılmış!
            const style = window.getComputedStyle(gateContainer);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
                // Launchpad'deyiz, giriş yapılmamış, ama gateContainer görünmez yapılmış.
                // initLaunchpadGate içindeki meşru gizlemeler (auth modunda vs) buraya window.currentUser ile takılmalıydı.
                // Ancak no-auth modundayken biri bunu manuel display:none yaptıysa ihlaldir.
                const lpView = document.getElementById('launchpad-view');
                if (lpView && lpView.style.display !== 'none') {
                    // Sayfayı tamamen karartıp reload yapalım
                    document.body.style.display = 'none';
                    window.location.reload();
                }
            }
        });

        observer.observe(targetNode, config);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startObserver);
    } else {
        startObserver();
    }
})();

window.launchpadShowMessage = function (msg, type = 'info', pulse = false) {
    const leftGate = document.querySelector('.lp-gate-left');
    const title = document.querySelector('.gate-info-title');
    const desc = document.querySelector('.gate-info-desc');
    const icon = document.querySelector('.gate-info-box i');

    if (!leftGate || !title || !desc) {
        if (typeof window.showAppAlert === 'function') window.showAppAlert(msg, type);
        return;
    }

    if (window._lpMessageTimeout) clearTimeout(window._lpMessageTimeout);

    leftGate.style.display = 'flex';
    title.textContent = type === 'error' ? 'Eri�im Reddedildi' : type === 'success' ? 'Eri�im Onayland�' : 'Sistem Bilgisi';
    title.style.color = type === 'error' ? 'var(--theme-accent-2-solid)' : type === 'success' ? 'var(--theme-accent-1-solid)' : 'var(--vip-warning)';
    desc.textContent = msg;
    
    if (icon) {
        icon.className = type === 'error' ? 'fas fa-shield-xmark' : type === 'success' ? 'fas fa-shield-check' : 'fas fa-info-circle';
        icon.style.color = title.style.color;
    }

    if (pulse) {
        leftGate.classList.add('pulse-message');
    } else {
        leftGate.classList.remove('pulse-message');
    }

    window._lpMessageTimeout = setTimeout(() => {
        if (typeof window.launchpadResetMessage === 'function') {
            window.launchpadResetMessage();
        }
    }, 5000);
};
