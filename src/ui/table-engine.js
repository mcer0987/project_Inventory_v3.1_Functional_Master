/**
 * table-engine.js — Medipol Envanter Takip Sistemi
 * ==================================================
 * v3.1 ESM Modüler Mimari — Phase 3: Tablo ve Kart Görünüm Motoru
 *
 * [WHY]: script.js monolith'indeki tüm rendering (görselleştirme) ve DOM güncelleme
 *        fonksiyonları TableEngine çatısı altında toplanarak, global namespace kirliliği önlenir.
 * [HOW]: Tüm fonksiyonlar TableEngine nesnesinde toplanır, window.AppModules.Table'a
 *        bağlanır ve legacy HTML onclick vb. çağrılar için bridge'ler kurulur.
 *
 * // [STATUS]: TableEngine Namespace'i window.AppModules.Table'a bağlandı. Legacy köprüleri (bridge) kuruldu.
 */

// ─────────────────────────────────────────────────────────────────────────────
// MODÜL KAPSAMLI STATE (sort ve sayfalama)
// ─────────────────────────────────────────────────────────────────────────────
let _sortColumn = 'lastUpdate';
let _isAscending = false;
let _currentPage = 1;
const PAGE_SIZE = 25;

// Mirror to window for legacy sync script.js compatibility
Object.defineProperty(window, 'currentSortColumn', {
    get() { return _sortColumn; },
    set(v) { _sortColumn = v; },
    configurable: true
});
Object.defineProperty(window, 'isAscending', {
    get() { return _isAscending; },
    set(v) { _isAscending = v; },
    configurable: true
});
Object.defineProperty(window, 'currentPage', {
    get() { return _currentPage; },
    set(v) { _currentPage = v; },
    configurable: true
});
window.pageSize = PAGE_SIZE;

// ─────────────────────────────────────────────────────────────────────────────
// Yardımcı Helper Fonksiyonları
// ─────────────────────────────────────────────────────────────────────────────
// [WHY]: Faz 4 · J2 (SEC-01) — B1/B2 tabloları ve kartları ürün, marka, raf, durum, tür alanlarını ham basıyordu; tarih
//        satır içi handler'a JS dizgesi olarak gömülüyordu ('…' tırnağıyla kaçılabilir).
// [HOW]: Her ham alan şablona girdiği yerde escapeHtml; tarih data-tip niteliğinde, delege handler dataset.tip okur.
function _buildQtyDisplay(itemQty, updateDate) {
    if (window.innerWidth <= 768) {
        return `${escapeHtml(itemQty)} <span class="mobile-info-trigger" data-tip="${escapeHtml(updateDate)}" data-action="mobileTooltip" style="margin-left: 6px; cursor: pointer; color: #3498db; display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 50%; font-size: 0.85em; transition: opacity 0.2s;"><i class="fas fa-info-circle"></i></span>`;
    }
    return escapeHtml(itemQty);
}

function _buildRowInnerHtml(depo, item, realIndex, qtyHtml) {
    if (depo === 'b1' || depo === 'b2') {
        const itemType = item.tür || item.type || item.prodType || '-';
        return `
            <td><input type="checkbox" class="row-select" data-index="${escapeHtml(realIndex)}" data-id="${escapeHtml(item.id ?? '')}"></td>
            <td>${escapeHtml(item.sütun || '-')}</td>
            <td>${escapeHtml(item.raf || '-')}</td>
            <td>${escapeHtml(item.ürün || '-')}${item.isWatched ? ' <i class="fas fa-eye" title="Takipte" style="color:var(--color-info);margin-left:4px;"></i>' : ''}</td>
            <td>${escapeHtml(item.marka || '-')}</td>
            <td class="js-qty-cell">${qtyHtml}</td>
            <td class="js-status-cell">${escapeHtml(item.durumu || '-')}</td>
            <td>${escapeHtml(itemType)}</td>
            <td>${escapeHtml(item.envanterNo || '-')}</td>`;
    }
    return `
        <td><input type="checkbox" class="row-select"></td>
        <td>${escapeHtml(item.ürün || item.name || '-')}</td>
        <td>${escapeHtml(item.tür || item.type || '-')}</td>
        <td>${escapeHtml(item.raf || item.shelf || '-')}</td>
        <td class="js-status-cell">${escapeHtml(item.durumu || item.status || '-')}</td>
        <td class="js-qty-cell">${qtyHtml}</td>`;
}

