# Proje v3.3 için Denetim Raporu

**Tarih:** 27 Ekim 2026  
**Kapsam:** Görsel Raf Sistemi / WMS, Admin Hızlı PIN Yardımcısı, Mobil CSS ve Login v3  
**Belge amacı:** Bağımsız denetim bulgularını ve toplu kullanım öncesi revizyonları, aşama aşama geliştirme promptlarına dönüştürülebilecek iş paketleri halinde sunmak.  
**Durum:** Denetim ve revizyon planı. Bu belgenin oluşturulmasıyla uygulama kodunda değişiklik yapılmadı; aşağıdaki geliştirmeler tamamlanmış değildir.

## 1. Kullanım kararı ve kapsam

- Mevcut kullanımda tek admin vardır; uygulamayı kullanıcı dışında başka biri kullanmayacaktır.
- Kullanıcı, mevcut kullanım döneminde bu bulgulara yönelik kod müdahalesini ertelemiştir.
- İkinci admin ve toplu kullanım öncesinde aşağıdaki revizyonlar bir geliştirme bütünü olarak uygulanacaktır. Aşamalar, bu bütün için ayrı ve sıralı prompt üretmek amacıyla ayrılmıştır.
- Öncelikli P1 müdahalesi stok transferinde transaction ve mükerrer işlem korumasıdır.
- Raf kapasitesi, toplu kullanım için zorunlu operasyon kuralına dönüştürülecektir.
- PIN değerlendirmesi bu revizyon kapsamında deneme eşzamanlılığı, admin kimliği, kasa yaşam döngüsü ve modül bağımlılıklarıyla sınırlıdır. Kullanıcının istemediği ek saldırı senaryoları bu plana dahil edilmemiştir.
- Tek admin bulunması teknik eşzamanlılık kontrollerini sağlamaz. Mevcut kullanım için erteleme kararı, bulguların giderildiği anlamına gelmez.

**Toplu kullanıma geçiş koşulu:** P1 stok bütünlüğü ve zorunlu kapasite işleri tamamlanmalı; P2 müdahaleleri ile kabul testleri kapatılmalıdır. Mevcut tek kullanıcı döneminin ertelenmiş müdahale kararı, toplu kullanım onayı değildir.

## 2. Kaynaklar ve denetim sınırı

İncelenen teknik belgeler:

1. [Görsel Raf Sistemi (Visual WMS) ve Adim PIN Yardımcısı.md](./Görsel%20Raf%20Sistemi%20%28Visual%20WMS%29%20ve%20Adim%20PIN%20Yardımcısı.md)
2. [walkthrough adım 2.md](./walkthrough%20adım%202.md)

Belgeler aşağıdaki kod yollarıyla karşılaştırılmıştır:

- `src/utils/admin-quick-unlock.js`
- `src/utils/shelf-capacity.js`
- `src/modules/admin/shelf-matrix.js` ve `shelf-matrix.css`
- `src/ui/ui-components.js`
- `src/modules/inventory-logic.js`
- `src/modules/auth-engine.js`
- `src/services/firebase-handler.js`
- `security.js`, `firestore.rules`, `admin.html`, `index.html`
- `login-redesign.css`, `mobile-responsive.css`, `src/ui/mobile-nav-enhancements.js`

Bu belge önceki denetimin ve ardından kullanıcıyla kararlaştırılan revizyon kapsamının kaydıdır. Klasördeki sonraki walkthrough belgelerinin veya denetimden sonra yapılmış değişikliklerin yeniden denetlendiği anlamına gelmez. Uygulama aşamasının başlangıcında güncel kod yeniden kontrol edilmelidir.

Önceki denetimde unit test paketi, XSS taraması ve incelenen altı JavaScript dosyasının sözdizimi kontrolleri başarılıydı. XSS taraması 48 dosya, 203 sink, 254 HTML şablonu, 881 dinamik ifade ve 0 izinsiz ifade bildirdi. Walkthrough belgelerindeki 122 test ve 47 dosya / 880 ifade bilgisi tarihsel doğrulama kaydıdır. Bunlar yeni revizyonun kabul sonucu değildir; 0 izinsiz ifade de tek başına 0 XSS açığı anlamına gelmez.

