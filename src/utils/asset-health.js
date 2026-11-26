// [WHY]: v3.8 · VP-1 — Operasyon Merkezi radarları (Aktif Zimmet & İade, Hurda & Servis) aynı hesaplama sözleşmesini
//        paylaşmalı: dashboard rozeti, radar penceresi ve testler tek kaynaktan beslenir. Hesaplama arayüze gömülü olursa
//        sayaçlar ile liste birbirinden ayrışır.
// [HOW]: Saf modül — Firebase ve DOM çağrısı yok (Anayasa §3 & §4). Girdi: AssignmentService.getAssignments() çıktısı ile
//        b1/b2/b3/serviceRecords dizileri; çıktı: sayılar + sıralı listeler.
//        Kronik cihaz = aynı cihaz kimliğinde (Seri No / Envanter No; ikisi de yoksa yalnız demirbaşta productId) en az 2 servis
//        kaydı. Aynı kayıtta birlikte geçen Seri No ve Envanter No aynı cihaz sayılır (birleştirme).
(function () {
    'use strict';

    const DAY_MS = 24 * 60 * 60 * 1000;
    const DUE_SOON_DAYS = 7;
    const CHRONIC_THRESHOLD = 2;

    function text(v) { return v == null ? '' : String(v).trim(); }
    function real(v) { const t = text(v); return t && t !== '-' ? t : ''; }
    function toList(x) { return Array.isArray(x) ? x : Object.values(x || {}); }
    function normId(v) { return real(v).replace(/\s+/g, '').toLocaleUpperCase('en-US'); }

    // 'yyyy-mm-dd' (tarih girişi) ya da 'gg.aa.yyyy [ss:dd]' (Türkiye saati metni). Yalnız tarih varsa günün sonu esas alınır.
    function parseDateMs(v) {
        if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : 0;
        const s = text(v);
        if (!s) return 0;
        let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}))?/);
        if (m) return stamp(+m[1], +m[2], +m[3], m[4], m[5]);
        m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
        if (m) return stamp(+m[3], +m[2], +m[1], m[4], m[5]);
        return 0;
    }
    function stamp(y, mo, d, hh, mm) {
        if (mo < 1 || mo > 12 || d < 1 || d > 31) return 0;
        const dt = hh == null ? new Date(y, mo - 1, d, 23, 59, 59, 999) : new Date(y, mo - 1, d, +hh, +mm, 0, 0);
        return dt.getMonth() === mo - 1 ? dt.getTime() : 0;   // 31.02 gibi taşan tarih geçersiz
    }

    // ─── Aktif zimmet ───
    function assignmentRow(a, dueMs, nowMs) {
        return {
            id: a._id != null ? a._id : a.id, source: a._source || '',
            personel: text(a.personel) || '-', personelId: a.personelId != null ? a.personelId : null,
            urun: text(a.urun || a['ürün']) || '-', sn: real(a.sn), envanterNo: real(a.envanterNo),
            talepTuru: text(a.talepTuru), iadeTarihi: text(a.iadeTarihi), dueMs,
            // Pozitif: iadeye kalan gün; negatif: gecikilen gün (yukarı yuvarlanır, bugünün sonu 0 sayılır)
            daysLeft: dueMs >= nowMs ? Math.floor((dueMs - nowMs) / DAY_MS) : -Math.ceil((nowMs - dueMs) / DAY_MS),
        };
    }

    /**
     * @param {Array} assignments AssignmentService.getAssignments() çıktısı
     * @param {number} nowMs
     * @returns {{active:number, awaitingDelivery:number, overdue:Array, dueSoon:Array, dueSoonDays:number}}
     */
    function summarizeActiveAssignments(assignments, nowMs) {
        const now = Number.isFinite(nowMs) ? nowMs : Date.now();
        const out = { active: 0, awaitingDelivery: 0, overdue: [], dueSoon: [], dueSoonDays: DUE_SOON_DAYS };
        (Array.isArray(assignments) ? assignments : []).forEach(a => {
            if (!a || a.iadeEdildi) return;
            if (!a.teslimAlindi) { out.awaitingDelivery++; return; }
            out.active++;
            const due = parseDateMs(a.iadeTarihi);
            if (!due) return;
            if (due < now) out.overdue.push(assignmentRow(a, due, now));
            else if (due - now <= DUE_SOON_DAYS * DAY_MS) out.dueSoon.push(assignmentRow(a, due, now));
        });
        out.overdue.sort((x, y) => x.dueMs - y.dueMs);   // en çok geciken önde
        out.dueSoon.sort((x, y) => x.dueMs - y.dueMs);   // en yakın tarih önde
        return out;
    }

    // ─── Servis & hurda ───
    function recordKeys(rec, isDemirbas) {
        const sns = text(rec && rec.sn).split(/[,;]/).map(normId).filter(Boolean).map(k => 'SN:' + k);
        const env = normId(rec && rec.envanterNo);
        const keys = sns.slice();
        if (env) keys.push('ENV:' + env);
        if (!keys.length && isDemirbas && real(rec && rec.productId)) keys.push('PID:' + text(rec.productId));
        return { keys, linkable: sns.length <= 1 };   // birden çok SN'li eski kayıt farklı cihazları birleştirmesin
    }

    function serviceTs(r) {
        const g = Array.isArray(r.gecmis) && r.gecmis[0] && Number(r.gecmis[0].ts);
        return Number(r.ts) || g || parseDateMs(r.sevkTarihi) || 0;
    }
    function isScrapService(r) { return /hurda/i.test(text(r.durum)); }

    /**
     * @param {Object|Array} b1
     * @param {Object|Array} b2
     * @param {Array} b3 B3 hareket defteri (tip:'hurda' kayıtları hurda döküdür)
     * @param {Array} serviceList window.data.serviceRecords (açık ve kapanmış)
     * @returns {{inService:Array, scrap:Array, chronic:Array, counts:{inService:number, scrap:number, chronic:number}}}
     */
    function analyzeServiceAndScrap(b1, b2, b3, serviceList) {
        const stock = new Map();
        [...toList(b1), ...toList(b2)].forEach(p => { if (p && p.id != null) stock.set(String(p.id), p); });
        const stockName = id => { const p = id != null ? stock.get(String(id)) : null; return p ? text(p.ürün || p.name || p.ad) : ''; };
        const stockType = id => { const p = id != null ? stock.get(String(id)) : null; return p ? text(p['tür'] || p.type || p.tur) : ''; };

        const services = toList(serviceList).filter(Boolean);

        // 1) Kimlik kümeleri (union-find): aynı kayıtta birlikte geçen SN ve Envanter No aynı cihazdır.
        const parent = new Map();
        const find = k => { let r = k; while (parent.get(r) !== r) r = parent.get(r); parent.set(k, r); return r; };
        const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(rb, ra); };
        const prepared = services.map(r => {
            const dem = r.isDemirbas === true || (r.originalData && r.originalData.isDemirbas === true);
            const rk = recordKeys(r, dem);
            rk.keys.forEach(k => { if (!parent.has(k)) parent.set(k, k); });
            if (rk.linkable) for (let i = 1; i < rk.keys.length; i++) union(rk.keys[0], rk.keys[i]);
            return { r, rk };
        });
        const groups = new Map();   // kök → kayıtlar
        prepared.forEach(({ r, rk }) => {
            new Set(rk.keys.map(find)).forEach(root => {
                if (!groups.has(root)) groups.set(root, []);
                groups.get(root).push(r);
            });
        });

        const chronic = [];
        const chronicRoots = new Set();
        groups.forEach((recs, root) => {
            if (recs.length < CHRONIC_THRESHOLD) return;
            chronicRoots.add(root);
            const sorted = recs.slice().sort((a, b) => serviceTs(b) - serviceTs(a));
            const last = sorted[0];
            const pick = f => real((sorted.find(x => real(x[f])) || {})[f]);
            const productId = real(last.productId);
            chronic.push({
                key: root, chronic: true, count: recs.length, openCount: recs.filter(x => x.kapandi !== true).length,
                urun: text(last.urunAciklama) || stockName(productId) || '-', sn: pick('sn'), envanterNo: pick('envanterNo'), productId,
                lastTs: serviceTs(last), lastTarih: text(last.sevkTarihi),
                records: sorted.map(x => ({ id: x.id, sevkTarihi: text(x.sevkTarihi), hedef: text(x.hedef), durum: text(x.durum), kapandi: x.kapandi === true })),
            });
        });
        chronic.sort((a, b) => b.count - a.count || b.lastTs - a.lastTs);

        // 2) Serviste olanlar (kapanmamış kayıtlar)
        const inService = prepared.filter(({ r }) => r.kapandi !== true).map(({ r, rk }) => {
            const roots = [...new Set(rk.keys.map(find))];
            const hit = roots.find(x => chronicRoots.has(x));
            return {
                id: r.id, urun: text(r.urunAciklama) || stockName(r.productId) || '-', tur: stockType(r.productId),
                sn: real(r.sn), envanterNo: real(r.envanterNo), productId: real(r.productId), hedef: text(r.hedef) || '-',
                durum: text(r.durum) || 'Serviste', sevkTarihi: text(r.sevkTarihi), ts: serviceTs(r),
                serviceCount: hit ? groups.get(hit).length : 1, chronic: !!hit,
            };
        }).sort((a, b) => b.ts - a.ts);

        // 3) Hurda dökümü: b3 tip:'hurda' esas; b3 ikizi olmayan "Hurdaya Ayrıldı" servis kayıtları tamamlayıcıdır.
        const scrap = [];
        const scrapKeys = new Set();
        const scrapPids = new Set();
        (Array.isArray(b3) ? b3 : toList(b3)).forEach(b => {
            if (!b || b.tip !== 'hurda') return;
            const rk = recordKeys(b, b.isDemirbas === true);
            rk.keys.forEach(k => scrapKeys.add(k));
            if (!rk.keys.length && real(b.productId)) scrapPids.add(text(b.productId));
            scrap.push({
                id: b.id, source: 'b3', urun: text(b.urunAciklama || b['ürün'] || b.productType) || stockName(b.productId) || '-',
                sn: real(b.sn), envanterNo: real(b.envanterNo), adet: Number(b.adet) || 1,
                tarih: text(b.tarih || b.date), ts: Number(b.ts) || parseDateMs(b.tarih), not: real(b.not),
            });
        });
        services.filter(isScrapService).forEach(r => {
            const rk = recordKeys(r, r.isDemirbas === true);
            if (rk.keys.length ? rk.keys.some(k => scrapKeys.has(k)) : scrapPids.has(text(r.productId))) return;
            scrap.push({
                id: r.id, source: 'service', urun: text(r.urunAciklama) || stockName(r.productId) || '-',
                sn: real(r.sn), envanterNo: real(r.envanterNo), adet: Number(r.adet) || 1,
                tarih: text(r.donusTarihi || r.sevkTarihi), ts: parseDateMs(r.donusTarihi) || serviceTs(r), not: real(r.not),
            });
        });
        scrap.sort((a, b) => b.ts - a.ts);

        return { inService, scrap, chronic, counts: { inService: inService.length, scrap: scrap.length, chronic: chronic.length } };
    }

    const api = { summarizeActiveAssignments, analyzeServiceAndScrap, parseDateMs, DUE_SOON_DAYS, CHRONIC_THRESHOLD };
    if (typeof window !== 'undefined') {
        window.AppModules = window.AppModules || {};
        window.AppModules.AssetHealth = api;
    }
})();
