/**
 * self-approval-reporter.js — Medipol Envanter Takip Sistemi
 * ==========================================================
 * Kendi Kendini Onaylama (Self-Approval) — denetim raporu arayüzü
 *
 * [WHY]: Faz 4 · J4 (EBYS-04, EBYS-05, M12) — bu modül window.confirmRequest / window.approveStep'i sarmalıyordu (monkey-patch):
 *        kontrol yalnız index'te ve yalnız çağrı window üzerinden gelirse çalışıyordu, admin.html'de hiç yoktu; günlük
 *        sessionStorage'daydı (sekme kapanınca kayboluyordu); admin onayı "biyometrik imza" diye 5 karakterlik prompt'a düşüyordu.
 * [HOW]: Kural artık iş mantığında: confirmRequest (src/modules/request-actions.js) ve approveStep (edm-workflow.js) SecurityConfig.guardSelfApproval
 *        çağırır; politika Schema.isSelfApproval, günlük firebase-handler appendAuditLog (${ROOT}/auditLogs, yalnız ekleme).
 *        Bu modül yalnız RAPOR arayüzüdür: günlüğü açılışta tek seferlik okur (fetchAuditLogs, son 200) ve gösterir.
 *        Buton iki sayfada da yalnız Firebase admin oturumunda: index navbar'ı (onNavbarRendered) ve admin.html üst çubuğu.
 */

window.AppModules = window.AppModules || {};

const RESULT_BADGE = {
    blocked:   ['sar-badge-blocked', 'Engellendi'],
    approved:  ['sar-badge-verified', 'Onaylandı (parola doğrulandı)'],
    cancelled: ['sar-badge-cancelled', 'Vazgeçildi / onay verilmedi'],
};
const AUTH_LABEL = { admin: 'yönetici', anonymous: 'personel', password: 'parola' };

const _fmtTs = ts => {
    try {
        const d = ts && typeof ts.toDate === 'function' ? ts.toDate() : (ts ? new Date(ts) : null);
        return d && !isNaN(d) ? d.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }) : '-';
    } catch (e) { return '-'; }
};

