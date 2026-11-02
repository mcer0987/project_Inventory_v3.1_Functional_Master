# EBYS — Bağımsız mimari, kural ve regresyon denetimi

**Tarih:** 1 Kasım 2026 · **Dal:** `feat/v3.4-ebys` · **HEAD:** `5be0579`  
**Kapsam:** Aşama 0/1 tasarımı, Aşama 2 tanımları ve Aşama 3 yerel kalem/döviz uygulaması.  
**Karar:** Düzeltme gerekli. Mevcut testler geçiyor; ancak “yenilikler eski altyapıyı bozmuyor ve katı sözleşmeler eksiksiz korunuyor” teyidi verilemiyor. İki P1 ve dört P2 bulgu var. Üretim kodu değiştirilmedi; commit, deploy ve canlı veri işlemi yapılmadı.

## 1. Kabul edilmiş sınırlar ve denetim yöntemi

Proje sahibinin açık kabulü gereği aşağıdakiler kusur sayılmadı:

- Talep başına üç kalem.
- Sunucuda kuruş/toplam eşitliğinin yeniden hesaplanmaması.
- Manuel kur ve kaynak beyanı; haricî kur teyidi yapılmaması.
- 50+ kalem gerektiğinde `purchaseOrderItems` alt koleksiyonuna geçiş yönü.

Bunlar; dövizli bir belgeyi gerekli kur olmadan onaylama, uygulamanın işleyemediği yapısal veri, eski düzenleme davranışının kaybı veya bir çıktıda iki farklı toplam kullanılması için kabul değildir. Bulgular bu ayrımla yazıldı. Öneriler otomatik kur servisi, Cloud Functions veya plan yükseltme zorunluluğu getirmiyor.

Raporlardaki başarı ifadeleri sonuç kabul edilmeden kaynak kod, commit kapsamı ve yeni karşı örneklerle sınandı. Mevcut unit/Rules/XSS paketleri ile iki izole tarayıcı testi yeniden çalıştırıldı. Ek denetim testleri yalnız yerel demo Firestore emülatöründe ve Firebase bağlantısı olmayan izole Chrome sayfasında çalıştı. Aşama 4/5'te uygulanacak DYS/görev erişim modeli bugünün tamamlanmış özelliği sayılmadı.

Çalışma ağacı envanter/içe aktarma geliştirmeleri ve rapor taşımaları da içeriyor. Bunlar geri alınmadı veya EBYS değişikliği olarak sınıflandırılmadı. `script.js` ve `index.html` ortak dosyalardır. Bu denetim ayrı temiz checkout üzerinde çalışmadı; kanıt manifestosu incelenen dosyaların hash'lerini kaydeder.

## 2. Bulgular

P1: Aşama kabulünden önce giderilmesi gereken sözleşme/regresyon. P2: İşlev, veri dayanıklılığı veya teslim bütünlüğü düzeltmesi.

### B01 — P1: İlk mali onay sözleşmesi tüm yazma yollarında zorunlu değil

**Kaynak:** `firestore.rules:222` (`poFxDecisionOk`), `firestore.rules:527` (admin update), `src/utils/purchase-money.js:96` (`reportingTry`).

Personel onayında `rates.get('USD', 1)` ve EUR karşılığı, kullanılmayan alanı varsayılan 1 ile geçiriyor. Kalemde USD kullanıldığı halde `{TRY:1}` snapshot'ı kabul ediliyor. Admin dalında ise mali alanlar değişmiyorsa snapshot doğrulaması hiç istenmiyor; ilk adım onaylanıp süreç tamamlanırken bütün kur alanları eksik bırakılabiliyor.

**Kanıt:** Ek emülatör testleri A1 ve A2. A1'de USD kalemi, yalnız TRY kuru ile `Onaylandı` oldu; aynı kayıt gerçek `reportingTry()` fonksiyonunda `USD kuru eksik` hatası verdi. A2'de admin ilk onayı hiç snapshot yazmadan kaydetti. C0 kontrolünde personelin snapshot olmadan onayı ve adminin aktif mali içerik değişikliği reddedildi; testlerin Rules yüklenmeden geçtiği varsayımı elendi.

