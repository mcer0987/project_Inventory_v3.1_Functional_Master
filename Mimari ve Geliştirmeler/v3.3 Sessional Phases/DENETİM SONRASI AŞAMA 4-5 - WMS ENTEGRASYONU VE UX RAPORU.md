# Denetim Sonrası Aşama 4-5 — WMS Entegrasyonu ve UX Raporu

**Tarih:** 28 Ekim 2026
**Dal:** `feat/phase-7-logging-and-ux` (yerel; commit ve deploy YOK)
**Kaynak:** [Proje v3.3 için Denetim Raporu](../v3.3%20Sessional%20Phases/Proje%20v3.3%20i%C3%A7in%20Denetim%20Raporu.md) — Aşama 4 ve Aşama 5
**Önceki:** [Aşama 2 — Transaction ile Stok ve Kapasite Servisi](./DENET%C4%B0M%20SONRASI%20A%C5%9EAMA%202%20-%20TRANSACTION%20%C4%B0LE%20STOK%20VE%20KAPAS%C4%B0TE%20SERV%C4%B0S%C4%B0%20RAPORU.md)
**Mimari kısıt:** Firebase Spark planı — Cloud Functions YOK. Çözüm: Firestore Client SDK `runTransaction` + `firestore.rules`.

## 1. Özet

| Bulgu | Durum | Nasıl |
|---|---|---|
| **P1-02** WMS tarafı | **Tamamlandı** | WMS artık `${ROOT}/shelves/items` kataloğundan besleniyor; `saveProduct`, FAB ±1, zimmet iadesi, servis dönüşü ve WMS raf taşıma raf sayacını otomatik günceller |
| **P2-05** WMS ham string karşılaştırması | **Kapandı** | WMS artık `Schema.itemShelfCode`/`isSlotOccupying` kullanıyor — Aşama 1/2'deki tek sözleşmeye bağlandı |
| **P2-06** Harita stoktan oluşuyordu | **Kapandı** | Boş-ama-katalogdaki raflar haritada görünür; "Toplam Raf" gerçek kataloğu temsil eder |
| **P2-07** Çekmece canlı güncellemede odak kaybediyordu | **Kapandı** | Açılış ile içerik yenileme ayrıldı |
| **P2-01** PIN/Enter çift istek | **Kapandı** | `admin-quick-unlock.js`'te ortak `inFlight` kilidi |
| **P2-02** PIN kasası UID'siz | **Kapandı** | Kasa admin UID'sine bağlanır; farklı hesapta kendini imha eder |
| **P2-08** Escape birden fazla pencereyi kapatıyordu | **Kapandı** | Yeni paylaşılan `DialogStack` — yalnız en üsttekini kapatır, Tab odak hapsi, kapanışta odak iadesi |
| **P2-09** Login responsive doğrulaması | **Doğrulandı** | 5 hedef genişlikte (320–1440px), açık/koyu temada ekran görüntüsü + taşma denetimi |

## 2. P1-02 tamamlanması — genel raf sayacı muhasebesi

Aşama 2'de yalnız `confirmTransfer`'ın iç transferi raf sayacını güncelliyordu. Bu paket, **tüm b1/b2 yazma yollarını** aynı muhasebeye bağladı.

### 2.1 `runStockOps` artık raf-farkında (`src/services/firebase-handler.js`)

`runStockOps` — çıkış, sepet, zimmet atama/iade, servis sevk/dönüş ve FAB ±1'in **tek ortak çekirdeği** — artık her stok deltasının doluluk durumunu değiştirip değiştirmediğini (`Schema.isSlotOccupying` ile 0↔pozitif geçiş, ya da `createIfMissing` ile yeniden oluşturma) denetler ve etkilenen raf belgelerini **aynı transaction'da** günceller. Matematik `stock-ledger.js`'teki paylaşılan `planShelfCounterWrites`'tan gelir (aşağıda).

