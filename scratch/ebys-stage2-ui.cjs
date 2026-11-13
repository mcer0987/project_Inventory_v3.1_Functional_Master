// İzole yerel DOM kontrolü: Firebase veya canlı uygulama açılmaz.
const puppeteer = require('puppeteer');
const fs = require('fs');
const assert = require('assert/strict');
(async () => {
    const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
    const browser = await puppeteer.launch({ executablePath, headless: true });
    try {
        const page = await browser.newPage(), errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.setContent('<div id="personelModal"><h2 id="personelModalTitle"></h2><form id="personelForm"><input id="personelName"><input id="personelPri"><p id="personelPriHint"></p><div id="personelCodeRow"><input id="personelCode"></div><p id="personelCodeHint"></p><select id="personelUnit"></select><button type="submit">Kaydet</button></form></div>');
        await page.evaluate(() => { window.data = { units: [{ id: 'u1', name: 'Birim', active: true, personnel: ['Eski Ali'] }, { id: 'u2', name: 'Pasif', active: false }],
            personel: [{ id: 'p1', uid: 'auth1', name: 'Ali', unitId: 'u1' }, { id: 'p2', uid: 'auth2', name: 'Ali' }] }; });
        await page.addScriptTag({ path: 'src/utils/html.js' });
        await page.addScriptTag({ path: 'src/services/staff-provisioning.js' });
        await page.addScriptTag({ path: 'src/utils/ebys-definitions-schema.js' });
        await page.addScriptTag({ path: 'src/ui/ebys-definitions-ui.js' });
        await page.evaluate(() => {
            window.registerSyncListener = () => {};
            window.showAppAlert = () => {};
            window.AppModules.EBYSDefinitions = { saveUnit: async input => { window.capturedUnit = input; } };
        });
        // v3.7 · İP-3: personel penceresi script.js'ten src/ui/personnel-modal.js'e taşındı; dosya bütün olarak yüklenir.
        await page.addScriptTag({ content: fs.readFileSync('src/ui/personnel-modal.js', 'utf8') });
        const unitSource = fs.readFileSync('src/modules/edm-workflow.js', 'utf8');
        await page.addScriptTag({ content: unitSource.slice(0, unitSource.indexOf('// [BUGFIX] Bug 2: Normalization helper')).replace(/^import .*$/gm, '') });
        const result = await page.evaluate(async () => {
            const ui = window.AppModules.EBYSDefinitionsUI;
            window.openPersonelModal('edit', 'p1');
            const identity = [document.getElementById('personelPermanentId').value, document.getElementById('personelAuthUid').value];
            document.getElementById('personelJobTitle').value = 'Mühendis';
            document.getElementById('personelActive').checked = false;
            const fields = ui.readPersonnel();
            const passiveDisabled = [...document.getElementById('personelEbysUnit').options].find(o => o.value === 'u2').disabled;
            window.openUnitModal('u1'); window.searchPersonnelForUnit('Ali');
            const labels = [...document.querySelectorAll('.unit-personnel-option')].map(b => b.textContent);
            document.querySelectorAll('.unit-personnel-option')[1].click();
            window.data.personel.push({ id: 'p3', name: '<img src=x onerror=alert(1)>', active: true });
            window.searchPersonnelForUnit('img');
            await window.saveUnitData();
            return { identity, fields, passiveDisabled, labels, selected: window.capturedUnit.personnelIds,
                legacy: window.data.units[0].personnel, injectedImages: document.querySelectorAll('img').length };
        });
        assert.deepEqual(result.identity, ['p1', 'auth1']);
        assert.equal(result.fields.unitId, 'u1'); assert.equal(result.fields.active, false); assert.equal(result.fields.jobTitle, 'Mühendis');
        assert.equal(result.passiveDisabled, true); assert.equal(result.labels.length, 2);
        assert.ok(result.labels[0].includes('p1')); assert.ok(result.labels[1].includes('p2'));
        assert.deepEqual(result.selected, ['p2']); assert.deepEqual(result.legacy, ['Eski Ali']);
        assert.equal(result.injectedImages, 0); assert.deepEqual(errors, []);
        console.log(JSON.stringify({ status: 'passed', checks: ['personnel-id-uid', 'unit-job-active-form', 'passive-selection', 'same-name-id-selection', 'legacy-names', 'text-only-dom'], pageerrors: errors.length }, null, 2));
    } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
