// [WHY]: v3.8 · VP-2 — "AI Sarf Tüketim & Tahminleme Motoru" ve "Kritik Sipariş İhtiyacı" kartları statik yer tutucuydu.
//        Spark planında dış ücretli API olmadan, B3 tüketim geçmişinden deterministik tükenme günü ve sipariş önerisi
//        hesaplayan tek saf motor gerekir ki rozet, modal, EBYS köprüsü ve testler aynı kaynaktan beslensin.
// [HOW]: Saf klasik modül (DOM ve Firebase yok — Anayasa §3 & §4). B3 sarf çıkışlarını 5 günlük dilimlerde EWMA
//        (alpha = 0.35) + pencere ortalamasıyla birleştirir. En az 2 farklı günde tüketim yoksa tahmin uydurmaz
//        (status: 'insufficient', daysRemaining: null). window.AppModules.BurnRate olarak dondurulur.
(function () {
    'use strict';

    const DAY_MS = 24 * 60 * 60 * 1000;
    const WINDOWS = Object.freeze([30, 60, 90]);
    const DEFAULT_WINDOW_DAYS = 30;
    const DEFAULT_SAFETY_DAYS = 30;
    const BUCKET_DAYS = 5;
    const EWMA_ALPHA = 0.35;
    const CRITICAL_DAYS = 14;
    const WARNING_DAYS = 30;
    const DEFAULT_MIN_LIMIT = 3;
    const MAX_PURCHASE_ITEMS = 3;
    const MAX_SUBJECT_LEN = 220;
    const MAX_LINE_DESC_LEN = 240;
    const MAX_LINE_CAT_LEN = 120;
    const MAX_CONSOLIDATED_DESC_LEN = 35000;
    const AUTO_EMPTY_STATUSES = Object.freeze(['Tükendi', 'Zimmetlendi', 'Serviste', 'Hurda', 'Çıkış Yapıldı']);
    const CLOSED_PO_RE = /(^|[\s·\-_/])(iptal|reddedildi|tamamland[ıi]|onayland[ıi]|kapand[ıi]|ar[şs]iv|teslim al[ıi]nd[ıi]|cancelled|canceled|rejected|completed|closed|archived|approved|withdrawn)([\s·\-_/]|$)/i;
    const CLOSED_EBYS_STATES = Object.freeze(['closed', 'archived', 'rejected', 'withdrawn', 'cancelled', 'canceled', 'completed']);
    const GENERIC_BULK_LINE_RE = /^toplu\s+(sarf|envanter|tedarik|malzeme)/i;
    const SUBJECT_PREFIX_RE = /^(?:kritik\s+stok\s+(?:toplu\s+)?tedariği|toplu\s+(?:sarf\s+malzeme|envanter\s*\/\s*sarf|sarf)\s+(?:ihtiyacı|tedariği)|satın\s+alma\s+talebi|acil\s+tedarik)(?:\s*\([^)]*\))?\s*[:\-–—]\s*/i;

    function text(v) { return v == null ? '' : String(v).trim(); }
    function toList(x) { return Array.isArray(x) ? x : Object.values(x || {}); }
    function round2(n) { return Math.round(n * 100) / 100; }

    // [WHY]: Firestore Rules (noTag) ve PurchaseMoney metinlerde "<harf", "</", "<!", "<?" dizilerini reddeder.
    // [HOW]: Etiket benzeri "<" karakterlerini güvenli "‹" karakterine çevirir; matematiksel "a < b" boşluklu ifadeyi korur.
    function sanitizeNoTag(raw) {
        return text(raw).replace(/<(?=[a-zA-Z/!?])/g, '‹');
    }

    function clipText(raw, maxLen) {
        const s = sanitizeNoTag(raw);
        if (!maxLen || s.length <= maxLen) return s;
        return maxLen > 3 ? `${s.slice(0, maxLen - 1).trimEnd()}…` : s.slice(0, maxLen);
    }

    function cleanProductName(raw) {
        const s = text(raw);
        if (!s) return '';
        let cleaned = s.replace(/\s*[\(\[].*?[\)\]]/g, '').trim();
        const words = cleaned.split(/\s+/).filter(Boolean);
        if (words.length > 1) {
            const last = words[words.length - 1];
            if (/[0-9]/.test(last) && /[A-Z]/.test(last) && last.length >= 4) {
                words.pop();
                cleaned = words.join(' ');
            }
        }
        return cleaned.trim() || s;
    }

    function normKey(raw) {
        return text(raw).toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ');
    }

    function normalizeProductKey(raw) {
        return normKey(cleanProductName(raw));
    }

    function parseDateMs(v) {
        if (typeof v === 'number') return Number.isFinite(v) && v >= 1e11 ? v : 0;
        const s = text(v);
        if (!s) return 0;
        if (/^\d{12,}$/.test(s)) return Number(s);
        let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?/);
        if (m) return makeTs(+m[1], +m[2], +m[3], m[4], m[5], m[6]);
        m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
        if (m) return makeTs(+m[3], +m[2], +m[1], m[4], m[5], m[6]);
        return 0;
    }

    function makeTs(y, mo, d, hh, mm, ss) {
        if (mo < 1 || mo > 12 || d < 1 || d > 31) return 0;
        const dt = new Date(y, mo - 1, d, +(hh || 12), +(mm || 0), +(ss || 0), 0);
        return dt.getMonth() === mo - 1 ? dt.getTime() : 0;
    }

    function buildTypeLookup(productTypes) {
        const map = new Map();
        toList(productTypes).forEach(t => {
            if (!t) return;
            const name = text(typeof t === 'string' ? t : (t.name || t.ad));
            if (name) map.set(normKey(name), t.isDemirbas === true);
        });
        return map;
    }

    function isDemirbasItem(item, typeLookup) {
        if (!item) return false;
        if (item.isDemirbas === true) return true;
        if (item.isDemirbas === false) return false;
        const tName = normKey(item['tür'] || item.type || item.prodType || item.urunTuru || '');
        if (tName && typeLookup.has(tName)) return typeLookup.get(tName);
        return false;
    }

    function isManualPassive(item) {
        const st = normKey(item && (item.durumu || item.status));
        return st === 'pasif';
    }

    function isAutoEmptyStatus(item) {
        const d = text(item && item.durumu);
        const s = text(item && item.status);
        return AUTO_EMPTY_STATUSES.includes(d) || AUTO_EMPTY_STATUSES.includes(s);
    }

    function normalizeMovement(raw, typeLookup) {
        if (!raw) return null;
        const schemaNorm = (typeof window !== 'undefined' && window.Schema && typeof window.Schema.normalizeB3 === 'function')
            ? window.Schema.normalizeB3(raw) : null;
        const src = schemaNorm || raw;
        const tipRaw = text(src.tip).toLowerCase();
        const hasZimmetMarks = src.talepTuru != null || src.oncelik != null || src.requestId != null;
        const tip = ['cikis', 'zimmet', 'hurda'].includes(tipRaw) ? tipRaw : (hasZimmetMarks ? 'zimmet' : 'cikis');
        const ts = Number(src.ts) || parseDateMs(src.tarih || src.date) || parseDateMs(src.id);
        const qty = Number(src.adet ?? src.sarfAdet ?? src.qty) || 0;
        const cancelled = src.iadeEdildi === true || src.iptal === true || src.geriAlindi === true || src.undone === true;
        const name = cleanProductName(src.urunAciklama || src.productType || src['ürün'] || src.name || '');
        const category = text(src.urunTuru || src['tür'] || src.type || '');
        const demirbas = isDemirbasItem(src, typeLookup);
        return {
            id: src.id,
            tip,
            productId: src.productId != null ? String(src.productId) : null,
            name,
            category,
            qty,
            ts,
            cancelled,
            isDemirbas: demirbas,
        };
    }

    // [WHY]: Sabit tüketimde EWMA'nın gün içi çekim sekmelerinden sapmaması, hızlanan/yavaşlayan eğilimleri ise
    //        güvenilir biçimde yakalaması için pencere 5 günlük dilimlere bölünür.
    // [HOW]: Her dilimin günlük hızı üzerinden EWMA yürütülür; nihai hız pencere ortalaması ve EWMA'nın 50/50 harmanıdır.
    function computeRates(dailyTotals, windowDays) {
        let totalConsumed = 0;
        dailyTotals.forEach(q => { totalConsumed += q; });
        const windowAvg = totalConsumed / windowDays;
        const numBuckets = Math.max(2, Math.ceil(windowDays / BUCKET_DAYS));
        const buckets = new Array(numBuckets).fill(0);
        const bucketLens = new Array(numBuckets).fill(0);

        for (let dayIdx = 0; dayIdx < windowDays; dayIdx++) {
            const b = Math.min(numBuckets - 1, Math.floor(dayIdx / BUCKET_DAYS));
            bucketLens[b] += 1;
            const q = dailyTotals.get(dayIdx) || 0;
            buckets[b] += q;
        }

        let ewma = windowAvg;
        for (let b = 0; b < numBuckets; b++) {
            const len = bucketLens[b] || 1;
            const rate = buckets[b] / len;
            ewma = EWMA_ALPHA * rate + (1 - EWMA_ALPHA) * ewma;
        }

        const dailyRate = Math.max(0, (0.5 * windowAvg) + (0.5 * ewma));
        const ratio = windowAvg > 0 ? ewma / windowAvg : 1;
        let trend = 'steady';
        if (ratio >= 1.15) trend = 'accelerating';
        else if (ratio <= 0.85) trend = 'slowing';
        return { totalConsumed, windowAvg, ewma, dailyRate, trend };
    }

    /**
     * B3 sarf çıkış geçmişi ile aktif B1/B2 sarf stoklarını birleştirerek tükenme günü tahmini üretir.
     * @param {{b1?:Array|Object, b2?:Array|Object, b3?:Array|Object, productTypes?:Array, windowDays?:number, nowMs?:number, safetyDays?:number}} input
     */
    function analyzeBurnRate(input = {}) {
        const windowDays = Number.isFinite(Number(input.windowDays)) && Number(input.windowDays) > 0
            ? Math.round(Number(input.windowDays)) : DEFAULT_WINDOW_DAYS;
        const safetyDays = Number.isFinite(Number(input.safetyDays)) && Number(input.safetyDays) > 0
            ? Math.round(Number(input.safetyDays)) : DEFAULT_SAFETY_DAYS;
        const now = Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
        const windowStart = now - windowDays * DAY_MS;
        const typeLookup = buildTypeLookup(input.productTypes);

        const groups = new Map();
        const pidToKey = new Map();
        const demirbasPids = new Set();

        const ingestStock = (rows, depot) => {
            toList(rows).forEach(item => {
                if (!item) return;
                const demirbas = isDemirbasItem(item, typeLookup);
                if (demirbas) {
                    if (item.id != null) demirbasPids.add(String(item.id));
                    return;
                }
                if (isManualPassive(item) || item.rafPasif === true) return;
                const clean = cleanProductName(item['ürün'] || item.name || '');
                const key = normKey(clean);
                if (!key) return;
                if (item.id != null) pidToKey.set(String(item.id), key);
                if (!groups.has(key)) {
                    groups.set(key, {
                        key,
                        name: clean,
                        category: text(item['tür'] || item.type || item.prodType) || 'Sarf Malzeme',
                        currentStock: 0,
                        minLimit: 0,
                        depots: new Set(),
                        models: new Set(),
                        dailyTotals: new Map(),
                        eventCount: 0,
                        lastExitTs: 0,
                        inCatalog: true,
                    });
                }
                const g = groups.get(key);
                const qty = Math.max(0, Number(item.adet ?? item.qty) || 0);
                g.currentStock += qty;
                const lim = parseInt(item.limit || 0, 10);
                if (lim > g.minLimit) g.minLimit = lim;
                g.depots.add(depot);
                const rawName = text(item['ürün'] || item.name);
                if (rawName) g.models.add(rawName);
            });
        };

        ingestStock(input.b1, 'B1');
        ingestStock(input.b2, 'B2');

        toList(input.b3).forEach(raw => {
            const m = normalizeMovement(raw, typeLookup);
            if (!m || m.tip !== 'cikis' || m.cancelled || m.qty <= 0) return;
            if (m.isDemirbas || (m.productId && demirbasPids.has(m.productId))) return;
            if (!m.ts || m.ts < windowStart || m.ts > now) return;

            let key = (m.productId && pidToKey.get(m.productId)) || normKey(m.name);
            if (!key) return;
            if (!groups.has(key)) {
                groups.set(key, {
                    key,
                    name: m.name || key,
                    category: m.category || 'Sarf Malzeme',
                    currentStock: 0,
                    minLimit: DEFAULT_MIN_LIMIT,
                    depots: new Set(),
                    models: new Set(m.name ? [m.name] : []),
                    dailyTotals: new Map(),
                    eventCount: 0,
                    lastExitTs: 0,
                    inCatalog: false,
                });
            }
            const g = groups.get(key);
            const dayIdx = Math.max(0, Math.min(windowDays - 1, Math.floor((m.ts - windowStart) / DAY_MS)));
            g.dailyTotals.set(dayIdx, (g.dailyTotals.get(dayIdx) || 0) + m.qty);
            g.eventCount += 1;
            if (m.ts > g.lastExitTs) g.lastExitTs = m.ts;
        });

        const items = [];
        const counts = { total: 0, critical: 0, warning: 0, safe: 0, insufficient: 0 };

        groups.forEach(g => {
            const finalLimit = g.minLimit > 0 ? g.minLimit : DEFAULT_MIN_LIMIT;
            const activeDays = g.dailyTotals.size;
            let totalConsumed = 0;
            g.dailyTotals.forEach(q => { totalConsumed += q; });

            // Halüsinasyonsuz doğruluk kuralı: en az 2 farklı gün ve en az 2 hareket yoksa tükenme günü uydurulmaz.
            const sufficient = activeDays >= 2 && g.eventCount >= 2 && totalConsumed > 0;
            let status = 'insufficient';
            let confidence = 'insufficient';
            let dailyRate = 0;
            let monthlyRate = 0;
            let ewmaRate = 0;
            let windowAvg = 0;
            let trend = 'insufficient';
            let daysRemaining = null;
            let suggestedOrderQty = 0;

            if (sufficient) {
                const rates = computeRates(g.dailyTotals, windowDays);
                windowAvg = round2(rates.windowAvg);
                ewmaRate = round2(rates.ewma);
                dailyRate = round2(rates.dailyRate);
                monthlyRate = round2(rates.dailyRate * 30);
                trend = rates.trend;

                if (activeDays >= 6 && totalConsumed >= 10) confidence = 'high';
                else if (activeDays >= 3 && totalConsumed >= 4) confidence = 'medium';
                else confidence = 'low';

                if (g.currentStock <= 0) {
                    daysRemaining = 0;
                    status = 'critical';
                } else if (rates.dailyRate > 0) {
                    daysRemaining = Math.floor(g.currentStock / rates.dailyRate);
                    if (daysRemaining <= CRITICAL_DAYS) status = 'critical';
                    else if (daysRemaining <= WARNING_DAYS) status = 'warning';
                    else status = 'safe';
                } else {
                    daysRemaining = null;
                    status = 'insufficient';
                    confidence = 'insufficient';
                }

                const targetStock = Math.ceil(rates.dailyRate * safetyDays);
                if (status === 'critical' || status === 'warning' || g.currentStock <= finalLimit) {
                    suggestedOrderQty = Math.max(1, targetStock - g.currentStock, finalLimit - g.currentStock);
                } else {
                    suggestedOrderQty = Math.max(0, targetStock - g.currentStock);
                }
            } else if (g.currentStock <= finalLimit) {
                suggestedOrderQty = Math.max(1, (finalLimit * 2) - g.currentStock);
            }

            counts.total += 1;
            counts[status] += 1;

            items.push({
                key: g.key,
                name: g.name,
                category: g.category,
                depots: [...g.depots],
                models: [...g.models],
                currentStock: g.currentStock,
                minLimit: finalLimit,
                totalConsumed,
                eventCount: g.eventCount,
                activeDays,
                dailyRate,
                monthlyRate,
                windowAvg,
                ewmaRate,
                trend,
                daysRemaining,
                suggestedOrderQty,
                status,
                confidence,
                lastExitTs: g.lastExitTs,
                inCatalog: g.inCatalog,
            });
        });

        const rank = { critical: 0, warning: 1, safe: 2, insufficient: 3 };
        items.sort((a, b) => {
            if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
            if (a.daysRemaining != null && b.daysRemaining != null && a.daysRemaining !== b.daysRemaining) {
                return a.daysRemaining - b.daysRemaining;
            }
            if (b.dailyRate !== a.dailyRate) return b.dailyRate - a.dailyRate;
            return a.name.localeCompare(b.name, 'tr');
        });

        return { windowDays, safetyDays, nowMs: now, items, counts };
    }

    /**
     * Minimum stok limiti altındaki tüm ürünler ile ≤14 günde tükenecek sarf kalemlerini tek sipariş aday listesinde birleştirir.
     */
    function buildCriticalOrderCandidates(burnAnalysis, input = {}) {
        const typeLookup = buildTypeLookup(input.productTypes);
        const byKey = new Map();

        // 1) Depodaki minimum limit altı tüm aktif gruplar (renderCriticalStockTable ile aynı gruplama)
        const stockGroups = new Map();
        const scan = (rows, depot) => {
            toList(rows).forEach(item => {
                if (!item || isManualPassive(item) || item.rafPasif === true) return;
                const demirbas = isDemirbasItem(item, typeLookup);
                // Demirbaşta otomatik "gitti" satırları fantom 0 grubu oluşturmasın; sarfta 0/Tükendi gerçek stok tükenmesidir.
                if (demirbas && isAutoEmptyStatus(item)) return;
                const typeRaw = text(item['tür'] || item.type || item.prodType);
                const nameRaw = text(item['ürün'] || item.name) || 'İsimsiz';
                const status = text(item.durumu || item.status) || 'Kullanıma Hazır';
                const cleanType = cleanProductName(typeRaw);
                const cleanName = cleanProductName(nameRaw);
                const groupKey = demirbas
                    ? `demirbas:${normKey(cleanType || cleanName)}:${normKey(status)}`
                    : `sarf:${normKey(cleanName)}`;
                const displayName = demirbas ? `${cleanType || cleanName} (${status})` : cleanName;

                if (!stockGroups.has(groupKey)) {
                    stockGroups.set(groupKey, {
                        key: groupKey,
                        burnKey: demirbas ? '' : normKey(cleanName),
                        name: displayName,
                        category: cleanType || (demirbas ? 'Demirbaş' : 'Sarf Malzeme'),
                        isDemirbas: demirbas,
                        currentStock: 0,
                        limit: 0,
                        depots: new Set(),
                    });
                }
                const g = stockGroups.get(groupKey);
                g.currentStock += Math.max(0, parseInt(item.adet ?? item.qty ?? 0, 10) || 0);
                const lim = parseInt(item.limit || 0, 10);
                if (lim > g.limit) g.limit = lim;
                g.depots.add(depot);
            });
        };
        scan(input.b1, 'B1');
        scan(input.b2, 'B2');

        const burnByKey = new Map();
        ((burnAnalysis && burnAnalysis.items) || []).forEach(b => burnByKey.set(b.key, b));

        stockGroups.forEach(g => {
            const finalLimit = g.limit > 0 ? g.limit : DEFAULT_MIN_LIMIT;
            if (g.currentStock > finalLimit) return;
            const burn = g.burnKey ? burnByKey.get(g.burnKey) : null;
            const reason = g.currentStock === 0
                ? 'Tükendi'
                : (burn && burn.daysRemaining != null && burn.daysRemaining <= CRITICAL_DAYS
                    ? `Limit altı · ~${burn.daysRemaining} gün`
                    : (g.currentStock <= 1 ? 'Çok kritik stok' : 'Minimum limit altı'));
            const suggested = burn && burn.suggestedOrderQty > 0
                ? burn.suggestedOrderQty
                : Math.max(1, (finalLimit * 2) - g.currentStock);
            byKey.set(g.key, {
                key: g.key,
                name: g.name,
                category: g.category,
                isDemirbas: g.isDemirbas,
                depots: [...g.depots],
                currentStock: g.currentStock,
                limit: finalLimit,
                dailyRate: burn ? burn.dailyRate : 0,
                daysRemaining: burn ? burn.daysRemaining : null,
                suggestedOrderQty: suggested,
                severity: g.currentStock === 0 ? 'danger' : (g.currentStock <= 1 || (burn && burn.daysRemaining != null && burn.daysRemaining <= 7) ? 'danger' : 'warn'),
                reason,
                source: 'limit',
            });
        });

        // 2) Limit üstünde olsa bile ≤14 günde tükenecek proaktif sarf uyarıları
        ((burnAnalysis && burnAnalysis.items) || []).forEach(b => {
            if (b.status !== 'critical') return;
            const key = `sarf:${b.key}`;
            if (byKey.has(key)) return;
            byKey.set(key, {
                key,
                name: b.name,
                category: b.category || 'Sarf Malzeme',
                isDemirbas: false,
                depots: b.depots || [],
                currentStock: b.currentStock,
                limit: b.minLimit,
                dailyRate: b.dailyRate,
                daysRemaining: b.daysRemaining,
                suggestedOrderQty: Math.max(1, b.suggestedOrderQty || 1),
                severity: b.daysRemaining === 0 || (b.daysRemaining != null && b.daysRemaining <= 7) ? 'danger' : 'warn',
                reason: b.daysRemaining === 0 ? 'Tükendi' : `~${b.daysRemaining} günde tükenecek`,
                source: 'burn_rate',
            });
        });

        const list = [...byKey.values()].sort((a, b) => {
            if ((a.currentStock === 0) !== (b.currentStock === 0)) return a.currentStock === 0 ? -1 : 1;
            const ad = a.daysRemaining == null ? 9999 : a.daysRemaining;
            const bd = b.daysRemaining == null ? 9999 : b.daysRemaining;
            if (ad !== bd) return ad - bd;
            const ar = a.currentStock / Math.max(1, a.limit);
            const br = b.currentStock / Math.max(1, b.limit);
            if (ar !== br) return ar - br;
            return a.name.localeCompare(b.name, 'tr');
        });

        return {
            items: list,
            counts: {
                total: list.length,
                outOfStock: list.filter(x => x.currentStock === 0).length,
                burnOnly: list.filter(x => x.source === 'burn_rate').length,
                danger: list.filter(x => x.severity === 'danger').length,
            },
        };
    }

    /**
     * Seçilen kritik sipariş adaylarından EBYS Satın Alma formu (#purchaseModal) için ön-doldurma zarfı üretir.
     * Pilot kuralı (PurchaseMoney.MAX_ITEMS = 3) gereği en fazla 3 kalem taşınır; otomatik gönderim yapmaz.
     */
    function buildPurchasePrefillPayload(candidates, opts = {}) {
        const maxItems = Number.isInteger(opts.maxItems) && opts.maxItems > 0 ? opts.maxItems : MAX_PURCHASE_ITEMS;
        const clean = toList(candidates).filter(c => c && text(c.name || c.description));
        const selected = clean.slice(0, maxItems);
        const truncatedCount = Math.max(0, clean.length - selected.length);

        const items = selected.map(c => ({
            description: clipText(c.name || c.description, MAX_LINE_DESC_LEN),
            category: clipText(text(c.category) || 'Sarf Malzeme', MAX_LINE_CAT_LEN),
            quantity: Math.max(1, Math.round(Number(c.suggestedOrderQty || c.quantity) || 1)),
            unit: clipText(text(c.unit) || 'Adet', 40),
            unitPrice: '',
            currency: 'TRY',
            taxRate: 0,
        }));

        const subject = clipText(items.length === 1
            ? `Kritik Stok Tedariği: ${items[0].description}`
            : (items.length > 1 ? `Kritik Stok Toplu Tedariği (${items.length} kalem)` : 'Kritik Stok Tedariği'), MAX_SUBJECT_LEN);

        const urgent = selected.some(c => Number(c.currentStock) === 0 || (c.daysRemaining != null && Number(c.daysRemaining) <= 7));
        const priority = urgent ? 'Acil' : 'Hızlı';

        const detailLines = selected.map(c => {
            const parts = [`- ${sanitizeNoTag(c.name || c.description)}: Mevcut ${Number(c.currentStock) || 0}`];
            const lim = c.limit ?? c.minLimit;
            if (lim != null) parts.push(`Limit ${lim}`);
            if (c.dailyRate > 0) parts.push(`Günlük tüketim ${c.dailyRate}/gün`);
            if (c.daysRemaining != null) parts.push(c.daysRemaining === 0 ? 'Stok tükendi' : `Tahmini ~${c.daysRemaining} gün`);
            parts.push(`Önerilen sipariş: ${Math.max(1, Math.round(Number(c.suggestedOrderQty || c.quantity) || 1))} Adet`);
            return parts.join(' · ');
        });

        const description = detailLines.length
            ? `Operasyon Merkezi kritik stok ve tüketim analizi doğrultusunda acil tedarik ihtiyacı:\n${detailLines.join('\n')}`
            : '';

        return { subject, description, priority, items, truncatedCount, maxItems };
    }

    // [WHY]: v3.8 Hotfix HF-1 — EBYS satın alma formu PurchaseMoney.MAX_ITEMS (3) kalem satırı sınırı taşır;
    //        yönetici AI Sarf Tüketim veya Kritik Sipariş radarından 1..N (sınırsız) ürünü tek talepte aktarmak istiyor.
    // [HOW]: Seçili tüm benzersiz ürünleri 1 adet birleştirilmiş kalem satırında (quantity: 1, unit: 'Adet') toplar;
    //        her ürünün mevcut stok, limit, günlük tüketim hızı, tahmini günü ve önerilen adet dökümünü Açıklama
    //        (payload.description) alanına yapılandırılmış satırlar halinde yazar. Otomatik gönderim yapmaz.
    function buildConsolidatedPurchasePrefill(selectedCandidates, opts = {}) {
        const seen = new Set();
        const clean = [];
        toList(selectedCandidates).forEach(c => {
            if (!c) return;
            const rawName = sanitizeNoTag(c.name || c.description);
            if (!rawName) return;
            const k = normalizeProductKey(rawName) || normKey(rawName);
            if (!k || seen.has(k)) return;
            seen.add(k);
            const qty = Math.max(1, Math.round(Number(c.suggestedOrderQty ?? c.quantity) || 1));
            const lim = c.limit ?? c.minLimit;
            clean.push({
                key: k,
                name: rawName,
                category: clipText(text(c.category) || (c.isDemirbas ? 'Demirbaş' : 'Sarf Malzeme'), MAX_LINE_CAT_LEN),
                isDemirbas: c.isDemirbas === true,
                currentStock: Math.max(0, Number(c.currentStock) || 0),
                limit: lim != null && Number.isFinite(Number(lim)) ? Number(lim) : null,
                dailyRate: Number(c.dailyRate) > 0 ? round2(Number(c.dailyRate)) : 0,
                daysRemaining: c.daysRemaining != null && Number.isFinite(Number(c.daysRemaining)) ? Number(c.daysRemaining) : null,
                suggestedOrderQty: qty,
            });
        });

        if (!clean.length) {
            return {
                subject: 'Toplu Sarf Malzeme Tedariği',
                description: '',
                priority: 'Hızlı',
                items: [],
                consolidated: true,
                itemCount: 0,
                truncatedCount: 0,
                totalSuggestedQty: 0,
                includedKeys: [],
                includedNames: [],
            };
        }

        const count = clean.length;
        const totalSuggestedQty = clean.reduce((sum, c) => sum + c.suggestedOrderQty, 0);
        const hasDemirbas = clean.some(c => c.isDemirbas);
        const baseTitle = hasDemirbas
            ? `Toplu Envanter / Sarf Tedariği (${count} Kalem)`
            : `Toplu Sarf Malzeme İhtiyacı (${count} Kalem)`;

        const previewNames = clean.slice(0, 3).map(c => c.name).join(', ');
        const subject = clipText(
            count === 1
                ? `${baseTitle}: ${clean[0].name}`
                : `${baseTitle}: ${previewNames}${count > 3 ? ' vb.' : ''}`,
            MAX_SUBJECT_LEN
        );

        const urgent = clean.some(c => c.currentStock === 0 || (c.daysRemaining != null && c.daysRemaining <= 7));
        const priority = urgent ? 'Acil' : 'Hızlı';

        const singleItem = {
            description: clipText(baseTitle, MAX_LINE_DESC_LEN),
            category: clipText(text(opts.category) || (hasDemirbas ? 'Toplu Tedarik' : 'Sarf Malzeme'), MAX_LINE_CAT_LEN),
            quantity: 1,
            unit: 'Adet',
            unitPrice: '',
            currency: 'TRY',
            taxRate: 0,
        };

        const header = `Toplu EBYS Tedarik Listesi (${count} Kalem · Toplam Önerilen: ${totalSuggestedQty} Adet):`;
        const lines = [header];
        let totalLen = header.length;
        let omitted = 0;

        for (let i = 0; i < clean.length; i++) {
            const c = clean[i];
            const meta = [`Mevcut: ${c.currentStock}`];
            if (c.limit != null) meta.push(`Limit: ${c.limit}`);
            if (c.dailyRate > 0) meta.push(`Hız: ${c.dailyRate}/gün`);
            if (c.daysRemaining === 0) meta.push('Stok tükendi');
            else if (c.daysRemaining != null) meta.push(`Tahmini ~${c.daysRemaining} gün`);
            meta.push(`Önerilen: ${c.suggestedOrderQty} Adet`);
            const line = `${i + 1}. ${c.name} [${c.category}] — ${meta.join(' · ')}`;
            if (totalLen + line.length + 1 > MAX_CONSOLIDATED_DESC_LEN) {
                omitted = clean.length - i;
                break;
            }
            lines.push(line);
            totalLen += line.length + 1;
        }
        if (omitted > 0) lines.push(`… ve ${omitted} kalem daha.`);

        return {
            subject,
            description: lines.join('\n'),
            priority,
            items: [singleItem],
            consolidated: true,
            itemCount: count,
            truncatedCount: 0,
            totalSuggestedQty,
            includedKeys: clean.map(c => c.key),
            includedNames: clean.map(c => c.name),
        };
    }

    function extractRecordTs(rec) {
        if (!rec || typeof rec !== 'object') return 0;
        const candidates = [rec.updatedAt, rec.createdAt, rec.ts, rec.tarih, rec.date, rec.id];
        for (const v of candidates) {
            if (v == null || v === '') continue;
            if (typeof v === 'number' && Number.isFinite(v) && v >= 1e11) return v;
            if (typeof v === 'object') {
                if (typeof v.toMillis === 'function') {
                    const ms = v.toMillis();
                    if (Number.isFinite(ms) && ms > 0) return ms;
                }
                if (Number.isFinite(v.seconds)) return v.seconds * 1000;
            }
            const parsed = parseDateMs(v);
            if (parsed > 0) return parsed;
        }
        return 0;
    }

    function resolvePurchaseOrderStatus(po) {
        if (!po || typeof po !== 'object') return null;
        const rawStatus = text(po.durum || po.status);
        const normStatus = normKey(rawStatus);
        if (normStatus && CLOSED_PO_RE.test(normStatus)) return null;

        const wf = po.workflow;
        const wfState = normKey(wf && wf.currentState);
        if (wf && (wf.finished === true || wfState === 'completed' || wfState === 'cancelled' || wfState === 'canceled')) {
            return null;
        }
        if (wf && Array.isArray(wf.steps) && wf.steps.length > 0 && wf.steps.every(s => normKey(s && s.status) === 'approved')) {
            return null;
        }

        if (po.engineVersion === 'ebys-v1') return 'EBYS Sürecinde';
        if (wfState === 'suspended') return 'Askıda';
        if (wf && wf.started === true) return 'Onayda';
        if (normStatus === 'taslak' || normStatus === 'draft') return 'Taslak';
        if (normStatus.includes('inceleme')) return 'İncelemede';
        if (normStatus.includes('dondurul')) return 'Donduruldu';
        if (rawStatus) return rawStatus;
        return 'Onay Bekliyor';
    }

    function isPurchaseEbysDoc(doc) {
        if (!doc || typeof doc !== 'object') return false;
        const meta = doc.metadata || doc.metadataSnapshot || {};
        return Boolean(
            doc.purchaseOrderId ||
            doc.isPurchase === true ||
            doc.documentTypeCode === 'PURCHASE_REQUEST' ||
            doc.filePlanCode === 'PURCHASE_REQUEST' ||
            meta.filePlanCode === 'PURCHASE_REQUEST' ||
            doc.purchaseSnapshot
        );
    }

    function resolveEbysDocStatus(doc) {
        const rawState = text(doc.state || doc.status || doc.durum);
        const st = normKey(rawState);
        const openMap = {
            draft: 'Taslak',
            taslak: 'Taslak',
            registered: 'Kayıtlı',
            'kayıtlı': 'Kayıtlı',
            in_review: 'Onay Sürecinde',
            donduruldu: 'Onay Sürecinde',
            internally_approved: 'Onaylandı (İcra)',
            pending_execution: 'İcra Bekliyor',
            returned: 'İade · Revizyon',
        };
        if (openMap[st]) return { closed: false, label: openMap[st] };
        if (CLOSED_EBYS_STATES.includes(st) || (st && CLOSED_PO_RE.test(st))) {
            return { closed: true, label: null };
        }
        return { closed: false, label: text(doc.statusLabel) || rawState || 'EBYS Sürecinde' };
    }

    function addCandidateProductKey(raw, keySet) {
        const s = text(raw);
        if (!s || GENERIC_BULK_LINE_RE.test(s)) return;
        const k = normalizeProductKey(s);
        if (k && k.length >= 2 && !GENERIC_BULK_LINE_RE.test(k)) keySet.add(k);
    }

    function extractStructuredKeys(rec, keySet) {
        if (!rec || typeof rec !== 'object') return;
        const meta = rec.metadata || rec.metadataSnapshot || {};
        const snap = rec.purchaseSnapshot || {};

        // 1) Kalem listesi (items[].description)
        const itemLists = [rec.items, snap.items].filter(Array.isArray);
        itemLists.forEach(list => {
            list.forEach(line => {
                if (!line) return;
                const d = typeof line === 'string' ? line : (line.description || line.name || line['ürün'] || line.urun);
                addCandidateProductKey(d, keySet);
            });
        });

        // 2) Önceden çözümlenmiş toplu ad/anahtar listeleri
        if (Array.isArray(rec.includedNames)) rec.includedNames.forEach(n => addCandidateProductKey(n, keySet));
        if (Array.isArray(rec.includedKeys)) rec.includedKeys.forEach(k => { const nk = normKey(k); if (nk.length >= 2) keySet.add(nk); });

        // 3) Konu / Ürün başlığı
        const titles = [rec.urun, rec['ürün'], rec.subject, meta.subject];
        titles.forEach(rawTitle => {
            const t = text(rawTitle);
            if (!t) return;
            const stripped = t.replace(SUBJECT_PREFIX_RE, '').trim();
            if (stripped && stripped !== t) {
                stripped.replace(/\s+vb\.?$/i, '').split(/\s*[,;]\s*/).forEach(part => addCandidateProductKey(part, keySet));
            } else {
                addCandidateProductKey(t, keySet);
            }
        });

        // 4) Açıklama / EBYS gövdesindeki yapılandırılmış madde satırları (- Ürün: ... veya 1. Ürün [...] — ...)
        const bodies = [rec.aciklama, rec['açıklama'], rec.description, rec.content];
        bodies.forEach(body => {
            const b = text(body);
            if (!b) return;
            b.split(/\r?\n/).forEach(line => {
                const m = line.match(/^\s*(?:[-•*]|\d+[.)])\s+([^:\n—–\[]+?)(?:\s*\[[^\]]+\])?\s*(?:—|–|:|$)/);
                if (m && m[1]) addCandidateProductKey(m[1], keySet);
            });
        });
    }

    function buildEntryHaystack(rec) {
        const meta = rec.metadata || rec.metadataSnapshot || {};
        const snap = rec.purchaseSnapshot || {};
        const itemDesc = [...(Array.isArray(rec.items) ? rec.items : []), ...(Array.isArray(snap.items) ? snap.items : [])]
            .map(x => (typeof x === 'string' ? x : text(x && (x.description || x.name || x.urun || x['ürün']))))
            .filter(Boolean)
            .join('\n');
        return normKey([
            rec.urun, rec['ürün'], rec.subject, meta.subject,
            itemDesc,
            rec.aciklama, rec['açıklama'], rec.description, rec.content,
            Array.isArray(rec.includedNames) ? rec.includedNames.join('\n') : '',
        ].filter(Boolean).join('\n'));
    }

    function isWordChar(ch) {
        return Boolean(ch) && /[\p{L}\p{N}]/u.test(ch);
    }

    function hasBoundaryMatch(haystack, needle) {
        if (!haystack || !needle || needle.length < 3) return false;
        let idx = haystack.indexOf(needle);
        while (idx !== -1) {
            const before = idx > 0 ? haystack[idx - 1] : '';
            const after = idx + needle.length < haystack.length ? haystack[idx + needle.length] : '';
            if (!isWordChar(before) && !isWordChar(after)) return true;
            idx = haystack.indexOf(needle, idx + 1);
        }
        return false;
    }

    // [WHY]: v3.8 Hotfix HF-1 — Yönetici bir sarf/stok kalemi için hâlihazırda açık satın alma/EBYS talebi olup
    //        olmadığını sıfır ek Firestore okumasıyla radar ekranında görmek ister (çift sipariş önleme).
    // [HOW]: Mevcut purchaseOrders ve ebysDocuments kayıtlarından kapalı/iptal/reddedilmiş olanları eler, belge ID'siyle
    //        tekilleştirir, konu/kalem/açıklama satırlarından normalize ürün anahtarları çıkarır ve sınır-güvenli eşler.
    function indexActivePurchaseRequests(purchaseOrders = [], ebysDocuments = []) {
        const closedEbysIds = new Set();
        const ebysActiveById = new Map();

        toList(ebysDocuments).forEach(doc => {
            if (!isPurchaseEbysDoc(doc)) return;
            const id = text(doc.id || doc.purchaseOrderId || doc.ebysDocumentId);
            const st = resolveEbysDocStatus(doc);
            if (st.closed) {
                if (id) closedEbysIds.add(id);
                return;
            }
            const meta = doc.metadata || doc.metadataSnapshot || {};
            const keySet = new Set();
            extractStructuredKeys(doc, keySet);
            const entry = {
                id: id || `ebys-${ebysActiveById.size + 1}`,
                ref: text(doc.registrationNo || doc.evrakNo || (id ? `EBYS · ${id.slice(0, 8)}` : '')),
                title: text(doc.subject || meta.subject || doc.urun || doc['ürün']) || 'EBYS Satın Alma Talebi',
                status: st.label,
                ts: extractRecordTs(doc),
                keys: [...keySet],
                haystack: buildEntryHaystack(doc),
            };
            ebysActiveById.set(entry.id, entry);
        });

        const entries = [];
        const usedIds = new Set();

        toList(purchaseOrders).forEach((po, idx) => {
            if (!po || typeof po !== 'object') return;
            const id = text(po.ebysDocumentId || po.id) || `po-${idx + 1}`;
            if (po.engineVersion === 'ebys-v1' && closedEbysIds.has(id)) return;

            const status = resolvePurchaseOrderStatus(po);
            if (!status) return;

            const ebysMatch = ebysActiveById.get(id);
            const keySet = new Set(ebysMatch ? ebysMatch.keys : []);
            extractStructuredKeys(po, keySet);
            const poHaystack = buildEntryHaystack(po);
            const haystack = ebysMatch
                ? [ebysMatch.haystack, poHaystack].filter(Boolean).join('\n')
                : poHaystack;
            const ts = Math.max(extractRecordTs(po), ebysMatch ? ebysMatch.ts : 0);
            const title = (ebysMatch && ebysMatch.title !== 'EBYS Satın Alma Talebi' ? ebysMatch.title : '')
                || text(po.urun || po['ürün'] || po.subject)
                || (ebysMatch ? ebysMatch.title : 'Satın Alma Talebi');
            const ref = text(po.evrakNo) || (ebysMatch ? ebysMatch.ref : '') || id;

            entries.push({
                id,
                ref,
                title,
                status: ebysMatch ? ebysMatch.status : status,
                ts,
                keys: [...keySet],
                haystack,
            });
            usedIds.add(id);
        });

        ebysActiveById.forEach((entry, id) => {
            if (!usedIds.has(id)) entries.push(entry);
        });

        entries.sort((a, b) => (b.ts - a.ts) || a.id.localeCompare(b.id));

        const byKey = {};
        entries.forEach(entry => {
            entry.keys.forEach(k => {
                if (!byKey[k]) {
                    byKey[k] = {
                        count: 1,
                        latestTitle: entry.title,
                        latestStatus: entry.status,
                        latestDocId: entry.id,
                        latestRef: entry.ref,
                        latestTs: entry.ts,
                    };
                } else {
                    byKey[k].count += 1;
                    if (entry.ts > byKey[k].latestTs) {
                        byKey[k].latestTitle = entry.title;
                        byKey[k].latestStatus = entry.status;
                        byKey[k].latestDocId = entry.id;
                        byKey[k].latestRef = entry.ref;
                        byKey[k].latestTs = entry.ts;
                    }
                }
            });
        });

        const index = {
            totalActive: entries.length,
            byKey,
            entries,
            match(nameOrKey) {
                return matchActivePurchaseRequest(index, nameOrKey);
            },
        };
        return index;
    }

    function matchActivePurchaseRequest(index, productName) {
        if (!index || !Array.isArray(index.entries) || !index.entries.length) return null;
        const target = normalizeProductKey(productName) || normKey(productName);
        if (!target) return null;

        let count = 0;
        let latest = null;
        for (let i = 0; i < index.entries.length; i++) {
            const e = index.entries[i];
            const hit = (Array.isArray(e.keys) && e.keys.includes(target)) || hasBoundaryMatch(e.haystack, target);
            if (!hit) continue;
            count += 1;
            if (!latest || e.ts > latest.ts) latest = e;
        }
        if (!count || !latest) return null;
        return {
            count,
            latestTitle: latest.title,
            latestStatus: latest.status,
            latestDocId: latest.id,
            latestRef: latest.ref,
        };
    }

    const api = Object.freeze({
        WINDOWS,
        DEFAULT_WINDOW_DAYS,
        DEFAULT_SAFETY_DAYS,
        CRITICAL_DAYS,
        WARNING_DAYS,
        MAX_PURCHASE_ITEMS,
        cleanProductName,
        normalizeProductKey,
        analyzeBurnRate,
        buildCriticalOrderCandidates,
        buildPurchasePrefillPayload,
        buildConsolidatedPurchasePrefill,
        indexActivePurchaseRequests,
        matchActivePurchaseRequest,
    });

    if (typeof window !== 'undefined') {
        window.AppModules = window.AppModules || {};
        window.AppModules.BurnRate = api;
    }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})();
