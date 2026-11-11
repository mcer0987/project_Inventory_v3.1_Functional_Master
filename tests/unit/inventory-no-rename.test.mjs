// v3.6 · İP-2 — Envanter No değişimi saf modülü (src/utils/inventory-no-rename.js): cihazın bulunduğu yer (depo, açık servis,
// aktif zimmet, hurda), bağlı depo satırı, geçmiş kayıtlar, yeni numaranın engel/uyarı denetimi, değişim planı ve eski numara
// zinciri. schema.js + modül gerçek dosyalarıyla, tarayıcısız (vm) yüklenir.
// Usage: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const plain = v => JSON.parse(JSON.stringify(v));

function load(data = {}) {
    const window = { data };
    const ctx = vm.createContext({ window, console });
    for (const f of ['src/utils/schema.js', 'src/utils/inventory-no-rename.js']) {
        vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
    }
    return window.AppModules.InventoryNoRename;
}

const stock = (id, extra = {}) => ({ id, sütun: 'A', raf: 'Raf-1', tür: 'Laptop', ürün: 'Latitude', marka: 'Dell', adet: 1,
    durumu: 'Kullanıma Hazır', status: 'Kullanıma Hazır', açıklama: '', isDemirbas: true, lastUpdate: 1, ...extra });
const b3 = (id, extra = {}) => ({ id, sema: 2, tip: 'zimmet', kaynakDepo: 'b2', productId: 'p1', urunAciklama: 'Latitude', adet: 1,
    sn: 'SN1', envanterNo: 'ENV-001', alanKisi: 'Ayşe Yılmaz', tarih: '01.11.2026', iadeEdildi: false, ...extra });

const fixture = () => ({
    b1: [],
    b2: [stock('p1', { envanterNo: 'ENV-001', adet: 0, durumu: 'Tükendi', status: 'Tükendi' }), stock('p2', { envanterNo: 'ENV-002' })],
    b3: [b3('z1'), b3('c1', { tip: 'cikis', envanterNo: 'ENV-002', productId: 'p2' }), b3('h1', { tip: 'hurda', envanterNo: 'ENV-009', productId: 'px' })],
    assignments: [{ id: 'z1', envanterNo: 'ENV-001', personel: 'Ayşe Yılmaz', iadeEdildi: false }, { id: 'old1', envanterNo: 'ENV-050', personel: 'Bora', iadeEdildi: false }],
    serviceRecords: [
        { id: 's1', envanterNo: '-', originalData: stock('p3', { envanterNo: 'ENV-003' }), productId: 'p3', kaynakDepo: 'b2', hedef: 'Dell Servis', durum: 'Serviste / Yolda', kapandi: false },
        { id: 's0', envanterNo: 'ENV-002', hedef: 'Eski servis', kapandi: true, sevkTarihi: '01.01.2026' },
    ],
    returnRequests: [{ id: 'ret_z1', envanterNo: 'ENV-001', personel: 'Ayşe Yılmaz', status: 'pending' }],
});

test('zimmetteki cihaz: b3 + assignments ikizi + adet 0 kalmış bağlı depo satırı TEK eşleşmedir; bekleyen iade uyarısı', () => {
    const M = load();
    const r = plain(M.findMatches(fixture(), ' env-001 '));
    assert.equal(r.key, 'ENV-001');
    assert.equal(r.matches.length, 1, 'bağlı depo satırı ayrıca listelenmez');
    const m = r.matches[0];
    assert.equal(m.kind, 'zimmet');
    assert.match(m.label, /Zimmette · Ayşe Yılmaz/);
    assert.deepEqual(m.targets, [{ col: 'b3', id: 'z1' }, { col: 'assignments', id: 'z1' }, { col: 'b2', id: 'p1' }]);
    assert.equal(m.product.name, 'Latitude');
    assert.equal(r.pendingReturns.length, 1);
});

test('depodaki cihaz tek eşleşme; çıkış ve kapanmış servis geçmiştir', () => {
    const M = load();
    const r = plain(M.findMatches(fixture(), 'ENV-002'));
    assert.deepEqual(r.matches.map(m => [m.kind, m.col, m.id]), [['depo', 'b2', 'p2']]);
    assert.match(r.matches[0].label, /Depoda · B2 · Raf Raf-1 · 1 adet/);
    assert.deepEqual(r.history.map(h => h.col).sort(), ['b3', 'serviceRecords']);
});

