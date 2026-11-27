// [WHY]: Personel tablosu ve silme dizi indeksiyle çalışıyordu (snapshot sonrası yanlış kişi silinir), silme onaysızdı ve
//        tüm veritabanını yazıyordu; ad/kod HTML'e kaçışsız basılıyordu (ITSM-07, DATA-06, DATA-01, SEC-01).
// [HOW]: Satırlar id taşır; silme onaylı ve tek doküman (removeItem). Ekleme/düzenleme src/ui/personnel-modal.js openPersonelModal'da.
window.renderPersonelTable = function () {
    const tbody = document.querySelector('#tablePersonel tbody');
    if (!tbody) return;
    // Faz 4B · J10: giriş kodu hiçbir yerde gösterilmez (saklanmaz); yerine birim, kurumsal kimlik (PRI) ve giriş hesabı durumu.
    //              Hesabı olmayana "Hesap Aç" (yalnız yönetici; yeni kodla). PRI'si olmayan / J7 adresinde kalmış hesap → göç aracı.
    const isAdmin = typeof window.isDbAdmin === 'function' && window.isDbAdmin();
    const SP = window.StaffProvisioning;
    const accountStates = window._staffAccountStates || {};
    const account = item => {
        const pri = item.pri ? `<code>${escapeHtml(item.pri)}</code> ` : '<span style="color:#b45309;">PRI yok</span> ';
        if (!item.uid) return pri + (isAdmin ? `<button class="edit-btn" onclick="openPersonelAccount(${jsArg(item.id)})">Hesap Aç</button>` : '· hesap yok');
        const onPri = SP && String(item.authEmail || '').toLowerCase() === SP.accountEmailOf(item);
        const st = accountStates[item.uid];
        const statusTag = item.active === false || (st && st.status === 'suspended')
            ? ' <span style="color:#dc2626; font-weight:700;">⛔ Askıda</span>'
            : (st && st.mustChangeCode
                ? (st.tempPinExpired
                    ? ' <span style="color:#b45309; font-weight:700;">⏳ Geçici PIN süresi doldu</span>'
                    : ' <span style="color:#2563eb; font-weight:700;">🔑 Geçici PIN bekliyor</span>')
                : '');
        return pri + (onPri ? '✓' : '<span style="color:#b45309;" title="Hesap kurumsal kimlik adresinde değil: VIP → PRI / Hesap Göç Aracı">⚠ göç bekliyor</span>') + statusTag;
    };
    // [WHY]: Bu hücre eskiden item.birim (serbest metin) gösterip gerçek item.unitId'yi "Birim ID: eski ad
    //        kaydı" gibi anlamsız bir alt satıra düşürüyordu; Birim Yönetimi tablosu (edm-workflow.js
    //        _unitLinkedPersonnel) ise yalnız unitId bağını gerçek kabul ediyor. İki ekran aynı kişi için
    //        farklı birim söylüyordu (kullanıcı tespiti). [HOW]: Birim Yönetimi ile aynı gerçek kaynak:
    //        unitId varsa güncel birim adı gösterilir; yoksa eski metin yalnız ikinci planda "eski kayıt" notu.
    const unitCell = item => {
        const unit = item.unitId ? (window.data.units || []).find(u => String(u.id) === String(item.unitId)) : null;
        if (unit) return `${escapeHtml(unit.name || '-')}${unit.active === false ? ' <small class="text-muted">(Pasif birim)</small>' : ''}<br><small class="text-muted">${escapeHtml(item.jobTitle || '')}</small>`;
        return `<span class="text-muted">Birim ataması yok</span><br><small class="text-muted">${item.birim ? 'Eski kayıt: ' + escapeHtml(item.birim) + ' · ' : ''}${escapeHtml(item.jobTitle || '')}</small>`;
    };
    // v3.8 UX-4: index.html #tablePersonel "Seç" sütunu kaldırılıp satıra tıkla-seç'e geçti; admin.html 5 sütunu korur.
    const firstTh = document.querySelector('#tablePersonel thead th');
    const hasSelectCol = !!(firstTh && /^seç$/i.test((firstTh.textContent || '').trim()));

    const actionButtons = item => {
        const suspended = item.active === false;
        const pinBtn = (isAdmin && item.uid && !suspended)
            ? `<button class="edit-btn" onclick="if(validateAdminAction()) openPersonelTempPin(${jsArg(item.id)})">Geçici PIN</button> `
            : '';
        const toggleBtn = suspended
            ? `<button class="edit-btn" onclick="if(validateAdminAction()) togglePersonelSuspend(${jsArg(item.id)}, false)">Yeniden Aktifleştir</button>`
            : `<button class="delete-btn" onclick="if(validateAdminAction()) togglePersonelSuspend(${jsArg(item.id)}, true)">Askıya Al</button>`;
        return `<button class="edit-btn" onclick="if(validateAdminAction()) openPersonelModal('edit', ${jsArg(item.id)})">Düzenle</button> ` + pinBtn + toggleBtn;
    };

    tbody.innerHTML = (window.data.personel || []).map((item, idx) => {
        const selectTd = hasSelectCol ? `<td><input type="checkbox" class="row-select" data-id="${escapeHtml(item.id ?? '')}"></td>` : '';
        return `
        <tr class="${hasSelectCol ? '' : 'selectable-row personel-selectable-row'}" data-depo="personel" data-id="${escapeHtml(item.id ?? '')}" data-index="${escapeHtml(idx)}" data-name="${escapeHtml(item.name || '-')}">
            ${selectTd /* xss-ok: yalnız sabit checkbox hücresi + escapeHtml(item.id) */}
            <td>${escapeHtml(item.name || '-')}<br><small>ID: ${escapeHtml(item.id)} · UID: ${escapeHtml(item.uid || 'yok')} · ${item.active === false ? 'Askıda / Pasif' : 'Aktif'}</small></td>
            <td>${unitCell(item) /* xss-ok: unitCell() escapeHtml kullanır (linter ayrıca denetler) */}</td>
            <td>${account(item) /* xss-ok: account() kendi şablonlarında escapeHtml / jsArg kullanır (linter ayrıca denetler) */}</td>
            <td>${actionButtons(item) /* xss-ok: actionButtons() yalnız sabit düğmeler + jsArg(item.id) kullanır */}</td>
        </tr>`;
    }).join('');

    if (!hasSelectCol) {
        _bindPersonelRowSelection(tbody);
        _syncPersonelSelectionUI();
    }
};

