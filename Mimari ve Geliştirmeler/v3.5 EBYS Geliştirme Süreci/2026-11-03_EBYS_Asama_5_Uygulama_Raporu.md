# v3.4 EBYS — Aşama 5 uygulama raporu

Tarih: 3 Kasım 2026
Dal: `feat/v3.4-ebys-asama-5`
Dayanak: onaylı genişleme planı, Aşama 1 teknik sözleşmeleri ve 3 Kasım uygulama planı.

Durum: Yerel uygulama ve otomatik doğrulama tamamlandı; kullanıcı kabulüne ve bağımsız incelemeye hazırdır. 3 Kasım kullanıcı kabulü sonrası Aşama 5 commit onayı alındı. Deploy yapılmadı. Önceki Aşama 4 kapanış commit'i `5ba70e3` dalın tabanındadır.

## 1. Tamamlanan akış

**Dondurulmuş evrak → manuel rota / sabit şablon → süreci başlat → kişisel görev → paraf / onay / olur kararı → sonraki kişi → kurum içi onay tamamlandı.**

- Süreç kimliği değişmez sürüm kimliğidir: `processId = versionId`. Mevcut immutable sürümlere sonradan alan eklenmez.
- Rota 1–6 sıralı adımlıdır. Personel kalıcı ID ve Auth UID ile seçilir; aynı isimli kişiler PRI/ID ile ayrılır. Pasif, UID'siz kişi ve evrak sahibi yeni göreve atanamaz.
- Süreç `routeSnapshot`, `templateId`, `templateRevision`, sıra, aktif UID, durum, revizyon ve son operasyon bilgisini taşır. Manuel rotada şablon kimliği boş/revizyon sıfırdır.
- `ebysRouteTemplates` kayıtları admin tarafından oluşturulur, create-only kalır. Her kayıt bağımsız kimlikli sabit bir şablon sürümüdür (`revision: 1`); düzeltme yeni kayıtla yapılır. Başlayan süreç seçilen kaydın kimliğini, revizyonunu ve birebir rota snapshot'ını saklar. Eski satın alma şablonları otomatik dönüştürülmez.
- Yalnız ilk aktif kişi için görev oluşturulur; gelecekteki adımlara peşinen görev veya içerik yetkisi verilmez.
- Her karar, süreç ilerlemesi, kapanan görev, sıradaki görev, olay ve operasyon sonucu aynı transaction içindedir. Terminal kararda evrak başlığı da aynı transaction ile güncellenir.
- Son onay başlığı `internally_approved`, süreci `completed` yapar. Bu durum icra tamamlandı anlamına gelmez.

## 2. Yeni koleksiyonlar ve servis sözleşmeleri

Kök biçimi `${ROOT}/{collection}/items/{id}` olarak korunmuştur.

| Koleksiyon | Görev |
|---|---|
| `ebysProcesses` | Sürüm başına tek süreç; değişmez rota/şablon snapshot'ı ve revizyonlu ilerleme |
| `ebysTasks` | `{processId}__{uid}` deterministik kişi-görev kaydı; aktif atama ve eklemeli `decisionsByStep` |
| `ebysProcessOperations` | Create-only operasyon sonucu ve SHA-256 payload özeti; idempotent tekrar |
| `ebysProcessEvents` | Create-only aktör, komut, gerekçe, süreç revizyonu ve sunucu zamanı |
| `ebysRouteTemplates` | Yönetici tarafından oluşturulan immutable rota şablonları |
| `purchaseAccess` | Legacy kaydı yetkili personelin kuyruğunda bulmak için içeriksiz eşleme; içerik ACL'si değildir |
| `purchaseFinance` | İlk satın alma onayında merkezi kur ayarıyla doğrulanan immutable finans snapshot'ı |

Yeni süreç API'leri: `startProcess`, `decideTask`, `withdrawProcess`, `delegateTask`, `getProcess`, `getVersion`, `subscribeMyTasks`, `subscribeMyProcesses`, `createRouteTemplate`, `listRouteTemplates`. Evrak servisinde `reopenDraft` ve monoton sürüm numarası desteği eklendi.

Aynı `operationId` ve içerik tekrarında aynı sonuç döner. Aynı anahtarla farklı içerik, bayat revizyon ve sırayı atlayan yazma reddedilir. Eşzamanlı aynı kararın yalnız tamamlanmış, aynı aktör/özet taşıyan operasyon sonucu tekrar kullanılabilir.

