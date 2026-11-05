// Faz 5 denetimi · P0 — atomic-writer'ın Firestore EMÜLATÖRÜNE karşı uçtan uca doğrulaması: gerçek writeBatch'ler, gerçek
// 500 işlem sınırını aşan veri kümesi, üretim kuralları (firestore.rules) altında admin oturumu ve GERÇEK bir sunucu reddiyle
// (1 MiB'ı aşan doküman) ortadaki bir parçanın düşmesi. Motor ve Firestore bağdaştırıcısı tarayıcıdaki dosyanın aynısıdır
// (vm ile yüklenir; firebase-handler'ın CDN modülü yerine npm 'firebase' fonksiyonları verilir).
// Usage: npm run test:atomic:emu   (firebase emulators:exec içinde)
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, collection, getDoc, getDocs, setDoc, deleteDoc, writeBatch, runTransaction, serverTimestamp, Timestamp, setLogLevel } from 'firebase/firestore';

setLogLevel('silent');
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROOT = 'inventory_demo';
const ADMIN_EMAIL = 'admin@medipol.local';
const plain = x => JSON.parse(JSON.stringify(x));

// Aynı realm'de yüklenir (tarayıcıdaki gibi): Firestore SDK başka bir vm realm'inde kurulan nesneleri "özel nesne" sayıp reddeder.
globalThis.window = globalThis.window || {};
globalThis.window.data = globalThis.window.data || { productTypes: [] };
for (const f of ['src/utils/schema.js', 'src/utils/stock-import.js', 'src/services/atomic-writer.js']) {
    vm.runInThisContext(fs.readFileSync(path.join(ROOT_DIR, f), 'utf8'), { filename: f });
}
const W = globalThis.window.AtomicWriter;
const S = globalThis.window.Schema;
const I = globalThis.window.StockImport;
const fns = { doc, collection, getDoc, getDocs, writeBatch, Timestamp, runTransaction, serverTimestamp };

let env;
const adminDb = () => env.authenticatedContext('admin-uid', { email: ADMIN_EMAIL, firebase: { sign_in_provider: 'password' } }).firestore();
const anonDb = () => env.authenticatedContext('anon-uid', { firebase: { sign_in_provider: 'anonymous' } }).firestore();

// Gerçek store + hata enjeksiyonu: 'before' → commit sunucuya gönderilmez; 'after' → sunucuda uygulanır, istemci hata alır.
function store(db, fault) {
    const real = W.createFirestoreStore({ db, root: ROOT, fns });
    let n = 0;
    return {
        ...real,
        async commit(writes) {
            const f = fault ? fault(n++, writes) : null;
            if (f === 'before') throw Object.assign(new Error('enjekte: bağlantı yok'), { code: 'unavailable' });
            await real.commit(writes);
            if (f === 'after') throw Object.assign(new Error('enjekte: yanıt kayboldu'), { code: 'deadline-exceeded' });
        },
    };
}

async function snapshot(db, col) {
    const s = await getDocs(collection(db, ROOT, col, 'items'));
    return Object.fromEntries(s.docs.map(d => [d.id, d.data()]).sort(([a], [b]) => a.localeCompare(b)));
}
async function journalState(db) {
    const sys = await snapshot(db, 'system_config');
    return { journal: Object.keys(sys).filter(k => k.startsWith('bulk_write_journal')), lock: (sys.admin_settings || {}).restoreLock ?? null };
}

const N = 1200;   // > 500: tek batch'e sığmaz (varsayılan sınır 450 → 3 parça)
const seedB1 = Array.from({ length: N }, (_, i) => ({ id: `p${i}`, ürün: `Ürün ${i}`, adet: i % 7, ts: new Timestamp(1700000000 + i, 0) }));
// Hedef: ilk 300 aynı, 300–899 değişmiş, 900–1199 silinmiş, 400 yeni
const target = () => ({
    b1: [
        ...seedB1.slice(0, 300),
        ...seedB1.slice(300, 900).map(p => ({ ...p, adet: 99, not: 'yedekten' })),
        ...Array.from({ length: 400 }, (_, i) => ({ id: `n${i}`, ürün: `Yeni ${i}`, adet: 1 })),
    ],
});
const run = (st, tgt) => W.run({
    store: st, kind: 'restore', collections: ['b1'], uid: 'admin-uid', sleep: async () => {},
    entries: async s => W.planRestore({ target: tgt, server: await W.readCollections(s, ['b1']), makeId: () => 'gen' }),
});

