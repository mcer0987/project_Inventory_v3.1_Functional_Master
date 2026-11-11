// v3.6 · İP-3 — Form klavye gezinmesi (src/ui/form-keyboard-nav.js): saf nextField / barOffset (vm) ve gerçek tarayıcıda
// (Puppeteer, ebys-q0-ui deseni) Enter zinciri, son alanda gönderim, enterkeyhint, salt okunur/onay kutusu atlama, dokunmatik
// çubuk ve klavye açıkken yerleşim. Klavye headless tarayıcıda açılamadığı için visualViewport taklit edilir.
// Usage: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'src/ui/form-keyboard-nav.js'), 'utf8');

function loadPure() {
    const window = {};
    vm.runInContext(SRC, vm.createContext({ window, console }), { filename: 'form-keyboard-nav.js' });
    return window.AppModules.FormKeyboardNav;
}

test('nextField: sıradaki / önceki alan; sınırda null; listede olmayan alanda baştan ya da sondan başlar', () => {
    const F = loadPure();
    const [a, b, c] = [{ n: 'a' }, { n: 'b' }, { n: 'c' }];
    assert.equal(F.nextField([a, b, c], a, 1), b);
    assert.equal(F.nextField([a, b, c], c, 1), null);
    assert.equal(F.nextField([a, b, c], b, -1), a);
    assert.equal(F.nextField([a, b, c], a, -1), null);
    assert.equal(F.nextField([a, b, c], { n: 'x' }, 1), a);
    assert.equal(F.nextField([a, b, c], { n: 'x' }, -1), c);
    assert.equal(F.nextField([], a, 1), null);
});

test('barOffset: klavye kapalıyken 0; açıkken düzen yüksekliği − görünür alt kenar; kaydırılmış görünür alan hesaba katılır', () => {
    const F = loadPure();
    assert.equal(F.barOffset(844, { height: 844, offsetTop: 0 }), 0);
    assert.equal(F.barOffset(844, { height: 400, offsetTop: 0 }), 444);
    assert.equal(F.barOffset(844, { height: 400, offsetTop: 120 }), 324);
    assert.equal(F.barOffset(844, null), 0);
});

const executablePath = process.env.CHROME_EXECUTABLE_PATH || process.env.CHROME_PATH
    || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
        '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));

const FORM = `
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <div id="productModal" class="modal" style="display:block">
    <div class="modal-content">
      <form id="f" autocomplete="off">
        <input id="plate" type="text" readonly value="ENV-1">
        <select id="s1"><option>a</option></select>
        <label><input type="checkbox" id="cb"> demirbaş</label>
        <select id="s2"><option>b</option></select>
        <input id="name" type="text">
        <input id="brand" type="text">
        <input id="qty" type="number" inputmode="numeric">
        <input id="hiddenGroup" type="text" style="display:none">
        <input id="desc" type="text">
        <button type="submit">Kaydet</button>
      </form>
    </div>
  </div>`;

async function open(page) {
    await page.setContent(FORM);
    await page.evaluate(() => { window.submits = 0; document.getElementById('f').addEventListener('submit', e => { e.preventDefault(); window.submits++; }); });
    await page.addStyleTag({ path: path.join(ROOT, 'style.css') });   // gerçek çubuk stili (position: fixed)
    await page.addScriptTag({ content: SRC });
    await page.evaluate(() => window.AppModules.FormKeyboardNav.attach(document.getElementById('f')));
}
const active = page => page.evaluate(() => document.activeElement && document.activeElement.id);

