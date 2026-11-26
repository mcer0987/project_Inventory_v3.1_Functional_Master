/**
 * services/stock-ledger.js — Stok + raf slotu defteri: transaction'lı iç transfer ve raf kapasitesi (v3.3 Denetim P1-01, P1-02)
 * Klasik script; iki sayfada <head>'de schema.js'ten sonra. firebase-handler.js Firestore bağımlılıklarını verir
 * (runStockTransferTransaction / saveShelfCapacity); emülatör testi aynı dosyayı npm 'firebase' fonksiyonlarıyla yükler.
 *
 * [WHY]: İç transfer (B1↔B2) kaynak adedini istemcideki window.data kopyasından hesaplayıp kör bir batch'le yazıyordu
 *        (applyItemOps): iki istemci aynı anda taşıyınca toplam stok korunmuyor, yanıtı kaybolan bir istek tekrar
 *        gönderildiğinde ikinci kez düşülüyordu (P1-01). Raf kapasitesi tarayıcıya özel localStorage'daydı ve yalnız istemcide
 *        denetleniyordu; son boş slota aynı anda iki yerleştirme kapasiteyi aşabiliyordu (P1-02).
 *        Proje Firebase Spark planındadır: Cloud Functions YOK — bütünlük istemci transaction'ı + firestore.rules ile kurulur.
 * [HOW]: Tek Firestore transaction'ı (runTransaction):
 *          1. OKUMA (hepsi yazmalardan önce): işlem kaydı stockOperations/{operationId} → varsa önceki sonuç döner, stoğa
 *             dokunulmaz (mükerrerlik koruması); kaynak ürün (TAZE adet); tam taşımada hedefte aynı id; kaynak ve hedef raf
 *             belgeleri shelves/{depot}_{KOD}.
 *          2. PLAN (saf, planTransfer): adet yeterliliği, hedef kayıt (yalnız kanonik alanlar, validateB1/B2), slot farkları
 *             (Schema.isSlotOccupying: pozitif + aktif kayıt 1 slot). Slot artan raf belgesi yoksa / pasifse / doluysa
 *             LedgerError → transaction hiç yazmadan biter (rollback). Slot azalan raf belgesi yoksa sayaç atlanır, sayaç
 *             0'ın altına inmez (geçiş dönemi kayması Aşama 6 uzlaştırmasında düzeltilir; doluluğu azaltan işlem engellenmez).
 *          3. YAZMA: ürün(ler), raf sayaçları ve değiştirilemez işlem kaydı AYNI commit'te. Eşzamanlı bir yazma okunan bir
 *             belgeyi değiştirirse Firestore transaction'ı yeniden dener (taze verilerle yeniden planlanır).
 *        Yeni kayıt kimliği (kısmi taşıma) transaction'dan ÖNCE bir kez üretilir: yeniden denemelerde değişmez.
 *        firestore.rules: raf belgesi şeması/kimliği, slot artışında usedSlots ≤ capacity, kapasitenin kullanım altına
 *        inmemesi ve işlem kaydının değiştirilemezliği sunucuda ayrıca denetlenir.
 *
 * [v3.3 · Aşama 4 EKİ]: Raf sayacı matematiği (planShelfCounterWrites) planTransfer'dan ayrı, paylaşılan bir fonksiyona
 * çıkarıldı; firebase-handler.js'nin runStockOps'u (FAB ±1, zimmet iadesi, servisten dönüş, çıkış, sepet, zimmet atama —
 * tüm b1/b2 stok delta yolları) ve bu dosyadaki runProductSave (saveProduct) AYNI fonksiyonu kullanır. runStockOps,
 * raf KATALOGDA YOKSA sayaç denetimini GEÇİŞ DÖNEMİ olarak atlar (requireCatalog:false) — WMS'ten kapasitesi
 * tanımlanmamış ~75 eski rafın günlük kullanımını (yeni ürün, FAB +1 vb.) ENGELLEMEZ; yalnız KATALOGDA OLAN raflarda
 * kapasite/aktiflik kuralı uygulanır. planTransfer ve runProductSave (WMS'ten veya form'dan BİLİNÇLİ raf seçimi)
 * varsayılan (requireCatalog:true) katı moduyla çalışmaya devam eder.
 */
