// v3.3 · Aşama 2 — Stok defteri saf planlayıcısı (src/services/stock-ledger.js): planTransfer slot farkları, kapasite /
// aktiflik / katalog reddi, taze stok yeterliliği, operationId mükerrerliği, planShelfSave kapasite kuralları.
// Firestore transaction'ının kendisi tests/integration/stock-ledger.emu.test.mjs'te emülatöre karşı doğrulanır.
// Usage: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const plain = v => JSON.parse(JSON.stringify(v));

function load() {
    const ctx = vm.createContext({ window: {}, console });
    for (const f of ['src/utils/schema.js', 'src/services/stock-ledger.js']) {
        vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
    }
    return ctx.window.StockLedger;
}
const L = load();

const OP = 'op_test_000001';
const shelf = (depot, code, capacity, usedSlots, active = true) => ({ code, depot, capacity, usedSlots, active, updatedAt: 1, updatedBy: 'u' });
const src = (extra = {}) => ({
    id: 'b1_1', sütun: 'B1 -A', raf: 'Raf-A 1', tür: 'Kablo', ürün: 'HDMI', marka: 'X', adet: 10,
    durumu: 'Kullanıma Hazır', açıklama: '', isDemirbas: false, lastUpdate: 1, ...extra,
});
const input = (extra = {}) => ({
    operationId: OP, sourceCol: 'b1', sourceId: 'b1_1', targetCol: 'b2', qty: 10, targetShelf: 'Raf-1',
    targetColumn: 'Saha-1', note: '', newTargetId: 'b2_new', uid: 'admin-uid', now: 1000, ...extra,
});
const reads = (extra = {}) => ({
    op: null, source: src(), targetSameId: null,
    shelves: { 'b1_RAF-A 1': shelf('b1', 'RAF-A 1', 5, 3), 'b2_RAF-1': shelf('b2', 'RAF-1', 5, 2) },
    ...extra,
});
const rejectsWith = (fn, code) => assert.throws(fn, e => { assert.equal(e.code, code, e.message); return true; });
const writesOf = (plan, col) => plain(plan.writes.filter(w => w.col === col));

test('tam depo transferi: hedef aynı id ile kurulur, kaynak silinir; kaynak raf −1, hedef raf +1; işlem kaydı yazılır', () => {
    const p = L.planTransfer(input(), reads({ source: src({ envanterNo: 'ENV-1' }) }));
    assert.equal(p.duplicate, false);
    assert.equal(p.result.fullMove, true);
    const b2 = writesOf(p, 'b2');
    assert.equal(b2.length, 1);
    assert.equal(b2[0].kind, 'set');
    assert.equal(b2[0].id, 'b1_1');
    assert.equal(b2[0].data.adet, 10);
    assert.equal(b2[0].data.status, 'Kullanıma Hazır', 'b2 hedefinde status da yazılır');
    assert.equal(b2[0].data.raf, 'Raf-1', 'üründe seçilen yazım korunur (Aşama 4\'e kadar)');
    assert.equal(b2[0].data.envanterNo, 'ENV-1', 'benzersiz Envanter No tam transferde korunur');
    assert.deepEqual(writesOf(p, 'b1'), [{ kind: 'delete', col: 'b1', id: 'b1_1' }]);
    assert.deepEqual(plain(p.result.shelves).sort((a, b) => a.id.localeCompare(b.id)),
        [{ id: 'b1_RAF-A 1', before: 3, after: 2 }, { id: 'b2_RAF-1', before: 2, after: 3 }]);
    const op = writesOf(p, 'stockOperations');
    assert.equal(op.length, 1);
    assert.equal(op[0].id, OP);
    assert.equal(op[0].data.stockBefore, 10);
    assert.equal(op[0].data.stockAfter, 0);
});

test('kısmi transfer: kaynak TAZE adetten düşülür (istemci kopyası değil), hedefte önceden üretilmiş yeni id; kaynak rafı değişmez', () => {
    const p = L.planTransfer(input({ qty: 4 }), reads({ source: src({ adet: 7 }) }));   // istemci 10 sanıyor, sunucuda 7
    assert.equal(p.result.fullMove, false);
    assert.equal(p.result.stockBefore, 7);
    assert.equal(p.result.stockAfter, 3);
    assert.deepEqual(writesOf(p, 'b1').map(w => [w.kind, w.data.adet]), [['update', 3]]);
    assert.equal(writesOf(p, 'b2')[0].id, 'b2_new');
    assert.deepEqual(plain(p.result.shelves), [{ id: 'b2_RAF-1', before: 2, after: 3 }], 'kaynak rafında kayıt pozitif kalır → slot değişmez');
});

test('Envanter No bulunan ürün kısmi transfer edilemez; aynı kimlik iki kayda kopyalanmaz', () => {
    rejectsWith(() => L.planTransfer(input({ qty: 4 }), reads({ source: src({ adet: 7, envanterNo: 'ENV-1' }) })), 'invalid-argument');
});

test('taze stok yetersizse insufficient-stock (eşzamanlı başka çıkış)', () => {
    rejectsWith(() => L.planTransfer(input({ qty: 8 }), reads({ source: src({ adet: 5 }) })), 'insufficient-stock');
});

test('kaynak ürün artık yoksa not-found', () => {
    rejectsWith(() => L.planTransfer(input(), reads({ source: null })), 'not-found');
});

test('hedef raf dolu → shelf-full (yazma planı oluşmaz)', () => {
    rejectsWith(() => L.planTransfer(input(), reads({ shelves: { 'b1_RAF-A 1': shelf('b1', 'RAF-A 1', 5, 3), 'b2_RAF-1': shelf('b2', 'RAF-1', 5, 5) } })), 'shelf-full');
});

test('hedef raf katalogda yok → shelf-missing; pasif → shelf-inactive', () => {
    rejectsWith(() => L.planTransfer(input(), reads({ shelves: { 'b1_RAF-A 1': shelf('b1', 'RAF-A 1', 5, 3) } })), 'shelf-missing');
    rejectsWith(() => L.planTransfer(input(), reads({ shelves: { 'b1_RAF-A 1': shelf('b1', 'RAF-A 1', 5, 3), 'b2_RAF-1': shelf('b2', 'RAF-1', 5, 0, false) } })), 'shelf-inactive');
});

