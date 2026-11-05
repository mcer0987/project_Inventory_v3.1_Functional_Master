# v3.4 EBYS Aşama 6 — Bağımsız teknik ve güvenlik denetimi

## 1. Kapsam ve incelenen dosyalar

**Tarih:** 5 Kasım 2026. **Dal:** `feat/v3.4-ebys-asama-6`. **Taban:** `8350f917b653bc98c245c4415b2f7d67acb68c67`.

İncelenen çalışma ağacı: `C:/Users/med3pol/Documents/project_Inventory/scratch/ebys-asama-6`. Ana çalışma dizini hâlâ Aşama 5 dalındadır; değerlendirme ana dizindeki Rules'a değil, Aşama 6 çalışma ağacının commit edilmemiş kaynaklarına aittir.

Referanslar:

- `audits/audit-reports/2026-11-05_EBYS_Asama_6_Uygulama_Raporu.md`
- `audits/audit-reports/2026-10-30_v3.4_EBYS_Genisleme_Is_Plani.md`, Aşama 6 ve geçiş/yedek sınırları.
- `audits/audit-reports/2026-11-01_EBYS_Asama_1_Teknik_Tasarim_ve_Servis_Sozlesmeleri.md`, T05, yedek sicili ve ertelenen sunucu işleri.

Kod kapsamı: `firestore.rules`, `firestore.indexes.json`, `src/services/ebys-execution-service.js`, `src/services/ebys-process-service.js`, `src/services/ebys-document-service.js`, `src/ui/ebys-execution-ui.js`, `src/ui/ebys-process-ui.js`, `src/ui/ebys-documents-ui.js`, `src/utils/ebys-document-schema.js`, `admin.html`, `index.html`, `todo-module.js`, ilgili Rules/UI testleri ve hosting manifestosu.

Uygulama veya test kaynakları değiştirilmedi. Yeni saldırı senaryoları mevcut test yardımcılarıyla bellekte çalıştırıldı; yalnız denetim raporu, log ve hash kanıtları üretildi. Commit/deploy, canlı veri değişikliği veya UAT veri sıfırlaması yapılmadı. Uygulama raporundaki canlı birim kataloğu yazma beyanı bu denetimde yeniden doğrulanmadı.

## 2. Kesin karar

**ŞARTLI GO.** İncelenen kritik yetki ve atomiklik sözleşmelerinde P0/P1 bypass tespit edilmedi. Son onaydan icra ve kapanışa geçiş, mevcut ve ek emülatör senaryolarında veri bütünlüğünü koruyor. Koşulsuz aşama kapanışı için iki P2 giderilmeli: eşzamanlı kapanışın istemciye tutarlı sonucu döndürmesi ve mevcut evrak yedeğinin Aşama 6 kapsamının tamamlanması/açıkça sınırlandırılması.

Bu karar yerel kod ve emülatör kanıtına dayanır; canlı Rules/index dağıtımının ve gerçek kullanıcılarla UAT'ın tamamlandığı anlamına gelmez.

### Kritik güvenlik sorularının yanıtı

