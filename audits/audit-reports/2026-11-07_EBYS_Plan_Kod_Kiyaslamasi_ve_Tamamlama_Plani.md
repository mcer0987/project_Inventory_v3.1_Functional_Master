# EBYS v3.4 — Plan/kod karşılaştırması ve tamamlama planı

Tarih: 7 Kasım 2026. Durum: inceleme ve uygulama önerisi; geliştirme başlangıç onayı yerine geçmez.

**Sonraki kapsam kararı:** `2026-11-07_EBYS_Spark_Model_Dokumantasyon_ve_Rehber_Plani.md` bu planı Spark bütçesi, Q0 sorgu optimizasyonu, model/efor ve zorunlu implementation plan/walkthrough/rehber teslimleriyle daraltır. Çelişkide yeni belge esas alınır: bağımsız outbox/Storage uygulaması ertelenir; ilk onay kur politikası yeni karar olmadan değiştirilmez.

**İncelenen sürüm:** `883da91`, `feat/v3.4-ebys-envanter-birlesim`. İnceleme dizini: `C:/Users/med3pol/Documents/project_Inventory/scratch/ebys-envanter-birlesim`. Bu sürüm EBYS Aşama 7 ve envanter talep/iade birleşimini içerir. Ana klasör hâlâ `feat/v3.4-ebys-asama-6` / `bcb6cc1` üzerindedir. Eski ana klasör kodu, güncel ürün hakkında karar kaynağı yapılmadı. Rapor kolay bulunması için ana klasördeki `audits/audit-reports` içine yazıldı.

**Yöntem:** Ana iş planı, Aşama 0/1 sözleşmeleri, aşama uygulama/denetim raporları; güncel servis, UI, şema, Rules ve testlerin hedefli karşılaştırması. Birim, XSS ve Rules testleri yeniden çalıştırıldı. Canlı veri, canlı yetkiler ve son yayın bu tur sorgulanmadı; tarayıcı UAT yapılmadı. Bu belge tam bir bağımsız güvenlik denetimi değildir.

**Ana sonuç:** Aşama 3–7'nin daraltılmış teslimleri bulunuyor; ana plandaki bütün kurumsal EBYS kapsamı tamamlanmış değil. En önemli işlevsel boşluk satın alma talebi → sabit evrak sürümü → tek onay süreci → icra → kapanış bağlantısıdır. Ayrıca yedek kapsamı, tanım ekranı ve bazı işletim işleri tamamlanmalıdır. Yeni test koşusunda ortaya çıkan süre sınırı sorunu, geliştirmeden önce kapanmalıdır.

## 1. Kaynaklar ve değerlendirme yöntemi

- Ana plan: `audits/audit-reports/2026-10-30_v3.4_EBYS_Genisleme_Is_Plani.md`.
- Davranış/ürün kararları: `2026-11-01_EBYS_Asama_0_Davranis_ve_Karar_Sozlesmesi.md`.
- Teknik tasarım: `2026-11-01_EBYS_Asama_1_Teknik_Tasarim_ve_Servis_Sozlesmeleri.md`.
- Uygulama sınırları: Aşama 2, 3, 4, 5, 6 ve 7 uygulama raporları; Aşama 3 bağımsız denetimi; Aşama 5 başlangıç planı.

Karşılaştırmada sonraki açık kullanıcı talimatı ve kabul edilen pilot kapsamı, ilk geniş plandan önce gelir. Üç kalem, altı adımlı sıralı EBYS rotası, metin pilotu ve haricî gönderimin ertelenmesi otomatik olarak regresyon sayılmadı. İlk planın ilgili hedefi yine açık iş olarak gösterildi. Öncelikler bu incelemenin önerisidir; önceki denetçilerin bulgu numaralarıyla karıştırılmamalıdır.

## 2. Yeni test kanıtı — mevcut taban henüz yeniden yeşil değil

| Kontrol | Bu turdaki sonuç | Kanıt — inceleme dizinine göre |
|---|---|---|
| `npm run test:unit` | 324 geçti, 0 hata | `scratch/ebys-gap-unit.log` |
| `npm run lint:xss` | 84 dosya, 989 dinamik ifade; 0 izinsiz kullanım | `scratch/ebys-gap-xss.log` |
| `npm run test:rules` | 337 test; 321 geçti, 16 hata | `scratch/ebys-gap-rules.log` |
| Değişmemiş süreç test dosyası, bağımsız tekrar | 29 test; 17 geçti, 12 hata | `scratch/ebys-gap-process-rerun.log` |
| Geçici süre teşhis kopyası | 29/29 geçti | `scratch/ebys-gap-time-diagnostic.log` |

