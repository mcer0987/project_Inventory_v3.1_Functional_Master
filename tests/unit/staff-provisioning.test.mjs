// Faz 4B · J7 → J10 PRI — personel Auth hesabı ve kurumsal kimlik (PRI) çekirdeği (src/services/staff-provisioning.js). Gerçek
// dosya, tarayıcısız (vm); Firebase yerine sahte bir "provisioner" (hesap deposu) kullanılır. Gerçek Auth emülatörüne karşı:
// tests/integration/staff-provisioning.emu.test.mjs (npm run test:staff:emu).
// Usage: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const plain = x => JSON.parse(JSON.stringify(x));
const D = '@staff.medipol.local';

function load(win = {}) {
    const ctx = vm.createContext({ window: win, console });
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/services/staff-provisioning.js'), 'utf8'), ctx, { filename: 'staff-provisioning.js' });
    return ctx.window.StaffProvisioning;
}

// Firebase Auth taklidi: e-posta tekil (büyük/küçük harf duyarsız), parola birebir; hata kodları SDK'daki gibi.
function fakeAuth() {
    const accounts = new Map();
    let n = 0;
    const err = code => Object.assign(new Error(code), { code: 'auth/' + code });
    const a = {
        accounts, fault: null, calls: [],
        async createAccount(email, password) {
            a.calls.push(['create', email]);
            if (a.fault) { const f = a.fault('create', email); if (f) throw err(f); }
            if (password.length < 6) throw err('weak-password');
            const key = email.toLowerCase();
            if (accounts.has(key)) throw err('email-already-in-use');
            const uid = 'uid' + (++n);
            accounts.set(key, { uid, password });
            return uid;
        },
        async findAccount(email, password) {
            a.calls.push(['find', email]);
            if (a.fault) { const f = a.fault('find', email); if (f) throw err(f); }
            const acc = accounts.get(email.toLowerCase());
            if (!acc || acc.password !== password) throw err('invalid-credential');
            return acc.uid;
        },
        async moveAccount(from, password, to, { expectUid } = {}) {
            a.calls.push(['move', from, to]);
            if (a.fault) { const f = a.fault('move', from); if (f) throw err(f); }
            const acc = accounts.get(from.toLowerCase());
            if (!acc || acc.password !== password) throw err('invalid-credential');
            if (expectUid && acc.uid !== expectUid) throw Object.assign(new Error('uid-mismatch'), { code: 'uid-mismatch' });
            if (accounts.has(to.toLowerCase())) throw err('email-already-in-use');
            accounts.delete(from.toLowerCase());
            accounts.set(to.toLowerCase(), acc);
            return acc.uid;
        },
    };
    return a;
}
function fakeDb(personel) {
    const db = { personel: personel.map(p => ({ ...p })), fail: null, links: [] };
    db.link = async (person, fields) => {
        if (db.fail && db.fail(person)) throw Object.assign(new Error('yazılamadı'), { code: 'permission-denied' });
        db.links.push([String(person.id), { ...fields }]);
        Object.assign(db.personel.find(p => String(p.id) === String(person.id)), fields);
    };
    db.writePri = async (person, pri) => { db.personel.find(p => String(p.id) === String(person.id)).pri = pri; };
    db.byId = () => new Map(db.personel.map(p => [String(p.id), { ...p }]));
    return db;
}

// ─── Kurumsal kimlik (PRI) ───────────────────────────────────────────────────────────────────────────
test('foldTr / normalizePri: Türkçe harfler arındırılır, küçük harf ("İ".toLowerCase() tuzağı yok)', () => {
    const S = load();
    assert.equal(S.foldTr('Ayşe Yılmaz'), 'ayse yilmaz');
    assert.equal(S.foldTr('İSMAİL IŞIK'), 'ismail isik');
    assert.equal(S.foldTr('ÇĞÖŞÜ çğöşü âîû'), 'cgosu cgosu aiu');
    assert.equal(S.foldTr('José Müller'), 'jose muller', 'diğer aksanlar da atılır');
    assert.equal(S.normalizePri('  Ayşe.Yılmaz '), 'ayse.yilmaz');
});

