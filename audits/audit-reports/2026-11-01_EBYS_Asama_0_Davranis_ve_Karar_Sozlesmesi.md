# EBYS Aşama 0 — Davranış ve karar sözleşmesi

**Tarih:** 1 Kasım 2026  
**Durum:** Proje sahibinin 1 Kasım 2026 tarihli “Uygundur başla” talimatıyla aşama kabul edildi ve Aşama 1 başladı. Açık ürün kararları ilgili kapılarda kesinleştirilecek; commit için ayrıca açık talimat bekleniyor.
**Dal:** `feat/v3.4-ebys`  
**Başlangıç commit'i:** `767fed2b71c4f26106fe382f284f09ff04ca4f5d`  
**Yetki:** Proje sahibi ana planı ve Aşama 0 başlangıcını onayladı. Her aşamanın commit'i ayrıca onaya bağlı.  
**Aktif rol:** Uygulama ve süreç analizi. Ek görevli kullanılmadı.

## 1. Kapsam ve kanıt sınırı

Mevcut satın alma sürecinin sağlıklı çalıştığı proje sahibinin başlangıç kabulüdür. Bu belge, çalışan davranışı korumak ve yeni EBYS gereksinimlerini ondan ayırmak içindir. Eski denetim bulguları yeni arıza kabul edilmedi.

İnceleme kaynak kod ve mevcut test senaryolarının hedefli okunmasıyla yapıldı; canlı sisteme bağlanılmadı, veri yazılmadı, test veya tarayıcı koşumu yapılmadı. Aşağıdaki "mevcut" ifadeleri kaynakta görülen davranıştır; güncel uçtan uca başarı kanıtı değildir. Uygulama kodu değiştirilmedi.

Başlangıçta çalışma ağacında önceden bulunan bir araç yapılandırma klasörü ve ana EBYS planı takip edilmiyordu. Önceden bulunan klasöre dokunulmadı; ana plan bu çalışmada onay/kararlar ve rol adları bakımından güncellendi. Gelecekte commit yalnız gözden geçirilen EBYS belgelerini kapsamalı; toplu `git add .` kullanılmamalı.

## 2. Kesinleşen ürün kararları

| ID | Karar | Dayanak ve uygulama sonucu |
|---|---|---|
| K01 | İlk pilot kurum içi satın alma ve gelen/giden evrak | Proje sahibi 1 Kasım yanıtı. Gerçek KEP, e-imza ve kurum API bağlantıları sonraki fazda. Hazırlık/adaptör sözleşmesi yapılabilir. |
| K02 | İmzacı yalnız sırası gelince belge içeriğine erişir | İlk gereksinim ve onaylanan ana plan. Liste gizlemenin yanında sorgu, DB ve dosya erişimi düzenlenecek. |
| K03 | Karar veren imzacı karar verdiği sürümü sonradan görebilir | Proje sahibi 1 Kasım yanıtı. İmza/karar kaydı belirli belge sürümüne bağlanır; yeni revizyonlara kendiliğinden erişim verilmez. |
| K04 | Şimdilik Spark korunacak; sunucu gerektiren işler sonraki fazda | Proje sahibi 1 Kasım yanıtı. Pilot güvenilir otomatik e-posta, gerçek imza veya KEP gönderimi tamamlanmış gibi gösterilmeyecek. |
| K05 | Çalışan satın alma iş akışı korunacak | Proje sahibinin başlangıç kabulü ve onaylanan ana plan. Eski talepler yeni tür evraka körlemesine çevrilmez. |
| K06 | Yeni dal; commit öncesi aşama onayı | Proje sahibinin 1 Kasım talimatı. Çalışma dalı `feat/v3.4-ebys`; henüz commit yok. |
| K07 | Adlandırma görev ve süreç üzerinden yapılacak | Proje sahibinin son talimatı. Dal ve yeni EBYS belgelerinde araç/model/ajan adı kullanılmaz. |

## 3. Dört ekranın eylem ve veri haritası

