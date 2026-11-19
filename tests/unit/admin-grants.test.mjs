// İP-7 (Aşama A) — yönetici yetkisi saf çekirdeği (src/utils/admin-grants.js): uygunluk kodları, yetki durumu (askı nedenleri),
// gerekçe sınırları ve yazım planı (staffAccounts yaması + aynı commit'teki denetim girdisi). Kural tarafı:
// tests/rules/admin-grants.test.mjs. Gerçek dosya tarayıcısız (vm) yüklenir.
// Usage: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const plain = x => JSON.parse(JSON.stringify(x));
function load() {
    const window = {};
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/utils/admin-grants.js'), 'utf8'), vm.createContext({ window }), { filename: 'admin-grants.js' });
    return window.AppModules.AdminGrants;
}
const G = load();
const email = p => (p && p.pri ? `${p.pri}@staff.medipol.local` : null);
const person = (o = {}) => ({ id: 'pm', name: 'Mehmet Cer', pri: 'mehmet.cer', uid: 'uid-m', authEmail: 'mehmet.cer@staff.medipol.local', active: true, ...o });
const mapping = (o = {}) => ({ id: 'uid-m', personelId: 'pm', pri: 'mehmet.cer', linkedAt: 1, ...o });
const NOW = { __serverTimestamp: true };

test('sabitler: denetim türleri, Türkçe etiketler, beş yetki alanı', () => {
    assert.deepEqual(plain(G.AUDIT_TYPES), { GRANTED: 'yonetici-yetkisi-verildi', REVOKED: 'yonetici-yetkisi-geri-alindi' });
    assert.equal(G.AUDIT_LABELS['yonetici-yetkisi-verildi'], 'Yönetici Yetkisi Verildi');
    assert.equal(G.AUDIT_LABELS['yonetici-yetkisi-geri-alindi'], 'Yönetici Yetkisi Geri Alındı');
    assert.deepEqual([...G.ADMIN_FIELDS], ['adminGranted', 'adminChangedAt', 'adminChangedBy', 'adminReason', 'adminAuditId']);
    assert.ok(Object.isFrozen(G));
});

test('eligibility: ok / inactive / no-account / pri-mismatch / map-mismatch / already-admin (her biri Türkçe açıklamalı)', () => {
    const code = (p, m) => G.eligibility(p, m, email).code;
    assert.equal(code(person(), mapping()), 'ok');
    assert.equal(G.eligibility(person(), mapping(), email).ok, true);
    assert.equal(code(person({ active: false }), mapping()), 'inactive');
    assert.equal(code(person({ uid: '' }), mapping()), 'no-account');
    assert.equal(code(person(), null), 'no-account');
    assert.equal(code(null, null), 'no-account');
    assert.equal(code(person({ authEmail: 'p.pm@staff.medipol.local' }), mapping()), 'pri-mismatch', 'J7 adresinde kalmış hesap');
    assert.equal(code(person({ authEmail: '' }), mapping()), 'pri-mismatch');
    assert.equal(code(person(), mapping({ personelId: 'baska' })), 'map-mismatch');
    assert.equal(code(person(), mapping({ pri: 'eski.pri' })), 'map-mismatch');
    assert.equal(code(person(), mapping({ id: 'uid-baska' })), 'map-mismatch', 'eşleme kimliği (uid) personeldeki uid değil');
    assert.equal(code(person(), mapping({ adminGranted: true })), 'already-admin');
    assert.equal(code(person({ active: false }), mapping({ adminGranted: true })), 'already-admin', 'askıdaki yönetici de "zaten yönetici"');
    for (const c of ['ok', 'inactive', 'no-account', 'pri-mismatch', 'map-mismatch', 'already-admin']) {
        assert.ok(typeof G.ELIGIBILITY_TEXT[c] === 'string' && G.ELIGIBILITY_TEXT[c].length > 5, c);
    }
    assert.equal(G.eligibility(person({ authEmail: 'x' }), mapping()).code, 'ok', 'accountEmail verilmezse PRI adresi denetlenmez');
});

