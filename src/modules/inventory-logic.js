/**
 * inventory-logic.js — Medipol Envanter Takip Sistemi
 * =====================================================
 * v3.1 ESM Modüler Mimari — Phase 4: Envanter İş Mantığı Katmanı
 *
 * [WHY]: script.js monolith'indeki tüm envanter işlemlerini (çıkış, giriş, güncelleme,
 *        silme, pasife alma, takip vb.) tek bir iş mantığı sınıfı altında toplamak.
 * [HOW]: Tüm fonksiyonlar InventoryLogic nesnesinde toplanır, window.AppModules.Inventory'ye
 *        bağlanır ve backward compatibility bridge'ler kurulur.
 *
 * // [STATUS]: InventoryLogic Namespace'i window.AppModules.Inventory'e bağlandı. Legacy köprüleri (bridge) kuruldu.
 */

window.AppModules = window.AppModules || {};
window.AppModules.Inventory = window.AppModules.Inventory || {};

// ─────────────────────────────────────────────────────────────────────────────
// Core Inventory Functions (InventoryLogic)
// ─────────────────────────────────────────────────────────────────────────────
// [WHY]: Tüm ürün işlemleri dizi indeksiyle hedefleniyordu; window.data[depo] her snapshot'ta yeniden kurulduğu için
//        başka bir cihazdaki tek bir ekleme/silme, işlemi yanlış ürüne yönlendirebiliyordu (DATA-06, KN-5). Silme ve takip
//        tüm veritabanını yazıyordu (DATA-01).
// [HOW]: İşlemler depo + ürün id'si alır (render'lar data-id taşır), kayıt id ile çözülür; yazmalar tek-doküman API'siyle.
const _find = (col, id) => (id == null || id === '') ? null : (window.data[col] || []).find(x => x && String(x.id) === String(id)) || null;
const _alert = (msg, type) => { if (typeof window.showAppAlert === 'function') window.showAppAlert(msg, type); };
const _missing = () => _alert('Kayıt bulunamadı; liste güncellenmiş olabilir. Sayfayı yenileyip tekrar deneyin.', 'error');

// Seçili ürünü (#selectedProduct, selectProduct ile doldurulur) id ile çözer; stok düşümü ve b3 çıkış kaydı TEK transaction
// (runExitTransaction · 3.4): ya ikisi birden ya hiçbiri — telafi (stok geri alma) gerekmez. Yalnız yönetici (karar 3).
async function _performExit(requestedQty) {
    if (!(typeof window.isDbAdmin === 'function' && window.isDbAdmin())) { _alert(window.EXIT_ADMIN_ONLY_MESSAGE, 'error'); return; }
    if (!Number.isInteger(requestedQty) || requestedQty < 1) { _alert('Adet en az 1 olan tam sayı olmalıdır.', 'warning'); return; }
    const selectedDiv = document.getElementById('selectedProduct');
    const selected = selectedDiv ? selectedDiv.dataset : null;
    if (!selected || !selected.name || !selected.repo) { _alert('Lütfen listeden bir ürün seçin!', 'warning'); return; }

    const repo = selected.repo;
    const product = _find(repo, selected.id);
    if (!product) { _missing(); return; }

    // Kanonik b3 kaydı (3.6): tür, raf, sütun, marka ve depo yazma anında üründen kopyalanır.
    // Demirbaş (3.9a): adet kadar cihaz kimliği zorunlu (Seri No veya Envanter No); her cihaz ayrı b3 kaydı (adet 1),
    // hepsi stok düşümüyle aynı transaction'da. Sarf malzeme: tek kayıt, serbest "SN / BioPro / Itsm" alanı.
    const common = {
        tip: 'cikis', product, col: repo,
        not:      document.getElementById('exitNote')?.value,
        alanKisi: document.getElementById('exitPerson')?.value,
        personelId: window.getActiveUser?.()?.id,
    };
    let entries;
    if (window.Schema.isDemirbas(product)) {
        const chk = window.AssignmentService.checkDeviceIds({ demirbas: true, qty: requestedQty, ids: window.DeviceIds.read(document.getElementById('exitDeviceIds')) });
        if (!chk.ok) { _alert(chk.errors[0], 'warning'); return; }
        entries = chk.ids.map(d => window.Schema.buildB3Entry({ ...common, adet: 1, sn: d.sn, envanterNo: d.envanterNo }));
    } else {
        entries = [window.Schema.buildB3Entry({ ...common, adet: requestedQty, sn: document.getElementById('exitSn')?.value })];
    }

    let res;
    try {
        res = await window.runExitTransaction({ repo, productId: product.id, qty: requestedQty, b3Entry: entries[0],
            extraWrites: entries.slice(1).map(item => ({ op: 'set', col: 'b3', item })) });
    } catch (e) {
        _alert(e.message || 'Çıkış kaydedilemedi.', 'error');   // hiçbir şey yazılmadı
        return;
    }
    const s = res.stock[0];
    _alert(`Stok güncellendi ve çıkış kaydedildi. Stok: ${s.before} → ${s.after}${s.statusAfter !== s.statusBefore ? ` (${s.statusAfter})` : ''}`, 'success');
    if (typeof window.closeExitModal === 'function') window.closeExitModal();
    if (typeof window.renderTable === 'function') window.renderTable(repo);
    if (typeof window.renderExitTable === 'function') window.renderExitTable();
}

