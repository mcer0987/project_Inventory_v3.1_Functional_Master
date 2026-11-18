# H4 walkthrough ve doğrulama

10 Kasım 2026. **Satın alma–evrak servis köprüsü ve demo kurtarma tamamlandı.** Çalışma yerel dalda. Kullanıcıya yeni talep yolu H5/H6a kabulünden sonra açılacak.

## Kapsam

Dal `feat/v3.4-ebys-tamamlama-h0`, HEAD `883da91e947152d41dd6f56cbb8b6b27c1dbf10b`. H4 başlangıcındaki 112 yayın dosyasının tamamı ara yayının manifestosuyla eşleşti. Başlangıçtaki 553 çalışma dosyasından 548'i hash düzeyinde aynı. Mevcut beş dosyada yalnız aşağıdaki H4 farkları var.

| Mevcut dosya | H4 farkı |
|---|---|
| `src/services/ebys-document-service.js` | Atomik oluşturma, kaydetme ve dondurma. Yetkili satın alma görünümü ve kişisel kopya |
| `src/services/ebys-process-service.js` | Şema 2 süreç bağı, kur önizlemesi, ilk olumlu kararla nested finans ve oturum/işlem tekrar kontrolü |
| `firestore.rules` | Motor/rol ayrımı, karşılıklı bağ, şema 2 sürüm, ilk finans ve erişim kuralları |
| `tools/ebys-local-recovery.mjs` | H1 v1 paketine ek olarak H4 v2 yakalama, doğrulama ve create-only restore |
| `2026-11-07_EBYS_Rehberi_Revizyon_Taslagi.md` | Planlanan talep, evrak, onay ve icra için beş kullanım adımı |

Eklenen beş dosya uygulama planı, bu rapor, `tests/rules/ebys-purchase.test.mjs`, `tests/rules/ebys-purchase-recovery.test.mjs` ve gerçek servis test koşucusu `tests/rules/helpers/ebys-purchase-harness.mjs`. HTML/CSS/UI, H3-A prototipi, H3-B saf yardımcıları, Firebase yapılandırması, indeksler ve stok seri numarası değişiklikleri başlangıç hash'leriyle eşleşti. Hosting 108 dosyada kaldı.

Kanıt dizini `scratch/ebys-h4-evidence/`. `baseline.patch` başlangıç çalışma ağacını, `package.patch` yalnız H4 farkını, `baseline-verification.json` korunmuş dosya hash'lerini gösterir. Son ürün Rules SHA-256 değeri `adbcba563a06ae749ed679ea80e8add36b97ad32e6d9bd4ba8c6ee047e6f91b1`.

## H5 için servis sözleşmesi

- `createPurchaseDocument` birim belge yolu, kurum kodu, metin, üstveri, kalemler, ödenek ve modunu alır. Gerçek oturum sahipliği kullanılır. İlk komut aynı `operationId` ile tekrarlandığında aynı P döner. `savePurchaseDraft` ayrıca `id` ve `expectedRevision` alır. `reopen: true` iade, red veya geri çekme sonrası yeni taslağı açar. İşaretçi revizyonu son taslak kaydını gösterir.
- `freezePurchaseVersion({ documentId, expectedRevision, operationId })` bağımsız V döndürür. Taslak teklifi birebir kullanılır. Tarihsel birim künyesi, o anda aynı kökte aktif olan gerçek birim belgesinden alınır. Şema 2 özeti metni, üstveriyi, boş ek listesini, teklifi ve künyeyi bağlar.
- `getPurchaseView({ purchaseOrderId, versionId })` sabit V ve o V'nin finansını okur. `finance: null` mali kaydın henüz oluşmadığını ifade eder. Yetki hatası ayrı döner. V verilmediğinde legacy görünüm veya sahibin düzenlenebilir taslağı açılır. Geçmiş ekrandan V açıkça iletilir.
- `getPurchaseApprovalPreview({ purchaseOrderId, versionId })` V'ye bağlı `rateSource` ve `reportingTotalTRY` döndürür. İlk olumlu kararda `decideTask` aynı V için `fxPreview: rateSource` alır. `purchase-rates-changed` yeni tutarı gösterip yeniden karar isteme durumudur. `purchase-rates-unavailable` yönetici kur ayarının eksik veya geçersiz olduğunu bildirir. TRY-only önizleme kur kaynağı istemez.
- H5 bir kullanıcı işlemi için `operationId` değerini bir kez üretip ağ yanıtı kaybolduğunda aynı payload ve kimliği tekrar gönderir. Yeni karar veya düzeltilmiş tutar yeni işlem kimliği gerektirir. İlk paraf, onay ve olur aynı `approved` sonucunu kullanır. Son olumlu adım icra işini açar. Stok ayrı bir işlemdir.

