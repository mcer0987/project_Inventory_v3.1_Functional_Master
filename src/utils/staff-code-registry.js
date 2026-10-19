/**
 * utils/staff-code-registry.js — Personel giriş kodu biçim kuralı ve öneri (Faz 4B · J7.5 → J10)
 * Klasik script; iki sayfada <head>'de schema.js'ten sonra (personel ekleme / hızlı ekleme / "Hesap Aç" kullanır).
 * Saf: window.data'yı okumaz, listeyi parametre olarak alır → tests/unit/staff-code-registry.test.mjs.
 *
 * [WHY]: Kod, personelin Firebase Auth hesabının parolasının parçasıdır (kod + dolgu). J7.5'te giriş "kod → personel"
 *        eşlemesine dayandığı için kodların tekil olması zorunluydu; J10'da giriş kurumsal kimlik (PRI) + kodla Auth'a yapılıyor ve kodlar
 *        personel kaydında TUTULMUYOR. Kod → kişi çözümü (J8), çakışma grupları ve kod değiştirme partisi (J7.5) kaldırıldı.
 * [HOW]: - normCode: girişle birebir (kırpılmış, büyük/küçük harf DUYARLI).
 *        - validateCode: boş değil, boşluk içermez, ≥ MIN_CODE_LENGTH (parola kuralı); verilen listede başka personelde yok
 *          (J10 çağıranları boş liste verir: yalnız biçim).
 *        - suggestCode: okunaklı alfabeden (0/o, 1/l/i yok) 5 karakterlik öneri.
 */
(function () {
    const MIN_CODE_LENGTH = 4;   // staff-provisioning.js ile aynı (kod + dolgu ≥ Firebase alt sınırı)
    // Öneri alfabesi: karıştırılan karakterler yok (0/o, 1/l/i)
    const SUGGEST_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
    const SUGGEST_LENGTH = 5;    // bugünkü kodlarla aynı uzunluk (giriş girdisine dokunulmadı; 8 karakter J8 kararı)

    const normCode = code => (code === undefined || code === null ? '' : String(code).trim());
    const sameId = (a, b) => String(a) === String(b);

    /** Bu kodu kullanan personel (excludeId hariç). */
    function findConflicts(personel, code, { excludeId } = {}) {
        const c = normCode(code);
        if (!c) return [];
        return (personel || []).filter(p => p && normCode(p.code) === c && (excludeId === undefined || !sameId(p.id, excludeId)));
    }

    /**
     * @returns {{ok:boolean, reason:null|'empty'|'whitespace'|'too-short'|'duplicate', message:string, conflicts:object[]}}
     *          message kodun kendisini içermez.
     */
    function validateCode(code, personel, { excludeId, reserved = [] } = {}) {
        const c = normCode(code);
        const fail = (reason, message, conflicts = []) => ({ ok: false, reason, message, conflicts });
        if (!c) return fail('empty', 'Giriş kodu boş olamaz.');
        if (/\s/.test(c)) return fail('whitespace', 'Giriş kodu boşluk içeremez.');
        if (c.length < MIN_CODE_LENGTH) return fail('too-short', `Giriş kodu en az ${MIN_CODE_LENGTH} karakter olmalı.`);
        const conflicts = findConflicts(personel, c, { excludeId });
        if (conflicts.length) {
            const names = conflicts.slice(0, 3).map(p => p.name || '-').join(', ');
            return fail('duplicate', `Bu giriş kodu başka bir personelde kullanılıyor (${names}${conflicts.length > 3 ? '…' : ''}).`, conflicts);
        }
        if (reserved.map(normCode).includes(c)) return fail('duplicate', 'Bu giriş kodu bu işlemde başka bir personel için seçildi.');
        return { ok: true, reason: null, message: 'Kod kullanılabilir.', conflicts: [] };
    }

    /** Listede ve reserved'da olmayan, okunması kolay rastgele kod. rng enjekte edilebilir (test). */
    function suggestCode(personel, { reserved = [], length = SUGGEST_LENGTH, rng = Math.random, maxTries = 200 } = {}) {
        const taken = new Set([...(personel || []).map(p => p && normCode(p.code)), ...reserved.map(normCode)]);
        for (let t = 0; t < maxTries; t++) {
            let c = '';
            for (let i = 0; i < length; i++) c += SUGGEST_ALPHABET[Math.floor(rng() * SUGGEST_ALPHABET.length) % SUGGEST_ALPHABET.length];
            if (!taken.has(c)) return c;
        }
        throw new Error('Benzersiz kod üretilemedi; elle girin.');
    }

    const StaffCodeRegistry = {
        MIN_CODE_LENGTH, SUGGEST_ALPHABET, SUGGEST_LENGTH,
        normCode, findConflicts, validateCode, suggestCode,
    };
    window.AppModules = window.AppModules || {};
    window.AppModules.StaffCodeRegistry = StaffCodeRegistry;
    window.StaffCodeRegistry = StaffCodeRegistry;
})();
