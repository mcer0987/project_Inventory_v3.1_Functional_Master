# EBYS Aşama 4 — Evrak kaydı, üst yazı ve gelen/giden yönetimi

**3 Kasım 2026 kapanış kaydı:** Aşama 4 çekirdek ve UI/UX uygulaması `990a924` commit'indedir; önceki bölümlerdeki “commit edilmedi” ifadeleri yazıldıkları andaki tarihsel durumu anlatır. Proje sahibi Aşama 5 öncesi mevcut çalışma ağacının Hosting yayınını ayrıca onayladı; 86 dosyalık paket başarıyla yayımlandı. Ana sayfa, admin sayfası, manuel çıkış modülü/şeması ve evrak arayüzünün canlı dosyaları yerel SHA-256 ile aynı doğrulandı. Yayın beyaz listesi güncel kapsam için 86/86 ve izinsiz XSS kullanımı 0 olarak geçti. Bağımsız denetimin A4-02 yayın kapsamı kapısı bu doğrulamayla kapandı; A4-01 farklı yazar rezervasyon çakışması P2'si Aşama 5 başlangıç planına devredildi. Bu kapanış kaydı ve tam admin yerleşim testi ayrı kabul commit'ine hazırlanmıştır; diğer envanter/import/manuel çıkış çalışma ağacı değişiklikleri Aşama 4 kodu diye commit'e alınmaz.

Uygulama tarihi: 2 Kasım 2026. Dosya adı istenen rapor sözleşmesiyle korunmuştur.

Dal: `feat/v3.4-ebys-asama-4`. Başlangıç commit'i: `d2b117a` — `feat(ebys): kalemli satın alma ve döviz yönetimini tamamla`.

Aşama 3'e kadar olan EBYS çalışmaları proje sahibinin talimatıyla bu commit'e alındı. Ortak dosyaların envanter içe aktarma ve ilgili görünüm değişiklikleri commit dışında bırakıldı. Aşama 4 yerel çalışma ağacındadır; bu aşama commit edilmedi ve deploy yapılmadı.

## 1. Teslim edilen davranış

Admin > Talepler ve Süreçler içinde ayrı Evrak Kayıt Defteri bulunur: Gelen Evrak, Giden Evrak ve İç Yazışmalar. Elli kayıtlık sayfa, durum filtresi, sayfa içi numara araması, birim/durum/güncelleme görünümü ve yeni evrak işlemi eklendi. Seçilen yön görsel ve erişilebilir biçimde işaretlenir.

Üst yazı formunda birim, kurum kodu, konu, muhatap, tarih, dosya planı, gizlilik, dağıtım, dış evrak numarası ve gövde yer alır. Gövde düz metindir; kayıt öncesi etiket benzeri HTML reddedilir. Arayüz DOM `textContent`/`value` kullanır. HTML çalıştıran editör, HTML önizleme ve içerikten URL üretimi yoktur. Düz metin çıktı önizlemesi/yazdırma sağlanır.

`saveDraft()` başlık ve içeriği ayrı kaydeder. Revizyon kontrolü bayat düzenlemeyi reddeder. `freezeVersion()` içeriği ve üstveriyi değişmez sürüme kopyalar, SHA-256 özeti üretir; `versionId = processId` korelasyonu gelecekteki görev modeli için korunur. Bu aşamada ilk sürüm üretilir; dondurulmuş evrak düzenlenmez. Yeniden sunum/ikinci süreç geçişi Aşama 5 kapsamındadır.

`registerDocument()` numarayı rezervasyon, başlık güncellemesi, işlem ve olay kaydıyla aynı transaction'da yazar. Format `EBYS-{KURUM}-{YYMMDD}-{32 HEX}`; rastgele bölüm 128 bittir. Tarih UTC kayıt günüdür ve Rules sunucu `request.time` günüyle karşılaştırır. Sayaç koleksiyonu kullanılmaz. Rezervasyon doluysa en fazla beş yeni aday denenir; aynı başarılı operationId önceki sonucu döndürür. Aynı işlem kimliğinin farklı içerikle kullanılması reddedilir. Kayıt numarası belgeye verildikten sonra değişmez; iptal numarasını tekrar kullanma yolu yoktur.

