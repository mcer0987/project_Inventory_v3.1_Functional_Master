// v3.3 · Aşama 2 — Stok defterinin (src/services/stock-ledger.js) Firestore EMÜLATÖRÜNE karşı uçtan uca doğrulaması:
// GERÇEK runTransaction, ÜRETİM kuralları (firestore.rules) altında admin oturumu. Kapsam (Denetim P1-01 / P1-02 kabul ölçütleri):
//   - transfer: taze stok, raf sayaçları, işlem kaydı tek commit'te;
//   - kapasite aşımı / katalog dışı raf → hiçbir şey yazılmaz (rollback);
//   - aynı operationId ile tekrar → ikinci stok/slot değişikliği yok;
//   - eşzamanlı iki istemci: son boş slota iki yerleştirme → kapasite aşılmaz; aynı kaynaktan iki transfer → toplam stok korunur;
//   - kapasite kaydı: kullanımın altına inilemez;
//   - kurallar: doğrudan sayaç/kapasite ihlali ve sahte işlem kaydı reddedilir.
// Motor tarayıcıdaki dosyanın aynısıdır (aynı realm'de yüklenir; CDN modülü yerine npm 'firebase' fonksiyonları verilir).
// Usage: npm run test:ledger:emu   (firebase emulators:exec içinde)
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, collection, getDoc, getDocs, getDocsFromServer, setDoc, updateDoc, deleteDoc, runTransaction, writeBatch, serverTimestamp, setLogLevel } from 'firebase/firestore';

setLogLevel('silent');
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROOT = 'inventory_demo';
const ADMIN_EMAIL = 'admin@medipol.local';
const ADMIN_UID = 'admin-uid';

globalThis.window = globalThis.window || {};
for (const f of ['src/utils/schema.js', 'src/services/stock-ledger.js']) {
    vm.runInThisContext(fs.readFileSync(path.join(ROOT_DIR, f), 'utf8'), { filename: f });
}
const L = globalThis.window.StockLedger;
const S = globalThis.window.Schema;

let env;
const adminDb = () => env.authenticatedContext(ADMIN_UID, { email: ADMIN_EMAIL, firebase: { sign_in_provider: 'password' } }).firestore();
const ref = (db, col, id) => doc(db, ROOT, col, 'items', id);
const deps = db => ({
    db, root: ROOT, uid: ADMIN_UID,
    fns: { runTransaction, doc, getDoc, serverTimestamp, getDocsFromServer, collection, writeBatch },
    countUsage: async (depot, code) => S.computeUsedSlots((await getDocs(collection(db, ROOT, depot, 'items'))).docs.map(d => d.data()), code),
});
const read = async (col, id) => { let v; await env.withSecurityRulesDisabled(async c => { const s = await getDoc(ref(c.firestore(), col, id)); v = s.exists() ? s.data() : null; }); return v; };
const all = async col => { let v; await env.withSecurityRulesDisabled(async c => { v = (await getDocs(collection(c.firestore(), ROOT, col, 'items'))).docs.map(d => ({ id: d.id, ...d.data() })); }); return v; };
const seed = fn => env.withSecurityRulesDisabled(async c => fn(c.firestore()));

const item = (id, extra = {}) => ({
    id, sütun: 'B1 -A', raf: 'Raf-A 1', tür: 'Kablo', ürün: `Ürün ${id}`, marka: 'X', adet: 10,
    durumu: 'Kullanıma Hazır', açıklama: '', isDemirbas: false, lastUpdate: 1, ...extra,
});
const shelfDoc = (depot, code, capacity, usedSlots, active = true) => ({ code, depot, capacity, usedSlots, active, updatedAt: new Date(0), updatedBy: ADMIN_UID });
const transfer = (extra = {}) => ({
    operationId: L.newOperationId(), sourceCol: 'b1', sourceId: 'p1', targetCol: 'b2', qty: 10, targetShelf: 'Raf-1', targetColumn: 'Saha-1', ...extra,
});
const rejectsCode = (p, code) => assert.rejects(p, e => { assert.equal(e.code, code, `${e.code}: ${e.message}`); return true; });

