/**
 * ═══════════════════════════════════════════════════════════════════
 *  SYSTEM-TIPS v1.0.0 — Contextual Tip System
 * ═══════════════════════════════════════════════════════════════════
 *
 *  Sekme bazlı, kapatılabilir mini-ipucu sistemi.
 *  Kullanıcı bir ipucunu kapattığında, localStorage'a kaydedilir
 *  ve o ipucu bir daha asla gösterilmez.
 *
 *  POZİSYON: Bottom-Left (FAB bottom-center, Launchpad bottom-right ile çakışmaz)
 *  Z-INDEX:  8500 (FAB: 9000 altında, Modaller: 9500+ altında)
 *  SINGLETON: Ekranda aynı anda maksimum 1 ipucu kutusu.
 *
 *  [WHY]: Kullanıcılar modüllerin kullanımını öğrenmek için
 *         bağlamsal ipuçlarına ihtiyaç duyar. Bu sistem, her
 *         sekme için spesifik, yararlı ipuçları sunar.
 *  [HOW]: switchTab() her çağrıldığında TipManager.showTipForTab(tabName)
 *         tetiklenir. TipManager, dismissedTips listesinde olmayan
 *         sekmelere ait ipucunu gösterir.
 * ═══════════════════════════════════════════════════════════════════
 */

// ─────────────────────────────────────────────────────────────
// 1. SEKME → İPUCU EŞLEŞTİRME TABLOSU
// ─────────────────────────────────────────────────────────────
const SystemTips = {
    // ── DEPOLAR ──────────────────────────────────────────────
    b1: 'Tabloda birden fazla satır seçerek sol alttaki menüden toplu işlem yapabilirsiniz. Arama ve sıralama ile hızlıca ürün bulabilirsiniz.',
    b2: 'B2 Deposu için de aynı şekilde satır seçimi ve toplu işlem desteklenir. Filtreleri kullanarak stok durumunu daraltabilirsiniz.',

    // ── ÇIKIŞ KAYITLARI ─────────────────────────────────────
    b3: 'Çıkış kayıtları burada listelenir. Demirbaş çıkışları otomatik olarak işaretlenir ve takip edilir.',

    // ── PERSONEL ────────────────────────────────────────────
    personel: 'Personel listesini yönetebilir, yeni personel ekleyebilir veya mevcut kayıtları düzenleyebilirsiniz.',

    // ── BİRİM YÖNETİMİ ──────────────────────────────────────
    unitsTab: 'Birim tanımlamalarını buradan yönetebilirsiniz. Her birim bir veya daha fazla personeli kapsar.',

    // ── TALEPLER ────────────────────────────────────────────
    requests: 'Gelen talepleri buradan onaylayabilir veya reddedebilirsiniz. Onay süreci otomatik olarak ilerletilir.',
    myRequests: 'Kendi taleplerinizi oluşturabilir, takip edebilir ve iade işlemleri yapabilirsiniz.',

    // ── ONAYLAR ─────────────────────────────────────────────
    myApprovals: 'Onay bekleyen talepleri buradan hızlıca yönetebilirsiniz. Bekleyen onaylarınız üst menüde bildirim olarak da görünür.',

    // ── KİŞİ ENVANTERİ ──────────────────────────────────────
    personnelInventoryTab: 'Size zimmetlenmiş tüm ürünleri burada görebilirsiniz. Detay butonuyla ürün geçmişini inceleyebilirsiniz.',

    // ── GEÇMİŞ ─────────────────────────────────────────────
    history: 'Tüm işlem geçmişi kronolojik olarak burada listelenir. Tarih ve personel bazlı filtreleme yapabilirsiniz.',

    // ── GÖREVLERİM ─────────────────────────────────────────
    myTasksTab: 'Size atanmış görevleri buradan takip edebilirsiniz. Tamamlanan görevler otomatik işaretlenir.',

    // ── SATIN ALMA (EBYS) ───────────────────────────────────
    purchaseTab: 'Satın alma talepleri ve elektronik belge yönetimi (EBYS) işlemleri burada yapılır.',

    // ── ADMIN PANEL ─────────────────────────────────────────
    'dashboard-content': 'Yönetici panelinden genel istatistiklere, stok özetlerine ve sistem ayarlarına ulaşabilirsiniz.',
    adminPanel: 'Yönetici panelinden genel istatistiklere, stok özetlerine ve sistem ayarlarına ulaşabilirsiniz.',

    // ── ADMIN: ÜRÜN TİPLERİ ────────────────────────────────
    productTypeSettings: 'Ürün türlerini ve kategorilerini buradan tanımlayabilirsiniz. Yeni türler ekleyerek envanter sınıflandırmasını genişletebilirsiniz.',

    // ── ADMIN: İŞ AKIŞI ŞABLONLARI ─────────────────────────
    workflowTemplatesTab: 'Talep iş akışı şablonlarını buradan oluşturabilir ve düzenleyebilirsiniz. Her şablon, onay adımlarını belirler.',

    // ── ADMIN: TANIMLAR ────────────────────────────────────
    definitionsTab: 'Mahal, ürün ve birim tanımlarını sistem genelinden yönetebilirsiniz.',

    // ── ADMIN: GÖREVLER ────────────────────────────────────
    todoTab: 'Sistem görevlerini buradan atayabilir ve takip edebilirsiniz. Görev durumları gerçek zamanlı güncellenir.',

    // ── ADMIN: ZİMMET YÖNETİMİ ─────────────────────────────
    inventoryManagementTab: 'Tüm zimmet işlemlerini merkezden yönetebilirsiniz. Personel zimmetleri, iadeler ve geçmiş kayıtlar burada.',

    // ── ADMIN: SİSTEM KONTROL ──────────────────────────────
    systemControlTab: 'Sistem ayarları, yedekleme ve bakım işlemleri buradan yapılır.',

    // ── ADMIN: TANIMLAR (ALT SEKMELER) ─────────────────────
    mahal: 'Mahal (lokasyon) tanımlarını buradan ekleyip düzenleyebilirsiniz. Her mahal bir fiziksel konumu temsil eder.',
    products: 'Ürün türü ve kategori tanımlamalarını buradan yönetebilirsiniz. Envanter sınıflandırmasını genişletmek için yeni türler ekleyin.',
    units: 'Kurumsal birim tanımlarını buradan yapabilirsiniz. Her birim personel atamaları için referans noktasıdır.',
    workflows: 'İş akışı şablonlarını buradan oluşturun. Her şablon, talebin onay sürecindeki adımları belirler.',
};


