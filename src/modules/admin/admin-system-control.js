/**
 * ═══════════════════════════════════════════════════════════════════
 *  🌌 SİSTEM KONTROL MERKEZİ — VIP EXCLUSIVE JS ENGINE
 * ═══════════════════════════════════════════════════════════════════
 *  Bu modül, Admin'e tam sistem hakimiyeti sunar.
 *  - Gelişmiş Konsol Interceptor (log/warn/error/info + onerror)
 *  - Sistem Sağlık Monitörü (memory, network, uptime, data size)
 *  - Operasyon Raporu (count-up animasyonlu)
 *  - Debug & Hata Takip Paneli
 *  - SortableJS Sürükle-Bırak (geliştirilmiş)
 *  - Oturum & Güvenlik Widget'ı
 * ═══════════════════════════════════════════════════════════════════
 */

(function () {
    'use strict';

    // Sayfa yüklendiğinde başlat
    const _pageLoadTime = Date.now();
    let _logFilter = 'all';
    let _logCount = { info: 0, warn: 0, error: 0, success: 0 };
    let _runtimeErrors = [];

    // [WHY] (v3.6 · İP-4 · VIP-11): Konsol akışı sayfa genelinde her console.* çağrısında çalışır (VIP sekmesi hiç açılmamış
    //        olsa bile). Mesaj uzunluğu sınırsızdı (büyük nesneler JSON olarak DOM'a basılıyordu), çalışma zamanı hataları
    //        sınırsız dizide birikiyordu, 150 tavanı her eklemede querySelectorAll ile taranıyordu ve scrollHeight okunuyordu.
    // [HOW]: Sabit tavanlar; kayıt sayısı childElementCount ile; kaydırma yalnız VIP sekmesi görünürken, dönüşte bir kez.
    const _MAX_LOG_ENTRIES = 150;
    const _MAX_LOG_MSG_CHARS = 2000;
    const _MAX_RUNTIME_ERRORS = 50;
    let _terminalScrollPending = false;

    function _pushRuntimeError(err) {
        _runtimeErrors.push(err);
        if (_runtimeErrors.length > _MAX_RUNTIME_ERRORS) _runtimeErrors.splice(0, _runtimeErrors.length - _MAX_RUNTIME_ERRORS);
    }

    // ═══════════════════════════════════════════════════════════════
    // 1. GELİŞMİŞ KONSOL INTERCEPTOR
    // ═══════════════════════════════════════════════════════════════

    const _originals = {
        log: console.log,
        warn: console.warn,
        error: console.error,
        info: console.info
    };

    function _getTerminal() {
        return document.getElementById('vipLogTerminal');
    }

    function _formatArg(a) {
        if (a === null) return 'null';
        if (a === undefined) return 'undefined';
        if (typeof a === 'object') {
            try { return JSON.stringify(a, null, 0); }
            catch (e) { return String(a); }
        }
        return String(a);
    }

    function _appendLog(type, args) {
        const terminal = _getTerminal();
        if (!terminal) return;

        let msg = Array.from(args).map(_formatArg).join(' ');
        if (msg.length > _MAX_LOG_MSG_CHARS) msg = msg.slice(0, _MAX_LOG_MSG_CHARS) + ' … [' + (msg.length - _MAX_LOG_MSG_CHARS) + ' karakter kısaltıldı]';
        const time = new Date().toLocaleTimeString('tr-TR', { hour12: false });

        const icons = {
            info: 'fa-circle-info',
            warn: 'fa-triangle-exclamation',
            error: 'fa-circle-xmark',
            success: 'fa-circle-check'
        };

        // VIP-11: innerHTML sink'i yok; düğümler createElement/textContent ile kurulur (aynı sınıflar, aynı görünüm).
        const div = document.createElement('div');
        div.className = `log-entry ${type}`;
        div.setAttribute('data-type', type);
        const icon = document.createElement('i');
        icon.className = `fas ${icons[type] || icons.info} log-icon`;
        const ts = document.createElement('span');
        ts.className = 'timestamp';
        ts.textContent = time;
        const body = document.createElement('span');
        body.className = 'log-msg';
        body.textContent = msg;
        div.append(icon, ts, body);

        // Filter kontrolü
        if (_logFilter !== 'all' && type !== _logFilter) {
            div.style.display = 'none';
        }

        terminal.appendChild(div);
        _logCount[type] = (_logCount[type] || 0) + 1;
        _updateLogCountBadges();

        // Tavan: en eski kayıtlar düşer (tarama yok)
        while (terminal.childElementCount > _MAX_LOG_ENTRIES && terminal.firstElementChild) {
            terminal.firstElementChild.remove();
        }

        // Otomatik scroll: yalnız VIP sekmesi görünürken (gizliyken layout okuması yapılmaz; dönüşte bir kez kaydırılır)
        if (_isVipTabVisible()) {
            terminal.scrollTop = terminal.scrollHeight;
        } else {
            _terminalScrollPending = true;
        }
    }

    function _flushTerminalScroll() {
        if (!_terminalScrollPending) return;
        const terminal = _getTerminal();
        if (terminal) terminal.scrollTop = terminal.scrollHeight;
        _terminalScrollPending = false;
    }

    // Kanca
    console.log = function (...args) {
        _originals.log.apply(console, args);
        _appendLog('info', args);
    };

    console.warn = function (...args) {
        _originals.warn.apply(console, args);
        _appendLog('warn', args);
    };

    console.error = function (...args) {
        _originals.error.apply(console, args);
        _appendLog('error', args);
    };

    console.info = function (...args) {
        _originals.info.apply(console, args);
        _appendLog('info', args);
    };

    // Global hata yakalayıcı
    window.addEventListener('error', function (e) {
        const errMsg = `${e.message} — ${e.filename || 'unknown'}:${e.lineno || '?'}`;
        _appendLog('error', ['[RUNTIME ERROR]', errMsg]);
        _pushRuntimeError({
            message: e.message,
            file: e.filename,
            line: e.lineno,
            time: new Date().toISOString()
        });
    });

    window.addEventListener('unhandledrejection', function (e) {
        _appendLog('error', ['[UNHANDLED PROMISE]', e.reason || 'Unknown rejection']);
        _pushRuntimeError({
            message: String(e.reason),
            file: 'Promise',
            line: '-',
            time: new Date().toISOString()
        });
    });


    // ═══════════════════════════════════════════════════════════════
    // 2. TERMINAL KONTROL FONKSİYONLARI
    // ═══════════════════════════════════════════════════════════════

    window.vipClearTerminal = function () {
        const terminal = _getTerminal();
        if (terminal) {
            terminal.replaceChildren();
            _logCount = { info: 0, warn: 0, error: 0, success: 0 };
            _updateLogCountBadges();
            _appendLog('success', ['🧹 Terminal temizlendi.']);
        }
    };

    window.vipFilterLogs = function (type, btn) {
        _logFilter = type;
        const terminal = _getTerminal();
        if (!terminal) return;

        // Tüm logların görünürlüğünü güncelle
        terminal.querySelectorAll('.log-entry').forEach(el => {
            if (type === 'all') {
                el.style.display = '';
            } else {
                el.style.display = el.getAttribute('data-type') === type ? '' : 'none';
            }
        });

        // Buton aktif durumunu güncelle
        document.querySelectorAll('.vip-filter-btn').forEach(b => b.classList.remove('active'));
        if (btn) btn.classList.add('active');
    };

    function _updateLogCountBadges() {
        const infoEl = document.getElementById('vipLogCountInfo');
        const warnEl = document.getElementById('vipLogCountWarn');
        const errorEl = document.getElementById('vipLogCountError');
        if (infoEl) infoEl.textContent = _logCount.info || 0;
        if (warnEl) warnEl.textContent = _logCount.warn || 0;
        if (errorEl) errorEl.textContent = _logCount.error || 0;
    }


    // ═══════════════════════════════════════════════════════════════
    // 3. SİSTEM SAĞLIK MONİTÖRÜ
    // ═══════════════════════════════════════════════════════════════

    // [WHY] (v3.6 · İP-4 · VIP-13): Veri boyutu (JSON.stringify(window.data) + Blob) ve DOM düğüm sayısı (querySelectorAll('*'))
    //        her saniye hesaplanıyordu; sekme görünürken sürekli CPU.
    // [HOW]: `full` yalnız her _HEAVY_HEALTH_EVERY tikte bir ve açık tazelemelerde true; diğer tiklerde ağır ölçümler atlanır.
    const _HEAVY_HEALTH_EVERY = 5;

    function _updateSystemHealth(full) {
        if (full === undefined) full = true;
        // Uptime
        const uptimeEl = document.getElementById('vipUptime');
        if (uptimeEl) {
            const elapsed = Math.floor((Date.now() - _pageLoadTime) / 1000);
            const hrs = Math.floor(elapsed / 3600);
            const mins = Math.floor((elapsed % 3600) / 60);
            const secs = elapsed % 60;
            uptimeEl.textContent = `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        }

        // Memory (Chrome only)
        const memBar = document.getElementById('vipMemoryBar');
        const memText = document.getElementById('vipMemoryText');
        if (memBar && performance.memory) {
            const used = performance.memory.usedJSHeapSize;
            const total = performance.memory.jsHeapSizeLimit;
            const pct = Math.round((used / total) * 100);
            const usedMB = (used / 1024 / 1024).toFixed(1);
            const totalMB = (total / 1024 / 1024).toFixed(0);
            memBar.style.width = pct + '%';
            memBar.className = 'health-bar-fill ' + (pct > 80 ? 'danger' : pct > 50 ? 'warning' : 'good');
            if (memText) memText.textContent = `${usedMB} / ${totalMB} MB`;
        } else if (memText) {
            memText.textContent = 'N/A';
        }

        // Network
        const netEl = document.getElementById('vipNetwork');
        if (netEl) {
            const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
            if (conn) {
                netEl.textContent = `${conn.effectiveType?.toUpperCase() || '?'} — ${conn.downlink || '?'} Mbps`;
            } else {
                netEl.textContent = navigator.onLine ? 'Çevrimiçi' : 'Çevrimdışı';
            }
        }

        // Firebase / Online Status
        const fbEl = document.getElementById('vipFirebaseDot');
        if (fbEl) {
            fbEl.className = 'heartbeat-dot ' + (navigator.onLine ? 'online' : 'offline');
        }
        const fbText = document.getElementById('vipFirebaseText');
        if (fbText) {
            fbText.textContent = navigator.onLine ? 'Bağlı' : 'Bağlantı Kesildi';
            fbText.style.color = navigator.onLine ? 'var(--vip-matrix)' : 'var(--vip-danger)';
        }

        if (!full) return;

        // Data Size (window.data analizi) — ağır ölçüm (VIP-13)
        const dataEl = document.getElementById('vipDataSize');
        if (dataEl && window.data) {
            try {
                const jsonStr = JSON.stringify(window.data);
                const sizeKB = (new Blob([jsonStr]).size / 1024).toFixed(1);
                const b1Count = Array.isArray(window.data.b1) ? window.data.b1.length : Object.keys(window.data.b1 || {}).length;
                const b2Count = Array.isArray(window.data.b2) ? window.data.b2.length : Object.keys(window.data.b2 || {}).length;
                dataEl.textContent = `${sizeKB} KB — ${b1Count + b2Count} kayıt`;
            } catch (e) {
                dataEl.textContent = 'Hesaplanamadı';
            }
        }

        // DOM düğüm sayısı
        const domEl = document.getElementById('vipDomNodes');
        if (domEl) {
            domEl.textContent = document.querySelectorAll('*').length.toLocaleString('tr-TR');
        }
    }


    // ═══════════════════════════════════════════════════════════════
    // 4. OPERASYON RAPORU — COUNT-UP ANİMASYONLU
    // ═══════════════════════════════════════════════════════════════

    // [WHY] (v3.6 · İP-4 · VIP-12): Her sekme girişinde 6 rAF döngüsü açılıyor, tutamaç saklanmıyordu; hızlı tekrar girişte
    //        aynı öğeye iki döngü yazıyor, sekme kapanınca da döngü bitene kadar sürüyordu.
    // [HOW]: Öğe başına rAF tutamacı (_countUpFrames); yeni animasyon öncekini iptal eder. Sekme görünmüyorsa animasyonsuz
    //        son değer yazılır. Sekme çıkışı / sayfa gizlenmesi _cancelCountUps ile tüm döngüleri keser.
    const _countUpFrames = new Map();

    function _cancelCountUps() {
        _countUpFrames.forEach(function (handle) { cancelAnimationFrame(handle); });
        _countUpFrames.clear();
    }

    function _animateCountUp(elementId, targetValue, duration) {
        const el = document.getElementById(elementId);
        if (!el) return;
        const prev = _countUpFrames.get(elementId);
        if (prev !== undefined) { cancelAnimationFrame(prev); _countUpFrames.delete(elementId); }

        if (!_isVipTabVisible()) {
            el.textContent = Number(targetValue).toLocaleString('tr-TR');
            return;
        }

        const start = 0;
        const startTime = performance.now();

        function tick(now) {
            const elapsed = now - startTime;
            const progress = Math.min(elapsed / duration, 1);
            // Ease-out cubic
            const eased = 1 - Math.pow(1 - progress, 3);
            el.textContent = Math.floor(start + (targetValue - start) * eased).toLocaleString('tr-TR');
            if (progress < 1) {
                _countUpFrames.set(elementId, requestAnimationFrame(tick));
            } else {
                _countUpFrames.delete(elementId);
            }
        }
        _countUpFrames.set(elementId, requestAnimationFrame(tick));
    }

    function _updateOpsReport() {
        if (!window.data) return;

        const b1 = window.data.b1 || [];
        const b2 = window.data.b2 || [];
        const b3 = window.data.b3 || [];
        const requests = window.data.requests || [];

        const b1Arr = Array.isArray(b1) ? b1 : Object.values(b1);
        const b2Arr = Array.isArray(b2) ? b2 : Object.values(b2);
        const b3Arr = Array.isArray(b3) ? b3 : Object.values(b3);
        const reqArr = Array.isArray(requests) ? requests : Object.values(requests);

        // Toplam stok miktarı
        let totalStock = 0;
        [...b1Arr, ...b2Arr].forEach(item => {
            if (item && (item.durumu !== 'Pasif' && item.status !== 'Pasif')) {
                totalStock += parseInt(item.adet || item.qty || 0);
            }
        });

        const totalProducts = b1Arr.length + b2Arr.length;
        const totalExits = b3Arr.length;
        const pendingRequests = reqArr.filter(r => r && (r.status === 'Beklemede' || r.durum === 'Beklemede')).length;

        // Kritik stok
        let criticalCount = 0;
        [...b1Arr, ...b2Arr].forEach(item => {
            if (!item || item.durumu === 'Pasif' || item.status === 'Pasif') return;
            const qty = parseInt(item.adet || item.qty || 0);
            const limit = parseInt(item.limit || 3);
            if (qty <= limit) criticalCount++;
        });

        // Ürün türü sayısı
        const typeCount = (window.data.productTypes || []).length;

        // Animasyonlu sayaçları başlat
        _animateCountUp('opsProducts', totalProducts, 1200);
        _animateCountUp('opsStock', totalStock, 1400);
        _animateCountUp('opsExits', totalExits, 1000);
        _animateCountUp('opsPending', pendingRequests, 800);
        _animateCountUp('opsCritical', criticalCount, 1000);
        _animateCountUp('opsTypes', typeCount, 800);
    }


    // ═══════════════════════════════════════════════════════════════
    // 5. DEBUG & HATA TAKİP PANELİ
    // ═══════════════════════════════════════════════════════════════

    function _renderDebugPanel() {
        const container = document.getElementById('vipDebugList');
        if (!container) return;

        // Statik (bilinen) hatalar/geliştirmeler
        const knownItems = [
            { status: 'resolved', title: 'Chart.js Canvas Bellek Sızıntısı', desc: 'destroy() çağrısı eklenerek çözüldü', badge: 'Çözüldü' },
            { status: 'resolved', title: 'Sub-collection Veri Mimarisi', desc: 'Tek-döküman yapısından alt koleksiyon mimarisine geçiş', badge: 'Tamamlandı' },
            { status: 'resolved', title: 'Firebase Chunk Yazma (500lük)', desc: 'Büyük veri setleri için parçalı kayıt', badge: 'Tamamlandı' },
            { status: 'resolved', title: 'SHA-256 Güvenlik Hash', desc: 'Şifrelerin geri döndürülemez hash ile saklanması', badge: 'Aktif' },
            { status: 'resolved', title: 'SortableJS Entegrasyonu', desc: 'VIP widget sürükle-bırak motoru', badge: 'Tamamlandı' },
            { status: 'resolved', title: 'Console Interceptor', desc: 'Canlı log yakalama ve terminal akışı', badge: 'Aktif' },
            { status: 'active', title: 'VIP Kontrol Merkezi v2.0', desc: 'Premium UI yeniden inşası — aktif geliştirme', badge: 'Devam Ediyor' }
        ];

        // Runtime hatalarını ekle
        _runtimeErrors.forEach(err => {
            knownItems.push({
                status: 'critical',
                title: err.message.substring(0, 60),
                desc: `${err.file || 'bilinmeyen'} @ satır ${err.line || '?'}`,
                badge: 'Runtime Hata'
            });
        });

        const statusIcons = {
            resolved: '✅',
            active: '⚠️',
            critical: '🔴'
        };

        container.innerHTML = knownItems.map(item => `
            <li class="debug-item">
                <span class="debug-status">${escapeHtml(statusIcons[item.status])}</span>
                <div class="debug-info">
                    <div class="debug-title">${escapeHtml(item.title)}</div>
                    <div class="debug-desc">${escapeHtml(item.desc)}</div>
                </div>
                <span class="debug-badge ${escapeHtml(item.status)}">${escapeHtml(item.badge)}</span>
            </li>
        `).join('');
    }


    // ═══════════════════════════════════════════════════════════════
    // 6. PLATFORM & DONANIM ANALİZİ
    // ═══════════════════════════════════════════════════════════════

    function _updatePlatformInfo() {
        // Tarayıcı Motoru
        const browserEl = document.getElementById('vipBrowserEngine');
        if (browserEl) {
            const ua = navigator.userAgent;
            let engine = 'Bilinmeyen Motor';
            if (ua.includes('Edg/')) engine = 'Edge (Chromium)';
            else if (ua.includes('Chrome')) engine = 'Chrome (Blink)';
            else if (ua.includes('Firefox')) engine = 'Firefox (Gecko)';
            else if (ua.includes('Safari') && !ua.includes('Chrome')) engine = 'Safari (WebKit)';
            browserEl.textContent = engine;
        }

        // Ekran çözünürlüğü
        const screenEl = document.getElementById('vipScreenRes');
        if (screenEl) {
            screenEl.textContent = `${window.screen.width}×${window.screen.height} (${window.devicePixelRatio}x)`;
        }

        // Viewport
        const viewportEl = document.getElementById('vipViewport');
        if (viewportEl) {
            viewportEl.textContent = `${window.innerWidth}×${window.innerHeight}`;
        }

        // OS/Platform
        const osEl = document.getElementById('vipOS');
        if (osEl) {
            osEl.textContent = navigator.platform || 'Bilinmeyen';
        }

        // Dil
        const langEl = document.getElementById('vipLanguage');
        if (langEl) {
            langEl.textContent = navigator.language || 'tr-TR';
        }

        // LocalStorage boyutu
        const lsEl = document.getElementById('vipLocalStorage');
        if (lsEl) {
            let totalSize = 0;
            for (let key in localStorage) {
                if (localStorage.hasOwnProperty(key)) {
                    totalSize += localStorage[key].length * 2; // UTF-16
                }
            }
            lsEl.textContent = (totalSize / 1024).toFixed(1) + ' KB';
        }

        // Çerez durumu
        const cookieEl = document.getElementById('vipCookies');
        if (cookieEl) {
            cookieEl.textContent = navigator.cookieEnabled ? 'Aktif' : 'Devre Dışı';
        }

        // Donanım çekirdek sayısı
        const coreEl = document.getElementById('vipCores');
        if (coreEl) {
            coreEl.textContent = (navigator.hardwareConcurrency || '?') + ' Çekirdek';
        }
    }


    // ═══════════════════════════════════════════════════════════════
    // 7. OTURUM & GÜVENLİK WIDGET'I
    // ═══════════════════════════════════════════════════════════════

    function _updateSessionInfo() {
        const countdownEl = document.getElementById('vipSessionTime');
        const lastLoginEl = document.getElementById('vipLastLogin');
        const userEl = document.getElementById('vipActiveUser');
        const securityBars = document.querySelectorAll('#vipSecurityLevel .security-bar');

        // Oturum geri sayım
        const authData = localStorage.getItem('admin_auth');
        if (authData && countdownEl) {
            try {
                const auth = JSON.parse(authData);
                const remaining = Math.max(0, auth.expiry - Date.now());
                const mins = Math.floor(remaining / 60000);
                const secs = Math.floor((remaining % 60000) / 1000);
                countdownEl.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

                // 1 dakikadan az kaldıysa uyarı modu
                if (remaining < 60000) {
                    countdownEl.classList.add('warning');
                } else {
                    countdownEl.classList.remove('warning');
                }

                if (remaining <= 0) {
                    countdownEl.textContent = '00:00';
                    countdownEl.classList.add('warning');
                }
            } catch (e) {
                countdownEl.textContent = '--:--';
            }
        }

        // Son giriş zamanı
        if (lastLoginEl) {
            const now = new Date();
            lastLoginEl.textContent = now.toLocaleDateString('tr-TR') + ' ' + now.toLocaleTimeString('tr-TR', { hour12: false });
        }

        // Aktif kullanıcı
        if (userEl) {
            const user = window.getActiveUser();
            userEl.textContent = (user && user.name) || 'Admin';
        }

        // Güvenlik seviyesi (5 barlı)
        if (securityBars.length) {
            let level = 0;
            if (typeof SecurityConfig !== 'undefined') level++; // SHA-256 tanımlı
            if (localStorage.getItem('admin_auth')) level++;      // Oturum aktif
            if (window.location.protocol === 'https:' || window.location.hostname === 'localhost') level++; // HTTPS veya localhost
            if (navigator.cookieEnabled) level++;                  // Çerez aktif
            level++; // Varsayılan 1 puan — uygulama çalışıyor

            securityBars.forEach((bar, i) => {
                bar.classList.toggle('active', i < level);
            });
        }
    }


    // ═══════════════════════════════════════════════════════════════
    // 8. SORTABLEJS ENTEGRASYONU (GELİŞTİRİLMİŞ)
    // ═══════════════════════════════════════════════════════════════

    function _initSortable() {
        const grid = document.getElementById('vipGrid');
        if (!grid || typeof Sortable === 'undefined') return;

        // Kayıtlı dizilimi yükle
        const savedOrder = localStorage.getItem('vipLayoutOrder');
        if (savedOrder) {
            try {
                const orderArr = JSON.parse(savedOrder);
                const items = Array.from(grid.children);
                orderArr.forEach(id => {
                    const el = items.find(item => item.getAttribute('data-id') === id);
                    if (el) grid.appendChild(el);
                });
            } catch (e) { /* Bozuk veri, atla */ }
        }

        // Sortable'ı başlat
        new Sortable(grid, {
            animation: 400,
            easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
            ghostClass: 'sortable-ghost',
            chosenClass: 'sortable-chosen',
            dragClass: 'sortable-drag',
            handle: '.vip-card-header',
            delay: 100,
            delayOnTouchOnly: true,
            onStart: function () {
                grid.style.transition = 'none';
            },
            onEnd: function () {
                grid.style.transition = '';
                const newOrder = Array.from(grid.children).map(el => el.getAttribute('data-id'));
                localStorage.setItem('vipLayoutOrder', JSON.stringify(newOrder));
                _appendLog('success', ['📌 Widget dizilimi kaydedildi.']);
            }
        });
    }

    // Widget Collapse/Expand
    function _initCollapse() {
        document.querySelectorAll('.vip-collapse-btn').forEach(btn => {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                const card = this.closest('.vip-card');
                if (card) {
                    card.classList.toggle('collapsed');
                    // Durumu localStorage'a kaydet
                    const id = card.getAttribute('data-id');
                    const collapsed = JSON.parse(localStorage.getItem('vipCollapsedWidgets') || '{}');
                    collapsed[id] = card.classList.contains('collapsed');
                    localStorage.setItem('vipCollapsedWidgets', JSON.stringify(collapsed));
                }
            });
        });

        // Kayıtlı collapse durumlarını yükle
        try {
            const collapsed = JSON.parse(localStorage.getItem('vipCollapsedWidgets') || '{}');
            Object.entries(collapsed).forEach(([id, isCollapsed]) => {
                if (isCollapsed) {
                    const card = document.querySelector(`.vip-card[data-id="${id}"]`);
                    if (card) card.classList.add('collapsed');
                }
            });
        } catch (e) { /* Bozuk veri, atla */ }
    }


    // ═══════════════════════════════════════════════════════════════
    // 9. DİZİLİMİ SIFIRLAMA
    // ═══════════════════════════════════════════════════════════════

    window.resetVipLayout = function () {
        localStorage.removeItem('vipLayoutOrder');
        localStorage.removeItem('vipCollapsedWidgets');
        _appendLog('warn', ['🔄 VIP dizilim sıfırlandı. Sayfa yenileniyor...']);
        setTimeout(() => location.reload(), 500);
    };


    // ═══════════════════════════════════════════════════════════════
    // 10. VIP SEKME AKTİFLEŞTİĞİNDE BAŞLATMA
    // ═══════════════════════════════════════════════════════════════

    let _vipInitialized = false;
    let _healthInterval = null;
    let _sessionInterval = null;

    // [WHY] (Faz 5 · K3 · 5.5 · VIP-08): Sağlık/oturum döngüsü (_updateSystemHealth + _updateSessionInfo, saniyede bir DOM
    //        yazımı ve performance.memory okuması) VIP sekmesi bir kez açılınca sayfa kapanana kadar çalışıyordu — kullanıcı
    //        başka sekmeye geçse, tarayıcı sekmesi arka plana alınsa da. Görünmeyen öğelere sonsuz CPU/DOM işi.
    // [HOW]: Döngü yalnız VIP sekmesi (#systemControlTab) görünür VE tarayıcı sekmesi ön plandayken çalışır. Sekmeden çıkınca
    //        (AdminTabs.onAny) ve sayfa gizlenince (visibilitychange) clearInterval; geri dönünce tek tazeleme + yeniden başlatma.
    //        _startHealthLoop idempotent (ikinci interval asla açılmaz). Teşhis: AppModules.VipHealth.{isRunning, ticks}.
    let _healthTicks = 0;
    function _isVipTabVisible() {
        const tab = document.getElementById('systemControlTab');
        return !!tab && tab.style.display !== 'none' && !document.hidden;
    }
    function _startHealthLoop() {
        if (_healthInterval !== null || !_isVipTabVisible()) return;
        _healthInterval = setInterval(() => {
            _healthTicks++;
            _updateSystemHealth(_healthTicks % _HEAVY_HEALTH_EVERY === 0);   // VIP-13: ağır ölçüm 5 tikte bir
            _updateSessionInfo();
        }, 1000);
    }
    function _stopHealthLoop() {
        _cancelCountUps();   // VIP-12: sekme/sayfa gizlenince sayaç animasyonları da durur
        if (_healthInterval === null) return;
        clearInterval(_healthInterval);
        _healthInterval = null;
    }
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) { _stopHealthLoop(); return; }
        if (_vipInitialized && _isVipTabVisible()) { _updateSystemHealth(); _updateSessionInfo(); _flushTerminalScroll(); _startHealthLoop(); }
    });
    // VIP-11: platform bilgisi yalnız VIP sekmesi görünürken yeniden hesaplanır; dönüşte _initVipPanel bir kez tazeler.
    function _onViewportResize() {
        if (!_isVipTabVisible()) return;
        _updatePlatformInfo();
    }
    window.AppModules = window.AppModules || {};
    window.AppModules.VipHealth = {
        isRunning: () => _healthInterval !== null,
        ticks: () => _healthTicks,
        countUpsActive: () => _countUpFrames.size,
        terminalEntries: () => { const t = _getTerminal(); return t ? t.childElementCount : 0; },
        runtimeErrors: () => _runtimeErrors.length
    };

    function _initVipPanel() {
        if (_vipInitialized) {
            // Zaten başlatılmış, sadece güncelle
            _updateOpsReport();
            _updatePlatformInfo();
            _updateSystemHealth();
            _updateSessionInfo();
            _renderDebugPanel();
            _flushTerminalScroll();   // VIP-11: gizliyken biriken loglar için tek kaydırma
            _startHealthLoop();   // VIP-08: sekmeye geri dönüşte döngü yeniden başlar
            return;
        }

        _vipInitialized = true;

        // Tüm modülleri başlat
        _initSortable();
        _initCollapse();
        _updatePlatformInfo();
        _updateOpsReport();
        _renderDebugPanel();
        _updateSystemHealth();
        _updateSessionInfo();

        // Periyodik güncellemeler
        _startHealthLoop();   // VIP-08: yalnız VIP sekmesi görünürken (bkz. _startHealthLoop)

        // VIP terminal açılış mesajı
        setTimeout(() => {
            _appendLog('success', ['🌌 VIP Sistem Kontrol Merkezi v2.0 aktif.']);
            _appendLog('info', ['📡 Konsol kancalama başarılı — tüm loglar burada.']);
        }, 300);

        // Viewport değişimlerini dinle
        window.addEventListener('resize', _onViewportResize);   // VIP-11: sekme gizliyken erken döner
        
        // [WHY]: Her 15 sn gerçek terminale sahte "X kullanıcısı talep onayladı" logu basılıyordu (VIP-03); kaldırıldı.
        //        God-Eye radarı gerçek presence gelene kadar DEMO olarak etiketli (Karar K8-b).
    }

    // ═══════════════════════════════════════════════════════════════
    // 7. YENİ VIP ÖZELLİKLERİ (God-Eye, Backup, Kill Switch)
    // ═══════════════════════════════════════════════════════════════

    // 1-Tık Veritabanı Yedeği
    // [WHY] (Faz 5 · K3 · 5.3 · ADM-06): Bu düğme window.data'nın ham dökümünü (sarmalayıcısız, ortam bilgisiz; auditLogs gibi
    //        uygulama dışı anahtarlar dahil) indiriyordu — index'teki "Yedek Al"dan farklı bir biçim.
    // [HOW]: Birleşik yedekleme servisine (admin-backup.js, BackupService) devredilir: kanonik { version:'3.2', root, timestamp, data }.
    window.vipBackupDatabase = function() {
        try {
            if (!window.BackupService) throw new Error('yedekleme servisi yüklenmedi');
            const b = window.BackupService.exportBackup({ source: 'vip' });
            _appendLog('success', [`💾 Kanonik yedek indirildi (v${b.version} · ${b.root} · ${Object.keys(b.data).length} koleksiyon).`]);
        } catch (error) {
            _appendLog('error', ['💾 Yedekleme sırasında hata oluştu: ' + error.message]);
        }
    };

    // Tekerrür (Birebir Kopya) Kayıtları Temizleyici
    // [WHY]: VIP-01: seri no kuralı b3 hareket defterine de uygulanıyordu; aynı cihazın zimmet → iade → yeniden zimmet
    //        kayıtlarından en yenisi (çoğunlukla aktif zimmet) siliniyordu; "N/A", "--", "bilinmiyor" gibi yer tutucular
    //        farklı ürünleri birleştiriyordu; onay kutusu yalnız toplam sayıyı gösteriyordu.
    //        VIP-02: silme, onaydan ÖNCE alınmış kopyayla üç koleksiyonun tamamını yeniden yazıyordu (dialog açıkken gelen
    //        kayıtlar silinir, düzenlemeler ezilirdi); başarısızlıkta da "başarıyla silindi" deniyordu.
    // [HOW]: Yalnız B1/B2 taranır (b3 kapsam dışı). Yer tutucu seri numaraları boş sayılır. Onay kutusunda depo bazında
    //        sayı + ilk satırların önizlemesi gösterilir. Onaydan SONRA güncel diziden yeniden hesaplanır ve yalnız
    //        önizlemede sayılan VE hâlâ kopya olan kayıtlar id ile silinir (başka hiçbir doküman yazılmaz).
    //        Çift tıklama kilidi, yalnız Firebase admin oturumu, sonuç doğru bildirilir.
    const _DUP_COLLECTIONS = ['b1', 'b2'];
    const _DUP_PREVIEW_ROWS = 10;
    const _PLACEHOLDER_SERIALS = new Set(['yok', 'none', 'null', 'undefined', 'n/a', 'na', 'n.a.', 'bilinmiyor', 'belirsiz',
        'tanımsız', 'tanimsiz', 'unknown', 'sn yok', 'seri no yok', '?', 'x']);

    const _normSerial = function (raw) {
        const s = String(raw ?? '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('tr-TR');
        if (!s || _PLACEHOLDER_SERIALS.has(s) || /^[-_.\/*\s]+$/.test(s) || /^0+$/.test(s)) return '';
        return s;
    };

    const _dupSignature = function (item) {
        return JSON.stringify(Object.keys(item)
            .filter(k => k !== 'id' && !k.startsWith('_'))
            .sort()
            .map(k => [k, typeof item[k] === 'string' ? item[k].trim() : (item[k] ?? '')]));
    };

    // Liste sırasındaki ilk kayıt tutulur; sonrakiler { colName, item, reason } olarak döner.
    const _findDuplicates = function (colName) {
        const seenSerial = new Set(), seenSig = new Set(), dups = [];
        (window.data?.[colName] || []).forEach(item => {
            if (!item || typeof item !== 'object' || item.id == null || item.id === '') return;
            const serial = _normSerial(item.seriNo ?? item.serialNo ?? item.seri ?? item.sn);
            const sig = _dupSignature(item);
            if (serial && seenSerial.has(serial)) { dups.push({ colName, item, reason: 'Aynı seri no' }); return; }
            if (seenSig.has(sig)) { dups.push({ colName, item, reason: 'Birebir kopya' }); return; }
            if (serial) seenSerial.add(serial);
            seenSig.add(sig);
        });
        return dups;
    };

    const _dupKey = d => `${d.colName}|${d.item.id}`;
    const _dupAlert = (msg, type) => { if (typeof showAppAlert === 'function') showAppAlert(msg, type); else alert(msg); };
    let _dupCleaning = false;

    window.vipCleanDuplicates = async function (btn) {
        if (_dupCleaning) return;
        if (!(typeof window.isDbAdmin === 'function' && window.isDbAdmin())) {
            _dupAlert('Bu işlem için yönetici (Firebase admin) oturumu gerekir.', 'error');
            return;
        }
        _dupCleaning = true;
        if (btn) btn.disabled = true;
        try {
            // 1. Önizleme
            // v3.6: rafı sayımdaki kayıtlar silinmez (sayım sonucu bozulmasın).
            const notLocked = d => !window.Schema?.isRowCountLocked?.(d.item);
            const preview = _DUP_COLLECTIONS.flatMap(_findDuplicates).filter(notLocked);
            if (preview.length === 0) {
                _dupAlert('🔍 B1/B2 depolarında tekerrür eden kayıt bulunamadı. (B3 hareket defteri taranmaz.)', 'info');
                return;
            }
            // Onay kutusu (script.js showCustomConfirm) metni textContent + pre-line ile basar: önizleme düz metin satırlarıdır.
            const perCol = _DUP_COLLECTIONS.map(c => `${c.toUpperCase()}: ${preview.filter(d => d.colName === c).length}`).join(' · ');
            const rows = preview.slice(0, _DUP_PREVIEW_ROWS).map((d, i) =>
                `${i + 1}. ${d.colName.toUpperCase()} · ${d.item.ürün || d.item.name || '-'} · Raf ${d.item.raf || '-'} · SN ${d.item.seriNo || d.item.sn || '-'} · Adet ${d.item.adet ?? '-'} — ${d.reason}`);
            const more = preview.length > _DUP_PREVIEW_ROWS ? [`… ve ${preview.length - _DUP_PREVIEW_ROWS} kayıt daha.`] : [];
            const message = [
                `Silinecek kayıt: ${preview.length} (${perCol}). Her grubun ilk kaydı tutulur; B3 hareket defteri kapsam dışıdır.`,
                '',
                ...rows,
                ...more,
                '',
                'Bu kayıtlar kalıcı olarak silinecek. Devam edilsin mi?'
            ].join('\n');
            const ok = typeof showCustomConfirm === 'function'
                ? await showCustomConfirm('Tekerrür Temizliği Onayı', message)
                : confirm(`${preview.length} tekerrür kaydı silinsin mi?`);
            if (ok !== true) return;

            // 2. Onaydan SONRA güncel diziden yeniden hesapla; yalnız önizlemede sayılan ve hâlâ kopya olanlar silinir
            const shown = new Set(preview.map(_dupKey));
            const toDelete = _DUP_COLLECTIONS.flatMap(_findDuplicates).filter(d => shown.has(_dupKey(d)) && notLocked(d));
            const skipped = preview.length - toDelete.length;
            if (toDelete.length === 0) {
                _dupAlert('Veriler bu arada değişti; silinecek kayıt kalmadı. Hiçbir şey silinmedi.', 'warning');
                return;
            }

            // 3. Yalnız bu dokümanlar silinir
            console.info('[vipCleanDuplicates] silinecek:', toDelete.map(_dupKey).join(', '), '| atlanan:', skipped);
            const { doc, writeBatch } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
            for (let i = 0; i < toDelete.length; i += 450) {
                const batch = writeBatch(window.fireDb);
                toDelete.slice(i, i + 450).forEach(d => batch.delete(
                    doc(window.fireDb, window.COLLECTION_ROOT, d.colName, 'items', String(d.item.id).replace(/\//g, '_'))));
                await batch.commit();
            }

            const note = skipped > 0 ? ` (${skipped} kayıt bu arada değiştiği için silinmedi.)` : '';
            _dupAlert(`🧹 ${toDelete.length} tekerrür kaydı silindi.${note}`, 'success');
            _appendLog('success', [`🧹 TEKERRÜR TEMİZLİĞİ: ${toDelete.length} kayıt silindi (${toDelete.map(_dupKey).join(', ')}).${note}`]);
        } catch (error) {
            console.error('Tekerrür temizlik hatası:', error);
            _dupAlert('Temizlik başarısız; kayıt silinmedi ya da yalnız bir kısmı silindi: ' + error.message, 'error');
        } finally {
            _dupCleaning = false;
            if (btn) btn.disabled = false;
        }
    };

    // ─── Şema Göçü (Faz 3.6 · DATA-08) ───────────────────────────────────────────────────────────────────────
    // [WHY]: b3 geçmişte dört farklı biçimde yazıldı. Okuyucular artık hepsini normalizeB3 ile doğru gösteriyor, ama eski
    //        kayıtlarda tür/raf bilgisi kayıtta yok (ürün silinirse kaybolur) ve eski alan adları sürüyor.
    // [HOW]: Önizleme → onay → b3 yedeği (JSON dosyası) indirilir → yalnız dönüşmesi gereken ve sözleşmeyi (validateB3) geçen
    //        kayıtlar kanonik halleriyle yazılır (400'lük atomik parçalar). Sözleşmeyi geçemeyenlere dokunulmaz, listelenir.
    //        Karşılığı olmayan alanlar (description vb.) korunur. Zimmet kayıtlarına, ad tek bir personele denk geliyorsa
    //        personelId eklenir. Tekrar çalıştırmak güvenlidir (dönüştürülecek kayıt kalmaz). Yalnız Firebase admin oturumu.
    const _MIGRATION_CHUNK = 400;
    const _stableJson = o => JSON.stringify(Object.keys(o).filter(k => !k.startsWith('_')).sort().map(k => [k, o[k] ?? null]));
    window.planB3Migration = function (items = window.data?.b3 || []) {
        const S = window.Schema;
        const plan = { total: items.length, alreadyCanonical: 0, convert: [], invalid: [], stats: { turFilled: 0, stokDisi: 0, personelId: 0 } };
        items.forEach(item => {
            if (!item || item.id == null || item.id === '') { plan.invalid.push({ id: item?.id, errors: ['id yok'] }); return; }
            const next = S.toCanonicalB3(item);
            let pidAdded = false;
            if (next.tip === 'zimmet' && !next.personelId && window.AssignmentService) {
                const pid = window.AssignmentService.resolvePersonelId(next.alanKisi);
                if (pid) { next.personelId = pid; pidAdded = true; }
            }
            if (_stableJson(next) === _stableJson(item)) { plan.alreadyCanonical++; return; }
            const errors = S.validateB3(next, { legacy: true });
            if (errors.length) { plan.invalid.push({ id: item.id, errors }); return; }
            if (pidAdded) plan.stats.personelId++;
            if ((item.urunTuru === undefined || item.urunTuru === '-' || item.urunTuru === '') && next.urunTuru !== '-') plan.stats.turFilled++;
            if (next.kaynakDepo === S.STOK_DISI && item.kaynakDepo !== S.STOK_DISI) plan.stats.stokDisi++;
            plan.convert.push(next);
        });
        return plan;
    };

    let _migrating = false;
    window.vipMigrateB3Schema = async function (btn) {
        if (_migrating) return;
        if (!(typeof window.isDbAdmin === 'function' && window.isDbAdmin())) {
            _dupAlert('Bu işlem için yönetici (Firebase admin) oturumu gerekir.', 'error');
            return;
        }
        _migrating = true;
        if (btn) btn.disabled = true;
        try {
            const plan = window.planB3Migration();
            if (plan.convert.length === 0) {
                const bad = plan.invalid.length ? ` Sözleşmeyi geçemeyen ${plan.invalid.length} kayıt var; konsola yazıldı.` : '';
                _dupAlert(`B3 zaten yeni şemada (${plan.alreadyCanonical}/${plan.total}).${bad}`, plan.invalid.length ? 'warning' : 'info');
                if (plan.invalid.length) console.warn('[Şema Göçü] dönüştürülemeyen kayıtlar:', plan.invalid);
                return;
            }
            const sample = plan.convert.slice(0, 5).map((c, i) => {
                const n = window.Schema.normalizeB3(c);
                return `${i + 1}. #${c.id} · ${n.tip === 'zimmet' ? 'Zimmet' : 'Çıkış'} · ${n.urunAciklama} · Tür ${n.urunTuru} · Raf ${n.rafNo} · ${n.alanKisi}`;
            });
            const message = [
                `Ortam: ${window.COLLECTION_ROOT}. B3 kayıt: ${plan.total} · zaten yeni şemada: ${plan.alreadyCanonical} · dönüştürülecek: ${plan.convert.length} · dokunulmayacak (sözleşme dışı): ${plan.invalid.length}.`,
                `Kayda kopyalanacak ürün türü: ${plan.stats.turFilled} · "TALEP" → Stok dışı: ${plan.stats.stokDisi} · personelId eklenecek: ${plan.stats.personelId}.`,
                '', ...sample, plan.convert.length > 5 ? `… ve ${plan.convert.length - 5} kayıt daha.` : '', '',
                'Önce b3 yedeği (JSON) indirilecek, sonra kayıtlar yeni şemayla yazılacak. Ekranlarda görünen değerler değişmez. Devam edilsin mi?'
            ].join('\n');
            const ok = typeof showCustomConfirm === 'function'
                ? await showCustomConfirm('Şema Göçü (B3) Onayı', message)
                : confirm(`${plan.convert.length} b3 kaydı yeni şemaya taşınsın mı?`);
            if (ok !== true) return;

            // 1. Yedek (yazmadan önce)
            const snapshot = { version: 1, root: window.COLLECTION_ROOT, collection: 'b3', timestamp: new Date().toISOString(), data: window.data.b3 || [] };
            const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 1)], { type: 'application/json' }));
            const a = document.createElement('a');
            a.href = url;
            a.download = `b3-yedek-${window.COLLECTION_ROOT}-${snapshot.timestamp.replace(/[:.]/g, '-')}.json`;
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 5000);

            // 2. Onaydan sonra güncel veriden yeniden planla; yalnız önizlemede gösterilen kayıtlar yazılır
            const shown = new Set(plan.convert.map(c => String(c.id)));
            const toWrite = window.planB3Migration().convert.filter(c => shown.has(String(c.id)));
            let written = 0;
            for (let i = 0; i < toWrite.length; i += _MIGRATION_CHUNK) {
                const chunk = toWrite.slice(i, i + _MIGRATION_CHUNK);
                await window.applyItemOps(chunk.map(item => ({ op: 'set', col: 'b3', item })), { b3Legacy: true });   // yalnız göç: eski kayıt gevşekliği (Faz 3.5 muhafızı)
                written += chunk.length;
            }
            const skipped = plan.convert.length - toWrite.length;
            const note = skipped ? ` (${skipped} kayıt bu arada değiştiği için atlandı.)` : '';
            _dupAlert(`🧬 Şema göçü tamamlandı: ${written} b3 kaydı yeni şemaya taşındı.${note}`, 'success');
            _appendLog('success', [`🧬 ŞEMA GÖÇÜ (B3): ${written} kayıt yazıldı · kök ${window.COLLECTION_ROOT} · yedek indirildi.${note}`]);
            if (plan.invalid.length) console.warn('[Şema Göçü] dönüştürülemeyen kayıtlar:', plan.invalid);
        } catch (error) {
            console.error('Şema göçü hatası:', error);
            _dupAlert('Şema göçü yarıda kaldı; yazılan parçalar yeni şemada, kalanlar eski şemada (ikisi de doğru görünür). Yedek dosyası indirildi. ' + error.message, 'error');
        } finally {
            _migrating = false;
            if (btn) btn.disabled = false;
        }
    };

    // ─── Sarf Zimmetlerini Tüketim Çıkışına Çevir (feat/envanter-talep-iade · Faz 2 · B-1) ───────────────────────
    // [WHY]: Karar 05.11.2026 — sarf malzeme tüketimdir. Eskiden sarf talep onayı da zimmet yazıyordu; bu kayıtlar kişinin Kişi
    //        Envanteri'nde ve zimmet tutanağında süresiz kalıyor, Zimmet ekranında "Zimmetten Düş" öneriyordu.
    // [HOW]: Şema Göçü deseni: önizleme (AssignmentService.planSarfConsumption, YAZMAZ) → onay → b3 yedeği (JSON) → onaydan
    //        sonra güncel veriden yeniden planlanır, yalnız önizlemede gösterilen kayıtların "tip" alanı 'cikis' yapılır
    //        (400'lük atomik parçalar). Stok değişmez. İade edilmiş ve demirbaş olup olmadığı yazmayan kayıtlara dokunulmaz.
    //        İkinci çalıştırmada dönüştürülecek kayıt kalmaz. Yalnız Firebase admin oturumu.
    let _sarfMigrating = false;
    window.vipMigrateSarfConsumption = async function (btn) {
        if (_sarfMigrating) return;
        if (!(typeof window.isDbAdmin === 'function' && window.isDbAdmin())) {
            _dupAlert('Bu işlem için yönetici (Firebase admin) oturumu gerekir.', 'error');
            return;
        }
        _sarfMigrating = true;
        if (btn) btn.disabled = true;
        try {
            const plan = window.AssignmentService.planSarfConsumption();
            const extra = [
                plan.returned.length ? `İade edilmiş ${plan.returned.length} sarf zimmetine dokunulmaz (stoğa dönmüş).` : '',
                plan.unknown.length ? `Demirbaş olup olmadığı kayıtta yazmayan ${plan.unknown.length} eski zimmete dokunulmaz (konsola listelendi).` : '',
            ].filter(Boolean).join(' ');
            if (plan.unknown.length) console.warn('[Sarf Dönüşümü] belirsiz kayıtlar (dokunulmadı):', plan.unknown);
            if (plan.convert.length === 0) {
                _dupAlert(`Dönüştürülecek sarf zimmeti yok.${extra ? ' ' + extra : ''}`, 'info');
                return;
            }
            const byPerson = new Map();
            plan.convert.forEach(r => byPerson.set(r.personel, (byPerson.get(r.personel) || 0) + (Number(r.adet) || 1)));
            const people = [...byPerson.entries()].sort((a, b) => b[1] - a[1]);
            const message = [
                `Ortam: ${window.COLLECTION_ROOT}. Zimmet kaydı: ${plan.total} · tüketim çıkışına çevrilecek sarf: ${plan.convert.length}.`,
                extra, '',
                'Kişi başına (adet):',
                ...people.slice(0, 10).map(([p, n]) => `• ${p}: ${n}`),
                people.length > 10 ? `… ve ${people.length - 10} kişi daha.` : '', '',
                'Bu kayıtlar Kişi Envanteri, zimmet tutanağı ve Zimmet ekranından çıkar; Envanter Takibi\'nde çıkış olarak kalır.',
                'Stok değişmez. Önce b3 yedeği (JSON) indirilecek. Devam edilsin mi?'
            ].join('\n');
            const ok = typeof showCustomConfirm === 'function'
                ? await showCustomConfirm('Sarf Zimmetlerini Tüketime Çevir', message)
                : confirm(`${plan.convert.length} sarf zimmeti tüketim çıkışına çevrilsin mi?`);
            if (ok !== true) return;

            const snapshot = { version: 1, root: window.COLLECTION_ROOT, collection: 'b3', timestamp: new Date().toISOString(), data: window.data.b3 || [] };
            const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 1)], { type: 'application/json' }));
            const a = document.createElement('a');
            a.href = url;
            a.download = `b3-yedek-sarf-donusumu-${window.COLLECTION_ROOT}-${snapshot.timestamp.replace(/[:.]/g, '-')}.json`;
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 5000);

            const shown = new Set(plan.convert.map(r => String(r.id)));
            const toWrite = window.AssignmentService.planSarfConsumption().convert.filter(r => shown.has(String(r.id)));
            let written = 0;
            for (let i = 0; i < toWrite.length; i += _MIGRATION_CHUNK) {
                const chunk = toWrite.slice(i, i + _MIGRATION_CHUNK);
                await window.applyItemOps(chunk.map(r => ({ op: 'update', col: 'b3', id: r.id, fields: { tip: 'cikis' } })));
                written += chunk.length;
            }
            const skipped = plan.convert.length - toWrite.length;
            const note = skipped ? ` (${skipped} kayıt bu arada değiştiği için atlandı.)` : '';
            _dupAlert(`🧾 ${written} sarf zimmeti tüketim çıkışına çevrildi.${note}`, 'success');
            _appendLog('success', [`🧾 SARF DÖNÜŞÜMÜ: ${written} b3 kaydı zimmet → çıkış · kök ${window.COLLECTION_ROOT} · yedek indirildi.${note}`]);
        } catch (error) {
            console.error('Sarf dönüşümü hatası:', error);
            _dupAlert('Sarf dönüşümü yarıda kaldı; yazılan parçalar çıkış, kalanlar zimmet olarak duruyor (tekrar çalıştırmak güvenli). Yedek dosyası indirildi. ' + error.message, 'error');
        } finally {
            _sarfMigrating = false;
            if (btn) btn.disabled = false;
        }
    };

    // ─── PRI / Hesap Göç Aracı (Faz 4B · J7 → J10 PRI revizyonu) ───
    // [WHY]: Giriş kurumsal kimlikle (PRI) yapılıyor; var olan personelin PRI'si yok, J7'de açılan hesaplar p<id>@ adresinde.
    // [HOW]: J9 aracının kuralları: önizleme planStaffAccounts (YAZMAZ) → kişi kişi atanacak PRI ve hesap işlemi (hesap aç /
    //        e-postayı uid korunarak taşı / eşlemeyi yenile / kod yok → "Hesap Aç" / tutarsız → dokunma) → onay →
    //        applyStaffAccounts (personel listesi sunucudan taze okunur; önizlemeden sonra değiştiyse hiç yazmadan durur).
    //        Sonuç gizlenmez: durum başına sayı, durma nedeni, kalan. Giriş kodları ve parolalar hiçbir mesaja, loga ya da
    //        konsola yazılmaz. DOM API (innerHTML yok). Test kancaları: #staffAccountWizard[data-state], data-role nitelikleri.
    const _PAW_ACTION = {
        ok: 'Bağlı — kimlik eşlemesi yenilenir',
        create: 'Giriş hesabı açılacak',
        move: 'J7 hesabı PRI adresine taşınacak (uid korunur)',
        'no-code': 'Hesap yok, kod yok — tablodan "Hesap Aç"',
        blocked: 'Dokunulmayacak',
    };
    const _PAW_STATUS = {
        created: 'açılan', relinked: 'yeniden bağlanan', moved: 'taşınan', 'move-resumed': 'taşıması tamamlanan (bağ onarıldı)',
        ok: 'eşlemesi yenilenen', 'pri-written': 'yalnız PRI yazılan',
        conflict: 'çakışan', invalid: 'geçersiz', error: 'hata', 'link-failed': 'bağlanamayan', disabled: 'devre dışı hesap', skipped: 'atlanan',
    };
    let _staffWizardOpen = false;
    window.vipMigrateStaffAuth = function (btn) {
        if (_staffWizardOpen) return null;
        if (!(typeof window.isDbAdmin === 'function' && window.isDbAdmin())) { _dupAlert('Bu işlem için yönetici (Firebase admin) oturumu gerekir.', 'error'); return null; }
        if (!window.StaffProvisioning || typeof window.planStaffAccounts !== 'function') { _dupAlert('Hesap modülü yüklenemedi; sayfayı yenileyin.', 'error'); return null; }
        let plan;
        try { plan = window.planStaffAccounts(); }
        catch (e) { _dupAlert('Önizleme hazırlanamadı: ' + ((e && e.message) || 'bilinmeyen hata'), 'error'); return null; }
        const el = (tag, css, text) => { const n = document.createElement(tag); if (css) n.style.cssText = css; if (text !== undefined) n.textContent = text; return n; };
        const cell = 'padding:6px 8px; border-bottom:1px solid var(--color-border);';
        const overlay = el('div', 'position:fixed; inset:0; background:rgba(15,23,42,0.7); z-index:10650; display:flex; align-items:center; justify-content:center;');
        overlay.id = 'staffAccountWizard';
        overlay.dataset.state = 'preview';
        const panel = el('div', 'background:var(--color-surface,#fff); color:var(--color-text); border-radius:16px; width:820px; max-width:95vw; max-height:88vh; overflow:auto; padding:22px; box-shadow:0 24px 64px rgba(0,0,0,0.45);');
        overlay.appendChild(panel);
        panel.append(el('h4', 'margin:0 0 6px; font-weight:800;', '🪪 PRI / Hesap Göç Aracı — Önizleme'),
            el('div', 'font-size:13px; color:var(--color-text-muted); margin-bottom:14px;',
                `Ortam: ${window.COLLECTION_ROOT}. Bu ekran hiçbir şey yazmadı. Her personele kurumsal kimlik (PRI) atanır; giriş hesabı ` +
                `<pri>@staff.medipol.local adresinde olur. J7'de açılmış hesapların (p<id>@) e-postası uid korunarak taşınır, böylece ` +
                'sahiplik kayıtları bağlı kalır. Hesaplar ikincil bir oturumda işlenir; yönetici oturumunuz etkilenmez.'));
        const c = plan.counts;
        const summary = el('table', 'width:100%; border-collapse:collapse; font-size:13px; margin-bottom:12px;');
        summary.dataset.role = 'summary';
        [['Kurumsal kimlik (PRI) yazılacak', c.priWrites, 'pri'], ['Giriş hesabı açılacak', c.create, 'create'], ['J7 hesabı PRI adresine taşınacak', c.move, 'move'],
            ['Bağlı (kimlik eşlemesi yenilenecek)', c.ok, 'ok'], ['Hesap yok, kod yok → tablodan "Hesap Aç"', c['no-code'], 'no-code'], ['Dokunulmayacak (tutarsız bağ)', c.blocked, 'blocked']]
            .forEach(([k, v, key]) => { const r = el('tr'); r.dataset.key = key; r.append(el('td', cell, k), el('td', cell + ' font-weight:800; text-align:right;', String(v))); summary.appendChild(r); });
        panel.appendChild(summary);
        const rows = el('table', 'width:100%; border-collapse:collapse; font-size:12px; margin-bottom:12px;');
        rows.dataset.role = 'rows';
        const head = el('tr'); ['Personel', 'Kurumsal kimlik', 'İşlem', 'Not'].forEach(h => head.appendChild(el('th', cell + ' text-align:left;', h)));
        rows.appendChild(head);
        plan.rows.slice(0, 300).forEach(r => {
            const tr = el('tr'); tr.dataset.id = r.id; tr.dataset.action = r.action;
            tr.append(el('td', cell, r.name), el('td', cell + ' font-family:monospace;', r.pri + (r.priChange ? ' (yeni)' : '')),
                el('td', cell, _PAW_ACTION[r.action] || r.action), el('td', cell + ' color:var(--color-text-muted);', r.reason || ''));
            rows.appendChild(tr);
        });
        panel.appendChild(rows);
        if (plan.rows.length > 300) panel.appendChild(el('div', 'font-size:12px; margin-bottom:12px;', `… ve ${plan.rows.length - 300} personel daha (tamamı uygulanır).`));

        const footer = el('div', 'display:flex; gap:10px; justify-content:flex-end; align-items:center; flex-wrap:wrap;');
        const work = c.create + c.move + c.ok + plan.rows.filter(r => r.action === 'no-code' && r.priChange).length;
        const status = el('div', 'flex:1; font-size:12px; color:var(--color-text-muted);', work ? `${work} personel işlenecek. Firebase hesap işlemlerini IP başına sınırlar; sınır dolarsa iş durur, yeniden çalıştırılabilir.` : 'Yapılacak bir şey yok.');
        status.dataset.role = 'status';
        const cancel = el('button', 'padding:9px 16px; background:none; border:1px solid var(--color-border); border-radius:8px; cursor:pointer; color:var(--color-text);', 'Kapat');
        cancel.type = 'button'; cancel.id = 'pawClose';
        const apply = el('button', 'padding:9px 18px; background:#0284c7; color:#fff; border:none; border-radius:8px; font-weight:700; cursor:pointer;', 'Uygula');
        apply.type = 'button'; apply.id = 'pawApply';
        apply.disabled = work === 0;
        apply.style.opacity = apply.disabled ? '0.5' : '1';
        footer.append(status, cancel, apply);
        panel.appendChild(footer);
        const close = () => { overlay.remove(); _staffWizardOpen = false; if (btn) btn.disabled = false; };
        cancel.addEventListener('click', close);

        async function run() {
            if (apply.disabled) return null;
            const ok = typeof showCustomConfirm === 'function'
                ? await showCustomConfirm('PRI / Hesap Göç Aracı', `${work} personel işlenecek (PRI atama, hesap açma / taşıma). Devam edilsin mi?`)
                : confirm('Uygulansın mı?');
            if (ok !== true) return null;
            overlay.dataset.state = 'running';
            apply.disabled = true; cancel.disabled = true;
            let res;
            try { res = await window.applyStaffAccounts(plan, { onProgress: (d, t) => { apply.textContent = `İşleniyor… ${d}/${t}`; } }); }
            catch (e) { res = { results: [], counts: {}, stopped: { code: (e && e.code) || 'error', message: (e && e.message) || 'bilinmeyen hata' }, remaining: work }; }
            const failed = res.results.filter(r => ['conflict', 'invalid', 'error', 'link-failed', 'disabled', 'skipped'].includes(r.status));
            const result = el('div', 'margin-top:12px; padding:10px 12px; border-radius:10px; font-size:13px; border:1px solid ' + (res.stopped || failed.length ? '#dc2626' : '#16a34a') + ';');
            result.dataset.role = 'result';
            result.dataset.status = res.aborted ? 'aborted' : res.stopped ? 'stopped' : 'done';
            result.appendChild(el('div', 'font-weight:800;', res.aborted ? '✗ Hiçbir şey yazılmadı' : res.stopped ? '✗ Yarıda durdu' : (failed.length ? '⚠ Tamamlandı, sorunlu kayıtlar var' : '✓ Tamamlandı')));
            const parts = Object.entries(res.counts).map(([k, v]) => `${_PAW_STATUS[k] || k}: ${v}`);
            if (res.remaining) parts.push(`denenmeyen: ${res.remaining}`);
            result.appendChild(el('div', '', parts.join(' · ') || '—'));
            if (res.stopped) result.appendChild(el('div', 'color:#dc2626;', `Neden: ${res.stopped.message}`));
            failed.slice(0, 20).forEach(r => {
                const row = plan.rows.find(x => x.id === r.id);
                result.appendChild(el('div', 'font-size:12px;', `• ${row ? row.name : r.id} (${row ? row.pri : '-'}): ${_PAW_STATUS[r.status] || r.status} — ${r.reason || ''}${r.kind ? ` [${r.kind}]` : ''}`));
            });
            panel.insertBefore(result, footer);
            const summaryText = parts.join(' · ');
            _dupAlert(`🪪 PRI / hesap göçü: ${summaryText || 'işlem yok'}${res.stopped ? ` · Durdu: ${res.stopped.message}` : ''}`, res.stopped || failed.length ? 'warning' : 'success');
            _appendLog(res.stopped || failed.length ? 'warn' : 'success', [`🪪 PRI / HESAP GÖÇÜ (J10): ${summaryText} · kök ${window.COLLECTION_ROOT}${res.stopped ? ' · durdu: ' + res.stopped.code : ''}`]);
            if (failed.length) console.warn('[PRI / Hesap Göçü] sorunlu:', failed.map(r => ({ id: r.id, durum: r.status, neden: r.reason })));
            apply.textContent = 'Tamamlandı';
            cancel.disabled = false;
            overlay.dataset.state = 'done';
            if (typeof window.renderPersonelTable === 'function') window.renderPersonelTable();
            return res;
        }
        apply.addEventListener('click', () => { run(); });
        _staffWizardOpen = true;
        if (btn) btn.disabled = true;
        document.body.appendChild(overlay);
        return { overlay, plan, run, close };
    };

    // [Faz 4B · J10]: "Kod Benzersizleştirme" (J7.5) ve "Giriş Modu" (J8) araçları kaldırıldı: giriş kurumsal kimlik (PRI) + kodla
    //   Firebase Auth'a yapılıyor (kodların tekil olması gerekmez), kurallar personel kaydına kod yazılmasını reddeder, mod sabit 'accounts'.

    // ─── Sahiplik Göç Aracı (Faz 4B · J9) ───
    // [WHY]: J9 öncesi kayıtlarda sahiplik uid'leri yok; J10 kuralları sahibi ancak bunlarla tanır. Yanlış eşleme kalıcıdır
    //        (sahiplik alanı yazıldıktan sonra değişmez), bu yüzden belirsiz her şey raporlanır, hiçbir şey tahmin edilmez.
    // [HOW]: Önizleme planOwnershipMigration (YAZMAZ) → koleksiyon özeti + sorun listesi (belirsiz ad, hesapsız personel,
    //        çakışan kaynak, tutarsız hesap bağı, dolu-farklı uid) → onay → applyOwnershipMigration (transaction'lı, parçalı).
    //        Sonuç gizlenmez: yazılan / atlanan (nedeniyle) / düşen / denenmeyen ayrı gösterilir. Giriş kodu hiçbir yerde
    //        gösterilmez. DOM API (innerHTML yok). Test kancaları: #ownershipWizard[data-state], data-role nitelikleri.
    const _OWN_STATUS = {
        ambiguous: 'Ad / kod birden fazla personelde — eşlenmedi',
        'not-found': 'Personel bulunamadı',
        'no-account': 'Personelin giriş hesabı yok (önce PRI / Hesap Göç Aracı)',
        'account-inconsistent': 'Personelin hesap bağı tutarsız ya da hesabı PRI adresinde değil (önce PRI / Hesap Göç Aracı)',
        conflict: 'Kayıttaki kaynaklar farklı kişileri gösteriyor',
        unmatched: 'Kayıtta kişi bilgisi yok',
        system: 'Sistem / rol / havuz — uid yazılmaz',
        mismatch: 'Dolu uid bugünkü hesaptan farklı — değiştirilmedi',
    };
    const _OWN_COL = { requests: 'Envanter talepleri', purchaseOrders: 'Satın alma talepleri', tasks: 'Görevler', workflowTemplates: 'İş akışı şablonları' };
    const _OWN_SKIP = { 'changed-since-preview': 'önizlemeden sonra değişti', deleted: 'silinmiş', already: 'bu arada doldurulmuş' };
    let _ownershipOpen = false;

    window.vipOwnershipMigration = function (btn) {
        if (_ownershipOpen) return null;
        if (!(typeof window.isDbAdmin === 'function' && window.isDbAdmin())) { _dupAlert('Bu işlem için yönetici (Firebase admin) oturumu gerekir.', 'error'); return null; }
        let plan;
        try { plan = window.planOwnershipMigration(); }
        catch (e) { _dupAlert('Önizleme hazırlanamadı: ' + ((e && e.message) || 'bilinmeyen hata'), 'error'); return null; }

        const el = (tag, css, text) => { const n = document.createElement(tag); if (css) n.style.cssText = css; if (text !== undefined) n.textContent = text; return n; };
        const overlay = el('div', 'position:fixed; inset:0; background:rgba(15,23,42,0.7); z-index:10650; display:flex; align-items:center; justify-content:center;');
        overlay.id = 'ownershipWizard';
        overlay.dataset.state = 'preview';
        const panel = el('div', 'background:var(--color-surface,#fff); color:var(--color-text); border-radius:16px; width:860px; max-width:95vw; max-height:88vh; overflow:auto; padding:22px; box-shadow:0 24px 64px rgba(0,0,0,0.45);');
        overlay.appendChild(panel);
        panel.append(el('h4', 'margin:0 0 6px; font-weight:800;', '🪪 Sahiplik Göç Aracı — Önizleme'),
            el('div', 'font-size:13px; color:var(--color-text-muted); margin-bottom:14px;',
                `Ortam: ${window.COLLECTION_ROOT}. Bu ekran hiçbir şey yazmadı. "Uygula" yalnız BOŞ sahiplik alanlarına, kaydın sahibi TEK bir personele ` +
                'kesin olarak eşleniyorsa ve o personelin giriş hesabı varsa uid ekler. Yazılan sahiplik alanı sonradan değiştirilemez; ' +
                'belirsiz kayıtlar aşağıda listelenir ve dokunulmaz.'));

        // Koleksiyon özeti
        const table = el('table', 'width:100%; border-collapse:collapse; font-size:13px; margin-bottom:14px;');
        table.dataset.role = 'summary';
        const tr = (cells, head) => { const r = el('tr'); cells.forEach(c => { const td = el(head ? 'th' : 'td', 'text-align:left; padding:6px 8px; border-bottom:1px solid var(--color-border);' + (head ? 'font-size:11px; text-transform:uppercase; color:var(--color-text-muted);' : ''), String(c)); r.appendChild(td); }); return r; };
        table.appendChild(tr(['Koleksiyon', 'Kayıt', 'Güncellenecek kayıt', 'Eklenecek uid', 'Zaten dolu alan', 'Sorun'], true));
        Object.entries(plan.summary).forEach(([col, s]) => {
            const r = tr([_OWN_COL[col] || col, s.total, s.toUpdate, s.assigns, s.alreadyFields, s.issues]);
            r.dataset.col = col;
            table.appendChild(r);
        });
        panel.appendChild(table);

        if (plan.duplicateUidGroups.length) {
            panel.appendChild(el('div', 'font-size:12px; color:#dc2626; margin-bottom:10px;',
                `⚠ ${plan.duplicateUidGroups.length} giriş hesabı birden fazla personele bağlı (${plan.duplicateUidGroups.map(g => g.join(' / ')).join('; ')}). Bu personellere uid yazılmaz.`));
        }

        // Sorunlar (gruplu sayı + ilk 60 satır)
        const byStatus = {};
        plan.issues.forEach(i => { byStatus[i.status] = (byStatus[i.status] || 0) + 1; });
        const issueBox = el('div', 'border:1px solid var(--color-border); border-radius:10px; padding:10px 12px; margin-bottom:14px;');
        issueBox.dataset.role = 'issues';
        issueBox.appendChild(el('div', 'font-weight:800; font-size:13px; margin-bottom:6px;', plan.issues.length ? `Eşlenmeyecek alanlar: ${plan.issues.length}` : 'Eşlenmeyecek alan yok.'));
        Object.entries(byStatus).forEach(([st, n]) => {
            const row = el('div', 'font-size:12px;', `• ${_OWN_STATUS[st] || st}: ${n}`);
            row.dataset.status = st;
            issueBox.appendChild(row);
        });
        if (plan.issues.length) {
            const list = el('div', 'max-height:220px; overflow:auto; margin-top:8px; font-size:12px; border-top:1px dashed var(--color-border); padding-top:6px;');
            plan.issues.slice(0, 60).forEach(i => {
                const cand = i.candidates && i.candidates.length ? ` — adaylar: ${i.candidates.join(', ')}` : '';
                list.appendChild(el('div', 'padding:2px 0;', `${_OWN_COL[i.col] || i.col} · ${i.label} · ${i.field}: ${_OWN_STATUS[i.status] || i.status}${i.detail ? ' (' + i.detail + ')' : ''}${cand}`));
            });
            if (plan.issues.length > 60) list.appendChild(el('div', 'padding:2px 0; color:var(--color-text-muted);', `… ve ${plan.issues.length - 60} satır daha (tamamı konsolda).`));
            issueBox.appendChild(list);
            console.table(plan.issues.map(i => ({ koleksiyon: i.col, kayit: i.label, alan: i.field, durum: i.status, ayrinti: i.detail || '' })));
        }
        panel.appendChild(issueBox);

        const footer = el('div', 'display:flex; gap:10px; justify-content:flex-end; align-items:center; flex-wrap:wrap;');
        const status = el('div', 'flex:1; font-size:12px; color:var(--color-text-muted);',
            plan.items.length ? `${plan.totals.records} kayda ${plan.totals.assigns} uid eklenecek.` : 'Eklenecek uid yok — tüm eşlenebilir kayıtlar zaten güncel.');
        status.dataset.role = 'status';
        const cancel = el('button', 'padding:9px 16px; background:none; border:1px solid var(--color-border); border-radius:8px; cursor:pointer; color:var(--color-text);', 'Kapat');
        cancel.type = 'button'; cancel.id = 'owwClose';
        const apply = el('button', 'padding:9px 18px; background:#db2777; color:#fff; border:none; border-radius:8px; font-weight:700; cursor:pointer;', 'Uygula');
        apply.type = 'button'; apply.id = 'owwApply';
        apply.disabled = plan.items.length === 0;
        apply.style.opacity = apply.disabled ? '0.5' : '1';
        footer.append(status, cancel, apply);
        panel.appendChild(footer);

        const close = () => { overlay.remove(); _ownershipOpen = false; if (btn) btn.disabled = false; };
        cancel.addEventListener('click', close);

        async function run() {
            if (!plan.items.length) return null;
            const question = `${plan.totals.records} kayda ${plan.totals.assigns} sahiplik uid'si eklenecek (yalnız boş alanlara). ` +
                `${plan.issues.length} alan belirsiz olduğu için eşlenmeyecek. Yazılan sahiplik alanı sonradan değiştirilemez. Devam edilsin mi?`;
            const ok = typeof showCustomConfirm === 'function' ? await showCustomConfirm('Sahiplik Göçü — Onay', question) : confirm(question);
            if (ok !== true) return null;
            overlay.dataset.state = 'running';
            apply.disabled = true; cancel.disabled = true;
            let res;
            try {
                res = await window.applyOwnershipMigration(plan, { onProgress: (d, t) => { apply.textContent = `Uygulanıyor… ${d}/${t}`; } });
            } catch (e) {
                res = { status: 'stopped', written: [], skipped: [], failed: [], notAttempted: plan.items.length, error: { code: (e && e.code) || 'error', message: (e && e.message) || 'bilinmeyen hata' } };
            }
            const skipText = Object.entries(res.skipped.reduce((m, s) => { m[s.reason] = (m[s.reason] || 0) + 1; return m; }, {}))
                .map(([r, n]) => `${n} ${_OWN_SKIP[r] || r}`).join(', ');
            const result = el('div', 'margin-top:12px; padding:10px 12px; border-radius:10px; font-size:13px; border:1px solid ' + (res.status === 'done' ? '#16a34a' : '#dc2626') + ';');
            result.dataset.role = 'result';
            result.dataset.status = res.status;
            result.append(
                el('div', 'font-weight:800;', res.status === 'done' ? '✓ Göç tamamlandı' : (res.status === 'aborted' ? '✗ Göç başlatılmadı' : '✗ Göç yarıda durdu')),
                el('div', '', `Yazılan kayıt: ${res.written.length} · Atlanan: ${res.skipped.length}${skipText ? ' (' + skipText + ')' : ''} · Düşen: ${res.failed.length} · Denenmeyen: ${res.notAttempted}`));
            if (res.error) result.appendChild(el('div', 'color:#dc2626;', `Neden: ${res.error.message} [${res.error.code}]. Yazılanlar kalıcıdır; aracı yeniden açıp çalıştırmak kalanları tamamlar.`));
            panel.insertBefore(result, footer);
            const level = res.status === 'done' && !res.failed.length ? 'success' : 'warning';
            _dupAlert(`🪪 Sahiplik göçü: ${res.written.length} kayıt yazıldı, ${res.skipped.length} atlandı, ${res.failed.length} düştü, ${res.notAttempted} denenmedi.`, level);
            _appendLog(level === 'success' ? 'success' : 'warn', [`🪪 SAHİPLİK GÖÇÜ (J9): ${res.status} · yazılan ${res.written.length} · atlanan ${res.skipped.length} · düşen ${res.failed.length} · denenmeyen ${res.notAttempted} · kök ${window.COLLECTION_ROOT}`]);
            apply.textContent = 'Uygulandı';
            cancel.disabled = false;
            overlay.dataset.state = 'done';
            return res;
        }
        apply.addEventListener('click', () => { run(); });

        _ownershipOpen = true;
        if (btn) btn.disabled = true;
        document.body.appendChild(overlay);
        return { overlay, plan, run, close };
    };

    // ─── Kod Temizliği (Faz 4B · J10) ───
    // [WHY]: Giriş yalnız Firebase Auth ile; düz metin giriş kodları (personel.code ve eski kayıtlara kopyalanmış hâlleri) veritabanında
    //        durmamalı. Silme geri alınamaz ve kodu bilmeyen personel kilitlenir; bu yüzden önkoşullar sağlanmadan çalışmaz.
    // [HOW]: planCodeCleanse (yazmaz) → önizleme: silinecekler, engeller (hesabı olmayan personel, sahiplik göçünde yazılmamış kayıt),
    //        uyarılar → güçlü onay → applyCodeCleanse (400'lük batch; düşen batch ve sonrası raporlanır). DOM API (innerHTML yok).
    let _cleanseOpen = false;
    window.vipCodeCleanse = function (btn) {
        if (_cleanseOpen) return null;
        if (!(typeof window.isDbAdmin === 'function' && window.isDbAdmin())) { _dupAlert('Bu işlem için yönetici (Firebase admin) oturumu gerekir.', 'error'); return null; }
        let plan;
        try { plan = window.planCodeCleanse(); }
        catch (e) { _dupAlert('Önizleme hazırlanamadı: ' + ((e && e.message) || 'bilinmeyen hata'), 'error'); return null; }
        const el = (tag, css, text) => { const n = document.createElement(tag); if (css) n.style.cssText = css; if (text !== undefined) n.textContent = text; return n; };
        const overlay = el('div', 'position:fixed; inset:0; background:rgba(15,23,42,0.7); z-index:10650; display:flex; align-items:center; justify-content:center;');
        overlay.id = 'codeCleanseWizard';
        overlay.dataset.state = plan.ready ? 'preview' : 'blocked';
        const panel = el('div', 'background:var(--color-surface,#fff); color:var(--color-text); border-radius:16px; width:720px; max-width:95vw; max-height:88vh; overflow:auto; padding:22px; box-shadow:0 24px 64px rgba(0,0,0,0.45);');
        overlay.appendChild(panel);
        panel.append(el('h4', 'margin:0 0 6px; font-weight:800;', '🧹 Kod Temizliği — Önizleme'),
            el('div', 'font-size:13px; color:var(--color-text-muted); margin-bottom:14px;',
                `Ortam: ${window.COLLECTION_ROOT}. Bu ekran hiçbir şey yazmadı. Giriş yalnız Firebase Auth ile yapılıyor; aşağıdaki düz metin kodlar silinecek. ` +
                'Silme GERİ ALINAMAZ: kodunu unutan personelin parolası istemciden sıfırlanamaz (yönetici betiği gerekir).'));
        const rows = [['Personel kaydındaki giriş kodu', plan.personel.length], ['Taleplerdeki eski kod kopyası (personelKodu)', plan.requests.length],
            ['Satın almalarda kod taşıyan "oluşturan" alanı (personel id\'sine çevrilir)', plan.purchaseOrders.length]];
        const table = el('table', 'width:100%; border-collapse:collapse; font-size:13px; margin-bottom:12px;');
        table.dataset.role = 'summary';
        rows.forEach(([k, v]) => { const r = el('tr'); r.append(el('td', 'padding:6px 8px; border-bottom:1px solid var(--color-border);', k), el('td', 'padding:6px 8px; border-bottom:1px solid var(--color-border); font-weight:800; text-align:right;', String(v))); table.appendChild(r); });
        panel.appendChild(table);
        const box = el('div', 'border:1px solid ' + (plan.ready ? 'var(--color-border)' : '#dc2626') + '; border-radius:10px; padding:10px 12px; margin-bottom:14px; font-size:12px;');
        box.dataset.role = 'blockers';
        if (plan.ready) box.appendChild(el('div', 'color:#16a34a; font-weight:700;', '✓ Önkoşullar sağlandı: tüm personelin geçerli giriş hesabı var, sahiplik göçünde yazılmamış kayıt yok ve çözülemeyen eski kod referansı yok.'));
        if (plan.blockers.noAccount.length) box.appendChild(el('div', 'color:#dc2626;', `✗ Giriş hesabı olmayan / tutarsız personel (${plan.blockers.noAccount.length}): ${plan.blockers.noAccount.slice(0, 20).join(', ')}${plan.blockers.noAccount.length > 20 ? '…' : ''}. Önce "PRI / Hesap Göç Aracı" ya da personel tablosunda "Hesap Aç".`));
        if (plan.blockers.ownershipPending) box.appendChild(el('div', 'color:#dc2626;', `✗ Sahiplik göçünde yazılmamış ${plan.blockers.ownershipPending} kayıt var. Önce "Sahiplik Göç Aracı".`));
        // J11 · P1: sahiplik alanının KENDİSİ çözülemeyen kayıtlar (onay adımı gibi uyarılardan ayrı) artık ENGEL.
        if (plan.blockers.ownershipUnresolved.length) {
            box.appendChild(el('div', 'color:#dc2626; font-weight:700; margin-top:4px;', `✗ Sahipliği çözülemeyen ${plan.blockers.ownershipUnresolved.length} kayıt var (belirsiz / bulunamayan / farklı uid). Kodlar silinmeden önce bu kayıtlar elle düzeltilmeli ya da "Sahiplik Göç Aracı" ile yeniden denenmeli:`));
            plan.blockers.ownershipUnresolved.slice(0, 10).forEach(t => box.appendChild(el('div', 'color:#dc2626; font-size:11px;', '• ' + t)));
            if (plan.blockers.ownershipUnresolved.length > 10) box.appendChild(el('div', 'color:#dc2626; font-size:11px;', `… ve ${plan.blockers.ownershipUnresolved.length - 10} kayıt daha`));
        }
        // J11 · P1: eskiden burada otomatik 'unknown' yazılırdı (bilgi kaybı); artık yönetici müdahalesi gereken açık bir engel.
        if (plan.blockers.purchaseOrderUnresolved.length) {
            box.appendChild(el('div', 'color:#dc2626; font-weight:700; margin-top:4px;', `✗ ${plan.blockers.purchaseOrderUnresolved.length} satın alma kaydının eski "oluşturan" kodu tekil bir personele indirgenemiyor (otomatik 'unknown' YAZILMAZ). Kaydı elle düzeltin:`));
            plan.blockers.purchaseOrderUnresolved.slice(0, 10).forEach(x => box.appendChild(el('div', 'color:#dc2626; font-size:11px;', `• ${x.label} — ${x.reason}`)));
            if (plan.blockers.purchaseOrderUnresolved.length > 10) box.appendChild(el('div', 'color:#dc2626; font-size:11px;', `… ve ${plan.blockers.purchaseOrderUnresolved.length - 10} kayıt daha`));
        }
        if (plan.warnings.ownershipAdvisory.length) box.appendChild(el('div', 'color:#b45309; margin-top:4px;', `⚠ Onay adımı / atanan alanında eşlenemeyen ${plan.warnings.ownershipAdvisory.length} alan var (belirsiz ad, sistem/rol vb.) — engel değil, yalnız yönetici onaylar.`));
        panel.appendChild(box);

        const footer = el('div', 'display:flex; gap:10px; justify-content:flex-end; align-items:center; flex-wrap:wrap;');
        const status = el('div', 'flex:1; font-size:12px; color:var(--color-text-muted);', plan.total ? `${plan.total} alan silinecek / değiştirilecek.` : 'Temizlenecek kod yok.');
        status.dataset.role = 'status';
        const cancel = el('button', 'padding:9px 16px; background:none; border:1px solid var(--color-border); border-radius:8px; cursor:pointer; color:var(--color-text);', 'Kapat');
        cancel.type = 'button'; cancel.id = 'ccwClose';
        const apply = el('button', 'padding:9px 18px; background:#dc2626; color:#fff; border:none; border-radius:8px; font-weight:700; cursor:pointer;', 'Kodları Sil');
        apply.type = 'button'; apply.id = 'ccwApply';
        apply.disabled = !plan.ready || plan.total === 0;
        apply.style.opacity = apply.disabled ? '0.5' : '1';
        footer.append(status, cancel, apply);
        panel.appendChild(footer);
        const close = () => { overlay.remove(); _cleanseOpen = false; if (btn) btn.disabled = false; };
        cancel.addEventListener('click', close);

        async function run() {
            if (apply.disabled) return null;
            const ok = typeof showCustomConfirm === 'function'
                ? await showCustomConfirm('Kod Temizliği — Geri Alınamaz', `${plan.total} düz metin kod alanı silinecek. Kodunu unutan personelin parolası bu ekrandan sıfırlanamaz. Devam edilsin mi?`, { confirmText: 'Kodları Sil', danger: true })
                : confirm('Kodlar silinsin mi?');
            if (ok !== true) return null;
            overlay.dataset.state = 'running';
            apply.disabled = true; cancel.disabled = true; apply.textContent = 'Siliniyor…';
            let res;
            // J11 · P1: AtomicWriter hepsi-ya-da-hiçbiri yazar (tek atomik batch ya da günlüklü işlem); kademeli ilerleme yok —
            // sonuç ya tam yazılmıştır ya da (hata/değişen veri durumunda) HİÇBİR ŞEY yazılmamıştır.
            try { res = await window.applyCodeCleanse(plan); }
            catch (e) { res = { written: 0, failed: 0, notAttempted: plan.total, phase: e && e.details && e.details.phase, error: { code: (e && e.code) || 'error', message: (e && e.message) || 'bilinmeyen hata' } }; }
            // J11 · P1 #4: başlık GERÇEK sonuca göre — kısmi tamamlanma ya da belirsiz sonuç "hiçbir şey yazılmadı" diye gösterilmez.
            const NOTHING = ['changed-since-preview', 'not-ready', 'forbidden', 'bulk-locked', 'rolled-back', 'no-auth', 'pending-journal', 'prepare-failed'];
            const title = !res.error ? '✓ Kod temizliği tamamlandı'
                : res.phase === 'codes' ? '⚠ Kısmen tamamlandı — personel kodu silme yarıda kaldı'
                : res.error.code === 'rollback-pending' ? '⚠ Yarıda kaldı — veritabanı kilitli, geri alma yönetici oturumunda otomatik tamamlanacak'
                : NOTHING.includes(res.error.code) ? '✗ Hiçbir şey yazılmadı' : '⚠ Sonuç kesin değil — aşağıdaki sunucu durumuna bakın';
            const result = el('div', 'margin-top:12px; padding:10px 12px; border-radius:10px; font-size:13px; border:1px solid ' + (res.error ? '#dc2626' : '#16a34a') + ';');
            result.dataset.role = 'result';
            result.dataset.status = res.error ? 'stopped' : 'done';
            result.append(el('div', 'font-weight:800;', title),
                el('div', '', `Yazılan: ${res.written} · Düşen: ${res.failed} · Denenmeyen: ${res.notAttempted}`));
            if (res.error) result.appendChild(el('div', 'color:#dc2626;', `Neden: ${res.error.message} [${res.error.code}]. Aracı yeniden açıp çalıştırmak güvenlidir (önizleme sunucudaki gerçek durumu gösterir).`));
            panel.insertBefore(result, footer);
            _dupAlert(`🧹 Kod temizliği: ${res.written} alan güncellendi${res.error ? ', hiçbir şey yazılmadı' : ''}.`, res.error ? 'warning' : 'success');
            _appendLog(res.error ? 'warn' : 'success', [`🧹 KOD TEMİZLİĞİ (J11): yazılan ${res.written}${res.error ? ' · durdu: ' + res.error.code : ''} · kök ${window.COLLECTION_ROOT}`]);
            apply.textContent = 'Tamamlandı';
            cancel.disabled = false;
            overlay.dataset.state = 'done';
            return res;
        }
        apply.addEventListener('click', () => { run(); });
        _cleanseOpen = true;
        if (btn) btn.disabled = true;
        document.body.appendChild(overlay);
        return { overlay, plan, run, close };
    };

    // ─── Personel Erişim Kilidi (Faz 4B · J11 · P0) ───
    // [WHY]: Kurallar personel erişimini kök başına bir kilide bağlar; kilit yoksa / kapalıysa hiçbir personel hiçbir şey okuyamaz
    //        (göç sırasında düz metin kodlar sızmasın). Kilidi açmanın tek istemci yolu bu araç.
    // [HOW]: Açılışta verifyStaffAccessClosure (SUNUCUDAN taze okur, yazmaz) → sekiz denetim + ilk sorunlu kayıtlar. "Erişimi Aç"
    //        yalnız hepsi 0 iken etkin; openStaffAccess denetimi yeniden çalıştırır, kural kanıtın şeklini doğrular. "Erişimi
    //        Kapat" her zaman. DOM API (innerHTML yok). Test kancaları: #staffGateWizard[data-state|data-gate], data-role.
    const _GATE_LABEL = { open: '🔓 AÇIK', closed: '🔒 KAPALI', missing: '🔒 KAPALI (kilit kaydı yok — varsayılan)', invalid: '🔒 KAPALI (geçersiz kilit kaydı)', denied: '? okunamadı', unknown: '? okunamadı' };
    const _GATE_CHECK = {
        personelCodes: ['Personel kaydında düz metin giriş kodu', 'Kod Temizliği'],
        requestCodes: ['Taleplerde eski kod kopyası (personelKodu)', 'Kod Temizliği'],
        purchaseOrderCodes: ['Satın almalarda kodlu ya da çözülemeyen "oluşturan" alanı', 'Kod Temizliği'],
        accountsMissing: ['Giriş hesabı olmayan personel', 'PRI / Hesap Göç Aracı ya da tabloda "Hesap Aç"'],
        accountsInconsistent: ['Hesabı tutarsız / PRI adresinde olmayan personel (J7 dahil)', 'PRI / Hesap Göç Aracı'],
        accountMapMismatch: ['Kimlik eşlemesi (staffAccounts) eksik / tutarsız', 'PRI / Hesap Göç Aracı (eşlemeyi yeniler)'],
        ownershipPending: ['Sahiplik göçünün yazacağı kayıt', 'Sahiplik Göç Aracı'],
        ownershipUnresolved: ['Sahipliği çözülemeyen kayıt (belirsiz / bulunamayan / farklı uid)', 'Kaydı elle düzeltin ya da silin'],
    };
    window.renderStaffGateStatus = function (gate) {
        const btn = document.getElementById('vipStaffGateBtn');
        if (!btn || !gate) return;
        btn.dataset.gate = gate.state;
        const label = btn.querySelector('[data-role="gate-state"]');
        if (label) label.textContent = gate.state === 'open' ? ' · AÇIK' : (gate.state === 'unknown' ? '' : ' · KAPALI');
    };
    let _gateOpen = false;
    window.vipStaffAccessGate = async function (btn) {
        if (_gateOpen) return null;
        if (!(typeof window.isDbAdmin === 'function' && window.isDbAdmin())) { _dupAlert('Bu işlem için yönetici (Firebase admin) oturumu gerekir.', 'error'); return null; }
        if (typeof window.verifyStaffAccessClosure !== 'function') { _dupAlert('Erişim kilidi modülü yüklenemedi; sayfayı yenileyin.', 'error'); return null; }
        _gateOpen = true;
        if (btn) btn.disabled = true;
        let gate, v;
        try { [gate, v] = await Promise.all([window.readStaffAccessGate(), window.verifyStaffAccessClosure()]); }
        catch (e) { _gateOpen = false; if (btn) btn.disabled = false; _dupAlert('Kapanış denetimi yapılamadı: ' + ((e && e.message) || 'bilinmeyen hata'), 'error'); return null; }
        const el = (tag, css, text) => { const n = document.createElement(tag); if (css) n.style.cssText = css; if (text !== undefined) n.textContent = text; return n; };
        const cell = 'padding:6px 8px; border-bottom:1px solid var(--color-border);';
        const overlay = el('div', 'position:fixed; inset:0; background:rgba(15,23,42,0.7); z-index:10650; display:flex; align-items:center; justify-content:center;');
        overlay.id = 'staffGateWizard';
        overlay.dataset.state = v.ready ? 'ready' : 'blocked';
        overlay.dataset.gate = gate.state;
        const panel = el('div', 'background:var(--color-surface,#fff); color:var(--color-text); border-radius:16px; width:780px; max-width:95vw; max-height:88vh; overflow:auto; padding:22px; box-shadow:0 24px 64px rgba(0,0,0,0.45);');
        overlay.appendChild(panel);
        const stateLine = el('div', 'font-size:14px; font-weight:800; margin-bottom:6px;', `Personel erişimi: ${_GATE_LABEL[gate.state] || gate.state}`);
        stateLine.dataset.role = 'gate-state';
        panel.append(el('h4', 'margin:0 0 6px; font-weight:800;', '🛡️ Personel Erişim Kilidi'), stateLine,
            el('div', 'font-size:13px; color:var(--color-text-muted); margin-bottom:14px;',
                `Ortam: ${v.root}. Kilit kapalıyken hiçbir personel veri okuyamaz ve yazamaz; yönetici etkilenmez. Kilit yalnız göçün üç adımı ` +
                '(PRI / Hesap Göçü, Sahiplik Göçü, Kod Temizliği) sunucudan doğrulandığında açılabilir. Bu denetim veritabanını yeniden okudu, hiçbir şey yazmadı. ' +
                'Önemli: açıldıktan sonra personelin okuduğu veri geri alınamaz.'));
        const table = el('table', 'width:100%; border-collapse:collapse; font-size:13px; margin-bottom:12px;');
        table.dataset.role = 'checks';
        const head = el('tr'); ['Denetim', 'Sayı', 'Çözüm'].forEach(h => head.appendChild(el('th', cell + ' text-align:left;', h)));
        table.appendChild(head);
        Object.keys(_GATE_CHECK).forEach(k => {
            const n = v.checks[k];
            const tr = el('tr'); tr.dataset.key = k;
            tr.append(el('td', cell, _GATE_CHECK[k][0]), el('td', cell + ` font-weight:800; text-align:right; color:${n ? '#dc2626' : '#16a34a'};`, String(n)),
                el('td', cell + ' color:var(--color-text-muted);', n ? _GATE_CHECK[k][1] : '✓'));
            table.appendChild(tr);
        });
        panel.appendChild(table);
        const issues = Object.keys(_GATE_CHECK).filter(k => v.details[k].length);
        if (issues.length) {
            const box = el('div', 'border:1px solid #dc2626; border-radius:10px; padding:10px 12px; margin-bottom:12px; font-size:12px;');
            box.dataset.role = 'details';
            issues.forEach(k => {
                box.appendChild(el('div', 'font-weight:700; margin-top:4px;', _GATE_CHECK[k][0]));
                v.details[k].slice(0, 10).forEach(t => box.appendChild(el('div', '', '• ' + t)));
                if (v.checks[k] > 10) box.appendChild(el('div', 'color:var(--color-text-muted);', `… ve ${v.checks[k] - 10} kayıt daha`));
            });
            panel.appendChild(box);
        }
        if (v.warningCount) panel.appendChild(el('div', 'font-size:12px; color:#b45309; margin-bottom:12px;', `⚠ ${v.warningCount} onay adımı / atanan alanı eşlenemedi (engel değil: o adımları yalnız yönetici onaylar).`));
        const footer = el('div', 'display:flex; gap:10px; justify-content:flex-end; align-items:center; flex-wrap:wrap;');
        const status = el('div', 'flex:1; font-size:12px; color:var(--color-text-muted);', v.ready ? '✓ Kapanış doğrulandı: sekiz denetimin hepsi 0.' : '✗ Kapanış doğrulanmadı: erişim açılamaz.');
        status.dataset.role = 'status';
        const close = el('button', 'padding:9px 16px; background:none; border:1px solid var(--color-border); border-radius:8px; cursor:pointer; color:var(--color-text);', 'Kapat');
        close.type = 'button'; close.id = 'sgwClose';
        const lock = el('button', 'padding:9px 16px; background:#b45309; color:#fff; border:none; border-radius:8px; font-weight:700; cursor:pointer;', 'Erişimi Kapat');
        lock.type = 'button'; lock.id = 'sgwLock';
        const unlock = el('button', 'padding:9px 18px; background:#16a34a; color:#fff; border:none; border-radius:8px; font-weight:700; cursor:pointer;', 'Erişimi Aç');
        unlock.type = 'button'; unlock.id = 'sgwUnlock';
        unlock.disabled = !v.ready || gate.state === 'open';
        unlock.style.opacity = unlock.disabled ? '0.5' : '1';
        footer.append(status, close, lock, unlock);
        panel.appendChild(footer);
        const dispose = () => { overlay.remove(); _gateOpen = false; if (btn) btn.disabled = false; };
        close.addEventListener('click', dispose);
        const report = (ok, text) => {
            const r = el('div', 'margin-top:12px; padding:10px 12px; border-radius:10px; font-size:13px; border:1px solid ' + (ok ? '#16a34a' : '#dc2626') + ';', text);
            r.dataset.role = 'result'; r.dataset.status = ok ? 'done' : 'refused';
            panel.insertBefore(r, footer);
        };

        async function open() {
            if (unlock.disabled) return null;
            const ok = typeof showCustomConfirm === 'function'
                ? await showCustomConfirm('Personel Erişimini Aç', 'Kapanış sunucuda yeniden doğrulanacak; geçerse tüm personel veriye erişebilecek. Devam edilsin mi?', { confirmText: 'Erişimi Aç' })
                : confirm('Personel erişimi açılsın mı?');
            if (ok !== true) return null;
            overlay.dataset.state = 'running'; unlock.disabled = true; lock.disabled = true;
            let res;
            try { res = await window.openStaffAccess(); }
            catch (e) { res = { ok: false, error: e }; }
            if (res.ok) {
                overlay.dataset.gate = 'open'; stateLine.textContent = `Personel erişimi: ${_GATE_LABEL.open}`;
                report(true, '✓ Kapanış yeniden doğrulandı; personel erişimi açıldı.');
                _appendLog('success', [`🔓 PERSONEL ERİŞİM KİLİDİ AÇILDI (J11) · kök ${window.COLLECTION_ROOT}`]);
            } else {
                const why = res.error ? ((res.error && res.error.message) || 'bilinmeyen hata')
                    : 'yeniden denetimde kapanmamış kayıt bulundu: ' + Object.entries(res.verification.checks).filter(([, n]) => n).map(([k, n]) => `${_GATE_CHECK[k][0]} (${n})`).join(', ');
                report(false, '✗ Erişim açılmadı — ' + why);
            }
            overlay.dataset.state = 'done'; lock.disabled = false;
            return res;
        }
        async function shut() {
            const ok = typeof showCustomConfirm === 'function'
                ? await showCustomConfirm('Personel Erişimini Kapat', 'Tüm personel oturumları sonlanacak ve kilit açılana kadar giriş yapılamayacak. Devam edilsin mi?', { confirmText: 'Erişimi Kapat', danger: true })
                : confirm('Personel erişimi kapatılsın mı?');
            if (ok !== true) return null;
            overlay.dataset.state = 'running'; lock.disabled = true;
            let res;
            try { res = await window.closeStaffAccess(); }
            catch (e) { res = { ok: false, error: e }; }
            if (res.ok) {
                overlay.dataset.gate = 'closed'; stateLine.textContent = `Personel erişimi: ${_GATE_LABEL.closed}`;
                report(true, '✓ Personel erişimi kapatıldı.');
                _appendLog('warn', [`🔒 PERSONEL ERİŞİM KİLİDİ KAPATILDI (J11) · kök ${window.COLLECTION_ROOT}`]);
                unlock.disabled = !v.ready; unlock.style.opacity = unlock.disabled ? '0.5' : '1';
            } else report(false, '✗ Kapatılamadı — ' + ((res.error && res.error.message) || 'bilinmeyen hata'));
            overlay.dataset.state = 'done'; lock.disabled = false;
            return res;
        }
        unlock.addEventListener('click', () => { open(); });
        lock.addEventListener('click', () => { shut(); });
        document.body.appendChild(overlay);
        return { overlay, gate, verification: v, open, shut, close: dispose };
    };

    // Global Kill Switch
    // [WHY]: Kill Switch (Sistemi Kapatma) komutu localStorage'da tutuluyordu, DevTools ile bypass edilebiliyordu.
    // [HOW]: Artık Firestore üzerindeki 'system_config/admin_settings' dökümanına asenkron yazıyor. Sadece Firebase Auth ile doğrulanmış adminler bu veriyi değiştirebilir.
    // [WHY]: Buton durumu yalnız tıklanınca güncelleniyordu; sayfa yenilenince bakım açıkken bile "GLOBAL KILL SWITCH"
    //        görünüyor, bir sonraki tıklama körlemesine ters yöne çeviriyordu (VIP-07). Uyarı metni kuralların kullanıcıları
    //        engellediğini söylüyordu; oysa bakım modu yalnız istemci tarafında (RULE-05, Faz 4.2).
    // [HOW]: Buton tek fonksiyondan çizilir ve admin_settings snapshot'ından (firebase-handler) beslenir; geçiş öncesi onay
    //        istenir ve yeni durum sunucudan okunan son değerin tersi olarak yazılır.
    window.renderKillSwitchButton = function (isMaintenance) {
        const btn = document.getElementById('vipKillSwitchBtn');
        if (!btn) return;
        btn.dataset.maintenance = isMaintenance ? 'true' : 'false';
        if (isMaintenance) {
            btn.innerHTML = '<i class="fas fa-play me-2"></i>SİSTEMİ GERİ AÇ (bakım modu açık)';
            btn.style.background = 'rgba(0, 255, 136, 0.1)';
            btn.style.color = 'var(--vip-matrix)';
            btn.style.borderColor = 'var(--vip-matrix)';
        } else {
            btn.innerHTML = '<i class="fas fa-power-off me-2"></i>GLOBAL KILL SWITCH';
            btn.style.background = 'rgba(255,45,85,0.1)';
            btn.style.color = 'var(--vip-danger)';
            btn.style.borderColor = 'var(--vip-danger)';
        }
    };

    window.vipToggleKillSwitch = async function() {
        if (!(typeof window.isDbAdmin === 'function' && window.isDbAdmin())) {
            alert("Bu işlem için yönetici (Firebase admin) oturumu gerekir.");
            return;
        }

        try {
            const { getDoc, setDoc } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
            const settingsRef = window.systemConfigRef("admin_settings");

            const snap = await getDoc(settingsRef);
            const current = snap.exists() && snap.data().maintenance === true;
            const next = !current;

            const question = next
                ? 'Bakım modu AÇILACAK: yönetici dışındaki açık oturumlar bakım ekranına alınır. Not: bu istemci tarafı bir kilittir; Firestore erişimini engellemez. Devam edilsin mi?'
                : 'Bakım modu KAPATILACAK ve sistem kullanıcılara yeniden açılacak. Devam edilsin mi?';
            const ok = typeof showCustomConfirm === 'function' ? await showCustomConfirm('Global Kill Switch', question) : confirm(question);
            if (ok !== true) { window.renderKillSwitchButton(current); return; }

            await setDoc(settingsRef, { maintenance: next }, { merge: true });
            window.renderKillSwitchButton(next);

            if (next) {
                _appendLog('error', ['🚨 GLOBAL KILL SWITCH AKTİF: Sistem bakım moduna alındı.']);
                alert("Bakım modu açıldı. Yönetici dışındaki açık oturumlar bakım ekranına alınacak (istemci tarafı).");
            } else {
                _appendLog('success', ['✅ GLOBAL KILL SWITCH KAPALI: Sistem normale döndü.']);
                alert("Sistem normale döndü!");
            }
        } catch (error) {
            _appendLog('error', ['❌ Kill Switch başarısız: ' + error.message]);
            alert("İşlem reddedildi: " + error.message);
        }
    };

    // Faz 5 · K3 (5.7 · ARC-07): showAdminTab'ı sarmalayan eski monkey-patch + 200ms'lik retry döngüsü kaldırıldı.
    // script.js'te her zaman hazır olan merkezi kanca siciline (AppModules.AdminTabs) kaydolunuyor — her sekme
    // değişiminde (tabId ne olursa olsun) çalışır, VIP sekmesine giriş/çıkışı kendi içinde ayırt eder.
    window.AppModules.AdminTabs.onAny(function (tabId) {
        // ── VIP Portal Modu ──
        const sidebar = document.querySelector('.sidebar');
        const mainContent = document.querySelector('.main-content');
        const isVip = (tabId === 'systemControlTab');

        if (isVip) {
            // VIP dünyasına geçiş
            if (sidebar) sidebar.classList.add('vip-active');
            if (mainContent) mainContent.classList.add('vip-bg');
            document.body.classList.add('vip-portal-active');

            // [WHY]: Yerel _initVipPanel çağrılıyordu; window._initVipPanel sarmalayıcı zinciri (buton durumları, radar
            //        tıklamaları) hiç çalışmıyordu, aktivite paneli / mesaj / oturum sonlandırma ulaşılamazdı (VIP-04).
            requestAnimationFrame(() => {
                setTimeout(() => window._initVipPanel(), 50);
            });
        } else {
            // Normal dünyaya dönüş
            if (sidebar) sidebar.classList.remove('vip-active');
            if (mainContent) mainContent.classList.remove('vip-bg');
            document.body.classList.remove('vip-portal-active');
            _stopHealthLoop();   // VIP-08: VIP sekmesi kapanınca sağlık döngüsü durur
        }
    });
    // [WHY]: God-Eye v2 fonksiyonlari IIFE disinda tanimli.
    // [HOW]: _appendLog ve _initVipPanel global scope icin expose ediliyor.
    window._appendLog    = _appendLog;
    window._initVipPanel = _initVipPanel;

})();



