// Faz 5 denetimi · P1 — CSV/Excel içe aktarmanın kanonik b1/b2 sözleşmesi (src/utils/stock-import.js) ve tek kanonik
// stok kurucusu Schema.toCanonicalStock (src/utils/schema.js). İki dosya gerçek hâliyle, tarayıcısız (vm) aynı bağlamda yüklenir.
// Usage: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const plain = x => JSON.parse(JSON.stringify(x));

function load(productTypes = [{ name: 'Laptop', isDemirbas: true }, { name: 'Kablo', isDemirbas: false }]) {
    const ctx = vm.createContext({ window: { data: { productTypes } }, console, TextDecoder });
    for (const f of ['src/utils/schema.js', 'src/utils/stock-import.js']) {
        vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
    }
    let n = 0;
    return { S: ctx.window.Schema, I: ctx.window.StockImport, productTypes, makeId: () => 1000 + (n++) };
}
const addTestInventoryNumbers = rows => {
    const { I } = load();
    return rows.map((row, index) => {
        const hasProduct = Object.entries(row).some(([header, value]) =>
            I.FIELD_ALIASES.ürün.some(alias => I.headerKey(alias) === I.headerKey(header)) && String(value ?? '').trim()
        );
        const hasInventoryNo = Object.keys(row).some(header =>
            I.FIELD_ALIASES.envanterNo.some(alias => I.headerKey(alias) === I.headerKey(header))
        );
        return hasProduct && !hasInventoryNo ? { ...row, 'Envanter No': `TEST-ENV-${index}` } : row;
    });
};
const build = (rows, col = 'b1', extra = {}) => {
    const { S, I, productTypes, makeId } = load();
    return plain(I.buildStockRecords(addTestInventoryNumbers(rows), col, { schema: S, makeId, now: 1760000000000, productTypes, ...extra }));
};

// ─── Schema.toCanonicalStock ─────────────────────────────────────────────────────────────────────────
test('toCanonicalStock: eski takma adlar kanonik alana taşınır, takma ad silinir, tam sözleşmeden geçer', () => {
    const { S } = load();
    const legacy = { id: 'x1', name: 'HDMI', type: 'Kablo', shelf: 'R-3', qty: '7', status: 'Kullanıma Hazır', rafNo: 'R-3', limit: 4 };
    const c = plain(S.toCanonicalStock(legacy, 'b1', { now: 5 }));
    assert.equal(c.ürün, 'HDMI'); assert.equal(c.tür, 'Kablo'); assert.equal(c.raf, 'R-3'); assert.equal(c.adet, 7);
    assert.equal(c.durumu, 'Kullanıma Hazır');
    assert.equal(c.isDemirbas, false, 'tür tanımından (Kablo = sarf)');
    assert.equal(c.lastUpdate, 5);
    assert.equal(c.limit, 4, 'kanonik karşılığı olmayan alan korunur');
    for (const k of ['name', 'type', 'shelf', 'qty', 'status', 'rafNo']) assert.ok(!(k in c), `${k} kalmamalı`);
    assert.deepEqual(plain(S.validateB1(c)), []);
});

test('toCanonicalStock: b2 durumu/status birbirinden tamamlanır; isDemirbas tür tanımından', () => {
    const { S } = load();
    const c = plain(S.toCanonicalStock({ id: 'y', ürün: 'X1', tür: 'Laptop', adet: 1, status: 'Serviste' }, 'b2', { now: 1 }));
    assert.equal(c.durumu, 'Serviste'); assert.equal(c.status, 'Serviste'); assert.equal(c.isDemirbas, true);
    assert.deepEqual(plain(S.validateB2(c)), []);
});

test('toCanonicalStock: kanonik kayıt için idempotent; değer uydurmaz (geçersiz adet olduğu gibi kalır → sözleşme reddeder)', () => {
    const { S } = load();
    const canon = { id: 'c', sütun: 'A', raf: 'R1', tür: 'Kablo', ürün: 'HDMI', marka: '', adet: 3, durumu: '', açıklama: '', isDemirbas: false, lastUpdate: 9, isWatched: true };
    assert.deepEqual(plain(S.toCanonicalStock(canon, 'b1')), canon);
    const bad = plain(S.toCanonicalStock({ id: 'b', ürün: 'Z', adet: 'çok' }, 'b1', { now: 1 }));
    assert.equal(bad.adet, 'çok');
    assert.ok(S.validateB1(bad).some(e => e.includes('geçersiz adet')));
});