test('servisteki cihaz numarası yalnız originalData\'da olsa da bulunur; hurda kaydı bulunur; eski zimmet değiştirilemez', () => {
    const M = load();
    const s = plain(M.findMatches(fixture(), 'ENV-003'));
    assert.deepEqual(s.matches.map(m => m.kind), ['servis']);
    assert.match(s.matches[0].label, /Serviste · Dell Servis/);
    const h = plain(M.findMatches(fixture(), 'ENV-009'));
    assert.deepEqual(h.matches.map(m => m.kind), ['hurda']);
    const o = plain(M.findMatches(fixture(), 'ENV-050'));
    assert.equal(o.matches[0].editable, false);
    assert.match(o.matches[0].reason, /eski biçimli/);
    assert.deepEqual(plain(M.findMatches(fixture(), '  ')).matches, []);
});

test('yeni numara: kullanımda ise engel, yalnız geçmişte ise uyarı; boş, aynı, uzun ve etiketli numara reddedilir', () => {
    const M = load();
    const inUse = M.checkNewNumber(fixture(), 'ENV-002', 'ENV-001');
    assert.equal(inUse.ok, false);
    assert.match(inUse.blockers[0], /şu an kullanımda: Depoda/);
    const free = M.checkNewNumber({ ...fixture(), b2: fixture().b2.filter(x => x.id !== 'p2') }, 'ENV-002', 'ENV-001');
    assert.equal(free.ok, true);
    assert.ok(free.warnings.length >= 1, 'geçmişteki çıkış/servis kaydı uyarı olarak söylenir');
    for (const bad of ['', '-', ' env-001', 'x'.repeat(M.MAX_LEN + 1), '<b>1']) assert.equal(M.checkNewNumber(fixture(), bad, 'ENV-001').ok, false, bad);
});

test('planRename: zimmet zinciri — depo satırına numara + değişim bağı; b3/assignments yalnız numara; kanıtın eski değeri depo satırının HAM değeri', () => {
    const M = load();
    const data = fixture();
    data.b2[0].envanterNo = 'env-001 ';   // depo satırında farklı yazım (aynı numara)
    const m = M.findMatches(data, 'ENV-001').matches[0];
    const records = { 'b3/z1': data.b3[0], 'assignments/z1': data.assignments[0], 'b2/p1': data.b2[0] };
    const p = plain(M.planRename(m, ' ENV-777 ', { records, auditId: 'al_1', reason: 'etiket yenilendi', now: 5 }));
    assert.deepEqual(p.writes, [
        { col: 'b3', id: 'z1', data: { envanterNo: 'ENV-777' } },
        { col: 'assignments', id: 'z1', data: { envanterNo: 'ENV-777' } },
        { col: 'b2', id: 'p1', data: { envanterNo: 'ENV-777', sonEnvanterNoDegisimId: 'al_1', lastUpdate: 5 } },
    ]);
    assert.equal(p.fromValue, 'env-001 ');
    assert.deepEqual([p.audit.type, p.audit.fromValue, p.audit.toValue, p.audit.refCol, p.audit.refId], ['envanter-no-degisim', 'env-001 ', 'ENV-777', 'b3', 'z1']);
});

test('planRename: servis kaydının originalData\'sı TAM harita olarak yazılır; bayat kayıt ve değiştirilemez eşleşme reddedilir', () => {
    const M = load();
    const data = fixture();
    const m = M.findMatches(data, 'ENV-003').matches[0];
    const p = plain(M.planRename(m, 'ENV-300', { records: { 'serviceRecords/s1': data.serviceRecords[0] }, auditId: 'al_2' }));
    assert.equal(p.writes.length, 1);
    assert.equal(p.writes[0].data.envanterNo, undefined, 'cihaz numarası "-" olan kayıtta yalnız anlık görüntü değişir');
    assert.equal(p.writes[0].data.originalData.envanterNo, 'ENV-300');
    assert.equal(p.writes[0].data.originalData.ürün, 'Latitude', 'harita bütün kalır');
    assert.equal(p.fromValue, 'ENV-003');
    assert.throws(() => M.planRename(m, 'ENV-300', { records: { 'serviceRecords/s1': { ...data.serviceRecords[0], originalData: { envanterNo: 'BASKA' } } } }), /bu arada değişmiş/);
    assert.throws(() => M.planRename(M.findMatches(data, 'ENV-050').matches[0], 'ENV-500', { records: {} }), /eski biçimli/);
    assert.throws(() => M.planRename(m, 'env-003', { records: {} }), /aynı/);
});

test('eski numara zinciri iki yönde ve çok adımda izlenir', () => {
    const M = load();
    M.setAliasPairs([{ from: 'ENV-001', to: 'ENV-777' }, { from: 'env-777', to: 'ENV-900' }, { from: 'X', to: '' }]);
    assert.deepEqual(plain(M.aliasesOf('ENV-900')).sort(), ['ENV-001', 'ENV-777']);
    assert.deepEqual(plain(M.aliasesOf('ENV-001')).sort(), ['ENV-777', 'ENV-900']);
    assert.deepEqual(plain(M.aliasesOf('ENV-123')), []);
});
