// v3.7 İP-10 · Depo / Çoklu Raf Sayım Oturumu — saf fark motoru ve rapor projeksiyonu birim testleri.
// Usage: node --test tests/unit/shelf-count-session.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const window = {};
const context = vm.createContext({ window });
for (const f of ['src/utils/schema.js', 'src/utils/shelf-count-session.js']) {
    vm.runInContext(readFileSync(f, 'utf8'), context);
}
const SC = window.AppModules.ShelfCount;
const plain = v => JSON.parse(JSON.stringify(v));

test('computeVariance: eksik, fazla, tam, bekleyen ve geçersiz giriş denetimi', () => {
    assert.deepEqual(plain(SC.computeVariance(5, null)), { systemQty: 5, countedQty: null, diff: null, state: 'pending' });
    assert.deepEqual(plain(SC.computeVariance(5, '')), { systemQty: 5, countedQty: null, diff: null, state: 'pending' });
    assert.deepEqual(plain(SC.computeVariance(5, 3)), { systemQty: 5, countedQty: 3, diff: -2, state: 'missing' });
    assert.deepEqual(plain(SC.computeVariance(5, 8)), { systemQty: 5, countedQty: 8, diff: 3, state: 'excess' });
    assert.deepEqual(plain(SC.computeVariance(5, 5)), { systemQty: 5, countedQty: 5, diff: 0, state: 'match' });
    assert.deepEqual(plain(SC.computeVariance(0, 0)), { systemQty: 0, countedQty: 0, diff: 0, state: 'match' });
    assert.deepEqual(plain(SC.computeVariance(0, 2)), { systemQty: 0, countedQty: 2, diff: 2, state: 'excess' });

    for (const bad of [-1, 1.5, 'abc', Number.NaN, Number.POSITIVE_INFINITY]) {
        assert.throws(() => SC.computeVariance(5, bad), undefined, String(bad));
    }
});

test('buildCountRows: adet 0 dahil raf filtreleme, sıralama, mutasyonsuzluk ve ön-dolu sayımlar', () => {
    const depotRows = [
        { id: 'p3', ürün: 'Toner', tür: 'Sarf', raf: 'raf-b 2', adet: 0, durumu: 'Tükendi', rafPasif: true },
        { id: 'p1', ürün: 'Kablo', tür: 'Aksesuar', raf: 'RAF-A 1', adet: 10, marka: 'Dell', envanterNo: 'ENV-01', rafPasif: true },
        { id: 'p2', ürün: 'Adaptör', tür: 'Aksesuar', raf: 'RAF-A 1', adet: 4, seriNo: 'SN-22', rafPasif: true },
        { id: 'p4', ürün: 'Havuz Ürünü', tür: 'Diğer', raf: '', adet: 7 },
    ];
    const snapshot = JSON.stringify(depotRows);

    const single = SC.buildCountRows(depotRows, ['raf-a 1']);
    assert.deepEqual(plain(single.map(r => r.id)), ['p2', 'p1'], 'aynı rafta Türkçe alfabetik sıra');
    assert.equal(JSON.stringify(depotRows), snapshot, 'girdi dizisi mutasyona uğramaz');

    const multi = SC.buildCountRows(depotRows, ['RAF-B 2', 'RAF-A 1'], {
        countedMap: { p1: { countedQty: 8, note: '2 adet eksik' }, p3: { countedQty: 1, note: 'Rafta bulundu' } },
    });
    assert.deepEqual(plain(multi.map(r => [r.id, r.shelfCode, r.systemQty, r.countedQty, r.state])), [
        ['p2', 'RAF-A 1', 4, null, 'pending'],
        ['p1', 'RAF-A 1', 10, 8, 'missing'],
        ['p3', 'RAF-B 2', 0, 1, 'excess'],
    ]);
    assert.equal(multi[1].note, '2 adet eksik');
    assert.equal(multi[2].isLocked, true);

    const all = SC.buildCountRows(depotRows, 'ALL');
    assert.equal(all.length, 3, 'rafsız Havuz ürünü dahil edilmez, adet 0 raf ürünü dahil edilir');
    assert.deepEqual(plain(SC.buildCountRows(depotRows, [])), []);
    assert.throws(() => SC.buildCountRows(depotRows, ['RAF-A 1'], { countedMap: { p1: { countedQty: 1, note: '<b>x</b>' } } }));
});

test('summarizeVariances & buildCountReportData: özet metrikleri ve PDF/Excel veri projeksiyonu', () => {
    const rows = [
        { id: 'a', shelfCode: 'RAF-A 1', name: 'Monitör', type: 'Ekran', envanterNo: 'ENV-10', serialNo: 'S1', systemQty: 5, countedQty: 3, note: 'Eksik' },
        { id: 'b', shelfCode: 'RAF-A 1', name: 'Klavye', type: 'Çevre', envanterNo: '', serialNo: '', systemQty: 2, countedQty: 4, note: 'Fazla' },
        { id: 'c', shelfCode: 'RAF-B 1', name: 'Mouse', type: 'Çevre', envanterNo: '', serialNo: '', systemQty: 6, countedQty: 6, note: '' },
        { id: 'd', shelfCode: 'RAF-B 1', name: 'Switch', type: 'Ağ', envanterNo: '', serialNo: '', systemQty: 1, countedQty: null, note: '' },
    ];

    const sum = SC.summarizeVariances(rows);
    assert.deepEqual(plain(sum), {
        total: 4, counted: 3, pending: 1, missing: 1, excess: 1, match: 1,
        systemTotalQty: 14, countedTotalQty: 13, missingQty: 2, excessQty: 2, netDiff: 0,
    });

    const report = SC.buildCountReportData({
        depot: 'b2', reason: 'Yıl Sonu Sayımı', createdBy: 'Ahmet Yılmaz',
        date: '2026-11-25T10:30:00Z', reportNo: 'SYM-B2-20261125',
    }, rows);

    assert.equal(report.belge.depo, 'b2');
    assert.equal(report.belge.depoAdi, 'B2 Demirbaş Deposu');
    assert.deepEqual(plain(report.belge.raflar), ['RAF-A 1', 'RAF-B 1']);
    assert.equal(report.kalemler.length, 4);
    assert.deepEqual(report.kalemler.map(k => [k.sira, k.farkLabel, k.durumLabel]), [
        [1, '-2', 'Eksik'],
        [2, '+2', 'Fazla'],
        [3, '0', 'Tam'],
        [4, '-', 'Bekleyen'],
    ]);
    assert.equal(report.excelRows[0]['Ürün Adı'], 'Monitör');
    assert.equal(report.excelRows[0]['Fark'], -2);
    assert.equal(report.excelRows[3]['Sayılan Adet'], '');
});
