# İP-5 script.js SoC Ayrıştırması — Genel Rapor (son kontrol)

> **Tarih:** 13.11.2026
> **Dal:** `feat/v3.6-raf-sayim-envanter-no-mobil-form` (taban `0a40263`)
> **Durum:** Dokuz dilimin (D0–D8) hepsi uygulandı ve her dilimden sonra kalite kapılarından geçti. **Commit yapılmadı** (riskli dilimler D4, D5, D7 nedeniyle kullanıcı kararı); değişiklikler çalışma ağacında. **Canlıya yayın yapılmadı.**
> **Kapsam:** `index.html` ve `admin.html` ortak. `script.js` içinde gömülü kalan Sepet, B3 tablosu, Personel, Talep ve İçe/Dışa aktarma iş mantığı anayasanın SoC ilkesine göre ayrı dosyalara taşındı. Talep silme ID tabanlı yapıldı (tek davranış değişikliği). Dosya baştan yazılmadı; dış kütüphane eklenmedi; doğrudan Firebase SDK çağrısı eklenmedi.
> **Kanıtlar:** [İP-5 - Test Kanıtları.txt](./İP-5%20-%20Test%20Kanıtları.txt) · Plan: [00 Uygulama Planı ve Mimari Uyum İncelemesi](./00%20Uygulama%20Planı%20ve%20Mimari%20Uyum%20İncelemesi.md) › İP-5.

## Özet

| | Önce (taban `0a40263`) | Sonra |
|---|---|---|
| `script.js` | 2350 satır | 539 satır (önyükleme, paylaşılan durum, köprüler) |
| Yeni uygulama dosyası | — | 6 klasik betik, 1950 satır |
| `npm run test:unit` | 389/389 | **395/395** (+3 köprü sözleşmesi, +3 ID tabanlı silme) |
| `npm run test:rules` | bu oturumda ayrıca ölçülmedi | **407/407** (+3 talep silme kuralı dahil) |
| `npm run lint:xss` | 209 sink · izinli 19 · İZİNSİZ 0 | 209 sink · izinli 19 · **İZİNSİZ 0** (kod yer değiştirdi, sink eklenmedi) |
| `npm run smoke` | iki sayfa: pageerror 0, console.error 0, başarısız istek 0 | aynı; CSP ✔ |
| Hosting dosya sayısı | 120 | 126 |
| Ekran testleri | `ebys-stage2-ui` ✔ · `staff-exit-ui` ✔ · `request-flow-e2e` 36 ✔ · `b3-responsive-ui` ✔ | hepsi aynı |
| Davranış eşdeğerliği (HEAD ↔ yeni) | — | 32 senaryodan 30'u birebir aynı; 2 fark yalnız D7'nin bilinçli değişikliği |

## İçindekiler