before(async () => {
    env = await initializeTestEnvironment({
        projectId: 'demo-stock-ledger',
        firestore: { rules: fs.readFileSync(path.join(ROOT_DIR, 'firestore.rules'), 'utf8') },
    });
});
after(async () => { if (env) await env.cleanup(); });
beforeEach(async () => {
    await env.clearFirestore();
    await seed(async db => {
        await setDoc(ref(db, 'b1', 'p1'), item('p1'));
        await setDoc(ref(db, 'b1', 'p2'), item('p2', { adet: 3 }));
        await setDoc(ref(db, 'b1', 'p3'), item('p3', { adet: 2, raf: 'Raf-A 2' }));
        await setDoc(ref(db, 'shelves', 'b1_RAF-A 1'), shelfDoc('b1', 'RAF-A 1', 5, 2));
        await setDoc(ref(db, 'shelves', 'b1_RAF-A 2'), shelfDoc('b1', 'RAF-A 2', 5, 1));
        await setDoc(ref(db, 'shelves', 'b2_RAF-1'), shelfDoc('b2', 'RAF-1', 5, 0));
        await setDoc(ref(db, 'system_config', 'admin_settings'), { maintenance: false });
    });
});

// ─── Transaction ──────────────────────────────────────────────────────────────────────────────────────────────────

test('emülatör: tam depo transferi — ürün taşınır, iki raf sayacı ve işlem kaydı aynı commit\'te', async () => {
    const t = transfer();
    const r = await L.runTransfer(deps(adminDb()), t);
    assert.equal(r.duplicate, false);
    assert.equal(r.fullMove, true);
    assert.equal(await read('b1', 'p1'), null);
    const moved = await read('b2', 'p1');
    assert.equal(moved.adet, 10);
    assert.equal(moved.raf, 'Raf-1');
    assert.equal(moved.status, 'Kullanıma Hazır');
    assert.equal((await read('shelves', 'b1_RAF-A 1')).usedSlots, 1);
    assert.equal((await read('shelves', 'b2_RAF-1')).usedSlots, 1);
    const op = await read('stockOperations', t.operationId);
    assert.equal(op.stockBefore, 10);
    assert.equal(op.stockAfter, 0);
    assert.equal(op.uid, ADMIN_UID);
});

test('emülatör: kısmi transfer sunucudaki TAZE adetle hesaplanır (istemci kopyası bayat olsa bile)', async () => {
    await seed(db => updateDoc(ref(db, 'b1', 'p1'), { adet: 7 }));   // istemci hâlâ 10 sanıyor
    const r = await L.runTransfer(deps(adminDb()), transfer({ qty: 4 }));
    assert.equal(r.stockBefore, 7);
    assert.equal((await read('b1', 'p1')).adet, 3);
    assert.equal((await read('b2', r.targetId)).adet, 4);
    assert.equal((await read('shelves', 'b1_RAF-A 1')).usedSlots, 2, 'kaynak rafında kayıt pozitif kalır');
    assert.equal((await read('shelves', 'b2_RAF-1')).usedSlots, 1);
});

test('emülatör: hedef raf dolu → shelf-full ve HİÇBİR ŞEY yazılmaz', async () => {
    await seed(db => updateDoc(ref(db, 'shelves', 'b2_RAF-1'), { usedSlots: 5 }));
    const t = transfer();
    await rejectsCode(L.runTransfer(deps(adminDb()), t), 'shelf-full');
    assert.equal((await read('b1', 'p1')).adet, 10);
    assert.deepEqual(await all('b2'), []);
    assert.equal((await read('shelves', 'b1_RAF-A 1')).usedSlots, 2);
    assert.equal((await read('shelves', 'b2_RAF-1')).usedSlots, 5);
    assert.equal(await read('stockOperations', t.operationId), null);
});

test('emülatör: katalog dışı / pasif hedef raf → shelf-missing / shelf-inactive, yazma yok', async () => {
    await rejectsCode(L.runTransfer(deps(adminDb()), transfer({ targetShelf: 'Raf-2' })), 'shelf-missing');
    await seed(db => updateDoc(ref(db, 'shelves', 'b2_RAF-1'), { active: false }));
    await rejectsCode(L.runTransfer(deps(adminDb()), transfer()), 'shelf-inactive');
    assert.equal((await read('b1', 'p1')).adet, 10);
    assert.deepEqual(await all('stockOperations'), []);
});

