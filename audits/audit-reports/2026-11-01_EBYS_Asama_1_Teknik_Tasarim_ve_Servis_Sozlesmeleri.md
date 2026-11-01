# EBYS Aşama 1 — Teknik tasarım ve servis sözleşmeleri

**Tarih:** 1 Kasım 2026 — Revizyon 2  
**Dal:** `feat/v3.4-ebys`  
**Kod referansı:** `767fed2b71c4f26106fe382f284f09ff04ca4f5d`; uygulama kodunda bu tur değişiklik yok.  
**Durum:** Revizyon 2 proje sahibinin plan commit'i ve Aşama 2 başlangıç talimatıyla kabul edildi; plan `299e2fc` commit'inde. Bu belge üretim uygulaması, Rules kanıtı veya canlı uygunluk beyanı değildir.
**Önkoşul:** Aşama 0 kabulü ve Aşama 1 başlangıcı proje sahibinin “Uygundur başla” talimatıyla verildi. Commit için ayrıca açık talimat bekleniyor.  
**Sınır:** Vanilla JavaScript, tarayıcıda çalışma, derleme/framework eklememe, Spark'ı koruma. Dış entegrasyon ve güvenilir sunucu işleri sonraki fazda.

## 1. Tasarımın dayandığı inceleme

Kaynaklar: `purchase-servises.js`, `edm-workflow.js`, `admin-purchase-render.js`, `firebase-handler.js` koleksiyon/dinleyici/yazma sınırları, `schema.js`, `ownership.js`, `admin-backup.js`, `firestore.rules`, `firebase.json` ve Aşama 0 sözleşmesi. Okuma hedefli statik incelemedir; test, tarayıcı ve canlı veri işlemi yapılmadı.

Mevcut `COLLECTIONS` hem genel dinlemeyi hem CRUD/yedek davranışlarını etkiliyor. Yeni özel EBYS koleksiyonlarını bu listeye eklemek, tüm veriyi üyelere dağıtma ve mevcut toplu yazma yollarına açma riski taşır. Mevcut yedek yalnız bellekteki dizi ve bilinen koleksiyonları alıyor; yeni EBYS verisinin yedeğini kendiliğinden kapsamıyor. Bunlar entegrasyonun birlikte ele alınacak sınırlarıdır.

## 2. Kaynak sahipliği ve ana mimari karar önerileri

| ID | Öneri | Sonuç / onay sınırı |
|---|---|---|
| T01 | `purchaseOrders` satın alma alan verisinin kaynağı olarak kalır | Eski kayıt/akışlar otomatik taşınmaz. Yeni evrakın içeriği satın alma tablosundan sürekli yeniden hesaplanmaz. |
| T02 | Evrak başlığı, taslak ve dondurulmuş sürüm ayrı tutulur | Geçmiş imzacıya sonradan değişmiş içeriği gösterme önlenir. |
| T03 | Yeni EBYS süreçleri sürüme bağlı sıralı görevler üzerinden yürür | İlk pilot için sıralı motor önerisi; paralel akış kapsamı onaylanmış değildir. |
| T04 | Her yeni süreç için tek karar otoritesi vardır | Mevcut `workflow` ile yeni süreç motoru aynı talebin kararlarını eşzamanlı yönetmez. |
| T05 | Yeni EBYS verisi özel servis/dinleyici/yedek sicilinde tutulur | Genel `COLLECTIONS` listesine körlemesine eklenmez. |
| T06 | Okuma erişimi süreç ve görev geçmişinden dinamik çözülür | Okuyucu dizisi tutulmaz; tam yolu bilinen süreç/görev kayıtları Rules ile okunur. |
| T07 | Birim/personel ilişkisi kalıcı ID taşır | Görünen ad değişebilir; tarihsel belge üzerindeki ad/görev anlık görüntüsü değişmez. |
| T08 | Yeni EBYS olayları eklenir; güncellenmez/silinmez | Mevcut gömülü `akis/history` yeni günlükle karıştırılmadan eski kayıtta korunur. |

Bu kararlar uygulanmış değildir. Aşama 1 kabulü tasarım yönünü kabul eder; açık ürün politikalarını kendiliğinden kapatmaz.

## 3. Varlıklar, yollar ve alan sözlüğü

Tüm yollar `AppEnv.COLLECTION_ROOT` ile çözülür. Aşağıdaki `ROOT` bir açıklama simgesidir. Koleksiyon adları bu tasarımın önerisidir; kod API'si değildir. Mevcut veriyle tutarlılık için düz `ROOT/{koleksiyon}/items/{id}` düzeni kullanılır.

