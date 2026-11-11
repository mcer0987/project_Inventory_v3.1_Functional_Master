/**
 * utils/inventory-no-rename.js — v3.6 · Envanter No değişimi: arama, değişim planı, çakışma denetimi, eski numara zinciri.
 * Klasik script (window.AppModules.InventoryNoRename); saf: Firestore'a dokunmaz, veri parametreyle gelir (node:vm ile test edilir).
 *
 * [WHY]: Envanter No cihazın kimliğidir (Global-Architecture Sütun 1). Numara ürün formundan değiştirilemez; değişim yöneticinin
 *        Operasyon Merkezi aracında, cihazın ŞU ANKİ kaydı üzerinde ve denetim kaydıyla yapılır. Geçmiş hareket kayıtları ve
 *        basılmış tutanaklar eski numarayla kalır; cihaz geçmişi eski → yeni zinciriyle bütün görünür.
 * [HOW]: findMatches cihazın bulunduğu yeri bulur: depo satırı, açık servis kaydı, aktif zimmet (b3 + varsa assignments ikizi),
 *        hurda kaydı. Zimmet/servis/hurda kaydının productId ile bağlı, aynı numarayı taşıyan depo satırı (adet 0 kalmış) aynı
 *        cihazın parçasıdır ve onunla birlikte değişir. planRename yazılacak alanları ve transaction ön koşullarını üretir.
 */
