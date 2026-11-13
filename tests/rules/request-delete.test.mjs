// [WHY]: v3.7 · İP-7 — talep silme saveData('requests', kalanlar) yerine ID tabanlı removeItem / bulkRemove'a geçti. İkisi de
//        applyItemOps'un tek writeBatch'inde doküman başına delete gönderir. Kuralın bu biçimi yalnız yöneticiye açtığı ve
//        personelin (kendi talebi olsa bile) tekil ya da toplu silemediği emülatörde sabitlenir.
// [HOW]: Talepler kurallar kapalıyken tohumlanır; silmeler istemcinin gönderdiği biçimde (deleteDoc / writeBatch.delete) denenir.
import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, deleteDoc, writeBatch, setLogLevel } from 'firebase/firestore';

setLogLevel('silent');
const LIVE = 'lifeserver_master';
let env;

const admin = () => env.authenticatedContext('admin-uid', { email: 'admin@medipol.local', firebase: { sign_in_provider: 'password' } }).firestore();
const staff = () => env.authenticatedContext('uid-s1', { email: 'ayse.yilmaz@staff.medipol.local', firebase: { sign_in_provider: 'password' } }).firestore();
const item = (db, id) => doc(db, LIVE, 'requests', 'items', String(id));
const exists = async id => {
    let found;
    await env.withSecurityRulesDisabled(async c => { found = (await getDoc(item(c.firestore(), id))).exists(); });
    return found;
};
const batchDelete = (db, ids) => { const b = writeBatch(db); ids.forEach(id => b.delete(item(db, id))); return b.commit(); };

before(async () => {
    env = await initializeTestEnvironment({ projectId: 'demo-request-delete', firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
});
after(async () => env?.cleanup());
beforeEach(async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async c => {
        const db = c.firestore();
        const b = writeBatch(db);
        ['r1', 'r2', 'r3'].forEach(id => b.set(item(db, id), { id, durum: 'Beklemede', personel: 'Ayşe Yılmaz', personelUid: 'uid-s1', urun: 'Mouse', adet: 1 }));
        await b.commit();
    });
});

describe('talep silme (İP-7: removeItem / bulkRemove)', () => {
    test('yönetici tek talebi id ile siler (removeItem)', async () => {
        await assertSucceeds(deleteDoc(item(admin(), 'r1')));
        assert.equal(await exists('r1'), false);
        assert.equal(await exists('r2'), true);
    });
    test('yönetici seçili talepleri tek batch\'te siler (bulkRemove)', async () => {
        await assertSucceeds(batchDelete(admin(), ['r1', 'r2']));
        assert.deepEqual([await exists('r1'), await exists('r2'), await exists('r3')], [false, false, true]);
    });
    test('personel kendi talebini tekil ya da toplu silemez', async () => {
        await assertFails(deleteDoc(item(staff(), 'r1')));
        await assertFails(batchDelete(staff(), ['r1', 'r2']));
        assert.deepEqual([await exists('r1'), await exists('r2')], [true, true]);
    });
});
