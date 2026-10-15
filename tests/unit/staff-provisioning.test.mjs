// Faz 4B · J7 — personel Auth hesabı açma çekirdeği (src/services/staff-provisioning.js). Gerçek dosya, tarayıcısız (vm);
// Firebase yerine sahte bir "provisioner" (hesap deposu) kullanılır. Gerçek Auth emülatörüne karşı:
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
    };
    return a;
}
function fakeDb(personel) {
    const db = { personel: personel.map(p => ({ ...p })), fail: null };
    db.link = async (person, fields) => {
        if (db.fail && db.fail(person)) throw Object.assign(new Error('yazılamadı'), { code: 'permission-denied' });
        Object.assign(db.personel.find(p => String(p.id) === String(person.id)), fields);
    };
    return db;
}

// ─── E-posta / parola ────────────────────────────────────────────────────────────────────────────────
test('staffEmail: güvenli id → p<id>@staff.medipol.local; makeId sayısı ve eski temp_ id\'leri', () => {
    const S = load();
    assert.equal(S.staffEmail(1790573516931123), 'p1790573516931123@staff.medipol.local');
    assert.equal(S.staffEmail('temp_1790573516931_qgkyn'), 'ptemp_1790573516931_qgkyn@staff.medipol.local');
    assert.equal(S.staffEmail('user_manuel_001'), 'puser_manuel_001@staff.medipol.local');
    assert.equal(S.staffEmail(''), null);
    assert.equal(S.staffEmail(null), null);
});

test('staffEmail: güvenli olmayan id onaltılık kodlanır; büyük/küçük harf ve "p." ön eki çakışma üretmez', () => {
    const S = load();
    const upper = S.staffEmail('Ab'), lower = S.staffEmail('ab');
    assert.equal(lower, 'pab@staff.medipol.local');
    assert.equal(upper, 'p.4162@staff.medipol.local');
    assert.notEqual(upper.toLowerCase(), lower.toLowerCase(), 'Firebase e-postaları harf duyarsız: Ab ve ab ayrı hesap olmalı');
    assert.equal(S.staffEmail('Şükrü'), 'p.c59ec3bc6b72c3bc@staff.medipol.local');
    assert.match(S.staffEmail('a b/c'), /^p\.[0-9a-f]+@staff\.medipol\.local$/);
    assert.equal(S.staffEmail('X'.repeat(40)), null, 'yerel kısım 64 karakteri aşarsa reddedilir');
    // Kapsamlı çakışma taraması: farklı id → farklı e-posta (harf duyarsız)
    const ids = ['a', 'A', 'a.', 'p', 'P', '41', 'x41', 'Ab', 'ab', 'aB', '1', '01', 'ı', 'i', 'İ', '-', '_'];
    const seen = new Map();
    ids.forEach(id => { const e = S.staffEmail(id).toLowerCase(); assert.ok(!seen.has(e), `${id} ile ${seen.get(e)} aynı e-postaya düştü`); seen.set(e, id); });
});

test('staffPassword: girişle aynı normalizasyon (kırpılmış, harf duyarlı) + dolgu; kısa/boş kod reddedilir', () => {
    const S = load();
    assert.equal(S.staffPassword('qgkyn'), 'qgkynMdp!');
    assert.equal(S.staffPassword('  qgkyn '), 'qgkynMdp!', 'girişte kod kırpılır');
    assert.notEqual(S.staffPassword('ABCDE'), S.staffPassword('abcde'), 'giriş p.code === code: harf duyarlı');
    assert.equal(S.staffPassword(12345), '12345Mdp!');
    assert.ok(S.staffPassword('abcd').length >= 6, 'Firebase en az 6 karakter');
    assert.equal(S.staffPassword('abc'), null);
    assert.equal(S.staffPassword(''), null);
    assert.equal(S.staffPassword(undefined), null);
});