test('generateStaffPri: iki kelime ad.soyad; daha fazla → ilk.son; tek kelime; çakışmada artan numara', () => {
    const S = load();
    assert.equal(S.generateStaffPri('Ayşe Yılmaz'), 'ayse.yilmaz');
    assert.equal(S.generateStaffPri('Mehmet Ali Yılmaz'), 'mehmet.yilmaz');
    assert.equal(S.generateStaffPri('  Muhammed   CER  '), 'muhammed.cer');
    assert.equal(S.generateStaffPri('Seher'), 'seher');
    assert.equal(S.generateStaffPri('İhale Ofisi'), 'ihale.ofisi');
    assert.equal(S.generateStaffPri("Ayşe-Nur O'Brien"), 'aysenur.obrien', 'kelime içi noktalama atılır');
    assert.equal(S.generateStaffPri(''), 'personel');
    assert.equal(S.generateStaffPri('...'), 'personel');
    assert.equal(S.generateStaffPri('Ayşe Yılmaz', ['ayse.yilmaz']), 'ayse.yilmaz2');
    assert.equal(S.generateStaffPri('Ayşe Yılmaz', ['ayse.yilmaz', 'ayse.yilmaz2']), 'ayse.yilmaz3');
    assert.equal(S.generateStaffPri('Ayşe Yılmaz', ['AYSE.YILMAZ']), 'ayse.yilmaz2', 'karşılaştırma normalize');
    assert.equal(S.generateStaffPri('Mehmet Ali Yılmaz', new Set(['mehmet.yilmaz'])), 'mehmet.yilmaz2', 'Set de kabul edilir');
    assert.ok(S.generateStaffPri('A'.repeat(80) + ' B').length <= 40);
});

test('validatePri: biçim, tekillik (düzenlenen kişi hariç); dönen değer normalize', () => {
    const S = load();
    const pers = [{ id: 'p1', name: 'Ayşe Yılmaz', pri: 'ayse.yilmaz' }, { id: 'p2', name: 'Ali' }];
    assert.deepEqual(plain(S.validatePri('Ali.Veli', pers)), { ok: true, value: 'ali.veli' });
    assert.equal(S.validatePri('', pers).ok, false);
    for (const bad of ['ali veli', '.ali', 'ali.', 'ali..veli', 'ali@veli', 'x'.repeat(65)]) assert.equal(S.validatePri(bad, pers).ok, false, bad);
    const dup = S.validatePri('ayse.yilmaz', pers);
    assert.equal(dup.ok, false);
    assert.match(dup.message, /Ayşe Yılmaz/);
    assert.equal(S.validatePri('ayse.yilmaz', pers, 'p1').ok, true, 'kişinin kendi PRI\'si çakışma sayılmaz');
    assert.deepEqual(plain(S.takenPris(pers, 'p2')), ['ayse.yilmaz']);
});

test('PRI deseni firestore.rules isStaff deseniyle aynı (istemci geçerli saydığını kural da personel sayar, tersi de)', () => {
    const S = load();
    const rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
    const m = rules.match(/matches\('(\[a-z0-9\]\+[^']*)@staff\[\.\]medipol\[\.\]local'\)/);
    assert.ok(m, 'kuralda PRI e-posta deseni bulunamadı');
    const ruleRe = new RegExp('^' + m[1] + '$');
    for (const s of ['ayse.yilmaz', 'ayse.yilmaz2', 'seher', 'a-b_c.d', 'ali..veli', '.ali', 'ali.', 'ali veli', 'ALI', 'ali@x', '1', 'ö'])
        assert.equal(ruleRe.test(s), S.PRI_RE.test(s), s);
});

// ─── E-posta / parola ────────────────────────────────────────────────────────────────────────────────
test('staffEmail: PRI → <pri>@staff.medipol.local (normalize); geçersiz → null; eski J7 adresi ayrı', () => {
    const S = load();
    assert.equal(S.staffEmail('ayse.yilmaz'), 'ayse.yilmaz' + D);
    assert.equal(S.staffEmail(' Ayşe.Yılmaz '), 'ayse.yilmaz' + D);
    assert.equal(S.staffEmail('ali veli'), null);
    assert.equal(S.staffEmail(''), null);
    assert.equal(S.staffEmail(null), null);
    assert.equal(S.accountEmailOf({ id: 'p1', pri: 'ali.veli' }), 'ali.veli' + D);
    assert.equal(S.accountEmailOf({ id: 'p1' }), null);
    assert.equal(S.legacyStaffEmail('temp_1790573516931_qgkyn'), 'ptemp_1790573516931_qgkyn' + D);
    assert.equal(S.legacyStaffEmail('Ab'), 'p.4162' + D);
});

test('staffPassword: girişle aynı normalizasyon (kırpılmış, harf duyarlı) + dolgu; kısa/boş kod reddedilir', () => {
    const S = load();
    assert.equal(S.staffPassword('qgkyn'), 'qgkynMdp!');
    assert.equal(S.staffPassword('  qgkyn '), 'qgkynMdp!', 'girişte kod kırpılır');
    assert.notEqual(S.staffPassword('ABCDE'), S.staffPassword('abcde'), 'harf duyarlı');
    assert.equal(S.staffPassword(12345), '12345Mdp!');
    assert.equal(S.staffPassword('abc'), null);
    assert.equal(S.staffPassword(''), null);
    assert.equal(S.staffPassword(undefined), null);
});