| Denetim noktası | Sonuç ve kod dayanağı |
|---|---|
| Kabul öncesi içerik | **Atanmış icracı okuyabilir.** `ejActive` hem `pending_acceptance` hem `in_progress` içerir (`firestore.rules:996–999`); sürümde yalnız `get` dalı açılır (`859`). Raporun "sabit sürümü açar ve işi kabul eder" akışıyla uyumludur. Genel personel/gelecek icracı erişimi değildir. |
| İade sonrası içerik | `returned` icra yetkisini kapatır. Ek testte doğrudan sürüm okuması reddedildi. Ancak kişi ayrıca evrak yazarıysa veya o sürümde gerçek onay geçmişi varsa bağımsız yazar/Aşama 5 yetkisi sürer (`857–859`). Önce onay vermiş sonra icra işini iade etmiş kişinin okuması ayrıca doğrulandı; bu, icra yetkisinin açık kaldığı anlamına gelmez. |
| Yetkisiz accept/complete/return | `ejUpdate` mevcut `assigneeUid` ile `request.auth.uid` eşitliğini, durum geçişini, revizyonu ve zorunlu olayı denetler (`1062–1079`). Mevcut testler doğrudan SDK accept/complete; ek denetim geçerli biçimli olay içeren doğrudan SDK return saldırısını reddetti. |
| Atomik kapanış | İş `ejCompleted` üzerinden aynı işlemde değişen evrak başlığı ve alıcı/sunucu zamanı eşleşen bildirimi ister (`1056–1060`). Bildirim kendi create kuralında tüm alanları ve iş geçişini doğrular (`1125–1137`). Başlık da işin kapanmasını ister (`1043–1048`). Bildirim, başlık veya olay yazması çıkarılınca işlem reddedildi ve iş `in_progress` kaldı. Başka alıcıya bildirim de reddedildi. |
| Sahte stok referansı | İstemci kontrolüyle sınırlı değildir. `ejEvidence`, aynı kökte önceden var olan `stockOperations` kaydını ve aynı işe ait `ebysExecutionStockLinks` kaydını ister (`1050–1054`). Bağ yalnız admin tarafından, mevcut stok kaydı ve aktif iş için oluşturulur; update/delete kapalıdır (`1093–1102`). Kontrol `get/exists` kullanır; yeni bağı aynı kapanış batch'ine ekleyerek önceden doğrulama şartı karşılanamaz. |
| Havale politikası | Personelin create/update yetkisi yoktur; list/delete herkese kapalıdır. **Bağlı personelin bilinen politika yoluna tekil get yetkisi vardır** (`1088–1091`). Son onay servisi kaynak birim/tür politikasını istemciden okumak zorunda olduğundan bu erişim gereklidir. UI'daki admin kontrolü, Rules'ın get yetkisiyle karıştırılmamalıdır. Ziyaretçi get ve personel update/list denemeleri reddedildi. |
| Tek icra işi | Yol `{processId}`; gövde kimlikleri bu yola ve dondurulmuş sürüme bağlanır. Create yalnız aktif süreçten completed'a geçişle mümkündür (`1024–1037`). Son onay da zorunlu iş eş yazmasını ister (`1199–1204`). Eşzamanlı aynı operasyonlu iki son onay tek iş üretti. |
| İade/yeniden havale yarışı | İade durumunda icra içerik izni kapanır; havalede atanan UID değişir. Eski icracının doğru güncel revizyonu kullanarak yaptığı SDK accept saldırısı da reddedildi; yeni icracının accept işlemi geçti. Yönetici havalesi ile icracı kapanışı aynı revizyondan yarıştığında yalnız biri commit etti. |

## 3. Bulgular

| Kimlik / öncelik | Dosya ve konum | Dar saldırı/arıza senaryosu | Etki | Güven |
|---|---|---|---|---|
| **A6-01 / P2** | `src/services/ebys-execution-service.js:64–73`, `121`; UI `src/ui/ebys-execution-ui.js:95–98` | Aynı kullanıcı aynı revizyon ve aynı kapanış verisini iki sekmeden eşzamanlı gönderir. İş bir kez kapanırken ikinci çağrı `permission-denied` dönebiliyor. | Mükerrer iş/bildirim veya yetki aşımı yok. Başarıyla tamamlanan işlem ikinci ekranda hata olarak gösteriliyor; tekrar deneme sözleşmesi eşzamanlı durumda tutarsız. | **Yüksek:** gerçek servis + emülatörde tekrarlandı. |
| **A6-02 / P2** | `src/services/ebys-document-service.js:9`, `141–149`; `src/ui/ebys-documents-ui.js:180` | Aşama 6 işi tamamlandıktan sonra mevcut “Evraklarımı yedekle” işlemi çalıştırılır. `closed` başlık dışa aktarılır; beş yeni koleksiyon çıktı anahtarlarında yoktur. | Yedek kapanışın kim/ne zaman/kanıt/bildirim ve stok bağı zincirini içermez. Bu çıktı tam Aşama 6 yedeği olarak kullanılırsa ilişkiler eksik kalır. Canlı verinin silindiği iddia edilmez. | **Yüksek:** servis dışa aktarımı ve sicil birlikte doğrulandı. |

### A6-01 ayrıntısı

