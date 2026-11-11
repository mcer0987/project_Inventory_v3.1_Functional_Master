/**
 * ui-components.js — Medipol Envanter Takip Sistemi
 * ==================================================
 * v3.1 ESM Modüler Mimari — Phase 5: UI Components Extraction
 *
 * [WHY]: script.js monoliti Phase 5 kapsamında ayrıştırılıyor. Modal yönetimi,
 *        FAB (Floating Action Bar) ve Mobile Bottom Sheet gibi saf UI interaction
 *        mantığı bu dosyaya taşınıyor. Hiçbir Firebase çağrısı içermez.
 * [HOW]: UIComponents objesi, tüm UI fonksiyonlarını namespace altında toplar.
 *        window.AppModules.UI'ya atanır. Legacy onclick bridge'leri
 *        window.fonksiyonAdi = ... şeklinde korunur.
 *
 * DEPENDENCIES (Tüketilen, dokunulmayan servisler):
 *   - window.data          → firebase-handler.js'den gelen global state
 *   - window.saveData()    → inventory-logic.js aracılığıyla
 *   - window.renderTable() → table-engine.js aracılığıyla
 *   - window.checkIsAdmin()→ auth-engine.js aracılığıyla
 *   - window.showAppAlert()→ alert.js
 *   - window.showCustomConfirm() → script.js (confirm helper)
 *   - INV_CONFIG           → script.js içinde tanımlı global config
 */

// [STATUS]: ui-components.js yüklendi. AppModules.UI namespace'i başlatılıyor.

// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL STATE — Satır Seçimi
// [WHY]: Set veri yapısı tekrar eklemeyi engeller ve O(1) okuma/silme sağlar.
//        window üzerinde tanımlanır çünkü table-engine.js ve script.js da bu
//        state'i okuyabilmeli (Shared Mutable State, kasıtlı).
// [HOW]: Modül ilk yüklendiğinde window._selectedRows güvenle başlatılır;
//        eğer başka bir script önce tanımladıysa üzerine yazılmaz.
// ─────────────────────────────────────────────────────────────────────────────
if (!window._selectedRows) {
    window._selectedRows = new Set();
}

// ─────────────────────────────────────────────────────────────────────────────
// DOM REFERANS YARDIMCILARI (Lazy Getters)
// [WHY]: Fonksiyon içinde document.getElementById çağrısı erken DOM
//        erişimini önler. DOM hazır olduktan sonra çağrılır.
// ─────────────────────────────────────────────────────────────────────────────
const _dom = {
    fab:       () => document.getElementById('floatingActionBar'),
    fabCount:  () => document.getElementById('fabSelectionCount'),
    fabBtns:   () => document.getElementById('fabButtons'),
    bsSheet:   () => document.getElementById('mobileBottomSheet'),
    bsOverlay: () => document.getElementById('mobileBottomSheetOverlay'),
    bsBtns:    () => document.getElementById('bsButtons'),
    bsName:    () => document.getElementById('bsProductName'),
};

// ─────────────────────────────────────────────────────────────────────────────
// UIComponents Nesnesi
// ─────────────────────────────────────────────────────────────────────────────
// [WHY]: KJ-6 — tablo/kart seçiminden açılan ürün işlemleri kayıt verisini JS'e gömmez.
// [HOW]: bindActions dataset okur; eski çağrı sırası ve menü/seçim kapatma davranışı korunur.
function _bindProductActions(container, mobile = false) {
    const finish = action => {
        if (mobile) window.closeMobileBottomSheet();
        else if (['editProduct', 'cloneProduct', 'transferProduct', 'deleteItem'].includes(action)) window.clearRowSelection();
    };
    const run = (action, fn) => el => { fn(el.dataset); finish(action); };
    window.bindActions(container, {
        increaseStock: run('increaseStock', d => window.updateStock(d.depo, d.id, 1)),
        decreaseStock: run('decreaseStock', d => window.updateStock(d.depo, d.id, -1)),
        editProduct: run('editProduct', d => window.openProductModal('edit', d.id, d.depo)),
        cloneProduct: run('cloneProduct', d => window.cloneProduct(d.depo, d.id)),
        transferProduct: run('transferProduct', d => window.openTransferModal(d.depo, d.id)),
        toggleWatch: run('toggleWatch', d => window.toggleWatch(d.depo, d.id)),
        deleteItem: run('deleteItem', d => window.deleteItem(d.depo, d.id)),
        bulkDelete: el => window._bulkDeleteSelected(el.dataset.depo, JSON.parse(el.dataset.ids)),
        bulkTransfer: () => window.showAppAlert('Toplu Sevk özelliği yakında!', 'info'),
    });
}

function _productShelfOptions(depot, configuredShelves, shelfDocs, currentShelf, normShelfCode) {
    const options = [];
    const seen = new Set();
    const add = value => {
        if (typeof value !== 'string' || !value.trim()) return;
        const code = value.trim();
        const key = typeof normShelfCode === 'function' ? normShelfCode(code) : code.toLocaleUpperCase('tr-TR');
        if (!key || seen.has(key)) return;
        seen.add(key);
        options.push(code);
    };
    (configuredShelves || []).forEach(add);
    (Array.isArray(shelfDocs) ? shelfDocs : [])
        .filter(shelf => shelf && shelf.depot === depot)
        .forEach(shelf => add(shelf.code));
    add(currentShelf);
    return options;
}

// v3.6: sayımdaki raflar listede görünür ama seçilemez ("(Sayımda)"); kaydın ŞU ANKİ rafı seçili kalabilsin diye kapatılmaz.
function _shelfOptionsHtml(depot, options, currentShelf) {
    const S = window.Schema;
    const norm = v => (S && typeof S.normShelfCode === 'function' ? S.normShelfCode(v) : String(v || '').trim().toLocaleUpperCase('tr-TR'));
    const locked = new Set(((window.data && window.data.shelves) || [])
        .filter(s => s && s.depot === depot && S && typeof S.isShelfCountLocked === 'function' && S.isShelfCountLocked(s))
        .map(s => s.code));
    const current = norm(currentShelf);
    return options.map(s => {
        const isLocked = locked.has(norm(s));
        const disabled = isLocked && norm(s) !== current;
        return `<option value="${escapeHtml(s)}"${disabled ? ' disabled' : ''}>${escapeHtml(s)}${isLocked ? ' (Sayımda)' : ''}</option>`;
    }).join('');
}