// ─── CSV ─────────────────────────────────────────────────────────────────────────────────────────────
test('parseCsv: tırnak, alan içi ayraç/satır sonu, "" kaçışı, ; ayracı, CRLF', () => {
    const { I } = load();
    const rows = plain(I.parseCsv('Ürün;Adet;Açıklama\r\n"Kablo; 2m";5;"çok ""iyi""\nikinci satır"\r\nMouse;3;\r\n'));
    assert.deepEqual(rows, [
        { Ürün: 'Kablo; 2m', Adet: '5', Açıklama: 'çok "iyi"\nikinci satır' },
        { Ürün: 'Mouse', Adet: '3', Açıklama: '' },
    ]);
});

test('decodeText: UTF-8 BOM atılır; geçersiz UTF-8 → Windows-1254 (Excel Türkçe CSV)', () => {
    const { I } = load();
    const utf8 = new Uint8Array([0xEF, 0xBB, 0xBF, ...Buffer.from('Ürün,Adet\nŞişe,2', 'utf8')]);
    assert.equal(I.decodeText(utf8), 'Ürün,Adet\nŞişe,2');
    const cp1254 = new Uint8Array([0xDC, 0x72, 0xFC, 0x6E, 0x2C, 0xDE, 0x69, 0xFE, 0x65]);   // "Ürün,Şişe"
    assert.equal(I.decodeText(cp1254), 'Ürün,Şişe');
});

// ─── buildStockRecords ───────────────────────────────────────────────────────────────────────────────
test('içe aktarma: "Raf No" → raf (rafNo YOK), isDemirbas üretilir, her kayıt tam B1 sözleşmesinden geçer', () => {
    const { S } = load();
    const r = build([
        { 'Ürün Adı': 'ThinkPad E14', 'Cihaz Türü': 'Laptop', 'Raf No': 'R-12', 'Sütun': 'A', 'Adet': '2', 'Marka': 'Lenovo' },
        { 'Ürün Adı': 'HDMI', 'Cihaz Türü': 'Kablo', 'Raf No': 'R-1', 'Adet': 0 },
        { 'Ürün Adı': 'Bilinmeyen', 'Adet': '1', 'Demirbaş': 'Evet' },
    ]);
    assert.deepEqual(r.errors, []);
    assert.equal(r.records.length, 3);
    const [lp, kb, unk] = r.records;
    assert.equal(lp.raf, 'R-12'); assert.equal(lp.sütun, 'A'); assert.equal(lp.isDemirbas, true); assert.equal(lp.durumu, 'Kullanıma Hazır');
    assert.equal(kb.isDemirbas, false); assert.equal(kb.durumu, 'Tükendi', 'adet 0 → Tükendi');
    assert.equal(unk.isDemirbas, true, 'tür tanımı yoksa dosyadaki bayrak');
    assert.equal(unk.marka, '', 'uydurma "Unbranded" yok');
    assert.equal(unk.tür, '', 'uydurma "Sarf" yok');
    r.records.forEach(rec => {
        assert.ok(!('rafNo' in rec) && !('limit' in rec), 'fazladan alan yok');
        assert.ok(String(rec.id).startsWith('b1_'));
        assert.equal(typeof rec.isDemirbas, 'boolean');
        assert.deepEqual(plain(S.validateB1(rec)), [], 'tam set sözleşmesi');
    });
});

test('içe aktarma b2: status + durumu birlikte, tam B2 sözleşmesi', () => {
    const { S } = load();
    const r = build([{ urun: 'Monitör', adet: '3', durum: 'Kullanıma Hazır', limit: '2' }], 'b2');
    assert.deepEqual(r.errors, []);
    const rec = r.records[0];
    assert.equal(rec.status, 'Kullanıma Hazır'); assert.equal(rec.durumu, 'Kullanıma Hazır'); assert.equal(rec.limit, 2);
    assert.ok(String(rec.id).startsWith('b2_'));
    assert.deepEqual(plain(S.validateB2(rec)), []);
});

