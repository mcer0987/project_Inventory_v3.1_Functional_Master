// [WHY]: Faz 4 · J0 (KJ-1) — Firestore kuralları proje genelinde; bir kuralı canlıya yayınlamadan doğrulamanın tek güvenli yolu emülatör.
//        Faz 4B · J10: Rules v2 Aşama B — anonim oturum yok; personel = kurumsal kimlik (PRI) e-postalı hesap; yöneticinin yazdığı
//        staffAccounts/{uid} eşlemesi + personel kaydında AYNI uid ve AYNI PRI; ziyaretçi hiçbir şey okuyamaz (KVKK); sahiplik
//        zorunlu; onay adımı yalnız sırası gelmiş onaylayıcının karar alanları (GPT-6 kötü niyetli senaryolar dahil).
// [HOW]: `npm run test:rules` → firebase emulators:exec içinde node:test. RULES_FILE ile başka bir kural dosyası denenebilir.
import { test, before, after, beforeEach, describe } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, deleteField, serverTimestamp, setLogLevel, collection, query, orderBy, limit, getDocs } from 'firebase/firestore';

// Beklenen her ret SDK'da PERMISSION_DENIED uyarısı basar; sonuçlar node:test raporunda.
setLogLevel('silent');

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RULES_FILE = process.env.RULES_FILE || 'firestore.rules';
const LIVE = 'lifeserver_master';
const DEMO = 'inventory_demo';
const ADMIN_EMAIL = 'admin@medipol.local';
const XSS = '<img src=x onerror=alert(1)>';

let env;

// Personel hesabı (J10 PRI): e-posta <pri>@staff.medipol.local; kural staffAccounts/{uid} → personel kaydına gider ve orada aynı
// uid + aynı PRI arar.
const staffCtx = (uid, pri) => () => env.authenticatedContext(uid, { email: `${pri}@staff.medipol.local`, firebase: { sign_in_provider: 'password' } }).firestore();
const ctx = {
    none: () => env.unauthenticatedContext().firestore(),
    anon: () => env.authenticatedContext('anon-uid', { firebase: { sign_in_provider: 'anonymous' } }).firestore(),
    admin: () => env.authenticatedContext('admin-uid', { email: ADMIN_EMAIL, firebase: { sign_in_provider: 'password' } }).firestore(),
    otherUser: () => env.authenticatedContext('other-uid', { email: 'someone@medipol.local', firebase: { sign_in_provider: 'password' } }).firestore(),
    forgedAnon: () => env.authenticatedContext('forged-uid', { email: ADMIN_EMAIL, firebase: { sign_in_provider: 'anonymous' } }).firestore(),
    s1: staffCtx('uid-s1', 'ayse.yilmaz'),        // bağlı personel
    s2: staffCtx('uid-s2', 'bora.kaya'),          // bağlı personel (onaylayıcı)
    s3: staffCtx('uid-s3', 'cem.demir'),          // bağlı personel (ikinci onaylayıcı)
    forged: staffCtx('uid-evil', 'ayse.yilmaz'),  // s1'in PRI e-postasını taşıyan başka uid (eşleme yok)
    signup: staffCtx('uid-signup', 'nobody.yok'), // kendine @staff hesabı açmış, personel kaydı ve eşleme yok
    unlinked: staffCtx('uid-s4', 'deniz.ak'),     // personel kaydı var ama hesaba bağlanmamış (uid yok, eşleme yok)
    squatter: staffCtx('uid-squat', 'deniz.ak'),  // PRI'yi addan tahmin edip hesabı ÖNCEDEN açmış (eşleme yok)
    staleMap: staffCtx('uid-stale', 'deniz.ak'),  // eşleme var (uid-stale → s4) ama personel kaydında uid yok (bağ kaldırılmış)
    ghost: staffCtx('uid-ghost', 'hayalet.kisi'), // eşleme silinmiş bir personel kaydını gösteriyor
    wrongPri: staffCtx('uid-s1', 'baska.isim'),   // eşleme + uid doğru; e-postadaki PRI personel kaydındakiyle aynı değil
    legacyJ7: staffCtx('uid-s1', 'ps1'),          // taşınmamış J7 adresi (p<id>@) — PRI değil
    anonStaffEmail: () => env.authenticatedContext('uid-s1', { email: 'ayse.yilmaz@staff.medipol.local', firebase: { sign_in_provider: 'anonymous' } }).firestore(),
};

const item = (db, root, col, id) => doc(db, root, col, 'items', String(id));
async function seed(fn) { await env.withSecurityRulesDisabled(async (c) => fn(c.firestore())); }
async function setMaintenance(on, root = LIVE) { await seed(db => setDoc(item(db, root, 'system_config', 'admin_settings'), { maintenance: on })); }
const put = (col, id, data, root = LIVE) => seed(db => setDoc(item(db, root, col, id), { id, ...data }));
const rd = async (col, id, root = LIVE) => { let v; await seed(async db => { v = (await getDoc(item(db, root, col, id))).data(); }); return v; };

before(async () => {
    env = await initializeTestEnvironment({ projectId: 'demo-rules-test', firestore: { rules: readFileSync(resolve(ROOT_DIR, RULES_FILE), 'utf8') } });
    console.log(`[rules] ${RULES_FILE}`);
});
after(async () => { if (env) await env.cleanup(); });

