// v3.4 · personel (BT ekibi) çıkışı uçtan uca doğrulaması.
// 1) Tarayıcı: gerçek index.html + gerçek modüller (schema, exit-policy, person-picker, staff-guards, ui-components,
//    inventory-logic, script.js); yalnız Firebase katmanı (runExitTransaction / runStockOps) kayıt yakalayan saplamayla değişir.
// 2) Emülatör: arayüzün personel çıkışında ÜRETTİĞİ kayıt ve ürün yaması, personel kimliğiyle firestore.rules'a karşı yazılır
//    (istemci biçimi ile kural beklentisi birebir uyuşuyor mu). Demirbaş ve başka kişi adına denemeler reddedilmeli.
// Kullanım: npx firebase emulators:exec --config tests/rules/firebase.rules-test.json --only firestore --project demo-rules-test
//           "node scratch/staff-exit-ui.cjs <ekran-görüntüsü-klasörü>"
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), puppeteer = require('puppeteer');
const OUT = process.argv[2] || '.';
const SCRIPTS = ['src/utils/schema.js', 'src/utils/exit-policy.js', 'src/ui/person-picker.js', 'src/ui/staff-guards.js', 'src/ui/device-ids.js'];

const DATA = {
    b1: [
        { id: 'p_sarf', ürün: 'HP 85A Toner', tür: 'Sarf Malzeme', marka: 'HP', raf: 'Raf-A 1', sütun: 'B1 -A', adet: 10, durumu: 'Kullanıma Hazır' },
        { id: 'p_dem', ürün: 'Dell Latitude 5440', tür: 'Laptop', marka: 'Dell', raf: 'Raf-B 2', sütun: 'B1 -B', adet: 3, durumu: 'Kullanıma Hazır' },
    ],
    b2: [], b3: [], requests: [],
    personel: [
        { id: 's1', name: 'Ayşe Yılmaz', pri: 'ayse.yilmaz', uid: 'uid-s1', birim: 'Bilgi İşlem' },
        { id: 's2', name: 'Bora Kaya', pri: 'bora.kaya', uid: 'uid-s2', birim: 'Bilgi İşlem' },
        { id: 's3', name: 'Cem Demir', pri: 'cem.demir', active: false },
    ],
    productTypes: [{ id: 'pt_sarf', name: 'Sarf Malzeme', isDemirbas: false }, { id: 'pt_dem', name: 'Laptop', isDemirbas: true }],
};

