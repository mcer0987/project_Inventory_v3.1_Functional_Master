// [WHY]: İP-7 (Aşama A) — yönetici yetkisi artık betikle yazılan claim'de değil, kuralların okuduğu staffAccounts/{uid} belgesinde.
//        Yetkiyi yalnız ana yönetici, aynı commit'teki denetim kaydı ve taze parola doğrulamasıyla verir / geri alır (K1); yetki
//        ortam köküne göre ayrıdır (K3) ve isStaff zinciriyle birlikte geçerlidir (askıya alma). Plan §"Test ve doğrulama" 1–9.
// [HOW]: `npm run test:rules` → firebase emulators:exec içinde node:test. Yazımlar istemci servisiyle (admin-grant-service.js) aynı
//        biçimde: eşleme güncellemesi + denetim kaydı TEK batch'te (kural getAfter ile aynı commit'i görür).
//        auth_time: @firebase/rules-unit-testing sahte jetonunda varsayılan auth_time = iat = 0 (1970) → bayat; taze oturum için
//        auth_time açıkça verilir. Emülatör jetondaki auth_time'ı saniye (int) olarak kurallara iletir (senaryo 8 kanıtlar).
import { test, before, after, beforeEach, describe } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, serverTimestamp, writeBatch, collection, query, where, setLogLevel } from 'firebase/firestore';

setLogLevel('silent');

const LIVE = 'lifeserver_master';
const DEMO = 'inventory_demo';
const ADMIN_EMAIL = 'admin@medipol.local';
const ADMIN_UID = 'admin-uid';
const nowSec = () => Math.floor(Date.now() / 1000);

let env;
const adminCtx = (authTime = nowSec()) => env.authenticatedContext(ADMIN_UID, {
    email: ADMIN_EMAIL, firebase: { sign_in_provider: 'password' }, auth_time: authTime,
}).firestore();
const staffCtx = (uid, pri) => env.authenticatedContext(uid, {
    email: `${pri}@staff.medipol.local`, firebase: { sign_in_provider: 'password' }, auth_time: nowSec(),
}).firestore();
const ctx = {
    admin: () => adminCtx(),
    staleAdmin: () => adminCtx(nowSec() - 11 * 60),   // 11 dk önce doğrulanmış oturum
    m: () => staffCtx('uid-m', 'mehmet.cer'),          // yetki verilecek personel
    s1: () => staffCtx('uid-s1', 'ayse.yilmaz'),       // sıradan personel
    s2: () => staffCtx('uid-s2', 'bora.kaya'),         // ikinci ek yönetici adayı
};

const item = (db, root, col, id) => doc(db, root, col, 'items', String(id));
async function seed(fn) { await env.withSecurityRulesDisabled(async c => fn(c.firestore())); }
const read = async (root, col, id) => { let v; await seed(async db => { v = (await getDoc(item(db, root, col, id))).data(); }); return v; };

let seq = 0;
const newAuditId = () => `al_ip7_${Date.now()}_${++seq}`;
const TYPES = { grant: 'yonetici-yetkisi-verildi', revoke: 'yonetici-yetkisi-geri-alindi' };

/**
 * İstemci servisiyle aynı yazım: eşleme yaması + denetim kaydı tek batch'te.
 * o: { root, granted, actorUid, auditId, reason, patch (eşlemeye ek), audit (denetime ek), noAudit, adminChangedAt }
 */
function grantWrite(db, uid, o = {}) {
    const root = o.root || LIVE;
    const granted = o.granted !== false;
    const actorUid = o.actorUid || ADMIN_UID;
    const auditId = o.auditId || newAuditId();
    const reason = o.reason || 'Bilgi işlem sorumlusu olarak atandı';
    const batch = writeBatch(db);
    batch.update(item(db, root, 'staffAccounts', uid), {
        adminGranted: granted, adminChangedAt: o.adminChangedAt || serverTimestamp(), adminChangedBy: actorUid,
        adminReason: reason, adminAuditId: auditId, ...(o.patch || {}),
    });
    if (!o.noAudit) {
        batch.set(item(db, root, 'auditLogs', auditId), {
            id: auditId, type: granted ? TYPES.grant : TYPES.revoke, refCol: 'staffAccounts', refId: uid, item: 'Mehmet Cer (mehmet.cer)',
            qty: null, actorName: 'Yönetici', actorPersonelId: null, uid: actorUid, authKind: 'admin', result: 'approved', reason,
            page: 'admin', ts: serverTimestamp(), fromValue: granted ? 'yok' : 'yonetici', toValue: granted ? 'yonetici' : 'yok',
            ...(o.audit || {}),
        });
    }
    return batch.commit();
}
const grant = (uid, o) => grantWrite(ctx.admin(), uid, o);
const adminWrite = (db, root = LIVE, id = 'ip7-probe') => setDoc(item(db, root, 'system_config', id), { ok: true });

