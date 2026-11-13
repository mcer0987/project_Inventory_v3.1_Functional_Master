/**
 * script.js — Medipol Envanter Takip Sistemi
 * ==========================================
 * v3.1 ESM Modüler Mimari — Clean Monolith (Legacy Support)
 *
 * [WHY]: script.js'deki tüm taşınabilir veri, tablo, kimlik doğrulama ve UI mantığı
 *        ilgili ESM modüllerine taşınmış ve bu monolith dosyası küçültülmüştür.
 * [HOW]: Tüm göç ettirilen fonksiyonlar için rollback/fallback köprüleri (bridge)
 *        tanımlanmış ve local state ile config ayarları muhafaza edilmiştir.
 */

(function () {
    const isMainPage = window.location.pathname.includes('index.html') || window.location.pathname === '/' || window.location.pathname.endsWith('/');
    if (isMainPage) {
        sessionStorage.removeItem('adminVizesi');
    }
})();

// Global Konfigürasyon ve Değişkenler
const TZ = 'Europe/Istanbul';
let currentSortColumn = 'lastUpdate';
let isAscending = false;
let currentPage = 1;
let currentExitRepo = "";
let currentExitIndex = "-1";
const pageSize = 25;
window.isAdminPanel = false;

if (!window.data) {
    window.data = { b1: [], b2: [], b3: [], manualExits: [], personel: [], requests: [], productTypes: [], purchaseOrders: [], serviceRecords: [] };
}
window.isFirebaseLoaded = window.isFirebaseLoaded || false;

// ─── Faz 5 · K3 · AppModules.AdminTabs (5.7 · ARC-07) ──────────────────────────────────────────────
// [WHY]: admin.html'de 3 ayrı dosya (admin-system-control.js, inventory-management.js, edm-workflow.js) kendi
//        "sekme gösterildiğinde çalış" ihtiyacı için window.showAdminTab'ı ayrı ayrı sarmalıyordu (zincirleme
//        monkey-patch); her biri kendi setTimeout/retry döngüsünü taşıyordu — yükleme sırası değişirse (ör.
//        admin-dashboard.js henüz tanımlanmadan bir sarmalayıcı çalışırsa) zincirin bir halkası sessizce kaybolabilirdi.
// [HOW]: Tek, merkezi kanca sicili. script.js klasik (modül olmayan) bir dosya olarak admin.html'de en erken
//        yüklenenlerden biridir — admin-main.js'in ESM zinciri (admin-dashboard.js, inventory-management.js,
//        edm-workflow.js) ve admin-system-control.js gibi geç yüklenen klasik dosyalar her zaman bu sicili hazır
//        bulur, ayrıca retry/polling gerekmez. showAdminTab'ın TEK kanonik tanımı (admin-dashboard.js) kendi işini
//        bitirince dispatch(tabId) çağırır; başka HİÇBİR dosya showAdminTab'ı sarmalamaz/değiştirmez.
window.AppModules = window.AppModules || {};
(function () {
    const perTab = new Map();   // tabId -> fn[]
    const anyTab = [];          // fn[] — her sekme değişiminde (tabId ne olursa olsun) çalışır
    function onShow(tabId, fn) {
        if (typeof fn !== 'function') return;
        if (!perTab.has(tabId)) perTab.set(tabId, []);
        perTab.get(tabId).push(fn);
    }
    function onAny(fn) { if (typeof fn === 'function') anyTab.push(fn); }
    function dispatch(tabId) {
        anyTab.forEach(fn => { try { fn(tabId); } catch (e) { console.error('[AdminTabs] onAny kanca hatası:', e); } });
        (perTab.get(tabId) || []).forEach(fn => { try { fn(tabId); } catch (e) { console.error(`[AdminTabs] onShow('${tabId}') kanca hatası:`, e); } });
    }
    window.AppModules.AdminTabs = { onShow, onAny, dispatch };
})();

// Global currentUser ilklendirme
window.currentUser = window.getActiveUser();

// [R-SYS] - Internal Data Input Mask Manager
// Native password alanları tarayıcının kendi maskelemesini kullanır. Özel madde işareti tamponu
// seçip üzerine yazma sırasında eski parolanın ilk karakterini koruyabiliyordu.
window._dx = {
    _b: {},
    _native: new Set(),
    _s: (id, opts = {}) => {
        const el = document.getElementById(id);
        if (!el) return;
        window._dx._b[id] = "";
        el.value = "";
        if (el.type === 'password') {
            window._dx._native.add(id);
            el.setAttribute('autocomplete', 'off');
            el.setAttribute('autocorrect', 'off');
            el.setAttribute('spellcheck', 'false');
            return;
        }
        const _handler = (e) => {
            const v = el.value;
            const l = v.length;
            const bl = window._dx._b[id].length;
            if (l > bl) {
                window._dx._b[id] += v.substring(bl);
            } else {
                window._dx._b[id] = window._dx._b[id].substring(0, l);
            }
            el.value = "•".repeat(window._dx._b[id].length);
        };
        el.addEventListener('input', _handler);
        if (!opts.allowPaste) el.addEventListener('paste', (e) => e.preventDefault());
        if (!opts.allowPaste) el.addEventListener('contextmenu', (e) => e.preventDefault());
        el.setAttribute('autocomplete', 'off');
        el.setAttribute('autocorrect', 'off');
        el.setAttribute('spellcheck', 'false');
    },
    _g: (id) => window._dx._native.has(id) ? (document.getElementById(id)?.value || "") : (window._dx._b[id] || ""),
    _r: (id) => {
        window._dx._b[id] = "";
        const el = document.getElementById(id);
        if (el) el.value = "";
    }
};

const INV_CONFIG = {
    locations: {
        b1: {
            columns: ["B1 -A", "B1 -B", "B1 -C", "B1-D"],
            shelves: ["Raf-A 1", "Raf-A 2", "Raf-A 3", "Raf-A 4", "Raf-A 5", "Raf-A 6",
                "Raf-B 1", "Raf-B 2", "Raf-B 3", "Raf-B 4", "Raf-B 5", "Raf-B 6",
                "Raf-C 1", "Raf-C 2", "Raf-C 3", "Raf-C 4", "Raf-C 5", "Raf-C 6",
                "Raf-D 1", "Raf-D 2", "Raf-D 3", "Raf-D 4", "Raf-D 5", "Raf-D 6",
                "Raf-E 1", "Raf-E 2", "Raf-E 3", "Raf-E 4", "Raf-E 5", "Raf-E 6",
                "Raf-F 1", "Raf-F 2", "Raf-F 3", "Raf-F 4", "Raf-F 5", "Raf-F 6",
                "Raf-G 1", "Raf-G 2", "Raf-G 3", "Raf-G 4", "Raf-G 5", "Raf-G 6",
                "Raf-H 1", "Raf-H 2", "Raf-H 3", "Raf-H 4", "Raf-H 5", "Raf-H 6",
                "Raf-I 1", "Raf-I 2", "Raf-I 3", "Raf-I 4", "Raf-I 5", "Raf-I 6",
                "Raf-J 1", "Raf-J 2", "Raf-J 3", "Raf-J 4", "Raf-J 5", "Raf-J 6",
                "Raf-K 1", "Raf-K 2", "Raf-K 3", "Raf-K 4", "Raf-K 5", "Raf-K 6",
                "Raf-L 1", "Raf-L 2", "Raf-L 3", "Raf-L 4", "Raf-L 5", "Raf-L 6",
            ]
        },
        b2: {
            columns: ["Saha-1", "Saha-2"],
            shelves: ["Zemin", "Raf-1", "Raf-2"]
        }
    },
    defaultTypes: [
        { name: "Laptop", isDemirbas: true },
        { name: "Monitör", isDemirbas: true },
        { name: "Mini PC", isDemirbas: true },
        { name: "Yazıcı", isDemirbas: true },
        { name: "OEM - Toplama Kasa", isDemirbas: true },
        { name: "Klavye / Mouse", isDemirbas: false },
        { name: "Diğer Çevre Birimleri", isDemirbas: false },
        { name: "Sarf Malzeme", isDemirbas: false },
    ],
    transferTargets: [
        { name: "B1 Depo", type: "internal", key: "b1" },
        { name: "B2 Depo", type: "internal", key: "b2" },
        { name: "Kavacık Kampüs", type: "external" },
        { name: "Haliç Kampüs", type: "external" },
        { name: "Göztepe Kampüs", type: "external" },
        { name: "Teknik Servis", type: "service" },
        { name: "Hurda / Atık", type: "scrap" }
    ]
};

// 🕐 TÜRKİYE SAAT YARDIMCILARI (Fallback bridges)
window.getTurkiyeSaati = window.getTurkiyeSaati || function () {
    return window.AppModules?.Utils?.getTurkiyeSaati ? window.AppModules.Utils.getTurkiyeSaati() : new Date().toLocaleString('tr-TR', { timeZone: TZ });
};
window.getTurkiyeTarihi = window.getTurkiyeTarihi || function () {
    return window.AppModules?.Utils?.getTurkiyeTarihi ? window.AppModules.Utils.getTurkiyeTarihi() : new Date().toLocaleDateString('tr-TR', { timeZone: TZ });
};
window.tsToTurkiye = window.tsToTurkiye || function (timestamp) {
    return window.AppModules?.Utils?.tsToTurkiye ? window.AppModules.Utils.tsToTurkiye(timestamp) : new Date(timestamp).toLocaleString('tr-TR', { timeZone: TZ });
};

// 🔐 KİMLİK DOĞRULAMA (Fallback bridges)
window.checkIsAdmin = window.checkIsAdmin || function () {
    return window.AppModules?.Auth?.checkIsAdmin ? window.AppModules.Auth.checkIsAdmin() : false;
};
window.validateAdminAction = window.validateAdminAction || function () {
    return window.AppModules?.Auth?.validateAdminAction ? window.AppModules.Auth.validateAdminAction() : false;
};
window.setupUI = window.setupUI || function () {
    if (window.AppModules?.Auth?.setupUI) window.AppModules.Auth.setupUI();
};
window.updateNavbarUI = window.updateNavbarUI || function (user) {
    if (window.AppModules?.Auth?.updateNavbarUI) window.AppModules.Auth.updateNavbarUI(user);
};
window.handleLogin = window.handleLogin || function (event) {
    if (window.AppModules?.Auth?.handleLogin) window.AppModules.Auth.handleLogin(event);
};
window.checkAdminAndGo = window.checkAdminAndGo || function () {
    if (window.AppModules?.Auth?.checkAdminAndGo) window.AppModules.Auth.checkAdminAndGo();
};

// 📦 TABLO VE ARAMA MOTORU (Fallback bridges)
window.getProcessedData = window.getProcessedData || function (depo) {
    return window.AppModules?.Table?.getProcessedData ? window.AppModules.Table.getProcessedData(depo) : [];
};
window.sortTable = window.sortTable || function (columnName, depo) {
    if (window.AppModules?.Table?.sortTable) window.AppModules.Table.sortTable(columnName, depo);
};
window.changePage = window.changePage || function (depo, page) {
    if (window.AppModules?.Table?.changePage) window.AppModules.Table.changePage(depo, page);
};
window.renderTable = window.renderTable || function (depo) {
    if (window.AppModules?.Table?.renderTable) window.AppModules.Table.renderTable(depo);
};
window.searchTable = window.searchTable || function (depo) {
    if (window.AppModules?.Table?.searchTable) window.AppModules.Table.searchTable(depo);
};
window.renderSearchResults = window.renderSearchResults || function (depo, results) {
    if (window.AppModules?.Table?.renderSearchResults) window.AppModules.Table.renderSearchResults(depo, results);
};
window.renderCardSearchResults = window.renderCardSearchResults || function (depo, results) {
    if (window.AppModules?.Table?.renderCardSearchResults) window.AppModules.Table.renderCardSearchResults(depo, results);
};
window.toggleCardView = window.toggleCardView || function (depo) {
    if (window.AppModules?.Table?.toggleCardView) window.AppModules.Table.toggleCardView(depo);
};
window._toggleCardGroup = window._toggleCardGroup || function (bodyId, iconId) {
    if (window.AppModules?.Table?._toggleCardGroup) window.AppModules.Table._toggleCardGroup(bodyId, iconId);
};
window.renderMobileCards = window.renderMobileCards || function (depo) {
    if (window.AppModules?.Table?.renderMobileCards) window.AppModules.Table.renderMobileCards(depo);
};
window.patchDOMForCollection = window.patchDOMForCollection || function (colName, changes) {
    if (window.AppModules?.Table?.patchDOMForCollection) return window.AppModules.Table.patchDOMForCollection(colName, changes);
};
window.showRowTooltip = window.showRowTooltip || function (event, updateDate) {
    if (window.AppModules?.Table?.showRowTooltip) window.AppModules.Table.showRowTooltip(event, updateDate);
};
window.moveRowTooltip = window.moveRowTooltip || function (event) {
    if (window.AppModules?.Table?.moveRowTooltip) window.AppModules.Table.moveRowTooltip(event);
};
window.hideRowTooltip = window.hideRowTooltip || function () {
    if (window.AppModules?.Table?.hideRowTooltip) window.AppModules.Table.hideRowTooltip();
};
window.showMobileTooltip = window.showMobileTooltip || function (event, updateDate) {
    if (window.AppModules?.Table?.showMobileTooltip) window.AppModules.Table.showMobileTooltip(event, updateDate);
};

// ⚙️ ENVANTER İŞ MANTIĞI (Fallback bridges)
window.addExit = window.addExit || async function () {
    if (window.AppModules?.Inventory?.addExit) return await window.AppModules.Inventory.addExit();
};
window.saveExit = window.saveExit || async function (event) {
    if (window.AppModules?.Inventory?.saveExit) return await window.AppModules.Inventory.saveExit(event);
};
window.updateStock = window.updateStock || async function (depo, index, delta) {
    if (window.AppModules?.Inventory?.updateStock) return await window.AppModules.Inventory.updateStock(depo, index, delta);
};
window.deleteItem = window.deleteItem || async function (depo, index) {
    if (window.AppModules?.Inventory?.deleteItem) return await window.AppModules.Inventory.deleteItem(depo, index);
};
window.bulkDelete = window.bulkDelete || async function (depo) {
    if (window.AppModules?.Inventory?.bulkDelete) return await window.AppModules.Inventory.bulkDelete(depo);
};
window.saveProduct = window.saveProduct || function (e) {
    if (window.AppModules?.Inventory?.saveProduct) window.AppModules.Inventory.saveProduct(e);
};
window.toggleWatch = window.toggleWatch || async function (depo, index) {
    if (window.AppModules?.Inventory?.toggleWatch) return await window.AppModules.Inventory.toggleWatch(depo, index);
};
window.receiveProduct = window.receiveProduct || async function (index) {
    if (window.AppModules?.Inventory?.receiveProduct) return await window.AppModules.Inventory.receiveProduct(index);
};
window.deleteB3Row = window.deleteB3Row || async function (index) {
    if (window.AppModules?.Inventory?.deleteB3Row) return await window.AppModules.Inventory.deleteB3Row(index);
};
window.toggleSelectAll = window.toggleSelectAll || function (depo) {
    if (window.AppModules?.Inventory?.toggleSelectAll) window.AppModules.Inventory.toggleSelectAll(depo);
};