test('içe aktarma: kayıtlı tür boşluk/büyük-küçük harf farkıyla eşleşir ve katalog adıyla yazılır', () => {
    const { S, I, productTypes, makeId } = load([{ name: 'Monitör', isDemirbas: true }]);
    const result = plain(I.buildStockRecords([
        { Ürün: 'ASUS', Tür: '  MONİTÖR  ', Adet: '1', 'Envanter No': 'E-11' },
    ], 'b2', { schema: S, makeId, productTypes }));
    assert.deepEqual(result.errors, []);
    assert.equal(result.records[0].tür, 'Monitör');
    assert.equal(result.records[0].isDemirbas, true);
});

test('içe aktarma: sistemde kayıtlı olmayan ürün türü dosyanın tamamını durdurur', () => {
    const result = build([
        { Ürün: 'Monitör', Tür: 'Laptop' },
        { Ürün: 'Buzdolabı', Tür: 'Buzdolabı' },
    ], 'b2');
    assert.deepEqual(result.records, []);
    assert.deepEqual(result.shelfRequests, []);
    assert.ok(result.errors.some(error => /Satır 3: ürün türü "Buzdolabı" sistemde kayıtlı değil/.test(error)));
});

test('içe aktarma: boş ürün türü mevcut davranışla kabul edilir', () => {
    const result = build([{ Ürün: 'Ürün', Tür: '' }], 'b2');
    assert.deepEqual(result.errors, []);
    assert.equal(result.records[0].tür, '');
});

test('içe aktarma: tek hatalı satır → hiçbir kayıt döndürülmez (dosya ya tamamen ya hiç)', () => {
    const r = build([
        { Ürün: 'İyi', Adet: '3' },
        { Ürün: 'Kötü', Adet: '2.5' },
        { Ürün: '', Adet: '1' },
        { Ürün: 'Negatif', Adet: '-1' },
        { Ürün: 'Bayrak', Adet: '1', Demirbaş: 'belki' },
        { Ürün: '', Adet: '' },   // tamamen boş satır → sessizce atlanır
    ]);
    assert.deepEqual(r.records, []);
    assert.equal(r.errors.length, 4);
    assert.match(r.errors[0], /Satır 3: geçersiz adet "2\.5"/);
    assert.match(r.errors[1], /Satır 4: ürün adı boş/);
    assert.match(r.errors[2], /Satır 5: geçersiz adet "-1"/);
    assert.match(r.errors[3], /Satır 6: demirbaş sütunu "belki"/);
});

test('içe aktarma: ürün sütunu yoksa durur; tanınmayan sütun uyarıdır', () => {
    assert.match(build([{ Ad: 'x', Adet: '1' }]).errors[0], /ürün adı sütunu yok/);
    const r = build([{ Ürün: 'A', Renk: 'Mavi' }]);
    assert.equal(r.records.length, 1);
    assert.ok(r.warnings.some(w => /"Renk" sütunu tanınmadı/.test(w)));
    assert.ok(!('Renk' in r.records[0]));
});

test('içe aktarma: "Raf/Shelf" başlığı raf alanına eşlenir ve tanınmayan sütun uyarısı üretmez', () => {
    const r = build([{ Ürün: 'A', 'Raf/Shelf': 'B2-R07' }]);
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.warnings, []);
    assert.equal(r.records[0].raf, 'B2-R07');
});

test('içe aktarma: geçersiz depo reddedilir', () => {
    assert.match(build([{ Ürün: 'A' }], 'b3').errors[0], /Geçersiz depo/);
});

// ─── v3.3 Saha Hotfix'i — raf "Auto-Create & Overflow" (Aşama 6'nın "her zaman Havuz" kuralının YERİNİ alır) ────────────
const shelfInfo = (entries) => new Map(entries.map(([code, capacity, usedSlots]) => [code, { capacity, usedSlots }]));