**Etki:** İlk onayda dondurulmuş mali bağlam garantisi rol ve istemci yoluna bağlı kalıyor. Normal UI kur ister; doğrudan SDK isteği bu sözleşmeyi aşabiliyor. Bu bulgu kurun ekonomik doğruluğuyla değil, zorunlu snapshot'ın varlığı/tamlığıyla ilgilidir.

**Düzeltme/kapanış:** İlk onaya geçiş için admin ve personelde aynı snapshot zorunluluğu; kullanılan TRY/USD/EUR alanları için uygun pozitif kur varlığı. Sonraki kararlarda değişmezlik korunmalı. Eksik snapshot ve kullanılan döviz kuru negatif testleri; üç kalem, karma para ve mevcut 10 adım senaryoları birlikte geçmeli. Admin için farklı politika isteniyorsa açık bir ürün kararı ve ayrı kayıtlı müdahale sözleşmesi gerekir.

### B02 — P1: Eski talebin sıradan düzenlenmesi zorunlu fiyat girişine takılıyor

**Kaynak:** `src/services/purchase-servises.js:1447`; `src/ui/purchase-items-ui.js:43`; `src/utils/purchase-money.js:71`.

Legacy adaptörün bilinmeyen fiyat/KDV'yi uydurmaması doğru. Ancak bütün güncellemeler koşulsuz `PurchaseItemsUI.read()` ile yeni mali şemaya çevriliyor. Eski kaydın yalnız açıklaması düzeltilse bile boş fiyat/KDV doğrulaması kaydı durduruyor.

**Kanıt:** Gerçek `openPurchaseDetail` ve `updatePurchaseRequest` fonksiyonlarını kullanan U1 tarayıcı deneyi. `urun/adet/butce` içeren, başlamamış ve kullanıcıya ait eski talepte yalnız açıklama değiştirildi. `Birim fiyat geçerli bir sayı olmalı` uyarısı geldi; yazma sayısı 0, eski açıklama değişmedi. Bu, yetki veya emülatör reddi değildir; yeni istemci kontrolüdür.

**Etki:** Aşama 0 D02 ve Aşama 3 “eski talepler çalışır” kabulüyle çelişir. Mevcut kaydı fiyat bilgisi olmadan düzenleyebilme davranışı kaybolmuştur.

**Düzeltme/kapanış:** Yeni mali modele açıkça geçirilmemiş legacy talebin eski alan düzenlemesini koru. Kalemli modele dönüşümü ayrı, bilinçli bir eylem yap; bütçeden fiyat türetme. Yalnız açıklama/birim/öncelik güncelleme, geri çekme sonrası düzenleme ve isteğe bağlı kaleme dönüşüm testleri eklenmeli.

### B03 — P2: Yazdırmada satır toplamı ile genel toplam farklı doğruluk kaynakları kullanıyor

**Kaynak:** `src/ui/purchase-items-ui.js:171` ve `:178`.

Satırdaki `totalPrice` doğrudan saklanan kayıttan basılırken genel toplam `calculate(items)` ile yeniden hesaplanıyor. Pilot kararı gereği sunucu matematiksel eşitliği doğrulamıyor; dolayısıyla görünümün tek hesap kaynağı kullanması gerekir.

**Kanıt:** U2 tarayıcı deneyinde miktar 1, fiyat 10 TRY, KDV 0 ve saklanan `totalPrice:999` olan satır yazdırıldı. Aynı çıktıda satır toplamı **999**, genel toplam **10.00 TRY** göründü. Bu örnek kasıtlı uyumsuz girdi kullanır; normal form hesabında kendiliğinden 999 oluştuğu iddia edilmez.

**Düzeltme/kapanış:** Yeni kalemlerin hem satırlarını hem özetini aynı `calculate()` çıktısından üret. Hesaplanamayan kayıt için tutarlı hata görünümü kullan. Legacy bilinmeyen fiyat gösterimi korunmalı. Bu düzeltme sunucuda kuruş doğrulaması istemez. Saklanan `totalPrice/totals/reportingTotalTRY` değiştirilmiş örnekle ekran ve çıktı eşitliği test edilmeli.

