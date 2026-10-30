(function () {
    'use strict';

    const DEFAULT_CAPACITY = 5;
    const UNASSIGNED_SHELF = '__unassigned__';
    let activeDepot = 'b1';
    let sortMode = 'occupancy';
    let searchQuery = '';
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
        const grouped = new Map();   // kanonik kod → { code, key, items, registered }
        const unassigned = [];

        catalogShelvesFor(depot).forEach(s => {
            if (!grouped.has(s.code)) grouped.set(s.code, { code: s.code, key: s.code, items: [], registered: true });
        });

        valuesOf(window.data && window.data[depot]).filter(item => item && typeof item === 'object').forEach(item => {
            if (!productIsInStock(item)) {
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

        const shelves = Array.from(grouped.values(), g => ({
            code: g.code,
            key: g.key,
            items: g.items,
            capacity: capacityFor(depot, g.code),
            varieties: new Set(g.items.map(productType)).size,
            isUnassigned: false,
            registered: g.registered,   // WMS'ten kapasitesi tanımlı mı (false: geçiş dönemi, eski/kataloglanmamış raf)
        }));
        if (unassigned.length) {
            shelves.push({
                code: 'Rafı Tanımsız',
                key: UNASSIGNED_SHELF,
                items: unassigned,
                capacity: 0,
                varieties: new Set(unassigned.map(productType)).size,
                isUnassigned: true,
                registered: false,
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
                depot,   // makeShelfCard bunu activeDepot yerine kullanır (bkz. aşağı)
            };
        });
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
        return `
            <article class="shelf-card shelf-card-${state}">
                ${capacityControl}
                <button type="button" class="shelf-card-open" data-action="inspect"
                    data-depot="${escapeHtml(depotAttr)}" data-shelf="${escapeHtml(shelf.key)}"
                    aria-label="${escapeHtml(shelf.code)} rafını incele">
                    <span class="shelf-card-heading">
                        <span class="shelf-card-code">${escapeHtml(shelf.code)}</span>
                        <span class="shelf-card-count">${shelf.items.length} ürün</span>
                    </span>
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

    function makeProductRow(item, index, depot) {
        const name = productName(item);
        const type = productType(item);
        const serial = firstValue(item.seriNo, item.serialNo, item.seri, item.sn);
        const barcode = firstValue(item.barkod, item.barcode, item.urunKodu, item.productCode);
        const quantity = productQuantity(item);
        const details = [type, barcode && `Barkod/Kod: ${barcode}`, serial && `Seri No: ${serial}`].filter(Boolean).join(' · ');
        const moveButton = productIsInStock(item) ? `
                    <button type="button" class="shelf-product-move" data-action="move-product"
                        data-depot="${escapeHtml(depot)}" data-id="${escapeHtml(item.id)}"
                        aria-label="${escapeHtml(name)} ürününün rafını değiştir">Rafı değiştir</button>` : '';
        return `
            <li class="shelf-product-row">
                <span class="shelf-product-index">${index + 1}</span>
                <span class="shelf-product-info">
                    <strong>${escapeHtml(name)}</strong>
                    <small>${escapeHtml(details)}</small>
                </span>
                <span class="shelf-product-actions">
                    <span class="shelf-product-quantity">${escapeHtml(quantity)} <small>adet</small></span>
                    ${moveButton}
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
        });
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
        drawer.querySelector('#shelfDrawerDepot').textContent = depotName;
        drawer.querySelector('#shelfDrawerTitle').textContent = shelf.code;
        drawer.querySelector('#shelfDrawerSummary').textContent = shelf.isUnassigned
            ? `${shelf.items.length} stok dışı veya rafı tanımsız ürün`
            : `${shelf.items.length} / ${shelf.capacity} slot kullanılıyor · ${shelf.varieties} ürün çeşidi`;
        drawer.querySelector('#shelfDrawerItemCount').textContent = `${shelf.items.length} kalem`;
        drawer.querySelector('#shelfDrawerProducts').innerHTML = shelf.items.length
            ? shelf.items.map((item, index) => makeProductRow(item, index, depot)).join('')
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
            const visible = sortShelves(allShelves.filter(matchesQuery));
            grid.innerHTML = visible.length
                ? visible.map(makeShelfCard).join('')
                : '<div class="shelf-empty">Aramanızla eşleşen raf veya ürün bulunamadı.</div>';
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
        names.forEach(name => {
            const stats = window.ShelfCapacity.slotStats(depot, name);
            const option = document.createElement('option');
            option.value = name;
            option.disabled = name === currentShelf || stats.available < 1;
            option.textContent = `${name} · ${stats.used}/${stats.capacity} slot · ${stats.available} boş`;
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
            + 'Bu tek seferlik bir bakım/göç işlemidir; yalnız SAYAÇLARI düzeltir, ürün verisine dokunmaz. Devam edilsin mi?';
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
