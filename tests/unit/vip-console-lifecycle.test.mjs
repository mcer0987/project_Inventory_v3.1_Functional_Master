// v3.6 · İP-4 — VIP Konsol / Heatmap yaşam döngüsü (VIP-11..15) gerçek Chrome DOM'unda doğrulanır:
//  - sekme kapalıyken sağlık döngüsü ve sayaç animasyonları (rAF) çalışmaz, açılınca başlar, kapanınca iptal edilir
//  - konsol akışı: 150 kayıt tavanı, 2000 karakter kesme, innerHTML'siz kurulum (HTML enjeksiyonu metin kalır)
//  - heatmap: innerHTML kullanılmadan DocumentFragment ile çizilir (path + title + etiket + merkez metni)
//  - CSS: aktivite paneli kapalıyken canlı nokta animasyonu duraklatılır
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import puppeteer from 'puppeteer';

async function fixture() {
    const executablePath = process.env.CHROME_EXECUTABLE_PATH || process.env.CHROME_PATH || [
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
        '/usr/bin/google-chrome', '/usr/bin/chromium',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    ].find(existsSync);
    const browser = await puppeteer.launch({ headless: true, ...(executablePath ? { executablePath } : {}), args: ['--no-sandbox'] });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    // Gerçek bir origin gerekir: modül localStorage okur (about:blank'te SecurityError atar).
    await page.setRequestInterception(true);
    page.on('request', r => r.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
    await page.goto('http://vip.test/');
    await page.addStyleTag({ content: readFileSync('admin-system-control.css', 'utf8') });
    await page.evaluate(() => {
        window.AppModules = { AdminTabs: { onAny: fn => { window.tabChange = fn; } } };
        window.getActiveUser = () => ({ name: 'Admin' });
        window.data = {
            b1: [{ id: 'a', adet: 5 }, { id: 'b', adet: 1 }], b2: [{ id: 'c', adet: 9 }], b3: [{ id: 'x' }],
            requests: [{ id: 'r', status: 'Beklemede' }], personel: [{ id: 'p' }], gorevler: [], productTypes: ['t']
        };
    });
    await page.addScriptTag({ content: readFileSync('src/utils/html.js', 'utf8') });
    await page.addScriptTag({ content: readFileSync('src/modules/admin/admin-system-control.js', 'utf8') });
    const showTab = async id => page.evaluate(id => {
        document.querySelectorAll('.admin-tab-content').forEach(el => { el.style.display = el.id === id ? 'block' : 'none'; });
        window.tabChange(id);
    }, id);
    const health = async () => page.evaluate(() => ({
        running: AppModules.VipHealth.isRunning(), countUps: AppModules.VipHealth.countUpsActive(),
        entries: AppModules.VipHealth.terminalEntries()
    }));
    return { browser, page, errors, showTab, health };
}

const html = `<!doctype html><meta charset="utf-8">
      <div class="sidebar"><div id="nav-systemControl"></div></div>
      <div class="sidebar"><div id="nav-systemControl"></div></div>
      <div class="main-content">
        <div id="dashboard-content" class="admin-tab-content" style="display:block"></div>
        <div id="systemControlTab" class="admin-tab-content" style="display:none">
          <div id="vipGrid">
            <div class="vip-terminal" id="vipLogTerminal"></div>
            <span id="vipLogCountInfo">0</span><span id="vipLogCountWarn">0</span><span id="vipLogCountError">0</span>
            <span id="vipUptime"></span><span id="vipDataSize">--</span><span id="vipDomNodes">--</span>
            ${['opsProducts', 'opsStock', 'opsExits', 'opsPending', 'opsCritical', 'opsTypes'].map(id => `<span id="${id}">0</span>`).join('')}
            <ul id="vipDebugList"></ul>
            <div id="godEyeRadarInner"></div>
            <svg id="godEyeHeatmapSVG" viewBox="-110 -110 220 220" xmlns="http://www.w3.org/2000/svg"></svg>
            <button id="godEyeHeatmapToggle"></button><span id="godEyeStatusText"></span>
          </div>
        </div>
      </div>
      <div id="userActivityPanel"><span class="uap-live-dot"></span></div>`;

test('VIP-08/12: sekme kapalıyken döngü ve sayaç yok; açılınca başlar; kapanınca interval + rAF iptal', async () => {
    const f = await fixture();
    try {
        assert.deepEqual(f.errors, []);
        assert.equal((await f.health()).running, false, 'yüklemede sağlık döngüsü kapalı');

        await f.showTab('systemControlTab');
        // Başlatma rAF + 50ms sonra gelir; paralel test yükünde sabit bekleme yetmez, koşul beklenir.
        await f.page.waitForFunction(() => AppModules.VipHealth.isRunning() && AppModules.VipHealth.countUpsActive() > 0, { timeout: 10000 });
        let h = await f.health();
        assert.equal(h.running, true, 'VIP sekmesi açılınca sağlık döngüsü çalışır');
        assert.ok(h.countUps > 0, 'sayaç animasyonları (rAF) aktif');

        await f.showTab('dashboard-content');
        h = await f.health();
        assert.equal(h.running, false, 'sekmeden çıkınca interval durur');
        assert.equal(h.countUps, 0, 'sekmeden çıkınca rAF döngüleri iptal edilir');

        // Tekrar giriş + hızlı çıkış: aynı öğede birikmiş döngü kalmaz
        await f.showTab('systemControlTab');
        await f.page.waitForFunction(() => AppModules.VipHealth.isRunning(), { timeout: 10000 });
        await f.showTab('systemControlTab');
        await new Promise(r => setTimeout(r, 300));
        assert.ok((await f.health()).countUps <= 6, 'öğe başına en fazla bir rAF döngüsü');
        await f.showTab('dashboard-content');
        assert.equal((await f.health()).countUps, 0);
        assert.deepEqual(f.errors, []);
    } finally { await f.browser.close(); }
});

test('VIP-11: konsol akışı — 150 tavanı, 2000 karakter kesme, innerHTML yok (HTML metin kalır), hata dizisi tavanı', async () => {
    const f = await fixture();
    try {
        const r = await f.page.evaluate(() => {
            for (let i = 0; i < 200; i++) console.log('satır', i);
            console.log('x'.repeat(5000));
            console.warn('<img src=x onerror="window.__xss=1">');
            const t = document.getElementById('vipLogTerminal');
            const last = t.lastElementChild;
            const longest = Math.max(...Array.from(t.querySelectorAll('.log-msg')).map(e => e.textContent.length));
            for (let i = 0; i < 80; i++) window.dispatchEvent(new ErrorEvent('error', { message: 'e' + i, filename: 'f.js', lineno: i }));
            return {
                entries: AppModules.VipHealth.terminalEntries(),
                longest,
                imgCount: t.querySelectorAll('img').length,
                lastText: last.querySelector('.log-msg').textContent,
                lastHasIconTsMsg: !!(last.querySelector('i.fas.log-icon') && last.querySelector('span.timestamp') && last.querySelector('span.log-msg')),
                lastClass: last.className, xss: window.__xss,
                runtimeErrors: AppModules.VipHealth.runtimeErrors()
            };
        });
        assert.equal(r.entries, 150, 'terminal en fazla 150 kayıt tutar');
        assert.ok(r.longest < 2100, 'uzun mesaj 2000 karakterde kesilir');
        assert.equal(r.imgCount, 0, 'HTML enjeksiyonu düğüm üretmez');
        assert.equal(r.xss, undefined);
        assert.equal(r.lastText, '<img src=x onerror="window.__xss=1">', 'mesaj metin olarak aynen görünür');
        assert.ok(r.lastHasIconTsMsg, 'ikon + zaman + mesaj yapısı korunur');
        assert.equal(r.lastClass, 'log-entry warn');
        assert.equal(r.runtimeErrors, 50, 'çalışma zamanı hataları 50 ile sınırlı');
        assert.deepEqual(f.errors, []);
    } finally { await f.browser.close(); }
});

test('VIP-14: heatmap innerHTML kullanmadan DocumentFragment ile çizilir', async () => {
    const f = await fixture();
    try {
        await f.showTab('systemControlTab');
        await f.page.waitForFunction(() => AppModules.VipHealth.isRunning(), { timeout: 10000 });
        const r = await f.page.evaluate(() => {
            let innerHtmlWrites = 0;
            const d = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
            Object.defineProperty(Element.prototype, 'innerHTML', { configurable: true, get: d.get, set(v) { if (this.id === 'godEyeHeatmapSVG') innerHtmlWrites++; return d.set.call(this, v); } });
            window.vipToggleHeatmap();
            const svg = document.getElementById('godEyeHeatmapSVG');
            const paths = Array.from(svg.querySelectorAll('path'));
            const res = {
                innerHtmlWrites,
                visible: svg.classList.contains('visible'),
                paths: paths.length,
                titles: paths.filter(p => p.querySelector('title') && p.querySelector('title').textContent.includes('kayit')).length,
                classes: paths.map(p => p.getAttribute('class')),
                labels: svg.querySelectorAll('text.hm-label').length,
                center: Array.from(svg.querySelectorAll('text.hm-center-text')).map(t => t.textContent),
                ns: svg.firstElementChild && svg.firstElementChild.namespaceURI
            };
            window.vipToggleHeatmap();
            res.hiddenAfter = !svg.classList.contains('visible');
            Object.defineProperty(Element.prototype, 'innerHTML', d);
            return res;
        });
        assert.equal(r.innerHtmlWrites, 0, 'SVG innerHTML ile yazılmaz');
        assert.equal(r.visible, true);
        assert.equal(r.paths, 5, 'beş modül → beş dilim');
        assert.equal(r.titles, 5, 'her dilimde title metni');
        assert.ok(r.classes.every(c => /^hm-slice hm-slice-(cool|warm|hot)$/.test(c)));
        assert.ok(r.labels >= 1 && r.labels <= 5);
        assert.deepEqual(r.center, ['5', 'kayit'], 'merkez toplam: b1 2 + requests 1 + personel 1 + b2 1 + gorevler 0');
        assert.equal(r.ns, 'http://www.w3.org/2000/svg');
        assert.equal(r.hiddenAfter, true);
        assert.deepEqual(f.errors, []);
    } finally { await f.browser.close(); }
});

test('VIP-15: aktivite paneli kapalıyken canlı nokta animasyonu duraklatılır', async () => {
    const f = await fixture();
    try {
        const r = await f.page.evaluate(() => {
            const dot = document.querySelector('#userActivityPanel .uap-live-dot');
            const closed = getComputedStyle(dot).animationPlayState;
            document.getElementById('userActivityPanel').classList.add('panel-open');
            const open = getComputedStyle(dot).animationPlayState;
            return { closed, open, name: getComputedStyle(dot).animationName };
        });
        assert.equal(r.name, 'uapLivePulse');
        assert.equal(r.closed, 'paused');
        assert.equal(r.open, 'running');
    } finally { await f.browser.close(); }
});