### B04 — P2: Pasifleştirme, yeni görev/katılımcı seçimlerine uçtan uca taşınmamış

**Kaynak:** `src/modules/edm-workflow.js:364`, `:466`, `:1588`; `src/utils/ownership.js:54`, `:119`; `src/services/ebys-definitions.js:22`.

Onaylayıcı araması ve ad çözümü `active:false` kişileri dışlamıyor. UID çözümü de pasifliği kontrol etmiyor. Birim servisi katılımcının varlığını kontrol ediyor, aktifliğini kontrol etmiyor; seçimden sonra pasifleştirilmiş kişi eski modal verisiyle eklenebilir. Birim UI'sındaki aktiflik filtresi tek başına yeterli değil.

**Kanıt:** A5'te gerçek `Ownership` çözümü pasif kişinin UID'sini döndürdü; bu UID ile yeni akış başlatma emülatörde kabul edildi. Aynı kişinin belge okuması aktiflik kuralı nedeniyle reddedildi. A4'te gerçek `saveUnit()` transaction'ı pasif personele yeni `personnelIds` bağı ekledi.

**Etki:** Normal atama yolu işlem yapamayan bir onaylayıcı seçebilir; süreç yönetici müdahalesine bağımlı olur. Burada daha önceden atanmış kişinin sonradan pasifleştirilmesi ve otomatik vekâlet eksikliği kusur sayılmıyor; sorun yeni atamadır.

**Düzeltme/kapanış:** Tarihsel kimlik çözümünü bozmayacak ayrı “yeni atamaya uygun kişi” kontrolü kur. Onaylayıcı araması, başlatma ve servis transaction'ında aktiflik tekrar kontrol edilmeli; yeni atama kural politikası mevcut ifade bütçesinde sınanmalı. Modal açıldıktan sonra pasifleştirme, aynı adlı aktif/pasif kişiler ve tarihsel görünüm senaryoları birlikte test edilmeli.

### B05 — P2: Rules'ın kabul ettiği kalem, gerçek istemci tarafından işlenemeyebiliyor

**Kaynak:** `firestore.rules:196`; `src/utils/purchase-money.js:25`; `src/ui/purchase-items-ui.js:125`.

`hasAll` alan adlarının varlığını denetler; içerik tipini veya istemcinin işleyebileceği ölçeği sağlamaz. `category:null`, `unit:null` ve miktar `0.0001` olan kayıt sahibi tarafından yazılabildi. Metin alanları düzeltildiğinde yalnız dört ondalıklı miktar da kabul edildi. Gerçek hesap motoru ilkini zorunlu alan, ikincisini miktar ölçeği nedeniyle reddetti.

**Kanıt:** A3 emülatör + saf hesap motoru deneyi. Bu, toplamın doğru kuruş olup olmadığını sunucuda ispatlama talebi değildir; kayıt şeması ile okuyucu/onaylayıcı sözleşmesinin uyuşmamasıdır. Normal UI bu veriyi üretmez; başka istemci veya doğrudan SDK yazması üretebilir.

**Düzeltme/kapanış:** Zorunlu alanların asgari tip/değer sözleşmesini bütçeye göre dar ve ölçülmüş biçimde eşleştir. Sunucuda garanti edilemeyen girdiler için onay öncesi kontrollü doğrulama/hata yolu tanımla; işlenemez veriyi sessizce varsayılanlarla değiştirme. Null metin, yanlış tip, desteklenmeyen ölçek ve geçerli üç kalem testleri birlikte koşulmalı. Bütün uzunluk/matematik kontrollerinin Rules'a taşınması bu bulgunun kapanış şartı değildir.

### B06 — P2: Aşama 2 commit'i personel UI/servis bağlantılarını içermiyor

**Kaynak:** `script.js:550`, `:569`, `:593`; `git show 5be0579:script.js` ve `git diff -- script.js`.

