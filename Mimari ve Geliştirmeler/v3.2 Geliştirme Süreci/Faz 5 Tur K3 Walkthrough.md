# Faz 5 Tur K3: Arayüz Onarımları (ADM-05, 5.2/ZIM-05, 5.7/ARC-07)

## Özet
Üç bağımsız, cerrahi arayüz onarımı: Özel İzleme Paneli'nin ilk çizimden sonra kendi kendini silip bir daha
güncellenmemesi, Zimmet modalındaki "Yeni Personel"/"Yeni Ürün" kısayollarının admin panelinde aslında hiçbir şey
yapmaması (ilgili modaller yalnız index.html'de var), ve üç ayrı dosyanın `window.showAdminTab`'ı zincirleme
monkey-patch'lediği kırılgan desen.

## Değişiklikler ve Commit'ler
* **Dal:** `feat/phase-5-completion-and-ux`
* **Değişen dosyalar:** `src/modules/admin/admin-dashboard.js`, `src/modules/admin/inventory-management.js`,
  `src/modules/admin/admin-system-control.js`, `src/modules/edm-workflow.js`, `script.js`, `scratch/flow-tests.js`

**Not:** `src/modules/edm-workflow.js`'de bu turdan önce başka bir oturumdan kalan, commit edilmemiş saf biçimlendirme
(whitespace) düzeltmeleri ve ilgisiz küçük bir bugfix (`deleteWorkflowTemplate`) vardı; bu dosyayı kendi değişikliğim
için düzenlerken onlar da aynı commit'e dahil oldu (içerik olarak zararsız, yalnızca haber veriyorum).

## 1. Özel İzleme Paneli Onarımı (ADM-05)
`renderCustomWatchDashboard`, kart tasarımı kurmak için `table.parentElement.innerHTML = ...` yazıyordu — tablonun
EBEVEYNİ tabloyu da İÇERDİĞİ için bu satır `#customWatchTable`'ın kendisini DOM'dan siliyordu. İlk çizimden sonra
`querySelector('#customWatchTable')` hep `null` dönüyor, fonksiyon ikinci çağrıdan itibaren (`renderDashboardStats`
her b1/b2 güncellemesinde çağırıyor) `if (!table) return` ile sessizce çıkıyordu — panel bir daha asla yenilenmiyordu.

**Düzeltme:** Tablo artık SİLİNMİYOR, yalnız bir kez gizleniyor (`display:none`); kart konteyneri tablonun kendi
ebeveyninin İÇİNE, tablonun yanına (sibling, `insertAdjacentElement('afterend', ...)`) kalıcı bir karkas olarak
ekleniyor. Sonraki her çağrı yalnız bu konteynerin içeriğini değiştiriyor; DOM iskeleti bir daha asla silinmiyor. (Yan
etki olarak, eskiden "İzlenen ürün bulunamadı" boş-durum mesajı yazıldığı anda `cardContainer.innerHTML = html`
(`html=""`) ile hemen eziliyordu — bu da düzeldi.)

## 2. Hızlı Personel/Ürün Ekleme (5.2 · ZIM-05)
Kök neden, görünenden daha derindi: `quickAddPersonnel`/`quickAddProduct`, `window.openPersonelModal`/
`window.openProductModal`'ı çağırıyordu, ama:
- `#personelModal` ve `#productModal` yalnız **index.html**'de var; **admin.html**'de hiç yok.
- `openProductModal` ayrıca yalnız index.html'de yüklenen `UIComponents`/`main.js`'e (ESM) bağlı — admin.html o
  modülü hiç yüklemiyor, dolayısıyla fonksiyon admin.html'de zaten var olmayan bir modal arıyordu.

Sonuç: admin panelinde butona basınca hiçbir şey olmuyordu.

**Düzeltme:** İki buton da artık `inventory-management.js`'in kendi yerleşik deseniyle (`_injectAssignModal` —
`document.body`'ye bir kez enjekte edilen, kendi kendine yeten modal) aynı şekilde, başka hiçbir dosyaya bağımlı
olmayan kendi minik modallerini kullanıyor:
- **Yeni Personel:** Ad Soyad + otomatik oturum kodu → `appendItem('personel', ...)` (K2'nin personel yazma yolu).
- **Yeni Ürün:** Depo (B1/B2) + Tür + Ürün Adı + Marka + Adet → `appendItem(depo, ...)`. Tür listesi **yalnız
  demirbaş türlerle sınırlı** (zimmet akışı zaten yalnız demirbaş ürün gösteriyor — `onWarehouseChange`'deki filtre);
  kayıt K2'nin B1/B2 şema sözleşmesinden (`Schema.validateB1`) sıfır hatayla geçer.

Her iki kayıt da başarıyla eklendikten sonra Zimmet modalındaki ilgili seçim kutuları (personel dropdown'u, ürün
satırının depo/ürün seçimi) otomatik tazelenip yeni kayıt seçili hâle getiriliyor — admin ek bir tıklama yapmadan
doğrudan zimmete devam edebiliyor.

## 3. Admin Tab Kancaları (5.7 · ARC-07)
Üç ayrı dosya (`admin-system-control.js`, `inventory-management.js`, `edm-workflow.js`) kendi "sekme gösterildiğinde
çalış" ihtiyacı için `window.showAdminTab`'ı ayrı ayrı sarmalıyordu; her biri kendi `setTimeout` retry döngüsünü
taşıyordu (150-200ms), çünkü bu dosyalar admin.html'de `showAdminTab`'ın kanonik tanımından (`admin-dashboard.js`,
gecikmeli ESM modül) ÖNCE, klasik `<script>` olarak çalışıyordu.

**Düzeltme:** Tek, merkezi kanca sicili — `window.AppModules.AdminTabs` (`{onShow(tabId, fn), onAny(fn), dispatch(tabId)}`)
— `script.js`'e eklendi. `script.js` admin.html'de her zaman en erken yüklenen klasik dosyalardan biri olduğu için
(hem ESM modül zincirinden hem geç yüklenen klasik dosyalardan önce), kayıt işlemi hiçbir retry/polling gerektirmeden
her zaman güvenle çalışır. `showAdminTab`'ın TEK kanonik tanımı (`admin-dashboard.js`) kendi işini bitirince
`dispatch(tabId)` çağırır; başka HİÇBİR dosya artık `showAdminTab`'ı sarmalamıyor/değiştirmiyor:
- `admin-system-control.js`: `onAny(fn)` — her sekme değişiminde VIP Portal modunu açıp kapatıyor.
- `inventory-management.js`: `onShow('inventoryManagementTab', fn)`.
- `edm-workflow.js`: `onShow('workflowTemplatesTab', fn)`.

## Test Sonuçları
| Suite | Sonuç |
|---|---|
| `npm run test:unit` | ✅ 22/22 (değişmedi; bu tur mantık değil arayüz onardı) |
| `npm run test:rules` | ✅ 72/72 |
| `flow-tests.js --emu` (48 senaryo, yeni: `k3AdminTabHooks`) | ✅ 48/48, exit 0, 0 sayfa hatası, 0 CSP ihlali |
| `npm run lint:xss` | ✅ 0 izinsiz sink (41 dosya, 194 sink — yeni modal şablonları dahil) |

`k3AdminTabHooks`, admin.html üzerinde GERÇEK fonksiyonlarla sürer: `renderCustomWatchDashboard`'ı art arda iki kez
çağırıp tablonun ve kartların hayatta kaldığını; `showAdminTab('inventoryManagementTab'|'workflowTemplatesTab'|
'systemControlTab')`'ın ilgili kancaları gerçekten tetiklediğini (VIP sınıflarının eklenip kaldırıldığı dahil);
`quickAddPersonnel`/`quickAddProduct`'ın gerçek kayıt oluşturup (yakalayıcı `appendItem` stub'ıyla, Firestore'a
yazmadan) dropdown'ları doğru tazelediğini ve üretilen B1 kaydının `Schema.validateB1`'den sıfır hatayla geçtiğini
doğrular.

## Sahibinin Doğrulama Adımları
1. Admin panelinde Dashboard sekmesini açın, bir ürünü "İzlemeye Al"ın; Özel İzleme Listesi kartının göründüğünü
   doğrulayın. Başka bir sekmeye geçip geri dönün (ya da bir B1/B2 kaydını düzenleyin) — kartların hâlâ orada
   olduğunu ve güncel veriyi gösterdiğini doğrulayın (eskiden ikinci görünümde panel tamamen boş kalırdı).
2. Envanter Zimmet Yönetimi → "Zimmet Yap" modalını açın; "Yeni" (personel) ve "Yeni Ürün" butonlarına basıp birer
   kayıt oluşturun — modalın kapanıp ilgili alanın (personel/ürün) otomatik seçili geldiğini doğrulayın.
3. Sırasıyla Envanter Yönetimi, Workflow Şablonları ve VIP (Sistem Kontrolü) sekmelerine geçin; her birinin kendi
   içeriğini doğru render ettiğini, VIP sekmesinden çıkınca sayfanın normal temaya döndüğünü doğrulayın.

---

# K3 — Motor Ayağı: Birleşik Yedekleme (5.3 · ADM-06) ve VIP Döngüsü (5.5 · VIP-08)

## 4. Birleşik Yedekleme Servisi (ADM-06)
**Önceki durum:** İki araç, iki biçim. index.html "Yedek Al" `{timestamp, version:'1.0', data}` yazıyordu; VIP "1-Tık DB
Snapshot" ise `window.data`'nın sarmalayıcısız ham dökümünü (auditLogs gibi uygulama dışı anahtarlar dahil) indiriyordu.
Hiçbiri hangi ortamdan alındığını yazmıyordu; içe aktarma tek bir `confirm()` ile, neyin değişeceğini göstermeden demo
yedeğini canlı köke basabiliyordu. Ayrıca şema muhafızını atlayıp doğrudan `setDoc` yazan ölü bir `restoreFirebaseBackup`
vardı (`_backupTemp` hiçbir yerde atanmıyordu) — kaldırıldı.

**Şimdi:** `src/modules/admin/admin-backup.js` tek servis (`window.BackupService` / `AppModules.Backup`), iki sayfada
(index'te klasik script, admin'de `admin-main.js` içe aktarması):
- **Tek kanonik biçim:** `{ version: '3.2', root, timestamp, source, data }` — `data` yalnız `COLLECTIONS`.
  "Yedek Al" (`source:'admin'`) ve VIP snapshot (`source:'vip'`) aynı fonksiyondan geçer.
- **Geri yükleme sırası:** (1) ayrıştır — eski `v1.0` sarmalı ve VIP ham dökümü de tanınır, uygulama dışı anahtarlar
  atlanır ve bildirilir; (2) **ortam denetimi** — kanonik yedeğin `root`'u aktif köke eşit değilse **reddedilir**, onay
  bile sorulmaz; root'suz eski yedek yalnız "ortam doğrulanamadı" uyarısı ve ayrı onay düğmesiyle
  ("Doğrulanmamış Yedeği Geri Yükle"); (3) **önizleme** — koleksiyon bazında yedekte / şu an / eklenecek / silinecek
  tablosu ve kalıcı silme uyarısı (DOM düğümü olarak kurulur, innerHTML yok); (4) onaylanırsa `saveData` tek yoldan yazar
  (şema muhafızı dahil; eski b3 kayıtları için göçteki `b3Legacy` gevşekliği); başarısızsa `window.data` eski hâline
  döner ve hata mesajı gösterilir.
- Geri yükleme Firebase admin oturumu ister (`requireDbAdmin`).
- VIP panelinde snapshot düğmesinin yanına çalışma zamanında **"Yedekten Geri Yükle"** düğmesi eklenir (admin.html'e
  işaretleme eklenmedi).

## 5. VIP Sağlık Döngüsü (VIP-08)
`_initVipPanel` 1 sn'lik `setInterval`'i (bellek okuma + DOM yazımı) bir kez başlatıyor ve sayfa kapanana kadar
durdurmuyordu — VIP sekmesinden çıkılsa, tarayıcı sekmesi arka plana alınsa da. Artık döngü yalnız **#systemControlTab
görünür VE sayfa ön plandayken** çalışır:
- Sekmeden çıkınca `AdminTabs.onAny` kancasında `clearInterval`; geri dönünce yeniden başlar.
- `visibilitychange`: sayfa gizlenince durur, öne gelince tek tazeleme + yeniden başlatma.
- `_startHealthLoop` idempotent (ikinci interval açılmaz). Teşhis: `AppModules.VipHealth.{isRunning(), ticks()}`.

## Test Sonuçları (K3 bütünü)
| Suite | Sonuç |
|---|---|
| `npm run test:unit` | ✅ 28/28 (yeni `tests/unit/backup.test.mjs`: 6 test — biçim, eski biçimler, geçersiz girdi, ortam denetimi, önizleme sayıları) |
| `npm run test:rules` | ✅ 72/72 |
| `flow-tests.js --emu` (49 senaryo, yeni: `k3BackupAndVipLoop`) | ✅ 49/49, exit 0, 0 sayfa hatası, 0 CSP ihlali |
| `npm run lint:xss` | ✅ 0 izinsiz sink |

`k3BackupAndVipLoop` iki sayfada aynı biçimi; farklı ortam yedeğinin onay sorulmadan reddedildiğini; vazgeçince hiçbir
şey yazılmadığını; onayda tek `saveData` çağrısını; eski biçimde doğrulanmamış uyarısını; yazma başarısızlığında bellek
geri dönüşünü; admin olmayan oturumun engellendiğini ve VIP döngüsünün açılış → çıkış → dönüş → arka plan → ön plan
geçişlerinde doğru çalışıp durduğunu (sekme dışındayken 2 sn boyunca sıfır tik) doğrular.

## Sahibinin Doğrulama Adımları (motor ayağı)
1. VIP → "1-Tık DB Snapshot": inen dosyanın `"version": "3.2"` ve `"root"` alanı taşıdığını doğrulayın.
2. VIP → "Yedekten Geri Yükle" ile o dosyayı seçin: önizleme tablosunu görüp **Vazgeç**'e basın — hiçbir şey değişmemeli.
3. Dosyadaki `root` değerini elle başka bir köke değiştirip tekrar deneyin — "Farklı ortama geri yükleme engellendi" uyarısı.
4. VIP sekmesini açıp başka bir sekmeye geçin: Görev Yöneticisi / DevTools Performance'ta saniyelik işin durduğunu görün.

---

# K3 — Kapanış Öncesi Saha Talepleri (Tur K3.5)

K4 kapanışından önce sahada tespit edilen son kullanıcı/görsel pürüzleri giderir. Yeni bir faz açılmadı; bu bölüm
K3'ün devamıdır.

## 6. Mojibake / Türkçe Karakter Temizliği (VIP-09)
`admin-system-control.js` bir noktada iki AYRI eski kod sayfasıyla (Windows-1252 ve saf Latin-1/ISO-8859-1) bozulmuştu
— 191 satırda Türkçe harf, emoji ve bölüm ayracı (`═`/`─`) karakterleri "Ã§", "Ä±", "â€”", "ğŸ’¾" gibi okunamaz dizilere
dönüşmüştü. Düzeltme üç aşamalı yapıldı: (1) win1252 tersine çevirme ile güvenli şekilde kurtarılabilen 131 satır
otomatik düzeltildi — yalnız dönüşüm sonrası hâlâ geçersiz/kontrol karakteri kalmayan satırlar kabul edildi, böylece
zaten doğru olan Türkçe harfler (Ö, Ü gibi) yanlışlıkla bozulmadı; (2) tekrar eden bölüm ayraçları (`═`, `─`) ayrı bir
geçişle, birim sayısı korunarak gerçek karakterlerle değiştirildi (win1252'nin bazı baytları atanmamış bıraktığı için
tek geçişte düzelmiyordu); (3) geri kalan ~16 satır (emoji + Türkçe harf karışımı, iki kodlamanın çakıştığı yerler) bu
dosyanın kendi içeriğinden (Sistem Terminali, Sağlık Monitörü, Debug Paneli, Platform & Donanım widget'ları) bilinen
doğru metinle elle değiştirildi. Dosya **UTF-8 (BOM'suz)** olarak kaydedildi ve doğrulandı; sözdizimi ve tüm akış/kural
testleri yeşil kalmaya devam ediyor (yalnız yorum/log metni değişti, hiçbir mantık dokunulmadı).

## 7. Sidebar Menü Sadeleştirmesi
"📄 Akış Şablonları" sidebar butonu kaldırıldı — aynı özellik zaten **Tanımlar > İş Akışı Şablonları** alt sekmesinde
(`switchDefTab('workflows')`, `renderTemplateList()`) mevcut; iki ayrı erişim yolu (ve iki ayrı tablo) kafa karıştırıyordu.
Yalnız sidebar köprüsü kaldırıldı; `workflowTemplatesTab` div'i ve `edm-workflow.js`'teki `AdminTabs.onShow` kancası
dokunulmadan bırakıldı (artık erişilemez ama zararsız — kapsam dışı bir yeniden yapılandırma gerektirmiyordu).

## 8. Operasyon Merkezi: Yeniden Adlandırma, Taşma ve Dark Mode Onarımı
- **Ad:** "Ürün Türü Ayarları" → **"Operasyon Merkezi"** (sidebar butonu, tab başlığı, bağlamsal ipucu metni) — tab'ın
  gerçek içeriği (ürün türü yönetimi + bekleyen talepler + çıkış analiz grafikleri) adın ima ettiğinden çok daha
  geniş olduğu için ad artık kapsamı yansıtıyor.
- **Taşma:** "📨 Bekleyen Envanter Talepleri" tablosu, global `table-layout: fixed` kuralı yüzünden dar ekranda İşlem
  sütunundaki iki sabit genişlikli ikon butonunu sıkıştırıp taşırıyordu. Bu tabloya ÖZEL `table-layout: auto` (sütunlar
  içeriğe göre genişler) + İşlem başlığına `min-width: 92px` eklendi; buton grubu artık `flex-wrap: wrap` ile çok dar
  genişlikte taşmak yerine alt alta diziliyor. `table-responsive` sarmalayıcı hâlâ son çare olarak duruyor.
- **Dark mode:** Personel ve Ürün hücrelerindeki satır içi sabit koyu renkler (`#1e293b`, `#0f172a`) proje genelinde
  zaten kullanılan `var(--color-text)`/`var(--color-text-muted)` değişkenleriyle değiştirildi — dark temada artık
  doğru kontrastla (açık renk) gösteriliyor; `dark-theme.css` bu değişkenleri zaten tanımlıyordu, yeni bir kural
  eklemeye gerek kalmadı.

## 9. Gelecek Widget Yer Tutucuları
Operasyon Merkezi'ne, ileride gerçek verilerle dolacak 3 placeholder kart eklendi: **"Yakında: Aktif Zimmet & İade
Takibi"**, **"Yakında: Hurda & Servis Radarı"**, **"Yakında: Kritik Sipariş İhtiyacı"**. Grid'e uyumlu (`flex-wrap`),
pulse (ikon etrafında genişleyen halka) ve glow (üst gradyan parıltısı) animasyonlu; stil tamamen `admin.html`'e gömülü
tek bir `<style>` bloğunda (`future-widget-*` sınıfları) — paylaşılan `style.css`/`admin-add-style.css` dosyalarına
dokunulmadı. `[data-theme="dark"]` için ayrı arka plan/kenarlık tanımlı.

## Test Sonuçları (K3.5)
| Suite | Sonuç |
|---|---|
| `npm run test:unit` | ✅ 28/28 (değişmedi — bu tur yalnız metin/görsel) |
| `npm run test:rules` | ✅ 72/72 |
| `flow-tests.js --emu` (49 senaryo) | ✅ 49/49, exit 0, 0 sayfa hatası, 0 CSP ihlali (sidebar/tab değişiklikleri
  `k3AdminTabHooks`'u kırmadı — o senaryo `showAdminTab()`'ı programatik çağırıyor, kaldırılan butona tıklamıyor) |
| `npm run lint:xss` | ✅ 0 izinsiz sink (41 dosya, 194 sink — yeni placeholder kartları dahil) |

## Sahibinin Doğrulama Adımları (K3.5)
1. Admin panelini açın: sidebar'da artık ayrı bir "Akış Şablonları" butonu yok; "🎛️ Operasyon Merkezi" butonuna basın.
2. Operasyon Merkezi'nde "📨 Bekleyen Envanter Talepleri" tablosunu dar bir pencere genişliğinde (ör. tarayıcıyı
   küçültüp) kontrol edin — Onayla/Reddet butonları artık taşmıyor.
3. Koyu temaya geçin: Personel ve Ürün hücrelerindeki metnin artık okunaklı (açık renk) olduğunu doğrulayın.
4. Operasyon Merkezi'nin altında 3 "Yakında" kartını görün; hafif pulse/glow animasyonlarını gözlemleyin.
5. VIP panelindeki Sistem Terminali, Sağlık Monitörü, Debug Paneli ve Platform & Donanım widget'larında artık hiçbir
   bozuk karakter ("Ã§" vb.) kalmadığını doğrulayın.
