# H3-A — Birim, satın alma sürümü ve tek onay motoru sözleşmesi

Başlangıç: 9 Kasım 2026; doğrulama ve teslim çalışması: 10 Kasım 2026. Dal `feat/v3.4-ebys-tamamlama-h0`, HEAD `883da91`. **Bu bir ürün yayını değildir.** Çalıştırılabilir örnek yalnız `tests/prototypes/ebys-h3/` içindedir. Son kabul durumu H3-A Walkthrough belgesindedir.

## 1. Bugünkü kod ile hedef arasındaki fark

| Bugünkü kaynak | Gözlenen davranış | Yeni yol için karar |
|---|---|---|
| `src/services/purchase-servises.js:248` | `Date.now()` kimliği, kalemler, ad olarak `birim`, ayrı `workflow` | Eski talepler aynen kalır. Yeni EBYS talebi UUID ve ortak birim yolu kullanır. |
| `src/services/firebase-handler.js`, `purchaseFinance` yazımı | İlk olumlu karar talep başına mali kaydı aynı batch'te yazar | Legacy ana finans kaydına dokunulmaz; yeni yol sürüm başına kesinleşir. |
| `firestore.rules`, genel `/{root}/{col}/items/{docId}` eşleşmesi | Admin ve personel için ayrı satın alma yazma dalları | Her dal yeni motoru dışlamalı; özel kural eklemek tek başına yeterli değil. |
| `src/services/ebys-document-service.js:83` | Sürüm 1 yalnız metin, üstveri ve boş ek listesi | Yeni satın alma sürümü şema 2 ile teklif ve küçük birim künyesi taşır. |
| `src/services/ebys-process-service.js`, `decideTask` | Sürüm başına süreç; son onay aynı işlemde icra işi açar | İlk olumlu karara mali kesinleştirme eklenir. Karar otoritesi aynı süreç kalır. |
| `src/services/ebys-document-service.js:164`, `tools/ebys-local-recovery.mjs` | H1'in mevcut evrak, QR ve icra kapsamı | Yeni satın alma işaretçisi ve iç içe finans yolu ayrıca paketlenmeden yeni yol yayımlanamaz. |

## 2. Kimlik ve otorite tablosu

Aşağıda `R` izinli mevcut kök, `P` yeni talep/ana evrak UUID'si, `V` sürüm/süreç UUID'sidir. Her yol aynı `R` içinde çözülür. Payload kimliği yol parametresini değiştiremez.

| Yol | Otorite / alanlar |
|---|---|
| `R/purchaseOrders/items/P` | **İşaretçi**: `id=P`, `ebysDocumentId=P`, `engineVersion='ebys-v1'`, `schemaVersion=2`, `createdByUid`, `unitId`, `birim`, `documentTypeCode='PURCHASE_REQUEST'`, `revision`, `createdAt`, `updatedAt` |
| `R/ebysDocuments/items/P` | Ana yaşam döngüsü; mevcut başlık alanlarına değişmez `purchaseOrderId=P` eklenir. `kind='internal'`. |
| `R/ebysDrafts/items/P` | Düzenlenebilir metin/üstveri ve `purchaseSnapshot`. Sahibe özel. |
| `R/ebysVersions/items/V` | Değişmez metin/üstveri, `schemaVersion=2`, `purchaseSnapshot`, `unitSnapshot`, `documentId=P`, `processId=V`, sürüm numarası ve içerik özeti |
| `R/ebysProcesses/items/V` | Mevcut sıra/karar otoritesi ve değişmez `purchaseOrderId=P` |
| `R/purchaseFinance/items/P/versions/V` | İlk olumlu kararda create-only mali kesinleştirme; eski talep başına üst belgeyle aynı belge **değildir** |
| `R/ebysTasks/items/{V}__{uid}` | Mevcut görev/karar erişimi; yeni okuyucu dizisi yok |
| `R/ebysExecutionJobs/items/V` | Mevcut deterministik icra işi; yalnız son onayda açılır |

Yeni işaretçide kalem, metin, kur, `workflow` veya karar geçmişi tutulmaz. İçeriği iki ayrı erişim modeline kopyalamak ve her kararda satın alma durumunu senkronlamak gereksiz maliyet ve sızıntı oluşturur. H4'ün görünüm adaptörü mevcut satın alma ekranına yetkili başlık/taslak/sürüm verisinden görünüm sağlamalıdır. **Bugünkü ekranların bu işaretçiyi desteklediği iddia edilmez.**

