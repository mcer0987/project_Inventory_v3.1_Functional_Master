// feat/envanter-talep-iade · Faz 2 (B-1) — sarf tüketimdir, zimmet değil.
// AssignmentService.planSarfConsumption (dönüşüm önizlemesi, YAZMAZ) ve eski talep kaynaklı sarfın zimmet listesinden çıkması.
// schema.js + assignment-service.js gerçek dosyalarıyla, tarayıcısız (vm) yüklenir. Usage: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const plain = x => JSON.parse(JSON.stringify(x));

const Z = (id, extra) => ({
    id, sema: 2, tip: 'zimmet', kaynakDepo: 'b1', productId: 'p1', requestId: null, rafNo: 'R1', sutun: 'S1',
    urunTuru: 'Sarf Malzeme', urunAciklama: 'Ürün ' + id, marka: '', adet: 2, sn: '-', envanterNo: '-',
    not: '-', alanKisi: 'Ayşe Yılmaz', personelId: 'p_ay', tarih: '01.10.2026', ts: 1000 + id,
    isDemirbas: false, talepTuru: 'Sarf Malzeme İhtiyacı', oncelik: 'Orta', iadeTarihi: null, iadeEdildi: false,
    iadeEdildiTarihi: null, iadeDepo: null, onaylayan: 'Admin', ...extra,
});

function load(data) {
    const win = { data: { personel: [{ id: 'p_ay', name: 'Ayşe Yılmaz' }], b1: [], b2: [], productTypes: [], requests: [], b3: [], ...data } };
    const ctx = vm.createContext({ window: win, console });
    for (const f of ['src/utils/schema.js', 'src/services/assignment-service.js']) {
        vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
    }
    return { win, A: win.AssignmentService };
}

test('plan: yalnız açıkça sarf (isDemirbas false / "false"), iade edilmemiş zimmet dönüşür', () => {
    const { A } = load({ b3: [
        Z(1),                                                    // dönüşür
        Z(2, { isDemirbas: 'false' }),                           // eski metin bayrak → dönüşür
        Z(3, { isDemirbas: true, urunTuru: 'Laptop' }),          // demirbaş → dokunulmaz
        Z(4, { iadeEdildi: true, iadeEdildiTarihi: '02.10.2026' }), // iade edilmiş → dokunulmaz, ayrıca sayılır
        Z(5, { isDemirbas: undefined }),                         // belirsiz eski kayıt → dokunulmaz, listelenir
        Z(6, { tip: 'cikis', talepTuru: null, oncelik: null }),  // zaten çıkış → plana girmez
    ] });
    const p = plain(A.planSarfConsumption());
    assert.deepEqual(p.convert.map(r => r.id), [1, 2]);
    assert.deepEqual(p.returned.map(r => r.id), [4]);
    assert.deepEqual(p.unknown.map(r => r.id), [5]);
    assert.equal(p.total, 5);
    assert.deepEqual(Object.keys(p.convert[0]).sort(), ['adet', 'id', 'personel', 'tarih', 'urun']);
});

test('plan YAZMAZ; dönüşüm (tip → cikis) uygulandıktan sonra ikinci plan boştur (idempotent)', () => {
    const { win, A } = load({ b3: [Z(1), Z(2)] });
    const before = JSON.stringify(win.data.b3);
    const p = A.planSarfConsumption();
    assert.equal(JSON.stringify(win.data.b3), before);
    p.convert.forEach(r => { win.data.b3.find(b => b.id === r.id).tip = 'cikis'; });
    assert.equal(A.planSarfConsumption().convert.length, 0);
});

test('dönüşen sarf: Kişi Envanteri, zimmet listesi ve tutanaktan çıkar; demirbaş kalır', () => {
    const user = { id: 'p_ay', name: 'Ayşe Yılmaz' };
    const { win, A } = load({ b3: [Z(1), Z(3, { isDemirbas: true, urunTuru: 'Laptop', urunAciklama: 'Latitude' })] });
    assert.equal(A.getPersonInventory(user).length, 2);
    win.data.b3[0].tip = 'cikis';
    assert.deepEqual(plain(A.getPersonInventory(user).map(a => a.urun)), ['Latitude']);
    assert.deepEqual(plain(A.getAssignments().map(a => a.urun)), ['Latitude']);
    assert.equal(A.generatePersonnelZimmetData('p_ay').ozet.kalemSayisi, 1);
});

test('b3 kaydı olmayan eski talep: açıkça sarf (isDemirbas false) zimmet sayılmaz; bayraksız / demirbaş olan kalır', () => {
    const R = (id, extra) => ({ id, ürün: 'Talep ' + id, personel: 'Ayşe Yılmaz', personelId: 'p_ay', durum: 'completed', ...extra });
    const { A } = load({ requests: [R('r1', { isDemirbas: false }), R('r2', { isDemirbas: true }), R('r3')] });
    assert.deepEqual(plain(A.getAssignments().map(a => a.id)).sort(), ['r2', 'r3']);
});
