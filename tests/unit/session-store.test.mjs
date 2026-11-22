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


// KURAL 5 · Bilinçli sıkılaştırma (İP-7 Aşama B): eski inventoryLiveAdmin claim ve setFirebaseAuthClaims kaldırıldı.
test('İP-7 Aşama B: sahte yönetici rolü ve kaldırılan claim yolu artık isDbAdmin() sonucunu true yapmaz', () => {
    const user = { uid: 'u1', email: 'p1@staff.medipol.local', isAnonymous: false };
    const { S } = load({ userAuth: user, AppEnv: { COLLECTION_ROOT: 'lifeserver_master' } });
    S.setActiveUser({ name: 'Muhammed Cer', role: 'admin' });
    assert.equal(S.isDbAdmin(), false);
    assert.equal(S.isStaffAccountSession(), true);
    assert.equal('setFirebaseAuthClaims' in S, false, 'eski setFirebaseAuthClaims köprüsü kaldırıldı');
});

// İP-7 (Aşama A) — ana yöneticinin verdiği yönetici yetkisi (staffAccounts/{uid}.adminGranted): arayüz kararı yalnız aynı personel
// oturumuna bağlı; ortam kökünden bağımsız (eşleme zaten köke göre okunur); çıkışta temizlenir. Claim yolu (yukarıdaki test) korunur.
test('İP-7 setStaffAdminGrant: yalnız personel oturumunda ve aynı oturum için yönetici; demo kökünde de geçerli', () => {
    const user = { uid: 'u1', email: 'p1@staff.medipol.local', isAnonymous: false };
    const { S, window } = load({ userAuth: user, AppEnv: { COLLECTION_ROOT: 'inventory_demo' } });
    assert.equal(S.isDbAdmin(), false);
    S.setStaffAdminGrant(user, { personelId: 'p1', adminGranted: false });
    assert.equal(S.isDbAdmin(), false, 'geri alınmış yetki');
    S.setStaffAdminGrant(user, { personelId: 'p1', adminGranted: 'true' });
    assert.equal(S.isDbAdmin(), false, 'yalnız bool true');
    S.setStaffAdminGrant(user, { personelId: 'p1', adminGranted: true, adminReason: 'BT sorumlusu', adminChangedBy: 'admin-uid', adminAuditId: 'al_1' });
    assert.equal(S.isDbAdmin(), true, 'kök ayrımı eşleme okumasında (K3); istemci kararı köke bakmaz');
    assert.deepEqual(plain(S.getStaffAdminGrant()), { uid: 'u1', adminChangedBy: 'admin-uid', adminReason: 'BT sorumlusu', adminAuditId: 'al_1' });
    window.userAuth = { ...user, uid: 'u2' };
    assert.equal(S.isDbAdmin(), false, 'başka oturum yetkiyi devralmaz');
    assert.equal(S.getStaffAdminGrant(), null);
    window.userAuth = user;
    assert.equal(S.isDbAdmin(), true);
    S.setStaffAdminGrant(user, null);
    assert.equal(S.isDbAdmin(), false, 'eşleme silindi / okunamadı → yetki yok');
    const admin = { uid: 'a1', email: 'admin@medipol.local', isAnonymous: false };
    S.setStaffAdminGrant(admin, { adminGranted: true });
    window.userAuth = { uid: 'a1', email: 'someone@medipol.local', isAnonymous: false };
    assert.equal(S.isDbAdmin(), false, 'personel oturumu olmayan hesaba belge yetkisi uygulanmaz');
});

test('İP-7 canManageAdmins: yalnız ana yönetici; ek yönetici (belge) yönetici olsa da yetki dağıtamaz', () => {
    const user = { uid: 'u1', email: 'p1@staff.medipol.local', isAnonymous: false };
    const { S, window } = load({ userAuth: user, AppEnv: { COLLECTION_ROOT: 'lifeserver_master' } });
    S.setStaffAdminGrant(user, { adminGranted: true });
    assert.deepEqual([S.isDbAdmin(), S.canManageAdmins()], [true, false]);
    S.setStaffAdminGrant(user, null);
    assert.deepEqual([S.isDbAdmin(), S.canManageAdmins()], [false, false]);
    window.userAuth = { uid: 'a1', email: 'admin@medipol.local', isAnonymous: false };
    assert.deepEqual([S.isDbAdmin(), S.canManageAdmins()], [true, true]);
    window.userAuth = { uid: 'a1', email: 'admin@medipol.local', isAnonymous: true };
    assert.equal(S.canManageAdmins(), false, 'anonim oturum ana yönetici değildir');
});

test('İP-7 clearSession: çıkışta belge yetkisi de temizlenir (aynı nesneyle yeniden girişte kendiliğinden geri gelmez)', () => {
    const user = { uid: 'u1', email: 'p1@staff.medipol.local', isAnonymous: false };
    const { S } = load({ userAuth: user });
    S.setStaffAdminGrant(user, { adminGranted: true });
    assert.equal(S.isDbAdmin(), true);
    S.clearSession();
    assert.equal(S.isDbAdmin(), false);
    assert.equal(S.getStaffAdminGrant(), null);
});
