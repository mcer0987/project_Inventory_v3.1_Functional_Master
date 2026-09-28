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

            await window.withdrawInventoryRequest(idx());
            out.withdraw = await ft.waitFor(async () => (await durum()) === 'draft') ? 'draft ✔' : await durum();

            await window.sendDraftInventoryRequest(idx());
            out.sendDraft = await ft.waitFor(async () => (await durum()) === 'Beklemede') ? 'Beklemede ✔' : await durum();

            // simulate admin approval on the request only (staff may write requests)
            window.data.requests[idx()].durum = 'approved';
            await window.saveData('requests', window.data.requests);
            await ft.waitFor(async () => (await durum()) === 'approved');

            const b3Before = (await ft.readAll('b3')).length;
            await window.receiveProduct(idx());
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

            form.requestSubmit();
            out.saved = await ft.waitFor(async () => (await ft.readMarked('purchaseOrders')).length === 1);
            await ft.waitFor(async () => document.getElementById('purchaseModal').style.display === 'none'); // save flow finished (form reset done)
            const [po] = await ft.readMarked('purchaseOrders');
            out.savedFields = po && { tur: po.tur, birim: po.birim };

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
