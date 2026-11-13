// v3.7 · İP-7 — talep silme ID tabanlı (Anayasa §5: window.data doğrudan değiştirilmez).
// [WHY]: deleteRequest ve deleteSelectedRequests talep listesinin süzülmüş kopyasını saveData('requests', kalanlar) ile
//        yazıyordu. saveData yazmadan ÖNCE window.data.requests'i bu kopyayla değiştirir; yazma reddedilirse talep ekranda
//        silinmiş görünür ve fark hesabı ayna ile yerel liste arasındaki başka farkları da yazabilir.
// [HOW]: Gerçek Chrome'da request-actions.js yüklenir; veri katmanı taklitlerle gözlenir. Silmeler yalnız seçilen ve
//        bilinen id'lerle removeItem / bulkRemove'a gider (490'lık parçalar), saveData hiç çağrılmaz, window.data.requests
//        dizisi eylem tarafından değiştirilmez; yazma reddinde kullanıcı uyarılır ve liste aynen kalır.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import puppeteer from 'puppeteer';

async function fixture(browser) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setRequestInterception(true);
    page.on('request', r => r.respond({ status: 200, contentType: 'text/html; charset=utf-8',
        body: '<!doctype html><meta charset="utf-8"><table><thead><tr><th class="select-all-header"><input type="checkbox" checked></th></tr></thead><tbody id="reqRows"></tbody></table>' }));
    await page.goto('http://requests.test/');
    await page.evaluate(() => {
        window.calls = [];
        window.alerts = [];
        window.failNext = false;
        window.data = { requests: [{ id: 'r1', durum: 'Beklemede' }, { id: 'r2', durum: 'Beklemede' }, { id: 'r3', durum: 'Onaylandı' }] };
        window.requireDbAdmin = () => true;
        window.showCustomConfirm = async () => true;
        window.showAppAlert = (m, t) => window.alerts.push([m, t]);
        // firebase-handler.js'teki writeOk ile aynı sözleşme: SaveDataError → false, diğer hata fırlatılır.
        window.writeOk = p => Promise.resolve(p).then(r => r !== false, e => { if (e && e.name === 'SaveDataError') return false; throw e; });
        const reject = () => { const e = new Error('reddedildi'); e.name = 'SaveDataError'; return Promise.reject(e); };
        window.saveData = (...args) => { window.calls.push(['saveData', ...args]); return Promise.resolve(true); };
        window.removeItem = (col, id) => { window.calls.push(['removeItem', col, id]); return window.failNext ? reject() : Promise.resolve({ deleted: 1 }); };
        window.bulkRemoveCount = 0;
        window.bulkRemove = (col, ids) => {
            window.calls.push(['bulkRemove', col, ids]);
            window.bulkRemoveCount++;
            return window.failNext || window.failAtCall === window.bulkRemoveCount ? reject() : Promise.resolve({ deleted: ids.length });
        };
        window.renderRequestsTable = () => window.calls.push(['render']);
        window.__requests = window.data.requests;
        window.__snapshot = JSON.stringify(window.data.requests);
    });
    await page.addScriptTag({ content: readFileSync('src/modules/request-actions.js', 'utf8') });
    const state = () => page.evaluate(() => ({
        calls: window.calls, alerts: window.alerts,
        sameArray: window.data.requests === window.__requests, unchanged: JSON.stringify(window.data.requests) === window.__snapshot
    }));
    const check = ids => page.evaluate(ids => {
        document.getElementById('reqRows').replaceChildren(...ids.map(([id, on]) => {
            const cb = document.createElement('input'); cb.type = 'checkbox'; cb.className = 'req-checkbox'; cb.value = id; cb.checked = on;
            return cb;
        }));
    }, ids);
    return { page, errors, state, check };
}

const executablePath = process.env.CHROME_EXECUTABLE_PATH || process.env.CHROME_PATH || [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].find(existsSync);