1. [Talepler ve karşılıkları](#1-talepler-ve-karşılıkları)
2. [Kullanıcının gördüğü davranış](#2-kullanıcının-gördüğü-davranış)
3. [Anatomi ve mimari kararlar](#3-anatomi-ve-mimari-kararlar)
4. [Dilimler](#4-dilimler)
5. [Değişen dosyalar](#5-değişen-dosyalar)
6. [Test ve doğrulama](#6-test-ve-doğrulama)
7. [Süreçte görülen sorunlar](#7-süreçte-görülen-sorunlar)
8. [Yayın adımları](#8-yayın-adımları)
9. [Commit durumu](#9-commit-durumu)
10. [Sınırlar ve kapsam dışı](#10-sınırlar-ve-kapsam-dışı)
11. [Son kontrol listesi (elle)](#11-son-kontrol-listesi-elle)

---

## 1. Talepler ve karşılıkları

| # | Talep | Sonuç |
|---|---|---|
| 1 | `script.js`'in satır/fonksiyon haritası: hangileri modüllere delege edilmiş, hangileri gömülü? | 56 yedek köprünün 56'sı da modüller yüklenince ezilir (delege). Gömülü bloklar §3'te; hepsi taşındı. |
| 2 | Sepet, Tablo ve Personel/Talep blokları; doğrudan Firebase SDK çağrısı yok | Taşınan hiçbir blokta SDK çağrısı yok; yazmalar `runStockOps`, `applyItemOps`, `updateItem`, `removeItem`, `bulkRemove`, `atomicImportStock`, `EBYSDefinitions.savePersonnel` köprülerinden geçer. |
| 3 | `window.data` doğrudan değiştirilmez (ID tabanlı) | Tek ihlal (`saveData('requests', kalanlar)` ile talep silme) D7'de ID tabanlı `removeItem` / `bulkRemove`'a çevrildi. Diğer bloklarda kayıt nesnesi mutasyonu yok. |
| 4 | `onclick="..."` tetikleyicileri kırılmaz, `window.*` köprüleri korunur | Taşıma öncesi `script.js`'in `window`'a eklediği 119 fonksiyon, 6 nesne, 2 boolean ve `window.onclick` aynen var; yeni testle sabitlendi (D0). |
| 5 | Tam dosya yeniden yazımı yok; doğrulanabilir dilimler | 9 dilim; her taşıma, token düzeyinde birebirlik kanıtıyla yapıldı (§3, karar 4). |
| 6 | Kalite kapıları: `lint:xss`, `test:unit`, `smoke` | Her dilimden sonra çalıştı; ek olarak hosting, ekran testleri, kural testleri ve davranış eşdeğerliği (§6). |
| 7 | Riskli dilimler commit'lenmesin; sorunlar raporlansın | Hiçbir şey commit'lenmedi; görülen sorunlar §7'de. |

## 2. Kullanıcının gördüğü davranış

- **D0–D6, D8:** görünür değişiklik yok. Sepet, B3 tablosu ve kartları, personel penceresi, talep tabloları ve pencereleri, PDF/Excel dışa aktarma ve Excel içe aktarma aynı çalışır; HTML'deki düğmeler aynı adları çağırır.
- **D7 (talep silme):**
  - Tek talep silmede yazma reddedilirse talep artık ekrandan kaybolmaz; "Silme kaydedilemedi." uyarısı görünür ve liste aynen kalır. Önceden liste yazmadan önce değiştiriliyordu.
  - Toplu silmede başarı mesajı seçilen kutu sayısını değil, gerçekten silinen kayıt sayısını söyler. Seçilenlerin hiçbiri listede yoksa "Seçili talepler listede bulunamadı; liste güncellenmiş olabilir." uyarısı görünür ve yazma yapılmaz.
  - 490'dan fazla talep seçilirse silme 490'lık parçalarla yapılır. Bir parça reddedilirse kaç kaydın silindiği ve kaçının silinemediği söylenir; tablo tazelenir.

## 3. Anatomi ve mimari kararlar

**Taşıma öncesi `script.js` (2350 satır):**

| Satır (taban) | Blok | Nereye |
|---|---|---|
| 150–380 | 56 yedek köprü (`window.X = window.X \|\| …`); hepsi modül yüklenince eziliyor | `script.js`'te kaldı |
| 382–469 | `switchTab`, `getActiveProductTypes`, `checkIsDemirbas` | `script.js`'te kaldı |
| 470–642 | Personel penceresi ve kaydı | D3 |
| 644–822 | Talep tabloları | D4 |
| 824–1245 | Talep işlemleri ve pencereleri | D5 |
| 1247–1453 | Sepet / Toplu Çıkış | D1 |
| 1455–1554 | Talep araması, çıkış araması, talep türü | D4, D1 |
| 1556–1838 | B3 hareket tablosu ve kartları | D2 |
| 1840–2231, 2336–2348 | PDF / Excel dışa aktarma, Excel içe aktarma | D6 |
| 2291–2334 | Arşiv e-postası, toplu talep seçimi ve silme | D5 |

**Kararlar** (anayasa §2 ad alanı ve köprü istisnası, §3 SoC, §5 mutasyonsuz durum, §6 toplu yazma, §10 dosyayı baştan yazmama):

1. **Klasik betik, deterministik sıra.** Yeni dosyalar ES modülü değil. Bugün bu fonksiyonlar ES modüllerinden önce tanımlı ve `main.js`, `admin-dashboard.js`, `security.js` ile inline `onclick` buna güveniyor. Altı dosya iki sayfada `<script src="script.js">`'ten **hemen sonra**, aynı sırayla yüklenir. Desen mevcut `return-requests.js` / `manual-exits.js` ile aynı: IIFE + `window.AppModules.<Modül>` + `window.*` köprüleri. `'use strict'` eklenmedi.
2. **Köprü sözleşmesi.** IIFE içine giren `function` bildirimleri global olmaktan çıkar; HTML'deki ve JS ile üretilen `onclick` metinleri ise global kapsamda çalışır. Bu yüzden taşıma öncesi global olan **her ad** aynı adla `window`'da tutuldu. Liste, taban `script.js` gerçek Chrome'da yüklenerek çıkarıldı ve testte sabitlendi.
3. **Başka dosyanın ezdiği adlar üst düzeyde kaldı.** IIFE içindeki çıplak çağrı yerel fonksiyona gider; başka bir dosya aynı adı `window`'da eziyorsa o ezme atlanırdı. Tarama iki ad buldu: `getRandomCode` (`personel.js`) ve `exportTableToExcel` (`pdf-generator.js`). Bu iki bildirim yeni dosyalarda üst düzeyde kaldı; hangi tanımın geçerli olacağı bugünkü gibi sayfadaki yükleme sırasına bağlı (index: yeni dosya, admin: `personel.js` / `pdf-generator.js`). Başka hiçbir taşınan ad sarmalanmıyor ya da ezilmiyor (`self-approval-reporter.js` artık `confirmRequest`'i sarmalamıyor).
4. **Bayt düzeyinde taşıma.** Gövdeler aynen taşındı; IIFE girintisi yalnız kod satırlarına eklendi, şablon ve dize içinde başlayan satırlara dokunulmadı. Taşıma aracı:
   - orijinal aralıkların acorn token dizisinin (şablon ham içerikleri dahil) taşınan kodla birebir aynı olduğunu,
   - `script.js`'ten çıkan token sayısının taşınanla eşit olduğunu

   kanıtlamadan dosya yazmadı. Toplam 17.579 token taşındı. Taşınan koda yapılan tek elle değişiklik, artık yanlış olan iki yorumdur ("monolith'te bırakıldı", "Diğer monolith tablolar").
5. **Paylaşılan durum yerinde kaldı.** `TZ`, `INV_CONFIG`, `currentPage`, `pageSize`, `currentSortColumn`, `isAscending`, `currentExitRepo`, `currentExitIndex` diğer dosyalar tarafından global kapsamdan okunur; `script.js`'te kaldı. Taşınan yardımcı `const`'ların (ör. `_findRequest`, `NO_STOCK`) başka dosyada kullanımı yok.
6. **Yüklemede çalışan kod.** Taşınan bloklardaki yükleme anı ifadeleri (`matchMedia` dinleyicisi, "Tümünü Seç" `change` dinleyicisi, sabitler) kendi dosyalarıyla birlikte aynı sırada çalışır. `script.js`'in yüklemede taşınan bir fonksiyonu çağırdığı yer yok.

## 4. Dilimler

| Dilim | Kapsam | Yeni dosya → ad alanı | Satır / token | Doğrulama | Ağaç (tree) |
|---|---|---|---|---|---|
| D0 | Köprü sözleşmesi testi | `tests/unit/script-bridge-contract.test.mjs` | — | 3/3; köprü kaldırılınca 8 eksik adı yakaladığı gösterildi | `fdd965a` |
| D1 | Sepet / Toplu Çıkış, çıkış araması | `src/ui/stock-exit-cart.js` → `ExitCart` | 250 / 2909 | tüm kapılar ✔ | `e5fafd5` |
| D2 | B3 tablo/kart, B3 PDF, toplu silme | `src/ui/movement-table.js` → `MovementTable` | 283 / 2293 | tüm kapılar ✔, `b3-responsive-ui` ✔ | `3d56836` |
| D3 | Personel penceresi ve kaydı | `src/ui/personnel-modal.js` → `PersonnelModal` | 172 / 1944 | tüm kapılar ✔, `ebys-stage2-ui` ✔ | `77f73b3` |
| D4 | Talep tabloları, talep araması, talep türü | `src/ui/request-tables.js` → `RequestTables` | 234 / 1934 | tüm kapılar ✔, `request-flow-e2e` 36 ✔ | `220e97f` |
| D5 | Talep işlemleri ve pencereleri | `src/modules/request-actions.js` → `RequestActions` | 466 / 4815 | tüm kapılar ✔, `request-flow-e2e` 36 ✔ | `2337b2c` |
| D6 | PDF/Excel dışa aktarma, Excel içe aktarma | `src/ui/stock-import-export.js` → `StockImportExport` | 405 / 3684 | tüm kapılar ✔ (smoke ilk denemede zaman aşımı, §7), eşdeğerlik 32/32 | `7492228` |
| D7 | **Davranış:** talep silme ID tabanlı | `request-actions.js` | — | yeni birim testi 3/3, yeni kural testi 3/3, tüm kapılar ✔ | `3859e83` |
| D8 | Kapanış: `script.js` başlık haritası, belgeler | — | — | son koşu (§6) | çalışma ağacının son hâli |

## 5. Değişen dosyalar

| Dosya | Değişiklik |
|---|---|
| `script.js` | 1822 satır çıktı (yalnız taşınan bloklar), başlığa 11 satırlık dosya haritası eklendi. Kalan kod satırı değişmedi. |
| `src/ui/stock-exit-cart.js`, `src/ui/movement-table.js`, `src/ui/personnel-modal.js`, `src/ui/request-tables.js`, `src/modules/request-actions.js`, `src/ui/stock-import-export.js` | Yeni. Taşınan gövde + `[WHY]/[HOW]` başlığı + köprüler + dondurulmuş `AppModules` ad alanı. LF satır sonu. |
| `index.html`, `admin.html` | `script.js`'ten hemen sonra 6 `<script>` satırı. `admin.html`'de personel penceresi yorumundaki dosya adı güncellendi. |
| `src/modules/request-actions.js` (D7) | `deleteRequest` → `removeItem`; `deleteSelectedRequests` → bilinen id'ler, `bulkRemove`, 490'lık parçalar. |
| `personel.js`, `pdf-generator.js`, `src/modules/return-requests.js`, `src/modules/self-approval-reporter.js`, `src/utils/stock-import.js` | Yalnız yorumdaki dosya adı (`script.js` → yeni dosya). Kod değişmedi. |
| `tests/unit/script-bridge-contract.test.mjs` | Yeni (D0): klasik zincirin iki sayfadaki sırası, taşıma öncesi global sözleşme, paylaşılan `let/const`, `AppModules` ad alanlarının köprülerle aynı fonksiyon olması. |
| `tests/unit/request-delete-by-id.test.mjs` | Yeni (D7): `saveData` hiç çağrılmaz, `window.data.requests` değişmez, yalnız seçili ve bilinen id'ler silinir, red, boş seçim, 490 parçalama ve kısmi başarısızlık. |
| `tests/rules/request-delete.test.mjs` | Yeni (D7): yönetici tekil ve toplu (tek batch) silebilir; personel kendi talebini bile silemez. |
| `scratch/hosting-files.js` | `EXPECTED_COUNT` 120 → 126, gerekçe yorumu. |
| `scratch/staff-exit-ui.cjs`, `scratch/request-flow-e2e.cjs` | `script.js`'ten sonra yeni zinciri sayfadaki sırayla yükler. |
| `scratch/ebys-stage2-ui.cjs` | `script.js`'i metin işaretiyle dilimlemek yerine `personnel-modal.js`'i yükler. |
| `scratch/flow-tests.js` | `guardInConfirmRequest` denetimi `request-actions.js`'te arar. |
| `scratch/b3-responsive-ui.cjs` | **Git'te izlenmeyen yerel dosya.** `script.js` dilimi yerine `movement-table.js`'i yükler. Orijinali scratchpad'e yedeklendi. |

## 6. Test ve doğrulama

Ham çıktılar [İP-5 - Test Kanıtları.txt](./İP-5%20-%20Test%20Kanıtları.txt) dosyasındadır.

**Her dilimden sonra çalışan kapılar:**
- `node scratch/hosting-files.js`
- `npm run lint:xss`
- `npm run test:unit`
- `npm run smoke`
- `scratch/ebys-stage2-ui.cjs`, `scratch/b3-responsive-ui.cjs`
- `scratch/staff-exit-ui.cjs` ve `scratch/request-flow-e2e.cjs`: `tests/rules/firebase.rules-test.json` ile 8180'de açılıp kapanan geçici emülatörde. Yerelde çalışan geliştirme emülatörüne (8080/9099) ve dev sunucusuna (5500) dokunulmadı; tohum yapılmadı.

| Kapı | Taban | D1 | D2 | D3 | D4 | D5 | D6 | D7 | Son |
|---|---|---|---|---|---|---|---|---|---|
| test:unit | 389 | 392 | 392 | 392 | 392 | 392 | 392 | 395 | 395 |
| lint:xss İZİNSİZ | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| smoke | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔¹ | ✔ | ✔ |
| hosting | 120 | 121 | 122 | 123 | 124 | 125 | 126 | 126 | 126 |
| request-flow-e2e | 36 ✔ | 36 ✔ | 36 ✔ | 36 ✔ | 36 ✔ | 36 ✔ | 36 ✔ | 36 ✔ | 36 ✔ |
| staff-exit-ui / ebys-stage2-ui / b3 | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |

¹ İlk denemede 30 sn gezinme zaman aşımı; aynı kodla yeniden denemede temiz (§7).

**Ek kanıtlar:**

1. **Köprü sözleşmesi testinin yakalama gücü.** D1'de sepet taşındıktan sonra, zincir henüz teste eklenmeden çalıştırıldı. Test 8 eksik adı (`openCartModal`, `searchForExit`, …) tek tek listeleyerek başarısız oldu.
2. **D7 testinin yakalama gücü.** Yeni birim testi düzeltmeden **önceki** kodla çalıştırıldı ve 3/3 başarısız oldu (`saveData` çağrısını yakaladı). Düzeltmeden sonra 3/3 geçti.
3. **Davranış eşdeğerliği.** İki ayrı Chrome sayfasında gerçek `index.html` DOM'u ve sayfadaki bütün klasik betikler aynı sırayla kuruldu. A sayfası taban `script.js`'i, B sayfası yeni zinciri yükledi; saat ve rastgelelik sabitlendi, veri katmanı aynı taklitlerle gözlendi. 32 senaryonun her birinden sonra şunlar karşılaştırıldı: dönüş değeri, hata, veri katmanı çağrıları, uyarılar, `window.data` ve DOM.
   - **D6 sonunda:** 32/32 aynı.
   - **D7 sonunda:** 30/32 aynı. Fark yalnız iki silme senaryosundaki çağrı biçimi: `saveData('requests', <kalan liste>)` → `removeItem('requests','r2')` / `bulkRemove('requests',['r1','r2'])`. Uyarılar, DOM ve `window.data` aynı.
   - **Senaryolar:** B3 tablo ve kart, üç talep tablosu, talep ve sepet ve çıkış araması, sepet penceresi, personel penceresi (ekle/düzenle/kapat), red ve onay pencereleri, geri çekme ve taslak gönderme (taklit kullanıcı talebin sahibi sayılmadığı için yalnız "talep bulunamadı" koruma yolu; tam akışları `request-flow-e2e` kapsar), red (gerekçe penceresinde bekler), tekil ve toplu silme, arşiv e-postası, B1/B3 Excel ve PDF, içe aktarma yardımı, CSV içe aktarma (doğrulama hatası yolu), `getRandomCode`, `exportTableToExcel`.
4. **Kurallar.** `npm run test:rules` 407/407; bunun 3'ü bu işin eklediği `tests/rules/request-delete.test.mjs`.
5. **Son koşu (D8 sonrası, tek seferde):** hosting 126/126 · lint:xss İZİNSİZ 0 · test:unit 395/395 · smoke ✔ · ebys-stage2-ui ✔ · staff-exit-ui ✔ · request-flow-e2e 36 ✔ · b3-responsive-ui ✔ · test:rules 407/407 · eşdeğerlik 30/30 (iki bilinçli D7 senaryosu hariç).

## 7. Süreçte görülen sorunlar

| # | Sorun | Etki | Durum |
|---|---|---|---|
| 1 | `scratch/kj6-delegation-check.cjs` **tabanda zaten kırık**: `table-engine.js`'ten seçtiği AST düğümleri arasında v3.6'da eklenen `_renderCountLockNotice` yok (`ReferenceError`). Ayrıca önce Edge'i seçiyor ve Edge bu makinede başlamıyor. | Bu işle ilgisiz; `script.js` okumuyor. | Düzeltilmedi; ayrı iş. Seçim listesine `_renderCountLockNotice` eklenmeli. |
| 2 | D6 kapısında `npm run smoke` bir kez 30 sn gezinme zaman aşımına düştü. | Sayfalar CDN'den de kaynak yüklüyor. | Aynı kodla hemen yeniden denendi: temiz. Sonraki D7 ve son koşu temiz. |
| 3 | `src/modules/return-requests.js`, `self-approval-reporter.js`, `pdf-generator.js`, `src/utils/stock-import.js` çalışma ağacında CRLF, index'te LF'ydi. Git bunu stat önbelleği yüzünden "değişmemiş" gösteriyordu; tek satırlık yorum düzeltmesi tüm dosyayı değişmiş gösterdi. | Diff gürültüsü. | Dört dosya HEAD ile aynı LF'ye çevrildi; diff'ler 1 satır. `src/ui/table-engine.js`'te de aynı gizli durum var; dokunulmadı. |
| 4 | Düzenleme aracı `scratch/request-flow-e2e.cjs`'i bir kez CRLF'ye çevirdi. | Diff gürültüsü. | Geri LF yapıldı; her kapıya "index ↔ çalışma ağacı satır sonu uyumsuzluğu" denetimi eklendi (hepsi temiz). |
| 5 | `scratch/flow-tests.js` çalıştırılmadı. | `--emu` olmadan `inventory_demo`'ya yazar; `--emu` yerelde çalışan ve sizin veriniz olan emülatörü ister. | Yalnız `guardInConfirmRequest` yolu güncellendi. §11'de önerildi. |
| 6 | `request-flow-e2e` tabanda 18 senaryo gibi görünmüştü. | Yalnız çıktının son kısmı okunmuştu. | Tam koşu 36 benzersiz senaryo; tüm dilimlerde 36 ✔. |

## 8. Yayın adımları

1. Statik dosyalar: `index.html`, `admin.html`, `script.js` ve 6 yeni dosya (`src/` Docker imajına ve Firebase Hosting'e zaten tümüyle gider). Derleme adımı yok.
2. `node scratch/hosting-files.js` → 126/126 olmalı.
3. Firestore kuralı, indeks ya da şema değişikliği **yok**. D7 aynı `delete` işlemini gönderir; kural testi bunu sabitler.
4. Önbellek: `.html` ve `.js` hem Firebase Hosting'de (`firebase.json` › `**/*.@(js|css|html)`) hem nginx'te (`nginx/snippets/site.inc`) `Cache-Control: no-cache` ile sunulur; her yüklemede yeniden doğrulanır, eski `index.html` ile yeni `script.js` karışımı beklenmez. Yine de karışırsa: yeni `index.html` + eski `script.js` zararsızdır (adlar aynı kodla iki kez tanımlanır); eski `index.html` + yeni `script.js` taşınan işlevleri eksik bırakır. Bu yüzden `index.html`, `admin.html`, `script.js` ve 6 yeni dosya **aynı yayında** gitmelidir.
5. Yayın sonrası: tarayıcı konsolunda `Object.keys(AppModules)` içinde `ExitCart`, `MovementTable`, `PersonnelModal`, `RequestTables`, `RequestActions`, `StockImportExport` görünmeli.

## 9. Commit durumu

Commit yapılmadı. Her dilimin sonunda, gerçek index'e ve dallara dokunmadan geçici bir index ile "HEAD + o ana kadarki dosyalar"ın git ağacı kaydedildi (§4 tablosundaki tree kimlikleri). İstendiğinde dilim dilim commit bu ağaçlardan sırayla üretilebilir; bu raporun ve kontrol listesinin değişiklikleri son commit'e girer. Önerilen sıra ve mesajlar (Türkçe, Co-Authored-By satırı olmadan):

1. `test(script): köprü sözleşmesi testi (v3.6 İP-5 · D0)`
2. `refactor(script): Sepet / Toplu Çıkış src/ui/stock-exit-cart.js'e (D1)`
3. `refactor(script): B3 hareket tablosu src/ui/movement-table.js'e (D2)`
4. `refactor(script): personel penceresi src/ui/personnel-modal.js'e (D3)`
5. `refactor(script): talep tabloları src/ui/request-tables.js'e (D4)`
6. `refactor(script): talep işlemleri src/modules/request-actions.js'e (D5)`
7. `refactor(script): içe/dışa aktarma src/ui/stock-import-export.js'e (D6)`
8. `fix(talepler): talep silme ID tabanlı — removeItem / bulkRemove (D7)`
9. `docs(v3.6): İP-5 genel rapor, kanıtlar, kontrol listesi; script.js başlık haritası (D8)`

`scratch/b3-responsive-ui.cjs` git'te izlenmediği için hiçbir commit'e girmez.

## 10. Sınırlar ve kapsam dışı

- **56 yedek köprü silinmedi.** Modüller yüklenince hepsi eziliyor; silinirse modüller yüklenmeden yapılan bir tıklama sessiz kalmak yerine `ReferenceError` verir.
- **Ölü görünen adlar budanmadı.** Örneğin `toggleAllRequests` hiçbir yerden çağrılmıyor; `_b3*` ve `_fillUnitSelect` gibi yardımcılar yalnız kendi dosyalarında kullanılıyor ama taşıma öncesi global oldukları için `window`'da korunuyor. Budama ayrı bir iş olmalı.
- **Otomatik testlerin kapsamadığı yollar:** Excel içe aktarmanın başarılı yazma yolu (eşdeğerlikte yalnız CSV doğrulama hatası yolu çalıştı) ve sepetin **yönetici** yolu (`staff-exit-ui` personelin tekil ve toplu çıkışını, kurallara karşı tekrarıyla birlikte çalıştırıyor). Bu ikisi için elle kontrol önerilir (§11).
- `switchTab`, `getActiveProductTypes`, `checkIsDemirbas`, `_dx`, `AdminTabs` sicili ve ürün modalı kapatma `script.js`'te kaldı.
- Klasik dosyalar ES modülüne çevrilmedi; çevrilmesi tanımlanma zamanını değiştirir ve inline `onclick` ile modül bağımlılıkları için ayrı bir tasarım ister.

## 11. Son kontrol listesi (elle)

Ortam: `v3.6 Kontrol Listesi.md` › Ortam (emülatör önerilir). Ayrıntılı adımlar orada İP-5 bölümünde.

- [ ] **İki sayfa açılışı:** konsolda kırmızı hata yok; `Object.keys(AppModules)` altı yeni ad alanını içeriyor.
- [ ] **Sepet / Toplu Çıkış:** sepete iki ürün ekle, adet değiştir, birini çıkar, kaydet. B3'te iki kayıt, stok düşmüş.
- [ ] **Tekil çıkış penceresi:** ürün araması listeliyor, kayıt yapılıyor.
- [ ] **B3 tablosu:** masaüstünde tablo, telefon genişliğinde kartlar, "Tümünü Seç", toplu silme, B3 PDF ve Excel.
- [ ] **Personel:** yeni personel ekle (PRI önerisi, kod bir kez gösterilir), düzenle, hesap aç.
- [ ] **Talepler:** personel talebi oluştur, taslak gönder, geri çek. Yönetici onaylar (öz-onay engeli hâlâ çalışıyor) ya da reddeder (gerekçe penceresi).
- [ ] **Talep silme (D7):** tek talep sil; tabloda iki talep seçip toplu sil. Mesaj silinen sayıyı söylüyor.
- [ ] **İçe/Dışa aktarma:** B1 Excel ve PDF; içe aktarma biçim yardımı; küçük bir CSV ile içe aktarma önizlemesi ve kayıt.
- [ ] `node scratch/flow-tests.js --emu` tam regresyonu (kendi emülatörünüzde).
