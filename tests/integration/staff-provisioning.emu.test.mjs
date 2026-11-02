// Faz 4B · J7 → J10 PRI — personel hesapları ve kurumsal kimlik (PRI) altyapısının Auth + Firestore EMÜLATÖRÜNE karşı uçtan uca
// doğrulaması. Gerçek Firebase JS SDK; staff-provisioning.js tarayıcıdaki dosyanın aynısı. Firestore'da ÜRETİM kuralları (Aşama B)
// yüklüdür. Bağlama, firebase-handler._linkStaffAccount ile aynı sırada: önce staffAccounts/{uid} eşlemesi, sonra personel kaydı.
// Kanıtlanan: (1) PRI / Hesap göçü: hesaplar <pri>@ adresinde açılır; J7 hesabının (p<id>@) e-postası uid KORUNARAK taşınır;
// ikincil 'provisioner' örneği ana admin oturumunu düşürmez; (2) PRI + kodla giriş çalışır, kurallar eşlemeyi tanır, eski J7
// adresi artık giriş vermez; (3) yeniden çalıştırma idempotent, yarım bağlama onarılır; (4) PRI'si tahmin edilip önceden açılmış
// hesap → conflict, o hesap hiçbir şey okuyamaz ve kendini eşleyemez; (5) personel kaydına kod yazılamaz; kod temizliğinden sonra
// giriş Auth ile sürer; (6) bağ kaldırılınca eşleme kalsa da erişim biter; oturumsuz ziyaretçi personel okuyamaz.
// J11: (7) P0 — erişim kilidi yokken göç yönetici tarafından yapılır, giriş yapan personel hiçbir şey okuyamaz; kilit kapanınca
// açık oturum yeni okumada reddedilir; (8) P1 — Auth taşıması olup Firestore bağı reddedilince ikinci koşu aynı uid'yi bağlar,
// başka uid'ye / başka personele hiçbir bağ yazılmaz (bağlama firebase-handler ile aynı tek-transaction kodu).
// Usage: npm run test:staff:emu   (firebase emulators:exec --only firestore,auth içinde)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { fileURLToPath } from 'node:url';
import { initializeApp, getApps, deleteApp } from 'firebase/app';
import {
    initializeAuth, inMemoryPersistence, connectAuthEmulator, createUserWithEmailAndPassword,
    signInWithEmailAndPassword, signOut, updateEmail,
} from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, doc, getDoc, getDocs, collection, setDoc, updateDoc, deleteField, terminate, runTransaction, serverTimestamp } from 'firebase/firestore';

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
// UID alanı Aşama 2 kurallarında değişmez. Yalnız eski/yarım bozuk kaydı canlandıran testler kural atlayarak tohumlar.
async function seedUnlinkedPerson(id, patch) {
    const env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { host: FS_HOST, port: Number(FS_PORT) } });
    try { await env.withSecurityRulesDisabled(ctx => updateDoc(ref(ctx.firestore(), id), patch)); }
    finally { await env.cleanup(); }
}

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
// J11 · P1: firebase-handler._linkStaffAccount ile AYNI kod (StaffProvisioning.createFirestoreLinker — tek transaction)
const linkVia = db => SP.createFirestoreLinker({ runTransaction, db, personelRef: id => ref(db, id), accountRef: uid => mapRef(db, uid) });
// J11 · P0 erişim kilidi. Kilidi "kapanış doğrulandı" durumuna getirmek bu dosyanın konusu değil (o uçtan uca
// tests/integration/ownership.emu.test.mjs'te kanıtlanır); burada kurallar kısa süre açık kurallarla değiştirilip tohumlanır
// (emu-seed ile aynı) ve üretim kuralları geri yüklenir.
const gateRef = db => doc(db, ROOT, 'accessGate', 'items', 'staff');
async function seedGate(enabled) {
    await putRules('rules_version = \'2\'; service cloud.firestore { match /databases/{d}/documents { match /{p=**} { allow read, write: if true; } } }');
    await setDoc(gateRef(primary.db), { staffAccessEnabled: enabled });
    await loadProductionRules();
}
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
async function putRules(content) {
    const res = await fetch(`http://${FS_HOST}:${FS_PORT}/emulator/v1/projects/${PROJECT}:securityRules`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content }] } }),
    });
    if (!res.ok) throw new Error('kurallar yüklenemedi: ' + res.status + ' ' + await res.text());
}
const loadProductionRules = () => putRules(fs.readFileSync(path.join(ROOT_DIR, 'firestore.rules'), 'utf8'));

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

const denied = e => code(e) === 'permission-denied';
const closeGate = reason => setDoc(gateRef(primary.db), { staffAccessEnabled: false, changedAt: serverTimestamp(), changedBy: primary.auth.currentUser.uid, reason, version: 1 });