beforeEach(async () => {
    await env.clearFirestore();
    await seed(async db => {
        for (const root of [LIVE, DEMO]) {
            await setDoc(item(db, root, 'personel', 's1'), { id: 's1', name: 'Ayşe Yılmaz', pri: 'ayse.yilmaz', uid: 'uid-s1' });
            await setDoc(item(db, root, 'personel', 's2'), { id: 's2', name: 'Bora Kaya', pri: 'bora.kaya', uid: 'uid-s2' });
            await setDoc(item(db, root, 'personel', 's3'), { id: 's3', name: 'Cem Demir', pri: 'cem.demir', uid: 'uid-s3' });
            await setDoc(item(db, root, 'personel', 's4'), { id: 's4', name: 'Deniz Ak', pri: 'deniz.ak' });
            for (const [uid, personelId, pri] of [['uid-s1', 's1', 'ayse.yilmaz'], ['uid-s2', 's2', 'bora.kaya'], ['uid-s3', 's3', 'cem.demir'],
                ['uid-stale', 's4', 'deniz.ak'], ['uid-ghost', 'silinmis', 'hayalet.kisi']]) {
                await setDoc(item(db, root, 'staffAccounts', uid), { personelId, pri });
            }
        }
        await setDoc(item(db, LIVE, 'personel', 's5'), { id: 's5', name: 'Yalnız Canlı', pri: 'yalniz.canli', uid: 'uid-s5' });
        await setDoc(item(db, LIVE, 'staffAccounts', 'uid-s5'), { personelId: 's5', pri: 'yalniz.canli' });
        await setDoc(item(db, LIVE, 'b1', 'p1'), { id: 'p1', ürün: 'Laptop', adet: 3 });
        await setDoc(item(db, LIVE, 'requests', 'r1'), { id: 'r1', ürün: 'Mouse', adet: 1, durum: 'Beklemede', personel: 'Ayşe', personelUid: 'uid-s1' });
        await setDoc(item(db, LIVE, 'requests', 'rlegacy'), { id: 'rlegacy', ürün: 'Eski', adet: 1, durum: 'Beklemede', personel: 'Ayşe' });
        await setDoc(item(db, LIVE, 'tasks', 't1'), { id: 't1', title: 'Görev', priority: 'medium', creatorUid: 'uid-s1', assigneeUid: 'uid-s2', status: 'Pending' });
        await setDoc(item(db, LIVE, 'workflowTemplates', 'w1'), { id: 'w1', name: 'Şablon' });
        await setDoc(item(db, LIVE, 'system_config', 'admin_settings'), { maintenance: false });
        await setDoc(item(db, LIVE, 'staffDirectory', 'current'), { entries: [{ id: 's1', name: 'Ayşe', birim: 'BT' }] });   // J10 ilk sürümünden kalan
        await setDoc(item(db, DEMO, 'requests', 'rtest'), { id: 'rtest', ürün: 'X __flowtest__', durum: 'Beklemede' });
        await setDoc(item(db, DEMO, 'requests', 'rreal'), { id: 'rreal', ürün: 'Gerçek demo kaydı', durum: 'Beklemede' });
        await setDoc(item(db, LIVE, 'requests', 'rlivetest'), { id: 'rlivetest', ürün: 'X __flowtest__', durum: 'Beklemede' });
        await setDoc(doc(db, 'inventory_v2', 'b1', 'items', 'old1'), { id: 'old1', ürün: 'Eski' });
        await setDoc(doc(db, 'inventory', 'b1'), { legacy: true });
        await setDoc(doc(db, 'system_config', 'legacy'), { maintenance: false });
        await setDoc(item(db, LIVE, 'auditLogs', 'a1'), { id: 'a1', result: 'blocked' });
    });
});

describe('Kimlik ve okuma (Aşama B · Ek D "Ziyaretçi ✗")', () => {
    test('bağlı personel b1 okur', () => assertSucceeds(getDoc(item(ctx.s1(), LIVE, 'b1', 'p1'))));
    test('bağlı personel personel / şablon / ayar okur', async () => {
        await assertSucceeds(getDoc(item(ctx.s1(), LIVE, 'personel', 's2')));
        await assertSucceeds(getDoc(item(ctx.s1(), LIVE, 'workflowTemplates', 'w1')));
        await assertSucceeds(getDoc(item(ctx.s1(), LIVE, 'system_config', 'admin_settings')));
    });
    test('anonim oturum hiçbir şey okuyamaz', () => assertFails(getDoc(item(ctx.anon(), LIVE, 'b1', 'p1'))));
    test('oturumsuz ziyaretçi okuyamaz', () => assertFails(getDoc(item(ctx.none(), LIVE, 'b1', 'p1'))));
    test('uid personel kaydıyla eşleşmeyen hesap (aynı e-posta iddiası) okuyamaz', () => assertFails(getDoc(item(ctx.forged(), LIVE, 'b1', 'p1'))));
    test('kendine @staff hesabı açan ama personel kaydı olmayan okuyamaz', () => assertFails(getDoc(item(ctx.signup(), LIVE, 'b1', 'p1'))));
    test('KÖTÜ NİYET: PRI\'yi addan tahmin edip hesabı önceden açan okuyamaz (eşleme yok)', () => assertFails(getDoc(item(ctx.squatter(), LIVE, 'b1', 'p1'))));
    test('KÖTÜ NİYET: eşleme kalmış ama personel kaydındaki bağ kaldırılmış hesap okuyamaz', () => assertFails(getDoc(item(ctx.staleMap(), LIVE, 'b1', 'p1'))));
    test('KÖTÜ NİYET: silinmiş personel kaydını gösteren eşleme yetki vermez', () => assertFails(getDoc(item(ctx.ghost(), LIVE, 'b1', 'p1'))));
    test('KÖTÜ NİYET: uid ve eşleme doğru ama e-postadaki PRI personel kaydındakinden farklı → okuyamaz', () => assertFails(getDoc(item(ctx.wrongPri(), LIVE, 'b1', 'p1'))));
    test('taşınmamış J7 adresi (p<id>@) personel sayılmaz', () => assertFails(getDoc(item(ctx.legacyJ7(), LIVE, 'b1', 'p1'))));
    test('hesabı bağlanmamış personel kaydı okuyamaz', () => assertFails(getDoc(item(ctx.unlinked(), LIVE, 'b1', 'p1'))));
    test('anonim sağlayıcıyla personel e-postası iddiası okuyamaz', () => assertFails(getDoc(item(ctx.anonStaffEmail(), LIVE, 'b1', 'p1'))));
    test('başka e-posta alanı (@medipol.local) personel sayılmaz', () => assertFails(getDoc(item(ctx.otherUser(), LIVE, 'b1', 'p1'))));
    test('yalnız canlı kökte bağlı personel demo kökünü okuyamaz', async () => {
        await assertSucceeds(getDoc(item(staffCtx('uid-s5', 'yalniz.canli')(), LIVE, 'b1', 'p1')));
        await assertFails(getDoc(item(staffCtx('uid-s5', 'yalniz.canli')(), DEMO, 'b1', 'p1')));
    });
    test('admin canlı kökte okur', () => assertSucceeds(getDoc(item(ctx.admin(), LIVE, 'b1', 'p1'))));
    test('tanımsız kök reddedilir (admin dahil)', () => assertFails(getDoc(item(ctx.admin(), 'rogue_root', 'b1', 'p1'))));
    test('bilinmeyen koleksiyon reddedilir', () => assertFails(getDoc(item(ctx.s1(), LIVE, 'secretCol', 'x'))));
    test('V1 arşivi admin için de kapalı', () => assertFails(getDoc(doc(ctx.admin(), 'inventory', 'b1'))));
    test('KJ-2: inventory_v2 personel okuyamaz', () => assertFails(getDoc(doc(ctx.s1(), 'inventory_v2', 'b1', 'items', 'old1'))));
    test('KJ-2: inventory_v2 admin okur / yazar', async () => {
        await assertSucceeds(getDoc(doc(ctx.admin(), 'inventory_v2', 'b1', 'items', 'old1')));
        await assertSucceeds(setDoc(doc(ctx.admin(), 'inventory_v2', 'b1', 'items', 'old2'), { id: 'old2' }));
    });
    test('kök system_config bloğu yok (personel okuyamaz)', () => assertFails(getDoc(doc(ctx.s1(), 'system_config', 'legacy'))));
});

