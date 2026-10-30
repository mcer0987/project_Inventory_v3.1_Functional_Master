# Denetim Sonrası Aşama 1 — Yazma Haritası ve Raf Sözleşmesi Raporu

**Tarih:** 28 Ekim 2026
**Dal:** `feat/phase-7-logging-and-ux` (yerel; commit/deploy yok)
**Kaynak:** [Proje v3.3 için Denetim Raporu](../v3.3%20Sessional%20Phases/Proje%20v3.3%20i%C3%A7in%20Denetim%20Raporu.md) — Aşama 0 ve Aşama 1
**Bulgular:** P1-02 (temel), P2-05 (sözleşme tarafı). P1-01 bu pakette çözülmedi (Aşama 2).
**Mimari kısıt:** Firebase Spark planı — Cloud Functions YOK. Bütün çözüm Firestore Client SDK (`runTransaction`) ve
`firestore.rules` ile kurulur. Denetim raporundaki "Callable Function" önerisi bu projede uygulanmaz.

## 1. Aşama 0 — B1/B2 yazma yolları envanteri

Low-level yazma API'leri `src/services/firebase-handler.js` içindedir. b1/b2 belgeleri `{ROOT}/{b1|b2}/items/{id}`
yolundadır (`_docRef`); `ROOT` localhost/demo'da `inventory_demo`, aksi halde `lifeserver_master`.

