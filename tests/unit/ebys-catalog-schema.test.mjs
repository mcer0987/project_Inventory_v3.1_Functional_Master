// v3.4 EBYS H6b · Katalog şeması (künye, dosya planı, şablon) ve evrakın taşıdığı kopyalar — saf fonksiyonlar.
// Usage: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const window = {};
const context = vm.createContext({ window, crypto: webcrypto, TextEncoder });
for (const f of ['src/utils/ebys-document-schema.js', 'src/utils/ebys-catalog-schema.js']) vm.runInContext(readFileSync(f, 'utf8'), context);
const C = window.AppModules.EBYSCatalogSchema;
const D = window.AppModules.EBYSDocumentSchema;
const plain = v => JSON.parse(JSON.stringify(v));

test('künye: kod büyük harfe çevrilir; geçersiz kod, boş ad/adres ve etiket reddedilir', () => {
    const p = C.normalizeProfile({ name: ' Medipol ', code: 'med', address: 'İstanbul', phone: '', email: 'a@b.c', web: '' });
    assert.deepEqual(plain(p), { name: 'Medipol', code: 'MED', address: 'İstanbul', phone: '', email: 'a@b.c', web: '' });
    for (const bad of [{ code: 'M' }, { code: 'ME-1' }, { code: 'ABCDEFGHIJKLM' }, { name: '' }, { address: '' }, { name: '<b>x</b>' }]) {
        assert.throws(() => C.normalizeProfile({ name: 'K', code: 'MED', address: 'A', ...bad }), undefined, JSON.stringify(bad));
    }
});

test('evraka giden künye kopyası yalnız görünür alanlar + kaynak revizyondur', () => {
    const snap = D.institutionSnapshot({ id: 'primary', name: 'K', code: 'MED', address: 'A', phone: '1', email: '', web: 'w', revision: 3,
        updatedBy: 'u', updatedAt: 'x' });
    assert.deepEqual(plain(snap), { name: 'K', code: 'MED', address: 'A', phone: '1', email: '', web: 'w', revision: 3 });
    assert.equal(D.institutionSnapshot(null), null);
});

test('dosya planı: kod deseni; seçenekler aktif planlar, kayıtlı pasif/eski değer korunur', () => {
    assert.equal(C.planCode(' 100.01 '), '100.01');
    for (const bad of ['', '.100', '100/2', 'a b', 'x'.repeat(41)]) assert.throws(() => C.planCode(bad), undefined, bad);
    const plans = [{ code: '200', title: 'Mali', active: true }, { code: '100', title: 'İdari', active: true }, { code: '10', title: 'Eski', active: false }];
    assert.deepEqual(C.filePlanOptions(plans).map(o => o.code), ['100', '200'], 'pasif plan yeni seçimde yok; numara sırası');
    const kept = C.filePlanOptions(plans, { filePlanCode: '10', filePlanTitle: 'Eski' });
    assert.equal(kept[0].code, '10');
    assert.equal(kept[0].legacy, true);
    assert.match(kept[0].label, /pasif plan/);
    const free = C.filePlanOptions(plans, { filePlanCode: '934' });
    assert.deepEqual([free[0].code, free[0].title, free[0].legacy], ['934', '', true], 'katalog öncesi serbest kod kaybolmaz');
    const renamed = C.filePlanOptions([{ code: '100', title: 'Yeni ad', active: true }], { filePlanCode: '100', filePlanTitle: 'Eski ad' });
    assert.deepEqual(renamed.map(o => o.title), ['Eski ad', 'Yeni ad'], 'adı değişen planda evrakın kopyası ayrı seçenek olarak kalır');
});

test('evrak üstverisi: plan adı yalnız seçildiyse taşınır', () => {
    const base = { kind: 'internal', unitId: 'u', organizationCode: 'MED', content: 'x',
        metadata: { subject: 's', correspondent: 'c', date: '2026-11-12', filePlanCode: '100', confidentiality: 'Normal', distribution: '', externalRegistrationNo: '' } };
    assert.equal('filePlanTitle' in D.normalize(base).metadata, false);
    assert.equal(D.normalize({ ...base, metadata: { ...base.metadata, filePlanTitle: ' İdari ' } }).metadata.filePlanTitle, 'İdari');
    assert.throws(() => D.normalize({ ...base, metadata: { ...base.metadata, filePlanTitle: 'x'.repeat(161) } }));
});