function _buildRowHtml(depo, item, realIndex) {
    const updateDate = (typeof tsToTurkiye === 'function')
        ? tsToTurkiye(item.lastUpdate)
        : (item.lastUpdate ? String(item.lastUpdate) : 'Tarih bilgisi yok');
    const itemQty = item.adet !== undefined ? item.adet : (item.qty || 0);
    const qtyHtml = _buildQtyDisplay(itemQty, updateDate);
    const innerHtml = _buildRowInnerHtml(depo, item, realIndex, qtyHtml);
    const isPassive = window.isPassiveStatus ? window.isPassiveStatus(item.durumu || item.status) : (item.durumu === 'Pasif' || item.status === 'Pasif');
    const rowClass = isPassive ? 'passive-row' : '';
    const safeName = escapeHtml(item.ürün || item.name || '-');

    return `<tr class="${rowClass} selectable-row"
                data-id="${escapeHtml(item.id ?? '')}"
                data-depo="${escapeHtml(depo)}"
                data-index="${escapeHtml(realIndex)}"
                data-name="${safeName}"
                data-tip="${escapeHtml(updateDate)}">
                ${innerHtml}
            </tr>`;
}

// [WHY] (Faz 5 · K2 · INV-07): totalCount window.data[depo].length (FİLTRESİZ ham uzunluk) kullanıyordu; gösterilen
//       satırlar ise getProcessedData'nın (b1'de filtreli) sonucuydu. Pasif karışık bir listede buton yanlış
//       görünüyor/kayboluyordu (filtrelenmiş toplam sayfa boyutunu geçmese de ham sayı geçtiği için buton kalıyordu).
// [HOW]: Çağıran (renderTable), zaten hesapladığı filtreli allData.length'i buraya verir; tekrar hesaplanmaz.
function _renderLoadMoreButton(depo, filteredCount) {
    let loadMoreBtn = document.getElementById('loadMoreBtn');
    if (loadMoreBtn) loadMoreBtn.remove();

    const totalCount = filteredCount ?? ((window.data && window.data[depo]) ? window.data[depo].length : 0);

    if (totalCount > _currentPage * PAGE_SIZE) {
        loadMoreBtn = document.createElement('button');
        loadMoreBtn.id = 'loadMoreBtn';
        loadMoreBtn.innerText = 'Daha Fazla Yükle...';
        loadMoreBtn.className = 'add-btn';
        loadMoreBtn.style.margin = '20px auto';
        loadMoreBtn.style.display = 'block';

        loadMoreBtn.dataset.action = 'loadMore';
        loadMoreBtn.dataset.depo = depo;
        window.bindActions(loadMoreBtn, { loadMore: el => {
            _currentPage++;
            window.renderTable(el.dataset.depo, true);
        } });

        const tableElement = document.querySelector(`#table${depo.toUpperCase()}`);
        if (tableElement) tableElement.after(loadMoreBtn);
    }
}

// v3.6: Yönetici, sayımdaki raflar yüzünden gizlenen ürün sayısını depo görünümünde görür (personel görmez).
function _renderCountLockNotice(depo) {
    const anchor = document.getElementById(`table${depo.toUpperCase()}`) || document.getElementById(`cardView${depo.toUpperCase()}`);
    if (!anchor || !anchor.parentNode) return;
    const id = `countLockNotice${depo.toUpperCase()}`;
    let note = document.getElementById(id);
    const isAdmin = typeof window.isDbAdmin === 'function' && window.isDbAdmin();
    const hidden = isAdmin && window.Schema && typeof window.Schema.isRowCountLocked === 'function'
        ? (window.data[depo] || []).filter(item => window.Schema.isRowCountLocked(item)).length : 0;
    if (!hidden) { if (note) note.remove(); return; }
    if (!note) {
        note = document.createElement('div');
        note.id = id;
        note.className = 'count-lock-notice';
        note.setAttribute('role', 'status');
        anchor.parentNode.insertBefore(note, anchor);
    }
    note.textContent = `🔒 Sayımdaki raflarda ${hidden} ürün kaydı bu listede gizli. Sayım ve adet düzeltmesi: Yönetim Paneli › Depo Raf Haritası.`;
}

