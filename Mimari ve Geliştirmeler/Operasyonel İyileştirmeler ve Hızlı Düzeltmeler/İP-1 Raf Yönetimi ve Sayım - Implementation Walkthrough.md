# İP-1 Raf Yönetimi ve Sayım Kilidi — Implementation Walkthrough

> **Tarih:** 11.11.2026
> **Dal:** `feat/v3.6-raf-sayim-envanter-no-mobil-form` (taban `417fc56`)
> **Durum:** Uygulandı; birim, kural, emülatör ve tarayıcı testleri geçti. **Canlıya yayın yapılmadı.** Yayında önce Firestore kuralları, sonra hosting gider (§7).
> **Kapsam:** Raf ekleme, adını düzeltme ve kaldırma; boş rafların listelenmesi; sayım için raf kilidi ("pasif raf"). Kilitli raftaki ürünler B1/B2 görünümlerinde gizlenir ve stok hareketi yapılamaz.
> **Plan:** [00 Uygulama Planı ve Mimari Uyum İncelemesi](./00%20Uygulama%20Planı%20ve%20Mimari%20Uyum%20İncelemesi.md) · İP-1 bölümü.

## İçindekiler

1. [Talepler ve karşılıkları](#1-talepler-ve-karşılıkları)
2. [Kullanıcının gördüğü davranış](#2-kullanıcının-gördüğü-davranış)
3. [Güvenlik modeli](#3-güvenlik-modeli)
4. [Teknik akış](#4-teknik-akış)
5. [Değişen dosyalar](#5-değişen-dosyalar)
6. [Test ve doğrulama](#6-test-ve-doğrulama)
7. [Yayın adımları](#7-yayın-adımları)
8. [Sınırlar ve bilinen konular](#8-sınırlar-ve-bilinen-konular)
9. [Yerel test walkthrough](#9-yerel-test-walkthrough)

---

## 1. Talepler ve karşılıkları

| # | Talep | Sonuç |
|---|---|---|
| 1 | Depo rafları için raf ekleme | WMS'te "Raf Ekle": depo, kod ve kapasite. Kod büyük harfe çevrilir; aynı depoda aynı kodla ikinci raf eklenmez. |
| 2 | Raf düzenleme | Raf panelinde kapasite (mevcut) ve **ad düzeltme**. Ad yalnız hiçbir ürün kaydının göstermediği rafta düzeltilir; kapasite ve durum korunur. |
| 3 | Raf kaldırma; raf boş olmalı | "Rafı kaldır": stokta ürünü olan raf kaldırılamaz ve nedeni yazılır. Rafa bağlı tükenmiş (adet 0) kayıtlar Havuz'a alınır. Kural tarafında da kilitli ya da sayacı dolu raf silinemez. |
| 4 | Boş rafları listeleme | "Boş raflar" filtresi ve "Boş Raf" metriği; kartta "Boş raf" rozeti. |
| 5 | Sayım için rafı pasif yapma, neden açıklaması | "Sayıma al" gerekçe ister (1–300 karakter). Kartta "🔒 Sayımda" rozeti, panelde gerekçeli bilgi bandı. |
| 6 | Pasif raftaki ürünler B1/B2'de görünmez | Depo tablosu, kart görünümü, arama, PDF/Excel raporlarında gizli. Yöneticiye "N ürün gizli" notu çıkar. |
| 7 | Envanter çıkışı / zimmet yapılamaz, talep edilemez | Çıkış, sepet, zimmet, talep onayı, transfer, servis/hurda, iade ve servis dönüşüyle stok ekleme, FAB ±, silme ve rafa yeni ürün yerleştirme reddedilir. Arama ve aday listelerinde de görünmez. |
| 8 | Son kullanıcı hiç görmez | Personelin depo listelerinde ve talep aramasında görünmez; personelin çıkış yazması kurallarca reddedilir (§3). |

## 2. Kullanıcının gördüğü davranış

### 2.1 Yönetici — Depo Raf Haritası (admin.html)

- **Başlık:** kısa açıklama ve **"Nasıl çalışır?"** düğmesi. Düğme raf yönetimi ve sayım adımlarını anlatan yardım alanını açar (AGENTS.md).
- **Araç satırı:** "Raf Ekle" ve üç filtre çipi: Tüm raflar · Boş raflar · 🔒 Sayımdaki raflar. Metrik satırına "Boş Raf" ve "Sayımda" eklendi.
- **Raf paneli (rafa tıklayınca):**
  - Katalogdaki kilitsiz raf: 🔒 Sayıma al · ⚙️ Kapasite · ✏️ Adı düzelt · 🗑️ Rafı kaldır.
  - Sayımdaki raf: ✅ Sayımı bitir · ⚙️ Kapasite ve mor bilgi bandı: *"Sayımda — <gerekçe>. Bu raftaki ürünler depo listelerinde gizli; çıkış, zimmet, talep ve transfer yapılamaz…"*.
  - Katalog dışı raf: *"Bu raf katalogda yok; sayım ve raf yönetimi için önce kapasitesini tanımlayın"* ve ⚙️ Kataloğa ekle.
  - Liste artık rafa bağlı **tüm** kayıtları gösterir (adet 0 ve "Pasif" durumlu dahil; stok dışı olanlar soluk). Sayımdaki rafta her satırda **"Sayım düzelt"** vardır, "Rafı değiştir" yoktur.
- **Sayım düzelt:** sistemdeki adet gösterilir, sayılan adet ve isteğe bağlı not girilir. Durum stok hareketleriyle aynı kuraldan hesaplanır (0 → N: "Tükendi" → önceki durum). Eski ve yeni adet denetim kaydına yazılır.
- **Onaylar** (sayımı bitir, rafı kaldır) WMS'in kendi diyaloğunda açılır. Ortak onay kutusu çekmecenin arkasında kalıyordu (§6.3).
- **Taşıma diyaloğu:** sayımdaki raflar "· sayımda" etiketiyle seçilemez.

### 2.2 Depo listeleri (index.html)

- B1/B2 tablosu, kart görünümü ve arama sayımdaki raflardaki kayıtları göstermez.
- Yönetici tablonun üstünde şunu görür: *"🔒 Sayımdaki raflarda N ürün kaydı bu listede gizli. Sayım ve adet düzeltmesi: Yönetim Paneli › Depo Raf Haritası."*
- **Ürün modalı ve transfer:** raf listelerinde sayımdaki raflar "(Sayımda)" etiketiyle seçilemez. Transfer hedef listesi artık katalogdaki raflarla birleşik.
- **İade ve servis dönüşü:** "Stoğa ekle" ile iade sayımdaki rafa stok eklemez. Mesaj: *"Ürünün rafı sayımda; şu an stoğa eklenemez. 'Stoğa ekle' seçeneğini kaldırarak kapatabilir ya da sayım bitince tekrar deneyebilirsiniz."* Servisten dönüş benzer uyarıyla durur; servis kaydı açık kalır.

### 2.3 Personel

- Sayımdaki raftaki ürünleri depo listelerinde, çıkış ve sepet aramasında, "Envanter Talep Et" aramasında görmez.
- "N ürün gizli" notu yalnız yöneticiye çıkar.

## 3. Güvenlik modeli

- **Tek doğruluk kaynağı raf belgesidir:** `shelves/items/{depo}_{KOD}` üzerinde `lockReason`, `lockedAt`, `lockedBy`.
  - Üçü ya hep birlikte bulunur ya hiç bulunmaz. Kilitliyken `active:false` zorunludur.
  - **`active:false` tek başına kilit değildir.** Eski "yeni yerleştirmeye kapalı" raflar aynen çalışır (Global-Architecture KURAL 3).
- **Kayıttaki `rafPasif` yalnız kopyadır.** Gizleme ve personel kuralı bunu okur.
  - Her stok hareketi transaction içinde raf belgesini ve kaydı okur. İkisinden biri kilit diyorsa hareket reddedilir (fail-closed).
- **Kurallar (`firestore.rules`):**
  - Raf şekli 10 alana genişledi; 7 temel alan zorunlu.
  - Kilit konarken `lockedAt == request.time` ve `lockedBy == auth.uid`. Geçmiş tarihli ya da başkası adına kilit reddedilir.
  - Kilit sürerken bu üç alan değişmez. Sayaç ve kapasite yazımları serbesttir.
  - Kilitli raf silinemez.
  - **Personel çıkışı:** `staffExitStockOk` artık `old.rafPasif != true` ister. Ek belge erişimi yoktur; personel çıkışındaki 6 kalem sınırı değişmez. Personel bayrağı değiştiremez (mevcut `hasOnly` listesi).
  - **auditLogs:** yapısal `fromValue` / `toValue` (≤128 karakter, etiketsiz).
- **Denetim izi (Sütun 3):** raf-eklendi, raf-sayima-alindi, raf-sayim-bitti, raf-adi-duzeltildi, raf-silindi ve sayim-duzeltme kayıtları işlemle **aynı commit'te**, sunucu saatiyle yazılır.
- **Yönetici yazmaları:** kurallarda yöneticinin sayımdaki üründe adet değiştirmesi bilinçli olarak serbesttir; sayım düzeltmesi budur. Hareket engeli yönetici için defter katmanındadır.

## 4. Teknik akış

| Akış | Sıra |
|---|---|
| **Sayıma al** | 1) Rafa bağlı kayıtlar okunur; yalnız denetim kaydındaki sayı için. 2) Transaction: raf belgesi ve denetim kaydı. Bu andan sonra defter hareketi reddeder. 3) Kayıtlar taze, indeksli sorgularla bulunur: canlı listeden rafın ham yazımları, `raf` / `shelf` / `rafNo` alanlarında `in`. Bayraklar ≤450'lik parçalar halinde yazılır. 4) Doğrulama turu; eksik kalan bir kez daha yazılır, kalırsa `lock-incomplete`. Çağrı tekrar edilebilir: raf zaten kilitliyse yalnız bayraklar uzlaşır. |
| **Sayımı bitir** | Aynı sıra: önce raf (kilit alanları silinir, `active:true`), sonra bayraklar `false`. Bayrağı kalan kayıt yine hareket edemez (fail-closed); eşitleme düzeltir. |
| **Stok hareketi** | `runStockOps` her girdinin rafını okur; `planStockOps` → `StockLedger.assertNotCountLocked`. `planTransfer` kaynağı ve hedefi denetler. `planProductSave` taşımayı ve yeni ürünü reddeder; aynı raf içindeki 0→N düzeltmesine `allowInactive` ile izin verir; bayrağı rafın gerçek durumundan yazar (kayma kendiliğinden düzelir). |
| **Raf kaldır** | Depo taze okunur (tam). Stoklu raf, sayımdaki raf ya da raf kodu `raf` dışındaki eski bir alandan gelen kayıt varsa ret. Kayan sayaç önce ayrı commit'te sıfırlanır. Ardından tek transaction: adet 0 kayıtların `raf`'ı boşaltılır, raf silinir, denetim kaydı yazılır. |
| **Ad düzelt** | Rafa bağlı hiç kayıt yoksa: yeni belge (kapasite/durum korunur) + eskinin silinmesi + eski → yeni denetim kaydı tek commit'te. |
| **Eşitleme** | "Sistem Raf Sayaçlarını Eşitle" artık bayrakları da raf kilidine eşitler (`planShelfLockSync`). Yedekten geri yükleme sonrası otomatik çalışır. |

## 5. Değişen dosyalar

| Dosya | Değişiklik |
|---|---|
| `src/utils/schema.js` | `SHELF_LOCK_KEYS`, kilit doğrulaması, `rafPasif` (boolean) isteğe bağlı alan; `isShelfCountLocked`, `isRowCountLocked`, `hasPhysicalStock`, `rowsOnShelf`, `emptyShelves`. |
| `firestore.rules` | Raf kilit şekli, kanıtı ve korunması; kilitli raf silinemez; personel çıkışında `rafPasif`; auditLogs `fromValue`/`toValue`. |
| `src/services/stock-ledger.js` | Kilit denetimleri (transfer, ürün kaydı); `planShelfLock` / `Delete` / `Rename` / `LockSync`; `createShelf`, `setShelfCountLock`, `deleteShelf`, `renameShelf`; sayım düzeltmesinde denetim kaydı; `DELETE_FIELD`. |
| `src/services/firebase-handler.js` | `buildAuditRecord`; `planStockOps` / `runStockOps` raf okuması; raf servis sarmalayıcıları ve `_findShelfRows`; `applyItemOps` kilitli kayıt silme muhafızı; dinleyicide bayrak değişince tam çizim; eşitleme sonucu yerel bellek. |
| `src/modules/admin/shelf-matrix.js`, `.css` | Raf Ekle, filtreler, rozetler, raf paneli işlemleri, sayım düzelt, WMS içi onay diyaloğu. |
| `admin.html` | WMS başlığında açıklama + yardım; araç satırı. |
| `src/modules/admin/admin-main.js` | `[data-panel-help]` ortak aç/kapa dinleyicisi. |
| `style.css` | Ortak `.panel-intro-desc` / `.panel-help*` ve `.count-lock-notice` (açık + koyu tema). |
| `src/ui/table-engine.js` | `getProcessedData` süzgeci, yönetici notu, satır yamasında kilitli satırın kaldırılması. |
| `src/ui/ui-components.js` | Ürün modalı ve transfer raf listelerinde "(Sayımda)"; transfer listesi katalogla birleşik. |
| `script.js`, `pdf-generator.js` | Çıkış, sepet, talep aramaları, talep onayı adayları, PDF/Excel. |
| `src/modules/admin/inventory-management.js` | Zimmet adayları. |
| `src/services/assignment-service.js`, `src/services/purchase-servises.js` | İade ve servis dönüşü ön uyarıları. |
| `src/utils/stock-import.js` | Sayımdaki rafa adet 0 kayıt da yazılmaz; raf belgesi yeniden kurulurken kilit alanları korunur. |
| `src/modules/admin/admin-backup.js` | Geri yükleme sonrası eşitleme. |
| `src/modules/admin/admin-dashboard.js`, `admin-system-control.js` | Kritik grup silme ve mükerrer temizleyici kilitli kayıtları atlar. |
| Testler | `stock-schema`, `shelf-contract`, `stock-ledger`, `import-shelf-atomic`, `rules`, `staff-exit`, `stock-ledger.emu`. |

**Bilinçli test beklentisi değişikliği (KURAL 5):** `stock-schema.test.mjs` kapalı alan kümesi testine `rafPasif` eklendi. Bu, sözleşmenin bilinçli genişlemesidir (`sn` eklenirken de aynı test güncellenmişti); gevşetme değildir. Yeni tip testleri `rafPasif` için string ve sayıyı reddeder.

## 6. Test ve doğrulama

### 6.1 Komutlar

| Komut | Önce | Sonra |
|---|---|---|
| `npm run test:unit` | 352/352 | **367/367** (15 yeni) |
| `npm run test:rules` | 379/379 | **392/392** (13 yeni) |
| `npm run test:ledger:emu` | 26/26 | **31/31** (5 yeni, üretim kurallarıyla) |
| `npm run test:atomic:emu` | — | **10/10** |
| `npm run lint:xss` | 0 izinsiz | **0 izinsiz** (85 dosya) |
| `node scratch/hosting-files.js` | 108 | **108** (İP-1 yeni dosya eklemedi) |
| `git diff --check` | — | temiz |

### 6.2 Tarayıcı (yerel emülatör, gerçek admin oturumu) — 19/19

Çalışan geliştirme sunucusu ve emülatör üzerinde, yalnız `v36t_` önekli test kayıtları ve `V36 …` raflarıyla koşuldu; sonunda hepsi silindi.

| Kontrol | Sonuç |
|---|---|
| Panel açıklaması görünür, "Nasıl çalışır?" yardım alanını açar | ✔ |
| Raf Ekle: "Kayıt kodu: V36 TEST" önizlemesi; katalog kaydı, kullanım sunucudan sayıldı (1) | ✔ |
| Aynı kodla ikinci raf → `shelf-exists` | ✔ |
| Panel rafa bağlı tüm kayıtları (adet 0 dahil) listeler | ✔ |
| Sayıma al → raf kilidi + iki kaydın bayrağı | ✔ |
| Panel: sayım bandı, "Sayım düzelt" var, "Rafı değiştir" yok, işlemler yalnız bitir/kapasite | ✔ |
| Sayımdaki rafta çıkış, transfer, yeni ürün, silme → hepsi `shelf-locked` | ✔ |
| Sayım düzelt 0→2: durum "Tükendi" → "Kullanıma Hazır", bayrak korunur, denetim kaydı `0 → 2` | ✔ |
| Yönetici B1 listesi: kayıt gizli, "2 ürün kaydı gizli" notu, çıkış aramasında yok | ✔ |
| Personel görünümü: depo listesinde ve talep aramasında yok, yönetici notu yok | ✔ |
| Sayımı bitir → kilit kalktı, bayraklar `false`, "Rafı değiştir" geri geldi | ✔ |
| Stoklu raf kaldırılamaz: *"V36 TEST rafında stokta 2 ürün kaydı var…"* | ✔ |
| Boş raf eklendi, adı iki yönde düzeltildi | ✔ |
| "Boş raflar" filtresi boş rafı listeler, dolu rafı listelemez | ✔ |
| Boş raf kaldırıldı | ✔ |
| Denetim kayıtları: eklendi, sayıma alındı, sayım bitti, ad düzeltildi, silindi | ✔ |
| Sayfa hatası yok | ✔ |

### 6.3 Testte bulunup düzeltilen hata

İlk tarayıcı koşusunda "Sayımı bitir" onayı tıklanamadı:
- **Neden:** ortak onay kutusu `#customAlertOverlay` (z-index 9999) raf çekmecesinin (13000) **arkasında** açılıyordu. Tıklama çekmeceye gidiyor, işlem hiç başlamıyordu.
- **Çözüm:** çekmece içindeki onaylar (sayımı bitir, rafı kaldır) WMS'in kendi diyaloğunu kullanır (`confirmInDrawer`, z-index 14000, DialogStack).

## 7. Yayın adımları

1. **Önce kurallar:** `firebase deploy --only firestore:rules`. Yeni kurallar eski istemciyle uyumludur: kilit alanları isteğe bağlıdır, eski raf belgeleri geçerli kalır.
2. **Sonra hosting:** `node scratch/hosting-files.js` (108) → `firebase deploy --only hosting`.
3. Veri göçü gerekmez; yeni alanların hepsi isteğe bağlıdır. İlk sayım öncesinde WMS'ten "Sistem Raf Sayaçlarını Eşitle" önerilir.

**Bu teslimde yayın yapılmadı.**

## 8. Sınırlar ve bilinen konular

- **Personelde gizleme ekran düzeyindedir;** kayıtlar dinleyiciyle cihaza iner. Hareket engeli kurallarla sağlanır. Sunucuda okuma gizleme, tüm satırlara alan göçü ve sorgu filtreli dinleyici ister; sonraki iş olarak önerilir.
- **Kilit konurken farklı bir ham yazımla az önce eklenmiş kayıt indeksli sorguda kaçabilir.** Bu kayıt da hareket edemez, çünkü defter raf belgesini okur. Bayrağı eşitleme ya da kilidin yeniden çağrılması düzeltir.
- **Eski `active:false` raf sayıma alınıp bitirilirse `active:true` olur;** önceki "yeni yerleştirmeye kapalı" durumu saklanmaz. Bu durumu bugün kuran bir arayüz yok.
- **Raf kodu `raf` dışındaki eski bir alandan (`shelf`, `rafNo`) gelen kayıt varsa raf kaldırılamaz** (`legacy-shelf-field`). Bu alanlar katı şema gereği değiştirilemez.
- **Kurallar yöneticinin sayımdaki üründe adet değiştirmesine izin verir;** sayım düzeltmesi budur. Yönetici için hareket engeli defter katmanındadır.
- `bulkAddB2Items` (konsol yardımcısı) zaten katı şemaya takılıyor ve hiçbir şey yazamıyor; dokunulmadı.
- **Personel oturumu tarayıcıda gerçek hesapla denenmedi.** Çalışan emülatörde test personeli hesabı yoktu ve veriniz silinmesin diye emülatör yeniden tohumlanmadı. Personel görünümü aynı sayfada rol düşürülerek denendi. Personel çıkışının kural tarafından reddi `staff-exit.test.mjs`'te gerçek personel bağlamıyla doğrulandı.
- **`node scratch/flow-tests.js --emu` koşulmadı:** tohumlanmış emülatör ister. Tam regresyon için önerilen sıra: `npm run emu:seed` → `node scratch/flow-tests.js --emu`.

## 9. Yerel test walkthrough

1. `npm run emu`, `npm run emu:seed`, `npm run serve` → `http://127.0.0.1:5500/index.html?emu=1`. Yönetici girişi: kod `emu-yonetici-0001`.
2. **Yönetim Paneli › Depo Raf Haritası:**
   1. "Nasıl çalışır?" yardımını açın.
   2. **Raf Ekle** ile `TEST 1` rafını kapasite 5 ile ekleyin. Aynı adla ikinci kez eklemeyi deneyin; ret mesajı gelmeli.
   3. index.html'de B1'e `TEST 1` rafında iki ürün ekleyin (biri adet 0). WMS'te rafa tıklayın: iki kayıt listelenir.
   4. **🔒 Sayıma al**, gerekçe yazın. Kartta "Sayımda", panelde mor bant ve "Sayım düzelt" düğmeleri görünür.
3. **index.html › B1:**
   - Ürünler listede yok; üstte "Sayımdaki raflarda 2 ürün kaydı gizli" notu var.
   - Envanter Çıkışı ve Envanter Talep Et aramalarında da çıkmazlar.
   - Ürün Ekle modalında raf listesinde `TEST 1 (Sayımda)` seçilemez.
4. **WMS'te sayım:**
   1. Adet 0 olan ürüne "Sayım düzelt" ile 2 girin: adet ve durum güncellenir.
   2. Üst çubuktaki **Güvenlik Raporu**nda `sayim-duzeltme` kaydını görün.
   3. **✅ Sayımı bitir:** ürünler B1'e döner.
5. **Kaldırma:** "Rafı kaldır" stoklu rafta neden gösterir. "Boş raflar" filtresinde yalnız boş raflar görünür; boş bir rafı kaldırın.
