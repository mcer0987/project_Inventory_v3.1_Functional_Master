// Faz 4B · J9 — sahiplik uid'leri (src/utils/ownership.js): kişi çözümü (belirsiz ad / çakışma / hesapsız / tutarsız hesap),
// kayıt başına göç planı, önizlemenin saflığı, transaction'lı parçalı uygulama (eşzamanlı değişiklik, kısmi hata, idempotans)
// ve değiştirilemezlik muhafızı. Gerçek dosyalar (schema.js + ownership.js), tarayıcısız (vm). Firestore yerine bellek-içi depo.
// Gerçek Firestore + kurallar: tests/integration/ownership.emu.test.mjs.
// Usage: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const plain = x => JSON.parse(JSON.stringify(x));
const clone = x => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

function load() {
    const window = { data: {} };
    const ctx = vm.createContext({ window, console });
    for (const f of ['src/utils/schema.js', 'src/services/staff-provisioning.js', 'src/utils/ownership.js']) {
        vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
    }
    return { O: window.Ownership, SP: window.StaffProvisioning, window };
}

// Personel: hesap e-postası J7 biçiminde (staffEmail(id)); 'Ali Veli' iki kişide (Türkçe katlama ile: ALİ VELİ), Can'ın hesabı yok.
function people(SP) {
    const acc = (id, name, code, uid) => ({ id, name, code, uid, authEmail: SP.staffEmail(id) });
    return [
        acc('p_ayse', 'Ayşe Yılmaz', 'ayse1', 'uid-ayse'),
        acc('p_ali1', 'Ali Veli', 'aliv1', 'uid-ali1'),
        acc('p_ali2', 'ALİ VELİ', 'aliv2', 'uid-ali2'),
        { id: 'p_can', name: 'Can Demir', code: 'can01' },
        acc('p_seher', 'Seher Kaya', '00000', 'uid-seher'),
        { id: 'p_bad', name: 'Bozuk Bağ', code: 'bad01', uid: 'uid-bad', authEmail: 'baska@staff.medipol.local' },
    ];
}
const idx = (O, SP, list) => O.buildPersonIndex(list || people(SP), { staffEmail: SP.staffEmail });

// ─── Kişi çözümü ────────────────────────────────────────────────────────────────────────────────────
test('resolveOwner: id yetkili (ad değişmiş olsa da); listede olmayan id ada DÜŞMEZ', () => {
    const { O, SP } = load();
    const I = idx(O, SP);
    const r = O.resolveOwner(I, { id: 'p_ayse', names: ['Eski Ad'] });
    assert.equal(r.status, 'ok'); assert.equal(r.uid, 'uid-ayse'); assert.equal(r.via, 'id');
    assert.equal(O.resolveOwner(I, { id: 'silinmis', names: ['Ayşe Yılmaz'] }).status, 'not-found');
});

test('resolveOwner: iki personelde aynı ad (Türkçe katlama dahil) → ambiguous, OTOMATİK EŞLEME YOK', () => {
    const { O, SP } = load();
    const r = plain(O.resolveOwner(idx(O, SP), { names: ['ali  veli'] }));
    assert.equal(r.status, 'ambiguous');
    assert.equal(r.uid, undefined);
    assert.deepEqual(r.candidates.sort(), ['ALİ VELİ', 'Ali Veli']);
});

test('resolveOwner: eski giriş kodu tekilse eşler; belirsiz adı kod çözer; kod ile ad farklı kişiyi gösterirse conflict', () => {
    const { O, SP } = load();
    const I = idx(O, SP);
    assert.equal(O.resolveOwner(I, { code: 'aliv2', names: ['Ali Veli'] }).uid, 'uid-ali2', 'kodla seçilen kişi belirsiz adın adaylarından biri');
    const c = O.resolveOwner(I, { code: 'ayse1', names: ['Seher Kaya'] });
    assert.equal(c.status, 'conflict');
    const list = [...people(SP), { id: 'p_dup', name: 'Kopya', code: 'ayse1' }];
    assert.equal(O.resolveOwner(idx(O, SP, list), { code: 'ayse1' }).status, 'ambiguous', 'ortak kod');
});

