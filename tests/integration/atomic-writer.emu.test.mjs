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
import { doc, collection, getDoc, getDocs, setDoc, writeBatch, Timestamp, setLogLevel } from 'firebase/firestore';

setLogLevel('silent');
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROOT = 'inventory_demo';
const ADMIN_EMAIL = 'admin@medipol.local';
const plain = x => JSON.parse(JSON.stringify(x));

// Aynı realm'de yüklenir (tarayıcıdaki gibi): Firestore SDK başka bir vm realm'inde kurulan nesneleri "özel nesne" sayıp reddeder.
globalThis.window = globalThis.window || {};
vm.runInThisContext(fs.readFileSync(path.join(ROOT_DIR, 'src/services/atomic-writer.js'), 'utf8'), { filename: 'atomic-writer.js' });
const W = globalThis.window.AtomicWriter;
const fns = { doc, collection, getDoc, getDocs, writeBatch, Timestamp };

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
