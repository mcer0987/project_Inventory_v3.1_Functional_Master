// Faz 5 · K2 — B1/B2 şema sözleşmesi (Schema.validateB1/validateB2), B3 'hurda' tipi ve bunların firebase-handler.js
// guard'ına (applyItemOps/runStockOps/saveData) kancalanması. schema.js gerçek dosyasıyla, tarayıcısız (vm) yüklenir.
// Guard entegrasyonu scratch/flow-tests.js:b1WriteContract/b2WriteContract'ta gerçek UI akışlarıyla ayrıca doğrulanır.
// Usage: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function loadSchema() {
    const ctx = vm.createContext({ window: {}, console });
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/utils/schema.js'), 'utf8'), ctx, { filename: 'schema.js' });
    return ctx.window.Schema;
}

const validB1 = () => ({
    id: 'b1_1', sütun: 'A', raf: 'R1', tür: 'Kablo', ürün: 'HDMI Kablo', marka: 'Generic',
    adet: 5, durumu: 'Kullanıma Hazır', açıklama: '', isDemirbas: false, lastUpdate: Date.now(),
});
const validB2 = () => ({
    id: 'b2_1', sütun: 'A', raf: 'R1', tür: 'Dizüstü Bilgisayar', ürün: 'Latitude 5440', marka: 'Dell',
    adet: 1, durumu: 'Kullanıma Hazır', status: 'Kullanıma Hazır', açıklama: '', isDemirbas: true, lastUpdate: Date.now(),
});

test('validateB1: geçerli kayıt → hata yok', () => {
    const S = loadSchema();
    assert.equal(S.validateB1(validB1()).length, 0);
});

test('validateB1: eksik alan tek tek yakalanır', () => {
    const S = loadSchema();
    for (const k of S.B1_KEYS) {
        const bad = validB1(); delete bad[k];
        const errors = S.validateB1(bad);
        assert.ok(errors.some(e => e.includes(`eksik alan: ${k}`)), `${k} eksikliği yakalanmalı`);
    }
});

test('validateB1: eski alan adları (name/type/shelf/qty/status) reddedilir', () => {
    const S = loadSchema();
    for (const k of S.B1_LEGACY_KEYS) {
        const bad = { ...validB1(), [k]: 'x' };
        assert.ok(S.validateB1(bad).some(e => e.includes(`eski alan: ${k}`)), `${k} eski alan sayılmalı`);
    }
});

test('validateB1: iş kuralları — boş ürün adı, negatif/ondalık adet, yanlış tip', () => {
    const S = loadSchema();
    assert.ok(S.validateB1({ ...validB1(), ürün: '  ' }).some(e => e.includes('ürün adı boş olamaz')));
    assert.ok(S.validateB1({ ...validB1(), adet: -1 }).some(e => e.includes('geçersiz adet')));
    assert.ok(S.validateB1({ ...validB1(), adet: 1.5 }).some(e => e.includes('geçersiz adet')));
    assert.equal(S.validateB1({ ...validB1(), adet: 0 }).length, 0, '0 adet (Tükendi) geçerlidir');
    assert.ok(S.validateB1({ ...validB1(), isDemirbas: 'true' }).some(e => e.includes('isDemirbas boolean değil')));
    assert.ok(S.validateB1({ ...validB1(), lastUpdate: '123' }).some(e => e.includes('lastUpdate sayı değil')));
    assert.ok(S.validateB1({ ...validB1(), marka: 5 }).some(e => e.includes('marka string değil')));
    assert.equal(S.validateB1({ ...validB1(), marka: '', durumu: '' }).length, 0, 'marka ve durumu boş string olabilir');
});

test('validateB2: geçerli kayıt → hata yok; durumu VE status birlikte zorunlu', () => {
    const S = loadSchema();
    assert.equal(S.validateB2(validB2()).length, 0);
    const noStatus = validB2(); delete noStatus.status;
    assert.ok(S.validateB2(noStatus).some(e => e.includes('eksik alan: status')));
    const noDurumu = validB2(); delete noDurumu.durumu;
    assert.ok(S.validateB2(noDurumu).some(e => e.includes('eksik alan: durumu')));
});

test('validateB2: B1 sözleşmesiyle çapraz kontrol edilmez (B1 eski alanı status, B2de kanoniktir)', () => {
    const S = loadSchema();
    assert.ok(!S.B2_LEGACY_KEYS.includes('status'), 'status B2 için eski alan olmamalı');
    assert.ok(S.B1_LEGACY_KEYS.includes('status'), 'status B1 için eski alan olmalı (yalnız B2 taşır)');
});

test('{legacy:true}: eksik alan göz ardı edilir, eski alan adı yine reddedilir', () => {
    const S = loadSchema();
    const sparse = { ürün: 'Eski Kayıt', adet: 3 };
    assert.equal(S.validateB1(sparse, { legacy: true }).length, 0);
    assert.ok(S.validateB1({ ...sparse, name: 'x' }, { legacy: true }).some(e => e.includes('eski alan: name')));
});

test("B3_TIP.HURDA: buildB3Entry/normalizeB3/validateB3 'hurda' tipini tanır", () => {
    const S = loadSchema();
    const entry = S.buildB3Entry({ tip: 'hurda', adet: 1, urunAciklama: 'Arızalı Laptop', alanKisi: 'Admin', isDemirbas: true, sn: 'HRD-1' });
    assert.equal(entry.tip, 'hurda');
    assert.equal(entry.talepTuru, null, 'hurda zimmet değildir; talepTuru/oncelik zorunlu olmamalı');
    assert.equal(S.validateB3(entry).length, 0);

    const n = S.normalizeB3(entry);
    assert.equal(n.tip, 'hurda');

    // tip alanı olmayan eski bir kayıt, zimmet işareti taşımıyorsa hâlâ 'cikis' sayılır (geriye dönük uyum)
    const legacyCikis = S.buildB3Entry({ tip: 'cikis', adet: 1, urunAciklama: 'Kablo', alanKisi: 'Admin' });
    assert.equal(S.normalizeB3({ ...legacyCikis, tip: undefined }).tip, 'cikis');

    assert.ok(S.validateB3({ ...entry, tip: 'yanlis' }).some(e => e.includes('geçersiz tip')));
    // demirbaş kuralı hurda için de geçerli: adet 1 ve kimlik zorunlu
    assert.ok(S.validateB3({ ...entry, adet: 2 }).some(e => e.includes('cihaz başına bir kayıt')));
    assert.ok(S.validateB3({ ...entry, sn: '-', envanterNo: '-' }).some(e => e.includes('Seri No veya Envanter No yok')));
});