// [WHY]: Kaldırılmış Launchpad hâlâ system_config'e yazıyor (toggleLaunchpadGlobal), devre dışı VIP butonunu
//        "Launchpad: Açık" diye canlandırıyordu; bayrak her istemcinin localStorage'ına kopyalanıyordu (VIP-10).
// [HOW]: Karar K9-a: yazıcı, VIP butonu ve firebase-handler dinleyicisi kaldırıldı; burada yalnız İpuçları butonu kaldı.
window.updateActionButtonsState = function() {
    const tipsBtn = document.getElementById('vipToggleTipsBtn');

    if (tipsBtn) {
        const isTipsDisabled = localStorage.getItem('systemTipsDisabled') === 'true';
        if (isTipsDisabled) {
            tipsBtn.style.background = 'rgba(255,45,85,0.1)';
            tipsBtn.style.color = 'var(--vip-danger)';
            tipsBtn.style.border = '1px solid var(--vip-danger)';
            tipsBtn.innerHTML = '<i class="fas fa-comment-slash me-2"></i>Ipuclari: Kapali';
        } else {
            tipsBtn.style.background = 'rgba(14,165,233,0.1)';
            tipsBtn.style.color = 'var(--color-info)';
            tipsBtn.style.border = '1px solid var(--color-info)';
            tipsBtn.innerHTML = '<i class="fas fa-comment-dots me-2"></i>Ipuclari: Acik';
        }
    }
};