**G00 — P1, yeniden üretilebilir güvenilirlik sorunu:** `src/services/ebys-process-service.js:12–18` normal görev için `Date.now() + 90 gün` hesaplıyor. `firestore.rules:1484` ise üst sınırı `request.time + 90 gün` olarak denetliyor. Sınırda üretilen istemci zamanı, sunucunun gözlediği zamandan ilerideyse meşru yazma reddedilebilir. İlk iki koşuda aynı kodda farklı sayıda süreç hatası görülmesi de zamana duyarlılıkla uyumlu.

Teşhis kopyası yalnız test VM'sinde yüklenen servis metnindeki varsayılanı 90 yerine 89 gün yaptı; Rules ve üretim dosyaları aynı kaldı. Bu kopyada tüm 29 süreç testi geçti. Bulguyu süre sınırına güçlü biçimde daraltır; makine saat farkının büyüklüğü ölçülmüş değildir ve 89 gün kalıcı çözüm olarak kabul edilmemiştir. Üretim Rules paketinin bu nedenle yeşil olduğu söylenemez. Canlıda aynı hatanın gerçekleştiği de bu testten çıkarılamaz.

**Kapanış:** normal görev süresini sunucunun kaydettiği başlangıç zamanı ve sınırlı süre değerinden değerlendiren sözleşme; vekâlette açık bitiş tarihinin ayrı korunması; ileri/geri istemci saati, tekrar gönderim ve son sınır testleri. Mevcut görev kayıtları için uyumluluk yolu gerekir. İzinleri gevşetmek veya testleri atlamak çözüm değildir.

## 3. Aşama aşama karşılaştırma

| Aşama | Plandaki hedef | Güncel projede bulunan | Eksik / sınır / sonuç |
|---|---|---|---|
| **0 — Davranış ve kararlar** | Dört ekranın sözleşmesi, rol matrisi, üç pilot senaryosu, karar günlüğü | Davranış raporu ve kesin ürün kararları mevcut | İlk karar günlüğündeki arşiv/saklama, künye/şablon ve kurumsal rol kararlarının tamamını kapatan güncel bir kabul matrisi yok. Satın alma–icra S01 örneği ayrı satın alma motorunda karşılanmıyor. G01, G11. |
| **1 — Teknik sözleşmeler** | Satın alma adaptörü, `purchaseOrderId`, `purchaseSnapshot`, tek karar motoru, özel dosya ve yedek servisleri | Evrak/sürüm/süreç/görev ayrımı, revision, işlem kimliği ve değişmez olaylar uygulanmış | Satın alma adaptörü ve motor ayrımı yok; dosya adaptörü ve kontrollü geri yükleme yok. Bunların tasarımda yazılı olması uygulandıkları anlamına gelmiyor. G01, G03, G04, G10. |
| **2 — Tanımlar** | Kalıcı ID, birim hiyerarşisi, kişi-görev ilişkisi, pasifleştirme; kurum/belge türü/dosya planı/şablon yönetimi | Ortak `units`, personel UID/birim/unvan; pasifleştirme; hiyerarşi; kimlikli seçimler | Kurum künyesi ve dosya planı yönetimi yok. Belge türü listesi sabit; çalışan evrak türlerini “Sonraki aşama” gösteriyor. Dönemli çoklu görev/kurumsal vekâlet sicili yerine görev bazlı devir var. G05, G06, G12. |
| **3 — Satın alma ve döviz** | Çok kalem, döviz, tutar doğruluğu, geçmiş mali veri; geniş planda indirim | En fazla 3 kalem, TRY/USD/EUR, BigInt hesap, yönetici kurları, ilk onay finans kaydı, otomatik/manuel ödenek | Çalışan talep hâlâ ad metniyle birim saklıyor; evrak kimlik bağı yok. İndirim açılmadı. Bütün mali aritmetik Rules tarafından yeniden doğrulanmıyor; kabul edilmiş pilot sınırı. G01, G02, G13. |
| **4 — Evrak kayıt defteri** | Gelen/giden/iç evrak, üst yazı, künye, ek/sürüm, kayıt numarası, ilişkili evrak | Üç defter, düz metin form, dondurma, 128 bit numara, değişmez sürüm, çıktı | Satın alma bağlantısı yok. Ek adaptörü yok. Künye/kurum şablonu, gelen–cevap ilişkisi ve mükerrer dış evrak uyarısı yok. Yeni evrak düğmesi yalnız admin defterinde. G01, G06, G07, G08, G10. |
| **5 — Görev ve erişim** | Sıralı paraf/onay/olur, iade/red, yeni sürüm, vekâlet; tek karar otoritesi | 1–6 adım; UID görevleri; eski sürüm erişimi; görev bazlı süreli devir; legacy okumaların daraltılması | Satın alma halen eski motorla çalışıyor; yeni talebi EBYS motoruna alacak yol yok. Şablonlar create-only; aynı şablon ailesinde revizyon/pasife alma yönetimi yok. Normal görev süre sınırında yeni test hatası var. Genel askıya alma komutu yeni EBYS servisinde yok; ilk pilotun açık kabul kapsamına ayrıca bağlanmalı. G00, G01, G12. |
| **6 — İcra/kapanış** | Son onaydan deterministik iş; havale, iade, SLA, kanıt, bildirim, posta niyeti | Birim+tür politikası, tek iş, yeniden havale, iade kuyruğu, gerçek stok bağı, atomik kapanış/bildirim | İcra yalnız yeni EBYS sürecinin son onayından doğuyor; satın alma son onayı buraya bağlanmıyor. Posta için yalnız bildirimde `emailState: deferred` var. Evrak defterinin “İcrada” filtresi iş durumuyla bağlı değil. G01, G09, G14. |
| **7 — Doğrulama/arşiv** | Kamusal asgari doğrulama, QR, arşiv, saklama, geri yükleme bütünlüğü | 128 bit token, beş alanlı projeksiyon, QR, iptal, admin arşiv geçişi ve olayı | İki A7 koleksiyonu yedek sicilinde yok. Saklama sınıfı/süresi ve kurumsal kurtarma politikası tamamlanmadı. Hash içerik+üstveri içindir; basılan PDF'nin bayt doğrulaması değildir. G03, G04, G11. |
| **8 — Dış entegrasyonlar** | Gerçek e-imza, EYP, KEP, kurum API, sağlayıcı işletimi | Gerçek e-imza başlatılmaz; QR uyarısı var | Başlanmamış ve sonraki faz olarak kabul edilmiş. Sağlayıcı adaptörü/test sözleşmeleri, güvenilir sunucu ve gönderim işçisi bu fazın işleri. Bugünkü hotfixe gizlice eklenmemeli. G15. |
| **9 — Pilot/geçiş/işletim** | Birleşik kabul, kontrollü eski veri geçişi, tam yedek/kurtarma, eğitim/işletim | Manuel kabul senaryosu, rehber, önceki emülatör/UAT/yayın kayıtları | Kurumsal uçtan uca satın alma→icra senaryosu, tam kurtarma provası, eski istemci/geri dönüş kapısı ve tek güncel kabul matrisi eksik. A9 tamamlanmış sayılmaz. G01, G04, G11. |

