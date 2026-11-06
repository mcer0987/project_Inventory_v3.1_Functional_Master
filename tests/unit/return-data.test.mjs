// feat/envanter-talep-iade · Faz 6 — iade tutanağı veri motoru (AssignmentService.generateReturnData).
// Yön zimmet tutanağının tersidir: personel teslim eden, yönetici teslim alandır. Yalnız durum 'approved' için üretilir;
// kalem önce b3 kaydından (hâlâ varsa), yoksa returnRequests kaydının kendi alanlarından kurulur.
// schema.js + assignment-service.js gerçek dosyalarıyla, tarayıcısız (vm) yüklenir. Usage: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const plain = x => JSON.parse(JSON.stringify(x));

const B3 = (id, extra) => ({
    id, sema: 2, tip: 'zimmet', kaynakDepo: 'b1', productId: 'p1', requestId: null, rafNo: 'R1', sutun: 'S1',
    urunTuru: 'Laptop', urunAciklama: 'Latitude 5440', marka: 'Dell', adet: 1, sn: 'SN-LAT-001', envanterNo: 'ENV-501',
    not: '-', alanKisi: 'Ayşe Yılmaz', personelId: 's1', tarih: '01.10.2026', ts: 1000,
    isDemirbas: true, talepTuru: 'Kalıcı Zimmet', oncelik: 'Orta', iadeTarihi: null, iadeEdildi: true,
    iadeEdildiTarihi: '06.11.2026 10:05', iadeDepo: 'b1', onaylayan: 'Admin', ...extra,
});
const RET = (id, extra) => ({
    id, zimmetId: 'z1', personelId: 's1', personel: 'Ayşe Yılmaz', personelUid: 'uid-s1', urun: 'Latitude 5440',
    sn: 'SN-LAT-001', envanterNo: 'ENV-501', kaynakDepo: 'b1', productId: 'p1', gerekce: 'Arıza',
    aciklama: 'Ekran titriyor, menteşe gevşek.', bildirilenDurum: 'Arızalı', durum: 'approved',
    tarih: '06.11.2026 09:00', ts: 2000, ...extra,
});
const APPROVED_FIELDS = {
    teslimAlindi: true, iadeDepo: 'b1', stogaEklendi: false, adminCihazDurumu: 'Arızalı', adminNotu: '',
    kapanisAciklamasi: '', onaylayan: 'Sistem Yöneticisi', onayTarihi: '06.11.2026 10:05',
};

function load(data) {
    const win = { data: { personel: [{ id: 's1', name: 'Ayşe Yılmaz', birim: 'Bilgi İşlem' }], b1: [], b2: [], b3: [], requests: [], returnRequests: [], ...data } };
    const ctx = vm.createContext({ window: win, console });
    for (const f of ['src/utils/schema.js', 'src/services/assignment-service.js']) {
        vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
    }
    return { win, A: win.AssignmentService };
}

test('kayıt yok / karara bağlanmamış → null (bekleyen, reddedilen, geri çekilen)', () => {
    const { A } = load({ b3: [B3('z1')], returnRequests: [
        RET('ret_bek', { durum: 'Beklemede' }), RET('ret_red', { durum: 'rejected' }), RET('ret_geri', { durum: 'withdrawn' }),
    ] });
    assert.equal(A.generateReturnData('yok'), null);
    assert.equal(A.generateReturnData('ret_bek'), null);
    assert.equal(A.generateReturnData('ret_red'), null);
    assert.equal(A.generateReturnData('ret_geri'), null);
});

