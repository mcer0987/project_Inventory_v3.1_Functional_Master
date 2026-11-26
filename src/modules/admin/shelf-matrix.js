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
        if (shelf.locked) {
            return [
                button('count-desk', '📋 Fark Masası', 'primary'),
                button('unlock', '✅ Sayımı bitir'),
                button('capacity', '⚙️ Kapasite'),
            ].join('');
        }
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
        else if (action === 'count-desk') openCountDeskModal(depot, [shelf.code]);
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
            updateCountToolbar(activeDepot, allShelves);
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
    function guardedSubmit(dialog, handler, opts = {}) {
        let busy = false;
        const submit = dialog.form.querySelector('.shelf-dialog-submit');
        const cancel = dialog.form.querySelector('.shelf-dialog-cancel');
        const closeBtn = dialog.dialog?.querySelector('.shelf-dialog-close');
        const baseLabel = submit ? submit.textContent : '';
        const setBusy = flag => {
            busy = flag;
            if (submit) {
                submit.disabled = flag;
                submit.classList.toggle('is-busy', flag);
                if (flag && opts.busyText) submit.textContent = opts.busyText;
                else if (!flag) submit.textContent = baseLabel;
            }
            if (cancel) cancel.disabled = flag;
            if (closeBtn) closeBtn.disabled = flag;
        };
        dialog.setProgress = text => { if (submit && busy && text) submit.textContent = text; };
        dialog.form.addEventListener('submit', async event => {
            event.preventDefault();
            if (busy) return;
            setBusy(true);
            dialog.error.hidden = true;
            try { await handler(); }
            catch (error) { showDialogError(dialog, error && error.message ? error.message : 'İşlem tamamlanamadı.'); }
            finally { setBusy(false); }
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

    // ─── v3.7 · İP-10: Toplu Depo / Çoklu Raf Sayımı & Canlı Eksik/Fazla Fark Masası ─────────────────────────────────
    // [WHY]: Yönetici tek tek raf çekmecesi açmadan birden fazla rafı veya tüm B1/B2 deposunu sayıma alabilmeli,
    //        eksik/fazla farkları tek masada görüp onaylayarak stoğa işleyebilmeli ve resmi PDF/Excel tutanağı alabilmelidir.
    // [HOW]: Hesaplama ve rapor projeksiyonu saf ShelfCount modülünden (src/utils/shelf-count-session.js), yazmalar ise
    //        window.setBatchShelfCountLock ve window.applyCountFixes servislerinden akar; DOM saf createElement ile kurulur.
    const countDrafts = { b1: new Map(), b2: new Map() };
    let activeCountDeskRefresh = null;

    function shelfCountApi() {
        const mod = window.AppModules && window.AppModules.ShelfCount;
        if (!mod || typeof mod.buildCountRows !== 'function') {
            throw new Error('Sayım fark motoru (shelf-count-session.js) yüklenmemiş.');
        }
        return mod;
    }

    function updateCountToolbar(depot, allShelves) {
        const batchBtn = document.getElementById('shelfBatchCountBtn');
        const deskBtn = document.getElementById('shelfCountDeskBtn');
        const badge = document.getElementById('shelfCountDeskBadge');
        if (!batchBtn || !deskBtn) return;
        const isRealDepot = depot === 'b1' || depot === 'b2';
        batchBtn.hidden = !isRealDepot;
        if (!isRealDepot) {
            deskBtn.hidden = true;
            return;
        }
        const lockedCount = (allShelves || []).filter(s => !s.isUnassigned && s.locked).length;
        deskBtn.hidden = lockedCount === 0;
        if (badge) badge.textContent = String(lockedCount);
    }

    // [WHY]: Tek raf, seçili raflar veya tüm B1/B2 deposunu tek akışta sayım kilidine alır.
    // [HOW]: Katalogdaki kilitsiz rafları listeler; gerekçe ile window.setBatchShelfCountLock çağırır ve Fark Masası'na geçiş sunar.
    function openBatchCountDialog(depotInput) {
        if (typeof window.requireDbAdmin === 'function' && !window.requireDbAdmin('Toplu raf sayımı')) return;
        const depot = depotInput === 'b2' ? 'b2' : 'b1';
        const depotName = depot === 'b2' ? 'B2 Demirbaş Deposu' : 'B1 Sarf Deposu';
        const physical = collectShelves(depot).filter(s => !s.isUnassigned && s.registered);
        const unlocked = physical.filter(s => !s.locked);
        const alreadyLocked = physical.filter(s => s.locked);

        if (!physical.length) {
            notify(`${depotName} için katalogda tanımlı raf bulunmuyor. Önce "Raf Ekle" ile raf tanımlayın.`, 'warning');
            return;
        }
        if (!unlocked.length) {
            notify(`${depotName} kataloğundaki tüm raflar (${alreadyLocked.length}) zaten sayımda. Sayım Fark Masası açılıyor.`, 'info');
            openCountDeskModal(depot);
            return;
        }

        const dialog = createDialog(
            'TOPLU SAYIM KİLİDİ',
            `${depotName} — Sayıma Al`,
            'Seçtiğiniz raflar (veya tüm depo) sayım kilidine alınır. Kilitli raflardaki ürünler depo listelerinden gizlenir; çıkış, zimmet, talep ve transfer yapılamaz.',
            'Sayıma Al'
        );

        const scopeWrap = document.createElement('div');
        scopeWrap.className = 'shelf-batch-scope';

        const modeRow = document.createElement('div');
        modeRow.className = 'shelf-batch-modes';
        const makeMode = (val, labelText, checked) => {
            const lbl = document.createElement('label');
            lbl.className = 'shelf-batch-mode';
            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.name = 'shelfBatchMode';
            radio.value = val;
            radio.checked = checked;
            const span = document.createElement('span');
            span.textContent = labelText;
            lbl.append(radio, span);
            return { lbl, radio };
        };
        const modeAll = makeMode('all', `Tüm Depo (${unlocked.length} kilitsiz raf)`, true);
        const modeSel = makeMode('selected', 'Seçili Raflar', false);
        modeRow.append(modeAll.lbl, modeSel.lbl);

        const pickerWrap = document.createElement('div');
        pickerWrap.className = 'shelf-batch-picker';
        pickerWrap.hidden = true;

        const pickerHead = document.createElement('div');
        pickerHead.className = 'shelf-batch-picker-head';
        const pickerCount = document.createElement('small');
        pickerCount.className = 'shelf-dialog-hint';
        const btnAll = document.createElement('button');
        btnAll.type = 'button'; btnAll.className = 'shelf-batch-mini-btn'; btnAll.textContent = 'Tümünü seç';
        const btnNone = document.createElement('button');
        btnNone.type = 'button'; btnNone.className = 'shelf-batch-mini-btn'; btnNone.textContent = 'Temizle';
        pickerHead.append(pickerCount, btnAll, btnNone);

        const grid = document.createElement('div');
        grid.className = 'shelf-batch-grid';
        const checkboxes = [];
        unlocked.sort((a, b) => a.code.localeCompare(b.code, 'tr', { numeric: true, sensitivity: 'base' })).forEach(s => {
            const chip = document.createElement('label');
            chip.className = 'shelf-batch-chip';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.value = s.code;
            cb.checked = true;
            const txt = document.createElement('span');
            txt.textContent = `${s.code} (${s.boundRows.length})`;
            chip.append(cb, txt);
            grid.append(chip);
            checkboxes.push(cb);
        });

        const refreshSelCount = () => {
            const n = checkboxes.filter(c => c.checked).length;
            pickerCount.textContent = `${n} / ${checkboxes.length} raf seçildi`;
        };
        refreshSelCount();
        grid.addEventListener('change', refreshSelCount);
        btnAll.addEventListener('click', () => { checkboxes.forEach(c => { c.checked = true; }); refreshSelCount(); });
        btnNone.addEventListener('click', () => { checkboxes.forEach(c => { c.checked = false; }); refreshSelCount(); });

        pickerWrap.append(pickerHead, grid);
        const syncMode = () => { pickerWrap.hidden = !modeSel.radio.checked; };
        modeAll.radio.addEventListener('change', syncMode);
        modeSel.radio.addEventListener('change', syncMode);

        scopeWrap.append(modeRow, pickerWrap);
        if (alreadyLocked.length) {
            const note = document.createElement('small');
            note.className = 'shelf-dialog-hint';
            note.textContent = `Not: Bu depoda ${alreadyLocked.length} raf zaten sayımda; listede yalnız kilitsiz raflar gösterilir.`;
            scopeWrap.append(note);
        }
        dialog.fields.append(scopeWrap);

        const reason = document.createElement('textarea');
        reason.rows = 2;
        reason.maxLength = schema().SHELF_LOCK_REASON_MAX;
        reason.required = true;
        reason.placeholder = 'ör. 2026 Yıl Sonu Depo Sayımı';
        addField(dialog, { id: 'shelfBatchLockReason', label: 'Sayım gerekçesi (zorunlu)', element: reason });
        reason.focus();

        guardedSubmit(dialog, async () => {
            const cleanReason = reason.value.trim();
            if (!cleanReason) { showDialogError(dialog, 'Sayım gerekçesini yazın.', reason); return; }
            const codes = modeAll.radio.checked ? unlocked.map(s => s.code) : checkboxes.filter(c => c.checked).map(c => c.value);
            if (!codes.length) { showDialogError(dialog, 'En az bir raf seçin.'); return; }
            if (!serviceOr(dialog, 'setBatchShelfCountLock')) return;

            dialog.setProgress(`Sayıma alınıyor (0 / ${codes.length})…`);
            const result = await window.setBatchShelfCountLock(depot, codes, {
                locked: true,
                reason: cleanReason,
                onProgress: (done, total) => dialog.setProgress(`Sayıma alınıyor (${done} / ${total})…`),
            });
            dialog.finish(result);
            const okCount = result.succeeded.length;
            const failCount = result.failed.length;
            notify(
                failCount
                    ? `${okCount} raf sayıma alındı (${result.totalRowsChanged} kayıt gizlendi), ${failCount} raf kilitlenemedi.`
                    : `${okCount} raf sayıma alındı; ${result.totalRowsChanged} kayıt depo listelerinden gizlendi.`,
                failCount ? 'warning' : 'success'
            );
            render();
            refreshDrawerIfOpen();
            if (okCount > 0) openCountDeskModal(depot, result.succeeded.map(s => s.code));
        });
    }

    // [WHY]: Sayımdaki rafların Sistem vs Sayılan adetlerini tek ekranda karşılaştırır, eksik/fazla farkları
    //        filtreleyip stoğa işler ve resmi Türkçe PDF / Excel tutanağı üretir (AGENTS.md uyumlu).
    // [HOW]: Saf DOM düğümleri ve ShelfCount motoruyla çizilir; DialogStack ile erişilebilir odak hapsi sağlar.
    function openCountDeskModal(depotInput, initialShelfCodes = null) {
        if (typeof window.requireDbAdmin === 'function' && !window.requireDbAdmin('Sayım Fark Masası')) return;
        const depot = depotInput === 'b2' ? 'b2' : 'b1';
        const depotName = depot === 'b2' ? 'B2 Demirbaş Deposu' : 'B1 Sarf Deposu';
        let SC;
        try { SC = shelfCountApi(); }
        catch (err) { notify(err.message, 'error'); return; }

        const lockedList = () => collectShelves(depot).filter(s => !s.isUnassigned && s.locked)
            .sort((a, b) => a.code.localeCompare(b.code, 'tr', { numeric: true, sensitivity: 'base' }));
        const initialLocked = lockedList();
        if (!initialLocked.length) {
            notify(`${depotName} içinde sayımda olan raf bulunmuyor. Önce rafları sayıma alın.`, 'info');
            return;
        }

        const drafts = countDrafts[depot];
        let scopeShelf = (Array.isArray(initialShelfCodes) && initialShelfCodes.length === 1) ? schema().normShelfCode(initialShelfCodes[0]) : 'ALL';
        let stateFilter = 'all';
        let searchText = '';
        let busy = false;

        const overlay = document.createElement('div');
        overlay.className = 'shelf-dialog-overlay';
        const modal = document.createElement('section');
        modal.className = 'shelf-dialog shelf-count-desk-dialog';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'scdTitle');

        const header = document.createElement('header');
        header.className = 'scd-header';
        const headText = document.createElement('div');
        const eyebrow = document.createElement('small');
        eyebrow.className = 'shelf-dialog-eyebrow';
        eyebrow.textContent = `CANLI SAYIM VE FARK MASASI · ${depotName.toUpperCase()}`;
        const title = document.createElement('h2');
        title.id = 'scdTitle';
        title.textContent = `${depotName} — Sayım Fark Masası`;
        // AGENTS.md: kısa görünür açıklama + erişilebilir yardım düğmesi
        const desc = document.createElement('p');
        desc.className = 'scd-desc';
        desc.textContent = 'Sayımdaki rafların fiziksel adetlerini girin; eksik ve fazla farkları anında filtreleyip onayınızla stoğa işleyin veya resmi tutanak indirin.';
        headText.append(eyebrow, title, desc);

        const headActions = document.createElement('div');
        headActions.className = 'scd-head-actions';
        const helpPanel = document.createElement('div');
        helpPanel.id = 'shelfCountDeskHelp';
        helpPanel.className = 'scd-help';
        helpPanel.hidden = true;
        [
            '1. Her ürün satırına rafta fiziken saydığınız adedi yazın; Eksik (🔴), Fazla (🟡) ve Tam (🟢) farkı anında hesaplanır.',
            '2. Filtre çipleriyle yalnızca eksik veya fazla çıkan kalemlere odaklanabilir, her satıra kısa sayım notu ekleyebilirsiniz.',
            '3. "Seçili Farkları Stoğa İşle" ile onayladığınız yeni adetler stok defterine yazılır ve denetim kaydı (sayim-duzeltme) oluşur; raf kilidi sayım bitene kadar korunur.',
            '4. Sayım sırasında veya sonunda "PDF Tutanak" ya da "Excel Rapor" indirip, işiniz bittiğinde "Sayımı Bitir" ile kilitleri kaldırabilirsiniz.',
        ].forEach(line => {
            const p = document.createElement('p');
            p.textContent = line;
            helpPanel.append(p);
        });

        const helpBtn = document.createElement('button');
        helpBtn.type = 'button';
        helpBtn.className = 'scd-help-btn';
        helpBtn.textContent = 'ⓘ Nasıl çalışır?';
        helpBtn.setAttribute('aria-expanded', 'false');
        helpBtn.setAttribute('aria-controls', helpPanel.id);
        helpBtn.addEventListener('click', () => {
            const open = helpPanel.hidden;
            helpPanel.hidden = !open;
            helpBtn.setAttribute('aria-expanded', String(open));
        });

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'shelf-dialog-close';
        closeBtn.setAttribute('aria-label', 'Sayım Fark Masasını kapat');
        closeBtn.textContent = '×';
        headActions.append(helpBtn, closeBtn);
        header.append(headText, headActions);

        const kpiBar = document.createElement('div');
        kpiBar.className = 'scd-kpis';
        kpiBar.setAttribute('aria-live', 'polite');

        const controls = document.createElement('div');
        controls.className = 'scd-controls';

        const scopeSelect = document.createElement('select');
        scopeSelect.className = 'scd-select';
        scopeSelect.setAttribute('aria-label', 'Sayım raf kapsamı');

        const searchInput = document.createElement('input');
        searchInput.type = 'search';
        searchInput.className = 'scd-search';
        searchInput.placeholder = 'Ürün, raf, tür, envanter no veya seri no ara…';
        searchInput.autocomplete = 'off';

        const chipGroup = document.createElement('div');
        chipGroup.className = 'scd-chips';
        chipGroup.setAttribute('role', 'group');
        chipGroup.setAttribute('aria-label', 'Fark durumu filtresi');
        const chipDefs = [
            ['all', 'Tümü'],
            ['missing', '🔴 Eksik'],
            ['excess', '🟡 Fazla'],
            ['match', '🟢 Tam'],
            ['pending', '⏳ Bekleyen'],
        ];
        const chipButtons = new Map();
        chipDefs.forEach(([key, labelText]) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `scd-chip scd-chip-${key}`;
            btn.dataset.filter = key;
            btn.setAttribute('aria-pressed', String(key === stateFilter));
            btn.textContent = labelText;
            btn.addEventListener('click', () => {
                stateFilter = key;
                chipButtons.forEach((b, k) => b.setAttribute('aria-pressed', String(k === stateFilter)));
                renderTable();
            });
            chipButtons.set(key, btn);
            chipGroup.append(btn);
        });

        controls.append(scopeSelect, searchInput, chipGroup);

        const statusNote = document.createElement('p');
        statusNote.className = 'shelf-dialog-error';
        statusNote.setAttribute('role', 'status');
        statusNote.hidden = true;

        const tableWrap = document.createElement('div');
        tableWrap.className = 'scd-table-wrap';
        const table = document.createElement('table');
        table.className = 'scd-table';
        const thead = document.createElement('thead');
        const headTr = document.createElement('tr');
        const masterCb = document.createElement('input');
        masterCb.type = 'checkbox';
        masterCb.setAttribute('aria-label', 'Farkı olan tüm satırları seç');
        const thSelect = document.createElement('th');
        thSelect.className = 'scd-col-check';
        thSelect.append(masterCb);
        headTr.append(thSelect);
        ['Raf', 'Ürün & Detay', 'Sistem', 'Sayılan Adet', 'Fark', 'Sayım Notu', 'İşlem'].forEach(colLabel => {
            const th = document.createElement('th');
            th.textContent = colLabel;
            headTr.append(th);
        });
        thead.append(headTr);
        const tbody = document.createElement('tbody');
        table.append(thead, tbody);
        tableWrap.append(table);

        const footer = document.createElement('footer');
        footer.className = 'scd-footer';
        const leftFooter = document.createElement('div');
        leftFooter.className = 'scd-footer-group';
        const applySelectedBtn = document.createElement('button');
        applySelectedBtn.type = 'button';
        applySelectedBtn.className = 'scd-btn scd-btn-primary';
        applySelectedBtn.textContent = '✅ Seçili Farkları Stoğa İşle (0)';
        applySelectedBtn.disabled = true;
        leftFooter.append(applySelectedBtn);

        const rightFooter = document.createElement('div');
        rightFooter.className = 'scd-footer-group';
        const pdfBtn = document.createElement('button');
        pdfBtn.type = 'button';
        pdfBtn.className = 'scd-btn';
        pdfBtn.textContent = '📄 Sayım Fark Tutanağı (PDF)';
        const excelBtn = document.createElement('button');
        excelBtn.type = 'button';
        excelBtn.className = 'scd-btn';
        excelBtn.textContent = '📊 Excel Rapor';
        const unlockBtn = document.createElement('button');
        unlockBtn.type = 'button';
        unlockBtn.className = 'scd-btn scd-btn-danger';
        unlockBtn.textContent = '🔓 Sayımı Bitir';
        rightFooter.append(pdfBtn, excelBtn, unlockBtn);
        footer.append(leftFooter, rightFooter);

        modal.append(header, helpPanel, kpiBar, controls, statusNote, tableWrap, footer);
        overlay.append(modal);
        document.body.append(overlay);
        document.body.classList.add('shelf-dialog-open');

        const closeModal = () => {
            activeCountDeskRefresh = null;
            if (window.DialogStack) window.DialogStack.close(modal);
            overlay.remove();
            document.body.classList.remove('shelf-dialog-open');
        };
        closeBtn.addEventListener('click', closeModal);
        overlay.addEventListener('click', event => { if (event.target === overlay) closeModal(); });
        if (window.DialogStack) window.DialogStack.open(modal, { onEscape: closeModal, initialFocus: closeBtn });
        else closeBtn.focus();

        const getActiveShelfCodes = () => {
            const locked = lockedList();
            if (scopeShelf !== 'ALL' && locked.some(s => s.code === scopeShelf)) return [scopeShelf];
            scopeShelf = 'ALL';
            return locked.map(s => s.code);
        };

        const getScopeRows = () => {
            const codes = getActiveShelfCodes();
            const depotRows = valuesOf(window.data && window.data[depot]);
            return SC.buildCountRows(depotRows, codes, { countedMap: drafts });
        };

        const syncScopeOptions = () => {
            const locked = lockedList();
            scopeSelect.replaceChildren();
            const optAll = document.createElement('option');
            optAll.value = 'ALL';
            optAll.textContent = `Tüm Sayımdaki Raflar (${locked.length})`;
            scopeSelect.append(optAll);
            locked.forEach(s => {
                const opt = document.createElement('option');
                opt.value = s.code;
                opt.textContent = `🔒 ${s.code} (${s.boundRows.length} kalem)`;
                scopeSelect.append(opt);
            });
            if (scopeShelf !== 'ALL' && !locked.some(s => s.code === scopeShelf)) scopeShelf = 'ALL';
            scopeSelect.value = scopeShelf;
        };

        const getSelectedFixes = rows => rows.filter(r => {
            const d = drafts.get(r.id);
            return d && d.selected === true && (r.state === 'missing' || r.state === 'excess');
        }).map(r => ({ id: r.id, countedQty: r.countedQty, note: r.note, name: r.name, before: r.systemQty }));

        const updateSummaryUI = allRows => {
            const sum = SC.summarizeVariances(allRows);
            kpiBar.replaceChildren();
            const cards = [
                ['Toplam Kalem', String(sum.total), ''],
                ['Sayılan', `${sum.counted}/${sum.total}`, ''],
                ['🔴 Eksik', `${sum.missing}${sum.missingQty ? ` (-${sum.missingQty})` : ''}`, 'is-missing'],
                ['🟡 Fazla', `${sum.excess}${sum.excessQty ? ` (+${sum.excessQty})` : ''}`, 'is-excess'],
                ['🟢 Tam', String(sum.match), 'is-match'],
                ['Net Fark', sum.netDiff > 0 ? `+${sum.netDiff}` : String(sum.netDiff), sum.netDiff < 0 ? 'is-missing' : sum.netDiff > 0 ? 'is-excess' : ''],
            ];
            cards.forEach(([labelText, valText, cls]) => {
                const card = document.createElement('div');
                card.className = `scd-kpi${cls ? ` ${cls}` : ''}`;
                const lbl = document.createElement('small');
                lbl.textContent = labelText;
                const val = document.createElement('strong');
                val.textContent = valText;
                card.append(lbl, val);
                kpiBar.append(card);
            });

            chipButtons.get('all').textContent = `Tümü (${sum.total})`;
            chipButtons.get('missing').textContent = `🔴 Eksik (${sum.missing})`;
            chipButtons.get('excess').textContent = `🟡 Fazla (${sum.excess})`;
            chipButtons.get('match').textContent = `🟢 Tam (${sum.match})`;
            chipButtons.get('pending').textContent = `⏳ Bekleyen (${sum.pending})`;

            const selectedFixes = getSelectedFixes(allRows);
            applySelectedBtn.textContent = `✅ Seçili Farkları Stoğa İşle (${selectedFixes.length})`;
            applySelectedBtn.disabled = busy || selectedFixes.length === 0;
        };

        const formatDiffBadge = (el, state, diff) => {
            el.className = `scd-diff-badge scd-state-${state}`;
            if (state === 'missing') el.textContent = `🔴 ${diff}`;
            else if (state === 'excess') el.textContent = `🟡 +${diff}`;
            else if (state === 'match') el.textContent = '🟢 0';
            else el.textContent = '—';
        };

        const applyFixesList = async fixes => {
            if (busy || !fixes.length) return;
            if (typeof window.applyCountFixes !== 'function') {
                notify('Sayım düzeltme servisi (applyCountFixes) yüklenmemiş.', 'error');
                return;
            }
            const ok = await confirmInDrawer(
                'SAYIM DÜZELTMESİ',
                `${fixes.length} fark kalemi stoğa işlensin mi?`,
                'Onaylanan kalemlerin stok adetleri güncellenecek ve her biri için "sayim-duzeltme" denetim kaydı yazılacak. Raf sayım kilidi siz "Sayımı Bitir" diyene kadar korunur.',
                'Stoğa İşle'
            );
            if (!ok) return;
            busy = true;
            statusNote.hidden = true;
            updateSummaryUI(getScopeRows());
            try {
                const res = await window.applyCountFixes(depot, fixes);
                res.applied.forEach(item => { drafts.delete(item.id); });
                res.skipped.forEach(item => { drafts.delete(item.id); });
                const msg = `${res.applied.length} fark stoğa işlendi${res.skipped.length ? `, ${res.skipped.length} kalem değişmedi` : ''}${res.failed.length ? `, ${res.failed.length} hata` : ''}.`;
                notify(msg, res.failed.length ? 'warning' : 'success');
                if (res.failed.length) {
                    statusNote.textContent = res.failed.map(f => `${f.id}: ${f.message}`).join(' · ');
                    statusNote.hidden = false;
                }
            } catch (err) {
                statusNote.textContent = (err && err.message) || 'Farklar stoğa işlenemedi.';
                statusNote.hidden = false;
            } finally {
                busy = false;
                render();
                refreshDrawerIfOpen();
                renderTable();
            }
        };

        const renderTable = () => {
            syncScopeOptions();
            const allRows = getScopeRows();
            updateSummaryUI(allRows);
            const q = searchText.toLocaleLowerCase('tr-TR');
            const filtered = allRows.filter(r => {
                if (stateFilter !== 'all' && r.state !== stateFilter) return false;
                if (!q) return true;
                return [r.shelfCode, r.name, r.type, r.brand, r.envanterNo, r.serialNo, r.barcode].join(' ').toLocaleLowerCase('tr-TR').includes(q);
            });

            tbody.replaceChildren();
            if (!filtered.length) {
                const tr = document.createElement('tr');
                const td = document.createElement('td');
                td.colSpan = 8;
                td.className = 'scd-empty';
                td.textContent = allRows.length
                    ? 'Seçili filtre veya arama kriteriyle eşleşen kalem yok.'
                    : 'Seçili sayımdaki raflarda kayıtlı ürün bulunmuyor.';
                tr.append(td);
                tbody.append(tr);
                masterCb.checked = false;
                masterCb.disabled = true;
                return;
            }

            const varianceVisible = filtered.filter(r => r.state === 'missing' || r.state === 'excess');
            masterCb.disabled = varianceVisible.length === 0;
            masterCb.checked = varianceVisible.length > 0 && varianceVisible.every(r => drafts.get(r.id)?.selected === true);

            filtered.forEach(row => {
                const tr = document.createElement('tr');
                tr.className = `scd-row scd-row-${row.state}`;

                const tdCheck = document.createElement('td');
                tdCheck.className = 'scd-col-check';
                const rowCb = document.createElement('input');
                rowCb.type = 'checkbox';
                const isVar = row.state === 'missing' || row.state === 'excess';
                rowCb.disabled = !isVar;
                rowCb.checked = isVar && drafts.get(row.id)?.selected === true;
                rowCb.setAttribute('aria-label', `${row.name} farkını seç`);
                tdCheck.append(rowCb);

                const tdShelf = document.createElement('td');
                const shelfBadge = document.createElement('span');
                shelfBadge.className = 'scd-shelf-pill';
                shelfBadge.textContent = row.shelfCode;
                tdShelf.append(shelfBadge);

                const tdInfo = document.createElement('td');
                const nameEl = document.createElement('strong');
                nameEl.className = 'scd-item-name';
                nameEl.textContent = row.name;
                const metaEl = document.createElement('small');
                metaEl.className = 'scd-item-meta';
                metaEl.textContent = [row.type, row.envanterNo && `Env: ${row.envanterNo}`, row.serialNo && `SN: ${row.serialNo}`, row.systemQty === 0 ? 'Stok 0' : ''].filter(Boolean).join(' · ');
                tdInfo.append(nameEl, metaEl);

                const tdSys = document.createElement('td');
                tdSys.className = 'scd-num';
                tdSys.textContent = String(row.systemQty);

                const tdCount = document.createElement('td');
                const qtyInput = document.createElement('input');
                qtyInput.type = 'number';
                qtyInput.min = '0';
                qtyInput.step = '1';
                qtyInput.inputMode = 'numeric';
                qtyInput.className = 'scd-qty-input';
                qtyInput.placeholder = 'Sayım…';
                qtyInput.setAttribute('aria-label', `${row.name} sayılan adet`);
                if (row.countedQty !== null) qtyInput.value = String(row.countedQty);
                tdCount.append(qtyInput);

                const tdDiff = document.createElement('td');
                const diffBadge = document.createElement('span');
                formatDiffBadge(diffBadge, row.state, row.diff);
                tdDiff.append(diffBadge);

                const tdNote = document.createElement('td');
                const noteInput = document.createElement('input');
                noteInput.type = 'text';
                noteInput.maxLength = 200;
                noteInput.className = 'scd-note-input';
                noteInput.placeholder = 'İsteğe bağlı not';
                noteInput.setAttribute('aria-label', `${row.name} sayım notu`);
                noteInput.value = row.note || '';
                tdNote.append(noteInput);

                const tdAct = document.createElement('td');
                const fixBtn = document.createElement('button');
                fixBtn.type = 'button';
                fixBtn.className = 'scd-row-fix-btn';
                fixBtn.textContent = 'Stoğa İşle';
                fixBtn.disabled = !isVar || busy;
                tdAct.append(fixBtn);

                rowCb.addEventListener('change', () => {
                    const prev = drafts.get(row.id) || { countedQty: row.countedQty, note: row.note, selected: false };
                    drafts.set(row.id, { ...prev, selected: rowCb.checked });
                    updateSummaryUI(getScopeRows());
                });

                qtyInput.addEventListener('input', () => {
                    const raw = qtyInput.value.trim();
                    const prev = drafts.get(row.id) || { countedQty: null, note: noteInput.value, selected: false };
                    if (raw === '') {
                        drafts.delete(row.id);
                        tr.className = 'scd-row scd-row-pending';
                        formatDiffBadge(diffBadge, 'pending', null);
                        rowCb.checked = false;
                        rowCb.disabled = true;
                        fixBtn.disabled = true;
                        updateSummaryUI(getScopeRows());
                        return;
                    }
                    const parsed = Number(raw);
                    if (!Number.isInteger(parsed) || parsed < 0) return;
                    const v = SC.computeVariance(row.systemQty, parsed);
                    const hasDiff = v.state === 'missing' || v.state === 'excess';
                    drafts.set(row.id, { countedQty: parsed, note: noteInput.value, selected: hasDiff });
                    tr.className = `scd-row scd-row-${v.state}`;
                    formatDiffBadge(diffBadge, v.state, v.diff);
                    rowCb.disabled = !hasDiff;
                    rowCb.checked = hasDiff;
                    fixBtn.disabled = !hasDiff || busy;
                    updateSummaryUI(getScopeRows());
                });

                noteInput.addEventListener('input', () => {
                    const prev = drafts.get(row.id);
                    if (prev) drafts.set(row.id, { ...prev, note: noteInput.value });
                });

                fixBtn.addEventListener('click', () => {
                    const d = drafts.get(row.id);
                    if (!d || d.countedQty === null || d.countedQty === row.systemQty) return;
                    applyFixesList([{ id: row.id, countedQty: d.countedQty, note: d.note || noteInput.value }]);
                });

                tr.append(tdCheck, tdShelf, tdInfo, tdSys, tdCount, tdDiff, tdNote, tdAct);
                tbody.append(tr);
            });
        };

        scopeSelect.addEventListener('change', () => { scopeShelf = scopeSelect.value; renderTable(); });
        searchInput.addEventListener('input', () => { searchText = searchInput.value.trim(); renderTable(); });
        masterCb.addEventListener('change', () => {
            const allRows = getScopeRows();
            allRows.filter(r => r.state === 'missing' || r.state === 'excess').forEach(r => {
                const prev = drafts.get(r.id) || { countedQty: r.countedQty, note: r.note, selected: false };
                drafts.set(r.id, { ...prev, selected: masterCb.checked });
            });
            renderTable();
        });

        applySelectedBtn.addEventListener('click', () => {
            const fixes = getSelectedFixes(getScopeRows());
            if (fixes.length) applyFixesList(fixes);
        });

        const buildCurrentReport = () => {
            const codes = getActiveShelfCodes();
            const lockedMap = new Map(lockedList().map(s => [s.code, s]));
            const reasons = [...new Set(codes.map(c => lockedMap.get(c)?.doc?.lockReason).filter(Boolean))];
            const activeUser = typeof window.getActiveUser === 'function' ? window.getActiveUser() : window.currentUser;
            return SC.buildCountReportData({
                depot,
                depotName,
                shelves: codes,
                reason: reasons.join(' · ') || 'Depo stok sayımı',
                createdBy: (activeUser && (activeUser.name || activeUser.adSoyad)) || 'Sistem Yöneticisi',
            }, getScopeRows());
        };

        pdfBtn.addEventListener('click', async () => {
            if (typeof window.generateShelfCountReportPDF !== 'function') {
                notify('PDF üretici (generateShelfCountReportPDF) yüklenmemiş.', 'error');
                return;
            }
            pdfBtn.disabled = true;
            try { await window.generateShelfCountReportPDF(buildCurrentReport()); }
            finally { pdfBtn.disabled = false; }
        });

        excelBtn.addEventListener('click', () => {
            if (typeof window.XLSX === 'undefined' || !window.XLSX.utils) {
                notify('Excel kütüphanesi (XLSX) yüklenemedi.', 'error');
                return;
            }
            const report = buildCurrentReport();
            if (!report.excelRows.length) {
                notify('Dışa aktarılacak sayım kalemi bulunmuyor.', 'warning');
                return;
            }
            const ws = window.XLSX.utils.json_to_sheet(report.excelRows);
            const wb = window.XLSX.utils.book_new();
            window.XLSX.utils.book_append_sheet(wb, ws, 'Sayim Farklari');
            window.XLSX.writeFile(wb, `Sayim_Fark_Raporu_${depot.toUpperCase()}_${report.belge.raporNo}.xlsx`);
        });

        unlockBtn.addEventListener('click', async () => {
            if (busy) return;
            const codes = getActiveShelfCodes();
            if (!codes.length) return;
            const ok = await confirmInDrawer(
                'SAYIMI BİTİR',
                `${codes.length} rafın sayım kilidi kaldırılsın mı?`,
                'Seçili raflardaki tüm ürünler yeniden B1/B2 depo listelerinde görünecek ve normal stok hareketlerine açılacak.',
                'Sayımı Bitir'
            );
            if (!ok) return;
            if (typeof window.setBatchShelfCountLock !== 'function') {
                notify('Toplu raf servisi yüklenmemiş.', 'error');
                return;
            }
            busy = true;
            unlockBtn.disabled = true;
            try {
                const res = await window.setBatchShelfCountLock(depot, codes, { locked: false });
                const unlockedSet = new Set(res.succeeded.map(s => s.code));
                getScopeRows().forEach(r => { if (unlockedSet.has(r.shelfCode)) drafts.delete(r.id); });
                notify(
                    res.failed.length
                        ? `${res.succeeded.length} rafın sayımı bitti, ${res.failed.length} rafta hata oluştu.`
                        : `${res.succeeded.length} rafın sayımı tamamlandı; ${res.totalRowsChanged} kayıt depo listelerine döndü.`,
                    res.failed.length ? 'warning' : 'success'
                );
                render();
                refreshDrawerIfOpen();
                if (!lockedList().length) closeModal();
                else renderTable();
            } catch (err) {
                statusNote.textContent = (err && err.message) || 'Sayım kilidi kaldırılamadı.';
                statusNote.hidden = false;
            } finally {
                busy = false;
                unlockBtn.disabled = false;
            }
        });

        activeCountDeskRefresh = () => {
            if (!overlay.isConnected) { activeCountDeskRefresh = null; return; }
            if (!lockedList().length) { closeModal(); return; }
            renderTable();
        };
        renderTable();
    }

    // ─── v3.3 Aşama 6 (Veri Geçişi) — "Sistem Raf Sayaçlarını Eşitle (Sync)" ────────────────────────────────────────
    // [WHY]: P1-02 (Aşama 2/4) yalnız kendinden SONRAKİ yazmalarda usedSlots'u doğru tutar; bu, ondan ÖNCEKİ kaymayı
    //        (ve kataloğa sonradan eklenen eski rafları) kapatan TEK SEFERLİK, geçici bir göç aracıdır.
    // [HOW]: window.syncShelfCounters() (firebase-handler.js) sunucudan taze b1/b2/shelves okuyup
    //        StockLedger.planShelfSync ile uzlaştırır; hiçbir raf diğerini engellemez ("hepsi ya da hiçbiri" değildir).
    //        Sonuç bu dosyanın KENDİ diyalog altyapısıyla (createDialog + DialogStack) özetlenir.
    function renderSyncSummaryHtml(result, { preview = false } = {}) {
        const rows = [];
        const counterTotal = result.updated.length + result.capacityRaised.length;
        const lockList = Array.isArray(result.lockFixed) ? result.lockFixed : [];
        const lockedCount = lockList.filter(f => f.rafPasif === true).length;
        const unlockedCount = lockList.length - lockedCount;
        if (preview) {
            rows.push(`<p><strong>Önizleme (Dry-Run):</strong> Toplam <strong>${escapeHtml(counterTotal + lockList.length)}</strong> kayıt güncellenecek (henüz hiçbir yazma yapılmadı).</p>`);
            rows.push(`<p>Raf sayacı güncellenecek: <strong>${escapeHtml(result.updated.length)}</strong> · Zaten doğru raf: <strong>${escapeHtml(result.unchanged)}</strong>.</p>`);
        } else {
            rows.push(`<p>${escapeHtml(result.updated.length)} raf sayacı güncellendi · ${escapeHtml(result.unchanged)} raf zaten doğruydu.</p>`);
        }
        if (result.capacityRaised.length) {
            rows.push(`<p class="shelf-sync-warning">⚠️ ${escapeHtml(result.capacityRaised.length)} rafta gerçek doluluk kayıtlı kapasiteyi aşıyordu; kapasite gerçek sayıma yükseltilece${preview ? 'k' : 'k şekilde düzeltildi'}:</p>`);
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
        rows.push(`<p>${preview ? 'Sayım işareti (<code>rafPasif</code>) eklenecek / düzeltilecek' : 'Sayım işareti raf durumuna göre düzeltilen'} kayıt: <strong>${escapeHtml(lockList.length)}</strong> (${escapeHtml(lockedCount)} kilitli, ${escapeHtml(unlockedCount)} açık/kanonik).</p>`);
        return rows.join('');
    }

    function showSyncResultDialog(result) {
        const dialog = createDialog('GÖÇ ARACI · SONUÇ', 'Raf Sayaçları ve Sayım İşareti Eşitlendi', '', 'Tamam');
        dialog.fields.innerHTML = renderSyncSummaryHtml(result, { preview: false });
        dialog.form.addEventListener('submit', event => { event.preventDefault(); dialog.finish(true); });
        dialog.result.then(() => {});
    }

    function confirmSyncDryRunDialog(preview) {
        const total = preview.updated.length + preview.capacityRaised.length + (preview.lockFixed ? preview.lockFixed.length : 0);
        if (total === 0) {
            const infoDialog = createDialog('ÖNİZLEME (DRY-RUN) · GÜNCEL', 'Tüm Kayıtlar Zaten Güncel', '', 'Kapat');
            infoDialog.fields.innerHTML = renderSyncSummaryHtml(preview, { preview: true });
            infoDialog.form.addEventListener('submit', event => { event.preventDefault(); infoDialog.finish(false); });
            return infoDialog.result;
        }
        const dialog = createDialog('ÖNİZLEME (DRY-RUN)', `${total} Kayıt Güncellenecek — Onaylayın`, '', `${total} Değişikliği Uygula`);
        dialog.fields.innerHTML = renderSyncSummaryHtml(preview, { preview: true });
        dialog.form.addEventListener('submit', event => { event.preventDefault(); dialog.finish(true); });
        return dialog.result;
    }

    // [WHY]: VP-5 — Kullanıcıya canlı veriye yazılmadan önce Dry-Run yapılacağını ve eksik rafPasif bayraklarının
    //        tamamlandığını AGENTS.md uyarınca görünür kılmak (admin.html dosyasına dokunmadan DOM eklemesi).
    // [HOW]: #shelfMatrixHelp içindeki Sayım listesine bir madde ekler (zaten varsa tekrarlamaz).
    function ensureSyncHelpNote() {
        const help = document.getElementById('shelfMatrixHelp');
        if (!help || help.querySelector('[data-vp5-sync-help]')) return;
        const lists = help.querySelectorAll('ul');
        const target = lists[lists.length - 1] || help;
        const li = document.createElement('li');
        li.setAttribute('data-vp5-sync-help', '1');
        const strong = document.createElement('strong');
        strong.textContent = 'Sayaç ve Sayım İşareti Eşitleme (Dry-Run): ';
        const text = document.createTextNode('Üstteki "Sistem Raf Sayaçlarını Eşitle" düğmesi önce veritabanına hiçbir şey yazmadan önizleme (Dry-Run) çıkarır; eski ürün kayıtlarındaki eksik sayım işaretlerini (rafPasif) ve raf sayaçlarını yalnız onayınızla günceller.');
        li.append(strong, text);
        target.appendChild(li);
    }

    async function syncShelfCountersAction() {
        if (typeof window.requireDbAdmin === 'function' && !window.requireDbAdmin('Raf sayaçlarını eşitleme')) return;
        const button = document.getElementById('shelfMatrixSyncBtn');
        if (typeof window.syncShelfCounters !== 'function') {
            if (typeof window.showAppAlert === 'function') window.showAppAlert('Stok defteri servisi yüklenemedi; eşitleme yapılamadı.', 'error');
            return;
        }
        const syncOpts = { canonicalize: true };
        const originalLabel = button ? button.textContent : '';
        if (button) { button.disabled = true; button.textContent = '⏳ Önizleniyor (Dry-Run)…'; }
        let confirmed = false;
        try {
            if (typeof window.previewShelfCounters === 'function') {
                const preview = await window.previewShelfCounters(syncOpts);
                if (button) { button.disabled = false; button.textContent = originalLabel; }
                confirmed = await confirmSyncDryRunDialog(preview) === true;
            } else {
                const q = 'B1 ve B2\'deki TÜM stok taranacak, raf doluluk sayaçları ve eksik sayım işaretleri (rafPasif) eşitlenecek. Devam edilsin mi?';
                confirmed = typeof window.showCustomConfirm === 'function'
                    ? await window.showCustomConfirm('Raf Sayaçlarını Eşitle', q, { confirmText: 'Eşitle' }) === true
                    : window.confirm(q);
            }
            if (!confirmed) return;
            if (button) { button.disabled = true; button.textContent = '⏳ Eşitleniyor…'; }
            const result = await window.syncShelfCounters(syncOpts);
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
            if (event.target.closest('#shelfBatchCountBtn')) { openBatchCountDialog(activeDepot); return; }
            if (event.target.closest('#shelfCountDeskBtn')) { openCountDeskModal(activeDepot); return; }
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
            if (inventoryChanged || catalogChanged) {
                refreshDrawerIfOpen();
                if (typeof activeCountDeskRefresh === 'function') activeCountDeskRefresh();
            }
        });
    }

    function init() {
        ensureSyncHelpNote();
        bindUI();
    }

    window.ShelfMatrix = { render, openDrawer, closeDrawer, openBatchCountDialog, openCountDeskModal };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();