| Ekran | Giriş ve çizim | Veri | Mevcut sınır | Genişleme |
|---|---|---|---|---|
| Satın Alma Talepleri (EBYS) | `index.html#purchaseTab`; `renderPurchaseModule`, `openNewPurchaseModal`, `openPurchaseDetail` | `purchaseOrders`; seçimlerde `units`, `productTypes` | Personel listesinde kendi talepleri veya aktif sıradaki onayı; admin görünümünde tüm kayıtlar. Bu filtre DB gizlilik sınırı değil. | Aynı alanda çok kalemli talep, döviz ve bağlı evrak/sürüm. |
| Bana Gelen Onaylar | `index.html#myApprovals`; `renderMyApprovals`, `viewWorkflow`, `approveStep`, `rejectStep` | Aynı `purchaseOrders.workflow` | Başlamış, iptal edilmemiş ve kişinin herhangi bir adımında bulunduğu kayıtlar; sırada/geçmiş karar etiketleri. Karar yetkisi aktif adıma ayrıca bağlı. | Sırası gelen görevler ve K03'e uygun karar sürümleri. İlerideki imzacıya içerik gönderilmez. |
| Admin: Talepler ve Süreçler | `admin.html#purchaseTab`; `renderAdminDashboard`, ortak satın alma/servis modülleri | `purchaseOrders`, envanter `requests`, `serviceRecords` | Tek ekranda ayrı iş alanları: bekleyen envanter talepleri, satın alma ve servis takip. | Gelen/giden evrak, havale ve icra alt alanları eklenir; stok ve servis işleri evrakla karıştırılmaz. |
| Admin: Tanımlar | `admin.html#definitionsTab`; `switchDefTab` ve alt alan çizimleri | `locations`, `productTypes`, `units`, `personel`, `workflowTemplates` | Mahaller, ürün türleri, birimler, iş akışları, personel. Tanım yazmaları admin kontrolünde. | Kurum, birim hiyerarşisi, ID bağlantıları, görev/vekâlet ve sürümlü süreç/belge şablonları. |

**Kritik ayrım:** "Satın Alma Talepleri" ile "Bana Gelen Onaylar" iki ayrı talep deposu değildir. Yeni ekranlar oluşturulurken aynı iş için ikinci bir karar kaynağı yaratılmayacak. Yeni görev/evrak varlıkları oluşursa kaynak sahipliği Aşama 1'de yazılı belirlenecek.

## 4. Korunacak davranış matrisi

Etiketler: **Koru** mevcut işlev; **Genişlet** mevcut üzerine yeni gereksinim; **Karar** ürün politikasına bağlı. Kayıtlar source-level envanterdir.

