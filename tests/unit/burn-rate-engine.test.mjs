// v3.8 · VP-2 — AI Sarf Tüketim & Tahminleme Motoru ve Kritik Sipariş aday motoru birim testleri.
// Gerçek dosya tarayıcısız (vm) yüklenir. Usage: node --test tests/unit/burn-rate-engine.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const context = { window: { AppModules: {} } };
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', 'utils', 'burn-rate-engine.js'), 'utf8'), context);
const BR = context.window.AppModules.BurnRate;
const plain = x => JSON.parse(JSON.stringify(x));

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date(2026, 10, 26, 12, 0).getTime(); // 26.11.2026 12:00
const daysAgo = d => NOW - d * DAY_MS + 60 * 1000;

const PRODUCT_TYPES = [
    { name: 'Sarf Malzeme', isDemirbas: false },
    { name: 'Kağıt & Kırtasiye', isDemirbas: false },
    { name: 'Laptop', isDemirbas: true },
];

const stockRow = (id, name, adet, extra = {}) => ({
    id, ürün: name, tür: 'Sarf Malzeme', adet, limit: 5, durumu: 'Kullanıma Hazır', isDemirbas: false, ...extra,
});

const exitRow = (id, productId, name, adet, agoDays, extra = {}) => ({
    id, tip: 'cikis', productId, urunAciklama: name, urunTuru: 'Sarf Malzeme', adet,
    ts: daysAgo(agoDays), isDemirbas: false, iadeEdildi: false, ...extra,
});

test('sıfır tüketim: halüsinasyon üretmez, insufficient ve daysRemaining=null döner', () => {
    const res = BR.analyzeBurnRate({
        b1: [stockRow('p1', 'A4 Kağıdı', 25)],
        b2: [],
        b3: [],
        productTypes: PRODUCT_TYPES,
        windowDays: 30,
        nowMs: NOW,
    });
    assert.equal(res.items.length, 1);
    assert.equal(res.items[0].status, 'insufficient');
    assert.equal(res.items[0].confidence, 'insufficient');
    assert.equal(res.items[0].daysRemaining, null);
    assert.equal(res.items[0].dailyRate, 0);
    assert.equal(res.counts.insufficient, 1);
});

test('tek kayıt / tek gün tüketimi: yetersiz veri (uydurma gün üretilmez)', () => {
    const res = BR.analyzeBurnRate({
        b1: [stockRow('p1', 'Toner 85A', 10)],
        b2: [],
        b3: [
            exitRow('e1', 'p1', 'Toner 85A', 3, 2),
            exitRow('e2', 'p1', 'Toner 85A', 2, 2), // aynı gün 2. kayıt → activeDays === 1
        ],
        productTypes: PRODUCT_TYPES,
        windowDays: 30,
        nowMs: NOW,
    });
    assert.equal(res.items[0].activeDays, 1);
    assert.equal(res.items[0].status, 'insufficient');
    assert.equal(res.items[0].daysRemaining, null);
});

test('sabit tüketim (günde 2 adet × 30 gün): tam 2.0/gün hız, doğru daysRemaining ve steady eğilim', () => {
    const b3 = [];
    for (let d = 1; d <= 30; d++) {
        b3.push(exitRow(`e${d}`, 'p1', 'A4 Kağıdı', 2, d));
    }
    const res = BR.analyzeBurnRate({
        b1: [stockRow('p1', 'A4 Kağıdı', 20, { limit: 10 })],
        b2: [],
        b3,
        productTypes: PRODUCT_TYPES,
        windowDays: 30,
        safetyDays: 30,
        nowMs: NOW,
    });
    const item = res.items[0];
    assert.equal(item.dailyRate, 2);
    assert.equal(item.monthlyRate, 60);
    assert.equal(item.trend, 'steady');
    assert.equal(item.daysRemaining, 10);
    assert.equal(item.status, 'critical');
    assert.equal(item.confidence, 'high');
    assert.equal(item.suggestedOrderQty, 40); // 30*2 - 20 = 40
});

test('hızlanan tüketim: EWMA düz ortalamanın üzerine çıkar ve trend=accelerating olur', () => {
    const b3 = [];
    // İlk 20 gün: günde 1 adet; son 10 gün: günde 5 adet
    for (let d = 11; d <= 30; d++) b3.push(exitRow(`old${d}`, 'p1', 'Eldiven', 1, d));
    for (let d = 1; d <= 10; d++) b3.push(exitRow(`new${d}`, 'p1', 'Eldiven', 5, d));

    const res = BR.analyzeBurnRate({
        b1: [stockRow('p1', 'Eldiven', 50, { limit: 5 })],
        b2: [],
        b3,
        productTypes: PRODUCT_TYPES,
        windowDays: 30,
        nowMs: NOW,
    });
    const item = res.items[0];
    assert.equal(item.trend, 'accelerating');
    assert.ok(item.ewmaRate > item.windowAvg, `ewma(${item.ewmaRate}) > windowAvg(${item.windowAvg})`);
    assert.ok(item.dailyRate > item.windowAvg);
    assert.equal(item.status, 'warning'); // ~17 gün kaldı
});

