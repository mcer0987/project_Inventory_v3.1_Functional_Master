// Faz 5 · K1 — zimmet belgesi veri motoru (AssignmentService.generatePersonnelZimmetData / generateB3MovementData).
// schema.js + assignment-service.js gerçek dosyalarıyla, tarayıcısız (vm) yüklenir. Usage: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SECRET_CODE = 'GIZLI-OTURUM-7731';
// 07.10.2026 11:30 UTC = 14:30 İstanbul
const NOW = Date.UTC(2026, 9, 7, 11, 30);

// vm nesnelerinin prototipi farklı realm'dendir; karşılaştırmalar düz JSON üzerinden yapılır.
const plain = x => JSON.parse(JSON.stringify(x));

const Z = (id, extra) => ({
    id, sema: 2, tip: 'zimmet', kaynakDepo: 'b1', productId: 'p1', requestId: null, rafNo: 'R1', sutun: 'S1',
    urunTuru: 'Dizüstü Bilgisayar', urunAciklama: 'Ürün ' + id, marka: 'Dell', adet: 1, sn: 'SN' + id, envanterNo: 'ENV' + id,
    not: '-', alanKisi: 'Muhammed CER', personelId: 'per_mc', tarih: `0${id}.09.2026`.slice(-10), ts: 1_000_000 + id,
    isDemirbas: true, talepTuru: 'Kalıcı Zimmet', oncelik: 'Orta', iadeTarihi: null, iadeEdildi: false,
    iadeEdildiTarihi: null, iadeDepo: null, onaylayan: 'Admin Bir', ...extra,
});

function fixture() {
    return {
        personel: [
            { id: 'per_mc', name: 'Muhammed CER', code: SECRET_CODE, birim: 'Bilgi İşlem' },
            { id: 'per_x', name: 'Muhammed Cer', code: 'OTHER-CODE-1' },
            { id: 'per_ay', name: 'Ayşe Yılmaz', code: 'OTHER-CODE-2' },
        ],
        b1: [{ id: 'p1', ürün: 'Latitude 5440', tür: 'Dizüstü Bilgisayar', marka: 'Dell', raf: 'R1', sütun: 'S1', adet: 5, model: 'Latitude 5440 i7' }],
        b2: [{ id: 'p2', name: 'Monitör 24"', type: 'Monitör', marka: 'LG', shelf: 'B2-1', qty: 3 }],
        productTypes: [{ name: 'Dizüstü Bilgisayar', isDemirbas: true }, { name: 'Monitör', isDemirbas: true }, { name: 'Kablo', isDemirbas: false }],
        b3: [
            Z(1, { ts: 1_000_300 }),                                                   // doğrudan zimmet (en yeni)
            Z(2, { ts: 1_000_100, onaylayan: null, approvedBy: 'Eski Admin' }),         // eski onaylayan alanı
            Z(3, { ts: 1_000_200, personelId: null, alanKisi: '  muhammed   cer ', onaylayan: null,
                   not: 'Masa üstü · Onaylayan: Not Admin' }),                          // id'siz eski kayıt; onaylayan nottan
            Z(4, { iadeEdildi: true, iadeEdildiTarihi: '05.10.2026', iadeDepo: 'b1' }),  // iade → tutanakta yok
            Z(5, { tip: 'cikis', talepTuru: null, oncelik: null, alanKisi: 'Muhammed CER' }), // çıkış → zimmet değil
            Z(6, { requestId: 601, onaylayan: null }),                                  // onaylı, teslim alınmamış → yok
            Z(7, { requestId: 701, onaylayan: null, ts: 1_000_250, productId: null, kaynakDepo: 'stok-disi',
                   urunTuru: '-', marka: '', isDemirbas: false, sn: '-', envanterNo: '-', urunAciklama: 'USB Kablo', adet: 3 }),
            Z(8, { personelId: 'per_x', alanKisi: 'Muhammed Cer' }),                    // aynı adlı başka kişi → yok
            { id: 9, shelfNo: 'R9', productType: 'Eski Zimmet', sourceRepo: 'b2', sarfAdet: 1, note: '-',
              alanKisi: 'MUHAMMED CER', date: '01.08.2026', talepTuru: 'Geçici Zimmet', iadeTarihi: '01.12.2026', ts: 1_000_050 }, // eski şema
            Z(10, { personelId: 'per_ay', alanKisi: 'Ayşe Yılmaz', productId: 'p2', kaynakDepo: 'b2', urunAciklama: 'Monitör 24"',
                    urunTuru: 'Monitör', marka: 'LG' }),
        ],
        requests: [
            { id: 601, ürün: 'Talep A', personel: 'Muhammed CER', personelId: 'per_mc', durum: 'approved', approvedBy: 'Talep Admin' },
            { id: 701, ürün: 'USB Kablo', personel: 'Muhammed CER', personelId: 'per_mc', durum: 'completed',
              teslimTarihi: '30.09.2026', approvedBy: 'Talep Admin', approvedAt: '29.09.2026 10:00' },
            // b3 ikizi olmayan eski talep: kod ile eşleşir, ürün bilgisi onayda seçilen stoktan tamamlanır
            { id: 801, ürün: 'Monitör 24"', personel: 'Başka Ad', personelKodu: SECRET_CODE, durum: 'completed', sn: 'OLD1',
              stockRepo: 'b2', stockProductId: 'p2', approvedBy: 'Eski Talep Admin', tarih: '15.07.2026' },
            { id: 802, ürün: 'Başkasının', personel: 'Muhammed Cer', personelId: 'per_x', durum: 'completed' },
        ],
    };
}

