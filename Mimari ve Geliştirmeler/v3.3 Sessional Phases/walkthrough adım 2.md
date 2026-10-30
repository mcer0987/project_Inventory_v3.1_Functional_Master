# v3.3 Geliştirme Walkthrough'u — PIN Kurulumu ve Raf Operasyonları

> **Kapsam:** Önceki Visual WMS / Admin Hızlı PIN raporundan sonra gelen iyileştirmeler: normal admin girişi sonrası ilk PIN kurulumu, raf kapasitesi için özel diyalog, WMS çekmecesinden ürün rafını değiştirme ve iç transferde hedef raf kapasitesi kontrolü.
> **İlişkili belge:** [Görsel Raf Sistemi (Visual WMS) ve Adim PIN Yardımcısı.md](./Görsel%20Raf%20Sistemi%20(Visual%20WMS)%20ve%20Adim%20PIN%20Yard%C4%B1mc%C4%B1s%C4%B1.md)
> **Veri yaklaşımı:** Yeni veritabanı koleksiyonu veya güvenlik kuralı eklenmedi. Envanter mevcut B1/B2 kayıtlarında kalır; kapasite ayarı `localStorage` içinde, PIN kasası mevcut oturum-sekmesi kapsamındaki `sessionStorage` içinde tutulur.

## 1. Kısa uygulama raporu

- Admin normal parolayla giriş yaptıktan ve varsa biyometrik doğrulamadan geçtikten sonra, aynı sekmede hızlı PIN ayarı yoksa isteğe bağlı PIN kurulum diyaloğu sunulur. Kurulum atlanabilir; başarılı normal giriş akışı devam eder.
- WMS kapasite düzenlemesi tarayıcıya ait `prompt()` penceresinden uygulamanın tema uyumlu diyalog arayüzüne taşındı. Kapasite 1–200 arası tam sayı olarak doğrulanır.
- Raf çekmecesindeki ürünler için **Rafı değiştir** eylemi eklendi. Ürün, aynı depo içinde dolu olmayan hedef rafa taşınır; kayıt öncesi kapasite yeniden kontrol edilir.
- B1↔B2 iç transferinde hedef raf seçimi için paylaşılan kapasite servisi kullanılır. Hedef raf doluysa herhangi bir stok yazımı başlatılmadan işlem durdurulur.
- Yeni ürün formunda dolu raf kontrolü bu kapsamda uygulanmadı. Mevcut `saveProduct()` akışı kapasiteyi denetlemediğinden, bu akışta bugün dolu rafa kayıt yapılır ve kapasite uyarısı gösterilmez. Ayrı bir geliştirme için önerilen plan Bölüm 7'de kayıtlıdır.

## 2. Dosya değişiklikleri

| Dosya | Bu geliştirmedeki sorumluluk |
|---|---|
| `index.html` | Hızlı PIN helper'ını başarılı admin girişinin gerçekleştiği sayfada yükleme; ortak raf kapasite script'ini yükleme. |
| `src/modules/auth-engine.js` | Firebase tabanlı parola doğrulaması ve biyometriden sonra, admin paneline yönlendirmeden önce isteğe bağlı PIN kurulumunu çağırma. |
| `src/utils/admin-quick-unlock.js` | PIN kurulum arayüzünü ve mevcut oturum kasası davranışını bağımsız yardımcı olarak sunma. |
| `admin.html` | PIN helper'ı ve WMS'ten önce ortak kapasite script'ini yükleme; mevcut WMS sayfa entegrasyonunu barındırma. |
| `src/utils/shelf-capacity.js` | B1/B2 raf kapasitesi, kullanılan slot ve kalan slot için ortak API. |
| `src/modules/admin/shelf-matrix.js` | Özel kapasite diyaloğu; WMS drawer'ından ürün rafı taşıma ve güvenli yazma akışı. |
| `src/modules/admin/shelf-matrix.css` | Özel kapasite ve raf seçimi diyaloglarının görünümü ve responsive yerleşimi. |
| `src/ui/ui-components.js` | B1/B2 iç transferinde hedef raf kapasitesi kontrolü. |
| `Mimari ve Geliştirmeler/v3.3 Sessional Phases/walkthrough.md` | Bu geliştirmeye ait teknik akış, fonksiyon haritası, sınırlar ve test özeti. |

## 3. Teknik akışlar

### 3.1 İlk başarılı admin girişinde Hızlı PIN kurulumu

