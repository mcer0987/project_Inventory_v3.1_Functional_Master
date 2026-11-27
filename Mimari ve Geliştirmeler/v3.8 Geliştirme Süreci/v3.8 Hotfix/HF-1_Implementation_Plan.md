# Implementation Plan — `v3.8 Hotfix · HF-1`
**Radar Scroll/Konum, Toplu Tek-Kalem EBYS Aktarımı, Açık Talep Takibi & Servis Kaydı Temeli**

| Alan | Değer |
|---|---|
| **Aktif Rol** | ⚡ **Gemini Neon** — `v3.8 Hotfix HF-1 (Radar UX, Burn-Rate EBYS Takibi & Servis Temeli)` |
| **Taban Dal / Commit** | `feat/v3.8-ux-overhaul` (`4212f56`) |
| **Katmanlar (SoC)** | Utility (`/utils`), View (`/ui`, `/modules/admin`) — `/services` ve `firestore.rules` değişmez |
| **Yeni Dosya** | Yok (`hosting-files.js` `EXPECTED_COUNT = 140` korunur) |
| **Dosya Mülkiyeti (Yalnızca 3 Dosya)** | `src/utils/burn-rate-engine.js`, `src/ui/ebys-purchase-ui.js`, `src/modules/admin/admin-dashboard.js` |
| **Paralel İzolasyon** | `admin.html`, CSS dosyaları (`HF-3`) ve `personel.js`/`staff-*`/`firebase-handler.js` (`HF-2`) kesinlikle değiştirilmez |
| **Test Kuralı** | Bu pakette hiçbir test koşturulmaz; tüm doğrulama (`lint:xss`, `test:unit`, `node --check`, Puppeteer) CTO Denetçisi tarafından yürütülür |

---

## 1. Kod Tabanı Analizi & Kritik Mimari Bulgular

1. **`#opsRadarModal` Kayma Kök Nedeni (`admin.html#L943` & `admin-dashboard.js#L2939-L2986`):**
   - `#opsRadarModal`, `#dashboard-content` (`.admin-tab-content`) içinde yer alır. `.admin-tab-content.active` animasyonu (`tabFadeIn`: `transform: translateY(0)`) ve `.admin-content-visible` transform'u yeni bir CSS *containing block* yarattığından `position: fixed` viewport yerine sekme akışına bağlanır.
   - Açılışta `document.getElementById('opsRadarClose').focus()` (`admin-dashboard.js:2953`) ve kapanışta `card.focus()` (`admin-dashboard.js:2964`) `{ preventScroll: true }` olmadan çağrıldığı için tarayıcı sayfayı zorla kaydırır; arama girdisinde (`admin-dashboard.js:3077`) `fresh.focus()` da benzer sıçramaya yol açabilir.
2. **EBYS Çok Kalem Sınırı & `content` Koruma Bulgusu (`purchase-money.js:6`, `ebys-purchase-schema.js:187`, `ebys-purchase-ui.js:43-67`):**
   - `PurchaseMoney.MAX_ITEMS = 3`, `ebys-purchase-schema.js` (`normalizePurchaseSnapshot`) ve `firestore.rules` (`poItemsOk`) tek talepte `1..3` kalem satırı kabul eder; tek kalem açıklaması en çok **240**, evrak konusu (`metadata.subject`) en çok **240**, evrak gövdesi (`content`) ise en çok **40.000** karakter olabilir (tüm alanlarda `noTag` / `<[a-zA-Z/!?]` yasağı geçerlidir).
   - **Kritik Bulgu (`ebys-purchase-ui.js:57` & `116`):** Mevcut `handleSubmitClick` / `submitPurchaseViaEbys`, `#purDesc` (Açıklama) alanını okumayıp EBYS gövdesini yalnızca ``content: `Satın alma talebi: ${subject}` `` olarak yazmaktadır. Toplu tek-kalem aktarımında `1..N` kalemin ayrıntılı ürün/stok/adet dökümü `#purDesc` içine yazılacağından, **"EBYS süreciyle gönder"** akışında bu dökümün kaybolmaması için `#purDesc` değeri EBYS `content` gövdesine (40.000 karakter sınırı ve idempotency `canonical` imzası dahilinde) eklenmelidir.
