// Faz 5 denetimi · P0 — günlüklü hepsi-ya-da-hiçbiri toplu yazma motoru (src/services/atomic-writer.js).
// Motor gerçek dosyasıyla, tarayıcısız (vm) yüklenir; Firestore yerine bellek-içi bir depo kullanılır. Depo, Firestore'un
// batch semantiğini taklit eder (bir commit ya tamamen uygulanır ya hiç) ve istenen commit'te hata enjekte edebilir:
//   - 'before' : commit sunucuya hiç ulaşmaz (ağ hatası, kural reddi, kota)
//   - 'after'  : commit sunucuda UYGULANIR ama istemci hata alır (yanıt kaybı — belirsiz sonuç)
// Gerçek Firestore'a karşı aynı senaryolar: tests/integration/atomic-writer.emu.test.mjs (npm run test:atomic:emu).
// Usage: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const plain = x => JSON.parse(JSON.stringify(x));

function loadWriter() {
    const ctx = vm.createContext({ window: {}, console, setTimeout });
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/services/atomic-writer.js'), 'utf8'), ctx, { filename: 'atomic-writer.js' });
    return ctx.window.AtomicWriter;
}

// ─── Bellek-içi Firestore taklidi ───────────────────────────────────────────────────────────────────
function memStore(initial = {}) {
    const db = new Map();
    Object.entries(initial).forEach(([col, docs]) => docs.forEach(d => db.set(`${col}/${d.id}`, plain(d))));
    const s = {
        db, commits: 0, log: [],
        fault: null,            // (n, writes) => 'before' | 'after' | null
        async readCollection(col) {
            return [...db].filter(([k]) => k.startsWith(col + '/')).map(([k, v]) => ({ id: k.slice(col.length + 1), data: plain(v) }));
        },
        async readDoc(col, id) { const v = db.get(`${col}/${id}`); return v === undefined ? null : plain(v); },
        async commit(writes) {
            const n = s.commits++;
            s.log.push(writes.map(w => `${w.kind}:${w.col}/${w.id}`));
            const f = s.fault && s.fault(n, writes);
            if (f === 'before') throw new Error(`enjekte hata (commit #${n}, uygulanmadı)`);
            // atomik: önce kopya üzerinde uygula, sonra tek seferde değiştir
            const next = new Map(db);
            writes.forEach(w => {
                const key = `${w.col}/${w.id}`;
                if (w.kind === 'delete') next.delete(key);
                else if (w.kind === 'merge') next.set(key, { ...(next.get(key) || {}), ...plain(w.data) });
                else next.set(key, plain(w.data));
            });
            db.clear(); next.forEach((v, k) => db.set(k, v));
            if (f === 'after') throw new Error(`enjekte hata (commit #${n}, sunucuda uygulandı, yanıt kayboldu)`);
        },
        // Günlük metni gerçek bir JSON gidiş-dönüşünden geçer (recover yolu decode'u kullanır)
        encode: v => plain(v), decode: v => plain(v),
    };
    return s;
}
// Uygulama verisi (günlük/ayar dokümanları hariç) — "işlem öncesi hâl" karşılaştırması için
const appState = s => Object.fromEntries([...s.db].filter(([k]) => !k.startsWith('system_config/')).sort(([a], [b]) => a.localeCompare(b)));
const journalDocs = s => [...s.db.keys()].filter(k => k.startsWith('system_config/bulk_write_journal'));
const lockOf = s => (s.db.get('system_config/admin_settings') || {}).restoreLock ?? null;

const LIMITS = { maxOps: 6, maxBytes: 8 * 1024 * 1024, partChars: 200 };   // küçük sınırlar → çok parçalı iş, çok parçalı günlük
const fastOpts = { limits: LIMITS, sleep: async () => {}, retries: 2 };