1. `checkAdminAndGo()` giriş formundaki parolayı alır ve `completeAdminLogin(code)` akışını başlatır.
2. `completeAdminLogin(code)`, `window.SecurityConfig.authenticate(code)` ile mevcut admin kimlik doğrulamasını çalıştırır. Firebase oturumu ve admin kimliği doğrulanmadan kurulum sunulmaz.
3. Varsa biyometrik doğrulama tamamlanır.
4. `window.AdminQuickUnlock.offerPinSetup(code)` metodu helper yüklüyse çağrılır. Metodun yokluğu normal girişin önünde engel değildir.
5. Kullanıcı kurulum yaparsa PIN kasası mevcut helper tarafından şifreli biçimde `sessionStorage` alanına yazılır. Kurulum atlanırsa kullanıcı admin paneline geçer.
6. Helper çağrısındaki hata loglanır; mevcut auth başarı akışını ve yönlendirmeyi bozmaz.

Bu entegrasyon, hızlı PIN'in Firebase Auth yerine geçmesini sağlamaz. Normal admin oturumu ve asıl kilit açma davranışı kendi mevcut doğrulama zincirini kullanmaya devam eder.

### 3.2 Ortak kapasite servisi

`src/utils/shelf-capacity.js`, `window.ShelfCapacity` arayüzünü sağlar:

| Fonksiyon | Davranış |
|---|---|
| `capacityFor(depot, shelf)` | `b1:<raf>` veya `b2:<raf>` anahtarındaki yerel kapasiteyi döndürür; ayar yoksa varsayılan 5 kullanılır. |
| `slotStats(depot, shelf)` | İlgili depodaki stokta bulunan ve rafı eşleşen ürün kayıtlarını sayarak `{ used, capacity, available, full }` sonucu verir. |
| `setCapacity(depot, shelf, capacity)` | B1/B2, boş olmayan raf adı ve 1–200 arası tam sayı değerini doğrular; ayarı `shelf_capacities` anahtarına yazar. |

Kapasite birimleri ürün kaydı/slot adedidir. Tek bir kaydın `adet` miktarı birden çok slot olarak sayılmaz. Servis; pasif, sıfır stoklu ve stok dışı kayıtları kapasite kullanımına katmaz.

### 3.3 Özel WMS kapasite diyaloğu

- Raf kartındaki kapasite eylemi `setCapacity(depot, shelf)` fonksiyonunu çağırır.
- `createDialog(...)` mevcut temayla uyumlu form diyalog yapısını oluşturur. Kapasite alanı sayısal, zorunlu ve tam sayı olacak şekilde kontrol edilir.
- Geçersiz değerlerde veya `localStorage` yazımı başarısız olduğunda diyalog üzerinde açık hata gösterilir; geçersiz ayar başarıyla kaydedilmiş gibi davranılmaz.
- Kaydetme başarılı olunca `ShelfCapacity.setCapacity()` çağrılır ve WMS görünümü yeni kapasiteyle yeniden çizilir.

### 3.4 Raf çekmecesinden ürünün konumunu değiştirme

1. Drawer içindeki **Rafı değiştir** düğmesi `moveProductToShelf(depot, itemId)` akışını başlatır.
2. `requireDbAdmin()` mevcutsa yazma öncesi admin yetkisi kontrol edilir. Ürün, canlı `window.data[depot]` listesinden ID ile tekrar bulunur; eksik veya kimliksiz kayıtta işlem durdurulur.
3. Hedef seçenekleri mevcut depo raflarından ve `INV_CONFIG` içinde tanımlı raflardan oluşturulur. Aktif raf ve slotu dolu raflar seçime kapatılır. Her seçeneğin doluluk bilgisi kullanıcıya gösterilir.
4. Form gönderiminde `ShelfCapacity.slotStats()` tekrar çağrılır. Kullanıcı diyalog açıkken raf dolduysa işlem reddedilir.
5. `window.updateItem(depot, item.id, { raf: targetShelf, lastUpdate: Date.now() })` yazımı `window.writeOk()` ile tamamlanır. Hata/başarısızlık dialog üzerinde gösterilir.
6. Başarılı işlemde WMS yeniden çizilir ve ürünün taşındığı rafın çekmecesi açılır.

Bu hızlı konum değişikliği aynı depo içindeki raflar arasındadır; B1↔B2 depo transferi değildir.

### 3.5 B1↔B2 transferinde kapasite kontrolü

`UIComponents.confirmTransfer()` iç transfer dalında, transfer miktarı ve hedef rafın varlığı doğrulandıktan sonra hedef deponun `ShelfCapacity.slotStats(targetData.key, targetShelf)` sonucunu kontrol eder.

