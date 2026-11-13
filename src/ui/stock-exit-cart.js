// [WHY]: v3.7 · İP-1 — script.js monolitinden ayrıştırıldı (SoC). Sepet / Toplu Çıkış ve tekil Çıkış penceresinin ürün araması
//        stok çıkışının arayüz katmanıdır; stok düşümü ve b3 kayıtları servis köprüsüyle (window.runStockOps) tek işlemde yazılır.
// [HOW]: Klasik betik; iki sayfada script.js'ten hemen sonra yüklenir (ES modüllerinden önce tanımlı olmalı: inline onclick
//        ve modüller bu adları çağırır). Gövde script.js'ten değiştirilmeden taşındı; window.* köprüleri aynı adlarla kalır,
//        AppModules.ExitCart aynı fonksiyonları taşır (sözleşme: tests/unit/script-bridge-contract.test.mjs).

// 🔷 Sepet / Toplu Çıkış Sistemi
(function () {
    let cartItems = [];
    // [WHY]: Sepet ürünleri dizi indeksiyle tutuyor (DATA-06), stoğu istemcide hesaplayıp tüm veritabanını yazıyordu (INV-04):
    //        iki cihaz aynı anda çıkınca biri diğerinin düşümünü eziyor, sıfıra inen "Pasif"/"Hurda" ürünün durumu
    //        "Tükendi" oluyordu; yetersiz kalemler sessizce atlanıp kalanlar "başarılı" kaydediliyordu.
    // [HOW]: Kalemler ürün id'siyle tutulur; tüm kalemlerin stok düşümü + b3 kayıtları TEK transaction (runStockOps):
    //        bir kalem bile yetmezse hiçbir şey yazılmaz ve hangi ürün olduğu söylenir.
    //        v3.4: yönetici her ürün için (alan kişiyi seçerek); personel hesabı yalnız sarf kalemleri, alan kişi kendisi.
    const _isAdmin = () => typeof window.isDbAdmin === 'function' && window.isDbAdmin();
    window.openCartModal = function () {
        if (!(typeof window.canExitStock === 'function' && window.canExitStock())) { showAppAlert(window.EXIT_STAFF_MESSAGE || window.EXIT_ADMIN_ONLY_MESSAGE, 'error'); return; }
        cartItems = [];
        document.getElementById('cartSearch').value = "";
        document.getElementById('cartProductList').style.display = 'none';
        document.getElementById('cartNote').value = "";
        document.getElementById('cartSn').value = "";
        if (window.ExitReceiver) window.ExitReceiver.setup('cart', _isAdmin());
        const roleNote = document.getElementById('cartRoleNote');
        if (roleNote) roleNote.textContent = _isAdmin()
            ? 'Sepetteki tüm ürünlerin stoğu tek seferde düşer; çıkışlar "Alan Kişi" olarak seçtiğiniz personele yazılır. Bir kalemde stok yetmezse hiçbiri kaydedilmez.'
            : 'Yalnız sarf malzemeleri sepete ekleyebilirsiniz; çıkışlar sizin adınıza kaydedilir. Demirbaş için "Envanter Talep Et" kullanın.';
        renderCartItems();
        const modal = document.getElementById('cartModal');
        if (modal) modal.style.display = 'block';
    };

    window.searchForCart = function () {
        const searchTerm = document.getElementById('cartSearch').value.toLocaleLowerCase('tr-TR');
        const list = document.getElementById('cartProductList');
        list.innerHTML = '';
        if (searchTerm.length < 2) { list.style.display = 'none'; return; }
        const repos = ['b1', 'b2'];
        let results = [];
        repos.forEach(repo => {
            if (!window.data[repo]) return;
            window.data[repo].forEach((item, index) => {
                const isDem = window.checkIsDemirbas ? window.checkIsDemirbas(item) : (item.isDemirbas === true);
                const qty = parseInt(item.adet || item.qty || 0);
                if (qty > 0 && !window.Schema?.isRowCountLocked?.(item)) {
                    const searchStr = `${item.ürün || ''} ${item.marka || ''} ${item.name || ''} ${item.raf || ''} ${item.sütun || ''} ${item.tür || ''} ${item.açıklama || ''} ${item.envanterNo || ''}`.toLocaleLowerCase('tr-TR');
                    if (searchStr.includes(searchTerm)) {
                        results.push({ item, index, repo, isDemirbasStrict: isDem, qty });
                    }
                }
            });
        });
        if (results.length === 0) {
            list.innerHTML = `<div style="padding:10px; color:var(--color-text-muted);">Ürün bulunamadı veya stokta yok.</div>`;
        } else {
            results.forEach(res => {
                const div = document.createElement('div');
                div.style.padding = '8px';
                div.style.borderBottom = '1px solid var(--color-border-light)';
                div.style.cursor = 'pointer';
                if (res.isDemirbasStrict) {
                    div.innerHTML = `🛡️ <b>${escapeHtml(res.item.ürün || res.item.name || "-")}</b> - ${escapeHtml(res.item.marka || "")} (Stok: ${escapeHtml(res.qty)}) <br><small>Raf: ${escapeHtml(res.item.raf || "-")} / Sütun: ${escapeHtml(res.item.sütun || "-")}</small>`;
                    div.style.backgroundColor = 'var(--color-surface)';
                    div.style.color = 'var(--color-text)';
                } else {
                    div.innerHTML = `📦 <b>${escapeHtml(res.item.ürün || res.item.name || "-")}</b> - ${escapeHtml(res.item.marka || "")} (Stok: ${escapeHtml(res.qty)}) <br><small>Raf: ${escapeHtml(res.item.raf || "-")} / Sütun: ${escapeHtml(res.item.sütun || "-")}</small>`;
                }
                div.onclick = function () {
                    const isAdmin = window.isDbAdmin();   // J3: adminVizesi bayrağı elle yazılabiliyordu
                    if (!isAdmin) {
                        const ok = window.ExitPolicy.eligibility(res.item, window.data.productTypes);
                        if (!ok.ok) { showAppAlert(ok.message, "warning"); return; }
                    }
                    addToCart(res);
                    document.getElementById('cartSearch').value = "";
                    list.style.display = 'none';
                };
                list.appendChild(div);
            });
        }
        list.style.display = 'block';
    };

    window.addToCart = function (res) {
        const exists = cartItems.find(c => c.repo === res.repo && String(c.item.id) === String(res.item.id));
        if (exists) {
            if (exists.exitQty < res.qty) { exists.exitQty++; renderCartItems(); }
            else showAppAlert("Stokta daha fazla yok!", "warning");
        } else {
            const max = window.ExitPolicy?.STAFF_MAX_ITEMS;
            if (!_isAdmin() && max && cartItems.length >= max) {
                showAppAlert(`Toplu çıkışta tek seferde en fazla ${max} farklı ürün ekleyebilirsiniz; kalanları ikinci bir çıkışla yapın.`, 'warning');
                return;
            }
            cartItems.push({ ...res, exitQty: 1 });
            renderCartItems();
        }
    };

    window.removeFromCart = function (cartIndex) {
        cartItems.splice(cartIndex, 1);
        renderCartItems();
    };

    window.renderCartItems = function () {
        const container = document.getElementById('cartItemsContainer');
        if (cartItems.length === 0) {
            container.innerHTML = '<p style="color: var(--color-text-muted); text-align: center; margin: 0;" id="emptyCartMsg">Sepet boş. Ürün arayarak listeye ekleyin.</p>';
            return;
        }
        let html = '';
        cartItems.forEach((cartItem, idx) => {
            html += `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px; border-bottom: 1px solid var(--color-border-light); background: var(--color-surface-alt); border-radius: 4px; margin-bottom: 4px;">
                <div style="flex: 1;">
                    <strong>${escapeHtml(cartItem.item.ürün || cartItem.item.name || "-")}</strong><br>
                    <small>${escapeHtml(cartItem.item.raf || "-")} / ${escapeHtml(cartItem.item.sütun || "-")}</small>
                </div>
                <div style="display: flex; align-items: center; gap: 10px;">
                    <input type="number" min="1" max="${escapeHtml(cartItem.qty)}" value="${escapeHtml(cartItem.exitQty)}" onchange="updateCartQty(${idx}, this.value)" style="width: 60px; padding: 4px; text-align: center;">
                    <button type="button" onclick="removeFromCart(${idx})" style="background: #e74c3c; color: white; border: none; border-radius: 4px; padding: 5px 8px; cursor: pointer;"><i class="fas fa-trash"></i></button>
                </div>
            </div>
            <div id="cartDev_${idx}" hidden></div>`;
        });
        container.innerHTML = html;
        // 3.9a: demirbaş kalemde adet kadar cihaz kimliği satırı; girilen değerler kalemde saklanır (yeniden çizimde kaybolmaz)
        cartItems.forEach((cartItem, idx) => {
            if (!window.Schema.isDemirbas(cartItem.item)) return;
            window.DeviceIds.render(document.getElementById(`cartDev_${idx}`), cartItem.exitQty,
                { values: cartItem.ids || [], onInput: v => { cartItem.ids = v; }, fixed: window.DeviceIds.fixedFor(cartItem.item) });
        });
    };

    window.updateCartQty = function (cartIndex, newVal) {
        const val = parseInt(newVal);
        const cartItem = cartItems[cartIndex];
        if (val > 0 && val <= cartItem.qty) {
            cartItem.exitQty = val;
            if (window.Schema.isDemirbas(cartItem.item)) renderCartItems();   // kimlik satırı sayısı adede uyar
        } else {
            renderCartItems();
            if (val > cartItem.qty) showAppAlert(`Stokta sadece ${cartItem.qty} adet var!`, "warning");
        }
    };

    window.saveCartExit = async function (event) {
        if (event) { event.preventDefault(); event.stopPropagation(); }
        if (cartItems.length === 0) { showAppAlert("Sepette çıkış yapılacak ürün yok!", "warning"); return; }
        if (!(typeof window.canExitStock === 'function' && window.canExitStock())) { showAppAlert(window.EXIT_STAFF_MESSAGE || window.EXIT_ADMIN_ONLY_MESSAGE, 'error'); return; }
        const isAdmin = _isAdmin();
        const receiver = window.ExitReceiver ? window.ExitReceiver.resolve('cart', isAdmin) : null;
        if (!receiver) return;
        const alanKisi = receiver.name;
        const personelId = receiver.id;
        const islemYapanUid = window.userAuth?.uid;
        const not = document.getElementById('cartNote').value || "-";
        const sn = document.getElementById('cartSn').value || "-";
        const tarih = getTurkiyeSaati();

        const stock = [], writes = [], allDeviceIds = [];
        const snGiven = sn !== '-' && sn.trim() !== '';
        for (const cartItem of cartItems) {
            const product = (window.data[cartItem.repo] || []).find(x => x && String(x.id) === String(cartItem.item.id));
            const name = cartItem.item.ürün || cartItem.item.name || '-';
            if (!product) { showAppAlert(`"${name}" artık listede yok; sepetten çıkarın.`, 'error'); return; }
            const qty = Number(cartItem.exitQty);
            if (!Number.isInteger(qty) || qty < 1) { showAppAlert('Adetler en az 1 olan tam sayı olmalıdır.', 'warning'); return; }
            let staffType = null;
            if (!isAdmin) {
                const ok = window.ExitPolicy.eligibility(product, window.data.productTypes);
                if (!ok.ok) { showAppAlert(`"${name}": ${ok.message}`, 'warning'); return; }
                staffType = ok.typeId;
            }
            stock.push({ col: cartItem.repo, id: product.id, delta: -qty });
            // Kanonik b3 kaydı (3.6) — tekil çıkışla aynı kurucu, aynı alanlar.
            // Demirbaş (3.9a): kalem başına adet kadar kimlik, her cihaz ayrı kayıt; ortak SN/ITSM alanı nota "Ref" olarak eklenir.
            if (window.Schema.isDemirbas(product)) {
                const box = document.getElementById(`cartDev_${cartItems.indexOf(cartItem)}`);
                const chk = window.AssignmentService.checkDeviceIds({ demirbas: true, qty, ids: box ? window.DeviceIds.read(box) : (cartItem.ids || []), label: `"${name}": ` });
                if (!chk.ok) { showAppAlert(chk.errors[0], 'warning'); return; }
                allDeviceIds.push(...chk.ids);
                const refNot = snGiven ? `${not === '-' ? '' : not + ' · '}Ref: ${sn}` : not;
                chk.ids.forEach(d => writes.push({ op: 'set', col: 'b3', item: window.Schema.buildB3Entry({
                    tip: 'cikis', product, col: cartItem.repo, adet: 1, sn: d.sn, envanterNo: d.envanterNo, not: refNot, alanKisi, tarih, personelId, islemYapanUid,
                }) }));
            } else {
                if (!snGiven) { showAppAlert(`"${name}" (sarf) için "ITSM / Gerekçe" alanını doldurun.`, 'warning'); return; }
                writes.push({ op: 'set', col: 'b3', item: window.Schema.buildB3Entry({
                    tip: 'cikis', product, col: cartItem.repo, adet: qty, sn, not, alanKisi, tarih, personelId, islemYapanUid,
                    ...(staffType ? { urunTuruId: staffType, isDemirbas: false } : {}),
                }) });
            }
        }
        // aynı cihaz iki farklı kalemde girilmiş olmasın
        const dupCheck = window.Schema.validateDeviceIds({ demirbas: true, qty: allDeviceIds.length, ids: allDeviceIds });
        if (!dupCheck.ok) { showAppAlert(dupCheck.errors[0], 'warning'); return; }

        let res;
        try {
            res = await window.runStockOps({ stock, writes }, isAdmin ? undefined
                : { staffExit: true, forbiddenMessage: window.ExitPolicy.MESSAGES.serverDenied });
        } catch (e) {
            showAppAlert(`Toplu çıkış yapılamadı; hiçbir kalem kaydedilmedi. ${e.message || ''}`, 'error');
            return;
        }
        showAppAlert(`${stock.length} ürün kalemi için toplu çıkış kaydedildi. ${res.stock.map(s => `${s.name}: ${s.before}→${s.after}`).join(' · ')}`, "success");
        closeModal('cartModal');
        if (typeof renderExitTable === 'function') renderExitTable();
        ['b1', 'b2'].forEach(r => { if (typeof renderTable === 'function') renderTable(r); });
    };
})();

