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
import { doc, collection, getDoc, getDocs, setDoc, updateDoc, runTransaction, setLogLevel } from 'firebase/firestore';

setLogLevel('silent');
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROOT = 'inventory_demo';
const ADMIN_EMAIL = 'admin@medipol.local';

const ctx = vm.createContext({ window: { data: {} }, console });
for (const f of ['src/utils/schema.js', 'src/services/staff-provisioning.js', 'src/utils/ownership.js']) {
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
