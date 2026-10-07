/**
 * modules/main.js — Medipol Envanter Takip Sistemi
 * =================================================
 * v3.1 ESM Modüler Mimari — Phase 6: Merkezi Orchestrator & PubSub Router
 */

// 1. Initialize window.AppModules at the very top
window.AppModules = window.AppModules || {};

// 2. Import in the correct order
import * as Utils from '../utils/utils.js';
import '../../security-biometrics.js';                      // [SECURITY_GUARD] must run BEFORE auth-engine
import * as Auth from './auth-engine.js';
import { TableEngine } from '../ui/table-engine.js';
import { InventoryLogic } from './inventory-logic.js';
import { UIComponents } from '../ui/ui-components.js';      // Phase 5 — STRICTLY after InventoryLogic
import { SelfApproval } from './self-approval-reporter.js';

// Assign namespaces
window.AppModules.Utils        = Utils;
window.AppModules.Auth         = Auth;
window.AppModules.Table        = TableEngine;
window.AppModules.Inventory    = InventoryLogic;
window.AppModules.UI           = UIComponents;           // Phase 5
window.AppModules.SelfApproval = SelfApproval;



// 3. LOGOUT OBSERVER (Soft Reset Mekanizması)
window.addEventListener('onAppLogout', (e) => {
    const reason = (e && e.detail) ? e.detail.reason : 'manual';
    console.log(`🔄 [Observer - main.js] Logout event algılandı (${reason}). Soft Reset başlatılıyor...`);

    // [WHY]: userAuth'u yalnız onAuthStateChanged yönetir; burada null'lamak yeniden girişte kayıtları reddettiriyordu (AUTH-10).
    window.currentUser = null;
    window._initialRenderDone = false;
    window.isFirebaseLoaded = false;
    window._launchpadTriggered = false;

    const userDisplay = document.getElementById('userDisplay');
    if (userDisplay) userDisplay.remove();

    const statusDiv = document.getElementById('loginStatus');
    if (statusDiv) { statusDiv.innerHTML = ''; delete statusDiv.dataset.loginMsg; }

    const codeInput = document.getElementById('access-val-node');
    if (codeInput) {
        codeInput.value = '';
        if (window._dx && typeof window._dx._r === 'function') {
            window._dx._r('access-val-node');
        }
    }

    // [WHY]: 'hidden-modal' sınıfını hiçbir açıcı kaldırmadığı için yeniden girişte tüm modallar görünmez kalıyordu (UI-02).
    // [HOW]: Yalnız satır içi display kaldırılır; açıcılar display'i yeniden ayarladığında modal görünür.
    document.querySelectorAll('.modal, .modern-modal, .app-modal, .checklist-modal').forEach(m => {
        if (m.id !== 'loginModal' && m.id !== 'adminLockModal') {
            m.style.display = 'none';
        }
    });

    const inventoryScreen = document.getElementById('inventory-screen');
    if (inventoryScreen) {
        inventoryScreen.style.setProperty('display', 'block', 'important');
        inventoryScreen.style.setProperty('filter', 'blur(12px)', 'important');
        inventoryScreen.style.setProperty('pointer-events', 'none', 'important');
        inventoryScreen.style.setProperty('user-select', 'none', 'important');
    }

    const adminLockModal = document.getElementById('adminLockModal');
    const loginModal = document.getElementById('loginModal');

    if (reason === 'timeout' && adminLockModal) {
        adminLockModal.style.setProperty('display', 'flex', 'important');
        console.log("🔒 [Soft Reset] Admin paneli kilitlendi (Timeout).");
        return;
    }

    if (loginModal) {
        loginModal.classList.remove('hidden-modal');
        loginModal.style.setProperty('display', 'flex', 'important');
        if (codeInput) {
            setTimeout(() => codeInput.focus(), 100);
        }
        console.log("✅ [Soft Reset] Login modalı temiz bir şekilde tetiklendi.");
    }

    if (typeof window.checkAuth === 'function') {
        window.checkAuth();
    }
});

