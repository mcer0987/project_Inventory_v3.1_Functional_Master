// [WHY]: v3.8 UX-5 — Marka ayarı ({root}/system_config/items/brand_settings) tüm üyelerce okunur; yalnız yönetici, kapalı şemaya
//        (7 alan, amblem/efekt beyaz listesi, ≤32 / ≤40 etiketsiz metin, özel logo = ≤45000 karakterlik png/jpeg/webp data URI
//        ya da '', sunucu saati, yazanın uid'i) uygun yazar. Genel system_config yazma davranışı (admin_settings vb.) değişmemeli.
// [HOW]: `npm run test:rules` → firebase emulators:exec içinde node:test. Yazımlar src/services/brand-settings-service.js ile aynı
//        biçimde: setDoc(tüm belge) + serverTimestamp() + updatedBy = auth uid. Birim tarafı: tests/unit/brand-settings.test.mjs.
import { test, before, after, beforeEach, describe } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, deleteDoc, serverTimestamp, setLogLevel } from 'firebase/firestore';

setLogLevel('silent');

const LIVE = 'lifeserver_master';
const DEMO = 'inventory_demo';
const ADMIN_UID = 'admin-uid';
const nowSec = () => Math.floor(Date.now() / 1000);

let env;
const ctx = {
    admin: () => env.authenticatedContext(ADMIN_UID, { email: 'admin@medipol.local', firebase: { sign_in_provider: 'password' }, auth_time: nowSec() }).firestore(),
    staff: () => env.authenticatedContext('uid-s1', { email: 'ayse.yilmaz@staff.medipol.local', firebase: { sign_in_provider: 'password' }, auth_time: nowSec() }).firestore(),
    outsider: () => env.authenticatedContext('uid-yabanci', { email: 'yabanci@example.com', firebase: { sign_in_provider: 'password' }, auth_time: nowSec() }).firestore(),
    anon: () => env.unauthenticatedContext().firestore(),
};
const brand = (db, root = LIVE) => doc(db, root, 'system_config', 'items', 'brand_settings');
const seed = fn => env.withSecurityRulesDisabled(async c => fn(c.firestore()));

// Özel logo örnekleri (yalnız desen ve uzunluk sınanır; gerçek piksel verisi gerekmez)
const PNG_URI = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const WEBP_URI = 'data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==';
const JPEG_URI = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////';
const uriOfLength = n => 'data:image/webp;base64,'.padEnd(n, 'A'); // tam n karakter

/** İstemci servisiyle aynı belge; o ile alan bazında bozulabilir (undefined → alan silinir). */
const payload = (o = {}) => {
    const d = {
        emblemId: 'shield', title: 'MEDİPOL', subtitle: 'Envanter Takip', effect: 'glow', customLogo: '',
        updatedAt: serverTimestamp(), updatedBy: ADMIN_UID, ...o,
    };
    for (const k of Object.keys(d)) if (d[k] === undefined) delete d[k];
    return d;
};
const write = (o, root = LIVE, db = ctx.admin()) => setDoc(brand(db, root), payload(o));

