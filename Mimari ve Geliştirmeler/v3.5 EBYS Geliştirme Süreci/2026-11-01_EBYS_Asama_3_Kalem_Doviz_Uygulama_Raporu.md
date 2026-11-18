# EBYS Aşama 3 — Kalemli satın alma ve döviz uygulama raporu

**Dal:** `feat/v3.4-ebys`
**Başlangıç commit'i:** `5be0579` (Aşama 2)
**Durum:** Yerel uygulama ve testler tamamlandı; Aşama 3 kodu commit edilmedi, deploy edilmedi.
**Pilot:** Vanilla JS / Firebase Spark / Cloud Functions olmadan.

## Uygulanan sözleşme

1. `purchaseOrders` eski `urun`, `adet`, `butce`, `birim`, `tur` alanlarını korur. Yeni kayıt `items` ve para birimi başına `totals` ekler. `urun` talep konusudur; `adet` ilk kalemin miktarıdır; `butce` ödenek olarak kalır, satır toplamı yerine geçirilmez. Eski kayıtlar veritabanına göç yazılmadan sanal tek kalemle gösterilir. Eski `butce` değerinden fiyat/KDV uydurulmaz.
2. Kalem alanları `id`, `description`, `category`, `quantity`, `unit`, `unitPrice`, `currency`, `taxRate`, `totalPrice` olarak kaydedilir. TRY, USD, EUR desteklenir. Pilot üst sınırı **üç kalemdir**; hesap, UI ve Rules aynı sınırı uygular.
3. Fiyat iki, miktar üç, KDV iki ondalık basamağa sınırlandırılır. Metin girdisi `BigInt` ölçeğine çevrilir; kalem net tutarı ve KDV yarım-yukarı kuruş yuvarlamasıyla hesaplanır. Para birimleri birbirine karıştırılmadan ayrı ara/KDV/genel toplam gösterilir.
4. Proje sahibinin seçtiği politika: ilk onayda manuel kur ve kaynak. TRY talebi `TRY:1` mali anlık görüntüsü alır. Dövizli talepte sıradaki onaylayıcı 1 USD/EUR için TRY kuru, kur tarihi ve kaynak/referansı girer. `exchangeRate`, `exchangeRateDate`, `exchangeRateSource`, `reportingTotalTRY` aynı onay yazımıyla kaydedilir. Sonraki kararlar kur alanlarını değiştiremez. Detay ve yazdırma TRY karşılığını dondurulmuş kur ve kalemlerden yeniden türetir; canlı kur çağrısı yoktur.
5. İki satın alma formunda aynı başlıklı ve yatay kaydırılabilir kalem tablosu kullanılır. Satır ekleme/çıkarma, canlı toplam, detayda salt okunur satırlar ve yazdırma görünümü eklendi. Aktif onay akışında mali içerik düzenleme UI'da ve Rules'da engellenir. İlk onaydan sonra geri çekilen yeni kalemli belge, önceki kur/karar bağlamını korumak için dondurulur; değişiklik veya yeniden onay için yeni talep açılır. İlk onay almamış ve eski tek ürünlü taleplerin geri çekme/düzenleme akışı korunur.

## Güvenlik ve karar sınırları

