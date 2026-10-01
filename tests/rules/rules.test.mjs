// [WHY]: Faz 4 · J0 (KJ-1) — Firestore kuralları proje genelinde; bir kuralı canlıya yayınlamadan doğrulamanın tek güvenli yolu emülatör.
//        Bu dosya Plan Ek D (yetki matrisi) + Faz 4 Uygulama Planı §4'teki Rules v2 Aşama A hedefini senaryo olarak kodlar.
// [HOW]: `npm run test:rules` → firebase emulators:exec içinde node:test. RULES_FILE ile başka bir kural dosyası denenebilir
//        (varsayılan: firestore.rules). J0'da mevcut kurallara karşı koşulur; kırmızılar "bugünkü açıklar" baseline'ıdır.
import { test, before, after, beforeEach, describe } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp, setLogLevel } from 'firebase/firestore';

// Beklenen her ret SDK'da PERMISSION_DENIED uyarısı basar; sonuçlar node:test raporunda.
setLogLevel('silent');

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RULES_FILE = process.env.RULES_FILE || 'firestore.rules';
const LIVE = 'lifeserver_master';
const DEMO = 'inventory_demo';
const ADMIN_EMAIL = 'admin@medipol.local';
const XSS = '<img src=x onerror=alert(1)>';

let env;

// Oturum türleri: oturumsuz ziyaretçi, anonim personel (Aşama A'da kod girmiş/girmemiş ayrımı yok), admin.
const ctx = {
    none: () => env.unauthenticatedContext().firestore(),
    anon: () => env.authenticatedContext('anon-uid', { firebase: { sign_in_provider: 'anonymous' } }).firestore(),
    admin: () => env.authenticatedContext('admin-uid', { email: ADMIN_EMAIL, firebase: { sign_in_provider: 'password' } }).firestore(),
    otherUser: () => env.authenticatedContext('other-uid', { email: 'someone@medipol.local', firebase: { sign_in_provider: 'password' } }).firestore(),
    // Anonim sağlayıcı + admin e-postası iddiası: gerçek token'da olmaz; kural sağlayıcıyı da denetlemeli (savunma derinliği).
    forgedAnon: () => env.authenticatedContext('forged-uid', { email: ADMIN_EMAIL, firebase: { sign_in_provider: 'anonymous' } }).firestore(),
};

const item = (db, root, col, id) => doc(db, root, col, 'items', String(id));

async function seed(fn) {
    await env.withSecurityRulesDisabled(async (c) => fn(c.firestore()));
}

async function setMaintenance(on, root = LIVE) {
    await seed(db => setDoc(item(db, root, 'system_config', 'admin_settings'), { maintenance: on }));
}

before(async () => {
    env = await initializeTestEnvironment({
        projectId: 'demo-rules-test',
        firestore: { rules: readFileSync(resolve(ROOT_DIR, RULES_FILE), 'utf8') },
    });
    console.log(`[rules] ${RULES_FILE}`);
});

after(async () => { if (env) await env.cleanup(); });

beforeEach(async () => {
    await env.clearFirestore();
    await seed(async db => {
        await setDoc(item(db, LIVE, 'b1', 'p1'), { id: 'p1', ürün: 'Laptop', adet: 3 });
        await setDoc(item(db, LIVE, 'requests', 'r1'), { id: 'r1', ürün: 'Mouse', adet: 1, durum: 'Beklemede', personel: 'Ali' });
        await setDoc(item(db, LIVE, 'purchaseOrders', 'po1'), { id: 'po1', urun: 'Toner', durum: 'Beklemede' });
        await setDoc(item(db, LIVE, 'tasks', 't1'), { id: 't1', title: 'Görev', priority: 'medium' });
        await setDoc(item(db, LIVE, 'personel', 'u1'), { id: 'u1', name: 'Ali' });
        await setDoc(item(db, LIVE, 'system_config', 'admin_settings'), { maintenance: false });
        await setDoc(item(db, DEMO, 'requests', 'rtest'), { id: 'rtest', ürün: 'X __flowtest__', durum: 'Beklemede' });
        await setDoc(item(db, DEMO, 'requests', 'rreal'), { id: 'rreal', ürün: 'Gerçek demo kaydı', durum: 'Beklemede' });
        await setDoc(item(db, LIVE, 'requests', 'rlivetest'), { id: 'rlivetest', ürün: 'X __flowtest__', durum: 'Beklemede' });
        await setDoc(doc(db, 'inventory_v2', 'b1', 'items', 'old1'), { id: 'old1', ürün: 'Eski' });
        await setDoc(doc(db, 'inventory', 'b1'), { legacy: true });
        await setDoc(doc(db, 'system_config', 'legacy'), { maintenance: false });
        await setDoc(item(db, LIVE, 'auditLogs', 'a1'), { id: 'a1', result: 'blocked' });
    });
});