## 4. Satın alma ilişkisinin gerçek kapsamı

Önceki yanıtın düzeltmesi: eksiklik yalnız “İlişkili üst yazı oluştur” düğmesi değildir. Ana planın ekran tablosu ve Aşama 1 §3/§4/§6; `purchaseOrderId`, `purchaseSnapshot`, `engineVersion` ve `getPurchaseView` ile bağlantıyı açıkça öngörüyor. Ayrı bir teslim maddesine çevrilmediği için sonraki dar aşama görevleri arasında kaybolmuş. Aşama 6 raporu da legacy satın almayı mevcut motorunda bırakıyor.

Bugünkü zincirler:

```
Satın alma formu → purchaseOrders.workflow → satın alma onaylandı

Bağımsız iç yazışma → sabit evrak sürümü → ebysProcesses
                  → son onay → ebysExecutionJobs → closed → QR/arşiv
```

Birinci zincirin ikinciye kimlikli geçişi bulunmuyor. Havale politikası tanımlamak bu bağlantıyı kurmaz. Talep sahibinin kaçırdığı bir kullanım adımı değildir.

Tamamlanması gereken sözleşme:

1. **Talep–evrak kimliği:** Bir talebin bir ana evrakı; o evrakın birden fazla değişmez sürümü. Gelen/giden cevaplar ayrıca ilişkili evrak olabilir. İlişkinin biricikliği, çift tıklama ve farklı sekmelerde de korunmalı.
2. **Birim kimliği:** Yeni talep gerçek `units.id` taşımalı. Görünen eski `birim` adı uyumluluk için kalmalı. Aynı adlı/yeniden adlandırılmış birimler otomatik tahminle bağlanmamalı.
3. **Mali sürüm:** Kalemler, ödenek, tutarlar ve kur politikası belirli bir sürüme bağlanmalı. İade sonrası yeni mali veri eski imzacının gördüğü içeriği değiştirmemeli.
4. **Karar otoritesi:** Yeni EBYS'ye alınmış taleplerde eski `workflow` karar yazması kapanmalı. İki ekranda iki ayrı onay çalıştırılması çift onay/çift icra üretebilir.
5. **İcra ve kapanış:** Bağlı sürümün son onayı mevcut A6 sözleşmesiyle tek iş açmalı. Talepte onay, icra ve evrak kapanışı ayrı gösterilmeli; stok hareketi kullanıcı işlemi olmaya devam etmeli.
6. **Yetki:** Bir kimlik bağlantısının varlığı evrak içeriğine erişim hakkı vermez. Gelecek imzacı, geçmiş imzacı, yazar ve icracı yalnız mevcut görev/sürüm kurallarıyla okur.
7. **Eski kayıtlar:** Devam eden legacy talepler otomatik taşınmaz. Tarihsel bağlantı kurmak geçmiş onayları yeni EBYS imzası yapmaz; eski bir talebe bağlantı eklemek otomatik icra açmamalı.

