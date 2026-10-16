/**
 * utils/staff-code-registry.js — Personel giriş kodu sicili: benzersizlik kuralı (Faz 4B · Tur J7.5)
 * Klasik script; iki sayfada <head>'de schema.js'ten sonra (personel akışları, VIP Kod Benzersizleştirme sihirbazı ve J8
 * girişi kullanır). Saf: window.data'yı okumaz, listeyi parametre olarak alır → tests/unit/staff-code-registry.test.mjs.
 *
 * [WHY]: Giriş bugün `personel.find(p => p.code === code)` ile yapılıyor: aynı kodu paylaşan iki kişiden hangisinin oturum
 *        açacağını liste sırası belirliyor. J7'de hesaplar personel id'si başına açıldı; J8'de giriş "kod → personel →
 *        hesap e-postası" eşlemesiyle yapılacak — kod tekil değilse kişi yanlış hesaba girer. Ekleme akışlarındaki eski
 *        kontrol kırpmadan karşılaştırıyordu ve düzenleme / hızlı ekleme yollarında tek tip değildi.
 * [HOW]: Tek kural, tek yer:
 *        - normCode: girişle birebir (kırpılmış, büyük/küçük harf DUYARLI — completeStaffLogin `p.code === code`).
 *        - validateCode: boş değil, boşluk içermez, ≥ MIN_CODE_LENGTH (J7 parola kuralıyla aynı), başka personelde yok.
 *        - duplicateGroups / planCodeChanges: VIP sihirbazı. Yeni kod, MEVCUT hiçbir kodla (değişecek olanlar dahil) ve
 *          aynı partideki başka yeni kodla çakışamaz — böylece parti sıralı uygulanırken ara durumda bile çakışma oluşmaz
 *          ve yarıda kalan parti asla yeni bir çakışma bırakmaz (kod takası A↔B bilinçli olarak reddedilir).
 *        - resolveLoginCode: J8 savunma hattı — eşleşen kayıt sayısı `filter(...).length > 1` ise giriş REDDEDİLİR
 *          ('ambiguous'); ilk eşleşmeye asla düşülmez.
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

    /** Aynı kodu paylaşan personel grupları. Grup anahtarı kodun kendisi DEĞİL (gösterim/log için güvenli), sıra no'dur. */
    function duplicateGroups(personel) {
        const byCode = new Map();
        (personel || []).forEach(p => {
            const c = p && normCode(p.code);
            if (c) byCode.set(c, [...(byCode.get(c) || []), p]);
        });
        let n = 0;
        return [...byCode.values()].filter(m => m.length > 1).map(members => ({
            key: 'g' + (++n),
            // Varsayılan "kodu korunacak" kişi: giriş hesabı bağlı olan (hesap parolası değişmesin), yoksa listedeki ilk kişi
            members: [...members].sort((a, b) => (b.uid ? 1 : 0) - (a.uid ? 1 : 0)),
        }));
    }

    /**
     * J8 savunma hattı: girilen kodu personele çözer. İlk eşleşmeye ASLA düşmez.
     * @returns {{status:'none'|'unique'|'ambiguous', person:object|null, count:number}}
     */
    function resolveLoginCode(personel, code) {
        const c = normCode(code);
        if (!c) return { status: 'none', person: null, count: 0 };
        const matches = (personel || []).filter(p => p && normCode(p.code) === c);
        if (matches.length > 1) return { status: 'ambiguous', person: null, count: matches.length };
        if (matches.length === 0) return { status: 'none', person: null, count: 0 };
        return { status: 'unique', person: matches[0], count: 1 };
    }

    // ─── J8 · Hibrit giriş kararı ────────────────────────────────────────────────────────────────────
    const AUTH_MODES = ['anonymous', 'hybrid', 'accounts'];
    /**
     * Girilen kod + mod → ne yapılacağı (saf; Firebase'e dokunmaz).
     * @returns {{action:'reject', reason:'invalid'|'ambiguous'|'no-account', count?:number}
     *         | {action:'account', person:object, email:string}
     *         | {action:'legacy', person:object}}
     */
    function planStaffLogin({ personel, code, mode }) {
        const m = AUTH_MODES.includes(mode) ? mode : 'hybrid';
        const r = resolveLoginCode(personel, code);
        if (r.status === 'none') return { action: 'reject', reason: 'invalid' };
        if (r.status === 'ambiguous') return { action: 'reject', reason: 'ambiguous', count: r.count };
        const person = r.person;
        if (m === 'anonymous') return { action: 'legacy', person };
        if (person.authEmail) return { action: 'account', person, email: String(person.authEmail) };
        return m === 'accounts' ? { action: 'reject', reason: 'no-account' } : { action: 'legacy', person };
    }

    /**
     * Hesapla giriş başarısız olunca: 'legacy' (hibritte parola uyumsuzsa eski yola düş) | 'reject' + neden.
     * Hibritte yalnız kimlik bilgisi uyuşmazlığı (hesap senkronu bozuk) eski yola düşer — Aşama A güvenlik seviyesi zaten
     * budur; ağ / kota / devre dışı hesap gibi durumlar reddedilir (eski yola düşmek sorunu gizlerdi).
     */
    function accountFailurePolicy(mode, errorCode) {
        const c = String(errorCode || '').replace(/^auth\//, '');
        if (['too-many-requests', 'quota-exceeded'].includes(c)) return { action: 'reject', reason: 'rate-limited' };
        if (c === 'user-disabled') return { action: 'reject', reason: 'disabled' };
        const mismatch = ['wrong-password', 'invalid-credential', 'invalid-login-credentials', 'user-not-found'].includes(c);
        if (mismatch) return mode === 'hybrid' ? { action: 'legacy', reason: 'account-out-of-sync' } : { action: 'reject', reason: 'account-out-of-sync' };
        return { action: 'reject', reason: 'network' };
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

    /**
     * VIP sihirbazının partisi: [{id, newCode}] → doğrulanmış değişiklikler ya da hata listesi.
     * Kurallar: kişi listede var ve partide bir kez geçer; yeni kod validateCode'dan geçer (tüm MEVCUT kodlara karşı — kendi
     * eski kodu dahil: değişmeyen "değişiklik" anlamsız) ve partideki diğer yeni kodlarla çakışmaz; partiden sonra kalan
     * çakışma grupları (keep sayısı > 1) raporlanır.
     * @returns {{ok:boolean, errors:{id, message}[], changes:{person, newCode}[], unresolved:number}}
     */
    function planCodeChanges(personel, changes) {
        const errors = [], out = [], seen = new Set(), chosen = [];
        (changes || []).forEach(ch => {
            const id = ch && ch.id;
            const person = (personel || []).find(p => p && sameId(p.id, id));
            if (!person) { errors.push({ id, message: 'Personel bulunamadı; liste güncellenmiş olabilir.' }); return; }
            if (seen.has(String(id))) { errors.push({ id, message: 'Aynı personel partide iki kez geçiyor.' }); return; }
            seen.add(String(id));
            const newCode = normCode(ch.newCode);
            const v = validateCode(newCode, personel, { reserved: chosen });   // excludeId YOK: kendi eski koduna dönemez
            if (!v.ok) { errors.push({ id, message: `${person.name || '-'}: ${v.message}` }); return; }
            chosen.push(newCode);
            out.push({ person, newCode });
        });
        const after = (personel || []).map(p => {
            const ch = out.find(x => sameId(x.person.id, p && p.id));
            return ch ? { ...p, code: ch.newCode } : p;
        });
        const unresolved = duplicateGroups(after).length;
        return { ok: errors.length === 0, errors, changes: errors.length ? [] : out, unresolved };
    }

    const StaffCodeRegistry = {
        MIN_CODE_LENGTH, SUGGEST_ALPHABET, SUGGEST_LENGTH,
        normCode, findConflicts, validateCode, duplicateGroups, resolveLoginCode, suggestCode, planCodeChanges,
        planStaffLogin, accountFailurePolicy,
    };
    window.AppModules = window.AppModules || {};
    window.AppModules.StaffCodeRegistry = StaffCodeRegistry;
    window.StaffCodeRegistry = StaffCodeRegistry;
})();
