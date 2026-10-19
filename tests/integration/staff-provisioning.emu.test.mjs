// Faz 4B · J7 → J10 PRI — personel hesapları ve kurumsal kimlik (PRI) altyapısının Auth + Firestore EMÜLATÖRÜNE karşı uçtan uca
// doğrulaması. Gerçek Firebase JS SDK; staff-provisioning.js tarayıcıdaki dosyanın aynısı. Firestore'da ÜRETİM kuralları (Aşama B)
// yüklüdür. Bağlama, firebase-handler._linkStaffAccount ile aynı sırada: önce staffAccounts/{uid} eşlemesi, sonra personel kaydı.
// Kanıtlanan: (1) PRI / Hesap göçü: hesaplar <pri>@ adresinde açılır; J7 hesabının (p<id>@) e-postası uid KORUNARAK taşınır;
// ikincil 'provisioner' örneği ana admin oturumunu düşürmez; (2) PRI + kodla giriş çalışır, kurallar eşlemeyi tanır, eski J7
// adresi artık giriş vermez; (3) yeniden çalıştırma idempotent, yarım bağlama onarılır; (4) PRI'si tahmin edilip önceden açılmış
// hesap → conflict, o hesap hiçbir şey okuyamaz ve kendini eşleyemez; (5) personel kaydına kod yazılamaz; kod temizliğinden sonra
// giriş Auth ile sürer; (6) bağ kaldırılınca eşleme kalsa da erişim biter; oturumsuz ziyaretçi personel okuyamaz.
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
    signInWithEmailAndPassword, signOut, updateEmail,
} from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, doc, getDoc, getDocs, collection, setDoc, updateDoc, deleteField, terminate } from 'firebase/firestore';

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
const SP = globalThis.window.StaffProvisioning;
const fns = { initializeApp, getApps, initializeAuth, inMemoryPersistence, connectAuthEmulator, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, updateEmail };

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
const mapRef = (db, uid) => doc(db, ROOT, 'staffAccounts', 'items', String(uid));
const code = e => e && e.code;

let primary, provisioner, legacyUid;
// J10 öncesi veri: kodlu personel, PRI yok. j7_legacy'nin J7 biçiminde (p<id>@) hesabı var ve bağlı.
const PERSONEL = [
    { id: 1790573516931123, name: 'Ali Veli', code: 'k1aaa' },
    { id: 'temp_1790573539061_cp4eq', name: 'Ayşe Yılmaz', code: 'Q7zP9' },
    { id: 'user_manuel_001', name: 'Mehmet Ali Kaya', code: 'x9y8z' },
    { id: 'Ab-Upper', name: 'Büyük Harfli Id', code: 'up123' },    // J7'de "p." + hex olurdu; PRI'de id önemsiz
    { id: 'short1', name: 'Kısa Kod', code: 'ab' },                // hesap açılamaz (kod kısa) → yalnız PRI
    { id: 'j7_legacy', name: 'Eski Hesaplı', code: 'old77' },      // J7 hesabı → taşınır
];
// firebase-handler._linkStaffAccount ile aynı sözleşme
const linkVia = db => async (person, fields) => {
    if (fields.uid) await setDoc(mapRef(db, fields.uid), { personelId: String(person.id), pri: fields.pri || person.pri, linkedAt: Date.now() });
    await updateDoc(ref(db, person.id), fields);
};
const writePriVia = db => (person, pri) => updateDoc(ref(db, person.id), { pri });
const readPersonel = async db => (await getDocs(collection(db, ROOT, 'personel', 'items'))).docs.map(d => ({ id: d.id, ...d.data() }));
const byId = list => new Map(list.map(p => [String(p.id), p]));
const migrate = async () => {
    const people = await readPersonel(primary.db);
    const plan = SP.planAccounts(people);
    return { plan, res: await SP.applyAccounts(plan, byId(people), provisioner, linkVia(primary.db), { writePri: writePriVia(primary.db) }) };
};

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
    primary = session('primary');
    // Ana sekmede admin oturumu (emülatörde hesap yoksa açılır; açılış zaten oturum açar)
    try { await createUserWithEmailAndPassword(primary.auth, ADMIN.email, ADMIN.password); }
    catch (e) { if (code(e) !== 'auth/email-already-in-use') throw e; await signInWithEmailAndPassword(primary.auth, ADMIN.email, ADMIN.password); }
    // J7 hesabı (eski biçim) ikincil bir oturumda açılır
    const old = session('j7-old');
    legacyUid = (await createUserWithEmailAndPassword(old.auth, SP.legacyStaffEmail('j7_legacy'), SP.staffPassword('old77'))).user.uid;
    await signOut(old.auth);
    // J10 öncesi veri (kodlu personel) kurallar yüklenmeden tohumlanır: Aşama B kuralları personel kaydına kod yazılmasını reddeder.
    for (const p of PERSONEL) {
        const extra = p.id === 'j7_legacy' ? { uid: legacyUid, authEmail: SP.legacyStaffEmail('j7_legacy') } : {};
        await setDoc(ref(primary.db, p.id), { ...p, ...extra });
    }
    await loadProductionRules();
    provisioner = SP.createAuthProvisioner({ fns, options: OPTIONS, emulatorUrl: AUTH_URL });
});
after(async () => {
    for (const app of getApps()) { try { await terminate(getFirestore(app)); } catch (_) { } await deleteApp(app); }
});