| ID | İşlem | Kaynak / önkoşul | Mevcut sonuç | Sözleşme |
|---|---|---|---|---|
| D01 | Yeni talep | `purchase-servises.js::savePurchaseRequest`; oturumdan talep sahibi | Tek kayıt; `createdBy`, `createdByUid`, `talepEden`, başlangıç olayı; akış başlamamış | Koru. Yeni kalem şeması eski alanları okuyabilmeli; talep sahibi değiştirilemez. |
| D02 | Düzenleme | `updatePurchaseRequest`; sahip veya admin | Personel başlamış talebi düzenleyemez; önce geri çeker. Admin istisnası var. | Koru; imzaya sunulmuş EBYS sürümünü değiştirmenin ayrı revizyon politikası Karar. |
| D03 | Ek yükleme | `uploadFiles`, `_uploadOrAsk` | Hata halinde yüklenebilenlerle devam veya iptal sorulur; sahte başarılı dosya oluşturulmaz | Koru; özel dosya erişimi ve sürüm manifestosu Genişlet. Spark'ta canlı depolama uygunluğu henüz teyitsiz. |
| D04 | Ek kaldırma | `deleteRequestFile`; sahip/admin, başlamamış akış | Kayıttaki referans kaldırılır ve olay eklenir; storage nesnesi silinmez | Koru; nihai EBYS eklerinin kaldırılması/saklanması Karar. |
| D05 | Manuel akış başlatma | `confirmStartWorkflow`, `_resolveWorkflowSteps` | 1–10 personel adımı; hesap UID eşlemesi; başlangıç olayı; ilk sıra | Koru. Talep sahibinin onay adımı olmasına başlangıçta engel var. |
| D06 | Şablondan başlatma | Aynı fonksiyon; `checkTemplateAuth`, `createWorkflowFromTemplate` | Şablonun kullanım kontrolü ve adım kopyası; önceki geçmiş korunur | Koru. Gelecek şablon revizyonunun açık işi değiştirmemesi açık kabul ölçütü olacak. |
| D07 | Sıralı onay | `_canActOnCurrentStep`, `approveStep`; sıradaki UID veya admin; self-approval koruması | Adım/aktör/tarih/olay güncellenir; sıra ilerler; son adımda `finished`, `completed`, `Onaylandı` | Koru. EBYS'de son onay ayrıca icra işi açacak; stok/gönderi başarısı sayılmayacak. |
| D08 | Red | `rejectStep`; aktif adım yetkisi, zorunlu gerekçe | Adım `rejected`; süreç `cancelled`, üst durum `Reddedildi`, geçmiş kayıtları | Koru. İade/düzeltme yeni ve ayrı işlem olacak; red ile aynı anlama getirilmez. |
| D09 | Geri çekme | `cancelPurchaseRequest` başlamış dal; sahip/admin | `Taslak`; adımlar temizlenir, sıra sıfırlanır, geçmiş korunur | Koru. Bitmiş talebe istemci eylemi ile kural izinlerinin ayrıntısı ilgili regresyonda kontrol edilecek; her durumdan dönüş varsayılmayacak. |
| D10 | İptal | Aynı fonksiyon başlamamış dal | `İptal Edildi`; akış pasif/bitmiş ve `cancelled`; olay eklenir | Koru. Resmî kayıt numarası ve arşiv etkisi yeni Karar. |
| D11 | Askıya alma | `stopWorkflow`; yalnız admin, başlamış/bitmemiş | `suspended`, `started=false`, `Durduruldu`; sıradaki işlem engellenir; yeniden başlatma yolu | Koru. Geri çekme ve iptal ile ayrı tutulur. |
| D12 | Kalıcı talep silme | `deletePurchaseRequest`; admin + onay | Talep kaydı kaldırılır; personel için iptal yolu | Mevcut satın alma davranışı kaydedildi. Kesinleşmiş EBYS evrakında kalıcı silme yerine saklama/iptal politikası Karar. |
| D13 | Liste/arama/Excel | `renderPurchaseModule`, `renderAdminDashboard`, HTML dışa aktarım eylemleri | Evrak/ürün/personel/birim araması; görünüm bazlı liste | Koru; K02/K03 erişimi arama, çıktı ve export'a da uygulanır. |
| D14 | Bana Gelen Onaylar | `renderMyApprovals` | Herhangi bir adımda bulunan kişiye ilişki görünümü; karar verme aktif sıra ile sınırlı | Genişlet: gelecekteki görev görünümü içerik sızdırmayacak; geçmiş görev doğru sürüme bağlanacak. |
| D15 | Birim tanımı | `saveUnitData`, `deleteUnit`, `renderUnitManagement` | ID + ad + personel ad listesi; admin yazması | Genişlet: ID görünürlüğü, kalıcı personel ilişkisi, hiyerarşi ve pasifleştirme. |
| D16 | Şablon tanımı | `saveTemplateData`, `deleteWorkflowTemplate` | Admin CRUD; en fazla 10 adım; kullanım listesi; belirsiz/hesapsız UID uyarısı | Koru; sürüm ve aktiflik eklenecek. UID çözülemeyen onaylayıcının gelecekteki politikası Karar. |
| D17 | Veri yenileme/hata | `startRealtimeSync`, `onInventoryDataUpdated`, `writeOk`, mutation rollback | Canlı liste yenilemesi; başarısız kayıt başarı olarak sunulmaz; bazı eylemlerde bellek geri alınır | Koru. Yeni dar sorguların unsubscribe/auth yaşam döngüsü birlikte tasarlanacak. |
| D18 | Paralel onay / checkpoint | `ParallelWorkflowEngine`, `WorkflowRollbackManager` | Motor ve kayıt kodu mevcut | Karar: bu incelemede canlı kullanım, çağrı zinciri ve uçtan uca başarı doğrulanmadı. İlk pilot sıralı onay önerisi; mevcut kod kaldırılmaz. |

## 5. Mevcut yetki ile hedef erişimin ayrımı

`firestore.rules` genel `/{root}/{col}/items/{docId}` dalında bilinen koleksiyonlar için üyeye okuma izni veriyor. Yazmalar ise personel/sahip/aktif onay adımı bakımından daha dar. `startRealtimeSync` genel koleksiyon dinleyicileriyle çalışıyor. Bu yüzden UI'da bulunmayan bir talep için "veri kullanıcıya hiç ulaşmadı" sonucu çıkarılmaz.

