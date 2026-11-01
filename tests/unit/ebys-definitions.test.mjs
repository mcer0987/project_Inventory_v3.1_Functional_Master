import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const window = { AppModules: {} };
vm.runInNewContext(readFileSync(new URL('../../src/utils/ebys-definitions-schema.js', import.meta.url), 'utf8'), { window });
const S = window.AppModules.EBYSDefinitionsSchema;
const unit = (id, parentUnitId = '', organizationId = 'org') => ({ id, name: id, parentUnitId, organizationId, code: '', active: true });
test('legacy active alanı yoksa etkin; false ise pasif', () => {
    assert.equal(S.active({}), true); assert.equal(S.active({ active: false }), false);
});
test('hiyerarşi döngü, eksik üst birim ve farklı kurum bağlantısını reddeder', () => {
    assert.throws(() => S.validateUnit(unit('a', 'b'), [unit('b', 'a')]), /döngü/);
    assert.throws(() => S.validateUnit(unit('a', 'yok'), []), /bulunamadı/);
    assert.throws(() => S.validateUnit(unit('a', 'b'), [unit('b', '', 'other')]), /aynı kurum/);
    assert.equal(S.validateUnit(unit('a', 'b'), [unit('b')]).parentUnitId, 'b');
});
test('aynı isimli legacy kişiler otomatik eşlenmez, kaynak listeler değişmez', () => {
    const names = ['Ali', 'Ayşe'], people = [{ id: '1', name: 'Ali' }, { id: '2', name: 'Ali' }, { id: '3', name: 'Ayşe' }];
    const result = S.resolveLegacyNames(names, people);
    assert.deepEqual([...result.ids], ['3']); assert.deepEqual([...result.unresolved], ['Ali']);
    assert.deepEqual(names, ['Ali', 'Ayşe']);
});
test('personel bağlantısı ID üzerinden çözülür; eski birim metni bağlantısızken korunur', () => {
    const person = { id: 'p', name: 'Ali', birim: 'Eski Ad', uid: 'auth' };
    assert.equal(S.personnelPatch(person, { unitId: 'b', jobTitle: 'Mühendis' }, [unit('b')]).birim, 'b');
    assert.equal(S.personnelPatch(person, { unitId: '', jobTitle: '' }, []).birim, 'Eski Ad');
    assert.throws(() => S.personnelPatch(person, { unitId: 'b' }, [{ ...unit('b'), active: false }]), /Aktif/);
    assert.equal(person.uid, 'auth'); assert.equal(person.birim, 'Eski Ad');
});
test('beşinci üst birim ve görev HTML yükü reddedilir', () => {
    assert.throws(() => S.validateUnit(unit('0', '1'), [unit('1', '2'), unit('2', '3'), unit('3', '4'), unit('4', '5'), unit('5')]), /dört/);
    assert.throws(() => S.personnelPatch({}, { jobTitle: '<img src=x>' }, []), /geçersiz/);
});