export const UIComponents = {

    // =========================================================================
    // MODAL: selectProduct
    // [WHY]: Çıkış modalındaki ürün arama sonucundan bir ürün seçilince
    //        seçili ürün bilgilerini #selectedProduct div'ine yazar.
    // [HOW]: window.data[repo][index] üzerinden demirbaş durumunu okur,
    //        UI'daki checkbox ile senkronize eder.
    // =========================================================================
    // [WHY]/[HOW] (DATA-06): Seçim artık ürün id'sini taşır; çıkış, gönderim anında indeksle değil id ile çözer.
    //        Eski çağrılar (id verilmeden, 6. argüman indeks) için ürün seçim anında indeksle bulunup id'si saklanır.
    selectProduct(name, type, shelf, qty, repo, index, id = null) {
        const div = document.getElementById('selectedProduct');
        if (!div) return;

        const repoItems = (window.data && window.data[repo]) || [];
        const item = id != null && id !== ''
            ? repoItems.find(x => x && String(x.id) === String(id)) || null
            : (repoItems[index] || null);

        // v3.4: personel demirbaşı ya da türü katalogda birebir bulunmayan ürünü seçemez (ExitPolicy · kurallarla aynı ölçüt)
        if (item && !(typeof window.isDbAdmin === 'function' && window.isDbAdmin()) && window.ExitPolicy) {
            const ok = window.ExitPolicy.eligibility(item, window.data.productTypes);
            if (!ok.ok) { if (typeof showAppAlert === 'function') showAppAlert(ok.message, 'warning'); return; }
        }

        div.dataset.name  = name;
        div.dataset.type  = type;
        div.dataset.shelf = shelf;
        div.dataset.qty   = qty;
        div.dataset.repo  = repo;
        div.dataset.id    = item ? item.id : '';
        delete div.dataset.index;

        // Demirbaş kontrolü tek kuraldan (Schema.isDemirbas · 3.6); demirbaşta kimlik satırları açılır (3.9a).
        const isDemirbas = item ? window.Schema.isDemirbas(item) : false;
        div.dataset.isDemirbas = isDemirbas;

        const checkEl = document.getElementById('isDemirbas');
        if (checkEl) checkEl.checked = isDemirbas;

        div.textContent = '';
        div.insertAdjacentHTML('beforeend', `<strong>Seçilen:</strong> ${escapeHtml(name)} (Stok: ${escapeHtml(qty)})`);
        div.classList.remove('hidden');

        // [WHY]: Raf No alanı salt okunur ama seçimde hiç doldurulmuyordu; personel rafı elle de giremiyordu.
        // [HOW]: Seçilen ürünün rafı yazılır, adet stokla sınırlanır, arama sonuçları kapatılır.
        const shelfEl = document.getElementById('exitShelfNo');
        if (shelfEl) shelfEl.value = shelf || '-';
        const qtyEl = document.getElementById('exitQty');
        if (qtyEl && Number(qty) > 0) qtyEl.max = String(qty);
        const list = document.getElementById('productList');
        if (list) list.innerHTML = '';
        if (window.DeviceIds) window.DeviceIds.syncExitForm();
    },

    // =========================================================================
    // MODAL: handleTypeChange
    // [WHY]: Ürün Ekle/Düzenle modalındaki Tür dropdown'ı değiştiğinde
    //        "Demirbaş" checkbox'ını otomatik olarak günceller.
    // [HOW]: Seçili option'ın data-is-demirbas özelliğini okur.
    // =========================================================================
    handleTypeChange(selectElement) {
        if (!selectElement || selectElement.selectedIndex <= 0) return;

        const selectedOption = selectElement.options[selectElement.selectedIndex];
        if (!selectedOption) return;

        const isDemirbasAttr = selectedOption.getAttribute('data-is-demirbas');
        const isDemirbas     = isDemirbasAttr === 'true';

        const checkbox = document.getElementById('isDemirbas');
        if (checkbox) checkbox.checked = isDemirbas;
    },

    // =========================================================================
    // MODAL: openProductModal
    // [WHY]: Ürün Ekle / Düzenle modalını açar. Yetki kontrolü, dropdown
    //        doldurma ve form pre-populate işlemlerini yönetir.
    // [HOW]: mode='add' → formu sıfırlar. mode='edit' → window.data'dan
    //        item'ı bulur, form alanlarını doldurur.
    // =========================================================================
    // Düzenleme: indexOrId artık her zaman ürün id'sidir (DATA-06). useId parametresi geriye uyumluluk için duruyor.
    openProductModal(mode, indexOrId = null, depoParam = null, useId = true) {
        if (!window.checkIsAdmin()) {
            if (typeof showAppAlert === 'function') showAppAlert('Bu işlem için yönetici yetkisi gereklidir!', 'error');
            return;
        }

        const modal = document.getElementById('productModal');
        if (!modal) return;

        const activeTab = depoParam ||
            document.querySelector('.tab-content.active')?.id ||
            'b1';

        const rawData = window.data[activeTab];
        let item;

        if (mode === 'edit' || mode === 'clone') {
            item = (rawData || []).find(x => x && String(x.id) === String(indexOrId));
            if (!item) {
                if (typeof showAppAlert === 'function') showAppAlert('Ürün bulunamadı; liste güncellenmiş olabilir.', 'error');
                return;
            }
        }

        // Konum dropdown'larını doldur
        const colSelect   = document.getElementById('prodColumn');
        const shelfSelect = document.getElementById('prodShelf');
        const typeSelect  = document.getElementById('prodType');
        const allTypes    = typeof window.getActiveProductTypes === 'function'
            ? window.getActiveProductTypes()
            : [];
        const locConfig   = (typeof INV_CONFIG !== 'undefined' && INV_CONFIG.locations)
            ? INV_CONFIG.locations[activeTab]
            : null;

        if (colSelect && locConfig) {
            colSelect.innerHTML = locConfig.columns
                .map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
        }
        const selectedShelf = item && (item.raf || item.shelf || item.rafNo) || '';
        const shelfOptions = _productShelfOptions(
            activeTab,
            locConfig && locConfig.shelves,
            window.data && window.data.shelves,
            selectedShelf,
            window.Schema && window.Schema.normShelfCode
        );
        if (shelfSelect) {
            shelfSelect.innerHTML = _shelfOptionsHtml(activeTab, shelfOptions, selectedShelf);
        }
        if (typeSelect) {
            // Faz 4 · J2: ürün türü adı kayıt verisi (productTypes) — option değerinde ve metninde kaçırılır.
            typeSelect.innerHTML = '<option value="">Tür Seçiniz...</option>';
            allTypes.forEach(t => {
                const isDemirbas = t.isDemirbas === true || t.isDemirbas === 'true';
                const label      = isDemirbas ? 'Demirbaş' : 'Sarf';
                typeSelect.innerHTML += `
                    <option value="${escapeHtml(t.name)}" data-is-demirbas="${isDemirbas}">
                        ${escapeHtml(t.name)} (${label})
                    </option>`;
            });
        }

        const title = document.getElementById('modalTitle');
        const form  = document.getElementById('productForm');

        if ((mode === 'edit' || mode === 'clone') && item) {
            if (title) title.innerText = mode === 'clone'
                ? `📋 Ürün Kopyala: ${item.ürün || item.name || ''}`
                : 'Ürün Düzenle';
            window.cachedEditingTypeName = item.tür || item.type || '';

            const setVal = (id, val) => {
                const el = document.getElementById(id);
                if (el) el.value = val ?? '';
            };

            setVal('prodColumn', item.sütun);
            const shelfKey = shelf => window.Schema && typeof window.Schema.normShelfCode === 'function'
                ? window.Schema.normShelfCode(shelf)
                : String(shelf ?? '').trim().toLocaleUpperCase('tr-TR');
            const matchedShelf = shelfOptions.find(shelf => shelfKey(shelf) === shelfKey(selectedShelf)) || selectedShelf;
            setVal('prodShelf', matchedShelf);
            setVal('prodName',   item.ürün || item.name);
            setVal('prodBrand',  item.marka);
            setVal('prodInventoryNo', mode === 'clone' ? '' : item.envanterNo);
            setVal('prodQty',    item.adet ?? item.qty ?? 0);
            // [WHY]: 'Pasif', 'Tükendi', B2 'Aktif' gibi değerler listede yok; select "" okuyup kayıtta durumu siliyordu (DATA-04).
            const statusSel = document.getElementById('prodStatus');
            const currentStatus = item.durumu || item.status || 'Kullanıma Hazır';
            if (statusSel) {
                statusSel.querySelectorAll('option[data-temp]').forEach(o => o.remove());
                if (![...statusSel.options].some(o => o.value === currentStatus)) {
                    const opt = new Option(currentStatus, currentStatus);
                    opt.dataset.temp = 'true';
                    statusSel.add(opt);
                }
            }
            setVal('prodStatus', currentStatus);
            setVal('prodDesc',   item.açıklama);

            if (typeSelect) {
                const selectedType = (item.tür || item.type || item.prodType || '').trim();
                const normalizeType = value => window.Schema && typeof window.Schema.normName === 'function'
                    ? window.Schema.normName(value)
                    : String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('tr-TR');
                const selectedTypeKey = normalizeType(selectedType);
                let found = false;
                [...typeSelect.options].forEach(opt => {
                    if (normalizeType(opt.value) === selectedTypeKey) {
                        opt.selected = true;
                        found = true;
                    }
                });
                // Dropdown'da olmayan eski tür için geçici option ekle
                if (!found && selectedType) {
                    const tempOption       = document.createElement('option');
                    tempOption.value       = selectedType;
                    tempOption.textContent = selectedType + ' (Eski Tür)';
                    tempOption.selected    = true;
                    tempOption.style.color = '#e67e22';
                    tempOption.dataset.legacy = 'true';
                    typeSelect.appendChild(tempOption);
                }
                setTimeout(() => window.handleTypeChange?.(typeSelect), 0);
            }

            const checkbox = document.getElementById('isDemirbas');
            if (checkbox) {
                checkbox.checked = item.isDemirbas === true || item.isDemirbas === 'true';
            }

            delete form.dataset.editIndex;
            form.dataset.editRepo  = activeTab;
            if (mode === 'clone') {
                // [WHY]: Kopyalama, orijinal kaydın id'sine KESİNLİKLE bağlanmaz — Kaydet makeId() ile yepyeni bir ürün oluşturmalı.
                delete form.dataset.editId;
                form.dataset.isCloning = 'true';
            } else {
                form.dataset.editId = item.id ?? '';
                delete form.dataset.isCloning;
            }

        } else {
            if (title) title.innerText = 'Yeni Ürün Ekle';
            if (form)  form.reset();
            if (form)  { delete form.dataset.editIndex; delete form.dataset.editRepo; delete form.dataset.editId; delete form.dataset.isCloning; }
        }

        modal.style.display = 'block';
    },

    // =========================================================================
    // MODAL: cloneProduct
    // [WHY]: B1/B2'de aynı özelliklere sahip yeni bir ürün girerken tüm alanları
    //        elle yeniden yazmak operasyonel hız kaybı yaratıyordu.
    // [HOW]: openProductModal'ı 'clone' modunda açar — form orijinal ürünün
    //        alanlarıyla doldurulur ama editId BAĞLANMAZ; Kaydet'te saveProduct
    //        isEdit=false yolunu izler ve makeId() ile yepyeni bir kayıt açar.
    // =========================================================================
    cloneProduct(depo, id) {
        UIComponents.openProductModal('clone', id, depo);
    },

    // =========================================================================
    // MODAL: openTransferModal
    // [WHY]: Ürün Sevk/Transfer modalını açar. Hedef depoları listeler.
    // [HOW]: INV_CONFIG.transferTargets üzerinden hedef seçeneklerini oluşturur,
    //        gizli form alanlarını kaynakla doldurur.
    // =========================================================================
    openTransferModal(repoName, id) {
        if (typeof checkIsAdmin === 'function' && !checkIsAdmin()) {
            if (typeof showAppAlert === 'function') showAppAlert('Ürün Sevk/Transfer yetkisi sadece Admin\'lere tanımlanmıştır!', 'error');
            return;
        }

        const item         = (window.data[repoName] || []).find(x => x && String(x.id) === String(id));
        const modal        = document.getElementById('transferModal');
        const targetSelect = document.getElementById('transTarget');
        if (!modal || !targetSelect) return;
        if (!item) { if (typeof showAppAlert === 'function') showAppAlert('Ürün bulunamadı; liste güncellenmiş olabilir.', 'error'); return; }

        // Hedef listesini doldur (kendi deposunu hariç tut)
        targetSelect.innerHTML = '<option value="">Hedef Seçiniz...</option>';
        if (typeof INV_CONFIG !== 'undefined' && INV_CONFIG.transferTargets) {
            INV_CONFIG.transferTargets.forEach(t => {
                if (t.key === repoName) return;
                const option       = document.createElement('option');
                option.value       = JSON.stringify(t);
                option.textContent = t.name;
                targetSelect.appendChild(option);
            });
        }

        // Ürün bilgilerini modalda göster
        const nameEl  = document.getElementById('transProdName');
        const locEl   = document.getElementById('transCurrentLoc');
        const idxEl   = document.getElementById('transIndex');
        const srcEl   = document.getElementById('transSourceRepo');
        const noteEl  = document.getElementById('transNote');
        const intelEl = document.getElementById('internalTransferOptions');

        if (nameEl)  nameEl.innerText     = item.ürün || item.name;
        if (locEl)   locEl.innerText      = `${repoName.toUpperCase()} / ${item.raf || item.shelf}`;
        if (idxEl)   idxEl.value          = item.id; // #transIndex artık ürün id'sini taşır
        if (srcEl)   srcEl.value          = repoName;
        // v3.3 Aşama 2 (P1-01): her açılış yeni bir transfer niyetidir → yeni işlem kimliği confirmTransfer'da üretilir;
        //                      aynı pencereden yeniden gönderim (ör. yanıtı kaybolan istek) AYNI kimliği kullanır.
        UIComponents._transferOpId = null;
        if (noteEl)  noteEl.value         = '';
        if (intelEl) intelEl.style.display = 'none';

        // 3.9: sevk adedi (demirbaşta varsayılan 1, sarfta tüm stok — eskiden satırın tamamı giderdi) ve önceki servis kayıtları
        const dispatchEl = document.getElementById('transDispatchOptions');
        const qtyEl = document.getElementById('transQty');
        const stockQty = parseInt(item.adet ?? item.qty ?? 0, 10) || 0;
        if (dispatchEl) dispatchEl.style.display = 'none';
        if (qtyEl) { qtyEl.max = String(Math.max(stockQty, 1)); qtyEl.value = window.Schema.isDemirbas(item) ? '1' : String(Math.max(stockQty, 1)); }
        if (window.DeviceIds) {
            window.DeviceIds.hide(document.getElementById('transDeviceIds'));
            window.DeviceIds.renderServiceHint(document.getElementById('transServiceHistory'), { productId: item.id });
        }

        modal.style.display = 'block';
    },

    // =========================================================================
    // MODAL: handleTransferTargetChange
    // [WHY]: Transfer hedef dropdown'ı değiştiğinde iç transfer seçeneklerini
    //        (raf/sütun) gösterir veya gizler.
    // [HOW]: Seçilen option'ın value'su JSON parse edilerek type kontrolü yapılır.
    // =========================================================================
    handleTransferTargetChange(selectParams) {
        const targetData  = JSON.parse(selectParams.value || '{}');
        const internalDiv = document.getElementById('internalTransferOptions');
        if (!internalDiv) return;

        if (targetData.type === 'internal') {
            internalDiv.style.display = 'block';
            const locs     = (typeof INV_CONFIG !== 'undefined') ? INV_CONFIG.locations[targetData.key] : null;
            const colSel   = document.getElementById('transNewCol');
            const shelfSel = document.getElementById('transNewShelf');
            if (locs && colSel)   colSel.innerHTML   = locs.columns.map(c => `<option>${escapeHtml(c)}</option>`).join('');
            // v3.6: hedef raf listesi katalogdaki raflarla birleşir; sayımdaki raflar seçilemez.
            if (locs && shelfSel) {
                const options = _productShelfOptions(targetData.key, locs.shelves, window.data && window.data.shelves, '', window.Schema && window.Schema.normShelfCode);
                shelfSel.innerHTML = _shelfOptionsHtml(targetData.key, options, '');
            }
        } else {
            internalDiv.style.display = 'none';
        }
        // Faz 5 · K2 (5.8/5.10 · INV-06): adet alanı artık internal (B1↔B2) ve scrap (Hurda/Atık) hedeflerinde de
        // gösterilir — internal'de kısmi adet taşıma, scrap'te kaç adedin hurdaya ayrılacağı için.
        const dispatchEl = document.getElementById('transDispatchOptions');
        if (dispatchEl) dispatchEl.style.display = ['external', 'service', 'internal', 'scrap'].includes(targetData.type) ? 'block' : 'none';
        this.syncTransferDevices();
    },

    // Servis/dış sevk/hurdada demirbaş: adet kadar cihaz kimliği; girilen kimliklerin önceki servis kayıtları listelenir
    // (3.9a/c). İç transfer (B1↔B2) kasıtlı olarak kimlik istemez — sahibinin kararı (Faz 5 Orkestrasyon §5.8): B1/B2
    // taşıma bir konum değişikliğidir, cihaz kimliği zaten B3/servis kayıtlarında tutulur.
    syncTransferDevices() {
        const box = document.getElementById('transDeviceIds');
        const hint = document.getElementById('transServiceHistory');
        const item = (window.data[document.getElementById('transSourceRepo')?.value] || [])
            .find(x => x && String(x.id) === String(document.getElementById('transIndex')?.value));
        let target = {};
        try { target = JSON.parse(document.getElementById('transTarget')?.value || '{}'); } catch (e) { target = {}; }
        const dispatch = target.type === 'external' || target.type === 'service' || target.type === 'scrap';
        if (!box || !window.DeviceIds) return;
        if (item && dispatch && window.Schema.isDemirbas(item)) {
            window.DeviceIds.render(box, Number(document.getElementById('transQty')?.value) || 1, {
                // Faz 3.5: her tuşta değil, yazma durunca (200 ms) — uzun kimlik listelerinde tarama tuş başına tekrarlanmaz
                onInput: ids => {
                    clearTimeout(this._serviceHintTimer);
                    this._serviceHintTimer = setTimeout(() => window.DeviceIds.renderServiceHint(hint, { productId: item.id, ids }), 200);
                },
            });
        } else {
            window.DeviceIds.hide(box);
        }
        if (item) window.DeviceIds.renderServiceHint(hint, { productId: item.id, ids: window.DeviceIds.read(box) });
    },

    // =========================================================================
    // MODAL: confirmTransfer
    // [WHY]: Transfer formundan gelen verileri işler. İç transfer veya
    //        dış/servis sevkini yönetir.
    // [HOW]: window.data üzerinde splice/push yapar (read+write),
    //        ardından window.saveData() ile Firebase'e yazar.
    //        Bu, view-layer değil data mutation; ancak script.js'den taşındı
    //        ve inventory-logic.js'e bağlıdır (window.saveData bridge).
    // =========================================================================
    // [WHY]: Sevk, ürünü dizi indeksiyle buluyor (DATA-06), hedefe ekleme + kaynaktan silmeyi bellekte yapıp tüm
    //        veritabanını yazıyordu (DATA-01) ve başarı mesajını yazmadan önce gösteriyordu; yazma yarım kalırsa ürün
    //        ya iki yerde ya da hiçbir yerde kalabilirdi.
    // [HOW]: Ürün id ile çözülür; iç transfer runStockTransferTransaction (v3.3 P1-01/P1-02: taze stok, raf kapasitesi,
    //        operationId), sevk/hurda runStockOps transaction'ı. Mesaj yalnız sunucu commit'inden sonra.
    async confirmTransfer() {
        const sourceRepo = document.getElementById('transSourceRepo')?.value;
        const productId  = document.getElementById('transIndex')?.value;
        let   targetData;

        try {
            targetData = JSON.parse(document.getElementById('transTarget')?.value);
        } catch (e) {
            if (typeof showAppAlert === 'function') showAppAlert('Hedef seçiniz!', 'error');
            return;
        }

        const transNoteInput = document.getElementById('transNote');
        const sevkNotu       = transNoteInput ? transNoteInput.value.trim() : '';
        const originalItem   = (window.data[sourceRepo] || []).find(x => x && String(x.id) === String(productId));

        if (!originalItem) {
            if (typeof showAppAlert === 'function') showAppAlert('Ürün bulunamadı; liste güncellenmiş olabilir.', 'error');
            return;
        }

        if (targetData.type === 'internal') {
            // [WHY] (Faz 5 · K2 · 5.8 · INV-06): Kalemin TAMAMI taşınmak zorundaydı (37 adetlik satırdan 1 tanesi B2'ye
            //        gidecekse bile 37'si gidiyordu); id de aynen kopyalandığı için her alan (ör. stokOncekiDurum gibi
            //        eski/ geçici alanlar) hedefe sessizce taşınıyor, B2'nin ayrıca tuttuğu 'status' alanı kaynakta
            //        yoksa hedefte de oluşmuyordu (B1/B2 şema sözleşmesini ihlal ederdi).
            // [HOW]: Seçilen adet < mevcut stok ise kaynaktan yalnız o kadarı düşülür (update), hedefte YENİ id'li bir
            //        kayıt açılır (adet = seçilen). Adet tüm stoksa eski davranış korunur (kaynak silinir, aynı id
            //        hedefte yaşar). Hedef kaydı her zaman sıfırdan, yalnız kanonik alanlarla kurulur (durumu/status
            //        tutarlı, B1_KEYS/B2_KEYS guard'ından geçer) — demirbaş kimlik istenmez (konum değişikliği, §5.8).
            const qty = Number(document.getElementById('transQty')?.value);
            const stockQty = parseInt(originalItem.adet ?? originalItem.qty ?? 0, 10) || 0;
            if (!Number.isInteger(qty) || qty < 1) { showAppAlert('Taşınacak adet en az 1 olan tam sayı olmalıdır.', 'warning'); return; }
            if (qty > stockQty) { showAppAlert(`Stokta ${stockQty} adet var; ${qty} adet taşınamaz.`, 'warning'); return; }
            const targetShelf = document.getElementById('transNewShelf')?.value || '';
            if (!targetShelf) { showAppAlert('Hedef raf seçiniz.', 'warning'); return; }
            // [WHY] (v3.3 · P1-01/P1-02): Kaynak adedi window.data'dan hesaplanıp kör batch'le yazılıyordu; kapasite yalnız bu
            //        tarayıcının localStorage ayarıyla istemcide denetleniyordu; yanıtı kaybolan istek tekrar gönderilince
            //        stok ikinci kez düşebiliyordu.
            // [HOW]: Tek transaction (runStockTransferTransaction): kaynak stok ve raf belgeleri sunucudan taze okunur, hedef raf
            //        dolu/pasif/katalog dışıysa hiçbir şey yazılmaz. Yukarıdaki adet denetimi yalnız kullanıcı kolaylığıdır;
            //        son karar transaction'da. İşlem kimliği bu pencere açıkken sabittir (tekrar gönderim = aynı işlem).
            if (typeof window.runStockTransferTransaction !== 'function' || !window.StockLedger) {
                showAppAlert('Stok defteri servisi yüklenemedi; transfer güvenle sürdürülemedi.', 'error');
                return;
            }
            if (UIComponents._transferBusy) return;   // çift tıklama / Enter: istek sürerken ikinci gönderim yok
            UIComponents._transferOpId = UIComponents._transferOpId || window.StockLedger.newOperationId();
            UIComponents._transferBusy = true;
            let res;
            try {
                res = await window.runStockTransferTransaction({
                    operationId:  UIComponents._transferOpId,
                    sourceCol:    sourceRepo,
                    sourceId:     originalItem.id,
                    targetCol:    targetData.key,
                    qty,
                    targetShelf,
                    targetColumn: document.getElementById('transNewCol')?.value || '',
                    note:         sevkNotu,
                });
            } catch (e) {
                if (typeof showAppAlert === 'function') showAppAlert(`Transfer kaydedilemedi; ürün yerinde bırakıldı. ${e.message || ''}`, 'error');
                return;
            } finally {
                UIComponents._transferBusy = false;
            }
            UIComponents._transferOpId = null;
            if (typeof showAppAlert === 'function') {
                const text = res.duplicate
                    ? 'Bu transfer daha önce tamamlanmıştı; stok ikinci kez değiştirilmedi.'
                    : (res.fullMove
                        ? `Ürün ${targetData.name} birimine taşındı (${res.qty} adet).`
                        : `${res.qty} adet ${targetData.name} birimine taşındı; ${res.stockAfter} adet kaynakta bırakıldı.`);
                showAppAlert(text, res.duplicate ? 'info' : 'success');
            }
            UIComponents.closeTransferModal();
            if (typeof window.renderTable === 'function') {
                window.renderTable(sourceRepo);
                if (targetData.key !== sourceRepo) window.renderTable(targetData.key);
            }
            return;
        } else if (targetData.type === 'external' || targetData.type === 'service') {
            // [WHY] (3.9): Sevk satırın TAMAMINI depodan siliyordu (37 adetlik satırdan 1 cihaz sevk edilince 37'si gidiyordu),
            //        seri no sorulmuyordu ve servis kaydı dönüşte silindiği için cihazın servis geçmişi kalmıyordu.
            // [HOW]: Yalnız seçilen adet düşülür; demirbaşta adet kadar kimlik zorunlu ve cihaz başına bir servis kaydı (adet 1).
            //        Stok düşümü + servis kayıtları TEK transaction (runStockOps). Kayıt tarihli durum geçmişi (gecmis) taşır.
            const qty = Number(document.getElementById('transQty')?.value);
            const stockQty = parseInt(originalItem.adet ?? originalItem.qty ?? 0, 10) || 0;
            if (!Number.isInteger(qty) || qty < 1) { showAppAlert('Sevk adedi en az 1 olan tam sayı olmalıdır.', 'warning'); return; }
            if (qty > stockQty) { showAppAlert(`Stokta ${stockQty} adet var; ${qty} adet sevk edilemez.`, 'warning'); return; }
            const demirbas = window.Schema.isDemirbas(originalItem);
            const chk = window.AssignmentService.checkDeviceIds({ demirbas, qty, ids: window.DeviceIds.read(document.getElementById('transDeviceIds')) });
            if (!chk.ok) { showAppAlert(chk.errors[0], 'warning'); return; }
            const now = typeof getTurkiyeSaati === 'function' ? getTurkiyeSaati() : new Date().toLocaleString('tr-TR');
            const yapan = window.currentUser?.name || window.getActiveUser?.()?.name || 'Admin';
            const units = demirbas ? chk.ids.map(d => ({ adet: 1, sn: d.sn, envanterNo: d.envanterNo })) : [{ adet: qty, sn: '-', envanterNo: '-' }];
            const writes = units.map(u => ({ op: 'set', col: 'serviceRecords', item: {
                id: window.makeId(),
                originalData:  { ...originalItem, adet: u.adet },
                productId:     originalItem.id,
                urunAciklama:  originalItem.ürün || originalItem.name,
                marka:         originalItem.marka || '',
                sn:            u.sn,
                envanterNo:    u.envanterNo,
                adet:          u.adet,
                kaynakDepo:    sourceRepo,
                hedef:         targetData.name,
                hedefTip:      targetData.type,
                sevkTarihi:    now,
                durum:         'Serviste / Yolda',
                not:           sevkNotu,
                isDemirbas:    demirbas,
                kapandi:       false,
                gecmis:        [{ ts: Date.now(), tarih: now, durum: 'Serviste / Yolda', not: sevkNotu, yapan }],
            } }));
            try {
                await window.runStockOps({ stock: [{ col: sourceRepo, id: originalItem.id, delta: -qty }], writes },
                    { forbiddenMessage: 'Sevk işlemi yalnızca sistem yöneticisi tarafından yapılabilir.' });
            } catch (e) {
                if (typeof showAppAlert === 'function') showAppAlert(`Sevk kaydedilemedi; ürün yerinde bırakıldı. ${e.message || ''}`, 'error');
                return;
            }
            if (typeof showAppAlert === 'function') showAppAlert(`${qty} adet ${targetData.name} birimine sevk edildi (${units.length} servis kaydı). Servis paneline işlendi.`, 'info');
            UIComponents.closeTransferModal();
            if (typeof window.renderTable === 'function') window.renderTable(sourceRepo);
            if (typeof window.renderPurchaseModule === 'function') window.renderPurchaseModule();
            return;
        } else if (targetData.type === 'scrap') {
            // [WHY] (Faz 5 · K2 · 5.10): "Hurda / Atık" hedefi sevk listesinde duruyordu ama hiç uygulanmamıştı — seçilince
            //        her zaman "Geçersiz hedef." hatası verip hiçbir şey yazmıyordu (H4'te tespit, Faz 5'e ertelendi).
            // [HOW]: external/service ile aynı desen: yalnız seçilen adet düşülür, demirbaşta adet kadar kimlik zorunlu ve
            //        cihaz başına kanonik b3 hurda kaydı (tip:'hurda'); varsa bu ürün/cihaza ait AÇIK servis kaydı da aynı
            //        transaction'da kapatılır. Stok düşümü + b3 kayıtları + servis kapatma TEK transaction (runStockOps):
            //        ya hepsi ya hiçbiri — stoktan düşüp kaydı yazamama riski yok.
            const qty = Number(document.getElementById('transQty')?.value);
            const stockQty = parseInt(originalItem.adet ?? originalItem.qty ?? 0, 10) || 0;
            if (!Number.isInteger(qty) || qty < 1) { showAppAlert('Hurdaya ayrılacak adet en az 1 olan tam sayı olmalıdır.', 'warning'); return; }
            if (qty > stockQty) { showAppAlert(`Stokta ${stockQty} adet var; ${qty} adet hurdaya ayrılamaz.`, 'warning'); return; }
            const demirbas = window.Schema.isDemirbas(originalItem);
            const chk = window.AssignmentService.checkDeviceIds({ demirbas, qty, ids: window.DeviceIds.read(document.getElementById('transDeviceIds')) });
            if (!chk.ok) { showAppAlert(chk.errors[0], 'warning'); return; }
            const confirmed = typeof showCustomConfirm === 'function'
                ? await showCustomConfirm('Hurdaya Ayır', `${qty} adet "${originalItem.ürün || originalItem.name}" kalıcı olarak hurdaya ayrılacak. Bu işlem geri alınamaz. Onaylıyor musunuz?`)
                : window.confirm('Hurdaya ayırma işlemi geri alınamaz. Emin misiniz?');
            if (!confirmed) return;
            const now = typeof getTurkiyeSaati === 'function' ? getTurkiyeSaati() : new Date().toLocaleString('tr-TR');
            const yapan = window.currentUser?.name || window.getActiveUser?.()?.name || 'Admin';
            const units = demirbas ? chk.ids.map(d => ({ adet: 1, sn: d.sn, envanterNo: d.envanterNo })) : [{ adet: qty, sn: '-', envanterNo: '-' }];
            const b3Writes = units.map(u => ({ op: 'set', col: 'b3', item: window.Schema.buildB3Entry({
                tip: 'hurda', product: originalItem, col: sourceRepo, adet: u.adet, sn: u.sn, envanterNo: u.envanterNo,
                not: sevkNotu, alanKisi: yapan, tarih: now, isDemirbas: demirbas,
            }) }));
            // Bu ürüne/cihaza ait açık (kapandi:false) servis kaydı varsa, hurdaya ayırmayla birlikte aynı transaction'da kapat.
            const openServiceWrites = (window.data.serviceRecords || [])
                .filter(r => r && r.kapandi !== true && String(r.productId) === String(originalItem.id)
                    && (!demirbas || units.some(u => (u.sn !== '-' && u.sn === r.sn) || (u.envanterNo !== '-' && u.envanterNo === r.envanterNo))))
                .map(r => ({ op: 'update', col: 'serviceRecords', id: r.id, fields: {
                    kapandi: true, durum: 'Hurdaya Ayrıldı', donusTarihi: now,
                    gecmis: [...(Array.isArray(r.gecmis) ? r.gecmis : []), { ts: Date.now(), tarih: now, durum: 'Hurdaya Ayrıldı', not: sevkNotu, yapan }],
                } }));
            try {
                await window.runStockOps({ stock: [{ col: sourceRepo, id: originalItem.id, delta: -qty }], writes: [...b3Writes, ...openServiceWrites] },
                    { forbiddenMessage: 'Hurdaya ayırma işlemi yalnızca sistem yöneticisi tarafından yapılabilir.' });
            } catch (e) {
                if (typeof showAppAlert === 'function') showAppAlert(`Hurdaya ayırma kaydedilemedi; ürün yerinde bırakıldı. ${e.message || ''}`, 'error');
                return;
            }
            if (typeof showAppAlert === 'function') {
                const closedMsg = openServiceWrites.length ? `, ${openServiceWrites.length} açık servis kaydı kapatıldı` : '';
                showAppAlert(`${qty} adet "${originalItem.ürün || originalItem.name}" hurdaya ayrıldı (${units.length} kayıt)${closedMsg}.`, 'info');
            }
            UIComponents.closeTransferModal();
            if (typeof window.renderTable === 'function') window.renderTable(sourceRepo);
            if (typeof window.renderPurchaseModule === 'function') window.renderPurchaseModule();
            return;
        } else {
            if (typeof showAppAlert === 'function') showAppAlert('Geçersiz hedef.', 'error');
            return;
        }
    },

    // =========================================================================
    // MODAL: closeTransferModal
    // =========================================================================
    closeTransferModal() {
        const modal = document.getElementById('transferModal');
        if (modal) modal.style.display = 'none';
    },

    // =========================================================================
    // MODAL: openExitModal
    // [WHY]: Envanter çıkışı (zimmet) modalını açar. Demirbaş koruması içerir.
    // [HOW]: İlgili item'ı window.data'dan okur, admin yetkisi ve demirbaş
    //        durumunu kontrol eder. exitForm.onsubmit'i saveExit'e bağlar.
    // =========================================================================
    // Satırdan açılırsa ikinci argüman ürün id'sidir (DATA-06).
    openExitModal(repoName, productId) {
        // v3.4: yönetici ve personel hesabı (BT ekibi) açabilir; personel yalnız sarf çıkışı yapar (ExitPolicy + firestore.rules).
        if (!(typeof window.canExitStock === 'function' && window.canExitStock())) {
            if (typeof showAppAlert === 'function') showAppAlert(window.EXIT_STAFF_MESSAGE || window.EXIT_ADMIN_ONLY_MESSAGE, 'error');
            return;
        }
        // J3: yetki Firebase admin oturumundan; adminVizesi (sessionStorage) elle yazılarak muhafız atlanabiliyordu.
        const isAdmin = typeof window.isDbAdmin === 'function' && window.isDbAdmin();
        window.currentExitRepo  = repoName || (document.querySelector('.tab-content.active')?.id || 'b1');
        window.currentExitIndex = null;
        const hasRow = productId !== undefined && productId !== null && productId !== '';
        const findRow = () => (window.data[window.currentExitRepo] || []).find(x => x && String(x.id) === String(productId)) || null;

        // Demirbaş Koruması (tek kural: Schema.isDemirbas; personel için ExitPolicy)
        if (hasRow) {
            const item = findRow();
            if (item && !isAdmin) {
                const ok = window.ExitPolicy.eligibility(item, window.data.productTypes);
                if (!ok.ok) { if (typeof showAppAlert === 'function') showAppAlert(ok.message, 'warning'); return; }
            } else if (item && window.Schema.isDemirbas(item) && typeof showAppAlert === 'function') {
                showAppAlert('BİLGİ: Demirbaş ürününden çıkış yapıyorsunuz.', 'info');
            }
        }

        const modal = document.getElementById('exitModal');
        if (!modal) return;

        // [WHY]: Önceki açılıştan kalan seçim, çıkışı yanlış ürüne/depoya yönlendiriyordu (INV-02).
        // [HOW]: Seçim her açılışta sıfırlanır; B1/B2 satırından açıldıysa o ürün ön-seçilir.
        const selectedDiv = document.getElementById('selectedProduct');
        if (selectedDiv) {
            Object.keys(selectedDiv.dataset).forEach(k => delete selectedDiv.dataset[k]);
            selectedDiv.innerHTML = '';
            selectedDiv.classList.add('hidden');
        }
        const shelfEl = document.getElementById('exitShelfNo');
        if (shelfEl) shelfEl.value = '';
        document.getElementById('exitQty')?.removeAttribute('max');
        if (window.DeviceIds) window.DeviceIds.syncExitForm();   // önceki demirbaş seçiminin kimlik satırları temizlenir
        const rowRepo = window.currentExitRepo;
        const rowItem = (rowRepo === 'b1' || rowRepo === 'b2') && hasRow ? findRow() : null;
        if (rowItem) {
            this.selectProduct(rowItem.ürün || rowItem.name, rowItem.tür || rowItem.type || rowItem.marka,
                rowItem.raf || rowItem.shelf, rowItem.adet ?? rowItem.qty ?? 0, rowRepo, null, rowItem.id);
        }

        // Alan kişi: yönetici listeden seçer (varsayılan kendisi), personelde kendisi ve kilitli (v3.4 · person-picker.js)
        if (window.ExitReceiver) window.ExitReceiver.setup('exit', isAdmin);
        const roleNote = document.getElementById('exitRoleNote');
        if (roleNote) roleNote.textContent = isAdmin
            ? 'Seçtiğiniz ürünün stoğu düşer ve çıkış, "Alan Kişi" olarak seçtiğiniz personelin envanterine yazılır.'
            : 'Sarf malzeme çıkışı yapabilirsiniz; stok düşer ve çıkış sizin adınıza kaydedilir. Demirbaş ürünler için "Envanter Talep Et" ile yöneticiye talep gönderin.';

        modal.style.display = 'block';

        // Form submit → saveExit
        const exitForm = document.getElementById('exitForm');
        if (exitForm) {
            exitForm.onsubmit = function (e) {
                if (typeof window.saveExit === 'function') window.saveExit(e);
            };
        }
    },

    // =========================================================================
    // MODAL: closeExitModal
    // [WHY]: inventory-logic.js, closeExitModal'ı window üzerinden çağırır.
    //        Bu bridge fonksiyon o bağlantıyı korur.
    // =========================================================================
    closeExitModal() {
        const modal = document.getElementById('exitModal');
        if (modal) modal.style.display = 'none';
    },

    // =========================================================================
    // MODAL: openRequestModal
    // [WHY]: Envanter talep modalını açar. Yeni talep veya düzenleme modunu yönetir.
    // [HOW]: isEdit=false → formu sıfırlar, ITSM alanlarını varsayılan değerlere çeker.
    //        isEdit=true  → mevcut talep verisini formda göstermek için başlığı değiştirir.
    // =========================================================================
    openRequestModal(isEdit = false) {
        const modal = document.getElementById('requestModal');
        if (!modal) return;

        const title = modal.querySelector('h2');

        if (!isEdit) {
            const form = document.getElementById('requestForm');
            if (form) form.reset();
            window.editingReqIndex = null;
            window.editingReqId = null;
            if (title) title.innerText = 'Envanter Talep Et';

            // ITSM alanlarını sıfırla
            const reqType              = document.getElementById('reqType');
            const reqPriority          = document.getElementById('reqPriority');
            const reqReturnDate        = document.getElementById('reqReturnDate');
            const reqReturnDateContainer = document.getElementById('reqReturnDateContainer');
            if (reqType)              reqType.value = 'Kalıcı Zimmet';
            if (reqPriority)          reqPriority.value = 'Orta';
            if (reqReturnDate)        { reqReturnDate.value = ''; reqReturnDate.removeAttribute('required'); }
            if (reqReturnDateContainer) reqReturnDateContainer.style.display = 'none';
        } else {
            if (title) title.innerText = 'Talebi Düzenle / Revize Et';
        }

        const reqProductList = document.getElementById('reqProductList');
        if (reqProductList) reqProductList.style.display = 'none';

        modal.style.display = 'block';
    },

    // =========================================================================
    // MODAL: closeRequestModal
    // [WHY]: İstek modalını kapatır. HTML içindeki onclick="closeRequestModal()"
    //        bridge aracılığıyla çağrılır.
    // =========================================================================
    closeRequestModal() {
        const modal = document.getElementById('requestModal');
        if (modal) modal.style.display = 'none';
    },

    // =========================================================================
    // MODAL: openModal / closeModal (Generic Wrappers)
    // [WHY]: Proje genelinde dinamik olarak ID bazlı modal açma/kapama için
    //        tek bir noktadan yönetim sağlar.
    // [HOW]: ID alır, display toggle yapar. Bu fonksiyonlar gelecekteki
    //        modallar için de genişletilebilir.
    // =========================================================================
    openModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) modal.style.display = 'block';
    },

    closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) modal.style.display = 'none';
    },

    // =========================================================================
    // FAB: setupRowSelection — EVENT DELEGATION
    // [WHY]: Her render'dan sonra inline onclick bağlamak yerine, üst tbody
    //        üzerinde tek bir click dinleyicisi kuruyoruz → Daha az bellek.
    // [HOW]: tbody._fabListenerAttached flag'i ile çift listener engellenir.
    //        Tıklanan satırın .selected-row class'ı toggle edilir, ardından
    //        updateFloatingBar() ile FAB güncellenir. Mobil'de Bottom Sheet açılır.
    // =========================================================================
    setupRowSelection(tableContainer) {
        const tbody = tableContainer.querySelector('tbody');
        if (!tbody || tbody._fabListenerAttached) return;
        tbody._fabListenerAttached = true;

        tbody.addEventListener('click', function (e) {
            // [WHY]/[HOW]: Tooltip aynı tbody üzerinde delege edilir; bu tıklama satır seçimini değiştirmez.
            if (e.target.closest('[data-action="mobileTooltip"]')) return;
            // Checkbox tıklaması kendi mantığını yönetir
            if (e.target.type === 'checkbox') return;

            const tr = e.target.closest('tr.selectable-row');
            if (!tr) return;

            const { depo, id, name } = tr.dataset;
            const key = `${depo}|${id}`; // DATA-06: seçim anahtarı ürün id'si (indeks snapshot'ta kayar)

            if (tr.classList.contains('selected-row')) {
                // Toggle off
                tr.classList.remove('selected-row');
                window._selectedRows.delete(key);
            } else {
                // Toggle on
                tr.classList.add('selected-row');
                window._selectedRows.add(key);
                tr._fabData = { depo, id, name };
            }

            UIComponents.updateFloatingBar();

            // Mobil: tek satır seçiminde Bottom Sheet aç
            if (window.innerWidth <= 768 && tr.classList.contains('selected-row')) {
                UIComponents.showMobileBottomSheet(tr._fabData || { depo, id, name });
            }
        });
    },

    // =========================================================================
    // FAB: updateFloatingBar — Contextual Intelligence
    // [WHY]: Kaç satır seçildiğine göre farklı buton setleri gösterilir.
    //        >1 seçimde tekil işlemler (Düzenle) gizlenir, toplu işlemler açılır.
    // [HOW]: window._selectedRows.size okunur. UAB bar'a uab-bulk-visible
    //        class'ı eklenerek/kaldırılarak CSS transition ile akıcı geçiş sağlanır.
    // =========================================================================
    updateFloatingBar() {
        const count = window._selectedRows.size;

        // UAB Contextual Intelligence Sync
        const activeTabContent = document.querySelector('.tab-content.active');
        const activeUab        = activeTabContent ? activeTabContent.querySelector('.uab-bar') : null;
        if (activeUab) {
            activeUab.classList.toggle('uab-bulk-visible', count > 0);
        }

        const fab = _dom.fab();
        if (!fab) return;

        if (count === 0) {
            fab.classList.remove('fab-visible');
            return;
        }

        // Seçim sayısı etiketi
        const fabCount = _dom.fabCount();
        if (fabCount) fabCount.textContent = `${count} kayıt seçili`;

        // Seçili satır verilerini topla
        const selectedEls = document.querySelectorAll('.selectable-row.selected-row');
        const items = Array.from(selectedEls).map(el => ({
            depo:  el.dataset.depo,
            id:    el.dataset.id,
            name:  el.dataset.name
        }));
        const first = items[0];
        // INV-05 kalıntısı: tablo yeniden çizilince seçili satırlar DOM'dan gider ama _selectedRows seti kalır;
        // FAB o durumda var olmayan bir satırı okuyup hata veriyordu. Görünür seçim yoksa seçim temizlenir.
        if (!first) {
            window._selectedRows.clear();
            fab.classList.remove('fab-visible');
            if (activeUab) activeUab.classList.remove('uab-bulk-visible');
            return;
        }

        let buttonsHtml = '';

        // v3.4: depolar personel için yalnız görüntülenebilir — stok/düzenleme düğmeleri yerine açıklama (staff-guards.js)
        if (!(typeof window.isDbAdmin === 'function' && window.isDbAdmin())) {
            const fabBtns = _dom.fabBtns();
            if (fabBtns) {
                fabBtns.replaceChildren();
                const note = document.createElement('span');
                note.className = 'fab-readonly-note';
                note.textContent = '🔒 Yalnız görüntüleme — çıkış için Envanter Takibi › Envanter Çıkışı Yap';
                fabBtns.append(note);
            }
            fab.classList.add('fab-visible');
            return;
        }

        if (count === 1) {
            // TEKİL MOD: Tüm işlemler
            const item      = (window.data[first.depo] || []).find(x => x && String(x.id) === String(first.id)) || {};
            const isWatched = item.isWatched;
            const d = escapeHtml(first.depo), i = escapeHtml(first.id);
            buttonsHtml = `
                <button class="fab-btn fab-btn-inc" data-action="increaseStock" data-depo="${d}" data-id="${i}">
                    <i class="fas fa-plus"></i> Artır
                </button>
                <button class="fab-btn fab-btn-dec" data-action="decreaseStock" data-depo="${d}" data-id="${i}">
                    <i class="fas fa-minus"></i> Azalt
                </button>
                <button class="fab-btn fab-btn-edit" data-action="editProduct" data-depo="${d}" data-id="${i}">
                    <i class="fas fa-pen"></i> Düzenle
                </button>
                <button class="fab-btn fab-btn-clone" data-action="cloneProduct" data-depo="${d}" data-id="${i}">
                    <i class="fas fa-copy"></i> Kopyala
                </button>
                <button class="fab-btn fab-btn-transfer" data-action="transferProduct" data-depo="${d}" data-id="${i}">
                    <i class="fas fa-shipping-fast"></i> Sevk
                </button>
                <button class="fab-btn fab-btn-watch" data-action="toggleWatch" data-depo="${d}" data-id="${i}">
                    <i class="fas ${isWatched ? 'fa-eye-slash' : 'fa-eye'}"></i> ${isWatched ? 'Bırak' : 'Takip'}
                </button>
                <button class="fab-btn fab-btn-del" data-action="deleteItem" data-depo="${d}" data-id="${i}">
                    <i class="fas fa-trash-alt"></i> Sil
                </button>`;
        } else {
            // ÇOKLU MOD: Sadece toplu işlemler — Contextual Intelligence
            const depo = first.depo;
            const ids  = items.map(x => x.id);
            buttonsHtml = `
                <button class="fab-btn fab-btn-bulk-del" data-action="bulkDelete" data-depo="${escapeHtml(depo)}" data-ids="${escapeHtml(JSON.stringify(ids))}">
                    <i class="fas fa-trash-alt"></i> Toplu Sil (${count})
                </button>
                <button class="fab-btn fab-btn-bulk-transfer" data-action="bulkTransfer">
                    <i class="fas fa-shipping-fast"></i> Toplu Sevk (${count})
                </button>`;
        }

        const fabBtns = _dom.fabBtns();
        if (fabBtns) {
            fabBtns.innerHTML = buttonsHtml;
            _bindProductActions(fabBtns);
        }
        fab.classList.add('fab-visible');
    },

    // =========================================================================
    // BOTTOM SHEET: showMobileBottomSheet
    // [WHY]: Mobil'de tek satıra tıklanınca bağlamsal eylemler alt panelde açılır.
    // [HOW]: itemData'dan ürün bilgisini alır, butonları dinamik render eder,
    //        bsSheet ve bsOverlay'e bs-active class'ı ekler.
    // =========================================================================
    showMobileBottomSheet(itemData) {
        if (!itemData) return;
        const item      = (window.data[itemData.depo] || []).find(x => x && String(x.id) === String(itemData.id)) || {};
        const isWatched = item.isWatched;
        const d = escapeHtml(itemData.depo), i = escapeHtml(itemData.id);
        const bsName    = _dom.bsName();
        const bsBtns    = _dom.bsBtns();

        if (bsName) bsName.textContent = itemData.name || 'Ürün';
        if (bsBtns && !(typeof window.isDbAdmin === 'function' && window.isDbAdmin())) {
            bsBtns.replaceChildren();
            const note = document.createElement('p');
            note.className = 'fab-readonly-note';
            note.textContent = '🔒 Depolar personel için yalnız görüntülenebilir. Sarf malzeme çıkışı için Envanter Takibi › Envanter Çıkışı Yap.';
            bsBtns.append(note);
        } else if (bsBtns) bsBtns.innerHTML = `
            <button class="bs-action-btn bs-btn-inc" data-action="increaseStock" data-depo="${d}" data-id="${i}">
                <i class="fas fa-plus"></i> Artır
            </button>
            <button class="bs-action-btn bs-btn-dec" data-action="decreaseStock" data-depo="${d}" data-id="${i}">
                <i class="fas fa-minus"></i> Azalt
            </button>
            <button class="bs-action-btn bs-btn-edit" data-action="editProduct" data-depo="${d}" data-id="${i}">
                <i class="fas fa-pen"></i> Düzenle
            </button>
            <button class="bs-action-btn bs-btn-clone" data-action="cloneProduct" data-depo="${d}" data-id="${i}">
                <i class="fas fa-copy"></i> Kopyala
            </button>
            <button class="bs-action-btn bs-btn-transfer" data-action="transferProduct" data-depo="${d}" data-id="${i}">
                <i class="fas fa-shipping-fast"></i> Sevk
            </button>
            <button class="bs-action-btn bs-btn-watch" data-action="toggleWatch" data-depo="${d}" data-id="${i}">
                <i class="fas ${isWatched ? 'fa-eye-slash' : 'fa-eye'}"></i> ${isWatched ? 'Takibi Bırak' : 'Takibe Al'}
            </button>
            <button class="bs-action-btn bs-btn-del" data-action="deleteItem" data-depo="${d}" data-id="${i}">
                <i class="fas fa-trash-alt"></i> Sil
            </button>`;

        _bindProductActions(bsBtns, true);
        const bsOverlay = _dom.bsOverlay();
        const bsSheet   = _dom.bsSheet();
        if (bsOverlay) bsOverlay.classList.add('bs-active');
        if (bsSheet)   bsSheet.classList.add('bs-active');
    },

    // =========================================================================
    // BOTTOM SHEET: closeMobileBottomSheet
    // =========================================================================
    closeMobileBottomSheet() {
        const bsSheet   = _dom.bsSheet();
        const bsOverlay = _dom.bsOverlay();
        if (bsSheet)   bsSheet.classList.remove('bs-active');
        if (bsOverlay) bsOverlay.classList.remove('bs-active');
        UIComponents.clearRowSelection();
    },

    // =========================================================================
    // ROW SELECTION: clearRowSelection
    // [WHY]: Toplu seçimi tamamen sıfırlar. FAB ve UAB gizlenir.
    // [HOW]: Set temizlenir, .selected-row class'ları kaldırılır, FAB gizlenir.
    // =========================================================================
    clearRowSelection() {
        window._selectedRows.clear();
        document.querySelectorAll('.selectable-row.selected-row')
            .forEach(el => el.classList.remove('selected-row'));
        const fab = _dom.fab();
        if (fab) fab.classList.remove('fab-visible');
        document.querySelectorAll('.uab-bar.uab-bulk-visible')
            .forEach(bar => bar.classList.remove('uab-bulk-visible'));
    },

    // =========================================================================
    // BULK DELETE: _bulkDeleteSelected
    // [WHY]: V2 Batch mimarisiyle uyumlu toplu silme. window.saveData çağrılır.
    // [HOW]: Indices yüksekten aşağıya sıralanır (splice index kayması önlenir).
    //        showCustomConfirm onayı beklenir.
    // =========================================================================
    // Tek uygulama inventory-logic'te (id tabanlı, bulkRemove). Bu köprü yalnız ona yönlendirir; iki kopya ayrışmasın.
    async _bulkDeleteSelected(depo, ids) {
        return window.AppModules.Inventory._bulkDeleteSelected(depo, ids);
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL KEYBOARD LISTENER: ESC → Seçimi temizle
// [WHY]: Klavye UX — ESC tuşuyla FAB/BottomSheet'i kapatır.
// ─────────────────────────────────────────────────────────────────────────────
document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') UIComponents.clearRowSelection();
});

