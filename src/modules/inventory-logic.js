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

export const addExit = async function () {
    const selectedDiv = document.getElementById('selectedProduct');
    const selected = selectedDiv ? selectedDiv.dataset : null;

    if (!selected || !selected.name) {
        if (typeof window.showAppAlert === 'function') window.showAppAlert("Lütfen listeden bir ürün seçin!", "warning");
        return;
    }

    // [WHY]: currentExitRepo B3 sekmesinden 'b3' olarak geliyordu; stok yerine çıkış log'u düşülüyordu (INV-02).
    // [HOW]: Depo ve indeks aynı kaynaktan, seçilen üründen okunur (openExitModal satır ürününü ön-seçer).
    const repo = selected.repo;
    const index = selected.index;

    if (repo && index !== "" && index !== undefined) {
        const repoData = window.data[repo];
        if (repoData && repoData[index]) {
            const product = repoData[index];
            const docId = product.id;

            try {
                await window.runStockTransaction(repo, docId, -1);
            } catch (error) {
                if (typeof window.showAppAlert === 'function') window.showAppAlert(error.message, "error");
                return;
            }
        }
    }

    const isDemirbasFlag = selected.isDemirbas === "true";
    const saati = (typeof window.getTurkiyeSaati === 'function')
        ? window.getTurkiyeSaati()
        : new Date().toLocaleString('tr-TR');

    const exitEntry = {
        id:           Date.now(),
        rafNo:        selected.shelf || "-",
        urunAciklama: selected.name  || "-",
        urunTuru:     selected.type  || "-",
        sn:           document.getElementById('exitSn')?.value   || "-",
        adet:         1,
        not:          document.getElementById('exitNote')?.value || "-",
        alanKisi:     document.getElementById('exitPerson')?.value || "-",
        tarih:        saati,
        isDemirbas:   isDemirbasFlag,
        kaynakDepo:   repo
    };

    console.log("🚀 Firebase b3'e gönderilen veri paketi:", exitEntry);

    if (!window.data.b3) window.data.b3 = [];
    window.data.b3.unshift(exitEntry);

    try {
        await window.saveData('b3', window.data.b3);
        if (typeof window.showAppAlert === 'function') window.showAppAlert('Stok güncellendi ve çıkış kaydedildi.', 'success');
        if (typeof window.closeExitModal === 'function') window.closeExitModal();

        setTimeout(() => {
            try {
                if (typeof window.renderTable === 'function') window.renderTable(repo);
                if (typeof window.renderExitTable === 'function') window.renderExitTable();
            } catch (err) {
                console.warn(err);
            }
        }, 100);
    } catch (err) {
        console.error(err);
    }
};

export const saveExit = async function (event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }

    const selectedDiv = document.getElementById('selectedProduct');
    if (!selectedDiv) {
        if (typeof window.showAppAlert === 'function') window.showAppAlert('Ürün seçim alanı bulunamadı.', 'error');
        return;
    }

    const isDemirbas = selectedDiv.dataset.isDemirbas === 'true';
    const selected = selectedDiv.dataset;

    const repo  = selected.repo;
    const index = selected.index;

    const qtyInput = document.getElementById('exitQty');
    const requestedQty = parseInt(qtyInput?.value) || 1;

    if (!selected.name || repo === undefined || index === undefined) {
        if (typeof window.showAppAlert === 'function') window.showAppAlert('Lütfen listeden bir ürün seçin!', 'warning');
        return;
    }

    if (window.data[repo] && window.data[repo][index]) {
        const product = window.data[repo][index];
        const docId = product.id;

        if (!docId) {
            if (typeof window.showAppAlert === 'function') window.showAppAlert('Ürün kaydında geçerli bir ID bulunamadı. Lütfen sistemi yenileyin.', 'error');
            console.error('❌ [saveExit] Ürün id alanı eksik:', product);
            return;
        }

        try {
            await window.runStockTransaction(repo, docId, -requestedQty);
            console.log(`✅ [saveExit] Atomik transaction başarılı. Repo: ${repo}, ID: ${docId}, Delta: -${requestedQty}`);
        } catch (transactionError) {
            if (typeof window.showAppAlert === 'function') window.showAppAlert(transactionError.message, 'error');
            console.error('❌ [saveExit] Transaction başarısız, log kaydı iptal:', transactionError);
            return;
        }
    } else {
        console.error('Ürün verisine ulaşılamadı. Repo:', repo, 'Index:', index);
        if (typeof window.showAppAlert === 'function') window.showAppAlert('Ürün verisi bellekte bulunamadı. Sayfayı yenileyip tekrar deneyin.', 'error');
        return;
    }

    const saati = (typeof window.getTurkiyeSaati === 'function')
        ? window.getTurkiyeSaati()
        : new Date().toLocaleString('tr-TR');

    const b3Entry = {
        id:           Date.now(),
        rafNo:        selected.shelf || '-',
        urunTuru:     selected.type  || '-',
        urunAciklama: selected.name  || '-',
        sn:           document.getElementById('exitSn')?.value     || '-',
        adet:         requestedQty,
        not:          document.getElementById('exitNote')?.value   || '-',
        alanKisi:     document.getElementById('exitPerson')?.value || '-',
        tarih:        saati,
        isDemirbas:   isDemirbas,
        kaynakDepo:   repo
    };

    console.log('🚀 Firebase b3\'e gönderilen veri paketi:', b3Entry);

    if (!window.data.b3) window.data.b3 = [];
    window.data.b3.unshift(b3Entry);

    try {
        await window.saveData('b3', window.data.b3);

        if (typeof window.showAppAlert === 'function') window.showAppAlert('Stok güncellendi ve çıkış kaydedildi.', 'success');
        if (typeof window.closeExitModal === 'function') window.closeExitModal();

        setTimeout(() => {
            try {
                if (typeof window.renderTable === 'function') window.renderTable(repo);
                if (typeof window.renderExitTable === 'function') window.renderExitTable();
            } catch (renderErr) {
                console.warn('Tablolar yenilenirken küçük hata:', renderErr);
            }
        }, 100);

    } catch (err) {
        console.error('Kayıt hatası:', err);
        if (typeof window.showAppAlert === 'function') window.showAppAlert('Kayıt sırasında bir hata oluştu!', 'error');
    }
};

