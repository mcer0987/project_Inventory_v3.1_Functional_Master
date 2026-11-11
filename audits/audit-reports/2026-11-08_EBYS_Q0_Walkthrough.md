# Q0 Walkthrough ve ölçümlü self-proof

8 Kasım 2026. **Teknik kabul: geçti.** Gerçek sayfa üzerinde görsel/klavye ve Auth+emülatör uçtan uca kullanıcı kabulü bu teslimde yapılmadı; aşağıdaki Chrome kapsamı kontrollü fixture'dır.

## Başlangıç ve Q0 farkı

Çalışma yeri `C:\Users\med3pol\Documents\project_Inventory`; dal `feat/v3.4-ebys-tamamlama-h0`; HEAD `883da91e947152d41dd6f56cbb8b6b27c1dbf10b` aynı kaldı. Başlangıçta H0'ın 7 dosyalık +259/−9 diff'i ve izlenmeyen kullanıcı belgeleri vardı. Bunlar reset/stash/clean yapılmadan korundu. `scratch/ebys-q0-evidence/baseline.patch`, `baseline/` dosya kopyaları ve `baseline-hashes.json` Q0 öncesini kaydeder. H0 raporlarına dokunulmadı.

Q0 üretim farkı yalnız üç UI dosyasındadır:

- `src/ui/ebys-process-ui.js`: kart başına `watchTaskContext` çağrısı kaldırıldı. Mevcut görev durumu gösterilir; konu/sürüm numarası ve süreç durumu **Konu / sürüm / durum** düğmesiyle alınır. Süreç durumu kontrol anıyla etiketlidir. İçerik yine görevdeki sabit versionId ile açılır. Liste, sekme görünürlüğü ve oturumla birlikte temizlenir; eski callback/yanıtlar generation/UID/bağlı DOM kontrolünden geçer. Hata açık içeriği kaldırır. H0 bitiş hesabı korunur.
- `src/ui/ebys-documents-ui.js`: snapshot içinden dört toplam sorgusu kaldırıldı; ilk görünür açılışta yükleme ve açık **Toplamları yenile** eklendi. Aynı anda yinelenen yenilemeler birleştirilir. Kapsam kurum/kendi evrakları ve tüm türler olarak açıklanır; sayfa filtresi kurum toplamı diye sunulmaz. Bilinmeyen değer `—`; hata eski satırları temizler. Geç liste/sayaç/editör yanıtlarına oturum/nesil kontrolü eklendi.
- `src/ui/ebys-showcase-modal.js`: yalnız ayrıntının kontrol anını ve toplam yenileme adımını anlatan statik rehber cümlesi; H0 vekâlet metni korunur.

Yeni `tests/unit/ebys-q0-ui.test.mjs` gerçek UI ve servis modüllerini kontrollü SDK sınırıyla headless Chrome'da test eder. İki Q0 raporu eklendi. `q0-only.patch` yalnız başlangıç kopyalarına göre üç UI dosyasının farkıdır; yeni test ve raporların içerikleri kendi dosyalarındadır. Bu ayrım H0 satırlarını Q0 teslimi gibi saymaz.

`h0-preservation.json`: Rules, süreç servisi, evrak servisi ve süreç şeması başlangıç SHA256 değerleriyle **aynı**. Rules/indeks/şema/yeni koleksiyon/ek yazma yok. Yeni kullanıcı özeti alanı olmadığı için kaynak bağı gerektiren yeni Rules sözleşmesi veya veri göçü yok. Bütün görevler mevcut alanlardan kuyruk özeti ve açık istekle ayrıntı yolunu kullanır.

## Ölçümler