describe('Kökler ve okuma', () => {
    test('anonim personel canlı kökte b1 okur', () => assertSucceeds(getDoc(item(ctx.anon(), LIVE, 'b1', 'p1'))));
    test('oturumsuz ziyaretçi okuyamaz', () => assertFails(getDoc(item(ctx.none(), LIVE, 'b1', 'p1'))));
    test('admin canlı kökte okur', () => assertSucceeds(getDoc(item(ctx.admin(), LIVE, 'b1', 'p1'))));
    test('tanımsız kök reddedilir (admin dahil)', () => assertFails(getDoc(item(ctx.admin(), 'rogue_root', 'b1', 'p1'))));
    test('bilinmeyen koleksiyon reddedilir', () => assertFails(getDoc(item(ctx.anon(), LIVE, 'secretCol', 'x'))));
    test('V1 arşivi admin için de kapalı', () => assertFails(getDoc(doc(ctx.admin(), 'inventory', 'b1'))));
    test('KJ-2: inventory_v2 anonim okuyamaz', () => assertFails(getDoc(doc(ctx.anon(), 'inventory_v2', 'b1', 'items', 'old1'))));
    test('KJ-2: inventory_v2 admin okur', () => assertSucceeds(getDoc(doc(ctx.admin(), 'inventory_v2', 'b1', 'items', 'old1'))));
    test('KJ-2: inventory_v2 admin yazar', () => assertSucceeds(setDoc(doc(ctx.admin(), 'inventory_v2', 'b1', 'items', 'old2'), { id: 'old2' })));
    test('kök system_config bloğu kaldırıldı (anonim okuyamaz)', () => assertFails(getDoc(doc(ctx.anon(), 'system_config', 'legacy'))));
});

describe('Admin kimliği', () => {
    test('admin b1 yazar', () => assertSucceeds(setDoc(item(ctx.admin(), LIVE, 'b1', 'p2'), { id: 'p2', ürün: 'Yeni' })));
    test('başka e-postalı hesap b1 yazamaz', () => assertFails(setDoc(item(ctx.otherUser(), LIVE, 'b1', 'p2'), { id: 'p2' })));
    test('anonim sağlayıcıyla admin e-postası iddiası b1 yazamaz', () => assertFails(setDoc(item(ctx.forgedAnon(), LIVE, 'b1', 'p2'), { id: 'p2' })));
});