## 3. Yeni EBYS evrakında yetki ve yaşam döngüsü

| Aktör / durum | İçerik yetkisi |
|---|---|
| Evrak yazarı | Kendi taslakları ve sürümleri |
| Sırası gelmeyen kişi | İçerik ve gelecekteki görev yok |
| Geçerli aktif görevin atanmış kişisi | Yalnız bağlı sürüm; aktif sıra ve sunucu zamanı denetlenir |
| Gerçek onay/red kararı veren kişi | Yalnız karar verdiği sürüme sonradan erişim |
| Yalnız iade eden / geri çekmeyle görevi kapanan kişi | Önceki gerçek kararı yoksa içerik yetkisi kapanır |
| Teknik admin | Kayıt başlığı ve süreç yönetim bilgisi; başka yazarın metnine otomatik erişim yok |

`readerUids` veya istemcinin genişletebildiği içerik ACL dizisi eklenmedi. Kurallar deterministik süreç/görev yollarını okur; sahte görev ve sahte karar geçmişi yazılamaz. Her karar adım kimliği, görev türü, gerçek aktör, temsil edilen kişi, gerekçe, sürüm ve sunucu zamanını korur. Aynı kişi ardışık veya aralıklı adımlarda bulunduğunda eski karar ezilmez.

- İade, red ve geri çekme gerekçelidir; farklı terminal durumlar üretir.
- Düzeltilen evrak yeni immutable sürüm ve yeni süreç alır. Eski metin, kararlar ve kayıt numarası korunur. Önceki karar yeni sürüme yetki kazandırmaz.
- Vekâlet yalnız yönetici tarafından aktif göreve uygulanır; gerekçe ve gelecekteki bitiş tarihi zorunludur, üst sınır 90 gündür. Vekil gerçek `assigneeUid`, asıl kişi `principalUid` olarak izlenir. İç içe vekâlet zinciri sorgulanmaz.
- Atama sırasında personelin aktifliği, UID'si ve `staffAccounts` personel/PRI bağı Rules'da doğrulanır. Kararda oturumun mevcut hesap bağı ayrıca denetlenir.
- Görev hedef süresi 1–720 saattir. Gecikme ekranda görünür; bu hedef, içerik erişim süresiyle karıştırılmaz. Normal görev için 90 günlük erişim üst sınırı, vekâlet için seçilen bitiş uygulanır. Süresi dolan görevde admin yeniden atama yapabilir.
- Gerçek e-imza servisi bağlı değildir; `e_sign` isteği açıkça reddedilir. Paraf/onay/olur, kurum içi karar türleridir.

## 4. Arayüz ve satın alma uyumu

- Evrak kayıt defteri mevcut Aşama 4 konumunda kalır. Dondurulmuş evrakta **Onay rotası / Süreç**; tabloda **Süreç durumu** düğmeleri bulunur.
- Manuel rota veya hazır sabit şablon seçilebilir. Seçilen şablonun satırları salt okunurdur; admin manuel rotayı yeni şablon olarak kaydedebilir.
- **Bana Gelen Onaylar** altında evrak aktif işleri, sürüme bağlı karar geçmişi ve yazarın geri dönen işleri gösterilir. Mevcut satın alma onay alanı korunmuştur.
- Her kişisel kuyruk ve evrak listesi en fazla 50 kayıt alır; sonraki sayfa gerçek Firestore cursor ile açılır. Kayıt defterinin personel sorgusuna yön ve cursor da eklendi.
- Metinler `textContent` ile oluşturulur. Mobil modal, Escape/backdrop kapanışı, çıkışta dinleyici ve içerik temizliği test edildi.
- Eski `purchaseOrders.workflow` yeni motora taşınmadı. Satın alma ve depo motorları değiştirilmedi; eski onay motoru kendi kayıtlarını yönetmeye devam eder.
- Personelin genel satın alma koleksiyon dinleyicisi kaldırıldı. Sahip sorgusu ile UID'ye ait `purchaseAccess` eşlemelerinden gelen tekil kaynak dinleyicileri birleştirilir. Rules, her kaynak okumasında gerçek sahip/aktif adım/geçmiş onay-red ilişkisini yeniden denetler.
- Kaynak izni kapanınca kayıt personelin belleğinden çıkar. Eski eşleme tek başına okuma yetkisi sağlamaz; tekrar atamada eşleme zamanı yenilenerek kapanmış dinleyici yeniden kurulabilir.
- Admin kayıt defterindeki **Eski satın alma erişim eşlemeleri** düğmesi önce salt okunur önizleme verir, onayla yalnız doğrulanmış mevcut/geçmiş UID'ler için kuyruk eşlemesi hazırlar. Kaynak satın alma akışı ve kararları değiştirilmez.

