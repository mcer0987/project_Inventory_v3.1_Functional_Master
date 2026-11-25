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
import './inventory-no-change.js';     // v3.6: Operasyon Merkezi › Envanter No Değişimi
import '../../ui/ebys-catalog-ui.js';  // v3.4 EBYS H6b: Tanımlar › Kurum Künyesi, Dosya Planı, Üst Yazı Şablonları
import '../self-approval-reporter.js';   // J4: Güvenlik Raporu iki sayfada (EBYS-05)
import '../../services/admin-grant-service.js';   // İP-7: VIP › Yönetici Yetkileri (ana yöneticinin verdiği yetki)
import '../../services/brand-settings-service.js'; // v3.8 UX-5: Marka & Logo Ayarları (system_config/items/brand_settings)

window.AppModules = window.AppModules || {};

// v3.6 · AGENTS.md (panel açıklaması + yardım): [data-panel-help] düğmesi aria-controls ile bağlı yardım alanını açar/kapatır.
// Tek belge düzeyi dinleyici — WMS ve Operasyon Merkezi panelleri aynı deseni kullanır.
document.addEventListener('click', event => {
    const button = event.target.closest('[data-panel-help]');
    if (!button) return;
    const panel = document.getElementById(button.getAttribute('aria-controls'));
    if (!panel) return;
    const open = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', String(open));
    panel.hidden = !open;
});

// [WHY]: admin.html'de window.currentUser hiç set edilmiyordu; onay/red ve TODO kimliksiz kalıyordu (EBYS-08, TODO-03).
window.currentUser = window.getActiveUser();
const welcomeEl = document.getElementById('welcomeUserName');
if (welcomeEl) welcomeEl.textContent = ((window.currentUser && window.currentUser.name) || 'Admin').toLocaleUpperCase('tr-TR');
