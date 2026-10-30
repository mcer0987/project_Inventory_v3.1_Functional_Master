# Denetim Sonrası Aşama 2 — Transaction ile Stok ve Kapasite Servisi Raporu

**Tarih:** 28 Ekim 2026
**Dal:** `feat/phase-7-logging-and-ux` (yerel; commit ve deploy YOK)
**Kaynak:** [Proje v3.3 için Denetim Raporu](../v3.3%20Sessional%20Phases/Proje%20v3.3%20i%C3%A7in%20Denetim%20Raporu.md) — Aşama 2 ve Aşama 3'ün kural kısmı
**Önceki:** [Aşama 1 — Yazma Haritası ve Raf Sözleşmesi](./DENET%C4%B0M%20SONRASI%20A%C5%9EAMA%201%20-%20YAZMA%20HAR%C4%B0TASI%20VE%20RAF%20S%C3%96ZLE%C5%9EMES%C4%B0%20RAPORU.md)
**Mimari kısıt:** Firebase Spark planı — Cloud Functions YOK. Çözüm: Firestore Client SDK `runTransaction` + `firestore.rules`.

## 1. Özet

| Bulgu | Durum | Nasıl |
|---|---|---|
| **P1-01** İç transfer kör batch | **Kapandı (transfer yolu için)** | Kaynak stok transaction içinde taze okunur; `operationId` ile mükerrerlik koruması |
| **P1-02** Zorunlu kapasite yok | **Kısmen** | Ortak raf kataloğu (Firestore), transaction içinde kapasite reddi, kurallarda sayaç ve kapasite sınırı. Diğer yazma yolları henüz deftere geçmedi (§6). |
| Yan hata: `bulkDelete` b1 `status` | Kapandı | b1'e yalnız `durumu` yazılır; kural da b1'e `status` eklemeyi reddeder |
| Yan hata: `toggleWatch` `isWatched` | Kapandı | `isWatched` isteğe bağlı kanonik alan (update izinli, boolean) |

## 2. Transaction motoru — `src/services/stock-ledger.js`

`atomic-writer.js` ile aynı desen: SDK fonksiyonları bağımlılık olarak verilir. Tarayıcıda `firebase-handler.js` CDN
modülünü, emülatör testinde npm `firebase` paketini kullanır; kod aynıdır.

**Transfer (`runTransfer`) — tek `runTransaction`:**

1. **Okuma** (hepsi yazmalardan önce):
   - `stockOperations/{operationId}`: kayıt varsa önceki sonuç döner, stoğa dokunulmaz.
   - Kaynak ürün (**taze adet**).
   - Tam taşımada hedef depoda aynı kimlik.
   - Kaynak ve hedef raf belgeleri.
2. **Plan** (`planTransfer`, saf fonksiyon, birim testli):
   - Adet yeterliliği.
   - Hedef kaydın yalnız kanonik alanlarla kurulması (`validateB1`/`validateB2`).
   - Slot farkları (`Schema.isSlotOccupying`).
3. **Red durumları** (hiçbir şey yazılmaz):
   - `shelf-missing`: hedef raf katalogda yok.
   - `shelf-inactive`: hedef raf pasif.
   - `shelf-full`: `usedSlots + 1 > capacity`.
   - `insufficient-stock`, `not-found`, `conflict` (hedefte aynı kimlik var), `operation-conflict` (aynı `operationId` ile farklı istek).
4. **Yazma:** ürün(ler), raf sayaçları ve değiştirilemez işlem kaydı **aynı commit'te**. Eşzamanlı bir yazma okunan
   belgeyi değiştirirse Firestore transaction'ı taze veriyle yeniden dener.

**Slot etkisi:**

| Durum | Kaynak raf | Hedef raf |
|---|---|---|
| Tam depo transferi | −1 | +1 |
| Kısmi transfer (kaynak pozitif kalır) | 0 | +1 (yeni kayıt) |
| Aynı depoda başka rafa tam taşıma (kimlik korunur) | −1 | +1 |
| Pasif / stok dışı ürün | 0 | 0 |

