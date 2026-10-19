// Faz 4B · J8 — oturum deposu (src/utils/session-store.js): giriş kodu oturuma girmez (localStorage + window.currentUser),
// J8 öncesi kodu taşıyan oturumlar okunurken ayıklanır, personel giriş modu ve personel hesabı oturumunun tanınması.
// Gerçek dosya, tarayıcısız (vm) ve bellek içi localStorage ile yüklenir.
// Usage: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const plain = x => JSON.parse(JSON.stringify(x));
function load(extra = {}) {
    const store = new Map();
    const localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
    const sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
    const window = { ...extra };
    const ctx = vm.createContext({ window, localStorage, sessionStorage, console, btoa, atob, escape, unescape, encodeURIComponent, decodeURIComponent });
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/utils/session-store.js'), 'utf8'), ctx, { filename: 'session-store.js' });
    return { S: window.AppModules.Session, window, store };
}

test("setActiveUser: giriş kodu (ve parola/token) ne localStorage'a ne window.currentUser'a yazılır", () => {
    const { S, window, store } = load();
    S.setActiveUser({ id: 'p1', name: 'Ayşe', code: 'k1aaa', uid: 'u1', password: 'x', token: 't' });
    assert.deepEqual(plain(window.currentUser), { id: 'p1', name: 'Ayşe', uid: 'u1' });
    const raw = store.get('activeUser');
    assert.ok(!('code' in S.unmaskUserData(raw)));
    assert.deepEqual(plain(S.getActiveUser()), { id: 'p1', name: 'Ayşe', uid: 'u1' });
});

test('getActiveUser: J8 öncesi kodu taşıyan oturum okunurken ayıklanır ve yeniden yazılır (göç)', () => {
    const { S, store } = load();
    // maskUserData artık kodu ayıkladığı için eski oturum elle üretilir: düz JSON (J3 öncesi biçim de okunuyordu)
    store.set('activeUser', JSON.stringify({ id: 'p1', name: 'Eski', code: 'gizli1' }));
    assert.deepEqual(plain(S.getActiveUser()), { id: 'p1', name: 'Eski' });
    assert.ok(store.get('activeUser').startsWith('m2.'));
    assert.ok(!('code' in S.unmaskUserData(store.get('activeUser'))));
});

test('getStaffAuthMode (J10): sabit "accounts" — sunucudaki eski staffAuthMode değeri yok sayılır', () => {
    const { S, window } = load();
    assert.equal(S.getStaffAuthMode(), 'accounts');
    window.data = { config: { staffAuthMode: 'anonymous' } };
    assert.equal(S.getStaffAuthMode(), 'accounts');
    assert.deepEqual(plain(S.STAFF_AUTH_MODES), ['accounts']);
});

test('isStaffAccountSession: yalnız @staff.medipol.local e-posta/parola oturumu; anonim ve admin değil', () => {
    const { S, window } = load();
    assert.equal(S.isStaffAccountSession(null), false);
    assert.equal(S.isStaffAccountSession({ isAnonymous: true, email: null }), false);
    assert.equal(S.isStaffAccountSession({ isAnonymous: false, email: 'admin@medipol.local' }), false);
    assert.equal(S.isStaffAccountSession({ isAnonymous: false, email: 'P123@STAFF.medipol.local' }), true);
    window.userAuth = { isAnonymous: false, email: 'p1@staff.medipol.local' };
    assert.equal(S.isStaffAccountSession(), true);
    assert.equal(S.isDbAdmin(), false, 'personel hesabı admin değildir');
});
