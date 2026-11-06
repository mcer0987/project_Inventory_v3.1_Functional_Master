// Faz 6 · Zimmet ve İade Rehberi — izole sayfada açılış/sekme/klavye/kapanış ve iade simülasyonu testi
// (admin-kpi.cjs'teki "izole sayfa" tekniğiyle; tam index.html'in oturum/tab altyapısını kurmaya gerek yok).
const fs = require('fs'), path = require('path'), assert = require('assert'), puppeteer = require('puppeteer');
const OUT = process.argv[2];

(async () => {
    const browser = await puppeteer.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--no-sandbox'] });
    const report = [];
    const ok = (name) => { report.push(`✔ ${name}`); };
    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1366, height: 900 });
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
        const body = `<!doctype html><html><head><meta charset="utf-8">
            <link rel="stylesheet" href="http://127.0.0.1/src/ui/zim-showcase-modal.css"></head>
            <body style="padding:24px">
                <button type="button" class="b3-help-trigger b3-guide-trigger" data-zim-showcase="cikis">
                    <i class="fas fa-book-open" aria-hidden="true"></i><span>Zimmet ve İade Rehberi</span>
                </button>
            </body></html>`;
        await page.setRequestInterception(true);
        page.on('request', r => {
            const u = new URL(r.url());
            if (u.pathname === '/page') return r.respond({ status: 200, contentType: 'text/html', body });
            const f = decodeURIComponent(u.pathname.slice(1));
            if (fs.existsSync(f) && /\.(css|js)$/.test(f)) return r.respond({ status: 200, contentType: f.endsWith('.css') ? 'text/css' : 'text/javascript', body: fs.readFileSync(f) });
            return r.respond({ status: 200, contentType: 'text/plain', body: '' });
        });
        await page.goto('http://127.0.0.1/page');
        await page.addScriptTag({ type: 'module', url: 'http://127.0.0.1/src/ui/zim-showcase-modal.js' });
        await page.waitForFunction(() => window.AppModules && window.AppModules.ZimShowcase);

        // Açılış
        await page.click('[data-zim-showcase]');
        await page.waitForSelector('#zimShowcaseModal.is-open');
        assert.equal(await page.$eval('#zimShowcaseModal .zim-sc-tab.is-active small', n => n.textContent), 'Kim, neyi çıkarabilir');
        await page.screenshot({ path: path.join(OUT, 'zim-guide-cikis.png') });
        ok('Tetikleyici düğme rehberi açıyor; ilk sekme "Envanter Çıkışı"');

        // Rol seçimi: Personel → demirbaş çıkışı kapalı, "Envanter Talep Et" açık görünmeli
        await page.evaluate(() => [...document.querySelectorAll('.zim-sc-role')].find(b => b.textContent.includes('Personel')).click());
        const checklist = await page.$$eval('.zim-sc-checklist li', ls => ls.map(l => [l.textContent.trim(), l.className]));
        assert.ok(checklist.some(([t, c]) => /Demirbaş çıkışı/.test(t) && c.includes('is-no')));
        assert.ok(checklist.some(([t, c]) => /Envanter Talep Et/.test(t) && c.includes('is-yes')));
        ok('Rol kartı: "Personel" seçilince demirbaş çıkışı kapalı, talep hakkı açık görünüyor');

        // Ok tuşlarıyla sekme gezintisi + içerik değişimi
        await page.focus('#zimScTab-cikis');
        await page.keyboard.press('ArrowDown');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'zimScTab-talep');
        await page.waitForSelector('#zimShowcasePanel .zim-sc-head');
        assert.match(await page.$eval('#zimShowcasePanel .zim-sc-title', n => n.textContent), /Personel ister, yönetici onaylar/);
        ok('Ok tuşu sekmeler arasında gezdirir ve odağı taşır; panel içeriği değişir');

        // İade sekmesi: canlı karar simülasyonu
        await page.click('#zimScTab-iade');
        await page.waitForSelector('.zim-sc-sim-log');
        let outcome = await page.$eval('.zim-sc-sim-log', n => n.textContent);
        assert.match(outcome, /sağlam olarak eklenir, stok \+1 olur/);
        await page.click('.zim-sc-options label:nth-child(2)');  // "Hayır, teslim almadan kapat"
        outcome = await page.$eval('.zim-sc-sim-log', n => n.textContent);
        assert.match(outcome, /açıklama zorunludur; boşken onay verilmez/);
        await page.type('.zim-sc-branch:not([hidden]) textarea', 'Personel ayrıldı.');
        outcome = await page.$eval('.zim-sc-sim-log', n => n.textContent);
        assert.match(outcome, /Kapanış açıklaması tutanağa işlenir: "Personel ayrıldı\./);
        await page.screenshot({ path: path.join(OUT, 'zim-guide-iade.png') });
        ok('İade sekmesi: "Teslim aldım / almadım" seçimine göre sonuç metni gerçek karar mantığıyla canlı güncelleniyor');

        // Koyu tema
        await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
        await page.screenshot({ path: path.join(OUT, 'zim-guide-iade-dark.png') });
        ok('Koyu tema render alındı');

        // Esc ile kapanma + odağın tetikleyiciye dönmesi
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => document.getElementById('zimShowcaseModal').hidden);
        assert.equal(await page.evaluate(() => document.activeElement.hasAttribute('data-zim-showcase')), true);
        ok('Esc rehberi kapatır; odak tetikleyici düğmeye döner');

        if (errors.length) throw new Error('Konsol/sayfa hatası: ' + errors.join(' | '));
    } finally { await browser.close(); }
    console.log(report.join('\n'));
})().catch(e => { console.error(e); process.exit(1); });