test('resolveOwner: hesapsız → no-account; e-posta uyumsuz ya da paylaşılan uid → account-inconsistent; sistem adları eşlenmez', () => {
    const { O, SP } = load();
    const I = idx(O, SP);
    assert.equal(O.resolveOwner(I, { names: ['Can Demir'] }).status, 'no-account');
    assert.equal(O.resolveOwner(I, { names: ['Bozuk Bağ'] }).status, 'account-inconsistent');
    const shared = [...people(SP), { id: 'p_x', name: 'İkinci', code: 'x0001', uid: 'uid-ayse', authEmail: SP.staffEmail('p_x') }];
    assert.equal(O.resolveOwner(idx(O, SP, shared), { id: 'p_ayse' }).status, 'account-inconsistent');
    for (const s of ['Admin', 'Sistem', 'pool', 'Havuz', 'system', 'unknown']) assert.equal(O.resolveOwner(I, { names: [s] }).status, 'system', s);
    assert.equal(O.resolveOwner(I, {}).status, 'unmatched');
    assert.equal(O.uidForName(I, 'Ali Veli'), null);
    assert.equal(O.uidForName(I, 'Admin'), null);
    assert.equal(O.uidForName(I, 'ayşe  YILMAZ'), 'uid-ayse');
});

// ─── Kayıt planı ────────────────────────────────────────────────────────────────────────────────────
test('planDoc: talep (id / eski kod / ad), satın alma (createdBy id / kod / ad + akış adımları), görev, şablon', () => {
    const { O, SP } = load();
    const I = idx(O, SP);
    assert.deepEqual(plain(O.planDoc('requests', { id: 1, personelId: 'p_ayse', personel: 'Ayşe Yılmaz' }, I).patch), { personelUid: 'uid-ayse' });
    assert.deepEqual(plain(O.planDoc('requests', { id: 2, personelKodu: '00000', personel: 'Seher Kaya' }, I).patch), { personelUid: 'uid-seher' });
    const po = { id: 3, createdBy: '00000', createdByName: 'Seher', talepEden: 'Seher',
        workflow: { started: true, steps: [{ user: 'Ayşe Yılmaz', status: 'approved' }, { user: 'Ali Veli', status: 'pending' }, { user: 'Sistem' }] } };
    const p = plain(O.planDoc('purchaseOrders', po, I));
    assert.equal(p.patch.createdByUid, 'uid-seher', 'eski kod ile');
    assert.deepEqual(p.patch.workflow.steps.map(s => s.userUid ?? null), ['uid-ayse', null, null], 'belirsiz ad ve sistem adımına uid yok');
    assert.equal(p.patch.workflow.steps[0].status, 'approved', 'adımın diğer alanları korunur');
    assert.equal(p.patch.workflow.started, true);
    assert.deepEqual(p.issues.map(i => `${i.field}:${i.status}`).sort(), ['steps[1].userUid:ambiguous', 'steps[2].userUid:system']);
    assert.equal(O.planDoc('purchaseOrders', { id: 4, createdBy: 'p_ayse', createdByName: 'X' }, I).patch.createdByUid, 'uid-ayse', 'J8+ createdBy = personel id');
    const t = plain(O.planDoc('tasks', { id: 5, creatorId: 'Admin', assigneeId: 'Ayşe Yılmaz' }, I));
    assert.deepEqual(t.patch, { assigneeUid: 'uid-ayse' });
    assert.equal(t.issues[0].status, 'system', 'yönetici "Admin" adıyla oluşturduğu göreve sahte uid yazılmaz');
    assert.equal(O.planDoc('tasks', { id: 6, creatorId: 'Can Demir', assigneeId: 'pool' }, I).patch, null);
    assert.deepEqual(plain(O.planDoc('workflowTemplates', { id: 'w', steps: [{ user: 'Seher Kaya', tip: 'Paraf' }] }, I).patch), { steps: [{ user: 'Seher Kaya', tip: 'Paraf', userUid: 'uid-seher' }] });
});

