import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { isVerificationToken, newVerificationToken, parsePublicVerification, verificationUrl } from '../../src/utils/ebys-verification-schema.js';
import { qrMatrix } from '../../src/utils/ebys-verification-qr.js';

test('doğrulama anahtarı 16 rastgele bayttan üretilir; URL parçacığı yalnız token taşır', () => {
    const tokens = Array.from({ length: 32 }, newVerificationToken);
    assert.equal(new Set(tokens).size, tokens.length);
    assert.ok(tokens.every(isVerificationToken));
    assert.equal(isVerificationToken('a'.repeat(31)), false);
    assert.equal(isVerificationToken('f'.repeat(32) + '\n'), false);
    assert.equal(isVerificationToken(null), false);
    assert.throws(() => verificationUrl('evil?id=1', 'https://medipol-inventory-v3.web.app/admin.html'));
    const url = new URL(verificationUrl(tokens[0], 'https://medipol-inventory-v3.web.app/admin.html?documentId=private#old'));
    assert.equal(url.pathname, '/verify.html');
    assert.equal(url.search, '');
    assert.equal(url.hash, '#' + tokens[0]);
    assert.equal(new URL(verificationUrl(tokens[0], 'http://127.0.0.1:5500/index.html', true)).search, '?emu=1');
});

test('kamu şeması yalnız beş alanı ve izinli konu özeti ile durumları kabul eder', () => {
    const record = {
        registrationNo: 'EBYS-MED-261105-' + 'A'.repeat(32), registeredAt: '2026-11-05T12:00:00Z',
        subjectSummary: 'Kurum içi yazışma', status: 'valid', contentDigest: 'f'.repeat(64)
    };
    for (const status of ['valid', 'revoked', 'archived']) {
        assert.equal(parsePublicVerification({ ...record, status }).status, status);
    }
    for (const patch of [{ documentId: 'özel' }, { subjectSummary: 'Kişi adı' }, { registeredAt: 'geçersiz' }, { status: 'constructor' }]) {
        assert.throws(() => parsePublicVerification({ ...record, ...patch }));
    }
});

test('çıktı QR matrisi v5-L byte referans vektörleri ile eşleşir', () => {
    const vectors = [
        ['https://medipol-inventory-v3.web.app/verify.html#' + '01'.repeat(16), '9cee2dccbc4d547cfd20a76b69868510f9cecbd3dea95fbe865b031976715bb0'],
        ['http://127.0.0.1:5500/verify.html?emu=1#' + 'fb'.repeat(16), '1dc117f194de3269119274230ab857aef6863d5f21113956179bfcdf616dcee3'],
        ['a'.repeat(106), '25d4258d54fda8c842d00adbe0753f2580d0b37b9f958d0f88ba49bb7b7fba8f']
    ];
    for (const [text, hash] of vectors) {
        const matrix = qrMatrix(text);
        assert.equal(matrix.length, 37);
        assert.ok(matrix.every(row => row.length === 37 && row.every(bit => typeof bit === 'boolean')));
        assert.equal(createHash('sha256').update(matrix.map(row => row.map(Number).join('')).join('')).digest('hex'), hash);
    }
    assert.throws(() => qrMatrix('ş'.repeat(54)), /fazla uzun/);
});