Canlı Firestore üzerinde çok istemcili transfer ve kapasite testi yapılmadı. Bu nedenle eşzamanlılık bulguları kod akışından çıkarılmıştır. Tarayıcı görsel kontrolleri bu bağımsız denetimde tekrarlanmadı.

## 3. Mimari değerlendirme

### 3.1 Kimlik doğrulama ve PIN yardımcısı

PIN açılışı mevcut `unlockAdmin → SecurityConfig.authenticate → Firebase` zincirini kullanır. Helper doğrudan admin oturumu üretmez.

Helper, `window.unlockAdmin` fonksiyonunu sarar, `_dx` iç yapısına erişir ve kilit açılışının başarısını modal görünümünden çıkarır. Bu nedenle tamamen bağımsız değildir. Helper'ın yüklenmediği yeni sayfa açılışında normal giriş çalışabilir; dosyanın kaldırılması açık sayfadaki hook'u veya mevcut kasayı kendiliğinden temizlemez.

### 3.2 Raf ve kapasite verisi

`localStorage` içinde kapasite ayarı saklanır. Kullanılan slot ve doluluk `window.data` stok kayıtlarından hesaplanır. Mevcut kapasite servisi sunucu tarafında zorunlu bir stok kuralı oluşturmaz.

Aynı tarayıcı profili ve origin içindeki sekmeler `localStorage` alanını paylaşır. Farklı cihaz ve profiller arasında ortak kapasite yoktur. WMS, kapasite değişiklikleri için `storage` olayıyla görünüm yenilemesi yapmaz.

### 3.3 Yazma bütünlüğü

Raf taşıma `updateItem`, iç transfer `applyItemOps` yolunu kullanır. İç transfer batch'i kaynak ve hedef yazılarını birlikte tamamlar; fakat kaynak miktarını veya kapasiteyi transaction içinde yeniden okumaz. Atomik batch, eski istemci verisiyle hesaplanan sonucu düzeltmez.

### 3.4 CSS ve DOM

Login'e kapsamlanan ayrı CSS katmanı kısa vadede değişiklik alanını sınırlar. Yüksek specificity ve `!important` kullanımı bakım maliyeti oluşturur. HTML ve inline stiller de değiştiği için yalnız CSS bağlantısını kaldırmak önceki görünümü birebir geri getirmez.

Drawer'ın `body` altına taşınması ve tema tokenlarının overlay kökünde tanımlanması uygundur. İncelenen yaşam döngüsünde doğrulanmış bellek sızıntısı veya zorunlu layout thrashing bulgusu yoktur. Blur maliyeti cihaz üzerinde ölçülmelidir.

## 4. Bulgular ve müdahale kaydı