// ─────────────────────────────────────────────────────────────
// 2. TIPMANAGER SINIFI (SINGLETON)
// ─────────────────────────────────────────────────────────────
class TipManager {

    // ── SINGLETON GUARD ──────────────────────────────────────
    //  [WHY]: Hızlı sekme geçişlerinde birden fazla instance
    //         oluşmasını engellemek için static property kullanılır.
    //  [HOW]: new TipManager() her çağrıldığında mevcut instance
    //         döndürülür. Ekranda aynı anda sadece 1 DOM element
    //         kalması garanti altına alınır.
    static _instance = null;

    static getInstance() {
        if (!TipManager._instance) {
            TipManager._instance = new TipManager();
        }
        return TipManager._instance;
    }

    constructor() {
        if (TipManager._instance) {
            return TipManager._instance;
        }

        // ── CONFIG ───────────────────────────────────────────
        this.STORAGE_KEY = 'dismissedTips';
        this.Z_INDEX = 8500;         // FAB(9000) altında, Modal(9500+) altında
        this.SHOW_DELAY = 600;       // ms — sekme geçişinden sonra bekleme
        this.AUTO_DISMISS = 8000;    // ms — kullanıcı kapatmazsa otomatik kapanma
        this._hideTimer = null;
        this._currentTipId = null;

        // ── INJECT STYLES (bir kez) ─────────────────────────
        this._injectStyles();

        // ── Singleton flag ───────────────────────────────────
        TipManager._instance = this;
    }


