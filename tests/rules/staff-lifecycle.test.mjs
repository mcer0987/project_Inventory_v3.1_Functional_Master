// [WHY]: v3.8 · VP-3 — Personel Hesap Yaşam Döngüsü Firestore Security Rules kanıtları.
//        1) passwordResetRequests: 24 saat oran sınırı (23s 59dk → RED, 24s 05sn → KABUL), anonim/yabancı okuma engeli, silme engeli.
//        2) Hesap askıya alma / yeniden aktifleştirme: personel.active ↔ staffAccounts.status atomik senkron, auditLogs zorunluluğu,
//           İP-7 K1 koruması (ek yönetici adminGranted hesaba dokunamaz), askıdaki hesabın okuma/yazma reddi, deleteDoc yasağı.
//        3) Geçici PIN (mustChangeCode + tempPinExpiresAt): süre ≤24s tavanı, veri erişim kilidi, süresi içinde self-clear KABUL,
//           süresi dolduktan sonra self-clear RED, yetki/durum kurcalama RED.
//        4) Mevcut adminGrantWriteOk ile tam uyumluluk.
// [HOW]: `npm run test:rules` → firebase emulators:exec içinde node:test.
import { test, before, after, beforeEach, describe } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import {
    doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
    serverTimestamp, Timestamp, writeBatch, collection, setLogLevel
} from 'firebase/firestore';

setLogLevel('silent');

const LIVE = 'lifeserver_master';
const ADMIN_EMAIL = 'admin@medipol.local';
const ADMIN_UID = 'admin-uid';
const nowSec = () => Math.floor(Date.now() / 1000);

let env;
const anonCtx = () => env.unauthenticatedContext().firestore();
const adminCtx = (authTime = nowSec()) => env.authenticatedContext(ADMIN_UID, {
    email: ADMIN_EMAIL, firebase: { sign_in_provider: 'password' }, auth_time: authTime,
}).firestore();
const staffCtx = (uid, pri) => env.authenticatedContext(uid, {
    email: `${pri}@staff.medipol.local`, firebase: { sign_in_provider: 'password' }, auth_time: nowSec(),
}).firestore();

const ctx = {
    anon: () => anonCtx(),
    admin: () => adminCtx(),
    granted: () => staffCtx('uid-g', 'mehmet.cer'),
    s1: () => staffCtx('uid-s1', 'ayse.yilmaz'),
    s2: () => staffCtx('uid-s2', 'bora.kaya'),
};

const item = (db, root, col, id) => doc(db, root, col, 'items', String(id));
async function seed(fn) { await env.withSecurityRulesDisabled(async c => fn(c.firestore())); }

let seq = 0;
const newAuditId = p => `al_vp3_${p}_${Date.now()}_${++seq}`;

before(async () => {
    env = await initializeTestEnvironment({
        projectId: 'demo-vp3-staff-lifecycle',
        firestore: { rules: readFileSync('firestore.rules', 'utf8') },
    });
});
after(async () => { if (env) await env.cleanup(); });