## 5. Eksik ve yarım kalan işler sicili

P1 burada pilotun güvenilir ilerlemesini veya veri kurtarmayı etkileyen işi, P2 ürün/işletim boşluğunu ifade eder. Güvenlik açığı iddiası ayrıca kanıt gerektirir.

| ID | Öncelik / sınıf | Bulgu ve etkisi | Kod / kabul kanıtı |
|---|---|---|---|
| G00 | P1 — yeni bulgu | Görev süresi tam 90 gün sınırında istemci/sunucu zamanı uyuşmazlığına açık; yeni test koşusu kırmızı | `ebys-process-service.js:12`, `firestore.rules:1484`; §2 teşhis koşuları |
| G01 | P1 — tamamlanmamış ana hedef | Satın alma adaptörü, ana evrak kimliği, mali sürüm, tek motor seçimi ve icraya geçiş yok | `purchase-servises.js:246`, `ebys-document-service.js:36,67`, `ebys-process-service.js:88`; `engineVersion/purchaseOrderId/purchaseSnapshot/getPurchaseView` için uygulama kaydı yok |
| G02 | P1 — G01 önkoşulu | Satın alma ilgili birimi ad metniyle saklıyor; ID tabanlı havale için güvenilir bağ yok | `purchase-servises.js:180,262`; `ebys-execution-service.js:42` `head.unitId` kullanıyor |
| G03 | P1 — yedek bütünlüğü | `ebysVerifications` ve `ebysVerificationTokens` export sicilinde yok. Başlıkta token kalsa bile iptal/projeksiyon kaydı tam geri kurulamaz | `ebys-document-service.js:9–18,150`; `ebys-verification-service.js:39–45`; `firestore.rules:1019` özel token için okumayı da reddediyor |
| G04 | P1 — işletime geçiş kapısı | Kullanıcı export'u kurumsal tam yedek değil; doğrulamalı restore, ilişki/hash kontrolü, görevli geçmiş sürümlerinin kapsamı ve kurtarma provası eksik | Export `ownerCollections` için yalnız `ownerUid`; admin de tüm kurum evrakını almıyor. `admin-backup.js:24` genel `COLLECTIONS` ile sınırlı. A1 §10 ve A9 |
| G05 | P2 — doğrudan tutarsızlık | Gelen/giden/iç yazışma Tanımlar'da “Sonraki aşama”; defterde çalışıyor | `ebys-document-types.js:7–11`, `ebys-document-types-ui.js:10` |
| G06 | P2 — kısmi tanım altyapısı | Kurum künyesi, yönetilen dosya planı, üst yazı şablonu ve tarihsel künye/birim/unvan anlık görüntüleri tamamlanmamış | `ebys-document-schema.js:20–28`; `organizationCode` serbest giriş, dosya planı metin; `ebys-definitions.js` yalnız birim/personel servisi |
| G07 | P2 — yazışma işlevleri | Gelen evrak mükerrerlik uyarısı, gelen→cevap bağlantısı ve manuel gönderim kanal/tarih/referansı yapılandırılmış değil | A0 S02/S03; `ebysMetadata` ve belge şemasında bu ilişkiler yok. A6 serbest kanıt alanı bunların tamamını temsil etmiyor |
| G08 | P2 — personel erişim yolu | Personel için kendi yeni evrakını oluşturma, tüm taslaklarını/rota bekleyenlerini bulma yolu eksik | `admin.html:1145–1155` yeni evrak defteri; index'te görevler ve geri dönen evraklar var, eşdeğer yeni evrak defteri yok |
| G09 | P2 — görünüm/sorgu | Evrak defterinde “İcrada” filtresi var fakat kabul/iade yalnız iş kaydının durumunu değiştiriyor; defter `head.state` süzüyor. Durum/arama da yüklenmiş 50 kayıtla sınırlı | `ebys-documents-ui.js:10,50`; `ebys-execution-service.js:91–124`; `ebys-document-service.js:136` |
| G10 | Ertelenmiş kapsam + erişim kanıtı ihtiyacı | EBYS ek servisi/Storage Rules/emülatör hazırlığı uygulanmadı; yalnız metin pilotu var. Legacy satın alma ekleri hâlâ indirme URL'si saklıyor; yeni görev erişimi bu URL'ye kendiliğinden uygulanmaz | `ebys-document-service.js:60,83`; `purchase-servises.js:1098–1121`; depoda Storage kural dosyası/config yok. Canlı bucket güvenliği bu tur incelenmedi |
| G11 | P2 / ürün kararı | Saklama sınıfı/süresi, görev devri, kurtarma/geri dönüş, kurum rol matrisi ve güncel kapsam kabul kaydı açık | A0 A02/A09/A12; A1 §10; A7 arşiv geçişi var, fiziksel silme yasak. Hash JSON içeriği içindir; PDF bayt doğrulaması yok |
| G12 | Dar pilot teslimi | Vekâlet yalnız aktif göreve, en fazla 90 gün; otomatik dönüş/kurum genelinde izin vekâleti yok. Şablon ailesi revizyon/pasifleştirme ve yeni EBYS askı/devam komutu yok | `delegateTask`, `createRouteTemplate`; `ebysRouteTemplates` update/delete kapalı. İleri kurumsal görev sicili A1 önerisi, A5 dar görev devri teslimi |
| G13 | Kabul edilmiş mali pilot sınırı | 3 kalem; indirim yok; tüm hesap eşitliği ve ölçekler Rules'da yeniden hesaplanmıyor | `purchase-money.js:6`; `firestore.rules:232–248`; A3 uygulama/bağımsız denetim raporları |
| G14 | Kısmi altyapı / sonraki faz | `emailState: deferred` bir niyet; bağımsız outbox, deneme sayacı, retry ve teslim delili değil | `ebys-execution-service.js:124`; güvenilir haricî gönderim ertelenmiş. Uygulama içi kapanış bildirimi mevcut |
| G15 | Henüz başlanmamış faz | Gerçek e-imza, EYP, KEP, kurum/e-Devlet sağlayıcı bağlantıları ve işletimi yok | A8; `ebys-process-schema.js` gerçek e-imzayı reddediyor. Bu bir gizli canlı arıza değildir |