test('onaylandı + teslim alındı + stoğa eklenmedi (arızalı): kalem b3 kaydından, karar alanları doğru', () => {
    const { A } = load({ b3: [B3('z1')], returnRequests: [RET('ret_z1', APPROVED_FIELDS)] });
    const doc = plain(A.generateReturnData('ret_z1', { now: Date.UTC(2026, 10, 6, 7, 10) }));
    assert.equal(doc.sema, A.ZIMMET_BELGE_SEMA);
    assert.deepEqual(Object.keys(doc).sort(), ['belge', 'iade', 'kalemler', 'ozet', 'personel', 'sema']);
    assert.equal(doc.personel.adSoyad, 'Ayşe Yılmaz'); assert.equal(doc.personel.birim, 'Bilgi İşlem');
    assert.equal(doc.kalemler.length, 1);
    const k = doc.kalemler[0];
    assert.deepEqual([k.kayitId, k.envanterNo, k.sn, k.urunTuru, k.urunAciklama, k.marka, k.adet, k.isDemirbas, k.durum],
        ['z1', 'ENV-501', 'SN-LAT-001', 'Laptop', 'Latitude 5440', 'Dell', 1, true, 'iade']);
    assert.equal(k.teslimTarihi, '06.11.2026 10:05', 'teslim alındığında kalem tarihi onay (karar) tarihi');
    assert.equal(k.iadeEdildiTarihi, '06.11.2026 10:05');
    assert.deepEqual(doc.iade, {
        gerekce: 'Arıza', aciklama: 'Ekran titriyor, menteşe gevşek.', bildirilenDurum: 'Arızalı', talepTarihi: '06.11.2026 09:00',
        teslimAlindi: true, iadeDepo: 'b1', stogaEklendi: false, adminCihazDurumu: 'Arızalı', adminNotu: '-',
        kapanisAciklamasi: '-', onaylayan: 'Sistem Yöneticisi', onayTarihi: '06.11.2026 10:05',
    });
    assert.equal(doc.belge.duzenleyen, 'Sistem Yöneticisi', 'belgeyi onaylayan yönetici düzenler');
});

test('onaylandı + teslim alınmadı (kayıp/ayrılış): iadeDepo/stoğa eklendi boş, kalem tarihi talep tarihi, kapanış açıklaması zorunlu alanda', () => {
    const { A } = load({ b3: [B3('z1')], returnRequests: [RET('ret_z1', {
        teslimAlindi: false, iadeDepo: null, stogaEklendi: false, adminCihazDurumu: 'Arızalı', adminNotu: '',
        kapanisAciklamasi: 'Personel ayrıldı; cihaz teslim edilmedi.', onaylayan: 'Sistem Yöneticisi', onayTarihi: '06.11.2026 11:00',
    }) ] });
    const doc = plain(A.generateReturnData('ret_z1'));
    assert.equal(doc.iade.teslimAlindi, false);
    assert.equal(doc.iade.iadeDepo, '-'); assert.equal(doc.iade.stogaEklendi, false);
    assert.equal(doc.iade.kapanisAciklamasi, 'Personel ayrıldı; cihaz teslim edilmedi.');
    assert.equal(doc.kalemler[0].teslimTarihi, '06.11.2026 09:00', 'teslim alınmadıysa kalem tarihi talep tarihi');
});

test('b3 kaydı silinmiş olsa bile returnRequests kendi alanlarından kalem kurar', () => {
    const { A } = load({ b3: [], returnRequests: [RET('ret_z1', APPROVED_FIELDS)] });
    const doc = plain(A.generateReturnData('ret_z1'));
    const k = doc.kalemler[0];
    assert.deepEqual([k.kayitId, k.envanterNo, k.sn, k.urunAciklama, k.adet, k.isDemirbas], ['z1', 'ENV-501', 'SN-LAT-001', 'Latitude 5440', 1, true]);
    assert.equal(doc.personel.adSoyad, 'Ayşe Yılmaz', 'personel kaydından (returnRequests.personelId) bulunur');
});

test('sözleşme: kalem alan seti zimmet tutanağıyla aynı (ZIMMET_KALEM_KEYS), metin alanları boş değil', () => {
    const { A } = load({ b3: [B3('z1')], returnRequests: [RET('ret_z1', APPROVED_FIELDS)] });
    const doc = plain(A.generateReturnData('ret_z1'));
    assert.deepEqual(Object.keys(doc.kalemler[0]).sort(), [...A.ZIMMET_KALEM_KEYS].sort());
    for (const f of A.ZIMMET_KALEM_KEYS.filter(f => !['sira', 'adet', 'isDemirbas', 'zimmetleyen'].includes(f))) {
        assert.ok(typeof doc.kalemler[0][f] === 'string' && doc.kalemler[0][f].trim() !== '', `${f} boş olmayan string olmalı`);
    }
    assert.equal(typeof doc.ozet.kalemSayisi, 'number');
});

test('saf veri: JSON eşdeğeri, window.data referansı taşımaz', () => {
    const { win, A } = load({ b3: [B3('z1')], returnRequests: [RET('ret_z1', APPROVED_FIELDS)] });
    const before = JSON.stringify(win.data);
    const doc = A.generateReturnData('ret_z1');
    assert.deepEqual(plain(doc), plain(doc));
    assert.notEqual(doc.kalemler[0], win.data.b3[0]);
    doc.kalemler[0].sn = 'DEĞİŞTİ'; doc.iade.onaylayan = 'X';
    assert.equal(JSON.stringify(win.data), before, 'girdi verisi değişmemeli');
});