// ─── Tek hesap ───────────────────────────────────────────────────────────────────────────────────────
test('provisionOne: <pri>@ hesabı açılır, sonra uid/authEmail/pri/authProvisionedAt bağlanır', async () => {
    const S = load();
    const auth = fakeAuth(), db = fakeDb([{ id: 'a1', name: 'Ali Veli', pri: 'ali.veli' }]);
    const r = plain(await S.provisionOne(db.personel[0], auth, db.link, { now: () => 42, code: 'k1aaa' }));
    assert.deepEqual(r, { status: 'created', uid: 'uid1', email: 'ali.veli' + D });
    assert.deepEqual(plain(db.personel[0]), { id: 'a1', name: 'Ali Veli', pri: 'ali.veli', uid: 'uid1', authEmail: 'ali.veli' + D, authProvisionedAt: 42 });
    assert.equal(auth.accounts.get('ali.veli' + D).password, 'k1aaaMdp!');
});

test('provisionOne: PRI yok → invalid (Auth çağrısı yok); zaten bağlı → already-linked', async () => {
    const S = load();
    const auth = fakeAuth();
    assert.equal((await S.provisionOne({ id: 'a', code: 'k1aaa' }, auth, async () => {})).status, 'invalid');
    assert.equal((await S.provisionOne({ id: 'a', pri: 'a.b', code: 'ab' }, auth, async () => {})).status, 'invalid');
    assert.equal((await S.provisionOne({ id: 'a', pri: 'a.b', code: 'k1aaa', uid: 'u' }, auth, async () => {})).status, 'already-linked');
    assert.equal(auth.calls.length, 0);
});

test('provisionOne: bağlama düştü → link-failed; yeniden çalıştırma aynı hesabı bulup bağlar (relinked, yeni hesap yok)', async () => {
    const S = load();
    const auth = fakeAuth(), db = fakeDb([{ id: 'a1', pri: 'ali.veli', code: 'k1aaa' }]);
    db.fail = () => true;
    const r1 = plain(await S.provisionOne(db.personel[0], auth, db.link));
    assert.equal(r1.status, 'link-failed');
    db.fail = null;
    const r2 = plain(await S.provisionOne(db.personel[0], auth, db.link));
    assert.equal(r2.status, 'relinked');
    assert.equal(r2.uid, 'uid1');
    assert.equal(auth.accounts.size, 1);
});

test('provisionOne: PRI adresinde parolası farklı hesap (kendine hesap açan / tahmin edilen PRI) → conflict, bağlama yok', async () => {
    const S = load();
    const auth = fakeAuth();
    await auth.createAccount('ali.veli' + D, 'saldirganMdp!');
    const db = fakeDb([{ id: 'a1', pri: 'ali.veli' }]);
    const r = plain(await S.provisionOne(db.personel[0], auth, db.link, { code: 'yeni1' }));
    assert.equal(r.status, 'conflict');
    assert.match(r.reason, /PRI/);
    assert.equal(db.personel[0].uid, undefined);
    assert.match(S.describe(r).text, /PRI/);
});

test('provisionOne: kota / kapalı sign-up / ağ ProvisioningStop; diğer hatalar error (türüyle)', async () => {
    const S = load();
    const auth = fakeAuth();
    const p = { id: 'a', pri: 'a.b', code: 'k1aaa' };
    auth.fault = () => 'too-many-requests';
    await assert.rejects(S.provisionOne(p, auth, async () => {}), e => e.name === 'ProvisioningStop' && e.code === 'rate-limited');
    auth.fault = () => 'admin-restricted-operation';
    await assert.rejects(S.provisionOne(p, auth, async () => {}), e => e.code === 'signup-disabled');
    // J11 · P1: ağ kopması kişiye özgü değil → toplu iş durur (hesap sunucuda açılmış olabilir; yeniden çalıştırma "zaten var" yolundan bağlar)
    auth.fault = () => 'network-request-failed';
    await assert.rejects(S.provisionOne(p, auth, async () => {}), e => e.name === 'ProvisioningStop' && e.code === 'network');
    auth.fault = () => 'weak-password';
    assert.deepEqual(plain(await S.provisionOne(p, auth, async () => {})), { status: 'error', kind: 'unknown', email: 'a.b' + D, reason: 'weak-password' });
});

// ─── J7 hesabının taşınması ──────────────────────────────────────────────────────────────────────────
test('moveLegacyAccount: p<id>@ hesabı uid korunarak <pri>@ adresine taşınır ve bağlanır', async () => {
    const S = load();
    const auth = fakeAuth();
    const uid = await auth.createAccount('pa1' + D, 'k1aaaMdp!');
    const db = fakeDb([{ id: 'a1', name: 'Ali Veli', code: 'k1aaa', uid, authEmail: 'pa1' + D }]);
    const r = plain(await S.moveLegacyAccount({ ...db.personel[0], pri: 'ali.veli' }, auth, db.link, { now: () => 7 }));
    assert.deepEqual(r, { status: 'moved', uid, email: 'ali.veli' + D });
    assert.ok(!auth.accounts.has('pa1' + D) && auth.accounts.get('ali.veli' + D).uid === uid, 'aynı hesap, yeni e-posta');
    assert.deepEqual(plain(db.personel[0]), { id: 'a1', name: 'Ali Veli', code: 'k1aaa', uid, authEmail: 'ali.veli' + D, pri: 'ali.veli', authProvisionedAt: 7 });
});