test('planDoc: dolu uid ASLA değiştirilmez; çözüm farklıysa mismatch raporlanır', () => {
    const { O, SP } = load();
    const I = idx(O, SP);
    const r = plain(O.planDoc('requests', { id: 1, personelId: 'p_ayse', personelUid: 'uid-eski' }, I));
    assert.equal(r.patch, null);
    assert.equal(r.issues[0].status, 'mismatch');
    assert.equal(O.planDoc('requests', { id: 1, personelId: 'p_ayse', personelUid: 'uid-ayse' }, I).issues.length, 0);
});

test('planMigration (önizleme): girdiyi değiştirmez, giriş kodunu rapora çıkarmaz, sayıları doğru', () => {
    const { O, SP } = load();
    const data = {
        requests: [{ id: 1, personelKodu: '00000', personel: 'Seher Kaya' }, { id: 2, personel: 'Ali Veli' }, { id: 3, personel: 'Can Demir' }, { id: 4, personelId: 'p_ayse', personelUid: 'uid-ayse' }],
        purchaseOrders: [{ id: 5, createdBy: 'aliv1', createdByName: 'Ali Veli' }],
        tasks: [], workflowTemplates: [{ id: 'w1', steps: [{ user: 'Ayşe Yılmaz' }] }],
    };
    const before = JSON.stringify(data), pers = people(SP), persBefore = JSON.stringify(pers);
    const plan = plain(O.planMigration({ data, personel: pers, staffEmail: SP.staffEmail }));
    assert.equal(JSON.stringify(data), before, 'önizleme kayıtları değiştirmez');
    assert.equal(JSON.stringify(pers), persBefore);
    assert.deepEqual(plan.items.map(i => `${i.col}/${i.id}`).sort(), ['purchaseOrders/5', 'requests/1', 'workflowTemplates/w1']);
    assert.equal(plan.summary.requests.toUpdate, 1);
    assert.equal(plan.summary.requests.issues, 2, 'belirsiz ad + hesapsız');
    assert.equal(plan.summary.requests.alreadyFields, 1);
    const text = JSON.stringify(plan.issues) + JSON.stringify(plan.items.map(i => i.label));
    for (const code of ['00000', 'aliv1', 'aliv2', 'can01']) assert.ok(!text.includes(code), `rapor giriş kodu içermemeli (${code})`);
});