function load(data = fixture()) {
    const win = { data, currentUser: { name: 'Oturum Yöneticisi', code: 'ADMIN-CODE' } };
    const ctx = vm.createContext({ window: win, console });
    for (const f of ['src/utils/schema.js', 'src/services/assignment-service.js']) {
        vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
    }
    return { win, A: win.AssignmentService };
}

test('bilinmeyen / boş personelId → null', () => {
    const { A } = load();
    assert.equal(A.generatePersonnelZimmetData('yok'), null);
    assert.equal(A.generatePersonnelZimmetData(''), null);
    assert.equal(A.generatePersonnelZimmetData(null), null);
});

test('kalem kümesi = Kişi Envanterim (aktif + teslim alınmış), eskiden yeniye', () => {
    const { win, A } = load();
    const doc = A.generatePersonnelZimmetData('per_mc', { now: NOW });
    const ids = doc.kalemler.map(k => k.kayitId);
    // eski talep 801 (ts=id) en eski; sonra b3 ts sırası: 9, 2, 3, 7, 1
    assert.deepEqual(plain(ids), ['801', '9', '2', '3', '7', '1']);
    assert.deepEqual(plain(doc.kalemler.map(k => k.sira)), [1, 2, 3, 4, 5, 6]);
    const screen = A.getPersonInventory(win.data.personel[0]).map(a => String(a.id)).sort();
    assert.deepEqual(plain([...ids].sort()), plain(screen), 'tutanak ile Kişi Envanterim aynı kaynaktan');
    assert.ok(doc.kalemler.every(k => k.durum === 'aktif'));
    assert.equal(doc.ozet.teslimBekleyen, 1, 'b3 #6: onaylı ama teslim alınmamış');
});

test('sözleşme: alan seti, tipler, metin alanları boş değil', () => {
    const { A } = load();
    const doc = A.generatePersonnelZimmetData('per_mc', { now: NOW });
    assert.equal(doc.sema, A.ZIMMET_BELGE_SEMA);
    assert.deepEqual(plain(Object.keys(doc).sort()), ['belge', 'kalemler', 'ozet', 'personel', 'sema']);
    for (const k of doc.kalemler) {
        assert.deepEqual(plain(Object.keys(k).sort()), plain([...A.ZIMMET_KALEM_KEYS].sort()));
        assert.equal(typeof k.adet, 'number');
        assert.equal(typeof k.isDemirbas, 'boolean');
        for (const f of A.ZIMMET_KALEM_KEYS.filter(f => !['sira', 'adet', 'isDemirbas', 'zimmetleyen'].includes(f))) {
            assert.ok(typeof k[f] === 'string' && k[f].trim() !== '', `${k.kayitId}.${f} boş olmayan string olmalı`);
        }
        assert.ok(k.zimmetleyen.ad && k.zimmetleyen.tarih);
    }
});