export const addExit = async function () {
    return _performExit(1);
};

export const saveExit = async function (event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    const requestedQty = Number(document.getElementById('exitQty')?.value || 1);
    return _performExit(requestedQty);
};

export const updateStock = async function (depo, id, delta) {
    if (typeof window.checkIsAdmin === 'function' && !window.checkIsAdmin()) {
        if (typeof window.showAppAlert === 'function') window.showAppAlert("Bu işlem için yetkiniz yok!", "error");
        return;
    }

    const item = _find(depo, id);
    if (!item) { _missing(); return; }
    const docId = item.id;

    try {
        await window.runStockTransaction(depo, docId, delta);
        console.log(`✅ ${depo} / ${docId} Transaction Başarılı`);
        if (typeof window.showAppAlert === 'function') window.showAppAlert("Stok güncellendi.", "success");
    } catch (e) {
        console.error("Transaction Hatası:", e);
        if (typeof window.showAppAlert === 'function') window.showAppAlert(e.message, "error");
    }
};

export const deleteItem = async function (depo, id) {
    if (!window.checkIsAdmin || !window.checkIsAdmin()) {
        if (typeof window.showAppAlert === 'function') window.showAppAlert('Silme yetkiniz bulunmamaktadır.', 'error');
        return;
    }

    const item = _find(depo, id);
    if (!item) { _missing(); return; }
    const itemName = item.ürün || item.name || 'Bu kaydı';

    if (typeof window.showCustomConfirm !== 'function') {
        if (!confirm(`"${itemName}" kalıcı olarak silinecektir. Onaylıyor musunuz?`)) return;
    } else {
        const onay = await window.showCustomConfirm(
            'Kalıcı Silme İşlemi',
            `"${itemName}" kalıcı olarak silinecektir. Onaylıyor musunuz?`
        );
        if (!onay) return;
    }

    const scrollPosition = window.scrollY;

    if (!(await window.writeOk(window.removeItem(depo, item.id)))) { _alert('Kayıt silinemedi. Yetkinizi ve bağlantınızı kontrol edin.', 'error'); return; }

    const currentLimit = ((window.currentPage || 1) * (window.pageSize || 25));
    if (typeof window.renderTable === 'function') window.renderTable(depo, false, currentLimit);

    window.scrollTo(0, scrollPosition);
    if (typeof window.showAppAlert === 'function') window.showAppAlert('Kayıt silindi.');
};