| Varlık / koleksiyon | Temel alanlar | Bütünlük kuralı |
|---|---|---|
| Mevcut `units` | `id`, `name`; yeni `organizationId`, `parentUnitId`, `code`, `active`, `revision` | Mevcut ID korunur; üst birim döngüsü ve kullanılan birimi kalıcı silme engellenir. Hiyerarşi güncellemesi ilk aşamada admin işi. |
| Yeni `ebysOrganizations` | `id`, `name`, `code`, adres/künye, `active` | Kurum künyesi belge sürümüne kopyalanır; sonradan değişiklik geçmiş çıktıyı değiştirmez. |
| Yeni `ebysMemberships` | `id`, `personnelId`, `userUid`, `unitId`, `role`, `validFrom`, `validUntil`, `active`, `revision` | Yetki veren ilişki yalnız yetkili yönetim yolundan yazılır; kullanıcı kendine rol veremez. Vekâlet başlangıç/bitiş ve veren kişiyle ayrıca bağlanır. |
| Mevcut `personel` | `id`, `uid`, görünen ad; hesap bağı | `Ownership` kimlik çözümünü kullan; UID üretme veya aynı adı otomatik tek kişi sayma yok. |
| Yeni `ebysDocuments` | `id`, `kind: incoming/outgoing/internal`, `ownerUid`, `unitId`, `purchaseOrderId?`, `state`, `currentVersionId?`, `revision`, `createdAt`, `updatedAt` | Kısıtlı yönlendirme kaydı; içerik ve gizli konu burada geniş erişimle yayınlanmaz. |
| Yeni `ebysDrafts` | `id`, `documentId`, `ownerUid`, `revision`, `content`, `metadata`, `attachmentDrafts` | Taslak yalnız yetkili editör kapsamındadır; gelecekteki imzacıya okunmaz. |
| Yeni `ebysVersions` | `id`, `documentId`, `versionNo`, `schemaVersion`, `content`, `metadataSnapshot`, `purchaseSnapshot?`, `attachments`, `contentDigest`, `processId`, `ownerUid`, `createdAt` | Sürümün tüm alanları yaratıldıktan sonra değişmez; okuma hakkı süreç/görevden çözülür. |
| Yeni `ebysProcesses` | `id`, `documentId`, `versionId`, `templateId`, `templateRevision`, `routeSnapshot`, `currentStep`, `activeAssigneeUid`, `ownerUid`, `state`, `revision`, `lastEventId` | Tek belge sürümü ve rota anlık görüntüsüne bağlıdır. Rota bilgisi gelecekteki görevlilere genel olarak dağıtılmaz. |
| Yeni `ebysTasks` | `id`, `processId`, `documentId`, `versionId`, `assigneeUid`, `activeStepId?`, `activeKind?`, `state`, `decisionsByStep`, `hasDecision`, `revision` | Süreç ve kişi için deterministik görev kaydı; yalnız aktif atamayla yaratılır. Geçmiş kararlar eklenir ve değişmez. Gelecekteki adımlar özel rotada kalır. |
| Yeni `ebysEvents` | `id`, `aggregateId`, `processId?`, `versionId?`, `operationId`, `type`, `actorUid`, `fromRevision`, `toRevision`, `recordedAt`, `reason?` | Yeni olayın aktörü oturumdan, zamanı sunucu zamanından; update/delete yok. Geçiş ile zorunlu atomik bağ. |
| Yeni `ebysOperations` | `id`, `actorUid`, `aggregateId`, `command`, `payloadDigest`, `resultIds`, `recordedAt` | Tekrar edilen komut aynı sonucu verir; aynı anahtarla farklı içerik reddedilir. Okuma ilgili kullanıcı/yönetim kapsamı. |
| Yeni `ebysExecutionJobs` | `id`, `processId`, `unitId`, `assigneeUid`, `state`, `revision`, sonuç/kanıt referansı | Son onay için deterministik tek iş. İcra politikası Aşama 6'da kesinleşir. |
| Yeni `ebysNotifications` | `id`, `recipientUid`, `eventId`, `type`, `readAt?`, asgari özet | Alıcı kendi okunma alanını değiştirir; bildirim yeni belge erişimi vermez. |

| Yeni `ebysRegistrationIds` | `id=registrationNo`, `documentId`, `operationId`, `createdAt` | Sayaç değil; rastgele evrak numarasının tekil rezervasyonu. Başka belgeye overwrite yasak. |
| Yeni `ebysAttachments` | `id`, `documentId`, `versionId`, `provider`, `objectKey?`, `state`, boyut/hash/parça manifestosu | Ek kimliği ve sürüm bağı sabit; tamamlanmamış yükleme onaylanmış sürüme bağlanmaz. |
| Seçimlik `ebysAttachments_chunks` | `attachmentId`, `versionId`, `index`, `dataBase64`, `encodedLength` | Küçük UAT ekleri için sınırlı alternatif; genel dinleyici ve index dışı yük verisi. |