// ─── Uygulama ───────────────────────────────────────────────────────────────────────────────────────
function memStore(seed) {
    const db = new Map();
    Object.entries(seed).forEach(([col, docs]) => docs.forEach(d => db.set(`${col}/${d.id}`, clone(d))));
    const s = {
        db, txCount: 0, attempts: 0, fault: null, retryFirst: false, maxWritesPerTx: 0,
        async readAll(col) { return [...db].filter(([k]) => k.startsWith(col + '/')).map(([k, v]) => ({ id: k.slice(col.length + 1), data: clone(v) })); },
        async transaction(fn) {
            const n = s.txCount++;
            if (s.fault && s.fault(n)) throw Object.assign(new Error(`enjekte hata (tx #${n})`), { code: 'unavailable' });
            let staged, res;
            const attempts = s.retryFirst && n === 0 ? 2 : 1;   // Firestore çakışmada fonksiyonu yeniden çalıştırır
            for (let a = 0; a < attempts; a++) {
                s.attempts++;
                staged = [];
                res = await fn({
                    get: async (c, id) => { const v = db.get(`${c}/${id}`); return v === undefined ? null : { id: String(id), ...clone(v) }; },
                    update: (c, id, p) => staged.push([c, String(id), clone(p)]),
                });
            }
            s.maxWritesPerTx = Math.max(s.maxWritesPerTx, staged.length);
            staged.forEach(([c, id, p]) => db.set(`${c}/${id}`, { ...db.get(`${c}/${id}`), ...p }));
            return res;
        },
    };
    return s;
}
const fixture = SP => ({
    personel: people(SP),
    requests: Array.from({ length: 7 }, (_, i) => ({ id: `r${i}`, personelId: 'p_ayse', personel: 'Ayşe Yılmaz', ürün: 'Ürün ' + i })),
    purchaseOrders: [{ id: 'po1', createdBy: 'p_seher', createdByName: 'Seher Kaya', workflow: { steps: [{ user: 'Ayşe Yılmaz', status: 'pending' }] } }],
    tasks: [{ id: 't1', creatorId: 'Seher Kaya', assigneeId: 'Ayşe Yılmaz', title: 'Görev' }],
    workflowTemplates: [{ id: 'w1', name: 'Şablon', steps: [{ user: 'Seher Kaya' }] }],
});
const planOf = (O, SP, store) => {
    const read = col => [...store.db].filter(([k]) => k.startsWith(col + '/')).map(([, v]) => clone(v));
    return O.planMigration({ data: { requests: read('requests'), purchaseOrders: read('purchaseOrders'), tasks: read('tasks'), workflowTemplates: read('workflowTemplates') }, personel: read('personel'), staffEmail: SP.staffEmail });
};

test('applyMigration: yalnız uid alanlarını yazar; ikinci koşu hiçbir şey planlamaz (idempotent); tx başına ≤ parça boyutu', async () => {
    const { O, SP } = load();
    const store = memStore(fixture(SP));
    const before = clone(store.db.get('purchaseOrders/po1'));
    const plan = planOf(O, SP, store);
    assert.equal(plan.items.length, 10);
    const res = plain(await O.applyMigration({ plan, store, staffEmail: SP.staffEmail, chunkSize: 4 }));
    assert.equal(res.status, 'done');
    assert.equal(res.written.length, 10);
    assert.equal(store.txCount, 3, '10 kayıt / 4 = 3 transaction');
    assert.ok(store.maxWritesPerTx <= 4);
    assert.equal(store.db.get('requests/r0').personelUid, 'uid-ayse');
    assert.equal(store.db.get('requests/r0').ürün, 'Ürün 0', 'diğer alanlar korunur');
    const po = store.db.get('purchaseOrders/po1');
    assert.equal(po.createdByUid, 'uid-seher');
    assert.deepEqual(po.workflow.steps, [{ ...before.workflow.steps[0], userUid: 'uid-ayse' }]);
    assert.equal(store.db.get('tasks/t1').creatorUid, 'uid-seher');
    assert.equal(store.db.get('workflowTemplates/w1').steps[0].userUid, 'uid-seher');
    assert.equal(planOf(O, SP, store).items.length, 0, 'tekrar çalıştırmak güvenli');
});

test('applyMigration: önizlemeden sonra değişen kayıt ATLANIR (changed-since-preview), silinen ve başkasınca doldurulan da', async () => {
    const { O, SP } = load();
    const store = memStore(fixture(SP));
    const plan = planOf(O, SP, store);
    store.db.set('requests/r1', { ...store.db.get('requests/r1'), personelId: 'p_seher' });   // sahip değişti
    store.db.delete('requests/r2');
    store.db.set('requests/r3', { ...store.db.get('requests/r3'), personelUid: 'uid-ayse' });  // başka bir koşu doldurdu
    const res = plain(await O.applyMigration({ plan, store, staffEmail: SP.staffEmail }));
    const why = Object.fromEntries(res.skipped.map(s => [s.id, s.reason]));
    assert.deepEqual(why, { r1: 'changed-since-preview', r2: 'deleted', r3: 'already' });
    assert.equal(store.db.get('requests/r1').personelUid, undefined, 'değişen kayda yazılmaz');
    assert.equal(res.written.length, 7);
});

