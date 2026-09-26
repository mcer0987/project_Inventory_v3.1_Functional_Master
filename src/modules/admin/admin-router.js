/**
 * modules/admin/admin-router.js — admin.html canlı veri yönlendiricisi (Orchestrator)
 */
// [WHY]: admin.html'de onInventoryDataUpdated'i dinleyen bir router yoktu; başka cihazdaki değişiklikler
//        yalnız açılışta ve sekme geçişinde görünüyordu (ARC-04).
// [HOW]: Değişen koleksiyonlar bir kümede toplanır, requestAnimationFrame ile tek geçişte ilgili render'lar çağrılır.
//        İlk tam render LoadingCoordinator.reveal() tarafından yapıldığı için reveal'dan önceki olaylar yok sayılır.

const ROUTES = [
    { cols: ['b1', 'b2', 'productTypes'], renders: ['renderDashboardStats', 'renderCriticalStockTable', 'renderProductTypesTable'] },
    { cols: ['requests', 'b3'], renders: ['renderAdminRequestTable', 'renderExitCharts'] },
    { cols: ['locations'], renders: ['renderLocationsTable'] },
    { cols: ['units'], renders: ['renderUnitManagement'] },
    { cols: ['tasks'], renders: ['renderTodoTab', 'checkPendingTasks'] },
];
const INVENTORY_MGMT_COLS = ['b1', 'b2', 'b3', 'requests', 'assignments'];

const dirty = new Set();
let scheduled = false;

function safeCall(name, fn) {
    try { fn(); } catch (err) { console.error(`❌ [admin-router] ${name} render hatası:`, err); }
}

function flush() {
    scheduled = false;
    const cols = [...dirty];
    dirty.clear();

    const toRun = new Set();
    ROUTES.forEach(r => { if (r.cols.some(c => cols.includes(c))) r.renders.forEach(fn => toRun.add(fn)); });
    toRun.forEach(fn => { if (typeof window[fn] === 'function') safeCall(fn, () => window[fn]()); });

    if (cols.includes('tasks') && window.todoModule && typeof window.todoModule.updateNavBadge === 'function') {
        safeCall('updateNavBadge', () => window.todoModule.updateNavBadge());
    }

    const invTab = document.getElementById('inventoryManagementTab');
    if (cols.some(c => INVENTORY_MGMT_COLS.includes(c)) && invTab && invTab.style.display !== 'none' && window.inventoryManagementModule) {
        safeCall('inventoryManagementModule.renderTable', () => window.inventoryManagementModule.renderTable());
    }
}

window.addEventListener('onInventoryDataUpdated', (e) => {
    const col = e && e.detail && (e.detail.collection || e.detail.repo);
    if (!col) return;
    if (!window.LoadingCoordinator || !window.LoadingCoordinator.isRevealed) return;
    dirty.add(col);
    if (!scheduled) {
        scheduled = true;
        requestAnimationFrame(flush);
    }
});

console.log('✅ [admin-router.js] Admin canlı veri yönlendiricisi yüklendi.');