before(async () => {
    env = await initializeTestEnvironment({
        projectId: 'demo-atomic-writer',
        firestore: { rules: fs.readFileSync(path.join(ROOT_DIR, 'firestore.rules'), 'utf8') },
    });
});
after(async () => { if (env) await env.cleanup(); });
beforeEach(async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async c => {
        const db = c.firestore();
        for (let i = 0; i < seedB1.length; i += 400) {
            const b = writeBatch(db);
            seedB1.slice(i, i + 400).forEach(p => b.set(doc(db, ROOT, 'b1', 'items', p.id), p));
            await b.commit();
        }
        await setDoc(doc(db, ROOT, 'system_config', 'items', 'admin_settings'), { maintenance: false });
    });
});

test('emülatör: 1200+ dokümanlık geri yükleme (çok parçalı, günlüklü) başarıyla tamamlanır', async () => {
    const db = adminDb();
    const r = plain(await run(store(db), target()));
    assert.equal(r.status, 'committed');
    assert.equal(r.journaled, true);
    assert.ok(r.chunks >= 3, `parça sayısı ${r.chunks}`);
    const after = await snapshot(db, 'b1');
    assert.equal(Object.keys(after).length, 300 + 600 + 400);
    assert.equal(after.p500.adet, 99);
    assert.ok(!('p1000' in after), 'yedekte olmayan silindi');
    assert.ok(after.p10.ts instanceof Timestamp, 'değişmeyen doküman yazılmadı (Timestamp türü korunur)');
    assert.deepEqual(await journalState(db), { journal: [], lock: null });
});

test('emülatör: GERÇEK sunucu reddi (ortadaki parçada 1 MiB üstü doküman) → yazılan parçalar geri alınır', async () => {
    const db = adminDb();
    const before = await snapshot(db, 'b1');
    const tgt = target();
    tgt.b1[1000] = { ...tgt.b1[1000], açıklama: "x".repeat(1100 * 1024) };   // 2. parçaya düşer (girdi 700); Firestore 1 MiB üstünü reddeder
    await assert.rejects(run(store(db), tgt), e => {
        assert.equal(e.code, 'rolled-back', e.message);
        assert.ok(e.details.chunk >= 1, `ilk parça yazılmış olmalıydı (düşen parça: ${e.details.chunk})`);
        return true;
    });
    const afterState = await snapshot(db, 'b1');
    assert.deepEqual(Object.keys(afterState), Object.keys(before), 'doküman kümesi işlem öncesiyle aynı');
    for (const id of Object.keys(before)) assert.deepEqual(afterState[id], before[id], `${id} işlem öncesi hâlinde`);
    assert.ok(afterState.p0.ts instanceof Timestamp && afterState.p400.ts instanceof Timestamp, 'geri alınan dokümanlarda Timestamp türü korunur');
    assert.deepEqual(await journalState(db), { journal: [], lock: null });
});

test('emülatör: yanıtı kaybolan commit (sunucuda uygulandı) → o parça da geri alınır', async () => {
    const db = adminDb();
    const before = await snapshot(db, 'b1');
    let data = 0;
    const st = store(db, (n, writes) => (writes.some(w => w.col === 'b1') && ++data === 2 ? 'after' : null));
    await assert.rejects(run(st, target()), e => e.code === 'rolled-back');
    assert.deepEqual(await snapshot(db, 'b1'), before);
    assert.deepEqual(await journalState(db), { journal: [], lock: null });
});

test('emülatör: 2 parça yazıldıktan sonra bağlantı tamamen koptu → kilitli kalır; yeni oturumda recover işlem öncesine döndürür', async () => {
    const db = adminDb();
    const before = await snapshot(db, 'b1');
    let data = 0, dead = false;
    const st = store(db, (n, writes) => {
        if (dead) return 'before';
        if (writes.some(w => w.col === 'b1') && ++data === 3) { dead = true; return 'before'; }
        return null;
    });
    await assert.rejects(W.run({
        store: st, kind: 'restore', collections: ['b1'], uid: 'admin-uid', sleep: async () => {}, retries: 1,
        entries: async s => W.planRestore({ target: target(), server: await W.readCollections(s, ['b1']), makeId: () => 'gen' }),
    }), e => e.code === 'rollback-pending');
    const mid = await journalState(db);
    assert.ok(mid.lock && mid.lock.id, 'kilit sunucuda');
    assert.ok(mid.journal.length >= 2, 'günlük sunucuda');
    assert.notDeepEqual(await snapshot(db, 'b1'), before, 'yarım veri var (kilit altında)');

    // "Yeni sekme / yeni oturum": taze bir bağlantıyla kurtarma
    const r = plain(await W.recover({ store: store(adminDb()), force: true, sleep: async () => {} }));
    assert.equal(r.status, 'rolled-back');
    assert.equal(r.journal.committedChunks, 2);
    assert.deepEqual(await snapshot(db, 'b1'), before);
    assert.deepEqual(await journalState(db), { journal: [], lock: null });
});