test('J11 · P0: kilit yok (deploy sonrası varsayılan) → personel PRI + kodla giriş yapar ama HİÇBİR ŞEY okuyamaz/yazamaz; yalnız kilit durumunu okur', async () => {
    // Bu noktada göç az önce kilit YOKKEN yönetici tarafından yapıldı (önceki test) — yönetici etkilenmedi.
    assert.equal((await getDoc(gateRef(primary.db))).exists(), false, 'kilit dokümanı hiç yazılmadı');
    const p = (await readPersonel(primary.db)).find(x => x.id === 'user_manuel_001');
    const v = session('gate-default');
    const cred = await signInWithEmailAndPassword(v.auth, SP.staffEmail(p.pri), SP.staffPassword(p.code));
    assert.equal(cred.user.uid, p.uid, 'Auth girişi çalışır (zero-lookup)');
    await assert.rejects(getDoc(ref(v.db, p.id)), denied);
    await assert.rejects(getDocs(collection(v.db, ROOT, 'personel', 'items')), denied, 'kodlu personel listesi okunamaz');
    await assert.rejects(getDoc(doc(v.db, ROOT, 'system_config', 'items', 'admin_settings')), denied);
    await assert.rejects(setDoc(doc(v.db, ROOT, 'requests', 'items', 'g1'), { id: 'g1', ürün: 'x', durum: 'Beklemede', personelUid: p.uid }), denied);
    assert.equal((await getDoc(gateRef(v.db))).exists(), false, 'personel kilit durumunu okuyabilir (istemci "neden" diyebilsin)');
    await assert.rejects(setDoc(gateRef(v.db), { staffAccessEnabled: true }), denied, 'personel kilide yazamaz');
    // Yönetici kanıtsız açamaz; kapatma her zaman serbest
    await assert.rejects(setDoc(gateRef(primary.db), { staffAccessEnabled: true }), denied);
    await closeGate('göç sürüyor');
    await assert.rejects(getDoc(ref(v.db, p.id)), denied);
    await signOut(v.auth);
});

