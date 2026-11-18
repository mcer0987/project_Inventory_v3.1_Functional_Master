// [WHY]: v3.4 EBYS H7 · Gelen–cevap bağı (İlgi), gelen evrak mükerrer anahtarı ve giden evrak manuel gönderim
//        kayıtları mevcut evrak/taslak/sürüm kurallarına ifade eklemeden kendi saf sözleşmesiyle doğrulanmalıdır.
// [HOW]: Saf doğrulama, tr-TR kanonikleştirme, SHA-256 anahtar üretimi ve "İlgi:" satırı biçimlendirmesi.
//        Firestore çağrısı veya DOM erişimi içermez (Anayasa §3). Sınırlar firestore.rules ile birebir aynıdır.
(function () {
    'use strict';

    const CHANNELS = Object.freeze({
        hand: 'Elden teslim',
        post: 'Posta / PTT',
        courier: 'Kurye / Kargo',
        kep: 'KEP — Manuel beyan',
        email: 'E-posta — Manuel beyan',
        other: 'Diğer'
    });
    const CHANNEL_KEYS = Object.freeze(Object.keys(CHANNELS));
    const ENTRY_KINDS = Object.freeze(['initial', 'correction']);
    const UUID_RE = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    const REGISTRATION_NO_RE = /^EBYS-[A-Z0-9]{2,12}-\d{6}-[A-F0-9]{32}$/;

    function text(value, max, label, required = true) {
        const out = String(value ?? '').trim().replace(/\r\n/g, '\n');
        if (required && !out) throw new Error(`${label} boş olamaz.`);
        if (out.length > max) throw new Error(`${label} en fazla ${max} karakter olabilir.`);
        if (/<[a-zA-Z/!?]/.test(out)) throw new Error(`${label} etiket benzeri "<" ifadesi içeremez.`);
        return out;
    }

    function uuid(value, label) {
        const out = String(value ?? '').trim();
        if (!UUID_RE.test(out)) throw new Error(`${label} geçersiz.`);
        return out;
    }

    function validDate(value, label) {
        const out = text(value, 10, label, true);
        if (!DATE_RE.test(out) || new Date(`${out}T12:00:00Z`).toISOString().slice(0, 10) !== out) {
            throw new Error(`${label} geçersiz.`);
        }
        return out;
    }

    const isRegistrationNo = value => typeof value === 'string' && REGISTRATION_NO_RE.test(value.trim());

    // [WHY]: D4 — Gönderim beyanı gelecek tarihli olamaz; düzeltme kaydı mutlaka gerekçe/not taşımalıdır.
    // [HOW]: sentDate <= today (YYYY-MM-DD sözlüksel/sayısal karşılaştırma) ve kanal/tür beyaz listesi denetlenir.
    function normalizeDispatch(input, today = new Date().toISOString().slice(0, 10)) {
        if (!input || typeof input !== 'object') throw new Error('Gönderim kaydı geçersiz.');
        const documentId = uuid(input.documentId, 'Evrak kimliği');
        const versionId = uuid(input.versionId, 'Sürüm kimliği');
        const channel = String(input.channel ?? '').trim();
        if (!CHANNEL_KEYS.includes(channel)) throw new Error('Gönderim kanalı geçersiz.');
        const sentDate = validDate(input.sentDate, 'Gönderim tarihi');
        const maxDate = validDate(today, 'Güncel tarih');
        if (sentDate > maxDate) throw new Error('Gönderim tarihi gelecekte olamaz.');
        const entryKind = String(input.entryKind ?? 'initial').trim();
        if (!ENTRY_KINDS.includes(entryKind)) throw new Error('Gönderim kayıt türü geçersiz.');
        const externalRef = text(input.externalRef, 120, 'Dış referans / takip numarası', true);
        const note = text(input.note, 500, entryKind === 'correction' ? 'Düzeltme gerekçesi / notu' : 'Gönderim notu', entryKind === 'correction');
        return { documentId, versionId, channel, sentDate, externalRef, note, entryKind };
    }

    // [WHY]: D3 — Aynı kurumdan gelen aynı tarih ve dış sayılı evrakta yazım/noktalama farkları aynı anahtarı üretmelidir.
    // [HOW]: NFKC + tr-TR küçük harf + harf/rakam dışı karakterlerin tek boşluğa sadeleştirilmesi; üç alandan biri boşsa null.
    function normalizeKeyToken(value) {
        return String(value ?? '')
            .normalize('NFKC')
            .toLocaleLowerCase('tr-TR')
            .replace(/[^\p{L}\p{N}]+/gu, ' ')
            .trim()
            .replace(/\s+/g, ' ');
    }

    function normalizeIncomingKeyParts(input) {
        if (!input || typeof input !== 'object') return null;
        const rawCorr = String(input.correspondent ?? '').trim();
        const rawExt = String(input.externalRegistrationNo ?? '').trim();
        const rawDate = String(input.date ?? '').trim();
        if (!rawCorr || !rawExt || !rawDate) return null;
        if (!DATE_RE.test(rawDate) || new Date(`${rawDate}T12:00:00Z`).toISOString().slice(0, 10) !== rawDate) return null;
        const correspondent = normalizeKeyToken(rawCorr);
        const externalRegistrationNo = normalizeKeyToken(rawExt);
        if (!correspondent || !externalRegistrationNo) return null;
        return { correspondent, externalRegistrationNo, date: rawDate };
    }

    async function incomingDuplicateKey(input) {
        const parts = normalizeIncomingKeyParts(input);
        if (!parts) return null;
        const docSchema = window.AppModules?.EBYSDocumentSchema;
        if (docSchema?.digest) {
            return docSchema.digest({
                type: 'ebys-incoming-key-v1',
                correspondent: parts.correspondent,
                externalRegistrationNo: parts.externalRegistrationNo,
                date: parts.date
            });
        }
        const payload = JSON.stringify([parts.correspondent, parts.externalRegistrationNo, parts.date]);
        const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
        return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
    }

    // [WHY]: D2 — Gelen evraka yazılan cevabın üstveri özeti hedef sürümle birebir eşleşmeli ve "İlgi:" satırını üretmelidir.
    // [HOW]: Kayıt numarası, dış sayı, tarih, muhatap ve konu doğrulanır; resmi yazışma formatında İlgi satırı döndürülür.
    function normalizeReplySummary(input) {
        if (!input || typeof input !== 'object') throw new Error('Hedef evrak özeti geçersiz.');
        const registrationNo = text(input.registrationNo, 64, 'Hedef kayıt numarası', true);
        if (!REGISTRATION_NO_RE.test(registrationNo)) throw new Error('Hedef evrakın kesin kayıt numarası geçersiz.');
        const externalRegistrationNo = text(input.externalRegistrationNo, 120, 'Dış evrak numarası', false);
        const date = validDate(input.date, 'Hedef evrak tarihi');
        const correspondent = text(input.correspondent, 240, 'Hedef muhatap', true);
        const subject = text(input.subject, 240, 'Hedef konu', true);
        return { registrationNo, externalRegistrationNo, date, correspondent, subject };
    }

    function normalizeReplyLink(input) {
        if (!input || typeof input !== 'object') throw new Error('Cevap bağı geçersiz.');
        const replyDocumentId = uuid(input.replyDocumentId ?? input.id, 'Cevap evrak kimliği');
        const replyToDocumentId = uuid(input.replyToDocumentId, 'Hedef gelen evrak kimliği');
        if (replyDocumentId === replyToDocumentId) throw new Error('Evrak kendisine cevap olarak bağlanamaz.');
        const replyToVersionId = uuid(input.replyToVersionId, 'Hedef gelen evrak sürüm kimliği');
        const replyOwnerUid = text(input.replyOwnerUid, 128, 'Cevap yazarı', true);
        const replyToOwnerUid = text(input.replyToOwnerUid, 128, 'Hedef evrak sahibi', true);
        const replyToSummary = normalizeReplySummary(input.replyToSummary);
        return {
            id: replyDocumentId,
            replyDocumentId,
            replyToDocumentId,
            replyOwnerUid,
            replyToOwnerUid,
            replyToVersionId,
            replyToSummary
        };
    }

    function formatInterestLine(summary) {
        const s = normalizeReplySummary(summary);
        const number = s.externalRegistrationNo || s.registrationNo;
        return `İlgi: ${s.date} tarihli ve ${number} sayılı yazınız (${s.correspondent}).`;
    }

    window.AppModules = window.AppModules || {};
    window.AppModules.EBYSCorrespondenceSchema = Object.freeze({
        CHANNELS,
        CHANNEL_KEYS,
        ENTRY_KINDS,
        REGISTRATION_NO_RE,
        isRegistrationNo,
        normalizeDispatch,
        normalizeIncomingKeyParts,
        incomingDuplicateKey,
        normalizeReplySummary,
        normalizeReplyLink,
        formatInterestLine
    });
})();

