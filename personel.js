// [WHY]: Personel tablosu ve silme dizi indeksiyle çalışıyordu (snapshot sonrası yanlış kişi silinir), silme onaysızdı ve
//        tüm veritabanını yazıyordu; ad/kod HTML'e kaçışsız basılıyordu (ITSM-07, DATA-06, DATA-01, SEC-01).
// [HOW]: Satırlar id taşır; silme onaylı ve tek doküman (removeItem). Ekleme/düzenleme script.js openPersonelModal'da.
window.renderPersonelTable = function () {
    const tbody = document.querySelector('#tablePersonel tbody');
    if (!tbody) return;
    tbody.innerHTML = (window.data.personel || []).map(item => `
        <tr>
            <td><input type="checkbox" class="row-select" data-id="${escapeHtml(item.id ?? '')}"></td>
            <td>${escapeHtml(item.name || '-')}</td>
            <td>${escapeHtml(item.code || '-')}</td>
            <td>
                <button class="edit-btn" onclick="if(validateAdminAction()) openPersonelModal('edit', ${jsArg(item.id)})">Düzenle</button>
                <button class="delete-btn" onclick="if(validateAdminAction()) deletePersonel(${jsArg(item.id)})">Sil</button>
            </td>
        </tr>`).join('');
};

window.deletePersonel = async function (id) {
    if (!window.requireDbAdmin('Personel silme')) return;   // Faz 4 · J1: personel yalnız admin
    const person =(window.data.personel || []).find(p => String(p.id) === String(id));
    if (!person) { showAppAlert('Personel bulunamadı; liste güncellenmiş olabilir.', 'error'); return; }
    const ok = await showCustomConfirm('Personeli Sil', `"${person.name || '-'}" silinecek; bu kişi artık oturum kodu ile giriş yapamaz. Onaylıyor musunuz?`);
    if (ok !== true) return;
    if (!(await window.writeOk(window.removeItem('personel', person.id)))) { showAppAlert('Personel silinemedi.', 'error'); return; }
    renderPersonelTable();
    showAppAlert('Personel silindi.', 'info');
};

window.getRandomCode = function () {
    // Varsa mevcut fonksiyon, yoksa basit bir random (ekstra eklemedim, mevcut kodda varsa kullan)
    return Math.random().toString(36).substring(2, 7); // Örnek basit kod üretimi
};