Yeni servis/UI katmanlarında da sınırlı teknik borç var: kur servisi form çiziyor, doğrulama UI'si REST erişimini kendi yapıyor. Tam katman ayrımı iddiası doğru olmaz; güvenlik kapanışına yararı olmayan geniş refaktör bu hotfix dizisinin önkoşulu yapılmamalı.

## 6. Önerilen uygulama sırası ve teslim kapıları

Bu kapsam tek bir küçük hotfixe sığmaz. H0–H2 düzeltme paketleri; H3–H5 eksik entegrasyonun tamamlanması; H6–H8 pilot hazırlığıdır. Her paket bağımsız inceleme/commit sınırı olmalıdır. Başlangıç tabanı birleşmiş `883da91` veya onun doğrulanmış devamıdır; eski A6/A7 dalından tek başına Rules yayınlanmamalıdır.

| Sıra | Paket | İş | Tamamlanma kanıtı |
|---|---|---|---|
| H0 | Süre/test tabanı — G00 | Sunucu zamanına dayanan normal görev süresi, mevcut kayıt uyumluluğu, vekâlet bitiş kontrolü; saat farkı testleri | Değişmemiş asıl test takımı yeniden yeşil; saat ileri/geri ve süre sonu negatif testleri. Teşhis kopyası başarı sonucu diye kullanılmaz |
| H1 | Kapsam ve veri kurtarma — G03/G04 | Kullanıcı export manifestosuna A7 kamusal kayıtlarını yetkili başlıklardaki tokenlardan ekle; özel rezervasyonların istemciden dışa aktarılamadığını açık göster. Ayrı yetkili kurum yedeği/kurtarma yolu ve emülatör restore provası hazırla | QR geçerli/iptal/arşiv durumları ve özel rezervasyonlar geri dönüşte aynı kalır. Eksik bileşen “tam yedek” diye sunulmaz |
| H2 | Doğrudan UI ve rehber düzeltmeleri — G05/G09 | Tanım kataloğunda satın alma formu seçilebilirliği ile genel evrak desteğini ayır; yanlış “Sonraki aşama” etiketini düzelt. Defterde evrak/onay/icra durumlarını ayrı göster. Sayfa içi arama sınırını belirt | Yanlış form türü açılamaz; “İcrada” filtresi gerçek veriyle eşleşir veya desteklenmeyen seçenek kaldırılır. Karanlık tema/mobil ve XSS |
| H3 | Bağlantı sözleşmesi ve birim ID — G01/G02 | Bir ana evrak/çok sürüm; `engineVersion`, sabit `unitId`, yetki/sahiplik, kur anı ve geçiş politikası. Yeni alanlar için eski istemci overwrite koruması; salt okunur eski kayıt eşleme raporu | Aynı ad, adı değişen/pasif birim ve belirsiz bağ senaryoları; eski talep verisi değişmeden kalır. UI geliştirilmeden Rules erişim bütçesi prototipi geçer |
| H4 | Satın alma–evrak adaptörü — G01 | Yeni EBYS taleplerinde `createPurchaseDocument` / `getPurchaseView` benzeri API; kimlik bağı, tutarlı mali taslak, dondurulan `purchaseSnapshot`; sürüm/çıktı aynı veri. Create-only deterministik talep→ana evrak rezervasyonu | İki sekmede tek ana evrak; yarım bağ yok; kaynak talep değişmişse dondurma reddi; başka talebi bağlama/başka kök reddi; eski sürüm sabit |
| H5 | Tek onay otoritesi ve icra — G01 | EBYS'ye alınmış yeni talebin onayını mevcut EBYS motoruna yönlendir; eski motorun aynı talebe yazmasını Rules'da kapat. Son karar mevcut deterministik işi açar; durumlar bağlı kayıtlardan gösterilir | Tek karar/tek iş/tek bildirim. Geri çekme–revize–yeniden onay, geçmiş sürüm, aktif/gelecek imzacı ve stok referans testleri. Yeni ve legacy akış eşzamanlı regresyonu |
| H6 | Personel çalışma alanı ve ortak tanımlar — G06/G08/G12 | Kendi evraklarım/taslaklarım/rota bekleyenler; talepte bağlı evrak düğmesi. Ortak kurum künyesi/dosya planı ve şablon sürümleri; gerekli metin şablonları | Yeni panel açıklaması/yardımı; sahip yetkili yeni taslak başlatır; admin rolü içerik yetkisine dönüşmez; eski sürümün künye bilgisi değişmez |
| H7 | Yazışma ve takip — G07/G09/G14 | Gelen→cevap ilişkisi, mükerrerlik uyarısı, manuel gönderim kanıtı; sunucu filtreli sayfalama. E-posta niyetinin sürümlü/tekil outbox sözleşmesi; gönderici kapalı | Kanal/tarih/referans gerçek manuel işlem olarak görünür. Tekrar gönderim kayıtları ayrılır; sahte KEP delili üretilmez; 50+ kayıtla filtre testi |
| H8 | İşletim ve kabul — G04/G11 | Kurum saklama/rol kararları, sınırlı pilot açılışı, bütünleşik manuel senaryo, yedek/kurtarma ve özellik kapatma provası; rehber güncellemesi | Satın alma→evrak→onay→icra→kapanış→QR/arşiv; envanter talep/iade regresyonu; geri yüklenen kayıtların ilişkisel bütünlüğü; güncel kabul matrisi |