test('emülatör + üretim kuralları: yönetici olmayan oturum toplu yazmayı başlatamaz, hiçbir şey yazılmaz', async () => {
    const db = anonDb();
    const before = await snapshot(adminDb(), 'b1');
    // Aşama B (J10): anonim oturum günlüğü okurken bile reddedilir — yazmaya hiç başlanmaz
    await assert.rejects(run(store(db), target()), e => e.code === 'prepare-failed' || e.code === 'permission-denied');
    assert.deepEqual(await snapshot(adminDb(), 'b1'), before);
    assert.deepEqual(await journalState(adminDb()), { journal: [], lock: null });
});

// ─── v3.3 P1 · Excel içe aktarma: ürünler + yeni raflar + raf sayaçları tek iş, ÜRETİM KURALLARI altında ───────────────
// Akış firebase-handler.js atomicImportStock ile aynı: önizleme → entries(store) içinde taze raf belgeleriyle plan → run.
const SHELF_TS = new Timestamp(1700000000, 0);
const seedShelf = (code, capacity, usedSlots) => ({ code, depot: 'b1', capacity, usedSlots, active: true, updatedAt: SHELF_TS, updatedBy: 'eski-admin' });
async function seedShelves(list) {
    await env.withSecurityRulesDisabled(async c => {
        for (const s of list) await setDoc(doc(c.firestore(), ROOT, 'shelves', 'items', `b1_${s.code}`), s);
    });
}
let importSeq = 0;
async function importRows(db, st, rows, mutate) {
    const importData = rows.map(row => {
        const hasId = Object.keys(row).some(header =>
            I.FIELD_ALIASES.envanterNo.some(alias => I.headerKey(alias) === I.headerKey(header))
        );
        return !hasId && String(row.Ürün || '').trim()
            ? { ...row, 'Envanter No': `TEST-EMU-${importSeq++}` }
            : row;
    });
    const cached = Object.values(await snapshot(db, 'shelves')).filter(d => d.depot === 'b1');
    const built = I.buildStockRecords(importData, 'b1', {
        schema: S, makeId: () => 9000000 + (importSeq++), now: Date.now(),
        shelfCapacityInfo: new Map(cached.map(d => [d.code, { capacity: d.capacity, usedSlots: d.usedSlots, active: d.active }])),
    });
    assert.deepEqual(built.errors, []);
    if (mutate) mutate(built.records);
    let plan = null;
    const res = await W.run({
        store: st, kind: 'atomicImportStock', collections: ['b1'], uid: 'admin-uid', sleep: async () => {},
        entries: async s => {
            const p = I.planImportEntries({
                col: 'b1', records: built.records, requests: built.shelfRequests,
                shelfDocs: (await s.readCollection('shelves')).map(d => d.data), uid: 'admin-uid', serverTime: W.SERVER_TIME,
            });
            plan = p.plan;
            return p.entries;
        },
    });
    return { res, plan };
}
const rowsTo = (code, n, prefix) => Array.from({ length: n }, (_, i) => ({
    Ürün: `${prefix} ${i}`, Adet: '1', Raf: code, 'Envanter No': `TEST-EMU-${importSeq++}`,
}));

