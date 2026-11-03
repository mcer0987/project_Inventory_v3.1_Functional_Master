# v3.4 EBYS — Aşama 5 planı ve Aşama 4'ün devamı

Tarih: 3 Kasım 2026. Durum: proje sahibinin başlangıç promptunu bekleyen uygulama planı. Bu rapor geliştirmeyi veya yayını başlatmaz.

Başlangıç onayı sonrası güncelleme: Aşama 5 uygulandı. Güncel sonuçlar ve kabul adımları [Aşama 5 uygulama raporundadır](2026-11-03_EBYS_Asama_5_Uygulama_Raporu.md). Aşağıdaki plan başlangıç kapsamının kaydı olarak korunmuştur.

Dayanaklar: onaylı genişleme planının Aşama 5 bölümü, Aşama 1 teknik tasarımının süreç/görev/erişim sözleşmeleri, Aşama 4 uygulama ve 2 Kasım bağımsız denetim raporları. Aşama 4 çekirdek ve UI/UX kodu `990a924` commit'inde bulunmaktadır.

## 1. Aşama 4'ten devralınan durum

- Gelen/giden/iç evrak kayıt defteri, üst yazı, revizyon kontrollü taslak, immutable sürüm, kriptografik numara rezervasyonu ve çıktı çalışıyor. Proje sahibi manuel UAT'ı tamamladı; bağımsız denetim teknik geçiş için GO verdi.
- Dondurulan sürümde `id = versionId = processId`. Bu bağlantı korunacak; mevcut immutable sürüme sonradan süreç ID'si yazılmayacak.
- Mevcut `in_review` durumu kişiye atanmış görev olduğu anlamına gelmiyor. Süreç kaydı bulunmayan sürüm arayüzde “Onay rotası bekliyor / incelemeye hazır” olarak ayrıştırılacak.
- Şu anda taslak/sürüm metnini yalnız yazar okuyor. Adminin başlıkları listeleyebilmesi başka yazarın metnini görme yetkisi vermiyor.
- Dosya ekleri metin pilotunda kapalı (`attachments=[]`). SHA-256 resmî imza kanıtı değildir.
- Hosting için önceki 86/81 dosya farkı incelendi: repodaki bağlantılı Gelişim Günlüğü ve manuel çıkış modülü manifestoya açıkça alındı. Kontrol 86/86 geçti ve kullanıcı onayıyla Hosting yayını tamamlandı; ana dosyaların canlı/yerel SHA-256 eşitliği doğrulandı. Bu kayıt, tarihsel denetim raporundaki yayın engelinin güncel durumudur.
- A4-01 P2 açıktır: farklı yazarın numara rezervasyonuna rastlayan komutun güvenli yeniden denemesi eksik. İçerik sızıntısı veya overwrite görülmedi. Aşama 5 başlangıç kapanış işidir.

## 2. Aşama 5'in madde madde kapsamı

1. **Dondurulmuş sürümü gerçek sürece bağlamak:** `ebysProcesses` ve `ebysTasks` koleksiyonlarını özel servislerle kurmak. `startProcess()` rota/şablon sürümünü sabitler; yalnız sıradaki kişiye görev oluşturur.
2. **Kalıcı personel kimliğiyle rota:** Atamalar UID/personel ID üzerinden yapılır; aynı isimli kişilere otomatik ad eşlemesi yapılmaz. Pasif veya hesabı bağlanmamış kişi yeni adım alamaz. İlk pilot sıralıdır.
3. **Bana Gelen Onaylar:** Kullanıcıya atanmış aktif görevler, geri dönen işler ve karar geçmişi için ayrı görünümler. İçeriği görmeden yalnız kullanıcıyla yetkili ilişki taşıyan görev sorguları çalışır.
4. **Karar türleri:** Paraf, kurum içi onay ve olur veri düzeyinde ayrı görev türleridir. E-imza için görev türü/adapter sınırı hazırlanır; gerçek e-imza servisi olmadan belge “elektronik imzalı” gösterilmez.
5. **Atomik karar motoru:** `decideTask()` görev, sıra, sürüm, aktör, revizyon ve durumu doğrular. Karar + süreç ilerlemesi + sonraki görev + olay + operation sonucu tek transaction içinde yazılır. Tekrar/çift tıklama ikinci geçiş üretmez.
6. **Gerçek içerik yetkisi:** Sırası gelmemiş imzacı doğrudan SDK ile de metne erişemez. Sürümde `readerUids` tutulmaz. Kurallar deterministik süreç/görev yollarını ve korunmuş kararı okur.
7. **Geçmiş sürüm erişimi:** Onay/red kararı veren kişi sonradan yalnız karar verdiği sürümü görebilir. İade/iptal gibi karar sayılmayan görev kapanışları tek başına geçmiş içerik erişimi kazandırmaz.
8. **İade, red, geri çekme ve yeniden sunum:** Gerekçe zorunluluğu; aktif görevin kapatılması ve yazarın iş kuyruğuna dönüş. Düzeltilen metin yeni sürüm/süreç üretir; eski içerik ve kararlar değişmez. Aynı kişi bir süreçte tekrar gelirse adımlar ayrı karar olarak korunur.
9. **Vekâlet ve süre:** Yönetici tarafından sınırlandırılmış, tarih aralığı belirli vekâlet; kullanıcı kendisine yetki veremez. Yetki işlem anında sunucu zamanına göre denetlenir. Görev süresi/gecikme görünür; tarayıcı kapalıyken çalışan zamanlayıcı varsayılmaz.
10. **Legacy satın alma geçişi:** Mevcut `purchaseOrders.workflow` akışı korunur. Eski ve yeni motor aynı kaydın kararını birlikte yönetmez. Genel satın alma dinleyicisi ve geniş üye okuması, yeni sorgularla birlikte daraltılır; legacy etiketi içerik gizliliğine istisna sayılmaz.
11. **Tüm erişim yüzeyleri:** Detay, arama, çıktı, Excel, KPI ve yedek aynı yetki politikasına bağlanır. Yalnız buton gizlemek yeterli kabul edilmez. Teknik adminin içerik yetkisi otomatik genişletilmez.
12. **İndeks, yedek ve yayın uyumu:** Görev indeksleri ve koleksiyon sicili güncellenir; sorgular izin koşullarıyla birlikte test edilir. İstemci, Rules ve indeksler aynı geçiş paketinde ele alınır.