test('grantState: active / suspended (personel pasif, kilit kapalı, eşleme kayık, kayıt yok) / none', () => {
    assert.equal(G.grantState(mapping(), person(), true).state, 'none');
    assert.equal(G.grantState(mapping({ adminGranted: false }), person(), true).state, 'none');
    const ok = G.grantState(mapping({ adminGranted: true }), person(), true);
    assert.deepEqual([ok.state, ok.text], ['active', 'Aktif']);
    assert.equal(G.grantState(mapping({ adminGranted: true }), person(), undefined).state, 'active', 'kilit bilinmiyorsa askı iddia edilmez');
    const s = G.grantState(mapping({ adminGranted: true }), person({ active: false }), false);
    assert.equal(s.state, 'suspended');
    assert.deepEqual(plain(s.reasons), ['personel pasif', 'Personel Erişim Kilidi kapalı']);
    assert.match(s.text, /^Askıda — personel pasif, Personel Erişim Kilidi kapalı$/);
    assert.deepEqual(plain(G.grantState(mapping({ adminGranted: true, pri: 'eski' }), person(), true).reasons), ['kimlik eşlemesi uyuşmuyor']);
    assert.deepEqual(plain(G.grantState(mapping({ adminGranted: true }), null, true).reasons), ['personel kaydı bulunamadı']);
});

test('validateReason: 5–300 karakter (kırpılmış), etiket benzeri "<" yok; "a < b" serbest', () => {
    assert.equal(G.validateReason('kısa').ok, false);
    assert.equal(G.validateReason('    beş     ').ok, false, 'boşluklar sayılmaz');
    assert.equal(G.validateReason('Beşli').ok, true);
    assert.equal(G.validateReason('x'.repeat(300)).ok, true);
    assert.equal(G.validateReason('x'.repeat(301)).ok, false);
    assert.equal(G.validateReason('Atama <script>').ok, false);
    assert.equal(G.validateReason('Atama </b>').ok, false);
    assert.equal(G.validateReason('Kapasite a < b durumunda').ok, true);
    assert.equal(G.validateReason(null).ok, false);
    assert.equal(G.validateReason('  Görev değişikliği  ').value, 'Görev değişikliği');
});

test('planGrant: eşleme yaması (beş alan, sunucu saati yer tutucusu) + aynı commit denetim girdisi (yok → yonetici)', () => {
    const p = G.planGrant({ person: person(), mapping: mapping(), actorUid: 'admin-uid', reason: '  BT sorumlusu  ', auditId: 'al_1', now: NOW, accountEmail: email });
    assert.equal(p.ok, true);
    assert.equal(p.uid, 'uid-m');
    assert.deepEqual(plain(p.patch), { adminGranted: true, adminChangedAt: NOW, adminChangedBy: 'admin-uid', adminReason: 'BT sorumlusu', adminAuditId: 'al_1' });
    assert.deepEqual(Object.keys(p.patch).sort(), [...G.ADMIN_FIELDS].sort(), 'yama yalnız yetki alanları (personelId / pri / linkedAt dokunulmaz)');
    assert.deepEqual(plain(p.audit), { type: 'yonetici-yetkisi-verildi', refCol: 'staffAccounts', refId: 'uid-m', item: 'Mehmet Cer (mehmet.cer)',
        reason: 'BT sorumlusu', fromValue: 'yok', toValue: 'yonetici', result: 'approved' });
});

test('planGrant: uygunsuz kişi / geçersiz gerekçe / oturum ya da denetim kimliği yok → plan yok (kodlu)', () => {
    const base = { person: person(), mapping: mapping(), actorUid: 'admin-uid', reason: 'BT sorumlusu', auditId: 'al_1', now: NOW, accountEmail: email };
    assert.deepEqual(plain(G.planGrant({ ...base, person: person({ active: false }) })).code, 'inactive');
    assert.equal(G.planGrant({ ...base, mapping: mapping({ adminGranted: true }) }).code, 'already-admin');
    assert.equal(G.planGrant({ ...base, mapping: null }).code, 'no-account');
    assert.equal(G.planGrant({ ...base, reason: 'kısa' }).code, 'invalid-reason');
    assert.equal(G.planGrant({ ...base, actorUid: '' }).code, 'no-auth');
    assert.equal(G.planGrant({ ...base, auditId: '' }).code, 'invalid-argument');
    assert.equal(G.planGrant({ ...base, auditId: 'x'.repeat(81) }).code, 'invalid-argument');
    assert.equal(G.planGrant({ ...base, auditId: '<b>' }).code, 'invalid-argument');
    assert.equal(G.planGrant(base).ok, true);
});