İç transaction callback'indeki `completed` kontrolü sıralı tekrar çağrısını karşılıyor. Ancak `runTransaction` dışarıya hata döndürdüğünde işin gerçekten aynı komutla tamamlanıp tamamlanmadığını sunucudan doğrulayan bir sonuç kurtarma yolu yok. İki ayrı servis çağrısının `Promise.allSettled` sonucu denetimde `['completed', 'permission-denied']` oldu. İş revizyonu yalnız bir arttı ve bir bildirim oluştu.

İlk gözlemde reddedilen yarış isteğinin Rules hata dökümü ayrıca 1000 ifade sınırı mesajı içerdi. Bu, normal kapanışın her durumda bütçeyi aştığını kanıtlamaz: mevcut geçerli kapanış/altı adımlı akış testleri geçti. Kesin ifade sayısı veya kalan bütçe payı ölçülmedi. İzin hatasını körlemesine başarı saymak ya da Rules'ı gevşetmek uygun çözüm değildir.

### A6-02 ayrıntısı

Mevcut `EBYS_COLLECTION_REGISTRY` şu yeni koleksiyonları içermiyor: `ebysExecutionPolicies`, `ebysExecutionJobs`, `ebysExecutionEvents`, `ebysExecutionStockLinks`, `ebysNotifications`. Gerçek servisle kapatılmış evrakın yedeğinde `ebysDocuments[0].state === 'closed'` iken bu beş anahtarın hiçbiri yoktu.

Bu bulgu Aşama 9'un tam kurtarma uygulamasını öne çekme talebi değildir. Aşama 1'de tanımlanan özel yedek siciliyle mevcut kullanıcıya sunulan yedek çıktısının yeni veri kapsamını açıklama/koruma gereğidir. Yeni koleksiyonları listeye körlemesine eklemek de yeterli olmaz: bildirimde alıcı alanı `recipientUid`, olay ve stok bağı okumalarında admin kısıtı vardır. Koleksiyon başına yetkili sorgu ve kapsam manifestosu gerekir.

## 4. Mimari ve operasyonel gözlemler

- **Katman ayrımı:** UI, `AppModules.EBYSExecution` üzerinden çalışıyor; yeni UI'da doğrudan SDK yazması yok. Servis, transaction ve veri erişimini taşıyor. Vanilla ESM/No-Build korunuyor. Önizleme `textContent` tabanlıdır.
- **Politika modeli:** Üç sabit yön (`incoming`, `outgoing`, `internal`) ve kaynak birim kullanılıyor. Öncelik birime özel kayıtta, yoksa tür varsayılanındadır. Geçersiz özel politika varsayılana sessizce düşmez; son onayı durdurur. Bu güvenli fakat operasyonel olarak onay kuyruğunu bloke edebilen bir davranıştır; pilot öncesi tür/birim kapsamları hazırlanmalıdır.
- **Politika geçmişi:** Politika kaydı yerinde güncellenebilir, ayrı revizyon geçmişi yoktur. İş; politika anahtarı, hedef birim/kişi/UID, hedef saat ve ilk hedef zamanını sakladığından politika değişikliği mevcut işi kendiliğinden değiştirmez. Kurumsal genişlemede politika revizyonu ve değişiklik geçmişi yararlı olacaktır; mevcut dar yetki denetiminde bypass değildir.
- **Yeniden havale:** `originalDueAt` korunur, yeni `dueAt` atanır; iade zamanı olayda saklanır. Hedef süre erişim sona erme süresi değildir: gecikmiş aktif iş üzerinde çalışma devam eder. Geçmişte indirilmiş metnin uzaktan silinmesi vaat edilmez.
- **Stok:** Referans isteğe bağlıdır; yalnız stok numarası kullanılan kapanış için doğrulanmış bağ zorunludur. Her kapanışın stok işlemi üretmesi veya fiziksel teslimi kriptografik olarak kanıtlaması beklenmemelidir. Defter kaydının işle ilgili olduğunun anlamsal doğrulaması adminin gerekçeli bağlantısıdır.
- **E-posta:** `emailState: 'deferred'` kalıcı kapanış bildiriminde tutulur. Bu, çalışan SMTP/KEP/outbox gönderim motoru değildir. Spark ve Aşama 1'de ertelenen güvenilir sunucu işleri sınırına uygundur; teslim edilmiş e-posta olarak sunulmamalıdır.
- **Listeleme:** Admin filtreleri sayfadaki 50 iş üzerinde uygulanır ve ekran bunu belirtir. İadeler ayrı sorguda `returnedAt` artan sırada getirilir. Bu model, kurum genelindeki tüm gecikmeleri tek sayfada bulduğunu garanti etmez.
- **Yayın:** Dört yeni index tanımı dosyada mevcut; canlı indexlerin hazır olduğu doğrulanmadı. Emülatör testleri gerçek ortam index hazırlığının yerine geçmez.

