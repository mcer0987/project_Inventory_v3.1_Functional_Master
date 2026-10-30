import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parse } from 'acorn';

const read = path => fs.readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
function functions(path, names) {
    const source = read(path);
    return parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body
        .filter(n => n.type === 'FunctionDeclaration' && names.includes(n.id.name))
        .map(n => source.slice(n.start, n.end)).join('\n');
}
function setup() {
    const calls = [];
    const window = {};
    for (const name of ['updateStock', 'openProductModal', 'cloneProduct', 'openTransferModal',
        'toggleWatch', 'deleteItem', '_bulkDeleteSelected', 'showAppAlert', 'clearRowSelection', 'closeMobileBottomSheet']) {
        window[name] = (...args) => calls.push([name, ...args]);
    }
    const ctx = vm.createContext({ window });
    vm.runInContext(read('src/utils/html.js'), ctx);
    vm.runInContext(functions('src/ui/ui-components.js', ['_bindProductActions']), ctx);
    const listeners = [];
    const container = { addEventListener: (type, fn) => listeners.push(fn), contains: () => true };
    const bind = mobile => ctx._bindProductActions(container, mobile);
    const click = (action, data = {}) => {
        const el = { dataset: { action, depo: 'b2', id: 'id\"<&quot;雪', ...data } };
        // Simulate a click on the icon inside the action button.
        const event = { target: { closest: selector => selector === '[data-action]' ? el : null } };
        for (const fn of listeners) fn(event);
    };
    return { calls, ctx, container, listeners, bind, click };
}

for (const mobile of [false, true]) test(`ürün eylemleri argüman ve kapatma sırasını korur (mobil=${mobile})`, () => {
    const r = setup(); r.bind(mobile);
    const id = 'id\"<&quot;雪';
    const cases = [
        ['increaseStock', ['updateStock', 'b2', id, 1], false],
        ['decreaseStock', ['updateStock', 'b2', id, -1], false],
        ['editProduct', ['openProductModal', 'edit', id, 'b2'], true],
        ['cloneProduct', ['cloneProduct', 'b2', id], true],
        ['transferProduct', ['openTransferModal', 'b2', id], true],
        ['toggleWatch', ['toggleWatch', 'b2', id], false],
        ['deleteItem', ['deleteItem', 'b2', id], true],
    ];
    for (const [action, expected, clear] of cases) {
        r.calls.length = 0; r.click(action);
        assert.deepEqual(r.calls, [expected, ...(mobile ? [['closeMobileBottomSheet']] : clear ? [['clearRowSelection']] : [])]);
    }
});

test('yeniden bağlama çift çağrı oluşturmaz ve güncel eylem tablosunu kullanır', () => {
    const r = setup();
    r.bind(false); r.bind(false); r.bind(true);
    assert.equal(r.listeners.length, 1);
    r.click('toggleWatch');
    assert.equal(r.calls.filter(c => c[0] === 'toggleWatch').length, 1);
    assert.equal(r.calls.at(-1)[0], 'closeMobileBottomSheet');
});

test('toplu silmede özel karakterli ID dizisi korunur; bilinmeyen eylem işlem yapmaz', () => {
    const r = setup(); r.bind(false);
    const ids = ['a"<>&quot;', '雪', '2'];
    r.click('bulkDelete', { ids: JSON.stringify(ids) });
    assert.deepEqual(JSON.parse(JSON.stringify(r.calls)), [['_bulkDeleteSelected', 'b2', ids]]);
    r.calls.length = 0; r.click('unknown');
    assert.deepEqual(r.calls, []);
});

test('tablo hover delegasyonu hücreler arasında yeniden açılmaz ve tek kez bağlanır', () => {
    const r = setup();
    vm.runInContext(functions('src/ui/table-engine.js', ['_bindTableActions']), r.ctx);
    const listeners = {};
    const body = { contains: () => true, addEventListener(type, fn) { (listeners[type] ||= []).push(fn); } };
    for (const name of ['showRowTooltip', 'moveRowTooltip', 'hideRowTooltip', 'showMobileTooltip']) {
        r.ctx.window[name] = (...args) => r.calls.push([name, ...args]);
    }
    r.ctx._bindTableActions(body); r.ctx._bindTableActions(body);
    for (const fns of Object.values(listeners)) assert.equal(fns.length, 1);
    const child = {};
    const row = { dataset: { tip: 'Tarih <&quot;' }, contains: el => el === child };
    const event = relatedTarget => ({ target: { closest: () => row }, relatedTarget });
    listeners.mouseover[0](event(null));
    listeners.mouseover[0](event(child));
    listeners.mouseout[0](event(child));
    listeners.mousemove[0](event(child));
    listeners.mouseout[0](event(null));
    assert.deepEqual(r.calls.map(c => c[0]), ['showRowTooltip', 'moveRowTooltip', 'hideRowTooltip']);
    assert.equal(r.calls[0][2], row.dataset.tip);
});

test('kart araması seçim dinleyicisini çoğaltmaz; checkbox satır seçimini tetiklemez', () => {
    const r = setup();
    vm.runInContext(functions('src/ui/table-engine.js', ['_setupCardViewSelection']), r.ctx);
    r.ctx._setupCardViewSelection(r.container); r.ctx._setupCardViewSelection(r.container);
    assert.equal(r.listeners.length, 2, 'bir delegation ve bir seçim dinleyicisi');
    r.listeners[1]({ target: { type: 'checkbox', closest() { throw new Error('satır seçilmemeli'); } } });
});