before(async () => {
    env = await initializeTestEnvironment({ projectId: 'demo-admin-grants', firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
});
after(async () => { if (env) await env.cleanup(); });

beforeEach(async () => {
    await env.clearFirestore();
    await seed(async db => {
        for (const root of [LIVE, DEMO]) {
            const people = [
                ['pm', 'Mehmet Cer', 'mehmet.cer', 'uid-m'], ['s1', 'Ayşe Yılmaz', 'ayse.yilmaz', 'uid-s1'], ['s2', 'Bora Kaya', 'bora.kaya', 'uid-s2'],
            ];
            for (const [id, name, pri, uid] of people) {
                await setDoc(item(db, root, 'personel', id), { id, name, pri, uid, authEmail: `${pri}@staff.medipol.local`, active: true });
                await setDoc(item(db, root, 'staffAccounts', uid), { personelId: id, pri, linkedAt: 1 });
            }
            // Pasif personel ve uid'si eşlemeyle uyuşmayan kayıt (yetki verilemez)
            await setDoc(item(db, root, 'personel', 'pi'), { id: 'pi', name: 'Pasif Kişi', pri: 'pasif.kisi', uid: 'uid-i', active: false });
            await setDoc(item(db, root, 'staffAccounts', 'uid-i'), { personelId: 'pi', pri: 'pasif.kisi', linkedAt: 1 });
            await setDoc(item(db, root, 'personel', 'px'), { id: 'px', name: 'Kayık Eşleme', pri: 'kayik.esleme', uid: 'uid-baska', active: true });
            await setDoc(item(db, root, 'staffAccounts', 'uid-x'), { personelId: 'px', pri: 'kayik.esleme', linkedAt: 1 });
            await setDoc(item(db, root, 'accessGate', 'staff'), { staffAccessEnabled: true });
            await setDoc(item(db, root, 'system_config', 'admin_settings'), { maintenance: false });
            await setDoc(item(db, root, 'b1', 'p1'), { id: 'p1', ürün: 'Laptop', adet: 3 });
        }
        await setDoc(item(db, LIVE, 'auditLogs', 'al_eski'), { id: 'al_eski', type: TYPES.grant, result: 'approved' });
    });
});

describe('İP-7 · 1 — ana yönetici yetkiyi denetim kaydıyla verir', () => {
    test('aktif + PRI eşleşen personele audit\'li yetki → ✓; alanlar sunucu saati ve yazanla', async () => {
        await assertSucceeds(grant('uid-m'));
        const m = await read(LIVE, 'staffAccounts', 'uid-m');
        if (m.adminGranted !== true || m.adminChangedBy !== ADMIN_UID || m.personelId !== 'pm') throw new Error('yetki alanları yanlış');
    });
    test('denetim kaydı yok / tür yanlış / refId farklı / eski (var olan) kimlik → ✗', async () => {
        await assertFails(grant('uid-m', { noAudit: true }));
        await assertFails(grant('uid-m', { audit: { type: TYPES.revoke } }));
        await assertFails(grant('uid-m', { audit: { refId: 'uid-s1' } }));
        await assertFails(grant('uid-m', { audit: { refCol: 'personel' } }));
        await assertFails(grant('uid-m', { audit: { result: 'blocked' } }));
        await assertFails(grant('uid-m', { auditId: 'al_eski' }));
        if ((await read(LIVE, 'staffAccounts', 'uid-m')).adminGranted !== undefined) throw new Error('yarım yazım kaldı');
    });
    test('gerekçe sınırları: 4 karakter / 301 karakter / etiket → ✗', async () => {
        await assertFails(grant('uid-m', { reason: 'kısa' }));
        await assertFails(grant('uid-m', { reason: 'x'.repeat(301) }));
        await assertFails(grant('uid-m', { reason: 'Atama <img src=x onerror=1>' }));
        await assertSucceeds(grant('uid-m', { reason: 'x'.repeat(300) }));
    });
    test('başkası adına imza (adminChangedBy) → ✗', () => assertFails(grant('uid-m', { patch: { adminChangedBy: 'uid-s1' } })));
});

describe('İP-7 · 2 — yetki kök başına ayrıdır (K3)', () => {
    test('canlıda verilen yetki canlıda yönetici yazımı açar, demoda açmaz; demoda ayrıca verilince demoda da açar', async () => {
        await assertFails(adminWrite(ctx.m(), LIVE));
        await grant('uid-m', { root: LIVE });
        await assertSucceeds(adminWrite(ctx.m(), LIVE));
        await assertSucceeds(setDoc(item(ctx.m(), LIVE, 'b1', 'p2'), { id: 'p2', ürün: 'Yeni', adet: 1 }));
        await assertFails(adminWrite(ctx.m(), DEMO));
        await grant('uid-m', { root: DEMO });
        await assertSucceeds(adminWrite(ctx.m(), DEMO));
    });
    test('yetkili personel denetim günlüğünü ve tüm eşlemeleri okur (salt okunur panel)', async () => {
        await grant('uid-m');
        await assertSucceeds(getDocs(collection(ctx.m(), LIVE, 'auditLogs', 'items')));
        await assertSucceeds(getDocs(query(collection(ctx.m(), LIVE, 'staffAccounts', 'items'), where('adminGranted', '==', true))));
        await assertFails(getDocs(query(collection(ctx.s1(), LIVE, 'staffAccounts', 'items'), where('adminGranted', '==', true))));
    });
});

describe('İP-7 · 3 — ek yönetici yetki dağıtamaz (K1)', () => {
    beforeEach(() => grant('uid-m'));
    test('başka eşlemeye adminGranted:true (audit\'li) → ✗', async () => {
        await assertFails(grantWrite(ctx.m(), 'uid-s1', { actorUid: 'uid-m' }));
        await assertFails(updateDoc(item(ctx.m(), LIVE, 'staffAccounts', 'uid-s1'), { adminGranted: true }));
    });
    test('kendi eşlemesinde hiçbir değişiklik (yetki alanı ya da linkedAt) → ✗; kendi yetkisini geri alamaz', async () => {
        await assertFails(updateDoc(item(ctx.m(), LIVE, 'staffAccounts', 'uid-m'), { linkedAt: 2 }));
        await assertFails(updateDoc(item(ctx.m(), LIVE, 'staffAccounts', 'uid-m'), { adminReason: 'kendim değiştirdim' }));
        await assertFails(grantWrite(ctx.m(), 'uid-m', { granted: false, actorUid: 'uid-m' }));
    });
    test('yetki alanlı yeni eşleme (ana yönetici dahil) → ✗; yetkisiz yeni eşleme → ✓', async () => {
        await assertFails(setDoc(item(ctx.m(), LIVE, 'staffAccounts', 'uid-yeni'), { personelId: 's1', pri: 'ayse.yilmaz', adminGranted: true }));
        await assertFails(setDoc(item(ctx.admin(), LIVE, 'staffAccounts', 'uid-yeni'), { personelId: 's1', pri: 'ayse.yilmaz', adminGranted: false }));
        await assertSucceeds(setDoc(item(ctx.m(), LIVE, 'staffAccounts', 'uid-yeni'), { personelId: 's1', pri: 'ayse.yilmaz', linkedAt: 3 }));
    });
    test('yetkili eşlemeyi silme / personelId değiştirme → ✗; yetkisiz eşlemede ek yönetici yetkileri sürer', async () => {
        await assertFails(deleteDoc(item(ctx.m(), LIVE, 'staffAccounts', 'uid-m')));
        await assertFails(updateDoc(item(ctx.m(), LIVE, 'staffAccounts', 'uid-m'), { personelId: 's1' }));
        await assertSucceeds(updateDoc(item(ctx.m(), LIVE, 'staffAccounts', 'uid-s1'), { linkedAt: 9 }));
        await assertSucceeds(deleteDoc(item(ctx.m(), LIVE, 'staffAccounts', 'uid-x')));
    });
    test('ana yönetici aynı yazımda personelId / pri kaydıramaz; yetki yazmadan eşlemeyi düzeltebilir', async () => {
        await assertFails(grant('uid-m', { granted: false, patch: { personelId: 's1' } }));
        await assertFails(grant('uid-m', { granted: false, patch: { pri: 'baska.pri' } }));
        await assertSucceeds(updateDoc(item(ctx.admin(), LIVE, 'staffAccounts', 'uid-m'), { linkedAt: 7 }));
    });
});

describe('İP-7 · 4 — yetkilinin kimlik alanlarını yalnız ana yönetici değiştirir', () => {
    beforeEach(async () => { await grant('uid-m'); await grant('uid-s2'); });
    test('ek yönetici başka yöneticinin personel kaydında active:false / pri / authEmail → ✗; jobTitle → ✓', async () => {
        await assertFails(updateDoc(item(ctx.m(), LIVE, 'personel', 's2'), { active: false }));
        await assertFails(updateDoc(item(ctx.m(), LIVE, 'personel', 's2'), { pri: 'bora.kaya2' }));
        await assertFails(updateDoc(item(ctx.m(), LIVE, 'personel', 's2'), { authEmail: 'x@staff.medipol.local' }));
        await assertSucceeds(updateDoc(item(ctx.m(), LIVE, 'personel', 's2'), { jobTitle: 'Sistem Uzmanı' }));
    });
    test('ek yönetici yetkisiz personelin kaydını pasifleştirebilir; ana yönetici yetkiliyi de pasifleştirir', async () => {
        await assertSucceeds(updateDoc(item(ctx.m(), LIVE, 'personel', 's1'), { active: false }));
        await assertSucceeds(updateDoc(item(ctx.admin(), LIVE, 'personel', 's2'), { active: false }));
    });
});

describe('İP-7 · 5/6 — geri alma ve askıya alma bir sonraki istekte geçerli', () => {
    beforeEach(() => grant('uid-m'));
    test('geri alma → yönetici yazımı ✗; personel yetkileri (okuma, kendi talebi) ✓', async () => {
        await assertSucceeds(adminWrite(ctx.m()));
        await assertSucceeds(grant('uid-m', { granted: false, reason: 'Görev değişikliği' }));
        await assertFails(adminWrite(ctx.m()));
        await assertSucceeds(getDoc(item(ctx.m(), LIVE, 'b1', 'p1')));
        await assertSucceeds(setDoc(item(ctx.m(), LIVE, 'requests', 'r-m'), { id: 'r-m', ürün: 'Mouse', adet: 1, durum: 'Beklemede', personel: 'Mehmet Cer', personelId: 'pm', personelUid: 'uid-m' }));
    });
    test('geri alma yalnız "geri alındı" türlü denetim kaydıyla', async () => {
        await assertFails(grant('uid-m', { granted: false, audit: { type: TYPES.grant } }));
        await assertSucceeds(grant('uid-m', { granted: false }));
    });
    test('askı: personel pasif → yönetici yazımı ✗', async () => {
        await seed(db => updateDoc(item(db, LIVE, 'personel', 'pm'), { active: false }));
        await assertFails(adminWrite(ctx.m()));
    });
    test('askı: erişim kilidi kapalı → yönetici yazımı ✗; açılınca yetki geri gelir', async () => {
        await seed(db => setDoc(item(db, LIVE, 'accessGate', 'staff'), { staffAccessEnabled: false }));
        await assertFails(adminWrite(ctx.m()));
        await seed(db => setDoc(item(db, LIVE, 'accessGate', 'staff'), { staffAccessEnabled: true }));
        await assertSucceeds(adminWrite(ctx.m()));
    });
    test('askıdaki yetki geri alınabilir (personel pasifken de)', async () => {
        await seed(db => updateDoc(item(db, LIVE, 'personel', 'pm'), { active: false }));
        await assertSucceeds(grant('uid-m', { granted: false }));
    });
});

describe('İP-7 · 7 — uygun olmayan kişiye yetki verilemez', () => {
    test('pasif personel → ✗; personel kaydındaki uid eşlemeyle uyuşmuyor → ✗', async () => {
        await assertFails(grant('uid-i'));
        await assertFails(grant('uid-x'));
    });
    test('eşlemedeki PRI personel kaydındakinden farklı → ✗', async () => {
        await seed(db => updateDoc(item(db, LIVE, 'staffAccounts', 'uid-s1'), { pri: 'eski.pri' }));
        await assertFails(grant('uid-s1'));
    });
    test('aynı yazımda pri değişimi → ✗; adminChangedAt istemci saati → ✗', async () => {
        await assertFails(grant('uid-m', { patch: { pri: 'mehmet.cer2' } }));
        await assertFails(grant('uid-m', { adminChangedAt: new Date() }));
    });
    test('bilinmeyen ek alan / eksik yetki alanı → ✗', async () => {
        await assertFails(grant('uid-m', { patch: { rol: 'super' } }));
        const db = ctx.admin();
        const id = newAuditId();
        const batch = writeBatch(db);
        batch.update(item(db, LIVE, 'staffAccounts', 'uid-m'), { adminGranted: true, adminChangedAt: serverTimestamp(), adminChangedBy: ADMIN_UID, adminAuditId: id });
        batch.set(item(db, LIVE, 'auditLogs', id), { id, type: TYPES.grant, refCol: 'staffAccounts', refId: 'uid-m', uid: ADMIN_UID, result: 'approved', ts: serverTimestamp() });
        await assertFails(batch.commit());
    });
});

describe('İP-7 · 8 — taze parola doğrulaması (auth_time ≤ 10 dk)', () => {
    test('11 dk önce doğrulanmış ana yönetici oturumu yetki veremez ve geri alamaz; taze oturum verir', async () => {
        await assertFails(grantWrite(ctx.staleAdmin(), 'uid-m'));
        await assertSucceeds(grantWrite(adminCtx(nowSec() - 9 * 60), 'uid-m'));
        await assertFails(grantWrite(ctx.staleAdmin(), 'uid-m', { granted: false }));
    });
    test('auth_time yok (varsayılan 0 = 1970) → ✗; bayat oturum yetkisiz eşlemeyi yine düzenleyebilir', async () => {
        const noAuthTime = env.authenticatedContext(ADMIN_UID, { email: ADMIN_EMAIL, firebase: { sign_in_provider: 'password' } }).firestore();
        await assertFails(grantWrite(noAuthTime, 'uid-m'));
        await assertSucceeds(updateDoc(item(ctx.staleAdmin(), LIVE, 'staffAccounts', 'uid-s1'), { linkedAt: 5 }));
    });
});

describe('İP-7 · 9 — kişi yalnız kendi eşlemesini okur', () => {
    test('kendi eşlemesi ✓, başkasınınki ✗, liste ✗; ek yönetici herkesinkini okur', async () => {
        await assertSucceeds(getDoc(item(ctx.s1(), LIVE, 'staffAccounts', 'uid-s1')));
        await assertFails(getDoc(item(ctx.s1(), LIVE, 'staffAccounts', 'uid-m')));
        await assertFails(getDocs(collection(ctx.s1(), LIVE, 'staffAccounts', 'items')));
        await grant('uid-m');
        await assertSucceeds(getDoc(item(ctx.m(), LIVE, 'staffAccounts', 'uid-s1')));
    });
    test('kendi eşlemesini okumak erişim kilidinden bağımsız (istemci askıyı görebilsin); yazamaz', async () => {
        await seed(db => setDoc(item(db, LIVE, 'accessGate', 'staff'), { staffAccessEnabled: false }));
        await assertSucceeds(getDoc(item(ctx.s1(), LIVE, 'staffAccounts', 'uid-s1')));
        await assertFails(updateDoc(item(ctx.s1(), LIVE, 'staffAccounts', 'uid-s1'), { linkedAt: 2 }));
    });
});