## 5. Aşama 4 P2 ve kur snapshot borcunun kapanışı

**A4-01 P2:** Başka yazarın dolu numara rezervasyonunu okuma reddi yalnız aday rezervasyon okumasından geliyorsa, servis kendi evrakını sunucudan tekrar okuyup sahiplik/revizyonu doğrular ve yeni kriptografik aday üretir. En fazla beş aday denenir. Genel izin hataları körlemesine tekrarlanmaz; diğer yazarın rezervasyonu açılmaz/ezilmez. Gerçek servis ve Rules testinde ilk aday başka yazara çarptırıldı; ikinci adayla işlem tamamlandı.

**Merkezi kur doğrulaması:** İlk onayın kur, tarih ve kaynak alanları merkezi `system_config/items/ebys_rates` ile Rules'da birebir eşleştirilir. TRY-only talepte tüm kalemlerin TRY ve kurun 1 olduğu ayrı dal vardır. İlk finans snapshot'ı `purchaseFinance` içine satın alma kararıyla aynı batch'te yazılır; iki belge karşılıklı eşleşir ve finans kaydı değiştirilemez. Bu ayrım ağır legacy onay kuralında ek iç içe doğrulama yükünü azaltır. Eksik merkezi ayar, sahte kur/kaynak, eş yazmasız onay ve sonraki snapshot değişikliği testlerde reddedildi. Önceden snapshot'ı bulunan taleplerin geçmiş kuru yeniden hesaplanmaz.

## 6. Kuralların bütçesi

Güvenlik kontrolü yalnız ekranda bırakılmadı. Altı gelecekteki adımın tüm alanlarını her başlangıç isteğinde tekrar açmak yerine, değişmez rotanın uzunluğu başlangıçta; adım kimliği, türü, süresi, kişi/hesap bağı ve sürüm ilişkisi her **gerçek görev aktivasyonunda** doğrulanır. Servis rota seçiminde bütün kişileri ayrıca kontrol eder. Yetki doğmadan önce aktif adımın denetimden geçmesi zorunludur.

Bütçe kabul testleri: personel yazar + altı farklı imzacı; manuel ve şablonlu başlangıç; tüm sıralı kararlar; aynı kişiye ardışık görev; tekrar gelen kişide korunmuş kararlar; süreli vekâlet; terminal başlık eş yazması. Geçerli işlemler emülatördeki 1000 ifade ve belge erişim sınırlarından muaf tutulmadan geçmektedir. Kesin sayısal ifade sayacı ölçüldüğü iddia edilmez; kanıt gerçek sınırların etkin olduğu kabul testleridir.

## 7. Test kanıtları

| Kontrol | Sonuç |
|---|---|
| `npm run test:unit` | **289 / 289**, başarısız 0 |
| `npm run test:rules` | **258 / 258**, başarısız 0 |
| `npm run lint:xss` | 69 dosya, 204 sink, 947 dinamik ifade; **izinsiz 0** |
| `node scratch/ebys-stage4-ui.cjs` | Aşama 4 form/KPI/modal/çıktı regresyonu geçti; `pageerror=0` |
| `node scratch/ebys-stage5-ui.cjs` | UID ayırımı, pasif filtre, şablon/rota, karar, düz metin, çoklu geçmiş, cursor, mobil ve çıkış temizliği geçti; `pageerror=0` |
| `node scratch/admin-layout-regression.cjs` | 9 sekme doğru ana içerikte, 6 sekme geçişi ve Evrak Kayıt Defteri geçti; `pageerror=0` |
| `node scratch/hosting-files.js` | **90 / 90** uygulama dosyası; beklenmeyen yayın dosyası yok |
| `git diff --check` | Geçti |

Sayılar mevcut çalışma ağacının tamamına aittir. Yeni süreç Rules dosyası 14, legacy erişim dosyası 4 test içerir; ayrıca farklı yazar numara çakışması testi eklenmiştir. Testlerin güvenilir kimlikleri emülatör fixture'larıdır; canlı kullanıcı kabulü yapıldığı iddia edilmez.