test('stok 0 durumu: tüketim geçmişi varken critical ve daysRemaining=0 döner', () => {
    const res = BR.analyzeBurnRate({
        b1: [stockRow('p1', 'Etiket Rulosu', 0, { limit: 4, durumu: 'Tükendi' })],
        b2: [],
        b3: [
            exitRow('e1', 'p1', 'Etiket Rulosu', 4, 20),
            exitRow('e2', 'p1', 'Etiket Rulosu', 4, 10),
            exitRow('e3', 'p1', 'Etiket Rulosu', 4, 2),
        ],
        productTypes: PRODUCT_TYPES,
        windowDays: 30,
        nowMs: NOW,
    });
    const item = res.items[0];
    assert.equal(item.currentStock, 0);
    assert.equal(item.daysRemaining, 0);
    assert.equal(item.status, 'critical');
    assert.ok(item.suggestedOrderQty >= 1);
});

test('demirbaş, zimmet, hurda, iade edilmiş ve pencere dışı hareketler dışlanır', () => {
    const res = BR.analyzeBurnRate({
        b1: [
            stockRow('p1', 'Kalem Pil', 30),
            stockRow('d1', 'Dell Laptop', 2, { tür: 'Laptop', isDemirbas: true }),
            stockRow('pLocked', 'Sayım Sarfı', 5, { rafPasif: true }),
        ],
        b2: [],
        b3: [
            exitRow('ok1', 'p1', 'Kalem Pil', 3, 12),
            exitRow('ok2', 'p1', 'Kalem Pil', 3, 4),
            exitRow('ret', 'p1', 'Kalem Pil', 50, 3, { iadeEdildi: true }),
            exitRow('zim', 'p1', 'Kalem Pil', 50, 5, { tip: 'zimmet' }),
            exitRow('hur', 'p1', 'Kalem Pil', 50, 6, { tip: 'hurda' }),
            exitRow('old', 'p1', 'Kalem Pil', 50, 45), // 30 günlük pencere dışında
            exitRow('dem1', 'd1', 'Dell Laptop', 1, 8, { isDemirbas: true, urunTuru: 'Laptop' }),
            exitRow('dem2', 'd1', 'Dell Laptop', 1, 2, { isDemirbas: true, urunTuru: 'Laptop' }),
        ],
        productTypes: PRODUCT_TYPES,
        windowDays: 30,
        nowMs: NOW,
    });
    assert.equal(res.items.length, 1);
    assert.equal(res.items[0].name, 'Kalem Pil');
    assert.equal(res.items[0].totalConsumed, 6);
    assert.equal(res.items[0].activeDays, 2);
});

test('pencere (30 vs 90 gün) seçimi dışarıda kalan hareketleri içeri alır', () => {
    const b3 = [
        exitRow('e1', 'p1', 'USB Kablo', 6, 70),
        exitRow('e2', 'p1', 'USB Kablo', 6, 45),
        exitRow('e3', 'p1', 'USB Kablo', 6, 10),
    ];
    const r30 = BR.analyzeBurnRate({ b1: [stockRow('p1', 'USB Kablo', 10)], b2: [], b3, windowDays: 30, nowMs: NOW });
    const r90 = BR.analyzeBurnRate({ b1: [stockRow('p1', 'USB Kablo', 10)], b2: [], b3, windowDays: 90, nowMs: NOW });
    assert.equal(r30.items[0].status, 'insufficient');
    assert.notEqual(r90.items[0].status, 'insufficient');
    assert.equal(r90.items[0].totalConsumed, 18);
});

test('buildCriticalOrderCandidates + buildPurchasePrefillPayload: 3 kalem sınırı ve proaktif birleştirme', () => {
    const b3 = [];
    for (let d = 1; d <= 30; d++) b3.push(exitRow(`k${d}`, 'pBurn', 'Termal Rulo', 2, d));
    const b1 = [
        stockRow('pZero', 'Toner Siyah', 0, { limit: 3, durumu: 'Tükendi' }),
        stockRow('pLow', 'Mouse Pad', 2, { limit: 5 }),
        stockRow('pBurn', 'Termal Rulo', 20, { limit: 5 }), // limit üstünde ama 10 günde tükenecek!
        stockRow('pExtra', 'HDMI Kablo', 1, { limit: 4 }),
    ];
    const br = BR.analyzeBurnRate({ b1, b2: [], b3, productTypes: PRODUCT_TYPES, windowDays: 30, nowMs: NOW });
    const crit = BR.buildCriticalOrderCandidates(br, { b1, b2: [], productTypes: PRODUCT_TYPES });
    assert.equal(crit.counts.total, 4);
    assert.equal(crit.counts.outOfStock, 1);
    assert.equal(crit.counts.burnOnly, 1);
    assert.equal(crit.items[0].name, 'Toner Siyah'); // stok 0 en üstte

    const payload = plain(BR.buildPurchasePrefillPayload(crit.items));
    assert.equal(payload.items.length, 3);
    assert.equal(payload.truncatedCount, 1);
    assert.equal(payload.priority, 'Acil');
    assert.equal(payload.items[0].description, 'Toner Siyah');
    assert.equal(payload.items[0].unitPrice, '');
    assert.ok(payload.description.includes('Toner Siyah'));
});

test('boş veya geçersiz girdilerde çökmez', () => {
    const r = BR.analyzeBurnRate();
    assert.deepEqual(plain(r.counts), { total: 0, critical: 0, warning: 0, safe: 0, insufficient: 0 });
    const c = BR.buildCriticalOrderCandidates(r, {});
    assert.equal(c.items.length, 0);
    const p = BR.buildPurchasePrefillPayload([]);
    assert.equal(p.items.length, 0);
});
