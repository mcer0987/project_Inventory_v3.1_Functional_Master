import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, collection, getDocs, getDoc, setDoc, updateDoc, deleteDoc, runTransaction, writeBatch, setLogLevel } from 'firebase/firestore';
setLogLevel('silent');
let env, db;
const root = 'inventory_demo';
const ref = (db, col, id) => doc(db, root, col, 'items', id);
const unit = (id, parentUnitId = '', organizationId = 'org') => ({ id, name: id, parentUnitId, organizationId, code: id, active: true, personnel: [] });
before(async () => {
    env = await initializeTestEnvironment({ projectId: 'demo-ebys-definitions', firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
    db = env.authenticatedContext('admin', { email: 'admin@medipol.local', firebase: { sign_in_provider: 'password' } }).firestore();
});
after(async () => env?.cleanup());
beforeEach(async () => { await env.clearFirestore(); });
test('admin hiyerarşi kurar; self-cycle, cross-org, eksik üst ve batch döngüsü reddedilir', async () => {
    await assertSucceeds(setDoc(ref(db, 'units', 'a'), unit('a')));
    await assertSucceeds(setDoc(ref(db, 'units', 'b'), unit('b', 'a')));
    await assertFails(updateDoc(ref(db, 'units', 'a'), { parentUnitId: 'b' }));
    await assertFails(setDoc(ref(db, 'units', 'x'), unit('x', 'x')));
    await assertFails(setDoc(ref(db, 'units', 'x'), unit('x', 'a', 'other')));
    await assertFails(setDoc(ref(db, 'units', 'x'), unit('x', 'missing')));
    const batch = writeBatch(db); batch.set(ref(db, 'units', 'x'), unit('x', 'y')); batch.set(ref(db, 'units', 'y'), unit('y', 'x'));
    await assertFails(batch.commit());
});
test('silme yasak; pasifleştirme kayıt ve kalıcı IDyi korur', async () => {
    await setDoc(ref(db, 'units', 'a'), unit('a'));
    await setDoc(ref(db, 'personel', 'p'), { id: 'p', name: 'Ali', unitId: 'a', uid: 'auth-p' });
    await assertFails(deleteDoc(ref(db, 'units', 'a'))); await assertFails(deleteDoc(ref(db, 'personel', 'p')));
    await assertFails(updateDoc(ref(db, 'personel', 'p'), { id: 'changed' }));
    await assertFails(updateDoc(ref(db, 'personel', 'p'), { uid: 'other-account' }));
    await assertSucceeds(updateDoc(ref(db, 'personel', 'p'), { active: false }));
    assert.equal((await getDoc(ref(db, 'personel', 'p'))).data().uid, 'auth-p');
    await assertSucceeds(updateDoc(ref(db, 'units', 'a'), { active: false }));
    await assertFails(setDoc(ref(db, 'units', 'child'), unit('child', 'a')));
    await assertFails(setDoc(ref(db, 'personel', 'new'), { id: 'new', name: 'Yeni', unitId: 'a' }));
    await assertSucceeds(updateDoc(ref(db, 'personel', 'p'), { active: true }));
    await assertFails(updateDoc(ref(db, 'units', 'a'), { organizationId: 'other-org' }));
});
test('pasif personel veri okuyamaz; eski active alanı olmayan hesap çalışır', async () => {
    await env.withSecurityRulesDisabled(async ctx => {
        const raw = ctx.firestore();
        await setDoc(ref(raw, 'personel', 'p'), { id: 'p', name: 'Ali', pri: 'ali', uid: 'uid-p' });
        await setDoc(ref(raw, 'staffAccounts', 'uid-p'), { personelId: 'p', pri: 'ali' });
        await setDoc(ref(raw, 'accessGate', 'staff'), { staffAccessEnabled: true });
    });
    const staff = env.authenticatedContext('uid-p', { email: 'ali@staff.medipol.local', firebase: { sign_in_provider: 'password' } }).firestore();
    await assertSucceeds(getDoc(ref(staff, 'personel', 'p')));
    await assertFails(updateDoc(ref(staff, 'personel', 'p'), { unitId: 'a', jobTitle: 'Yönetici' }));
    await updateDoc(ref(db, 'personel', 'p'), { active: false });
    await assertFails(getDoc(ref(staff, 'personel', 'p')));
});
test('gerçek servis transactionları legacy alanları, UID ve satın alma kaydını korur', async () => {
    const window = { AppModules: {}, AppEnv: { COLLECTION_ROOT: root }, isDbAdmin: () => true };
    // VM realm nesnelerini SDK'nın çalıştığı realm'e taşır; gerçek transaction ve Rules değişmez.
    const plain = value => JSON.parse(JSON.stringify(value));
    const bridgeTransaction = (db, fn) => runTransaction(db, tx => fn({
        get: reference => tx.get(reference),
        set: (reference, value) => tx.set(reference, plain(value)),
        update: (reference, value) => tx.update(reference, plain(value)),
    }));
    const context = vm.createContext({ window, crypto: webcrypto, console, doc, collection, getDocs, runTransaction: bridgeTransaction, fireDb: db });
    vm.runInContext(readFileSync('src/utils/ebys-definitions-schema.js', 'utf8'), context);
    vm.runInContext(readFileSync('src/services/ebys-definitions.js', 'utf8').replace(/^import .*$/gm, ''), context);
    const api = window.AppModules.EBYSDefinitions;
    await setDoc(ref(db, 'units', 'a'), { id: 'a', name: 'Eski birim', personnel: ['Aynı Ad'], note: 'legacy' });
    await setDoc(ref(db, 'personel', 'p'), { id: 'p', name: 'Aynı Ad', uid: 'uid-p', birim: 'Eski birim', pri: 'same' });
    await setDoc(ref(db, 'personel', 'p2'), { id: 'p2', name: 'Aynı Ad', uid: 'uid-p2' });
    const purchase = { id: 'po', birim: 'Eski birim', talepEden: 'Aynı Ad', workflow: { started: false, steps: [] } };
    await setDoc(ref(db, 'purchaseOrders', 'po'), purchase);
    await api.saveUnit({ id: 'a', name: 'Yeni birim', organizationId: 'org', personnelIds: ['p2'], expectedRevision: 0 });
    const saved = (await getDoc(ref(db, 'units', 'a'))).data();
    assert.deepEqual(saved.personnelIds, ['p2']); assert.deepEqual(saved.personnel, ['Aynı Ad']); assert.equal(saved.note, 'legacy');
    await assert.rejects(api.saveUnit({ id: 'a', name: 'Bayat', expectedRevision: 0 }), /değişmiş/);
    await api.savePersonnel({ id: 'p', name: 'Aynı Ad' }, { unitId: 'a', jobTitle: 'Mühendis', active: true });
    await api.setActive('personel', 'p', false);
    const person = (await getDoc(ref(db, 'personel', 'p'))).data();
    assert.equal(person.uid, 'uid-p'); assert.equal(person.id, 'p'); assert.equal(person.jobTitle, 'Mühendis');
    assert.deepEqual((await getDoc(ref(db, 'purchaseOrders', 'po'))).data(), purchase);
    await assertFails(setDoc(doc(db, 'not-an-environment', 'units', 'items', 'a'), unit('a')));
});
