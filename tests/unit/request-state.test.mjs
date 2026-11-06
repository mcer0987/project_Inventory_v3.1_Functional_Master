// feat/envanter-talep-iade · Faz 3 — zimmet durum kuralı (AssignmentService.assignmentState / getPendingDeliveries /
// stateBadgeHtml) ve admin bekleyen talep rozetinin sayımı (RequestBadge.countPending). vm ile gerçek dosyalardan yüklenir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const plain = x => JSON.parse(JSON.stringify(x));

function load(data = {}, files = ['src/utils/schema.js', 'src/services/assignment-service.js']) {
    const listeners = {};
    const win = {
        data: { personel: [{ id: 'p1', name: 'Ayşe Yılmaz' }], b1: [], b2: [], productTypes: [], requests: [], b3: [], ...data },
        addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); },
        escapeHtml: s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    };
    const ctx = vm.createContext({ window: win, console, document: { addEventListener() {}, getElementById: () => null } });
    for (const f of files) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
    return win;
}
const Z = (id, extra) => ({ id, sema: 2, tip: 'zimmet', kaynakDepo: 'b1', productId: 'x', requestId: null, rafNo: '-', sutun: '-',
    urunTuru: 'Laptop', urunAciklama: 'Cihaz ' + id, marka: '', adet: 1, sn: 'SN' + id, envanterNo: '-', not: '-', alanKisi: 'Ayşe Yılmaz',
    personelId: 'p1', tarih: '01.11.2026', ts: id, isDemirbas: true, talepTuru: 'Kalıcı Zimmet', oncelik: 'Orta', iadeTarihi: null,
    iadeEdildi: false, iadeEdildiTarihi: null, iadeDepo: null, onaylayan: 'Admin', ...extra });

test('durum: teslim bekliyor / zimmetli / iade onayı bekliyor / iade edildi', () => {
    const win = load({
        b3: [Z(1, { requestId: 'r1' }), Z(2, { requestId: 'r2' }), Z(3), Z(4, { iadeEdildi: true })],
        requests: [{ id: 'r1', durum: 'approved', personelId: 'p1' }, { id: 'r2', durum: 'completed', personelId: 'p1' }],
        returnRequests: [{ id: 'ret_3', zimmetId: 3, durum: 'Beklemede' }, { id: 'ret_2', zimmetId: 2, durum: 'rejected' }],
    });
    const A = win.AssignmentService;
    const byId = Object.fromEntries(A.getAssignments().map(a => [a.id, A.assignmentState(a)]));
    assert.deepEqual(plain(byId), { 1: 'teslimBekliyor', 2: 'zimmetli', 3: 'iadeBekliyor', 4: 'iade' });
    assert.deepEqual(plain(A.getPendingDeliveries({ id: 'p1', name: 'Ayşe Yılmaz' }).map(a => a.id)), [1]);
    assert.deepEqual(plain(A.getPersonInventory({ id: 'p1', name: 'Ayşe Yılmaz' }).map(a => a.id)).sort(), [2, 3]);
});

test('rozet HTML yalnız sabit anahtar ve etiket içerir; bilinmeyen anahtar "Zimmetli"', () => {
    const A = load().AssignmentService;
    assert.equal(A.stateBadgeHtml('teslimBekliyor'), '<span class="zim-state zim-state-teslimBekliyor">⏳ Teslim Bekliyor</span>');
    assert.equal(A.stateBadgeHtml('<img src=x>'), '<span class="zim-state zim-state-zimmetli">📌 Zimmetli</span>');
});

test('bekleyen talep sayımı: taslak ve işlenmişler sayılmaz; iade talepleri ayrı toplanır', () => {
    const win = load({}, ['src/ui/request-badge.js']);
    const reqs = ['Beklemede', '', 'BEKLİYOR', 'draft', 'Taslak', 'approved', 'rejected', 'completed', 'Teslim Alındı', 'REDDEDİLDİ']
        .map((durum, i) => ({ id: i, durum }));
    const rets = [{ durum: 'Beklemede' }, { durum: 'approved' }, { durum: 'withdrawn' }];
    assert.deepEqual(plain(win.RequestBadge.countPending(reqs, rets)), { requests: 3, returns: 1, total: 4 });
    assert.deepEqual(plain(win.RequestBadge.countPending(undefined, undefined)), { requests: 0, returns: 0, total: 0 });
});
