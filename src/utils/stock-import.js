/**
 * utils/stock-import.js — CSV/Excel stok içe aktarmanın saf katmanı (Faz 5 denetimi · P1)
 * Klasik script; index.html <head>'de schema.js'ten sonra. script.js importExcel bunu kullanır → tests/unit/stock-import.test.mjs.
 *
 * [WHY]: İçe aktarma iki ayrı yerde (script.js ve pdf-generator.js) iki farklı biçim üretiyordu: kanonik b1/b2 alanı 'raf'
 *        yerine "rafNo", İngilizce takma adlar (name/type/shelf/qty), isDemirbas hiç yok, sabit "Unbranded"/"Sarf" uydurmaları;
 *        sayı olmayan adet sessizce 0 oluyordu. CSV dalı dosyayı ArrayBuffer olarak okuyup metin gibi bölmeye çalışıyordu
 *        (her CSV "Excel okunurken hata" veriyordu). saveData'nın b1/b2 tam 'set' sözleşmesi bu yüzden esnetilmişti.
 * [HOW]: Satırlar başlık adlarıyla (Türkçe/İngilizce, büyük-küçük harf ve aksan duyarsız) kanonik alanlara eşlenir,
 *        Schema.toCanonicalStock ile kanonik kayıt kurulur, Schema.validateB1/B2 (tam sözleşme) ile doğrulanır.
 *        Tek bir hatalı satır bile varsa HİÇBİR kayıt döndürülmez (çağıran hiçbir şey yazmaz) — dosya ya tamamen ya hiç.
 *
 * [WHY — v3.3 P1 ek karar, proje sahibinin talebiyle]: "P1 FIX RAPORU"nda genel ölçek için not edilen risk (~440 satırı
 *        aşan, çok parçalı/günlüklü içe aktarmalarda toplu yazma kilidinin diğer sekmelere ulaşması kısa bir gecikmeyle
 *        olur; bu dar pencerede eşzamanlı bir raf işlemi teorik olarak araya girebilir) BU PROJE için kabul edilmedi.
 *        Proje sahibi içe aktarmanın admin dahil KİMSE tarafından aşılamayacak sabit bir üst sınırla sınırlanmasını istedi.
 * [HOW]: MAX_IMPORT_ROWS = 200 — tek dosyada en fazla bu kadar veri satırı kabul edilir (aşılırsa dosya hiç işlenmez,
 *        tek hata mesajıyla reddedilir; kısmi içe aktarma yok). Bu sayı BİLİNÇLİ seçildi: AtomicWriter.LIMITS.maxOps=450
 *        (bkz. atomic-writer.js) — raf sayaç girdileri dahil 200 ürünlük bir içe aktarma HER ZAMAN tek Firestore batch'ine
 *        sığar (ends.length===1 yolu, bkz. atomic-writer.js `run`), yani hiçbir içe aktarma artık çok parçalı/günlüklü
 *        işe DÜŞMEZ — kilit hiç kurulmaz, kilit yayılma penceresi riski bu yoldan YAPISAL olarak ortadan kalkar (Sync/geri
 *        yükleme gibi başka akışlar için hâlâ geçerlidir, yalnız BU giriş noktası için kapatılmıştır). Sınır burada (saf
 *        katmanda, önizlemede) VE firebase-handler.js atomicImportStock'ta (commit anında, ikinci bağımsız denetim —
 *        önizlemeyi atlayıp doğrudan çağıran bir konsol/otomasyon bile aşamaz) ayrı ayrı uygulanır.
 */