const oldInitVipPanel = window._initVipPanel;
window._initVipPanel = function() {
    if(oldInitVipPanel) oldInitVipPanel();
    window.updateActionButtonsState();
};

// Config onSnapshot (firebase-handler.js) tetiklendiginde VIP panel aciksa widget'i guncelle
window.addEventListener('onInventoryDataUpdated', () => {
    const adminTab = document.getElementById('admin-tab');
    if (adminTab && adminTab.style.display !== 'none') {
        window.updateActionButtonsState();
    }
});




// ═══════════════════════════════════════════════════════════════════
//  GOD-EYE v2 — KULLANICI MÜDAHALESİ, FORCE LOGOUT & HEATMAP
// ═══════════════════════════════════════════════════════════════════

// ─── GLOBAL STATE ─────────────────────────────────────────────────
let _godEyeHeatmapActive = false;
let _currentTargetUser   = null; // Panelde açık olan kullanıcı verisi

// ─── MODÜL LİSTESİ (Heatmap için) ──────────────────────────────────
const _GOD_EYE_MODULES = [
    { id: 'b1',       label: 'B1 Depo',    key: 'b1'        },
    { id: 'satin',    label: 'Satin Alma', key: 'requests'  },
    { id: 'personel', label: 'Personel',   key: 'personel'  },
    { id: 'b2',       label: 'B2 Depo',    key: 'b2'        },
    { id: 'gorev',    label: 'Gorevler',   key: 'gorevler'  }
];