(function () {
    'use strict';

    const STOCK_COLS = Object.freeze(['b1', 'b2']);
    const SHELF_COL = 'shelves';
    const OP_COL = 'stockOperations';
    const OP_ID_RE = /^[A-Za-z0-9_-]{8,80}$/;
    // Planlayıcının çıktısında sunucu zamanı yer tutucusu; yürütücü fns.serverTimestamp() ile değiştirir (saf kalır).
    const SERVER_TIME = Object.freeze({ __ledgerServerTime__: true });
    // Alan silme yer tutucusu (v3.6 · raf sayım kilidinin kaldırılması); yürütücü fns.deleteField() ile değiştirir.
    const DELETE_FIELD = Object.freeze({ __ledgerDeleteField__: true });
    const AUDIT_COL = 'auditLogs';
    const ROW_CHUNK = 450;

    class LedgerError extends Error {
        constructor(code, message, details) {
            super(message);
            this.name = 'LedgerError';
            this.code = code;
            this.details = details || null;
        }
    }

    function schema() {
        const S = window.Schema;
        if (!S || typeof S.isSlotOccupying !== 'function' || typeof S.shelfDocId !== 'function') {
            throw new LedgerError('schema-missing', 'Şema modülü (schema.js) yüklenmemiş; stok defteri çalıştırılamıyor.');
        }
        return S;
    }

    // Tekrar denemelerde aynı kalacak işlem kimliği (çağıran bir kez üretir, yeniden gönderimde aynısını kullanır).
    function newOperationId() {
        const c = globalThis.crypto;
        if (c && typeof c.randomUUID === 'function') return 'op_' + c.randomUUID().replace(/-/g, '');
        return 'op_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 12);
    }

    const qtyOf = d => parseInt(d && (d.adet ?? d.qty ?? 0), 10) || 0;

    // Geçersiz raf kodlu (ör. "/" içeren eski) kayıtların raf belgesi olamaz → sayaç yok (null).
    function shelfIdOf(depot, code) {
        try { return schema().shelfDocId(depot, code); } catch (e) { return null; }
    }

    // ─── v3.6 · Raf sayım kilidi ─────────────────────────────────────────────────────────────────────────────────────
    // [WHY]: Sayım sırasında raftaki ürün hareket ederse sayım sonucu anlamını yitirir. Kilidin tek doğruluk kaynağı raf
    //        belgesidir (lockReason / lockedAt / lockedBy); kayıttaki rafPasif yalnız gizleme ve personel kuralı için kopyadır.
    // [HOW]: Her stok hareketi transaction içinde raf belgesini ve kaydı okur; İKİSİNDEN BİRİ kilit diyorsa reddeder
    //        (fail-closed: bayrak ile raf çelişirse yine ret; WMS uzlaştırması düzeltir). Aynı raf içindeki adet düzeltmesi
    //        (sayımın kendisi) ürün kaydı yolundan yapılır ve serbesttir.
    function countLockedError(what, label, shelfDoc) {
        const reason = shelfDoc && typeof shelfDoc.lockReason === 'string' ? ` (${shelfDoc.lockReason})` : '';
        return new LedgerError('shelf-locked', `“${label}” rafı sayımda${reason}; ${what}`, { shelf: label });
    }
    function assertNotCountLocked(row, shelfDoc, what = 'sayım bitene kadar bu üründe stok hareketi yapılamaz.') {
        const S = schema();
        if (S.isShelfCountLocked(shelfDoc) || S.isRowCountLocked(row)) {
            throw countLockedError(what, (shelfDoc && shelfDoc.code) || S.itemShelfCode(row), shelfDoc);
        }
    }
    function cleanLockReason(v) {
        return String(v ?? '').replace(/</g, '‹').replace(/\s+/g, ' ').trim();
    }
    // Yeni bir planlayıcı denetim kaydı istiyorsa yürütücü bağımlılığı zorunludur (Global-Architecture Sütun 3).
    function requireAudit(deps) {
        if (!deps || typeof deps.auditRecord !== 'function') {
            throw new LedgerError('audit-missing', 'Denetim kaydı yazıcısı yüklenmemiş; işlem yapılmadı.');
        }
    }

    /** Giriş doğrulaması; temizlenmiş giriş döner. */
    function checkTransferInput(input) {
        const S = schema();
        const i = input || {};
        if (!OP_ID_RE.test(String(i.operationId || ''))) throw new LedgerError('invalid-argument', 'Geçersiz işlem kimliği (operationId).');
        if (!STOCK_COLS.includes(i.sourceCol) || !STOCK_COLS.includes(i.targetCol)) throw new LedgerError('invalid-argument', 'Transfer yalnız b1/b2 arasında yapılır.');
        if (i.sourceId === undefined || i.sourceId === null || String(i.sourceId).trim() === '') throw new LedgerError('invalid-argument', 'Kaynak ürün kimliği yok.');
        if (!Number.isInteger(i.qty) || i.qty < 1) throw new LedgerError('invalid-argument', 'Taşınacak adet en az 1 olan tam sayı olmalıdır.');
        const targetCode = S.normShelfCode(i.targetShelf);
        if (!S.isValidShelfCode(targetCode)) throw new LedgerError('invalid-argument', `Geçersiz hedef raf: "${i.targetShelf ?? ''}"`);
        return {
            operationId: String(i.operationId),
            sourceCol: i.sourceCol,
            sourceId: String(i.sourceId),
            targetCol: i.targetCol,
            qty: i.qty,
            targetShelf: String(i.targetShelf).trim(),          // üründe görünen yazım korunur (Aşama 4'e kadar ham)
            targetCode,
            targetShelfId: S.shelfDocId(i.targetCol, targetCode),
            targetColumn: i.targetColumn == null ? '' : String(i.targetColumn),
            note: i.note == null ? '' : String(i.note).trim(),
            newTargetId: i.newTargetId == null ? null : String(i.newTargetId),
            uid: i.uid == null ? null : String(i.uid),
            now: Number.isFinite(i.now) ? i.now : Date.now(),
        };
    }

    // İşlem kaydındaki parametreler aynı mı? (Aynı operationId ile farklı bir istek → önceki işlem değil, çakışma.)
    function sameRequest(op, inp) {
        return op.sourceCol === inp.sourceCol && String(op.sourceId) === inp.sourceId && op.targetCol === inp.targetCol
            && op.qty === inp.qty && op.targetShelfId === inp.targetShelfId;
    }

    // İşlem kaydının dışarıya dönen hâli (uid/ts gibi iç alanlar hariç).
    function publicResult(op) {
        return {
            operationId: op.id, kind: op.kind, sourceCol: op.sourceCol, sourceId: op.sourceId, targetCol: op.targetCol,
            targetId: op.targetId, targetShelfId: op.targetShelfId, qty: op.qty, fullMove: op.fullMove,
            stockBefore: op.stockBefore, stockAfter: op.stockAfter,
            shelves: Array.isArray(op.shelves) ? op.shelves.map(s => ({ id: s.id, before: s.before, after: s.after })) : [],
        };
    }

    /**
     * Transaction içinde okunması gereken raf belgeleri (kaynak ürün okunduktan sonra bilinir).
     * @returns {string[]} benzersiz shelfId listesi
     */
    function transferShelfIds(input, source) {
        const S = schema();
        const ids = [input.targetShelfId];
        const src = shelfIdOf(input.sourceCol, S.itemShelfCode(source));
        if (src && !ids.includes(src)) ids.push(src);
        return ids;
    }

    /**
     * PAYLAŞILAN raf sayacı matematiği. deltas: Map<shelfId, ±N işgal farkı> (aynı shelfId'de artış+azalış birbirini
     * götürür — ör. aynı rafta kalan bir kaydın durum değişimi olmazsa delta 0 olur ve hiç dokunulmaz). shelfReads:
     * {shelfId: belge|null} (transaction içinde ÖNCEDEN okunmuş). opts.requireCatalog (varsayılan true):
     *   - true  (planTransfer, runProductSave — admin BİLİNÇLİ bir raf seçiyor): slot ARTIŞI için katalogda kayıt
     *     YOKSA 'shelf-missing' fırlatır (hiçbir şey yazılmaz). Katalogdaki rafta kapasite/aktiflik her zaman uygulanır.
     *   - false (runStockOps — FAB ±1, zimmet iadesi, servisten dönüş, çıkış/sepet/zimmet gibi raf SEÇİLMEYEN, yalnız
     *     ADET değişen akışlar): katalogda kaydı OLMAYAN raf için sayaç sessizce ATLANIR (ne yazma ne hata) — WMS'ten
     *     henüz kapasitesi tanımlanmamış mevcut rafların günlük kullanımını engellemez (geçiş dönemi, Aşama 6'da
     *     uzlaştırılır). Katalogda KAYITLI bir raf varsa kapasite/aktiflik yine de uygulanır (requireCatalog'dan
     *     bağımsız — bir raf bir kez katalogda ise kuralı HER yoldan geçerlidir).
     * Slot AZALIŞI her zaman serbesttir (doluluğu azaltan işlem hiçbir modda engellenmez); katalogda kaydı yoksa
     * düşülecek sayaç olmadığı için atlanır. Sayaç asla 0'ın altına inmez.
     * @returns {{shelves:{id,before,after}[], writes:object[]}}
     */
    function planShelfCounterWrites(deltas, shelfReads, uid, opts = {}) {
        const requireCatalog = opts.requireCatalog !== false;
        // v3.6: yalnız sayım kilidindeki AYNI raf içinde adet düzeltmesi (0→N) için çağıranın açıkça verdiği raflar.
        const allowInactive = new Set(opts.allowInactive || []);
        const shelves = [];
        const writes = [];
        const reads = shelfReads || {};
        for (const [sid, d] of deltas) {
            if (!sid || d === 0) continue;
            const doc = reads[sid] || null;
            if (d > 0) {
                if (!doc) {
                    if (requireCatalog) {
                        const label = sid.slice(sid.indexOf('_') + 1);
                        throw new LedgerError('shelf-missing', `“${label}” rafı raf kataloğunda tanımlı değil. Önce WMS'ten raf kapasitesini kaydedin.`, { shelfId: sid });
                    }
                    continue;   // geçiş dönemi: katalogda olmayan rafta sayaç tutulmaz, işlem engellenmez
                }
                if (doc.active !== true && !allowInactive.has(sid)) throw new LedgerError('shelf-inactive', `“${doc.code}” rafı yeni yerleştirmeye kapalı (pasif).`, { shelfId: sid });
                const used = Number.isInteger(doc.usedSlots) ? doc.usedSlots : 0;
                if (used + d > doc.capacity) {
                    throw new LedgerError('shelf-full', `“${doc.code}” rafı dolu (${used}/${doc.capacity} slot). Müsait bir raf seçin veya kapasiteyi artırın.`, { shelfId: sid, used, capacity: doc.capacity });
                }
                shelves.push({ id: sid, before: used, after: used + d });
            } else {
                if (!doc) continue;   // katalogda olmayan kaynak raf: düşülecek sayaç yok (geçiş dönemi)
                const used = Number.isInteger(doc.usedSlots) ? doc.usedSlots : 0;
                shelves.push({ id: sid, before: used, after: Math.max(0, used + d) });
            }
        }
        shelves.forEach(s => writes.push({
            kind: 'update', col: SHELF_COL, id: s.id,
            data: { usedSlots: s.after, updatedAt: SERVER_TIME, updatedBy: uid },
        }));
        return { shelves, writes };
    }

    /**
     * SAF planlayıcı. reads: { op, source, targetSameId, shelves: {shelfId: data|null} } (transaction'da taze okunmuş).
     * Dönüş: { duplicate:true, result } | { duplicate:false, result, writes:[{kind:'set'|'update'|'delete', col, id, data}] }.
     * Hata: LedgerError (not-found | insufficient-stock | conflict | operation-conflict | schema-violation |
     *        shelf-missing | shelf-inactive | shelf-full | invalid-argument).
     */
    function planTransfer(rawInput, reads) {
        const S = schema();
        const inp = checkTransferInput(rawInput);
        const r = reads || {};
        if (r.op) {
            if (!sameRequest(r.op, inp)) {
                throw new LedgerError('operation-conflict', 'Bu işlem kimliğiyle farklı bir transfer zaten tamamlanmış. Liste güncellenmiş olabilir; pencereyi kapatıp yeniden açın.', { operationId: inp.operationId });
            }
            return { duplicate: true, result: publicResult(r.op) };
        }
        const source = r.source;
        if (!source) throw new LedgerError('not-found', 'Kaynak ürün bulunamadı; başka biri taşımış ya da silmiş olabilir.', { col: inp.sourceCol, id: inp.sourceId });
        const fresh = qtyOf(source);
        if (inp.qty > fresh) {
            throw new LedgerError('insufficient-stock', `Yetersiz stok: güncel stok ${fresh}, taşınmak istenen ${inp.qty}.`, { before: fresh, requested: inp.qty });
        }
        const fullMove = inp.qty === fresh;
        if (!fullMove && S.normDeviceId(source.envanterNo)) {
            throw new LedgerError('invalid-argument', 'Envanter No bulunan ürün kısmi taşınamaz; Envanter No tek bir kaydı tanımlar.');
        }
        const sameCol = inp.sourceCol === inp.targetCol;
        const sourceShelfId = shelfIdOf(inp.sourceCol, S.itemShelfCode(source));
        if (sameCol && sourceShelfId === inp.targetShelfId) {
            throw new LedgerError('invalid-argument', 'Ürün zaten bu rafta.');
        }
        // v3.6: sayımdaki raftan çıkış da, sayımdaki rafa giriş de yok.
        const shelfReads = r.shelves || {};
        assertNotCountLocked(source, sourceShelfId ? shelfReads[sourceShelfId] : null, 'sayım bitene kadar bu raftan ürün taşınamaz.');
        const targetShelfDoc = shelfReads[inp.targetShelfId] || null;
        if (S.isShelfCountLocked(targetShelfDoc)) {
            throw countLockedError('sayım bitene kadar bu rafa ürün taşınamaz.', targetShelfDoc.code, targetShelfDoc);
        }
        if (!fullMove && !inp.newTargetId) throw new LedgerError('invalid-argument', 'Kısmi taşıma için yeni kayıt kimliği gerekli.');

        const status = String(source.durumu ?? source.status ?? '');
        const writes = [];
        let targetId, targetDoc = null, sourceAfter;

        if (fullMove && sameCol) {
            // Aynı depoda tam taşıma = konum değişikliği (kimlik ve diğer alanlar korunur).
            targetId = inp.sourceId;
            const patch = { raf: inp.targetShelf, sütun: inp.targetColumn, lastUpdate: inp.now };
            sourceAfter = { ...source, ...patch };
            writes.push({ kind: 'update', col: inp.sourceCol, id: inp.sourceId, data: patch });
        } else {
            targetId = fullMove ? inp.sourceId : inp.newTargetId;
            if (fullMove && r.targetSameId) {
                throw new LedgerError('conflict', `Hedef depoda aynı kimlikli bir kayıt var (${inp.targetCol}/${targetId}); üzerine yazılmadı.`);
            }
            targetDoc = {
                id: targetId,
                sütun: inp.targetColumn,
                raf: inp.targetShelf,
                tür: source.tür || source.type || '',
                ürün: source.ürün || source.name || '',
                marka: source.marka || '',
                adet: inp.qty,
                durumu: status,
                açıklama: inp.note || source.açıklama || '',
                isDemirbas: S.isDemirbas(source),
                lastUpdate: inp.now,
            };
            if (source.envanterNo) targetDoc.envanterNo = source.envanterNo;
            if (fullMove && source.sn) targetDoc.sn = source.sn;
            if (inp.targetCol === 'b2') targetDoc.status = status;
            const errors = (inp.targetCol === 'b1' ? S.validateB1 : S.validateB2)(targetDoc);
            if (errors.length) throw new LedgerError('schema-violation', `Hedef kayıt şema sözleşmesine uymuyor: ${errors.join(', ')}`, { errors });
            writes.push({ kind: 'set', col: inp.targetCol, id: targetId, data: targetDoc });
            if (fullMove) {
                sourceAfter = null;
                writes.push({ kind: 'delete', col: inp.sourceCol, id: inp.sourceId });
            } else {
                const patch = { adet: fresh - inp.qty, lastUpdate: inp.now };
                sourceAfter = { ...source, ...patch };
                writes.push({ kind: 'update', col: inp.sourceCol, id: inp.sourceId, data: patch });
            }
        }

        // Slot farkları: kaynak kaydın önceki/sonraki işgali + yeni hedef kaydın işgali (adet slotu artırmaz).
        const deltas = new Map();
        const add = (sid, d) => { if (sid) deltas.set(sid, (deltas.get(sid) || 0) + d); };
        if (S.isSlotOccupying(source)) add(sourceShelfId, -1);
        if (sourceAfter && S.isSlotOccupying(sourceAfter)) add(shelfIdOf(inp.sourceCol, S.itemShelfCode(sourceAfter)), +1);
        if (targetDoc && S.isSlotOccupying(targetDoc)) add(inp.targetShelfId, +1);
        // Transfer admin'in BİLİNÇLİ seçtiği bir hedef raftır → katı mod (requireCatalog varsayılanı true).
        const { shelves, writes: shelfWrites } = planShelfCounterWrites(deltas, r.shelves || {}, inp.uid);
        shelfWrites.forEach(w => writes.push(w));

        const op = {
            id: inp.operationId, kind: 'transfer',
            sourceCol: inp.sourceCol, sourceId: inp.sourceId, targetCol: inp.targetCol, targetId,
            targetShelfId: inp.targetShelfId, qty: inp.qty, fullMove,
            stockBefore: fresh, stockAfter: fresh - inp.qty,
            shelves,
            uid: inp.uid, ts: SERVER_TIME,
        };
        writes.push({ kind: 'set', col: OP_COL, id: inp.operationId, data: op });
        return { duplicate: false, result: publicResult(op), writes };
    }

    /**
     * SAF raf kaydetme planı (oluşturma ya da kapasite/aktiflik güncellemesi). existing: mevcut belge | null.
     * Yeni belgede usedSlots çağıranın sunucudan saydığı değerdir (usedSlotsIfNew). Kapasite kullanımın altına inemez.
     */
    function planShelfSave(input, existing) {
        const S = schema();
        const i = input || {};
        if (!S.SHELF_DEPOTS.includes(i.depot)) throw new LedgerError('invalid-argument', `Geçersiz depo: ${i.depot}`);
        const code = S.normShelfCode(i.code);
        if (!S.isValidShelfCode(code)) throw new LedgerError('invalid-argument', `Geçersiz raf kodu: "${i.code ?? ''}" (harf, rakam, boşluk, . - _; en fazla ${S.SHELF_CODE_MAX_LENGTH} karakter).`);
        const capacity = i.capacity;
        if (!Number.isInteger(capacity) || capacity < S.SHELF_MIN_CAPACITY || capacity > S.SHELF_MAX_CAPACITY) {
            throw new LedgerError('invalid-argument', `Raf kapasitesi ${S.SHELF_MIN_CAPACITY} ile ${S.SHELF_MAX_CAPACITY} arasında bir tam sayı olmalıdır.`);
        }
        const id = S.shelfDocId(i.depot, code);
        if (existing) {
            const used = Number.isInteger(existing.usedSlots) ? existing.usedSlots : 0;
            if (capacity < used) throw new LedgerError('capacity-below-usage', `Kapasite mevcut kullanımın (${used} slot) altına indirilemez.`, { used });
            const data = { capacity, updatedAt: SERVER_TIME, updatedBy: i.uid };
            if (typeof i.active === 'boolean') data.active = i.active;
            return { kind: 'update', id, data, result: { id, code, depot: i.depot, capacity, usedSlots: used, active: data.active ?? existing.active, created: false } };
        }
        if (!Number.isInteger(i.usedSlotsIfNew) || i.usedSlotsIfNew < 0) throw new LedgerError('invalid-argument', 'Yeni raf için güncel slot kullanımı hesaplanamadı.');
        if (capacity < i.usedSlotsIfNew) {
            throw new LedgerError('capacity-below-usage', `Bu rafta şu an ${i.usedSlotsIfNew} ürün kaydı var; kapasite bunun altında olamaz.`, { used: i.usedSlotsIfNew });
        }
        const data = S.buildShelfDoc({ depot: i.depot, code, capacity, usedSlots: i.usedSlotsIfNew, active: i.active ?? true, updatedAt: SERVER_TIME, updatedBy: i.uid });
        return { kind: 'set', id, data, result: { id, code, depot: i.depot, capacity, usedSlots: data.usedSlots, active: data.active, created: true } };
    }

    /**
     * SAF planlayıcı — bir b1/b2 kaydının oluşturulması/düzenlenmesi (v3.3 Aşama 4 · saveProduct). input:
     * { col, id, isNew, fields, uid }. reads: { existing: belge|null, shelves: {shelfId: belge|null} } (transaction'da
     * TAZE okunmuş — düzenlemede window.data'nın bayat kopyası değil, P1-01'deki aynı taze-okuma ilkesi).
     * Yeni kayıt: fields'ten TAM kanonik belge kurulur, validateB1/B2 tam sözleşmeden geçirilir (appendItem ile aynı).
     * Düzenleme: yalnız fields yazılır (diğer alanlar ve eşzamanlı değişiklikler korunur, updateItem ile aynı); fields'in
     * alan adları _stockViolation ile AYNI kuralla denetlenir (bilinen kanonik/isteğe bağlı alan, eski alan değil).
     * Raf sayacı: requireCatalog:false — ürün formu/FAB gibi raf'ın İSTEMLİ değil İNCELİKLİ (formda seçilen, çoğu zaman
     * eski/katalog dışı) bir sonucu olduğu yollarda katalog dışı raf ENGELLEMEZ (bkz. dosya başı [v3.3 Aşama 4 EKİ]).
     * Hata: LedgerError (invalid-argument | not-found | conflict | schema-violation | shelf-inactive | shelf-full).
     */
    function planProductSave(input, reads) {
        const S = schema();
        const i = input || {};
        if (!STOCK_COLS.includes(i.col)) throw new LedgerError('invalid-argument', `Geçersiz koleksiyon: ${i.col}`);
        if (i.id == null || String(i.id).trim() === '') throw new LedgerError('invalid-argument', 'Kayıt kimliği gerekli.');
        const fields = (i.fields && typeof i.fields === 'object') ? i.fields : {};
        const r = reads || {};
        const existing = r.existing || null;
        const validate = i.col === 'b1' ? S.validateB1 : S.validateB2;

        const shelfReads = r.shelves || {};
        const shelfOf = doc => { const sid = shelfIdOf(i.col, S.itemShelfCode(doc)); return { sid, doc: sid ? shelfReads[sid] || null : null }; };

        if (i.isNew) {
            if (existing) throw new LedgerError('conflict', `"${i.col}" içinde ${i.id} id'li kayıt zaten var.`, { col: i.col, id: i.id });
            const nextDoc = { id: i.id, ...fields };
            delete nextDoc.rafPasif;   // v3.6: sayım bayrağını yalnız raf kilidi yazar
            const errors = validate(nextDoc);
            if (errors.length) throw new LedgerError('schema-violation', `Yeni kayıt şema sözleşmesine uymuyor: ${errors.join(', ')}`, { errors });
            const target = shelfOf(nextDoc);
            if (S.isShelfCountLocked(target.doc)) {
                throw countLockedError('sayımdaki rafa yeni ürün eklenemez; sayım bitince ekleyin.', target.doc.code, target.doc);
            }
            const deltas = new Map();
            if (S.isSlotOccupying(nextDoc) && target.sid) deltas.set(target.sid, 1);
            const { shelves, writes: shelfWrites } = planShelfCounterWrites(deltas, shelfReads, i.uid, { requireCatalog: false });
            return { result: { col: i.col, id: i.id, created: true, shelves }, writes: [{ kind: 'set', col: i.col, id: i.id, data: nextDoc }, ...shelfWrites] };
        }

        if (!existing) throw new LedgerError('not-found', `Düzenlenen kayıt bulunamadı (${i.col}/${i.id}); liste güncellenmiş olabilir.`, { col: i.col, id: i.id });
        const writeFields = { ...fields };
        delete writeFields.rafPasif;   // v3.6: bayrak aşağıda rafın gerçek durumundan yazılır
        delete writeFields.sonEnvanterNoDegisimId;   // v3.6: yalnız Envanter No değişim aracı yazar
        // v3.6 · Envanter No kilidi: dolu numara ürün kaydından değişmez (boş numara bir kez atanabilir). Aynı numaranın yazım
        // farkı (boşluk/büyük-küçük) değişiklik sayılmaz ve yazılmaz. Kurallar da aynı kilidi uygular (firestore.rules).
        if (Object.prototype.hasOwnProperty.call(writeFields, 'envanterNo') && S.normDeviceId(existing.envanterNo)) {
            if (S.normDeviceId(writeFields.envanterNo) !== S.normDeviceId(existing.envanterNo)) {
                throw new LedgerError('envanter-no-locked', 'Envanter No ürün kaydından değiştirilemez; değişim Yönetim Paneli › Operasyon Merkezi › Envanter No Değişimi aracından yapılır.', { col: i.col, id: i.id });
            }
            delete writeFields.envanterNo;
        }
        const nextDoc = { ...existing, ...writeFields };
        const prev = shelfOf(existing);
        const next = shelfOf(nextDoc);
        const moving = S.itemShelfCode(existing) !== S.itemShelfCode(nextDoc);
        if (moving) {
            assertNotCountLocked(existing, prev.doc, 'sayım bitene kadar bu raftan ürün taşınamaz.');
            if (S.isShelfCountLocked(next.doc)) throw countLockedError('sayım bitene kadar bu rafa ürün taşınamaz.', next.doc.code, next.doc);
        }
        const nextLocked = S.isShelfCountLocked(next.doc);
        if ((existing.rafPasif === true) !== nextLocked) writeFields.rafPasif = nextLocked;
        // applyItemOps'un 'update' dalıyla (_stockViolation) AYNI kapalı sözleşme: alan adı VE tip; yalnız eksik zorunlu alan muaf.
        const fieldErrors = validate(writeFields, { partial: true });
        if (fieldErrors.length) throw new LedgerError('schema-violation', fieldErrors.join(', '), { errors: fieldErrors });
        const deltas = new Map();
        const add = (sid, d) => { if (sid) deltas.set(sid, (deltas.get(sid) || 0) + d); };
        if (S.isSlotOccupying(existing)) add(prev.sid, -1);
        if (S.isSlotOccupying(nextDoc)) add(next.sid, +1);
        // Sayım düzeltmesi: kilitli AYNI rafta 0→N geçişi (raf active:false) yalnız bu rafa izin verilir; kapasite yine uygulanır.
        const allowInactive = !moving && nextLocked ? [next.sid] : [];
        const { shelves, writes: shelfWrites } = planShelfCounterWrites(deltas, shelfReads, i.uid, { requireCatalog: false, allowInactive });
        return {
            result: { col: i.col, id: i.id, created: false, shelves, qtyBefore: qtyOf(existing), qtyAfter: qtyOf(nextDoc) },
            writes: [{ kind: 'update', col: i.col, id: i.id, data: writeFields }, ...shelfWrites],
        };
    }

    // ─── v3.6 · Raf yönetimi planlayıcıları (saf) ────────────────────────────────────────────────────────────────────
    function shelfTarget(input) {
        const S = schema();
        const i = input || {};
        if (!S.SHELF_DEPOTS.includes(i.depot)) throw new LedgerError('invalid-argument', `Geçersiz depo: ${i.depot}`);
        const code = S.normShelfCode(i.code);
        if (!S.isValidShelfCode(code)) {
            throw new LedgerError('invalid-argument', `Geçersiz raf kodu: "${i.code ?? ''}" (harf, rakam, boşluk, . - _; en fazla ${S.SHELF_CODE_MAX_LENGTH} karakter).`);
        }
        return { depot: i.depot, code, id: S.shelfDocId(i.depot, code) };
    }
    // Rafa bağlı TAZE kayıtlar ([{id, data}]) içinden yalnız gerçekten bu kanonik koda bağlı olanlar (savunma amaçlı süzme).
    function rowsFor(code, rows) {
        const S = schema();
        return (rows || []).filter(r => r && r.data && S.itemShelfCode(r.data) === code);
    }
    // Satır bayrağı yazmaları: kilitte bayrağı olmayan her kayda true; kilit kalkınca yalnız true olanlara false.
    function planLockRowWrites(depot, code, rows, locked) {
        const S = schema();
        const validate = depot === 'b1' ? S.validateB1 : S.validateB2;
        return rowsFor(code, rows).filter(r => (locked ? r.data.rafPasif !== true : r.data.rafPasif === true)).map(r => {
            const data = { rafPasif: locked };
            const errors = validate(data, { partial: true });
            if (errors.length) throw new LedgerError('schema-violation', errors.join(', '), { errors });
            return { kind: 'update', col: depot, id: String(r.id), data };
        });
    }

    /**
     * SAF — raf sayım kilidi. input: { depot, code, locked, reason, uid }; shelfDoc: TAZE raf belgesi; rows: rafa bağlı TAZE
     * kayıtlar. Raf zaten istenen durumdaysa raf yazılmaz ve denetim kaydı oluşmaz; yalnız satır bayrakları uzlaştırılır
     * (yeniden deneme güvenli). Dönüş: { shelfWrite|null, rowWrites, audit|null, result }.
     */
    function planShelfLock(input, shelfDoc, rows) {
        const S = schema();
        const t = shelfTarget(input);
        if (!shelfDoc) throw new LedgerError('shelf-missing', `“${t.code}” rafı raf kataloğunda yok; önce rafı ekleyin.`, { shelfId: t.id });
        const locked = input.locked === true;
        const already = S.isShelfCountLocked(shelfDoc);
        let shelfWrite = null;
        let audit = null;
        if (locked && !already) {
            const reason = cleanLockReason(input.reason);
            if (!reason) throw new LedgerError('invalid-argument', 'Sayım gerekçesini yazın (ör. "Yıl sonu sayımı").');
            if (reason.length > S.SHELF_LOCK_REASON_MAX) throw new LedgerError('invalid-argument', `Sayım gerekçesi en fazla ${S.SHELF_LOCK_REASON_MAX} karakter olabilir.`);
            shelfWrite = { kind: 'update', col: SHELF_COL, id: t.id, data: {
                active: false, lockReason: reason, lockedAt: SERVER_TIME, lockedBy: input.uid, updatedAt: SERVER_TIME, updatedBy: input.uid,
            } };
            audit = { type: 'raf-sayima-alindi', refCol: SHELF_COL, refId: t.id, item: t.code, reason };
        } else if (!locked && already) {
            shelfWrite = { kind: 'update', col: SHELF_COL, id: t.id, data: {
                active: true, lockReason: DELETE_FIELD, lockedAt: DELETE_FIELD, lockedBy: DELETE_FIELD, updatedAt: SERVER_TIME, updatedBy: input.uid,
            } };
            audit = { type: 'raf-sayim-bitti', refCol: SHELF_COL, refId: t.id, item: t.code, reason: shelfDoc.lockReason };
        }
        const onShelf = rowsFor(t.code, rows);
        if (audit) audit.qty = onShelf.length;
        const rowWrites = planLockRowWrites(t.depot, t.code, onShelf, locked);
        return { shelfWrite, rowWrites, audit, result: { id: t.id, code: t.code, depot: t.depot, locked, changed: !!shelfWrite, rows: onShelf.length } };
    }

    /**
     * SAF — rafı kaldırma. Fiziksel stoğu (adet > 0, durumu ne olursa olsun) olan raf kaldırılamaz; sayımdaki raf kaldırılamaz.
     * Rafa bağlı adet 0 kayıtların raf alanı boşaltılır (Havuz). Raf kodu 'raf' dışındaki eski bir alandan geliyorsa kayıt
     * şema gereği değiştirilemeyeceği için kaldırma reddedilir. Sayaç kaymışsa (usedSlots > 0) yürütücü önce ayrı commit'te
     * sıfırlar (kural silmeyi yazma öncesi değere göre değerlendirir). Dönüş: { rowWrites, counterFix, audit, result }.
     */
    function planShelfDelete(input, shelfDoc, rows) {
        const S = schema();
        const t = shelfTarget(input);
        if (!shelfDoc) throw new LedgerError('shelf-missing', `“${t.code}” rafı raf kataloğunda yok (kaldırılmış olabilir).`, { shelfId: t.id });
        if (S.isShelfCountLocked(shelfDoc)) throw countLockedError('raf kaldırılmadan önce sayımı bitirin.', t.code, shelfDoc);
        const onShelf = rowsFor(t.code, rows);
        const stocked = onShelf.filter(r => S.hasPhysicalStock(r.data));
        if (stocked.length) {
            throw new LedgerError('shelf-not-empty', `“${t.code}” rafında stokta ${stocked.length} ürün kaydı var; raf kaldırılmadan önce ürünleri başka rafa taşıyın.`, { count: stocked.length });
        }
        const legacy = onShelf.filter(r => S.normShelfCode(r.data.raf) !== t.code);
        if (legacy.length) {
            throw new LedgerError('legacy-shelf-field', `“${t.code}” rafına eski biçimli bir alanla bağlı ${legacy.length} kayıt var; bu kayıtlar düzeltilmeden raf kaldırılamaz.`, { ids: legacy.map(r => String(r.id)) });
        }
        const validate = t.depot === 'b1' ? S.validateB1 : S.validateB2;
        const rowWrites = onShelf.map(r => {
            const data = r.data.rafPasif === true ? { raf: '', rafPasif: false } : { raf: '' };
            const errors = validate(data, { partial: true });
            if (errors.length) throw new LedgerError('schema-violation', errors.join(', '), { errors });
            return { kind: 'update', col: t.depot, id: String(r.id), data };
        });
        const used = Number.isInteger(shelfDoc.usedSlots) ? shelfDoc.usedSlots : 0;
        return {
            rowWrites,
            counterFix: used !== 0,
            audit: { type: 'raf-silindi', refCol: SHELF_COL, refId: t.id, item: t.code, qty: rowWrites.length,
                reason: rowWrites.length ? `Boş raf kaldırıldı; ${rowWrites.length} tükenmiş kayıt Havuz'a alındı.` : 'Boş raf kaldırıldı.' },
            result: { id: t.id, code: t.code, depot: t.depot, movedToPool: rowWrites.length },
        };
    }

    /**
     * SAF — raf adını (kodunu) düzeltme. Kod belge kimliğidir ve kurallarda değiştirilemez: yeni kodla belge oluşturulur, eski
     * silinir. Yalnız hiçbir kaydın göstermediği ve sayımda olmayan rafta. Dönüş: { newDoc, newId, counterFix, audit, result }.
     */
    function planShelfRename(input, oldDoc, newDoc, rows) {
        const S = schema();
        const t = shelfTarget(input);
        const n = shelfTarget({ depot: input.depot, code: input.newCode });
        if (n.id === t.id) throw new LedgerError('invalid-argument', 'Yeni raf adı eskisiyle aynı.');
        if (!oldDoc) throw new LedgerError('shelf-missing', `“${t.code}” rafı raf kataloğunda yok.`, { shelfId: t.id });
        if (S.isShelfCountLocked(oldDoc)) throw countLockedError('adı değiştirilmeden önce sayımı bitirin.', t.code, oldDoc);
        if (newDoc) throw new LedgerError('shelf-exists', `“${n.code}” adlı raf bu depoda zaten var.`, { shelfId: n.id });
        const onShelf = rowsFor(t.code, rows);
        if (onShelf.length) {
            throw new LedgerError('shelf-not-empty', `“${t.code}” rafına bağlı ${onShelf.length} ürün kaydı var; adı yalnız boş rafta düzeltilebilir. Önce ürünleri taşıyın.`, { count: onShelf.length });
        }
        const data = S.buildShelfDoc({ depot: t.depot, code: n.code, capacity: oldDoc.capacity, usedSlots: 0, active: oldDoc.active === true, updatedAt: SERVER_TIME, updatedBy: input.uid });
        const used = Number.isInteger(oldDoc.usedSlots) ? oldDoc.usedSlots : 0;
        return {
            newId: n.id, newDoc: data, counterFix: used !== 0,
            audit: { type: 'raf-adi-duzeltildi', refCol: SHELF_COL, refId: n.id, item: n.code, fromValue: t.code, toValue: n.code },
            result: { id: n.id, code: n.code, depot: t.depot, previousId: t.id },
        };
    }

    /**
     * SAF — kayıt bayraklarının (rafPasif) raf kilidiyle uzlaştırılması (WMS eşitleme ve geri yükleme sonrası). Raf belgesi
     * yoksa ya da kilitsizse bayrak kalkar; kilitliyse konur. Varsayılan olarak yalnız farklı olan kayıtlar yazılır;
     * opts.canonicalize === true iken `rafPasif` alanı eksik/boolean olmayan eski kayıtlar da kanonik `false` alır.
     */
    function planShelfLockSync(itemsByDepot, shelfDocs, opts = {}) {
        const S = schema();
        const canonicalize = !!(opts && opts.canonicalize);
        const writes = [];
        STOCK_COLS.forEach(depot => {
            ((itemsByDepot && itemsByDepot[depot]) || []).forEach(row => {
                const sid = shelfIdOf(depot, S.itemShelfCode(row));
                const locked = !!sid && S.isShelfCountLocked((shelfDocs || {})[sid]);
                const needsFix = canonicalize
                    ? (typeof row.rafPasif !== 'boolean' || row.rafPasif !== locked)
                    : ((row.rafPasif === true) !== locked);
                if (!needsFix) return;
                const id = row.__docId ?? row.id;
                if (id === undefined || id === null || String(id) === '') return;
                writes.push({ col: depot, id: String(id), data: { rafPasif: locked } });
            });
        });
        return writes;
    }

    // ─── Firestore yürütücüleri (bağımlılıklar enjekte edilir: { db, root, fns:{runTransaction, doc, getDoc, serverTimestamp}, uid }) ───
    const makeRef = (deps) => (col, id) => deps.fns.doc(deps.db, deps.root, col, 'items', String(id).replace(/\//g, '_'));
    const materialize = (deps, data) => {
        if (!data) return data;
        const out = {};
        Object.keys(data).forEach(k => {
            out[k] = data[k] === SERVER_TIME ? deps.fns.serverTimestamp() : data[k] === DELETE_FIELD ? deps.fns.deleteField() : data[k];
        });
        return out;
    };
    // Yerel bellek için: sunucu zamanı yerine istemci saati (anlık çizim; gerçek değer dinleyiciden gelir). Silinen alan undefined.
    const localData = (data, now) => {
        if (!data) return data;
        const out = {};
        Object.keys(data).forEach(k => { out[k] = data[k] === SERVER_TIME ? now : data[k] === DELETE_FIELD ? undefined : data[k]; });
        return out;
    };
    // Denetim kaydı transaction'ın İÇİNDE yazılır: işlem ile kanıtı aynı commit'te (biri olup diğeri olmaz).
    const writeAudit = (tx, deps, entry) => {
        const rec = deps.auditRecord({ result: 'approved', ...entry });
        tx.set(makeRef(deps)(AUDIT_COL, rec.id), rec.data);
        return rec.id;
    };

    /**
     * İç transferi tek transaction'da yürütür. Dönüş: { ...result, duplicate, localWrites } — localWrites b1/b2/shelves
     * için yerel belleğe uygulanacak yazmalardır (sunucu zamanı istemci saatine çevrilmiş).
     */
    async function runTransfer(deps, rawInput) {
        const base = checkTransferInput({ ...rawInput, uid: deps.uid });
        // Kısmi taşımada yeni kayıt kimliği transaction'dan önce bir kez üretilir (yeniden denemelerde aynı kalır).
        const newTargetId = base.newTargetId || `${base.targetCol}_${schema().makeId()}`;
        const input = { ...rawInput, uid: deps.uid, newTargetId, now: base.now };
        const ref = makeRef(deps);
        return deps.fns.runTransaction(deps.db, async (tx) => {
            const opSnap = await tx.get(ref(OP_COL, base.operationId));
            if (opSnap.exists()) {
                const plan = planTransfer(input, { op: opSnap.data() });
                return { ...plan.result, duplicate: true, localWrites: [] };
            }
            const srcSnap = await tx.get(ref(base.sourceCol, base.sourceId));
            const source = srcSnap.exists() ? srcSnap.data() : null;
            let targetSameId = null;
            const shelves = {};
            if (source) {
                if (base.sourceCol !== base.targetCol && qtyOf(source) === base.qty) {
                    const t = await tx.get(ref(base.targetCol, base.sourceId));
                    targetSameId = t.exists() ? t.data() : null;
                }
                for (const sid of transferShelfIds(base, source)) {
                    const s = await tx.get(ref(SHELF_COL, sid));
                    shelves[sid] = s.exists() ? s.data() : null;
                }
            }
            const plan = planTransfer(input, { op: null, source, targetSameId, shelves });
            plan.writes.forEach(w => {
                const r = ref(w.col, w.id);
                if (w.kind === 'set') tx.set(r, materialize(deps, w.data));
                else if (w.kind === 'update') tx.update(r, materialize(deps, w.data));
                else tx.delete(r);
            });
            const localWrites = plan.writes.filter(w => w.col !== OP_COL)
                .map(w => ({ ...w, data: localData(w.data, base.now) }));
            return { ...plan.result, duplicate: false, localWrites };
        });
    }

    /**
     * Raf kapasitesi / aktifliği kaydet (yoksa oluştur). deps.countUsage(depot, code) → Promise<int>: belge yoksa
     * sunucudan taze sayılan slot kullanımı (transaction DIŞINDA; istemci SDK'sı transaction içinde sorgu çalıştıramaz).
     */
    async function saveShelf(deps, input) {
        const S = schema();
        const code = S.normShelfCode(input && input.code);
        const depot = input && input.depot;
        planShelfSave({ ...input, uid: deps.uid, usedSlotsIfNew: 0 }, { usedSlots: 0 });   // erken giriş doğrulaması
        const ref = makeRef(deps);
        const id = S.shelfDocId(depot, code);
        const pre = await deps.fns.getDoc(ref(SHELF_COL, id));
        const usedSlotsIfNew = pre.exists() ? undefined : await deps.countUsage(depot, code);
        return deps.fns.runTransaction(deps.db, async (tx) => {
            const snap = await tx.get(ref(SHELF_COL, id));
            const existing = snap.exists() ? snap.data() : null;
            if (!existing && usedSlotsIfNew === undefined) {
                throw new LedgerError('retry', 'Raf kaydı bu sırada silindi; işlemi tekrar deneyin.');
            }
            const plan = planShelfSave({ ...input, uid: deps.uid, usedSlotsIfNew }, existing);
            if (plan.kind === 'set') tx.set(ref(SHELF_COL, id), materialize(deps, plan.data));
            else tx.update(ref(SHELF_COL, id), materialize(deps, plan.data));
            const now = Date.now();
            return { ...plan.result, local: { id, ...(existing || {}), ...localData(plan.data, now) } };
        });
    }

    /**
     * saveProduct'ı (yeni/düzenleme) tek transaction'da yürütür. input: { col, id, isNew, fields }. id: yeni kayıtta
     * çağıran tarafından transaction'dan ÖNCE bir kez üretilir (appendItem'daki `${col}_${makeId()}` ile aynı desen;
     * yeniden denemelerde değişmez). Dönüş: { col, id, created, shelves, localWrites }.
     */
    async function runProductSave(deps, rawInput) {
        const S = schema();
        const input = { ...rawInput, uid: deps.uid };
        if (!STOCK_COLS.includes(input.col)) throw new LedgerError('invalid-argument', `Geçersiz koleksiyon: ${input.col}`);
        if (input.id == null || String(input.id).trim() === '') throw new LedgerError('invalid-argument', 'Kayıt kimliği gerekli.');
        // v3.6: sayım düzeltmesi gibi kanıt isteyen kayıtlar input.audit = { type, reason } ile gelir (aynı commit'te yazılır).
        if (input.audit) {
            requireAudit(deps);
            if (input.isNew) throw new LedgerError('invalid-argument', 'Denetim kaydı yalnız mevcut ürün düzeltmesinde kullanılır.');
        }
        const now = Date.now();
        const ref = makeRef(deps);
        return deps.fns.runTransaction(deps.db, async (tx) => {
            let existing = null;
            if (!input.isNew) {
                const snap = await tx.get(ref(input.col, input.id));
                existing = snap.exists() ? snap.data() : null;
            }
            // Hangi raf belgelerinin okunacağını bilmek için ön izleme (yetkili birleşim planProductSave içinde yapılır):
            // önceki raf (varsa) + fields.raf verilmişse o, verilmemişse mevcut rafın kendisi (değişmiyor demektir).
            const prevCode = existing ? S.itemShelfCode(existing) : '';
            const nextRaf = (input.fields && input.fields.raf !== undefined) ? input.fields.raf : (existing ? existing.raf : undefined);
            const nextCode = S.normShelfCode(nextRaf);
            const shelfIds = new Set();
            const prevShelfId = existing ? shelfIdOf(input.col, prevCode) : null;
            if (prevShelfId) shelfIds.add(prevShelfId);
            const nextShelfId = shelfIdOf(input.col, nextCode);
            if (nextShelfId) shelfIds.add(nextShelfId);
            const shelves = {};
            for (const sid of shelfIds) {
                const s = await tx.get(ref(SHELF_COL, sid));
                shelves[sid] = s.exists() ? s.data() : null;
            }
            const plan = planProductSave(input, { existing, shelves });
            plan.writes.forEach(w => {
                const r = ref(w.col, w.id);
                if (w.kind === 'set') tx.set(r, materialize(deps, w.data));
                else if (w.kind === 'update') tx.update(r, materialize(deps, w.data));
                else tx.delete(r);
            });
            let auditId = null;
            if (input.audit) {
                const { qtyBefore, qtyAfter } = plan.result;
                auditId = writeAudit(tx, deps, {
                    type: input.audit.type, refCol: input.col, refId: String(input.id),
                    item: (existing && (existing.ürün || existing.name)) || String(input.id),
                    qty: qtyAfter - qtyBefore, fromValue: String(qtyBefore), toValue: String(qtyAfter), reason: input.audit.reason,
                });
            }
            const localWrites = plan.writes.map(w => ({ ...w, data: localData(w.data, now) }));
            return { ...plan.result, auditId, localWrites };
        });
    }

    // ─── v3.6 · Raf yönetimi yürütücüleri ────────────────────────────────────────────────────────────────────────────
    // deps: _ledgerDeps + fns.{deleteField, writeBatch} + findShelfRows(depot, code, {exhaustive}) → Promise<[{id, data}]>
    //       (SUNUCUDAN taze; istemci SDK'sı transaction içinde sorgu çalıştıramaz) + auditRecord(entry) → {id, data}.
    async function commitRowWrites(deps, writes) {
        const ref = makeRef(deps);
        for (let k = 0; k < writes.length; k += ROW_CHUNK) {
            const batch = deps.fns.writeBatch(deps.db);
            writes.slice(k, k + ROW_CHUNK).forEach(w => batch.update(ref(w.col, w.id), materialize(deps, w.data)));
            await batch.commit();
        }
    }
    async function zeroShelfCounter(deps, id) {
        await deps.fns.runTransaction(deps.db, async (tx) => {
            const snap = await tx.get(makeRef(deps)(SHELF_COL, id));
            if (!snap.exists()) throw new LedgerError('shelf-missing', 'Raf bu sırada kaldırılmış.', { shelfId: id });
            tx.update(makeRef(deps)(SHELF_COL, id), materialize(deps, { usedSlots: 0, updatedAt: SERVER_TIME, updatedBy: deps.uid }));
        });
    }

    /** Yeni raf (katalogda varsa ret). Kullanım sunucudan sayılır; raf ve denetim kaydı aynı commit'te. */
    async function createShelf(deps, input) {
        requireAudit(deps);
        const t = shelfTarget(input);
        planShelfSave({ ...input, uid: deps.uid, usedSlotsIfNew: 0 }, { usedSlots: 0 });   // erken giriş doğrulaması
        const ref = makeRef(deps);
        if ((await deps.fns.getDoc(ref(SHELF_COL, t.id))).exists()) {
            throw new LedgerError('shelf-exists', `“${t.code}” rafı bu depoda zaten var.`, { shelfId: t.id });
        }
        const usedSlotsIfNew = await deps.countUsage(t.depot, t.code);
        const now = Date.now();
        return deps.fns.runTransaction(deps.db, async (tx) => {
            const snap = await tx.get(ref(SHELF_COL, t.id));
            if (snap.exists()) throw new LedgerError('shelf-exists', `“${t.code}” rafı bu depoda zaten var.`, { shelfId: t.id });
            const plan = planShelfSave({ ...input, uid: deps.uid, usedSlotsIfNew }, null);
            tx.set(ref(SHELF_COL, t.id), materialize(deps, plan.data));
            writeAudit(tx, deps, { type: 'raf-eklendi', refCol: SHELF_COL, refId: t.id, item: t.code, qty: plan.data.capacity });
            return { ...plan.result, local: { id: t.id, ...localData(plan.data, now) } };
        });
    }

    /**
     * Sayım kilidi koy / kaldır. Sıra: (1) raf belgesi + denetim kaydı tek transaction'da — bu andan itibaren defter hareketi
     * reddeder; (2) rafa bağlı kayıtların bayrakları ≤450'lik parçalar; (3) doğrulama turu (eksik kalan bir kez daha yazılır).
     * Yarıda kalırsa aynı çağrı tekrar edilebilir (raf zaten istenen durumdaysa yalnız bayraklar uzlaştırılır).
     */
    async function setShelfCountLock(deps, input) {
        requireAudit(deps);
        const t = shelfTarget(input);
        const locked = input.locked === true;
        const ref = makeRef(deps);
        const now = Date.now();
        // Ön okuma yalnız denetim kaydındaki kayıt sayısı içindir; bayraklar kilitten SONRAKİ taze okumayla yazılır.
        const preRows = await deps.findShelfRows(t.depot, t.code);
        const shelfStep = await deps.fns.runTransaction(deps.db, async (tx) => {
            const snap = await tx.get(ref(SHELF_COL, t.id));
            const plan = planShelfLock({ ...input, uid: deps.uid }, snap.exists() ? snap.data() : null, preRows);
            if (plan.shelfWrite) {
                tx.update(ref(SHELF_COL, t.id), materialize(deps, plan.shelfWrite.data));
                writeAudit(tx, deps, plan.audit);
            }
            return { changed: !!plan.shelfWrite, local: plan.shelfWrite ? localData(plan.shelfWrite.data, now) : null };
        });
        const rowWrites = planLockRowWrites(t.depot, t.code, await deps.findShelfRows(t.depot, t.code), locked);
        await commitRowWrites(deps, rowWrites);
        let pending = planLockRowWrites(t.depot, t.code, await deps.findShelfRows(t.depot, t.code), locked);
        if (pending.length) {
            await commitRowWrites(deps, pending);
            rowWrites.push(...pending);
            pending = planLockRowWrites(t.depot, t.code, await deps.findShelfRows(t.depot, t.code), locked);
            if (pending.length) {
                throw new LedgerError('lock-incomplete', `${pending.length} kaydın sayım işareti güncellenemedi; işlemi tekrar deneyin ya da WMS'ten raf sayaçlarını eşitleyin.`, { pending: pending.length });
            }
        }
        return {
            id: t.id, code: t.code, depot: t.depot, locked, changed: shelfStep.changed, rowsChanged: rowWrites.length,
            localShelf: shelfStep.local, localRows: rowWrites.map(w => ({ col: w.col, id: w.id, data: w.data })),
        };
    }

    // [WHY]: v3.7 İP-10 · Tek raf, çoklu seçili raflar veya tüm depo için toplu sayım kilidi koyma / kaldırma.
    //        Her raf mevcut atomik setShelfCountLock sözleşmesini kullanır; kısmi hata diğer rafları bozmaz.
    // [HOW]: Kilit açılırken gerekçe en başta doğrulanır (0 yazma ile erken ret), ardından her raf sırayla
    //        kilitlenir/açılır ve başarılı/başarısız özetleri ile yerel yamalar toplanır.
    async function setBatchShelfCountLock(deps, input) {
        requireAudit(deps);
        const S = schema();
        const i = input || {};
        if (!S.SHELF_DEPOTS.includes(i.depot)) throw new LedgerError('invalid-argument', `Geçersiz depo: ${i.depot}`);
        const locked = i.locked === true;
        if (locked) {
            const reason = cleanLockReason(i.reason);
            if (!reason) throw new LedgerError('invalid-argument', 'Sayım gerekçesini yazın (ör. "Yıl sonu sayımı").');
            if (reason.length > S.SHELF_LOCK_REASON_MAX) {
                throw new LedgerError('invalid-argument', `Sayım gerekçesi en fazla ${S.SHELF_LOCK_REASON_MAX} karakter olabilir.`);
            }
        }
        const uniqueCodes = [...new Set((Array.isArray(i.codes) ? i.codes : []).map(c => S.normShelfCode(c)).filter(c => S.isValidShelfCode(c)))];
        if (!uniqueCodes.length) throw new LedgerError('invalid-argument', 'Sayıma alınacak en az bir geçerli raf seçin.');

        const succeeded = [], failed = [], localShelves = [], localRows = [];
        let totalRowsChanged = 0;
        let done = 0;
        const onProgress = typeof i.onProgress === 'function' ? i.onProgress : null;
        const CONCURRENCY = 4;
        for (let idx = 0; idx < uniqueCodes.length; idx += CONCURRENCY) {
            const batch = uniqueCodes.slice(idx, idx + CONCURRENCY);
            await Promise.all(batch.map(async code => {
                try {
                    const res = await setShelfCountLock(deps, { depot: i.depot, code, locked, reason: i.reason });
                    succeeded.push({ id: res.id, code: res.code, depot: res.depot, locked: res.locked, changed: res.changed, rowsChanged: res.rowsChanged });
                    totalRowsChanged += res.rowsChanged;
                    if (res.localShelf) localShelves.push({ id: res.id, data: res.localShelf });
                    if (Array.isArray(res.localRows) && res.localRows.length) localRows.push(...res.localRows);
                } catch (err) {
                    failed.push({ code, message: (err && err.message) || 'Bilinmeyen hata', errorCode: (err && err.code) || 'unknown' });
                } finally {
                    done += 1;
                    if (onProgress) {
                        try { onProgress(done, uniqueCodes.length, code); } catch (_) { /* ilerleme bildirimi işlemi bozmaz */ }
                    }
                }
            }));
        }
        return { depot: i.depot, locked, succeeded, failed, totalRowsChanged, localShelves, localRows };
    }

    // [WHY]: v3.7 İP-10 · Sayım Fark Masası'nda onaylanan eksik/fazla farkları stoğa atomik olarak işler ve
    //        sayim-duzeltme denetim kaydı bırakır; kilitli rafta rafPasif:true korunur.
    // [HOW]: Her kalem için taze stok okunur, computePatch ile durum/adet yaması hazırlanır ve mevcut
    //        runProductSave transaction'ından geçirilir. Farkı olmayan satırlar atlanır.
    async function applyCountFixes(deps, input) {
        requireAudit(deps);
        const S = schema();
        const i = input || {};
        if (!STOCK_COLS.includes(i.depot)) throw new LedgerError('invalid-argument', `Geçersiz koleksiyon: ${i.depot}`);
        if (!Array.isArray(i.fixes) || !i.fixes.length) throw new LedgerError('invalid-argument', 'Stoğa işlenecek fark satırı yok.');
        if (typeof i.computePatch !== 'function') throw new LedgerError('invalid-argument', 'Stok durum hesaplayıcı (computePatch) gerekli.');

        const ref = makeRef(deps);
        const applied = [], skipped = [], failed = [], localWrites = [];
        for (const fix of i.fixes) {
            const id = fix && fix.id != null ? String(fix.id).trim() : '';
            const after = Number(fix && fix.countedQty);
            if (!id || !Number.isInteger(after) || after < 0) {
                failed.push({ id, message: 'Geçersiz ürün kimliği veya sayım adedi.' });
                continue;
            }
            try {
                const snap = await deps.fns.getDoc(ref(i.depot, id));
                if (!snap.exists()) {
                    failed.push({ id, message: 'Ürün kaydı bulunamadı (silinmiş olabilir).' });
                    continue;
                }
                const existing = snap.data();
                const before = Math.trunc(qtyOf(existing));
                if (after === before) {
                    skipped.push({ id, before, after });
                    continue;
                }
                const { patch } = i.computePatch(i.depot, existing, after - before);
                const fields = { adet: after, lastUpdate: Date.now() };
                ['durumu', 'status', 'stokOncekiDurum'].forEach(k => { if (patch && patch[k] !== undefined) fields[k] = patch[k]; });
                const reason = String(fix.note ?? '').trim().slice(0, 200) || 'Sayım fark düzeltmesi';
                const res = await runProductSave(deps, {
                    col: i.depot, id, isNew: false, fields,
                    audit: { type: 'sayim-duzeltme', reason },
                });
                applied.push({ id, before: res.qtyBefore, after: res.qtyAfter, auditId: res.auditId });
                if (Array.isArray(res.localWrites)) localWrites.push(...res.localWrites);
            } catch (err) {
                failed.push({ id, message: (err && err.message) || 'Sayım düzeltmesi kaydedilemedi.' });
            }
        }
        return { depot: i.depot, applied, skipped, failed, localWrites };
    }

    /** Boş rafı kaldır: adet 0 kayıtlar Havuz'a alınır, raf belgesi silinir, denetim kaydı — kayıtlar, silme ve kanıt tek commit. */
    async function deleteShelf(deps, input) {
        requireAudit(deps);
        const t = shelfTarget(input);
        const ref = makeRef(deps);
        const rows = await deps.findShelfRows(t.depot, t.code, { exhaustive: true });
        const pre = await deps.fns.getDoc(ref(SHELF_COL, t.id));
        const first = planShelfDelete({ ...input, uid: deps.uid }, pre.exists() ? pre.data() : null, rows);
        if (first.counterFix) await zeroShelfCounter(deps, t.id);
        return deps.fns.runTransaction(deps.db, async (tx) => {
            const snap = await tx.get(ref(SHELF_COL, t.id));
            const fresh = [];
            for (const r of rowsFor(t.code, rows)) {
                const s = await tx.get(ref(t.depot, r.id));
                if (s.exists()) fresh.push({ id: r.id, data: s.data() });
            }
            const shelfDoc = snap.exists() ? snap.data() : null;
            const plan = planShelfDelete({ ...input, uid: deps.uid }, shelfDoc, fresh);
            if (plan.counterFix) throw new LedgerError('retry', 'Raf sayacı bu sırada değişti; işlemi tekrar deneyin.');
            plan.rowWrites.forEach(w => tx.update(ref(w.col, w.id), materialize(deps, w.data)));
            tx.delete(ref(SHELF_COL, t.id));
            writeAudit(tx, deps, plan.audit);
            return { ...plan.result, localRows: plan.rowWrites.map(w => ({ col: w.col, id: w.id, data: w.data })) };
        });
    }

    /** Boş rafın adını düzelt: yeni kodla belge + eskisinin silinmesi + denetim kaydı tek commit. */
    async function renameShelf(deps, input) {
        requireAudit(deps);
        const t = shelfTarget(input);
        const ref = makeRef(deps);
        const rows = await deps.findShelfRows(t.depot, t.code, { exhaustive: true });
        const [preOld, preNew] = await Promise.all([
            deps.fns.getDoc(ref(SHELF_COL, t.id)),
            deps.fns.getDoc(ref(SHELF_COL, shelfTarget({ depot: input.depot, code: input.newCode }).id)),
        ]);
        const first = planShelfRename({ ...input, uid: deps.uid }, preOld.exists() ? preOld.data() : null, preNew.exists() ? preNew.data() : null, rows);
        if (first.counterFix) await zeroShelfCounter(deps, t.id);
        const now = Date.now();
        return deps.fns.runTransaction(deps.db, async (tx) => {
            const oldSnap = await tx.get(ref(SHELF_COL, t.id));
            const newSnap = await tx.get(ref(SHELF_COL, first.newId));
            const plan = planShelfRename({ ...input, uid: deps.uid }, oldSnap.exists() ? oldSnap.data() : null, newSnap.exists() ? newSnap.data() : null, rows);
            if (plan.counterFix) throw new LedgerError('retry', 'Raf sayacı bu sırada değişti; işlemi tekrar deneyin.');
            tx.set(ref(SHELF_COL, plan.newId), materialize(deps, plan.newDoc));
            tx.delete(ref(SHELF_COL, t.id));
            writeAudit(tx, deps, plan.audit);
            return { ...plan.result, local: { id: plan.newId, ...localData(plan.newDoc, now) } };
        });
    }

    /**
     * SAF planlayıcı — v3.3 Aşama 6 (Veri Geçişi): b1/b2'nin GERÇEK doluluğunu raf kataloğundaki (${ROOT}/shelves)
     * usedSlots ile uzlaştırır. itemsByDepot/shelfDocs SUNUCUDAN TAZE okunmuş olmalıdır (çağıran sorumludur — bu
     * fonksiyon saf, Firestore'a dokunmaz). "Hepsi ya da hiçbiri" DEĞİLDİR: her raf bağımsız düzeltilir; raf
     * katalogda yoksa ya da gerçek sayım kapasiteyi aşıyorsa işlemi DURDURMAZ, yalnız ayrı listelerde raporlar.
     *
     * [WHY]: runStockOps/runProductSave (Aşama 4) yalnız KENDİLERİNDEN SONRAKİ değişiklikleri doğru sayar; P1-02
     *        öncesi yazılmış veri ve raf kataloğuna SONRADAN eklenen eski raflar için usedSlots gerçek durumu
     *        yansıtmayabilir (kayma). Bu, o kaymayı TEK SEFERLİK kapatan uzlaştırma aracıdır (WMS "Sync" düğmesi).
     * [HOW]: Schema.slotUsageByShelf(items) yalnız İŞGAL EDEN kodları döner (0 ürünlü bir kod hiç anahtar olarak
     *        geçmez) — bu yüzden "düzeltilecek kodlar" kümesi yalnız usage'tan değil, bu depodaki KATALOG kodlarıyla
     *        BİRLEŞTİRİLİR; aksi halde tamamen boşalmış (ama hâlâ usedSlots>0 görünen) bir raf hiç düzeltilmezdi.
     *        Kapasiteyi aşan gerçek sayım: kapasite gerçek sayıma YÜKSELTİLİR (yazma kuralı — firestore.rules —
     *        usedSlots artışını yalnız capacity sınırı içinde kabul eder) ve ayrıca 'capacityRaised' listesinde
     *        raporlanır; admin incelemesi gerekir (otomatik düşürülmez, yalnız yükseltme — veri kaybı riski yoktur).
     * @param {{b1:object[], b2:object[]}} itemsByDepot
     * @param {Object<string,object>} shelfDocs  {shelfId: belge} — kataloğun TAMAMI (yalnız ilgili depo değil)
     * @param {{uid?:string}} [opts]
     * @returns {{writes:object[], updated:object[], capacityRaised:object[], unregistered:object[],
     *            pool:{b1:number,b2:number,total:number}, unchanged:number}}
     */
    function planShelfSync(itemsByDepot, shelfDocs, opts = {}) {
        const S = schema();
        const uid = opts.uid ?? null;
        const writes = [], updated = [], capacityRaised = [], unregistered = [];
        const pool = { b1: 0, b2: 0, total: 0 };
        let unchanged = 0;

        const catalogByDepot = { b1: new Map(), b2: new Map() };
        Object.entries(shelfDocs || {}).forEach(([sid, doc]) => {
            if (doc && STOCK_COLS.includes(doc.depot) && typeof doc.code === 'string') {
                catalogByDepot[doc.depot].set(doc.code, { sid, doc });
            }
        });

        STOCK_COLS.forEach(depot => {
            const items = (itemsByDepot && itemsByDepot[depot]) || [];
            const usage = S.slotUsageByShelf(items);
            pool[depot] = usage[''] || 0;
            pool.total += pool[depot];

            const codes = new Set([...Object.keys(usage).filter(Boolean), ...catalogByDepot[depot].keys()]);
            codes.forEach(code => {
                const count = usage[code] || 0;
                const entry = catalogByDepot[depot].get(code);
                if (!entry) {
                    if (count > 0) unregistered.push({ depot, code, count });
                    return;
                }
                const { sid, doc } = entry;
                const before = Number.isInteger(doc.usedSlots) ? doc.usedSlots : 0;
                if (count === before) { unchanged++; return; }
                if (count > doc.capacity) {
                    writes.push({ col: SHELF_COL, id: sid, data: { usedSlots: count, capacity: count, updatedAt: SERVER_TIME, updatedBy: uid } });
                    capacityRaised.push({ id: sid, code, depot, before, capacityBefore: doc.capacity, after: count });
                } else {
                    writes.push({ col: SHELF_COL, id: sid, data: { usedSlots: count, updatedAt: SERVER_TIME, updatedBy: uid } });
                    updated.push({ id: sid, code, depot, before, after: count });
                }
            });
        });
        // v3.6 / v3.8 VP-5: sayım bayrakları da aynı araçla raf kilidine eşitlenir (canonicalize:true eski eksik alanları tamamlar).
        const lockWrites = planShelfLockSync(itemsByDepot, shelfDocs, { canonicalize: !!opts.canonicalize });
        lockWrites.forEach(w => writes.push(w));
        const lockFixed = lockWrites.map(w => ({ col: w.col, id: w.id, rafPasif: w.data.rafPasif }));
        return { writes, updated, capacityRaised, unregistered, pool, unchanged, lockFixed };
    }

    // [WHY]: VP-5 — Raf sayaçlarını ve eski kayıtların rafPasif bayrağını yazmadan önce yöneticiye kesin sayılarla
    //        Dry-Run önizlemesi sunmak; canlı veriye körlemesine yazmayı önlemek.
    // [HOW]: Sunucudan taze b1/b2/shelves okunur, planShelfSync çalıştırılır; hiçbir batch commit atılmaz.
    async function _buildShelfSyncPlan(deps, opts = {}) {
        const [b1Snap, b2Snap, shelfSnap] = await Promise.all([
            deps.fns.getDocsFromServer(deps.fns.collection(deps.db, deps.root, 'b1', 'items')),
            deps.fns.getDocsFromServer(deps.fns.collection(deps.db, deps.root, 'b2', 'items')),
            deps.fns.getDocsFromServer(deps.fns.collection(deps.db, deps.root, SHELF_COL, 'items')),
        ]);
        // __docId: bayrak düzeltmesi belge kimliğiyle yazılır (kayıttaki eski id alanı belge kimliğinden farklı olabilir).
        const withDocId = d => ({ ...d.data(), __docId: d.id });
        const itemsByDepot = { b1: b1Snap.docs.map(withDocId), b2: b2Snap.docs.map(withDocId) };
        const shelfDocs = {};
        shelfSnap.docs.forEach(d => { shelfDocs[d.id] = d.data(); });
        return planShelfSync(itemsByDepot, shelfDocs, { uid: deps.uid, canonicalize: !!opts.canonicalize });
    }

    async function previewShelfSync(deps, opts = {}) {
        const plan = await _buildShelfSyncPlan(deps, opts);
        const { writes, ...out } = plan;
        return { ...out, totalWrites: writes.length };
    }

    /**
     * planShelfSync'i Firestore'a karşı yürütür (v3.3 Aşama 6 · v3.8 VP-5 canonicalize desteği). b1/b2/shelves SUNUCUDAN
     * TAZE okunur (transaction DIŞINDA — her raf/bayrak bağımsız düzeltilir). Düzeltmeler 450'lik parçalar hâlinde writeBatch ile yazılır.
     * deps.fns: { getDocsFromServer, collection, writeBatch, doc, serverTimestamp }.
     * @returns {{updated, capacityRaised, unregistered, pool, unchanged, lockFixed}}
     */
    async function runShelfSync(deps, opts = {}) {
        const ref = makeRef(deps);
        const plan = await _buildShelfSyncPlan(deps, opts);
        const CHUNK = 450;
        for (let i = 0; i < plan.writes.length; i += CHUNK) {
            const batch = deps.fns.writeBatch(deps.db);
            plan.writes.slice(i, i + CHUNK).forEach(w => batch.update(ref(w.col, w.id), materialize(deps, w.data)));
            await batch.commit();
        }
        const { writes, ...out } = plan;
        return out;
    }

    window.StockLedger = Object.freeze({
        STOCK_COLS, SHELF_COL, OP_COL, OP_ID_RE, SERVER_TIME, DELETE_FIELD, AUDIT_COL, LedgerError,
        newOperationId, checkTransferInput, transferShelfIds, shelfIdOf, planShelfCounterWrites,
        planTransfer, planShelfSave, planProductSave, planShelfSync, previewShelfSync, runTransfer, saveShelf, runProductSave, runShelfSync,
        assertNotCountLocked, planShelfLock, planShelfDelete, planShelfRename, planShelfLockSync,
        createShelf, setShelfCountLock, setBatchShelfCountLock, applyCountFixes, deleteShelf, renameShelf,
    });
})();