Taslak → Kayıtlı → İncelemede veya Taslak → İncelemede → numara alma yolları desteklenir. Dondurma anında içerik değiştirilemez hale gelir. "Onaya sun / Dondur" bu aşamada **incelemeye hazır sürüm** oluşturur; imzacı görevi veya tamamlanmış onay üretmez. Kişisel görev/atama motoru Aşama 5'e aittir. Onaylandı, İcrada ve Arşivde filtreleri sonraki aşamaların kayıtları için hazırdır; bu durumlara keyfi geçiş API'si açılmamıştır.

## 2. Koleksiyonlar ve erişim

Yeni kayıtlar `${ROOT}/{collection}/items/{id}` altında tutulur:

| Koleksiyon | Davranış |
|---|---|
| `ebysDocuments` | İçerik/konu içermeyen yönlendirme başlığı; admin listeleyebilir, yazar kendi başlığını okuyabilir |
| `ebysDrafts` | Yalnız yazar okur/yazar; başlık, işlem ve olayla bağlı revizyonlu yazma |
| `ebysVersions` | Yalnız yazar okur; içerik kaydedilmiş taslakla eşleşir; update/delete her kullanıcı için kapalı |
| `ebysRegistrationIds` | Create-only tekil rezervasyon; belge/işlem/kayıt günü ilişkisi zorunlu; update/delete kapalı |
| `ebysOperations` | Komut sonucu ve tekrar denetimi; sahibine özel, değişmez |
| `ebysEvents` | Başlık revizyonu ve işlemle atomik bağlı, değişmez olay |

Genel `COLLECTIONS` ve `knownCol` listeleri genişletilmedi. Yeni evrak yolu mevcut `purchaseOrders.workflow` motorunu veya depo kayıtlarını yazmaz. Admin olmak başka yazarın taslağını/sürümünü okuma yetkisi vermez. Aktif birim ve ortam üyeliği aranır. Gelecekteki imzacıya erken içerik izni veya sahte görev üzerinden okuma yolu açılmadı. Süreç/görev erişimi Aşama 5'te yeni kurallarla eklenecek; bu teslimde sahip dışındaki içerik erişimi kapalıdır.

İçerik sunucudan yetki doğrulamasıyla okunur. Liste dinleyicisi yalnız ilgili admin sekmesi görünürken çalışır; çıkışta ve sekme değişiminde kapatılır. Oturum değişiminde eski içerik/önizleme DOM'dan kaldırılır. Başlıklar sayfalıdır; tüm sürüm içerikleri arka planda indirilmez.

## 3. Ekler, yedek ve indeks

Bu teslim Aşama 1'deki metin pilotunu kullanır: `attachments=[]`, `attachmentMode=none`. Dosya yüklenmiş gibi gösterilmez. Cloud Storage/chunk yükleme, belgeye ek bağlama ve özel dosya erişimi henüz uygulanmadı. Dondurulmuş sürüme sonradan ek ekleme yolu yoktur.

`EBYS_COLLECTION_REGISTRY` altı yeni koleksiyonu kaydeder. "Evraklarımı yedekle" sunucudan oturum sahibine göre sorgulayarak altı koleksiyonu JSON olarak indirir. Ortam, yazar, şema, dışa aktarma zamanı ve `consistency=sequential-reads` manifestoya yazılır. Bu yedek, eşzamanlı değişiklikler karşısında tek atomik snapshot garantisi vermez; dosya baytları/Auth hesapları içermez. Eski genel geri yükleme yoluna bu koleksiyonlar eklenmedi. İlişkisel doğrulamalı geri yükleme ayrı geçiş işidir; mevcut immutable kayıtları ezme yetkisi açılmadı.