test('moveLegacyAccount: hedef adreste hesap var / parola tutmuyor / başka uid → conflict; e-posta değişikliği kapalı → durur', async () => {
    const S = load();
    const auth = fakeAuth();
    const uid = await auth.createAccount('pa1' + D, 'k1aaaMdp!');
    await auth.createAccount('ali.veli' + D, 'baskaMdp!');
    const person = { id: 'a1', code: 'k1aaa', uid, authEmail: 'pa1' + D, pri: 'ali.veli' };
    assert.match((await S.moveLegacyAccount(person, auth, async () => {})).reason, /farklı bir PRI/);
    assert.equal((await S.moveLegacyAccount({ ...person, pri: 'ali.veli2', code: 'yanlis' }, auth, async () => {})).status, 'conflict');
    assert.match((await S.moveLegacyAccount({ ...person, pri: 'ali.veli2', uid: 'baska-uid' }, auth, async () => {})).reason, /bu personele bağlı hesap değil/);
    auth.fault = op => (op === 'move' ? 'operation-not-allowed' : null);
    await assert.rejects(S.moveLegacyAccount({ ...person, pri: 'ali.veli3' }, auth, async () => {}), e => e.name === 'ProvisioningStop' && e.code === 'email-change-blocked');
    assert.ok(auth.accounts.has('pa1' + D), 'başarısız denemeler hesabı taşımadı');
});

// ─── Göç planı ve uygulama ───────────────────────────────────────────────────────────────────────────
test('planAccounts: PRI atama (bağlı olanınki korunur, çakışana numara) ve işlem türleri; plan kod içermez', () => {
    const S = load();
    const plan = plain(S.planAccounts([
        { id: 'p1', name: 'Ayşe Yılmaz', pri: 'ayse.yilmaz', uid: 'u1', authEmail: 'ayse.yilmaz' + D, code: 'gizli1' },   // ok
        { id: 'p2', name: 'Ayşe Yılmaz', code: 'gizli2' },                                                              // create, ayse.yilmaz2
        { id: 'p3', name: 'Mehmet Ali Kaya', uid: 'u3', authEmail: 'pp3' + D, code: 'gizli3' },                         // move
        { id: 'p4', name: 'Kodsuz Kişi' },                                                                              // no-code
        { id: 'p5', name: 'Eski Kodsuz', uid: 'u5', authEmail: 'pp5' + D },                                             // blocked (kod yok)
        { id: 'p6', name: 'Paylaşan Bir', uid: 'u7', authEmail: 'x' + D, code: 'gizli6' },                              // blocked (uid paylaşılıyor)
        { id: 'p7', name: 'Paylaşan İki', uid: 'u7', authEmail: 'y' + D, code: 'gizli7' },                              // blocked
        { id: 'p8', name: 'Tanınmayan', uid: 'u8', authEmail: 'baska@medipol.local', code: 'gizli8' },                 // blocked
        { id: 'p9', name: 'Ayşe Yılmaz', pri: 'ayse.yilmaz', code: 'gizli9' },                                          // PRI çakışıyor → yeni
        null, { name: 'İdsiz' },
    ]));
    const by = Object.fromEntries(plan.rows.map(r => [r.id, r]));
    assert.deepEqual([by.p1.action, by.p1.pri, by.p1.priChange], ['ok', 'ayse.yilmaz', false]);
    assert.deepEqual([by.p2.action, by.p2.pri, by.p2.priChange], ['create', 'ayse.yilmaz2', true]);
    assert.deepEqual([by.p3.action, by.p3.pri], ['move', 'mehmet.kaya']);
    assert.deepEqual([by.p4.action, by.p4.pri], ['no-code', 'kodsuz.kisi']);
    assert.equal(by.p5.action, 'blocked');
    assert.match(by.p5.reason, /firebase-admin/);
    assert.equal(by.p6.action, 'blocked');
    assert.equal(by.p7.action, 'blocked');
    assert.match(by.p8.reason, /tanınmıyor/);
    assert.equal(by.p9.pri, 'ayse.yilmaz3', 'PRI çakışan ikinci kayıt yeni PRI alır (bağlı olan korunur)');
    assert.equal(new Set(plan.rows.map(r => r.pri)).size, plan.rows.length, 'tüm PRI\'ler tekil');
    assert.deepEqual(plan.counts, { total: 9, ok: 1, create: 2, move: 1, 'no-code': 1, blocked: 4, priWrites: 8 });
    assert.ok(!/gizli/.test(JSON.stringify(plan)), 'plan kod içermez');
});