// 🎨 UI COMPONENTS (Fallback bridges)
window.openProductModal = window.openProductModal || function (mode, indexOrId = null, depoParam = null, useId = false) {
    if (window.AppModules?.UI?.openProductModal) window.AppModules.UI.openProductModal(mode, indexOrId, depoParam, useId);
};
window.openTransferModal = window.openTransferModal || function (repoName, index) {
    if (window.AppModules?.UI?.openTransferModal) window.AppModules.UI.openTransferModal(repoName, index);
};
window.handleTransferTargetChange = window.handleTransferTargetChange || function (selectParams) {
    if (window.AppModules?.UI?.handleTransferTargetChange) window.AppModules.UI.handleTransferTargetChange(selectParams);
};
window.confirmTransfer = window.confirmTransfer || async function () {
    if (window.AppModules?.UI?.confirmTransfer) return await window.AppModules.UI.confirmTransfer();
};
window.closeTransferModal = window.closeTransferModal || function () {
    if (window.AppModules?.UI?.closeTransferModal) window.AppModules.UI.closeTransferModal();
};
window.openExitModal = window.openExitModal || function (repoName, index) {
    if (window.AppModules?.UI?.openExitModal) window.AppModules.UI.openExitModal(repoName, index);
};
window.closeExitModal = window.closeExitModal || function () {
    if (window.AppModules?.UI?.closeExitModal) window.AppModules.UI.closeExitModal();
};
window.openRequestModal = window.openRequestModal || function (isEdit = false) {
    if (window.AppModules?.UI?.openRequestModal) window.AppModules.UI.openRequestModal(isEdit);
};
window.closeRequestModal = window.closeRequestModal || function () {
    if (window.AppModules?.UI?.closeRequestModal) window.AppModules.UI.closeRequestModal();
};
window.handleTypeChange = window.handleTypeChange || function (selectElement) {
    if (window.AppModules?.UI?.handleTypeChange) window.AppModules.UI.handleTypeChange(selectElement);
};
window.selectProduct = window.selectProduct || function (name, type, shelf, qty, repo, index, id) {
    if (window.AppModules?.UI?.selectProduct) window.AppModules.UI.selectProduct(name, type, shelf, qty, repo, index, id);
};
window.openModal = window.openModal || function (modalId) {
    if (window.AppModules?.UI?.openModal) window.AppModules.UI.openModal(modalId);
};
window.closeModal = window.closeModal || function (modalId) {
    if (window.AppModules?.UI?.closeModal) window.AppModules.UI.closeModal(modalId);
};
window.setupRowSelection = window.setupRowSelection || function (tableContainer) {
    if (window.AppModules?.UI?.setupRowSelection) window.AppModules.UI.setupRowSelection(tableContainer);
};
window.updateFloatingBar = window.updateFloatingBar || function () {
    if (window.AppModules?.UI?.updateFloatingBar) window.AppModules.UI.updateFloatingBar();
};
window.showMobileBottomSheet = window.showMobileBottomSheet || function (itemData) {
    if (window.AppModules?.UI?.showMobileBottomSheet) window.AppModules.UI.showMobileBottomSheet(itemData);
};
window.closeMobileBottomSheet = window.closeMobileBottomSheet || function () {
    if (window.AppModules?.UI?.closeMobileBottomSheet) window.AppModules.UI.closeMobileBottomSheet();
};
document.addEventListener('click', function (event) {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const fab = document.getElementById('floatingActionBar');
    const sheet = document.getElementById('mobileBottomSheet');
    const overlay = document.getElementById('mobileBottomSheetOverlay');
    const fabOpen = fab?.classList.contains('fab-visible');
    const sheetOpen = sheet?.classList.contains('bs-active');
    if (!fabOpen && !sheetOpen) return;

    if (target.closest('#floatingActionBar, #mobileBottomSheet, .selectable-row, button, a, input, select, textarea, [role="button"], [role="dialog"], .modal')) return;
    if (target === overlay) return;

    if (sheetOpen) window.closeMobileBottomSheet();
    else window.clearRowSelection();
});
window.clearRowSelection = window.clearRowSelection || function () {
    if (window.AppModules?.UI?.clearRowSelection) window.AppModules.UI.clearRowSelection();
};
window._bulkDeleteSelected = window._bulkDeleteSelected || async function (depo, indices) {
    if (window.AppModules?.UI?._bulkDeleteSelected) return await window.AppModules.UI._bulkDeleteSelected(depo, indices);
};

// [BRIDGE] EBYS Workflow Functions - Fallback for ES module timing issues
// These ensure functions are available even if ESM loads after inline handlers
// IMPORTANT: These are stubs that will be overridden by the actual ES module functions
window.viewWorkflow = window.viewWorkflow || function (id) {
    // Stub - actual implementation will override this
    console.warn('[STUB] viewWorkflow called before ESM load - id:', id);
};

window.openTemplateModal = window.openTemplateModal || function (id = null) {
    // Stub - actual implementation will override this
    console.warn('[STUB] openTemplateModal called before ESM load - id:', id);
};

window.startWorkflow = window.startWorkflow || function (id) {
    // Stub - actual implementation will override this
    console.warn('[STUB] startWorkflow called before ESM load - id:', id);
};

// [GUARD] Wait for DOM ready then check for module functions
document.addEventListener('DOMContentLoaded', () => {
    // Small delay to ensure ES modules have loaded
    setTimeout(() => {
        if (typeof window.viewWorkflow !== 'function' || window.viewWorkflow.toString().includes('STUB')) {
            console.warn('[BRIDGE] viewWorkflow not available after module load - check ESM for errors');
        }
        if (typeof window.openTemplateModal !== 'function' || window.openTemplateModal.toString().includes('STUB')) {
            console.warn('[BRIDGE] openTemplateModal not available after module load - check ESM for errors');
        }

        // Faz 6 · UI-01: Operasyon Merkezi'ndeki "Hızlı Envanter Çıkış Masası"ndan gelen tek tık çıkış talebi.
        // [WHY]: #exitModal yalnız bu sayfada var; admin panelindeki buton bayrağı bırakıp buraya yönlendirir.
        try {
            if (sessionStorage.getItem('pendingQuickExit') === '1') {
                sessionStorage.removeItem('pendingQuickExit');
                if (typeof window.openExitModal === 'function') window.openExitModal();
            }
        } catch (e) { /* depolama kapalıysa sorun değil */ }
    }, 500);
});

// ===========================================================================
// MONOLITH KORUNAN ÖZEL İŞ MANTIKLARI VE DETAY YORDAMLAR
// ===========================================================================

window.getActiveProductTypes = function () {
    const firebaseData = (window.data && window.data.productTypes) ? window.data.productTypes : [];
    if (firebaseData.length > 0) return firebaseData;
    if (!window.isFirebaseLoaded) return [];
    return (typeof INV_CONFIG !== 'undefined' && INV_CONFIG.defaultTypes) ? INV_CONFIG.defaultTypes : [];
};

// Tek demirbaş kuralı schema.js'te (3.6): ürün türü tanımı → kayıttaki bayrak → adı bir tür adı mı.
window.checkIsDemirbas = function (item) {
    return window.Schema.isDemirbas(item);
};

// sekme geçişi
window.switchTab = function (tabName) {
    const protectedTabs = ['requests', 'personel', 'unitsTab'];
    if (protectedTabs.includes(tabName)) {
        if (!validateAdminAction()) return;
    }
    document.querySelectorAll('.tab-content, .admin-tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-button, .tab-btn').forEach(el => el.classList.remove('active'));

    const targetTab = document.getElementById(tabName);
    if (targetTab) {
        targetTab.classList.add('active');
        targetTab.classList.remove('tab-enter');
        void targetTab.offsetWidth;
        targetTab.classList.add('tab-enter');
        targetTab.addEventListener('animationend', () => {
            targetTab.classList.remove('tab-enter');
        }, { once: true });
    }

    if (typeof event !== "undefined" && event?.currentTarget?.classList) {
        event.currentTarget.classList.add('active');
    }

    switch (tabName) {
        case 'personel':
            if (typeof renderPersonelTable === 'function') renderPersonelTable();
            break;
        case 'b1':
        case 'b2':
            if (typeof renderTable === 'function') renderTable(tabName);
            break;
        case 'b3':
            if (typeof renderExitTable === 'function') renderExitTable();
            break;
        case 'manualExitTab':
            if (window.manualExitsModule) window.manualExitsModule.render();
            break;
        case 'unitsTab':
            if (typeof renderUnitManagement === 'function') renderUnitManagement();
            break;
        case 'requests':
            if (typeof renderRequestsTable === 'function') renderRequestsTable();
            break;
        case 'adminPanel':
            setTimeout(() => {
                if (typeof renderDashboard === 'function') {
                    renderDashboard();
                    setTimeout(() => { window.dispatchEvent(new Event('resize')); }, 50);
                }
            }, 100);
            break;
        case 'purchaseTab':
            if (typeof renderPurchaseModule === 'function') renderPurchaseModule();
            break;
        case 'myRequests':
            if (typeof renderMyRequestsTable === 'function') renderMyRequestsTable();
            break;
        case 'personnelInventoryTab':
            if (typeof renderPersonnelInventoryTable === 'function') renderPersonnelInventoryTable();
            break;
        case 'myApprovals':
            if (typeof renderMyApprovals === 'function') renderMyApprovals();
            break;
        case 'history':
            if (typeof renderHistory === 'function') renderHistory();
            break;
        case 'myTasksTab':
            if (typeof renderMyTasksTab === 'function') renderMyTasksTab();
            break;
        default:
            if (typeof renderTable === 'function') renderTable(tabName);
            break;
    }
};