`firestore.indexes.json` evrak yönü + güncelleme tarihi sorgusunun indeksini tanımlar. Firebase yapılandırması bu manifestoyu kullanır; indeks dosyası Hosting dışında tutulur. Canlı indeks/rules deploy'u yapılmadı. Yerel testler Firestore emülatöründedir; canlı indeks hazırlığı UAT sonrası deploy kapısında uygulanmalıdır.

## 4. Dosyalar

Yeni:

- `src/utils/ebys-document-schema.js` — saf şema, sınırlı metin, kanonik SHA-256 ve numara üretimi.
- `src/services/ebys-document-service.js` — taslak, dondurma, kayıt, okuma, listeleme ve özel dışa aktarma servisi.
- `src/ui/ebys-documents-ui.js` — kayıt defteri, form, önizleme, dinleyici yaşam döngüsü.
- `src/ui/ebys-documents.css` — uyarlanır form, diyalog ve çıktı stilleri.
- `firestore.indexes.json` — evrak kayıt defteri indeksi.
- `tests/unit/ebys-document-schema.test.mjs` — şema/numara/özet kanıtları.
- `tests/rules/ebys-documents.test.mjs` — gerçek servis transactionları ve negatif yetki testleri.
- `scratch/ebys-stage4-ui.cjs` — izole gerçek tarayıcı arayüz kontrolü.
- Bu uygulama raporu.

Değişen:

- `admin.html` — kayıt defteri bağlantı noktası ve stil.
- `src/modules/admin/admin-main.js` — yeni UI modülü.
- `firestore.rules` — özel evrak, taslak, sürüm, rezervasyon ve günlük kuralları.
- `firebase.json` — indeks manifestosu ve Hosting hariç tutma.
- `scratch/hosting-files.js` — dört yeni uygulama dosyası için beklenen sayı 81.

Aşama 3 başlangıç commit'ine ayrıca önceki UAT kararını koruyan düzeltme alındı: `src/ui/purchase-items-ui.js` içinde yeniden eklenmiş manuel kur modalı kaldırıldı; güncel yönetici ayarı doğrudan okunur, eksik ayarda onay durur. Bu düzeltme Aşama 4 diff'ine dahil değildir.

Çalışma ağacındaki diğer envanter/depo/import/görünüm ve taşınmış rapor değişiklikleri bu aşamanın dosya listesine dahil değildir.

## 5. Doğrulama ve kanıt

| Komut | Sonuç |
|---|---|
| `npm run test:unit` | **283/283**, başarısız 0 |
| `npm run test:rules` | **235/235**, 24 suite, başarısız 0; mevcut satın alma/depo testleri dahil |
| `npm run lint:xss` | **63 dosya**, 200 sink, 261 HTML şablonu, 920 dinamik ifade; güvenli 907, izinli 13, **izinsiz 0** |
| `node scratch/ebys-stage4-ui.cjs` | Yön seçimi, form, taslak, dondurulmuş sürüm, çıktı önizleme ve oturum temizliği geçti; **pageerror 0** |
| `git diff --check` | Hata yok |

Tam komut çıktıları: `scratch/ebys-stage4-unit.log`, `scratch/ebys-stage4-rules.log`. Son sunucudan içerik okuma/yedek kontrolü ayrıca `scratch/ebys-stage4-documents.log` içinde tutulur.

Sunucudan okuma ve dışa aktarma kontrolünü içeren son evrak servis koşusu: **7/7 geçti**, başarısız 0.

Yeni yedi emülatör senaryosu; idempotent taslak/kayıt/dondurma, rezervasyon çakışması, immutable sürüm ve numara, başka yazar/anonim erişimi, sahte kayıt/sürüm/günlük/görev, revizyonsuz taslak yazması, taslaktan farklı içerikle sürüm üretme, atomik rollback ve bağlı personelin kendi evrakı/pasif birim kontrollerini kapsar. İfade bütçesi aşımı görülmedi. İlk koşudaki yazar filtresiz test günlüğü sorgusu, erişim politikasına uygun `ownerUid` filtresiyle düzeltildi.

