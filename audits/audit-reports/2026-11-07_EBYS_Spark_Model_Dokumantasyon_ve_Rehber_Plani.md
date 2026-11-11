# EBYS tamamlama çalışmaları — Spark, model/efor ve teslim disiplini

Tarih: 7 Kasım 2026. Durum: uygulama öncesi plan; üretim koduna uygulanmış değişiklik değildir.

Bu belge, `2026-11-07_EBYS_Plan_Kod_Kiyaslamasi_ve_Tamamlama_Plani.md` içindeki G00–G15 bulgularını ve H0–H8 paketlerini tamamlar. Kapsam ve bütçe konusunda bu belgedeki daha dar sınırlar esas alınacaktır. İncelenen kod birleşim worktree'sindeki `883da91` sürümüdür. Ana klasörde eski Aşama 6 dalı bulunmaktadır; raporlar kolay bulunması için ana klasöre yazılmıştır.

## 1. Kararlar

1. **Varsayılan geliştirme: GPT-6.1 Sol / Orta.** Efor yalnız ilgili işin riskine göre artırılır. Bütün projeyi Ultra ile yürütmek önerilmiyor.
2. **Spark ve sunucusuz çalışma korunur.** Bulut işçisi, ücretli depolama, sürekli tarama ve gereksiz veri çoğaltma bu tamamlama paketlerine alınmaz.
3. **Her paket üç teslim içerir:** uygulama öncesi implementation plan; uygulama sonrası walkthrough ve gerçek test kanıtları; aynı paketle güncellenen sade EBYS Rehberi.
4. **Satın alma–evrak ilişkisi bir güvenlik ve veri sözleşmesi işidir.** Yalnız tabloya satır veya düğme ekleyerek tamamlandı sayılmaz. İki ayrı onay motoru aynı talebe karar yazamaz.
5. **Bütçe için yetki, değişmez sürüm, olay kaydı ve atomik kapanış kaldırılmaz.** Önce gereksiz sorgular azaltılır; maliyeti sınırlandırılamayan yeni özellik açılmaz.
6. **Mevcut ilk onay kur politikası korunur.** Önceki rapordaki “yeni yolda dondurmada sabitleme” bir öneriydi; onaylanmış karar değildir. Değişiklik ayrıca kabul edilmeden uygulanmaz.

## 2. Model ve efor seçimi

### Seçim yöntemi

Her paket dört boyutta 0–2 puan alır: **Y** yetki/gizlilik etkisi, **A** atomiklik/eşzamanlılık, **L** eski akışlarla etkileşim, **K** kalıcı veri/kurtarma etkisi. Toplam 0–2: Düşük; 3–4: Orta; 5–6: Yüksek; 7–8: Çok yüksek başlangıç önerisi. Bu puanlama projeye özgü mühendislik değerlendirmesidir; model performansının deneysel ölçümü veya ücret hesabı değildir.

Resmî model rehberi Sol'u maliyet gözetilen karmaşık işler, Astra'yı derin analiz, Luna'yı dar kapsamlı işler için konumlandırıyor. Aşağıdaki dağılım bu rehber ve projenin riskleri birlikte değerlendirilerek hazırlanmıştır. [OpenAI model seçimi](https://developers.openai.com/api/docs/guides/model-selection)