### Test ve kanıt özeti

| Kontrol | Sonuç | Yerel kanıt |
|---|---|---|
| `npm run test:unit` | 290/290 | `scratch/asama6-audit-unit.log` |
| `npm run test:rules` | 271/271 | `scratch/asama6-audit-rules.log` |
| `npm run lint:xss` | İzinsiz ifade 0 | `scratch/asama6-audit-xss.log` |
| Mevcut Aşama 6 tarayıcı testi | Geçti; servis taklitleriyle gerçek UI modülü | `scratch/asama6-audit-ui.log` |
| Hosting manifestosu | 94 beklenen uygulama dosyası | `scratch/asama6-audit-hosting.log` |
| Ek bellek içi denetim | 7 senaryo tamamlandı | `scratch/asama6-audit-probes.log` |

Ek senaryolar: pending/politika yetkileri; doğrudan SDK yetkisiz return ve eski/yeni icracı yarışı; eşzamanlı son onay; kapanış eş yazmalarının çıkarılması/yanlış bildirim alıcısı/eşzamanlı tekrar; havale-kapanış yarışı; iade sonrası bağımsız onay yetkisi; yedek kapsamı.

Ek logdaki `PASS` ifadeleri denetimin gözlediği koşulları doğrular. Özellikle eşzamanlı kapanışta **tek commit** doğrulanmıştır; ikinci çağrının başarılı döndüğü anlamına gelmez. Yedek kapsamı senaryosunun geçmesi de eksik koleksiyonların tekrar üretildiğini belirtir.

Bağımsız kontroller yalnız `demo-asama6-independent` kimlikli yerel emülatörde çalıştı. Test hazırlığı dışında yazmalar gerçek Rules'a tabiydi. Başlangıçta iki denetim yürütücüsü hatası (VM nesne tipi ve farklı Firestore instance referansı) düzeltildi; bunlar uygulama bulgusu olarak sayılmadı. İlk emülatör başlatma uyarısına rağmen her test ortamına çalışma ağacındaki Rules dosyası açıkça yüklendi. Kaynak ve kanıt hashleri `audits/test-baselines/2026-11-05_EBYS_Asama_6_Denetim_Kanit.json` dosyasındadır.

## 5. En küçük gerekli düzeltme yönlendirmesi

1. **A6-01:** Kapanış transaction'ı hata verdiğinde sunucudaki işi tekrar oku. Yalnız aynı aktör, beklenen sonuç revizyonu, `completed` durumu ve aynı sonuç/kanıt/stok verisi doğrulanıyorsa önceki başarıyı döndür. Diğer hataları koru. İki eşzamanlı aynı çağrının tek olay/bildirim üretip iki çağrıya da tutarlı sonuç vermesini; farklı payload ve farklı aktörün başarı sayılmamasını test et.
2. **A6-02:** Mevcut dışa aktarma siciline koleksiyon başına yetkili kapsam tanımı ekle. Admin için politika/olay/stok bağı; sahip için iş ve bildirim ilişkilerini uygun sorgularla dışa aktar. Kullanıcının yetkisi dışındaki kayıtlar kapsam dışıysa bunu manifestoda ve yedek açıklamasında açıkça belirt. Sırf yedek almak için normal içerik/olay okuma izinlerini genişletme. Kapanmış örnek evrakın başlık → iş → olay → bildirim ve varsa stok bağlantısını manifestoda doğrula. Tam restore motoru ayrı fazda kalabilir.

Bu iki P2 kapatılıp ilgili dar kontroller tekrar geçtiğinde yerel teknik karar **GO** olarak güncellenebilir. Mevcut durumda sonuç **ŞARTLI GO** olarak kalır.