test('shelfCapacityInfo verilmediyse (eski çağıran/test) ham raf metni aynen yazılır, hata/uyarı yok, shelvesToCreate boş', () => {
    const r = build([{ Ürün: 'A', Raf: 'raf-x 9' }]);
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.warnings, []);
    assert.equal(r.records[0].raf, 'raf-x 9', 'katalog bilgisi yoksa eski davranış: ham metin');
    assert.deepEqual(r.shelvesToCreate, []);
    assert.equal(r.poolOverflowCount, 0);
});

test('raf katalogda VARSA ve müsaitse eşleşir, kanonik koda normalize edilir; otomatik yaratma GEREKMEZ', () => {
    const r = build([{ Ürün: 'A', Raf: ' raf-a 1 ' }], 'b1', { shelfCapacityInfo: shelfInfo([['RAF-A 1', 5, 2], ['RAF-B 2', 5, 0]]) });
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.warnings, []);
    assert.equal(r.records[0].raf, 'RAF-A 1', 'ham yazım katalogdaki kanonik koda indirgenir');
    assert.deepEqual(r.shelvesToCreate, []);
});

test('raf eşleşmesi: nokta/tire ve eksik tire farkı mevcut rafla eşleşme önerir', () => {
    const { I, S, makeId } = load();
    const shelfCapacityInfo = shelfInfo([['B2-A4-01', 5, 0], ['B2-R07', 5, 0]]);
    const result = plain(I.buildStockRecords([
        { Ürün: 'A', Raf: 'B2.a4.01', 'Envanter No': 'E-SHELF-1' },
        { Ürün: 'B', Raf: 'B2R07', 'Envanter No': 'E-SHELF-2' },
    ], 'b2', { schema: S, makeId, shelfCapacityInfo }));
    assert.deepEqual(result.shelfCorrections, [
        { code: 'B2.A4.01', candidates: ['B2-A4-01'] },
        { code: 'B2R07', candidates: ['B2-R07'] },
    ]);
    const applied = plain(I.applyShelfCorrections(result.records, result.shelfRequests, result.shelfCorrections, {
        'B2.A4.01': 'B2-A4-01',
        B2R07: 'B2-R07',
    }));
    assert.deepEqual(applied.records.map(r => r.raf), ['B2-A4-01', 'B2-R07']);
    assert.deepEqual(applied.requests.map(r => r.code), ['B2-A4-01', 'B2-R07']);
});

test('raf eşleşmesi: birden fazla aday gösterilir; farklı karakter/sıfır dolgusu otomatik eşleşmez', () => {
    const { I, S, makeId } = load();
    const shelfCapacityInfo = shelfInfo([['B2-A4-01', 5, 0], ['B2A4.01', 5, 0], ['B2-R07', 5, 0]]);
    const result = plain(I.buildStockRecords([
        { Ürün: 'Ambiguous', Raf: 'B2A4-01', Adet: '1', 'Envanter No': 'E-SHELF-3' },
        { Ürün: 'Different digit', Raf: 'B2-R08', Adet: '1', 'Envanter No': 'E-SHELF-4' },
        { Ürün: 'Zero padding', Raf: 'B2-R007', Adet: '1', 'Envanter No': 'E-SHELF-5' },
    ], 'b2', { schema: S, makeId, shelfCapacityInfo }));
    assert.deepEqual(result.shelfCorrections, [
        { code: 'B2A4-01', candidates: ['B2-A4-01', 'B2A4.01'] },
    ]);
    const keptNew = plain(I.applyShelfCorrections(result.records, result.shelfRequests, result.shelfCorrections, {}));
    assert.equal(keptNew.records[0].raf, 'B2A4-01', 'eşleşme seçilmezse yeni raf olarak mevcut yazım korunur');
    assert.throws(() => I.applyShelfCorrections(result.records, result.shelfRequests, result.shelfCorrections, {
        'B2A4-01': 'B2-R07',
    }), /Geçersiz raf eşleşmesi/);
});