Ürün kaynaklarındaki beş yeni komut referansı yalnız modül dışa aktarımlarıdır. Başlangıca göre ek Firestore dinleyicisi, arka plan okuması, sayaç veya yeni geniş sorgu yok. Kişisel kopya ve H5'in kullanacağı görünüm/kur önizlemesi açık çağrıyla sınırlı. [Kaynak taraması](../../scratch/ebys-h4-evidence/product-scope.json)

## Gerçek servis ve Rules kanıtı

Aşağıdaki koşul ve yetki testleri gerçek Firebase SDK işlemlerini ve yerel ürün `firestore.rules` dosyasını kullandı. Koşucu modül importlarını VM bağlamına aldı. Servislerin komut gövdeleri aynen çalıştı. Düzenli ret testlerinde hatanın ifade/erişim sınırından gelmediği ayrıca denetlendi.

| İddia | Gerçek test adı veya komut | Sonuç / kanıt |
|---|---|---|
| P bağı atomik ve tekrar güvenli | `H4 yarım bağ veya farklı yol ID atomik reddedilir; kayıt kalmaz` · `H4 aynı taslak iki çağrı tek bağ; stale revizyon ve dondurma yarışı güvenli` | Geçti · `rules.log` |
| Pasif/eksik/farklı kök, sahte sahip ve unit kaynağı reddedilir | `H4 pasif/eksik/farklı kök birim; sahte ad ve başka owner bağları reddedilir` | Geçti · `rules.log` |
| İşaretçi son taslak revizyonunda kalır. Dondurulan künye ad değişikliğinden etkilenmez | `H4 gerçek sahip, ortak birim, kayıt/dondurma ve küçük tarihsel künye` | Geçti · `rules.log` |
| Eski yazım yolu yeni motoru ezemez. Mevcut legacy düzenleme ve onaylar çalışır | `H4 owner ve admin için eski overwrite/motor değişimi/silme kapalı` · `H4 legacy kalemsiz ve kalemli görünüm, aynı UUID üzerinde sonradan bağ kurmayı engeller` · legacy 10 adım regresyonları | Geçti · `rules.log` |
| İlk olumlu adım mali kayıt açar. Tek adımlı akışta icra aynı commit'te oluşur | `H4 tek adım ilk=son onay: finans + iş tek atomik işlem; yönetici içerik alamaz` · `H4 satın alma görünümü ve önizleme açık V ile sınırlı, boş finans ve ret ayrı` | İlk paraf ve ilk onay geçti. Üç döviz toplamı 2.317,23 TRY · `rules.log` |
| Kur değişir/eksilirse olumlu karar ilerlemez. TRY-only, red ve iade ayrı çalışır | `H4 onaydan önce kur değişirse yeni tutarı sessizce onaylamaz` · `H4 TRY yalnız kur ayarı istemez; red/iade finans üretmez` · açık V/önizleme testi | Geçti · `rules.log` |
| Tek finans otoritesi. Sahte/eksik finans, yanlış özet, çapraz kimlik ve eksik icra bütün işlemi durdurur | `H4 finans/iş eksik, çapraz finans yolu, yanlış kur/digest tüm transactionı reddeder` · `H4 taslak atlatma, sahte künye/sürüm ve bağımsız finans yazımı reddedilir` | Geçti. Sürüm/finans değişmez. Başarısız kararda stok, finans ve icra yazımı 0 · `rules.log`, `measurements.json` |
| Geçmiş V sabit, gelecek görevli/ilgisiz kişi/anonim erişimi kapalı | `H4 iade yeni sürüm: ilk mali kayıt sabit; eski imzacı V2 fiyatını alamaz` · `H4 altı adım; ilk/ara/son maliyet, gelecekteki görevli finansı okuyamaz` | Geçti · `rules.log` |
| Tekrarlayan görevli, H0 süre sınırı, vekil ve geri çekme korunur | `H4 A-B-A-A; eski kararlar aynı görevde korunur` · `H4 vekil ilk karar ve finans aktörüdür; asıl görevli sırası olmadan okuyamaz` · `H4 geri çekme mali geçmişi korur; yeni görev ve icra üretmez` · mevcut H0 saat/süre testleri | Geçti · `rules.log` |
| Kayıp yanıt aynı aktör/komut/payload ile doğrulanır | `H4 aynı komutun kayıp yanıtı geri okunur, oturum/kök değişimi veya başka payload başarı sayılmaz` · `H4 aynı operationId iki paralel karar tek sonuç; farklı payload aynı başarıyı alamaz` | Geçti · `rules.log`, `retry-measurements.json` |
| İcra havalesi, kabul/iade, kapanış ve stok sınırı korunur | `H4 havale yok/pasif sorumlu son onayı atomik durdurur` · `H4 icra kabul/iade/havale; sahte stok ve bildirimsiz kapanış reddi` | Geçti · `rules.log` |
| Kişisel kopya ve bağımsız operatör paketi, V1/V2 ve QR ayrımını korur | `H4 kişisel kopya ve demo kurtarma V1/V2 finansını, kapanışı ve kamusal QR kapsamını korur` · `H1 emülatör kurtarma: QR, iki sürüm, erişim, paket reddi ve create-only` | Geçti · `rules.log`, `recovery-measurements.json` |