// Başlangıç: b1'de 12 kayıt + ayarlar. Hedef (yedek): 4 değişmeyen, 5 değişen, 3 silinen, 10 yeni → 18 girdi.
function fixture() {
    const before = {
        b1: Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, ürün: `Ürün ${i}`, adet: i })),
        b2: [{ id: 'q0', ürün: 'Laptop', adet: 1 }],
        system_config: [{ id: 'admin_settings', maintenance: false }],
    };
    const target = {
        b1: [
            ...before.b1.slice(0, 4),
            ...before.b1.slice(4, 9).map(p => ({ ...p, adet: p.adet + 100, not: 'yedekten' })),
            ...Array.from({ length: 10 }, (_, i) => ({ id: `n${i}`, ürün: `Yeni ${i}`, adet: 1 })),
        ],
    };
    return { before, target };
}
async function restore(W, store, target, extra = {}) {
    return W.run({
        store, kind: 'restore', collections: Object.keys(target), uid: 'admin-uid', ...fastOpts, ...extra,
        entries: async st => W.planRestore({ target, server: await W.readCollections(st, Object.keys(target)), makeId: () => 'gen' }),
    });
}
const expectedAfter = (before, target) => {
    const m = new Map();
    Object.entries(before).forEach(([col, docs]) => { if (col !== 'system_config') docs.forEach(d => m.set(`${col}/${d.id}`, d)); });
    Object.keys(target).forEach(col => { [...m.keys()].filter(k => k.startsWith(col + '/')).forEach(k => m.delete(k)); });
    Object.entries(target).forEach(([col, docs]) => docs.forEach(d => m.set(`${col}/${d.id}`, d)));
    return Object.fromEntries([...m].sort(([a], [b]) => a.localeCompare(b)));
};

// ─── Saf parçalar ───────────────────────────────────────────────────────────────────────────────────
test('planRestore: değişmeyen yazılmaz, değişen/yeni tam değiştirilir, yedekte olmayan silinir', () => {
    const W = loadWriter();
    const { before, target } = fixture();
    const server = { b1: before.b1.map(d => ({ id: d.id, data: d })) };
    const e = plain(W.planRestore({ target, server, makeId: () => 'x' }));
    assert.equal(e.length, 18);
    assert.equal(e.filter(x => x.prev && x.next).length, 5, 'değişen');
    assert.equal(e.filter(x => !x.prev && x.next).length, 10, 'yeni');
    assert.deepEqual(e.filter(x => !x.next).map(x => x.id).sort(), ['p10', 'p11', 'p9'], 'silinen');
    assert.ok(e.every(x => !x.next || !('__render' in x.next)));
    const changed = e.find(x => x.id === 'p4');
    assert.deepEqual(changed.prev, before.b1[4], 'geri alma için önceki hâl saklanır');
});

test('planRestore: yedekte aynı id iki kez → duplicate-id (hiçbir şey planlanmaz)', () => {
    const W = loadWriter();
    assert.throws(() => W.planRestore({ target: { b1: [{ id: 'a' }, { id: 'a', x: 1 }] }, server: { b1: [] }, makeId: () => 'x' }),
        e => e.code === 'duplicate-id');
});

test('chunkEnds: işlem sınırı (günlük payı dahil) ve bayt sınırı', () => {
    const W = loadWriter();
    const entries = Array.from({ length: 11 }, (_, i) => ({ next: { i }, prev: null }));
    assert.deepEqual(plain(W.chunkEnds(entries, { maxOps: 6, maxBytes: 1e9, reserve: 1 })), [5, 10, 11], '5 veri + 1 günlük = 6');
    const big = 'x'.repeat(1000);
    const heavy = Array.from({ length: 4 }, () => ({ next: null, prev: { big } }));   // silme ama geri alması büyük
    assert.deepEqual(plain(W.chunkEnds(heavy, { maxOps: 100, maxBytes: 2200, reserve: 1 })), [2, 4], 'geri alma boyutu da hesaba katılır');
});

test('splitText: vekil çift ortadan bölünmez, birleşince aynı metin', () => {
    const W = loadWriter();
    const text = 'ab😀cd😀ef'.repeat(50);
    const parts = W.splitText(text, 7);
    assert.equal(parts.join(''), text);
    parts.forEach(p => { const c = p.charCodeAt(p.length - 1); assert.ok(!(c >= 0xD800 && c <= 0xDBFF), 'parça yüksek vekille bitmemeli'); });
});