- Firestore kuralları kalem listesinin varlığını/üst sınırını, gerekli anahtarlarını, para birimini, açıklamadaki etiketleri, pozitif miktarı ve negatif olmayan fiyat/toplamı, KDV aralığını sınar. Legacy kayıtta `items` zorunlu değildir. Başlamış akışta admin dahil mali alan değişikliği engellenir.
- Firestore Rules bu mevcut 1000 ifade bütçesinde tüm kalemleri ayrıntılı tip/uzunluk denetimiyle ve matematiksel toplam eşitliğiyle doğrulayamaz. Üç kalem sınırı emülatör ölçümünden seçildi; dört kalemli meşru kayıt, daha gevşek kuralla bile ifade sınırına takıldı. `totals` ve `reportingTotalTRY` **sunucu tarafından yeniden hesaplanmış güvenilir mali kanıt değildir**. Normal istemci saf hesap motoru kullanır; detay/yazdırma kalemlerden yeniden hesaplar. Kurumsal mali kesinlik için sonraki aşamada güvenilir sunucu denetimi veya ayrı kalem belge tasarımı gerekir.
- Kur kaynağı ve tarih kullanıcı beyanıdır. Haricî kur API'si, resmî kur doğrulaması veya güvenilir sunucu saati bu pilotta yoktur. Tarih, istemcinin yerel gününden önerilir; onaylayıcı tarafından değiştirilebilir. Bu belge bir e-imza veya resmî kur teyidi üretmez.
- Ana plandaki seçimlik indirim hesabı, bu Aşama 3 görevinde verilen zorunlu kalem alanlarına dahil edilmediği için açılmadı. İndirim politikası (kalem/evrak düzeyi, vergi öncesi/sonrası ve kural denetimi) ayrıca kararlaştırılmalıdır.
- İlk onaydan sonra geri çekilen kalemli talepte kalem, tutar, konu, açıklama, birim, evrak numarası, öncelik ve ek alanları dondurulur; aynı kayıt üzerinden yeni revizyon/süreç başlatılmaz. Aşama 4/5'in sürümlü belge/süreç modeli geldiğinde önceki mali snapshot korunarak yeni sürüm açma akışı tasarlanmalıdır.
- Eski satın alma onay/kayıt yolu korunmuştur. Yeni kayıt oluşturulurken adımların boş olması ve tek başlangıç olayının doğrulanması, mevcut formun gerçek davranışına özel daha kısa kuraldır; bu kısaltma kalemli kayıtların kural ifade sınırına sığması için gereklidir.
- `release-journal/` altındaki üç dosya mevcut Hosting beyaz listesi denetimini hâlâ düşürüyor. Aşama 3 uygulama dosyaları için beklenen sayı 71'den 74'e çıkarıldı; diskte 77 dosya var. Deploy denenmedi.

## Doğrulama

| Kontrol | Sonuç | Kanıt |
|---|---:|---|
| `npm run test:unit` | 278/278 geçti | `scratch/ebys-stage3-unit.log` |
| `npm run test:rules` | 228/228 geçti; 24 suite | `scratch/ebys-stage3-rules.log` |
| `npm run lint:xss` | Yetkisiz sink 0 | `scratch/ebys-stage3-xss.log` |
| Gerçek tarayıcıda izole form testi | 9 kontrol, `pageerror` 0 | `scratch/ebys-stage3-ui.log`, `scratch/ebys-stage3-ui.cjs` |
| Syntax ve diff | `node --check`, `git diff --check` geçti | Yerel komut çıktısı |

Tarayıcı kontrolü gerçek Firestore, Auth veya canlı Storage bağlantısı açmaz. Admin ve personel oturumlarıyla uçtan uca UAT/deploy yapılmadı. Rules testleri yerel Firestore emülatöründe gerçek `firestore.rules` dosyasını yükler.

## İnceleme odağı

- Üç kalem pilot sınırı ile daha yüksek kalem sayısı için belge modeli kararı.
- Sunucu olmadan kur kaynağı ve mali toplamın doğrulanabilirlik seviyesi.
- İlk onay anındaki kur alanı ve karar geçmişinin ileriki EBYS sürüm mimarisiyle ilişkisi.
- Başlamış akış mali değişmezliği ve eski kayıtların görüntüleme/düzenleme davranışı.

Tam emülatör turunda bir kez mevcut denetim günlüğü testinin anlık `new Date()` değeri emülatörün `request.time` milisaniyesiyle çakıştı. Test, sabit farklı bir istemci zamanı kullanacak biçimde deterministik yapıldı; sonraki tam tur 228/228 geçti. Kuralın kendisi bu nedenle değiştirilmedi.
