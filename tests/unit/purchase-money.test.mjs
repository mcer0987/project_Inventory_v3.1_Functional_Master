import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

const sandbox = { window: {}, crypto: { randomUUID: () => 'new-id' } };
vm.runInNewContext(readFileSync(resolve('src/utils/purchase-money.js'), 'utf8'), sandbox);
const money = sandbox.window.AppModules.PurchaseMoney;
const line = (overrides = {}) => ({ id: 'a', description: 'Kablo', category: 'Mal', quantity: '1', unit: 'Adet', unitPrice: '1.00', currency: 'TRY', taxRate: '20', ...overrides });

test('ondalık miktar, fiyat ve KDV tam sayı ölçeğiyle yuvarlanır', () => {
    const value = money.calculateLine(line({ quantity: '1.005', unitPrice: '0.10', taxRate: '10' }));
    assert.equal(value.totalPrice, 0.11);
    assert.equal(money.calculateLine(line({ unitPrice: '0.10', taxRate: '0' })).totalPrice, 0.1);
});
test('para birimlerinin ara, vergi ve genel toplamları karışmaz', () => {
    const result = money.calculate([line({ quantity: '2', unitPrice: '12.34' }), line({ id: 'b', currency: 'USD', unitPrice: '5.01', taxRate: '0' })]);
    assert.equal(result.totals.TRY.subtotal, 24.68);
    assert.equal(result.totals.TRY.tax, 4.94);
    assert.equal(result.totals.TRY.total, 29.62);
    assert.equal(result.totals.USD.total, 5.01);
    assert.equal(result.totals.EUR.total, 0);
});
test('geçersiz ondalık, para ve metin reddedilir', () => {
    for (const bad of [{ unitPrice: '0.001' }, { quantity: '1.0001' }, { taxRate: '101' }, { currency: 'GBP' }, { description: '<img src=x>' }]) {
        assert.throws(() => money.calculateLine(line(bad)));
    }
    assert.throws(() => money.calculate([line(), line()]));
    assert.throws(() => money.calculate(Array.from({ length: 4 }, (_, i) => line({ id: String(i) }))));
});
test('legacy talep sanal kalem gösterir, bütçeden sahte fiyat türetmez', () => {
    const old = { id: 12, urun: 'Yazıcı', tur: 'Mal', adet: 2, butce: 900 };
    const virtual = money.readItems(old);
    assert.equal(virtual[0].unitPrice, null);
    assert.equal(virtual[0].legacy, true);
    assert.equal(old.items, undefined);
});
test('ilk onay kuru ve TRY rapor karşılığı dondurulur', () => {
    const record = money.calculate([line({ currency: 'USD', unitPrice: '0.10', taxRate: '0' }), line({ id: 'b', currency: 'TRY', unitPrice: '1.00', taxRate: '0' })]);
    const fx = money.snapshotRates(record, { rates: { USD: '32.123456', EUR: '38' }, date: '2026-11-01', source: 'Operasyon Merkezi' });
    assert.equal(fx.exchangeRate.USD, 32.123456);
    assert.equal(fx.reportingTotalTRY, 4.21);
    assert.equal(money.reportingTry({ ...record, ...fx, reportingTotalTRY: 1 }), 4.21);
    assert.equal(money.snapshotRates({ ...record, ...fx }, { rates: { USD: '40', EUR: '38' } }), null);
    assert.throws(() => money.snapshotRates(record, { rates: { USD: '0', EUR: '38' }, date: '2026-11-01', source: 'Kaynak' }));
    assert.equal(money.hasValidSnapshot({ ...record, ...fx }), true);
    assert.equal(money.hasValidSnapshot({ ...record, ...fx, exchangeRate: { TRY: 1 } }), false);
    assert.equal(money.hasValidSnapshot({ ...record, ...fx, exchangeRateSource: '' }), false);
});
test('form sayıları bozuk metin ve aşırı ondalıkla hesaplanmaz', () => {
    for (const bad of ['1e2', '1.2.3', 'abc', '1,2345', '0.0001'])
        assert.throws(() => money.calculateLine(line({ quantity: bad })));
    for (const bad of ['1e2', 'x', '1.001'])
        assert.throws(() => money.calculateLine(line({ unitPrice: bad })));
});