// ═══════════════════════════════════════════════════════════════════
// [WHY]: Radar dot'larına tıklama ile kullanıcı panelini tetikler.
// [HOW]: Her .radar-dot'a click listener ekler, userData'yı okur,
//        paneli doldurur ve slide-in animasyonunu başlatır.
// ═══════════════════════════════════════════════════════════════════
function _initRadarDotClickEvents() {
    document.querySelectorAll('.radar-dot').forEach(function(dot) {
        dot.removeEventListener('click', _onRadarDotClick); // Duplicate guard
        dot.addEventListener('click', _onRadarDotClick);
    });
}

function _onRadarDotClick(e) {
    e.stopPropagation();

    // Önceki seçimi temizle
    document.querySelectorAll('.radar-dot.selected').forEach(function(d) {
        d.classList.remove('selected');
    });
    this.classList.add('selected');

    // Kullanıcı bilgisini dot'tan oku
    const userData = {
        id:     this.dataset.userId     || 'user-unknown',
        name:   this.dataset.userName   || 'Bilinmeyen Kullanici',
        module: this.dataset.userModule || 'Bilinmeyen Modul',
        demo:   this.dataset.demo === 'true'
    };

    _currentTargetUser = userData;
    _openUserActivityPanel(userData);
}

// ═══════════════════════════════════════════════════════════════════
// [WHY]: Kullanıcı aktivite panelini verilerle doldurur ve açar.
// [HOW]: DOM elementlerini günceller, mock aktivite listesi üretir,
//        panel ve overlay'i görünür kılar.
// ═══════════════════════════════════════════════════════════════════
function _openUserActivityPanel(userData) {
    // Avatar initials
    const initials = userData.name.split(' ').map(function(w) { return w[0]; }).join('').slice(0, 2).toUpperCase();
    const avatarEl = document.getElementById('uapAvatar');
    if (avatarEl) avatarEl.textContent = initials;

    // Header bilgileri
    const nameEl = document.getElementById('uapUserName');
    if (nameEl) nameEl.textContent = userData.name + (userData.demo ? ' · DEMO' : '');

    const moduleEl = document.getElementById('uapUserModule');
    if (moduleEl) moduleEl.innerHTML = '<i class="fas fa-cube me-1"></i>' + escapeHtml(userData.module);

    // İstatistikler (mock + window.data analizi)
    const actionCount = _computeUserActionCount(userData.module);

    const statActions = document.getElementById('uapStatActions');
    const statSession = document.getElementById('uapStatSession');
    const statModule  = document.getElementById('uapStatModule');
    const statRisk    = document.getElementById('uapStatRisk');

    if (statActions) statActions.textContent = actionCount;
    // [WHY]: Oturum süresi Math.random() ile uyduruluyordu (VIP-03); presence verisi olmadığı için gösterilmez.
    if (statSession) statSession.textContent = '—';
    if (statModule)  statModule.textContent  = userData.module;
    if (statRisk) {
        const risk = actionCount > 10 ? 'HIGH' : actionCount > 5 ? 'MED' : 'LOW';
        statRisk.textContent = risk;
        statRisk.style.color = risk === 'HIGH' ? 'var(--vip-danger)' : risk === 'MED' ? 'var(--vip-warning)' : 'var(--vip-matrix)';
    }

    // Aktivite listesi
    _renderActivityList(userData.module);

    // Butonu resetle
    const logoutBtn = document.getElementById('uapForceLogoutBtn');
    if (logoutBtn) {
        logoutBtn.classList.remove('confirming');
        logoutBtn.innerHTML = '<i class="fas fa-right-from-bracket"></i> Force Logout Uygula';
        logoutBtn._confirmState = false;
    }

    // Mesaj alanını temizle
    const msgArea = document.getElementById('uapSystemMessage');
    if (msgArea) msgArea.value = '';

    // Panel ve overlay'i aç
    const panel   = document.getElementById('userActivityPanel');
    const overlay = document.getElementById('userActivityOverlay');
    if (panel)   panel.classList.add('panel-open');
    if (overlay) {
        overlay.style.display = 'block';
        setTimeout(function() { overlay.classList.add('overlay-visible'); }, 10);
    }
}

