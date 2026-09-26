const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'index.html');
let content = fs.readFileSync(filePath, 'utf8');

const targetStr = `            if (localStorage.getItem("system_maintenance_mode") === "true") {
                document.documentElement.innerHTML = \`
                    <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; background:#0f172a; color:white; font-family:sans-serif; text-align:center;">
                        <svg width="100" height="100" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:20px;">
                            <polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"></polygon>
                            <line x1="12" y1="8" x2="12" y2="12"></line>
                            <line x1="12" y1="16" x2="12.01" y2="16"></line>
                        </svg>
                        <h1 style="color:#ef4444; margin-bottom:10px;">SİSTEM BAKIMDA</h1>
                        <p style="color:#94a3b8; max-width:400px; line-height:1.6;">Şu anda acil bir bakım veya güncelleme çalışması yapılmaktadır. Lütfen daha sonra tekrar deneyin.</p>
                    </div>
                \`;
                throw new Error("SİSTEM BAKIM MODUNDA - Yükleme durduruldu."); // Stop further script execution
            }`;

const replacementStr = `            if (localStorage.getItem("system_maintenance_mode") === "true") {
                // Ekranda tüm sayfayı kaplayan bakım katmanını oluşturur
                document.write(\`
                    <div id="maintenanceOverlay" style="position: fixed; inset: 0; background: #0f172a; display: flex; flex-direction: column; align-items: center; justify-content: center; z-index: 100000; color: white; font-family: sans-serif; text-align: center; padding: 20px;">
                        <svg width="100" height="100" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 20px;">
                            <polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"></polygon>
                            <line x1="12" y1="8" x2="12" y2="12"></line>
                            <line x1="12" y1="16" x2="12.01" y2="16"></line>
                        </svg>
                        <h1 style="color: #ef4444; margin-bottom: 10px;">SİSTEM BAKIMDA</h1>
                        <p style="color: #94a3b8; max-width: 400px; line-height: 1.6; margin-bottom: 30px;">Şu anda acil bir bakım veya güncelleme çalışması yapılmaktadır. Lütfen daha sonra tekrar deneyin.</p>
                        
                        <!-- Yönetici Giriş Arayüzü -->
                        <div id="maintenanceAdminBox" style="margin-top: 20px;">
                            <button onclick="document.getElementById('maintenanceForm').style.display='block'; this.style.display='none';" style="background: transparent; border: 1px solid #475569; color: #94a3b8; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 0.85rem; font-weight: 600; transition: all 0.2s;">🛡️ Yönetici Girişi</button>
                            <div id="maintenanceForm" style="display: none;">
                                <input type="password" id="maintenanceCode" placeholder="Giriş Kodu" onkeypress="if(event.key === 'Enter') window.adminBypassMaintenance();" style="background: #1e293b; border: 1px solid #475569; color: white; padding: 10px; border-radius: 8px; font-size: 1rem; width: 180px; text-align: center; outline: none; margin-bottom: 10px; display: block; margin-left: auto; margin-right: auto;" maxlength="5">
                                <button onclick="window.adminBypassMaintenance()" style="background: #3b82f6; color: white; border: none; padding: 10px 20px; border-radius: 8px; font-weight: 600; cursor: pointer; transition: background 0.2s;">Giriş Yap</button>
                            </div>
                        </div>
                    </div>
                \`);
            }`;

// Normalize line endings to avoid \r\n vs \n mismatch
const normalize = str => str.replace(/\r\n/g, '\n').trim();

if (normalize(content).includes(normalize(targetStr))) {
    // Replace with normalized version
    const normContent = content.replace(/\r\n/g, '\n');
    const normTarget = targetStr.replace(/\r\n/g, '\n');
    const normReplacement = replacementStr.replace(/\r\n/g, '\n');
    
    fs.writeFileSync(filePath, normContent.replace(normTarget, normReplacement), 'utf8');
    console.log("Successfully patched index.html");
} else {
    console.error("Target string not found in index.html!");
}