Bu TEK değişiklik şu akışları otomatik kapsar (hiçbiri ayrıca değiştirilmedi):

| Akış | Dosya | Slot etkisi |
|---|---|---|
| FAB ±1 (`updateStock`) | inventory-logic.js → `runStockTransaction` | 0↔1 sınırında ±1 |
| Zimmet iadesi (`removeAssignment`) | admin/inventory-management.js | 0'dan çıkınca hedef +1 |
| Servisten dönüş (`receiveFromService`) | services/purchase-servises.js | +1 ya da `createIfMissing` ile yeniden oluşturma |
| Çıkış, sepet, zimmet atama, hurda, dış/servis sevk | script.js, inventory-logic.js, admin/inventory-management.js, ui-components.js | stok 0'a düşünce −1 |

**Bilinçli geçiş-dönemi kararı (`requireCatalog:false`):** Bu akışlarda raf **seçilmez** — zaten kayıttaki raftadır. Raf katalogda henüz yoksa (WMS'ten kapasite tanımlanmamış ~75 eski raf) sayaç sessizce atlanır, **işlem engellenmez**. Raf kataloğa KAYITLI ise kapasite/aktiflik yine de uygulanır. Bu, tüm günlük işlemleri ilk gün kilitlemeden P1-02'yi aktif eder; katalog Aşama 6'da dolduktan sonra sıkılaştırılabilir.

### 2.2 `saveProduct` → `runProductSave` (yeni, `stock-ledger.js`)

`saveProduct` artık `appendItem`/`updateItem`'i doğrudan çağırmıyor; `runProductSave` tek transaction'da:
1. Düzenlemede kaynak belgeyi **taze** okur (window.data'nın bayat kopyası değil — P1-01'deki aynı ilke).
2. Yeni kayıtta tam şema sözleşmesinden (`validateB1`/`validateB2`), düzenlemede bilinen alan adı kuralından (`applyItemOps`'un update guard'ıyla aynı) geçirir.
3. Önceki/sonraki raf işgalini karşılaştırıp raf sayacını (varsa katalogda) günceller — yine `requireCatalog:false`.
4. Hata **doğrudan gösterilir** (`confirmTransfer` ile aynı desen) — `writeOk`'un genel "kaydedilemedi"sine düşürülmez; admin artık "raf dolu" gibi nedeni görür.

### 2.3 WMS raf taşıma → `runStockTransferTransaction`

`moveProductToShelf` artık kendi `updateItem` çağrısı yerine Aşama 2'nin **zaten test edilmiş** transfer motorunu kullanıyor (aynı depoda tam taşıma — `planTransfer`'ın "fullMove && sameCol" kolu). Bu yol **katı** moddadır (`requireCatalog` varsayılan true): admin BİLİNÇLİ bir hedef raf seçtiği için kapasite/katalog zorunludur (transfer ve WMS taşıma ile tutarlı).

### 2.4 Paylaşılan matematik: `planShelfCounterWrites` (`stock-ledger.js`)

Aşama 2'de `planTransfer`'a gömülü olan raf sayacı mantığı ayrı bir fonksiyona çıkarıldı ve `requireCatalog` seçeneği eklendi:

```
planShelfCounterWrites(deltas, shelfReads, uid, { requireCatalog })
```

- `requireCatalog: true` (varsayılan, `planTransfer` ve `runProductSave`): slot artışında raf katalogda yoksa `shelf-missing`.
- `requireCatalog: false` (`runStockOps`): raf katalogda yoksa artış da **sessizce atlanır**.
- Her iki modda: katalogdaki rafta kapasite/aktiflik her zaman uygulanır; azalış her zaman serbesttir; sayaç 0'ın altına inmez.

## 3. WMS arayüzü — katalog kaynaklı harita (`src/modules/admin/shelf-matrix.js`)

