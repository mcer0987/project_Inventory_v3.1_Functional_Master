// [WHY]: KJ-6 — gerçek DOM, CSP ve dataset entity çözümlemesini veri tabanına bağlanmadan doğrula.
// [HOW]: Üretim AST düğümlerini Chromium'da yükle; dış servis çağrılarını gözlemleyen taklitler kullan.
const fs = require('fs');
const assert = require('node:assert/strict');
const { parse } = require('acorn');

function select(file, names) {
    const source = fs.readFileSync(file, 'utf8');
    return parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body.flatMap(node => {
        const n = node.type === 'ExportNamedDeclaration' ? node.declaration : node;
        const name = n.type === 'FunctionDeclaration' ? n.id.name
            : n.type === 'VariableDeclaration' ? n.declarations[0].id.name
                : n.type === 'ExpressionStatement' && n.expression.right?.type === 'FunctionExpression'
                    ? n.expression.left?.property?.name : null;
        return names.includes(name) ? [source.slice(n.start, n.end)] : [];
    }).join('\n');
}

(async () => {
    const { default: puppeteer } = await import('puppeteer');
    const executablePath = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
    const browser = await puppeteer.launch({ headless: true, executablePath, args: ['--no-sandbox', '--disable-gpu'] });
    try {
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.setContent(`<meta http-equiv="Content-Security-Policy" content="script-src 'none'">
            <table><tbody id="adminPendingRequestsBody"></tbody></table>
            <table><tbody id="productTypeTableBody"></tbody></table>
            <table><tbody id="adminDefProductTypeTableBody"></tbody></table>
            <table><tbody id="locationTableBody"></tbody></table>
            <div id="loc_personResults"></div><div id="loc_selectedPersons"></div>
            <table id="tableB1"><tbody></tbody></table><div id="cardViewB1"></div>
            <div id="floatingActionBar"><div id="fabButtons"></div></div>
            <div id="customAlertOverlay"><span id="alertTitle"></span><span id="alertMessage"></span>
                <button id="alertConfirmBtn"><i></i></button><button id="alertCancelBtn"><i></i></button></div>
            <div id="bsButtons"></div><div id="bsProductName"></div>`);
        await page.evaluate(fs.readFileSync('src/utils/html.js', 'utf8'));
        await page.evaluate(`var _sortColumn = 'lastUpdate', _isAscending = false, _currentPage = 1; const PAGE_SIZE = 25;
            ${select('src/ui/table-engine.js', ['getProcessedData', '_buildQtyDisplay', '_buildRowInnerHtml', '_buildRowHtml',
            '_renderCountLockNotice', '_bindTableActions', '_setupCardViewSelection', 'renderMobileCards', 'renderCardSearchResults', 'toggleCardGroup'])}
            ${select('src/ui/ui-components.js', ['_dom', '_bindProductActions', 'UIComponents'])}
            ${select('src/modules/admin/admin-dashboard.js', ['renderAdminRequestTable', 'renderProductTypesTable',
                'renderLocationsTable', 'searchPersonnelForLocation', '_renderLocationPersons', 'customConfirmAlert'])}
            window.UIComponents = UIComponents;
            window.renderMobileCards = renderMobileCards; window.renderCardSearchResults = renderCardSearchResults;
            window._toggleCardGroup = toggleCardGroup;`);
        const result = await page.evaluate(async () => {
            const calls = [];
            const hostile = `id"'><img src=x onerror="window.pwned=1">&quot;雪`;
            for (const name of ['confirmRequest', 'rejectRequest', 'deleteRequest', 'editProductType', 'deleteProductType',
                'openLocationModal', 'deleteLocation', 'addPersonToLocation', 'removePersonFromLocation',
                'openProductModal', 'cloneProduct', 'deleteItem', 'toggleWatch', 'updateStock',
                'openTransferModal', 'clearRowSelection', 'closeMobileBottomSheet']) window[name] = (...args) => calls.push([name, ...args]);
            window.isDbAdmin = () => true;
            window.data = {
                requests: [{ id: hostile }], locations: [{ id: hostile, persons: [] }],
                b1: [{ id: hostile, ürün: hostile, tür: 'Tür', adet: 1 }], personel: [{ name: hostile, unit: hostile }]
            };
            window.getActiveProductTypes = () => [{ id: hostile, name: hostile, isDemirbas: true }];
            const click = selector => document.querySelector(selector).click();
            const confirm = window.customConfirmAlert('Başlık', hostile);
            click('#alertConfirmBtn i');
            const confirmed = await confirm;
            const cancel = window.customConfirmAlert('Başlık', hostile);
            click('#alertCancelBtn i');
            const cancelled = await cancel;
            window.renderAdminRequestTable(); window.renderAdminRequestTable();
            click('[data-action="confirmRequest"] i'); click('[data-action="rejectRequest"] i');
            window.data.requests[0].durum = 'approved'; window.renderAdminRequestTable();
            click('[data-action="deleteRequest"] i');
            window.renderProductTypesTable();
            click('#productTypeTableBody [data-action="editProductType"] i');
            click('#adminDefProductTypeTableBody [data-action="deleteProductType"] i');
            window.renderLocationsTable(); click('[data-action="openLocationModal"] i'); click('[data-action="deleteLocation"] i');
            window.searchPersonnelForLocation('id'); click('[data-action="addLocationPerson"] strong');
            window.locationSelectedPersons = [{ name: hostile }];
            _renderLocationPersons(); click('[data-action="removeLocationPerson"]');
            window._selectedRows = new Set();
            window.updateFloatingBar = () => calls.push(['selection']);
            window.renderMobileCards('b1');
            click('[data-action="toggleCardGroup"] i');
            const expanded = document.querySelector('.type-group-body').classList.contains('expanded');
            click('.card-checkbox');
            const noCheckboxSelection = calls.filter(c => c[0] === 'selection').length === 0;
            window.renderCardSearchResults('b1', window.data.b1);
            window.renderCardSearchResults('b1', window.data.b1);
            click('.pci-name');
            const selectionCalls = calls.filter(c => c[0] === 'selection').length;
            UIComponents.showMobileBottomSheet({ depo: 'b1', id: hostile, name: hostile });
            click('#bsButtons [data-action="cloneProduct"] i');
            const row = document.createElement('tr');
            row.innerHTML = '<td><span data-action="mobileTooltip"><i></i></span></td>';
            row.className = 'selectable-row'; document.querySelector('#tableB1 tbody').append(row);
            UIComponents.setupRowSelection(document.getElementById('tableB1'));
            click('#tableB1 [data-action="mobileTooltip"] i');
            return {
                calls, hostile, expanded, noCheckboxSelection, selectionCalls, confirmed, cancelled,
                injected: !!document.querySelector('img,[onerror],[onclick],[onmouseenter],[onmousemove],[onmouseleave]'),
                pwned: !!window.pwned, tooltipSelected: row.classList.contains('selected-row')
            };
        });
        assert.equal(result.injected, false); assert.equal(result.pwned, false);
        assert.equal(result.expanded, true); assert.equal(result.noCheckboxSelection, true);
        assert.equal(result.confirmed, true); assert.equal(result.cancelled, false);
        assert.equal(result.selectionCalls, 1); assert.equal(result.tooltipSelected, false);
        for (const name of ['confirmRequest', 'rejectRequest', 'deleteRequest', 'deleteProductType', 'openLocationModal', 'deleteLocation', 'removePersonFromLocation']) {
            assert.deepEqual(result.calls.filter(c => c[0] === name), [[name, result.hostile]]);
        }
        assert.deepEqual(result.calls.find(c => c[0] === 'editProductType'), ['editProductType', result.hostile, result.hostile, true]);
        assert.deepEqual(result.calls.find(c => c[0] === 'addPersonToLocation'), ['addPersonToLocation', { name: result.hostile, unit: result.hostile }]);
        assert.deepEqual(result.calls.slice(-2), [['cloneProduct', 'b1', result.hostile], ['closeMobileBottomSheet']]);
        assert.deepEqual(errors, []);
        console.log('KJ-6 Chromium: PASS — CSP inline kapalı; dataset round-trip, ikon tıklaması, modal argümanları, checkbox, tooltip ve tekrar çizim; pageErrors=0.');
    } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
