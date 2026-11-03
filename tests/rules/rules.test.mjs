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
import { doc, getDoc, setDoc, updateDoc, deleteDoc, deleteField, serverTimestamp, setLogLevel, collection, query, orderBy, limit, getDocs, writeBatch } from 'firebase/firestore';

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
function financeApprove(db,id,value){const batch=writeBatch(db);batch.set(item(db,LIVE,'purchaseOrders',id),{...value,id});batch.set(item(db,LIVE,'purchaseFinance',id),Object.fromEntries(['exchangeRate','exchangeRateDate','exchangeRateSource','reportingTotalTRY'].map(k=>[k,value[k]])));return batch.commit();}
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
            // J11 · P0: göç kapanışı doğrulanmış ortam (kilit AÇIK). Kilidin kendisi ayrı blokta: varsayılan kapalı, yarım göç vb.
            await setDoc(item(db, root, 'accessGate', 'staff'), { staffAccessEnabled: true });
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
    test('KÖTÜ NİYET: eşlemedeki personelId metin değilse (sayı / harita / boş) yetki vermez', async () => {
        for (const personelId of [1, { id: 's1' }, '', null]) {
            await seed(db => setDoc(item(db, LIVE, 'staffAccounts', 'uid-s1'), { personelId, pri: 'ayse.yilmaz' }));
            await assertFails(getDoc(item(ctx.s1(), LIVE, 'b1', 'p1')));
        }
    });
    test('tanımsız kökte eşleme admin için de kapalı',() => assertFails(getDoc(item(ctx.admin(), 'rogue_root', 'staffAccounts', 'uid-s1'))));
});

