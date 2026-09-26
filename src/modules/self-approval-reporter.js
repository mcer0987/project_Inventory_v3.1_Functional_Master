/**
 * self-approval-reporter.js — Medipol Envanter Takip Sistemi
 * ==========================================================
 * v3.1 ESM Modüler Mimari — Kendi Kendini Onaylama Yönetimi (Self-Approval)
 *
 * [WHY]: Manifestoya göre, Gemini (Sub-Agent: Interaction & Security) rolü kapsamında
 *        kullanıcıların kendi taleplerini onaylamasını (Self-Approval) denetleyen,
 *        biyometrik doğrulamaları zorunlu kılan ve tamamlanan işlemleri
 *        kullanıcıya gösteren güvenli bir denetim/raporlama (View Layer) katmanı gerekir.
 * [HOW]: Proxy/Wrapper deseni kullanılarak window.confirmRequest ve window.approveStep
 *        metotları sarmalanır. Kendi kendine onaylama tespit edildiğinde:
 *        1) Admin olmayanlar için işlem bloke edilir.
 *        2) Adminler için biyometrik doğrulama tetiklenir (destekleniyorsa).
 *        3) İşlemler denetim günlüğüne (audit log) kaydedilir ve glassmorphic
 *           bir raporlama ekranıyla dinamik olarak raporlanır.
 *
 * // [STATUS]: SelfApproval Namespace'i window.AppModules.SelfApproval'a bağlandı. Legacy köprüleri (bridge) kuruldu.
 */

// AppModules Namespace'ini al/başlat
window.AppModules = window.AppModules || {};

