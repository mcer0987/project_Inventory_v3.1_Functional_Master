// [WHY]: Tanımlar ekranları aynı kimlik alanlarını iki sayfada da kullanır; DB çağrısı UI'ya girmez.
// [HOW]: DOM elemanları textContent ile kurulur; eski isim alanları görünüm olarak korunur.
(function () {
    const schema = () => window.AppModules.EBYSDefinitionsSchema;
    function field(parent, labelText, id, type = 'text') {
        let control = document.getElementById(id);
        if (control) return control;
        const label = document.createElement('label'); label.textContent = labelText;
        control = document.createElement(type === 'select' ? 'select' : 'input');
        control.id = id;
        if (type !== 'select') control.type = type;
        control.className = 'um-input';
        label.appendChild(control); parent.appendChild(label);
        return control;
    }
    function option(select, value, label, disabled = false) {
        const item = document.createElement('option'); item.value = value; item.textContent = label; item.disabled = disabled;
        select.appendChild(item);
    }
    function unitOptions(select, selected, exceptId = '') {
        select.replaceChildren(); option(select, '', '— Bağlantı yok / eski ad korunur —');
        for (const unit of window.data.units || []) {
            if (!unit || typeof unit !== 'object' || String(unit.id) === exceptId) continue;
            const enabled = schema().active(unit), id = String(unit.id);
            option(select, id, `${schema().nameOf(unit)} · ${unit.code || id}${enabled ? '' : ' · Pasif'}`, !enabled && id !== selected);
        }
        if (selected && ![...select.options].some(o => o.value === selected)) option(select, selected, `${selected} · bağlantı bulunamadı`);
        select.value = selected;
    }
    function openPersonnel(person) {
        const form = document.getElementById('personelForm');
        form.dataset.ebysRevision = String(person?.revision || 0);
        // [WHY]: Eski metin alanı geçmiş uyumluluğudur; yeni atama ID seçicisinden yapılır.
        document.getElementById('personelUnit').disabled = true;
        let box = document.getElementById('personelEbysFields');
        if (!box) { box = document.createElement('fieldset'); box.id = 'personelEbysFields'; form.insertBefore(box, form.querySelector('button[type=submit]')); }
        field(box, 'Kalıcı personel ID ', 'personelPermanentId').readOnly = true;
        document.getElementById('personelPermanentId').value = person?.id ?? 'Kaydedildiğinde atanır';
        field(box, 'Hesap UID ', 'personelAuthUid').readOnly = true;
        document.getElementById('personelAuthUid').value = person?.uid || 'Hesap henüz bağlı değil';
        unitOptions(field(box, 'Bağlı birim (ID) ', 'personelEbysUnit', 'select'), String(person?.unitId || ''));
        field(box, 'Görev / unvan (erişim yetkisi vermez) ', 'personelJobTitle').value = person?.jobTitle || '';
        field(box, 'Aktif ', 'personelActive', 'checkbox').checked = schema().active(person);
    }
    function readPersonnel() {
        return { unitId: document.getElementById('personelEbysUnit')?.value || '',
            expectedRevision: Number(document.getElementById('personelForm').dataset.ebysRevision || 0),
            jobTitle: document.getElementById('personelJobTitle')?.value || '',
            active: document.getElementById('personelActive')?.checked !== false,
            birim: document.getElementById('personelUnit')?.value || '' };
    }
    function openUnit(unit, editor) {
        const nameInput = document.getElementById('unitNameInput');
        let box = document.getElementById('unitEbysFields');
        if (!box) { box = document.createElement('fieldset'); box.id = 'unitEbysFields'; nameInput.after(box); }
        field(box, 'Kalıcı birim ID ', 'unitPermanentId').readOnly = true;
        document.getElementById('unitPermanentId').value = unit?.id || 'Kaydedildiğinde atanır';
        field(box, 'Kurum ID ', 'unitOrganization').value = unit?.organizationId || '';
        document.getElementById('unitOrganization').readOnly = !!unit?.organizationId;
        field(box, 'Birim kodu ', 'unitCode').value = unit?.code || '';
        unitOptions(field(box, 'Üst birim ', 'unitParent', 'select'), String(unit?.parentUnitId || ''), String(unit?.id || ''));
        field(box, 'Aktif ', 'unitActive', 'checkbox').checked = schema().active(unit);
        editor.personnelIds = [...(unit?.personnelIds || [])];
        editor.expectedRevision = unit?.revision || 0;
    }
    function readUnit(editor) {
        return { id: editor.id, name: document.getElementById('unitNameInput').value,
            organizationId: document.getElementById('unitOrganization').value,
            code: document.getElementById('unitCode').value, parentUnitId: document.getElementById('unitParent').value,
            active: document.getElementById('unitActive').checked, personnelIds: editor.personnelIds,
            expectedRevision: editor.expectedRevision };
    }
    function searchPeople(query, editor) {
        const area = document.getElementById('unitPersonnelResults'); area.replaceChildren();
        const term = String(query || '').trim().toLocaleLowerCase('tr-TR');
        area.style.display = term.length >= 2 ? 'block' : 'none';
        if (term.length < 2) return;
        const people = (window.data.personel || []).filter(p => schema().active(p) &&
            `${p.name} ${p.id} ${p.uid || ''}`.toLocaleLowerCase('tr-TR').includes(term)).slice(0, 10);
        for (const person of people) {
            const button = document.createElement('button'); button.type = 'button';
            button.className = 'unit-personnel-option';
            button.textContent = `${person.name} · ID: ${person.id} · UID: ${person.uid || 'yok'}`;
            button.disabled = editor.personnelIds.includes(String(person.id));
            button.addEventListener('click', () => {
                editor.personnelIds.push(String(person.id)); renderPeople(editor); area.style.display = 'none';
                document.getElementById('unitPersonnelSearch').value = '';
            }); area.appendChild(button);
        }
        if (!people.length) area.textContent = 'Eşleşen aktif personel yok.';
    }
    function renderPeople(editor) {
        const list = document.getElementById('unitSelectedPersonnel'); list.replaceChildren();
        for (const pid of editor.personnelIds || []) {
            const person = (window.data.personel || []).find(p => String(p.id) === pid);
            const li = document.createElement('li'); li.className = 'um-chip';
            li.textContent = `${person?.name || 'Kayıt bulunamadı'} · ID: ${pid}`;
            const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Çıkar';
            remove.addEventListener('click', () => { editor.personnelIds = editor.personnelIds.filter(id => id !== pid); renderPeople(editor); });
            li.appendChild(remove); list.appendChild(li);
        }
        if (editor.personnel?.length) {
            const legacy = document.createElement('li');
            legacy.textContent = `Eski ad listesi (korunur): ${editor.personnel.join(', ')}`; list.appendChild(legacy);
        }
    }
    window.AppModules = window.AppModules || {};
    window.AppModules.EBYSDefinitionsUI = { openPersonnel, readPersonnel, openUnit, readUnit, searchPeople, renderPeople };
})();
