// [WHY]: v3.4 · BT ekibi (personel hesabı) sarf çıkışı. Kural açığı stok kaybı ya da demirbaşın kayıtsız çıkışı demek;
//        bu yüzden olumlu yol kadar kötü niyetli her varyasyon emülatörde denenir.
// [HOW]: Personel stok düşümünü ve b3 kaydını tek batch'te yazar (istemcide runStockOps staffExit ile aynı biçim).
import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, writeBatch, setLogLevel } from 'firebase/firestore';

setLogLevel('silent');
const LIVE = 'lifeserver_master';
let env;

const staff = (uid, pri) => () => env.authenticatedContext(uid, { email: `${pri}@staff.medipol.local`, firebase: { sign_in_provider: 'password' } }).firestore();
const s1 = staff('uid-s1', 'ayse.yilmaz');
const admin = () => env.authenticatedContext('admin-uid', { email: 'admin@medipol.local', firebase: { sign_in_provider: 'password' } }).firestore();
const item = (db, col, id) => doc(db, LIVE, col, 'items', String(id));
const seed = fn => env.withSecurityRulesDisabled(async c => fn(c.firestore()));
const read = async (col, id) => { let v; await seed(async db => { v = (await getDoc(item(db, col, id))).data(); }); return v; };

function b3Entry(id, over = {}) {
    return {
        id, sema: 2, tip: 'cikis', kaynakDepo: 'b1', productId: 'p_sarf', requestId: null, rafNo: 'A1', sutun: 'B1 -A',
        urunTuruId: 'pt_sarf', urunTuru: 'Sarf Malzeme', urunAciklama: 'Toner', marka: 'HP', adet: 2, sn: 'ITSM-123',
        envanterNo: '-', not: 'Yazıcı toneri', alanKisi: 'Ayşe Yılmaz', personelId: 's1', tarih: '05.11.2026 10:00:00',
        ts: 1793865600000, isDemirbas: false, talepTuru: null, oncelik: null, iadeTarihi: null, iadeEdildi: false,
        iadeEdildiTarihi: null, iadeDepo: null, onaylayan: null, islemYapanUid: 'uid-s1', ...over,
    };
}
// Tek ürün çıkışı: ürün yaması + b3 kaydı tek batch'te
function exitBatch(db, { col = 'b1', pid = 'p_sarf', before = 10, qty = 2, b3Id = 'x1', patch = {}, entry = {}, skipStock = false, skipB3 = false } = {}) {
    const batch = writeBatch(db);
    if (!skipStock) batch.update(item(db, col, pid), { adet: before - qty, lastUpdate: 1793865600000, sonCikisId: b3Id, ...patch });
    if (!skipB3) batch.set(item(db, 'b3', b3Id), b3Entry(b3Id, { kaynakDepo: col, productId: pid, adet: qty, ...entry }));
    return batch.commit();
}

