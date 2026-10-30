// v3.3 P1 — Excel içe aktarmanın raf sayacı: ürünler, yeni raflar ve mevcut rafların usedSlots sayacı TEK AtomicWriter
// işinde (tek batch ya da günlüklü çok parçalı iş) yazılır ve birlikte geri alınır. schema.js + stock-import.js +
// atomic-writer.js gerçek hâlleriyle aynı vm bağlamında yüklenir; Firestore yerine batch atomikliğini taklit eden bellek-içi
// depo kullanılır (hata enjeksiyonu: 'before' → commit uygulanmaz, 'after' → uygulanır ama yanıt kaybolur).
// Akış firebase-handler.js atomicImportStock ile birebir: önizleme (buildStockRecords) → entries(store) içinde taze raf
// belgeleriyle planImportEntries → AtomicWriter.run. Gerçek kurallarla aynı senaryolar: tests/integration/atomic-writer.emu.test.mjs.
// Usage: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const plain = x => JSON.parse(JSON.stringify(x));
const NOW = 1760000000000;

function load() {
    const ctx = vm.createContext({ window: { data: { productTypes: [] } }, console, setTimeout, TextDecoder });
    for (const f of ['src/utils/schema.js', 'src/utils/stock-import.js', 'src/services/atomic-writer.js']) {
        vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
    }
    let n = 0;
    return { S: ctx.window.Schema, I: ctx.window.StockImport, W: ctx.window.AtomicWriter, makeId: () => 5000 + (n++) };
}

function memStore(initial = {}) {
    const db = new Map();
    Object.entries(initial).forEach(([col, docs]) => docs.forEach(d => db.set(`${col}/${d.id}`, plain(d))));
    const s = {
        db, commits: 0, casCommits: 0, log: [],
        fault: null,
        async readCollection(col) {
            return [...db].filter(([k]) => k.startsWith(col + '/')).map(([k, v]) => ({ id: k.slice(col.length + 1), data: plain(v) }));
        },
        async readDoc(col, id) { const v = db.get(`${col}/${id}`); return v === undefined ? null : plain(v); },
        async commit(writes) {
            const n = s.commits++;
            s.log.push(writes.map(w => `${w.kind}:${w.col}/${w.id}`));
            const f = s.fault && s.fault(n, writes);
            if (f === 'before') throw new Error(`enjekte hata (commit #${n}, uygulanmadı)`);
            const next = new Map(db);
            writes.forEach(w => {
                const key = `${w.col}/${w.id}`;
                if (w.kind === 'delete') next.delete(key);
                else if (w.kind === 'merge') next.set(key, { ...(next.get(key) || {}), ...plain(w.data) });
                else next.set(key, plain(w.data));
            });
            db.clear(); next.forEach((v, k) => db.set(k, v));
            if (f === 'after') throw new Error(`enjekte hata (commit #${n}, uygulandı, yanıt kayboldu)`);
        },
        // Transaction taklidi: koşullar ve yazmalar bölünmeden (aradan başka commit giremez).
        async commitIfUnchanged(writes, checks) {
            s.casCommits++;
            for (const c of checks) {
                const v = db.get(`${c.col}/${c.id}`);
                if (!c.matches(v === undefined ? null : plain(v))) throw c.conflict();
            }
            await s.commit(writes);
        },
        encode: v => plain(v), decode: v => plain(v),
    };
    return s;
}

const appState = s => Object.fromEntries([...s.db].filter(([k]) => !k.startsWith('system_config/')).sort(([a], [b]) => a.localeCompare(b)));
const journalDocs = s => [...s.db.keys()].filter(k => k.startsWith('system_config/bulk_write_journal'));
const lockOf = s => (s.db.get('system_config/admin_settings') || {}).restoreLock ?? null;
const shelf = (s, id) => s.db.get(`shelves/${id}`);
const items = (s, col = 'b1') => [...s.db].filter(([k]) => k.startsWith(col + '/')).map(([, v]) => v);

const shelfDoc = (code, capacity, usedSlots, extra = {}) => ({
    id: `b1_${code}`, code, depot: 'b1', capacity, usedSlots, active: true, updatedAt: 1700000000000, updatedBy: 'eski-admin', ...extra,
});
const rowsTo = (code, n, prefix = 'Ürün') => Array.from({ length: n }, (_, i) => ({ Ürün: `${prefix} ${i}`, Adet: '1', Raf: code }));

