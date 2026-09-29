/**
 * services/assignment-service.js — Zimmet servisi (Faz 3.7 · ITSM-04, ITSM-06)
 * Klasik script; iki sayfada <head>'de schema.js'ten hemen sonra yüklenir. window.data'yı çağrı anında okur.
 *
 * [WHY]: Personelin "Kişi Envanterim" ekranı yalnız teslim alınmış talepleri tarıyordu; admin'in "Zimmet Yap" ile doğrudan
 *        verdiği zimmetler (b3 + assignments) hiç görünmüyordu, iade edilenler de listeden düşmüyordu. Zimmet listesini
 *        yalnız admin'deki inventory-management.js kuruyordu; iki ekran farklı kaynaklardan farklı kurallarla okuyordu.
 *        Kişi eşleşmesi adın küçük harfli haliyle yapılıyordu (Türkçe İ/ı ve boşluk farkı eşleşmeyi bozar; aynı adlı iki kişi
 *        birbirinin zimmetini görür).
 * [HOW]: Tek kaynak: getAssignments() — b3'teki zimmet hareketleri (kanonik görünüm, tip 'zimmet') + b3 ikizi olmayan eski
 *        onaylı/teslim alınmış talepler. Kişi eşleşmesi matchesPerson(): önce personelId, eski taleplerde personel kodu,
 *        en son Türkçe güvenli ad karşılaştırması (Schema.normName). Kişi Envanterim = kişinin aktif (iade edilmemiş) ve
 *        teslim alınmış zimmetleri; admin Zimmet ekranı aynı listenin tamamını gösterir.
 */