test('emülatör: aynı operationId ile tekrar → duplicate, stok ve slot İKİNCİ kez değişmez', async () => {
    const t = transfer({ qty: 4 });
    const first = await L.runTransfer(deps(adminDb()), t);
    const second = await L.runTransfer(deps(adminDb()), t);       // ör. yanıtı kaybolan isteğin yeniden gönderimi
    assert.equal(first.duplicate, false);
    assert.equal(second.duplicate, true);
    assert.equal(second.targetId, first.targetId);
    assert.equal((await read('b1', 'p1')).adet, 6);
    assert.equal((await all('b2')).length, 1, 'ikinci hedef kayıt oluşmadı');
    assert.equal((await read('shelves', 'b2_RAF-1')).usedSlots, 1);
    await rejectsCode(L.runTransfer(deps(adminDb()), { ...t, qty: 2 }), 'operation-conflict');
    assert.equal((await read('b1', 'p1')).adet, 6);
});

test('emülatör: EŞZAMANLI — son boş slota iki istemciden yerleştirme → yalnız biri tamamlanır, kapasite aşılmaz', async () => {
    await seed(db => updateDoc(ref(db, 'shelves', 'b2_RAF-1'), { usedSlots: 4 }));
    const results = await Promise.allSettled([
        L.runTransfer(deps(adminDb()), transfer({ sourceId: 'p1', qty: 10 })),
        L.runTransfer(deps(adminDb()), transfer({ sourceId: 'p2', qty: 3 })),
    ]);
    const ok = results.filter(r => r.status === 'fulfilled');
    const bad = results.filter(r => r.status === 'rejected');
    assert.equal(ok.length, 1, JSON.stringify(results.map(r => r.status === 'rejected' ? r.reason.code : 'ok')));
    assert.equal(bad[0].reason.code, 'shelf-full');
    assert.equal((await read('shelves', 'b2_RAF-1')).usedSlots, 5);
    assert.equal((await all('b2')).length, 1);
    const b1Total = (await all('b1')).reduce((n, p) => n + p.adet, 0);
    const b2Total = (await all('b2')).reduce((n, p) => n + p.adet, 0);
    assert.equal(b1Total + b2Total, 10 + 3 + 2, 'toplam stok korunur');
});

