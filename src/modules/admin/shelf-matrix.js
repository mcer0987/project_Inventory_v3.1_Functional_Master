(function () {
    'use strict';

    const DEFAULT_CAPACITY = 5;
    const UNASSIGNED_SHELF = '__unassigned__';
    let activeDepot = 'b1';
    let sortMode = 'occupancy';
    let searchQuery = '';
    let shelfFilter = 'all';   // v3.6: 'all' | 'empty' (boş raf ayıklaması) | 'locked' (sayımdaki raflar)
    let drawer = null;

    function escapeHtml(value) {
        if (typeof window.escapeHtml !== 'function') {
            throw new Error('escapeHtml yüklenmemiş; WMS çıktısı güvenli biçimde çizilemez.');
        }
        return window.escapeHtml(value);
    }

    function valuesOf(collection) {
        if (Array.isArray(collection)) return collection;
        if (collection && typeof collection === 'object') return Object.values(collection);
        return [];
    }

    function text(value) {
        return value == null ? '' : String(value).trim();
    }

    function firstValue(...values) {
        return values.map(text).find(value => value && value !== '-') || '';
    }

    function productName(item) {
        return firstValue(item.ürün, item.urun, item.name, item.ad, item.productName) || 'Adsız ürün';
    }

    function productType(item) {
        return firstValue(item.tür, item.tur, item.type, item.urunTuru, item.productType) || 'Tür belirtilmemiş';
    }

    // v3.3 Aşama 4 (P2-05 WMS tarafı): raf kodu ve doluluk tanımı artık schema.js'teki TEK sözleşmeden okunur —
    // önceden WMS kendi ham string karşılaştırmasını ("Raf-A 1" ≠ "raf-a 1" ≠ " Raf-A 1 ") ve kendi doluluk kuralını
    // (shelf-capacity.js'ten ayrı) taşıyordu; Aşama 1/2 bu ikisini Schema.itemShelfCode / isSlotOccupying'de
    // birleştirmişti ama WMS'e hiç bağlanmamıştı (Aşama 2 raporu: "WMS'in gruplamasına bu yüzden dokunmadım").
    function schema() {
        if (!window.Schema || typeof window.Schema.itemShelfCode !== 'function') {
            throw new Error('Şema modülü (schema.js) yüklenmemiş; WMS raf/doluluk hesaplanamaz.');
        }
        return window.Schema;
    }

    // Kanonik raf kodu (büyük harf, tek boşluk — Schema.normShelfCode). Rafsız/geçersiz kayıt → ''.
    function productShelfCode(item) {
        return schema().itemShelfCode(item);
    }

    function productQuantity(item) {
        const quantity = Number.parseFloat(item.adet ?? item.qty ?? item.quantity ?? 0);
        return Number.isFinite(quantity) ? quantity : 0;
    }

    // Tek kaynak: pozitif adetli + aktif durumlu kayıt 1 slot işgal eder (runStockOps/runProductSave'in usedSlots'u
    // saydığı AYNI kural) — WMS'in gösterdiği doluluk artık transaction'ın saydığıyla her zaman örtüşür.
    function productIsInStock(item) {
        return schema().isSlotOccupying(item);
    }

    function productSearchText(item) {
        return [
            productName(item),
            productType(item),
            firstValue(item.marka, item.brand),
            firstValue(item.seriNo, item.serialNo, item.seri, item.sn),
            firstValue(item.barkod, item.barcode, item.urunKodu, item.productCode),
            firstValue(item.id)
        ].join(' ').toLocaleLowerCase('tr-TR');
    }

    function capacityFor(depot, shelf) {
        if (!window.ShelfCapacity) throw new Error('Raf kapasite servisi yüklenmemiş.');
        return window.ShelfCapacity.capacityFor(depot, shelf) || DEFAULT_CAPACITY;
    }

    // Raf kataloğunda (${ROOT}/shelves/items) bu depoya ait kayıtlar; yalnız yönetici dinler (Aşama 2) → window.data.shelves.
    function catalogShelvesFor(depot) {
        return valuesOf(window.data && window.data.shelves).filter(s => s && s.depot === depot && schema().isValidShelfCode(s.code));
    }

    // v3.3 Aşama 4 (P2-06/P2-05): fiziksel raf listesi artık STOKTAN değil KATALOGTAN türer — boş bir raf, kapasitesi
    // WMS'ten tanımlanmışsa (bir ürün bulunmasa bile) haritada görünür; "Toplam Raf" gerçek kataloğu temsil eder.
    // Katalogda henüz olmayan ama üzerinde ürün bulunan eski raflar da (geçiş dönemi) kanonik koduyla gösterilmeye
    // devam eder — aksi halde göç tamamlanana kadar dolu bir raf haritadan KAYBOLURDU.
    function collectShelves(depot) {
        const grouped = new Map();   // kanonik kod → { code, key, items, registered, doc }
        const unassigned = [];

        catalogShelvesFor(depot).forEach(s => {
            if (!grouped.has(s.code)) grouped.set(s.code, { code: s.code, key: s.code, items: [], registered: true, doc: s });
        });
        const depotRows = valuesOf(window.data && window.data[depot]).filter(item => item && typeof item === 'object');

        depotRows.forEach(item => {
            if (!productIsInStock(item)) {
                // v3.6: sayımdaki rafa bağlı (adet 0 / pasif durumlu) kayıt Havuz'da değil, kendi rafının çekmecesinde sayılır.
                const lockedHome = grouped.get(productShelfCode(item));
                if (lockedHome && schema().isShelfCountLocked(lockedHome.doc)) return;
                unassigned.push(item);
                return;
            }
            const code = productShelfCode(item);
            if (!code) {
                unassigned.push(item);
                return;
            }
            if (!grouped.has(code)) grouped.set(code, { code, key: code, items: [], registered: false });
            grouped.get(code).items.push(item);
        });

        const shelves = Array.from(grouped.values(), g => {
            const bound = schema().rowsOnShelf(depotRows, g.code);   // adet 0 dahil rafa bağlı tüm kayıtlar
            return {
                code: g.code,
                key: g.key,
                items: g.items,
                capacity: capacityFor(depot, g.code),
                varieties: new Set(g.items.map(productType)).size,
                isUnassigned: false,
                registered: g.registered,   // WMS'ten kapasitesi tanımlı mı (false: geçiş dönemi, eski/kataloglanmamış raf)
                doc: g.doc || null,
                locked: schema().isShelfCountLocked(g.doc),
                boundRows: bound,
                hasPhysicalStock: bound.some(row => schema().hasPhysicalStock(row)),
            };
        });
        if (unassigned.length) {
            shelves.push({
                code: 'Rafı Tanımsız',
                key: UNASSIGNED_SHELF,
                items: unassigned,
                capacity: 0,
                varieties: new Set(unassigned.map(productType)).size,
                isUnassigned: true,
                registered: false,
                doc: null, locked: false, boundRows: unassigned, hasPhysicalStock: false,
            });
        }
        return shelves;
    }

    // v3.3 Aşama 6 (operasyonel kural): "Havuz" — depo seçicisindeki 3. seçenek. Her iki deponun rafsız/stok dışı
    // kalemlerini TEK EKRANDA, depo depo gezinmeden gösterir (ör. Excel içe aktarma raf eşleşmezse ürünü buraya düşürür).
    // Her kart GERÇEK bir depoya (b1/b2) bağlıdır — collectShelves(depot)'un ZATEN hesapladığı "Rafı Tanımsız" kovasını
    // yeniden kullanır (key=UNASSIGNED_SHELF); "İncele" aynı openDrawer/çekmece akışını o depo ile açar — yeni bir
    // çizim/taşıma yolu icat edilmez. Boş olsa bile her iki kart her zaman gösterilir (admin "B2'de hiç yok" bilsin).
    function collectPoolShelves() {
        return ['b1', 'b2'].map(depot => {
            const bucket = collectShelves(depot).find(s => s.isUnassigned);
            const items = bucket ? bucket.items : [];
            return {
                code: depot === 'b1' ? 'B1 Havuzu' : 'B2 Havuzu',
                key: UNASSIGNED_SHELF,
                items,
                capacity: 0,
                varieties: new Set(items.map(productType)).size,
                isUnassigned: true,
                registered: false,
                doc: null, locked: false, boundRows: items, hasPhysicalStock: false,
                depot,   // makeShelfCard bunu activeDepot yerine kullanır (bkz. aşağı)
            };
        });
    }

    // v3.6: boş raf = katalogda olup fiziksel stoğu (durumdan bağımsız adet > 0) olmayan raf.
    function isEmptyShelf(shelf) {
        return !shelf.isUnassigned && shelf.registered && !shelf.hasPhysicalStock;
    }
    function matchesFilter(shelf) {
        if (shelfFilter === 'empty') return isEmptyShelf(shelf);
        if (shelfFilter === 'locked') return shelf.locked;
        return true;
    }

    function matchesQuery(shelf) {
        if (!searchQuery) return true;
        const normalized = searchQuery.toLocaleLowerCase('tr-TR');
        if (shelf.code.toLocaleLowerCase('tr-TR').includes(normalized)) return true;
        return shelf.items.some(item => productSearchText(item).includes(normalized));
    }

    function occupancy(shelf) {
        return shelf.capacity ? shelf.items.length / shelf.capacity : 0;
    }

    function sortShelves(shelves) {
        const compareCode = (a, b) => a.code.localeCompare(b.code, 'tr', { numeric: true, sensitivity: 'base' });
        shelves.sort((a, b) => {
            if (a.isUnassigned !== b.isUnassigned) return a.isUnassigned ? 1 : -1;
            if (a.isUnassigned) return 0;
            if (sortMode === 'code') return compareCode(a, b);
            if (sortMode === 'variety') return b.varieties - a.varieties || compareCode(a, b);
            return occupancy(b) - occupancy(a) || compareCode(a, b);
        });
        return shelves;
    }

    function makeMetricsHtml(shelves) {
        if (activeDepot === 'havuz') {
            const total = shelves.reduce((sum, shelf) => sum + shelf.items.length, 0);
            return `
                <span class="shelf-metric"><strong>Havuzdaki Ürün</strong><span>${total}</span></span>
                ${shelves.map(shelf => `<span class="shelf-metric shelf-metric-muted"><strong>${escapeHtml(shelf.code)}</strong><span>${shelf.items.length} ürün</span></span>`).join('')}
            `;
        }
        const physical = shelves.filter(shelf => !shelf.isUnassigned);
        const fullOrCritical = physical.filter(shelf => shelf.items.length / shelf.capacity >= 0.8).length;
        return `
            <span class="shelf-metric"><strong>Toplam Raf</strong><span>${physical.length}</span></span>
            <span class="shelf-metric"><strong>Dolu Raf</strong><span>${physical.filter(shelf => shelf.items.length > 0).length}</span></span>
            <span class="shelf-metric shelf-metric-alert"><strong>Kritik / Tam Dolu</strong><span>${fullOrCritical}</span></span>
            <span class="shelf-metric"><strong>Boş Raf</strong><span>${physical.filter(isEmptyShelf).length}</span></span>
            <span class="shelf-metric shelf-metric-lock"><strong>Sayımda</strong><span>${physical.filter(shelf => shelf.locked).length}</span></span>
            ${shelves.some(shelf => shelf.isUnassigned) ? `<span class="shelf-metric shelf-metric-muted"><strong>Rafı Tanımsız</strong><span>${shelves.find(shelf => shelf.isUnassigned).items.length} ürün</span></span>` : ''}
        `;
    }

    function makeShelfCard(shelf) {
        // Havuz görünümünde her kart KENDİ depo etiketini taşır (collectPoolShelves); normal b1/b2 görünümünde tüm
        // kartlar aktif depoyu paylaşır. Hiçbiri varsayılan olmasın diye önce shelf.depot denetlenir.
        const depotAttr = shelf.depot || activeDepot;
        const percent = shelf.capacity ? Math.round((shelf.items.length / shelf.capacity) * 100) : 0;
        const fill = shelf.capacity ? Math.min(percent, 100) : 0;
        const state = shelf.isUnassigned ? 'unassigned' : percent >= 100 ? 'full' : percent >= 80 ? 'critical' : 'normal';
        const slotMarksHtml = shelf.capacity
            ? Array.from({ length: Math.min(shelf.capacity, 20) }, (_, index) =>
                `<span class="shelf-slot ${index < shelf.items.length ? 'occupied' : ''}"></span>`
            ).join('')
            : '';
        const capacityControl = shelf.isUnassigned ? '' : `
            <button type="button" class="shelf-capacity-btn" data-action="capacity"
                data-depot="${escapeHtml(depotAttr)}" data-shelf="${escapeHtml(shelf.key)}"
                aria-label="${escapeHtml(shelf.code)} raf kapasitesini değiştir" title="Kapasiteyi düzenle">⚙️</button>`;
        // v3.6: sayım ve boş raf rozetleri (kartın üst satırında; gerekçe ipucu olarak).
        const badgesHtml = shelf.locked
            ? `<span class="shelf-card-badge shelf-card-badge-lock" title="${escapeHtml(`Sayım gerekçesi: ${shelf.doc.lockReason}`)}">🔒 Sayımda</span>`
            : (isEmptyShelf(shelf) ? '<span class="shelf-card-badge shelf-card-badge-empty">Boş raf</span>' : '');
        return `
            <article class="shelf-card shelf-card-${state}${shelf.locked ? ' shelf-card-locked' : ''}">
                ${capacityControl}
                <button type="button" class="shelf-card-open" data-action="inspect"
                    data-depot="${escapeHtml(depotAttr)}" data-shelf="${escapeHtml(shelf.key)}"
                    aria-label="${escapeHtml(shelf.code)} rafını incele${shelf.locked ? ' (sayımda)' : ''}">
                    <span class="shelf-card-heading">
                        <span class="shelf-card-code">${escapeHtml(shelf.code)}</span>
                        <span class="shelf-card-count">${shelf.items.length} ürün</span>
                    </span>
                    ${badgesHtml}
                    <span class="shelf-card-types">${escapeHtml(shelf.varieties)} ürün çeşidi${!shelf.isUnassigned && !shelf.registered
            ? ' · <span class="shelf-card-unregistered" title="Bu raf için WMS\'ten kapasite tanımlanmadı; zorunlu kapasite kuralı henüz uygulanmıyor (geçiş dönemi).">katalog dışı</span>' : ''}</span>
                    ${shelf.capacity ? `
                        <span class="shelf-progress" role="progressbar" aria-valuenow="${escapeHtml(fill)}" aria-valuemin="0" aria-valuemax="100">
                            <span style="width:${fill}%"></span>
                        </span>
                        <span class="shelf-capacity-label">${escapeHtml(shelf.items.length)}/${escapeHtml(shelf.capacity)} slot · %${escapeHtml(percent)}</span>
                        <span class="shelf-slots" aria-hidden="true">${slotMarksHtml}</span>
                    ` : `<span class="shelf-capacity-label">Stok dışı veya konumu tanımsız</span>`}
                    <span class="shelf-card-hint">Rafı incele <span aria-hidden="true">→</span></span>
                </button>
            </article>
        `;
    }

    function makeProductRow(item, index, depot, opts = {}) {
        const name = productName(item);
        const type = productType(item);
        const serial = firstValue(item.seriNo, item.serialNo, item.seri, item.sn);
        const barcode = firstValue(item.barkod, item.barcode, item.urunKodu, item.productCode);
        const quantity = productQuantity(item);
        const envanterNo = firstValue(item.envanterNo);
        const details = [type, envanterNo && `Envanter No: ${envanterNo}`, barcode && `Barkod/Kod: ${barcode}`, serial && `Seri No: ${serial}`]
            .filter(Boolean).join(' · ');
        // v3.6: sayımdaki raf (ya da bayraklı kayıt) taşınamaz; yerine adet düzeltmesi sunulur.
        const locked = opts.locked === true || schema().isRowCountLocked(item);
        const actionButton = locked ? `
                    <button type="button" class="shelf-product-move shelf-product-count" data-action="count-fix"
                        data-depot="${escapeHtml(depot)}" data-id="${escapeHtml(item.id)}"
                        aria-label="${escapeHtml(name)} ürününün sayılan adedini gir">Sayım düzelt</button>`
            : productIsInStock(item) ? `
                    <button type="button" class="shelf-product-move" data-action="move-product"
                        data-depot="${escapeHtml(depot)}" data-id="${escapeHtml(item.id)}"
                        aria-label="${escapeHtml(name)} ürününün rafını değiştir">Rafı değiştir</button>` : '';
        const muted = !productIsInStock(item);
        return `
            <li class="shelf-product-row${muted ? ' is-muted' : ''}">
                <span class="shelf-product-index">${index + 1}</span>
                <span class="shelf-product-info">
                    <strong>${escapeHtml(name)}</strong>
                    <small>${escapeHtml(details)}</small>
                </span>
                <span class="shelf-product-actions">
                    <span class="shelf-product-quantity">${escapeHtml(quantity)} <small>adet</small></span>
                    ${actionButton}
                </span>
            </li>
        `;
    }

    let openShelfState = null;   // { depot, shelfKey } — çekmece açıkken; canlı içerik yenilemesi bunu okur (bkz. P2-07)

    function closeDrawer() {
        if (!drawer) return;
        if (window.DialogStack) window.DialogStack.close(drawer.querySelector('.shelf-drawer'));
        drawer.classList.remove('is-open');
        drawer.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('shelf-drawer-open');
        openShelfState = null;
    }

    function ensureDrawer() {
        if (drawer) return;
        drawer = document.createElement('div');
        drawer.className = 'shelf-drawer-overlay';
        drawer.id = 'shelfDrawerOverlay';
        drawer.setAttribute('aria-hidden', 'true');
        drawer.innerHTML = `
            <aside class="shelf-drawer" role="dialog" aria-modal="true" aria-labelledby="shelfDrawerTitle">
                <header class="shelf-drawer-header">
                    <div class="shelf-drawer-heading">
                        <span class="shelf-drawer-mark" aria-hidden="true">⌖</span>
                        <div>
                            <small class="shelf-drawer-eyebrow">DEPO KONUMU · LIVE INVENTORY</small>
                            <span id="shelfDrawerDepot" class="shelf-drawer-depot"></span>
                            <h2 id="shelfDrawerTitle"></h2>
                        </div>
                    </div>
                    <button type="button" class="shelf-drawer-close" data-action="close" aria-label="Raf çekmecesini kapat">×</button>
                </header>
                <div class="shelf-drawer-summary" id="shelfDrawerSummary"></div>
                <p class="shelf-drawer-lock" id="shelfDrawerLock" role="status" hidden></p>
                <div class="shelf-drawer-actions" id="shelfDrawerActions" role="group" aria-label="Raf işlemleri"></div>
                <div class="shelf-drawer-list-header">
                    <div><small>STOCK POSITIONS</small><h3>Raf içeriği</h3></div>
                    <span id="shelfDrawerItemCount" class="shelf-drawer-item-count"></span>
                </div>
                <ul class="shelf-product-list" id="shelfDrawerProducts"></ul>
            </aside>`;
        document.body.append(drawer);
        drawer.addEventListener('click', event => {
            if (event.target === drawer || event.target.closest('[data-action="close"]')) closeDrawer();
            const moveButton = event.target.closest('[data-action="move-product"]');
            if (moveButton) moveProductToShelf(moveButton.dataset.depot, moveButton.dataset.id);
            // v3.6 · raf yönetimi ve sayım
            const action = event.target.closest('[data-shelf-action]');
            if (action) runShelfAction(action.dataset.shelfAction, action.dataset.depot, action.dataset.shelf);
            const countButton = event.target.closest('[data-action="count-fix"]');
            if (countButton) countFixDialog(countButton.dataset.depot, countButton.dataset.id);
        });
    }

    // v3.6: çekmecedeki raf işlemleri — rafın durumuna göre (katalog dışı / kilitsiz / sayımda) gösterilir.
    function drawerActionsHtml(depot, shelf) {
        if (shelf.isUnassigned) return '';
        const button = (action, label, variant = '') => `<button type="button" class="shelf-drawer-action ${escapeHtml(variant ? `shelf-drawer-action-${variant}` : '')}"
            data-shelf-action="${escapeHtml(action)}" data-depot="${escapeHtml(depot)}" data-shelf="${escapeHtml(shelf.key)}">${escapeHtml(label)}</button>`;
        if (!shelf.registered) {
            return `<span class="shelf-drawer-action-note">Bu raf katalogda yok; sayım ve raf yönetimi için önce kapasitesini tanımlayın.</span>
                ${button('capacity', '⚙️ Kataloğa ekle')}`;
        }
        if (shelf.locked) return [button('unlock', '✅ Sayımı bitir', 'primary'), button('capacity', '⚙️ Kapasite')].join('');
        return [
            button('lock', '🔒 Sayıma al', 'primary'),
            button('capacity', '⚙️ Kapasite'),
            button('rename', '✏️ Adı düzelt'),
            button('remove', '🗑️ Rafı kaldır', 'danger'),
        ].join('');
    }

    function runShelfAction(action, depot, shelfKey) {
        const shelf = collectShelves(depot).find(item => item.key === shelfKey);
        if (!shelf) { notify('Raf bulunamadı; liste güncellenmiş olabilir.', 'error'); return; }
        if (action === 'capacity') setCapacity(depot, shelf.code);
        else if (action === 'lock') lockShelfDialog(depot, shelf);
        else if (action === 'unlock') unlockShelf(depot, shelf);
        else if (action === 'rename') renameShelfDialog(depot, shelf);
        else if (action === 'remove') removeShelf(depot, shelf);
    }

    function notify(message, type) {
        if (typeof window.showAppAlert === 'function') window.showAppAlert(message, type);
    }

    // v3.3 Aşama 4 (P2-07): açılış ile canlı içerik yenilemesi ayrıldı. Önceden her veri güncellemesinde açık çekmece
    // openDrawer() ile YENİDEN AÇILIYORDU: innerHTML'in tamamı değişiyor (liste kaydırması/etkileşimi sıfırlanıyor) VE
    // kapatma düğmesine YENİDEN odaklanılıyordu — kullanıcı rafta bir satırla ilgileniyorsa odağı elinden alıyordu.
    // renderDrawerContent yalnız METNİ/listeyi günceller; is-open/aria-hidden/body sınıfı ve odak YALNIZ openDrawer'da.
    // @returns {boolean} raf bulunup içerik yazıldıysa true (bulunamazsa — ör. son ürün de ayrıldı — false, dokunulmaz).
    function renderDrawerContent(depot, shelfKey) {
        const shelf = collectShelves(depot).find(item => item.key === shelfKey);
        if (!shelf) return false;
        const depotName = depot === 'b1' ? 'B1 Sarf Deposu' : 'B2 Demirbaş Deposu';
        // v3.6: fiziksel rafta, rafa bağlı TÜM kayıtlar (adet 0 / pasif durumlu dahil) listelenir — sayımda hepsi sayılır.
        const rows = shelf.isUnassigned ? shelf.items
            : [...shelf.boundRows].sort((a, b) => Number(productIsInStock(b)) - Number(productIsInStock(a)));
        drawer.querySelector('#shelfDrawerDepot').textContent = depotName;
        drawer.querySelector('#shelfDrawerTitle').textContent = shelf.code;
        drawer.querySelector('#shelfDrawerSummary').textContent = shelf.isUnassigned
            ? `${shelf.items.length} stok dışı veya rafı tanımsız ürün`
            : `${shelf.items.length} / ${shelf.capacity} slot kullanılıyor · ${shelf.varieties} ürün çeşidi`;
        const lockNote = drawer.querySelector('#shelfDrawerLock');
        lockNote.hidden = !shelf.locked;
        lockNote.textContent = shelf.locked
            ? `🔒 Sayımda — ${shelf.doc.lockReason}. Bu raftaki ürünler depo listelerinde gizli; çıkış, zimmet, talep ve transfer yapılamaz. Sayılan adetleri "Sayım düzelt" ile girin, bitince "Sayımı bitir"e basın.`
            : '';
        const actions = drawer.querySelector('#shelfDrawerActions');
        actions.innerHTML = drawerActionsHtml(depot, shelf);
        actions.hidden = actions.innerHTML.trim() === '';
        drawer.querySelector('#shelfDrawerItemCount').textContent = `${rows.length} kalem`;
        drawer.querySelector('#shelfDrawerProducts').innerHTML = rows.length
            ? rows.map((item, index) => makeProductRow(item, index, depot, { locked: shelf.locked })).join('')
            : '<li class="shelf-empty">Bu rafta listelenecek ürün bulunmuyor.</li>';
        return true;
    }

    function openDrawer(depot, shelfKey) {
        ensureDrawer();
        if (!renderDrawerContent(depot, shelfKey)) return;
        openShelfState = { depot, shelfKey };
        drawer.classList.add('is-open');
        drawer.setAttribute('aria-hidden', 'false');
        document.body.classList.add('shelf-drawer-open');
        const closeButton = drawer.querySelector('.shelf-drawer-close');
        // v3.3 Aşama 5 (P2-08): Escape/Tab artık DialogStack'e devredilir — bu çekmece üstünde bir diyalog (kapasite/
        // raf taşıma) açılırsa Escape YALNIZ o diyaloğu kapatır, çekmeceyi değil; DialogStack yoksa eski davranışa düşülür.
        if (window.DialogStack) window.DialogStack.open(drawer.querySelector('.shelf-drawer'), { onEscape: closeDrawer, initialFocus: closeButton });
        else closeButton.focus();
    }

    // Çekmece zaten açıksa içeriğini sessizce tazeler (odak/görünürlük değişmez); kapalıysa hiçbir şey yapmaz.
    function refreshDrawerIfOpen() {
        if (!openShelfState || !drawer || !drawer.classList.contains('is-open')) return;
        renderDrawerContent(openShelfState.depot, openShelfState.shelfKey);
    }

    function render() {
        const grid = document.getElementById('shelfMatrixGrid');
        const metrics = document.getElementById('shelfMatrixMetrics');
        if (!grid || !metrics) return;
        try {
            const allShelves = activeDepot === 'havuz' ? collectPoolShelves() : collectShelves(activeDepot);
            metrics.innerHTML = makeMetricsHtml(allShelves);
            const visible = sortShelves(allShelves.filter(shelf => matchesFilter(shelf) && matchesQuery(shelf)));
            const emptyText = shelfFilter === 'empty' ? 'Bu depoda boş raf yok.'
                : shelfFilter === 'locked' ? 'Bu depoda sayımda olan raf yok.'
                    : 'Aramanızla eşleşen raf veya ürün bulunamadı.';
            grid.innerHTML = visible.length
                ? visible.map(makeShelfCard).join('')
                : `<div class="shelf-empty">${escapeHtml(emptyText)}</div>`;
        } catch (error) {
            console.error('[ShelfMatrix] Raf haritası çizilemedi:', error);
            grid.innerHTML = '<div class="shelf-empty shelf-error">Raf haritası yüklenemedi. Geliştirici konsolunu kontrol edin.</div>';
        }
    }

    function createDialog(eyebrow, titleText, descriptionText, submitText) {
        const overlay = document.createElement('div');
        overlay.className = 'shelf-dialog-overlay';
        overlay.innerHTML = `
            <section class="shelf-dialog" role="dialog" aria-modal="true" aria-labelledby="shelfDialogTitle">
                <header class="shelf-dialog-header">
                    <small class="shelf-dialog-eyebrow"></small>
                    <button type="button" class="shelf-dialog-close" data-dialog-close aria-label="Pencereyi kapat">×</button>
                </header>
                <h2 id="shelfDialogTitle"></h2>
                <p class="shelf-dialog-description"></p>
                <form class="shelf-dialog-form">
                    <div class="shelf-dialog-fields"></div>
                    <p class="shelf-dialog-error" role="alert" hidden></p>
                    <footer class="shelf-dialog-actions">
                        <button type="button" class="shelf-dialog-cancel" data-dialog-close>Vazgeç</button>
                        <button type="submit" class="shelf-dialog-submit"></button>
                    </footer>
                </form>
            </section>`;
        overlay.querySelector('.shelf-dialog-eyebrow').textContent = eyebrow;
        overlay.querySelector('#shelfDialogTitle').textContent = titleText;
        overlay.querySelector('.shelf-dialog-description').textContent = descriptionText;
        overlay.querySelector('.shelf-dialog-submit').textContent = submitText;
        document.body.append(overlay);
        document.body.classList.add('shelf-dialog-open');

        // v3.3 Aşama 5 (P2-08): Escape ve Tab artık bu dosyanın KENDİ document-level dinleyicisi yerine paylaşılan
        // DialogStack'e devredilir — WMS çekmecesi açıkken bu diyalog üstünde açılırsa Escape YALNIZ diyaloğu kapatır
        // (çekmeceyi değil); Tab odağı diyalog dışına çıkarmaz, kapanışta odak açılıştaki elemana döner.
        const section = overlay.querySelector('.shelf-dialog');
        let settle;
        const result = new Promise(resolve => { settle = resolve; });
        const finish = value => {
            if (window.DialogStack) window.DialogStack.close(section);
            overlay.remove();
            document.body.classList.remove('shelf-dialog-open');
            settle(value);
        };
        overlay.addEventListener('click', event => {
            if (event.target === overlay || event.target.closest('[data-dialog-close]')) finish(null);
        });
        if (window.DialogStack) window.DialogStack.open(section, { onEscape: () => finish(null) });

        return {
            overlay,
            fields: overlay.querySelector('.shelf-dialog-fields'),
            error: overlay.querySelector('.shelf-dialog-error'),
            form: overlay.querySelector('.shelf-dialog-form'),
            finish,
            result
        };
    }

    function setCapacity(depot, shelf) {
        const current = capacityFor(depot, shelf);
        const dialog = createDialog('RAF AYARI', shelf, 'Bu raf için ürün slotu kapasitesini belirleyin.', 'Kapasiteyi kaydet');
        const label = document.createElement('label');
        label.className = 'shelf-dialog-label';
        label.htmlFor = 'shelfCapacityInput';
        label.textContent = 'Maksimum slot sayısı';
        const input = document.createElement('input');
        input.id = 'shelfCapacityInput';
        input.type = 'number';
        input.min = '1';
        input.max = String(window.ShelfCapacity.MAX_CAPACITY);
        input.step = '1';
        input.value = String(current);
        input.required = true;
        dialog.fields.append(label, input);
        input.focus();
        input.select();

        // v3.3 Aşama 2 (P1-02): kapasite ortak raf kataloğuna (Firestore) transaction ile yazılır; localStorage'a yazılmaz.
        //                      Kapasite güncel kullanımın altına indirilemez (servis + firestore.rules).
        let saving = false;
        dialog.form.addEventListener('submit', async event => {
            event.preventDefault();
            if (saving) return;
            const capacity = Number(input.value);
            if (!Number.isInteger(capacity) || capacity < 1 || capacity > window.ShelfCapacity.MAX_CAPACITY) {
                dialog.error.textContent = `1 ile ${window.ShelfCapacity.MAX_CAPACITY} arasında bir tam sayı girin.`;
                dialog.error.hidden = false;
                input.focus();
                return;
            }
            if (typeof window.saveShelfCapacity !== 'function') {
                dialog.error.textContent = 'Raf kataloğu servisi yüklenmemiş; kapasite kaydedilmedi.';
                dialog.error.hidden = false;
                return;
            }
            saving = true;
            try {
                await window.saveShelfCapacity(depot, shelf, capacity);
            } catch (error) {
                dialog.error.textContent = `Kapasite kaydedilmedi: ${error && error.message ? error.message : 'bilinmeyen hata'}`;
                dialog.error.hidden = false;
                return;
            } finally {
                saving = false;
            }
            dialog.finish(capacity);
        });
        dialog.result.then(result => { if (result !== null) render(); });
    }

    function moveProductToShelf(depot, itemId) {
        if (typeof window.requireDbAdmin === 'function' && !window.requireDbAdmin('Ürün raf konumu değiştirme')) return;
        const item = valuesOf(window.data && window.data[depot]).find(product => product && String(product.id) === String(itemId));
        if (!item) {
            if (typeof window.showAppAlert === 'function') window.showAppAlert('Ürün bulunamadı; raf içeriği güncellenmiş olabilir.', 'error');
            return;
        }
        if (item.id == null || item.id === '') {
            if (typeof window.showAppAlert === 'function') window.showAppAlert('Ürünün kayıt kimliği yok; raf konumu güvenle güncellenemedi.', 'error');
            return;
        }

        // v3.3 Aşama 4: aday raf listesi kanonik kodla kurulur — INV_CONFIG'in ham yazımları (ör. "Raf-A 1") da
        // normShelfCode'tan geçirilir; aksi halde aynı raf "RAF-A 1" (katalog/stoktan) ve "Raf-A 1" (INV_CONFIG'ten)
        // olmak üzere İKİ AYRI seçenek gibi görünürdü.
        const currentShelf = productShelfCode(item);
        const candidateNames = new Set(collectShelves(depot).filter(shelf => !shelf.isUnassigned).map(shelf => shelf.code));
        const configured = typeof INV_CONFIG !== 'undefined' ? (INV_CONFIG.locations?.[depot]?.shelves || []) : [];
        configured.forEach(shelf => { const code = schema().normShelfCode(shelf); if (code) candidateNames.add(code); });
        if (currentShelf) candidateNames.add(currentShelf);
        const names = Array.from(candidateNames).sort((a, b) => a.localeCompare(b, 'tr', { numeric: true, sensitivity: 'base' }));
        const dialog = createDialog('HIZLI KONUM GÜNCELLEME', productName(item), 'Dolu raflar seçilemez. Kaydetmeden önce hedef raf kapasitesi tekrar denetlenir.', 'Rafı güncelle');
        const label = document.createElement('label');
        label.className = 'shelf-dialog-label';
        label.htmlFor = 'shelfMoveTarget';
        label.textContent = 'Hedef raf';
        const select = document.createElement('select');
        select.id = 'shelfMoveTarget';
        select.required = true;
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'Müsait raf seçin…';
        select.append(placeholder);

        let availableCount = 0;
        const lockedCodes = new Set(catalogShelvesFor(depot).filter(s => schema().isShelfCountLocked(s)).map(s => s.code));
        names.forEach(name => {
            const stats = window.ShelfCapacity.slotStats(depot, name);
            const option = document.createElement('option');
            option.value = name;
            option.disabled = name === currentShelf || stats.available < 1 || lockedCodes.has(name);
            option.textContent = lockedCodes.has(name)
                ? `${name} · sayımda`
                : `${name} · ${stats.used}/${stats.capacity} slot · ${stats.available} boş`;
            if (!option.disabled) availableCount += 1;
            select.append(option);
        });
        dialog.fields.append(label, select);
        if (!availableCount) {
            dialog.error.textContent = 'Bu depoda müsait hedef raf yok. Kapasitesi dolu raflardan kapasiteyi artırabilir veya önce başka bir ürünü taşıyabilirsiniz.';
            dialog.error.hidden = false;
        }
        select.focus();

        // v3.3 Aşama 4 (P1-02 devamı): raf taşıma artık stock-ledger'ın transaction'lı yoluyla (runStockTransferTransaction,
        // aynı depoda tam taşıma — planTransfer'ın "fullMove && sameCol" kolu: kimlik korunur, yalnız raf/sütun güncellenir).
        // Hedef raf kapasitesi burada TEKRAR değil, yalnız TRANSACTION İÇİNDE taze okunup denetlenir (iki admin aynı anda
        // son boş slotu seçerse yalnız biri kazanır). Çift gönderim kilidi: setCapacity ile aynı desen.
        let saving = false;
        const operationId = window.StockLedger ? window.StockLedger.newOperationId() : null;
        dialog.form.addEventListener('submit', async event => {
            event.preventDefault();
            if (saving) return;
            const targetShelf = select.value;
            if (!targetShelf) {
                dialog.error.textContent = 'Lütfen müsait bir hedef raf seçin.';
                dialog.error.hidden = false;
                return;
            }
            if (typeof window.runStockTransferTransaction !== 'function' || !operationId) {
                dialog.error.textContent = 'Stok defteri servisi yüklenemedi; raf konumu güvenle güncellenemedi.';
                dialog.error.hidden = false;
                return;
            }
            saving = true;
            let res;
            try {
                res = await window.runStockTransferTransaction({
                    operationId, sourceCol: depot, sourceId: item.id, targetCol: depot,
                    qty: productQuantity(item), targetShelf, targetColumn: item.sütun ?? item.sutun ?? '',
                });
            } catch (error) {
                console.error('[ShelfMatrix] Raf konumu güncellenemedi:', error);
                dialog.error.textContent = error.message || 'Raf konumu kaydedilemedi. Yetkinizi ve bağlantınızı kontrol edin.';
                dialog.error.hidden = false;
                return;
            } finally {
                saving = false;
            }
            dialog.finish(targetShelf);
            if (typeof window.showAppAlert === 'function') {
                window.showAppAlert(res.duplicate
                    ? 'Bu taşıma daha önce tamamlanmıştı; konum ikinci kez değiştirilmedi.'
                    : `${productName(item)} ürünü ${targetShelf} rafına taşındı.`, res.duplicate ? 'info' : 'success');
            }
            render();
            openDrawer(depot, targetShelf);
        });
        dialog.result.then(() => {});
    }

    // ─── v3.6 · Raf yönetimi ve sayım diyalogları ─────────────────────────────────────────────────────────────────────
    // Her işlem servis katmanına gider (window.createShelf / setShelfCountLock / renameShelf / deleteShelf / runProductSave);
    // kurallar ve denetim kaydı orada. Burada yalnız giriş, nedenli ön uyarı ve sonuç bildirimi.
    function addField(dialog, { id, label, element }) {
        const lab = document.createElement('label');
        lab.className = 'shelf-dialog-label';
        lab.htmlFor = id;
        lab.textContent = label;
        element.id = id;
        dialog.fields.append(lab, element);
        return element;
    }
    function showDialogError(dialog, message, focusEl) {
        dialog.error.textContent = message;
        dialog.error.hidden = false;
        if (focusEl) focusEl.focus();
    }
    function guardedSubmit(dialog, handler) {
        let busy = false;
        const submit = dialog.form.querySelector('.shelf-dialog-submit');
        dialog.form.addEventListener('submit', async event => {
            event.preventDefault();
            if (busy) return;
            busy = true;
            submit.disabled = true;
            dialog.error.hidden = true;
            try { await handler(); }
            catch (error) { showDialogError(dialog, error && error.message ? error.message : 'İşlem tamamlanamadı.'); }
            finally { busy = false; submit.disabled = false; }
        });
    }
    function serviceOr(dialog, name) {
        if (typeof window[name] === 'function') return true;
        showDialogError(dialog, 'Raf servisi yüklenmemiş; işlem yapılmadı.');
        return false;
    }

    function addShelfDialog() {
        if (typeof window.requireDbAdmin === 'function' && !window.requireDbAdmin('Raf ekleme')) return;
        const dialog = createDialog('RAF YÖNETİMİ', 'Yeni raf ekle', 'Raf kataloğa eklenir; ürün yerleştirme ve sayım bu kayıt üzerinden yapılır. Kod büyük harfe çevrilir.', 'Rafı ekle');
        const depot = document.createElement('select');
        [['b1', 'B1 Sarf Deposu'], ['b2', 'B2 Demirbaş Deposu']].forEach(([value, text]) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = text;
            depot.append(option);
        });
        depot.value = activeDepot === 'b2' ? 'b2' : 'b1';
        addField(dialog, { id: 'shelfAddDepot', label: 'Depo', element: depot });
        const code = document.createElement('input');
        code.type = 'text';
        code.maxLength = schema().SHELF_CODE_MAX_LENGTH;
        code.required = true;
        code.placeholder = 'ör. RAF-A 7';
        code.autocomplete = 'off';
        addField(dialog, { id: 'shelfAddCode', label: 'Raf kodu', element: code });
        const preview = document.createElement('small');
        preview.className = 'shelf-dialog-hint';
        dialog.fields.append(preview);
        code.addEventListener('input', () => { preview.textContent = code.value.trim() ? `Kayıt kodu: ${schema().normShelfCode(code.value)}` : ''; });
        const capacity = document.createElement('input');
        capacity.type = 'number';
        capacity.min = '1';
        capacity.max = String(schema().SHELF_MAX_CAPACITY);
        capacity.step = '1';
        capacity.value = String(DEFAULT_CAPACITY);
        capacity.required = true;
        addField(dialog, { id: 'shelfAddCapacity', label: 'Kapasite (ürün slotu)', element: capacity });
        code.focus();
        guardedSubmit(dialog, async () => {
            if (!serviceOr(dialog, 'createShelf')) return;
            const result = await window.createShelf(depot.value, code.value, Number(capacity.value));
            dialog.finish(result);
            notify(`${result.code} rafı ${result.depot.toUpperCase()} kataloğuna eklendi.`, 'success');
            render();
        });
    }

    function lockShelfDialog(depot, shelf) {
        if (typeof window.requireDbAdmin === 'function' && !window.requireDbAdmin('Raf sayımı')) return;
        const dialog = createDialog('SAYIM', `${shelf.code} rafını sayıma al`,
            'Sayımdaki raftaki ürünler B1/B2 listelerinde gizlenir; çıkış, zimmet, talep ve transfer yapılamaz. Sayılan adetleri bu panelden girersiniz.',
            'Sayıma al');
        const reason = document.createElement('textarea');
        reason.rows = 3;
        reason.maxLength = schema().SHELF_LOCK_REASON_MAX;
        reason.required = true;
        reason.placeholder = 'ör. Yıl sonu sayımı';
        addField(dialog, { id: 'shelfLockReason', label: 'Sayım gerekçesi (zorunlu)', element: reason });
        reason.focus();
        guardedSubmit(dialog, async () => {
            if (!reason.value.trim()) { showDialogError(dialog, 'Sayım gerekçesini yazın.', reason); return; }
            if (!serviceOr(dialog, 'setShelfCountLock')) return;
            const result = await window.setShelfCountLock(depot, shelf.code, { locked: true, reason: reason.value });
            dialog.finish(result);
            notify(`${shelf.code} rafı sayıma alındı; ${result.rowsChanged} kayıt depo listelerinden gizlendi.`, 'success');
            render();
            refreshDrawerIfOpen();
        });
    }

    // Çekmece üstünde onay: ortak onay kutusu (#customAlertOverlay, z-index 9999) çekmecenin (13000) ARKASINDA kalırdı;
    // WMS'in kendi diyaloğu (14000, DialogStack) kullanılır. Dönüş: onaylandıysa true.
    async function confirmInDrawer(eyebrow, title, message, confirmText, { danger = false } = {}) {
        const dialog = createDialog(eyebrow, title, message, confirmText);
        if (danger) dialog.form.querySelector('.shelf-dialog-submit').classList.add('is-danger');
        dialog.form.addEventListener('submit', event => { event.preventDefault(); dialog.finish(true); });
        dialog.form.querySelector('.shelf-dialog-submit').focus();
        return (await dialog.result) === true;
    }

    async function unlockShelf(depot, shelf) {
        if (typeof window.requireDbAdmin === 'function' && !window.requireDbAdmin('Raf sayımı')) return;
        const question = `${shelf.code} rafındaki ${shelf.boundRows.length} kayıt yeniden depo listelerinde görünecek ve hareket edebilecek.`;
        const ok = await confirmInDrawer('SAYIM', 'Sayım bitirilsin mi?', question, 'Sayımı bitir');
        if (!ok) return;
        try {
            const result = await window.setShelfCountLock(depot, shelf.code, { locked: false });
            notify(`${shelf.code} rafının sayımı bitti; ${result.rowsChanged} kayıt listelere döndü.`, 'success');
        } catch (error) {
            notify(`Sayım bitirilemedi: ${error.message || 'bilinmeyen hata'}`, 'error');
        }
        render();
        refreshDrawerIfOpen();
    }

    function renameShelfDialog(depot, shelf) {
        if (typeof window.requireDbAdmin === 'function' && !window.requireDbAdmin('Raf adı düzeltme')) return;
        if (shelf.boundRows.length) {
            notify(`${shelf.code} rafına bağlı ${shelf.boundRows.length} ürün kaydı var; ad yalnız boş rafta düzeltilebilir. Önce ürünleri taşıyın.`, 'warning');
            return;
        }
        const dialog = createDialog('RAF YÖNETİMİ', `${shelf.code} rafının adını düzelt`, 'Kapasite ve durum korunur; eski ad → yeni ad denetim kaydına yazılır.', 'Adı kaydet');
        const code = document.createElement('input');
        code.type = 'text';
        code.maxLength = schema().SHELF_CODE_MAX_LENGTH;
        code.required = true;
        code.value = shelf.code;
        code.autocomplete = 'off';
        addField(dialog, { id: 'shelfRenameCode', label: 'Yeni raf kodu', element: code });
        code.focus();
        code.select();
        guardedSubmit(dialog, async () => {
            if (!serviceOr(dialog, 'renameShelf')) return;
            const result = await window.renameShelf(depot, shelf.code, code.value);
            dialog.finish(result);
            closeDrawer();
            notify(`Raf adı ${shelf.code} → ${result.code} olarak düzeltildi.`, 'success');
            render();
        });
    }

    async function removeShelf(depot, shelf) {
        if (typeof window.requireDbAdmin === 'function' && !window.requireDbAdmin('Raf kaldırma')) return;
        const stocked = shelf.boundRows.filter(row => schema().hasPhysicalStock(row)).length;
        if (stocked) {
            notify(`${shelf.code} rafında stokta ${stocked} ürün kaydı var; raf kaldırılmadan önce ürünleri başka rafa taşıyın.`, 'warning');
            return;
        }
        const zero = shelf.boundRows.length;
        const question = `${shelf.code} rafı katalogdan kaldırılacak.${zero ? ` Rafa bağlı ${zero} tükenmiş kayıt Havuz'a (rafsız) alınacak.` : ''}`;
        const ok = await confirmInDrawer('RAF YÖNETİMİ', 'Raf kaldırılsın mı?', question, 'Rafı kaldır', { danger: true });
        if (!ok) return;
        if (typeof window.deleteShelf !== 'function') { notify('Raf servisi yüklenmemiş; raf kaldırılmadı.', 'error'); return; }
        try {
            const result = await window.deleteShelf(depot, shelf.code);
            closeDrawer();
            notify(`${shelf.code} rafı kaldırıldı.${result.movedToPool ? ` ${result.movedToPool} kayıt Havuz'a alındı.` : ''}`, 'success');
        } catch (error) {
            notify(`Raf kaldırılamadı: ${error.message || 'bilinmeyen hata'}`, 'error');
        }
        render();
    }

    function countFixDialog(depot, itemId) {
        if (typeof window.requireDbAdmin === 'function' && !window.requireDbAdmin('Sayım düzeltmesi')) return;
        const item = valuesOf(window.data && window.data[depot]).find(row => row && String(row.id) === String(itemId));
        if (!item) { notify('Ürün bulunamadı; raf içeriği güncellenmiş olabilir.', 'error'); return; }
        const before = Math.trunc(productQuantity(item));
        const dialog = createDialog('SAYIM DÜZELTMESİ', productName(item),
            `Sistemdeki adet: ${before}. Rafta saydığınız adedi girin; fark denetim kaydına yazılır.`, 'Adedi kaydet');
        const qty = document.createElement('input');
        qty.type = 'number';
        qty.min = '0';
        qty.step = '1';
        qty.inputMode = 'numeric';
        qty.required = true;
        qty.value = String(before);
        addField(dialog, { id: 'shelfCountQty', label: 'Sayılan adet', element: qty });
        const note = document.createElement('input');
        note.type = 'text';
        note.maxLength = 200;
        note.placeholder = 'ör. 2 adet eksik bulundu';
        addField(dialog, { id: 'shelfCountNote', label: 'Not (isteğe bağlı)', element: note });
        qty.focus();
        qty.select();
        guardedSubmit(dialog, async () => {
            const after = Number(qty.value);
            if (!Number.isInteger(after) || after < 0) { showDialogError(dialog, '0 veya daha büyük bir tam sayı girin.', qty); return; }
            if (after === before) { dialog.finish(null); return; }
            if (!serviceOr(dialog, 'runProductSave') || typeof window.computeStockPatch !== 'function') return;
            // Durum (Tükendi ↔ önceki durum) stok hareketleriyle aynı kuraldan hesaplanır; eski 'qty' alanına yazılmaz.
            const { patch } = window.computeStockPatch(depot, item, after - before);
            const fields = { adet: after, lastUpdate: Date.now() };
            ['durumu', 'status', 'stokOncekiDurum'].forEach(key => { if (patch[key] !== undefined) fields[key] = patch[key]; });
            await window.runProductSave({
                col: depot, id: item.id, isNew: false, fields,
                audit: { type: 'sayim-duzeltme', reason: note.value.trim() || 'Sayım düzeltmesi' },
            });
            dialog.finish(after);
            notify(`${productName(item)}: ${before} → ${after} adet olarak kaydedildi.`, 'success');
            render();
            refreshDrawerIfOpen();
        });
    }

    // ─── v3.3 Aşama 6 (Veri Geçişi) — "Sistem Raf Sayaçlarını Eşitle (Sync)" ────────────────────────────────────────
    // [WHY]: P1-02 (Aşama 2/4) yalnız kendinden SONRAKİ yazmalarda usedSlots'u doğru tutar; bu, ondan ÖNCEKİ kaymayı
    //        (ve kataloğa sonradan eklenen eski rafları) kapatan TEK SEFERLİK, geçici bir göç aracıdır.
    // [HOW]: window.syncShelfCounters() (firebase-handler.js) sunucudan taze b1/b2/shelves okuyup
    //        StockLedger.planShelfSync ile uzlaştırır; hiçbir raf diğerini engellemez ("hepsi ya da hiçbiri" değildir).
    //        Sonuç bu dosyanın KENDİ diyalog altyapısıyla (createDialog + DialogStack) özetlenir.
    function renderSyncResultHtml(result) {
        const rows = [];
        rows.push(`<p>${escapeHtml(result.updated.length)} raf sayacı güncellendi · ${escapeHtml(result.unchanged)} raf zaten doğruydu.</p>`);
        if (result.capacityRaised.length) {
            rows.push(`<p class="shelf-sync-warning">⚠️ ${escapeHtml(result.capacityRaised.length)} rafta gerçek doluluk kayıtlı kapasiteyi aşıyordu; kapasite otomatik olarak gerçek sayıma yükseltildi. İnceleyin:</p>`);
            rows.push('<ul class="shelf-sync-list">' + result.capacityRaised.map(r =>
                `<li>${escapeHtml(r.depot.toUpperCase())} / <strong>${escapeHtml(r.code)}</strong>: kapasite ${escapeHtml(r.capacityBefore)}→${escapeHtml(r.after)}, doluluk ${escapeHtml(r.before)}→${escapeHtml(r.after)}</li>`
            ).join('') + '</ul>');
        }
        if (result.unregistered.length) {
            rows.push(`<p class="shelf-sync-warning">⚠️ ${escapeHtml(result.unregistered.length)} raf kodu kataloğa KAYITLI DEĞİL (ürünleri var ama WMS'ten kapasite tanımlanmamış):</p>`);
            rows.push('<ul class="shelf-sync-list">' + result.unregistered.map(r =>
                `<li>${escapeHtml(r.depot.toUpperCase())} / <strong>${escapeHtml(r.code)}</strong>: ${escapeHtml(r.count)} ürün</li>`
            ).join('') + '</ul>');
        }
        rows.push(`<p>Havuzda (rafsız) <strong>${escapeHtml(result.pool.total)}</strong> ürün var (B1: ${escapeHtml(result.pool.b1)} · B2: ${escapeHtml(result.pool.b2)}) — "Havuz" sekmesinden atayabilirsiniz.</p>`);
        const lockFixed = Array.isArray(result.lockFixed) ? result.lockFixed.length : 0;
        rows.push(`<p>Sayım işareti raf durumuna göre düzeltilen kayıt: <strong>${escapeHtml(lockFixed)}</strong>.</p>`);
        return rows.join('');
    }

    function showSyncResultDialog(result) {
        const dialog = createDialog('GÖÇ ARACI · SONUÇ', 'Raf Sayaçları Eşitlendi', '', 'Tamam');
        dialog.fields.innerHTML = renderSyncResultHtml(result);
        dialog.form.addEventListener('submit', event => { event.preventDefault(); dialog.finish(true); });
        dialog.result.then(() => {});
    }

    async function syncShelfCountersAction() {
        if (typeof window.requireDbAdmin === 'function' && !window.requireDbAdmin('Raf sayaçlarını eşitleme')) return;
        const button = document.getElementById('shelfMatrixSyncBtn');
        const question = 'B1 ve B2\'deki TÜM stok taranacak, raf doluluk sayaçları (usedSlots) gerçek veriyle eşitlenecek. '
            + 'Ürünlerdeki sayım işareti de rafın sayım durumuna göre düzeltilir; başka ürün verisine dokunulmaz. Devam edilsin mi?';
        const confirmed = typeof window.showCustomConfirm === 'function'
            ? await window.showCustomConfirm('Raf Sayaçlarını Eşitle', question, { confirmText: 'Eşitle' })
            : window.confirm(question);
        if (confirmed !== true) return;
        if (typeof window.syncShelfCounters !== 'function') {
            if (typeof window.showAppAlert === 'function') window.showAppAlert('Stok defteri servisi yüklenemedi; eşitleme yapılamadı.', 'error');
            return;
        }
        const originalLabel = button ? button.textContent : '';
        if (button) { button.disabled = true; button.textContent = '⏳ Eşitleniyor…'; }
        try {
            const result = await window.syncShelfCounters();
            showSyncResultDialog(result);
            render();
        } catch (error) {
            console.error('[ShelfMatrix] Raf sayaçları eşitlenemedi:', error);
            if (typeof window.showAppAlert === 'function') window.showAppAlert(`Raf sayaçları eşitlenemedi: ${error.message || 'bilinmeyen hata'}`, 'error');
        } finally {
            if (button) { button.disabled = false; button.textContent = originalLabel; }
        }
    }

    function bindUI() {
        const app = document.getElementById('shelfMatrixApp');
        if (!app) return;
        app.addEventListener('click', event => {
            if (event.target.closest('#shelfMatrixSyncBtn')) { syncShelfCountersAction(); return; }
            if (event.target.closest('#shelfAddBtn')) { addShelfDialog(); return; }
            const filterButton = event.target.closest('[data-shelf-filter]');
            if (filterButton) {
                shelfFilter = ['all', 'empty', 'locked'].includes(filterButton.dataset.shelfFilter) ? filterButton.dataset.shelfFilter : 'all';
                app.querySelectorAll('[data-shelf-filter]').forEach(button =>
                    button.setAttribute('aria-pressed', String(button.dataset.shelfFilter === shelfFilter)));
                render();
                return;
            }
            const depotButton = event.target.closest('[data-depot].shelf-depot-btn');
            if (depotButton) {
                // v3.3 Aşama 6: 'havuz' üçüncü bir SEKME'dir (gerçek depo değil) — collectPoolShelves kullanılır.
                activeDepot = ['b1', 'b2', 'havuz'].includes(depotButton.dataset.depot) ? depotButton.dataset.depot : 'b1';
                app.querySelectorAll('.shelf-depot-btn').forEach(button =>
                    button.classList.toggle('active', button.dataset.depot === activeDepot)
                );
                render();
                return;
            }
            const action = event.target.closest('[data-action]');
            if (!action) return;
            if (action.dataset.action === 'inspect') openDrawer(action.dataset.depot, action.dataset.shelf);
            if (action.dataset.action === 'capacity') setCapacity(action.dataset.depot, action.dataset.shelf);
        });
        document.getElementById('shelfMatrixSearch').addEventListener('input', event => {
            searchQuery = event.target.value.trim();
            render();
        });
        document.getElementById('shelfMatrixSort').addEventListener('change', event => {
            sortMode = event.target.value;
            render();
        });
        document.getElementById('nav-shelfMatrix').addEventListener('click', () => {
            window.setTimeout(render, 0);
        });
        // v3.3 Aşama 5 (P2-08): Escape artık DialogStack üzerinden, yalnız çekmece/diyalog AÇIKKEN ve yalnız EN
        // ÜSTTEKİ için çalışır (bkz. openDrawer/createDialog); burada ayrı bir document-level dinleyici tutulmaz.
        window.addEventListener('onInventoryDataUpdated', event => {
            const collection = event && event.detail && (event.detail.collection || event.detail.repo);
            const inventoryChanged = !collection || collection === 'b1' || collection === 'b2';
            const catalogChanged = collection === 'shelves';   // ortak kapasite/sayaç değişti
            const matrixVisible = document.getElementById('shelfMatrixTab').style.display !== 'none';
            if ((inventoryChanged || catalogChanged) && matrixVisible) render();
            // P2-07: çekmece kapanmaz/yeniden açılmaz — içeriği sessizce tazelenir (odak ve kaydırma konumu korunur).
            if (inventoryChanged || catalogChanged) refreshDrawerIfOpen();
        });
    }

    function init() {
        bindUI();
    }

    window.ShelfMatrix = { render, openDrawer, closeDrawer };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();
