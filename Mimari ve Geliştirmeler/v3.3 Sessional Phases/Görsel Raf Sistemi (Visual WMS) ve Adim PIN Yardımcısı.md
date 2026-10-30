# v3.3 Geliştirme Walkthrough'u

> **Kapsam:** FAB dış tıklama kapatması, izole Admin Hızlı PIN yardımcısı ve Görsel Raf Sistemi (Visual WMS); sonraki UX turunda ilk giriş PIN kurulumu, raf taşıma ve kapasite kontrollü transfer iyileştirmeleri.
> **Veri yaklaşımı:** WMS, yeni Firestore koleksiyonu veya şeması oluşturmaz. B1/B2 stoklarını mevcut `window.data.b1` ve `window.data.b2` verisinden okur; raf kapasitesini yalnızca tarayıcı `localStorage` alanında tutar.

## 1. Kısa uygulama raporu

### Önceki geliştirmeler

- `script.js`: FAB (`#floatingActionBar.fab-visible`) veya mobil Bottom Sheet (`.bs-active`) açıkken, ilgili kontrol alanlarının dışındaki boş alana tıklama seçim/menüyü kapatır. FAB ve alt panel içindeki eylemler, satır seçimleri, butonlar ve modal etkileşimleri dış tıklama sayılmaz.
- `src/utils/admin-quick-unlock.js`: Admin'in normal parolasıyla kilidi açtığı sırada isteğe bağlı 4 haneli PIN tanımlamasına izin verir. PIN, parola metnini PBKDF2-SHA-256 ile türetilen anahtar ve AES-GCM kullanarak şifreli biçimde yalnızca `sessionStorage` içinde saklar. PIN açılışı var olan `unlockAdmin` → `SecurityConfig.authenticate(password)` → Firebase Auth zincirini çağırır; istemci tarafında oturum oluşturmaz veya kilidi kendi başına kaldırmaz. Üç hatalı PIN denemesinde kasa silinir.
- `src/modules/auth-engine.js` ve `index.html`: Başarılı normal admin girişi sonrası, o sekmede PIN kasası yoksa ilk giriş PIN kurulum diyaloğu sunulur. PIN kurulumu atlanabilir; bu özellik normal admin girişini engellemez.
- `admin.html`: Bağımsız PIN yardımcısı script'i admin sayfasına, ortak raf kapasite servisi WMS modülünden önce eklendi.

### Bu turdaki WMS geliştirmesi

- Admin sidebar'ına **🧱 Depo Raf Haritası (WMS)** sekmesi eklendi.
- B1/B2 görünümü; evrensel ürün/raf araması; doluluk, raf kodu ve ürün çeşidine göre sıralama; toplam/dolu/kritik metrikleri; 5 slot varsayılanı; raf başına yerel kapasite ayarı ve kompakt raf inceleme çekmecesi eklendi.
- Dinamik ürün/raf metinleri `escapeHtml` ile güvenli HTML'e çevrilir. Mevcut Firestore Auth, kuralları ve envanter yazma davranışı değiştirilmedi.
- Raf çekmecesinin görsel hiyerarşisi geri bildirimle iyileştirildi: koyu/bulanık arka plan örtüsü, opak ve belirgin yüzey, konum başlığı, slot özeti, ürün sayacı ve kartlı ürün satırları eklendi. Çekmece `body` altına taşındığı için `.shelf-matrix` scope'unda kalan CSS token'ları çekmeceye miras kalmıyordu; tema token'ları overlay köküne de tanımlanarak panelin şeffaf görünmesi giderildi.
- Raf kapasitesi düzenleme akışında tarayıcı `prompt()` yerine doğrulama mesajları ve kaydet/iptal kontrolleri olan uygulama içi bir diyalog kullanılır.
- Çekmecedeki ürün satırından **Rafı değiştir** ile mevcut ürünü aynı depoda müsait bir rafa taşıma eklendi. Dolu raf seçenekleri kapalıdır ve kayıt öncesi kapasite yeniden denetlenir.
- B1↔B2 iç transferinde hedef raf kapasitesi yazma öncesi kontrol edilir. Dolu hedef rafa transfer durdurulur; müsait hedefte mevcut transfer yazma akışı devam eder.