**Ortak türler:** ID'ler string; yeni rastgele kayıt ID'si tarayıcının kriptografik rastgele üretiminden, kesin numaradan bağımsız. Legacy sayısal ID'ler salt görünümde stringe çevrilir; DB kimliği sessizce yeniden yazılmaz. `revision` monoton tam sayı; `schemaVersion=1` ilk yeni EBYS şemasıdır. İşlem zamanı için Firestore timestamp; ayrıca kullanıcı girişi belge tarihi ayrı alan olur. Yerel görüntüleme Türkiye saatine çevrilir; sıralama yerelleştirilmiş tarih metnine dayanmaz.

**Ek manifestosu:** `attachmentId`, `storageProvider`, `objectKey`, `name`, `mediaType`, `sizeBytes`, `digestAlgorithm`, `digest`. Kalıcı herkese açık indirme URL'si yetki yerine kullanılmaz. Hash bütünlük karşılaştırmasıdır; istemcinin ürettiği hash tek başına resmiyet veya güvenilir imza kanıtı değildir.

**Mali anlık görüntü:** Satın alma kalemleri, para birimi ve gerekiyorsa kur/vergi bilgileri sürüm oluşturulurken kopyalanır. Para hesabı Aşama 3'ün kesin ölçek/yuvarlama sözleşmesine bağlıdır; bu tasarım kur/vergi politikasını onaylamaz.

## 4. Yaşam döngüleri ve çift motoru önleme

Yeni evrak: `draft → registered/in_review → internally_approved → pending_execution/pending_dispatch → closed → archived`. Gelen evrakta `registered → assigned → processing → closed` yolu kullanılabilir. Kesin geçişler belge türüne göre whitelist olacaktır; her tür her geçişi kullanmaz. Pilot `internally_approved`, nitelikli elektronik imza veya dış gönderim delili değildir.

Görev: `active → approved/rejected/returned/cancelled`. Yeni karar türleri mevcut satın alma motoruna etiket eklenerek taklit edilmez. İade, red, askıya alma ve geri çekme ayrı komuttur. Geçmiş karar verilen sürüm değişmez; yeniden sunum yeni sürüm/süreç örneğidir.

Satın alma için `engineVersion` alanı önerilir: yoksa `legacy`, yeni EBYS akışına açıkça alınmış yeni talepte `ebys-v1`. Bu alanı UI keyfî değiştiremez. `legacy` talep `workflow` ile, `ebys-v1` talep bağlı yeni süreçle yönetilir. Yeni süreçte talebin görüntü durumuna yapılan yansıma karar kaynağı değildir ve aynı transaction içinde korunur.

İlk aşamalarda bütün mevcut talepler legacy kalır. Eski açık işlerin otomatik taşınmaması öneridir; kabul kapısı Aşama 5'tedir. K02 gizliliği devreye girerken legacy satın alma verisindeki geniş okumalar da daraltılmalı; legacy etiketinin geniş okuma istisnası olması kabul edilmez. Yeni ek alanları eski tüm-doküman upsert yollarının silmesini engelleyecek şema ve Rules koruması gerekir.

## 5. Süreç ve karar üzerinden dinamik okuma yetkisi

`readerUids` kaldırılmıştır; belge sürümüne okuyucu ekleyen komut veya alan yoktur. İstemci tarafından gönderilen bir UID/ACL yetki kanıtı sayılmaz. Önceki tasarımda dizinin Rules ile doğrulanması öngörülüyordu; dizi kullanımı tek başına açık kanıtı değildir, ancak yeni tercih bu ek ACL mutasyonunu tamamen ortadan kaldırır.

**Tam yol zorunluluğu:** Rules `get()` bir koleksiyonda “bu UID'nin herhangi bir görevi var mı?” sorgusu yapamaz. Bu nedenle yeni EBYS sürümü ile süreç örneği bire bir bağlanır: kriptografik UUID `versionId = processId` korelasyon kimliği olarak baştan ayrılır; sürüm ve süreç farklı koleksiyonlarda aynı ID'yi taşır. Yeniden sunum yeni sürüm/süreç kimliğidir. Aynı süreçte aynı kişinin birden fazla adımı olabilir.

`ebysTasks/items/{processId}__{uid}` deterministik kişi-görev kaydıdır. Süreç ID'si standart UUID biçimiyle sınırlanır, ayraç ve UID alanı Rules'da ID ile birebir eşlenir. Kayıt `assigneeUid`, `versionId`, aktif adım ve `decisionsByStep` içerir. Her kararın `stepId`, tür, aktör UID, sonuç, zaman ve sürüm bağı sabittir. `hasDecision` yalnız kurallarca doğrulanan ilk kararla true olur; kullanıcı kendi başına işaretleyemez. Aynı kişinin sonraki adımı geldiğinde eski karar değiştirilmeden aktif adımı yenilenir.

**Sürüm get yetkisi (kavramsal; çalıştırılabilir kural değildir):**

