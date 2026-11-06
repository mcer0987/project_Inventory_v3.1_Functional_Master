// feat/envanter-talep-iade · Faz 4 — iade talebi sözleşmesi (src/utils/return-request-schema.js); firestore.rules returnRequests ile aynı ölçüt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const win = {};
vm.runInContext(readFileSync('src/utils/return-request-schema.js', 'utf8'), vm.createContext({ window: win }));
const RS = win.ReturnRequestSchema;
const plain = x => JSON.parse(JSON.stringify(x));

const asg = extra => ({ _source: 'b3', id: 'z1', urun: 'Latitude 5440', sn: 'SN-1', envanterNo: 'ENV-1', depo: 'b1', productId: 7,
    iadeEdildi: false, teslimAlindi: true, isDemirbas: true, ...extra });
const input = extra => ({ assignment: asg(), user: { id: 's1', name: ' Ayşe Yılmaz ' }, uid: 'uid-s1', gerekce: 'Arıza',
    aciklama: '  Ekran   titriyor ', bildirilenDurum: 'Arızalı', tarih: '06.11.2026 10:00', ts: 5, ...extra });

test('geçerli talep: belge kimliği ret_<zimmetId>, kanonik alanlar, metin kırpılır', () => {
    const { record, errors } = RS.build(input());
    assert.deepEqual(plain(errors), []);
    assert.deepEqual(plain(record), {
        id: 'ret_z1', zimmetId: 'z1', personelId: 's1', personel: 'Ayşe Yılmaz', personelUid: 'uid-s1', urun: 'Latitude 5440',
        sn: 'SN-1', envanterNo: 'ENV-1', kaynakDepo: 'b1', productId: '7', gerekce: 'Arıza', aciklama: 'Ekran titriyor',
        bildirilenDurum: 'Arızalı', durum: 'Beklemede', tarih: '06.11.2026 10:00', ts: 5,
    });
    assert.deepEqual(Object.keys(record).sort(), [...RS.STAFF_KEYS].sort());
});

test('uygunluk: yalnız teslim alınmış, iade edilmemiş, açıkça sarf olmayan b3 zimmeti', () => {
    assert.equal(RS.isReturnable(asg()), true);
    assert.equal(RS.isReturnable(asg({ isDemirbas: undefined })), true);          // belirsiz eski kayıt
    assert.equal(RS.isReturnable(asg({ isDemirbas: false })), false);
    assert.equal(RS.isReturnable(asg({ isDemirbas: 'false' })), false);
    assert.equal(RS.isReturnable(asg({ iadeEdildi: true })), false);
    assert.equal(RS.isReturnable(asg({ teslimAlindi: false })), false);
    assert.equal(RS.isReturnable(asg({ _source: 'request' })), false);
});

test('hatalar: gerekçe, cihaz durumu, "Diğer"de açıklama, oturum, etiket ve uzunluk', () => {
    const err = x => plain(RS.build(input(x)).errors).join(' | ');
    assert.match(err({ gerekce: 'x' }), /iade gerekçesi seçin/);
    assert.match(err({ bildirilenDurum: '' }), /durumunu seçin/);
    assert.match(err({ gerekce: 'Diğer', aciklama: ' ' }), /açıklama zorunludur/);
    assert.match(err({ uid: '' }), /Oturum bulunamadı/);
    assert.match(err({ user: null }), /personel kaydı bulunamadı/);
    assert.match(err({ aciklama: '<img src=x onerror=1>' }), /etiket benzeri/);
    assert.match(err({ aciklama: 'a'.repeat(1001) }), /çok uzun/);
    assert.match(err({ assignment: asg({ isDemirbas: false }) }), /yalnız üzerinizdeki demirbaş/);
});

test('validate: bilinmeyen alan ve belge kimliği uyumsuzluğu yakalanır', () => {
    const { record } = RS.build(input());
    assert.match(RS.validate({ ...plain(record), onaylayan: 'x' }).join(' '), /bilinmeyen alan: onaylayan/);
    assert.match(RS.validate({ ...plain(record), id: 'ret_z9' }).join(' '), /Belge kimliği/);
});