test('saf veri: JSON eşdeğeri, window.data referansı yok, oturum kodu sızmaz', () => {
    const { win, A } = load();
    const before = JSON.stringify(win.data);
    const doc = A.generatePersonnelZimmetData('per_mc', { now: NOW });
    assert.deepEqual(plain(doc), plain(doc));
    const json = JSON.stringify(doc);
    assert.ok(!json.includes(SECRET_CODE), 'personel oturum kodu belgeye girmemeli');
    assert.ok(!json.includes('ADMIN-CODE'));
    assert.ok(!/"(code|rawRef|personelKodu)"/.test(json));
    doc.kalemler[0].sn = 'DEĞİŞTİ'; doc.personel.adSoyad = 'X';
    assert.equal(JSON.stringify(win.data), before, 'girdi verisi değişmemeli');
    assert.deepEqual(plain(doc.personel), { id: 'per_mc', adSoyad: 'X', birim: 'Bilgi İşlem' });
});

test('cihaz kimlikleri ve ürün bilgisi kanonik şemadan; eski talep stoktan tamamlanır', () => {
    const { A } = load();
    const by = id => A.generatePersonnelZimmetData('per_mc', { now: NOW }).kalemler.find(k => k.kayitId === id);
    assert.deepEqual(plain(by('1')), {
        sira: 6, kayitId: '1', kaynak: 'b3', envanterNo: 'ENV1', sn: 'SN1', urunTuru: 'Dizüstü Bilgisayar',
        urunAciklama: 'Ürün 1', marka: 'Dell', model: 'Latitude 5440 i7', adet: 1, isDemirbas: true,
        tarih: '01.09.2026', teslimTarihi: '01.09.2026', talepTuru: 'Kalıcı Zimmet', oncelik: 'Orta', iadeTarihi: '-',
        talepNo: '-', zimmetleyen: { ad: 'Admin Bir', tarih: '01.09.2026' }, not: '-', durum: 'aktif', iadeEdildiTarihi: '-',
    });
    const legacyReq = by('801');
    assert.equal(legacyReq.kaynak, 'request');
    assert.equal(legacyReq.sn, 'OLD1');
    assert.equal(legacyReq.urunTuru, 'Monitör', 'tür onayda seçilen stok kaleminden');
    assert.equal(legacyReq.marka, 'LG');
    assert.equal(legacyReq.model, 'Monitör 24"', 'ayrı model alanı yoksa ürün adı/model');
    assert.equal(legacyReq.talepNo, '801');
    assert.equal(legacyReq.isDemirbas, true, 'eski talepte bayrak yok → stok kaleminin türünden');
    const legacyB3 = by('9');
    assert.equal(legacyB3.urunAciklama, 'Eski Zimmet');
    assert.equal(legacyB3.talepTuru, 'Geçici Zimmet');
    assert.equal(legacyB3.iadeTarihi, '01.12.2026');
    const sarf = by('7');
    assert.equal(sarf.isDemirbas, false);
    assert.equal(sarf.adet, 3);
    assert.equal(sarf.teslimTarihi, '30.09.2026', 'talep kaynaklıda teslim tarihi talepten');
    assert.equal(sarf.sn, '-');
});

test('zimmetleyen yönetici: onaylayan → approvedBy → bağlı talep → eski onay notu', () => {
    const { A } = load();
    const doc = A.generatePersonnelZimmetData('per_mc', { now: NOW });
    const ad = id => doc.kalemler.find(k => k.kayitId === id).zimmetleyen;
    assert.equal(ad('1').ad, 'Admin Bir');
    assert.equal(ad('2').ad, 'Eski Admin');
    assert.equal(ad('3').ad, 'Not Admin');
    assert.deepEqual(plain(ad('7')), { ad: 'Talep Admin', tarih: '29.09.2026 10:00' });
    assert.equal(ad('801').ad, 'Eski Talep Admin');
    assert.equal(ad('9').ad, '-', 'bilinmiyorsa "-"');
    assert.deepEqual(plain(doc.belge.teslimEdenler), ['Eski Talep Admin', 'Eski Admin', 'Not Admin', 'Talep Admin', 'Admin Bir']);
    assert.deepEqual(plain(doc.belge.talepNolari), ['801', '701']);
});