// firebase-handler.js atomicImportStock'un motor kısmı: önizleme yerel katalogla, kesin plan entries(store) içinde taze okumayla.
async function importOnce(env, store, rows, { col = 'b1', limits, beforeCommit, retries = 2 } = {}) {
    const { S, I, W, makeId } = env;
    const cached = (await store.readCollection('shelves')).map(d => d.data).filter(d => d.depot === col);
    const built = I.buildStockRecords(rows, col, {
        schema: S, makeId, now: NOW,
        shelfCapacityInfo: new Map(cached.map(d => [d.code, { capacity: d.capacity, usedSlots: d.usedSlots, active: d.active }])),
    });
    assert.deepEqual(plain(built.errors), []);
    let plan = null;
    const res = await W.run({
        store, kind: 'atomicImportStock', collections: [col], uid: 'admin-uid', sleep: async () => {}, retries, limits,
        entries: async st => {
            const p = I.planImportEntries({
                col, records: built.records, requests: built.shelfRequests,
                shelfDocs: (await st.readCollection('shelves')).map(d => d.data), uid: 'admin-uid', serverTime: W.SERVER_TIME,
            });
            plan = p.plan;
            if (beforeCommit) beforeCommit(store);
            return p.entries;
        },
    });
    return { res: plain(res), plan: plain(plan), built: plain(built) };
}

const SMALL = { maxOps: 6, maxBytes: 8 * 1024 * 1024, partChars: 200 };   // 4 girdilik parçalar → günlüklü çok parçalı iş

// ─── Astra'nın kanıt senaryoları ─────────────────────────────────────────────────────────────────────────────────────
test('capacity=5, usedSlots=4: 1. içe aktarma rafa girer ve sayaç 5 olur; 2. içe aktarma Havuz\'a gider, sayaç 5\'te kalır', async () => {
    const env = load();
    const store = memStore({ shelves: [shelfDoc('RAF-A', 5, 4)] });

    const first = await importOnce(env, store, rowsTo('RAF-A', 1, 'İlk'));
    assert.equal(first.res.status, 'committed');
    assert.equal(first.res.journaled, false, 'tek batch');
    assert.equal(store.casCommits, 1, 'ürün + sayaç tek koşullu commit (transaction) ile yazıldı');
    assert.equal(first.plan.records[0].raf, 'RAF-A');
    assert.equal(shelf(store, 'b1_RAF-A').usedSlots, 5, 'MEVCUT rafın sayacı ürünle aynı işte arttı');
    assert.equal(shelf(store, 'b1_RAF-A').updatedBy, 'admin-uid');
    assert.equal(shelf(store, 'b1_RAF-A').updatedAt, env.W.SERVER_TIME, 'updatedAt sunucu saatine çevrilecek sentinel');
    assert.equal(shelf(store, 'b1_RAF-A').capacity, 5);
    const afterFirst = plain(shelf(store, 'b1_RAF-A'));

    const second = await importOnce(env, store, rowsTo('RAF-A', 1, 'İkinci'));
    assert.equal(second.built.poolOverflowCount, 1, 'önizleme de (taze katalogla) Havuz dedi');
    assert.equal(second.plan.records[0].raf, '', 'ikinci içe aktarma Havuz\'a (rafsız)');
    assert.equal(second.plan.poolOverflowCount, 1);
    assert.deepEqual(second.plan.shelfEntries, [], 'sayacı değişmeyen raf yazılmaz');
    assert.deepEqual(shelf(store, 'b1_RAF-A'), afterFirst, 'sayaç 5\'te kaldı, kapasite artırılmadı');
    assert.deepEqual(items(store).map(x => x.raf).sort(), ['', 'RAF-A']);
});

