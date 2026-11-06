import { isVerificationToken, parsePublicVerification, verificationStatuses } from '../utils/ebys-verification-schema.js';

const status = document.getElementById('verificationStatus');
const result = document.getElementById('verificationResult');
let generation = 0;

async function verify() {
    const request = ++generation;
    const token = window.location.hash.slice(1);
    result.hidden = true;
    result.replaceChildren();
    status.textContent = 'Doğrulama kaydı sorgulanıyor…';
    if (!isVerificationToken(token)) {
        status.textContent = 'Doğrulama anahtarı eksik veya geçersiz.';
        return;
    }
    const { hostname, search } = window.location;
    const local = ['localhost', '127.0.0.1'].includes(hostname);
    const root = local || hostname.includes('demo') ? 'inventory_demo' : 'lifeserver_master';
    const origin = local && new URLSearchParams(search).get('emu') === '1' ? 'http://127.0.0.1:8080' : 'https://firestore.googleapis.com';
    const endpoint = origin + '/v1/projects/medipol-inventory-v3/databases/(default)/documents/' + root + '/ebysVerifications/items/' + token;
    try {
        const response = await fetch(endpoint, { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
        if (request !== generation) return;
        if (response.status === 404) {
            status.textContent = 'Doğrulama kaydı bulunamadı.';
            return;
        }
        if (!response.ok) throw new Error('Doğrulama sorgusu başarısız.');
        const { fields } = await response.json();
        if (request !== generation) return;
        const record = parsePublicVerification(Object.fromEntries(Object.entries(fields).map(([name, value]) =>
            [name, value.stringValue ?? value.timestampValue])));
        const fieldsToShow = [
            ['Evrak No', record.registrationNo],
            ['Kayıt Tarihi', new Intl.DateTimeFormat('tr-TR', { timeZone: 'UTC', dateStyle: 'long' }).format(new Date(record.registeredAt))],
            ['Konu Özeti', record.subjectSummary],
            ['Belge Durumu', verificationStatuses[record.status]],
            ['SHA-256 İçerik Özeti', record.contentDigest]
        ];
        for (const [label, value] of fieldsToShow) {
            const term = document.createElement('dt'), description = document.createElement('dd');
            term.textContent = label;
            description.textContent = value;
            result.append(term, description);
        }
        result.hidden = false;
        status.textContent = 'Evrak kaydı bulundu.';
    } catch {
        if (request === generation) status.textContent = 'Doğrulama şu anda tamamlanamadı. Daha sonra yeniden deneyin.';
    }
}
window.addEventListener('hashchange', verify);
verify();
