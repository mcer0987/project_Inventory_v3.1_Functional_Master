/**
 * utils/staff-lifecycle.js — v3.8 · VP-3 · Personel Hesap Yaşam Döngüsü saf çekirdeği.
 * Klasik script; iki sayfada <head>'de staff-provisioning.js'ten sonra yüklenir.
 * Saf: DOM'a ve Firebase SDK'ya dokunmaz → tests/unit/staff-lifecycle.test.mjs.
 *
 * [WHY]: Şifre sıfırlama talebi (24 saat limitli), süreli tek kullanımlık geçici PIN,
 *        parola yenileme ve hesap askıya alma / yeniden aktifleştirme kuralları tek saf
 *        sözleşmede toplanmalı; zayıf kodlar (12345, 00000 vb.) ve düz metin parola sızıntısı
 *        istemciden önce çekirdek katmanda önlenmelidir.
 * [HOW]: - Kriptografik rastgele üretim: crypto.getRandomValues + modulo sapmasız reddetme örneklemesi.
 *        - Zayıf kalıp süzgeci: ardışık diziler, tekrarlar, yetersiz benzersiz karakter ve kara liste.
 *        - 24 saat cooldown, TTL tavanı (≤24 saat) ve transaction planlayıcıları (auditLogs dahil).
 */
