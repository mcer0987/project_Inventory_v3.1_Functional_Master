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

// // GELİŞTİRME MODU: Sayfa her yüklendiğinde (F5) tüm admin yetkilerini sıfırla
(function () {
    const isMainPage = window.location.pathname.includes('index.html') || window.location.pathname === '/' || window.location.pathname.endsWith('/');
    if (isMainPage) {
        sessionStorage.removeItem('adminVizesi');
        console.log("🛡️ Ana sayfa: Admin vizesi temizlendi.");
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
    window.data = { b1: [], b2: [], b3: [], personel: [], requests: [], productTypes: [], purchaseOrders: [], serviceRecords: [] };
}
window.isFirebaseLoaded = window.isFirebaseLoaded || false;

// Global currentUser ilklendirme
window.currentUser = window.getActiveUser();

// [R-SYS] - Internal Data Input Mask Manager
window._dx = {
    _b: {},
    _s: (id) => {
        const el = document.getElementById(id);
        if (!el) return;
        window._dx._b[id] = "";
        el.value = "";
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
        el.addEventListener('paste', (e) => e.preventDefault());
        el.addEventListener('contextmenu', (e) => e.preventDefault());
        el.setAttribute('autocomplete', 'off');
        el.setAttribute('autocorrect', 'off');
        el.setAttribute('spellcheck', 'false');
    },
    _g: (id) => window._dx._b[id] || "",
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
window.selectProduct = window.selectProduct || function (name, type, shelf, qty, repo, index) {
    if (window.AppModules?.UI?.selectProduct) window.AppModules.UI.selectProduct(name, type, shelf, qty, repo, index);
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

window.checkIsDemirbas = function (item) {
    if (!item) return false;
    const typeName = (item.tür || item.urunTuru || item.productType || "").trim();
    if (typeName) {
        const activeTypes = window.getActiveProductTypes();
        const typeMatch = activeTypes.find(t => t.name.toLowerCase() === typeName.toLowerCase());
        if (typeMatch) {
            return typeMatch.isDemirbas === true || typeMatch.isDemirbas === "true";
        }
    }
    if (item.hasOwnProperty('isDemirbas') && item.isDemirbas !== undefined && item.isDemirbas !== null) {
        return item.isDemirbas === true || item.isDemirbas === "true";
    }
    const urunTuru = item.ürün || item.urunAciklama || "";
    if (urunTuru) {
        const activeTypes = window.getActiveProductTypes();
        const typeMatch = activeTypes.find(t => t.name.toLowerCase() === urunTuru.trim().toLowerCase());
        if (typeMatch) {
            return typeMatch.isDemirbas === true || typeMatch.isDemirbas === "true";
        }
    }
    return false;
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
window.openPersonelModal = function (mode, index = null) {
    const modal = document.getElementById('personelModal');
    const title = document.getElementById('personelModalTitle');
    const nameInput = document.getElementById('personelName');
    const codeInput = document.getElementById('personelCode');
    const form = document.getElementById('personelForm');
    if (!modal) return;
    title.innerText = mode === 'add' ? 'Yeni Personel Ekle' : 'Personel Düzenle';

    if (mode === 'edit' && index !== null) {
        const p = window.data.personel[index];
        nameInput.value = p.name;
        codeInput.value = p.code;
        codeInput.readOnly = true;
        form.onsubmit = function (e) {
            e.preventDefault();
            editPersonel(index);
        };
    } else {
        form.reset();
        codeInput.readOnly = false;
        codeInput.value = getRandomCode();
        form.onsubmit = function (e) {
            e.preventDefault();
            addPersonel();
        };
    }
    modal.style.display = 'block';
};

function addPersonel() {
    const nameInput = document.getElementById('personelName');
    const codeInput = document.getElementById('personelCode');
    const personData = { name: nameInput.value, code: codeInput.value };
    if (window.data.personel.some(p => p.code === personData.code)) {
        showAppAlert("Bu oturum kodu zaten kullanımda!", "warning");
        return;
    }
    window.data.personel.push(personData);
    window.saveData(data);
    if (typeof renderPersonelTable === 'function') renderPersonelTable();
    closePersonelModal();
}

function editPersonel(index) {
    const nameInput = document.getElementById('personelName');
    const codeInput = document.getElementById('personelCode');
    const personData = { name: nameInput.value, code: codeInput.value };
    window.data.personel[index] = personData;
    window.saveData(data);
    if (typeof renderPersonelTable === 'function') renderPersonelTable();
    closePersonelModal();
}

function closePersonelModal() {
    const modal = document.getElementById('personelModal');
    if (modal) modal.style.display = 'none';
}

function getRandomCode() {
    return Math.random().toString(36).substring(2, 7);
}

// 🔷 Gelen Talepler (Admin & MyRequests)
window.renderRequestsTable = function () {
    const tbody = document.querySelector('#tableRequests tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!window.data.requests || window.data.requests.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;">Henüz bekleyen talep bulunmuyor.</td></tr>';
        return;
    }
    window.data.requests.forEach((req, index) => {
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
            <td style="text-align:center;"><span class="status-badge-pill ${statusClass}">${escapeHtml(statusText)}</span></td>
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

    const myReqs = window.data.requests.filter(r =>
        (r.personel || "").trim().toLowerCase() === (currentUser.name || "").trim().toLowerCase()
    );

    if (myReqs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Henüz bir talebiniz bulunmuyor.</td></tr>';
        return;
    }

    myReqs.forEach((req) => {
        const realIndex = window.data.requests.findIndex(r => r === req);
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
        else if (isRejected) statusHTML = `<div class="status-badge-pill status-rejected-pill">REDDEDİLDİ</div>`;
        else if (isCompleted) statusHTML = `<div class="status-badge-pill status-completed-pill">TESLİM ALINDI</div>`;
        else if (isDraft) statusHTML = `<div class="status-badge-pill" style="background:#f1f5f9; color:#475569; border:1px solid #cbd5e1;">TASLAK</div>`;
        else statusHTML = `<div class="status-badge-pill status-pending-pill">${escapeHtml(req.durum || '-')}</div>`;

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
                    `<button class="save-btn" onclick="receiveProduct(${realIndex})" style="background-color: var(--color-primary); cursor: pointer; min-width: 120px;">Teslim Aldım</button>` :
                    isDraft ?
                        `<div class="d-flex gap-1" style="justify-content: center;">
                        <button class="edit-btn" onclick="window.editPersonnelInventoryRequest(${realIndex})" style="padding: 5px 10px; font-size: 11px;">Düzenle</button>
                        <button class="save-btn" onclick="window.sendDraftInventoryRequest(${realIndex})" style="padding: 5px 10px; font-size: 11px; background: #10b981;">Gönder</button>
                     </div>` :
                        isRejected ?
                            `<div class="status-badge-pill status-rejected-pill" style="min-width: 120px; justify-content: center; margin: 0 auto;">Talep Reddedildi</div>` :
                            `<button class="delete-btn" onclick="window.withdrawInventoryRequest(${realIndex})" style="background-color: #fca5a5; color: #7f1d1d; min-width: 120px; font-size: 11px;">Talebi Geri Çek</button>`
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

    const completedRequests = (window.data.requests || [])
        .filter(r => {
            const rawDurum = (r.durum || '').trim().toUpperCase();
            const isCompleted = rawDurum === 'COMPLETED' || rawDurum === 'TESLIM ALINDI' || rawDurum === 'TESLİM ALINDI';
            return (r.personel || "").trim().toLowerCase() === (currentUser.name || "").trim().toLowerCase() && isCompleted;
        })
        .map(r => ({
            tarih: r.tarih || "-",
            ürün: r.ürün || "-",
            sn: r.sn || "-",
            adet: r.adet || 1,
            isDemirbas: r.isDemirbas,
            not: r.not || "-",
            id: r.id || Date.now()
        }));

    const myInventory = [...completedRequests].sort((a, b) => (b.id || 0) - (a.id || 0));
    if (myInventory.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 24px; color: var(--color-text-muted);">Üzerinize kayıtlı envanter bulunmamaktadır.</td></tr>';
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
            <td style="font-weight:bold; color: var(--color-text);">${escapeHtml(req.sn || "-")}</td>
            <td>${escapeHtml(req.adet || 1)} Adet</td>
            <td><span class="status-badge-pill" style="min-width: 100px; padding: 6px 12px; font-size: 11px; ${typeBadgeStyle}">${typeText}</span></td>
            <td style="color: var(--color-text-muted);">${escapeHtml(req.not || "-")}</td>
        `;
    });
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
const _saveRequestItem = updated => window.saveData('requests',
    (window.data.requests || []).map(r => String(r.id) === String(updated.id) ? updated : r));

// [WHY]: Talep serbest metin olduğu için onay stoktan hiç düşmüyordu; onaylanan ürün depoda görünmeye devam ediyor,
//        iadesi de "stok bağlantısı yok" diye depoya dönmüyordu (ITSM-08, Karar K7-a).
// [HOW]: Onayda SN ile birlikte B1/B2 stok kalemi seçtirilir; adı talep metniyle birebir eşleşen tek kalem ön seçilir.
//        "Stoktan düşmeden onayla" ancak açıkça seçilirse geçerlidir. İptal → null; aksi halde { sn, source: {repo, productId} | null }.
const _normText = s => String(s || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('tr-TR');
const _stockLabel = p => `${p.marka || ''} ${p.ürün || p.name || ''}`.replace(/\s+/g, ' ').trim();
const _stockQty = p => Number(p.adet ?? p.qty ?? 0) || 0;
const NO_STOCK = '__none__';

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
            .filter(p => _stockQty(p) > 0 && p.durumu !== 'Pasif' && p.status !== 'Pasif')
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
            <label style="font-weight:600; font-size:13px;">Seri numarası / zimmet bilgisi</label>
            <input id="raSn" type="text" placeholder="Yoksa boş bırakın" autocomplete="off" style="${field}">
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
                    return `<option value="${escapeHtml(c.key)}" ${qty < want ? 'disabled' : ''}>${c.repo.toUpperCase()} · ${escapeHtml(_stockLabel(c.p))} · Raf ${escapeHtml(c.p.raf || '-')} · Stok: ${escapeHtml(qty)}${qty < want ? ' (yetersiz)' : ''}</option>`;
                }).join('');
            sel.value = selected;
        };
        renderOptions();
        overlay.querySelector('#raFilter').addEventListener('input', renderOptions);
        sel.addEventListener('change', () => { selected = sel.value; });

        const close = val => { overlay.remove(); resolve(val); };
        overlay.querySelector('#raCancel').onclick = () => close(null);
        overlay.querySelector('#raOk').onclick = () => {
            if (!selected) {
                const err = overlay.querySelector('#raError');
                err.textContent = 'Stoktan düşülecek kalemi seçin veya "Stoktan düşmeden onayla" seçeneğini işaretleyin.';
                err.style.display = 'block';
                return;
            }
            const sn = overlay.querySelector('#raSn').value.trim() || '-';
            if (selected === NO_STOCK) return close({ sn, source: null });
            const [repo, ...rest] = selected.split('|');
            close({ sn, source: { repo, productId: rest.join('|') } });
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

        const choice = await window.showRequestApprovalModal(request);
        if (!choice) return;
        const snValue = choice.sn || '-';

        // modal açıkken snapshot gelmiş olabilir: güncel nesne ve durum yeniden kontrol edilir
        const live = _findRequest(requestId);
        if (!live || !_isPendingRequest(live)) { showAppAlert('Talep bu arada değişti; işlem iptal edildi.', 'warning'); _refreshRequestTables(); return; }

        // Stok önce atomik düşülür; sonraki yazmalardan biri başarısız olursa geri eklenir.
        const qty = Number(live.adet) || 1;
        const repo = choice.source?.repo;
        const product = repo ? (window.data[repo] || []).find(p => String(p.id) === String(choice.source.productId)) : null;
        if (repo && !product) { showAppAlert('Seçilen stok kalemi bulunamadı; liste güncellenmiş olabilir.', 'error'); return; }
        let stockChange = null;
        if (product) {
            try { stockChange = await window.runStockTransaction(repo, product.id, -qty); }
            catch (e) { showAppAlert(`Stok düşülemedi: ${e.message}`, 'error'); return; }
        }
        const restoreStock = async () => {
            if (!product) return;
            try { await window.runStockTransaction(repo, product.id, qty); } catch (e) { console.error('❌ Stok geri alma hatası:', e); }
        };

        const approver = window.currentUser?.name || 'Yönetici';
        const now = getTurkiyeSaati();
        const updated = {
            ...live, durum: 'approved', sn: snValue, approvedBy: approver, approvedAt: now,
            ...(product ? { stockRepo: repo, stockProductId: product.id } : {})
        };
        if (await _saveRequestItem(updated) === false) { await restoreStock(); showAppAlert('Onay kaydedilemedi; stok geri alındı.', 'error'); return; }

        const exitEntry = {
            id: Date.now(),
            requestId: live.id,
            shelfNo: product ? (product.raf || '-') : "TALEP",
            productType: product ? (product.ürün || product.name || live.ürün) : live.ürün,
            ...(product ? { productId: product.id } : {}),
            description: "Personel Talebi Onaylandı",
            sn: snValue,
            sarfAdet: live.adet || 1,
            note: `Onaylayan: ${approver}`,
            person: live.personel,
            alanKisi: live.personel,
            date: getTurkiyeTarihi(),
            tarih: getTurkiyeTarihi(),
            isDemirbas: [product?.isDemirbas, live.isDemirbas].some(v => v === true || v === "true"),
            talepTuru: live.talepTuru || 'Kalıcı Zimmet',
            oncelik: live.oncelik || 'Orta',
            ...(live.iadeTarihi ? { iadeTarihi: live.iadeTarihi } : {}),
            iadeEdildi: false,
            sourceRepo: product ? repo : 'TALEP',
            approvedBy: approver
        };
        const alreadyLogged = (window.data.b3 || []).some(b => String(b.requestId) === String(live.id));
        if (!alreadyLogged && await window.saveData('b3', [...(window.data.b3 || []), exitEntry]) === false) {
            // Zimmet kaydı yoksa iade stoğa dönemez: onay ve stok birlikte geri alınır.
            const reverted = await _saveRequestItem(live);
            await restoreStock();
            showAppAlert(reverted === false
                ? 'Zimmet kaydı yazılamadı; stok geri alındı ancak talep "onaylandı" kaldı. Lütfen talebi kontrol edin.'
                : 'Zimmet kaydı yazılamadı; onay ve stok geri alındı.', 'error');
        } else {
            const stockText = stockChange ? ` ${repo.toUpperCase()} stok: ${stockChange.before} → ${stockChange.after}.` : ' Stoktan düşülmedi.';
            showAppAlert(`${live.personel} isimli personelin talebi ONAYLANDI.${stockText}`, "success");
        }
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
        const onay = await showCustomConfirm("Talebi Reddet", `${request.personel} isimli personelin talebi reddedilecek. Emin misiniz?`);
        if (onay !== true) return;
        const live = _findRequest(requestId);
        if (!live || !_isPendingRequest(live)) { showAppAlert('Talep bu arada değişti; işlem iptal edildi.', 'warning'); _refreshRequestTables(); return; }
        const updated = { ...live, durum: 'rejected', rejectedBy: window.currentUser?.name || 'Yönetici', rejectedAt: getTurkiyeSaati() };
        if (await _saveRequestItem(updated) === false) { showAppAlert('Red kaydedilemedi.', 'error'); return; }
        _refreshRequestTables();
        showAppAlert(`${live.personel} talebi reddedildi.`, "error");
    } finally {
        _requestActionsInFlight.delete(lockKey);
    }
};

window.deleteRequest = async function (requestId) {
    const request = _findRequest(requestId);
    if (!request) { showAppAlert('Talep bulunamadı; liste güncellenmiş olabilir.', 'error'); return; }
    const onay = await showCustomConfirm("Kaydı Sil", "Bu talep kaydını tamamen silmek istediğinize emin misiniz? Bu işlem geri alınamaz.");
    if (onay !== true) return;
    const remaining = (window.data.requests || []).filter(r => String(r.id) !== String(requestId));
    if (await window.saveData('requests', remaining) === false) { showAppAlert('Silme kaydedilemedi.', 'error'); return; }
    _refreshRequestTables();
    showAppAlert("Talep kaydı kalıcı olarak silindi.", "info");
};

window.withdrawInventoryRequest = async function (index) {
    const req = window.data.requests[index];
    if (!req) return;
    const onay = await showCustomConfirm("Talebi Geri Çek", `${req.ürün} talebinizi geri çekmek (taslağa almak) istediğinize emin misiniz?`);
    if (onay === true) {
        req.durum = 'draft';
        // [WHY]: Tam kayıt personel oturumunda b1'de reddedilip hiçbir şeyi kaydetmiyordu (ITSM-03, DATA-03).
        await window.saveData('requests', window.data.requests);
        if (typeof renderMyRequestsTable === 'function') renderMyRequestsTable();
        showAppAlert("Talebiniz geri çekildi ve TASLAK moduna alındı.", "info");
    }
};

window.editPersonnelInventoryRequest = function (index) {
    const req = window.data.requests[index];
    if (!req) return;
    window.editingReqIndex = index;
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

window.sendDraftInventoryRequest = async function (index) {
    const req = window.data.requests[index];
    if (!req) return;
    req.durum = 'Beklemede';
    req.tarih = getTurkiyeTarihi();
    await window.saveData('requests', window.data.requests);
    if (typeof renderMyRequestsTable === 'function') renderMyRequestsTable();
    showAppAlert("Talebiniz başarıyla onaya gönderildi.", "success");
};

// 🔷 Sepet / Toplu Çıkış Sistemi
(function () {
    let cartItems = [];
    window.openCartModal = function () {
        cartItems = [];
        document.getElementById('cartSearch').value = "";
        document.getElementById('cartProductList').style.display = 'none';
        document.getElementById('cartNote').value = "";
        document.getElementById('cartPerson').value = "";
        const activeUser = window.getActiveUser();
        if (activeUser) document.getElementById('cartPerson').value = activeUser.name;
        renderCartItems();
        const modal = document.getElementById('cartModal');
        if (modal) modal.style.display = 'block';
    };

    window.searchForCart = function () {
        const searchTerm = document.getElementById('cartSearch').value.toLocaleLowerCase('tr-TR');
        const list = document.getElementById('cartProductList');
        list.innerHTML = '';
        if (searchTerm.length < 2) { list.style.display = 'none'; return; }
        const repos = ['b1', 'b2'];
        let results = [];
        repos.forEach(repo => {
            if (!window.data[repo]) return;
            window.data[repo].forEach((item, index) => {
                const isDem = window.checkIsDemirbas ? window.checkIsDemirbas(item) : (item.isDemirbas === true);
                const qty = parseInt(item.adet || item.qty || 0);
                if (qty > 0) {
                    const searchStr = `${item.ürün || ''} ${item.marka || ''} ${item.name || ''} ${item.raf || ''} ${item.sütun || ''} ${item.tür || ''} ${item.açıklama || ''}`.toLocaleLowerCase('tr-TR');
                    if (searchStr.includes(searchTerm)) {
                        results.push({ item, index, repo, isDemirbasStrict: isDem, qty });
                    }
                }
            });
        });
        if (results.length === 0) {
            list.innerHTML = `<div style="padding:10px; color:var(--color-text-muted);">Ürün bulunamadı veya stokta yok.</div>`;
        } else {
            results.forEach(res => {
                const div = document.createElement('div');
                div.style.padding = '8px';
                div.style.borderBottom = '1px solid var(--color-border-light)';
                div.style.cursor = 'pointer';
                if (res.isDemirbasStrict) {
                    div.innerHTML = `🛡️ <b>${escapeHtml(res.item.ürün || res.item.name || "-")}</b> - ${escapeHtml(res.item.marka || "")} (Stok: ${escapeHtml(res.qty)}) <br><small>Raf: ${escapeHtml(res.item.raf || "-")} / Sütun: ${escapeHtml(res.item.sütun || "-")}</small>`;
                    div.style.backgroundColor = 'var(--color-surface)';
                    div.style.color = 'var(--color-text)';
                } else {
                    div.innerHTML = `📦 <b>${escapeHtml(res.item.ürün || res.item.name || "-")}</b> - ${escapeHtml(res.item.marka || "")} (Stok: ${escapeHtml(res.qty)}) <br><small>Raf: ${escapeHtml(res.item.raf || "-")} / Sütun: ${escapeHtml(res.item.sütun || "-")}</small>`;
                }
                div.onclick = function () {
                    const isAdmin = window.checkIsAdmin() || sessionStorage.getItem('adminVizesi') === 'true';
                    if (res.isDemirbasStrict && !isAdmin) {
                        showAppAlert(`🛡️ GÜVENLİK: Bu ürün demirbaştır. Sadece yöneticiler çıkış yapabilir!`, "warning");
                        return;
                    }
                    addToCart(res);
                    document.getElementById('cartSearch').value = "";
                    list.style.display = 'none';
                };
                list.appendChild(div);
            });
        }
        list.style.display = 'block';
    };

    window.addToCart = function (res) {
        const exists = cartItems.find(c => c.repo === res.repo && c.index === res.index);
        if (exists) {
            if (exists.exitQty < res.qty) { exists.exitQty++; renderCartItems(); }
            else showAppAlert("Stokta daha fazla yok!", "warning");
        } else {
            cartItems.push({ ...res, exitQty: 1 });
            renderCartItems();
        }
    };

    window.removeFromCart = function (cartIndex) {
        cartItems.splice(cartIndex, 1);
        renderCartItems();
    };

    window.renderCartItems = function () {
        const container = document.getElementById('cartItemsContainer');
        if (cartItems.length === 0) {
            container.innerHTML = '<p style="color: var(--color-text-muted); text-align: center; margin: 0;" id="emptyCartMsg">Sepet boş. Ürün arayarak listeye ekleyin.</p>';
            return;
        }
        let html = '';
        cartItems.forEach((cartItem, idx) => {
            html += `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px; border-bottom: 1px solid var(--color-border-light); background: var(--color-surface-alt); border-radius: 4px; margin-bottom: 4px;">
                <div style="flex: 1;">
                    <strong>${escapeHtml(cartItem.item.ürün || cartItem.item.name || "-")}</strong><br>
                    <small>${escapeHtml(cartItem.item.raf || "-")} / ${escapeHtml(cartItem.item.sütun || "-")}</small>
                </div>
                <div style="display: flex; align-items: center; gap: 10px;">
                    <input type="number" min="1" max="${escapeHtml(cartItem.qty)}" value="${escapeHtml(cartItem.exitQty)}" onchange="updateCartQty(${idx}, this.value)" style="width: 60px; padding: 4px; text-align: center;">
                    <button type="button" onclick="removeFromCart(${idx})" style="background: #e74c3c; color: white; border: none; border-radius: 4px; padding: 5px 8px; cursor: pointer;"><i class="fas fa-trash"></i></button>
                </div>
            </div>`;
        });
        container.innerHTML = html;
    };

    window.updateCartQty = function (cartIndex, newVal) {
        const val = parseInt(newVal);
        const cartItem = cartItems[cartIndex];
        if (val > 0 && val <= cartItem.qty) {
            cartItem.exitQty = val;
        } else {
            renderCartItems();
            if (val > cartItem.qty) showAppAlert(`Stokta sadece ${cartItem.qty} adet var!`, "warning");
        }
    };

    window.saveCartExit = async function (event) {
        if (event) { event.preventDefault(); event.stopPropagation(); }
        if (cartItems.length === 0) { showAppAlert("Sepette çıkış yapılacak ürün yok!", "warning"); return; }
        const alanKisi = document.getElementById('cartPerson').value || "-";
        const not = document.getElementById('cartNote').value || "-";
        const sn = document.getElementById('cartSn').value || "-";
        let successCount = 0;
        const tarih = getTurkiyeSaati();

        cartItems.forEach(cartItem => {
            const product = window.data[cartItem.repo][cartItem.index];
            if (product) {
                let currentQty = parseInt(product.adet || product.qty || 0);
                if (currentQty >= cartItem.exitQty) {
                    let newQty = currentQty - cartItem.exitQty;
                    product.adet = newQty;
                    product.qty = newQty;
                    if (newQty <= 0) { product.durumu = "Tükendi"; product.status = "Tükendi"; }
                    const b3Entry = {
                        id: window.makeId(), // DATA-12: ondalıklı Date.now()+Math.random() yerine
                        rafNo: product.raf || "-",
                        sutun: product.sütun || "-",
                        urunTuru: product.tür || product.type || "-",
                        urunAciklama: product.ürün || product.name || "-",
                        sn: sn,
                        adet: cartItem.exitQty,
                        not: not,
                        alanKisi: alanKisi,
                        tarih: tarih,
                        isDemirbas: window.checkIsDemirbas ? window.checkIsDemirbas(product) : false,
                        kaynakDepo: cartItem.repo
                    };
                    if (!window.data.b3) window.data.b3 = [];
                    window.data.b3.unshift(b3Entry);
                    successCount++;
                }
            }
        });

        if (successCount > 0) {
            await window.saveData(window.data);
            showAppAlert(`${successCount} ürün kalemi için toplu çıkış başarıyla kaydedildi.`, "success");
            closeModal('cartModal');
            setTimeout(() => { if (typeof renderExitTable === 'function') renderExitTable(); }, 100);
        }
    };
})();

// Diğer monolith tablolar ve form handlers
window.searchForRequest = function () {
    const filter = document.getElementById('reqSearch').value.toLocaleLowerCase('tr-TR');
    const list = document.getElementById('reqProductList');
    if (!list) return;
    if (filter.length < 2) { list.style.display = 'none'; return; }
    list.innerHTML = '';
    const allProducts = [...(window.data.b1 || []), ...(window.data.b2 || [])];
    const results = allProducts.filter(item =>
        (item.ürün || "").toLocaleLowerCase('tr-TR').includes(filter) ||
        (item.marka || "").toLocaleLowerCase('tr-TR').includes(filter) ||
        (item.model || "").toLocaleLowerCase('tr-TR').includes(filter) ||
        (item.raf || "").toLocaleLowerCase('tr-TR').includes(filter) ||
        (item.tür || "").toLocaleLowerCase('tr-TR').includes(filter) ||
        (item.açıklama || "").toLocaleLowerCase('tr-TR').includes(filter)
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

window.searchForExit = function () {
    const filter = document.getElementById('exitSearch').value.toLocaleLowerCase('tr-TR');
    const list = document.getElementById('productList');
    list.innerHTML = '';
    if (!filter) return;
    const allProducts = [
        ...(window.data.b1 || []).map((item, index) => ({ ...item, _repo: 'b1', _index: index })),
        ...(window.data.b2 || []).map((item, index) => ({ ...item, _repo: 'b2', _index: index }))
    ];
    const results = allProducts.filter(item =>
        ((item.ürün || item.name || '')?.toLocaleLowerCase('tr-TR').includes(filter)) ||
        ((item.marka || item.tür || item.type || '')?.toLocaleLowerCase('tr-TR').includes(filter)) ||
        ((item.raf || item.shelf || '')?.toLocaleLowerCase('tr-TR').includes(filter)) ||
        ((item.açıklama || '')?.toLocaleLowerCase('tr-TR').includes(filter))
    ).slice(0, 10);

    results.forEach(item => {
        const div = document.createElement('div');
        div.className = 'product-item';
        div.style.padding = '8px';
        div.style.borderBottom = '1px solid #eee';
        div.style.cursor = 'pointer';
        const stock = item.adet !== undefined ? item.adet : (item.qty || 0);
        div.innerHTML = `<strong>${escapeHtml(item.ürün || item.name || '-')}</strong> <small>(${escapeHtml(item.marka || item.tür || '-')})</small><br><span style="font-size: 0.85em; color: #666;">Raf: ${escapeHtml(item.raf || item.shelf || '-')} | Stok: ${stock} | Depo: ${escapeHtml(item._repo.toUpperCase())}</span>`;
        if (stock > 0) {
            div.onclick = () => window.selectProduct(item.ürün || item.name, item.tür || item.type || item.marka, item.raf || item.shelf, stock, item._repo, item._index);
        } else {
            div.style.opacity = '0.5'; div.style.pointerEvents = 'none'; div.innerHTML += ' <b style="color:red;">(STOK YOK)</b>';
        }
        list.appendChild(div);
    });
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

// [WHY]: b3'te iki şema var: çıkış formu rafNo/urunTuru/urunAciklama/adet/not/tarih yazıyor; talep onayı ve admin zimmeti
//        shelfNo/productType/description/sarfAdet/note/date yazıyor. Tablo yalnız ilkini okuduğu için yeni kayıtlarda
//        yalnız Alan Kişi / Tarih / SN doluyordu. (Tek kanonik şema Faz 3 işi; burada okuyucu iki şemayı birleştirir.)
// [HOW]: Alan başına eski → yeni sırayla okunur; ürün türü yeni kayıtta yoksa productId + sourceRepo ile stok kaleminden bulunur.
window.normalizeB3Row = function (item) {
    const repo = item.sourceRepo || item.kaynakDepo;
    const product = item.productId != null && (repo === 'b1' || repo === 'b2')
        ? (window.data[repo] || []).find(p => String(p.id) === String(item.productId)) : null;
    const pick = (...vals) => vals.find(v => v !== undefined && v !== null && String(v).trim() !== '');
    return {
        raf: pick(item.rafNo, item.shelfNo, product?.raf) ?? '-',
        tur: pick(item.urunTuru, product?.tür, product?.type) ?? '-',
        urun: pick(item.urunAciklama, item.productType, product?.ürün) ?? '-',
        sn: pick(item.sn) ?? '-',
        adet: pick(item.adet, item.sarfAdet) ?? 0,
        not: pick(item.not, item.note) ?? '-',
        alanKisi: pick(item.alanKisi, item.person, item.personel) ?? '-',
        tarih: pick(item.tarih, item.date) ?? '-',
    };
};

// Sekme B3 PDF/Excel & Diğer araçlar
function renderExitTable() {
    const tbody = document.querySelector('#tableB3 tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!window.data.b3 || window.data.b3.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;">Çıkış kaydı bulunamadı.</td></tr>';
        return;
    }
    const rowsHtml = window.data.b3.map((item, index) => {
        const isPassive = (item.durumu === 'Pasif' || item.status === 'Pasif');
        const row = window.normalizeB3Row(item);
        return `<tr class="${isPassive ? 'passive-row' : ''}">
            <td>${escapeHtml(row.raf)}</td>
            <td>${escapeHtml(row.tur)}</td>
            <td>${escapeHtml(row.urun)}</td>
            <td>${escapeHtml(row.sn)}</td>
            <td>${escapeHtml(row.adet)}</td>
            <td>${escapeHtml(row.not)}</td>
            <td>${escapeHtml(row.alanKisi)}</td>
            <td>${escapeHtml(row.tarih)}</td>
            <td>
                <button class="pdf-btn" onclick="generateZimmetPDF(${index})">PDF</button>
                <button class="delete-btn" onclick="if(validateAdminAction()) deleteB3Row(${index})">Sil</button>
            </td>
        </tr>`;
    }).join('');
    tbody.innerHTML = rowsHtml;
}

window.exportPDF = function (depo) {
    if (!validateAdminAction()) return;
    const items = window.data[depo] || [];
    function getStatusClass(status) {
        if (!status) return "status-diger";
        status = status.toLowerCase();
        if (status.includes("hazır")) return "status-hazir";
        if (status.includes("sıfır")) return "status-sifir";
        if (status.includes("arız") || status.includes("bozuk") || status.includes("tutmuyor")) return "status-ariza";
        return "status-diger";
    }
    let html = `<html><head><title>${depo} Rapor</title><style>
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
    </style></head><body><div class="print-container"><div style="font-size:18px; font-weight:bold; margin-bottom:6px;">${depo.toUpperCase()} DEPO ENVANTERİ</div>
    <div style="font-size:12px; margin-bottom:14px;">Rapor Tarihi: ${getTurkiyeSaati()}</div><table><thead><tr><th>#</th><th>Sütun</th><th>Raf</th><th>Ürün</th><th>Marka</th><th>Adet</th><th>Durum</th><th>Tür</th></tr></thead><tbody>`;

    items.forEach((item, index) => {
        const status = item.durumu ?? item.status ?? "-";
        html += `<tr><td>${index + 1}</td><td>${escapeHtml(item.sütun || '-')}</td><td>${escapeHtml(item.raf || '-')}</td><td class="wrap">${escapeHtml(item.ürün || '-')}</td><td class="wrap">${escapeHtml(item.marka || '-')}</td>
        <td style="text-align:center; font-weight:600;">${escapeHtml(item.adet ?? item.qty ?? 0)}</td><td class="${getStatusClass(status)}">${status}</td><td>${escapeHtml(item.tür ?? item.type ?? '-')}</td></tr>`;
    });
    html += `</tbody></table></div></body></html>`;

    const win = window.open('', '', 'width=1400,height=900');
    win.document.write(html);
    win.document.close();
    setTimeout(() => { win.print(); win.close(); }, 300);
};

async function importExcel(event) {
    const file = event.target.files[0];
    const depo = event.target.getAttribute('data-depo') || 'b1';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async function (e) {
        let importedData = [];
        try {
            if (file.name.endsWith('.csv')) {
                const text = e.target.result;
                const rows = text.split('\n').map(row => row.split(','));
                importedData = rows.slice(1).map(row => ({
                    ürün: row[0]?.trim(),
                    tür: row[1]?.trim() || "Sarf",
                    rafNo: row[2]?.trim() || "-",
                    adet: parseInt(row[3]) || 0,
                    limit: parseInt(row[4]) || 3,
                    marka: row[5]?.trim() || "Unbranded"
                })).filter(item => item.ürün);
            } else {
                const dataArr = new Uint8Array(e.target.result);
                const workbook = XLSX.read(dataArr, { type: 'array' });
                const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                const rawRows = XLSX.utils.sheet_to_json(firstSheet);
                importedData = rawRows.map(row => {
                    const name = row['ürün'] || row['Ürün'] || row['name'] || row['Ürün Adı'] || "";
                    const type = row['cihaz türü'] || row['Tür'] || row['tür'] || row['type'] || "Sarf";
                    const shelf = row['raf'] || row['Raf No'] || row['shelf'] || row['raf no'] || "-";
                    const qty = parseInt(row['adet'] || row['Adet'] || row['qty'] || row['miktar']) || 0;
                    const brand = row['marka'] || row['Marka'] || row['brand'] || "Unbranded";
                    const column = row['sütun'] || row['Sütun'] || row['column'] || shelf.toString().split('-')[0] || "-";
                    return {
                        ürün: name.toString().trim(),
                        tür: type.toString().trim(),
                        rafNo: shelf.toString().trim(),
                        raf: shelf.toString().trim(),
                        sütun: column.toString().trim(),
                        adet: qty,
                        limit: parseInt(row['limit'] || row['Limit'] || 3) || 3,
                        marka: brand.toString().trim(),
                        durumu: row['durumu'] || row['Durumu'] || (qty > 0 ? "Mevcut" : "Tükendi"),
                        lastUpdate: new Date().getTime()
                    };
                }).filter(item => item.ürün !== "");
            }
            if (importedData.length === 0) { showAppAlert("Yüklenecek geçerli veri bulunamadı!", "error"); return; }
            const currentDepoData = window.data[depo] || [];
            const finalData = [...currentDepoData, ...importedData];
            await window.saveData(depo, finalData);
            if (typeof renderTable === 'function') renderTable(depo);
            showAppAlert(`${importedData.length} ürün başarıyla depoya eklendi ve kaydedildi!`, "success");
        } catch (err) {
            showAppAlert("Excel okunurken bir hata oluştu!", "error");
        }
    };
    reader.readAsArrayBuffer(file);
    event.target.value = '';
}

window.exportToExcel = function (depo) {
    if (!window.data || !window.data[depo]) { showAppAlert("İndirilecek veri bulunamadı!", "error"); return; }
    const items = window.data[depo];
    let excelData = [];
    let sheetName = "";
    if (depo === 'b3') {
        excelData = items.map(item => ({
            "Raf No": item.rafNo || "-",
            "Ürün Türü": item.urunTuru || "-",
            "Ürün Açıklama": item.urunAciklama || "-",
            "SN / BioPro / Itsm": item.sn || "-",
            "Adet": parseInt(item.adet) || 0,
            "Not/Gerekçe": item.not || "-",
            "Alan Kişi": item.alanKisi || "-",
            "Tarih": item.tarih || "-"
        }));
        sheetName = "Envanter Çıkış Raporu";
    } else {
        excelData = items.map(item => ({
            "Sütun": item.sütun || "-",
            "Raf/Shelf": item.raf || item.rafNo || "-",
            "Ürün Adı": item.ürün || item.name || "-",
            "Marka": item.marka || "-",
            "Adet": parseInt(item.adet || item.qty) || 0,
            "Durumu": item.durumu || "-",
            "Ürün Türü": item.tür || item.type || "-",
            "Kritik Limit": item.limit || 3,
            "Son Güncelleme": tsToTurkiye(item.lastUpdate)
        }));
        sheetName = depo.toUpperCase() + " Deposu";
    }
    const ws = XLSX.utils.json_to_sheet(excelData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    const dateStr = new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
    XLSX.writeFile(wb, `${depo.toUpperCase()}_Rapor_${dateStr}.xlsx`);
    showAppAlert(`${depo.toUpperCase()} Raporu oluşturuldu.`, "success");
};

function showCustomConfirm(title, message, callback) {
    const overlay = document.getElementById('customAlertOverlay');
    const confirmBtn = document.getElementById('alertConfirmBtn');
    const cancelBtn = document.getElementById('alertCancelBtn');
    if (!overlay) {
        const res = confirm(message);
        if (res && callback && typeof callback === 'function') callback();
        return Promise.resolve(res);
    }
    document.getElementById('alertTitle').innerText = title;
    // [WHY]: Onay metinleri kayıt verisi (ürün/evrak adı) içeriyor; innerHTML ile XSS'e açıktı (SEC-01).
    const alertMessageEl = document.getElementById('alertMessage');
    alertMessageEl.textContent = message;
    alertMessageEl.style.whiteSpace = 'pre-line';
    overlay.style.display = 'flex';
    return new Promise((resolve) => {
        confirmBtn.onclick = () => {
            overlay.style.display = 'none';
            if (callback && typeof callback === 'function') callback();
            resolve(true);
        };
        cancelBtn.onclick = () => {
            overlay.style.display = 'none';
            resolve(false);
        };
    });
}
window.showCustomConfirm = showCustomConfirm;

// [WHY]: Eski localStorage önbelleği window.data'yı Firebase'den önce eksik/bayat veriyle eziyordu (DATA-07).
// [HOW]: Tek kaynak Firestore snapshot'larıdır; kalmış önbellek bir kez silinir.
localStorage.removeItem('inventoryData');

window.loadFromDB = function (storeName) {
    return new Promise((resolve) => {
        if (!db) { setTimeout(() => window.loadFromDB(storeName).then(resolve), 100); return; }
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => resolve([]);
    });
};

function checkPermission(event) {
    if (!checkIsAdmin()) {
        if (event) { event.preventDefault(); event.stopPropagation(); }
        showAppAlert("Bu işlem sadece yönetici tarafından yapılabilir.", "error");
        return false;
    }
    return true;
}

function setupPermissionListeners() {
    const adminActions = ['#btnTopluSil', '#btnPdfExport', '.edit-btn', '.delete-btn', '.inc-btn', '.dec-btn'];
    adminActions.forEach(selector => {
        document.querySelectorAll(selector).forEach(btn => {
            const originalOnClick = btn.onclick;
            btn.onclick = (e) => {
                if (checkPermission(e)) {
                    if (originalOnClick) originalOnClick.call(btn, e);
                }
            };
        });
    });
}

function toggleFixture() {
    const btn = document.getElementById('fixtureToggle');
    const hiddenInput = document.getElementById('isFixtureHidden');
    if (!btn || !hiddenInput) return;
    if (hiddenInput.value === "false") {
        hiddenInput.value = "true"; btn.innerText = "DEMİRBAŞ"; btn.classList.add('active');
    } else {
        hiddenInput.value = "false"; btn.innerText = "Sarf Malzeme"; btn.classList.remove('active');
    }
}

function closeProductModal() {
    const modal = document.getElementById('productModal');
    if (modal) modal.style.display = "none";
}

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

// Request Actions helpers (legacy check)
function renderRequestAction(request) {
    const checkIsAdmin = checkAdmin();
    if (request.status === 'pending') {
        return checkIsAdmin
            ? `<button class="btn-deliver" onclick="updateRequestStatus(${jsArg(request.id)}, 'delivered')">Teslim Et</button>`
            : `<span class="status-waiting">Bekleniyor...</span>`;
    } else if (request.status === 'delivered') {
        return !checkIsAdmin
            ? `<button class="btn-confirm" onclick="confirmReceipt(${jsArg(request.id)})">Teslim Aldım</button>`
            : `<span class="status-delivered">Onay Bekleniyor</span>`;
    } else {
        return `<span class="status-completed">Tamamlandı</span>`;
    }
}

async function createLog(action, detail) {
    const parsed = window.getActiveUser();
    const userName = (parsed && parsed.name) || "Bilinmeyen Kullanıcı";
    const newLog = {
        date: getTurkiyeSaati(),
        user: userName,
        action: action,
        detail: detail
    };
    await saveToDB('logs', [...await getLogsFromDB(), newLog]);
}

function checkCategory(selectElement) {
    const selectedOption = selectElement.options[selectElement.selectedIndex];
    const isDemirbas = selectedOption.getAttribute('data-is-demirbas') === 'true';
    document.getElementById('isDemirbas').value = isDemirbas;
}

async function updateRequestStatus(requestId, newStatus) {
    const isAdmin = checkIsAdmin();
    const request = window.data.requests.find(r => r.id === requestId);
    if (!request) return;
    if (newStatus === 'delivered' && isAdmin) {
        request.status = 'delivered';
        request.deliveredBy = "Muhammed Cer";
        showAppAlert("Teslimat yapıldı. Personel onayı bekleniyor.", "success");
    } else if (newStatus === 'confirmed' && !isAdmin) {
        request.status = 'confirmed';
        request.confirmedDate = getTurkiyeSaati();
        await createLog("ZİMMET ONAYI", `${request.person} ürünü teslim aldı.`);
    }
    await window.saveData(window.data);
    renderTable('requests');
}

async function addRequest(event) {
    if (event) event.preventDefault();
    const activeUser = window.getActiveUser();
    const productName = document.getElementById('requestProductName').value;
    const productSn = document.getElementById('requestProductSn')?.value || "-";
    const newRequest = {
        id: Date.now(),
        tarih: getTurkiyeTarihi(),
        personel: activeUser ? activeUser.name : "Bilinmeyen Personel",
        ürün: productName,
        sn: productSn,
        durum: 'Beklemede'
    };
    if (!window.data.requests) window.data.requests = [];
    window.data.requests.push(newRequest);
    await window.saveData(window.data);
    showAppAlert("Talebiniz başarıyla iletildi.", "success");
    closeModal('request');
}

async function submitRequest(event) {
    if (event) event.preventDefault();
    const product = document.getElementById('reqProduct').value;
    const note = document.getElementById('reqNote').value;
    const user = window.getActiveUser();
    if (!product) { showAppAlert("Lütfen talep edilecek ürünü yazın.", "warning"); return; }
    const newRequest = {
        id: Date.now(),
        date: new Date().toLocaleDateString('tr-TR'),
        person: user ? user.name : 'Bilinmeyen Personel',
        product: product,
        note: note,
        status: 'pending'
    };
    if (!window.data.requests) window.data.requests = [];
    window.data.requests.push(newRequest);
    await window.saveData(window.data);
    if (typeof showSuccessBanner === 'function') showSuccessBanner("Talebiniz başarıyla iletildi!");
    closeModal('request');
    document.getElementById('requestForm').reset();
}

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
    const checkboxes = document.querySelectorAll('.req-checkbox:checked');
    if (checkboxes.length === 0) { showAppAlert("Lütfen silinecek kayıtları seçiniz.", "error"); return; }
    const idsToDelete = new Set(Array.from(checkboxes).map(cb => String(cb.value)));
    const onay = await showCustomConfirm("Toplu Silme", `${idsToDelete.size} adet kaydı kalıcı olarak silmek istediğinize emin misiniz?`);
    if (onay) {
        const remaining = (window.data.requests || []).filter(r => !idsToDelete.has(String(r.id)));
        // Kullanıcı onaylı toplu silme: saveData v2 toplu silme kilidi bilinçli olarak açılır (Faz 3.1).
        if (await window.saveData('requests', remaining, { allowBulkDelete: true }) === false) { showAppAlert('Silme kaydedilemedi.', 'error'); return; }
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