beforeEach(async () => {
    await env.clearFirestore();
    await seed(async db => {
        await setDoc(item(db, LIVE, 'accessGate', 'staff'), { staffAccessEnabled: true, version: 1 });
        await setDoc(item(db, LIVE, 'b1', 'item-1'), { id: 'item-1', name: 'Yazıcı', adet: 2, raf: 'A1' });

        await setDoc(item(db, LIVE, 'personel', 'pg'), {
            id: 'pg', name: 'Mehmet Cer', pri: 'mehmet.cer', uid: 'uid-g', authEmail: 'mehmet.cer@staff.medipol.local', active: true,
        });
        await setDoc(item(db, LIVE, 'staffAccounts', 'uid-g'), {
            personelId: 'pg', pri: 'mehmet.cer', linkedAt: 1, adminGranted: true,
        });

        await setDoc(item(db, LIVE, 'personel', 'ps1'), {
            id: 'ps1', name: 'Ayşe Yılmaz', pri: 'ayse.yilmaz', uid: 'uid-s1', authEmail: 'ayse.yilmaz@staff.medipol.local', active: true,
        });
        await setDoc(item(db, LIVE, 'staffAccounts', 'uid-s1'), {
            personelId: 'ps1', pri: 'ayse.yilmaz', linkedAt: 1,
        });

        await setDoc(item(db, LIVE, 'personel', 'ps2'), {
            id: 'ps2', name: 'Bora Kaya', pri: 'bora.kaya', uid: 'uid-s2', authEmail: 'bora.kaya@staff.medipol.local', active: true,
        });
        await setDoc(item(db, LIVE, 'staffAccounts', 'uid-s2'), {
            personelId: 'ps2', pri: 'bora.kaya', linkedAt: 1,
        });
    });
});

describe('VP-3 · passwordResetRequests (24 saat oran sınırı & zero-enumeration)', () => {
    test('oturumsuz ilk talep KABUL; anonim ve sıradan personel okuması RED; yönetici okuması KABUL', async () => {
        const refAnon = item(ctx.anon(), LIVE, 'passwordResetRequests', 'ayse.yilmaz');
        await assertSucceeds(setDoc(refAnon, {
            pri: 'ayse.yilmaz',
            note: 'Giriş kodumu unuttum',
            status: 'pending',
            requestedAt: serverTimestamp(),
        }));

        await assertFails(getDoc(refAnon));
        await assertFails(getDocs(collection(ctx.anon(), LIVE, 'passwordResetRequests', 'items')));
        await assertFails(getDoc(item(ctx.s1(), LIVE, 'passwordResetRequests', 'ayse.yilmaz')));
        await assertFails(getDocs(collection(ctx.s1(), LIVE, 'passwordResetRequests', 'items')));

        await assertSucceeds(getDoc(item(ctx.admin(), LIVE, 'passwordResetRequests', 'ayse.yilmaz')));
        await assertSucceeds(getDoc(item(ctx.granted(), LIVE, 'passwordResetRequests', 'ayse.yilmaz')));
    });

    test('24 saat oran sınırı: 23s 59dk → RED, 24s 05sn → KABUL', async () => {
        const ms23h59m = (23 * 3600 + 59 * 60) * 1000;
        const ms24h05s = (24 * 3600 + 5) * 1000;

        await seed(async db => {
            await setDoc(item(db, LIVE, 'passwordResetRequests', 'ayse.yilmaz'), {
                pri: 'ayse.yilmaz', note: 'İlk talep', status: 'pending',
                requestedAt: Timestamp.fromMillis(Date.now() - ms23h59m),
            });
            await setDoc(item(db, LIVE, 'passwordResetRequests', 'bora.kaya'), {
                pri: 'bora.kaya', note: 'Eski talep', status: 'resolved',
                requestedAt: Timestamp.fromMillis(Date.now() - ms24h05s),
                resolvedAt: Timestamp.fromMillis(Date.now() - ms23h59m),
                resolvedBy: ADMIN_UID,
                resolutionNote: 'Önceki çözüldü',
            });
        });

        await assertFails(setDoc(item(ctx.anon(), LIVE, 'passwordResetRequests', 'ayse.yilmaz'), {
            pri: 'ayse.yilmaz', note: 'Tekrar deneme', status: 'pending', requestedAt: serverTimestamp(),
        }));

        await assertSucceeds(setDoc(item(ctx.anon(), LIVE, 'passwordResetRequests', 'bora.kaya'), {
            pri: 'bora.kaya', note: '24 saat sonrası yeni talep', status: 'pending', requestedAt: serverTimestamp(),
        }));
    });

    test('sahte zaman damgası, HTML etiketi, fazla alan ve silme (admin dahil) RED; admin çözümü KABUL', async () => {
        await assertFails(setDoc(item(ctx.anon(), LIVE, 'passwordResetRequests', 'ayse.yilmaz'), {
            pri: 'ayse.yilmaz', note: '<script>x</script>', status: 'pending', requestedAt: serverTimestamp(),
        }));
        await assertFails(setDoc(item(ctx.anon(), LIVE, 'passwordResetRequests', 'ayse.yilmaz'), {
            pri: 'ayse.yilmaz', note: 'sahte zaman', status: 'pending', requestedAt: Timestamp.fromMillis(1000),
        }));

        const reqTs = Timestamp.fromMillis(Date.now() - 60_000);
        await seed(async db => {
            await setDoc(item(db, LIVE, 'passwordResetRequests', 'ayse.yilmaz'), {
                pri: 'ayse.yilmaz', note: 'Unuttum', status: 'pending', requestedAt: reqTs,
            });
        });

        // Yönetici requestedAt'ı koruyarak çözebilir
        await assertSucceeds(setDoc(item(ctx.admin(), LIVE, 'passwordResetRequests', 'ayse.yilmaz'), {
            pri: 'ayse.yilmaz', note: 'Unuttum', status: 'resolved', requestedAt: reqTs,
            resolvedAt: serverTimestamp(), resolvedBy: ADMIN_UID, resolutionNote: 'Geçici PIN verildi',
        }));

        // Yönetici dahil kimse silemez (24 saat ankrajı korunur)
        await assertFails(deleteDoc(item(ctx.admin(), LIVE, 'passwordResetRequests', 'ayse.yilmaz')));
        await assertFails(deleteDoc(item(ctx.anon(), LIVE, 'passwordResetRequests', 'ayse.yilmaz')));
    });
});