test('raf katalogda YOKSA satır REDDEDİLMEZ — yeni raf OTOMATİK YARATILACAK şekilde işaretlenir, Havuz\'a DÜŞMEZ', () => {
    const r = build([
        { Ürün: 'A', Adet: '1', Raf: 'Olmayan Raf 7' },
        { Ürün: 'B', Adet: '1', Raf: 'RAF-A 1' },   // bu katalogda var
    ], 'b1', { shelfCapacityInfo: shelfInfo([['RAF-A 1', 5, 0]]) });
    assert.deepEqual(r.errors, [], 'katalog dışı raf HATA değildir; dosya yine de içe aktarılır');
    assert.equal(r.records.length, 2);
    assert.equal(r.records[0].raf, 'OLMAYAN RAF 7', 'Havuz değil — kanonik koduyla yazılır, raf arka planda yaratılacak');
    assert.equal(r.records[1].raf, 'RAF-A 1');
    assert.deepEqual(r.warnings, [], 'başarılı otomatik-yaratma uyarı ÜRETMEZ');
    assert.deepEqual(r.shelvesToCreate, ['OLMAYAN RAF 7']);
    assert.equal(r.poolOverflowCount, 0);
});

test('import ile yeni rafın kapasitesi 12 olur; 12 ürün rafa, fazlası Havuz\'a alınır', () => {
    const rows = Array.from({ length: 13 }, (_, i) => ({ Ürün: `Ürün ${i}`, Adet: '1', Raf: 'Yeni Raf 1' }));
    const r = build(rows, 'b1', { shelfCapacityInfo: shelfInfo([]) });
    assert.deepEqual(r.errors, []);
    const placed = r.records.filter(x => x.raf === 'YENI RAF 1');   // normShelfCode: i/ı/İ hepsi I olur
    const pooled = r.records.filter(x => x.raf === '');
    assert.equal(placed.length, 12, 'import ile yeni raf kapasitesi 12');
    assert.equal(pooled.length, 1);
    assert.equal(r.poolOverflowCount, 1);
    assert.deepEqual(r.shelvesToCreate, ['YENI RAF 1'], 'en az bir ürün yerleşti → yaratılacak');
    assert.equal(r.warnings.filter(w => /dolu/.test(w)).length, 1);
});

test('VAR OLAN rafın KALAN boşluğu dolunca fazlası Havuz\'a alınır; raf zaten katalogda olduğu için shelvesToCreate\'e girmez', () => {
    // RAF-A 1: kapasite 3, zaten 2 dolu → yalnız 1 boş yer var.
    const rows = [{ Ürün: 'A', Adet: '1', Raf: 'RAF-A 1' }, { Ürün: 'B', Adet: '1', Raf: 'RAF-A 1' }, { Ürün: 'C', Adet: '1', Raf: 'RAF-A 1' }];
    const r = build(rows, 'b1', { shelfCapacityInfo: shelfInfo([['RAF-A 1', 3, 2]]) });
    assert.equal(r.records.filter(x => x.raf === 'RAF-A 1').length, 1);
    assert.equal(r.records.filter(x => x.raf === '').length, 2);
    assert.equal(r.poolOverflowCount, 2);
    assert.deepEqual(r.shelvesToCreate, [], 'var olan raf yeniden yaratılmaz');
    assert.match(r.warnings[0], /Satır 3.*"RAF-A 1".*dolu.*Havuz/);
});

test('stok dışı/pasif (slot işgal etmeyen) satır: kapasite denetimi ve otomatik yaratma MUAF — bilinmeyen raf Havuz, bilinen raf kanonik', () => {
    const r = build([
        { Ürün: 'A', Adet: '0', Raf: 'Bilinmeyen Raf' },
        { Ürün: 'B', Durum: 'Pasif', Adet: '5', Raf: 'Bilinmeyen Raf 2' },
        { Ürün: 'C', Adet: '0', Raf: 'RAF-A 1' },
    ], 'b1', { shelfCapacityInfo: shelfInfo([['RAF-A 1', 1, 1]]) });   // RAF-A 1 zaten dolu — ama C slot işgal etmiyor
    assert.deepEqual(r.errors, []);
    assert.equal(r.records[0].raf, '', 'bilinmeyen raf + slot işgal yok → Havuz, yeni raf YARATILMAZ');
    assert.equal(r.records[1].raf, '', 'pasif + bilinmeyen raf → Havuz');
    assert.equal(r.records[2].raf, 'RAF-A 1', 'dolu olsa da slot işgal etmediği için reddedilmez');
    assert.deepEqual(r.shelvesToCreate, []);
    assert.deepEqual(r.warnings, [], 'slot işgal etmeyen satırlar için "dolu/tanımsız" uyarısı basılmaz');
});

