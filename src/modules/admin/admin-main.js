/**
 * modules/admin/admin-main.js — admin.html tek giriş modülü (Orchestrator)
 */
// [WHY]: admin.html'de modüller ayrı tag'lerle ve farklı ?v= URL'leriyle yükleniyordu; firebase-handler iki kez çalışıyordu (ARC-02).
// [HOW]: Tüm admin modülleri tek URL ile, eski tag sırasıyla buradan import edilir. Son ikisi yalnız yan-etki import'udur.
import '../../services/firebase-handler.js';
import '../../services/ebys-rates.js';
import '../../ui/ebys-documents-ui.js';
import './admin-dashboard.js';
import '../../services/purchase-servises.js';
import '../edm-workflow.js';
import './admin-purchase-render.js';
import './inventory-management.js';
import './admin-backup.js';            // K3 · ADM-06: birleşik yedekleme servisi (VIP snapshot + geri yükleme)
import './admin-router.js';
import '../self-approval-reporter.js';   // J4: Güvenlik Raporu iki sayfada (EBYS-05)

window.AppModules = window.AppModules || {};

// [WHY]: admin.html'de window.currentUser hiç set edilmiyordu; onay/red ve TODO kimliksiz kalıyordu (EBYS-08, TODO-03).
window.currentUser = window.getActiveUser();
const welcomeEl = document.getElementById('welcomeUserName');
if (welcomeEl) welcomeEl.textContent = ((window.currentUser && window.currentUser.name) || 'Admin').toLocaleUpperCase('tr-TR');
