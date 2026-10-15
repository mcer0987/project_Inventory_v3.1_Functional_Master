// Faz 4B · J7 — personel hesabı açma altyapısının Auth + Firestore EMÜLATÖRÜNE karşı uçtan uca doğrulaması. Gerçek
// Firebase JS SDK; staff-provisioning.js tarayıcıdaki dosyanın aynısı (firebase-handler'ın CDN modülü yerine npm 'firebase'
// fonksiyonları enjekte edilir). Firestore'da ÜRETİM kuralları (firestore.rules) yüklüdür.
// Kanıtlanan: (1) ikincil 'provisioner' örneği ana admin oturumunu düşürmez, (2) açılan hesaplarla e-posta/parola girişi
// çalışır ve uid personel kaydına bağlanır, (3) yeniden çalıştırma idempotent, yarım bağlama onarılır, kod değişikliği
// çakışma olarak raporlanır, (4) Aşama A kuralları personel hesabına admin yetkisi vermez (J7 yetki genişletmez).
// Usage: npm run test:staff:emu   (firebase emulators:exec --only firestore,auth içinde)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { initializeApp, getApps, deleteApp } from 'firebase/app';
import {
    initializeAuth, inMemoryPersistence, connectAuthEmulator, createUserWithEmailAndPassword,
    signInWithEmailAndPassword, signOut, updatePassword,
} from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, updateDoc, deleteField, terminate } from 'firebase/firestore';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROOT = 'inventory_demo';
const PROJECT = process.env.GCLOUD_PROJECT || 'demo-staff-provisioning';
const AUTH_URL = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9299'}`;
const [FS_HOST, FS_PORT] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8280').split(':');
const OPTIONS = { apiKey: 'demo-api-key', projectId: PROJECT };
const ADMIN = { email: 'admin@medipol.local', password: 'emu-yonetici-0001' };

// Aynı realm'de yükle (Firebase SDK başka vm realm'inin nesnelerini reddeder; tarayıcıda da tek realm).
globalThis.window = globalThis.window || {};
vm.runInThisContext(fs.readFileSync(path.join(ROOT_DIR, 'src/services/staff-provisioning.js'), 'utf8'), { filename: 'staff-provisioning.js' });
vm.runInThisContext(fs.readFileSync(path.join(ROOT_DIR, 'src/utils/staff-code-registry.js'), 'utf8'), { filename: 'staff-code-registry.js' });
const SP = globalThis.window.StaffProvisioning;
const REG = globalThis.window.StaffCodeRegistry;
const fns = { initializeApp, getApps, initializeAuth, inMemoryPersistence, connectAuthEmulator, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, updatePassword };

// Bir "tarayıcı sekmesi": kendi app + Auth + Firestore örneği
function session(name) {
    const app = initializeApp(OPTIONS, name);
    const auth = initializeAuth(app, { persistence: inMemoryPersistence });
    connectAuthEmulator(auth, AUTH_URL, { disableWarnings: true });
    const db = getFirestore(app);
    connectFirestoreEmulator(db, FS_HOST, Number(FS_PORT));
    return { app, auth, db };
}
const ref = (db, id) => doc(db, ROOT, 'personel', 'items', String(id));
const code = e => e && e.code;

let primary, provisioner;
const PERSONEL = [
    { id: 1790573516931123, name: 'Ali Veli', code: 'k1aaa' },
    { id: 'temp_1790573539061_cp4eq', name: 'Ayşe Yılmaz', code: 'Q7zP9' },
    { id: 'user_manuel_001', name: 'Mehmet Kaya', code: 'x9y8z' },
    { id: 'Ab-Upper', name: 'Büyük Harfli Id', code: 'up123' },
    { id: 'short1', name: 'Kısa Kod', code: 'ab' },
];
const linkVia = db => (person, fields) => updateDoc(ref(db, person.id), fields);
const readPersonel = async db => Promise.all(PERSONEL.map(async p => ({ id: p.id, ...(await getDoc(ref(db, p.id))).data() })));

// Üretim kuralları emülatöre REST ile yüklenir (CLI, proje dizini dışındaki kural dosyasını yapılandırmada kabul etmiyor;
// @firebase/rules-unit-testing de aynı uç noktayı kullanır).
async function loadProductionRules() {
    const res = await fetch(`http://${FS_HOST}:${FS_PORT}/emulator/v1/projects/${PROJECT}:securityRules`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content: fs.readFileSync(path.join(ROOT_DIR, 'firestore.rules'), 'utf8') }] } }),
    });
    if (!res.ok) throw new Error('kurallar yüklenemedi: ' + res.status + ' ' + await res.text());
}

