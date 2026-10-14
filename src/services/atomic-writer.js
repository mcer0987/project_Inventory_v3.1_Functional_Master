/**
 * services/atomic-writer.js — Günlüklü (journal) "hepsi ya da hiçbiri" toplu yazma motoru (Faz 5 denetimi · P0)
 * Klasik script; iki sayfada <head>'de schema.js'ten hemen sonra. firebase-handler.js Firestore bağdaştırıcısını kurar
 * (createFirestoreStore) ve restoreCollections / atomicInsertItems / recoverBulkWrite'ı bunun üstüne açar.
 *
 * [WHY]: Yedekten geri yükleme saveData'yı çağırıyordu; saveData 490'lık parçalar hâlinde AYRI batch'ler commit ediyor.
 *        1. parça yazılıp 2. parça hata verince Firestore'da yarım (yarısı yedek, yarısı eski) bir veritabanı kalıyor,
 *        restoreFromText yalnız istemci belleğini (window.data) geri alıyordu. Firestore istemci SDK'sında 500 işlemden
 *        büyük atomik yazma yok; tek batch'e sığmayan bir geri yükleme yerel olarak atomik yapılamaz.
 * [HOW]: Tek batch'e sığan iş (≤ LIMITS.maxOps ve ≤ LIMITS.maxBytes) doğrudan tek batch'tir (Firestore atomikliği).
 *        Sığmayan iş için kalıcı günlük + telafi edici geri alma:
 *          1. HAZIRLIK  — [başlık{state:'preparing'} + admin_settings.restoreLock] tek batch. Kilit, diğer istemcilerde
 *                         saveData/applyItemOps/runStockOps'u ilgili koleksiyonlar için durdurur (firebase-handler).
 *                         Ardından dokunulacak her dokümanın ÖNCEKİ hâli (yoksa null) günlük parçalarına yazılır.
 *          2. UYGULAMA  — her veri parçası, başlığın committedChunks sayacıyla AYNI batch'te commit edilir. Böylece sunucudaki
 *                         başlık, hangi parçaların yazıldığını her an kesin olarak bilir (ayrı bir "ilerleme" yazması yok).
 *          3. HATA      — k. parça başarısız → 0..k parçaları (k dahil: belirsiz sonuçlu commit'e karşı ihtiyatlı) önceki
 *                         hâllerine geri yazılır. Geri yazma idempotenttir (set(önceki) / delete), yeniden denenir.
 *          4. KAPANIŞ   — günlük parçaları + başlık silinir, kilit kaldırılır.
 *        Geri alma da yapılamazsa (ör. bağlantı tamamen koptu) günlük ve kilit SUNUCUDA kalır: veritabanı yazmaya kapalı
 *        kalır ve ilk yönetici oturumunda recover() geri almayı tamamlar (çökme/sekme kapanması dahil). Yani yarım yazım
 *        hiçbir zaman "kalıcı ve görünmez" olamaz: ya hiç başlamamıştır, ya tamamdır, ya da kilitli ve geri alınmayı bekler.
 *        Saf: Firestore'a doğrudan dokunmaz; yazma/okuma enjekte edilen `store` üzerinden → tests/unit/atomic-writer.test.mjs.
 *
 * store arayüzü:
 *   readCollection(col) → [{id, data}]      readDoc(col, id) → data | null
 *   commit([{kind:'set'|'merge'|'delete', col, id, data}])  — TEK atomik batch
 *   encode(value) / decode(json)            — günlüğe yazılacak önceki hâlin JSON kodlaması (Timestamp vb.)
 */
