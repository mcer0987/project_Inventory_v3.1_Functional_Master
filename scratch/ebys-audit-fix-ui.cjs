// Independent, isolated browser probes; no live SDK, Auth or network writes.
const puppeteer = require('puppeteer');
const fs = require('fs');
const assert = require('assert/strict');
(async () => {
    const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-sandbox'] });
    try {
        const page = await browser.newPage();
        const errors = []; page.on('pageerror', e => errors.push(e.message));
        await page.setContent(`<div id="purchaseModal"><form id="purchaseForm"><input id="purDocName"><input id="purDate"><input id="purUser"><input id="purName"><input id="purQty"><input id="purBudget"><select id="purUnit"></select><select id="purType"></select><select id="purPriority"><option>Normal</option></select><textarea id="purDesc"></textarea><div id="purItemsEditor"></div><div id="purFileInputArea"><input id="purchaseFile" type="file"></div><div id="purUploadedFilesList"></div><div id="purWorkflowSection"></div><button id="purSaveBtn"></button><button id="purRejectBtn"></button></form><div class="modal-footer"></div></div><div id="purFileList"></div><div id="purModalTitle"></div>`);
        for (const file of ['src/utils/ebys-document-types.js', 'src/utils/purchase-money.js', 'src/ui/purchase-items-ui.js', 'src/services/purchase-servises.js'])
            await page.addScriptTag({ content: fs.readFileSync(file, 'utf8') });
        await page.evaluate(() => {
            window.data = { purchaseOrders: [{ id: 'legacy', urun: 'Eski talep', adet: 3, butce: 200, aciklama: 'Eski açıklama', createdByUid: 'owner', durum: 'Taslak', workflow: { started: false, steps: [] } }], units: [], productTypes: [] };
            window.currentUser = { id: 'owner', name: 'owner' }; window.userAuth = { uid: 'owner' };
            window.alerts = []; window.writeCount = 0;
            window.showAppAlert = message => window.alerts.push(message);
            window.escapeHtml = v => String(v);
            window.writeOk = async v => v;
            window.upsertItem = () => { window.writeCount++; return true; };
            window.openPurchaseDetail('legacy', 'edit');
            document.getElementById('purDesc').value = 'Yalnız açıklama düzeltildi';
        });
        await page.evaluate(() => window.updatePurchaseRequest(null, 'legacy'));
        const legacy = await page.evaluate(() => ({ writes: window.writeCount, alerts: window.alerts, record: window.data.purchaseOrders[0] }));
        assert.equal(legacy.writes, 1);
        assert.equal(legacy.record.aciklama, 'Yalnız açıklama düzeltildi');
        assert.equal(legacy.record.items, undefined);
        console.log('U1 fixed: legacy description saved without creating financial lines.');
        const printed = await page.evaluate(() => {
            const line = { id: 'l', description: 'Test', category: 'Mal', quantity: 1, unit: 'Adet', unitPrice: 10, currency: 'TRY', taxRate: 0, totalPrice: 999 };
            window.print = () => {
                window.printResult = { row: [...document.querySelectorAll('.purchase-print-pane td')].map(x => x.textContent), summary: [...document.querySelectorAll('.purchase-print-pane p')].map(x => x.textContent) };
                window.dispatchEvent(new Event('afterprint'));
            };
            window.AppModules.PurchaseItemsUI.print({ id: 'print', items: [line] });
            return window.printResult;
        });
        assert.equal(printed.row.at(-1), '10.00');
        assert.ok(printed.summary.some(p => /Genel 10\.00/.test(p)));
        console.log('U2 fixed: line and grand total use the same calculated cents.');
        const invalid = await page.evaluate(() => {
            const ui = window.AppModules.PurchaseItemsUI;
            ui.open();
            const row = document.querySelector('[data-item-id]');
            const field = row.querySelector('[data-field=quantity]');
            field.value = '1e2'; field.dispatchEvent(new Event('input', { bubbles: true }));
            const scientific = !field.checkValidity();
            field.value = '1.0001'; field.dispatchEvent(new Event('input', { bubbles: true }));
            const precision = !field.checkValidity();
            return { scientific, precision };
        });
        assert.deepEqual(invalid, { scientific: true, precision: true });
        console.log('U3 fixed: malformed and four-decimal quantity are invalid in form.');
        assert.deepEqual(errors, []);
        console.log('Audit fix browser: 3 acceptance probes, pageerror=0.');
    } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