// Paneli kapat
window.vipCloseUserPanel = function() {
    const panel   = document.getElementById('userActivityPanel');
    const overlay = document.getElementById('userActivityOverlay');
    if (panel)   panel.classList.remove('panel-open');
    if (overlay) {
        overlay.classList.remove('overlay-visible');
        setTimeout(function() { overlay.style.display = 'none'; }, 300);
    }
    // Radar seçimini temizle
    document.querySelectorAll('.radar-dot.selected').forEach(function(d) {
        d.classList.remove('selected');
    });
    _currentTargetUser = null;
};

// Kullanıcının modülüne göre window.data'dan eylem sayısını hesapla
function _computeUserActionCount(moduleName) {
    if (!window.data) return 0;
    const moduleKeyMap = { 'B1 Depo': 'b1', 'B2 Depo': 'b2', 'Satin Alma': 'requests', 'Personel': 'personel' };
    const key = moduleKeyMap[moduleName];
    if (!key || !window.data[key]) return 0;
    const arr = Array.isArray(window.data[key]) ? window.data[key] : Object.values(window.data[key]);
    return Math.min(arr.length, 99);
}

// Aktivite listesini render et
function _renderActivityList(moduleName) {
    const list = document.getElementById('uapActivityList');
    if (!list) return;

    const now    = new Date();
    const fmtMin = function(m) { return now.getHours() + ':' + String(now.getMinutes() - m).padStart(2,'0'); };

    const templates = [
        { icon: 'fa-eye',          text: moduleName + ' modülünü açtı',    min: 1  },
        { icon: 'fa-magnifying-glass', text: 'Stok listesi filtreledi',     min: 3  },
        { icon: 'fa-file-export',  text: 'Rapor sayfasını görüntüledi',     min: 7  },
        { icon: 'fa-hand-pointer', text: 'Zimmet detayına tıkladı',         min: 12 },
        { icon: 'fa-arrow-right-from-bracket', text: 'Oturum başlattı',     min: 35 }
    ];

    // Örnek aktivite listesidir (gerçek oturum/presence izlenmiyor; Karar K8-b).
    list.innerHTML = '<li class="uap-activity-item uap-demo-note" style="color: var(--vip-warning);">' +
        '<i class="fas fa-flask uap-activity-icon"></i><div>DEMO — örnek aktivite; gerçek oturum izlenmiyor</div></li>' +
        templates.map(function(t) {
        return '<li class="uap-activity-item">' +
            '<i class="fas ' + escapeHtml(t.icon) + ' uap-activity-icon"></i>' +
            '<div>' +
                '<div>' + escapeHtml(t.text) + '</div>' +
                '<div class="uap-activity-time">' + escapeHtml(fmtMin(t.min)) + ' — az önce</div>' +
            '</div>' +
        '</li>';
    }).join('');
}