Yerel sürümde personel modalını `EBYSDefinitionsUI` ile açma ve ekleme/düzenlemeyi `EBYSDefinitions.savePersonnel()` üzerinden yapma bağlantıları var. Bu üç hunk Aşama 2 commit'inde yok. Commit sürümünde `EBYSDefinitions` eşleşmesi **0**, çalışma ağacında **5**. `5be0579` dosya listesi de `script.js` içermiyor.

**Etki:** Mevcut yerel UI testi geçse de Aşama 2'nin yalnız commit'ten kurulması aynı personel ekranını üretmez. Bu, Aşama 3'ün bilerek commit edilmemiş olmasına yönelik bir bulgu değildir; Aşama 2 teslim sınırıdır.

**Düzeltme/kapanış:** İlgili üç personel hunk'ını diğer stok/içe aktarma değişikliklerinden ayırıp proje sahibinin commit onayıyla teslim kapsamına al. Sonrasında temiz checkout'ta personel ID/UID/birim/görev/aktiflik ve kaydetme testi yapılmalı. Bu denetim commit oluşturmadı.

## 3. Mimari değerlendirme

| Alan | Sonuç |
|---|---|
| Vanilla JS / Spark / Functions yok | İncelenen EBYS ekleri yeni framework, derleme veya sunucu bağımlılığı getirmiyor. |
| Aşama 1 DYS tasarımı | `ebysVersions`, `ebysProcesses`, deterministik `ebysTasks`; tek karar otoritesi, sabit sürüm ve ayrı koleksiyon sicili tutarlı bir yön. Henüz uygulanmış/kanıtlanmış erişim mekanizması değildir. |
| `readerUids` yerine görevden erişim | Tasarım yazma bütünlüğünü `getAfter` ile birlikte ele alıyor. Sahte görev/karar, aynı kişinin tekrar görevi ve geçmiş sürüm erişimi Aşama 5'in zorunlu emülatör kapısı olarak kalmalı. |
| Birim/personel tanımları | Yeni servis/UI/saf şema ayrımı, transaction, revizyon çatışması, silme yerine pasifleştirme ve mevcut ID/UID koruması olumlu. Yeni atama aktifliği B04'te eksik. |
| Para hesap motoru | BigInt ölçekleme ve ortak saf hesap fonksiyonları uygun. Saklanan bütçeyi fiyat gibi yorumlamama doğru. Çıktı ve legacy düzenleme entegrasyonları B02/B03 nedeniyle eksik. |
| Katman sınırları | Yeni `ebys-definitions` ve `purchase-money` modülleri ayrık. Ancak eski `purchase-servises.js` veri/UI karışımı sürüyor; Aşama 3 burada yeni yazdırma düğmesi DOM'u da ekliyor (`:1152`). Constitution §3'e tam uyum iddiası doğru olmaz. Yeni düğme bağlama UI katmanına taşınmalı; geniş eski modül refaktörü bu denetimin şartı değil. |
| Mevcut okuma yetkileri | Üye satın alma okumaları hâlâ geniş. Raporlar bunu açıkça Aşama 5 kapsamına ayırıyor; Aşama 2/3 regresyonu sayılmadı. Bugün “sırası gelmeyen imzacı içeriği okuyamaz” garantisi verilmemeli. |
| Ekler / KEP / gerçek imza / arşiv | Aşama 1 sözleşmeleri tasarım düzeyinde. Canlı Storage erişimi, belgeye bağlı özel ek erişimi, imza veya dış entegrasyon bu denetimde uygulanmış kabul edilmedi. |

## 4. Yeniden çalıştırılan testler