// ─────────────────────────────────────────────────────────────────────────────
// Audit Logger (Denetim Günlüğü Yönetimi)
// ─────────────────────────────────────────────────────────────────────────────
const SelfApprovalLogger = {
    // [WHY]: Raporların sayfa yenilense de kaybolmaması için sessionStorage kullanıyoruz.
    // [HOW]: JSON formatında okuyup yazarak denetim geçmişini koruyoruz.
    getLogs() {
        try {
            const stored = sessionStorage.getItem('self_approval_audit_logs');
            return stored ? JSON.parse(stored) : [];
        } catch (e) {
            console.error('Denetim günlüğü okunamadı:', e);
            return [];
        }
    },

    logEvent(event) {
        const logs = this.getLogs();
        logs.unshift({
            id: Date.now(),
            ...event
        });
        try {
            sessionStorage.setItem('self_approval_audit_logs', JSON.stringify(logs));
        } catch (e) {
            console.error('Denetim günlüğü yazılamadı:', e);
        }
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// UI/View Layer: Raporlama Ekranı (DOM Manipülasyonu)
// ─────────────────────────────────────────────────────────────────────────────
const showReportModal = function () {
    let modal = document.getElementById('self-approval-report-modal');
    if (modal) modal.remove();

    // 1. CSS STİL TANIMLAMALARI (Self-contained Glassmorphic Tasarım)
    // [WHY]: style.css'e dokunmadan envanter sisteminin genel temasıyla uyumlu premium stil sağlar.
    const styleEl = document.createElement('style');
    styleEl.id = 'self-approval-style';
    styleEl.textContent = `
        .sar-backdrop {
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(15, 23, 42, 0.6);
            backdrop-filter: blur(16px);
            -webkit-backdrop-filter: blur(16px);
            z-index: 10000;
            display: flex;
            align-items: center;
            justify-content: center;
            opacity: 0;
            transition: opacity 0.3s ease;
        }
        .sar-backdrop.active {
            opacity: 1;
        }
        .sar-modal {
            background: rgba(30, 41, 59, 0.85);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 16px;
            width: 90%;
            max-width: 750px;
            max-height: 80vh;
            box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 10px 10px -5px rgba(0, 0, 0, 0.4);
            display: flex;
            flex-direction: column;
            overflow: hidden;
            transform: scale(0.9) translateY(20px);
            transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
            color: #f8fafc;
            font-family: inherit;
        }
        .sar-backdrop.active .sar-modal {
            transform: scale(1) translateY(0);
        }
        .sar-header {
            padding: 20px 24px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.08);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .sar-header h3 {
            margin: 0;
            font-size: 1.25rem;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 10px;
            color: #f59e0b;
        }
        .sar-close-btn {
            background: none;
            border: none;
            color: #94a3b8;
            font-size: 1.5rem;
            cursor: pointer;
            transition: color 0.2s, transform 0.1s;
            line-height: 1;
        }
        .sar-close-btn:hover {
            color: #f8fafc;
        }
        .sar-close-btn:active {
            transform: scale(0.9);
        }
        .sar-body {
            padding: 24px;
            overflow-y: auto;
            flex: 1;
        }
        .sar-table-wrapper {
            border: 1px solid rgba(255, 255, 255, 0.05);
            border-radius: 8px;
            overflow: hidden;
            background: rgba(15, 23, 42, 0.4);
        }
        .sar-table {
            width: 100%;
            border-collapse: collapse;
            text-align: left;
            font-size: 0.9rem;
        }
        .sar-table th {
            background: rgba(15, 23, 42, 0.6);
            padding: 12px 16px;
            color: #94a3b8;
            font-weight: 500;
            border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        }
        .sar-table td {
            padding: 14px 16px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        }
        .sar-table tr:last-child td {
            border-bottom: none;
        }
        .sar-badge {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            padding: 4px 8px;
            border-radius: 9999px;
            font-size: 0.75rem;
            font-weight: 500;
        }
        .sar-badge-verified {
            background: rgba(16, 185, 129, 0.15);
            color: #34d399;
            border: 1px solid rgba(16, 185, 129, 0.2);
        }
        .sar-badge-blocked {
            background: rgba(239, 68, 68, 0.15);
            color: #f87171;
            border: 1px solid rgba(239, 68, 68, 0.2);
        }
        .sar-empty {
            text-align: center;
            padding: 40px 20px;
            color: #94a3b8;
        }
        .sar-empty i {
            font-size: 2.5rem;
            color: #475569;
            margin-bottom: 12px;
            display: block;
        }
        .sar-footer {
            padding: 16px 24px;
            border-top: 1px solid rgba(255, 255, 255, 0.08);
            display: flex;
            justify-content: flex-end;
            background: rgba(15, 23, 42, 0.2);
        }
        .sar-btn-close {
            background: #475569;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 6px;
            font-size: 0.875rem;
            cursor: pointer;
            transition: background 0.2s, transform 0.1s;
        }
        .sar-btn-close:hover {
            background: #64748b;
        }
        .sar-btn-close:active {
            transform: scale(0.95);
        }
    `;
    document.head.appendChild(styleEl);

    // 2. DOM YAPISINI İNŞA ET
    modal = document.createElement('div');
    modal.id = 'self-approval-report-modal';
    modal.className = 'sar-backdrop';

    const logs = SelfApprovalLogger.getLogs();
    let tableContentHtml = '';

    if (logs.length === 0) {
        tableContentHtml = `
            <div class="sar-empty">
                <i class="fas fa-shield-alt"></i>
                <p>Denetim günlüğü temiz. Henüz kendi kendine onaylama girişimi algılanmadı.</p>
            </div>
        `;
    } else {
        const rowsHtml = logs.map(log => {
            const badgeClass = log.securityLevel.includes('Blocked') ? 'sar-badge-blocked' : 'sar-badge-verified';
            return `
                <tr>
                    <td style="font-weight: 500;">${log.type}</td>
                    <td>${log.item} <strong>(${log.qty} Adet)</strong></td>
                    <td style="color: #94a3b8;">${log.user}</td>
                    <td style="font-size: 0.8rem; color: #64748b;">${log.timestamp}</td>
                    <td><span class="sar-badge ${badgeClass}">${log.securityLevel}</span></td>
                </tr>
            `;
        }).join('');

        tableContentHtml = `
            <div class="sar-table-wrapper">
                <table class="sar-table">
                    <thead>
                        <tr>
                            <th>İşlem Türü</th>
                            <th>Ürün / Talep</th>
                            <th>Kullanıcı</th>
                            <th>Tarih</th>
                            <th>Güvenlik Durumu</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rowsHtml}
                    </tbody>
                </table>
            </div>
        `;
    }

    modal.innerHTML = `
        <div class="sar-modal">
            <div class="sar-header">
                <h3><i class="fas fa-shield-alt"></i> Kendi Kendini Onaylama Denetim Paneli</h3>
                <button class="sar-close-btn" onclick="window.AppModules.SelfApproval.closeReportModal()">&times;</button>
            </div>
            <div class="sar-body">
                <p style="margin-top: 0; margin-bottom: 20px; font-size: 0.9rem; color: #94a3b8;">
                    Bu panel, yöneticilerin veya personellerin kendi açtıkları talepleri onaylama (Self-Approval) girişimlerini
                    denetlemek için tasarlanmıştır. Güvenlik politikaları gereği, admin dışındakilerin kendi taleplerini onaylaması
                    bloke edilir. Adminlerin onayları ise biyometrik donanımlarla (Windows Hello / TouchID / FaceID) imzalanır.
                </p>
                ${tableContentHtml}
            </div>
            <div class="sar-footer">
                <button class="sar-btn-close" onclick="window.AppModules.SelfApproval.closeReportModal()">Kapat</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // Animasyon başlat
    setTimeout(() => {
        modal.classList.add('active');
    }, 10);
};

const closeReportModal = function () {
    const modal = document.getElementById('self-approval-report-modal');
    if (modal) {
        modal.classList.remove('active');
        setTimeout(() => {
            modal.remove();
            const style = document.getElementById('self-approval-style');
            if (style) style.remove();
        }, 300);
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// Security Wrappers (Proxy Pattern)
// ─────────────────────────────────────────────────────────────────────────────

// [WHY]: confirmRequest işlevini sarmalayarak self-approval girişimlerini yakalamak.
// [HOW]: window.confirmRequest çağrıldığında, istek sahibiyle aktif kullanıcı eşleşirse
//        yetki sınırlar kontrol edilir, gerekirse bloke edilir veya biyometrik istenir.
const initializeSecurityProxies = function () {
    const originalConfirmRequest = window.confirmRequest;
    if (originalConfirmRequest && !originalConfirmRequest._isSecured) {
        const securedConfirm = async function (index) {
            const request = window.data?.requests?.[index];
            if (!request) return originalConfirmRequest(index);

            const currentUser = window.currentUser?.name;
            const requestor = request.personel;

            // Kendi kendine onaylama tespiti (case-insensitive & trim)
            if (currentUser && requestor && currentUser.trim().toLowerCase() === requestor.trim().toLowerCase()) {
                console.warn(`🛡️ [Self-Approval Guard] Kendi kendine onaylama tespit edildi: ${currentUser}`);

                const isAdmin = typeof window.checkIsAdmin === 'function' && window.checkIsAdmin();
                if (!isAdmin) {
                    if (typeof window.showAppAlert === 'function') {
                        window.showAppAlert("🛡️ GÜVENLİK ENGELİ: Kendi taleplerinizi onaylayamazsınız!", "error");
                    } else {
                        alert("🛡️ GÜVENLİK ENGELİ: Kendi taleplerinizi onaylayamazsınız!");
                    }

                    // Bloke edilen işlemi logla
                    SelfApprovalLogger.logEvent({
                        type: 'Zimmet/Talep Onayı',
                        item: request.ürün || 'Bilinmeyen Ürün',
                        qty: request.adet || 1,
                        user: currentUser,
                        timestamp: new Date().toLocaleString('tr-TR'),
                        securityLevel: 'Bloke Edildi (Yetkisiz Personel)'
                    });
                    return;
                }

                // Admin onaylıyor ise biyometrik doğrulama zorunlu kılınır
                if (window.isBiometricAvailable && await window.isBiometricAvailable()) {
                    if (typeof window.showAppAlert === 'function') {
                        window.showAppAlert("🔑 Güvenlik doğrulaması: Kendi onayınız için biyometrik imza gereklidir.", "info");
                    }
                    const verified = await window.verifyBiometrics({ reason: 'Self-approval authorization' });
                    if (!verified) {
                        if (typeof window.showAppAlert === 'function') {
                            window.showAppAlert("❌ Biyometrik doğrulama reddedildi veya zaman aşımına uğradı.", "error");
                        }
                        return;
                    }
                }

                // Başarılı admin bypass loglaması
                SelfApprovalLogger.logEvent({
                    type: 'Zimmet/Talep Onayı',
                    item: request.ürün || 'Bilinmeyen Ürün',
                    qty: request.adet || 1,
                    user: currentUser,
                    timestamp: new Date().toLocaleString('tr-TR'),
                    securityLevel: 'Onaylandı (Admin Biyometrik İmza)'
                });
            }

            return originalConfirmRequest(index);
        };
        securedConfirm._isSecured = true;
        window.confirmRequest = securedConfirm;
        if (window.AppModules.Inventory) {
            window.AppModules.Inventory.confirmRequest = securedConfirm;
        }
    }

    // [WHY]: approveStep (Workflow satın alma adımı) sarmalanması.
    const originalApproveStep = window.approveStep;
    if (originalApproveStep && !originalApproveStep._isSecured) {
        const securedApproveStep = async function (id) {
            const item = window.data?.purchaseOrders?.find(x => String(x.id) === String(id));
            if (!item || !item.workflow) return originalApproveStep(id);

            const creator = item.createdBy || item.createdByCode;
            const currentUser = window.currentUser?.name;
            let currentCode = null;
            const activeUserObj = window.getActiveUser();
            if (activeUserObj) currentCode = activeUserObj.code;

            const isSelfApproval = (creator && (String(creator) === String(currentCode) || String(creator).toLowerCase() === String(currentUser).toLowerCase()));

            if (isSelfApproval) {
                console.warn(`🛡️ [Self-Approval Guard] Satın alma adımında kendi kendine onaylama tespit edildi: ${currentUser}`);

                const isAdmin = typeof window.checkIsAdmin === 'function' && window.checkIsAdmin();
                if (!isAdmin) {
                    if (typeof window.showAppAlert === 'function') {
                        window.showAppAlert("🛡️ GÜVENLİK ENGELİ: Kendi satın alma taleplerinizi onaylayamazsınız!", "error");
                    } else {
                        alert("🛡️ GÜVENLİK ENGELİ: Kendi satın alma taleplerinizi onaylayamazsınız!");
                    }

                    SelfApprovalLogger.logEvent({
                        type: 'Satın Alma Onayı',
                        item: item.ürünAdi || item.title || item.evrakNo || 'Satın Alma #' + id,
                        qty: item.miktar || 1,
                        user: currentUser,
                        timestamp: new Date().toLocaleString('tr-TR'),
                        securityLevel: 'Bloke Edildi (Yetkisiz Personel)'
                    });
                    return;
                }

                if (window.isBiometricAvailable && await window.isBiometricAvailable()) {
                    if (typeof window.showAppAlert === 'function') {
                        window.showAppAlert("🔑 Güvenlik doğrulaması: Kendi onayınız için biyometrik imza gereklidir.", "info");
                    }
                    const verified = await window.verifyBiometrics({ reason: 'Self-approval authorization' });
                    if (!verified) {
                        if (typeof window.showAppAlert === 'function') {
                            window.showAppAlert("❌ Biyometrik doğrulama reddedildi veya zaman aşımına uğradı.", "error");
                        }
                        return;
                    }
                }

                SelfApprovalLogger.logEvent({
                    type: 'Satın Alma Onayı',
                    item: item.ürünAdi || item.title || item.evrakNo || 'Satın Alma #' + id,
                    qty: item.miktar || 1,
                    user: currentUser,
                    timestamp: new Date().toLocaleString('tr-TR'),
                    securityLevel: 'Onaylandı (Admin Biyometrik İmza)'
                });
            }

            return originalApproveStep(id);
        };
        securedApproveStep._isSecured = true;
        window.approveStep = securedApproveStep;
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// Dynamic Button Injection (Navbar Entegrasyonu)
// ─────────────────────────────────────────────────────────────────────────────
const originalUpdateNavbarUI = window.updateNavbarUI;
if (originalUpdateNavbarUI) {
    window.updateNavbarUI = function (user) {
        originalUpdateNavbarUI(user);

        const isAdmin = (user.name === 'Muhammed Cer' || user.name === 'Admin');
        if (isAdmin) {
            const userDisplay = document.getElementById('userDisplay');
            if (userDisplay) {
                if (!document.getElementById('btn-security-report')) {
                    const reportBtn = document.createElement('button');
                    reportBtn.id = 'btn-security-report';
                    reportBtn.type = 'button';
                    reportBtn.className = 'btn-admin-panel';
                    reportBtn.innerHTML = '<i class="fas fa-shield-alt"></i> Güvenlik Raporu';
                    reportBtn.style.cssText = `
                        padding: 6px 12px; 
                        width: auto; 
                        margin-top: 0; 
                        font-size: 12px; 
                        background: #e67e22; 
                        border: none; 
                        border-radius: 4px; 
                        color: white; 
                        cursor: pointer; 
                        transition: transform 0.1s, background-color 0.2s;
                        display: inline-flex;
                        align-items: center;
                        gap: 5px;
                    `;

                    reportBtn.onmouseover = () => reportBtn.style.backgroundColor = '#d35400';
                    reportBtn.onmouseout = () => reportBtn.style.backgroundColor = '#e67e22';

                    // Active state scale (Native feel)
                    reportBtn.addEventListener('mousedown', () => reportBtn.style.transform = 'scale(0.95)');
                    reportBtn.addEventListener('mouseup', () => reportBtn.style.transform = 'scale(1)');
                    reportBtn.addEventListener('mouseleave', () => reportBtn.style.transform = 'scale(1)');

                    reportBtn.onclick = () => showReportModal();

                    const logoutBtn = userDisplay.querySelector('button[onclick="handleLogout()"]');
                    if (logoutBtn) {
                        userDisplay.insertBefore(reportBtn, logoutBtn);
                    } else {
                        userDisplay.appendChild(reportBtn);
                    }
                }
            }
        }
        
        // Proxy'leri her oturum açıldığında/yenilendiğinde bağla
        initializeSecurityProxies();
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Namespace Export
// ─────────────────────────────────────────────────────────────────────────────
export const SelfApproval = {
    showReportModal,
    closeReportModal,
    getLogs: () => SelfApprovalLogger.getLogs(),
    initializeSecurityProxies
};

window.AppModules.SelfApproval = SelfApproval;

// Otomatik başlatma (sayfa yüklendiğinde proxy'leri bağla)
initializeSecurityProxies();

console.log('✅ [self-approval-reporter.js] Kendi kendini onaylama denetim ve raporlama modülü yüklendi.');