## 2. Dosya değişiklikleri

| Dosya | Değişiklik |
|---|---|
| `script.js` | FAB/Bottom Sheet dış tıklama dinleyicisi |
| `src/utils/admin-quick-unlock.js` | İzole, şifreli, oturum-sekmesi kapsamlı Admin Hızlı PIN yardımcısı |
| `index.html` | Başarılı admin girişinde ilk PIN kurulumu için Hızlı PIN helper bağlantısı; kapasite servisi |
| `src/modules/auth-engine.js` | Firebase Auth başarıyla tamamlandıktan sonra PIN kurulum diyaloğu |
| `src/utils/shelf-capacity.js` | B1/B2 için ortak kapasite ve kullanılabilir slot hesabı |
| `src/ui/ui-components.js` | İç transferde hedef rafın kapasite kontrolü |
| `admin.html` | Hızlı PIN script'i; WMS sidebar sekmesi, uygulama kökü, stil ve modül bağlantıları |
| `src/modules/admin/shelf-matrix.js` | WMS veri toplama, arama/sıralama, raf kartları, metrikler, kapasite ve çekmece modülü |
| `src/modules/admin/shelf-matrix.css` | Kompakt grid, çekmece ve responsive/dark-theme uyumlu stiller |
| `Mimari ve Geliştirmeler/v3.3 Sessional Phases/Görsel Raf Sistemi (Visual WMS) ve Adim PIN Yardımcısı.md` | Bu teknik yürüyüş ve geliştirme raporu |

## 3. WMS mimarisi ve çalışma akışı

### 3.1 Sayfa entegrasyonu

`admin.html` içinde:

1. `#nav-shelfMatrix`, mevcut `showAdminTab('shelfMatrixTab')` sekme yöneticisini kullanır.
2. `#shelfMatrixTab` içinde uygulamanın statik kontrol yüzeyi bulunur: depo toggle'ları, arama, sıralama, metrik ve kart grid'i.
3. `src/modules/admin/shelf-matrix.css` başlıkta; `src/modules/admin/shelf-matrix.js` diğer klasik admin script'leri yanında yüklenir.
4. `src/utils/html.js` zaten `admin.html` başlığında yüklendiğinden modül `window.escapeHtml` fonksiyonunu kullanır. Fonksiyon yoksa WMS hata verir ve dinamik içeriği kaçışsız basmaz.

### 3.2 Veri kaynakları ve raf gruplama

`collectShelves(depot)` seçilen `window.data[depot]` koleksiyonunu tarar. Array ve object koleksiyon biçimlerini destekler. Ürün alanlarında eski/yeni isim farklılıkları şu yardımcılarla bir araya getirilir:

- `productName(item)`: `ürün`, `urun`, `name`, `ad`, `productName`
- `productType(item)`: `tür`, `tur`, `type`, `urunTuru`, `productType`
- `productShelf(item)`: `raf`, `shelf`, `rafNo`
- `productQuantity(item)`: `adet`, `qty`, `quantity`
- Seri numarası: `seriNo`, `serialNo`, `seri`, `sn`
- Barkod/ürün kodu: `barkod`, `barcode`, `urunKodu`, `productCode`

Pozitif adedi ve stokta olduğunu belirten durumu olan ürünler raf değerine göre gruplanır. Stok dışı, sıfır/negatif adetli veya raf kodu bulunmayan ürünler en sonda tek **Rafı Tanımsız** kartında gösterilir. Fiziksel raflar varsayılan beş ürün slotu kapasitesi alır; bir slot bir stok kaydını/ürünü temsil eder, ürünün adet değeri çekmecede ayrıca gösterilir.

### 3.3 Arama, sıralama ve metrikler