H0/H1 kapandıktan sonra H2 ile H3 hazırlanabilir; H4 mutlaka H3'e, H5 H4'e bağlıdır. H4/H5 kullanıcıya açılacak tek bütünleşik kabul paketidir; yalnız belge yaratabilen yarım entegrasyon tamamlandı diye yayınlanmamalıdır. H6'nın personel talep/evrak giriş yolu H4/H5 kabulünde hazır olmalı; kurum şablonlarının ayrıntıları sonra tamamlanabilir.

G10 dosya işi ayrı paket olmalı: metin pilotunu koruyup yetki/manifesto/Storage emülatör sözleşmesini hazırlamak mümkündür; aktif dosya kullanımına geçiş seçilmiş depolama ve erişim kanıtına bağlıdır. G13 kalem sınırı/indirim genişlemesi ve G12 kurum geneli vekâlet ayrı ürün genişlemesidir. Bunları bağlantı hotfixi içinde sessizce açmak bütçeyi ve kabul sınırını büyütür. G15 A8'de kalır.

## 7. Planın sorgulanması: kolay görünen ama yetersiz çözümler

| Yaklaşım / soru | Değerlendirme ve önerilen karşılık |
|---|---|
| Satın alma kayıtlarını İç Yazışmalar tablosuna eklemek yeter mi? | Hayır. Görünen satır gerçek evrak sürümü, kayıt numarası, onay, icra ve QR kaydı yaratmaz. G01 bütün zincirle kapanmalı |
| Onaylı talep için ikinci bir onay rotası açalım mı? | Aynı satın alma kararının iki motoru olamaz. Yeni EBYS talebinde tek motor seçilir. Geçmiş talebe ilişkili yazı eklemek ayrı yazışma olarak etiketlenir; eski onayı taklit etmez |
| Kuru hangi anda sabitleyelim? | Mevcut sözleşme legacy'de ilk onaydır. Yeni evrakta mali veri dondurmada sabitlenmek istenirse zaman değişikliği açık ürün kararıdır. Öneri: yeni EBYS yolunda yönetici kurunu dondurmada sabitle, ekranda göster; legacy ilk onay davranışını koru. Onaylanmazsa ilk onayda yaratılan ayrı değişmez mali kayıt sürüme bağlanmalı; sürümün kendisi sonradan değiştirilemez |
| Kur ve toplamı SHA-256 ile yazmak güvenilir hesap kanıtı mı? | Hayır. Rules istemci hash'ini yeniden hesaplamıyor. Yeni mali sözleşmede sınırlı tamsayı ölçekleri ve doğrulanabilir kaynak eşitliği kullanılmalı; Rules'da doğrulanmayan aritmetik kabul sınırı açık kalmalı. Hash ile yetki veya tutar doğruluğu sağlandığı iddia edilmemeli |
| G03 için token koleksiyonunu admin okumaya açsak? | Mevcut `allow read: false` tasarımı değişir. Hotfix bunu gerektirmemeli. Kamusal projeksiyonlar bilinen tokenla alınır; özel rezervasyon tam yedeği güvenilir, operatörün çalıştırdığı ayrı araçla alınır. Sırlar tarayıcıya girmez; Rules gevşetilmez |
| Export listesini büyütmek tam kurtarma sağlar mı? | Hayır. Kullanıcı kapsamı, referans bütünlüğü, snapshot tutarlılığı, Firestore timestamp türleri, Auth/dosya kapsamı ve restore sırası ayrıca doğrulanmalı. Kişisel dışa aktarım ile kurum kurtarma paketi ayrı adlandırılmalı |
| Admin her yazarın üst yazısını oluşturabilir mi? | Mevcut taslaklar yalnız yazara açık. İlk köprü talep sahibinin kendisiyle sınırlandırılmalı. Başkası adına kayıt/ortak editör rolü gerekiyorsa açık yetki kararı ve ayrı test gerekir; admin adına ownerUid taklidi yapılamaz |
| Birim ID'sini addan bulmak yeter mi? | Yalnız tekil ve teyit edilmiş eşleme raporu önerilebilir. Belirsiz/eski/pasif adlar kullanıcı tarafından çözülür. İkinci EBYS birim kataloğu oluşturulmaz |
| İlişkili ID okumaya izin versin mi? | Hayır. Bağlantı bir ilişki kanıtıdır, okuma yetkisi değildir. Geçmiş imzacı yalnız karar verdiği sürümü okuyabilmeli; gelecek imzacı sırası gelmeden içeriği okuyamamalıdır |
| İcra sırasında `head.state` değerini her seferinde güncelleyelim mi? | Gereksiz eş yazmalar bütçeyi artırır. Öncelik evrak/onay/icrayı ayrı gösteren, sınırlı yetkili sorgu kullanan görünüm. Kopya durum tutulacaksa atomik eşitlik ve bütçe kanıtı gerekir |
| Spark ve mevcut Rules bütçesiyle köprü kesin sığar mı? | Henüz kanıt yok. En ağır işlemde 3 kalem + 6 EBYS adımı + finans + son onay/icra ve olaylar birlikte ölçülmeli. Bütçe aşılırsa bağımsız taslak hazırlığı ayrılabilir; kritik onay/icra atomikliği bölünemez. Kontroller azaltılmaz |
| Her eski talep yeni motora geçirilsin mi? | Otomatik geçiş önerilmez. Açık legacy talepler eski yoldan tamamlanır. Yeni yol yalnız açıkça seçilen yeni taleplerde açılır. Geçmiş ilişkileri için ayrı önizleme ve geri dönüş planı gerekir |
| Bağlanan eski dosya URL'sini sürüme kopyalayalım mı? | Yeni sürümün erişim politikasını uygulamaz. Ek baytları/manifestosu hazır olmadan ekli EBYS sürümü varmış gibi davranılamaz; kapsam dışındaki ek açıkça belirtilmeli veya işlem engellenmeli |
| Gelen/giden tüm evraklara aynı onay rotası yeter mi? | Pilot ortak motorla çalışıyor; ana plandaki doğrudan gelen havalesi ve giden gönderim kanıtı farklı iş gereksinimleri. Tür bazlı davranış matrisi kurulmadan otomatik süreç değiştirilmemeli |
| Arşivlemek fiziksel silme veya gerçek e-imza sağlar mı? | Hayır. Arşiv immutable yaşam döngüsü adımıdır. Saklama süreleri kurum kararıdır; mevcut silme yasağı korunur. Gerçek imza ve dosya baytı doğrulaması ayrı teslimdir |

