// v3.3 P1 (Astra · son sözleşme açığı) — saveData'nın eski biçimli b1/b2 kayıt yolu: sözleşme dışı eski alanlar
// SALT-OKUNURDUR (yalnız değeri aynen kalıyorsa korunur). Değeri değişen eski alan tüm çağrıyı reddeder ve HİÇBİR
// Firestore batch'i kurulmaz / commit edilmez.
// İki katman: (1) saf karar fonksiyonu Schema.legacyStockPatch; (2) GERÇEK src/services/firebase-handler.js saveData'sı —
// Firebase CDN modülleri, writeBatch/commit çağrılarını sayan bir taklitle değiştirilerek Node'da yüklenir.
// Usage: npm run test:unit
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const plain = x => JSON.parse(JSON.stringify(x));

// ─── Firebase SDK taklidi: her writeBatch ve commit sayılır ──────────────────────────────────────────────────────
const SDK_STUB = `
const sdk = globalThis.__fbStub = { batches: 0, commits: 0, ops: [], listeners: [] };
const noop = () => {};
export const initializeApp = () => ({});
export const getApps = () => [];
export const initializeAuth = () => ({});
export const onAuthStateChanged = noop, connectAuthEmulator = noop, setPersistence = async () => {};
export const browserSessionPersistence = {}, browserLocalPersistence = {}, indexedDBLocalPersistence = {}, inMemoryPersistence = {};
export const createUserWithEmailAndPassword = async () => ({}), signInWithEmailAndPassword = async () => ({}), signOut = async () => {}, updateEmail = async () => {}, updatePassword = async () => {};
export const initializeFirestore = () => ({}), connectFirestoreEmulator = noop;
export const collection = (...p) => p.slice(1).join('/');
export const doc = (...p) => p.slice(1).join('/');
export const onSnapshot = (ref, next, error) => {
    const listener = { ref, next, error, stopped: false };
    sdk.listeners.push(listener);
    return () => { listener.stopped = true; };
};
export const getDoc = async () => ({ exists: () => false, data: () => null });
export const getDocFromServer = getDoc;
export const getDocs = async () => ({ docs: [] });
export const getDocsFromServer = getDocs;
export const setDoc = async () => { sdk.commits++; };
export const writeBatch = () => {
    sdk.batches++;
    return {
        set: (ref, data) => sdk.ops.push({ kind: 'set', ref, data }),
        update: (ref, data) => sdk.ops.push({ kind: 'update', ref, data }),
        delete: ref => sdk.ops.push({ kind: 'delete', ref }),
        commit: async () => { sdk.commits++; },
    };
};
export const runTransaction = async () => { sdk.commits++; };
export const deleteField = () => ({ __delete: true });
export const query = (...a) => a, where = (...a) => a, orderBy = (...a) => a, limit = (...a) => a;
export const serverTimestamp = () => ({ __serverTime: true });
export class Timestamp { constructor(s, n) { this.seconds = s; this.nanoseconds = n; } }
`;

let H, S;
before(async () => {
    const listeners = {};
    globalThis.window = {
        location: { hostname: 'localhost', search: '' },
        addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); },
        removeEventListener: () => {},
        dispatchEvent: () => true,
        localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    };
    globalThis.CustomEvent = globalThis.CustomEvent || class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } };
    vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'src/utils/schema.js'), 'utf8'), { filename: 'schema.js' });
    S = globalThis.window.Schema;

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'savedata-guard-'));
    const stubFile = path.join(dir, 'firebase-stub.mjs');
    fs.writeFileSync(stubFile, SDK_STUB);
    const src = fs.readFileSync(path.join(ROOT, 'src/services/firebase-handler.js'), 'utf8')
        // Bu fixture stok yazıcısını sınar; satın alma erişimi ayrı Rules testindedir.
        .replace(/import \{ subscribeRestrictedPurchases, ensurePurchaseAccess, appendPurchaseWithdrawalHistory \} from '\.\/purchase-access\.js';/, 'const subscribeRestrictedPurchases = () => () => {}; const ensurePurchaseAccess = async () => ({created:0,unresolved:[]}); const appendPurchaseWithdrawalHistory = async () => {};')
        .replace(/"https:\/\/www\.gstatic\.com\/firebasejs\/[^"]+"/g, JSON.stringify(pathToFileURL(stubFile).href));
    assert.ok(!src.includes('gstatic.com'), 'tüm CDN içe aktarmaları taklide yönlendirildi');
    const handlerFile = path.join(dir, 'firebase-handler.mjs');
    fs.writeFileSync(handlerFile, src);
    const origLog = console.log;
    console.log = () => {};
    try { H = await import(pathToFileURL(handlerFile).href); } finally { console.log = origLog; }
});