    // ─────────────────────────────────────────────────────────
    //  2a. DISMISSED TIPS — localStorage YÖNETİMİ
    // ─────────────────────────────────────────────────────────
    _getDismissed() {
        try {
            const raw = localStorage.getItem(this.STORAGE_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch {
            return [];
        }
    }

    _isDismissed(tipId) {
        return this._getDismissed().includes(tipId);
    }

    _dismiss(tipId) {
        const list = this._getDismissed();
        if (!list.includes(tipId)) {
            list.push(tipId);
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(list));
        }
    }


    // ─────────────────────────────────────────────────────────
    //  2b. DOM — MEVCUT İPUCUNU TEMİZLE
    // ─────────────────────────────────────────────────────────
    _destroyCurrent() {
        // Timer'ı temizle
        if (this._hideTimer) {
            clearTimeout(this._hideTimer);
            this._hideTimer = null;
        }

        // Mevcut DOM elementi kaldır
        const existing = document.getElementById('system-tip-box');
        if (existing) {
            existing.classList.remove('tip-enter');
            existing.classList.add('tip-exit');
            // Animasyon bitince DOM'dan kaldır (sıfır çakışma riski)
            existing.addEventListener('animationend', () => {
                existing.remove();
            }, { once: true });
            // Fallback: animasyon desteklenmeyen tarayıcılar için
            setTimeout(() => {
                if (existing.parentNode) existing.remove();
            }, 400);
        }

        this._currentTipId = null;
    }


    // ─────────────────────────────────────────────────────────
    //  2c. PUBLIC API — SEKME İÇİN İPUCU GÖSTER
    // ─────────────────────────────────────────────────────────
    showTipForTab(tabName) {
        // Tip metni yoksa sessizce çık
        const message = SystemTips[tabName];
        if (!message) return;

        // Sistem ipuçları global olarak kapatılmışsa çık
        if (localStorage.getItem('systemTipsDisabled') === 'true') return;

        // Daha önce kapatılmışsa gösterme
        if (this._isDismissed(tabName)) return;

        // Aynı sekme zaten gösteriliyorsa tekrar tetikleme
        if (this._currentTipId === tabName) return;

        // Önceki ipucunu temizle (singleton garanti: ekranda max 1)
        this._destroyCurrent();

        // Kısa gecikme — sekme render'ının tamamlanması için
        setTimeout(() => {
            this._render(tabName, message);
        }, this.SHOW_DELAY);
    }


    // ─────────────────────────────────────────────────────────
    //  2d. RENDER — İPUCU KUTUSU OLUŞTUR
    // ─────────────────────────────────────────────────────────
    _render(tipId, message) {
        // Render sırasında kullanıcı çok hızlı gezinmiş olabilir,
        // tekrar kontrol
        if (this._currentTipId && this._currentTipId !== tipId) {
            return;
        }

        this._currentTipId = tipId;

        // ── CONTAINER ────────────────────────────────────────
        const box = document.createElement('div');
        box.id = 'system-tip-box';
        box.setAttribute('role', 'status');
        box.setAttribute('aria-live', 'polite');
        box.className = 'system-tip-box tip-enter';

        box.innerHTML = `
            <div class="system-tip-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
                    <line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
            </div>
            <div class="system-tip-body">
                <span class="system-tip-text">${escapeHtml(message)}</span>
            </div>
            <button class="system-tip-close" title="Bu ipucunu bir daha gösterme" aria-label="İpucunu kapat">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
            </button>
        `;

        // ── KAPATMA BUTONU ───────────────────────────────────
        const closeBtn = box.querySelector('.system-tip-close');
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this._dismiss(tipId);
            this._destroyCurrent();
        });

        // ── DOM'A EKLE ──────────────────────────────────────
        document.body.appendChild(box);