Hosting beyaz liste kontrolü, önceden bulunan kapsam dışı `release-journal/index.html`, `journal.js`, `style.css` nedeniyle hâlâ başarısızdır: beklenen 81, mevcut 84. Bu dosyalar silinmedi ve deploy yapılmadı.

## 6. Pilot sınırları ve devam

SHA-256 istemci tarafından hesaplanır. Rules sürüm içeriğini taslakla karşılaştırır fakat SHA-256'yı yeniden hesaplayamaz; özet resmî imza/doğrulama kanıtı değildir. Evrak numarası benzersiz iç kayıt kimliğidir; kendiliğinden resmî numara standardı veya e-Devlet onayı sağlamaz.

Önceki satın alma kur kaynağının yönetici ayarıyla birebir Rules eşleşmesi sınırı devam eder; bu aşamanın özel evrak kuralları mevcut ağır satın alma onay dalına ek yük getirmez. Aşama 5'te görev erişimi ve sorgularla birlikte kuralların sadeleştirilmesi ayrıca değerlendirilmelidir.

Manuel UAT: Admin > Talepler ve Süreçler > Evrak Kayıt Defteri'nde her yön için evrak oluşturun; aktif birim seçip taslak kaydedin; kesin kayıt numarası alın; dondurun; içerik alanlarının kilitlendiğini ve çıktının aynı metni taşıdığını doğrulayın. İkinci yazarla içerik erişiminin kapalı kaldığını kontrol edin. Dondurulan evrak henüz kişiye düşen onay işi oluşturmaz; sıradaki Aşama 5 bu sürümlere görev bağlar. Onay sonrası havale/icra işi Aşama 6'da ele alınacaktır.

## 7. Tam admin yerleşimi düzeltmesi

Manuel testte ana panelin sağa taşması ve Evrak Kayıt Defteri'nin kaybolması bildirildi. Güncel HTML'de Operasyon Merkezi kartlarından sonra fazladan bir `</div>` bulunuyordu. Bu etiket, ana içerik kapsayıcısını erken kapatıp satın alma, tanımlar, TODO ve sonraki sekmeleri `body` altında bırakıyordu. Fazla etiket kaldırıldı; eksik evrak bölümü ve stil bağlantısı tekrar eklendi. Diğer Operasyon Merkezi görünüm değişiklikleri korundu.

Önceki izole evrak testi ana sayfanın kapsayıcı yapısını sınamıyordu. Yeni `scratch/admin-layout-regression.cjs`, tam admin HTML'sini ve gerçek yerel stilleri tarayıcıya yükler; uygulamanın gerçek `showAdminTab` fonksiyonunu kullanarak dokuz sekmenin doğrudan `.main-content` içinde olduğunu, altı sekmenin tek başına görünmesini ve içerik sınırlarını doğrular. Evrak bölümü tekil, doğru sekmede ve görünürdür. Kontrol geçti; pageerror 0. Görsel kanıt: `scratch/admin-layout-restored.png`.

Bu düzeltmeden sonra `node scratch/ebys-stage4-ui.cjs`, `npm run lint:xss` ve `git diff --check -- admin.html` geçti. Sunucu kuralları/veri servisleri değişmedi; bu düzeltme için Rules paketi yeniden çalıştırılmadı.

## 8. Manuel UAT sonrası altı UI/UX düzeltmesi

