import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import * as sdk from 'firebase/firestore';

let env;
const root = 'inventory_demo';
const validRecord = (id, overrides = {}) => ({
    id, sema: 1, kime: 'VIP Personel', nereye: 'Ameliyathane', cihaz: 'Monitör',
    sn: '', envanterNo: 'ENV-01', isDemirbas: true, adet: 2, ekNot: '',
    cikisiIsteyen: 'Yönetici', personelId: 'admin', actorUid: 'uid-admin',
    tarih: '02.11.2026 10:00', ts: Date.now(), ...overrides,
});
const recordRef = (id, db) => sdk.doc(db, root, 'manualExits', 'items', id);

before(async () => {
    env = await initializeTestEnvironment({
        projectId: 'demo-manual-exits',
        firestore: { rules: readFileSync('firestore.rules', 'utf8') },
    });
});
after(async () => env?.cleanup());

test('admin can listen to manual exits in live and demo roots; guests and unknown roots are denied', async () => {
    const admin = env.authenticatedContext('uid-admin', {
        email: 'admin@medipol.local', firebase: { sign_in_provider: 'password' },
    }).firestore();
    for (const scope of ['lifeserver_master', 'inventory_demo']) {
        await assertSucceeds(sdk.getDocs(sdk.collection(admin, scope, 'manualExits', 'items')));
        await assertFails(sdk.getDocs(sdk.collection(env.unauthenticatedContext().firestore(), scope, 'manualExits', 'items')));
    }
    await assertFails(sdk.getDocs(sdk.collection(admin, 'unknown_root', 'manualExits', 'items')));
});

test('linked staff can read manual exits; unlinked accounts cannot', async () => {
    await env.withSecurityRulesDisabled(async context => {
        const store = context.firestore();
        for (const scope of ['lifeserver_master', 'inventory_demo']) {
            await sdk.setDoc(sdk.doc(store, scope, 'personel', 'items', 'reader'), { id: 'reader', name: 'Okuyucu', uid: 'uid-reader', pri: 'okuyucu.test', active: true });
            await sdk.setDoc(sdk.doc(store, scope, 'staffAccounts', 'items', 'uid-reader'), { personelId: 'reader', pri: 'okuyucu.test' });
            await sdk.setDoc(sdk.doc(store, scope, 'accessGate', 'items', 'staff'), { staffAccessEnabled: true });
        }
    });
    const staff = env.authenticatedContext('uid-reader', { email: 'okuyucu.test@staff.medipol.local', firebase: { sign_in_provider: 'password' } }).firestore();
    const stranger = env.authenticatedContext('uid-stranger', { email: 'okuyucu.test@staff.medipol.local', firebase: { sign_in_provider: 'password' } }).firestore();
    for (const scope of ['lifeserver_master', 'inventory_demo']) {
        await assertSucceeds(sdk.getDocs(sdk.collection(staff, scope, 'manualExits', 'items')));
        await assertFails(sdk.getDocs(sdk.collection(stranger, scope, 'manualExits', 'items')));
    }
});

test('admin can save a valid standalone exit; non-asset entries can omit inventory number', async () => {
    const admin = env.authenticatedContext('uid-admin', {
        email: 'admin@medipol.local', firebase: { sign_in_provider: 'password' },
    }).firestore();
    const asset = validRecord(webcrypto.randomUUID());
    await assertSucceeds(sdk.setDoc(recordRef(asset.id, admin), asset));
    const nonAsset = validRecord(webcrypto.randomUUID(), { isDemirbas: false, envanterNo: '' });
    await assertSucceeds(sdk.setDoc(recordRef(nonAsset.id, admin), nonAsset));
});

test('rules reject invalid asset identifiers, malformed quantities, and untrusted writers', async () => {
    const admin = env.authenticatedContext('uid-admin', {
        email: 'admin@medipol.local', firebase: { sign_in_provider: 'password' },
    }).firestore();
    const missingInventory = validRecord(webcrypto.randomUUID(), { envanterNo: '' });
    await assertFails(sdk.setDoc(recordRef(missingInventory.id, admin), missingInventory));
    const invalidQuantity = validRecord(webcrypto.randomUUID(), { adet: 1.5 });
    await assertFails(sdk.setDoc(recordRef(invalidQuantity.id, admin), invalidQuantity));
    const staff = env.authenticatedContext('uid-staff', {
        email: 'staff@medipol.local', firebase: { sign_in_provider: 'password' },
    }).firestore();
    const unauthorized = validRecord(webcrypto.randomUUID());
    await assertFails(sdk.setDoc(recordRef(unauthorized.id, staff), unauthorized));
});