// ─── Plan ────────────────────────────────────────────────────────────────────────────────────────────
test('planProvisioning: bağlı / açılacak / açılamayacak; ortak kod yalnız kişi id\'siyle raporlanır (kod değeri sızmaz)', () => {
    const S = load();
    const plan = plain(S.planProvisioning([
        { id: 'a1', name: 'Ali', code: 'k1aaa' },
        { id: 'a2', name: 'Ayşe', code: 'k2bbb', uid: 'u-existing' },
        { id: 'a3', name: 'Kısa', code: 'ab' },
        { id: 'a4', name: 'Kodsuz' },
        { name: 'İdsiz', code: 'k5eee' },
        { id: 'a6', name: 'İkiz 1', code: 'same1' },
        { id: 'a7', name: 'İkiz 2', code: 'same1' },
        null,
    ]));
    assert.equal(plan.total, 7);
    assert.deepEqual(plan.linked.map(p => p.id), ['a2']);
    assert.deepEqual(plan.toCreate.map(x => x.person.id), ['a1', 'a6', 'a7']);
    assert.equal(plan.toCreate[0].email, 'pa1@staff.medipol.local');
    assert.deepEqual(plan.invalid.map(x => x.reason), ['giriş kodu 4 karakterden kısa', 'giriş kodu yok', 'id yok ya da e-postaya çevrilemiyor']);
    assert.deepEqual(plan.duplicateCodes, [{ ids: ['a6', 'a7'] }]);
    assert.ok(!JSON.stringify(plan.duplicateCodes).includes('same1'));
});

// ─── Tek hesap ───────────────────────────────────────────────────────────────────────────────────────
test('provisionOne: hesap açılır, sonra personel kaydına uid/authEmail/authProvisionedAt bağlanır', async () => {
    const S = load();
    const auth = fakeAuth(), db = fakeDb([{ id: 'a1', name: 'Ali', code: 'k1aaa' }]);
    const r = plain(await S.provisionOne(db.personel[0], auth, db.link, { now: () => 42 }));
    assert.deepEqual(r, { status: 'created', uid: 'uid1', email: 'pa1@staff.medipol.local' });
    assert.deepEqual(plain(db.personel[0]), { id: 'a1', name: 'Ali', code: 'k1aaa', uid: 'uid1', authEmail: 'pa1@staff.medipol.local', authProvisionedAt: 42 });
    assert.equal(auth.accounts.get('pa1@staff.medipol.local').password, 'k1aaaMdp!');
});

test('provisionOne: bağlama düştü → link-failed; yeniden çalıştırma aynı hesabı bulup bağlar (relinked, yeni hesap yok)', async () => {
    const S = load();
    const auth = fakeAuth(), db = fakeDb([{ id: 'a1', code: 'k1aaa' }]);
    db.fail = () => true;
    const r1 = plain(await S.provisionOne(db.personel[0], auth, db.link));
    assert.equal(r1.status, 'link-failed');
    assert.equal(r1.uid, 'uid1');
    db.fail = null;
    const r2 = plain(await S.provisionOne(db.personel[0], auth, db.link));
    assert.equal(r2.status, 'relinked');
    assert.equal(r2.uid, 'uid1');
    assert.equal(auth.accounts.size, 1);
    assert.equal(db.personel[0].uid, 'uid1');
});

test('provisionOne: hesap var ama parola farklı (kod değişmiş) → conflict, bağlama yapılmaz', async () => {
    const S = load();
    const auth = fakeAuth();
    await auth.createAccount('pa1@staff.medipol.local', 'eskiKodMdp!');
    const db = fakeDb([{ id: 'a1', code: 'yeni1' }]);
    const r = plain(await S.provisionOne(db.personel[0], auth, db.link));
    assert.equal(r.status, 'conflict');
    assert.match(r.reason, /firebase-admin/);
    assert.equal(db.personel[0].uid, undefined);
});

test('provisionOne: zaten bağlı → hiçbir Auth çağrısı yok; geçersiz → invalid', async () => {
    const S = load();
    const auth = fakeAuth();
    assert.equal((await S.provisionOne({ id: 'a', code: 'k1aaa', uid: 'u' }, auth, async () => {})).status, 'already-linked');
    assert.equal((await S.provisionOne({ id: 'a', code: 'ab' }, auth, async () => {})).status, 'invalid');
    assert.equal(auth.calls.length, 0);
});