## 8. Uygulama için teknik kontrol listesi

1. **Tek kaynak:** Alım alan verisi `purchaseOrders`; karara sunulan içerik değişmez evrak sürümü; EBYS'ye alınmış talebin karar kaynağı `ebysProcesses`. Görüntüdeki özet karar otoritesi olamaz.
2. **Şema:** Yeni alanların sürümü açık; eski kayıtların bulunmayan `engineVersion` değeri legacy kabul edilir. Geçişten sonra motor/bağ/owner kimliği değişmez. Eski tüm-kayıt upsert'i yeni bağı silemez.
3. **Atomiklik:** Ana ilişki oluşturma, onayla görev devri, son onayla icra ve kapanışla bildirim kendi kritik transaction'larında korunur. İki sekme, retry, yarım ağ kesintisi ve aynı operationId/farklı payload sınanır.
4. **Yetki:** Tam yolu bilinen deterministik kayıtlarla `get/getAfter`; `readerUids` eklenmez; yeni özel koleksiyonlar genel dinleyici/restore listesine alınmaz. Liste sorguları sahip/görev kapsamına uygun tasarlanır.
5. **Bütçe:** Her komutun yazma/okuma tablosu çıkarılır; 1000 ifade ve belge erişim kapısı emülatörde en ağır olumlu/olumsuz durumda sınanır. `returnRequests` ve eski 10 adımlı satın alma testleri aynı Rules dosyasıyla geçer.
6. **Stok:** Evrak/onay/icra stok üretmez. Gerçek `stockOperations` ve işe özel bağ kapanışta doğrulanır. Aynı stok işlemi yanlış işe bağlanamaz.
7. **Arayüz:** İşlevi anlatan görünür kısa açıklama; uzun kullanım için erişilebilir yardım; tek ana başlık; karanlık tema ve mobil. “Talep onaylandı / icra bekliyor / kapandı” ayrımı açık olmalı.
8. **Yayın:** Ortak Rules, indeks ve Hosting aynı commit'ten; indeksler hazır olmadan yeni sorgu açılmaz. Yeni akış kapatılınca mevcut yeni kayıtlar okunabilir/izlenebilir kalır; eski kodla kör geri dönüş yapılmaz.