| Rol/durum | Mevcut kaynak davranışı | Hedef EBYS erişimi | Durum |
|---|---|---|---|
| Oturumsuz/anonim/üyeliği olmayan | Genel koleksiyon okumaları üyelik kapısına bağlı | Belge/ek/arama/export reddi | Korunacak; üyelik kapısının ayrıntısı Rules regresyonunda |
| Talep sahibi | Genel okuma; kendi kaydına izinli işlemler | Kendi talebi ve bağlı belge/sürüm takibi; karar verme ayrı görev | Hedef rol yetkileri ayrıntısı taslak |
| Sırası gelmemiş imzacı | Onay görünümünde ilişkili iş bulunabilir; genel okumalar daha geniş | Belge içeriği ve ek erişimi yok | K02 kesin |
| Sıradaki imzacı | UID ile aktif adım kararı; admin istisnası | Yalnız ilgili görev ve sunulan sürüm/ekler; paraf/onay/olur türüne göre işlem | Temel hedef kesin; görev türü ayrıntısı taslak |
| Karar vermiş imzacı | İlişkili süreçte geçmiş karar görünümü | Karar verdiği sürümü okuyabilir; sonraki sürümler otomatik açılmaz | K03 kesin |
| Başka personel | Üye okumaları geniş; başkasının kaydında karar/düzenleme yazması dar | İş ilişkisi yoksa belge/ek erişimi yok | Öneri; rol matrisi onayında kesinleşecek |
| Kayıt memuru | Ayrı EBYS rolü yok | Yetkili kayıt kapsamındaki gelen/giden evrak ve havale | Yeni rol önerisi |
| Birim/İcra sorumlusu | Ayrı EBYS icra rolü yok | Atandığı iş ve işlemi için gerekli içerik; görev kabul/sonuçlandırma | Yeni rol önerisi |
| Yönetici | Geniş admin okuma/yazma; mevcut işlemlerde istisnalar | Operasyon yöneticisi ile teknik yönetim ayrımı değerlendirilecek | İçerik ve müdahale yetkileri Karar |
| Arşiv sorumlusu | Ayrı EBYS arşiv rolü yok | Saklama, erişim ve imha politikası kapsamında işlem | Yeni rol önerisi |

**Tasarım koşulu:** Gelecekteki belge sürümü tek değişen doküman olarak tutulursa K03 sağlanamaz. Karar verilen içerik/ek manifestosu sabit sürüm olarak tutulmalı. Sıradaki görev değiştiğinde izinler ve görev sonuçları tutarlı ilerlemeli. Dosya erişimi, indirilebilir URL ve cihazda önceden kalmış içerik ayrı incelenmeli. Geçmişte indirilen verinin geri alınacağı söylenmez.

## 6. Pilotun örnek süreçleri

Bu örnekler uzmanla görüşülecek senaryo taslaklarıdır; uzman kabulü alınmış değildir. Kişi ve gerçek kurum verisi kullanılmaz.

### S01 — Kurum içi satın alma ve icra

1. Talep sahibi birim adına mal/hizmet kalemlerini ve gerekçeyi hazırlar; TRY/USD/EUR alanları politika kararına göre girilir.
2. Talep sahibi dışında sıralı paraf/onay görevlileri seçilir. Her görev belirli belge revizyonuna bağlıdır.
3. İlk imzacı erişir; sonraki imzacı belgeyi okuyamaz. İlk karar sonrası sıra ve erişim sonraki kişiye geçer.
4. İmzacılar karar verdikleri sürümü geçmişte görebilir. Talep geri çekilip revize edilirse eski karar yeni sürüme taşınmaz.
5. Son onaydan sonra ilgili birim/personel için icra işi açılır. "Onaylandı", satın almanın yapıldığı anlamına gelmez.
6. İcra sorumlusu işlem ve sonuç kanıtını işler; iş kapanır ve talep sahibine uygulama bildirimi görünür.

**Pilot sınırı:** Sunucu gerektiren güvenilir otomatik e-posta sonraki fazdadır. Mevcut stok işlemleri onaydan otomatik tetiklenmez. Çoklu döviz hesap politikası henüz kesinleşmedi.

### S02 — Gelen evrak ve havale