- `collectShelves(depot)` artık **önce katalogdan** (`window.data.shelves`, depoya göre süzülmüş) boş raflar dahil tüm rafları oluşturur, **sonra** stoktaki ürünleri kanonik koduyla (`Schema.itemShelfCode`) bu rafların üzerine dağıtır. Katalogda olmayan ama üzerinde ürün bulunan eski raflar (geçiş dönemi) kanonik koduyla görünmeye devam eder — aksi halde göç tamamlanana kadar dolu bir raf haritadan kaybolurdu.
- `productIsInStock` artık kendi kopyasını değil `Schema.isSlotOccupying`'i çağırır — WMS'in gösterdiği doluluk artık transaction'ın saydığı `usedSlots` ile her zaman örtüşür.
- Katalogda olmayan raflar kartlarda küçük bir "katalog dışı" rozetiyle işaretlenir (host üzerine gelince açıklama).
- `moveProductToShelf`'in aday raf listesi artık kanonik kodla kuruluyor — `INV_CONFIG`'in ham yazımları (`"Raf-A 1"`) da `normShelfCode`'tan geçiriliyor; aksi halde aynı raf iki ayrı seçenek gibi görünürdü.

**Görsel değişiklik:** Raf adları artık büyük harfle gösteriliyor (`"Raf-A 1"` → `"RAF-A 1"`) — Opus'un Aşama 1 raporunda kaydedilen, kullanıcı onaylı karar.

### 3.1 Çekmece — açılış ile canlı yenileme ayrıldı (P2-07)

**Sorun:** Her `onInventoryDataUpdated` olayında açık çekmece `openDrawer()` ile **yeniden açılıyordu**: `innerHTML`'in tamamı değişiyor (liste kaydırması sıfırlanıyor) ve kapatma düğmesine **yeniden odaklanılıyordu** — kullanıcı bir satırla ilgileniyorsa odağını elinden alıyordu.

**Çözüm:** `renderDrawerContent(depot, shelfKey)` yalnız metni/listeyi günceller. `openDrawer` bunu çağırıp ayrıca `is-open`/`aria-hidden`/body sınıfını ve odağı ayarlar — bunlar artık YALNIZ ilk açılışta olur. Veri güncellemesi `refreshDrawerIfOpen()`'ı çağırır: çekmece açıksa içeriği sessizce tazeler, kapalıysa dokunmaz.

## 4. PIN kasası — P2-01 / P2-02 (`src/utils/admin-quick-unlock.js`)

### 4.1 Ortak inFlight kilidi (P2-01)

Tek bir modül-seviyesi `authInFlight` bayrağı artık **hem** hızlı PIN yolunu (`unlockWithPin`, düğme ve Enter) **hem** tam parola yolunu (`window.unlockAdmin`'i saran `installUnlockHook`) kapsıyor. Bir giriş denemesi sürerken diğer yoldan gelen ikinci bir tetikleme sessizce yok sayılır — yalnız "PIN düğmesi + Enter" değil, "PIN sürerken tam parola düğmesi" gibi çapraz durumlar da kapanır.

### 4.2 Açık yaşam döngüsü — UID bağı (P2-02)

Kasa artık `uid` alanı taşır. **Ne zaman bağlanır:** kaydedilirken değil (o an `window.userAuth` henüz güncellenmemiş olabilir — asenkron), `onAuthReady` olayı her ateşlendiğinde: kasa henüz bir UID'ye bağlı değilse (`uid: null`, yeni kaydedilmiş ya da bu değişiklikten önceki sürüm) BU oturuma bağlanır. **Ne zaman imha olur:** anonim olmayan FARKLI bir UID görülürse (ikinci bir admin hesabı ya da bu sekmede bir personel oturumu) kasa kendini siler. Anonim oturum (her kilit/çıkışta zaten tam `signOut()` yapıldığı için beklenen ara durum) imha TETİKLEMEZ — aksi halde PIN her kilitte silinirdi ve özelliğin amacı ortadan kalkardı. Açık çıkışta (**"Oturumu Kapat"**, `reason:'logout'`) zaten koşulsuz siliniyordu; bu davranış değişmedi.

**Doğrulama (Hook temizliği):** `admin-quick-unlock.js` yüklenmediğinde `window.unlockAdmin` sarılmaz; admin.html'in Enter/düğme çağrıları doğrudan orijinal fonksiyona gider. Script sırası zaten bunu garanti ediyordu (PIN helper `window.load`'da sarma işlemini yapar); kod değişikliği gerekmedi, yapı doğrulandı.