test('applyMigration: personel listesi önizlemeden sonra değiştiyse HİÇ yazmadan durur (yeni aynı adlı personel belirsizlik yaratır)', async () => {
    const { O, SP } = load();
    const store = memStore(fixture(SP));
    const plan = planOf(O, SP, store);
    store.db.set('personel/p_new', { id: 'p_new', name: 'Ayşe Yılmaz', code: 'new01' });
    const res = plain(await O.applyMigration({ plan, store, staffEmail: SP.staffEmail }));
    assert.equal(res.status, 'aborted');
    assert.equal(res.error.code, 'personel-changed');
    assert.equal(res.notAttempted, plan.items.length);
    assert.equal(store.txCount, 0);
});

test('applyMigration: kısmi hata gizlenmez — düşen parça, yazılanlar ve denenmeyenler ayrı; yeniden koşu tamamlar', async () => {
    const { O, SP } = load();
    const store = memStore(fixture(SP));
    const plan = planOf(O, SP, store);
    store.fault = n => n === 1;   // 2. transaction düşer
    const res = plain(await O.applyMigration({ plan, store, staffEmail: SP.staffEmail, chunkSize: 4 }));
    assert.equal(res.status, 'stopped');
    assert.equal(res.written.length, 4);
    assert.equal(res.failed.length, 4);
    assert.equal(res.notAttempted, 2);
    assert.equal(res.error.code, 'unavailable');
    assert.equal(res.failed[0].id, plan.items[4].id);
    store.fault = null;
    const again = plain(await O.applyMigration({ plan: planOf(O, SP, store), store, staffEmail: SP.staffEmail, chunkSize: 4 }));
    assert.equal(again.status, 'done');
    assert.equal(again.written.length, 6);
    assert.equal(planOf(O, SP, store).items.length, 0);
});

test('applyMigration: transaction yeniden denendiğinde sonuç iki kez sayılmaz', async () => {
    const { O, SP } = load();
    const store = memStore(fixture(SP));
    store.retryFirst = true;
    const plan = planOf(O, SP, store);
    const res = plain(await O.applyMigration({ plan, store, staffEmail: SP.staffEmail }));
    assert.equal(store.attempts, 2);
    assert.equal(res.written.length, plan.items.length);
});

test('applyMigration: transaction içinde dayanılan personel kaydı değişirse parça yazılmaz (personel-changed)', async () => {
    const { O, SP } = load();
    const store = memStore(fixture(SP));
    const plan = planOf(O, SP, store);
    const realTx = store.transaction;
    store.transaction = async fn => realTx(async tx => {
        store.db.set('personel/p_ayse', { ...store.db.get('personel/p_ayse'), uid: 'uid-yeni', authEmail: SP.staffEmail('p_ayse') });
        return fn(tx);
    });
    const res = plain(await O.applyMigration({ plan, store, staffEmail: SP.staffEmail }));
    assert.equal(res.status, 'stopped');
    assert.equal(res.error.code, 'personel-changed');
    assert.equal(res.written.length, 0);
    assert.equal(store.db.get('requests/r0').personelUid, undefined);
});