before(async () => {
    await loadProductionRules();
    primary = session('primary');
    // Ana sekmede admin oturumu (emülatörde hesap yoksa açılır; açılış zaten oturum açar)
    try { await createUserWithEmailAndPassword(primary.auth, ADMIN.email, ADMIN.password); }
    catch (e) { if (code(e) !== 'auth/email-already-in-use') throw e; await signInWithEmailAndPassword(primary.auth, ADMIN.email, ADMIN.password); }
    for (const p of PERSONEL) await setDoc(ref(primary.db, p.id), p);   // üretim kuralı: admin yazar
    provisioner = SP.createAuthProvisioner({ fns, options: OPTIONS, emulatorUrl: AUTH_URL });
});
after(async () => {
    for (const app of getApps()) { try { await terminate(getFirestore(app)); } catch (_) { } await deleteApp(app); }
});

test('toplu hesap açma: geçerli personele hesap açılır ve bağlanır; admin oturumu DÜŞMEZ', async () => {
    const adminUid = primary.auth.currentUser.uid;
    const people = await readPersonel(primary.db);
    const r = await SP.provisionMissing(people, provisioner, linkVia(primary.db));
    assert.deepEqual(r.counts, { created: 4 });
    assert.equal(r.stopped, null);
    assert.deepEqual(r.plan.invalid.map(x => x.person.id), ['short1']);

    // Ana oturum hâlâ aynı admin
    assert.equal(primary.auth.currentUser && primary.auth.currentUser.uid, adminUid, 'admin oturumu korunmalı');
    assert.equal(primary.auth.currentUser.email, ADMIN.email);
    // …ve kurallar onu hâlâ admin sayıyor (admin yazması geçer)
    await updateDoc(ref(primary.db, 'short1'), { not: 'admin hâlâ yazabiliyor' });

    // Personel kayıtları bağlandı; ikincil örnekte oturum kalmadı
    const after = await readPersonel(primary.db);
    for (const p of after.filter(x => x.id !== 'short1')) {
        assert.ok(p.uid, `${p.id} uid almalı`);
        assert.equal(p.authEmail, SP.staffEmail(p.id));
        assert.equal(typeof p.authProvisionedAt, 'number');
    }
    assert.equal(after.find(x => x.id === 'short1').uid, undefined);
    assert.equal(provisioner.auth.currentUser, null, 'ikincil örnek işlemden sonra signOut eder');
    assert.equal(after.find(x => x.id === 'Ab-Upper').authEmail, 'p.41622d5570706572@staff.medipol.local');
});

test('açılan hesaplarla giriş: e-posta = staffEmail(id), parola = staffPassword(kod), uid personel kaydındakiyle aynı', async () => {
    const verifier = session('verifier');
    for (const p of (await readPersonel(primary.db)).filter(x => x.uid)) {
        const cred = await signInWithEmailAndPassword(verifier.auth, SP.staffEmail(p.id), SP.staffPassword(p.code));
        assert.equal(cred.user.uid, p.uid);
        const tok = await cred.user.getIdTokenResult();
        assert.equal(tok.signInProvider, 'password');
        await signOut(verifier.auth);
        await assert.rejects(signInWithEmailAndPassword(verifier.auth, SP.staffEmail(p.id), p.code), 'çıplak kod (dolgusuz) parola değildir');
    }
});

test('idempotent: ikinci koşu hiçbir hesap açmaz', async () => {
    const r = await SP.provisionMissing(await readPersonel(primary.db), provisioner, linkVia(primary.db));
    assert.equal(r.plan.toCreate.length, 0);
    assert.equal(r.results.length, 0);
});

test('yarım bağlama onarılır: uid silinmiş kayıt → aynı hesap bulunup yeniden bağlanır (relinked, aynı uid)', async () => {
    const before = (await getDoc(ref(primary.db, 'user_manuel_001'))).data().uid;
    await updateDoc(ref(primary.db, 'user_manuel_001'), { uid: deleteField(), authEmail: deleteField() });
    const r = await SP.provisionMissing(await readPersonel(primary.db), provisioner, linkVia(primary.db));
    assert.deepEqual(r.counts, { relinked: 1 });
    assert.equal((await getDoc(ref(primary.db, 'user_manuel_001'))).data().uid, before);
});

