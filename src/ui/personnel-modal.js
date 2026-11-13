// [WHY]: v3.7 · İP-3 — script.js monolitinden ayrıştırıldı (SoC). Personel ekleme/düzenleme penceresi, birim seçimi, PRI önerisi
//        ve giriş hesabı açma tek arayüz modülünde. Yazmalar servislerden geçer (EBYSDefinitions.savePersonnel,
//        StaffProvisioning, window.updateItem); kişi id ile bulunur, window.data dizisi değiştirilmez.
// [HOW]: Klasik betik; iki sayfada script.js'ten hemen sonra yüklenir (ES modüllerinden önce tanımlı olmalı: inline onclick
//        ve modüller bu adları çağırır). Gövde script.js'ten değiştirilmeden taşındı (yalnız IIFE girintisi); taşıma öncesi
//        global olan adlar aynı adlarla window'da kalır, AppModules.PersonnelModal aynı fonksiyonları taşır
//        (sözleşme: tests/unit/script-bridge-contract.test.mjs).
//        getRandomCode üst düzeyde kalır: personel.js de window.getRandomCode tanımlar ve hangisinin geçerli olacağı bugünkü
//        gibi sayfadaki yükleme sırasına bağlıdır (index: bu dosya, admin: personel.js).

// Okunaklı, 5 karakterlik kod önerisi (J7.5). J10: kodlar saklanmadığı için listede yalnız temizlenmemiş eski kodlar kalabilir.
function getRandomCode() {
    if (window.StaffCodeRegistry) return window.StaffCodeRegistry.suggestCode(window.data.personel || []);
    return Math.random().toString(36).substring(2, 7);
}