test('yeni rafa 6 kayıt: 5\'i rafa, 1\'i Havuz\'a; raf belgesi ürünlerle AYNI işte usedSlots=5 ile yaratılır', async () => {
    const env = load();
    const store = memStore({ shelves: [] });
    const r = await importOnce(env, store, rowsTo('Yeni Raf', 6));
    assert.equal(r.res.status, 'committed');
    assert.equal(r.plan.records.filter(x => x.raf === 'YENI RAF').length, 5);
    assert.equal(r.plan.records.filter(x => x.raf === '').length, 1);
    assert.equal(r.plan.poolOverflowCount, 1);
    assert.deepEqual(r.plan.shelvesToCreate, ['YENI RAF']);
    const doc = shelf(store, 'b1_YENI RAF');
    assert.deepEqual({ ...doc, updatedAt: 'T' }, { code: 'YENI RAF', depot: 'b1', capacity: 5, usedSlots: 5, active: true, updatedAt: 'T', updatedBy: 'admin-uid' });
    assert.deepEqual(plain(env.S.validateShelfDoc({ ...doc, updatedAt: NOW }, { id: 'b1_YENI RAF' })), [], 'tam raf sözleşmesi');
    assert.equal(items(store).length, 6);
    assert.equal(items(store).filter(x => x.raf === 'YENI RAF').length, doc.usedSlots, 'sayaç = rafa yerleşen gerçek ürün sayısı');
});

test('ARA COMMIT HATASI (günlüklü iş): ürünler, yaratılan raf ve güncellenen sayaç BİRLİKTE geri alınır', async () => {
    const env = load();
    const before = {
        shelves: [shelfDoc('RAF-A', 10, 2)],
        b1: [{ id: 'mevcut1', ürün: 'Eski', adet: 1, raf: 'RAF-A' }],
        system_config: [{ id: 'admin_settings', maintenance: false }],
    };
    const store = memStore(before);
    const initial = appState(store);
    let data = 0, midShelf = null, midNew = null;
    store.fault = (n, writes) => {
        if (!writes.some(w => w.col === 'b1' || w.col === 'shelves')) return null;
        data += 1;
        if (data === 2) { midShelf = plain(shelf(store, 'b1_RAF-A')); midNew = plain(shelf(store, 'b1_YENI') || null); }
        return data === 3 ? 'before' : null;   // 3. veri parçası sunucuya ulaşmaz
    };
    const rows = [...rowsTo('RAF-A', 4, 'A'), ...rowsTo('Yeni', 3, 'N'), ...Array.from({ length: 5 }, (_, i) => ({ Ürün: `Rafsız ${i}`, Adet: '2' }))];
    await assert.rejects(importOnce(env, store, rows, { limits: SMALL }), e => {
        assert.equal(e.code, 'rolled-back', e.message);
        assert.equal(e.details.chunk, 2);
        return true;
    });
    assert.equal(midShelf.usedSlots, 6, 'ara durumda 1. parça (raf sayaçları) GERÇEKTEN yazılmıştı');
    assert.equal(midNew && midNew.usedSlots, 3, 'ara durumda yeni raf GERÇEKTEN yaratılmıştı');
    assert.deepEqual(appState(store), initial, 'ürünler, yeni raf ve sayaç işlem öncesi hâlinde (kısmi başarı yok)');
    assert.deepEqual(journalDocs(store), []);
    assert.equal(lockOf(store), null);
});

test('ARA COMMIT HATASI: yanıtı kaybolan son parça (sunucuda uygulandı) da geri alınır', async () => {
    const env = load();
    const store = memStore({ shelves: [shelfDoc('RAF-A', 10, 2)], system_config: [{ id: 'admin_settings' }] });
    const initial = appState(store);
    let data = 0;
    store.fault = (n, writes) => (writes.some(w => w.col === 'b1' || w.col === 'shelves') && ++data === 3 ? 'after' : null);
    const rows = [...rowsTo('RAF-A', 3, 'A'), ...rowsTo('Yeni', 2, 'N'), ...Array.from({ length: 4 }, (_, i) => ({ Ürün: `Rafsız ${i}`, Adet: '1' }))];
    await assert.rejects(importOnce(env, store, rows, { limits: SMALL }), e => e.code === 'rolled-back');
    assert.deepEqual(appState(store), initial);
    assert.deepEqual(journalDocs(store), []);
    assert.equal(lockOf(store), null);
});