test('hedef raf kodu yazım farkı aynı rafa çözülür ("raf - 1" → b2_RAF-1)', () => {
    const p = L.planTransfer(input({ targetShelf: ' raf - 1 ' }), reads());
    assert.ok(p.result.shelves.some(s => s.id === 'b2_RAF-1' && s.after === 3));
    assert.equal(p.result.targetShelfId, 'b2_RAF-1');
});

test('kaynak raf katalogda yoksa sayaç atlanır (geçiş dönemi); hedef yine zorunlu', () => {
    const p = L.planTransfer(input(), reads({ shelves: { 'b2_RAF-1': shelf('b2', 'RAF-1', 5, 2) } }));
    assert.deepEqual(plain(p.result.shelves), [{ id: 'b2_RAF-1', before: 2, after: 3 }]);
});

test('kaynak sayacı 0 ise eksiye düşmez (kayma uzlaştırmada düzeltilir)', () => {
    const p = L.planTransfer(input(), reads({ shelves: { 'b1_RAF-A 1': shelf('b1', 'RAF-A 1', 5, 0), 'b2_RAF-1': shelf('b2', 'RAF-1', 5, 2) } }));
    assert.ok(p.result.shelves.some(s => s.id === 'b1_RAF-A 1' && s.after === 0));
});

test('pasif ürün slot işgal etmez: hedef rafa slot istemez, kaynak rafı da düşmez', () => {
    const p = L.planTransfer(input(), reads({ source: src({ durumu: 'Pasif' }), shelves: {} }));
    assert.deepEqual(plain(p.result.shelves), []);
    assert.equal(writesOf(p, 'shelves').length, 0);
});

test('hedef depoda aynı id varsa (tam taşıma) conflict — üzerine yazılmaz', () => {
    rejectsWith(() => L.planTransfer(input(), reads({ targetSameId: { id: 'b1_1', adet: 1 } })), 'conflict');
});

test('aynı depoda başka rafa tam taşıma = konum güncellemesi (kimlik korunur), −1/+1', () => {
    const p = L.planTransfer(input({ targetCol: 'b1', targetShelf: 'Raf-B 2' }),
        reads({ shelves: { 'b1_RAF-A 1': shelf('b1', 'RAF-A 1', 5, 3), 'b1_RAF-B 2': shelf('b1', 'RAF-B 2', 5, 1) } }));
    assert.deepEqual(writesOf(p, 'b1').map(w => [w.kind, w.id, w.data.raf]), [['update', 'b1_1', 'Raf-B 2']]);
    assert.deepEqual(plain(p.result.shelves).sort((a, b) => a.id.localeCompare(b.id)),
        [{ id: 'b1_RAF-A 1', before: 3, after: 2 }, { id: 'b1_RAF-B 2', before: 1, after: 2 }]);
    rejectsWith(() => L.planTransfer(input({ targetCol: 'b1', targetShelf: 'raf-a 1' }), reads()), 'invalid-argument');
});

test('operationId kaydı varsa: aynı istek → duplicate (yazma yok); farklı istek → operation-conflict', () => {
    const first = L.planTransfer(input(), reads());
    const opDoc = { ...plain(writesOf(first, 'stockOperations')[0].data) };
    const again = L.planTransfer(input(), { op: opDoc });
    assert.equal(again.duplicate, true);
    assert.equal(again.writes, undefined);
    assert.equal(again.result.stockAfter, 0);
    rejectsWith(() => L.planTransfer(input({ qty: 3 }), { op: opDoc }), 'operation-conflict');
});

test('giriş doğrulaması: işlem kimliği, depo, adet, hedef raf', () => {
    rejectsWith(() => L.planTransfer(input({ operationId: 'kısa' }), reads()), 'invalid-argument');
    rejectsWith(() => L.planTransfer(input({ sourceCol: 'b3' }), reads()), 'invalid-argument');
    rejectsWith(() => L.planTransfer(input({ qty: 0 }), reads()), 'invalid-argument');
    rejectsWith(() => L.planTransfer(input({ qty: 1.5 }), reads()), 'invalid-argument');
    rejectsWith(() => L.planTransfer(input({ targetShelf: 'A/1' }), reads()), 'invalid-argument');
    rejectsWith(() => L.planTransfer(input({ targetShelf: '-' }), reads()), 'invalid-argument');
});

test('newOperationId: kural deseniyle uyumlu ve benzersiz', () => {
    const ids = new Set(Array.from({ length: 50 }, () => L.newOperationId()));
    assert.equal(ids.size, 50);
    for (const id of ids) assert.match(id, /^[A-Za-z0-9_-]{8,80}$/);
});

test('planShelfSave: yeni raf kanonik belge, kullanım altında kapasite reddi; mevcut rafta kapasite kullanımın altına inemez', () => {
    const created = L.planShelfSave({ depot: 'b1', code: ' raf-a 1 ', capacity: 6, usedSlotsIfNew: 4, uid: 'u' }, null);
    assert.equal(created.kind, 'set');
    assert.equal(created.id, 'b1_RAF-A 1');
    assert.equal(created.data.code, 'RAF-A 1');
    assert.equal(created.data.usedSlots, 4);
    assert.equal(created.data.active, true);
    rejectsWith(() => L.planShelfSave({ depot: 'b1', code: 'A', capacity: 3, usedSlotsIfNew: 4, uid: 'u' }, null), 'capacity-below-usage');
    const upd = L.planShelfSave({ depot: 'b1', code: 'RAF-A 1', capacity: 9, uid: 'u' }, shelf('b1', 'RAF-A 1', 5, 5));
    assert.equal(upd.kind, 'update');
    assert.deepEqual(Object.keys(upd.data).sort(), ['capacity', 'updatedAt', 'updatedBy']);
    rejectsWith(() => L.planShelfSave({ depot: 'b1', code: 'RAF-A 1', capacity: 4, uid: 'u' }, shelf('b1', 'RAF-A 1', 5, 5)), 'capacity-below-usage');
    for (const capacity of [0, 201, 2.5]) rejectsWith(() => L.planShelfSave({ depot: 'b1', code: 'A', capacity, usedSlotsIfNew: 0 }, null), 'invalid-argument');
    rejectsWith(() => L.planShelfSave({ depot: 'b1', code: 'A/1', capacity: 5, usedSlotsIfNew: 0 }, null), 'invalid-argument');
});