(function () {
    const SYS = 'system_config';
    const JOURNAL_ID = 'bulk_write_journal';
    const PART_PREFIX = 'bulk_write_journal_part_';
    const SETTINGS_ID = 'admin_settings';
    // Firestore: batch başına 500 yazma, istek başına 10 MiB, doküman başına 1 MiB. Pay bırakılır.
    const LIMITS = Object.freeze({ maxOps: 450, maxBytes: 8 * 1024 * 1024, partChars: 300 * 1024 });
    const STALE_MS = 2 * 60 * 1000;      // başlık bu kadar süredir güncellenmediyse sahibi ölmüş sayılır (recover)
    const ROLLBACK_RETRIES = 4;

    class AtomicWriteError extends Error {
        constructor(code, message, details) {
            super(message);
            this.name = 'AtomicWriteError';
            this.code = code;
            this.details = details || null;
        }
    }

    // ─── Saf yardımcılar ───────────────────────────────────────────────────────────────────────────────

    function stableStringify(value) {
        if (value === null || typeof value !== 'object') return JSON.stringify(value);
        if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
        return '{' + Object.keys(value)
            .filter(k => !k.startsWith('__') && value[k] !== undefined)
            .sort()
            .map(k => JSON.stringify(k) + ':' + stableStringify(value[k]))
            .join(',') + '}';
    }

    // UTF-8 bayt sayısı (TextEncoder'a bağlı kalmadan; vekil çiftler 4 bayt).
    function utf8Bytes(str) {
        let n = 0;
        for (let i = 0; i < str.length; i++) {
            const c = str.charCodeAt(i);
            if (c < 0x80) n += 1;
            else if (c < 0x800) n += 2;
            else if (c >= 0xD800 && c <= 0xDBFF) { n += 4; i++; }
            else n += 3;
        }
        return n;
    }
    const sizeOf = v => (v === null || v === undefined) ? 16 : utf8Bytes(JSON.stringify(v)) + 64;

    const docIdOf = id => String(id).replace(/\//g, '_');
    // '__' ile başlayan render alanları yazılmaz; undefined → "" (saveData/_clean ile aynı).
    const cleanItem = item => {
        const out = JSON.parse(JSON.stringify(item, (k, v) => v === undefined ? '' : v));
        Object.keys(out).forEach(k => { if (k.startsWith('__')) delete out[k]; });
        return out;
    };

    /**
     * Geri yükleme planı: hedef koleksiyon içerikleri ile sunucudaki GÜNCEL içerik karşılaştırılır.
     * Değişmeyen doküman yazılmaz; yalnız sunucuda olan silinir. Yazma TAM DEĞİŞTİRMEDİR (merge yok): geri yüklenen
     * doküman yedekteki hâliyle birebir aynı olur (sunucudaki fazla alan kalmaz).
     * @returns {{col, id, prev:object|null, next:object|null}[]}  next null → silme
     */
    function planRestore({ target, server, makeId }) {
        const entries = [];
        Object.keys(target).forEach(col => {
            const cur = new Map((server[col] || []).map(d => [String(d.id), d.data]));
            const keep = new Set();
            (target[col] || []).forEach(raw => {
                if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
                const item = cleanItem(raw);
                if (item.id == null || String(item.id).trim() === '') item.id = makeId();
                const id = docIdOf(item.id);
                if (keep.has(id)) throw new AtomicWriteError('duplicate-id', `"${col}" içinde ${id} id'li kayıt yedekte iki kez geçiyor.`, { col, id });
                keep.add(id);
                const prev = cur.has(id) ? cur.get(id) : null;
                // İki taraf aynı JSON normalizasyonundan geçer: sunucudaki Timestamp, yedekteki JSON karşılığına eşit sayılır
                // (değişmeyen doküman yeniden yazılıp türünü kaybetmez).
                if (prev && stableStringify(cleanItem(prev)) === stableStringify(item)) return;
                entries.push({ col, id, prev, next: item });
            });
            cur.forEach((prev, id) => { if (!keep.has(id)) entries.push({ col, id, prev, next: null }); });
        });
        return entries;
    }

    /**
     * Girdileri batch'lere böler. Sınır hem ileri (next) hem geri alma (prev) yazmasının büyüğüne göre hesaplanır;
     * böylece her parçanın telafi batch'i de aynı sınırlara sığar. `reserve`: her batch'e eklenecek günlük işlemi sayısı.
     * @returns {number[]} parça sonları (dışlayıcı indeks)
     */
    function chunkEnds(entries, { maxOps = LIMITS.maxOps, maxBytes = LIMITS.maxBytes, reserve = 1 } = {}) {
        const ends = [];
        let ops = 0, bytes = 0;
        entries.forEach((e, i) => {
            const b = Math.max(sizeOf(e.next), sizeOf(e.prev));
            if (ops > 0 && (ops + 1 + reserve > maxOps || bytes + b > maxBytes)) { ends.push(i); ops = 0; bytes = 0; }
            ops++; bytes += b;
        });
        if (ops > 0) ends.push(entries.length);
        return ends;
    }
    const chunkRange = (ends, k) => [k === 0 ? 0 : ends[k - 1], ends[k]];

    // Günlük metnini parça dokümanlarına böler; vekil çift ortadan bölünmez (Firestore geçersiz UTF-8 kabul etmez).
    function splitText(text, size = LIMITS.partChars) {
        const parts = [];
        for (let i = 0; i < text.length;) {
            let end = Math.min(i + size, text.length);
            const c = text.charCodeAt(end - 1);
            if (end < text.length && c >= 0xD800 && c <= 0xDBFF) end--;
            parts.push(text.slice(i, end));
            i = end;
        }
        return parts.length ? parts : [''];
    }

    const forwardOp = e => (e.next ? { kind: 'set', col: e.col, id: e.id, data: e.next } : { kind: 'delete', col: e.col, id: e.id });
    const undoOp = e => (e.prev ? { kind: 'set', col: e.col, id: e.id, data: e.prev } : { kind: 'delete', col: e.col, id: e.id });

    const defaultSleep = ms => new Promise(r => setTimeout(r, ms));
    const journalRef = data => ({ kind: 'merge', col: SYS, id: JOURNAL_ID, data });

    async function readCollections(store, cols) {
        const out = {};
        for (const col of cols) out[col] = await store.readCollection(col);
        return out;
    }

    async function withRetry(fn, { retries = ROLLBACK_RETRIES, sleep = defaultSleep } = {}) {
        let last;
        for (let a = 0; a <= retries; a++) {
            try { return await fn(); } catch (e) { last = e; if (a < retries) await sleep(250 * 2 ** a); }
        }
        throw last;
    }

    // Günlüğü ve kilidi kaldırır (parçalar önce, başlık + kilit en son ve birlikte).
    async function finalize(store, partCount, jobId, opts) {
        const partIds = Array.from({ length: partCount }, (_, k) => `${PART_PREFIX}${jobId}_${k}`);
        const per = (opts.limits && opts.limits.maxOps) || LIMITS.maxOps;
        for (let i = 0; i < partIds.length; i += per - 2) {
            const slice = partIds.slice(i, i + per - 2);
            await withRetry(() => store.commit(slice.map(id => ({ kind: 'delete', col: SYS, id }))), opts);
        }
        await withRetry(() => store.commit([
            { kind: 'delete', col: SYS, id: JOURNAL_ID },
            { kind: 'merge', col: SYS, id: SETTINGS_ID, data: { restoreLock: null } },
        ]), opts);
    }

    // 0..upto-1 parçalarını tersten önceki hâllerine döndürür (idempotent; her batch başlığı da tazeler).
    async function rollback(store, entries, ends, upto, opts) {
        const now = opts.now || Date.now;
        for (let k = upto - 1; k >= 0; k--) {
            const [s, e] = chunkRange(ends, k);
            const ops = entries.slice(s, e).map(undoOp);
            ops.push(journalRef({ state: 'rolling-back', updatedAt: now() }));
            await withRetry(() => store.commit(ops), opts);
        }
    }

    /**
     * Girdileri hepsi-ya-da-hiçbiri olarak yazar.
     * @param {object} o
     * @param {object} o.store
     * @param {Array|Function} o.entries   girdiler ya da (store) => Promise<girdiler> (sunucudan taze okuyarak plan)
     * @param {Function} [o.guard]        (entries) => Error|null — şema muhafızı; hata varsa HİÇBİR ŞEY yazılmaz
     * @param {string} o.kind             'restore' | 'import' (günlükte ve kullanıcı mesajında)
     * @param {string[]} o.collections    kilitlenecek koleksiyonlar
     * @returns {Promise<{status:'committed'|'noop', journaled:boolean, written:number, deleted:number, chunks:number}>}
     * Hata: AtomicWriteError — 'pending-journal' (önce recover), 'rolled-back' (yazılanlar geri alındı, veritabanı ilk
     *       hâlinde), 'rollback-pending' (geri alma tamamlanamadı; kilit + günlük sunucuda, recover tamamlayacak),
     *       'prepare-failed' (hiçbir veri yazılmadı), guard'ın kendi hatası.
     */
    async function run(o) {
        const { store, kind = 'bulk', collections = [], uid = null } = o;
        const now = o.now || Date.now;
        const opts = { sleep: o.sleep || defaultSleep, retries: o.retries ?? ROLLBACK_RETRIES, now, limits: o.limits || LIMITS };

        const pending = await store.readDoc(SYS, JOURNAL_ID);
        if (pending) {
            throw new AtomicWriteError('pending-journal',
                'Yarım kalmış bir toplu yazma günlüğü var; önce kurtarma (geri alma) tamamlanmalı.', { journal: pending });
        }

        const entries = typeof o.entries === 'function' ? await o.entries(store) : o.entries;
        const g = o.guard ? o.guard(entries) : null;
        if (g) throw g;

        const written = entries.filter(e => e.next).length;
        const deleted = entries.length - written;
        if (!entries.length) return { status: 'noop', journaled: false, written: 0, deleted: 0, chunks: 0 };

        const ends = chunkEnds(entries, { ...opts.limits, reserve: 1 });
        // Tek batch'e sığan iş: Firestore batch'i zaten atomik — günlük gerekmez.
        if (ends.length === 1) {
            await store.commit(entries.map(forwardOp));
            return { status: 'committed', journaled: false, written, deleted, chunks: 1 };
        }

        // ── 1. HAZIRLIK ──
        const jobId = String(now()) + Math.random().toString(36).slice(2, 8);
        let encoded;
        try {
            encoded = JSON.stringify(entries.map(e => ({ c: e.col, i: e.id, p: e.prev ? store.encode(e.prev) : null })));
        } catch (e) {
            throw new AtomicWriteError('prepare-failed', `Önceki hâller günlüğe kodlanamadı: ${e.message}`, { cause: e });
        }
        const parts = splitText(encoded, opts.limits.partChars || LIMITS.partChars);
        const header = {
            jobId, kind, uid, collections, state: 'preparing', startedAt: now(), updatedAt: now(),
            totalEntries: entries.length, chunkEnds: ends, committedChunks: 0, parts: parts.length,
        };
        try {
            await store.commit([
                { kind: 'set', col: SYS, id: JOURNAL_ID, data: header },
                { kind: 'merge', col: SYS, id: SETTINGS_ID, data: { restoreLock: { id: jobId, kind, uid, startedAt: header.startedAt, collections } } },
            ]);
        } catch (e) {
            throw new AtomicWriteError('prepare-failed', `Toplu yazma başlatılamadı; hiçbir kayıt yazılmadı. ${e.message || ''}`, { cause: e });
        }
        try {
            // Parça dokümanları (her biri ≤ ~900 KB) mümkün olduğunca az batch'te
            for (let k = 0; k < parts.length;) {
                const batch = [];
                let bytes = 0;
                while (k < parts.length && batch.length < 20 && (batch.length === 0 || bytes + utf8Bytes(parts[k]) < opts.limits.maxBytes)) {
                    bytes += utf8Bytes(parts[k]);
                    batch.push({ kind: 'set', col: SYS, id: `${PART_PREFIX}${jobId}_${k}`, data: { jobId, index: k, entries: parts[k] } });
                    k++;
                }
                await store.commit(batch);
            }
        } catch (e) {
            // Veri yazılmadı; günlük ve kilit kaldırılır (kaldırılamazsa recover 'preparing' durumunu temizler).
            try { await finalize(store, parts.length, jobId, opts); } catch (_) { /* recover temizler */ }
            throw new AtomicWriteError('prepare-failed', `Geri alma günlüğü yazılamadı; hiçbir kayıt yazılmadı. ${e.message || ''}`, { cause: e });
        }

        // ── 2. UYGULAMA ──
        for (let k = 0; k < ends.length; k++) {
            const [s, e] = chunkRange(ends, k);
            const ops = entries.slice(s, e).map(forwardOp);
            const last = k === ends.length - 1;
            ops.push(journalRef({ state: last ? 'committed' : 'applying', committedChunks: k + 1, updatedAt: now() }));
            try {
                await store.commit(ops);
            } catch (cause) {
                // ── 3. HATA → telafi. k. parça da geri alınır: commit sunucuda uygulanıp yanıtı kaybolmuş olabilir.
                try {
                    await rollback(store, entries, ends, k + 1, opts);
                } catch (rbErr) {
                    throw new AtomicWriteError('rollback-pending',
                        `${k + 1}/${ends.length}. parçada yazma başarısız oldu ve geri alma tamamlanamadı. Veritabanı kilitli; ` +
                        'yönetici oturumu açıldığında geri alma otomatik tamamlanacak.',
                        { cause, rollbackError: rbErr, chunk: k, chunks: ends.length, jobId });
                }
                // Veri geri alındı; kilit kaldırılamazsa günlük 'rolling-back' kalır ve recover (idempotent) yalnız tamamlar.
                let cleanupPending = false;
                try { await finalize(store, parts.length, jobId, opts); } catch (_) { cleanupPending = true; }
                throw new AtomicWriteError('rolled-back',
                    `${k + 1}/${ends.length}. parçada yazma başarısız oldu; yazılan parçalar geri alındı, veritabanı işlem öncesi hâlinde. ` +
                    `(${(cause && cause.message) || 'bilinmeyen hata'})`,
                    { cause, chunk: k, chunks: ends.length, jobId, cleanupPending });
            }
        }

        // ── 4. KAPANIŞ ── (veri tamam; kapanış başarısızsa recover 'committed' günlüğünü yalnız temizler)
        let cleanupPending = false;
        try { await finalize(store, parts.length, jobId, opts); } catch (_) { cleanupPending = true; }
        return { status: 'committed', journaled: true, written, deleted, chunks: ends.length, cleanupPending };
    }

    /**
     * Yarım kalmış işi kurtarır: 'committed' → yalnız günlük/kilit temizliği; diğer durumlar → yazılmış parçaları geri al.
     * Sahibi canlı olabilecek (son STALE_MS içinde güncellenmiş) günlüğe force olmadan dokunulmaz.
     * @returns {Promise<{status:'clean'|'busy'|'finalized'|'rolled-back', retryInMs?:number, journal?:object}>}
     */
    async function recover(o) {
        const { store, force = false } = o;
        const now = o.now || Date.now;
        const opts = { sleep: o.sleep || defaultSleep, retries: o.retries ?? ROLLBACK_RETRIES, now, limits: o.limits || LIMITS };
        const header = await store.readDoc(SYS, JOURNAL_ID);
        if (!header) {
            const settings = await store.readDoc(SYS, SETTINGS_ID);
            if (settings && settings.restoreLock) await store.commit([{ kind: 'merge', col: SYS, id: SETTINGS_ID, data: { restoreLock: null } }]);
            return { status: 'clean' };
        }
        const age = now() - Number(header.updatedAt || 0);
        if (!force && age < STALE_MS) return { status: 'busy', retryInMs: STALE_MS - age + 1000, journal: header };

        if (header.state === 'committed') {
            await finalize(store, header.parts, header.jobId, opts);
            return { status: 'finalized', journal: header };
        }
        const ends = header.chunkEnds || [];
        const upto = Math.min((header.committedChunks || 0) + 1, ends.length);
        if (header.state === 'preparing' || upto === 0) {
            await finalize(store, header.parts, header.jobId, opts);
            return { status: 'rolled-back', journal: header };
        }
        let text = '';
        for (let k = 0; k < header.parts; k++) {
            const part = await store.readDoc(SYS, `${PART_PREFIX}${header.jobId}_${k}`);
            if (!part || typeof part.entries !== 'string') {
                throw new AtomicWriteError('journal-corrupt', `Geri alma günlüğünün ${k}. parçası okunamadı; otomatik kurtarma durduruldu.`, { journal: header });
            }
            text += part.entries;
        }
        const entries = JSON.parse(text).map(x => ({ col: x.c, id: x.i, prev: x.p ? store.decode(x.p) : null }));
        if (entries.length !== header.totalEntries) {
            throw new AtomicWriteError('journal-corrupt', 'Geri alma günlüğü eksik; otomatik kurtarma durduruldu.', { journal: header });
        }
        await rollback(store, entries, ends, upto, opts);
        await finalize(store, header.parts, header.jobId, opts);
        return { status: 'rolled-back', journal: header };
    }

    // ─── Firestore bağdaştırıcısı ────────────────────────────────────────────────────────────────────
    // fns: { doc, collection, getDoc, getDocs, writeBatch, Timestamp } — tarayıcıda CDN modülü, testte npm 'firebase'.
    function createFirestoreStore({ db, root, fns }) {
        const ref = (col, id) => fns.doc(db, root, col, 'items', docIdOf(id));
        // Düz nesne: prototipi yok ya da (herhangi bir realm'in) Object.prototype'u
        const isPlain = v => { const p = Object.getPrototypeOf(v); return p === null || Object.getPrototypeOf(p) === null; };
        function encode(v) {
            if (v === null || typeof v !== 'object') return v;
            if (fns.Timestamp && v instanceof fns.Timestamp) return { __fsTs__: [v.seconds, v.nanoseconds] };
            if (Array.isArray(v)) return v.map(encode);
            if (!isPlain(v)) throw new Error(`günlüğe yazılamayan Firestore türü: ${(v.constructor && v.constructor.name) || typeof v}`);
            const out = {};
            Object.keys(v).forEach(k => { out[k] = encode(v[k]); });
            return out;
        }
        function decode(v) {
            if (v === null || typeof v !== 'object') return v;
            if (Array.isArray(v)) return v.map(decode);
            if (Array.isArray(v.__fsTs__) && Object.keys(v).length === 1) return new fns.Timestamp(v.__fsTs__[0], v.__fsTs__[1]);
            const out = {};
            Object.keys(v).forEach(k => { out[k] = decode(v[k]); });
            return out;
        }
        return {
            async readCollection(col) {
                const snap = await fns.getDocs(fns.collection(db, root, col, 'items'));
                return snap.docs.map(d => ({ id: d.id, data: d.data() }));
            },
            async readDoc(col, id) {
                const s = await fns.getDoc(ref(col, id));
                return s.exists() ? s.data() : null;
            },
            async commit(writes) {
                const batch = fns.writeBatch(db);
                writes.forEach(w => {
                    const r = ref(w.col, w.id);
                    if (w.kind === 'delete') batch.delete(r);
                    else if (w.kind === 'merge') batch.set(r, w.data, { merge: true });
                    else batch.set(r, w.data);
                });
                await batch.commit();
            },
            encode, decode,
        };
    }

    const AtomicWriter = {
        LIMITS, STALE_MS, JOURNAL_ID, PART_PREFIX, SETTINGS_ID, SYS, AtomicWriteError,
        stableStringify, planRestore, chunkEnds, splitText, readCollections, run, recover, createFirestoreStore,
    };
    window.AppModules = window.AppModules || {};
    window.AppModules.AtomicWriter = AtomicWriter;
    window.AtomicWriter = AtomicWriter;
})();
