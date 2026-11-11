// v3.6 — Çıkış / sevk / zimmet / talep onayı / sepet cihaz satırlarında ürün kaydındaki demirbaş no (src/ui/device-ids.js):
// fixedFor, render({ fixed }) ve read(). Gerçek tarayıcıda (Puppeteer) schema.js + device-ids.js ile.
// Usage: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const executablePath = process.env.CHROME_EXECUTABLE_PATH || process.env.CHROME_PATH
    || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
        '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));

test('demirbaş no ürün kaydından 1. cihaz satırına gelir ve kilitlidir; Seri No ön dolar; numarasız üründe satırlar boş', async () => {
    const browser = await puppeteer.launch({ headless: true, ...(executablePath ? { executablePath } : {}), args: ['--no-sandbox'] });
    try {
        const page = await browser.newPage();
        await page.setContent('<div id="box"></div><div id="box2"></div>');
        await page.addScriptTag({ path: path.join(ROOT, 'src/utils/schema.js') });
        await page.addScriptTag({ path: path.join(ROOT, 'src/ui/device-ids.js') });
        const r = await page.evaluate(() => {
            const D = window.DeviceIds;
            const out = {
                none: D.fixedFor({ envanterNo: '-' }), blank: D.fixedFor({ envanterNo: '  ' }), missing: D.fixedFor(null),
                fixed: D.fixedFor({ envanterNo: 'ENV-007', sn: 'SN9' }),
                single: D.fixedFor({ envanterNo: 'ENV-1', adet: 1 }),
                multi: D.fixedFor({ envanterNo: 'IMP-32', adet: 32 }), multiB2: D.fixedFor({ envanterNo: 'IMP-2', qty: '2' }),
            };
            const box = document.getElementById('box');
            D.render(box, 2, { fixed: out.fixed });
            const rows = [...box.querySelectorAll('.dev-ids-row')];
            out.firstEnv = rows[0].querySelector('.dev-env').value;
            out.firstRo = rows[0].querySelector('.dev-env').readOnly;
            out.firstSn = rows[0].querySelector('.dev-sn').value;
            out.secondEnv = rows[1].querySelector('.dev-env').value;
            out.secondRo = rows[1].querySelector('.dev-env').readOnly;
            out.hint = /otomatik geldi/.test(box.textContent);
            rows[0].querySelector('.dev-env').value = 'SAHTE';   // konsoldan oynama denemesi
            out.read = D.read(box);
            const box2 = document.getElementById('box2');
            D.render(box2, 1, { fixed: D.fixedFor({ envanterNo: '' }) });
            out.plain = { ro: box2.querySelector('.dev-env').readOnly, value: box2.querySelector('.dev-env').value };
            return out;
        });
        assert.deepEqual([r.none, r.blank, r.missing], [null, null, null]);
        assert.deepEqual(r.fixed, { envanterNo: 'ENV-007', sn: 'SN9' });
        assert.deepEqual(r.single, { envanterNo: 'ENV-1', sn: '' });
        assert.deepEqual([r.multi, r.multiB2], [null, null], 'çok adetli satırın numarası bir cihaza ait değildir; otomatik dolmaz');
        assert.deepEqual([r.firstEnv, r.firstRo, r.firstSn], ['ENV-007', true, 'SN9']);
        assert.deepEqual([r.secondEnv, r.secondRo], ['', false], 'diğer cihazlar elle girilir');
        assert.equal(r.hint, true);
        assert.deepEqual(r.read, [{ sn: 'SN9', envanterNo: 'ENV-007' }, { sn: '', envanterNo: '' }], 'kilitli satır ürün kaydındaki değeri okur');
        assert.deepEqual(r.plain, { ro: false, value: '' }, 'numarasız üründe eski davranış');
    } finally { await browser.close(); }
});