test('kod değişmiş + bağsız kayıt → conflict (hesap sıfırlaması yerel firebase-admin betiğinin işi), bağlama yapılmaz', async () => {
    await updateDoc(ref(primary.db, 'temp_1790573539061_cp4eq'), { code: 'YENI9', uid: deleteField() });
    const r = await SP.provisionMissing(await readPersonel(primary.db), provisioner, linkVia(primary.db));
    assert.deepEqual(r.counts, { conflict: 1 });
    assert.equal((await getDoc(ref(primary.db, 'temp_1790573539061_cp4eq'))).data().uid, undefined);
});

test('Aşama A kuralları (değişmedi): personel hesabı admin DEĞİLDİR — personel/b1 yazamaz, okuyabilir', async () => {
    const staff = session('staff');
    const p = (await readPersonel(primary.db)).find(x => x.id === 'user_manuel_001');
    await signInWithEmailAndPassword(staff.auth, SP.staffEmail(p.id), SP.staffPassword(p.code));
    assert.ok((await getDoc(ref(staff.db, p.id))).exists(), 'oturumlu okuma (Aşama A) çalışır');
    await assert.rejects(updateDoc(ref(staff.db, p.id), { name: 'kendini değiştirme' }), e => code(e) === 'permission-denied');
    await assert.rejects(setDoc(doc(staff.db, ROOT, 'b1', 'items', 'x'), { ürün: 'x' }), e => code(e) === 'permission-denied');
    await signOut(staff.auth);
});

test('J10 GİRDİSİ (risk kanıtı): sign-up açıkken herkes kendine @staff.medipol.local hesabı açabilir', async () => {
    // Bu test bir açığı belgeler, düzeltmez: e-postalar doğrulanmaz; istemci tarafı hesap açma açık oldukça (J7 bunu
    // gerektirir) "alan adı @staff." tek başına personel kanıtı DEĞİLDİR. J10 isStaff() personel kaydındaki uid'ye bakmalı.
    const intruder = session('intruder');
    const cred = await createUserWithEmailAndPassword(intruder.auth, 'p999999@staff.medipol.local', 'herhangiParola1');
    assert.ok(cred.user.uid);
    assert.ok(SP.isStaffEmail(cred.user.email), 'alan adı denetimi bu hesabı personel sanırdı');
    const linked = (await readPersonel(primary.db)).some(p => p.uid === cred.user.uid);
    assert.equal(linked, false, 'ama hiçbir personel kaydına bağlı değil — J10 bu ayrımı yapmalı');
});

// ─── J7.5 · Kod benzersizleştirme: personel.code + Auth parolası (Admin SDK yok) ────────────────────────────
let verifierAuth = null;
const login = async (email, password) => {
    if (!verifierAuth) verifierAuth = session('j75verify').auth;
    try { const c = await signInWithEmailAndPassword(verifierAuth, email, password); const uid = c.user.uid; await signOut(verifierAuth); return uid; }
    catch (e) { return null; }
};
const readMany = async (db, ids) => Promise.all(ids.map(async id => ({ id, ...(await getDoc(ref(db, id))).data() })));
const writeVia = db => (person, fields) => updateDoc(ref(db, person.id), fields);