export const bulkDelete = async function (depo) {
    if (typeof window.validateAdminAction === 'function' && !window.validateAdminAction()) return;

    const tableId = `table${depo.toUpperCase()}`;
    const tableContainer = document.getElementById(tableId);
    if (!tableContainer) return;

    const checkboxes = tableContainer.querySelectorAll('.row-select:checked');
    if (checkboxes.length === 0) {
        if (typeof window.showAppAlert === 'function') window.showAppAlert('Lütfen pasife alınacak ürünleri seçiniz.', 'warning');
        return;
    }

    const onay = (typeof window.showCustomConfirm === 'function')
        ? await window.showCustomConfirm(
            'Toplu Pasife Alma',
            `${checkboxes.length} adet ürünü pasife almak istediğinize emin misiniz? (Adetleri korunacaktır)`
          )
        : confirm(`${checkboxes.length} ürünü pasife almak istiyor musunuz?`);

    if (!onay) return;

    // Id ile çözülür; yalnız durum alanları güncellenir (diğer alanlara ve eşzamanlı düzenlemelere dokunulmaz).
    const targets = [...checkboxes].map(cb => _find(depo, cb.getAttribute('data-id'))).filter(Boolean);
    if (targets.length < checkboxes.length) { _missing(); return; }
    const changed = targets.length > 0;

    if (changed) {
        if (!(await window.writeOk(window.updateItems(depo, targets.map(t => ({ id: t.id, fields: { durumu: 'Pasif', status: 'Pasif' } })))))) {
            _alert('Pasife alma kaydedilemedi.', 'error');
            return;
        }
        if (typeof window.renderTable === 'function') window.renderTable(depo);
        if (typeof window.showAppAlert === 'function') window.showAppAlert(`${checkboxes.length} ürün başarıyla pasife alındı.`, 'success');

        const selectAll = document.getElementById(`selectAll${depo.toUpperCase()}`);
        if (selectAll) selectAll.checked = false;
    }
};

// [WHY]: Düzenleme kaydı id'siz yeni bir objeyle değiştiriyordu: doküman silinip yeniden oluşuyor, limit/takip/B2 status kayboluyordu (DATA-04).
// [HOW]: Kayıt id ile bulunur ve {...mevcut, ...form, id} ile birleştirilir; B2'de durum 'status' alanına yazılır;
//        yalnız ilgili depo kaydedilir ve sonuç beklenir.
export const saveProduct = async function (e) {
    if (e) e.preventDefault();

    const form = document.getElementById('productForm');
    if (!form) return;

    const editId = form.dataset.editId;
    const editRepo = form.dataset.editRepo || (document.querySelector('.tab-content.active')?.id || 'b1');
    const isEdit = editId !== undefined && editId !== null && editId !== '';

    const formFields = {
        sütun:      document.getElementById('prodColumn')?.value || '',
        raf:        document.getElementById('prodShelf')?.value || '',
        tür:        document.getElementById('prodType')?.value || '',
        ürün:       (document.getElementById('prodName')?.value || '').trim(),
        marka:      document.getElementById('prodBrand')?.value || '',
        adet:       parseInt(document.getElementById('prodQty')?.value) || 0,
        durumu:     document.getElementById('prodStatus')?.value || '',
        açıklama:   document.getElementById('prodDesc')?.value || '',
        isDemirbas: document.getElementById('isDemirbas')?.checked || false,
        lastUpdate: new Date().getTime()
    };

    // Düzenleme: yalnız formun alanları o dokümana yazılır (limit/takip gibi diğer alanlar ve eşzamanlı değişiklikler korunur).
    // Yeni kayıt: tek doküman eklenir. (H2: koleksiyonun tamamı gönderilmez.)
    let ok;
    if (isEdit) {
        const existing = _find(editRepo, editId);
        if (!existing) {
            if (typeof window.showAppAlert === 'function') window.showAppAlert('Düzenlenen ürün bulunamadı; liste güncellenmiş olabilir.', 'error');
            return;
        }
        const fields = { ...formFields };
        if (editRepo === 'b2') {
            fields.status = formFields.durumu;
            if (existing.durumu === undefined) delete fields.durumu;
        }
        ok = await window.writeOk(window.updateItem(editRepo, existing.id, fields));
    } else {
        const created = { id: `${editRepo}_${window.makeId()}`, ...formFields };
        if (editRepo === 'b2') created.status = formFields.durumu;
        ok = await window.writeOk(window.appendItem(editRepo, created));
    }

    if (ok === false) {
        if (typeof window.showAppAlert === 'function') window.showAppAlert('Kayıt başarısız oldu. Yetkinizi ve bağlantınızı kontrol edin.', 'error');
        return;
    }

    if (typeof window.renderTable === 'function') {
        const limit = (window.currentPage || 1) * (window.pageSize || 25);
        window.renderTable(editRepo, false, limit);
    }

    if (typeof window.showAppAlert === 'function') window.showAppAlert('İşlem Başarılı!', 'success');
    if (typeof window.closeProductModal === 'function') window.closeProductModal();
};

