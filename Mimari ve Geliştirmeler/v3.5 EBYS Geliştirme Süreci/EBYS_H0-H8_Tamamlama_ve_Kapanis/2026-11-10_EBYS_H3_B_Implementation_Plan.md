# H3-B uygulama planı

10 Kasım 2026. Dal `feat/v3.4-ebys-tamamlama-h0`, HEAD `883da91e947152d41dd6f56cbb8b6b27c1dbf10b`. H3-A nihai tablosu geçişi karşılıyor. H3-A başlangıç hash listesine göre altı benzersiz dosyada mevcut stok değişikliği var. EBYS, satın alma ve Rules tabanı eşleşiyor. Bu stok değişiklikleri H3-B öncesi durum olarak korunacak. Başlangıç diff'i, durum ve SHA-256 listesi `scratch/ebys-h3b-evidence/` altında.

## API ve veri sınırı

- `src/utils/ebys-purchase-schema.js` mevcut `window.AppModules` geleneğine uyacak. Hesap için mevcut `PurchaseMoney`, evrak normalleştirme ve kanonik SHA-256 için `EBYSDocumentSchema` çağrı anında kullanılacak. Bu, aynı hesap ve hash uygulamasını kullanırken HTML yükleme sırasını bu aşamada değiştirmemeyi sağlar.
- `normalizeLegacyId`, `unitOptions`, `matchLegacyUnit` ve `createUnitSnapshot` salt veri alacak. Birim girdisi `{root,pathId,data}` olacak. Ortak dinleyici `{id: docSnap.id, ...docSnap.data()}` döndürdüğünden saklanan `id` yol kimliğini ezebilir. Gelecekteki adaptör `pathId` değerini doğrudan belge yolundan almalı. Sayısal eski kimlikler güvenli tam sayı ile sınırlı, stringler belge yoluyla birebir. Eşleme yalnız aynı kökte öneri üretecek. Tarihsel künye, seçim verisinden ayrı tutulacak.
- `readPurchase` eski talepleri ve kalemsiz gösterimi salt okunur ele alacak. `createPurchaseMarker`, `normalizePurchaseMarker` ve `validatePurchaseLinks` işaretçi, başlık, sürüm ve süreç ilişkisini beklenen kök, yol ve sahip üzerinden denetleyecek. Bağ denetiminde tarihsel sürüm güncel başlık revizyonuna veya güncel birim adına bağlanmayacak. Zaman damgasını yazma adaptörü sağlar.
- `normalizePurchaseSnapshot` yalnız sözleşme alanlarını kabul edecek. Eksik veya bozuk hesaplanmış toplamlar mevcut hesaplayıcıdan yeniden üretilecek. Girdi fiyat, miktar ve KDV değerleri sayısal olacak. `butce` ve modu, formun seçtiği/hesapladığı ödeneği temsil eder. Otomatik tahmin için canlı kur okuması veya yeni bir hesap motoru kurulmayacak.
- `financePath`, `compareRateSource`, `normalizeFinance` ve `isFirstPositiveDecision` sürüm bazlı mali veri ve karar koşulunu denetleyecek. Kur önizlemesi yalnız `rates,date,source` üzerinden karşılaştırılacak. Finans doğrulaması yetkili sürüm verisini girdi alır, TRY rapor tutarını mevcut motorla denetler ve yazım yapmaz. Eski üst mali yolun anlamı korunur.
- `purchaseDigestEnvelope` ve `digestPurchaseVersion` şema 2'nin sözleşmedeki beş alanını üretir. Hazır sürümdeki teklif toplamları ve üstveri kanonik şekille karşılaştırılır. Şema 1'in mevcut servis yolu ve hash'i korunur.

## Değişiklik, doğrulama ve geri dönüş

- Yeni modül ve `tests/unit/ebys-purchase-schema.test.mjs`, bu plan, walkthrough ve rehber taslağındaki planlanan adımlar. Hosting beklentisi yalnız bir yeni yayımlanabilir kaynak için 107 → 108 olacak.
- Birim sınıfları ve değişmezlik, legacy kalemsiz okuma, motor/bağ/şekil retleri, üç döviz ve yuvarlama, ödenek, sürüm izolasyonu, kur karşılaştırması ve digest kapsamı için test yazılacak. Rules denetimi yalnız mevcut demo koşucusunun 8180/4410/4510 portlarında çalıştırılacak. Birim, XSS, Hosting, diff ve SHA-256 sonuçları walkthrough'a kaydedilecek.
- Ürün giriş noktaları bu modülü yüklemediği için geri dönüş H3-B dosyalarının kaldırılması, rehber bölümünün önceki metnine ve Hosting sayısının 107'ye dönmesine karşılık gelir. Veri geri yazımı gerekmez. H4'ün servis/Rules ve yedek/restore kapıları ayrı kalır.