test('tarayıcı: Enter sonraki alana geçer, yalnız son alanda gönderir; salt okunur, onay kutusu ve gizli alan atlanır; enterkeyhint', async () => {
    const browser = await puppeteer.launch({ headless: true, ...(executablePath ? { executablePath } : {}), args: ['--no-sandbox'] });
    try {
        const page = await browser.newPage();
        await open(page);
        await page.focus('#name');
        assert.deepEqual(await page.evaluate(() => ['name', 'brand', 'qty', 'desc'].map(id => document.getElementById(id).getAttribute('enterkeyhint'))),
            ['next', 'next', 'next', 'done']);
        assert.equal(await page.evaluate(() => document.getElementById('plate').hasAttribute('enterkeyhint')), false, 'salt okunur plaka zincirde değil');
        await page.keyboard.press('Enter');
        assert.equal(await active(page), 'brand');
        await page.keyboard.press('Enter');
        assert.equal(await active(page), 'qty');
        await page.keyboard.press('Enter');
        assert.equal(await active(page), 'desc', 'gizli alan atlanır');
        assert.equal(await page.evaluate(() => window.submits), 0, 'son alana kadar form gönderilmez');
        await page.keyboard.press('Enter');
        assert.equal(await page.evaluate(() => window.submits), 1, 'son alanda Enter kaydeder');
        assert.equal(await page.evaluate(() => { const b = document.querySelector('.form-kb-bar'); return !!(b && !b.hidden); }), false,
            'fare/klavye cihazında dokunmatik çubuk açılmaz');
    } finally { await browser.close(); }
});

test('tarayıcı (dokunmatik): klavye açılınca çubuk klavyenin üstüne çıkar, modal görünür alana sığar; Sonraki/Önceki/Kaydet çalışır', async () => {
    const browser = await puppeteer.launch({ headless: true, ...(executablePath ? { executablePath } : {}), args: ['--no-sandbox'] });
    try {
        const page = await browser.newPage();
        await page.emulateMediaFeatures([{ name: 'pointer', value: 'coarse' }]).catch(() => {});
        await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
        await page.evaluateOnNewDocument(() => {
            // headless tarayıcıda ekran klavyesi yok: görünür alanı taklit eden nesne (yükseklik ve olaylar testten sürülür)
            const vv = new EventTarget();
            vv.height = window.innerHeight; vv.offsetTop = 0;
            Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => vv });
            const realMatch = window.matchMedia.bind(window);
            window.matchMedia = q => (q === '(pointer: coarse)' ? { matches: true, media: q, addEventListener() {}, removeEventListener() {} } : realMatch(q));
        });
        await page.goto('about:blank');
        await open(page);
        await page.focus('#name');
        const bar = () => page.evaluate(() => { const b = document.querySelector('.form-kb-bar'); return b && { hidden: b.hidden, transform: b.style.transform,
            prev: b.querySelector('[data-kb-action="prev"]').disabled, next: b.querySelector('[data-kb-action="next"]').disabled }; });
        let state = await bar();
        assert.equal(state.hidden, false, 'odak formdayken çubuk görünür');
        await page.evaluate(() => { window.visualViewport.height = 400; window.visualViewport.dispatchEvent(new Event('resize')); });
        state = await bar();
        assert.equal(state.transform, 'translateY(-444px)', 'çubuk klavyenin hemen üstünde');
        const layout = await page.evaluate(() => ({ kb: document.getElementById('productModal').classList.contains('kb-open'),
            vvh: document.documentElement.style.getPropertyValue('--vv-h') }));
        assert.deepEqual(layout, { kb: true, vvh: '400px' });
        await page.tap('.form-kb-bar [data-kb-action="next"]');
        assert.equal(await active(page), 'brand', '"Sonraki" odağı taşır (klavye kapanmaz)');
        await page.tap('.form-kb-bar [data-kb-action="prev"]');
        assert.equal(await active(page), 'name');
        await page.tap('.form-kb-bar [data-kb-action="submit"]');
        assert.equal(await page.evaluate(() => window.submits), 1, '"Kaydet" formu gönderir');
        await page.evaluate(() => document.activeElement.blur());
        await new Promise(r => setTimeout(r, 250));
        assert.equal((await bar()).hidden, true, 'odak formdan çıkınca çubuk kapanır');
        assert.equal(await page.evaluate(() => document.getElementById('productModal').classList.contains('kb-open')), false);
    } finally { await browser.close(); }
});
