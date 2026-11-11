# H4 uygulama planı

10 Kasım 2026. Dal `feat/v3.4-ebys-tamamlama-h0`, HEAD `883da91e947152d41dd6f56cbb8b6b27c1dbf10b`. Ara yayının 112 dosyası başlangıçta birebir eşleşti. Başlangıç patch, durum, SHA-256 listesi ve etkilenen dosya kopyaları `scratch/ebys-h4-evidence/` altında. Kapanmış prompt arşivi bu görevden önceki yayın işlemine aittir.

## Servis ve Rules

- `ebys-document-service.js` ortak taslak yaşam döngüsünü ve işlem günlüğünü kullanır. Açık satın alma komutları `createPurchaseDocument`, `savePurchaseDraft`, `freezePurchaseVersion` ve `getPurchaseView` yalnız modül dışa aktarımlarıdır. Mevcut genel oluşturma/dondurma komutları bağlı kaydı dönüştüremez. Var olan kayıt numarası yolu korunur. Yeni ürün düğmesi, DOM bağı veya otomatik okuma eklenmez.
- İlk komut kimliği yeniden denemede aynı P'yi üretir. İşlem kaydı ilk okunur. Yeni oluşturma için başlık ve işaretçi önceden yoktur. Normal kayıtta beklenen revizyon şarttır. Yeniden açmada önceki süreç iade, red veya geri çekilmiş olmalıdır. Birim kaynağı Firestore snapshot yolundan alınır. Aynı P ve sahip altında işaretçi, başlık, taslak, işlem ve olay tek transaction içinde yazılır.
- Dondurma sürüm UUID'sini transaction dışında üretir. İşlem, başlık, taslak ve aktif ortak birim okunur. Teklif taslaktan, künye güncel birim kaynağından alınır. Şema 2 özeti H3-B yardımcılarından gelir. Sürüm, başlık, işlem ve olay birlikte yazılır. Şema 1 yolu korunur.
- `ebys-process-service.js` bağlı sürüm için P'yi saklar. İlk olumlu kararda sabit V ve mevcut nested finans noktası okunur. Döviz varsa mevcut kur ayarı transaction içinde okunur ve gözlenen değerle karşılaştırılır. Ayrı `getPurchaseApprovalPreview` açık çağrısı H5'e gösterilecek veriyi sağlar. TRY-only kur okuması yapmaz. Yeni mali kayıt ilk kararla birlikte yazılır. H3-B ve PurchaseMoney mevcut klasik modüllerini yeniden kullan. Oturum veya kök değiştiğinde yeni komut sonucu döndürülmez.
- `getPurchaseView` açık V verildiğinde doğrudan V ve nested finansı okur. Geçmiş görev güncel başlığa gitmez. V verilmediğinde eski talep görünümü veya sahibin bağlı taslağı nokta okumalarıyla çözülür. Reddedilen erişim ile kaydın henüz oluşmaması ayrı sonuçlardır.
- `firestore.rules` içinde yalnız gerekli H3-A dalları uyarlanır. Legacy ve EBYS motoru ayrı yazma dalları kullanır. Genel allow üzerinden motor değiştirme, silme veya tam set yolu kalmaz. Bağ, işlem, owner, aktör ve sürüm zinciri sunucuda denetlenir. Teklif doğrulaması aynı atomik yazımdaki işaretçi ve işlem/olay dallarında dağıtılabilir. Kaynak ve mali kayıt ilk karar dalında doğrulanır. H0 görev süresi, QR, arşiv, stok/iade ve kayıt numarası kontrolleri korunur.

## Okuma ve yazma planı

| Komut | Yeni yolda beklenen SDK okumaları | Yazılar |
|---|---|---|
| İlk taslak / düzenleme | İşlem, başlık, taslak, birim, işaretçi. Yeniden açmada önceki süreç eklenir | 5 |
| Dondurma | İşlem, başlık, taslak, birim | 4 |
| Süreç başlatma | İşlem, V, süreç, başlık, rota kişileri. Şablon seçildiyse bir nokta daha | 4 |
| İlk ve son olumlu karar | İşlem, süreç, görev, başlık, havale, birim, icracı, V, nested finans. Dövizde kur eklenir | 7 |
| İlk ara olumlu karar | İşlem, süreç, görev, sonraki kişi ve gerekiyorsa görevi, V, nested finans. Dövizde kur eklenir | Finans ile birlikte 5–6 |
| Aynı komutu tekrarlama | İşlem. Yarış sonrası en çok bir sunucu teyidi ayrı ölçülür | 0 |
| Açık satın alma görünümü | V + nested finans veya işaretçi + başlık + taslak | 0 |

SDK sayıları koşudan ölçülür. Yeniden denemeler, Rules iç okumaları ve fatura sayıları birbirinden ayrıdır. Yeni dinleyici, polling, collection-group ve indeks yoktur.

## Kişisel kopya ve operatör kurtarma

- H1 kişisel kopya yetkisi ve 400 istek/500 belge sınırı sürer. Sahip olunan bağlı başlıklar için işaretçi, dışa aktarılan sabit sürümlerden türetilen P/V için nested finans okunur. Manifest tam yol, motor/şema, okunan/henüz oluşmamış/erişim reddedilen durumlarını ayırır. H1 kişisel biçiminde yeni kapsam bölümü yalnız ilgili kayıt varsa eklenir.
- `tools/ebys-local-recovery.mjs` mevcut demo loopback, 300 belge/8 MiB, durgun kaynak, iki tarama ve tek create-only commit sınırını korur. H4 operatör paketi ayrı biçim sürümüyle işaretçi ve nested finansın tam yolunu içerir. Eski v1 paketleri aynı kapsamla kabul edilir. V/P, kök, owner, işlem/aktör, ilk karar ve kanonik şema 2 özeti doğrulanır. Nested finans koleksiyonu listelenmez. Ayrı demo hedefinde V1/V2 erişim, kapanış ve kamusal QR tekrar doğrulanır.

## Test ve geri dönüş

- Ürün Rules + gerçek servislerle paralel oluşturma ve tekrar, bayat revizyon, P/V/kök/sahip ve birim retleri, legacy satın alma regresyonu, üç döviz, kur değişimi/eksikliği, ilk red/iade, altı adım, vekil, tekrar eden görevli, immutable kayıtlar, icra, export ve restore sınanır. SDK ölçümü ve sonuçlar H4 kanıt klasörüne yazılır.
- `test:unit`, `test:rules`, XSS, Hosting ve diff kontrolü. Ayrı demo test koşucusu 8180/4410/4510. Manuel 8080/9099 verisine dokunulmaz. Yeni kod mevcut yayımlanabilir dosyalara eklenir. Gerekirse yalnız gerçekten eklenen Hosting dosyası kadar sayaç değişir.
- Rehber taslağı ve H4 walkthrough düzenlenir. H5/H6a ekran, çıktı ve kabulü ayrıdır. İleride yeni kayıt oluştuğunda geri dönüş yeni oluşturmayı kapatır. Var olan kaydın okunması ve işinin tamamlanması için motor korumaları, Rules ve nested finans desteği korunur.