3. **Açık Talep Takibi & `ebys-v1` İşaretçi Bulgusu (`ebys-purchase-schema.js:7-8`, `purchase-servises.js:261-300`):**
   - Klasik `savePurchaseRequest` kayıtları `window.data.purchaseOrders` içinde tam alanlarıyla (`urun`, `aciklama`, `items[]`, `durum`, `workflow`) hazır bulunur — sıfır ek Firestore okumasıyla taranabilir.
   - `EBYS süreciyle gönder` (`engineVersion: 'ebys-v1'`) kayıtları ise `window.data.purchaseOrders` içinde yalnızca hafif işaretçi (`id`, `ebysDocumentId`, `engineVersion`, `unitId`, `birim`, `revision`) tutar; `urun`/`items`/`content` alanları `ebysDocuments`/`ebysDrafts` koleksiyonlarındadır (bunlar canlı `onSnapshot` ile `window.data`'ya toplu çekilmez).
   - **Çözüm (Sıfır ek Firestore okuması + Sıfır Rules değişikliği):**
     - `burn-rate-engine.js` içindeki saf `indexActivePurchaseRequests(purchaseOrders, ebysDocuments)` hem tam `purchaseOrders` kayıtlarını hem de verilen `ebysDocuments` listesini tarar ve belge ID'sine göre tekilleştirir.
     - `ebys-purchase-ui.js` üzerinden EBYS satın alma talebi başarıyla gönderildiğinde, yalnızca o belgeye ait hafif metaveri (`id`, `subject`, `description`, `items`, `state: 'in_review'`, `updatedAt`) ortam-köküyle izole edilmiş (`window.AppEnv.COLLECTION_ROOT`) tarayıcı önbelleğine yazılır (`medipol_ebys_po_index_v1:<root>`); `admin-dashboard.js` bunu yalnızca `window.data.purchaseOrders` içinde hâlâ mevcut olan `ebys-v1` işaretçileriyle çapraz doğrulayarak `indexActivePurchaseRequests`'in 2. parametresine aktarır. Böylece hem klasik hem de yeni açılan EBYS talepleri **sıfır ek Firestore okumasıyla** anında **`⏳ Talebi Açık`** rozetine yansır.
4. **Hızlı Çıkış Masası & Servis Kaydı Köprüsü (`admin-dashboard.js:366-417`):**
   - `renderQuickExitDesk` (`lines 366-399`) tarih+saati tek metin düğümü olarak `<td>` içine yazıyor; `HF-3` tarafındaki `.qe-dt`, `.qe-date`, `.qe-time` sınıflarıyla birebir uyumlu iki satırlı yapıya ayrılacak.
   - `HF-3` ajanının `admin.html` Servis Takip başlığına ekleyeceği `onclick="window.openDirectServiceRecordModal && window.openDirectServiceRecordModal()"` (ve olası `[data-action="openDirectServiceRecord"]`) düğmesi için `window.openDirectServiceRecordModal` ve `window.AppModules.DirectServiceIntake` temel köprüsü eklenecek.

---

## 2. Dosya Bazlı Uygulama Planı (Dilim 1 .. Dilim 3)

### Dilim 1 — Saf Motor Genişletmeleri (`src/utils/burn-rate-engine.js`)
> **SoC Kuralı:** DOM, `localStorage` ve Firebase çağrısı kesinlikle içermez; mevcut `buildPurchasePrefillPayload` sözleşmesi ve `tests/unit/burn-rate-engine.test.mjs` testleriyle %100 geriye dönük uyumlu kalır.

1. **Yardımcı Güvenli Metin / Anahtar Temizleyicileri (`// [WHY]` / `// [HOW]`):**
   - `sanitizeNoTag(raw)`: `firestore.rules` `noTag` (`/<[a-zA-Z/!?]/`) reddine düşmemesi için metindeki etiket benzeri `<` karakterlerini güvenli biçimde temizler (`<` → `‹` veya boşluklu).
   - `clipText(raw, maxLen)`: `PurchaseMoney` (`240` / `120`) ve `EBYSDocumentSchema` (`240` / `40000`) sınırlarına uyum sağlar.
   - `normalizeProductKey(raw)`: `normKey(cleanProductName(raw))` dışa açık saf anahtar üretici.

2. **`buildConsolidatedPurchasePrefill(selectedCandidates, opts = {})` (Yeni Saf Fonksiyon):**
   - **Girdi:** `1..N` adet aday (hem `analyzeBurnRate` hem `buildCriticalOrderCandidates` kayıtlarıyla uyumlu; 3 kalem sınırı uygulanmaz).
   - **Tekilleştirme:** Aynı normalize ürün anahtarına sahip mükerrer girişleri birleştirir; geçersiz/boş kayıtları eler.
   - **Tek Birleştirilmiş Kalem Satırı (`items: [singleLine]`):**
     - Tüm seçili ürünler sarf ise: `category: 'Sarf Malzeme'`, `lineDesc: "Toplu Sarf Malzeme İhtiyacı (N Kalem)"`.
     - Demirbaş içeren karma seçimde: `category: 'Toplu Tedarik'`, `lineDesc: "Toplu Envanter ve Sarf Tedariği (N Kalem)"`.
     - `quantity: 1`, `unit: 'Adet'` (`PurchaseItemsUI` yerleşik birimi), `unitPrice: ''`, `currency: 'TRY'`, `taxRate: 0`.
   - **Başlık (`subject`, ≤240 karakter):**
     - `N === 1` ise tek kalemin adı dahil edilir; `N > 1` ise `"Toplu Sarf Malzeme İhtiyacı (N Kalem)"` + ilk 2–3 ürün adından kısa özet (200 karakter sınırında, `sanitizeNoTag` uygulanmış).
   - **Öncelik (`priority`):** Seçili ürünlerden herhangi birinde `currentStock === 0` veya `daysRemaining != null && daysRemaining <= 7` ise `'Acil'`, aksi hâlde `'Hızlı'`.
   - **Ayrıntılı Açıklama (`description`, `#purDesc` ve EBYS `content` için):**
     - Üst özet: `"Toplu EBYS Tedarik Listesi (N Kalem · Toplam Önerilen: T Adet):"`
     - Her kalem için numaralı satır (`1..N`):
       `1. <Ürün Adı> [<Kategori>] — Mevcut: <stok> · Limit: <limit> · Hız: <günlük>/gün · Tahmini: <~X gün | Stok tükendi> · Önerilen: <adet> Adet`
     - Toplam uzunluk `35.000` karakter altında güvenle korunur (`40.000` EBYS üst sınırına pay bırakır).
   - **Çıktı Sözleşmesi:**
     ```js
     {
       subject,
       description,
       priority,
       items: [singleLine], // boş girişte []
       consolidated: true,
       itemCount: clean.length,
       truncatedCount: 0,
       totalSuggestedQty,
       includedKeys,
       includedNames
     }
     ```

3. **`indexActivePurchaseRequests(purchaseOrders = [], ebysDocuments = [])` ve `matchActivePurchaseRequest(index, productName)` (Yeni Saf Fonksiyonlar):**
   - **Kapalı / Hariç Tutulacak Durumlar:**
     - `purchaseOrders`: `durum` / `status` değeri (küçük harf Türkçe normalize) `iptal`, `reddedildi`, `tamamlandı`, `onaylandı`, `kapandı`, `arşiv`, `teslim alındı`, `cancelled`, `canceled`, `rejected`, `completed`, `closed`, `archived`, `approved`, `withdrawn` içerenler; ayrıca `workflow.finished === true`, `workflow.currentState` ∈ `['completed', 'cancelled']` veya `steps.length > 0 && steps.every(s => s.status === 'approved')` olanlar.
     - `ebysDocuments`: yalnızca satın alma belgeleri (`purchaseOrderId`, `documentTypeCode === 'PURCHASE_REQUEST'`, `filePlanCode === 'PURCHASE_REQUEST'`, `metadata.filePlanCode === 'PURCHASE_REQUEST'`, `isPurchase === true`) değerlendirilir; `state` ∈ `['closed', 'archived', 'rejected', 'withdrawn', 'cancelled', 'completed']` olanlar hariç tutulur.
   - **Açık Durum Etiketi Çözümleme:**
     - `draft` / `Taslak` → `'Taslak'`
     - `registered` → `'Kayıtlı'`
     - `in_review` → `'Onay Sürecinde'`
     - `internally_approved` → `'Onaylandı (İcra)'`
     - `pending_execution` → `'İcra Bekliyor'`
     - `returned` → `'İade · Revizyon'`
     - `workflow.currentState === 'suspended'` → `'Askıda'`
     - `workflow.started === true` (aktif adım varsa) → `'Onayda'`
     - `engineVersion === 'ebys-v1'` (ek metaverisiz) → `'EBYS Sürecinde'`
     - Diğer açık `durum` (örn. `'Onay Bekliyor'`, `'İncelemede'`, `'Bekliyor'`, `'Donduruldu'`) → özgün kısa durum metni veya `'Onay Bekliyor'`.
   - **Tekilleştirme:** `ebysDocuments` kaydı ile aynı `id`/`ebysDocumentId`/`purchaseOrderId`'ye sahip `purchaseOrders` (`ebys-v1`) işaretçisi tek mantıksal talep olarak birleştirilir (`ebysDocuments` kapalıysa ilgili işaretçi de kapalı sayılır!).
   - **Ürün Anahtarı Çıkarma (2 Katmanlı Eşleme):**
     - **Katman 1 — Yapısal Anahtarlar (`byKey`):**
       - `items[].description` (jenerik `"Toplu Sarf Malzeme İhtiyacı (...)"` başlığı anahtar olarak kirletilmez)
       - `urun` / `ürün` / `subject` / `metadata.subject` (`"Kritik Stok Tedariği:"`, `"Satın alma talebi:"` önekleri temizlenerek)
       - `aciklama` / `açıklama` / `description` / `content` içindeki yapılandırılmış madde satırları (`- <Ürün>: ...` ve `1. <Ürün> [...] — ...`)
       - Varsa `includedNames` / `includedKeys`
     - **Katman 2 — Sınır-Güvenli Metin Eşleme (`match(nameOrKey)`):**
       - Önce `byKey[targetKey]` O(1) bakılır.
       - Bulunamazsa (`targetKey.length >= 3`), açık taleplerin normalize metin havuzunda (`subject + items + description`) kelime-sınırı korumalı eşleşme yapılır (ör. `"pil"`, `"pilot"` ile yanlış eşleşmez!).
   - **Çıktı Sözleşmesi:**
     ```js
     {
       totalActive,        // benzersiz açık satın alma talebi sayısı
       byKey,              // { [normKey]: { count, latestTitle, latestStatus, latestDocId, latestRef, latestTs } }
       entries,            // normalize açık talep özetleri
       match(nameOrKey)    // -> { count, latestTitle, latestStatus, latestDocId, latestRef } | null
     }
     ```
   - **API İhracı:** `buildConsolidatedPurchasePrefill`, `indexActivePurchaseRequests`, `matchActivePurchaseRequest`, `normalizeProductKey` mevcut frozen `window.AppModules.BurnRate` (ve `module.exports`) nesnesine eklenir.

---

### Dilim 2 — EBYS Satın Alma Ön-Doldurma & Gövde Aktarımı (`src/ui/ebys-purchase-ui.js`)

1. **`openPrefilled(payload = {})` Güncellemesi (`lines 154-185`):**
   - `payload.consolidated === true` algılanır; `PurchaseItemsUI.open({ items: rawItems, budgetMode: 'auto' }, false)` ile **1 toplu kalem satırı** ve `#purDesc` içine tam döküm yerleştirilir (`unitPrice` boş bırakılır, otomatik gönderim yapılmaz).
   - `#purEbysStatus` metni:
     - `consolidated === true` ise:
       `"${itemCount} kalem tek toplu kalem satırında EBYS talebine birleştirildi (ürün/adet dökümü Açıklama alanına eklendi). Birimi ve tahmini bedeli girip \"EBYS süreciyle gönder\" veya \"Talebi Kaydet\" ile onaylayın."`
     - Ayrıca `payload.openRequestWarning` (opsiyonel bilgi notu) verilmişse durum satırına eklenir.
     - Normal (`consolidated !== true`) akış eski davranışını korur.
2. **`submitPurchaseViaEbys` & `handleSubmitClick` Açıklama (`#purDesc`) Korunması (`lines 43-67`, `110-148`):**
   - `handleSubmitClick`, `#purDesc` değerini okuyup `submitPurchaseViaEbys`'e `description` olarak iletir.
   - `submitPurchaseViaEbys`, `desc = String(description || '').trim()` doluysa EBYS `content` alanını ``Satın alma talebi: ${subject}\n\n${desc}`` (en fazla `40.000` karakter) olarak üretir ve `desc`'i idempotency `canonical` imzasına ekler.
   - `openForRevision` (`lines 73-107`): `body?.content` içinde `\n\n` sonrası gövde açıklaması varsa `#purDesc` alanına geri yükler.
3. **Ortam-İzole EBYS Gönderim Önbelleği (Sıfır Ek Firestore Okuması):**
   - `submitPurchaseViaEbys` + `freezePurchaseVersion` başarıyla tamamlandığında (`frozen.documentId`), gönderilen talebin hafif özeti (`{ id: frozen.documentId, purchaseOrderId: frozen.documentId, isPurchase: true, state: 'in_review', subject, description, items: items.map(i => ({ description: i.description })), updatedAt: Date.now() }`) `localStorage` anahtarına (`medipol_ebys_po_index_v1:${window.AppEnv?.COLLECTION_ROOT || 'inventory_demo'}`) en fazla son 50 kayıt tutulacak şekilde kaydedilir (hassas veri/PII içermez; hata durumunda sessiz düşer).
   - `window.AppModules.EBYSPurchaseUI` üzerine salt-okunur `getCachedSubmittedPurchases()` yardımcısı eklenir ve `handleSubmitClick` sonunda açıksa `window.refreshOpsRadar?.()` çağrılır.

---

### Dilim 3 — Operasyon Merkezi Radarları, Hızlı Çıkış Masası & Servis Temeli (`src/modules/admin/admin-dashboard.js`)

1. **Kalem 1 — `#opsRadarModal` Viewport Sabitleme & Scroll Sıfırlama (`lines 2939-3080`):**
   - `ensureModalInBody(modal)` yardımcı fonksiyonu eklenir: `modal.parentElement !== document.body` ise `document.body.appendChild(modal)` ile modalı `.admin-tab-content` transform etkisinden kurtarır (`admin.html`'e dokunulmaz!). Hem `wire()` hem `openOpsRadar()` içinde çağrılır.
   - Gövde kaydırma kilidi: Modal ilk açılışta (`!wasOpen`) mevcut `document.body.style.overflow` değeri saklanır, `document.body.classList.add('ops-radar-open')` ve `document.body.style.overflow = 'hidden'` uygulanır; `closeOpsRadar()` içinde `classList.remove('ops-radar-open')` ve önceki `overflow` geri yüklenir.
   - Yeni radar açılışında `.ops-radar-panel` `scrollTop = 0` yapılır.
   - Tüm odak çağrıları (`opsRadarClose.focus`, `card.focus`, arama kutusu `fresh.focus`) `{ preventScroll: true }` ile korunur.

2. **Kalem 2 & 3 — `ai_burn_rate` & `critical_stock` Sınırsız Toplu Seçim, Tek-Kalem EBYS Aktarımı & Açık Talep Takibi (`lines 2496-3085`):**
   - **Yeni Yerel Durumlar:**
     - `selectedBurnKeys = new Set()` (sınırsız seçim)
     - `selectedCriticalKeys = new Set()` (**3 kalem kilidi kaldırılır**, sınırsız seçim!)
     - `burnHideOpenRequests = false`, `critHideOpenRequests = false`
   - **Açık Talep Okuyucusu (`readActivePurchaseIndex()`):**
     - `window.data.purchaseOrders` ile `window.data.ebysDocuments` (+ `EBYSPurchaseUI.getCachedSubmittedPurchases()`, yalnızca `purchaseOrders` içinde mevcut `ebys-v1` ID'leri doğrulanarak) birleştirilip `BR().indexActivePurchaseRequests(...)` çağrılır. **Sıfır ek Firestore okuması.**
     - `wire()` içinde `onInventoryDataUpdated` dinleyicisi eklenir: `purchaseOrders` güncellendiğinde açık radar `ai_burn_rate` veya `critical_stock` ise `window.refreshOpsRadar()` tetiklenir.
   - **`buildBurnRate(body, actions)` Yenilemesi:**
     - Tablonun ilk sütununa `Seç` onay kutusu (`input.ops-radar-check[data-burn-key]`, `cell('select', 'Seç', cb)`) eklenir; seçili satırlara `.is-selected` verilir.
     - Üst chip'lere `Seçili Kalem` (ve varsa `Açık Talepli`) bilgisi yansıtılır.
     - Araç çubuğuna (`toolbar`), eşleşen açık talep varsa `"Açık Taleplileri Gizle"` aç/kapa segment düğmesi (`data-action="radar-br-toggle-open"`) eklenir.
     - Her satırda `openReq = reqIdx.match(item.name)` eşleşirse `Tahmini Tükenme` (`statusWrap`) hücresine **`⏳ Talebi Açık · <Durum>`** (birden fazlaysa `⏳ N Açık Talep · <Durum>`) rozeti (`ops-radar-pill is-ok`, araç ipucu `title` ile talep başlığı & evrak no) eklenir.
     - Seçili kalemler içinde zaten açık talebi olanlar varsa tablo üstünde bilgilendirici uyarı notu (`ops-radar-note`) gösterilir (ancak talep açma engellenmez).
     - Alt aksiyon çubuğu (`actions`):
       - `1 <= N <= 3` seçiliyse: **`📄 Ayrı Kalemlerle EBYS Talebi (N/3)`** (`radar-ebys-separate`, `data-source="burn"`)
       - Her zaman görünür (`N === 0` iken `disabled`, `N >= 1` iken aktif `.ops-radar-btn-primary`): **`📦 Tamamını Tek Kalemde Birleştir & EBYS Talebi Aç (N Kalem)`** (`radar-ebys-consolidated`, `data-source="burn"`)
       - `critical` veya `warning` kalem varsa hızlı kısayol: **`Tüm Kritik/Uyarıları Tek Kalemde Aktar (M)`** (`radar-ebys-all-urgent`, `data-source="burn"`)
       - `N > 0` ise **`Seçimi Temizle`** (`radar-br-clear`)
       - Mevcut gezinme düğmeleri (`Kritik Sipariş İhtiyacına Geç`, `Satın Alma Sekmesine Git`) korunur.
   - **`buildCriticalStock(body, actions)` Yenilemesi:**
     - 3 kalem checkbox kilidi (`limitReached` / `cb.disabled`) kaldırılır; sınırsız `1..N` seçim desteklenir.
     - Üst chip `EBYS Seçimi: N kalem` olarak güncellenir; açık talep varsa filtre düğmesi (`radar-crit-toggle-open`) ve satır içi **`⏳ Talebi Açık · <Durum>`** rozeti + seçili açık-talep uyarısı eklenir.
     - Alt aksiyon çubuğu (`actions`):
       - `1 <= N <= 3` seçiliyse: **`📄 Ayrı Kalemlerle EBYS Talebi (N/3)`** (`radar-ebys-separate`, `data-source="critical"`)
       - Her zaman görünür (`N === 0` iken `disabled`, `N >= 1` iken aktif `.ops-radar-btn-primary`): **`📦 Tamamını Tek Kalemde Birleştir & EBYS Talebi Aç (N Kalem)`** (`radar-ebys-consolidated`, `data-source="critical"`)
       - Aday varsa hızlı kısayol: **`Tüm Kritik Kalemleri Tek Kalemde Aktar (M)`** (`radar-ebys-all-urgent`, `data-source="critical"`)
       - **`Tümünü Seç`** (`radar-crit-all`) / **`Seçimi Temizle`** (`radar-crit-clear`) + **`Tüketim Tahminleme Motoru`** geçiş düğmesi.
   - **`launchEbysPrefill(candidates, { consolidated, openReqCount })`:**
     - `consolidated: true` ise `BR().buildConsolidatedPurchasePrefill(candidates)`, aksi halde `BR().buildPurchasePrefillPayload(candidates, { maxItems })` üretir; varsa açık talep uyarı notunu ekleyip `EBYSPurchaseUI.openPrefilled(payload)` ile formu açar (otomatik kayıt/submit yapmaz).
   - **`AGENTS.md` Uyumlu Kısa Açıklama & `ⓘ` Yardım Metni Güncellemesi:**
     - `RADARS.critical_stock` ve `RADARS.ai_burn_rate` içindeki `intro` ve `help[]` metinleri toplu tek-kalem aktarımı ve açık EBYS talep rozetini son kullanıcı dilinde açıklar.
   - **XSS Kuralı:** Ops Radar modülünün tamamı yalnızca `document.createElement` + `textContent` (`node(...)`) kullanmaya devam eder (`innerHTML` = 0).

3. **Kalem 4 — Hızlı Envanter Çıkış Masası Kompakt İki Satırlı Tarih/Saat (`lines 366-399`):**
   - Saf `splitQuickExitDateTime(raw)` yardımcısı (`// [WHY]` / `// [HOW]`) eklenir: `DD.MM.YYYY HH:MM[:SS]`, `DD.MM.YYYY, HH:MM` veya `YYYY-MM-DD[T ]HH:MM[:SS]` biçimlerini `{ date, time }` çiftine ayırır (saniye atılarak kompakt `HH:MM` gösterilir).
   - `window.renderQuickExitDesk` içindeki ilk `<td>` şu `lint:xss`-güvenli şablona güncellenir (`HF-3` CSS sınıflarıyla birebir uyumlu):
     ```html
     <td style="padding: 10px 14px; color: var(--color-text-muted);">
         <div class="qe-dt">
             <span class="qe-date"><i class="far fa-calendar-alt me-1 text-primary" style="opacity: 0.7;" aria-hidden="true"></i>${esc(dt.date)}</span>
             ${dt.time ? `<small class="qe-time">${esc(dt.time)}</small>` : ''}
         </div>
     </td>
     ```

4. **Kalem 5 — `"🛠️ Servise Kaydı Aç"` Temel Köprüsü (`admin-dashboard.js`):**
   - `window.openBulkExitComingSoon` (`line 411`) yakınına `// [WHY]` ve `// [HOW]` belgeli `window.openDirectServiceRecordModal` fonksiyonu eklenir:
     - Gelecekteki modül kancasını (sevk akışıyla eşdeğer cihaz/SN seçimi, servis hedefi, arıza açıklaması, atomik stok `Serviste` geçişi + `serviceRecords` kaydı) yorumlarla belgeler.
     - Şimdilik `showAppAlert('🛠️ Doğrudan Servis Kaydı Açma modülü (sevk akışıyla eşdeğer) planlandı ve yakında burada aktif olacak.', 'info')` (yedek: `alert(...)`) çağırır.
   - Anayasa §2 uyumu için `window.AppModules.DirectServiceIntake = Object.freeze({ open: window.openDirectServiceRecordModal, planned: true })` olarak kayıt edilir (`window.openDirectServiceRecordModal` legacy `onclick` köprüsü korunur).
   - Eğer `HF-3` tarafı `[data-action="openDirectServiceRecord"]` ile (`onclick` olmadan) düğme eklerse diye `DOMContentLoaded` sonrası çift tetiklenmeyi önleyen güvenli delegasyon da bağlanır (`!el.hasAttribute('onclick')`).

---

## 3. Riskler, Yan Etki Kontrolü & Paralel Koordinasyon

| Konu | Değerlendirme / Önlem |
|---|---|
| **Mevcut Birim Testleri (`tests/unit/burn-rate-engine.test.mjs`)** | `buildPurchasePrefillPayload`, `analyzeBurnRate` ve `buildCriticalOrderCandidates` imzaları ve çıktıları korunur; mevcut testlerde regresyon riski sıfırdır. |
| **Firestore Rules & `noTag` Güvenliği** | `buildConsolidatedPurchasePrefill` daima `items.length === 1` (`<= MAX_ITEMS = 3`), `description.length <= 240`, `subject.length <= 240`, `content.length <= 40000` ve `<[a-zA-Z/!?]` temizliği üretir. |
| **`HF-3` ile Sınıf & Kanca Uyumu** | `.ops-radar-open`, `.qe-dt`, `.qe-date`, `.qe-time`, `.ops-radar-pill`, `.ops-radar-toolbar`, `.ops-radar-check`, `window.openDirectServiceRecordModal` birebir mutabık adlardır. |
| **`HF-2` ile Sıfır Çakışma** | `script.js`, `personel.js`, `firebase-handler.js`, `security.js`, `staff-lifecycle*` dosyalarına hiç dokunulmaz. |
| **CTO Denetçisi İçin Önerilen Doğrulama Adımları** | Onay ve uygulama sonrasında CTO Denetçisi'nin koşması önerilenler: `npm run lint:xss`, `npm run test:unit`, `node --check` (3 dosya), `buildConsolidatedPurchasePrefill` & `indexActivePurchaseRequests` için yeni birim testleri ve mobilde/masaüstünde `#opsRadarModal` scroll-konum + toplu EBYS + açık talep rozeti Puppeteer kontrolü. |

---

## 4. Durum

- [x] Kod tabanı incelemesi tamamlandı (`burn-rate-engine.js`, `ebys-purchase-ui.js`, `admin-dashboard.js`, `purchase-money.js`, `purchase-servises.js`, `ebys-document-schema.js`, `ebys-purchase-schema.js`, `firestore.rules`, `admin-add-style.css`, `scratch/xss-lint.js`).
- [x] Implementation Plan diske yazıldı.
- [ ] **Kod değişikliği yapılmadı — onay bekleniyor.**