test('applyAccounts: plan uygulanır; ikinci plan yalnız "ok" (eşleme yenileme) çıkarır — idempotent', async () => {
    const S = load();
    const auth = fakeAuth();
    const legacyUid = await auth.createAccount('pp3' + D, 'gizli3Mdp!');
    const db = fakeDb([
        { id: 'p2', name: 'Ayşe Yılmaz', code: 'gizli2' },
        { id: 'p3', name: 'Mehmet Ali Kaya', uid: legacyUid, authEmail: 'pp3' + D, code: 'gizli3' },
        { id: 'p4', name: 'Kodsuz Kişi' },
    ]);
    const progress = [];
    const plan = S.planAccounts(db.personel);
    const r = plain(await S.applyAccounts(plan, db.byId(), auth, db.link, { writePri: db.writePri, onProgress: (d, t) => progress.push(`${d}/${t}`) }));
    assert.deepEqual(r.counts, { created: 1, moved: 1, 'pri-written': 1 });
    assert.equal(r.stopped, null);
    assert.deepEqual(progress, ['1/3', '2/3', '3/3']);
    assert.equal(db.personel[0].authEmail, 'ayse.yilmaz' + D);
    assert.equal(db.personel[1].uid, legacyUid, 'taşınan hesabın uid\'si aynı');
    assert.equal(db.personel[2].pri, 'kodsuz.kisi');
    const again = S.planAccounts(db.personel);
    assert.deepEqual(plain(again.counts), { total: 3, ok: 2, create: 0, move: 0, 'no-code': 1, blocked: 0, priWrites: 0 });
    const r2 = plain(await S.applyAccounts(again, db.byId(), auth, db.link, { writePri: db.writePri }));
    assert.deepEqual(r2.counts, { ok: 2 });
    assert.equal(auth.accounts.size, 2, 'yeni hesap açılmadı');
});

test('applyAccounts: kota dolunca durur, kalanı bildirir; taze kayıt bulunamazsa atlar', async () => {
    const S = load();
    const auth = fakeAuth();
    const db = fakeDb(Array.from({ length: 4 }, (_, i) => ({ id: 'p' + i, name: 'Kişi No' + i, code: 'kod' + i + 'x' })));
    let created = 0;
    auth.fault = op => (op === 'create' && ++created > 2 ? 'too-many-requests' : null);
    const plan = S.planAccounts(db.personel);
    const fresh = db.byId(); fresh.delete('p0');
    const r = plain(await S.applyAccounts(plan, fresh, auth, db.link, { writePri: db.writePri }));
    assert.equal(r.stopped.code, 'rate-limited');
    assert.deepEqual(r.counts, { skipped: 1, created: 2 });
    assert.equal(r.remaining, 1);
});

test('accountsFingerprint: ad / PRI / hesap bağı / kodun varlığı değişince değişir; kodun değeri iz bırakmaz', () => {
    const S = load();
    const base = [{ id: 'p1', name: 'Ali', pri: 'ali', uid: 'u', authEmail: 'ali' + D, code: 'k1aaa' }];
    const f = S.accountsFingerprint(base);
    assert.equal(S.accountsFingerprint([{ ...base[0], code: 'baska' }]), f, 'kod değeri parmak izine girmez');
    for (const ch of [{ name: 'Veli' }, { pri: 'ali2' }, { uid: 'u2' }, { authEmail: 'x' + D }, { code: null }])
        assert.notEqual(S.accountsFingerprint([{ ...base[0], ...ch }]), f, JSON.stringify(ch));
    assert.ok(!f.includes('k1aaa'));
});

test('describe: her sonuç için mesaj; giriş kodu/parola hiçbir mesajda yok', () => {
    const S = load();
    for (const st of ['created', 'relinked', 'already-linked', 'moved', 'move-resumed', 'invalid', 'conflict', 'disabled', 'stopped', 'link-failed', 'error']) {
        const d = plain(S.describe({ status: st, reason: 'neden' }));
        assert.equal(typeof d.text, 'string');
        assert.equal(d.ok, ['created', 'relinked', 'already-linked', 'moved', 'move-resumed'].includes(st));
        assert.ok(!/Mdp!/.test(d.text));
    }
});