describe('KVKK: oturumsuz okuma yok · personel hesap eşlemesi (staffAccounts)', () => {
    test('oturumsuz ziyaretçi personel kaydını da personel listesini de okuyamaz', async () => {
        await assertFails(getDoc(item(ctx.none(), LIVE, 'personel', 's1')));
        await assertFails(getDocs(collection(ctx.none(), LIVE, 'personel', 'items')));
        await assertFails(getDocs(collection(ctx.anon(), LIVE, 'personel', 'items')));
    });
    test('giriş rehberi (staffDirectory) kaldırıldı: ziyaretçi, personel ve admin dahil kapalı', async () => {
        for (const db of [ctx.none(), ctx.s1(), ctx.admin()]) await assertFails(getDoc(item(db, LIVE, 'staffDirectory', 'current')));
        await assertFails(setDoc(item(ctx.admin(), LIVE, 'staffDirectory', 'current'), { entries: [] }));
    });
    test('eşlemeyi yalnız admin okur ve yazar', async () => {
        await assertSucceeds(getDoc(item(ctx.admin(), LIVE, 'staffAccounts', 'uid-s1')));
        await assertSucceeds(setDoc(item(ctx.admin(), LIVE, 'staffAccounts', 'uid-new'), { personelId: 's4', pri: 'deniz.ak' }));
        for (const db of [ctx.none(), ctx.anon(), ctx.s1()]) await assertFails(getDoc(item(db, LIVE, 'staffAccounts', 'uid-s1')));
    });
    test('KÖTÜ NİYET: kendine hesap açan kendini bir personele bağlayamaz (eşleme yazamaz)', async () => {
        await assertFails(setDoc(item(ctx.signup(), LIVE, 'staffAccounts', 'uid-signup'), { personelId: 's4', pri: 'nobody.yok' }));
        await assertFails(setDoc(item(ctx.squatter(), LIVE, 'staffAccounts', 'uid-squat'), { personelId: 's4', pri: 'deniz.ak' }));
        await assertFails(setDoc(item(ctx.s1(), LIVE, 'staffAccounts', 'uid-s1'), { personelId: 's2', pri: 'ayse.yilmaz' }));
    });
    test('KÖTÜ NİYET: personel kendi kaydına uid / PRI yazamaz (yalnız admin)', async () => {
        await assertFails(updateDoc(item(ctx.squatter(), LIVE, 'personel', 's4'), { uid: 'uid-squat' }));
        await assertFails(updateDoc(item(ctx.s1(), LIVE, 'personel', 's1'), { pri: 'baska.isim' }));
        await assertSucceeds(updateDoc(item(ctx.admin(), LIVE, 'personel', 's4'), { pri: 'deniz.ak2' }));
    });
    test('tanımsız kökte eşleme admin için de kapalı', () => assertFails(getDoc(item(ctx.admin(), 'rogue_root', 'staffAccounts', 'uid-s1'))));
});

describe('Admin kimliği', () => {
    test('admin b1 yazar', () => assertSucceeds(setDoc(item(ctx.admin(), LIVE, 'b1', 'p2'), { id: 'p2', ürün: 'Yeni' })));
    test('başka e-postalı hesap b1 yazamaz', () => assertFails(setDoc(item(ctx.otherUser(), LIVE, 'b1', 'p2'), { id: 'p2' })));
    test('anonim sağlayıcıyla admin e-postası iddiası b1 yazamaz', () => assertFails(setDoc(item(ctx.forgedAnon(), LIVE, 'b1', 'p2'), { id: 'p2' })));
});

describe('Yönetici koleksiyonları', () => {
    for (const col of ['b1', 'b2', 'b3', 'personel', 'units', 'locations', 'productTypes', 'workflowTemplates', 'staff', 'system_config', 'assignments', 'serviceRecords']) {
        test(`personel ${col} yazamaz`, () => assertFails(setDoc(item(ctx.s1(), LIVE, col, 'z1'), { id: 'z1' })));
    }
    test('admin assignments yazar', () => assertSucceeds(setDoc(item(ctx.admin(), LIVE, 'assignments', 'as1'), { id: 'as1' })));
    test('anonim hiçbir koleksiyona yazamaz', async () => {
        await assertFails(setDoc(item(ctx.anon(), LIVE, 'requests', 'r9'), { id: 'r9', ürün: 'X', durum: 'Beklemede', personelUid: 'anon-uid' }));
        await assertFails(setDoc(item(ctx.anon(), LIVE, 'tasks', 't9'), { id: 't9', title: 'X', creatorUid: 'anon-uid' }));
    });
});