1. Kayıt memuru fiziksel/dijital olarak alınmış örnek evrakı; gönderen, dış sayı/tarih, kurum içi kayıt, konu ve ekleriyle kaydeder.
2. Aynı dış evrakın mükerrer kayıt ihtimali kullanıcıya gösterilir; kesin numara verme anı ayrı karardır.
3. Yetkili birim sorumlusu ilgili personele havale eder; görev sahibi teslim alır ve son tarihini görür.
4. Personel işlem sonucunu kaydeder; gerekiyorsa S03 ile cevap evrakına bağlar.
5. Sonuç, tamamlanma ve arşiv izi korunur; kayıt yapıldı diye işlenmiş sayılmaz.

**Pilot sınırı:** KEP kutusundan gerçek alım yapılmaz; manuel kayıt gerçek KEP teslim kanıtı gibi gösterilmez.

### S03 — Giden evrak, üst yazı ve olur

1. Personel kurum şablonundan üst yazı hazırlar; muhatap, konu, dağıtım ve ekler belirlenir.
2. Paraf → gerekiyorsa olur → onay görevleri seçilen belge sürümünü inceler. Olur bir karar türüdür; kriptografik imza yöntemi ayrı konudur.
3. Düzeltme gerekirse gerekçeli iade ile yeni revizyon hazırlanır; önceki kararların kapsamı korunur.
4. Kurum içi onaylanan çıktı dondurulur; kurum içi doğrulama QR'ı varsa doğru belge/sürüm durumuna gider.
5. Yetkili personel pilotta dış gönderimi manuel kaydeder; kanal/tarih/referans ile belge ilişkilendirilir. Gerçek KEP/e-imza kanıtı olmadığı açık görünür.
6. Evrak kapanır/arşivlenir; cevap ilişkisi ve gönderim bilgisi kayıtlı kalır.

**Pilot sınırı:** Taslak çıktı ve kurum içi onay, gerçek e-imza veya e-Devlet onayı olarak etiketlenmez. Gerçek resmî dış kullanım kabulü sonraki fazdadır.

## 7. Açık karar günlüğü

K01–K07 uygulama girdisidir. Aşağıdaki öneriler onaylanmış sayılmaz; ilgili geliştirme başlamadan kesinleştirilecek.

| ID | Açık konu | Önerilen başlangıç | Karar kapısı |
|---|---|---|---|
| A01 | İlk pilot birimi ve görev sahipleri | Bir birim; talep sahibi, kayıt memuru, sıralı imzacılar, icra sorumlusu | Aşama 0 kabulü / uzman görüşmesi |
| A02 | Teknik admin içerik erişimi ve olağanüstü müdahale | Operasyon rolünden ayrı; müdahale gerekçeli ve kayıtlı | Aşama 1 ve 5 |
| A03 | Karar sayısı ve sıra düzeni | İlk pilot yalnız sıralı; paralel/çoğunluk yeni kanıt gelene kadar kapsam dışı | Aşama 1 |
| A04 | Eski açık talepler | Eski akışla tamamla; otomatik dönüştürme yapma. Yeni gizlilik politikasına geçiş ayrı kapsam | Aşama 1 ve 5 |
| A05 | Kesin evrak numarası, yıl/birim serisi | Taslak kimliği ayrı; kesin kayıt anında tekil numara; iptal numarası tekrar kullanılmaz | Aşama 4 |
| A06 | Döviz/vergi/yuvarlama | Belge para birimi + sabit kur anlık görüntüsü önerisi; kalem para birimi ihtiyacı uzmanla netleşecek | Aşama 3 |
| A07 | UID'siz veya aynı adlı imzacı | Yeni görevde kimlik çözülmeden başlatma engeli; eski admin istisnası ayrı incelenir | Aşama 2 ve 5 |
| A08 | İmzalı/onaylı içerik düzenleme ve silme | Dondurulmuş sürüm değişmez; düzeltme yeni sürüm; kesin evrakta kalıcı silme ayrı politika | Aşama 4 ve 7 |
| A09 | Saklama, gizlilik, arşiv ve imha | Süreleri uydurmadan kurum politikası/uzman girdisiyle belirle | Aşama 4 ve 7 |
| A10 | Spark'ta özel dosya depolama | Mevcut bucket/plan/erişim incelenmeden upload çalışıyor kabul etme; uygun çözüm bulunmadan ek gerektiren pilotu açma | Aşama 1 |
| A11 | Pilot bildirimi | Uygulama içi bildirim; otomatik e-posta sunucu fazına | Aşama 1 ve 6 |
| A12 | Belge şablonu, paraf/olur zorunluluğu ve numara anı | Üç anonim örnek evrak üzerinden uzmanla karar ver | Aşama 0 görüşmesi / Aşama 4 |

