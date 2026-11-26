// v3.8 · VP-1 — Operasyon Merkezi radarlarının saf hesaplama katmanı (src/utils/asset-health.js).
// Gerçek dosya tarayıcısız (vm) yüklenir. Usage: node --test tests/unit/asset-health.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const context = { window: { AppModules: {} } };
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', 'utils', 'asset-health.js'), 'utf8'), context);
const H = context.window.AppModules.AssetHealth;
const plain = x => JSON.parse(JSON.stringify(x));

// 07.10.2026 12:00 (yerel saat)
const NOW = new Date(2026, 9, 7, 12, 0).getTime();
const A = (id, extra) => ({ _id: id, id, _source: 'b3', personel: 'Ali Veli', urun: 'Dizüstü ' + id, sn: 'SN' + id, envanterNo: '-',
    teslimAlindi: true, iadeEdildi: false, iadeTarihi: null, talepTuru: 'Geçici Zimmet', ...extra });

test('aktif zimmet: toplam, teslim bekleyen ve iade edilmiş ayrışır', () => {
    const r = H.summarizeActiveAssignments([
        A(1), A(2, { teslimAlindi: false }), A(3, { iadeEdildi: true }), null, A(4),
    ], NOW);
    assert.equal(r.active, 2);
    assert.equal(r.awaitingDelivery, 1);
    assert.equal(r.overdue.length, 0);
    assert.equal(r.dueSoon.length, 0);
});

test('geciken ve 7 gün içinde yaklaşan iadeler (iki tarih biçimi); sıralama', () => {
    const r = H.summarizeActiveAssignments([
        A(1, { iadeTarihi: '2026-10-05' }),        // 2 gün gecikmiş
        A(2, { iadeTarihi: '01.10.2026' }),        // 6 gün gecikmiş (TR biçimi)
        A(3, { iadeTarihi: '2026-10-07' }),        // bugün → günün sonu: gecikmedi, yaklaşan
        A(4, { iadeTarihi: '2026-10-14' }),        // tam 7 gün sonra (gün sonu) → 7.5 gün: yaklaşan değil
        A(5, { iadeTarihi: '2026-10-13' }),        // yaklaşan
        A(6, { iadeTarihi: '2026-12-01' }),        // uzak
        A(7, { iadeTarihi: 'bozuk' }),             // geçersiz → yok sayılır
        A(8, { iadeTarihi: '2026-10-01', iadeEdildi: true }),                // iade edilmiş
        A(9, { iadeTarihi: '2026-10-01', teslimAlindi: false }),             // teslim alınmamış → gecikme sayılmaz
    ], NOW);
    assert.deepEqual(plain(r.overdue.map(x => x.id)), [2, 1]);
    assert.deepEqual(plain(r.dueSoon.map(x => x.id)), [3, 5]);
    assert.equal(r.overdue[0].daysLeft, -6);
    assert.equal(r.dueSoon[0].daysLeft, 0);
    assert.equal(r.active, 7);
});

test('boş / geçersiz girdi çökmez', () => {
    const r = H.summarizeActiveAssignments(undefined, NOW);
    assert.equal(r.active, 0);
    const s = H.analyzeServiceAndScrap(undefined, null, undefined, undefined);
    assert.deepEqual(plain(s.counts), { inService: 0, scrap: 0, chronic: 0 });
});

const S = (id, extra) => ({ id, productId: 'p1', urunAciklama: 'Yazıcı', sn: 'A1', envanterNo: '-', hedef: 'Teknik Servis',
    durum: 'Serviste / Yolda', sevkTarihi: `0${id}.09.2026 10:00`, kapandi: false, isDemirbas: true, ...extra });

test('kronik arıza: aynı SN\'de ≥2 servis kaydı (açık + kapanmış); tek kayıt kronik değil', () => {
    const r = H.analyzeServiceAndScrap({}, {}, [], [
        S(1, { kapandi: true, durum: 'Depoya Döndü' }),
        S(2),
        S(3, { sn: 'B2', productId: 'p2' }),
    ]);
    assert.equal(r.counts.chronic, 1);
    assert.equal(r.chronic[0].sn, 'A1');
    assert.equal(r.chronic[0].count, 2);
    assert.equal(r.chronic[0].openCount, 1);
    assert.equal(r.inService.length, 2);
    assert.equal(r.inService.find(x => x.id === 2).chronic, true);
    assert.equal(r.inService.find(x => x.id === 3).chronic, false);
    assert.equal(r.inService.find(x => x.id === 3).serviceCount, 1);
});