| Kimlik | Seviye | Bulgu | Toplu kullanım öncesi müdahale |
|---|---|---|---|
| P1-01 | P1 | İç transfer kaynak miktarını istemciden hesaplayıp batch ile yazar; eşzamanlı yazmalarda toplam stok korunmayabilir. | Güncel kaynak okuması, stok değişikliği ve hedef kaydını tek transaction'a al; operationId ile mükerrerliği önle. |
| P1-02 | P1 | Kapasite yerel ayara ve istemci kontrolüne bağlıdır; zorunlu kapasite garantisi yoktur. | Ortak raf belgeleri, transaction içindeki slot hesabı ve alternatif yazma yollarını kapatan yetki sınırı oluştur. |
| P2-01 | P2 | PIN düğmesi devre dışı bırakılırken Enter yolu yeniden çağrı başlatabilir. | Bütün giriş yollarına ortak inFlight kilidi ve kasa sürüm kontrolü ekle. |
| P2-02 | P2 | PIN kasasında admin UID'si ve açık yaşam döngüsü sözleşmesi yoktur. | Kasayı UID'ye bağla; hesap değişimi ve açık çıkışta temizle. |
| P2-03 | P2 | Helper auth başarısını modal görünümünden çıkarır; kaldırma açık hook'u temizlemez. | Açık auth sonucu ve install/uninstall sözleşmesi oluştur. |
| P2-04 | P2 | saveProduct kapasite kontrolünü atlar. | Yeni ürün ve düzenleme dahil bütün ilgili yazmaları ortak kapasite sözleşmesine geçir. |
| P2-05 | P2 | WMS ve kapasite servisi raf/durum alanlarını farklı normalleştirir. | Tek normalizasyon ve slot işgal hesabı kullan. |
| P2-06 | P2 | Harita stoktan oluşur; boş raflar görünmez, toplam raf metriği fiziksel kataloğu temsil etmez. | Raf kataloğunu stoktan bağımsız oluştur. |
| P2-07 | P2 | Açık drawer veri yenilemesinde yeniden açılarak kapatma düğmesine odaklanır. | Açılış ile içerik yenilemeyi ayır. |
| P2-08 | P2 | Modal odak hapsetme/geri verme eksik; Escape birden fazla pencereyi kapatabilir. | En üst diyalog yönetimi, arka plan izolasyonu ve odak yaşam döngüsü ekle. |
| P2-09 | P2 | Login geri alma iddiası HTML değişikliklerini kapsamıyor; yeni nav sarmalayıcısı responsive doğrulama gerektiriyor. | Geri alma adımlarını tamamla; mobil/tablet/masaüstü kontrollerini kaydet. |

P1-02 zorunlu kapasite gereksinimine göre sınıflandırılmıştır. P2-04, P2-05 ve P2-06 bu işin alt görevleridir; ayrı ve çelişen kapasite uygulamaları yapılmamalıdır.

## 5. Aşamalı geliştirme planı

### Aşama 0 — Güncel kod ve yazma yollarının envanteri

**Amaç:** Revizyonu güncel kodun tamamına uygulamak ve kapasiteyi atlayan yazma yolu bırakmamak.

**İşler:**

1. Uygulanabilir depo talimatlarını ve mevcut değişiklikleri incele; kullanıcı değişikliklerini koru.
2. B1/B2 kaydı oluşturan, silen, miktar/durum/raf değiştiren bütün çağrıları listele. Yeni ürün, düzenleme, transfer, stok giriş/çıkış, iade, servis dönüşü, içe aktarma ve toplu işlemleri kodda mevcut oldukları ölçüde kapsa.
3. Her akış için mevcut yetki, şema, yazma API'si ve slot etkisini kaydet.
4. Ortak raf normalizasyonunu ve pozitif/aktif stok tanımını kesinleştir.
5. Mevcut PIN hook'u, auth sonucu ve modal yaşam döngüsünü doğrula.

**Kabul:** Dosya/fonksiyon bazında yazma haritası ve sonraki aşamaların kapsamı hazırdır. Yeni sistem devreye girerken hangi eski yolların kapatılacağı bellidir.

### Aşama 1 — Ortak raf ve slot veri sözleşmesi

**Amaç:** Kapasiteyi cihaz ayarından ortak operasyon verisine taşımak.

**Önerilen raf belgesi alanları:**

| Alan | Açıklama |
|---|---|
| depot | b1 veya b2 |
| code | Kanonik raf kodu |
| capacity | 1–200 arası tam sayı |
| usedSlots | İşgal edilen slot sayısı |
| active | Yeni yerleştirmeye açık olma durumu |
| updatedAt / updatedBy | Sunucu zamanı ve admin UID'si |

Raf belgeleri mevcut proje kökü altında, deterministik kimlikle tutulmalıdır. Koleksiyon yolu güncel veri yapısına göre uygulama sırasında belirlenmelidir. Stokta ürün bulunmaması raf kaydını ortadan kaldırmamalıdır.