## 3. Uygulama sırası

| Paket | Yapılacak iş | Somut kabul |
|---|---|---|
| 5.1 — Devralma ve geçiş tasarımı | A4-01 P2'yi kapat; mevcut kayıtlar/UID bağları ve legacy okuyucuları için salt okunur önizleme çıkar; sorgu/yetki matrisini kesinleştir | Farklı yazar çakışması güvenli denenir; belirsiz legacy kimlikler listelenir, otomatik yetki üretilmez |
| 5.2 — Süreç ve görev servisi | Şemalar, rota snapshot'ı, `startProcess`, operasyon ve olay sözleşmeleri | Var olan sürüm ID'siyle tek süreç; yalnız ilk görev; başka sürüm/rota bağlama reddi |
| 5.3 — Karar ve yaşam döngüsü | `decideTask`, `withdrawProcess`, red/iade/yeniden sunum, süre/vekâlet | Aynı karar tekrarında tek sonuç; eski karar ve sürüm korunur; eşzamanlı karar tutarlı kalır |
| 5.4 — Sorgu ve Rules birlikte | Görevden sürüm okuma, gerçek geçmiş karar, legacy okuma daraltması; eski genel okuma yollarının kaldırılması | Gelecekteki kişi, sahte görev, sahte geçmiş, geniş sorgu ve diğer ortam erişimi reddedilir |
| 5.5 — Ekran entegrasyonu | Evrak kayıt defterinde rota/süreç paneli; Bana Gelen Onaylar kuyrukları; admin ilerleme görünümü | Sıradaki kişi doğru sürümde işlem yapar; yazar geri dönen evrakı bulur; liste/çıktı aynı yetkiye uyar |
| 5.6 — Regresyon ve bağımsız inceleme | Birim, Rules, gerçek Auth/Firestore UAT ve tam admin yerleşimi; indeks/yayın manifestosu | Satın alma/depo akışları yeşil, negatif yetki matrisi kanıtlı, ifade ve belge erişim bütçeleri aşılmıyor |
| 5.7 — Kullanıcı kabulü | Senaryo listesi, uygulama raporu ve değişiklik paketi | Manuel kabul sonrasında commit/yayın için proje sahibinin talimatı |

Paketler küçük teslimler halinde ilerler; içerik yetkisinin henüz tamamlanmadığı ara sürüm canlıya alınmaz. Yeni aşama dalında geliştirme onay promptundan sonra başlar. Eski açık talepleri yeni motora otomatik taşıma veya geçmiş belgeyi yeniden yazma işlemi başlangıç yetkisine dahil varsayılmaz.

## 4. Aşama 4 ekranının devamı

Yeni evrak → Taslağı kaydet → İçeriği dondur → Onay rotasını seç ve süreci başlat → Bana Gelen Onaylar'da aktif görev → Karar ve sonraki adım → Kurum içi onay tamamlandı.

“Dondur” içerik sabitler; “Süreci başlat” kişiye görev açar. Mevcut dondurulmuş evraklar bu ikinci adımdan devam edebilir. Kayıt numarası verme ve içerik sürümü birbirinden bağımsız kalır; numara rezervasyonu ve immutable sürüm değiştirilmez.

