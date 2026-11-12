// [WHY]: v3.4 EBYS H6b · Kurum künyesi, dosya planı ve üst yazı şablonları ortak tanımlardır; evrak bunları KOPYA olarak taşır.
//        Tanım sonradan değişse ya da pasife alınsa da dondurulmuş evrak ve başlatılmış süreç aynı kalır (değişmezlik).
//        Evrakın taşıdığı kopyaların biçimi (künye kopyası, şablon bağı) EBYSDocumentSchema'dadır.
// [HOW]: Saf doğrulama ve kopya üretimi. Firestore yok (Sütun 4: SDK yalnız services katmanında). Sınırlar firestore.rules
//        içindeki ec* fonksiyonlarıyla aynıdır; kural testleri iki tarafı birlikte sınar.
(function () {
    'use strict';
    const PROFILE_ID = 'primary';
    const PROFILE_FIELDS = Object.freeze(['name', 'code', 'address', 'phone', 'email', 'web']);
    const LIMITS = Object.freeze({ name: 240, address: 500, phone: 60, email: 160, web: 160, planTitle: 160, templateName: 120, subject: 240, content: 40000 });
    const PLAN_CODE_RE = /^[0-9A-Za-z][0-9A-Za-z.-]{0,39}$/;
    const ORG_CODE_RE = /^[A-Z0-9]{2,12}$/;

    function text(value, max, label, required = true) {
        const out = String(value ?? '').trim().replace(/\r\n/g, '\n');
        if (required && !out) throw new Error(`${label} boş olamaz.`);
        if (out.length > max) throw new Error(`${label} en fazla ${max} karakter olabilir.`);
        if (/<[a-zA-Z/!?]/.test(out)) throw new Error(`${label} etiket benzeri "<" ifadesi içeremez.`);
        return out;
    }
    const active = record => !!record && record.active !== false;

    function normalizeProfile(input) {
        const code = text(input && input.code, 12, 'Kurum kodu').toUpperCase();
        if (!ORG_CODE_RE.test(code)) throw new Error('Kurum kodu 2–12 büyük harf/rakam olmalı (kayıt numarasında kullanılır).');
        return {
            name: text(input.name, LIMITS.name, 'Kurum adı'), code,
            address: text(input.address, LIMITS.address, 'Adres'),
            phone: text(input.phone, LIMITS.phone, 'Telefon', false),
            email: text(input.email, LIMITS.email, 'E-posta', false),
            web: text(input.web, LIMITS.web, 'Web adresi', false),
        };
    }

    function planCode(value) {
        const code = String(value ?? '').trim();
        if (!PLAN_CODE_RE.test(code)) throw new Error('Dosya planı kodu 1–40 karakter olmalı; harf, rakam, nokta ve tire kullanılabilir.');
        return code;
    }
    function normalizeFilePlan(input) {
        return { code: planCode(input && input.code), title: text(input.title, LIMITS.planTitle, 'Dosya planı adı'), active: input.active !== false };
    }
    const planLabel = plan => `${plan.code} – ${plan.title}`;
    // Evrak formundaki seçenekler: aktif planlar; taslakta kayıtlı kod pasif ya da katalog dışıysa o da korunur (kaybolmaz).
    function filePlanOptions(plans, current = {}) {
        const list = (plans || []).filter(active).sort((a, b) => String(a.code).localeCompare(String(b.code), 'tr', { numeric: true }))
            .map(p => ({ code: p.code, title: p.title, label: planLabel(p), legacy: false }));
        const code = String(current.filePlanCode ?? '').trim();
        if (code && !list.some(p => p.code === code && p.title === (current.filePlanTitle || p.title))) {
            const known = (plans || []).find(p => p.code === code);
            const title = current.filePlanTitle || (known && known.title) || '';
            list.unshift({ code, title, label: `${title ? `${code} – ${title}` : code} · ${known && !active(known) ? 'pasif plan' : 'kayıtlı değer'}`, legacy: true });
        }
        return list;
    }

    function normalizeTemplate(input) {
        return {
            name: text(input && input.name, LIMITS.templateName, 'Şablon adı'),
            subject: text(input.subject, LIMITS.subject, 'Konu', false),
            content: text(input.content, LIMITS.content, 'Şablon metni'),
        };
    }
    const revisionId = (templateId, revision) => `${templateId}_${revision}`;
    // Şablon metnini forma uygular; konu boşsa mevcut konu korunur.
    function applyTemplate(revision, current = {}) {
        return {
            subject: revision.subject || current.subject || '', content: revision.content,
            letterTemplate: { templateId: revision.templateId, revision: revision.revision, name: revision.name },
        };
    }

    window.AppModules = window.AppModules || {};
    window.AppModules.EBYSCatalogSchema = Object.freeze({
        PROFILE_ID, PROFILE_FIELDS, LIMITS, active, normalizeProfile, planCode, normalizeFilePlan, planLabel, filePlanOptions,
        normalizeTemplate, revisionId, applyTemplate,
    });
})();
