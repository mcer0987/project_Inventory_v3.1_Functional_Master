// Faz 4B · J9 (GPT-6 kural 1–2) — Sahiplik Göç Aracı'nın Firestore EMÜLATÖRÜNE karşı uçtan uca doğrulaması: gerçek
// runTransaction'lar, üretim kuralları (firestore.rules), yönetici ve personel oturumları. Plan/uygulama mantığı tarayıcıdakinin
// aynısıdır (schema.js + staff-provisioning.js + ownership.js vm ile yüklenir); Firestore bağdaştırıcısı firebase-handler'daki
// _ownershipStore'un npm 'firebase' karşılığıdır.
// Usage: npm run test:ownership:emu   (firebase emulators:exec içinde)
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, deleteField, serverTimestamp, runTransaction, writeBatch, setLogLevel } from 'firebase/firestore';

setLogLevel('silent');
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROOT = 'inventory_demo';
const ADMIN_EMAIL = 'admin@medipol.local';

const ctx = vm.createContext({ window: { data: {} }, console });
for (const f of ['src/utils/schema.js', 'src/services/staff-provisioning.js', 'src/utils/ownership.js', 'src/services/atomic-writer.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT_DIR, f), 'utf8'), ctx, { filename: f });
}
const O = ctx.window.Ownership, SP = ctx.window.StaffProvisioning;
const plain = x => JSON.parse(JSON.stringify(x));

let env;
const adminDb = () => env.authenticatedContext('admin-uid', { email: ADMIN_EMAIL, firebase: { sign_in_provider: 'password' } }).firestore();
const staffDb = () => env.authenticatedContext('uid-ayse', { email: SP.staffEmail('p_ayse'), firebase: { sign_in_provider: 'password' } }).firestore();
const ref = (db, col, id) => doc(db, ROOT, col, 'items', String(id).replace(/\//g, '_'));

// firebase-handler._ownershipStore ile aynı sözleşme
function store(db, { fault } = {}) {
    let n = 0;
    return {
        async readAll(col) { const s = await getDocs(collection(db, ROOT, col, 'items')); return s.docs.map(d => ({ id: d.id, data: d.data() })); },
        transaction(fn) {
            const k = n++;
            if (fault && fault(k)) return Promise.reject(Object.assign(new Error(`enjekte: bağlantı koptu (tx #${k})`), { code: 'unavailable' }));
            return runTransaction(db, t => fn({
                async get(col, id) { const sn = await t.get(ref(db, col, id)); return sn.exists() ? { id: sn.id, ...sn.data() } : null; },
                // vm bölgesinde üretilen nesne Firestore SDK'sına "düz nesne değil" görünür (tarayıcıda tek bölge, sorun yok)
                update(col, id, patch) { t.update(ref(db, col, id), structuredClone(patch)); },
            }));
        },
    };
}
async function readCol(db, col) { const s = await getDocs(collection(db, ROOT, col, 'items')); return s.docs.map(d => ({ id: d.id, ...d.data() })); }
async function plan(db) {
    const [requests, purchaseOrders, tasks, workflowTemplates, personel] = await Promise.all(['requests', 'purchaseOrders', 'tasks', 'workflowTemplates', 'personel'].map(c => readCol(db, c)));
    return O.planMigration({ data: { requests, purchaseOrders, tasks, workflowTemplates }, personel, accountEmail: SP.accountEmailOf });
}
const get = async (col, id) => (await getDoc(ref(adminDb(), col, id))).data();

// J10 PRI: hesap e-postası PRI adresi (burada PRI = id); kurallar personeli staffAccounts/{uid} eşlemesiyle tanır
const acc = (id, name, code, uid) => ({ id, name, code, uid, pri: id, authEmail: SP.staffEmail(id) });
const SEED = {
    personel: [acc('p_ayse', 'Ayşe Yılmaz', 'ayse1', 'uid-ayse'), acc('p_ali1', 'Ali Veli', 'aliv1', 'uid-ali1'), acc('p_ali2', 'ALİ VELİ', 'aliv2', 'uid-ali2'),
        { id: 'p_can', name: 'Can Demir', code: 'can01' }, acc('p_seher', 'Seher Kaya', '00000', 'uid-seher')],
    requests: [
        ...Array.from({ length: 6 }, (_, i) => ({ id: `r${i}`, personelId: 'p_ayse', personel: 'Ayşe Yılmaz', ürün: `Ürün ${i}`, durum: 'Beklemede' })),
        { id: 'r_code', personelKodu: '00000', personel: 'Seher Kaya', ürün: 'Kodla açılmış eski talep' },
        { id: 'r_amb', personel: 'Ali Veli', ürün: 'Belirsiz ad' },
        { id: 'r_noacc', personel: 'Can Demir', ürün: 'Hesapsız personel' },
    ],
    purchaseOrders: [{ id: 'po1', createdBy: '00000', createdByName: 'Seher Kaya', talepEden: 'Seher Kaya', urun: 'Toner',
        workflow: { started: true, currentStep: 1, steps: [{ user: 'Ayşe Yılmaz', status: 'approved', note: 'ok' }, { user: 'Ali Veli', status: 'pending' }] } }],
    tasks: [{ id: 't1', title: 'Görev', creatorId: 'Admin', assigneeId: 'Seher Kaya' }, { id: 't2', title: 'Görev 2', creatorId: 'Ayşe Yılmaz', assigneeId: 'pool' }],
    workflowTemplates: [{ id: 'w1', name: 'Şablon', steps: [{ user: 'Seher Kaya', tip: 'Paraf' }, { user: 'Sistem', tip: 'Bilgi' }] }],
    staffAccounts: [{ id: 'uid-ayse', personelId: 'p_ayse', pri: 'p_ayse' }],
    // J11 · P0: bu dosyanın J9 senaryoları kilit AÇIKKEN (göç sonrası düzeltmeler) koşar; kilidin kendisi en alttaki testlerde.
    accessGate: [{ id: 'staff', staffAccessEnabled: true }],
};

before(async () => {
    env = await initializeTestEnvironment({ projectId: 'demo-ownership', firestore: { rules: fs.readFileSync(path.join(ROOT_DIR, 'firestore.rules'), 'utf8') } });
});
after(async () => { if (env) await env.cleanup(); });
beforeEach(async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async c => {
        const db = c.firestore();
        for (const [col, docs] of Object.entries(SEED)) for (const d of docs) await setDoc(ref(db, col, d.id), d);
    });
});

test('emülatör: önizleme yazmaz; uygulama yalnız kesin eşlenen BOŞ alanlara uid yazar; tekrar çalıştırma 0 kayıt', async () => {
    const db = adminDb();
    const p = plain(await plan(db));
    assert.deepEqual(plain(await get('requests', 'r0')), SEED.requests[0], 'önizleme sonrası kayıt aynen');
    assert.deepEqual(p.items.map(i => `${i.col}/${i.id}`).sort(), ['purchaseOrders/po1', 'requests/r0', 'requests/r1', 'requests/r2', 'requests/r3',
        'requests/r4', 'requests/r5', 'requests/r_code', 'tasks/t1', 'tasks/t2', 'workflowTemplates/w1']);
    assert.deepEqual(p.issues.map(i => `${i.id}:${i.field}:${i.status}`).sort(), [
        'po1:steps[1].userUid:ambiguous', 'r_amb:personelUid:ambiguous', 'r_noacc:personelUid:no-account',
        't1:creatorUid:system', 'w1:steps[1].userUid:system']);

    const res = plain(await O.applyMigration({ plan: p, store: store(db), accountEmail: SP.accountEmailOf, chunkSize: 3 }));
    assert.equal(res.status, 'done');
    assert.equal(res.written.length, p.items.length);
    assert.equal((await get('requests', 'r0')).personelUid, 'uid-ayse');
    assert.equal((await get('requests', 'r0')).ürün, 'Ürün 0');
    assert.equal((await get('requests', 'r_code')).personelUid, 'uid-seher', 'eski giriş koduyla açılmış talep');
    assert.equal((await get('requests', 'r_amb')).personelUid, undefined, 'belirsiz ad eşlenmedi');
    assert.equal((await get('requests', 'r_noacc')).personelUid, undefined);
    const po = await get('purchaseOrders', 'po1');
    assert.equal(po.createdByUid, 'uid-seher');
    assert.deepEqual(po.workflow.steps, [{ user: 'Ayşe Yılmaz', status: 'approved', note: 'ok', userUid: 'uid-ayse' }, { user: 'Ali Veli', status: 'pending' }]);
    assert.equal(po.workflow.currentStep, 1);
    const t1 = await get('tasks', 't1');
    assert.equal(t1.creatorUid, undefined, '"Admin" adıyla oluşturulan göreve sahte uid yazılmadı');
    assert.equal(t1.assigneeUid, 'uid-seher');
    assert.deepEqual((await get('workflowTemplates', 'w1')).steps.map(s => s.userUid ?? null), ['uid-seher', null], 'sistem adımına uid yok');
    assert.equal((await plan(db)).items.length, 0, 'idempotent');
});

test('emülatör: önizleme ile uygulama arasında değişen kayıt yazılmaz (changed-since-preview)', async () => {
    const db = adminDb();
    const p = await plan(db);
    await updateDoc(ref(adminDb(), 'requests', 'r1'), { personelId: 'p_seher', personel: 'Seher Kaya' });   // başka bir oturum sahibini değiştirdi
    const res = plain(await O.applyMigration({ plan: p, store: store(db), accountEmail: SP.accountEmailOf }));
    assert.equal(res.status, 'done');
    assert.deepEqual(res.skipped, [{ col: 'requests', id: 'r1', reason: 'changed-since-preview' }]);
    assert.equal((await get('requests', 'r1')).personelUid, undefined);
    const again = plain(await plan(db));
    assert.deepEqual(again.items.map(i => i.id), ['r1'], 'yeniden önizleme güncel sahibi gösterir');
    assert.equal(again.items[0].patch.personelUid, 'uid-seher');
});

test('emülatör: personel listesi önizlemeden sonra değişti → hiçbir şey yazılmaz', async () => {
    const db = adminDb();
    const p = await plan(db);
    await setDoc(ref(adminDb(), 'personel', 'p_ayse2'), { id: 'p_ayse2', name: 'ayşe yılmaz' });   // J10: kodsuz   // aynı adlı yeni personel
    const res = plain(await O.applyMigration({ plan: p, store: store(db), accountEmail: SP.accountEmailOf }));
    assert.equal(res.status, 'aborted');
    assert.equal(res.error.code, 'personel-changed');
    for (const r of SEED.requests) assert.equal((await get('requests', r.id)).personelUid, undefined);
});

test('emülatör: kısmi hata (2. parça düşer) gizlenmez; yazılanlar kalıcı, kalanlar yazılmadı; yeniden koşu tamamlar', async () => {
    const db = adminDb();
    const p = await plan(db);
    const res = plain(await O.applyMigration({ plan: p, store: store(db, { fault: k => k === 1 }), accountEmail: SP.accountEmailOf, chunkSize: 3 }));
    assert.equal(res.status, 'stopped');
    assert.equal(res.written.length, 3);
    assert.equal(res.failed.length, 3);
    assert.equal(res.notAttempted, p.items.length - 6);
    for (const w of res.written) assert.ok((await get(w.col, w.id))[O.OWNER_FIELDS[w.col]] || w.col === 'workflowTemplates', `${w.col}/${w.id} yazıldı`);
    for (const f of res.failed) assert.equal((await get(f.col, f.id))[O.OWNER_FIELDS[f.col]], undefined, `${f.col}/${f.id} yazılmadı`);
    const rest = plain(await O.applyMigration({ plan: await plan(db), store: store(db), accountEmail: SP.accountEmailOf }));
    assert.equal(rest.status, 'done');
    assert.equal(rest.written.length, p.items.length - 3);
    assert.equal((await plan(db)).items.length, 0);
});

test('emülatör + üretim kuralları: personel oturumu göçü çalıştıramaz (kurallar ilk yazımı reddeder), hiçbir şey yazılmaz', async () => {
    const p = await plan(adminDb());
    const res = plain(await O.applyMigration({ plan: p, store: store(staffDb()), accountEmail: SP.accountEmailOf }));
    assert.equal(res.status, 'stopped');
    assert.equal(res.error.code, 'permission-denied');
    assert.equal(res.written.length, 0);
    assert.equal((await get('requests', 'r0')).personelUid, undefined);
});

test('emülatör + üretim kuralları: göçten sonra sahiplik alanı personel tarafından değiştirilemez ve silinemez', async () => {
    const db = adminDb();
    await O.applyMigration({ plan: await plan(db), store: store(db), accountEmail: SP.accountEmailOf });
    const s = staffDb();
    await assert.rejects(updateDoc(ref(s, 'requests', 'r0'), { personelUid: 'uid-baska' }), e => /PERMISSION_DENIED|permission/i.test(e.code + e.message));
    await assert.rejects(setDoc(ref(s, 'requests', 'r0'), { id: 'r0', ürün: 'ezme' }), e => /PERMISSION_DENIED|permission/i.test(e.code + e.message));
    await updateDoc(ref(s, 'requests', 'r0'), { durum: 'draft' });   // sahipliğe dokunmayan güncelleme serbest
    assert.equal((await get('requests', 'r0')).personelUid, 'uid-ayse');
    assert.equal((await get('requests', 'r0')).durum, 'draft');
});

// ─── J11 · P0: personel erişim kilidi — kapanış denetimi uçtan uca (üretim kuralları) ───────────────────────────────────
// firebase-handler.verifyStaffAccessClosure ile aynı sözleşme: altı koleksiyon sunucudan okunur, Ownership.planStaffAccessClosure.
async function closure(db) {
    const [personel, requests, purchaseOrders, tasks, workflowTemplates, staffAccounts] = await Promise.all(
        ['personel', 'requests', 'purchaseOrders', 'tasks', 'workflowTemplates', 'staffAccounts'].map(c => readCol(db, c)));
    return plain(O.planStaffAccessClosure({ data: { requests, purchaseOrders, tasks, workflowTemplates }, personel, staffAccounts, accountEmail: SP.accountEmailOf }));
}
const gatePayload = checks => ({ staffAccessEnabled: true, changedAt: serverTimestamp(), changedBy: 'admin-uid', reason: 'J11', closure: checks, version: 1 });
const denied = e => /PERMISSION_DENIED|permission/i.test(e.code + e.message);

test('J11 · P0: kilit yokken personel okuyamaz; tohum verisinde denetim kapanmamış her adımı sayar; kurallar bu kanıtla açmayı reddeder', async () => {
    await env.withSecurityRulesDisabled(c => deleteDoc(ref(c.firestore(), 'accessGate', 'staff')));
    await assert.rejects(getDoc(ref(staffDb(), 'requests', 'r0')), denied);
    await assert.rejects(getDocs(collection(staffDb(), ROOT, 'personel', 'items')), denied);
    const v = await closure(adminDb());   // yönetici kilit kapalıyken her şeyi okur
    assert.equal(v.ready, false);
    assert.deepEqual(v.checks, {
        personelCodes: 5, requestCodes: 1, purchaseOrderCodes: 1, accountsMissing: 1, accountsInconsistent: 0,
        accountMapMismatch: 3, ownershipPending: 11, ownershipUnresolved: 2,
    });
    assert.deepEqual(v.details.ownershipUnresolved.map(s => s.split(' · ')[1]).sort(), ['Belirsiz ad', 'Hesapsız personel']);
    assert.ok(!/ayse1|aliv1|aliv2|can01|00000/.test(JSON.stringify(v)), 'rapor giriş kodu içermez');
    await assert.rejects(setDoc(ref(adminDb(), 'accessGate', 'staff'), gatePayload(v.checks)), denied);
    await assert.rejects(getDoc(ref(staffDb(), 'requests', 'r0')), denied);
});

test('J11 · P0: göçün üç adımı bitince kapanış doğrulanır → kilit kanıtla açılır → personel okur; geri gelen tek kod denetimi yeniden kapatır', async () => {
    await env.withSecurityRulesDisabled(c => deleteDoc(ref(c.firestore(), 'accessGate', 'staff')));
    const db = adminDb();
    // 1) PRI / Hesap göçü (hesapları bu testte Auth yok; göç aracının yazdığı bağ + eşleme) ve belirsiz adın düzeltilmesi
    await updateDoc(ref(db, 'personel', 'p_can'), { uid: 'uid-can', pri: 'p_can', authEmail: SP.staffEmail('p_can') });
    await updateDoc(ref(db, 'personel', 'p_ali2'), { name: 'Ali Veli İkinci' });
    for (const [uid, pid] of [['uid-ali1', 'p_ali1'], ['uid-ali2', 'p_ali2'], ['uid-seher', 'p_seher'], ['uid-can', 'p_can']]) {
        await setDoc(ref(db, 'staffAccounts', uid), { personelId: pid, pri: pid });
    }
    assert.equal((await closure(db)).ready, false, 'sahiplik ve kodlar daha kapanmadı');
    // 2) Sahiplik göçü
    const own = await O.applyMigration({ plan: await plan(db), store: store(db), accountEmail: SP.accountEmailOf });
    assert.equal(own.status, 'done');
    // 3) Kod temizliği (firebase-handler.applyCodeCleanse ile aynı yazmalar)
    const [personel, requests, purchaseOrders] = await Promise.all(['personel', 'requests', 'purchaseOrders'].map(c => readCol(db, c)));
    const cc = O.planCodeCleanse({ personel, requests, purchaseOrders, accountEmail: SP.accountEmailOf });
    assert.equal(cc.ready, true);
    for (const x of cc.personel) await updateDoc(ref(db, 'personel', x.id), { code: deleteField() });
    for (const x of cc.requests) await updateDoc(ref(db, 'requests', x.id), { personelKodu: deleteField() });
    for (const x of cc.purchaseOrders) await updateDoc(ref(db, 'purchaseOrders', x.id), { createdBy: x.replaceWith });

    const v = await closure(db);
    assert.equal(v.ready, true, JSON.stringify(v.checks));
    assert.ok(v.warningCount >= 0);
    await assert.rejects(getDoc(ref(staffDb(), 'requests', 'r0')), denied, 'doğrulandı ama kilit henüz açılmadı');
    await setDoc(ref(db, 'accessGate', 'staff'), gatePayload(v.checks));
    assert.equal((await getDoc(ref(staffDb(), 'requests', 'r0'))).data().personelUid, 'uid-ayse');
    assert.ok((await getDocs(collection(staffDb(), ROOT, 'personel', 'items'))).docs.every(d => !('code' in d.data())), 'personel artık kodsuz listeyi okur');

    // Yedekten / elle bir kod kopyası geri gelirse yeniden denetim kapanmamış sayar (openStaffAccess yazmaz)
    await setDoc(ref(db, 'requests', 'r_back'), { id: 'r_back', personel: 'Ayşe Yılmaz', personelKodu: 'ayse1', personelUid: 'uid-ayse', ürün: 'Yedekten' });
    const again = await closure(db);
    assert.equal(again.ready, false);
    assert.equal(again.checks.requestCodes, 1);
});

// ─── J11 · P1 #4: kod temizliği — sıra, hepsi-ya-da-hiçbiri, yeniden çalıştırma (gerçek Firestore + üretim kuralları) ──────
// firebase-handler.applyCodeCleanse ile AYNI yol: Ownership.planCodeCleanse (taze veri) → Ownership.codeCleanseEntries (sıra:
// purchaseOrders → requests → personel.code EN SON) → AtomicWriter.run. Küçük parça sınırıyla günlüklü (çok parçalı) yol zorlanır.
const AW = ctx.window.AtomicWriter;
// Bu realm'de çalışan store (vm realm'inde kurulan nesneler Firestore SDK'sına "düz nesne değil" görünür → structuredClone).
function awStore(db, fault) {
    let n = 0;
    const r = (col, id) => doc(db, ROOT, col, 'items', String(id).replace(/\//g, '_'));
    return {
        async readCollection(col) { const sn = await getDocs(collection(db, ROOT, col, 'items')); return sn.docs.map(d => ({ id: d.id, data: d.data() })); },
        async readDoc(col, id) { const sn = await getDoc(r(col, id)); return sn.exists() ? sn.data() : null; },
        async commit(writes) {
            const f = fault ? fault(n++, writes) : null;
            if (f === 'before') throw Object.assign(new Error('enjekte: bağlantı koptu (commit gönderilmedi)'), { code: 'unavailable' });
            const b = writeBatch(db);
            writes.forEach(w => {
                const data = w.data === undefined ? undefined : structuredClone(w.data);
                if (w.kind === 'delete') b.delete(r(w.col, w.id)); else if (w.kind === 'merge') b.set(r(w.col, w.id), data, { merge: true }); else b.set(r(w.col, w.id), data);
            });
            await b.commit();
            if (f === 'after') throw Object.assign(new Error('enjekte: commit uygulandı, yanıt kayboldu'), { code: 'deadline-exceeded' });
        },
        encode: v => JSON.parse(JSON.stringify(v)), decode: v => v,
    };
}
async function freshCleansePlan(db) {
    const [personel, requests, purchaseOrders, tasks, workflowTemplates] = await Promise.all(['personel', 'requests', 'purchaseOrders', 'tasks', 'workflowTemplates'].map(c => readCol(db, c)));
    const own = O.planMigration({ data: { requests, purchaseOrders, tasks, workflowTemplates }, personel, accountEmail: SP.accountEmailOf });
    const plan = O.planCodeCleanse({ personel, requests, purchaseOrders, accountEmail: SP.accountEmailOf, ownershipPendingItems: own.items.length, ownershipIssues: own.issues });
    const rows = {};
    for (const c of ['personel', 'requests', 'purchaseOrders']) rows[c] = (await getDocs(collection(db, ROOT, c, 'items'))).docs.map(d => ({ id: d.id, data: d.data() }));
    return { plan, rows };
}
const SMALL = { maxOps: 3, maxBytes: 8 * 1024 * 1024, partChars: 300 * 1024 };   // parça başına 2 girdi → 4 girdi = 2 veri parçası
async function cleanseSeed(extra = {}) {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async c => {
        const db = c.firestore();
        const put = (col, d) => setDoc(ref(db, col, d.id), d);
        await put('personel', acc('p_a', 'Ayşe Yılmaz', 'aaa11', 'uid-a'));
        await put('personel', acc('p_b', 'Bora Kaya', 'bbb22', 'uid-b'));
        await put('requests', { id: 'r1', ürün: 'Mouse', personel: 'Ayşe Yılmaz', personelId: 'p_a', personelKodu: 'aaa11', personelUid: 'uid-a' });
        await put('purchaseOrders', { id: 'po1', urun: 'Toner', createdBy: 'bbb22', createdByName: 'Bora Kaya', talepEden: 'Bora Kaya', createdByUid: 'uid-b' });
        await put('accessGate', { id: 'staff', staffAccessEnabled: true });
        for (const [col, docs] of Object.entries(extra)) for (const d of docs) await put(col, d);
    });
}
const state = async db => ({
    po1: (await getDoc(ref(db, 'purchaseOrders', 'po1'))).data(),
    r1: (await getDoc(ref(db, 'requests', 'r1'))).data(),
    codes: (await readCol(db, 'personel')).map(p => p.code ?? null).sort(),
    sys: (await readCol(db, 'system_config')).map(d => d.id).filter(id => id.startsWith('bulk_write_journal')),
    lock: ((await getDoc(ref(db, 'system_config', 'admin_settings'))).data() || {}).restoreLock ?? null,
});
// firebase-handler.applyCodeCleanse ile aynı iki aşama: 1) geri alınabilir dönüşümler AtomicWriter (hepsi ya da hiçbiri),
// 2) personel.code EN SON, ileri yönlü + idempotent (Ownership.deleteCodesForward; deleteField ile).
async function runCleanse(db, plan, rows, { faultA, faultB, chunkSize = 400 } = {}) {
    const steps = O.codeCleanseSteps(plan, rows);
    const a = await AW.run({ store: awStore(db, faultA), kind: 'codeCleanse', collections: ['requests', 'purchaseOrders'],
        uid: 'admin-uid', entries: plain(steps.reversible), limits: SMALL, sleep: async () => {} });
    let n = 0;
    const del = await O.deleteCodesForward({ ids: plain(steps.codeIds), chunkSize, commit: async ids => {
        const f = faultB ? faultB(n++) : null;
        if (f === 'before') throw Object.assign(new Error('enjekte: bağlantı koptu'), { code: 'unavailable' });
        const b = writeBatch(db);
        ids.forEach(id => b.update(ref(db, 'personel', id), { code: deleteField() }));
        await b.commit();
        if (f === 'after') throw Object.assign(new Error('enjekte: yanıt kayboldu'), { code: 'deadline-exceeded' });
    } });
    return { a, del: plain(del), steps };
}
const extraReq = { requests: [{ id: 'r3', ürün: 'Klavye', personel: 'Ayşe Yılmaz', personelId: 'p_a', personelKodu: 'aaa11', personelUid: 'uid-a' }] };

for (const mode of ['before', 'after']) {
    test(`J11 · P1 #4 KABUL (aşama 1): ikinci dönüşüm parçası düşerse (${mode === 'before' ? 'commit gönderilmeden' : 'commit uygulanıp yanıt kaybolunca'}) hepsi geri alınır, kodlar silinmez; yeniden çalıştırma tamamlar, createdBy kaybolmaz`, async () => {
        await cleanseSeed(extraReq);
        const db = adminDb();
        const { plan, rows } = await freshCleansePlan(db);
        assert.equal(plan.ready, true, JSON.stringify(plan.blockers));
        const steps = O.codeCleanseSteps(plan, rows);
        assert.deepEqual(plain(steps.reversible.map(e => e.col)), ['purchaseOrders', 'requests', 'requests'], 'önce eski kimlik dönüşümü');
        assert.deepEqual(plain(steps.codeIds).sort(), ['p_a', 'p_b'], 'kodlar ayrı ve son aşamada');
        // commit sırası: 0 günlük başlığı + kilit, 1 günlük parçaları, 2 veri parçası #1 (po1 + r1), 3 veri parçası #2 (r3)
        await assert.rejects(runCleanse(db, plan, rows, { faultA: n => (n === 3 ? mode : null) }), e => e.code === 'rolled-back');
        const after = await state(db);
        assert.equal(after.po1.createdBy, 'bbb22', 'createdBy geri alındı — ham kod duruyor, sonraki koşu çözebilir');
        assert.equal(after.r1.personelKodu, 'aaa11');
        assert.equal((await getDoc(ref(db, 'requests', 'r3'))).data().personelKodu, 'aaa11');
        assert.deepEqual(after.codes, ['aaa11', 'bbb22'], 'kod silme aşamasına hiç geçilmedi');
        assert.deepEqual([after.sys, after.lock], [[], null], 'günlük ve kilit temizlendi');

        const again = await freshCleansePlan(db);
        assert.equal(again.plan.fingerprint, plan.fingerprint, 'geri alınan durum önizlemeyle aynı');
        const res = await runCleanse(db, again.plan, again.rows);
        assert.equal(res.a.status, 'committed');
        assert.deepEqual([res.del.deleted, res.del.remaining, res.del.error], [2, 0, null]);
        const done = await state(db);
        assert.equal(done.po1.createdBy, 'p_b', 'createdBy doğru personel id\'sine çözüldü (unknown DEĞİL)');
        assert.equal(done.po1.createdByUid, 'uid-b', 'sahiplik alanına dokunulmadı');
        assert.ok(!('personelKodu' in done.r1));
        assert.deepEqual(done.codes, [null, null]);
        const third = (await freshCleansePlan(db)).plan;
        assert.deepEqual([third.total, third.ready], [0, true], 'üçüncü koşu: yapılacak iş yok (idempotent)');
    });

    test(`J11 · P1 #4 (aşama 2): kod silme yarıda kalırsa (${mode}) dönüşümler kalıcı ve doğru, ilerleme gerçek değeriyle raporlanır; yeniden çalıştırma kalanı siler`, async () => {
        await cleanseSeed();
        const db = adminDb();
        const { plan, rows } = await freshCleansePlan(db);
        const res = await runCleanse(db, plan, rows, { chunkSize: 1, faultB: n => (n === 1 ? mode : null) });
        assert.equal(res.a.status, 'committed');
        assert.equal(res.del.deleted, 1, 'yalnız onaylanan parça sayılır');
        assert.equal(res.del.error.code, mode === 'before' ? 'unavailable' : 'deadline-exceeded', 'hata gizlenmez');
        const mid = await state(db);
        assert.equal(mid.po1.createdBy, 'p_b', 'eski kimlik dönüşümü tamam — kod silinse de bilgi kaybolmadı');
        assert.equal(mid.codes.filter(Boolean).length, mode === 'before' ? 1 : 0, 'sunucudaki gerçek kalan (yanıtı kaybolan parça uygulanmış olabilir)');
        const again = await freshCleansePlan(db);
        assert.equal(again.plan.ready, true);
        assert.deepEqual([again.plan.purchaseOrders.length, again.plan.requests.length], [0, 0], 'dönüşümler tekrar yapılmaz');
        await runCleanse(db, again.plan, again.rows);
        assert.deepEqual((await state(db)).codes, [null, null]);
        assert.equal((await freshCleansePlan(db)).plan.total, 0);
    });
}

test('J11 · P1 #4: ESKİ HATANIN bıraktığı yarım durum (kodlar silinmiş, createdBy dönüşmemiş) artık otomatik "unknown" yapılmaz — engel olarak raporlanır, hiçbir şey yazılmaz', async () => {
    await cleanseSeed();
    await env.withSecurityRulesDisabled(async c => {
        const db = c.firestore();
        for (const id of ['p_a', 'p_b']) await updateDoc(ref(db, 'personel', id), { code: deleteField() });
    });
    const db = adminDb();
    const { plan } = await freshCleansePlan(db);
    assert.equal(plan.ready, false);
    assert.deepEqual(plain(plan.purchaseOrders), [], 'otomatik çözüm yok');
    assert.deepEqual(plain(plan.blockers.purchaseOrderUnresolved.map(x => x.id)), ['po1']);
    assert.match(plan.blockers.purchaseOrderUnresolved[0].reason, /bulunamadı/);
    assert.equal((await getDoc(ref(db, 'purchaseOrders', 'po1'))).data().createdBy, 'bbb22', 'ham değer yerinde (yönetici elle çözer)');
});

test('J11 · P1 #4: çözülemeyen sahiplik (sahipsiz talep) varken plan hazır DEĞİL; sahipliği çözülünce hazır olur', async () => {
    await cleanseSeed({ requests: [{ id: 'r2', ürün: 'Sahipsiz', personel: 'Hiç Kimse' }] });
    const db = adminDb();
    const p1 = (await freshCleansePlan(db)).plan;
    assert.equal(p1.ready, false);
    assert.equal(p1.blockers.ownershipUnresolved.length, 1);
    await updateDoc(ref(db, 'requests', 'r2'), { personel: 'Ayşe Yılmaz', personelUid: 'uid-a' });   // yönetici elle düzeltti
    const p2 = (await freshCleansePlan(db)).plan;
    assert.equal(p2.ready, true, JSON.stringify(p2.blockers));
});

test('J11 · P1 #4: önizlemeden sonra veri değişirse (eşzamanlı yönetici) fingerprint farklıdır — applyCodeCleanse hiçbir şey yazmadan durur', async () => {
    await cleanseSeed();
    const db = adminDb();
    const { plan } = await freshCleansePlan(db);
    await updateDoc(ref(adminDb(), 'requests', 'r1'), { personelKodu: deleteField() });   // başka bir yönetici sekmesi
    const fresh = (await freshCleansePlan(db)).plan;
    assert.notEqual(fresh.fingerprint, plan.fingerprint);
});

test('J11 · P1 #4: personel oturumu kod temizliği yazamaz (kurallar) — hiçbir veri değişmez', async () => {
    await cleanseSeed();
    const { plan, rows } = await freshCleansePlan(adminDb());
    const s = env.authenticatedContext('uid-a', { email: SP.staffEmail('p_a'), firebase: { sign_in_provider: 'password' } }).firestore();
    await assert.rejects(runCleanse(s, plan, rows));
    const st = await state(adminDb());
    assert.deepEqual(st.codes, ['aaa11', 'bbb22']);
    assert.equal(st.po1.createdBy, 'bbb22');
});