// ─── Başarı yolları ─────────────────────────────────────────────────────────────────────────────────
test('tek batch\'e sığan iş: günlük yok, tek atomik commit', async () => {
    const W = loadWriter();
    const store = memStore({ b1: [{ id: 'a', ürün: 'A' }] });
    const r = plain(await W.run({ store, entries: [{ col: 'b1', id: 'b', prev: null, next: { id: 'b' } }], collections: ['b1'], ...fastOpts }));
    assert.equal(r.status, 'committed');
    assert.equal(r.journaled, false);
    assert.equal(store.commits, 1);
    assert.equal(journalDocs(store).length, 0);
});

test('çok parçalı iş başarıyla: hedef hâl, günlük temizlenmiş, kilit kalkmış', async () => {
    const W = loadWriter();
    const { before, target } = fixture();
    const store = memStore(before);
    const r = plain(await restore(W, store, target));
    assert.equal(r.status, 'committed');
    assert.equal(r.journaled, true);
    assert.ok(r.chunks >= 3, `çok parçalı olmalı (${r.chunks})`);
    assert.deepEqual(appState(store), expectedAfter(before, target));
    assert.deepEqual(journalDocs(store), []);
    assert.equal(lockOf(store), null);
    assert.equal(store.db.get('system_config/admin_settings').maintenance, false, 'ayar dokümanının diğer alanları korunur');
});

// ─── KISMİ BATCH HATASI (P0'ın asıl senaryosu) ───────────────────────────────────────────────────────
test('her veri parçasında hata (commit sunucuya ulaşmadan): Firestore işlem öncesi hâline döner', async () => {
    const W = loadWriter();
    const { before, target } = fixture();
    const probe = memStore(before);
    const chunks = plain(await restore(W, probe, target)).chunks;
    // commit sırası: #0 başlık+kilit, #1.. günlük parçaları, sonra veri parçaları
    for (let k = 0; k < chunks; k++) {
        const store = memStore(before);
        let dataIdx = 0;
        store.fault = (n, writes) => (writes.some(w => w.col === 'b1') && dataIdx++ === k ? 'before' : null);
        await assert.rejects(restore(W, store, target), e => e.code === 'rolled-back' && e.details.chunk === k, `parça ${k}`);
        assert.deepEqual(appState(store), appState(memStore(before)), `parça ${k} hatasından sonra veri işlem öncesi hâlinde olmalı`);
        assert.deepEqual(journalDocs(store), [], 'günlük temizlenir');
        assert.equal(lockOf(store), null, 'kilit kalkar');
    }
});

test('yanıtı kaybolan commit (sunucuda uygulanmış): o parça da geri alınır', async () => {
    const W = loadWriter();
    const { before, target } = fixture();
    const store = memStore(before);
    let data = 0;
    store.fault = (n, writes) => (writes.some(w => w.col === 'b1') && writes.some(w => w.kind === 'merge' && w.data.committedChunks) && ++data === 2 ? 'after' : null);
    await assert.rejects(restore(W, store, target), e => e.code === 'rolled-back' && e.details.chunk === 1);
    assert.deepEqual(appState(store), appState(memStore(before)));
});

test('geri alma da başarısız (bağlantı koptu) → rollback-pending: kilit + günlük sunucuda kalır, recover geri alır', async () => {
    const W = loadWriter();
    const { before, target } = fixture();
    const store = memStore(before);
    let data = 0, dead = false;
    store.fault = (n, writes) => {
        if (dead) return 'before';
        if (writes.some(w => w.col === 'b1') && ++data === 3) { dead = true; return 'before'; }
        return null;
    };
    await assert.rejects(restore(W, store, target), e => e.code === 'rollback-pending');
    assert.notDeepEqual(appState(store), appState(memStore(before)), 'yarım veri var (2 parça yazıldı)…');
    assert.ok(lockOf(store) && lockOf(store).id, '…ama kilitli: diğer yazmalar durur');
    assert.ok(journalDocs(store).length >= 2, '…ve günlük sunucuda');

    // Yeni toplu yazma, kurtarma yapılmadan başlayamaz
    store.fault = null;
    await assert.rejects(restore(W, store, target), e => e.code === 'pending-journal');

    // Taze günlük (sahibi canlı olabilir) force olmadan beklenir
    const busy = plain(await W.recover({ store, ...fastOpts }));
    assert.equal(busy.status, 'busy');
    // Sahibi öldü (STALE_MS geçti) → otomatik geri alma
    const r = plain(await W.recover({ store, ...fastOpts, now: () => Date.now() + W.STALE_MS + 1 }));
    assert.equal(r.status, 'rolled-back');
    assert.deepEqual(appState(store), appState(memStore(before)), 'kurtarmadan sonra işlem öncesi hâl');
    assert.deepEqual(journalDocs(store), []);
    assert.equal(lockOf(store), null);
});