**Geçiş dönemi kuralları:**
- Kaynak raf katalogda yoksa sayaç düşümü atlanır.
- Sayaç 0'ın altına inmez.
- Doluluğu azaltan işlem engellenmez (denetim raporu Aşama 6.6).
- Kısmi taşımadaki yeni kayıt kimliği transaction'dan önce bir kez üretilir; yeniden denemelerde değişmez.

**Raf kaydetme (`saveShelf`):**
- Raf yoksa güncel kullanım depo koleksiyonundan **sunucudan taze** sayılır (`getDocsFromServer`). İstemci SDK'sı
  transaction içinde sorgu çalıştıramadığı için bu sayım transaction dışındadır.
- Kayıt transaction ile oluşturulur ya da güncellenir.
- Kapasite güncel kullanımın altına inemez.

## 3. İstemci entegrasyonu

| Dosya | Değişiklik |
|---|---|
| `src/services/firebase-handler.js` | `runStockTransferTransaction`, `saveShelfCapacity`. Ön denetimler: modül, oturum, admin, toplu kilit. `LedgerError` → `SaveDataError` dönüşümü; commit sonrası yerel bellek. Yalnız yönetici oturumunda `shelves` dinleyicisi (`window.data.shelves`). `shelves` bilerek `COLLECTIONS` dışında: `saveData`, yedek ve geri yükleme sayaçlara dokunamaz. Update guard'ı `STOCK_OPTIONAL_KEYS`'e izin verir ve tip denetimi yapar. |
| `src/ui/ui-components.js` | `confirmTransfer` iç transfer dalı yeni yola bağlandı. Modal her açıldığında yeni `operationId` üretilir; tekrar gönderimde aynısı kullanılır. Çift tıklama ve Enter kilidi var. Başarı mesajı yalnız commit'ten sonra; tekrar ise "daha önce tamamlanmıştı" der. İstemci tarafı kapasite ön kontrolü kaldırıldı; karar transaction'da. Eski `applyItemOps` kuyruğu kaldırıldı. |
| `src/utils/shelf-capacity.js` | Kapasite karar sırası: Firestore raf belgesi → (geçiş) localStorage → 5. `shelfDoc()`; `slotStats` artık `registered`, `counted` ve `active` alanlarını da döner. |
| `src/modules/admin/shelf-matrix.js` | WMS kapasite diyaloğu `saveShelfCapacity`'ye yazar (localStorage'a değil); çift gönderim kilidi var. `shelves` değişince WMS yeniden çizilir. |
| `src/utils/schema.js` | `STOCK_OPTIONAL_KEYS = ['isWatched']`, `isWatched` boolean denetimi. |
| `src/modules/inventory-logic.js` | `bulkDelete`: b1 → `{durumu}`, b2 → `{durumu, status}`. |
| `admin.html`, `index.html` | `src/services/stock-ledger.js` script etiketi (`atomic-writer.js`'ten sonra). |

## 4. Güvenlik kuralları — `firestore.rules`

**`${root}/shelves/items/{shelfId}`**
- **Okuma:** `member(root)`, yani yönetici ve bağlı personel.
  - **Bilinçli sapma:** brif `signedIn()` diyordu. İstemciden hesap açma açıkken bu, personele bağlı olmayan her hesaba okuma
    verirdi (KVKK Ek D ilkesi). Bu yüzden daha dar tutuldu; testlerde doğrulandı.
- **Yazma:** yalnız `isAdmin()`.
- **Şema:** `SHELF_KEYS` tam ve fazlasız. Ek koşullar:
  - Kimlik: `shelfId == depot + '_' + code`.
  - Kanonik kod deseni.
  - Kapasite 1–200; `usedSlots` ≥ 0 tam sayı.
  - `updatedAt == request.time`; `updatedBy == request.auth.uid`.
- **Güncelleme:**
  - Kod ve depo değişmez.
  - **Slot artışı kapasiteyi aşamaz**; azalış serbesttir.
  - **Kapasite kullanımın altına inemez.**
- **Silme:** yalnız `usedSlots == 0` iken.

**`${root}/stockOperations/items/{operationId}`**
- Okuma yalnız admin.
- Yalnız `create`; `update` ve `delete` her zaman reddedilir. Aynı kimliğe ikinci yazma bir update olduğu için reddedilir.
- Katı şema.
- **`getAfter` çapraz denetimi:** commit sonrası hedef kaydın adedi `qty` olmalı. Kaynak kayıt tam taşımada silinmiş,
  kısmi taşımada `stockAfter` adetli olmalı. Sahte "transfer oldu" kaydı yazılamaz.

**b1/b2 sıkılaştırması (admin yazmaları dahil)**
- Yeni eski alan **eklenemez**; örneğin b1'e `status`. Göç edilmemiş belgede zaten var olan eski alan değişebilir.
- `adet` yazılıyorsa ≥ 0 tam sayı olmalı.
- **Geri yükleme kilidi (`restoreLock`) varken muaf:** atomic-writer geri alması belgelerin eski biçimli önceki hâlini
  yazabilmeli; yoksa geri alma takılırdı.
- Kilit okuması yalnız sözleşme tutmazsa yapılır (`||` kısa devre); olağan yazmada ek okuma maliyeti yok.

## 5. Doğrulama

| Paket | Sonuç | Kapsam |
|---|---|---|
| `npm run test:unit` | **165/165** | 16 planlayıcı testi (`stock-ledger.test.mjs`) + raf sözleşmesi / katalog önceliği / `isWatched` |
| `npm run test:ledger:emu` (yeni) | **13/13** | Gerçek `runTransaction` + üretim kuralları, aşağıdaki tablo |
| `npm run test:rules` | **218/218** | 213 mevcut + 5 yeni (personel okur/yazamaz, bağsız hesap okuyamaz, defter yalnız admin, `knownCol` dışı) |
| `test:atomic:emu` / `test:ownership:emu` / `test:staff:emu` | **5/5 · 22/22 · 15/15** | b1/b2 kural sıkılaştırması mevcut yolları bozmadı |
| Tarayıcı akışları (emülatör) | **47/50 geçti; kalan 3 bu paketten bağımsız** | §5.1 |
| `lint:xss` | 49 dosya, 885 ifade, 0 izinsiz | — |
| `node --check`, `git diff --check` | Temiz | — |

**`test:ledger:emu` kabul senaryoları:**

| Denetim raporu §7 ölçütü | Test | Sonuç |
|---|---|---|
| Eşzamanlı kaynak transferi | İki istemci, 6+6 > 10 | Biri `insufficient-stock`; toplam 10 korunur, eksi yok |
| Son boş slot için eşzamanlı yerleştirme | İki istemci, 4/5 dolu raf | Yalnız biri tamamlanır; `usedSlots = 5` |
| Aynı operationId ile tekrar | Aynı istek iki kez | İkinci `duplicate`; stok ve slot bir kez değişir |
| İşlem sırasında hata | Dolu / pasif / katalog dışı raf | Ürün, sayaç ve işlem kaydında kısmi sonuç yok |
| Doğrudan istemci yazması | Admin bile sayacı kapasite üstüne çıkaramaz | Kural reddeder; sahte işlem kaydı da reddedilir |

### 5.1 Tarayıcı akış testleri (scratch/flow-tests.js)

- `b1WriteContract` ve `b2WriteContract` iç transferi artık `runStockTransferTransaction` yakalayıcısıyla sürer. Yakalayıcı
  **gerçek planlayıcıyı** çalıştırır, bu yüzden tam/kısmi taşıma sözleşme denetimleri aynen geçerli.
- `idBasedProductOps` çağrıyı ve `operationId`'yi kaydeder.
- Bu iki senaryo, ağaçtaki commit edilmemiş WMS çalışmasıyla gelen "Hedef raf seçiniz" denetimi yüzünden **bu paketten önce
  de başarısızdı**. Test, raf seçeneğini listede değilse ekleyecek şekilde düzeltildi.
- Tam koşu (emülatör): 50 senaryo çalıştı; 47 geçti. Kalan 3 hata: `j3SessionVisa`, `j4SelfApproval`
  (navigasyon zaman aşımı) ve `j6PostLogoutRelogin` (`adminForceLogout is not a function`).
  - **A/B ile ayrıştırıldı:** bu paketin sayfa yüklenişindeki iki etkisi (script etiketi ve `shelves` dinleyicisi) geçici
    olarak kapatılınca da aynı üçü aynı hatayla düştü.
  - Hatalar ağaçtaki commit edilmemiş oturum/kimlik değişikliklerinden geliyor; bu paketin kapsamı dışında.
  - j6 sonrası test koşucusu puppeteer navigasyon hatasıyla durdu; kalan 6 senaryo çalışmadı.

## 6. Açık kalanlar ve sınırlar (dürüst not)

1. **Devreye almadan önce raf kataloğu doldurulmalı.** İç transfer artık hedef raf katalogda değilse reddedilir
   (`shelf-missing`, fail-closed). Canlıda ilk transferden önce hedef raflar için WMS'ten kapasite kaydedilmeli ya da
   Aşama 6 toplu katalog başlatma yapılmalı.
2. **Sayaçlar henüz tek kaynak değil.** Aşama 1 envanterindeki diğer yollar raf sayacını güncellemiyor:
   - `saveProduct` (yeni ve düzenleme), FAB ±1, WMS raf taşıma, `importExcel`, zimmet iadesi, servis dönüşü, geri yükleme.
   - Bu yollar ürünü rafa koyup sayacı artırmadığı için sayaç gerçek kullanımın altında kalabilir; transfer o durumda
     kapasiteyi aşabilir.
   - **Aşama 3 devamı:** bu yollar stok defterine taşınmalı. **Aşama 6:** sayaçlar uzlaştırılmalı.
3. **Kuralların sınırı (Spark planı, tek yönetici kimliği):** kurallar her b1/b2 değişiminin raf sayacıyla aynı commit'te
   yapıldığını zorlayamaz. Bunun için bütün yollar deftere geçtikten sonra `getAfter` tabanlı bir bağ değerlendirilebilir.
   Raf belgesine yeni bir alan gerekeceği için şema kararı ister.
4. **WMS hızlı raf taşıma** (`moveProductToShelf`) hâlâ eski `updateItem` yolunda. Motor aynı depoda raf taşımayı zaten
   destekliyor; Aşama 4'te bağlanacak.
5. **Ek davranış değişikliği:** b1/b2 update guard'ı artık alan adına ek olarak **tip** de denetler (ör. eksi adet, boş
   ürün adı istemcide reddedilir). Kural tarafındaki adet denetimiyle tutarlıdır.