describe('Envanter talebi (requests) — sahiplik', () => {
    const mine = { ürün: 'Klavye', adet: 1, durum: 'Beklemede', personelUid: 'uid-s1' };
    test('personel kendi uid\'siyle oluşturur', () => assertSucceeds(setDoc(item(ctx.s1(), LIVE, 'requests', 'n1'), { id: 'n1', ...mine })));
    test('uid\'siz oluşturamaz', () => assertFails(setDoc(item(ctx.s1(), LIVE, 'requests', 'n1'), { id: 'n1', ...mine, personelUid: null })));
    test('başkası adına oluşturamaz', () => assertFails(setDoc(item(ctx.s1(), LIVE, 'requests', 'n1'), { id: 'n1', ...mine, personelUid: 'uid-s2' })));
    test('onaylanmış olarak oluşturamaz', () => assertFails(setDoc(item(ctx.s1(), LIVE, 'requests', 'n1'), { id: 'n1', ...mine, durum: 'approved' })));
    test('sahibi bekleyen talebi düzenler, geri çeker, yeniden gönderir', async () => {
        await assertSucceeds(updateDoc(item(ctx.s1(), LIVE, 'requests', 'r1'), { ürün: 'Mouse 2', adet: 2, not: 'acil' }));
        await assertSucceeds(updateDoc(item(ctx.s1(), LIVE, 'requests', 'r1'), { durum: 'draft' }));
        await assertSucceeds(updateDoc(item(ctx.s1(), LIVE, 'requests', 'r1'), { durum: 'Beklemede', tarih: '16.10.2026' }));
    });
    test('sahibi kendi talebini onaylayamaz / zimmet alanı yazamaz', async () => {
        await assertFails(updateDoc(item(ctx.s1(), LIVE, 'requests', 'r1'), { durum: 'approved' }));
        await assertFails(updateDoc(item(ctx.s1(), LIVE, 'requests', 'r1'), { sn: 'SN1', approvedBy: 'Ben' }));
    });
    test('başkasının talebini güncelleyemez', () => assertFails(updateDoc(item(ctx.s2(), LIVE, 'requests', 'r1'), { durum: 'draft' })));
    test('sahipliği olmayan (göç edilmemiş) talebi personel güncelleyemez; admin günceller', async () => {
        await assertFails(updateDoc(item(ctx.s1(), LIVE, 'requests', 'rlegacy'), { durum: 'draft' }));
        await assertSucceeds(updateDoc(item(ctx.admin(), LIVE, 'requests', 'rlegacy'), { durum: 'approved', personelUid: 'uid-s1' }));
    });
    test('onaylanmış talebi teslim alır (completed); başka alanla birlikte alamaz', async () => {
        await put('requests', 'r2', { ...mine, durum: 'approved', sn: 'SN9' });
        await assertFails(updateDoc(item(ctx.s1(), LIVE, 'requests', 'r2'), { durum: 'completed', sn: 'BAŞKA' }));
        await assertSucceeds(updateDoc(item(ctx.s1(), LIVE, 'requests', 'r2'), { durum: 'completed', teslimTarihi: '16.10.2026' }));
    });
    test('onaylanmış talebin içeriği değiştirilemez', async () => {
        await put('requests', 'r2', { ...mine, durum: 'approved' });
        await assertFails(updateDoc(item(ctx.s1(), LIVE, 'requests', 'r2'), { adet: 5 }));
    });
    test('sahiplik alanı değiştirilemez / silinemez', async () => {
        await assertFails(updateDoc(item(ctx.s1(), LIVE, 'requests', 'r1'), { personelUid: 'uid-s2' }));
        await assertFails(updateDoc(item(ctx.s1(), LIVE, 'requests', 'r1'), { personelUid: deleteField() }));
    });
});

// ─── Satın alma ve ONAY ADIMI (GPT-6 kötü niyetli senaryolar) ──────────────────────────────────────────────
const step = (uid, extra = {}) => ({ user: uid === 'uid-s2' ? 'Bora' : uid === 'uid-s3' ? 'Cem' : 'Ayşe', userUid: uid, tip: 'Paraf', status: 'pending', note: '', date: '', ...extra });
const hist = [{ action: 'create', actor: 'Ayşe', timestamp: 't0' }];
const akis = [{ islem: 'Talep Oluşturuldu', yapan: 'Ayşe', tarih: 't0' }];
const running = (over = {}) => ({
    urun: 'Toner', adet: 1, durum: 'Onay Bekliyor', createdByUid: 'uid-s1', createdByName: 'Ayşe', akis,
    workflow: { id: 'wf1', started: true, finished: false, currentStep: 0, currentState: 'initiation', steps: [step('uid-s2'), step('uid-s3')], history: hist },
    ...over,
});
// Onaylayıcının istemcide yaptığı geçerli onay (approveStep ile aynı alanlar)
function approved(po, i, wfOver = {}, top = {}) {
    const steps = po.workflow.steps.map((s, k) => (k === i ? { ...s, status: 'approved', date: '16.10.2026 10:00', actor: s.user } : s));
    const last = i + 1 >= steps.length;
    return { ...po, durum: last ? 'Onaylandı' : 'Onay Bekliyor', akis: [...po.akis, { islem: '✅ Onaylandı', yapan: 'x', tarih: 't1' }],
        workflow: { ...po.workflow, steps, currentStep: i + 1, finished: last, currentState: last ? 'completed' : 'manager_approval', history: [...po.workflow.history, { action: 'transition', actor: 'x', timestamp: 't1' }], ...wfOver }, ...top };
}