Talep ile ana evrak aynı UUID'yi kullanır; üçüncü bir ilişki rezervasyon koleksiyonu gerekmez. İkisi ilk taslakla aynı transaction'da yaratılır; önceden mevcut bir kayda sonradan bağ takılamaz. Başlık ve işaretçi sahipleri aynı gerçek UID'dir. Taslak kaydında işaretçi revizyonu o başlık revizyonuna yetişir; kayıt/dondurma/karar işlemleri işaretçiye ek senkron yazımı yapmaz. Dolayısıyla işaretçi `revision` değeri son **taslak kaydı** revizyonudur; güncel süreç revizyonu değildir.

## 3. Legacy motor ve kalıcı birim

Motor alanı yok veya `legacy` ise mevcut akış uygulanır. Eski sayısal ID'nin yol karşılığı `String(id)` olarak okunur; kayıtlar UUID'ye çevrilmez. Yeni motor sonradan değiştirilemez, silinemez, eski tam `setDoc` ile ezilemez. Yönetici geniş allow dalı da bu korumayı aşamaz. Legacy→yeni sessiz dönüştürme, geçmiş imzadan yeni karar üretme ve iki motora aynı anda karar yazma yoktur.

Yeni kayıt `units` belgesinin **yol kimliğini** kullanır. Birim adı ID değildir; aynı ad birden çok birime ait olabilir. Seçimde ad + mevcut kod/kurum/üst birim; bunlar da aynıysa kısa kalıcı kimlik gösterilir. Personelin bağlı birimi, talebin ilgili birimi ve icra birimi ayrı kavramlardır. Personelin başka birime meşru talep açmasını engelleyen yeni bir kısıt getirilmez.

`birim` eski liste uyumluluğu için taslak kaydında seçilen ortak kaynaktan alınır. Dondurmada `unitSnapshot` güncel ortak birimden sabitlenir. Sonraki ad değişikliği geçmiş sürümü değiştirmez. Pasif/eksik birim yeni kayda veya dondurmaya seçilemez; eski sürümün okunması için birimin hâlâ aktif olması aranmaz. Kökler birbirine alternatif kaynak değildir.

Legacy ad eşleme yalnız yerel JSON üzerinden salt okunur rapordur. Kimliği olan kayıt, tek aday, belirsiz ad, pasif aday, bulunamayan/eksik ID ayrı sınıflandırılır. **Tek aday bile otomatik geçmiş yazımı yetkisi değildir.** Silinmiş açık ID, aynı ada bakılarak başka ID'ye çevrilmez. Gerçek kurumda backfill yapılmamıştır.

## 4. Teklif, mali kesinleştirme ve özet

`purchaseSnapshot` zorunlu alanları: `purchaseOrderId`, `documentTypeCode`, `items`, `totals`, `butce`, `budgetMode`, `calculationVersion=1`.

- Mevcut pilot: 1–3 kalem; TRY/USD/EUR. Kalem alanları `id`, `description`, `category`, `quantity`, `unit`, `unitPrice`, `currency`, `taxRate`, `totalPrice`.
- İstemci sözleşmesi mevcut `PurchaseMoney` ile aynıdır: miktar en çok 3, fiyat/KDV en çok 2 ondalık; pozitif miktar, KDV 0–100; açıklama 240, tür 120, birim 40 karakter; tekrar eden kalem ID yok; BigInt ölçek/yarım-yukarı yuvarlama ve mevcut üst tutar sınırı.
- `totals`: üç para birimi için `subtotal`, `tax`, `total`; manuel/otomatik ödenek ayrı `butce` ve `budgetMode`. Ödenek mali hesap toplamı gibi yeniden yorumlanmaz.
- Taslak teklif ve sürüm teklifi birebir aynı olmalıdır. Sürümün daha sonra update/delete edilmesi yasaktır.

İlk **olumlu** karar, `currentStep==0` ve sonuç `approved` olan karardır. İlk adım paraf veya onay/olur olabilir; mevcut servis bu adımlarda aynı olumlu kararı kaydeder. İlk iade/red finans oluşturmaz. İlk ve son adım aynıysa finans + karar + başlık + görev + icra işi + işlem/olay günlükleri tek transaction'dadır.

Yeni finans zorunlu alanları: `schemaVersion=2`, `purchaseOrderId=P`, `versionId=V`, `contentDigest`, `actorUid`, `operationId`, `exchangeRate`, `exchangeRateDate`, `exchangeRateSource`, `reportingTotalTRY`, sunucu `createdAt`. İlk olumlu süreç geçişi bu belgenin aynı istekte oluşmasını; finans yazımı da o süreç geçişini gerektirir. Değiştirme/silme/list kapalıdır.

