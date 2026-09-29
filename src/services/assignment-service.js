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

    const AssignmentService = { getAssignments, getPersonInventory, matchesPerson, isMyRequest, resolvePersonelId };
    window.AppModules = window.AppModules || {};
    window.AppModules.Assignments = AssignmentService;
    window.AssignmentService = AssignmentService;
})();