// ─── planShelfCounterWrites (v3.3 Aşama 4 · paylaşılan raf sayacı matematiği) ──────────────────────────────────────

test('planShelfCounterWrites: requireCatalog varsayılan true — katalogda olmayan raf ARTIŞTA shelf-missing fırlatır', () => {
    rejectsWith(() => L.planShelfCounterWrites(new Map([['b1_RAF-X 1', 1]]), {}, 'u'), 'shelf-missing');
});

test('planShelfCounterWrites: requireCatalog:false — katalogda olmayan raf ARTIŞTA sessizce atlanır (yazma/hata yok)', () => {
    const { shelves, writes } = L.planShelfCounterWrites(new Map([['b1_RAF-X 1', 1]]), {}, 'u', { requireCatalog: false });
    assert.deepEqual(plain(shelves), []);
    assert.deepEqual(plain(writes), []);
});

test('planShelfCounterWrites: requireCatalog:false — katalogda OLAN rafta kapasite/aktiflik yine de uygulanır', () => {
    const full = { 'b1_RAF-X 1': shelf('b1', 'RAF-X 1', 2, 2) };
    rejectsWith(() => L.planShelfCounterWrites(new Map([['b1_RAF-X 1', 1]]), full, 'u', { requireCatalog: false }), 'shelf-full');
    const inactive = { 'b1_RAF-X 1': shelf('b1', 'RAF-X 1', 5, 0, false) };
    rejectsWith(() => L.planShelfCounterWrites(new Map([['b1_RAF-X 1', 1]]), inactive, 'u', { requireCatalog: false }), 'shelf-inactive');
});

test('planShelfCounterWrites: AZALIŞ her zaman serbest; katalogda olmayan raf için düşülecek sayaç yoksayılır (her iki modda)', () => {
    for (const requireCatalog of [true, false]) {
        const { shelves, writes } = L.planShelfCounterWrites(new Map([['b1_RAF-X 1', -1]]), {}, 'u', { requireCatalog });
        assert.deepEqual(plain(shelves), []);
        assert.deepEqual(plain(writes), []);
    }
    const { shelves } = L.planShelfCounterWrites(new Map([['b1_RAF-X 1', -1]]), { 'b1_RAF-X 1': shelf('b1', 'RAF-X 1', 5, 0) }, 'u');
    assert.deepEqual(plain(shelves), [{ id: 'b1_RAF-X 1', before: 0, after: 0 }], 'sayaç 0ın altına inmez');
});

test('planShelfCounterWrites: delta 0 veya shelfId yoksa yoksayılır; birden çok rafı tek seferde işler', () => {
    const deltas = new Map([['', 5], ['b1_A', 0], ['b1_B', 1], ['b1_C', -1]]);
    const reads = { 'b1_B': shelf('b1', 'B', 3, 1), 'b1_C': shelf('b1', 'C', 3, 2) };
    const { shelves } = L.planShelfCounterWrites(deltas, reads, 'u');
    assert.deepEqual(plain(shelves).sort((a, b) => a.id.localeCompare(b.id)),
        [{ id: 'b1_B', before: 1, after: 2 }, { id: 'b1_C', before: 2, after: 1 }]);
});

// ─── planProductSave (v3.3 Aşama 4 · saveProduct transaction'a bağlanması) ──────────────────────────────────────────

const newB1Fields = () => ({
    sütun: 'B1 -A', raf: 'Raf-A 1', tür: 'Kablo', ürün: 'HDMI Kablo', marka: 'Acme',
    adet: 3, durumu: 'Kullanıma Hazır', açıklama: '', isDemirbas: false, lastUpdate: 1000,
});
const existingB1 = (extra = {}) => ({
    id: 'b1_old1', sütun: 'B1 -A', raf: 'Raf-A 1', tür: 'Kablo', ürün: 'Eski Kablo', marka: 'Acme',
    adet: 2, durumu: 'Kullanıma Hazır', açıklama: '', isDemirbas: false, lastUpdate: 500, ...extra,
});

test('planProductSave: yeni kayıt — hedef raf katalogda olmasa da yazılır (geçiş dönemi, requireCatalog:false)', () => {
    const plan = L.planProductSave({ col: 'b1', id: 'b1_new1', isNew: true, fields: newB1Fields(), uid: 'u' }, { existing: null, shelves: {} });
    assert.equal(plan.result.created, true);
    assert.deepEqual(plain(plan.result.shelves), []);
    const sets = plain(plan.writes).filter(w => w.kind === 'set' && w.col === 'b1');
    assert.equal(sets.length, 1);
    assert.equal(sets[0].id, 'b1_new1');
    assert.equal(sets[0].data.adet, 3);
    assert.deepEqual(plain(plan.writes).filter(w => w.col === 'shelves'), []);
});

test('planProductSave: yeni kayıt — hedef raf katalogda VE doluysa shelf-full (hiçbir şey yazılmaz)', () => {
    const shelves = { 'b1_RAF-A 1': shelf('b1', 'RAF-A 1', 1, 1) };
    rejectsWith(() => L.planProductSave({ col: 'b1', id: 'b1_new1', isNew: true, fields: newB1Fields(), uid: 'u' }, { existing: null, shelves }), 'shelf-full');
});

test('planProductSave: yeni kayıt — hedef raf katalogda VE müsaitse sayaç +1 yazılır', () => {
    const shelves = { 'b1_RAF-A 1': shelf('b1', 'RAF-A 1', 5, 2) };
    const plan = L.planProductSave({ col: 'b1', id: 'b1_new1', isNew: true, fields: newB1Fields(), uid: 'u' }, { existing: null, shelves });
    assert.deepEqual(plain(plan.result.shelves), [{ id: 'b1_RAF-A 1', before: 2, after: 3 }]);
});

