import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
const window = { AppModules: {} };
vm.runInNewContext(readFileSync('src/utils/ebys-document-schema.js','utf8'), { window, crypto: webcrypto, TextEncoder });
const s = window.AppModules.EBYSDocumentSchema;
const input = { kind:'incoming', unitId:'u', organizationCode:'MED', content:'Sayın ilgili,\nİşlem yapılmasını rica ederim.',
    metadata:{ subject:'Konu', correspondent:'Kurum', date:'2026-11-02', filePlanCode:'934.01', confidentiality:'Normal', distribution:'Birim A\nBirim B', externalRegistrationNo:'' } };
test('evrak metni ve üstverisi sınırlandırılır; HTML ve geçersiz tarihler reddedilir', () => {
    assert.equal(s.normalize(input).metadata.distribution, 'Birim A\nBirim B');
    for (const bad of [{...input, content:'<script>alert(1)</script>'}, {...input, kind:'bad'}, {...input, metadata:{...input.metadata,date:'2026-02-30'}}, {...input, organizationCode:'../MED'}, {...input, content:'a'.repeat(40001)}]) assert.throws(()=>s.normalize(bad));
});
test('evrak numarası 128 bit rastgelelik içerir; tarih ve kurum kodu doğru', () => {
    const numbers = new Set(Array.from({length:1000},()=>s.registrationNo('MED',new Date('2026-11-02T12:00:00Z'))));
    assert.equal(numbers.size,1000); assert.match([...numbers][0],/^EBYS-MED-261102-[A-F0-9]{32}$/);
});
test('sürüm özeti alan sırasından bağımsız; içerik değişikliğini ayırt eder', async () => {
    assert.equal(await s.digest({a:1,b:2}),await s.digest({b:2,a:1}));
    assert.notEqual(await s.digest({content:'a'}),await s.digest({content:'b'}));
});
