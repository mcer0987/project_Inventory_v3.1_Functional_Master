// Isolated, real-browser purchase form smoke. No Firebase/network writes.
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
(async () => {
    const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
    const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
    try {
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.setContent(`<div id="purchaseModal"><form id="purchaseForm"><input id="purDocName"><input id="purDate"><input id="purUser"><input id="purName"><input id="purQty" type="number"><input id="purBudget"><select id="purUnit"></select><select id="purType"></select><select id="purPriority"><option>Normal</option></select><textarea id="purDesc"></textarea><div id="purItemsEditor"></div><div id="purFileInputArea"><input id="purchaseFile" type="file"></div><div id="purUploadedFilesList"></div><div id="purWorkflowSection"></div><button id="purSaveBtn"></button><button id="purRejectBtn"></button></form><div class="modal-footer"></div></div><div id="purFileList"></div><div id="purModalTitle"></div>`);
        const source = relative => fs.readFileSync(path.resolve(__dirname, '..', relative), 'utf8');
        await page.addScriptTag({ content: source('src/utils/ebys-document-types.js') });
        await page.addScriptTag({ content: source('src/ui/ebys-document-types-ui.js') });
        await page.addScriptTag({ content: source('src/utils/purchase-money.js') });
        await page.addScriptTag({ content: source('src/ui/purchase-items-ui.js') });
        await page.evaluate(() => {
            window.data = { purchaseOrders: [], units: [{ name: 'BT' }], productTypes: [{ name: 'Mal' }] };
            window.currentUser = { id: 'p1', name: 'Test Kişisi' };
            window.userAuth = { uid: 'uid1' };
            window.Ownership = { selfName: () => 'Test Kişisi', selfUid: () => 'uid1' };
            window.getActiveUser = () => window.currentUser;
            window.writeOk = async value => value;
            window.appendItem = (col, item) => { window.captured = { col, item }; return true; };
            window.showAppAlert = () => {};
            window.escapeHtml = value => String(value);
        });
        await page.addScriptTag({ content: source('src/services/purchase-servises.js') });
        await page.evaluate(() => {
            window.openNewPurchaseModal();
            document.getElementById('purName').value = 'Ofis malzemesi';
            const row = document.querySelector('[data-item-id]');
            row.querySelector('[data-field=description]').value = 'Kablo';
            row.querySelector('[data-field=category]').value = 'Mal';
            row.querySelector('[data-field=unitPrice]').value = '12.34';
            row.querySelector('[data-field=quantity]').value = '2';
            row.querySelector('[data-field=taxRate]').value = '20';
            row.querySelector('[data-field=currency]').dispatchEvent(new Event('change', { bubbles: true }));
        });
        assert.equal(await page.$eval('#purBudget', el => el.value), '29.62');
        await page.evaluate(() => {
            const currency = document.querySelector('[data-field=currency]');
            currency.value = 'USD'; currency.dispatchEvent(new Event('change', { bubbles: true }));
            const rate = document.querySelector('[data-estimate-currency=USD] input');
            rate.value = '32.5'; rate.dispatchEvent(new Event('input', { bubbles: true }));
        });
        assert.equal(await page.$eval('#purBudget', el => el.value), '962.65');
        await page.evaluate(() => {
            const budget = document.getElementById('purBudget');
            budget.value = '100'; budget.dispatchEvent(new Event('input', { bubbles: true }));
        });
        assert.equal(await page.$eval('#purItemsEditor table thead th', el => el.textContent), 'Mal / hizmet');
        assert.match(await page.$eval('[data-items-summary]', el => el.textContent), /USD: Ara 24\.68 · KDV 4\.94 · Genel 29\.62/);
        await page.evaluate(() => document.querySelector('[data-add-item]').click());
        assert.equal(await page.$$eval('[data-item-id]', rows => rows.length), 2);
        await page.evaluate(() => document.querySelectorAll('[data-remove-item]')[1].click());
        assert.equal(await page.$$eval('[data-item-id]', rows => rows.length), 1);
        await page.evaluate(async () => { await window.savePurchaseRequest(); });
        const captured = await page.evaluate(() => window.captured);
        assert.equal(captured.col, 'purchaseOrders');
        assert.equal(captured.item.urun, 'Ofis malzemesi');
        assert.equal(captured.item.items[0].currency, 'USD');
        assert.equal(captured.item.items[0].totalPrice, 29.62);
        assert.equal(captured.item.totals.USD.total, 29.62);
        assert.equal(captured.item.butce, 100);
        assert.equal(captured.item.budgetMode, 'manual');
        assert.equal(captured.item.budgetEstimateRates.USD, 32.5);
        assert.equal(captured.item.documentTypeCode, 'PURCHASE_REQUEST');
        const types = await page.evaluate(() => {
            const table = document.createElement('table');
            const body = document.createElement('tbody'); body.id = 'ebysDocumentTypesBody';
            table.append(body); document.body.append(table);
            window.renderEBYSDocumentTypes();
            return [...body.rows].map(row => row.cells[1].textContent);
        });
        assert.ok(types.includes('Satın Alma Talebi'));
        assert.ok(types.includes('Gelen Evrak'));
        await page.evaluate(() => {
            window.data.purchaseOrders = [window.captured.item];
            window.openPurchaseDetail(window.captured.item.id, 'view');
        });
        assert.equal(await page.$eval('[data-field=unitPrice]', el => el.disabled), true);
        assert.equal(await page.$eval('#purPrintBtn', el => el.style.display), '');
        const rate = await page.evaluate(async () => {
            const waiting = window.AppModules.PurchaseItemsUI.requestRates(window.captured.item);
            const overlay = document.querySelector('.modern-modal form');
            overlay.querySelector('input[type=number]').value = '32.5';
            overlay.querySelector('input[type=text]').value = 'Elle girilen kaynak';
            overlay.querySelector('button[type=submit]').click();
            return waiting;
        });
        assert.equal(rate.reportingTotalTRY, 962.65);
        assert.equal(rate.exchangeRateDate.length, 10);
        await page.evaluate(() => {
            window.print = () => { window.printedText = document.querySelector('.purchase-print-pane')?.textContent; window.dispatchEvent(new Event('afterprint')); };
            window.AppModules.PurchaseItemsUI.print({ ...window.captured.item, ...{
                exchangeRate: { TRY: 1, USD: 32.5 }, exchangeRateDate: '2026-11-01', exchangeRateSource: 'Kaynak', reportingTotalTRY: 962.65
            } });
        });
        assert.match(await page.evaluate(() => window.printedText), /Kablo.*29\.62/);
        await page.evaluate(() => {
            window.data.purchaseOrders.push({ id: 1, urun: 'Eski', adet: 3, butce: 200 });
            window.openPurchaseDetail(1, 'view');
        });
        assert.match(await page.$eval('#purItemsEditor', el => el.textContent), /Eski tek ürünlü kayıt/);
        assert.match(await page.$eval('[data-items-summary]', el => el.textContent), /Eski kayıt ödeneği: 200 TRY/);
        assert.equal(await page.$eval('[data-field=unitPrice]', el => el.disabled), true);
        await page.evaluate(() => {
            window.data.purchaseOrders.push({ ...window.captured.item, id: 2, workflow: { started: false, steps: [] },
                exchangeRate: { TRY: 1, USD: 32.5 }, exchangeRateDate: '2026-11-01', exchangeRateSource: 'Kaynak' });
            window.openPurchaseDetail(2, 'edit');
        });
        assert.equal(await page.$eval('[data-field=unitPrice]', el => el.disabled), true);
        const mixedBudget = await page.evaluate(() => {
            const ui = window.AppModules.PurchaseItemsUI;
            window.openNewPurchaseModal();
            const set = (row, values) => {
                for (const [key, value] of Object.entries(values)) row.querySelector(`[data-field=${key}]`).value = String(value);
            };
            set(document.querySelector('[data-item-id]'), { description: 'ITEM', category: 'Demirbaş', quantity: 5, unitPrice: 150, currency: 'TRY', taxRate: 0 });
            document.querySelector('[data-add-item]').click();
            set(document.querySelectorAll('[data-item-id]')[1], { description: 'ITEM 2', category: 'Sarf', quantity: 40, unitPrice: 8, currency: 'USD', taxRate: 0 });
            document.querySelector('[data-add-item]').click();
            set(document.querySelectorAll('[data-item-id]')[2], { description: 'ITEM 3', category: 'Hizmet', quantity: 1, unitPrice: 250, currency: 'EUR', taxRate: 0 });
            for (const [currency, rate] of [['USD', '35'], ['EUR', '40']]) {
                const field = document.querySelector(`[data-estimate-currency=${currency}] input`);
                field.value = rate; field.dispatchEvent(new Event('input', { bubbles: true }));
            }
            return { amount: document.getElementById('purBudget').value, rates: ui.readBudget().estimateRates };
        });
        assert.equal(mixedBudget.amount, '21950.00');
        assert.equal(mixedBudget.rates.USD, 35);
        assert.equal(mixedBudget.rates.EUR, 40);
        assert.deepEqual(errors, []);
        console.log('Aşama 3 tarayıcı: kalemler, otomatik/manüel ödenek, üç para birimi, belge türü, kayıt, kur, yazdırma ve legacy detay; pageerror 0');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