Kur kaynağı mevcut `system_config/items/ebys_rates` belgesidir. Onaycıya gösterilen `{rates,date,source}` ile transaction'da taze okunan kaynak karşılaştırılır; değişmişse işlem durur, yeni tutar gösterilir ve yeniden onay istenir. Rules, yazılan kur/tarih/kaynağı o kökteki yönetici kaydıyla karşılaştırır. Bu görünürlük kontrolü istemcideki bir kullanıcının gerçekten ekranı okuduğunu kanıtlayamaz; keyfî kur yazmasını sunucu kuralı engeller. Yeni ayar revizyonu/sayaç yazımı gerekmiyor. Salt TRY için kur kaynağı gerekmez; oranlar 1, kaynak `TRY` olur. Dövizli talepte kaynak yoksa tüm işlem durur.

İade sonrası yeni V2'nin ilk olumlu kararı ayrı finans yaratır; V1'in kur/tutarı değişmez. Aynı `operationId` + payload tekrarı mevcut işlem sonucu ile döner; farklı payload eski başarıyı alamaz. Eski revision ile farklı komut çatışma verir. UI çift tıklamayı kapatmalı, yanıt kaybında **aynı işlem kimliğini** yeniden kullanmalıdır; tüm yeni kimlikli tekrarlar kendiliğinden başarılı sayılmaz.

Yeni sürüm SHA-256 kapsamı: `{content, metadata, attachments:[], purchaseSnapshot, unitSnapshot}` kanonik nesnesi. Sonradan doğan finans bu hash'in içinde **değildir**; finans sürüm hash'ine, V'ye ve karar işlemine bağlıdır. İleride çıktı teklif özeti ve ilk onay finansını ayrı göstermelidir. Yeni finans hash'i/token koleksiyonu eklenmez. Mevcut QR kamusal alanlarına fiyat/kalem/PII eklenmez.

**Pilot sınırı:** Mevcut Rules `poItemsOk` şekil, para birimi, temel sayısal sınır/etiket kontrolünü yapar; tüm BigInt aritmetiğini veya SHA-256 hesabını sunucuda yeniden üretmez. İstemci hesaplamasının doğru olması tek başına saldırgan tarafından değiştirilen toplamın matematik doğruluğunu kanıtlamaz. Yeni tasarım bunu “tam muhasebe doğrulaması” diye sunmaz; mevcut sınır korunur. Kullanıcıya ücretli backend gerektiren bir özellik gizlice eklenmez.

## 5. Tarihsel künye

`unitSnapshot={unitId,name,code,organizationId,organizationCode,source:'units'}` dondurma anında alınır. Birim adı/kodu/kurum ID'si gerçek ortak birim belgesine eşittir. `organizationCode` mevcut başlıktaki kullanıcı kodudur; doğrulanmış kurum sicili sayılmaz. Tüm personel kataloğu kopyalanmaz. İmzacının UID ve görünen adı mevcut rota/karar yapısında ayrı kalır; aynı isim yetki vermez.

H6b'de gerçekten gereken ortak künye için mevcut `system_config` içinde küçük bir `ebys_organization` belge sözleşmesi önerilir: şema/revizyon, kurum adı/kodu ve sınırlı adres bilgisi. Birim `organizationId` bağı açıkça doğrulanır, sürüme yalnız gereken alanlar alınır. H3'te bu belge/panel/kurumsal doğrulama oluşturulmaz.

## 6. Erişim ve sorgu sınırı

| Aktör | İşaretçi/başlık | Taslak | Atanmış sürüm / o sürümün finansı |
|---|---|---|---|
| Sahip | Kendi kaydı | Kendi kaydı | Kendi sürümleri |
| Aktif görevli | Yetkili EBYS başlığı; işaretçi özel içeriğin kestirmesi değil | Hayır | H0 görev süresi ve sıra koşuluyla evet |
| Gelecek görevli | Sadece ilişki ID'si yetki vermez | Hayır | Hayır |
| Geçmiş karar sahibi | Mevcut başlık için ayrıca güncel yetki gerekebilir | Hayır | Karar verdiği sabit sürüm; yeni sürüme geçmez |
| Vekil | Aktif görev koşulları | Hayır | Süreli gerçek aktör; karar verdiyse kendi karar geçmişi |
| İcracı | Aktif icra görevi koşuluyla | Hayır | Kendisine atanmış, mevcut kuralların izin verdiği iş durumunda |
| Yalnız yönetici | Yönetim başlık/işaretçi listesi | Başkasının taslağı hayır | Salt admin rolü özel içeriği açmaz |
| Yabancı/anonim | Hayır | Hayır | Hayır |