test('planProductSave: yeni kayıt — pasif/stok dışı ürün slot istemez; şema ihlali reddedilir; aynı id çakışması conflict', () => {
    const passive = L.planProductSave({ col: 'b1', id: 'b1_new1', isNew: true, fields: { ...newB1Fields(), durumu: 'Pasif' }, uid: 'u' },
        { existing: null, shelves: { 'b1_RAF-A 1': shelf('b1', 'RAF-A 1', 1, 1) } });
    assert.deepEqual(plain(passive.result.shelves), []);   // dolu rafa bile yazılabilir çünkü slot istemiyor
    rejectsWith(() => L.planProductSave({ col: 'b1', id: 'b1_new1', isNew: true, fields: { ürün: 'x' }, uid: 'u' }, { existing: null, shelves: {} }), 'schema-violation');
    rejectsWith(() => L.planProductSave({ col: 'b1', id: 'b1_new1', isNew: true, fields: newB1Fields(), uid: 'u' }, { existing: existingB1({ id: 'b1_new1' }), shelves: {} }), 'conflict');
});

test('planProductSave: düzenleme — yalnız fields yazılır (diğer alanlar korunur); kayıt yoksa not-found', () => {
    const plan = L.planProductSave({ col: 'b1', id: 'b1_old1', isNew: false, fields: { adet: 5 }, uid: 'u' }, { existing: existingB1(), shelves: {} });
    assert.deepEqual(plain(plan.writes).filter(w => w.col === 'b1'), [{ kind: 'update', col: 'b1', id: 'b1_old1', data: { adet: 5 } }]);
    rejectsWith(() => L.planProductSave({ col: 'b1', id: 'b1_yok', isNew: false, fields: { adet: 5 }, uid: 'u' }, { existing: null, shelves: {} }), 'not-found');
});

test('planProductSave: düzenleme — raf değişimi (taşıma) kaynaktan −1, hedefe +1 yazar; kaynak kaydı aynen korunur', () => {
    const shelves = { 'b1_RAF-A 1': shelf('b1', 'RAF-A 1', 5, 1), 'b1_RAF-B 2': shelf('b1', 'RAF-B 2', 5, 0) };
    const plan = L.planProductSave({ col: 'b1', id: 'b1_old1', isNew: false, fields: { raf: 'Raf-B 2' }, uid: 'u' },
        { existing: existingB1(), shelves });
    assert.deepEqual(plain(plan.result.shelves).sort((a, b) => a.id.localeCompare(b.id)),
        [{ id: 'b1_RAF-A 1', before: 1, after: 0 }, { id: 'b1_RAF-B 2', before: 0, after: 1 }]);
});

test('planProductSave: düzenleme — occupancy hesabı reads.existing (TAZE okuma) üzerindendir; fields adedi değiştirmezse önceki adet geçerlidir', () => {
    // existing'in kendisi burada "transaction içinde taze okunmuş" halidir (P1-01'deki aynı ilke): adet 0 ise — istemcinin
    // window.data'da ne sandığından bağımsız — kaynak zaten slot işgal etmiyordu; yalnız raf alanı değiştiğinde dahi delta oluşmaz.
    const shelves = { 'b1_RAF-A 1': shelf('b1', 'RAF-A 1', 5, 1), 'b1_RAF-B 2': shelf('b1', 'RAF-B 2', 5, 0) };
    const plan = L.planProductSave({ col: 'b1', id: 'b1_old1', isNew: false, fields: { raf: 'Raf-B 2' }, uid: 'u' },
        { existing: existingB1({ adet: 0 }), shelves });
    assert.deepEqual(plain(plan.result.shelves), [], 'adet 0 olduğu için ne kaynakta ne hedefte slot değişir');
});

test('planProductSave: düzenleme — aynı rafta kalıp durum Pasif olunca kaynak rafı −1 olur (katalogda ise)', () => {
    const shelves = { 'b1_RAF-A 1': shelf('b1', 'RAF-A 1', 5, 3) };
    const plan = L.planProductSave({ col: 'b1', id: 'b1_old1', isNew: false, fields: { durumu: 'Pasif' }, uid: 'u' },
        { existing: existingB1(), shelves });
    assert.deepEqual(plain(plan.result.shelves), [{ id: 'b1_RAF-A 1', before: 3, after: 2 }]);
});

test('planProductSave: düzenleme — bilinmeyen/eski alan reddedilir (applyItemOps update guard ile aynı kural); isWatched serbest', () => {
    rejectsWith(() => L.planProductSave({ col: 'b1', id: 'b1_old1', isNew: false, fields: { status: 'Pasif' }, uid: 'u' }, { existing: existingB1(), shelves: {} }), 'schema-violation');
    rejectsWith(() => L.planProductSave({ col: 'b1', id: 'b1_old1', isNew: false, fields: { limitXYZ: 1 }, uid: 'u' }, { existing: existingB1(), shelves: {} }), 'schema-violation');
    const plan = L.planProductSave({ col: 'b1', id: 'b1_old1', isNew: false, fields: { isWatched: true }, uid: 'u' }, { existing: existingB1(), shelves: {} });
    assert.deepEqual(plain(plan.result.shelves), []);
});

test('planProductSave: katı şema — B1/B2 envanterNo alanını destekler, yanlış tipleri reddeder', () => {
    const edit = fields => () => L.planProductSave({ col: 'b1', id: 'b1_old1', isNew: false, fields, uid: 'u' }, { existing: existingB1(), shelves: {} });
    rejectsWith(edit({ ürün: 123 }), 'schema-violation');
    rejectsWith(edit({ raf: 7 }), 'schema-violation');
    rejectsWith(edit({ isDemirbas: 'evet' }), 'schema-violation');
    edit({ envanterNo: 'ENV-1' })();
    L.planProductSave({ col: 'b1', id: 'b1_n', isNew: true, fields: { ...newB1Fields(), envanterNo: 'E' }, uid: 'u' }, { existing: null, shelves: {} });
    // B2: envanterNo string serbest, sayı reddedilir (yeni kayıtta ve düzenlemede)
    const b2 = { ...existingB1({ id: 'b2_old1', status: 'Kullanıma Hazır', isDemirbas: true }) };
    const editB2 = fields => () => L.planProductSave({ col: 'b2', id: 'b2_old1', isNew: false, fields, uid: 'u' }, { existing: b2, shelves: {} });
    editB2({ envanterNo: 'ENV-2' })();
    rejectsWith(editB2({ envanterNo: 42 }), 'schema-violation');
    // Meşru form düzenlemesi (formun tüm alanları) etkilenmez
    edit({ ...newB1Fields() })();
});