// ═══════════════════════════════════════════════════════════════════
// [WHY]: Admin kullanıcıya sistem mesajı gönderir.
// [HOW]: Firestore system_config/admin_settings'e user_messages kaydı
//        yazar. Gerçek dinleyici firebase-handler.js'e devredilir.
// ═══════════════════════════════════════════════════════════════════
window.vipSendSystemMessage = async function() {
    const msgEl = document.getElementById('uapSystemMessage');
    if (!msgEl || !msgEl.value.trim()) {
        if (typeof _appendLog === 'function') _appendLog('warn', ['[God-Eye] Mesaj boş olamaz.']);
        if (msgEl) msgEl.focus();
        return;
    }

    const msg    = msgEl.value.trim();
    const userId = _currentTargetUser ? _currentTargetUser.id : 'broadcast';
    const userName = _currentTargetUser ? _currentTargetUser.name : 'Tüm Kullanıcılar';

    const btn = document.getElementById('uapSendMsgBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Gönderiliyor...'; }

    try {
        if (!window.fireDb) throw new Error('Firestore bağlantısı yok');

        const { doc, setDoc, serverTimestamp } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
        const msgRef = window.systemConfigRef("admin_messages");
        await setDoc(msgRef, {
            target_user_id: userId,
            target_user_name: userName,
            message: msg,
            sent_by: (window.currentUser && window.currentUser.name) || 'Admin',
            timestamp: serverTimestamp()
        }, { merge: true });

        if (typeof _appendLog === 'function') {
            _appendLog('success', ['[God-Eye] Sistem mesaji gonderildi -> ' + userName + ': "' + msg + '"']);
        }
        msgEl.value = '';
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> Mesaj Gönderildi!'; }
        setTimeout(function() {
            if (btn) btn.innerHTML = '<i class="fas fa-paper-plane"></i> Sistem Mesajı Gönder';
        }, 2500);

    } catch (err) {
        if (typeof _appendLog === 'function') {
            _appendLog('error', ['[God-Eye] Mesaj gönderilemedi: ' + err.message]);
        }
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane"></i> Sistem Mesajı Gönder'; }
        alert('Mesaj gönderilemedi: ' + err.message);
    }
};

