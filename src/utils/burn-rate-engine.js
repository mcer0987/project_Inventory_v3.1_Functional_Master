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
    const AUTO_EMPTY_STATUSES = Object.freeze(['Tükendi', 'Zimmetlendi', 'Serviste', 'Hurda', 'Çıkış Yapıldı']);

    function text(v) { return v == null ? '' : String(v).trim(); }
    function toList(x) { return Array.isArray(x) ? x : Object.values(x || {}); }
    function round2(n) { return Math.round(n * 100) / 100; }

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
            description: text(c.name || c.description),
            category: text(c.category) || 'Sarf Malzeme',
            quantity: Math.max(1, Math.round(Number(c.suggestedOrderQty || c.quantity) || 1)),
            unit: text(c.unit) || 'Adet',
            unitPrice: '',
            currency: 'TRY',
            taxRate: 0,
        }));

        const subject = items.length === 1
            ? `Kritik Stok Tedariği: ${items[0].description}`
            : (items.length > 1 ? `Kritik Stok Toplu Tedariği (${items.length} kalem)` : 'Kritik Stok Tedariği');

        const urgent = selected.some(c => Number(c.currentStock) === 0 || (c.daysRemaining != null && Number(c.daysRemaining) <= 7));
        const priority = urgent ? 'Acil' : 'Hızlı';

        const detailLines = selected.map(c => {
            const parts = [`- ${text(c.name || c.description)}: Mevcut ${Number(c.currentStock) || 0}`];
            if (c.limit != null) parts.push(`Limit ${c.limit}`);
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

    const api = Object.freeze({
        WINDOWS,
        DEFAULT_WINDOW_DAYS,
        DEFAULT_SAFETY_DAYS,
        CRITICAL_DAYS,
        WARNING_DAYS,
        MAX_PURCHASE_ITEMS,
        cleanProductName,
        analyzeBurnRate,
        buildCriticalOrderCandidates,
        buildPurchasePrefillPayload,
    });

    if (typeof window !== 'undefined') {
        window.AppModules = window.AppModules || {};
        window.AppModules.BurnRate = api;
    }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})();