## SDK ölçümü ve Rules bütçesi

Tek denemeli demo örnekleri aşağıdadır. Okuma sayısı SDK belge çağrılarını, yazma sayısı başarılı işlemde gerçekleşen yazıları gösterir. Rules bağımlılıkları, kesin ifade sayısı, fatura ve üretim kotası bu ölçümün dışındadır.

| Komut | SDK okuma | Yazma |
|---|---:|---:|
| Yeni veya düzenlenen taslak | 5 | 5 |
| İade sonrası yeniden açma | 6 | 5 |
| Kayıt numarası | 3 | 4 |
| Dondurma | 4 | 4 |
| Süreç başlatma, 1 / 2 / 4 / 6 adım | 5 / 6 / 8 / 10 | 4 |
| İlk ve son olumlu karar, döviz | 10 | 7 |
| İlk ve son olumlu karar, TRY | 9 | 7 |
| Altı adımda ilk / ara / son karar | 8 / 5 / 7 | 6 / 5 / 6 |
| İlk red / iade, geri çekme | 4 | 5 |
| Vekâlet | 5 | 5 |
| Aynı oluşturma, dondurma veya karar tekrarı | 1 | 0 |
| Sabit sürüm görünümü / döviz önizleme | 2 | 0 |
| Sahip taslak görünümü | 3 | 0 |
| İcra tamamlama | 2 | 4 |

H3-A'ya göre taslakta ek SDK okuması önceden var olan taslağa bağ kurulmasını engelleyen noktadır. Beş taslak, dört dondurma ve yedi ilk-son karar yazımı H3-A ile eşleşti. Yeniden açma önceki süreç durumunu okur. Politika varsayılanı veya kayıt numarası çakışması ek okuma gerektirebilir. Kayıp karar yanıtında taze işlem teyidiyle 11 okuma ve 7 yazma ölçüldü. Beş reddedilen ilk-son karar isteği 6–7 yazı hazırladı ve 0 yazı gerçekleşti. Yeni taslak/dondurma en çok üç SDK denemesi kullanır. Süreç komutlarının mevcut SDK tekrar ayarı korunur. Ham yollar, gerçekleşen yazılar ve denemeler `measurements.json` ve `retry-measurements.json` dosyalarında.

