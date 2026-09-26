// [WHY]: Faz 2 yazma akışlarını gerçek Firestore'a karşı, yalnız inventory_demo'da ve kendi kendini temizleyerek doğrulamak.
// [HOW]: Repo 127.0.0.1'de servis edilir (→ inventory_demo); başka kök görülürse durur. Test kayıtları MARKER ile etiketlenir,
//        koşudan önce ve sonra silinir. Anonim (personel) oturumla yazılabilen koleksiyonlar test edilir.
// Usage: node scratch/flow-tests.js [scenarioName ...]
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const ROOT = path.resolve(__dirname, '..');
const PORT = 5594;
const MARKER = '__flowtest__';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

function startServer() {
    const server = http.createServer((req, res) => {
        const file = path.normalize(path.join(ROOT, decodeURIComponent(req.url.split('?')[0])));
        if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        fs.createReadStream(file).pipe(res);
    });
    return new Promise(r => server.listen(PORT, '127.0.0.1', () => r(server)));
}

// Runs inside the page. Helpers are exposed on window.__ft.
async function installHelpers(page) {
    await page.evaluate(async (MARKER) => {
        if (window.COLLECTION_ROOT !== 'inventory_demo') throw new Error('ABORT: COLLECTION_ROOT=' + window.COLLECTION_ROOT);
        const fs = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
        const col = name => fs.collection(window.fireDb, window.COLLECTION_ROOT, name, 'items');
        window.__ft = {
            MARKER,
            sleep: ms => new Promise(r => setTimeout(r, ms)),
            async readAll(name) { const s = await fs.getDocs(col(name)); return s.docs.map(d => ({ _docId: d.id, ...d.data() })); },
            async readMarked(name) { return (await this.readAll(name)).filter(d => JSON.stringify(d).includes(MARKER)); },
            async cleanup(names) {
                let n = 0;
                for (const name of names) for (const d of await this.readMarked(name)) { await fs.deleteDoc(fs.doc(window.fireDb, window.COLLECTION_ROOT, name, 'items', d._docId)); n++; }
                return n;
            },
            async waitFor(fn, ms = 8000) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await this.sleep(250); } return false; },
            set(id, v) { const el = document.getElementById(id); if (!el) throw new Error('missing #' + id); el.value = v; el.dispatchEvent(new Event('change')); },
        };
    }, MARKER);
}

const SCENARIOS = {
    // C1 · ITSM-01
    async saveRequest(page) {
        return page.evaluate(async () => {
            const ft = window.__ft, out = {};
            window.setActiveUser({ name: 'Flow Test ' + ft.MARKER, code: '00001' });
            window.openRequestModal(false);
            ft.set('reqProdName', 'Test Laptop'); ft.set('reqQty', '2'); ft.set('reqType', 'Kalıcı Zimmet');
            ft.set('reqPriority', 'Yüksek'); ft.set('reqNote', 'not ' + ft.MARKER);
            await window.saveRequest(new Event('submit'));
            out.created = await ft.waitFor(async () => (await ft.readMarked('requests')).length === 1);
            const [doc] = await ft.readMarked('requests');
            out.fields = doc && { ürün: doc.ürün, adet: doc.adet, talepTuru: doc.talepTuru, oncelik: doc.oncelik, durum: doc.durum, personel: doc.personel, hasTarih: !!doc.tarih };
            out.modalClosed = getComputedStyle(document.getElementById('requestModal')).display === 'none';

            // Edit by id: same document, updated qty, count unchanged
            await ft.waitFor(async () => (window.data.requests || []).some(r => String(r.id) === String(doc.id)));
            const idx = window.data.requests.findIndex(r => String(r.id) === String(doc.id));
            window.editPersonnelInventoryRequest(idx);
            ft.set('reqQty', '5');
            await window.saveRequest(new Event('submit'));
            out.edited = await ft.waitFor(async () => { const d = await ft.readMarked('requests'); return d.length === 1 && d[0].adet === 5; });
            const after = await ft.readMarked('requests');
            out.afterEdit = { count: after.length, sameId: after[0] && String(after[0].id) === String(doc.id), durumKept: after[0] && after[0].durum };

            // Geçici Zimmet without future return date must be rejected
            window.openRequestModal(false);
            ft.set('reqProdName', 'Temp ' + ft.MARKER); ft.set('reqQty', '1'); ft.set('reqType', 'Geçici Zimmet');
            ft.set('reqReturnDate', ''); ft.set('reqNote', ft.MARKER);
            await window.saveRequest(new Event('submit'));
            await ft.sleep(1500);
            out.tempWithoutDateRejected = (await ft.readMarked('requests')).length === 1;
            return out;
        });
    },
};

(async () => {
    const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SCENARIOS);
    const server = await startServer();
    const browser = await puppeteer.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    page.on('dialog', d => d.dismiss());
    let failed = false;
    try {
        await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
        await new Promise(r => setTimeout(r, 7000));
        await installHelpers(page);
        const pre = await page.evaluate(() => window.__ft.cleanup(['requests', 'tasks', 'purchaseOrders', 'assignments', 'serviceRecords']));
        console.log(`pre-cleanup removed: ${pre}`);
        for (const name of wanted) {
            try {
                console.log(`\n=== ${name} ===\n` + JSON.stringify(await SCENARIOS[name](page), null, 1));
            } catch (e) { failed = true; console.log(`\n=== ${name} FAILED: ${e.message}`); }
        }
    } finally {
        try {
            const post = await page.evaluate(() => window.__ft && window.__ft.cleanup(['requests', 'tasks', 'purchaseOrders', 'assignments', 'serviceRecords']));
            console.log(`\npost-cleanup removed: ${post}`);
        } catch (e) { console.log('cleanup error: ' + e.message); }
        console.log('pageerrors:', pageErrors);
        await browser.close();
        server.close();
    }
    process.exit(failed ? 1 : 0);
})();
