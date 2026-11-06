// [WHY]: feat/envanter-talep-iade · Faz 4 — iade talepleri (returnRequests). Kural açığı; personelin başkasının cihazını iade
//        ettirmesi, onay sahteciliği ya da zimmet kapanmadan "iade onaylandı" kaydı demek. Olumlu yol kadar kötü niyetli her
//        varyasyon emülatörde denenir.
// [HOW]: Personel kayıtları istemcinin GERÇEK sözleşmesiyle (src/utils/return-request-schema.js build) üretilir; böylece istemci
//        biçimi ile kural beklentisinin uyuştuğu da doğrulanır.
import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc, writeBatch, collection, query, where, setLogLevel } from 'firebase/firestore';

setLogLevel('silent');
const LIVE = 'lifeserver_master';
let env;

const win = {};
vm.runInContext(readFileSync('src/utils/return-request-schema.js', 'utf8'), vm.createContext({ window: win }));
const RS = win.ReturnRequestSchema;

const staff = (uid, pri) => () => env.authenticatedContext(uid, { email: `${pri}@staff.medipol.local`, firebase: { sign_in_provider: 'password' } }).firestore();
const s1 = staff('uid-s1', 'ayse.yilmaz');
const s2 = staff('uid-s2', 'bora.kaya');
const admin = () => env.authenticatedContext('admin-uid', { email: 'admin@medipol.local', firebase: { sign_in_provider: 'password' } }).firestore();
const item = (db, col, id) => doc(db, LIVE, col, 'items', String(id));
const seed = fn => env.withSecurityRulesDisabled(async c => fn(c.firestore()));
const plain = x => JSON.parse(JSON.stringify(x));

const Z = (id, extra) => ({ id, sema: 2, tip: 'zimmet', kaynakDepo: 'b1', productId: 'p1', requestId: null, rafNo: 'A1', sutun: 'S',
    urunTuru: 'Laptop', urunAciklama: 'Latitude ' + id, marka: 'Dell', adet: 1, sn: 'SN-' + id, envanterNo: 'ENV-' + id, not: '-',
    alanKisi: 'Ayşe Yılmaz', personelId: 's1', tarih: '01.11.2026', ts: 1, isDemirbas: true, talepTuru: 'Kalıcı Zimmet', oncelik: 'Orta',
    iadeTarihi: null, iadeEdildi: false, iadeEdildiTarihi: null, iadeDepo: null, onaylayan: 'Admin', ...extra });
// Kişi Envanteri satırı (AssignmentService.getAssignments biçimi) → şema build
const asg = (id, extra) => ({ _source: 'b3', id, urun: 'Latitude ' + id, sn: 'SN-' + id, envanterNo: 'ENV-' + id, depo: 'b1', productId: 'p1',
    iadeEdildi: false, teslimAlindi: true, isDemirbas: true, ...extra });
const user1 = { id: 's1', name: 'Ayşe Yılmaz' };
function rec(zid, over = {}, input = {}) {
    const { record, errors } = RS.build({ assignment: asg(zid), user: user1, uid: 'uid-s1', gerekce: 'Arıza', aciklama: 'Ekran titriyor',
        bildirilenDurum: 'Arızalı', tarih: '06.11.2026 10:00', ts: 1793952000000, ...input });
    assert.deepEqual(errors.length, 0, JSON.stringify(plain(errors)));
    return { ...plain(record), ...over };
}
const create = (db, zid, over, input) => { const r = rec(zid, over, input); return setDoc(item(db, 'returnRequests', r.id), r); };
// Yönetici onayı: zimmet kapanışı (+ isteğe bağlı stok) + talep kararı tek batch'te
function approve(db, zid, { decision = {}, closeZimmet = true, stock = true } = {}) {
    const batch = writeBatch(db);
    if (closeZimmet) batch.update(item(db, 'b3', zid), { iadeEdildi: true, iadeDepo: 'b1', iadeEdildiTarihi: '06.11.2026' });
    if (stock) batch.update(item(db, 'b1', 'p1'), { adet: 4 });
    batch.update(item(db, 'returnRequests', 'ret_' + zid), { durum: 'approved', teslimAlindi: true, iadeDepo: 'b1', stogaEklendi: true,
        adminCihazDurumu: 'Sağlam', adminNotu: '', onaylayan: 'Sistem Yöneticisi', onayTarihi: '06.11.2026 11:00', ...decision });
    return batch.commit();
}