- Native dialogun reset stilleriyle sol üste yapışması giderildi: sabit inset, otomatik marj, karartılmış/flu backdrop, sağ üst çarpı, dış alana tıklama ve Escape kapanışları eklendi. Önizleme aynı kapanış davranışını kullanır.
- Meta alanları güçlü yerel seçicilerle iki kolon gridde düzenlendi. Dağıtım alanı yarım genişliktedir; evrak gövdesi tam genişliktedir. Pencere en fazla 85vh, içeriden kaydırılabilir. Dar ekranda tek kolona geçer.
- Dondurma native confirm yerine mevcut `showCustomConfirm` üzerinden yürür. Native dialog, kurumsal onay kutusunun altında kalması için geçici olarak kapatılır; aynı DOM ve girilen değerler korunur. Vazgeç formu geri getirir, onay dondurma işlemini başlatır.
- Başarılı taslak kaydı formu kapatır, kayıt defterini ilk sayfadan yeniler ve başarı mesajını listede gösterir. Hata durumunda form ve veriler korunur.
- Kayıt defteri, Satın Alma & Servis ana başlığının altına taşındı; admin kapsayıcı yapısı korundu.
- Kayıt defterinin başına standart `kpi-container` / `dashboard-card` kartları eklendi: Toplam Evrak, Taslaklar, Kayıtlı Evraklar, Dondurulan/İncelemede. Bunlar sayfadaki 50 satırdan türetilmez: `countDocuments()` dört Firestore aggregate count sorgusuyla tüm kayıtları sayar. Admin bütün kayıtların sayısını, servis personel yolunda yalnız kendi kapsamının sayısını alır. Filtreler/sayfalama toplamları daraltmaz. Mevcut liste yenilenince göstergeler yenilenir.

Değişenler: `admin.html`, `src/ui/ebys-documents-ui.js`, `src/ui/ebys-documents.css`, `src/services/ebys-document-service.js`, `scratch/ebys-stage4-ui.cjs`, `tests/rules/ebys-documents.test.mjs`, bu rapor. Firestore yazma kuralları değiştirilmedi.

Doğrulama: `npm run lint:xss` geçti (65 dosya, 202 sink, 262 HTML şablonu, 932 dinamik ifade; güvenli 919, izinli 13, izinsiz 0). Tam HTML ve gerçek stillerle UI/UX testi; merkez konumu, 2 kolon, 85vh sınırı, çarpı/Escape/backdrop, gerçek kurumsal onay/iptal, taslakta kapanma ve liste yenileme, 50'yi aşan KPI görünümü, başlık sırası, çıktı ve mobil tek kolon kontrolünü geçti; pageerror 0. `scratch/admin-layout-regression.cjs` geçti: 9 sekme doğru kapsayıcıda, 6 geçiş doğru yerleşimde. Aggregate count ve kayıt kuralları gerçek servisle 7/7 geçti; log `scratch/ebys-stage4-ux-counts.log`. Görsel kanıt `scratch/ebys-stage4-form-ux.png`. Diff kontrolü temiz. Değişiklikler yerel dalda; commit/deploy yapılmadı.

## 9. Canlı manualExits okuma hatası

Proje sahibinin deploy sonrası bildirdiği `manualExits: Missing or insufficient permissions` hatası için canlı Firestore release kaydı salt okunur API ile incelendi. `medipol-inventory-v3` projesinin `cloud.firestore` release zamanı `2026-10-30T11:51:21.119698Z`. Yayınlanmış kurallarda `manualExits` ve yeni EBYS koleksiyonları bulunmuyor; yerel kurallarda mevcut. İstemci/Rules sürümleri farklıdır. Bu incelemede canlı kural veya veri değiştirilmedi.

`tests/rules/manual-exits.test.mjs` içine canlı/demo köklerinde admin listeleme, bağlı personel okuması ve misafir/bağsız hesap/tanımsız kök ret kontrolleri eklendi. Hedefli emülatör koşusu **4/4 geçti**, başarısız 0. Log: `scratch/manual-exits-read-rules.log`.

Gerekli yayın komutu: `firebase deploy --only "firestore:rules,firestore:indexes" --project medipol-inventory-v3`. Hosting yayını Firestore kurallarını/indekslerini kendiliğinden güncellemez. Yayın tamamlandıktan sonra sayfa tam yenilenmeli; izin hatasıyla kapanmış dinleyici tekrar başlatılmalıdır. Bu komut inceleme sırasında çalıştırılmadı.