Yeni finans `get` yetkisi sürümün owner/görev/icra yetkisine bağlıdır. Parent legacy finans kuralı nested finans yoluyla eşleşmez. Yeni bir `list` veya collection-group açılmaz. H4 listeleri açık sayfa ve mevcut yetkili sorgularla sınırlamalı; istemci filtresi Rules'un yerini tutmaz. İçerik “yükle” isteği doğru görevdeki V'ye gider; currentVersionId'ye sessiz atlama yoktur.

## 7. Atomiklik, maliyet ve kurtarma

Taslak komutu işaretçi + başlık + taslak + operation + event yazar. Dondurma sürüm + başlık + operation + event yazar. Finans yalnız ilk olumlu karara bir write ekler. Olay, görev süresi veya erişim kontrolü bütçe kazanmak için çıkarılmaz. Kalem doğrulaması aynı istekte yazılan işaretçinin kuralına yerleştirilir; taslak kuralı işaretçinin yeni başlık revizyonuna ulaştığını zorunlu kılar. Böylece doğrulama atlanmaz, tek bir kural dalı gereksiz büyümez. Tam ölçümler Walkthrough/SDK günlüklerindedir.

Aktif listener, polling, yeni sayaç, per-card okuma yok. Prototipte SDK transaction üst sınırı 3 denemedir; gerçek istek miktarı denemelerle artabilir. SDK çağrı sayısı, Rules bağımlı okumaları veya fatura sayısı değildir. Resmî sınırlar: istek başına 1000 ifade; tek işlemde 10, atomik istekte toplam 20 belge erişimi ve her alt işlem için yine 10. Erişim önbelleği hesabını kesin fatura diye sunmuyoruz. Kaynaklar: [Firestore kotaları](https://firebase.google.com/docs/firestore/quotas), [Rules erişim çağrıları](https://firebase.google.com/docs/firestore/security/rules-conditions#access_call_limits).

H1 genişletme zorunlulukları, **H4/H5 yayın kapısı**:

1. Yetkili sürümlerden P/V çiftlerini çıkar; nested finansı nokta okumasıyla, sınırlı sayfa/istek bütçesinde dışa aktar. Genel finans taraması yok. Yetkisiz/eksik/henüz oluşmamış ayrı kaydedilir.
2. Manifest şeması nested finansın tam yolunu, engine/schema sürümünü ve kapsanan/eksik adetlerini belirtir. İşaretçi de sahip kapsamına dahildir; yalnız başlık ID'si içerik izni sayılmaz.
3. Operatör paketinde iki motor ayrılır; P==başlık ID, V==processId, owner, hash ve mali kaynağın referans zinciri kontrol edilir. Yeni digest kapsamı mevcut metin sürümü hash'iyle karıştırılmaz.
4. Boş demo hedefte restore; eski imzacı yeni fiyatı okuyamaz, QR yalnız kamusal özet verir, immutable finans/sürüm ve kapalı iş kalır. Restore hazır olmadan yeni talepler açılmaz.

Bu H3-A prototipi yeni satın alma paketinin restore'unu tamamlamaz. Mevcut H1 kurtarma testleri eski şemada regresyon kapısıdır. Yeni dosya ekleri yok; legacy indirme URL'leri yeni sürüm yetkisiyle korunmuş sayılmaz.

## 8. Sıradaki uygulama sınırları

**H3-B:** Saf şema/kimlik yardımcıları, legacy birim eşleme sonuç türleri, ortak birim ID seçimi hazırlığı ve testler. Yeni motorun kullanıcıya açılması veya aday Rules'un ürün Rules'una kopyalanması bu görev değildir. Bugünkü çalışan akış korunur.

**H4:** Servis/Rules köprüsü, görünüm adaptörü, tek motor korumaları, ilk onay entegrasyonu ve sınırlı yedek/restore uyarlaması. **H5:** ekran, onay/çıktı ve rehber entegrasyonu; yeni yol ancak uçtan uca kabulden sonra açılır. Gelecek imzacı/finans, yeni sürüm, tekrar, stok ve QR testleri yayın kapısıdır.

Rollback: yeni EBYS satın alma oluşturmayı kapat; oluşmuş işleri okuyup bitirme desteğini koru. Eski Rules'a dönmek motor kilidini kaldırabilir; eski full-set istemcisi işaretçiyi bozabilir. Bu yüzden eski kaynaklara kör dönüş, toplu rewrite ve canlı backfill yoktur. Açık ürün tercihi: mevcut pilot/ilk onay/legacy sınırları korunur; yeni ürün onayı gerektiren ek davranış bu sözleşmeye dahil edilmemiştir.