Kayıt defterine süreç durumu, sıradaki görev türü, yetkili kullanıcı için işlem düğmesi ve sürüm/karar geçmişi eklenir. İçerik yalnız erişim denetimini geçen kullanıcıya açılır. Admin süreç yönetim görünümü içerik okuma izniyle karıştırılmaz. Personel dalındaki `listDocuments()` yön/cursor eksikliği giderilmeden mevcut servis kişisel evrak sekmelerine doğrudan bağlanmaz.

## 5. Teknik kapılar ve açık konular

- Vanilla JS/ESM ve Firebase Web SDK korunur; Cloud Functions/build sistemi eklenmez. Transaction ve Rules eş yazmalarıyla bütünlük sağlanır.
- Her komut için 1000 ifade ve Firestore belge erişim bütçeleri ayrı ölçülür. Güvenlik kontrolü azaltılarak bütçe kazanılmaz; gerekirse yazma modeli sadeleştirilir.
- Önceki satın alma kur snapshot'ının yönetici ayarıyla birebir Rules eşleşmesi açığı bu sadeleştirme çalışmasına taşınır. Kapanış için negatif test ve kanıt gerekir; yalnız istemcinin güncel ayarı okuması sunucu doğrulaması sayılmaz.
- Aynı kişi bir rotada birden fazla adımda bulunabilir: `{processId}__{uid}` görev belgesi adım bazlı kararları korur; ikinci adım ilk kararı ezmez. Bu kişi-görev kaydı, UI'da her adımın ayrı iş olarak gösterilmesine engel değildir.
- Legacy kimliği eksik/belirsiz kayıtta genel üye okumasını açık bırakan geçici çözüm uygulanmaz. Veri eşleme ve yetkili geçiş planı uygulanabilir hale gelmeden ilgili geçiş tamamlandı denmez.
- Vekâlet gerçek imza sahibinin yerine sahte karar yazmaz: işlem yapan UID ve temsil edilen kişi ayrı izlenir. Kesin kapsam, başlangıç promptundaki ek tercihlerle tamamlanır; varsayılan en dar yetkidir.
- Sahip/kayıt görevlisi/teknik adminin içerik yetkisi matrisi ilk pakette açıkça kaydedilir. Başlangıç varsayımı Aşama 4'ün yazar + doğrulanmış görev/karar erişimidir.

## 6. Aşama 5 kabul senaryoları

- Üç kişilik rotada ikinci/üçüncü kişi hem ekrandan hem SDK üzerinden sırası gelmeden içeriği okuyamaz.
- Birinci karar sonrası yalnız ikinci kişinin aktif işi oluşur. Sürecin son durumunu atlayan veya gelecekteki kişiye görev oluşturan eş yazma reddedilir.
- Aynı kişi iki ayrı adımda işlem yapar; her iki karar ve sürüm bağı korunur.
- Çift tıklama, iki sekme, bayat revizyon, bağlantı kopması ve aynı operationId ile farklı karar güvenli sonuç verir.
- Geri çekme/iade/red farklı durumlar üretir; karar vermemiş aktif kişinin erişimi kapatılır, gerçek geçmiş karar sürümü korunur.
- Yeni sürüme sunum eski sürümü değiştirmez; önceki imzacı yeni sürüme otomatik erişemez.
- Pasif/bağsız personel, süresi dolmuş vekâlet, kendisine görev uydurma ve başka ortam erişimi reddedilir.
- Legacy satın alma oluşturma, düzenleme, başlatma, onay ve çıktı akışları çalışır; geniş veri dinleyicisi arka kapı oluşturmaz.
- Tam admin sayfasında sekme yerleşimi, kurumsal onay penceresi ve modal kapanışları korunur; Hosting/Rules/indeks paketi tutarlıdır.

## 7. Sonraki aşamaya bırakılan işler

Son onaydan sonra ilgili birim/personeline icra işi açılması, “işleme alındı/gerçekleştirildi/kapandı” takibi ve tamamlanma bildirimi Aşama 6'dır. Güvenilir otomatik e-posta, KEP, e-Devlet ve gerçek e-imza sağlayıcısı Spark istemci pilotunda çalışıyormuş gibi sunulmaz. Ek yükleme/Storage adaptörü, mevcut metin pilotunu değiştirir; ayrıca kapsamlandırılmadan Aşama 5'e sessizce eklenmez.

Ana plandaki 5–8 günlük efor tahmini esas alınır; legacy erişim dönüşümü, vekâlet ve bütçe kapılarının sonuçları ilk pakette tahmini güncelleyebilir. Öncelik güvenli süreç/erişim kabulüdür.