// ─── Değiştirilemezlik muhafızı ─────────────────────────────────────────────────────────────────────
test('ownerGuard: dolu sahiplik alanı değiştirilemez; tam yazmada eski değer taşınır; boşla ezilemez', () => {
    const { O } = load();
    const g = (op, data, prev, extra = {}) => { const r = O.ownerGuard({ col: 'requests', op, data, prev, actorUid: 'u-me', isAdmin: false, ...extra }); return r && r.code; };
    const prev = { id: 1, personelUid: 'u-owner' };
    assert.equal(g('update', { personelUid: 'u-baska' }, prev), 'owner-immutable');
    assert.equal(g('update', { personelUid: 'u-baska' }, prev, { isAdmin: true }), 'owner-immutable', 'yönetici de değiştiremez (istemci)');
    assert.equal(g('set', { personelUid: 'u-baska' }, prev), 'owner-immutable');
    const full = { id: 1, durum: 'x' };
    assert.equal(g('set', full, prev), null);
    assert.equal(full.personelUid, 'u-owner', 'tam değiştirme alanı silmez — eski değer taşındı');
    const nul = { id: 1, personelUid: null };
    assert.equal(g('set', nul, prev), null);
    assert.equal(nul.personelUid, 'u-owner');
    const upd = { personelUid: '' };
    assert.equal(g('update', upd, prev), null);
    assert.ok(!('personelUid' in upd), 'boş değer güncellemeye girmez');
    assert.equal(g('update', { durum: 'y' }, prev), null);
    assert.equal(g('update', { personelUid: 'u-owner' }, prev), null, 'aynı değer serbest');
});

test('ownerGuard: yeni kayıtta yalnız oturumun kendi uid\'si; var olan kayda ilk yazım yalnız yönetici; diğer koleksiyonlar serbest', () => {
    const { O } = load();
    const g = (op, data, prev, extra = {}) => { const r = O.ownerGuard({ col: 'tasks', op, data, prev, actorUid: 'u-me', isAdmin: false, ...extra }); return r && r.code; };
    assert.equal(g('set', { id: 9, creatorUid: 'u-me' }, null), null);
    assert.equal(g('set', { id: 9, creatorUid: 'u-baska' }, null), 'owner-uid-mismatch');
    assert.equal(g('set', { id: 9, creatorUid: 'u-me' }, null, { actorUid: null }), 'owner-uid-mismatch', 'anonim/oturumsuz başkası adına yazamaz');
    assert.equal(g('set', { id: 9 }, null, { actorUid: null }), null, 'uid\'siz kayıt (eski yol) serbest');
    assert.equal(g('update', { creatorUid: 'u-me' }, { id: 9 }), 'owner-first-write');
    assert.equal(g('update', { creatorUid: 'u-x' }, { id: 9 }, { isAdmin: true }), null);
    assert.equal(O.ownerGuard({ col: 'b1', op: 'set', data: { personelUid: 'x' }, prev: null, actorUid: null, isAdmin: false }), null);
    assert.equal(O.ownerGuard({ col: 'requests', op: 'delete', data: {}, prev: { personelUid: 'x' }, actorUid: null, isAdmin: false }), null);
});

test('selfUid / actorUid: uid yalnız Auth\'tan — anonim ve hesabı aktif kullanıcıya bağlı olmayan oturumda null', () => {
    const { O, window } = load();
    window.AppModules.Session = { isStaffAccountSession: u => !!(u && !u.isAnonymous && /@staff\./.test(u.email || '')) };
    window.isDbAdmin = () => false;
    window.getActiveUser = () => ({ id: 'p1', uid: 'u-staff' });
    window.userAuth = { uid: 'u-staff', isAnonymous: false, email: 'pp1@staff.medipol.local' };
    assert.equal(O.selfUid(), 'u-staff');
    assert.equal(O.actorUid(), 'u-staff');
    window.getActiveUser = () => ({ id: 'p2', uid: 'u-baska' });
    assert.equal(O.selfUid(), null, 'oturum hesabı aktif kullanıcının kaydına bağlı değil');
    window.userAuth = { uid: 'anon-1', isAnonymous: true };
    assert.equal(O.selfUid(), null);
    assert.equal(O.actorUid(), null);
    window.userAuth = { uid: 'u-admin', isAnonymous: false, email: 'admin@medipol.local' };
    window.isDbAdmin = () => true;
    assert.equal(O.selfUid(), null, 'yönetici personel adına sahip olmaz');
    assert.equal(O.actorUid(), 'u-admin');
});