test('provisionOne: kota / kapalı sign-up toplu işi durduran ProvisioningStop fırlatır; diğer hatalar error döner', async () => {
    const S = load();
    const auth = fakeAuth();
    auth.fault = () => 'too-many-requests';
    await assert.rejects(S.provisionOne({ id: 'a', code: 'k1aaa' }, auth, async () => {}), e => e.name === 'ProvisioningStop' && e.code === 'rate-limited');
    auth.fault = () => 'admin-restricted-operation';
    await assert.rejects(S.provisionOne({ id: 'a', code: 'k1aaa' }, auth, async () => {}), e => e.code === 'signup-disabled');
    auth.fault = () => 'network-request-failed';
    assert.deepEqual(plain(await S.provisionOne({ id: 'a', code: 'k1aaa' }, auth, async () => {})),
        { status: 'error', email: 'pa@staff.medipol.local', reason: 'network-request-failed' });
});

// ─── Toplu ───────────────────────────────────────────────────────────────────────────────────────────
test('provisionMissing: eksikleri sırayla açar; ikinci koşu hiçbir şey yapmaz (idempotent)', async () => {
    const S = load();
    const auth = fakeAuth();
    const db = fakeDb(Array.from({ length: 6 }, (_, i) => ({ id: 'p' + i, code: 'kod' + i + 'x' })).concat([{ id: 'zz', code: 'ab' }]));
    const progress = [];
    const r = plain(await S.provisionMissing(db.personel, auth, db.link, { onProgress: (d, t) => progress.push(`${d}/${t}`) }));
    assert.deepEqual(r.counts, { created: 6 });
    assert.equal(r.remaining, 0);
    assert.equal(r.stopped, null);
    assert.equal(r.plan.invalid.length, 1);
    assert.deepEqual(progress, ['1/6', '2/6', '3/6', '4/6', '5/6', '6/6']);
    assert.ok(db.personel.slice(0, 6).every(p => p.uid && p.authEmail === S.staffEmail(p.id)));
    const again = plain(await S.provisionMissing(db.personel, auth, db.link));
    assert.equal(again.plan.toCreate.length, 0);
    assert.equal(again.results.length, 0);
    assert.equal(auth.accounts.size, 6);
});

test('provisionMissing: kota dolunca durur, kalanı bildirir; kota açılınca kaldığı yerden tamamlar', async () => {
    const S = load();
    const auth = fakeAuth();
    const db = fakeDb(Array.from({ length: 5 }, (_, i) => ({ id: 'p' + i, code: 'kod' + i + 'x' })));
    let created = 0;
    auth.fault = op => (op === 'create' && ++created > 2 ? 'too-many-requests' : null);
    const r1 = plain(await S.provisionMissing(db.personel, auth, db.link));
    assert.equal(r1.stopped.code, 'rate-limited');
    assert.deepEqual(r1.counts, { created: 2 });
    assert.equal(r1.remaining, 3);
    auth.fault = null;
    const r2 = plain(await S.provisionMissing(db.personel, auth, db.link));
    assert.deepEqual(r2.counts, { created: 3 });
    assert.equal(r2.remaining, 0);
    assert.ok(db.personel.every(p => p.uid));
});

test('describe: her sonuç için mesaj; giriş kodu/parola hiçbir mesajda yok', () => {
    const S = load();
    for (const st of ['created', 'relinked', 'already-linked', 'invalid', 'conflict', 'stopped', 'link-failed', 'error']) {
        const d = plain(S.describe({ status: st, reason: 'neden' }));
        assert.equal(typeof d.text, 'string');
        assert.equal(d.ok, ['created', 'relinked', 'already-linked'].includes(st));
        assert.ok(!/Mdp!/.test(d.text));
    }
});

test('createAuthProvisioner: ikincil app "provisioner" bellek içi kalıcılıkla bir kez kurulur; her işlemden sonra signOut', async () => {
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
        signOut: async a => log.push(['signOut', a.app.name]),
    };
    const p = S.createAuthProvisioner({ fns, options: { apiKey: 'k' }, emulatorUrl: 'http://127.0.0.1:9099' });
    assert.equal(await p.createAccount('x@y', 'pw1234'), 'U-x@y');
    assert.equal(await p.findAccount('x@y', 'pw1234'), 'S-x@y');
    assert.deepEqual(log, [
        ['initializeApp', 'provisioner'], ['initializeAuth', 'provisioner', 'MEMORY'], ['emulator', 'http://127.0.0.1:9099'],
        ['signOut', 'provisioner'], ['signOut', 'provisioner'],
    ]);
});
