// [WHY]: feat/envanter-talep-iade · Faz 4 — personel Kişi Envanteri'ndeki demirbaş için iade talebi gönderir; yönetici onaylar
//        (cihazı teslim aldıysa depo seçer ve cihaz durumuna karar verir) ya da gerekçeyle reddeder.
// [HOW]: Saf sözleşme (DOM / Firebase yok, birim testli). firestore.rules returnRequests bloğu AYNI alan listeleri, seçenekler
//        ve sınırlarla denetler; ikisi ayrışırsa personel formu doldurup sunucuda reddedilir.
//        Belge kimliği ret_<zimmetId>: bir cihaz için tek belge (açık ikinci talep olamaz); reddedilen / geri çekilen talep
//        aynı belgeyle yeniden gönderilir.
(function () {
    const GEREKCELER = Object.freeze(['Ayrılış / görev değişikliği', 'Arıza', 'İhtiyaç kalmadı', 'Değişim', 'Diğer']);
    const CIHAZ_DURUMLARI = Object.freeze(['Çalışır', 'Arızalı', 'Hasarlı', 'Eksik parça']);          // personelin beyanı
    const ADMIN_CIHAZ_DURUMLARI = Object.freeze(['Sağlam', 'Arızalı', 'Hasarlı', 'Eksik parça']);     // yöneticinin kararı (onay)
    const DURUM = Object.freeze({ BEKLEMEDE: 'Beklemede', ONAYLANDI: 'approved', REDDEDILDI: 'rejected', GERI_CEKILDI: 'withdrawn' });
    const STAFF_KEYS = Object.freeze(['id', 'zimmetId', 'personelId', 'personel', 'personelUid', 'urun', 'sn', 'envanterNo',
        'kaynakDepo', 'productId', 'gerekce', 'aciklama', 'bildirilenDurum', 'durum', 'tarih', 'ts']);
    const ADMIN_DECISION_KEYS = Object.freeze(['teslimAlindi', 'iadeDepo', 'stogaEklendi', 'adminCihazDurumu', 'adminNotu',
        'kapanisAciklamasi', 'onaylayan', 'onayTarihi', 'redGerekcesi', 'reddeden', 'redTarihi']);
    const LIMITS = Object.freeze({ urun: 240, sn: 120, envanterNo: 120, aciklama: 1000, personel: 160, tarih: 60, note: 1000 });
    const TAG_LIKE = /<[a-zA-Z/!?]/;

    const str = v => (v === undefined || v === null ? '' : String(v)).trim();
    const docId = zimmetId => `ret_${str(zimmetId)}`;

    // Kişi Envanteri satırı (AssignmentService.getAssignments öğesi) iade talebine uygun mu?
    // Kural: b3 kaynaklı, iade edilmemiş, teslim alınmış, açıkça sarf olmayan zimmet.
    function isReturnable(a) {
        if (!a || a._source !== 'b3' || a.iadeEdildi || !a.teslimAlindi) return false;
        return !(a.isDemirbas === false || a.isDemirbas === 'false');
    }

    // → { record, errors } — personelin oluşturduğu (ya da yeniden gönderdiği) talep
    function build({ assignment, user, uid, gerekce, aciklama, bildirilenDurum, tarih, ts }) {
        const errors = [];
        if (!isReturnable(assignment)) errors.push('Bu kalem için iade talebi gönderilemez (yalnız üzerinizdeki demirbaş zimmetleri).');
        if (!GEREKCELER.includes(str(gerekce))) errors.push('Bir iade gerekçesi seçin.');
        if (!CIHAZ_DURUMLARI.includes(str(bildirilenDurum))) errors.push('Cihazın durumunu seçin.');
        const note = str(aciklama).replace(/\s+/g, ' ');
        if (str(gerekce) === 'Diğer' && !note) errors.push('"Diğer" seçildiğinde açıklama zorunludur.');
        if (!user || user.id == null || !str(user.name)) errors.push('Oturumdaki personel kaydı bulunamadı.');
        if (!str(uid)) errors.push('Oturum bulunamadı.');
        if (errors.length) return { record: null, errors };
        const record = {
            id: docId(assignment.id),
            zimmetId: str(assignment.id),
            personelId: str(user.id),
            personel: str(user.name),
            personelUid: str(uid),
            urun: str(assignment.urun) || '-',
            sn: str(assignment.sn) || '-',
            envanterNo: str(assignment.envanterNo) || '-',
            kaynakDepo: ['b1', 'b2'].includes(assignment.depo) ? assignment.depo : null,
            productId: assignment.productId == null || assignment.productId === '' ? null : str(assignment.productId),
            gerekce: str(gerekce),
            aciklama: note,
            bildirilenDurum: str(bildirilenDurum),
            durum: DURUM.BEKLEMEDE,
            tarih: str(tarih),
            ts: Number.isInteger(ts) ? ts : Date.now(),
        };
        const bad = validate(record);
        return bad.length ? { record: null, errors: bad } : { record, errors: [] };
    }

    // Personel alanlarının sözleşmesi (kurallarla aynı ölçüt) → hata listesi
    function validate(r) {
        const errors = [];
        if (!r || typeof r !== 'object') return ['Kayıt yok.'];
        Object.keys(r).forEach(k => { if (!STAFF_KEYS.includes(k)) errors.push(`bilinmeyen alan: ${k}`); });
        if (r.id !== docId(r.zimmetId) || !str(r.zimmetId) || str(r.zimmetId).length > 80) errors.push('Belge kimliği zimmet kaydıyla eşleşmiyor.');
        for (const [k, max] of Object.entries(LIMITS)) {
            if (!(k in r)) continue;
            if (typeof r[k] !== 'string') { errors.push(`${k} metin olmalı.`); continue; }
            if (r[k].length > max) errors.push(`${k} çok uzun.`);
            if (TAG_LIKE.test(r[k])) errors.push(`${k} alanında etiket benzeri ifade kullanılamaz.`);
        }
        if (!GEREKCELER.includes(r.gerekce)) errors.push('Geçersiz gerekçe.');
        if (!CIHAZ_DURUMLARI.includes(r.bildirilenDurum)) errors.push('Geçersiz cihaz durumu.');
        if (!Number.isInteger(r.ts)) errors.push('ts tam sayı olmalı.');
        return errors;
    }

    window.ReturnRequestSchema = Object.freeze({
        GEREKCELER, CIHAZ_DURUMLARI, ADMIN_CIHAZ_DURUMLARI, DURUM, STAFF_KEYS, ADMIN_DECISION_KEYS, LIMITS, docId, isReturnable, build, validate,
    });
})();