// 4. Move the onInventoryDataUpdated PubSub listener here
// Routing events to AppModules.Table and AppModules.Inventory
window.addEventListener('onInventoryDataUpdated', (e) => {
    if (!e || !e.detail) return;
    
    // [WHY]: firebase-handler.js her veri güncellemesinde onInventoryDataUpdated
    //        custom event'ini yayınlar. main.js router'ı bunu yakalayarak,
    //        Table ve Inventory namespaces'ine göre ilgili render/güncellemeleri yönlendirir.
    const colName = e.detail.collection || e.detail.repo;
    if (!colName) return;

    console.log(`📡 [main.js Router] onInventoryDataUpdated event routed for collection: ${colName}`);

    // Tablo Render (B1 veya B2 yüklendiğinde / güncellendiğinde)
    if (colName === 'b1' || colName === 'b2') {
        if (!window._firstDataRendered) {
            window._firstDataRendered = true;
            setTimeout(() => {
                const activeEl = document.querySelector('.tab-content.active');
                const activeId = activeEl ? activeEl.id : 'b1';
                if (typeof window.switchTab === "function") window.switchTab(activeId);
            }, 50);
        } else {
            const activeEl = document.querySelector('.tab-content.active');
            if (activeEl && activeEl.id === colName) {
                if (e.detail.isPatch && e.detail.changes && e.detail.changes.length > 0) {
                    if (window.AppModules.Table && typeof window.AppModules.Table.patchDOMForCollection === 'function') {
                        window.AppModules.Table.patchDOMForCollection(colName, e.detail.changes);
                    }
                } else {
                    if (window.AppModules.Table && typeof window.AppModules.Table.renderTable === 'function') {
                        window.AppModules.Table.renderTable(colName);
                    }
                }
            }
        }
    }

    // Zimmet tablosu (B3)
    if (colName === 'b3') {
        const activeEl = document.querySelector('.tab-content.active');
        if (activeEl && activeEl.id === 'b3') {
            if (typeof window.renderExitTable === 'function') {
                window.renderExitTable();
            } else if (window.AppModules.Table && typeof window.AppModules.Table.renderTable === 'function') {
                window.AppModules.Table.renderTable('b3');
            }
        }
    }

    // Satın alma, servis kayıtları, birimler, locations, tasks vb. (Diğer UI dosyaları)
    if (colName === 'purchaseOrders' || colName === 'serviceRecords') {
        if (typeof window.renderPurchaseModule === 'function') window.renderPurchaseModule();
    }
    // [WHY]: "Bana gelen onaylar" ve "Kişi Envanterim" canlı güncellenmiyordu (EBYS-19, ITSM-04).
    if (colName === 'purchaseOrders') {
        if (typeof window.renderMyApprovals === 'function') window.renderMyApprovals();
    }
    if (colName === 'b3' || colName === 'assignments') {
        if (typeof window.renderPersonnelInventoryTable === 'function') window.renderPersonnelInventoryTable();
    }
    if (colName === 'units') {
        if (typeof window.renderUnitManagement === 'function') window.renderUnitManagement();
    }
    if (colName === 'requests') {
        if (typeof window.renderAdminRequestTable === 'function') window.renderAdminRequestTable();
        if (typeof window.renderRequestsTable === 'function') window.renderRequestsTable();
        if (typeof window.renderMyRequestsTable === 'function') window.renderMyRequestsTable();
        if (typeof window.renderPersonnelInventoryTable === 'function') window.renderPersonnelInventoryTable();
    }
    if (colName === 'requests' || colName === 'b3') {
        if (typeof window.renderExitCharts === 'function') window.renderExitCharts();
        const invTab = document.getElementById('inventoryManagementTab');
        if (invTab && invTab.style.display !== 'none' && window.inventoryManagementModule) {
            window.inventoryManagementModule.renderTable();
        }
    }
    if ((colName === 'b1' || colName === 'b2' || colName === 'assignments') && window.inventoryManagementModule) {
        const invTab = document.getElementById('inventoryManagementTab');
        if (invTab && invTab.style.display !== 'none') {
            window.inventoryManagementModule.renderTable();
        }
    }
    if (colName === 'locations') {
        if (typeof window.renderLocationsTable === 'function') window.renderLocationsTable();
    }
    if (colName === 'tasks') {
        if (typeof window.renderTodoTab === 'function') window.renderTodoTab();
        if (typeof window.renderMyTasksTab === 'function') window.renderMyTasksTab();
        if (typeof window.checkPendingTasks === 'function') window.checkPendingTasks();
    }
});

console.log("✅ [modules/main.js] Merkezi Orchestrator ve PubSub Router yüklendi.");