test('bağlantı koptu → kilit + günlük kalır; recover ürünleri, yeni rafı ve sayacı birlikte geri alır', async () => {
    const env = load();
    const store = memStore({ shelves: [shelfDoc('RAF-A', 10, 2)], system_config: [{ id: 'admin_settings' }] });
    const initial = appState(store);
    let data = 0, dead = false;
    store.fault = (n, writes) => {
        if (dead) return 'before';
        if (writes.some(w => w.col === 'b1' || w.col === 'shelves') && ++data === 3) { dead = true; return 'before'; }
        return null;
    };
    const rows = [...rowsTo('RAF-A', 3, 'A'), ...rowsTo('Yeni', 2, 'N'), ...Array.from({ length: 6 }, (_, i) => ({ Ürün: `Rafsız ${i}`, Adet: '1' }))];
    await assert.rejects(importOnce(env, store, rows, { limits: SMALL, retries: 1 }), e => e.code === 'rollback-pending');
    assert.ok(lockOf(store), 'kilit sunucuda');
    assert.notDeepEqual(appState(store), initial, 'yarım veri kilit altında');
    assert.equal(shelf(store, 'b1_RAF-A').usedSlots, 5, 'sayaç da yarım işin parçası');

    store.fault = null;
    const r = plain(await env.W.recover({ store, force: true, sleep: async () => {}, limits: SMALL }));
    assert.equal(r.status, 'rolled-back');
    assert.deepEqual(appState(store), initial);
    assert.deepEqual(journalDocs(store), []);
    assert.equal(lockOf(store), null);
});

test('eşzamanlılık (tek batch): plan ile commit arasında raf sayacı değişirse ÇAKIŞMA — hiçbir şey yazılmaz', async () => {
    const env = load();
    const store = memStore({ shelves: [shelfDoc('RAF-A', 5, 3)] });
    const concurrent = st => st.db.set('shelves/b1_RAF-A', { ...st.db.get('shelves/b1_RAF-A'), usedSlots: 4 });   // başka bir transfer
    await assert.rejects(importOnce(env, store, rowsTo('RAF-A', 2), { beforeCommit: concurrent }), e => {
        assert.equal(e.code, 'conflict', e.message);
        return true;
    });
    assert.equal(items(store).length, 0, 'ürün yazılmadı');
    assert.equal(shelf(store, 'b1_RAF-A').usedSlots, 4, 'eşzamanlı işlemin sayacı ezilmedi');

    // Yeniden deneme (atomicImportStock bunu otomatik yapar) taze sayaçla: 1 yer kaldı → 1 rafa, 1 Havuz.
    const retry = await importOnce(env, store, rowsTo('RAF-A', 2));
    assert.equal(retry.plan.records.filter(x => x.raf === 'RAF-A').length, 1);
    assert.equal(retry.plan.poolOverflowCount, 1);
    assert.equal(shelf(store, 'b1_RAF-A').usedSlots, 5, 'kapasite aşılmadı');
});

test('eşzamanlılık (günlüklü iş): kilit alındıktan sonra raf farklıysa ÇAKIŞMA — veri yazılmaz, günlük/kilit temizlenir', async () => {
    const env = load();
    const store = memStore({ shelves: [shelfDoc('RAF-A', 10, 2)], system_config: [{ id: 'admin_settings' }] });
    const concurrent = st => st.db.set('shelves/b1_RAF-A', { ...st.db.get('shelves/b1_RAF-A'), usedSlots: 3 });
    const rows = [...rowsTo('RAF-A', 3), ...Array.from({ length: 8 }, (_, i) => ({ Ürün: `Rafsız ${i}`, Adet: '1' }))];
    await assert.rejects(importOnce(env, store, rows, { limits: SMALL, beforeCommit: concurrent }), e => e.code === 'conflict');
    assert.equal(items(store).length, 0);
    assert.equal(shelf(store, 'b1_RAF-A').usedSlots, 3);
    assert.deepEqual(journalDocs(store), []);
    assert.equal(lockOf(store), null);
});

test('başarılı günlüklü iş: sayaçlar ve yeni raf ürünlerle birlikte kalıcı; günlük ve kilit temiz', async () => {
    const env = load();
    const store = memStore({ shelves: [shelfDoc('RAF-A', 4, 2)], system_config: [{ id: 'admin_settings' }] });
    const rows = [...rowsTo('RAF-A', 3, 'A'), ...rowsTo('Yeni', 2, 'N'), ...Array.from({ length: 6 }, (_, i) => ({ Ürün: `Rafsız ${i}`, Adet: '1' }))];
    const r = await importOnce(env, store, rows, { limits: SMALL });
    assert.equal(r.res.journaled, true);
    assert.ok(r.res.chunks >= 3);
    assert.equal(shelf(store, 'b1_RAF-A').usedSlots, 4, '2 + 2 (3. ürün dolu rafa sığmadı)');
    assert.equal(shelf(store, 'b1_YENI').usedSlots, 2);
    assert.equal(r.plan.poolOverflowCount, 1);
    assert.equal(items(store).length, 11);
    assert.deepEqual(journalDocs(store), []);
    assert.equal(lockOf(store), null);
});

