export const verificationNotice = 'Bu belge kurum içi teyit amaçlıdır; nitelikli e-imza veya e-Devlet resmi onayı yerine geçmez.';
export const subjectSummaries = Object.freeze({
    incoming: 'Kurum dışından gelen evrak',
    outgoing: 'Kurum dışına giden evrak',
    internal: 'Kurum içi yazışma'
});
export const verificationStatuses = Object.freeze({ valid: 'Geçerli', revoked: 'İptal', archived: 'Arşivde' });
export const isVerificationToken = token => typeof token === 'string' && token.length === 32 && /^[a-f0-9]{32}$/.test(token);
export function newVerificationToken() {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}
export function verificationUrl(token, href, emulator = false) {
    if (!isVerificationToken(token)) throw new Error('Doğrulama anahtarı geçersiz.');
    const url = new URL('verify.html', href);
    if (emulator) url.searchParams.set('emu', '1');
    url.hash = token;
    return url.href;
}
export function parsePublicVerification(record) {
    if (!record || Object.keys(record).length !== 5
        || !/^EBYS-[A-Z0-9]{2,12}-[0-9]{6}-[A-F0-9]{32}$/.test(record.registrationNo)
        || typeof record.registeredAt !== 'string' || !Number.isFinite(Date.parse(record.registeredAt))
        || !Object.values(subjectSummaries).includes(record.subjectSummary)
        || !Object.hasOwn(verificationStatuses, record.status)
        || !/^[a-f0-9]{64}$/.test(record.contentDigest)) throw new Error('Doğrulama kaydı geçersiz.');
    return record;
}
