/**
 * utils/admin-grants.js — İP-7 · Ana yöneticinin verdiği yönetici yetkisi: uygunluk, yetki durumu, yazım planı.
 * Klasik script (window.AppModules.AdminGrants); saf: Firestore'a ve DOM'a dokunmaz, veri parametreyle gelir (node:vm ile test edilir).
 *
 * [WHY]: Ek yönetici yetkisi betikle yazılan bir Firebase claim'iydi: panelden verilemiyor, geri alınamıyor, iz bırakmıyordu.
 *        Yetki artık kuralların okuduğu staffAccounts/{uid} belgesinde; yalnız ana yönetici, aynı commit'teki denetim kaydıyla
 *        değiştirir (firestore.rules adminGrantWriteOk). Kim yetki alabilir, yetki şu an geçerli mi, hangi alanlar yazılır —
 *        bunlar kuralların istemci tarafındaki aynası olarak tek yerde tutulur.
 * [HOW]: eligibility  — personel + eşleme → ok | inactive | no-account | pri-mismatch | map-mismatch | already-admin (+ açıklama)
 *        grantState   — eşleme + personel + kilit → active | suspended (nedenleriyle) | none
 *        validateReason — 5–300 karakter, etiket benzeri "<" yok (kural noTag ile aynı desen)
 *        planGrant / planRevoke — staffAccounts yaması + aynı commit'te yazılacak denetim girdisi; sunucu saati çağırandan
 *        (now: serverTimestamp yer tutucusu) gelir.
 */
