# P1 NİHAİ RAPOR — B1/B2 Tam Kapalı Şema Sözleşmesi (Strict Contract)

**Branch:** `feat/phase-7-logging-and-ux` (yerel; commit / push / deploy yok)
**Kapsam:** P1'in ikinci ve son ayağı. Birinci ayak (Excel import raf sayacı, AtomicWriter) için bkz. `P1 FIX RAPORU - EXCEL IMPORT RAF SAYACI.md`.

---

## 1. Önceki durum (bulgular)

| # | Bulgu | Etki |
|---|---|---|
| 1 | `validateB1/B2` tam `set`'te **bilinmeyen alanı hiç reddetmiyordu** — yalnız zorunlu alanların varlığına ve eski takma adlara bakıyordu. | `appendItem`, `upsertItem`, `saveData`, geri yükleme ve içe aktarma yoluyla sahte alan kalıcı olarak yazılabiliyordu. |
| 2 | "Yalnız bilinen alan adı" kuralı şemada değil, **iki ayrı kopya** hâlinde duruyordu: `firebase-handler.js` `_stockViolation` ve `stock-ledger.js` `planProductSave`. | Kural iki yerde ayrı ayrı bakılıyordu; kopyalar birbirinden kayabilirdi. |
| 3 | `planProductSave`'in **düzenleme** dalı (ürün formu → `runProductSave`) yalnız alan **adını** denetliyordu, **tipi hiç** denetlemiyordu. | `ürün: 123`, `raf: 7` gibi yanlış tipler bu yoldan yazılabiliyordu. |
| 4 | `STOCK_OPTIONAL_KEYS` B1 ve B2'de **ortaktı**. | `envanterNo` B1 sözleşmesinden de geçiyordu; B1 koruması yalnız içe aktarıcının bu alanı yazmamasına dayanıyordu. |
| 5 | `saveData`'nın sözleşmeye uymayan (eski biçimli) kayıt yolu yalnız **yeni eklenen** alanları denetliyordu. | Var olan bir alanın değeri yanlış tipe çevrilerek yazılabiliyordu. |
| 6 | `ürün` için tip denetimi yoktu, yalnız "boş değil" denetimi vardı. | `ürün: 123` hiçbir yolda reddedilmiyordu. |

## 2. Şema envanteri (regresyon koruması)

İsteğe bağlı alan kümesi tahminle değil, **canlı yazıcıların envanterinden** çıkarıldı. Bunun için b1/b2'ye yazan tüm çağrı yerleri incelendi: ürün formu, hızlı ürün, B2 toplu ekleme, tür adı yeniden adlandırma, Excel içe aktarma, takip (FAB), durum değiştirme, stok motoru, transfer ve yedekten geri yükleme.