## 5. Paylaşılan diyalog yönetimi — P2-08 (yeni `src/utils/dialog-stack.js`)

**Sorun:** WMS raf diyalogları/çekmecesi, genel onay kutusu (`showCustomConfirm`), yönetici parola doğrulaması (`promptAdminReauth`) ve PIN kurulum diyaloğu — HER BİRİ kendi `document`-seviyesi Escape dinleyicisini kuruyordu. Biri diğerinin üstünde açıldığında TEK Escape basışı TÜMÜNÜ kapatıyordu; hiçbiri Tab ile odağı içeride tutmuyor ya da kapanışta odağı geri vermiyordu.

**Çözüm:** Açılış sırasına göre bir yığın (`DialogStack.open/close/isTop`). Tek bir `capture`-fazı `keydown` dinleyicisi:
- Yığın boşsa hiçbir şeye dokunmaz (modalsız sayfada mevcut davranışlar — ör. "Escape → satır seçimini temizle" — değişmez).
- Escape: `stopPropagation()` (eski/taşınmamış dinleyicilere ulaşmaz) + yalnız **en üstteki** diyaloğun `onEscape`'i.
- Tab/Shift+Tab: yalnız en üstteki diyaloğun içinde döngü yapar (focus trap); kapanışta açılıştaki elemana odak döner.