describe('Satın alma (purchaseOrders) — oluşturma ve sahibi', () => {
    const draft = { urun: 'Kağıt', aciklama: 'A4', durum: 'Onay Bekliyor', createdByUid: 'uid-s1', akis, workflow: { started: false, currentStep: 0, steps: [], history: [] } };
    test('personel kendi uid\'siyle, başlamamış akışla oluşturur', () => assertSucceeds(setDoc(item(ctx.s1(), LIVE, 'purchaseOrders', 'po2'), { id: 'po2', ...draft })));
    test('başkası adına / uid\'siz oluşturamaz', async () => {
        await assertFails(setDoc(item(ctx.s1(), LIVE, 'purchaseOrders', 'po2'), { id: 'po2', ...draft, createdByUid: 'uid-s2' }));
        await assertFails(setDoc(item(ctx.s1(), LIVE, 'purchaseOrders', 'po2'), { id: 'po2', ...draft, createdByUid: null }));
    });
    test('başlamış / önceden onaylanmış akışla oluşturamaz', async () => {
        await assertFails(setDoc(item(ctx.s1(), LIVE, 'purchaseOrders', 'po2'), { id: 'po2', ...draft, workflow: { ...draft.workflow, started: true } }));
        await assertFails(setDoc(item(ctx.s1(), LIVE, 'purchaseOrders', 'po2'), { id: 'po2', ...draft, workflow: { ...draft.workflow, steps: [step('uid-s2', { status: 'approved' })] } }));
        await assertFails(setDoc(item(ctx.s1(), LIVE, 'purchaseOrders', 'po2'), { id: 'po2', ...draft, durum: 'Onaylandı' }));
    });
    test('sahibi taslağı düzenler ve akışı başlatır (adımlar kararsız)', async () => {
        await put('purchaseOrders', 'po2', draft);
        await assertSucceeds(updateDoc(item(ctx.s1(), LIVE, 'purchaseOrders', 'po2'), { urun: 'Kağıt A3', akis: [...akis, { islem: 'güncellendi' }] }));
        await assertSucceeds(updateDoc(item(ctx.s1(), LIVE, 'purchaseOrders', 'po2'), {
            durum: 'Onay Bekliyor', workflow: { started: true, finished: false, currentStep: 0, currentState: 'initiation', steps: [step('uid-s2'), step('uid-s3')], history: [{ action: 'create' }] } }));
    });
    test('sahibi akışı kendisini onaylayıcı yaparak / önceden onaylı adımla / 11 adımla başlatamaz', async () => {
        await put('purchaseOrders', 'po2', draft);
        const start = steps => updateDoc(item(ctx.s1(), LIVE, 'purchaseOrders', 'po2'), { workflow: { started: true, finished: false, currentStep: 0, steps, history: [] } });
        await assertFails(start([step('uid-s2'), step('uid-s1')]));
        await assertFails(start([step('uid-s2', { status: 'approved' }), step('uid-s3')]));
        await assertFails(start(Array.from({ length: 11 }, () => step('uid-s2'))));
    });
    test('en ağır durum: sahibi 10 adımlı akışı başlatır (1000 ifade sınırı içinde), 10. adımın onayı da geçer', async () => {
        await put('purchaseOrders', 'po2', draft);
        const ten = Array.from({ length: 10 }, (_, i) => step(i % 2 ? 'uid-s3' : 'uid-s2'));
        await assertSucceeds(updateDoc(item(ctx.s1(), LIVE, 'purchaseOrders', 'po2'), { durum: 'Onay Bekliyor', akis: [...akis, { islem: 'başlatıldı' }],
            workflow: { started: true, finished: false, currentStep: 0, currentState: 'initiation', steps: ten, history: [{ action: 'create' }] } }));
        let po = running({ workflow: { ...running().workflow, steps: ten, history: Array.from({ length: 12 }, (_, i) => ({ action: 'transition', i })) },
            akis: Array.from({ length: 15 }, (_, i) => ({ islem: 'kayıt ' + i })) });
        for (let i = 0; i < 9; i++) po = approved(po, i);
        await put('purchaseOrders', 'po9', po);
        await assertFails(setDoc(item(ctx.s2(), LIVE, 'purchaseOrders', 'po9'), { id: 'po9', ...approved(po, 9) }));   // 10. adım s3'ün
        await assertSucceeds(setDoc(item(ctx.s3(), LIVE, 'purchaseOrders', 'po9'), { id: 'po9', ...approved(po, 9) }));
    });
    test('sahibi akış sürerken içeriği değiştiremez, kendisi onaylayamaz', async () => {
        await put('purchaseOrders', 'po3', running());
        await assertFails(updateDoc(item(ctx.s1(), LIVE, 'purchaseOrders', 'po3'), { urun: 'Altın' }));
        await assertFails(setDoc(item(ctx.s1(), LIVE, 'purchaseOrders', 'po3'), { id: 'po3', ...approved(running(), 0) }));
    });
    test('sahibi akış sürerken geri çeker (taslağa döner, geçmiş korunur)', async () => {
        await put('purchaseOrders', 'po3', running());
        await assertSucceeds(updateDoc(item(ctx.s1(), LIVE, 'purchaseOrders', 'po3'), {
            durum: 'Taslak', akis: [...akis, { islem: 'geri çekildi' }],
            workflow: { id: 'wf1', started: false, finished: false, currentStep: 0, currentState: 'initiation', status: 'draft', steps: [], history: [...hist, { action: 'withdraw' }] } }));
    });
    test('geri çekerken geçmişi silemez', async () => {
        await put('purchaseOrders', 'po3', running());
        await assertFails(updateDoc(item(ctx.s1(), LIVE, 'purchaseOrders', 'po3'), {
            durum: 'Taslak', workflow: { started: false, finished: false, currentStep: 0, steps: [], history: [] } }));
    });
    test('ilgisiz personel güncelleyemez', async () => {
        await put('purchaseOrders', 'po2', draft);
        await assertFails(updateDoc(item(ctx.s3(), LIVE, 'purchaseOrders', 'po2'), { urun: 'X' }));
    });
    test('personel satın almayı silemez; admin siler', async () => {
        await put('purchaseOrders', 'po2', draft);
        await assertFails(deleteDoc(item(ctx.s1(), LIVE, 'purchaseOrders', 'po2')));
        await assertSucceeds(deleteDoc(item(ctx.admin(), LIVE, 'purchaseOrders', 'po2')));
    });
});