(function () {
    // Başlık anahtarı: Türkçe harfler ASCII'ye, harf/rakam dışı her şey atılır ("Raf No" → "rafno", "Ürün Adı" → "urunadi").
    function headerKey(s) {
        return String(s ?? '').toLocaleLowerCase('tr-TR')
            .replace(/ı/g, 'i').replace(/i̇/g, 'i').replace(/ü/g, 'u').replace(/ş/g, 's')
            .replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ö/g, 'o')
            .normalize('NFD').replace(/[̀-ͯ]/g, '')
            .replace(/[^a-z0-9]/g, '');
    }

    const FIELD_ALIASES = {
        ürün: ['ürün', 'ürün adı', 'ürün ismi', 'malzeme', 'malzeme adı', 'name', 'product'],
        tür: ['tür', 'cihaz türü', 'ürün türü', 'kategori', 'type'],
        raf: ['raf', 'raf no', 'raf numarası', 'rafNo', 'shelf', 'shelf no'],
        sütun: ['sütun', 'kolon', 'column'],
        adet: ['adet', 'miktar', 'stok', 'qty', 'quantity'],
        marka: ['marka', 'brand'],
        durumu: ['durumu', 'durum', 'status'],
        açıklama: ['açıklama', 'not', 'notlar', 'description'],
        isDemirbas: ['demirbaş', 'demirbaş mı', 'isDemirbas', 'demirbas'],
        limit: ['limit', 'kritik stok', 'min stok', 'minimum stok'],
        // v3.3 Saha Hotfix'i: yalnız B2 kaydına yazılır (bkz. buildStockRecords) — B1'de sütun TANINIR (uyarı basılmaz)
        // ama değeri göz ardı edilir ("B1/Sarf için boş bırakılacak veya göz ardı edilecektir").
        envanterNo: ['envanter no', 'envanter numarası', 'envanter numarasi', 'envanterno', 'envanter', 'inventory no', 'asset no'],
    };
    const ALIAS_INDEX = new Map();
    Object.entries(FIELD_ALIASES).forEach(([field, list]) => list.forEach(a => ALIAS_INDEX.set(headerKey(a), field)));

    const YES = ['evet', 'e', 'true', '1', 'x', 'var', 'demirbas', 'd', 'yes', 'y'];
    const NO = ['hayir', 'h', 'false', '0', 'yok', 'sarf', 's', 'no', 'n'];

    /** Dosya baytlarını metne çevirir: UTF-8 (BOM'lu/BOM'suz); geçersiz UTF-8 ise Türkçe Windows kod sayfası (1254). */
    function decodeText(buf, TD = (typeof TextDecoder !== 'undefined' ? TextDecoder : null)) {
        if (!TD) throw new Error('TextDecoder yok');
        let text;
        try { text = new TD('utf-8', { fatal: true }).decode(buf); } catch (e) { text = new TD('windows-1254').decode(buf); }
        return text.replace(/^﻿/, '');
    }

    /** RFC 4180 CSV: tırnaklı alan, alan içinde ayraç/satır sonu, "" kaçışı. Ayraç ilk satırdan (, ; sekme) seçilir. */
    function parseCsv(text) {
        const firstLine = text.split(/\r?\n/, 1)[0] || '';
        const count = ch => firstLine.split(ch).length - 1;
        const sep = [';', '\t', ','].reduce((best, ch) => (count(ch) > count(best) ? ch : best), ',');
        const rows = [];
        let row = [], field = '', inQ = false;
        for (let i = 0; i < text.length; i++) {
            const c = text[i];
            if (inQ) {
                if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
                else field += c;
            } else if (c === '"' && field === '') inQ = true;
            else if (c === sep) { row.push(field); field = ''; }
            else if (c === '\n' || c === '\r') {
                if (c === '\r' && text[i + 1] === '\n') i++;
                row.push(field); rows.push(row); row = []; field = '';
            } else field += c;
        }
        if (field !== '' || row.length) { row.push(field); rows.push(row); }
        if (!rows.length) return [];
        const header = rows[0];
        return rows.slice(1).map(r => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
    }

    /** Excel'in ilk sayfası → başlık adlı satır nesneleri (SheetJS enjekte edilir). */
    function sheetRows(XLSX, buf) {
        const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        return sheet ? XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true }) : [];
    }

    const cellText = v => (v === undefined || v === null) ? '' : String(v).trim();
    const DEFAULT_SHELF_CAPACITY = 5;   // yeni (katalogda olmayan, otomatik yaratılacak) rafların varsayılan kapasitesi
    const MAX_IMPORT_ROWS = 200;        // sabit üst sınır — admin dahil hiç kimse aşamaz (bkz. dosya başı [WHY])
    const SHELF_COL = 'shelves';
    const EMPTY_PLACEMENT = Object.freeze({ shelvesToCreate: [], poolOverflowCount: 0, poolInactiveCount: 0, shelfRequests: [] });

    /**
     * Raf yerleşim planı (v3.3 P1 düzeltmesi — saf; hem önizleme hem commit AYNI fonksiyonu kullanır).
     * [WHY]: İçe aktarma ürünleri yazıp yeni rafları yaratıyordu ama MEVCUT rafların usedSlots sayacına hiç dokunmuyordu;
     *        ardışık içe aktarmalar kapasiteyi deliyordu (Denetim P1). Yerleşim kararı da bayat window.data.shelves'e dayanıyordu.
     * [HOW]: Slot işgal eden istekler dosya sırasıyla yerleşir: var olan raf katalogdaki usedSlots'tan, yeni raf 0'dan sayar;
     *        kapasite DOLUYSA ürün Havuz'a (raf:'') gider ve SAYACA EKLENMEZ — kapasite asla otomatik artırılmaz. Pasif raf da
     *        Havuz'dur. Slot işgal etmeyen istek (adet 0 / pasif ürün) yalnız katalogda olan ya da bu planda yaratılan bir rafa
     *        yazılır. Sayacı değişen her raf için AtomicWriter girdisi üretilir: prev = sunucudaki TAM belge (yeni rafta null),
     *        next = yeni sayaçlı tam belge, cas:true (AtomicWriter yazmadan hemen önce rafın değişmediğini doğrular).
     * @param {{records:object[], requests:{id,code,occupying,line}[], catalog:Map<string,{capacity,usedSlots,active?,doc?}>,
     *          depot:'b1'|'b2', uid?:string|null, serverTime?:*}} o
     */
    function planShelfPlacement({ records, requests, catalog, depot, uid = null, serverTime = null }) {
        const byId = new Map(records.map(r => [String(r.id), { ...r }]));
        const running = new Map();   // kanonik kod -> { capacity, before, used, isNew, active, doc }
        const warnings = [];
        let poolOverflowCount = 0, poolInactiveCount = 0;
        const slotOf = code => {
            let s = running.get(code);
            if (!s) {
                const c = catalog.get(code);
                s = c
                    ? { capacity: c.capacity, before: c.usedSlots, used: c.usedSlots, isNew: false, active: c.active !== false, doc: c.doc || null }
                    : { capacity: DEFAULT_SHELF_CAPACITY, before: 0, used: 0, isNew: true, active: true, doc: null };
                running.set(code, s);
            }
            return s;
        };
        (requests || []).filter(q => q.occupying).forEach(q => {
            const rec = byId.get(String(q.id));
            if (!rec) return;
            const s = slotOf(q.code);
            if (!s.active) {
                rec.raf = '';
                poolInactiveCount += 1;
                warnings.push(`Satır ${q.line}: "${q.code}" rafı pasif; ürün Havuz'a (rafsız) alındı.`);
            } else if (s.used < s.capacity) {
                s.used += 1;
                rec.raf = q.code;
            } else {
                rec.raf = '';
                poolOverflowCount += 1;
                warnings.push(`Satır ${q.line}: "${q.code}" rafı dolu (${s.capacity} slot); ürün Havuz'a (rafsız) alındı.`);
            }
        });
        (requests || []).filter(q => !q.occupying).forEach(q => {
            const rec = byId.get(String(q.id));
            if (!rec) return;
            const s = running.get(q.code);
            rec.raf = catalog.has(q.code) || (s && s.isNew && s.used > 0) ? q.code : '';
        });

        const shelfChanges = [...running.entries()].filter(([, s]) => s.used !== s.before).map(([code, s]) => ({
            id: `${depot}_${code}`, code, before: s.before, after: s.used, capacity: s.capacity, created: s.isNew,
        }));
        const shelfEntries = shelfChanges.map(c => {
            const s = running.get(c.code);
            const base = s.doc
                ? { code: s.doc.code, depot: s.doc.depot, capacity: s.doc.capacity, active: s.doc.active }
                : { code: c.code, depot, capacity: c.capacity, active: true };
            return { col: SHELF_COL, id: c.id, prev: s.doc, next: { ...base, usedSlots: c.after, updatedAt: serverTime, updatedBy: uid }, cas: true };
        });
        return {
            records: records.map(r => byId.get(String(r.id))),
            warnings, poolOverflowCount, poolInactiveCount, shelfChanges, shelfEntries,
            shelvesToCreate: shelfChanges.filter(c => c.created).map(c => c.code),
        };
    }

    /**
     * Commit planı: TAZE sunucu raf belgelerinden yerleşimi yeniden hesaplar ve AtomicWriter girdilerini döner — raf
     * girdileri ÖNCE (çok parçalı işte 1. parçaya düşer; sayaç kuralı reddederse hiçbir ürün yazılmadan durur), sonra ürünler.
     * @param {{col, records, requests, shelfDocs:object[], uid, serverTime}} o  shelfDocs: shelves koleksiyonunun belgeleri
     */
    function planImportEntries({ col, records, requests, shelfDocs, uid, serverTime }) {
        const catalog = new Map((shelfDocs || [])
            .filter(d => d && d.depot === col && typeof d.code === 'string')
            .map(d => [d.code, { capacity: d.capacity, usedSlots: d.usedSlots, active: d.active, doc: d }]));
        const plan = planShelfPlacement({ records, requests, catalog, depot: col, uid, serverTime });
        const entries = [
            ...plan.shelfEntries,
            ...plan.records.map(r => ({ col, id: String(r.id).replace(/\//g, '_'), prev: null, next: r })),
        ];
        return { plan, entries };
    }

    /**
     * Satırları kanonik b1/b2 kayıtlarına çevirir.
     * @param {object[]} rows  başlık adlı satır nesneleri (parseCsv / sheetRows)
     * @param {'b1'|'b2'} col
     * @param {{schema:object, makeId:Function, now?:number, shelfCapacityInfo?:Map<string,{capacity:number,usedSlots:number,active?:boolean}>}} deps
     *        shelfCapacityInfo: bu depoya ait raf kataloğunun KANONİK kod → {capacity, usedSlots, active} haritası.
     *        Verilmezse katalog denetimi YAPILMAZ — dosyadaki ham raf metni aynen yazılır (eski davranış).
     *        Verildiyse yerleşim planShelfPlacement ile ÖNİZLENİR (Auto-Create & Overflow; kapasite artırılmaz). Bu yalnız
     *        onay diyaloğu içindir: kesin karar commit anında taze sunucu verisiyle (planImportEntries) yeniden verilir.
     * @returns {{records, errors, warnings, mapping, shelvesToCreate, poolOverflowCount, poolInactiveCount, shelfRequests}}
     *          errors doluysa records BOŞTUR (kısmi içe aktarma yok). shelfRequests: commit planına aynen geçirilir.
     */
    function buildStockRecords(rows, col, { schema, makeId, now = Date.now(), shelfCapacityInfo }) {
        const errors = [], warnings = [];
        if (col !== 'b1' && col !== 'b2') return { records: [], errors: [`Geçersiz depo: ${col}`], warnings, mapping: {}, ...EMPTY_PLACEMENT };
        if ((rows || []).length > MAX_IMPORT_ROWS) {
            return {
                records: [], mapping: {}, ...EMPTY_PLACEMENT,
                errors: [`Dosyada ${rows.length} satır var; tek içe aktarmada en fazla ${MAX_IMPORT_ROWS} satır kabul edilir ` +
                    `(yönetici dahil hiç kimse için aşılamaz — bkz. dosya başı not). Dosyayı ${MAX_IMPORT_ROWS} satırlık parçalara bölüp ayrı ayrı içe aktarın.`],
                warnings,
            };
        }
        const headers = [...new Set((rows || []).flatMap(r => Object.keys(r || {})))];
        const mapping = {};
        headers.forEach(h => {
            const f = ALIAS_INDEX.get(headerKey(h));
            if (!f) { if (headerKey(h)) warnings.push(`"${h}" sütunu tanınmadı; atlandı.`); return; }
            if (Object.values(mapping).includes(f)) { warnings.push(`"${h}" sütunu "${f}" alanı için ikinci kez geçiyor; atlandı.`); return; }
            mapping[h] = f;
        });
        if (!Object.values(mapping).includes('ürün')) {
            return { records: [], errors: ['Başlık satırında ürün adı sütunu yok (ör. "Ürün" / "Ürün Adı").'], warnings, mapping, ...EMPTY_PLACEMENT };
        }

        const records = [];
        const requests = [];   // { id, code, occupying, line } — kanonik ve geçerli raf kodu isteyen satırlar
        (rows || []).forEach((row, idx) => {
            const line = idx + 2;   // 1. satır başlık
            const v = {};
            Object.entries(mapping).forEach(([h, f]) => { v[f] = cellText(row[h]); });
            if (Object.values(v).every(x => x === '')) return;   // boş satır
            if (!v.ürün) { errors.push(`Satır ${line}: ürün adı boş.`); return; }

            let adet = 0;
            if (v.adet !== undefined && v.adet !== '') {
                const n = Number(v.adet.replace(',', '.'));
                if (!Number.isInteger(n) || n < 0) { errors.push(`Satır ${line}: geçersiz adet "${v.adet}" (0 veya pozitif tam sayı olmalı).`); return; }
                adet = n;
            }
            let flag;
            if (v.isDemirbas !== undefined && v.isDemirbas !== '') {
                const k = headerKey(v.isDemirbas);
                if (YES.includes(k)) flag = true;
                else if (NO.includes(k)) flag = false;
                else { errors.push(`Satır ${line}: demirbaş sütunu "${v.isDemirbas}" anlaşılamadı (Evet/Hayır).`); return; }
            }
            const durumuValue = v.durumu || (adet > 0 ? 'Kullanıma Hazır' : 'Tükendi');
            // Slot işgal eder mi (Schema.isSlotOccupying ile AYNI kural)? Yalnız işgal eden satırlar kapasite/otomatik
            // yaratma denetiminden geçer — stok dışı/pasif bir satır için yeni raf yaratmanın hiçbir anlamı yoktur.
            const occupying = typeof schema.isSlotOccupying === 'function'
                ? schema.isSlotOccupying({ adet, durumu: durumuValue })
                : adet > 0;

            // Raf: katalog bilgisi yoksa ham metin (eski davranış). Varsa kanonik ve geçerli kod bir İSTEK olur; yerleşim
            // (yer var mı / Havuz mu) döngüden sonra planShelfPlacement'ta dosya sırasıyla verilir. Geçersiz kod → Havuz.
            let raf = '', requestedCode = '';
            const rawRaf = v.raf || '';
            if (rawRaf && !shelfCapacityInfo) {
                raf = rawRaf;
            } else if (rawRaf) {
                const code = schema.normShelfCode ? schema.normShelfCode(rawRaf) : rawRaf.trim();
                if (code && (typeof schema.isValidShelfCode !== 'function' || schema.isValidShelfCode(code))) {
                    requestedCode = code;
                    raf = code;
                }
            }
            const draft = {
                id: `${col}_${makeId()}`,
                sütun: v.sütun || '', raf, tür: v.tür || '', ürün: v.ürün, marka: v.marka || '',
                adet, durumu: durumuValue, açıklama: v.açıklama || '',
                lastUpdate: now,
            };
            // Demirbaş kararı tek kuraldan: ürün türü tanımı → dosyadaki bayrak → ad bir tür adı mı (Schema.isDemirbas).
            draft.isDemirbas = schema.isDemirbas({ ...draft, isDemirbas: flag });
            // v3.3 Saha Hotfix'i: Envanter No yalnız B2'ye yazılır (B1/Sarf için göz ardı edilir — aşağıdaki mapping
            // sütunu YİNE DE "tanınmadı" uyarısı basmadan kabul eder, yalnız değeri hiçbir yere kaydedilmez).
            if (col === 'b2' && v.envanterNo) draft.envanterNo = v.envanterNo;
            if (v.limit !== undefined && v.limit !== '') {
                const l = Number(v.limit);
                if (!Number.isInteger(l) || l < 0) { errors.push(`Satır ${line}: geçersiz limit "${v.limit}".`); return; }
                draft.limit = l;
            }
            const rec = schema.toCanonicalStock(draft, col, { now });
            const contract = (col === 'b1' ? schema.validateB1 : schema.validateB2)(rec);
            if (contract.length) { errors.push(`Satır ${line}: ${contract.slice(0, 3).join('; ')}`); return; }
            records.push(rec);
            if (requestedCode) requests.push({ id: String(rec.id), code: requestedCode, occupying, line });
        });
        if (errors.length) return { records: [], errors, warnings, mapping, ...EMPTY_PLACEMENT };
        if (!shelfCapacityInfo) return { records, errors, warnings, mapping, ...EMPTY_PLACEMENT };

        const preview = planShelfPlacement({ records, requests, catalog: shelfCapacityInfo, depot: col });
        return {
            records: preview.records, errors, warnings: [...warnings, ...preview.warnings], mapping,
            shelvesToCreate: preview.shelvesToCreate, poolOverflowCount: preview.poolOverflowCount,
            poolInactiveCount: preview.poolInactiveCount, shelfRequests: requests,
        };
    }

    const StockImport = {
        headerKey, decodeText, parseCsv, sheetRows, buildStockRecords, planShelfPlacement, planImportEntries,
        FIELD_ALIASES, DEFAULT_SHELF_CAPACITY, MAX_IMPORT_ROWS,
    };
    window.AppModules = window.AppModules || {};
    window.AppModules.StockImport = StockImport;
    window.StockImport = StockImport;
})();
