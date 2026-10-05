// alert.js
function showAppAlert(message, type = 'info') {
    // Alertlerin toplanacağı ana kutu yoksa oluştur
    let container = document.getElementById('alert-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'alert-container';
        container.style.cssText = "position: fixed; top: 20px; right: 20px; z-index: 9999; display: flex; flex-direction: column; gap: 10px;";
        document.body.appendChild(container);
    }

    const bannerStyle = `
    position: fixed;
    top: 20px; /* Navbarın üstüne binmemesi için yukarıdan boşluk */
    left: 50%;
    transform: translateX(-50%); /* Tam ortalamak için */
    background-color: #2ecc71; /* Success Yeşili */
    color: white;
    padding: 15px 30px;
    z-index: 1050; /* Navbarın (genelde 1000'dir) bir tık üstü */
    box-shadow: 0 4px 15px rgba(0,0,0,0.2);
    font-weight: bold;
    border-radius: 50px; /* Köşeleri yuvarlatıp modern görünüm */
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    min-width: 300px;
    width: auto; /* Full width olmasını engeller */
    animation: slideDown 0.5s ease-out forwards;
    `;

    const alertDiv = document.createElement('div');
    alertDiv.className = `app-alert-item ${type}`;
    
    const finalMessage = message;

    const colors = {
        'info': '#3498db',
        'success': '#2ecc71',
        'error': '#e74c3c',
        'warning': '#f1c40f'
    };

    alertDiv.style.cssText = `
        background-color: ${colors[type] || colors.error};
        color: white;
        padding: 15px 25px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        min-width: 250px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        animation: slideIn 0.3s ease-out;
    `;

    // [WHY]: Mesajlar kayıt verisi (ürün adı, yönetici mesajı) içeriyor; innerHTML ile XSS'e açıktı (SEC-01).
    alertDiv.innerHTML = `
        <span style="white-space: pre-line;"></span>
        <button onclick="this.parentElement.remove()" style="background:none; border:none; color:white; cursor:pointer; font-weight:bold; margin-left:10px;">✕</button>
    `;
    alertDiv.querySelector('span').textContent = finalMessage;

    container.appendChild(alertDiv);

    // 4 saniye sonra otomatik sil
    setTimeout(() => {
        if (alertDiv.parentNode) {
            alertDiv.style.animation = "slideOut 0.3s ease-in";
            setTimeout(() => alertDiv.remove(), 300);
        }
    }, 4000);
}

// **-----**

function showSuccessBanner(message) {
    // Önce varsa eskisini sil
    const oldBanner = document.getElementById('successBanner');
    if (oldBanner) oldBanner.remove();

    const banner = document.createElement('div');
    banner.id = 'successBanner';
    banner.style.cssText = `
        position: fixed;
        top: 80px; /* Navbar yüksekliğine göre burayı ayarlayabilirsin */
        left: 50%;
        transform: translateX(-50%);
        width: auto;
        min-width: 300px;
        max-width: 80%;
        background-color: #2ecc71;
        color: white;
        text-align: center;
        padding: 10px 25px;
        font-weight: bold;
        z-index: 999; /* Navbar'ın (varsa 1000) altında veya hizasında */
        border-radius: 50px;
        box-shadow: 0 4px 15px rgba(0,0,0,0.2);
        animation: fadeInDown 0.5s ease;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
    `;
    banner.textContent = `✅ ${message}`;   // Faz 4 · J2: mesaj metindir (SEC-01)
    
    document.body.appendChild(banner);

    // 3 saniye sonra yukarı kayarak kaybolsun
    setTimeout(() => {
        banner.style.animation = "fadeOutUp 0.5s ease";
        setTimeout(() => banner.remove(), 500);
    }, 2300);
}



