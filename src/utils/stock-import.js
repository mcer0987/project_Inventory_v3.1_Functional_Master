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

    /**
     * Satırları kanonik b1/b2 kayıtlarına çevirir.
     * @param {object[]} rows  başlık adlı satır nesneleri (parseCsv / sheetRows)
     * @param {'b1'|'b2'} col
     * @param {{schema:object, makeId:Function, now?:number}} deps
     * @returns {{records:object[], errors:string[], warnings:string[], mapping:object}}
     *          errors doluysa records BOŞTUR (kısmi içe aktarma yok).
     */
    function buildStockRecords(rows, col, { schema, makeId, now = Date.now() }) {
        const errors = [], warnings = [];
        if (col !== 'b1' && col !== 'b2') return { records: [], errors: [`Geçersiz depo: ${col}`], warnings, mapping: {} };
        const headers = [...new Set((rows || []).flatMap(r => Object.keys(r || {})))];
        const mapping = {};
        headers.forEach(h => {
            const f = ALIAS_INDEX.get(headerKey(h));
            if (!f) { if (headerKey(h)) warnings.push(`"${h}" sütunu tanınmadı; atlandı.`); return; }
            if (Object.values(mapping).includes(f)) { warnings.push(`"${h}" sütunu "${f}" alanı için ikinci kez geçiyor; atlandı.`); return; }
            mapping[h] = f;
        });
        if (!Object.values(mapping).includes('ürün')) {
            return { records: [], errors: ['Başlık satırında ürün adı sütunu yok (ör. "Ürün" / "Ürün Adı").'], warnings, mapping };
        }

        const records = [];
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
            const draft = {
                id: `${col}_${makeId()}`,
                sütun: v.sütun || '', raf: v.raf || '', tür: v.tür || '', ürün: v.ürün, marka: v.marka || '',
                adet, durumu: v.durumu || (adet > 0 ? 'Kullanıma Hazır' : 'Tükendi'), açıklama: v.açıklama || '',
                lastUpdate: now,
            };
            // Demirbaş kararı tek kuraldan: ürün türü tanımı → dosyadaki bayrak → ad bir tür adı mı (Schema.isDemirbas).
            draft.isDemirbas = schema.isDemirbas({ ...draft, isDemirbas: flag });
            if (v.limit !== undefined && v.limit !== '') {
                const l = Number(v.limit);
                if (!Number.isInteger(l) || l < 0) { errors.push(`Satır ${line}: geçersiz limit "${v.limit}".`); return; }
                draft.limit = l;
            }
            const rec = schema.toCanonicalStock(draft, col, { now });
            const contract = (col === 'b1' ? schema.validateB1 : schema.validateB2)(rec);
            if (contract.length) { errors.push(`Satır ${line}: ${contract.slice(0, 3).join('; ')}`); return; }
            records.push(rec);
        });
        return errors.length ? { records: [], errors, warnings, mapping } : { records, errors, warnings, mapping };
    }

    const StockImport = { headerKey, decodeText, parseCsv, sheetRows, buildStockRecords, FIELD_ALIASES };
    window.AppModules = window.AppModules || {};
    window.AppModules.StockImport = StockImport;
    window.StockImport = StockImport;
})();