export const toggleWatch = async function (depo, id) {
    const item = _find(depo, id);
    if (!item) { _missing(); return; }

    // Yalnız isWatched alanı yazılır (tek doküman).
    if (!(await window.writeOk(window.updateItem(depo, item.id, { isWatched: !item.isWatched })))) {
        _alert('Takip durumu kaydedilemedi.', 'error');
        return;
    }
    // [WHY]: Kayıt yazılıyordu ama tablo görünümünde takip hiç gösterilmediği ve FAB etiketi değişmediği için "tepki yok" gibiydi.
    // [HOW]: Bildirim gösterilir, FAB etiketi yenilenir (Takip ⇄ Bırak), tabloda ürün adının yanında göz simgesi çizilir.
    const nowWatched = !!_find(depo, item.id)?.isWatched;
    _alert(nowWatched ? `"${item.ürün || item.name || 'Ürün'}" takibe alındı.` : `"${item.ürün || item.name || 'Ürün'}" takipten çıkarıldı.`, 'success');
    if (typeof window.renderTable === 'function') window.renderTable(depo);
    if (typeof window.updateFloatingBar === 'function') window.updateFloatingBar();
    if (typeof window.renderCustomWatchDashboard === 'function') window.renderCustomWatchDashboard();
};

// [WHY]: ESM geçişinde saveRequest kayboldu; "Envanter Talep Et" formu var olmayan bir fonksiyonu çağırıp sayfayı yeniliyordu (ITSM-01).
// [HOW]: Form alanları doğrulanır; yeni talep eklenir veya düzenlenen talep id ile bulunup birleştirilir; yalnız 'requests' yazılır.
export const saveRequest = async function (event) {
    if (event) { event.preventDefault(); event.stopPropagation(); }

    const alert = (msg, type) => { if (typeof window.showAppAlert === 'function') window.showAppAlert(msg, type); };
    const user = window.getActiveUser();
    if (!user) { alert('Talep oluşturmak için giriş yapmalısınız.', 'error'); return; }

    const val = id => (document.getElementById(id)?.value || '').trim();
    const urun = val('reqProdName');
    const adet = parseInt(val('reqQty'), 10);
    const talepTuru = val('reqType') || 'Kalıcı Zimmet';
    const oncelik = val('reqPriority') || 'Orta';
    const iadeTarihi = val('reqReturnDate');
    const not = val('reqNote');

    if (!urun) { alert('Lütfen talep edilen ürünü yazın.', 'warning'); return; }
    if (!Number.isInteger(adet) || adet < 1) { alert('Adet en az 1 olmalıdır.', 'warning'); return; }
    if (talepTuru === 'Geçici Zimmet') {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        if (!iadeTarihi || new Date(iadeTarihi + 'T00:00:00') <= today) {
            alert('Geçici zimmet için bugünden sonraki bir iade tarihi seçin.', 'warning');
            return;
        }
    }

    const formFields = {
        ürün: urun, adet, talepTuru, oncelik, not,
        iadeTarihi: talepTuru === 'Geçici Zimmet' ? iadeTarihi : '',
    };

    const editId = window.editingReqId;
    let saved;
    if (editId !== null && editId !== undefined) {
        if (!_find('requests', editId)) { alert('Düzenlenen talep bulunamadı; liste güncellenmiş olabilir.', 'error'); return; }
        saved = await window.writeOk(window.updateItem('requests', editId, formFields));
    } else {
        saved = await window.writeOk(window.appendItem('requests', {
            ...formFields,
            personel: user.name,
            // Kişi eşleşmesi id ile (3.7). Erişim kodu artık talebe kopyalanmıyor (herkesin okuyabildiği koleksiyon).
            personelId: user.id ?? null,
            durum: 'Beklemede',
            tarih: typeof window.getTurkiyeTarihi === 'function' ? window.getTurkiyeTarihi() : new Date().toLocaleDateString('tr-TR'),
        }));
    }

    if (saved === false) {
        alert('Talep kaydedilemedi. Bağlantınızı kontrol edip tekrar deneyin.', 'error');
        return;
    }

    window.editingReqId = null;
    window.editingReqIndex = null;
    document.getElementById('requestForm')?.reset();
    if (typeof window.closeRequestModal === 'function') window.closeRequestModal();
    if (typeof window.renderMyRequestsTable === 'function') window.renderMyRequestsTable();
    alert(editId != null ? 'Talebiniz güncellendi.' : 'Talebiniz iletildi.', 'success');
};