test('createAuthProvisioner: ikincil app "provisioner" bellek içi kalıcılıkla bir kez kurulur; taşıma = giriş + updateEmail; her işlemden sonra signOut', async () => {
    const S = load();
    const log = [];
    const fns = {
        getApps: () => [],
        initializeApp: (opts, name) => { log.push(['initializeApp', name]); return { name }; },
        initializeAuth: (app, o) => { log.push(['initializeAuth', app.name, o.persistence]); return { app }; },
        inMemoryPersistence: 'MEMORY',
        connectAuthEmulator: (a, url) => log.push(['emulator', url]),
        createUserWithEmailAndPassword: async (a, e) => ({ user: { uid: 'U-' + e } }),
        signInWithEmailAndPassword: async (a, e) => ({ user: { uid: 'S-' + e } }),
        updateEmail: async (user, e) => log.push(['updateEmail', user.uid, e]),
        signOut: async a => log.push(['signOut', a.app.name]),
    };
    const p = S.createAuthProvisioner({ fns, options: { apiKey: 'k' }, emulatorUrl: 'http://127.0.0.1:9099' });
    assert.equal(await p.createAccount('x@y', 'pw1234'), 'U-x@y');
    assert.equal(await p.findAccount('x@y', 'pw1234'), 'S-x@y');
    assert.equal(await p.moveAccount('old@y', 'pw1234', 'new@y'), 'S-old@y');
    assert.deepEqual(log, [
        ['initializeApp', 'provisioner'], ['initializeAuth', 'provisioner', 'MEMORY'], ['emulator', 'http://127.0.0.1:9099'],
        ['signOut', 'provisioner'], ['signOut', 'provisioner'], ['updateEmail', 'S-old@y', 'new@y'], ['signOut', 'provisioner'],
    ]);
});

// ─── J11 · P1: hata kurtarma / idempotency ──────────────────────────────────────────────────────────
test('errorKind: kota / ağ / yetki / yanlış kod / çakışma / devre dışı / kapalı özellik birbirinden ayrılır', () => {
    const S = load();
    const k = c => S.errorKind({ code: c });
    assert.deepEqual(
        ['auth/too-many-requests', 'resource-exhausted', 'auth/network-request-failed', 'unavailable', 'permission-denied', 'auth/invalid-credential',
            'auth/user-not-found', 'auth/email-already-in-use', 'auth/user-disabled', 'auth/operation-not-allowed', 'auth/requires-recent-login', 'uid-mismatch', 'x'].map(k),
        ['rate-limited', 'rate-limited', 'network', 'network', 'permission-denied', 'wrong-password', 'wrong-password', 'email-in-use', 'user-disabled',
            'operation-not-allowed', 'requires-recent-login', 'uid-mismatch', 'unknown']);
});

test('KABUL (P1): Auth taşıması başarılı + Firestore bağı düştü → ikinci çalıştırma AYNI uid\'yi aynı personele bağlar (move-resumed)', async () => {
    const S = load();
    const auth = fakeAuth();
    const uid = await auth.createAccount('pa1' + D, 'k1aaaMdp!');
    const db = fakeDb([{ id: 'a1', name: 'Ali Veli', code: 'k1aaa', uid, authEmail: 'pa1' + D }]);
    db.fail = () => true;   // Firestore bağı reddedildi (permission-denied)
    const r1 = plain(await S.moveLegacyAccount({ ...db.personel[0], pri: 'ali.veli' }, auth, db.link));
    assert.deepEqual([r1.status, r1.kind, r1.uid], ['link-failed', 'permission-denied', uid]);
    assert.ok(auth.accounts.has('ali.veli' + D) && !auth.accounts.has('pa1' + D), 'Auth tarafı taşındı');
    assert.equal(db.personel[0].authEmail, 'pa1' + D, 'Firestore tarafı eski hâlde');
    // Personel kaydı hâlâ eski adresi gösterdiği için plan yine "move" der (eski sürüm burada "parola eşleşmiyor" ile duruyordu)
    assert.equal(S.planAccounts(db.personel).rows[0].action, 'move');
    db.fail = null;
    auth.calls.length = 0;
    const r2 = plain(await S.moveLegacyAccount({ ...db.personel[0], pri: 'ali.veli' }, auth, db.link, { now: () => 9 }));
    assert.deepEqual(r2, { status: 'move-resumed', uid, email: 'ali.veli' + D });
    assert.deepEqual(auth.calls.map(c => c[0]), ['move', 'find'], 'yalnız giriş denendi; yeni hesap açılmadı, e-posta yeniden değiştirilmedi');
    assert.equal(auth.accounts.size, 1);
    assert.deepEqual(plain(db.personel[0]), { id: 'a1', name: 'Ali Veli', code: 'k1aaa', uid, authEmail: 'ali.veli' + D, pri: 'ali.veli', authProvisionedAt: 9 });
    assert.equal(S.planAccounts(db.personel).rows[0].action, 'ok', 'üçüncü koşu yalnız eşlemeyi yeniler');
});