/**
 * Özel onay kutusu — projedeki TEK tanım (Faz 4 · J2 · M6).
 * [WHY]: İki tanım vardı: alert.js (innerHTML) ve onu ezen script.js (textContent). Hangisinin çalıştığı yükleme sırasına
 *        bağlıydı; HTML bekleyen tek çağıran (TODO "Ata") textContent sürümünde seçim kutusunu metin olarak gösteriyor ve
 *        onayda çöküyordu. Kayıt verisi içeren onlarca çağıran ise güvenliği yalnız bu tesadüfe borçluydu.
 * [HOW]: Varsayılan güvenli: metin mesajı textContent (+ satır sonları). DOM gerekiyorsa çağıran Node verir (güvenle kurulmuş).
 *        { html: true } yalnız SABİT metinler içindir — kayıt verisi asla bu yolla verilmez.
 * @param {string} title
 * @param {string|Node} message
 * @param {Function|Object|string} [arg3] onayda çağrılacak fonksiyon | seçenekler | onay düğmesi metni (geri uyum)
 * @param {Object|string} [arg4] seçenekler | vazgeç düğmesi metni (geri uyum)
 *        Seçenekler: { html, confirmText, cancelText, danger }
 * @returns {Promise<boolean>} Evet → true, Hayır → false
 */
function showCustomConfirm(title, message, arg3, arg4) {
    let callback = null, opts = {};
    if (typeof arg3 === 'function') callback = arg3;
    else if (typeof arg3 === 'string') opts.confirmText = arg3;
    else if (arg3 && typeof arg3 === 'object') opts = { ...arg3 };
    if (typeof arg4 === 'string') opts.cancelText = arg4;
    else if (arg4 && typeof arg4 === 'object') opts = { ...opts, ...arg4 };

    const overlay = document.getElementById('customAlertOverlay');
    const confirmBtn = document.getElementById('alertConfirmBtn');
    const cancelBtn = document.getElementById('alertCancelBtn');
    const messageEl = document.getElementById('alertMessage');
    const isNode = typeof Node !== 'undefined' && message instanceof Node;

    if (!overlay || !confirmBtn || !cancelBtn || !messageEl) {
        const res = confirm(isNode ? message.textContent : String(message ?? ''));
        if (res && callback) callback();
        return Promise.resolve(res);
    }

    document.getElementById('alertTitle').innerText = title;
    messageEl.textContent = '';
    messageEl.style.whiteSpace = 'pre-line';
    if (isNode) messageEl.appendChild(message);
    else if (opts.html === true) messageEl.innerHTML = message; // xss-ok: yalnız sabit metin sözleşmesi ({html:true})
    else messageEl.textContent = String(message ?? '');

    // Düğme metinleri ve rengi yalnız bu açılış için; kapanınca varsayılana döner.
    const defaults = { confirm: confirmBtn.dataset.defaultText ?? (confirmBtn.dataset.defaultText = confirmBtn.textContent),
                       cancel: cancelBtn.dataset.defaultText ?? (cancelBtn.dataset.defaultText = cancelBtn.textContent) };
    confirmBtn.textContent = opts.confirmText || defaults.confirm;
    cancelBtn.textContent = opts.cancelText || defaults.cancel;
    confirmBtn.style.backgroundColor = opts.danger ? '#e74c3c' : '';
    overlay.style.display = 'flex';

    return new Promise((resolve) => {
        const close = (answer) => {
            overlay.style.display = 'none';
            confirmBtn.textContent = defaults.confirm;
            cancelBtn.textContent = defaults.cancel;
            confirmBtn.style.backgroundColor = '';
            if (answer && callback) callback();
            resolve(answer);
        };
        confirmBtn.onclick = () => close(true);
        cancelBtn.onclick = () => close(false);
    });
}
window.showCustomConfirm = showCustomConfirm;