Yerel günlükler: `scratch/ebys-stage5-unit.log`, `scratch/ebys-stage5-rules.log`, `scratch/ebys-stage5-xss.log`, `scratch/ebys-stage5-hosting.log`. Mobil kanıt: `scratch/ebys-stage5-mobile.png`. Bu dosyalar Hosting paketine girmez.

Negatif senaryolar: gelecek imzacının doğrudan sürüm okuması, geniş görev/satın alma sorgusu, sahte geçmiş, tek başına görev/olay yazması, sıra atlama, başlık eş yazmasız terminal karar, bayat revizyon, aynı anahtarla farklı karar, pasif/bağsız kişi, süresi dolmuş vekil ve başka kök erişimi. Yeni sürüme geçmiş yetki taşınmadığı ve tekrar açma komutunun aynı operasyonla tekrarı da doğrulanmıştır.

## 8. Değişen ve eklenen dosyalar

**Yeni üretim dosyaları**

- `src/utils/ebys-process-schema.js`
- `src/services/ebys-process-service.js`
- `src/services/purchase-access.js`
- `src/ui/ebys-process-ui.js`

**Güncellenen üretim/yayın dosyaları**

- `firestore.rules` — süreç/görev/karar/şablon kuralları, sürüm erişimi, legacy okuma ve finans snapshot doğrulaması.
- `firestore.indexes.json` — assignee/zaman, owner/zaman ve owner/yön/zaman indeksleri.
- `src/services/ebys-document-service.js` — güvenli numara tekrar adayı, yeni sürüm, yön/cursor, yedek sicili.
- `src/services/firebase-handler.js` — dar legacy senkron, kuyruk eşlemeleri, ilk finans eş yazması ve admin geçiş önizlemesi.
- `src/ui/ebys-documents-ui.js` — süreç düğmeleri, yeni sürüm etiketi, admin erişim eşleme işlemi ve personel ekranında editör kullanımı.
- `index.html` — kişisel evrak kuyrukları, ortak evrak modülü ve stil bağlantısı.
- `scratch/hosting-files.js` — 90 dosyalık beklenen yayın manifestosu.

**Yeni/güncellenen testler**

- Yeni: `tests/rules/ebys-processes.test.mjs`, `tests/rules/purchase-access.test.mjs`, `tests/unit/ebys-process-schema.test.mjs`, `scratch/ebys-stage5-ui.cjs`.
- Güncel: `tests/rules/ebys-documents.test.mjs`, `tests/rules/rules.test.mjs`, `tests/unit/savedata-legacy-guard.test.mjs` içindeki yeni bağımlılık fixture'ı.

Çalışma ağacında bu aşamadan önce bulunan envanter içe aktarma, stok, manuel çıkış ve diğer değişiklikler korunmuştur. `index.html`, `firebase-handler.js` ve bazı test dosyaları ortak değişiklikler taşır; sonraki commit aşamasında dosya bazlı toplu ekleme yerine EBYS hunk'ları ayrıca incelenmelidir. Bu rapor çalışma ağacının tüm diff'ini Aşama 5 işi olarak sahiplenmez.

## 9. Yerel kabul ve geçiş sırası