const sdk = () => globalThis.__fbStub;
const resetSdk = () => { sdk().batches = 0; sdk().commits = 0; sdk().ops = []; };

// Sözleşmeye UYMAYAN eski B1 kaydı: eski takma ad 'qty' taşır (ve 'status' — B1'de eski alan).
const legacyB1 = () => ({
    id: 'b1_legacy_1', sütun: 'A', raf: 'R1', tür: 'Kablo', ürün: 'Eski Kablo', marka: '', adet: 5, qty: 5,
    durumu: 'Kullanıma Hazır', açıklama: '', isDemirbas: false, lastUpdate: 1000,
});

// GERÇEK saveData'yı tek bir eski kayıtla çağırır: mirror ve data aynı eski kayıtla tohumlanır, sonra `edit` uygulanır.
async function saveLegacy(edit, base = legacyB1()) {
    window.userAuth = { uid: 'admin-uid' };
    window.isDbAdmin = () => true;
    window.data.config = {};
    window._dbMirror.b1 = [plain(base)];
    const next = { ...plain(base), ...edit };
    resetSdk();
    let error = null, result;
    const origErr = console.error;
    console.error = () => {};
    try { result = await H.saveData('b1', [next]); } catch (e) { error = e; } finally { console.error = origErr; }
    return { error, result, batches: sdk().batches, commits: sdk().commits, ops: plain(sdk().ops) };
}

// ─── (1) Saf karar fonksiyonu ───────────────────────────────────────────────────────────────────────────────────
test('legacyStockPatch: değişmeyen eski alan korunur (frozen yok), değişen kanonik alan checked\'e girer', () => {
    const prev = legacyB1();
    const r = plain(S.legacyStockPatch('b1', prev, { ...prev, ürün: 'Yeni Ad' }));
    assert.deepEqual(r.frozen, []);
    assert.deepEqual(r.checked, { ürün: 'Yeni Ad' }, 'yalnız değişen kanonik alan denetlenir; qty dokunulmadan korunur');
});

test('legacyStockPatch: eski alanın değeri değişirse frozen\'e girer (qty: 5 → -10); checked\'e sızmaz', () => {
    const prev = legacyB1();
    const r = plain(S.legacyStockPatch('b1', prev, { ...prev, qty: -10 }));
    assert.deepEqual(r.frozen, [{ key: 'qty', before: 5, after: -10 }]);
    assert.ok(!('qty' in r.checked));
});

test('legacyStockPatch: eski alan "silinmiş gibi" boşaltılırsa (undefined/"") da değişikliktir → frozen', () => {
    const prev = legacyB1();
    assert.deepEqual(plain(S.legacyStockPatch('b1', prev, { ...prev, qty: '' })).frozen.map(f => f.key), ['qty']);
});

test('legacyStockPatch: kayıtta OLMAYAN ortak alan (B1\'e envanterNo) checked\'e girer — validateB1 kabul eder', () => {
    const prev = legacyB1();
    const r = plain(S.legacyStockPatch('b1', prev, { ...prev, envanterNo: 'ENV-1' }));
    assert.deepEqual(r.frozen, []);
    assert.deepEqual(r.checked, { envanterNo: 'ENV-1' });
    assert.deepEqual(S.validateB1(r.checked, { partial: true }), []);
});

test('legacyStockPatch: eski B1 kaydında ZATEN olan envanterNo\'nun değeri değişirse kanonik alan olarak kabul edilir', () => {
    const prev = { ...legacyB1(), envanterNo: 'ENV-OLD' };
    const r = plain(S.legacyStockPatch('b1', prev, { ...prev, envanterNo: 'ENV-NEW' }));
    assert.deepEqual(r.frozen, []);
    assert.deepEqual(r.checked, { envanterNo: 'ENV-NEW' });
});

test('legacyStockPatch: nesne değerlerinde anahtar sırası değişikliği "değişiklik" sayılmaz', () => {
    const prev = { ...legacyB1(), meta: { a: 1, b: 2 } };
    assert.deepEqual(plain(S.legacyStockPatch('b1', prev, { ...prev, meta: { b: 2, a: 1 } })).frozen, []);
});

// ─── (2) GERÇEK saveData — Firestore'a hiç gidilmediğinin kanıtı ───────────────────────────────────────────────────
test('saveData: eski qty: 5 KORUNURKEN ürün adı değişikliği KABUL edilir (yazma yapılır, qty aynen kalır)', async () => {
    const r = await saveLegacy({ ürün: 'Yeni Kablo Adı' });
    assert.equal(r.error, null, r.error && r.error.message);
    assert.equal(r.commits, 1, 'tek batch commit edildi');
    const set = r.ops.find(o => o.kind === 'set');
    assert.equal(set.data.ürün, 'Yeni Kablo Adı');
    assert.equal(set.data.qty, 5, 'eski alan değişmeden korunur (silinmez, dönüştürülmez)');
});