(function () {
    'use strict';

    const AUDIT_TYPE = 'envanter-no-degisim';
    const MAX_LEN = 64;
    const KIND_LABEL = Object.freeze({ depo: 'Depoda', servis: 'Serviste', zimmet: 'Zimmette', hurda: 'Hurda' });

    function S() {
        const s = window.Schema;
        if (!s || typeof s.normDeviceId !== 'function') throw new Error('Şema modülü (schema.js) yüklenmemiş.');
        return s;
    }
    // '-' ve boş "numara yok" demektir.
    function key(v) {
        const k = S().normDeviceId(v);
        return k === '-' ? '' : k;
    }
    const list = v => (Array.isArray(v) ? v : (v && typeof v === 'object' ? Object.values(v) : []));
    const text = v => (v === undefined || v === null ? '' : String(v).trim());
    const refOf = (col, id) => `${col}/${id}`;

    function productInfo(row) {
        if (!row) return {};
        return { name: text(row.ürün || row.name), brand: text(row.marka), type: text(row.tür || row.type), shelf: text(row.raf),
            column: text(row.sütun), qty: Number(row.adet ?? row.qty ?? 0) || 0, status: text(row.durumu || row.status),
            note: text(row.açıklama), sn: text(row.sn) };
    }

    /**
     * Numarayı arar. data: {b1, b2, b3, assignments, serviceRecords, returnRequests}. Dönüş:
     * { key, matches:[{kind, col, id, label, record, stock:{col,id,record}|null, targets:[{col,id}], editable, reason?, product}],
     *   history:[{col, id, label}], pendingReturns:[{id, label}] }
     */
    function findMatches(data, query) {
        const k = key(query);
        const out = { key: k, matches: [], history: [], pendingReturns: [] };
        if (!k) return out;
        const d = data || {};
        const stockRows = [];
        ['b1', 'b2'].forEach(col => list(d[col]).forEach(row => {
            if (row && key(row.envanterNo) === k) stockRows.push({ col, id: String(row.id), record: row });
        }));
        const linked = new Set();
        const stockFor = rec => {
            const col = rec && rec.kaynakDepo;
            if (!['b1', 'b2'].includes(col) || rec.productId === undefined || rec.productId === null || rec.productId === '') return null;
            const hit = stockRows.find(s => s.col === col && s.id === String(rec.productId));
            if (hit) linked.add(refOf(hit.col, hit.id));
            return hit || null;
        };
        const assignments = new Map(list(d.assignments).filter(Boolean).map(a => [String(a.id), a]));
        const b3Ids = new Set();

        list(d.b3).forEach(rec => {
            if (!rec || key(rec.envanterNo) !== k) return;
            const id = String(rec.id);
            b3Ids.add(id);
            const n = S().normalizeB3(rec) || {};
            const name = text(rec.urunAciklama) || text(n.urunAciklama);
            if (n.tip === 'zimmet' && !n.iadeEdildi) {
                const stock = stockFor(rec);
                const targets = [{ col: 'b3', id }];
                if (assignments.has(id)) targets.push({ col: 'assignments', id });
                if (stock) targets.push({ col: stock.col, id: stock.id });
                out.matches.push({ kind: 'zimmet', col: 'b3', id, label: `${KIND_LABEL.zimmet} · ${text(rec.alanKisi) || 'kişi belirtilmemiş'}`,
                    record: rec, stock, targets, editable: true, product: { ...productInfo(stock && stock.record), name: name || productInfo(stock && stock.record).name, sn: text(rec.sn) } });
            } else if (n.tip === 'hurda') {
                const stock = stockFor(rec);
                const targets = [{ col: 'b3', id }];
                if (stock) targets.push({ col: stock.col, id: stock.id });
                out.matches.push({ kind: 'hurda', col: 'b3', id, label: `${KIND_LABEL.hurda} · ${text(rec.tarih) || '-'}`,
                    record: rec, stock, targets, editable: true, product: { ...productInfo(stock && stock.record), name: name || productInfo(stock && stock.record).name, sn: text(rec.sn) } });
            } else {
                out.history.push({ col: 'b3', id, label: `${n.tip === 'zimmet' ? 'İade edilmiş zimmet' : 'Envanter çıkışı'} · ${text(rec.alanKisi) || '-'} · ${text(rec.tarih) || '-'}` });
            }
        });

        // b3 ikizi olmayan eski zimmet kayıtları: elle değiştirilemez (kaynak kayıt yapısı farklı) — yalnız gösterilir.
        assignments.forEach((a, id) => {
            if (b3Ids.has(id) || key(a.envanterNo) !== k) return;
            if (a.iadeEdildi === true || a.iadeEdildi === 'true') {
                out.history.push({ col: 'assignments', id, label: `İade edilmiş eski zimmet · ${text(a.personel) || '-'}` });
                return;
            }
            out.matches.push({ kind: 'zimmet', col: 'assignments', id, label: `${KIND_LABEL.zimmet} · ${text(a.personel) || '-'} (eski kayıt)`,
                record: a, stock: null, targets: [], editable: false,
                reason: 'Bu zimmet eski biçimli bir kayıttan geliyor; numarası bu araçla değiştirilemez. Önce iade alın ya da yöneticiye bildirin.',
                product: { name: text(a.ürün || a.urun) } });
        });

        list(d.serviceRecords).forEach(rec => {
            if (!rec) return;
            const own = key(rec.envanterNo) === k;
            const snapshot = rec.originalData && typeof rec.originalData === 'object' && key(rec.originalData.envanterNo) === k;
            if (!own && !snapshot) return;
            const id = String(rec.id);
            if (rec.kapandi === true) {
                out.history.push({ col: 'serviceRecords', id, label: `Kapanmış servis kaydı · ${text(rec.hedef) || '-'} · ${text(rec.sevkTarihi) || '-'}` });
                return;
            }
            const stock = stockFor(rec);
            const targets = [{ col: 'serviceRecords', id }];
            if (stock) targets.push({ col: stock.col, id: stock.id });
            const base = productInfo(stock ? stock.record : rec.originalData);
            out.matches.push({ kind: 'servis', col: 'serviceRecords', id, label: `${KIND_LABEL.servis} · ${text(rec.hedef) || '-'} (${text(rec.durum) || '-'})`,
                record: rec, stock, targets, editable: true, product: { ...base, name: text(rec.urunAciklama) || base.name, sn: text(rec.sn) || base.sn } });
        });

        stockRows.filter(s => !linked.has(refOf(s.col, s.id))).forEach(s => {
            const info = productInfo(s.record);
            out.matches.push({ kind: 'depo', col: s.col, id: s.id, label: `${KIND_LABEL.depo} · ${s.col.toUpperCase()} · Raf ${info.shelf || '—'} · ${info.qty} adet`,
                record: s.record, stock: s, targets: [{ col: s.col, id: s.id }], editable: true, product: info });
        });

        list(d.returnRequests).forEach(r => {
            if (r && key(r.envanterNo) === k && !['approved', 'rejected', 'cancelled', 'onaylandi', 'reddedildi'].includes(String(r.status || r.durum || '').toLowerCase())) {
                out.pendingReturns.push({ id: String(r.id), label: `Bekleyen iade talebi · ${text(r.personel) || '-'}` });
            }
        });
        return out;
    }

    /**
     * Yeni numaranın kullanılabilirliği. Cihazın şu an bulunduğu bir kayıtta (depo, açık servis, aktif zimmet, hurda) varsa
     * ENGEL; yalnız geçmiş kayıtlarda görülüyorsa UYARI (eski bir cihazın numarası olabilir).
     */
    function checkNewNumber(data, newNo, currentKey) {
        const raw = text(newNo);
        const k = key(raw);
        if (!k) return { ok: false, blockers: ['Yeni Envanter No boş olamaz.'], warnings: [] };
        if (raw.length > MAX_LEN) return { ok: false, blockers: [`Envanter No en fazla ${MAX_LEN} karakter olabilir.`], warnings: [] };
        if (/[<>]/.test(raw)) return { ok: false, blockers: ['Envanter No "<" ya da ">" içeremez.'], warnings: [] };
        if (currentKey && k === currentKey) return { ok: false, blockers: ['Yeni numara mevcut numarayla aynı.'], warnings: [] };
        const found = findMatches(data, raw);
        const blockers = found.matches.map(m => `"${raw}" şu an kullanımda: ${m.label}${m.product && m.product.name ? ` (${m.product.name})` : ''}.`);
        const warnings = found.history.map(h => `"${raw}" geçmiş bir kayıtta görülüyor: ${h.label}.`);
        return { ok: blockers.length === 0, blockers, warnings, key: k };
    }

    /**
     * Değişim planı. match: findMatches'tan seçilen kayıt; records: {"col/id": TAZE belge} (transaction'da yeniden okunmuş ya da
     * önizlemede canlı veri). Dönüş: { writes:[{col,id,data}], fromValue, toValue, audit } — ön koşul ihlalinde Error.
     */
    function planRename(match, newNo, { records = {}, auditId, reason = '', now = Date.now() } = {}) {
        if (!match || !match.editable) throw new Error((match && match.reason) || 'Bu kayıt için numara değiştirilemez.');
        const toValue = text(newNo);
        const k = key(toValue);
        if (!k) throw new Error('Yeni Envanter No boş olamaz.');
        if (toValue.length > MAX_LEN) throw new Error(`Envanter No en fazla ${MAX_LEN} karakter olabilir.`);
        if (/[<>]/.test(toValue)) throw new Error('Envanter No "<" ya da ">" içeremez.');
        const rec = match.record || {};
        const oldKey = key(rec.envanterNo) || key((rec.originalData || {}).envanterNo);
        if (k === oldKey) throw new Error('Yeni numara mevcut numarayla aynı.');
        const stockTargets = match.targets.filter(t => t.col === 'b1' || t.col === 'b2');
        if (stockTargets.length > 1) throw new Error('Aynı numarayı taşıyan birden fazla depo kaydı var; önce mükerrer kaydı düzeltin.');
        if (stockTargets.length && !auditId) throw new Error('Denetim kaydı kimliği gerekli.');

        let fromValue = null;
        const writes = match.targets.map(t => {
            const doc = records[refOf(t.col, t.id)];
            if (!doc) throw new Error(`Kayıt bulunamadı (${t.col}/${t.id}); aramayı yenileyin.`);
            const data = {};
            if (key(doc.envanterNo) === oldKey) data.envanterNo = toValue;
            if (t.col === 'serviceRecords' && doc.originalData && typeof doc.originalData === 'object' && key(doc.originalData.envanterNo) === oldKey) {
                data.originalData = { ...doc.originalData, envanterNo: toValue };   // tam harita: nokta yolu kullanılmaz
            }
            if (!Object.keys(data).length) throw new Error(`Kayıttaki numara bu arada değişmiş (${t.col}/${t.id}); aramayı yenileyin.`);
            if (t.col === 'b1' || t.col === 'b2') {
                fromValue = doc.envanterNo;   // kurallar kanıttaki eski değeri depo satırının HAM değeriyle karşılaştırır
                data.sonEnvanterNoDegisimId = auditId;
                data.lastUpdate = now;
            }
            if (fromValue === null) {
                const raw = [doc.envanterNo, (doc.originalData || {}).envanterNo].find(v => typeof v === 'string' && key(v) === oldKey);
                if (raw !== undefined) fromValue = raw;
            }
            return { col: t.col, id: t.id, data };
        });
        if (fromValue === null) throw new Error('Kayıttaki eski numara okunamadı; aramayı yenileyin.');
        const audit = {
            type: AUDIT_TYPE, refCol: match.col, refId: match.id, item: (match.product && match.product.name) || '',
            fromValue: String(fromValue), toValue, reason: text(reason) || 'Envanter No değişimi',
        };
        return { writes, fromValue: String(fromValue), toValue, audit };
    }

    // ─── Eski numara zinciri (cihaz geçmişi) ─────────────────────────────────────────────────────────────────────────
    let aliasPairs = [];
    function setAliasPairs(pairs) {
        aliasPairs = list(pairs).map(p => ({ from: key(p && p.from), to: key(p && p.to) })).filter(p => p.from && p.to);
    }
    function addAliasPair(from, to) { setAliasPairs([...aliasPairs, { from, to }]); }
    // Numaranın değişim zincirindeki tüm numaralar (kendisi hariç; iki yönde).
    function aliasesOf(identity, pairs = aliasPairs) {
        const start = key(identity);
        if (!start) return [];
        const seen = new Set([start]);
        const queue = [start];
        while (queue.length) {
            const cur = queue.shift();
            list(pairs).forEach(p => {
                const a = key(p.from), b = key(p.to);
                if (a === cur && b && !seen.has(b)) { seen.add(b); queue.push(b); }
                if (b === cur && a && !seen.has(a)) { seen.add(a); queue.push(a); }
            });
        }
        seen.delete(start);
        return [...seen];
    }

    window.AppModules = window.AppModules || {};
    window.AppModules.InventoryNoRename = Object.freeze({
        AUDIT_TYPE, MAX_LEN, KIND_LABEL, key, findMatches, checkNewNumber, planRename, setAliasPairs, addAliasPair, aliasesOf,
    });
})();