1. Aynı kökte Auth ve Firestore emülatörlerini, admin ve en az üç bağlı aktif personeli hazırlayın. Canlı ve demo kimliklerini karıştırmayın.
2. Admin olarak **Talepler ve Süreçler → Eski satın alma erişim eşlemeleri** önizlemesini inceleyin. Aktif/geçmiş adımlardaki UID eksiklerini kimlik doğrulamasıyla çözün; isimden otomatik yetki verilmez. Salt okunur ayrıntı `previewLegacyPurchaseAccess()` sonucundadır. Belirsiz eski kayıtların personel kuyruğuna hazır olduğu kabul edilmez; admin kaydı yönetmeye devam edebilir.
3. Mevcut dondurulmuş evrakı açın; `A → B → A` rotasını başlatın. İsterseniz önce rotayı şablon olarak kaydedip sabit şablondan başlatın.
4. A hesabıyla aktif işi açıp onaylayın. B sırası gelmeden doğrudan SDK ile de içerik okuyamamalı; sırası gelince görevi görünmelidir. A ikinci kez geldiğinde iki ayrı karar korunmalıdır.
5. Ayrı evraklarda gerekçeli iade, red ve yazarın geri çekmesini deneyin. Yeni sürüm hazırlayın; eski karar/metin değişmeden yeni süreç oluşmalıdır. Eski imzacı yeni sürümü otomatik okuyamamalıdır.
6. Admin olarak aktif görevi süreli vekile devredin; asıl kişi ve gerçek karar aktörünü kontrol edin. Yetki süresi bitince karar/okuma reddini sınayın.
7. İki sekmede aynı işi onaylayın; ikinci kez sıra ilerlememeli. Eski satın alma oluşturma/başlatma/onay/çıktı ve depo işlemlerini tekrar kontrol edin.
8. Bağımsız inceleme ve kullanıcı kabulünden sonra commit/yayın için ayrı talimat verin. Yayın paketi istemci + Rules + indeksleri birlikte ele almalıdır; önce geniş izinli eski istemciyle dar yeni Rules'un karıştırılmaması gerekir. Üretimde indekslerin hazır olması ve legacy UID/eşlemelerinin doğrulanması geçiş ön koşuludur.

## 10. Aşama 6 sınırı ve pilot kapsamı

Son onaydan sonra ilgili birime icra işi atama, işi kabul etme/gerçekleştirme/kapama, güvenilir e-posta/outbox ve icra kanıtları **Aşama 6** kapsamındadır. Bu aşama otomatik stok üretmez. KEP, e-Devlet, gerçek e-imza ve ek/Storage altyapısı ayrı entegrasyon fazlarında kalır.

Vanilla JS/ESM, Firebase Web SDK ve Spark korunmuştur; Cloud Functions veya build aracı eklenmemiştir. Personel sorguları ve export aynı Rules politikasına bağlıdır. Evrak yedeği yazarın yetkili kayıtlarını ve süreç/karar/sabit şablon sicilini kapsar; genel stok geri yükleyicisi immutable evrak/geçmiş kayıtlarını yeniden yazamaz. Erişim iptali daha önce indirilmiş bir dosyanın uzaktan silindiği anlamına gelmez.

## 11. Manuel kabul sırasında süreç durumu okuma incelemesi

3 Kasım takip kontrolü: Kullanıcının bildirdiği izin hatası emülatör ortamında incelendi. 8080 portundaki `medipol-inventory-v3` emülatörünün yüklü Rules içeriği yerel dosyayla normalize edilmiş metin ve SHA-256 düzeyinde aynıdır. Test edilen `in_review` evrakın süreç kaydı henüz oluşturulmamıştır. Mevcut test admin hesabıyla gerçek emülatöre SDK üzerinden yapılan `getDocFromServer` çağrısı izin hatası olmadan `exists() === false` döndürmüştür. Yerel 5500 sunucusundaki ilgili modüller de çalışma ağacındaki dosyalarla aynıdır. Kullanıcının tarayıcısındaki hatanın kök nedeni bu kontrollerle henüz doğrulanmamıştır; eski Rules olduğu varsayımı doğrulanmış bir bulgu değildir.

`getProcess()` artık oturum değişimini denetler; okuma reddini boş süreç gibi yorumlamaz. İzin hatasında konsola `[EBYS] Süreç durumu okuma reddi` ile ortam, kök, koleksiyon, sürüm ve hata kodu yazılır; arayüzde anlaşılır bağlam gösterilir. Yetkiler genişletilmedi ve test verileri sıfırlanmadı.

Ek kabul testleri: başlatılmamış süreçte admin ve personel yazara `null` dönüşü; gelecek imzacının reddinin korunması. Hedefli süreç Rules paketi **16/16**, XSS kontrolü **0 izinsiz ifade**, Aşama 5 arayüz kontrolü **pageerror=0**. Günlük: `scratch/ebys-process-status-check.log`. Tarayıcıda sert yenileme sonrası tekrar ve sürerse yeni tanı satırıyla devam edilmesi beklenmektedir.

## 12. Süreç penceresi kullanıcı deneyimi düzenlemesi

Manuel kabul geri bildirimiyle aktif süreç görünümü yeniden düzenlendi: uzun teknik sürüm kimliği yerine durum, mevcut adım, beklenen görevli ve okunabilir rota kartları gösterilir. Tekrarlayan adım numaraları kaldırıldı; aktif adım ve sonraki adımlar ayrıştırıldı. Vekâlet ve geri çekme başlangıçta kapalı, açıklamalı ayrı alanlara taşındı. Karar, devir ve geri çekme gerekçeleri birbirinden ayrıldı.

