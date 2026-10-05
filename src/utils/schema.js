/**
 * utils/schema.js — Veri şeması yardımcıları (klasik script, iki sayfada <head>'de html.js'ten hemen sonra)
 * Faz 3.3: makeId. Faz 3.6: şema sözleşmesi — normName, isDemirbas, normalizeStock, normalizeB3 / buildB3Entry /
 * validateB3 / toCanonicalB3, normalizeRequest. Fonksiyonlar window.data'yı çağrı anında okur (yükleme sırası önemsiz).
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
    const B3_TIP = Object.freeze({ CIKIS: 'cikis', ZIMMET: 'zimmet' });
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
        return {
            id: o.id ?? makeId(),
            sema: B3_SCHEMA_VERSION,
            tip: zimmet ? B3_TIP.ZIMMET : B3_TIP.CIKIS,
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
        const tip = item.tip === B3_TIP.CIKIS || item.tip === B3_TIP.ZIMMET ? item.tip : (hasZimmetMarks ? B3_TIP.ZIMMET : B3_TIP.CIKIS);
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
        if (![B3_TIP.CIKIS, B3_TIP.ZIMMET].includes(e.tip)) errors.push(`geçersiz tip: ${e.tip}`);
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
        if (kind === 'request') {
            if (!isBlank(record.personelId) && !isBlank(actor.id)) return String(record.personelId) === String(actor.id);
            if (!isBlank(record.personelKodu) && !isBlank(actor.code)) return String(record.personelKodu) === String(actor.code);
            return me !== '' && normName(record.personel) === me;
        }
        if (kind === 'purchase') {
            const by = isBlank(record.createdBy) || record.createdBy === 'unknown' ? null : String(record.createdBy);
            if (by && !isBlank(actor.code) && by === String(actor.code)) return true;
            if (me === '') return false;
            return [record.createdByName, record.talepEden, by].some(n => !isBlank(n) && normName(n) === me);
        }
        return false;
    }

    const Schema = {
        makeId, normName, idToTs, isDemirbas, normalizeStock, findStock, isSelfApproval,
        B3_SCHEMA_VERSION, B3_KEYS, B3_LEGACY_KEYS, B3_TIP, STOK_DISI,
        buildB3Entry, normalizeB3, toCanonicalB3, validateB3,
        requestStatus, normalizeRequest,
        normDeviceId, deviceKeys, validateDeviceIds,
    };
    window.AppModules = window.AppModules || {};
    window.AppModules.Schema = Object.assign(window.AppModules.Schema || {}, Schema);
    window.Schema = window.AppModules.Schema;
    window.makeId = makeId;
})();
