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
    return { S: ctx.window.Schema, I: ctx.window.StockImport, makeId: () => 1000 + (n++) };
}
const build = (rows, col = 'b1') => {
    const { S, I, makeId } = load();
    return plain(I.buildStockRecords(rows, col, { schema: S, makeId, now: 1760000000000 }));
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

test('içe aktarma: geçersiz depo reddedilir', () => {
    assert.match(build([{ Ürün: 'A' }], 'b3').errors[0], /Geçersiz depo/);
});