// [WHY]: Replaces legacy, error-prone window.prompt dialogs for warehouse return selection.
// [HOW]: Creates a modern DOM-overlay modal with custom styled buttons, returning a Promise that resolves with the selected warehouse code ('b1' or 'b2') or null if cancelled.
// options.allowNoReturn: "Depoya iade etmeden kapat" seçeneği ekler ve 'none' döner; iptal her zaman null döner (ZIM-02).
window.showWarehousePromptModal = function (options = {}) {
    return new Promise((resolve) => {
        // Modal Overlay
        const overlay = document.createElement('div');
        overlay.style.cssText = "position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(15, 23, 42, 0.75); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; z-index: 11000;";

        // Modal Box
        const box = document.createElement('div');
        box.style.cssText = "background: white; padding: 24px; border-radius: 12px; width: 380px; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04); text-align: center; color: #1e293b; font-family: sans-serif;";

        box.innerHTML = `
          <h3 style="margin-top: 0; margin-bottom: 12px; font-size: 1.25rem; font-weight: 700; color: #0f172a;">Depo İadesi</h3>
          <p style="margin-bottom: 24px; font-size: 0.95rem; color: #64748b; line-height: 1.5;">Ürünün hangi depoya iade edilmesini istersiniz?</p>
          <div style="display: flex; flex-direction: column; gap: 10px;">
            <button id="btnReturnB1" style="padding: 12px; border: 1px solid #e2e8f0; border-radius: 8px; background: #f8fafc; font-weight: 600; cursor: pointer; transition: all 0.2s; color: #0f172a;">🏢 B1 Deposu</button>
            <button id="btnReturnB2" style="padding: 12px; border: 1px solid #e2e8f0; border-radius: 8px; background: #f8fafc; font-weight: 600; cursor: pointer; transition: all 0.2s; color: #0f172a;">🏢 B2 Deposu</button>
            ${options.allowNoReturn ? '<button id="btnReturnNone" style="padding: 12px; border: 1px solid #e2e8f0; border-radius: 8px; background: #fff7ed; font-weight: 600; cursor: pointer; color: #9a3412;">📄 Depoya iade etmeden kapat</button>' : ''}
            <button id="btnReturnCancel" style="padding: 10px; border: none; border-radius: 8px; background: #ef4444; color: white; font-weight: 600; cursor: pointer; transition: all 0.2s; margin-top: 8px;">İşlemi İptal Et</button>
          </div>
        `;

        overlay.appendChild(box);
        document.body.appendChild(overlay);

        // Hover effect helper styles
        const style = document.createElement('style');
        style.innerHTML = `
          #btnReturnB1:hover, #btnReturnB2:hover {
            background: #f1f5f9 !important;
            border-color: #cbd5e1 !important;
            transform: translateY(-1px);
          }
          #btnReturnCancel:hover {
            background: #dc2626 !important;
          }
        `;
        document.head.appendChild(style);

        const cleanup = (val) => {
            document.body.removeChild(overlay);
            document.head.removeChild(style);
            resolve(val);
        };

        document.getElementById('btnReturnB1').onclick = () => cleanup('b1');
        document.getElementById('btnReturnB2').onclick = () => cleanup('b2');
        document.getElementById('btnReturnCancel').onclick = () => cleanup(null);
        const noneBtn = document.getElementById('btnReturnNone');
        if (noneBtn) noneBtn.onclick = () => cleanup('none');
    });
};

// [WHY]: Allows administrators to authenticate and bypass the maintenance overlay directly when the system is in maintenance mode.
// [HOW]: SecurityConfig.authenticate (parola geçiş kuralı + vize, J3), parola sonrası kimlik, bakım bayrağı temizlenir, panele geçilir.
window.adminBypassMaintenance = async function () {
    const codeInput = document.getElementById('maintenanceCode');
    const code = codeInput ? codeInput.value.trim() : "";
    if (!code) {
        alert("Lütfen yönetici parolasını giriniz!");
        return;
    }

    if (typeof SecurityConfig !== 'undefined' && SecurityConfig.authenticate) {
        const success = await SecurityConfig.authenticate(code);
        if (success) {
            window.setActiveUser(SecurityConfig.resolveAdminIdentity());
            localStorage.removeItem("system_maintenance_mode");
            window.location.href = 'admin.html';
        } else {
            alert(SecurityConfig.lastErrorMessage || "Hatalı yönetici parolası!");
        }
    } else {
        alert("Güvenlik sistemi yükleniyor, lütfen birkaç saniye sonra tekrar deneyin.");
    }
};