test('J7.5 · çakışan iki personel: bağlı olanın kodu değişir → eski parola ölür, yeni parola aynı uid; J8 çözümleyici ambiguous → unique', async () => {
    const adminUid = primary.auth.currentUser.uid;
    const A = { id: 'dup_a', name: 'Çakışan A', code: 'ortak1' }, B = { id: 'dup_b', name: 'Çakışan B', code: 'ortak1' };
    for (const p of [A, B]) await setDoc(ref(primary.db, p.id), p);
    const r0 = await SP.provisionOne(A, provisioner, linkVia(primary.db));   // A'nın hesabı var (J7), B'nin yok
    assert.equal(r0.status, 'created');
    let people = await readMany(primary.db, ['dup_a', 'dup_b']);
    assert.equal(REG.resolveLoginCode(people, 'ortak1').status, 'ambiguous', 'J8 bu durumda girişi reddedecek');
    assert.equal(REG.duplicateGroups(people).length, 1);

    const plan = REG.planCodeChanges(people, [{ id: 'dup_a', newCode: 'tekil7' }]);
    assert.equal(plan.ok, true);
    const r = await SP.changeStaffCode(plan.changes[0].person, plan.changes[0].newCode, provisioner, writeVia(primary.db));
    assert.equal(r.status, 'changed');
    assert.equal(r.uid, r0.uid);

    people = await readMany(primary.db, ['dup_a', 'dup_b']);
    assert.equal(people[0].code, 'tekil7');
    assert.equal(people[0].uid, r0.uid, 'uid değişmez');
    assert.equal(await login(SP.staffEmail('dup_a'), SP.staffPassword('ortak1')), null, 'eski parola artık geçersiz');
    assert.equal(await login(SP.staffEmail('dup_a'), SP.staffPassword('tekil7')), r0.uid, 'yeni parola aynı hesabı açar');
    assert.equal(REG.resolveLoginCode(people, 'ortak1').person.id, 'dup_b');
    assert.equal(REG.resolveLoginCode(people, 'tekil7').person.id, 'dup_a');
    assert.equal(REG.duplicateGroups(people).length, 0);
    assert.equal(primary.auth.currentUser.uid, adminUid, 'admin oturumu düşmedi');
    assert.equal(provisioner.auth.currentUser, null);
});

test('J7.5 · hesabı olmayan kişinin kodu değişir → yalnız kod; ardından J7 hesabı YENİ kodla açar', async () => {
    const [B] = await readMany(primary.db, ['dup_b']);
    const r = await SP.changeStaffCode(B, 'tekil8', provisioner, writeVia(primary.db));
    assert.equal(r.status, 'changed-code-only');
    const [B2] = await readMany(primary.db, ['dup_b']);
    assert.equal(B2.code, 'tekil8');
    const p = await SP.provisionOne(B2, provisioner, linkVia(primary.db));
    assert.equal(p.status, 'created');
    assert.equal(await login(SP.staffEmail('dup_b'), SP.staffPassword('tekil8')), p.uid);
});

test('J7.5 · personel kaydı yazılamazsa (GERÇEK kural reddi) Auth parolası eski koda geri alınır', async () => {
    const C = { id: 'dup_c', name: 'Geri Alma', code: 'ortak2' };
    await setDoc(ref(primary.db, C.id), C);
    const r0 = await SP.provisionOne(C, provisioner, linkVia(primary.db));
    // Yazıcı yönetici olmayan (personel hesabı) bir oturumla yazar → üretim kuralları reddeder
    const staff = session('j75staff');
    await signInWithEmailAndPassword(staff.auth, SP.staffEmail('dup_b'), SP.staffPassword('tekil8'));
    const [Cnow] = await readMany(primary.db, ['dup_c']);
    const r = await SP.changeStaffCode(Cnow, 'tekil9', provisioner, writeVia(staff.db));
    assert.equal(r.status, 'write-failed');
    assert.equal(r.reverted, true);
    assert.match(r.reason, /permission-denied/);
    assert.equal((await readMany(primary.db, ['dup_c']))[0].code, 'ortak2', 'kayıt değişmedi');
    assert.equal(await login(SP.staffEmail('dup_c'), SP.staffPassword('ortak2')), r0.uid, 'eski parola geri geldi');
    assert.equal(await login(SP.staffEmail('dup_c'), SP.staffPassword('tekil9')), null);
    await signOut(staff.auth);
});

test('J7.5 · bağlı hesabın parolası koddan sapmışsa → auth-out-of-sync, hiçbir şey yazılmaz', async () => {
    const D = { id: 'dup_d', name: 'Sapmış', code: 'ortak3' };
    await setDoc(ref(primary.db, D.id), D);
    const r0 = await SP.provisionOne(D, provisioner, linkVia(primary.db));
    const x = session('j75drift');   // yalnız test: parolayı koddan bağımsız bir değere çek
    const c = await signInWithEmailAndPassword(x.auth, SP.staffEmail('dup_d'), SP.staffPassword('ortak3'));
    await updatePassword(c.user, 'tamamenBaskaParola1');
    await signOut(x.auth);
    const [Dnow] = await readMany(primary.db, ['dup_d']);
    const r = await SP.changeStaffCode(Dnow, 'tekil0', provisioner, writeVia(primary.db));
    assert.equal(r.status, 'auth-out-of-sync');
    const [Dafter] = await readMany(primary.db, ['dup_d']);
    assert.equal(Dafter.code, 'ortak3');
    assert.equal(Dafter.uid, r0.uid);
});