function _injectStyle() {
    if (document.getElementById('self-approval-style')) return;
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
        .sar-badge-cancelled {
            background: rgba(148, 163, 184, 0.15);
            color: #cbd5e1;
            border: 1px solid rgba(148, 163, 184, 0.2);
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
}

function _rowsHtml(logs) {
    return logs.map(log => {
        const [badgeClass, label] = RESULT_BADGE[log.result] || ['sar-badge-cancelled', String(log.result || '-')];
        return `
            <tr>
                <td style="font-size: 0.8rem; color: #94a3b8; white-space: nowrap;">${escapeHtml(_fmtTs(log.ts))}</td>
                <td style="font-weight: 500;">${escapeHtml(log.type || '-')}</td>
                <td>${escapeHtml(log.item || '-')} <strong>(${escapeHtml(log.qty ?? 1)} Adet)</strong></td>
                <td style="color: #94a3b8;">${escapeHtml(log.actorName || '-')}<br><small>${escapeHtml(AUTH_LABEL[log.authKind] || log.authKind || '')} · ${escapeHtml(log.page || '')}</small></td>
                <td><span class="sar-badge ${escapeHtml(badgeClass)}">${escapeHtml(label)}</span><br><small style="color:#94a3b8;">${escapeHtml(log.reason || '')}</small></td>
            </tr>`;
    }).join('');
}

function _bodyHtml(logs) {
    if (!logs.length) {
        return `
            <div class="sar-empty">
                <i class="fas fa-shield-alt"></i>
                <p>Denetim günlüğü temiz. Henüz kendi kendine onaylama girişimi kaydedilmedi.</p>
            </div>`;
    }
    const rowsHtml = _rowsHtml(logs);
    return `
        <div class="sar-table-wrapper">
            <table class="sar-table">
                <thead>
                    <tr><th>Tarih</th><th>İşlem Türü</th><th>Ürün / Talep</th><th>Kullanıcı</th><th>Sonuç</th></tr>
                </thead>
                <tbody>${rowsHtml}</tbody>
            </table>
        </div>`;
}

const showReportModal = async function () {
    if (!(typeof window.isDbAdmin === 'function' && window.isDbAdmin())) {
        if (typeof window.showAppAlert === 'function') window.showAppAlert('🔒 Güvenlik raporu yönetici oturumu gerektirir.', 'error');
        return;
    }
    document.getElementById('self-approval-report-modal')?.remove();
    _injectStyle();

    const modal = document.createElement('div');
    modal.id = 'self-approval-report-modal';
    modal.className = 'sar-backdrop';
    modal.innerHTML = `
        <div class="sar-modal">
            <div class="sar-header">
                <h3><i class="fas fa-shield-alt"></i> Kendi Kendini Onaylama Denetim Paneli</h3>
                <button class="sar-close-btn" data-action="close">&times;</button>
            </div>
            <div class="sar-body">
                <p style="margin-top: 0; margin-bottom: 20px; font-size: 0.9rem; color: #94a3b8;">
                    Kendi açtığı talebi veya satın alma adımını onaylama girişimleri. Personelin girişimi engellenir; yöneticinin
                    kendi kaydını onaylaması parolanın yeniden doğrulanmasını gerektirir. Kayıtlar veritabanında tutulur ve
                    değiştirilemez / silinemez (son 200 kayıt).
                </p>
                <div id="sarContent" class="sar-empty"><p>Denetim günlüğü yükleniyor…</p></div>
            </div>
            <div class="sar-footer">
                <button class="sar-btn-close" data-action="close">Kapat</button>
            </div>
        </div>`;
    window.bindActions(modal, { close: () => closeReportModal() });
    document.body.appendChild(modal);
    setTimeout(() => modal.classList.add('active'), 10);

    const content = modal.querySelector('#sarContent');
    try {
        const logs = await window.fetchAuditLogs(200);
        content.className = '';
        content.innerHTML = _bodyHtml(logs);
        content.dataset.count = String(logs.length);
    } catch (e) {
        console.error('[self-approval-reporter] Denetim günlüğü okunamadı:', e);
        content.textContent = `Denetim günlüğü okunamadı: ${e.code || e.message}`;
    }
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
// Navbar düğmesi (index) — admin.html'de düğme üst çubukta sabittir
// ─────────────────────────────────────────────────────────────────────────────
// [WHY]: Düğme ada göre ('Muhammed Cer' / 'Admin') çıkıyordu: "Yönetici" kimlikli admin göremiyor, o adla giren personel görüyordu.
// [HOW]: auth-engine her navbar çiziminden sonra 'onNavbarRendered' yayınlar; düğme yalnız Firebase admin oturumunda eklenir.
window.addEventListener('onNavbarRendered', () => {
    if (!(typeof window.isDbAdmin === 'function' && window.isDbAdmin())) return;
    const userDisplay = document.getElementById('userDisplay');
    if (!userDisplay || document.getElementById('btn-security-report')) return;
    const reportBtn = document.createElement('button');
    reportBtn.id = 'btn-security-report';
    reportBtn.type = 'button';
    reportBtn.className = 'btn-admin-panel user-action-button user-security-button';
    reportBtn.setAttribute('aria-label', 'Güvenlik raporunu aç');
    reportBtn.title = 'Güvenlik Raporu';
    reportBtn.innerHTML = '<i class="fas fa-shield-alt" aria-hidden="true"></i><span>Güvenlik Raporu</span>';
    reportBtn.style.cssText = 'padding: 6px 12px; width: auto; margin-top: 0; font-size: 12px; background: #e67e22; border: none; border-radius: 4px; color: white; cursor: pointer; display: inline-flex; align-items: center; gap: 5px;';
    reportBtn.onclick = () => showReportModal();
    const logoutBtn = userDisplay.querySelector('button[onclick="handleLogout()"]');
    if (logoutBtn) userDisplay.insertBefore(reportBtn, logoutBtn);
    else userDisplay.appendChild(reportBtn);
});

// ─────────────────────────────────────────────────────────────────────────────
// Namespace Export
// ─────────────────────────────────────────────────────────────────────────────
export const SelfApproval = { showReportModal, closeReportModal };

window.AppModules.SelfApproval = SelfApproval;