describe('Personel yazma yetkisi (Ek D · Aşama A)', () => {
    for (const col of ['b1', 'b2', 'b3', 'personel', 'units', 'locations', 'productTypes', 'workflowTemplates', 'staff', 'system_config']) {
        test(`anonim ${col} yazamaz`, () => assertFails(setDoc(item(ctx.anon(), LIVE, col, 'z1'), { id: 'z1' })));
    }
    test('T7: anonim assignments yazamaz', () => assertFails(setDoc(item(ctx.anon(), LIVE, 'assignments', 'as1'), { id: 'as1', sn: 'SN1' })));
    test('T7: anonim serviceRecords yazamaz', () => assertFails(setDoc(item(ctx.anon(), LIVE, 'serviceRecords', 'sr1'), { id: 'sr1' })));
    test('anonim iş akışı şablonlarını okur (Ek D: personel okuma)', () => assertSucceeds(getDoc(item(ctx.anon(), LIVE, 'workflowTemplates', 'w1'))));
    test('anonim personel kaydını güncelleyemez', () => assertFails(updateDoc(item(ctx.anon(), LIVE, 'personel', 'u1'), { name: 'X' })));
    test('anonim görev güncellemesinde etiket reddedilir', () => assertFails(updateDoc(item(ctx.anon(), LIVE, 'tasks', 't1'), { title: XSS })));
    test('admin assignments yazar',() => assertSucceeds(setDoc(item(ctx.admin(), LIVE, 'assignments', 'as1'), { id: 'as1' })));
    test('anonim talep oluşturur', () => assertSucceeds(setDoc(item(ctx.anon(), LIVE, 'requests', 'r2'), { id: 'r2', ürün: 'Klavye', adet: 1, durum: 'Beklemede' })));
    test('anonim talep günceller (geri çek)', () => assertSucceeds(updateDoc(item(ctx.anon(), LIVE, 'requests', 'r1'), { durum: 'draft' })));
    test('anonim görev oluşturur', () => assertSucceeds(setDoc(item(ctx.anon(), LIVE, 'tasks', 't2'), { id: 't2', title: 'Yeni görev', priority: 'high' })));
    test('anonim satın alma talebi oluşturur', () => assertSucceeds(setDoc(item(ctx.anon(), LIVE, 'purchaseOrders', 'po2'), { id: 'po2', urun: 'Kağıt', aciklama: 'A4' })));
});

describe('Silme', () => {
    test('anonim talep silemez', () => assertFails(deleteDoc(item(ctx.anon(), LIVE, 'requests', 'r1'))));
    test('anonim satın alma silemez', () => assertFails(deleteDoc(item(ctx.anon(), LIVE, 'purchaseOrders', 'po1'))));
    test('anonim görev siler', () => assertSucceeds(deleteDoc(item(ctx.anon(), LIVE, 'tasks', 't1'))));
    test('admin talep siler', () => assertSucceeds(deleteDoc(item(ctx.admin(), LIVE, 'requests', 'r1'))));
    test('KJ-5: demo kökünde __flowtest__ işaretli talep silinir', () => assertSucceeds(deleteDoc(item(ctx.anon(), DEMO, 'requests', 'rtest'))));
    test('KJ-5: demo kökünde işaretsiz talep silinemez', () => assertFails(deleteDoc(item(ctx.anon(), DEMO, 'requests', 'rreal'))));
    test('KJ-5: istisna canlı kökte geçerli değil', () => assertFails(deleteDoc(item(ctx.anon(), LIVE, 'requests', 'rlivetest'))));
    test('KJ-5: demo satın alma, işaret açıklamada → silinir', async () => {
        await seed(db => setDoc(item(db, DEMO, 'purchaseOrders', 'potest'), { id: 'potest', urun: 'Toner', aciklama: 'x __flowtest__' }));
        await assertSucceeds(deleteDoc(item(ctx.anon(), DEMO, 'purchaseOrders', 'potest')));
    });
    test('KJ-5: işaret sayısal alanda olsa da hata vermez, silinmez', async () => {
        await seed(db => setDoc(item(db, DEMO, 'requests', 'rnum'), { id: 'rnum', ürün: 42, adet: 1 }));
        await assertFails(deleteDoc(item(ctx.anon(), DEMO, 'requests', 'rnum')));
    });
});

describe('Bakım modu (RULE-05)', () => {
    test('bakımda anonim talep oluşturamaz', async () => {
        await setMaintenance(true);
        await assertFails(setDoc(item(ctx.anon(), LIVE, 'requests', 'r3'), { id: 'r3', ürün: 'X' }));
    });
    test('bakımda anonim görev silemez', async () => {
        await setMaintenance(true);
        await assertFails(deleteDoc(item(ctx.anon(), LIVE, 'tasks', 't1')));
    });
    test('bakımda admin yazar', async () => {
        await setMaintenance(true);
        await assertSucceeds(setDoc(item(ctx.admin(), LIVE, 'b1', 'p3'), { id: 'p3' }));
    });
    test('bakım başka kökte açıkken canlı kökte personel yazar', async () => {
        await setMaintenance(true, DEMO);
        await assertSucceeds(setDoc(item(ctx.anon(), LIVE, 'requests', 'r4'), { id: 'r4', ürün: 'X' }));
    });
    test('system_config: anonim okur, admin yazar', async () => {
        await assertSucceeds(getDoc(item(ctx.anon(), LIVE, 'system_config', 'admin_settings')));
        await assertSucceeds(setDoc(item(ctx.admin(), LIVE, 'system_config', 'admin_settings'), { maintenance: true }));
    });
});

