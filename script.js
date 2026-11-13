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