describe('ONAY ADIMI güvenliği (GPT-6) — yalnız sırası gelmiş adım', () => {
    const write = (db, data) => setDoc(item(db, LIVE, 'purchaseOrders', 'po4'), { id: 'po4', ...data });
    beforeEach(() => put('purchaseOrders', 'po4', running()));

    test('sırası gelen onaylayıcı adımını onaylar', () => assertSucceeds(write(ctx.s2(), approved(running(), 0))));
    test('sırası gelen onaylayıcı reddeder (gerekçeli)', () => {
        const po = running();
        const steps = po.workflow.steps.map((s, k) => (k === 0 ? { ...s, status: 'rejected', note: 'bütçe yok', date: 'd', actor: 'Bora' } : s));
        return assertSucceeds(write(ctx.s2(), { ...po, durum: 'Reddedildi', akis: [...akis, { islem: '❌' }, { islem: '❌ 2' }],
            workflow: { ...po.workflow, steps, finished: true, currentState: 'cancelled', history: [...hist, { action: 'transition' }] } }));
    });
    test('son adım onayı akışı bitirir (Onaylandı)', async () => {
        const after0 = approved(running(), 0);
        await put('purchaseOrders', 'po4', after0);
        await assertSucceeds(write(ctx.s3(), approved(after0, 1)));
    });
    test('KÖTÜ NİYET: sırası gelmemiş onaylayıcı onaylayamaz', () => assertFails(write(ctx.s3(), approved(running(), 0))));
    test('KÖTÜ NİYET: sonraki adımı da onaylayamaz (iki adım birden)', () => {
        const a = approved(running(), 0);
        a.workflow.steps[1] = { ...a.workflow.steps[1], status: 'approved' };
        return assertFails(write(ctx.s2(), a));
    });
    test('KÖTÜ NİYET: sonraki adımın onaylayıcı kimliğini (userUid) değiştiremez', () => {
        const a = approved(running(), 0);
        a.workflow.steps[1] = { ...a.workflow.steps[1], userUid: 'uid-s2', user: 'Bora' };
        return assertFails(write(ctx.s2(), a));
    });
    test('KÖTÜ NİYET: kendi adımının onaylayıcı kimliğini / adını değiştiremez', async () => {
        const a = approved(running(), 0);
        a.workflow.steps[0] = { ...a.workflow.steps[0], userUid: 'uid-s3' };
        await assertFails(write(ctx.s2(), a));
        const b = approved(running(), 0);
        b.workflow.steps[0] = { ...b.workflow.steps[0], user: 'Başkası' };
        await assertFails(write(ctx.s2(), b));
    });
    test('KÖTÜ NİYET: geçmişi silemez / değiştiremez', async () => {
        await assertFails(write(ctx.s2(), approved(running(), 0, { history: [{ action: 'transition' }] })));
        await assertFails(write(ctx.s2(), approved(running(), 0, { history: [{ action: 'create', actor: 'SAHTE', timestamp: 't0' }, { action: 'transition' }] })));
    });
    test('KÖTÜ NİYET: akış kayıtlarını (akis) silemez / değiştiremez', async () => {
        await assertFails(write(ctx.s2(), approved(running(), 0, {}, { akis: [] })));
        await assertFails(write(ctx.s2(), approved(running(), 0, {}, { akis: [{ islem: 'SAHTE', yapan: 'x', tarih: 't0' }, { islem: '✅' }] })));
    });
    test('KÖTÜ NİYET: sırayı atlatamaz / akışı erken bitiremez / durumu tutarsız yazamaz', async () => {
        await assertFails(write(ctx.s2(), approved(running(), 0, { currentStep: 2 })));
        await assertFails(write(ctx.s2(), approved(running(), 0, { finished: true })));
        await assertFails(write(ctx.s2(), approved(running(), 0, {}, { durum: 'Onaylandı' })));
    });
    test('KÖTÜ NİYET: onaylarken talep içeriğini / sahibini değiştiremez', async () => {
        await assertFails(write(ctx.s2(), approved(running(), 0, {}, { urun: 'Altın' })));
        await assertFails(write(ctx.s2(), approved(running(), 0, {}, { createdByUid: 'uid-s2' })));
    });
    test('KÖTÜ NİYET: adım sayısını değiştiremez (adım ekleyip silerek)', async () => {
        const a = approved(running(), 0);
        a.workflow.steps = [...a.workflow.steps, step('uid-s2')];
        await assertFails(write(ctx.s2(), a));
        const b = approved(running(), 0);
        b.workflow.steps = b.workflow.steps.slice(0, 1);
        await assertFails(write(ctx.s2(), b));
    });
    test('KÖTÜ NİYET: talep sahibi onaylayıcı olarak eklenmiş olsa da kendi talebini onaylayamaz', async () => {
        await put('purchaseOrders', 'po4', running({ workflow: { ...running().workflow, steps: [step('uid-s1'), step('uid-s3')] } }));
        await assertFails(write(ctx.s1(), approved(running({ workflow: { ...running().workflow, steps: [step('uid-s1'), step('uid-s3')] } }), 0)));
    });
    test('durdurulmuş / bitmiş akışta onay yok', async () => {
        await put('purchaseOrders', 'po4', running({ workflow: { ...running().workflow, currentState: 'suspended' } }));
        await assertFails(write(ctx.s2(), approved(running({ workflow: { ...running().workflow, currentState: 'suspended' } }), 0)));
        const done = approved(approved(running(), 0), 1);
        await put('purchaseOrders', 'po4', done);
        await assertFails(updateDoc(item(ctx.s3(), LIVE, 'purchaseOrders', 'po4'), { durum: 'Onay Bekliyor' }));
    });
    test('onaylayıcı hesabı tanımsız adım (userUid yok) personelce onaylanamaz; admin onaylar', async () => {
        const noUid = running({ workflow: { ...running().workflow, steps: [{ user: 'Bora', tip: 'Paraf', status: 'pending' }, step('uid-s3')] } });
        await put('purchaseOrders', 'po4', noUid);
        await assertFails(write(ctx.s2(), approved(noUid, 0)));
        await assertSucceeds(write(ctx.admin(), approved(noUid, 0)));
    });
});