test('şablon: normalize, sürüm kimliği, bağ ve forma uygulama', () => {
    assert.throws(() => C.normalizeTemplate({ name: '', content: 'x' }));
    assert.throws(() => C.normalizeTemplate({ name: 'A', content: '' }));
    const id = webcrypto.randomUUID();
    assert.equal(C.revisionId(id, 2), `${id}_2`);
    assert.deepEqual(plain(D.templateRef({ templateId: id, revision: 2, name: 'İzin' })), { templateId: id, revision: 2, name: 'İzin' });
    assert.equal(D.templateRef(null), null);
    for (const bad of [{ templateId: 'x', revision: 1, name: 'a' }, { templateId: id, revision: 0, name: 'a' }, { templateId: id, revision: 1.5, name: 'a' }]) {
        assert.throws(() => D.templateRef(bad));
    }
    assert.equal(D.sameRef({ templateId: id, revision: 1, name: 'a' }, { templateId: id, revision: 1, name: 'a' }), true);
    assert.equal(D.sameRef({ templateId: id, revision: 1, name: 'a' }, { templateId: id, revision: 2, name: 'a' }), false);
    assert.equal(D.sameRef(null, undefined), true);
    const applied = C.applyTemplate({ templateId: id, revision: 3, name: 'İzin', subject: '', content: 'Metin' }, { subject: 'Mevcut konu' });
    assert.deepEqual(plain(applied), { subject: 'Mevcut konu', content: 'Metin', letterTemplate: { templateId: id, revision: 3, name: 'İzin' } });
});

test('kişisel şablon (v3.7 İP-11): normalize sınır/etiket kontrolü ve letterTemplate:null uygulama', () => {
    const ok = C.normalizePersonalTemplate({ name: ' İzin Şablonum ', subject: '', content: 'Gereğini arz ederim.\r\nSaygılarımla.' });
    assert.deepEqual(plain(ok), { name: 'İzin Şablonum', subject: '', content: 'Gereğini arz ederim.\nSaygılarımla.' });
    for (const bad of [
        null,
        { name: '', content: 'x' },
        { name: 'x'.repeat(121), content: 'x' },
        { name: 'A', subject: 'x'.repeat(241), content: 'x' },
        { name: 'A', content: '' },
        { name: 'A', content: 'x'.repeat(40001) },
        { name: '<script>x</script>', content: 'ok' },
        { name: 'A', subject: '<img src=x>', content: 'ok' },
        { name: 'A', content: '<b>Yasak</b>' },
    ]) {
        assert.throws(() => C.normalizePersonalTemplate(bad), undefined, JSON.stringify(bad));
    }
    const appliedKeep = C.applyPersonalTemplate({ name: 'Özel', subject: '', content: 'Kişisel metin' }, { subject: 'Taslak konusu' });
    assert.deepEqual(plain(appliedKeep), { subject: 'Taslak konusu', content: 'Kişisel metin', letterTemplate: null });
    const appliedOverride = C.applyPersonalTemplate({ name: 'Özel', subject: 'Yeni konu', content: 'Kişisel metin' }, { subject: 'Eski konu' });
    assert.deepEqual(plain(appliedOverride), { subject: 'Yeni konu', content: 'Kişisel metin', letterTemplate: null });
});

test('vekâlet şeması (v3.8 VP-4): deterministik pt_<uid> kimliği, 1–168 saat sınırı, gerekçe/etiket kontrolü ve aktiflik', () => {
    assert.equal(C.delegationId(' uid_personel_1 '), 'pt_uid_personel_1');
    const d = C.normalizeDelegation({ ownerUid: 'userA', reason: ' Yıllık izin süresince evrak takibi ', durationHours: 48 });
    assert.deepEqual(plain(d), {
        id: 'pt_userA',
        ownerUid: 'userA',
        scope: 'personalTemplates',
        reason: 'Yıllık izin süresince evrak takibi',
        durationHours: 48,
        durationMs: 48 * 3600000,
    });
    for (const bad of [
        null,
        { ownerUid: '', reason: 'Geçerli gerekçe', durationHours: 24 },
        { ownerUid: 'u', reason: 'kısa', durationHours: 24 },
        { ownerUid: 'u', reason: 'x'.repeat(241), durationHours: 24 },
        { ownerUid: 'u', reason: '<script>alert(1)</script>', durationHours: 24 },
        { ownerUid: 'u', reason: 'Geçerli gerekçe', durationHours: 0 },
        { ownerUid: 'u', reason: 'Geçerli gerekçe', durationHours: -5 },
        { ownerUid: 'u', reason: 'Geçerli gerekçe', durationHours: 169 },
    ]) {
        assert.throws(() => C.normalizeDelegation(bad), undefined, JSON.stringify(bad));
    }
    const now = 1764000000000;
    assert.equal(C.isDelegationActive({ scope: 'personalTemplates', revoked: false, expiresAt: { toMillis: () => now + 60000 } }, now), true);
    assert.equal(C.isDelegationActive({ scope: 'personalTemplates', revoked: true, expiresAt: { toMillis: () => now + 60000 } }, now), false);
    assert.equal(C.isDelegationActive({ scope: 'personalTemplates', revoked: false, expiresAt: { toMillis: () => now - 1 } }, now), false);
    assert.equal(C.isDelegationActive(null, now), false);
});