test('PRI / Hesap göçü: PRI atanır, <pri>@ hesapları açılır, J7 hesabı uid korunarak taşınır; admin oturumu DÜŞMEZ', async () => {
    const adminUid = primary.auth.currentUser.uid;
    const { plan, res } = await migrate();
    const action = Object.fromEntries(plan.rows.map(r => [r.id, [r.action, r.pri]]));
    assert.deepEqual(action, {
        '1790573516931123': ['create', 'ali.veli'], 'temp_1790573539061_cp4eq': ['create', 'ayse.yilmaz'], 'user_manuel_001': ['create', 'mehmet.kaya'],
        'Ab-Upper': ['create', 'buyuk.id'], 'short1': ['no-code', 'kisa.kod'], 'j7_legacy': ['move', 'eski.hesapli'],
    });
    assert.deepEqual(res.counts, { created: 4, moved: 1, 'pri-written': 1 });
    assert.equal(res.stopped, null);

    // Ana oturum hâlâ aynı admin ve kurallar onu hâlâ admin sayıyor
    assert.equal(primary.auth.currentUser && primary.auth.currentUser.uid, adminUid, 'admin oturumu korunmalı');
    await updateDoc(ref(primary.db, 'short1'), { not: 'admin hâlâ yazabiliyor' });
    assert.equal(provisioner.auth.currentUser, null, 'ikincil örnek işlemden sonra signOut eder');

    const after = byId(await readPersonel(primary.db));
    for (const [id, [, pri]] of Object.entries(action)) {
        const p = after.get(id);
        assert.equal(p.pri, pri, `${id} PRI`);
        if (id === 'short1') { assert.equal(p.uid, undefined); continue; }
        assert.ok(p.uid, `${id} uid almalı`);
        assert.equal(p.authEmail, `${pri}@staff.medipol.local`);
        const m = (await getDoc(mapRef(primary.db, p.uid))).data();
        assert.deepEqual([m.personelId, m.pri], [id, pri], `${id} kimlik eşlemesi`);
    }
    assert.equal(after.get('j7_legacy').uid, legacyUid, 'taşınan J7 hesabının uid\'si AYNI (sahiplik bağları kopmaz)');
});

test('PRI + kodla giriş: uid personel kaydındaki; kurallar eşlemeyi tanır (okur); eski J7 adresi artık giriş vermez', async () => {
    const people = (await readPersonel(primary.db)).filter(p => p.uid);
    for (const p of people) {
        const v = session('login-' + p.id);
        const cred = await signInWithEmailAndPassword(v.auth, SP.staffEmail(p.pri), SP.staffPassword(p.code));
        assert.equal(cred.user.uid, p.uid);
        assert.equal((await cred.user.getIdTokenResult()).signInProvider, 'password');
        assert.ok((await getDoc(ref(v.db, p.id))).exists(), `${p.pri} personel olarak okur`);
        await signOut(v.auth);
        await assert.rejects(signInWithEmailAndPassword(v.auth, SP.staffEmail(p.pri), p.code), 'çıplak kod (dolgusuz) parola değildir');
    }
    const old = session('old-email');
    await assert.rejects(signInWithEmailAndPassword(old.auth, SP.legacyStaffEmail('j7_legacy'), SP.staffPassword('old77')), 'J7 adresi taşındı');
});

test('idempotent: ikinci koşu hesap açmaz; yalnız kimlik eşlemeleri yenilenir', async () => {
    const { plan, res } = await migrate();
    assert.deepEqual({ ...plan.counts }, { total: 6, ok: 5, create: 0, move: 0, 'no-code': 1, blocked: 0, priWrites: 0 });
    assert.deepEqual(res.counts, { ok: 5 });
});

test('yarım bağlama onarılır: uid silinmiş kayıt → aynı hesap bulunup yeniden bağlanır (relinked, aynı uid)', async () => {
    const before = (await getDoc(ref(primary.db, 'user_manuel_001'))).data().uid;
    await updateDoc(ref(primary.db, 'user_manuel_001'), { uid: deleteField(), authEmail: deleteField() });
    const { res } = await migrate();
    assert.equal(res.counts.relinked, 1);
    assert.equal((await getDoc(ref(primary.db, 'user_manuel_001'))).data().uid, before);
});