test('P1: kurtarmada PRI adresindeki hesabın uid\'si personeldekiyle aynı değilse HİÇBİR bağ yazılmaz (conflict)', async () => {
    const S = load();
    const auth = fakeAuth();
    const other = await auth.createAccount('ali.veli' + D, 'k1aaaMdp!');   // aynı kodla açılmış başka bir hesap
    const db = fakeDb([{ id: 'a1', code: 'k1aaa', uid: 'uid-gercek', authEmail: 'pa1' + D }]);
    const r = plain(await S.moveLegacyAccount({ ...db.personel[0], pri: 'ali.veli' }, auth, db.link));
    assert.deepEqual([r.status, r.kind], ['conflict', 'uid-mismatch']);
    assert.notEqual(other, 'uid-gercek');
    assert.equal(db.links.length, 0, 'bağ yazılmadı');
    assert.equal(db.personel[0].uid, 'uid-gercek', 'uid değişmedi');
});

test('P1: ne eski ne PRI adresi kodu kabul ediyor → conflict (wrong-password); devre dışı hesap → disabled; hiçbirinde bağ yok', async () => {
    const S = load();
    const auth = fakeAuth();
    const uid = await auth.createAccount('pa1' + D, 'k1aaaMdp!');
    const db = fakeDb([{ id: 'a1', code: 'yanlis', uid, authEmail: 'pa1' + D }]);
    const r = plain(await S.moveLegacyAccount({ ...db.personel[0], pri: 'ali.veli' }, auth, db.link));
    assert.deepEqual([r.status, r.kind], ['conflict', 'wrong-password']);
    assert.match(r.reason, /firebase-admin/);
    auth.fault = op => (op === 'move' ? 'user-disabled' : null);
    const d = plain(await S.moveLegacyAccount({ ...db.personel[0], code: 'k1aaa', pri: 'ali.veli' }, auth, db.link));
    assert.deepEqual([d.status, d.kind], ['disabled', 'user-disabled']);
    assert.equal(S.describe(d).ok, false);
    assert.equal(db.links.length, 0);
});

test('P1: taşıma sırasında ağ koptu (sunucuda tamamlanmış) → durur; bağlantı gelince yeniden çalıştırma tamamlar', async () => {
    const S = load();
    const auth = fakeAuth();
    const uid = await auth.createAccount('pa1' + D, 'k1aaaMdp!');
    const db = fakeDb([{ id: 'a1', code: 'k1aaa', uid, authEmail: 'pa1' + D }]);
    const realMove = auth.moveAccount;
    auth.moveAccount = async (...a) => { await realMove(...a); throw Object.assign(new Error('net'), { code: 'auth/network-request-failed' }); };
    await assert.rejects(S.moveLegacyAccount({ ...db.personel[0], pri: 'ali.veli' }, auth, db.link), e => e.name === 'ProvisioningStop' && e.code === 'network');
    auth.moveAccount = realMove;
    const r = plain(await S.moveLegacyAccount({ ...db.personel[0], pri: 'ali.veli' }, auth, db.link));
    assert.deepEqual([r.status, r.uid], ['move-resumed', uid]);
});

test('P1: applyAccounts — bağ yazması yetkiden reddedilince satır raporlanır ve iş DURUR; yeniden çalıştırma kalanı ve yarımı tamamlar', async () => {
    const S = load();
    const auth = fakeAuth();
    const legacyUid = await auth.createAccount('pp3' + D, 'gizli3Mdp!');
    const db = fakeDb([
        { id: 'p3', name: 'Mehmet Ali Kaya', uid: legacyUid, authEmail: 'pp3' + D, code: 'gizli3' },
        { id: 'p2', name: 'Ayşe Yılmaz', code: 'gizli2' },
    ]);
    db.fail = () => true;
    const plan = S.planAccounts(db.personel);
    const r = plain(await S.applyAccounts(plan, db.byId(), auth, db.link, { writePri: db.writePri }));
    assert.equal(r.stopped.code, 'permission-denied');
    assert.deepEqual(r.results.map(x => [x.id, x.status, x.kind]), [['p3', 'link-failed', 'permission-denied']]);
    assert.equal(r.remaining, 1, 'ikinci personel denenmedi (aynı sebeple düşecekti)');
    db.fail = null;
    const r2 = plain(await S.applyAccounts(S.planAccounts(db.personel), db.byId(), auth, db.link, { writePri: db.writePri }));
    assert.deepEqual(r2.counts, { 'move-resumed': 1, created: 1 });
    assert.equal(db.personel[0].uid, legacyUid);
    assert.equal(auth.accounts.size, 2);
});

test('P1: applyAccounts — ağ hatası satırda raporlanır ve iş durur ("ok" eşleme yenilemesi dahil)', async () => {
    const S = load();
    const auth = fakeAuth();
    const db = fakeDb([{ id: 'p1', name: 'Ali Veli', pri: 'ali.veli', uid: 'u1', authEmail: 'ali.veli' + D }, { id: 'p2', name: 'Can Can', pri: 'can.can', uid: 'u2', authEmail: 'can.can' + D }]);
    db.link = async () => { throw Object.assign(new Error('koptu'), { code: 'unavailable' }); };
    const r = plain(await S.applyAccounts(S.planAccounts(db.personel), db.byId(), auth, db.link, {}));
    assert.equal(r.stopped.code, 'network');
    assert.deepEqual(r.results.map(x => [x.status, x.kind]), [['link-failed', 'network']]);
    assert.equal(r.remaining, 1);
});

