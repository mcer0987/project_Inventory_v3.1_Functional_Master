// Faz 5 · K3 (5.3 · ADM-06) — birleşik yedekleme servisinin saf fonksiyonları (BackupService.buildBackup / parseBackup /
// checkRoot / diffSummary). admin-backup.js gerçek dosyasıyla, tarayıcısız (vm) yüklenir; DOM/indirme/geri yükleme yolu
// scratch/flow-tests.js:k3BackupAndVipLoop'ta gerçek sayfada sınanır.
// Usage: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const COLS = ['b1', 'b2', 'b3', 'personel', 'requests'];
const plain = x => JSON.parse(JSON.stringify(x));   // vm realm'inden gelen nesneler için

function loadService() {
    const document = { readyState: 'complete', querySelector: () => null, getElementById: () => null, addEventListener() {} };
    const ctx = vm.createContext({ window: { COLLECTIONS: COLS }, document, console });
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/modules/admin/admin-backup.js'), 'utf8'), ctx, { filename: 'admin-backup.js' });
    return ctx.window.BackupService;
}

const sampleData = () => ({
    b1: [{ id: 'b1_1', ürün: 'Kablo' }, { id: 'b1_2', ürün: 'Mouse' }],
    b2: [{ id: 'b2_1', ürün: 'Laptop' }],
    personel: [{ id: 'p1', name: 'Ayşe', code: 'X' }],
    auditLogs: [{ id: 'a1' }],          // uygulama koleksiyonu değil
    _private: { x: 1 },
});

test('buildBackup: kanonik zarf, yalnız uygulama koleksiyonları, derin kopya', () => {
    const S = loadService();
    const data = sampleData();
    const b = plain(S.buildBackup({ data, root: 'inventory_demo', collections: COLS, source: 'vip', now: new Date('2026-10-13T08:00:00Z') }));
    assert.deepEqual(Object.keys(b).sort(), ['data', 'root', 'source', 'timestamp', 'version']);
    assert.equal(b.version, '3.2');
    assert.equal(b.root, 'inventory_demo');
    assert.equal(b.timestamp, '2026-10-13T08:00:00.000Z');
    assert.equal(b.source, 'vip');
    assert.deepEqual(Object.keys(b.data).sort(), ['b1', 'b2', 'personel'], 'auditLogs ve bilinmeyen anahtarlar girmez; olmayan koleksiyon eklenmez');
    data.b1[0].ürün = 'DEĞİŞTİ';
    assert.equal(b.data.b1[0].ürün, 'Kablo', 'yedek canlı veriye referans tutmaz');
});

test('parseBackup: kanonik biçim', () => {
    const S = loadService();
    const src = JSON.stringify({ version: '3.2', root: 'inventory_demo', timestamp: 't', source: 'admin', data: { b1: [{ id: 'x' }] } });
    const r = plain(S.parseBackup(src, { collections: COLS }));
    assert.equal(r.ok, true);
    assert.equal(r.format, 'canonical');
    assert.equal(r.backup.root, 'inventory_demo');
    assert.equal(r.warnings.length, 0);
});

test('parseBackup: eski v1.0 sarmalı ve VIP ham dökümü tanınır, root yok + uyarı', () => {
    const S = loadService();
    const v1 = plain(S.parseBackup({ version: '1.0', timestamp: 't', data: { b1: [{ id: 'x' }] } }, { collections: COLS }));
    assert.equal(v1.ok, true);
    assert.equal(v1.format, 'legacy-v1');
    assert.equal(v1.backup.root, null);
    assert.ok(v1.warnings.some(w => w.includes('doğrulanamıyor')));

    const raw = plain(S.parseBackup({ b1: [{ id: 'x' }], b2: [], auditLogs: [{ id: 'a' }] }, { collections: COLS }));
    assert.equal(raw.ok, true);
    assert.equal(raw.format, 'legacy-raw');
    assert.deepEqual(Object.keys(raw.backup.data).sort(), ['b1', 'b2']);
    assert.ok(raw.warnings.some(w => w.includes('auditLogs')), 'uygulama dışı anahtar atlanır ve bildirilir');
});

test('parseBackup: geçersiz girdiler reddedilir', () => {
    const S = loadService();
    const bad = s => plain(S.parseBackup(s, { collections: COLS }));
    assert.equal(bad('{bozuk').ok, false);
    assert.equal(bad('[1,2]').ok, false);
    assert.equal(bad(JSON.stringify({ foo: 1 })).ok, false);
    assert.equal(bad(JSON.stringify({ version: '3.2', data: { b1: [] } })).ok, false, 'kanonik ama root yok');
    assert.equal(bad(JSON.stringify({ version: '3.2', root: 'r', data: { b1: 'dizi değil' } })).ok, false);
    const onlyForeign = bad(JSON.stringify({ version: '3.2', root: 'r', data: { auditLogs: [] } }));
    assert.equal(onlyForeign.ok, false, 'geri yüklenecek uygulama koleksiyonu yok');
    const junk = bad(JSON.stringify({ version: '3.2', root: 'r', data: { b1: [{ id: 'a' }, 5, null, [1]] } }));
    assert.equal(junk.ok, true);
    assert.equal(junk.backup.data.b1.length, 1, 'nesne olmayan kayıtlar atlanır');
    assert.ok(junk.warnings.some(w => w.includes('3 geçersiz')));
});

test('checkRoot: eşleşme, farklı ortam engeli, root\'suz eski yedek', () => {
    const S = loadService();
    assert.deepEqual(plain(S.checkRoot({ root: 'inventory_demo' }, 'inventory_demo')).ok, true);
    const wrong = plain(S.checkRoot({ root: 'inventory_demo' }, 'lifeserver_master'));
    assert.equal(wrong.ok, false, 'demo yedeği canlıya basılamaz');
    assert.ok(wrong.reason.includes('inventory_demo') && wrong.reason.includes('lifeserver_master'));
    const legacy = plain(S.checkRoot({ root: null }, 'lifeserver_master'));
    assert.equal(legacy.ok, true);
    assert.equal(legacy.verified, false, 'eski yedek doğrulanamadı olarak işaretlenir (önizlemede uyarı)');
});

test('diffSummary: koleksiyon bazında yedekte/şu an/eklenecek/silinecek', () => {
    const S = loadService();
    const backup = { data: { b1: [{ id: 'b1_1' }, { id: 'b1_9' }], personel: [] } };
    const s = plain(S.diffSummary(backup, sampleData()));
    assert.deepEqual(s, [
        { col: 'b1', backup: 2, current: 2, added: 1, removed: 1 },
        { col: 'personel', backup: 0, current: 1, added: 0, removed: 1 },
    ]);
});
