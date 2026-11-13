// Envanter talebi yaşam döngüsü — uçtan uca doğrulama (KOD DEĞİŞTİRMEZ; yalnız ölçer).
// 1) Tarayıcı: gerçek index.html + gerçek kod (script.js confirmRequest / rejectRequest / showRequestApprovalModal,
//    inventory-logic receiveProduct, AssignmentService, admin inventory-management Zimmet tablosu + Zimmetten Düş).
//    Yalnız Firebase katmanı (runStockOps / applyItemOps / saveData / updateItem) yazmaları window.data'ya uygulayan ve
//    kaydeden saplamayla değişir.
// 2) Emülatör: arayüzün ürettiği HER yazma, yapanın kimliğiyle (yönetici / personel) firestore.rules'a karşı yeniden oynatılır;
//    personelin yetkisiz denemeleri (kendi talebini onaylama, reddetme, onaysız teslim, zimmet yazma) reddedilmeli.
// Kullanım: npx firebase emulators:exec --config tests/rules/firebase.rules-test.json --only firestore --project demo-rules-test
//           "node scratch/request-flow-e2e.cjs <ekran-görüntüsü-klasörü>"
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), puppeteer = require('puppeteer');
const OUT = process.argv[2] || path.join(require('node:os').tmpdir(), 'request-flow-e2e');
fs.mkdirSync(OUT, { recursive: true });
// admin-dashboard.js Firebase'i doğrudan içe aktardığı için yalnız tablo fonksiyonunun kaynağı alınır (window üzerinden çalışır).
const ADMIN_TABLE_SRC = (() => {
    const s = fs.readFileSync('src/modules/admin/admin-dashboard.js', 'utf8');
    const a = s.indexOf('window.renderAdminRequestTable = function');
    return s.slice(a, s.indexOf('\n};', a) + 3);
})();
let s0;
const SCRIPTS = ['src/utils/schema.js', 'src/services/assignment-service.js', 'src/ui/device-ids.js', 'src/utils/exit-policy.js', 'src/ui/person-picker.js',
    'src/utils/return-request-schema.js', 'src/modules/return-requests.js'];

const SEED = {
    personel: [
        { id: 's1', name: 'Ayşe Yılmaz', pri: 'ayse.yilmaz', uid: 'uid-s1', birim: 'Bilgi İşlem' },
        { id: 'adm', name: 'Sistem Yöneticisi', pri: 'sistem.yonetici' },
    ],
    productTypes: [{ id: 'pt_lap', name: 'Laptop', isDemirbas: true }, { id: 'pt_sarf', name: 'Sarf Malzeme', isDemirbas: false }],
    b1: [
        { id: 'p_lap', ürün: 'Latitude 5440', marka: 'Dell', tür: 'Laptop', raf: 'Raf-A 1', sütun: 'B1 -A', adet: 5, durumu: 'Kullanıma Hazır', açıklama: '', isDemirbas: true, lastUpdate: 1 },
        { id: 'p_mouse', ürün: 'Mouse M90', marka: 'Lenovo', tür: 'Sarf Malzeme', raf: 'Raf-B 1', sütun: 'B1 -B', adet: 20, durumu: 'Kullanıma Hazır', açıklama: '', isDemirbas: false, lastUpdate: 1 },
    ],
    b2: [], b3: [], assignments: [], returnRequests: [],
    requests: [
        { id: 'r_dem', ürün: 'Dell Latitude 5440', adet: 2, durum: 'Beklemede', personel: 'Ayşe Yılmaz', personelId: 's1', personelUid: 'uid-s1', talepTuru: 'Kalıcı Zimmet', oncelik: 'Yüksek', not: 'Yeni başlayan stajyerler', tarih: '05.11.2026 09:00' },
        { id: 'r_sarf', ürün: 'Lenovo Mouse M90', adet: 3, durum: 'Beklemede', personel: 'Ayşe Yılmaz', personelId: 's1', personelUid: 'uid-s1', talepTuru: 'Sarf Malzeme İhtiyacı', oncelik: 'Orta', not: 'Toplantı odası', tarih: '05.11.2026 09:05' },
        { id: 'r_draft', ürün: 'Kulaklık', adet: 1, durum: 'draft', personel: 'Ayşe Yılmaz', personelId: 's1', personelUid: 'uid-s1', talepTuru: 'Kalıcı Zimmet', oncelik: 'Düşük', not: 'Henüz gönderilmedi', tarih: '05.11.2026 08:50' },
        { id: 'r_rej', ürün: 'Monitör 27"', adet: 1, durum: 'Beklemede', personel: 'Ayşe Yılmaz', personelId: 's1', personelUid: 'uid-s1', talepTuru: 'Kalıcı Zimmet', oncelik: 'Düşük', not: 'İkinci ekran', tarih: '05.11.2026 09:10' },
    ],
};