describe('VP-3 · Hesap Askıya Alma / Yeniden Aktifleştirme & İP-7 K1 Koruması', () => {
    function suspendBatch(db, { pid, uid, actorUid, suspend = true, withPersonel = true, withAudit = true }) {
        const auditId = newAuditId(suspend ? 'susp' : 'act');
        const reason = suspend ? 'Görev değişikliği nedeniyle hesap askıya alındı' : 'Göreve dönüş sonrası hesap yeniden açıldı';
        const batch = writeBatch(db);
        if (withPersonel) batch.update(item(db, LIVE, 'personel', pid), { active: !suspend });
        batch.update(item(db, LIVE, 'staffAccounts', uid), {
            status: suspend ? 'suspended' : 'active',
            statusChangedAt: serverTimestamp(),
            statusChangedBy: actorUid,
            statusReason: reason,
            statusAuditId: auditId,
        });
        if (withAudit) {
            batch.set(item(db, LIVE, 'auditLogs', auditId), {
                id: auditId,
                type: suspend ? 'personel-hesabi-askiya-alindi' : 'personel-hesabi-aktiflestirildi',
                refCol: 'staffAccounts',
                refId: uid,
                item: pid,
                qty: null,
                actorName: 'Yönetici',
                actorPersonelId: null,
                uid: actorUid,
                authKind: 'admin',
                result: 'approved',
                reason,
                page: 'admin',
                ts: serverTimestamp(),
                fromValue: suspend ? 'active' : 'suspended',
                toValue: suspend ? 'suspended' : 'active',
            });
        }
        return batch.commit();
    }

    test('atomik askıya alma personelin tüm okuma/yazmalarını kapatır; yeniden aktifleştirme geri açar; deleteDoc yasaktır', async () => {
        // Başlangıçta aktif personel b1 okuyabilir
        await assertSucceeds(getDoc(item(ctx.s1(), LIVE, 'b1', 'item-1')));

        // Audit olmadan veya personel.active senkronu olmadan askıya alma RED
        await assertFails(suspendBatch(ctx.admin(), { pid: 'ps1', uid: 'uid-s1', actorUid: ADMIN_UID, withAudit: false }));
        await assertFails(suspendBatch(ctx.admin(), { pid: 'ps1', uid: 'uid-s1', actorUid: ADMIN_UID, withPersonel: false }));

        // Atomik askıya alma KABUL
        await assertSucceeds(suspendBatch(ctx.admin(), { pid: 'ps1', uid: 'uid-s1', actorUid: ADMIN_UID, suspend: true }));

        // Askıdaki personel b1 okuyamaz, tasks yazamaz
        await assertFails(getDoc(item(ctx.s1(), LIVE, 'b1', 'item-1')));
        await assertFails(setDoc(item(ctx.s1(), LIVE, 'tasks', 't1'), {
            id: 't1', title: 'Deneme', creatorUid: 'uid-s1', creatorId: 'Ayşe Yılmaz',
        }));

        // Personel silme (deleteDoc) yöneticiye de yasak
        await assertFails(deleteDoc(item(ctx.admin(), LIVE, 'personel', 'ps1')));

        // Yeniden aktifleştirme KABUL → personel yeniden okuyabilir
        await assertSucceeds(suspendBatch(ctx.admin(), { pid: 'ps1', uid: 'uid-s1', actorUid: ADMIN_UID, suspend: false }));
        await assertSucceeds(getDoc(item(ctx.s1(), LIVE, 'b1', 'item-1')));
    });

    test('İP-7 K1: ek yönetici yetkili hesabı askıya alamaz; ana yönetici alabilir', async () => {
        await assertFails(suspendBatch(ctx.granted(), { pid: 'pg', uid: 'uid-g', actorUid: 'uid-g', suspend: true }));
        await assertSucceeds(suspendBatch(ctx.admin(), { pid: 'pg', uid: 'uid-g', actorUid: ADMIN_UID, suspend: true }));
        await assertFails(setDoc(item(ctx.granted(), LIVE, 'system_config', 'probe'), { ok: true }));
    });
});