// v3.3 P1 ek (proje sahibinin talebi): buildStockRecords artık MAX_IMPORT_ROWS=200 üstünü reddeder (admin dahil aşılamaz;
// bkz. stock-import.js dosya başı [WHY]). Bu, gerçek atomicImportStock giriş noktasından 900 satırlık bir içe aktarmayı
// artık YAPISAL OLARAK İMKÂNSIZ kılar (kapsam dışı test — importRows kullanamaz). Ancak AtomicWriter'ın KENDİSİNİN büyük
// ölçekte (çok parçalı, günlüklü) raf+ürün geri alma mekaniği hâlâ genel bir motor yeteneğidir ve ayrıca kanıtlanmaya
// değer (planImportEntries/AtomicWriter.run ikilisi, satır sınırından BAĞIMSIZ). Bu yüzden aşağıdaki tek test
// buildStockRecords'u (ve onun 200 sınırını) atlayıp kanonik kayıtları DOĞRUDAN kurar.
async function importRawRecords(db, st, records, requests, mutate) {
    if (mutate) mutate(records);
    let plan = null;
    const res = await W.run({
        store: st, kind: 'atomicImportStock', collections: ['b1'], uid: 'admin-uid', sleep: async () => {},
        entries: async s => {
            const p = I.planImportEntries({
                col: 'b1', records, requests, shelfDocs: (await s.readCollection('shelves')).map(d => d.data), uid: 'admin-uid', serverTime: W.SERVER_TIME,
            });
            plan = p.plan;
            return p.entries;
        },
    });
    return { res, plan };
}
const canonRowsTo = (code, n, prefix) => Array.from({ length: n }, (_, i) =>
    S.toCanonicalStock({ id: `raw_${importSeq++}`, ürün: `${prefix} ${i}`, adet: 1, raf: code || '' }, 'b1', { now: Date.now() }));

test('emülatör + kurallar (P1): capacity=5/usedSlots=4 → 1. içe aktarma rafa (sayaç 5, sunucu saati), 2. içe aktarma Havuz\'a', async () => {
    await seedShelves([seedShelf('RAF-A', 5, 4)]);
    const db = adminDb();
    const first = await importRows(db, store(db), rowsTo('RAF-A', 1, 'İlk'));
    assert.equal(first.res.journaled, false);
    let shelves = await snapshot(db, 'shelves');
    assert.equal(shelves['b1_RAF-A'].usedSlots, 5);
    assert.equal(shelves['b1_RAF-A'].updatedBy, 'admin-uid');
    assert.ok(shelves['b1_RAF-A'].updatedAt instanceof Timestamp && shelves['b1_RAF-A'].updatedAt.seconds > SHELF_TS.seconds, 'serverTimestamp yazıldı');
    const afterFirst = shelves['b1_RAF-A'];

    const second = await importRows(db, store(db), rowsTo('RAF-A', 1, 'İkinci'));
    assert.equal(second.plan.records[0].raf, '');
    assert.equal(second.plan.poolOverflowCount, 1);
    shelves = await snapshot(db, 'shelves');
    assert.deepEqual(shelves['b1_RAF-A'], afterFirst, 'sayaç 5\'te kaldı, raf yeniden yazılmadı');
    const b1 = await snapshot(db, 'b1');
    assert.equal(b1[first.plan.records[0].id].raf, 'RAF-A');
    assert.equal(b1[second.plan.records[0].id].raf, '');
});

test('emülatör + kurallar: import ile yeni raf 12 kapasiteyle yaratılır; kapasite aşımı Havuz\'a gider', async () => {
    const db = adminDb();
    const r = await importRows(db, store(db), rowsTo('Yeni Raf', 13, 'N'));
    assert.equal(r.plan.poolOverflowCount, 1);
    const shelves = await snapshot(db, 'shelves');
    const { updatedAt, ...rest } = shelves['b1_YENI RAF'];
    assert.ok(updatedAt instanceof Timestamp);
    assert.deepEqual(rest, { code: 'YENI RAF', depot: 'b1', capacity: 12, usedSlots: 12, active: true, updatedBy: 'admin-uid' });
    const b1 = await snapshot(db, 'b1');
    assert.equal(r.plan.records.filter(x => b1[x.id] && b1[x.id].raf === 'YENI RAF').length, 12);
});

