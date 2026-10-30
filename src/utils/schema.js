/**
 * utils/schema.js — Veri şeması yardımcıları (klasik script, iki sayfada <head>'de html.js'ten hemen sonra)
 * Faz 3.3: makeId. Faz 3.6: şema sözleşmesi — normName, isDemirbas, normalizeStock, normalizeB3 / buildB3Entry /
 * validateB3 / toCanonicalB3, normalizeRequest. v3.3 Aşama 1: raf/slot sözleşmesi (normShelfCode, isSlotOccupying,
 * computeUsedSlots, shelfDocId, validateShelfDoc). Fonksiyonlar window.data'yı çağrı anında okur (yükleme sırası önemsiz).
 */
// [WHY]: Kayıt id'leri Date.now(), Date.now()+Math.random() (ondalıklı id) ve 'temp_…' ile üretiliyordu; aynı milisaniyede
//        oluşan iki kayıt aynı dokümana düşüp merge ile birleşebiliyordu (DATA-12).
// [HOW]: makeId() sayısal ve zaman sıralı bir id döner: Date.now()·1000 + 0–999 arası rastgele sayı; aynı sekmede her
//        çağrı bir öncekinden büyüktür (tekrar yok). 2^53 sınırının altında kalır (~2255 yılına kadar).
//        Bilinçli olarak UUID değil: kodda Number(x.id) === Number(id) karşılaştırmaları ve b.id - a.id sıralamaları var;
//        UUID bunları sessizce bozardı (NaN). Id karşılaştırmaları String'e çevrildiğinde (Faz 3 H2) UUID'ye geçilebilir.
(function () {
    let last = 0;

    function makeId() {
        let id = Date.now() * 1000 + Math.floor(Math.random() * 1000);
        if (id <= last) id = last + 1;
        last = id;
        return id;
    }

    // ─── 3.6 · Şema sözleşmesi (DATA-08, INV-08, KN-6) ──────────────────────────────────────────────────────────
    // [WHY]: b3 dört ayrı yerde dört ayrı biçimde yazılıyordu (çıkış formu rafNo/urunTuru/urunAciklama/adet; talep onayı ve
    //        admin zimmeti shelfNo/productType(=ürün ADI)/sarfAdet/note/date). Okuyucular birini bilip ötekini bilmediği için
    //        kolonlar boş kalıyor, ürün türü o an depodaki üründen aranıyor (ürün taşınınca/silinince "-"), stok dışı onayda Raf
    //        No'ya "TALEP" basılıyordu. Tur 2.5'te yalnız okuyucu yamandığı için sorun yeni kayıtlarda geri geldi.
    // [HOW]: Tek kanonik b3 şeması (B3_KEYS, sema: 2). Yazan her yol buildB3Entry() ile kayıt kurar: ürün türü, raf, sütun,
    //        marka ve depo YAZMA ANINDA kayda kopyalanır. Okuyan her yol normalizeB3() kullanır: eski biçimleri de tanır,
    //        eksik türü/rafı ürünü iki depoda da arayarak tamamlar. validateB3() sözleşme testinin ve göçün ölçütüdür.
    const B3_SCHEMA_VERSION = 2;
    const STOK_DISI = 'stok-disi';
    // Faz 5 · K2 (5.10): 'hurda' — demirbaş/sarf kaleminin resmi hurdaya ayırma hareketi (bkz. buildB3Entry/normalizeB3).
    const B3_TIP = Object.freeze({ CIKIS: 'cikis', ZIMMET: 'zimmet', HURDA: 'hurda' });
    const B3_KEYS = Object.freeze([
        'id', 'sema', 'tip', 'kaynakDepo', 'productId', 'requestId',
        'rafNo', 'sutun', 'urunTuru', 'urunAciklama', 'marka', 'adet', 'sn', 'envanterNo',
        'not', 'alanKisi', 'personelId', 'tarih', 'ts', 'isDemirbas',
        'talepTuru', 'oncelik', 'iadeTarihi', 'iadeEdildi', 'iadeEdildiTarihi', 'iadeDepo', 'onaylayan'
    ]);
    // Eski şemaların kanonik karşılığı olan alanları (göçte kaldırılır; kanonik kayıtta bulunmamalı).
    const B3_LEGACY_KEYS = Object.freeze([
        'shelfNo', 'productType', 'sarfAdet', 'note', 'date', 'person', 'personel', 'sourceRepo', 'approvedBy',
        'sütun', 'ürün', 'tür', 'ürünTürü'
    ]);

    const isBlank = v => v === undefined || v === null || String(v).trim() === '' || String(v).trim() === '-';
    const pick = (...vals) => { const v = vals.find(x => !isBlank(x)); return v === undefined ? undefined : String(v).trim(); };
    const truthy = v => v === true || v === 'true';
    const txt = v => isBlank(v) ? '-' : String(v).trim();

    // Türkçe güvenli ad karşılaştırması: "Muhammed CER" = "Muhammed Cer", "ISMAIL" = "İsmail", fazla boşluk yok sayılır.
    function normName(s) {
        return String(s ?? '').normalize('NFC').replace(/\s+/g, ' ').trim()
            .toLocaleLowerCase('tr-TR').replace(/̇/g, '').replace(/ı/g, 'i');
    }

    // makeId (µs ölçekli) ve eski Date.now() (ms) id'lerinden zaman damgası (ms).
    function idToTs(id) {
        const n = Number(id);
        if (!Number.isFinite(n) || n <= 0) return 0;
        return n > 1e14 ? Math.floor(n / 1000) : n;
    }

    function productTypes() {
        if (typeof window.getActiveProductTypes === 'function') return window.getActiveProductTypes() || [];
        return (window.data && window.data.productTypes) || [];
    }

    // [WHY]: Demirbaş kararı üç yerde üç farklı kuralla veriliyordu (script.js checkIsDemirbas, admin zimmetinde yalnız
    //        isDemirbas bayrağı, çıkış formunda dataset). Tek kural: ürün türü tanımı → kayıttaki bayrak → adı bir tür adı mı.
    function isDemirbas(item) {
        if (!item) return false;
        const types = productTypes();
        const typeOf = name => { const n = normName(name); return n ? types.find(t => t && normName(t.name) === n) : null; };
        const byType = typeOf(pick(item.tür, item.urunTuru, item.productType, item.type));
        if (byType) return truthy(byType.isDemirbas);
        if (item.isDemirbas !== undefined && item.isDemirbas !== null) return truthy(item.isDemirbas);
        const byName = typeOf(pick(item.ürün, item.urunAciklama));
        return byName ? truthy(byName.isDemirbas) : false;
    }

    // Stok kaleminin (b1/b2) okunabilir görünümü; iki depo şemasını (durumu/status, ürün/name, adet/qty) birleştirir.
    function normalizeStock(p, col) {
        if (!p) return null;
        return {
            id: p.id, col: col || null,
            ad: pick(p.ürün, p.name) ?? '-',
            tur: pick(p.tür, p.type) ?? '-',
            marka: pick(p.marka) ?? '',
            raf: pick(p.raf, p.shelf) ?? '-',
            sutun: pick(p.sütun, p.sutun) ?? '-',
            adet: parseInt(p.adet ?? p.qty ?? 0, 10) || 0,
            durum: pick(col === 'b2' ? p.status : p.durumu, p.durumu, p.status) ?? '',
            isDemirbas: isDemirbas(p),
        };
    }

    // Ürünü id ile bulur; önce verilen depoda, sonra b1 ve b2'de (ürün sonradan başka depoya sevk edilmiş olabilir).
    function findStock(productId, preferred) {
        if (productId === undefined || productId === null || productId === '') return null;
        const order = [preferred, 'b1', 'b2'].filter((c, i, a) => (c === 'b1' || c === 'b2') && a.indexOf(c) === i);
        for (const col of order) {
            const product = ((window.data && window.data[col]) || []).find(x => x && String(x.id) === String(productId));
            if (product) return { col, product };
        }
        return null;
    }

    const nowText = () => (typeof window.getTurkiyeSaati === 'function' ? window.getTurkiyeSaati() : new Date().toLocaleString('tr-TR'));

    /**
     * Kanonik b3 kaydı kurar. Stoktan çıkan kayıtta ürün (product + col) verilir; stok dışı (talep onayı, stok seçilmeden)
     * kayıtta verilmez → kaynakDepo 'stok-disi', productId null, ad/tür çağıranın verdiği metinden.
     * @param {{tip:'cikis'|'zimmet', product?:object, col?:'b1'|'b2', adet:number, sn?:string, envanterNo?:string,
     *          not?:string, alanKisi:string, personelId?:string, requestId?:*, talepTuru?:string, oncelik?:string,
     *          iadeTarihi?:string, onaylayan?:string, tarih?:string, urunAciklama?:string, urunTuru?:string,
     *          isDemirbas?:boolean, id?:*}} o
     */
    function buildB3Entry(o) {
        const v = o.product ? normalizeStock(o.product, o.col) : null;
        const zimmet = o.tip === B3_TIP.ZIMMET;
        const hurda = o.tip === B3_TIP.HURDA;
        return {
            id: o.id ?? makeId(),
            sema: B3_SCHEMA_VERSION,
            tip: zimmet ? B3_TIP.ZIMMET : (hurda ? B3_TIP.HURDA : B3_TIP.CIKIS),
            kaynakDepo: v ? o.col : STOK_DISI,
            productId: v ? v.id : null,
            requestId: o.requestId ?? null,
            rafNo: v ? v.raf : '-',
            sutun: v ? v.sutun : '-',
            urunTuru: txt(pick(o.urunTuru, v && v.tur)),
            urunAciklama: txt(pick(o.urunAciklama, v && v.ad)),
            marka: v ? v.marka : (pick(o.marka) ?? ''),
            adet: Number(o.adet),
            sn: txt(o.sn),
            envanterNo: txt(o.envanterNo),
            not: txt(o.not),
            alanKisi: txt(o.alanKisi),
            personelId: isBlank(o.personelId) ? null : String(o.personelId),
            tarih: txt(o.tarih ?? nowText()),
            ts: Date.now(),
            isDemirbas: typeof o.isDemirbas === 'boolean' ? o.isDemirbas : (v ? v.isDemirbas : false),
            talepTuru: zimmet ? (pick(o.talepTuru) ?? 'Kalıcı Zimmet') : null,
            oncelik: zimmet ? (pick(o.oncelik) ?? 'Orta') : null,
            iadeTarihi: pick(o.iadeTarihi) ?? null,
            iadeEdildi: false,
            iadeEdildiTarihi: null,
            iadeDepo: null,
            onaylayan: pick(o.onaylayan) ?? null,
        };
    }

    /**
     * Herhangi bir biçimdeki b3 kaydının okunabilir, kanonik görünümü (kaydı değiştirmez). Metin alanları eksikse '-'.
     * rafNo stok dışı kayıtta "Stok dışı"; tür/raf kayıtta yoksa ürün iki depoda da aranarak tamamlanır.
     */
    function normalizeB3(item) {
        if (!item) return null;
        const repoRaw = pick(item.kaynakDepo, item.sourceRepo);
        const stokDisi = repoRaw === STOK_DISI || repoRaw === 'TALEP'
            || (!repoRaw && (item.productId === undefined || item.productId === null) && item.shelfNo === 'TALEP');
        const found = !stokDisi ? findStock(item.productId, repoRaw) : null;
        const v = found ? normalizeStock(found.product, found.col) : null;
        const hasZimmetMarks = pick(item.talepTuru, item.oncelik) !== undefined
            || (item.requestId !== undefined && item.requestId !== null);
        const tip = [B3_TIP.CIKIS, B3_TIP.ZIMMET, B3_TIP.HURDA].includes(item.tip) ? item.tip : (hasZimmetMarks ? B3_TIP.ZIMMET : B3_TIP.CIKIS);
        const zimmet = tip === B3_TIP.ZIMMET;
        return {
            id: item.id,
            legacy: item.sema !== B3_SCHEMA_VERSION,
            tip,
            stokDisi,
            kaynakDepo: stokDisi ? STOK_DISI : (repoRaw === 'b1' || repoRaw === 'b2' ? repoRaw : (found ? found.col : null)),
            productId: item.productId ?? null,
            requestId: item.requestId ?? null,
            rafNo: stokDisi ? 'Stok dışı' : (pick(item.rafNo, item.shelfNo === 'TALEP' ? '' : item.shelfNo, v && v.raf) ?? '-'),
            sutun: pick(item.sutun, item.sütun, v && v.sutun) ?? '-',
            urunTuru: pick(item.urunTuru, item.tür, v && v.tur) ?? '-',
            // eski onay/zimmet kayıtlarında productType ürünün ADIDIR (tür değil)
            urunAciklama: pick(item.urunAciklama, item.productType, item.ürün, item.ürünTürü, v && v.ad) ?? '-',
            marka: pick(item.marka, v && v.marka) ?? '',
            adet: Number(pick(item.adet, item.sarfAdet)) || 0,
            sn: pick(item.sn) ?? '-',
            envanterNo: pick(item.envanterNo) ?? '-',
            not: pick(item.not, item.note) ?? '-',
            alanKisi: pick(item.alanKisi, item.person, item.personel) ?? '-',
            personelId: pick(item.personelId) ?? null,
            tarih: pick(item.tarih, item.date) ?? '-',
            ts: Number(item.ts) || idToTs(item.id),
            isDemirbas: item.isDemirbas !== undefined && item.isDemirbas !== null ? truthy(item.isDemirbas) : (v ? v.isDemirbas : false),
            talepTuru: zimmet ? (pick(item.talepTuru) ?? 'Kalıcı Zimmet') : null,
            oncelik: zimmet ? (pick(item.oncelik) ?? 'Orta') : null,
            iadeTarihi: pick(item.iadeTarihi) ?? null,
            iadeEdildi: truthy(item.iadeEdildi),
            iadeEdildiTarihi: pick(item.iadeEdildiTarihi) ?? null,
            iadeDepo: pick(item.iadeDepo) ?? null,
            onaylayan: pick(item.onaylayan, item.approvedBy) ?? null,
        };
    }

    // Göç için: kaydın kanonik hali. Kanonik karşılığı olan eski alanlar kaldırılır, karşılığı olmayanlar (description vb.)
    // veri kaybı olmasın diye korunur; stok dışı kayıtta raf '-' saklanır ("Stok dışı" yalnız gösterimdir). Deposu kayıtta
    // yazmayan ve ürünü artık bulunamayan eski kayıtta kaynakDepo null kalır ("stok dışı" sayılmaz — rafı korunur).
    function toCanonicalB3(item) {
        const n = normalizeB3(item);
        const rest = { ...item };
        B3_LEGACY_KEYS.forEach(k => { delete rest[k]; });
        const out = { ...rest, sema: B3_SCHEMA_VERSION };
        B3_KEYS.forEach(k => { if (k !== 'sema') out[k] = n[k]; });
        if (n.stokDisi) out.rafNo = '-';
        return out;
    }

    // Sözleşme: eksik/fazla alan, eski alan, geçersiz tip/depo/adet → hata listesi (boş = geçerli).
    // { legacy: true } (yalnız göç): deposu bilinmeyen eski kayıtta kaynakDepo null olabilir. Yeni yazmalar bunu kullanmaz.
    function validateB3(e, opts = {}) {
        const errors = [];
        if (!e || typeof e !== 'object') return ['kayıt yok'];
        B3_KEYS.forEach(k => { if (!Object.prototype.hasOwnProperty.call(e, k) || e[k] === undefined) errors.push(`eksik alan: ${k}`); });
        B3_LEGACY_KEYS.forEach(k => { if (Object.prototype.hasOwnProperty.call(e, k)) errors.push(`eski alan: ${k}`); });
        if (e.sema !== B3_SCHEMA_VERSION) errors.push('sema != 2');
        if (![B3_TIP.CIKIS, B3_TIP.ZIMMET, B3_TIP.HURDA].includes(e.tip)) errors.push(`geçersiz tip: ${e.tip}`);
        const unknownDepot = opts.legacy === true && e.kaynakDepo === null;
        if (!unknownDepot && !['b1', 'b2', STOK_DISI].includes(e.kaynakDepo)) errors.push(`geçersiz kaynakDepo: ${e.kaynakDepo}`);
        if (!unknownDepot && (e.kaynakDepo === STOK_DISI) !== (e.productId === null)) errors.push('productId / kaynakDepo uyumsuz');
        if (!Number.isInteger(e.adet) || e.adet < 1) errors.push(`geçersiz adet: ${e.adet}`);
        if (e.tip === B3_TIP.ZIMMET && (isBlank(e.talepTuru) || isBlank(e.oncelik))) errors.push('zimmet: talepTuru/oncelik yok');
        if (typeof e.isDemirbas !== 'boolean') errors.push('isDemirbas boolean değil');
        // 3.9a: demirbaş hareketi cihaz başınadır ve kimliklidir (eski kayıtlar göçte bu kurala takılmaz)
        if (e.isDemirbas === true && opts.legacy !== true) {
            if (isBlank(e.sn) && isBlank(e.envanterNo)) errors.push('demirbaş: Seri No veya Envanter No yok');
            if (e.adet !== 1) errors.push('demirbaş: cihaz başına bir kayıt (adet 1) olmalı');
        }
        return errors;
    }

    // ─── 5.8 · B1/B2 şema sözleşmesi (Faz 5 · K2 · INV-05/06/07 desteği) ────────────────────────────────────────
    // [WHY]: B3'te 3.6'da kapatılan dağınıklığın aynısı b1/b2'de de var: b2 hem 'durumu' hem 'status' yazıyor, bazı eski
    //        kayıtlar İngilizce takma adlarla (name/type/shelf/qty) gelmiş, hiçbir yazma yolu doğrulanmıyordu. Sevk/transfer
    //        ve hurda akışları (K2) yeni kod yazdıkça aynı dağınıklık büyüyecekti.
    // [HOW]: B3'teki sözleşme modeliyle aynı desen: *_KEYS kanonik alan listesi, *_LEGACY_KEYS eski takma adlar,
    //        validateB1/validateB2 'set' (tam kayıt, hepsi zorunlu) ve 'update' ({partial:true}; aynı alan/tip kuralları)
    //        ayrımıyla. B3'ten farklı olarak 'sema' alanı yok (b1/b2 hiç taşımadı, şimdi eklemek gereksiz kayma
    //        yaratır); içerik denetimi de B3 kadar katı değil — yalnız tip/şekil denetlenir, iş kuralı (ad boş olamaz, adet
    //        negatif olamaz vb.) dışında alanların boş olması geçerlidir (ör. marka, durumu boş string olabilir — mevcut
    //        davranış, bkz. computeStockPatch'in STOCK_AUTO_READY listesindeki '').
    const B1_KEYS = Object.freeze(['id', 'sütun', 'raf', 'tür', 'ürün', 'marka', 'adet', 'durumu', 'açıklama', 'isDemirbas', 'lastUpdate']);
    const B1_LEGACY_KEYS = Object.freeze(['name', 'type', 'shelf', 'qty', 'status']);
    // B2 hem 'durumu' hem 'status' yazar (saveProduct her ikisini de set eder); bu yüzden B2_KEYS'te ikisi de zorunlu.
    const B2_KEYS = Object.freeze(['id', 'sütun', 'raf', 'tür', 'ürün', 'marka', 'adet', 'durumu', 'status', 'açıklama', 'isDemirbas', 'lastUpdate']);
    const B2_LEGACY_KEYS = Object.freeze(['name', 'type', 'shelf', 'qty']);
    // v3.3 P1 (Astra · Katı Şema): TAM KAPALI sözleşme — zorunlu (*_KEYS) + isteğe bağlı (*_OPTIONAL_KEYS) dışında hiçbir alan
    //        yazılamaz. İsteğe bağlı küme, canlı yazıcıların envanteridir (yeni alan "uydurulmadı"):
    //          isWatched       — FAB "takip" (toggleWatch → updateItem)
    //          limit           — kritik stok eşiği (Excel içe aktarma; panel ve Excel raporu okur). null = tanımsız.
    //          stokOncekiDurum — stok 0'a düşerken saklanan önceki durum (computeStockPatch); tam kayıt yazan yollar
    //                            (saveData / upsertItem / geri yükleme) kaydı bu alanla birlikte yeniden yazar.
    //          envanterNo      — YALNIZ B2 (demirbaş kimliği). B1 sözleşmesi bu alanı REDDEDER; B1 Excel içe aktarması
    //                            sütunu tanır ama değeri hiç yazmaz (stock-import.js).
    const B1_OPTIONAL_KEYS = Object.freeze(['isWatched', 'limit', 'stokOncekiDurum']);
    const B2_OPTIONAL_KEYS = Object.freeze([...B1_OPTIONAL_KEYS, 'envanterNo']);
    const STOCK_STRING_KEYS = Object.freeze(['sütun', 'raf', 'tür', 'marka', 'açıklama', 'durumu', 'status', 'envanterNo', 'stokOncekiDurum']);

    const B1_SPEC = Object.freeze({ required: B1_KEYS, optional: B1_OPTIONAL_KEYS, legacy: B1_LEGACY_KEYS, label: 'B1' });
    const B2_SPEC = Object.freeze({ required: B2_KEYS, optional: B2_OPTIONAL_KEYS, legacy: B2_LEGACY_KEYS, label: 'B2' });
    const B2_ONLY_KEYS = Object.freeze(B2_SPEC.required.concat(B2_SPEC.optional).filter(k => !B1_KEYS.includes(k) && !B1_OPTIONAL_KEYS.includes(k)));

    /**
     * 'set' (tam kayıt) ve 'update' ({partial:true} — kısmi alan kümesi) AYNI alan ve tip kurallarını kullanır; update YALNIZ
     * "eksik zorunlu alan" denetiminden muaftır. Bilinmeyen alan, eski takma ad ve yanlış tip her iki yolda da reddedilir.
     */
    function _validateStock(e, spec, opts) {
        if (!e || typeof e !== 'object' || Array.isArray(e)) return ['kayıt yok'];
        const errors = [];
        const has = k => Object.prototype.hasOwnProperty.call(e, k);
        if (opts.partial !== true) {
            spec.required.forEach(k => { if (!has(k) || e[k] === undefined) errors.push(`eksik alan: ${k}`); });
        }
        Object.keys(e).forEach(k => {
            if (spec.legacy.includes(k)) errors.push(`eski alan: ${k}`);
            else if (spec === B1_SPEC && B2_ONLY_KEYS.includes(k)) errors.push(`${k} yalnız B2 (demirbaş) kaydında olabilir`);
            else if (!spec.required.includes(k) && !spec.optional.includes(k)) errors.push(`bilinmeyen alan: ${k}`);
        });
        if (has('id') && !((typeof e.id === 'string' && e.id.trim() !== '') || (typeof e.id === 'number' && Number.isFinite(e.id)))) {
            errors.push('id boş olmayan metin ya da sayı değil');
        }
        if (has('ürün')) {
            if (typeof e.ürün !== 'string') errors.push('ürün string değil');
            else if (isBlank(e.ürün)) errors.push('ürün adı boş olamaz');
        }
        if (has('adet') && (!Number.isInteger(e.adet) || e.adet < 0)) errors.push(`geçersiz adet: ${e.adet}`);
        if (has('limit') && e.limit !== null && (!Number.isInteger(e.limit) || e.limit < 0)) errors.push(`geçersiz limit: ${e.limit}`);
        if (has('isDemirbas') && typeof e.isDemirbas !== 'boolean') errors.push('isDemirbas boolean değil');
        if (has('isWatched') && typeof e.isWatched !== 'boolean') errors.push('isWatched boolean değil');
        if (has('lastUpdate') && typeof e.lastUpdate !== 'number') errors.push('lastUpdate sayı değil');
        STOCK_STRING_KEYS.forEach(k => { if (has(k) && typeof e[k] !== 'string') errors.push(`${k} string değil`); });
        return errors;
    }
    function validateB1(e, opts = {}) { return _validateStock(e, B1_SPEC, opts); }
    function validateB2(e, opts = {}) { return _validateStock(e, B2_SPEC, opts); }
    // Bir koleksiyonun sözleşmede yeri olan TÜM alan adları (zorunlu + isteğe bağlı) — saveData'nın eski biçimli kayıt yolu.
    function stockKnownKeys(col) {
        const spec = col === 'b2' ? B2_SPEC : B1_SPEC;
        return spec.required.concat(spec.optional);
    }

    // Değer eşitliği: undefined → "" (saveData'nın _clean'i ile aynı), nesne anahtar sırası önemsiz.
    function _sameValue(a, b) {
        const norm = v => JSON.stringify(v === undefined ? '' : v, (k, x) => {
            if (x === undefined) return '';
            if (x && typeof x === 'object' && !Array.isArray(x)) return Object.keys(x).sort().reduce((o, key) => { o[key] = x[key]; return o; }, {});
            return x;
        });
        return norm(a) === norm(b);
    }

    /**
     * Sözleşmeye henüz uymayan (eski biçimli) bir b1/b2 kaydının tam yeniden yazımı (saveData) için muhafız planı.
     * [WHY]: v3.3 P1 (Astra) — eski yol, kayıtta zaten bulunan sözleşme dışı alanları denetimden tümüyle çıkarıyordu; "eski
     *        alan korunabilir" kuralı farkında olmadan "eski alan doğrulanmadan DEĞİŞTİRİLEBİLİR" oluyordu (qty: 5 → -10
     *        hiçbir denetime girmeden Firestore'a yazılıyordu).
     * [HOW]: Sözleşme dışı (eski/bilinmeyen) bir alan YALNIZ değeri aynen kalıyorsa korunur; değeri değişmişse 'frozen'
     *        listesine girer ve çağıran işlemi REDDETMELİDİR (silme, eski değere döndürme ya da dönüştürme yapılmaz).
     *        Yeni eklenen alanlar ve değeri değişen sözleşme alanları 'checked'e girer ve validateB1/B2({partial:true})
     *        ile denetlenir. Saf fonksiyon: yazma yapmaz.
     * @returns {{checked:object, frozen:{key:string, before:*, after:*}[]}}
     */
    function legacyStockPatch(col, prev, next) {
        const known = stockKnownKeys(col);
        const checked = {}, frozen = [];
        Object.entries(next || {}).forEach(([k, v]) => {
            const existed = prev && Object.prototype.hasOwnProperty.call(prev, k);
            if (!existed) { checked[k] = v; return; }
            if (_sameValue(prev[k], v)) return;
            if (known.includes(k)) checked[k] = v;
            else frozen.push({ key: k, before: prev[k], after: v });
        });
        return { checked, frozen };
    }

    // [WHY]: Faz 5 denetimi (P1) — b1/b2 tam 'set' sözleşmesi saveData'da esnetilmişti, çünkü CSV/Excel içe aktarma
    //        "rafNo" (b1/b2'de alanın adı 'raf'), "limit" gibi alanlarla ve isDemirbas'sız kayıt üretiyordu; eski yedeklerde de
    //        İngilizce takma adlı (name/type/shelf/qty) kayıtlar var.
    // [HOW]: Tek kanonik kurucu: takma adların değeri kanonik alana taşınır ve takma ad silinir; eksik alan tipine uygun
    //        boş değerle tamamlanır; isDemirbas boolean değilse Schema.isDemirbas kuralıyla (ürün türü tanımı → bayrak →
    //        ad) üretilir; b2'de durumu/status birbirinden tamamlanır. Kanonik karşılığı olmayan alanlar (limit, isWatched,
    //        stokOncekiDurum…) korunur. Kanonik kayıt için idempotenttir. Değer UYDURULMAZ: adet tam sayıya çevrilemiyorsa
    //        olduğu gibi bırakılır ve validateB1/B2 reddeder (sessiz 0 yok).
    const STOCK_ALIASES = Object.freeze(['name', 'type', 'shelf', 'qty', 'rafNo', 'shelfNo', 'sutun']);
    function toCanonicalStock(p, col, opts = {}) {
        if (!p || typeof p !== 'object') return p;
        const isB2 = col === 'b2';
        const first = (...vals) => {
            const v = vals.find(x => x !== undefined && x !== null && x !== '');
            return v === undefined ? '' : (typeof v === 'string' ? v : String(v));
        };
        const out = { ...p };
        STOCK_ALIASES.forEach(k => { delete out[k]; });
        if (!isB2) delete out.status;

        const qtyRaw = p.adet ?? p.qty;
        let adet = qtyRaw;
        if (qtyRaw === undefined || qtyRaw === null || qtyRaw === '') adet = 0;
        else if (typeof qtyRaw === 'string' && /^\s*\d+\s*$/.test(qtyRaw)) adet = parseInt(qtyRaw, 10);

        let flag = p.isDemirbas;
        if (flag === 'true') flag = true;
        else if (flag === 'false') flag = false;

        Object.assign(out, {
            id: p.id,
            sütun: first(p.sütun, p.sutun),
            raf: first(p.raf, p.rafNo, p.shelf, p.shelfNo),
            tür: first(p.tür, p.type),
            ürün: first(p.ürün, p.name),
            marka: first(p.marka),
            adet,
            durumu: first(p.durumu, p.status),
            açıklama: first(p.açıklama),
        });
        out.isDemirbas = typeof flag === 'boolean' ? flag : isDemirbas({ ...out, isDemirbas: undefined });
        if (isB2) out.status = first(p.status, p.durumu);
        const lu = Number(p.lastUpdate);
        out.lastUpdate = typeof p.lastUpdate === 'number' ? p.lastUpdate : (Number.isFinite(lu) && lu > 0 ? lu : (opts.now ?? Date.now()));
        return out;
    }

    // ─── v3.3 · Aşama 1 · Raf / slot sözleşmesi (Denetim P1-02 temeli, P2-05) ─────────────────────────────────────
    // [WHY]: Raf kodu iki modülde iki farklı kuralla okunuyordu (shelf-capacity: yalnız trim, '-' bir raf adı; WMS: '-' ve
    //        boş atlanır, durumu boşsa status'a düşer) ve hiçbiri büyük/küçük harf ya da iç boşluk farkını sıfırlamıyordu:
    //        "A-12", "a-12", " A-12 " üç ayrı raf sayılıyor, kapasite anahtarı da raf adının ham yazımına bağlı kalıyordu.
    //        Kapasite tarayıcıya özel localStorage'da tutuluyordu; ortak bir raf belgesi sözleşmesi yoktu.
    // [HOW]: Tek normalizasyon (normShelfCode), tek kayıt→raf okuyucusu (itemShelfCode), tek slot işgal tanımı
    //        (isSlotOccupying: pozitif adetli ve aktif durumlu her kayıt 1 slot; adet slotu artırmaz) ve
    //        ${ROOT}/shelves/items/{shelfId} belgesinin sözleşmesi (SHELF_KEYS, buildShelfDoc, validateShelfDoc).
    //        shelfId deterministiktir: `${depot}_${code}`; code karakter kümesi '/' içermediği ve '_' ile başlamadığı için
    //        Firestore belge kimliği kurallarına uyar ve firestore.rules tarafında aynı birleştirmeyle doğrulanabilir.
    //        Saf fonksiyonlardır: SDK, DOM ve localStorage kullanmazlar (sayaçları transaction'da Aşama 2 yazar).
    const SHELF_COLLECTION = 'shelves';
    const SHELF_DEPOTS = Object.freeze(['b1', 'b2']);
    const SHELF_DEFAULT_CAPACITY = 5;
    const SHELF_MIN_CAPACITY = 1;
    const SHELF_MAX_CAPACITY = 200;
    const SHELF_CODE_MAX_LENGTH = 40;
    // Kanonik kod: büyük harf (Türkçe harfler dahil, İ → I katlanır), rakam; ilk karakterden sonra boşluk . - _ olabilir.
    const SHELF_CODE_RE = /^[A-Z0-9ÇĞÖŞÜ][A-Z0-9ÇĞÖŞÜ .\-_]*$/;
    const SHELF_KEYS = Object.freeze(['code', 'depot', 'capacity', 'usedSlots', 'active', 'updatedAt', 'updatedBy']);
    // Slot işgal etmeyen durumlar (normName ile karşılaştırılır: büyük/küçük harf, ı/i ve fazla boşluk farkı yok sayılır).
    // 'pasif' ayrıca alt dize olarak aranır (filter-module isPassiveStatus ile aynı: "Tükendi / Pasif", "Pasif (Arızalı)").
    const SHELF_INACTIVE_STATUSES = Object.freeze(['stok dışı', 'stok disi', 'tükendi', 'tukendi'].map(normName));

    /**
     * Raf kodunun tekil kanonik biçimi. "A-12", "a-12", " A-12 ", "a - 12", "Ａ－１２" → "A-12". Boş, null ve '-' → ''
     * (rafsız). Sıfır dolgusu anlamlıdır: "A-1" ile "A-01" ayrı raflardır (sessiz birleştirme yok).
     */
    function normShelfCode(value) {
        if (value === undefined || value === null) return '';
        const code = String(value)
            .normalize('NFKC')                                   // tam genişlik → ASCII, birleşik karakterler
            .replace(/[​-‍⁠﻿]/g, '')         // sıfır genişlikli karakterler
            .replace(/[‐-―−]/g, '-')              // tire varyantları → '-'
            .toUpperCase()
            .replace(/̇/g, '').replace(/İ/g, 'I')            // "i" / "ı" / "İ" hepsi "I" (normName ile aynı katlama)
            .replace(/\s+/g, ' ')
            .replace(/\s*-\s*/g, '-')
            .trim();
        return code === '-' ? '' : code;
    }

    // Kanonik raf kodu sözleşmeye uygun mu (belge kimliği yapılabilir mi)? Normalize edilmemiş girdi geçersizdir.
    function isValidShelfCode(code) {
        return typeof code === 'string' && code !== '' && code.length <= SHELF_CODE_MAX_LENGTH
            && SHELF_CODE_RE.test(code) && normShelfCode(code) === code;
    }

    // Stok kaydının kanonik raf kodu: raf → shelf → rafNo; boş ve '-' atlanır. Rafsız kayıt → ''.
    function itemShelfCode(item) {
        if (!item || typeof item !== 'object') return '';
        for (const v of [item.raf, item.shelf, item.rafNo]) {
            const code = normShelfCode(v);
            if (code) return code;
        }
        return '';
    }

    /**
     * Slot işgali: kaydın adedi > 0 VE durumu (durumu ya da status — hangisi doluysa, ikisi de doluysa ikisi de) slot dışı
     * değilse 1 slot. 'Hurda', 'Servis Sürecinde' vb. pozitif adetle rafta durduğu için slot işgal eder.
     */
    function isSlotOccupying(item) {
        if (!item || typeof item !== 'object') return false;
        const qty = Number.parseFloat(item.adet ?? item.qty ?? item.quantity ?? 0);
        if (!Number.isFinite(qty) || qty <= 0) return false;
        return ![item.durumu, item.status].some(s => {
            const n = normName(s);
            return n !== '' && (SHELF_INACTIVE_STATUSES.includes(n) || n.includes('pasif'));
        });
    }

    const _stockValues = items => (Array.isArray(items) ? items : (items && typeof items === 'object' ? Object.values(items) : []));

    // Verilen depodaki kayıtlardan bir rafın işgal edilen slot sayısı (raf kodu normalize edilerek karşılaştırılır).
    function computeUsedSlots(items, code) {
        const target = normShelfCode(code);
        if (!target) return 0;
        return _stockValues(items).filter(item => isSlotOccupying(item) && itemShelfCode(item) === target).length;
    }

    // Bütün raflar için { kanonikKod: slot } (Aşama 6 uzlaştırma raporu ve WMS için). Rafsız işgaller '' anahtarında.
    function slotUsageByShelf(items) {
        const usage = {};
        _stockValues(items).forEach(item => {
            if (!isSlotOccupying(item)) return;
            const code = itemShelfCode(item);
            usage[code] = (usage[code] || 0) + 1;
        });
        return usage;
    }

    // Deterministik raf belge kimliği. Geçersiz depo/kod → RangeError (sessiz uydurma kimlik yok).
    function shelfDocId(depot, code) {
        const c = normShelfCode(code);
        if (!SHELF_DEPOTS.includes(depot)) throw new RangeError(`Geçersiz depo: ${depot}`);
        if (!isValidShelfCode(c)) throw new RangeError(`Geçersiz raf kodu: "${code}"`);
        return `${depot}_${c}`;
    }

    /**
     * Kanonik raf belgesi kurar (kod normalize edilir; capacity varsayılanı 5, usedSlots 0, active true). updatedAt
     * Firestore'a yazılırken sunucu zamanıyla (serverTimestamp) değiştirilir; burada verilmezse Date.now().
     */
    function buildShelfDoc(o = {}) {
        return {
            code: normShelfCode(o.code),
            depot: o.depot,
            capacity: o.capacity ?? SHELF_DEFAULT_CAPACITY,
            usedSlots: o.usedSlots ?? 0,
            active: o.active ?? true,
            updatedAt: o.updatedAt ?? Date.now(),
            updatedBy: o.updatedBy,
        };
    }

    /**
     * Raf belgesi sözleşmesi → hata listesi (boş = geçerli). Fazla alan reddedilir. opts.id verilirse belge kimliği
     * shelfDocId(depot, code) ile aynı olmalıdır. usedSlots > capacity bilinçli olarak belge hatası DEĞİLDİR: geçiş sonrası
     * kapasite aşımı "düzeltme bekleyen raf" durumudur (Aşama 6); slot artıran işlemi Aşama 2 transaction'ı reddeder.
     * updatedAt: ms sayısı ya da Firestore zaman nesnesi/sentinel'i (sunucu zamanı kuralı firestore.rules'ta denetlenir).
     */
    function validateShelfDoc(d, opts = {}) {
        const errors = [];
        if (!d || typeof d !== 'object' || Array.isArray(d)) return ['kayıt yok'];
        SHELF_KEYS.forEach(k => { if (!Object.prototype.hasOwnProperty.call(d, k) || d[k] === undefined) errors.push(`eksik alan: ${k}`); });
        Object.keys(d).forEach(k => { if (!SHELF_KEYS.includes(k)) errors.push(`bilinmeyen alan: ${k}`); });
        if ('depot' in d && !SHELF_DEPOTS.includes(d.depot)) errors.push(`geçersiz depo: ${d.depot}`);
        if ('code' in d && !isValidShelfCode(d.code)) errors.push(`geçersiz raf kodu: ${d.code}`);
        if ('capacity' in d && (!Number.isInteger(d.capacity) || d.capacity < SHELF_MIN_CAPACITY || d.capacity > SHELF_MAX_CAPACITY)) {
            errors.push(`geçersiz kapasite: ${d.capacity} (${SHELF_MIN_CAPACITY}–${SHELF_MAX_CAPACITY} tam sayı)`);
        }
        if ('usedSlots' in d && (!Number.isInteger(d.usedSlots) || d.usedSlots < 0)) errors.push(`geçersiz usedSlots: ${d.usedSlots}`);
        if ('active' in d && typeof d.active !== 'boolean') errors.push('active boolean değil');
        if ('updatedAt' in d && d.updatedAt !== undefined) {
            const t = d.updatedAt;
            const ok = (typeof t === 'number' && Number.isFinite(t) && t > 0) || (t !== null && typeof t === 'object');
            if (!ok) errors.push('updatedAt zaman değeri değil');
        }
        if ('updatedBy' in d && d.updatedBy !== undefined && (typeof d.updatedBy !== 'string' || isBlank(d.updatedBy) || d.updatedBy.length > 128)) {
            errors.push('updatedBy (admin UID) geçersiz');
        }
        if (opts.id !== undefined && SHELF_DEPOTS.includes(d.depot) && isValidShelfCode(d.code) && opts.id !== `${d.depot}_${d.code}`) {
            errors.push(`belge kimliği uyumsuz: ${opts.id} ≠ ${d.depot}_${d.code}`);
        }
        return errors;
    }

    // ─── 3.9a · Cihaz kimliği (Seri No / Envanter No) ───
    // Karşılaştırma anahtarı: boşluksuz, büyük harf; '-' ve boş yok sayılır. Eski kayıtlarda virgülle birleşmiş SN'ler ayrılır.
    function normDeviceId(v) {
        if (isBlank(v)) return '';
        return String(v).replace(/\s+/g, '').toLocaleUpperCase('en-US');
    }
    function deviceKeys(rec) {
        if (!rec) return [];
        const keys = [];
        String(rec.sn ?? '').split(/[,;]/).map(normDeviceId).filter(Boolean).forEach(k => keys.push('SN:' + k));
        const env = normDeviceId(rec.envanterNo);
        if (env) keys.push('ENV:' + env);
        return keys;
    }
    const describeKey = k => (k.startsWith('SN:') ? 'Seri No ' : 'Envanter No ') + k.slice(k.indexOf(':') + 1);

    /**
     * Demirbaş kaleminin cihaz kimliklerini doğrular: adet kadar satır, her satırda Seri No veya Envanter No, liste içinde
     * tekrar yok, aktif kullanımda (zimmet/servis) olan kimlik yok. Sarf malzemede kimlik isteğe bağlıdır.
     * @returns {{ok:boolean, errors:string[], ids:{sn:string, envanterNo:string}[]}}
     */
    function validateDeviceIds({ demirbas, qty, ids = [], activeUses = new Map(), label = '' }) {
        const clean = (ids || []).map(d => ({ sn: txt(d && d.sn), envanterNo: txt(d && d.envanterNo) }));
        const errors = [];
        if (!demirbas) return { ok: true, errors, ids: clean };
        if (clean.length !== Number(qty)) errors.push(`${label}${qty} cihaz için ${qty} kimlik satırı gerekli.`);
        const seen = new Set();
        clean.forEach((d, i) => {
            if (d.sn === '-' && d.envanterNo === '-') { errors.push(`${label}${i + 1}. cihaz: Seri No veya Envanter No girin (en az biri zorunlu).`); return; }
            deviceKeys(d).forEach(k => {
                if (seen.has(k)) errors.push(`${label}${describeKey(k)} listede iki kez girildi.`);
                seen.add(k);
                const use = activeUses.get(k);
                if (use) errors.push(`${label}${describeKey(k)} şu an ${use.text}; aynı cihaz ikinci kez çıkışa verilemez.`);
            });
        });
        return { ok: errors.length === 0, errors, ids: clean };
    }

    // ─── Talepler ───
    function requestStatus(r) {
        const d = String((r && r.durum) ?? '').trim().toUpperCase();
        if (['', 'BEKLEMEDE', 'BEKLİYOR', 'BEKLIYOR', 'PENDING'].includes(d)) return 'pending';
        if (['APPROVED', 'ONAYLANDI'].includes(d)) return 'approved';
        if (['COMPLETED', 'TESLİM ALINDI', 'TESLIM ALINDI'].includes(d)) return 'completed';
        if (['REJECTED', 'REDDEDİLDİ', 'REDDEDILDI'].includes(d)) return 'rejected';
        if (['DRAFT', 'TASLAK'].includes(d)) return 'draft';
        return 'other';
    }
    function normalizeRequest(r) {
        if (!r) return null;
        return {
            id: r.id,
            personel: pick(r.personel) ?? '-',
            personelId: pick(r.personelId) ?? null,
            urun: pick(r.ürün, r.urun) ?? '-',
            adet: Number(r.adet) || 1,
            status: requestStatus(r),
            talepTuru: pick(r.talepTuru) ?? 'Kalıcı Zimmet',
            oncelik: pick(r.oncelik) ?? 'Orta',
            sn: pick(r.sn) ?? '-',
            envanterNo: pick(r.envanterNo) ?? '-',
            tarih: pick(r.tarih) ?? '-',
            teslimTarihi: pick(r.teslimTarihi) ?? null,
            not: pick(r.not) ?? '-',
            iadeTarihi: pick(r.iadeTarihi) ?? null,
            iadeEdildi: truthy(r.iadeEdildi),
            iadeEdildiTarihi: pick(r.iadeEdildiTarihi) ?? null,
            stockRepo: pick(r.stockRepo) ?? null,
            stockProductId: r.stockProductId ?? null,
            isDemirbas: r.isDemirbas !== undefined && r.isDemirbas !== null ? truthy(r.isDemirbas) : null,
            ts: idToTs(r.id),
        };
    }

    // [WHY]: Faz 4 · J4 (EBYS-04, T6) — "kendi kaydını onaylama" kontrolü yalnız index'te, monkey-patch sarmalayıcıda ve iki
    //        farklı (yalnız ad / kod + ad) eşleştirmeyle yapılıyordu; admin.html'de hiç yoktu.
    // [HOW]: Tek politika. Talep: personelId → eski kod → Türkçe güvenli ad (AssignmentService.matchesPerson ile aynı sıra;
    //        id'ler varsa ad benzerliği karar vermez). Satın alma: açanın kodu (createdBy) ya da adı (createdByName / talepEden;
    //        şablondan açılanlarda createdBy addır). kind: 'request' | 'purchase'.
    function isSelfApproval({ actor, record, kind } = {}) {
        if (!actor || !record) return false;
        const me = normName(actor.name);
        // Faz 4B · J10: sahiplik uid'si (J9) eşleşirse kendi kaydıdır. Yalnız OLUMLU kanıt: yöneticinin kimliği personel kaydından
        //               gelir (uid'si personel hesabınınki, yönetici oturumununki değil) — uid'nin tutmaması "başkası" demek değildir.
        const sameUid = v => !isBlank(v) && !isBlank(actor.uid) && String(v) === String(actor.uid);
        if (kind === 'request') {
            if (sameUid(record.personelUid)) return true;
            if (!isBlank(record.personelId) && !isBlank(actor.id)) return String(record.personelId) === String(actor.id);
            if (!isBlank(record.personelKodu) && !isBlank(actor.code)) return String(record.personelKodu) === String(actor.code);
            return me !== '' && normName(record.personel) === me;
        }
        if (kind === 'purchase') {
            if (sameUid(record.createdByUid)) return true;
            const by = isBlank(record.createdBy) || record.createdBy === 'unknown' ? null : String(record.createdBy);
            if (by && !isBlank(actor.code) && by === String(actor.code)) return true;
            if (by && !isBlank(actor.id) && by === String(actor.id)) return true;   // J8+: createdBy = personel id
            if (me === '') return false;
            return [record.createdByName, record.talepEden, by].some(n => !isBlank(n) && normName(n) === me);
        }
        return false;
    }

    const Schema = {
        makeId, normName, idToTs, isDemirbas, normalizeStock, findStock, isSelfApproval,
        B3_SCHEMA_VERSION, B3_KEYS, B3_LEGACY_KEYS, B3_TIP, STOK_DISI,
        buildB3Entry, normalizeB3, toCanonicalB3, validateB3,
        B1_KEYS, B1_LEGACY_KEYS, B2_KEYS, B2_LEGACY_KEYS, B1_OPTIONAL_KEYS, B2_OPTIONAL_KEYS, stockKnownKeys, legacyStockPatch,
        validateB1, validateB2, toCanonicalStock,
        SHELF_COLLECTION, SHELF_DEPOTS, SHELF_DEFAULT_CAPACITY, SHELF_MIN_CAPACITY, SHELF_MAX_CAPACITY, SHELF_CODE_MAX_LENGTH,
        SHELF_KEYS, normShelfCode, isValidShelfCode, itemShelfCode, isSlotOccupying, computeUsedSlots, slotUsageByShelf,
        shelfDocId, buildShelfDoc, validateShelfDoc,
        requestStatus, normalizeRequest,
        normDeviceId, deviceKeys, validateDeviceIds,
    };
    window.AppModules = window.AppModules || {};
    window.AppModules.Schema = Object.assign(window.AppModules.Schema || {}, Schema);
    window.Schema = window.AppModules.Schema;
    window.makeId = makeId;
})();