export const updateStock = async function (depo, index, delta) {
    if (typeof window.checkIsAdmin === 'function' && !window.checkIsAdmin()) {
        if (typeof window.showAppAlert === 'function') window.showAppAlert("Bu işlem için yetkiniz yok!", "error");
        return;
    }

    if (!window.data[depo] || !window.data[depo][index]) {
        console.error("Hata: Ürün bulunamadı!", { depo, index });
        return;
    }

    const item = window.data[depo][index];
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

export const deleteItem = async function (depo, index) {
    if (!window.checkIsAdmin || !window.checkIsAdmin()) {
        if (typeof window.showAppAlert === 'function') window.showAppAlert('Silme yetkiniz bulunmamaktadır.', 'error');
        return;
    }

    const item = window.data[depo] && window.data[depo][index];
    if (!item) {
        if (typeof window.showAppAlert === 'function') window.showAppAlert('Silinecek kayıt bulunamadı.', 'error');
        return;
    }
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

    window.data[depo].splice(index, 1);
    await window.saveData(window.data);

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

    let changed = false;

    checkboxes.forEach(cb => {
        const realIndex = cb.getAttribute('data-index');
        if (realIndex !== null && window.data[depo] && window.data[depo][realIndex]) {
            window.data[depo][realIndex].durumu = 'Pasif';
            window.data[depo][realIndex].status = 'Pasif';
            changed = true;
        }
    });

    if (changed) {
        await window.saveData(window.data);
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

    const editIndex = form.dataset.editIndex;
    const editId = form.dataset.editId;
    const editRepo = form.dataset.editRepo || (document.querySelector('.tab-content.active')?.id || 'b1');
    const isEdit = editIndex !== undefined && editIndex !== null && editIndex !== '';

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

    const items = [...(window.data[editRepo] || [])];

    if (isEdit) {
        const idx = editId !== undefined && editId !== ''
            ? items.findIndex(x => String(x.id) === String(editId))
            : parseInt(editIndex, 10);
        const existing = items[idx];
        if (!existing) {
            if (typeof window.showAppAlert === 'function') window.showAppAlert('Düzenlenen ürün bulunamadı; liste güncellenmiş olabilir.', 'error');
            return;
        }
        const merged = { ...existing, ...formFields, id: existing.id };
        if (editRepo === 'b2') {
            merged.status = formFields.durumu;
            if (existing.durumu === undefined) delete merged.durumu;
        }
        items[idx] = merged;
    } else {
        const created = { id: `${editRepo}_${Date.now()}`, ...formFields };
        if (editRepo === 'b2') created.status = formFields.durumu;
        items.push(created);
    }

    const ok = await window.saveData(editRepo, items);
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

export const toggleWatch = async function (depo, index) {
    console.group('🔍 Takip İşlemi Başladı');

    const item = window.data[depo] && window.data[depo][index];
    if (!item) {
        console.error('❌ Hata: Belirtilen indexte ürün bulunamadı!', { depo, index });
        console.groupEnd();
        return;
    }

    const oldState = !!item.isWatched;
    const newState = !oldState;

    window.data[depo][index].isWatched = newState;

    try {
        await window.saveData(window.data);
        if (typeof window.renderTable === 'function') window.renderTable(depo);
        if (typeof window.renderCustomWatchDashboard === 'function') {
            window.renderCustomWatchDashboard();
        }
    } catch (error) {
        window.data[depo][index].isWatched = oldState;
        if (typeof window.renderTable === 'function') window.renderTable(depo);
    }

    console.groupEnd();
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

    const requests = [...(window.data.requests || [])];
    const editId = window.editingReqId;
    if (editId !== null && editId !== undefined) {
        const idx = requests.findIndex(r => String(r.id) === String(editId));
        if (idx === -1) { alert('Düzenlenen talep bulunamadı; liste güncellenmiş olabilir.', 'error'); return; }
        requests[idx] = { ...requests[idx], ...formFields };
    } else {
        requests.unshift({
            id: Date.now(),
            ...formFields,
            personel: user.name,
            personelKodu: user.code || '',
            durum: 'Beklemede',
            tarih: typeof window.getTurkiyeTarihi === 'function' ? window.getTurkiyeTarihi() : new Date().toLocaleDateString('tr-TR'),
        });
    }

    if (await window.saveData('requests', requests) === false) {
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

export const receiveProduct = async function (index) {
    if (!window.data || !window.data.requests) return;
    const req = window.data.requests[index];
    if (!req) return;

    // [WHY]: Tam kayıt personel oturumunda reddediliyor, "Teslim Aldım" hiç kaydolmuyordu (ITSM-03, DATA-03).
    // [HOW]: Yalnız talep durumu yazılır. Zimmet (b3) kaydını admin onay adımı (confirmRequest) yazar; personel b3'e yazamaz.
    req.durum = 'completed';
    req.teslimTarihi = typeof window.getTurkiyeTarihi === 'function' ? window.getTurkiyeTarihi() : new Date().toLocaleDateString('tr-TR');

    try {
        await window.saveData('requests', window.data.requests);
        if (typeof window.sendArchiveEmail === 'function') window.sendArchiveEmail(req);
        if (typeof window.renderMyRequestsTable === 'function') window.renderMyRequestsTable();
        if (typeof window.showAppAlert === 'function') {
            window.showAppAlert("Ürünü teslim aldığınızı onayladınız. Talep Sonlandırıldı.", "info");
        }
    } catch (e) {
        console.error("Hata:", e);
    }
};

export const deleteB3Row = async function (index) {
    if (!window.checkIsAdmin || !window.checkIsAdmin()) {
        if (typeof window.showAppAlert === 'function') window.showAppAlert('Bu işlem için yönetici yetkisi gereklidir!', 'error');
        return;
    }

    try {
        if (window.data.b3 && window.data.b3[index]) {
            window.data.b3.splice(index, 1);
            await window.saveData(window.data);

            if (typeof window.renderExitTable === 'function') {
                window.renderExitTable();
            } else {
                if (typeof window.renderTable === 'function') window.renderTable('b3');
            }

            if (typeof window.showAppAlert === 'function') window.showAppAlert('Kayıt başarıyla silindi.', 'success');
        }
    } catch (error) {
        console.error('Silme hatası:', error);
        if (typeof window.showAppAlert === 'function') window.showAppAlert('Kayıt silinirken bir hata oluştu!', 'error');
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// Legacy compatibility support for other functions
// ─────────────────────────────────────────────────────────────────────────────
export const toggleStatus = function (depo, index) {
    const item = window.data[depo] && window.data[depo][index];
    if (!item) return;

    if (depo === 'b1') {
        item.durumu = (item.durumu === 'Pasif' ? 'Aktif' : 'Pasif');
    } else {
        item.status = (item.status === 'Pasif' ? 'Aktif' : 'Pasif');
    }

    if (typeof window.saveData === 'function') window.saveData(window.data);
    if (typeof window.renderTable === 'function') window.renderTable(depo);
};

export const _bulkDeleteSelected = async function (depo, indices) {
    if (!window.checkIsAdmin || !window.checkIsAdmin()) {
        if (typeof window.showAppAlert === 'function') window.showAppAlert('Bu işlem için yetkiniz yok!', 'error');
        return;
    }

    const onay = (typeof window.showCustomConfirm === 'function')
        ? await window.showCustomConfirm('Toplu Silme', `${indices.length} kayıt kalıcı olarak silinecek. Onaylıyor musunuz?`)
        : confirm(`${indices.length} kayıt silinecek. Devam edilsin mi?`);

    if (!onay) return;

    indices.sort((a, b) => b - a).forEach(idx => {
        if (window.data[depo] && window.data[depo][idx]) {
            window.data[depo].splice(idx, 1);
        }
    });

    // Kullanıcı onaylı toplu silme: saveData v2 toplu silme kilidi bilinçli olarak açılır (Faz 3.1).
    await window.saveData(window.data, { allowBulkDelete: true });

    if (typeof window.clearRowSelection === 'function') window.clearRowSelection();
    if (typeof window.renderTable === 'function') window.renderTable(depo);
    if (typeof window.showAppAlert === 'function') window.showAppAlert(`${indices.length} kayıt başarıyla silindi.`, 'success');
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