async function openPage(browser, mode, width = 1280) {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setViewport({ width, height: 900 });
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
    await page.evaluate((mode, data) => {
        const me = mode === 'staff' ? { id: 's1', name: 'Ayşe Yılmaz' } : { id: 'adm', name: 'Sistem Yöneticisi' };
        window.data = data;
        window.userAuth = { uid: mode === 'staff' ? 'uid-s1' : 'admin-uid' };
        window.AppModules = { Session: { isStaffAccountSession: () => mode === 'staff' } };
        window.isDbAdmin = () => mode === 'admin';
        window.validateAdminAction = () => window.isDbAdmin();   // auth-engine ile aynı karar
        window.getActiveUser = () => me;
        window.canExitStock = () => window.isDbAdmin() || (!!window.userAuth && window.AppModules.Session.isStaffAccountSession());
        window.EXIT_STAFF_MESSAGE = 'personel-mesajı';
        window.alerts = []; window.showAppAlert = (m, t) => window.alerts.push([t, m]);
        window.escapeHtml = v => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
        window.jsArg = v => JSON.stringify(v).replaceAll('"', '&quot;');
        window.getTurkiyeSaati = () => '05.11.2026 10:00:00';
        window.bindActions = () => {};
        window.captured = [];
        const plan = (stock, writes, opts) => {
            if (opts && opts.staffExit) {
                const prepared = writes.map(w => ({ op: w.op, col: w.col, id: String(w.item.id), data: w.item }));
                const chk = window.ExitPolicy.checkStaffPlan(stock, prepared);
                if (!chk.ok) throw new Error(chk.error);
            }
            window.captured.push({ stock, writes: writes.map(w => w.item), opts: opts || null });
            return { stock: stock.map(s => ({ col: s.col, id: s.id, name: s.id, before: 10, after: 10 + s.delta, statusBefore: '', statusAfter: '' })), ids: [] };
        };
        window.runExitTransaction = async ({ repo, productId, qty, b3Entry, extraWrites = [] }, opts) =>
            plan([{ col: repo, id: productId, delta: -qty }], [{ op: 'set', col: 'b3', item: { ...b3Entry, productId } }, ...extraWrites], opts);
        window.runStockOps = async ({ stock, writes }, opts) => plan(stock, writes, opts);
        window.openProductModal = () => { window.productModalOpened = true; };
        document.body.classList.add('logged-in');
        document.getElementById('loginModal').style.setProperty('display', 'none', 'important');   // girişten sonraki durum
        document.querySelectorAll('body *').forEach(n => { if (getComputedStyle(n).position === 'fixed' && !n.closest('.modal')) n.style.display = 'none'; });
    }, mode, DATA);
    for (const s of SCRIPTS) await page.addScriptTag({ url: `http://127.0.0.1/${s}` });
    await page.addScriptTag({ type: 'module', url: 'http://127.0.0.1/src/ui/ui-components.js' });
    await page.addScriptTag({ type: 'module', url: 'http://127.0.0.1/src/modules/inventory-logic.js' });
    await page.waitForFunction(() => typeof window.openExitModal === 'function' && typeof window.saveExit === 'function');
    // v3.7: script.js'ten ayrıştırılan klasik dosyalar sayfalardaki sırayla script.js'ten hemen sonra yüklenir.
    for (const s of ['script.js', 'src/ui/stock-exit-cart.js']) await page.addScriptTag({ url: `http://127.0.0.1/${s}` });
    await page.evaluate(() => window.StaffGuards.refresh());
    return { page, errors };
}

const fillExit = (page, { sn = 'ITSM-4412', note = 'Yazıcı toneri bitti', qty = 2 } = {}) => page.evaluate((sn, note, qty) => {
    document.getElementById('exitQty').value = String(qty);
    document.getElementById('exitSn').value = sn;
    document.getElementById('exitNote').value = note;
}, sn, note, qty);
const submitExit = page => page.evaluate(() => window.saveExit(new Event('submit', { cancelable: true })));