(function () {
    const S = () => window.Schema;

    function personList() { return (window.data && window.data.personel) || []; }

    // Ada göre TEK eşleşen personelin id'si (eski kayıtlarda / talepte id yoksa); birden fazla eşleşme → null (tahmin yok).
    function resolvePersonelId(name) {
        const n = S().normName(name);
        if (!n) return null;
        const hits = personList().filter(p => p && S().normName(p.name || p.adSoyad) === n);
        return hits.length === 1 && hits[0].id != null ? String(hits[0].id) : null;
    }

    // Kaydın (zimmet, talep) kullanıcıya ait olup olmadığı. rec: { personel, personelId?, personelKodu? }
    function matchesPerson(rec, user) {
        if (!rec || !user) return false;
        if (rec.personelId != null && rec.personelId !== '' && user.id != null) return String(rec.personelId) === String(user.id);
        if (rec.personelKodu && user.code) return String(rec.personelKodu) === String(user.code);   // eski talepler
        const a = S().normName(rec.personel);
        return a !== '' && a === S().normName(user.name);
    }

    function getAssignments() {
        const data = window.data || {};
        const requests = data.requests || [];
        const reqById = new Map(requests.map(r => [String(r.id), r]));
        const twins = new Set((data.b3 || []).filter(b => b && b.requestId != null).map(b => String(b.requestId)));
        const list = [];

        // 1) b3 zimmet hareketleri (admin doğrudan zimmeti + talep onayının zimmet kaydı)
        (data.b3 || []).forEach(item => {
            const n = S().normalizeB3(item);
            if (!n || n.tip !== 'zimmet' || n.alanKisi === '-') return;
            const req = n.requestId != null ? reqById.get(String(n.requestId)) : null;
            list.push({
                _source: 'b3', _id: item.id, id: item.id,
                personel: n.alanKisi,
                personelId: n.personelId || (req && req.personelId) || null,
                personelKodu: req ? req.personelKodu : undefined,
                urun: n.urunAciklama, urunTuru: n.urunTuru, marka: n.marka,
                adet: n.adet || 1, sn: n.sn, envanterNo: n.envanterNo,
                tarih: n.tarih, teslimTarihi: (req && req.teslimTarihi) || n.tarih,
                not: n.not, talepTuru: n.talepTuru, oncelik: n.oncelik,
                iadeTarihi: n.iadeTarihi, iadeEdildi: n.iadeEdildi, iadeEdildiTarihi: n.iadeEdildiTarihi,
                // talep kaynaklı zimmet: personel "Teslim Aldım" demeden Kişi Envanterim'e düşmez (eski davranış korunur)
                teslimAlindi: req ? S().requestStatus(req) === 'completed' : true,
                depo: n.stokDisi ? null : n.kaynakDepo, productId: n.productId, requestId: n.requestId,
                isDemirbas: n.isDemirbas, ts: n.ts, rawRef: item,
            });
        });

        // 2) b3 ikizi olmayan eski onaylı / teslim alınmış talepler (onay b3 yazmadan önceki kayıtlar)
        requests.forEach(r => {
            if (!r || twins.has(String(r.id))) return;
            const st = S().requestStatus(r);
            if (st !== 'approved' && st !== 'completed') return;
            const n = S().normalizeRequest(r);
            list.push({
                _source: 'request', _id: r.id, id: r.id,
                personel: n.personel, personelId: n.personelId, personelKodu: r.personelKodu,
                urun: n.urun, urunTuru: '-', marka: '',
                adet: n.adet, sn: n.sn, envanterNo: n.envanterNo,
                tarih: n.tarih, teslimTarihi: n.teslimTarihi || n.tarih,
                not: n.not, talepTuru: n.talepTuru, oncelik: n.oncelik,
                iadeTarihi: n.iadeTarihi, iadeEdildi: n.iadeEdildi, iadeEdildiTarihi: n.iadeEdildiTarihi,
                teslimAlindi: st === 'completed',
                depo: null, productId: null, requestId: r.id,
                isDemirbas: n.isDemirbas === true, ts: n.ts, rawRef: r,
            });
        });

        return list.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    }

    // Kişi Envanterim: kullanıcının üzerindeki (iade edilmemiş, teslim alınmış) zimmetler.
    function getPersonInventory(user) {
        if (!user) return [];
        return getAssignments().filter(a => !a.iadeEdildi && a.teslimAlindi && matchesPerson(a, user));
    }

    // Ham talep kaydı kullanıcıya mı ait (Taleplerim, talep işlemleri).
    function isMyRequest(r, user) {
        return !!r && matchesPerson({ personel: r.personel, personelId: r.personelId, personelKodu: r.personelKodu }, user);
    }

    // 3.9a: şu an kullanımda olan cihaz kimlikleri — iade edilmemiş zimmetler ve kapanmamış servis/sevk kayıtları.
    // Anahtar Schema.deviceKeys biçiminde ('SN:…' / 'ENV:…'); değer kısa açıklama (hata mesajında gösterilir).
    function isOpenService(r) { return !!r && r.kapandi !== true; }
    function activeDeviceUses() {
        const uses = new Map();
        getAssignments().filter(a => !a.iadeEdildi).forEach(a => S().deviceKeys(a).forEach(k => {
            if (!uses.has(k)) uses.set(k, { kind: 'zimmet', id: a._id, text: `${a.personel} üzerinde zimmetli (${a.urun})` });
        }));
        ((window.data && window.data.serviceRecords) || []).filter(isOpenService).forEach(r => S().deviceKeys(r).forEach(k => {
            if (!uses.has(k)) uses.set(k, { kind: 'servis', id: r.id, text: `serviste / sevkte (${r.hedef || '-'})` });
        }));
        return uses;
    }
    function checkDeviceIds({ demirbas, qty, ids, label }) {
        return S().validateDeviceIds({ demirbas, qty, ids, label, activeUses: demirbas ? activeDeviceUses() : new Map() });
    }

    // ─── 3.9c · Cihaz bazlı birleşik geçmiş ───
    // [WHY]: "Cihaz Geçmişi" yalnız SN ile zimmet/çıkış kayıtlarını tarıyordu; servis kaydı dönüşte silindiği için aynı cihaz
    //        yeniden servise gönderildiğinde önceki servisler hiçbir yerde görünmüyordu.
    // [HOW]: Kimlik (Seri No veya Envanter No) → b3 hareketleri (zimmet, iade, çıkış) + b3 ikizi olmayan eski talep/assignments
    //        kayıtları + servis/sevk kayıtları (sevk, tarihli durum geçmişi, depoya dönüş). Servis kayıtları artık silinmez.
    const tsOfText = t => { const m = String(t || '').match(/(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/); return m ? new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0)).getTime() : 0; };
    function keysFor(identity) {
        const k = S().normDeviceId(identity);
        return k ? ['SN:' + k, 'ENV:' + k] : [];
    }
    const hits = (rec, keys) => S().deviceKeys(rec).some(k => keys.includes(k));

    function serviceRecordsFor({ productId, ids = [], identity } = {}) {
        const keys = identity ? keysFor(identity) : ids.flatMap(d => S().deviceKeys(d));
        return ((window.data && window.data.serviceRecords) || []).filter(r => r && (
            (keys.length && hits(r, keys)) ||
            (productId != null && productId !== '' && (String(r.productId ?? r.originalData?.id ?? '') === String(productId)))
        )).sort((a, b) => (S().idToTs(b.id) || tsOfText(b.sevkTarihi)) - (S().idToTs(a.id) || tsOfText(a.sevkTarihi)));
    }

    function getDeviceHistory(identity) {
        const keys = keysFor(identity);
        if (!keys.length) return [];
        const data = window.data || {};
        const events = [];
        const b3Ids = new Set((data.b3 || []).map(b => String(b.id)));
        const twins = new Set((data.b3 || []).filter(b => b && b.requestId != null).map(b => String(b.requestId)));
        (data.b3 || []).forEach(b => {
            const n = S().normalizeB3(b);
            if (!n || !hits(n, keys)) return;
            const zimmet = n.tip === 'zimmet';
            events.push({ ts: n.ts || tsOfText(n.tarih), tarih: n.tarih, tur: zimmet ? '📌 Zimmet' : '📤 Envanter çıkışı', kisi: n.alanKisi, urun: n.urunAciklama, yer: n.stokDisi ? 'Stok dışı' : (n.kaynakDepo || '-').toUpperCase(), not: n.not });
            if (zimmet && n.iadeEdildi) events.push({ ts: (tsOfText(n.iadeEdildiTarihi) || n.ts) + 1, tarih: n.iadeEdildiTarihi || '-', tur: '✅ İade', kisi: n.alanKisi, urun: n.urunAciklama, yer: n.iadeDepo ? String(n.iadeDepo).toUpperCase() : 'Depoya iade edilmedi', not: '-' });
        });
        (data.assignments || []).forEach(a => {
            if (!a || b3Ids.has(String(a.id)) || !hits(a, keys)) return;   // b3 ikizi olanlar yukarıda
            events.push({ ts: S().idToTs(a.id) || tsOfText(a.tarih), tarih: a.tarih || '-', tur: a.iadeEdildi ? '✅ Zimmet (iade edildi)' : '📌 Zimmet', kisi: a.personel || '-', urun: a.ürün || '-', yer: '-', not: a.not || '-' });
        });
        (data.requests || []).forEach(r => {
            if (!r || twins.has(String(r.id)) || !hits(r, keys)) return;
            events.push({ ts: S().idToTs(r.id) || tsOfText(r.tarih), tarih: r.tarih || '-', tur: r.iadeEdildi ? '✅ Talep zimmeti (iade edildi)' : '📋 Talep zimmeti', kisi: r.personel || '-', urun: r.ürün || '-', yer: '-', not: r.not || '-' });
        });
        serviceRecordsFor({ identity }).forEach(r => {
            const urun = r.urunAciklama || r.originalData?.ürün || '-';
            const log = Array.isArray(r.gecmis) ? r.gecmis : [];
            const t0 = S().idToTs(r.id) || tsOfText(r.sevkTarihi);
            events.push({ ts: t0, tarih: r.sevkTarihi || '-', tur: r.hedefTip === 'external' ? '🚚 Dış birime sevk' : '🛠️ Servise sevk', kisi: '-', urun, yer: r.hedef || '-', not: (log[0] && log[0].not) || r.not || '-' });
            log.slice(1).forEach((g, i) => events.push({ ts: Number(g.ts) || t0 + i + 1, tarih: g.tarih || '-', tur: g.durum === 'Depoya Döndü' ? '🏠 Depoya döndü' : `🔄 Servis durumu: ${g.durum || '-'}`, kisi: g.yapan || '-', urun, yer: r.hedef || '-', not: g.not || '-' }));
            if (!log.length && r.kapandi) events.push({ ts: tsOfText(r.donusTarihi) || t0 + 1, tarih: r.donusTarihi || '-', tur: '🏠 Depoya döndü', kisi: '-', urun, yer: (r.donusDepo || '-').toUpperCase(), not: '-' });
        });
        return events.sort((a, b) => (a.ts || 0) - (b.ts || 0));
    }

    const AssignmentService = {
        getAssignments, getPersonInventory, matchesPerson, isMyRequest, resolvePersonelId,
        activeDeviceUses, checkDeviceIds, isOpenService, serviceRecordsFor, getDeviceHistory,
    };
    window.AppModules = window.AppModules || {};
    window.AppModules.Assignments = AssignmentService;
    window.AssignmentService = AssignmentService;
})();