1. Ortam üyeliği doğrulanır; sürümün değişmez süreç/kimlik bağı kontrol edilir.
2. `get(ROOT/ebysProcesses/items/versionId)` ile süreç okunur. Yetkili sahip/kayıt rolü ayrı kuralla; sıradaki imzacı için `activeAssigneeUid == request.auth.uid` ve aktif süreç durumu gerekir.
3. Aktif görev koşulu için `get(ROOT/ebysTasks/items/{versionId}__{auth.uid})` kullanılır; `activeStepId`, süreçteki sıra, sürüm ve atanan kişi eşleşmelidir.
4. Geçmiş erişim aynı tam yoldaki görev kaydının kurallarla korunmuş en az bir gerçek kararından türetilir. `returned/cancelled` gibi karar sayılmayan görev kapatmaları erişim kazandırmaz; onay/red geçmişi karar verilen sürümde kalır.
5. Gelecekteki imzacının görev kaydı henüz yaratılmadığından, yalnız rotada adının/UID'sinin olması erişim vermez. Geri çekmede karar vermemiş aktif görev kapatılır ve süreç aktörü temizlenir; geçmiş karar kaydı korunur.

Görev yaratma/değiştirme yalnız mevcut süreçteki yetkili geçiş ve `getAfter()` ile bağlı eş yazmalar altında mümkündür. Sahte görev/karar yaratarak içerik açma; rotayı değiştirme; görev sürümünü farklı belgeye bağlama; karar silme veya `hasDecision` yükseltme reddedilir. Aktif adımın başlatıcısı gelecek rota kişisine zamanından önce görev oluşturamaz. Rota tanımlama yetkisi ve kendi talebini onaylama engeli korunur.

**Listeleme:** `subscribeMyTasks` kişinin `assigneeUid` ve aktif/geçmiş karar filtreleriyle görev özetlerini getirir. Sürüm koleksiyonunda genel “okuyabildiklerim” sorgusu kaldırılır. Görev kartından bilinen `versionId` ile tekil `getVersion` yapılır; yetki her okumada yeniden değerlendirilir. Talep sahibi kendi `ownerUid` sorgusunu kullanabilir; birim/operasyon sorguları kesin rol politikasıyla ayrıca kanıtlanır. Sırası gelmeyen kişiye belge başlığı/ek/arama/export üzerinden dolaylı içerik dağıtılmaz.

Yeni koleksiyonlar genel üye okumasına açılmaz. Legacy geniş satın alma okuması da geçişte daraltılır. Teknik admin içerik yetkisi A02 açık kararıdır. Dinamik Rules tasarımı görev kayıtları doğru korunursa güvenlidir; henüz emülatör kanıtı değildir. İki görevde aynı kişi, sıra değişimi, geri çekme, önceki sürüm ve sahte geçmiş için olumsuz testler zorunludur.

## 6. Servis API sözleşmeleri

Yeni dosyalar öneri: `src/services/ebys-repository.js`, `ebys-document-service.js`, `ebys-process-service.js`, `ebys-file-service.js`, `ebys-backup-service.js`; saf doğrulamalar `src/utils/ebys-schema.js`. UI `window.AppModules.EBYS` üzerinden kullanır. Üretim kodu bu tur yazılmadı.

| API | Girdi | İş / çıktı |
|---|---|---|
| `getPurchaseView(id)` | Legacy kayıt ID'si | Mutasyonsuz görünüm; `engineVersion`, eski alanlar ve varsa bağlı evrak. Yeni karar üretmez. |
| `saveDraft(command)` | `documentId?`, `expectedRevision`, içerik, `operationId` | Sahip/editör doğrulama; yeni revizyon ve doküman ID'si. Aktör UID girdi olarak kabul edilmez. |
| `freezeVersion(command)` | Taslak ID/revizyonu, doğrulanmış ek manifestosu | Değişmez içerik sürümü; `versionId`, digest. Onay süreciyle bağlantısı transaction sözleşmesine uyar. |
| `startProcess(command)` | `versionId`, rota/şablon revizyonu, `operationId` | Kimlikleri çözülmüş rota snapshot'ı; süreç + yalnız ilk aktif kişi-görev kaydı + olay. |
| `decideTask(command)` | `taskId`, `expectedRevision`, karar/gerekçe, `operationId` | Sunulan sürüm ve aktif sıra doğrulanır; karar/sıra/görev/olay birlikte ilerler; okuma izni bunlardan türetilir. |
| `withdrawProcess(command)` | Süreç ID/revizyonu, gerekçe, `operationId` | Açık görev iptali; revizyon politikası; geçmiş karar sürümü korunur. |
| `registerDocument(command)` | Evrak ID/revizyonu, kurum kodu, `operationId` | Rastgele bileşenli kayıt numarası + tekillik rezervasyonu + evrak + olay atomik; sayaç yok. |
| `subscribeMyTasks(options, onData)` | Durum, limit, cursor | Yalnız kişinin yetkili kuyruk sorgusu; unsubscribe döndürür. |
| `getVersion(versionId)` | Sürüm ID | Doğrudan yetkili okuma; yasaksa content içermeyen hata. |
| `files.prepareUpload/open/removeDraft` | Belge/sürüm/ek referansları | Seçilen özel depolama adaptörü; destek yoksa `capability-unavailable`. Sahte dosya URL'si üretilmez. |
| `exportEBYSBackup/previewRestore` | Ortam, kapsam/manifesto | Web SDK ile yetkili, doğrudan veritabanı okumaları; bellekteki görünür veri yedek diye alınmaz. Ayrı backend gerektirmez. |

