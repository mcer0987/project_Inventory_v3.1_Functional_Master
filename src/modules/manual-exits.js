(function () {
    const COLLECTION = 'manualExits';
    const isAdmin = () => typeof window.isDbAdmin === 'function' && window.isDbAdmin();
    const notify = (message, type) => {
        if (typeof window.showAppAlert === 'function') window.showAppAlert(message, type);
    };
    const escapeHtml = value => window.escapeHtml(value);
    const byId = id => document.getElementById(id);

    function syncForm() {
        const asset = byId('manualExitIsAsset');
        const inventoryNo = byId('manualExitInventoryNo');
        if (asset && inventoryNo) inventoryNo.required = asset.checked;
    }

    function openModal() {
        if (!isAdmin()) {
            notify('Kayıt dışı çıkış eklemek için yönetici yetkisi gereklidir.', 'error');
            return;
        }
        const form = byId('manualExitForm');
        const modal = byId('manualExitModal');
        if (!form || !modal) {
            notify('Kayıt dışı çıkış formu yüklenemedi.', 'error');
            return;
        }
        form.reset();
        const asset = byId('manualExitIsAsset');
        if (asset) asset.checked = true;
        const requester = form.elements.namedItem('cikisiIsteyen');
        const activeUser = typeof window.getActiveUser === 'function' ? window.getActiveUser() : null;
        if (requester && activeUser && activeUser.name) requester.value = activeUser.name;
        syncForm();
        modal.style.display = 'block';
        form.elements.namedItem('kime')?.focus();
    }

    function closeModal() {
        const modal = byId('manualExitModal');
        if (modal) modal.style.display = 'none';
    }

    function render() {
        const tbody = document.querySelector('#tableManualExits tbody');
        if (!tbody) return;
        const records = Array.isArray(window.data && window.data[COLLECTION]) ? window.data[COLLECTION] : [];
        if (!records.length) {
            tbody.innerHTML = '<tr><td colspan="12" style="text-align:center;">Henüz kayıt dışı çıkış kaydı yok.</td></tr>';
            return;
        }
        const rows = [...records].sort((a, b) => Number(b.ts) - Number(a.ts));
        tbody.innerHTML = rows.map(record => `<tr>
            <td style="text-align:center;"><input type="checkbox" class="row-select manual-exit-row-select" data-id="${escapeHtml(record.id)}"></td>
            <td>${escapeHtml(record.tarih)}</td>
            <td>${escapeHtml(record.kime)}</td>
            <td>${escapeHtml(record.nereye)}</td>
            <td>${escapeHtml(record.cihaz)}</td>
            <td>${escapeHtml(record.sn || '-')}</td>
            <td>${escapeHtml(record.envanterNo || '-')}</td>
            <td>${record.isDemirbas ? 'Evet' : 'Hayır'}</td>
            <td>${escapeHtml(record.adet)}</td>
            <td>${escapeHtml(record.ekNot || '-')}</td>
            <td>${escapeHtml(record.cikisiIsteyen)}</td>
            <td class="action-cell">
                <div class="table-row-actions">
                    <button class="table-action-btn delete-btn btn-delete" type="button" data-action="delete-manual-exit"
                        data-id="${escapeHtml(record.id)}" title="Kaydı Sil"><i class="fas fa-trash-alt"></i> Sil</button>
                </div>
            </td>
        </tr>`).join('');
    }

    async function save(event) {
        event.preventDefault();
        if (!isAdmin()) {
            notify('Kayıt dışı çıkış eklemek için yönetici yetkisi gereklidir.', 'error');
            return;
        }
        const form = event.currentTarget;
        const submit = form.querySelector('[type="submit"]');
        const auth = window.userAuth;
        if (!auth || !auth.uid || typeof window.appendItem !== 'function' || !window.ManualExitSchema) {
            notify('Kayıt servisi hazır değil veya oturum bulunamadı; kayıt eklenemedi.', 'error');
            return;
        }

        const value = name => String(form.elements.namedItem(name)?.value || '');
        const activeUser = typeof window.getActiveUser === 'function' ? window.getActiveUser() : null;
        const { record, errors } = window.ManualExitSchema.build({
            id: String(window.makeId()),
            kime: value('kime'),
            nereye: value('nereye'),
            cihaz: value('cihaz'),
            sn: value('sn'),
            envanterNo: value('envanterNo'),
            isDemirbas: byId('manualExitIsAsset').checked,
            adet: value('adet'),
            ekNot: value('ekNot'),
            cikisiIsteyen: value('cikisiIsteyen'),
            personelId: activeUser && activeUser.id,
            actorUid: auth.uid,
            tarih: typeof window.getTurkiyeSaati === 'function'
                ? window.getTurkiyeSaati()
                : new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }),
            ts: Date.now(),
        });
        if (errors.length) {
            notify(errors[0], 'warning');
            return;
        }

        if (submit) submit.disabled = true;
        try {
            await window.appendItem(COLLECTION, record);
            render();
            closeModal();
            notify('Kayıt dışı çıkış kaydedildi.', 'success');
        } catch (error) {
            console.error('[ManualExits] Kayıt eklenemedi:', error);
            notify(error.message || 'Kayıt dışı çıkış kaydedilemedi.', 'error');
        } finally {
            if (submit) submit.disabled = false;
        }
    }

    async function remove(id) {
        if (!isAdmin()) {
            notify('Kayıt silmek için yönetici yetkisi gereklidir.', 'error');
            return;
        }
        const record = (window.data[COLLECTION] || []).find(item => String(item.id) === String(id));
        if (!record) {
            notify('Kayıt bulunamadı; liste güncellenmiş olabilir.', 'error');
            return;
        }
        const confirmDelete = typeof window.showCustomConfirm === 'function'
            ? await window.showCustomConfirm('Kayıt Dışı Çıkışı Sil', `"${record.cihaz}" kaydı silinecek. Onaylıyor musunuz?`)
            : confirm('Kayıt dışı çıkış silinsin mi?');
        if (confirmDelete !== true) return;
        try {
            await window.removeItem(COLLECTION, record.id);
            render();
            notify('Kayıt dışı çıkış silindi.', 'success');
        } catch (error) {
            console.error('[ManualExits] Kayıt silinemedi:', error);
            notify(error.message || 'Kayıt dışı çıkış silinemedi.', 'error');
        }
    }

    // [WHY]: Kayıt dışı çıkışların raporlama sonrası toplu temizlenmesi
    // [HOW]: Seçili ID'leri toplayıp onay alır ve window.bulkRemove (veya removeItem) ile siler
    async function bulkDelete() {
        if (!isAdmin()) {
            notify('Kayıt silmek için yönetici yetkisi gereklidir.', 'error');
            return;
        }
        const checked = Array.from(document.querySelectorAll('.manual-exit-row-select:checked'));
        if (!checked.length) {
            notify('Lütfen silinecek kayıt dışı çıkışları seçin.', 'warning');
            return;
        }
        const ids = checked.map(cb => cb.dataset.id).filter(Boolean);
        const confirmDelete = typeof window.showCustomConfirm === 'function'
            ? await window.showCustomConfirm('Toplu Kayıt Dışı Çıkış Silme', `${ids.length} adet kayıt kalıcı olarak silinecek. Onaylıyor musunuz?`)
            : confirm(`${ids.length} adet kayıt silinsin mi?`);
        if (confirmDelete !== true) return;

        try {
            if (typeof window.bulkRemove === 'function') {
                await window.bulkRemove(COLLECTION, ids);
            } else {
                for (const id of ids) {
                    await window.removeItem(COLLECTION, id);
                }
            }
            const selectAll = byId('selectAllManualExits');
            if (selectAll) selectAll.checked = false;
            render();
            notify(`${ids.length} adet kayıt dışı çıkış başarıyla silindi.`, 'success');
        } catch (error) {
            console.error('[ManualExits] Toplu silme hatası:', error);
            notify(error.message || 'Kayıtlar silinemedi.', 'error');
        }
    }

    function exportExcel() {
        if (!window.XLSX || !window.XLSX.utils) {
            notify('Excel raporu oluşturulamadı; Excel bileşeni yüklenmemiş.', 'error');
            return;
        }
        const records = Array.isArray(window.data && window.data[COLLECTION]) ? window.data[COLLECTION] : [];
        if (!records.length) {
            notify('Raporlanacak kayıt dışı çıkış bulunmuyor.', 'info');
            return;
        }
        const rows = [...records].sort((a, b) => Number(b.ts) - Number(a.ts)).map(record => ({
            'Tarih': record.tarih,
            'Kime': record.kime,
            'Nereye': record.nereye,
            'Cihaz / Ürün': record.cihaz,
            'Seri No': record.sn || '',
            'Envanter No': record.envanterNo || '',
            'Demirbaş': record.isDemirbas ? 'Evet' : 'Hayır',
            'Adet': record.adet,
            'Ek Not': record.ekNot || '',
            'Çıkışı İsteyen': record.cikisiIsteyen,
        }));
        const worksheet = window.XLSX.utils.json_to_sheet(rows);
        const workbook = window.XLSX.utils.book_new();
        window.XLSX.utils.book_append_sheet(workbook, worksheet, 'Kayıt Dışı Çıkışlar');
        const date = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' });
        window.XLSX.writeFile(workbook, `Kayit_Disi_Cikislar_${date}.xlsx`);
        notify('Kayıt dışı çıkış Excel raporu oluşturuldu.', 'success');
    }

    function initialize() {
        if (typeof window.bindActions === 'function') {
            window.bindActions(byId('manualExitTab'), {
                'delete-manual-exit': button => remove(button.dataset.id),
            });
            window.bindActions(byId('manualExitModal'), {
                'close-manual-exit': closeModal,
            });
        }
        const form = byId('manualExitForm');
        if (form) form.addEventListener('submit', save);
        byId('manualExitIsAsset')?.addEventListener('change', syncForm);
        byId('selectAllManualExits')?.addEventListener('change', (e) => {
            const checked = e.target.checked;
            document.querySelectorAll('.manual-exit-row-select').forEach(cb => { cb.checked = checked; });
        });
        window.addEventListener('onInventoryDataUpdated', event => {
            if (event.detail && event.detail.collection === COLLECTION) render();
        });
        render();
    }

    window.manualExitsModule = Object.freeze({ render, openModal, closeModal, exportExcel, syncForm, remove, bulkDelete });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
    else initialize();
})();
