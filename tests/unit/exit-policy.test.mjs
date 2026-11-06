// v3.4 · personel (BT ekibi) sarf çıkışı politikası — firestore.rules staffExitB3Ok / staffExitStockOk ile aynı ölçüt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function load() {
    const window = {};
    vm.runInContext(readFileSync('src/utils/exit-policy.js', 'utf8'), vm.createContext({ window }));
    return window.ExitPolicy;
}
const P = load();
const types = [
    { id: 'pt_sarf', name: 'Sarf Malzeme', isDemirbas: false },
    { id: 'pt_lap', name: 'Laptop', isDemirbas: true },
    { id: 'pt_eski', name: 'Kablo', isDemirbas: 'false' },   // metin bayrak: karar verilemez
];

test('sarf türündeki ürün uygun; tür id\'si döner', () => {
    const r = P.eligibility({ id: 'p1', tür: ' Sarf Malzeme ' }, types);
    assert.deepEqual([r.ok, r.typeId, r.typeName], [true, 'pt_sarf', 'Sarf Malzeme']);
});
test('demirbaş türü reddedilir; kayıttaki isDemirbas:false türü ezmez', () => {
    assert.equal(P.eligibility({ tür: 'Laptop' }, types).reason, 'demirbas');
    assert.equal(P.eligibility({ tür: 'Laptop', isDemirbas: false }, types).reason, 'demirbas');
});
test('tür kataloğda birebir yoksa (büyük/küçük harf dahil) karar yöneticiye kalır', () => {
    assert.equal(P.eligibility({ tür: 'sarf malzeme' }, types).reason, 'unknownType');
    assert.equal(P.eligibility({ tür: '' }, types).reason, 'unknownType');
    assert.equal(P.eligibility({ tür: 'Bilinmeyen' }, []).reason, 'unknownType');
});
test('B2 eski "type" alanı da okunur; boolean olmayan bayrak demirbaş sayılır (güvenli taraf)', () => {
    assert.equal(P.eligibility({ type: 'Sarf Malzeme' }, types).ok, true);
    assert.equal(P.eligibility({ tür: 'Kablo' }, types).reason, 'demirbas');
});
test('ürün yoksa reddedilir', () => assert.equal(P.eligibility(null, types).reason, 'noProduct'));

const b3 = (id, over = {}) => ({ op: 'set', col: 'b3', id, data: { id, tip: 'cikis', kaynakDepo: 'b1', productId: 'p1', adet: 2, isDemirbas: false, urunTuruId: 'pt_sarf', islemYapanUid: 'u1', ...over } });

test('geçerli plan: ürün başına tek b3 kaydı, bağ haritası döner', () => {
    const r = P.checkStaffPlan([{ col: 'b1', id: 'p1', delta: -2 }], [b3('x1')]);
    assert.equal(r.ok, true);
    assert.equal(r.links.get('b1|p1'), 'x1');
});
test('stok artırma, eksik/fazla kayıt, adet uyumsuzluğu ve demirbaş reddedilir', () => {
    assert.equal(P.checkStaffPlan([{ col: 'b1', id: 'p1', delta: 2 }], [b3('x1')]).ok, false);
    assert.equal(P.checkStaffPlan([{ col: 'b1', id: 'p1', delta: -2 }], []).ok, false);
    assert.equal(P.checkStaffPlan([{ col: 'b1', id: 'p1', delta: -2 }], [b3('x1'), b3('x2')]).ok, false);
    assert.equal(P.checkStaffPlan([{ col: 'b1', id: 'p1', delta: -3 }], [b3('x1')]).ok, false);
    assert.equal(P.checkStaffPlan([{ col: 'b1', id: 'p1', delta: -2 }], [b3('x1', { isDemirbas: true })]).ok, false);
    assert.equal(P.checkStaffPlan([{ col: 'b1', id: 'p1', delta: -2 }], [b3('x1', { tip: 'zimmet' })]).ok, false);
    assert.equal(P.checkStaffPlan([{ col: 'b1', id: 'p1', delta: -2 }], [b3('x1', { urunTuruId: '' })]).ok, false);
    assert.equal(P.checkStaffPlan([{ col: 'b1', id: 'p1', delta: -2, createIfMissing: {} }], [b3('x1')]).ok, false);
});
test('b3 dışı yazma ve kalem sınırı aşımı reddedilir', () => {
    assert.equal(P.checkStaffPlan([{ col: 'b1', id: 'p1', delta: -2 }], [{ op: 'set', col: 'requests', id: 'r', data: {} }]).ok, false);
    const n = P.STAFF_MAX_ITEMS + 1;
    const stock = Array.from({ length: n }, (_, i) => ({ col: 'b1', id: `p${i}`, delta: -1 }));
    const writes = stock.map((s, i) => b3(`x${i}`, { productId: s.id, adet: 1 }));
    assert.match(P.checkStaffPlan(stock, writes).error, /en fazla/);
    assert.equal(P.checkStaffPlan(stock.slice(0, P.STAFF_MAX_ITEMS), writes.slice(0, P.STAFF_MAX_ITEMS)).ok, true);
});
