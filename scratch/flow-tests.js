// [WHY]: Faz 2 yazma akışlarını gerçek Firestore'a karşı, yalnız inventory_demo'da ve kendi kendini temizleyerek doğrulamak.
// [HOW]: Repo 127.0.0.1'de servis edilir (→ inventory_demo); başka kök görülürse durur. Test kayıtları MARKER ile etiketlenir,
//        koşudan önce ve sonra silinir. Anonim (personel) oturumla yazılabilen koleksiyonlar test edilir.
// Usage: node scratch/flow-tests.js [scenarioName ...] [--emu] [--headed]
//        --headed: test Chrome'u ekranda açılır (F12 ile konsol izlenebilir; pencereye tıklamak testi bozabilir).
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const CSP = require('./csp');   // Faz 4 · J5 (M15): firebase.json başlıkları HTML yanıtlarına; ihlaller report-uri ile toplanır

const ROOT = path.resolve(__dirname, '..');
const PORT = 5594;
const MARKER = '__flowtest__';
// Faz 4 · J0: --emu → uygulama yerel emülatöre bağlanır (?emu=1). Önce `npm run emu` + `npm run emu:seed`.
const EMU = process.argv.includes('--emu');
const HEADED = process.argv.includes('--headed');
// Yalnız emülatör Auth'unda geçerli sahte admin parolası (scratch/emu-seed.mjs ile aynı; gerçek parola DEĞİLDİR; ≥12 karakter).
const EMU_ADMIN_CODE = 'emu-yonetici-0001';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

const csp = CSP.createCollector();
const SEC_HEADERS = CSP.testHeaders({ emu: EMU });
function startServer() {
    const server = http.createServer((req, res) => {
        if (csp.handle(req, res)) return;
        const file = path.normalize(path.join(ROOT, decodeURIComponent(req.url.split('?')[0])));
        if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', ...(path.extname(file) === '.html' ? SEC_HEADERS : {}) });
        fs.createReadStream(file).pipe(res);
    });
    return new Promise(r => server.listen(PORT, '127.0.0.1', () => r(server)));
}

// Runs inside the page. Helpers are exposed on window.__ft.
async function installHelpers(page) {
    await page.evaluate(async (MARKER, EMU, EMU_ADMIN_CODE) => {
        if (window.COLLECTION_ROOT !== 'inventory_demo') throw new Error('ABORT: COLLECTION_ROOT=' + window.COLLECTION_ROOT);
        if (EMU && !(window.AppEnv && window.AppEnv.EMULATOR)) throw new Error('ABORT: --emu verildi ama sayfa emülatöre bağlanmadı');
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
            emulator: !!(window.AppEnv && window.AppEnv.EMULATOR),
            // Gerçek Firebase admin oturumu — yalnız emülatörde (gerçek projede admin kimlik bilgisi betiklere girmez, §7.5).
            async adminLogin() {
                if (!this.emulator) throw new Error('adminLogin yalnız emülatör modunda');
                if (!(await window.SecurityConfig.authenticate(EMU_ADMIN_CODE))) throw new Error('emülatör admin girişi başarısız (npm run emu:seed?)');
                return this.waitFor(async () => window.isDbAdmin(), 8000);
            },
            async backToAnonymous() {
                await window.SecurityConfig.logout();
                return this.waitFor(async () => !!(window.userAuth && window.userAuth.isAnonymous), 8000);
            },
            // Faz 4 · J1: yönetici işlemi. Emülatörde gerçek admin oturumu (Rules v2 yüklü); gerçek demoda yayındaki eski
            // kurallar anonim yazmaya izin verdiği için yalnız istemci kapısı (isDbAdmin) taklit edilir.
            async asAdmin(fn) {
                if (this.emulator) {
                    await this.adminLogin();
                    try { return await fn(); } finally { await this.backToAnonymous(); }
                }
                const real = window.isDbAdmin; window.isDbAdmin = () => true;
                try { return await fn(); } finally { window.isDbAdmin = real; }
            },
        };
        // Faz 4 kapanışı: Rules v2 gerçek projede de yayında mı? (eski kök /system_config bloğu yalnız eski kurallarda vardı).
        // Deploy'dan sonra "gerçek demo" modu artık eski kuralları varsayamaz; kurala bağlı beklentiler bu bayrağa göre dallanır.
        window.__ft.rulesV2 = EMU || await fs.getDoc(fs.doc(window.fireDb, 'system_config', 'admin_settings')).then(() => false, e => e.code === 'permission-denied');
        // Faz 4 · J4: denetim günlüğü kalıcıdır ve kural gereği silinemez → gerçek demoda test kaydı YAZILMAZ; çağrılar bellekte
        // toplanır (alanlar yine sınanır). Emülatörde gerçek yazılır ve admin olarak geri okunur.
        if (!EMU) {
            window.__auditStub = [];
            window.__ft.realAppendAuditLog = window.appendAuditLog;
            window.appendAuditLog = async e => { window.__auditStub.push(JSON.parse(JSON.stringify(e))); return { ok: true, id: 'stub' }; };
        }
    }, MARKER, EMU, EMU_ADMIN_CODE);
}