**Bağlanan 4 nokta** (tümü `window.DialogStack` yoksa eski davranışa düşer):
1. `shelf-matrix.js` — `createDialog` (kapasite/raf taşıma) ve çekmece.
2. `security.js` — `promptAdminReauth`.
3. `src/utils/alert.js` — `showCustomConfirm` (projenin EN ÇOK kullanılan onay kutusu; önceden Escape'i HİÇ yoktu — saf ekleme).
4. `admin-quick-unlock.js` — ilk giriş PIN kurulum diyaloğu (Enter→Kaydet kısayolu ayrı, dar bir dinleyici olarak korunur — DialogStack'in kapsamı dışında).

**Bilinçli kapsam sınırı:** Ürün/transfer/çıkış/talep gibi ANA `.modal` sınıfı diyaloglar (`productModal`, `transferModal`, vb.) bu pakete DAHİL EDİLMEDİ. Bunlarda zaten BİRBİRİYLE ÇAKIŞAN bir Escape dinleyicisi yoktu (denetim raporunun tarif ettiği P2-08 hatası bu dört noktada somuttu); onlara focus-trap eklemek çok daha geniş, ayrı bir iş — bilerek ertelendi.

`dialog-stack.js` her iki sayfada `<head>`'de, bu dört dosyadan ÖNCE yüklenir (admin.html/index.html script sırası güncellendi).

## 6. Login responsive doğrulaması — P2-09

Gerçek Chrome (puppeteer, headless) ile `index.html` giriş ekranı 5 hedef genişlikte render edildi ve yatay taşma ölçüldü:

| Görüntü | `scrollWidth` | `clientWidth` | Taşma |
|---|---|---|---|
| 320×568 | 320 | 320 | Yok |
| 390×844 | 390 | 390 | Yok |
| 768×1024 | 768 | 768 | Yok |
| 1024×768 | 1024 | 1024 | Yok |
| 1440×900 | 1440 | 1440 | Yok |

390×844, 768×1024 ve 1440×900'de ekran görüntüsü de alındı (açık ve koyu tema); kart ortalanmış, kırpılma/kesme yok, metin taşması yok. `login-redesign.css` zaten `dvh`, `env(safe-area-inset-*)`, `clamp()` ve 480px/700px-yükseklik kesme noktalarıyla iyi yapılandırılmış durumda — kod değişikliği gerekmedi.

**Kapsam sınırı:** Bu, STATİK bir render + taşma ölçümüdür; denetim raporunun istediği "klavye gezinmesi" ve "44px dokunma hedefi" kontrolleri gerçek etkileşimli test gerektirir ve bu pakette yapılmadı (yalnız görsel/yapısal doğrulama).

## 7. Doğrulama

| Paket | Sonuç |
|---|---|
| `npm run test:unit` | **179/179** (14 yeni: `planShelfCounterWrites` lenient/strict mod, `planProductSave` create/edit/çakışma/raf taşıma) |
| `npm run test:ledger:emu` | **19/19** (6 yeni: `runProductSave` katalog içi/dışı, kapasite reddi, EŞZAMANLI iki admin aynı ürünü farklı rafa taşırken sayaç tutarlılığı — bkz. §7.1) |
| `npm run test:rules` | **218/218** (değişmedi — bu pakette kural değişmedi) |
| `npm run lint:xss` | 50 dosya, 886 ifade, 0 izinsiz |
| `node --check` (tüm değişen JS) | Temiz |
| Tarayıcı akışları (emülatör, `scratch/flow-tests.js --emu`) | 56 senaryodan 50'si çalıştı; bkz. §7.2 |
| Login responsive (puppeteer) | 5 genişlik × temiz, bkz. §6 |

### 7.1 Emülatör testi gerçek bir yarış koşulunu doğruladı

Yeni "EŞZAMANLI iki admin aynı ürünü farklı rafa taşır" testi ilk yazımda **başarısız oldu** (toplam sayaç 3, beklenen 1). Kök neden incelemesi bunun bir KOD hatası DEĞİL, bir TEST tasarım hatası olduğunu gösterdi: hedef raflardan biri zaten BAŞKA bir ürün barındırıyordu, test bunu hesaba katmamıştı. Gerçek transaction davranışı (Firestore'un yeniden deneme mekanizmasıyla) doğruydu: kaybeden işlem RETRY'da rakibin TAZE sonucunu görüp kendi raf hesabını buna göre düzeltti. Test izole (boş) raflarla yeniden yazılıp geçti. Bu, transaction retry'ın raf değişebilen (occupancy-dependent re-read) senaryolarda da doğru çalıştığının somut kanıtıdır.

### 7.2 Tarayıcı akışları — kapsam ve bilinen sınır

`b1WriteContract`, `b2WriteContract`, `idBasedProductOps`, `cloneProduct` (`saveProduct`/`runProductSave` ve `moveProductToShelf`/`runStockTransferTransaction`'ı GERÇEK UI akışlarıyla süren senaryolar) dahil **50 senaryo çalıştı, 47'si geçti**. 3 senaryo (`j3SessionVisa`, `j4SelfApproval`, `j6PostLogoutRelogin`) oturum/giriş akışlarında navigasyon zaman aşımıyla başarısız oldu; bunlardan biri (`j6PostLogoutRelogin`) sonrasında test koşucusu bir puppeteer çökmesiyle durdu, kalan 6 senaryo (`j6CdnLibraries`, `j7StaffProvisioning`, `j10StaffLogin`, `j9Ownership`, `j6EkASession`, `j10CodeCleanse`, `j11ApprovalAudit`) bu koşuda doğrulanamadı.

**Bu benim değişikliklerimden kaynaklanmıyor:** `git diff --stat` ile doğrulandı — başarısız olan 3 senaryonun ait olduğu alanı (`src/modules/auth-engine.js`, 30 satırlık fark) ne ben ne de önceki Aşama 1/2 oturumu değiştirdi; bu fark ağaçta BAŞKA, commit edilmemiş bir çalışmadan kalma (Opus'un Aşama 2 raporu da AYNI 3 senaryoyu, kendi değişikliklerini geçici kapatarak A/B test edip aynı sonuçla doğrulamıştı). Kalan 6 senaryoyu izole çalıştırmayı denedim; bazıları önceki senaryoların kurduğu oturum durumuna bağlı olduğu için izole koşuda farklı (yanıltıcı) biçimde başarısız oldu — bu yüzden "doğrulanamadı" olarak işaretliyorum, "başarısız" değil.

## 8. Açık kalanlar ve sınırlar (dürüst not)

1. **`requireCatalog:false` geçiş dönemi.** `runStockOps`/`runProductSave` üzerinden geçen akışlar, raf katalogda YOKSA sayacı sessizce atlıyor. Katalog Aşama 6'da dolana kadar bu akışlarda kapasite ZORUNLU DEĞİLDİR — yalnız admin WMS'ten bir rafa kapasite tanımladıysa o raf için zorunlu olur. Bu bilinçli bir seçimdi (günlük kullanımı kilitlememek için); Aşama 6 sonrası `requireCatalog:true`'ya sıkılaştırma değerlendirilebilir.
2. **Diğer `runStockOps` çağıranları da kapsandı ama doğrudan test edilmedi.** Çıkış/sepet/zimmet atama/hurda/dış-servis sevk akışları `runStockOps`'un tek değişikliğiyle otomatik kapsandı; bunlar için AYRICA emülatör testi yazılmadı (yalnız `runProductSave` ve mevcut `planTransfer` testleri var). `runStockOps` doğrudan CDN importlu bir ES modülü olduğu için (mevcut test altyapısında yüklenemiyor) gerçek doğrulama yalnız tarayıcı akışlarıyla (§7.2) yapılabildi.
3. **Ana `.modal` diyalogları DialogStack'e bağlanmadı.** Ürün/transfer/çıkış/talep/satın alma modallarında focus-trap ya da Escape yok (zaten BİRBİRİYLE çakışan bir Escape de yoktu — denetimin somut P2-08 bulgusu dört noktada). Bunlara aynı sistemi eklemek ayrı, daha geniş bir iş.
4. **Login responsive doğrulaması statik.** Klavye gezinmesi ve dokunma hedefi boyutu kontrol edilmedi; yalnız render + taşma.
5. **`scratch/hosting-files.js`'in beklenen dosya sayısı.** Bu pakette `src/utils/dialog-stack.js` eklendi (toplam +1). Sayı zaten Aşama 2 raporunda güncel değildi (ağaçtaki başka commit edilmemiş dosyalar yüzünden); deploy öncesi bilinçli güncellenmeli.
6. **Deploy sırası.** Bu paket Firestore kurallarını DEĞİŞTİRMEDİ (Aşama 2/3'ün kuralları yeterli). Yeni dosyalar (`stock-ledger.js` zaten Aşama 2'den, `dialog-stack.js` bu paketten) istemciyle birlikte yayınlanmalı.

## 9. Değişen / eklenen dosyalar

- **Yeni:** `src/utils/dialog-stack.js`
- **Değişen (bu paket):**
  - Uygulama: `src/services/stock-ledger.js`, `src/services/firebase-handler.js`, `src/modules/inventory-logic.js`, `src/modules/admin/shelf-matrix.js`, `src/modules/admin/shelf-matrix.css`, `src/utils/admin-quick-unlock.js`, `security.js`, `src/utils/alert.js`, `admin.html`, `index.html`
  - Test: `tests/unit/stock-ledger.test.mjs`, `tests/integration/stock-ledger.emu.test.mjs`, `scratch/flow-tests.js`