| Kontrol | Gözlenen sonuç | Log |
|---|---|---|
| `npm run test:unit` | 278 geçti, 0 hata | `scratch/ebys-audit-unit.log` |
| `npm run test:rules` | 228 geçti, 24 suite, 0 hata | `scratch/ebys-audit-rules.log` |
| `npm run lint:xss` | 921 dinamik ifade; izinsiz 0 | `scratch/ebys-audit-xss.log` |
| Mevcut Aşama 2 tarayıcı kontrolü | 6 kontrol; pageerror 0 | `scratch/ebys-audit-stage2-ui.log` |
| Mevcut Aşama 3 tarayıcı kontrolü | 9 kontrol; pageerror 0 | `scratch/ebys-audit-stage3-ui.log` |
| Ek Rules denetimi | C0 koruma kontrolü + A1–A5: 6 test geçti | `scratch/ebys-audit-probes.log` |
| Ek tarayıcı denetimi | U1–U2: 2 sorun yeniden üretildi; pageerror 0 | `scratch/ebys-audit-ui.log` |
| Hosting beyaz liste | Başarısız: 77 dosya, beklenen 74 | `scratch/ebys-audit-hosting.log` |
| `git diff --check` | Hata yok | Denetim komut çıktısı |

**Ek testlerde “geçti”, sorunun beklendiği biçimde yeniden üretildiği anlamındadır; ürün kabulü değildir.** Mevcut yeşil paket bu eksik senaryoları kapsamıyordu. Ek testler üretim paketine negatif kabul testi olarak henüz eklenmedi; `scratch/` altında kanıt aracıdır.

Ek Rules komutu:

```powershell
npx firebase emulators:exec --config tests/rules/firebase.rules-test.json --only firestore --project demo-ebys-independent-audit "node --test scratch/ebys-audit-probes.test.mjs"
node scratch/ebys-audit-ui.cjs
```

Emülatör başlangıcı config'te Rules yolu bulunmadığına dair uyarı verir; test `initializeTestEnvironment` ile gerçek `firestore.rules` içeriğini yükler. C0 beklenen retleri ayrıca doğrular. İlk A5 denemesi test düzeneğinde `Schema` bağımlılığı eksik olduğu için hata verdi; gerçek `schema.js` yüklenerek düzeltildi. Nihai 6/6 sonucu yukarıdadır; bu düzeltme uygulama kodunu değiştirmedi.

Hosting açığı mevcut `release-journal/index.html`, `journal.js`, `style.css` dosyalarıyla ilgilidir; EBYS'nin yarattığı regresyon olarak sınıflandırılmadı. Yayın kapısı yine de yeşil değil. Aşama 2 raporunun “kod commit edilmedi” durumu da güncel HEAD ile eskimiştir; durum satırı B06 çözümüyle birlikte yenilenmeli.

Tarayıcı testleri gerçek uygulama ekranlarının tamamını, Firebase Auth oturumlarını veya Storage yüklemesini açmaz. Tam uygulama konsol/çift yükleme baseline karşılaştırması ve görsel UAT yapılmadı. Dolayısıyla dört ekranın tüm kullanıcı/rol/gerçek veri kombinasyonları için mutlak uyumluluk garantisi verilmez.

## 5. Kapanış sırası ve teslim

1. B01 ve B02: İlk onay bütünlüğü ve legacy düzenleme düzeltmeleri.
2. B03–B05: Tek kaynaklı çıktı, yeni atama aktifliği ve bozuk veri sözleşmesi.
3. B06: Personel entegrasyon hunks'larının onaylı teslim kapsamına alınması; temiz checkout kontrolü.
4. Karşı örnekleri beklenen ret/başarı testlerine dönüştür; bütün unit/Rules/XSS paketlerini yeniden çalıştır.
5. Admin/personel ile dört ekranda yerel tam uygulama UAT'sı; hosting dosya politikasını kapat; ardından aşama kabulünü yeniden değerlendir.

Denetim teslimi: bu rapor, `scratch/ebys-audit-probes.test.mjs`, `scratch/ebys-audit-ui.cjs`, test logları ve `audits/test-baselines/2026-11-01_EBYS_Bagimsiz_Denetim_Kanit.json`. Manifesto kaynak ve kanıt hash'lerini içerir. Üretim dosyası düzenlenmedi; önceki çalışma ağacı değişiklikleri korunmuştur. Bu çalışma bir denetimdir; bulgular kapatılmış gibi raporlanmamıştır.
