import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parse } from 'acorn';

// Gerçek dashboard fonksiyonlarını AST ile seç; yalnız DOM/Firebase sınırlarını taklit et.
const source = fs.readFileSync(new URL('../../src/modules/admin/admin-dashboard.js', import.meta.url), 'utf8');
const names = new Set(['saveProductTypeUpdate', 'syncProductTypesToProducts']);
const selected = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body.filter(n =>
    (n.type === 'FunctionDeclaration' && n.id.name === '_planProductTypeRename') ||
    (n.type === 'ExpressionStatement' && n.expression.type === 'AssignmentExpression' &&
        names.has(n.expression.left.property?.name)));
assert.equal(selected.length, 3);
const code = selected.map(n => source.slice(n.start, n.end)).join('\n');

function setup(b1 = [], b2 = []) {
    const calls = [], alerts = [];
    const inputs = { editTypeId: { value: 't1' }, editTypeName: { value: 'Yeni' }, editIsDemirbas: { checked: false } };
    const window = {
        data: { b1, b2 }, cachedEditingTypeName: 'Eski',
        FirebaseModules: { updateDoc: async () => { calls.push('definition'); } },
        saveData: async (depo, items) => { calls.push({ depo, items }); return true; },
        forceProductTypeSync() {}, closeProductTypeModal() {},
    };
    const ctx = vm.createContext({ window, console: { error() {} },
        document: { getElementById: id => inputs[id] }, _productTypeDoc: id => id,
        showAppAlert: (message, type) => alerts.push({ message, type }) });
    vm.runInContext(fs.readFileSync(new URL('../../src/utils/schema.js', import.meta.url), 'utf8'), ctx);
    vm.runInContext(code, ctx);
    return { window, calls, alerts, ctx };
}
const record = (extra = {}) => ({ id: 'p1', ürün: 'Kablo', tür: 'Eski', sütun: '', raf: '', marka: '',
    adet: 1, durumu: '', açıklama: '', isDemirbas: false, lastUpdate: 1, ...extra });

test('kanonik tür güncellenir; başarı yalnız bütün yazmalar bitince bildirilir', async () => {
    const r = setup([record()]);
    await r.window.saveProductTypeUpdate();
    assert.equal(r.calls[0], 'definition');
    assert.equal(r.calls[1].items[0].tür, 'Yeni');
    assert.deepEqual(r.alerts.map(a => a.type), ['success']);
});

for (const alias of ['type', 'prodType']) {
    test(`yalnız ${alias} taşıyan kayda tür eklenir, alias korunur`, async () => {
        const old = record({ [alias]: 'Eski' }); delete old.tür;
        const r = setup([old]);
        await r.window.saveProductTypeUpdate();
        assert.equal(r.calls[1].items[0].tür, 'Yeni');
        assert.equal(r.calls[1].items[0][alias], 'Eski');
        assert.equal(old.tür, undefined, 'önizleme mevcut veriyi değiştirmez');
    });
}

test('gölgelenen alias eşleşmesi kanonik türü değiştirmez; type prodType öncesindedir', async () => {
    const r = setup([record({ tür: 'Başka', type: 'Eski' }), record({ tür: '', type: 'Başka', prodType: 'Eski' })]);
    await r.window.saveProductTypeUpdate();
    assert.deepEqual(r.calls, ['definition']);
});

test('kanonik tür eşleşirse çelişen eski alias aynen korunur', async () => {
    const r = setup([record({ type: 'Başka', prodType: 'DahaEski' })]);
    await r.window.saveProductTypeUpdate();
    assert.equal(r.calls[1].items[0].tür, 'Yeni');
    assert.equal(r.calls[1].items[0].type, 'Başka');
    assert.equal(r.calls[1].items[0].prodType, 'DahaEski');
});

test('B2 ön kontrol hatası B1 ve tür tanımı dahil bütün yazmaları engeller', async () => {
    const r = setup([record()], [record({ status: '' })]);
    const original = r.window.Schema.validateB2;
    r.window.Schema.validateB2 = (item, opts) => item.tür === 'Yeni' ? ['test şema ihlali'] : original(item, opts);
    await r.window.saveProductTypeUpdate();
    assert.equal(r.calls.length, 0);
    assert.deepEqual(r.alerts.map(a => a.type), ['error']);
});

for (const throws of [false, true]) {
    test(`depo yazması ${throws ? 'hata fırlatırsa' : 'false dönerse'} kısmi sonuç bildirilir, başarı yok`, async () => {
        const r = setup([record()], [record({ status: '' })]);
        r.window.saveData = async depo => {
            r.calls.push(depo);
            if (depo === 'b2') { if (throws) throw new Error('write failed'); return false; }
            return true;
        };
        await r.window.saveProductTypeUpdate();
        assert.deepEqual(r.calls, ['definition', 'b1', 'b2']);
        assert.deepEqual(r.alerts.map(a => a.type), ['warning']);
        assert.match(r.alerts[0].message, /Tamamlanan depolar: b1/);
        assert.match(r.alerts[0].message, /Tamamlanamayan depolar: b2/);
    });
}

test('tür tanımı yazılamazsa ürün yazmaları başlamaz', async () => {
    const r = setup([record()]);
    r.window.FirebaseModules.updateDoc = async () => { throw new Error('denied'); };
    await r.window.saveProductTypeUpdate();
    assert.equal(r.calls.length, 0);
    assert.deepEqual(r.alerts.map(a => a.type), ['error']);
});