| İş paketi | Y/A/L/K → toplam | Uygulama modeli ve efor | Ayrı inceleme nerede gerekli? |
|---|---|---|---|
| H0 — Görev süresi/saat sınırı düzeltmesi | 1/2/1/1 → 5 | GPT-6.1 Sol — Yüksek | Sınır ve vekâlet testleri; ayrı model şart değil |
| Q0 — Okuma/dinleyici maliyetini azaltma | 1/0/2/1 → 4 | GPT-6.1 Sol — Orta | Yetki kaybı sonrası eski içeriğin görünmediği kontrol edilir; Rules değişirse o parça Yüksek |
| H1 — Yedek kapsamı ve yerel kurtarma | 2/1/2/2 → 7 | GPT-6.1 Sol — Çok yüksek | Özel token, kapsam ve geri yükleme tasarımına GPT-6 Astra — Yüksek inceleme |
| H2 — Yanlış etiketler ve açıklamalar | 0/0/1/0 → 1 | GPT-6.1 Sol — Düşük | Sorgu/durum değişikliği gerekiyorsa Q0/H7 kapsamına ayrılır |
| H3 — Birim kimliği, mali sürüm, tek motor sözleşmesi | 2/2/2/2 → 8 | Tasarım: GPT-6 Astra — Çok yüksek; sınırları belirlenmiş şema uygulaması: GPT-6.1 Sol — Yüksek | Bu sözleşme H4 başlamadan gözden geçirilir |
| H4 — Satın alma–evrak bağı ve sürüm adaptörü | 2/2/2/1 → 7 | GPT-6.1 Sol — Çok yüksek | H5 ile tek bütünleşik güvenlik incelemesi; her dosyayı tekrar tekrar inceletme yok |
| H5 — Tek karar motoru, icra ve geçmiş erişimi | 2/2/2/2 → 8 | GPT-6.1 Sol — Çok yüksek | GPT-6 Astra — Çok yüksek; yetki/atomiklik/legacy sınırlarıyla sınırlı |
| H6a — Personelin kendi evrakları ekranı | 2/0/1/1 → 4 | GPT-6.1 Sol — Orta | Yeni okuma/yazma kuralları Yüksek eforla; ekran tasarımı Orta |
| H6b — Ortak kurum künyesi ve metin şablonları | 1/1/1/1 → 4 | GPT-6.1 Sol — Orta | Geçmiş sürümün değişmemesi kabul testi |
| H7 — Yazışma bağı, manuel gönderim, sayfalama | 1/1/1/1 → 4 | GPT-6.1 Sol — Orta | Kayıt ilişkilendirme yetkileri için Yüksek eforlu dar inceleme |
| H8 — Birleşik kabul, kurtarma ve yayın kararı | 2/2/2/2 → 8 | Kanıt hazırlığı: GPT-6.1 Sol — Orta; son inceleme: GPT-6 Astra — Çok yüksek | Gerçek testler ve geri dönüş provası olmadan kabul yok |
| Her paketin rehber metni | 0/0/0/0 → 0 | Mevcut geliştirme oturumunda GPT-6.1 Sol — Düşük | Ayrı metin işi büyürse GPT-6 Luna — Düşük; özellik davranışını geliştirici doğrular |

**Minimumdan Ultra'ya kullanım sınırı:**

| Efor | Bu projedeki kullanım |
|---|---|
| Minimum / minimal | Güvenlik, veri modeli veya test yorumlamasında kullanılmaz. Sol 6.1 API'sinde `minimal` desteklenmediğinden en düşük öneri `low` olur |
| Düşük / low | Onaylanmış metin, etiket ve dar CSS düzeltmesi |
| Orta / medium | Günlük servis/UI geliştirmesi, rehber, belirli kapsamlı sorgu düzenlemesi |
| Yüksek / high | Rules, yarış durumu, eski kayıt uyumu, hata teşhisi |
| Çok yüksek / xhigh | H3–H5 bağlantı ve karar otoritesi; kurtarma tasarımı; birleşik güvenlik incelemesi |
| Maksimum / max | Daraltılmış bir sorun Çok yüksek düzeyde çözülemiyor ve yeni bir değerlendirme yararı bekleniyorsa; varsayılan değil |
| Ultra | Ürün arayüzünde varsa yalnız çözülememiş kritik bir bütünlük/erişim sorusunun son incelemesi; şu an planlanan hiçbir paketin zorunlu başlangıcı değil |