(async () => {
    const browser = await puppeteer.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--no-sandbox'] });
    let staffCapture, adminCapture, cartCapture;
    try {
        // ── Personel: tekil çıkış ──
        const st = await openPage(browser, 'staff');
        await st.page.evaluate(() => { document.querySelectorAll('.tab-content').forEach(t => t.classList.toggle('active', t.id === 'b3')); window.openExitModal(); });
        let s = await st.page.evaluate(() => ({ note: document.getElementById('exitRoleNote').textContent, person: document.getElementById('exitPerson').value,
            ro: document.getElementById('exitPerson').readOnly, label: document.getElementById('exitSn').closest('label').textContent.replace(/\s+/g, ' ').trim() }));
        assert.match(s.note, /Sarf malzeme çıkışı yapabilirsiniz/); assert.equal(s.person, 'Ayşe Yılmaz'); assert.equal(s.ro, true); assert.match(s.label, /^ITSM \/ Gerekçe/);
        await st.page.type('#exitSearch', 'e');
        await st.page.evaluate(() => window.searchForExit());
        const locked = await st.page.$$eval('#productList .product-item', ns => ns.map(n => [n.querySelector('strong').textContent, !!n.querySelector('.exit-item-locked')]));
        assert.deepEqual(locked.find(x => x[0].startsWith('Dell'))[1], true);
        assert.deepEqual(locked.find(x => x[0].startsWith('HP'))[1], false);
        await st.page.screenshot({ path: path.join(OUT, 'staff-exit-search.png') });
        await st.page.evaluate(() => [...document.querySelectorAll('#productList .product-item')].find(n => n.textContent.includes('Dell')).click());
        assert.match((await st.page.evaluate(() => window.alerts.at(-1)[1])), /demirbaştır/);
        assert.equal(await st.page.evaluate(() => document.getElementById('selectedProduct').dataset.id || ''), '');
        await st.page.evaluate(() => window.selectProduct('HP 85A Toner', 'Sarf Malzeme', 'Raf-A 1', 10, 'b1', null, 'p_sarf'));
        await fillExit(st.page);
        await st.page.screenshot({ path: path.join(OUT, 'staff-exit-modal.png') });
        await submitExit(st.page);
        staffCapture = await st.page.evaluate(() => window.captured.at(-1));
        assert.equal(staffCapture.opts.staffExit, true);
        assert.deepEqual([staffCapture.writes[0].personelId, staffCapture.writes[0].alanKisi, staffCapture.writes[0].urunTuruId, staffCapture.writes[0].islemYapanUid, staffCapture.writes[0].isDemirbas],
            ['s1', 'Ayşe Yılmaz', 'pt_sarf', 'uid-s1', false]);
        // demirbaş satırından çıkış açılamaz
        await st.page.evaluate(() => { window.alerts = []; document.getElementById('exitModal').style.display = 'none'; window.openExitModal('b1', 'p_dem'); });
        assert.equal(await st.page.evaluate(() => document.getElementById('exitModal').style.display), 'none');

        // ── Personel: toplu çıkış (sarf) ──
        await st.page.evaluate(() => { window.openCartModal(); window.addToCart({ item: window.data.b1[0], repo: 'b1', qty: 10, isDemirbasStrict: false });
            document.getElementById('cartSn').value = 'ITSM-4413'; document.getElementById('cartNote').value = 'Toplu'; });
        assert.match(await st.page.evaluate(() => document.getElementById('cartSn').closest('label').textContent), /^ITSM \/ Gerekçe/);
        await st.page.evaluate(() => window.saveCartExit(new Event('submit', { cancelable: true })));
        cartCapture = await st.page.evaluate(() => window.captured.at(-1));
        assert.equal(cartCapture.opts.staffExit, true); assert.equal(cartCapture.writes[0].personelId, 's1');

        // ── Personel: depo salt-okunur + sağ tık / kısayol ──
        await st.page.evaluate(() => { document.getElementById('cartModal').style.display = 'none'; document.querySelectorAll('.tab-content').forEach(t => t.classList.toggle('active', t.id === 'b1')); window.alerts = []; });
        s = await st.page.evaluate(() => {
            document.querySelector('#uabB1 .uab-btn-primary').click();
            const cb = document.getElementById('selectAllB1'); cb.click();
            const ctx = new MouseEvent('contextmenu', { bubbles: true, cancelable: true }); document.getElementById('tableB1').dispatchEvent(ctx);
            const f12 = new KeyboardEvent('keydown', { key: 'F12', bubbles: true, cancelable: true }); document.dispatchEvent(f12);
            const devt = new KeyboardEvent('keydown', { key: 'I', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }); document.dispatchEvent(devt);
            const src = new KeyboardEvent('keydown', { key: 'u', ctrlKey: true, bubbles: true, cancelable: true }); document.dispatchEvent(src);
            const typing = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }); document.dispatchEvent(typing);
            return { opened: !!window.productModalOpened, checked: cb.checked, readonly: document.body.classList.contains('staff-readonly'),
                alert: (window.alerts[0] || [])[1] || '', ctx: ctx.defaultPrevented, f12: f12.defaultPrevented, devt: devt.defaultPrevented, src: src.defaultPrevented, typing: typing.defaultPrevented,
                aria: document.querySelector('#uabB1 .uab-btn-primary').getAttribute('aria-disabled') };
        });
        assert.deepEqual(s, { opened: false, checked: false, readonly: true, alert: s.alert, ctx: true, f12: true, devt: true, src: true, typing: false, aria: 'true' });
        assert.match(s.alert, /yalnız görüntülenebilir/);
        await st.page.screenshot({ path: path.join(OUT, 'staff-depot-readonly.png') });
        assert.deepEqual(st.errors, []);

        // ── Yönetici: alan kişi seçimi ──
        const ad = await openPage(browser, 'admin');
        await ad.page.evaluate(() => { document.querySelectorAll('.tab-content').forEach(t => t.classList.toggle('active', t.id === 'b3')); window.openExitModal(); });
        s = await ad.page.evaluate(() => ({ person: document.getElementById('exitPerson').value, ro: document.getElementById('exitPerson').readOnly, readonlyBody: document.body.classList.contains('staff-readonly') }));
        assert.deepEqual(s, { person: 'Sistem Yöneticisi', ro: false, readonlyBody: false });
        await ad.page.click('#exitPerson');
        await ad.page.keyboard.type('bor');
        const opts = await ad.page.$$eval('#exitPersonList [role=option] strong', ns => ns.map(n => n.textContent));
        assert.deepEqual(opts, ['Bora Kaya']);
        await ad.page.keyboard.type('a.k');   // "bora.k" → PRI ile arama
        assert.deepEqual(await ad.page.$$eval('#exitPersonList [role=option] strong', ns => ns.map(n => n.textContent)), ['Bora Kaya']);
        await ad.page.screenshot({ path: path.join(OUT, 'admin-person-picker.png') });
        await ad.page.keyboard.press('ArrowDown'); await ad.page.keyboard.press('Enter');
        assert.deepEqual(await ad.page.evaluate(() => [document.getElementById('exitPerson').value, document.getElementById('exitPersonId').value]), ['Bora Kaya', 's2']);
        // pasif personel listede yok
        await ad.page.evaluate(() => { const i = document.getElementById('exitPerson'); i.value = 'Cem'; i.dispatchEvent(new Event('input')); });
        assert.equal(await ad.page.$$eval('#exitPersonList [role=option]', ns => ns.length), 0);
        // listede olmayan ad yazılırsa gönderim durur
        await ad.page.evaluate(() => window.selectProduct('Dell Latitude 5440', 'Laptop', 'Raf-B 2', 3, 'b1', null, 'p_dem'));
        await ad.page.evaluate(() => { const i = document.getElementById('exitPerson'); i.value = 'Olmayan Kişi'; i.dispatchEvent(new Event('input')); });
        await fillExit(ad.page, { qty: 1 });
        await ad.page.evaluate(() => { document.querySelector('#exitDeviceIds input')?.setAttribute('value', ''); });
        await submitExit(ad.page);
        assert.match(await ad.page.evaluate(() => window.alerts.at(-1)[1]), /listeden seçin/);
        assert.equal(await ad.page.evaluate(() => window.captured.length), 0);
        // geçerli seçim → yönetici yolu (staffExit yok), kayıt seçilen kişiye
        await ad.page.evaluate(() => { document.getElementById('exitPerson')._personPick(window.data.personel[1]); window.selectProduct('HP 85A Toner', 'Sarf Malzeme', 'Raf-A 1', 10, 'b1', null, 'p_sarf'); });
        await fillExit(ad.page, { qty: 1 });
        await submitExit(ad.page);
        adminCapture = await ad.page.evaluate(() => window.captured.at(-1));
        assert.equal(adminCapture.opts, null);
        assert.deepEqual([adminCapture.writes[0].personelId, adminCapture.writes[0].alanKisi, adminCapture.writes[0].islemYapanUid], ['s2', 'Bora Kaya', 'admin-uid']);
        // yönetici depoda engellenmez
        s = await ad.page.evaluate(() => {
            document.getElementById('exitModal').style.display = 'none'; window.alerts = [];
            const btn = document.querySelector('#uabB1 .uab-btn-primary'); let reached = false;
            btn.addEventListener('click', () => { reached = true; });
            btn.click();
            return { reached, blocked: window.alerts.some(a => /yalnız görüntülenebilir/.test(a[1])), aria: btn.getAttribute('aria-disabled') };
        });
        assert.deepEqual(s, { reached: true, blocked: false, aria: null });
        assert.deepEqual(ad.errors, []);
    } finally { await browser.close(); }

    // ── Emülatör: arayüzün ürettiği personel kaydı kurallardan geçiyor mu ──
    if (!process.env.FIRESTORE_EMULATOR_HOST) { console.log('Emülatör yok: kural tekrarı atlandı.'); return; }
    const { initializeTestEnvironment, assertSucceeds, assertFails } = await import('@firebase/rules-unit-testing');
    const { doc, setDoc, writeBatch, setLogLevel } = await import('firebase/firestore');
    setLogLevel('silent');
    const env = await initializeTestEnvironment({ projectId: 'demo-staff-exit-ui', firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') } });
    const R = 'lifeserver_master';
    const ref = (db, col, id) => doc(db, R, col, 'items', String(id));
    try {
        await env.withSecurityRulesDisabled(async c => {
            const db = c.firestore();
            await setDoc(ref(db, 'personel', 's1'), { id: 's1', name: 'Ayşe Yılmaz', pri: 'ayse.yilmaz', uid: 'uid-s1' });
            await setDoc(ref(db, 'staffAccounts', 'uid-s1'), { personelId: 's1', pri: 'ayse.yilmaz' });
            await setDoc(ref(db, 'accessGate', 'staff'), { staffAccessEnabled: true });
            for (const t of DATA.productTypes) await setDoc(ref(db, 'productTypes', t.id), t);
            for (const p of DATA.b1) await setDoc(ref(db, 'b1', p.id), p);
        });
        const staffDb = () => env.authenticatedContext('uid-s1', { email: 'ayse.yilmaz@staff.medipol.local', firebase: { sign_in_provider: 'password' } }).firestore();
        const replay = (capture, mutate = e => e) => {
            const db = staffDb(), batch = writeBatch(db);
            capture.stock.forEach((s, i) => {
                const product = DATA.b1.find(p => p.id === s.id);
                const entry = mutate(capture.writes[i]);
                batch.update(ref(db, s.col, s.id), { adet: product.adet + s.delta, lastUpdate: Date.now(), sonCikisId: String(entry.id) });
                batch.set(ref(db, 'b3', entry.id), entry);
            });
            return batch.commit();
        };
        await assertSucceeds(replay(staffCapture));
        DATA.b1[0].adet -= 2;
        await assertSucceeds(replay({ ...cartCapture, writes: cartCapture.writes.map(w => ({ ...w, id: Number(w.id) + 1 })) }));
        DATA.b1[0].adet -= 1;
        await assertFails(replay(staffCapture, e => ({ ...e, id: e.id + 7, personelId: 's2', alanKisi: 'Bora Kaya' })));
        await assertFails(replay({ stock: [{ col: 'b1', id: 'p_dem', delta: -1 }], writes: [{ ...staffCapture.writes[0], id: staffCapture.writes[0].id + 9, productId: 'p_dem', adet: 1 }] }));
        // yönetici kaydını personel yazamaz (urunTuruId yok / başka kişi)
        await assertFails(replay(adminCapture));
        console.log('Kural tekrarı: arayüzün ürettiği personel tekil + toplu çıkışı GEÇTİ; başka kişi adına, demirbaş ve yönetici biçimli kayıt REDDEDİLDİ.');
    } finally { await env.cleanup(); }
    console.log('Personel çıkışı UI: rol notu, ITSM / Gerekçe, demirbaş kilidi, alan kişi (personel kilitli / yönetici aranabilir), toplu çıkış, depo salt-okunur, sağ tık + F12/Ctrl+Shift+I/Ctrl+U engeli. pageerror=0');
})().catch(e => { console.error(e); process.exit(1); });
