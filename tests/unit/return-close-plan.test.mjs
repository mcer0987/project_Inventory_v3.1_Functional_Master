// feat/envanter-talep-iade · Faz 5 — iade/zimmetten düş kapanış planı (AssignmentService.planClose, YAZMAZ).
// "Zimmetten Düş" ve iade talebi onayı aynı planı kullanır: b3 (+assignments, +son cihazsa requests) güncellemesi ve
// yalnız yönetici "stoğa ekle" derse ürün kalemine +adet. schema.js + assignment-service.js vm ile yüklenir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const plain = x => JSON.parse(JSON.stringify(x));
const T = '06.11.2026';

const Z = (id, extra) => ({
    id, sema: 2, tip: 'zimmet', kaynakDepo: 'b1', productId: 'p1', requestId: null, rafNo: 'R1', sutun: 'S1',
    urunTuru: 'Laptop', urunAciklama: 'Latitude 5440', marka: 'Dell', adet: 1, sn: 'SN' + id, envanterNo: 'INV' + id,
    not: '-', alanKisi: 'Ayşe Yılmaz', personelId: 'p_ay', tarih: '01.10.2026', ts: 1000 + id,
    isDemirbas: true, talepTuru: 'Demirbaş İhtiyacı', oncelik: 'Orta', iadeTarihi: null, iadeEdildi: false,
    iadeEdildiTarihi: null, iadeDepo: null, onaylayan: 'Admin', ...extra,
});

function load(data) {
    const win = { data: { personel: [], b1: [], b2: [], productTypes: [], requests: [], b3: [], assignments: [], ...data } };
    const ctx = vm.createContext({ window: win, console });
    for (const f of ['src/utils/schema.js', 'src/services/assignment-service.js']) {
        vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
    }
    return { win, A: win.AssignmentService };
}

test('teslim alındı + stoğa ekle: b3 kapanır, iadeDepo seçilen depo, ürün kalemine +adet', () => {
    const { win, A } = load({ b3: [Z(1, { adet: 2 })], b2: [{ id: 'p1', ürün: 'Latitude 5440', adet: 3 }] });
    const before = JSON.stringify(win.data);
    const p = plain(A.planClose(1, { teslimAlindi: true, depo: 'b2', stogaEkle: true, tarih: T }));
    assert.equal(p.ok, true);
    assert.equal(p.qty, 2);
    assert.deepEqual(p.stock, [{ col: 'b2', id: 'p1', delta: 2 }]);
    assert.deepEqual(p.writes, [{ op: 'update', col: 'b3', id: 1, fields: { iadeEdildi: true, iadeDepo: 'b2', iadeEdildiTarihi: T } }]);
    assert.equal(JSON.stringify(win.data), before, 'plan veriyi değiştirmemeli');
});

test('teslim alındı, stoğa eklenmez (hasarlı): stok hareketi yok, iadeDepo yine kaydedilir', () => {
    const { A } = load({ b3: [Z(1)] });
    const p = plain(A.planClose(1, { teslimAlindi: true, depo: 'b1', stogaEkle: false, tarih: T }));
    assert.equal(p.ok, true);
    assert.deepEqual(p.stock, []);
    assert.equal(p.writes[0].fields.iadeDepo, 'b1');
});

test('teslim alınmadı: iadeDepo null, stok yok; stoğa ekle istenirse reddedilir', () => {
    const { A } = load({ b3: [Z(1)] });
    const p = plain(A.planClose(1, { teslimAlindi: false, tarih: T }));
    assert.equal(p.ok, true);
    assert.equal(p.writes[0].fields.iadeDepo, null);
    assert.deepEqual(p.stock, []);
    assert.match(A.planClose(1, { teslimAlindi: false, stogaEkle: true, tarih: T }).error, /stoğa eklenemez/);
});

test('hatalar: kayıt yok, çıkış kaydı, zaten iade, depo eksik', () => {
    const { A } = load({ b3: [Z(1, { iadeEdildi: true, iadeEdildiTarihi: T }), Z(2, { tip: 'cikis', talepTuru: null, oncelik: null }), Z(3)] });
    assert.match(A.planClose(99, { tarih: T }).error, /bulunamadı/);
    assert.match(A.planClose(2, { tarih: T }).error, /zimmet değil/);
    assert.match(A.planClose(1, { tarih: T }).error, /zaten iade/);
    assert.match(A.planClose(3, { teslimAlindi: true, tarih: T }).error, /depo seçin/);
    assert.match(A.planClose(3, { teslimAlindi: true, depo: 'b3', tarih: T }).error, /depo seçin/);
});

test('ürün eşleşmesi: productId önce; yoksa ad tek ve kesin olmalı', () => {
    const { A } = load({
        b3: [Z(1, { productId: 'yok' }), Z(2, { productId: null, urunAciklama: 'Monitör' })],
        b1: [{ id: 'x1', ürün: 'latitude 5440 ', adet: 0 }, { id: 'm1', ürün: 'Monitör', adet: 1 }, { id: 'm2', ürün: 'monitör', adet: 1 }],
    });
    const p = A.planClose(1, { teslimAlindi: true, depo: 'b1', stogaEkle: true, tarih: T });
    assert.equal(p.ok, true);
    assert.equal(p.product.id, 'x1');
    const amb = A.planClose(2, { teslimAlindi: true, depo: 'b1', stogaEkle: true, tarih: T });
    assert.equal(amb.ok, false);
    assert.match(amb.error, /tek ve kesin/);
    // stoğa eklenmeden kapatma her zaman mümkün
    assert.equal(A.planClose(2, { teslimAlindi: true, depo: 'b1', tarih: T }).ok, true);
});

test('assignments aynası ve talebin son cihazı: ek yazımlar', () => {
    const { A } = load({
        b3: [Z(1, { requestId: 'r1' }), Z(2, { requestId: 'r1' }), Z(3, { requestId: 'r2' })],
        assignments: [{ id: 1 }],
        requests: [{ id: 'r1' }, { id: 'r2' }],
    });
    const p1 = plain(A.planClose(1, { tarih: T }));
    assert.deepEqual(p1.writes.map(w => w.col), ['b3', 'assignments'], 'r1\'in diğer cihazı açıkken talep kapanmaz');
    const p3 = plain(A.planClose(3, { tarih: T }));
    assert.deepEqual(p3.writes.map(w => w.col), ['b3', 'requests']);
    assert.deepEqual(p3.writes[1], { op: 'update', col: 'requests', id: 'r2', fields: { iadeEdildi: true, iadeEdildiTarihi: T } });
});
