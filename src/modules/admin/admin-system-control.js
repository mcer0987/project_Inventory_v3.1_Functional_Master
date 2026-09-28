/**
 * â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
 *  ğŸŒŒ SÄ°STEM KONTROL MERKEZÄ° â€” VIP EXCLUSIVE JS ENGINE
 * â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
 *  Bu modÃ¼l, Admin'e tam sistem hakimiyeti sunar.
 *  - GeliÅŸmiÅŸ Konsol Interceptor (log/warn/error/info + onerror)
 *  - Sistem SaÄŸlÄ±k MonitÃ¶rÃ¼ (memory, network, uptime, data size)
 *  - Operasyon Raporu (count-up animasyonlu)
 *  - Debug & Hata Takip Paneli
 *  - SortableJS SÃ¼rÃ¼kle-BÄ±rak (geliÅŸtirilmiÅŸ)
 *  - Oturum & GÃ¼venlik Widget'Ä±
 * â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
 */

(function () {
    'use strict';

    // Sayfa yÃ¼klendiÄŸinde baÅŸlat
    const _pageLoadTime = Date.now();
    let _logFilter = 'all';
    let _logCount = { info: 0, warn: 0, error: 0, success: 0 };
    let _runtimeErrors = [];

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // 1. GELÄ°ÅMÄ°Å KONSOL INTERCEPTOR
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

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

        const msg = Array.from(args).map(_formatArg).join(' ');
        const time = new Date().toLocaleTimeString('tr-TR', { hour12: false });

        const icons = {
            info: 'fa-circle-info',
            warn: 'fa-triangle-exclamation',
            error: 'fa-circle-xmark',
            success: 'fa-circle-check'
        };

        const div = document.createElement('div');
        div.className = `log-entry ${type}`;
        div.setAttribute('data-type', type);
        div.innerHTML = `
            <i class="fas ${icons[type] || icons.info} log-icon"></i>
            <span class="timestamp">${time}</span>
            <span class="log-msg">${_escapeHtml(msg)}</span>
        `;

        // Filter kontrolÃ¼
        if (_logFilter !== 'all' && type !== _logFilter) {
            div.style.display = 'none';
        }

        terminal.appendChild(div);
        _logCount[type] = (_logCount[type] || 0) + 1;
        _updateLogCountBadges();

        // Max 150 log tut
        const logEntries = terminal.querySelectorAll('.log-entry');
        if (logEntries.length > 150) {
            terminal.removeChild(logEntries[0]);
        }

        // Otomatik scroll
        terminal.scrollTop = terminal.scrollHeight;
    }

    function _escapeHtml(str) {
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
        return str.replace(/[&<>"']/g, c => map[c]);
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

    // Global hata yakalayÄ±cÄ±
    window.addEventListener('error', function (e) {
        const errMsg = `${e.message} â€” ${e.filename || 'unknown'}:${e.lineno || '?'}`;
        _appendLog('error', ['[RUNTIME ERROR]', errMsg]);
        _runtimeErrors.push({
            message: e.message,
            file: e.filename,
            line: e.lineno,
            time: new Date().toISOString()
        });
    });

    window.addEventListener('unhandledrejection', function (e) {
        _appendLog('error', ['[UNHANDLED PROMISE]', e.reason || 'Unknown rejection']);
        _runtimeErrors.push({
            message: String(e.reason),
            file: 'Promise',
            line: '-',
            time: new Date().toISOString()
        });
    });


    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // 2. TERMINAL KONTROL FONKSÄ°YONLARI
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    window.vipClearTerminal = function () {
        const terminal = _getTerminal();
        if (terminal) {
            terminal.innerHTML = '';
            _logCount = { info: 0, warn: 0, error: 0, success: 0 };
            _updateLogCountBadges();
            _appendLog('success', ['ğŸ§¹ Terminal temizlendi.']);
        }
    };

    window.vipFilterLogs = function (type, btn) {
        _logFilter = type;
        const terminal = _getTerminal();
        if (!terminal) return;

        // TÃ¼m loglarÄ±n gÃ¶rÃ¼nÃ¼rlÃ¼ÄŸÃ¼nÃ¼ gÃ¼ncelle
        terminal.querySelectorAll('.log-entry').forEach(el => {
            if (type === 'all') {
                el.style.display = '';
            } else {
                el.style.display = el.getAttribute('data-type') === type ? '' : 'none';
            }
        });

        // Buton aktif durumunu gÃ¼ncelle
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


    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // 3. SÄ°STEM SAÄLIK MONÄ°TÃ–RÃœ
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    function _updateSystemHealth() {
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
                netEl.textContent = `${conn.effectiveType?.toUpperCase() || '?'} â€” ${conn.downlink || '?'} Mbps`;
            } else {
                netEl.textContent = navigator.onLine ? 'Ã‡evrimiÃ§i' : 'Ã‡evrimdÄ±ÅŸÄ±';
            }
        }

        // Firebase / Online Status
        const fbEl = document.getElementById('vipFirebaseDot');
        if (fbEl) {
            fbEl.className = 'heartbeat-dot ' + (navigator.onLine ? 'online' : 'offline');
        }
        const fbText = document.getElementById('vipFirebaseText');
        if (fbText) {
            fbText.textContent = navigator.onLine ? 'BaÄŸlÄ±' : 'BaÄŸlantÄ± Kesildi';
            fbText.style.color = navigator.onLine ? 'var(--vip-matrix)' : 'var(--vip-danger)';
        }

        // Data Size (window.data analizi)
        const dataEl = document.getElementById('vipDataSize');
        if (dataEl && window.data) {
            try {
                const jsonStr = JSON.stringify(window.data);
                const sizeKB = (new Blob([jsonStr]).size / 1024).toFixed(1);
                const b1Count = Array.isArray(window.data.b1) ? window.data.b1.length : Object.keys(window.data.b1 || {}).length;
                const b2Count = Array.isArray(window.data.b2) ? window.data.b2.length : Object.keys(window.data.b2 || {}).length;
                dataEl.textContent = `${sizeKB} KB â€” ${b1Count + b2Count} kayÄ±t`;
            } catch (e) {
                dataEl.textContent = 'HesaplanamadÄ±';
            }
        }

        // DOM dÃ¼ÄŸÃ¼m sayÄ±sÄ±
        const domEl = document.getElementById('vipDomNodes');
        if (domEl) {
            domEl.textContent = document.querySelectorAll('*').length.toLocaleString('tr-TR');
        }
    }


    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // 4. OPERASYON RAPORU â€” COUNT-UP ANÄ°MASYONLU
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    function _animateCountUp(elementId, targetValue, duration) {
        const el = document.getElementById(elementId);
        if (!el) return;
        const start = 0;
        const startTime = performance.now();

        function tick(now) {
            const elapsed = now - startTime;
            const progress = Math.min(elapsed / duration, 1);
            // Ease-out cubic
            const eased = 1 - Math.pow(1 - progress, 3);
            el.textContent = Math.floor(start + (targetValue - start) * eased).toLocaleString('tr-TR');
            if (progress < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
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

        // Toplam stok miktarÄ±
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

        // ÃœrÃ¼n tÃ¼rÃ¼ sayÄ±sÄ±
        const typeCount = (window.data.productTypes || []).length;

        // Animasyonlu sayaÃ§larÄ± baÅŸlat
        _animateCountUp('opsProducts', totalProducts, 1200);
        _animateCountUp('opsStock', totalStock, 1400);
        _animateCountUp('opsExits', totalExits, 1000);
        _animateCountUp('opsPending', pendingRequests, 800);
        _animateCountUp('opsCritical', criticalCount, 1000);
        _animateCountUp('opsTypes', typeCount, 800);
    }


    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // 5. DEBUG & HATA TAKÄ°P PANELÄ°
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    function _renderDebugPanel() {
        const container = document.getElementById('vipDebugList');
        if (!container) return;

        // Statik (bilinen) hatalar/geliÅŸtirmeler
        const knownItems = [
            { status: 'resolved', title: 'Chart.js Canvas Bellek SÄ±zÄ±ntÄ±sÄ±', desc: 'destroy() Ã§aÄŸrÄ±sÄ± eklenerek Ã§Ã¶zÃ¼ldÃ¼', badge: 'Ã‡Ã¶zÃ¼ldÃ¼' },
            { status: 'resolved', title: 'Sub-collection Veri Mimarisi', desc: 'Tek-dÃ¶kÃ¼man yapÄ±sÄ±ndan alt koleksiyon mimarisine geÃ§iÅŸ', badge: 'TamamlandÄ±' },
            { status: 'resolved', title: 'Firebase Chunk Yazma (500lÃ¼k)', desc: 'BÃ¼yÃ¼k veri setleri iÃ§in parÃ§alÄ± kayÄ±t', badge: 'TamamlandÄ±' },
            { status: 'resolved', title: 'SHA-256 GÃ¼venlik Hash', desc: 'Åifrelerin geri dÃ¶ndÃ¼rÃ¼lemez hash ile saklanmasÄ±', badge: 'Aktif' },
            { status: 'resolved', title: 'SortableJS Entegrasyonu', desc: 'VIP widget sÃ¼rÃ¼kle-bÄ±rak motoru', badge: 'TamamlandÄ±' },
            { status: 'resolved', title: 'Console Interceptor', desc: 'CanlÄ± log yakalama ve terminal akÄ±ÅŸÄ±', badge: 'Aktif' },
            { status: 'active', title: 'VIP Kontrol Merkezi v2.0', desc: 'Premium UI yeniden inÅŸasÄ± â€” aktif geliÅŸtirme', badge: 'Devam Ediyor' }
        ];

        // Runtime hatalarÄ±nÄ± ekle
        _runtimeErrors.forEach(err => {
            knownItems.push({
                status: 'critical',
                title: err.message.substring(0, 60),
                desc: `${err.file || 'bilinmeyen'} @ satÄ±r ${err.line || '?'}`,
                badge: 'Runtime Hata'
            });
        });

        const statusIcons = {
            resolved: 'âœ…',
            active: 'âš ï¸',
            critical: 'ğŸ”´'
        };

        container.innerHTML = knownItems.map(item => `
            <li class="debug-item">
                <span class="debug-status">${statusIcons[item.status]}</span>
                <div class="debug-info">
                    <div class="debug-title">${item.title}</div>
                    <div class="debug-desc">${item.desc}</div>
                </div>
                <span class="debug-badge ${item.status}">${item.badge}</span>
            </li>
        `).join('');
    }


    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // 6. PLATFORM & DONANIM ANALÄ°ZÄ°
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    function _updatePlatformInfo() {
        // TarayÄ±cÄ± Motoru
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

        // Ekran Ã§Ã¶zÃ¼nÃ¼rlÃ¼ÄŸÃ¼
        const screenEl = document.getElementById('vipScreenRes');
        if (screenEl) {
            screenEl.textContent = `${window.screen.width}Ã—${window.screen.height} (${window.devicePixelRatio}x)`;
        }

        // Viewport
        const viewportEl = document.getElementById('vipViewport');
        if (viewportEl) {
            viewportEl.textContent = `${window.innerWidth}Ã—${window.innerHeight}`;
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

        // Ã‡erez durumu
        const cookieEl = document.getElementById('vipCookies');
        if (cookieEl) {
            cookieEl.textContent = navigator.cookieEnabled ? 'Aktif' : 'Devre DÄ±ÅŸÄ±';
        }

        // DonanÄ±m Ã§ekirdek sayÄ±sÄ±
        const coreEl = document.getElementById('vipCores');
        if (coreEl) {
            coreEl.textContent = (navigator.hardwareConcurrency || '?') + ' Ã‡ekirdek';
        }
    }


    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // 7. OTURUM & GÃœVENLÄ°K WIDGET'I
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    function _updateSessionInfo() {
        const countdownEl = document.getElementById('vipSessionTime');
        const lastLoginEl = document.getElementById('vipLastLogin');
        const userEl = document.getElementById('vipActiveUser');
        const securityBars = document.querySelectorAll('#vipSecurityLevel .security-bar');

        // Oturum geri sayÄ±m
        const authData = localStorage.getItem('admin_auth');
        if (authData && countdownEl) {
            try {
                const auth = JSON.parse(authData);
                const remaining = Math.max(0, auth.expiry - Date.now());
                const mins = Math.floor(remaining / 60000);
                const secs = Math.floor((remaining % 60000) / 1000);
                countdownEl.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

                // 1 dakikadan az kaldÄ±ysa uyarÄ± modu
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

        // Son giriÅŸ zamanÄ±
        if (lastLoginEl) {
            const now = new Date();
            lastLoginEl.textContent = now.toLocaleDateString('tr-TR') + ' ' + now.toLocaleTimeString('tr-TR', { hour12: false });
        }

        // Aktif kullanÄ±cÄ±
        if (userEl) {
            const user = window.getActiveUser();
            userEl.textContent = (user && user.name) || 'Admin';
        }

        // GÃ¼venlik seviyesi (5 barlÄ±)
        if (securityBars.length) {
            let level = 0;
            if (typeof SecurityConfig !== 'undefined') level++; // SHA-256 tanÄ±mlÄ±
            if (localStorage.getItem('admin_auth')) level++;      // Oturum aktif
            if (window.location.protocol === 'https:' || window.location.hostname === 'localhost') level++; // HTTPS veya localhost
            if (navigator.cookieEnabled) level++;                  // Ã‡erez aktif
            level++; // VarsayÄ±lan 1 puan â€” uygulama Ã§alÄ±ÅŸÄ±yor

            securityBars.forEach((bar, i) => {
                bar.classList.toggle('active', i < level);
            });
        }
    }


    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // 8. SORTABLEJS ENTEGRASYONU (GELÄ°ÅTÄ°RÄ°LMÄ°Å)
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    function _initSortable() {
        const grid = document.getElementById('vipGrid');
        if (!grid || typeof Sortable === 'undefined') return;

        // KayÄ±tlÄ± dizilimi yÃ¼kle
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

        // Sortable'Ä± baÅŸlat
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
                _appendLog('success', ['ğŸ“ Widget dizilimi kaydedildi.']);
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

        // KayÄ±tlÄ± collapse durumlarÄ±nÄ± yÃ¼kle
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


    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // 9. DÄ°ZÄ°LÄ°MÄ° SIFIRLAMA
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    window.resetVipLayout = function () {
        localStorage.removeItem('vipLayoutOrder');
        localStorage.removeItem('vipCollapsedWidgets');
        _appendLog('warn', ['ğŸ”„ VIP dizilim sÄ±fÄ±rlandÄ±. Sayfa yenileniyor...']);
        setTimeout(() => location.reload(), 500);
    };


    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // 10. VIP SEKME AKTÄ°FLEÅTÄ°ÄÄ°NDE BAÅLATMA
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    let _vipInitialized = false;
    let _healthInterval = null;
    let _sessionInterval = null;

    function _initVipPanel() {
        if (_vipInitialized) {
            // Zaten baÅŸlatÄ±lmÄ±ÅŸ, sadece gÃ¼ncelle
            _updateOpsReport();
            _updateSystemHealth();
            _updateSessionInfo();
            _renderDebugPanel();
            return;
        }

        _vipInitialized = true;

        // TÃ¼m modÃ¼lleri baÅŸlat
        _initSortable();
        _initCollapse();
        _updatePlatformInfo();
        _updateOpsReport();
        _renderDebugPanel();
        _updateSystemHealth();
        _updateSessionInfo();

        // Periyodik gÃ¼ncellemeler
        _healthInterval = setInterval(() => {
            _updateSystemHealth();
            _updateSessionInfo();
        }, 1000);

        // VIP terminal aÃ§Ä±lÄ±ÅŸ mesajÄ±
        setTimeout(() => {
            _appendLog('success', ['ğŸŒŒ VIP Sistem Kontrol Merkezi v2.0 aktif.']);
            _appendLog('info', ['ğŸ“¡ Konsol kancalama baÅŸarÄ±lÄ± â€” tÃ¼m loglar burada.']);
        }, 300);

        // Viewport deÄŸiÅŸimlerini dinle
        window.addEventListener('resize', _updatePlatformInfo);
        
        // [WHY]: Her 15 sn gerçek terminale sahte "X kullanıcısı talep onayladı" logu basılıyordu (VIP-03); kaldırıldı.
        //        God-Eye radarı gerçek presence gelene kadar DEMO olarak etiketli (Karar K8-b).
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // 7. YENÄ° VIP Ã–ZELLÄ°KLERÄ° (God-Eye, Backup, Kill Switch)
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    // 1-TÄ±k VeritabanÄ± YedeÄŸi
    window.vipBackupDatabase = function() {
        try {
            const dataToBackup = window.data || {};
            const jsonStr = JSON.stringify(dataToBackup, null, 2);
            const blob = new Blob([jsonStr], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            
            const a = document.createElement("a");
            a.href = url;
            const dateStr = new Date().toISOString().split('T')[0];
            a.download = `ITSM_Backup_${dateStr}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            _appendLog('success', ['ğŸ’¾ VeritabanÄ± yedeÄŸi baÅŸarÄ±yla indirildi.']);
        } catch (error) {
            _appendLog('error', ['ğŸ’¾ Yedekleme sÄ±rasÄ±nda hata oluÅŸtu: ' + error.message]);
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
            const preview = _DUP_COLLECTIONS.flatMap(_findDuplicates);
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
            const toDelete = _DUP_COLLECTIONS.flatMap(_findDuplicates).filter(d => shown.has(_dupKey(d)));
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

    // Global Kill Switch
    // [WHY]: Kill Switch (Sistemi Kapatma) komutu localStorage'da tutuluyordu, DevTools ile bypass edilebiliyordu.
    // [HOW]: ArtÄ±k Firestore Ã¼zerindeki 'system_config/admin_settings' dÃ¶kÃ¼manÄ±na asenkron yazÄ±yor. Sadece Firebase Auth ile doÄŸrulanmÄ±ÅŸ adminler bu veriyi deÄŸiÅŸtirebilir.
    window.vipToggleKillSwitch = async function() {
        if (!window.userAuth) {
            alert("Oturum yetkiniz yok!");
            return;
        }
        
        try {
            const { doc, getDoc, setDoc } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
            const db = window.fireDb;
            const settingsRef = window.systemConfigRef("admin_settings");
            
            const snap = await getDoc(settingsRef);
            let isMaintenance = false;
            
            if (snap.exists()) {
                isMaintenance = snap.data().maintenance === true;
            }
            
            isMaintenance = !isMaintenance;
            
            // Backend kilitli Firestore'a yaz (EÄŸer yetkisiz biri yaparsa Firebase otomatik reddeder)
            await setDoc(settingsRef, { maintenance: isMaintenance }, { merge: true });
            
            const btn = document.getElementById('vipKillSwitchBtn');
            if (isMaintenance) {
                btn.innerHTML = '<i class="fas fa-play me-2"></i>SÄ°STEMÄ° GERÄ° AÃ‡';
                btn.style.background = 'rgba(0, 255, 136, 0.1)';
                btn.style.color = 'var(--vip-matrix)';
                btn.style.borderColor = 'var(--vip-matrix)';
                _appendLog('error', ['ğŸš¨ GLOBAL KILL SWITCH AKTÄ°F: Sistem bakÄ±m moduna alÄ±ndÄ±.']);
                alert("Sistem kilitlendi! Normal kullanÄ±cÄ±lar Firestore Rule Ã¼zerinden engellenecek.");
            } else {
                btn.innerHTML = '<i class="fas fa-power-off me-2"></i>GLOBAL KILL SWITCH';
                btn.style.background = 'rgba(255,45,85,0.1)';
                btn.style.color = 'var(--vip-danger)';
                btn.style.borderColor = 'var(--vip-danger)';
                _appendLog('success', ['âœ… GLOBAL KILL SWITCH KAPALI: Sistem normale dÃ¶ndÃ¼.']);
                alert("Sistem normale dÃ¶ndÃ¼!");
            }
        } catch (error) {
            _appendLog('error', ['âŒ Kill Switch BaÅŸarÄ±sÄ±z: ' + error.message]);
            alert("Ä°ÅŸlem reddedildi: " + error.message);
        }
    };

    // showAdminTab interceptor â€” VIP sekmesi aÃ§Ä±ldÄ±ÄŸÄ±nda baÅŸlat
    function _hookShowAdminTab() {
        // showAdminTab henÃ¼z tanÄ±mlÄ± deÄŸilse tekrar dene
        if (typeof window.showAdminTab !== 'function') {
            setTimeout(_hookShowAdminTab, 200);
            return;
        }

        const originalFn = window.showAdminTab;
        window.showAdminTab = function (tabId) {
            originalFn.call(this, tabId);

            // â”€â”€ VIP Portal Modu â”€â”€
            const sidebar = document.querySelector('.sidebar');
            const mainContent = document.querySelector('.main-content');
            const isVip = (tabId === 'systemControlTab');

            if (isVip) {
                // VIP dÃ¼nyasÄ±na geÃ§iÅŸ
                if (sidebar) sidebar.classList.add('vip-active');
                if (mainContent) mainContent.classList.add('vip-bg');
                document.body.classList.add('vip-portal-active');

                // [WHY]: Yerel _initVipPanel çağrılıyordu; window._initVipPanel sarmalayıcı zinciri (buton durumları, radar
                //        tıklamaları) hiç çalışmıyordu, aktivite paneli / mesaj / oturum sonlandırma ulaşılamazdı (VIP-04).
                requestAnimationFrame(() => {
                    setTimeout(() => window._initVipPanel(), 50);
                });
            } else {
                // Normal dÃ¼nyaya dÃ¶nÃ¼ÅŸ
                if (sidebar) sidebar.classList.remove('vip-active');
                if (mainContent) mainContent.classList.remove('vip-bg');
                document.body.classList.remove('vip-portal-active');
            }
        };
    }

    // DOMContentLoaded'da kancayÄ± kur
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _hookShowAdminTab);
    } else {
        _hookShowAdminTab();
    }
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




// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  GOD-EYE v2 â€” KULLANICI MÃœDAHALESÄ°, FORCE LOGOUT & HEATMAP
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// â”€â”€â”€ GLOBAL STATE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let _godEyeHeatmapActive = false;
let _currentTargetUser   = null; // Panelde aÃ§Ä±k olan kullanÄ±cÄ± verisi

// â”€â”€â”€ MODÃœL LÄ°STESÄ° (Heatmap iÃ§in) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const _GOD_EYE_MODULES = [
    { id: 'b1',       label: 'B1 Depo',    key: 'b1'        },
    { id: 'satin',    label: 'Satin Alma', key: 'requests'  },
    { id: 'personel', label: 'Personel',   key: 'personel'  },
    { id: 'b2',       label: 'B2 Depo',    key: 'b2'        },
    { id: 'gorev',    label: 'Gorevler',   key: 'gorevler'  }
];

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// [WHY]: Radar dot'larÄ±na tÄ±klama ile kullanÄ±cÄ± panelini tetikler.
// [HOW]: Her .radar-dot'a click listener ekler, userData'yÄ± okur,
//        paneli doldurur ve slide-in animasyonunu baÅŸlatÄ±r.
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function _initRadarDotClickEvents() {
    document.querySelectorAll('.radar-dot').forEach(function(dot) {
        dot.removeEventListener('click', _onRadarDotClick); // Duplicate guard
        dot.addEventListener('click', _onRadarDotClick);
    });
}

function _onRadarDotClick(e) {
    e.stopPropagation();

    // Ã–nceki seÃ§imi temizle
    document.querySelectorAll('.radar-dot.selected').forEach(function(d) {
        d.classList.remove('selected');
    });
    this.classList.add('selected');

    // KullanÄ±cÄ± bilgisini dot'tan oku
    const userData = {
        id:     this.dataset.userId     || 'user-unknown',
        name:   this.dataset.userName   || 'Bilinmeyen Kullanici',
        module: this.dataset.userModule || 'Bilinmeyen Modul',
        demo:   this.dataset.demo === 'true'
    };

    _currentTargetUser = userData;
    _openUserActivityPanel(userData);
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// [WHY]: KullanÄ±cÄ± aktivite panelini verilerle doldurur ve aÃ§ar.
// [HOW]: DOM elementlerini gÃ¼nceller, mock aktivite listesi Ã¼retir,
//        panel ve overlay'i gÃ¶rÃ¼nÃ¼r kÄ±lar.
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function _openUserActivityPanel(userData) {
    // Avatar initials
    const initials = userData.name.split(' ').map(function(w) { return w[0]; }).join('').slice(0, 2).toUpperCase();
    const avatarEl = document.getElementById('uapAvatar');
    if (avatarEl) avatarEl.textContent = initials;

    // Header bilgileri
    const nameEl = document.getElementById('uapUserName');
    if (nameEl) nameEl.textContent = userData.name + (userData.demo ? ' · DEMO' : '');

    const moduleEl = document.getElementById('uapUserModule');
    if (moduleEl) moduleEl.innerHTML = '<i class="fas fa-cube me-1"></i>' + userData.module;

    // Ä°statistikler (mock + window.data analizi)
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

    // Mesaj alanÄ±nÄ± temizle
    const msgArea = document.getElementById('uapSystemMessage');
    if (msgArea) msgArea.value = '';

    // Panel ve overlay'i aÃ§
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
    // Radar seÃ§imini temizle
    document.querySelectorAll('.radar-dot.selected').forEach(function(d) {
        d.classList.remove('selected');
    });
    _currentTargetUser = null;
};

// KullanÄ±cÄ±nÄ±n modÃ¼lÃ¼ne gÃ¶re window.data'dan eylem sayÄ±sÄ±nÄ± hesapla
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
        { icon: 'fa-eye',          text: moduleName + ' modÃ¼lÃ¼nÃ¼ aÃ§tÄ±',    min: 1  },
        { icon: 'fa-magnifying-glass', text: 'Stok listesi filtreledi',     min: 3  },
        { icon: 'fa-file-export',  text: 'Rapor sayfasÄ±nÄ± gÃ¶rÃ¼ntÃ¼ledi',     min: 7  },
        { icon: 'fa-hand-pointer', text: 'Zimmet detayÄ±na tÄ±kladÄ±',         min: 12 },
        { icon: 'fa-arrow-right-from-bracket', text: 'Oturum baÅŸlattÄ±',     min: 35 }
    ];

    // Örnek aktivite listesidir (gerçek oturum/presence izlenmiyor; Karar K8-b).
    list.innerHTML = '<li class="uap-activity-item uap-demo-note" style="color: var(--vip-warning);">' +
        '<i class="fas fa-flask uap-activity-icon"></i><div>DEMO — örnek aktivite; gerçek oturum izlenmiyor</div></li>' +
        templates.map(function(t) {
        return '<li class="uap-activity-item">' +
            '<i class="fas ' + t.icon + ' uap-activity-icon"></i>' +
            '<div>' +
                '<div>' + t.text + '</div>' +
                '<div class="uap-activity-time">' + fmtMin(t.min) + ' â€” az Ã¶nce</div>' +
            '</div>' +
        '</li>';
    }).join('');
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// [WHY]: Admin kullanÄ±cÄ±ya sistem mesajÄ± gÃ¶nderir.
// [HOW]: Firestore system_config/admin_settings'e user_messages kaydÄ±
//        yazar. GerÃ§ek dinleyici firebase-handler.js'e devredilir.
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
window.vipSendSystemMessage = async function() {
    const msgEl = document.getElementById('uapSystemMessage');
    if (!msgEl || !msgEl.value.trim()) {
        if (typeof _appendLog === 'function') _appendLog('warn', ['[God-Eye] Mesaj boÅŸ olamaz.']);
        if (msgEl) msgEl.focus();
        return;
    }

    const msg    = msgEl.value.trim();
    const userId = _currentTargetUser ? _currentTargetUser.id : 'broadcast';
    const userName = _currentTargetUser ? _currentTargetUser.name : 'TÃ¼m KullanÄ±cÄ±lar';

    const btn = document.getElementById('uapSendMsgBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> GÃ¶nderiliyor...'; }

    try {
        if (!window.fireDb) throw new Error('Firestore baÄŸlantÄ±sÄ± yok');

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
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> Mesaj GÃ¶nderildi!'; }
        setTimeout(function() {
            if (btn) btn.innerHTML = '<i class="fas fa-paper-plane"></i> Sistem MesajÄ± GÃ¶nder';
        }, 2500);

    } catch (err) {
        if (typeof _appendLog === 'function') {
            _appendLog('error', ['[God-Eye] Mesaj gÃ¶nderilemedi: ' + err.message]);
        }
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane"></i> Sistem MesajÄ± GÃ¶nder'; }
        alert('Mesaj gÃ¶nderilemedi: ' + err.message);
    }
};

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// [WHY]: Ä°ki aÅŸamalÄ± onay mekanizmasÄ± ile force logout uygular.
// [HOW]: Ä°lk tÄ±klamada "emin misiniz?" sorar. Ä°kinci tÄ±klamada
//        Firestore system_config/admin_settings.force_logout_user_id
//        alanÄ±na hedef kullanÄ±cÄ± ID'sini yazar.
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
window.vipForceLogoutConfirm = function() {
    const btn = document.getElementById('uapForceLogoutBtn');
    if (!btn) return;

    if (!btn._confirmState) {
        // Birinci tÄ±klama: onay iste
        btn._confirmState = true;
        btn.classList.add('confirming');
        btn.innerHTML = '<i class="fas fa-triangle-exclamation"></i> EMÄ°N MÄ°SÄ°NÄ°Z? (Tekrar tÄ±kla)';

        // 4 saniye sonra iptal
        clearTimeout(btn._confirmTimer);
        btn._confirmTimer = setTimeout(function() {
            btn._confirmState = false;
            btn.classList.remove('confirming');
            btn.innerHTML = '<i class="fas fa-right-from-bracket"></i> Force Logout Uygula';
        }, 4000);
    } else {
        // Ä°kinci tÄ±klama: gerÃ§ekten uygula
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

    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> UygulanÄ±yor...'; }

    try {
        if (!window.fireDb) throw new Error('Firestore baglantisi yok');

        const { setDoc, deleteField } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");

        // [WHY]: force_logout_user_id alanÄ±nÄ± Firestore'a yaz.
        // [HOW]: firebase-handler.js bu alanÄ± onSnapshot ile dinleyerek
        //        hedef kullanÄ±cÄ±nÄ±n oturumunu client-side sonlandÄ±rÄ±r.
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
            btn.innerHTML = '<i class="fas fa-check-circle"></i> Oturum KapatÄ±ldÄ±!';
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

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// [WHY]: Radar gÃ¶rÃ¼nÃ¼mÃ¼nÃ¼ ve Heatmap SVG pie chart'Ä±nÄ± toggle eder.
// [HOW]: Radar gÃ¶rÃ¼nÃ¼rken gizler, heatmap hesaplar ve SVG Ã§izer;
//        heatmap gÃ¶rÃ¼nÃ¼rken kapatÄ±p radar'a geri dÃ¶ner.
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
window.vipToggleHeatmap = function(btn) {
    _godEyeHeatmapActive = !_godEyeHeatmapActive;
    const toggleBtn  = btn || document.getElementById('godEyeHeatmapToggle');
    const radarInner = document.getElementById('godEyeRadarInner');
    const heatmapSVG = document.getElementById('godEyeHeatmapSVG');
    const statusText = document.getElementById('godEyeStatusText');

    if (_godEyeHeatmapActive) {
        // Radar'Ä± gizle, heatmap'i gÃ¶ster
        if (radarInner) radarInner.style.display = 'none';
        if (heatmapSVG) { heatmapSVG.classList.add('visible'); }
        if (toggleBtn)  { toggleBtn.classList.add('heatmap-active'); toggleBtn.innerHTML = '<i class="fas fa-eye"></i> RADAR'; }
        if (statusText) statusText.innerHTML = '<i class="fas fa-fire" style="color: var(--vip-warning); font-size: 9px; margin-right: 4px;"></i>ModÃ¼l yoÄŸunluk haritasÄ± aktif';

        // Heatmap verilerini hesapla ve Ã§iz
        const heatData = _computeHeatmapData();
        _renderHeatmap(heatData);

    } else {
        // Heatmap'i gizle, radar'Ä± gÃ¶ster
        if (heatmapSVG) heatmapSVG.classList.remove('visible');
        if (radarInner) radarInner.style.display = 'block';
        if (toggleBtn)  { toggleBtn.classList.remove('heatmap-active'); toggleBtn.innerHTML = '<i class="fas fa-fire-flame-curved"></i> HEATMAP'; }
        if (statusText) statusText.innerHTML = '<i class="fas fa-circle" style="color: var(--vip-matrix); font-size: 6px; margin-right: 5px;"></i>DEMO — örnek oturumlar (gerçek presence yok)';
    }
};

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// [WHY]: Son loglar Ã¼zerinden modÃ¼l baÅŸÄ±na yoÄŸunluk hesaplar.
// [HOW]: window.data iÃ§indeki her modÃ¼l koleksiyonunun kayÄ±t sayÄ±sÄ±nÄ±
//        okur. Matematiksel NaN/sÄ±fÄ±ra bÃ¶lÃ¼nme korumasÄ± dahil.
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function _computeHeatmapData() {
    // Erken Ã§Ä±kÄ±ÅŸ: window.data henÃ¼z yÃ¼klenmemiÅŸse nÃ¶tr daÄŸÄ±lÄ±m
    if (!window.data) {
        return _GOD_EYE_MODULES.map(function(m) {
            return { label: m.label, ratio: 1 / _GOD_EYE_MODULES.length, count: 0 };
        });
    }

    // Ham sayÄ±larÄ± topla
    const rawCounts = {};
    _GOD_EYE_MODULES.forEach(function(m) {
        const src = window.data[m.key];
        if (!src) { rawCounts[m.id] = 0; return; }
        const arr = Array.isArray(src) ? src : Object.values(src);
        rawCounts[m.id] = arr.length;
    });

    // â”€â”€ NaN KORUMA KATI 1: toplam sÄ±fÄ±rsa eÅŸit daÄŸÄ±t â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const moduleCount   = Math.max(_GOD_EYE_MODULES.length, 1); // K.2: N=0 guard
    const totalActivity = Object.values(rawCounts).reduce(function(a, b) { return a + b; }, 0);
    const baseRatio     = 1 / moduleCount; // Fallback oranÄ±

    // â”€â”€ NaN KORUMA KATI 2: paranoid isNaN + isFinite kontrolÃ¼ â”€â”€â”€â”€â”€
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

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// [WHY]: Heatmap verilerini SVG pie chart olarak render eder.
// [HOW]: Her dilim iÃ§in trigonometri ile SVG path arc Ã§izer.
//        YoÄŸunluÄŸa gÃ¶re renk sÄ±nÄ±fÄ± atar (cool/warm/hot).
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function _renderHeatmap(data) {
    const svg = document.getElementById('godEyeHeatmapSVG');
    if (!svg) return;

    const R      = 95;  // DÄ±ÅŸ yarÄ±Ã§ap
    const R_IN   = 38;  // Ä°Ã§ yarÄ±Ã§ap (donut boÅŸluk)
    const GAP    = 0.025; // Dilimler arasÄ± aÃ§Ä± boÅŸluÄŸu (radyan)

    let startAngle = -Math.PI / 2; // 12 o'clock'tan baÅŸla

    // EÅŸik deÄŸerleri (toplam aktiviteye gÃ¶re normalize)
    const maxCount = Math.max(...data.map(function(d) { return d.count; }), 1);

    const slices = data.map(function(d) {
        const angle = d.ratio * 2 * Math.PI;
        return { label: d.label, count: d.count, angle: angle, ratio: d.ratio, intensity: d.count / maxCount };
    });

    // Renk sÄ±nÄ±fÄ± belirle
    const _colorClass = function(intensity) {
        if (intensity >= 0.65) return 'hm-slice-hot';
        if (intensity >= 0.30) return 'hm-slice-warm';
        return 'hm-slice-cool';
    };

    // SVG arc path Ã¼ret
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

    let svgContent = '';

    slices.forEach(function(s) {
        const endAngle   = startAngle + s.angle;
        const midAngle   = startAngle + s.angle / 2;
        const labelR     = (R + R_IN) / 2;
        const lx         = labelR * Math.cos(midAngle);
        const ly         = labelR * Math.sin(midAngle);
        const colorCls   = _colorClass(s.intensity);

        svgContent += '<path d="' + _arcPath(startAngle, endAngle) + '" class="hm-slice ' + colorCls + '">' +
            '<title>' + s.label + ': ' + s.count + ' kayit (%' + Math.round(s.ratio * 100) + ')</title>' +
        '</path>';

        // Yeterince bÃ¼yÃ¼k dilimde etiket gÃ¶ster
        if (s.ratio > 0.08) {
            svgContent += '<text class="hm-label" x="' + lx + '" y="' + ly + '">' + s.label + '</text>';
        }

        startAngle = endAngle;
    });

    // Merkez bilgi metni
    const totalCount = data.reduce(function(a, d) { return a + d.count; }, 0);
    svgContent += '<text class="hm-center-text" x="0" y="-6">' + totalCount + '</text>';
    svgContent += '<text class="hm-center-text" x="0" y="8">kayit</text>';

    svg.innerHTML = svgContent;
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// _initVipPanel'a God-Eye v2 baÅŸlatÄ±cÄ±sÄ±nÄ± ekle
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const _prevInitVipForGodEye = window._initVipPanel;
window._initVipPanel = function() {
    if (_prevInitVipForGodEye) _prevInitVipForGodEye();
    // KÄ±sa gecikme ile radar dot click eventlerini baÄŸla
    setTimeout(function() {
        _initRadarDotClickEvents();
    }, 400);
};