| API | Mekanizma | Transaction? |
|---|---|---|
| `saveData(col, arr)` | `_dbMirror` farkı, 490'lık `batch.set(merge)` parçaları; dizide olmayan belge silinir | Hayır |
| `applyItemOps(ops)` (+ `appendItem` / `updateItem` / `updateItems` / `removeItem` / `bulkRemove`) | Tek `writeBatch` (≤490) | Hayır — atomik ama kör |
| `runStockOps({stock, writes})` (+ `runExitTransaction`, `runStockTransaction`) | `runTransaction`; stok belgeleri tx içinde okunur, `planStockOps` + `computeStockPatch` | **Evet** |
| `restoreCollections`, `atomicInsertItems` | `AtomicWriter` (günlüklü batch'ler) | Hayır (günlüklü) |

### Kullanıcı akışları ve slot etkileri

| # | Yol | Yazma | Slot etkisi | Kapasite denetimi |
|---|---|---|---|---|
| 1 | `saveProduct` yeni (`inventory-logic.js`) | `appendItem` | hedef +1 | Yok (P2-04) |
| 2 | `saveProduct` düzenleme | `updateItem` (adet kör üzerine yazılır) | raf değişimi −1/+1; 0↔pozitif / aktif↔pasif ±1 | Yok |
| 3 | `updateStock` ±1 (FAB) | `runStockOps` | 0→1 ise +1 | Yok |
| 4–5 | `deleteItem`, `_bulkDeleteSelected` | `removeItem` / `bulkRemove` | −1 / −N | — |
| 6 | `bulkDelete` (toplu pasife al) | `updateItems` | −N | — |
| 9 | `saveExit` / `_performExit` | `runExitTransaction` | tükenirse −1 | — |
| 10 | `confirmTransfer` iç (`ui-components.js`) | `applyItemOps` (**P1-01**) | tam: −1/+1; kısmi: hedef +1 | Yalnız istemci |
| 11–12 | `confirmTransfer` servis / hurda | `runStockOps` | tükenirse −1 | — |
| 13 | WMS `moveProductToShelf` (`shelf-matrix.js`) | `updateItem` | −1/+1 | Yalnız istemci |
| 14, 15, 17 | `confirmRequest`, `saveCartExit`, `saveAssignment` | `runStockOps` | tükenirse −1 | — |
| 16 | `importExcel` (`script.js`) | `atomicInsertItems` | +N | Yok |
| 18 | `removeAssignment` (zimmet iadesi) | `runStockOps` | 0'dan çıkarsa +1 | Yok |
| 19 | `_saveQuickProduct` | `appendItem` (`raf: ''`) | rafsız | Aşama 6 politikası |
| 20 | `receiveFromService` (`purchase-servises.js`) | `runStockOps` + `createIfMissing` | +1 veya eski rafla yeniden oluşturma | Yok; yeniden oluşturulan kayıt şemadan geçmez |
| 21 | `deleteCriticalGroup` | `applyItemOps` | −N | — |
| 22 | `syncProductTypesToProducts` | `saveData` | 0 | — |
| 24 | `vipCleanDuplicates` | **Doğrudan SDK `writeBatch`**; bakım/kilit atlanır | −N | — |
| 25 | `restoreFromText` | `restoreCollections` | keyfi ± | Yok |
| 26 | `migrateDataFromOldToNew` (konsol) | Doğrudan SDK, şemasız | keyfi ± | Yok |

Satın alma "teslim alındı" → stok artışı yolu yoktur (`receiveProduct` yalnız `requests` günceller).

**Kurallar (Aşama 0 itibarıyla):** b1/b2 için yalnız `isAdmin()` (sabit e-posta + parola sağlayıcısı); şema, adet veya
kapasite denetimi yok.

**Aşama 3'te kapatılacak yollar:** 1, 2, 3, 10, 13, 16, 18, 20, 25, 26 ve 24'teki doğrudan SDK yolu.

### Envanterde bulunan yan hatalar

1. **`bulkDelete` b1'de her zaman başarısız:** b1 kaydına `status` (b1 için eski alan) yazıyor; şema guard'ı reddediyor.
2. **`toggleWatch` çalışmıyor:** `isWatched` alanı B1/B2 update sözleşmesinde yok → "bilinmeyen alan".
3. **Ürün düzenleme rafı siliyor:** Ürün modalının raf `<select>`'i yalnız `INV_CONFIG` raflarını listeler; kaydın rafı
   listede yoksa değer `''` kalır ve `saveProduct` `raf: ''` yazar (`ui-components.js` `setVal('prodShelf', …)`).

### Mevcut iki farklı "stokta" tanımı (P2-05)

- `shelf-capacity.js`: `durumu ?? status`, yalnız `trim`; `'-'` bir raf adı sayılır; büyük/küçük harf duyarlı.
- `shelf-matrix.js`: boş ve `'-'` atlanır, `durumu` boşsa `status`'a düşer.
- Hiçbiri `"A-12"`, `"a-12"`, `" A-12 "` farkını sıfırlamıyordu.

## 2. Aşama 1 — Ortak raf ve slot sözleşmesi

### Kararlar (yönetim onaylı)

| Karar | Sonuç |
|---|---|
| Kanonik kod büyük harf | `"Raf-A 1"` → `"RAF-A 1"` |
| Sıfır dolgusu anlamlı | `A-1` ≠ `A-01` (sessiz birleştirme yok) |
| Hurda / Servis Sürecinde | Pozitif adetle rafta durduğu için slot sayılır |
| localStorage | Geçiş dönemi kaynağı; ortak kaynak Firestore raf belgeleri |

### Normalizasyon kuralı — `Schema.normShelfCode`

NFKC → sıfır genişlikli karakterler silinir → tire varyantları `-` → büyük harf → `i/ı/İ` hepsi `I` → boşluklar teke
iner → tire çevresindeki boşluklar silinir → trim. Boş, null ve `'-'` → `''` (rafsız). İdempotenttir.

### Slot kuralı — `Schema.isSlotOccupying`

Adet > 0 **ve** `durumu`/`status` alanlarının hiçbiri slot dışı değil. Slot dışı durumlar: Tükendi, Stok Dışı (her
yazım) ve "pasif" içeren her durum (`Tükendi / Pasif`, `Pasif (Arızalı)`). Adet miktarı slot sayısını artırmaz.

### Raf belgesi — `{ROOT}/shelves/items/{shelfId}`

| Alan | Kural |
|---|---|
| `code` | Kanonik kod; `/^[A-Z0-9ÇĞÖŞÜ][A-Z0-9ÇĞÖŞÜ .\-_]*$/`, ≤ 40 karakter |
| `depot` | `'b1'` \| `'b2'` |
| `capacity` | 1–200 tam sayı, varsayılan 5 |
| `usedSlots` | ≥ 0 tam sayı; `> capacity` belge hatası değil (Aşama 6 "düzeltme bekleyen raf") |
| `active` | boolean |
| `updatedAt` / `updatedBy` | zaman / admin UID (≤ 128) |

- **Kimlik:** `shelfDocId(depot, code)` = `${depot}_${code}` (ör. `b1_RAF-A 1`). Kod `/` içeremez ve `_` ile başlayamaz;
  kurallar aynı birleştirmeyle doğrulayabilir.
- Şemada olmayan alan reddedilir (`validateShelfDoc`).

### Değişen dosyalar

- **`src/utils/schema.js`** — `SHELF_*` sabitleri, `normShelfCode`, `isValidShelfCode`, `itemShelfCode`,
  `isSlotOccupying`, `computeUsedSlots`, `slotUsageByShelf`, `shelfDocId`, `buildShelfDoc`, `validateShelfDoc`.
- **`src/utils/shelf-capacity.js`** — kendi `isInStock` / `shelfOf` kopyaları kaldırıldı; hepsi `Schema`'ya devredildi.
  Eski localStorage anahtarları okunurken kanonikleşir (çakışmada küçük değer). `admin.html` bu dosyayı `schema.js`'ten
  önce yüklediği için `Schema` çağrı anında okunur; yoksa hata fırlatılır.
- **`tests/unit/shelf-contract.test.mjs`** — 25 yeni test.

## 3. Doğrulama

| Kontrol | Sonuç |
|---|---|
| `npm run test:unit` | 147/147 |
| `npm run lint:xss` | 48 dosya, 885 ifade, 0 izinsiz |
| `node --check` (değişen JS), `git diff --check` | Temiz |
| Emulator / akış testleri | Çalıştırılmadı (bu pakette kural ve yazma yolu değişmedi) |

## 4. Açık kalanlar

- **P1-01:** İç transfer hâlâ kör batch → Aşama 2.
- **Kabul ölçütü "localStorage karar kaynağı değildir":** Firestore raf belgeleri devreye girene kadar açık.
- **P2-05 WMS tarafı:** WMS ham raf adıyla gruplar. Ürün modalı ve `INV_CONFIG` kanonik koda geçmeden WMS'i kanonik
  gruplamaya çevirmek yan hata 3'ü tetikler → Aşama 4'te birlikte.