- `matchesQuery(shelf)`: Raf kodunda veya o raftaki ürün adı, marka, tür, seri numarası, barkod/ürün kodu ve ID değerlerinde eşleşme arar. Ürün eşleşmesi bulunduğunda yalnızca o ürünün rafı görünür; raf kodu eşleştiğinde ilgili raf bütünüyle kalır.
- `sortShelves(shelves)`: Doluluk oranı (azalan), raf kodu (Türkçe ve sayısal sıralama) veya ürün çeşidi (azalan) seçeneklerini uygular. Tanımsız raf, filtrelenmiş sonuçlarda daima en sondadır.
- `makeMetricsHtml(shelves)`: Fiziksel toplam raf, ürün bulunan raf ve kapasitesinin en az %80'ini kullanan kritik/tam dolu raf sayılarını hesaplar. Tanımsız stok ayrıca bir hap rozetinde belirtilir.
- `render()`: Aktif depo verisini okur, metrikleri ve eşleşen kartları yeniden üretir. Filtre metrikleri daraltmaz; aktif deponun genel toplamını gösterir.

### 3.4 Kart, kapasite ve yerel ayar

- `makeShelfCard(shelf)`: Doluluk yüzdesi/progress bar ve slot noktalarını çizer. Renk eşikleri normal `<%80` yeşil, `%80–<%100` turuncu, `%100+` kırmızıdır. Görüntülenen yüzde kapasiteyi aşabilir; progress bar görsel olarak %100'de sınırlandırılır.
- Kapasite anahtarı `b1:<raf kodu>` veya `b2:<raf kodu>` biçimindedir. Ayarlar, istenen `shelf_capacities` localStorage girdisinde JSON nesnesi olarak tutulur. Başlangıç kapasitesi 5, kullanıcı tarafından ayarlanabilecek aralık 1–200 tam sayıdır.
- `loadCapacities()` ve `saveCapacities()` depolama/JSON hatalarını konsola bildirir. Bozuk veya tarayıcıca reddedilen kayıt yüzünden WMS durmaz; varsayılan kapasite kullanılır. Kaydetme hatasında kullanıcıya uygulama bildirimi gösterilir.
- Kapasite ayarı Firestore'a, ürün kayıtlarına veya güvenlik kurallarına yazılmaz ve aynı admin hesabının farklı tarayıcı/cihazlarında senkronize olmaz.
- `src/utils/shelf-capacity.js`, `window.ShelfCapacity.capacityFor()`, `slotStats()` ve `setCapacity()` API'lerini sunar. WMS kartları, raf taşıma ve iç transfer kapasite değerini bu ortak API'den okur.

### 3.5 Raf inceleme çekmecesi

- `openDrawer(depot, shelfKey)`: Güncel veriden rafı bulur, başlık ve slot özetini oluşturur; ürün adını, türünü, barkod/kodunu, seri numarasını ve adedini kompakt listede gösterir.
- `ensureDrawer()`: Tek bir erişilebilir dialog/overlay oluşturur; dış alana tıklama ve kapatma düğmesi çekmeceyi kapatır.
- `closeDrawer()`: Görünürlük durumunu, `aria-hidden` değerini ve gövde kaydırma kilidini geri alır. Escape tuşu da kapatır.
- Stok değişikliği olayı geldiğinde WMS sekmesi açıksa grid yeniden çizilir; çekmece açıksa aynı rafın içeriği güncel stoktan yenilenir.
- Drawer, `.shelf-matrix` DOM kapsamının dışında `document.body` altına eklenir. Bu yüzden tema renk token'ları `.shelf-drawer-overlay` üzerinde ayrıca tanımlanır; aksi halde CSS `var(--shelf-surface)` değeri bulunmayabilir ve panel arka planı transparan kalabilir. Overlay blur/karartma, opak kart yüzeyi, sabit başlık ve mobil alttan açılan sheet düzeni paneli içerikten belirgin biçimde ayırır.

## 4. Güvenlik ve uyumluluk

