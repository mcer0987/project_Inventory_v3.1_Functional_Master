# v3.6 Uygulama Planı ve Mimari Uyum İncelemesi

> **Tarih:** 11.11.2026
> **Dal:** `feat/v3.6-raf-sayim-envanter-no-mobil-form` (taban `417fc56`)
> **Durum:** Onaylandı; iş paketleri sırayla uygulanıyor. Her paketin ilerlemesi kendi walkthrough belgesindedir.
> **Başlangıç ölçümü:** `npm run test:unit` 352/352 · `npm run lint:xss` 0 izinsiz · Hosting 108/108.

| İş paketi | Belge |
|---|---|
| İP-1 Raf yönetimi ve sayım kilidi | [İP-1 Raf Yönetimi ve Sayım - Implementation Walkthrough.md](./İP-1%20Raf%20Yönetimi%20ve%20Sayım%20-%20Implementation%20Walkthrough.md) |
| İP-2 Envanter No plakası ve değişim aracı | [İP-2 Envanter No Kilidi ve Değişim Aracı - Implementation Walkthrough.md](./İP-2%20Envanter%20No%20Kilidi%20ve%20Değişim%20Aracı%20-%20Implementation%20Walkthrough.md) |
| İP-3 Mobil ve dokunmatik ürün formu | [İP-3 Mobil Ürün Formu - Implementation Walkthrough.md](./İP-3%20Mobil%20Ürün%20Formu%20-%20Implementation%20Walkthrough.md) |

---

## Bağlam

Üç ihtiyaç var (EBYS dışı):
1. **Raflar:** raf eklenebilmeli, düzenlenebilmeli ve kaldırılabilmeli. Boş raflar listelenmeli. Sayım için raf **pasif** yapılabilmeli; o raftaki ürünler B1/B2'de görünmemeli ve hareket ettirilememeli.
2. **Envanter No:** ürün modalında değiştirilemeyen "demirbaş plakası" olmalı. Değişim yalnız Operasyon Merkezi aracından yapılmalı.
3. **Mobil form:** Ürün Ekle/Düzenle modalında klavye açıkken alandan alana geçiş kolaylaşmalı.

Onaylanan kararlar:
- Numara bir kez yazılır, sonra kilitlenir. Boş numara düzenlemede bir kez atanabilir.
- Değişim yalnız ürünün **güncel** kaydını etkiler; değişim denetim kaydına yazılır.
- Aramaya açık zimmetler de dahil.
- Önceki commit'in mesajı düzeltilecek.

## Mimari uyum incelemesi (bir önceki plan taslağına göre)

İncelenen kaynaklar:
- `Global-Architecture.md`
- `Mimari ve Geliştirmeler/v3.3/P1 NİHAİ RAPOR - B1-B2 KATI ŞEMA SÖZLEŞMESİ`
- `P1 SON AÇIK RAPORU - ESKİ ALANLARIN DEĞİŞMEZLİĞİ`
- `AŞAMA 1 - YAZMA HARİTASI VE RAF SÖZLEŞMESİ`
- `firestore.rules`, `scratch/hosting-files.js`, `scratch/xss-lint.js`, `Dockerfile`

**Bozan ya da riskli bulunan noktalar ve düzeltmeleri:**