(function () {
    'use strict';

    const AUDIT_TYPES = Object.freeze({ GRANTED: 'yonetici-yetkisi-verildi', REVOKED: 'yonetici-yetkisi-geri-alindi' });
    const AUDIT_LABELS = Object.freeze({
        [AUDIT_TYPES.GRANTED]: 'Yönetici Yetkisi Verildi',
        [AUDIT_TYPES.REVOKED]: 'Yönetici Yetkisi Geri Alındı',
    });
    // Denetim kaydındaki fromValue / toValue değerleri ve rapordaki okunur karşılıkları.
    const AUDIT_VALUES = Object.freeze({ NONE: 'yok', ADMIN: 'yonetici' });
    const AUDIT_VALUE_LABELS = Object.freeze({ yok: 'Yetki yok', yonetici: 'Yönetici' });
    const ADMIN_FIELDS = Object.freeze(['adminGranted', 'adminChangedAt', 'adminChangedBy', 'adminReason', 'adminAuditId']);
    const REF_COL = 'staffAccounts';
    const REASON_MIN = 5;
    const REASON_MAX = 300;
    const AUDIT_ID_MAX = 80;
    const TAG_LIKE = /<[a-zA-Z/!?]/;   // firestore.rules noTag · html.js hasTagLike ile aynı

    const ELIGIBILITY_TEXT = Object.freeze({
        ok: 'Yönetici yapılabilir.',
        inactive: 'Personel pasif; önce personel kaydını aktifleştirin.',
        'no-account': 'Kurumsal kimlikle (PRI) açılmış giriş hesabı yok; önce hesap açın (personel tablosunda "Hesap Aç" ya da VIP › PRI / Hesap Göç Aracı).',
        'pri-mismatch': 'Giriş hesabı kurumsal kimlik (PRI) adresinde değil; önce VIP › PRI / Hesap Göç Aracı ile taşıyın.',
        'map-mismatch': 'Kimlik eşlemesi personel kaydıyla uyuşmuyor; önce VIP › PRI / Hesap Göç Aracı ile eşlemeyi yenileyin.',
        'already-admin': 'Zaten yönetici.',
    });

    const blank = v => v === undefined || v === null || String(v).trim() === '';
    const text = v => (blank(v) ? '' : String(v).trim());
    const isGranted = m => !!(m && m.adminGranted === true);
    const personName = p => text(p && (p.name || p.adSoyad || p.ad)) || '-';

    // [WHY]: Kurallar yetkiyi yalnız eşleme + personel kaydı + oturum e-postası aynı kişiyi gösterirken tanır (isStaff zinciri);
    //        uymayan bir kişiye verilen yetki hiç çalışmaz ya da kural yazımı reddeder.
    // [HOW]: Sıra: hesap/eşleme yok → zaten yönetici → pasif → hesap PRI adresinde değil → eşleme kayık → uygun.
    //        accountEmail: personel → beklenen hesap e-postası (StaffProvisioning.accountEmailOf); verilmezse PRI adresi denetlenmez.
    function eligibility(person, mapping, accountEmail) {
        const out = code => ({ code, ok: code === 'ok', text: ELIGIBILITY_TEXT[code] });
        if (!person || blank(person.id)) return out('no-account');
        if (blank(person.uid) || !mapping) return out('no-account');
        if (isGranted(mapping)) return out('already-admin');
        if (person.active === false) return out('inactive');
        if (typeof accountEmail === 'function') {
            const expected = accountEmail(person);
            if (!expected || text(person.authEmail).toLowerCase() !== String(expected).toLowerCase()) return out('pri-mismatch');
        }
        if (String(mapping.personelId) !== String(person.id) || text(mapping.pri) !== text(person.pri)
            || (!blank(mapping.id) && String(mapping.id) !== String(person.uid))) return out('map-mismatch');
        return out('ok');
    }

    // [WHY]: Yetki kural tarafında isStaff zincirine bağlı; zincirden biri koparsa (personel pasif, erişim kilidi kapalı, eşleme
    //        kaymış) yetki kendiliğinden askıya alınır. Panel bunu "verildi" diye göstermemeli.
    // [HOW]: gateOpen yalnız açıkça false ise kilit nedeni yazılır (bilinmeyen durumda askı iddia edilmez).
    function grantState(mapping, person, gateOpen) {
        if (!isGranted(mapping)) return { state: 'none', reasons: [], text: 'Yetki yok' };
        const reasons = [];
        if (!person) reasons.push('personel kaydı bulunamadı');
        else {
            if (person.active === false) reasons.push('personel pasif');
            if (String(mapping.personelId) !== String(person.id) || text(mapping.pri) !== text(person.pri)
                || (!blank(mapping.id) && String(person.uid || '') !== String(mapping.id))) reasons.push('kimlik eşlemesi uyuşmuyor');
        }
        if (gateOpen === false) reasons.push('Personel Erişim Kilidi kapalı');
        return reasons.length
            ? { state: 'suspended', reasons, text: 'Askıda — ' + reasons.join(', ') }
            : { state: 'active', reasons: [], text: 'Aktif' };
    }

    /** Gerekçe: kırpılmış 5–300 karakter, etiket benzeri "<harf" yok. Dönüş { ok, value, error }. */
    function validateReason(reason) {
        const value = typeof reason === 'string' ? reason.trim() : '';
        if (value.length < REASON_MIN) return { ok: false, value, error: `Gerekçe en az ${REASON_MIN} karakter olmalı.` };
        if (value.length > REASON_MAX) return { ok: false, value, error: `Gerekçe en çok ${REASON_MAX} karakter olabilir.` };
        if (TAG_LIKE.test(value)) return { ok: false, value, error: 'Gerekçede etiket benzeri "<" ifadesi kullanılamaz.' };
        return { ok: true, value, error: null };
    }

    const fail = (code, error) => ({ ok: false, code, error });
    function checkActor(actorUid, auditId) {
        if (blank(actorUid)) return fail('no-auth', 'Oturum bulunamadı.');
        if (blank(auditId) || String(auditId).length > AUDIT_ID_MAX || TAG_LIKE.test(String(auditId))) return fail('invalid-argument', 'Geçersiz denetim kaydı kimliği.');
        return null;
    }
    function patchFor(granted, { actorUid, reason, auditId, now }) {
        return { adminGranted: granted, adminChangedAt: now, adminChangedBy: String(actorUid), adminReason: reason, adminAuditId: String(auditId) };
    }
    function auditFor(type, uid, label, reason, from, to) {
        return { type, refCol: REF_COL, refId: String(uid), item: label, reason, fromValue: from, toValue: to, result: 'approved' };
    }
    const labelOf = (person, mapping, uid) => {
        const pri = text(person && person.pri) || text(mapping && mapping.pri);
        const name = person ? personName(person) : '';
        return name && name !== '-' ? (pri ? `${name} (${pri})` : name) : (pri || String(uid));
    };

    /**
     * Yetki verme planı. person / mapping SUNUCUDAN taze okunmuş olmalı (transaction içinde).
     * Dönüş: { ok:true, uid, patch, audit } | { ok:false, code, error }
     */
    // [WHY]: Kural aynı yazımda şekli, gerekçeyi, eşlemenin değişmediğini ve kişinin uygunluğunu ayrıca doğrular; istemci
    //        uymayan bir yazımı göndermeden, anlaşılır nedenle durdurur.
    // [HOW]: Uygunluk (eligibility) 'ok' değilse ya da gerekçe geçersizse yazım planı üretilmez.
    function planGrant({ person, mapping, actorUid, reason, auditId, now, accountEmail } = {}) {
        const actorErr = checkActor(actorUid, auditId);
        if (actorErr) return actorErr;
        const r = validateReason(reason);
        if (!r.ok) return fail('invalid-reason', r.error);
        const e = eligibility(person, mapping, accountEmail);
        if (!e.ok) return fail(e.code, e.text);
        const uid = String(person.uid);
        return {
            ok: true, uid,
            patch: patchFor(true, { actorUid, reason: r.value, auditId, now }),
            audit: auditFor(AUDIT_TYPES.GRANTED, uid, labelOf(person, mapping, uid), r.value, AUDIT_VALUES.NONE, AUDIT_VALUES.ADMIN),
        };
    }

    /**
     * Yetki geri alma planı. Personel kaydı silinmiş / pasif olsa da geri alma her zaman mümkündür (person null olabilir).
     * Dönüş: { ok:true, uid, patch, audit } | { ok:false, code, error }
     */
    function planRevoke({ person, mapping, uid, actorUid, reason, auditId, now } = {}) {
        const actorErr = checkActor(actorUid, auditId);
        if (actorErr) return actorErr;
        if (blank(uid)) return fail('invalid-argument', 'Geri alınacak hesap belirtilmedi.');
        if (!isGranted(mapping)) return fail('not-admin', 'Bu hesapta yönetici yetkisi yok (başka biri geri almış olabilir).');
        const r = validateReason(reason);
        if (!r.ok) return fail('invalid-reason', r.error);
        return {
            ok: true, uid: String(uid),
            patch: patchFor(false, { actorUid, reason: r.value, auditId, now }),
            audit: auditFor(AUDIT_TYPES.REVOKED, uid, labelOf(person, mapping, uid), r.value, AUDIT_VALUES.ADMIN, AUDIT_VALUES.NONE),
        };
    }

    // [WHY]: Panelin iki bölümü (mevcut yöneticiler, aday personel) aynı veriden türetilir; mantık arayüzde dağılmasın.
    // [HOW]: adminRows — yetkili eşlemeler kişiyle birleştirilir, durumu (grantState) hesaplanır. candidates — her personelin
    //        uygunluğu; uygun olanlar önce, sonra ada göre. matchesQuery — Türkçe harf duyarsız ad / PRI araması.
    function adminRows({ mappings = [], personel = [], gateOpen } = {}) {
        const byId = new Map((personel || []).filter(p => p && !blank(p.id)).map(p => [String(p.id), p]));
        return (mappings || []).filter(isGranted).map(m => {
            const person = byId.get(String(m.personelId)) || null;
            return { uid: String(m.id), mapping: m, person, name: person ? personName(person) : '-', pri: text(person && person.pri) || text(m.pri),
                state: grantState(m, person, gateOpen) };
        }).sort((a, b) => a.name.localeCompare(b.name, 'tr'));
    }
    function candidates({ personel = [], mappings = [], accountEmail } = {}) {
        const byUid = new Map((mappings || []).filter(m => m && !blank(m.id)).map(m => [String(m.id), m]));
        return (personel || []).filter(p => p && !blank(p.id)).map(p => ({
            person: p, name: personName(p), pri: text(p.pri),
            eligibility: eligibility(p, blank(p.uid) ? null : (byUid.get(String(p.uid)) || null), accountEmail),
        })).sort((a, b) => (a.eligibility.ok === b.eligibility.ok ? a.name.localeCompare(b.name, 'tr') : (a.eligibility.ok ? -1 : 1)));
    }
    const fold = s => String(s || '').toLocaleLowerCase('tr-TR')
        .replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ç/g, 'c');
    function matchesQuery(row, query) {
        const q = fold(query).trim();
        if (!q) return true;
        return fold(row && row.name).includes(q) || fold(row && row.pri).includes(q);
    }

    window.AppModules = window.AppModules || {};
    window.AppModules.AdminGrants = Object.freeze({
        AUDIT_TYPES, AUDIT_LABELS, AUDIT_VALUES, AUDIT_VALUE_LABELS, ADMIN_FIELDS, REF_COL, REASON_MIN, REASON_MAX, ELIGIBILITY_TEXT,
        eligibility, grantState, validateReason, planGrant, planRevoke, adminRows, candidates, matchesQuery,
    });
})();
