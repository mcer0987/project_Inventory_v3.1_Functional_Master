// Tam admin HTML'si ve yerel stiller; oturum/veritabanı kodları çalıştırılmaz.
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const puppeteer = require('puppeteer'), acorn = require('acorn'), walk = require('acorn-walk');
(async () => {
    const browser = await puppeteer.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--no-sandbox'] });
    try {
        const page = await browser.newPage(); await page.setViewport({ width: 1860, height: 1000 });
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        const html = fs.readFileSync('admin.html', 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
        await page.setRequestInterception(true);
        page.on('request', request => {
            const url = new URL(request.url());
            if (url.hostname !== '127.0.0.1') return request.respond({ status: 200, body: '' });
            if (url.pathname === '/admin-layout-test') return request.respond({ status: 200, contentType: 'text/html', body: html });
            const relative = decodeURIComponent(url.pathname).replace(/^\//, '');
            const file = path.resolve(relative);
            if (!file.startsWith(process.cwd() + path.sep) || !fs.existsSync(file)) return request.respond({ status: 404, body: '' });
            return request.respond({ status: 200, contentType: file.endsWith('.css') ? 'text/css' : file.endsWith('.woff2') ? 'font/woff2' : 'application/octet-stream', body: fs.readFileSync(file) });
        });
        await page.goto('http://127.0.0.1/admin-layout-test', { waitUntil: 'networkidle0' });
        await page.evaluate(() => {
            document.getElementById('admin-premium-loader')?.remove(); document.getElementById('adminLockModal')?.remove();
            document.querySelectorAll('.admin-content-hidden').forEach(n => { n.classList.remove('admin-content-hidden'); n.classList.add('admin-content-visible'); });
            window.AppModules = { AdminTabs: { dispatch() {} } };
        });
        const source = fs.readFileSync('src/modules/admin/admin-dashboard.js', 'utf8');
        let routing;
        walk.simple(acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' }), { AssignmentExpression(n) {
            if (n.left.object?.name === 'window' && n.left.property?.name === 'showAdminTab') routing = source.slice(n.start, n.end) + ';';
        } });
        assert.ok(routing); await page.addScriptTag({ content: routing });
        const structure = await page.evaluate(() => ({
            tabs: [...document.querySelectorAll('.admin-tab-content')].map(n => ({ id: n.id, inMain: n.parentElement?.classList.contains('main-content') })),
            registryCount: document.querySelectorAll('#ebysDocumentRegistry').length,
            registryParent: document.getElementById('ebysDocumentRegistry')?.parentElement.id,
            stylesheet: [...document.styleSheets].some(s => s.href?.endsWith('/src/ui/ebys-documents.css')),
        }));
        assert.ok(structure.tabs.length >= 9); assert.ok(structure.tabs.every(t => t.inMain), JSON.stringify(structure.tabs));
        assert.equal(structure.registryCount, 1); assert.equal(structure.registryParent, 'purchaseTab'); assert.equal(structure.stylesheet, true);
        for (const id of ['purchaseTab', 'definitionsTab', 'todoTab', 'inventoryManagementTab', 'shelfMatrixTab', 'systemControlTab']) {
            await page.evaluate(id => window.showAdminTab(id), id);
            const layout = await page.evaluate(id => {
                const tab = document.getElementById(id), main = document.querySelector('.main-content');
                const a = tab.getBoundingClientRect(), b = main.getBoundingClientRect();
                return { active: [...document.querySelectorAll('.admin-tab-content')].filter(n => getComputedStyle(n).display !== 'none').map(n => n.id), left: a.left, mainLeft: b.left, right: a.right, mainRight: b.right, width: a.width };
            }, id);
            assert.deepEqual(layout.active, [id]); assert.ok(layout.width > 500); assert.ok(layout.left >= layout.mainLeft && layout.right <= layout.mainRight + 1, JSON.stringify({ id, layout }));
        }
        await page.evaluate(() => window.showAdminTab('purchaseTab'));
        await page.waitForFunction(() => Number(getComputedStyle(document.getElementById('purchaseTab')).opacity) >= .99);
        assert.equal(await page.$eval('#ebysDocumentRegistry', n => n.getBoundingClientRect().height > 100), true);
        await page.screenshot({ path: 'scratch/admin-layout-restored.png', fullPage: false });
        assert.deepEqual(errors, []);
        console.log(`Tam admin yerleşimi geçti: ${structure.tabs.length} sekme ana içerikte; 6 sekme geçişi ve Evrak Kayıt Defteri doğrulandı. pageerror=0`);
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
