import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function loadSchema() {
    const window = { AppModules: { Html: { findTagLike: fields => Object.keys(fields).find(key => /<[a-zA-Z/!?]/.test(fields[key] || '')) || null } } };
    vm.runInContext(readFileSync('src/utils/manual-exit-schema.js', 'utf8'), vm.createContext({ window }));
    return window.ManualExitSchema;
}

function input(overrides = {}) {
    return {
        id: 'exit-1', kime: 'VIP Personel', nereye: 'Ameliyathane', cihaz: 'Monitör',
        sn: '', envanterNo: 'ENV-01', isDemirbas: true, adet: '2', ekNot: '',
        cikisiIsteyen: 'Yönetici', personelId: 'admin', actorUid: 'uid-admin',
        tarih: '02.11.2026 10:00', ts: 1793602800000, ...overrides,
    };
}

test('kayıt dışı çıkış şeması temel alanları normalize eder', () => {
    const { record, errors } = loadSchema().build(input({ kime: '  VIP Personel  ', adet: '3' }));
    assert.equal(errors.length, 0);
    assert.equal(record.kime, 'VIP Personel');
    assert.equal(record.adet, 3);
    assert.equal(record.sema, 1);
});

test('uygulamanın sayısal id üretimi belge kimliği olarak metne çevrilir', () => {
    const { record, errors } = loadSchema().build(input({ id: 1793602800123 }));
    assert.equal(record.id, '1793602800123');
    assert.equal(errors.length, 0);
});

test('demirbaş kaydında envanter numarası zorunludur; demirbaş değilse boş olabilir', () => {
    const schema = loadSchema();
    assert.ok(schema.build(input({ envanterNo: '' })).errors.includes('Demirbaş için Envanter No zorunludur.'));
    assert.equal(schema.build(input({ isDemirbas: false, envanterNo: '' })).errors.length, 0);
});

test('boş zorunlu alan, geçersiz adet ve etiket benzeri metin reddedilir', () => {
    const schema = loadSchema();
    assert.ok(schema.build(input({ nereye: ' ' })).errors.some(error => error.includes('nereye zorunludur')));
    assert.ok(schema.build(input({ adet: '1.5' })).errors.includes('Adet en az 1 olan tam sayı olmalıdır.'));
    assert.ok(schema.build(input({ cihaz: '<img src=x>' })).errors.some(error => error.includes('etiket benzeri')));
});
