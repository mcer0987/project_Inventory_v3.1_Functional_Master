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
        background-color: ${colors[type]};
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

    alertDiv.innerHTML = `
        <span>${finalMessage}</span>
        <button onclick="this.parentElement.remove()" style="background:none; border:none; color:white; cursor:pointer; font-weight:bold; margin-left:10px;">✕</button>
    `;

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
    banner.innerHTML = `✅ ${message}`;
    
    document.body.appendChild(banner);

    // 3 saniye sonra yukarı kayarak kaybolsun
    setTimeout(() => {
        banner.style.animation = "fadeOutUp 0.5s ease";
        setTimeout(() => banner.remove(), 500);
    }, 2300);
}



/**
 * Özel Onay Kutusu Fonksiyonu
 * @param {string} title - Başlık
 * @param {string} message - Mesaj içeriği
 * @returns {Promise<boolean>} - Evet ise true, Hayır ise false döner
 */

function showCustomConfirm(title, message, callback) {
    const overlay = document.getElementById('customAlertOverlay');
    const confirmBtn = document.getElementById('alertConfirmBtn');
    const cancelBtn = document.getElementById('alertCancelBtn');

    // İşlem tipine göre buton rengini ayarla
    if (typeof btnType !== 'undefined' && btnType === 'danger') {
        confirmBtn.style.backgroundColor = '#e74c3c'; // Kırmızı
    } else {
        confirmBtn.style.backgroundColor = '#2ecc71'; // Yeşil
    }
    
    // İçeriği güncelle
    document.getElementById('alertTitle').innerText = title;
    document.getElementById('alertMessage').innerHTML = message;
    
    // Görünür yap
    overlay.style.display = 'flex';

    return new Promise((resolve) => {
        // Evet'e basılırsa
        confirmBtn.onclick = () => {
            overlay.style.display = 'none';
            if (callback && typeof callback === 'function') callback();
            resolve(true);
        };

        // Hayır'a basılırsa
        cancelBtn.onclick = () => {
            overlay.style.display = 'none';
            resolve(false);
        };
    });
}
window.showCustomConfirm = showCustomConfirm;

// [WHY]: Replaces legacy, error-prone window.prompt dialogs for warehouse return selection.
// [HOW]: Creates a modern DOM-overlay modal with custom styled buttons, returning a Promise that resolves with the selected warehouse code ('b1' or 'b2') or null if cancelled.
window.showWarehousePromptModal = function () {
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
    });
};

// [WHY]: Allows administrators to authenticate and bypass the maintenance overlay directly when the system is in maintenance mode.
// [HOW]: Authenticates the code using SecurityConfig.authenticate, sets admin_auth, clears the maintenance mode flag, and reloads.
window.adminBypassMaintenance = async function () {
    const codeInput = document.getElementById('maintenanceCode');
    const code = codeInput ? codeInput.value.trim() : "";
    if (!code) {
        alert("Lütfen giriş kodunu giriniz!");
        return;
    }

    if (typeof SecurityConfig !== 'undefined' && SecurityConfig.authenticate) {
        const success = await SecurityConfig.authenticate(code);
        if (success) {
            const expiry = new Date().getTime() + (180 * 60 * 1000); // 3 saat vize süresi (admin.html ile aynı)
            localStorage.setItem('admin_auth', JSON.stringify({ expiry: expiry }));
            
            // Personel listesinden admin bulup activeUser olarak ata
            const adminUser = (window.data && window.data.personel) 
                ? window.data.personel.find(p => p.name === 'Muhammed Cer' || p.name === 'Admin') 
                : { name: 'Admin', role: 'admin' };
            
            localStorage.setItem('activeUser', JSON.stringify(adminUser));
            localStorage.removeItem("system_maintenance_mode");
            window.location.href = 'admin.html';
        } else {
            alert("Hatalı yönetici kodu!");
        }
    } else {
        alert("Güvenlik sistemi yükleniyor, lütfen birkaç saniye sonra tekrar deneyin.");
    }
};