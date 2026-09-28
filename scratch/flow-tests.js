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
            window.editPersonnelInventoryRequest(doc.id);
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

    // C2 · ITSM-03 / DATA-03 — staff (anonymous) session
    async staffRequestActions(page) {
        return page.evaluate(async () => {
            const ft = window.__ft, out = {};
            window.setActiveUser({ name: 'Flow Test ' + ft.MARKER, code: '00001' });
            window.showCustomConfirm = async () => true;
            window.openRequestModal(false);
            ft.set('reqProdName', 'Mouse ' + ft.MARKER); ft.set('reqQty', '1'); ft.set('reqType', 'Kalıcı Zimmet'); ft.set('reqNote', ft.MARKER);
            await window.saveRequest(new Event('submit'));
            await ft.waitFor(async () => (await ft.readMarked('requests')).length === 1);
            const id = (await ft.readMarked('requests'))[0].id;
            const idx = () => window.data.requests.findIndex(r => String(r.id) === String(id));
            const durum = async () => (await ft.readMarked('requests'))[0].durum;
            await ft.waitFor(async () => idx() !== -1);

            await window.withdrawInventoryRequest(id);
            out.withdraw = await ft.waitFor(async () => (await durum()) === 'draft') ? 'draft ✔' : await durum();

            await window.sendDraftInventoryRequest(id);
            out.sendDraft = await ft.waitFor(async () => (await durum()) === 'Beklemede') ? 'Beklemede ✔' : await durum();

            // simulate admin approval on the request only (staff may write requests)
            window.data.requests[idx()].durum = 'approved';
            await window.saveData('requests', window.data.requests);
            await ft.waitFor(async () => (await durum()) === 'approved');

            const b3Before = (await ft.readAll('b3')).length;
            await window.receiveProduct(id);
            out.receive = await ft.waitFor(async () => (await durum()) === 'completed') ? 'completed ✔' : await durum();
            out.teslimTarihi = !!(await ft.readMarked('requests'))[0].teslimTarihi;
            out.b3Untouched = (await ft.readAll('b3')).length === b3Before;
            return out;
        });
    },

    // C5 · EBYS-01 (modal reset) + EBYS-02 (step owner guard, in-flight lock)
    // Runs the real transitionWorkflowState (EBYS-16 fixed: purchaseOrders only, no ipify).
    async ebysApprovalGuard(page) {
        return page.evaluate(async () => {
            const ft = window.__ft, out = {};
            const id = Date.now();
            const rec = {
                id, baslik: 'EBYS ' + ft.MARKER, durum: 'Onay Bekliyor', akis: [],
                workflow: { id: 'wf_' + id, started: true, finished: false, currentStep: 0, currentState: 'initiation', history: [],
                    steps: [{ user: 'Flow Onay A', tip: 'Yönetici', status: 'pending' }, { user: 'Flow Onay B', tip: 'Finans', status: 'pending' }] },
            };
            await window.saveData('purchaseOrders', [...(window.data.purchaseOrders || []), rec]);
            await ft.waitFor(async () => (window.data.purchaseOrders || []).some(x => x.id === id));
            const dbStep = async () => { const d = (await ft.readMarked('purchaseOrders'))[0]; return d && { step: d.workflow.currentStep, finished: d.workflow.finished, approvals: (d.akis || []).filter(a => String(a.islem).startsWith('✅')).length }; };

            // EBYS-01: stale "Onayla" binding must not survive into a new request
            window.setActiveUser({ name: 'Flow Onay A' });
            window.openPurchaseDetail(id, 'view');
            const saveBtn = document.getElementById('purSaveBtn');
            out.viewModeHasApprove = /Onayla/.test(saveBtn.innerHTML) && typeof saveBtn.onclick === 'function';
            document.getElementById('purFileList').innerHTML = '<div>old.pdf</div>';
            window.openNewPurchaseModal();
            out.newModalReset = {
                onclickCleared: saveBtn.onclick === null,
                noEditId: document.getElementById('purchaseForm').dataset.editId === undefined,
                fileListCleared: document.getElementById('purFileList').innerHTML === '',
                rejectHidden: !document.getElementById('purRejectBtn') || document.getElementById('purRejectBtn').style.display === 'none',
            };
            window.closePurchaseModal();

            // EBYS-02: wrong person is denied
            window.setActiveUser({ name: 'Flow Onay B' });
            await window.approveStep(id);
            await ft.sleep(1500);
            out.wrongUserDenied = (await dbStep()).step === 0;

            // right person (name normalised) advances one step
            window.setActiveUser({ name: '  flow onay a ' });
            await window.approveStep(id);
            out.ownerApproved = await ft.waitFor(async () => (await dbStep()).step === 1);

            // double click by next owner advances only once
            window.setActiveUser({ name: 'Flow Onay B' });
            await ft.waitFor(async () => (window.data.purchaseOrders.find(x => x.id === id)?.workflow.currentStep) === 1);
            await Promise.all([window.approveStep(id), window.approveStep(id)]);
            await ft.waitFor(async () => (await dbStep()).finished === true);
            out.afterDoubleClick = await dbStep();
            const final = (await ft.readMarked('purchaseOrders'))[0];
            out.transitionsInHistory = (final.workflow.history || []).filter(h => h.action === 'transition').length;
            out.ipStored = JSON.stringify(final.workflow.history || []).includes('"ip"');
            out.finalState = final.workflow.currentState;
            out.ipifyRequested = performance.getEntriesByType('resource').some(r => r.name.includes('ipify'));
            return out;
        });
    },

    // D2 · ITSM-05 — admin request actions by id. b3 writes need an admin session, so b3 save attempts are counted.
    async adminRequestActions(page) {
        return page.evaluate(async () => {
            const ft = window.__ft, out = {};
            const base = Date.now();
            const mk = (n, durum, personel) => ({ id: base + n, ürün: 'Req' + n + ' ' + ft.MARKER, personel, durum, adet: 1, tarih: '01.01.2026' });
            await window.saveData('requests', [...(window.data.requests || []),
                mk(1, 'Beklemede', 'Personel A ' + ft.MARKER), mk(2, 'Beklemede', 'Personel B ' + ft.MARKER), mk(3, 'draft', 'Personel C ' + ft.MARKER)]);
            await ft.waitFor(async () => (await ft.readMarked('requests')).length === 3 && (window.data.requests || []).filter(r => String(r.ürün).includes(ft.MARKER)).length === 3);
            const db = async n => (await ft.readMarked('requests')).find(r => r.id === base + n);
            const realSave = window.saveData, realModal = window.showRequestApprovalModal; let b3Attempts = 0;
            // b3 is admin-only: count the attempt and report success so the approval is not rolled back.
            window.saveData = async (col, items) => { if (col === 'b3') { b3Attempts++; return true; } return realSave(col, items); };
            window.showCustomConfirm = async () => true;
            window.setActiveUser({ name: 'Yönetici Test' });

            window.showRequestApprovalModal = async () => null;
            await window.confirmRequest(base + 1);
            await ft.sleep(1200);
            out.cancelKeepsPending = (await db(1)).durum === 'Beklemede' && b3Attempts === 0;

            window.showRequestApprovalModal = async () => ({ sn: 'SN-123', source: null });
            await Promise.all([window.confirmRequest(base + 1), window.confirmRequest(base + 1)]);
            await ft.waitFor(async () => (await db(1)).durum === 'approved');
            const a = await db(1);
            out.approved = { durum: a.durum, sn: a.sn, approvedBy: a.approvedBy, hasApprovedAt: !!a.approvedAt, b3AttemptsAfterDoubleClick: b3Attempts };

            await ft.waitFor(async () => window.data.requests.find(r => r.id === base + 1)?.durum === 'approved');
            await window.confirmRequest(base + 1);
            out.secondApproveRefused = b3Attempts === out.approved.b3AttemptsAfterDoubleClick;

            await window.confirmRequest(base + 3);
            await ft.sleep(800);
            out.draftRefused = (await db(3)).durum === 'draft';

            window.setActiveUser({ name: 'Personel B ' + ft.MARKER });
            await window.confirmRequest(base + 2);
            await ft.sleep(800);
            out.selfApprovalBlocked = (await db(2)).durum === 'Beklemede';

            window.setActiveUser({ name: 'Yönetici Test' });
            await window.rejectRequest(base + 2);
            await ft.waitFor(async () => (await db(2)).durum === 'rejected');
            out.rejected = { durum: (await db(2)).durum, rejectedBy: (await db(2)).rejectedBy };

            await ft.waitFor(async () => window.data.requests.find(r => r.id === base + 2)?.durum === 'rejected');
            await window.deleteRequest(base + 2);
            out.deletedById = await ft.waitFor(async () => !(await db(2)) && !!(await db(1)) && !!(await db(3)));
            window.saveData = realSave; window.showRequestApprovalModal = realModal;
            return out;
        });
    },

    // Tur 2.5 · ITSM-08 — approval deducts the chosen stock item, links b3 to it and rolls back on failure.
    // b1/b2/b3 writes need an admin session: runStockTransaction and b3 saves are recorded stubs, requests are real.
    // A fake B1 product lives only in window.data (never saved). The real approval modal is driven through the DOM.
    async requestApprovalStock(page) {
        return page.evaluate(async () => {
            const ft = window.__ft, out = {};
            const base = Date.now();
            const prod = { id: 'b1_ft_' + base, ürün: 'FT Laptop ' + ft.MARKER, marka: 'Acme', raf: 'R-9', adet: 5, isDemirbas: true };
            const low = { id: 'b1_ftlow_' + base, ürün: 'FT Low ' + ft.MARKER, marka: '', raf: 'R-1', adet: 1 };
            window.data.b1 = [...(window.data.b1 || []), prod, low];
            const mk = (n, ürün, adet) => ({ id: base + n, ürün, personel: 'Personel ' + n + ' ' + ft.MARKER, durum: 'Beklemede', adet, tarih: '01.01.2026' });
            await window.saveData('requests', [...(window.data.requests || []),
                mk(1, 'Acme FT Laptop ' + ft.MARKER, 2), mk(2, 'Acme FT Laptop ' + ft.MARKER, 1), mk(3, 'Serbest ürün ' + ft.MARKER, 3), mk(4, 'FT Low ' + ft.MARKER, 2)]);
            await ft.waitFor(async () => (window.data.requests || []).filter(r => String(r.ürün).includes(ft.MARKER)).length === 4);
            const db = async n => (await ft.readMarked('requests')).find(r => r.id === base + n);

            const tx = [], b3 = []; let failB3 = false;
            const realTx = window.runStockTransaction, realAlert = window.showAppAlert;
            window.runStockTransaction = async (c, id, d) => { tx.push([c, id, d]); const p = window.data[c].find(x => x.id === id); const before = p.adet; p.adet += d; return { before, after: p.adet }; };
            const realSave = window.saveData;
            window.saveData = async (col, items) => { if (col === 'b3') { if (failB3) return false; b3.push(items[items.length - 1]); return true; } return realSave(col, items); };
            const alerts = []; window.showAppAlert = (m, t) => alerts.push([t, m]);
            window.setActiveUser({ name: 'Yönetici Test' });
            const modal = () => document.getElementById('requestApprovalModal');
            const openFor = async n => { const run = { p: window.confirmRequest(base + n) }; await ft.waitFor(async () => !!modal(), 2000); return run; };

            // 1) exact name match is preselected; OK deducts 2 from B1 and links b3 to the product
            let pending = await openFor(1);
            const sel = modal().querySelector('#raSource');
            out.preselected = sel.value === `b1|${prod.id}`;
            out.lowStockDisabled = [...sel.options].find(o => o.value === `b1|${low.id}`)?.disabled === true;
            modal().querySelector('#raSn').value = 'SN-FT1';
            modal().querySelector('#raOk').click();
            await pending.p;
            await ft.waitFor(async () => (await db(1))?.durum === 'approved');
            const r1 = await db(1);
            out.approveWithStock = {
                tx: JSON.stringify(tx) === JSON.stringify([['b1', prod.id, -2]]), stockNow: prod.adet,
                request: { durum: r1.durum, sn: r1.sn, stockRepo: r1.stockRepo, stockProductId: r1.stockProductId === prod.id },
                b3: b3[0] && { sourceRepo: b3[0].sourceRepo, productId: b3[0].productId === prod.id, requestId: b3[0].requestId === base + 1, sarfAdet: b3[0].sarfAdet, shelfNo: b3[0].shelfNo, isDemirbas: b3[0].isDemirbas },
                message: alerts.at(-1)?.[1],
            };

            // 2) cancel: nothing changes
            tx.length = 0; b3.length = 0;
            pending = await openFor(2);
            modal().querySelector('#raCancel').click();
            await pending.p; await ft.sleep(800);
            out.cancel = { noTx: tx.length === 0, noB3: b3.length === 0, stillPending: (await db(2)).durum === 'Beklemede' };

            // 3) free-text item: OK without choice is refused; explicit "no stock" approves without deduction
            pending = await openFor(3);
            out.freeTextPreselect = modal().querySelector('#raSource').value;
            modal().querySelector('#raOk').click();
            out.okWithoutChoiceRefused = !!modal() && modal().querySelector('#raError').style.display === 'block';
            const s3 = modal().querySelector('#raSource'); s3.value = '__none__'; s3.dispatchEvent(new Event('change'));
            modal().querySelector('#raOk').click();
            await pending.p;
            await ft.waitFor(async () => (await db(3))?.durum === 'approved');
            out.noStock = { noTx: tx.length === 0, sourceRepo: b3[0]?.sourceRepo, hasProductId: 'productId' in (b3[0] || {}), message: alerts.at(-1)?.[1] };

            // 4) b3 write fails: stock is restored and the request goes back to pending
            tx.length = 0; failB3 = true;
            await ft.waitFor(async () => window.data.requests.some(r => r.id === base + 2 && r.durum === 'Beklemede'));
            pending = await openFor(2);
            const s4 = modal().querySelector('#raSource'); s4.value = `b1|${prod.id}`; s4.dispatchEvent(new Event('change'));
            modal().querySelector('#raOk').click();
            await pending.p;
            await ft.sleep(1500);
            out.b3Failure = { tx: JSON.stringify(tx) === JSON.stringify([['b1', prod.id, -1], ['b1', prod.id, 1]]), stockNow: prod.adet, reverted: (await db(2)).durum === 'Beklemede', message: alerts.at(-1)?.[1] };

            // 5) stock transaction refuses (e.g. insufficient on server): nothing is approved
            failB3 = false; tx.length = 0;
            window.runStockTransaction = async () => { throw new Error('Yetersiz Stok!'); };
            pending = await openFor(2);
            const s5 = modal().querySelector('#raSource'); s5.value = `b1|${prod.id}`; s5.dispatchEvent(new Event('change'));
            modal().querySelector('#raOk').click();
            await pending.p; await ft.sleep(800);
            out.txFailure = { stillPending: (await db(2)).durum === 'Beklemede', message: alerts.at(-1)?.[1] };

            window.saveData = realSave; window.runStockTransaction = realTx; window.showAppAlert = realAlert;
            window.data.b1 = window.data.b1.filter(p => p !== prod && p !== low);
            return out;
        });
    },

    // Tur 2.5 · EBYS-15 — unit modal on both pages: search/select personnel, add, edit by id (no duplicate), delete by id.
    // 'units' is admin-only: saveData('units') is a recorded stub; window.data.units is restored afterwards.
    async unitManagement(page, browser) {
        const probe = async p => p.evaluate(async () => {
            const sleep = ms => new Promise(r => setTimeout(r, ms));
            const out = {}, saves = [];
            const origUnits = window.data.units;
            window.data.personel = [...(window.data.personel || []), { name: 'Zeynep Flowtest' }, { name: 'Zehra Flowtest' }];
            window.data.units = [{ id: 'u1', name: 'Mevcut Birim', personnel: ['Zeynep Flowtest'] }, { id: 'u2', name: 'Diğer Birim', personnel: [] }];
            const realSave = window.saveData;
            window.saveData = async (col, items) => { if (col !== 'units') return realSave(col, items); saves.push(JSON.parse(JSON.stringify(items))); window.data.units = items; return true; };
            window.showCustomConfirm = async () => true;
            const alerts = []; window.showAppAlert = (m, t) => alerts.push([t, m]);
            const $ = id => document.getElementById(id);
            const visible = el => !!el && getComputedStyle(el).display !== 'none';
            const type = v => { $('unitPersonnelSearch').value = v; $('unitPersonnelSearch').dispatchEvent(new Event('input')); };

            // the page's own "Yeni Birim Ekle" button opens the modal
            const btn = [...document.querySelectorAll('button[onclick*="openUnitModal()"]')][0];
            let err = null; try { btn.click(); } catch (e) { err = e.message; }
            out.addButton = { found: !!btn, error: err, modalVisible: visible($('unitModal')), count: document.querySelectorAll('#unitModal').length };

            $('unitNameInput').value = 'Yeni Birim FT';
            type('zeh');
            const opts = [...document.querySelectorAll('#unitPersonnelResults .unit-personnel-option')];
            out.search = { resultsVisible: visible($('unitPersonnelResults')), names: opts.map(o => o.textContent.trim()) };
            opts.find(o => o.textContent.includes('Zehra'))?.click();
            out.selected = [...document.querySelectorAll('#unitSelectedPersonnel li')].map(li => li.textContent.replace('×', '').trim());
            type('zehra');
            out.alreadyMarked = document.querySelector('#unitPersonnelResults .unit-personnel-option')?.textContent.includes('(eklendi)');
            type('qqqq');
            out.noMatchMessage = $('unitPersonnelResults').textContent.trim();
            await window.saveUnitData();
            const added = saves.at(-1);
            out.add = { units: added.length, newUnit: added.find(u => u.name === 'Yeni Birim FT')?.personnel, modalClosed: !visible($('unitModal')) };

            // duplicate name is refused
            window.openUnitModal(); $('unitNameInput').value = '  mevcut birim ';
            const before = saves.length; await window.saveUnitData();
            out.duplicateRefused = saves.length === before && alerts.at(-1)?.[0] === 'warning';
            window.closeUnitModal();

            // edit by id keeps the id and the count, updates personnel
            window.openUnitModal('u1');
            out.editPrefill = { name: $('unitNameInput').value, personnel: [...document.querySelectorAll('#unitSelectedPersonnel li')].length };
            $('unitNameInput').value = 'Mevcut Birim (düz.)';
            type('zeh'); document.querySelector('#unitPersonnelResults .unit-personnel-option[onclick]')?.click();
            await window.saveUnitData();
            const edited = saves.at(-1);
            out.edit = { units: edited.length, u1: edited.find(u => u.id === 'u1') && { name: edited.find(u => u.id === 'u1').name, personnel: edited.find(u => u.id === 'u1').personnel } };

            // delete by id removes exactly that unit
            await window.deleteUnit('u2');
            out.deleteById = saves.at(-1).map(u => u.id).sort().join(',');
            out.rendered = (document.getElementById('unitListArea') || document.getElementById('adminDefUnitTableBody'))?.textContent.includes('Mevcut Birim (düz.)');

            window.saveData = realSave; window.data.units = origUnits;
            window.data.personel = window.data.personel.filter(p => !String(p.name).includes('Flowtest'));
            await sleep(10);
            return out;
        });
        const result = { index: await probe(page) };
        const admin = await (await browser.createBrowserContext()).newPage();
        const errs = []; admin.on('pageerror', e => errs.push(e.message));
        await admin.evaluateOnNewDocument(() => localStorage.setItem('admin_auth', JSON.stringify({ expiry: Date.now() + 600000 })));
        await admin.goto(page.url().replace('index.html', 'admin.html'), { waitUntil: 'domcontentloaded' });
        await new Promise(r => setTimeout(r, 9000));
        result.admin = await probe(admin);
        result.adminPageErrors = errs;
        await admin.browserContext().close();
        return result;
    },

    // Tur 2.5 · purchase "Belge / Ürün Türü": fed from productTypes (live while the modal is open), selection kept,
    // real purchaseOrders save carries 'tur'. productTypes/units are replaced in memory only and restored.
    async purchaseTypeSelect(page) {
        return page.evaluate(async () => {
            const ft = window.__ft, out = {};
            const orig = { types: window.data.productTypes, units: window.data.units };
            const fire = col => window.dispatchEvent(new CustomEvent('onInventoryDataUpdated', { detail: { collection: col, isPatch: false, changes: [] } }));
            const opts = () => [...document.getElementById('purType').options].map(o => o.value);
            const form = document.getElementById('purchaseForm');
            window.setActiveUser({ name: 'Flow Test ' + ft.MARKER, code: '00001' });

            window.data.productTypes = []; window.data.units = [{ id: 'u1', name: 'FT Birim' }];
            window.openNewPurchaseModal();
            out.emptyState = { options: opts(), text: document.getElementById('purType').options[0].text };
            ft.set('purName', 'Ürün ' + ft.MARKER);
            ft.set('purUnit', 'FT Birim');
            out.formBlockedWhileEmpty = form.checkValidity() === false;

            window.data.productTypes = [{ id: 'a', name: 'Zeta' }, { id: 'b', name: '<b>Alfa</b>' }, { id: 'c', name: 'Zeta' }];
            fire('productTypes');
            out.liveFilled = { options: opts(), noInjectedB: !document.querySelector('#purType b') };
            ft.set('purType', 'Zeta');
            window.data.productTypes = [...window.data.productTypes, { id: 'd', name: 'Beta' }];
            fire('productTypes');
            out.selectionKept = document.getElementById('purType').value === 'Zeta' && opts().includes('Beta');
            out.formValidNow = form.checkValidity();

            out.requesterShown = document.getElementById('purUser').value;
            document.getElementById('purUser').value = 'Muhammed CER'; // EBYS-06: form alanı kaydı belirlememeli
            form.requestSubmit();
            out.saved = await ft.waitFor(async () => (await ft.readMarked('purchaseOrders')).length === 1);
            await ft.waitFor(async () => document.getElementById('purchaseModal').style.display === 'none'); // save flow finished (form reset done)
            const [po] = await ft.readMarked('purchaseOrders');
            out.savedFields = po && { tur: po.tur, birim: po.birim, talepEden: po.talepEden, createdByName: po.createdByName, createdBy: po.createdBy };

            // a type deleted after the request was made stays visible in edit mode
            await ft.waitFor(async () => (window.data.purchaseOrders || []).some(x => x.id === po.id));
            window.data.productTypes = [{ id: 'd', name: 'Beta' }];
            window.openPurchaseDetail(po.id, 'edit');
            await ft.sleep(150);
            fire('productTypes');
            out.editKeepsDeletedType = document.getElementById('purType').value === 'Zeta' && opts().includes('Beta');
            window.closePurchaseModal();

            window.data.productTypes = orig.types; window.data.units = orig.units;
            return out;
        });
    },

    // Tur 2.5 revizyon · B3 table reads both schemas, exit form fills Raf No, "Taleplerim" shows delivery date,
    // unit/approval dialogs follow the dark theme. In-memory data only (nothing is saved).
    async tur25Revisions(page) {
        return page.evaluate(async () => {
            const ft = window.__ft, out = {};
            const orig = { b1: window.data.b1, b3: window.data.b3, requests: window.data.requests };
            const prod = { id: 'b1_rev', ürün: 'Rev Laptop', tür: 'Laptop', raf: 'R-7', adet: 4 };
            window.data.b1 = [...(orig.b1 || []), prod];
            window.data.b3 = [
                { id: 1, rafNo: 'R-1', urunTuru: 'Kablo', urunAciklama: 'HDMI', sn: 'S1', adet: 3, not: 'eski', alanKisi: 'A', tarih: '01.01.2026' },
                { id: 2, shelfNo: 'R-7', productType: 'Rev Laptop', productId: 'b1_rev', sourceRepo: 'b1', sn: 'S2', sarfAdet: 1, note: 'yeni', alanKisi: 'B', date: '02.01.2026', talepTuru: 'Kalıcı Zimmet' },
            ];
            window.renderExitTable();
            const cells = n => [...document.querySelectorAll('#tableB3 tbody tr')][n].querySelectorAll('td');
            const txt = n => [...cells(n)].slice(0, 8).map(td => td.textContent.trim());
            out.b3Legacy = txt(0);
            out.b3New = txt(1);

            window.openExitModal();
            window.selectProduct(prod.ürün, prod.tür, prod.raf, prod.adet, 'b1', window.data.b1.length - 1);
            out.exitShelf = { shelf: document.getElementById('exitShelfNo').value, qtyMax: document.getElementById('exitQty').max };
            window.openExitModal();
            out.exitShelfResetOnOpen = document.getElementById('exitShelfNo').value === '' && !document.getElementById('exitQty').hasAttribute('max');
            window.closeExitModal?.();

            window.setActiveUser({ name: 'Rev User ' + ft.MARKER });
            window.data.requests = [
                { id: 11, ürün: 'Mouse', adet: 1, personel: 'Rev User ' + ft.MARKER, durum: 'completed', tarih: '01.01.2026', teslimTarihi: '05.01.2026' },
                { id: 12, ürün: 'Klavye', adet: 1, personel: 'Rev User ' + ft.MARKER, durum: 'Beklemede', tarih: '03.01.2026' },
            ];
            window.renderMyRequestsTable();
            out.myRequests = {
                header: [...document.querySelectorAll('#tableMyRequests thead th')].map(th => th.textContent.trim()),
                rows: [...document.querySelectorAll('#tableMyRequests tbody tr')].map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent.trim().replace(/\s+/g, ' ')).slice(0, 4)),
            };

            document.documentElement.setAttribute('data-theme', 'dark');
            window.openUnitModal();
            const bg = sel => getComputedStyle(document.querySelector(sel)).backgroundColor;
            out.darkUnit = { box: bg('#unitModal .um-box'), input: bg('#unitNameInput'), text: getComputedStyle(document.querySelector('#unitModal .um-box')).color };
            window.closeUnitModal();
            window.data.requests = [{ id: 13, ürün: 'Rev Laptop', adet: 1, personel: 'X', durum: 'Beklemede' }];
            const p = window.showRequestApprovalModal(window.data.requests[0]);
            await ft.sleep(50);
            out.darkApproval = { box: bg('#requestApprovalModal > div'), select: bg('#raSource') };
            document.getElementById('raCancel').click(); await p;
            document.documentElement.removeAttribute('data-theme');

            Object.assign(window.data, orig);
            window.renderExitTable(); window.renderMyRequestsTable();
            return out;
        });
    },

    // Tur 3 · EBYS-09 (approver validation, template edits kept) + EBYS-13 (stop = suspend, admin only, owner cannot act).
    // Real purchaseOrders (marked); personnel/templates are in-memory; isDbAdmin is stubbed for the admin-only stop.
    async ebysStartStop(page) {
        return page.evaluate(async () => {
            const ft = window.__ft, out = {};
            const orig = { personel: window.data.personel, tpls: window.data.workflowTemplates, isDbAdmin: window.isDbAdmin, confirm: window.showCustomConfirm, alert: window.showAppAlert };
            window.data.personel = [...(orig.personel || []), { name: 'Onay Kişi FT' }, { name: 'İkinci Onay FT' }];
            const alerts = []; window.showAppAlert = (m, t) => alerts.push([t, m]);
            window.setActiveUser({ name: 'Talep Eden FT ' + ft.MARKER, code: '00001' });
            const base = Date.now();
            const mk = n => ({ id: base + n, urun: 'EBYS ' + n + ' ' + ft.MARKER, durum: 'Taslak', akis: [], workflow: { started: false, currentStep: 0, steps: [] } });
            await window.saveData('purchaseOrders', [...(window.data.purchaseOrders || []), mk(1), mk(2)]);
            await ft.waitFor(async () => (window.data.purchaseOrders || []).filter(x => String(x.urun).includes(ft.MARKER)).length === 2);
            const db = async n => (await ft.readMarked('purchaseOrders')).find(x => x.id === base + n);
            const stepInputs = () => [...document.querySelectorAll('#manualStepsContainer input.workflow-select-ghost')];
            const type = (i, v) => { const el = stepInputs()[i]; el.value = v; el.dispatchEvent(new Event('input')); };

            window.startWorkflow(base + 1);
            await window.confirmStartWorkflow();
            out.emptyRefused = { msg: alerts.at(-1)?.[1], started: (await db(1)).workflow.started };
            type(0, 'Yok Böyle Biri');
            await window.confirmStartWorkflow();
            out.unknownRefused = { msg: alerts.at(-1)?.[1], started: (await db(1)).workflow.started };
            type(0, '  onay kişi ft ');
            await window.confirmStartWorkflow();
            await ft.waitFor(async () => (await db(1)).workflow.started === true);
            const w1 = (await db(1)).workflow;
            out.typedAccepted = { started: w1.started, user: w1.steps[0].user, state: w1.currentState };

            window.data.workflowTemplates = [{ id: 'tplFT', name: 'FT', steps: [{ user: 'Onay Kişi FT', tip: 'Paraf' }, { user: 'Onay Kişi FT', tip: 'Olur (Islak)' }] }];
            window.startWorkflow(base + 2);
            window.toggleWorkflowMethod('tplFT');
            type(1, 'İkinci Onay FT');
            await window.confirmStartWorkflow();
            await ft.waitFor(async () => (await db(2)).workflow.started === true);
            out.templateUsesScreen = (await db(2)).workflow.steps.map(s => s.user + '/' + s.tip);

            // stop: non-admin refused
            window.isDbAdmin = () => false; window.showCustomConfirm = async () => true;
            await window.stopWorkflow(base + 2);
            out.nonAdminStopRefused = { msg: alerts.at(-1)?.[1], stillStarted: (await db(2)).workflow.started };

            // stop: admin suspends
            window.isDbAdmin = () => true;
            await ft.waitFor(async () => window.data.purchaseOrders.find(x => x.id === base + 1)?.workflow?.started === true);
            await window.stopWorkflow(base + 1);
            await ft.waitFor(async () => (await db(1)).durum === 'Durduruldu');
            const s1 = await db(1);
            out.stopped = { durum: s1.durum, state: s1.workflow.currentState, started: s1.workflow.started, akis: s1.akis.at(-1)?.islem, msg: alerts.at(-1)?.[1] };

            // owner cannot approve a suspended workflow
            window.isDbAdmin = () => false;
            window.setActiveUser({ name: 'Onay Kişi FT' });
            await ft.waitFor(async () => window.data.purchaseOrders.find(x => x.id === base + 1)?.durum === 'Durduruldu');
            await window.approveStep(base + 1);
            await ft.sleep(800);
            const a1 = await db(1);
            out.ownerBlockedWhileSuspended = { step: a1.workflow.currentStep, stepStatus: a1.workflow.steps[0].status, msg: alerts.at(-1)?.[1] };

            // restart keeps the history
            window.setActiveUser({ name: 'Talep Eden FT ' + ft.MARKER, code: '00001' });
            const histBefore = (a1.workflow.history || []).length;
            window.startWorkflow(base + 1);
            type(0, 'Onay Kişi FT');
            await window.confirmStartWorkflow();
            await ft.waitFor(async () => (await db(1)).workflow.started === true);
            const r1 = (await db(1)).workflow;
            out.restart = { started: r1.started, state: r1.currentState, historyGrew: (r1.history || []).length > histBefore };

            window.closeStartWorkflowModal();
            Object.assign(window.data, { personel: orig.personel, workflowTemplates: orig.tpls });
            window.isDbAdmin = orig.isDbAdmin; window.showCustomConfirm = orig.confirm; window.showAppAlert = orig.alert;
            return out;
        });
    },

    // Tur 3 · VIP-01/02 cleaner, VIP-04/06/03 panel + force logout, ADM-04 locations, VIP-10 launchpad (admin page)
    // and the force-logout receiver (index page). In-memory data only: the cleaner's batch delete runs under the
    // anonymous session and is rejected by the rules; the chosen ids are read from its audit log line. No VIP
    // command is written (rule 7.5).
    async tur3AdminPanel(page, browser) {
        const result = {};
        result.forceLogoutReceiver = await page.evaluate(() => {
            const o = {}; let calls = 0; const realLogout = window.logout; window.logout = () => { calls++; };
            window.setActiveUser({ name: 'Hedef FT', code: '12345' });
            const now = Date.now(), cmd = { targetId: '12345', issuedAt: now, nonce: 'ft_' + now };
            o.first = window.handleForceLogoutCommand(cmd); o.second = window.handleForceLogoutCommand(cmd); o.logoutCalls = calls;
            o.stale = window.handleForceLogoutCommand({ targetId: '12345', issuedAt: now - 11 * 60000, nonce: 'ft_old_' + now });
            o.otherUser = window.handleForceLogoutCommand({ targetId: '99999', issuedAt: now, nonce: 'ft_o_' + now });
            const realIs = window.isDbAdmin; window.isDbAdmin = () => true;
            o.adminImmune = window.handleForceLogoutCommand({ targetId: '12345', issuedAt: now, nonce: 'ft_a_' + now });
            window.isDbAdmin = realIs; window.logout = realLogout;
            o.legacyIgnored = window.handleForceLogoutCommand(undefined);
            Object.keys(localStorage).filter(k => k.startsWith('force_logout_done_ft_')).forEach(k => localStorage.removeItem(k));
            return o;
        });

        const admin = await (await browser.createBrowserContext()).newPage();
        const errs = [], audit = [];
        admin.on('pageerror', e => errs.push(e.message));
        admin.on('console', m => { if (m.text().includes('[vipCleanDuplicates]')) audit.push(m.text()); });
        await admin.evaluateOnNewDocument(() => localStorage.setItem('admin_auth', JSON.stringify({ expiry: Date.now() + 600000 })));
        await admin.goto(page.url().replace('index.html', 'admin.html'), { waitUntil: 'domcontentloaded' });
        await new Promise(r => setTimeout(r, 9000));
        Object.assign(result, await admin.evaluate(async () => {
            const sleep = ms => new Promise(r => setTimeout(r, ms));
            const o = {}, alerts = []; window.showAppAlert = (m, t) => alerts.push([t, m]);
            const orig = { b1: window.data.b1, b2: window.data.b2, b3: window.data.b3, loc: window.data.locations, units: window.data.units, isDbAdmin: window.isDbAdmin, save: window.saveData };

            // VIP-01/02
            window.isDbAdmin = () => true;
            window.data.b1 = [{ id: 'a', ürün: 'X', raf: 'R1', adet: 1, sn: 'N/A' }, { id: 'b', ürün: 'Y', raf: 'R2', adet: 1, sn: 'n/a' },
                { id: 'c', ürün: 'Z', raf: 'R3', adet: 1, sn: 'SN1' }, { id: 'd', ürün: 'Z2', raf: 'R4', adet: 2, sn: ' sn1 ' },
                { id: 'e', ürün: 'X', raf: 'R1', adet: 1, sn: 'N/A' }, { id: 'f2', ürün: 'W', raf: 'R9', adet: 1, sn: '--' }];
            window.data.b2 = [{ id: 'f', ürün: 'K', raf: 'R5', adet: 3 }, { id: 'g', ürün: 'K', raf: 'R5', adet: 3 }];
            window.data.b3 = [{ id: 1, sn: 'SN9', alanKisi: 'P' }, { id: 2, sn: 'SN9', alanKisi: 'P' }];
            // real dialog (script.js showCustomConfirm, textContent): preview renders as text; Vazgeç = nothing happens
            const realRun = window.vipCleanDuplicates(); await sleep(400);
            const msgEl = document.getElementById('alertMessage');
            o.cleanerRealDialog = { shown: getComputedStyle(document.getElementById('customAlertOverlay')).display === 'flex',
                noMarkup: msgEl.children.length === 0 && !msgEl.textContent.includes('<') };
            document.getElementById('alertCancelBtn').click(); await realRun;
            o.cleanerCancelWrites = alerts.length;
            window.showCustomConfirm = async (t, msg) => {
                o.cleanerPreview = { firstRow: msg.split('\n').find(l => l.startsWith('1. ')), counts: (msg.match(/B1: (\d+) · B2: (\d+)/) || []).slice(1),
                    b3Excluded: msg.includes('B3 hareket defteri'), plainText: !/<[a-z]/i.test(msg) };
                window.data.b1 = window.data.b1.filter(x => x.id !== 'e');
                window.data.b2 = [...window.data.b2, { id: 'i', ürün: 'K', raf: 'R5', adet: 3 }];
                return true;
            };
            await Promise.all([window.vipCleanDuplicates(), window.vipCleanDuplicates()]);
            o.cleanerResult = alerts.at(-1);
            o.cleanerRuns = alerts.length;

            // VIP-04/06/03
            let chain = 0; const upd = window.updateActionButtonsState;
            window.updateActionButtonsState = function () { chain++; return upd.apply(this, arguments); };
            window.showAdminTab('systemControlTab'); await sleep(1200);
            o.vipChainRan = chain > 0;
            document.querySelector('.radar-dot').click(); await sleep(300);
            o.panel = { open: document.getElementById('userActivityPanel').classList.contains('panel-open'),
                name: document.getElementById('uapUserName').textContent, session: document.getElementById('uapStatSession').textContent,
                demoNote: !!document.querySelector('#uapActivityList .uap-demo-note'),
                radarBadge: [...document.querySelectorAll('.vip-card[data-id="widget-godeye"] .badge')].map(b => b.textContent) };
            await window.vipForceLogout(); o.demoTargetRefused = alerts.at(-1)?.[1];
            window.setActiveUser({ name: 'Admin', code: '9999' }); _currentTargetUser = { id: '9999', name: 'Başka', demo: false };
            await window.vipForceLogout(); o.selfTargetRefused = alerts.at(-1)?.[1];
            window.vipCloseUserPanel();
            o.launchpad = { button: !!document.getElementById('vipToggleLaunchpadBtn'), toggle: typeof window.toggleLaunchpadGlobal, flag: localStorage.getItem('launchpadDisabledGlobal') };
            const before = (document.body.innerText.match(/\[God-Eye\][^\n]*az önce/g) || []).length;
            await sleep(16000);
            o.fakeGodEyeLogsIn16s = (document.body.innerText.match(/\[God-Eye\][^\n]*az önce/g) || []).length - before;

            // ADM-04
            const saves = [];
            window.saveData = async (c, items) => { saves.push(JSON.parse(JSON.stringify(items))); window.data[c] = items; return true; };
            window.data.units = [{ id: 'u1', name: 'BT' }];
            window.data.locations = [{ id: 'loc_1', code: 'M-1', unit: 'BT', persons: [{ name: 'A' }, { name: 'B' }, { name: 'C' }], createdAt: 1, extra: 'keep' },
                { id: 'loc_2', code: 'M-2', unit: 'Eski Birim', persons: [], createdAt: 2 }];
            window.openLocationModal('loc_1');
            o.locPrefill = { code: document.getElementById('loc_code').value, badges: document.querySelectorAll('#loc_selectedPersons .badge').length };
            window.removePersonFromLocation('B');
            o.locBadgesAfterRemove = [...document.querySelectorAll('#loc_selectedPersons .badge')].map(b => b.textContent.trim());
            document.getElementById('loc_code').value = 'M-1X';
            await window.saveLocation(new Event('submit'));
            const l1 = saves.at(-1).find(l => l.id === 'loc_1');
            o.locSaved = { count: saves.at(-1).length, code: l1.code, persons: l1.persons.map(p => p.name), extraKept: l1.extra === 'keep', createdAtKept: l1.createdAt === 1 };
            window.openLocationModal('loc_2'); o.locLegacyUnitKept = document.getElementById('loc_unit').value; window.closeLocationModal();

            Object.assign(window.data, { b1: orig.b1, b2: orig.b2, b3: orig.b3, locations: orig.loc, units: orig.units });
            window.isDbAdmin = orig.isDbAdmin; window.saveData = orig.save;
            return o;
        }));
        result.cleanerAudit = audit;
        result.adminPageErrors = errs;
        await admin.browserContext().close();
        return result;
    },

    // Saha bulgusu (screenshot) · workflowTemplates listener race + step-status display.
    // Real read of the existing workflowTemplates doc (proves the onSnapshot no longer dies on permission-denied);
    // step-badge scenario runs on in-memory purchaseOrders data only (nothing written).
    async ebysWorkflowDisplay(page) {
        return page.evaluate(async () => {
            const out = {};

            // 1) Listener race (EBYS-09 saha takibi): must populate window.templates without a permission warning,
            //    for ANY authenticated session (not just admin) — the collection allows read to any authenticated user.
            const warnings = [];
            const origWarn = console.warn;
            console.warn = (...a) => { warnings.push(a.join(' ')); origWarn.apply(console, a); };
            await new Promise(r => setTimeout(r, 300));
            console.warn = origWarn;
            out.templatesLoaded = Array.isArray(window.templates) && window.templates.length > 0;
            out.noPermissionWarning = !warnings.some(w => /workflowTemplates/.test(w));

            // 2) Step display: 2 approved + 1 rejected must NOT all render as rejected (screenshot bug), and each
            //    badge's background must differ from its text color (contrast bug).
            // viewWorkflow always calls fixWorkflowCurrentStep(item, true), which always writes 'purchaseOrders'
            // regardless of whether anything changed — saveData is stubbed so this in-memory scenario writes nothing.
            const origSave = window.saveData;
            window.saveData = async () => true;
            const orig = { po: window.data.purchaseOrders };
            const id = Date.now(); // viewWorkflow/openPurchaseDetail compare with Number(x.id) === Number(id)
            window.data.purchaseOrders = [...(orig.po || []), {
                id, urun: 'FT Ürün', evrakNo: 'SAT-FT', talepEden: 'FT', tarih: '01.01.2026', durum: 'Reddedildi', akis: [],
                workflow: {
                    id: 'wf_' + id, started: true, finished: true, currentStep: 2, currentState: 'cancelled',
                    steps: [
                        { user: 'A', tip: 'Paraf', status: 'approved', date: '01.01.2026' },
                        { user: 'B', tip: 'Paraf', status: 'approved', date: '01.01.2026' },
                        { user: 'C', tip: 'Olur (E-İmza)', status: 'rejected', note: 'x', date: '01.01.2026' },
                    ], history: []
                }
            }];
            await window.viewWorkflow(id);
            const body = document.getElementById('workflowBody');
            const badges = [...body.querySelectorAll('span')]
                .filter(s => ['Onaylandı', 'Reddedildi', 'Bekliyor', 'Sırada', 'Değerlendirilmedi'].includes(s.textContent.trim()))
                .map(s => { const cs = getComputedStyle(s); return { text: s.textContent.trim(), bg: cs.backgroundColor, color: cs.color }; });
            out.stepBadges = badges.map(b => b.text);
            out.badgesContrastOk = badges.length > 0 && badges.every(b => b.bg !== b.color);
            window.closeWorkflowModal();
            window.data.purchaseOrders = orig.po;

            // 3) Purchase modal history (_purWorkflowHTML): no leftover hardcoded hex colors.
            window.data.purchaseOrders = [...(orig.po || []), {
                id, urun: 'FT Ürün', evrakNo: 'SAT-FT', talepEden: 'FT', tarih: '01.01.2026',
                akis: [{ islem: 'Talep Oluşturuldu', yapan: 'FT', tarih: '01.01.2026 10:00:00' }], workflow: { started: false, steps: [] }
            }];
            window.openPurchaseDetail(id, 'view');
            await new Promise(r => setTimeout(r, 100));
            out.purchaseHistoryNoHardcodedHex = !/#1e293b|#94a3b8|#64748b|#f8fafc|#e2e8f0|#e0e7ff/i.test(document.getElementById('purWorkflowSection').innerHTML);
            window.closePurchaseModal();
            window.data.purchaseOrders = orig.po;
            window.saveData = origSave;

            return out;
        });
    },

    // Faz 3 · H1 — saveData v2 (diff writes, counts, bulk-delete lock, strict errors), makeId, listener management.
    // Real writes to 'requests' (staff-writable), all marked; server counts are read back with getDocs.
    async saveDataV2(page) {
        return page.evaluate(async () => {
            const ft = window.__ft, out = {};
            const alerts = []; const realAlert = window.showAppAlert; window.showAppAlert = (m, t) => alerts.push([t, m]);
            const marked = async () => (await ft.readMarked('requests')).length;
            const col = r => r && r.collections && r.collections.requests;
            const base = window.makeId();
            const mk = n => ({ id: base + n, ürün: 'V2 ' + n + ' ' + ft.MARKER, personel: 'V2 ' + ft.MARKER, durum: 'Beklemede', adet: 1, tarih: '01.01.2026' });

            // 1) five new docs -> 5 written; saving the same array again before the snapshot -> 0 (mirror updated)
            const arr = [...(window.data.requests || []), mk(1), mk(2), mk(3), mk(4), mk(5)];
            const r1 = await window.saveData('requests', arr);
            const r1b = await window.saveData('requests', arr);
            out.create = { written: col(r1)?.written, deleted: col(r1)?.deleted, resaveBeforeSnapshot: col(r1b)?.written };
            await ft.waitFor(async () => (await marked()) === 5 && window.data.requests.filter(r => String(r.ürün).includes(ft.MARKER)).length === 5);

            // 2) editing one doc -> exactly 1 write, everything else unchanged
            const total = window.data.requests.length;
            const r2 = await window.saveData('requests', window.data.requests.map(r => r.id === base + 3 ? { ...r, adet: 7 } : r));
            out.editOne = { written: col(r2)?.written, deleted: col(r2)?.deleted, unchanged: col(r2)?.unchanged, total };
            await ft.waitFor(async () => (await ft.readMarked('requests')).some(r => r.id === base + 3 && r.adet === 7));

            // 3) no change -> no write at all
            await ft.waitFor(async () => window.data.requests.some(r => r.id === base + 3 && r.adet === 7));
            const r3 = await window.saveData('requests', window.data.requests);
            out.noChange = { written: r3.written, deleted: r3.deleted };

            // 4) single delete is always allowed
            const r4 = await window.saveData('requests', window.data.requests.filter(r => r.id !== base + 5));
            out.singleDelete = { deleted: col(r4)?.deleted };
            await ft.waitFor(async () => (await marked()) === 4 && !window.data.requests.some(r => r.id === base + 5));

            // 5) bulk delete (3 of the collection) is blocked without the flag; nothing is written
            const toDrop = new Set([base + 1, base + 2, base + 4]);
            const before = await marked();
            const r5 = await window.saveData('requests', window.data.requests.filter(r => !toDrop.has(r.id)));
            await ft.sleep(1200);
            out.bulkBlocked = { result: r5, markedBefore: before, markedAfter: await marked(), alert: alerts.at(-1)?.[1] };
            let strictBulk = null;
            try { await window.saveData('requests', window.data.requests.filter(r => !toDrop.has(r.id)), { strict: true }); }
            catch (e) { strictBulk = { name: e.name, code: e.code, deletes: e.details?.deletes }; }
            out.bulkBlockedStrict = strictBulk;

            // 6) the same bulk delete with the explicit flag goes through
            const r6 = await window.saveData('requests', window.data.requests.filter(r => !toDrop.has(r.id)), { allowBulkDelete: true });
            out.bulkAllowed = { deleted: col(r6)?.deleted };
            await ft.waitFor(async () => (await marked()) === 1);
            out.markedLeft = await marked();

            // 7) unknown collection / no session: false by default, SaveDataError in strict mode
            out.unknownDefault = await window.saveData('archive', []);
            try { await window.saveData('archive', [], { strict: true }); out.unknownStrict = 'no throw'; }
            catch (e) { out.unknownStrict = e.code; }
            const realAuth = window.userAuth; window.userAuth = null;
            out.noAuthDefault = await window.saveData('requests', window.data.requests);
            try { await window.saveData('requests', window.data.requests, { strict: true }); out.noAuthStrict = 'no throw'; }
            catch (e) { out.noAuthStrict = e.code; }
            window.userAuth = realAuth;

            // 8) makeId: unique, strictly increasing, numeric, safe
            const ids = Array.from({ length: 5000 }, () => window.makeId());
            out.makeId = { unique: new Set(ids).size === ids.length, increasing: ids.every((v, i) => i === 0 || v > ids[i - 1]), safe: ids.every(Number.isSafeInteger) };

            // 9) listener management: template listener is managed, stop/start works, permission banner shows and clears
            const h0 = window.getSyncHealth();
            out.listeners = { running: h0.running, extra: h0.extra, templatesLoaded: (window.templates || []).length > 0 };
            out.authReady = !!(await Promise.race([window.whenAuthReady(), ft.sleep(3000).then(() => null)]));
            window.stopRealtimeSync();
            out.afterStop = window.getSyncHealth().running;
            window.templates = [];
            window.startRealtimeSync();
            await ft.waitFor(async () => (window.templates || []).length > 0, 8000);
            out.afterRestart = { running: window.getSyncHealth().running, templatesReloaded: (window.templates || []).length > 0 };
            window.reportListenerError('b1', { code: 'permission-denied' });
            out.bannerShown = !!document.getElementById('syncPermissionBanner') && window.getSyncHealth().denied.includes('b1');
            window.stopRealtimeSync(); window.startRealtimeSync();
            await ft.sleep(1500);
            out.bannerCleared = !document.getElementById('syncPermissionBanner') && window.getSyncHealth().denied.length === 0;
            window.userAuth = null;
            window.reportListenerError('b2', { code: 'permission-denied' });
            out.ignoredWithoutSession = window.getSyncHealth().denied.length === 0;
            window.userAuth = realAuth;

            window.showAppAlert = realAlert;
            return out;
        });
    },

    // Faz 3 · H2 — single-document API. Real, marked writes to 'requests' and 'tasks' (staff-writable).
    // Atomicity: a batch that also touches b1 (admin-only) must be rejected as a whole.
    async itemApi(page) {
        return page.evaluate(async () => {
            const ft = window.__ft, out = {};
            const srv = async (col, id) => (await ft.readAll(col)).find(d => String(d.id) === String(id));
            const r = { ürün: 'API ' + ft.MARKER, personel: 'API ' + ft.MARKER, durum: 'Beklemede', adet: 1, extra: 'x' };

            const a = await window.appendItem('requests', { ...r });
            const id = a.ids[0];
            out.append = { written: a.written, idIsSafeInt: Number.isSafeInteger(Number(id)), local: !!window.findItem('requests', id), server: !!(await srv('requests', id)) };
            out.duplicate = await window.appendItem('requests', { ...r, id }).catch(e => e.code);
            let dupStrict = null; try { await window.appendItem('requests', { ...r, id }, { strict: true }); } catch (e) { dupStrict = e.code; }
            out.duplicateStrict = dupStrict;

            // update: only the given field changes, others stay
            await window.updateItem('requests', id, { adet: 4, __index: 9 });
            const u = await srv('requests', id);
            out.update = { adet: u.adet, extraKept: u.extra === 'x', noRenderField: !('__index' in u) };
            let nf = null; try { await window.updateItem('requests', 'nope_' + id, { adet: 1 }, { strict: true }); } catch (e) { nf = e.code; }
            out.updateMissing = nf;

            // upsert = full document: a field removed from the item disappears in Firestore (no stale merge)
            const cur = { ...window.findItem('requests', id) }; delete cur.extra;
            await window.upsertItem('requests', cur);
            out.upsertDropsField = !('extra' in (await srv('requests', id)));

            // atomic multi-collection batch: requests + tasks together
            const tid = 'task_api_' + Date.now();
            const m = await window.applyItemOps([
                { op: 'update', col: 'requests', id, fields: { durum: 'draft' } },
                { op: 'set', col: 'tasks', item: { id: tid, title: 'API ' + ft.MARKER, status: 'pending', type: 'task', assigneeId: 'pool' } },
            ]);
            out.multi = { written: m.written, req: (await srv('requests', id)).durum, task: !!(await srv('tasks', tid)) };

            // atomicity: same batch plus an admin-only b1 write -> nothing is applied
            const b1 = (window.data.b1 || [])[0];
            const bad = await window.applyItemOps([
                { op: 'update', col: 'requests', id, fields: { durum: 'SHOULD_NOT_APPLY' } },
                { op: 'update', col: 'b1', id: b1.id, fields: { açıklama: b1.açıklama || '' } },
            ]);
            await ft.sleep(800);
            out.atomicReject = { result: bad, requestUnchanged: (await srv('requests', id)).durum === 'draft', localUnchanged: window.findItem('requests', id).durum === 'draft' };

            // remove / bulkRemove
            const extra = [];
            for (let i = 0; i < 3; i++) extra.push((await window.appendItem('requests', { ...r, n: i })).ids[0]);
            const br = await window.bulkRemove('requests', extra);
            const rm = await window.removeItem('tasks', tid);
            await ft.sleep(500);
            out.remove = { bulkDeleted: br.deleted, taskGone: !(await srv('tasks', tid)), bulkGone: (await Promise.all(extra.map(x => srv('requests', x)))).every(x => !x) };
            out.unknownCol = await window.upsertItem('archive', { id: 1 });
            return out;
        });
    },

    // Faz 3 · H2 — DATA-06: every product/b3 action targets the id, even after the array shifts under it
    // (a record prepended between selection and action, as a snapshot from another device would do).
    // b1/b2/b3 are admin-only: the write API functions are recorded stubs; nothing is written.
    async idBasedProductOps(page) {
        return page.evaluate(async () => {
            const out = {}, ops = [];
            const orig = { b1: window.data.b1, b2: window.data.b2, b3: window.data.b3, admin: window.checkIsAdmin, val: window.validateAdminAction,
                confirm: window.showCustomConfirm, alert: window.showAppAlert, tx: window.runStockTransaction,
                api: ['applyItemOps', 'upsertItem', 'appendItem', 'updateItem', 'updateItems', 'removeItem', 'bulkRemove'].map(k => [k, window[k]]) };
            ['applyItemOps', 'upsertItem', 'appendItem', 'updateItem', 'updateItems', 'removeItem', 'bulkRemove'].forEach(k => {
                window[k] = async (...args) => { ops.push([k, JSON.parse(JSON.stringify(args))]); return { written: 1, deleted: 0, ids: ['stub'] }; };
            });
            window.checkIsAdmin = () => true; window.validateAdminAction = () => true;
            window.showCustomConfirm = async () => true;
            const alerts = []; window.showAppAlert = (m, t) => alerts.push([t, m]);
            const tx = []; window.runStockTransaction = async (c, id, d) => { tx.push([c, id, d]); return { before: 5, after: 5 + d }; };
            const P = (id, name, extra) => ({ id, ürün: name, raf: 'R', sütun: 'S', adet: 5, durumu: 'Kullanıma Hazır', tür: 'Laptop', ...extra });
            const shift = () => window.data.b1.unshift(P('b1_new_' + Math.random(), 'SONRADAN EKLENEN'));
            const last = () => ops.at(-1);

            window.data.b1 = [P('b1_A', 'A'), P('b1_B', 'B', { limit: 3 }), P('b1_C', 'C')];
            window.data.b2 = [];
            window.switchTab && window.switchTab('b1');
            window.renderTable('b1');
            const row = () => document.querySelector('tr[data-depo="b1"][data-id="b1_B"]');
            out.rowRendered = !!row();

            // FAB delete after the array shifted
            window.clearRowSelection(); row().click();
            shift();
            document.querySelector('.fab-btn-del')?.click(); await new Promise(r => setTimeout(r, 50));
            out.fabDelete = last();

            // FAB watch
            window.renderTable('b1'); window.clearRowSelection(); row().click(); shift();
            document.querySelector('.fab-btn-watch')?.click(); await new Promise(r => setTimeout(r, 50));
            out.fabWatch = last();

            // edit: only the form fields go to that one document
            window.openProductModal('edit', 'b1_B', 'b1'); shift();
            document.getElementById('prodName').value = 'B (düz.)';
            await window.saveProduct(new Event('submit'));
            out.edit = { op: last()[0], col: last()[1][0], id: last()[1][1], name: last()[1][2].ürün, keepsLimitUntouched: !('limit' in last()[1][2]) };

            // bulk "pasife al" via checkboxes (data-id)
            window.renderTable('b1');
            document.querySelectorAll('#tableB1 .row-select').forEach(cb => { cb.checked = ['b1_A', 'b1_C'].includes(cb.dataset.id); });
            shift();
            await window.bulkDelete('b1');
            out.bulkPassive = last()[0] === 'updateItems' ? last()[1][1].map(x => x.id + ':' + x.fields.durumu) : last();

            // exit: selection -> shift -> submit -> stock + b3 entry for B
            window.openExitModal('b1', 'b1_B'); shift();
            document.getElementById('exitQty').value = '2';
            await window.saveExit(new Event('submit'));
            out.exit = { tx: tx.at(-1), b3: last()[0] === 'appendItem' ? { col: last()[1][0], productId: last()[1][1].productId, adet: last()[1][1].adet } : last() };

            // internal transfer: one atomic op list (set target + delete source)
            window.openTransferModal('b1', 'b1_B'); shift();
            const t = document.getElementById('transTarget');
            const internal = [...t.options].find(o => { try { return JSON.parse(o.value).type === 'internal'; } catch (e) { return false; } });
            if (internal) { t.value = internal.value; window.handleTransferTargetChange(t); }
            await window.confirmTransfer();
            out.transfer = last()[0] === 'applyItemOps' ? last()[1][0].map(o => `${o.op}:${o.col}:${o.id || o.item.id}`) : { last: last(), hadInternal: !!internal };

            // multi-select bulk delete -> bulkRemove by ids
            await window._bulkDeleteSelected('b1', ['b1_A', 'b1_C']);
            out.bulkRemove = last();

            // b3 row delete by id
            window.data.b3 = [{ id: 11, urunAciklama: 'X' }, { id: 22, urunAciklama: 'Y' }];
            await window.deleteB3Row(22);
            out.b3Delete = last();

            Object.assign(window.data, { b1: orig.b1, b2: orig.b2, b3: orig.b3 });
            orig.api.forEach(([k, f]) => { window[k] = f; });
            Object.assign(window, { checkIsAdmin: orig.admin, validateAdminAction: orig.val, showCustomConfirm: orig.confirm, showAppAlert: orig.alert, runStockTransaction: orig.tx });
            window.clearRowSelection(); window.closeProductModal?.(); window.closeExitModal?.(); window.closeTransferModal?.();
            window.renderTable('b1');
            out.alerts = alerts.filter(a => a[0] === 'error');
            return out;
        });
    },

    // D3 · RULE-04 / VIP-05 — system_config is environment-scoped. No VIP action is triggered (rule 7.5).
    async systemConfigScope(page) {
        return page.evaluate(async () => {
            const fs = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
            const tryOp = async fn => { try { await fn(); return 'ALLOWED'; } catch (e) { return e.code || e.message; } };
            const ref = window.systemConfigRef('admin_settings');
            return {
                settingsPath: ref.path,
                messagesPath: window.systemConfigRef('admin_messages').path,
                readScoped: await tryOp(() => fs.getDoc(ref)),
                staffWriteScoped: await tryOp(() => fs.setDoc(window.systemConfigRef('flowtest_probe'), { x: 1 })),
                readLegacyRoot: await tryOp(() => fs.getDoc(fs.doc(window.fireDb, 'system_config', 'admin_settings'))),
            };
        });
    },

    // C6 · SEC-01 — payloads written by an anonymous (staff) session must not execute in admin.html
    async xssAdminPanel(page, browser) {
        const ids = await page.evaluate(async () => {
            const ft = window.__ft, P = '<img src=x onerror="window.__xss=(window.__xss||0)+1">';
            const reqId = Date.now(), poId = '1);window.__xssId=1;//' + ft.MARKER;
            await window.saveData('requests', [...(window.data.requests || []), { id: reqId, ürün: P, personel: 'X ' + ft.MARKER, not: P, durum: 'Beklemede', tarih: '01.01.2026', adet: 1 }]);
            await window.saveData('tasks', [...(window.data.tasks || []), { id: 'task_' + reqId, title: P + ft.MARKER, description: P, priority: P, type: 'task', status: 'pending', assigneeId: 'pool', checklist: [{ text: P, done: false }], interactions: [{ user: P, message: P }] }]);
            await window.saveData('purchaseOrders', [...(window.data.purchaseOrders || []), { id: poId, urun: P + ft.MARKER, evrakNo: P, talepEden: P, birim: P, tarih: P, durum: 'Taslak', akis: [] }]);
            await ft.waitFor(async () => (await ft.readMarked('requests')).length && (await ft.readMarked('tasks')).length && (await ft.readMarked('purchaseOrders')).length);
            return { reqId, poId };
        });

        const admin = await (await browser.createBrowserContext()).newPage();
        const errs = [];
        admin.on('pageerror', e => errs.push(e.message));
        await admin.evaluateOnNewDocument(() => localStorage.setItem('admin_auth', JSON.stringify({ expiry: Date.now() + 600000 })));
        await admin.goto(page.url().replace('index.html', 'admin.html'), { waitUntil: 'domcontentloaded' });
        await new Promise(r => setTimeout(r, 9000));
        const out = await admin.evaluate(async (poId) => {
            const tryCall = n => { try { if (typeof window[n] === 'function') window[n](); return 'ok'; } catch (e) { return 'err: ' + e.message; } };
            const renders = ['renderAdminRequestTable', 'renderTodoTab', 'renderPurchaseModule', 'renderAdminPurchaseTable', 'renderServicesModule'].map(n => [n, tryCall(n)]);
            await new Promise(r => setTimeout(r, 1000));
            const reqBody = document.getElementById('adminPendingRequestsBody');
            const btn = [...document.querySelectorAll('button[onclick*="openPurchaseDetail"]')].find(b => b.getAttribute('onclick').includes('__xssId'));
            let clicked = 'no button rendered';
            if (btn) { try { btn.click(); clicked = 'clicked'; } catch (e) { clicked = 'click error: ' + e.message; } }
            await new Promise(r => setTimeout(r, 500));
            return {
                renders: Object.fromEntries(renders),
                xssExecuted: window.__xss || 0,
                idInjectionExecuted: window.__xssId || 0,
                payloadShownAsText: !!reqBody && reqBody.textContent.includes('<img src=x'),
                injectedImgElements: document.querySelectorAll('img[src="x"]').length,
                purchaseButton: clicked,
            };
        }, ids.poId);
        out.adminPageErrors = errs;
        await admin.browserContext().close();
        return out;
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
                await page.evaluate(() => window.__ft.cleanup(['requests', 'tasks', 'purchaseOrders', 'assignments', 'serviceRecords']));
                await new Promise(r => setTimeout(r, 1500));
                console.log(`\n=== ${name} ===\n` + JSON.stringify(await SCENARIOS[name](page, browser), null, 1));
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