describe('Görev (tasks) — oluşturan / atanan', () => {
    test('personel kendi creatorUid\'siyle oluşturur; başkası adına / uid\'siz oluşturamaz', async () => {
        await assertSucceeds(setDoc(item(ctx.s1(), LIVE, 'tasks', 't2'), { id: 't2', title: 'Yeni', creatorUid: 'uid-s1' }));
        await assertFails(setDoc(item(ctx.s1(), LIVE, 'tasks', 't3'), { id: 't3', title: 'Yeni', creatorUid: 'uid-s2' }));
        await assertFails(setDoc(item(ctx.s1(), LIVE, 'tasks', 't4'), { id: 't4', title: 'Yeni' }));
    });
    test('oluşturan her alanı günceller (sahiplik hariç)', async () => {
        await assertSucceeds(updateDoc(item(ctx.s1(), LIVE, 'tasks', 't1'), { title: 'Yeni başlık', assigneeUid: 'uid-s3', assigneeId: 'Cem' }));
        await assertFails(updateDoc(item(ctx.s1(), LIVE, 'tasks', 't1'), { creatorUid: 'uid-s2' }));
    });
    test('atanan yalnız durum / mesaj / alt madde günceller', async () => {
        await assertSucceeds(updateDoc(item(ctx.s2(), LIVE, 'tasks', 't1'), { status: 'Completed', updatedAt: 'x', interactions: [{ user: 'Bora', message: 'tamam' }] }));
        await assertFails(updateDoc(item(ctx.s2(), LIVE, 'tasks', 't1'), { title: 'Değiştirdim' }));
        await assertFails(updateDoc(item(ctx.s2(), LIVE, 'tasks', 't1'), { assigneeUid: 'uid-s3' }));
    });
    test('ilgisiz personel güncelleyemez / silemez', async () => {
        await assertFails(updateDoc(item(ctx.s3(), LIVE, 'tasks', 't1'), { status: 'Completed' }));
        await assertFails(deleteDoc(item(ctx.s3(), LIVE, 'tasks', 't1')));
    });
    test('atanan silemez; oluşturan siler', async () => {
        await assertFails(deleteDoc(item(ctx.s2(), LIVE, 'tasks', 't1')));
        await assertSucceeds(deleteDoc(item(ctx.s1(), LIVE, 'tasks', 't1')));
    });
    test('sahipliği olmayan eski görevi personel güncelleyemez / silemez', async () => {
        await put('tasks', 'tlegacy', { title: 'Eski', creatorId: 'Ayşe' });
        await assertFails(updateDoc(item(ctx.s1(), LIVE, 'tasks', 'tlegacy'), { status: 'Completed' }));
        await assertFails(deleteDoc(item(ctx.s1(), LIVE, 'tasks', 'tlegacy')));
    });
    test('görev metninde etiket reddedilir', () => assertFails(updateDoc(item(ctx.s1(), LIVE, 'tasks', 't1'), { title: XSS })));
});

describe('Silme (KJ-5 test temizliği dahil)', () => {
    test('personel talep silemez; admin siler', async () => {
        await assertFails(deleteDoc(item(ctx.s1(), LIVE, 'requests', 'r1')));
        await assertSucceeds(deleteDoc(item(ctx.admin(), LIVE, 'requests', 'r1')));
    });
    test('KJ-5: demo kökünde __flowtest__ işaretli talep personelce silinir', () => assertSucceeds(deleteDoc(item(ctx.s1(), DEMO, 'requests', 'rtest'))));
    test('KJ-5: demo kökünde işaretsiz talep silinemez', () => assertFails(deleteDoc(item(ctx.s1(), DEMO, 'requests', 'rreal'))));
    test('KJ-5: istisna canlı kökte geçerli değil', () => assertFails(deleteDoc(item(ctx.s1(), LIVE, 'requests', 'rlivetest'))));
    test('KJ-5: anonim işaretli kaydı da silemez', () => assertFails(deleteDoc(item(ctx.anon(), DEMO, 'requests', 'rtest'))));
    test('KJ-5: işaret sayısal alanda olsa da hata vermez, silinmez', async () => {
        await put('requests', 'rnum', { ürün: 42, adet: 1 }, DEMO);
        await assertFails(deleteDoc(item(ctx.s1(), DEMO, 'requests', 'rnum')));
    });
});

describe('Bakım modu (RULE-05)', () => {
    test('bakımda personel talep oluşturamaz', async () => {
        await setMaintenance(true);
        await assertFails(setDoc(item(ctx.s1(), LIVE, 'requests', 'r3'), { id: 'r3', ürün: 'X', durum: 'Beklemede', personelUid: 'uid-s1' }));
    });
    test('bakımda personel görev silemez', async () => {
        await setMaintenance(true);
        await assertFails(deleteDoc(item(ctx.s1(), LIVE, 'tasks', 't1')));
    });
    test('bakımda admin yazar', async () => {
        await setMaintenance(true);
        await assertSucceeds(setDoc(item(ctx.admin(), LIVE, 'b1', 'p3'), { id: 'p3' }));
    });
    test('bakım başka kökte açıkken canlı kökte personel yazar', async () => {
        await setMaintenance(true, DEMO);
        await assertSucceeds(setDoc(item(ctx.s1(), LIVE, 'requests', 'r4'), { id: 'r4', ürün: 'X', durum: 'Beklemede', personelUid: 'uid-s1' }));
    });
    test('system_config: personel okur, anonim okuyamaz, admin yazar', async () => {
        await assertSucceeds(getDoc(item(ctx.s1(), LIVE, 'system_config', 'admin_settings')));
        await assertFails(getDoc(item(ctx.anon(), LIVE, 'system_config', 'admin_settings')));
        await assertSucceeds(setDoc(item(ctx.admin(), LIVE, 'system_config', 'admin_settings'), { maintenance: true }));
    });
});

