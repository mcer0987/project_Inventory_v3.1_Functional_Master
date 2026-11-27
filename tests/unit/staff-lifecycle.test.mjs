// [WHY]: v3.8 · VP-3 — Personel Hesap Yaşam Döngüsü saf çekirdeği (src/utils/staff-lifecycle.js) ve
//        çevrimdışı CLI güvenlik sözleşmesi (tools/staff-password-reset.mjs) için birim testleri.
// [HOW]: node --test tests/unit/staff-lifecycle.test.mjs (tarayıcı/Firebase emülatörü gerektirmez).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';

function loadStaffLifecycle() {
    const win = { AppModules: {}, crypto: webcrypto };
    const sandbox = vm.createContext({ window: win, crypto: webcrypto, Uint32Array });
    const src = readFileSync(new URL('../../src/utils/staff-lifecycle.js', import.meta.url), 'utf8');
    vm.runInContext(src, sandbox, { filename: 'staff-lifecycle.js' });
    return win.AppModules.StaffLifecycle;
}

const plain = obj => JSON.parse(JSON.stringify(obj));

const SL = loadStaffLifecycle();

describe('VP-3 · Kriptografik Kod/PIN Üretimi ve Zayıf Kalıp Reddi', () => {
    test('zayıf kalıpları kesin reddeder (12345, 00000, tekrarlar, ardışık diziler, kara liste)', () => {
        const weakSamples = [
            '', '   ', '123', 'ab 12',
            '0000', '00000', '000000', '11111', '111111', 'aaaaa', 'zzzzzz',
            '1234', '12345', '123456', '54321', '654321', '98765', '987654',
            'abcd', 'abcde', 'dcba9', 'x1234y', 'q9876z',
            '121212', '123123', 'ab1ab1', 'ababab',
            'admin', 'medipol', 'password', 'sifre', 'qwerty',
        ];
        for (const sample of weakSamples) {
            assert.equal(SL.isWeakCode(sample), true, `zayıf olarak reddedilmeli: "${sample}"`);
            const v = SL.validateNewCode(sample);
            assert.equal(v.ok, false, `validateNewCode reddetmeli: "${sample}"`);
            if (sample.trim().length >= 3) {
                assert.equal(v.message.includes(sample.trim()), false, 'hata mesajı düz metin kodu sızdırmamalı');
            }
        }
    });

    test('güçlü kodları kabul eder ve yasaklı (eski geçici PIN) tekrarı reddeder', () => {
        for (const good of ['k7m4x9p2', '849271', 'r3t9v2n8', '491736']) {
            assert.equal(SL.isWeakCode(good), false, `güçlü kod kabul edilmeli: ${good}`);
            assert.equal(SL.validateNewCode(good).ok, true);
        }
        const reused = SL.validateNewCode('849271', { forbidden: ['849271'] });
        assert.equal(reused.ok, false);
        assert.equal(reused.reason, 'reused');
        assert.equal(reused.message.includes('849271'), false);
    });

    test('generateSecureCode(tempPin) 100 üretimde 6 haneli, zayıf kalıpsız ve ≥4 benzersiz rakamlı PIN üretir', () => {
        for (let i = 0; i < 100; i++) {
            const pin = SL.generateSecureCode({ kind: 'tempPin' });
            assert.match(pin, /^\d{6}$/);
            assert.equal(SL.isWeakCode(pin), false);
            assert.ok(new Set(pin.split('')).size >= 4);
        }
    });

    test('generateSecureCode(code) 100 üretimde 8 karakterli okunaklı alfasayısal güçlü kod üretir', () => {
        for (let i = 0; i < 100; i++) {
            const code = SL.generateSecureCode({ kind: 'code' });
            assert.equal(code.length, 8);
            assert.doesNotMatch(code, /[0o1li]/);
            assert.match(code, /[a-z]/);
            assert.match(code, /[0-9]/);
            assert.equal(SL.isWeakCode(code), false);
        }
    });

    test('enjekte edilen rng zayıf adayları (000000, 123456) atlayıp ilk güçlü PINi döner', () => {
        // Sırasıyla 0,0,0,0,0,0 -> 1,2,3,4,5,6 -> 7,3,9,2,0,4
        const seq = [0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 3, 9, 2, 0, 4];
        let idx = 0;
        const pin = SL.generateSecureCode({
            kind: 'tempPin',
            rng: () => (seq[idx++] ?? 5) / 10,
        });
        assert.equal(pin, '739204');
    });
});