1. **HTML enjeksiyonu:** Kullanıcı/stok verisi içeren tüm raf kodu, ürün adı, ürün türü, marka, seri numarası, barkod/kod ve `data-*` değeri `escapeHtml` ile çıktı öncesi kaçırılır. Çekmece şablonunun sabit HTML'i dinamik veri içermez; ürün satırları ayrı kaçırılmış şablonla çizilir.
2. **Yeni sunucu yetkisi yok:** WMS yalnız mevcut envanter verisini okur. Yeni koleksiyon, yazma API'si, admin bypass'ı veya Firestore kuralı eklenmemiştir.
3. **Hızlı PIN sınırı:** PIN özellik olarak opsiyoneldir. Dört haneli PIN tam parola kadar güçlü değildir; düşük entropili PIN, cihaz/sekme depolaması üzerinden saldırganın erişimine karşı güvenlik garantisi vermez. AES-GCM kasası PIN'i doğrudan düz metin olarak saklamasa da kısa PIN'in çevrimdışı tahmin riskini ortadan kaldırmaz. Paylaşılan cihazlarda PIN tanımlanmamalıdır. Gerçek Firebase kimlik doğrulaması yine zorunludur.
4. **İzolelik:** `admin-quick-unlock.js` silinirse normal `unlockAdmin` ve Firebase kilit açma akışı çalışmayı sürdürür. Hızlı PIN bir yardımcı katmandır; asıl güvenlik kodunun yerine geçmez.
5. **Tema ve ekran:** WMS renkleri `--color-surface`, `--color-border`, `--color-text`, `--color-text-muted` gibi mevcut token'ları kullanır. Grid, tablet/mobilde kolon sayısını azaltır; çekmece küçük ekranda alttan açılır.

## 5. İlgili fonksiyon haritası

| Fonksiyon / yüzey | Sorumluluk |
|---|---|
| `window.showAdminTab(tabId)` — `src/modules/admin/admin-dashboard.js` | Sidebar sekmesini açar; yeni sekme mevcut yönlendirmeyi kullanır. |
| `collectShelves(depot)` — `src/modules/admin/shelf-matrix.js` | `window.data.b1/b2` ürünlerini fiziksel raflara ve tanımsız gruba ayırır. |
| `matchesQuery(shelf)` / `sortShelves(shelves)` | Omni-search ve sıralama davranışı. |
| `makeMetrics(shelves)` / `makeShelfCard(shelf)` | Hızlı metrik rozetleri ve güvenli raf kartı HTML'i. |
| `setCapacity(depot, shelf)` / `loadCapacities()` / `saveCapacities()` | `shelf_capacities` tarayıcı ayarının doğrulanması ve saklanması. |
| `window.ShelfCapacity.slotStats(depot, shelf)` / `setCapacity(...)` — `src/utils/shelf-capacity.js` | WMS, raf taşıma ve iç transfer için ortak kapasite/boş slot hesabı ve ayarı. |
| `openDrawer(depot, shelfKey)` / `closeDrawer()` | Raf ürün incelemesi ve çekmece yaşam döngüsü. |
| `moveProductToShelf(depot, itemId)` — `src/modules/admin/shelf-matrix.js` | Özel raf seçici, kapasite kontrolü ve `updateItem` ile ürünün raf alanını değiştirme. |
| `UIComponents.confirmTransfer()` — `src/ui/ui-components.js` | B1↔B2 iç transferinde hedef rafa slot kontrolü; kapasite doluysa herhangi bir yazmadan önce durdurma. |
| `render()` / `bindUI()` | WMS çizimi, kullanıcı etkileşimleri ve canlı stok olayı bağlantısı. |
| `window.escapeHtml` — `src/utils/html.js` | WMS dinamik HTML çıktılarında kullanılır. |
| `window.unlockAdmin` / `SecurityConfig.authenticate(password)` — `admin.html`, `security.js` | PIN açılışında da çağrılan değişmeden kalmış gerçek parola/Firebase oturum doğrulaması. |
| `window.AdminQuickUnlock.offerPinSetup(password)` / `completeAdminLogin(code)` | Firebase Auth başarıyla açıldıktan sonra isteğe bağlı ilk PIN kurulum adımı; helper silinirse normal giriş akışı sürer. |
| `document` click dinleyicisi — `script.js` | FAB ve Bottom Sheet dış tıklama kapatması. |