window.searchForExit = function () {
    const filter = document.getElementById('exitSearch').value.toLocaleLowerCase('tr-TR');
    const list = document.getElementById('productList');
    list.innerHTML = '';
    if (!filter) return;
    const allProducts = [
        ...(window.data.b1 || []).map((item, index) => ({ ...item, _repo: 'b1', _index: index })),
        ...(window.data.b2 || []).map((item, index) => ({ ...item, _repo: 'b2', _index: index }))
    ].filter(item => !window.Schema?.isRowCountLocked?.(item));   // v3.6: sayımdaki raf
    const results = allProducts.filter(item =>
        ((item.ürün || item.name || '')?.toLocaleLowerCase('tr-TR').includes(filter)) ||
        ((item.marka || item.tür || item.type || '')?.toLocaleLowerCase('tr-TR').includes(filter)) ||
        ((item.raf || item.shelf || '')?.toLocaleLowerCase('tr-TR').includes(filter)) ||
        ((item.açıklama || '')?.toLocaleLowerCase('tr-TR').includes(filter)) ||
        ((item.envanterNo || '')?.toLocaleLowerCase('tr-TR').includes(filter))
    ).slice(0, 10);

    // v3.4: personel için demirbaş / türü belirsiz ürünler listede görünür ama seçilemez (neden yazılır)
    const isAdmin = typeof window.isDbAdmin === 'function' && window.isDbAdmin();
    results.forEach(item => {
        const div = document.createElement('div');
        div.className = 'product-item';
        div.style.padding = '8px';
        div.style.borderBottom = '1px solid #eee';
        div.style.cursor = 'pointer';
        const stock = item.adet !== undefined ? item.adet : (item.qty || 0);
        div.innerHTML = `<strong>${escapeHtml(item.ürün || item.name || '-')}</strong> <small>(${escapeHtml(item.marka || item.tür || '-')})</small><br><span style="font-size: 0.85em; color: #666;">Raf: ${escapeHtml(item.raf || item.shelf || '-')} | Stok: ${escapeHtml(stock)} | Depo: ${escapeHtml(item._repo.toUpperCase())}</span>`;
        const policy = !isAdmin && window.ExitPolicy ? window.ExitPolicy.eligibility(item, window.data.productTypes) : { ok: true };
        if (!policy.ok) {
            const note = document.createElement('div');
            note.className = 'exit-item-locked';
            note.textContent = policy.reason === 'demirbas' ? '🛡️ Demirbaş — yalnız yönetici çıkış yapar; "Envanter Talep Et" kullanın.' : '🔒 Türü listede birebir bulunamadı — çıkışı yönetici yapar.';
            div.append(note);
            div.style.opacity = '0.6';
            div.onclick = () => showAppAlert(policy.message, 'warning');
        } else if (stock > 0) {
            div.onclick = () => window.selectProduct(item.ürün || item.name, item.tür || item.type || item.marka, item.raf || item.shelf, stock, item._repo, item._index, item.id);
        } else {
            div.style.opacity = '0.5'; div.style.pointerEvents = 'none'; div.innerHTML += ' <b style="color:red;">(STOK YOK)</b>';
        }
        list.appendChild(div);
    });
};

window.AppModules = window.AppModules || {};
window.AppModules.ExitCart = Object.freeze({
    openCartModal: window.openCartModal, searchForCart: window.searchForCart, addToCart: window.addToCart,
    removeFromCart: window.removeFromCart, renderCartItems: window.renderCartItems, updateCartQty: window.updateCartQty,
    saveCartExit: window.saveCartExit, searchForExit: window.searchForExit
});