before(async () => {
    env = await initializeTestEnvironment({ projectId: 'demo-brand-settings', firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
});
after(async () => { if (env) await env.cleanup(); });

beforeEach(async () => {
    await env.clearFirestore();
    await seed(async db => {
        for (const root of [LIVE, DEMO]) {
            await setDoc(doc(db, root, 'personel', 'items', 's1'), { id: 's1', name: 'Ayşe Yılmaz', pri: 'ayse.yilmaz', uid: 'uid-s1', authEmail: 'ayse.yilmaz@staff.medipol.local', active: true });
            await setDoc(doc(db, root, 'staffAccounts', 'items', 'uid-s1'), { personelId: 's1', pri: 'ayse.yilmaz', linkedAt: 1 });
            await setDoc(doc(db, root, 'accessGate', 'items', 'staff'), { staffAccessEnabled: true });
            await setDoc(doc(db, root, 'system_config', 'items', 'admin_settings'), { maintenance: false });
        }
    });
});

describe('UX-5 · okuma: üye okur, yabancı ve oturumsuz okuyamaz', () => {
    test('belge yokken bile üye okur (boş) → ✓; yönetici okur → ✓', async () => {
        await assertSucceeds(getDoc(brand(ctx.staff())));
        await assertSucceeds(getDoc(brand(ctx.admin())));
    });
    test('yazılmış belgeyi personel okur → ✓', async () => {
        await assertSucceeds(write());
        const snap = await assertSucceeds(getDoc(brand(ctx.staff())));
        if (snap.data().title !== 'MEDİPOL') throw new Error('personel belgeyi göremedi');
    });
    test('personele bağlı olmayan oturum ve oturumsuz ziyaretçi → ✗', async () => {
        await assertFails(getDoc(brand(ctx.outsider())));
        await assertFails(getDoc(brand(ctx.anon())));
    });
    test('geçersiz kök → ✗', async () => {
        await assertFails(getDoc(brand(ctx.admin(), 'gecersiz_kok')));
        await assertFails(getDoc(brand(ctx.staff(), 'inventory_v2')));
    });
});

describe('UX-5 · yazma: yalnız yönetici', () => {
    test('yönetici şemaya uygun belgeyi yazar (canlı ve demo kök) → ✓', async () => {
        await assertSucceeds(write());
        await assertSucceeds(write({}, DEMO));
    });
    test('personel, yabancı ve oturumsuz yazamaz → ✗', async () => {
        await assertFails(write({ updatedBy: 'uid-s1' }, LIVE, ctx.staff()));
        await assertFails(write({ updatedBy: 'uid-yabanci' }, LIVE, ctx.outsider()));
        await assertFails(write({ updatedBy: 'x' }, LIVE, ctx.anon()));
    });
    test('geçersiz kök → ✗', async () => {
        await assertFails(write({}, 'gecersiz_kok'));
        await assertFails(write({ updatedBy: 'uid-s1' }, 'inventory_v2', ctx.staff()));
    });
    test('dört amblem ve dört efektin tümü geçer → ✓', async () => {
        for (const emblemId of ['cube', 'shield', 'crest', 'pulse-node']) await assertSucceeds(write({ emblemId }));
        for (const effect of ['shimmer', 'glow', 'pulse', 'none']) await assertSucceeds(write({ effect }));
    });
    test('mevcut belge yönetici tarafından güncellenir → ✓; geçersiz güncelleme reddedilir → ✗', async () => {
        await assertSucceeds(write());
        await assertSucceeds(write({ title: 'YENİ BAŞLIK', effect: 'pulse' }));
        await assertFails(write({ effect: 'spin' }));
        let kept; await seed(async db => { kept = (await getDoc(brand(db))).data(); });
        if (kept.title !== 'YENİ BAŞLIK' || kept.effect !== 'pulse') throw new Error('reddedilen yazma belgeyi bozdu');
    });
});

describe('UX-5 · şema sıkılığı (hasOnly / beyaz liste / uzunluk / noTag)', () => {
    test('fazladan alan (özel logo URL\'si, ham SVG) → ✗', async () => {
        await assertFails(write({ logoUrl: 'https://ornek.com/logo.png' }));
        await assertFails(write({ svg: '<svg onload=alert(1)>' }));
        await assertFails(write({ customEmblem: 'data:image/png;base64,AAAA' }));
    });
    test('eksik alan → ✗ (her biri tek tek; eski 6 alanlı belge de artık yazılamaz)', async () => {
        for (const k of ['emblemId', 'title', 'subtitle', 'effect', 'customLogo', 'updatedAt', 'updatedBy']) await assertFails(write({ [k]: undefined }));
    });
    test('amblem ve efekt beyaz listesi dışı → ✗', async () => {
        await assertFails(write({ emblemId: 'star' }));
        await assertFails(write({ emblemId: '' }));
        await assertFails(write({ emblemId: 7 }));
        await assertFails(write({ effect: 'spin' }));
        await assertFails(write({ effect: 'GLOW' }));
    });
    test('başlık: boş ✗ · 32 ✓ · 33 ✗ · dize değil ✗', async () => {
        await assertFails(write({ title: '' }));
        await assertSucceeds(write({ title: 'x'.repeat(32) }));
        await assertFails(write({ title: 'x'.repeat(33) }));
        await assertFails(write({ title: 123 }));
    });
    test('alt başlık: boş ✓ · 40 ✓ · 41 ✗ · dize değil ✗', async () => {
        await assertSucceeds(write({ subtitle: '' }));
        await assertSucceeds(write({ subtitle: 'x'.repeat(40) }));
        await assertFails(write({ subtitle: 'x'.repeat(41) }));
        await assertFails(write({ subtitle: ['a'] }));
    });
    test('etiket benzeri metin (noTag) → ✗; "a < b" ve "<5mm" serbest → ✓', async () => {
        await assertFails(write({ title: '<script>alert(1)</script>' }));
        await assertFails(write({ title: 'Merhaba <b>dünya</b>' }));
        await assertFails(write({ subtitle: '<img src=x onerror=1>' }));
        await assertFails(write({ subtitle: 'son </div>' }));
        await assertSucceeds(write({ title: 'a < b' }));
        await assertSucceeds(write({ subtitle: '<5mm' }));
    });
    test('özel logo: geçerli PNG / WebP / JPEG data URI → ✓; boş "" (özel logo yok) → ✓', async () => {
        await assertSucceeds(write({ customLogo: PNG_URI }));
        await assertSucceeds(write({ customLogo: WEBP_URI }));
        await assertSucceeds(write({ customLogo: JPEG_URI }));
        await assertSucceeds(write({ customLogo: '' }));
        await assertSucceeds(write({ customLogo: PNG_URI }, DEMO));
    });
    test('özel logo: svg+xml, http(s), javascript:, gif, html → ✗', async () => {
        await assertFails(write({ customLogo: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' }));
        await assertFails(write({ customLogo: 'data:image/svg+xml;utf8,<svg onload=alert(1)>' }));
        await assertFails(write({ customLogo: 'https://ornek.com/logo.png' }));
        await assertFails(write({ customLogo: 'http://ornek.com/logo.png' }));
        await assertFails(write({ customLogo: 'javascript:alert(1)' }));
        await assertFails(write({ customLogo: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' }));
        await assertFails(write({ customLogo: 'data:text/html;base64,PHNjcmlwdD4=' }));
    });
    test('özel logo: boş yük, desen dışı karakter (etiket, tırnak, boşluk, satır sonu), büyük harfli şema, dize değil → ✗', async () => {
        await assertFails(write({ customLogo: 'data:image/png;base64,' }));
        await assertFails(write({ customLogo: 'data:image/png;charset=utf-8;base64,AAAA' }));
        await assertFails(write({ customLogo: `${PNG_URI}<img src=x onerror=1>` }));
        await assertFails(write({ customLogo: `${PNG_URI}"onerror="x` }));
        await assertFails(write({ customLogo: `${PNG_URI} ` }));
        await assertFails(write({ customLogo: `${PNG_URI}\nAAAA` }));
        await assertFails(write({ customLogo: 'DATA:image/png;base64,AAAA' }));
        await assertFails(write({ customLogo: 'iVBORw0KGgo=' }));
        await assertFails(write({ customLogo: 123 }));
        await assertFails(write({ customLogo: null }));
        await assertFails(write({ customLogo: ['data:image/png;base64,AAAA'] }));
    });
    test('özel logo boyut sınırı: 45000 karakter → ✓ (RE2 matches sınırı), 45001 → ✗', async () => {
        await assertSucceeds(write({ customLogo: uriOfLength(45000) }));
        await assertFails(write({ customLogo: uriOfLength(45001) }));
        await assertFails(write({ customLogo: uriOfLength(90000) }));
    });
    test('özel logo: yönetici ekler ve kaldırır ("" → yerleşik amblem); personel yazamaz, ama okuyabilir', async () => {
        await assertSucceeds(write({ customLogo: PNG_URI }));
        const snap = await assertSucceeds(getDoc(brand(ctx.staff())));
        if (snap.data().customLogo !== PNG_URI) throw new Error('personel özel logoyu göremedi');
        await assertFails(write({ customLogo: WEBP_URI, updatedBy: 'uid-s1' }, LIVE, ctx.staff()));
        await assertSucceeds(write({ customLogo: '' }));
        let kept; await seed(async db => { kept = (await getDoc(brand(db))).data(); });
        if (kept.customLogo !== '' || kept.emblemId !== 'shield') throw new Error('logo kaldırma belgeyi yanlış yazdı');
    });
    test('updatedAt sunucu saati olmak zorunda (istemci tarihi ✗); updatedBy yazanın uid\'i (başkası adına ✗)', async () => {
        await assertFails(write({ updatedAt: new Date() }));
        await assertFails(write({ updatedAt: 1735689600000 }));
        await assertFails(write({ updatedBy: 'uid-s1' }));
        await assertFails(write({ updatedBy: 42 }));
        await assertFails(write({ updatedBy: '' }));
    });
});

describe('UX-5 · sıfırla (silme) ve komşu belgeler', () => {
    test('yönetici belgeyi siler (Sıfırla) → ✓; personel silemez → ✗', async () => {
        await assertSucceeds(write());
        await assertFails(deleteDoc(brand(ctx.staff())));
        await assertFails(deleteDoc(brand(ctx.anon())));
        await assertSucceeds(deleteDoc(brand(ctx.admin())));
        let gone; await seed(async db => { gone = (await getDoc(brand(db))).exists(); });
        if (gone) throw new Error('belge silinmedi');
    });
    test('diğer system_config belgeleri etkilenmez: yönetici yazar ✓, personel yazamaz ✗', async () => {
        const settings = (db, o) => setDoc(doc(db, LIVE, 'system_config', 'items', 'admin_settings'), { maintenance: false, ...o });
        await assertSucceeds(settings(ctx.admin(), { note: 'ok' }));
        await assertFails(settings(ctx.staff(), { note: 'olmaz' }));
        await assertSucceeds(setDoc(doc(ctx.admin(), LIVE, 'system_config', 'items', 'brand_settings_yedek'), { ok: true }));
    });
});