test('dosyada raf hiç yoksa (boş hücre) zaten rafsızdır — uyarı gerekmez, yeni raf yaratılmaz', () => {
    const r = build([{ Ürün: 'A', Raf: '' }], 'b1', { shelfCapacityInfo: shelfInfo([['RAF-A 1', 5, 0]]) });
    assert.deepEqual(r.warnings, []);
    assert.equal(r.records[0].raf, '');
    assert.deepEqual(r.shelvesToCreate, []);
});

test('her iki depoda da aynı kuralla çalışır (b2); hatalı dosyada (errors doluyken) shelvesToCreate/poolOverflowCount sıfırlanır', () => {
    const r = build([{ Ürün: 'Demirbaş X', Tür: 'Laptop', Adet: '1', Raf: 'Yeni Raf' }], 'b2', { shelfCapacityInfo: shelfInfo([]) });
    assert.deepEqual(r.errors, []);
    assert.equal(r.records[0].raf, 'YENI RAF');
    assert.deepEqual(r.shelvesToCreate, ['YENI RAF']);
    assert.deepEqual(plain(load().S.validateB2(r.records[0])), []);

    const bad = build([{ Ürün: 'İyi', Adet: '1', Raf: 'Yeni Raf' }, { Ürün: '', Adet: '1' }], 'b1', { shelfCapacityInfo: shelfInfo([]) });
    assert.ok(bad.errors.length > 0);
    assert.deepEqual(bad.shelvesToCreate, []);
    assert.equal(bad.poolOverflowCount, 0);
});

// ─── v3.3 Saha Hotfix'i — Envanter No (yalnız B2) ────────────────────────────────────────────────────────────────────
test('Envanter No: B2 kaydına doğrudan eşlenir, tam B2 sözleşmesinden geçer', () => {
    const r = build([{ Ürün: 'Laptop X', Tür: 'Laptop', 'Envanter No': ' ENV-2026-001 ' }], 'b2');
    assert.deepEqual(r.errors, []);
    assert.equal(r.records[0].envanterNo, 'ENV-2026-001');
    assert.deepEqual(plain(load().S.validateB2(r.records[0])), []);
});

test('Envanter No: B1 kaydına da yazılır ve tam B1 sözleşmesinden geçer', () => {
    const r = build([{ Ürün: 'Kablo', 'Envanter No': 'ENV-999' }], 'b1');
    assert.deepEqual(r.errors, []);
    assert.ok(!r.warnings.some(w => /tanınmadı/.test(w)), '"Envanter No" sütunu tanınmayan sütun uyarısı almamalı');
    assert.equal(r.records[0].envanterNo, 'ENV-999');
    assert.deepEqual(plain(load().S.validateB1(r.records[0])), []);
});

test('Seri No: tanınır, kayda sn olarak yazılır; boş ve "-" değer alan eklemez', () => {
    const r = build([
        { Ürün: 'Laptop X', Tür: 'Laptop', 'Envanter No': 'ENV-1', 'Seri No': ' SN-123 ' },
        { Ürün: 'Laptop Y', Tür: 'Laptop', 'Envanter No': 'ENV-2', 'Seri No': '' },
        { Ürün: 'Laptop Z', Tür: 'Laptop', 'Envanter No': 'ENV-3', 'Seri No': '-' },
    ], 'b2');
    assert.deepEqual(r.errors, []);
    assert.ok(!r.warnings.some(w => /tanınmadı/.test(w)), '"Seri No" sütunu tanınmayan sütun uyarısı almamalı');
    assert.equal(r.records[0].sn, 'SN-123');
    assert.ok(!('sn' in r.records[1]) && !('sn' in r.records[2]));
    r.records.forEach(rec => assert.deepEqual(plain(load().S.validateB2(rec)), []));
});