test('belge bloğu: deterministik belge no, İstanbul saati, düzenleyen, özet', () => {
    const { win, A } = load();
    const d1 = A.generatePersonnelZimmetData('per_mc', { now: NOW });
    const d2 = A.generatePersonnelZimmetData('per_mc', { now: NOW + 3_600_000 });
    assert.match(d1.belge.belgeNo, /^ZT-20261007-[0-9A-Z]{7}$/);
    assert.equal(d1.belge.belgeNo, d2.belge.belgeNo, 'aynı gün aynı küme → aynı no');
    assert.equal(d1.belge.olusturmaTarihi, '07.10.2026 14:30');
    assert.equal(d1.belge.tur, 'personel-zimmet');
    assert.equal(d1.belge.duzenleyen, 'Oturum Yöneticisi');
    assert.equal(A.generatePersonnelZimmetData('per_mc', { now: NOW, duzenleyen: 'Basan Admin' }).belge.duzenleyen, 'Basan Admin');
    // demirbaş: 801 (stok türünden), 2, 3, 1 · sarf: 9 (eski şema, türü bilinmiyor) + 7 (3 adet)
    assert.deepEqual(plain(d1.ozet), { kalemSayisi: 6, toplamAdet: 8, demirbasAdet: 4, sarfAdet: 4, geciciZimmet: 1, teslimBekleyen: 1 });

    win.data.b3.find(b => b.id === 1).iadeEdildi = true;   // küme değişti → no değişir
    const d3 = A.generatePersonnelZimmetData('per_mc', { now: NOW });
    assert.notEqual(d3.belge.belgeNo, d1.belge.belgeNo);
    assert.equal(d3.kalemler.length, 5);
});

test('zimmeti olmayan personel: boş kalem listesi, geçerli belge', () => {
    const { A } = load();
    const doc = A.generatePersonnelZimmetData('per_x', { now: NOW });
    // per_x: b3 #8 ve talep 802; id'siz eski kayıtlar #3 ve #9 ad eşleşmesiyle görünür (bilinen sınır, 3.7)
    assert.deepEqual(plain(doc.kalemler.map(k => k.kayitId).sort()), ['3', '8', '802', '9']);
    const none = load({ ...fixture(), b3: [], requests: [] }).A.generatePersonnelZimmetData('per_ay', { now: NOW });
    assert.equal(none.kalemler.length, 0);
    assert.equal(none.ozet.toplamAdet, 0);
    assert.equal(none.personel.birim, '-');
});

test('b3 satır belgesi: zimmet, çıkış, iade, eski şema, bilinmeyen id', () => {
    const { A } = load();
    assert.equal(A.generateB3MovementData('yok'), null);

    const z = A.generateB3MovementData(10, { now: NOW });
    assert.equal(z.sema, A.ZIMMET_BELGE_SEMA);
    assert.equal(z.belge.tur, 'zimmet');
    assert.match(z.belge.belgeNo, /^HT-20261007-[0-9A-Z]{7}$/);
    assert.deepEqual(plain(z.personel), { id: 'per_ay', adSoyad: 'Ayşe Yılmaz', birim: '-' });
    assert.equal(z.kalemler.length, 1);
    assert.deepEqual(plain(Object.keys(z.kalemler[0]).sort()), plain([...A.ZIMMET_KALEM_KEYS].sort()));
    assert.equal(z.kalemler[0].marka, 'LG');
    assert.deepEqual(plain(z.hareket), { tip: 'zimmet', kaynakDepo: 'b2', rafNo: 'R1', sutun: 'S1', stokDisi: false, iadeDepo: '-' });

    const c = A.generateB3MovementData(5, { now: NOW });
    assert.equal(c.belge.tur, 'cikis');
    assert.equal(c.kalemler[0].durum, 'cikis');
    assert.equal(c.kalemler[0].talepTuru, '-');

    const iade = A.generateB3MovementData(4, { now: NOW });
    assert.equal(iade.kalemler[0].durum, 'iade');
    assert.equal(iade.kalemler[0].iadeEdildiTarihi, '05.10.2026');
    assert.equal(iade.hareket.iadeDepo, 'b1');

    const eski = A.generateB3MovementData(9, { now: NOW });   // personelId yok, ad tek kişiye çözülemez (aynı adlı iki kişi)
    assert.equal(eski.personel.id, '-');
    assert.equal(eski.personel.adSoyad, 'MUHAMMED CER');
    assert.equal(eski.kalemler[0].urunAciklama, 'Eski Zimmet');
    assert.equal(eski.hareket.kaynakDepo, 'b2');
    assert.equal(eski.hareket.rafNo, 'R9');

    const stokDisi = A.generateB3MovementData(7, { now: NOW });
    assert.equal(stokDisi.hareket.stokDisi, true);
    assert.equal(stokDisi.kalemler[0].teslimTarihi, '30.09.2026');
    assert.ok(!JSON.stringify(stokDisi).includes(SECRET_CODE));
});