describe('Etiket reddi (RULE-02 savunma derinliği)', () => {
    const cases = [
        ['requests', { ürün: XSS }], ['requests', { not: '</script>' }], ['requests', { personel: '<svg onload=1>' }],
        ['requests', { id: '"><img src=x>' }],
        ['tasks', { title: XSS }], ['tasks', { description: '<iframe>' }], ['tasks', { priority: '<b>x</b>' }],
        ['purchaseOrders', { urun: XSS }], ['purchaseOrders', { aciklama: '<!-- x -->' }], ['purchaseOrders', { createdByName: '<a href=x>' }],
    ];
    for (const [col, fields] of cases) {
        test(`${col} ${Object.keys(fields)[0]} alanında etiket reddedilir`, () =>
            assertFails(setDoc(item(ctx.anon(), LIVE, col, 'xss1'), { ...fields, id: fields.id ?? 'xss1' })));
    }
    test('"<5mm" ve "a < b" serbest', () =>
        assertSucceeds(setDoc(item(ctx.anon(), LIVE, 'requests', 'lt1'), { id: 'lt1', ürün: '<5mm vida', not: 'adet a < b' })));
    test('admin yazmaları etiket kuralına tabi değil (kaçış istemcide)', () =>
        assertSucceeds(setDoc(item(ctx.admin(), LIVE, 'requests', 'adm1'), { id: 'adm1', not: '<b>admin</b>' })));
});

describe('Denetim günlüğü (4.7 · KJ-7)', () => {
    const valid = (uid = 'anon-uid') => ({
        id: 'L1', type: 'Satın Alma Onayı', refCol: 'purchaseOrders', refId: 'po1', item: 'Toner', qty: 1,
        actorName: 'Ali', actorPersonelId: 'u1', uid, authKind: 'anonymous', result: 'blocked', reason: 'self-approval',
        page: 'index', ts: serverTimestamp(),
    });
    test('anonim geçerli kayıt ekler', () => assertSucceeds(setDoc(item(ctx.anon(), LIVE, 'auditLogs', 'L1'), valid())));
    test('fazladan alan reddedilir', () => assertFails(setDoc(item(ctx.anon(), LIVE, 'auditLogs', 'L1'), { ...valid(), extra: 1 })));
    test('istemci saati reddedilir', () => assertFails(setDoc(item(ctx.anon(), LIVE, 'auditLogs', 'L1'), { ...valid(), ts: new Date() })));
    test('başkası adına uid reddedilir', () => assertFails(setDoc(item(ctx.anon(), LIVE, 'auditLogs', 'L1'), valid('someone-else'))));
    test('geçersiz sonuç reddedilir', () => assertFails(setDoc(item(ctx.anon(), LIVE, 'auditLogs', 'L1'), { ...valid(), result: 'hacked' })));
    test('etiketli metin reddedilir', () => assertFails(setDoc(item(ctx.anon(), LIVE, 'auditLogs', 'L1'), { ...valid(), item: XSS })));
    test('oturumsuz ekleyemez', () => assertFails(setDoc(item(ctx.none(), LIVE, 'auditLogs', 'L1'), valid())));
    test('anonim okuyamaz', () => assertFails(getDoc(item(ctx.anon(), LIVE, 'auditLogs', 'a1'))));
    test('admin okur', () => assertSucceeds(getDoc(item(ctx.admin(), LIVE, 'auditLogs', 'a1'))));
    test('admin güncelleyemez', () => assertFails(updateDoc(item(ctx.admin(), LIVE, 'auditLogs', 'a1'), { result: 'approved' })));
    test('admin silemez', () => assertFails(deleteDoc(item(ctx.admin(), LIVE, 'auditLogs', 'a1'))));
});