test('Envanter No: boş satır importu tamamen durdurur', () => {
    const { S, I, makeId } = load();
    const r = plain(I.buildStockRecords([{ Ürün: 'Laptop', Tür: 'Laptop' }], 'b2', { schema: S, makeId }));
    assert.deepEqual(r.records, []);
    assert.ok(r.errors.some(error => /Envanter No zorunludur/.test(error)));
});

test('Envanter No: dosya içi tekrarlar normalize edilerek reddedilir', () => {
    const r = build([
        { Ürün: 'Ürün 1', 'Envanter No': 'ENV-1' },
        { Ürün: 'Ürün 2', 'Envanter No': 'env - 1' },
    ], 'b1');
    assert.deepEqual(r.records, []);
    assert.ok(r.errors.some(error => /birden fazla kez/.test(error)));
});

test('Envanter No eşleşmesi: mevcut B1 veya B2 kaydı korunur, farklı alanlar raporlanır', () => {
    const { S, I } = load();
    const incoming = [
        { id: 'b1_new', ürün: 'Yeni Ad', envanterNo: 'ENV-1', raf: 'R-2', adet: 1 },
        { id: 'b1_add', ürün: 'Yeni', envanterNo: 'ENV-2', raf: 'R-1', adet: 1 },
    ];
    const result = plain(I.filterExistingInventoryNumbers(incoming, [{ id: 'b1_new', code: 'R-2' }], [
        { depot: 'b2', records: [{ id: 'b2_old', ürün: 'Eski Ad', envanterNo: 'env-1', raf: 'R-1', adet: 2 }] },
    ], S));
    assert.deepEqual(result.records.map(record => record.id), ['b1_add']);
    assert.deepEqual(result.requests, []);
    assert.equal(result.skipped.length, 1);
    assert.deepEqual(result.skipped[0].differences, ['raf', 'ürün', 'adet']);
});

// ─── v3.3 P1 ek (proje sahibinin talebi) — MAX_IMPORT_ROWS: sabit üst sınır, admin dahil aşılamaz ──────────────────────
test('MAX_IMPORT_ROWS tam olarak 200; sınırda (200 satır) kabul edilir', () => {
    const { I } = load();
    assert.equal(I.MAX_IMPORT_ROWS, 200);
    const rows = Array.from({ length: 200 }, (_, i) => ({ Ürün: `Ürün ${i}` }));
    const r = build(rows);
    assert.deepEqual(r.errors, []);
    assert.equal(r.records.length, 200);
});

test('201 satır (sınırın 1 fazlası) TAMAMEN reddedilir; şema geçerli olsa bile hiç kayıt dönmez', () => {
    const rows = Array.from({ length: 201 }, (_, i) => ({ Ürün: `Ürün ${i}` }));
    const r = build(rows);
    assert.deepEqual(r.records, []);
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0], /201 satır.*en fazla 200 satır.*yönetici dahil/);
    assert.deepEqual(r.warnings, []);
    assert.deepEqual(r.shelvesToCreate, []);
    assert.equal(r.poolOverflowCount, 0);
});

test('sınır ham satır sayısına bakar (boş satırlar ve hatalı satırlar dahil) — satır içeriği değil, dosya boyutu sınırlanır', () => {
    const rows = Array.from({ length: 150 }, () => ({ Ürün: '' })).concat(Array.from({ length: 60 }, (_, i) => ({ Ürün: `Ürün ${i}` })));
    assert.equal(rows.length, 210);
    const r = build(rows);
    assert.deepEqual(r.records, []);
    assert.match(r.errors[0], /210 satır/);
});

test('sınır hem b1 hem b2 için aynı şekilde uygulanır', () => {
    const rows = Array.from({ length: 205 }, (_, i) => ({ Ürün: `Demirbaş ${i}`, Tür: 'Laptop' }));
    const r = build(rows, 'b2');
    assert.deepEqual(r.records, []);
    assert.match(r.errors[0], /205 satır/);
});