describe('Etiket reddi (RULE-02 savunma derinliği)', () => {
    const own = { requests: { durum: 'Beklemede', personelUid: 'uid-s1' }, tasks: { creatorUid: 'uid-s1' },
        purchaseOrders: { durum: 'Onay Bekliyor', createdByUid: 'uid-s1', workflow: { started: false, steps: [] } } };
    const cases = [
        ['requests', { ürün: XSS }], ['requests', { not: '</script>' }], ['requests', { personel: '<svg onload=1>' }],
        ['requests', { id: '"><img src=x>' }],
        ['tasks', { title: XSS }], ['tasks', { description: '<iframe>' }], ['tasks', { priority: '<b>x</b>' }],
        ['purchaseOrders', { urun: XSS }], ['purchaseOrders', { aciklama: '<!-- x -->' }], ['purchaseOrders', { createdByName: '<a href=x>' }],
    ];
    for (const [col, fields] of cases) {
        test(`${col} ${Object.keys(fields)[0]} alanında etiket reddedilir`, () =>
            assertFails(setDoc(item(ctx.s1(), LIVE, col, 'xss1'), { ...own[col], ...fields, id: fields.id ?? 'xss1' })));
    }
    test('"<5mm" ve "a < b" serbest', () =>
        assertSucceeds(setDoc(item(ctx.s1(), LIVE, 'requests', 'lt1'), { id: 'lt1', ürün: '<5mm vida', not: 'adet a < b', ...own.requests })));
    test('admin yazmaları etiket kuralına tabi değil (kaçış istemcide)', () =>
        assertSucceeds(setDoc(item(ctx.admin(), LIVE, 'requests', 'adm1'), { id: 'adm1', not: '<b>admin</b>' })));
});

describe('Personel kaydı: düz metin kod yeniden yazılamaz (J10 kod temizliği)', () => {
    test('admin kodsuz personel oluşturur; kodlu oluşturamaz', async () => {
        await assertSucceeds(setDoc(item(ctx.admin(), LIVE, 'personel', 'n1'), { id: 'n1', name: 'Yeni', uid: 'uid-n1' }));
        await assertFails(setDoc(item(ctx.admin(), LIVE, 'personel', 'n2'), { id: 'n2', name: 'Yeni', code: '12345' }));
    });
    test('var olan kod aynen kalabilir ya da silinir; değiştirilemez, kodsuz kayda eklenemez', async () => {
        await put('personel', 'k1', { name: 'Eski', code: '11111', uid: 'uid-k1' });
        await assertSucceeds(updateDoc(item(ctx.admin(), LIVE, 'personel', 'k1'), { name: 'Eski Ad' }));
        await assertFails(updateDoc(item(ctx.admin(), LIVE, 'personel', 'k1'), { code: '22222' }));
        await assertSucceeds(updateDoc(item(ctx.admin(), LIVE, 'personel', 'k1'), { code: deleteField() }));
        await assertFails(updateDoc(item(ctx.admin(), LIVE, 'personel', 'k1'), { code: '11111' }));
        assert(!('code' in (await rd('personel', 'k1'))));
    });
});

describe('Denetim günlüğü (4.7 · KJ-7)', () => {
    const valid = (uid = 'uid-s1') => ({
        id: 'L1', type: 'Satın Alma Onayı', refCol: 'purchaseOrders', refId: 'po1', item: 'Toner', qty: 1,
        actorName: 'Ayşe', actorPersonelId: 's1', uid, authKind: 'password', result: 'blocked', reason: 'self-approval',
        page: 'index', ts: serverTimestamp(),
    });
    test('personel geçerli kayıt ekler', () => assertSucceeds(setDoc(item(ctx.s1(), LIVE, 'auditLogs', 'L1'), valid())));
    test('anonim ekleyemez', () => assertFails(setDoc(item(ctx.anon(), LIVE, 'auditLogs', 'L1'), valid('anon-uid'))));
    test('fazladan alan reddedilir', () => assertFails(setDoc(item(ctx.s1(), LIVE, 'auditLogs', 'L1'), { ...valid(), extra: 1 })));
    test('istemci saati reddedilir', () => assertFails(setDoc(item(ctx.s1(), LIVE, 'auditLogs', 'L1'), { ...valid(), ts: new Date() })));
    test('başkası adına uid reddedilir', () => assertFails(setDoc(item(ctx.s1(), LIVE, 'auditLogs', 'L1'), valid('someone-else'))));
    test('geçersiz sonuç reddedilir', () => assertFails(setDoc(item(ctx.s1(), LIVE, 'auditLogs', 'L1'), { ...valid(), result: 'hacked' })));
    test('etiketli metin reddedilir', () => assertFails(setDoc(item(ctx.s1(), LIVE, 'auditLogs', 'L1'), { ...valid(), item: XSS })));
    test('oturumsuz ekleyemez', () => assertFails(setDoc(item(ctx.none(), LIVE, 'auditLogs', 'L1'), valid())));
    test('personel okuyamaz', () => assertFails(getDoc(item(ctx.s1(), LIVE, 'auditLogs', 'a1'))));
    test('admin okur', () => assertSucceeds(getDoc(item(ctx.admin(), LIVE, 'auditLogs', 'a1'))));
    test('admin güncelleyemez', () => assertFails(updateDoc(item(ctx.admin(), LIVE, 'auditLogs', 'a1'), { result: 'approved' })));
    test('admin silemez', () => assertFails(deleteDoc(item(ctx.admin(), LIVE, 'auditLogs', 'a1'))));
    const reportQuery = db => getDocs(query(collection(db, LIVE, 'auditLogs', 'items'), orderBy('ts', 'desc'), limit(200)));
    test('admin rapor sorgusunu çalıştırır (J4)', () => assertSucceeds(reportQuery(ctx.admin())));
    test('personel rapor sorgusunu çalıştıramaz (J4)', () => assertFails(reportQuery(ctx.s1())));
});

function assert(v) { if (!v) throw new Error('assert'); }