Efor seçenekleri ürüne/modele göre değişir; API `max` ile arayüzdeki `Ultra` otomatik eş anlamlı kabul edilmez. Resmî akıl yürütme belgesi Sol 6.1 için `none/minimal` desteği olmadığını belirtir; yazılım bakım yazısı Ultra kullanımına ayrıca örnek verir. [Efor seçenekleri](https://developers.openai.com/api/docs/guides/reasoning), [yazılım bakım örnekleri](https://developers.openai.com/blog/maintaining-software-with-the-gpt-6-family)

Bu dağılım geliştirme sırasında kullanılan araçlar içindir. Uygulamanın içine model/API çağrısı eklenmez. Otomatik alt görev veya ek sohbet başlatılmadı. Abonelik, token hacmi ve deneme sayısı bilinmeden TL/USD maliyet ya da yüzde tasarruf uydurulmaz. Her iş küçük bir kapsamla başlar; geçen testler yeni gerekçe yokken tekrar tekrar çalıştırılmaz.

## 3. Spark kapsamında açık ve kapalı işler

Firestore ücretsiz sınırları: günlük **50.000 okuma, 20.000 yazma, 20.000 silme**; **1 GiB saklama, aylık 10 GiB dış veri aktarımı**. Günlük yenileme Türkiye gece yarısına değil Pasifik saatine bağlıdır. Bunlar EBYS'ye özel değil, aynı veritabanını kullanan envanter dahil toplam yük içindir. Farklı kök koleksiyonlar yeni ücretsiz kota yaratmaz. [Firestore kotaları](https://firebase.google.com/docs/firestore/quotas)

| Özellik | Bu planın kararı | Uygulanacak düşük maliyetli karşılık |
|---|---|---|
| Cloud Functions/Run, Scheduler, otomatik e-posta işçisi | Kapsam dışı / kapalı | Mevcut uygulama içi bildirim; haricî e-postanın gönderilmediği açık anlatım |
| Otomatik dış kur servisi | Kapalı | Operasyon Merkezi'ndeki yönetici kuru; kabul edilmiş sabitleme anı korunur |
| Cloud Storage ile yeni EBYS ek yükleme | Spark paketinde kapalı | Metin evrakı; ekler için ileride uygulanabilecek sözleşme belgesi |
| Firestore'a Base64 veya dosya parçaları yazma | Uygulanmayacak | Dosya yükleme yerine aynı boyuttaki veriyi daha pahalı yoldan saklama yapılmaz |
| Yönetilen yedek/PITR/TTL/klonlama | Kapsam dışı | Yetkili operatörün başlattığı sınırlı yerel dışa aktarım ve emülatör kurtarma provası |
| Sürekli tüm evrak/geçmiş taraması, kart başına dinleyici | Yeni geliştirmelerde yasak; mevcut örnekler Q0'da azaltılır | Sayfalı kuyruk; ayrıntı açıldığında gerekli kayıtları okuma |
| Her harfte taslak yazma, her değişimde tüm sayaçları hesaplama | Kapalı | Açık Kaydet işlemi; sayfa sayacı veya kullanıcı isteğiyle toplam yenileme |
| Tam metin arama servisi, vektör/OCR/ücretli yapay zekâ | Kapsam dışı | Desteklenen alanlarla indeksli filtre ve açıkça belirtilen sayfa içi arama |
| KEP/e-imza/e-Devlet canlı entegrasyonu | Aşama 8'e ertelenmiş | Yalnız sözleşme taslağı; çalışır bağlantı veya resmî onay iddiası yok |
| Yeni EBYS birim/personel kataloğu | Oluşturulmayacak | Mevcut ortak birim ve personel kayıtları |
| QR, arşiv, sabit sürüm, olay ve stok bağı | Korunur | İşlem anında sınırlı kayıt; güvenlik kanıtı maliyet gerekçesiyle atılmaz |

**Storage düzeltmesi:** Güncel Firebase koşulları, varsayılan bucket dahil Cloud Storage için Blaze istiyor; küçük test hacmi Spark erişimi sağlamıyor. Önceki “kota az kullanılırsa Spark'ta yüklenebilir” varsayımı artık tasarım dayanağı olamaz. [Storage koşulları](https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024)

Yönetilen yedek/restore ile sıradan SDK okuma-yazmalarından oluşan özel yerel araç farklıdır. İlki ücretli özellik; ikincisi de okuma/yazma kotası tüketir ve ayrı yetkili operatör gerektirir. Yerel araç sıfır maliyetli, sınırsız veya tutarlı anlık yedek garantisiyle sunulmayacak. [Ücretsiz kullanım dışındaki özellikler](https://firebase.google.com/docs/firestore/quotas)

Bu tabloda “kapalı” planlanan yayın kapsamını belirtir. Bu rapor sırasında canlı özellik anahtarları, mevcut dosyalar veya kayıtlar değiştirilmedi. Eski eklerin erişim/kapsam incelemesi yapılmadan eski veriler kaldırılmaz.

## 4. Q0: Yeni özellikten önce mevcut sorgu yükü

İncelenen sürümde iki somut maliyet noktası var:

- `src/ui/ebys-process-ui.js:135` her görev kartı için `watchTaskContext` çağırıyor. `src/services/ebys-process-service.js:169` süreç dinleyicisi açıyor ve sürümü okuyor. Kart sayısıyla birlikte ek okuma/dinleyici sayısı büyüyor.
- `src/ui/ebys-documents-ui.js:40` defter verisi güncellendiğinde `refreshCounts()` çağırıyor; serviste dört toplam sorgusu var. Toplamın ihtiyaç olmadan tekrar hesaplanması önlenebilir.

Q0 hedefi: açık görev kuyruğu için tek sayfalı dinleyici; açık ayrıntı için gerekli dinleyici; geçmişi istek üzerine getirme; ekran/oturum kapanınca hepsini temizleme. Yetkili kullanıcıya gösterilecek kısa kart özeti mevcut görev kaydında sınırlandırılabiliyorsa burada tutulur; görevin ileride atanacak kişiye içerik sızdırmaması Rules ile korunur. Yeni bir genel içerik koleksiyonu açılmaz.

Varsayılan sayfa büyüklüğü 25 önerilir; mevcut 50 sınırı bir hata değildir. Sayfa değişimi ve aktif görevin sonucu görünür biçimde yenilenir. Maliyet azaltırken kullanıcının işlem sonucunu göremediği eski UX sorununa dönülmez. Liste verisi yetki kanıtı değildir; her karar sunucudaki kurallara tabi kalır.

Dinleyici güncellemeleri/yeniden bağlantıları, `count()` ve Rules içindeki `get/exists/getAfter` değerlendirmeleri de okuma tüketebilir. Bu nedenle yalnız ekrandaki satır sayısını saymak yeterli değildir. [Firestore ücretlendirme davranışı](https://firebase.google.com/docs/firestore/pricing)

### Geçici iç bütçe ve hesap örneği

Önerilen başlangıç planlama payı **EBYS için günde 5.000 okuma ve 2.000 yazma**; bütün ürün için normal gün hedefi ücretsiz okuma/yazma sınırlarının **%60'ının altında** kalmak. Bu bir Firebase limiti veya istemcinin uygulayabileceği güvenilir global kesici değildir. Mevcut kullanım ölçülmedi; pilotun ilk 7 günlük toplamı ve yoğun günleri görülünce pay revize edilir. Diğer modüllerin kalan bütçeyi zaten tükettiği durumda yeni kapsam açılmaz.

Mevcut servislerin başarılı, yeni işlem yolundan örnek yazma hesabı; iki farklı onaycı, iadesiz evrak, QR sonrası arşiv:

| İşlem | Belge yazımı |
|---|---:|
| İlk taslak, kayıt numarası, dondurma | 4 + 4 + 4 = 12 |
| Süreci başlatma | 4 |
| Ara karar + son karar/iş oluşturma | 5 + 6 = 11 |
| İşi kabul etme + kapatma/bildirim | 2 + 4 = 6 |
| QR oluşturma + QR'lı evrakı arşivleme | 3 + 3 = 6 |
| **Çekirdek toplam** | **39** |
| İki ek taslak kaydı | +8 |
| Yeni satın alma köprüsü için geçici tasarım payı | +5; henüz ölçülmüş uygulama değil |
| **Örnek planlama toplamı** | **52** |

Günde 20 böyle evrak yaklaşık 1.040 belge yazımı eder. Altı farklı onaycı kullanılması dört ek ara karar, yani evrak başına 20 ek yazım getirir: örnek 1.440/gün olur. İade, yeni sürüm, politika düzenlemesi, stok bağı, yedekten geri yazma ve diğer modüller buna dahil değildir. Başarısız/yeniden denenen işlemlerin okuma yükü ayrıca ölçülür. Beş yazımlık köprü payına sığmak için güvenlik kayıtları çıkarılmaz; sığmazsa hacim/kapsam yeniden değerlendirilir.

Okuma örneği: 20 kullanıcı × 4 liste açılışı × 25 kayıt = **2.000 belge okuması**, yalnız ilk sayfa sonuçları için. Ayrıntı, Rules, yeniden bağlantı, toplamlar, yedek ve kamusal QR okumaları eklendiğinde gerçek toplam yükselir. Bu örnek “20 kullanıcı kesin sığar” garantisi değildir.

Ölçüm kanıtı: emülatörde işlem başına okuma/yazma ve etkin dinleyici sayısı; ardından Firebase kullanım ekranında gerçek toplam. Emülatör faturanın kesin simülatörü değildir. Gereksiz büyük metin alanlarının indeksleri yalnız kullanılan sorgular incelendikten sonra muaf tutulabilir. Değişmez evraklar sırf yer açmak için silinmez; saklama/indeks/aktarımıyla birlikte 1 GiB sınırı izlenir.

Kamusal doğrulama yalnız tokenla tek kayıt okumaya açık kalır. Bununla birlikte Spark üzerinde sınırsız anonim sorguya karşı tam maliyet/erişilebilirlik garantisi yoktur; öngörülmeyen QR trafiği kapasite incelemesi gerektirir. Sırf sayaç tutmak için her QR açılışında Firestore yazımı eklenmez.

## 5. Her altyapı değişikliği için somut tasarım ve walkthrough

### A. Kalıcı birim kimliği — H3

**Implementation plan:** Yeni satın alma kaydında mevcut ortak `units` kaydının kimliği tutulur. Eski `birim` metni uyumluluk için korunur. Aynı isimli iki birim otomatik eşleştirilmez. Birim seçimi ve kişinin aktif üyeliği gerekli işlemde denetlenir. Yeni ayrı koleksiyon veya kişi başına yeni dinleyici kurulmaz.

**Walkthrough kanıtı:** Yönetici ortak ekrandan birim/personel ekler → personel yeni talepte birimi seçer → onay ve havale aynı kimliği kullanır → ad değişse de eski ilişki korunur → pasifleştirilen birim yeni seçimde görünmez. Aynı adlı birimler, eski adı bulunamayan kayıt ve başka köke ait kimlik olumsuz testtir. Geçmiş evraktaki görünen ad dondurulduğu haliyle kalır.

**Rehber karşılığı:** “Biriminizi listeden seçin. Birim yoksa yöneticiniz ortak Birim Yönetimi ekranından eklemelidir. Aynı birimi yeniden oluşturmayın.”

### B. Mali belge sürümü — H3/H4/H5

**Implementation plan:** Kalemler, vergi, para birimi, hesap toplamı ve kullanıcının ödeneği sürüme bağlanır. Kalem başına ayrı belgeler oluşturulmaz; mevcut üç kalem sınırı korunur. Tek ana evrak bağı deterministik olur; taslak değişikliğiyle dondurma yarışırsa revizyon kontrolü reddeder.

Kur için kabul edilmiş ilk onay anı korunacağından, dondurulan teklif içeriği ile ilk onayda oluşan kesin kur kaydı ayrı anlam taşır. Önerilen sözleşme: sürüm sabit kalır; ilk kararla atomik oluşturulan, sürüme bağlı değişmez mali kesinleştirme kaydı kullanılır. Mevcut `purchaseFinance` kaydının sürüm başına kimliklendirme/legacy uyumu H3'te değerlendirilir; yeni koleksiyon varsayılan çözüm değildir. İlk onaydan önce fiyat/kur ayrımı, onaycının gördüğü tutar ve tekrar onaya sunulan yeni sürüm açık tanımlanır.

İlk sürüm hash'i sonradan oluşan mali kaydı kapsıyormuş gibi gösterilemez. Çıktıda ve doğrulamada hangi sabit içeriğin özetlendiği H3'ün karar maddesidir. Rules kaynak bağını ve izinleri doğrular; istemci SHA-256 özeti tek başına mali hesap doğruluğu kanıtı değildir. Bu sözleşme kesinleşmeden mali adaptör kodlanmaz.

**Walkthrough kanıtı:** TRY/USD/EUR talep → manuel ödenek → dondurma → ilk onay ve sabit kur → yönetici kur değişikliği → eski tutar değişmez → gerekçeli iade/yeni sürüm → eski kararın eski içeriği korunur. Başka talebin finans kaydını kullanma ve iki sekmede çift kesinleştirme reddedilir/tekilleşir.

**Rehber karşılığı:** “Kalem toplamı ile ayırmak istediğiniz ödenek farklı olabilir. Onay verdiğiniz tutarlar daha sonra kur değişse de aynı kalır.” Ayrıntılı kur cümlesi kesinleşmiş sözleşmeyle aynı olur.

### C. Kurum künyesi ve metin şablonu — H6b

**Implementation plan:** Ortak kurum tanımı kaynak alınır; yoksa sınırlı tek kurum kaydı tasarlanır. Kurum adı/kodu/iletişim ve şablon sürümü yalnız ihtiyaç duyulan yerde okunur. Dondurulmuş evrakta gerekli küçük tarihsel alanlar saklanır; bütün kurum/personel kataloğu kopyalanmaz. Künye değişikliği eski belgeleri topluca yeniden yazmaz. Dosya planı ve metin şablonları için ikinci bir organizasyon ağacı kurulmaz.

**Walkthrough kanıtı:** Yönetici kurum bilgisini düzeltir → yeni taslak yeni bilgiyi kullanır → önceden dondurulan evrak eski künyeyi korur → yetkisiz kişi ortak tanımı değiştiremez. Dosya planı/şablon pasifleştirme eski sürümü bozmaz.

**Rehber karşılığı:** “Kurum bilgilerini yönetici bir kez tanımlar. Yeni evraklarda bu bilgiler kullanılır. Eski evrakların üzerindeki bilgiler değişmez.”

### D. Özel doğrulama tokenları ve kurtarma — H1

**Implementation plan:** Aşama 7'nin mevcut özel rezervasyonu ve asgari kamusal kaydı korunur; üçüncü bir token koleksiyonu açılmaz. Kişisel dışa aktarım, kullanıcının yetkili evrakındaki bilinen tokenla alınabilen kamusal kayıtları kapsar. Özel rezervasyonlar tarayıcıya, yönetici dahil genel okuma iznine açılmaz.

Kurumsal kurtarma için operatörün yerelde çalıştırdığı yetkili, sayfalı bir araç ayrı tasarlanır. Yetki bilgileri tarayıcıya/repoya konmaz. Araç kayıt sayısı/okuma bütçesi, şema, kimlikler, tarih türleri, ilişki ve özet kontrollerini manifestoya yazar. Tutarlı görünüm alınamıyorsa bu açık eksikliktir; kontrollü yazma duraklaması veya kanıtlanmış tutarlılık yöntemi gerekir. Farklı zamanlarda alınmış kişisel JSON dosyaları tam kurum yedeği sayılmaz. Auth ve dosyalar ayrıca kapsamda belirtilir.

**Walkthrough kanıtı:** Geçerli/iptal/arşiv QR kayıtları → yetkili dışa aktarım → emülatöre geri yükleme → eski tokenla aynı kamusal sonuç → özel rezervasyonun çakışmayı engellemesi. Eksik koleksiyon veya bozuk ilişki varsa “kurtarma başarılı” sonucu verilmez. Canlıya geri yükleme bu raporun yetkilendirdiği bir işlem değildir.

**Rehber karşılığı:** “Evraklarımı yedekle, erişiminizdeki belgelerin bir kopyasını indirir. Kurumun bütün sistem yedeği değildir.” Özel token anlatımı son kullanıcıya taşınmaz.

## 6. Zorunlu belge biçimi

Her paket için `audits/audit-reports/` altında iki belge tutulur:

- `YYYY-MM-DD_EBYS_<paket>_Implementation_Plan.md`: **koddan önce** hazırlanır ve kapsam değişince güncellenir.
- `YYYY-MM-DD_EBYS_<paket>_Walkthrough.md`: **uygulamadan sonra** gerçek sonuçlarla doldurulur. Önceden yalnız senaryo yazılmışsa “beklenen / henüz çalıştırılmadı” olarak işaretlenir.

Implementation plan zorunlu alanları:

1. Kullanıcının sorunu, sonucu ve kapsam dışı işler.
2. Başlangıç commit'i; etkilenen servis/UI/şema/Rules/sorgu/indeksler.
3. Eski/yeni veri örneği; kalıcı kimlik, sahiplik, sürüm ve geçiş sözleşmesi.
4. Hangi rolün hangi kaydı okuyup yazabildiği; negatif erişim örnekleri.
5. İşlem sınırları, iki sekme/tekrar/bağlantı kesilmesi ve legacy istemci davranışı.
6. İşlem başına tahmini okumalar/yazmalar; büyüyen veri ve dinleyici sınırı; Rules erişim/ifade değerlendirmesi.
7. Geri dönüş: yalnız yeni oluşturmayı kapatma; mevcut işlerin okunması ve bitirilmesinin korunması.
8. Testler ve kullanıcı kabul senaryosu; ilgili rehber metni/düğme yolu.

Walkthrough zorunlu alanları:

1. Gerçek diff/commit tabanı ve tamamlanan/tamamlanmayan maddeler.
2. Talep sahibi, onaycı, yönetici ve icracı adımlarında beklenen/gerçek sonuç.
3. İlgili olumsuz yetki, yarış, geri yükleme ve eski kayıt testleri; komut, sonuç, log bağlantısı.
4. Ölçülen okuma/yazma/dinleyici sayısı ile tahminin ayrı gösterilmesi; canlı kotası görülmediyse bunun yazılması.
5. Açık/koyu tema, dar ekran ve klavye kontrolü; rehberdeki adımın gerçek düğmeyle eşleşmesi.
6. Açık riskler, ertelenen işler, yayın/geri dönüş koşulları. Başarısız test “bilinen sorun” denilerek yeşile çevrilmez.

Tamamlanmış paket: çalışan kod + uygun test + walkthrough + aynı sürümün rehber revizyonu. Kullanıcı commit onayı ayrı kalır.

## 7. EBYS Rehberi revizyonu

Mevcut `src/ui/ebys-showcase-modal.js` Aşama 2–7 bölümlerini içeriyor; **Aşama 7 eksik değil**. Rehber statik ve yerel simülasyon kullanıyor; veri okuma/yazması yok. Bu özellik korunacak, yardım için uzaktan model veya Firestore sorgusu eklenmeyecek.

Görsel düzen korunarak her bölüm şu sırayı izler: **Ne için? → Nereden? → 3–5 kısa adım → Başarılı olunca ne görürüm? → Takılırsam ne yaparım?** Uzun anlatım erişilebilir “Nasıl kullanırım?” yardımında açılır. Kullanıcıya “aptal” gibi hitap edilmez; bilgi sahibi olmadığı varsayılarak sakin, somut dil kullanılır.

Doğrudan düzeltilecek anlatımlar:

- “Resmî kayıt / imza / mühür” ifadeleri uygulamanın nitelikli e-imza veya resmî dış doğrulama sağladığını düşündürmemeli. “Evrak kayıt numarası / kurum içi onay / bu sürüm değişmez” tercih edilir.
- Paraf–Onay–Olur örneği zorunlu üçlü rota gibi sunulmaz. “Olur her zaman son adımdır” kodla zorlanmayan genel kural olarak anlatılmaz.
- “Taslağı dondurmak” ve “onay rotasını başlatmak” ayrı adım olarak gösterilir.
- Evrakın onayı, icra işi ve stok hareketi ayrı açıklanır. İşin “Kabul bekliyor” olması iade kuyruğunda görünmesini gerektirmez.
- Kişisel yedek, tüm kurum yedeği diye sunulmaz. QR, içeriği herkese açan veya e-Devlet onayı veren özellik gibi anlatılmaz.
- Katalog örnekleri gerçek birim/personel kayıtları sanılmasın diye “Örnek” işareti görünür olur.

| Paket | Rehber revizyonu |
|---|---|
| H0/Q0 | Bekleyen görevi yenileme, işlem sonucu ve süre bitiminde yönetime başvurma; teknik saat/okuma maliyeti anlatımı yok |
| H1 | Kişisel belge kopyası ile kurum yedeğinin farkı; indirilen dosyanın kapsamı |
| H2 | Evrak türü ve durum adlarının ekrandaki karşılıkları |
| H3 | Ortak listeden birim seçme, aynı adlı birimi ayırt etme, kur/ödenek farkı |
| H4 | Talep içinden bağlı evraka ulaşma; iade sonrası yeni sürüm |
| H5 | Tek onay rotası, sıranın gelmesi, geçmiş sürüm, vekâlet ve son onay sonrası icra |
| H6 | Kendi taslaklarını bulma; yönetici için kurum bilgisi ve şablon düzenleme |
| H7 | Gelen evraka cevap, gerçekten yapılan gönderimin kaydı ve listede arama sınırı |
| H8 | Baştan sona kısa örnek; eksik havale, görünmeyen personel, geçersiz stok bağı, QR ve arşiv soruları |

Somut metin taslağı ayrı `2026-11-07_EBYS_Rehberi_Revizyon_Taslagi.md` belgesindedir. Gelecekteki düğmeler açıkça taslak olarak işaretlidir; uygulama gelmeden bugünkü kullanıcı rehberine eklenmez. Personel/admin girişleri aynı içerik kaynağını kullanır, role göre ilgili bölüm öne çıkarılır. Görünümde saklama erişim yetkisinin yerine geçmez.

## 8. Revize uygulama sırası ve kabul

1. **H0:** Önce mevcut Rules test tabanındaki süre sorununu kapat.
2. **Q0:** Mevcut sorgu/dinleyici maliyetini ölç ve azalt; toplam ürün için kota başlangıç değerini kaydet.
3. **H1:** Yeni mali bağlantılardan önce yedek kapsamını ve yerel kurtarma sözleşmesini hazırla.
4. **H2:** Yanlış etiketleri ve mevcut rehberdeki kesinleşmiş açıklamaları düzelt.
5. **H3 + H6b'nin çekirdeği:** Birim ID, mali kesinleştirme, tek motor ve geçmiş künye sözleşmesini kesinleştir. Bütçe prototipi en ağır işlemle geçsin.
6. **H4 + H5 + H6a:** Satın alma bağını, tek onayı ve personelin giriş yolunu birlikte kabul et. Yarım köprü kullanıcıya açılmasın.
7. **H6b'nin kalan tanımları + H7:** Metin şablonları, yazışma bağı, manuel gönderim ve sınırlı sorgular. Önceki H7'deki bağımsız outbox uygulaması kaldırıldı; yalnız geleceğe yönelik sözleşme notu kalır.
8. **H8:** Tüm akış, ortak envanter kuralları, restore, kapasite ve sade rehberle kabul. Aşama 8 dış entegrasyonları bu pakette açılmaz.

Rules için 1000 ifade sınırı yanında tek işlemdeki belge erişim sınırları da gözetilir; transaction/batch bütçesi işlem başına sınırı kaldırmaz. En ağır 3 kalem/6 onay adımı, geçmiş sürüm, finans, son onay/icra ve sahte stok referansı birlikte test edilir. İndeks ve sunucu sorgusu hazır değilken görünürde çalışan sayfa içi filtre bütün kurum araması diye sunulmaz.

Son incelemenin test sonucu **324/324 birim, XSS temiz; Rules 337 testte 16 hata** idi. Süre teşhis kopyasının geçmesi üretim takımını yeşile çevirmedi. Bu rapor turunda testler yeniden çalıştırılmadı; sadece belge hazırlanması önceki sonucu değiştirmez.

Bu tur: plan ve rehber taslağı hazırlandı. Ürün kodu/Rules, canlı Firebase, commit, deploy veya seçili model ayarı değiştirilmedi.
