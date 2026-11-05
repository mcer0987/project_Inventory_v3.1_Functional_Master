// [WHY]: v3.4 · Personel (BT ekibi) çıkışı — envanter çıkışı yalnız yöneticideydi. BT ekibinin sarf malzeme çıkışı yapabilmesi,
//        demirbaş çıkışının ise yine yalnız yöneticide kalması gerekiyor. Karar hem arayüzde hem Firestore kurallarında aynı
//        ölçütle verilmeli; ikisi ayrışırsa personel formu doldurup sunucuda reddedilir.
// [HOW]: Saf fonksiyonlar (DOM / Firebase yok, birim testli):
//          eligibility(product, productTypes) → personel bu ürünün çıkışını yapabilir mi? Ölçüt firestore.rules
//            staffExitB3Ok ile BİREBİR aynı: ürünün türü (tür/type) kataloğda KIRPILMIŞ ADIYLA birebir bulunan bir türe
//            denk gelmeli ve o türün isDemirbas alanı tam olarak false olmalı. Tür kataloğda yoksa ya da ad farklı
//            yazılmışsa (büyük/küçük harf dahil) karar verilemez → çıkış yöneticiye kalır (güvenli taraf).
//          checkStaffPlan(stock, writes) → personelin gönderdiği işlem yalnız "stok düşümü + her ürün için TEK b3 çıkış
//            kaydı" olabilir; aynı kayıt ürüne sonCikisId olarak bağlanır (kurallar bu bağla düşülen adedi doğrular).
(function () {
    const STOCK_COLS = ['b1', 'b2'];
    // Personel toplu çıkışında en fazla kalem: kurallar kalem başına birkaç belge okur; emülatör ölçümünde 7 kalem geçti,
    // 8 kalem Firestore'un istek başına belge erişimi sınırına takıldı (tests/rules/staff-exit.test.mjs). Bir kalem pay.
    const STAFF_MAX_ITEMS = 6;
    const trimmed = v => (typeof v === 'string' ? v.trim() : '');

    const MESSAGES = Object.freeze({
        demirbas: 'Bu ürün demirbaştır. Demirbaş çıkışını yalnız yönetici yapar; "Envanter Talep Et" ile yöneticiye talep gönderin.',
        unknownType: 'Bu ürünün türü ürün türleri listesinde birebir bulunamadı; çıkışı yönetici yapabilir ya da "Envanter Talep Et" ile talep gönderebilirsiniz.',
        noProduct: 'Ürün bulunamadı; liste güncellenmiş olabilir.',
    });

    function productTypeName(product) {
        if (!product || typeof product !== 'object') return '';
        return trimmed(product.tür) || trimmed(product.type);
    }

    // → { ok: true, typeId, typeName } | { ok: false, reason: 'demirbas'|'unknownType'|'noProduct', message }
    function eligibility(product, productTypes) {
        if (!product) return { ok: false, reason: 'noProduct', message: MESSAGES.noProduct };
        const name = productTypeName(product);
        const type = name ? (Array.isArray(productTypes) ? productTypes : [])
            .find(t => t && typeof t.id === 'string' && t.id && trimmed(t.name) === name) : null;
        if (!type) return { ok: false, reason: 'unknownType', message: MESSAGES.unknownType };
        if (type.isDemirbas !== false) return { ok: false, reason: 'demirbas', message: MESSAGES.demirbas };
        return { ok: true, typeId: type.id, typeName: name };
    }

    // stock: [{ col, id, delta }]  writes: [{ op, col, id, data }] (runStockOps'un hazırladığı biçim)
    // → { ok: true, links: Map('col|id' → b3Id) } | { ok: false, error }
    function checkStaffPlan(stock, writes) {
        const fail = error => ({ ok: false, error });
        if (!Array.isArray(stock) || !stock.length) return fail('Personel çıkışı en az bir ürün içermelidir.');
        if (stock.length > STAFF_MAX_ITEMS) return fail(`Personel toplu çıkışı tek seferde en fazla ${STAFF_MAX_ITEMS} farklı ürün içerebilir; kalanları ikinci bir çıkışla yapın.`);
        if (!Array.isArray(writes) || writes.length !== stock.length) return fail('Personel çıkışında her ürün için tek bir çıkış kaydı olmalıdır.');
        const links = new Map();
        for (const s of stock) {
            if (!s || !STOCK_COLS.includes(s.col) || !Number.isInteger(s.delta) || s.delta >= 0) return fail('Personel yalnız stok düşen çıkış yapabilir.');
            if (s.createIfMissing) return fail('Personel stok kaydı oluşturamaz.');
            const key = `${s.col}|${s.id}`;
            if (links.has(key)) return fail('Aynı ürün çıkışta iki kez yer alamaz.');
            const w = writes.find(x => x && x.op === 'set' && x.col === 'b3' && x.data
                && x.data.kaynakDepo === s.col && String(x.data.productId) === String(s.id));
            if (!w) return fail('Her ürün için bir çıkış kaydı gerekir.');
            const d = w.data;
            if (d.tip !== 'cikis') return fail('Personel yalnız çıkış kaydı oluşturabilir.');
            if (d.isDemirbas !== false) return fail(MESSAGES.demirbas);
            if (d.adet !== -s.delta) return fail('Çıkış kaydındaki adet stok düşümüyle aynı olmalıdır.');
            if (!trimmed(d.urunTuruId)) return fail(MESSAGES.unknownType);
            if (!trimmed(d.islemYapanUid)) return fail('Çıkışı yapan kişi belirlenemedi.');
            links.set(key, String(w.id));
        }
        if (writes.some(w => !w || w.op !== 'set' || w.col !== 'b3')) return fail('Personel çıkışında yalnız çıkış kaydı yazılabilir.');
        if (new Set([...links.values()]).size !== links.size) return fail('Çıkış kayıtları birbirinden farklı olmalıdır.');
        return { ok: true, links };
    }

    window.ExitPolicy = Object.freeze({ eligibility, checkStaffPlan, productTypeName, MESSAGES, STAFF_MAX_ITEMS });
})();