export const receiveProduct = async function (id) {
    const req = _find('requests', id);
    if (!req) { _missing(); return; }

    // [WHY]: Tam kayıt personel oturumunda reddediliyor, "Teslim Aldım" hiç kaydolmuyordu (ITSM-03, DATA-03).
    // [HOW]: Yalnız talebin durum alanları yazılır (tek doküman). Zimmet (b3) kaydını admin onay adımı (confirmRequest) yazar.
    const fields = {
        durum: 'completed',
        teslimTarihi: typeof window.getTurkiyeTarihi === 'function' ? window.getTurkiyeTarihi() : new Date().toLocaleDateString('tr-TR')
    };

    try {
        if (!(await window.writeOk(window.updateItem('requests', req.id, fields)))) { _alert('Teslim alındı bilgisi kaydedilemedi.', 'error'); return; }
        if (typeof window.sendArchiveEmail === 'function') window.sendArchiveEmail({ ...req, ...fields });
        if (typeof window.renderMyRequestsTable === 'function') window.renderMyRequestsTable();
        if (typeof window.showAppAlert === 'function') {
            window.showAppAlert("Ürünü teslim aldığınızı onayladınız. Talep Sonlandırıldı.", "info");
        }
    } catch (e) {
        console.error("Hata:", e);
    }
};