// ─── Saf plan kuralları ──────────────────────────────────────────────────────────────────────────────────────────────
test('plan: raf girdileri ÖNCE gelir, cas:true taşır; prev = sunucudaki tam belge (yeni rafta null)', () => {
    const { I, W } = load();
    const records = [{ id: 'r1', raf: 'RAF-A' }, { id: 'r2', raf: 'YENI' }];
    const requests = [{ id: 'r1', code: 'RAF-A', occupying: true, line: 2 }, { id: 'r2', code: 'YENI', occupying: true, line: 3 }];
    const existing = shelfDoc('RAF-A', 5, 1);
    const { entries } = plain(I.planImportEntries({ col: 'b1', records, requests, shelfDocs: [existing], uid: 'u', serverTime: W.SERVER_TIME }));
    assert.deepEqual(entries.map(e => `${e.col}/${e.id}`), ['shelves/b1_RAF-A', 'shelves/b1_YENI', 'b1/r1', 'b1/r2']);
    assert.ok(entries.slice(0, 2).every(e => e.cas === true));
    assert.deepEqual(entries[0].prev, existing);
    assert.equal(entries[1].prev, null);
    assert.deepEqual(entries[0].next, { code: 'RAF-A', depot: 'b1', capacity: 5, active: true, usedSlots: 2, updatedAt: W.SERVER_TIME, updatedBy: 'u' });
});

test('plan: kapasitesi zaten aşılmış raf otomatik büyütülmez; pasif raf Havuz; başka depodaki aynı kod sayılmaz', () => {
    const { I } = load();
    const records = [{ id: 'a', raf: 'X' }, { id: 'b', raf: 'P' }, { id: 'c', raf: 'B2RAF' }];
    const requests = [
        { id: 'a', code: 'X', occupying: true, line: 2 },
        { id: 'b', code: 'P', occupying: true, line: 3 },
        { id: 'c', code: 'B2RAF', occupying: true, line: 4 },
    ];
    const shelfDocs = [
        shelfDoc('X', 3, 4),                              // geçiş sonrası aşım
        shelfDoc('P', 5, 0, { active: false }),
        { ...shelfDoc('B2RAF', 1, 1), id: 'b2_B2RAF', depot: 'b2' },   // b2'de dolu — b1 içe aktarmasını etkilemez
    ];
    const { plan } = plain(I.planImportEntries({ col: 'b1', records, requests, shelfDocs, uid: 'u', serverTime: 'T' }));
    assert.equal(plan.records[0].raf, '');
    assert.equal(plan.records[1].raf, '');
    assert.equal(plan.records[2].raf, 'B2RAF', 'b1 için yeni raf');
    assert.equal(plan.poolOverflowCount, 1);
    assert.equal(plan.poolInactiveCount, 1);
    assert.deepEqual(plan.shelfChanges.map(c => `${c.id}:${c.before}->${c.after}`), ['b1_B2RAF:0->1']);
    assert.match(plan.warnings[1], /"P" rafı pasif/);
});

test('plan: slot işgal etmeyen satır, aynı içe aktarmada yaratılan rafa yazılabilir ama sayaca eklenmez', () => {
    const { I } = load();
    const records = [{ id: 'dolu', raf: 'YENI' }, { id: 'bos', raf: 'YENI' }];
    const requests = [{ id: 'bos', code: 'YENI', occupying: false, line: 2 }, { id: 'dolu', code: 'YENI', occupying: true, line: 3 }];
    const { plan } = plain(I.planImportEntries({ col: 'b1', records, requests, shelfDocs: [], uid: 'u', serverTime: 'T' }));
    assert.deepEqual(plan.records.map(r => r.raf), ['YENI', 'YENI']);
    assert.equal(plan.shelfChanges[0].after, 1);
});