// ─── planShelfSync (v3.3 Aşama 6 · Veri Geçişi — raf sayaçları uzlaştırması) ────────────────────────────────────────

const stockItem = (id, raf, adet = 1, extra = {}) => ({
    id, sütun: 'A', raf, tür: 'Kablo', ürün: 'X', marka: '', adet, durumu: 'Kullanıma Hazır', açıklama: '',
    isDemirbas: false, lastUpdate: 1, ...extra,
});

test('planShelfSync: sayım kataloktaki usedSlots ile ZATEN aynıysa hiçbir şey yazılmaz (unchanged)', () => {
    const items = { b1: [stockItem('p1', 'Raf-A 1'), stockItem('p2', 'Raf-A 1')], b2: [] };
    const shelfDocs = { 'b1_RAF-A 1': shelf('b1', 'RAF-A 1', 5, 2) };
    const r = L.planShelfSync(items, shelfDocs, { uid: 'u' });
    assert.deepEqual(plain(r.writes), []);
    assert.deepEqual(plain(r.updated), []);
    assert.deepEqual(plain(r.capacityRaised), []);
    assert.deepEqual(plain(r.unregistered), []);
    assert.equal(r.unchanged, 1);
    assert.deepEqual(plain(r.pool), { b1: 0, b2: 0, total: 0 });
});

test('planShelfSync: sayım farklıysa (kapasite içinde) usedSlots güncellenir', () => {
    const items = { b1: [stockItem('p1', 'Raf-A 1')], b2: [] };   // gerçek: 1, kayıtlı: 3 (ör. 2 ürün taşınmış)
    const shelfDocs = { 'b1_RAF-A 1': shelf('b1', 'RAF-A 1', 5, 3) };
    const r = L.planShelfSync(items, shelfDocs, { uid: 'admin-uid' });
    assert.equal(r.writes.length, 1);
    const w = r.writes[0];
    assert.equal(w.col, 'shelves'); assert.equal(w.id, 'b1_RAF-A 1');
    assert.equal(w.data.usedSlots, 1); assert.equal(w.data.updatedBy, 'admin-uid');
    assert.equal(w.data.updatedAt, L.SERVER_TIME, 'sunucu zamanı yer tutucusu (yürütücü serverTimestamp()e çevirir)');
    assert.deepEqual(Object.keys(w.data).sort(), ['updatedAt', 'updatedBy', 'usedSlots']);
    assert.deepEqual(plain(r.updated), [{ id: 'b1_RAF-A 1', code: 'RAF-A 1', depot: 'b1', before: 3, after: 1 }]);
    assert.equal(r.unchanged, 0);
});

test('planShelfSync: tamamen boşalmış raf (kullanım 0, usedSlots eski kalmış) DA düzeltilir — usage objesinde hiç anahtar olarak geçmez', () => {
    const items = { b1: [], b2: [] };   // Raf-A 1'de artık HİÇ ürün yok
    const shelfDocs = { 'b1_RAF-A 1': shelf('b1', 'RAF-A 1', 5, 4) };
    const r = L.planShelfSync(items, shelfDocs, { uid: 'u' });
    assert.deepEqual(plain(r.updated), [{ id: 'b1_RAF-A 1', code: 'RAF-A 1', depot: 'b1', before: 4, after: 0 }]);
});

test('planShelfSync: gerçek sayım kapasiteyi aşıyorsa kapasite sayıma YÜKSELTİLİR ve ayrıca raporlanır (durdurmaz)', () => {
    const items = { b1: [stockItem('p1', 'Raf-A 1'), stockItem('p2', 'Raf-A 1'), stockItem('p3', 'Raf-A 1')], b2: [] };
    const shelfDocs = { 'b1_RAF-A 1': shelf('b1', 'RAF-A 1', 2, 2) };   // kapasite 2, gerçek 3
    const r = L.planShelfSync(items, shelfDocs, { uid: 'u' });
    assert.equal(r.writes.length, 1);
    assert.deepEqual(plain(r.writes[0].data).usedSlots, 3);
    assert.deepEqual(plain(r.writes[0].data).capacity, 3, 'kural usedSlots<=capacity gerektirir; kapasite sayıma yükseltilir');
    assert.deepEqual(plain(r.capacityRaised), [{ id: 'b1_RAF-A 1', code: 'RAF-A 1', depot: 'b1', before: 2, capacityBefore: 2, after: 3 }]);
    assert.deepEqual(plain(r.updated), [], 'kapasite aşımı updated değil capacityRaised listesine düşer');
});

test('planShelfSync: raf koduna sahip ürün var ama katalogda YOKSA — unregistered listelenir, yazma yapılmaz, işlem durmaz', () => {
    const items = { b1: [stockItem('p1', 'Eski Raf 9'), stockItem('p2', 'Eski Raf 9')], b2: [] };
    const r = L.planShelfSync(items, {}, { uid: 'u' });
    assert.deepEqual(plain(r.writes), []);
    assert.deepEqual(plain(r.unregistered), [{ depot: 'b1', code: 'ESKI RAF 9', count: 2 }]);
});

test('planShelfSync: rafsız (Havuz) ürünler ayrı sayılır — hiçbir raf belgesine yazılmaz, unregistered\'a da düşmez', () => {
    const items = { b1: [stockItem('p1', ''), stockItem('p2', null)], b2: [stockItem('p3', '-')] };
    const r = L.planShelfSync(items, {}, { uid: 'u' });
    assert.deepEqual(plain(r.writes), []);
    assert.deepEqual(plain(r.unregistered), []);
    assert.deepEqual(plain(r.pool), { b1: 2, b2: 1, total: 3 });
});

test('planShelfSync: pasif/stok dışı ürünler hiçbir sayıma (ne raf ne havuz) girmez', () => {
    const items = { b1: [stockItem('p1', 'Raf-A 1', 1, { durumu: 'Pasif' }), stockItem('p2', '', 0)], b2: [] };
    const r = L.planShelfSync(items, { 'b1_RAF-A 1': shelf('b1', 'RAF-A 1', 5, 0) }, { uid: 'u' });
    assert.equal(r.unchanged, 1, 'Raf-A 1 zaten 0 — pasif ürün sayılmadığı için değişiklik yok');
    assert.deepEqual(plain(r.pool), { b1: 0, b2: 0, total: 0 });
});