test('planRevoke: yönetici → yok; kişi silinmiş / pasif olsa da geri alınır; yetkisiz hesap → not-admin', () => {
    const r = G.planRevoke({ person: person({ active: false }), mapping: mapping({ adminGranted: true }), uid: 'uid-m', actorUid: 'admin-uid', reason: 'Görev değişikliği', auditId: 'al_2', now: NOW });
    assert.equal(r.ok, true);
    assert.deepEqual(plain(r.patch), { adminGranted: false, adminChangedAt: NOW, adminChangedBy: 'admin-uid', adminReason: 'Görev değişikliği', adminAuditId: 'al_2' });
    assert.deepEqual([r.audit.type, r.audit.fromValue, r.audit.toValue, r.audit.refId, r.audit.refCol, r.audit.result],
        ['yonetici-yetkisi-geri-alindi', 'yonetici', 'yok', 'uid-m', 'staffAccounts', 'approved']);
    const gone = G.planRevoke({ person: null, mapping: mapping({ adminGranted: true }), uid: 'uid-m', actorUid: 'admin-uid', reason: 'Kayıt silindi', auditId: 'al_3', now: NOW });
    assert.equal(gone.audit.item, 'mehmet.cer', 'kişi kaydı yoksa eşlemedeki PRI');
    assert.equal(G.planRevoke({ person: person(), mapping: mapping({ adminGranted: false }), uid: 'uid-m', actorUid: 'a', reason: 'Görev değişikliği', auditId: 'x', now: NOW }).code, 'not-admin');
    assert.equal(G.planRevoke({ person: person(), mapping: null, uid: 'uid-m', actorUid: 'a', reason: 'Görev değişikliği', auditId: 'x', now: NOW }).code, 'not-admin');
    assert.equal(G.planRevoke({ person: person(), mapping: mapping({ adminGranted: true }), uid: '', actorUid: 'a', reason: 'Görev değişikliği', auditId: 'x', now: NOW }).code, 'invalid-argument');
    assert.equal(G.planRevoke({ person: person(), mapping: mapping({ adminGranted: true }), uid: 'uid-m', actorUid: 'a', reason: 'yok', auditId: 'x', now: NOW }).code, 'invalid-reason');
});

test('adminRows / candidates / matchesQuery: panel verisi (yetkililer + durum, uygunlar önce, Türkçe harf duyarsız arama)', () => {
    const personel = [person(), person({ id: 's1', name: 'Şule Ünal', pri: 'sule.unal', uid: 'uid-s1', authEmail: 'sule.unal@staff.medipol.local' }),
        person({ id: 'pi', name: 'Ali Pasif', pri: 'ali.pasif', uid: 'uid-i', authEmail: 'ali.pasif@staff.medipol.local', active: false }),
        person({ id: 'nx', name: 'Hesapsız', pri: 'hesap.siz', uid: '' })];
    const mappings = [mapping({ adminGranted: true }), mapping({ id: 'uid-s1', personelId: 's1', pri: 'sule.unal' }),
        mapping({ id: 'uid-i', personelId: 'pi', pri: 'ali.pasif', adminGranted: false })];
    const rows = G.adminRows({ mappings, personel, gateOpen: true });
    assert.deepEqual(rows.map(r => [r.uid, r.name, r.state.state]), [['uid-m', 'Mehmet Cer', 'active']]);
    const c = G.candidates({ personel, mappings, accountEmail: email });
    assert.deepEqual(c.map(x => [x.person.id, x.eligibility.code]),
        [['s1', 'ok'], ['pi', 'inactive'], ['nx', 'no-account'], ['pm', 'already-admin']]);
    assert.equal(G.matchesQuery(c[0], 'şule'), true);
    assert.equal(G.matchesQuery(c[0], 'SULE'), true);
    assert.equal(G.matchesQuery(c[0], 'sule.un'), true);
    assert.equal(G.matchesQuery(c[0], 'mehmet'), false);
    assert.equal(G.matchesQuery(c[0], '  '), true);
});
