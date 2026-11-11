import {test} from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import{readFileSync}from'node:fs';
const window={AppModules:{}};vm.runInNewContext(readFileSync('src/utils/ebys-process-schema.js','utf8'),{window});const s=window.AppModules.EBYSProcessSchema;
test('rota adımları kalıcı ID ve desteklenen görev türleriyle doğrulanır',()=>{const r=s.route([{personnelId:'p',kind:'paraf'}]);assert.equal(r[0].dueHours,72);assert.equal(r[0].stepId,'step-0');for(const bad of [[],Array(7).fill({personnelId:'p',kind:'approval'}),[{personnelId:'p',kind:'e_sign'}],[{personnelId:'../p',kind:'approval'}],[{personnelId:'p',kind:'approval',dueHours:900}]])assert.throws(()=>s.route(bad));});
test('red/iade gerekçesi zorunlu, etiket ve aşırı uzun metin yasak',()=>{assert.equal(s.reason('approved',''),'');for(const [r,v]of [['rejected',''],['returned','  '],['approved','<script>'],['approved','a'.repeat(1001)]])assert.throws(()=>s.reason(r,v));});

const timestamp = millis => ({ toMillis: () => millis });
test('H0 yeni görev süresi sunucu başlangıcından hesaplanır; dueAt yetkiyi değiştirmez', () => {
    const start = 1800000000000, end = start + 90 * 86400000;
    const task = { validFrom: timestamp(start), validForSeconds: 7776000, validUntil: null, dueAt: timestamp(start + 3600000) };
    assert.equal(s.taskExpiryMillis(task), end);
    // Başlangıç dahil, bitiş hariç: UI'daki süre karşılaştırmasının tam sınırı.
    const live = now => now >= start && now < s.taskExpiryMillis(task);
    assert.equal(live(start - 1), false);
    assert.equal(live(start), true);
    assert.equal(live(end - 1), true);
    assert.equal(live(end), false);
    assert.equal(live(end + 1), false);
    assert.equal(s.taskExpiryMillis({ ...task, dueAt: timestamp(end + 86400000) }), end);
});
test('H0 eski görev ve açık tarihli vekâlet bitişi aynen okunur', () => {
    const start = 1800000000000, end = start + 86400000;
    assert.equal(s.taskExpiryMillis({ validFrom: timestamp(start), validUntil: timestamp(end) }), end);
    assert.equal(s.taskExpiryMillis({ validFrom: timestamp(1), validUntil: timestamp(2) }), 2);
});
test('H0 geçersiz göreli süre eski bitişe düşmez ve UI erişim açmaz', () => {
    const task = { validFrom: timestamp(1800000000000), validUntil: null, validForSeconds: 7776000 };
    for (const validForSeconds of [0, -1, 1.5, '7776000', null, undefined, 7776001]) {
        assert.equal(s.taskExpiryMillis({ ...task, validForSeconds }), 0);
        assert.equal(s.taskExpiryMillis({ ...task, validForSeconds, validUntil: timestamp(1900000000000) }), 0);
    }
    for (const invalid of [{}, { ...task, validFrom: null }, { ...task, validUntil: timestamp(1900000000000) },
        { validFrom: timestamp(10), validUntil: timestamp(10) }, { validFrom: timestamp(10), validUntil: timestamp(1) }]) {
        assert.equal(s.taskExpiryMillis(invalid), 0);
    }
});