Komut cevabı: başarıda `{ok:true, operationId, aggregateId, revision, resultIds}`; hatada `{ok:false, code, message}`. Kodlar: `forbidden`, `conflict`, `validation`, `offline`, `capability-unavailable`, `maintenance`, `retryable`, `integrity-failed`. Hata kaydında belge içeriği, token veya sır bulunmaz. `message` güvenli kullanıcı mesajıdır. UI yalnız başarılı DB sonucundan sonra tamamlandı gösterir.

## 7. Transaction ve tekrar gönderim sözleşmesi

`operationId` kullanıcı ilk gönderdiğinde üretilir ve yeniden denemede aynı kalır. İşlem kaydı kimliği aktör ve anahtar kapsamıyla ayrılır; komut parametreleri digest'iyle eşleştirilir. Transaction yeniden çalışırken ID/zaman kaynaklı yeni iş üretmez; bütün okumalar yazmalardan önce yapılır. DB kararı için `expectedRevision` ve güncel durum zorunludur.

Örnek ara onay yazmaları: mevcut görev kararı, süreç sıra/revizyonu, deterministik mevcut/sonraki kişi-görev kayıtları, geçiş olayı, operation sonucu. Son onayda sonraki görev yerine (Aşama 6'da) deterministik icra işi ve sahibine bildirim eklenir. Aynı onayı tekrar göndermek önceki sonucu döndürür; farklı payload aynı operation anahtarını kullanamaz.

Rules, her desteklenen komut için izin verilen alan farkını, aktörün görev sahipliğini, sürüm/rota sabitliğini ve `getAfter()` ile zorunlu eş yazmaları kontrol eder. Süreç `lastEventId` ile olaya, olay da doğru önceki/sonraki revizyona bağlıdır; yalnız olay eklemek geçiş sayılmaz, olaysız geçiş de reddedilir. Operation kaydı yalnız ilgili geçiş kanıtıyla yaratılır; istemci kendi başına sahte başarı kaydı ekleyemez.

Tek kritik geçiş tek transaction içinde kalır; Rules veya boyut sınırına sığmayan geçiş sessizce parçalara ayrılmaz. 10 adımlı rota varsayımıyla başlatma, ara karar, son karar, iade/geri çekme için erişim çağrısı bütçeleri ayrı çıkarılacak. Firestore belgesindeki işlem başı 10, çoklu yazma/transaction başı 20 erişim çağrısı sınırına uyum kanıtı uygulama kapısıdır. Hesaplanan çağrılarda cache'e güvenilmez.

Transaction çevrimdışıysa karar kesinleşmiş gibi gösterilmez. Yerel taslak saklama ayrıca ürün kararıdır; hassas içerik için otomatik kalıcı tarayıcı cache'i varsayılmaz.

## 8. UAT, evrak numarası ve dosya depolama

### 8.1 UAT gerçeği ve plan sınırı

Mevcut gerçek ortam kullanımı tek adminli UAT'tır; kurumsal toplu devreye alma değildir. Kota/performans tahminleri bu gerçeğe göre yapılır. Buna rağmen Firebase'ın 1 Kasım 2026'da kontrol edilen açıklamasında Cloud Storage for Firebase erişimi Blaze gerektirir; düşük hacim bu plan kapısını kaldırmaz. Spark'ta bulut Storage upload'u sorunsuz vaat edilemez. Canlı plan/bucket bu çalışmada sorgulanmadı. Yerel `uploadFiles` varlığı başarılı upload kanıtı değildir.

### 8.2 Sayaçsız kayıt numarası

`ebysCounters` ve ardışık numara gereksinimi kaldırılmıştır. Önerilen gösterim: `EBYS-{KURUM}-{YYAAGG}-{128-bit-rastgele-hex}`. Örnek kısa gösterim `EBYS-KRM-261101-X4K9…`; gerçek anahtarda yalnız dört rastgele karakter kullanılmaz. Kimlik `crypto.getRandomValues` veya `crypto.randomUUID` ile üretilir. Tarih bileşeni sunucu kayıt zamanına göre kontrol edilir; tek başına istemci saati güvenilir zaman damgası veya kriptografik kanıt değildir.

`ebysRegistrationIds/items/{registrationNo}` create-only rezervasyonu ile belge ve olay aynı istemci transaction'ında yazılır. Çakışmada başka belge overwrite edilmez; henüz başarı almamış komut yeni rastgele değerle tekrar denenir. Başarılı kayıt sonrası aynı `operationId` aynı numarayı döndürür. Kayıt numarası sıralama/yıl sayacı olarak kullanılmaz; kronoloji `recordedAt` ile belirlenir. Kurumun zorunlu resmî numara standardı ayrı alanda/gelecek entegrasyonla tutulabilir; bu rastgele iç kimlik kendiliğinden resmî standart uygunluğu sağlamaz.

**Teknik düzeltme:** Firestore Web SDK `runTransaction` backend olmadan da vardır; eşzamanlı sayaç teknik olarak transaction ve doğru Rules ile korunabilir. Sayaç burada ürün tercihiyle kaldırıldı, istemci transaction'ı olmadığı için değil. İş akışı atomikliği için Web SDK transaction kullanımı devam eder.

### 8.3 Birincil hedef: Cloud Storage adaptörü

Kurumsal hedef Cloud Storage'dır; Cloud Functions gerektirmeyen Web SDK + Firestore/Storage Rules sınırlarıyla tasarlanır. Aktif bulut kullanımı Blaze plan erişimine bağlıdır; bu tasarım planı kendiliğinden yükseltmez.

Yollar:

- Taslak yükleme: `ebys/{root}/drafts/{draftId}/{attachmentId}/payload`.
- Dondurulmuş sürüm: `ebys/{root}/versions/{versionId}/{attachmentId}/payload`.
- Kullanıcı dosya adı object key'e gömülmez; görünen ad manifestodadır. UUID'ler, ortam ve varlık ilişkisi doğrulanır.

Manifesto: provider (`cloud-storage`, `firestore-chunks` veya `none`), ek kimliği, belge/sürüm bağı, object key, bayt boyutu, MIME, SHA-256, durum (`uploading/ready/failed`), yükleyen UID, kayıt zamanı ve gerekirse parça sayısı. Kalıcı bearer download URL'si belgeye kaydedilmez; yetkili SDK indirmesi ve geçici object URL kullanılır.

Storage Rules taslağı: varsayılan red; taslakta yalnız yetkili düzenleyiciye create, belirlenmiş MIME/boyut sınırı, overwrite engeli. Nihai sürümde create yalnız taslak sahibi ve geçerli yükleme manifestosuyla; sonrası update/delete yok. Okuma, yolun `versionId` kimliğinden Firestore süreç/görev kaydını tam yolla kontrol eder. Aktif assignee veya korunmuş geçmiş karar şartı içerikle aynıdır; gelecekteki göreve erişim yok. Süreçteki sahip/operasyon rolü A02 politikasıyla ayrıca sınırlandırılır. Storage Rules'ın Firestore belge erişim bütçesi gözetilir; süreç ve kişi-görev için iki lookup içinde kalacak düzenin emülatör kanıtı gerekir. Bu nedenle sürüm ve süreç ortak korelasyon ID'si önemlidir.

Firestore + Storage arasında ortak atomik transaction yoktur. Upload aşamalıdır: manifesto/yükleme niyeti → nesne yükleme → istemcinin yeniden okuma/hash kontrolü → `ready` bağlama → sürümün dondurulması/sürecin açılması. Kurallar nesnenin SHA-256'sını hesaplamaz ve zararlı dosya taraması yapmaz. `ready` güvenilir sunucu taraması anlamına gelmez; gerçek kurumsal tarama/kanıt sonraki fazın kabul işidir. Yarım dosyalar durum ekranında görünür; UAT temizliği yetkili manuel araçla, otomatik sunucu temizliği sonraki fazda. Sürüm değişince ek baytları da değişmez kalmalı; yeni sürüm yeni anahtar/manifesto taşır.

Yerel Storage emülatörü; yollar, MIME/boyut, sahte metadata, overwrite ve dinamik okuma kurallarının UAT aracıdır. Emülatör başarısı gerçek Spark bucket erişimi kanıtı değildir. İlgili CSP, SDK ve emülatör yapılandırmaları uygulama sırasında birlikte eklenir.

### 8.4 Spark B planları

**B1 — Metin tabanlı pilot (önerilen başlangıç):** Belge gövdesi, üstveri, sürüm, görev ve geçmiş Firestore'da tutulur. `attachments=[]`, `attachmentMode=none`; upload kapalı ve gerekçesi görünür. Sahte link/dosya veya sessiz dosya kaybı yoktur. Ek zorunlu belge türü bu modda başlatılmaz; kurum içi metin senaryoları çalıştırılabilir. Sonradan ek eklemek eski onaylı sürümü değiştirmez, yeni revizyon gerektirir.

**B2 — Sınırlı küçük UAT ekleri:** Seçimlik `ebysAttachments_chunks` adaptörü tasarıma dahil edilmiştir; genel kurumsal arşiv çözümü değildir. Başlangıç önerisi dosya başına en fazla 768 KiB ham veri, 192 KiB ham parçalar ve en fazla dört parça; base64 başına yaklaşık 256 KiB. Base64 yaklaşık üçte bir büyür; Firestore doküman üstverisi de bütçeye dahildir. Kesin limitler ürün onayı ve emülatör kanıtından sonra uygulama sabiti olur.

Parça ID'si `{attachmentId}__{index}`; manifestodaki belge/sürüm, parça sayısı ve provider sabittir. Chunk create yalnız `uploading` durumundaki yetkili yükleyiciye; overwrite yok, parça sayısı/index/uzunluk whitelist ile sınırlı. Parçaların tümü var ve sınırlar tutarlı olmadan `ready` geçişi yok. En fazla dört parçanın tam yollarla varlık kontrolü Rules bütçesine dahil edilir; büyüklük arttırılıp kontrolsüz parçalara geçilmez. Yetkisiz kişi manifest/chunk yaratıp görev erişimi kazanamaz.

Okuma aynı süreç/karar yetkisine bağlı, `attachmentId` ile dar sorgu ve sınırlı parça sayısıyla yapılır. `dataBase64` index dışı; genel `COLLECTIONS` ve sürekli dinleyiciler dışında. Birleştirmede eksik/tekrar parça ve toplam SHA-256 istemcide doğrulanır; hash tutmazsa dosya açılmaz. Rules hash/base64 içeriğinin gerçek dosyayla ilişkisini kriptografik doğrulayamaz; bu sınır açık kalır. Parça yazmaları ile üst manifestonun çoklu adımlı oluşumu tek atomik dosya upload'u diye sunulmaz.

Bu model her dosyada birden fazla read/write, base64 alanı ve yedek maliyeti doğurur; kota aşılmaz garantisi vermez. Firestore doküman sınırı 1 MiB, istek sınırı 10 MiB'dir. Dosya sayısı/günlük yükleme bütçesi belirlenmeden B2 açılmaz. Sonraki Cloud Storage geçişi hash doğrulamalı kopyalama ve olayla kayıtlı operasyonel depolama konumu ekleme işlemidir. Dondurulmuş sürüm manifestosu yeniden yazılmaz; ek kimliği, eski manifesto ve baytlar korunur. `ebysAttachments` üzerindeki konum bilgisi sürümdeki sabit kimlik/hash ile eşleşir ve yalnız kontrollü taşıma yetkisiyle güncellenir.

B1 ve B2 kullanıcı adına seçilmiş değildir. B1 metin UAT'ı ve yerel Storage emülatörü önerilen başlangıçtır; B2 ancak küçük gerçek ek testi gerekiyorsa ayrıca kabul edilir. Güvenilir otomatik e-posta, virüs taraması ve dış entegrasyonlar sunucu fazında kalır.

## 9. Dinleyiciler, index ve kota

Yeni özel EBYS dinleyicileri mevcut `registerSyncListener`/auth yaşam döngüsüne uyarlanır; oturum değişimi, kilit ve çıkışta unsubscribe ile eski içerik belleği temizlenir. Tüm sürümleri indirmek yerine sayfalı görev/sürüm listesi, isteğe bağlı içerik açma kullanılır. Görünmeyen ekran için gereksiz sürekli dinleyici açılmaz.

Önerilen bileşik index manifestosu: görevlerde `assigneeUid + state + createdAt`, geçmiş görevlerde `assigneeUid + hasDecision + updatedAt`, icrada `assigneeUid + state + updatedAt`; birim/admin kuyrukları rol kararı kesinleşince eklenir. Gerekli tarih alanları yazma şemasında zorunlu olmalı. Index seçimi sorgu başına doğrulanır; public collection-group sorgusu açılmaz. Pilot kişi/belge sayısı bilinmeden kota yeterliliği iddiası yapılmaz.

## 10. Yedek, geri yükleme ve geçiş

Yeni `EBYS_COLLECTION_REGISTRY`, yedeklenebilir varlıkları ve restore politikasını özel olarak tanımlar; eski genel senkron listesi bunun yerine kullanılmaz. Süreç/evrak/sürüm/görev/kimlik ilişkileri ve şablon revizyonları kapsamda olmalı. Kapsamlı export yetkisi teknik admin kararı A02 ile uyumlu olmalı.

Yedek manifestosu: ortam kökü, yedek şema sürümü, alınma başlangıç/bitişi, koleksiyon ve kayıt sayıları, dosya manifestosu, bütünlük özetleri, ilişkisel doğrulama sonucu ve snapshot tutarlılık yöntemi. Sekmenin görünür verisi tüm veri sayılmaz. Firestore export'u dosya baytlarını veya Auth hesaplarını içermez; bunlar ayrı kapsam olarak açık gösterilir.

Olayların geri yüklenmesi genel tam-koleksiyon overwrite ile yapılmaz. Yeni olay ekleme kuralları altında özgün kayıt kimliği/bütünlüğü korunarak kontrollü kurtarma politikası ayrı tasarlanır; kurtarma da yeni olayla kaydedilir. Tarihi silip yeniden yazan admin restore shortcut'ı yeni EBYS'ye aktarılmaz. Çok batch'li restore'un tek transaction atomikliği olduğu söylenmez; bakım kilidi, doğrulama, aşamalı kurtarma ve geri dönüş prosedürü gerekir.

Pilot öncesi koordineli geçiş: yeni sürümlü istemci/şema, deny-by-default yeni koleksiyon kuralları, izinli sorgular ve indexler; ardından kontrollü özellik açılışı. Eski istemcinin yeni EBYS kaydını overwrite etmesi kurallarda reddedilir. Eski DB/istemci sürümüne körlemesine dönülmez; geri dönüş yeni kayıtları saklayıp özellik açılışını kapatır. Üretim yayını ayrı talimata bağlıdır.

## 11. Aşama 2'ye uygulama paketi ve kabul kapıları

İlk işlevsel paket Tanımlar'dır: mevcut birim ID'sini göster/kopyala; admin birim/personel eşlemesini kalıcı ID ile yönet; kurum ve görev ilişkisi şemasını ekle. Mevcut isim listesi okuma uyumluluğu korunur; salt okunur eşleme önizlemesinde belirsizlikler raporlanır. Eşleştirme ve yeni alanlar onaylanmadan toplu veri göçü yoktur.

Hedef dosyalar: `edm-workflow.js` birim alanı, `admin.html` Tanımlar, ilgili personel modülü; yeni veri servisi/saf şema dosyaları ve bu alanlara özgü Rules. Mevcut büyük modüller bütünüyle yeniden yazılmaz. Kapsam kesinleştirilirken dosyaların ilgili uygulama bölümleri tam okunacak.

Kabul kapıları:

- Aynı adlı personel veya UID'siz hesap otomatik yetkili görev sahibi yapılmaz; eski kayıt görünümü bozulmaz.
- Birim adı değişince ID/personel ilişkisi korunur; referanslı birimi silme/pasifleştirme politikası uygulanır.
- Personel kendine rol veya birim yönetim yetkisi yazamaz; diğer ortam köküne erişemez.
- UI servisten sonuç alır; veritabanı SDK'sına doğrudan yeni UI bağımlılığı eklenmez.
- İlgili unit/Rules/emülatör ve dört ekranın etkilenen regresyonları gerekli aşamada çalıştırılır.
- A02/A03/A04/A07 tasarım önerileri kabul kaydında ayrıştırılır; A05/A06/A08/A09/A12 ilgili aşamada uzmanla kesinleşir.
- A10: metin UAT, sınırlı chunk adaptörü veya Blaze erişimli Storage modu seçilir. Hiçbiri gerçek Spark bucket erişimi garanti etmez; Tanımlar paketi bağımsız ilerler.

## 12. Teknik kaynaklar ve teslim durumu

- Firebase Storage plan gereksinimi: https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024?hl=en
- Firestore sorgu/izin ilişkisi: https://firebase.google.com/docs/firestore/security/rules-query
- `getAfter` ve erişim çağrısı sınırları: https://firebase.google.com/docs/firestore/security/rules-conditions
- Web SDK transaction desteği: https://firebase.google.com/docs/firestore/manage-data/transactions
- Firestore belge/istek limitleri: https://firebase.google.com/docs/firestore/quotas

Kaynaklar 1 Kasım 2026'da kontrol edildi. Teknik ACL/transaction düzeni bu kaynaklardan çıkarılan tasarım önerisidir; henüz kodlanıp emülatörde kanıtlanmadı.

Bu tur teslimi bu belge ile Aşama 0/ana plandaki durum kaydıdır. Bu çalışma uygulama dosyalarını değiştirmedi; test koşulmadı. Son çalışma ağacı kontrolünde `script.js`, `src/utils/stock-import.js`, `tests/unit/stock-import.test.mjs` üzerinde bu çalışmaya ait olmayan değişiklikler görüldü; bunlara dokunulmadı ve EBYS teslimine dahil edilmedi. Aşama 1 kabulü ve Aşama 2 başlangıç talimatı beklenir; commit ayrıca açık talimata bağlıdır.

## 13. Revizyon 2 kabul kaydı

- Okuyucu dizisi ve sürümde ACL mutasyonu kaldırıldı; deterministik görev/karar üzerinden dinamik Rules get tasarımı eklendi.
- Ardışık sayaç kaldırıldı; kriptografik rastgele bileşen, güvenilir kayıt zamanı ve create-only tekillik rezervasyonu tanımlandı.
- Tek admin UAT gerçeği kaydedildi; kurumsal Cloud Storage yolu/manifesto/kuralları ve metin/chunk alternatifleri eklendi.
- Tasarım mutabakatı olmadan uygulamaya geçilmez. Üretim kodu, deploy, veri ve commit bu revizyonda değişmedi. “%100 hazır” iddiası yerine somut emülatör ve geçiş kabul kapıları kullanılacak.
