/**
 * modules/admin/admin-main.js — admin.html tek giriş modülü (Orchestrator)
 */
// [WHY]: admin.html'de modüller ayrı tag'lerle ve farklı ?v= URL'leriyle yükleniyordu; firebase-handler iki kez çalışıyordu (ARC-02).
// [HOW]: Tüm admin modülleri tek URL ile, eski tag sırasıyla buradan import edilir. Son ikisi yalnız yan-etki import'udur.
import '../../services/firebase-handler.js';
import './admin-dashboard.js';
import '../../services/purchase-servises.js';
import '../edm-workflow.js';
import './admin-purchase-render.js';
import './inventory-management.js';

window.AppModules = window.AppModules || {};

console.log('✅ [admin-main.js] Admin giriş modülü yüklendi.');