İlk geniş kalem doğrulaması 1000 ifade sınırına takıldı. İşaretçi toplamları, zorunlu işlem kaydı sayısal kalem alanlarını, zorunlu olay kaydı kalem metinlerini denetleyecek şekilde ayrıldı. Üç belge aynı transaction'a bağlı. Legacy rol/motor dalları koleksiyon sabitleri çıkarılarak sadeleştirildi. H0'da alanı bulunmayan eski sürüm şema 1 olarak okunuyor. İlk başarısız koşular `focused-first.log`, `focused-second.log` ve `rules-first.log` içinde. Nihai olumlu üç kalem, altı adım ve legacy on adım senaryoları geçti. Rules kaynağı, rolleri, bağı ve şekli denetler. BigInt hesabı ve kanonik özet servis ve kurtarma katmanında tekrar doğrulanır.

## Export ve restore

Kişisel kopyada H1'in 400 istek/500 belge sınırı korunur. H4 kayıtları varsa kişisel manifest v3, yetkili işaretçi ve V bazlı tam finans yolunu taşır. Dahil, henüz oluşmamış, eksik ve erişim reddedilmiş durumlar ayrıdır. Legacy kişisel kopya şema 2 kalır. Demo örneği 24 istek ve 48 dönen belge kullandı.

Operatör v2 biçimi ayrı amaç ve bütünlük doğrulaması kullanır. İki durgun tarama sırasında nested finans, yalnız paketteki sabit sürümlerden türetilen P/V noktalarından alınır. Legacy üst finans yolu farklı bir veri modelidir. V1/V2 finansı ilk olumlu karar, aktör, işlem ve zaman bağıyla doğrulanır. Eksik finans, yanlış yol/owner, eksik karar geçmişi ve bozuk özet yazma öncesinde reddedildi. Önizleme 0 yazdı. Boş `demo-ebys-h4-recovery-target` projesine 68 belge bir create-only commit ile geri yüklendi. Kaynak 54 istek/136 dönen belge, önizleme 27 istek, restore ve son doğrulama 55 istek/68 yazı. Kaynak ve hedef ayrı demo proje adlarıyla test emülatöründe çalıştı. Kapanış, geçmiş/gelecek imzacı sınırı ve beş alanlı kamusal QR yanıtı korundu. Güncel kur ayarı kapsam dışıdır. Restore sonrası bekleyen bir döviz kararını almak için hedef ortamda geçerli kur ayarı gerekir.

## Son denetimler ve geri dönüş

| Denetim | Sonuç | Çıkış | Kanıt |
|---|---:|---:|---|
| `npm.cmd run test:unit` | 352/352 | 0 | `unit.log` |
| `npm.cmd run test:rules` | 379/379, 22 yeni H4 testi | 0 | `rules.log` |
| İki H4 gerçek servis ve restore dosyası, ayrı odak koşusu | 22/22 | 0 | `integration.log` |
| `npm.cmd run lint:xss` | 989 dinamik ifade, 0 izinsiz | 0 | `xss.log` |
| `node scratch/hosting-files.js` | 108/108 | 0 | `hosting.log` |
| `git diff --check`, paket ve hash doğrulaması | Geçti | 0 | `diff.log`, `package-diff-check.json`, `baseline-verification.json` |

Koşucu 8180/4410/4510 portlarında `demo-rules-test` kullanır. Test grupları ürün kurallarını kendi demo projelerine yükler. Manuel 8080/9099 ortamına müdahale edilmedi. H4 yalnız yerel dosyalarda ve emülatörde uygulandı. Yayın işlemi, commit ve canlı Firebase yazımı yapılmadı.

H5'te görünüm/önizleme/karar komutları, çıktı ve erişilebilir yardım bağlanacak. H6a'da personel giriş akışı tamamlanacak. Yeni panelde kısa görünür amaç ve erişilebilir yardım koşulu geçerli. Canlıda H4 verisi oluşmadan yerel geri dönüş, paket dosyalarını başlangıç kopyalarına döndürmektir. İleride H4 kayıtları oluşursa geri dönüş yeni oluşturmayı durdurur. Mevcut işlerin okunması, bitirilmesi ve kurtarılması için uyumlu motor korumaları, Rules ve nested finans desteği sürdürülür.