- Ortak kapasite servisi yüklenmemişse transfer güvenli şekilde durdurulur ve hata bildirilir.
- Hedefte boş slot yoksa uyarı gösterilir ve stok yazma işlemleri başlatılmaz.
- Hedefte slot varsa mevcut transfer mantığı sürer: tam transferde mevcut kayıt davranışı korunur; kısmi miktar için kaynak stok düşülür ve hedefte kanonik yeni kayıt oluşturulur.

## 4. Güvenlik ve uyumluluk

1. **Kimlik doğrulama korunur:** PIN kurulumu başarılı Firebase parola doğrulamasından sonra sunulur. PIN, admin oturumu açmak için Firebase Auth'un yerine geçmez.
2. **Helper bağımsızdır:** `AdminQuickUnlock` API'si `typeof`/opsiyonel metot kontrolüyle çağrılır. Helper dosyası kaldırıldığında ilk girişte PIN kurulum seçeneği görünmez; normal parola, Firebase Auth ve admin kilit akışı çalışmaya devam eder.
3. **Yetkili yazma:** Raf taşıma mevcut `requireDbAdmin`, `updateItem` ve `writeOk` yollarını kullanır. Yeni yazma yetkisi veya güvenlik kuralı eklenmemiştir.
4. **Diyalog içeriği:** Raf taşıma hedefleri `textContent` ile DOM'a yazılır. Var olan WMS dinamik HTML çıktıları `escapeHtml` yaklaşımını sürdürür.
5. **Kapasite ayarının kapsamı:** `shelf_capacities` tarayıcıdaki `localStorage` ayarıdır; ortak Firestore verisi değildir. Başka kullanıcı/cihazlardaki kapasite değerleriyle eşitlenmez.
6. **Eşzamanlı yazma sınırı:** Slot kontrolü istemci tarafında görüntülenen stok ve yerel kapasite üzerinden yapılır. Ayrı kullanıcıların eşzamanlı ekleme/transferleri için atomik sunucu garantisi oluşturmaz.

## 5. İlgili fonksiyon haritası

| Fonksiyon / yüzey | Sorumluluk |
|---|---|
| `checkAdminAndGo()` — `src/modules/auth-engine.js` | Giriş formundan admin giriş akışını başlatır ve tekrar gönderimleri engeller. |
| `completeAdminLogin(code)` — `src/modules/auth-engine.js` | Firebase admin doğrulaması, biyometrik kontrol, PIN kurulum çağrısı ve yönlendirme sırasını yönetir. |
| `window.AdminQuickUnlock.offerPinSetup(password)` — `src/utils/admin-quick-unlock.js` | Opsiyonel ilk PIN kurulum arayüzünü sunar. |
| `window.ShelfCapacity.capacityFor()` / `slotStats()` / `setCapacity()` — `src/utils/shelf-capacity.js` | Raf kapasitesi ve kullanılan/boş slot bilgisinin ortak kaynağı. |
| `setCapacity(depot, shelf)` — `src/modules/admin/shelf-matrix.js` | Kapasite formunu doğrular, kaydeder ve WMS kartlarını yeniler. |
| `moveProductToShelf(depot, itemId)` — `src/modules/admin/shelf-matrix.js` | Ürünü aynı depo içinde müsait rafa taşıyan, tekrar kapasite kontrolü yapan ve yetkili API ile kaydeden akış. |
| `createDialog(...)` — `src/modules/admin/shelf-matrix.js` | WMS kapasite ve raf konumu için uygulama içi diyalog oluşturucu. |
| `UIComponents.confirmTransfer()` — `src/ui/ui-components.js` | İç transferde hedef raf kapasitesini yazma öncesi denetler. |
| `saveProduct()` — `src/modules/inventory-logic.js` | Yeni ürün ekleme akışı; mevcut durumda raf kapasitesi kontrolü içermez. |

## 6. Doğrulama

- Değişen JavaScript dosyaları `node --check` ile kontrol edildi.
- `npm run lint:xss` başarılı: 47 dosya, 203 sink, 254 HTML şablonu, 880 dinamik ifade; izinsiz ifade yok.
- `npm run test:unit` başarılı: 122 test geçti, başarısız test yok.
- `git diff --check` başarılı; bu belgenin satır sonu boşluk kontrolü de yapıldı.
- Tarayıcı denemesinde özel kapasite diyaloğu `window.prompt` kullanmadan değeri `shelf_capacities` alanına kaydetti.
- WMS raf taşıma senaryosunda dolu hedefin seçilemediği ve müsait hedefin kullanılabildiği doğrulandı.
- İç transfer kapasite senaryosunda dolu hedef için stok yazımı oluşmadığı, müsait hedef için transfer yazma işlemlerinin devam ettiği kontrol edildi. Transfer denemesi kontrollü DOM/mock veri ortamındadır; gerçek Firebase/Firestore uçtan uca testi değildir.
- PIN kurulum arayüzü ve oturum kasasının şifreli saklanması önceki tarayıcı kontrolünde doğrulanmıştır; auth akışında gerçek Firebase doğrulaması korunur.