// ─────────────────────────────────────────────────────────────────────────────
// NAMESPACE ASSIGNMENT
// [WHY]: window.AppModules.UI ile merkezi orchestrator ve diğer modüllerin
//        UIComponents'e erişmesi sağlanır.
// ─────────────────────────────────────────────────────────────────────────────
window.AppModules = window.AppModules || {};
window.AppModules.UI = UIComponents;

// ─────────────────────────────────────────────────────────────────────────────
// LEGACY COMPATIBILITY BRIDGES
// [WHY]: index.html içindeki onlarca inline onclick="openProductModal(...)" gibi
//        çağrılar, doğrudan global window scope'u arar. ESM modülü içindeki
//        fonksiyonlar bu scope'a otomatik girmez; bu bridge'ler köprü kurar.
// [HOW]: Her fonksiyon window.XYZ = UIComponents.XYZ.bind(UIComponents) şeklinde
//        atanır. bind ile 'this' context'i korunur.
// ─────────────────────────────────────────────────────────────────────────────
window.openProductModal         = UIComponents.openProductModal.bind(UIComponents);
window.cloneProduct             = UIComponents.cloneProduct.bind(UIComponents);
window.openTransferModal        = UIComponents.openTransferModal.bind(UIComponents);
window.handleTransferTargetChange = UIComponents.handleTransferTargetChange.bind(UIComponents);
window.confirmTransfer          = UIComponents.confirmTransfer.bind(UIComponents);
window.closeTransferModal       = UIComponents.closeTransferModal.bind(UIComponents);
window.syncTransferDevices      = UIComponents.syncTransferDevices.bind(UIComponents);
window.openExitModal            = UIComponents.openExitModal.bind(UIComponents);
window.closeExitModal           = UIComponents.closeExitModal.bind(UIComponents);
window.openRequestModal         = UIComponents.openRequestModal.bind(UIComponents);
window.closeRequestModal        = UIComponents.closeRequestModal.bind(UIComponents);
window.handleTypeChange         = UIComponents.handleTypeChange.bind(UIComponents);
window.selectProduct            = UIComponents.selectProduct.bind(UIComponents);
window.openModal                = UIComponents.openModal.bind(UIComponents);
window.closeModal               = UIComponents.closeModal.bind(UIComponents);
window.setupRowSelection        = UIComponents.setupRowSelection.bind(UIComponents);
window.updateFloatingBar        = UIComponents.updateFloatingBar.bind(UIComponents);
window.showMobileBottomSheet    = UIComponents.showMobileBottomSheet.bind(UIComponents);
window.closeMobileBottomSheet   = UIComponents.closeMobileBottomSheet.bind(UIComponents);
window.clearRowSelection        = UIComponents.clearRowSelection.bind(UIComponents);
window._bulkDeleteSelected      = UIComponents._bulkDeleteSelected.bind(UIComponents);

// [STATUS]: UIComponents Namespace'i window.AppModules.UI'ye bağlandı.
//           Legacy köprüleri (bridge) kuruldu. Phase 5 tamamlandı.