        // ── OTOMATİK KAPANMA ─────────────────────────────────
        this._hideTimer = setTimeout(() => {
            this._destroyCurrent();
        }, this.AUTO_DISMISS);
    }


    // ─────────────────────────────────────────────────────────
    //  2e. STYLES — SINGLETON GUARD İLE BİR KEZ ENJEKSİYON
    // ─────────────────────────────────────────────────────────
    _injectStyles() {
        if (document.getElementById('system-tip-styles')) return;

        const style = document.createElement('style');
        style.id = 'system-tip-styles';
        style.textContent = `
            /* ═══════════════════════════════════════════
               SYSTEM TIP — Glassmorphism Box
               Z-Index: 8500
               Position: Bottom-Left (FAB ve Launchpad ile çakışmaz)
               ═══════════════════════════════════════════ */
            .system-tip-box {
                position: fixed;
                bottom: 24px;
                left: 24px;
                z-index: 8500;
                display: flex;
                align-items: flex-start;
                gap: 12px;
                max-width: 420px;
                min-width: 280px;
                padding: 14px 16px;
                border-radius: 14px;
                background: var(--color-surface, rgba(255, 255, 255, 0.72));
                backdrop-filter: blur(16px) saturate(1.6);
                -webkit-backdrop-filter: blur(16px) saturate(1.6);
                border: 1px solid var(--color-border-light, rgba(255, 255, 255, 0.25));
                box-shadow:
                    0 8px 32px rgba(0, 0, 0, 0.10),
                    0 2px 8px rgba(0, 0, 0, 0.06),
                    inset 0 1px 0 rgba(255, 255, 255, 0.15);
                color: var(--color-text, #1e293b);
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                font-size: 13.5px;
                line-height: 1.55;
                cursor: default;
                user-select: none;
                transition: opacity 0.3s ease, transform 0.3s ease;
            }

            /* Dark mode uyumu */
            .dark .system-tip-box,
            [data-theme="dark"] .system-tip-box {
                background: var(--color-surface, rgba(30, 41, 59, 0.78));
                border-color: var(--color-border-light, rgba(255, 255, 255, 0.08));
                box-shadow:
                    0 8px 32px rgba(0, 0, 0, 0.35),
                    0 2px 8px rgba(0, 0, 0, 0.20),
                    inset 0 1px 0 rgba(255, 255, 255, 0.06);
                color: var(--color-text, #e2e8f0);
            }

            /* ── ICON ─────────────────────────────────────── */
            .system-tip-icon {
                flex-shrink: 0;
                display: flex;
                align-items: center;
                justify-content: center;
                width: 30px;
                height: 30px;
                border-radius: 8px;
                background: var(--color-primary, #0ea5e9);
                color: #fff;
                margin-top: 1px;
            }

            /* ── BODY ─────────────────────────────────────── */
            .system-tip-body {
                flex: 1;
                min-width: 0;
            }

            .system-tip-text {
                display: block;
                word-wrap: break-word;
                overflow-wrap: break-word;
            }

            /* ── CLOSE BUTTON ─────────────────────────────── */
            .system-tip-close {
                flex-shrink: 0;
                display: flex;
                align-items: center;
                justify-content: center;
                width: 26px;
                height: 26px;
                border: none;
                border-radius: 6px;
                background: transparent;
                color: var(--color-text-muted, #94a3b8);
                cursor: pointer;
                padding: 0;
                transition: background 0.15s ease, color 0.15s ease;
            }

            .system-tip-close:hover {
                background: rgba(0, 0, 0, 0.08);
                color: var(--color-text, #1e293b);
            }

            .dark .system-tip-close:hover,
            [data-theme="dark"] .system-tip-close:hover {
                background: rgba(255, 255, 255, 0.08);
                color: var(--color-text, #e2e8f0);
            }

            /* ── ANIMATIONS ───────────────────────────────── */

            /* Giriş: Sağdan kayarak + hafif bounce */
            @keyframes tipSlideIn {
                0% {
                    opacity: 0;
                    transform: translateX(-40px) scale(0.95);
                }
                60% {
                    opacity: 1;
                    transform: translateX(6px) scale(1.01);
                }
                80% {
                    transform: translateX(-3px) scale(1.0);
                }
                100% {
                    opacity: 1;
                    transform: translateX(0) scale(1);
                }
            }

            /* Çıkış: Sola kayarak + fade */
            @keyframes tipSlideOut {
                0% {
                    opacity: 1;
                    transform: translateX(0) scale(1);
                }
                100% {
                    opacity: 0;
                    transform: translateX(-30px) scale(0.95);
                }
            }

            .tip-enter {
                animation: tipSlideIn 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
            }

            .tip-exit {
                animation: tipSlideOut 0.3s ease-in forwards;
                pointer-events: none;
            }

            /* ── RESPONSIVE ───────────────────────────────── */
            @media (max-width: 480px) {
                .system-tip-box {
                    left: 12px;
                    right: 12px;
                    bottom: 16px;
                    max-width: none;
                    min-width: 0;
                    font-size: 13px;
                    padding: 12px 14px;
                    border-radius: 12px;
                }
            }

            /* TV / Büyük Ekran Optimizasyonu */
            @media (min-width: 1920px) {
                .system-tip-box {
                    font-size: 16px;
                    padding: 18px 22px;
                    max-width: 500px;
                    bottom: 32px;
                    left: 32px;
                }
            }
        `;

        document.head.appendChild(style);
    }
}


// ─────────────────────────────────────────────────────────────
// 3. GLOBAL EXPORT — Singleton instance
// ─────────────────────────────────────────────────────────────
window.TipManager = TipManager.getInstance();

window.toggleSystemTips = function() {
    const currentState = localStorage.getItem('systemTipsDisabled');
    if (currentState === 'true') {
        localStorage.setItem('systemTipsDisabled', 'false');
        if (typeof showAppAlert === 'function') showAppAlert("Sistem ipuçları aktif edildi.", "success");
    } else {
        localStorage.setItem('systemTipsDisabled', 'true');
        if (typeof showAppAlert === 'function') showAppAlert("Sistem ipuçları kapatıldı.", "info");
        // Ekranda açık tip varsa kapat
        const instance = window.TipManager;
        if (instance) instance._destroyCurrent();
    }
    if (typeof window.updateActionButtonsState === 'function') window.updateActionButtonsState();
};

