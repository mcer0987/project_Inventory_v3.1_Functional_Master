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
export const UIComponents = {

    // =========================================================================
    // MODAL: selectProduct
    // [WHY]: Çıkış modalındaki ürün arama sonucundan bir ürün seçilince
    //        seçili ürün bilgilerini #selectedProduct div'ine yazar.
    // [HOW]: window.data[repo][index] üzerinden demirbaş durumunu okur,
    //        UI'daki checkbox ile senkronize eder.
    // =========================================================================
    selectProduct(name, type, shelf, qty, repo, index) {
        const div = document.getElementById('selectedProduct');
        if (!div) return;

        div.dataset.name  = name;
        div.dataset.type  = type;
        div.dataset.shelf = shelf;
        div.dataset.qty   = qty;
        div.dataset.repo  = repo;
        div.dataset.index = index;

        // Demirbaş kontrolü (window.data okuma — read-only)
        const item       = (window.data && window.data[repo]) ? window.data[repo][index] : null;
        const isDemirbas = item ? (item.isDemirbas === true || item.isDemirbas === 'true') : false;
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
    openProductModal(mode, indexOrId = null, depoParam = null, useId = false) {
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

        if (mode === 'edit') {
            item = useId
                ? rawData.find(x => x.id === indexOrId)
                : rawData[indexOrId];
            if (!item) return;
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
                .map(c => `<option value="${c}">${c}</option>`).join('');
        }
        if (shelfSelect && locConfig) {
            shelfSelect.innerHTML = locConfig.shelves
                .map(s => `<option value="${s}">${s}</option>`).join('');
        }
        if (typeSelect) {
            typeSelect.innerHTML = '<option value="">Tür Seçiniz...</option>';
            allTypes.forEach(t => {
                const isDemirbas = t.isDemirbas === true || t.isDemirbas === 'true';
                const label      = isDemirbas ? 'Demirbaş' : 'Sarf';
                typeSelect.innerHTML += `
                    <option value="${t.name}" data-is-demirbas="${isDemirbas}">
                        ${t.name} (${label})
                    </option>`;
            });
        }

        const title = document.getElementById('modalTitle');
        const form  = document.getElementById('productForm');

        if (mode === 'edit' && item) {
            if (title) title.innerText = 'Ürün Düzenle';
            window.cachedEditingTypeName = item.tür || item.type || '';

            const setVal = (id, val) => {
                const el = document.getElementById(id);
                if (el) el.value = val ?? '';
            };

            setVal('prodColumn', item.sütun);
            setVal('prodShelf',  item.raf);
            setVal('prodName',   item.ürün || item.name);
            setVal('prodBrand',  item.marka);
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
                let found = false;
                [...typeSelect.options].forEach(opt => {
                    if (opt.value.trim().toLowerCase() === selectedType.toLowerCase()) {
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

            form.dataset.editIndex = indexOrId;
            form.dataset.editRepo  = activeTab;
            form.dataset.editId    = item.id ?? '';

        } else {
            if (title) title.innerText = 'Yeni Ürün Ekle';
            if (form)  form.reset();
            if (form)  { delete form.dataset.editIndex; delete form.dataset.editRepo; delete form.dataset.editId; }
        }

        modal.style.display = 'block';
    },

    // =========================================================================
    // MODAL: openTransferModal
    // [WHY]: Ürün Sevk/Transfer modalını açar. Hedef depoları listeler.
    // [HOW]: INV_CONFIG.transferTargets üzerinden hedef seçeneklerini oluşturur,
    //        gizli form alanlarını kaynakla doldurur.
    // =========================================================================
    openTransferModal(repoName, index) {
        if (typeof checkIsAdmin === 'function' && !checkIsAdmin()) {
            if (typeof showAppAlert === 'function') showAppAlert('Ürün Sevk/Transfer yetkisi sadece Admin\'lere tanımlanmıştır!', 'error');
            return;
        }

        const item         = window.data[repoName][index];
        const modal        = document.getElementById('transferModal');
        const targetSelect = document.getElementById('transTarget');
        if (!modal || !targetSelect) return;

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
        if (idxEl)   idxEl.value          = index;
        if (srcEl)   srcEl.value          = repoName;
        if (noteEl)  noteEl.value         = '';
        if (intelEl) intelEl.style.display = 'none';

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
            if (locs && colSel)   colSel.innerHTML   = locs.columns.map(c => `<option>${c}</option>`).join('');
            if (locs && shelfSel) shelfSel.innerHTML = locs.shelves.map(s => `<option>${s}</option>`).join('');
        } else {
            internalDiv.style.display = 'none';
        }
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
    async confirmTransfer() {
        const sourceRepo = document.getElementById('transSourceRepo')?.value;
        const index      = parseInt(document.getElementById('transIndex')?.value);
        let   targetData;

        try {
            targetData = JSON.parse(document.getElementById('transTarget')?.value);
        } catch (e) {
            if (typeof showAppAlert === 'function') showAppAlert('Hedef seçiniz!', 'error');
            return;
        }

        const transNoteInput = document.getElementById('transNote');
        const sevkNotu       = transNoteInput ? transNoteInput.value.trim() : '';
        const originalItem   = window.data[sourceRepo] && window.data[sourceRepo][index];

        if (!originalItem) {
            if (typeof showAppAlert === 'function') showAppAlert('Ürün bulunamadı!', 'error');
            return;
        }

        if (targetData.type === 'internal') {
            const newItem    = { ...originalItem };
            newItem.sütun    = document.getElementById('transNewCol')?.value;
            newItem.raf      = document.getElementById('transNewShelf')?.value;
            newItem.açıklama = sevkNotu ? sevkNotu : (originalItem.açıklama || '');

            const targetRepoKey = targetData.key;
            if (!window.data[targetRepoKey]) window.data[targetRepoKey] = [];
            window.data[targetRepoKey].push(newItem);
            window.data[sourceRepo].splice(index, 1);

            console.log(`${sourceRepo} → ${targetRepoKey} sevk edildi.`);
            if (typeof showAppAlert === 'function') showAppAlert('Ürün Sevk/Transfer talebi sağlandı', 'success');

        } else if (targetData.type === 'external' || targetData.type === 'service') {
            const serviceEntry = {
                id:            Date.now(),
                originalData:  { ...originalItem },
                urunAciklama:  originalItem.ürün || originalItem.name,
                marka:         originalItem.marka || '',
                sn:            originalItem.sn || '-',
                kaynakDepo:    sourceRepo,
                hedef:         targetData.name,
                sevkTarihi:    typeof getTurkiyeSaati === 'function' ? getTurkiyeSaati() : new Date().toISOString(),
                durum:         'Serviste / Yolda',
                not:           sevkNotu,
                isDemirbas:    originalItem.isDemirbas
            };

            if (!window.data.serviceRecords) window.data.serviceRecords = [];
            window.data.serviceRecords.unshift(serviceEntry);
            window.data[sourceRepo].splice(index, 1);

            if (typeof showAppAlert === 'function') showAppAlert(`${targetData.name} birimine sevk edildi. Servis paneline işlendi.`, 'info');
        }

        await window.saveData(window.data);
        UIComponents.closeTransferModal();
        if (typeof window.renderTable === 'function') window.renderTable(sourceRepo);

        if (targetData.type === 'external' || targetData.type === 'service') {
            if (typeof window.renderPurchaseModule === 'function') window.renderPurchaseModule();
        }
        if (targetData.type === 'internal') {
            if (typeof window.renderTable === 'function') window.renderTable(targetData.key);
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
    openExitModal(repoName, index) {
        window.currentExitRepo  = repoName || (document.querySelector('.tab-content.active')?.id || 'b1');
        window.currentExitIndex = index;

        // Demirbaş Koruması
        if (index !== undefined && index !== null && index !== '') {
            const item = window.data[window.currentExitRepo]
                ? window.data[window.currentExitRepo][index]
                : null;

            if (item && (item.isDemirbas === true || item.isDemirbas === 'true')) {
                const isAdmin = (typeof window.checkIsAdmin === 'function' && window.checkIsAdmin()) ||
                    sessionStorage.getItem('adminVizesi') === 'true';

                if (!isAdmin) {
                    if (typeof showAppAlert === 'function') {
                        showAppAlert(`🛡️ GÜVENLİK: "${item.ürün || item.name}" demirbaştır. Sadece yöneticiler çıkış yapabilir!`, 'warning');
                    }
                    return;
                } else {
                    if (typeof showAppAlert === 'function') showAppAlert('BİLGİ: Demirbaş ürününden çıkış yapıyorsunuz.', 'info');
                }
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
        const rowRepo = window.currentExitRepo;
        const rowItem = (rowRepo === 'b1' || rowRepo === 'b2') && index !== undefined && index !== null && index !== ''
            ? (window.data[rowRepo] || [])[index] : null;
        if (rowItem) {
            this.selectProduct(rowItem.ürün || rowItem.name, rowItem.tür || rowItem.type || rowItem.marka,
                rowItem.raf || rowItem.shelf, rowItem.adet ?? rowItem.qty ?? 0, rowRepo, index);
        }

        // Aktif kullanıcı adını forma yaz
        const activeUser  = window.getActiveUser();
        const personInput = document.getElementById('exitPerson');
        if (personInput && activeUser) personInput.value = activeUser.name;

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
            // Checkbox tıklaması kendi mantığını yönetir
            if (e.target.type === 'checkbox') return;

            const tr = e.target.closest('tr.selectable-row');
            if (!tr) return;

            const { depo, index, id, name } = tr.dataset;
            const key = `${depo}-${index}`;

            if (tr.classList.contains('selected-row')) {
                // Toggle off
                tr.classList.remove('selected-row');
                window._selectedRows.delete(key);
            } else {
                // Toggle on
                tr.classList.add('selected-row');
                window._selectedRows.add(key);
                tr._fabData = { depo, index: parseInt(index), id, name };
            }

            UIComponents.updateFloatingBar();

            // Mobil: tek satır seçiminde Bottom Sheet aç
            if (window.innerWidth <= 768 && tr.classList.contains('selected-row')) {
                UIComponents.showMobileBottomSheet(tr._fabData || { depo, index: parseInt(index), id, name });
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
            index: parseInt(el.dataset.index),
            id:    el.dataset.id,
            name:  el.dataset.name
        }));
        const first = items[0];

        let buttonsHtml = '';

        if (count === 1) {
            // TEKİL MOD: Tüm işlemler
            const item      = (window.data[first.depo] || [])[first.index] || {};
            const isWatched = item.isWatched;
            buttonsHtml = `
                <button class="fab-btn fab-btn-inc" onclick="updateStock('${first.depo}', ${first.index}, 1)">
                    <i class="fas fa-plus"></i> Artır
                </button>
                <button class="fab-btn fab-btn-dec" onclick="updateStock('${first.depo}', ${first.index}, -1)">
                    <i class="fas fa-minus"></i> Azalt
                </button>
                <button class="fab-btn fab-btn-edit" onclick="openProductModal('edit', ${first.index}, '${first.depo}'); window.clearRowSelection();">
                    <i class="fas fa-pen"></i> Düzenle
                </button>
                <button class="fab-btn fab-btn-transfer" onclick="openTransferModal('${first.depo}', ${first.index}); window.clearRowSelection();">
                    <i class="fas fa-shipping-fast"></i> Sevk
                </button>
                <button class="fab-btn fab-btn-watch" onclick="toggleWatch('${first.depo}', ${first.index})">
                    <i class="fas ${isWatched ? 'fa-eye-slash' : 'fa-eye'}"></i> ${isWatched ? 'Bırak' : 'Takip'}
                </button>
                <button class="fab-btn fab-btn-del" onclick="deleteItem('${first.depo}', ${first.index}); window.clearRowSelection();">
                    <i class="fas fa-trash-alt"></i> Sil
                </button>`;
        } else {
            // ÇOKLU MOD: Sadece toplu işlemler — Contextual Intelligence
            const depo    = first.depo;
            const indices = items.map(i => i.index);
            buttonsHtml = `
                <button class="fab-btn fab-btn-bulk-del" onclick="window._bulkDeleteSelected('${depo}', ${JSON.stringify(indices)})">
                    <i class="fas fa-trash-alt"></i> Toplu Sil (${count})
                </button>
                <button class="fab-btn fab-btn-bulk-transfer" onclick="showAppAlert('Toplu Sevk özelliği yakında!', 'info')">
                    <i class="fas fa-shipping-fast"></i> Toplu Sevk (${count})
                </button>`;
        }

        const fabBtns = _dom.fabBtns();
        if (fabBtns) fabBtns.innerHTML = buttonsHtml;
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
        const item      = (window.data[itemData.depo] || [])[itemData.index] || {};
        const isWatched = item.isWatched;
        const bsName    = _dom.bsName();
        const bsBtns    = _dom.bsBtns();

        if (bsName) bsName.textContent = itemData.name || 'Ürün';
        if (bsBtns) bsBtns.innerHTML = `
            <button class="bs-action-btn bs-btn-inc" onclick="updateStock('${itemData.depo}', ${itemData.index}, 1); window.closeMobileBottomSheet();">
                <i class="fas fa-plus"></i> Artır
            </button>
            <button class="bs-action-btn bs-btn-dec" onclick="updateStock('${itemData.depo}', ${itemData.index}, -1); window.closeMobileBottomSheet();">
                <i class="fas fa-minus"></i> Azalt
            </button>
            <button class="bs-action-btn bs-btn-edit" onclick="openProductModal('edit', ${itemData.index}, '${itemData.depo}'); window.closeMobileBottomSheet();">
                <i class="fas fa-pen"></i> Düzenle
            </button>
            <button class="bs-action-btn bs-btn-transfer" onclick="openTransferModal('${itemData.depo}', ${itemData.index}); window.closeMobileBottomSheet();">
                <i class="fas fa-shipping-fast"></i> Sevk
            </button>
            <button class="bs-action-btn bs-btn-watch" onclick="toggleWatch('${itemData.depo}', ${itemData.index}); window.closeMobileBottomSheet();">
                <i class="fas ${isWatched ? 'fa-eye-slash' : 'fa-eye'}"></i> ${isWatched ? 'Takibi Bırak' : 'Takibe Al'}
            </button>
            <button class="bs-action-btn bs-btn-del" onclick="deleteItem('${itemData.depo}', ${itemData.index}); window.closeMobileBottomSheet();">
                <i class="fas fa-trash-alt"></i> Sil
            </button>`;

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
    async _bulkDeleteSelected(depo, indices) {
        if (typeof checkIsAdmin === 'function' && !checkIsAdmin()) {
            if (typeof showAppAlert === 'function') showAppAlert('Bu işlem için yetkiniz yok!', 'error');
            return;
        }
        const onay = typeof showCustomConfirm === 'function'
            ? await showCustomConfirm('Toplu Silme', `${indices.length} kayıt kalıcı olarak silinecek. Onaylıyor musunuz?`)
            : confirm(`${indices.length} kayıt silinecek. Emin misiniz?`);

        if (!onay) return;

        // Yüksekten düşüğe sırala → splice index kaymasını önle
        indices.sort((a, b) => b - a).forEach(idx => {
            if (window.data[depo] && window.data[depo][idx]) {
                window.data[depo].splice(idx, 1);
            }
        });

        // Kullanıcı onaylı toplu silme: saveData v2 toplu silme kilidi bilinçli olarak açılır (Faz 3.1).
        await window.saveData(window.data, { allowBulkDelete: true });
        UIComponents.clearRowSelection();
        if (typeof window.renderTable === 'function') window.renderTable(depo);
        if (typeof showAppAlert === 'function') showAppAlert(`${indices.length} kayıt başarıyla silindi.`, 'success');
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
window.openTransferModal        = UIComponents.openTransferModal.bind(UIComponents);
window.handleTransferTargetChange = UIComponents.handleTransferTargetChange.bind(UIComponents);
window.confirmTransfer          = UIComponents.confirmTransfer.bind(UIComponents);
window.closeTransferModal       = UIComponents.closeTransferModal.bind(UIComponents);
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
console.log('✅ [ui-components.js] UIComponents yüklendi → window.AppModules.UI');