test('P1: bağ çakışması (eşleme başka personeli / kayıt başka uid\'yi gösteriyor) link-failed değil conflict', async () => {
    const S = load();
    const auth = fakeAuth();
    const db = fakeDb([{ id: 'a1', pri: 'ali.veli', code: 'k1aaa' }]);
    db.link = async () => { throw Object.assign(new Error('bu giriş hesabı başka bir personele eşlenmiş (bağ değiştirilmedi)'), { code: 'uid-mismatch' }); };
    const r = plain(await S.provisionOne(db.personel[0], auth, db.link));
    assert.deepEqual([r.status, r.kind], ['conflict', 'uid-mismatch']);
    assert.match(S.describe(r).text, /başka bir personele/);
});

// createFirestoreLinker: Firestore transaction taklidi (okumalar anlık görüntü; yazmalar commit'te, hata → hiçbiri)
function fakeTx(docs, { failCommit = false } = {}) {
    const snap = p => ({ exists: () => docs.has(p), data: () => ({ ...docs.get(p) }) });
    const runTransaction = async (_db, fn) => {
        const writes = [];
        const t = { get: async p => snap(p), set: (p, d) => writes.push(['set', p, d]), update: (p, d) => writes.push(['update', p, d]) };
        const out = await fn(t);
        if (failCommit) throw Object.assign(new Error('commit düştü'), { code: 'unavailable' });
        for (const [op, p, d] of writes) docs.set(p, op === 'set' ? { ...d } : { ...(docs.get(p) || {}), ...d });
        return out;
    };
    return { runTransaction };
}
const linkerFor = (S, docs, opts) => S.createFirestoreLinker({
    runTransaction: fakeTx(docs, opts).runTransaction, db: {}, personelRef: id => 'personel/' + id, accountRef: uid => 'staffAccounts/' + uid, now: () => 5,
});

test('createFirestoreLinker: eşleme + personel bağı TEK transaction; commit düşerse ikisi de yazılmaz; yeniden çalıştırma idempotent', async () => {
    const S = load();
    const docs = new Map([['personel/a1', { id: 'a1', name: 'Ali', pri: 'ali.veli' }]]);
    const fields = at => ({ uid: 'u1', authEmail: 'ali.veli' + D, pri: 'ali.veli', authProvisionedAt: at });
    await assert.rejects(linkerFor(S, docs, { failCommit: true })({ id: 'a1', pri: 'ali.veli' }, fields(1)), e => S.errorKind(e) === 'network');
    assert.ok(!docs.has('staffAccounts/u1') && !docs.get('personel/a1').uid, 'yarım bağ yok');
    assert.deepEqual(plain(await linkerFor(S, docs)({ id: 'a1', pri: 'ali.veli' }, fields(1))), { uid: 'u1', authEmail: 'ali.veli' + D, authProvisionedAt: 1 });
    assert.deepEqual(docs.get('staffAccounts/u1'), { personelId: 'a1', pri: 'ali.veli', linkedAt: 5 });
    assert.deepEqual(plain(await linkerFor(S, docs)({ id: 'a1', pri: 'ali.veli' }, fields(2))), {});
    assert.equal(docs.get('personel/a1').authProvisionedAt, 1, 'değişmeyen bağ yeniden yazılmadı');
});

test('createFirestoreLinker: kayıt başka uid\'ye bağlıysa / eşleme başka personeli gösteriyorsa / kayıt yoksa hiçbir şey yazılmaz', async () => {
    const S = load();
    const docs = new Map([
        ['personel/a1', { id: 'a1', pri: 'ali.veli', uid: 'u-eski' }],
        ['personel/b1', { id: 'b1', pri: 'bora.kaya' }],
        ['staffAccounts/u9', { personelId: 'zzz', pri: 'baska' }],
    ]);
    const before = JSON.stringify([...docs]);
    const link = linkerFor(S, docs);
    await assert.rejects(link({ id: 'a1' }, { uid: 'u1', pri: 'ali.veli' }), e => S.errorKind(e) === 'uid-mismatch');
    await assert.rejects(link({ id: 'b1' }, { uid: 'u9', pri: 'bora.kaya' }), e => S.errorKind(e) === 'uid-mismatch');
    await assert.rejects(link({ id: 'yok' }, { uid: 'u2', pri: 'x.y' }), e => S.errorKind(e) === 'not-found');
    await assert.rejects(link({ id: 'b1' }, { uid: '', pri: 'x.y' }), e => e.code === 'invalid-argument');
    assert.equal(JSON.stringify([...docs]), before);
});