| Alan | B1 | B2 | Tip | Kaynağı |
|---|---|---|---|---|
| `isWatched` | ✔ | ✔ | boolean | FAB "takip" (`toggleWatch → updateItem`) |
| `limit` | ✔ | ✔ | tam sayı ≥ 0 ya da `null` | Excel içe aktarma; panel ve Excel raporu okur |
| `stokOncekiDurum` | ✔ | ✔ | string | `computeStockPatch` (stok 0'a düşerken önceki durum); tam kayıt yazan yollar bu alanı geri taşır |
| `envanterNo` | **✖ (RET)** | ✔ | string | B2 Excel içe aktarma |

`sn`, `envanterNo`, `createdAt` gibi alanların diğer kod geçişleri **B3 hareket kaydına** aittir; b1/b2 kaydına yazılmaz. `prodType`, `seriNo`, `serialNo` ise yalnız eski veriden **okunan** yedek adlardır; kod bunları hiç yazmaz. Bu yüzden sözleşmeye bilinçli olarak alınmadı (bkz. §5).

## 3. Yeni sözleşme (`src/utils/schema.js`)

- **Ayrı ve açık kümeler:** `B1_KEYS` / `B2_KEYS` zorunlu, `B1_OPTIONAL_KEYS` / `B2_OPTIONAL_KEYS` isteğe bağlı. Her depo kendi `SPEC`'ini kullanır. Ortak `STOCK_OPTIONAL_KEYS` **kaldırıldı**.
- **Tam kapalı küme:** zorunlu ve isteğe bağlı alanlar dışındaki her alan `bilinmeyen alan`, eski takma ad `eski alan` olarak reddedilir. B1'e `envanterNo` (ya da `status`) gelirse açık bir hata döner: `envanterNo yalnız B2 (demirbaş) kaydında olabilir`.
- **set = update:** `validateB1/B2(kayıt)` tam kaydı, `validateB1/B2(alanlar, { partial: true })` kısmi güncellemeyi denetler. İkisi **aynı** alan ve tip kurallarını kullanır; `partial` yalnız "eksik zorunlu alan" denetimini atlar.
- **Tip kuralları:**
  - `ürün` → string **ve** boş değil (birleşik denetim)
  - `adet` → tam sayı ≥ 0
  - `limit` → tam sayı ≥ 0 ya da `null`
  - `isDemirbas`, `isWatched` → boolean
  - `lastUpdate` → sayı
  - `id` → boş olmayan metin ya da sonlu sayı (`makeId` sayısal id üretir)
  - metin alanları (`envanterNo`, `stokOncekiDurum`, `status` dahil) → string
- `stockKnownKeys(col)`: bir deponun sözleşmedeki tüm alan adları; `saveData`'nın eski biçimli kayıt yolu kullanır.

### Tek kaynak — kopyalar kaldırıldı
- `firebase-handler.js` `_stockViolation`: `set` için tam sözleşme, `update` için `{ partial: true }`. Kendi alan listesi **yok**.
- `stock-ledger.js` `planProductSave` (düzenleme): `validate(fields, { partial: true })`. Artık tip de denetleniyor (bulgu #3 kapandı).
- `saveData` eski biçimli kayıt yolu: kayıtta **zaten bulunan** eski/bilinmeyen alana göz yumulur, böylece göç edilmemiş veri düzenlenebilir ve tür adı değiştirme kırılmaz. Ancak **yeni eklenen her alan** ve **değeri değişen her sözleşme alanı** (tip dahil) denetlenir (bulgu #5 kapandı).

## 4. Kanıtlar

### Astra'nın istediği senaryolar — `tests/unit/stock-schema.test.mjs`
Her senaryo **ayrı ayrı `[set]` ve `[update]`** testi olarak koşar:

| Senaryo | set | update |
|---|---|---|
| Bilinmeyen / sahte alan (`sahteAlan`, `createdAt`) → RET (B1 ve B2) | ✔ | ✔ |
| Ürün adı sayı (`ürün: 123`) → RET; `null`, boşluk → RET | ✔ | ✔ |
| B2 `envanterNo` yok → KABUL; `string` (boş metin dahil) → KABUL; sayı / nesne / `null` → RET | ✔ | ✔ |
| B1'e `envanterNo` (`'ENV-1'`, `''`, `7`) → RET | ✔ | ✔ |
| Yanlış tipler (`raf: 5`, `status: 1`, `isWatched: 'evet'`, `adet: '5'`, `limit: '5'`/`-1`, `stokOncekiDurum: 0`, `id: ''`) → RET | ✔ | ✔ |
| Canlı yazıcıların meşru alanları (`isWatched`, `limit`, `limit: null`, `stokOncekiDurum`, B2 `envanterNo`, sayısal id) → KABUL | ✔ | ✔ |

Ek kanıtlar:
- update **yalnız** eksik zorunlu alandan muaf: aynı kısmi kayıt `set`'te `eksik alan` ile reddedilir.
- B1 ve B2 kümeleri birbirinden ayrı; `envanterNo` ve `status` yalnız B2'de.
- `toCanonicalStock` çıktısı kapalı sözleşmeden geçer, meşru alanlar (`limit`, `isWatched`, `stokOncekiDurum`, `envanterNo`) korunur — **alan kaybı yok**.

### Ürün formu yolu — `tests/unit/stock-ledger.test.mjs`
`planProductSave` düzenlemesinde `ürün: 123`, `raf: 7`, `isDemirbas: 'evet'` ve B1'e `envanterNo` reddedilir; B1 yeni kayıtta `envanterNo` da reddedilir. B2'de `envanterNo` string kabul, sayı ret. Formun tüm alanlarıyla yapılan meşru düzenleme etkilenmez.

### Regresyon
| Komut | Sonuç |
|---|---|
| `npm run test:unit` | **226/226** (16 yeni test) |
| `npm run lint:xss` | Temiz (0 izinsiz) |
| `npm run test:ledger:emu` | **26/26** |
| `npm run test:atomic:emu` | **10/10** (P1 içe aktarma + raf sayacı dahil) |
| `node scratch/flow-tests.js --emu` (tam paket) | `b1WriteContract`, `b2WriteContract`, ürün kaydı, takip, stok, transfer ve içe aktarma akışları **geçti**. Yalnız önceden bilinen, ilgisiz 3 hata kaldı: `j3SessionVisa`, `j4SelfApproval`, `j6PostLogoutRelogin` (`auth-engine.js`'teki bu çalışmaya ait olmayan değişiklikler). Temel çizgiyle aynı. |

## 5. Bilinçli kararlar ve kalan noktalar

- **Sözleşme dışı alan taşıyan eski veri** (`prodType`, `seriNo`, `createdAt`, B1'de `status` / `qty` gibi):
  - **Veri silinmez, alan kaybı olmaz.** Böyle bir kaydın düzenlenmesi (`updateItem`, ürün formu, `saveData`) çalışmaya devam eder.
  - Ancak bu kaydı tam olarak **yeniden yazan** yollar (`upsertItem`, yedekten geri yükleme) alan adını belirten `schema-violation` ile **reddedilir**; hiçbir şey yazılmaz. Geri yüklemede bu reddediş hepsi-ya-da-hiçbiri olarak işler.
  - Bu, kapalı sözleşmenin amacıdır: alan sessizce taşınmaz, sessizce de atılmaz.
  - **Canlıya çıkmadan önce öneri:** üretim verisinde (`lifeserver_master`) sözleşme dışı alan olup olmadığı bir kez taranmalı. Kod tabanı bu alanları yazmıyor, ama eski göçlerden kalmış olabilirler. Demo kopyada (`scratch/emu-data/inventory_demo.json`) yalnız bir B1 kaydında eski `status` alanı var — bu alan bu çalışmadan önce de reddediliyordu.
- **`bulkAddB2Items`** (`admin-dashboard.js`) `isDemirbas` ve `status` göndermiyor; bu çalışmadan önce de tam sözleşmeye takılıyordu. Kapsam dışı bırakıldı, dokunulmadı. Bilinen bir arayüz tetikleyicisi bulunamadı (konsol yardımcısı olabilir).
- **Sunucu tarafı:** kapalı küme istemci sözleşmesinde (tüm yazma yolları bu muhafızdan geçer). `firestore.rules`'taki b1/b2 kuralı değiştirilmedi; hâlâ yalnız eski alan ve adet denetimi yapıyor. Kurallara `hasOnly` eklemek, eski kayıtlarda `qty` taşıyan stok yazmalarını (`computeStockPatch`) kırabileceği için ayrı ve bilinçli bir karar olarak öneriliyor.

## 6. Değişen dosyalar
`src/utils/schema.js` · `src/services/firebase-handler.js` (`_stockViolation`, `saveData` eski kayıt yolu) · `src/services/stock-ledger.js` (`planProductSave`) · `tests/unit/stock-schema.test.mjs` · `tests/unit/stock-ledger.test.mjs` · `tests/unit/shelf-contract.test.mjs`