(function () {
    // Personel işlemleri (v3.7'ye kadar script.js'teydi)
    // [WHY]: Düzenleme dizi indeksiyle yapılıyor ve kaydı {name, code} ile değiştiriyordu (id ve diğer alanlar kayboluyordu,
    //        doküman silinip yeniden oluşuyordu); ekleme/düzenleme tüm veritabanını yazıyordu (ITSM-07, DATA-04, DATA-06).
    // [HOW]: Kişi id ile bulunur; düzenleme yalnız adı günceller (updateItem), ekleme tek doküman (appendItem, makeId).
    // [WHY]: Faz 4B · J10 — giriş Firebase Auth ile; düz metin kod personel kaydında TUTULMAZ (kurallar yeniden yazılmasını reddeder).
    //        PRI revizyonu: personel giriş ekranında kurumsal kimliğini (PRI, ör. ayse.yilmaz) yazar; hesap e-postası <pri>@….
    // [HOW]: Yeni personel: PRI addan üretilir (ad.soyad, çakışmada numara; yönetici değiştirebilir), kod üretilir → kayıt (kodsuz,
    //        PRI'li) → aynı kodla <pri>@ hesabı → PRI ve kod yöneticiye BİR KEZ gösterilir (personele iletilir). Düzenleme: ad, birim
    //        ve — hesap açılmamışsa — PRI (hesap açıldıktan sonra PRI e-postadır; istemciden değiştirilemez). Hesabı olmayan
    //        personel: tablodan "Hesap Aç" yeni kodla. Kod sıfırlama istemciden yapılamaz — yönetici betiği gerekir.
    function _fillUnitSelect(select, current) {
        if (!select) return;
        while (select.firstChild) select.removeChild(select.firstChild);
        select.appendChild(new Option('— Birim seçin —', ''));
        const names = [...new Set((window.data.units || []).map(u => String((u && (u.name || u.ad)) || '').trim()).filter(Boolean))]
            .sort((a, b) => a.localeCompare(b, 'tr'));
        if (current && !names.includes(current)) names.unshift(current);
        names.forEach(n => select.appendChild(new Option(n, n)));
        select.value = current || '';
    }

    // Kod bir kez gösterilir; onay penceresi kapanana kadar ekranda kalır (bildirim balonu gibi kaybolmaz).
    window.showStaffCodeOnce = async function (name, code, accountText, pri) {
        const msg = `${name} için giriş bilgileri:\n\n` + (pri ? `    Kurumsal kimlik: ${pri}\n` : '') + `    Giriş kodu: ${code}\n\n` +
            'Bu bilgileri personele iletin. Kod sistemde SAKLANMAZ; bu pencere kapandıktan sonra bir daha gösterilemez.' +
            (accountText ? `\n\n${accountText}` : '');
        if (typeof showCustomConfirm === 'function') await showCustomConfirm('Giriş Kodu', msg, { confirmText: 'Kodu aldım' });
        else window.alert(msg);
    };

    // Ad yazıldıkça PRI önerisi güncellenir; yönetici PRI kutusunu elle değiştirdiyse dokunulmaz.
    function _bindPriSuggestion(nameInput, priInput, exceptId) {
        priInput.dataset.manual = '';
        priInput.oninput = () => { priInput.dataset.manual = '1'; };
        nameInput.oninput = () => {
            if (priInput.readOnly || priInput.dataset.manual) return;
            priInput.value = window.StaffProvisioning.generateStaffPri(nameInput.value, window.StaffProvisioning.takenPris(window.data.personel, exceptId));
        };
    }

    window.openPersonelModal = function (mode, id = null) {
        const modal = document.getElementById('personelModal');
        const title = document.getElementById('personelModalTitle');
        const nameInput = document.getElementById('personelName');
        const priInput = document.getElementById('personelPri');
        const priHint = document.getElementById('personelPriHint');
        const codeInput = document.getElementById('personelCode');
        const codeRow = document.getElementById('personelCodeRow');
        const codeHint = document.getElementById('personelCodeHint');
        const unitSelect = document.getElementById('personelUnit');
        const form = document.getElementById('personelForm');
        if (!modal) return;
        const SP = window.StaffProvisioning;
        title.innerText = mode === 'add' ? 'Yeni Personel Ekle' : 'Personel Düzenle';

        if (mode === 'edit' && id !== null) {
            const p = (window.data.personel || []).find(x => String(x.id) === String(id));
            if (!p) { showAppAlert('Personel bulunamadı; liste güncellenmiş olabilir.', 'error'); return; }
            nameInput.value = p.name;
            _fillUnitSelect(unitSelect, p.birim || '');
            if (priInput) {
                priInput.value = p.pri || SP.generateStaffPri(p.name, SP.takenPris(window.data.personel, p.id));
                priInput.readOnly = !!p.uid;   // hesap açıksa PRI hesabın e-postasıdır
                if (priHint) priHint.textContent = p.uid ? 'Giriş hesabı açık: kurumsal kimlik değiştirilemez.' : 'Personel bu kimlikle girer. Hesap açılana kadar değiştirilebilir.';
                _bindPriSuggestion(nameInput, priInput, p.id);
                if (p.pri) priInput.dataset.manual = '1';   // kayıtlı PRI ad değişince kendiliğinden değişmesin
            }
            if (codeRow) codeRow.style.display = 'none';
            if (codeHint) codeHint.style.display = 'none';
            codeInput.value = '';
            form.onsubmit = function (e) {
                e.preventDefault();
                editPersonel(p.id);
            };
        } else {
            form.reset();
            _fillUnitSelect(unitSelect, '');
            if (priInput) {
                priInput.readOnly = false;
                priInput.value = '';
                if (priHint) priHint.textContent = 'Addan üretilir (ad.soyad); isterseniz değiştirin. Personel bu kimlikle girer.';
                _bindPriSuggestion(nameInput, priInput, null);
            }
            if (codeRow) codeRow.style.display = '';
            if (codeHint) codeHint.style.display = '';
            codeInput.readOnly = false;
            codeInput.value = getRandomCode();
            form.onsubmit = function (e) {
                e.preventDefault();
                addPersonel();
            };
        }
        window.AppModules.EBYSDefinitionsUI.openPersonnel(mode === 'edit'
            ? (window.data.personel || []).find(p => String(p.id) === String(id)) : null);
        modal.style.display = 'block';
    };

    async function addPersonel() {
        if (!window.requireDbAdmin('Personel ekleme')) return;   // Faz 4 · J1: personel yalnız admin
        const SP = window.StaffProvisioning;
        const name = document.getElementById('personelName').value.trim();
        const code = document.getElementById('personelCode').value.trim();
        const birim = (document.getElementById('personelUnit')?.value || '').trim();
        if (!name) { showAppAlert('Ad Soyad boş olamaz.', 'warning'); return; }
        const priRaw = (document.getElementById('personelPri')?.value || '').trim() || SP.generateStaffPri(name, SP.takenPris(window.data.personel));
        const pri = SP.validatePri(priRaw, window.data.personel);
        if (!pri.ok) { showAppAlert(pri.message, 'warning'); return; }
        // J10: kod yalnız biçim olarak denetlenir (≥4, boşluksuz) — giriş PRI ile yapıldığı için kodların tekil olması gerekmez
        const check = window.StaffCodeRegistry.validateCode(code, []);
        if (!check.ok) { showAppAlert(check.message, 'warning'); return; }
        const person = { id: window.makeId(), name, pri: pri.value, ...(birim ? { birim } : {}) };
        try { Object.assign(person, await window.AppModules.EBYSDefinitions.savePersonnel(person, window.AppModules.EBYSDefinitionsUI.readPersonnel(), true)); }
        catch (error) { showAppAlert(error.message, 'error'); return; }
        if (typeof renderPersonelTable === 'function') renderPersonelTable();
        closePersonelModal();
        const acct = await SP.provisionWithNotice(person, code);
        // Bağlama düştüyse hesap BU kodla açıldı: kod yine bir kez gösterilir ("Hesap Aç" + aynı kod yeniden bağlar)
        if (acct.ok || acct.linkFailed) await window.showStaffCodeOnce(name, code, 'Personel eklendi. ' + acct.text, person.pri);
        else showAppAlert(`Personel eklendi. ${acct.text} Tablodan "Hesap Aç" ile tekrar deneyin.`, 'warning');
    }

    async function editPersonel(id) {
        if (!window.requireDbAdmin('Personel düzenleme')) return;
        const SP = window.StaffProvisioning;
        const p = (window.data.personel || []).find(x => String(x.id) === String(id));
        if (!p) { showAppAlert('Personel bulunamadı; liste güncellenmiş olabilir.', 'error'); return; }
        const name = document.getElementById('personelName').value.trim();
        const birim = (document.getElementById('personelUnit')?.value || '').trim();
        if (!name) { showAppAlert('Ad Soyad boş olamaz.', 'warning'); return; }
        const patch = { name, birim };
        if (!p.uid) {   // hesap açıksa PRI değişmez (e-posta istemciden değiştirilemez)
            const pri = SP.validatePri(document.getElementById('personelPri')?.value || '', window.data.personel, p.id);
            if (!pri.ok) { showAppAlert(pri.message, 'warning'); return; }
            if (pri.value !== p.pri) patch.pri = pri.value;
        }
        try { await window.AppModules.EBYSDefinitions.savePersonnel({ ...p, ...patch }, window.AppModules.EBYSDefinitionsUI.readPersonnel()); }
        catch (error) { showAppAlert(error.message, 'error'); return; }
        if (typeof renderPersonelTable === 'function') renderPersonelTable();
        closePersonelModal();
        showAppAlert('Personel güncellendi.', 'success');
    }

    // J10: hesabı olmayan personele (J7 öncesi kayıt ya da hesap açılamamış yeni kayıt) yeni kodla giriş hesabı. PRI yoksa önce üretilir.
    window.openPersonelAccount = async function (id) {
        if (!window.requireDbAdmin('Giriş hesabı açma')) return;
        const SP = window.StaffProvisioning;
        const p = (window.data.personel || []).find(x => String(x.id) === String(id));
        if (!p) { showAppAlert('Personel bulunamadı; liste güncellenmiş olabilir.', 'error'); return; }
        if (p.uid) { showAppAlert('Bu personelin giriş hesabı zaten var.', 'info'); return; }
        const existing = SP.validatePri(p.pri || '', window.data.personel, p.id);
        const pri = existing.ok ? existing.value : SP.generateStaffPri(p.name, SP.takenPris(window.data.personel, p.id));
        // Önerilen yeni kod; önceki denemede hesap açılıp bağlanamadıysa yönetici o denemede gösterilen kodu yazar (aynı hesap bağlanır).
        const entered = window.prompt(`"${p.name || '-'}" için "${pri}" kurumsal kimliğiyle giriş hesabı açılacak.\n\nGiriş kodu (önerilen yeni kod; daha önce "bağlanamadı" uyarısıyla bir kod gösterildiyse O KODU yazın):`, getRandomCode());
        if (entered === null) return;
        const code = String(entered).trim();
        const check = window.StaffCodeRegistry.validateCode(code, []);
        if (!check.ok) { showAppAlert(check.message, 'warning'); return; }
        if (pri !== p.pri && !(await window.writeOk(window.updateItem('personel', p.id, { pri })))) { showAppAlert('Kurumsal kimlik kaydedilemedi.', 'error'); return; }
        const acct = await SP.provisionWithNotice({ ...p, pri }, code);
        if (acct.ok || acct.linkFailed) { await window.showStaffCodeOnce(p.name || '-', code, acct.text, pri); if (typeof renderPersonelTable === 'function') renderPersonelTable(); }
        else showAppAlert(acct.text, 'warning');
    };

    function closePersonelModal() {
        const modal = document.getElementById('personelModal');
        if (modal) modal.style.display = 'none';
    }

    // Taşıma öncesi script.js'te global olan bildirimler aynı adlarla window'da kalır (inline onclick ve diğer dosyalar).
    Object.assign(window, { _fillUnitSelect, _bindPriSuggestion, addPersonel, editPersonel, closePersonelModal });

    window.AppModules = window.AppModules || {};
    window.AppModules.PersonnelModal = Object.freeze({
        openPersonelModal: window.openPersonelModal, closePersonelModal, addPersonel, editPersonel,
        openPersonelAccount: window.openPersonelAccount, showStaffCodeOnce: window.showStaffCodeOnce
    });
})();