Vekâlet alanında mevcut görevli ve belge sahibi seçenekleri elenir; kişi, bitiş zamanı ve gerekçe etiketlidir. Bu işlemin yalnız aktif görevi devrettiği, yeni rota adımı oluşturmadığı ve süre sonunda otomatik asıl kişiye dönüş sağlamadığı ekranda açıklanır. Pencerenin altına **“Bu pencereyi kapatmak süreci iptal etmez.”** bilgisi eklendi. Geri çekme ayrı gerekçe ve açık işlem düğmesiyle yapılır.

Kontroller: Aşama 5 tarayıcı senaryosu devir alanının başlangıçta kapalı olması, mevcut kişinin elenmesi, doğru devir payload'ı ve **Kapat'ın withdraw çağırmaması** kontrolleriyle genişletildi; `pageerror=0`. Aşama 4 ve tam admin yerleşimi regresyonları geçti. Birim testleri 289/289; XSS izinsiz ifade 0. UI değişikliği süreç/Rules yetki sözleşmelerini değiştirmez. Görsel kanıt: `scratch/ebys-stage5-process-ux.png`.

## 13. Manuel kabul — sürüm kartları, iade sonucu ve ekran hiyerarşisi

Kullanıcının yeni panel açıklaması tercihi `AGENTS.md` içine kalıcı proje ilkesi olarak eklendi: her yeni panelde kısa amaç açıklaması; uzun kullanım bilgisinde erişilebilir yardım alanı/penceresi.

- Evrak kayıt defterindeki işlem düğmeleri esnek, aralıklı bir kapsayıcıya alındı. İki düğmenin taşmadan yatay veya alt alta en az 8px aralıkla yerleşmesi tarayıcı testinde denetlendi.
- Bana Gelen Onaylar'ın ana başlığı içerikten önceye alındı. Evrak görevleri ve satın alma onayları mevcut `modern-approval-header-slim` düzeniyle ayrı başlık/açıklama aldı. Geri dönen işler için de amaç açıklaması eklendi.
- Görev kartları artık yalnız görevin `versionId` yolundan alınan konu ve gerçek sürüm numarasını gösterir. İçerik açma başlığı da sürüm numarasını içerir. Geçmiş düğmesi **Karar verdiğim sürümü aç**, aktif düğme **Görevdeki sürümü aç** olarak ayrıldı. Güncel evrak başlığına veya yeni sürüme otomatik yönlendirme yapılmaz.
- Süreç durumu kişisel kartta canlı izlenir; iade edilmiş bir evrakın geçmiş kararı korunurken iade durumu ayrıca görünür. Ek dinleyiciler sayfa değişimi, yeniden çizim ve çıkışta kapatılır.
- İade işlemi başarılı olduktan sonra onaycı adına süreç tekrar okunmaz. Pencere başarı mesajıyla kapanır. Önceki kod, doğru biçimde iptal edilen okuma yetkisini takip eden otomatik yeniden açma nedeniyle işlemi hatalıymış gibi gösteriyordu.
- İçerik yetkisi gerçekten kapandıysa teknik Rules değerlendirme dökümü kullanıcıya verilmez; görev/erişim durumunu anlatan mesaj gösterilir. İzin reddi boş evrak veya başarılı okuma sayılmaz. Rules yetkileri genişletilmedi.

**Veri incelemesi:** İnceleme anında ekrandaki aktif kart `4fa2a095…` evrakının 1. sürümüne; geçmiş kartı `bf6c9057…` evrakının 1. sürümüne bağlıydı. İade edilen ikinci evrakın 2. sürümü oluşturulmuş, henüz süreci başlatılmamıştı. Bu nedenle iki kartın görünmesi yeni sürüme geçmiş yetkisi taşındığına kanıt değildir. Mevcut emülatör verisinde parafçının eski sürüm okuması ve diğer evraktaki aktif okuması yetkili; yalnız iade eden onaycının eski sürüm okuması yetkisiz olarak doğrulandı. Test verisi değiştirilmedi/sıfırlanmadı.