## 7. Yeni ürün ekleme için sonraki geliştirme planı

Yeni ürün formunda tam raf kontrolü bu geliştirmede yapılmadı; kullanıcı talebine uygun olarak yalnızca plan kayda geçirildi. Şu an `saveProduct()` yeni kaydı `appendItem()` ile ekler ve kapasite dolu olsa da engellemez.

1. Ürün formunda depo ve raf seçildiğinde `ShelfCapacity.slotStats()` ile `kullanılan/kapasite` ve kalan slot sayısını göster.
2. `saveProduct()` içinde `appendItem()` çağrısından hemen önce kapasiteyi tekrar denetle; hedef doluysa kaydı durdurup kullanıcıya raf adı ve doluluk oranıyla açık uyarı ver.
3. Düzenlenen ürün aynı rafta kalıyorsa kendi mevcut kaydını kullanım sayısından düş; başka rafa taşınma veya yeni kayıt ise hedefte yeni slot gerektirir.
4. Form seçimleri değişince kullanılabilir raf bilgisini yenile; kayıt anındaki doğrulamayı yine de kaldırma.
5. `localStorage` tabanlı kapasitenin yalnızca cihaz içi UX kontrolü olduğu açıkça belirtilmeli. Kurum genelinde kesin kapasite limiti istenirse, kayıt ve kapasiteyi eşzamanlı yazmalara karşı atomik doğrulayacak ortak sunucu tarafı yaklaşım ayrıca tasarlanmalıdır.

## 8. Bilinen sınırlar

- Yeni ürün ekleme sırasında dolu raf engeli henüz yoktur; yukarıdaki plan uygulanmamıştır.
- Kapasite tercihi tarayıcıya özgüdür; başka bilgisayara veya kullanıcıya aktarılmaz.
- Raf taşıma ve transferde tekrar kontrol yapılsa da bu kontroller Firestore transaction seviyesinde kapasite kilidi sağlamaz.
- Slot sayımı ürün kayıtlarını sayar; kaydın içindeki adet sayısı slot sayısını artırmaz.
- Gerçek Firebase ile transferin tam/kısmi uçtan uca testi bu doğrulama kapsamında yapılmamıştır.

## 9. Mobil gezinme ve kullanıcı çubuğu CSS güncellemesi

Önceki mobil UX turunda `mobile-responsive.css` içine responsive başlık ve yatay sekme şeridi kuralları eklendi; bu turda aynı yüzey korunarak login yeniden tasarımı eklendi.

### Güncellenen/eklenen CSS blokları

| Dosya ve blok | Güncelleme |
|---|---|
| `mobile-responsive.css` — `.inventory-screen > .header`, `.logo-wrapper`, `.brand-wordmark`, `#userDisplay` | Başlık ve dinamik kullanıcı eylemlerini mobilde sıralı bir flex düzenine alır; kullanıcı adı ellipsis ile kısalır. 380 px altında ikincil wordmark gizlenir. |
| `mobile-responsive.css` — `.user-tasks-button`, `.user-action-button`, `@media (max-width: 460px)`, `@media (min-width: 461px) and (max-width: 768px)` | Görev, panel, güvenlik raporu ve çıkış eylemlerine 44 px dokunma hedefi verir; küçük ekranlarda buton metinlerini gizleyip ikon ve erişilebilir adları korur, daha geniş mobilde metinleri gösterir. |
| `mobile-responsive.css` — `.tabs-scroll-shell`, `.tabs`, `.tab-button`, `.tab-btn`, `.has-more-before`, `.has-more-after` | Sekmeleri bağımsız yatay kaydırma alanına taşır; kart benzeri aktif/pasif durum, focus göstergesi ve kaydırma devam ipuçlarını stillendirir. |
| `mobile-responsive.css` — `.mobile-nav-help`, `@media (prefers-reduced-motion: reduce)` | Ekran okuyucuya kaydırma açıklaması sağlar; hareket azaltma tercihinde kaydırma/sekme geçiş animasyonlarını azaltır. |
| `login-redesign.css` — `#loginModal.login-modal-v3` ve `[data-theme="dark"]` | Giriş overlay'ini ve kartını açık/koyu tema tokenlarıyla yeniden görünür kılar; yumuşak yüzey, ince sınır, kontrollü blur ve gölge kullanır. |
| `login-redesign.css` — `.login-eyebrow`, `.login-icon-box`, `#loginModalTitle`, `.login-description`, `.login-mini-footer` | Giriş kartının marka üst yazısı, mevcut sembol alanı, başlık, açıklama ve sürüm satırının tipografi/boşluk düzenini yeniler. |
| `login-redesign.css` — `.login-field-label`, `#login-pri`, `#access-val-node`, `#loginStatus` | Form etiketlerini, tema uyumlu giriş alanlarını, klavye odak halkasını ve hata alanını biçimlendirir. |
| `login-redesign.css` — `.btn-login-new`, `.login-admin-button`, `@media (hover: hover)`, `@media (max-width: 480px)`, `@media (max-height: 700px)` | Giriş ve yönetici eylemlerini dokunmaya uygun hale getirir; hover dışındaki giriş animasyonu kullanılmaz. Kısa ekranlarda form aralıkları küçülür ve kart içi kaydırma korunur. |

