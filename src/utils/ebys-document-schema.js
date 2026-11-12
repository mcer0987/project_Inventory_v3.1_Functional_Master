(function () {
    'use strict';
    const kinds = ['incoming', 'outgoing', 'internal'];
    const states = ['draft', 'registered', 'in_review', 'internally_approved', 'pending_execution', 'closed', 'archived'];
    const uuid = () => crypto.randomUUID();
    const text = (value, max, label, required = true) => {
        const out = String(value ?? '').trim().replace(/\r\n/g, '\n');
        if ((required && !out) || out.length > max || /<[a-zA-Z/!?]/.test(out)) throw new Error(`${label} geçersiz veya sınırı aşıyor.`);
        return out;
    };
    function normalize(input) {
        if (!kinds.includes(input.kind)) throw new Error('Evrak yönü geçersiz.');
        const metadata = input.metadata || {};
        const date = text(metadata.date, 10, 'Evrak tarihi');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error('Evrak tarihi geçersiz.');
        const organizationCode = text(input.organizationCode, 12, 'Kurum kodu').toUpperCase();
        if (!/^[A-Z0-9]{2,12}$/.test(organizationCode)) throw new Error('Kurum kodu 2–12 harf/rakam olmalı.');
        if (!['Normal', 'Hizmete Özel', 'Gizli'].includes(metadata.confidentiality)) throw new Error('Gizlilik derecesi geçersiz.');
        return { kind: input.kind, unitId: text(input.unitId, 128, 'Birim'), organizationCode,
            content: text(input.content, 40000, 'Evrak gövdesi'), metadata: {
                subject: text(metadata.subject, 240, 'Konu'), correspondent: text(metadata.correspondent, 240, 'Muhatap'), date,
                filePlanCode: text(metadata.filePlanCode, 40, 'Dosya planı kodu'), confidentiality: metadata.confidentiality,
                // H6b: katalogdan seçilen planın adı evraka kopyalanır (plan sonradan değişse/pasife alınsa da evrak aynı kalır).
                ...(String(metadata.filePlanTitle ?? '').trim() ? { filePlanTitle: text(metadata.filePlanTitle, 160, 'Dosya planı adı') } : {}),
                distribution: text(metadata.distribution, 2000, 'Dağıtım', false),
                externalRegistrationNo: text(metadata.externalRegistrationNo, 120, 'Dış evrak numarası', false),
            } };
    }
    function canonical(value) {
        if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
        if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
        return JSON.stringify(value);
    }
    async function digest(value) {
        const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)));
        return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
    }
    function registrationNo(code, date = new Date()) {
        if (!/^[A-Z0-9]{2,12}$/.test(code)) throw new Error('Kurum kodu geçersiz.');
        const day = date.toISOString().slice(2, 10).replaceAll('-', '');
        const random = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
        return `EBYS-${code}-${day}-${random}`;
    }
    // H6b · Evrakın taşıdığı katalog kopyaları (firestore.rules ecSnapshot / ecTemplateRefOk ile aynı biçim).
    const SNAPSHOT_FIELDS = ['name', 'code', 'address', 'phone', 'email', 'web'];
    function institutionSnapshot(profile) {
        if (!profile) return null;
        return { ...Object.fromEntries(SNAPSHOT_FIELDS.map(k => [k, String(profile[k] ?? '')])), revision: profile.revision };
    }
    function templateRef(value) {
        if (value == null || value === '') return null;
        const ref = { templateId: String(value.templateId || ''), revision: Number(value.revision), name: text(value.name, 120, 'Şablon adı') };
        if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(ref.templateId) || !Number.isSafeInteger(ref.revision) || ref.revision < 1) {
            throw new Error('Şablon bağı geçersiz.');
        }
        return ref;
    }
    const sameRef = (a, b) => (a == null && b == null) || (!!a && !!b && a.templateId === b.templateId && a.revision === b.revision && a.name === b.name);
    window.AppModules = window.AppModules || {};
    window.AppModules.EBYSDocumentSchema = Object.freeze({ kinds, states, uuid, normalize, canonical, digest, registrationNo,
        institutionSnapshot, templateRef, sameRef });
})();