// ═══════════════════════════════════════════════════════════════════
// [WHY]: İki aşamalı onay mekanizması ile force logout uygular.
// [HOW]: İlk tıklamada "emin misiniz?" sorar. İkinci tıklamada
//        Firestore system_config/admin_settings.force_logout_user_id
//        alanına hedef kullanıcı ID'sini yazar.
// ═══════════════════════════════════════════════════════════════════
window.vipForceLogoutConfirm = function() {
    const btn = document.getElementById('uapForceLogoutBtn');
    if (!btn) return;

    if (!btn._confirmState) {
        // Birinci tıklama: onay iste
        btn._confirmState = true;
        btn.classList.add('confirming');
        btn.innerHTML = '<i class="fas fa-triangle-exclamation"></i> EMİN MİSİNİZ? (Tekrar tıkla)';

        // 4 saniye sonra iptal
        clearTimeout(btn._confirmTimer);
        btn._confirmTimer = setTimeout(function() {
            btn._confirmState = false;
            btn.classList.remove('confirming');
            btn.innerHTML = '<i class="fas fa-right-from-bracket"></i> Force Logout Uygula';
        }, 4000);
    } else {
        // İkinci tıklama: gerçekten uygula
        clearTimeout(btn._confirmTimer);
        btn._confirmState = false;
        btn.classList.remove('confirming');
        window.vipForceLogout();
    }
};