test('saveData: qty: 5 → -10 anında REDDEDİLİR — hiçbir batch kurulmaz, hiçbir commit çalışmaz', async () => {
    const r = await saveLegacy({ qty: -10 });
    assert.ok(r.error, 'hata fırlatılmalı');
    assert.equal(r.error.code, 'schema-violation');
    assert.match(r.error.message, /eski alan değiştirilemez: qty/);
    assert.deepEqual(r.error.details.frozen.map(f => [f.key, f.before, f.after]), [['qty', 5, -10]]);
    assert.equal(r.batches, 0, 'writeBatch hiç çağrılmadı');
    assert.equal(r.commits, 0, 'commit hiç çalışmadı');
    assert.deepEqual(r.ops, []);
});

test('saveData: qty değişikliği MEŞRU bir değişiklikle (ürün adı) birlikte gelse de TÜM çağrı reddedilir', async () => {
    const r = await saveLegacy({ ürün: 'Başka Ad', qty: 6 });
    assert.equal(r.error && r.error.code, 'schema-violation');
    assert.equal(r.batches, 0);
    assert.equal(r.commits, 0);
});

test('saveData: eski B1 kaydına yeni envanterNo eklenir', async () => {
    const r = await saveLegacy({ envanterNo: 'ENV-2026-001' });
    assert.equal(r.error, null, r.error && r.error.message);
    assert.equal(r.commits, 1);
    assert.equal(r.ops.find(o => o.kind === 'set').data.envanterNo, 'ENV-2026-001');
});

test('saveData: eski B1 kaydında zaten bulunan envanterNo değiştirilebilir', async () => {
    const r = await saveLegacy({ envanterNo: 'ENV-NEW' }, { ...legacyB1(), envanterNo: 'ENV-OLD' });
    assert.equal(r.error, null, r.error && r.error.message);
    assert.equal(r.commits, 1);
    assert.equal(r.ops.find(o => o.kind === 'set').data.envanterNo, 'ENV-NEW');
});

test('saveData: değişen KANONİK alanın yanlış tipi (adet: -3) eski kayıtta da reddedilir — commit yok', async () => {
    const r = await saveLegacy({ adet: -3 });
    assert.equal(r.error && r.error.code, 'schema-violation');
    assert.match(r.error.message, /geçersiz adet/);
    assert.equal(r.commits, 0);
});

test('saveData: çok kayıtlı çağrıda TEK bir dondurulmuş alan ihlali tüm çağrıyı durdurur (kısmi yazma yok)', async () => {
    window.userAuth = { uid: 'admin-uid' };
    window.data.config = {};
    const a = legacyB1(), b = { ...legacyB1(), id: 'b1_legacy_2' };
    window._dbMirror.b1 = [plain(a), plain(b)];
    resetSdk();
    const origErr = console.error;
    console.error = () => {};
    let error = null;
    try { await H.saveData('b1', [{ ...a, ürün: 'Geçerli Düzenleme' }, { ...b, qty: -1 }]); } catch (e) { error = e; } finally { console.error = origErr; }
    assert.equal(error && error.code, 'schema-violation');
    assert.equal(sdk().batches, 0);
    assert.equal(sdk().commits, 0);
});

test('raf dinleyicisi: yetki reddi sağlık durumuna yansır ve ensureRealtimeSync ölü dinleyiciyi yeniden kurar', () => {
    const previousDocument = globalThis.document;
    globalThis.document = { getElementById: () => null, body: null };
    window.userAuth = { uid: 'admin-uid' };
    window.isDbAdmin = () => true;
    sdk().listeners = [];
    const originalError = console.error;
    console.error = () => {};
    try {
        window.startRealtimeSync();
        const shelf = sdk().listeners.find(l => l.ref === 'inventory_demo/shelves/items');
        assert.ok(shelf, 'yönetici raf kataloğunu dinler');
        shelf.error({ code: 'permission-denied' });
        assert.deepEqual(window.getSyncHealth().denied, ['shelves']);
        assert.equal(window.ensureRealtimeSync(), 'restarted');
        assert.equal(shelf.stopped, true);
        const replacement = sdk().listeners.filter(l => l.ref === shelf.ref).at(-1);
        assert.notEqual(replacement, shelf);
        replacement.next({ docs: [{ id: 'b1_R1', data: () => ({ code: 'R1', depot: 'b1' }) }] });
        assert.deepEqual(window.getSyncHealth().denied, []);
        assert.equal(window.data.shelves[0].code, 'R1');
        assert.equal(window.ensureRealtimeSync(), 'healthy');
    } finally {
        console.error = originalError;
        window.stopRealtimeSync();
        globalThis.document = previousDocument;
    }
});
