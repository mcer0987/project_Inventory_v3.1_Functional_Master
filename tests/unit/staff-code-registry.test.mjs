// Faz 4B · J7.5 → J10 — personel giriş kodu biçim kuralı ve öneri (src/utils/staff-code-registry.js). Gerçek dosya,
// tarayıcısız (vm). J10'da kod → kişi çözümü ve çakışma araçları kaldırıldı.
// Usage: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const plain = x => JSON.parse(JSON.stringify(x));
function load() {
    const ctx = vm.createContext({ window: {}, console });
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/utils/staff-code-registry.js'), 'utf8'), ctx, { filename: 'staff-code-registry.js' });
    return ctx.window.StaffCodeRegistry;
}
const P = () => [
    { id: 'a', name: 'Ali', code: 'kod11', uid: 'u-a' },
    { id: 'b', name: 'Ayşe', code: 'kod11' },
    { id: 'c', name: 'Can', code: ' kod11 ' },          // kırpınca aynı
    { id: 'd', name: 'Deniz', code: 'KOD11' },          // harf duyarlı → farklı
    { id: 'e', name: 'Ece', code: 'xyz99' },
    { id: 'f', name: 'Fırat', code: 'pair1' },
    { id: 'g', name: 'Gül', code: 'pair1', uid: 'u-g' },
    { id: 'h', name: 'Kodsuz' },
];

test('normCode / findConflicts: girişle aynı (kırpılmış, harf duyarlı); excludeId kişinin kendisini dışlar', () => {
    const R = load();
    assert.equal(R.normCode('  ab12 '), 'ab12');
    assert.equal(R.normCode(null), '');
    assert.deepEqual(R.findConflicts(P(), 'kod11').map(p => p.id), ['a', 'b', 'c']);
    assert.deepEqual(R.findConflicts(P(), 'kod11', { excludeId: 'b' }).map(p => p.id), ['a', 'c']);
    assert.deepEqual(R.findConflicts(P(), 'KOD11').map(p => p.id), ['d']);
    assert.deepEqual(plain(R.findConflicts(P(), '').map(p => p.id)), []);
});

test('validateCode: boş / boşluk / kısa / çakışma / partide ayrılmış; mesaj kodun kendisini içermez', () => {
    const R = load();
    const r = (code, opts) => plain(R.validateCode(code, P(), opts));
    assert.equal(r('').reason, 'empty');
    assert.equal(r('ab 12').reason, 'whitespace');
    assert.equal(r('ab1').reason, 'too-short');
    const dup = r('xyz99');
    assert.equal(dup.reason, 'duplicate');
    assert.match(dup.message, /Ece/);
    assert.ok(!dup.message.includes('xyz99'));
    assert.equal(r('xyz99', { excludeId: 'e' }).ok, true, 'kişinin kendi kodu kendisiyle çakışmaz');
    assert.equal(r('yeni1', { reserved: ['yeni1'] }).reason, 'duplicate');
    assert.equal(r('yeni1').ok, true);
    assert.equal(r('  yeni1  ').ok, true);
});

test('suggestCode: listede ve ayrılmışlarda olmayan, okunaklı alfabeden, sabit uzunlukta; çakışmada yeniden dener', () => {
    const R = load();
    const seq = [0, 0, 0, 0, 0, /* "aaaaa" — alınmış */ 0.5, 0.5, 0.5, 0.5, 0.5];
    let i = 0;
    const rng = () => seq[i++ % seq.length];
    const people = [{ id: 1, code: 'aaaaa' }];
    const c = R.suggestCode(people, { rng });
    assert.notEqual(c, 'aaaaa');
    assert.equal(c.length, 5);
    for (let k = 0; k < 200; k++) {
        const s = R.suggestCode(P());
        assert.match(s, /^[abcdefghjkmnpqrstuvwxyz23456789]{5}$/, 'karıştırılan 0/o/1/l/i yok');
        assert.equal(R.validateCode(s, P()).ok, true);
    }
    assert.throws(() => R.suggestCode([{ code: 'aaaaa' }], { rng: () => 0, maxTries: 5 }), /elle girin/);
});