// Personel işlemleri (monolith'te bırakıldı)
// [WHY]: Düzenleme dizi indeksiyle yapılıyor ve kaydı {name, code} ile değiştiriyordu (id ve diğer alanlar kayboluyordu,
//        doküman silinip yeniden oluşuyordu); ekleme/düzenleme tüm veritabanını yazıyordu (ITSM-07, DATA-04, DATA-06).
// [HOW]: Kişi id ile bulunur; düzenleme yalnız adı günceller (updateItem), ekleme tek doküman (appendItem, makeId).
// [WHY]: Faz 4B · J10 — giriş Firebase Auth ile; düz metin kod personel kaydında TUTULMAZ (kurallar yeniden yazılmasını reddeder).
//        PRI revizyonu: personel giriş ekranında kurumsal kimliğini (PRI, ör. ayse.yilmaz) yazar; hesap e-postası <pri>@….
// [HOW]: Yeni personel: PRI addan üretilir (ad.soyad, çakışmada numara; yönetici değiştirebilir), kod üretilir → kayıt (kodsuz,
//        PRI'li) → aynı kodla <pri>@ hesabı → PRI ve kod yöneticiye BİR KEZ gösterilir (personele iletilir). Düzenleme: ad, birim
//        ve — hesap açılmamışsa — PRI (hesap açıldıktan sonra PRI e-postadır; istemciden değiştirilemez). Hesabı olmayan
//        personel: tablodan "Hesap Aç" yeni kodla. Kod sıfırlama istemciden yapılamaz — yönetici betiği gerekir.
function _fillUnitSelect(select, current) {
    if (!select) return;
    while (select.firstChild) select.removeChild(select.firstChild);
    select.appendChild(new Option('— Birim seçin —', ''));
    const names = [...new Set((window.data.units || []).map(u => String((u && (u.name || u.ad)) || '').trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'tr'));
    if (current && !names.includes(current)) names.unshift(current);
    names.forEach(n => select.appendChild(new Option(n, n)));
    select.value = current || '';
}

// Kod bir kez gösterilir; onay penceresi kapanana kadar ekranda kalır (bildirim balonu gibi kaybolmaz).
window.showStaffCodeOnce = async function (name, code, accountText, pri) {
    const msg = `${name} için giriş bilgileri:\n\n` + (pri ? `    Kurumsal kimlik: ${pri}\n` : '') + `    Giriş kodu: ${code}\n\n` +
        'Bu bilgileri personele iletin. Kod sistemde SAKLANMAZ; bu pencere kapandıktan sonra bir daha gösterilemez.' +
        (accountText ? `\n\n${accountText}` : '');
    if (typeof showCustomConfirm === 'function') await showCustomConfirm('Giriş Kodu', msg, { confirmText: 'Kodu aldım' });
    else window.alert(msg);
};

// Ad yazıldıkça PRI önerisi güncellenir; yönetici PRI kutusunu elle değiştirdiyse dokunulmaz.
function _bindPriSuggestion(nameInput, priInput, exceptId) {
    priInput.dataset.manual = '';
    priInput.oninput = () => { priInput.dataset.manual = '1'; };
    nameInput.oninput = () => {
        if (priInput.readOnly || priInput.dataset.manual) return;
        priInput.value = window.StaffProvisioning.generateStaffPri(nameInput.value, window.StaffProvisioning.takenPris(window.data.personel, exceptId));
    };
}

window.openPersonelModal = function (mode, id = null) {
    const modal = document.getElementById('personelModal');
    const title = document.getElementById('personelModalTitle');
    const nameInput = document.getElementById('personelName');
    const priInput = document.getElementById('personelPri');
    const priHint = document.getElementById('personelPriHint');
    const codeInput = document.getElementById('personelCode');
    const codeRow = document.getElementById('personelCodeRow');
    const codeHint = document.getElementById('personelCodeHint');
    const unitSelect = document.getElementById('personelUnit');
    const form = document.getElementById('personelForm');
    if (!modal) return;
    const SP = window.StaffProvisioning;
    title.innerText = mode === 'add' ? 'Yeni Personel Ekle' : 'Personel Düzenle';

    if (mode === 'edit' && id !== null) {
        const p = (window.data.personel || []).find(x => String(x.id) === String(id));
        if (!p) { showAppAlert('Personel bulunamadı; liste güncellenmiş olabilir.', 'error'); return; }
        nameInput.value = p.name;
        _fillUnitSelect(unitSelect, p.birim || '');
        if (priInput) {
            priInput.value = p.pri || SP.generateStaffPri(p.name, SP.takenPris(window.data.personel, p.id));
            priInput.readOnly = !!p.uid;   // hesap açıksa PRI hesabın e-postasıdır
            if (priHint) priHint.textContent = p.uid ? 'Giriş hesabı açık: kurumsal kimlik değiştirilemez.' : 'Personel bu kimlikle girer. Hesap açılana kadar değiştirilebilir.';
            _bindPriSuggestion(nameInput, priInput, p.id);
            if (p.pri) priInput.dataset.manual = '1';   // kayıtlı PRI ad değişince kendiliğinden değişmesin
        }
        if (codeRow) codeRow.style.display = 'none';
        if (codeHint) codeHint.style.display = 'none';
        codeInput.value = '';
        form.onsubmit = function (e) {
            e.preventDefault();
            editPersonel(p.id);
        };
    } else {
        form.reset();
        _fillUnitSelect(unitSelect, '');
        if (priInput) {
            priInput.readOnly = false;
            priInput.value = '';
            if (priHint) priHint.textContent = 'Addan üretilir (ad.soyad); isterseniz değiştirin. Personel bu kimlikle girer.';
            _bindPriSuggestion(nameInput, priInput, null);
        }
        if (codeRow) codeRow.style.display = '';
        if (codeHint) codeHint.style.display = '';
        codeInput.readOnly = false;
        codeInput.value = getRandomCode();
        form.onsubmit = function (e) {
            e.preventDefault();
            addPersonel();
        };
    }
    window.AppModules.EBYSDefinitionsUI.openPersonnel(mode === 'edit'
        ? (window.data.personel || []).find(p => String(p.id) === String(id)) : null);
    modal.style.display = 'block';
};

async function addPersonel() {
    if (!window.requireDbAdmin('Personel ekleme')) return;   // Faz 4 · J1: personel yalnız admin
    const SP = window.StaffProvisioning;
    const name = document.getElementById('personelName').value.trim();
    const code = document.getElementById('personelCode').value.trim();
    const birim = (document.getElementById('personelUnit')?.value || '').trim();
    if (!name) { showAppAlert('Ad Soyad boş olamaz.', 'warning'); return; }
    const priRaw = (document.getElementById('personelPri')?.value || '').trim() || SP.generateStaffPri(name, SP.takenPris(window.data.personel));
    const pri = SP.validatePri(priRaw, window.data.personel);
    if (!pri.ok) { showAppAlert(pri.message, 'warning'); return; }
    // J10: kod yalnız biçim olarak denetlenir (≥4, boşluksuz) — giriş PRI ile yapıldığı için kodların tekil olması gerekmez
    const check = window.StaffCodeRegistry.validateCode(code, []);
    if (!check.ok) { showAppAlert(check.message, 'warning'); return; }
    const person = { id: window.makeId(), name, pri: pri.value, ...(birim ? { birim } : {}) };
    try { Object.assign(person, await window.AppModules.EBYSDefinitions.savePersonnel(person, window.AppModules.EBYSDefinitionsUI.readPersonnel(), true)); }
    catch (error) { showAppAlert(error.message, 'error'); return; }
    if (typeof renderPersonelTable === 'function') renderPersonelTable();
    closePersonelModal();
    const acct = await SP.provisionWithNotice(person, code);
    // Bağlama düştüyse hesap BU kodla açıldı: kod yine bir kez gösterilir ("Hesap Aç" + aynı kod yeniden bağlar)
    if (acct.ok || acct.linkFailed) await window.showStaffCodeOnce(name, code, 'Personel eklendi. ' + acct.text, person.pri);
    else showAppAlert(`Personel eklendi. ${acct.text} Tablodan "Hesap Aç" ile tekrar deneyin.`, 'warning');
}

async function editPersonel(id) {
    if (!window.requireDbAdmin('Personel düzenleme')) return;
    const SP = window.StaffProvisioning;
    const p = (window.data.personel || []).find(x => String(x.id) === String(id));
    if (!p) { showAppAlert('Personel bulunamadı; liste güncellenmiş olabilir.', 'error'); return; }
    const name = document.getElementById('personelName').value.trim();
    const birim = (document.getElementById('personelUnit')?.value || '').trim();
    if (!name) { showAppAlert('Ad Soyad boş olamaz.', 'warning'); return; }
    const patch = { name, birim };
    if (!p.uid) {   // hesap açıksa PRI değişmez (e-posta istemciden değiştirilemez)
        const pri = SP.validatePri(document.getElementById('personelPri')?.value || '', window.data.personel, p.id);
        if (!pri.ok) { showAppAlert(pri.message, 'warning'); return; }
        if (pri.value !== p.pri) patch.pri = pri.value;
    }
    try { await window.AppModules.EBYSDefinitions.savePersonnel({ ...p, ...patch }, window.AppModules.EBYSDefinitionsUI.readPersonnel()); }
    catch (error) { showAppAlert(error.message, 'error'); return; }
    if (typeof renderPersonelTable === 'function') renderPersonelTable();
    closePersonelModal();
    showAppAlert('Personel güncellendi.', 'success');
}

// J10: hesabı olmayan personele (J7 öncesi kayıt ya da hesap açılamamış yeni kayıt) yeni kodla giriş hesabı. PRI yoksa önce üretilir.
window.openPersonelAccount = async function (id) {
    if (!window.requireDbAdmin('Giriş hesabı açma')) return;
    const SP = window.StaffProvisioning;
    const p = (window.data.personel || []).find(x => String(x.id) === String(id));
    if (!p) { showAppAlert('Personel bulunamadı; liste güncellenmiş olabilir.', 'error'); return; }
    if (p.uid) { showAppAlert('Bu personelin giriş hesabı zaten var.', 'info'); return; }
    const existing = SP.validatePri(p.pri || '', window.data.personel, p.id);
    const pri = existing.ok ? existing.value : SP.generateStaffPri(p.name, SP.takenPris(window.data.personel, p.id));
    // Önerilen yeni kod; önceki denemede hesap açılıp bağlanamadıysa yönetici o denemede gösterilen kodu yazar (aynı hesap bağlanır).
    const entered = window.prompt(`"${p.name || '-'}" için "${pri}" kurumsal kimliğiyle giriş hesabı açılacak.\n\nGiriş kodu (önerilen yeni kod; daha önce "bağlanamadı" uyarısıyla bir kod gösterildiyse O KODU yazın):`, getRandomCode());
    if (entered === null) return;
    const code = String(entered).trim();
    const check = window.StaffCodeRegistry.validateCode(code, []);
    if (!check.ok) { showAppAlert(check.message, 'warning'); return; }
    if (pri !== p.pri && !(await window.writeOk(window.updateItem('personel', p.id, { pri })))) { showAppAlert('Kurumsal kimlik kaydedilemedi.', 'error'); return; }
    const acct = await SP.provisionWithNotice({ ...p, pri }, code);
    if (acct.ok || acct.linkFailed) { await window.showStaffCodeOnce(p.name || '-', code, acct.text, pri); if (typeof renderPersonelTable === 'function') renderPersonelTable(); }
    else showAppAlert(acct.text, 'warning');
};

function closePersonelModal() {
    const modal = document.getElementById('personelModal');
    if (modal) modal.style.display = 'none';
}

// Okunaklı, 5 karakterlik kod önerisi (J7.5). J10: kodlar saklanmadığı için listede yalnız temizlenmemiş eski kodlar kalabilir.
function getRandomCode() {
    if (window.StaffCodeRegistry) return window.StaffCodeRegistry.suggestCode(window.data.personel || []);
    return Math.random().toString(36).substring(2, 7);
}

// 🔷 Gelen Talepler (Admin & MyRequests)
window.renderRequestsTable = function () {
    const tbody = document.querySelector('#tableRequests tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    // B-4: personelin gönderilmemiş taslakları yönetici listesinde gösterilmez; yalnız sayıları bilgi satırında.
    const all = window.data.requests || [];
    const visible = all.filter(r => !_isDraftRequest(r));
    const draftNote = document.getElementById('requestsDraftNote');
    if (draftNote) {
        const drafts = all.length - visible.length;
        draftNote.textContent = drafts ? `Personelin gönderilmemiş ${drafts} taslak talebi var (listelenmez; gönderildiğinde burada görünür).` : '';
        draftNote.hidden = drafts === 0;
    }
    if (visible.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;">Henüz bekleyen talep bulunmuyor.</td></tr>';
        return;
    }
    visible.forEach((req, index) => {
        const row = tbody.insertRow();
        const rawDurum = (req.durum || '').trim().toUpperCase();
        const isApproved = rawDurum === 'APPROVED' || rawDurum === 'ONAYLANDI';
        const isRejected = rawDurum === 'REJECTED' || rawDurum === 'REDDEDİLDİ';
        const isCompleted = rawDurum === 'COMPLETED' || rawDurum === 'TESLİM ALINDI' || rawDurum === 'TESLIM ALINDI';
        const isPending = rawDurum === 'BEKLEMEDE' || rawDurum === 'BEKLİYOR' || rawDurum === 'BEKLIYOR' || rawDurum === '';

        const statusClass = isPending ? 'status-pending-pill' :
            (isApproved ? 'status-approved-pill' :
                (isRejected ? 'status-rejected-pill' :
                    (isCompleted ? 'status-completed-pill' : 'status-pending-pill')));
        const statusText = isPending ? 'Bekliyor' :
            (isApproved ? 'Onaylandı' :
                (isRejected ? 'Reddedildi' :
                    (isCompleted ? 'Teslim Alındı' : req.durum || 'Bilinmiyor')));

        row.innerHTML = `
            <td style="text-align:center;"><input type="checkbox" class="req-checkbox" value="${escapeHtml(req.id)}"></td>
            <td>${escapeHtml(req.tarih || "-")}</td>
            <td>${escapeHtml(req.personel || "-")}</td>
            <td>${escapeHtml(req.ürün || "-")} <strong>(${escapeHtml(req.adet || 1)} Adet)</strong></td>
            <td style="color:#7f8c8d;">${escapeHtml(req.not || "-")}</td>
            <td style="font-weight:bold; color:#2c3e50;">${escapeHtml(req.sn || "-")}</td>
            <td style="text-align:center;"><span class="status-badge-pill ${statusClass}">${escapeHtml(statusText)}</span>${isRejected && req.redGerekcesi ? `<div class="req-reject-reason">${escapeHtml(req.redGerekcesi)}</div>` : ''}</td>
            <td style="text-align:center;">
                ${isPending ? `
                    <button onclick="confirmRequest(${jsArg(req.id)})" class="req-approve-btn">Onayla</button>
                    <button onclick="rejectRequest(${jsArg(req.id)})" class="req-reject-btn">Reddet</button>
                ` : `<span class="req-done-text">${isCompleted ? 'Teslim Alındı' : 'İşlem Yapıldı'}</span>`}
            </td>
        `;
    });
};

function renderMyRequestsTable() {
    const tbody = document.querySelector('#tableMyRequests tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const currentUser = window.getActiveUser();
    if (!currentUser) return;

    // Sahiplik zimmet servisinden (3.7): personelId → eski talepte kod → Türkçe güvenli ad.
    const myReqs = window.data.requests.filter(r =>
        window.AssignmentService.isMyRequest(r, currentUser)
    );

    if (myReqs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Henüz bir talebiniz bulunmuyor.</td></tr>';
        return;
    }

    myReqs.forEach((req) => {
        const rid = jsArg(req.id); // DATA-06: işlemler talep id'siyle
        const row = tbody.insertRow();
        const rawDurum = (req.durum || '').trim().toUpperCase();
        const isApproved = rawDurum === 'APPROVED' || rawDurum === 'ONAYLANDI';
        const isRejected = rawDurum === 'REJECTED' || rawDurum === 'REDDEDİLDİ';
        const isCompleted = rawDurum === 'COMPLETED' || rawDurum === 'TESLİM ALINDI' || rawDurum === 'TESLIM ALINDI';
        const isDraft = rawDurum === 'DRAFT' || rawDurum === 'TASLAK';
        const isPending = rawDurum === 'BEKLEMEDE' || rawDurum === 'BEKLİYOR' || rawDurum === 'BEKLIYOR' || rawDurum === '';

        let statusHTML = '';
        if (isPending) statusHTML = `<div class="status-badge-pill status-pending-pill">ONAY BEKLİYOR</div>`;
        else if (isApproved) statusHTML = `<div class="status-badge-pill status-approved-pill">ONAYLANDI</div>`;
        else if (isRejected) statusHTML = `<div class="status-badge-pill status-rejected-pill">REDDEDİLDİ</div>${req.redGerekcesi ? `<div class="req-reject-reason"><strong>Gerekçe:</strong> ${escapeHtml(req.redGerekcesi)}</div>` : ''}`;
        else if (isCompleted) statusHTML = `<div class="status-badge-pill status-completed-pill">TESLİM ALINDI</div>`;
        else if (isDraft) statusHTML = `<div class="status-badge-pill" style="background:#f1f5f9; color:#475569; border:1px solid #cbd5e1;">TASLAK</div>`;
        else statusHTML = `<div class="status-badge-pill status-pending-pill">${escapeHtml(req.durum || '-')}</div>`;
        // Faz 2 (B-1): onaylanan sarf talebi tüketim çıkışıdır — personele envanterine eklenmeyeceği söylenir.
        if ((isApproved || isCompleted) && (window.data.b3 || []).some(b => String(b.requestId) === String(req.id) && window.Schema.normalizeB3(b).tip === 'cikis')) {
            statusHTML += '<div class="req-outcome-note">Tüketim çıkışı — envanterinize eklenmez</div>';
        }

        row.innerHTML = `
            <td>${escapeHtml(req.tarih)}</td>
            <td>
                <strong>${escapeHtml(req.ürün)}</strong><br>
                <small style="color: #666; font-weight: bold;">Miktar: ${escapeHtml(req.adet || 1)} Adet</small>
            </td>
            <td style="text-align: center; vertical-align: middle;">${statusHTML}</td>
            <td style="text-align: center; vertical-align: middle;">${escapeHtml(req.teslimTarihi || '-')}</td>
            <td style="text-align: center; vertical-align: middle;">
                ${isCompleted ?
                `<div class="status-badge-pill status-completed-pill" style="min-width: 120px; justify-content: center; margin: 0 auto;">Teslim Alındı</div>` :
                isApproved ?
                    `<button class="save-btn" onclick="receiveProduct(${rid})" style="background-color: var(--color-primary); cursor: pointer; min-width: 120px;">Teslim Aldım</button>` :
                    isDraft ?
                        `<div class="d-flex gap-1" style="justify-content: center;">
                        <button class="edit-btn" onclick="window.editPersonnelInventoryRequest(${rid})" style="padding: 5px 10px; font-size: 11px;">Düzenle</button>
                        <button class="save-btn" onclick="window.sendDraftInventoryRequest(${rid})" style="padding: 5px 10px; font-size: 11px; background: #10b981;">Gönder</button>
                     </div>` :
                        isRejected ?
                            `<div class="status-badge-pill status-rejected-pill" style="min-width: 120px; justify-content: center; margin: 0 auto;">Talep Reddedildi</div>` :
                            `<button class="delete-btn" onclick="window.withdrawInventoryRequest(${rid})" style="background-color: #fca5a5; color: #7f1d1d; min-width: 120px; font-size: 11px;">Talebi Geri Çek</button>`
            }
            </td>
        `;
    });
}

window.renderPersonnelInventoryTable = function () {
    const tbody = document.querySelector('#tablePersonnelInventory tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    const currentUser = window.getActiveUser();
    if (!currentUser) return;

    // [WHY]: Yalnız teslim alınmış talepler taranıyordu; admin'in "Zimmet Yap" ile verdiği zimmetler hiç görünmüyor, iade
    //        edilenler listede kalıyordu (ITSM-04, saha notu 29.09 #1).
    // [HOW] (3.7): Zimmet servisi — admin Zimmet ekranıyla aynı liste; kullanıcının aktif ve teslim alınmış zimmetleri.
    // Faz 3 (B-3): onaylanıp henüz teslim alınmamış kalemler de listenin başında "Teslim Bekliyor" rozetiyle görünür (zimmet
    // tutanağına girmez); varsa üstte Taleplerim'e yönlendiren bilgi satırı çıkar.
    const A = window.AssignmentService;
    const toRow = a => ({
        tarih: a.teslimTarihi || a.tarih,
        ürün: a.urun,
        sn: a.sn,
        envanterNo: a.envanterNo,
        adet: a.adet,
        isDemirbas: a.isDemirbas,
        not: a.not,
        state: A.assignmentState(a),
        asg: a,   // Faz 5: "İade Talebi" düğmesi (ReturnRequests.staffActionCell)
    });
    const awaiting = A.getPendingDeliveries(currentUser).map(toRow);
    const myInventory = [...awaiting, ...A.getPersonInventory(currentUser).map(toRow)];
    const note = document.getElementById('personnelAwaitingNote');
    if (note) {
        note.hidden = awaiting.length === 0;
        const text = note.querySelector('[data-role="text"]');
        if (text) text.textContent = `Onaylanan ${awaiting.length} kalem teslim almanızı bekliyor. Teslim aldığınızda "Taleplerim" ekranında "Teslim Aldım" deyin; kalem zimmetinize ve tutanağınıza o zaman geçer.`;
    }
    if (myInventory.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding: 24px; color: var(--color-text-muted);">Üzerinize kayıtlı envanter bulunmamaktadır.</td></tr>';
        return;
    }

    myInventory.forEach((req) => {
        const row = tbody.insertRow();
        const isDem = req.isDemirbas === true || req.isDemirbas === "true";
        const typeText = isDem ? 'Demirbaş' : 'Sarf Malzeme';
        const typeBadgeStyle = isDem
            ? 'background: var(--color-purple-light); color: var(--color-purple); border: 1px solid rgba(167, 139, 250, 0.2);'
            : 'background: var(--color-info-light); color: var(--color-info); border: 1px solid rgba(96, 165, 250, 0.2);';

        row.innerHTML = `
            <td>${escapeHtml(req.tarih || "-")}</td>
            <td><strong>${escapeHtml(req.ürün || "-")}</strong></td>
            <td style="font-weight:bold; color: var(--color-text);">${escapeHtml(req.sn || "-")}${req.envanterNo && req.envanterNo !== '-' ? `<div style="font-weight:normal; font-size:11px; color:var(--color-text-muted);">Env. No: ${escapeHtml(req.envanterNo)}</div>` : ''}</td>
            <td>${escapeHtml(req.adet || 1)} Adet</td>
            <td><span class="status-badge-pill" style="min-width: 100px; padding: 6px 12px; font-size: 11px; ${typeBadgeStyle}">${typeText}</span></td>
            <td>${A.stateBadgeHtml(req.state) /* xss-ok: sabit durum anahtarı ve etiketi (AssignmentService.STATE_LABELS) */}</td>
            <td style="color: var(--color-text-muted);">${escapeHtml(req.not || "-")}</td>
        `;
        if (req.state === 'teslimBekliyor') row.classList.add('zim-row-awaiting');
        row.append(window.ReturnRequests ? window.ReturnRequests.staffActionCell(req.asg) : document.createElement('td'));
    });
    if (window.ReturnRequests) window.ReturnRequests.renderMine();
};

// [WHY]: Admin talep işlemleri dizi indeksiyle çalışıyordu; snapshot sonrası yanlış talep hedefleniyordu. Tablo yenilenmediği için
//        ikinci tık ikinci onay + ikinci b3 kaydı yazıyordu; SN sorusunda İptal yine onaylıyordu; red/sil tüm DB'yi yazıyordu (ITSM-05).
// [HOW]: Talepler id ile bulunur; yalnız bekleyen (taslak olmayan) talep onaylanır/reddedilir; talep başına işlem kilidi;
//        İptal gerçekten iptaldir; onaylayan ve zaman kaydedilir; yalnız ilgili koleksiyonlar yazılır; tablolar yenilenir.
const _requestActionsInFlight = new Set();
const _findRequest = ref => (window.data.requests || []).find(r => String(r.id) === String(ref));
const _isPendingRequest = r => {
    const d = String(r.durum || '').trim().toUpperCase();
    return ['', 'BEKLEMEDE', 'BEKLİYOR', 'BEKLIYOR', 'PENDING'].includes(d);
};
const _refreshRequestTables = () => {
    ['renderRequestsTable', 'renderMyRequestsTable', 'renderAdminRequestTable', 'renderPersonnelInventoryTable']
        .forEach(fn => { if (typeof window[fn] === 'function') window[fn](); });
};
// [WHY]: B-6 · Talebe bağlı hareket kaydı (b3) zaten varken onay zimmeti tekrar yazmıyor ama stoğu YİNE düşüyordu.
// [HOW]: Bu tutarsız durumda onay hiç yazmadan durur ve uyarır; yönetici kaydı Envanter Takibi'nde kontrol eder.
function _stopIfLinkedMovement(req) {
    if (!(window.data.b3 || []).some(b => String(b.requestId) === String(req.id))) return false;
    showAppAlert('Bu talebe bağlı bir hareket kaydı zaten var; onay yapılmadı ve stok düşülmedi. Envanter Takibi\'nde kaydı kontrol edin.', 'warning');
    _refreshRequestTables();
    return true;
}

// Talep taslak mı (personel henüz göndermedi / geri çekti) — yönetici listelerinde gösterilmez (B-4).
function _isDraftRequest(r) { return ['DRAFT', 'TASLAK'].includes(String((r && r.durum) || '').trim().toUpperCase()); }
window.isDraftRequest = _isDraftRequest;

// [WHY]: B-2 · Red gerekçesi sorulmuyordu; personel talebinin neden reddedildiğini göremiyordu. B-5 · Red, talebin yerel
//        kopyasının tamamını yazıyordu (saveData); aynı anda yapılan bir düzenleme ezilebilirdi.
// [HOW]: Zorunlu gerekçe penceresi (hazır seçenek + açıklama; "Diğer"de açıklama zorunlu; ≤1000 karakter, etiket benzeri metin
//        yok). Yalnız durum alanları updateItem ile yazılır. Pencere DOM'la kurulur, kayıt verisi textContent ile yazılır.
const REJECT_REASONS = Object.freeze(['Stokta yok', 'Bütçe uygun değil', 'Mükerrer talep', 'Bilgi eksik', 'Diğer']);
const REJECT_MAX = 1000;
window.REQUEST_REJECT_REASONS = REJECT_REASONS;

// Seçim + açıklama → { reason } | { error }. Saf; testten de çağrılır.
window.composeRejectReason = function (preset, text, presets = REJECT_REASONS) {
    const p = String(preset || '').trim(), t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!presets.includes(p)) return { error: 'Bir red gerekçesi seçin.' };
    if (p === 'Diğer' && !t) return { error: '"Diğer" seçildiğinde açıklama zorunludur.' };
    const reason = p === 'Diğer' ? t : (t ? `${p} — ${t}` : p);
    if (reason.length > REJECT_MAX) return { error: `Gerekçe en fazla ${REJECT_MAX} karakter olabilir.` };
    if (/<[a-zA-Z\/!?]/.test(reason)) return { error: 'Gerekçede "<" ile başlayan etiket benzeri ifade kullanılamaz.' };
    return { reason };
};

// Red gerekçesi penceresi → gerekçe metni | null (Vazgeç / Esc)
// opts (Faz 5 · iade talebi reddi de kullanır): { title, summary, help, presets, okText }
window.showRequestRejectModal = function (request, opts = {}) {
    const presets = opts.presets || REJECT_REASONS;
    return new Promise(resolve => {
        const el = (tag, props = {}, children = []) => {
            const n = Object.assign(document.createElement(tag), props);
            children.forEach(c => c && n.append(c));
            return n;
        };
        const lastFocus = document.activeElement;
        const overlay = el('div', { id: 'requestRejectModal', className: 'req-modal-overlay' });
        const titleId = 'requestRejectTitle';
        const dialog = el('div', { className: 'req-modal' });
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-labelledby', titleId);

        const options = el('div', { className: 'req-reject-options' });
        options.setAttribute('role', 'radiogroup');
        options.setAttribute('aria-label', 'Red gerekçesi');
        presets.forEach((label, i) => {
            const input = el('input', { type: 'radio', name: 'reqRejectPreset', value: label, id: `reqRejectPreset${i}` });
            options.append(el('label', { className: 'req-reject-option', htmlFor: input.id }, [input, el('span', { textContent: label })]));
        });
        const text = el('textarea', { id: 'reqRejectText', rows: 3, maxLength: REJECT_MAX, placeholder: 'Açıklama (isteğe bağlı; "Diğer" seçildiyse zorunlu)' });
        const counter = el('small', { className: 'req-reject-counter', textContent: `0 / ${REJECT_MAX}` });
        const error = el('div', { className: 'req-modal-error', hidden: true });
        error.setAttribute('role', 'alert');
        const cancel = el('button', { type: 'button', className: 'req-modal-btn', textContent: 'Vazgeç' });
        const ok = el('button', { type: 'button', className: 'req-modal-btn danger', id: 'reqRejectOk', textContent: opts.okText || 'Talebi Reddet' });

        dialog.append(
            el('h3', { id: titleId, textContent: opts.title || 'Talebi Reddet' }),
            el('p', { className: 'req-modal-summary', textContent: opts.summary || `${request.personel || '-'} · ${request.ürün || '-'} · ${Number(request.adet) || 1} adet` }),
            el('p', { className: 'req-modal-help', textContent: opts.help || 'Gerekçe, talep sahibine "Taleplerim" ekranında gösterilir.' }),
            options,
            el('label', { className: 'req-modal-label', htmlFor: text.id, textContent: 'Açıklama' }), text, counter,
            error,
            el('div', { className: 'req-modal-actions' }, [cancel, ok]),
        );
        overlay.append(dialog);
        document.body.append(overlay);

        // Esc, odak nerede olursa olsun pencere açıkken çalışır (odak pencereye geçmeden basılsa da).
        const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); close(null); } };
        const close = val => {
            document.removeEventListener('keydown', onKey, true);
            overlay.remove();
            if (lastFocus && lastFocus.focus) lastFocus.focus();
            resolve(val);
        };
        document.addEventListener('keydown', onKey, true);
        text.addEventListener('input', () => { counter.textContent = `${text.value.length} / ${REJECT_MAX}`; });
        cancel.addEventListener('click', () => close(null));
        ok.addEventListener('click', () => {
            const preset = (dialog.querySelector('input[name="reqRejectPreset"]:checked') || {}).value;
            const res = window.composeRejectReason(preset, text.value, presets);
            if (res.error) { error.textContent = res.error; error.hidden = false; return; }
            close(res.reason);
        });
        setTimeout(() => dialog.querySelector('input[name="reqRejectPreset"]')?.focus(), 0);
    });
};