test('deleteRequest: yalnız removeItem(requests, id); saveData yok, window.data.requests değiştirilmez', async () => {
    const browser = await puppeteer.launch({ headless: true, ...(executablePath ? { executablePath } : {}), args: ['--no-sandbox'] });
    try {
        const { page, errors, state } = await fixture(browser);
        await page.evaluate(() => window.deleteRequest('r2'));
        let s = await state();
        assert.deepEqual(s.calls.filter(c => c[0] !== 'render'), [['removeItem', 'requests', 'r2']]);
        assert.equal(s.sameArray && s.unchanged, true);
        assert.deepEqual(s.alerts, [['Talep kaydı kalıcı olarak silindi.', 'info']]);

        // Yazma reddi: uyarı, liste aynen kalır, başarı mesajı yok.
        await page.evaluate(() => { window.calls = []; window.alerts = []; window.failNext = true; });
        await page.evaluate(() => window.deleteRequest('r1'));
        s = await state();
        assert.deepEqual(s.calls, [['removeItem', 'requests', 'r1']]);
        assert.deepEqual(s.alerts, [['Silme kaydedilemedi.', 'error']]);
        assert.equal(s.sameArray && s.unchanged, true);

        // Bilinmeyen id: hiçbir yazma yapılmaz.
        await page.evaluate(() => { window.calls = []; window.alerts = []; window.failNext = false; });
        await page.evaluate(() => window.deleteRequest('yok'));
        s = await state();
        assert.deepEqual(s.calls, []);
        assert.deepEqual(s.alerts, [['Talep bulunamadı; liste güncellenmiş olabilir.', 'error']]);
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});

test('deleteSelectedRequests: seçili ve bilinen id\'ler bulkRemove ile; seçilmeyen ve bilinmeyen id gönderilmez', async () => {
    const browser = await puppeteer.launch({ headless: true, ...(executablePath ? { executablePath } : {}), args: ['--no-sandbox'] });
    try {
        const { page, errors, state, check } = await fixture(browser);
        await check([['r1', true], ['r2', true], ['hayalet', true], ['r3', false]]);
        await page.evaluate(() => window.deleteSelectedRequests());
        let s = await state();
        assert.deepEqual(s.calls, [['bulkRemove', 'requests', ['r1', 'r2']], ['render']]);
        assert.equal(s.sameArray && s.unchanged, true);
        assert.deepEqual(s.alerts, [['2 kayıt başarıyla silindi.', 'success']]);
        assert.equal(await page.evaluate(() => document.querySelector('.select-all-header input').checked), false);

        // Yazma reddi: uyarı, liste aynen kalır, tablo yeniden çizilmez.
        await page.evaluate(() => { window.calls = []; window.alerts = []; window.failNext = true; });
        await page.evaluate(() => window.deleteSelectedRequests());
        s = await state();
        assert.deepEqual(s.calls, [['bulkRemove', 'requests', ['r1', 'r2']]]);
        assert.deepEqual(s.alerts, [['Silme kaydedilemedi.', 'error']]);
        assert.equal(s.sameArray && s.unchanged, true);

        // Seçilenlerin hiçbiri listede yok: yazma yapılmaz.
        await page.evaluate(() => { window.calls = []; window.alerts = []; window.failNext = false; });
        await check([['hayalet', true]]);
        await page.evaluate(() => window.deleteSelectedRequests());
        s = await state();
        assert.deepEqual(s.calls, []);
        assert.deepEqual(s.alerts, [['Seçili talepler listede bulunamadı; liste güncellenmiş olabilir.', 'error']]);
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});

test('deleteSelectedRequests: 490\'dan fazla seçimde atomik parçalara bölünür', async () => {
    const browser = await puppeteer.launch({ headless: true, ...(executablePath ? { executablePath } : {}), args: ['--no-sandbox'] });
    try {
        const { page, errors, state, check } = await fixture(browser);
        await page.evaluate(() => {
            window.data.requests = Array.from({ length: 600 }, (_, i) => ({ id: 'q' + i, durum: 'Beklemede' }));
            window.__requests = window.data.requests;
            window.__snapshot = JSON.stringify(window.data.requests);
        });
        await check(Array.from({ length: 600 }, (_, i) => ['q' + i, true]));
        await page.evaluate(() => window.deleteSelectedRequests());
        const s = await state();
        const removes = s.calls.filter(c => c[0] === 'bulkRemove');
        assert.deepEqual(removes.map(c => c[2].length), [490, 110]);
        assert.deepEqual(removes.flatMap(c => c[2]), Array.from({ length: 600 }, (_, i) => 'q' + i));
        assert.equal(s.sameArray && s.unchanged, true);
        assert.deepEqual(s.alerts, [['600 kayıt başarıyla silindi.', 'success']]);

        // İkinci parça reddedilirse: kaç kaydın silindiği söylenir, tablo tazelenir.
        await page.evaluate(() => { window.calls = []; window.alerts = []; window.bulkRemoveCount = 0; window.failAtCall = 2; });
        await page.evaluate(() => window.deleteSelectedRequests());
        const p = await state();
        assert.deepEqual(p.calls.map(c => c[0] === 'bulkRemove' ? c[2].length : c[0]), [490, 110, 'render']);
        assert.deepEqual(p.alerts, [['490 kayıt silindi; kalan 110 kayıt silinemedi.', 'error']]);
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});