describe('VP-3 · 24 Saat Cooldown, TTL ve Şema Planlayıcıları', () => {
    test('canResubmitResetRequest 23s 59dk 59sn reddeder, 24s 00dk 01sn kabul eder', () => {
        const t0 = 1_700_000_000_000;
        assert.deepEqual(plain(SL.canResubmitResetRequest(null, t0)), { allowed: true, remainingMs: 0 });

        const before = SL.canResubmitResetRequest(t0, t0 + SL.RESET_COOLDOWN_MS - 1000);
        assert.equal(before.allowed, false);
        assert.equal(before.remainingMs, 1000);

        const exact = SL.canResubmitResetRequest(t0, t0 + SL.RESET_COOLDOWN_MS);
        assert.equal(exact.allowed, true);
        assert.equal(exact.remainingMs, 0);

        const after = SL.canResubmitResetRequest(t0, t0 + SL.RESET_COOLDOWN_MS + 1000);
        assert.equal(after.allowed, true);
        assert.equal(after.remainingMs, 0);
    });

    test('planResetRequest PRI normalleştirir, HTML etiketi ve uzun notu reddeder', () => {
        const ok = SL.planResetRequest({ pri: '  Ayşe.Yılmaz  ', note: 'Kodumu unuttum', now: 'TS' });
        assert.equal(ok.ok, true);
        assert.equal(ok.docId, 'ayse.yilmaz');
        assert.deepEqual(plain(ok.payload), {
            pri: 'ayse.yilmaz',
            note: 'Kodumu unuttum',
            status: 'pending',
            requestedAt: 'TS',
        });

        assert.equal(SL.planResetRequest({ pri: 'ayse.yilmaz', note: '<script>x</script>', now: 'TS' }).ok, false);
        assert.equal(SL.planResetRequest({ pri: 'ayse.yilmaz', note: 'a'.repeat(161), now: 'TS' }).ok, false);
        assert.equal(SL.planResetRequest({ pri: 'geçersiz pri!', note: '', now: 'TS' }).ok, false);
    });

    test('planSuspendToggle İP-7 K1 korumasını, idempotency ve gerekçe sınırını zorlar', () => {
        const person = { id: 'p1', name: 'Ayşe Yılmaz', pri: 'ayse.yilmaz', uid: 'uid-1', active: true };
        const adminMap = { id: 'uid-1', personelId: 'p1', pri: 'ayse.yilmaz', adminGranted: true, status: 'active' };

        // Ek yönetici yetkili hesabı askıya alamaz
        const blocked = SL.planSuspendToggle({
            person, mapping: adminMap, suspend: true, reason: 'Görev değişikliği nedeniyle',
            actorUid: 'uid-sub', canEditAdminAccount: false, auditId: 'a1', now: 'TS',
        });
        assert.equal(blocked.ok, false);
        assert.equal(blocked.code, 'admin-protected');

        // Ana yönetici askıya alabilir
        const allowed = SL.planSuspendToggle({
            person, mapping: adminMap, suspend: true, reason: 'Görev değişikliği nedeniyle',
            actorUid: 'uid-admin', canEditAdminAccount: true, auditId: 'a1', now: 'TS',
        });
        assert.equal(allowed.ok, true);
        assert.deepEqual(plain(allowed.personPatch), { active: false });
        assert.equal(allowed.accountPatch.status, 'suspended');
        assert.equal(allowed.audit.type, SL.AUDIT_TYPES.SUSPEND);

        // Zaten askıdaki hesabı tekrar askıya alma reddedilir
        const dup = SL.planSuspendToggle({
            person: { ...person, active: false },
            mapping: { ...adminMap, status: 'suspended' },
            suspend: true, reason: 'Tekrar deneme',
            actorUid: 'uid-admin', canEditAdminAccount: true, auditId: 'a2', now: 'TS',
        });
        assert.equal(dup.ok, false);
        assert.equal(dup.code, 'already-suspended');
    });

    test('planTempPinIssue TTL tavanını (≤24 saat), askı kontrolünü ve düz metin yokluğunu doğrular', () => {
        const person = { id: 'p1', name: 'Ayşe Yılmaz', pri: 'ayse.yilmaz', uid: 'uid-1', active: true };
        const mapping = { id: 'uid-1', personelId: 'p1', pri: 'ayse.yilmaz', status: 'active' };

        assert.equal(SL.planTempPinIssue({
            person, mapping, ttlMinutes: 1441, reason: 'Şifre unutuldu',
            actorUid: 'admin-uid', canEditAdminAccount: true, auditId: 'a1', now: 'TS', expiresAt: 'EXP',
        }).ok, false);

        assert.equal(SL.planTempPinIssue({
            person: { ...person, active: false }, mapping: { ...mapping, status: 'suspended' },
            ttlMinutes: 60, reason: 'Şifre unutuldu',
            actorUid: 'admin-uid', canEditAdminAccount: true, auditId: 'a1', now: 'TS', expiresAt: 'EXP',
        }).code, 'suspended');

        const ok = SL.planTempPinIssue({
            person, mapping, mode: 'tempPin', ttlMinutes: 60, reason: 'Geçici erişim kodu verildi',
            actorUid: 'admin-uid', canEditAdminAccount: true, auditId: 'a1', now: 'TS', expiresAt: 'EXP',
        });
        assert.equal(ok.ok, true);
        assert.equal(ok.accountPatch.mustChangeCode, true);
        assert.equal(ok.accountPatch.tempPinExpiresAt, 'EXP');
        assert.equal('code' in ok.accountPatch, false);
        assert.equal('pin' in ok.accountPatch, false);
        assert.equal('password' in ok.accountPatch, false);
    });

    test('formatOfflineResetCommand parola/kod bayrağı içermez', () => {
        const cmd = SL.formatOfflineResetCommand('Ayşe.Yılmaz');
        assert.match(cmd, /--pri ayse\.yilmaz/);
        assert.doesNotMatch(cmd, /--password|--code|--pin/);
    });
});

describe('VP-3 · Çevrimdışı CLI Betiği Güvenlik Sözleşmesi (tools/staff-password-reset.mjs)', () => {
    test('CLI argümanından parola/kod verilmesini reddeder ve çıktıda düz metin basmaz', () => {
        const scriptPath = new URL('../../tools/staff-password-reset.mjs', import.meta.url);
        for (const [flag, secret] of [['--password', 'GizliKod999'], ['--code', '739204']]) {
            const run = spawnSync(process.execPath, [scriptPath.pathname.replace(/^\/([A-Za-z]:)/, '$1'), '--pri', 'ayse.yilmaz', flag, secret], {
                encoding: 'utf8',
            });
            assert.notEqual(run.status, 0, `${flag} bayrağı sıfır dışı kodla reddedilmeli`);
            assert.match(run.stderr, /GÜVENLİK REDDİ/);
            assert.equal(run.stdout.includes(secret), false, 'stdout düz metin kod içermemeli');
            assert.equal(run.stderr.includes(secret), false, 'stderr düz metin kod içermemeli');
        }
    });
});