// Faz 5 · K2 (5.8 · B1/B2 şema sözleşmesi) — b1WriteContract/b2WriteContract'ın içinde page.evaluate(fn, repo) ile
// çalışır (bkz. b3WriteContract deseni). saveProduct (ekleme/düzenleme), confirmTransfer'ın internal (tam + kısmi,
// INV-06) ve scrap (hurda, 5.10) kollarını GERÇEK UI fonksiyonlarıyla sürer; yalnız atomik yazıcılar (appendItem,
// updateItem, applyItemOps, runStockOps) yakalayıcıyla değiştirilir, Firestore'a gitmez. Üretilen her b1/b2/b3 kaydı
// Schema.validateB1/validateB2/validateB3'ten geçirilip özetlenir.
async function _stockContractBody(repo) {
    const other = repo === 'b1' ? 'b2' : 'b1';
    const demirbasType = repo === 'b2';   // b1 örneği sarf, b2 örneği demirbaş — iki kol da ayrı ayrı kanıtlanır
    const orig = {
        items: window.data[repo], otherItems: window.data[other], personel: window.data.personel, service: window.data.serviceRecords,
        append: window.appendItem, update: window.updateItem, apply: window.applyItemOps, ops: window.runStockOps,
        adm: window.isDbAdmin, chk: window.checkIsAdmin, valid: window.validateAdminAction,
        alert: window.showAppAlert, confirm: window.showCustomConfirm,
    };
    window.isDbAdmin = () => true; window.checkIsAdmin = () => true; window.validateAdminAction = () => true;
    window.showAppAlert = () => {}; window.showCustomConfirm = async () => true;

    // 'stock' ayrı tutulur: runStockOps'un stok deltası (ör. scrap/hurda) {op,col,...} şeklinde bir 'write' değildir —
    // writes dizisinden ayrı, doğrudan {col,id,delta} olarak gelir (bkz. confirmTransfer'ın scrap kolu).
    const captured = { b1: [], b2: [], b3: [], serviceRecords: [], stock: [] };
    const capture = ops => (ops || []).forEach(o => { if (captured[o.col]) captured[o.col].push(o); });
    window.appendItem = async (col, item) => { capture([{ op: 'set', col, item }]); return { written: 1, ids: [item && item.id] }; };
    window.updateItem = async (col, id, fields) => { capture([{ op: 'update', col, id, fields }]); return { written: 1, ids: [id] }; };
    window.applyItemOps = async ops => { capture(ops); return { written: (ops || []).length, ids: (ops || []).map(o => (o.item && o.item.id) || o.id) }; };
    window.runStockOps = async arg => {
        capture(arg.writes || []);
        captured.stock.push(...(arg.stock || []));
        return { stock: (arg.stock || []).map(s => ({ col: s.col, id: s.id, name: s.id, before: 9, after: 9 + (s.delta || 0) })) };
    };
    const takeAll = () => {
        const snap = { b1: [...captured.b1], b2: [...captured.b2], b3: [...captured.b3], serviceRecords: [...captured.serviceRecords], stock: [...captured.stock] };
        captured.b1 = []; captured.b2 = []; captured.b3 = []; captured.serviceRecords = []; captured.stock = [];
        return snap;
    };

    const baseItem = (id, adet) => {
        const it = {
            id, sütun: 'S-1', raf: 'R-1', tür: demirbasType ? 'Dizüstü Bilgisayar' : 'Kablo',
            ürün: demirbasType ? 'Test Laptop' : 'Test Kablo', marka: 'Acme', adet,
            durumu: 'Kullanıma Hazır', açıklama: '', isDemirbas: demirbasType, lastUpdate: Date.now(),
        };
        if (repo === 'b2') it.status = 'Kullanıma Hazır';
        return it;
    };
    window.data[repo] = [baseItem(`${repo}_src1`, 10), baseItem(`${repo}_src2`, 1)];
    window.data[other] = [];
    window.data.personel = [];
    // b1 (sarf, kimliksiz): productId eşleşmesi yeter, kapanmalı. b2 (demirbaş): checkDeviceIds zaten "serviste olan
    // cihaz tekrar çıkışa verilemez" dediği için scrap formuna GİRİLECEK SN'le aynı açık kayıt asla oluşamaz — burada
    // kasıtlı olarak İLGİSİZ bir SN'le (aynı ürün hattının başka bir birimi) seçiciliği kanıtlanır: kapanmamalı.
    window.data.serviceRecords = [{ id: 'svc_k2', kapandi: false, productId: `${repo}_src1`, sn: demirbasType ? 'OTHER-SN-999' : '-', envanterNo: '-', gecmis: [] }];

    const o = {};
    try {
        // 1) saveProduct — yeni kayıt (appendItem → 'set')
        const form = document.getElementById('productForm');
        form.dataset.editRepo = repo; form.dataset.editId = '';
        ['prodColumn', 'prodShelf'].forEach(id => { document.getElementById(id).innerHTML = '<option>S-1</option>'; document.getElementById(id).value = 'S-1'; });
        document.getElementById('prodType').innerHTML = `<option value="${demirbasType ? 'Dizüstü Bilgisayar' : 'Kablo'}">x</option>`;
        document.getElementById('prodType').value = demirbasType ? 'Dizüstü Bilgisayar' : 'Kablo';
        document.getElementById('prodName').value = 'Yeni Ürün ' + repo;
        document.getElementById('prodBrand').value = 'Acme';
        document.getElementById('prodQty').value = '4';
        document.getElementById('prodStatus').value = 'Kullanıma Hazır';
        document.getElementById('prodDesc').value = '';
        document.getElementById('isDemirbas').checked = demirbasType;
        await window.saveProduct(new Event('submit'));
        o.addNew = takeAll()[repo];

        // 2) saveProduct — var olan kaydı düzenleme (updateItem → 'update', yalnız bilinen alan adı denetlenir)
        form.dataset.editId = `${repo}_src1`;
        document.getElementById('prodQty').value = '11';
        await window.saveProduct(new Event('submit'));
        o.editExisting = takeAll()[repo];
        form.dataset.editId = '';

        // 3) confirmTransfer — internal TAM taşıma (adet = stok tamamı): eski davranış korunur (id hedefte aynen yaşar)
        window.openTransferModal(repo, `${repo}_src2`);
        document.getElementById('transTarget').value = JSON.stringify({ name: other.toUpperCase() + ' Depo', type: 'internal', key: other });
        window.handleTransferTargetChange({ value: document.getElementById('transTarget').value });
        document.getElementById('transNewCol').value = 'S-2'; document.getElementById('transNewShelf').value = 'R-2';
        document.getElementById('transQty').value = '1';
        document.getElementById('transNote').value = 'tam taşıma testi';
        await window.confirmTransfer();
        o.internalFullMove = takeAll();

        // 4) confirmTransfer — internal KISMİ taşıma (adet < stok, Faz 5 · K2 · INV-06): kaynakta update, hedefte YENİ id
        window.openTransferModal(repo, `${repo}_src1`);
        document.getElementById('transTarget').value = JSON.stringify({ name: other.toUpperCase() + ' Depo', type: 'internal', key: other });
        window.handleTransferTargetChange({ value: document.getElementById('transTarget').value });
        document.getElementById('transNewCol').value = 'S-3'; document.getElementById('transNewShelf').value = 'R-3';
        document.getElementById('transQty').value = '4';
        document.getElementById('transNote').value = 'kısmi taşıma testi';
        await window.confirmTransfer();
        o.internalPartial = takeAll();

        // 5) confirmTransfer — scrap/hurda (Faz 5 · K2 · 5.10): kalan stoktan kısmi adet, b3 'hurda' kaydı, açık servis kaydı kapanır
        const remainingId = `${repo}_src1`;
        const remainingQty = (window.data[repo].find(x => x.id === remainingId) || {}).adet || 1;
        const scrapQty = Math.min(2, remainingQty);
        window.openTransferModal(repo, remainingId);
        document.getElementById('transTarget').value = JSON.stringify({ name: 'Hurda / Atık', type: 'scrap' });
        window.handleTransferTargetChange({ value: document.getElementById('transTarget').value });
        document.getElementById('transQty').value = String(scrapQty);
        window.syncTransferDevices();
        if (demirbasType) {
            [...document.querySelectorAll('#transDeviceIds .dev-ids-row')].forEach((row, i) => { row.querySelector('.dev-sn').value = 'K2HRD-' + i; });
        }
        document.getElementById('transNote').value = 'arızalı, hurdaya ayrıldı (K2 testi)';
        await window.confirmTransfer();
        o.scrap = takeAll();
    } finally {
        Object.assign(window, {
            appendItem: orig.append, updateItem: orig.update, applyItemOps: orig.apply, runStockOps: orig.ops,
            isDbAdmin: orig.adm, checkIsAdmin: orig.chk, validateAdminAction: orig.valid, showAppAlert: orig.alert, showCustomConfirm: orig.confirm,
        });
        window.data[repo] = orig.items; window.data[other] = orig.otherItems; window.data.personel = orig.personel; window.data.serviceRecords = orig.service;
    }

    const S = window.Schema;
    const validator = repo === 'b1' ? S.validateB1 : S.validateB2;
    const otherValidator = other === 'b1' ? S.validateB1 : S.validateB2;
    const KEYS = repo === 'b1' ? S.B1_KEYS : S.B2_KEYS;
    const errorsOf = (list, v) => list.map(w => v(w.op === 'set' ? w.item : w.fields)).flat();
    const knownKeysOnly = list => list.every(w => Object.keys(w.op === 'set' ? w.item : w.fields).every(k => KEYS.includes(k)));

    return {
        addNew: { ops: o.addNew.map(w => w.op), errors: errorsOf(o.addNew, validator), exactKeys: o.addNew.every(w => Object.keys(w.item).sort().join(',') === [...KEYS].sort().join(',')) },
        editExisting: { ops: o.editExisting.map(w => w.op), knownKeysOnly: knownKeysOnly(o.editExisting) },
        internalFullMove: {
            sourceOps: o.internalFullMove[repo].map(w => w.op),
            targetErrors: o.internalFullMove[other].filter(w => w.op === 'set').map(w => otherValidator(w.item)).flat(),
            sameId: (o.internalFullMove[other][0] || {}).item && o.internalFullMove[other][0].item.id === `${repo}_src2`,
        },
        internalPartial: {
            sourceOp: (o.internalPartial[repo][0] || {}).op,
            sourceFieldsKnownOnly: o.internalPartial[repo].every(w => Object.keys(w.fields || {}).every(k => KEYS.includes(k))),
            targetErrors: o.internalPartial[other].filter(w => w.op === 'set').map(w => otherValidator(w.item)).flat(),
            newIdDiffers: !!(o.internalPartial[other][0] || {}).item && o.internalPartial[other][0].item.id !== `${repo}_src1`,
        },
        scrap: {
            // Hurda stoğu applyItemOps'un 'writes' dizisiyle değil runStockOps'un ayrı 'stock' deltasıyla düşer (bkz. confirmTransfer).
            stockDelta: (o.scrap.stock[0] || {}),
            b3Count: o.scrap.b3.length,
            b3Errors: o.scrap.b3.map(w => S.validateB3(w.item)).flat(),
            b3Tips: [...new Set(o.scrap.b3.map(w => w.item.tip))],
            serviceClosed: o.scrap.serviceRecords.length > 0 && o.scrap.serviceRecords.every(w => w.op === 'update' && w.fields.kapandi === true),
        },
    };
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
            const realSave = window.saveData, realModal = window.showRequestApprovalModal, realApply = window.applyItemOps; let b3Attempts = 0;
            // H3: approval = one atomic batch (requests update + b3 set). b3 is admin-only: record the b3 part, write the rest for real.
            window.applyItemOps = async (ops, o) => { const rest = ops.filter(x => x.col !== 'b3'); b3Attempts += ops.length - rest.length; return rest.length ? realApply(rest, o) : { written: 0 }; };
            window.showCustomConfirm = async () => true;
            window.setActiveUser({ name: 'Yönetici Test' });
            // J4 (T6): confirmRequest kendi içinde yönetici kapılı; talep yazmaları personel oturumunda da serbest (kural), b3 kayıtlı.
            const realIsAdmin = window.isDbAdmin; window.isDbAdmin = () => true;

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
            window.isDbAdmin = realIsAdmin;   // personel kendi talebi: gerçek kapı (J4: engel + 'blocked' günlüğü)
            await window.confirmRequest(base + 2);
            await ft.sleep(800);
            out.selfApprovalBlocked = (await db(2)).durum === 'Beklemede';
            window.isDbAdmin = () => true;

            window.setActiveUser({ name: 'Yönetici Test' });
            await window.rejectRequest(base + 2);
            await ft.waitFor(async () => (await db(2)).durum === 'rejected');
            out.rejected = { durum: (await db(2)).durum, rejectedBy: (await db(2)).rejectedBy };

            await ft.waitFor(async () => window.data.requests.find(r => r.id === base + 2)?.durum === 'rejected');
            // asAdmin gerçek giriş/çıkış yapar (emülatör): yamalı isDbAdmin açıkken yapılırsa çıkıştaki anonim oturum checkAuth'ta
            // "bayat admin" sayılıp tekrar tekrar kapatılır (J3 · M9) — önce gerçek kapı geri konur.
            window.isDbAdmin = realIsAdmin;
            await ft.asAdmin(() => window.deleteRequest(base + 2));   // J1: talep silme yalnız admin
            out.deletedById =await ft.waitFor(async () => !(await db(2)) && !!(await db(1)) && !!(await db(3)));
            window.saveData = realSave; window.showRequestApprovalModal = realModal; window.applyItemOps = realApply; window.isDbAdmin = realIsAdmin;
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

            const tx = [], b3 = []; let failB3 = false, stockFails = false, txCalls = 0;
            const realAlert = window.showAppAlert, realOps = window.runStockOps, realApply = window.applyItemOps, realSave = window.saveData;
            // Atomic stand-in: b3/stock parts are admin-only → recorded; the requests part is written for real — but only if
            // nothing fails (all or nothing), exactly like the single Firestore transaction.
            const atomic = async (stock, writes) => {
                txCalls++;
                if (stockFails) throw new window.SaveDataError('insufficient-stock', 'Yetersiz stok!');
                if (failB3 && writes.some(w => w.col === 'b3')) throw new window.SaveDataError('write-failed', 'b3 yazılamadı');
                const rest = writes.filter(w => w.col !== 'b3');
                if (rest.length) await realApply(rest);
                writes.filter(w => w.col === 'b3').forEach(w => b3.push(w.item));
                return { stock: stock.map(st => { tx.push([st.col, st.id, st.delta]); const p = window.data[st.col].find(x => x.id === st.id); const before = p.adet; p.adet += st.delta; return { before, after: p.adet }; }) };
            };
            window.runStockOps = async ({ stock = [], writes = [] }) => atomic(stock, writes);
            window.applyItemOps = async (ops) => atomic([], ops);
            const alerts = []; window.showAppAlert = (m, t) => alerts.push([t, m]);
            window.setActiveUser({ name: 'Yönetici Test' });
            const realIsAdmin = window.isDbAdmin; window.isDbAdmin = () => true;   // J4 (T6): confirmRequest yönetici kapılı
            const modal = () => document.getElementById('requestApprovalModal');
            const openFor = async n => { const run = { p: window.confirmRequest(base + n) }; await ft.waitFor(async () => !!modal(), 2000); return run; };

            // 1) exact name match is preselected; OK deducts 2 from B1 and links b3 to the product
            let pending = await openFor(1);
            const sel = modal().querySelector('#raSource');
            out.preselected = sel.value === `b1|${prod.id}`;
            out.lowStockDisabled = [...sel.options].find(o => o.value === `b1|${low.id}`)?.disabled === true;
            // 3.9a: demirbaş → talep adedi (2) kadar kimlik satırı; boş bırakınca onay reddedilir
            out.deviceRows = modal().querySelectorAll('#raDevIds .dev-ids-row').length;
            out.snFieldHidden = modal().querySelector('#raSn').style.display === 'none';
            modal().querySelector('#raOk').click();
            out.missingIdsRefused = !!modal() && modal().querySelector('#raError').textContent;
            const devRows = modal().querySelectorAll('#raDevIds .dev-ids-row');
            devRows[0].querySelector('.dev-sn').value = 'SN-FT1';
            devRows[1].querySelector('.dev-env').value = 'ENV-FT1';
            modal().querySelector('#raOk').click();
            await pending.p;
            await ft.waitFor(async () => (await db(1))?.durum === 'approved');
            const r1 = await db(1);
            out.approveWithStock = {
                tx: JSON.stringify(tx) === JSON.stringify([['b1', prod.id, -2]]), stockNow: prod.adet,
                request: { durum: r1.durum, sn: r1.sn, stockRepo: r1.stockRepo, stockProductId: r1.stockProductId === prod.id },
                b3: b3[0] && { kaynakDepo: b3[0].kaynakDepo, productId: b3[0].productId === prod.id, requestId: b3[0].requestId === base + 1, adet: b3[0].adet, rafNo: b3[0].rafNo, isDemirbas: b3[0].isDemirbas, tip: b3[0].tip, contract: window.Schema.validateB3(b3[0]) },
                perDevice: b3.map(x => `${x.adet}|${x.sn}|${x.envanterNo}|${window.Schema.validateB3(x).length}`),
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
            out.noStock = { noTx: tx.length === 0, kaynakDepo: b3[0]?.kaynakDepo, productId: b3[0]?.productId, shownRaf: b3[0] && window.Schema.normalizeB3(b3[0]).rafNo, contract: b3[0] && window.Schema.validateB3(b3[0]), message: alerts.at(-1)?.[1] };

            // 4) b3 write fails: the single transaction fails → no stock change, request stays pending (nothing to restore)
            tx.length = 0; failB3 = true;
            await ft.waitFor(async () => window.data.requests.some(r => r.id === base + 2 && r.durum === 'Beklemede'));
            pending = await openFor(2);
            const s4 = modal().querySelector('#raSource'); s4.value = `b1|${prod.id}`; s4.dispatchEvent(new Event('change'));
            modal().querySelector('#raDevIds .dev-sn').value = 'SN-FT2';
            modal().querySelector('#raOk').click();
            await pending.p;
            await ft.sleep(1500);
            out.b3Failure = { noTx: tx.length === 0, stockNow: prod.adet, stillPending: (await db(2)).durum === 'Beklemede', message: alerts.at(-1)?.[1] };

            // 5) stock transaction refuses (e.g. insufficient on server): nothing is approved
            failB3 = false; tx.length = 0; stockFails = true;
            pending = await openFor(2);
            const s5 = modal().querySelector('#raSource'); s5.value = `b1|${prod.id}`; s5.dispatchEvent(new Event('change'));
            modal().querySelector('#raDevIds .dev-sn').value = 'SN-FT2';
            modal().querySelector('#raOk').click();
            await pending.p; await ft.sleep(800);
            out.txFailure = { stillPending: (await db(2)).durum === 'Beklemede', message: alerts.at(-1)?.[1] };

            out.oneCallPerApproval = txCalls;
            window.saveData = realSave; window.runStockOps = realOps; window.applyItemOps = realApply; window.showAppAlert = realAlert; window.isDbAdmin = realIsAdmin;
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
            const realSave = window.saveData, realAdm = window.isDbAdmin;
            window.isDbAdmin = () => true;   // J1: birim yazmaları yalnız admin; yazma burada taklit ediliyor
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

            window.saveData = realSave; window.data.units = origUnits; window.isDbAdmin = realAdm;
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

            const realIsAdm = window.isDbAdmin; window.isDbAdmin = () => true; // karar 3: çıkış modalı yalnız yönetici
            window.openExitModal();
            window.selectProduct(prod.ürün, prod.tür, prod.raf, prod.adet, 'b1', window.data.b1.length - 1);
            out.exitShelf = { shelf: document.getElementById('exitShelfNo').value, qtyMax: document.getElementById('exitQty').max };
            window.openExitModal();
            out.exitShelfResetOnOpen = document.getElementById('exitShelfNo').value === '' && !document.getElementById('exitQty').hasAttribute('max');
            window.closeExitModal?.();
            window.isDbAdmin = realIsAdm;

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
            window.setActiveUser({ id: '12345', name: 'Hedef FT' });   // J8: oturum giriş kodu taşımaz — hedef id ile eşleşir
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
            window.setActiveUser({ id: '9999', name: 'Admin' }); _currentTargetUser = { id: '9999', name: 'Başka', demo: false };   // J8: kendini hedefleme id ile
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
            const origSave = window.saveData, origUpsert = window.upsertItem;
            window.saveData = async () => true; window.upsertItem = async () => ({ written: 1 });
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
            window.saveData = origSave; window.upsertItem = origUpsert;

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

            // 5) bulk delete (3 of a collection with more than 10 records = over 20%) is blocked without the flag; nothing is written.
            //    Faz 3.5: the ratio rule applies only above 10 records, so 8 more marked docs are added first.
            await window.saveData('requests', [...window.data.requests, ...[11, 12, 13, 14, 15, 16, 17, 18].map(mk)]);
            await ft.waitFor(async () => (await marked()) === 12 && window.data.requests.filter(r => String(r.ürün).includes(ft.MARKER)).length === 12);
            out.bulkCollectionSize = window._dbMirror.requests.length;
            // silinecek adet: koleksiyonun %20'sini aşan en küçük sayı (≤5, yani yalnız oran kuralı kilitler)
            const dropCount = Math.floor(out.bulkCollectionSize * 0.2) + 1;
            const toDrop = new Set([base + 1, base + 2, base + 4, base + 11, base + 12].slice(0, dropCount));
            out.bulkDropCount = dropCount;
            const before = await marked();
            const r5 = await window.saveData('requests', window.data.requests.filter(r => !toDrop.has(r.id)), { strict: false });
            await ft.sleep(1200);
            out.bulkBlocked = { result: r5, markedBefore: before, markedAfter: await marked(), alert: alerts.at(-1)?.[1] };
            let strictBulk = null;
            try { await window.saveData('requests', window.data.requests.filter(r => !toDrop.has(r.id))); } // default = strict
            catch (e) { strictBulk = { name: e.name, code: e.code, deletes: e.details?.deletes }; }
            out.bulkBlockedStrict = strictBulk;

            // 6) the same bulk delete with the explicit flag goes through
            const r6 = await window.saveData('requests', window.data.requests.filter(r => !toDrop.has(r.id)), { allowBulkDelete: true });
            out.bulkAllowed = { deleted: col(r6)?.deleted };
            await ft.waitFor(async () => (await marked()) === 12 - dropCount);
            out.markedLeft = await marked();

            // 7) unknown collection / no session: false by default, SaveDataError in strict mode
            out.unknownNonStrict = await window.saveData('archive', [], { strict: false });
            try { await window.saveData('archive', []); out.unknownStrict = 'no throw'; }
            catch (e) { out.unknownStrict = e.code; }
            const realAuth = window.userAuth; window.userAuth = null;
            out.noAuthNonStrict = await window.saveData('requests', window.data.requests, { strict: false });
            try { await window.saveData('requests', window.data.requests); out.noAuthStrict = 'no throw'; }
            catch (e) { out.noAuthStrict = e.code; }
            window.userAuth = realAuth;

            // 7b) strict is the default: writeOk turns it into false; an uncaught error is shown by the global handler
            out.writeOk = { failed: await window.writeOk(window.saveData('archive', [])), ok: await window.writeOk(window.saveData('requests', window.data.requests)) };
            const before7b = alerts.length;
            window.saveData('archive', []); // not awaited, not caught
            await ft.sleep(300);
            out.globalHandler = alerts.slice(before7b).map(a => a[0] + ':' + a[1].slice(0, 40));

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
            out.duplicate = await window.appendItem('requests', { ...r, id }, { strict: false });
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
            const bad = await window.applyItemOps([ // strict:false → false instead of throwing
                { op: 'update', col: 'requests', id, fields: { durum: 'SHOULD_NOT_APPLY' } },
                { op: 'update', col: 'b1', id: b1.id, fields: { açıklama: b1.açıklama || '' } },
            ], { strict: false });
            await ft.sleep(800);
            out.atomicReject = { result: bad, requestUnchanged: (await srv('requests', id)).durum === 'draft', localUnchanged: window.findItem('requests', id).durum === 'draft' };

            // remove / bulkRemove
            const extra = [];
            for (let i = 0; i < 3; i++) extra.push((await window.appendItem('requests', { ...r, n: i })).ids[0]);
            const br = await window.bulkRemove('requests', extra);
            const rm = await window.removeItem('tasks', tid);
            await ft.sleep(500);
            out.remove = { bulkDeleted: br.deleted, taskGone: !(await srv('tasks', tid)), bulkGone: (await Promise.all(extra.map(x => srv('requests', x)))).every(x => !x) };
            out.unknownCol = await window.upsertItem('archive', { id: 1 }, { strict: false });
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
            const realAdm = window.isDbAdmin, realExit = window.runExitTransaction; window.isDbAdmin = () => true;
            window.runExitTransaction = async a => { tx.push([a.repo, a.productId, -a.qty]); ops.push(['runExitTransaction', [a.repo, a.b3Entry]]); return { stock: [{ before: 5, after: 5 - a.qty }] }; };
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
            out.exit = { tx: tx.at(-1), b3: last()[0] === 'runExitTransaction' ? { col: 'b3', productId: last()[1][1].productId, adet: last()[1][1].adet } : last() };
            window.isDbAdmin = realAdm; window.runExitTransaction = realExit;

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

    // Faz 3 · H2 — ITSM-07: personnel edit/delete by id, edit keeps the other fields, delete is confirmed, escaped table.
    // 'personel' is admin-only: write API is a recorded stub.
    async personnelById(page) {
        return page.evaluate(async () => {
            const out = {}, ops = [];
            const orig = { p: window.data.personel, val: window.validateAdminAction, confirm: window.showCustomConfirm, alert: window.showAppAlert,
                api: ['appendItem', 'updateItem', 'removeItem'].map(k => [k, window[k]]) };
            ['appendItem', 'updateItem', 'removeItem'].forEach(k => { window[k] = async (...a) => { ops.push([k, ...JSON.parse(JSON.stringify(a))]); return { written: 1 }; }; });
            window.validateAdminAction = () => true;
            const realAdm = window.isDbAdmin; window.isDbAdmin = () => true;   // J1: personel yazmaları yalnız admin (taklit)
            // J7: ekleme/düzenleme hesap da açar — yazmalar taklit edildiği için hesap açma da yakalanır (gerçek Auth'a gitmez)
            const accounts = [], realProv = window.provisionStaffAccount;
            window.provisionStaffAccount = async person => { accounts.push(String(person.id)); return { status: 'created', uid: 'u-' + person.id }; };
            let confirmAnswer = false; window.showCustomConfirm = async () => confirmAnswer;
            window.showAppAlert = () => {};
            window.data.personel = [{ id: 'p1', name: 'Ayşe', code: '11111', role: 'x' }, { id: 'p2', name: '<img src=x onerror="window.__px=1">', code: '22222' }];
            window.renderPersonelTable();
            out.escaped = !document.querySelector('#tablePersonel img') && !window.__px;

            window.openPersonelModal('edit', 'p1');
            window.data.personel.unshift({ id: 'p0', name: 'Yeni', code: '00000' }); // array shift
            document.getElementById('personelName').value = 'Ayşe Y.';
            document.getElementById('personelForm').requestSubmit();
            await new Promise(r => setTimeout(r, 50));
            out.edit = ops.at(-1);

            await window.deletePersonel('p2');
            out.deleteCancelled = ops.length === 1;
            confirmAnswer = true;
            await window.deletePersonel('p2');
            out.delete = ops.at(-1);

            window.openPersonelModal('add');
            document.getElementById('personelName').value = 'Mehmet';
            document.getElementById('personelCode').value = '11111';
            document.getElementById('personelForm').requestSubmit();
            await new Promise(r => setTimeout(r, 50));
            out.duplicateCodeRefused = ops.length === 2;
            document.getElementById('personelCode').value = '33333';
            document.getElementById('personelForm').requestSubmit();
            await new Promise(r => setTimeout(r, 50));
            out.add = ops.at(-1);
            out.accountRequests = accounts;   // düzenlenen p1 (uid'siz) + eklenen yeni kişi; reddedilen ikinci kod için istek yok

            window.data.personel = orig.p;
            window.provisionStaffAccount = realProv;
            orig.api.forEach(([k, f]) => { window[k] = f; });
            Object.assign(window, { validateAdminAction: orig.val, showCustomConfirm: orig.confirm, showAppAlert: orig.alert, isDbAdmin: realAdm });
            document.getElementById('personelModal').style.display = 'none';
            return out;
        });
    },

    // Faz 3 · H2 — ADM-07 on admin.html: critical-group delete by ids across B1+B2 in one batch; bulk B2 add atomic.
    async adminBulkOps(page, browser) {
        const admin = await (await browser.createBrowserContext()).newPage();
        const errs = []; admin.on('pageerror', e => errs.push(e.message)); admin.on('dialog', d => d.dismiss());
        await admin.evaluateOnNewDocument(() => localStorage.setItem('admin_auth', JSON.stringify({ expiry: Date.now() + 600000 })));
        await admin.goto(page.url().replace('index.html', 'admin.html'), { waitUntil: 'domcontentloaded' });
        await new Promise(r => setTimeout(r, 9000));
        const out = await admin.evaluate(async () => {
            const o = {}, ops = [];
            const orig = { b1: window.data.b1, b2: window.data.b2, apply: window.applyItemOps, confirm: window.customConfirmAlert, alert: window.showAppAlert };
            window.applyItemOps = async x => { ops.push(JSON.parse(JSON.stringify(x))); return { written: x.length }; };
            window.customConfirmAlert = async () => { window.data.b1.unshift({ id: 'shift', ürün: 'Başka', tür: 'Başka', adet: 9 }); return true; };
            const alerts = []; window.showAppAlert = (m, t) => alerts.push([t, m]);
            window.data.b1 = [{ id: 'k1', ürün: 'Kablo', tür: 'Kablo', adet: 0 }, { id: 'm1', ürün: 'Mouse', tür: 'Mouse', adet: 0 }];
            window.data.b2 = [{ id: 'k2', ürün: 'Kablo', tür: 'Kablo', adet: 0 }];
            const key = window.checkIsDemirbas(window.data.b1[0]) ? null : `sarf_${window.getCleanProductName('Kablo')}`;
            o.groupKey = key;
            await window.deleteCriticalGroup(key);
            o.criticalDelete = ops.at(-1);
            const r = await window.bulkAddB2Items([{ ürün: 'Yeni1', adet: 2 }, { ürün: 'Yeni2' }]);
            const last = ops.at(-1);
            o.bulkAdd = { ops: last.length, allSet: last.every(x => x.op === 'set' && x.col === 'b2' && x.mustBeNew), idsUnique: new Set(last.map(x => x.item.id)).size === 2, returned: !!r };
            window.applyItemOps = async () => false;
            o.bulkAddFailure = { result: await window.bulkAddB2Items([{ ürün: 'X' }]), alert: alerts.at(-1) };
            Object.assign(window.data, { b1: orig.b1, b2: orig.b2 });
            Object.assign(window, { applyItemOps: orig.apply, customConfirmAlert: orig.confirm, showAppAlert: orig.alert });
            return o;
        });
        out.adminPageErrors = errs;
        await admin.browserContext().close();
        return out;
    },

    // Faz 3 · H2 — EBYS-17 (rollback, legacy id), EBYS-12 (owner or admin), DATA-14 (no write on view, no stale sub-fields,
    // migration admin-only). Real, marked purchaseOrders writes (staff-writable).
    async ebysH2(page) {
        return page.evaluate(async () => {
            const ft = window.__ft, out = {};
            const srv = async id => (await ft.readMarked('purchaseOrders')).find(d => String(d.id) === String(id));
            const alerts = []; const realAlert = window.showAppAlert; window.showAppAlert = (m, t) => alerts.push([t, m]);
            const realConfirm = window.showCustomConfirm; window.showCustomConfirm = async () => true;
            const owner = { name: 'Sahip ' + ft.MARKER, code: '70001' };
            const mk = (extra) => ({ id: window.makeId(), urun: 'H2 ' + ft.MARKER, talepEden: owner.name, createdBy: owner.code, createdByName: owner.name,
                durum: 'Onay Bekliyor', akis: [], files: [{ name: 'a.pdf', url: 'https://x/a.pdf' }], ...extra });
            const wf = (id, extra) => ({ id, started: true, finished: false, currentStep: 0, currentState: 'initiation', history: [],
                steps: [{ user: 'Onay Kişi', tip: 'Paraf', status: 'pending' }, { user: 'İkinci', tip: 'Paraf', status: 'pending' }], ...extra });

            // setup: A (workflow with id), L1/L2 (legacy workflows WITHOUT id)
            const A = mk({ workflow: wf('wf_a_' + Date.now(), { suspendedAt: 'OLD' }) });
            const L1 = mk({ workflow: wf(undefined) }), L2 = mk({ workflow: wf(undefined) });
            delete L1.workflow.id; delete L2.workflow.id;
            for (const x of [A, L1, L2]) await window.appendItem('purchaseOrders', x);
            await ft.waitFor(async () => (await ft.readMarked('purchaseOrders')).length === 3);
            await ft.waitFor(async () => [A, L1, L2].every(x => window.data.purchaseOrders.some(p => String(p.id) === String(x.id))));
            const live = x => window.findItem('purchaseOrders', x.id);

            // EBYS-17a: transition throws -> in-memory item fully restored
            window.setActiveUser({ name: 'Onay Kişi' });
            const realTransition = window.transitionWorkflowState;
            window.transitionWorkflowState = async () => { throw new Error('simulated'); };
            await window.approveStep(A.id);
            window.transitionWorkflowState = realTransition;
            out.rollbackOnThrow = { stepStatus: live(A).workflow.steps[0].status, akis: live(A).akis.length, durum: live(A).durum };

            // EBYS-17b: save fails -> restored
            const realUpsert = window.upsertItem; window.upsertItem = async () => false;
            await window.approveStep(A.id);
            window.upsertItem = realUpsert;
            out.rollbackOnSaveFail = { stepStatus: live(A).workflow.steps[0].status, currentStep: live(A).workflow.currentStep, alert: alerts.at(-1)?.[1] };

            // EBYS-17c: legacy workflows without id — approving L2 must not touch L1; L2 gets a stable id
            await window.approveStep(L2.id);
            await ft.waitFor(async () => (await srv(L2.id))?.workflow?.currentStep === 1);
            const sL1 = await srv(L1.id), sL2 = await srv(L2.id);
            out.legacyId = { l2Id: sL2.workflow.id, l2Step: sL2.workflow.currentStep, l1Untouched: sL1.workflow.currentStep === 0 && sL1.workflow.steps[0].status === 'pending' && !sL1.workflow.id };

            // DATA-14: viewing a consistent workflow writes nothing
            let upserts = 0; window.upsertItem = async (...a) => { upserts++; return realUpsert(...a); };
            await window.viewWorkflow(L2.id); window.closeWorkflowModal();
            window.upsertItem = realUpsert;
            out.viewNoWrite = upserts === 0;
            out.migrationSkippedForStaff = await window.fixAllWorkflowData() === 0;

            // EBYS-12: stranger denied; view-mode file list has no delete button; owner withdraw works
            window.setActiveUser({ name: 'Yabancı Kişi', code: '99999' });
            await window.cancelPurchaseRequest(A.id);
            out.strangerDenied = { alert: alerts.at(-1)?.[1], stillStarted: live(A).workflow.started === true };
            await window.deleteRequestFile(A.id, 0, 'https://x/a.pdf');
            out.strangerFileDenied = live(A).files.length === 1;
            window.openPurchaseDetail(A.id, 'view');
            out.viewModeNoFileDelete = !document.querySelector('#purUploadedFilesList button[onclick*="deleteRequestFile"]');
            window.closePurchaseModal();

            window.setActiveUser(owner);
            await window.cancelPurchaseRequest(A.id);
            await ft.waitFor(async () => (await srv(A.id))?.durum === 'Taslak');
            const sA = await srv(A.id);
            out.ownerWithdraw = { durum: sA.durum, started: sA.workflow.started, staleFieldGone: !('suspendedAt' in sA.workflow), historyKept: (sA.workflow.history || []).some(h => h.action === 'withdraw') };

            // owner can delete a file once not started; the file is found by url
            await ft.waitFor(async () => live(A).workflow.started === false);
            await window.deleteRequestFile(A.id, 5, 'https://x/a.pdf');
            await ft.waitFor(async () => ((await srv(A.id))?.files || []).length === 0);
            out.ownerFileDelete = ((await srv(A.id)).files || []).length === 0;

            window.showAppAlert = realAlert; window.showCustomConfirm = realConfirm;
            return out;
        });
    },

    // Faz 3 · H2 — EBYS-14 (no fake attachments), TODO-04 (malformed tasks), VIP-07 (kill switch shows the real state;
    // the switch itself is never toggled — rule 7.5).
    async h2Leftovers(page, browser) {
        const out = await page.evaluate(async () => {
            const ft = window.__ft, o = {};
            window.setActiveUser({ name: 'Flow Test ' + ft.MARKER, code: '00001' });
            const realUpload = window.uploadFiles, realConfirm = window.showCustomConfirm, realAlert = window.showAppAlert;
            window.showAppAlert = () => {};
            const fail = () => { const e = new Error('1 dosya yüklenemedi: a.pdf (storage/unauthorized)'); e.name = 'UploadError'; e.uploaded = []; e.failed = ['a.pdf']; throw e; };
            window.uploadFiles = async () => fail();
            const fill = name => {
                window.openNewPurchaseModal();
                document.getElementById('purName').value = name;
                const fi = document.getElementById('purchaseFile');
                const dt = new DataTransfer(); dt.items.add(new File(['x'], 'a.pdf', { type: 'application/pdf' })); fi.files = dt.files;
            };
            // "Hayır" -> nothing saved
            window.showCustomConfirm = async () => false;
            fill('EBYS14 iptal ' + ft.MARKER); await window.savePurchaseRequest(new Event('submit'));
            await ft.sleep(1200);
            o.cancelNothingSaved = (await ft.readMarked('purchaseOrders')).filter(d => String(d.urun).startsWith('EBYS14 iptal')).length === 0;
            // "Evet" -> saved without fake attachments
            window.showCustomConfirm = async () => true;
            fill('EBYS14 devam ' + ft.MARKER); await window.savePurchaseRequest(new Event('submit'));
            await ft.waitFor(async () => (await ft.readMarked('purchaseOrders')).some(d => String(d.urun).startsWith('EBYS14 devam')));
            const doc = (await ft.readMarked('purchaseOrders')).find(d => String(d.urun).startsWith('EBYS14 devam'));
            o.continueNoFakeFiles = { saved: !!doc, files: (doc && doc.files || []).length, noSimulated: !JSON.stringify(doc || {}).includes('simulated') };
            window.closePurchaseModal();
            Object.assign(window, { uploadFiles: realUpload, showCustomConfirm: realConfirm, showAppAlert: realAlert });

            // TODO-04: malformed tasks render without errors
            const origTasks = window.data.tasks;
            window.data.tasks = [{ id: 't1' }, { id: 't2', title: null, priority: 5, status: null, checklist: 'x', interactions: { a: 1 }, assigneeId: 7 }];
            try { window.renderMyTasksTab && window.renderMyTasksTab(); window.checkPendingTasks && window.checkPendingTasks(); o.malformedTasks = 'ok'; }
            catch (e) { o.malformedTasks = 'ERR ' + e.message; }
            window.data.tasks = origTasks;
            return o;
        });
        const admin = await (await browser.createBrowserContext()).newPage();
        const errs = []; admin.on('pageerror', e => errs.push(e.message)); admin.on('dialog', d => d.dismiss());
        await admin.evaluateOnNewDocument(() => localStorage.setItem('admin_auth', JSON.stringify({ expiry: Date.now() + 600000 })));
        await admin.goto(page.url().replace('index.html', 'admin.html'), { waitUntil: 'domcontentloaded' });
        await new Promise(r => setTimeout(r, 9000));
        out.killSwitch = await admin.evaluate(async () => {
            const btn = document.getElementById('vipKillSwitchBtn');
            const serverSaysMaintenance = window.data.config && window.data.config.maintenance === true;
            const shown = btn.dataset.maintenance;
            window.renderKillSwitchButton(true); const onText = btn.textContent.trim();
            window.renderKillSwitchButton(serverSaysMaintenance);
            let wrote = false; const realConfirm = window.showCustomConfirm, realAdmin = window.isDbAdmin;
            window.isDbAdmin = () => true; window.showCustomConfirm = async () => false; // cancel -> no write
            await window.vipToggleKillSwitch();
            window.isDbAdmin = realAdmin; window.showCustomConfirm = realConfirm;
            wrote = (window.data.config && window.data.config.maintenance === true) !== serverSaysMaintenance;
            return { renderedFromSnapshot: shown === String(!!serverSaysMaintenance) || (!window.data.config && shown === undefined), onText, cancelWritesNothing: !wrote };
        });
        out.adminPageErrors = errs;
        await admin.browserContext().close();
        return out;
    },

    // H3 · 3.5 status logic (pure) + 3.4 transaction plan (pure) + karar 3 / atomic rejection (real Firestore, anonymous).
    async stockCore(page) {
        return page.evaluate(async () => {
            const ft = window.__ft, o = {};
            const P = (col, data, d) => { const r = window.computeStockPatch(col, data, d); return { after: r.after, status: r.statusAfter, fields: Object.keys(r.patch).sort().join(','), prev: r.patch.stokOncekiDurum, clearPrev: r.clearPrev }; };
            o.status = {
                readyToEmpty:   P('b1', { adet: 1, durumu: 'Kullanıma Hazır' }, -1),
                mevcutToEmpty:  P('b1', { adet: 2, durumu: 'Mevcut' }, -2),
                pasifKept:      P('b1', { adet: 1, durumu: 'Pasif' }, -1),
                hurdaKept:      P('b1', { adet: 3, durumu: 'Hurda' }, -3),
                servisKept:     P('b1', { adet: 2, durumu: 'Servis Sürecinde' }, -2),
                sifirKept:      P('b1', { adet: 1, durumu: 'Sıfır' }, -1),
                restockRestore: P('b1', { adet: 0, durumu: 'Tükendi', stokOncekiDurum: 'Mevcut' }, 4),
                restockDefault: P('b1', { adet: 0, durumu: 'Tükendi' }, 1),
                pasifRestockKept: P('b1', { adet: 0, durumu: 'Pasif' }, 2),
                b2UsesStatus:   P('b2', { adet: 1, status: 'Aktif' }, -1),
                noStatusB2:     P('b2', { adet: 5 }, -1),
                decreaseAbove0: P('b1', { adet: 5, durumu: 'Kullanıma Hazır' }, -2),
            };
            // plan: merged deltas, insufficient stock, createIfMissing, not-found
            const plan = (entries, datas) => { try { return window.planStockOps(entries, datas).map(r => `${r.col}/${r.id}:${r.before}->${r.after}${r.created ? ':created' : ''}`); } catch (e) { return `${e.name}:${e.code}`; } };
            o.plan = {
                ok: plan([{ col: 'b1', id: 'a', delta: -2 }, { col: 'b2', id: 'b', delta: 3 }], [{ adet: 5, durumu: 'Kullanıma Hazır' }, { adet: 0, status: 'Tükendi' }]),
                insufficient: plan([{ col: 'b1', id: 'a', delta: -6 }], [{ adet: 5 }]),
                missing: plan([{ col: 'b1', id: 'a', delta: -1 }], [null]),
                create: plan([{ col: 'b1', id: 'x', delta: 0, createIfMissing: { ürün: 'Geri Gelen', adet: 2 } }], [null]),
            };
            // karar 3: non-admin session is refused before anything is sent
            const r1 = await window.runStockOps({ stock: [{ col: 'b1', id: 'nope', delta: -1 }] }, { strict: false });
            let thrown = null; try { await window.runExitTransaction({ repo: 'b1', productId: 'nope', qty: 1, b3Entry: {} }); } catch (e) { thrown = e.code + ' | ' + e.message; }
            o.staff = { nonStrict: r1, strictMessage: thrown };
            // atomicity: pretend admin; Firestore rules reject the b1 part → the requests write in the SAME transaction must not exist
            const b1 = (window.data.b1 || [])[0];
            const realIsDbAdmin = window.isDbAdmin; window.isDbAdmin = () => true;
            const reqId = window.makeId();
            const r2 = await window.runStockOps({
                stock: b1 ? [{ col: 'b1', id: b1.id, delta: 0 }] : [],
                writes: [{ op: 'set', col: 'requests', item: { id: reqId, ürün: 'ATOMIC ' + ft.MARKER, durum: 'Beklemede' } }]
            }, { strict: false });
            window.isDbAdmin = realIsDbAdmin;
            await ft.sleep(800);
            o.atomicReject = { result: r2, requestNotWritten: !(await ft.readMarked('requests')).some(r => r.id === reqId), localUnchanged: !(window.data.requests || []).some(r => r.id === reqId) };
            return o;
        });
    },

    // H3 · single exit + cart (INV-04) go through one transaction; staff refused up front (karar 3). runStockOps recorded.
    async h3Exits(page) {
        return page.evaluate(async () => {
            const o = {};
            const orig = { b1: window.data.b1, b2: window.data.b2, ops: window.runStockOps, exit: window.runExitTransaction, adm: window.isDbAdmin, alert: window.showAppAlert, save: window.saveData };
            const alerts = []; window.showAppAlert = (m, t) => alerts.push([t, m]);
            let fullSaves = 0; window.saveData = async (...a) => { fullSaves++; return orig.save(...a); };
            const P = (id, name, adet, extra) => ({ id, ürün: name, raf: 'R', sütun: 'S', adet, durumu: 'Kullanıma Hazır', tür: 'Kablo', ...extra });
            window.data.b1 = [P('c1', 'Kablo A', 5), P('c2', 'Kablo B', 1)];
            window.data.b2 = [P('c3', 'Mouse', 4, { status: 'Aktif' })];

            // staff: exit modal and cart refused with the decision-3 message, nothing opened
            window.isDbAdmin = () => false;
            window.openExitModal('b1', 'c1');
            o.staffExit = { alert: alerts.at(-1)?.[1], modalOpen: getComputedStyle(document.getElementById('exitModal')).display !== 'none' };
            window.openCartModal();
            o.staffCart = { alert: alerts.at(-1)?.[1], modalOpen: getComputedStyle(document.getElementById('cartModal')).display !== 'none' };

            // admin: cart with 3 lines → ONE runStockOps with 3 stock deltas + 3 b3 sets; a record prepended meanwhile is ignored
            window.isDbAdmin = () => true;
            const calls = [];
            window.runStockOps = async (arg) => { calls.push(JSON.parse(JSON.stringify(arg))); return { stock: arg.stock.map(s => ({ name: s.id, before: 5, after: 5 + s.delta })) }; };
            window.openCartModal();
            window.addToCart({ item: window.data.b1[0], repo: 'b1', qty: 5 }); window.addToCart({ item: window.data.b1[0], repo: 'b1', qty: 5 });
            window.addToCart({ item: window.data.b1[1], repo: 'b1', qty: 1 });
            window.addToCart({ item: window.data.b2[0], repo: 'b2', qty: 4 });
            window.data.b1.unshift(P('new', 'SONRADAN', 9));
            await window.saveCartExit(new Event('submit'));
            const c = calls.at(-1);
            o.cart = {
                calls: calls.length,
                stock: c && c.stock.map(s => `${s.col}/${s.id}:${s.delta}`),
                b3: c && c.writes.map(w => `${w.col}:${w.item.productId}:${w.item.adet}`),
                noFullSave: fullSaves === 0,
                alert: alerts.at(-1)?.[0]
            };

            // cart failure (e.g. insufficient stock on the server): nothing written, clear message
            window.runStockOps = async () => { throw new window.SaveDataError('insufficient-stock', 'Yetersiz stok: "Kablo B" (mevcut 0, istenen 1).'); };
            window.openCartModal();
            window.addToCart({ item: window.data.b1[2], repo: 'b1', qty: 1 });
            await window.saveCartExit(new Event('submit'));
            o.cartFail = alerts.at(-1);

            // single exit → runExitTransaction (one call, no separate b3 write, no compensation)
            const ex = [];
            window.runExitTransaction = async a => { ex.push({ repo: a.repo, id: a.productId, qty: a.qty, b3: a.b3Entry.productId }); return { stock: [{ before: 5, after: 3, statusBefore: 'Kullanıma Hazır', statusAfter: 'Kullanıma Hazır' }] }; };
            window.openExitModal('b1', 'c1');
            document.getElementById('exitQty').value = '2';
            await window.saveExit(new Event('submit'));
            o.single = { calls: ex, alert: alerts.at(-1)?.[1] };
            window.runExitTransaction = async () => { throw new window.SaveDataError('insufficient-stock', 'Yetersiz stok: "Kablo A" (mevcut 1, istenen 2).'); };
            window.openExitModal('b1', 'c1');
            document.getElementById('exitQty').value = '2';
            await window.saveExit(new Event('submit'));
            o.singleFail = alerts.at(-1);
            window.closeExitModal?.(); window.closeModal?.('cartModal');

            Object.assign(window, { runStockOps: orig.ops, runExitTransaction: orig.exit, isDbAdmin: orig.adm, showAppAlert: orig.alert, saveData: orig.save });
            window.data.b1 = orig.b1; window.data.b2 = orig.b2;
            return o;
        });
    },

    // H3 · zimmet ata / iade / servisten dönüş: exactly one atomic core call each (admin.html, recorded; nothing written).
    async h3Assignments(page, browser) {
        const admin = await (await browser.createBrowserContext()).newPage();
        const errs = []; admin.on('pageerror', e => errs.push(e.message)); admin.on('dialog', d => d.dismiss());
        await admin.evaluateOnNewDocument(() => localStorage.setItem('admin_auth', JSON.stringify({ expiry: Date.now() + 600000 })));
        await admin.goto(page.url().replace('index.html', 'admin.html'), { waitUntil: 'domcontentloaded' });
        await new Promise(r => setTimeout(r, 9000));
        const out = await admin.evaluate(async () => {
            if (window.COLLECTION_ROOT !== 'inventory_demo') throw new Error('root');
            const o = {}, calls = [], alerts = [];
            const orig = { b1: window.data.b1, b3: window.data.b3, asg: window.data.assignments, req: window.data.requests, svc: window.data.serviceRecords, per: window.data.personel };
            window.isDbAdmin = () => true;
            window.showAppAlert = (m, t) => alerts.push([t, m]);
            window.showCustomConfirm = async () => true;
            let fail = false;
            window.runStockOps = async (arg) => { calls.push(['runStockOps', JSON.parse(JSON.stringify(arg))]); if (fail) throw new window.SaveDataError('write-failed', 'transaction reddedildi'); return { stock: arg.stock.map(s => ({ col: s.col, id: s.id, name: s.id, before: 3, after: 3 + s.delta, created: false })) }; };
            window.applyItemOps = async (ops) => { calls.push(['applyItemOps', JSON.parse(JSON.stringify(ops))]); return { written: ops.length }; };
            let legacy = 0; const realRst = window.runStockTransaction; window.runStockTransaction = async (...a) => { legacy++; return realRst(...a); };
            let fullSaves = 0; const realSave = window.saveData; window.saveData = async (...a) => { fullSaves++; return { written: 0 }; };
            const P = (id, name, adet) => ({ id, ürün: name, raf: 'R1', adet, durumu: 'Kullanıma Hazır', isDemirbas: true });
            window.data.b1 = [P('p1', 'Laptop A', 3), P('p2', 'Laptop B', 2)];
            window.data.personel = [...(orig.per || []), { name: 'Zimmet Kişi' }];

            // 1) saveAssignment: two rows → one runStockOps with 2 stock deltas + 2 b3 + 2 assignments sharing ids
            const m = window.inventoryManagementModule;
            m.openAssignModal();
            const sel = document.getElementById('assignPersonnel'); sel.value = 'Zimmet Kişi';
            m.addAssignRow();
            const rows = document.querySelectorAll('#assignRowsContainer .assign-product-row');
            [['p1', '2'], ['p2', '1']].forEach(([pid, q], i) => {
                const ws = rows[i].querySelector('.assign-warehouse-sel'); ws.value = 'b1'; m.onWarehouseChange(ws);
                const ps = rows[i].querySelector('.assign-product-sel'); ps.value = pid; m.onProductChange(ps);
                rows[i].querySelector('.assign-qty-inp').value = q; m._syncAssignDevices(rows[i]);
                rows[i].querySelectorAll('.dev-sn').forEach((inp, k) => { inp.value = `SN-${pid}-${k}`; });
            });
            await m.saveAssignment();
            const a = calls.at(-1)?.[1];
            const b3 = (a?.writes || []).filter(w => w.col === 'b3'), asg = (a?.writes || []).filter(w => w.col === 'assignments');
            o.assign = { calls: calls.length, stock: a?.stock.map(s => `${s.col}/${s.id}:${s.delta}`), b3: b3.length, assignments: asg.length,
                sharedIds: b3.every((w, i) => String(w.item.id) === String(asg[i]?.item.id)), alert: alerts.at(-1)?.[0] };
            fail = true; calls.length = 0;
            m.openAssignModal(); document.getElementById('assignPersonnel').value = 'Zimmet Kişi';
            const r0 = document.querySelector('#assignRowsContainer .assign-product-row');
            const w0 = r0.querySelector('.assign-warehouse-sel'); w0.value = 'b1'; m.onWarehouseChange(w0);
            const p0 = r0.querySelector('.assign-product-sel'); p0.value = 'p1'; m.onProductChange(p0);
            r0.querySelector('.dev-sn').value = 'SN-FAIL';
            await m.saveAssignment();
            o.assignFail = { calls: calls.length, alert: alerts.at(-1) };
            fail = false; m.closeAssignModal();

            // 2) removeAssignment to B1: one runStockOps (+qty) with b3 + assignments + request updates
            window.data.b3 = [{ id: 7001, productId: 'p1', sourceRepo: 'b1', sarfAdet: 2, alanKisi: 'Zimmet Kişi', talepTuru: 'Kalıcı Zimmet', iadeEdildi: false, requestId: 8001 }];
            window.data.assignments = [{ id: 7001, productId: 'p1', adet: 2 }];
            window.data.requests = [{ id: 8001, ürün: 'Laptop A', durum: 'approved' }];
            calls.length = 0;
            const pr = m.removeAssignment(7001, 'b3');
            await new Promise(r => setTimeout(r, 300));
            document.getElementById('btnReturnB1').click();
            await pr;
            const r = calls.at(-1)?.[1];
            o.returnToB1 = { calls: calls.length, fn: calls.at(-1)?.[0], stock: r?.stock.map(s => `${s.col}/${s.id}:+${s.delta}`), writes: r?.writes.map(w => `${w.op}:${w.col}:${w.id}`), alert: alerts.at(-1)?.[1] };
            // "Depoya iade etmeden kapat": no stock, one atomic batch
            window.data.b3[0].iadeEdildi = false; calls.length = 0;
            const pr2 = m.removeAssignment(7001, 'b3');
            await new Promise(r => setTimeout(r, 300));
            document.getElementById('btnReturnNone').click();
            await pr2;
            o.closeWithoutReturn = { calls: calls.map(c => c[0]), writes: calls.at(-1)?.[1].map(w => `${w.op}:${w.col}`) };

            // 3) receiveFromService: one runStockOps with createIfMissing + the service record closed (3.9b: not deleted)
            window.data.serviceRecords = [{ id: 9001, kaynakDepo: 'b1', originalData: { id: 'p9', ürün: 'Yazıcı', adet: 1, durumu: 'Servis Sürecinde' }, not: 'fixed' }];
            calls.length = 0;
            await window.receiveFromService(9001);
            const sv = calls.at(-1)?.[1];
            o.service = { calls: calls.length, stock: sv?.stock.map(s => ({ id: s.id, delta: s.delta, createStatus: s.createIfMissing?.durumu })), writes: sv?.writes.map(w => `${w.op}:${w.col}:${w.id}`) };
            fail = true;
            await window.receiveFromService(9001);
            o.serviceFail = alerts.at(-1);
            fail = false;

            o.noLegacyStockCalls = legacy === 0;
            o.noFullSaves = fullSaves === 0;
            window.saveData = realSave; window.runStockTransaction = realRst;
            Object.assign(window.data, { b1: orig.b1, b3: orig.b3, assignments: orig.asg, requests: orig.req, serviceRecords: orig.svc, personel: orig.per });
            return o;
        });
        out.adminPageErrors = errs;
        await admin.browserContext().close();
        return out;
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
            // J1: Rules v2 personelin etiketli yazmasını reddeder (savunma derinliği). Render kaçışını sınamak için yükler,
            // emülatörde etiket kuralına tabi olmayan admin oturumuyla yazılır (gerçek demoda eski kurallar anonime izin verir).
            let anonPayloadRejected = 'n/a (gerçek demo: eski kurallar)';
            if (!ft.emulator && ft.rulesV2) {
                // Gerçek demo + yayındaki Rules v2: yükü yazacak admin oturumu yok (kural 7.5) ve personel yazması reddedilmeli.
                anonPayloadRejected = await window.appendItem('requests', { id: reqId + 1, ürün: P, personel: 'X ' + ft.MARKER }).then(() => 'ALLOWED', e => e.code);
                return { skipped: 'gerçek demo, yayındaki Rules v2: etiketli yük yazılamaz; kaçışlı çizim j2XssSurfaces (iki ortam) ile sınanıyor', anonPayloadRejected };
            }
            if (ft.emulator) {
                anonPayloadRejected = await window.appendItem('requests', { id: reqId + 1, ürün: P, personel: 'X ' + ft.MARKER }).then(() => 'ALLOWED', e => e.code);
                await ft.adminLogin();
            }
            await window.saveData('requests', [...(window.data.requests || []), { id: reqId, ürün: P, personel: 'X ' + ft.MARKER, not: P, durum: 'Beklemede', tarih: '01.01.2026', adet: 1 }]);
            await window.saveData('tasks', [...(window.data.tasks || []), { id: 'task_' + reqId, title: P + ft.MARKER, description: P, priority: P, type: 'task', status: 'pending', assigneeId: 'pool', checklist: [{ text: P, done: false }], interactions: [{ user: P, message: P }] }]);
            await window.saveData('purchaseOrders', [...(window.data.purchaseOrders || []), { id: poId, urun: P + ft.MARKER, evrakNo: P, talepEden: P, birim: P, tarih: P, durum: 'Taslak', akis: [] }]);
            await ft.waitFor(async () => (await ft.readMarked('requests')).length && (await ft.readMarked('tasks')).length && (await ft.readMarked('purchaseOrders')).length);
            if (ft.emulator) await ft.backToAnonymous();
            return { reqId, poId, anonPayloadRejected };
        });
        if (ids.skipped) return ids;

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
        out.anonPayloadRejected = ids.anonPayloadRejected;
        out.adminPageErrors = errs;
        await admin.browserContext().close();
        return out;
    },
    // H4 · 3.6 şema sözleşmesi (saf): eski b3 biçimleri, kanonik kurucu, göç dönüşümü, Türkçe ad eşleşmesi, tek demirbaş kuralı.
    async schemaContract(page) {
        return page.evaluate(() => {
            const S = window.Schema, o = {};
            const orig = { b1: window.data.b1, b2: window.data.b2, pt: window.data.productTypes };
            window.data.productTypes = [{ name: 'Laptop', isDemirbas: true }, { name: 'Toner', isDemirbas: false }, { name: 'Test Tür', isDemirbas: true }];
            // "Raf-A 2" satırındaki ürün: b3'te sourceRepo b1 yazıyor ama ürün sonradan B2'ye sevk edilmiş
            window.data.b1 = [{ id: 'b1_tp', ürün: 'Thinkpad e14 G6 - 32gb', tür: 'Laptop', raf: 'Raf-A 1', sütun: 'B1 -A', adet: 2, durumu: 'Kullanıma Hazır', marka: 'Lenovo' }];
            window.data.b2 = [{ id: 'b1_asus', ürün: 'B3405CCA', tür: 'Laptop', raf: 'Zemin', sütun: 'Saha-1', adet: 37, status: 'Kullanıma Hazır', marka: 'Asus' }];
            try {
                o.names = {
                    caseInsensitive: S.normName('Muhammed CER') === S.normName('Muhammed Cer'),
                    dottedI: S.normName('İSMAİL') === S.normName('ismail') && S.normName('ISMAIL') === S.normName('İsmail'),
                    spaces: S.normName('  Ahmet   Serhat Dursun ') === S.normName('ahmet serhat dursun'),
                    different: S.normName('Ahmet') !== S.normName('Mehmet'),
                };
                o.demirbas = {
                    byType: S.isDemirbas({ tür: 'Laptop', isDemirbas: false }) === true,       // tür tanımı bayraktan önce
                    sarfType: S.isDemirbas({ tür: 'Toner', isDemirbas: true }) === false,
                    flagOnly: S.isDemirbas({ tür: 'Bilinmeyen', isDemirbas: 'true' }) === true,
                    nameIsType: S.isDemirbas({ ürün: 'laptop' }) === true,
                    none: S.isDemirbas({ ürün: 'Kalem' }) === false,
                    legacyAlias: window.checkIsDemirbas({ tür: 'Laptop' }) === true,
                };
                // Ekran görüntüsündeki dört satırın eski biçimleri
                const talep = { id: 1790573686034, shelfNo: 'TALEP', productType: 'Asus B3405CCA-U7255H321TB1D', description: 'Personel Talebi Onaylandı', sn: 'TEST123', sarfAdet: 1, note: 'Onaylayan: Admin', person: 'Ahmet Serhat Dursun', alanKisi: 'Ahmet Serhat Dursun', date: '28.09.2026', tarih: '28.09.2026', isDemirbas: false, talepTuru: 'Kalıcı Zimmet', oncelik: 'Orta', iadeEdildi: true, sourceRepo: 'TALEP', approvedBy: 'Admin', requestId: 1790573622073 };
                const moved = { id: 1790584178571, shelfNo: 'Raf-A 2', productType: 'B3405CCA-U7255H321TB1D', productId: 'b1_asus', sourceRepo: 'b1', sn: 'sn:001', sarfAdet: 1, note: 'Onaylayan: Admin', alanKisi: 'Ahmet Serhat Dursun', date: '28.09.2026', talepTuru: 'Kalıcı Zimmet', oncelik: 'Orta', requestId: 1790584106695, isDemirbas: true };
                const exitForm = { id: 1790600000000, rafNo: 'Raf-A 1', urunTuru: 'Laptop', urunAciklama: 'Thinkpad e14 G6 - 32gb', sn: 'TEST', adet: 1, not: 'TEST', alanKisi: 'Admin', tarih: '29.09.2026 10:10:10', isDemirbas: true, kaynakDepo: 'b1', productId: 'b1_tp' };
                const adminZimmet = { id: 1790610000000123, sn: 'TEST02', talepTuru: 'Kalıcı Zimmet', oncelik: 'Orta', isDemirbas: true, iadeEdildi: false, productId: 'b1_tp', sourceRepo: 'b1', shelfNo: 'Raf-A 1', productType: 'Thinkpad e14 G6 - 32gb', description: '-', sarfAdet: 1, note: 'Admin Zimmeti (Kalıcı Zimmet)', alanKisi: 'Muhammed CER', date: '29.09.2026' };
                const view = r => { const n = S.normalizeB3(r); return [n.rafNo, n.urunTuru, n.urunAciklama, n.sn, n.adet, n.not, n.alanKisi, n.tarih, n.tip, n.kaynakDepo].join(' | '); };
                o.legacyRows = { talep: view(talep), moved: view(moved), exitForm: view(exitForm), adminZimmet: view(adminZimmet) };
                o.legacyChecks = {
                    talepShowsStokDisi: S.normalizeB3(talep).rafNo === 'Stok dışı' && S.normalizeB3(talep).stokDisi,
                    movedTypeFoundInB2: S.normalizeB3(moved).urunTuru === 'Laptop',
                    movedKeepsSourceRepo: S.normalizeB3(moved).kaynakDepo === 'b1',
                    productTypeIsName: S.normalizeB3(adminZimmet).urunAciklama === 'Thinkpad e14 G6 - 32gb' && S.normalizeB3(adminZimmet).urunTuru === 'Laptop',
                    exitIsCikis: S.normalizeB3(exitForm).tip === 'cikis',
                    zimmetIsZimmet: S.normalizeB3(adminZimmet).tip === 'zimmet' && S.normalizeB3(talep).tip === 'zimmet',
                    tsFromMakeId: S.normalizeB3(adminZimmet).ts === 1790610000000,
                    tsFromMs: S.normalizeB3(exitForm).ts === 1790600000000,
                    legacyFlag: S.normalizeB3(talep).legacy === true,
                };
                // Göç dönüşümü: dört eski kayıt da sözleşmeyi geçer, eski alanlar kalkar, karşılığı olmayan alan korunur, tür/raf kopyalanır
                const conv = [talep, moved, exitForm, adminZimmet].map(r => S.toCanonicalB3(r));
                o.migration = {
                    allValid: conv.map(c => S.validateB3(c)),
                    descriptionKept: conv[0].description === 'Personel Talebi Onaylandı',
                    movedTypeSnapshotted: conv[1].urunTuru === 'Laptop',
                    talepRafStored: conv[0].rafNo === '-' && conv[0].kaynakDepo === 'stok-disi' && conv[0].productId === null,
                    idsKept: conv.map(c => c.id).join(',') === [talep, moved, exitForm, adminZimmet].map(r => r.id).join(','),
                    idempotent: JSON.stringify(S.toCanonicalB3(conv[1])) === JSON.stringify(conv[1]),
                    viewUnchanged: [talep, moved, exitForm, adminZimmet].every((r, i) => view(r) === view(conv[i])),
                };
                // Kanonik kurucu: stoktan ve stok dışı
                const e1 = S.buildB3Entry({ tip: 'cikis', product: window.data.b1[0], col: 'b1', adet: 1, sn: 'X1', not: 'n', alanKisi: 'Admin' });
                const e2 = S.buildB3Entry({ tip: 'zimmet', adet: 2, urunAciklama: 'Asus', alanKisi: 'Ali', requestId: 5, talepTuru: 'Geçici Zimmet', iadeTarihi: '2026-10-01', onaylayan: 'Admin' });
                o.builder = {
                    stockValid: S.validateB3(e1), stokDisiValid: S.validateB3(e2),
                    snapshot: [e1.urunTuru, e1.rafNo, e1.sutun, e1.marka, e1.kaynakDepo, e1.productId].join(','),
                    stokDisi: [e2.kaynakDepo, e2.productId, e2.rafNo, e2.urunTuru, e2.talepTuru, e2.oncelik].join(','),
                    exactKeys: Object.keys(e1).sort().join(',') === [...S.B3_KEYS].sort().join(','),
                };
                o.validatorCatches = {
                    legacyKey: S.validateB3({ ...e1, shelfNo: 'x' }).some(x => x.includes('shelfNo')),
                    missingKey: S.validateB3((({ urunTuru, ...r }) => r)(e1)).some(x => x.includes('urunTuru')),
                    badAdet: S.validateB3({ ...e1, adet: 0 }).length > 0,
                };
                o.requestStatus = ['Beklemede', '', 'approved', 'completed', 'Teslim Alındı', 'rejected', 'draft'].map(d => S.requestStatus({ durum: d })).join(',');
            } finally {
                Object.assign(window.data, { b1: orig.b1, b2: orig.b2, productTypes: orig.pt });
            }
            return o;
        });
    },

    // H4 · 3.6 b3 SÖZLEŞME TESTİ (regresyon koruması): b3'e yazan HER yol aynı kanonik alanları üretmeli. Yeni bir özellik
    // farklı biçimde b3 yazarsa bu senaryo kırılır. Yazmalar kaydedilir (stub), hiçbir şey Firestore'a gitmez.
    async b3WriteContract(page, browser) {
        const S_KEYS = () => [...window.Schema.B3_KEYS].sort().join(',');
        const out = await page.evaluate(async () => {
            const o = {}, captured = {};
            const orig = { b1: window.data.b1, req: window.data.requests, ops: window.runStockOps, apply: window.applyItemOps, exit: window.runExitTransaction, adm: window.isDbAdmin, alert: window.showAppAlert, modal: window.showRequestApprovalModal };
            window.showAppAlert = () => {};
            window.isDbAdmin = () => true;
            const b3Of = writes => writes.filter(w => w.col === 'b3').map(w => w.item);
            window.runStockOps = async arg => { captured.last = b3Of(arg.writes || []); return { stock: (arg.stock || []).map(s => ({ col: s.col, id: s.id, name: s.id, before: 5, after: 5 + s.delta })) }; };
            window.applyItemOps = async ops => { captured.last = b3Of(ops); return { written: ops.length }; };
            window.runExitTransaction = async a => { captured.last = [{ ...a.b3Entry, productId: a.productId }]; return { stock: [{ before: 5, after: 4, statusBefore: 'x', statusAfter: 'x' }] }; };
            window.data.b1 = [{ id: 'k1', ürün: 'Kablo A', tür: 'Kablo', raf: 'R-3', sütun: 'S-1', marka: 'Acme', adet: 5, durumu: 'Kullanıma Hazır' }];
            const take = () => { const v = captured.last || []; captured.last = null; return v; };
            try {
                window.openExitModal('b1', 'k1');
                document.getElementById('exitQty').value = '1'; document.getElementById('exitSn').value = 'ITSM-1'; document.getElementById('exitNote').value = 'n';
                await window.saveExit(new Event('submit')); window.closeExitModal?.();
                o.singleExit = take();

                window.openCartModal();
                window.addToCart({ item: window.data.b1[0], repo: 'b1', qty: 5 });
                document.getElementById('cartSn').value = 'ITSM-2'; document.getElementById('cartNote').value = 'n';
                await window.saveCartExit(new Event('submit')); window.closeModal?.('cartModal');
                o.cartExit = take();

                window.data.requests = [
                    { id: 9101, ürün: 'Kablo A', adet: 1, personel: 'Talep Eden', personelId: 'per_1', durum: 'Beklemede', talepTuru: 'Kalıcı Zimmet', oncelik: 'Yüksek', not: 'ITSM 0007' },
                    { id: 9102, ürün: 'Stokta olmayan ürün', adet: 2, personel: 'Talep Eden', durum: 'Beklemede', talepTuru: 'Geçici Zimmet', iadeTarihi: '2026-12-01' },
                ];
                window.showRequestApprovalModal = async r => ({ sn: 'SN-7', source: r.id === 9101 ? { repo: 'b1', productId: 'k1' } : null });
                await window.confirmRequest(9101); o.approvalWithStock = take();
                await window.confirmRequest(9102); o.approvalNoStock = take();
            } finally {
                Object.assign(window, { runStockOps: orig.ops, applyItemOps: orig.apply, runExitTransaction: orig.exit, isDbAdmin: orig.adm, showAppAlert: orig.alert, showRequestApprovalModal: orig.modal });
                window.data.b1 = orig.b1; window.data.requests = orig.req;
            }
            return o;
        });

        // admin zimmeti (admin.html)
        const admin = await (await browser.createBrowserContext()).newPage();
        const errs = []; admin.on('pageerror', e => errs.push(e.message)); admin.on('dialog', d => d.dismiss());
        await admin.evaluateOnNewDocument(() => localStorage.setItem('admin_auth', JSON.stringify({ expiry: Date.now() + 600000 })));
        await admin.goto(page.url().replace('index.html', 'admin.html'), { waitUntil: 'domcontentloaded' });
        await new Promise(r => setTimeout(r, 9000));
        out.adminAssignment = await admin.evaluate(async () => {
            if (window.COLLECTION_ROOT !== 'inventory_demo') throw new Error('root');
            const orig = { b1: window.data.b1, per: window.data.personel, ops: window.runStockOps, adm: window.isDbAdmin };
            let got = [];
            window.isDbAdmin = () => true; window.showAppAlert = () => {};
            window.runStockOps = async arg => { got = arg.writes.filter(w => w.col === 'b3').map(w => w.item); return { stock: arg.stock.map(s => ({ col: s.col, name: s.id, before: 3, after: 3 + s.delta })) }; };
            window.data.b1 = [{ id: 'lp1', ürün: 'Laptop X', tür: 'Laptop', raf: 'R-9', sütun: 'S-2', adet: 3, durumu: 'Kullanıma Hazır', isDemirbas: true }];
            window.data.personel = [...(orig.per || []), { id: 'per_ct', name: 'Sözleşme Kişi' }];
            try {
                const m = window.inventoryManagementModule;
                m.openAssignModal();
                document.getElementById('assignPersonnel').value = 'per_ct';
                const row = document.querySelector('#assignRowsContainer .assign-product-row');
                const ws = row.querySelector('.assign-warehouse-sel'); ws.value = 'b1'; m.onWarehouseChange(ws);
                const ps = row.querySelector('.assign-product-sel'); ps.value = 'lp1'; m.onProductChange(ps);
                row.querySelector('.assign-qty-inp').value = '1'; m._syncAssignDevices(row);
                row.querySelector('.dev-sn').value = 'SN-LP1';
                await m.saveAssignment(); m.closeAssignModal();
            } finally {
                Object.assign(window, { runStockOps: orig.ops, isDbAdmin: orig.adm });
                window.data.b1 = orig.b1; window.data.personel = orig.per;
            }
            return got;
        });
        out.adminPageErrors = errs;
        await admin.browserContext().close();

        // Her yol: kayıt sayısı, sözleşme hataları, anahtar kümesi, kopyalanan alanlar
        return page.evaluate(out => {
            const S = window.Schema, keys = [...S.B3_KEYS].sort().join(',');
            const summary = {};
            for (const [path, items] of Object.entries(out)) {
                if (path === 'adminPageErrors') { summary[path] = items; continue; }
                summary[path] = {
                    count: items.length,
                    errors: items.map(i => S.validateB3(i)).flat(),
                    exactKeys: items.every(i => Object.keys(i).sort().join(',') === keys),
                    fields: items.map(i => `${i.tip}|${i.kaynakDepo}|${i.rafNo}|${i.urunTuru}|${i.urunAciklama}|${i.adet}|${i.sn}|${i.alanKisi}|${i.personelId}|${i.talepTuru}|${i.onaylayan}`),
                };
            }
            return summary;
        }, out);
    },

    // H4 · 3.7 zimmet servisi: Kişi Envanterim admin'in doğrudan zimmetini gösterir (saha notu #1), iade/çıkış/teslim
    // alınmamış olanları göstermez; kişi id ile, yoksa Türkçe güvenli adla eşleşir; admin ekranı aynı kaynaktan okur.
    async h4AssignmentService(page, browser) {
        const out = await page.evaluate(async () => {
            const ft = window.__ft, o = {};
            const orig = { b3: window.data.b3, req: window.data.requests, per: window.data.personel, user: localStorage.getItem('activeUser') };
            const Z = (id, extra) => ({ id, sema: 2, tip: 'zimmet', kaynakDepo: 'b1', productId: 'p', rafNo: 'R', sutun: 'S', urunTuru: 'Laptop', urunAciklama: 'Ürün ' + id, marka: '', adet: 1, sn: 'SN' + id, envanterNo: '-', not: '-', alanKisi: 'Muhammed CER', personelId: 'per_mc', tarih: '29.09.2026', ts: Date.now() - id, isDemirbas: true, talepTuru: 'Kalıcı Zimmet', oncelik: 'Orta', iadeTarihi: null, iadeEdildi: false, iadeEdildiTarihi: null, iadeDepo: null, onaylayan: 'Admin', requestId: null, ...extra });
            window.data.personel = [{ id: 'per_mc', name: 'Muhammed CER' }, { id: 'per_x', name: 'Muhammed Cer' }];
            window.data.b3 = [
                Z(1), Z(2),                                                                     // saha: 2 kalem doğrudan zimmet
                Z(3, { personelId: null, alanKisi: '  muhammed   cer ' }),                      // eski kayıt: id yok, ad farklı yazılmış
                Z(4, { iadeEdildi: true }),                                                     // iade edilmiş → görünmez
                Z(5, { tip: 'cikis', talepTuru: null, oncelik: null }),                         // envanter çıkışı → zimmet değil
                Z(6, { requestId: 601 }),                                                       // talep onaylı, teslim alınmamış → görünmez
                Z(7, { requestId: 701 }),                                                       // talep teslim alınmış → görünür
                Z(8, { personelId: 'per_x', alanKisi: 'Muhammed Cer' }),                        // aynı adlı başka kişi → görünmez
                { id: 9, shelfNo: 'R', productType: 'Eski Zimmet', sourceRepo: 'b1', sarfAdet: 1, note: '-', alanKisi: 'MUHAMMED CER', date: '01.09.2026', talepTuru: 'Kalıcı Zimmet' }, // eski şema
            ];
            window.data.requests = [
                { id: 601, ürün: 'Talep A', personel: 'Muhammed CER', personelId: 'per_mc', durum: 'approved' },
                { id: 701, ürün: 'Talep B', personel: 'Muhammed CER', personelId: 'per_mc', durum: 'completed', teslimTarihi: '30.09.2026' },
                { id: 801, ürün: 'Eski Talep', personel: 'Başka Ad', personelKodu: '99999', durum: 'completed', sn: 'OLD1' }, // kod ile eşleşir
                { id: 802, ürün: 'Başkasının', personel: 'Muhammed Cer', personelId: 'per_x', durum: 'completed' },
            ];
            window.setActiveUser({ id: 'per_mc', name: 'Muhammed CER', code: '99999' });
            try {
                const inv = window.AssignmentService.getPersonInventory(window.getActiveUser());
                o.personInventory = inv.map(a => a.urun).sort();
                window.renderPersonnelInventoryTable();
                o.tableRows = [...document.querySelectorAll('#tablePersonnelInventory tbody tr')].map(tr => tr.querySelectorAll('td')[1]?.textContent.trim()).sort();
                o.expected = ['Eski Talep', 'Eski Zimmet', 'Ürün 1', 'Ürün 2', 'Ürün 3', 'Ürün 7'];
                o.ok = JSON.stringify(o.personInventory) === JSON.stringify(o.expected) && JSON.stringify(o.tableRows) === JSON.stringify(o.expected);
                o.receiptDateUsed = inv.find(a => a.urun === 'Ürün 7')?.teslimTarihi === '30.09.2026';
                o.otherPerson = window.AssignmentService.getPersonInventory({ id: 'per_x', name: 'Muhammed Cer' }).map(a => a.urun).sort();
                o.myRequests = {
                    own: window.AssignmentService.isMyRequest(window.data.requests[1], window.getActiveUser()),
                    sameNameOtherId: window.AssignmentService.isMyRequest(window.data.requests[3], window.getActiveUser()),
                };
                window.data.personel.push({ id: 'per_ay', name: 'Ayşe Yılmaz' });
                o.resolvePersonelId = { unique: window.AssignmentService.resolvePersonelId('AYŞE  YILMAZ'), sameNameTwoPeople: window.AssignmentService.resolvePersonelId('muhammed cer'), none: window.AssignmentService.resolvePersonelId('Yok Kişi') };
                o.legacyNameOnlyVisibleToBothSameNames = o.otherPerson.includes('Ürün 3'); // bilinen sınır: id'siz eski kayıt

                // yeni talep: personelId yazılır, erişim kodu kopyalanmaz (gerçek yazma, MARKER ile temizlenir)
                window.setActiveUser({ id: 'per_ft', name: 'Talep Kişi ' + ft.MARKER, code: '55555' });
                window.data.requests = orig.req;
                window.editingReqId = null;
                ft.set('reqProdName', 'Ürün ' + ft.MARKER); ft.set('reqQty', '1');
                await window.saveRequest(new Event('submit'));
                const saved = (await ft.readMarked('requests')).find(r => r.personel === 'Talep Kişi ' + ft.MARKER);
                o.newRequest = saved ? { personelId: saved.personelId, hasCode: 'personelKodu' in saved } : 'not saved';
            } finally {
                window.data.b3 = orig.b3; window.data.requests = orig.req; window.data.personel = orig.per;
                if (orig.user) localStorage.setItem('activeUser', orig.user); else localStorage.removeItem('activeUser');
                window.renderPersonnelInventoryTable?.();
            }
            return o;
        });

        const admin = await (await browser.createBrowserContext()).newPage();
        const errs = []; admin.on('pageerror', e => errs.push(e.message));
        await admin.evaluateOnNewDocument(() => localStorage.setItem('admin_auth', JSON.stringify({ expiry: Date.now() + 600000 })));
        await admin.goto(page.url().replace('index.html', 'admin.html'), { waitUntil: 'domcontentloaded' });
        await new Promise(r => setTimeout(r, 9000));
        out.admin = await admin.evaluate(() => {
            const orig = window.data.b3;
            window.data.b3 = [{ id: 11, sema: 2, tip: 'zimmet', kaynakDepo: 'b1', productId: 'p', urunAciklama: 'Doğrudan', adet: 1, sn: 'A1', alanKisi: 'Muhammed CER', personelId: 'per_mc', talepTuru: 'Kalıcı Zimmet', oncelik: 'Orta', iadeEdildi: false }];
            const list = window.inventoryManagementModule.getNormalizedAssignments();
            const same = window.AssignmentService.getAssignments().length === list.length;
            const direct = list.find(a => a._id === 11);
            window.data.b3 = orig;
            return { sameSourceAsStaffScreen: same, directShown: direct ? `${direct.personel}|${direct.ürün}|${direct.durum}|${direct._source}` : null };
        });
        out.adminPageErrors = errs;
        await admin.browserContext().close();
        return out;
    },

    // Faz 5 · K1: zimmet belgesi veri motoru iki sayfada da yüklü; tutanak kalemleri = Kişi Envanterim; çıktı saf JSON,
    // oturum kodu sızmaz; b3 satır belgesi aynı sözleşmede. Firestore'a yazmaz (bellek içi fikstür, sonra geri alınır).
    async k1ZimmetData(page, browser) {
        const probe = () => {
            const A = window.AssignmentService, d = window.data, CODE = 'K1-GIZLI-KOD';
            const orig = { b3: d.b3, req: d.requests, per: d.personel };
            d.personel = [{ id: 'k1_p', name: 'Şükrü İğdeli', code: CODE, birim: 'Radyoloji' }];
            d.requests = [{ id: 9101, ürün: 'Talep Ürünü', personel: 'Şükrü İğdeli', personelId: 'k1_p', durum: 'completed', approvedBy: 'Talep Onaylayan', approvedAt: '01.10.2026 09:00' }];
            d.b3 = [
                window.Schema.buildB3Entry({ id: 9001, tip: 'zimmet', adet: 1, urunAciklama: 'Latitude 5440', urunTuru: 'Dizüstü Bilgisayar', marka: 'Dell', isDemirbas: true, sn: 'K1SN1', envanterNo: 'K1ENV1', alanKisi: 'Şükrü İğdeli', personelId: 'k1_p', tarih: '01.10.2026', onaylayan: 'K1 Admin' }),
                window.Schema.buildB3Entry({ id: 9002, tip: 'zimmet', adet: 1, urunAciklama: 'Talep Ürünü', alanKisi: 'Şükrü İğdeli', personelId: 'k1_p', requestId: 9101, tarih: '01.10.2026' }),
                { ...window.Schema.buildB3Entry({ id: 9003, tip: 'zimmet', adet: 1, urunAciklama: 'İade', alanKisi: 'Şükrü İğdeli', personelId: 'k1_p' }), iadeEdildi: true },
                window.Schema.buildB3Entry({ id: 9004, tip: 'cikis', adet: 2, urunAciklama: 'Toner', alanKisi: 'Şükrü İğdeli', personelId: 'k1_p' }),
            ];
            try {
                const doc = A.generatePersonnelZimmetData('k1_p');
                const row = A.generateB3MovementData(9004);
                const json = JSON.stringify([doc, row]);
                const keysOk = r => JSON.stringify(Object.keys(r).sort()) === JSON.stringify([...A.ZIMMET_KALEM_KEYS].sort());
                return {
                    exported: typeof A.generatePersonnelZimmetData === 'function' && typeof A.generateB3MovementData === 'function',
                    sema: doc.sema,
                    kalemler: doc.kalemler.map(k => `${k.kayitId}|${k.sn}|${k.envanterNo}|${k.marka}|${k.model}|${k.zimmetleyen.ad}`),
                    sameAsPersonInventory: JSON.stringify(doc.kalemler.map(k => k.kayitId).sort()) === JSON.stringify(A.getPersonInventory(d.personel[0]).map(a => String(a.id)).sort()),
                    personel: doc.personel,
                    belgeNo: /^ZT-\d{8}-[0-9A-Z]{7}$/.test(doc.belge.belgeNo),
                    contract: doc.kalemler.every(keysOk) && row.kalemler.every(keysOk),
                    pureJson: JSON.stringify(JSON.parse(json)) === json,
                    codeLeak: json.includes(CODE),
                    movement: `${row.belge.tur}|${row.kalemler[0].durum}|${row.kalemler[0].adet}|${row.hareket.stokDisi}`,
                    unknown: A.generatePersonnelZimmetData('yok') === null && A.generateB3MovementData('yok') === null,
                };
            } finally { d.b3 = orig.b3; d.requests = orig.req; d.personel = orig.per; }
        };
        const expect = r => r.exported && r.sema === 'zimmet-belge/1' && r.sameAsPersonInventory && r.belgeNo && r.contract && r.pureJson
            && !r.codeLeak && r.unknown && r.movement === 'cikis|cikis|2|true'
            && JSON.stringify(r.kalemler) === JSON.stringify(['9001|K1SN1|K1ENV1|Dell|Latitude 5440|K1 Admin', '9002|-|-|-|Talep Ürünü|Talep Onaylayan'])
            && JSON.stringify(r.personel) === JSON.stringify({ id: 'k1_p', adSoyad: 'Şükrü İğdeli', birim: 'Radyoloji' });

        const out = { index: await page.evaluate(probe) };
        const admin = await (await browser.createBrowserContext()).newPage();
        const errs = []; admin.on('pageerror', e => errs.push(e.message));
        await admin.evaluateOnNewDocument(() => localStorage.setItem('admin_auth', JSON.stringify({ expiry: Date.now() + 600000 })));
        await admin.goto(page.url().replace('index.html', 'admin.html'), { waitUntil: 'domcontentloaded' });
        await new Promise(r => setTimeout(r, 6000));
        try { out.admin = await admin.evaluate(probe); } finally { out.adminPageErrors = errs; await admin.browserContext().close(); }
        out.ok = expect(out.index) && expect(out.admin) && errs.length === 0;
        if (!out.ok) throw new Error('K1 zimmet verisi beklenen sözleşmede değil: ' + JSON.stringify(out));
        return out;
    },

    // Faz 5 · K1 (5.1 · ZIM-04): zimmet tutanağı PDF motoru — gerçek jsPDF + AutoTable + gömülü Türkçe (Roboto) fontla,
    // iki sayfada da (personel butonu / admin satır butonu). doc.save() stub'lanır (gerçek indirme tetiklenmez).
    async k1ZimmetPdf(page, browser) {
        const pdfProbe = async () => {
            const CODE = 'K1PDF-GIZLI-KOD';
            const orig = { b3: window.data.b3, req: window.data.requests, per: window.data.personel };
            window.data.personel = [
                { id: 'k1pdf_p', name: 'Şükrü İğdeli', code: CODE, birim: 'Radyoloji' },
                { id: 'k1pdf_bos', name: 'Boş Kişi', code: 'OTHER-CODE' },
            ];
            window.data.requests = [];
            window.data.b3 = [
                window.Schema.buildB3Entry({ id: 95001, tip: 'zimmet', adet: 1, urunAciklama: 'Latitude 5440', urunTuru: 'Dizüstü Bilgisayar', marka: 'Dell', isDemirbas: true, sn: 'PDFSN1', envanterNo: 'PDFENV1', alanKisi: 'Şükrü İğdeli', personelId: 'k1pdf_p', tarih: '01.10.2026', onaylayan: 'K1 Admin' }),
                window.Schema.buildB3Entry({ id: 95002, tip: 'cikis', adet: 3, urunAciklama: 'Toner', alanKisi: 'Şükrü İğdeli', personelId: 'k1pdf_p' }),
            ];

            // jsPDF her 'new jsPDF()' çağrısında API yöntemlerini (save dahil) instance'a KENDİ ÖZELLİĞİ olarak kopyalar;
            // jsPDF.prototype.save'i stub'lamak yeni örnekleri etkilemez — kaynak jsPDF.API.save'dir (ikisi ayrı nesne).
            const JsPDFCtor = window.jspdf.jsPDF;
            const origSave = JsPDFCtor.API.save;
            const saves = [];
            JsPDFCtor.API.save = function (filename) {
                saves.push({ filename, pages: this.internal.getNumberOfPages(), fonts: Object.keys(this.getFontList()) });
                return this;
            };
            const alerts = [];
            const origAlert = window.showAppAlert;
            window.showAppAlert = (msg, type) => alerts.push({ msg, type });

            try {
                await window.generatePersonnelZimmetPDF('k1pdf_p');           // 1 geçerli kalem (95002 'cikis' sayılmaz) → PDF
                await window.generateZimmetPDF(95002);                        // tekil çıkış hareketi → PDF üretilir
                await window.generatePersonnelZimmetPDF('k1pdf_bos');         // 0 kalem → uyarı, save yok
                await window.generatePersonnelZimmetPDF('yok-kisi');          // bulunamadı → hata, save yok
                await window.generateZimmetPDF('yok-b3');                     // bulunamadı → hata, save yok

                // Çok kalemli belge: imza bloğu taşarsa yeni sayfa açma + "Sayfa X / Y" regresyonu
                await window.AppModules.ZimmetPdf.ensureZimmetFonts();
                const bigRows = Array.from({ length: 40 }, (_, i) => ({
                    sira: i + 1, kayitId: String(9000 + i), kaynak: 'b3', envanterNo: 'E' + i, sn: 'S' + i,
                    urunTuru: 'Tür', urunAciklama: 'Ürün ' + i, marka: 'Marka', model: 'Model', adet: 1, isDemirbas: true,
                    tarih: '01.10.2026', teslimTarihi: '01.10.2026', talepTuru: 'Kalıcı Zimmet', oncelik: 'Orta', iadeTarihi: '-',
                    talepNo: '-', zimmetleyen: { ad: 'Admin', tarih: '01.10.2026' }, not: '-', durum: 'aktif', iadeEdildiTarihi: '-',
                }));
                const bigDoc = {
                    sema: 'zimmet-belge/1',
                    belge: { tur: 'personel-zimmet', belgeNo: 'ZT-TEST-BIG', olusturmaTarihi: '01.10.2026 10:00', duzenleyen: 'Test Admin', talepNolari: [], teslimEdenler: ['Admin'] },
                    personel: { id: 'k1pdf_p', adSoyad: 'Şükrü İğdeli', birim: 'Radyoloji' },
                    kalemler: bigRows,
                    ozet: { kalemSayisi: 40, toplamAdet: 40, demirbasAdet: 40, sarfAdet: 0, geciciZimmet: 0, teslimBekleyen: 0 },
                };
                const bigPdf = window.AppModules.ZimmetPdf.renderZimmetTutanagi(bigDoc, 'DEMİRBAŞ VE MALZEME ZİMMET TUTANAĞI');

                return {
                    saves: saves.map(s => ({ filename: s.filename, pages: s.pages, hasRoboto: s.fonts.includes('Roboto') })),
                    alertTypes: alerts.map(a => a.type),
                    codeLeakInFilenames: saves.some(s => s.filename.includes(CODE)),
                    bigDocPages: bigPdf.internal.getNumberOfPages(),
                };
            } finally {
                JsPDFCtor.API.save = origSave;
                window.showAppAlert = origAlert;
                window.data.b3 = orig.b3; window.data.requests = orig.req; window.data.personel = orig.per;
            }
        };

        const buttonProbe = () => {
            const btn = [...document.querySelectorAll('#personnelInventoryTab button')].find(b => /Zimmet Tutana/.test(b.textContent));
            return { found: !!btn, callsFn: btn ? /generatePersonnelZimmetPDF/.test(btn.getAttribute('onclick') || '') : false };
        };

        const expect = r => JSON.stringify(r.saves.map(s => s.pages > 0 && s.hasRoboto)) === JSON.stringify([true, true])
            && r.saves.length === 2 && !r.codeLeakInFilenames
            && JSON.stringify(r.alertTypes) === JSON.stringify(['warning', 'error', 'error'])
            && r.bigDocPages >= 2;

        const out = { index: await page.evaluate(pdfProbe), indexButton: await page.evaluate(buttonProbe) };

        const admin = await (await browser.createBrowserContext()).newPage();
        const errs = []; admin.on('pageerror', e => errs.push(e.message));
        await admin.evaluateOnNewDocument(() => localStorage.setItem('admin_auth', JSON.stringify({ expiry: Date.now() + 600000 })));
        await admin.goto(page.url().replace('index.html', 'admin.html'), { waitUntil: 'domcontentloaded' });
        await new Promise(r => setTimeout(r, 6000));
        try {
            out.admin = await admin.evaluate(pdfProbe);
            out.adminButton = await admin.evaluate(() => {
                const orig = window.data.b3;
                window.data.b3 = [window.Schema.buildB3Entry({ id: 95901, tip: 'zimmet', adet: 1, urunAciklama: 'Admin Satır Testi', alanKisi: 'Şükrü İğdeli', personelId: 'k1pdf_row' })];
                window.inventoryManagementModule.renderAdminInventoryTab();   // #invTableBody iskeleti bu çağrıyla kurulur
                const btn = [...document.querySelectorAll('#invTableBody button')].find(b => /Tutanak/.test(b.textContent));
                const result = { found: !!btn, callsFn: btn ? btn.getAttribute('onclick') : null };
                window.data.b3 = orig;
                return result;
            });
        } finally { out.adminPageErrors = errs; await admin.browserContext().close(); }

        out.ok = expect(out.index) && expect(out.admin) && out.indexButton.found && out.indexButton.callsFn
            && out.adminButton.found && /generatePersonnelZimmetPDF\("k1pdf_row"\)/.test(out.adminButton.callsFn || '')
            && errs.length === 0;
        if (!out.ok) throw new Error('K1 zimmet PDF motoru beklendiği gibi çalışmadı: ' + JSON.stringify(out));
        return out;
    },

    // Faz 5 · K2 (5.8): B1 şema sözleşmesi — sarf örneği (isDemirbas:false). _stockContractBody ortak sürücüyü kullanır.
    async b1WriteContract(page) {
        const out = await page.evaluate(_stockContractBody, 'b1');
        const noErr = x => x.length === 0;
        out.ok = out.addNew.exactKeys && noErr(out.addNew.errors)
            && JSON.stringify(out.editExisting.ops) === JSON.stringify(['update']) && out.editExisting.knownKeysOnly
            && JSON.stringify(out.internalFullMove.sourceOps) === JSON.stringify(['delete']) && noErr(out.internalFullMove.targetErrors) && out.internalFullMove.sameId
            && out.internalPartial.sourceOp === 'update' && out.internalPartial.sourceFieldsKnownOnly && noErr(out.internalPartial.targetErrors) && out.internalPartial.newIdDiffers
            && out.scrap.stockDelta.col === 'b1' && out.scrap.stockDelta.delta === -2 && out.scrap.b3Count === 1 && noErr(out.scrap.b3Errors)
            && JSON.stringify(out.scrap.b3Tips) === JSON.stringify(['hurda']) && out.scrap.serviceClosed;
        if (!out.ok) throw new Error('b1WriteContract beklenen sözleşmede değil: ' + JSON.stringify(out));
        return out;
    },

    // Faz 5 · K2 (5.8): B2 şema sözleşmesi — demirbaş örneği (isDemirbas:true, status+durumu birlikte, cihaz kimlikli hurda).
    async b2WriteContract(page) {
        const out = await page.evaluate(_stockContractBody, 'b2');
        const noErr = x => x.length === 0;
        out.ok = out.addNew.exactKeys && noErr(out.addNew.errors)
            && JSON.stringify(out.editExisting.ops) === JSON.stringify(['update']) && out.editExisting.knownKeysOnly
            && JSON.stringify(out.internalFullMove.sourceOps) === JSON.stringify(['delete']) && noErr(out.internalFullMove.targetErrors) && out.internalFullMove.sameId
            && out.internalPartial.sourceOp === 'update' && out.internalPartial.sourceFieldsKnownOnly && noErr(out.internalPartial.targetErrors) && out.internalPartial.newIdDiffers
            // demirbaş: scrapQty=2 → her cihaz için adet 1 olan ayrı birer b3 hurda kaydı; ilgisiz SN'li açık servis
            // kaydı (başka bir cihaz) kapanmamalı — eşleşme productId'ye değil cihaz kimliğine göredir
            && out.scrap.stockDelta.col === 'b2' && out.scrap.stockDelta.delta === -2 && out.scrap.b3Count === 2 && noErr(out.scrap.b3Errors)
            && JSON.stringify(out.scrap.b3Tips) === JSON.stringify(['hurda']) && !out.scrap.serviceClosed;
        if (!out.ok) throw new Error('b2WriteContract beklenen sözleşmede değil: ' + JSON.stringify(out));
        return out;
    },

    // Faz 5 · K2 (5.8 · INV-05/INV-07): B1 tablosunda sayfalama + durum filtresi kararlılığı. Gerçek main.js olay
    // yöneticisini (onInventoryDataUpdated) ve gerçek table-engine.js render/patch yollarını sürer.
    async k2TableUx(page) {
        const out = await page.evaluate(() => {
            const T = window.AppModules.Table;
            const orig = {
                b1: window.data.b1,
                filterVal: document.getElementById('b1StatusFilter').value,
                searchVal: document.getElementById('searchB1').value,
                firstRendered: window._firstDataRendered,
            };
            const o = {};
            try {
                document.getElementById('b1StatusFilter').value = 'active';
                document.getElementById('searchB1').value = '';
                window.data.b1 = Array.from({ length: 60 }, (_, i) => ({
                    id: 'k2tbl_' + i, ürün: 'K2 Ürün ' + i, tür: 'Test', raf: 'R', sütun: 'S',
                    marka: 'X', adet: 5, durumu: 'Kullanıma Hazır', açıklama: '', isDemirbas: false, lastUpdate: Date.now(),
                }));
                window._firstDataRendered = true;   // main.js'in "ilk yükleme" dalını atlaması için (switchTab tetiklemesin)

                // 1) Tam çizim (sayfa 1) + "Daha Fazla Yükle" ile sayfa 2
                T.renderTable('b1');
                o.page1Rows = document.querySelectorAll('#tableB1 tbody tr').length;
                document.getElementById('loadMoreBtn')?.click();
                o.page2Rows = document.querySelectorAll('#tableB1 tbody tr').length;

                // 2) Canlı "tam yeniden çizim" güncellemesi (isPatch:false, main.js'in gerçek olay yöneticisi üzerinden) →
                //    sayfa 2'de açılan satırlar KORUNMALI (Faz 5 öncesi: _currentPage=1'e sıfırlanıp 25'e düşerdi).
                window.dispatchEvent(new CustomEvent('onInventoryDataUpdated', { detail: { collection: 'b1', isPatch: false, changes: [] } }));
                o.rowsAfterLiveUpdate = document.querySelectorAll('#tableB1 tbody tr').length;

                // 3) Bileşik durum metni ("Tükendi / Pasif") artık tam eşleşme değil alt dize eşleşmesiyle elenir
                window.data.b1[0].durumu = 'Tükendi / Pasif';
                T.renderTable('b1');
                o.compoundPassiveHiddenByFullRender = !document.querySelector('tr[data-depo="b1"][data-id="k2tbl_0"]');

                // 4) patchDOMForCollection artık aktif filtreye göre satırı KALDIRIR (eskiden yalnız stilini değiştirirdi,
                //    satır DOM'da "hayalet" kalırdı). Hâlâ görünür bir satır (k2tbl_5) seçilip patch'le Pasif yapılır.
                o.visibleBeforePatch = !!document.querySelector('tr[data-depo="b1"][data-id="k2tbl_5"]');
                window.dispatchEvent(new CustomEvent('onInventoryDataUpdated', {
                    detail: { collection: 'b1', isPatch: true, changes: [{ id: 'k2tbl_5', data: { durumu: 'Tükendi / Pasif', adet: 0 } }] },
                }));
                o.removedByPatchUnderActiveFilter = !document.querySelector('tr[data-depo="b1"][data-id="k2tbl_5"]');

                // 5) Regresyon: filtre "Tümü" iken patch satırı KALDIRMAZ, yalnız stilini günceller
                document.getElementById('b1StatusFilter').value = 'all';
                T.renderTable('b1');
                o.visibleUnderAllFilter = !!document.querySelector('tr[data-depo="b1"][data-id="k2tbl_6"]');
                window.dispatchEvent(new CustomEvent('onInventoryDataUpdated', {
                    detail: { collection: 'b1', isPatch: true, changes: [{ id: 'k2tbl_6', data: { durumu: 'Pasif', adet: 0 } }] },
                }));
                const row6 = document.querySelector('tr[data-depo="b1"][data-id="k2tbl_6"]');
                o.keptUnderAllFilterButStyled = !!row6 && row6.classList.contains('passive-row');
            } finally {
                window.data.b1 = orig.b1;
                document.getElementById('b1StatusFilter').value = orig.filterVal;
                document.getElementById('searchB1').value = orig.searchVal;
                window._firstDataRendered = orig.firstRendered;
                T.renderTable('b1');
            }
            return o;
        });
        out.ok = out.page1Rows === 25 && out.page2Rows === 50 && out.rowsAfterLiveUpdate === 50
            && out.compoundPassiveHiddenByFullRender === true
            && out.visibleBeforePatch === true && out.removedByPatchUnderActiveFilter === true
            && out.visibleUnderAllFilter === true && out.keptUnderAllFilterButStyled === true;
        if (!out.ok) throw new Error('k2TableUx beklenen sözleşmede değil: ' + JSON.stringify(out));
        return out;
    },

    // Faz 5 · K3: Özel İzleme Paneli onarımı (ADM-05), Hızlı Personel/Ürün Ekleme (5.2 · ZIM-05), merkezi
    // AppModules.AdminTabs kanca sicili (5.7 · ARC-07). Tamamı admin.html üzerinde, gerçek fonksiyonlarla.
    async k3AdminTabHooks(page, browser) {
        const admin = await (await browser.createBrowserContext()).newPage();
        const errs = []; admin.on('pageerror', e => errs.push(e.message)); admin.on('dialog', d => d.dismiss());
        await admin.evaluateOnNewDocument(() => localStorage.setItem('admin_auth', JSON.stringify({ expiry: Date.now() + 600000 })));
        await admin.goto(page.url().replace('index.html', 'admin.html'), { waitUntil: 'domcontentloaded' });
        await new Promise(r => setTimeout(r, 9000));
        let out;
        try {
            out = await admin.evaluate(async () => {
                const o = {};
                const orig = {
                    b1: window.data.b1, b2: window.data.b2, personel: window.data.personel, types: window.data.productTypes,
                    append: window.appendItem, isDbAdmin: window.isDbAdmin, checkIsAdmin: window.checkIsAdmin, alert: window.showAppAlert,
                    provision: window.provisionStaffAccount,
                };
                window.isDbAdmin = () => true; window.checkIsAdmin = () => true; window.showAppAlert = () => {};
                // appendItem gerçek applyItemOps'un _applyLocal'ını taklit eder: window.data[col]'a id'li kayıt eklenir.
                const captured = []; let idSeq = 0;
                window.appendItem = async (col, item) => {
                    const withId = { ...item, id: item.id ?? ('k3test_' + (++idSeq)) };
                    captured.push({ col, item: withId });
                    (window.data[col] = window.data[col] || []).unshift(withId);
                    return { written: 1, ids: [withId.id] };
                };
                // Faz 4B · J7: hızlı personel ekleme hesap da açar — yazma taklit edildiği için hesap açma da yakalanır (aksi hâlde
                // admin kapısı taklit edilmişken gerçek Firebase Auth'a hesap açma isteği giderdi).
                const provisioned = [];
                window.provisionStaffAccount = async person => { provisioned.push(person); return { status: 'created', uid: 'k3uid', email: 'x' }; };

                try {
                    // ── ADM-05: renderCustomWatchDashboard ikinci (ve sonraki) çağrıda da çiziyor mu? ──
                    window.data.b1 = [{ id: 'k3w_1', ürün: 'K3 İzlenen Ürün', marka: 'X', adet: 2, limit: 5, isWatched: true }];
                    window.data.b2 = [];
                    window.renderCustomWatchDashboard();
                    o.tableExistsAfterFirstRender = !!document.getElementById('customWatchTable');
                    o.cardAfterFirst = !!document.querySelector('#watchCardsContainer .watch-card');
                    window.data.b1[0].ürün = 'K3 İzlenen Ürün (Güncellendi)';
                    window.renderCustomWatchDashboard();   // eskiden burada table silindiği için ikinci çağrı hiçbir şey yapmazdı
                    o.tableExistsAfterSecondRender = !!document.getElementById('customWatchTable');
                    o.cardUpdatedAfterSecond = (document.querySelector('#watchCardsContainer .watch-card .title')?.textContent || '').includes('Güncellendi');

                    // ── ARC-07: merkezi kanca sicili gerçekten çalışıyor mu? ──
                    o.hasAdminTabsApi = !!(window.AppModules?.AdminTabs?.onShow && window.AppModules?.AdminTabs?.onAny);
                    let invHookFired = false;
                    window.AppModules.AdminTabs.onShow('inventoryManagementTab', () => { invHookFired = true; });
                    let wfRendered = false;
                    const origWf = window.renderWorkflowTemplates;
                    window.renderWorkflowTemplates = function (...a) { wfRendered = true; return origWf.apply(this, a); };
                    let invRendered = false;
                    const origInv = window.inventoryManagementModule.renderAdminInventoryTab;
                    window.inventoryManagementModule.renderAdminInventoryTab = function (...a) { invRendered = true; return origInv.apply(this, a); };

                    window.showAdminTab('inventoryManagementTab');
                    await new Promise(r => setTimeout(r, 30));
                    o.inventoryTabHookFired = invRendered && invHookFired;
                    window.showAdminTab('workflowTemplatesTab');
                    o.workflowTabHookFired = wfRendered;
                    window.showAdminTab('systemControlTab');
                    o.vipActiveClassAdded = document.querySelector('.sidebar')?.classList.contains('vip-active') ?? null;
                    window.showAdminTab('dashboard-content');
                    o.vipActiveClassRemoved = !(document.querySelector('.sidebar')?.classList.contains('vip-active'));

                    window.inventoryManagementModule.renderAdminInventoryTab = origInv;
                    window.renderWorkflowTemplates = origWf;

                    // ── ZIM-05: hızlı ekleme butonları gerçekten kayıt oluşturup dropdown'ı tazeliyor mu? ──
                    window.data.personel = [];
                    window.data.productTypes = [{ name: 'K3 Demirbaş Tür', isDemirbas: true }, { name: 'K3 Sarf Tür', isDemirbas: false }];
                    window.inventoryManagementModule.openAssignModal();

                    window.inventoryManagementModule.quickAddPersonnel();
                    o.personnelModalOpened = document.getElementById('quickPersonnelModal')?.style.display === 'flex';
                    document.getElementById('qpName').value = 'K3 Test Personel';
                    await window.inventoryManagementModule._saveQuickPersonnel();
                    o.personnelCreated = captured.some(c => c.col === 'personel' && c.item.name === 'K3 Test Personel');
                    o.personnelAccountRequested = provisioned.length === 1 && provisioned[0].name === 'K3 Test Personel' && captured.some(c => c.col === 'personel' && String(c.item.id) === String(provisioned[0].id));
                    const selPersonVal = document.getElementById('assignPersonnel')?.value;
                    o.personnelAutoSelected = !!selPersonVal && window.data.personel.some(p => String(p.id) === selPersonVal && p.name === 'K3 Test Personel');

                    window.inventoryManagementModule.quickAddProduct();
                    o.productModalOpened = document.getElementById('quickProductModal')?.style.display === 'flex';
                    o.productTypeOptionsOnlyDemirbas = [...document.querySelectorAll('#qpType option')].every(opt => opt.value === 'K3 Demirbaş Tür');
                    document.getElementById('qpType').value = 'K3 Demirbaş Tür';
                    document.getElementById('qpName2').value = 'K3 Test Ürün';
                    document.getElementById('qpQty').value = '3';
                    await window.inventoryManagementModule._saveQuickProduct();
                    const createdProduct = captured.find(c => c.col === 'b1' && c.item.ürün === 'K3 Test Ürün');
                    o.productCreated = !!createdProduct;
                    o.productIsDemirbas = createdProduct?.item.isDemirbas === true;
                    o.productSchemaErrors = createdProduct ? window.Schema.validateB1(createdProduct.item) : ['kayıt yok'];
                    const prodRowVal = document.querySelector('#assignRowsContainer .assign-product-sel')?.value;
                    o.productRowAutoSelected = !!createdProduct && prodRowVal === createdProduct.item.id;
                } finally {
                    Object.assign(window, { appendItem: orig.append, isDbAdmin: orig.isDbAdmin, checkIsAdmin: orig.checkIsAdmin, showAppAlert: orig.alert, provisionStaffAccount: orig.provision });
                    window.data.b1 = orig.b1; window.data.b2 = orig.b2; window.data.personel = orig.personel; window.data.productTypes = orig.types;
                    window.inventoryManagementModule.closeAssignModal();
                    window.inventoryManagementModule.closeQuickPersonnelModal?.();
                    window.inventoryManagementModule.closeQuickProductModal?.();
                }
                return o;
            });
        } finally {
            out = out || {};
            out.adminPageErrors = errs;
            await admin.browserContext().close();
        }
        out.ok = out.tableExistsAfterFirstRender && out.cardAfterFirst && out.tableExistsAfterSecondRender && out.cardUpdatedAfterSecond
            && out.hasAdminTabsApi && out.inventoryTabHookFired && out.workflowTabHookFired
            && out.vipActiveClassAdded === true && out.vipActiveClassRemoved === true
            && out.personnelModalOpened && out.personnelCreated && out.personnelAccountRequested && out.personnelAutoSelected
            && out.productModalOpened && out.productTypeOptionsOnlyDemirbas && out.productCreated && out.productIsDemirbas
            && (out.productSchemaErrors || []).length === 0 && out.productRowAutoSelected
            && out.adminPageErrors.length === 0;
        if (!out.ok) throw new Error('k3AdminTabHooks beklenen sözleşmede değil: ' + JSON.stringify(out));
        return out;
    },

    // Faz 5 · K3 (5.3 · ADM-06 + 5.5 · VIP-08): birleşik yedekleme servisi (iki sayfada aynı kanonik biçim, ortam denetimi,
    // önizlemeli onay, başarısızlıkta bellek geri dönüşü) ve VIP sağlık döngüsünün yalnız VIP sekmesi görünürken çalışması.
    // İndirme (_download) ve yazma (restoreCollections — Faz 5 denetimi P0 atomik yol) yakalanır; Firestore'a hiçbir şey yazılmaz.
    async k3BackupAndVipLoop(page, browser) {
        const out = {};
        // index.html: UAB "Yedek Al" de aynı kanonik biçimi üretir
        out.index = await page.evaluate(() => {
            const S = window.BackupService, orig = { dl: S && S._download, chk: window.checkIsAdmin, alert: window.showAppAlert };
            if (!S) return { loaded: false };
            let file = null;
            S._download = (name, json) => { file = { name, json }; };
            window.checkIsAdmin = () => true; window.showAppAlert = () => {};
            try { window.exportFirebaseBackup(); } finally { S._download = orig.dl; window.checkIsAdmin = orig.chk; window.showAppAlert = orig.alert; }
            const b = file ? JSON.parse(file.json) : {};
            return { loaded: true, name: file && file.name, version: b.version, root: b.root, source: b.source,
                     keysOk: Object.keys(b.data || {}).every(k => window.COLLECTIONS.includes(k)), envelope: Object.keys(b).sort().join(',') };
        });

        const admin = await (await browser.createBrowserContext()).newPage();
        const errs = []; admin.on('pageerror', e => errs.push(e.message)); admin.on('dialog', d => d.dismiss());
        await admin.evaluateOnNewDocument(() => localStorage.setItem('admin_auth', JSON.stringify({ expiry: Date.now() + 600000 })));
        await admin.goto(page.url().replace('index.html', 'admin.html'), { waitUntil: 'domcontentloaded' });
        await new Promise(r => setTimeout(r, 9000));
        try {
            out.admin = await admin.evaluate(async () => {
                const o = {}, S = window.BackupService;
                o.loaded = !!S;
                o.vipRestoreInjected = !!document.getElementById('vipRestoreBtn') && !!document.getElementById('vipRestoreInput');
                const orig = { dl: S._download, save: window.restoreCollections, adm: window.isDbAdmin, conf: window.showCustomConfirm, alert: window.showAppAlert, data: window.data, reload: S.reloadAfterRestore };
                const alerts = [], saves = [], confirms = [];
                let answer = true, saveFails = false;
                let vipFile = null;
                S._download = (name, json) => { vipFile = { name, json }; };
                S.reloadAfterRestore = false;
                window.showAppAlert = (m, t) => alerts.push(t);
                window.isDbAdmin = () => true;
                window.showCustomConfirm = async (title, node, opts) => { confirms.push({ text: node.textContent, confirmText: opts && opts.confirmText }); return answer; };
                window.restoreCollections = async (obj, opts) => { if (saveFails) throw Object.assign(new Error('parça 2/3 düştü (test)'), { code: 'rolled-back' }); saves.push({ b1: obj.b1, keys: Object.keys(obj), opts }); return { status: 'committed' }; };
                const root = window.COLLECTION_ROOT;
                const canon = (r, b1) => JSON.stringify({ version: '3.2', root: r, timestamp: '2026-10-13T00:00:00Z', source: 'vip', data: { b1 } });
                try {
                    // VIP "1-Tık DB Snapshot" → kanonik yedek
                    window.vipBackupDatabase();
                    const vb = vipFile ? JSON.parse(vipFile.json) : {};   // dosya içeriği rapora girmez (seed'deki kodlar dahil)
                    o.vipExport = { version: vb.version, root: vb.root, source: vb.source, envelope: Object.keys(vb).sort().join(','),
                                    noAuditLogs: !('auditLogs' in (vb.data || {})), keysOk: Object.keys(vb.data || {}).every(k => window.COLLECTIONS.includes(k)) };

                    // 1) farklı ortamın yedeği → engellenir, onay bile sorulmaz, yazma yok
                    o.wrongRoot = (await S.restoreFromText(canon(root === 'inventory_demo' ? 'lifeserver_master' : 'inventory_demo', [{ id: 'x' }]))).status;
                    o.wrongRootNoConfirm = confirms.length === 0 && saves.length === 0;
                    // 2) geçersiz dosya
                    o.invalid = (await S.restoreFromText('{bozuk json')).status;
                    // 3) doğru ortam, kullanıcı vazgeçer → yazma yok
                    answer = false;
                    o.cancelled = (await S.restoreFromText(canon(root, [{ id: 'k3bk_1', ürün: 'Yedek Ürün' }]))).status;
                    o.cancelNoWrite = saves.length === 0;
                    o.previewText = confirms[0] && confirms[0].text;
                    // 4) doğru ortam, onay → restoreCollections (atomik) tek çağrı, yalnız yedekteki koleksiyon, kanonik b1
                    answer = true;
                    const restored = await S.restoreFromText(canon(root, [{ id: 'k3bk_1', ürün: 'Yedek Ürün' }]));
                    o.restored = restored.status;
                    o.restoreWrite = saves.length === 1 && saves[0].b1.length === 1 && saves[0].b1[0].id === 'k3bk_1'
                        && saves[0].keys.join() === 'b1' && saves[0].opts.b3Legacy === true
                        && window.Schema.validateB1(saves[0].b1[0]).length === 0;
                    o.summaryB1 = (restored.summary || []).find(s => s.col === 'b1');
                    // 5) eski VIP ham dökümü → doğrulanmamış uyarısı + ayrı onay metni
                    const before = confirms.length;
                    o.legacy = (await S.restoreFromText(JSON.stringify({ b1: [{ id: 'old1' }], auditLogs: [{ id: 'a' }] }))).status;
                    o.legacyPreview = confirms[before] && { verifiedWarn: /ortam bilgisi yok/i.test(confirms[before].text), auditSkipped: /auditLogs/.test(confirms[before].text), confirmText: confirms[before].confirmText };
                    // 6) yazma başarısız (motor yazılan parçaları geri aldı) → bellek hiç değişmez, sonuç kodu taşınır
                    saveFails = true;
                    const dataBefore = window.data;
                    const failedRes = await S.restoreFromText(canon(root, [{ id: 'k3bk_2' }]));
                    o.failed = failedRes.status; o.failedCode = failedRes.code;
                    o.memoryRolledBack = window.data === dataBefore;
                    saveFails = false;
                    // 7) admin olmayan oturum → hiçbir şey sorulmaz
                    window.isDbAdmin = () => false;
                    const c0 = confirms.length;
                    o.forbidden = (await S.restoreFromText(canon(root, [{ id: 'x' }]))).status;
                    o.forbiddenNoConfirm = confirms.length === c0;
                } finally {
                    S._download = orig.dl; S.reloadAfterRestore = orig.reload;
                    Object.assign(window, { restoreCollections: orig.save, isDbAdmin: orig.adm, showCustomConfirm: orig.conf, showAppAlert: orig.alert });
                    window.data = orig.data;
                }

                // ── VIP-08: sağlık döngüsü yalnız VIP sekmesi görünürken ──
                const H = window.AppModules.VipHealth, wait = ms => new Promise(r => setTimeout(r, ms));
                o.vip = { api: !!H, idleBeforeOpen: H && !H.isRunning() };
                window.showAdminTab('systemControlTab'); await wait(1600);
                o.vip.runningInVip = H.isRunning();
                const t1 = H.ticks(); o.vip.ticksInVip = t1 > 0;
                window.showAdminTab('dashboard-content'); await wait(50);
                o.vip.stoppedAfterLeave = !H.isRunning();
                const t2 = H.ticks(); await wait(2200);
                o.vip.noTicksWhileAway = H.ticks() === t2;
                window.showAdminTab('systemControlTab'); await wait(400);
                o.vip.restartedOnReturn = H.isRunning();
                // tarayıcı sekmesi arka plana → durur; öne → yeniden başlar
                Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
                document.dispatchEvent(new Event('visibilitychange'));
                o.vip.stoppedWhenHidden = !H.isRunning();
                Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
                document.dispatchEvent(new Event('visibilitychange'));
                o.vip.resumedWhenVisible = H.isRunning();
                delete document.hidden;
                window.showAdminTab('dashboard-content'); await wait(50);
                o.vip.finalStopped = !H.isRunning();
                return o;
            });
        } finally {
            out.adminPageErrors = errs;
            await admin.browserContext().close();
        }

        const a = out.admin || {}, v = a.vip || {};
        const canonEnv = 'data,root,source,timestamp,version';
        out.ok = out.index.loaded && out.index.version === '3.2' && out.index.root === 'inventory_demo' && out.index.source === 'admin'
            && out.index.envelope === canonEnv && out.index.keysOk
            && a.loaded && a.vipRestoreInjected
            && a.vipExport.version === '3.2' && a.vipExport.root === 'inventory_demo' && a.vipExport.source === 'vip'
            && a.vipExport.envelope === canonEnv && a.vipExport.noAuditLogs && a.vipExport.keysOk
            && a.wrongRoot === 'wrong-root' && a.wrongRootNoConfirm && a.invalid === 'invalid'
            && a.cancelled === 'cancelled' && a.cancelNoWrite && /Ortam eşleşiyor/.test(a.previewText || '') && /Silinecek/.test(a.previewText || '')
            && a.restored === 'restored' && a.restoreWrite && a.summaryB1 && a.summaryB1.backup === 1
            && a.legacy === 'restored' && a.legacyPreview && a.legacyPreview.verifiedWarn && a.legacyPreview.auditSkipped
            && /Doğrulanmamış/.test(a.legacyPreview.confirmText || '')
            && a.failed === 'failed' && a.failedCode === 'rolled-back' && a.memoryRolledBack && a.forbidden === 'forbidden' && a.forbiddenNoConfirm
            && v.api && v.idleBeforeOpen && v.runningInVip && v.ticksInVip && v.stoppedAfterLeave && v.noTicksWhileAway
            && v.restartedOnReturn && v.stoppedWhenHidden && v.resumedWhenVisible && v.finalStopped
            && out.adminPageErrors.length === 0;
        if (!out.ok) throw new Error('k3BackupAndVipLoop beklenen sözleşmede değil: ' + JSON.stringify(out));
        return out;
    },

    // H4 · 3.6 VIP Şema Göçü: gerçek demo b3'ünde SALT OKUNUR önizleme; yazma yolu stub ile (yedek önce, 400'lük parçalar,
    // sözleşme dışı kayda dokunulmaz, tekrar çalıştırma 0 kayıt, personel oturumu reddedilir). Firestore'a yazılmaz.
    async h4SchemaMigration(page, browser) {
        const admin = await (await browser.createBrowserContext()).newPage();
        const errs = []; admin.on('pageerror', e => errs.push(e.message)); admin.on('dialog', d => d.dismiss());
        await admin.evaluateOnNewDocument(() => localStorage.setItem('admin_auth', JSON.stringify({ expiry: Date.now() + 600000 })));
        await admin.goto(page.url().replace('index.html', 'admin.html'), { waitUntil: 'domcontentloaded' });
        await new Promise(r => setTimeout(r, 9000));
        const out = await admin.evaluate(async () => {
            if (window.COLLECTION_ROOT !== 'inventory_demo') throw new Error('root');
            const o = {};
            // 1) gerçek demo verisinde önizleme (yazma yok)
            const real = window.planB3Migration();
            o.demoPreview = { total: real.total, alreadyCanonical: real.alreadyCanonical, convert: real.convert.length, invalid: real.invalid, stats: real.stats,
                              viewUnchanged: real.convert.every(c => { const before = (window.data.b3 || []).find(b => String(b.id) === String(c.id)); const v = x => { const n = window.Schema.normalizeB3(x); return [n.rafNo, n.urunTuru, n.urunAciklama, n.sn, n.adet, n.not, n.alanKisi, n.tarih].join('|'); }; return v(before) === v(c); }) };

            // 2) yazma yolu (stub)
            const orig = { b3: window.data.b3, per: window.data.personel, apply: window.applyItemOps, adm: window.isDbAdmin, conf: window.showCustomConfirm, alert: window.showAppAlert, click: HTMLAnchorElement.prototype.click };
            const events = [], alerts = [];
            window.showAppAlert = (m, t) => alerts.push([t, m]);
            window.showCustomConfirm = async (title, msg) => { events.push('confirm'); o.confirmText = msg.split('\n').slice(0, 2); return true; };
            HTMLAnchorElement.prototype.click = function () { if (this.download) events.push('download:' + this.download.split('-').slice(0, 3).join('-')); };
            window.applyItemOps = async ops => { events.push(`apply:${ops.length}`); ops.forEach(op => { const i = window.data.b3.findIndex(b => String(b.id) === String(op.item.id)); window.data.b3[i] = op.item; }); return { written: ops.length }; };
            try {
                window.isDbAdmin = () => true;
                window.data.personel = [{ id: 'per_ahmet', name: 'Ahmet Serhat Dursun' }];
                const canonical = window.Schema.buildB3Entry({ tip: 'cikis', adet: 1, urunAciklama: 'Zaten yeni', alanKisi: 'X' });
                window.data.b3 = [
                    { id: 1, shelfNo: 'TALEP', productType: 'Asus', description: 'Personel Talebi Onaylandı', sn: 'T1', sarfAdet: 1, note: 'n', person: 'Ahmet Serhat Dursun', alanKisi: 'Ahmet Serhat Dursun', date: '28.09.2026', talepTuru: 'Kalıcı Zimmet', oncelik: 'Orta', sourceRepo: 'TALEP', approvedBy: 'Admin', requestId: 77 },
                    { id: 2, rafNo: 'R-1', urunTuru: 'Kablo', urunAciklama: 'HDMI', sn: 'S', adet: 2, not: '-', alanKisi: 'A', tarih: '01.01.2026' },
                    canonical,
                    { id: 4, rafNo: 'R', urunAciklama: 'Adetsiz eski kayıt', alanKisi: 'B', tarih: '01.01.2026' },   // adet yok → dokunulmaz
                ];
                await window.vipMigrateB3Schema();
                o.run = { events: [...events], alert: alerts.at(-1) };
                o.after = {
                    convertedValid: window.data.b3.filter(b => b.sema === 2).map(b => window.Schema.validateB3(b)),
                    descriptionKept: window.data.b3[0].description === 'Personel Talebi Onaylandı',
                    personelIdBackfilled: window.data.b3[0].personelId,
                    invalidUntouched: window.data.b3[3].sema === undefined,
                    unknownDepotKeepsShelf: window.data.b3[1].rafNo === 'R-1' && window.data.b3[1].kaynakDepo === null && window.Schema.normalizeB3(window.data.b3[1]).rafNo === 'R-1',
                    rerunConverts: window.planB3Migration().convert.length,
                    rerunDiff: window.planB3Migration().convert.map(c => { const b = window.data.b3.find(x => String(x.id) === String(c.id)); return { id: c.id, keys: Object.keys({ ...b, ...c }).filter(k => JSON.stringify(b[k] ?? null) !== JSON.stringify(c[k] ?? null)).map(k => k + ':' + JSON.stringify(b[k]) + '→' + JSON.stringify(c[k])) }; }),
                };
                // 900 eski kayıt → 400 + 400 + 100
                events.length = 0;
                window.data.b3 = Array.from({ length: 900 }, (_, i) => ({ id: 1000 + i, rafNo: 'R', urunTuru: 'T', urunAciklama: 'U', sn: 'S', adet: 1, not: '-', alanKisi: 'A', tarih: 't' }));
                await window.vipMigrateB3Schema();
                o.chunks = events.filter(e => e.startsWith('apply'));
                // personel / anonim oturum reddedilir
                events.length = 0; window.isDbAdmin = () => false;
                await window.vipMigrateB3Schema();
                o.nonAdmin = { events: [...events], alert: alerts.at(-1)?.[1] };
            } finally {
                HTMLAnchorElement.prototype.click = orig.click;
                Object.assign(window, { applyItemOps: orig.apply, isDbAdmin: orig.adm, showCustomConfirm: orig.conf, showAppAlert: orig.alert });
                window.data.b3 = orig.b3; window.data.personel = orig.per;
            }
            return o;
        });
        out.adminPageErrors = errs;
        await admin.browserContext().close();
        return out;
    },

    // H4 · 3.9a demirbaş cihaz kimliği: tekil çıkış, sepet ve admin zimmetinde adet kadar Seri No / Envanter No (en az biri),
    // cihaz başına bir kayıt; aktif zimmette/serviste olan kimlik ve liste içi tekrar reddedilir; sarf malzeme etkilenmez.
    async h4DeviceIds(page, browser) {
        const out = await page.evaluate(async () => {
            const o = {};
            const orig = { b1: window.data.b1, b3: window.data.b3, svc: window.data.serviceRecords, pt: window.data.productTypes, ops: window.runStockOps, exit: window.runExitTransaction, adm: window.isDbAdmin, alert: window.showAppAlert };
            const alerts = [], calls = [];
            window.showAppAlert = (m, t) => alerts.push([t, m]);
            window.isDbAdmin = () => true;
            window.runExitTransaction = async a => { calls.push({ qty: a.qty, recs: [a.b3Entry, ...(a.extraWrites || []).map(w => w.item)] }); return { stock: [{ before: 5, after: 5 - a.qty, statusBefore: 'x', statusAfter: 'x' }] }; };
            window.runStockOps = async arg => { calls.push({ stock: arg.stock, recs: arg.writes.filter(w => w.col === 'b3').map(w => w.item) }); return { stock: arg.stock.map(s => ({ name: s.id, before: 5, after: 5 + s.delta })) }; };
            window.data.productTypes = [{ name: 'Laptop', isDemirbas: true }, { name: 'Kablo', isDemirbas: false }];
            window.data.b1 = [
                { id: 'dm1', ürün: 'Laptop D', tür: 'Laptop', raf: 'R-5', adet: 5, durumu: 'Kullanıma Hazır' },
                { id: 'sf1', ürün: 'Kablo S', tür: 'Kablo', raf: 'R-6', adet: 9, durumu: 'Kullanıma Hazır' },
            ];
            window.data.b3 = [{ id: 1, sema: 2, tip: 'zimmet', kaynakDepo: 'b1', productId: 'dm1', urunAciklama: 'Laptop D', adet: 1, sn: 'SN-BUSY', envanterNo: '-', alanKisi: 'Ali Veli', talepTuru: 'Kalıcı Zimmet', oncelik: 'Orta', iadeEdildi: false, isDemirbas: true }];
            window.data.serviceRecords = [{ id: 2, urunAciklama: 'Laptop D', sn: '-', envanterNo: 'ENV-9', hedef: 'Teknik Servis', durum: 'Serviste / Yolda' }];
            const box = () => document.getElementById('exitDeviceIds');
            const exitWith = async (qty, ids) => {
                window.openExitModal('b1', 'dm1');
                document.getElementById('exitQty').value = String(qty); window.DeviceIds.syncExitForm();
                const rows = box().querySelectorAll('.dev-ids-row');
                ids.forEach((d, i) => { if (!rows[i]) return; rows[i].querySelector('.dev-sn').value = d.sn || ''; rows[i].querySelector('.dev-env').value = d.env || ''; });
                document.getElementById('exitNote').value = 'not';
                const before = calls.length;
                await window.saveExit(new Event('submit'));
                window.closeExitModal?.();
                return calls.length > before ? calls.at(-1) : alerts.at(-1)?.[1];
            };
            try {
                // form: demirbaşta kimlik satırları açılır, serbest SN alanı gizlenir ve zorunlu değildir
                window.openExitModal('b1', 'dm1');
                document.getElementById('exitQty').value = '3'; window.DeviceIds.syncExitForm();
                o.form = { rows: box().querySelectorAll('.dev-ids-row').length, snHidden: document.getElementById('exitSn').closest('label').style.display === 'none', snRequired: document.getElementById('exitSn').required };
                window.openExitModal('b1', 'sf1');
                o.formSarf = { boxHidden: box().hidden, snRequired: document.getElementById('exitSn').required };
                window.closeExitModal?.();

                o.missingOne = await exitWith(2, [{ sn: 'A-1' }]);
                const ok = await exitWith(2, [{ sn: 'A-1' }, { env: 'ENV-2' }]);
                o.single = typeof ok === 'object' ? { qty: ok.qty, recs: ok.recs.map(r => `${r.adet}|${r.sn}|${r.envanterNo}|${window.Schema.validateB3(r).length}`) } : ok;
                o.busyZimmet = await exitWith(1, [{ sn: ' sn-busy ' }]);
                o.busyService = await exitWith(1, [{ env: 'env-9' }]);
                o.duplicate = await exitWith(2, [{ sn: 'X-1' }, { sn: 'x-1' }]);
                window.data.b3 = window.data.b3.map((b, i) => i === 0 ? { ...b, iadeEdildi: true } : b);   // iade (snapshot gibi yeni dizi) → cihaz serbest
                o.afterReturn = typeof (await exitWith(1, [{ sn: 'SN-BUSY' }])) === 'object';

                // sarf: tek kayıt, adet korunur, kimlik istenmez
                window.openExitModal('b1', 'sf1');
                document.getElementById('exitQty').value = '3'; document.getElementById('exitSn').value = 'ITSM-9'; document.getElementById('exitNote').value = 'n';
                await window.saveExit(new Event('submit')); window.closeExitModal?.();
                o.sarf = calls.at(-1).recs.map(r => `${r.adet}|${r.sn}|${r.isDemirbas}`);

                // sepet: demirbaş kalem 2 kimlik, sarf kalem ortak SN alanı
                window.openCartModal();
                window.addToCart({ item: window.data.b1[0], repo: 'b1', qty: 5 }); window.updateCartQty(0, '2');
                window.addToCart({ item: window.data.b1[1], repo: 'b1', qty: 9 });
                document.getElementById('cartNote').value = 'n';
                const cartRows = () => document.querySelectorAll('#cartDev_0 .dev-ids-row');
                o.cartRows = cartRows().length;
                let before = calls.length;
                await window.saveCartExit(new Event('submit'));
                o.cartMissingIds = calls.length === before ? alerts.at(-1)[1] : 'yazıldı!';
                cartRows()[0].querySelector('.dev-sn').value = 'C-1'; cartRows()[1].querySelector('.dev-sn').value = 'C-2';
                cartRows()[0].closest('#cartDev_0').dispatchEvent(new Event('input'));
                before = calls.length;
                await window.saveCartExit(new Event('submit'));
                o.cartMissingSarfSn = calls.length === before ? alerts.at(-1)[1] : 'yazıldı!';
                document.getElementById('cartSn').value = 'ITSM-5';
                await window.saveCartExit(new Event('submit'));
                const c = calls.at(-1);
                o.cart = { stock: c.stock.map(s => `${s.id}:${s.delta}`), recs: c.recs.map(r => `${r.productId}|${r.adet}|${r.sn}|${r.not}|${window.Schema.validateB3(r).length}`) };
                window.closeModal?.('cartModal');
            } finally {
                Object.assign(window, { runStockOps: orig.ops, runExitTransaction: orig.exit, isDbAdmin: orig.adm, showAppAlert: orig.alert });
                Object.assign(window.data, { b1: orig.b1, b3: orig.b3, serviceRecords: orig.svc, productTypes: orig.pt });
            }
            return o;
        });

        const admin = await (await browser.createBrowserContext()).newPage();
        const errs = []; admin.on('pageerror', e => errs.push(e.message)); admin.on('dialog', d => d.dismiss());
        await admin.evaluateOnNewDocument(() => localStorage.setItem('admin_auth', JSON.stringify({ expiry: Date.now() + 600000 })));
        await admin.goto(page.url().replace('index.html', 'admin.html'), { waitUntil: 'domcontentloaded' });
        await new Promise(r => setTimeout(r, 9000));
        out.admin = await admin.evaluate(async () => {
            const o = {}, calls = [], alerts = [];
            const orig = { b1: window.data.b1, b3: window.data.b3, per: window.data.personel, ops: window.runStockOps, adm: window.isDbAdmin };
            window.isDbAdmin = () => true; window.showAppAlert = (m, t) => alerts.push(m);
            window.runStockOps = async arg => { calls.push(arg); return { stock: arg.stock.map(s => ({ col: s.col, name: s.id, before: 3, after: 3 + s.delta })) }; };
            window.data.b1 = [{ id: 'lp', ürün: 'Laptop Z', tür: 'Laptop', raf: 'R', adet: 4, isDemirbas: true, durumu: 'Kullanıma Hazır' }];
            window.data.b3 = [{ id: 5, sema: 2, tip: 'zimmet', kaynakDepo: 'b1', productId: 'lp', urunAciklama: 'Laptop Z', adet: 1, sn: 'Z-BUSY', envanterNo: '-', alanKisi: 'Başka Kişi', talepTuru: 'Kalıcı Zimmet', oncelik: 'Orta', iadeEdildi: false, isDemirbas: true }];
            window.data.personel = [{ id: 'per_z', name: 'Zimmet Alan' }];
            const m = window.inventoryManagementModule;
            const fill = (rowsSpec) => {
                m.openAssignModal(); document.getElementById('assignPersonnel').value = 'per_z';
                rowsSpec.forEach((spec, i) => { if (i > 0) m.addAssignRow(); });
                const rows = document.querySelectorAll('#assignRowsContainer .assign-product-row');
                rowsSpec.forEach((spec, i) => {
                    const ws = rows[i].querySelector('.assign-warehouse-sel'); ws.value = 'b1'; m.onWarehouseChange(ws);
                    const ps = rows[i].querySelector('.assign-product-sel'); ps.value = 'lp'; m.onProductChange(ps);
                    rows[i].querySelector('.assign-qty-inp').value = String(spec.length); m._syncAssignDevices(rows[i]);
                    rows[i].querySelectorAll('.dev-sn').forEach((inp, k) => { inp.value = spec[k] || ''; });
                });
            };
            try {
                fill([['Z-1', 'Z-2']]); o.rowsRendered = document.querySelectorAll('#assignRowsContainer .dev-ids-row').length;
                await m.saveAssignment();
                const c = calls.at(-1);
                o.ok = { calls: calls.length, stock: c.stock.map(s => s.delta), b3: c.writes.filter(w => w.col === 'b3').map(w => `${w.item.adet}|${w.item.sn}`), asg: c.writes.filter(w => w.col === 'assignments').map(w => `${w.item.adet}|${w.item.sn}`) };
                calls.length = 0;
                fill([['Z-3'], ['z-3']]); await m.saveAssignment(); o.dupAcrossRows = calls.length ? 'yazıldı!' : alerts.at(-1);
                fill([['Z-BUSY']]); await m.saveAssignment(); o.busy = calls.length ? 'yazıldı!' : alerts.at(-1);
                fill([['']]); await m.saveAssignment(); o.empty = calls.length ? 'yazıldı!' : alerts.at(-1);
                m.closeAssignModal();
            } finally {
                Object.assign(window, { runStockOps: orig.ops, isDbAdmin: orig.adm });
                Object.assign(window.data, { b1: orig.b1, b3: orig.b3, personel: orig.per });
            }
            return o;
        });
        out.adminPageErrors = errs;
        await admin.browserContext().close();
        return out;
    },

    // H4 · 3.9b-d servis geçmişi: sevk yalnız seçilen adedi düşer, demirbaşta cihaz başına kimlikli servis kaydı; önceki
    // servisler sevk ekranında görünür; dönüşte kayıt silinmez kapanır; durum geçmişi tek doküman güncellemesi; birleşik geçmiş.
    async h4ServiceHistory(page) {
        return page.evaluate(async () => {
            const ft = window.__ft, o = {};
            const orig = { b1: window.data.b1, b2: window.data.b2, b3: window.data.b3, svc: window.data.serviceRecords, pt: window.data.productTypes, ops: window.runStockOps, upd: window.updateItem, adm: window.isDbAdmin, alert: window.showAppAlert, conf: window.showCustomConfirm, chk: window.checkIsAdmin };
            const alerts = [], calls = [];
            window.showAppAlert = (m, t) => alerts.push([t, m]);
            window.showCustomConfirm = async () => true;
            window.isDbAdmin = () => true; window.checkIsAdmin = () => true;
            window.runStockOps = async arg => { calls.push(JSON.parse(JSON.stringify(arg))); return { stock: arg.stock.map(s => ({ col: s.col, id: s.id, name: s.id, before: 37, after: 37 + s.delta, created: false })) }; };
            const upd = []; window.updateItem = async (col, id, fields) => { upd.push({ col, id, fields: JSON.parse(JSON.stringify(fields)) }); return { written: 1 }; };
            window.data.productTypes = [{ name: 'Laptop', isDemirbas: true }, { name: 'Toner', isDemirbas: false }];
            window.data.b2 = [{ id: 'ls', ürün: 'Laptop S', tür: 'Laptop', raf: 'Zemin', sütun: 'Saha-1', adet: 37, status: 'Kullanıma Hazır' }];
            window.data.b1 = [{ id: 'tn', ürün: 'Toner T', tür: 'Toner', raf: 'R-2', adet: 4, durumu: 'Kullanıma Hazır' }];
            window.data.b3 = [{ id: 500, sema: 2, tip: 'zimmet', kaynakDepo: 'b2', productId: 'ls', urunAciklama: 'Laptop S', adet: 1, sn: 'LS-1', envanterNo: '-', alanKisi: 'Eski Sahip', tarih: '01.08.2026', ts: Date.UTC(2026, 7, 1), talepTuru: 'Kalıcı Zimmet', oncelik: 'Orta', iadeEdildi: true, iadeEdildiTarihi: '05.08.2026', iadeDepo: 'b2', isDemirbas: true }];
            window.data.serviceRecords = [
                { id: 1789000000000, productId: 'ls', urunAciklama: 'Laptop S', sn: 'LS-1', envanterNo: '-', adet: 1, kaynakDepo: 'b2', hedef: 'Teknik Servis', hedefTip: 'service', sevkTarihi: '10.08.2026 10:00', durum: 'Depoya Döndü', kapandi: true, donusTarihi: '20.08.2026 09:00', donusDepo: 'b2',
                  gecmis: [{ ts: 1789000000000, tarih: '10.08.2026 10:00', durum: 'Serviste / Yolda', not: 'ekran arızası' }, { ts: 1789500000000, tarih: '15.08.2026 12:00', durum: 'Parça Bekleniyor', not: 'panel siparişte' }, { ts: 1789900000000, tarih: '20.08.2026 09:00', durum: 'Depoya Döndü', not: 'B2 deposuna geri alındı' }] },
                { id: 1790000000000, productId: 'ls', urunAciklama: 'Laptop S', sn: 'LS-2', envanterNo: '-', adet: 1, kaynakDepo: 'b2', hedef: 'Teknik Servis', sevkTarihi: '25.09.2026', durum: 'Serviste / Yolda', kapandi: false, gecmis: [{ ts: 1790000000000, tarih: '25.09.2026', durum: 'Serviste / Yolda', not: '-' }] },
            ];
            const target = name => [...document.getElementById('transTarget').options].find(op => op.textContent === name);
            const choose = name => { const sel = document.getElementById('transTarget'); sel.value = target(name).value; window.handleTransferTargetChange(sel); };
            const devRows = () => document.querySelectorAll('#transDeviceIds .dev-ids-row');
            try {
                // sevk ekranı: demirbaşta varsayılan adet 1, ürünün önceki servis kayıtları (kapanmış olan dahil) listelenir
                window.openTransferModal('b2', 'ls');
                o.open = { qty: document.getElementById('transQty').value, dispatchHidden: document.getElementById('transDispatchOptions').style.display === 'none',
                           hint: document.getElementById('transServiceHistory').textContent.replace(/\s+/g, ' ').trim().slice(0, 160) };
                choose('Teknik Servis');
                o.serviceTarget = { dispatchShown: document.getElementById('transDispatchOptions').style.display === 'block', rows: devRows().length };
                document.getElementById('transNote').value = 'klavye arızası';
                let before = calls.length;
                await window.confirmTransfer();
                o.noIdRefused = calls.length === before ? alerts.at(-1)[1] : 'yazıldı!';
                devRows()[0].querySelector('.dev-sn').value = 'LS-2';                 // hâlâ serviste
                await window.confirmTransfer();
                o.inServiceRefused = calls.length === before ? alerts.at(-1)[1] : 'yazıldı!';
                devRows()[0].querySelector('.dev-sn').value = 'ls-1';                 // daha önce servise gitmiş, dönmüş
                document.getElementById('transDeviceIds').dispatchEvent(new Event('input'));
                await ft.sleep(300);   // Faz 3.5: ipucu yazma durunca (200 ms) çizilir
                o.hintForId = document.getElementById('transServiceHistory').querySelectorAll('[data-history]').length;
                await window.confirmTransfer();
                const c = calls.at(-1);
                o.dispatch = { calls: calls.length - before, stock: c.stock.map(s => `${s.col}/${s.id}:${s.delta}`), ops: c.writes.map(w => `${w.op}:${w.col}`),
                               rec: (r => `${r.sn}|${r.adet}|${r.kapandi}|${r.productId}|${r.hedefTip}|${r.gecmis.length}|${r.originalData.adet}`)(c.writes[0].item), rowNotDeleted: !c.writes.some(w => w.op === 'delete') };
                // adet 3, 2 kimlik → reddedilir; stoktan fazla → reddedilir
                window.openTransferModal('b2', 'ls'); choose('Teknik Servis');
                document.getElementById('transQty').value = '3'; window.syncTransferDevices();
                devRows()[0].querySelector('.dev-sn').value = 'N-1'; devRows()[1].querySelector('.dev-sn').value = 'N-2';
                document.getElementById('transNote').value = 'x';
                before = calls.length; await window.confirmTransfer();
                o.partialIdsRefused = calls.length === before ? alerts.at(-1)[1] : 'yazıldı!';
                document.getElementById('transQty').value = '99';
                await window.confirmTransfer();
                o.overStockRefused = calls.length === before ? alerts.at(-1)[1] : 'yazıldı!';
                // sarf: varsayılan adet tüm stok, kimlik istenmez, tek kayıt
                window.openTransferModal('b1', 'tn'); choose('Kavacık Kampüs');
                o.sarf = { defaultQty: document.getElementById('transQty').value, deviceBoxHidden: document.getElementById('transDeviceIds').hidden };
                document.getElementById('transQty').value = '2'; document.getElementById('transNote').value = 'kampüse';
                await window.confirmTransfer();
                o.sarf.write = (x => `${x.stock[0].delta}|${x.writes.length}|${x.writes[0].item.adet}|${x.writes[0].item.sn}|${x.writes[0].item.hedefTip}`)(calls.at(-1));
                window.closeTransferModal();

                // dönüş: kayıt silinmez, kapanır; kayıttaki adet eklenir
                before = calls.length;
                await window.receiveFromService(1790000000000);
                const r = calls.at(-1);
                o.receive = { calls: calls.length - before, stock: r.stock.map(s => `${s.col}/${s.id}:+${s.delta}`), ops: r.writes.map(w => `${w.op}:${w.col}`),
                              fields: (f => `${f.kapandi}|${f.durum}|${f.donusDepo}|${f.gecmis.length}`)(r.writes[0].fields) };
                window.data.serviceRecords[0].kapandi = true;   // zaten kapalı kayda ikinci dönüş reddedilir
                before = calls.length; await window.receiveFromService(1789000000000);
                o.closedAgain = calls.length === before ? alerts.at(-1)[1] : 'yazıldı!';

                // durum güncelleme: tek doküman, geçmişe satır
                window.updateServiceStatus(1790000000000);
                document.getElementById('svcStatusSelect').value = 'Parça Bekleniyor';
                document.getElementById('svcStatusNote').value = 'anakart';
                await document.getElementById('svcStatusSaveBtn').onclick();
                o.statusUpdate = upd.map(u => `${u.col}|${u.id}|${u.fields.durum}|${u.fields.gecmis.length}|${u.fields.gecmis.at(-1).not}`);

                // servis paneli yalnız açık kayıtları gösterir
                window.renderServicesModule?.();
                const body = document.getElementById('serviceTableBody');
                o.panel = body ? { rows: body.querySelectorAll('tr').length, text: body.textContent.includes('LS-2'), closedHidden: !body.textContent.includes('LS-1') } : 'no panel on page';

                // birleşik cihaz geçmişi: zimmet + iade + önceki servis (sevk, durum, dönüş)
                const h = window.AssignmentService.getDeviceHistory(' ls-1 ');
                o.history = h.map(e => e.tur.replace(/^\S+\s/, '') + ' ' + e.tarih);
                window.DeviceIds.showHistory('LS-1');
                o.historyModalRows = document.querySelectorAll('#deviceHistoryModal tbody tr').length;
                document.getElementById('deviceHistoryModal')?.remove();
            } finally {
                Object.assign(window, { runStockOps: orig.ops, updateItem: orig.upd, isDbAdmin: orig.adm, showAppAlert: orig.alert, showCustomConfirm: orig.conf, checkIsAdmin: orig.chk });
                Object.assign(window.data, { b1: orig.b1, b2: orig.b2, b3: orig.b3, serviceRecords: orig.svc, productTypes: orig.pt });
                window.renderServicesModule?.();
            }
            return o;
        });
    },

    // H4 · 3.9b servis paneli (admin.html): yalnız açık kayıtlar ve sayaç; kimlikli kayıtta "cihaz geçmişi" düğmesi; kayıt
    // görüntülemede durum geçmişi. Veri bellekte değiştirilir, geri alınır; yazma yok.
    async h4ServicePanel(page, browser) {
        const admin = await (await browser.createBrowserContext()).newPage();
        const errs = []; admin.on('pageerror', e => errs.push(e.message)); admin.on('dialog', d => d.dismiss());
        await admin.evaluateOnNewDocument(() => localStorage.setItem('admin_auth', JSON.stringify({ expiry: Date.now() + 600000 })));
        await admin.goto(page.url().replace('index.html', 'admin.html'), { waitUntil: 'domcontentloaded' });
        await new Promise(r => setTimeout(r, 9000));
        const out = await admin.evaluate(async () => {
            const orig = window.data.serviceRecords, o = {};
            window.data.serviceRecords = [
                { id: 11, urunAciklama: 'Kapalı Cihaz', sn: 'K-1', hedef: 'Teknik Servis', durum: 'Depoya Döndü', kapandi: true, gecmis: [{ tarih: '01.09.2026', durum: 'Serviste / Yolda' }, { tarih: '03.09.2026', durum: 'Depoya Döndü' }] },
                { id: 12, urunAciklama: 'Açık Cihaz', sn: 'A-1', envanterNo: 'ENV-A1', adet: 1, hedef: 'Teknik Servis', durum: 'Parça Bekleniyor', kapandi: false, gecmis: [{ tarih: '20.09.2026', durum: 'Serviste / Yolda', not: 'ekran' }, { tarih: '22.09.2026', durum: 'Parça Bekleniyor', not: 'panel', yapan: 'Admin' }] },
                { id: 13, urunAciklama: 'Eski Kayıt', hedef: 'Haliç Kampüs', durum: 'Dış Birimde' },   // eski kayıt: kapandi alanı yok → açık
            ];
            try {
                window.renderServicesModule();
                const body = document.getElementById('serviceTableBody');
                o.rows = [...body.querySelectorAll('tr')].map(tr => tr.querySelector('td')?.textContent.replace(/\s+/g, ' ').trim());
                o.historyButtons = body.querySelectorAll('button[title^="Cihaz geçmişi"]').length;
                o.count = document.getElementById('totalInService')?.textContent;
                window.viewServiceItem(12);
                const view = document.getElementById('serviceViewContent')?.textContent.replace(/\s+/g, ' ') || '';
                o.view = { timeline: view.includes('Durum Geçmişi') && view.includes('Parça Bekleniyor') && view.includes('panel'), envNo: view.includes('ENV-A1'), historyButton: view.includes('Cihaz geçmişi') };
                document.getElementById('serviceViewModal').style.display = 'none';
            } finally {
                window.data.serviceRecords = orig;
                window.renderServicesModule();
            }
            return o;
        });
        out.adminPageErrors = errs;
        await admin.browserContext().close();
        return out;
    },

    // Faz 3.5 · B3 çalışma zamanı muhafızı: b3'e giden her yazma (applyItemOps, runStockOps, saveData, upsert/append) Firestore'a
    // gitmeden denetlenir. Test oturumu anonimdir: kurallar b3'e anonim yazmayı reddeder, bu yüzden muhafızdan GEÇEN geçerli bir
    // kayıt "write-failed/forbidden" ile döner (Firestore'a ulaştı), GEÇEMEYEN "schema-violation" ile döner (hiç gönderilmedi).
    // Hiçbir veri yazılmaz.
    async hotfixB3Guard(page) {
        return page.evaluate(async () => {
            const S = window.Schema, o = {};
            const code = async p => { try { await p; return 'ok'; } catch (e) { return e.code || e.message; } };
            const valid = S.buildB3Entry({ tip: 'cikis', adet: 1, urunAciklama: 'Muhafız testi', alanKisi: 'Test', sn: 'G-1' });
            const legacy = { id: window.makeId(), shelfNo: 'R-1', productType: 'Eski', sarfAdet: 1, note: '-', alanKisi: 'X', date: '01.01.2026' };
            const demirbasNoId = S.buildB3Entry({ tip: 'cikis', adet: 2, urunAciklama: 'Laptop', alanKisi: 'Test', isDemirbas: true });
            const existing = (window.data.b3 || [])[0];
            const origB3 = window.data.b3, origAdm = window.isDbAdmin;
            try {
                o.applyItemOps = {
                    legacyRejected: await code(window.applyItemOps([{ op: 'set', col: 'b3', item: legacy }])),
                    missingField: await code(window.applyItemOps([{ op: 'set', col: 'b3', item: (({ urunTuru, ...r }) => r)(valid) }])),
                    fixedAssetWithoutId: await code(window.appendItem('b3', demirbasNoId)),
                    viaUpsert: await code(window.upsertItem('b3', legacy)),
                    validReachesFirestore: await code(window.applyItemOps([{ op: 'set', col: 'b3', item: valid }])),
                    mixedBatchRejectedWhole: await code(window.applyItemOps([{ op: 'set', col: 'requests', item: { id: window.makeId(), ürün: 'x' } }, { op: 'set', col: 'b3', item: legacy }])),
                    updateLegacyKey: existing ? await code(window.updateItem('b3', existing.id, { shelfNo: 'Z' })) : 'no demo b3',
                    updateUnknownKey: existing ? await code(window.updateItem('b3', existing.id, { foo: 1 })) : 'no demo b3',
                    updateCanonicalReachesFirestore: existing ? await code(window.updateItem('b3', existing.id, { not: 'muhafız' })) : 'no demo b3',
                    deleteNotGuarded: existing ? await code(window.removeItem('b3', '__yok__' + window.makeId())) : 'no demo b3',
                };
                const legacyCanonical = { ...S.toCanonicalB3({ id: window.makeId(), rafNo: 'R', urunTuru: 'T', urunAciklama: 'U', sn: 'S', adet: 1, not: '-', alanKisi: 'A', tarih: 't' }) };
                o.migrationFlag = {
                    unknownDepotWithoutFlag: await code(window.applyItemOps([{ op: 'set', col: 'b3', item: legacyCanonical }])),
                    unknownDepotWithFlag: await code(window.applyItemOps([{ op: 'set', col: 'b3', item: legacyCanonical }], { b3Legacy: true })),
                    flagStillRejectsOldKeys: await code(window.applyItemOps([{ op: 'set', col: 'b3', item: legacy }], { b3Legacy: true })),
                };
                window.isDbAdmin = () => true;   // runStockOps yönetici ister; anonim oturumda transaction kurallarca reddedilir
                o.runStockOps = {
                    legacyRejectedBeforeTransaction: await code(window.runStockOps({ writes: [{ op: 'set', col: 'b3', item: legacy }] })),
                    exitWithBadEntry: await code(window.runExitTransaction({ repo: 'b1', productId: 'yok', qty: 1, b3Entry: legacy })),
                    validReachesFirestore: await code(window.runStockOps({ writes: [{ op: 'set', col: 'b3', item: valid }] })),
                };
                window.isDbAdmin = origAdm;
                o.saveData = {
                    newLegacyDoc: await code(window.saveData('b3', [...origB3, legacy])),
                };
                window.data.b3 = origB3;
                o.saveData.newValidDocReachesFirestore = await code(window.saveData('b3', [...origB3, valid]));
                window.data.b3 = origB3;
                if (existing) {
                    o.saveData.existingDocUnknownKey = await code(window.saveData('b3', origB3.map(b => b === existing ? { ...b, foo: 1 } : b)));
                    window.data.b3 = origB3;
                }
                o.b3Unchanged = window.data.b3 === origB3 && !window.data.b3.some(b => b.urunAciklama === 'Muhafız testi' || b.foo === 1);
            } finally {
                window.data.b3 = origB3; window.isDbAdmin = origAdm;
            }
            return o;
        });
    },

    // Faz 3.5 · toplu silme kilidi eşiği: ≤10 kayıtlı koleksiyonda yalnız mutlak sınır (5), >10'da ayrıca %20.
    // Tablo saf fonksiyonla; küçük koleksiyon davranışı 'requests' üzerinde işaretli kayıtlarla gerçek yazmayla.
    // Faz 5 denetimi (P0 + P1) — gerçek sayfada:
    //   P1: importExcel gerçek UI fonksiyonuyla (CSV/XLSX File nesneleri) sürülür; yazıcı (atomicInsertItems) yakalanır.
    //       saveData b1 yeni kayıt tam sözleşmesi, kanonik kaydın bozulamaması. Bunlar Firestore'a yazmadan reddedilir.
    //   P0: toplu yazma kilidi (restoreLock) saveData/applyItemOps/runStockOps'u durdurur; restoreCollections/atomicInsertItems
    //       yönetici dışında reddedilir. --emu: gerçek admin oturumuyla firebase-handler köprüleri üzerinden 600 kayıtlık
    //       günlüklü ekleme, ortadaki parçada GERÇEK sunucu reddi → geri alma, atomik geri yükleme (ekleneni siler).
    async p5AuditAtomicImport(page) {
        const out = await page.evaluate(async (EMU) => {
            const o = {};
            const orig = { ins: window.atomicInsertItems, req: window.requireDbAdmin, conf: window.showCustomConfirm, alert: window.showAppAlert, adm: window.isDbAdmin, cfg: window.data.config };
            const calls = [], alerts = [];
            window.atomicInsertItems = async (col, recs) => { calls.push({ col, recs }); return { status: 'committed' }; };
            window.requireDbAdmin = () => true;
            window.showCustomConfirm = async () => true;
            window.showAppAlert = (m, t) => alerts.push({ m: String(m), t });
            const fire = async (file, depo) => {
                const input = document.getElementById('fileInput');
                input.setAttribute('data-depo', depo);
                const dt = new DataTransfer(); dt.items.add(file); input.files = dt.files;
                await window.importExcel({ target: input });
            };
            try {
                o.singleImporter = window.importExcel.toString().includes('StockImport');   // pdf-generator'daki eski kopya yok
                // 1) CSV (; ayraçlı, BOM'lu, tırnaklı) → kanonik b1
                await fire(new File(['﻿Ürün Adı;Cihaz Türü;Raf No;Adet;Marka\r\n"Kablo; HDMI";Kablo;R-4;5;Acme\r\nThinkPad;Laptop;R-9;2;Lenovo\r\n'], 'test.csv', { type: 'text/csv' }), 'b1');
                const c = calls.at(-1);
                o.csv = c && { col: c.col, n: c.recs.length, contract: c.recs.map(r => window.Schema.validateB1(r).length), noRafNo: c.recs.every(r => !('rafNo' in r)),
                               raf: c.recs.map(r => r.raf).join(','), demirbas: c.recs.map(r => typeof r.isDemirbas).join(','), name: c.recs[0].ürün };
                // 2) XLSX → kanonik b2
                const ws = XLSX.utils.json_to_sheet([{ 'Ürün': 'Monitör 24', 'Adet': 3, 'Durum': 'Kullanıma Hazır', 'Demirbaş': 'Evet' }]);
                const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'S1');
                const bin = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
                await fire(new File([bin], 'test.xlsx'), 'b2');
                const x = calls.at(-1);
                o.xlsx = x && { col: x.col, contract: window.Schema.validateB2(x.recs[0]), status: x.recs[0].status, isDemirbas: x.recs[0].isDemirbas };
                // 3) bir satırı hatalı CSV → hiç yazma yok
                const before = calls.length;
                await fire(new File(['Ürün,Adet\nA,1\nB,iki\n'], 'bad.csv'), 'b1');
                o.badRowNoWrite = calls.length === before && /hiçbir kayıt yazılmadı/.test(alerts.at(-1).m) && /Satır 3/.test(alerts.at(-1).m);
            } finally {
                Object.assign(window, { atomicInsertItems: orig.ins, requireDbAdmin: orig.req, showCustomConfirm: orig.conf, showAppAlert: orig.alert });
            }

            // P1 · saveData b1/b2 tam sözleşme (guard Firestore'dan önce)
            const code = p => p.then(() => 'ok', e => e.code);
            window.showAppAlert = () => {};
            try {
                const legacyNew = { id: 'p5_legacy_' + Date.now(), ürün: 'Eksik Alanlı', adet: 1, rafNo: 'R-1' };
                o.saveDataNewLegacy = await code(window.saveData('b1', [...(window.data.b1 || []), legacyNew]));
                window.data.b1 = (window.data.b1 || []).filter(x => x.id !== legacyNew.id);
                const canon = window.Schema.toCanonicalStock({ id: 'p5_canon', ürün: 'Kanonik', adet: 1 }, 'b1');
                const keep = { data: window.data.b1, mirror: window._dbMirror.b1 };
                window._dbMirror.b1 = [JSON.parse(JSON.stringify(canon))]; window.data.b1 = [canon];
                o.saveDataDegrade = await code(window.saveData('b1', [{ ...canon, name: 'eski alan' }]));
                o.saveDataDropField = await code(window.saveData('b1', [{ ...canon, isDemirbas: 'evet' }]));
                window.data.b1 = keep.data; window._dbMirror.b1 = keep.mirror;

                // P0 · toplu yazma kilidi
                window.data.config = { ...(orig.cfg || {}), restoreLock: { id: 'p5test', collections: ['b1'] } };
                window.isDbAdmin = () => true;
                const someB1 = (window.data.b1 || [])[0];
                o.lockSaveData = await code(window.saveData('b1', [...(window.data.b1 || []), window.Schema.toCanonicalStock({ id: 'p5_new', ürün: 'Yeni', adet: 1 }, 'b1')]));
                window.data.b1 = (window.data.b1 || []).filter(x => x.id !== 'p5_new');
                o.lockApply = someB1 ? await code(window.applyItemOps([{ op: 'update', col: 'b1', id: someB1.id, fields: { açıklama: 'x' } }])) : 'no-b1';
                o.lockStock = someB1 ? await code(window.runStockOps({ stock: [{ col: 'b1', id: someB1.id, delta: -1 }] })) : 'no-b1';
            } finally {
                window.data.config = orig.cfg; window.isDbAdmin = orig.adm; window.showAppAlert = orig.alert;
            }
            // Yönetici olmayan oturum
            o.nonAdminRestore = window.isDbAdmin() ? 'admin' : await code(window.restoreCollections({ b1: [] }));
            o.nonAdminInsert = window.isDbAdmin() ? 'admin' : await code(window.atomicInsertItems('b1', [{ id: 'x' }]));
            return o;
        }, EMU);

        if (EMU) {
            out.emu = await page.evaluate(async () => {
                const ft = window.__ft, o = {};
                const sys = async () => { const d = await ft.readAll('system_config'); return { journal: d.filter(x => x._docId.startsWith('bulk_write_journal')).length, lock: (d.find(x => x._docId === 'admin_settings') || {}).restoreLock ?? null }; };
                await ft.asAdmin(async () => {
                    const mk = (i, extra) => window.Schema.toCanonicalStock({ id: `b1_p5emu_${i}`, ürün: `P5 ${ft.MARKER} ${i}`, adet: 1, ...extra }, 'b1');
                    // 1) ortadaki parçada (girdi 700 / 450'lik parçalar) GERÇEK sunucu reddi: 1 MiB üstü doküman
                    const bad = Array.from({ length: 900 }, (_, i) => mk(i, i === 700 ? { açıklama: 'x'.repeat(1100 * 1024) } : {}));
                    o.rejected = await window.atomicInsertItems('b1', bad).then(() => 'ok', e => e.code);
                    o.rejectedLeftNothing = (await ft.readMarked('b1')).length === 0;
                    o.rejectedClean = await sys();
                    // dinleyici, geri alınana kadar görünen dokümanları bellekten çıkarsın (yoksa yinelenen id sanılır)
                    await ft.waitFor(async () => !(window.data.b1 || []).some(x => String(x.id).startsWith('b1_p5emu_')), 15000);
                    // 2) 600 kayıt (2 parça, günlüklü) başarı
                    const good = Array.from({ length: 600 }, (_, i) => mk(i));
                    const r = await window.atomicInsertItems('b1', good);
                    o.insert = { journaled: r.journaled, chunks: r.chunks, inFirestore: (await ft.readMarked('b1')).length, contract: (await ft.readMarked('b1')).every(d => { const { _docId, ...rest } = d; return window.Schema.validateB1(rest).length === 0; }) };
                    o.insertClean = await sys();
                    // 3) atomik geri yükleme: b1'i eklemeden önceki hâline döndür (600 silme, günlüklü) — temizlik de budur
                    const keep = (await ft.readAll('b1')).filter(d => !JSON.stringify(d).includes(ft.MARKER)).map(({ _docId, ...d }) => (d.id == null ? { id: _docId, ...d } : d));
                    const rr = await window.restoreCollections({ b1: keep });
                    o.restore = { deleted: rr.deleted, journaled: rr.journaled, markedLeft: (await ft.readMarked('b1')).length };
                    o.restoreClean = await sys();
                });
                return o;
            });
        }

        const e = out.emu;
        out.ok = out.singleImporter
            && out.csv && out.csv.col === 'b1' && out.csv.n === 2 && out.csv.contract.join() === '0,0' && out.csv.noRafNo && out.csv.raf === 'R-4,R-9'
            && out.csv.demirbas === 'boolean,boolean' && out.csv.name === 'Kablo; HDMI'
            && out.xlsx && out.xlsx.col === 'b2' && out.xlsx.contract.length === 0 && out.xlsx.status === 'Kullanıma Hazır' && out.xlsx.isDemirbas === true
            && out.badRowNoWrite
            && out.saveDataNewLegacy === 'schema-violation' && out.saveDataDegrade === 'schema-violation' && out.saveDataDropField === 'schema-violation'
            && out.lockSaveData === 'bulk-locked' && ['bulk-locked', 'no-b1'].includes(out.lockApply) && ['bulk-locked', 'no-b1'].includes(out.lockStock)
            && out.nonAdminRestore === 'forbidden' && out.nonAdminInsert === 'forbidden'
            && (!EMU || (e && e.rejected === 'rolled-back' && e.rejectedLeftNothing && e.rejectedClean.journal === 0 && e.rejectedClean.lock === null
                && e.insert.journaled === true && e.insert.chunks === 2 && e.insert.inFirestore === 600 && e.insert.contract
                && e.insertClean.journal === 0 && e.insertClean.lock === null
                && e.restore.deleted === 600 && e.restore.journaled === true && e.restore.markedLeft === 0 && e.restoreClean.lock === null));
        if (!out.ok) throw new Error('p5AuditAtomicImport beklenen sözleşmede değil: ' + JSON.stringify(out));
        return out;
    },

    async hotfixBulkLock(page) {
        return page.evaluate(async () => {
            const ft = window.__ft, o = {};
            const B = window.isBulkDeleteBlocked;
            const cases = [
                [1, 2], [2, 2], [2, 4], [4, 4], [5, 6], [5, 10], [6, 8], [6, 10],   // ≤10: yalnız >5 kilitlenir
                [2, 11], [3, 11], [2, 14], [3, 14], [5, 30], [6, 30], [6, 100], [1, 100],
            ];
            o.table = cases.map(([d, t]) => `${d}/${t}:${B(d, t) ? 'KİLİT' : 'serbest'}`);
            o.expected = ['1/2:serbest', '2/2:serbest', '2/4:serbest', '4/4:serbest', '5/6:serbest', '5/10:serbest', '6/8:KİLİT', '6/10:KİLİT',
                          '2/11:serbest', '3/11:KİLİT', '2/14:serbest', '3/14:KİLİT', '5/30:serbest', '6/30:KİLİT', '6/100:KİLİT', '1/100:serbest'];
            o.tableOk = JSON.stringify(o.table) === JSON.stringify(o.expected);

            // gerçek: requests küçükken (≤10) 2 kaydı birden silmek artık serbest (eski kural %50 diye kilitliyordu)
            const base = window.makeId();
            const mk = n => ({ id: base + n, ürün: 'Kilit ' + n + ' ' + ft.MARKER, personel: 'Kilit ' + ft.MARKER, durum: 'Beklemede', adet: 1 });
            await window.saveData('requests', [...window.data.requests, mk(1), mk(2)]);
            await ft.waitFor(async () => (await ft.readMarked('requests')).length === 2 && window.data.requests.filter(r => String(r.ürün).includes(ft.MARKER)).length === 2);
            const total = window._dbMirror.requests.length;
            o.small = { total, oldRuleWouldBlock: 2 > total * 0.2 };
            let res;
            try { res = await window.saveData('requests', window.data.requests.filter(r => r.id !== base + 1 && r.id !== base + 2)); }
            catch (e) { res = e.code; }
            o.small.result = typeof res === 'object' ? { deleted: res.collections?.requests?.deleted } : res;
            await ft.waitFor(async () => (await ft.readMarked('requests')).length === 0);
            o.small.leftOnServer = (await ft.readMarked('requests')).length;
            return o;
        });
    },

    // Faz 3.5 · activeDeviceUses önbelleği: tekrarlı çağrılar tek tarama; dizi değişimi, gerçek yazma (veri revizyonu) ve
    // 2 sn sonra yeniden hesaplanır; iade sonrası kimlik serbest kalır. 600 zimmet + 200 servis kaydıyla ölçülür.
    async hotfixDeviceUsesMemo(page) {
        return page.evaluate(async () => {
            const ft = window.__ft, A = window.AssignmentService, o = {};
            const orig = { b1: window.data.b1, b3: window.data.b3, svc: window.data.serviceRecords, req: window.data.requests, asg: window.data.assignments, pt: window.data.productTypes, ops: window.runStockOps, adm: window.isDbAdmin, alert: window.showAppAlert };
            const Z = i => ({ id: 5000 + i, sema: 2, tip: 'zimmet', kaynakDepo: 'b1', productId: 'm1', urunAciklama: 'Laptop M', adet: 1, sn: 'MZ-' + i, envanterNo: 'ENVZ-' + i, alanKisi: 'Kişi ' + (i % 40), talepTuru: 'Kalıcı Zimmet', oncelik: 'Orta', iadeEdildi: false, isDemirbas: true, tarih: '01.09.2026' });
            window.data.productTypes = [{ name: 'Laptop', isDemirbas: true }];
            window.data.b1 = [{ id: 'm1', ürün: 'Laptop M', tür: 'Laptop', raf: 'R', adet: 500, durumu: 'Kullanıma Hazır' }];
            window.data.b3 = Array.from({ length: 600 }, (_, i) => Z(i));
            window.data.assignments = []; window.data.requests = [];
            window.data.serviceRecords = Array.from({ length: 200 }, (_, i) => ({ id: 9000 + i, sn: 'MS-' + i, envanterNo: '-', hedef: 'Teknik Servis', durum: 'Serviste / Yolda', kapandi: false }));
            const stats = () => ({ ...A.usesStats });
            const time = fn => { const t = performance.now(); fn(); return +(performance.now() - t).toFixed(1); };
            try {
                A.invalidateDeviceUses();
                const s0 = stats();
                o.firstCallMs = time(() => A.activeDeviceUses());
                o.sixtyCachedCallsMs = time(() => { for (let i = 0; i < 60; i++) A.checkDeviceIds({ demirbas: true, qty: 1, ids: [{ sn: 'YENI-' + i }] }); });
                const s1 = stats();
                o.cached = { computed: s1.computed - s0.computed, hits: s1.hits - s0.hits, sameInstance: A.activeDeviceUses() === A.activeDeviceUses() };
                o.sixtyUncachedCallsMs = time(() => { for (let i = 0; i < 60; i++) A.activeDeviceUses({ fresh: true }); });
                o.busyStillDetected = A.checkDeviceIds({ demirbas: true, qty: 1, ids: [{ sn: 'mz-7' }] }).errors[0] || 'serbest!';

                // geçersizleşme 1: dizi değişimi (snapshot) — iade edilen cihaz hemen serbest
                const before = A.activeDeviceUses();
                window.data.b3 = window.data.b3.map(b => b.sn === 'MZ-7' ? { ...b, iadeEdildi: true } : b);
                o.afterArrayReplace = { recomputed: A.activeDeviceUses() !== before, returnedFree: A.checkDeviceIds({ demirbas: true, qty: 1, ids: [{ sn: 'MZ-7' }] }).ok };

                // geçersizleşme 2: gerçek yazma (requests, işaretli) → veri revizyonu artar → yeniden hesap
                const rev0 = window.getDataRevision(), cached = A.activeDeviceUses();
                const rid = window.makeId();
                await window.appendItem('requests', { id: rid, ürün: 'Memo ' + ft.MARKER, personel: 'Memo ' + ft.MARKER, durum: 'Beklemede', adet: 1 });
                o.afterRealWrite = { revisionBumped: window.getDataRevision() > rev0, recomputed: A.activeDeviceUses() !== cached };
                await window.removeItem('requests', rid);

                // geçersizleşme 3: süre (window.data'yı doğrudan değiştiren eski kod için emniyet)
                const c2 = A.activeDeviceUses();
                window.data.b3[8].iadeEdildi = true;                 // doğrudan değişiklik: revizyon artmaz
                o.directMutationWithinTtlStillCached = A.activeDeviceUses() === c2;
                await ft.sleep(2100);
                o.afterTtl = { recomputed: A.activeDeviceUses() !== c2, freed: A.checkDeviceIds({ demirbas: true, qty: 1, ids: [{ sn: 'MZ-8' }] }).ok };

                // 60 cihazlık sepet: tek tarama
                window.isDbAdmin = () => true; window.showAppAlert = () => {};
                let wrote = 0; window.runStockOps = async arg => { wrote = arg.writes.length; return { stock: arg.stock.map(s => ({ name: s.id, before: 500, after: 500 + s.delta })) }; };
                window.openCartModal();
                window.addToCart({ item: window.data.b1[0], repo: 'b1', qty: 500 }); window.updateCartQty(0, '60');
                document.querySelectorAll('#cartDev_0 .dev-sn').forEach((inp, i) => { inp.value = 'SEPET-' + i; });
                document.getElementById('cartNote').value = 'n';
                A.invalidateDeviceUses();
                const s2 = stats(), t = performance.now();
                await window.saveCartExit(new Event('submit'));
                o.cart60 = { ms: +(performance.now() - t).toFixed(1), records: wrote, scans: stats().computed - s2.computed };
                window.closeModal?.('cartModal');
            } finally {
                Object.assign(window, { runStockOps: orig.ops, isDbAdmin: orig.adm, showAppAlert: orig.alert });
                Object.assign(window.data, { b1: orig.b1, b3: orig.b3, serviceRecords: orig.svc, requests: orig.req, assignments: orig.asg, productTypes: orig.pt });
                A.invalidateDeviceUses();
            }
            return o;
        });
    },

    // Faz 3.5 · giriş kodu otomatik odağı: etkileşim yoksa odaklanır; veri gelmeden önce kullanıcı sayfayla etkileştiyse
    // (tuş/tıklama) odak çalınmaz; senkron yeniden başlayınca (personel snapshot'ı tekrar gelir) odak ikinci kez çekilmez.
    // Faz 4 · J0 — emülatör modunun kendisi: uygulama emülatörde, admin oturumu gerçek, kurallar uygulanıyor.
    async j0Emulator(page) {
        return page.evaluate(async () => {
            const ft = window.__ft;
            if (!ft.emulator) return { skipped: 'yalnız --emu ile' };
            const out = { anonymousAtStart: !!window.userAuth?.isAnonymous, seededB1: (window.data.b1 || []).length };
            const fs = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
            const ref = fs.doc(window.fireDb, window.COLLECTION_ROOT, 'b1', 'items', 'j0_' + Date.now());
            const tryWrite = async () => { try { await fs.setDoc(ref, { id: ref.id, ürün: 'J0 ' + ft.MARKER }); return 'ALLOWED'; } catch (e) { return e.code; } };
            out.anonB1Write = await tryWrite();
            out.adminLogin = await ft.adminLogin();
            out.isDbAdmin = window.isDbAdmin();
            out.adminB1Write = await tryWrite();
            out.adminB1Delete = await fs.deleteDoc(ref).then(() => 'ALLOWED', e => e.code);
            out.backToAnonymous = await ft.backToAnonymous();
            out.syncAfterLogout = await ft.waitFor(async () => (window.data.b1 || []).length === out.seededB1, 8000);
            return out;
        });
    },

    // Faz 4 · J1 — Rules v2 Aşama A ile istemci hizalaması (M1-M3). Yalnız emülatörde (yeni kurallar yalnız orada yüklü).
    async j1RulesAlignment(page) {
        return page.evaluate(async () => {
            const ft = window.__ft;
            if (!ft.emulator) return { skipped: 'yalnız --emu ile' };
            const out = {}, alerts = [];
            const origAlert = window.showAppAlert, origConfirm = window.showCustomConfirm;
            window.showAppAlert = (m, t) => { alerts.push(`${t}: ${m}`); };
            window.showCustomConfirm = async () => true;
            const take = () => alerts.splice(0).join(' | ');
            const has = async (col, id) => (await ft.readAll(col)).some(d => String(d.id) === String(id));
            try {
                window.setActiveUser({ name: 'Flow Test ' + ft.MARKER, code: '00001' });
                out.anonymous = !!window.userAuth?.isAnonymous;

                // M1 · personel silme kapıları (kayıt yerinde kalır, anlaşılır mesaj)
                const po = { id: window.makeId(), urun: 'J1 ' + ft.MARKER, aciklama: ft.MARKER, createdBy: '00001', createdByName: 'Flow Test ' + ft.MARKER, durum: 'Onay Bekliyor' };
                await window.appendItem('purchaseOrders', po);
                await ft.waitFor(async () => (window.data.purchaseOrders || []).some(p => String(p.id) === String(po.id)));
                await window.deletePurchaseRequest(po.id);
                out.staffDeletePurchase = { kept: await has('purchaseOrders', po.id), alert: take() };

                const rq = { id: window.makeId(), ürün: 'J1 ' + ft.MARKER, adet: 1, durum: 'Beklemede', personel: 'Flow Test ' + ft.MARKER };
                await window.appendItem('requests', rq);
                await ft.waitFor(async () => (window.data.requests || []).some(r => String(r.id) === String(rq.id)));
                await window.deleteRequest(rq.id);
                out.staffDeleteRequest = { kept: await has('requests', rq.id), alert: take() };

                const b1 = (window.data.b1 || [])[0];
                await window.toggleWatch('b1', b1.id);
                out.staffToggleWatch = { unchanged: !!(await ft.readAll('b1')).find(x => String(x.id) === String(b1.id))?.isWatched === !!b1.isWatched, alert: take() };

                // Kapıyı atlayan doğrudan yazma: kural reddi → 'forbidden' + tek anlaşılır mesaj
                const direct = async p => { try { await p; return 'ok'; } catch (e) { return e.code; } };
                out.directAssignmentWrite = { code: await direct(window.appendItem('assignments', { id: window.makeId(), sn: ft.MARKER })), alert: take() };
                // İşaretli demo kayıtları KJ-5 gereği silinebilir; reddi işaretsiz bir kayıtla sına (admin oluşturur ve temizler).
                const unmarked = { id: window.makeId(), ürün: 'J1 işaretsiz kayıt', adet: 1, durum: 'Beklemede', personel: 'J1' };
                await ft.asAdmin(() => window.appendItem('requests', unmarked));
                await ft.waitFor(async () => (window.data.requests || []).some(r => String(r.id) === String(unmarked.id)));
                take();
                out.directStaffDeleteUnmarked = { code: await direct(window.removeItem('requests', unmarked.id)), kept: await has('requests', unmarked.id), alert: take() };
                out.directStaffDeleteMarkedDemo = { code: await direct(window.removeItem('requests', rq.id)), note: 'KJ-5: işaretli demo kaydı silinebilir' };
                await window.appendItem('requests', rq);

                // M3 · etiket ön kontrolü (form) ve kural (doğrudan)
                window.openRequestModal(false);
                ft.set('reqProdName', 'Etiket ' + ft.MARKER); ft.set('reqQty', '1'); ft.set('reqType', 'Kalıcı Zimmet');
                ft.set('reqNote', '<img src=x onerror=alert(1)> ' + ft.MARKER);
                const before = (await ft.readMarked('requests')).length;
                await window.saveRequest(new Event('submit'));
                await ft.sleep(800);
                out.formTagBlocked = { created: (await ft.readMarked('requests')).length - before, alert: take() };
                ft.set('reqNote', 'vida <5mm, a < b ' + ft.MARKER);
                await window.saveRequest(new Event('submit'));
                out.formLessThanAllowed = await ft.waitFor(async () => (await ft.readMarked('requests')).length === before + 1);
                take();
                out.directTagWrite = { code: await direct(window.appendItem('requests', { id: window.makeId(), ürün: '<b>x</b> ' + ft.MARKER })), alert: take() };

                // M2 · bakım: personel yazması Firestore'a gitmeden durur, bakım mesajı (sunucu tarafı kural matrisinde)
                const cfg = window.data.config;
                window.data.config = { ...(cfg || {}), maintenance: true };
                out.maintenanceWrite = { code: await direct(window.updateItem('requests', rq.id, { not: 'bakım ' + ft.MARKER })), alert: take() };
                window.data.config = cfg;
                out.afterMaintenanceWrite = await direct(window.updateItem('requests', rq.id, { not: 'normal ' + ft.MARKER }));

                // Admin yolu: aynı kapılar admin oturumunda açılır
                out.adminLogin = await ft.adminLogin();
                await window.toggleWatch('b1', b1.id);
                out.adminToggleWatch = await ft.waitFor(async () => !!(await ft.readAll('b1')).find(x => String(x.id) === String(b1.id))?.isWatched !== !!b1.isWatched);
                await window.toggleWatch('b1', b1.id);   // geri al
                await window.deletePurchaseRequest(po.id);
                out.adminDeletePurchase = !(await has('purchaseOrders', po.id));
                await window.removeItem('requests', unmarked.id);
                out.adminDeleteUnmarked = !(await has('requests', unmarked.id));
                take();
                out.backToAnonymous = await ft.backToAnonymous();
            } finally {
                window.showAppAlert = origAlert; window.showCustomConfirm = origConfirm;
            }
            return out;
        });
    },

    // Faz 4 · J2 — XSS'in tamamı: lint'in düzelttiği yüzeyler zararlı yüklerle (etiket, nitelikten kaçış, JS dizgesinden kaçış).
    // Yalnız bellek içi veri; Firestore'a yazılmaz. Delegation eylemleri ham değeri bozmadan taşımalı; onay API'si metin/Node/html.
    async j2XssSurfaces(page, browser) {
        const PAY = {
            tag: '<img src=x onerror="window.__xss=(window.__xss||0)+1">',
            attr: '"><img src=x onerror="window.__xss=(window.__xss||0)+1">',
            js: "');window.__xss=(window.__xss||0)+1;//",
            ent: '&quot;);window.__xss=(window.__xss||0)+1;//',
        };
        const index = await page.evaluate(async (PAY) => {
            const ft = window.__ft, out = {};
            window.__xss = 0;
            const orig = { b1: window.data.b1, personel: window.data.personel, productTypes: window.data.productTypes, user: window.getActiveUser() };
            try {
                // B1 tablo + kartlar + tooltip (table-engine)
                window.data.b1 = [{ id: 'x1', ürün: PAY.tag, marka: PAY.attr, raf: PAY.js, sütun: PAY.ent, durumu: PAY.tag, tür: PAY.attr, adet: 2, lastUpdate: PAY.tag, isWatched: true }];
                window.renderTable('b1');
                window.renderCardSearchResults('b1', window.data.b1);
                window.renderMobileCards('b1');
                const row = document.querySelector('tr.selectable-row[data-id="x1"]');
                if (row) row.dispatchEvent(new MouseEvent('mouseenter'));
                out.table = { rowRendered: !!row, nameAsText: !!row && row.textContent.includes('<img src=x'), dataName: row && row.dataset.name === PAY.tag, tooltipShown: getComputedStyle(document.getElementById('custom-tooltip') || document.body).display === 'block', tooltipNoImg: !document.querySelector('#custom-tooltip img') };

                // Ürün modalı tür seçenekleri (ui-components)
                window.data.productTypes = [{ name: PAY.attr, isDemirbas: true }];
                const realAdm = window.isDbAdmin; window.isDbAdmin = () => true;
                try { window.openProductModal('add', null, 'b1'); } catch (e) { out.productModalError = e.message; }
                window.isDbAdmin = realAdm;
                const opt = [...(document.getElementById('prodType')?.options || [])].find(o => o.value === PAY.attr);
                out.productTypeOption = !!opt;
                if (typeof window.closeProductModal === 'function') window.closeProductModal();

                // Navbar adı (auth-engine)
                window.updateNavbarUI({ name: PAY.tag });
                out.navbarAsText = (document.getElementById('user-display')?.textContent || document.body.textContent).includes('👤 <img');

                // Akış başlatma personel araması → delegation ham adı taşır (edm-workflow)
                window.data.personel = [{ id: 'p1', name: 'Zz ' + PAY.js }, { id: 'p2', name: 'Zz ' + PAY.attr }];
                const input = document.createElement('input');
                input.setAttribute('onkeyup', 'window.searchPersonnelForStart(this.value, 77)');
                document.body.appendChild(input);
                let picked = null; const realSel = window.selectPersonForWorkflow;
                window.selectPersonForWorkflow = (i, n) => { picked = { i, n }; };
                window.searchPersonnelForStart('zz', 77);
                const items = document.querySelectorAll('#personnel_dropdown_77 [data-action="selectPerson"]');
                if (items[0]) items[0].click();
                out.startSearch = { items: items.length, pickedExact: !!picked && picked.i === 77 && picked.n === 'Zz ' + PAY.js };
                window.selectPersonForWorkflow = realSel;
                document.getElementById('personnel_dropdown_77')?.remove(); input.remove();

                // Onay API'si (M6): metin varsayılan, {html:true} sabit, Node, düğme metni geri uyumu
                const msgEl = document.getElementById('alertMessage');
                const answer = async (fn, yes) => { const p = fn(); await ft.sleep(30); const snap = { html: msgEl.innerHTML, text: msgEl.textContent, ok: document.getElementById('alertConfirmBtn').textContent }; document.getElementById(yes ? 'alertConfirmBtn' : 'alertCancelBtn').click(); return { snap, res: await p }; };
                const t = await answer(() => window.showCustomConfirm('T', PAY.tag), false);
                const h = await answer(() => window.showCustomConfirm('T', '<b>sabit</b>', { html: true }), false);
                const nd = document.createElement('div'); nd.id = 'j2Node'; nd.textContent = 'düğüm';
                const n = await answer(() => window.showCustomConfirm('T', nd), true);
                const legacy = await answer(() => window.showCustomConfirm('T', 'x', 'Evet, Göster', 'Daha Sonra'), true);
                out.confirm = {
                    textDefault: !t.snap.html.includes('<img') && t.snap.text === PAY.tag && t.res === false,
                    htmlOptIn: h.snap.html === '<b>sabit</b>',
                    nodeAppended: n.snap.html.includes('id="j2Node"') && n.res === true,
                    legacyButtonText: legacy.snap.ok === 'Evet, Göster' && document.getElementById('alertConfirmBtn').textContent !== 'Evet, Göster',
                };

                // TODO "Ata" (M6 çifti): seçim kutusu gerçek, onay atamayı yapar
                let assigned = null; const realAssign = window.todoModule.assignTask;
                window.todoModule.assignTask = async (id, who) => { assigned = { id, who }; };
                window.data.personel = [{ id: 'p3', name: 'Ayşe ' + PAY.attr }];
                window.todoModule.openAssignModal('t-j2');
                await ft.sleep(30);
                const sel = document.getElementById('quickAssignSelect');
                out.todoAssign = { selectRendered: !!sel && sel.tagName === 'SELECT', options: sel ? sel.options.length : 0 };
                document.getElementById('alertConfirmBtn').click();
                await ft.sleep(50);
                out.todoAssign.assignedExact = !!assigned && assigned.id === 't-j2' && assigned.who === 'Ayşe ' + PAY.attr;
                window.todoModule.assignTask = realAssign;

                out.injectedImgs = document.querySelectorAll('img[src="x"]').length;
                out.xssExecuted = window.__xss || 0;
            } finally {
                Object.assign(window.data, { b1: orig.b1, personel: orig.personel, productTypes: orig.productTypes });
                window.renderTable('b1');
                if (orig.user) window.updateNavbarUI(orig.user);
            }
            return out;
        }, PAY);

        const admin = await (await browser.createBrowserContext()).newPage();
        const errs = [];
        admin.on('pageerror', e => errs.push(e.message));
        await admin.evaluateOnNewDocument(() => localStorage.setItem('admin_auth', JSON.stringify({ expiry: Date.now() + 600000 })));
        await admin.goto(page.url().replace('index.html', 'admin.html'), { waitUntil: 'domcontentloaded' });
        await new Promise(r => setTimeout(r, 9000));
        const adminOut = await admin.evaluate(async (PAY) => {
            const out = {}; window.__xss = 0;
            const sleep = ms => new Promise(r => setTimeout(r, ms));
            // Kritik stok (grup anahtarı delegation) + özel izleme kartları (kayıt JSON'u yerine data-id)
            window.data.b1 = [{ id: 'c1', ürün: PAY.tag, tür: PAY.attr, raf: PAY.js, adet: 0, limit: 5, marka: PAY.ent, durumu: 'Aktif', isWatched: true }];
            window.data.b2 = [];
            window.renderCriticalStockTable();
            let delKey = null; const realDel = window.deleteCriticalGroup; window.deleteCriticalGroup = k => { delKey = k; };
            const delBtn = document.querySelector('#criticalStockTable [data-action="deleteCriticalGroup"]');
            if (delBtn) delBtn.click();
            out.critical = { rendered: !!delBtn, keyCarriesPayload: typeof delKey === 'string' && delKey.includes(PAY.tag.slice(0, 8)) };
            window.deleteCriticalGroup = realDel;

            // ADM-05 (Faz 5.6): ilk çizim #customWatchTable'ı kendi kapsayıcısından siler, sonraki çağrılar erken döner.
            // J2'nin kaçış + delegation değişikliğini sınamak için eksik öğe geri konur (uygulama hatası ayrıca raporlanır).
            out.watchRerenderBug = !document.querySelector('#customWatchTable');
            const wc = document.getElementById('watchCardsContainer');
            if (wc && out.watchRerenderBug) { const t = document.createElement('table'); t.id = 'customWatchTable'; t.style.display = 'none'; wc.parentElement.appendChild(t); }
            window.renderCustomWatchDashboard();
            let detail = null, purchase = null; const realD = window.openWatchDetail, realP = window.requestPurchase;
            window.openWatchDetail = it => { detail = it; }; window.requestPurchase = it => { purchase = it; };
            const card = document.querySelector('.watch-card[data-action="watchDetail"]');
            const quick = document.querySelector('[data-action="watchPurchase"]');
            if (quick) quick.click();
            if (card) card.click();
            out.watch = { card: !!card, depoShown: !!card && card.textContent.includes('B1'), quickOnlyInner: !!purchase && purchase.id === 'c1', detailResolvedById: !!detail && detail.id === 'c1' && detail.marka === PAY.ent,
                diag: { cardData: card && { ...card.dataset }, b1Len: (window.data.b1 || []).length, found: !!window.findItem('b1', 'c1'), detailType: detail === null ? 'null' : typeof detail } };
            window.openWatchDetail = realD; window.requestPurchase = realP;

            // Mahal başlığı, servis görüntüleme, satın alma rozeti (adım kişisi), şablon personel araması
            window.data.locations = [{ id: 'l1', name: PAY.tag, code: PAY.attr, persons: [{ name: PAY.attr }] }];
            window.renderLocationsTable();
            window.data.serviceRecords = [{ id: 's1', urunAciklama: PAY.tag, originalData: { açıklama: PAY.tag }, hedef: PAY.attr, durum: 'Serviste / Yolda', not: PAY.tag, kaynakDepo: 'b1' }];
            try { window.viewServiceItem('s1'); } catch (e) { out.serviceError = e.message; }
            out.serviceAsText = (document.getElementById('serviceViewContent')?.textContent || '').includes('<img src=x');
            window.data.purchaseOrders = [{ id: 'po-j2', urun: 'J2', evrakNo: 'E-1', durum: 'Onay Bekliyor', createdAt: Date.now(), workflow: { started: true, currentStep: 0, steps: [{ user: PAY.tag, status: 'pending' }] } }];
            try { window.renderPurchaseModule(); window.renderServicesModule(); } catch (e) { out.purchaseError = e.message; }
            out.badgeAsText = document.body.textContent.includes('<img src=x onerror="window.__xss=(window.__xss||0)+1"> Bekliyor');

            window.data.personel = [{ id: 'p9', name: 'Qq ' + PAY.js }];
            let added = null; const realAdd = window.addPersonnelToTemplate; window.addPersonnelToTemplate = (n, t, s) => { added = { n, t, s }; };
            let box = document.getElementById('tplAuthResults');
            const temp = !box; if (temp) { box = document.createElement('div'); box.id = 'tplAuthResults'; document.body.appendChild(box); }
            window.searchPersonnelForTemplate('qq', 'auth');
            const item = box.querySelector('[data-action="addPersonnel"]');
            if (item) item.click();
            out.templateSearch = { item: !!item, addedExact: !!added && added.n === 'Qq ' + PAY.js && added.t === 'auth' && added.s === undefined };
            window.addPersonnelToTemplate = realAdd; if (temp) box.remove();

            await sleep(300);
            out.injectedImgs = document.querySelectorAll('img[src="x"]').length;
            out.xssExecuted = window.__xss || 0;
            return out;
        }, PAY);
        adminOut.pageErrors = errs;
        await admin.browserContext().close();
        return { index, admin: adminOut };
    },

    // Faz 4 · J3 — oturum ve vize (4.4): tek endAdminSession, sekmeye bağlı admin oturumu (AUTH-05), sanal "Admin"in kaldırılması
    // (M9), admin.html kapısı (M8), kilitte signOut + veri akışının sürmesi (M10), parola geçiş kuralı (M11). Statik ve birim
    // kontrolleri iki ortamda; gerçek admin oturumu gerektirenler yalnız --emu (gerçek projede admin kimlik bilgisi kullanılmaz).
    async j3SessionVisa(page, browser) {
        const src = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
        const sleep = ms => new Promise(r => setTimeout(r, ms));
        const out = {};
        const idx = src('index.html'), adm = src('admin.html');
        const inputTag = (html, id) => (html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`)) || [''])[0];
        out.static = {
            noMaxlength: [inputTag(idx, 'access-val-node'), inputTag(idx, 'maintenanceCode'), inputTag(adm, 'lock-val-node')].every(t => t && !/maxlength/.test(t)),
            no5HaneText: !/5 haneli/.test(idx),
            noVizeFlagReads: ['script.js', 'src/ui/ui-components.js', 'src/modules/auth-engine.js', 'src/services/firebase-handler.js'].every(f => !/getItem\(\s*['"]adminVizesi/.test(src(f))),
            noVirtualAdmin: ['src/modules/auth-engine.js', 'admin.html', 'src/utils/alert.js', 'security.js'].every(f => !/name:\s*'Admin'/.test(src(f))),
            loginAsAdminRemoved: !/window\.loginAsAdmin\s*=/.test(src('src/services/firebase-handler.js')),
        };

        // Birim: geçiş kuralı, 6-11 karakterin ağa gitmeden reddi, vize uzatma (T4), zamanlayıcının tek yola gitmesi
        out.unit = await page.evaluate(async () => {
            const S = window.SecurityConfig, Sess = window.AppModules.Session, o = {};
            const sleep = ms => new Promise(r => setTimeout(r, ms));
            const n = s => { const r = S.normalizeAdminPassword(s); return r.ok ? (r.legacy ? 'legacy:' + r.value : 'as-is') : (r.error ? 'min12' : 'invalid'); };
            o.normalize = { five: n('12345'), six: n('abcdef'), eleven: n('x'.repeat(11)), twelve: n('x'.repeat(12)), four: n('1234'), empty: n('') };
            const uid = window.userAuth && window.userAuth.uid;
            const saved = { visa: localStorage.getItem('admin_auth'), end: S.endAdminSession, loaded: window.isFirebaseLoaded };
            o.midLength = { result: await S.authenticate('abcdefgh'), message: S.lastErrorMessage,
                authUnchanged: !!window.userAuth && window.userAuth.uid === uid && window.userAuth.isAnonymous, visaWritten: Sess.getAdminVisaRemaining() !== null };
            const ended = []; S.endAdminSession = async r => { ended.push(r); };
            try {
                localStorage.setItem('admin_auth', JSON.stringify({ expiry: Date.now() - 1000 }));
                o.extendExpired = Sess.extendAdminVisa();
                window.startSessionTimer();
                o.timerOnExpired = { ended: ended.slice(), notRevived: Sess.getAdminVisaRemaining() < 0 };
                Sess.grantAdminVisa();
                const e0 = JSON.parse(localStorage.getItem('admin_auth')).expiry; await sleep(15);
                window.startSessionTimer();
                o.timerExtendsValid = JSON.parse(localStorage.getItem('admin_auth')).expiry > e0 && ended.length === 1;
                const routed = []; S.endAdminSession = async r => { routed.push(r); };
                const realAlert = window.showAppAlert; window.showAppAlert = () => {};
                await window.logout('force_logout');
                window.showAppAlert = realAlert;
                o.logoutRoutesToEndAdminSession = routed;
            } finally {
                S.endAdminSession = saved.end;
                // logout hazır bayrağını kapatır; taklit edilen endAdminSession senkronu yeniden başlatmadığı için bayrak kendiliğinden
                // açılmaz — sonraki senaryoların girişi 15 sn bekleyip düşüyordu (J8 bulgusu). Gerçek çıkışta senkron yeniden başlar.
                window.isFirebaseLoaded = saved.loaded;
                clearTimeout(window.sessionTimer); clearTimeout(window.warningTimeout);
                localStorage.removeItem('admin_auth'); if (saved.visa) localStorage.setItem('admin_auth', saved.visa);
            }
            const ev = new Event('paste', { cancelable: true }); document.getElementById('access-val-node').dispatchEvent(ev);
            o.staffCodePasteBlocked = ev.defaultPrevented;
            return o;
        });

        const base = page.url().split('/index.html')[0], q = EMU ? '?emu=1' : '';
        const ctxErrors = [];
        const lockState = p => p.evaluate(() => {
            const m = document.getElementById('adminLockModal'), left = window.AppModules.Session.getAdminVisaRemaining();
            return { locked: !!m && m.style.display === 'flex', title: (document.getElementById('adminLockTitle') || {}).textContent?.trim(),
                isDbAdmin: window.isDbAdmin(), anon: !!(window.userAuth && window.userAuth.isAnonymous), visa: left === null ? null : left > 0 ? 'valid' : 'expired',
                user: (window.getActiveUser() || {}).name || null,
                fbSession: Object.keys(sessionStorage).some(k => k.startsWith('firebase:authUser:')), fbLocal: Object.keys(localStorage).some(k => k.startsWith('firebase:authUser:')) };
        });
        const waitFn = (p, fn, ms = 20000) => p.waitForFunction(fn, { timeout: ms, polling: 250 }).then(() => true, () => false);

        // M9 (iki ortam): admin oturumu yokken vize + adminVizesi bayrağı → sanal "Admin" çizilmez, yetki verilmez
        {
            const ctx = await browser.createBrowserContext(), p = await ctx.newPage();
            p.on('pageerror', e => ctxErrors.push(e.message));
            await p.evaluateOnNewDocument(() => { localStorage.setItem('admin_auth', JSON.stringify({ expiry: Date.now() + 600000 })); sessionStorage.setItem('adminVizesi', 'true'); });
            await p.goto(`${base}/index.html${q}`, { waitUntil: 'domcontentloaded' });
            await waitFn(p, () => !!window.userAuth && window.isFirebaseLoaded === true);
            await sleep(1000);
            out.noVirtualAdminIndex = await p.evaluate(() => ({ user: window.getActiveUser(), navbar: !!document.getElementById('userDisplay'), checkIsAdmin: window.checkIsAdmin(),
                loginModal: getComputedStyle(document.getElementById('loginModal')).display !== 'none' }));

            // M8 (iki ortam): geçerli vize ama bu sekmede Firebase admin oturumu yok → kilit kartı; paylaşılan vize silinmez
            const a = await ctx.newPage(); a.on('pageerror', e => ctxErrors.push(e.message));
            await a.goto(`${base}/admin.html${q}`, { waitUntil: 'domcontentloaded' });
            await waitFn(a, () => document.getElementById('adminLockModal').style.display === 'flex');
            out.adminGateNoSession = await lockState(a);
            out.adminLockPasteAllowed = await a.evaluate(() => { const ev = new Event('paste', { cancelable: true }); document.getElementById('lock-val-node').dispatchEvent(ev); return !ev.defaultPrevented; });
            await ctx.close();

            // F5 + dolmuş vize (iki ortam): canlanmaz, endAdminSession('expired') → kilit kartı, vize silinir
            const ctx2 = await browser.createBrowserContext(), e = await ctx2.newPage();
            e.on('pageerror', x => ctxErrors.push(x.message));
            await e.evaluateOnNewDocument(() => localStorage.setItem('admin_auth', JSON.stringify({ expiry: Date.now() - 5000 })));
            await e.goto(`${base}/admin.html${q}`, { waitUntil: 'domcontentloaded' });
            await waitFn(e, () => document.getElementById('adminLockModal').style.display === 'flex' && !!window.userAuth);
            await sleep(1500);
            out.adminExpiredOnLoad = await lockState(e);
            await ctx2.close();
        }

        if (!EMU) { out.emulator = 'skipped (gerçek admin oturumu yalnız --emu)'; out.pageErrors = ctxErrors; return out; }

        const AUTH = 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
        const LONG = 'emu-j3-uzun-parola';   // yalnız emülatör hesabı; koşu sonunda eski koda geri alınır
        const emu = out.emu = {};
        const ctx = await browser.createBrowserContext();
        const open = async url => { const p = await ctx.newPage(); p.on('pageerror', x => ctxErrors.push(x.message)); p.on('dialog', d => d.dismiss()); await p.goto(url, { waitUntil: 'domcontentloaded' }); return p; };
        const unlock = (p, pass) => p.evaluate(async pass => {
            window._dx._b['lock-val-node'] = pass; await window.unlockAdmin();
            const err = document.getElementById('lockErrorMsg');
            return { error: err.style.display !== 'none' ? err.textContent : null };
        }, pass);
        const lockedAnon = p => waitFn(p, () => document.getElementById('adminLockModal').style.display === 'flex' && !!window.userAuth && window.userAuth.isAnonymous);
        const restorePassword = p => p.evaluate(async (AUTH, LONG, CODE) => {
            const sdk = await import(AUTH), auth = sdk.getAuth(window.firebaseApp);
            if (!(auth.currentUser && !auth.currentUser.isAnonymous)) { if (!(await window.SecurityConfig.authenticate(LONG))) return 'not-needed-or-failed'; }
            await sdk.updatePassword(auth.currentUser, CODE); return 'restored';
        }, AUTH, LONG, EMU_ADMIN_CODE).catch(err => 'restore error: ' + err.message);
        let a = null, rotated = false;
        try {
            // 1 · gerçek giriş yolu: index "Yönetici Paneli" → admin.html (aynı sekme)
            a = await open(`${base}/index.html?emu=1`);
            await waitFn(a, () => window.isFirebaseLoaded === true && !!window.userAuth);
            const nav = a.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 });
            await a.evaluate(code => { window._dx._b['access-val-node'] = code; window.checkAdminAndGo(); }, EMU_ADMIN_CODE);
            await nav;
            await waitFn(a, () => window.isDbAdmin && window.isDbAdmin() && window.isFirebaseLoaded === true);
            emu.login = { path: await a.evaluate(() => location.pathname), ...(await lockState(a)) };

            // 2 · "tarayıcı kapat-aç" eşdeğeri: aynı profilde YENİ sekme (sessionStorage taşınmaz; localStorage/IndexedDB paylaşılır)
            const b = await open(`${base}/index.html?emu=1`);
            await waitFn(b, () => !!window.userAuth && window.isFirebaseLoaded === true);
            emu.newTabIndex = await b.evaluate(() => ({ anon: window.userAuth.isAnonymous, isDbAdmin: window.isDbAdmin(),
                loginModal: getComputedStyle(document.getElementById('loginModal')).display !== 'none' }));
            const c = await open(`${base}/admin.html?emu=1`);
            await waitFn(c, () => document.getElementById('adminLockModal').style.display === 'flex');
            emu.newTabAdmin = await lockState(c);
            await b.close(); await c.close();
            emu.firstTabStillAdmin = await lockState(a);

            // 3 · F5 aynı sekmede: sekmeye bağlı oturum korunur
            await a.reload({ waitUntil: 'domcontentloaded' });
            await waitFn(a, () => window.isDbAdmin && window.isDbAdmin() && window.isFirebaseLoaded === true);
            emu.reloadSameTab = await lockState(a);

            // 4 · vize dolumu (aralık kontrolü) → signOut → kilit kartı; kilitliyken etkinlik vizeyi canlandırmaz
            await a.evaluate(() => localStorage.setItem('admin_auth', JSON.stringify({ expiry: Date.now() - 1000 })));
            emu.expiry = { reached: await lockedAnon(a), ...(await lockState(a)) };
            await a.mouse.move(40, 40); await a.mouse.move(90, 120); await a.keyboard.press('Shift'); await sleep(2500);
            emu.activityWhileLocked = await lockState(a);

            // 5 · kilit açma: 6-11 karakter ağa gitmeden reddedilir; doğru kodla açılır ve canlı veri akmaya devam eder (M10)
            emu.unlockMidLength = { ...(await unlock(a, 'abcdefgh')), ...(await lockState(a)) };
            emu.unlock = await unlock(a, EMU_ADMIN_CODE);
            await waitFn(a, () => window.isDbAdmin());
            emu.afterUnlock = { ...(await lockState(a)), sync: await a.evaluate(() => window.getSyncHealth()) };
            emu.liveDataAfterUnlock = await a.evaluate(async MARKER => {
                const fsm = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
                const id = 'j3_live_' + Date.now(), ref = fsm.doc(window.fireDb, window.COLLECTION_ROOT, 'b1', 'items', id);
                const until = async fn => { const t = Date.now(); while (Date.now() - t < 8000) { if (fn()) return true; await new Promise(r => setTimeout(r, 200)); } return false; };
                await fsm.setDoc(ref, { id, ürün: 'J3 canlı ' + MARKER, adet: 1 });
                const arrived = await until(() => (window.data.b1 || []).some(x => x.id === id));
                await fsm.deleteDoc(ref);
                const removed = await until(() => !(window.data.b1 || []).some(x => x.id === id));
                return { arrived, removed };
            }, MARKER);

            // 6 · ≥12 karakterli parola (emülatör hesabında geçici rotasyon) + "Güvenli Çıkış" (signOut)
            await a.evaluate(async (AUTH, LONG) => { const sdk = await import(AUTH); await sdk.updatePassword(sdk.getAuth(window.firebaseApp).currentUser, LONG); }, AUTH, LONG);
            rotated = true;
            await a.evaluate(() => { window.showCustomConfirm = async () => true; window.adminLogout(); });
            emu.secureExit = { reached: await lockedAnon(a), ...(await lockState(a)) };
            emu.unlockOldCodeAfterRotation = { ...(await unlock(a, EMU_ADMIN_CODE)), ...(await lockState(a)) };
            emu.unlockLong = await unlock(a, LONG);
            emu.unlockLongOk = await waitFn(a, () => window.isDbAdmin());
            emu.passwordRestore = await restorePassword(a); rotated = emu.passwordRestore !== 'restored';

            // 7 · F5 + dolmuş vize, admin token'ı canlıyken: vize canlanmaz, Firebase oturumu kapanır
            await a.evaluate(() => { localStorage.setItem('admin_auth', JSON.stringify({ expiry: Date.now() - 1000 })); location.reload(); }).catch(() => {});
            await sleep(1500);
            emu.reloadExpired = { reached: await lockedAnon(a), ...(await lockState(a)) };

            // 8 · "Oturumu Kapat" → index; anonim oturum yerel kalıcılıkta
            await unlock(a, EMU_ADMIN_CODE);
            await waitFn(a, () => window.isDbAdmin());
            const nav2 = a.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 });
            await a.evaluate(() => { window.adminForceLogout(); });
            await nav2;
            await waitFn(a, () => !!window.userAuth && window.isFirebaseLoaded === true);
            emu.logoutToIndex = { path: await a.evaluate(() => location.pathname), ...(await a.evaluate(() => ({ anon: window.userAuth.isAnonymous, user: window.getActiveUser(),
                visa: window.AppModules.Session.getAdminVisaRemaining(), loginModal: getComputedStyle(document.getElementById('loginModal')).display !== 'none',
                fbSession: Object.keys(sessionStorage).some(k => k.startsWith('firebase:authUser:')), fbLocal: Object.keys(localStorage).some(k => k.startsWith('firebase:authUser:')) }))) };

            // 9 · M9: J3 öncesi istemcinin bıraktığı KALICI admin oturumu (IndexedDB, vize/kimlik yok) → açılışta bayat → signOut
            const d = await ctx.newPage(); d.on('pageerror', x => ctxErrors.push(x.message));
            const cfg = await a.evaluate(() => window.firebaseApp.options);
            await d.goto(`${base}/404.html`, { waitUntil: 'domcontentloaded' });
            emu.legacySeed = await d.evaluate(async (cfg, AUTH, CODE) => {
                const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
                const sdk = await import(AUTH), auth = sdk.getAuth(initializeApp(cfg));
                sdk.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
                localStorage.removeItem('admin_auth'); localStorage.removeItem('activeUser');
                // eski istemci: getAuth varsayılanı (IndexedDB, kalıcı), persistence ayarı yok
                await sdk.signInWithEmailAndPassword(auth, 'admin@medipol.local', CODE);
                return auth.currentUser.email;
            }, cfg, AUTH, EMU_ADMIN_CODE);
            await d.goto(`${base}/index.html?emu=1`, { waitUntil: 'domcontentloaded' });
            await waitFn(d, () => !!window.userAuth && window.userAuth.isAnonymous && window.isFirebaseLoaded === true);
            await sleep(1000);
            emu.legacyPersistentAdmin = await d.evaluate(() => ({ anon: !!window.userAuth?.isAnonymous, isDbAdmin: window.isDbAdmin(), user: window.getActiveUser(),
                navbar: !!document.getElementById('userDisplay'), loginModal: getComputedStyle(document.getElementById('loginModal')).display !== 'none' }));
        } finally {
            if (rotated && a) emu.passwordRestoreFinally = await restorePassword(a);
            await ctx.close();
        }
        out.pageErrors = ctxErrors;
        return out;
    },

    // Faz 4 · J4 — self-approval iş kuralında (4.7 · EBYS-04, T6, M12), auditLogs (KJ-7, M14), rapor (EBYS-05), biyometrik
    // yedek yolunun kapanması (4.5 · AUTH-03, M13). Onay yazmaları bellek içi / kayıtlı; günlük gerçek demoda bellekte, emülatörde
    // gerçek yazılır ve admin olarak (başka bir sekmeden) geri okunur. Admin parola yeniden doğrulaması yalnız --emu.
    async j4SelfApproval(page, browser) {
        const src = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
        const sleep = ms => new Promise(r => setTimeout(r, ms));
        const TOKEN = 'J4-' + Date.now();
        const out = {};
        const sar = src('src/modules/self-approval-reporter.js');
        out.static = {
            noMonkeyPatch: !/originalConfirmRequest|originalApproveStep|_isSecured/.test(sar),
            noSessionStorageLog: !/self_approval_audit_logs/.test(sar + src('src/utils/session-store.js')),
            noFallbackPrompt: !/function _fallbackChallenge|\bprompt\(/.test(src('security-biometrics.js')),
            guardInConfirmRequest: /guardSelfApproval/.test(src('script.js')),
            guardInApproveStep: /guardSelfApproval/.test(src('src/modules/edm-workflow.js')),
            backupLimitedToCollections: /_backupKeys/.test(src('src/modules/admin/admin-backup.js')),
            reporterOnAdminPage: /self-approval-reporter\.js/.test(src('src/modules/admin/admin-main.js')),
        };

        // ── İki ortam: index, personel (anonim) oturumu ──
        out.index = await page.evaluate(async TOKEN => {
            const ft = window.__ft, o = {}, alerts = [];
            const S = window.Schema;
            const realAlert = window.showAppAlert, realModal = window.showRequestApprovalModal, realUpsert = window.upsertItem, realPrompt = window.prompt;
            const orig = { po: window.data.purchaseOrders, req: window.data.requests };
            window.showAppAlert = (m, t) => alerts.push(`${t}: ${m}`);
            const audit = async () => ft.emulator ? null : window.__auditStub.splice(0);
            try {
                // Tek politika (Schema.isSelfApproval)
                const me = { name: 'İsmail Kaya', code: '12345', id: 'p1' };
                o.policy = {
                    requestById: S.isSelfApproval({ actor: me, kind: 'request', record: { personelId: 'p1', personel: 'Başkası' } }),
                    requestIdBeatsName: S.isSelfApproval({ actor: me, kind: 'request', record: { personelId: 'p2', personel: 'ismail kaya' } }),
                    requestByNameTurkish: S.isSelfApproval({ actor: { name: 'İSMAİL  KAYA' }, kind: 'request', record: { personel: 'ismail kaya' } }),
                    purchaseByCode: S.isSelfApproval({ actor: me, kind: 'purchase', record: { createdBy: '12345', createdByName: 'X' } }),
                    purchaseByName: S.isSelfApproval({ actor: me, kind: 'purchase', record: { createdBy: 'unknown', talepEden: 'ismail kaya' } }),
                    purchaseOther: S.isSelfApproval({ actor: me, kind: 'purchase', record: { createdBy: '99999', createdByName: 'Ali' } }),
                };

                // Personel kendi satın alma adımını onaylayamaz → engel + 'blocked', kayıt yazılmaz
                const staff = { name: 'J4 Personel ' + ft.MARKER, code: '00004' };
                window.setActiveUser(staff); window.currentUser = staff;
                const po = { id: 'po_' + TOKEN, urun: TOKEN + ' Toner <b>', adet: 2, createdBy: staff.code, createdByName: staff.name, talepEden: staff.name, durum: 'Onay Bekliyor', akis: [],
                    workflow: { id: 'wf_' + TOKEN, started: true, finished: false, currentStep: 0, currentState: 'initiation', history: [], steps: [{ user: staff.name, tip: 'Yönetici', status: 'pending' }] } };
                window.data.purchaseOrders = [...(orig.po || []), po];
                let upserts = 0; window.upsertItem = async () => { upserts++; return { written: 1 }; };
                await window.approveStep(po.id);
                o.staffOwnPurchase = { writes: upserts, stepStillPending: po.workflow.steps[0].status === 'pending', alert: alerts.splice(0).join(' | '), audit: await audit() };

                // Personel kendi talebini onaylayamaz (onay penceresi hiç açılmaz); başkasının talebinde yönetici kapısı
                let modals = 0; window.showRequestApprovalModal = async () => { modals++; return null; };
                const rq = { id: 'rq_' + TOKEN, ürün: TOKEN + ' Mouse', adet: 1, personel: staff.name, durum: 'Beklemede' };
                const other = { id: 'rq2_' + TOKEN, ürün: TOKEN + ' Klavye', adet: 1, personel: 'Başka Personel', durum: 'Beklemede' };
                window.data.requests = [...(orig.req || []), rq, other];
                await window.confirmRequest(rq.id);
                o.staffOwnRequest = { modals, alert: alerts.splice(0).join(' | '), audit: await audit() };
                await window.confirmRequest(other.id);
                o.staffOthersRequest = { modals, alert: alerts.splice(0).join(' | '), audit: await audit() };

                // Sarmalayıcı yok: window.confirmRequest / approveStep iş mantığının kendisi
                o.noWrappers = window.confirmRequest._isSecured === undefined && window.approveStep._isSecured === undefined
                    && /guardSelfApproval/.test(String(window.confirmRequest)) && /guardSelfApproval/.test(String(window.approveStep));

                // M14: günlük uygulama koleksiyonu değil; saveData yazamaz
                o.auditNotInCollections = !window.COLLECTIONS.includes('auditLogs');
                o.saveDataRejectsAudit = await window.saveData('auditLogs', [{ id: 'x' }], { strict: false }).then(r => r === false, () => 'threw');

                // 4.5 / M13: biyometrik kapalı, yedek prompt yok
                let prompts = 0; window.prompt = () => { prompts++; return '12345'; };
                o.biometric = { flag: window.AppModules.Session.ENABLE_BIOMETRIC_LOGIN, verify: await window.verifyBiometrics({ reason: 'test' }), prompts,
                    helpersRemoved: typeof window.generateBiometricChallenge === 'undefined' && typeof window.authenticateWith2FA === 'undefined' };

                // EBYS-05: ada göre değil oturuma göre — "Muhammed Cer" adlı personelde düğme yok
                window.updateNavbarUI({ name: 'Muhammed Cer' });
                o.reportButtonForNamedStaff = !!document.getElementById('btn-security-report');
                alerts.length = 0;
                await window.AppModules.SelfApproval.showReportModal();
                o.reportRefusedForStaff = { modal: !!document.getElementById('self-approval-report-modal'), alert: alerts.splice(0).join(' | ') };
            } finally {
                window.showAppAlert = realAlert; window.showRequestApprovalModal = realModal; window.upsertItem = realUpsert; window.prompt = realPrompt;
                window.data.purchaseOrders = orig.po; window.data.requests = orig.req;
                document.getElementById('userDisplay')?.remove();
            }
            return o;
        }, TOKEN);

        if (!EMU) { out.emulator = 'skipped (admin parola doğrulaması ve günlüğün geri okunması yalnız --emu)'; return out; }

        // ── Yalnız emülatör: admin kendi kaydı (index talep, admin.html satın alma), günlüğün kalıcılığı, rapor ──
        const reauthFlow = async (p, fnName, arg, steps) => p.evaluate(async (fnName, arg, steps) => {
            const sleep = ms => new Promise(r => setTimeout(r, ms));
            const until = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await sleep(100); } return false; };
            const run = window[fnName](arg);
            const log = [];
            for (const st of steps) {
                if (!(await until(() => !!document.getElementById('adminReauthModal')))) { log.push('no-modal'); break; }
                if (st === 'cancel') { document.getElementById('adminReauthCancel').click(); log.push('cancelled'); continue; }
                document.getElementById('adminReauthInput').value = st;
                document.getElementById('adminReauthOk').click();
                await until(() => !document.getElementById('adminReauthModal') || getComputedStyle(document.getElementById('adminReauthError')).display !== 'none');
                const err = document.getElementById('adminReauthError');
                log.push(document.getElementById('adminReauthModal') ? 'error: ' + err.textContent : 'closed');
            }
            await run;
            return log;
        }, fnName, arg, steps);

        const emu = out.emu = {};
        // 1 · index: admin kendi talebi → yanlış parola (ağda reddedilir) + vazgeç → 'cancelled'; ikinci deneme doğru → 'approved'
        emu.indexAdminLogin = await page.evaluate(() => window.__ft.adminLogin());
        emu.indexAdminRequest = await page.evaluate(async TOKEN => {
            const ft = window.__ft, o = {}, alerts = [];
            const realAlert = window.showAppAlert, realModal = window.showRequestApprovalModal, realApply = window.applyItemOps, origReq = window.data.requests;
            const adminUser = { name: 'J4 Yönetici ' + ft.MARKER, code: 'ADMIN' };
            window.setActiveUser(adminUser); window.currentUser = adminUser;
            window.showAppAlert = (m, t) => alerts.push(`${t}: ${m}`);
            window.showRequestApprovalModal = async () => ({ sn: 'SN-J4', source: null });
            window.__j4Writes = 0; window.applyItemOps = async ops => { window.__j4Writes += ops.length; return { written: ops.length }; };
            window.data.requests = [...(origReq || []), { id: 'rqa_' + TOKEN, ürün: TOKEN + ' Monitör', adet: 1, personel: adminUser.name, durum: 'Beklemede' }];
            window.__j4Restore = () => { window.showAppAlert = realAlert; window.showRequestApprovalModal = realModal; window.applyItemOps = realApply; window.data.requests = origReq; };
            window.__j4Alerts = alerts;
            // navbar düğmesi admin oturumunda
            window.updateNavbarUI(adminUser);
            o.reportButton = !!document.getElementById('btn-security-report');
            return o;
        }, TOKEN);
        emu.indexReauthCancel = await reauthFlow(page, 'confirmRequest', 'rqa_' + TOKEN, ['yanlis-parola-12345', 'cancel']);
        emu.indexAfterCancel = await page.evaluate(() => ({ writes: window.__j4Writes, alert: window.__j4Alerts.splice(0).join(' | ') }));
        emu.indexReauthOk = await reauthFlow(page, 'confirmRequest', 'rqa_' + TOKEN, [EMU_ADMIN_CODE]);
        emu.indexAfterOk = await page.evaluate(() => ({ writes: window.__j4Writes, alert: window.__j4Alerts.splice(0).join(' | ') }));
        // tag'li metin günlüğe düşer (kural etiketi reddeder → "<" görsel eşdeğeriyle değişir)
        emu.sanitizedWrite = await page.evaluate(TOKEN => window.appendAuditLog({ type: 'J4 test', refCol: 'requests', refId: 'x', item: '<img src=x> ' + TOKEN + ' etiket', qty: 1, actorName: 'J4', result: 'cancelled', reason: 'J4 sanitize testi' }), TOKEN);
        // günlük değiştirilemez / silinemez (admin dahil)
        emu.immutable = await page.evaluate(async id => {
            const fsm = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
            const ref = fsm.doc(window.fireDb, window.COLLECTION_ROOT, 'auditLogs', 'items', id);
            return { update: await fsm.updateDoc(ref, { result: 'approved' }).then(() => 'ALLOWED', e => e.code), delete: await fsm.deleteDoc(ref).then(() => 'ALLOWED', e => e.code) };
        }, emu.sanitizedWrite.id);
        await page.evaluate(() => { window.__j4Restore(); document.getElementById('userDisplay')?.remove(); });
        emu.indexBackToAnonymous = await page.evaluate(() => window.__ft.backToAnonymous());

        // 2 · admin.html (ayrı sekme / bağlam): giriş → kendi satın alma adımı → parola → 'approved'; rapor iki sayfanın kayıtlarını gösterir
        const ctx = await browser.createBrowserContext();
        const errs = [];
        try {
            const base = page.url().split('/index.html')[0];
            const a = await ctx.newPage(); a.on('pageerror', e => errs.push(e.message)); a.on('dialog', d => d.dismiss());
            await a.goto(`${base}/index.html?emu=1`, { waitUntil: 'domcontentloaded' });
            await a.waitForFunction(() => window.isFirebaseLoaded === true && !!window.userAuth, { timeout: 20000 });
            const nav = a.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 });
            await a.evaluate(code => { window._dx._b['access-val-node'] = code; window.checkAdminAndGo(); }, EMU_ADMIN_CODE);
            await nav;
            await a.waitForFunction(() => window.isDbAdmin && window.isDbAdmin() && window.isFirebaseLoaded === true && window.approveStep, { timeout: 20000 });
            emu.adminPage = await a.evaluate(TOKEN => {
                const me = window.getActiveUser();
                const po = { id: 'poa_' + TOKEN, urun: TOKEN + ' Yazıcı', adet: 1, createdBy: me.code, createdByName: me.name, talepEden: me.name, durum: 'Onay Bekliyor', akis: [],
                    workflow: { id: 'wfa_' + TOKEN, started: true, finished: false, currentStep: 0, currentState: 'initiation', history: [], steps: [{ user: 'Başka Onaycı', tip: 'Yönetici', status: 'pending' }] } };
                window.data.purchaseOrders = [...(window.data.purchaseOrders || []), po];
                window.__j4Upserts = 0; window.upsertItem = async () => { window.__j4Upserts++; return { written: 1 }; };
                window.__j4Alerts = []; window.showAppAlert = (m, t) => window.__j4Alerts.push(`${t}: ${m}`);
                return { identity: me.name, reportButton: !!document.getElementById('btn-security-report') };
            }, TOKEN);
            emu.adminReauthOk = await reauthFlow(a, 'approveStep', 'poa_' + TOKEN, [EMU_ADMIN_CODE]);
            emu.adminAfterOk = await a.evaluate(TOKEN => ({ upserts: window.__j4Upserts, stepApproved: window.data.purchaseOrders.find(p => p.id === 'poa_' + TOKEN)?.workflow.steps[0].status, alert: window.__j4Alerts.splice(0).join(' | ') }), TOKEN);

            // Rapor: düğme → tek seferlik okuma; bu koşunun kayıtları (index personel + index admin + admin.html) görünür
            emu.report = await a.evaluate(async TOKEN => {
                const sleep = ms => new Promise(r => setTimeout(r, ms));
                document.getElementById('btn-security-report').click();
                const t = Date.now(); while (Date.now() - t < 8000 && !document.querySelector('#sarContent[data-count]')) await sleep(150);
                const rows = [...document.querySelectorAll('#self-approval-report-modal tbody tr')].map(tr => tr.textContent.replace(/\s+/g, ' ').trim()).filter(t => t.includes(TOKEN));
                const logs = (await window.fetchAuditLogs(200)).filter(l => String(l.item || '').includes(TOKEN));
                return {
                    rows: rows.length,
                    badges: [...new Set(rows.map(r => (r.match(/Engellendi|Onaylandı \(parola doğrulandı\)|Vazgeçildi \/ onay verilmedi/) || ['?'])[0]))],
                    records: logs.map(l => ({ result: l.result, refCol: l.refCol, page: l.page, authKind: l.authKind, actor: (l.actorName || '').replace(/ __flowtest__/, ''), item: l.item.replace(TOKEN, 'T'), reason: l.reason, hasTs: !!(l.ts && l.ts.toDate), keys: Object.keys(l).filter(k => k !== '_docId').sort().join(',') })),
                    injectedImgs: document.querySelectorAll('#self-approval-report-modal img').length,
                };
            }, TOKEN);
        } finally {
            await ctx.close();
        }
        out.pageErrors = errs;
        return out;
    },

    async hotfixLoginFocus(page, browser) {
        const url = page.url();
        const probe = async (beforeEnable) => {
            const p = await (await browser.createBrowserContext()).newPage();
            await p.goto(url, { waitUntil: 'domcontentloaded' });
            let early = null;
            if (beforeEnable) {
                early = await p.evaluate(() => ({ dataLoaded: window.isFirebaseLoaded === true }));
                await beforeEnable(p);
            }
            // personel snapshot'ı geldi (odak kararı bu anda verilir) ve kutu etkin
            await p.waitForFunction(() => { const i = document.getElementById('access-val-node'); return window.isFirebaseLoaded === true && i && !i.disabled; }, { timeout: 20000 });
            await new Promise(r => setTimeout(r, 300));
            const r = await p.evaluate(() => ({ active: document.activeElement?.id || document.activeElement?.tagName }));
            return { p, early, ...r };
        };
        const out = {};
        const a = await probe(null);
        out.noInteraction = a.active;
        // senkron yeniden başlar → personel snapshot'ı yine gelir → odak tekrar çekilmemeli
        out.afterResync = await a.p.evaluate(async () => {
            document.getElementById('access-val-node').blur();
            window.isFirebaseLoaded = false;   // yeniden senkron: personel snapshot'ı bayrağı tekrar true yapar
            window.startRealtimeSync();
            const t = Date.now();
            while (Date.now() - t < 10000) { await new Promise(r => setTimeout(r, 250)); const i = document.getElementById('access-val-node'); if (window.isFirebaseLoaded === true && i && !i.disabled) break; }
            await new Promise(r => setTimeout(r, 300));
            return document.activeElement?.id || document.activeElement?.tagName;
        });
        await a.p.browserContext().close();

        const b = await probe(async p => { await p.keyboard.press('Shift'); });
        out.keyBeforeData = { dataWasLoaded: b.early.dataLoaded, active: b.active };
        await b.p.browserContext().close();

        const c = await probe(async p => { await p.mouse.click(5, 5); });
        out.clickBeforeData = { dataWasLoaded: c.early.dataLoaded, active: c.active };
        await c.p.browserContext().close();
        return out;
    },

    // Faz 4 kapanış hotfix'i (saha bulgusu 07.10.2026) — çıkıştan hemen sonra, F5'siz ve TEK tıklamayla yeniden giriş. Canlıdaki
    // gecikmeyi taklit etmek için ağ yavaşlatılır (700 ms). Personel yolu ve mesaj görünürlüğü iki ortamda; admin yolları emülatörde.
    async j6PostLogoutRelogin(page, browser) {
        const sleep = ms => new Promise(r => setTimeout(r, ms));
        const base = page.url().split('/index.html')[0], q = EMU ? '?emu=1' : '';
        const settle = async (p, fn, ms = 25000, arg) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await p.evaluate(fn, arg)) return true; } catch (e) { } await sleep(200); } return false; };
        const slow = async p => { const c = await p.target().createCDPSession(); await c.send('Network.emulateNetworkConditions', { offline: false, latency: 700, downloadThroughput: 250 * 1024, uploadThroughput: 120 * 1024 }); };
        const statusVisible = p => p.evaluate(() => { const el = document.getElementById('loginStatus'); return { visible: !!el && getComputedStyle(el).display !== 'none' && el.offsetParent !== null, text: el ? el.innerText.trim() : null }; });
        const errs = [], out = {};
        const open = async (ctx, url) => { const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.dismiss()); await p.goto(url, { waitUntil: 'domcontentloaded' }); return p; };
        const staffOnce = (p, code) => p.evaluate(async code => {
            window._dx._b['access-val-node'] = code;
            const t = Date.now(); let sawWaiting = false;
            const watch = setInterval(() => { const el = document.getElementById('loginStatus'); if (el && /hazırlanıyor/.test(el.innerText) && getComputedStyle(el).display !== 'none') sawWaiting = true; }, 50);
            await window.handleLogin();   // TEK tıklama
            clearInterval(watch);
            return { ok: document.body.classList.contains('logged-in') && !!window.getActiveUser(), ms: Date.now() - t, sawWaitingMessage: sawWaiting };
        }, code);

        // ── İki ortam: mesaj görünürlüğü + personel yolu ──
        const ctx = await browser.createBrowserContext();
        try {
            const p = await open(ctx, `${base}/index.html${q}`);
            await settle(p, () => window.isFirebaseLoaded === true && (window.data.personel || []).length > 0);
            await sleep(4800);   // "Sistem Hazır" mesajının gizlendiği an geçti
            out.wrongCodeAfter4s = await p.evaluate(async () => { window._dx._b['access-val-node'] = '00000x'; await window.handleLogin(); return null; }).then(() => statusVisible(p));
            const code = await p.evaluate(() => { const x = (window.data.personel || []).find(p => p.code && p.name && !/Muhammed Cer|^Admin$/.test(p.name)); return x && String(x.code); });
            out.doubleClick = await p.evaluate(async code => {
                window._dx._b['access-val-node'] = code; let n = 0; const real = window.setActiveUser; window.setActiveUser = u => { n++; return real(u); };
                await Promise.all([window.handleLogin(), window.handleLogin()]); window.setActiveUser = real; return { setActiveUserCalls: n, loggedIn: !!window.getActiveUser() };
            }, code);
            await slow(p);
            await p.evaluate(() => window.handleLogout('manual'));
            out.staffRelogin = await staffOnce(p, code);   // çıkışın hemen ardından, F5'siz, tek tıklama
            out.staffRelogin.afterVisible = await statusVisible(p);
            await p.evaluate(() => window.handleLogout('manual'));
            out.oldFiveDigitAdminCode = await p.evaluate(async () => { window._dx._b['access-val-node'] = '12345'; const a = []; const r = window.showAppAlert; window.showAppAlert = (m, t) => a.push(m); await window.checkAdminAndGo(); window.showAppAlert = r; return { alert: a.join(' | '), isDbAdmin: window.isDbAdmin() }; });
        } finally { await ctx.close(); }

        if (!EMU) { out.emulator = 'skipped (admin yolları yalnız --emu)'; out.pageErrors = errs; return out; }

        // ── Emülatör: admin yolları, yavaş ağda, tek tıklama ──
        const adminCtx = await browser.createBrowserContext();
        try {
            const a = await open(adminCtx, `${base}/index.html?emu=1`);
            const adminFromIndex = async (label) => {
                const nav = a.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).then(() => true, () => false);
                await a.evaluate(code => { window._dx._b['access-val-node'] = code; window.checkAdminAndGo(); }, EMU_ADMIN_CODE);   // TEK tıklama, beklemeden
                const navigated = await nav;
                const admin = navigated && await settle(a, () => location.pathname.endsWith('admin.html') && window.isDbAdmin && window.isDbAdmin() && window.isFirebaseLoaded === true, 25000);
                const st = await a.evaluate(() => ({ path: location.pathname, isDbAdmin: window.isDbAdmin(), anon: !!(window.userAuth && window.userAuth.isAnonymous), locked: document.getElementById('adminLockModal')?.style.display === 'flex' })).catch(e => ({ err: e.message }));
                out[label] = { navigated, admin, ...st };
            };
            await settle(a, () => window.isFirebaseLoaded === true);
            await adminFromIndex('adminFirstLogin');
            await slow(a);
            // (a) admin.html "Oturumu Kapat" → index → hemen admin girişi
            const navOut = a.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 });
            await a.evaluate(() => { window.adminForceLogout(); });
            await navOut;
            await settle(a, () => typeof window.checkAdminAndGo === 'function' && !!window._dx, 20000);
            await adminFromIndex('afterLogoutButtonImmediateAdmin');
            // (b) kilit ("Güvenli Çıkış") → hemen kilit açma
            await a.evaluate(() => { window.showCustomConfirm = async () => true; window.adminLogout(); });
            await settle(a, () => document.getElementById('adminLockModal').style.display === 'flex', 15000);
            out.lockImmediateUnlock = await a.evaluate(async code => { window._dx._b['lock-val-node'] = code; await window.unlockAdmin(); return null; }, EMU_ADMIN_CODE)
                .then(() => settle(a, () => window.isDbAdmin() && document.getElementById('adminLockModal').style.display !== 'flex', 20000))
                .then(async ok => ({ ok, ...(await a.evaluate(() => ({ isDbAdmin: window.isDbAdmin(), anon: !!window.userAuth?.isAnonymous, sync: window.getSyncHealth() }))) }));
            // (c) index'te admin iken navbar "Çıkış Yap" (yumuşak sıfırlama) → hemen admin girişi
            const navHome = a.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 });
            await a.evaluate(() => { window.location.href = 'index.html'; });
            await navHome;
            await settle(a, () => window.isDbAdmin && window.isDbAdmin() && !!document.getElementById('userDisplay'), 25000);
            await a.evaluate(() => window.handleLogout('manual'));
            await adminFromIndex('indexLogoutImmediateAdmin');
        } finally { await adminCtx.close(); }
        out.pageErrors = errs;
        return out;
    },

    // Faz 4 · J6 — J5'te sürümü sabitlenen / değişen ve SRI eklenen CDN kütüphaneleri iki sayfada gerçekten çalışıyor mu (Ek A:
    // Excel, PDF raporu, grafikler, VIP sürükle-bırak, e-posta). Dosya indirilmez: çıktılar bellekte üretilir. Yazma yok.
    async j6CdnLibraries(page, browser) {
        const probe = () => (async () => {
            const o = {};
            o.globals = { XLSX: typeof window.XLSX, jsPDF: typeof (window.jspdf && window.jspdf.jsPDF), Chart: typeof window.Chart, LZString: typeof window.LZString,
                emailjs: typeof window.emailjs, Sortable: typeof window.Sortable };
            try {
                const doc = new window.jspdf.jsPDF();
                doc.autoTable({ head: [['Ürün', 'Adet']], body: [['Laptop', '2'], ['Mouse', '5']] });
                o.pdfAutoTable = { bytes: doc.output('arraybuffer').byteLength, finalY: Math.round((doc.lastAutoTable || doc.autoTable.previous || {}).finalY || 0) };
            } catch (e) { o.pdfAutoTable = 'ERR ' + e.message; }
            try {
                const wb = window.XLSX.utils.book_new();
                window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet([{ ürün: 'Laptop', adet: 2 }]), 'Test');
                o.xlsxBytes = window.XLSX.write(wb, { type: 'array', bookType: 'xlsx' }).byteLength;
            } catch (e) { o.xlsxBytes = 'ERR ' + e.message; }
            try { o.lzRoundTrip = window.LZString.decompressFromUTF16(window.LZString.compressToUTF16('envanter')) === 'envanter'; } catch (e) { o.lzRoundTrip = 'ERR ' + e.message; }
            o.charts = window.Chart && window.Chart.instances ? Object.keys(window.Chart.instances).length : null;
            o.fontAwesome = getComputedStyle(document.querySelector('.fas') || document.body, '::before').fontFamily || '';
            o.fontAwesome = /Font Awesome/i.test(o.fontAwesome);
            return o;
        })();
        const out = {};
        out.index = await page.evaluate(probe);
        const admin = await (await browser.createBrowserContext()).newPage();
        const errs = [];
        admin.on('pageerror', e => errs.push(e.message));
        await admin.evaluateOnNewDocument(() => localStorage.setItem('admin_auth', JSON.stringify({ expiry: Date.now() + 600000 })));
        await admin.goto(page.url().replace('index.html', 'admin.html'), { waitUntil: 'domcontentloaded' });
        await new Promise(r => setTimeout(r, 9000));
        out.admin = await admin.evaluate(probe);
        out.admin.sortableGrid = await admin.evaluate(() => !!document.querySelector('.vip-grid, #vipGrid, [data-sortable]') || typeof window.Sortable === 'function');
        out.adminPageErrors = errs;
        await admin.browserContext().close();
        return out;
    },

    // Faz 4 · J6 — Ek A'nın Faz 4'ün dokunduğu oturum / bakım / VIP maddeleri uçtan uca (önceki senaryolar bunları birim
    // düzeyinde sınıyordu). İki ortam: gerçek personel girişi → modal + yazma → çıkış → tekrar giriş → zaman aşımı → tekrar
    // giriş; mobil otomatik kart görünümü. Yalnız emülatör (kural 7: VIP komutları yalnız emülatörde): yönetici mesajı bir kez,
    // force logout bir kez + tekrar giriş, bakım modu (personel kilitlenir / admin kilitlenmez / bakım ekranından admin girişi).
    // Faz 4B · J7 (4.6 / K4) — personel hesabı açma, gerçek UI fonksiyonlarıyla ve gerçek admin oturumuyla (yalnız --emu):
    //   A · index: "Yeni Personel" (openPersonelModal → addPersonel) kaydı + hesap açar; admin oturumu düşmez; açılan hesapla
    //       e-posta/parola girişi aynı uid'yi verir. Test personeli sonunda silinir.
    //   B · admin.html (index "Yönetici Paneli" girişiyle): VIP "Auth Göç Aracı" önizleme → onay → tüm personel bağlanır; ikinci
    //       çalıştırma hiçbir şey açmaz; önizleme/uyarı/log metinlerinde giriş kodu geçmez; düğme etiketi geri gelir.
    async j7StaffProvisioning(page, browser) {
        const out = {};
        if (!EMU) return { emulator: 'skipped (gerçek admin ve Auth emülatörü yalnız --emu)', ok: true };
        const APP = 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js', AUTH = 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

        // ── A · index: personel ekleme akışı ──
        // (sayfa içinde eval yok: CSP 'unsafe-eval' vermez — doğrulayıcı her evaluate'te satır içi)
        out.add = await page.evaluate(async (APP, AUTH) => {
            const ft = window.__ft, o = {};
            const verify = async (APP, AUTH, email, password) => {
                const appMod = await import(APP), authMod = await import(AUTH);
                const app = appMod.getApps().find(x => x.name === 'j7verify') || appMod.initializeApp(window.firebaseApp.options, 'j7verify');
                const auth = window.__j7auth || (window.__j7auth = authMod.initializeAuth(app, { persistence: authMod.inMemoryPersistence }));
                if (!window.__j7emu) { authMod.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true }); window.__j7emu = true; }
                const cred = await authMod.signInWithEmailAndPassword(auth, email, password);
                const uid = cred.user.uid; await authMod.signOut(auth); return uid;
            };
            const alerts = [], realAlert = window.showAppAlert;
            window.showAppAlert = (m, t) => alerts.push({ m: String(m), t });
            try {
                await ft.asAdmin(async () => {
                    const adminUid = window.userAuth.uid;
                    const name = `J7 Personel ${ft.MARKER}`;
                    window.openPersonelModal('add');
                    document.getElementById('personelName').value = name;
                    const code = document.getElementById('personelCode').value;
                    document.getElementById('personelForm').onsubmit({ preventDefault() {} });
                    o.alerted = await ft.waitFor(async () => alerts.some(a => /Personel eklendi/.test(a.m)), 20000);
                    const doc = (await ft.readAll('personel')).find(d => d.name === name);
                    o.alert = alerts.find(a => /Personel eklendi/.test(a.m));
                    o.linked = !!(doc && doc.uid) && doc.authEmail === window.StaffProvisioning.staffEmail(doc.id);
                    o.adminKept = window.isDbAdmin() && window.userAuth.uid === adminUid && window.userAuth.email === 'admin@medipol.local';
                    o.loginUidMatches = doc ? (await verify(APP, AUTH, doc.authEmail, window.StaffProvisioning.staffPassword(code))) === doc.uid : false;
                    o.codeNotInAlert = !alerts.some(a => a.m.includes(code));
                    if (doc) await window.removeItem('personel', doc._docId);
                });
            } finally { window.showAppAlert = realAlert; }
            return o;
        }, APP, AUTH);

        // ── B · admin.html: VIP Auth Göç Aracı ──
        const ctx = await browser.createBrowserContext();
        const errs = [];
        const base = `http://127.0.0.1:${PORT}`;
        const waitFn = async (p, fn, ms = 25000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await p.evaluate(fn)) return true; } catch (e) { } await new Promise(r => setTimeout(r, 250)); } return false; };
        try {
            const a = await ctx.newPage();
            a.on('pageerror', e => errs.push(e.message)); a.on('dialog', d => d.dismiss());
            await a.goto(`${base}/index.html?emu=1`, { waitUntil: 'domcontentloaded' });
            await waitFn(a, () => window.isFirebaseLoaded === true && !!window.userAuth);
            const nav = a.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 });
            await a.evaluate(code => { window._dx._b['access-val-node'] = code; window.checkAdminAndGo(); }, EMU_ADMIN_CODE);
            await nav;
            out.adminReady = await waitFn(a, () => window.isDbAdmin && window.isDbAdmin() && window.isFirebaseLoaded === true && (window.data.personel || []).length > 0);
            out.vip = await a.evaluate(async (APP, AUTH) => {
                const o = {};
                const verify = async (APP, AUTH, email, password) => {
                const appMod = await import(APP), authMod = await import(AUTH);
                const app = appMod.getApps().find(x => x.name === 'j7verify') || appMod.initializeApp(window.firebaseApp.options, 'j7verify');
                const auth = window.__j7auth || (window.__j7auth = authMod.initializeAuth(app, { persistence: authMod.inMemoryPersistence }));
                if (!window.__j7emu) { authMod.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true }); window.__j7emu = true; }
                const cred = await authMod.signInWithEmailAndPassword(auth, email, password);
                const uid = cred.user.uid; await authMod.signOut(auth); return uid;
            };
                const btn = document.querySelector('button[onclick*="vipMigrateStaffAuth"]');
                o.button = !!btn;
                const labelBefore = btn && btn.textContent.trim();
                const adminUid = window.userAuth.uid;
                // Önceki koşulardan kalan bağları sıfırla (Auth hesapları emülatörde kalır → bu koşuda "relinked" beklenir)
                for (const p of (window.data.personel || []).filter(p => p.uid)) await window.updateItem('personel', p.id, { uid: null, authEmail: null });
                const codes = (window.data.personel || []).map(p => String(p.code || '')).filter(c => c.length >= 3);
                const alerts = [], confirms = [];
                const real = { alert: window.showAppAlert, confirm: window.showCustomConfirm };
                window.showAppAlert = (m, t) => alerts.push({ m: String(m), t });
                window.showCustomConfirm = async (title, msg) => { confirms.push(String(msg)); return true; };
                try {
                    const plan = window.StaffProvisioning.planProvisioning(window.data.personel);
                    o.planned = plan.toCreate.length;
                    await window.vipMigrateStaffAuth(btn);
                    o.preview = confirms[0] && { counts: /açılacak: \d+/.test(confirms[0]), noCode: !codes.some(c => confirms[0].includes(c)), adminNote: /yönetici oturumunuz etkilenmez/.test(confirms[0]) };
                    o.result = alerts.at(-1);
                    o.allLinked = await (async () => { const t = Date.now(); while (Date.now() - t < 10000) { if ((window.data.personel || []).filter(p => window.StaffProvisioning.staffPassword(p.code)).every(p => p.uid)) return true; await new Promise(r => setTimeout(r, 250)); } return false; })();
                    o.adminKept = window.isDbAdmin() && window.userAuth.uid === adminUid;
                    o.labelRestored = btn.textContent.trim() === labelBefore && !btn.disabled;
                    const one = (window.data.personel || []).find(p => p.uid);
                    o.loginUidMatches = one ? (await verify(APP, AUTH, one.authEmail, window.StaffProvisioning.staffPassword(one.code))) === one.uid : false;
                    // ikinci çalıştırma: açılacak kimse yok, onay bile sorulmaz
                    const c0 = confirms.length;
                    await window.vipMigrateStaffAuth(btn);
                    o.secondRun = { noConfirm: confirms.length === c0, msg: alerts.at(-1) && alerts.at(-1).m };
                    o.noCodeInAlerts = !alerts.some(a => codes.some(c => a.m.includes(c)));
                } finally { window.showAppAlert = real.alert; window.showCustomConfirm = real.confirm; }
                return o;
            }, APP, AUTH);
        } finally {
            out.adminPageErrors = errs;
            await ctx.close();
        }

        const A = out.add, V = out.vip || {};
        out.ok = A.alerted && /Giriş hesabı açıldı/.test(A.alert && A.alert.m) && A.alert.t === 'success' && A.linked && A.adminKept && A.loginUidMatches && A.codeNotInAlert
            && out.adminReady && V.button && V.planned > 0 && V.preview && V.preview.counts && V.preview.noCode && V.preview.adminNote
            && /Auth göçü: açılan \d+ · yeniden bağlanan \d+/.test(V.result && V.result.m) && V.result.t === 'success'
            && V.allLinked && V.adminKept && V.labelRestored && V.loginUidMatches
            && V.secondRun.noConfirm && /giriş hesabı var/.test(V.secondRun.msg || '') && V.noCodeInAlerts
            && out.adminPageErrors.length === 0;
        if (!out.ok) throw new Error('j7StaffProvisioning beklenen sözleşmede değil: ' + JSON.stringify(out));
        return out;
    },

    // Faz 4B · J7.5 — kod benzersizliği: katı kural (ekleme/düzenleme/hızlı ekleme) + VIP Kod Benzersizleştirme sihirbazı.
    //   A · index (yazmalar taklit, Firestore'a gitmez): ortak kodlu kişi düzenlenemez; yeni kişi var olan kodla eklenemez.
    //   B · admin.html, gerçek admin (yalnız --emu): aynı kodlu iki test personeli (biri hesaplı) → sihirbaz grubu bulur;
    //       satır içi denetim (var olan kod ✗, iki kişi kodu korursa ✗, Uygula kapalı); hesaplı kişinin kodu değişir →
    //       Firestore'da yeni kod, eski parola geçersiz, yeni parola aynı uid; ortak kodla hızlı ekleme engellenir.
    async j75CodeWizard(page, browser) {
        const out = {};
        out.index = await page.evaluate(async () => {
            const o = {}, ops = [], alerts = [];
            const orig = { p: window.data.personel, alert: window.showAppAlert, adm: window.isDbAdmin, val: window.validateAdminAction,
                api: ['appendItem', 'updateItem', 'removeItem', 'provisionStaffAccount'].map(k => [k, window[k]]) };
            ['appendItem', 'updateItem', 'removeItem', 'provisionStaffAccount'].forEach(k => { window[k] = async (...a) => { ops.push(k); return { written: 1, status: 'created' }; }; });
            window.isDbAdmin = () => true; window.validateAdminAction = () => true;
            window.showAppAlert = (m, t) => alerts.push({ m: String(m), t });
            try {
                window.data.personel = [{ id: 'j75a', name: 'Ortak A', code: 'ortak5' }, { id: 'j75b', name: 'Ortak B', code: ' ortak5 ' }, { id: 'j75c', name: 'Tekil', code: 'tekil5' }];
                // düzenleme: ortak kodlu kişi → durur
                window.openPersonelModal('edit', 'j75a');
                document.getElementById('personelName').value = 'Ortak A (yeni ad)';
                document.getElementById('personelForm').requestSubmit();
                await new Promise(r => setTimeout(r, 80));
                o.editBlocked = ops.length === 0 && /Kod Benzersizleştirme/.test(alerts.at(-1) && alerts.at(-1).m);
                // tekil kişinin düzenlemesi serbest
                window.openPersonelModal('edit', 'j75c');
                document.getElementById('personelName').value = 'Tekil (yeni ad)';
                document.getElementById('personelForm').requestSubmit();
                await new Promise(r => setTimeout(r, 80));
                o.editUniqueAllowed = ops.includes('updateItem');
                // ekleme: var olan kod (kırpılmış hâliyle de) → durur; kısa kod → durur
                ops.length = 0;
                for (const code of ['tekil5', ' ortak5', 'ab1']) {
                    window.openPersonelModal('add');
                    document.getElementById('personelName').value = 'Yeni Kişi';
                    document.getElementById('personelCode').value = code;
                    document.getElementById('personelForm').requestSubmit();
                    await new Promise(r => setTimeout(r, 60));
                }
                o.addBlocked = ops.length === 0;
                o.addMessages = alerts.slice(-3).map(a => a.m);
                o.messagesHideCode = !alerts.some(a => /tekil5|ortak5/.test(a.m));
                // öneri: listede olmayan, 5 karakter
                const s = window.getRandomCode();
                o.suggestion = s.length === 5 && window.StaffCodeRegistry.validateCode(s, window.data.personel).ok;
            } finally {
                window.data.personel = orig.p;
                orig.api.forEach(([k, f]) => { window[k] = f; });
                Object.assign(window, { showAppAlert: orig.alert, isDbAdmin: orig.adm, validateAdminAction: orig.val });
                document.getElementById('personelModal').style.display = 'none';
            }
            return o;
        });

        if (EMU) {
            const ctx = await browser.createBrowserContext();
            const errs = [];
            const base = `http://127.0.0.1:${PORT}`;
            const waitFn = async (p, fn, ms = 25000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await p.evaluate(fn)) return true; } catch (e) { } await new Promise(r => setTimeout(r, 250)); } return false; };
            try {
                const a = await ctx.newPage();
                a.on('pageerror', e => errs.push(e.message)); a.on('dialog', d => d.dismiss());
                await a.goto(`${base}/index.html?emu=1`, { waitUntil: 'domcontentloaded' });
                await waitFn(a, () => window.isFirebaseLoaded === true && !!window.userAuth);
                const nav = a.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 });
                await a.evaluate(code => { window._dx._b['access-val-node'] = code; window.checkAdminAndGo(); }, EMU_ADMIN_CODE);
                await nav;
                out.adminReady = await waitFn(a, () => window.isDbAdmin && window.isDbAdmin() && window.isFirebaseLoaded === true && (window.data.personel || []).length > 0);
                out.wizard = await a.evaluate(async MARKER => {
                    const o = {}, R = window.StaffCodeRegistry, SP = window.StaffProvisioning;
                    const wait = async (fn, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await new Promise(r => setTimeout(r, 200)); } return false; };
                    const login = async (email, password) => {
                        const appMod = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
                        const authMod = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
                        const app = appMod.getApps().find(x => x.name === 'j75verify') || appMod.initializeApp(window.firebaseApp.options, 'j75verify');
                        if (!window.__j75auth) { window.__j75auth = authMod.initializeAuth(app, { persistence: authMod.inMemoryPersistence }); authMod.connectAuthEmulator(window.__j75auth, 'http://127.0.0.1:9099', { disableWarnings: true }); }
                        try { const c = await authMod.signInWithEmailAndPassword(window.__j75auth, email, password); const uid = c.user.uid; await authMod.signOut(window.__j75auth); return uid; } catch (e) { return null; }
                    };
                    const alerts = [], real = { alert: window.showAppAlert, confirm: window.showCustomConfirm };
                    window.showAppAlert = (m, t) => alerts.push({ m: String(m), t });
                    window.showCustomConfirm = async () => true;
                    const adminUid = window.userAuth.uid;
                    const shared = R.suggestCode(window.data.personel);
                    const A = { id: window.makeId(), name: `J75 Hesaplı ${MARKER}`, code: shared };
                    const B = { id: window.makeId(), name: `J75 Hesapsız ${MARKER}`, code: shared };
                    try {
                        // Kurulum: katı kuralı bilerek aşan eski veri taklidi — veri katmanına doğrudan yazılır
                        await window.appendItem('personel', A);
                        await window.appendItem('personel', B);
                        const prov = await window.provisionStaffAccount(A);
                        o.setup = prov.status === 'created';
                        const uidA = prov.uid;

                        // Ortak kodla hızlı ekleme engellenir (katı kural)
                        window.inventoryManagementModule.quickAddPersonnel();
                        document.getElementById('qpName').value = `J75 Hızlı ${MARKER}`;
                        document.getElementById('qpCode').value = shared;
                        const before = window.data.personel.length;
                        await window.inventoryManagementModule._saveQuickPersonnel();
                        o.quickAddBlocked = window.data.personel.length === before && /başka bir personelde/.test(alerts.at(-1) && alerts.at(-1).m);
                        window.inventoryManagementModule.closeQuickPersonnelModal();

                        // Sihirbaz
                        const btn = document.querySelector('button[onclick*="vipDedupeStaffCodes"]');
                        o.button = !!btn;
                        const ctl = window.vipDedupeStaffCodes(btn);
                        const ov = document.getElementById('staffCodeWizard');
                        const rowA = ov && ov.querySelector(`[data-id="${A.id}"]`), rowB = ov && ov.querySelector(`[data-id="${B.id}"]`);
                        const q = (row, role) => row.querySelector(`[data-role="${role}"]`);
                        const apply = document.getElementById('scwApply');
                        const fire = el => el.dispatchEvent(new Event(el.type === 'checkbox' ? 'change' : 'input'));
                        o.opened = !!(ctl && rowA && rowB);
                        o.defaults = { keepsAccountHolder: !q(rowA, 'change').checked, otherChanges: q(rowB, 'change').checked, suggested: R.validateCode(q(rowB, 'new-code').value, window.data.personel).ok, applyEnabled: !apply.disabled };

                        // Satır içi denetim: var olan bir kod → ✗, Uygula kapalı; mesajda kod yok
                        const existing = window.data.personel.find(p => p.code && String(p.id) !== String(A.id) && String(p.id) !== String(B.id)).code;
                        q(rowB, 'new-code').value = existing; fire(q(rowB, 'new-code'));
                        o.inlineDuplicate = { bad: rowB.dataset.valid === 'bad', applyDisabled: apply.disabled, msgHidesCode: !q(rowB, 'msg').textContent.includes(existing) };
                        // İki kişi de kodunu korursa grup ✗
                        q(rowB, 'change').checked = false; fire(q(rowB, 'change'));
                        const grp = rowA.closest('fieldset').querySelector('[data-role="group-status"]');
                        o.groupRule = { groupBad: grp.dataset.ok === '0', applyDisabled: apply.disabled };
                        // Karar: hesaplı A'nın kodu değişsin, B korusun
                        q(rowA, 'change').checked = true; fire(q(rowA, 'change'));
                        const newCode = R.suggestCode(window.data.personel, { reserved: [shared] });
                        q(rowA, 'new-code').value = newCode; fire(q(rowA, 'new-code'));
                        o.ready = { aValid: rowA.dataset.valid === 'ok', groupOk: grp.dataset.ok === '1', applyEnabled: !apply.disabled };

                        apply.click();
                        o.done = await wait(async () => ov.dataset.state === 'done', 20000);
                        o.rowResult = rowA.dataset.result;
                        const fsm = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');   // admin.html'de __ft yok: sunucudan doğrudan oku
                        const snap = await fsm.getDoc(fsm.doc(window.fireDb, window.COLLECTION_ROOT, 'personel', 'items', String(A.id))); const fresh = snap.exists() ? snap.data() : null;
                        o.firestoreCode = !!fresh && fresh.code === newCode && fresh.uid === uidA;
                        o.oldPasswordDead = (await login(SP.staffEmail(A.id), SP.staffPassword(shared))) === null;
                        o.newPasswordSameUid = (await login(SP.staffEmail(A.id), SP.staffPassword(newCode))) === uidA;
                        o.resolved = R.resolveLoginCode(window.data.personel, shared).status === 'unique' && R.resolveLoginCode(window.data.personel, newCode).status === 'unique';
                        o.adminKept = window.isDbAdmin() && window.userAuth.uid === adminUid;
                        o.alertHidesCodes = !alerts.some(x => x.m.includes(shared) || x.m.includes(newCode));
                        document.getElementById('scwCancel').click();
                        o.closed = !document.getElementById('staffCodeWizard') && !btn.disabled;
                    } finally {
                        window.showAppAlert = real.alert; window.showCustomConfirm = real.confirm;
                        for (const p of [A, B]) { try { await window.removeItem('personel', p.id); } catch (e) { } }
                    }
                    return o;
                }, '__flowtest__');
            } finally {
                out.adminPageErrors = errs;
                await ctx.close();
            }
        } else {
            out.emulator = 'skipped B (gerçek admin + Auth emülatörü yalnız --emu)';
        }

        const I = out.index, W = out.wizard;
        out.ok = I.editBlocked && I.editUniqueAllowed && I.addBlocked && I.messagesHideCode && I.suggestion
            && (!EMU || (out.adminReady && W.setup && W.quickAddBlocked && W.button && W.opened
                && W.defaults.keepsAccountHolder && W.defaults.otherChanges && W.defaults.suggested && W.defaults.applyEnabled
                && W.inlineDuplicate.bad && W.inlineDuplicate.applyDisabled && W.inlineDuplicate.msgHidesCode
                && W.groupRule.groupBad && W.groupRule.applyDisabled
                && W.ready.aValid && W.ready.groupOk && W.ready.applyEnabled
                && W.done && W.rowResult === 'changed' && W.firestoreCode && W.oldPasswordDead && W.newPasswordSameUid
                && W.resolved && W.adminKept && W.alertHidesCodes && W.closed && out.adminPageErrors.length === 0));
        if (!out.ok) throw new Error('j75CodeWizard beklenen sözleşmede değil: ' + JSON.stringify(out));
        return out;
    },

    // Faz 4B · J8 (4.6 / K4) — hibrit personel girişi, gerçek giriş ekranıyla (handleLogin):
    //   A · ana sayfa, Firestore'a yazmadan (iki modda): ortak kod → red + 'blocked' denetim kaydı (ilk eşleşmeye düşmez);
    //       hesapsız personel hibritte eski yoldan (anonim oturum) girer; yalnız-hesap modunda reddedilir; oturum nesnesinde ve
    //       localStorage'da giriş kodu yok; personel tablosunda kod admin dışında maskeli.
    //   B · --emu: hesaplı personel e-posta/parola ile girer (uid = personel.uid, anonim değil), kurallar altında yazar,
    //       F5'te oturum Firebase kalıcılığıyla geri gelir (K5), çıkışta anonime döner; 'anonymous' modunda hesap kullanılmaz.
    async j8HybridLogin(page, browser) {
        const out = {};
        out.a = await page.evaluate(async () => {
            const o = {}, ft = window.__ft;
            const statusText = () => (document.getElementById('loginStatus') || {}).textContent || '';
            const login = async code => { window._dx._b['access-val-node'] = code; await window.handleLogin(); };
            const orig = { p: window.data.personel, cfg: window.data.config, alert: window.showAppAlert };
            o.readyAtStart = { auth: !!window.userAuth, anon: !!window.userAuth?.isAnonymous, loaded: window.isFirebaseLoaded === true, personel: Array.isArray(window.data.personel) ? window.data.personel.length : null, activeUser: !!window.getActiveUser(), loggedIn: document.body.classList.contains('logged-in') };
            const auditBefore = (window.__auditStub || []).length;
            window.showAppAlert = () => {};
            // Önceki senaryoların bıraktığı yerel oturum (setActiveUser fikstürleri) temizlenir; Firebase oturumu anonim kalır
            if (window.getActiveUser()) window.clearSession();
            document.body.classList.remove('logged-in');
            try {
                const base = (window.data.personel || []).filter(p => !String(p.id).startsWith('j8_'));
                const uniq = () => window.StaffCodeRegistry.suggestCode(window.data.personel);
                const shared = uniq();
                window.data.personel = [...base, { id: 'j8_dupA', name: 'J8 Ortak A', code: shared }, { id: 'j8_dupB', name: 'J8 Ortak B', code: shared }];
                // 1) ortak kod → red
                await login(shared);
                o.ambiguous = { rejected: !window.getActiveUser(), message: /yöneticiye başvurun/.test(statusText()), anon: !!window.userAuth?.isAnonymous };
                if (!ft.emulator) o.ambiguous.audit = (window.__auditStub || []).slice(auditBefore).some(a => a.type === 'login-ambiguous' && a.result === 'blocked' && !JSON.stringify(a).includes(shared));
                // 2) hesapsız personel, hibrit → eski yol (anonim oturum)
                const legacyCode = uniq();
                window.data.personel = [...base, { id: 'j8_legacy', name: 'J8 Hesapsız', code: legacyCode }];
                window.data.config = { ...(orig.cfg || {}), staffAuthMode: 'hybrid' };
                await login(legacyCode);
                const u = window.getActiveUser();
                o.legacy = { loggedIn: !!u && u.id === 'j8_legacy' && document.body.classList.contains('logged-in'), anon: !!window.userAuth?.isAnonymous,
                             noCodeInSession: !!u && !('code' in u) && !('code' in (window.currentUser || {})),
                             noCodeInStorage: !(localStorage.getItem('activeUser') || '').includes(legacyCode) && !JSON.stringify(window.AppModules.Session.unmaskUserData(localStorage.getItem('activeUser'))).includes(legacyCode) };
                // personel tablosu: admin olmayan oturumda kod maskeli
                window.renderPersonelTable();
                const cells = [...document.querySelectorAll('#tablePersonel tbody tr td:nth-child(3)')].map(td => td.textContent.trim());
                o.tableMasked = cells.length > 0 && cells.every(c => c === '•••••');
                await window.handleLogout('manual');
                await ft.waitFor(async () => !!window.userAuth?.isAnonymous && !window.getActiveUser() && window.isFirebaseLoaded === true, 15000);
                await ft.sleep(1500);   // çıkışla yeniden başlayan senkron bellekteki personel/ayar kopyasını ezer — oturduktan sonra kur
                // 3) yalnız-hesap modu: hesapsız personel reddedilir
                window.data.personel = [...base, { id: 'j8_legacy', name: 'J8 Hesapsız', code: legacyCode }];
                window.data.config = { ...(orig.cfg || {}), staffAuthMode: 'accounts' };
                await login(legacyCode);
                o.accountsModeRejectsLegacy = !window.getActiveUser() && /hesabınız henüz tanımlı değil/.test(statusText());
                // 4) yanlış kod
                await login(uniq());
                o.invalidCode = !window.getActiveUser() && /Hatalı Giriş Kodu/.test(statusText());
            } finally {
                window.data.personel = orig.p; window.data.config = orig.cfg; window.showAppAlert = orig.alert;
                if (window.getActiveUser()) { await window.handleLogout('manual'); }
                await ft.waitFor(async () => !!window.userAuth?.isAnonymous, 8000);
            }
            return o;
        });

        if (EMU) {
            // Kurulum (ana sayfa, gerçek admin): hesaplı test personeli
            const setup = await page.evaluate(async () => {
                const ft = window.__ft;
                let person = null;
                await ft.asAdmin(async () => {
                    const code = window.StaffCodeRegistry.suggestCode(window.data.personel);
                    person = { id: window.makeId(), name: `J8 Hesaplı ${ft.MARKER}`, code };
                    await window.appendItem('personel', person);
                    const r = await window.provisionStaffAccount(person);
                    person.uid = r.uid; person.authEmail = r.email; person.status = r.status;
                });
                return person;
            });
            out.setup = { status: setup && setup.status };
            const ctx = await browser.createBrowserContext();
            const errs = [];
            const base = `http://127.0.0.1:${PORT}`;
            const waitFn = async (p, fn, ms = 25000, arg) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await p.evaluate(fn, arg)) return true; } catch (e) { } await new Promise(r => setTimeout(r, 250)); } return false; };
            const ready = p => waitFn(p, () => window.isFirebaseLoaded === true && !!window.userAuth && (window.data.personel || []).length > 0);
            const state = p => p.evaluate(() => {
                const u = window.getActiveUser();
                return { uid: window.userAuth && window.userAuth.uid, anon: !!(window.userAuth && window.userAuth.isAnonymous), email: window.userAuth && window.userAuth.email,
                         userId: u && String(u.id), loggedIn: document.body.classList.contains('logged-in'),
                         loginModal: getComputedStyle(document.getElementById('loginModal')).display !== 'none',
                         codeInSession: !!u && 'code' in u, staffSession: window.AppModules.Session.isStaffAccountSession(), isDbAdmin: window.isDbAdmin() };
            });
            try {
                const s = await ctx.newPage();
                s.on('pageerror', e => errs.push(e.message)); s.on('dialog', d => d.dismiss());
                await s.goto(`${base}/index.html?emu=1`, { waitUntil: 'domcontentloaded' });
                await ready(s);
                await waitFn(s, id => (window.data.personel || []).some(p => String(p.id) === id && p.uid), 15000, String(setup.id));
                // 1) hesapla giriş
                await s.evaluate(async code => { window._dx._b['access-val-node'] = code; await window.handleLogin(); }, setup.code);
                await waitFn(s, () => document.body.classList.contains('logged-in'), 15000);
                out.accountLogin = await state(s);
                // 2) kurallar altında personel yazması (Aşama A: oturumlu personel talep açabilir)
                out.staffWrite = await s.evaluate(async MARKER => {
                    const r = await window.appendItem('requests', { personel: 'J8 ' + MARKER, ürün: 'J8 test ' + MARKER, adet: 1, durum: 'Beklemede', not: MARKER }).then(() => 'ok', e => e.code);
                    return r;
                }, '__flowtest__');
                // 3) F5 → oturum Firebase kalıcılığıyla geri gelir (K5)
                await s.reload({ waitUntil: 'domcontentloaded' });
                await ready(s);
                await waitFn(s, () => document.body.classList.contains('logged-in') && !!window.getActiveUser() && getComputedStyle(document.getElementById('loginModal')).display === 'none', 20000);
                await new Promise(r => setTimeout(r, 1500));   // modal sonradan yeniden açılmıyor mu?
                out.afterReload = await state(s);
                // 4) çıkış → anonim
                await s.evaluate(() => window.handleLogout('manual'));
                await waitFn(s, () => !!window.userAuth && window.userAuth.isAnonymous && !window.getActiveUser(), 15000);
                out.afterLogout = await state(s);
                // 5) 'anonymous' modu: hesap kullanılmaz (bellek içi mod; sunucu ayarına dokunulmaz)
                await s.evaluate(async code => { window.data.config = { ...(window.data.config || {}), staffAuthMode: 'anonymous' }; window._dx._b['access-val-node'] = code; await window.handleLogin(); }, setup.code);
                await waitFn(s, () => document.body.classList.contains('logged-in'), 15000);
                out.anonymousMode = await state(s);
                await s.evaluate(() => window.handleLogout('manual'));
                await waitFn(s, () => !!window.userAuth && window.userAuth.isAnonymous, 15000);
            } finally {
                out.staffPageErrors = errs;
                await ctx.close();
                await page.evaluate(async id => { await window.__ft.asAdmin(async () => { try { await window.removeItem('personel', id); } catch (e) { } }); }, setup.id);
            }
            const A = out.accountLogin, R = out.afterReload;
            out.b = A && R && setup
                && setup.status === 'created'
                && A.loggedIn && !A.anon && A.staffSession && A.uid === setup.uid && A.email === setup.authEmail && A.userId === String(setup.id) && !A.codeInSession && !A.isDbAdmin && !A.loginModal
                && out.staffWrite === 'ok'
                && R.loggedIn && R.uid === setup.uid && R.userId === String(setup.id) && !R.loginModal && !R.codeInSession
                && out.afterLogout.anon && !out.afterLogout.userId
                && out.anonymousMode.loggedIn && out.anonymousMode.anon && out.anonymousMode.userId === String(setup.id)
                && out.staffPageErrors.length === 0;
        }

        const a = out.a;
        out.ok = a.ambiguous.rejected && a.ambiguous.message && a.ambiguous.anon && (a.ambiguous.audit !== false)
            && a.legacy.loggedIn && a.legacy.anon && a.legacy.noCodeInSession && a.legacy.noCodeInStorage && a.tableMasked
            && a.accountsModeRejectsLegacy && a.invalidCode
            && (!EMU || out.b === true);
        if (!out.ok) throw new Error('j8HybridLogin beklenen sözleşmede değil: ' + JSON.stringify(out));
        return out;
    },

    // Faz 4B · J9 (GPT-6 kural 1–2) — sahiplik uid'leri gerçek UI fonksiyonlarıyla:
    //   A · iki modda, ağa gitmeden: veri katmanı muhafızı (dolu uid değişmez, personel ilk yazımı yapamaz, başkası adına kayıt
    //       açılamaz); anonim oturumda selfUid null; önizleme (Sahiplik Göç Aracı) hiçbir şey yazmaz.
    //   B · --emu: hesaplı personel gerçek formlardan talep / satın alma / görev açar → uid'ler oturumun Auth uid'si; tam yazma
    //       sahipliği silmez; kuralları atlayan doğrudan yazma reddedilir. Yönetici VIP aracında eski kayda uid ekler; tekrar 0.
    async j9Ownership(page, browser) {
        const out = {};
        out.a = await page.evaluate(async () => {
            const o = {}, code = p => p.then(() => 'ok', e => e.code);
            o.loaded = !!window.Ownership && typeof window.planOwnershipMigration === 'function' && typeof window.applyOwnershipMigration === 'function';
            o.anonSelfUid = window.userAuth && window.userAuth.isAnonymous ? window.Ownership.selfUid() === null : 'not-anon';
            const realAlert = window.showAppAlert; window.showAppAlert = () => {};
            const stamp = 'j9_' + Date.now();
            const owned = { id: stamp + '_a', personelUid: 'u-owner', ürün: 'J9 muhafız __flowtest__' };
            const bare = { id: stamp + '_b', ürün: 'J9 muhafız __flowtest__' };
            const keep = { m: window._dbMirror.requests, d: window.data.requests };
            window._dbMirror.requests = [...(keep.m || []), JSON.parse(JSON.stringify(owned)), JSON.parse(JSON.stringify(bare))];
            window.data.requests = [...(keep.d || []), { ...owned }, { ...bare }];
            try {
                o.changeOwner = await code(window.updateItem('requests', owned.id, { personelUid: 'u-baska' }));
                o.staffFirstWrite = await code(window.updateItem('requests', bare.id, { personelUid: window.userAuth.uid }));
                o.createForOther = await code(window.appendItem('requests', { id: stamp + '_c', ürün: 'J9 __flowtest__', personelUid: 'baskasi' }));
                o.saveDataChange = await code(window.saveData('requests', window.data.requests.map(r => r.id === owned.id ? { ...r, personelUid: 'u-baska' } : r)));
            } finally {
                window._dbMirror.requests = keep.m; window.data.requests = keep.d; window.showAppAlert = realAlert;
            }
            return o;
        });

        const ctx = await browser.createBrowserContext();
        const errs = [];
        const base = `http://127.0.0.1:${PORT}`;
        const waitFn = async (p, fn, ms = 25000, arg) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await p.evaluate(fn, arg)) return true; } catch (e) { } await new Promise(r => setTimeout(r, 250)); } return false; };
        const adminPage = async () => {
            const a = await ctx.newPage();
            a.on('pageerror', e => errs.push(e.message)); a.on('dialog', d => d.dismiss());
            if (EMU) {
                await a.goto(`${base}/index.html?emu=1`, { waitUntil: 'domcontentloaded' });
                await waitFn(a, () => window.isFirebaseLoaded === true && !!window.userAuth);
                const nav = a.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 });
                await a.evaluate(c => { window._dx._b['access-val-node'] = c; window.checkAdminAndGo(); }, EMU_ADMIN_CODE);
                await nav;
            } else {
                await a.evaluateOnNewDocument(() => localStorage.setItem('admin_auth', JSON.stringify({ expiry: Date.now() + 600000 })));
                await a.goto(`${base}/admin.html`, { waitUntil: 'domcontentloaded' });
            }
            await waitFn(a, () => window.isFirebaseLoaded === true && (window.data.personel || []).length > 0);
            return a;
        };
        try {
            // ── Önizleme yazmaz (iki modda; gerçek demoda yönetici yalnız istemcide taklit — UYGULA YOK) ──
            const a = await adminPage();
            out.preview = await a.evaluate(async (EMU) => {
                const o = {}, real = window.isDbAdmin;
                if (!EMU) window.isDbAdmin = () => true;
                let writes = 0;
                const wrap = ['applyItemOps', 'saveData', 'runStockOps', 'applyOwnershipMigration'].map(k => [k, window[k]]);
                wrap.forEach(([k, f]) => { window[k] = async (...x) => { writes++; return f(...x); }; });
                try {
                    const ctl = window.vipOwnershipMigration(document.querySelector('button[onclick*="vipOwnershipMigration"]'));
                    const ov = document.getElementById('ownershipWizard');
                    o.opened = !!ctl && !!ov && ov.dataset.state === 'preview';
                    o.summaryRows = ov ? ov.querySelectorAll('[data-role="summary"] tr[data-col]').length : 0;
                    o.items = ctl ? ctl.plan.items.length : null;
                    o.noWrites = writes === 0;
                    // Her öğenin KENDİ metni, tam sözcük olarak (birleşik metinde ör. beş "0" hücresi "00000" koduna benzer)
                    const leaves = ov ? [...ov.querySelectorAll('*')].filter(e => !e.children.length).map(e => e.textContent) : [];
                    const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    o.noCodesShown = !(window.data.personel || []).some(p => p.code && String(p.code).length >= 4
                        && leaves.some(t => new RegExp(`(^|[^0-9A-Za-z])${esc(String(p.code))}([^0-9A-Za-z]|$)`).test(t)));
                    document.getElementById('owwClose').click();
                    o.closed = !document.getElementById('ownershipWizard');
                } finally {
                    wrap.forEach(([k, f]) => { window[k] = f; });
                    window.isDbAdmin = real;
                }
                return o;
            }, EMU);

            if (EMU) {
                // ── Kurulum (yönetici): hesaplı test personeli + J9 öncesi biçimde eski talep ──
                out.setup = await a.evaluate(async MARKER => {
                    const code = window.StaffCodeRegistry.suggestCode(window.data.personel);
                    const person = { id: window.makeId(), name: `J9 Sahip ${MARKER}`, code };
                    await window.appendItem('personel', person);
                    const r = await window.provisionStaffAccount(person);
                    const legacy = { id: 'j9_legacy_' + Date.now(), personel: person.name, personelId: person.id, ürün: `J9 eski talep ${MARKER}`, adet: 1, durum: 'Beklemede' };
                    await window.applyItemOps([{ op: 'set', col: 'requests', item: legacy }]);
                    return { ...person, uid: r.uid, status: r.status, legacyId: legacy.id };
                }, '__flowtest__');

                // ── Personel: gerçek formlarla kayıt aç ──
                const s = await ctx.newPage();
                s.on('pageerror', e => errs.push(e.message)); s.on('dialog', d => d.dismiss());
                await s.goto(`${base}/index.html?emu=1`, { waitUntil: 'domcontentloaded' });
                await waitFn(s, () => window.isFirebaseLoaded === true && !!window.userAuth && (window.data.personel || []).length > 0);
                await waitFn(s, id => (window.data.personel || []).some(p => String(p.id) === id && p.uid), 15000, String(out.setup.id));
                await s.evaluate(async c => { window._dx._b['access-val-node'] = c; await window.handleLogin(); }, out.setup.code);
                await waitFn(s, () => document.body.classList.contains('logged-in') && !window.userAuth.isAnonymous, 15000);
                out.staff = await s.evaluate(async MARKER => {
                    const o = { uid: window.userAuth.uid, selfUid: window.Ownership.selfUid() };
                    window.showAppAlert = () => {}; window.alert = () => {};
                    const fsm = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
                    const read = async (col, id) => { const sn = await fsm.getDoc(fsm.doc(window.fireDb, window.COLLECTION_ROOT, col, 'items', String(id))); return sn.exists() ? sn.data() : null; };
                    const newest = (col, pred) => (window.data[col] || []).filter(pred).sort((x, y) => String(y.id).localeCompare(String(x.id)))[0];
                    // talep formu
                    window.editingReqId = null;
                    document.getElementById('reqProdName').value = `J9 talep ${MARKER}`;
                    document.getElementById('reqQty').value = '1';
                    await window.saveRequest(new Event('submit'));
                    const req = newest('requests', r => r.ürün === `J9 talep ${MARKER}`);
                    o.request = req ? (await read('requests', req.id)).personelUid : null;
                    // satın alma formu
                    document.getElementById('purName').value = `J9 satın alma ${MARKER}`;
                    document.getElementById('purQty').value = '1';
                    await window.savePurchaseRequest(new Event('submit'));
                    const po = newest('purchaseOrders', p => p.urun === `J9 satın alma ${MARKER}`);
                    o.purchase = po ? (await read('purchaseOrders', po.id)).createdByUid : null;
                    // görev (kişisel hatırlatıcı): oluşturan + atanan = kendisi
                    window.todoModule.openNewTaskModal('personel-reminder');
                    await new Promise(r => setTimeout(r, 150));
                    document.getElementById('todoTaskTitle').value = `J9 görev ${MARKER}`;
                    await window.todoModule.saveNewTask();
                    const task = newest('tasks', t => t.title === `J9 görev ${MARKER}`);
                    const tdoc = task ? await read('tasks', task.id) : {};
                    o.task = { creatorUid: tdoc.creatorUid, assigneeUid: tdoc.assigneeUid };
                    // tam yazma (upsertItem) sahipliği silmez; değiştirme istemcide reddedilir; kuralları atlayan doğrudan yazma reddedilir
                    if (req) {
                        const local = { ...window.data.requests.find(r => r.id === req.id) };
                        delete local.personelUid;
                        await window.upsertItem('requests', { ...local, not: 'tam yazma' });
                        o.afterUpsert = (await read('requests', req.id)).personelUid;
                        o.clientChange = await window.updateItem('requests', req.id, { personelUid: 'u-baska' }).then(() => 'ok', e => e.code);
                        o.rulesChange = await fsm.updateDoc(fsm.doc(window.fireDb, window.COLLECTION_ROOT, 'requests', 'items', String(req.id)), { personelUid: 'u-baska' }).then(() => 'ok', e => e.code);
                    }
                    return o;
                }, '__flowtest__');
                await s.close();

                // ── Yönetici: VIP aracıyla eski talebe uid ekle; tekrar açınca bu kayıt listede yok ──
                out.migrate = await a.evaluate(async (legacyId) => {
                    const o = {};
                    const wait = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await new Promise(r => setTimeout(r, 200)); } return false; };
                    await wait(async () => (window.data.requests || []).some(r => r.id === legacyId));
                    const realConfirm = window.showCustomConfirm; window.showCustomConfirm = async () => true;
                    const realAlert = window.showAppAlert; window.showAppAlert = () => {};
                    try {
                        const btn = document.querySelector('button[onclick*="vipOwnershipMigration"]');
                        const ctl = window.vipOwnershipMigration(btn);
                        o.legacyPlanned = ctl.plan.items.some(i => i.col === 'requests' && i.id === legacyId);
                        const res = await ctl.run();
                        o.status = res && res.status;
                        o.legacyWritten = !!res && res.written.some(w => w.id === legacyId);
                        o.resultShown = document.querySelector('#ownershipWizard [data-role="result"]')?.dataset.status;
                        document.getElementById('owwClose').click();
                        const fsm = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
                        const sn = await fsm.getDoc(fsm.doc(window.fireDb, window.COLLECTION_ROOT, 'requests', 'items', legacyId));
                        o.legacyUid = sn.data().personelUid;
                        const again = window.vipOwnershipMigration(btn);
                        o.idempotent = !again.plan.items.some(i => i.id === legacyId);
                        again.close();
                    } finally {
                        window.showCustomConfirm = realConfirm; window.showAppAlert = realAlert;
                    }
                    return o;
                }, out.setup.legacyId);

                await a.evaluate(async id => { try { await window.removeItem('personel', id); } catch (e) { } }, String(out.setup.id));
            }
            await a.close();
        } finally {
            out.pageErrors = errs;
            await ctx.close();
        }

        const A = out.a, P = out.preview;
        out.ok = A.loaded && A.anonSelfUid === true && A.changeOwner === 'owner-immutable' && A.staffFirstWrite === 'owner-first-write'
            && A.createForOther === 'owner-uid-mismatch' && A.saveDataChange === 'owner-immutable'
            && P.opened && P.summaryRows === 4 && P.noWrites && P.noCodesShown && P.closed
            && (!EMU || (out.setup.status === 'created'
                && out.staff.selfUid === out.staff.uid && out.staff.request === out.staff.uid && out.staff.purchase === out.staff.uid
                && out.staff.task.creatorUid === out.staff.uid && out.staff.task.assigneeUid === out.staff.uid
                && out.staff.afterUpsert === out.staff.uid && out.staff.clientChange === 'owner-immutable' && out.staff.rulesChange === 'permission-denied'
                && out.migrate.legacyPlanned && out.migrate.status === 'done' && out.migrate.legacyWritten && out.migrate.resultShown === 'done'
                && out.migrate.legacyUid === out.setup.uid && out.migrate.idempotent))
            && out.pageErrors.length === 0;
        if (!out.ok) throw new Error('j9Ownership beklenen sözleşmede değil: ' + JSON.stringify(out));
        return out;
    },

    async j6EkASession(page, browser) {
        const sleep = ms => new Promise(r => setTimeout(r, ms));
        const TOKEN = 'J6-' + Date.now();
        const base = page.url().split('/index.html')[0], q = EMU ? '?emu=1' : '';
        // Gezinmeye dayanıklı bekleme (sayfa yeniden yüklenirken evaluate hata verebilir)
        const settle = async (p, fn, ms = 25000, arg) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await p.evaluate(fn, arg)) return true; } catch (e) { } await sleep(300); } return false; };
        const errs = [];
        const open = async (ctx, url) => { const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.dismiss()); await p.goto(url, { waitUntil: 'domcontentloaded' }); return p; };
        const ready = p => settle(p, () => window.isFirebaseLoaded === true && !!window.userAuth && (window.data.personel || []).length > 0);
        const staffLogin = (p, code) => p.evaluate(async code => {
            window._dx._b['access-val-node'] = code; await window.handleLogin();
            const inv = document.getElementById('inventory-screen');
            return { loggedIn: document.body.classList.contains('logged-in'), loginHidden: getComputedStyle(document.getElementById('loginModal')).display === 'none',
                unblurred: !inv.style.filter, user: (window.getActiveUser() || {}).name };
        }, code);
        const modalAndWrite = (p, MARKER) => p.evaluate(async MARKER => {
            window.openRequestModal(false);
            const modalOpens = getComputedStyle(document.getElementById('requestModal')).display !== 'none';
            window.closeRequestModal();
            const write = await window.appendItem('requests', { id: window.makeId(), ürün: 'J6 ' + MARKER, adet: 1, durum: 'Beklemede', personel: (window.getActiveUser() || {}).name }).then(() => 'ok', e => e.code || e.message);
            return { modalOpens, write };
        }, MARKER);
        const loginScreen = p => p.evaluate(() => ({ loginModal: getComputedStyle(document.getElementById('loginModal')).display !== 'none', activeUser: !!window.getActiveUser(), anon: !!(window.userAuth && window.userAuth.isAnonymous) }));

        const out = {};
        const sctx = await browser.createBrowserContext();
        let s = await open(sctx, `${base}/index.html${q}`);
        let staff = null;
        try {
            await ready(s);
            staff = await s.evaluate(() => { const p = (window.data.personel || []).find(x => x && x.code && x.name && !/Muhammed Cer|^Admin$/.test(x.name)); return p ? { code: String(p.code), id: p.id != null ? String(p.id) : null, name: p.name } : null; });
            if (!staff) return { skipped: 'personel kaydı yok' };
            out.staff = staff.name;

            // Ek A · Giriş/Oturum: giriş → modal + yazma → çıkış → tekrar giriş → modallar ve yazma
            out.login = await staffLogin(s, staff.code);
            out.afterLogin = await modalAndWrite(s, MARKER);
            await s.evaluate(() => window.handleLogout('manual'));
            out.logout = { reachedLogin: await settle(s, () => getComputedStyle(document.getElementById('loginModal')).display !== 'none' && window.isFirebaseLoaded === true), ...(await loginScreen(s)),
                syncRunning: await s.evaluate(() => window.getSyncHealth().running) };
            out.relogin = await staffLogin(s, staff.code);
            out.afterRelogin = await modalAndWrite(s, MARKER);

            // 3 dk zaman aşımı (süre kısaltılır) → giriş ekranı → tekrar giriş → modallar
            await s.evaluate(() => { window.__j6Cfg = { ...window.SessionConfig }; window.SessionConfig.WAREHOUSE_TIME = 2500; window.SessionConfig.WARNING_BEFORE = 1000; window.startSessionTimer(); });
            await sleep(4500);
            out.timeout = await loginScreen(s);
            await s.evaluate(() => Object.assign(window.SessionConfig, window.__j6Cfg));
            out.timeoutRelogin = { ...(await staffLogin(s, staff.code)), ...(await modalAndWrite(s, MARKER)) };

            // Mobil (≤768 px) otomatik kart görünümü
            await s.setViewport({ width: 390, height: 844 });
            await sleep(800);
            out.mobileCards = await s.evaluate(() => { if (typeof window.switchTab === 'function') window.switchTab('b1'); return { active: !!(window._cardViewActive && window._cardViewActive.b1), visible: getComputedStyle(document.getElementById('cardViewB1')).display !== 'none' }; });
            await s.setViewport({ width: 1440, height: 900 });

            if (!EMU) { out.emulator = 'skipped (VIP komutları ve bakım modu yalnız --emu · kural 7)'; return out; }

            // ── Yalnız emülatör: admin (ayrı bağlam, gerçek giriş yolu) ──
            const actx = await browser.createBrowserContext();
            try {
                const a = await open(actx, `${base}/index.html?emu=1`);
                await ready(a);
                const nav = a.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 });
                await a.evaluate(code => { window._dx._b['access-val-node'] = code; window.checkAdminAndGo(); }, EMU_ADMIN_CODE);
                await nav;
                await settle(a, () => window.isDbAdmin && window.isDbAdmin() && window.isFirebaseLoaded === true && typeof window.vipToggleKillSwitch === 'function');
                const target = { id: staff.id || staff.code, name: staff.name, demo: false };

                // Yönetici mesajı hedefe bir kez düşer (yeniden yüklemede tekrar gösterilmez)
                await a.evaluate((target, TOKEN) => { _currentTargetUser = target; document.getElementById('uapSystemMessage').value = 'J6 mesaj ' + TOKEN; return window.vipSendSystemMessage(); }, target, TOKEN);
                out.messageShown = await settle(s, t => document.body.innerText.includes(t), 10000, TOKEN);
                await s.reload({ waitUntil: 'domcontentloaded' });
                await ready(s); await sleep(4000);
                out.messageNotRepeatedAfterReload = !(await s.evaluate(t => document.body.innerText.includes(t), TOKEN));

                // Force logout: hedef bir kez çıkar, tekrar girebilir (yeniden atılmaz)
                await staffLogin(s, staff.code);
                await a.evaluate(target => { _currentTargetUser = target; return window.vipForceLogout(); }, target);
                out.forceLogout = { kicked: await settle(s, () => getComputedStyle(document.getElementById('loginModal')).display !== 'none' && !window.getActiveUser(), 10000) };
                // çıkış dinleyicileri yeniden başlatır; personel listesi gelene kadar giriş 'Veriler henüz hazır değil' der (bilinen davranış)
                out.forceLogout.dataReadyAgain = await ready(s);
                out.forceLogout.relogin = await staffLogin(s, staff.code);
                await sleep(4000);
                out.forceLogout.stillLoggedInAfter4s = await s.evaluate(() => !!window.getActiveUser() && document.body.classList.contains('logged-in'));
                out.forceLogout.adminSelfTargetRefused = await a.evaluate(async () => { const me = window.getActiveUser(); _currentTargetUser = { id: me.code || me.name, name: me.name, demo: false }; const alerts = []; const real = window.showAppAlert; window.showAppAlert = (m) => alerts.push(m); await window.vipForceLogout(); window.showAppAlert = real; return { refused: alerts.some(m => /Kendi oturumunuzu/.test(m)), stillAdmin: window.isDbAdmin() }; });

                // Bakım modu: personel bakım ekranına alınır, admin alınmaz; bakım ekranından admin girişi
                await a.evaluate(() => { window.showCustomConfirm = async () => true; window.alert = () => { }; return window.vipToggleKillSwitch(); });
                out.maintenance = {
                    staffLocked: await settle(s, () => !!document.getElementById('maintenanceOverlay'), 20000),
                    adminNotLocked: await a.evaluate(() => !document.getElementById('maintenanceOverlay') && window.isDbAdmin() && localStorage.getItem('system_maintenance_mode') !== 'true'),
                };
                await s.evaluate(code => { document.getElementById('maintenanceForm').style.display = 'block'; document.getElementById('maintenanceCode').value = code; window.adminBypassMaintenance(); }, EMU_ADMIN_CODE).catch(() => { });
                out.maintenance.bypassToAdmin = await settle(s, () => location.pathname.endsWith('admin.html') && window.isDbAdmin && window.isDbAdmin() && !document.getElementById('maintenanceOverlay'), 25000);
            } finally {
                // bakım modunu her koşulda kapat (emülatör) ve ana test sayfasının yeniden yüklenmesini bekle
                try {
                    const a2 = (await actx.pages()).find(p => p.url().includes('admin.html'));
                    if (a2) await a2.evaluate(async () => {
                        const fsm = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
                        await fsm.setDoc(window.systemConfigRef('admin_settings'), { maintenance: false }, { merge: true });
                    });
                } catch (e) { out.maintenanceResetError = e.message; }
                await actx.close();
            }
            // Bakım kapanınca personel ekranı normale döner (yeni oturum, bayrak yok)
            const p2 = await open(sctx, `${base}/index.html?emu=1`);
            await ready(p2); await sleep(1500);
            out.maintenance = out.maintenance || {};
            out.maintenance.normalAfterOff = await p2.evaluate(() => !document.getElementById('maintenanceOverlay') && localStorage.getItem('system_maintenance_mode') !== 'true');
            // Ana test sayfası bakımda iki kez yeniden yüklendi → yardımcıları yeniden kur
            out.mainPageRecovered = await settle(page, () => !document.getElementById('maintenanceOverlay') && window.isFirebaseLoaded === true && !!window.userAuth, 30000);
            await installHelpers(page);
        } finally {
            await sctx.close();
            out.pageErrors = errs;
        }
        return out;
    },
};