**Uzman görüşmesi girdisi:** Anonim satın alma üst yazısı, gelen evrak ve cevap/olur örneği; her birinin rol sırası, kayıt anı, iade/red farkı, sonuçlandıran kişi ve saklama sınıfı. Gerçek kişisel veriler veya erişim sırları bu belgelere alınmaz.

## 8. Regresyon ve kabul senaryoları

Mevcut `tests/rules/rules.test.mjs`, satın alma oluşturma, sahiplik, başlatma, 10 adım, onay/red, geri çekme, sahte aktör/geçmiş, yanlış UID ve silme izinleri için senaryolar içeriyor. `tests/unit/ownership.test.mjs` ve ilgili emülatör entegrasyon dosyaları kimlik bağının kontrol kaynaklarıdır. `scratch/flow-tests.js` akış doğrulamasının mevcut aracıdır. Bu dosyaların bulunması güncel başarı sonucu değildir; aşağıdaki senaryolar sonraki değişikliklerin doğrulama listesidir.

| Kontrol | Beklenen gözlem | Kanıt zamanı |
|---|---|---|
| Talep aç → düzenle → başlat | Aynı kayıt, doğru sahiplik ve değişmeyen başlangıç davranışı | İlgili uygulama aşaması |
| Üç kişi sıralı onay | Yalnız aktif kişi karar verir; son adım onayı talep onayını tamamlar | Aşama 3/5 |
| Yanlış kişi / sahte UID / çift karar | DB tarafından reddedilir; ikinci geçiş oluşmaz | Aşama 5 |
| Red / geri çek / askı / iptal | Dört ayrı sonuç; uygun aktör ve geçmiş | Aşama 5 |
| Geri çek → revize → yeniden sun | Eski karar eski sürümde; yeni onay gereken yerde yeniden alınır | Aşama 4/5 |
| Gelecekteki imzacı doğrudan SDK/ek/export erişimi | İçerik alınamaz; aktif görev erişimi çalışır | Aşama 5 |
| Geçmiş imzacı | Karar verdiği sürüm erişilebilir; sonradan hazırlanan sürüm otomatik açılmaz | Aşama 5 |
| Şablon değişimi / aynı adlı personel | Açık iş kendiliğinden değişmez; belirsiz kimlik otomatik seçilmez | Aşama 2 |
| Yükleme hatası / özel ek | Yanlış başarı yok; ek erişimi belge politikasıyla tutarlı | Aşama 1/4 |
| Son onay → icra → kapanış | Onay ile icra ayrıdır; iş/bildirim mükerrer oluşmaz | Aşama 6 |
| Eşzamanlı kayıt numarası | Tekil numara, tekrar gönderimde mükerrer kayıt yok | Aşama 4 |
| Yedek / geri yükleme | Yeni sürüm, görev, olay ve ek referansları kapsamda | Aşama 9 |

## 9. Aşama 1'e devir ve bu turun teslimi

Aşama 1 için kesin girdiler: K01–K07, dört ekranın kaynak haritası, D01–D18 ve üç pilot senaryosu. İlk mimari paket; kurum/personel kimliği, belge/sürüm/görev ilişkisi, eski kayıt adaptörü, kurallar/sorgu birlikte geçişi ve Spark sınırında uygulanabilir özel dosya erişimini karara bağlayacak.

**Bu turda değişen dosyalar:**

- `audits/audit-reports/2026-10-30_v3.4_EBYS_Genisleme_Is_Plani.md`: onay durumu, rol adları ve kesin ürün kararları.
- `audits/audit-reports/2026-11-01_EBYS_Asama_0_Davranis_ve_Karar_Sozlesmesi.md`: bu aşamanın teslimi.

Üretim kodunda değişiklik yok. Dokümantasyon dışında etki veya veri geçişi yapılmadı. Test çalıştırılmadı; bu tur teknik envanter ve karar kaydıdır. Uzman teyidi ve A01–A12 ürün kararları gerektiği aşamada açık kalır. Sonraki talimatla Aşama 0 kabul edildi ve Aşama 1 teknik tasarımına geçildi. Commit için ayrıca açık talimat bekleniyor.