(function () {
    'use strict';

    const RESET_COOLDOWN_MS = 24 * 60 * 60 * 1000;
    const MIN_TEMP_PIN_TTL_MINUTES = 5;
    const MAX_TEMP_PIN_TTL_MINUTES = 24 * 60;
    const TEMP_PIN_TTL_OPTIONS = Object.freeze([15, 60, 240, 1440]);
    const TEMP_PIN_LENGTH = 6;
    const RESET_CODE_LENGTH = 8;
    const MIN_CODE_LENGTH = 4;
    const MAX_CODE_LENGTH = 64;
    const NOTE_MAX_LEN = 160;
    const RESOLUTION_NOTE_MAX_LEN = 200;
    const REASON_MIN_LEN = 5;
    const REASON_MAX_LEN = 300;
    const PIN_ALPHABET = '0123456789';
    const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
    const PRI_RE = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

    const AUDIT_TYPES = Object.freeze({
        SUSPEND: 'personel-hesabi-askiya-alindi',
        REACTIVATE: 'personel-hesabi-aktiflestirildi',
        TEMP_PIN: 'gecici-pin-tanimlandi',
        RESET_CODE: 'personel-kodu-sifirlandi',
        SELF_CODE_CHANGE: 'personel-gecici-kod-degistirildi',
        RESET_RESOLVED: 'sifre-sifirlama-cozuldu',
        RESET_DISMISSED: 'sifre-sifirlama-reddedildi',
    });

    const NEUTRAL_RESET_MESSAGE =
        'Talebiniz işleme alındı veya aynı hesap için 24 saatlik bekleme süresi devam ediyor. Yönetici onayından sonra yeni giriş kodunuzu teslim alabilirsiniz.';

    const RESET_GUARD_STORAGE_KEY = 'medipol_reset_guard_v1';
    const DEVICE_FLOOD_WINDOW_MS = 60 * 60 * 1000;
    const DEVICE_FLOOD_MAX_PRIS = 2;
    const LOCAL_GUARD_BLOCKED_MESSAGE =
        'Aynı kurumsal kimlik veya bu cihaz için kısa süre önce talep kaydedildi; mükerrer istek sunucuya iletilmedi (24 saatlik yerel koruma aktif).';

    const WEAK_BLACKLIST = new Set([
        '0000', '00000', '000000', '1111', '11111', '111111', '2222', '22222', '222222',
        '1234', '12345', '123456', '1234567', '12345678', '4321', '54321', '654321', '98765', '987654',
        '01234', '012345', '112233', '121212', '123123', '696969', '102030',
        'abcd', 'abcde', 'abcdef', 'qwerty', 'qwert', 'asdfg', 'zxcvb',
        'admin', 'admin1', 'admin123', 'medipol', 'password', 'pass123', 'sifre', 'sifre1', 'parola', 'test', 'test1', 'test123',
    ]);

    const TR_FOLD = {
        'ç': 'c', 'Ç': 'c', 'ğ': 'g', 'Ğ': 'g', 'ı': 'i', 'I': 'i', 'İ': 'i',
        'ö': 'o', 'Ö': 'o', 'ş': 's', 'Ş': 's', 'ü': 'u', 'Ü': 'u',
        'â': 'a', 'Â': 'a', 'î': 'i', 'Î': 'i', 'û': 'u', 'Û': 'u',
    };

    const str = v => (v === undefined || v === null ? '' : String(v));
    const noTag = v => !/[<>]/.test(str(v));

    // [WHY]: Giriş ekranı ve kurallardaki PRI normalizasyonu tek kaynaktan çalışmalı.
    // [HOW]: Türkçe harfler ASCII karşılığına indirgenir, küçük harfe çevrilir ve kırpılır.
    function normalizePri(raw) {
        return str(raw)
            .replace(/[çÇğĞıIİöÖşŞüÜâÂîÎûÛ]/g, ch => TR_FOLD[ch])
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .trim();
    }

    function isValidPriId(pri) {
        const p = normalizePri(pri);
        return p.length >= 1 && p.length <= 64 && PRI_RE.test(p);
    }

    // [WHY]: Ardışık artan/azalan karakter dizileri (ör. 1234, 6543, abcd) tahmin edilebilir zayıf kodlardır.
    // [HOW]: Karakter kod noktaları arasında 4+ karakterlik sabit +1 veya -1 fark taraması yapar.
    function hasSequentialRun(s, runLen = 4) {
        if (s.length < runLen) return false;
        let inc = 1;
        let dec = 1;
        for (let i = 1; i < s.length; i++) {
            const diff = s.charCodeAt(i) - s.charCodeAt(i - 1);
            inc = diff === 1 ? inc + 1 : 1;
            dec = diff === -1 ? dec + 1 : 1;
            if (inc >= runLen || dec >= runLen) return true;
        }
        return false;
    }

    // [WHY]: 12345, 00000, aaaaa, 121212, 123123 gibi zayıf geçici PIN veya personel kodları engellenmelidir.
    // [HOW]: Kara liste, tek karakter tekrarı, yarı/çift tekrar kalıbı, düşük çeşitlilik ve ardışık dizi süzgeci.
    function isWeakCode(code) {
        const trimmed = str(code).trim();
        if (!trimmed || /\s/.test(trimmed) || trimmed.length < MIN_CODE_LENGTH) return true;
        const low = trimmed.toLowerCase();
        if (WEAK_BLACKLIST.has(low)) return true;
        if (/^(.)\1+$/.test(low)) return true;
        const unique = new Set(low.split('')).size;
        if (unique < 2) return true;
        if (low.length >= 6 && unique < 3) return true;
        if (low.length % 2 === 0 && low.slice(0, low.length / 2) === low.slice(low.length / 2)) return true;
        if (/^(.{2})\1+$/.test(low)) return true;
        if (hasSequentialRun(low, 4)) return true;
        return false;
    }

    // [WHY]: Personel yeni kod seçerken veya yönetici kod üretirken tek tip doğrulama (düz metin kod mesajda yer almaz).
    // [HOW]: Biçim, uzunluk, zayıf kalıp ve yasaklı liste (ör. mevcut geçici PIN ile aynı olmasın) denetlenir.
    function validateNewCode(code, { forbidden = [], minLength = MIN_CODE_LENGTH } = {}) {
        const c = str(code).trim();
        const fail = (reason, message) => ({ ok: false, reason, message });
        if (!c) return fail('empty', 'Giriş kodu boş olamaz.');
        if (/\s/.test(c)) return fail('whitespace', 'Giriş kodu boşluk içeremez.');
        if (c.length < minLength) return fail('too-short', `Giriş kodu en az ${minLength} karakter olmalıdır.`);
        if (c.length > MAX_CODE_LENGTH) return fail('too-long', `Giriş kodu en fazla ${MAX_CODE_LENGTH} karakter olabilir.`);
        if (isWeakCode(c)) return fail('weak', 'Bu kod tahmin edilmesi kolay bir kalıp içeriyor (ör. ardışık veya tekrar eden karakterler). Daha güçlü bir kod belirleyin.');
        const cleanForbidden = (forbidden || []).map(x => str(x).trim()).filter(Boolean);
        if (cleanForbidden.includes(c)) return fail('reused', 'Yeni giriş kodu geçici kod ile aynı olamaz; farklı bir kod belirleyin.');
        return { ok: true, reason: null, message: 'Kod güvenli ve kullanılabilir.' };
    }

    // [WHY]: Math.random tahmin edilebilir; mod alma işlemi ise küçük alfabelerde dağılım sapması oluşturabilir.
    // [HOW]: crypto.getRandomValues + reddetme örneklemesi (rejection sampling); birim testlerde deterministik rng enjekte edilebilir.
    function secureRandomInt(max, rng) {
        if (!Number.isInteger(max) || max <= 0) throw new Error('Geçersiz üst sınır.');
        if (typeof rng === 'function') {
            const v = Number(rng());
            const clamped = Number.isFinite(v) ? Math.min(Math.max(v, 0), 0.999999999) : 0;
            return Math.floor(clamped * max) % max;
        }
        const cryptoObj = (typeof crypto !== 'undefined' && crypto)
            || (typeof globalThis !== 'undefined' && globalThis.crypto)
            || (typeof window !== 'undefined' && window.crypto)
            || null;
        if (!cryptoObj || typeof cryptoObj.getRandomValues !== 'function') {
            throw new Error('Kriptografik rastgele üretici (crypto.getRandomValues) kullanılamıyor.');
        }
        const buf = new Uint32Array(1);
        const limit = Math.floor(0x100000000 / max) * max;
        let r = 0;
        do {
            cryptoObj.getRandomValues(buf);
            r = buf[0];
        } while (r >= limit);
        return r % max;
    }

    // [WHY]: Yönetici geçici PIN veya şifre sıfırlama kodu ürettiğinde kriptografik güç ve okunabilirlik garanti edilir.
    // [HOW]: kind='tempPin' → 6 haneli tek kullanımlık sayısal PIN (≥4 farklı rakam, zayıf kalıp yok);
    //        kind='code' → 8 karakterlik okunaklı alfasayısal kod (en az 1 harf + 1 rakam, zayıf kalıp yok).
    function generateSecureCode({ kind = 'code', length, rng, forbidden = [], maxTries = 300 } = {}) {
        const isPin = kind === 'tempPin';
        const alphabet = isPin ? PIN_ALPHABET : CODE_ALPHABET;
        const len = Number.isInteger(length) && length >= MIN_CODE_LENGTH && length <= MAX_CODE_LENGTH
            ? length
            : (isPin ? TEMP_PIN_LENGTH : RESET_CODE_LENGTH);
        const deny = new Set((forbidden || []).map(x => str(x).trim()).filter(Boolean));

        for (let attempt = 0; attempt < maxTries; attempt++) {
            let out = '';
            for (let i = 0; i < len; i++) {
                out += alphabet[secureRandomInt(alphabet.length, rng)];
            }
            if (deny.has(out)) continue;
            if (isWeakCode(out)) continue;
            if (isPin) {
                if (len >= 6 && new Set(out.split('')).size < 4) continue;
            } else {
                if (!/[a-z]/.test(out) || !/[0-9]/.test(out)) continue;
            }
            return out;
        }
        throw new Error('Güvenli kod üretilemedi; lütfen tekrar deneyin.');
    }

    // [WHY]: 24 saatte en fazla 1 sıfırlama talebi istemci tarafında da tutarlı hesaplanır (asıl zorlayıcı firestore.rules'tur).
    // [HOW]: Son talep zaman damgasından itibaren 24 saat (86.400.000 ms) geçip geçmediğini döner.
    function canResubmitResetRequest(requestedAtMs, nowMs = Date.now()) {
        if (requestedAtMs === null || requestedAtMs === undefined) return { allowed: true, remainingMs: 0 };
        const prev = Number(requestedAtMs);
        const now = Number(nowMs);
        if (!Number.isFinite(prev) || !Number.isFinite(now)) return { allowed: false, remainingMs: RESET_COOLDOWN_MS };
        const elapsed = now - prev;
        if (elapsed >= RESET_COOLDOWN_MS) return { allowed: true, remainingMs: 0 };
        return { allowed: false, remainingMs: Math.max(1, RESET_COOLDOWN_MS - elapsed) };
    }

    function validateResetNote(note) {
        const v = str(note).trim();
        if (v.length > NOTE_MAX_LEN) return { ok: false, value: '', error: `Açıklama en fazla ${NOTE_MAX_LEN} karakter olabilir.` };
        if (!noTag(v)) return { ok: false, value: '', error: 'Açıklamada "<" veya ">" karakterleri kullanılamaz.' };
        return { ok: true, value: v, error: null };
    }

    function validateResolutionNote(note) {
        const v = str(note).trim();
        if (v.length > RESOLUTION_NOTE_MAX_LEN) return { ok: false, value: '', error: `Çözüm notu en fazla ${RESOLUTION_NOTE_MAX_LEN} karakter olabilir.` };
        if (!noTag(v)) return { ok: false, value: '', error: 'Çözüm notunda "<" veya ">" karakterleri kullanılamaz.' };
        return { ok: true, value: v, error: null };
    }

    function validateLifecycleReason(reason) {
        const v = str(reason).trim();
        if (v.length < REASON_MIN_LEN) return { ok: false, value: '', error: `Gerekçe en az ${REASON_MIN_LEN} karakter olmalıdır.` };
        if (v.length > REASON_MAX_LEN) return { ok: false, value: '', error: `Gerekçe en fazla ${REASON_MAX_LEN} karakter olabilir.` };
        if (!noTag(v)) return { ok: false, value: '', error: 'Gerekçede "<" veya ">" karakterleri kullanılamaz.' };
        return { ok: true, value: v, error: null };
    }

    function validateTempPinTtl(ttlMinutes) {
        const m = Number(ttlMinutes);
        if (!Number.isInteger(m) || m < MIN_TEMP_PIN_TTL_MINUTES || m > MAX_TEMP_PIN_TTL_MINUTES) {
            return {
                ok: false,
                minutes: 0,
                error: `Geçici kod süresi ${MIN_TEMP_PIN_TTL_MINUTES} dakika ile ${MAX_TEMP_PIN_TTL_MINUTES} dakika (24 saat) arasında olmalıdır.`,
            };
        }
        return { ok: true, minutes: m, error: null };
    }

    // [WHY]: Şifre sıfırlama talebi sözleşmesi firestore.rules resetReqCreateOk ile birebir eşleşmelidir.
    // [HOW]: Normalize edilmiş PRI'yi belge kimliği olarak belirler; yalnız 4 kapalı alanı üretir.
    function planResetRequest({ pri, note = '', now }) {
        const priId = normalizePri(pri);
        if (!isValidPriId(priId)) {
            return { ok: false, code: 'invalid-pri', error: 'Kurumsal kimlik (PRI) ad.soyad biçiminde olmalıdır (ör. ayse.yilmaz).' };
        }
        const n = validateResetNote(note);
        if (!n.ok) return { ok: false, code: 'invalid-note', error: n.error };
        return {
            ok: true,
            docId: priId,
            payload: {
                pri: priId,
                note: n.value,
                status: 'pending',
                requestedAt: now,
            },
        };
    }

    function planResetResolution({ current, status, resolutionNote = '', actorUid, now }) {
        if (!current || !current.pri) return { ok: false, code: 'not-found', error: 'Sıfırlama talebi bulunamadı.' };
        if (status !== 'resolved' && status !== 'dismissed') {
            return { ok: false, code: 'invalid-status', error: 'Geçersiz talep sonuç durumu.' };
        }
        const noteCheck = validateResolutionNote(resolutionNote);
        if (!noteCheck.ok) return { ok: false, code: 'invalid-note', error: noteCheck.error };
        const cleanActor = str(actorUid).trim();
        if (!cleanActor) return { ok: false, code: 'forbidden', error: 'Yönetici oturumu doğrulanamadı.' };
        const patch = {
            pri: current.pri,
            note: str(current.note),
            status,
            requestedAt: current.requestedAt,
            resolvedAt: now,
            resolvedBy: cleanActor,
            resolutionNote: noteCheck.value,
        };
        const audit = {
            type: status === 'resolved' ? AUDIT_TYPES.RESET_RESOLVED : AUDIT_TYPES.RESET_DISMISSED,
            refCol: 'passwordResetRequests',
            refId: String(current.pri),
            item: String(current.pri),
            result: 'approved',
            reason: noteCheck.value || (status === 'resolved' ? 'Şifre sıfırlama talebi çözüldü' : 'Şifre sıfırlama talebi kapatıldı'),
            fromValue: String(current.status || 'pending'),
            toValue: status,
        };
        return { ok: true, patch, audit };
    }

    // [WHY]: Hesap askıya alma/açma silme (deleteDoc) yapmaz; personel.active ile staffAccounts.status birlikte yazılır.
    // [HOW]: İP-7 K1 koruması (adminGranted hesaba yalnız ana yönetici dokunur) + idempotency + auditLogs planı.
    function planSuspendToggle({ person, mapping, suspend, reason, actorUid, canEditAdminAccount = false, auditId, now }) {
        if (!person || person.id === undefined || person.id === null) {
            return { ok: false, code: 'not-found', error: 'Personel kaydı bulunamadı.' };
        }
        const r = validateLifecycleReason(reason);
        if (!r.ok) return { ok: false, code: 'invalid-reason', error: r.error };
        const cleanActor = str(actorUid).trim();
        if (!cleanActor) return { ok: false, code: 'forbidden', error: 'Yönetici oturumu doğrulanamadı.' };
        const targetSuspend = !!suspend;
        const alreadySuspended = person.active === false && (!mapping || mapping.status === 'suspended');
        const alreadyActive = person.active !== false && (!mapping || mapping.status !== 'suspended');
        if (targetSuspend && alreadySuspended) {
            return { ok: false, code: 'already-suspended', error: 'Bu personel hesabı zaten askıda.' };
        }
        if (!targetSuspend && alreadyActive) {
            return { ok: false, code: 'already-active', error: 'Bu personel hesabı zaten aktif.' };
        }
        if (mapping && mapping.adminGranted === true && !canEditAdminAccount) {
            return {
                ok: false,
                code: 'admin-protected',
                error: 'Yönetici yetkisi bulunan bir hesabı yalnızca ana yönetici askıya alabilir veya yeniden açabilir.',
            };
        }
        const nextStatus = targetSuspend ? 'suspended' : 'active';
        const personPatch = { active: !targetSuspend };
        const accountPatch = mapping ? {
            status: nextStatus,
            statusChangedAt: now,
            statusChangedBy: cleanActor,
            statusReason: r.value,
            statusAuditId: String(auditId || ''),
        } : null;
        const label = `${person.name || '-'}${person.pri ? ` (${person.pri})` : ''}`;
        const audit = {
            type: targetSuspend ? AUDIT_TYPES.SUSPEND : AUDIT_TYPES.REACTIVATE,
            refCol: mapping ? 'staffAccounts' : 'personel',
            refId: String(mapping ? (mapping.id || person.uid) : person.id),
            item: label,
            result: 'approved',
            reason: r.value,
            fromValue: targetSuspend ? 'active' : 'suspended',
            toValue: nextStatus,
        };
        return { ok: true, personPatch, accountPatch, audit };
    }

    // [WHY]: Süreli geçici PIN veya sıfırlama kodu tanımlanırken düz metin kod kesinlikle veritabanına yazılmaz.
    // [HOW]: Yalnız mustChangeCode, tempPinExpiresAt (≤24 saat) ve auditLogs meta verisi planlanır.
    function planTempPinIssue({ person, mapping, mode = 'tempPin', ttlMinutes = 60, reason, actorUid, canEditAdminAccount = false, auditId, now, expiresAt }) {
        if (!person || !person.uid || !mapping) {
            return { ok: false, code: 'no-account', error: 'Bu personelin bağlı giriş hesabı yok; önce "Hesap Aç" kullanın.' };
        }
        if (person.active === false || mapping.status === 'suspended') {
            return { ok: false, code: 'suspended', error: 'Askıdaki hesaba geçici kod verilemez; önce hesabı yeniden aktifleştirin.' };
        }
        if (mapping.adminGranted === true && !canEditAdminAccount) {
            return {
                ok: false,
                code: 'admin-protected',
                error: 'Yönetici yetkisi bulunan bir hesabın giriş kodunu yalnızca ana yönetici yenileyebilir.',
            };
        }
        const ttl = validateTempPinTtl(ttlMinutes);
        if (!ttl.ok) return { ok: false, code: 'invalid-ttl', error: ttl.error };
        const r = validateLifecycleReason(reason);
        if (!r.ok) return { ok: false, code: 'invalid-reason', error: r.error };
        const cleanActor = str(actorUid).trim();
        if (!cleanActor) return { ok: false, code: 'forbidden', error: 'Yönetici oturumu doğrulanamadı.' };

        const auditType = mode === 'resetCode' ? AUDIT_TYPES.RESET_CODE : AUDIT_TYPES.TEMP_PIN;
        const label = `${person.name || '-'}${person.pri ? ` (${person.pri})` : ''}`;
        return {
            ok: true,
            ttlMinutes: ttl.minutes,
            accountPatch: {
                mustChangeCode: true,
                tempPinExpiresAt: expiresAt,
                tempPinIssuedAt: now,
                tempPinIssuedBy: cleanActor,
                tempPinAuditId: String(auditId || ''),
            },
            audit: {
                type: auditType,
                refCol: 'staffAccounts',
                refId: String(person.uid),
                item: label,
                result: 'approved',
                reason: r.value,
                fromValue: mapping.mustChangeCode ? 'gecici-kod-bekliyor' : 'normal',
                toValue: `${mode === 'resetCode' ? 'kod-sifirlandi' : 'gecici-pin'}:${ttl.minutes}dk`,
            },
        };
    }

    // [WHY]: Spark planında eski kodu tamamen unutulmuş bir hesap için UID koruyan yerel CLI komutu parolasız üretilir.
    // [HOW]: Hiçbir koşulda parola veya kod parametresi eklemez; araç kodu maskeli stdin'den okur.
    function formatOfflineResetCommand(pri, { emulator = false, project = 'medipol-inventory-v3' } = {}) {
        const cleanPri = normalizePri(pri);
        if (!isValidPriId(cleanPri)) return '';
        if (emulator) {
            return `node tools/staff-password-reset.mjs --pri ${cleanPri} --emulator 127.0.0.1:9099 --project ${project}`;
        }
        return `node tools/staff-password-reset.mjs --pri ${cleanPri} --service-account ./service-account.json`;
    }

    function formatTtlLabel(minutes) {
        const m = Number(minutes);
        if (m < 60) return `${m} dakika`;
        const h = m / 60;
        return Number.isInteger(h) ? `${h} saat` : `${m} dakika`;
    }

    // [WHY]: v3.8 HF-2 · Kalan bekleme süresini kullanıcıya ve yöneticiye okunaklı göstermek için.
    // [HOW]: Milisaniyeyi saat ve dakika cinsinden yuvarlayarak Türkçe biçimler (ör. "23 saat 45 dk").
    function formatRemainingCooldown(remainingMs) {
        const ms = Math.max(0, Number(remainingMs) || 0);
        if (ms <= 0) return '0 dk';
        const totalMin = Math.max(1, Math.ceil(ms / 60000));
        const hours = Math.floor(totalMin / 60);
        const mins = totalMin % 60;
        if (hours > 0 && mins > 0) return `${hours} saat ${mins} dk`;
        if (hours > 0) return `${hours} saat`;
        return `${mins} dk`;
    }

    function _resolveStorage(storage) {
        if (storage && typeof storage.getItem === 'function') return storage;
        try {
            if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
        } catch (_) { /* depolama kapalı */ }
        return null;
    }

    // [WHY]: v3.8 HF-2 · Yerel anti-spam koruma durumunu (medipol_reset_guard_v1) güvenli biçimde okur.
    // [HOW]: Bozuk veya eksik JSON durumunda temiz başlangıç nesnesi döner; süresi 48 saati aşmış kayıtları budar.
    function readResetGuardState(storage, nowMs = Date.now()) {
        const store = _resolveStorage(storage);
        const empty = { entries: {}, submissions: [], totalBlocked: 0 };
        if (!store) return empty;
        try {
            const raw = store.getItem(RESET_GUARD_STORAGE_KEY);
            if (!raw) return empty;
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') return empty;
            const now = Number(nowMs) || Date.now();
            const cutoff = now - RESET_COOLDOWN_MS * 2;
            const entries = {};
            if (parsed.entries && typeof parsed.entries === 'object') {
                for (const [k, v] of Object.entries(parsed.entries)) {
                    if (!v || typeof v !== 'object') continue;
                    const lastTs = Number(v.lastAttemptAtMs || v.firstRequestedAtMs || 0);
                    if (lastTs > 0 && lastTs < cutoff) continue;
                    entries[k] = {
                        pri: str(v.pri || k),
                        firstRequestedAtMs: Number(v.firstRequestedAtMs) || 0,
                        lastAttemptAtMs: Number(v.lastAttemptAtMs) || 0,
                        submittedCount: Number(v.submittedCount) || 0,
                        blockedCount: Number(v.blockedCount) || 0,
                        lastBlockedAtMs: Number(v.lastBlockedAtMs) || 0,
                    };
                }
            }
            const submissions = Array.isArray(parsed.submissions)
                ? parsed.submissions
                    .filter(s => s && s.pri && Number(s.atMs) > now - RESET_COOLDOWN_MS)
                    .map(s => ({ pri: normalizePri(s.pri), atMs: Number(s.atMs) }))
                : [];
            return {
                entries,
                submissions,
                totalBlocked: Math.max(0, Number(parsed.totalBlocked) || 0),
            };
        } catch (_) {
            return empty;
        }
    }

    // [WHY]: v3.8 HF-2 · Aynı PRI veya aynı cihazdan art arda sıfırlama talebi tıklamalarını Firestore'a gitmeden durdurur.
    // [HOW]: 1) Aynı PRI için 24 saatlik yerel kilit; 2) Aynı cihazdan 1 saat içinde en fazla 2 farklı PRI flood sınırı.
    function checkLocalResetGuard({ pri, storage, nowMs = Date.now() } = {}) {
        const priId = normalizePri(pri);
        if (!isValidPriId(priId)) {
            return { allowed: true, code: null, remainingMs: 0, remainingLabel: '', blockedCount: 0, message: null };
        }
        const now = Number(nowMs) || Date.now();
        const state = readResetGuardState(storage, now);
        const entry = state.entries[priId];

        if (entry && entry.firstRequestedAtMs > 0) {
            const check = canResubmitResetRequest(entry.firstRequestedAtMs, now);
            if (!check.allowed) {
                const remLabel = formatRemainingCooldown(check.remainingMs);
                return {
                    allowed: false,
                    code: 'local-pri-cooldown',
                    remainingMs: check.remainingMs,
                    remainingLabel: remLabel,
                    blockedCount: (entry.blockedCount || 0) + 1,
                    message: LOCAL_GUARD_BLOCKED_MESSAGE,
                };
            }
        }

        const recentWindowStart = now - DEVICE_FLOOD_WINDOW_MS;
        const recentSubs = state.submissions.filter(s => s.atMs > recentWindowStart);
        const distinctOtherPris = new Set(recentSubs.map(s => s.pri).filter(p => p && p !== priId));
        if (distinctOtherPris.size >= DEVICE_FLOOD_MAX_PRIS) {
            const oldestRecent = recentSubs.reduce((min, s) => (s.atMs < min ? s.atMs : min), now);
            const remMs = Math.max(1000, DEVICE_FLOOD_WINDOW_MS - (now - oldestRecent));
            return {
                allowed: false,
                code: 'local-device-flood',
                remainingMs: remMs,
                remainingLabel: formatRemainingCooldown(remMs),
                blockedCount: (entry ? entry.blockedCount || 0 : 0) + 1,
                message: LOCAL_GUARD_BLOCKED_MESSAGE,
            };
        }

        return { allowed: true, code: null, remainingMs: 0, remainingLabel: '', blockedCount: 0, message: null };
    }

    // [WHY]: v3.8 HF-2 · Gönderilen veya yerelde engellenen her sıfırlama denemesini sıfır Firestore maliyetiyle kaydeder.
    // [HOW]: Başarılı gönderimde 24s penceresini başlatır; engellenen denemede blockedCount ve totalBlocked sayaçlarını artırır.
    function recordLocalResetAttempt({ pri, allowed = true, outcome = 'submitted', storage, nowMs = Date.now() } = {}) {
        const priId = normalizePri(pri);
        if (!isValidPriId(priId)) return null;
        const store = _resolveStorage(storage);
        const now = Number(nowMs) || Date.now();
        const state = readResetGuardState(store, now);
        const prev = state.entries[priId] || {
            pri: priId,
            firstRequestedAtMs: 0,
            lastAttemptAtMs: 0,
            submittedCount: 0,
            blockedCount: 0,
            lastBlockedAtMs: 0,
        };

        if (allowed) {
            const cooldownCheck = prev.firstRequestedAtMs > 0
                ? canResubmitResetRequest(prev.firstRequestedAtMs, now)
                : { allowed: true };
            if (cooldownCheck.allowed) {
                prev.firstRequestedAtMs = now;
                prev.blockedCount = 0;
            }
            prev.submittedCount = (prev.submittedCount || 0) + 1;
            prev.lastAttemptAtMs = now;
            state.submissions.push({ pri: priId, atMs: now });
        } else {
            prev.blockedCount = (prev.blockedCount || 0) + 1;
            prev.lastBlockedAtMs = now;
            prev.lastAttemptAtMs = now;
            state.totalBlocked = (state.totalBlocked || 0) + 1;
        }

        state.entries[priId] = prev;
        if (store && typeof store.setItem === 'function') {
            try {
                store.setItem(RESET_GUARD_STORAGE_KEY, JSON.stringify(state));
            } catch (_) { /* kota/gizli mod */ }
        }
        return { entry: { ...prev }, outcome, totalBlocked: state.totalBlocked };
    }

    // [WHY]: v3.8 HF-2 · Yönetici panelindeki sıfırlama taleplerini yerel anti-spam telemetrisiyle zenginleştirir.
    // [HOW]: Her talebe localBlockedCount ve kalan bekleme süresini ekler; cihaz bazlı toplam engellenen spam sayısını raporlar.
    function analyzeResetRequests(requests = [], { storage, nowMs = Date.now() } = {}) {
        const now = Number(nowMs) || Date.now();
        const state = readResetGuardState(storage, now);
        const list = Array.isArray(requests) ? requests : [];

        const enriched = list.map(req => {
            const priId = normalizePri((req && (req.pri || req.id)) || '');
            const g = state.entries[priId];
            const baseReqMs = Number(req && req.requestedAtMs) || (g && g.firstRequestedAtMs) || 0;
            const cd = baseReqMs > 0 ? canResubmitResetRequest(baseReqMs, now) : { allowed: true, remainingMs: 0 };
            const localBlockedCount = g ? Number(g.blockedCount) || 0 : 0;
            return {
                ...req,
                localBlockedCount,
                isRepeatedAttempt: localBlockedCount > 0,
                cooldownRemainingMs: cd.remainingMs,
                cooldownLabel: cd.allowed ? '' : formatRemainingCooldown(cd.remainingMs),
            };
        });

        const recentSubs = state.submissions.filter(s => s.atMs > now - DEVICE_FLOOD_WINDOW_MS);
        const recentDistinctPriCount = new Set(recentSubs.map(s => s.pri)).size;
        const activeLockedPris = Object.values(state.entries)
            .filter(e => e.firstRequestedAtMs > 0 && !canResubmitResetRequest(e.firstRequestedAtMs, now).allowed)
            .map(e => e.pri);

        return {
            requests: enriched,
            totalLocalBlocked: state.totalBlocked || 0,
            activeLockedPris,
            recentDistinctPriCount,
            deviceFloodActive: recentDistinctPriCount >= DEVICE_FLOOD_MAX_PRIS,
        };
    }

    const StaffLifecycle = Object.freeze({
        RESET_COOLDOWN_MS,
        RESET_GUARD_STORAGE_KEY,
        DEVICE_FLOOD_WINDOW_MS,
        DEVICE_FLOOD_MAX_PRIS,
        MIN_TEMP_PIN_TTL_MINUTES,
        MAX_TEMP_PIN_TTL_MINUTES,
        TEMP_PIN_TTL_OPTIONS,
        TEMP_PIN_LENGTH,
        RESET_CODE_LENGTH,
        MIN_CODE_LENGTH,
        MAX_CODE_LENGTH,
        NOTE_MAX_LEN,
        RESOLUTION_NOTE_MAX_LEN,
        REASON_MIN_LEN,
        REASON_MAX_LEN,
        AUDIT_TYPES,
        NEUTRAL_RESET_MESSAGE,
        LOCAL_GUARD_BLOCKED_MESSAGE,
        normalizePri,
        isValidPriId,
        noTag,
        hasSequentialRun,
        isWeakCode,
        validateNewCode,
        secureRandomInt,
        generateSecureCode,
        canResubmitResetRequest,
        formatRemainingCooldown,
        readResetGuardState,
        checkLocalResetGuard,
        recordLocalResetAttempt,
        analyzeResetRequests,
        validateResetNote,
        validateResolutionNote,
        validateLifecycleReason,
        validateTempPinTtl,
        planResetRequest,
        planResetResolution,
        planSuspendToggle,
        planTempPinIssue,
        formatOfflineResetCommand,
        formatTtlLabel,
    });

    const host = typeof window !== 'undefined' ? window : globalThis;
    host.AppModules = host.AppModules || {};
    host.AppModules.StaffLifecycle = StaffLifecycle;
    host.StaffLifecycle = StaffLifecycle;
})();