test('emülatör: EŞZAMANLI — aynı kaynaktan iki kısmi transfer (6+6 > 10) → biri yetersiz stok; toplam korunur, eksi yok', async () => {
    const results = await Promise.allSettled([
        L.runTransfer(deps(adminDb()), transfer({ qty: 6 })),
        L.runTransfer(deps(adminDb()), transfer({ qty: 6 })),
    ]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(results.find(r => r.status === 'rejected').reason.code, 'insufficient-stock');
    const src = await read('b1', 'p1');
    assert.equal(src.adet, 4);
    const b2 = await all('b2');
    assert.equal(b2.reduce((n, p) => n + p.adet, 0), 6);
    assert.equal(src.adet + b2.reduce((n, p) => n + p.adet, 0), 10, 'toplam stok korunur');
    assert.equal((await read('shelves', 'b2_RAF-1')).usedSlots, 1);
});

test('emülatör: aynı depoda başka rafa tam taşıma — kimlik korunur, −1/+1', async () => {
    const r = await L.runTransfer(deps(adminDb()), transfer({ sourceId: 'p3', targetCol: 'b1', targetShelf: 'Raf-A 1', qty: 2 }));
    assert.equal(r.targetId, 'p3');
    assert.equal((await read('b1', 'p3')).raf, 'Raf-A 1');
    assert.equal((await read('shelves', 'b1_RAF-A 2')).usedSlots, 0);
    assert.equal((await read('shelves', 'b1_RAF-A 1')).usedSlots, 3);
});

// ─── Raf kapasitesi ───────────────────────────────────────────────────────────────────────────────────────────────

test('emülatör: yeni raf kaydı güncel kullanımı sunucudan sayar; kapasite kullanımın altına inemez', async () => {
    await seed(async db => {
        await setDoc(ref(db, 'b1', 'p4'), item('p4', { raf: 'raf-b 1' }));
        await setDoc(ref(db, 'b1', 'p5'), item('p5', { raf: 'Raf-B 1' }));
        await setDoc(ref(db, 'b1', 'p6'), item('p6', { raf: 'Raf-B 1', adet: 0 }));
    });
    await rejectsCode(L.saveShelf(deps(adminDb()), { depot: 'b1', code: 'Raf-B 1', capacity: 1 }), 'capacity-below-usage');
    const created = await L.saveShelf(deps(adminDb()), { depot: 'b1', code: 'Raf-B 1', capacity: 4 });
    assert.equal(created.created, true);
    assert.equal(created.usedSlots, 2, 'yazım farkları aynı raf, tükenmiş kayıt slot değil');
    const doc1 = await read('shelves', 'b1_RAF-B 1');
    assert.equal(doc1.capacity, 4);
    assert.deepEqual(S.validateShelfDoc({ ...doc1, updatedAt: 1 }, { id: 'b1_RAF-B 1' }), []);
    await rejectsCode(L.saveShelf(deps(adminDb()), { depot: 'b1', code: 'RAF-B 1', capacity: 1 }), 'capacity-below-usage');
    const raised = await L.saveShelf(deps(adminDb()), { depot: 'b1', code: 'RAF-B 1', capacity: 12 });
    assert.equal(raised.created, false);
    assert.equal((await read('shelves', 'b1_RAF-B 1')).capacity, 12);
});

// ─── Kurallar (doğrudan yazma) ────────────────────────────────────────────────────────────────────────────────────

test('kurallar: admin bile doğrudan yazmayla slot sayacını kapasitenin üstüne çıkaramaz, kapasiteyi kullanımın altına indiremez', async () => {
    const db = adminDb();
    await assertFails(updateDoc(ref(db, 'shelves', 'b1_RAF-A 1'), { usedSlots: 6, updatedAt: serverTimestamp(), updatedBy: ADMIN_UID }));
    await assertFails(updateDoc(ref(db, 'shelves', 'b1_RAF-A 1'), { capacity: 1, updatedAt: serverTimestamp(), updatedBy: ADMIN_UID }));
    await assertSucceeds(updateDoc(ref(db, 'shelves', 'b1_RAF-A 1'), { usedSlots: 5, updatedAt: serverTimestamp(), updatedBy: ADMIN_UID }));
    await assertFails(updateDoc(ref(db, 'shelves', 'b1_RAF-A 1'), { code: 'RAF-A 9', updatedAt: serverTimestamp(), updatedBy: ADMIN_UID }));
    await assertFails(updateDoc(ref(db, 'shelves', 'b1_RAF-A 1'), { usedSlots: 1, updatedAt: new Date(), updatedBy: ADMIN_UID }), 'istemci saati reddedilir');
    await assertFails(updateDoc(ref(db, 'shelves', 'b1_RAF-A 1'), { usedSlots: 1, updatedAt: serverTimestamp(), updatedBy: 'baskasi' }));
    await assertFails(deleteDoc(ref(db, 'shelves', 'b1_RAF-A 1')), 'dolu raf silinemez');
});

test('kurallar: raf belgesi kimliği ve şeması (depo_KOD, kanonik kod, fazla alan, kapasite sınırı)', async () => {
    const db = adminDb();
    const ok = { code: 'RAF-C 1', depot: 'b1', capacity: 5, usedSlots: 0, active: true, updatedAt: serverTimestamp(), updatedBy: ADMIN_UID };
    await assertSucceeds(setDoc(ref(db, 'shelves', 'b1_RAF-C 1'), ok));
    await assertFails(setDoc(ref(db, 'shelves', 'b2_RAF-C 2'), { ...ok, code: 'RAF-C 2' }), 'kimlikteki depo belgeyle uyuşmuyor');
    await assertFails(setDoc(ref(db, 'shelves', 'b1_raf-c 3'), { ...ok, code: 'raf-c 3' }), 'kanonik olmayan kod');
    await assertFails(setDoc(ref(db, 'shelves', 'b1_RAF-C 4'), { ...ok, code: 'RAF-C 4', not: 'x' }), 'fazla alan');
    await assertFails(setDoc(ref(db, 'shelves', 'b1_RAF-C 5'), { ...ok, code: 'RAF-C 5', capacity: 201 }));
    await assertFails(setDoc(ref(db, 'shelves', 'b3_RAF-C 6'), { ...ok, code: 'RAF-C 6', depot: 'b3' }));
    const other = env.authenticatedContext('other-uid', { email: 'someone@medipol.local', firebase: { sign_in_provider: 'password' } }).firestore();
    await assertFails(setDoc(ref(other, 'shelves', 'b1_RAF-C 7'), { ...ok, code: 'RAF-C 7', updatedBy: 'other-uid' }), 'admin olmayan yazamaz');
    await assertFails(getDoc(ref(env.unauthenticatedContext().firestore(), 'shelves', 'b1_RAF-A 1')), 'oturumsuz okuyamaz');
});

test('kurallar: işlem kaydı değiştirilemez/silinemez; gerçek sonuçla uyuşmayan sahte kayıt reddedilir', async () => {
    const t = transfer({ qty: 4 });
    await L.runTransfer(deps(adminDb()), t);
    const db = adminDb();
    await assertFails(updateDoc(ref(db, 'stockOperations', t.operationId), { qty: 1 }));
    await assertFails(deleteDoc(ref(db, 'stockOperations', t.operationId)));
    // Stok değişmeden "transfer oldu" kaydı (kaynak adedi stockAfter değil) → getAfter çapraz denetimi reddeder.
    await assertFails(setDoc(ref(db, 'stockOperations', 'op_forged_0001'), {
        id: 'op_forged_0001', kind: 'transfer', sourceCol: 'b1', sourceId: 'p2', targetCol: 'b2', targetId: 'p1-yok',
        targetShelfId: 'b2_RAF-1', qty: 1, fullMove: false, stockBefore: 3, stockAfter: 2, shelves: [],
        uid: ADMIN_UID, ts: serverTimestamp(),
    }));
    assert.equal(await read('stockOperations', 'op_forged_0001'), null);
});

// ─── runProductSave (v3.3 Aşama 4 · saveProduct transaction'a bağlanması) ───────────────────────────────────────────

test('emülatör: yeni ürün — hedef raf katalogda olmasa da yazılır (geçiş dönemi); katalogdaysa sayaç +1', async () => {
    const r1 = await L.runProductSave(deps(adminDb()), { col: 'b1', id: 'b1_new1', isNew: true, fields: item('b1_new1', { raf: 'Raf-C 1' }) });
    assert.equal(r1.created, true);
    assert.deepEqual(r1.shelves, []);
    assert.equal((await read('b1', 'b1_new1')).adet, 10);
    assert.equal(await read('shelves', 'b1_RAF-C 1'), null, 'katalogda olmayan raf için belge oluşturulmaz');

    const r2 = await L.runProductSave(deps(adminDb()), { col: 'b1', id: 'b1_new2', isNew: true, fields: item('b1_new2', { raf: 'Raf-A 1' }) });
    assert.deepEqual(r2.shelves, [{ id: 'b1_RAF-A 1', before: 2, after: 3 }]);
    assert.equal((await read('shelves', 'b1_RAF-A 1')).usedSlots, 3);
});

test('emülatör: yeni ürün — hedef raf katalogda VE doluysa shelf-full, hiçbir şey yazılmaz', async () => {
    await seed(db => updateDoc(ref(db, 'shelves', 'b1_RAF-A 1'), { usedSlots: 5 }));
    await rejectsCode(L.runProductSave(deps(adminDb()), { col: 'b1', id: 'b1_new3', isNew: true, fields: item('b1_new3', { raf: 'Raf-A 1' }) }), 'shelf-full');
    assert.equal(await read('b1', 'b1_new3'), null);
    assert.equal((await read('shelves', 'b1_RAF-A 1')).usedSlots, 5);
});

test('emülatör: ürün düzenleme — TAZE sunucu belgesine göre raf taşır (kaynak −1, hedef +1), yalnız değişen alan yazılır', async () => {
    const before = await read('b1', 'p1');
    const r = await L.runProductSave(deps(adminDb()), { col: 'b1', id: 'p1', isNew: false, fields: { raf: 'Raf-A 2' } });
    assert.deepEqual(r.shelves.sort((a, b) => a.id.localeCompare(b.id)), [
        { id: 'b1_RAF-A 1', before: 2, after: 1 }, { id: 'b1_RAF-A 2', before: 1, after: 2 },
    ]);
    const after = await read('b1', 'p1');
    assert.equal(after.raf, 'Raf-A 2');
    assert.equal(after.ürün, before.ürün, 'raf dışındaki alanlar dokunulmadan kalır');
    assert.equal((await read('shelves', 'b1_RAF-A 1')).usedSlots, 1);
    assert.equal((await read('shelves', 'b1_RAF-A 2')).usedSlots, 2);
});

test('emülatör: ürün düzenleme — hedef raf (katalogda) dolu ise reddedilir ve ürün yerinde kalır', async () => {
    await seed(db => updateDoc(ref(db, 'shelves', 'b1_RAF-A 2'), { usedSlots: 5 }));
    await rejectsCode(L.runProductSave(deps(adminDb()), { col: 'b1', id: 'p1', isNew: false, fields: { raf: 'Raf-A 2' } }), 'shelf-full');
    assert.equal((await read('b1', 'p1')).raf, 'Raf-A 1');
    assert.equal((await read('shelves', 'b1_RAF-A 1')).usedSlots, 2);
});

test('emülatör: ürün düzenleme — EŞZAMANLI iki admin aynı ürünü farklı (BOŞ) raflara taşır; sayaçlar tutarlı kalır', async () => {
    // pX tek başına Raf-D 1'de; hedefler Raf-E 1 / Raf-F 1 de başka hiçbir kaydın olmadığı BOŞ raflar — böylece
    // "ürün tam olarak bir rafta sayılır" değişmezi başka kayıtların katkısıyla karışmaz (bkz. ilk deneme: p1'in
    // paylaştığı Raf-A 1/Raf-A 2'de p2/p3 da vardı; toplamın 1 olması YANLIŞ bir varsayımdı, kod değil test hatalıydı).
    await seed(async db => {
        await setDoc(ref(db, 'b1', 'pX'), item('pX', { raf: 'Raf-D 1' }));
        await setDoc(ref(db, 'shelves', 'b1_RAF-D 1'), shelfDoc('b1', 'RAF-D 1', 5, 1));
        await setDoc(ref(db, 'shelves', 'b1_RAF-E 1'), shelfDoc('b1', 'RAF-E 1', 5, 0));
        await setDoc(ref(db, 'shelves', 'b1_RAF-F 1'), shelfDoc('b1', 'RAF-F 1', 5, 0));
    });
    const results = await Promise.allSettled([
        L.runProductSave(deps(adminDb()), { col: 'b1', id: 'pX', isNew: false, fields: { raf: 'Raf-E 1' } }),
        L.runProductSave(deps(adminDb()), { col: 'b1', id: 'pX', isNew: false, fields: { raf: 'Raf-F 1' } }),
    ]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 2, 'Firestore transaction çakışmayı kendi içinde yeniden dener (ikisi de sonunda başarılı)');
    const finalShelf = (await read('b1', 'pX')).raf;
    assert.ok(['Raf-E 1', 'Raf-F 1'].includes(finalShelf));
    const d1 = (await read('shelves', 'b1_RAF-D 1')).usedSlots;
    const e1 = (await read('shelves', 'b1_RAF-E 1')).usedSlots;
    const f1 = (await read('shelves', 'b1_RAF-F 1')).usedSlots;
    assert.equal(d1, 0, 'ürün Raf-D 1\'den ayrıldı');
    assert.equal(d1 + e1 + f1, 1, 'ürün tam olarak BİR rafta sayılır (çift sayım ya da kayıp yok)');
    assert.equal(finalShelf === 'Raf-E 1' ? e1 : f1, 1, 'sayaç ürünün GERÇEKTEN bulunduğu rafla eşleşir');
    assert.equal(finalShelf === 'Raf-E 1' ? f1 : e1, 0, 'retry edilen işlem kaybeden rafı doğru geri alır');
});

test('emülatör: ürün düzenleme — kayıt yoksa not-found; bilinmeyen/eski alan reddedilir', async () => {
    await rejectsCode(L.runProductSave(deps(adminDb()), { col: 'b1', id: 'b1_yok', isNew: false, fields: { adet: 1 } }), 'not-found');
    await rejectsCode(L.runProductSave(deps(adminDb()), { col: 'b1', id: 'p1', isNew: false, fields: { status: 'Pasif' } }), 'schema-violation');
    assert.equal((await read('b1', 'p1')).durumu, 'Kullanıma Hazır', 'reddedilen işlem hiçbir şey değiştirmez');
});

// ─── runShelfSync (v3.3 Aşama 6 · Veri Geçişi — raf sayaçları uzlaştırması) ──────────────────────────────────────────
// Admin-only denetimi runTransfer/runProductSave/saveShelfCapacity ile AYNI yerde (_ledgerPreflight, firebase-handler.js
// — CDN import'lu ES modülü, bu dosyada yüklenemez) ve ayrıca firestore.rules'ta (shelves yazma kuralı isAdmin()
// gerektirir — "kurallar: admin bile doğrudan yazmayla…" testiyle zaten kanıtlı). runShelfSync kendisi (diğer run*
// fonksiyonları gibi) yetki denetimi YAPMAZ; çağıranın (syncShelfCounters) ön koşulu sağladığını varsayar.

test('emülatör: varsayılan tohum zaten tutarlı — sync hiçbir şey yazmaz, hepsi unchanged', async () => {
    const r = await L.runShelfSync(deps(adminDb()));
    assert.equal(r.unchanged, 3);
    assert.deepEqual(r.updated, []);
    assert.deepEqual(r.capacityRaised, []);
    assert.deepEqual(r.unregistered, []);
    assert.deepEqual(r.pool, { b1: 0, b2: 0, total: 0 });
});

test('emülatör: sayım kataloktan SAPMIŞSA (kapasite içinde) gerçek Firestore belgesi düzeltilir', async () => {
    // p2 b1_RAF-A 1'den ayrıldı ama raf belgesi hâlâ usedSlots:2 diyor (ör. eski bir yazma yolundan kalma kayma).
    await seed(db => updateDoc(ref(db, 'b1', 'p2'), { raf: 'Raf-A 2' }));
    const r = await L.runShelfSync(deps(adminDb()));
    assert.deepEqual(r.updated.sort((a, b) => a.code.localeCompare(b.code)), [
        { id: 'b1_RAF-A 1', code: 'RAF-A 1', depot: 'b1', before: 2, after: 1 },
        { id: 'b1_RAF-A 2', code: 'RAF-A 2', depot: 'b1', before: 1, after: 2 },
    ]);
    assert.equal((await read('shelves', 'b1_RAF-A 1')).usedSlots, 1, 'gerçek Firestore belgesi yazıldı');
    assert.equal((await read('shelves', 'b1_RAF-A 2')).usedSlots, 2);
});

test('emülatör: üçüncü ürün eklenince (kapasite İÇİNDE kalarak) usedSlots artırılır — capacityRaised DEĞİL, updated', async () => {
    // b1_RAF-A 1 kapasitesi 5; 3. bir ürün ekleniyor (gerçek sayım 3, kapasiteyi AŞMIYOR).
    await seed(db => setDoc(ref(db, 'b1', 'p4'), item('p4', { raf: 'Raf-A 1' })));
    const r = await L.runShelfSync(deps(adminDb()));
    assert.deepEqual(r.updated, [{ id: 'b1_RAF-A 1', code: 'RAF-A 1', depot: 'b1', before: 2, after: 3 }]);
    assert.deepEqual(r.capacityRaised, []);
    const doc1 = await read('shelves', 'b1_RAF-A 1');
    assert.equal(doc1.usedSlots, 3);
    assert.equal(doc1.capacity, 5, 'kapasite zaten gerçek sayımdan büyüktü — değişmedi');
});

test('emülatör: kapasite GERÇEKTEN aşılmışsa (capacity < gerçek sayım) kural reddetmeden kapasite sayıma yükseltilir', async () => {
    await seed(db => updateDoc(ref(db, 'shelves', 'b1_RAF-A 1'), { capacity: 2 }));   // zaten usedSlots:2 = capacity:2
    await seed(db => setDoc(ref(db, 'b1', 'p4'), item('p4', { raf: 'Raf-A 1' })));     // gerçek sayım şimdi 3 > kapasite 2
    const r = await L.runShelfSync(deps(adminDb()));
    assert.deepEqual(r.capacityRaised, [{ id: 'b1_RAF-A 1', code: 'RAF-A 1', depot: 'b1', before: 2, capacityBefore: 2, after: 3 }]);
    const doc1 = await read('shelves', 'b1_RAF-A 1');
    assert.equal(doc1.usedSlots, 3);
    assert.equal(doc1.capacity, 3, 'kural usedSlots<=capacity gerektirdiği için kapasite otomatik 3\'e yükseltildi');
});

test('emülatör: tamamen boşalmış bir raf (gerçek sayım 0, usedSlots eski) DA düzeltilir', async () => {
    await seed(db => deleteDoc(ref(db, 'b1', 'p3')));   // b1_RAF-A 2'deki TEK ürün silindi
    const r = await L.runShelfSync(deps(adminDb()));
    assert.deepEqual(r.updated, [{ id: 'b1_RAF-A 2', code: 'RAF-A 2', depot: 'b1', before: 1, after: 0 }]);
    assert.equal((await read('shelves', 'b1_RAF-A 2')).usedSlots, 0);
});

test('emülatör: raf koduna sahip ürün var ama katalogda YOKSA — unregistered raporlanır, hiçbir şey yazılmaz, işlem durmaz', async () => {
    await seed(db => setDoc(ref(db, 'b1', 'p4'), item('p4', { raf: 'Eski Depo Rafı 9' })));
    const r = await L.runShelfSync(deps(adminDb()));
    assert.deepEqual(r.unregistered, [{ depot: 'b1', code: 'ESKI DEPO RAFI 9', count: 1 }]);
    assert.equal(r.unchanged, 3, 'kataloglu raflar etkilenmedi');
});

test('emülatör: rafsız (Havuz) ürünler sayılır ve raporlanır; hiçbir raf belgesine yazılmaz', async () => {
    await seed(db => setDoc(ref(db, 'b1', 'p4'), item('p4', { raf: '' })));
    await seed(db => setDoc(ref(db, 'b2', 'p5'), item('p5', { raf: '' })));
    const r = await L.runShelfSync(deps(adminDb()));
    assert.deepEqual(r.pool, { b1: 1, b2: 1, total: 2 });
    assert.equal(r.unchanged, 3);
});

test('kurallar: b1/b2 — yeni eski alan (b1 status) ve eksi/ondalık adet reddedilir; geri yükleme kilidi altında muaf', async () => {
    const db = adminDb();
    await assertFails(updateDoc(ref(db, 'b1', 'p1'), { status: 'Pasif' }), 'b1\'e status eklenemez (toplu pasife alma hatası sınıfı)');
    await assertSucceeds(updateDoc(ref(db, 'b1', 'p1'), { durumu: 'Pasif' }));
    await assertFails(updateDoc(ref(db, 'b1', 'p1'), { adet: -1 }));
    await assertFails(updateDoc(ref(db, 'b1', 'p1'), { adet: 1.5 }));
    await assertFails(setDoc(ref(db, 'b2', 'n1'), { ...item('n1'), name: 'eski ad' }));
    await assertSucceeds(updateDoc(ref(db, 'b1', 'p1'), { isWatched: true }));
    await seed(d => updateDoc(ref(d, 'system_config', 'admin_settings'), { restoreLock: { collections: ['b1'], owner: ADMIN_UID } }));
    await assertSucceeds(setDoc(ref(db, 'b1', 'legacy1'), { id: 'legacy1', name: 'Eski biçim', qty: '3' }), 'geri alma eski biçimi yazabilmeli');
});