// [WHY]: Talep serbest metin olduğu için onay stoktan hiç düşmüyordu; onaylanan ürün depoda görünmeye devam ediyor,
//        iadesi de "stok bağlantısı yok" diye depoya dönmüyordu (ITSM-08, Karar K7-a).
// [HOW]: Onayda SN ile birlikte B1/B2 stok kalemi seçtirilir; adı talep metniyle birebir eşleşen tek kalem ön seçilir.
//        "Stoktan düşmeden onayla" ancak açıkça seçilirse geçerlidir. İptal → null; aksi halde { sn, source: {repo, productId} | null }.
const _normText = s => String(s || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('tr-TR');
const _stockLabel = p => `${p.marka || ''} ${p.ürün || p.name || ''}`.replace(/\s+/g, ' ').trim();
const _stockQty = p => Number(p.adet ?? p.qty ?? 0) || 0;
const NO_STOCK = '__none__';

// [WHY]: Faz 2 (B-1, karar 05.11.2026) — sarf talebi onaylanınca da zimmet yazılıyordu; tükenen sarf kişinin Kişi Envanteri'nde
//        ve zimmet tutanağında süresiz kalıyordu.
// [HOW]: Onayın hareket türü: stok kalemi seçildiyse ürün türüne göre (Schema.isDemirbas) — sarf → 'cikis', demirbaş →
//        'zimmet'. Stok dışı onayda ürün türü bilinmez; yalnız talep türü "Sarf Malzeme İhtiyacı" ve ad bir demirbaş türü
//        değilse 'cikis', aksi hâlde güvenli taraf 'zimmet'.
window.requestOutcome = function (request, product) {
    if (product) return window.Schema.isDemirbas(product) ? 'zimmet' : 'cikis';
    const sarfTalebi = String((request && request.talepTuru) || '').trim() === 'Sarf Malzeme İhtiyacı';
    return sarfTalebi && !window.Schema.isDemirbas({ ürün: request.ürün, isDemirbas: request.isDemirbas }) ? 'cikis' : 'zimmet';
};

window.showRequestApprovalModal = function (request) {
    return new Promise(resolve => {
        const want = Number(request.adet) || 1;
        const target = _normText(request.ürün);
        const rank = p => {
            const label = _normText(_stockLabel(p)), name = _normText(p.ürün || p.name);
            if (label === target || name === target) return 0;
            if (target && ((label && label.includes(target)) || (name && target.includes(name)))) return 1;
            return 2;
        };
        const candidates = ['b1', 'b2'].flatMap(repo => (window.data[repo] || [])
            .filter(p => _stockQty(p) > 0 && p.durumu !== 'Pasif' && p.status !== 'Pasif' && !window.Schema?.isRowCountLocked?.(p))
            .map(p => ({ repo, p, rank: rank(p), key: `${repo}|${p.id}` })))
            .sort((a, b) => a.rank - b.rank || _stockLabel(a.p).localeCompare(_stockLabel(b.p), 'tr'));
        const exact = candidates.filter(c => c.rank === 0 && _stockQty(c.p) >= want);
        let selected = exact.length === 1 ? exact[0].key : '';

        const overlay = document.createElement('div');
        overlay.id = 'requestApprovalModal';
        overlay.style.cssText = 'position:fixed; inset:0; background:rgba(15,23,42,0.75); display:flex; align-items:center; justify-content:center; z-index:11000;';
        // Renkler tema değişkenlerinden (dark-theme.css [data-theme="dark"] ile uyumlu).
        const field = 'width:100%; box-sizing:border-box; padding:10px; border-radius:8px; border:1px solid var(--color-border,#bdc3c7); background:var(--color-surface-alt,#f8f9fa); color:var(--color-text,#2c3e50); font-size:14px; margin-bottom:12px;';
        overlay.innerHTML = `
          <style>#raSource option:checked { background: linear-gradient(var(--color-primary-light,#dbeafe), var(--color-primary-light,#dbeafe)); color: var(--color-text,#2c3e50); }</style>
          <div style="background:var(--color-surface,#fff); color:var(--color-text,#2c3e50); border:1px solid var(--color-border-light,transparent); padding:24px; border-radius:12px; width:520px; max-width:94vw; font-family:sans-serif;">
            <h3 style="margin:0 0 6px; font-size:1.2rem;">Talebi Onayla</h3>
            <p style="margin:0 0 16px; color:var(--color-text-muted,#7f8c8d); font-size:0.9rem;">${escapeHtml(request.personel || '-')} · <strong>${escapeHtml(request.ürün || '-')}</strong> · ${escapeHtml(want)} adet</p>
            <label style="font-weight:600; font-size:13px;">Stoktan düşülecek kalem</label>
            <input id="raFilter" type="text" placeholder="Ürün, marka veya raf ara..." autocomplete="off" style="${field} margin-bottom:6px;">
            <select id="raSource" size="6" style="${field}"></select>
            <label id="raSnLabel" style="font-weight:600; font-size:13px;">Seri numarası / zimmet bilgisi</label>
            <input id="raSn" type="text" placeholder="Yoksa boş bırakın" autocomplete="off" style="${field}">
            <div id="raDevIds" hidden></div>
            <p id="raOutcome" class="req-outcome-note" role="status"></p>
            <div id="raError" style="display:none; color:var(--color-danger,#e74c3c); font-size:13px; margin-bottom:10px;"></div>
            <div style="display:flex; justify-content:flex-end; gap:10px;">
              <button id="raCancel" type="button" style="padding:10px 18px; border:1px solid var(--color-border,#bdc3c7); background:transparent; color:var(--color-text,#2c3e50); border-radius:8px; cursor:pointer;">Vazgeç</button>
              <button id="raOk" type="button" style="padding:10px 18px; border:none; background:var(--color-success-dark,#16a34a); color:#fff; font-weight:700; border-radius:8px; cursor:pointer;">Onayla</button>
            </div>
          </div>`;
        document.body.appendChild(overlay);

        const sel = overlay.querySelector('#raSource');
        const renderOptions = () => {
            const q = _normText(overlay.querySelector('#raFilter').value);
            const visible = candidates.filter(c => !q || _normText(`${_stockLabel(c.p)} ${c.p.raf || ''} ${c.repo}`).includes(q));
            sel.innerHTML = `<option value="${NO_STOCK}">— Stoktan düşmeden onayla (stok dışı / tedarik edilecek)</option>` +
                visible.map(c => {
                    const qty = _stockQty(c.p);
                    return `<option value="${escapeHtml(c.key)}" ${qty < want ? 'disabled' : ''}>${escapeHtml(c.repo.toUpperCase())} ·${escapeHtml(_stockLabel(c.p))} · Raf ${escapeHtml(c.p.raf || '-')} · Stok: ${escapeHtml(qty)}${qty < want ? ' (yetersiz)' : ''}</option>`;
                }).join('');
            sel.value = selected;
        };
        // 3.9a: seçilen kalem demirbaşsa (stok dışında: talep edilen ad bir demirbaş türüyse) talep adedi kadar cihaz kimliği
        const devBox = overlay.querySelector('#raDevIds');
        const isDemSelection = () => {
            if (!selected) return false;
            if (selected === NO_STOCK) return window.Schema.isDemirbas({ ürün: request.ürün, isDemirbas: request.isDemirbas });
            const c = candidates.find(x => x.key === selected);
            return !!c && window.Schema.isDemirbas(c.p);
        };
        const outcomeEl = overlay.querySelector('#raOutcome');
        const syncDev = () => {
            const dem = isDemSelection();
            overlay.querySelector('#raSn').style.display = dem ? 'none' : '';
            overlay.querySelector('#raSnLabel').style.display = dem ? 'none' : '';
            // v3.6: seçilen stok kaleminin demirbaş no'su 1. cihaz satırına otomatik ve kilitli gelir
            const fixedFrom = selected && selected !== NO_STOCK ? candidates.find(x => x.key === selected) : null;
            if (dem) window.DeviceIds.render(devBox, want, { fixed: window.DeviceIds.fixedFor(fixedFrom && fixedFrom.p) }); else window.DeviceIds.hide(devBox);
            // Faz 2 (B-1): onayın sonucu önceden söylenir — sarf tüketim çıkışıdır, kişinin envanterine girmez.
            const c = selected && selected !== NO_STOCK ? candidates.find(x => x.key === selected) : null;
            const tip = selected ? window.requestOutcome(request, c ? c.p : null) : null;
            outcomeEl.textContent = !tip ? ''
                : tip === 'cikis' ? 'Sonuç: tüketim çıkışı (sarf). Stok düşer; ürün kişinin envanterine ve zimmet tutanağına girmez.'
                : 'Sonuç: zimmet. Personel "Teslim Aldım" dediğinde ürün Kişi Envanteri\'ne geçer.';
            outcomeEl.hidden = !tip;
        };
        renderOptions();
        syncDev();
        overlay.querySelector('#raFilter').addEventListener('input', renderOptions);
        sel.addEventListener('change', () => { selected = sel.value; syncDev(); });

        const close = val => { overlay.remove(); resolve(val); };
        overlay.querySelector('#raCancel').onclick = () => close(null);
        overlay.querySelector('#raOk').onclick = () => {
            if (!selected) {
                const err = overlay.querySelector('#raError');
                err.textContent = 'Stoktan düşülecek kalemi seçin veya "Stoktan düşmeden onayla" seçeneğini işaretleyin.';
                err.style.display = 'block';
                return;
            }
            let sn = overlay.querySelector('#raSn').value.trim() || '-', ids = null;
            const demirbas = isDemSelection();
            if (demirbas) {
                const chk = window.AssignmentService.checkDeviceIds({ demirbas: true, qty: want, ids: window.DeviceIds.read(devBox) });
                if (!chk.ok) {
                    const err = overlay.querySelector('#raError');
                    err.textContent = chk.errors[0];
                    err.style.display = 'block';
                    return;
                }
                ids = chk.ids;
                sn = ids.map(d => d.sn !== '-' ? d.sn : d.envanterNo).join(', ');
            }
            if (selected === NO_STOCK) return close({ sn, ids, demirbas, source: null });
            const [repo, ...rest] = selected.split('|');
            close({ sn, ids, demirbas, source: { repo, productId: rest.join('|') } });
        };
        setTimeout(() => overlay.querySelector(selected ? '#raSn' : '#raFilter')?.focus(), 0);
    });
};

window.confirmRequest = async function (requestId) {
    const lockKey = String(requestId);
    if (_requestActionsInFlight.has(lockKey)) return;
    _requestActionsInFlight.add(lockKey);
    try {
        const request = _findRequest(requestId);
        if (!request) { showAppAlert('Talep bulunamadı; liste güncellenmiş olabilir.', 'error'); return; }
        if (!_isPendingRequest(request)) { showAppAlert('Bu talep zaten işlenmiş veya taslak durumda.', 'warning'); _refreshRequestTables(); return; }

        // [WHY]: Faz 4 · J4 (T6, EBYS-04) — onayın kendi içinde yetki ve self-approval kontrolü yoktu; yalnız index'teki
        //        sarmalayıcı (window üzerinden çağrılırsa) kendi talebini onaylamayı engelliyordu, admin.html'de hiçbir kontrol yoktu.
        // [HOW]: Personelin kendi talebi → engel + 'blocked' (pencere hiç açılmaz). Diğer her durumda yönetici kapısı. Admin'in
        //        kendi talebi → seçimden sonra, yazmadan hemen önce parola yeniden doğrulaması; günlük sonuca göre.
        const selfCtx = rec => ({ kind: 'request', record: rec, refCol: 'requests', type: 'Zimmet/Talep Onayı', item: rec.ürün, qty: Number(rec.adet) || 1 });
        const isSelf = window.Schema.isSelfApproval({ actor: window.getActiveUser() || window.currentUser, record: request, kind: 'request' });
        if (isSelf && !window.isDbAdmin()) { await window.SecurityConfig.guardSelfApproval(selfCtx(request)); return; }
        if (!window.requireDbAdmin('Talep onayı')) return;
        if (_stopIfLinkedMovement(request)) return;   // B-6: pencere hiç açılmaz

        const choice = await window.showRequestApprovalModal(request);
        if (!choice) return;
        const snValue = choice.sn || '-';

        // modal açıkken snapshot gelmiş olabilir: güncel nesne ve durum yeniden kontrol edilir
        const live = _findRequest(requestId);
        if (!live || !_isPendingRequest(live)) { showAppAlert('Talep bu arada değişti; işlem iptal edildi.', 'warning'); _refreshRequestTables(); return; }
        if (_stopIfLinkedMovement(live)) return;   // B-6 (pencere açıkken bu arada yazılmış olabilir)
        const guard = await window.SecurityConfig.guardSelfApproval(selfCtx(live));
        if (!guard.allowed) return;

        // [WHY] (H3 · 3.4): Stok önce ayrı bir transaction'la düşülüyor, talep ve b3 sonra ayrı ayrı yazılıyordu; ara adımlardan
        //        biri başarısız olunca "stok geri al + talebi geri döndür" telafileri de başarısız olabiliyordu.
        // [HOW]: Stok düşümü + talebin onaylanması + b3 zimmet kaydı TEK transaction (runStockOps); stok kalemi seçilmediyse
        //        talep + b3 tek atomik batch (applyItemOps). Telafi gerekmez: ya hepsi ya hiçbiri.
        const qty = Number(live.adet) || 1;
        const repo = choice.source?.repo;
        const product = repo ? (window.data[repo] || []).find(p => String(p.id) === String(choice.source.productId)) : null;
        if (repo && !product) { showAppAlert('Seçilen stok kalemi bulunamadı; liste güncellenmiş olabilir.', 'error'); return; }

        const approver = window.currentUser?.name || 'Yönetici';
        const now = getTurkiyeSaati();
        const writes = [{ op: 'update', col: 'requests', id: live.id, fields: {
            durum: 'approved', sn: snValue, approvedBy: approver, approvedAt: now,
            ...(product ? { stockRepo: repo, stockProductId: product.id } : {})
        } }];
        // Kanonik b3 zimmet kaydı (3.6): stok kalemi seçildiyse tür/raf/depo üründen kopyalanır; seçilmediyse kaynakDepo
        // 'stok-disi' (tabloda Raf No "Stok dışı" — eskiden "TALEP" basılıyordu).
        // Demirbaş (3.9a): cihaz başına bir b3 zimmet kaydı (adet 1, kendi Seri No / Envanter No'su), hepsi aynı transaction'da.
        // (Talebe bağlı kayıt zaten varsa onay yukarıda durdurulur — B-6.)
        // Faz 2 (B-1): sarf onayı tüketim çıkışıdır (tip 'cikis'); talebe bağlı kalır, Kişi Envanteri'ne / tutanağa girmez.
        const tip = window.requestOutcome(live, product);
        const base = {
            tip, requestId: live.id,
            ...(product ? { product, col: repo } : { urunAciklama: live.ürün, isDemirbas: choice.demirbas === true }),
            not: [live.not, `Onaylayan: ${approver}`].filter(s => s && String(s).trim() && s !== '-').join(' · '),
            alanKisi: live.personel,
            personelId: live.personelId || window.AssignmentService?.resolvePersonelId(live.personel),
            tarih: getTurkiyeTarihi(),
            talepTuru: live.talepTuru, oncelik: live.oncelik, iadeTarihi: live.iadeTarihi,
            onaylayan: approver,
        };
        const units = choice.ids ? choice.ids.map(d => ({ adet: 1, sn: d.sn, envanterNo: d.envanterNo })) : [{ adet: qty, sn: snValue }];
        units.forEach(u => writes.push({ op: 'set', col: 'b3', item: window.Schema.buildB3Entry({ ...base, ...u }) }));

        let stockChange = null;
        try {
            if (product) {
                const res = await window.runStockOps({ stock: [{ col: repo, id: product.id, delta: -qty }], writes },
                    { forbiddenMessage: 'Talep onayı (stok düşümü) yalnızca sistem yöneticisi tarafından yapılabilir.' });
                stockChange = res.stock[0];
            } else {
                await window.applyItemOps(writes);
            }
        } catch (e) {
            await window.SecurityConfig.logSelfApproval(guard, false);
            showAppAlert(`Onay kaydedilemedi; hiçbir değişiklik yapılmadı. ${e.message || ''}`, 'error');
            _refreshRequestTables();
            return;
        }
        await window.SecurityConfig.logSelfApproval(guard, true);
        const stockText = stockChange ? ` ${repo.toUpperCase()} stok: ${stockChange.before} → ${stockChange.after}.` : ' Stoktan düşülmedi.';
        const tipText = tip === 'cikis' ? ' Tüketim çıkışı olarak kaydedildi.' : ' Zimmet kaydı oluşturuldu.';
        showAppAlert(`${live.personel} isimli personelin talebi ONAYLANDI.${stockText}${tipText}`, "success");
        _refreshRequestTables();
    } finally {
        _requestActionsInFlight.delete(lockKey);
    }
};

window.rejectRequest = async function (requestId) {
    const lockKey = String(requestId);
    if (_requestActionsInFlight.has(lockKey)) return;
    _requestActionsInFlight.add(lockKey);
    try {
        const request = _findRequest(requestId);
        if (!request) { showAppAlert('Talep bulunamadı; liste güncellenmiş olabilir.', 'error'); return; }
        if (!_isPendingRequest(request)) { showAppAlert('Bu talep zaten işlenmiş veya taslak durumda.', 'warning'); _refreshRequestTables(); return; }
        if (!window.requireDbAdmin('Talep reddi')) return;
        const reason = await window.showRequestRejectModal(request);
        if (reason == null) return;
        const live = _findRequest(requestId);
        if (!live || !_isPendingRequest(live)) { showAppAlert('Talep bu arada değişti; işlem iptal edildi.', 'warning'); _refreshRequestTables(); return; }
        const fields = { durum: 'rejected', rejectedBy: window.currentUser?.name || 'Yönetici', rejectedAt: getTurkiyeSaati(), redGerekcesi: reason };
        if (!(await window.writeOk(window.updateItem('requests', live.id, fields)))) { showAppAlert('Red kaydedilemedi.', 'error'); return; }
        _refreshRequestTables();
        showAppAlert(`${live.personel} talebi reddedildi. Gerekçe personele iletildi.`, "error");
    } finally {
        _requestActionsInFlight.delete(lockKey);
    }
};

window.deleteRequest = async function (requestId) {
    if (!window.requireDbAdmin('Talep silme')) return;   // Faz 4 · J1 (M1): Rules v2'de talep silme yalnız admin
    const request = _findRequest(requestId);
    if (!request) { showAppAlert('Talep bulunamadı; liste güncellenmiş olabilir.', 'error'); return; }
    const onay = await showCustomConfirm("Kaydı Sil", "Bu talep kaydını tamamen silmek istediğinize emin misiniz? Bu işlem geri alınamaz.");
    if (onay !== true) return;
    const remaining = (window.data.requests || []).filter(r => String(r.id) !== String(requestId));
    if (!(await window.writeOk(window.saveData('requests', remaining)))) { showAppAlert('Silme kaydedilemedi.', 'error'); return; }
    _refreshRequestTables();
    showAppAlert("Talep kaydı kalıcı olarak silindi.", "info");
};

// [WHY]: Personelin talep işlemleri dizi indeksiyle çalışıyordu; snapshot sonrası başka bir talebi hedefleyebiliyordu (DATA-06)
//        ve koleksiyonun tamamını yazıyordu. Durum kontrolü yoktu (onaylanmış talep "geri çekilip" taslağa dönebiliyordu).
// [HOW]: Talep id ile bulunur; yalnız kendi talebi ve uygun durumdaysa; yalnız değişen alanlar yazılır (updateItem).
const _myRequest = id => {
    const req = (window.data.requests || []).find(r => String(r.id) === String(id));
    if (!req || !window.AssignmentService.isMyRequest(req, window.getActiveUser())) {
        showAppAlert('Talep bulunamadı; liste güncellenmiş olabilir.', 'error');
        return null;
    }
    return req;
};

window.withdrawInventoryRequest = async function (id) {
    const req = _myRequest(id);
    if (!req) return;
    if (!_isPendingRequest(req)) { showAppAlert('Yalnız onay bekleyen bir talep geri çekilebilir.', 'warning'); renderMyRequestsTable(); return; }
    const onay = await showCustomConfirm("Talebi Geri Çek", `${req.ürün} talebinizi geri çekmek (taslağa almak) istediğinize emin misiniz?`);
    if (onay === true) {
        if (!(await window.writeOk(window.updateItem('requests', req.id, { durum: 'draft' })))) { showAppAlert('Talep geri çekilemedi.', 'error'); return; }
        if (typeof renderMyRequestsTable === 'function') renderMyRequestsTable();
        showAppAlert("Talebiniz geri çekildi ve TASLAK moduna alındı.", "info");
    }
};

window.editPersonnelInventoryRequest = function (id) {
    const req = _myRequest(id);
    if (!req) return;
    window.editingReqIndex = null;
    window.editingReqId = req.id;
    const nameInput = document.getElementById('reqProdName');
    const qtyInput = document.getElementById('reqQty');
    const noteInput = document.getElementById('reqNote');
    if (nameInput) nameInput.value = req.ürün || "";
    if (qtyInput) qtyInput.value = req.adet || 1;
    if (noteInput) noteInput.value = req.not || "";

    const reqType = document.getElementById('reqType');
    const reqPriority = document.getElementById('reqPriority');
    const reqReturnDate = document.getElementById('reqReturnDate');
    if (reqType) reqType.value = req.talepTuru || 'Kalıcı Zimmet';
    if (reqPriority) reqPriority.value = req.oncelik || 'Orta';
    if (reqReturnDate) reqReturnDate.value = req.iadeTarihi || '';

    window.openRequestModal(true);
    if (typeof window.onReqTypeChange === 'function') window.onReqTypeChange();
};

window.sendDraftInventoryRequest = async function (id) {
    const req = _myRequest(id);
    if (!req) return;
    const d = String(req.durum || '').trim().toUpperCase();
    if (d !== 'DRAFT' && d !== 'TASLAK') { showAppAlert('Bu talep taslak değil.', 'warning'); renderMyRequestsTable(); return; }
    if (!(await window.writeOk(window.updateItem('requests', req.id, { durum: 'Beklemede', tarih: getTurkiyeTarihi() })))) { showAppAlert('Talep gönderilemedi.', 'error'); return; }
    if (typeof renderMyRequestsTable === 'function') renderMyRequestsTable();
    showAppAlert("Talebiniz başarıyla onaya gönderildi.", "success");
};

// Diğer monolith tablolar ve form handlers
window.searchForRequest = function () {
    const filter = document.getElementById('reqSearch').value.toLocaleLowerCase('tr-TR');
    const list = document.getElementById('reqProductList');
    if (!list) return;
    if (filter.length < 2) { list.style.display = 'none'; return; }
    list.innerHTML = '';
    const allProducts = [...(window.data.b1 || []), ...(window.data.b2 || [])].filter(item => !window.Schema?.isRowCountLocked?.(item));
    const results = allProducts.filter(item =>
        (item.ürün || "").toLocaleLowerCase('tr-TR').includes(filter) ||
        (item.marka || "").toLocaleLowerCase('tr-TR').includes(filter) ||
        (item.model || "").toLocaleLowerCase('tr-TR').includes(filter) ||
        (item.raf || "").toLocaleLowerCase('tr-TR').includes(filter) ||
        (item.tür || "").toLocaleLowerCase('tr-TR').includes(filter) ||
        (item.açıklama || "").toLocaleLowerCase('tr-TR').includes(filter) ||
        (item.envanterNo || "").toLocaleLowerCase('tr-TR').includes(filter)
    ).slice(0, 8);

    if (results.length > 0) {
        list.style.display = 'block';
        results.forEach(item => {
            const div = document.createElement('div');
            div.style = "padding: 12px; border-bottom: 1px solid #f1f2f6; cursor: pointer; transition: background 0.2s;";
            div.className = "search-item-hover";
            div.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div><strong style="color: #0984e3;">${escapeHtml(item.ürün)}</strong> <span style="font-size: 0.85em; color: #636e72;">${escapeHtml(item.marka || '')}</span></div>
                    <div style="text-align: right;"><span style="display: block; font-size: 0.75em; background: #dfe6e9; padding: 2px 6px; border-radius: 4px;">Raf: ${escapeHtml(item.raf)}</span><small style="color: ${escapeHtml(item.adet > 0 ? '#27ae60' : '#d63031')}">Stok: ${escapeHtml(item.adet)}</small></div>
                </div>`;
            div.onmouseover = () => div.style.backgroundColor = "#f8f9fa";
            div.onmouseout = () => div.style.backgroundColor = "white";
            div.onclick = () => {
                document.getElementById('reqProdName').value = `${item.marka || ''} ${item.ürün}`.trim();
                document.getElementById('reqSearch').value = "";
                list.style.display = 'none';
            };
            list.appendChild(div);
        });
    } else { list.style.display = 'none'; }
};

window.onReqTypeChange = function () {
    const reqType = document.getElementById('reqType');
    const container = document.getElementById('reqReturnDateContainer');
    const reqReturnDate = document.getElementById('reqReturnDate');
    if (!reqType || !container || !reqReturnDate) return;

    if (reqType.value === 'Geçici Zimmet') {
        container.style.display = 'block';
        reqReturnDate.setAttribute('required', 'required');
    } else {
        container.style.display = 'none';
        reqReturnDate.removeAttribute('required');
        reqReturnDate.value = '';
    }
};

// [WHY]: b3'te birden çok şema vardı; tablo, Excel ve PDF'ler farklı alt kümelerini okuyordu (Tur 2.5'te yalnız bu okuyucu
//        yamanmıştı, ürün taşınınca/silinince tür yine boşalıyordu).
// [HOW] (3.6): Tüm okuyucular Schema.normalizeB3'ten okur. normalizeB3Row eski çağıranlar için aynı anahtarları döner.
window.normalizeB3Row = function (item) {
    const n = window.Schema.normalizeB3(item);
    return { raf: n.rafNo, tur: n.urunTuru, urun: n.urunAciklama, sn: n.sn, adet: n.adet, not: n.not, alanKisi: n.alanKisi, tarih: n.tarih };
};

// b3 PDF'i stok tablosu sütunlarıyla (Sütun/Raf/Ürün/Marka/Durum) basılıyordu; çıkış kayıtlarında hepsi "-" çıkıyordu.
function _exportB3PDF() {
    const rows = (window.data.b3 || []).map(item => window.Schema.normalizeB3(item));
    const cell = v => `<td>${escapeHtml(v)}</td>`;
    const html = `<html><head><title>B3 Çıkış Raporu</title><style>
        body { font-family: "Roboto", Arial, sans-serif; margin: 0; padding: 20px; color: #222; }
        table { width: 100%; border-collapse: collapse; font-size: 11px; }
        th, td { border: 1px solid #cfd6dc; padding: 5px 6px; text-align: left; vertical-align: top; }
        th { background: #2c3e50; color: white; font-weight: 600; }
        tr:nth-child(even) { background: #f7f9fb; }
    </style></head><body><div style="font-size:18px; font-weight:bold; margin-bottom:6px;">B3 ENVANTER ÇIKIŞ KAYITLARI</div>
    <div style="font-size:12px; margin-bottom:14px;">Rapor Tarihi: ${escapeHtml(getTurkiyeSaati())}</div>
    <table><thead><tr><th>#</th><th>Raf No</th><th>Ürün Türü</th><th>Ürün Açıklama</th><th>SN</th><th>Envanter No</th><th>Adet</th><th>Not</th><th>Alan Kişi</th><th>Tarih</th><th>Hareket</th></tr></thead><tbody>
    ${rows.map((n, i) => `<tr>${[i + 1, n.rafNo, n.urunTuru, n.urunAciklama, n.sn, n.envanterNo, n.adet, n.not, n.alanKisi, n.tarih, n.tip === 'zimmet' ? 'Zimmet' : 'Çıkış'].map(cell).join('')}</tr>`).join('')}
    </tbody></table></body></html>`;
    const win = window.open('', '', 'width=1400,height=900');
    if (!win) { showAppAlert('Açılır pencere engellendi; PDF için izin verin.', 'warning'); return; }
    win.document.write(html);
    win.document.close();
    setTimeout(() => { win.print(); win.close(); }, 300);
}

// [WHY]: B3 bir depo listesi değil, hareket/zimmet kütüğüdür; mobilde tablo yatay kaydırmayla okunamıyordu.
// [HOW]: renderExitTable() arama süzgecini uygular ve etkin görünüme göre tabloyu ya da gün gruplu kartları çizer.
//        Telefon genişliğinde (≤768px) kart modu otomatik açılır; kullanıcı #viewToggleB3 ile tabloya geçebilir.
window._cardViewActive = window._cardViewActive || {};
const B3_CARD_MQ = window.matchMedia('(max-width: 768px)');

function _b3SearchText(row) {
    return [row.rafNo, row.urunTuru, row.urunAciklama, row.marka, row.sn, row.envanterNo, row.not, row.alanKisi, row.tarih]
        .join(' ').toLocaleLowerCase('tr-TR');
}

function _getB3Rows() {
    const term = (document.getElementById('searchB3')?.value || '').trim().toLocaleLowerCase('tr-TR');
    return (window.data.b3 || []).map(item => ({ item, row: window.Schema.normalizeB3(item) }))
        .filter(({ row }) => !term || _b3SearchText(row).includes(term));
}

function _b3ActionButtons(id) {
    return `<button type="button" class="table-action-btn pdf-btn btn-pdf" title="Zimmet Tutanağı Yazdır" aria-label="Zimmet tutanağı yazdır" onclick="generateZimmetPDF(${jsArg(id)})">
                <i class="fas fa-file-pdf"></i> <span>PDF</span>
            </button>
            <button type="button" class="table-action-btn undo-btn btn-undo" title="Çıkışı Geri Al" aria-label="Çıkışı geri al" onclick="window.showUndoNotice()">
                <i class="fas fa-rotate-left"></i> <span>Geri Al</span>
            </button>
            <button type="button" class="table-action-btn delete-btn btn-delete" title="Kaydı Sil" aria-label="Kaydı sil" onclick="if(validateAdminAction()) deleteB3Row(${jsArg(id)})">
                <i class="fas fa-trash-alt"></i> <span>Sil</span>
            </button>`;
}

function _applyB3ViewState() {
    const active = !!window._cardViewActive.b3;
    const section = document.getElementById('b3');
    const tableWrapper = document.querySelector('#b3 .table-responsive-wrapper');
    const cardContainer = document.getElementById('cardViewB3');
    const toggleBtn = document.getElementById('viewToggleB3');
    if (section) section.classList.toggle('b3-cards-active', active);
    if (tableWrapper) tableWrapper.style.display = active ? 'none' : '';
    if (cardContainer) cardContainer.style.display = active ? 'block' : 'none';
    if (toggleBtn) {
        const label = active ? 'Tablo Görünümüne Geç' : 'Kart Görünümüne Geç';
        toggleBtn.innerHTML = active ? '<i class="fas fa-table"></i>' : '<i class="fas fa-th-large"></i>';
        toggleBtn.title = label;
        toggleBtn.setAttribute('aria-label', label);
        toggleBtn.classList.toggle('view-toggle-active', active);
    }
    const selectAll = document.getElementById('selectAllB3');
    if (selectAll) selectAll.checked = false;
}

function _renderB3Table(rows) {
    const tbody = document.querySelector('#tableB3 tbody');
    if (!tbody) return;
    if (rows.length === 0) {
        const msg = (window.data.b3 || []).length ? 'Aramanızla eşleşen çıkış kaydı yok.' : 'Çıkış kaydı bulunamadı.';
        tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;">${msg}</td></tr>`;
        return;
    }
    tbody.innerHTML = rows.map(({ item, row }) => {
        const isPassive = (item.durumu === 'Pasif' || item.status === 'Pasif');
        const envNo = row.envanterNo !== '-' ? `<div class="b3-env-sub">Env. No: ${escapeHtml(row.envanterNo)}</div>` : '';
        return `<tr class="${isPassive ? 'passive-row' : ''}">
            <td style="text-align:center;"><input type="checkbox" class="row-select b3-row-select" data-id="${escapeHtml(item.id)}" aria-label="Kaydı seç"></td>
            <td${row.stokDisi ? ' style="color:var(--color-text-muted); font-style:italic;"' : ''}>${escapeHtml(row.rafNo)}</td>
            <td>${escapeHtml(row.urunTuru)}</td>
            <td>${escapeHtml(row.urunAciklama)}</td>
            <td><span class="b3-mono">${escapeHtml(row.sn)}</span>${envNo}</td>
            <td>${escapeHtml(row.adet)}</td>
            <td>${escapeHtml(row.not)}</td>
            <td>${escapeHtml(row.alanKisi)}</td>
            <td>${escapeHtml(row.tarih)}</td>
            <td class="action-cell">
                <div class="table-row-actions">${_b3ActionButtons(item.id) /* xss-ok: id jsArg ile kaçırılır, geri kalan sabit */}</div>
            </td>
        </tr>`;
    }).join('');
}

// Tarih "03.11.2026 14:22:11" biçimindedir; gün ve saat ayrılır. Tarih yoksa kaydın zaman damgası kullanılır.
function _b3DayParts(row) {
    let raw = row.tarih !== '-' ? row.tarih : (row.ts ? tsToTurkiye(row.ts) : '');
    raw = String(raw || '').replace(',', '').trim();
    const [day = '', time = ''] = raw.split(/\s+/);
    return { day: day || 'Tarihsiz', time: time ? time.slice(0, 5) : '' };
}

function _b3DayLabel(day) {
    const today = getTurkiyeTarihi();
    const y = new Date(Date.now() - 864e5).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' });
    if (day === today) return 'Bugün';
    if (day === y) return 'Dün';
    return day;
}

function _renderB3Cards(rows) {
    const container = document.getElementById('cardViewB3');
    if (!container) return;
    if (rows.length === 0) {
        const searching = (window.data.b3 || []).length > 0;
        container.innerHTML = `<div class="card-empty-state">
                <i class="fas ${searching ? 'fa-search' : 'fa-box-open'}"></i>
                <p>${searching ? 'Aramanızla eşleşen çıkış kaydı yok.' : 'Çıkış kaydı bulunamadı.'}</p>
            </div>`;
        return;
    }
    const sorted = [...rows].sort((a, b) => (b.row.ts || 0) - (a.row.ts || 0));
    const groups = [];
    sorted.forEach(entry => {
        const parts = _b3DayParts(entry.row);
        let g = groups[groups.length - 1];
        if (!g || g.day !== parts.day) { g = { day: parts.day, items: [] }; groups.push(g); }
        g.items.push({ ...entry, time: parts.time });
    });

    const tipLabel = { zimmet: 'Zimmet', hurda: 'Hurda', cikis: 'Çıkış' };
    const cardHtml = ({ item, row, time }) => {
        const isPassive = (item.durumu === 'Pasif' || item.status === 'Pasif');
        const tip = tipLabel[row.tip] ? row.tip : 'cikis';
        const chips = [
            row.alanKisi !== '-' ? `<span class="b3-chip b3-chip-person"><i class="fas fa-user" aria-hidden="true"></i> ${escapeHtml(row.alanKisi)}</span>` : '',
            row.envanterNo !== '-' ? `<span class="b3-chip b3-chip-env"><i class="fas fa-barcode" aria-hidden="true"></i> ${escapeHtml(row.envanterNo)}</span>` : '',
            row.adet > 0 ? `<span class="b3-chip b3-chip-qty"><i class="fas fa-box" aria-hidden="true"></i> ${escapeHtml(row.adet)} Adet</span>` : ''
        ].join('');
        const detail = (label, value, cls = '') => `<div class="b3-drawer-row"><dt>${escapeHtml(label)}</dt><dd class="${escapeHtml(cls)}">${escapeHtml(value)}</dd></div>`;
        return `<article class="b3-card-item b3-tip-${escapeHtml(tip)}${isPassive ? ' card-item-passive' : ''}">
                <header class="b3-card-header">
                    <label class="b3-card-select">
                        <input type="checkbox" class="row-select b3-row-select" data-id="${escapeHtml(item.id)}" aria-label="Kaydı seç">
                    </label>
                    <div class="b3-card-title">
                        <span class="b3-card-name">${escapeHtml(row.urunAciklama)}</span>
                        <span class="b3-card-sub">${escapeHtml(row.urunTuru)}${row.marka ? ` · ${escapeHtml(row.marka)}` : ''}</span>
                    </div>
                    <div class="b3-card-stamp">
                        <span class="b3-tip-badge">${escapeHtml(tipLabel[tip])}</span>
                        ${time ? `<span class="b3-card-time"><i class="far fa-clock" aria-hidden="true"></i> ${escapeHtml(time)}</span>` : ''}
                    </div>
                </header>
                ${chips ? `<div class="b3-card-hero">${chips}</div>` : ''}
                <details class="b3-card-drawer">
                    <summary><span>Detaylar</span><i class="fas fa-chevron-down" aria-hidden="true"></i></summary>
                    <dl>
                        ${detail('Raf / Konum', row.rafNo) /* xss-ok: detail() tüm parçaları escapeHtml ile kaçırır */}
                        ${detail('ITSM / Gerekçe', row.sn, 'b3-mono') /* xss-ok: detail() tüm parçaları escapeHtml ile kaçırır */}
                        ${detail('Tarih', row.tarih) /* xss-ok: detail() tüm parçaları escapeHtml ile kaçırır */}
                        ${detail('Açıklama / Not', row.not, 'b3-note') /* xss-ok: detail() tüm parçaları escapeHtml ile kaçırır */}
                    </dl>
                </details>
                <footer class="b3-card-actions">${_b3ActionButtons(item.id) /* xss-ok: id jsArg ile kaçırılır, geri kalan sabit */}</footer>
            </article>`;
    };

    container.innerHTML = `
        <div class="b3-card-toolbar">
            <label class="b3-card-selectall"><input type="checkbox" id="selectAllB3Cards"> Tümünü Seç</label>
            <span class="b3-card-total">${rows.length} kayıt</span>
        </div>
        ${groups.map(g => `
            <section class="b3-day-group">
                <h3 class="b3-day-header">
                    <span><i class="far fa-calendar" aria-hidden="true"></i> ${escapeHtml(_b3DayLabel(g.day))}</span>
                    <span class="b3-day-count">${g.items.length} işlem</span>
                </h3>
                <div class="b3-day-body">${g.items.map(cardHtml).join('')}</div>
            </section>`).join('')}`;
}

function renderExitTable() {
    if (window._cardViewActive.b3 === undefined) window._cardViewActive.b3 = B3_CARD_MQ.matches;
    _applyB3ViewState();
    const rows = _getB3Rows();
    if (window._cardViewActive.b3) {
        _renderB3Cards(rows);
        const tbody = document.querySelector('#tableB3 tbody');
        if (tbody) tbody.innerHTML = '';
    } else {
        _renderB3Table(rows);
        const cards = document.getElementById('cardViewB3');
        if (cards) cards.innerHTML = '';
    }
}
window.renderExitTable = renderExitTable;

window.toggleB3CardView = function () {
    window._cardViewActive.b3 = !window._cardViewActive.b3;
    renderExitTable();
};

B3_CARD_MQ.addEventListener('change', () => {
    window._cardViewActive.b3 = B3_CARD_MQ.matches;
    renderExitTable();
});

window.toggleB3Help = function () {
    const btn = document.getElementById('b3HelpToggle');
    const panel = document.getElementById('b3HelpPanel');
    if (!btn || !panel) return;
    const open = panel.hidden;
    panel.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
};

// [WHY]: Çıkış geri alma özelliği için kullanıcı bilgilendirmesi
// [HOW]: Henüz fonksiyon yazılmadan mini bildirim (toast) gösterir
window.showUndoNotice = function () {
    if (typeof showAppAlert === 'function') {
        showAppAlert('Geri alma özelliği geliştirme aşamasındadır.', 'info');
    } else {
        alert('Geri alma özelliği geliştirme aşamasındadır.');
    }
};

// [WHY]: B3 çıkış kayıtlarının aylık raporlama sonrasında toplu temizlenmesi
// [HOW]: Seçili satır ID'lerini toplar, yönetici onayından sonra atomic window.bulkRemove('b3', ids) ile siler
window.bulkDeleteB3 = async function () {
    if (typeof validateAdminAction === 'function' && !validateAdminAction()) return;
    const checked = Array.from(document.querySelectorAll('.b3-row-select:checked'));
    if (checked.length === 0) {
        if (typeof showAppAlert === 'function') showAppAlert('Lütfen silinecek çıkış kayıtlarını seçin.', 'warning');
        return;
    }
    const ids = [...new Set(checked.map(cb => cb.dataset.id).filter(Boolean))];
    const confirmed = typeof window.showCustomConfirm === 'function'
        ? await window.showCustomConfirm('Toplu Çıkış Kaydı Silme', `${ids.length} adet çıkış kaydı kalıcı olarak silinecek. (Stok değişmez). Onaylıyor musunuz?`)
        : confirm(`${ids.length} adet çıkış kaydı silinsin mi?`);
    if (!confirmed) return;

    try {
        if (typeof window.bulkRemove === 'function') {
            await window.bulkRemove('b3', ids);
        } else if (typeof window.removeItem === 'function') {
            for (const id of ids) {
                await window.removeItem('b3', id);
            }
        }
        if (typeof renderExitTable === 'function') renderExitTable();
        if (typeof showAppAlert === 'function') showAppAlert(`${ids.length} adet çıkış kaydı başarıyla silindi.`, 'success');
    } catch (err) {
        console.error('[bulkDeleteB3] Toplu silme hatası:', err);
        if (typeof showAppAlert === 'function') showAppAlert('Toplu silme sırasında bir hata oluştu.', 'error');
    }
};

// [WHY]: B3 çıkış tablosu "Tümünü Seç" kutusu dinleyicisi
// [HOW]: Delegated change dinleyicisi; tablo (selectAllB3) ve kart (selectAllB3Cards) kutuları yalnız kendi
//        görünümündeki .b3-row-select elemanlarını işaretler (yalnız etkin görünüm çizilir).
document.addEventListener('change', (e) => {
    const scopes = { selectAllB3: '#tableB3', selectAllB3Cards: '#cardViewB3' };
    const scope = e.target && scopes[e.target.id];
    if (scope) {
        const isChecked = e.target.checked;
        document.querySelectorAll(`${scope} .b3-row-select`).forEach(cb => { cb.checked = isChecked; });
    }
});

window.exportPDF = function (depo) {
    if (!validateAdminAction()) return;
    if (depo === 'b3') return _exportB3PDF();
    const items = (window.data[depo] || []).filter(item => !window.Schema?.isRowCountLocked?.(item));   // v3.6: tabloyla aynı
    function getStatusClass(status) {
        if (!status) return "status-diger";
        status = status.toLowerCase();
        if (status.includes("hazır")) return "status-hazir";
        if (status.includes("sıfır")) return "status-sifir";
        if (status.includes("arız") || status.includes("bozuk") || status.includes("tutmuyor")) return "status-ariza";
        return "status-diger";
    }
    let html = `<html><head><title>${escapeHtml(depo)} Rapor</title><style>
        body { font-family: "Roboto", Arial, sans-serif; margin: 0; padding: 20px; color: #222; }
        table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 11px; }
        th, td { border: 1px solid #cfd6dc; padding: 6px 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        td.wrap { white-space: normal; word-break: break-word; }
        th { background: #2c3e50; color: white; font-weight: 600; }
        tr:nth-child(even) { background: #f7f9fb; }
        th:nth-child(1), td:nth-child(1) { width: 30px; text-align: center; }
        th:nth-child(2), td:nth-child(2) { width: 60px; }
        th:nth-child(3), td:nth-child(3) { width: 60px; }
        th:nth-child(4), td:nth-child(4) { width: 160px; }
        th:nth-child(5), td:nth-child(5) { width: 100px; }
        th:nth-child(6), td:nth-child(6) { width: 50px; text-align: center; }
        th:nth-child(7), td:nth-child(7) { width: 90px; }
        th:nth-child(8), td:nth-child(8) { width: 60px; }
        .status-hazir { background: #e8f5e9; color: #2e7d32; font-weight: 600; }
        .status-ariza { background: #ffebee; color: #c62828; font-weight: 600; }
        .status-sifir { background: #e3f2fd; color: #1565c0; font-weight: 600; }
        .status-diger { background: #fff8e1; color: #ef6c00; font-weight: 600; }
    </style></head><body><div class="print-container"><div style="font-size:18px; font-weight:bold; margin-bottom:6px;">${escapeHtml(depo.toUpperCase())} DEPO ENVANTERİ</div>
    <div style="font-size:12px; margin-bottom:14px;">Rapor Tarihi: ${escapeHtml(getTurkiyeSaati())}</div><table><thead><tr><th>#</th><th>Sütun</th><th>Raf</th><th>Ürün</th><th>Marka</th><th>Adet</th><th>Durum</th><th>Tür</th></tr></thead><tbody>`;

    items.forEach((item, index) => {
        const status = item.durumu ?? item.status ?? "-";
        html += `<tr><td>${index + 1}</td><td>${escapeHtml(item.sütun || '-')}</td><td>${escapeHtml(item.raf || '-')}</td><td class="wrap">${escapeHtml(item.ürün || '-')}</td><td class="wrap">${escapeHtml(item.marka || '-')}</td>
        <td style="text-align:center; font-weight:600;">${escapeHtml(item.adet ?? item.qty ?? 0)}</td><td class="${getStatusClass(status) /* xss-ok: dört sabit sınıf adından biri */}">${escapeHtml(status)}</td><td>${escapeHtml(item.tür ?? item.type ?? '-')}</td></tr>`;
    });
    html += `</tbody></table></div></body></html>`;

    const win = window.open('', '', 'width=1400,height=900');
    win.document.write(html);
    win.document.close();
    setTimeout(() => { win.print(); win.close(); }, 300);
};

// [WHY]: Admin'ler hangi Excel/CSV sütun adlarının tanındığını ve hangi sırayla verilmesi gerektiğini bilmeden import
//        deniyor, "sütun tanınmadı" uyarılarıyla karşılaşıyordu.
// [HOW]: Tek, paylaşılan bilgi penceresi (showCustomConfirm'in salt-bilgi kullanımı); B1/B2 import düğmelerinin yanındaki
//        ℹ️ ikonundan (index.html) ve WMS "Depo Aksiyonları" panelinden (admin.html) AYNI fonksiyon çağrılır — metin tek
//        yerde (burada) güncellenir. Sütun adları stock-import.js FIELD_ALIASES'teki kabul edilen takma adlarla birebir;
//        sıra, Excel Rapor (exportToExcel) çıktısıyla tutarlı olsun diye önerilir — gerçek eşleme başlık ADINA göre
//        yapıldığından (sıraya değil) teknik olarak zorunlu değildir, yalnız okunabilirlik için.
window.showImportFormatHelp = function (depo = 'b1') {
    const isB2 = depo === 'b2' || depo === 'all';
    const maxRows = (window.StockImport && window.StockImport.MAX_IMPORT_ROWS) || 200;
    const lines = [
        `${isB2 ? 'B2 (Demirbaş)' : 'B1 (Sarf)'} içe aktarma — önerilen sütun sırası:`, '',
        '1. Sütun  (opsiyonel — raf içindeki fiziksel bölme/kolon)',
        '2. Raf No  (opsiyonel — katalogda yoksa otomatik yaratılır, doluysa Havuz\'a alınır)',
        '3. Ürün Türü  (opsiyonel — demirbaş/sarf ayrımı ve kritik stok grubu için önemli)',
        '4. Ürün Adı  (ZORUNLU — boşsa satır reddedilir)',
        '5. Marka  (opsiyonel)',
        '6. Adet  (opsiyonel — boşsa 0/Tükendi sayılır; negatif ya da tam sayı olmayan değer reddedilir)',
        '7. Durumu  (opsiyonel — ör. Kullanıma Hazır, Pasif, Hurda, Servis Sürecinde)',
        '8. Envanter No  (ZORUNLU — her satırda bulunmalı ve benzersiz olmalı)',
        '9. Seri No  (opsiyonel — cihazın seri numarası)',
        '10. Açıklama  (opsiyonel)', '',
        'Sütun adı büyük/küçük harf ve Türkçe karakterden bağımsız tanınır (ör. "Raf No", "raf numarası", "shelf" hepsi aynı alana eşlenir).',
        'Sıra önemli DEĞİLDİR — eşleme başlık adına göre yapılır; yukarıdaki sıra yalnız okunabilirlik içindir.',
        `Tek dosyada en fazla ${maxRows} veri satırı kabul edilir (yönetici dahil aşılamaz); daha büyük listeleri ${maxRows} satırlık parçalara bölüp ayrı ayrı içe aktarın.`,
    ].filter(x => x !== null).join('\n');
    if (typeof window.showCustomConfirm === 'function') {
        // Uzun rehber güvenli DOM düğümleriyle kurulur; kayıt/dosya verisi HTML olarak yorumlanmaz.
        const el = (tag, className, text) => {
            const node = document.createElement(tag);
            node.className = className;
            if (text !== undefined) node.textContent = text;
            return node;
        };
        const guide = el('div', 'import-guide');
        const intro = el('div', 'import-guide-intro');
        intro.append(el('span', 'import-guide-depot', depo === 'all' ? 'B1 + B2 · ORTAK REHBER' : (isB2 ? 'B2 · DEMİRBAŞ' : 'B1 · SARF')),
            el('p', '', 'Dosyanızı hazırlayın, ürünlerinizi kolayca içe aktarın.'));
        guide.append(intro);
        const facts = el('div', 'import-guide-facts');
        for (const [value, label] of [['.xlsx / .xls / .csv', 'Desteklenen dosyalar'], [`${maxRows} satır`, 'Dosya başına üst sınır'], ['Ürün Adı + Envanter No', 'Zorunlu alanlar']]) {
            const fact = el('div', 'import-guide-fact');
            fact.append(el('span', '', label), el('strong', '', value));
            facts.append(fact);
        }
        guide.append(facts);
        const section = el('section', 'import-guide-section');
        section.append(el('h4', '', 'Sütun rehberi'), el('p', 'import-guide-caption', 'Önerilen sıra aşağıda. Dosyanızdaki sütun sırası farklı olabilir.'));
        const columns = [
            ['Sütun', 'Raf içindeki fiziksel bölme veya kolon.', 'A'],
            ['Raf No', 'Raf yoksa otomatik oluşturulur. Doluysa ürün Havuz’a alınır.', 'R-01'],
            ['Ürün Türü', 'Demirbaş / sarf ayrımı ve kritik stok grubu için önemlidir.', isB2 ? 'Dizüstü Bilgisayar' : 'Kablo'],
            ['Ürün Adı', 'Her veri satırında bulunmalı; boş bırakılan satır reddedilir.', isB2 ? 'Dell Latitude 5440' : 'HDMI Kablo'],
            ['Marka', 'Ürünün marka bilgisi.', isB2 ? 'Dell' : 'Ugreen'],
            ['Adet', '0 veya pozitif tam sayı. Boş bırakılırsa 0 / Tükendi kabul edilir.', '1'],
            ['Durumu', 'Ör. Kullanıma Hazır, Pasif, Hurda veya Servis Sürecinde.', 'Kullanıma Hazır'],
            ['Envanter No', 'Her satırda zorunludur. B1 ve B2’de saklanır; mevcut numaralar yeniden eklenmez.', 'ENV-2026-001'],
            ['Seri No', 'Cihazın seri numarası. Ürün kaydında saklanır.', 'SN5X8K2L9'],
            ['Açıklama', 'Ürünle ilgili ek bilgi veya not.', 'İdari işler'],
        ];
        const list = el('ol', 'import-guide-columns');
        columns.forEach(([name, description, example]) => {
            const required = name === 'Ürün Adı' || name === 'Envanter No';
            const row = el('li', required ? 'import-guide-column is-required' : 'import-guide-column');
            const detail = el('div', 'import-guide-column-detail');
            const heading = el('div', 'import-guide-column-heading');
            heading.append(el('strong', '', name), el('span', required ? 'import-guide-required' : 'import-guide-optional', required ? 'Zorunlu' : 'İsteğe bağlı'));
            detail.append(heading, el('p', '', description));
            row.append(detail, el('code', 'import-guide-example', example));
            list.append(row);
        });
        section.append(list);
        guide.append(section);
        const notes = el('section', 'import-guide-notes');
        notes.append(el('h4', '', 'Yüklemeden önce'),
            el('p', '', 'İlk satıra sütun başlıklarını yazın. Büyük / küçük harf ve Türkçe karakter farklılıkları tanınır: “Raf No”, “raf numarası” ve “shelf” aynı alana eşlenir.'),
            el('p', '', `Sütunlar başlık adına göre eşleştirilir. ${maxRows} satırdan uzun listeleri ayrı dosyalara bölün. Negatif veya ondalıklı adet kabul edilmez.`));
        guide.append(notes);
        window.showCustomConfirm('Excel / CSV hazırlama rehberi', guide, { confirmText: 'Anladım, hazırım', variant: 'import-guide' });
    } else {
        window.alert(lines);
    }
};

// [WHY]: Faz 5 denetimi (P1) — içe aktarma kanonik olmayan b1/b2 kaydı üretiyordu ("rafNo", isDemirbas yok, uydurma
//        "Unbranded"/"Sarf"/limit 3, sayı olmayan adet → 0) ve tüm depoyu saveData ile parça parça yazıyordu; CSV dalı dosyayı
//        ArrayBuffer olarak okuyup metin gibi bölmeye çalıştığı için hiç çalışmıyordu. saveData'nın b1/b2 tam 'set'
//        sözleşmesi bu yüzden esnetilmişti (artık esnek değil).
// [HOW]: Ayrıştırma/eşleme/doğrulama StockImport'ta (saf, birim testli): başlık adlarıyla eşleme, Schema.toCanonicalStock,
//        validateB1/B2 tam sözleşmesi. Tek hatalı satır bile varsa hiçbir şey yazılmaz. Onaydan sonra YENİ kayıtlar, yeni
//        raflar ve raf sayaçları atomicImportStock ile hepsi-ya-da-hiçbiri yazılır (depodaki mevcut kayıtlar yeniden yazılmaz).
//        MAX_IMPORT_ROWS (200, bkz. stock-import.js dosya başı) tek dosyada kabul edilen üst sınırdır — admin dahil aşılamaz.
async function importExcel(event) {
    const input = event.target;
    const file = input.files[0];
    const depo = input.getAttribute('data-depo') || 'b1';
    input.value = '';   // aynı dosya ikinci kez seçilebilsin
    if (!file) return;
    // Faz 4 · J1 (M1): içe aktarma b1/b2 yazması — yalnız admin (B2 etiketi kapısızdı, B1 etiketi dosya seçiciyi yine açıyordu).
    if (!window.requireDbAdmin('Excel içe aktarma')) return;
    const I = window.StockImport;
    if (!I || !window.Schema || typeof window.atomicImportStock !== 'function') { showAppAlert('İçe aktarma modülü yüklenemedi; sayfayı yenileyin.', 'error'); return; }

    let rows;
    try {
        const buf = await file.arrayBuffer();
        rows = /\.csv$/i.test(file.name) ? I.parseCsv(I.decodeText(buf)) : I.sheetRows(XLSX, buf);
    } catch (err) {
        console.error('İçe aktarma: dosya okunamadı', err);
        showAppAlert('Dosya okunamadı. CSV (UTF-8 / Windows-1254) veya Excel (.xlsx/.xls) olmalı.', 'error');
        return;
    }

    // Raf yerleşimi ("Auto-Create & Overflow"): buradaki yerel katalogla yalnız ÖNİZLENİR (onay diyaloğu). Kesin karar,
    // yeni rafların yaratılması ve sayaçların artırılması atomicImportStock'ta ürünlerle AYNI hepsi-ya-da-hiçbiri işte,
    // sunucudan taze okunan raf belgeleriyle verilir (v3.3 P1).
    const shelfCapacityInfo = new Map((window.data.shelves || [])
        .filter(s => s && s.depot === depo && typeof s.code === 'string')
        .map(s => [s.code, { capacity: s.capacity, usedSlots: s.usedSlots, active: s.active }]));
    const res = I.buildStockRecords(rows, depo, {
        schema: window.Schema,
        makeId: window.makeId,
        now: Date.now(),
        shelfCapacityInfo,
        productTypes: typeof window.getActiveProductTypes === 'function'
            ? window.getActiveProductTypes()
            : ((window.data && window.data.productTypes) || []),
    });
    if (res.errors.length) {
        const more = res.errors.length > 5 ? `\n… (+${res.errors.length - 5} hata)` : '';
        showAppAlert(`İçe aktarma durduruldu, hiçbir kayıt yazılmadı.\n${res.errors.slice(0, 5).join('\n')}${more}`, 'error');
        return;
    }
    const initialPreview = I.planShelfPlacement({
        records: res.records, requests: res.shelfRequests, catalog: shelfCapacityInfo, depot: depo,
    });
    const baseWarnings = res.warnings.filter(w => !initialPreview.warnings.includes(w));
    const filtered = I.filterExistingInventoryNumbers(res.records, res.shelfRequests, [
        { depot: 'b1', records: window.data.b1 || [] },
        { depot: 'b2', records: window.data.b2 || [] },
    ], window.Schema);
    res.skippedDuplicates = filtered.skipped;
    res.shelfRequests = filtered.requests;
    const filteredPreview = I.planShelfPlacement({
        records: filtered.records, requests: filtered.requests, catalog: shelfCapacityInfo, depot: depo,
    });
    res.records = filteredPreview.records;
    res.shelvesToCreate = filteredPreview.shelvesToCreate;
    res.poolOverflowCount = filteredPreview.poolOverflowCount;
    res.poolInactiveCount = filteredPreview.poolInactiveCount;
    res.warnings = [...baseWarnings, ...filteredPreview.warnings];
    res.shelfCorrections = I.findShelfCorrections(filtered.requests, shelfCapacityInfo);
    const duplicateDetails = (list, limit = 5) => {
        const lines = list.slice(0, limit).map(item =>
            `${item.envanterNo}: ${item.incoming.ürün} → ${item.matches.map(match => `${match.depot.toUpperCase()} / ${match.ürün}`).join(', ')}` +
            (item.differences.length ? ` (farklı alanlar: ${item.differences.join(', ')})` : '')
        );
        if (list.length > limit) lines.push(`… (+${list.length - limit} kayıt)`);
        return lines.join('\n');
    };
    if (!res.records.length) {
        if (res.skippedDuplicates.length) {
            showAppAlert(`${res.skippedDuplicates.length} ürün Envanter No nedeniyle zaten kayıtlı; hiçbir ürün yeniden eklenmedi.\n${duplicateDetails(res.skippedDuplicates, Infinity)}`, 'info');
        } else {
            showAppAlert('Yüklenecek geçerli veri bulunamadı!', 'error');
        }
        return;
    }

    if (res.shelfCorrections.length) {
        if (typeof window.showCustomConfirm !== 'function') {
            showAppAlert('Raf eşleşme penceresi açılamadı; hiçbir kayıt içe aktarılmadı.', 'error');
            return;
        }
        const content = document.createElement('div');
        const intro = document.createElement('p');
        intro.textContent = 'Dosyadaki raf kodu ile mevcut raf arasında yalnızca nokta, tire veya boşluk farkı bulundu. Her satır için kullanılacak rafı seçin. Seçim yalnızca bu içe aktarmada geçerlidir.';
        content.appendChild(intro);
        const table = document.createElement('table');
        table.style.cssText = 'width:100%; border-collapse:collapse; margin:10px 0; font-size:13px; text-align:left;';
        const header = document.createElement('tr');
        ['Dosyadaki raf', 'Eşleşecek mevcut raf'].forEach(text => {
            const cell = document.createElement('th');
            cell.textContent = text;
            cell.style.cssText = 'padding:6px; border-bottom:1px solid #cbd5e1;';
            header.appendChild(cell);
        });
        table.appendChild(header);
        res.shelfCorrections.forEach(correction => {
            const row = document.createElement('tr');
            const source = document.createElement('td');
            source.textContent = correction.code;
            source.style.cssText = 'padding:6px; border-bottom:1px solid #e2e8f0;';
            const target = document.createElement('td');
            target.style.cssText = 'padding:6px; border-bottom:1px solid #e2e8f0;';
            const select = document.createElement('select');
            select.dataset.importShelfCode = correction.code;
            select.style.cssText = 'width:100%; padding:8px; border:1px solid #cbd5e1; border-radius:6px;';
            const newShelf = document.createElement('option');
            newShelf.value = '';
            newShelf.textContent = `Yeni raf oluştur: ${correction.code}`;
            select.appendChild(newShelf);
            correction.candidates.forEach(candidate => {
                const option = document.createElement('option');
                option.value = candidate;
                option.textContent = candidate;
                select.appendChild(option);
            });
            if (correction.candidates.length === 1) select.value = correction.candidates[0];
            target.appendChild(select);
            row.append(source, target);
            table.appendChild(row);
        });
        content.appendChild(table);
        if (res.shelfCorrections.some(c => c.candidates.length > 1)) {
            const ambiguous = document.createElement('p');
            ambiguous.textContent = 'Birden fazla eşleşme bulunan satırlarda seçim otomatik yapılmadı; listeden doğru rafı seçin veya yeni raf olarak bırakın.';
            content.appendChild(ambiguous);
        }
        const accepted = await window.showCustomConfirm('Raf Eşleşmelerini Kontrol Et', content, {
            confirmText: 'Seçimleri Uygula',
            cancelText: 'İçe Aktarmayı İptal Et',
        });
        if (accepted !== true) return;

        const choices = {};
        content.querySelectorAll('select[data-import-shelf-code]').forEach(select => {
            choices[select.dataset.importShelfCode] = select.value;
        });
        try {
            const oldPreview = I.planShelfPlacement({
                records: res.records, requests: res.shelfRequests, catalog: shelfCapacityInfo, depot: depo,
            });
            const baseWarnings = res.warnings.filter(w => !oldPreview.warnings.includes(w));
            const corrected = I.applyShelfCorrections(res.records, res.shelfRequests, res.shelfCorrections, choices);
            const preview = I.planShelfPlacement({
                records: corrected.records, requests: corrected.requests, catalog: shelfCapacityInfo, depot: depo,
            });
            res.records = preview.records;
            res.shelfRequests = corrected.requests;
            res.shelvesToCreate = preview.shelvesToCreate;
            res.poolOverflowCount = preview.poolOverflowCount;
            res.poolInactiveCount = preview.poolInactiveCount;
            res.warnings = [...baseWarnings, ...preview.warnings];
        } catch (err) {
            console.error('İçe aktarma: raf eşleşmesi uygulanamadı', err);
            showAppAlert('Raf eşleşmesi uygulanamadı; hiçbir kayıt içe aktarılmadı.', 'error');
            return;
        }
    }

    const demirbas = res.records.filter(r => r.isDemirbas).length;
    const overflowNote = (res.poolOverflowCount
        ? `\n\n⚠️ ${res.poolOverflowCount} adet ürün, hedef raf dolu olduğu için Havuz'a (rafsız) alınacak.` : '')
        + (res.poolInactiveCount ? `\n⚠️ ${res.poolInactiveCount} adet ürün, hedef raf pasif olduğu için Havuz'a (rafsız) alınacak.` : '');
    const createNote = res.shelvesToCreate.length
        ? `\n\n🆕 ${res.shelvesToCreate.length} yeni raf otomatik oluşturulacak (varsayılan kapasite ${I.DEFAULT_SHELF_CAPACITY}): ${res.shelvesToCreate.slice(0, 5).join(', ')}${res.shelvesToCreate.length > 5 ? '…' : ''}`
        : '';
    const duplicateNote = res.skippedDuplicates.length
        ? `\n\n${res.skippedDuplicates.length} ürün Envanter No zaten kayıtlı olduğu için atlanacak; mevcut kayıtlar değiştirilmez:\n${duplicateDetails(res.skippedDuplicates)}`
        : '';
    const question = `${res.records.length} yeni ürün ${depo.toUpperCase()} deposuna eklenecek (${demirbas} demirbaş, ${res.records.length - demirbas} sarf). ` +
        `Mevcut kayıtlara dokunulmaz.${duplicateNote}${createNote}${overflowNote}${res.warnings.length ? '\n\nUyarılar:\n' + res.warnings.slice(0, 5).join('\n') : ''}`;
    const ok = typeof window.showCustomConfirm === 'function'
        ? await window.showCustomConfirm('Excel / CSV İçe Aktarma', question, { confirmText: 'İçe Aktar' })
        : window.confirm(question);
    if (ok !== true) return;

    let out;
    try {
        out = await window.atomicImportStock(depo, res.records, res.shelfRequests);
    } catch (err) {
        const msg = err && err.code === 'rolled-back' ? 'Yazma yarıda kesildi; eklenen ürünler, yaratılan raflar ve raf sayaçları birlikte geri alındı — depo işlem öncesi hâlinde.'
            : err && err.code === 'rollback-pending' ? 'Yazma yarıda kesildi; geri alma yönetici oturumunda otomatik tamamlanacak (depo şu an kilitli).'
            : err && err.code === 'conflict' ? 'Raf kataloğu aynı anda başka bir işlemle değişti; hiçbir kayıt yazılmadı. Lütfen tekrar deneyin.'
            : err && err.code === 'import-too-large' ? ''   // mesajın tamamı err.message'da; aşağıda ayrıca eklenmez
            : 'Hiçbir kayıt yazılmadı.';
        showAppAlert(`Ürünler kaydedilemedi. ${msg} ${(err && err.message) || ''}`, 'error');
        return;
    }
    if (typeof renderTable === 'function') renderTable(depo);
    if (typeof window.ShelfMatrix?.render === 'function') window.ShelfMatrix.render();

    // Sonuç taze sunucu planından: önizlemeden farklıysa (bu arada raf dolduysa) gerçek sayılar bildirilir.
    const p = out.placement;
    const parts = [`${out.records.length} yeni ürün başarıyla depoya eklendi ve kaydedildi!`];
    if (out.skippedDuplicates.length) {
        parts.push(`${out.skippedDuplicates.length} ürün aynı Envanter No ile zaten bulunduğu için atlandı; mevcut kayıtlar değiştirilmedi.\n${duplicateDetails(out.skippedDuplicates, Infinity)}`);
    }
    if (p.created.length) parts.push(`${p.created.length} yeni raf oluşturuldu (${p.created.slice(0, 5).join(', ')}${p.created.length > 5 ? '…' : ''}).`);
    if (p.updated.length) parts.push(`${p.updated.length} rafın sayacı güncellendi.`);
    if (p.poolOverflowCount) parts.push(`${p.poolOverflowCount} adet ürün, hedef raf dolu olduğu için Havuz'a alındı.`);
    if (p.poolInactiveCount) parts.push(`${p.poolInactiveCount} adet ürün, hedef raf pasif olduğu için Havuz'a alındı.`);
    showAppAlert(parts.join(' '), p.poolOverflowCount || p.poolInactiveCount ? 'warning' : 'success');
}

window.exportToExcel = function (depo) {
    if (!window.data || !window.data[depo]) { showAppAlert("İndirilecek veri bulunamadı!", "error"); return; }
    // v3.6: B1/B2 raporu depo görünümüyle aynı — sayımdaki raflardaki ürünler dahil edilmez.
    const items = depo === 'b3' ? window.data[depo] : window.data[depo].filter(item => !window.Schema?.isRowCountLocked?.(item));
    let excelData = [];
    let sheetName = "";
    if (depo === 'b3') {
        excelData = items.map(item => ({
            ...(n => ({
                "Raf No": n.rafNo,
                "Ürün Türü": n.urunTuru,
                "Ürün Açıklama": n.urunAciklama,
                "ITSM / Gerekçe": n.sn,
                "Envanter No": n.envanterNo,
                "Adet": n.adet,
                "Not/Gerekçe": n.not,
                "Alan Kişi": n.alanKisi,
                "Tarih": n.tarih,
                "Hareket": n.tip === 'zimmet' ? 'Zimmet' : 'Çıkış'
            }))(window.Schema.normalizeB3(item))
        }));
        sheetName = "Envanter Çıkış Raporu";
    } else {
        // Envanter No hem B1 hem B2 raporuna dahil edilir; import tekrarlarını denetlemek için ortak kimlik alanıdır.
        excelData = items.map(item => {
            const row = {
                "Sütun": item.sütun || "-",
                "Raf/Shelf": item.raf || item.rafNo || "-",
                "Ürün Adı": item.ürün || item.name || "-",
                "Marka": item.marka || "-",
                "Adet": parseInt(item.adet || item.qty) || 0,
                "Durumu": item.durumu || "-",
                "Ürün Türü": item.tür || item.type || "-",
                "Kritik Limit": item.limit || 3,
                "Son Güncelleme": tsToTurkiye(item.lastUpdate)
            };
            row["Envanter No"] = item.envanterNo || "-";
            row["Seri No"] = item.sn || "-";
            return row;
        });
        sheetName = depo.toUpperCase() + " Deposu";
    }
    const ws = XLSX.utils.json_to_sheet(excelData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    const dateStr = new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
    XLSX.writeFile(wb, `${depo.toUpperCase()}_Rapor_${dateStr}.xlsx`);
    showAppAlert(`${depo.toUpperCase()} Raporu oluşturuldu.`, "success");
};

// Faz 4 · J2 (M6): showCustomConfirm'in tek tanımı src/utils/alert.js'te (iki sayfada script.js'ten önce yüklenir).

// [WHY]: Eski localStorage önbelleği window.data'yı Firebase'den önce eksik/bayat veriyle eziyordu (DATA-07).
// [HOW]: Tek kaynak Firestore snapshot'larıdır; kalmış önbellek bir kez silinir.
localStorage.removeItem('inventoryData');

// [WHY]: Kopyalama modunda (cloneProduct) kullanıcı modalı kaydetmeden kapatırsa işlem sessizce iptal oluyordu;
//        yanlışlıkla çarpıya/dışarıya tıklayan kullanıcı doldurduğu formu fark etmeden kaybedebiliyordu.
// [HOW]: productForm.dataset.isCloning === 'true' iken kapatmadan önce onay istenir. saveProduct başarılı kayıttan
//        önce bu bayrağı temizler (inventory-logic.js), böylece normal Kaydet akışında onay sorulmaz.
async function closeProductModal() {
    const modal = document.getElementById('productModal');
    if (!modal) return;

    const form = document.getElementById('productForm');
    if (form && form.dataset.isCloning === 'true') {
        const onay = typeof window.showCustomConfirm === 'function'
            ? await window.showCustomConfirm('Kopyalamayı İptal Et', 'Kopyalama işlemi iptal edilecek. Devam etmek istiyor musunuz?')
            : confirm('Kopyalama işlemi iptal edilecek. Devam etmek istiyor musunuz?');
        if (!onay) return;
        delete form.dataset.isCloning;
    }

    modal.style.display = "none";
}
window.closeProductModal = closeProductModal;

window.onclick = function (event) {
    const modal = document.getElementById('productModal');
    if (event.target == modal) closeProductModal();
};

// Bağlantı durumu bildirimleri
window.addEventListener("load", () => {
    // [WHY]: Kök 'productTypes' dinleyicisi kaldırıldı (kurallar reddediyordu); ürün türleri ${COLLECTION_ROOT}/productTypes/items'tan gelir (ADM-02).
    window.addEventListener('online', () => { if (typeof showAppAlert === 'function') showAppAlert("Bağlantı sağlandı.", "info"); });
    window.addEventListener('offline', () => { if (typeof showAppAlert === 'function') showAppAlert("İnternet bağlantısı koptu.", "warning"); });
});

// [WHY]: Eski talep şemasını (status/person/product) kullanan ve tüm veritabanını yazan ölü kod kaldırıldı: addRequest,
//        submitRequest, updateRequestStatus (sabit "Muhammed Cer"), renderRequestAction (tanımsız confirmReceipt).
//        Hiçbiri çağrılmıyordu; talep akışı saveRequest / confirmRequest / receiveProduct üzerinden (H2, DATA-10 benzeri gizli risk).

function openTab(tabId) {
    const contents = ['b1', 'b2', 'b3', 'personel', 'requestsTab'];
    contents.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    if (tabId === 'requests') {
        const reqTab = document.getElementById('requestsTab');
        if (reqTab) { reqTab.style.display = 'block'; renderRequestsTable(); }
    } else {
        const activeTab = document.getElementById(tabId);
        if (activeTab) activeTab.style.display = 'block';
    }
}

function sendArchiveEmail(requestData) {
    const serviceID = 'service_jp86sgy';
    const templateID = 'template_wj4lqrv';
    const templateParams = {
        to_name: "Yönetici",
        from_name: "Envanter Sistemi",
        personel_adi: requestData.personel,
        person: requestData.personel,
        urun: requestData.ürün,
        product: requestData.ürün,
        adet: requestData.adet || 1,
        qty: requestData.adet || 1,
        tarih: getTurkiyeTarihi()
    };
    if (typeof emailjs !== 'undefined') {
        emailjs.send(serviceID, templateID, templateParams).then(() => {
            console.log('Mail başarıyla arka planda gönderildi!');
        }, (err) => {
            console.error('Mail gönderme hatası:', err);
        });
    }
}

function toggleAllRequests(source) {
    const checkboxes = document.querySelectorAll('.req-checkbox');
    checkboxes.forEach(cb => cb.checked = source.checked);
}

async function deleteSelectedRequests() {
    if (!window.requireDbAdmin('Toplu talep silme')) return;   // Faz 4 · J1 (M1)
    const checkboxes = document.querySelectorAll('.req-checkbox:checked');
    if (checkboxes.length === 0) { showAppAlert("Lütfen silinecek kayıtları seçiniz.", "error"); return; }
    const idsToDelete = new Set(Array.from(checkboxes).map(cb => String(cb.value)));
    const onay = await showCustomConfirm("Toplu Silme", `${idsToDelete.size} adet kaydı kalıcı olarak silmek istediğinize emin misiniz?`);
    if (onay) {
        const remaining = (window.data.requests || []).filter(r => !idsToDelete.has(String(r.id)));
        // Kullanıcı onaylı toplu silme: saveData v2 toplu silme kilidi bilinçli olarak açılır (Faz 3.1).
        if (!(await window.writeOk(window.saveData('requests', remaining, { allowBulkDelete: true })))) { showAppAlert('Silme kaydedilemedi.', 'error'); return; }
        renderRequestsTable();
        showAppAlert(`${idsToDelete.size} kayıt başarıyla silindi.`, "success");
        const headerCheck = document.querySelector('.select-all-header input');
        if (headerCheck) headerCheck.checked = false;
    }
}

function exportTableToExcel(tableID, filename = '') {
    const tableSelect = document.getElementById(tableID);
    if (!tableSelect) return;
    let excelFile = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:x='urn:schemas-microsoft-com:office:excel' xmlns='http://www.w3.org/TR/REC-html40'><head><meta charset="UTF-8"></head><body>${tableSelect.outerHTML}</body></html>`;
    const blob = new Blob([excelFile], { type: 'application/vnd.ms-excel' });
    const downloadUrl = URL.createObjectURL(blob);
    const downloadLink = document.createElement("a");
    downloadLink.href = downloadUrl;
    downloadLink.download = filename + ".xls";
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
}

console.log("✅ [script.js] Temiz monolith basitleştirilmiş ve legacy bridges aktif.");