test('sekme çöktü (uygulama ortasında süreç öldü): yeni oturumda recover yazılan parçaları geri alır', async () => {
    const W = loadWriter();
    const { before, target } = fixture();
    const store = memStore(before);
    let data = 0;
    // 2. veri parçasından sonra hiçbir commit (geri alma dahil) gitmez — süreç ölmüş gibi
    store.fault = (n, writes) => (writes.some(w => w.col === 'b1') ? ++data : data) > 2 ? 'before' : null;
    await assert.rejects(restore(W, store, target, { retries: 0 }), e => e.code === 'rollback-pending');
    store.fault = null;
    const r = plain(await W.recover({ store, ...fastOpts, force: true }));
    assert.equal(r.status, 'rolled-back');
    assert.equal(r.journal.committedChunks, 2, 'başlık, hangi parçaların yazıldığını commit\'le atomik olarak biliyordu');
    assert.deepEqual(appState(store), appState(memStore(before)));
});

test('günlük yazılamazsa (hazırlık hatası) veri hiç yazılmaz, kilit kalkar', async () => {
    const W = loadWriter();
    const { before, target } = fixture();
    const store = memStore(before);
    store.fault = (n, writes) => (writes.some(w => String(w.id).startsWith('bulk_write_journal_part_') && w.kind === 'set') ? 'before' : null);
    await assert.rejects(restore(W, store, target), e => e.code === 'prepare-failed');
    assert.deepEqual(appState(store), appState(memStore(before)));
    assert.deepEqual(journalDocs(store), []);
    assert.equal(lockOf(store), null);
});

test('tamamlanmış ama temizliği yarım kalmış iş: recover veriyi geri ALMAZ, yalnız günlüğü temizler', async () => {
    const W = loadWriter();
    const { before, target } = fixture();
    const store = memStore(before);
    store.fault = (n, writes) => (writes.some(w => w.kind === 'delete' && w.col === 'system_config') ? 'before' : null);
    const r = plain(await restore(W, store, target, { retries: 0 }));
    assert.equal(r.status, 'committed');
    assert.equal(r.cleanupPending, true);
    store.fault = null;
    const rec = plain(await W.recover({ store, ...fastOpts, force: true }));
    assert.equal(rec.status, 'finalized');
    assert.deepEqual(appState(store), expectedAfter(before, target));
    assert.deepEqual(journalDocs(store), []);
    assert.equal(lockOf(store), null);
});

test('şema muhafızı reddederse hiçbir commit yapılmaz', async () => {
    const W = loadWriter();
    const { before, target } = fixture();
    const store = memStore(before);
    const err = Object.assign(new Error('şema'), { code: 'schema-violation' });
    await assert.rejects(restore(W, store, target, { guard: () => err }), e => e.code === 'schema-violation');
    assert.equal(store.commits, 0);
});

test('Firestore bağdaştırıcısı: Timestamp günlüğe kodlanır ve geri alma için aynen çözülür; bilinmeyen tür reddedilir', () => {
    const W = loadWriter();
    class Timestamp { constructor(s, ns) { this.seconds = s; this.nanoseconds = ns; } }
    const st = W.createFirestoreStore({ db: {}, root: 'r', fns: { Timestamp } });
    const v = { a: 1, t: new Timestamp(10, 5), list: [new Timestamp(1, 2)], nested: { t: new Timestamp(3, 4) } };
    const json = JSON.parse(JSON.stringify(st.encode(v)));
    const back = st.decode(json);
    assert.ok(back.t instanceof Timestamp && back.t.seconds === 10 && back.t.nanoseconds === 5);
    assert.ok(back.list[0] instanceof Timestamp && back.nested.t instanceof Timestamp);
    class GeoPoint { constructor() { this.lat = 1; } }
    assert.throws(() => st.encode({ g: new GeoPoint() }), /günlüğe yazılamayan/);
});
