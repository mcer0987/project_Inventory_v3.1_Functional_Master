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
            // Faz 2 (B-1): sarf tüketimdir, zimmet değil. Kayıtta açıkça sarf işaretli (isDemirbas false) eski talepler listelenmez;
            // bayrağı olmayan (belirsiz) eski talepler güvenli tarafta kalır.
            if (n.isDemirbas === false) return;
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

    // Faz 3 (B-3) · Zimmetin görünen durumu — admin Zimmet ekranı ve Kişi Envanteri aynı kuralı kullanır.
    //   'iade'          iade edildi
    //   'iadeBekliyor'  personel iade talebi gönderdi, yönetici onayı bekleniyor (returnRequests · Faz 4; koleksiyon yoksa hiç çıkmaz)
    //   'teslimBekliyor' talep onaylandı, personel henüz "Teslim Aldım" demedi
    //   'zimmetli'      teslim alındı / doğrudan zimmet
    const STATE_LABELS = Object.freeze({ iade: 'İade Edildi', iadeBekliyor: 'İade Onayı Bekliyor', teslimBekliyor: 'Teslim Bekliyor', zimmetli: 'Zimmetli' });
    function assignmentState(a) {
        if (!a) return null;
        if (a.iadeEdildi) return 'iade';
        const open = ((window.data && window.data.returnRequests) || []).some(r => r && String(r.zimmetId) === String(a.id)
            && String(r.durum || '') === 'Beklemede');
        if (open) return 'iadeBekliyor';
        return a.teslimAlindi ? 'zimmetli' : 'teslimBekliyor';
    }

    // Durum rozeti (HTML). Yalnız sabit anahtar ve etiketlerden kurulur; kayıt verisi içermez. Stil: style.css .zim-state
    const STATE_ICONS = Object.freeze({ iade: '✅', iadeBekliyor: '↩️', teslimBekliyor: '⏳', zimmetli: '📌' });
    function stateBadgeHtml(key) {
        const k = STATE_LABELS[key] ? key : 'zimmetli';
        const esc = typeof window.escapeHtml === 'function' ? window.escapeHtml : s => String(s);
        return `<span class="zim-state zim-state-${esc(k)}">${esc(STATE_ICONS[k])} ${esc(STATE_LABELS[k])}</span>`;
    }
    window.zimmetStateBadge = stateBadgeHtml;

    // ─── Faz 5 · Zimmet kapanış planı — "Zimmetten Düş" ve iade talebi onayı AYNI kodu kullanır (YAZMAZ) ─────────────
    // Depoya dönecek ürün: önce kayıttaki productId, yoksa hedef depoda adı birebir (kırpılmış, küçük harf) tek eşleşen kalem.
    function findReturnProduct(item, view, depo) {
        const list = ((window.data && window.data[depo]) || []);
        if (item.productId != null && item.productId !== '') {
            const byId = list.find(p => p && String(p.id) === String(item.productId));
            if (byId) return byId;
        }
        const name = String(view.urunAciklama === '-' ? '' : view.urunAciklama).trim().toLocaleLowerCase('tr-TR');
        const byName = name ? list.filter(p => p && String(p.ürün || p.name || '').trim().toLocaleLowerCase('tr-TR') === name) : [];
        return byName.length === 1 ? byName[0] : null;
    }

    /**
     * @param {string|number} zimmetId  b3 zimmet kaydı
     * @param {{teslimAlindi:boolean, depo?:'b1'|'b2', stogaEkle?:boolean, tarih:string}} o
     *        teslimAlindi: cihaz fiziken teslim alındı mı (alındıysa depo zorunlu; kayıtta iadeDepo olur)
     *        stogaEkle: ürün kalemine +adet (yalnız teslim alındıysa; hasarlı cihazda yönetici kararı)
     * @returns {{ok:true, qty:number, product:object|null, stock:object[], writes:object[]} | {ok:false, error:string}}
     */
    function planClose(zimmetId, { teslimAlindi, depo, stogaEkle, tarih } = {}) {
        const fail = error => ({ ok: false, error });
        const data = window.data || {};
        const item = (data.b3 || []).find(x => x && String(x.id) === String(zimmetId));
        if (!item) return fail('Zimmet kaydı bulunamadı; liste güncellenmiş olabilir.');
        const view = S().normalizeB3(item);
        if (view.tip !== 'zimmet') return fail('Bu kayıt bir zimmet değil.');
        if (view.iadeEdildi) return fail('Bu zimmet zaten iade edilmiş.');
        if (teslimAlindi && !['b1', 'b2'].includes(depo)) return fail('Teslim alınan cihaz için depo seçin.');
        if (stogaEkle && !teslimAlindi) return fail('Teslim alınmayan cihaz stoğa eklenemez.');
        const qty = Number(view.adet) || 1;
        let product = null;
        if (stogaEkle) {
            product = findReturnProduct(item, view, depo);
            if (!product) return fail(`${String(depo).toUpperCase()} deposunda bu ürün tek ve kesin olarak bulunamadı. Stoğa eklemeden kapatabilir ya da ürünü depoda tanımlayabilirsiniz.`);
            // v3.6: sayımdaki rafa stok eklenmez (sayım sonucu değişmesin). Defter de reddeder; burada nedeni önceden söylenir.
            if (S().isRowCountLocked && S().isRowCountLocked(product)) {
                return fail('Ürünün rafı sayımda; şu an stoğa eklenemez. "Stoğa ekle" seçeneğini kaldırarak kapatabilir ya da sayım bitince tekrar deneyebilirsiniz.');
            }
        }
        const fields = { iadeEdildi: true, iadeDepo: teslimAlindi ? depo : null, iadeEdildiTarihi: tarih };
        const writes = [{ op: 'update', col: 'b3', id: item.id, fields }];
        if ((data.assignments || []).some(a => a && String(a.id) === String(item.id))) writes.push({ op: 'update', col: 'assignments', id: item.id, fields });
        // Talep, ona bağlı cihazların (3.9a: cihaz başına bir b3 kaydı) hepsi iade edilince kapanır.
        if (item.requestId != null) {
            const others = (data.b3 || []).filter(b => b && String(b.requestId) === String(item.requestId) && String(b.id) !== String(item.id)
                && !S().normalizeB3(b).iadeEdildi);
            if (others.length === 0 && (data.requests || []).some(r => r && String(r.id) === String(item.requestId))) {
                writes.push({ op: 'update', col: 'requests', id: item.requestId, fields: { iadeEdildi: true, iadeEdildiTarihi: tarih } });
            }
        }
        const stock = product ? [{ col: depo, id: product.id, delta: qty }] : [];
        return { ok: true, qty, product, stock, writes, view };
    }

    // Kişinin teslim almayı beklediği (onaylanmış, iade edilmemiş) zimmetleri.
    function getPendingDeliveries(user) {
        if (!user) return [];
        return getAssignments().filter(a => !a.iadeEdildi && !a.teslimAlindi && matchesPerson(a, user));
    }

    /**
     * Faz 2 (B-1) · Sarf zimmetlerini tüketim çıkışına çevirme planı (YAZMAZ).
     * Dönüşür: tip 'zimmet', kayıtta AÇIKÇA isDemirbas false (boolean ya da 'false'), iade edilmemiş b3 kaydı.
     * Dokunulmaz: iade edilmiş sarf zimmeti (stoğa dönmüş; çıkış saymak yanlış olur), demirbaş, demirbaş olup olmadığı kayıtta
     * yazmayan eski kayıt (belirsiz — listelenir). Aynı veriyle ikinci çalıştırma boş plan döndürür (idempotent).
     * @returns {{ total:number, convert:object[], returned:object[], unknown:object[] }} öğe: { id, personel, urun, adet, tarih }
     */
    function planSarfConsumption(items = (window.data && window.data.b3) || []) {
        const plan = { total: 0, convert: [], returned: [], unknown: [] };
        items.forEach(item => {
            const n = item && S().normalizeB3(item);
            if (!n || n.tip !== 'zimmet') return;
            plan.total++;
            const flag = item.isDemirbas;
            const row = { id: item.id, personel: n.alanKisi, urun: n.urunAciklama, adet: n.adet, tarih: n.tarih };
            if (flag === undefined || flag === null || flag === '') { plan.unknown.push(row); return; }
            if (!(flag === false || flag === 'false')) return;
            (n.iadeEdildi ? plan.returned : plan.convert).push(row);
        });
        return plan;
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

    // [WHY] (Faz 3.5, denetim): Her çağrı tüm zimmet listesini (b3 normalizasyonu + talepler) ve servis kayıtlarını baştan
    //        tarıyor. Sepette ve zimmette her kalem için ayrı çağrılıyor; 50+ cihazlık girişte (ya da ileride canlı kimlik
    //        kontrolünde her tuşta) main-thread'i kilitler.
    // [HOW]: Kısa ömürlü önbellek. Anahtar: veri revizyonu (firebase-handler: her snapshot ve her yerel yazmada artar) +
    //        ilgili dizilerin kimliği; ayrıca en fazla USES_TTL_MS yaşar (window.data'yı doğrudan değiştiren eski kod için
    //        emniyet). { fresh: true } önbelleği atlar. Dönen Map salt okunurdur.
    const USES_TTL_MS = 2000;
    const USES_SOURCES = ['b3', 'assignments', 'requests', 'serviceRecords'];
    let usesCache = null;
    const usesStats = { computed: 0, hits: 0 };
    function usesSignature() {
        const d = window.data || {};
        return [typeof window.getDataRevision === 'function' ? window.getDataRevision() : 0, ...USES_SOURCES.map(c => d[c])];
    }
    function activeDeviceUses({ fresh = false } = {}) {
        const sig = usesSignature(), now = Date.now();
        if (!fresh && usesCache && now - usesCache.at < USES_TTL_MS && sig.every((v, i) => v === usesCache.sig[i])) {
            usesStats.hits++;
            return usesCache.uses;
        }
        const uses = computeActiveDeviceUses();
        usesStats.computed++;
        usesCache = { sig, at: now, uses };
        return uses;
    }
    function invalidateDeviceUses() { usesCache = null; }

    function computeActiveDeviceUses() {
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
            // Faz 5 · K2 (5.10): hurda hareketi de b3'te yaşar (tip:'hurda') — cihaz geçmişinde ayrı etiketle gösterilir.
            const hareketTur = zimmet ? '📌 Zimmet' : (n.tip === 'hurda' ? '♻️ Hurdaya Ayrıldı' : '📤 Envanter çıkışı');
            events.push({ ts: n.ts || tsOfText(n.tarih), tarih: n.tarih, tur: hareketTur, kisi: n.alanKisi, urun: n.urunAciklama, yer: n.stokDisi ? 'Stok dışı' : (n.kaynakDepo || '-').toUpperCase(), not: n.not });
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

    // ─── Faz 5 · K1 · Resmi zimmet belgesi veri motoru (5.1 · ZIM-04) ───
    // [WHY]: pdf-generator.js tek bir b3 satırından form basıyor, teslim edeni o an oturumdaki kullanıcı sanıyor ve "Model"
    //        kolonuna ürün türünü yazıyordu; kişinin üzerindeki zimmetlerin toplu tutanağı hiç yoktu. PDF katmanı veriyi
    //        kendisi toplarsa Kişi Envanterim ile tutanak yine farklı kurallarla okunur (3.7'de kapatılan sorun geri gelir).
    // [HOW]: Veri burada, tasarım pdf-generator.js'te. generatePersonnelZimmetData = Kişi Envanterim'in kendisi
    //        (getPersonInventory: aktif + teslim alınmış) + kanonik cihaz kimlikleri + zimmetleyen yönetici. Çıktı salt veridir:
    //        JSON'a çevrilebilir, window.data'ya referans taşımaz, personelin oturum kodu (code) asla girmez. Sözleşme:
    //        ZIMMET_BELGE_SEMA; metin alanları her zaman boş olmayan string ('-' = bilinmiyor), adet sayı, isDemirbas boolean.
    //        Belge no aynı gün aynı kalem kümesi için aynıdır (yeniden basım aynı numarayı taşır).
    const ZIMMET_BELGE_SEMA = 'zimmet-belge/1';
    const ZIMMET_KALEM_KEYS = Object.freeze([
        'sira', 'kayitId', 'kaynak', 'envanterNo', 'sn', 'urunTuru', 'urunAciklama', 'marka', 'model', 'adet', 'isDemirbas',
        'tarih', 'teslimTarihi', 'talepTuru', 'oncelik', 'iadeTarihi', 'talepNo', 'zimmetleyen', 'not',
        'durum', 'iadeEdildiTarihi',
    ]);

    const blank = v => v === undefined || v === null || String(v).trim() === '' || String(v).trim() === '-';
    const txt = (...vals) => { const v = vals.find(x => !blank(x)); return v === undefined ? '-' : String(v).trim(); };

    function findPerson(personelId) {
        if (blank(personelId)) return null;
        return personList().find(p => p && p.id != null && String(p.id) === String(personelId)) || null;
    }
    // Belgeye giden kişi bloğu. code (oturum kodu) bilinçli olarak yok.
    function personBlock(p, fallbackName) {
        return {
            id: p && p.id != null ? String(p.id) : '-',
            adSoyad: txt(p && (p.name || p.adSoyad), fallbackName),
            birim: txt(p && (p.birim || p.unit || p.department || p.bolum || p.departman || p.birimAdi)),
        };
    }

    const istFmt = new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
    function stamp(now) {
        const d = now instanceof Date ? now : new Date(now ?? Date.now());
        const parts = Object.fromEntries(istFmt.formatToParts(d).map(x => [x.type, x.value]));
        return { text: `${parts.day}.${parts.month}.${parts.year} ${parts.hour}:${parts.minute}`, ymd: `${parts.year}${parts.month}${parts.day}` };
    }
    // FNV-1a (32 bit) — belge no'nun kısa, deterministik soneki; güvenlik amaçlı değil.
    function shortHash(s) {
        let h = 0x811c9dc5;
        for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
        return h.toString(36).toUpperCase().padStart(7, '0');
    }

    // Zimmetleyen yönetici: kanonik onaylayan → eski approvedBy → bağlı talebin onaylayanı → eski onay notundaki "Onaylayan: X".
    function issuerOf(raw, req, fallbackDate) {
        const fromNote = String((raw && (raw.not ?? raw.note)) || '').match(/Onaylayan:\s*([^·]+)/);
        return {
            ad: txt(raw && raw.onaylayan, raw && raw.approvedBy, req && req.approvedBy, fromNote && fromNote[1]),
            tarih: txt(raw && raw.approvedAt, req && req.approvedAt, fallbackDate),
        };
    }

    // Tek belge satırı. src: getAssignments() öğesi ya da normalizeB3 görünümünden kurulan eşdeğeri (+ raw, req).
    function belgeRow(src, sira) {
        const raw = src.raw || {};
        const req = src.req || null;
        // Talep kaynaklı eski kayıtta ürün bilgisi onayda seçilen stok kaleminden tamamlanır (tür/marka/model).
        const productId = !blank(src.productId) ? src.productId : (req ? req.stockProductId : raw.stockProductId);
        const found = S().findStock(productId, src.depo || (req ? req.stockRepo : raw.stockRepo));
        const stock = found ? S().normalizeStock(found.product, found.col) : null;
        const urunAciklama = txt(src.urunAciklama, stock && stock.ad);
        return {
            sira,
            kayitId: String(src.id),
            kaynak: src.kaynak,
            envanterNo: txt(src.envanterNo),
            sn: txt(src.sn),
            urunTuru: txt(src.urunTuru, stock && stock.tur),
            urunAciklama,
            marka: txt(src.marka, stock && stock.marka),
            // Ayrı model alanı yalnız bazı eski kayıtlarda var; sistemde "Ürün Adı / Model" tek alandır.
            model: txt(raw.model, found && found.product.model, urunAciklama),
            adet: Number(src.adet) || 1,
            // kayıtta yazılıysa o (yazma anı kararı); eski talepte bilinmiyorsa (null) stok kaleminin türünden
            isDemirbas: typeof src.isDemirbas === 'boolean' ? src.isDemirbas : !!(stock && stock.isDemirbas),
            tarih: txt(src.tarih),
            teslimTarihi: txt(src.teslimTarihi, src.tarih),
            talepTuru: txt(src.talepTuru),
            oncelik: txt(src.oncelik),
            iadeTarihi: txt(src.iadeTarihi),
            talepNo: blank(src.requestId) ? '-' : String(src.requestId),
            zimmetleyen: issuerOf(raw, req, src.tarih),
            not: txt(src.not),
            durum: src.durum || (src.iadeEdildi ? 'iade' : 'aktif'),   // 'aktif' | 'iade' | 'cikis' (envanter çıkışı)
            iadeEdildiTarihi: txt(src.iadeEdildiTarihi),
        };
    }

    function envelope({ tur, prefix, person, fallbackName, rows, now, duzenleyen, extra }) {
        const st = stamp(now);
        const uniq = list => [...new Set(list.filter(v => v !== '-'))];
        const adetOf = pred => rows.filter(pred).reduce((s, r) => s + r.adet, 0);
        const personel = personBlock(person, fallbackName);
        return {
            sema: ZIMMET_BELGE_SEMA,
            belge: {
                tur,
                belgeNo: `${prefix}-${st.ymd}-${shortHash([personel.id, personel.adSoyad, ...rows.map(r => r.kayitId).sort()].join('|'))}`,
                olusturmaTarihi: st.text,
                duzenleyen: txt(duzenleyen, window.currentUser && window.currentUser.name),
                talepNolari: uniq(rows.map(r => r.talepNo)),
                teslimEdenler: uniq(rows.map(r => r.zimmetleyen.ad)),
            },
            personel,
            kalemler: rows,
            ozet: {
                kalemSayisi: rows.length,
                toplamAdet: adetOf(() => true),
                demirbasAdet: adetOf(r => r.isDemirbas),
                sarfAdet: adetOf(r => !r.isDemirbas),
                geciciZimmet: rows.filter(r => /geçici/i.test(r.talepTuru)).length,
                ...extra,
            },
        };
    }

    /**
     * Personelin resmi zimmet tutanağı verisi: üzerindeki aktif (iade edilmemiş) ve teslim alınmış zimmetler — Kişi
     * Envanterim ile birebir aynı küme — zimmet tarihine göre eskiden yeniye.
     * @param {string|number} personelId  personel koleksiyonundaki id
     * @param {{now?: Date|number, duzenleyen?: string}} [opts]  now: belge tarihi (varsayılan şimdi); duzenleyen: belgeyi
     *        basan yönetici (varsayılan oturumdaki kullanıcı)
     * @returns {null | {sema:string, belge:object, personel:{id,adSoyad,birim}, kalemler:object[], ozet:object}}
     *          personel bulunamazsa null. ozet.teslimBekleyen: onaylanmış ama henüz "Teslim Aldım" denmemiş kalem sayısı
     *          (tutanağa girmez, bilgi amaçlı).
     */
    function generatePersonnelZimmetData(personelId, opts = {}) {
        const person = findPerson(personelId);
        if (!person) return null;
        const reqById = new Map(((window.data && window.data.requests) || []).filter(Boolean).map(r => [String(r.id), r]));
        const mine = getAssignments().filter(a => !a.iadeEdildi && matchesPerson(a, person));
        const rows = mine.filter(a => a.teslimAlindi)
            .sort((a, b) => (a.ts || 0) - (b.ts || 0) || String(a.id).localeCompare(String(b.id)))
            .map((a, i) => belgeRow({
                id: a.id, kaynak: a._source, sn: a.sn, envanterNo: a.envanterNo,
                urunTuru: a.urunTuru, urunAciklama: a.urun, marka: a.marka, adet: a.adet,
                isDemirbas: a._source === 'request' && a.rawRef && a.rawRef.isDemirbas == null ? null : a.isDemirbas,
                tarih: a.tarih, teslimTarihi: a.teslimTarihi, talepTuru: a.talepTuru, oncelik: a.oncelik, iadeTarihi: a.iadeTarihi,
                requestId: a.requestId, productId: a.productId, depo: a.depo, not: a.not,
                iadeEdildi: false, iadeEdildiTarihi: null,
                raw: a.rawRef, req: a.requestId != null ? reqById.get(String(a.requestId)) : null,
            }, i + 1));
        return envelope({
            tur: 'personel-zimmet', prefix: 'ZT', person, rows, now: opts.now, duzenleyen: opts.duzenleyen,
            extra: { teslimBekleyen: mine.filter(a => !a.teslimAlindi).length },
        });
    }

    /**
     * Tek b3 hareketinin (zimmet ya da envanter çıkışı) belge verisi — satır PDF'i için, aynı sözleşmeyle (tek kalem).
     * Kayıt hangi şemayla yazılmış olursa olsun normalizeB3 görünümünden okunur; iade edilmiş zimmet de basılabilir
     * (kalem.durum 'iade'). Ek alan: hareket {tip, kaynakDepo, rafNo, sutun, stokDisi, iadeDepo}.
     * @param {string|number} b3Id
     * @param {{now?: Date|number, duzenleyen?: string}} [opts]
     * @returns {null | object} kayıt bulunamazsa null
     */
    function generateB3MovementData(b3Id, opts = {}) {
        const item = ((window.data && window.data.b3) || []).find(x => x && String(x.id) === String(b3Id));
        const n = item && S().normalizeB3(item);
        if (!n) return null;
        const req = n.requestId != null ? ((window.data && window.data.requests) || []).find(r => r && String(r.id) === String(n.requestId)) : null;
        const person = findPerson(n.personelId || (req && req.personelId) || resolvePersonelId(n.alanKisi));
        const row = belgeRow({
            id: n.id, kaynak: 'b3', sn: n.sn, envanterNo: n.envanterNo,
            urunTuru: n.urunTuru, urunAciklama: n.urunAciklama, marka: n.marka, adet: n.adet, isDemirbas: n.isDemirbas,
            tarih: n.tarih, teslimTarihi: req && req.teslimTarihi, talepTuru: n.talepTuru, oncelik: n.oncelik, iadeTarihi: n.iadeTarihi,
            requestId: n.requestId, productId: n.productId, depo: n.stokDisi ? null : n.kaynakDepo, not: n.not,
            iadeEdildi: n.iadeEdildi, iadeEdildiTarihi: n.iadeEdildiTarihi, durum: n.tip === 'zimmet' ? null : 'cikis',
            raw: item, req,
        }, 1);
        const doc = envelope({
            tur: n.tip === 'zimmet' ? 'zimmet' : 'cikis', prefix: 'HT', person, fallbackName: n.alanKisi, rows: [row],
            now: opts.now, duzenleyen: opts.duzenleyen, extra: {},
        });
        doc.hareket = {
            tip: n.tip, kaynakDepo: txt(n.kaynakDepo), rafNo: txt(n.rafNo), sutun: txt(n.sutun), stokDisi: n.stokDisi,
            iadeDepo: txt(n.iadeDepo),
        };
        return doc;
    }

    /**
     * Faz 6 · Onaylanmış bir iade talebinin resmi tutanak verisi. Yön, zimmet tutanağının tersidir: personel teslim
     * eden, yönetici teslim alandır. Cihaz kalemi önce returnRequests kaydının kendi alanlarından, eksikse zimmetId
     * ile bulunan b3 kaydından (hâlâ varsa) tamamlanır; b3 silinmiş olsa da belge üretilir. Yalnız durum 'approved'
     * için üretilir (bekleyen/reddedilen/geri çekilen talepte tutanağın bir karşılığı yoktur).
     * @param {string|number} returnId  returnRequests kaydının id'si ("ret_<zimmetId>")
     * @param {{now?: Date|number, duzenleyen?: string}} [opts]
     * @returns {null | object} kayıt yoksa ya da henüz karara bağlanmamışsa null; ek alan doc.iade (karar özeti)
     */
    function generateReturnData(returnId, opts = {}) {
        const r = ((window.data && window.data.returnRequests) || []).find(x => x && String(x.id) === String(returnId));
        if (!r || r.durum !== 'approved') return null;
        const b3 = ((window.data && window.data.b3) || []).find(x => x && String(x.id) === String(r.zimmetId));
        const n = b3 && S().normalizeB3(b3);
        const person = findPerson(r.personelId) || (n && findPerson(n.personelId));
        const kararTarihi = txt(r.onayTarihi, r.tarih);
        const row = belgeRow({
            id: r.zimmetId, kaynak: 'return', sn: txt(r.sn, n && n.sn), envanterNo: txt(r.envanterNo, n && n.envanterNo),
            urunTuru: n && n.urunTuru, urunAciklama: txt(r.urun, n && n.urunAciklama), marka: n && n.marka,
            adet: n ? n.adet : 1, isDemirbas: true,
            tarih: n && n.tarih, teslimTarihi: r.teslimAlindi ? kararTarihi : r.tarih,
            talepTuru: n && n.talepTuru, oncelik: n && n.oncelik, iadeTarihi: r.tarih,
            requestId: n && n.requestId, productId: txt(r.productId, n && n.productId), depo: r.iadeDepo, not: r.adminNotu,
            iadeEdildi: true, iadeEdildiTarihi: kararTarihi, durum: 'iade',
            raw: b3 || {}, req: null,
        }, 1);
        const doc = envelope({
            tur: 'iade', prefix: 'IT', person, fallbackName: r.personel, rows: [row],
            now: opts.now, duzenleyen: txt(opts.duzenleyen, r.onaylayan),
        });
        doc.iade = {
            gerekce: txt(r.gerekce), aciklama: txt(r.aciklama), bildirilenDurum: txt(r.bildirilenDurum), talepTarihi: txt(r.tarih),
            teslimAlindi: !!r.teslimAlindi, iadeDepo: txt(r.iadeDepo), stogaEklendi: !!r.stogaEklendi,
            adminCihazDurumu: txt(r.adminCihazDurumu), adminNotu: txt(r.adminNotu), kapanisAciklamasi: txt(r.kapanisAciklamasi),
            onaylayan: txt(r.onaylayan), onayTarihi: txt(r.onayTarihi),
        };
        return doc;
    }

    const AssignmentService = {
        getAssignments, getPersonInventory, matchesPerson, isMyRequest, resolvePersonelId, planSarfConsumption,
        assignmentState, getPendingDeliveries, stateBadgeHtml, STATE_LABELS, planClose, findReturnProduct,
        activeDeviceUses, checkDeviceIds, isOpenService, serviceRecordsFor, getDeviceHistory,
        invalidateDeviceUses, usesStats,
        generatePersonnelZimmetData, generateB3MovementData, generateReturnData, ZIMMET_BELGE_SEMA, ZIMMET_KALEM_KEYS,
    };
    window.AppModules = window.AppModules || {};
    window.AppModules.Assignments = AssignmentService;
    window.AssignmentService = AssignmentService;
})();