**Ek kabul testi:** A paraf verir → B iade eder → A yalnız v1'i okur, B'nin içerik yetkisi kapanır → yazar v2'yi oluşturur → A v2'yi okuyamaz → v2 sürecinde sırası gelince A v2'yi de okur; v1 içeriği aynı kalır. Canlı kart bağlamının v1'in konu/numarasını döndürdüğü de doğrulandı. Tarayıcı testinde iade sonrasında yeniden `getProcess` çağrılmadığı ve geçmiş düğmesinin tam eski sürüm ID'sini okuduğu sınandı.

Sonuçlar: **289/289 birim testi**, **261/261 Rules testi**, XSS **0 izinsiz ifade**; Aşama 4/5 arayüzleri ve admin yerleşimi `pageerror=0`, Hosting manifestosu **90/90**. Günlükler: `scratch/ebys-uat-followup-{unit,rules,xss}.log`. Bu takip düzenlemesinde değişen dosyalar: `AGENTS.md`, `index.html`, `src/ui/ebys-documents-ui.js`, `src/ui/ebys-documents.css`, `src/ui/ebys-process-ui.js`, `src/services/ebys-process-service.js`, `tests/rules/ebys-processes.test.mjs`, `scratch/ebys-stage4-ui.cjs`, `scratch/ebys-stage5-ui.cjs` ve bu rapor.

## 14. Commit kapsamının bağımsız dosya kopyasında doğrulanması

Kullanıcının Aşama 5 commit onayı doğrultusunda yalnız EBYS hunks ve dosyaları seçildi. Ortak dosyalardaki manuel çıkış, envanter ve içe aktarma değişiklikleri indexe alınmadı. Seçili indexin ayrı dosya kopyasında birim testleri **276/276**, Rules testleri **257/257**, XSS **0 izinsiz ifade** ile geçti. Bu sayılar, tüm çalışma ağacındaki 289/261 sonuçlarından farklıdır; diğer işlerin commit edilmemesinden kaynaklanır. Commit kapsamının Hosting manifestosu **88/88**, mevcut çalışma ağacının manifestosu ek manuel çıkış dosyaları nedeniyle **90/90** olarak doğrulandı. Günlükler `scratch/ebys-stage5-index-{unit,rules,xss}.log` dosyalarındadır.

Son başlık hiyerarşisi hotfixi bu kabul commitinden sonra ayrı çalışma ağacı değişikliği olarak uygulanacaktır.

## 15. Aşama 5 commit'i sonrası başlık hiyerarşisi hotfixi

Aşama 5 kabul paketi `8a61a7a` (`feat(ebys): aşama 5 kişisel görev ve sürüm erişimini tamamla`) commit'iyle kaydedildi. Commit'e ilgisiz envanter/import/manuel çıkış değişiklikleri eklenmedi.

Kullanıcının son UX geri bildirimi üzerine, bu commit'ten **sonra** yalnız görünüm hotfixi uygulandı: Bana Gelen Onaylar tek ana kart başlığıdır. Evrak görevleri ve satın alma onayları sade başlık/alt açıklama/çizgi ile ayrılan iki bölüm haline getirildi. Geri dönen evraklar, evrak bölümünde daha küçük bir alt alan olarak düzenlendi. Bölümler arasında belirgin boşluk bırakıldı; tekrarlayan büyük ikonlu başlık kartları kaldırıldı.

Hotfix kapsamında `index.html`, `src/ui/ebys-documents.css` ve ilgili tarayıcı testi güncellendi. Tek ana başlık, iki kategori bölümü, bölüm sırası, aradaki boşluk ve mobilde taşmama doğrulandı. Aşama 4/5 arayüzleri, tam admin yerleşimi ve XSS kontrolü geçti (`pageerror=0`, izinsiz ifade 0). Görsel kanıt: `scratch/ebys-approvals-hierarchy.png`. Akış/Rules servisleri bu hotfixte değiştirilmedi.


## 16. Denetim kapanışı

- İlk satın alma onayı, finans anlık görüntüsünü aynı Firestore yazım grubunda ve talebin belge yolundaki kimlikle kaydeder.
- Geri çekilen satın alma taleplerinde karar veren personelin erişimi sabit geçmiş kaydıyla korunur.
- Görev kuyruğu sorgusu hata verdiğinde arayüz kartlarının alt dinleyicileri kapatılır.
- Canlı ortam yönetici rolü, Firebase Auth yetki iddiasına, aktif personel bağına ve personel erişim kilidine bağlıdır.