window.vipForceLogout = async function() {
    if (!_currentTargetUser) {
        if (typeof _appendLog === 'function') _appendLog('warn', ['[God-Eye] Force Logout: Hedef kullanici belirlenmedi.']);
        return;
    }

    const userId   = _currentTargetUser.id;
    const userName = _currentTargetUser.name;
    const btn      = document.getElementById('uapForceLogoutBtn');

    // [WHY]: Admin kendini hedeflerse her snapshot'ta tekrar atılıyordu (VIP-06). DEMO radar noktaları gerçek kişi değildir;
    //        adları gerçek bir personelle aynıysa o kişi atılırdı (VIP-03).
    const me = window.currentUser || (typeof window.getActiveUser === 'function' ? window.getActiveUser() : null);
    const isSelf = !!me && [me.id, me.code, me.name].some(v => v != null && v !== '' && (String(v) === String(userId) || String(v) === String(userName)));
    if (isSelf || _currentTargetUser.demo) {
        const why = isSelf ? 'Kendi oturumunuzu hedefleyemezsiniz.' : 'DEMO radar noktası gerçek bir oturum değildir.';
        if (typeof _appendLog === 'function') _appendLog('warn', ['[God-Eye] Force Logout reddedildi: ' + why]);
        if (typeof showAppAlert === 'function') showAppAlert('Force Logout uygulanmadı: ' + why, 'warning');
        return;
    }

    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uygulanıyor...'; }

    try {
        if (!window.fireDb) throw new Error('Firestore baglantisi yok');

        const { setDoc, deleteField } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");

        // [WHY]: force_logout_user_id alanını Firestore'a yaz.
        // [HOW]: firebase-handler.js bu alanı onSnapshot ile dinleyerek
        //        hedef kullanıcının oturumunu client-side sonlandırır.
        const settingsRef = window.systemConfigRef("admin_settings");
        // VIP-06: tek seferlik komut { targetId, issuedAt, nonce }; istemci yalnız taze ve daha önce işlemediği nonce'u uygular.
        //         Eski düz alanlar (her snapshot'ta yeniden tetikleniyordu) silinir.
        await setDoc(settingsRef, {
            force_logout: {
                targetId: String(userId),
                targetName: userName,
                issuedAt: Date.now(),
                nonce: Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10),
                by: (window.currentUser && window.currentUser.name) || 'Admin'
            },
            force_logout_user_id: deleteField(),
            force_logout_user_name: deleteField(),
            force_logout_by: deleteField(),
            force_logout_at: deleteField()
        }, { merge: true });

        if (typeof _appendLog === 'function') {
            _appendLog('error', ['[God-Eye] FORCE LOGOUT: ' + userName + ' (' + userId + ') oturumu zorla kapatildi.']);
        }

        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-check-circle"></i> Oturum Kapatıldı!';
            btn.style.color = 'var(--vip-matrix)';
            btn.style.borderColor = 'var(--vip-matrix)';
        }

        // Paneli 2 saniye sonra kapat
        setTimeout(function() {
            window.vipCloseUserPanel();
        }, 2000);

    } catch (err) {
        if (typeof _appendLog === 'function') {
            _appendLog('error', ['[God-Eye] Force Logout basarisiz: ' + err.message]);
        }
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-right-from-bracket"></i> Force Logout Uygula';
            btn.style.color = '';
            btn.style.borderColor = '';
        }
        alert('Force Logout basarisiz: ' + err.message);
    }
};

// ═══════════════════════════════════════════════════════════════════
// [WHY]: Radar görünümünü ve Heatmap SVG pie chart'ını toggle eder.
// [HOW]: Radar görünürken gizler, heatmap hesaplar ve SVG çizer;
//        heatmap görünürken kapatıp radar'a geri döner.
// ═══════════════════════════════════════════════════════════════════
window.vipToggleHeatmap = function(btn) {
    _godEyeHeatmapActive = !_godEyeHeatmapActive;
    const toggleBtn  = btn || document.getElementById('godEyeHeatmapToggle');
    const radarInner = document.getElementById('godEyeRadarInner');
    const heatmapSVG = document.getElementById('godEyeHeatmapSVG');
    const statusText = document.getElementById('godEyeStatusText');

    if (_godEyeHeatmapActive) {
        // Radar'ı gizle, heatmap'i göster
        if (radarInner) radarInner.style.display = 'none';
        if (heatmapSVG) { heatmapSVG.classList.add('visible'); }
        if (toggleBtn)  { toggleBtn.classList.add('heatmap-active'); toggleBtn.innerHTML = '<i class="fas fa-eye"></i> RADAR'; }
        if (statusText) statusText.innerHTML = '<i class="fas fa-fire" style="color: var(--vip-warning); font-size: 9px; margin-right: 4px;"></i>Modül yoğunluk haritası aktif';

        // Heatmap verilerini hesapla ve çiz
        const heatData = _computeHeatmapData();
        _renderHeatmap(heatData);

    } else {
        // Heatmap'i gizle, radar'ı göster
        if (heatmapSVG) heatmapSVG.classList.remove('visible');
        if (radarInner) radarInner.style.display = 'block';
        if (toggleBtn)  { toggleBtn.classList.remove('heatmap-active'); toggleBtn.innerHTML = '<i class="fas fa-fire-flame-curved"></i> HEATMAP'; }
        if (statusText) statusText.innerHTML = '<i class="fas fa-circle" style="color: var(--vip-matrix); font-size: 6px; margin-right: 5px;"></i>DEMO — örnek oturumlar (gerçek presence yok)';
    }
};

// ═══════════════════════════════════════════════════════════════════
// [WHY]: Son loglar üzerinden modül başına yoğunluk hesaplar.
// [HOW]: window.data içindeki her modül koleksiyonunun kayıt sayısını
//        okur. Matematiksel NaN/sıfıra bölünme koruması dahil.
// ═══════════════════════════════════════════════════════════════════
function _computeHeatmapData() {
    // Erken çıkış: window.data henüz yüklenmemişse nötr dağılım
    if (!window.data) {
        return _GOD_EYE_MODULES.map(function(m) {
            return { label: m.label, ratio: 1 / _GOD_EYE_MODULES.length, count: 0 };
        });
    }

    // Ham sayıları topla
    const rawCounts = {};
    _GOD_EYE_MODULES.forEach(function(m) {
        const src = window.data[m.key];
        if (!src) { rawCounts[m.id] = 0; return; }
        const arr = Array.isArray(src) ? src : Object.values(src);
        rawCounts[m.id] = arr.length;
    });

    // ── NaN KORUMA KATI 1: toplam sıfırsa eşit dağıt ──────────────
    const moduleCount   = Math.max(_GOD_EYE_MODULES.length, 1); // K.2: N=0 guard
    const totalActivity = Object.values(rawCounts).reduce(function(a, b) { return a + b; }, 0);
    const baseRatio     = 1 / moduleCount; // Fallback oranı

    // ── NaN KORUMA KATI 2: paranoid isNaN + isFinite kontrolü ─────
    const safeRatio = function(count) {
        const r = totalActivity > 0 ? count / totalActivity : baseRatio;
        return (isNaN(r) || !isFinite(r)) ? 0 : r; // K.3: son savunma
    };

    return _GOD_EYE_MODULES.map(function(m) {
        return {
            label: m.label,
            ratio: safeRatio(rawCounts[m.id] || 0),
            count: rawCounts[m.id] || 0
        };
    });
}

// ═══════════════════════════════════════════════════════════════════
// [WHY]: Heatmap verilerini SVG pie chart olarak render eder.
// [HOW]: Her dilim için trigonometri ile SVG path arc çizer.
//        Yoğunluğa göre renk sınıfı atar (cool/warm/hot).
// ═══════════════════════════════════════════════════════════════════
function _renderHeatmap(data) {
    const svg = document.getElementById('godEyeHeatmapSVG');
    if (!svg) return;

    const R      = 95;  // Dış yarıçap
    const R_IN   = 38;  // İç yarıçap (donut boşluk)
    const GAP    = 0.025; // Dilimler arası açı boşluğu (radyan)

    let startAngle = -Math.PI / 2; // 12 o'clock'tan başla

    // Eşik değerleri (toplam aktiviteye göre normalize)
    const maxCount = Math.max(...data.map(function(d) { return d.count; }), 1);

    const slices = data.map(function(d) {
        const angle = d.ratio * 2 * Math.PI;
        return { label: d.label, count: d.count, angle: angle, ratio: d.ratio, intensity: d.count / maxCount };
    });

    // Renk sınıfı belirle
    const _colorClass = function(intensity) {
        if (intensity >= 0.65) return 'hm-slice-hot';
        if (intensity >= 0.30) return 'hm-slice-warm';
        return 'hm-slice-cool';
    };

    // SVG arc path üret
    const _arcPath = function(sAngle, eAngle) {
        const x1  = R * Math.cos(sAngle + GAP);
        const y1  = R * Math.sin(sAngle + GAP);
        const x2  = R * Math.cos(eAngle - GAP);
        const y2  = R * Math.sin(eAngle - GAP);
        const ix1 = R_IN * Math.cos(eAngle - GAP);
        const iy1 = R_IN * Math.sin(eAngle - GAP);
        const ix2 = R_IN * Math.cos(sAngle + GAP);
        const iy2 = R_IN * Math.sin(sAngle + GAP);
        const largeArc = (eAngle - sAngle - 2 * GAP) > Math.PI ? 1 : 0;
        return [
            'M', x1, y1,
            'A', R, R, 0, largeArc, 1, x2, y2,
            'L', ix1, iy1,
            'A', R_IN, R_IN, 0, largeArc, 0, ix2, iy2,
            'Z'
        ].join(' ');
    };

    // [WHY] (v3.6 · İP-4 · VIP-14): SVG, string birleştirme + innerHTML ile basılıyordu (escapeHtml'e bağımlı sink).
    // [HOW]: createElementNS + DocumentFragment ile düğümler kurulur, <title> metni textContent'tir, tek replaceChildren.
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const frag = document.createDocumentFragment();
    const _svgEl = function(tag, attrs) {
        const el = document.createElementNS(SVG_NS, tag);
        Object.keys(attrs).forEach(function(k) { el.setAttribute(k, String(attrs[k])); });
        return el;
    };

    slices.forEach(function(s) {
        const endAngle   = startAngle + s.angle;
        const midAngle   = startAngle + s.angle / 2;
        const labelR     = (R + R_IN) / 2;
        const lx         = labelR * Math.cos(midAngle);
        const ly         = labelR * Math.sin(midAngle);
        const colorCls   = _colorClass(s.intensity);

        const path = _svgEl('path', { d: _arcPath(startAngle, endAngle), 'class': 'hm-slice ' + colorCls });
        const title = _svgEl('title', {});
        title.textContent = s.label + ': ' + s.count + ' kayit (%' + Math.round(s.ratio * 100) + ')';
        path.appendChild(title);
        frag.appendChild(path);

        // Yeterince büyük dilimde etiket göster
        if (s.ratio > 0.08) {
            const label = _svgEl('text', { 'class': 'hm-label', x: lx, y: ly });
            label.textContent = s.label;
            frag.appendChild(label);
        }

        startAngle = endAngle;
    });

    // Merkez bilgi metni
    const totalCount = data.reduce(function(a, d) { return a + d.count; }, 0);
    const centerCount = _svgEl('text', { 'class': 'hm-center-text', x: 0, y: -6 });
    centerCount.textContent = String(totalCount);
    const centerUnit = _svgEl('text', { 'class': 'hm-center-text', x: 0, y: 8 });
    centerUnit.textContent = 'kayit';
    frag.appendChild(centerCount);
    frag.appendChild(centerUnit);

    svg.replaceChildren(frag);
}

// ═══════════════════════════════════════════════════════════════════
// _initVipPanel'a God-Eye v2 başlatıcısını ekle
// ═══════════════════════════════════════════════════════════════════
const _prevInitVipForGodEye = window._initVipPanel;
window._initVipPanel = function() {
    if (_prevInitVipForGodEye) _prevInitVipForGodEye();
    // Kısa gecikme ile radar dot click eventlerini bağla
    setTimeout(function() {
        _initRadarDotClickEvents();
    }, 400);
};