test('SN büyük/küçük harf ve boşluktan bağımsız; Envanter No yedeği', () => {
    const r = H.analyzeServiceAndScrap([], [], [], [
        S(1, { sn: ' a 1 ', kapandi: true }),
        S(2, { sn: 'A1' }),
        S(3, { sn: '-', envanterNo: 'E-9', productId: 'p5', kapandi: true }),
        S(4, { sn: '-', envanterNo: 'e-9', productId: 'p5' }),
    ]);
    assert.equal(r.chronic.length, 2);
});

test('aynı kayıtta birlikte geçen SN ve Envanter No aynı cihaz sayılır', () => {
    const r = H.analyzeServiceAndScrap([], [], [], [
        S(1, { sn: 'A1', envanterNo: 'E1', kapandi: true }),
        S(2, { sn: '-', envanterNo: 'E1' }),
    ]);
    assert.equal(r.chronic.length, 1);
    assert.equal(r.chronic[0].count, 2);
});

test('productId yalnız demirbaşta kronik anahtardır; sarf kalemler sayılmaz', () => {
    const demirbas = H.analyzeServiceAndScrap([], [], [], [
        S(1, { sn: '-', envanterNo: '-', kapandi: true }), S(2, { sn: '-', envanterNo: '-' }),
    ]);
    assert.equal(demirbas.chronic.length, 1);
    const sarf = H.analyzeServiceAndScrap([], [], [], [
        S(1, { sn: '-', envanterNo: '-', isDemirbas: false, kapandi: true }), S(2, { sn: '-', envanterNo: '-', isDemirbas: false }),
    ]);
    assert.equal(sarf.chronic.length, 0);
    assert.equal(sarf.inService.length, 1);
});

test('virgülle birleşmiş çoklu SN farklı cihazları birleştirmez', () => {
    const r = H.analyzeServiceAndScrap([], [], [], [
        S(1, { sn: 'X1,X2', kapandi: true }),
        S(2, { sn: 'X3', productId: 'p9' }),
    ]);
    assert.equal(r.chronic.length, 0);
});

test('hurda dökümü: b3 hurda kaydı + b3 ikizi olmayan hurdaya ayrılmış servis kaydı, tekilleştirilir', () => {
    const b3 = [
        { id: 'h1', tip: 'hurda', productId: 'p1', sn: 'A1', envanterNo: '-', urunAciklama: 'Yazıcı', adet: 1, tarih: '08.09.2026 10:00', ts: 200, isDemirbas: true },
        { id: 'c1', tip: 'cikis', productId: 'p1', sn: 'A1' },
    ];
    const r = H.analyzeServiceAndScrap([], [], b3, [
        S(1, { sn: 'A1', kapandi: true, durum: 'Hurdaya Ayrıldı', donusTarihi: '08.09.2026 10:00' }),   // b3 ikizi var → eklenmez
        S(2, { sn: 'Z9', productId: 'p3', kapandi: true, durum: 'Hurdaya Ayrıldı', donusTarihi: '09.09.2026 09:00' }),
    ]);
    assert.equal(r.scrap.length, 2);
    assert.deepEqual(plain(r.scrap.map(x => x.source).sort()), ['b3', 'service']);
    assert.equal(r.inService.length, 0);   // kapanmış kayıtlar serviste sayılmaz
});

test('ürün adı yoksa B1/B2 stokundan tamamlanır', () => {
    const r = H.analyzeServiceAndScrap({ p1: { id: 'p1', ürün: 'HP Yazıcı', tür: 'Yazıcı' } }, [], [], [S(1, { urunAciklama: '' })]);
    assert.equal(r.inService[0].urun, 'HP Yazıcı');
    assert.equal(r.inService[0].tur, 'Yazıcı');
});