describe('VP-3 · Geçici PIN (mustChangeCode + tempPinExpiresAt) ve Öz-Temizleme', () => {
    function issueTempPinBatch(db, { uid, actorUid, ttlMs = 3600_000, auditType = 'gecici-pin-tanimlandi' }) {
        const auditId = newAuditId('pin');
        const batch = writeBatch(db);
        batch.update(item(db, LIVE, 'staffAccounts', uid), {
            mustChangeCode: true,
            tempPinExpiresAt: Timestamp.fromMillis(Date.now() + ttlMs),
            tempPinIssuedAt: serverTimestamp(),
            tempPinIssuedBy: actorUid,
            tempPinAuditId: auditId,
        });
        batch.set(item(db, LIVE, 'auditLogs', auditId), {
            id: auditId, type: auditType, refCol: 'staffAccounts', refId: uid, item: uid,
            qty: null, actorName: 'Yönetici', actorPersonelId: null, uid: actorUid, authKind: 'admin',
            result: 'approved', reason: 'Tek kullanımlık geçici PIN verildi', page: 'admin', ts: serverTimestamp(),
            fromValue: 'normal', toValue: 'gecici-pin:60dk',
        });
        return batch.commit();
    }

    test('geçici PIN veri erişimini kilitler; süresi içinde self-clear KABUL; sonrası veri erişimi açılır', async () => {
        // 24 saatten uzun TTL RED
        await assertFails(issueTempPinBatch(ctx.admin(), { uid: 'uid-s1', actorUid: ADMIN_UID, ttlMs: 25 * 3600_000 }));

        // Ek yönetici adminGranted hesaba geçici PIN veremez
        await assertFails(issueTempPinBatch(ctx.granted(), { uid: 'uid-g', actorUid: 'uid-g', ttlMs: 3600_000 }));

        // Geçerli geçici PIN (1 saat) KABUL
        await assertSucceeds(issueTempPinBatch(ctx.admin(), { uid: 'uid-s1', actorUid: ADMIN_UID, ttlMs: 3600_000 }));

        // mustChangeCode == true iken personel b1 okuyamaz ama KENDİ staffAccounts belgesini okuyabilir
        await assertFails(getDoc(item(ctx.s1(), LIVE, 'b1', 'item-1')));
        await assertSucceeds(getDoc(item(ctx.s1(), LIVE, 'staffAccounts', 'uid-s1')));

        // Başka personel (s2) s1'in kilidini temizleyemez
        await assertFails(updateDoc(item(ctx.s2(), LIVE, 'staffAccounts', 'uid-s1'), {
            mustChangeCode: false, tempPinExpiresAt: null, codeChangedAt: serverTimestamp(),
        }));

        // Personel kendi temizliğinde adminGranted eklemeye kalkarsa RED
        await assertFails(updateDoc(item(ctx.s1(), LIVE, 'staffAccounts', 'uid-s1'), {
            mustChangeCode: false, tempPinExpiresAt: null, codeChangedAt: serverTimestamp(), adminGranted: true,
        }));

        // Süresi dolmamışken kendi self-clear KABUL → ardından b1 okuması yeniden açılır
        await assertSucceeds(updateDoc(item(ctx.s1(), LIVE, 'staffAccounts', 'uid-s1'), {
            mustChangeCode: false, tempPinExpiresAt: null, codeChangedAt: serverTimestamp(),
        }));
        await assertSucceeds(getDoc(item(ctx.s1(), LIVE, 'b1', 'item-1')));
    });

    test('süresi dolmuş geçici PIN self-clear edilemez (sunucu kilidi)', async () => {
        await seed(async db => {
            await updateDoc(item(db, LIVE, 'staffAccounts', 'uid-s1'), {
                mustChangeCode: true,
                tempPinExpiresAt: Timestamp.fromMillis(Date.now() - 10_000),
            });
        });

        await assertFails(getDoc(item(ctx.s1(), LIVE, 'b1', 'item-1')));
        await assertFails(updateDoc(item(ctx.s1(), LIVE, 'staffAccounts', 'uid-s1'), {
            mustChangeCode: false, tempPinExpiresAt: null, codeChangedAt: serverTimestamp(),
        }));
    });

    test('mevcut adminGrantWriteOk uyumu: yaşam döngüsü alanlı aktif hesaba yetki verilebilir, askıdakine verilemez', async () => {
        await seed(async db => {
            await updateDoc(item(db, LIVE, 'staffAccounts', 'uid-s1'), {
                status: 'active', mustChangeCode: false, tempPinExpiresAt: null, codeChangedAt: Timestamp.now(),
            });
            await updateDoc(item(db, LIVE, 'staffAccounts', 'uid-s2'), { status: 'suspended' });
        });

        const grant = (uid) => {
            const db = ctx.admin();
            const auditId = newAuditId('grant');
            const batch = writeBatch(db);
            batch.update(item(db, LIVE, 'staffAccounts', uid), {
                adminGranted: true, adminChangedAt: serverTimestamp(), adminChangedBy: ADMIN_UID,
                adminReason: 'Yönetici yetkisi testi', adminAuditId: auditId,
            });
            batch.set(item(db, LIVE, 'auditLogs', auditId), {
                id: auditId, type: 'yonetici-yetkisi-verildi', refCol: 'staffAccounts', refId: uid,
                item: uid, qty: null, actorName: 'Yönetici', actorPersonelId: null, uid: ADMIN_UID,
                authKind: 'admin', result: 'approved', reason: 'Yönetici yetkisi testi', page: 'admin',
                ts: serverTimestamp(), fromValue: 'yok', toValue: 'yonetici',
            });
            return batch.commit();
        };

        await assertSucceeds(grant('uid-s1'));
        await assertFails(grant('uid-s2'));
    });
});