## 9. Kabul senaryoları

- Yeni personel, gerçek ortak birimle kalemli talep oluşturur; ilgili evrak tek kez İç Yazışmalar'a bağlanır. Kişi/birim adı değişince kimlik bağı ve geçmiş çıktı korunur.
- Aynı talep için iki eşzamanlı bağlantı isteği tek ana evrak döndürür. Başka kullanıcı talebine, başka köke veya değiştirilmiş kaynağa bağlantı reddedilir.
- Dondurma sırasında mali taslak değişirse işlem çakışma verir. Sonradan kur değişimi geçmiş sürümü değiştirmez. Manuel ödenek kalem toplamından ayrı anlaşılır.
- EBYS'ye alınan talepte eski onay API'si ve doğrudan SDK karar yazması reddedilir. Legacy açık talepte mevcut onay çalışır.
- A→B rotasında B erken içeriği okuyamaz. A'nın geçmiş sürümü kalır; iade sonrası yeni sürüm önceki yetkiyi taşımaz. Vekâlet süresi/saat farkı gerçek aktör ve temsil edilen kişiyi bozmaz.
- Son onay doğru tür+birim politikasından tek icra işi açar. Geçersiz sorumlu atomik reddedilir. İade yönetici kuyruğuna düşer; yeniden havale ve süre izi korunur.
- Sahte stok referansı reddedilir; geçerli bağlı stok işlemiyle kapanış başarılıdır. Stoksuz işlem kendi politikasıyla kapanabilir; otomatik stok yazılmaz.
- Tek kapanış bildirimi; aynı aktör ve aynı payload çift kapanışı başarılı, farklı payload reddedilir.
- QR yalnız asgari kamusal alanları verir. İptal/arşiv ve özel token rezervasyonu yedek/kurtarma sonrasında korunur; dosya hash doğrulaması yapılmadıysa yapılmış gibi gösterilmez.
- 50'den fazla kayıt, sayfalama/filtre, oturum değişimi, eski istemci ve personel yetkileriyle liste/çıktı/export kapsamı doğrulanır.
- Gelen kayıt→cevap giden evrak→manuel gönderim→kapanış bağı gösterilir; aynı dış numara/muhatap/tarih için mükerrerlik uyarısı yetkisiz içerik sızdırmaz.

## 10. Bu incelemenin teslim sınırı

Bu turda üretim kodu ve Firestore Rules değiştirilmedi; veri göçü, commit veya deploy yapılmadı. Ana klasöre bu rapor eklendi. İnceleme worktree'sinde test günlükleri ve tek geçici teşhis testi `scratch/` içinde tutuldu; izlenen kaynak dosyalarda değişiklik yok.

Uygulama önerisi: H0 ile mevcut tabanı düzelt; H1/H2 ile kurtarma ve görünüm eksiklerini kapat; H3'te ilişki/motor/kur kararını kesinleştir; H4/H5/H6'nın ilgili personel girişini tek bütünleşik kabulde tamamla; H7/H8 ile A9 pilotuna hazırlan. A8 dış entegrasyonları ve kurumsal dosya genişlemesi ayrı kabul kapıları olarak kalır. H3 bütçe prototipi görülmeden “tam uyumlu” veya sabit süreli teslim garantisi verilmemeli.