before(async () => {
    env = await initializeTestEnvironment({ projectId: 'demo-staff-exit', firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
});
after(async () => env?.cleanup());

beforeEach(async () => {
    await env.clearFirestore();
    await seed(async db => {
        await setDoc(item(db, 'personel', 's1'), { id: 's1', name: 'Ayşe Yılmaz', pri: 'ayse.yilmaz', uid: 'uid-s1' });
        await setDoc(item(db, 'staffAccounts', 'uid-s1'), { personelId: 's1', pri: 'ayse.yilmaz' });
        await setDoc(item(db, 'personel', 's2'), { id: 's2', name: 'Bora Kaya', pri: 'bora.kaya', uid: 'uid-s2' });
        await setDoc(item(db, 'accessGate', 'staff'), { staffAccessEnabled: true });
        await setDoc(item(db, 'system_config', 'admin_settings'), { maintenance: false });
        await setDoc(item(db, 'productTypes', 'pt_sarf'), { id: 'pt_sarf', name: 'Sarf Malzeme', isDemirbas: false });
        await setDoc(item(db, 'productTypes', 'pt_dem'), { id: 'pt_dem', name: 'Laptop', isDemirbas: true });
        await setDoc(item(db, 'b1', 'p_sarf'), { id: 'p_sarf', ürün: 'Toner', tür: 'Sarf Malzeme', adet: 10, durumu: 'Kullanıma Hazır' });
        await setDoc(item(db, 'b1', 'p_dem'), { id: 'p_dem', ürün: 'Dell Latitude', tür: 'Laptop', adet: 3, durumu: 'Kullanıma Hazır' });
        await setDoc(item(db, 'b1', 'p_flag'), { id: 'p_flag', ürün: 'Laptop (eski)', tür: 'Laptop', adet: 3, isDemirbas: false });
        await setDoc(item(db, 'b2', 'p_sarf2'), { id: 'p_sarf2', ürün: 'Kablo', tür: 'Sarf Malzeme', adet: 5, durumu: 'Kullanıma Hazır', status: 'Kullanıma Hazır' });
        for (let i = 1; i <= 8; i++) await setDoc(item(db, 'b1', `p_c${i}`), { id: `p_c${i}`, ürün: `Sarf ${i}`, tür: 'Sarf Malzeme', adet: 10 });
        await setDoc(item(db, 'b3', 'eski'), b3Entry('eski'));
    });
});

describe('İzin verilen: personel sarf çıkışı', () => {
    test('stok düşümü + bağlı b3 kaydı tek batch\'te geçer', async () => {
        await assertSucceeds(exitBatch(s1()));
        assert.equal((await read('b1', 'p_sarf')).adet, 8);
        assert.equal((await read('b3', 'x1')).islemYapanUid, 'uid-s1');
    });
    test('stok 0\'a inince Tükendi durumu ve önceki durum yazılabilir', () => assertSucceeds(exitBatch(s1(), {
        qty: 10, patch: { durumu: 'Tükendi', stokOncekiDurum: 'Kullanıma Hazır' } })));
    test('B2 (durumu + status) ürününde çıkış geçer', () => assertSucceeds(exitBatch(s1(), {
        col: 'b2', pid: 'p_sarf2', before: 5, qty: 5, patch: { durumu: 'Tükendi', status: 'Tükendi', stokOncekiDurum: 'Kullanıma Hazır' } })));
    test('toplu çıkış: 3 farklı sarf kalemi tek batch\'te geçer', async () => {
        const db = s1();
        const batch = writeBatch(db);
        for (let i = 1; i <= 3; i++) {
            batch.update(item(db, 'b1', `p_c${i}`), { adet: 9, lastUpdate: 1, sonCikisId: `c${i}` });
            batch.set(item(db, 'b3', `c${i}`), b3Entry(`c${i}`, { productId: `p_c${i}`, adet: 1 }));
        }
        await assertSucceeds(batch.commit());
    });
});

describe('v3.6 · Sayımdaki raf (rafPasif)', () => {
    test('rafı sayımda olan sarf üründen personel çıkışı reddedilir', async () => {
        await seed(db => updateDoc(item(db, 'b1', 'p_sarf'), { rafPasif: true }));
        await assertFails(exitBatch(s1()));
    });
    test('KÖTÜ NİYET: personel çıkışla birlikte bayrağı kaldıramaz', async () => {
        await seed(db => updateDoc(item(db, 'b1', 'p_sarf'), { rafPasif: true }));
        await assertFails(exitBatch(s1(), { patch: { rafPasif: false } }));
    });
    test('sayım bittikten sonra (rafPasif:false) çıkış yine geçer', async () => {
        await seed(db => updateDoc(item(db, 'b1', 'p_sarf'), { rafPasif: false }));
        await assertSucceeds(exitBatch(s1()));
    });
});

describe('Reddedilen: demirbaş ve tür', () => {
    test('demirbaş türündeki ürün (urunTuruId demirbaş tür) çıkamaz', () => assertFails(exitBatch(s1(), {
        pid: 'p_dem', before: 3, qty: 1, entry: { urunTuruId: 'pt_dem', urunTuru: 'Laptop' } })));
    test('KÖTÜ NİYET: demirbaş ürüne sarf türünün id\'siyle çıkış (ad eşleşmez) reddedilir', () => assertFails(exitBatch(s1(), {
        pid: 'p_dem', before: 3, qty: 1 })));
    test('KÖTÜ NİYET: kayıtta isDemirbas:false olsa da türü demirbaş olan ürün çıkamaz', () => assertFails(exitBatch(s1(), {
        pid: 'p_flag', before: 3, qty: 1, entry: { urunTuruId: 'pt_dem' } })));
    test('b3 kaydında isDemirbas true ise reddedilir', () => assertFails(exitBatch(s1(), { entry: { isDemirbas: true } })));
    test('olmayan tür id\'si reddedilir', () => assertFails(exitBatch(s1(), { entry: { urunTuruId: 'pt_yok' } })));
});

describe('Reddedilen: bağ ve adet', () => {
    test('b3 kaydı olmadan stok düşümü reddedilir', () => assertFails(exitBatch(s1(), { skipB3: true })));
    test('stok düşmeden b3 kaydı reddedilir', () => assertFails(exitBatch(s1(), { skipStock: true })));
    test('düşülen adet ile kayıt adedi farklıysa reddedilir', () => assertFails(exitBatch(s1(), { qty: 3, entry: { adet: 2 } })));
    test('stok artırma reddedilir', async () => {
        const db = s1();
        const batch = writeBatch(db);
        batch.update(item(db, 'b1', 'p_sarf'), { adet: 12, sonCikisId: 'x9' });
        batch.set(item(db, 'b3', 'x9'), b3Entry('x9', { adet: -2 }));
        await assertFails(batch.commit());
    });
    test('KÖTÜ NİYET: var olan b3 kaydına bağlanarak stok düşümü reddedilir', () => assertFails(exitBatch(s1(), { b3Id: 'eski', skipB3: true })));
    test('KÖTÜ NİYET: çıkışla birlikte ürün adı değiştirilemez', () => assertFails(exitBatch(s1(), { patch: { ürün: 'Başka' } })));
    test('KÖTÜ NİYET: durum Tükendi dışında bir değere çekilemez', () => assertFails(exitBatch(s1(), { patch: { durumu: 'Hurda' } })));
    test('KÖTÜ NİYET: sonCikisId olmadan doğrudan adet düşümü reddedilir', () => assertFails(updateDoc(item(s1(), 'b1', 'p_sarf'), { adet: 1 })));
});

describe('Reddedilen: kimlik ve kayıt türü', () => {
    test('başka personel adına (personelId) çıkış reddedilir', () => assertFails(exitBatch(s1(), { entry: { personelId: 's2', alanKisi: 'Bora Kaya' } })));
    test('başkasının uid\'siyle (islemYapanUid) reddedilir', () => assertFails(exitBatch(s1(), { entry: { islemYapanUid: 'uid-s2' } })));
    test('zimmet tipi reddedilir', () => assertFails(exitBatch(s1(), { entry: { tip: 'zimmet', talepTuru: 'Kalıcı Zimmet', oncelik: 'Orta' } })));
    test('talebe bağlı (requestId) kayıt reddedilir', () => assertFails(exitBatch(s1(), { entry: { requestId: 'r1' } })));
    test('etiketli metin (XSS) reddedilir', () => assertFails(exitBatch(s1(), { entry: { not: '<img src=x onerror=alert(1)>' } })));
    test('bilinmeyen alan reddedilir', () => assertFails(exitBatch(s1(), { entry: { gizliAlan: 1 } })));
    test('bakım modunda reddedilir', async () => {
        await seed(db => setDoc(item(db, 'system_config', 'admin_settings'), { maintenance: true }));
        await assertFails(exitBatch(s1()));
    });
    test('erişim kilidi kapalıyken reddedilir', async () => {
        await seed(db => setDoc(item(db, 'accessGate', 'staff'), { staffAccessEnabled: false }));
        await assertFails(exitBatch(s1()));
    });
    test('personel kaydına bağlı olmayan hesap reddedilir', () => assertFails(exitBatch(staff('uid-x', 'kimse.yok')())));
    test('personel b3 kaydını silemez / güncelleyemez', async () => {
        await assertFails(updateDoc(item(s1(), 'b3', 'eski'), { not: 'değişti' }));
    });
});

describe('Yönetici etkilenmez', () => {
    test('yönetici demirbaş çıkışını eskisi gibi yapar', async () => {
        const db = admin();
        const batch = writeBatch(db);
        batch.update(item(db, 'b1', 'p_dem'), { adet: 2 });
        batch.set(item(db, 'b3', 'a1'), b3Entry('a1', { productId: 'p_dem', isDemirbas: true, adet: 1, personelId: 's2', alanKisi: 'Bora Kaya' }));
        await assertSucceeds(batch.commit());
    });
});

// Ölçüm (05.11.2026): 7 kalem geçer, 8 kalemde Firestore'un istek başına belge erişimi sınırı (20) aşılır. İstemci personel
// toplu çıkışını ExitPolicy.STAFF_MAX_ITEMS = 6 ile sınırlar (bir kalem pay).
describe('Toplu çıkışta kalem sınırı', () => {
    const cart = n => {
        const db = s1();
        const batch = writeBatch(db);
        for (let i = 1; i <= n; i++) {
            batch.update(item(db, 'b1', `p_c${i}`), { adet: 9, lastUpdate: 1, sonCikisId: `m${i}` });
            batch.set(item(db, 'b3', `m${i}`), b3Entry(`m${i}`, { productId: `p_c${i}`, adet: 1 }));
        }
        return batch.commit();
    };
    test('istemci sınırı (6 kalem) geçer', () => assertSucceeds(cart(6)));
    test('8 kalem belge erişimi sınırına takılır', () => assertFails(cart(8)));
});