| # | Taslaktaki sorun | İlke | Düzeltme |
|---|---|---|---|
| 1 | "Pasif" için mevcut `active:false` alanı yeniden anlamlandırılıyordu. Canlıdaki eski `active:false` raflar ("yeni yerleşime kapalı") birden sayım kilidine girer, hareketleri reddedilirdi. | KURAL 3 (geriye dönük saygı) | Ayrı sayım kilidi alanları: `lockReason`, `lockedAt`, `lockedBy`. Kilit `active:false` gerektirir, ama `active:false` tek başına kilit **değildir**. Eski anlam aynen kalır. |
| 2 | Sayıma alırken ve benzersizlik denetiminde tüm depo okunuyordu (O(N)). | KURAL 4 | Canlı veriden rafın ham yazımları toplanır, sonra `where('raf'/'shelf'/'rafNo','in',[…])` ile indeksli taze sorgu yapılır. Benzersizlik için `where('envanterNo','in',[yazılan, normalize])` sorguları ve canlı veri taraması. |
| 3 | Numara değişimi için ayrı transaction yazılıyordu, ancak mevcut şema ve sahiplik muhafızlarından geçmiyordu. | Sütun 2 (katı sözleşme) | `runInventoryNoRename` yazmadan önce mevcut muhafızları çağırır: `_schemaGuardError`, `_ownerGuardError`, `_bulkLockBlocks`, `_maintenanceBlocksWrite`. |
| 4 | Numara kilidi yalnız istemci ve servis katmanındaydı. | Sütun 2 ("kurallar veritabanı kapısında kilitlenir") | Kurallarda b1/b2 için kilit eklenir. Dolu `envanterNo` yalnız şu koşulla değişebilir: aynı commit'te oluşturulan, eşleşen bir denetim kaydının kimliği yeni `sonEnvanterNoDegisimId` alanında olmalı (`!exists` + `getAfter`). Bu, `sonCikisId` deseninin aynısıdır. Dolu numarayı boşaltmak reddedilir; geri yükleme kilidi (`restoreLockOn`) muafiyeti korunur. |
| 5 | Değişimden sonra cihaz geçmişi eski numarada kopuyordu. | Sütun 1 (geçmiş üzerine yazılamaz) | Denetim kaydına yapısal `fromValue` ve `toValue` alanları eklenir (auditLogs `hasOnly` genişler, `noTag`, ≤128). Cihaz geçmişi görünümü bu eşlemelerle eski numaranın geçmişini de gösterir (yalnız yönetici; auditLogs'u yalnız yönetici okur). |
| 6 | Raf yaşam döngüsü ve sayım düzeltmesi iz bırakmıyordu. | Sütun 3 | Bu işlemler aynı transaction'da `serverTimestamp` ile denetim kaydı yazar: `raf-eklendi`, `raf-sayima-alindi`, `raf-sayim-bitti`, `raf-silindi`, `raf-adi-duzeltildi`, `sayim-duzeltme` (`qty` = fark). |

**Uyumlu olanlar:**
- **Spark planı:** Cloud Functions yok; çözüm istemci transaction'ları ve kurallar.
- **SDK yalnız servis katmanında:** `src/services`; UI/modüller `window.*` servisleri çağırır (Sütun 4).
- **Kapalı şema genişler, gevşemez.** Yeni b1/b2 isteğe bağlı alanları `rafPasif` (boolean) ve `sonEnvanterNoDegisimId` (string ≤80), tip denetimiyle `B1/B2_OPTIONAL_KEYS`'e girer. Kurallardaki b1/b2 `stockUpdateOk` alan beyaz listesi kullanmıyor; kilit dalı içine eklenir.
- **Personel çıkış kuralının erişim bütçesi değişmez.** Eklenen `old.get('rafPasif', false) != true` belge erişimi yapmaz.
- Eski alanların değişmezliği (`legacyStockPatch`) etkilenmez.
- **Fail-closed:** bayrak ile raf belgesi çelişirse işlem reddedilir; uzlaştırma aracıyla düzeltilir.

**Altyapı yükümlülükleri:**
- `scratch/hosting-files.js` `EXPECTED_COUNT` 108 → **111** (3 yeni dosya) ve açıklama satırı.
- Dockerfile `src/`'yi bütün kopyalar; değişiklik gerekmez. `Mimari ve Geliştirmeler/` hosting ignore ve xss-lint dışında.
- Yeni arayüz `escapeHtml`/DOM API ile yazılır; `lint:xss` temiz kalmalı.
- Yeni yardımcılar `window.AppModules.*` ad alanında olur (H3-B geleneği).
- `firestore.rules` 132 KB; eklemeler birkaç satır.
- Test beklentisi **yalnız** bilinçli sıkılaştırmada değişir (`stock-ledger.test.mjs:291-296` düzenlemede `envanterNo` değişimi artık ret). Walkthrough'da gerekçesiyle yazılır (KURAL 5).

**Bilinçli sınır:** Personelde gizleme ekran düzeyindedir; veri cihaza yine iner. Hareket engeli kurallarla sağlanır. Sunucu tarafında okuma gizleme, tüm satırlara alan göçü ve sorgu filtreli dinleyici ister (KURAL 3 göç aracı). Bu kapsam dışıdır ve sonraki iş olarak önerilir.

## Adım 0 — Commit, dal ve belge klasörü

1. **Commit mesajını düzelt.** H0, Q0, Kullanıcı Kabul, H1, H2, H3-A, H3-B ve H4 belgelerinden (`audits/audit-reports/2026-11-0{8,9}_*`, `2026-11-10_*`) gerçek kapsam çıkarılır.
   - `git commit --amend` yalnız mesajı düzeltir; push edilmemiş.
   - Son satır: `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
2. **Dal:** `git switch -c feat/v3.6-raf-sayim-envanter-no-mobil-form`, mevcut HEAD'den. master çok geride.
3. **Belge klasörü:** `Mimari ve Geliştirmeler/v3.6 Raf yönetimi ve sayım, Envanter No kilidi, mobil ürün formu/`
   - `00 Uygulama Planı ve Mimari Uyum İncelemesi.md`: bu plan.
   - `İP-1 Raf Yönetimi ve Sayım - Implementation Walkthrough.md`
   - `İP-2 Envanter No Kilidi ve Değişim Aracı - Implementation Walkthrough.md`
   - `İP-3 Mobil Ürün Formu - Implementation Walkthrough.md`
   - Gerekirse `İP-n - Test Kanıtları.txt` (komut çıktıları).

**Walkthrough ile ilerleme:**
- Her iş paketi başlarken walkthrough açılır: Durum "Uygulanıyor", talepler ve karşılıkları, planlanan dosyalar.
- Uygulama sırasında güncellenir.
- Testler geçince tamamlanır: Durum "Uygulandı; testler geçti; canlıya yayın yapılmadı".
- Biçim mevcut walkthrough'larla aynı: üst bilgi (Tarih, Dal, Durum, Kapsam), İçindekiler, Talepler ve karşılıkları, Kullanıcının gördüğü davranış, Güvenlik modeli, Teknik akış, Değişen dosyalar, Test ve doğrulama, Yayın adımları (önce kurallar, sonra hosting), Sınırlar, Yerel test walkthrough.
- İş paketinin kodu ve walkthrough'u **aynı commit'te** girer: `feat(raf)`, `feat(envanter-no)`, `feat(form)`.
- Bir paket bitmeden sonrakine geçilmez. Push ve deploy yok.

---

## İP-1 — Raf yönetimi ve sayım kilidi

**Davranış:**
- Sayımdaki raftaki ürünler herkes için B1/B2 tablolarında, aramalarda, mobil kartlarda ve dışa aktarmalarda gizlenir.
- Engellenen işlemler: çıkış, sepet, zimmet, talep, transfer (kaynak ya da hedef), servis/hurda, stoğa ekleyen iade/servis dönüşü, FAB ±, yeni ürün yerleştirme.
- Yönetici bu ürünleri WMS raf panelinde görür ve **"Sayım düzelt"** ile adetlerini günceller.
- Etiket **"Sayımda"** olur; ürün durumu "Pasif" ile karışmaz.

**1a · Sözleşme** (`src/utils/schema.js`)
- `SHELF_OPTIONAL_KEYS = ['lockReason','lockedAt','lockedBy']`.
  - Kilitliyken üçü birlikte bulunur, `active:false` zorunlu, gerekçe 1–300 karakter.
  - `validateShelfDoc`/`buildShelfDoc` buna göre güncellenir.
- Raf yardımcıları: `isShelfCountLocked(shelfDoc)`.
- b1/b2 için `rafPasif` (boolean) ve `sonEnvanterNoDegisimId` (İP-2) isteğe bağlı alanları; satır yardımcısı `isRowCountLocked(row)`.
- `emptyShelves(shelves, b1, b2)`: katalogda olup `adet>0` satırı olmayan raflar.
- Kilit kaldırılırken `rafPasif:false` yazılır; `deleteField` kullanılmaz, çünkü `_clean` (firebase-handler.js:713) onu bozar.

**1b · Kurallar** (`firestore.rules`)
- **`shelfShapeOk` (:821):**
  - 7 alan zorunlu, en çok 10 alan.
  - Kilit alanları ya hep birlikte vardır ya hiç yoktur. Varken `active==false`, gerekçe string 1–300 ve `noTag`.
  - Kilide geçişte `lockedAt == request.time` ve `lockedBy == auth.uid`. Sonraki yazımlarda bu iki değer değişmez.
- **`staffExitStockOk` (:524):** `&& old.get('rafPasif', false) != true`.
- **auditLogs (:890):** `hasOnly` listesine `fromValue` ve `toValue` (string ≤128, `noTag`). İP-2 de kullanır.

**1c · Stok defteri** (asıl karar raf belgesinde; bayrak yalnız kopya)
- **`runStockOps`** (firebase-handler.js:1322): her stok girdisinin raf belgesi transaction'da okunur (personel dahil; okuma izni :838).
  - `planStockOps(entries, datas, shelfDocs)` (:1307) satır bayraklıysa **ya da** rafı kilitliyse `shelf-locked` hatası verir.
  - `createIfMissing` dalı kopyalanmış bayrağı temizler.
- **`StockLedger.planTransfer`** (stock-ledger.js:219-263): kaynak/hedef kilitliyse ya da kaynak satır bayraklıysa reddeder.
- **`planProductSave`** (:319-354):
  - Bayrağı hedef rafın durumuna göre yazar.
  - Kilitli rafa taşımayı ve yeni ürün eklemeyi reddeder.
  - Aynı raf içinde adet düzeltmesine izin verir: `planShelfCounterWrites`'e `allowInactive` geçilir, böylece 0→N `shelf-inactive`'e düşmez.
- **İade/servis dönüşü** (`assignment-service.js:118/136`, `purchase-servises.js:801-828`): erken ve açıklayıcı ret mesajı. "Stoğa ekle" işaretini kaldırarak kapatılabileceği söylenir.

**1d · Raf servisleri** (stock-ledger.js saf planlar + firebase-handler.js yazma; her biri denetim kaydıyla)
- **`createShelf`:** mevcut `planShelfSave`/`saveShelf` (:282/419) kullanılır; raf zaten varsa ret.
- **`setShelfCountLock(depot, code, {locked, reason})`:**
  1. Raf belgesi ve denetim kaydı tek transaction'da yazılır.
  2. Satırlar indeksli taze sorgularla bulunur, `itemShelfCode` ile süzülür.
  3. Bayraklar ≤490'lık parçalar halinde yazılır (`applyItemOps` emsali).
  4. Doğrulama turu yapılır.
  - Arada kalan yarış zararsızdır, çünkü defter raf belgesini okur.
- **`deleteShelf`:**
  - Taze sorgu yapılır; `adet>0` satır varsa ret.
  - `adet=0` satırların `raf` alanı boşaltılır (Havuz) ve bayrakları temizlenir.
  - Sayaç kaymışsa önce `usedSlots:0` yazılır, ayrı commit'te silinir (kural eski değeri okur).
- **Raf adı düzeltme:** yalnız hiçbir satırın göstermediği rafta. Yeni belge ve eskinin silinmesi tek batch'te.
- **Uzlaştırma:** `runShelfSync` (:558) içine saf `planShelfLockSync` eklenir. shelf-matrix.js:609 onay metni güncellenir. Geri yükleme (`admin-backup.js:202-215`) sonrası da çalışır.

**1e · Diğer yazma yolları**
- `stock-import.js:246-262`: kilitli rafa giden satır Havuz'a alınır; raf belgesi `{...s.doc}` üzerinden kurulur, kilit alanları korunur.
- `applyItemOps` bayraklı satırın silinmesini reddeder. `admin-system-control.js:776-782` ve `deleteCriticalGroup` (admin-dashboard.js:1278) bayraklı satırları atlar.
- `bulkAddB2Items` (admin-dashboard.js:202-223) zaten sözleşmeye takılıyor ve tetikleyicisi yok. Kullanılmadığı doğrulanırsa kaldırılır; kullanılıyorsa `runProductSave` yoluna alınır.

**1f · Gizleme** (tek yardımcı `isRowCountLocked`)
- `table-engine.js` `getProcessedData` (:188), filtre kancasından önce. Arama, mobil kart ve satır yaması da kapsanır.
- Bayrak değiştiğinde tam yeniden çizim yapılır (firebase-handler.js:441-469).
- Arama ve listeler: `script.js` `searchForExit`, `searchForCart`, `searchForRequest`, talep onayı adayları (:965), PDF/Excel (:1836/:2179) ve `pdf-generator.js:372`; `inventory-management.js:576` zimmet adayları.
- B1/B2 başlığında yalnız yöneticiye: "N ürün sayımdaki raflarda gizli → Raf Haritası".

**1g · Arayüz** (admin.html `#shelfMatrixTab` :1715-1789, shelf-matrix.js)
- **Araç çubuğu:** "Raf Ekle", ve filtre çipleri "Boş Raflar" ve "Sayımdaki Raflar".
- **Raf kartı menüsü:** Kapasite, Adı düzelt, Sayıma al (gerekçe), Sayımı bitir, Kaldır. Yapılamayan işlemde neden gösterilir.
- **Çekmece:** raftaki tüm satırlar (adet 0 dahil). Kilitli rafta "Sayım düzelt" diyaloğu `window.runProductSave` çağırır.
  - "Rafı değiştir" kilitli satırda gizlenir; taşıma diyaloğunda kilitli raf seçilemez.
- **Diyaloglar:** mevcut `createDialog` (:370) ve DialogStack.
- **AGENTS.md kuralı:** kısa görünür açıklama, bilgi düğmesi ve açılır yardım.
  - Desen: index.html:619-645.
  - `--b3-*` değişkenleri `#b3`'e bağlı, bu yüzden `style.css`'e genel `.panel-intro`/`.panel-help` sınıfları ve aç/kapa yardımcısı eklenir; İP-2 kartı da bunları kullanır.
- **Ürün modalı ve transfer raf listeleri** (ui-components.js:76-93, 209-228, 418-422): kilitli raflar "(Sayımda)" etiketiyle seçilemez; transfer listesi katalogla birleştirilir.

---

## İP-2 — Envanter No plakası ve değişim aracı

**2a · Plaka** (index.html `#productModal`, ui-components.js:178-329, inventory-logic.js:199-277)
- `#prodInventoryNo` başlıkta sağ üste "DEMİRBAŞ NO" plakası olarak taşınır: tek aralıklı yazı, kilit simgesi, metal/altın kenarlık, açık ve koyu tema. `envanterNo` B1 ve B2'de geçerli (schema.js:266-271).
  - Ekle/Kopyala: yazılabilir.
  - Kayıtlı ve dolu: salt okunur rozet, "Değişim: Operasyon Merkezi" ipucu.
  - Kayıtlı ve boş: "Numara ata" ile bir kez yazılabilir.
- `saveProduct` kilitliyken `envanterNo` göndermez.
- `planProductSave` dolu numaranın normalize edilmiş değişimini `envanter-no-locked` ile reddeder. Kurallar da reddeder (uyum #4).

**2b · Saf modül** `src/utils/inventory-no-rename.js` → `window.AppModules.InventoryNoRename`
- **`findMatches(data, query)`:** `normDeviceId`/`deviceKeys` ile arar ve sonuçları cihaz başına gruplar. Kaynaklar:
  - b1/b2
  - açık serviceRecords
  - b3 hurda
  - açık zimmet (b3 ve varsa assignments ikizi)
  - aynı cihaza `productId` ile bağlı, adet 0 kalmış b1/b2 satırı
- Talepten oluşmuş eski zimmetler "değiştirilemez" diye gösterilir.
- **`planRename(group, newNo)`:**
  - Boş yeni numara reddedilir (Sütun 1).
  - `originalData` yalnız nesneyse tam harita olarak yazılır.
  - Yeni numara b1/b2'de, açık zimmette, serviste veya hurdada varsa engellenir; yalnız geçmişte varsa uyarı verilir.
  - Bekleyen iade talebi varsa uyarılır (kurallar değiştirtmez).

**2c · Yazma** `runInventoryNoRename` (firebase-handler.js)
1. Taze, indeksli benzersizlik sorguları çalışır.
2. Muhafızlar çalışır (uyum #3).
3. `runTransaction`: hedefler yeniden okunur, eski değer doğrulanır, alanlar yazılır. b1/b2 satırına `sonEnvanterNoDegisimId` yazılır.
4. Aynı transaction'da denetim kaydı yazılır: `type:'envanter-no-degisim'`, `fromValue`, `toValue`, `result:'approved'`, `ts: serverTimestamp()`. Bunun için `appendAuditLog` (:179-210) içinden `buildAuditRecord` ayrılır.
- **Kurallar:** `stockUpdateOk` içinde envanterNo kilidi (uyum #4). b3, assignments ve serviceRecords'ta değişiklik gerekmez; genel admin güncellemesinde alan listesi yok.
- **Cihaz geçmişi** (`assignment-service.js:206-304`, device-ids.js): `fromValue → toValue` zinciriyle eski kayıtları da gösterir.

**2d · Arayüz:** Operasyon Merkezi kartı (admin.html `#productTypeSettings`, yeni `src/modules/admin/inventory-no-change.js`, `admin-main.js`'ten import)
- Kısa açıklama, bilgi düğmesi ve yardım alanı.
- **Akış:**
  1. Ara.
  2. Sonuç kartları "Bu mu?".
  3. "Evet" ile tüm bilgileri gösteren modal açılır; yeni numara ve gerekçe istenir.
  4. Canlı doğrulama, `showCustomConfirm`, sonuç bildirimi.

---

## İP-3 — Mobil ve dokunmatik ürün formu

- **Yeni `src/ui/form-keyboard-nav.js`** → `window.AppModules.FormKeyboardNav = { attach, nextField, barOffset }`. index.html'e ve admin `#quickProductModal` için admin.html'e yüklenir.
  - `enterkeyhint` değerleri "next" ve son alanda "done".
  - Enter bir sonraki alana geçer; yalnız son alanda kaydeder. Bugün herhangi bir alanda Enter erken kaydediyor.
  - Dokunmatikte (`pointer: coarse`) klavyenin üstüne yapışan çubuk: **‹ Önceki · Sonraki › · Kaydet**. Konum `visualViewport` ve saf `barOffset` ile hesaplanır.
  - Modal görünür alana sığar (`--vv-h`). Odaklanan alan `scrollIntoView({block:'center'})` ile ortalanır.
  - Başlık (plaka ve kapat) ve Kaydet `sticky` olur.
- **Alan düzeni:**
  - Seçimler üstte toplanır: Sütun, Raf, Tür, Durum.
  - Klavye zinciri: Ürün Adı → Marka → Adet → Açıklama → Kaydet.
  - `prodQty` için `inputmode="numeric"`.
- **CSS:** `mobile-responsive.css:296-342`. Genel viewport meta'ya `interactive-widget` eklenmez; alt gezintiyi bozar.

---

## Kritik dosyalar
`src/utils/schema.js`, `src/services/stock-ledger.js`, `src/services/firebase-handler.js`, `firestore.rules`, `src/modules/admin/shelf-matrix.js`, `admin.html`, `index.html`, `src/ui/table-engine.js`, `src/ui/ui-components.js`, `src/modules/inventory-logic.js`, `script.js`, `src/utils/stock-import.js`, `src/services/assignment-service.js`, `style.css`, `mobile-responsive.css`, `dark-theme.css`, `scratch/hosting-files.js`.

Yeni dosyalar: `src/utils/inventory-no-rename.js`, `src/modules/admin/inventory-no-change.js`, `src/ui/form-keyboard-nav.js`.

## Doğrulama (her iş paketinin walkthrough'una kanıtıyla yazılır)
- **Birim testleri** (`npm run test:unit`, node:vm):
  - `stock-schema` ve `shelf-contract`: kilit alanları; eski `active:false` uyumu; `rafPasif` / `sonEnvanterNoDegisimId` tipleri; boş raf listesi.
  - `stock-ledger`: `shelf-locked`; transfer; 0→N düzeltme; numara kilidi; `planShelfLockSync`.
  - `import-shelf-atomic` ve `stock-import`.
  - Yeni `inventory-no-rename` ve `form-keyboard-nav` testleri. Puppeteer'da Enter zinciri ebys-q0-ui deseniyle sınanır.
- **Kurallar** (`npm run test:rules`):
  - Raf kilit şekli; gerekçesiz kilidin reddi; eski `active:false` raflar.
  - Kilitli satırda personel çıkışının reddi.
  - Denetim kaydı olmadan `envanterNo` değişiminin reddi; doğru kayıtla kabulü; boşaltmanın reddi; geri yükleme muafiyeti.
  - auditLogs `fromValue`/`toValue`.
- `npm run test:ledger:emu`, `npm run test:atomic:emu`, `npm run lint:xss`, `node scratch/hosting-files.js` (111), `node scratch/flow-tests.js --emu` (bilinen 3 ilgisiz hata dışında temiz).
- **Tarayıcı** (emülatör):
  - Sayıma alma, gizleme ve engeller; sayım düzeltme; sayımı bitirme.
  - Personelin ürünü görememesi; konsoldan çıkış denemesinin kural tarafından reddi.
  - Boş/dolu rafı kaldırma.
  - Plaka davranışları; depo, servis, hurda ve zimmet üzerinde numara değişimi; denetim kaydı; cihaz geçmişinin sürmesi.
  - Gerçek Android/iPhone'da klavyeyle Sonraki/Önceki/Kaydet.