test('planShelfSync: her iki depo bağımsız işlenir; farklı depoda AYNI kod farklı belgeye karşılık gelir', () => {
    const items = { b1: [stockItem('p1', 'RAF-1')], b2: [stockItem('p2', 'RAF-1'), stockItem('p3', 'RAF-1')] };
    const shelfDocs = { 'b1_RAF-1': shelf('b1', 'RAF-1', 5, 1), 'b2_RAF-1': shelf('b2', 'RAF-1', 5, 1) };
    const r = L.planShelfSync(items, shelfDocs, { uid: 'u' });
    assert.deepEqual(plain(r.updated).sort((a, b) => a.depot.localeCompare(b.depot)),
        [{ id: 'b2_RAF-1', code: 'RAF-1', depot: 'b2', before: 1, after: 2 }]);
    assert.equal(r.unchanged, 1, 'b1_RAF-1 zaten doğruydu');
});

test('planShelfSync: katalogda depot/code alanı bozuk ya da eksik olan belgeler yok sayılır (çökmeden atlanır)', () => {
    const shelfDocs = { bad1: { code: 'X' }, bad2: { depot: 'b1' }, bad3: null };
    const r = L.planShelfSync({ b1: [], b2: [] }, shelfDocs, { uid: 'u' });
    assert.deepEqual(plain(r.writes), []);
    assert.deepEqual(plain(r.unregistered), []);
});

// ─── v3.6 · Raf sayım kilidi ────────────────────────────────────────────────────────────────────────────────────────

const lockedShelf = (depot, code, capacity, usedSlots) => ({
    ...shelf(depot, code, capacity, usedSlots, false), lockReason: 'Yıl sonu sayımı', lockedAt: 1, lockedBy: 'admin-uid',
});
const row = (id, extra = {}) => ({ id, data: { ...src({ id }), ...extra } });

test('v3.6 transfer: sayımdaki kaynak raftan (raf kilidi ya da kayıt bayrağı) ve sayımdaki hedef rafa taşıma shelf-locked; hiçbir şey yazılmaz', () => {
    rejectsWith(() => L.planTransfer(input(), reads({ shelves: { 'b1_RAF-A 1': lockedShelf('b1', 'RAF-A 1', 5, 3), 'b2_RAF-1': shelf('b2', 'RAF-1', 5, 2) } })), 'shelf-locked');
    rejectsWith(() => L.planTransfer(input(), reads({ source: src({ rafPasif: true }) })), 'shelf-locked');
    rejectsWith(() => L.planTransfer(input(), reads({ shelves: { 'b1_RAF-A 1': shelf('b1', 'RAF-A 1', 5, 3), 'b2_RAF-1': lockedShelf('b2', 'RAF-1', 5, 2) } })), 'shelf-locked');
    assert.equal(L.planTransfer(input(), reads()).duplicate, false, 'kilit yokken transfer eskisi gibi');
});

test('v3.6 ürün kaydı: sayımdaki rafa yeni ürün, sayımdaki raftan/rafa taşıma reddedilir', () => {
    const lockedA1 = { 'b1_RAF-A 1': lockedShelf('b1', 'RAF-A 1', 5, 2) };
    rejectsWith(() => L.planProductSave({ col: 'b1', id: 'b1_new1', isNew: true, fields: { ...newB1Fields(), adet: 0 }, uid: 'u' }, { existing: null, shelves: lockedA1 }), 'shelf-locked');
    rejectsWith(() => L.planProductSave({ col: 'b1', id: 'b1_old1', isNew: false, fields: { raf: 'Raf-A 2' }, uid: 'u' },
        { existing: existingB1({ rafPasif: true }), shelves: { ...lockedA1, 'b1_RAF-A 2': shelf('b1', 'RAF-A 2', 5, 0) } }), 'shelf-locked');
    rejectsWith(() => L.planProductSave({ col: 'b1', id: 'b1_old1', isNew: false, fields: { raf: 'Raf-A 1' }, uid: 'u' },
        { existing: existingB1({ raf: 'Raf-A 2' }), shelves: { ...lockedA1, 'b1_RAF-A 2': shelf('b1', 'RAF-A 2', 5, 1) } }), 'shelf-locked');
});

test('v3.6 sayım düzeltmesi: kilitli AYNI rafta 0→N adet serbest (shelf-inactive değil), kapasite yine uygulanır, eski active:false raf etkilenmez', () => {
    const plan = L.planProductSave({ col: 'b1', id: 'b1_old1', isNew: false, fields: { adet: 4, durumu: 'Kullanıma Hazır' }, uid: 'u' },
        { existing: existingB1({ adet: 0, durumu: 'Tükendi', rafPasif: true }), shelves: { 'b1_RAF-A 1': lockedShelf('b1', 'RAF-A 1', 5, 2) } });
    assert.deepEqual(plain(plan.result.shelves), [{ id: 'b1_RAF-A 1', before: 2, after: 3 }]);
    assert.equal(plan.result.qtyBefore, 0);
    assert.equal(plan.result.qtyAfter, 4);
    rejectsWith(() => L.planProductSave({ col: 'b1', id: 'b1_old1', isNew: false, fields: { adet: 4, durumu: 'Kullanıma Hazır' }, uid: 'u' },
        { existing: existingB1({ adet: 0, durumu: 'Tükendi', rafPasif: true }), shelves: { 'b1_RAF-A 1': lockedShelf('b1', 'RAF-A 1', 2, 2) } }), 'shelf-full');
    rejectsWith(() => L.planProductSave({ col: 'b1', id: 'b1_old1', isNew: false, fields: { adet: 4, durumu: 'Kullanıma Hazır' }, uid: 'u' },
        { existing: existingB1({ adet: 0, durumu: 'Tükendi' }), shelves: { 'b1_RAF-A 1': shelf('b1', 'RAF-A 1', 5, 2, false) } }), 'shelf-inactive');
});