**Slot kuralı:** Bir aktif, pozitif stoklu ürün kaydı bir slot kullanır. Kaydın adet miktarı slot sayısını artırmaz. Rafsız stok için geçiş politikası Aşama 6'da açıkça uygulanır.

**Kabul:** Tek raf kimliği, tek normalizasyon ve ortak slot işgal hesabı tanımlıdır. Kapasite ayarı localStorage'dan karar kaynağı olarak okunmaz.

### Aşama 2 — Transaction ile stok ve kapasite servisi

**Amaç:** P1-01 ve P1-02'yi aynı yazma sözleşmesiyle gidermek.

**Önerilen uygulama:** Firebase Callable Function içinde Firestore transaction.

1. İstek sahibinin admin rolünü sunucuda doğrula. İkinci admin için kişiye özel Firebase hesabı ve UID tabanlı rol kullan.
2. operationId, işlem türü, ürün kimliği, miktar ve hedef gibi girişleri doğrula. İstemcinin gönderdiği stok/usedSlots sonucuna güvenme.
3. İşlem kaydını, ürünleri ve gerekli raf belgelerini bütün yazmalardan önce transaction içinde oku.
4. İşlem daha önce tamamlandıysa önceki sonucu döndür; yeniden stok değiştirme.
5. Eski ürün ve doğrulanmış yeni ürün üzerinden slot farkını hesapla.
6. Güncel miktarı, hedef kapasiteyi ve hedef rafın aktifliğini doğrula.
7. Ürün değişiklikleri, raf sayaçları ve tamamlanmış işlem kaydını aynı transaction içinde yaz.
8. İşlem kimliği transaction yeniden denemelerinde değişmesin; yeni kayıt kimliklerini kararlı üret.

Admin SDK güvenlik kurallarını atladığı için admin yetkisi, şema, sahiplik ve operasyon kontrolleri fonksiyonda uygulanmalıdır. Mevcut bakım modu ve toplu işlem kilidi gibi korumalar yeni yolda korunmalıdır.

| İşlem | Slot etkisi |
|---|---|
| Yeni aktif ürün | Hedef +1 |
| Aynı rafta miktar değişimi; stok pozitif kalır | 0 |
| Başka rafa taşıma | Kaynak −1, hedef +1 |
| Tam depo transferi | Kaynak −1, hedef +1 |
| Kısmi depo transferi; kaynak pozitif kalır | Kaynak 0, yeni hedef kayıt +1 |
| Aktif/pozitif kaydın sıfır veya pasif olması | Kaynak −1 |
| Sıfır/pasif kaydın aktif/pozitif olması | Hedef +1 |
| Aktif/pozitif kaydı silme | Kaynak −1 |

Kapasite değişikliği de yetkili transaction ile yapılmalı; kapasitenin mevcut kullanım altına indirilmesi reddedilmelidir. Pasif veya mevcut olmayan hedef rafa yeni yerleştirme reddedilmelidir.

**Kabul:** Stok ve slot hesabı birlikte tamamlanır; hata halinde kısmi değişiklik oluşmaz; aynı operationId ikinci işlemi üretmez.

### Aşama 3 — Güvenlik kuralları ve bütün yazma yollarının geçirilmesi

**Amaç:** Yeni servis dışında sayaçları atlayan yazmaları engellemek.

1. Aşama 0'daki bütün ilgili yazma akışlarını yeni servise geçir.
2. İstemcinin B1/B2 ve raf sayaçlarına doğrudan yazmasını engelleyecek Firestore kurallarını uygula; mevcut okuma ve diğer koleksiyon izinlerini koru.
3. Eski appendItem/updateItem/applyItemOps yollarının envanter yazmalarını yeni sözleşmeyi atlayarak gerçekleştiremediğini doğrula.
4. İçe aktarma, toplu işlem ve bakım araçları için slot bütünlüğünü koruyan yetkili yollar oluştur. Körlemesine eski batch yolunu açık bırakma.
5. Rol doğrulamasını yalnız sabit admin e-postasına bağlı bırakma; mevcut adminin erişimini geçiş boyunca koru.