(async () => {
    const names = process.argv.slice(2).filter(a => !a.startsWith('--'));
    const wanted = names.length ? names : Object.keys(SCENARIOS);
    if (EMU) await fetch('http://127.0.0.1:8080/').catch(() => { throw new Error('Emülatör çalışmıyor: önce npm run emu'); });
    const server = await startServer();
    const browser = await puppeteer.launch({ headless: !HEADED, defaultViewport: HEADED ? null : undefined, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
    const startedAt = Date.now();
    const clock = () => new Date().toLocaleTimeString('tr-TR');
    const elapsed = () => { const t = Math.round((Date.now() - startedAt) / 1000); return `${Math.floor(t / 60)}dk ${t % 60}sn`; };
    console.log(`▶ ${wanted.length} senaryo · ${EMU ? 'emülatör' : 'gerçek demo'}${HEADED ? ' · görünür Chrome' : ''} · başlangıç ${clock()}`);
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    page.on('dialog', d => d.dismiss());
    let failed = false;
    try {
        await page.goto(`http://127.0.0.1:${PORT}/index.html${EMU ? '?emu=1' : ''}`, { waitUntil: 'domcontentloaded' });
        await new Promise(r => setTimeout(r, 7000));
        await installHelpers(page);
        const pre = await page.evaluate(() => window.__ft.cleanup(['requests', 'tasks', 'purchaseOrders', 'assignments', 'serviceRecords']));
        console.log(`pre-cleanup removed: ${pre}`);
        let fails = 0;
        for (const [i, name] of wanted.entries()) {
            // İlerleme satırı senaryo BAŞLARKEN yazılır (takılan senaryo hemen görünsün). İzleme: Select-String '^\['
            console.log(`\n[${i + 1}/${wanted.length}] ${name} başladı · ${clock()} · geçen ${elapsed()} · hata ${fails}`);
            try {
                await page.evaluate(() => window.__ft.cleanup(['requests', 'tasks', 'purchaseOrders', 'assignments', 'serviceRecords']));
                await new Promise(r => setTimeout(r, 1500));
                console.log(`\n=== ${name} ===\n` + JSON.stringify(await SCENARIOS[name](page, browser), null, 1));
            } catch (e) { failed = true; fails++; console.log(`\n=== ${name} FAILED: ${e.message}`); }
        }
        console.log(`\n■ bitti · ${wanted.length} senaryo · ${fails} hata · süre ${elapsed()}`);
    } finally {
        try {
            const post = await page.evaluate(() => window.__ft && window.__ft.cleanup(['requests', 'tasks', 'purchaseOrders', 'assignments', 'serviceRecords']));
            console.log(`\npost-cleanup removed: ${post}`);
        } catch (e) { console.log('cleanup error: ' + e.message); }
        console.log('pageerrors:', pageErrors);
        await new Promise(r => setTimeout(r, 500));   // son ihlal raporlarının ulaşması için
        const cs = csp.summary();
        console.log(`csp violations: ${cs.count}${cs.count ? ' ' + JSON.stringify(cs.distinct) + ' ' + JSON.stringify(cs.samples, null, 1) : ''}`);
        if (cs.count) failed = true;   // KJ-4: tam suite 0 ihlal
        await browser.close();
        server.close();
    }
    process.exit(failed ? 1 : 0);
})();