export const deleteB3Row = async function (id) {
    if (!window.checkIsAdmin || !window.checkIsAdmin()) {
        if (typeof window.showAppAlert === 'function') window.showAppAlert('Bu işlem için yönetici yetkisi gereklidir!', 'error');
        return;
    }

    try {
        const row = _find('b3', id);
        if (!row) { _missing(); return; }
        const ok = typeof window.showCustomConfirm === 'function'
            ? await window.showCustomConfirm('Çıkış Kaydını Sil', `"${window.Schema.normalizeB3(row).urunAciklama}" çıkış kaydı silinecek. Stok değişmez. Onaylıyor musunuz?`)
            : confirm('Çıkış kaydı silinsin mi?');
        if (ok !== true) return;
        if (!(await window.writeOk(window.removeItem('b3', row.id)))) { _alert('Kayıt silinemedi.', 'error'); return; }

        if (typeof window.renderExitTable === 'function') window.renderExitTable();
        else if (typeof window.renderTable === 'function') window.renderTable('b3');
        _alert('Kayıt başarıyla silindi.', 'success');
    } catch (error) {
        console.error('Silme hatası:', error);
        if (typeof window.showAppAlert === 'function') window.showAppAlert('Kayıt silinirken bir hata oluştu!', 'error');
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// Legacy compatibility support for other functions
// ─────────────────────────────────────────────────────────────────────────────
export const toggleStatus = async function (depo, id) {
    const item = _find(depo, id);
    if (!item) { _missing(); return; }

    const field = depo === 'b1' ? 'durumu' : 'status';
    if (!(await window.writeOk(window.updateItem(depo, item.id, { [field]: item[field] === 'Pasif' ? 'Aktif' : 'Pasif' })))) {
        _alert('Durum kaydedilemedi.', 'error');
        return;
    }
    if (typeof window.renderTable === 'function') window.renderTable(depo);
};

// Toplu silme: seçili satırların id'leri (FAB). Onaylı ve bilinçli toplu işlem → bulkRemove (tek atomik batch).
export const _bulkDeleteSelected = async function (depo, ids) {
    if (!window.checkIsAdmin || !window.checkIsAdmin()) {
        if (typeof window.showAppAlert === 'function') window.showAppAlert('Bu işlem için yetkiniz yok!', 'error');
        return;
    }

    const targets = (ids || []).map(id => _find(depo, id)).filter(Boolean);
    if (targets.length === 0 || targets.length < (ids || []).length) { _missing(); return; }

    const onay = (typeof window.showCustomConfirm === 'function')
        ? await window.showCustomConfirm('Toplu Silme', `${targets.length} kayıt kalıcı olarak silinecek. Onaylıyor musunuz?`)
        : confirm(`${targets.length} kayıt silinecek. Devam edilsin mi?`);

    if (onay !== true) return;

    if (!(await window.writeOk(window.bulkRemove(depo, targets.map(t => t.id))))) { _alert('Toplu silme kaydedilemedi; hiçbir kayıt silinmedi.', 'error'); return; }

    if (typeof window.clearRowSelection === 'function') window.clearRowSelection();
    if (typeof window.renderTable === 'function') window.renderTable(depo);
    _alert(`${targets.length} kayıt başarıyla silindi.`, 'success');
};

export const toggleSelectAll = function (depo) {
    const selectAll = document.getElementById(`selectAll${depo.toUpperCase()}`);
    if (!selectAll) return;

    const checkboxes = document.querySelectorAll(`#table${depo.toUpperCase()} .row-select`);
    checkboxes.forEach(cb => cb.checked = selectAll.checked);
};

// ─────────────────────────────────────────────────────────────────────────────
// Namespace Object & Bridges Assignment
// ─────────────────────────────────────────────────────────────────────────────
export const InventoryLogic = {
    addExit,
    saveExit,
    updateStock,
    deleteItem,
    bulkDelete,
    saveProduct,
    toggleWatch,
    saveRequest,
    receiveProduct,
    deleteB3Row,
    toggleStatus,
    _bulkDeleteSelected,
    toggleSelectAll
};

window.AppModules = window.AppModules || {};
window.AppModules.Inventory = InventoryLogic;

// Bridges
window.addExit = window.AppModules.Inventory.addExit;
window.saveExit = window.AppModules.Inventory.saveExit;
window.updateStock = window.AppModules.Inventory.updateStock;
window.deleteItem = window.AppModules.Inventory.deleteItem;
window.bulkDelete = window.AppModules.Inventory.bulkDelete;
window.saveProduct = window.AppModules.Inventory.saveProduct;
window.toggleWatch = window.AppModules.Inventory.toggleWatch;
window.saveRequest = window.AppModules.Inventory.saveRequest;
window.receiveProduct = window.AppModules.Inventory.receiveProduct;
window.deleteB3Row = window.AppModules.Inventory.deleteB3Row;
window.toggleStatus = window.AppModules.Inventory.toggleStatus;
window._bulkDeleteSelected = window.AppModules.Inventory._bulkDeleteSelected;
window.toggleSelectAll = window.AppModules.Inventory.toggleSelectAll;

console.log('✅ [inventory-logic.js] Envanter iş mantığı motoru yüklendi (saveProduct, deleteItem, saveExit, bulkDelete, deleteB3Row, toggleWatch, receiveProduct, addExit, updateStock).');