**Kabul:** Yeni ürün, düzenleme ve diğer ilgili akışlar tek sözleşmeye uyar. Doğrudan istemci yazmaları kurallarda reddedilir. Fonksiyonların kendi yetki kontrolleri ayrıca test edilir.

### Aşama 4 — WMS ve form entegrasyonu

**Amaç:** Ortak kapasiteyi bütün ekranlarda tutarlı göstermek.

1. WMS haritasını ortak raf kataloğundan üret; boş rafları ve doğru toplam raf sayısını göster.
2. Kapasite ve usedSlots değişikliklerini ortak veriden canlı dinle.
3. Yeni ürün, düzenleme, raf taşıma ve transfer formlarında doluluk bilgisini göster. Son karar sunucuda verilsin.
4. Aynı rafta kalan ürün düzenlemesinde gereksiz yeni slot isteme.
5. İstek sürerken tekrarlı gönderimi engelle; yeniden denemede aynı operationId'yi kullan.
6. Başarıyı yalnız sunucu tamamlandıktan sonra göster. Bağlantı hatasını başarı olarak sunma.
7. localStorage kapasite okumasını kaldır; kişisel arama/sıralama tercihleri yerelde kalabilir.

**Kabul:** Bütün ekranlar aynı raf ve doluluk verisini gösterir. P2-04, P2-05 ve P2-06 kapanır. Ayrı bir localStorage senkronizasyon yaması gerekmez.

### Aşama 5 — PIN, diyalog odağı ve responsive düzeltmeleri

**PIN işleri:**

- Düğme ve Enter için ortak inFlight koruması uygula. finally ile kilidi bırak.
- Kasa sürümünü doğrula; silinmiş veya değiştirilmiş kasaya gecikmiş denemenin tekrar yazmasını engelle.
- Kasayı admin UID'sine bağla; hesap değişimi ve açık çıkışta temizle.
- Kilitlenmede kasanın korunma davranışını açıkça tanımla; mevcut kullanım amacını gizlice değiştirme.
- Modal display kontrolü yerine açık auth sonucu kullan. Kurulum/kaldırma sözleşmesiyle hook ve kasa temizliğini tanımla.
- Helper yüklenmediğinde normal parola girişinin çalıştığını doğrula.

**Diyalog ve CSS işleri:**

- Drawer açılışını içerik yenilemeden ayır; canlı veri güncellemesi odağı değiştirmesin.
- En üst diyalog için odak hapsetme ve arka plan izolasyonu uygula; kapanışta geçerli önceki odağa dön.
- Escape yalnız en üst pencereyi kapatsın. Kapatılan diyalogların dinleyicilerini temizle.
- Scroll kilidini iç içe pencerelerde doğru geri yükle.
- Login geri alma kaydına HTML/inline stil değişikliklerini dahil et.
- 320×568, 390×844, 768 px, 1024×768 ve geniş masaüstünde açık/koyu tema ile klavye gezinmesini kontrol et. 44 px dokunma hedeflerini koru.
- Blur ve animasyon maliyetini ölç; ölçüm gerektiriyorsa sadeleştir. Kanıt olmadan bellek sızıntısı giderildi iddiası yazma.

**Kabul:** P2-01, P2-02, P2-03, P2-07, P2-08 ve P2-09 somut kontrollerle kapanır.

### Aşama 6 — Veri geçişi ve kontrollü devreye alma

1. Raf kataloğunu ve gerçek slot kullanımını çıkaran önce salt okunur bir geçiş raporu üret.
2. Rafsız, geçersiz raflı ve mevcut kapasiteyi aşan kayıtları listele. Rafsız aktif stokun nasıl düzeltileceğini geçiş raporunda karara bağla; sessizce bir rafa yerleştirme.
3. Yerel kapasite ayarlarını gözden geçirilmiş tek listeye dönüştür; farklı tarayıcı değerlerini otomatik birleştirme.
4. Değişiklik öncesi veri yedeği ve geri dönüş adımları hazırla.
5. Kısa bir yazma bakım aralığında raf belgeleri ve sayaçları oluştur; yeni servis, istemci ve kuralları koordineli devreye al.
6. Mevcut kapasite aşımında ürün silme. Rafı düzeltme bekleyen durumda göster; slot artıran işlemleri engelle, doluluğu azaltan işlemlere izin ver.
7. Geçişten sonra sayaçları gerçek ürün kayıtlarıyla yeniden karşılaştır; fark varsa toplu kullanıma açma.

