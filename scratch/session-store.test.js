// Usage: node scratch/session-store.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const store = {};
const storage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
};
const win = { localStorage: storage, sessionStorage: { ...storage, removeItem: () => {} } };
const ctx = vm.createContext({
    window: win, localStorage: storage, sessionStorage: win.sessionStorage,
    btoa: s => Buffer.from(s, 'latin1').toString('base64'),
    atob: s => Buffer.from(s, 'base64').toString('latin1'),
    escape, unescape, encodeURIComponent, decodeURIComponent, JSON, Object, String, console,
});
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src/utils/session-store.js'), 'utf8'), ctx);
const S = win.AppModules.Session;

const turkish = { name: 'Şükrü Çağlayan İğdeli', code: '12345', password: 'x' };
assert.ok(S.setActiveUser(turkish), 'setActiveUser must succeed for Turkish names');
assert.ok(store.activeUser.startsWith('m2.'), 'new format prefix');
assert.deepStrictEqual(S.getActiveUser(), { name: turkish.name, code: '12345' }, 'round trip strips password');
assert.strictEqual(win.currentUser, turkish, 'currentUser synced');

store.activeUser = JSON.stringify({ name: 'Ayşe', code: '1' });
assert.strictEqual(S.getActiveUser().name, 'Ayşe', 'plain JSON is read');
assert.ok(store.activeUser.startsWith('m2.'), 'plain JSON migrated');

const salt = 'x9k2mP@7vQ3sT1wZ';
const legacy = Buffer.from([...JSON.stringify({ name: 'Admin', role: 'admin' })]
    .map((c, i) => String.fromCharCode(c.charCodeAt(0) ^ salt.charCodeAt(i % salt.length))).join(''), 'latin1').toString('base64');
store.activeUser = legacy;
assert.strictEqual(S.getActiveUser().name, 'Admin', 'legacy masked is read');
assert.ok(store.activeUser.startsWith('m2.'), 'legacy migrated');

store.activeUser = 'garbage%%';
assert.strictEqual(S.getActiveUser(), null, 'corrupt value → null');
assert.strictEqual(S.isAppLoggedIn(), false);

win.userAuth = { isAnonymous: true, email: null };
assert.strictEqual(S.isDbAdmin(), false, 'anonymous is not admin');
win.userAuth = { isAnonymous: false, email: 'admin@medipol.local' };
assert.strictEqual(S.isDbAdmin(), true, 'admin email session is admin');
win.userAuth = { isAnonymous: false, email: 'other@x.com' };
assert.strictEqual(S.isDbAdmin(), false, 'other email is not admin');

S.setActiveUser({ name: 'X' });
S.clearSession();
assert.strictEqual(store.activeUser, undefined, 'clearSession removes activeUser');
assert.strictEqual(win.currentUser, null);

console.log('session-store: all assertions passed');
