// [WHY]: Personel tablosu ve silme dizi indeksiyle çalışıyordu (snapshot sonrası yanlış kişi silinir), silme onaysızdı ve
//        tüm veritabanını yazıyordu; ad/kod HTML'e kaçışsız basılıyordu (ITSM-07, DATA-06, DATA-01, SEC-01).
// [HOW]: Satırlar id taşır; silme onaylı ve tek doküman (removeItem). Ekleme/düzenleme script.js openPersonelModal'da.
window.renderPersonelTable = function () {
    const tbody = document.querySelector('#tablePersonel tbody');
    if (!tbody) return;
    // Faz 4B · J10: giriş kodu hiçbir yerde gösterilmez (saklanmaz); yerine birim, kurumsal kimlik (PRI) ve giriş hesabı durumu.
    //              Hesabı olmayana "Hesap Aç" (yalnız yönetici; yeni kodla). PRI'si olmayan / J7 adresinde kalmış hesap → göç aracı.
    const isAdmin = typeof window.isDbAdmin === 'function' && window.isDbAdmin();
    const SP = window.StaffProvisioning;
    const account = item => {
        const pri = item.pri ? `<code>${escapeHtml(item.pri)}</code> ` : '<span style="color:#b45309;">PRI yok</span> ';
        if (!item.uid) return pri + (isAdmin ? `<button class="edit-btn" onclick="openPersonelAccount(${jsArg(item.id)})">Hesap Aç</button>` : '· hesap yok');
        const onPri = SP && String(item.authEmail || '').toLowerCase() === SP.accountEmailOf(item);
        return pri + (onPri ? '✓' : '<span style="color:#b45309;" title="Hesap kurumsal kimlik adresinde değil: VIP → PRI / Hesap Göç Aracı">⚠ göç bekliyor</span>');
    };
    tbody.innerHTML = (window.data.personel || []).map(item => `
        <tr>
            <td><input type="checkbox" class="row-select" data-id="${escapeHtml(item.id ?? '')}"></td>
            <td>${escapeHtml(item.name || '-')}</td>
            <td>${escapeHtml(item.birim || '-')}</td>
            <td>${account(item) /* xss-ok: account() kendi şablonlarında escapeHtml / jsArg kullanır (linter ayrıca denetler) */}</td>
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
    // Faz 4B · J7.5: listede olmayan, okunaklı kod (staff-code-registry.js); sicil yoksa eski üretici
    if (window.StaffCodeRegistry) return window.StaffCodeRegistry.suggestCode(window.data.personel || []);
    return Math.random().toString(36).substring(2, 7);
};