Bu aşama planı kendi başına deploy talimatı değildir. Geliştirme promptları önce somut uygulamayı, testleri ve geçiş çıktısını hazırlamalıdır; üretim geçişi ayrıca açıkça istenmelidir.

**Kabul:** Sayaçlar gerçek kayıtlarla eşleşir; geçiş ve geri dönüş belgelenir; tanımsız kayıtların durumu görünürdür.

### Aşama 7 — Bağımsız yeniden denetim ve kapanış

| Doğrulama | Beklenen sonuç |
|---|---|
| Eşzamanlı kaynak transferi | Toplam stok korunur; kaynak negatife düşmez. |
| Son boş slot için eşzamanlı yerleştirme | Kapasite aşılmaz; yalnız uygun işlem tamamlanır. |
| Aynı operationId ile tekrar | İkinci stok veya slot değişikliği olmaz. |
| İşlem sırasında hata | Ürün ve sayaçlarda kısmi sonuç kalmaz. |
| Yeni ürün ve düzenleme | Aynı ortak kapasite sözleşmesi uygulanır. |
| Sıfır/pasif ve aktif stok geçişleri | Slot sayacı doğru değişir. |
| Doğrudan istemci yazması | Yetki kurallarıyla reddedilir. |
| Yetkisiz fonksiyon çağrısı | Sunucuda reddedilir. |
| PIN Enter/düğme eşzamanlılığı | Tek aktif deneme vardır; sayaç doğru ilerler. |
| Hesap değişimi / açık çıkış | Eski kasa kullanılamaz; gerekli temizlik yapılır. |
| Canlı drawer güncellemesi | Odak değişmez; üst diyalog kullanılabilir kalır. |
| Responsive ve klavye kontrolü | Formlar ve eylemler erişilebilir kalır. |
| Geçiş sonrası uzlaştırma | Raf sayaçları gerçek kayıtlarla eşleşir. |

Transaction, yetki ve eşzamanlılık kontrollerini Firebase Emulator üzerinde çalıştır; unit testleri sunucu bütünlüğünün tek kanıtı sayma. Mevcut unit testleri, XSS taramasını, değişen JavaScript sözdizimi kontrollerini ve diff boşluk kontrolünü de çalıştır.

**Kapanış çıktısı:** Her bulgu için değişen dosyalar, test sonucu, kalan sınır ve kapandı/açık durumu. Başarılı test sayısından tek başına güvenlik sonucu çıkarma.

## 6. Her aşama için prompt üretme şablonu

Her geliştirme promptunda şu alanlar bulunmalıdır:

1. **Hedef:** Bu belgedeki aşama ve bulgu kimlikleri.
2. **Önkoşul:** Önceki aşamalarda tamamlanmış olması gereken sözleşme ve kod.
3. **İnceleme:** Güncel dosyalar ve mevcut kullanıcı değişiklikleri.
4. **Uygulama:** Aşamadaki somut işler; korunacak yetki, şema ve stok kuralları.
5. **Kabul ölçütleri:** Aşamaya ait doğrulanabilir sonuçlar.
6. **Doğrulama:** Gerekli unit, emulator veya tarayıcı kontrolleri.
7. **Teslim:** Değişen dosyalar, test kanıtı, açık kalan bulgular ve sonraki aşamaya hazır olma durumu.

**Uygulama sırası:** Aşama 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7. Aşamaların tamamı tek revizyon çalışmasının parçalarıdır; erken aşamanın tamamlanması toplu kullanıma geçiş onayı oluşturmaz.