// [WHY]: KJ-6 — yeniden çizilen satırlarda tooltip davranışı inline JS gerektirmemeli.
// [HOW]: Click bindActions ile; hover, mouseover/out ve relatedTarget ile satır sınırında çalışır.
function _bindTableActions(tbody) {
    window.bindActions(tbody, { mobileTooltip: (el, event) => window.showMobileTooltip(event, el.dataset.tip) });
    if (tbody._tooltipActionsBound) return;
    tbody._tooltipActionsBound = true;
    const rowFor = event => event.target.closest('tr.selectable-row');
    tbody.addEventListener('mouseover', event => {
        const row = rowFor(event);
        if (row && !row.contains(event.relatedTarget)) window.showRowTooltip(event, row.dataset.tip);
    });
    tbody.addEventListener('mousemove', event => {
        if (rowFor(event)) window.moveRowTooltip(event);
    });
    tbody.addEventListener('mouseout', event => {
        const row = rowFor(event);
        if (row && !row.contains(event.relatedTarget)) window.hideRowTooltip();
    });
}

function _setupCardViewSelection(container) {
    window.bindActions(container, {
        cardCheckbox: (el, event) => event.stopPropagation(),
        toggleCardGroup: el => window._toggleCardGroup(el.dataset.body, el.dataset.icon),
    });
    if (!container || container._cardFabListenerAttached) return;
    container._cardFabListenerAttached = true;

    container.addEventListener('click', function (e) {
        if (e.target.type === 'checkbox') return;

        const item = e.target.closest('.selectable-row[data-index]');
        if (!item) return;

        const { depo, id, name } = item.dataset;
        const key = `${depo}|${id}`; // DATA-06: seçim anahtarı ürün id'si

        if (item.classList.contains('selected-row')) {
            item.classList.remove('selected-row');
            if (window._selectedRows) window._selectedRows.delete(key);
        } else {
            item.classList.add('selected-row');
            if (window._selectedRows) window._selectedRows.add(key);
            item._fabData = { depo, id, name };
        }

        if (typeof window.updateFloatingBar === 'function') {
            window.updateFloatingBar();
        }

        if (window.innerWidth <= 768 && item.classList.contains('selected-row')) {
            if (typeof window.showMobileBottomSheet === 'function') {
                window.showMobileBottomSheet(item._fabData || { depo, id, name });
            }
        }
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Core Rendering & Search Functions (TableEngine)
// ─────────────────────────────────────────────────────────────────────────────
export const getProcessedData = function (depo) {
    if (!window.data || !window.data[depo]) return [];

    let rawData = window.data[depo].map((item, index) => {
        let copy = JSON.parse(JSON.stringify(item));
        copy.__index = index;
        return copy;
    });

    // v3.6: rafı sayımda olan ürünler depo görünümlerinde (tablo, arama, kart) kimseye gösterilmez; yönetici onları WMS raf
    //       panelinde görür. Depo filtresinden ÖNCE: o kanca b2'de ve "Tümü"nde erken döner.
    if (window.Schema && typeof window.Schema.isRowCountLocked === 'function') {
        rawData = rawData.filter(item => !window.Schema.isRowCountLocked(item));
    }

    if (typeof window.getFilteredB1Data === 'function') {
        rawData = window.getFilteredB1Data(depo, rawData);
    }

    rawData.sort((a, b) => {
        let key = _sortColumn;
        let valA = a[key] || '';
        let valB = b[key] || '';

        if (key === 'adet') {
            return _isAscending
                ? (Number(valA) - Number(valB))
                : (Number(valB) - Number(valA));
        }

        let strA = String(valA).toLocaleLowerCase('tr-TR');
        let strB = String(valB).toLocaleLowerCase('tr-TR');

        return _isAscending
            ? strA.localeCompare(strB, 'tr')
            : strB.localeCompare(strA, 'tr');
    });

    return rawData;
};

export const renderTable = function (depo, append = false, customLimit = null) {
    if (!depo) return;

    if (window._cardViewActive && window._cardViewActive[depo] && !append) {
        window.renderMobileCards(depo);
        return;
    }

    const searchInput = document.getElementById(`search${depo.toUpperCase()}`);
    if (searchInput && searchInput.value.trim() !== '' && !append) {
        window.searchTable(depo);
        return;
    }

    const tableId = `table${depo.toUpperCase()}`;
    const tableContainer = document.getElementById(tableId);
    if (!tableContainer) return;

    const tbody = tableContainer.querySelector('tbody');
    if (!tbody) return;

    const rawData = window.data[depo];
    const allData = getProcessedData(depo);

    if (!append) {
        tbody.innerHTML = '';
        if (!customLimit) _currentPage = 1;
        if (depo === 'b1' || depo === 'b2') _renderCountLockNotice(depo);
    }

    const start = append ? (_currentPage - 1) * PAGE_SIZE : 0;
    const end = customLimit ? customLimit : (_currentPage * PAGE_SIZE);

    const displayData = allData.slice(start, end);

    const rowsHtml = displayData.map((item) => {
        const realIndex = item.__index ??
            rawData.findIndex(x =>
                (x.id && item.id && x.id === item.id) ||
                (x.ürün === item.ürün && x.raf === item.raf && x.sütun === item.sütun)
            );
        return _buildRowHtml(depo, item, realIndex);
    });

    if (append) {
        tbody.insertAdjacentHTML('beforeend', rowsHtml.join(''));
    } else {
        tbody.innerHTML = rowsHtml.join('');
    }

    _bindTableActions(tbody);
    _renderLoadMoreButton(depo, allData.length);

    if (typeof window.setupRowSelection === 'function') {
        window.setupRowSelection(tableContainer);
    }
};

export const searchTable = function (depo) {
    const input = document.getElementById(`search${depo.toUpperCase()}`);
    if (!input) return;

    const searchTerm = input.value.toLocaleLowerCase('tr-TR');

    if (searchTerm === '') {
        if (window._cardViewActive && window._cardViewActive[depo]) {
            window.renderMobileCards(depo);
        } else {
            renderTable(depo);
            const loadMoreBtn = document.getElementById('loadMoreBtn');
            if (loadMoreBtn) loadMoreBtn.style.display = 'block';
        }
        return;
    }

    const allData = getProcessedData(depo);
    const filteredResults = allData.filter(item => {
        return [
            item.ürün, item.marka, item.açıklama, item.name, item.model, item.raf, item.tür, item.envanterNo
        ].some(val => (val || '').toLocaleLowerCase('tr-TR').includes(searchTerm));
    });

    renderSearchResults(depo, filteredResults);
};

export const renderSearchResults = function (depo, results) {
    if (!depo) return;

    if (window._cardViewActive && window._cardViewActive[depo]) {
        window.renderCardSearchResults(depo, results);
        return;
    }

    const tableId = `table${depo.toUpperCase()}`;
    const tableContainer = document.getElementById(tableId);
    if (!tableContainer) return;

    const tbody = tableContainer.querySelector('tbody');
    if (!tbody) return;

    tbody.innerHTML = '';
    const rawData = window.data[depo];

    const rowsHtml = results.map((item) => {
        const realIndex = item.__index !== undefined ? item.__index :
            rawData.findIndex(x => x.id === item.id);

        if (realIndex === -1) return '';
        return _buildRowHtml(depo, item, realIndex);
    }).join('');

    tbody.innerHTML = rowsHtml;
    _bindTableActions(tbody);

    const loadMoreBtn = document.getElementById('loadMoreBtn');
    if (loadMoreBtn) loadMoreBtn.style.display = 'none';

    if (typeof window.setupRowSelection === 'function') {
        window.setupRowSelection(tableContainer);
    }
};

export const renderCardSearchResults = function (depo, results) {
    const cardContainer = document.getElementById(`cardView${depo.toUpperCase()}`);
    if (!cardContainer) return;

    const rawData = window.data[depo] || [];

    if (results.length === 0) {
        cardContainer.innerHTML = `
            <div class="card-empty-state">
                <i class="fas fa-search"></i>
                <p>Arama sonucu bulunamadı.</p>
            </div>`;
        return;
    }

    const itemsHtml = results.map(item => {
        const realIndex = item.__index !== undefined ? item.__index
            : rawData.findIndex(x =>
                (x.id && item.id && x.id === item.id) ||
                (x.ürün === item.ürün && x.raf === item.raf)
            );
        if (realIndex === -1) return '';

        const itemQty = item.adet !== undefined ? item.adet : (item.qty || 0);
        const isPassive = window.isPassiveStatus ? window.isPassiveStatus(item.durumu || item.status) : (item.durumu === 'Pasif' || item.status === 'Pasif');
        const isWatched = item.isWatched;
        const qtyClass = itemQty === 0 ? 'qty-zero' : (itemQty <= 3 ? 'qty-low' : 'qty-ok');
        const safeName = escapeHtml(item.ürün || item.name || '-');
        const turAdi = item.tür || item.type || item.prodType || 'Diğer';

        return `
            <div class="product-card-item ${isPassive ? 'card-item-passive' : ''} selectable-row"
                 data-id="${escapeHtml(item.id ?? '')}"
                 data-depo="${escapeHtml(depo)}"
                 data-index="${escapeHtml(realIndex)}"
                 data-name="${safeName}"
                 role="button"
                 tabindex="0">
                <div class="pci-left">
                    <input type="checkbox" class="row-select card-checkbox"
                           data-index="${escapeHtml(realIndex)}" data-id="${escapeHtml(item.id ?? '')}"
                           data-action="cardCheckbox">
                    <div class="pci-info">
                        <span class="pci-name">${safeName}</span>
                        <span class="pci-meta">
                            <span class="pci-meta-tag"><i class="fas fa-layer-group"></i> ${escapeHtml(turAdi)}</span>
                            <span class="pci-meta-tag"><i class="fas fa-map-marker-alt"></i> ${escapeHtml(item.raf || '-')}</span>
                            ${item.envanterNo ? `<span class="pci-meta-tag"><i class="fas fa-barcode"></i> ${escapeHtml(item.envanterNo)}</span>` : ''}
                            ${item.marka ? `<span class="pci-meta-tag"><i class="fas fa-tag"></i> ${escapeHtml(item.marka)}</span>` : ''}
                        </span>
                    </div>
                </div>
                <div class="pci-right">
                    <span class="pci-qty-badge ${qtyClass}">${escapeHtml(itemQty)}</span>
                    ${isWatched ? '<span class="pci-watch-dot" title="Takipte"><i class="fas fa-eye"></i></span>' : ''}
                    ${isPassive ? '<span class="pci-passive-tag">Pasif</span>' : ''}
                </div>
            </div>`;
    }).join('');

    cardContainer.innerHTML = `
        <div class="card-search-header">
            <i class="fas fa-search"></i>
            <span>${results.length} sonuç bulundu</span>
        </div>
        <div class="type-group-card">
            <div class="type-group-body expanded">
                ${itemsHtml}
            </div>
        </div>`;

    const freshContainer = document.getElementById(`cardView${depo.toUpperCase()}`);
    if (freshContainer) {
        _setupCardViewSelection(freshContainer);
    }
};

export const renderMobileCards = function (depo) {
    if (!depo || (depo !== 'b1' && depo !== 'b2')) return;

    const cardContainer = document.getElementById(`cardView${depo.toUpperCase()}`);
    if (!cardContainer) return;

    const rawData = window.data[depo] || [];
    const allData = getProcessedData(depo);
    _renderCountLockNotice(depo);

    if (allData.length === 0) {
        cardContainer.innerHTML = `
            <div class="card-empty-state">
                <i class="fas fa-box-open"></i>
                <p>Bu depoda kayıt bulunmuyor.</p>
            </div>`;
        return;
    }

    const groups = allData.reduce((acc, item) => {
        const turKey = item.tür || item.type || item.prodType || 'Diğer';
        if (!acc[turKey]) acc[turKey] = [];
        const realIndex = item.__index !== undefined ? item.__index
            : rawData.findIndex(x =>
                (x.id && item.id && x.id === item.id) ||
                (x.ürün === item.ürün && x.raf === item.raf)
            );
        acc[turKey].push({ ...item, _realIndex: realIndex });
        return acc;
    }, {});

    const groupKeys = Object.keys(groups).sort();

    const cardsHtml = groupKeys.map((turAdi, groupIdx) => {
        const items = groups[turAdi];
        const totalStock = items.reduce((sum, it) => {
            return sum + (it.adet !== undefined ? Number(it.adet) : (Number(it.qty) || 0));
        }, 0);

        const itemsHtml = items.map(item => {
            const itemQty = item.adet !== undefined ? item.adet : (item.qty || 0);
            const isPassive = window.isPassiveStatus ? window.isPassiveStatus(item.durumu || item.status) : (item.durumu === 'Pasif' || item.status === 'Pasif');
            const isWatched = item.isWatched;
            const qtyClass = itemQty === 0 ? 'qty-zero' : (itemQty <= 3 ? 'qty-low' : 'qty-ok');
            const safeDepo = escapeHtml(depo);
            const safeName = escapeHtml(item.ürün || item.name || '-');

            return `
                <div class="product-card-item ${isPassive ? 'card-item-passive' : ''} selectable-row"
                     data-id="${escapeHtml(item.id ?? '')}"
                     data-depo="${safeDepo}"
                     data-index="${escapeHtml(item._realIndex)}"
                     data-name="${safeName}"
                     role="button"
                     tabindex="0">
                    <div class="pci-left">
                        <input type="checkbox" class="row-select card-checkbox"
                               data-index="${escapeHtml(item._realIndex)}" data-id="${escapeHtml(item.id ?? '')}"
                               data-action="cardCheckbox">
                        <div class="pci-info">
                            <span class="pci-name">${safeName}</span>
                            <span class="pci-meta">
                                <span class="pci-meta-tag"><i class="fas fa-map-marker-alt"></i> ${escapeHtml(item.raf || '-')}</span>
                                ${item.envanterNo ? `<span class="pci-meta-tag"><i class="fas fa-barcode"></i> ${escapeHtml(item.envanterNo)}</span>` : ''}
                                ${item.marka ? `<span class="pci-meta-tag"><i class="fas fa-tag"></i> ${escapeHtml(item.marka)}</span>` : ''}
                                ${item.sütun ? `<span class="pci-meta-tag"><i class="fas fa-columns"></i> ${escapeHtml(item.sütun)}</span>` : ''}
                            </span>
                        </div>
                    </div>
                    <div class="pci-right">
                        <span class="pci-qty-badge js-qty-cell ${qtyClass}">${escapeHtml(itemQty)}</span>
                        ${isWatched ? '<span class="pci-watch-dot" title="Takipte"><i class="fas fa-eye"></i></span>' : ''}
                        ${isPassive ? '<span class="pci-passive-tag js-status-cell">Pasif</span>' : '<span class="js-status-cell" style="display:none;"></span>'}
                    </div>
                </div>`;
        }).join('');

        // Grup kimliği yalnız depo (b1|b2, renderMobileCards başında doğrulanır) + sayısal sıra: kayıt verisi içermez.
        const gid = `${depo /* xss-ok: b1|b2 doğrulanmış sabit */}_${groupIdx}`;
        return `
            <div class="type-group-card" id="typeGroup_${gid /* xss-ok: depo sabiti + sıra */}">
                <div class="type-group-header"
                     data-action="toggleCardGroup" data-body="typeGroupBody_${escapeHtml(gid)}" data-icon="typeGroupIcon_${escapeHtml(gid)}">
                    <div class="tgh-left">
                        <i class="fas fa-layer-group tgh-icon"></i>
                        <span class="tgh-name">${escapeHtml(turAdi)}</span>
                        <span class="tgh-count">${items.length} ürün</span>
                    </div>
                    <div class="tgh-right">
                        <span class="tgh-stock-badge">
                            <i class="fas fa-cubes"></i> ${escapeHtml(totalStock)} adet
                        </span>
                        <i class="fas fa-chevron-down tgh-chevron" id="typeGroupIcon_${gid /* xss-ok: depo sabiti + sıra */}"></i>
                    </div>
                </div>
                <div class="type-group-body" id="typeGroupBody_${gid /* xss-ok: depo sabiti + sıra */}">
                    ${itemsHtml}
                </div>
            </div>`;
    }).join('');

    cardContainer.innerHTML = cardsHtml;
    _setupCardViewSelection(cardContainer);
};

export const changePage = function (depo, page) {
    _currentPage = page;
    renderTable(depo);
    window.scrollTo(0, 0);
};

export const sortTable = function (columnName, depo) {
    if (_sortColumn === columnName) {
        _isAscending = !_isAscending;
    } else {
        _sortColumn = columnName;
        _isAscending = true;
    }

    const currentLimit = _currentPage * PAGE_SIZE;
    renderTable(depo, false, currentLimit);
};

// [WHY]: _cardViewActive hiç başlatılmıyordu (toggle TypeError) ve mobil/TV CSS'i tabloyu gizleyip boş kart alanı gösteriyordu (INV-03).
// [HOW]: Durum nesnesi başlatılır; mobil (≤768px) ve TV (≥2560px) ekranda kart modu otomatik açılır.
//        Tablo seçimi 'force-table-view' sınıfıyla işaretlenir; CSS bu sınıfla medya sorgusunu ezer.
window._cardViewActive = window._cardViewActive || {};
const CARD_VIEW_DEPOS = ['b1', 'b2'];
const AUTO_CARD_MQ = window.matchMedia('(max-width: 768px), (min-width: 2560px)');

function applyCardViewState(depo) {
    const active = !!window._cardViewActive[depo];
    const section = document.getElementById(depo);
    const tableWrapper = document.querySelector(`#${depo} .table-responsive-wrapper`);
    const cardContainer = document.getElementById(`cardView${depo.toUpperCase()}`);
    const toggleBtn = document.getElementById(`viewToggle${depo.toUpperCase()}`);

    if (section) section.classList.toggle('force-table-view', !active);
    if (tableWrapper) tableWrapper.style.display = active ? 'none' : '';
    if (cardContainer) cardContainer.style.display = active ? 'block' : 'none';
    if (toggleBtn) {
        toggleBtn.innerHTML = active ? '<i class="fas fa-table"></i>' : '<i class="fas fa-th-large"></i>';
        toggleBtn.title = active ? 'Tablo Görünümüne Geç' : 'Kart Görünümüne Geç';
        toggleBtn.classList.toggle('view-toggle-active', active);
    }
}

export const toggleCardView = function (depo) {
    window._cardViewActive[depo] = !window._cardViewActive[depo];
    applyCardViewState(depo);
    if (window._cardViewActive[depo]) renderMobileCards(depo);
    else renderTable(depo);
};

function _detectAndApplyCardView() {
    CARD_VIEW_DEPOS.forEach(depo => {
        window._cardViewActive[depo] = AUTO_CARD_MQ.matches;
        applyCardViewState(depo);
        if (AUTO_CARD_MQ.matches && (window.data?.[depo] || []).length) renderMobileCards(depo);
    });
}
AUTO_CARD_MQ.addEventListener('change', () => {
    _detectAndApplyCardView();
    CARD_VIEW_DEPOS.forEach(depo => { if (!AUTO_CARD_MQ.matches) renderTable(depo); });
});
_detectAndApplyCardView();

// [WHY] (Faz 5 · K2 · INV-07): Canlı bir "sadece değiştirildi" güncellemesi patchDOMForCollection ile satır bazında
//       yama yapıyordu, ama hiç aktif durum filtresine (b1StatusFilter) bakmıyordu — bir ürün patch sırasında Pasif'e
//       düşünce "Sadece Aktifler" görünümünde satır DOM'da kalıyordu (yalnız stili değişiyordu); tam yeniden çizimde
//       (renderTable) ise doğru elenip "kaybolmuş" gibi görünüyordu (DATA-05, INV-07).
// [HOW]: Durum metni değiştiğinde, b1 için aktif filtreye göre satırın/kartın artık görünür olup olmayacağı yeniden
//        hesaplanır; filtre dışına düşüyorsa DOM'dan kaldırılır (tam renderTable ile tutarlı); düşmüyorsa eskisi gibi
//        hücreler/stil güncellenir. Diğer depolar (b2) ve filtre 'all' iken hiçbir satır kaldırılmaz.
function _passiveFilterExcludes(colName, isPassive) {
    if (colName !== 'b1') return false;
    const filterEl = document.getElementById('b1StatusFilter');
    const filterVal = filterEl ? filterEl.value : 'active';
    if (filterVal === 'active') return isPassive;
    if (filterVal === 'passive') return !isPassive;
    return false;
}

export const patchDOMForCollection = function (colName, changes) {
    if (!changes || changes.length === 0) return;

    changes.forEach(change => {
        const id = change.id;
        const data = change.data;
        const itemQty = data.adet !== undefined ? data.adet : (data.qty || 0);
        const itemStatus = data.durumu || data.status || '-';
        const isPassive = window.isPassiveStatus ? window.isPassiveStatus(itemStatus) : (itemStatus === 'Pasif');
        const hideNow = data.rafPasif === true || _passiveFilterExcludes(colName, isPassive);

        const rowEl = document.querySelector(`tr[data-depo="${colName}"][data-id="${id}"]`);
        if (rowEl) {
            if (hideNow) {
                rowEl.remove();
            } else {
                const qtyCell = rowEl.querySelector('.js-qty-cell');
                const statusCell = rowEl.querySelector('.js-status-cell');

                if (qtyCell) qtyCell.textContent = itemQty;
                if (statusCell) statusCell.textContent = itemStatus;

                if (isPassive) {
                    rowEl.classList.add('passive-row');
                } else {
                    rowEl.classList.remove('passive-row');
                }
            }
        }

        const cardEl = document.querySelector(`div.product-card-item[data-depo="${colName}"][data-id="${id}"]`);
        if (cardEl && hideNow) { cardEl.remove(); return; }
        if (cardEl) {
            const qtyBadge = cardEl.querySelector('.js-qty-cell');
            const statusTag = cardEl.querySelector('.js-status-cell');

            if (qtyBadge) {
                qtyBadge.textContent = itemQty;
                qtyBadge.classList.remove('qty-zero', 'qty-low', 'qty-ok');
                const qtyClass = itemQty === 0 ? 'qty-zero' : (itemQty <= 3 ? 'qty-low' : 'qty-ok');
                qtyBadge.classList.add(qtyClass);
            }

            if (statusTag) {
                if (isPassive) {
                    statusTag.style.display = 'inline-block';
                    cardEl.classList.add('card-item-passive');
                } else {
                    statusTag.style.display = 'none';
                    cardEl.classList.remove('card-item-passive');
                }
            }
        }
    });
};

// ─────────────────────────────────────────────────────────────────────────────
// Tooltip Helpers
// ─────────────────────────────────────────────────────────────────────────────
export const showRowTooltip = function (event, updateDate) {
    if (window.innerWidth <= 768) return;
    const tt = document.getElementById('custom-tooltip');
    if (tt) {
        tt.innerHTML = `🕒 Son Güncelleme: <span style="color:#f1c40f">${escapeHtml(updateDate)}</span>`;
        tt.style.display = 'block';
    }
};

export const moveRowTooltip = function (event) {
    if (window.innerWidth <= 768) return;
    const tt = document.getElementById('custom-tooltip');
    if (tt) {
        tt.style.left = (event.clientX + 15) + 'px';
        tt.style.top = (event.clientY + 15) + 'px';
    }
};

export const hideRowTooltip = function () {
    if (window.innerWidth <= 768) return;
    const tt = document.getElementById('custom-tooltip');
    if (tt) tt.style.display = 'none';
};

export const showMobileTooltip = function (event, updateDate) {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }
    if (typeof window.showAppAlert === 'function') {
        window.showAppAlert(`🕒 Son Güncelleme: ${updateDate}`, 'info');
    } else {
        alert(`🕒 Son Güncelleme: ${updateDate}`);
    }
};

export const toggleCardGroup = function (bodyId, iconId) {
    const body = document.getElementById(bodyId);
    if (!body) return;
    const isOpen = body.classList.toggle('expanded');
    const icon = document.getElementById(iconId);
    if (icon) icon.style.transform = isOpen ? 'rotate(180deg)' : 'rotate(0deg)';
};

// ─────────────────────────────────────────────────────────────────────────────
// Namespace Object & Bridges Assignment
// ─────────────────────────────────────────────────────────────────────────────
export const TableEngine = {
    renderTable,
    renderSearchResults,
    renderCardSearchResults,
    renderMobileCards,
    searchTable,
    changePage,
    sortTable,
    getProcessedData,
    patchDOMForCollection,
    toggleCardView,
    showRowTooltip,
    moveRowTooltip,
    hideRowTooltip,
    showMobileTooltip
};

window.AppModules = window.AppModules || {};
window.AppModules.Table = TableEngine;

// Legacy Backward Compatibility Bridges
window.renderTable = window.AppModules.Table.renderTable;
window.renderSearchResults = window.AppModules.Table.renderSearchResults;
window.renderCardSearchResults = window.AppModules.Table.renderCardSearchResults;
window.renderMobileCards = window.AppModules.Table.renderMobileCards;
window.searchTable = window.AppModules.Table.searchTable;
window.changePage = window.AppModules.Table.changePage;
window.sortTable = window.AppModules.Table.sortTable;
window.getProcessedData = window.AppModules.Table.getProcessedData;
window.patchDOMForCollection = window.AppModules.Table.patchDOMForCollection;
window.toggleCardView = window.AppModules.Table.toggleCardView;
window.showRowTooltip = window.AppModules.Table.showRowTooltip;
window.moveRowTooltip = window.AppModules.Table.moveRowTooltip;
window.hideRowTooltip = window.AppModules.Table.hideRowTooltip;
window.showMobileTooltip = window.AppModules.Table.showMobileTooltip;
window._toggleCardGroup = toggleCardGroup;