6. **Deploy sırası:** yeni istemci `shelves` ve `stockOperations` kurallarına muhtaçtır; kurallar istemciyle birlikte
   ya da önce yayınlanmalı. Eski istemci yeni kurallarla çalışmaya devam eder.
7. **`scratch/hosting-files.js`:** `EXPECTED_COUNT` güncel değil. Bu pakette `src/services/stock-ledger.js` eklendi; ağaçtaki
   diğer commit edilmemiş dosyalar (`manifest.json`, `shelf-matrix.css` vb.) zaten denetimi düşürüyor. Deploy öncesi
   sayı bilinçli güncellenmeli.

## 7. Değişen / eklenen dosyalar

- **Yeni:** `src/services/stock-ledger.js`, `tests/unit/stock-ledger.test.mjs`, `tests/integration/stock-ledger.emu.test.mjs`
- **Değişen:**
  - Uygulama: `src/services/firebase-handler.js`, `src/ui/ui-components.js`, `src/utils/shelf-capacity.js`,
    `src/utils/schema.js`, `src/modules/inventory-logic.js`, `src/modules/admin/shelf-matrix.js`, `admin.html`, `index.html`
  - Kurallar: `firestore.rules`
  - Test: `tests/rules/rules.test.mjs`, `tests/unit/shelf-contract.test.mjs`, `scratch/flow-tests.js`
  - Yapılandırma: `package.json` (`test:ledger:emu`)