before(async () => {
    env = await initializeTestEnvironment({ projectId: 'demo-return-requests', firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
});
after(async () => env?.cleanup());

beforeEach(async () => {
    await env.clearFirestore();
    await seed(async db => {
        await setDoc(item(db, 'personel', 's1'), { id: 's1', name: 'Ayşe Yılmaz', pri: 'ayse.yilmaz', uid: 'uid-s1' });
        await setDoc(item(db, 'personel', 's2'), { id: 's2', name: 'Bora Kaya', pri: 'bora.kaya', uid: 'uid-s2' });
        await setDoc(item(db, 'staffAccounts', 'uid-s1'), { personelId: 's1', pri: 'ayse.yilmaz' });
        await setDoc(item(db, 'staffAccounts', 'uid-s2'), { personelId: 's2', pri: 'bora.kaya' });
        await setDoc(item(db, 'accessGate', 'staff'), { staffAccessEnabled: true });
        await setDoc(item(db, 'system_config', 'admin_settings'), { maintenance: false });
        await setDoc(item(db, 'b1', 'p1'), { id: 'p1', ürün: 'Latitude', tür: 'Laptop', adet: 3 });
        await setDoc(item(db, 'b3', 'z1'), Z('z1'));
        await setDoc(item(db, 'b3', 'z2'), Z('z2', { iadeEdildi: true, iadeDepo: 'b1' }));
        await setDoc(item(db, 'b3', 'z3'), Z('z3', { personelId: 's2', alanKisi: 'Bora Kaya' }));
        await setDoc(item(db, 'b3', 'z4'), Z('z4', { isDemirbas: false, urunTuru: 'Sarf' }));
        const legacy = Z('z5'); delete legacy.tip; delete legacy.isDemirbas;   // eski şema: tip yok, zimmet talepTuru'ndan anlaşılır
        await setDoc(item(db, 'b3', 'z5'), legacy);
        await setDoc(item(db, 'b3', 'z6'), Z('z6', { tip: 'cikis', talepTuru: null, oncelik: null }));
    });
});

describe('Personel oluşturma', () => {
    test('kendi aktif demirbaş zimmeti için talep oluşturur (istemci şemasıyla üretilen kayıt)', () => assertSucceeds(create(s1(), 'z1')));
    test('eski şemalı zimmet (tip alanı yok) için oluşturur', () => assertSucceeds(create(s1(), 'z5')));
    test('iade edilmiş zimmet için oluşturamaz', () => assertFails(create(s1(), 'z2')));
    test('KÖTÜ NİYET: başkasının zimmeti için oluşturamaz', () => assertFails(create(s1(), 'z3')));
    test('açıkça sarf (isDemirbas false) kayıt için oluşturamaz', () => assertFails(create(s1(), 'z4')));
    test('çıkış (tip cikis) kaydı için oluşturamaz', () => assertFails(create(s1(), 'z6')));
    test('olmayan zimmet için oluşturamaz', () => assertFails(create(s1(), 'yok')));
    test('KÖTÜ NİYET: belge kimliği zimmetle eşleşmezse reddedilir', async () => {
        const r = rec('z1');
        await assertFails(setDoc(item(s1(), 'returnRequests', 'ret_z3'), { ...r, id: 'ret_z3' }));
    });
    test('KÖTÜ NİYET: onaylanmış olarak oluşturamaz', () => assertFails(create(s1(), 'z1', { durum: 'approved' })));
    test('KÖTÜ NİYET: başka uid / personelId / ad ile oluşturamaz', async () => {
        await assertFails(create(s1(), 'z1', { personelUid: 'uid-s2' }));
        await assertFails(create(s1(), 'z1', { personelId: 's2' }));
        await assertFails(create(s1(), 'z1', { personel: 'Bora Kaya' }));
    });
    test('KÖTÜ NİYET: yönetici karar alanıyla oluşturamaz', () => assertFails(create(s1(), 'z1', { onaylayan: 'Ben', teslimAlindi: true })));
    test('etiketli metin ve geçersiz seçenek reddedilir', async () => {
        await assertFails(create(s1(), 'z1', { aciklama: '<img src=x onerror=alert(1)>' }));
        await assertFails(create(s1(), 'z1', { gerekce: 'Canım istedi' }));
        await assertFails(create(s1(), 'z1', { bildirilenDurum: 'Mükemmel' }));
    });
    test('"Diğer" gerekçesinde açıklama zorunlu', () => assertFails(create(s1(), 'z1', { gerekce: 'Diğer', aciklama: '' })));
    test('aynı cihaz için ikinci açık talep oluşturulamaz', async () => {
        await assertSucceeds(create(s1(), 'z1'));
        await assertFails(create(s1(), 'z1', { gerekce: 'Değişim' }));
    });
    test('bakım modunda ve erişim kilidi kapalıyken reddedilir', async () => {
        await seed(db => setDoc(item(db, 'system_config', 'admin_settings'), { maintenance: true }));
        await assertFails(create(s1(), 'z1'));
        await seed(db => setDoc(item(db, 'system_config', 'admin_settings'), { maintenance: false }));
        await seed(db => setDoc(item(db, 'accessGate', 'staff'), { staffAccessEnabled: false }));
        await assertFails(create(s1(), 'z1'));
    });
});

describe('Okuma', () => {
    test('personel kendi talebini okur ve kendi süzgeçli sorgusunu dinler; başkasınınkini ve tüm listeyi okuyamaz', async () => {
        await seed(async db => {
            await setDoc(item(db, 'returnRequests', 'ret_z1'), rec('z1'));
            await setDoc(item(db, 'returnRequests', 'ret_z3'), { ...rec('z1'), id: 'ret_z3', zimmetId: 'z3', personelId: 's2', personel: 'Bora Kaya', personelUid: 'uid-s2' });
        });
        await assertSucceeds(getDoc(item(s1(), 'returnRequests', 'ret_z1')));
        await assertFails(getDoc(item(s1(), 'returnRequests', 'ret_z3')));
        const own = await assertSucceeds(getDocs(query(collection(s1(), LIVE, 'returnRequests', 'items'), where('personelUid', '==', 'uid-s1'))));
        assert.equal(own.size, 1);
        await assertFails(getDocs(collection(s1(), LIVE, 'returnRequests', 'items')));
        assert.equal((await assertSucceeds(getDocs(collection(admin(), LIVE, 'returnRequests', 'items')))).size, 2);
    });
});

describe('Personel güncelleme', () => {
    beforeEach(() => seed(db => setDoc(item(db, 'returnRequests', 'ret_z1'), rec('z1'))));
    test('bekleyen talebi geri çeker', () => assertSucceeds(updateDoc(item(s1(), 'returnRequests', 'ret_z1'), { durum: 'withdrawn', ts: 2 })));
    test('reddedilen talebi yeni gerekçeyle yeniden gönderir', async () => {
        await seed(db => updateDoc(item(db, 'returnRequests', 'ret_z1'), { durum: 'rejected', redGerekcesi: 'Önce yedek gelsin', reddeden: 'Admin' }));
        await assertSucceeds(updateDoc(item(s1(), 'returnRequests', 'ret_z1'), { durum: 'Beklemede', gerekce: 'Değişim', aciklama: 'Yedek geldi', ts: 3 }));
    });
    test('zimmet bu arada iade edildiyse yeniden gönderemez', async () => {
        await seed(async db => {
            await updateDoc(item(db, 'returnRequests', 'ret_z1'), { durum: 'withdrawn' });
            await updateDoc(item(db, 'b3', 'z1'), { iadeEdildi: true });
        });
        await assertFails(updateDoc(item(s1(), 'returnRequests', 'ret_z1'), { durum: 'Beklemede', ts: 4 }));
    });
    test('KÖTÜ NİYET: kendi talebini onaylayamaz / reddedemez / karar alanı yazamaz', async () => {
        await assertFails(updateDoc(item(s1(), 'returnRequests', 'ret_z1'), { durum: 'approved' }));
        await assertFails(updateDoc(item(s1(), 'returnRequests', 'ret_z1'), { durum: 'rejected' }));
        await assertFails(updateDoc(item(s1(), 'returnRequests', 'ret_z1'), { adminNotu: 'tamam' }));
    });
    test('KÖTÜ NİYET: zimmetId / sahiplik değiştirilemez; başka personel güncelleyemez', async () => {
        await assertFails(updateDoc(item(s1(), 'returnRequests', 'ret_z1'), { durum: 'withdrawn', zimmetId: 'z3' }));
        await assertFails(updateDoc(item(s1(), 'returnRequests', 'ret_z1'), { durum: 'withdrawn', personelUid: 'uid-s2' }));
        await assertFails(updateDoc(item(s2(), 'returnRequests', 'ret_z1'), { durum: 'withdrawn' }));
    });
    test('personel silemez', () => assertFails(deleteDoc(item(s1(), 'returnRequests', 'ret_z1'))));
});

describe('Yönetici kararı', () => {
    beforeEach(() => seed(db => setDoc(item(db, 'returnRequests', 'ret_z1'), rec('z1'))));
    test('onay: zimmet kapanışı + stok + karar tek batch\'te geçer', () => assertSucceeds(approve(admin(), 'z1')));
    test('KÖTÜ NİYET: zimmet kapanmadan "onaylandı" yazılamaz', () => assertFails(approve(admin(), 'z1', { closeZimmet: false, stock: false })));
    test('teslim alındıysa depo zorunlu; teslim alınmadan kapatmada açıklama zorunlu ve stok eklenemez', async () => {
        await assertFails(approve(admin(), 'z1', { decision: { iadeDepo: null } }));
        await assertFails(approve(admin(), 'z1', { stock: false, decision: { teslimAlindi: false, iadeDepo: null, stogaEklendi: false } }));
        await assertFails(approve(admin(), 'z1', { stock: false, decision: { teslimAlindi: false, iadeDepo: null, stogaEklendi: true, kapanisAciklamasi: 'Kayıp' } }));
        await assertSucceeds(approve(admin(), 'z1', { stock: false, decision: { teslimAlindi: false, iadeDepo: null, stogaEklendi: false, kapanisAciklamasi: 'Personel ayrıldı, cihaz teslim edilmedi' } }));
    });
    test('hasarlı cihaz: depoya teslim alındı ama stoğa eklenmedi kararı geçer', () => assertSucceeds(approve(admin(), 'z1', { stock: false,
        decision: { adminCihazDurumu: 'Hasarlı', stogaEklendi: false, adminNotu: 'Ekran kırık, servise gidecek' } })));
    test('geçersiz cihaz durumu reddedilir', () => assertFails(approve(admin(), 'z1', { decision: { adminCihazDurumu: 'Çalışır' } })));
    test('ret: gerekçe zorunlu', async () => {
        await assertFails(updateDoc(item(admin(), 'returnRequests', 'ret_z1'), { durum: 'rejected', reddeden: 'Admin' }));
        await assertSucceeds(updateDoc(item(admin(), 'returnRequests', 'ret_z1'), { durum: 'rejected', redGerekcesi: 'Yedek cihaz gelmeden iade alınamıyor', reddeden: 'Admin', redTarihi: '06.11.2026' }));
    });
    test('karara bağlanmış talep yeniden karara bağlanamaz', async () => {
        await assertSucceeds(approve(admin(), 'z1'));
        await assertFails(updateDoc(item(admin(), 'returnRequests', 'ret_z1'), { durum: 'rejected', redGerekcesi: 'x', reddeden: 'Admin' }));
    });
    test('KÖTÜ NİYET: yönetici talebin personel alanlarını değiştiremez', () =>
        assertFails(approve(admin(), 'z1', { decision: { personel: 'Başka' } })));
    test('silme: bekleyen silinemez; karara bağlanmış silinebilir', async () => {
        await assertFails(deleteDoc(item(admin(), 'returnRequests', 'ret_z1')));
        await assertSucceeds(approve(admin(), 'z1'));
        await assertSucceeds(deleteDoc(item(admin(), 'returnRequests', 'ret_z1')));
    });
});
