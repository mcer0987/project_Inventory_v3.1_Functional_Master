// [WHY]: v3.7 İP-10 · Depo / çoklu raf sayım oturumu için saf fark motoru ve rapor veri projeksiyonu.
//        WMS arayüzü (shelf-matrix.js), PDF üretici (pdf-generator.js) ve Excel dışa aktarma tek kanonik
//        hesaplama sözleşmesini paylaşır; DOM veya Firebase bağımlılığı yoktur (Anayasa §3 & Sütun 4).
// [HOW]: window.Schema raf kurallarıyla uyumlu kanonik satır üretimi (adet 0 dahil), eksik/fazla/tam/bekleyen
//        durum hesaplaması, özet istatistik ve Türkçe tutanak veri projeksiyonu sağlar.
(function () {
    'use strict';

    const STATES = Object.freeze(['missing', 'excess', 'match', 'pending']);
    const STATE_LABELS = Object.freeze({
        missing: 'Eksik',
        excess: 'Fazla',
        match: 'Tam',
        pending: 'Bekleyen',
    });

    function text(value) {
        return value == null ? '' : String(value).trim();
    }

    function firstValue(...values) {
        return values.map(text).find(v => v && v !== '-') || '';
    }

    function normShelfCode(value) {
        if (typeof window !== 'undefined' && window.Schema && typeof window.Schema.normShelfCode === 'function') {
            return window.Schema.normShelfCode(value);
        }
        return text(value).replace(/\s+/g, ' ').toUpperCase();
    }

    function itemShelfCode(item) {
        if (typeof window !== 'undefined' && window.Schema && typeof window.Schema.itemShelfCode === 'function') {
            return window.Schema.itemShelfCode(item);
        }
        if (!item || typeof item !== 'object') return '';
        return normShelfCode(item.raf ?? item.shelf ?? item.rafNo ?? '');
    }

    function parseSystemQty(itemOrQty) {
        const raw = (itemOrQty && typeof itemOrQty === 'object')
            ? (itemOrQty.adet ?? itemOrQty.qty ?? itemOrQty.quantity ?? 0)
            : itemOrQty;
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0) return 0;
        return Math.trunc(n);
    }

    function cleanNote(value) {
        const s = text(value).replace(/\r?\n/g, ' ').slice(0, 200);
        if (/<[a-zA-Z/!?]/.test(s)) throw new Error('Sayım notu HTML etiketi içeremez.');
        return s;
    }

    // [WHY]: Sistem adedi ile fiziksel sayılan adet arasındaki farkı ve durumu tek noktadan hesaplar.
    // [HOW]: Sayılan değer boş/null ise pending; negatif veya tam sayı değilse hata; aksi halde missing/excess/match döner.
    function computeVariance(systemQty, countedQty) {
        const sys = parseSystemQty(systemQty);
        if (countedQty === null || countedQty === undefined || text(countedQty) === '') {
            return { systemQty: sys, countedQty: null, diff: null, state: 'pending' };
        }
        const num = Number(countedQty);
        if (!Number.isFinite(num) || !Number.isInteger(num) || num < 0) {
            throw new Error('Sayılan adet 0 veya daha büyük bir tam sayı olmalıdır.');
        }
        const diff = num - sys;
        const state = diff < 0 ? 'missing' : diff > 0 ? 'excess' : 'match';
        return { systemQty: sys, countedQty: num, diff, state };
    }

    // [WHY]: Seçili raf(lar)daki veya tüm depodaki rafa bağlı ürünleri (adet 0 / pasif dahil) mutasyonsuz sayım satırlarına çevirir.
    // [HOW]: depotRows dizisini değiştirmez; shelfCodes null/'ALL' ise rafa bağlı tüm kayıtları, dizi/Set ise yalnız eşleşen rafları alır.
    function buildCountRows(depotRows, shelfCodes = 'ALL', opts = {}) {
        const rows = Array.isArray(depotRows) ? depotRows : [];
        let allowed = null;
        if (shelfCodes !== 'ALL' && shelfCodes !== null && shelfCodes !== undefined) {
            const list = shelfCodes instanceof Set ? [...shelfCodes] : (Array.isArray(shelfCodes) ? shelfCodes : [shelfCodes]);
            allowed = new Set(list.map(normShelfCode).filter(Boolean));
            if (allowed.size === 0) return [];
        }
        const countedMap = opts && opts.countedMap ? opts.countedMap : null;
        const readEntry = id => {
            if (!countedMap) return null;
            if (countedMap instanceof Map) return countedMap.get(id) ?? null;
            return Object.prototype.hasOwnProperty.call(countedMap, id) ? countedMap[id] : null;
        };

        const out = [];
        for (const item of rows) {
            if (!item || typeof item !== 'object') continue;
            const shelfCode = itemShelfCode(item);
            if (!shelfCode) continue;
            if (allowed && !allowed.has(shelfCode)) continue;

            const id = text(item.id);
            const systemQty = parseSystemQty(item);
            const entry = id ? readEntry(id) : null;
            const rawCounted = entry && typeof entry === 'object' && 'countedQty' in entry ? entry.countedQty : entry;
            const variance = computeVariance(systemQty, rawCounted);
            const note = entry && typeof entry === 'object' && entry.note ? cleanNote(entry.note) : '';

            out.push({
                id,
                shelfCode,
                name: firstValue(item.ürün, item.urun, item.name, item.ad, item.productName) || 'Adsız ürün',
                type: firstValue(item.tür, item.tur, item.type, item.urunTuru, item.productType) || 'Diğer',
                brand: firstValue(item.marka, item.brand),
                serialNo: firstValue(item.seriNo, item.serialNo, item.seri, item.sn),
                barcode: firstValue(item.barkod, item.barcode, item.urunKodu, item.productCode),
                envanterNo: firstValue(item.envanterNo),
                status: firstValue(item.durumu, item.status) || '-',
                systemQty: variance.systemQty,
                countedQty: variance.countedQty,
                diff: variance.diff,
                state: variance.state,
                note,
                isLocked: item.rafPasif === true,
            });
        }

        const cmp = (a, b) => String(a).localeCompare(String(b), 'tr', { numeric: true, sensitivity: 'base' });
        out.sort((a, b) => cmp(a.shelfCode, b.shelfCode) || cmp(a.name, b.name) || cmp(a.id, b.id));
        return out;
    }

    // [WHY]: Fark Masası KPI şeridi ve PDF/Excel özet bloğu için tutarlı sayısal özet üretir.
    // [HOW]: Eksik/fazla/tam/bekleyen satır sayılarını, toplam adetleri ve net farkı tek geçişte hesaplar.
    function summarizeVariances(rows) {
        const list = Array.isArray(rows) ? rows : [];
        let total = 0, counted = 0, pending = 0, missing = 0, excess = 0, match = 0;
        let systemTotalQty = 0, countedTotalQty = 0, missingQty = 0, excessQty = 0;

        for (const r of list) {
            if (!r || typeof r !== 'object') continue;
            const v = computeVariance(r.systemQty, r.countedQty);
            total += 1;
            systemTotalQty += v.systemQty;
            if (v.state === 'pending') {
                pending += 1;
            } else {
                counted += 1;
                countedTotalQty += v.countedQty;
                if (v.state === 'missing') {
                    missing += 1;
                    missingQty += Math.abs(v.diff);
                } else if (v.state === 'excess') {
                    excess += 1;
                    excessQty += v.diff;
                } else {
                    match += 1;
                }
            }
        }

        return {
            total,
            counted,
            pending,
            missing,
            excess,
            match,
            systemTotalQty,
            countedTotalQty,
            missingQty,
            excessQty,
            netDiff: excessQty - missingQty,
        };
    }

    function formatDiff(diff) {
        if (diff === null || diff === undefined) return '-';
        if (diff > 0) return `+${diff}`;
        return String(diff);
    }

    // [WHY]: Resmi PDF tutanağı ve Excel fark raporu için ortak, saf veri sözleşmesi üretir.
    // [HOW]: Üst bilgi (belge), sayısal özet (ozet), numaralı PDF satırları (kalemler) ve SheetJS satırları (excelRows) döner.
    function buildCountReportData(meta = {}, rows = []) {
        const depot = text(meta.depot).toLowerCase() === 'b2' ? 'b2' : 'b1';
        const depotName = text(meta.depotName) || (depot === 'b2' ? 'B2 Demirbaş Deposu' : 'B1 Sarf Deposu');
        const list = Array.isArray(rows) ? rows : [];
        const ozet = summarizeVariances(list);
        const shelfSet = new Set(
            (Array.isArray(meta.shelves) && meta.shelves.length ? meta.shelves : list.map(r => r && r.shelfCode))
                .map(normShelfCode)
                .filter(Boolean)
        );
        const raflar = [...shelfSet].sort((a, b) => a.localeCompare(b, 'tr', { numeric: true, sensitivity: 'base' }));
        const now = meta.date ? new Date(meta.date) : new Date();
        const tarih = Number.isNaN(now.getTime())
            ? text(meta.date) || '-'
            : now.toLocaleString('tr-TR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
        const stamp = Number.isNaN(now.getTime()) ? '00000000' : now.toISOString().slice(0, 10).replace(/-/g, '');
        const raporNo = text(meta.reportNo) || `SYM-${depot.toUpperCase()}-${stamp}`;

        const kalemler = list.map((r, idx) => {
            const v = computeVariance(r.systemQty, r.countedQty);
            const durumLabel = STATE_LABELS[v.state] || 'Bekleyen';
            return {
                sira: idx + 1,
                id: text(r.id),
                raf: normShelfCode(r.shelfCode) || '-',
                urun: text(r.name) || 'Adsız ürün',
                tur: text(r.type) || '-',
                envanterNo: text(r.envanterNo) || '-',
                seriNo: text(r.serialNo) || '-',
                barkod: text(r.barcode) || '-',
                sistemAdet: v.systemQty,
                sayilanAdet: v.countedQty,
                sayilanLabel: v.countedQty === null ? '-' : String(v.countedQty),
                fark: v.diff,
                farkLabel: formatDiff(v.diff),
                durum: v.state,
                durumLabel,
                not: r.note ? cleanNote(r.note) : '',
            };
        });

        const excelRows = kalemler.map(k => ({
            'Sıra': k.sira,
            'Raf': k.raf,
            'Ürün Adı': k.urun,
            'Tür': k.tur,
            'Envanter No': k.envanterNo,
            'Seri No': k.seriNo,
            'Sistem Adedi': k.sistemAdet,
            'Sayılan Adet': k.sayilanAdet === null ? '' : k.sayilanAdet,
            'Fark': k.fark === null ? '' : k.fark,
            'Durum': k.durumLabel,
            'Not': k.not,
        }));

        return {
            belge: {
                raporNo,
                tarih,
                depo: depot,
                depoAdi: depotName,
                duzenleyen: text(meta.createdBy) || 'Sistem Yöneticisi',
                gerekce: text(meta.reason) || 'Depo stok sayımı',
                raflar,
            },
            ozet,
            kalemler,
            excelRows,
        };
    }

    const api = Object.freeze({
        STATES,
        STATE_LABELS,
        computeVariance,
        buildCountRows,
        summarizeVariances,
        buildCountReportData,
    });

    if (typeof window !== 'undefined') {
        window.AppModules = window.AppModules || {};
        window.AppModules.ShelfCount = api;
    }
})();