test('v3.6 ürün kaydı: bayrak rafın gerçek durumundan yazılır — formdan gelen rafPasif yok sayılır, kayma kendiliğinden düzelir', () => {
    const write = p => plain(p.writes).find(w => w.col === 'b1');
    const healed = L.planProductSave({ col: 'b1', id: 'b1_old1', isNew: false, fields: { ürün: 'Yeni ad', rafPasif: true }, uid: 'u' },
        { existing: existingB1({ rafPasif: true }), shelves: { 'b1_RAF-A 1': shelf('b1', 'RAF-A 1', 5, 1) } });
    assert.equal(write(healed).data.rafPasif, false, 'kilitsiz rafta kalmış bayrak kalkar');
    const flagged = L.planProductSave({ col: 'b1', id: 'b1_old1', isNew: false, fields: { ürün: 'Yeni ad' }, uid: 'u' },
        { existing: existingB1(), shelves: { 'b1_RAF-A 1': lockedShelf('b1', 'RAF-A 1', 5, 1) } });
    assert.equal(write(flagged).data.rafPasif, true, 'kilitli rafta bayrağı eksik kayıt işaretlenir');
    const untouched = L.planProductSave({ col: 'b1', id: 'b1_old1', isNew: false, fields: { ürün: 'Yeni ad' }, uid: 'u' },
        { existing: existingB1(), shelves: {} });
    assert.equal('rafPasif' in write(untouched).data, false, 'kilitsiz kayıtta alan hiç yazılmaz');
    const created = L.planProductSave({ col: 'b1', id: 'b1_new1', isNew: true, fields: { ...newB1Fields(), rafPasif: true }, uid: 'u' }, { existing: null, shelves: {} });
    assert.equal('rafPasif' in plain(created.writes).find(w => w.col === 'b1').data, false, 'yeni kayıtta bayrağı yalnız raf kilidi yazar');
});

test('v3.6 planShelfLock: kilit gerekçe ister; raf yazımı sunucu saati + uid; kayıt bayrakları yalnız gerekeni yazar; idempotent', () => {
    rejectsWith(() => L.planShelfLock({ depot: 'b1', code: 'Raf-A 1', locked: true, reason: '  ', uid: 'u' }, shelf('b1', 'RAF-A 1', 5, 2), []), 'invalid-argument');
    rejectsWith(() => L.planShelfLock({ depot: 'b1', code: 'Raf-A 1', locked: true, reason: 'x', uid: 'u' }, null, []), 'shelf-missing');
    const rows = [row('a', { rafPasif: true }), row('b'), row('c', { raf: 'Raf-A 2' })];
    const p = L.planShelfLock({ depot: 'b1', code: 'raf-a 1', locked: true, reason: ' Yıl  sonu <b>sayımı</b> ', uid: 'u' }, shelf('b1', 'RAF-A 1', 5, 2), rows);
    const w = plain(p.shelfWrite);
    assert.equal(w.id, 'b1_RAF-A 1');
    assert.equal(w.data.active, false);
    assert.equal(w.data.lockReason, 'Yıl sonu ‹b>sayımı‹/b>', 'boşluk sadeleşir, etiket işareti kurala takılmayacak biçime çevrilir');
    assert.deepEqual(w.data.lockedAt, plain(L.SERVER_TIME));
    assert.equal(w.data.lockedBy, 'u');
    assert.deepEqual(plain(p.rowWrites), [{ kind: 'update', col: 'b1', id: 'b', data: { rafPasif: true } }], 'yalnız bu rafta bayrağı eksik kayıt');
    assert.equal(p.audit.type, 'raf-sayima-alindi');
    assert.equal(p.audit.qty, 2);
    const again = L.planShelfLock({ depot: 'b1', code: 'RAF-A 1', locked: true, reason: 'başka', uid: 'u' }, lockedShelf('b1', 'RAF-A 1', 5, 2), rows);
    assert.equal(again.shelfWrite, null, 'zaten kilitli: raf yazılmaz');
    assert.equal(again.audit, null, 'ikinci kez denetim kaydı yok');
});

test('v3.6 planShelfLock: kilit kaldırma üç alanı siler, active:true; yalnız bayraklı kayıtlara false yazar', () => {
    const p = L.planShelfLock({ depot: 'b1', code: 'RAF-A 1', locked: false, uid: 'u' }, lockedShelf('b1', 'RAF-A 1', 5, 2), [row('a', { rafPasif: true }), row('b')]);
    const w = plain(p.shelfWrite);
    assert.equal(w.data.active, true);
    for (const k of ['lockReason', 'lockedAt', 'lockedBy']) assert.deepEqual(w.data[k], plain(L.DELETE_FIELD));
    assert.deepEqual(plain(p.rowWrites), [{ kind: 'update', col: 'b1', id: 'a', data: { rafPasif: false } }]);
    assert.equal(p.audit.type, 'raf-sayim-bitti');
    assert.equal(p.audit.reason, 'Yıl sonu sayımı');
});

test('v3.6 planShelfDelete: stoklu (Pasif durumlu dahil) raf, sayımdaki raf ve eski alanlı kayıt reddedilir; adet 0 kayıtlar Havuz\'a', () => {
    const base = shelf('b1', 'RAF-A 1', 5, 0);
    rejectsWith(() => L.planShelfDelete({ depot: 'b1', code: 'RAF-A 1' }, base, [row('a', { adet: 1, durumu: 'Pasif (Arızalı)' })]), 'shelf-not-empty');
    rejectsWith(() => L.planShelfDelete({ depot: 'b1', code: 'RAF-A 1' }, lockedShelf('b1', 'RAF-A 1', 5, 0), []), 'shelf-locked');
    rejectsWith(() => L.planShelfDelete({ depot: 'b1', code: 'RAF-A 1' }, base, [row('a', { raf: '', shelf: 'Raf-A 1', adet: 0 })]), 'legacy-shelf-field');
    const p = L.planShelfDelete({ depot: 'b1', code: 'RAF-A 1' }, shelf('b1', 'RAF-A 1', 5, 2), [row('a', { adet: 0, durumu: 'Tükendi', rafPasif: true }), row('b', { adet: 0 })]);
    assert.deepEqual(plain(p.rowWrites), [
        { kind: 'update', col: 'b1', id: 'a', data: { raf: '', rafPasif: false } },
        { kind: 'update', col: 'b1', id: 'b', data: { raf: '' } },
    ]);
    assert.equal(p.counterFix, true, 'kaymış sayaç önce sıfırlanmalı (kural silmeyi yazma öncesi değere göre denetler)');
    assert.equal(p.audit.type, 'raf-silindi');
    assert.equal(L.planShelfDelete({ depot: 'b1', code: 'RAF-A 1' }, base, []).counterFix, false);
});