### Eski CSS için silme/değiştirme kaydı

- `style.css` içindeki mevcut `.login-special-style`, `[data-theme="dark"] .login-special-style`, `.login-header-bar`, `.login-inner-body`, `.login-icon-box`, `.login-divider`, `.login-mini-footer`, `#access-val-node` ve `#loginModal .modal-content` kuralları **silinmedi veya yerinde değiştirilmedi**. Kural geriye dönük değişiklik riskini azaltmak için `login-redesign.css` bu login'e özel daha yüksek özgüllüklü seçicilerle görünüm değerlerini override eder.
- `index.html` içindeki PRI alanına ait eski inline ölçü/border/background stilleri ve açıklama paragrafının inline renk/boşluk stilleri kaldırıldı; bunlar `login-redesign.css` içindeki `#login-pri` ve `.login-description` bloklarına taşındı. Bu değişiklikler sadece login bileşeniyle sınırlıdır.
- `mobile-responsive.css` içindeki ürün/diğer modal kuralları ve `style.css` geneli değiştirilmedi. Giriş kartı için viewport/safe-area ve kısa ekran kuralları yalnızca `#loginModal.login-modal-v3` kapsamındadır.
- Sekme yapısında `.tabs` düğümünün kendisi kaldırılmadı; `index.html` içinde onu saran erişilebilir `<nav class="tabs-scroll-shell">` eklendi. Önceki genel `.tabs` responsive kuralı korunur; login/navigation katmanındaki yeni `.tabs-scroll-shell` seçicileri scoped ek davranışlar sağlar.
- Bu geliştirme kapsamında silinen CSS bloğu yoktur. Önceki responsive katmanda yapılan seçici geçişi ve yeni override blokları yukarıdaki tabloda açıkça listelenmiştir.

### Login v3 tasarımı ve geri alma

- `index.html` login penceresi `role="dialog"`, `aria-modal`, `aria-labelledby` ve `aria-describedby` ile etiketlendi. Her iki alan için görünür `<label>` eklendi; mevcut `loginForm`, `handleLogin(event)` ve `checkAdminAndGo()` akışları korunmuştur.
- Alt sürüm satırı `CR Envanter v2.0` yerine **ENVANTER TAKİP SİSTEMİ · V3.3** olarak güncellendi.
- Tasarımın ana değişikliği tek başına `login-redesign.css` dosyasındadır ve `index.html` içinde ayrı link olarak yüklenir. Eski görseli geri almak için bu link kaldırılabilir; `style.css` içindeki eski stiller yerinde durur. Form doğrulama ve auth kodu bu CSS dosyasına bağlı değildir.

### Bu geliştirme için doğrulama

- `login-redesign.css` tarayıcıda 320×568, 390×844 ve 1024×768 ölçülerinde açık ve koyu temada yüklendi; sayfada yatay taşma oluşmadı.
- 320×568 kısa ekranda sıkıştırılmış kartın giriş düğmesi ilk görünüm alanında kaldı; içerik/kart taşması için dikey kaydırma da kullanılabilir. 390×844 ve 1024×768 ölçülerinde kart ortalanıp form görünür kaldı.
- Modal rol/etiket ilişkisi, görünür alan etiketleri, erişilebilir adlar, 52 px giriş düğmeleri ve 54 px standart giriş alanları tarayıcı DOM'unda kontrol edildi.
- `npm run lint:xss`, değişen JavaScript sözdizimi kontrolleri ve `git diff --check` başarılıdır. `npm run test:unit` bu görsel-only login değişikliğinin kapsama/önceki turlardaki davranış kontrolleri için 122 testle başarılıdır.