## 6. Doğrulama

- `node --check` ile değişen JavaScript dosyalarının sözdizimi kontrolleri başarılı.
- `git diff --check` başarılı.
- `npm run lint:xss` başarılı: 47 dosya, 203 sink, 254 HTML şablonu, 880 dinamik ifade; 0 izinsiz ifade. WMS'teki dinamik metinler `escapeHtml` ile kaçırılır.
- `npm run test:unit` başarılı: 122 test geçti, 0 başarısız.
- Ayrı bir Node VM DOM-çift testi başarılı: raf gruplama/tanımsız ürünler, metrik çizimi, çekmece ürün çıktısında XSS kaçışı, seri numarasıyla filtreleme ve boş arama durumu doğrulandı.
- Önceki turda Hızlı PIN için izole WebCrypto akış denetimi başarılıydı: şifreli kayıt, gerçek authenticate fonksiyonunun çağrılması ve üçüncü hatalı denemede kasanın silinmesi.
- Tarayıcı kontrolü: kapasite diyaloğu native `prompt()` çağırmadan açılıp değeri `shelf_capacities` ayarına kaydetti; ürün taşıma testinde dolu hedef kapalı ve boş hedef kullanılabilir bulundu; iç transfer testinde 5/5 dolu raf yazma yapmadan reddedildi ve 4/5 müsait raf için transfer yazmaları üretildi.
- İlk admin girişi PIN kurulum diyaloğu ve şifreli oturum kasası önceki tarayıcı denemesinde doğrulandı. Bunlar Firestore Auth'u atlamaz.

## 7. Bilinen sınırlar

- Slot adedi ürün kayıtlarının sayısıdır; tek bir ürün kaydındaki adet, birden fazla fiziksel slot olarak varsayılmaz.
- Raf kapasitesi cihaz/sekme bazlıdır; Firestore'a kaydedilmez.
- Kritik eşiği `%80` olarak tanımlanmıştır; raf doluluğu ürün kayıt adedine göre hesaplanır.
- Stok dışı veya sıfır stoklu kayıtlar, kayıt üzerinde raf alanı olsa bile “Rafı Tanımsız” altında sınıflandırılır; fiziksel mevcut stok raf kapasitesine dahil edilmez.
- **Yeni ürün ekleme sırasında dolu raf kapasite hatası henüz uygulanmamıştır.** `src/modules/inventory-logic.js` içindeki `saveProduct()` yeni kayıtları `appendItem` ile yazar ve raf slotunu denetlemez. Bu nedenle şu anda dolu bir rafa ürün eklerken sistem kapasite hatası göstermez. Raf taşıma ve iç transfer kontrolleri ayrı akışlardır.

### Yeni ürün için kapasite engeli — yalnızca plan

İstenen kapsam uyarınca bu özellik bu değişiklikte kodlanmamıştır. Uygulama planı:

1. Yeni ürün formunda depo/raf seçimi yapıldığında `ShelfCapacity.slotStats()` ile `kullanılan/kapasite` bilgisini göster; alternatif müsait rafların seçimini kolaylaştır.
2. `saveProduct()` kayıt öncesi aynı hesabı tekrar çalıştırsın. Hedef raf doluysa `appendItem` çağrısından önce kaydı durdurup “Raf X dolu (5/5); başka raf seçin veya WMS kapasitesini güncelleyin” mesajını versin.
3. Ürün düzenlemede ürün aynı rafta kalıyorsa kendi mevcut slotunu işgal hesabından düş; başka rafa taşınma/ekleme yeni slot gerektirsin.
4. `shelf_capacities` şu an yerel `localStorage` verisidir. Bu kontrol yalnızca o tarayıcıdaki anlık veri için bir UX doğrulamasıdır; eşzamanlı kullanıcıları/cihazları engelleyen kesin kapasite garantisi değildir. Kurum çapında kesin zorunluluk istenirse, kayıt ile kapasiteyi atomik biçimde doğrulayacak ortak sunucu tarafı tasarım ayrıca kararlaştırılmalıdır.