test('J11 · P0: kilit açıkken okuyan oturum, kilit kapanınca YENİ okumada hemen reddedilir (açık dinleyici davranışı kayda geçer)', async () => {
    await seedGate(true);   // kapanış doğrulanmış durum (bkz. seedGate notu)
    const p = (await readPersonel(primary.db)).find(x => x.id === 'user_manuel_001');
    const v = session('gate-revoke');
    await signInWithEmailAndPassword(v.auth, SP.staffEmail(p.pri), SP.staffPassword(p.code));
    assert.ok((await getDoc(ref(v.db, p.id))).exists(), 'kilit açık: okur');
    const { onSnapshot } = await import('firebase/firestore');
    const seen = { updates: 0, error: null };
    const first = new Promise(res => {
        const unsub = onSnapshot(ref(v.db, 'short1'), () => { seen.updates++; res(); }, e => { seen.error = code(e); res(); });
        seen.unsub = unsub;
    });
    await first;
    await closeGate('acil kapatma');
    await assert.rejects(getDoc(ref(v.db, p.id)), denied, 'yeni tek seferlik okuma reddedilir');
    await updateDoc(ref(primary.db, 'short1'), { not: 'kilit kapandıktan sonra yazıldı' });
    await new Promise(r => setTimeout(r, 1500));
    seen.unsub();
    console.log(`[J11 gözlem] kilit kapandıktan sonra açık dinleyici: ${seen.updates - 1} yeni güncelleme, hata: ${seen.error || 'yok'}`);
    // Emülatörde açık dinleyici kapanıştan sonraki yazmayı ALMAZ (permission-denied ile kesilir). Üretimde garanti varsayılmaz:
    // istemci kilit dinleyicisi (firebase-handler C2) oturumu ayrıca keser.
    assert.equal(seen.updates - 1, 0, 'kilit kapandıktan sonra yazılan veri açık dinleyiciye ulaşmadı');
    await signOut(v.auth);
    await seedGate(true);   // sonraki senaryolar göç sonrası (kilit açık) durumda koşar
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
    await seedUnlinkedPerson('user_manuel_001', { uid: deleteField(), authEmail: deleteField() });
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
    await seedUnlinkedPerson(p.id, { uid: deleteField() });
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

// ─── J11 · P1: hesap taşıma hata kurtarması (gerçek Auth + üretim kuralları) ─────────────────────────────────────────────
const OPEN_RULES = "rules_version = '2'; service cloud.firestore { match /databases/{d}/documents { match /{p=**} { allow read, write: if true; } } }";
async function seedLegacyPerson(id, name, kod, extra = {}) {
    // J10 öncesi veri gibi (kodlu kayıt): Aşama B kuralları kodu reddettiği için kısa süre açık kurallarla tohumlanır
    await putRules(OPEN_RULES);
    await setDoc(ref(primary.db, id), { id, name, code: kod, ...extra });
    await loadProductionRules();
}

test('J11 · P1 KABUL: J7 taşıması Auth tarafında tamamlanıp Firestore bağı REDDEDİLİNCE ikinci koşu aynı uid ile tamamlar (move-resumed)', async () => {
    const legacy = SP.legacyStaffEmail('j7_retry'), pw = SP.staffPassword('rt555');
    const s = session('j7-retry');
    const uid = (await createUserWithEmailAndPassword(s.auth, legacy, pw)).user.uid;
    await signOut(s.auth);
    await seedLegacyPerson('j7_retry', 'Yarım Taşınan', 'rt555', { uid, authEmail: legacy });

    // 1. koşu: bağ yazması yönetici OLMAYAN (oturumsuz) bir oturumdan → kurallar gerçekten reddeder (permission-denied)
    const outsider = session('outsider');
    const person = { ...(await readPersonel(primary.db)).find(x => x.id === 'j7_retry'), pri: 'yarim.tasinan' };
    const r1 = await SP.moveLegacyAccount(person, provisioner, linkVia(outsider.db));
    assert.deepEqual([r1.status, r1.kind, r1.uid], ['link-failed', 'permission-denied', uid]);
    await assert.rejects(signInWithEmailAndPassword(s.auth, legacy, pw), 'Auth tarafı taşındı: eski adres giriş vermez');
    assert.equal((await signInWithEmailAndPassword(s.auth, SP.staffEmail('yarim.tasinan'), pw)).user.uid, uid, 'PRI adresi aynı uid');
    await signOut(s.auth);
    const half = (await getDoc(ref(primary.db, 'j7_retry'))).data();
    assert.deepEqual([half.uid, half.authEmail, half.pri], [uid, legacy, undefined], 'Firestore tarafı eski hâlde');
    assert.equal((await getDoc(mapRef(primary.db, uid))).exists(), false, 'yarım eşleme yok (tek transaction)');

    // 2. koşu: göç aracının kendisi (taze okuma + plan + yönetici bağlayıcısı)
    const { plan, res } = await migrate();
    assert.deepEqual(plan.rows.filter(r => r.id === 'j7_retry').map(r => [r.action, r.pri]), [['move', 'yarim.tasinan']]);
    const row = res.results.find(r => r.id === 'j7_retry');
    assert.deepEqual([row.status, row.uid], ['move-resumed', uid]);
    assert.equal(res.stopped, null);
    const done = (await getDoc(ref(primary.db, 'j7_retry'))).data();
    assert.deepEqual([done.uid, done.authEmail, done.pri], [uid, 'yarim.tasinan@staff.medipol.local', 'yarim.tasinan']);
    assert.deepEqual((await getDoc(mapRef(primary.db, uid))).data().personelId, 'j7_retry');

    // Personel (kilit açık) PRI + koduyla girer ve okur; 3. koşu yalnız eşlemeyi yeniler
    const v = session('j7-retry-login');
    assert.equal((await signInWithEmailAndPassword(v.auth, SP.staffEmail('yarim.tasinan'), pw)).user.uid, uid);
    assert.ok((await getDoc(ref(v.db, 'j7_retry'))).exists());
    await signOut(v.auth);
    assert.deepEqual((await migrate()).res.results.filter(r => r.id === 'j7_retry').map(r => r.status), ['ok']);
});

test('J11 · P1: kurtarmada PRI adresindeki hesap BAŞKA uid → conflict; personel kaydı ve eşlemeler değişmez, yeni hesap açılmaz', async () => {
    const pw = SP.staffPassword('bk777');
    const s = session('other-acct');
    const otherUid = (await createUserWithEmailAndPassword(s.auth, 'baska.kisi@staff.medipol.local', pw)).user.uid;   // aynı kodla başkası
    await signOut(s.auth);
    await seedLegacyPerson('j7_wrong', 'Başka Kişi', 'bk777', { uid: 'uid-kayitli', authEmail: SP.legacyStaffEmail('j7_wrong') });
    const before = (await getDoc(ref(primary.db, 'j7_wrong'))).data();
    const r = await SP.moveLegacyAccount({ ...before, id: 'j7_wrong', pri: 'baska.kisi' }, provisioner, linkVia(primary.db));
    assert.deepEqual([r.status, r.kind], ['conflict', 'uid-mismatch']);
    assert.deepEqual((await getDoc(ref(primary.db, 'j7_wrong'))).data(), before);
    assert.equal((await getDoc(mapRef(primary.db, otherUid))).exists(), false);
    assert.equal((await getDoc(mapRef(primary.db, 'uid-kayitli'))).exists(), false);
});

test('J11 · P1: bağlayıcı, başka personele eşlenmiş uid\'yi ikinci bir personele bağlamaz (transaction içi denetim)', async () => {
    const p = (await readPersonel(primary.db)).find(x => x.id === 'user_manuel_001');
    await setDoc(ref(primary.db, 'j11_victim'), { id: 'j11_victim', name: 'Hedef Kişi', pri: 'hedef.kisi' });
    await assert.rejects(linkVia(primary.db)({ id: 'j11_victim', pri: 'hedef.kisi' }, { uid: p.uid, authEmail: 'hedef.kisi@staff.medipol.local', pri: 'hedef.kisi' }),
        e => code(e) === 'uid-mismatch');
    assert.equal((await getDoc(ref(primary.db, 'j11_victim'))).data().uid, undefined);
    assert.equal((await getDoc(mapRef(primary.db, p.uid))).data().personelId, 'user_manuel_001');
});