test('PRI addan tahmin edilip hesap önceden açılmışsa → conflict; o hesap hiçbir şey okuyamaz ve kendini eşleyemez', async () => {
    const squatter = session('squatter');
    const cred = await createUserWithEmailAndPassword(squatter.auth, 'yeni.kisi@staff.medipol.local', 'saldirgan1');
    const p = { id: 'j10_new2', name: 'Yeni Kişi', pri: 'yeni.kisi' };
    await setDoc(ref(primary.db, p.id), p);
    const r = await SP.provisionOne(p, provisioner, linkVia(primary.db), { code: 'kod55' });
    assert.equal(r.status, 'conflict');
    assert.match(SP.describe(r).text, /PRI/);
    assert.equal((await getDoc(ref(primary.db, p.id))).data().uid, undefined);
    await assert.rejects(getDoc(ref(squatter.db, p.id)), e => code(e) === 'permission-denied');
    await assert.rejects(setDoc(mapRef(squatter.db, cred.user.uid), { personelId: p.id, pri: p.pri }), e => code(e) === 'permission-denied');
    await assert.rejects(updateDoc(ref(squatter.db, p.id), { uid: cred.user.uid }), e => code(e) === 'permission-denied');
    await signOut(squatter.auth);
});

test('Aşama B: bağlı personel okur ama admin DEĞİLDİR — personel/b1 yazamaz', async () => {
    const staff = session('staff');
    const p = (await readPersonel(primary.db)).find(x => x.id === 'user_manuel_001');
    await signInWithEmailAndPassword(staff.auth, SP.staffEmail(p.pri), SP.staffPassword(p.code));
    await assert.rejects(updateDoc(ref(staff.db, p.id), { name: 'kendini değiştirme' }), e => code(e) === 'permission-denied');
    await assert.rejects(setDoc(doc(staff.db, ROOT, 'b1', 'items', 'x'), { ürün: 'x' }), e => code(e) === 'permission-denied');
    await signOut(staff.auth);
});

test('KVKK: oturumsuz ziyaretçi personel kaydını ve listesini okuyamaz (giriş ekranı veritabanını okumaz)', async () => {
    const visitor = session('visitor');
    await assert.rejects(getDoc(ref(visitor.db, 'user_manuel_001')), e => code(e) === 'permission-denied');
    await assert.rejects(getDocs(collection(visitor.db, ROOT, 'personel', 'items')), e => code(e) === 'permission-denied');
});

test('J10: yönetici kodsuz personel oluşturur; <pri>@ hesabı parametreyle verilen kodla açılır; kayda kod yazılamaz', async () => {
    const p = { id: 'j10_new', name: 'Yeni Personel', birim: 'BT', pri: SP.generateStaffPri('Yeni Personel', (await readPersonel(primary.db)).map(x => x.pri)) };
    await setDoc(ref(primary.db, p.id), p);
    await assert.rejects(setDoc(ref(primary.db, 'j10_bad'), { id: 'j10_bad', name: 'Kodlu', code: 'abcd1' }), e => code(e) === 'permission-denied');
    const r = await SP.provisionOne(p, provisioner, linkVia(primary.db), { code: 'kod77' });
    assert.equal(r.status, 'created');
    assert.equal(r.email, 'yeni.personel@staff.medipol.local');
    const doc1 = (await getDoc(ref(primary.db, p.id))).data();
    assert.equal(doc1.uid, r.uid);
    assert.ok(!('code' in doc1), 'kod personel kaydına yazılmadı');
    await assert.rejects(updateDoc(ref(primary.db, p.id), { code: 'kod77' }), e => code(e) === 'permission-denied');
    const v = session('j10verify');
    assert.equal((await signInWithEmailAndPassword(v.auth, ' Yeni.Personel '.trim().toLowerCase() + '@staff.medipol.local', SP.staffPassword('kod77'))).user.uid, r.uid);
    assert.ok((await getDoc(ref(v.db, p.id))).exists(), 'yeni personel kendi hesabıyla okur');
    await signOut(v.auth);
});

test('bağ kaldırılınca (personel.uid silinir) eşleme kalsa da erişim biter', async () => {
    const p = (await readPersonel(primary.db)).find(x => x.id === 'j10_new');
    const v = session('unlinked');
    await signInWithEmailAndPassword(v.auth, SP.staffEmail(p.pri), SP.staffPassword('kod77'));
    assert.ok((await getDoc(ref(v.db, p.id))).exists());
    await updateDoc(ref(primary.db, p.id), { uid: deleteField() });
    assert.ok((await getDoc(mapRef(primary.db, p.uid))).exists(), 'eşleme duruyor');
    await assert.rejects(getDoc(ref(v.db, p.id)), e => code(e) === 'permission-denied');
    await signOut(v.auth);
});

test('J10 · kod temizliği: personel.code değiştirilemez, silinir; giriş Firebase Auth ile sürer', async () => {
    const p = (await readPersonel(primary.db)).find(x => x.id === 'temp_1790573539061_cp4eq');
    await assert.rejects(updateDoc(ref(primary.db, p.id), { code: 'baska1' }), e => code(e) === 'permission-denied');
    await updateDoc(ref(primary.db, p.id), { code: deleteField() });
    assert.ok(!('code' in (await getDoc(ref(primary.db, p.id))).data()));
    const v = session('cleansed');
    const cred = await signInWithEmailAndPassword(v.auth, SP.staffEmail(p.pri), SP.staffPassword('Q7zP9'));
    assert.equal(cred.user.uid, p.uid);
    assert.ok((await getDoc(ref(v.db, p.id))).exists());
    await signOut(v.auth);
});