// G6A-1 · Faz 4B isStaff() zincirinin fail-closed davranışı — brifte N3/N5/N6 olarak adlandırılan tam senaryoların izole kanıtı.
// Diğer describe bloklarındaki testler (KÖTÜ NİYET: uid/eşleme/ghost/wrongPri vb.) bu mekanizmaları zaten dolaylı kanıtlıyor;
// burada yalnız brifin net ayrım istediği üç uç durum TEK DEĞİŞKENLE izole edilir.
describe('G6A-1 · isStaff() zincirinin izole uç durumları (N3/N5/N6)', () => {
    test('N3: personel kaydı doğru uid+pri ile var ama staffAccounts/{uid} HİÇ YAZILMAMIŞ → erişim yok', async () => {
        await put('personel', 'siz', { name: 'İzole Kişi', pri: 'izole.kisi', uid: 'uid-izole' });
        // staffAccounts/uid-izole kasıtlı olarak yazılmadı: staffAccount() get() boş map döner, personelId == '' → staffPersonOk reddeder.
        await assertFails(getDoc(item(staffCtx('uid-izole', 'izole.kisi')(), LIVE, 'b1', 'p1')));
    });
    test('N5: pri kolizyonu — staffAccounts.pri = "ayse.yilmaz", personel.pri = "ayse.yilmaz2" → erişim yok', async () => {
        await put('personel', 's1', { name: 'Ayşe Yılmaz', pri: 'ayse.yilmaz2', uid: 'uid-s1' });
        // staffAccounts/uid-s1.pri seed'den hâlâ 'ayse.yilmaz' (bu alan kuralda hiç okunmaz — bkz. RİSK MATRİSİ P2 notu);
        // asıl kanıt personel.pri'nin GERÇEK oturum e-postasındaki PRI ile (ayse.yilmaz) uyuşmamasıdır.
        await assertFails(getDoc(item(staffCtx('uid-s1', 'ayse.yilmaz')(), LIVE, 'b1', 'p1')));
    });
    test('N6: oturum e-postası <pri>@staff.medipol.local deseni dışında (gmail.com, boşluklu yerel kısım) → erişim yok', async () => {
        const gmail = () => env.authenticatedContext('uid-s1', { email: 'ayse.yilmaz@gmail.com', firebase: { sign_in_provider: 'password' } }).firestore();
        const spaced = () => env.authenticatedContext('uid-s1', { email: 'ayse yilmaz@staff.medipol.local', firebase: { sign_in_provider: 'password' } }).firestore();
        await assertFails(getDoc(item(gmail(), LIVE, 'b1', 'p1')));
        await assertFails(getDoc(item(spaced(), LIVE, 'b1', 'p1')));
    });
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
    // J11 · P1 #7: görünen talep sahibi (personel / personelId) oturumun GERÇEK personel kaydı (s1 = Ayşe Yılmaz)
    const mine = { ürün: 'Klavye', adet: 1, durum: 'Beklemede', personelUid: 'uid-s1', personel: 'Ayşe Yılmaz', personelId: 's1' };
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
// J11 · P1 #5/#7: adım adları, aktörler ve akış kayıtları personel kayıtlarındaki GERÇEK adlar (kurallar staffName ile eşler)
const NAME = { 'uid-s1': 'Ayşe Yılmaz', 'uid-s2': 'Bora Kaya', 'uid-s3': 'Cem Demir' };
const step = (uid, extra = {}) => ({ user: NAME[uid] || 'Ayşe Yılmaz', userUid: uid, tip: 'Paraf', status: 'pending', note: '', date: '', ...extra });
const hev = (action, over = {}) => action === 'transition'
    ? ({ id: 'trans_1', from: 'initiation', to: 'manager_approval', actor: 'Bora Kaya', uid: 'uid-s2', timestamp: 't', action, note: 'Paraf onaylandı', metadata: { userAgent: 'rules-test-agent' }, ...over })
    : action === 'withdraw'
        ? ({ action, actor: 'Ayşe Yılmaz', uid: 'uid-s1', timestamp: 't', from: 'initiation', to: 'initiation', note: 'Talep geri çekildi (Taslak moduna alındı)', ...over })
        : ({ action, actor: 'Ayşe Yılmaz', uid: 'uid-s1', timestamp: 't0', to: 'initiation', ...over });
const hist = [hev('create')];
const akis = [{ islem: 'Talep Oluşturuldu', yapan: 'Ayşe Yılmaz', uid: 'uid-s1', tarih: 't0' }];
// J11.5: sahibin (s1) istemcide ürettiği olaylar — tür, aktör ve uid'si ile (purchase-servises.js / confirmStartWorkflow)
const ev = (islem, over = {}) => ({ islem, yapan: 'Ayşe Yılmaz', uid: 'uid-s1', tarih: 't', ...over });
const templateHev = () => hev('create', {
    id: 'hist_1', from: null, note: 'Workflow başlatıldı',
    metadata: { templateId: 'template-1', templateName: 'Standart', hasParallelSteps: false },
});
const WD = 'Talep Geri Çekildi (Taslak Moduna Alındı)';
const OWNER = { createdByUid: 'uid-s1', createdBy: 's1', createdByName: 'Ayşe Yılmaz', talepEden: 'Ayşe Yılmaz' };
const running = (over = {}) => ({
    urun: 'Toner', adet: 1, durum: 'Onay Bekliyor', ...OWNER, akis,
    workflow: { id: 'wf1', started: true, finished: false, currentStep: 0, currentState: 'initiation', steps: [step('uid-s2'), step('uid-s3')], history: hist },
    ...over,
});
// approveStep'in durum makinesi (edm-workflow.js): onaydan sonraki genel durum; director → completed → fixWorkflowCurrentStep → initiation
const NEXT_STATE = { '': 'manager_approval', initiation: 'manager_approval', completed: 'manager_approval', manager_approval: 'hr_approval',
    hr_approval: 'finance_approval', finance_approval: 'director_approval', director_approval: 'initiation' };
// Onaylayıcının istemcide yaptığı geçerli onay (approveStep + transitionWorkflowState ile aynı alanlar; J11 · P1 #5: uid)
function approved(po, i, wfOver = {}, top = {}) {
    const s = po.workflow.steps[i];
    const steps = po.workflow.steps.map((x, k) => (k === i ? { ...x, status: 'approved', date: '16.10.2026 10:00', actor: x.user } : x));
    const last = i + 1 >= steps.length;
    // durum makinesinin ilerletemediği eski durum (ör. suspended): istemcinin denediği değer — kural o durumda zaten reddeder
    const to = last ? 'completed' : (NEXT_STATE[po.workflow.currentState || ''] || 'manager_approval');
    return { ...po, durum: last ? 'Onaylandı' : 'Onay Bekliyor',
        akis: [...po.akis, { islem: '✅ Onaylandı: ' + s.tip, yapan: s.user, uid: s.userUid || '', tarih: 't1', note: 'Süreç: x' }],
        workflow: { ...po.workflow, steps, currentStep: i + 1, finished: last, currentState: to,
            history: [...po.workflow.history, hev('transition', {
                from: po.workflow.currentState, to, actor: s.user, uid: s.userUid || '', timestamp: 't1',
                note: s.tip + ' onaylandı',
            })], ...wfOver }, ...top };
}
// Onaylayıcının istemcide yaptığı geçerli red (rejectStep: +1 history, sırasıyla üç akış kaydı, gerekçe hepsinde aynı)
function rejected(po, i, why = 'bütçe yok') {
    const s = po.workflow.steps[i];
    const who = { yapan: s.user, uid: s.userUid || '' };
    const steps = po.workflow.steps.map((x, k) => (k === i ? { ...x, status: 'rejected', note: why, date: 'd', actor: x.user } : x));
    return { ...po, durum: 'Reddedildi',
        akis: [...po.akis,
            { islem: '❌ REDDEDİLDİ: ' + s.tip, ...who, tarih: 't1', not: why },
            { islem: '🔄 State Geçişi: İptal Edildi', ...who, tarih: 't1', not: 'Reddedildi: ' + why },
            { islem: '❌ Reddedildi: ' + s.tip, ...who, tarih: 't1', not: why, stateNote: 'State: İptal Edildi' }],
        workflow: { ...po.workflow, steps, finished: true, currentState: 'cancelled',
            history: [...po.workflow.history, hev('transition', {
                from: po.workflow.currentState, to: 'cancelled', actor: s.user, uid: s.userUid || '', timestamp: 't1',
                note: 'Reddedildi: ' + why,
            })] } };
}

describe('Satın alma (purchaseOrders) — oluşturma ve sahibi', () => {
    const draft = { urun: 'Kağıt', aciklama: 'A4', durum: 'Onay Bekliyor', ...OWNER, akis, workflow: { started: false, currentStep: 0, steps: [], history: [] } };
    const line = { id: 'line-1', description: 'A4 kağıt', category: 'Mal', quantity: 2, unit: 'Kutu', unitPrice: 10.25, currency: 'TRY', taxRate: 20, totalPrice: 24.6 };
    const totals = { TRY: { subtotal: 20.5, tax: 4.1, total: 24.6 }, USD: { subtotal: 0, tax: 0, total: 0 }, EUR: { subtotal: 0, tax: 0, total: 0 } };
    test('personel kendi uid\'siyle, başlamamış akışla oluşturur', () => assertSucceeds(setDoc(item(ctx.s1(), LIVE, 'purchaseOrders', 'po2'), { id: 'po2', ...draft })));
    test('kalemli talep yazılır; bozuk para, metin, miktar ve kalem sınırı reddedilir', async () => {
        const target = item(ctx.s1(), LIVE, 'purchaseOrders', 'po-lines');
        const write = items => setDoc(target, { id: 'po-lines', ...draft, items, totals });
        await assertSucceeds(write([line]));
        await assertSucceeds(setDoc(item(ctx.s1(), LIVE, 'purchaseOrders', 'po-budget'), {
            id: 'po-budget', ...draft, items: [{ ...line, currency: 'USD' }], totals,
            documentTypeCode: 'PURCHASE_REQUEST', butce: 800, budgetMode: 'manual', budgetEstimateRates: { USD: 32.5 }
        }));
        await assertFails(setDoc(item(ctx.s1(), LIVE, 'purchaseOrders', 'po-wrong-type'), {
            id: 'po-wrong-type', ...draft, items: [line], totals, documentTypeCode: 'INCOMING_DOCUMENT'
        }));
        await assertSucceeds(setDoc(item(ctx.s1(), LIVE, 'purchaseOrders', 'po-many'), {
            id: 'po-many', ...draft, items: Array.from({ length: 3 }, (_, i) => ({ ...line, id: `line-${i}` })), totals
        }));
        await assertSucceeds(updateDoc(item(ctx.s1(), LIVE, 'purchaseOrders', 'po-many'), {
            items: Array.from({ length: 3 }, (_, i) => ({ ...line, id: `line-${i}`, description: `A4 kağıt ${i}` })), totals
        }));
        for (const invalid of [
            [{ ...line, currency: 'GBP' }], [{ ...line, description: '<img src=x>' }],
            [{ ...line, quantity: 0 }], [{ ...line, unitPrice: -1 }], [{ ...line, taxRate: 101 }],
            [Object.fromEntries(Object.entries(line).filter(([key]) => key !== 'unit'))],
            Array.from({ length: 4 }, (_, i) => ({ ...line, id: `line-${i}` }))
        ]) await assertFails(write(invalid));
        await assertSucceeds(setDoc(item(ctx.admin(), LIVE, 'purchaseOrders', 'po-admin-lines'), {
            id: 'po-admin-lines', ...draft, items: Array.from({ length: 3 }, (_, i) => ({ ...line, id: `admin-${i}` })), totals
        }));
    });
    test('başlamış akışın mali içeriği yönetici tarafından da sessizce değiştirilemez', async () => {
        await put('purchaseOrders', 'po-lines', { ...running(), items: [line], totals });
        await assertFails(updateDoc(item(ctx.admin(), LIVE, 'purchaseOrders', 'po-lines'), { items: [{ ...line, unitPrice: 1 }] }));
    });
    test('döviz kuru ilk onayla sabitlenir; sonraki değişiklik reddedilir', async () => {
        const fxLine = { ...line, currency: 'USD' };
        const fxTotals = { ...totals, TRY: { subtotal: 0, tax: 0, total: 0 }, USD: totals.TRY };
        const base = { ...running(), items: [fxLine], totals: fxTotals };
        const target = item(ctx.s2(), LIVE, 'purchaseOrders', 'po-fx');
        await put('purchaseOrders', 'po-fx', base);
        await assertFails(setDoc(target, { id: 'po-fx', ...approved(base, 0) }));
        await assertFails(setDoc(target, { id: 'po-fx', ...approved(base, 0, {}, {
            exchangeRate: { TRY: 1, EUR: 1 }, exchangeRateDate: '2026-11-01',
            exchangeRateSource: 'Kaynak', reportingTotalTRY: 0
        }) }));
        await assertFails(setDoc(target, { id: 'po-fx', ...approved(base, 0, {}, {
            exchangeRate: { TRY: 1, USD: 32.5, EUR: 38 }, exchangeRateDate: '2026-11-01', reportingTotalTRY: 799.5
        }) }));
        await assertFails(setDoc(target, { id: 'po-fx', ...approved(base, 0, {}, {
            exchangeRate: { TRY: 1, USD: 32.5, EUR: 38 }, exchangeRateDate: '2026-11-01',
            exchangeRateSource: '   ', reportingTotalTRY: 799.5
        }) }));
        const first = approved(base, 0, {}, {
            exchangeRate: { TRY: 1, USD: 32.5, EUR: 38 }, exchangeRateDate: '2026-11-01',
            exchangeRateSource: 'TCMB', reportingTotalTRY: 799.5
        });
        await assertFails(financeApprove(ctx.s2(),'po-fx',first));
        await put('system_config','ebys_rates',{rates:{TRY:1,USD:32.5,EUR:38},date:'2026-11-01',source:'TCMB'});
        await assertFails(financeApprove(ctx.s2(),'po-fx',{...first,exchangeRate:{TRY:1,USD:40,EUR:38}}));
        await assertFails(financeApprove(ctx.s2(),'po-fx',{...first,exchangeRateSource:'Başka kaynak'}));
        await assertSucceeds(financeApprove(ctx.s2(),'po-fx',first));
        await assertFails(updateDoc(target, { 'exchangeRate.USD': 40 }));
        await put('purchaseOrders', 'po-fx-admin', base);
        await assertFails(setDoc(item(ctx.admin(), LIVE, 'purchaseOrders', 'po-fx-admin'), { id: 'po-fx-admin', ...approved(base, 0) }));
        await assertSucceeds(financeApprove(ctx.admin(),'po-fx-admin',first));
        await put('purchaseOrders', 'po-fx-admin-direct', { ...base, workflow: { started: false, currentStep: 0, steps: [] } });
        await assertFails(setDoc(item(ctx.admin(), LIVE, 'purchaseOrders', 'po-fx-admin-direct'), { id: 'po-fx-admin-direct', ...approved(base, 0) }));
    });
    test('üç kalemli TRY talebinin ilk onayı da mali anlık görüntüyle geçer', async () => {
        const base = { ...running(), items: Array.from({ length: 3 }, (_, i) => ({ ...line, id: `l-${i}` })), totals };
        await put('purchaseOrders', 'po-try', base);
        await assertSucceeds(financeApprove(ctx.s2(),'po-try',approved(base, 0, {}, {
            exchangeRate: { TRY: 1, USD: 1, EUR: 1 }, exchangeRateDate: '2026-11-01', exchangeRateSource: 'TRY', reportingTotalTRY: 24.6
        })));
    });
    test('ilk onaydan sonra geri çekilen belgenin mali içeriği ve aynı belgeyle yeniden başlatılması kilitli kalır', async () => {
        const frozen = { ...running(), durum: 'Taslak', items: [line], totals,
            exchangeRate: { TRY: 1 }, exchangeRateDate: '2026-11-01', exchangeRateSource: 'TRY', reportingTotalTRY: 24.6,
            workflow: { ...running().workflow, started: false, finished: false, currentStep: 0, currentState: 'initiation', steps: [] } };
        await put('purchaseOrders', 'po-frozen', frozen);
        await assertFails(updateDoc(item(ctx.s1(), LIVE, 'purchaseOrders', 'po-frozen'), {
            items: [{ ...line, unitPrice: 11 }], akis: [...akis, ev('Talep güncellendi')]
        }));
        await assertFails(updateDoc(item(ctx.admin(), LIVE, 'purchaseOrders', 'po-frozen'), { items: [{ ...line, unitPrice: 11 }] }));
        await assertFails(updateDoc(item(ctx.admin(), LIVE, 'purchaseOrders', 'po-frozen'), { evrakNo: 'YENİ' }));
        await assertFails(updateDoc(item(ctx.admin(), LIVE, 'purchaseOrders', 'po-frozen'), { budgetEstimateRates: { USD: 40 } }));
        await assertFails(updateDoc(item(ctx.admin(), LIVE, 'purchaseOrders', 'po-frozen'), { 'workflow.started': true }));
    });
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
        await assertSucceeds(updateDoc(item(ctx.s1(), LIVE, 'purchaseOrders', 'po2'), { urun: 'Kağıt A3', akis: [...akis, ev('Talep güncellendi')] }));
        // J11.7: başlatma confirmStartWorkflow gibi akış kaydını da taşır (kayıtsız başlatma artık reddedilir)
        await assertSucceeds(updateDoc(item(ctx.s1(), LIVE, 'purchaseOrders', 'po2'), {
            durum: 'Onay Bekliyor', akis: [...akis, ev('Talep güncellendi'), ev('İş akışı başlatıldı')],
            workflow: { started: true, finished: false, currentStep: 0, currentState: 'initiation', steps: [step('uid-s2'), step('uid-s3')], history: [hev('create')] } }));
        await put('purchaseOrders', 'po2-template', draft);
        await assertSucceeds(updateDoc(item(ctx.s1(), LIVE, 'purchaseOrders', 'po2-template'), {
            durum: 'Onay Bekliyor', akis: [...akis, ev('İş akışı başlatıldı')],
            workflow: { templateId: 'template-1', started: true, finished: false, currentStep: 0, currentState: 'initiation', steps: [step('uid-s2')], history: [templateHev()] } }));
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
        await assertSucceeds(updateDoc(item(ctx.s1(), LIVE, 'purchaseOrders', 'po2'), { durum: 'Onay Bekliyor', akis: [...akis, ev('İş akışı başlatıldı')],
            workflow: { started: true, finished: false, currentStep: 0, currentState: 'initiation', steps: ten, history: [hev('create')] } }));
        let po = running({ workflow: { ...running().workflow, steps: ten, history: Array.from({ length: 12 }, (_, i) => ({ action: 'transition', i })) },
            akis: Array.from({ length: 15 }, (_, i) => ({ islem: 'kayıt ' + i })) });
        for (let i = 0; i < 9; i++) po = approved(po, i);
        await put('purchaseOrders', 'po9', po);
        await assertFails(setDoc(item(ctx.s2(), LIVE, 'purchaseOrders', 'po9'), { id: 'po9', ...approved(po, 9) }));   // 10. adım s3'ün
        await assertSucceeds(setDoc(item(ctx.s3(), LIVE, 'purchaseOrders', 'po9'), { id: 'po9', ...approved(po, 9) }));
    });
    test('en ağır red: 10 adımlı akışın 10. adımının reddi (üç akış kaydı denetimiyle, 1000 ifade sınırı içinde)', async () => {
        const ten = Array.from({ length: 10 }, (_, i) => step(i % 2 ? 'uid-s3' : 'uid-s2'));
        let po = running({ workflow: { ...running().workflow, steps: ten, history: Array.from({ length: 12 }, (_, i) => ({ action: 'transition', i })) },
            akis: Array.from({ length: 15 }, (_, i) => ({ islem: 'kayıt ' + i })) });
        for (let i = 0; i < 9; i++) po = approved(po, i);
        await put('purchaseOrders', 'pr9', po);
        await assertFails(setDoc(item(ctx.s2(), LIVE, 'purchaseOrders', 'pr9'), { id: 'pr9', ...rejected(po, 9) }));   // 10. adım s3'ün
        await assertSucceeds(setDoc(item(ctx.s3(), LIVE, 'purchaseOrders', 'pr9'), { id: 'pr9', ...rejected(po, 9) }));
    });
    test('sahibi akış sürerken içeriği değiştiremez, kendisi onaylayamaz', async () => {
        await put('purchaseOrders', 'po3', running());
        await assertFails(updateDoc(item(ctx.s1(), LIVE, 'purchaseOrders', 'po3'), { urun: 'Altın' }));
        await assertFails(setDoc(item(ctx.s1(), LIVE, 'purchaseOrders', 'po3'), { id: 'po3', ...approved(running(), 0) }));
    });
    test('sahibi akış sürerken geri çeker (taslağa döner, geçmiş korunur)', async () => {
        await put('purchaseOrders', 'po3', running());
        await assertSucceeds(updateDoc(item(ctx.s1(), LIVE, 'purchaseOrders', 'po3'), {
            durum: 'Taslak', akis: [...akis, ev(WD)],
            workflow: { id: 'wf1', started: false, finished: false, currentStep: 0, currentState: 'initiation', status: 'draft', steps: [], history: [...hist, hev('withdraw')] } }));
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
    // J11 · P1: red tam olarak +3 akis kaydı üretir (edm-workflow.js rejectStep: red + state geçişi + modal gösterim).
    test('sırası gelen onaylayıcı reddeder (gerekçeli)', () => assertSucceeds(write(ctx.s2(), rejected(running(), 0))));
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

    // ─── J11 · P1: eklenen history/akis kaydı sayısı edm-workflow.js'in gerçek davranışıyla BİREBİR sınırlı ────────────────
    // Eskiden appendOnly tek başına herhangi bir SAYIDA yeni kayıt kabul ediyordu (sahte EK history/akis kaydı enjekte
    // edilebiliyordu). Şimdi: onay tam +1 history +1 akis, red tam +1 history +3 akis — ne fazla ne eksik.
    test('KÖTÜ NİYET: onaylarken SAHTE EK history kaydı enjekte edilemez (meşru akış tam +1 kayıt üretir)', async () => {
        const a = approved(running(), 0);
        await assertFails(write(ctx.s2(), { ...a, workflow: { ...a.workflow, history: [...a.workflow.history, { action: 'transition', actor: 'SAHTE İkinci', timestamp: 't2' }] } }));
        await assertFails(write(ctx.s2(), { ...running(), ...a, workflow: { ...a.workflow, history: running().workflow.history } }));   // eksik (0 yeni kayıt) de reddedilir
    });
    test('KÖTÜ NİYET: onaylarken SAHTE EK akis kaydı enjekte edilemez (meşru akış tam +1 kayıt üretir)', async () => {
        const a = approved(running(), 0);
        await assertFails(write(ctx.s2(), { ...a, akis: [...a.akis, { islem: 'SAHTE ikinci kayıt', yapan: 'Kimse' }] }));
        await assertFails(write(ctx.s2(), { ...a, akis: running().akis }));   // eksik (0 yeni kayıt) de reddedilir
    });
    test('KÖTÜ NİYET: reddederken akış kaydı sayısı meşru rejectStep\'in ürettiğinden (tam +3) az ya da çok olamaz', async () => {
        const base = rejected(running(), 0, 'red');
        const [r1, r2, r3] = base.akis.slice(akis.length);
        await assertFails(write(ctx.s2(), { ...base, akis: [...akis, r1] }));                                         // yalnız +1 (gerçek rejectStep +3 üretir)
        await assertFails(write(ctx.s2(), { ...base, akis: [...akis, r1, r2, r3, { ...r3, islem: '❌ Reddedildi: SAHTE 4.' }] })); // +4 (fazladan sahte kayıt)
        await assertSucceeds(write(ctx.s2(), base));                                                                  // tam +3: kabul
    });
    // "Bayat onay" tekrar oynatımı: cs her zaman SUNUCUDAKİ güncel currentStep'ten okunur; bir onaylayıcının daha önce
    // hazırladığı (ama göndermediği) bir payload, akış ilerledikten SONRA gönderilirse reddedilir.
    test('Bayat onay tekrar oynatımı (replay) reddedilir: akış ilerledikten sonra eski adıma hazırlanmış istek geçersiz', async () => {
        const stalePayload = approved(running(), 0);   // s2, adım 0'ı onaylamak için HAZIRLANMIŞ (henüz gönderilmemiş) istek
        // Bu arada gerçek s2 adım 0'ı GERÇEKTEN onayladı (akış ilerledi, sıradaki adım artık s3'ün)
        await assertSucceeds(write(ctx.s2(), stalePayload));
        // Aynı (artık BAYAT) payload tekrar gönderilirse: cs artık 1 (s3'ün), s2 o adımın onaylayıcısı değil → reddedilir.
        await assertFails(write(ctx.s2(), stalePayload));
        // Payload'ın KENDİSİ de artık geçerli bir "adım 1 onayı" değil (adım 0'ı tekrar "approved" yazmaya çalışıyor, adım
        // 1'e dokunmuyor) — cs=1 iken adım 1'in onaylayıcısı olan s3 de bu BAYAT payload'ı göndererek adım 0'ı etkileyemez.
        await assertFails(write(ctx.s3(), stalePayload));
    });
});

// ─── J11 · P1 #5 kapanışı (bağımsız denetim): kayıt SAYISI meşru, İÇERİK / aktör / uid / tarih / tür sahte ──────────────────
// Her negatif durumda yalnız TEK bir alan meşru payload'dan (approved / rejected) sapar; geri kalan her şey (kayıt sayısı dahil)
// gerçek istemcinin ürettiğiyle aynıdır. Sonda aynı payload'ın sapmasız hali kabul edilir (testin yanlış nedenle geçmediğinin
// kanıtı).
describe('J11 · P1 #5 kapanışı — aynı sayıda farklı içerikli history / akış olayı', () => {
    const write = (db, data) => setDoc(item(db, LIVE, 'purchaseOrders', 'pa'), { id: 'pa', ...data });
    beforeEach(() => put('purchaseOrders', 'pa', running()));
    const lastH = po => po.workflow.history.at(-1);
    const withH = (po, patch) => ({ ...po, workflow: { ...po.workflow, history: [...po.workflow.history.slice(0, -1), { ...lastH(po), ...patch }] } });
    const withA = (po, idx, patch) => ({ ...po, akis: po.akis.map((x, k) => (k === idx ? { ...x, ...patch } : x)) });
    const N = akis.length;   // eski akış kaydı sayısı (yeni kayıtlar N, N+1, N+2)

    test('ESKİ adım durumu pending olmalı: currentStep geride kalmış (onaylı / reddedilmiş adımda duran) kayıtta karar yazılamaz; admin düzeltir', async () => {
        for (const prev of ['approved', 'rejected']) {
            const bad = running({ workflow: { ...running().workflow, steps: [step('uid-s2', { status: prev, actor: 'Bora Kaya' }), step('uid-s3')] } });
            await put('purchaseOrders', 'pa', bad);
            await assertFails(write(ctx.s2(), approved(bad, 0)));       // onaylı → tekrar onay / reddedilmiş → onay
            await assertFails(write(ctx.s2(), rejected(bad, 0)));       // onaylı → red
            await assertSucceeds(write(ctx.admin(), approved(bad, 0))); // yönetici yolu açık
        }
        await put('purchaseOrders', 'pa', running());
        await assertSucceeds(write(ctx.s2(), approved(running(), 0)));   // pending adım: kabul
    });

    test('ONAY · history: aynı sayıda ama farklı tür / uid / aktör ile yeni kayıt reddedilir', async () => {
        const ok = approved(running(), 0);
        await assertFails(write(ctx.s2(), withH(ok, { action: 'approved' })));       // tür: 'transition' değil
        await assertFails(write(ctx.s2(), withH(ok, { action: 'rollback' })));
        await assertFails(write(ctx.s2(), withH(ok, { uid: 'uid-s3' })));            // başkasının uid'si
        await assertFails(write(ctx.s2(), withH(ok, { uid: '' })));                  // uid'siz
        await assertFails(write(ctx.s2(), withH(ok, { actor: 'Cem Demir' })));       // başkasının adı
        await assertFails(write(ctx.s2(), withH(ok, { to: 'cancelled' })));          // onayda 'iptal'e geçiş
        await assertSucceeds(write(ctx.s2(), ok));
    });

    test('ONAY · history: ESKİ kayıtların içeriği / aktörü / tarihi değiştirilip kayıt sayısı korunsa da reddedilir', async () => {
        const ok = approved(running(), 0);
        const prev = ok.workflow.history.slice(0, -1);
        const h = patch => ({ ...ok, workflow: { ...ok.workflow, history: [{ ...prev[0], ...patch }, lastH(ok)] } });
        await assertFails(write(ctx.s2(), h({ timestamp: '01.01.2020' })));                  // geçmiş tarih
        await assertFails(write(ctx.s2(), h({ actor: 'Bora Kaya' })));                       // geçmiş aktör
        await assertFails(write(ctx.s2(), h({ action: 'transition', to: 'completed' })));    // geçmiş içerik
        // eski kaydı silip yerine sahte kayıt + meşru yeni kayıt (toplam sayı aynı)
        await assertFails(write(ctx.s2(), { ...ok, workflow: { ...ok.workflow, history: [lastH(ok), lastH(ok)] } }));
        await assertSucceeds(write(ctx.s2(), ok));
    });

    test('ONAY · akış: aynı sayıda ama farklı tür / uid / aktör ile yeni kayıt; eski kaydın tarihi / içeriği değiştirilemez', async () => {
        const ok = approved(running(), 0);
        await assertFails(write(ctx.s2(), withA(ok, N, { islem: '❌ REDDEDİLDİ: Paraf' })));   // onayda red olayı
        await assertFails(write(ctx.s2(), withA(ok, N, { islem: 'Talep Oluşturuldu' })));
        await assertFails(write(ctx.s2(), withA(ok, N, { uid: 'uid-s3' })));
        await assertFails(write(ctx.s2(), withA(ok, N, { uid: '' })));
        await assertFails(write(ctx.s2(), withA(ok, N, { yapan: 'Cem Demir' })));
        await assertFails(write(ctx.s2(), withA(ok, 0, { tarih: '01.01.2020' })));              // eski kaydın tarihi
        await assertFails(write(ctx.s2(), withA(ok, 0, { yapan: 'Bora Kaya' })));               // eski kaydın aktörü
        await assertFails(write(ctx.s2(), withA(ok, 0, { islem: '✅ Onaylandı: Paraf' })));     // eski kaydın içeriği
        await assertSucceeds(write(ctx.s2(), ok));
    });

    test('ONAY: adımın notu (red gerekçesi alanı) onayda değiştirilemez', async () => {
        const ok = approved(running(), 0);
        const steps = ok.workflow.steps.map((x, k) => (k === 0 ? { ...x, note: 'SAHTE gerekçe' } : x));
        await assertFails(write(ctx.s2(), { ...ok, workflow: { ...ok.workflow, steps } }));
    });

    // G6A-1 (C3) · M4 [ŞEMA]: bu testler, ilgili Rules allowlist'leri eklenene kadar gerçek istemci olaylarına
    // sahte anahtar eklenmesinin kabul edildiğini kanıtlar. approved/rejected/hev fikstürleri transitionWorkflowState
    // tarafından üretilen id/from/to/actor/uid/timestamp/action/note/metadata.userAgent alanlarını taşır.
    test('G6A-1 (C3) · M4a [ŞEMA]: onayın yeni akis kaydındaki sahte ek alan reddedilir', async () => {
        const ok = approved(running(), 0);
        await assertFails(write(ctx.s2(), withA(ok, N, { meta: { evil: true } })));
    });
    test('G6A-1 (C3) · M4b [ŞEMA]: onayın yeni history kaydındaki sahte ek alan reddedilir', async () => {
        const ok = approved(running(), 0);
        await assertFails(write(ctx.s2(), withH(ok, { extra: 'sahte alan' })));
    });
    test('G6A-1 (C3) · M4c [ŞEMA]: reddeki akis/history kayıtlarına sahte ek alan reddedilir', async () => {
        const red = rejected(running(), 0, 'bütçe yok');
        for (const index of [N, N + 1, N + 2]) {
            await assertFails(write(ctx.s2(), withA(red, index, { meta: 'sahte' })));
        }
        await assertFails(write(ctx.s2(), withH(red, { extra: 'sahte alan' })));
        await assertSucceeds(write(ctx.s2(), red));
    });

    test('RED · akış: üç kaydın sırası / türü / gerekçesi / uid\'si rejectStep\'le birebir olmalı', async () => {
        const ok = rejected(running(), 0, 'bütçe yok');
        const [r1, r2, r3] = ok.akis.slice(N);
        await assertFails(write(ctx.s2(), { ...ok, akis: [...akis, r3, r2, r1] }));                 // sıra değişik
        await assertFails(write(ctx.s2(), { ...ok, akis: [...akis, r1, r1, r3] }));                 // tür: state geçişi yok
        await assertFails(write(ctx.s2(), withA(ok, N, { islem: '✅ Onaylandı: Paraf' })));       // redde onay olayı
        await assertFails(write(ctx.s2(), withA(ok, N, { not: 'başka gerekçe' })));              // gerekçe adımdakiyle aynı değil
        await assertFails(write(ctx.s2(), withA(ok, N + 1, { not: 'Reddedildi: başka' })));
        await assertFails(write(ctx.s2(), withA(ok, N + 2, { not: 'başka gerekçe' })));
        for (const i of [N, N + 1, N + 2]) {
            await assertFails(write(ctx.s2(), withA(ok, i, { uid: 'uid-s3' })));                 // herhangi birinde başka uid
            await assertFails(write(ctx.s2(), withA(ok, i, { uid: '' })));
        }
        await assertFails(write(ctx.s2(), withA(ok, 0, { tarih: '01.01.2020' })));                // eski kaydın tarihi
        await assertSucceeds(write(ctx.s2(), ok));
    });

    test('RED · history ve durum: iptale geçiş, gerekçeli not, uid; gerekçe boş olamaz', async () => {
        const ok = rejected(running(), 0, 'bütçe yok');
        await assertFails(write(ctx.s2(), withH(ok, { to: 'completed' })));
        await assertFails(write(ctx.s2(), withH(ok, { note: 'Reddedildi: başka' })));
        await assertFails(write(ctx.s2(), withH(ok, { uid: 'uid-s3' })));
        await assertFails(write(ctx.s2(), withH(ok, { action: 'rollback' })));
        await assertFails(write(ctx.s2(), { ...ok, workflow: { ...ok.workflow, currentState: 'completed' } }));
        await assertFails(write(ctx.s2(), rejected(running(), 0, '   ')));                        // boş gerekçe
        await assertSucceeds(write(ctx.s2(), ok));
    });

    test('AYNI İSİMLİ başka personel meşru içerikli kaydı kendi uid\'siyle de yazamaz (uid adımda ve kayıtta)', async () => {
        await seed(async db => {
            await setDoc(item(db, LIVE, 'personel', 'tw'), { id: 'tw', name: 'Bora Kaya', pri: 'bora.kaya2', uid: 'uid-tw' });
            await setDoc(item(db, LIVE, 'staffAccounts', 'uid-tw'), { personelId: 'tw', pri: 'bora.kaya2' });
        });
        const ok = approved(running(), 0);
        const tw = staffCtx('uid-tw', 'bora.kaya2')();
        await assertFails(write(tw, withA(withH(ok, { uid: 'uid-tw' }), N, { uid: 'uid-tw' })));
        await assertFails(write(tw, ok));
    });

    // BİLİNÇLİ SINIRLAMA (açık risk olarak raporlandı): YENİ kaydın tarih alanı istemci saatidir; kurallar onu sunucu saatine
    // bağlayamaz. Bu test sınırlamayı belgeler — "kapatıldı" iddiası YOKTUR. Geçmiş kayıtların tarihi yukarıda korunuyor.
    test('SINIRLAMA (açık risk): yeni kaydın tarihi / timestamp\'i istemci saatidir — geçmiş tarihli yeni kayıt kabul edilir', async () => {
        const ok = approved(running(), 0);
        await assertSucceeds(write(ctx.s2(), withA(withH(ok, { timestamp: '2020-01-01T00:00:00.000Z' }), N, { tarih: '01.01.2020 00:00' })));
    });
});

// ─── J11.5 · bağımsız denetim (GPT-6): zero-trust sözleşme düzeltmeleri ─────────────────────────────────────────────────────
// Her negatif durum meşru payload'dan TEK alanda sapar; her grubun sonunda meşru payload kabul edilir.
describe('J11.5 · madde 2 — onaylayıcı akışın genel durumunu (currentState) sahte değere çekemez', () => {
    const write = (db, data) => setDoc(item(db, LIVE, 'purchaseOrders', 'ps'), { id: 'ps', ...data });
    const withState = (po, st) => ({ ...po, workflow: { ...po.workflow, currentState: st } });
    test('ara adım onayında currentState yalnız durum makinesinin ardılı (initiation → manager_approval); cancelled / suspended / completed / başka durum reddedilir', async () => {
        await put('purchaseOrders', 'ps', running());
        const ok = approved(running(), 0);
        assert(ok.workflow.currentState === 'manager_approval');
        for (const st of ['cancelled', 'suspended', 'completed', 'initiation', 'hr_approval', 'pending', '']) {
            await assertFails(write(ctx.s2(), withState(ok, st)));
        }
        const { currentState, ...noState } = ok.workflow;
        await assertFails(write(ctx.s2(), { ...ok, workflow: noState }));   // alanı silmek de sahte durumdur
        await assertSucceeds(write(ctx.s2(), ok));
    });
    test('son adım onayında currentState yalnız completed', async () => {
        const after0 = approved(running(), 0);
        await put('purchaseOrders', 'ps', after0);
        const ok = approved(after0, 1);
        assert(ok.workflow.currentState === 'completed');
        for (const st of ['cancelled', 'suspended', 'hr_approval', 'initiation']) await assertFails(write(ctx.s3(), withState(ok, st)));
        await assertSucceeds(write(ctx.s3(), ok));
    });
    test('6+ adımlı akışta director_approval sonrası meşru dönüş (completed → initiation) kabul; ara adımda completed reddedilir', async () => {
        const six = Array.from({ length: 6 }, (_, i) => step(i % 2 ? 'uid-s3' : 'uid-s2'));
        let po = running({ workflow: { ...running().workflow, steps: six } });
        for (let i = 0; i < 4; i++) po = approved(po, i);
        assert(po.workflow.currentState === 'director_approval');
        await put('purchaseOrders', 'ps', po);
        const ok = approved(po, 4);   // s2'nin adımı
        assert(ok.workflow.currentState === 'initiation');
        await assertFails(write(ctx.s2(), withState(ok, 'completed')));
        await assertFails(write(ctx.s2(), withState(ok, 'cancelled')));
        await assertSucceeds(write(ctx.s2(), ok));
    });
});

describe('J11.5 · madde 3 — talep sahibi kendi talebine sahte tür / sahte uid ile olay ekleyemez', () => {
    const draft = { urun: 'Kağıt', aciklama: 'A4', durum: 'Taslak', ...OWNER, akis, workflow: { started: false, currentStep: 0, steps: [], history: [] } };
    const upd = (id, data) => updateDoc(item(ctx.s1(), LIVE, 'purchaseOrders', id), data);
    const startWf = (akisEv, histEv) => ({ durum: 'Onay Bekliyor', akis: [...akis, akisEv],
        workflow: { started: true, finished: false, currentStep: 0, currentState: 'initiation', steps: [step('uid-s2')], history: histEv ? [histEv] : [] } });

    test('OLUŞTURMA: ilk akış kaydı yalnız "Talep Oluşturuldu", sahibin uid\'siyle', async () => {
        const mk = a => setDoc(item(ctx.s1(), LIVE, 'purchaseOrders', 'pc'), { id: 'pc', ...draft, akis: a });
        await assertFails(mk([{ ...akis[0], islem: '✅ Onaylandı: Paraf' }]));
        await assertFails(mk([{ ...akis[0], uid: 'uid-s2' }]));
        const { uid, ...noUid } = akis[0];
        await assertFails(mk([noUid]));
        await assertSucceeds(mk(akis));
    });
    test('TASLAK DÜZENLEME: sahte "Onaylandı" olayı, başkasının / eksik uid\'si, history kaydı reddedilir; düzenleme ve ek silme kabul', async () => {
        await put('purchaseOrders', 'pd', draft);
        await assertFails(upd('pd', { akis: [...akis, ev('✅ Onaylandı: Paraf')] }));
        await assertFails(upd('pd', { akis: [...akis, ev('❌ REDDEDİLDİ: Paraf')] }));
        await assertFails(upd('pd', { akis: [...akis, ev('İş akışı başlatıldı')] }));            // başlatma olmadan "başlatıldı"
        await assertFails(upd('pd', { akis: [...akis, ev('Talep güncellendi', { uid: 'uid-s2' })] }));
        await assertFails(upd('pd', { akis: [...akis, ev('Talep güncellendi', { uid: '' })] }));
        await assertFails(upd('pd', { 'workflow.history': [hev('transition', { to: 'completed' })] }));   // düzenleme history'ye yazmaz
        await assertFails(upd('pd', { 'workflow.history': [hev('create')] }));
        await assertSucceeds(upd('pd', { urun: 'Kağıt A3', akis: [...akis, ev('Talep güncellendi')] }));
        await assertSucceeds(upd('pd', { akis: [...akis, ev('Talep güncellendi'), ev('Ek dosya silindi')] }));
    });
    test('BAŞLATMA: history yalnız "create" (sahibin uid\'si), akış yalnız "İş akışı başlatıldı"', async () => {
        await put('purchaseOrders', 'pe', draft);
        await assertFails(upd('pe', startWf(ev('İş akışı başlatıldı'), hev('transition'))));
        await assertFails(upd('pe', startWf(ev('İş akışı başlatıldı'), hev('approved'))));
        await assertFails(upd('pe', startWf(ev('İş akışı başlatıldı'), hev('create', { uid: 'uid-s2' }))));
        await assertFails(upd('pe', startWf(ev('✅ Onaylandı: Paraf'), hev('create'))));
        await assertFails(upd('pe', startWf(ev('Talep güncellendi'), hev('create'))));
        await assertFails(upd('pe', startWf(ev('İş akışı başlatıldı', { uid: 'uid-s3' }), hev('create'))));
        await assertFails(upd('pe', startWf(ev('İş akışı başlatıldı', { meta: 'sahte' }), hev('create'))));
        await assertFails(upd('pe', startWf(ev('İş akışı başlatıldı'), hev('create', { extra: 'sahte' }))));
        await assertSucceeds(upd('pe', startWf(ev('İş akışı başlatıldı'), hev('create'))));
    });
    test('İPTAL: akış yalnız "Talep İptal Edildi"; history eklenemez', async () => {
        await put('purchaseOrders', 'pf', draft);
        const cancel = (a, h = []) => upd('pf', { durum: 'İptal Edildi', akis: [...akis, a], workflow: { started: false, finished: true, currentStep: 0, currentState: 'cancelled', steps: [], history: h } });
        await assertFails(cancel(ev('Talep güncellendi')));
        await assertFails(cancel(ev('✅ Onaylandı: Paraf')));
        await assertFails(cancel(ev('Talep İptal Edildi', { uid: 'uid-s2' })));
        await assertFails(cancel(ev('Talep İptal Edildi'), [hev('create')]));
        await assertSucceeds(cancel(ev('Talep İptal Edildi')));
    });
    test('GERİ ÇEKME: history yalnız "withdraw", akış yalnız geri çekme kaydı; ikisi de sahibin uid\'siyle', async () => {
        await put('purchaseOrders', 'pg', running());
        const wd = (a, h) => upd('pg', { durum: 'Taslak', akis: [...akis, a],
            workflow: { id: 'wf1', started: false, finished: false, currentStep: 0, currentState: 'initiation', steps: [], history: [...hist, h] } });
        await assertFails(wd(ev(WD), hev('approved')));
        await assertFails(wd(ev(WD), hev('transition', { to: 'completed' })));
        await assertFails(wd(ev(WD), hev('withdraw', { uid: 'uid-s2' })));
        await assertFails(wd(ev('✅ Onaylandı: Paraf'), hev('withdraw')));
        await assertFails(wd(ev(WD, { uid: 'uid-s3' }), hev('withdraw')));
        await assertSucceeds(wd(ev(WD), hev('withdraw')));
    });
});

// ─── J11.6 · P1 (bağımsız denetim): talep sahibi workflow.currentState'i sahte değere çekemez ───────────────────────────────
// İstemcinin gerçek yazdıkları (WorkflowEngine durum makinesi esas): oluşturma currentState YAZMAZ (savePurchaseRequest; motor
// başlangıcı initiation sayar), başlatma INITIATION (confirmStartWorkflow / createWorkflowFromTemplate), düzenleme / ek silme
// DOKUNMAZ, iptal CANCELLED (motor: cancelled'a geçebilen bir durumdan), geri çekme INITIATION (taslak). Admin listesi başlamış
// ve currentState 'completed' akışı "Tamamlandı" gösterir (admin-purchase-render.js) — onaysız talep tamamlanmış görünemez.
describe('J11.6 · talep sahibi workflow.currentState\'i sahte değere çekemez (oluşturma / başlatma / düzenleme / iptal / geri çekme)', () => {
    const draft = { urun: 'Kağıt', aciklama: 'A4', durum: 'Taslak', ...OWNER, akis, workflow: { started: false, currentStep: 0, steps: [] } };
    const upd = (id, data) => updateDoc(item(ctx.s1(), LIVE, 'purchaseOrders', id), data);
    const FAKE = ['completed', 'cancelled', 'suspended', 'manager_approval', 'pending', 'onaylandi'];

    test('OLUŞTURMA: currentState yazılmaz ya da başlangıç (initiation); sahte durum reddedilir', async () => {
        const mk = (id, wf) => setDoc(item(ctx.s1(), LIVE, 'purchaseOrders', id), { id, ...draft, workflow: { ...draft.workflow, ...wf } });
        for (const st of FAKE) await assertFails(mk('pc_' + st, { currentState: st }));
        await assertSucceeds(mk('pc1', {}));                              // savePurchaseRequest: alan yok
        await assertSucceeds(mk('pc2', { currentState: 'initiation' }));
    });
    test('BAŞLATMA: yalnız initiation — sahte "completed" (admin listesinde Tamamlandı) ve ilgisiz durumlar reddedilir', async () => {
        await put('purchaseOrders', 'pb', draft);
        const start = st => upd('pb', { durum: 'Onay Bekliyor', akis: [...akis, ev('İş akışı başlatıldı')],
            workflow: { started: true, finished: false, currentStep: 0, currentState: st, steps: [step('uid-s2')], history: [hev('create')] } });
        for (const st of FAKE) await assertFails(start(st));
        await assertSucceeds(start('initiation'));
    });
    test('DÜZENLEME / EK SİLME: currentState değiştirilemez (yoksa eklenemez)', async () => {
        await put('purchaseOrders', 'pd', draft);
        for (const st of ['completed', 'initiation']) await assertFails(upd('pd', { 'workflow.currentState': st, akis: [...akis, ev('Talep güncellendi')] }));
        await put('purchaseOrders', 'pd2', { ...draft, workflow: { ...draft.workflow, currentState: 'initiation' } });
        await assertFails(upd('pd2', { 'workflow.currentState': 'completed', akis: [...akis, ev('Talep güncellendi')] }));
        await assertSucceeds(upd('pd2', { urun: 'Kağıt A3', akis: [...akis, ev('Talep güncellendi')] }));
        await assertSucceeds(upd('pd', { urun: 'Kağıt A3', akis: [...akis, ev('Talep güncellendi')] }));
    });
    test('İPTAL: yalnız cancelled', async () => {
        await put('purchaseOrders', 'pf', draft);
        const cancel = st => upd('pf', { durum: 'İptal Edildi', akis: [...akis, ev('Talep İptal Edildi')],
            workflow: { started: false, finished: true, currentStep: 0, currentState: st, steps: [], history: [] } });
        for (const st of ['completed', 'suspended', 'initiation', 'manager_approval']) await assertFails(cancel(st));
        await assertSucceeds(cancel('cancelled'));
    });
    test('GERİ ÇEKME: yalnız taslak durumu (initiation)', async () => {
        await put('purchaseOrders', 'pg', running());
        const wd = st => upd('pg', { durum: 'Taslak', akis: [...akis, ev(WD)],
            workflow: { id: 'wf1', started: false, finished: false, currentStep: 0, currentState: st, steps: [], history: [...hist, hev('withdraw')] } });
        for (const st of FAKE) await assertFails(wd(st));
        await assertSucceeds(wd('initiation'));
    });
    test('KABUL: başlat → 10 adımı sırayla onayla (durum makinesi döngüsü) → completed / Onaylandı', async () => {
        await put('purchaseOrders', 'pz', draft);
        const ten = Array.from({ length: 10 }, (_, i) => step(i % 2 ? 'uid-s3' : 'uid-s2'));
        await assertSucceeds(upd('pz', { durum: 'Onay Bekliyor', akis: [...akis, ev('İş akışı başlatıldı')],
            workflow: { started: true, finished: false, currentStep: 0, currentState: 'initiation', steps: ten, history: [hev('create')] } }));
        let po = { ...draft, durum: 'Onay Bekliyor', akis: [...akis, ev('İş akışı başlatıldı')],
            workflow: { started: true, finished: false, currentStep: 0, currentState: 'initiation', steps: ten, history: [hev('create')] } };
        for (let i = 0; i < 10; i++) {
            po = approved(po, i);
            await assertSucceeds(setDoc(item(i % 2 ? ctx.s3() : ctx.s2(), LIVE, 'purchaseOrders', 'pz'), { id: 'pz', ...po }));
        }
        assert(po.workflow.currentState === 'completed' && po.durum === 'Onaylandı' && po.workflow.finished === true);
    });
});

// ─── J11.7 · P1 (bağımsız denetim): zorunlu denetim kaydı atlanamaz ──────────────────────────────────────────────────────
// Gerçek istemci: başlatma +1 history ('create') +1 akış (confirmStartWorkflow), iptal +1 akış (cancelPurchase; history yok),
// geri çekme +1 history ('withdraw') +1 akış. ownerEventOk "kayıt eklenmemesini" de kabul ettiği için bu işlemler kayıtsız
// yapılabiliyordu. Düzenleme / ek silme (kaydı isteğe bağlı) DEĞİŞMEZ.
describe('J11.7 · başlatma / iptal / geri çekme zorunlu history / akış kaydı olmadan yapılamaz', () => {
    const draft = { urun: 'Kağıt', aciklama: 'A4', durum: 'Taslak', ...OWNER, akis, workflow: { started: false, currentStep: 0, steps: [], history: [] } };
    const upd = (id, data) => updateDoc(item(ctx.s1(), LIVE, 'purchaseOrders', id), data);
    test('BAŞLATMA: history (create) ve akış (İş akışı başlatıldı) kaydı ZORUNLU', async () => {
        await put('purchaseOrders', 'pa1', draft);
        const start = (a, h) => upd('pa1', { durum: 'Onay Bekliyor', akis: a,
            workflow: { started: true, finished: false, currentStep: 0, currentState: 'initiation', steps: [step('uid-s2')], history: h } });
        await assertFails(start(akis, [hev('create')]));                          // akış kaydı yok
        await assertFails(start([...akis, ev('İş akışı başlatıldı')], []));         // history kaydı yok
        await assertFails(start(akis, []));                                        // ikisi de yok
        await assertSucceeds(start([...akis, ev('İş akışı başlatıldı')], [hev('create')]));
    });
    test('İPTAL: akış kaydı (Talep İptal Edildi) ZORUNLU', async () => {
        await put('purchaseOrders', 'pa2', draft);
        const cancel = a => upd('pa2', { durum: 'İptal Edildi', akis: a,
            workflow: { started: false, finished: true, currentStep: 0, currentState: 'cancelled', steps: [], history: [] } });
        await assertFails(cancel(akis));
        await assertSucceeds(cancel([...akis, ev('Talep İptal Edildi')]));
    });
    test('GERİ ÇEKME: history (withdraw) ve akış kaydı ZORUNLU', async () => {
        await put('purchaseOrders', 'pa3', running());
        const wd = (a, h) => upd('pa3', { durum: 'Taslak', akis: a,
            workflow: { id: 'wf1', started: false, finished: false, currentStep: 0, currentState: 'initiation', steps: [], history: h } });
        await assertFails(wd(akis, [...hist, hev('withdraw')]));                  // akış kaydı yok
        await assertFails(wd([...akis, ev(WD)], hist));                           // history kaydı yok
        await assertFails(wd(akis, hist));                                         // ikisi de yok
        await assertSucceeds(wd([...akis, ev(WD)], [...hist, hev('withdraw')]));
    });
    test('KORUNAN: taslak düzenleme ve ek silme (kayıt eklemeden ya da tek kayıtla) değişmedi', async () => {
        await put('purchaseOrders', 'pa4', draft);
        await assertSucceeds(upd('pa4', { urun: 'Kağıt A3' }));
        await assertSucceeds(upd('pa4', { aciklama: 'A3', akis: [...akis, ev('Talep güncellendi')] }));
        await assertSucceeds(upd('pa4', { akis: [...akis, ev('Talep güncellendi'), ev('Ek dosya silindi')] }));
    });
});

describe('Görev (tasks) — oluşturan / atanan', () => {
    test('personel kendi creatorUid\'siyle oluşturur; başkası adına / uid\'siz oluşturamaz', async () => {
        await assertSucceeds(setDoc(item(ctx.s1(), LIVE, 'tasks', 't2'), { id: 't2', title: 'Yeni', creatorUid: 'uid-s1', creatorId: 'Ayşe Yılmaz' }));
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

describe('Silme (J11 · P1 #6: KJ-5 demo test istisnası kaldırıldı)', () => {
    test('personel talep silemez; admin siler', async () => {
        await assertFails(deleteDoc(item(ctx.s1(), LIVE, 'requests', 'r1')));
        await assertSucceeds(deleteDoc(item(ctx.admin(), LIVE, 'requests', 'r1')));
    });
    // Eskiden: demo kökünde __flowtest__ işaretli her belgeyi HER bağlı personel silebiliyordu (zimmet / servis kayıtları dahil,
    // bakım modu kontrolü yok; işaret personelin yazabildiği metin alanlarında aranıyordu).
    test('J11 · P1 #6: demo kökünde __flowtest__ işaretli belgeyi personel SİLEMEZ (5 koleksiyonun hiçbirinde)', async () => {
        await seed(async db => {
            await setDoc(item(db, DEMO, 'purchaseOrders', 'potest'), { id: 'potest', urun: 'X __flowtest__', createdByUid: 'uid-s1' });
            await setDoc(item(db, DEMO, 'assignments', 'astest'), { id: 'astest', alanKisi: 'X __flowtest__' });
            await setDoc(item(db, DEMO, 'serviceRecords', 'srtest'), { id: 'srtest', not: 'X __flowtest__' });
            await setDoc(item(db, DEMO, 'tasks', 'ttest'), { id: 'ttest', title: 'X __flowtest__', creatorUid: 'uid-s2' });
        });
        for (const [col, id] of [['requests', 'rtest'], ['purchaseOrders', 'potest'], ['assignments', 'astest'], ['serviceRecords', 'srtest'], ['tasks', 'ttest']]) {
            await assertFails(deleteDoc(item(ctx.s1(), DEMO, col, id)));
        }
    });
    test('J11 · P1 #6: personel kendi talebine işaret yazıp silemez (sahte işaretle silme yolu yok)', async () => {
        await put('requests', 'rmine', { ürün: 'Gerçek', durum: 'Beklemede', personelUid: 'uid-s1', personel: 'Ayşe Yılmaz', personelId: 's1' }, DEMO);
        await assertSucceeds(updateDoc(item(ctx.s1(), DEMO, 'requests', 'rmine'), { not: 'artık __flowtest__' }));   // meşru düzenleme
        await assertFails(deleteDoc(item(ctx.s1(), DEMO, 'requests', 'rmine')));
        assert(!!(await rd('requests', 'rmine', DEMO)));
    });
    test('J11 · P1 #6: bakım modunda personel işaretli kaydı da silemez; admin bakımda da temizler', async () => {
        await setMaintenance(true, DEMO);
        await assertFails(deleteDoc(item(ctx.s1(), DEMO, 'requests', 'rtest')));
        await assertSucceeds(deleteDoc(item(ctx.admin(), DEMO, 'requests', 'rtest')));
    });
    test('J11 · P1 #6: yetkili test temizliği (admin) demo kökünde işaretli kaydı siler; anonim / oturumsuz silemez', async () => {
        await assertFails(deleteDoc(item(ctx.anon(), DEMO, 'requests', 'rtest')));
        await assertFails(deleteDoc(item(ctx.none(), DEMO, 'requests', 'rtest')));
        await assertSucceeds(deleteDoc(item(ctx.admin(), DEMO, 'requests', 'rtest')));
    });
    test('personel kendi oluşturduğu görevi siler (meşru yol değişmedi); başkasınınkini silemez', async () => {
        await assertSucceeds(deleteDoc(item(ctx.s1(), LIVE, 'tasks', 't1')));
        await put('tasks', 't9', { title: 'Başkasının', creatorUid: 'uid-s2' });
        await assertFails(deleteDoc(item(ctx.s1(), LIVE, 'tasks', 't9')));
    });
});

// ─── J11 · P1 #7: talep sahibi ve workflow katılımcı kimliği ─────────────────────────────────────────────────────────────
describe('J11 · P1 #7 — görünen kimlik oturum sahibinin gerçek personel kaydına bağlı', () => {
    const req = { ürün: 'Klavye', adet: 1, durum: 'Beklemede', personelUid: 'uid-s1', personel: 'Ayşe Yılmaz', personelId: 's1' };
    const draftPo = { urun: 'Kağıt', durum: 'Taslak', ...OWNER, akis, workflow: { started: false, currentStep: 0, steps: [], history: [] } };
    test('talep: kendi uid\'siyle BAŞKASININ adı / personel id\'si taşınamaz', async () => {
        await assertFails(setDoc(item(ctx.s1(), LIVE, 'requests', 'q1'), { id: 'q1', ...req, personel: 'Bora Kaya' }));
        await assertFails(setDoc(item(ctx.s1(), LIVE, 'requests', 'q1'), { id: 'q1', ...req, personelId: 's2' }));
        await assertFails(setDoc(item(ctx.s1(), LIVE, 'requests', 'q1'), { id: 'q1', ...req, personel: '' }));
        const { personelId, ...noId } = req;
        await assertFails(setDoc(item(ctx.s1(), LIVE, 'requests', 'q1'), { id: 'q1', ...noId }));
        await assertSucceeds(setDoc(item(ctx.s1(), LIVE, 'requests', 'q1'), { id: 'q1', ...req }));
    });
    test('talep: sayısal personel id\'si (eski kayıt biçimi) metin eşlemesiyle eşleşir', async () => {
        await seed(async db => {
            await setDoc(item(db, LIVE, 'personel', '1790573516931123'), { id: 1790573516931123, name: 'Sayı Kişi', pri: 'sayi.kisi', uid: 'uid-num' });
            await setDoc(item(db, LIVE, 'staffAccounts', 'uid-num'), { personelId: '1790573516931123', pri: 'sayi.kisi' });
        });
        const num = staffCtx('uid-num', 'sayi.kisi');
        await assertSucceeds(setDoc(item(num(), LIVE, 'requests', 'q2'), { id: 'q2', ürün: 'X', durum: 'Beklemede', personelUid: 'uid-num', personel: 'Sayı Kişi', personelId: 1790573516931123 }));
    });
    test('talep: ad personel kaydında adSoyad alanındaysa (eski şema) o ad esas alınır; kırpılmış karşılaştırma', async () => {
        await seed(async db => {
            await setDoc(item(db, LIVE, 'personel', 'sx'), { id: 'sx', adSoyad: '  Eski Şema  ', pri: 'eski.sema', uid: 'uid-sx' });
            await setDoc(item(db, LIVE, 'staffAccounts', 'uid-sx'), { personelId: 'sx', pri: 'eski.sema' });
        });
        const sx = staffCtx('uid-sx', 'eski.sema');
        await assertSucceeds(setDoc(item(sx(), LIVE, 'requests', 'q3'), { id: 'q3', ürün: 'X', durum: 'Beklemede', personelUid: 'uid-sx', personel: 'Eski Şema', personelId: 'sx' }));
        await assertFails(setDoc(item(sx(), LIVE, 'requests', 'q4'), { id: 'q4', ürün: 'X', durum: 'Beklemede', personelUid: 'uid-sx', personel: 'Ayşe Yılmaz', personelId: 'sx' }));
    });
    test('talep: güncellemede görünen sahip alanları değiştirilemez', async () => {
        await put('requests', 'q5', req);
        await assertFails(updateDoc(item(ctx.s1(), LIVE, 'requests', 'q5'), { personel: 'Bora Kaya' }));
        await assertFails(updateDoc(item(ctx.s1(), LIVE, 'requests', 'q5'), { personelId: 's2' }));
    });
    test('satın alma: talepEden / createdByName / createdBy başka personel olamaz; sahte geçmişle açılamaz', async () => {
        await assertFails(setDoc(item(ctx.s1(), LIVE, 'purchaseOrders', 'p1'), { id: 'p1', ...draftPo, talepEden: 'Bora Kaya' }));
        await assertFails(setDoc(item(ctx.s1(), LIVE, 'purchaseOrders', 'p1'), { id: 'p1', ...draftPo, createdByName: 'Bora Kaya' }));
        await assertFails(setDoc(item(ctx.s1(), LIVE, 'purchaseOrders', 'p1'), { id: 'p1', ...draftPo, createdBy: 's2' }));
        await assertFails(setDoc(item(ctx.s1(), LIVE, 'purchaseOrders', 'p1'), { id: 'p1', ...draftPo, akis: [{ ...akis[0], yapan: 'Bora Kaya' }] }));
        await assertFails(setDoc(item(ctx.s1(), LIVE, 'purchaseOrders', 'p1'), { id: 'p1', ...draftPo, akis: [...akis, { islem: '✅ Müdür onayladı', yapan: 'Ayşe Yılmaz' }] }));
        await assertFails(setDoc(item(ctx.s1(), LIVE, 'purchaseOrders', 'p1'), { id: 'p1', ...draftPo, workflow: { ...draftPo.workflow, history: [{ action: 'approved', actor: 'Müdür' }] } }));
        await assertSucceeds(setDoc(item(ctx.s1(), LIVE, 'purchaseOrders', 'p1'), { id: 'p1', ...draftPo }));
    });
    test('satın alma taslağı: sahibi görünen kimliği değiştiremez; başkası adına / birden çok kayıt ekleyemez', async () => {
        await put('purchaseOrders', 'p2', draftPo);
        await assertFails(updateDoc(item(ctx.s1(), LIVE, 'purchaseOrders', 'p2'), { talepEden: 'Bora Kaya' }));
        await assertFails(updateDoc(item(ctx.s1(), LIVE, 'purchaseOrders', 'p2'), { createdByName: 'Bora Kaya' }));
        await assertFails(updateDoc(item(ctx.s1(), LIVE, 'purchaseOrders', 'p2'), { createdBy: 's2' }));
        await assertFails(updateDoc(item(ctx.s1(), LIVE, 'purchaseOrders', 'p2'), { akis: [...akis, ev('Talep güncellendi', { yapan: 'Bora Kaya' })] }));
        await assertFails(updateDoc(item(ctx.s1(), LIVE, 'purchaseOrders', 'p2'), { akis: [...akis, { islem: 'a', yapan: 'Ayşe Yılmaz' }, { islem: 'b', yapan: 'Ayşe Yılmaz' }] }));
        await assertSucceeds(updateDoc(item(ctx.s1(), LIVE, 'purchaseOrders', 'p2'), { urun: 'Kağıt A3', akis: [...akis, ev('Talep güncellendi')] }));
    });
    test('satın alma: iptal (taslak) ve geri çekme meşru kalır; geri çekmede başkası adına kayıt reddedilir', async () => {
        await put('purchaseOrders', 'p3', draftPo);
        await assertSucceeds(updateDoc(item(ctx.s1(), LIVE, 'purchaseOrders', 'p3'), { durum: 'İptal Edildi', akis: [...akis, ev('Talep İptal Edildi')],
            workflow: { started: false, finished: true, currentStep: 0, currentState: 'cancelled', steps: [], history: [] } }));
        await put('purchaseOrders', 'p4', running());
        await assertFails(updateDoc(item(ctx.s1(), LIVE, 'purchaseOrders', 'p4'), { durum: 'Taslak', akis: [...akis, ev(WD, { yapan: 'Cem Demir' })],
            workflow: { id: 'wf1', started: false, finished: false, currentStep: 0, currentState: 'initiation', steps: [], history: [...hist, hev('withdraw')] } }));
        await assertSucceeds(updateDoc(item(ctx.s1(), LIVE, 'purchaseOrders', 'p4'), { durum: 'Taslak', akis: [...akis, ev(WD)],
            workflow: { id: 'wf1', started: false, finished: false, currentStep: 0, currentState: 'initiation', steps: [], history: [...hist, hev('withdraw')] } }));
    });
    test('SAHTE ONAYLAYICI: adımda "Bora Kaya" yazıp başkasının (s3) uid\'si konursa o kişi adımı ONAYLAYAMAZ; admin onaylar', async () => {
        const fake = running({ workflow: { ...running().workflow, steps: [{ ...step('uid-s3'), user: 'Bora Kaya' }, step('uid-s2')] } });
        await put('purchaseOrders', 'p5', fake);
        const a = approved(fake, 0);
        await assertFails(setDoc(item(ctx.s3(), LIVE, 'purchaseOrders', 'p5'), { id: 'p5', ...a }));
        // s3 adımın görünen adını kendi adıyla "düzeltip" onaylayamaz (user değiştirilemez)
        const b = approved(running({ workflow: { ...fake.workflow, steps: [step('uid-s3'), step('uid-s2')] } }), 0);
        await assertFails(setDoc(item(ctx.s3(), LIVE, 'purchaseOrders', 'p5'), { id: 'p5', ...b }));
        await assertSucceeds(setDoc(item(ctx.admin(), LIVE, 'purchaseOrders', 'p5'), { id: 'p5', ...a }));
    });
    test('SAHTE AKTÖR (P1 #5): sırası gelen gerçek onaylayıcı adım / history / akış kaydına BAŞKASININ adını yazamaz', async () => {
        await put('purchaseOrders', 'p6', running());
        const base = approved(running(), 0);
        const steps0 = base.workflow.steps.map((s, k) => (k === 0 ? { ...s, actor: 'Yönetici' } : s));
        await assertFails(setDoc(item(ctx.s2(), LIVE, 'purchaseOrders', 'p6'), { id: 'p6', ...base, workflow: { ...base.workflow, steps: steps0 } }));
        // Yalnız aktör farklı (uid / tür / sayı meşru) — aktör denetimi tek başına reddeder
        const h = [...running().workflow.history, { ...base.workflow.history.at(-1), actor: 'Yönetici' }];
        await assertFails(setDoc(item(ctx.s2(), LIVE, 'purchaseOrders', 'p6'), { id: 'p6', ...base, workflow: { ...base.workflow, history: h } }));
        await assertFails(setDoc(item(ctx.s2(), LIVE, 'purchaseOrders', 'p6'), { id: 'p6', ...base, akis: [...akis, { ...base.akis.at(-1), yapan: 'Yönetici' }] }));
        await assertSucceeds(setDoc(item(ctx.s2(), LIVE, 'purchaseOrders', 'p6'), { id: 'p6', ...base }));
        // İKİNCİ KEZ onay: aynı onaylayıcı aynı payload'ı tekrar gönderemez (cs ilerledi, sıra s3'te)
        await assertFails(setDoc(item(ctx.s2(), LIVE, 'purchaseOrders', 'p6'), { id: 'p6', ...base }));
    });
    test('SAHTE AKTÖR (red): üç red kaydından herhangi biri başkası adına olursa reddedilir', async () => {
        await put('purchaseOrders', 'p7', running());
        const base = rejected(running(), 0, 'red');
        const [r1, r2, r3] = base.akis.slice(akis.length);
        await assertFails(setDoc(item(ctx.s2(), LIVE, 'purchaseOrders', 'p7'), { id: 'p7', ...base, akis: [...akis, r1, { ...r2, yapan: 'Cem Demir' }, r3] }));
        await assertSucceeds(setDoc(item(ctx.s2(), LIVE, 'purchaseOrders', 'p7'), { id: 'p7', ...base }));
    });
    test('AYNI İSİMLİ iki personel: ad eşleşse de yalnız adımdaki uid\'nin sahibi onaylar', async () => {
        await seed(async db => {
            await setDoc(item(db, LIVE, 'personel', 'tw'), { id: 'tw', name: 'Bora Kaya', pri: 'bora.kaya2', uid: 'uid-tw' });
            await setDoc(item(db, LIVE, 'staffAccounts', 'uid-tw'), { personelId: 'tw', pri: 'bora.kaya2' });
        });
        await put('purchaseOrders', 'p8', running());
        await assertFails(setDoc(item(staffCtx('uid-tw', 'bora.kaya2')(), LIVE, 'purchaseOrders', 'p8'), { id: 'p8', ...approved(running(), 0) }));
        await assertSucceeds(setDoc(item(ctx.s2(), LIVE, 'purchaseOrders', 'p8'), { id: 'p8', ...approved(running(), 0) }));
    });
    test('EKSİK UID: adımda userUid yoksa personel onaylayamaz (yalnız admin) — mevcut kural, kimlik denetimiyle birlikte', async () => {
        const noUid = running({ workflow: { ...running().workflow, steps: [{ user: 'Bora Kaya', tip: 'Paraf', status: 'pending' }, step('uid-s3')] } });
        await put('purchaseOrders', 'p9', noUid);
        await assertFails(setDoc(item(ctx.s2(), LIVE, 'purchaseOrders', 'p9'), { id: 'p9', ...approved(noUid, 0) }));
    });
    test('görev: oluşturan adı (creatorId) başkası olamaz ve sonradan değiştirilemez', async () => {
        await assertFails(setDoc(item(ctx.s1(), LIVE, 'tasks', 'g1'), { id: 'g1', title: 'X', creatorUid: 'uid-s1', creatorId: 'Bora Kaya' }));
        await assertSucceeds(setDoc(item(ctx.s1(), LIVE, 'tasks', 'g1'), { id: 'g1', title: 'X', creatorUid: 'uid-s1', creatorId: 'Ayşe Yılmaz' }));
        await assertFails(updateDoc(item(ctx.s1(), LIVE, 'tasks', 'g1'), { creatorId: 'Bora Kaya' }));
        await assertSucceeds(updateDoc(item(ctx.s1(), LIVE, 'tasks', 'g1'), { title: 'Y' }));
    });
    test('personel kaydı silinmiş / eşleme bozuk hesap kimlik gerektiren hiçbir yazma yapamaz', async () => {
        await seed(db => deleteDoc(item(db, LIVE, 'personel', 's1')));
        await assertFails(setDoc(item(ctx.s1(), LIVE, 'requests', 'q9'), { id: 'q9', ...req }));
        await assertFails(setDoc(item(ctx.ghost(), LIVE, 'requests', 'q9'), { id: 'q9', ...req, personelUid: 'uid-ghost' }));
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
        await assertSucceeds(setDoc(item(ctx.s1(), LIVE, 'requests', 'r4'), { id: 'r4', ürün: 'X', durum: 'Beklemede', personelUid: 'uid-s1', personel: 'Ayşe Yılmaz', personelId: 's1' }));
    });
    test('system_config: personel okur, anonim okuyamaz, admin yazar', async () => {
        await assertSucceeds(getDoc(item(ctx.s1(), LIVE, 'system_config', 'admin_settings')));
        await assertFails(getDoc(item(ctx.anon(), LIVE, 'system_config', 'admin_settings')));
        await assertSucceeds(setDoc(item(ctx.admin(), LIVE, 'system_config', 'admin_settings'), { maintenance: true }));
    });
});

describe('Etiket reddi (RULE-02 savunma derinliği)', () => {
    const own = { requests: { durum: 'Beklemede', personelUid: 'uid-s1', personel: 'Ayşe Yılmaz', personelId: 's1' }, tasks: { creatorUid: 'uid-s1', creatorId: 'Ayşe Yılmaz' },
        purchaseOrders: { durum: 'Onay Bekliyor', ...OWNER, workflow: { started: false, steps: [] } } };
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
    // Farklı istemci saati: new Date() aynı milisaniyedeki request.time ile bazen eşleşip testi rastlantısal geçiriyordu.
    test('farklı istemci saati reddedilir', () => assertFails(setDoc(item(ctx.s1(), LIVE, 'auditLogs', 'L1'), { ...valid(), ts: new Date('2020-01-01T00:00:00.000Z') })));
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

// ─── J11 · P0: personel erişim kilidi (accessGate/items/staff) ────────────────────────────────────────────────────────────
// Kanıtlanan: (1) VARSAYILAN KAPALI — kilit dokümanı yokken hiçbir personel hiçbir şey okuyamaz/yazamaz; (2) false, eksik alan ve
// yanlış tip de kapalıdır (fail-closed); (3) kilit kapalıyken / göç yarıdayken yönetici göçün bütün adımlarını yapar; (4) kilit
// yalnız sekiz denetimi sıfır olan, sunucu saatli, kendi imzalı kapanış kanıtıyla açılır; kapatmak her zaman serbesttir;
// (5) personel kilide yazamaz; (6) kilit kök başınadır.
const CLOSURE_KEYS = ['personelCodes', 'requestCodes', 'purchaseOrderCodes', 'accountsMissing', 'accountsInconsistent',
    'accountMapMismatch', 'ownershipPending', 'ownershipUnresolved'];
const zeroClosure = () => Object.fromEntries(CLOSURE_KEYS.map(k => [k, 0]));
const gateRef = (db, root = LIVE) => item(db, root, 'accessGate', 'staff');
const setGate = (data, root = LIVE) => seed(db => setDoc(gateRef(db, root), data));
const dropGate = (root = LIVE) => seed(db => deleteDoc(gateRef(db, root)));
const openPayload = (extra = {}) => ({ staffAccessEnabled: true, changedAt: serverTimestamp(), changedBy: 'admin-uid', reason: 'J11 kapanış', closure: zeroClosure(), version: 1, ...extra });
const closePayload = (extra = {}) => ({ staffAccessEnabled: false, changedAt: serverTimestamp(), changedBy: 'admin-uid', reason: 'göç', version: 1, ...extra });

// Personelin bütün erişim yolları: okuma, liste, iş akışı yazmaları, görev silme, denetim günlüğü, demo temizlik istisnası.
async function staffLockedOut(db, root = LIVE) {
    await assertFails(getDoc(item(db, root, 'b1', 'p1')));
    await assertFails(getDoc(item(db, root, 'personel', 's2')));
    await assertFails(getDocs(collection(db, root, 'personel', 'items')));
    await assertFails(getDocs(collection(db, root, 'requests', 'items')));
    await assertFails(getDoc(item(db, root, 'system_config', 'admin_settings')));
    await assertFails(getDoc(item(db, root, 'workflowTemplates', 'w1')));
    await assertFails(setDoc(item(db, root, 'requests', 'gx1'), { id: 'gx1', ürün: 'X', durum: 'Beklemede', personelUid: 'uid-s1' }));
    await assertFails(setDoc(item(db, root, 'tasks', 'gx2'), { id: 'gx2', title: 'X', creatorUid: 'uid-s1' }));
    await assertFails(setDoc(item(db, root, 'purchaseOrders', 'gx3'), { id: 'gx3', durum: 'Taslak', createdByUid: 'uid-s1', workflow: { started: false, steps: [] } }));
    await assertFails(updateDoc(item(db, root, 'requests', 'r1'), { durum: 'draft' }));
    await assertFails(deleteDoc(item(db, root, 'tasks', 't1')));
    await assertFails(setDoc(item(db, root, 'auditLogs', 'gx4'), {
        id: 'gx4', type: 'x', refCol: 'requests', refId: 'r1', item: 'x', qty: 1, actorName: 'Ayşe', actorPersonelId: 's1',
        uid: 'uid-s1', authKind: 'password', result: 'blocked', reason: 'x', page: 'index', ts: serverTimestamp() }));
}

describe('J11 · P0 personel erişim kilidi — varsayılan kapalı (fail-closed)', () => {
    beforeEach(async () => {
        // tasks/t1 ve requests/r1 iki kökte de olsun (kilit yolları her iki kökte denenir)
        await seed(async db => {
            await setDoc(item(db, DEMO, 'b1', 'p1'), { id: 'p1', ürün: 'Laptop' });
            await setDoc(item(db, DEMO, 'tasks', 't1'), { id: 't1', title: 'Görev', creatorUid: 'uid-s1', status: 'Pending' });
            await setDoc(item(db, DEMO, 'requests', 'r1'), { id: 'r1', ürün: 'Mouse', durum: 'Beklemede', personelUid: 'uid-s1' });
        });
    });
    test('KİLİT DOKÜMANI YOK (deploy sonrası ilk an): hiçbir personel hiçbir yolu kullanamaz — canlı ve demo', async () => {
        await dropGate(LIVE); await dropGate(DEMO);
        for (const root of [LIVE, DEMO]) for (const db of [ctx.s1(), ctx.s2(), ctx.s3()]) await staffLockedOut(db, root);
        await assertFails(deleteDoc(item(ctx.s1(), DEMO, 'requests', 'rtest')));   // KJ-5 demo temizlik istisnası da kapalı
    });
    test('kilit false: personel kapalı', async () => {
        await setGate({ staffAccessEnabled: false });
        await staffLockedOut(ctx.s1());
    });
    for (const [label, data] of [['alan yok', {}], ['string "true"', { staffAccessEnabled: 'true' }], ['sayı 1', { staffAccessEnabled: 1 }],
        ['null', { staffAccessEnabled: null }], ['harita', { staffAccessEnabled: { on: true } }], ['yanlış alan adı', { staffAccessEnable: true }]]) {
        test(`kilit yanlış tipte / eksik (${label}): personel kapalı`, async () => {
            await setGate(data);
            await assertFails(getDoc(item(ctx.s1(), LIVE, 'personel', 's2')));
            await assertFails(getDocs(collection(ctx.s1(), LIVE, 'personel', 'items')));
            await assertFails(setDoc(item(ctx.s1(), LIVE, 'requests', 'gy'), { id: 'gy', ürün: 'X', durum: 'Beklemede', personelUid: 'uid-s1' }));
        });
    }
    test('GÖÇ YARIDA (kodlar personel kaydında duruyor): personel kodlu kaydı da listeyi de okuyamaz', async () => {
        await dropGate();
        await put('personel', 's2', { name: 'Bora Kaya', pri: 'bora.kaya', uid: 'uid-s2', code: 'Q7zP9' });
        await put('requests', 'rk', { ürün: 'X', durum: 'Beklemede', personelKodu: 'Q7zP9', personelUid: 'uid-s1' });
        await put('purchaseOrders', 'pok', { durum: 'Taslak', createdBy: 'Q7zP9', createdByUid: 'uid-s2' });
        for (const db of [ctx.s1(), ctx.s2()]) {
            await assertFails(getDoc(item(db, LIVE, 'personel', 's2')));
            await assertFails(getDocs(collection(db, LIVE, 'personel', 'items')));
            await assertFails(getDoc(item(db, LIVE, 'requests', 'rk')));
            await assertFails(getDoc(item(db, LIVE, 'purchaseOrders', 'pok')));
        }
    });
    test('kilit başka kökte açık: bu kökte kapalı (kök başına kilit)', async () => {
        await dropGate(LIVE);
        await assertSucceeds(getDoc(item(ctx.s1(), DEMO, 'b1', 'p1')));
        await assertFails(getDoc(item(ctx.s1(), LIVE, 'b1', 'p1')));
    });
    test('bakım modu ile çelişmez: kilit kapalı + bakım kapalı → yazma yok; kilit açık + bakım açık → okuma var, yazma yok', async () => {
        await setGate({ staffAccessEnabled: false });
        await assertFails(setDoc(item(ctx.s1(), LIVE, 'requests', 'm1'), { id: 'm1', ürün: 'X', durum: 'Beklemede', personelUid: 'uid-s1' }));
        await setGate({ staffAccessEnabled: true });
        await setMaintenance(true);
        await assertSucceeds(getDoc(item(ctx.s1(), LIVE, 'b1', 'p1')));
        await assertFails(setDoc(item(ctx.s1(), LIVE, 'requests', 'm2'), { id: 'm2', ürün: 'X', durum: 'Beklemede', personelUid: 'uid-s1' }));
    });
});

describe('J11 · P0 — kilit kapalıyken yönetici göçü yapar', () => {
    beforeEach(() => dropGate());
    test('admin okur: personel listesi (kodlu), talepler, eşlemeler, kilit', async () => {
        await put('personel', 's2', { name: 'Bora Kaya', pri: 'bora.kaya', uid: 'uid-s2', code: 'Q7zP9' });
        await assertSucceeds(getDocs(collection(ctx.admin(), LIVE, 'personel', 'items')));
        await assertSucceeds(getDocs(collection(ctx.admin(), LIVE, 'requests', 'items')));
        await assertSucceeds(getDoc(item(ctx.admin(), LIVE, 'staffAccounts', 'uid-s1')));
        await assertSucceeds(getDoc(gateRef(ctx.admin())));
    });
    test('PRI / Hesap göçü: eşleme + personel bağı yazılır', async () => {
        await assertSucceeds(setDoc(item(ctx.admin(), LIVE, 'staffAccounts', 'uid-s4'), { personelId: 's4', pri: 'deniz.ak', linkedAt: 1 }));
        await assertSucceeds(updateDoc(item(ctx.admin(), LIVE, 'personel', 's4'), { uid: 'uid-s4', authEmail: 'deniz.ak@staff.medipol.local' }));
    });
    test('Sahiplik göçü: sahipsiz kayda uid yazılır', () =>
        assertSucceeds(updateDoc(item(ctx.admin(), LIVE, 'requests', 'rlegacy'), { personelUid: 'uid-s1' })));
    test('Kod temizliği: personel.code / requests.personelKodu silinir, purchaseOrders.createdBy değiştirilir', async () => {
        await put('personel', 's2', { name: 'Bora Kaya', pri: 'bora.kaya', uid: 'uid-s2', code: 'Q7zP9' });
        await put('requests', 'rk', { ürün: 'X', durum: 'Beklemede', personelKodu: 'Q7zP9' });
        await put('purchaseOrders', 'pok', { durum: 'Taslak', createdBy: 'Q7zP9' });
        await assertSucceeds(updateDoc(item(ctx.admin(), LIVE, 'personel', 's2'), { code: deleteField() }));
        await assertSucceeds(updateDoc(item(ctx.admin(), LIVE, 'requests', 'rk'), { personelKodu: deleteField() }));
        await assertSucceeds(updateDoc(item(ctx.admin(), LIVE, 'purchaseOrders', 'pok'), { createdBy: 's2' }));
    });
    test('bakım modunu açar / kapatır (kilitten bağımsız)', () =>
        assertSucceeds(setDoc(item(ctx.admin(), LIVE, 'system_config', 'admin_settings'), { maintenance: true })));
});

describe('J11 · P0 — kilidi açma yalnız doğrulanmış kapanışla; kapatma her zaman', () => {
    beforeEach(() => dropGate());
    test('geçerli kanıt (8 denetim = 0, sunucu saati, kendi imzası) → açılır; personel artık okur', async () => {
        await assertFails(getDoc(item(ctx.s1(), LIVE, 'b1', 'p1')));
        await assertSucceeds(setDoc(gateRef(ctx.admin()), openPayload()));
        await assertSucceeds(getDoc(item(ctx.s1(), LIVE, 'b1', 'p1')));
    });
    test('kanıtsız açılamaz (closure yok)', async () => {
        const { closure, ...noClosure } = openPayload();
        await assertFails(setDoc(gateRef(ctx.admin()), noClosure));
    });
    for (const k of CLOSURE_KEYS) {
        test(`kapanmamış denetim (${k} = 1) ile açılamaz`, () =>
            assertFails(setDoc(gateRef(ctx.admin()), openPayload({ closure: { ...zeroClosure(), [k]: 1 } }))));
    }
    test('eksik denetim anahtarı / fazladan anahtar / sayı yerine metin ile açılamaz', async () => {
        const { ownershipUnresolved, ...missing } = zeroClosure();
        await assertFails(setDoc(gateRef(ctx.admin()), openPayload({ closure: missing })));
        await assertFails(setDoc(gateRef(ctx.admin()), openPayload({ closure: { ...zeroClosure(), extra: 0 } })));
        await assertFails(setDoc(gateRef(ctx.admin()), openPayload({ closure: { ...zeroClosure(), personelCodes: '0' } })));
        await assertFails(setDoc(gateRef(ctx.admin()), openPayload({ extra: true })));
    });
    test('istemci saati / başkası adına imza / sürüm yok / tip yanlış → reddedilir', async () => {
        await assertFails(setDoc(gateRef(ctx.admin()), openPayload({ changedAt: new Date() })));
        await assertFails(setDoc(gateRef(ctx.admin()), openPayload({ changedBy: 'baska-uid' })));
        await assertFails(setDoc(gateRef(ctx.admin()), openPayload({ version: 2 })));
        await assertFails(setDoc(gateRef(ctx.admin()), openPayload({ staffAccessEnabled: 'true' })));
        await assertFails(setDoc(gateRef(ctx.admin()), openPayload({ reason: '<img src=x>' })));
    });
    test('kapatma kanıtsız serbest; silme = kapatma; ikisinde de personel hemen dışarıda', async () => {
        await setGate({ staffAccessEnabled: true });
        await assertSucceeds(getDoc(item(ctx.s1(), LIVE, 'b1', 'p1')));
        await assertSucceeds(setDoc(gateRef(ctx.admin()), closePayload()));
        await staffLockedOut(ctx.s1());
        await setGate({ staffAccessEnabled: true });
        await assertSucceeds(deleteDoc(gateRef(ctx.admin())));
        await assertFails(getDoc(item(ctx.s1(), LIVE, 'b1', 'p1')));
    });
    test('KÖTÜ NİYET: personel kilidi açamaz / kapatamaz / silemez (kilit açıkken de)', async () => {
        await assertFails(setDoc(gateRef(ctx.s1()), { ...openPayload(), changedBy: 'uid-s1' }));
        await setGate({ staffAccessEnabled: true });
        await assertFails(setDoc(gateRef(ctx.s1()), { ...closePayload(), changedBy: 'uid-s1' }));
        await assertFails(updateDoc(gateRef(ctx.s1()), { staffAccessEnabled: true }));
        await assertFails(deleteDoc(gateRef(ctx.s1())));
    });
    test('kimliği doğrulanmış personel kapalı kilidi OKUR (neden reddedildiğini bilsin); bağsız hesap / ziyaretçi okuyamaz', async () => {
        await setGate({ staffAccessEnabled: false });
        await assertSucceeds(getDoc(gateRef(ctx.s1())));
        for (const db of [ctx.none(), ctx.anon(), ctx.signup(), ctx.squatter(), ctx.forged(), ctx.wrongPri(), ctx.legacyJ7()]) await assertFails(getDoc(gateRef(db)));
    });
    test('accessGate yalnız "staff" dokümanı; tanımsız kök kapalı', async () => {
        await assertFails(setDoc(item(ctx.admin(), LIVE, 'accessGate', 'other'), openPayload()));
        await assertFails(getDoc(item(ctx.admin(), LIVE, 'accessGate', 'other')));
        await assertFails(setDoc(item(ctx.admin(), 'rogue_root', 'accessGate', 'staff'), openPayload()));
    });
});

// v3.3 · Aşama 2/3 — raf kataloğu ve stok işlem defteri: kim okur / kim yazar. Transaction ve sayaç kuralları
// tests/integration/stock-ledger.emu.test.mjs'te (npm run test:ledger:emu).
describe('v3.3 · Raf kataloğu (shelves) ve stok işlem defteri (stockOperations)', () => {
    const shelfData = (extra = {}) => ({ code: 'RAF-A 1', depot: 'b1', capacity: 5, usedSlots: 0, active: true, updatedAt: serverTimestamp(), updatedBy: 'admin-uid', ...extra });
    beforeEach(() => seed(db => setDoc(item(db, LIVE, 'shelves', 'b1_RAF-A 1'), { ...shelfData(), updatedAt: new Date(0) })));
    test('bağlı personel raf kataloğunu okur ama yazamaz', async () => {
        await assertSucceeds(getDoc(item(ctx.s1(), LIVE, 'shelves', 'b1_RAF-A 1')));
        await assertFails(setDoc(item(ctx.s1(), LIVE, 'shelves', 'b1_RAF-B 1'), shelfData({ code: 'RAF-B 1', updatedBy: 'uid-s1' })));
        await assertFails(updateDoc(item(ctx.s1(), LIVE, 'shelves', 'b1_RAF-A 1'), { capacity: 9, updatedAt: serverTimestamp(), updatedBy: 'uid-s1' }));
    });
    test('KVKK: personele bağlı olmayan hesap / ziyaretçi raf kataloğunu okuyamaz ("signedIn" yetmez)', async () => {
        for (const db of [ctx.none(), ctx.anon(), ctx.signup(), ctx.otherUser(), ctx.squatter()]) await assertFails(getDoc(item(db, LIVE, 'shelves', 'b1_RAF-A 1')));
    });
    test('admin raf oluşturur / kapasite günceller; tanımsız kök kapalı', async () => {
        await assertSucceeds(setDoc(item(ctx.admin(), LIVE, 'shelves', 'b1_RAF-B 1'), shelfData({ code: 'RAF-B 1' })));
        await assertSucceeds(updateDoc(item(ctx.admin(), LIVE, 'shelves', 'b1_RAF-A 1'), { capacity: 9, updatedAt: serverTimestamp(), updatedBy: 'admin-uid' }));
        await assertFails(setDoc(item(ctx.admin(), 'rogue_root', 'shelves', 'b1_RAF-B 1'), shelfData({ code: 'RAF-B 1' })));
    });
    test('admin canlı ve localhost/demo köklerinde raf kataloğunu listeleyebilir; ziyaretçi listeleyemez', async () => {
        for (const root of [LIVE, DEMO]) {
            await assertSucceeds(getDocs(collection(ctx.admin(), root, 'shelves', 'items')));
            await assertFails(getDocs(collection(ctx.none(), root, 'shelves', 'items')));
        }
    });
    test('stok işlem defteri yalnız admin okur; personel okuyamaz / yazamaz', async () => {
        await seed(db => setDoc(item(db, LIVE, 'stockOperations', 'op_seeded_0001'), { id: 'op_seeded_0001', kind: 'transfer' }));
        await assertSucceeds(getDoc(item(ctx.admin(), LIVE, 'stockOperations', 'op_seeded_0001')));
        await assertFails(getDoc(item(ctx.s1(), LIVE, 'stockOperations', 'op_seeded_0001')));
        await assertFails(setDoc(item(ctx.s1(), LIVE, 'stockOperations', 'op_staff_0001'), { id: 'op_staff_0001', kind: 'transfer' }));
    });
    test('shelves / stockOperations genel koleksiyon kuralından yazılamaz (knownCol dışı)', async () => {
        await assertFails(setDoc(item(ctx.admin(), LIVE, 'shelves', 'serbest'), { id: 'serbest' }));
        await assertFails(setDoc(item(ctx.admin(), LIVE, 'stockOperations', 'op_free_00001'), { id: 'op_free_00001' }));
    });
});

function assert(v) { if (!v) throw new Error('assert'); }