test('emülatör + kurallar (P1): GERÇEK sunucu reddiyle ara parça düşer → ürünler, yeni raf ve sayaç BİRLİKTE geri alınır', async () => {
    await seedShelves([seedShelf('RAF-A', 10, 2)]);
    const db = adminDb();
    const beforeB1 = await snapshot(db, 'b1');
    const beforeShelves = await snapshot(db, 'shelves');
    let data = 0, midShelves = null;
    const real = store(db);
    const st = {
        ...real,
        async commit(writes) {
            if (writes.some(w => w.col === 'b1' || w.col === 'shelves') && ++data === 2) midShelves = await snapshot(db, 'shelves');
            return real.commit(writes);
        },
    };
    // 900 kayıt: buildStockRecords'un YENİ 200 satır sınırını (bilinçli olarak) atlamak için kanonik kayıtlar doğrudan kurulur.
    const recA = canonRowsTo('RAF-A', 3, 'A'), recN = canonRowsTo('Yeni', 2, 'N'), recPool = canonRowsTo('', 895, 'Rafsız');
    const records = [...recA, ...recN, ...recPool];
    const requests = [...recA.map((r, i) => ({ id: r.id, code: 'RAF-A', occupying: true, line: i + 2 })),
        ...recN.map((r, i) => ({ id: r.id, code: 'YENI', occupying: true, line: i + 5 }))];
    await assert.rejects(importRawRecords(db, st, records, requests, recs => { recs[700].açıklama = 'x'.repeat(1100 * 1024); }), e => {
        assert.equal(e.code, 'rolled-back', e.message);
        assert.equal(e.details.chunk, 1, 'ilk parça (raf sayaçları dahil) yazılmıştı');
        return true;
    });
    assert.equal(midShelves['b1_RAF-A'].usedSlots, 5, 'ara durumda sayaç gerçekten artmıştı');
    assert.equal(midShelves['b1_YENI'].usedSlots, 2, 'ara durumda yeni raf gerçekten yaratılmıştı');
    const afterShelves = await snapshot(db, 'shelves');
    assert.deepEqual(afterShelves, beforeShelves, 'raf kataloğu işlem öncesi hâlinde, yeni raf silindi');
    assert.ok(afterShelves['b1_RAF-A'].updatedAt instanceof Timestamp, 'geri alınan raf belgesinde Timestamp türü korunur');
    assert.deepEqual(Object.keys(await snapshot(db, 'b1')), Object.keys(beforeB1), 'hiçbir ürün kalmadı');
    assert.deepEqual(await journalState(db), { journal: [], lock: null });
});

test('emülatör + kurallar (P1): plan ile commit arasında raf değişirse transaction çakışma verir, hiçbir şey yazılmaz', async () => {
    await seedShelves([seedShelf('RAF-A', 5, 3)]);
    const db = adminDb();
    const real = store(db);
    let bumped = false;
    const st = {
        ...real,
        async commitIfUnchanged(writes, checks) {
            if (!bumped) {
                bumped = true;
                await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), ROOT, 'shelves', 'items', 'b1_RAF-A'), { ...seedShelf('RAF-A', 5, 4) }));
            }
            return real.commitIfUnchanged(writes, checks);
        },
    };
    const beforeB1 = Object.keys(await snapshot(db, 'b1'));
    await assert.rejects(importRows(db, st, rowsTo('RAF-A', 2, 'C')), e => e.code === 'conflict');
    assert.deepEqual(Object.keys(await snapshot(db, 'b1')), beforeB1);
    assert.equal((await snapshot(db, 'shelves'))['b1_RAF-A'].usedSlots, 4, 'eşzamanlı yazmanın sayacı ezilmedi');
});

test('kurallar (P1): raf geri yazımı (eski zaman damgası) ve dolu raf silme YALNIZ toplu yazma kilidi altında serbest', async () => {
    await seedShelves([seedShelf('RAF-A', 10, 3)]);
    const db = adminDb();
    const ref = doc(db, ROOT, 'shelves', 'items', 'b1_RAF-A');
    const settings = doc(db, ROOT, 'system_config', 'items', 'admin_settings');
    const old = seedShelf('RAF-A', 10, 2);
    await assert.rejects(setDoc(ref, old), e => e.code === 'permission-denied', 'kilitsiz: eski updatedAt reddedilir');
    await assert.rejects(deleteDoc(ref), e => e.code === 'permission-denied', 'kilitsiz: dolu raf silinemez');

    await setDoc(settings, { restoreLock: { id: 'test', collections: ['b1'] } }, { merge: true });
    await assert.rejects(setDoc(ref, { ...old, extra: 1 }), e => e.code === 'permission-denied', 'kilit altında bile şema bozuk belge reddedilir');
    await assert.rejects(setDoc(ref, { ...old, code: 'RAF-B' }), e => e.code === 'permission-denied', 'kilit altında bile kod değiştirilemez');
    await setDoc(ref, old);
    assert.equal((await getDoc(ref)).data().usedSlots, 2);
    await deleteDoc(ref);
    assert.equal((await getDoc(ref)).exists(), false);
    await setDoc(settings, { restoreLock: null }, { merge: true });
});