async function openPage(browser) {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setViewport({ width: 1366, height: 900 });
    const html = fs.readFileSync('index.html', 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    await page.setRequestInterception(true);
    page.on('request', r => {
        const u = new URL(r.url());
        if (u.pathname === '/page') return r.respond({ status: 200, contentType: 'text/html', body: html });
        const f = decodeURIComponent(u.pathname.slice(1));
        const type = f.endsWith('.css') ? 'text/css' : f.endsWith('.js') ? 'text/javascript' : f.endsWith('.woff2') ? 'font/woff2' : 'text/plain';
        if (fs.existsSync(f) && /\.(css|js|woff2)$/.test(f)) return r.respond({ status: 200, contentType: type, body: fs.readFileSync(f) });
        return r.respond({ status: 200, contentType: 'text/plain', body: '' });
    });
    await page.goto('http://127.0.0.1/page');
    await page.evaluate(seed => {
        window.data = JSON.parse(JSON.stringify(seed));
        window._dbMirror = JSON.parse(JSON.stringify(seed));
        window.mode = 'admin';
        const users = { admin: { id: 'adm', name: 'Sistem Yöneticisi' }, staff: { id: 's1', name: 'Ayşe Yılmaz' } };
        window.isDbAdmin = () => window.mode === 'admin';
        window.requireDbAdmin = () => window.isDbAdmin();
        window.validateAdminAction = () => window.isDbAdmin();
        window.checkIsAdmin = () => window.isDbAdmin();
        window.getActiveUser = () => users[window.mode];
        Object.defineProperty(window, 'currentUser', { get: () => users[window.mode], set() {}, configurable: true });
        Object.defineProperty(window, 'userAuth', { get: () => ({ uid: window.mode === 'admin' ? 'admin-uid' : 'uid-s1' }), configurable: true });
        window.AppModules = { Session: { isStaffAccountSession: () => window.mode === 'staff' }, AdminTabs: { onShow() {} } };   // AdminTabs: admin.html sekme yönlendiricisi
        window.SecurityConfig = { guardSelfApproval: async () => ({ allowed: true }), logSelfApproval: async () => {} };
        window.alerts = []; window.showAppAlert = (m, t) => window.alerts.push([t, String(m)]);
        window.showCustomConfirm = async () => true;
        window.showWarehousePromptModal = async () => 'b1';
        window.escapeHtml = v => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
        window.jsArg = v => JSON.stringify(v).replaceAll('"', '&quot;');
        window.getTurkiyeSaati = () => '05.11.2026 10:00:00';
        window.getTurkiyeTarihi = () => '05.11.2026';
        window.bindActions = () => {};
        window.sendArchiveEmail = () => {};

        // ── Firebase katmanı saplaması: yazmaları uygular ve kaydeder (kim yaptı ile birlikte) ──
        window.writeLog = [];
        const find = (col, id) => (window.data[col] || []).find(x => String(x.id) === String(id));
        const applyOp = (o, actor) => {
            if (o.op === 'set') {
                const item = JSON.parse(JSON.stringify(o.item)); const list = window.data[o.col] = window.data[o.col] || [];
                const i = list.findIndex(x => String(x.id) === String(item.id)); if (i >= 0) list[i] = item; else list.push(item);
                window.writeLog.push({ actor, kind: 'set', col: o.col, id: String(item.id), data: JSON.parse(JSON.stringify(item)) });
            } else if (o.op === 'update') {
                const it = find(o.col, o.id); if (!it) throw new Error(`yok: ${o.col}/${o.id}`);
                Object.assign(it, o.fields);
                window.writeLog.push({ actor, kind: 'update', col: o.col, id: String(o.id), data: JSON.parse(JSON.stringify(o.fields)) });
            } else if (o.op === 'delete') {
                window.data[o.col] = (window.data[o.col] || []).filter(x => String(x.id) !== String(o.id));
                window.writeLog.push({ actor, kind: 'delete', col: o.col, id: String(o.id) });
            }
        };
        window.runStockOps = async ({ stock = [], writes = [] }) => {
            const actor = window.mode, out = [];
            const batch = [];
            stock.forEach(s => {
                const p = find(s.col, s.id); const before = Number(p.adet); const after = before + s.delta;
                if (after < 0) throw new Error('Yetersiz stok');
                p.adet = after; out.push({ col: s.col, id: s.id, name: p.ürün, before, after });
                batch.push({ actor, kind: 'update', col: s.col, id: String(s.id), data: { adet: after, lastUpdate: 2 } });
            });
            const start = window.writeLog.length;
            writes.forEach(o => applyOp(o, actor));
            window.writeLog.splice(start, 0, ...batch);
            window.writeLog.push({ actor, kind: 'commit' });
            return { stock: out, ids: [] };
        };
        window.applyItemOps = async writes => { writes.forEach(o => applyOp(o, window.mode)); window.writeLog.push({ actor: window.mode, kind: 'commit' }); };
        window.saveData = async (col, arr) => {
            const prev = new Map((window._dbMirror[col] || []).map(x => [String(x.id), JSON.stringify(x)]));
            arr.filter(x => prev.get(String(x.id)) !== JSON.stringify(x)).forEach(x => window.writeLog.push({ actor: window.mode, kind: 'setMerge', col, id: String(x.id), data: JSON.parse(JSON.stringify(x)) }));
            window.writeLog.push({ actor: window.mode, kind: 'commit' });
            window.data[col] = arr; window._dbMirror[col] = JSON.parse(JSON.stringify(arr));
        };
        window.updateItem = async (col, id, fields) => { applyOp({ op: 'update', col, id, fields }, window.mode); window.writeLog.push({ actor: window.mode, kind: 'commit' }); };
        window.writeOk = async p => { try { await p; return true; } catch { return false; } };
        document.body.classList.add('logged-in');
        document.getElementById('loginModal').style.setProperty('display', 'none', 'important');
        document.querySelectorAll('body *').forEach(n => { if (getComputedStyle(n).position === 'fixed' && !n.closest('.modal')) n.style.display = 'none'; });
        // admin.html'deki Zimmet tablosunun gövdesi (inventory-management renderTable yazar)
        const t = document.createElement('table'); t.innerHTML = '<tbody id="invTableBody"></tbody>'; document.body.append(t);
        // admin.html › Talep ve Süreçler kartındaki ikinci iade tablosu (index'teki ile aynı kod yazar)
        const t2 = document.createElement('div'); t2.innerHTML = '<select id="adminReturnRequestsFilter"><option value="pending">Bekleyen</option><option value="done">Karara bağlanan</option><option value="all">Tümü</option></select><table><tbody id="adminReturnRequestsBody"></tbody></table>'; document.body.append(t2);
    }, SEED);
    for (const s of SCRIPTS) await page.addScriptTag({ url: `http://127.0.0.1/${s}` });
    await page.addScriptTag({ type: 'module', url: 'http://127.0.0.1/src/modules/inventory-logic.js' });
    await page.addScriptTag({ type: 'module', url: 'http://127.0.0.1/src/modules/admin/inventory-management.js' });
    await page.waitForFunction(() => typeof window.receiveProduct === 'function' && window.inventoryManagementModule);
    // v3.7: script.js'ten ayrıştırılan klasik dosyalar sayfalardaki sırayla script.js'ten hemen sonra yüklenir.
    for (const s of ['script.js', 'src/ui/stock-exit-cart.js', 'src/ui/movement-table.js', 'src/ui/personnel-modal.js',
        'src/ui/request-tables.js', 'src/modules/request-actions.js']) await page.addScriptTag({ url: `http://127.0.0.1/${s}` });
    return { page, errors };
}

// Onay modalını gerçek kullanıcı gibi doldurur
async function approve(page, requestId, { stockKey, devices, sn } = {}) {
    await page.evaluate(id => { window._approval = window.confirmRequest(id); }, requestId);
    await page.waitForSelector('#requestApprovalModal #raSource');
    await page.evaluate(({ stockKey, devices, sn }) => {
        const sel = document.querySelector('#raSource');
        sel.value = stockKey; sel.dispatchEvent(new Event('change'));
        if (devices) [...document.querySelectorAll('#raDevIds .dev-ids-row')].forEach((row, i) => {
            row.querySelector('.dev-sn').value = devices[i].sn; row.querySelector('.dev-env').value = devices[i].env;
        });
        if (sn != null) document.querySelector('#raSn').value = sn;
    }, { stockKey, devices, sn });
    return page;
}
const okApproval = page => page.evaluate(async () => { document.querySelector('#raOk').click(); await window._approval; });
const rows = (page, sel) => page.$$eval(`${sel} tbody tr`, trs => trs.map(tr => [...tr.cells].map(c => c.textContent.replace(/\s+/g, ' ').trim())));

(async () => {
    const browser = await puppeteer.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--no-sandbox'] });
    const report = [];
    const ok = (name, detail = '') => { const line = `✔ ${name}${detail ? ` — ${detail}` : ''}`; report.push(line); if (process.env.E2E_VERBOSE) console.log(line); };
    let log;
    try {
        const { page, errors } = await openPage(browser);

        // ── Gelen Talepler (yönetici) ──
        await page.evaluate(() => window.renderRequestsTable());
        const head = await page.$$eval('#tableRequests thead th', ths => ths.map(t => t.textContent.trim()));
        assert.ok(head.includes('ITSM / Seri No') && !head.some(h => /BioPro|ITSM \/ Gerekçe/.test(h)));
        let r = await rows(page, '#tableRequests');
        assert.equal(r.length, 3); assert.equal(r.filter(x => /Onayla/.test(x.at(-1)) && /Reddet/.test(x.at(-1))).length, 3);
        ok('Gelen Talepler: 3 bekleyen talep Onayla/Reddet düğmeleriyle listelenir; başlık "ITSM / Seri No"');
        assert.ok(!r.some(x => /Kulaklık/.test(x[3])));
        s0 = await page.$eval('#requestsDraftNote', n => ({ hidden: n.hidden, text: n.textContent }));
        assert.equal(s0.hidden, false); assert.match(s0.text, /gönderilmemiş 1 taslak/);
        ok('B-4: Taslak talep listelenmiyor; üstte "gönderilmemiş 1 taslak talebi var" bilgi satırı');
        // admin paneli "Bekleyen Envanter Talepleri" (admin-dashboard.renderAdminRequestTable — gerçek fonksiyon kaynağı)
        await page.evaluate(src => {
            const card = document.createElement('div'); card.className = 'card';
            card.innerHTML = '<span id="reqKpiPending"></span><span id="reqKpiApproved"></span><span id="reqKpiCompleted"></span><span id="reqKpiRejected"></span><p class="req-draft-note" id="adminDraftRequestNote" hidden></p><table><tbody id="adminPendingRequestsBody"></tbody></table>';
            document.body.append(card);
            (0, eval)(src);
            window.renderAdminRequestTable();
        }, ADMIN_TABLE_SRC);
        const kpis = () => page.evaluate(() => ['reqKpiPending', 'reqKpiApproved', 'reqKpiCompleted', 'reqKpiRejected'].map(id => document.getElementById(id).textContent));
        s0 = await page.evaluate(() => ({ rows: document.querySelectorAll('#adminPendingRequestsBody tr').length,
            note: document.getElementById('adminDraftRequestNote').textContent, draft: document.getElementById('adminPendingRequestsBody').textContent.includes('Kulaklık') }));
        assert.deepEqual(s0, { rows: 3, note: s0.note, draft: false }); assert.match(s0.note, /1 taslak/);
        assert.deepEqual(await kpis(), ['3', '0', '0', '0']);
        ok('B-4: Admin "Bekleyen Envanter Talepleri" taslağı listelemiyor; kart göstergeleri Bekleyen 3 / Teslim Bekliyor 0 / Teslim Alındı 0 / Reddedilen 0');

        // ── 1) Demirbaş talebinin onayı: cihaz kimlikleri zorunlu ──
        await approve(page, 'r_dem', { stockKey: 'b1|p_lap', devices: [{ sn: '', env: '' }, { sn: '', env: '' }] });
        await page.screenshot({ path: path.join(OUT, 'request-approve-modal.png') });
        await page.evaluate(() => document.querySelector('#raOk').click());
        assert.match(await page.$eval('#raError', e => e.textContent), /Seri No veya Envanter No/i);
        await page.evaluate(() => [...document.querySelectorAll('#raDevIds .dev-ids-row')].forEach((row, i) => { row.querySelector('.dev-sn').value = ['SN-LAT-001', 'SN-LAT-002'][i]; row.querySelector('.dev-env').value = ['ENV-501', 'ENV-502'][i]; }));
        await okApproval(page);
        let s = await page.evaluate(() => {
            const req = window.data.requests.find(x => x.id === 'r_dem');
            const z = window.data.b3.filter(b => b.requestId === 'r_dem');
            return { durum: req.durum, approvedBy: req.approvedBy, stockRepo: req.stockRepo, stock: window.data.b1.find(p => p.id === 'p_lap').adet,
                z: z.map(b => [b.tip, b.adet, b.sn, b.envanterNo, b.personelId, b.alanKisi, b.isDemirbas, b.kaynakDepo]) };
        });
        assert.equal(s.durum, 'approved'); assert.equal(s.stockRepo, 'b1'); assert.equal(s.stock, 3);
        assert.deepEqual(s.z, [['zimmet', 1, 'SN-LAT-001', 'ENV-501', 's1', 'Ayşe Yılmaz', true, 'b1'], ['zimmet', 1, 'SN-LAT-002', 'ENV-502', 's1', 'Ayşe Yılmaz', true, 'b1']]);
        ok('Demirbaş onayı: cihaz kimliği girilmeden onay verilmez', '"Seri No veya Envanter No" uyarısı');
        ok('Demirbaş onayı: talep approved, stok 5 → 3, cihaz başına 1 zimmet kaydı (b3 tip zimmet, personelId s1, SN + Env. No)');

        // ── 2) Sarf talebinin onayı ──
        await approve(page, 'r_sarf', { stockKey: 'b1|p_mouse', sn: 'ITSM-778' });
        assert.match(await page.$eval('#raOutcome', e => e.textContent), /tüketim çıkışı \(sarf\)/);
        await page.screenshot({ path: path.join(OUT, 'request-approve-sarf-outcome.png') });
        await okApproval(page);
        s = await page.evaluate(() => ({ durum: window.data.requests.find(x => x.id === 'r_sarf').durum, stock: window.data.b1.find(p => p.id === 'p_mouse').adet,
            z: window.data.b3.filter(b => b.requestId === 'r_sarf').map(b => [b.tip, b.adet, b.sn, b.isDemirbas, b.personelId, b.talepTuru]),
            alert: window.alerts.at(-1)[1] }));
        assert.deepEqual([s.durum, s.stock, s.z], ['approved', 17, [['cikis', 3, 'ITSM-778', false, 's1', null]]]);
        assert.match(s.alert, /Tüketim çıkışı olarak kaydedildi/);
        ok('B-1: Sarf onayı penceresi sonucu söylüyor ("tüketim çıkışı"); kayıt tip cikis (adet 3, talebe ve kişiye bağlı), stok 20 → 17');

        // ── 3) Red: zorunlu gerekçe penceresi (B-2) ──
        await page.evaluate(() => { window._reject = window.rejectRequest('r_rej'); });
        await page.waitForSelector('#requestRejectModal [role=dialog]');
        const errOf = () => page.$eval('#requestRejectModal .req-modal-error', e => (e.hidden ? '' : e.textContent));
        await page.click('#reqRejectOk');
        assert.match(await errOf(), /gerekçesi seçin/);
        await page.evaluate(() => { [...document.querySelectorAll('input[name=reqRejectPreset]')].find(i => i.value === 'Diğer').click(); });
        await page.click('#reqRejectOk');
        assert.match(await errOf(), /açıklama zorunludur/);
        await page.evaluate(() => { [...document.querySelectorAll('input[name=reqRejectPreset]')].find(i => i.value === 'Stokta yok').click(); document.getElementById('reqRejectText').value = '<img src=x onerror=alert(1)>'; });
        await page.click('#reqRejectOk');
        assert.match(await errOf(), /etiket benzeri/);
        await page.evaluate(() => { document.getElementById('reqRejectText').value = '27" monitör Q1\'de gelecek, tekrar talep edin.'; });
        await page.screenshot({ path: path.join(OUT, 'request-reject-modal.png') });
        await page.evaluate(async () => { document.getElementById('reqRejectOk').click(); await window._reject; });
        s = await page.evaluate(() => ({ req: window.data.requests.find(x => x.id === 'r_rej'), b3: window.data.b3.filter(b => b.requestId === 'r_rej').length,
            write: window.writeLog.filter(w => w.col === 'requests' && w.id === 'r_rej').map(w => [w.kind, Object.keys(w.data).sort()]),
            modal: !!document.getElementById('requestRejectModal') }));
        assert.equal(s.req.durum, 'rejected'); assert.equal(s.req.rejectedBy, 'Sistem Yöneticisi'); assert.equal(s.b3, 0); assert.equal(s.modal, false);
        assert.equal(s.req.redGerekcesi, 'Stokta yok — 27" monitör Q1\'de gelecek, tekrar talep edin.');
        assert.deepEqual(s.write, [['update', ['durum', 'redGerekcesi', 'rejectedAt', 'rejectedBy']]]);
        ok('B-2: Red penceresi — seçimsiz, "Diğer"+boş açıklama ve etiketli metin reddedilir; gerekçe "Seçim — açıklama" olarak kaydedilir');
        ok('B-5: Red yalnız 4 alanı (durum, redGerekcesi, rejectedBy, rejectedAt) günceller; tam kayıt yazılmaz; stok/zimmet değişmez');

        // Vazgeç gerçekten vazgeçer
        await page.evaluate(() => { window.data.requests.push({ id: 'r_cancel', ürün: 'Klavye', adet: 1, durum: 'Beklemede', personel: 'Ayşe Yılmaz', personelId: 's1', personelUid: 'uid-s1' }); window._reject = window.rejectRequest('r_cancel'); });
        await page.waitForSelector('#requestRejectModal');
        await page.keyboard.press('Escape');
        await page.evaluate(() => window._reject);
        assert.equal(await page.evaluate(() => window.data.requests.find(x => x.id === 'r_cancel').durum), 'Beklemede');
        await page.evaluate(() => { window.data.requests = window.data.requests.filter(x => x.id !== 'r_cancel'); });
        ok('Red penceresinde Esc / Vazgeç: talep bekleyen kalır');

        // tekrar onay / red engeli
        await page.evaluate(async () => { window.alerts = []; await window.confirmRequest('r_dem'); await window.rejectRequest('r_rej'); });
        assert.equal(await page.evaluate(() => window.alerts.filter(a => /zaten işlenmiş/.test(a[1])).length), 2);
        ok('İşlenmiş talep tekrar onaylanamaz / reddedilemez');

        // B-6: talebe bağlı hareket kaydı zaten varken onay durur, stok düşmez
        s = await page.evaluate(async () => {
            window.data.requests.push({ id: 'r_dup', ürün: 'Mouse M90', adet: 1, durum: 'Beklemede', personel: 'Ayşe Yılmaz', personelId: 's1', personelUid: 'uid-s1' });
            window.data.b3.push({ id: 'b3_dup', requestId: 'r_dup', tip: 'zimmet' });
            const before = window.writeLog.length, stock = window.data.b1.find(p => p.id === 'p_mouse').adet;
            window.alerts = [];
            await window.confirmRequest('r_dup');
            const out = { writes: window.writeLog.length - before, stock: window.data.b1.find(p => p.id === 'p_mouse').adet - stock,
                modal: !!document.getElementById('requestApprovalModal'), durum: window.data.requests.find(x => x.id === 'r_dup').durum, alert: (window.alerts.at(-1) || [])[1] };
            window.data.requests = window.data.requests.filter(x => x.id !== 'r_dup'); window.data.b3 = window.data.b3.filter(x => x.id !== 'b3_dup');
            return out;
        });
        assert.deepEqual([s.writes, s.stock, s.modal, s.durum], [0, 0, false, 'Beklemede']); assert.match(s.alert, /zaten var; onay yapılmadı ve stok düşülmedi/);
        ok('B-6: Talebe bağlı kayıt zaten varsa onay penceresi açılmaz, yazma yok, stok değişmez, uyarı gösterilir');

        await page.evaluate(() => window.renderRequestsTable());
        r = await rows(page, '#tableRequests');
        assert.deepEqual(r.map(x => (x[6].match(/^(Onaylandı|Reddedildi|Bekliyor|Teslim Alındı)/) || [x[6]])[0]), ['Onaylandı', 'Onaylandı', 'Reddedildi']);
        assert.match(r[2][6], /Stokta yok — 27" monitör/);
        assert.ok(r.every(x => /İşlem Yapıldı/.test(x[7])));
        ok('Gelen Talepler: durumlar Onaylandı / Onaylandı / Reddedildi; reddedilen satırda gerekçe görünür');
        await page.evaluate(() => window.renderAdminRequestTable());
        assert.deepEqual(await kpis(), ['0', '2', '0', '1']);
        ok('Admin kart göstergeleri karardan sonra: Bekleyen 0 / Teslim Bekliyor 2 / Teslim Alındı 0 / Reddedilen 1');

        // ── 4) Yönetici Zimmet ekranı (admin) ──
        await page.evaluate(() => window.inventoryManagementModule.renderTable());
        let z = await page.evaluate(() => window.inventoryManagementModule.getNormalizedAssignments().map(a => [a.ürün, a.sn, a.durum, a.personelId]));
        assert.deepEqual(z.map(x => x[2]), ['Teslim Bekliyor', 'Teslim Bekliyor']);
        assert.equal(await page.$$eval('#invTableBody tr', t => t.length), 2);
        assert.equal(await page.$$eval('#invTableBody .zim-state-teslimBekliyor', t => t.length), 2);
        assert.ok(!z.some(x => /Monitör|Mouse/.test(x[0])));
        ok('B-3: Zimmet ekranı — onaylanan 2 laptop "⏳ Teslim Bekliyor" rozetiyle; sarf (tüketim) ve reddedilen talep yok');
        s = await page.evaluate(() => { const m = window.inventoryManagementModule; m.state.stateFilter = 'zimmetli'; m.renderTable();
            const n = document.querySelectorAll('#invTableBody .zim-state').length; m.state.stateFilter = 'teslimBekliyor'; m.renderTable();
            const n2 = document.querySelectorAll('#invTableBody .zim-state').length; m.state.stateFilter = 'all'; m.renderTable(); return [n, n2]; });
        assert.deepEqual(s, [0, 2]);
        ok('B-3: Zimmet ekranı durum filtresi — "Zimmetli" 0, "Teslim Bekliyor" 2');

        // ── Admin üst çubuğu bekleyen talep rozeti (request-badge.js) ──
        await page.evaluate(() => {
            const bar = document.createElement('div');
            bar.innerHTML = '<div class="todo-nav-badge-container is-passive" id="admin-nav-request-badge"><span class="todo-nav-badge badge-hidden" id="admin-nav-request-count">0</span></div><span id="adminRequestBadgeLive"></span><div id="pendingRequestsCard"></div>';
            document.body.prepend(bar);
            window.showAdminTab = tab => { window._shownTab = tab; };
        });
        await page.addScriptTag({ url: 'http://127.0.0.1/src/ui/request-badge.js' });
        s = await page.evaluate(async () => {
            const read = () => ({ n: document.getElementById('admin-nav-request-count').textContent, hidden: document.getElementById('admin-nav-request-count').classList.contains('badge-hidden'),
                passive: document.getElementById('admin-nav-request-badge').classList.contains('is-passive'), pulse: document.getElementById('admin-nav-request-badge').classList.contains('request-badge-pulse'),
                live: document.getElementById('adminRequestBadgeLive').textContent });
            window.RequestBadge.update();
            const zero = read();
            window.data.requests.push({ id: 'r_live', ürün: 'Klavye', adet: 1, durum: 'Beklemede', personel: 'Ayşe Yılmaz', personelId: 's1', personelUid: 'uid-s1' });
            window.dispatchEvent(new CustomEvent('onInventoryDataUpdated', { detail: { collection: 'requests' } }));
            const one = read();
            window.RequestBadge.goToPending();
            await new Promise(r => setTimeout(r, 120));
            window.data.requests = window.data.requests.filter(r => r.id !== 'r_live');
            window.RequestBadge.update();
            return { zero, one, tab: window._shownTab, focused: document.activeElement && document.activeElement.id, after: read() };
        });
        assert.deepEqual([s.zero.n, s.zero.hidden, s.zero.passive], ['0', true, true]);
        assert.deepEqual([s.one.n, s.one.hidden, s.one.passive, s.one.pulse], ['1', false, false, true]);
        assert.match(s.one.live, /Yeni talep geldi\. 1 envanter talebi bekliyor/);
        assert.deepEqual([s.tab, s.focused, s.after.n, s.after.hidden], ['purchaseTab', 'pendingRequestsCard', '0', true]);
        ok('Rozet: 0 iken gizli/pasif; yeni talep gelince 1, nabız + ekran okuyucu duyurusu; tıklayınca Talep ve Süreçler kartına gider; taslak sayılmaz');

        // ── 5) Personel: Taleplerim + Kişi Envanteri (teslim almadan önce) ──
        await page.evaluate(() => { window.mode = 'staff'; window.renderMyRequestsTable(); window.renderPersonnelInventoryTable(); });
        r = await rows(page, '#tableMyRequests');
        assert.equal(r.filter(x => /Teslim Aldım/.test(x[4])).length, 2);
        assert.equal(r.filter(x => /REDDEDİLDİ/.test(x[2]) && /Talep Reddedildi/.test(x[4])).length, 1);
        assert.ok(r.some(x => /Gerekçe: Stokta yok — 27" monitör Q1'de gelecek/.test(x[2])));
        ok('B-2: Personel Taleplerim\'de red gerekçesini görüyor');
        assert.ok(r.some(x => /Lenovo Mouse/.test(x[1]) && /Tüketim çıkışı — envanterinize eklenmez/.test(x[2])));
        ok('B-1: Taleplerim\'de onaylanan sarf talebinde "Tüketim çıkışı — envanterinize eklenmez" notu');
        await page.evaluate(() => document.querySelectorAll('.tab-content').forEach(t => t.classList.toggle('active', t.id === 'myRequests')));
        await page.screenshot({ path: path.join(OUT, 'request-my-requests-reason.png') });
        let inv = await rows(page, '#tablePersonnelInventory');
        assert.equal(inv.length, 2);
        assert.ok(inv.every(x => /Teslim Bekliyor/.test(x[5])));
        s0 = await page.$eval('#personnelAwaitingNote', n => ({ hidden: n.hidden, text: n.textContent }));
        assert.equal(s0.hidden, false); assert.match(s0.text, /Onaylanan 2 kalem teslim almanızı bekliyor/);
        s = await page.evaluate(() => window.AssignmentService.generatePersonnelZimmetData('s1').ozet);
        assert.equal(s.kalemSayisi, 0); assert.equal(s.teslimBekleyen, 2);
        await page.evaluate(() => document.querySelectorAll('.tab-content').forEach(t => t.classList.toggle('active', t.id === 'personnelInventoryTab')));
        await page.screenshot({ path: path.join(OUT, 'request-person-inventory-awaiting.png') });
        ok('B-3: Kişi Envanteri — 2 laptop "⏳ Teslim Bekliyor" rozetiyle listenin başında; üstte "Taleplerim\'e git" notu; tutanakta 0 kalem, 2 teslim bekleyen');

        // ── 6) Teslim alma ──
        await page.evaluate(async () => { await window.receiveProduct('r_dem'); await window.receiveProduct('r_sarf'); window.renderPersonnelInventoryTable(); });
        inv = await rows(page, '#tablePersonnelInventory');
        assert.equal(inv.length, 2);
        assert.deepEqual(inv.map(x => x[4]), ['Demirbaş', 'Demirbaş']);
        assert.deepEqual(inv.map(x => x[5]), ['📌 Zimmetli', '📌 Zimmetli']);
        assert.equal(await page.$eval('#personnelAwaitingNote', n => n.hidden), true);
        assert.ok(inv.some(x => /SN-LAT-001/.test(x[2]) && /ENV-501/.test(x[2])));
        s = await page.evaluate(() => ({ o: window.AssignmentService.generatePersonnelZimmetData('s1').ozet, sarf: window.data.requests.find(x => x.id === 'r_sarf').durum }));
        assert.deepEqual([s.o.kalemSayisi, s.o.demirbasAdet, s.o.sarfAdet, s.o.teslimBekleyen, s.sarf], [2, 2, 0, 0, 'completed']);
        await page.evaluate(() => window.switchTab && document.querySelectorAll('.tab-content').forEach(t => t.classList.toggle('active', t.id === 'personnelInventoryTab')));
        await page.screenshot({ path: path.join(OUT, 'request-person-inventory.png') });
        ok('Teslim Aldım: iki talep de completed; Kişi Envanteri yalnız 2 demirbaş (SN/Env.No ile); zimmet tutanağı 2 kalem, sarf 0');

        // personel kendi talebini onaylayamaz (arayüz)
        await page.evaluate(async () => { window.alerts = []; window.data.requests.push({ id: 'r_self', ürün: 'X', adet: 1, durum: 'Beklemede', personel: 'Ayşe Yılmaz', personelId: 's1', personelUid: 'uid-s1' }); await window.confirmRequest('r_self'); });
        assert.equal(await page.evaluate(() => window.data.requests.find(x => x.id === 'r_self').durum), 'Beklemede');
        await page.evaluate(() => { window.data.requests = window.data.requests.filter(x => x.id !== 'r_self'); });
        ok('Personel kendi talebini onaylayamaz (arayüz durdurur)');

        // ── 7) İade talebi (Faz 5): personel gönderir / geri çeker / yeniden gönderir; yönetici reddeder, onaylar, görüntüler, siler ──
        const laps = await page.evaluate(() => window.data.b3.filter(b => b.requestId === 'r_dem').map(b => String(b.id)));
        const retRows = (pg, sel) => pg.$$eval(`${sel} tr`, trs => trs.map(tr => [...tr.cells].map(c => c.textContent.replace(/\s+/g, ' ').trim())));
        const retErr = id => page.$eval(`#${id} .req-modal-error`, e => (e.hidden ? '' : e.textContent));
        // boş durum: iki yönetici tablosunda da ne işe yaradığını anlatan metin
        await page.evaluate(() => { window.mode = 'admin'; window.ReturnRequests.renderAdminTables(); });
        for (const body of ['#returnRequestsBody', '#adminReturnRequestsBody']) {
            const e = await retRows(page, body);
            assert.equal(e.length, 1); assert.match(e[0][0], /Personelin üzerindeki demirbaşı iade etmek için gönderdiği talepler burada listelenir/);
        }
        ok('İade tabloları (Gelen Talepler + admin Talep ve Süreçler) boşken ne işe yaradıklarını anlatan metni gösterir');

        await page.evaluate(() => { window.mode = 'staff'; window.renderPersonnelInventoryTable(); });
        inv = await rows(page, '#tablePersonnelInventory');
        assert.deepEqual(inv.map(x => x[7]), ['İade Talebi', 'İade Talebi']);
        assert.match((await retRows(page, '#myReturnRequestsBody'))[0][0], /Henüz iade talebiniz yok/);
        // gönder: doğrulama → kayıt
        const clickInvAction = idx => page.evaluate(i => document.querySelectorAll('#tablePersonnelInventory tbody tr')[i].querySelector('.ret-action').click(), idx);
        const invIndexOf = sn => page.evaluate(v => [...document.querySelectorAll('#tablePersonnelInventory tbody tr')].findIndex(tr => tr.textContent.includes(v)), sn);
        await clickInvAction(await invIndexOf('SN-LAT-001'));
        await page.waitForSelector('#returnRequestModal #retSubmit');
        await page.click('#retSubmit');
        assert.notEqual(await retErr('returnRequestModal'), '');
        await page.evaluate(() => { document.getElementById('retGerekce').value = 'Diğer'; document.getElementById('retBeyan').value = 'Arızalı'; });
        await page.click('#retSubmit');
        assert.match(await retErr('returnRequestModal'), /açıklama/i);
        await page.evaluate(() => { document.getElementById('retGerekce').value = 'Arıza'; document.getElementById('retAciklama').value = 'Ekran titriyor, menteşe gevşek.'; });
        await page.screenshot({ path: path.join(OUT, 'return-staff-form.png') });
        await page.click('#retSubmit');
        await page.waitForFunction(() => !document.getElementById('returnRequestModal'));
        s = await page.evaluate(z => {
            const r = window.data.returnRequests.find(x => x.zimmetId === z);
            return r && { id: r.id, durum: r.durum, sn: r.sn, gerekce: r.gerekce, beyan: r.bildirilenDurum, uid: r.personelUid,
                state: window.AssignmentService.assignmentState(window.AssignmentService.getAssignments().find(a => String(a.id) === z)) };
        }, laps[0]);
        assert.deepEqual(s, { id: `ret_${laps[0]}`, durum: 'Beklemede', sn: 'SN-LAT-001', gerekce: 'Arıza', beyan: 'Arızalı', uid: 'uid-s1', state: 'iadeBekliyor' });
        inv = await rows(page, '#tablePersonnelInventory');
        assert.ok(inv.some(x => /SN-LAT-001/.test(x[2]) && /İade Onayı Bekliyor/.test(x[5]) && /Yönetici onayı bekleniyor/.test(x[7])));
        let mine = await retRows(page, '#myReturnRequestsBody');
        assert.equal(mine.length, 1); assert.match(mine[0][3], /Onay Bekliyor/); assert.equal(mine[0][4], 'Geri Çek');
        ok('İade talebi (personel): gerekçe/durum seçmeden ve "Diğer"+boş açıklamayla gönderilmez; gönderilince kayıt ret_<zimmet> Beklemede, satır "İade Onayı Bekliyor"');
        // geri çek → yeniden gönder
        await page.evaluate(() => document.querySelector('#myReturnRequestsBody .ret-action').click());
        await page.waitForFunction(z => window.data.returnRequests.find(x => x.zimmetId === z).durum === 'withdrawn', {}, laps[0]);
        mine = await retRows(page, '#myReturnRequestsBody');
        assert.match(mine[0][3], /Geri Çekildi/); assert.equal(mine[0][4], 'Yeniden Gönder');
        await page.evaluate(() => document.querySelector('#myReturnRequestsBody .ret-action').click());
        await page.waitForSelector('#returnRequestModal #retSubmit');
        assert.deepEqual(await page.evaluate(() => [document.getElementById('retGerekce').value, document.getElementById('retBeyan').value]), ['Arıza', 'Arızalı']);
        await page.click('#retSubmit');
        await page.waitForFunction(z => window.data.returnRequests.find(x => x.zimmetId === z).durum === 'Beklemede', {}, laps[0]);
        ok('İade talebi (personel): Geri Çek → "Geri Çekildi"; Yeniden Gönder önceki seçimlerle açılır ve talebi tekrar bekleyene alır');
        // ikinci cihaz
        await clickInvAction(await invIndexOf('SN-LAT-002'));
        await page.waitForSelector('#returnRequestModal #retSubmit');
        await page.evaluate(() => { document.getElementById('retGerekce').value = 'İhtiyaç kalmadı'; document.getElementById('retBeyan').value = 'Çalışır'; });
        await page.click('#retSubmit');
        await page.waitForFunction(() => !document.getElementById('returnRequestModal'));

        // yönetici: iki tabloda bekleyen 2 talep; ikinciyi reddet
        await page.evaluate(() => { window.mode = 'admin'; window.ReturnRequests.renderAdminTables(); });
        for (const body of ['#returnRequestsBody', '#adminReturnRequestsBody']) {
            const e = await retRows(page, body);
            assert.equal(e.length, 2); assert.ok(e.every(x => /Onay Bekliyor/.test(x[5]) && x[6] === 'OnaylaReddet'));
        }
        await page.evaluate(() => document.querySelectorAll('.tab-content').forEach(t => t.classList.toggle('active', t.id === 'requests')));
        await page.evaluate(() => document.getElementById('tableReturnRequests').scrollIntoView());
        await page.screenshot({ path: path.join(OUT, 'return-admin-pending.png') });
        ok('İade talepleri (yönetici): Gelen Talepler ve admin Talep ve Süreçler tablolarında 2 bekleyen talep Onayla/Reddet ile');
        await page.evaluate(id => { window._rr = window.ReturnRequests.reject(id); }, `ret_${laps[1]}`);
        await page.waitForSelector('#requestRejectModal [role=dialog]');
        assert.deepEqual(await page.$$eval('input[name=reqRejectPreset]', i => i.map(x => x.value)), ['Cihaz görev için hâlâ gerekli', 'Yedek cihaz bekleniyor', 'Bilgi eksik', 'Mükerrer talep', 'Diğer']);
        await page.evaluate(() => { [...document.querySelectorAll('input[name=reqRejectPreset]')].find(i => i.value === 'Yedek cihaz bekleniyor').click(); document.getElementById('reqRejectText').value = 'Yeni laptop gelince iade alınacak.'; });
        await page.screenshot({ path: path.join(OUT, 'return-reject-modal.png') });
        await page.evaluate(async () => { document.getElementById('reqRejectOk').click(); await window._rr; });
        s = await page.evaluate(id => window.data.returnRequests.find(x => x.id === id), `ret_${laps[1]}`);
        assert.deepEqual([s.durum, s.redGerekcesi, s.reddeden], ['rejected', 'Yedek cihaz bekleniyor — Yeni laptop gelince iade alınacak.', 'Sistem Yöneticisi']);
        await page.evaluate(() => { window.mode = 'staff'; window.ReturnRequests.renderMine(); });
        mine = await retRows(page, '#myReturnRequestsBody');
        assert.ok(mine.some(x => /Reddedildi/.test(x[3]) && /Gerekçe: Yedek cihaz bekleniyor/.test(x[3]) && x[4] === 'Yeniden Gönder'));
        await page.evaluate(() => document.querySelectorAll('.tab-content').forEach(t => t.classList.toggle('active', t.id === 'personnelInventoryTab')));
        await page.evaluate(() => document.getElementById('tableMyReturnRequests').scrollIntoView());
        await page.screenshot({ path: path.join(OUT, 'return-my-requests.png') });
        ok('İade reddi: iadeye özgü gerekçe seçenekleri; gerekçe personelin "İade Taleplerim" bölümünde görünür, Yeniden Gönder açılır');
        // personel reddedileni yeniden gönderir
        await page.evaluate(() => [...document.querySelectorAll('#myReturnRequestsBody tr')].find(tr => /Reddedildi/.test(tr.textContent)).querySelector('.ret-action').click());
        await page.waitForSelector('#returnRequestModal #retSubmit');
        assert.match(await page.$eval('#returnRequestModal', m => m.textContent), /Önceki red gerekçesi: Yedek cihaz bekleniyor/);
        await page.click('#retSubmit');
        await page.waitForFunction(id => window.data.returnRequests.find(x => x.id === id).durum === 'Beklemede', {}, `ret_${laps[1]}`);
        ok('Reddedilen iade talebi önceki red gerekçesi gösterilerek yeniden gönderilebilir');

        // yönetici onayı (1): beyan "Arızalı" → pencere Arızalı ve "stoğa ekle" kapalı başlar; teslim alındı, B1, stoğa eklenmez
        await page.evaluate(id => { window.mode = 'admin'; window._ra = window.ReturnRequests.approve(id); }, `ret_${laps[0]}`);
        await page.waitForSelector('#returnDecisionModal #retDecisionOk');
        s = await page.evaluate(() => ({ state: document.getElementById('retAdminState').value, stock: document.getElementById('retAddStock').checked,
            hint: document.querySelector('#returnDecisionModal .ret-hint').textContent, info: document.querySelector('#returnDecisionModal .ret-request-info').textContent }));
        assert.deepEqual([s.state, s.stock], ['Arızalı', false]); assert.match(s.hint, /stoğa eklemek sizin kararınız/); assert.match(s.info, /Arıza — Ekran titriyor/);
        await page.screenshot({ path: path.join(OUT, 'return-decision-modal.png') });
        await page.evaluate(async () => { document.getElementById('retDecisionOk').click(); await window._ra; });
        s = await page.evaluate(([z, id]) => {
            const b = window.data.b3.find(x => String(x.id) === z), r = window.data.returnRequests.find(x => x.id === id);
            return { b3: { iadeEdildi: b.iadeEdildi, iadeDepo: b.iadeDepo },
                ret: { durum: r.durum, teslimAlindi: r.teslimAlindi, iadeDepo: r.iadeDepo, stogaEklendi: r.stogaEklendi, adminCihazDurumu: r.adminCihazDurumu, onaylayan: r.onaylayan },
                stock: window.data.b1.find(p => p.id === 'p_lap').adet, req: window.data.requests.find(x => x.id === 'r_dem').iadeEdildi ?? null, alert: window.alerts.at(-1)[1] };
        }, [laps[0], `ret_${laps[0]}`]);
        assert.deepEqual(s.b3, { iadeEdildi: true, iadeDepo: 'b1' });
        assert.deepEqual(s.ret, { durum: 'approved', teslimAlindi: true, iadeDepo: 'b1', stogaEklendi: false, adminCihazDurumu: 'Arızalı', onaylayan: 'Sistem Yöneticisi' });
        assert.deepEqual([s.stock, s.req], [3, null]); assert.match(s.alert, /Stoğa eklenmedi/);
        ok('İade onayı (arızalı, teslim alındı, stoğa eklenmedi): zimmet B1 iadesiyle kapanır, stok 3 kalır, talep (ikinci cihaz açık) kapanmaz');

        // yönetici onayı (2): Zimmet ekranı › Zimmetten Düş, bekleyen iade talebi olan cihazda aynı onay penceresini açar; sağlam → stoğa eklenir
        await page.evaluate(z => { window._rz = window.inventoryManagementModule.removeAssignment(z, 'b3'); }, laps[1]);
        await page.waitForSelector('#returnDecisionModal #retDecisionOk');
        assert.equal(await page.$eval('#returnDecisionModalTitle', h => h.textContent), 'İade Talebini Onayla');
        assert.deepEqual(await page.evaluate(() => [document.getElementById('retAdminState').value, document.getElementById('retAddStock').checked]), ['Sağlam', true]);
        await page.evaluate(async () => { document.getElementById('retDecisionOk').click(); await window._rz; });
        s = await page.evaluate(id => ({ ret: window.data.returnRequests.find(x => x.id === id), stock: window.data.b1.find(p => p.id === 'p_lap').adet,
            req: window.data.requests.find(x => x.id === 'r_dem').iadeEdildi, alert: window.alerts.at(-1)[1] }), `ret_${laps[1]}`);
        assert.deepEqual([s.ret.durum, s.ret.stogaEklendi, s.ret.adminCihazDurumu, s.stock, s.req], ['approved', true, 'Sağlam', 4, true]);
        assert.match(s.alert, /B1 stok: 3 → 4/);
        s = await page.evaluate(() => { window.mode = 'staff'; return window.AssignmentService.getPersonInventory(window.getActiveUser()).length; });
        assert.equal(s, 0);
        ok('Zimmetten Düş (bekleyen iade talebi olan cihaz): iade onayı penceresi açılır; sağlam + stoğa ekle → B1 3 → 4; son cihazla talep iade edildi olur; Kişi Envanteri 0');

        // görüntüle, süzgeç, iki adımlı silme
        await page.evaluate(() => { window.mode = 'admin'; document.getElementById('returnRequestsFilter').value = 'pending'; window.ReturnRequests.renderAdminTables(); });
        assert.match((await retRows(page, '#returnRequestsBody'))[0][0], /Onay bekleyen iade talebi yok/);
        await page.evaluate(() => { const f = document.getElementById('returnRequestsFilter'); f.value = 'done'; f.dispatchEvent(new Event('change')); });
        const done = await retRows(page, '#returnRequestsBody');
        assert.equal(done.length, 2); assert.ok(done.every(x => /İade Alındı/.test(x[5]) && /Görüntüle/.test(x[6]) && /Sil/.test(x[6])));
        assert.ok(done.some(x => /Arızalı · B1 · stoğa eklenmedi/.test(x[4]))); assert.ok(done.some(x => /Sağlam · B1 · stoğa eklendi/.test(x[4])));
        await page.evaluate(id => window.ReturnRequests.view(id), `ret_${laps[0]}`);
        const detail = await page.$eval('#returnViewModal .ret-detail', d => d.textContent);
        assert.match(detail, /Teslim alındıEvet/); assert.match(detail, /Stoğa eklendiHayır/); assert.match(detail, /Cihaz durumu \(yönetici\)Arızalı/);
        await page.screenshot({ path: path.join(OUT, 'return-view-modal.png') });
        await page.keyboard.press('Escape');
        ok('Karara bağlanan iadeler listede kalır ("Karara bağlanan" süzgeci); Görüntüle tüm kararı (teslim, depo, stok, cihaz durumu) gösterir');
        await page.evaluate(id => { window._rd = window.ReturnRequests.remove(id); }, `ret_${laps[0]}`);
        await page.waitForSelector('#returnDeleteModal #retDeleteOk');
        assert.match(await page.$eval('#returnDeleteModal', m => m.textContent), /"ENV-501" yazın/);
        await page.evaluate(() => { document.getElementById('retDeleteConfirm').value = 'ENV-502'; });
        await page.click('#retDeleteOk');
        assert.match(await retErr('returnDeleteModal'), /aynı değil/);
        await page.evaluate(() => { document.getElementById('retDeleteConfirm').value = 'ENV-501'; });
        await page.evaluate(async () => { document.getElementById('retDeleteOk').click(); await window._rd; });
        s = await page.evaluate(() => ({ n: window.data.returnRequests.length, b3: window.data.b3.filter(b => b.requestId === 'r_dem').every(b => b.iadeEdildi) }));
        assert.deepEqual(s, { n: 1, b3: true });
        ok('İade kaydı silme iki adımlı: onay + Env. No yazma (yanlış ifade reddedilir); silme zimmet kapanışını geri almaz');

        // ── 8) Sarf dönüşüm aracı (Sistem Kontrol) — eski sarf zimmetleri ──
        await page.addScriptTag({ url: 'http://127.0.0.1/src/modules/admin/admin-system-control.js' });
        s = await page.evaluate(async () => {
            window.mode = 'admin';
            const old = (id, extra) => ({ id, sema: 2, tip: 'zimmet', kaynakDepo: 'b1', productId: 'p_mouse', requestId: null, rafNo: 'Raf-B 1', sutun: 'B1 -B',
                urunTuru: 'Sarf Malzeme', urunAciklama: 'Eski Mouse', marka: 'Lenovo', adet: 2, sn: '-', envanterNo: '-', not: '-', alanKisi: 'Ayşe Yılmaz',
                personelId: 's1', tarih: '01.10.2026', ts: 1, isDemirbas: false, talepTuru: 'Kalıcı Zimmet', oncelik: 'Orta', iadeTarihi: null,
                iadeEdildi: false, iadeEdildiTarihi: null, iadeDepo: null, onaylayan: 'Admin', ...extra });
            window.data.b3.push(old('old_sarf'), old('old_ret', { iadeEdildi: true, iadeEdildiTarihi: '02.10.2026', iadeDepo: 'b1' }), old('old_unk', { isDemirbas: null }));
            window.writeLog.push(...['old_sarf', 'old_ret', 'old_unk'].map(id => ({ actor: 'seed', kind: 'seed', col: 'b3', id, data: window.data.b3.find(b => b.id === id) })));
            const invBefore = window.AssignmentService.getPersonInventory({ id: 's1', name: 'Ayşe Yılmaz' }).length;
            window.alerts = [];
            window.COLLECTION_ROOT = 'lifeserver_master';
            await window.vipMigrateSarfConsumption();
            const tip = id => window.data.b3.find(b => b.id === id).tip;
            const out = { tips: [tip('old_sarf'), tip('old_ret'), tip('old_unk')], alert: window.alerts.at(-1)[1],
                invBefore, invAfter: window.AssignmentService.getPersonInventory({ id: 's1', name: 'Ayşe Yılmaz' }).length };
            window.alerts = [];
            await window.vipMigrateSarfConsumption();
            out.second = window.alerts.at(-1)[1];
            return out;
        });
        assert.deepEqual(s.tips, ['cikis', 'zimmet', 'zimmet']);
        assert.match(s.alert, /1 sarf zimmeti tüketim çıkışına çevrildi/);
        assert.deepEqual([s.invBefore, s.invAfter], [2, 1]);   // iki laptop 7. adımda iade edildi
        assert.match(s.second, /Dönüştürülecek sarf zimmeti yok/);
        ok('B-1: Sarf dönüşüm aracı — yalnız açık sarf zimmeti çevrilir; iade edilmiş ve belirsiz kayda dokunulmaz; Kişi Envanteri 2 → 1; ikinci çalıştırma boş');
        // ── 9) Zimmetten Düş (iade talebi yok), teslim alınmadan kapatma: açıklama zorunlu, stok/depo yok ──
        await page.evaluate(() => { window.mode = 'admin'; window._rz = window.inventoryManagementModule.removeAssignment('old_unk', 'b3'); });
        await page.waitForSelector('#returnDecisionModal #retDecisionOk');
        assert.equal(await page.$eval('#returnDecisionModalTitle', h => h.textContent), 'Zimmetten Düş');
        await page.evaluate(() => document.getElementById('retReceived_no').click());
        assert.equal(await page.$eval('#retCloseNote', n => n.closest('.ret-branch').hidden), false);
        await page.click('#retDecisionOk');
        assert.match(await page.$eval('#returnDecisionModal .req-modal-error', e => e.textContent), /açıklama zorunludur/);
        await page.evaluate(() => { document.getElementById('retCloseNote').value = 'Personel ayrıldı; cihaz teslim edilmedi, kayıp tutanağı açıldı.'; });
        await page.evaluate(async () => { document.getElementById('retDecisionOk').click(); await window._rz; });
        s = await page.evaluate(() => ({ b: (({ iadeEdildi, iadeDepo }) => ({ iadeEdildi, iadeDepo }))(window.data.b3.find(x => x.id === 'old_unk')),
            mouse: window.data.b1.find(p => p.id === 'p_mouse').adet, alert: window.alerts.at(-1)[1], rets: window.data.returnRequests.length }));
        assert.deepEqual([s.b, s.rets], [{ iadeEdildi: true, iadeDepo: null }, 1]); assert.match(s.alert, /Teslim alınmadan kapatıldı/);
        ok('Zimmetten Düş (talepsiz, teslim alınmadı): kapanış açıklaması zorunlu; zimmet iadeDepo boş kapanır, stok değişmez, iade kaydı oluşmaz');
        assert.deepEqual(errors, []);
        log = await page.evaluate(() => window.writeLog);
    } finally { await browser.close(); }

    // ── Emülatör: arayüzün ürettiği yazmalar kurallardan geçiyor mu ──
    if (!process.env.FIRESTORE_EMULATOR_HOST) { console.log(report.join('\n')); console.log('Emülatör yok: kural tekrarı atlandı.'); return; }
    const { initializeTestEnvironment, assertSucceeds, assertFails } = await import('@firebase/rules-unit-testing');
    const { doc, setDoc, updateDoc, deleteDoc, writeBatch, setLogLevel } = await import('firebase/firestore');
    setLogLevel('silent');
    const env = await initializeTestEnvironment({ projectId: 'demo-request-flow', firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') } });
    const R = 'lifeserver_master';
    const ref = (db, col, id) => doc(db, R, col, 'items', String(id));
    const dbs = {
        admin: () => env.authenticatedContext('admin-uid', { email: 'admin@medipol.local', firebase: { sign_in_provider: 'password' } }).firestore(),
        staff: () => env.authenticatedContext('uid-s1', { email: 'ayse.yilmaz@staff.medipol.local', firebase: { sign_in_provider: 'password' } }).firestore(),
    };
    try {
        await env.withSecurityRulesDisabled(async c => {
            const db = c.firestore();
            await setDoc(ref(db, 'personel', 's1'), SEED.personel[0]);
            await setDoc(ref(db, 'staffAccounts', 'uid-s1'), { personelId: 's1', pri: 'ayse.yilmaz' });
            await setDoc(ref(db, 'accessGate', 'staff'), { staffAccessEnabled: true });
            for (const t of SEED.productTypes) await setDoc(ref(db, 'productTypes', t.id), t);
            for (const p of SEED.b1) await setDoc(ref(db, 'b1', p.id), p);
            for (const q of SEED.requests) await setDoc(ref(db, 'requests', q.id), q);
        });
        // yazma günlüğünü commit gruplarına böl ve sırayla, yapanın kimliğiyle oynat
        let group = [], replayed = 0;
        for (const w of log) {
            // Testin kendi kurduğu eski veri (seed): kurallar kapalıyken yazılır, yazma sayılmaz
            if (w.kind === 'seed') { await env.withSecurityRulesDisabled(c => setDoc(ref(c.firestore(), w.col, w.id), w.data)); continue; }
            if (w.kind !== 'commit') { group.push(w); continue; }
            if (!group.length) continue;
            const db = dbs[group[0].actor](), batch = writeBatch(db);
            for (const g of group) {
                if (g.kind === 'set') batch.set(ref(db, g.col, g.id), g.data);
                else if (g.kind === 'setMerge') batch.set(ref(db, g.col, g.id), g.data, { merge: true });
                else if (g.kind === 'delete') batch.delete(ref(db, g.col, g.id));
                else batch.update(ref(db, g.col, g.id), g.data);
            }
            await assertSucceeds(batch.commit()).catch(e => { throw new Error(`Kural reddetti (${group[0].actor}): ${group.map(g => `${g.kind} ${g.col}/${g.id}`).join(', ')} — ${e.message} · ${JSON.stringify(group.map(g => g.data))}`); });
            replayed += group.length; group = [];
        }
        ok('Kural tekrarı: arayüzün ürettiği tüm yazmalar kimliğiyle kurallardan GEÇTİ', `${replayed} yazma (onay+stok+zimmet, red, teslim, iade talebi gönder/geri çek/yeniden gönder, iade onayı/red, zimmetten düş, silme)`);
        // personelin yetkisiz denemeleri
        await env.withSecurityRulesDisabled(c => setDoc(ref(c.firestore(), 'requests', 'r_new'), { ...SEED.requests[2], id: 'r_new' }));
        const st = dbs.staff();
        await assertFails(updateDoc(ref(st, 'requests', 'r_new'), { durum: 'approved' }));
        await assertFails(updateDoc(ref(st, 'requests', 'r_new'), { durum: 'rejected' }));
        await assertFails(updateDoc(ref(st, 'requests', 'r_new'), { durum: 'completed' }));
        await assertFails(setDoc(ref(st, 'b3', 'fake'), { id: 'fake', tip: 'zimmet', requestId: 'r_new', personelId: 's1', adet: 1 }));
        await assertFails(updateDoc(ref(st, 'requests', 'r_dem'), { iadeEdildi: true }));
        await assertFails(updateDoc(ref(st, 'requests', 'r_rej'), { redGerekcesi: 'değiştirildi' }));
        await assertFails(updateDoc(ref(st, 'requests', 'r_new'), { redGerekcesi: 'kendime not' }));
        const st2 = dbs.staff(), retId = log.find(w => w.col === 'returnRequests' && w.kind === 'set').id;
        await env.withSecurityRulesDisabled(c => setDoc(ref(c.firestore(), 'returnRequests', 'ret_x'), { id: 'ret_x', durum: 'Beklemede', personelUid: 'uid-s1', zimmetId: 'x' }));
        await assertFails(updateDoc(ref(st2, 'returnRequests', 'ret_x'), { durum: 'approved', teslimAlindi: false, stogaEklendi: false, adminCihazDurumu: 'Sağlam', kapanisAciklamasi: 'kendim', onaylayan: 'Ayşe' }));
        await assertFails(updateDoc(ref(st2, 'returnRequests', 'ret_x'), { durum: 'rejected', redGerekcesi: 'x', reddeden: 'Ayşe' }));
        await assertFails(deleteDoc(ref(st2, 'returnRequests', retId)));
        ok('Kural: personel kendi iade talebini onaylayamaz / reddedemez / kaydı silemez');
        ok('Kural: personel kendi talebini onaylayamaz / reddedemez / onaysız teslim alamaz / zimmet yazamaz / iade işaretleyemez / red gerekçesini değiştiremez');
    } finally { await env.cleanup(); }
    console.log(report.join('\n'));
    console.log(`Ekran görüntüleri: ${OUT}`);
})().catch(e => { console.error(e); process.exit(1); });