Kök: `C:\Users\med3pol\Documents\project_Inventory\scratch\ebys-q0-evidence\`.

| İlk görev çizimi | Kart | Önce etkin dinleyici | Sonra | Önce süreç ilk snapshot'ı | Sonra | Önce tam sürüm okuması | Sonra |
|---|---:|---:|---:|---:|---:|---:|---:|
| Tek görev | 1 | 2 | 1 | 1 | 0 | 1 | 0 |
| Sayfa | 25 | 26 | 1 | 25 | 0 | 25 | 0 |
| Tam sayfa | 50 | 51 | 1 | 50 | 0 | 50 | 0 |

Test: **Q0 Chrome: 1/25/50 kart önce-sonra gerçek UI ve servis SDK çağrıları**. Kanıt: `ui.log`, `measurements.json`; başlangıç UI kopyaları ve Q0 UI aynı gerçek servislerle çalıştırıldı. N adet süreç ilk snapshot'ı getDoc değildir; getDoc süreç çağrısı ilk çizimde iki tarafta da sıfırdır. Yeni ayrıntı tıklaması 1 getProcess + 1 getVersion çağrısı yapar; içerik açma ayrıca 1 getVersion çağrısıdır. Sonuçlar genel cache'e alınmaz. Aktif ve geçmiş iki kart varsa eski yol her çizilen kart için alt abonelik açardı; yukarıdaki ölçüm N aktif kart içindir.

| Defter senaryosu | Önce aggregate sorgu | Sonra | Kanıt |
|---|---:|---:|---|
| Üç liste snapshot'ı | 12 | 4 | `counts.json`, `ui.log` |
| Ardından açık toplam yenileme | Düğme yok | 4 ek (toplam8) | Aynı testin assertion'ı |

Test: **Q0 Chrome: snapshot sayaçları çoğaltmaz, açık yenileme dört sorgudur**. Yeni ilk görünür açılışta4, sonraki snapshot'larda0; ilk sayfa/tür/sayfa geçişi sayaç yenilemesi değildir. Ekran kapatılıp yeniden açılırsa yeniden4 sorgu yapılır; görünmez ekranda toplam güncellemesi yok.

Bunlar gerçek modüllerin kontrollü SDK çağrı ölçümleridir; Firebase fatura/kota ölçümü değildir. Liste snapshot'ında fixture N belge döndürür; bunlar yukarıdaki alt okumalara ek liste belgeleridir. Rules bağımlı belge okumaları, yeniden bağlantı sunucu maliyeti ve canlı günlük kota **ölçülmedi**. 5.000 okuma/2.000 yazma plan payı kapasite garantisi yapılmadı. Sayfa sınırı50 ve cursor+limit kaldı; offset/polling/telemetri yazımı yok. Dönen aggregate sayısının12 olması fixture değeridir; gerçek kurum sayısı değildir.

## Davranış ve temizleme kanıtları

| Test adı | Sonuç / kapsam | Günlük |
|---|---|---|
| Q0 Chrome: gizli sekme, hata, yeniden açma ve geç callback temizliği | 50 kart → gizli üst sekmede0 dinleyici → görünür1; eski callback veri basamaz; hata kartları kaldırır ve0'a döner | `full-unit.log` |
| Q0 Chrome: ayrıntı isteğe bağlı, kaldırılmış kart ve oturum geç yanıtı göstermez | Açık istek1 süreç+1 sürüm; konu/sürüm gösterilir; içerik isteği beklerken farklı kullanıcı/cleanup sonrası modal açılmaz | `full-unit.log` |
| Q0 Chrome: sayfalama, boş liste, erişim reddi ve dar ekran | Sonraki sayfada tek abonelik; boş liste açıklaması; ret sonrası konu temizliği; 390px ve dark media fixture screenshot | `full-unit.log`, `fixture-mobile.png` |
| H0 saat matrisi / adım saati testleri | Altı saat senaryosu geçti | `full-rules.log` |
| H0 gerçek süresi dolmuş vekil, eski görev ve sahte süre testleri | Gerçek Rules ret/uyumluluk beklentileri geçti | `full-rules.log` |
| Paraf sonrası iade ve ikinci sürüm; eski/yeni sürüm erişimi | Eski karar yalnız eski metne erişir; gelecek imzacı erken okuyamaz | `full-rules.log` |
| Mevcut işlem geri bildirimi / envanter / icra / QR | Servis karar yolları değiştirilmedi; mevcut tam regresyon takımı geçti. Yeni Chrome fixture karar transaction'ını çalıştırmaz | `full-rules.log` |

Olumsuz erişimin gerçek güvenlik kanıtı mock Chrome'dan çıkarılmadı; gerçek Rules takımı kullanıldı. Tam Rules logundaki bütün negatif senaryolarda bütçe uyarısı sıfırdır iddiası yoktur (H0 dışı önceki senaryolar dahil). Q0 Rules'a ifade veya erişim çağrısı eklemedi.

## Gerçek koşular

| Komut | Exit | Test/geçen/hata/atlanan | Günlük |
|---|---:|---|---|
| `EBYS_Q0_COMPARE_BASELINE=1` ortamıyla `node --test --test-reporter=spec tests/unit/ebys-q0-ui.test.mjs` (dört ilk test) | 0 | 4/4/0/0 | `ui.log`, `ui.exit.txt` |
| `npm.cmd run test:unit` — son kod | 0 | **332/332/0/0** | `full-unit.log`, `full-unit.exit.txt` |
| `npm.cmd run test:rules` | 0 | **354/354/0/0**, 34 suite | `full-rules.log`, `full-rules.exit.txt`, `full-rules-firestore.log` |
| `npm.cmd run lint:xss` — son kod | 0 | 84 dosya / 989 dinamik ifade / **0 izinsiz** | `xss.log`, `xss.exit.txt` |

İlk Chrome koşusu CRLF metin eşlemesi nedeniyle eksik kaynak ve tanımsız callback üretti: **0/4**, `ui-first-failed.log`. Başlangıç kopyalarından H0 korunarak Q0 yeniden uygulandı; kaynak yeni satırları normalize edildi. Bu hata gizlenmedi. Sonraki ilk başarılı ölçüm `ui-initial-pass.log`; ek geç-yanıt temizliği sonrası son ölçüm `ui.log`. Son tam birim koşusu UI hata temizliğinin son güçlendirmesinden sonra tekrarlandı; önceki koşu `full-unit-before-hardening.log`. Asıl tam Rules bir kez çalıştırıldı; sonraki UI değişikliği Rules/servisleri değiştirmedi. Python komutu ortamda bulunmadığı için düzenleme Node ile yapıldı; test sonucu sayılmadı.

Tekrar çalıştırma PowerShell:

```powershell
# Yerel başlangıç kopyaları varsa önce/sonra kıyası (yeni checkout için gerekmez):
$env:EBYS_Q0_COMPARE_BASELINE='1'
node --test --test-reporter=spec tests/unit/ebys-q0-ui.test.mjs
Remove-Item Env:EBYS_Q0_COMPARE_BASELINE
npm.cmd run test:unit
$env:XDG_CONFIG_HOME=Join-Path (Get-Location) 'scratch/ebys-q0-evidence/cli-config'
$env:CI='true'
npm.cmd run test:rules
npm.cmd run lint:xss
```

Normal birim koşusu baseline kopyalarını gerektirmez; yalnız son kodu test eder ve `measurements-after.json` / `counts-after.json` yazar. Önce/sonra dosyaları böylece ezilmez. Chrome testi bu Windows ortamındaki `C:/Program Files/Google/Chrome/Application/chrome.exe` kurulumunu kullanır; başka makinede executablePath uyarlanmalıdır.

Rules CLI demo-rules-test ve takımın demo projectId'leriyle çalıştı; portlar8180/4410/4510 başlangıçta boştu. Başkasının emülatörü durdurulmadı. CLI başlangıç kuralsız uyarısına karşın her Rules dosyası gerçek `firestore.rules` metnini initializeTestEnvironment ile yükler; canlı proje/veri kullanılmadı.

## Tarayıcı kabulünün gerçek kapsamı ve riskler

Headless yerel Chrome'da gerçek UI/servis JS, kontrollü SDK ve asgari DOM fixture çalıştı. Gerçek kullanıcıyla oturum açılmadı; canlı veri yok. Dar ekran390px ve dark media ile fixture ekran görüntüsü alındı. Ürünün gerçek HTML/CSS'iyle açık/koyu tema, taşma, klavye odağı, Escape/modal etkileşimi, icra işlem sonrası görsel geri bildirim veya Auth+emülatör uçtan uca UAT **yapılmadı**. Fixture görüntüsü bu kontrollerin yerine geçmez; görsel kabul eksiğidir.

Konu/sürüm bilgileri artık açık istek ister; bu davranış hem kartta hem rehberde belirtilir. Kontrol anındaki süreç durumu canlı gibi sunulmaz. Yeniden liste snapshot'ı gelince ayrıntı yeniden istenir. Liste/sayfa değişimi geçmiş kararları değiştirmez; H0 süre hesabı ve görevdeki versionId korunur. Sayfa50 sınırı devam eder. Kaynak tabanlı kapsamda ek okumalar/yazmalar yaratılmadı; insanın yaptığı ek ayrıntı tıklaması ayrı okumadır.

Geri dönüşte yalnız Q0 UI/test/rapor farkları alınır; H0 içeren dosyalar kör HEAD'e döndürülmez. Veri göçü veya yeni Rules yayın sırası yok; H0'ın eski Rules'a dönüş kısıtı hâlâ geçerlidir. H1/satın alma köprüsü/yedekleme uygulanmadı.

Önerilen manuel kontrol (test ortamı):

1. Bana Gelen Onaylar'da aktif ve geçmiş kartın ayrıntısını açın; konu/sürüm ve kontrol anını görün.
2. Eski kararın metnini açın; yeni sürüme erken erişim olmadığını ve süre dolan görevde kararın reddedildiğini sınayın.
3. Sayfa50+ kayıtta sonraki/ilk sayfa ve sekmeden ayrılıp dönüşü deneyin; logout sırasında bekleyen ayrıntı açılamamalı.
4. Defterde snapshot/işlem sonrası toplamların otomatik yenilenmediğini; Toplamları yenile ile güncellendiğini ve hata durumunda eski satırın kalmadığını kontrol edin.
5. Gerçek HTML/CSS üzerinde mobil, açık/koyu tema, klavye odağı ve modal kapatmayı doğrulayın.

Commit, push, merge, deploy ve canlı veri değişikliği yapılmadı. Q0 teslim edildi; H1'e geçilmez.

## Q0-R1 / Q0-R2 kapanışı — 8 Kasım 2026

**Son karar: iki bulgu kapatıldı; teknik regresyonlar geçti.** Yukarıdaki ilk teslim ve başarısız/başarılı koşu geçmişi korunmuştur. Görünürlükte modal temizliği ve sayaç davranışı için bu kapanış bölümü esas alınmalıdır. Gerçek ürün HTML/CSS + Auth/emülatör UAT kabulü hâlâ yapılmış sayılmaz.

### Başlangıç, kapsam ve veri akışı

Dal ve HEAD aynı: `feat/v3.4-ebys-tamamlama-h0` / `883da91e947152d41dd6f56cbb8b6b27c1dbf10b`. Kapanış öncesi diff `scratch/ebys-q0-closure-evidence/baseline.patch`; başlangıç kaynakları `baseline/` içinde. Son kapanış farkı `closure-only.patch`, son kaynak hash'leri `final-hashes.json`. H0/Q0 başlangıç dosyaları kaldırılmadı; H0 raporları değişmedi.

Değişen üretim dosyaları yalnız `src/ui/ebys-process-ui.js` ve `src/ui/ebys-documents-ui.js`; ayrıca `tests/unit/ebys-q0-ui.test.mjs`, Implementation Plan ve bu Walkthrough güncellendi. Kapanış rehberin adımlarını değiştirmiyor; yalnız kontrol başarısızlığında not/metnin korunduğunu ve yeniden kontrol seçeneğini açıklayan kısa durum mesajları eklendi. Yeni panel yok.

- **R1:** Süreç pencereleri modül içi sahip kaydıyla tutulur; görev ve geri dönen evrak kuyrukları yalnız kendi pencerelerini kapatır. Ortak `.ebys-document-dialog` seçicisiyle tüm EBYS formlarını kaldırma kaldırıldı. Oturum nesli ile kuyruk nesli ayrıdır. Tarayıcı gizlenince sorgu0'a düşer, açık karar notu DOM'da korunur ve işlem düğmeleri kilitlenir. Dönüşte süreç ve sabit sürüm erişimi yeniden okunur. Aynı revision/durum/görevli sürüyorsa aynı formun notu korunur. Değişmiş görev veya izin reddinde eski süreç formu kaldırılır; eski formdan karar gönderilemez. Ağ hatasında not kalır, işlem kilitli tutulur ve **Durumu yeniden kontrol et** sunulur. Otomatik karar/kayıt yok.
- **R2:** Defter aboneliği görünür panel + görünür belge + oturum koşullarına bağlandı. Gizlenmede liste durur, bekleyen liste/sayaç nesilleri geçersizleşir, editör ve kaydedilmemiş alanları korunur. Dönüşte yalnız bir liste aboneliği açılır. Mevcut evrakın erişim/revision kontrolü tamamlanmadan editör işlemleri açılmaz. Evrak değişmişse metin korunur fakat işlem kilitli kalır; güncel evrakı yeniden açma açıklaması gösterilir. İzin reddi aynı evraka bağlı editör/çıktı önizlemesini kaldırır. Başka kuyruğun penceresine dokunulmaz.
- Tamamlanmış toplamlar görünürlük döngüsünde bellekte korunur. Gizlenirken toplam isteği hâlâ bekliyorsa sonuç atılır ve değer bilinmeyen kalır; dönüş her seferinde4 sorgu başlatmaz. Yeniden almak için açık **Toplamları yenile** kullanılır. Panelden ayrılıp yeni açılış ve açık yenileme mevcut yükleme sınırlarıdır. Kullanıcılar arası veya kalıcı içerik cache'i eklenmedi.
- Logout, ortak sync cleanup ve UID değişiminde ilgili modüllerin içerik temizliği korunur. Kuyruk hata durumu `running` değerini de kapatır; sonraki açık panel/görünürlük geçişi kontrollü toparlanabilir. Sürekli retry/polling eklenmedi.

Ek okuma sınırı: yalnız **açık** süreç penceresi dönüşte1 süreç +1 sabit sürüm okuması yapar; açık mevcut evrak/önizleme kendi erişim kontrolünü yapar (readDocument başlık+gövde). Kart başına gizli okuma geri getirilmedi. Bu maliyet sorgu yetkisini ve not korumayı birlikte sağlar; Firebase fatura/kota ölçümü değildir.

### Önce/sonra self-proof

Kök: `C:\Users\med3pol\Documents\project_Inventory\scratch\ebys-q0-closure-evidence\`.

İnceleme betiği koddan önce yeniden çalıştırıldı: `before.log`, `before.json`. Sonrasında aynı betik: `after-review.log`, `after-review.json`. Betik davranışı kaydeder; assertion içeren kalıcı regresyonlar da aşağıdadır.

| İddia / gerçek test adı | Kapanış öncesi | Son kod | Kanıt |
|---|---|---|---|
| İnceleme: karar notu / defter gizli listener | Not kayıp (`null`), defter1→1 | Not aynı, defter1→0 | `before.json` → `after-review.json` |
| `Q0-R1: gerçek karar notu gizle/göster korunur ve otomatik karar yoktur` | Başarısız | Geçti: aynı not, kuyruk1→0→1, karar sayısı0 | `before-final-regression.log` → `after-final-ui.log` |
| `Q0-R2: gerçek editör metni korunur, defter 1-0-1 ve sayaç sabittir` | Başarısız | Geçti: gerçek editör metni aynı, üç görünürlük döngüsünde sayaç4 kalır, kayıt sayısı0 | Aynı |
| `Q0-R1: iki kuyruk temizliği ilgisiz gerçek editörü ve karar formunu kaldırmaz` | Başarısız | Geçti: geri dönen kuyruk temizliği görev formunu, görev temizliği editörü, defter temizliği süreç formunu kaldırmaz | Aynı |
| `Q0-R1: gizliyken logout veya UID değişimi eski formu temizler` | Geçti | Geçti: iki ayrı durumda eski form kaldırılır | Aynı |
| `Q0-R1/R2: dönüşte yetki reddi ve eski yanıt formu geri getirmez` | Geçti | Geçti: süreç/editör/çıktı izin reddinde kaldırılır; eski pending open yanıtı yeni oturuma modal açamaz | Aynı |
| `Q0-R2: geç sayaç yanıtı gizliye yazılmaz ve olay tekrarı dinleyici çoğaltmaz` | Başarısız:99 gizliye yazıldı | Geçti:99 yazılmaz; tekrar görünürlük/panel olayları listener1, sorgu4; hata0→açık panelle1 toparlanır | Aynı |
| `Q0-R1: dönüşte değişen revision eski kararı engeller` | Geçti (eski kod formu gizlenmede zaten siliyordu) | Geçti: dönüşte gerçekten güncel revision kontrolüyle kaldırılır; karar0 | Aynı |

Önce geçen son üç test, eski kodun form koruyarak revalidation yaptığı anlamına gelmez; önceki gizlenme davranışı formu baştan siliyordu. Asıl kırmızı→yeşil kanıtı ilk not/alan/izolasyon/sayaç testleridir. Üretim formu testte yeniden yazılmadı: gerçek `EBYSProcessUI.open`, `EBYSDocumentsUI.open` ve gerçek modüller çalışır. Fixture yalnız servis/SDK cevaplarını ve görünürlük olaylarını kontrol eder. Yetki iddiası mock cevaptan değil tam gerçek Rules takımından desteklenir.

Q0 kazanımları son kapanışta yeniden ölçüldü:

| Senaryo | H0 kopyası | Kapanış sonu |
|---|---|---|
| 1/25/50 kart listener | 2/26/51 | **1/1/1** |
| Kart başına süreç ilk snapshot'ı | 1/25/50 | **0/0/0** |
| İlk çizimde tam sürüm okuması | 1/25/50 | **0/0/0** |
| Üç defter snapshot'ı toplam sorguları | 12 | **4** |

Kanıt: `measurements.json`, `counts.json`, `after-final-ui.log` içindeki ilk iki Q0 Chrome testi. Liste belgeleri ve Rules bağımlı okumaları bu SDK çağrı ölçümünden ayrıdır. Gerçek kota/fatura ölçülmedi.

### Komutlar ve sonuçlar

| Koşu | Exit | Test / geçen / hata / atlanan | Günlük |
|---|---:|---|---|
| Aynı son kapanış regresyonları, kapanış öncesi UI kopyaları | 1 | **7 / 3 / 4 / 0** | `before-final-regression.log`, `.exit.txt` |
| Son hedefli UI, H0 önce/sonra ölçümleri dahil | 0 | **12 / 12 / 0 / 0** | `after-final-ui.log`, `.exit.txt` |
| `npm.cmd run test:unit` son kod | 0 | **339 / 339 / 0 / 0** | `full-unit.log`, `.exit.txt` |
| `npm.cmd run test:rules` | 0 | **354 / 354 / 0 / 0**, 34 suite | `full-rules.log`, `.exit.txt`, `full-rules-firestore.log` |
| `npm.cmd run lint:xss` son kod | 0 | 84 dosya,989 dinamik ifade, **0 izinsiz** | `xss.log`, `.exit.txt` |

Tam Rules yalnız bir kez demo emülatörde8180/4410/4510 ile çalıştı; kullanıcının8080/9099/4000 yerel emülatörü durdurulmadı. Son UI düzeltmeleri Rules/servisleri değiştirmedi; `h0-preservation.json` başlangıç H0 Rules/servis/şema hash'leriyle eşitliği doğrular. H0 saat/vekâlet ve envanter testleri aynı tam takımda geçti. Bütün negatif testlerde bütçe uyarısı sıfırdır iddiası yoktur.

İlk yeni regresyon koşusu6 testte2 geçti/4 hata verdi (`before-regression.log`). İlk düzeltilmiş UI koşusu11/12 geçti (`after-ui.log`); testte tek eleman seçicisiyle length bakma hatası vardı. Sonraki tam birim koşusunda338/339 geçti (`full-unit-selector-failed.log`): yönetici formunun karar ve devir için iki textarea içermesi testin yanlış1 beklemesini ortaya çıkardı. Assertion gerçek süreç dialog sayısını ölçmek üzere düzeltildi; üretim beklentisi zayıflatılmadı. Son tam birim339/339 geçti. Bu başarısız koşular kapanış başarısı gibi sunulmadı.

Tekrar çalıştırma (PowerShell):

```powershell
# Kapanış öncesi kaynak kopyaları yerelde mevcutken aynı regresyonlar:
$env:EBYS_Q0_CLOSURE_BEFORE='1'
node --test --test-reporter=spec --test-name-pattern=Q0-R tests/unit/ebys-q0-ui.test.mjs
Remove-Item Env:EBYS_Q0_CLOSURE_BEFORE
# H0 önce/sonra kart ölçümleriyle son UI:
$env:EBYS_Q0_COMPARE_BASELINE='1'
node --test --test-reporter=spec tests/unit/ebys-q0-ui.test.mjs
Remove-Item Env:EBYS_Q0_COMPARE_BASELINE
npm.cmd run test:unit
$env:XDG_CONFIG_HOME=Join-Path (Get-Location) 'scratch/ebys-q0-closure-evidence/cli-config'
$env:CI='true'
npm.cmd run test:rules
npm.cmd run lint:xss
```

Chrome seçimi artık `CHROME_EXECUTABLE_PATH`, ardından `CHROME_PATH`, mevcut yaygın Chrome/Edge/Chromium yolları, ardından Puppeteer varsayılanıdır. Bulunamadığında launch başarısız olur; sessiz skip yoktur. Yeni paket kurulmadı.

### Tarayıcı kapsamı, manuel tekrar ve durma noktası

Gerçek Chrome'da kontrollü DOM/SDK fixture, gerçek karar formu, gerçek evrak editörü ve çıktı önizlemesi çalıştırıldı. Görünürlük `document.hidden` ve `visibilitychange` ile kontrollü üretildi. Gerçek ürün sayfasında Auth+emülatör ile not yaz/gizle/göster, gerçek sekme odağı, tema/klavye ve görsel UAT **yapılmadı**. Fixture sonucu bu eksikleri kapatmaz.

Kullanıcının ayrıca verdiği açık talimatla çalışan **yerel manuel emülatöre** mevcut seed yüklendi (`scratch/manual-emulator/seed.log`, exit0; canlıdan pull yapılmadı). Altı yerel hesap açıldı; yönetici/test bilgileri kullanıcıya iletildi. Bu yerel seed işlemi Rules testinden ve canlı veri değişikliğinden ayrıdır. Uygulama `http://127.0.0.1:5500/index.html?emu=1`, manuel emülatör paneli `http://127.0.0.1:4000/` açık bırakıldı.

Manuel tekrar:

1. Karar formuna not yazıp başka tarayıcı sekmesine geçin; dönünce aynı not ve tekrar açılan işlem düğmeleri görünmeli, karar otomatik gönderilmemeli.
2. Evrak editöründe metni değiştirip aynı gizle/gösteri tekrarlayın; metin korunmalı, toplam için açık yenileme kullanılmalı.
3. İlgisiz görev/geri dönen/defter panelini kapatıp diğer pencerenin silinmediğini doğrulayın.
4. Gizliyken çıkış veya görev değişikliği/erişim iptaliyle eski formun kullanılamadığını test edin.
5. Tekrarlı sekme geçişi, sorgu hatası sonrası yeniden açılış ve mobil/klavye kontrolünü gerçek ürün sayfasında tamamlayın.

Kalıcı otomatik hassas metin kaydı, yeni koleksiyon/telemetri, Rules gevşetmesi veya H1 işi yoktur. Commit/push/merge/deploy/canlı veri değişikliği yapılmadı. Q0-R1/R2 tesliminden sonra durulur.