test('v3.6 planShelfRename: yalnız boş ve kilitsiz raf; hedef ad boşta olmalı; kapasite/aktiflik korunur; eski → yeni kanıtı', () => {
    const old = shelf('b1', 'RAF-A 1', 7, 0, false);
    rejectsWith(() => L.planShelfRename({ depot: 'b1', code: 'RAF-A 1', newCode: 'RAF-A 9', uid: 'u' }, old, null, [row('a', { adet: 0 })]), 'shelf-not-empty');
    rejectsWith(() => L.planShelfRename({ depot: 'b1', code: 'RAF-A 1', newCode: 'RAF-A 9', uid: 'u' }, old, shelf('b1', 'RAF-A 9', 5, 0), []), 'shelf-exists');
    rejectsWith(() => L.planShelfRename({ depot: 'b1', code: 'RAF-A 1', newCode: 'raf-a 1', uid: 'u' }, old, null, []), 'invalid-argument');
    rejectsWith(() => L.planShelfRename({ depot: 'b1', code: 'RAF-A 1', newCode: 'RAF-A 9', uid: 'u' }, lockedShelf('b1', 'RAF-A 1', 5, 0), null, []), 'shelf-locked');
    const p = L.planShelfRename({ depot: 'b1', code: 'RAF-A 1', newCode: 'raf-a 9', uid: 'u' }, old, null, []);
    assert.equal(p.newId, 'b1_RAF-A 9');
    assert.equal(p.newDoc.capacity, 7);
    assert.equal(p.newDoc.active, false, 'eski "yeni yerleştirmeye kapalı" durumu korunur');
    assert.equal(p.newDoc.usedSlots, 0);
    assert.deepEqual([p.audit.fromValue, p.audit.toValue], ['RAF-A 1', 'RAF-A 9']);
});

test('v3.6 planShelfSync bayrakları raf kilidine eşitler: kilitli rafta eksik bayrak konur; kilitsiz/katalog dışı rafta kalan bayrak kalkar', () => {
    const items = {
        b1: [
            { ...src({ id: 'x1' }), __docId: 'doc_x1' },
            { ...src({ id: 'x2', raf: 'Raf-A 2', rafPasif: true }) },
            { ...src({ id: 'x3', raf: 'Raf-Z 9', rafPasif: true }) },
            { ...src({ id: 'x4', raf: 'Raf-A 2' }) },
        ],
        b2: [],
    };
    const shelfDocs = { 'b1_RAF-A 1': lockedShelf('b1', 'RAF-A 1', 5, 1), 'b1_RAF-A 2': shelf('b1', 'RAF-A 2', 5, 2) };
    const r = L.planShelfSync(items, shelfDocs, { uid: 'u' });
    assert.deepEqual(plain(r.lockFixed), [
        { col: 'b1', id: 'doc_x1', rafPasif: true },
        { col: 'b1', id: 'x2', rafPasif: false },
        { col: 'b1', id: 'x3', rafPasif: false },
    ]);
    const rCanon = L.planShelfSync(items, shelfDocs, { uid: 'u', canonicalize: true });
    assert.deepEqual(plain(rCanon.lockFixed), [
        { col: 'b1', id: 'doc_x1', rafPasif: true },
        { col: 'b1', id: 'x2', rafPasif: false },
        { col: 'b1', id: 'x3', rafPasif: false },
        { col: 'b1', id: 'x4', rafPasif: false },
    ], 'canonicalize:true kilitsiz rafta rafPasif alanı eksik eski kayda da false yazar');
});

test('v3.6 Envanter No kilidi: dolu numara ürün kaydından değişmez; boş numara atanır; yazım farkı değişiklik sayılmaz', () => {
    const edit = (existingExtra, fields) => L.planProductSave({ col: 'b2', id: 'b1_old1', isNew: false, fields, uid: 'u' },
        { existing: existingB1({ status: 'Kullanıma Hazır', ...existingExtra }), shelves: {} });
    rejectsWith(() => edit({ envanterNo: 'ENV-001' }, { envanterNo: 'ENV-002' }), 'envanter-no-locked');
    rejectsWith(() => edit({ envanterNo: 'ENV-001' }, { envanterNo: '' }), 'envanter-no-locked');
    const same = plain(edit({ envanterNo: 'ENV-001' }, { envanterNo: ' env-001 ', ürün: 'Yeni ad' }).writes[0].data);
    assert.equal('envanterNo' in same, false, 'aynı numaranın yazım farkı yazılmaz (saklanan biçim korunur)');
    assert.equal(same.ürün, 'Yeni ad');
    const assigned = plain(edit({}, { envanterNo: 'ENV-009' }).writes[0].data);
    assert.equal(assigned.envanterNo, 'ENV-009', 'numarası boş kayda bir kez atanır');
    const dash = plain(edit({ envanterNo: '-' }, { envanterNo: 'ENV-010' }).writes[0].data);
    assert.equal(dash.envanterNo, 'ENV-010', '"-" boş sayılır');
    const forged = plain(edit({}, { sonEnvanterNoDegisimId: 'al_sahte' }).writes[0].data);
    assert.equal('sonEnvanterNoDegisimId' in forged, false, 'değişim bağı yalnız değişim aracından yazılır');
});

test('v3.6 assertNotCountLocked: bayrak ya da raf kilidi tek başına yeterli (fail-closed)', () => {
    rejectsWith(() => L.assertNotCountLocked({ raf: 'Raf-A 1', rafPasif: true }, null), 'shelf-locked');
    rejectsWith(() => L.assertNotCountLocked({ raf: 'Raf-A 1' }, lockedShelf('b1', 'RAF-A 1', 5, 1)), 'shelf-locked');
    L.assertNotCountLocked({ raf: 'Raf-A 1' }, shelf('b1', 'RAF-A 1', 5, 1, false));
});