// [WHY]: v3.8 UX-4 · index.html Personel tablosunda "Seç" sütunu olmadan satıra tıkla-seç + Shift aralık seçimi sağlar.
// [HOW]: Satır içi buton/bağlantı tıklamalarını yoksayar; seçili satır sayısını #personelSelectionPill içinde gösterir.
let _personelLastClicked = null;
function _syncPersonelSelectionUI() {
    const all = Array.from(document.querySelectorAll('#tablePersonel tr.personel-selectable-row'));
    const selected = all.filter(tr => tr.classList.contains('selected-row'));
    const pill = document.getElementById('personelSelectionPill');
    const countEl = document.getElementById('personelSelectionCount');
    const selAllBtn = document.getElementById('personelSelectAllBtn');
    if (pill) pill.hidden = selected.length === 0;
    if (countEl) countEl.textContent = `${selected.length} kayıt seçildi`;
    if (selAllBtn) selAllBtn.textContent = (all.length > 0 && selected.length === all.length) ? 'Seçimi Kaldır' : 'Tümünü Seç';
}
function _bindPersonelRowSelection(tbody) {
    if (!tbody || tbody._personelSelectBound) return;
    tbody._personelSelectBound = true;
    tbody.addEventListener('click', e => {
        if (e.target.closest('button, a, input, select, textarea, label')) return;
        const tr = e.target.closest('tr.personel-selectable-row');
        if (!tr) return;
        const rows = Array.from(tbody.querySelectorAll('tr.personel-selectable-row'));
        if (e.shiftKey && _personelLastClicked && rows.includes(_personelLastClicked)) {
            const a = rows.indexOf(_personelLastClicked);
            const b = rows.indexOf(tr);
            const [start, end] = a < b ? [a, b] : [b, a];
            const nextState = !tr.classList.contains('selected-row');
            for (let i = start; i <= end; i++) rows[i].classList.toggle('selected-row', nextState);
        } else {
            tr.classList.toggle('selected-row');
        }
        _personelLastClicked = tr;
        _syncPersonelSelectionUI();
    });
}
document.addEventListener('click', e => {
    if (e.target && e.target.id === 'personelSelectAllBtn') {
        const rows = Array.from(document.querySelectorAll('#tablePersonel tr.personel-selectable-row'));
        const selectAll = rows.some(tr => !tr.classList.contains('selected-row'));
        rows.forEach(tr => tr.classList.toggle('selected-row', selectAll));
        _syncPersonelSelectionUI();
    } else if (e.target && e.target.id === 'personelClearSelBtn') {
        document.querySelectorAll('#tablePersonel tr.personel-selectable-row.selected-row').forEach(tr => tr.classList.remove('selected-row'));
        _personelLastClicked = null;
        _syncPersonelSelectionUI();
    }
});

window.deletePersonel = async function (id) {
    if (!window.requireDbAdmin('Personel askıya alma')) return;
    if (typeof window.togglePersonelSuspend === 'function') {
        window.togglePersonelSuspend(id, true);
        return;
    }
    const person = (window.data.personel || []).find(p => String(p.id) === String(id));
    if (!person) { showAppAlert('Personel bulunamadı; liste güncellenmiş olabilir.', 'error'); return; }
    const ok = await showCustomConfirm('Personeli Askıya Al', `"${person.name || '-'}" kaydı ve geçmişi korunacak; uygulama verilerine erişimi kapatılacak. Onaylıyor musunuz?`);
    if (ok !== true) return;
    try { await window.AppModules.EBYSDefinitions.setActive('personel', person.id, false); }
    catch (error) { showAppAlert(error.message, 'error'); return; }
    renderPersonelTable();
    showAppAlert('Personel askıya alındı. Yeniden etkinleştirmek için "Yeniden Aktifleştir" kullanın.', 'info');
};

window.getRandomCode = function () {
    // Faz 4B · J7.5: listede olmayan, okunaklı kod (staff-code-registry.js); sicil yoksa eski üretici
    if (window.StaffCodeRegistry) return window.StaffCodeRegistry.suggestCode(window.data.personel || []);
    return Math.random().toString(36).substring(2, 7);
};
