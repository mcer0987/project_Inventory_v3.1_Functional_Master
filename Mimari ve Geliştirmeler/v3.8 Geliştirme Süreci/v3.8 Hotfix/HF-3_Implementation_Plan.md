# v3.8 Hotfix · HF-3 — Implementation Plan
## Mobil & Dark UX · Zimmet + Tanımlar + `#tablePersonel` Responsive · `purchaseModal` Mobil · `loginModal` Sıfır Scroll

| Alan | Değer |
|---|---|
| **Paket** | `HF-3` (`00_v3.8_Hotfix_Master_Plani.md` §1 → bulgu #2, #4, #5, #6, #7, #9(HTML kısmı), #10, #11, #12, #17) |
| **Taban** | `feat/v3.8-ux-overhaul` (`4212f56`) |
| **Durum** | 🟢 **CTO onayladı ve uygulandı** (ayrışmalar için bkz. §12) |
| **Dokunulacak dosyalar (yalnız bunlar)** | `admin.html`, `index.html`, `admin-add-style.css`, `style.css`, `dark-theme.css`, `login-redesign.css`, `src/modules/admin/inventory-management.js` |
| **Dokunulmayacaklar** | `admin-dashboard.js`, `burn-rate-engine.js`, `ebys-purchase-ui.js` (HF-1) · `script.js`, `personel.js`, `security.js`, `staff-lifecycle*.js`, `firebase-handler.js` (HF-2) · `purchase-items-ui.js`, `ebys-catalog-ui.js`, `purchase-print.css`, `mobile-responsive.css`, `auth-engine.js` (sınır dışı — yalnız **okundu**) |
| **Test** | Ben koşturmadım/koşturmayacağım. Tüm doğrulama CTO Denetçisi'nde (§9'daki ölçülebilir kabul kriterleri) |
| **Güvenlik kapısı** | `npm run lint:xss` → `0 İZİNSİZ`. Yeni HTML yalnız **sabit (literal)** metin/nitelik içerir; kullanıcı verisi enterpolasyonu eklenmez (bkz. §6-5b, §8) |

---

## 0. Önce bilinmesi gerekenler — görev metni ile repo arasındaki sapmalar

Kodu okuyunca görev tanımındaki bazı varsayımların repoda **bulunmadığını** gördüm. Plan gerçek yapıya göre yazıldı; sapmaları onaylamanız yeterli.

| # | Görev metni | Repodaki gerçek durum | Planın kararı |
|---|---|---|---|
| S1 | `#personnelGuideBox` gizlensin | **Böyle bir öğe yok** (`index.html`, `src/`, CSS'te sıfır eşleşme). Giriş kartında "personel rehber kutusu" bulunmuyor. | Gizlenecek gerçek öğeler: `.login-icon-box`, `.login-description`, `#loginForm` çocukları (alanlar, giriş düğmesi, "VEYA", Yönetici Paneli). |
| S2 | `#loginResetRequestPanel` | Gerçek kimlik **`#loginResetPanel`** (`index.html:1672`). | `#loginResetPanel` kullanılır. |
| S3 | `#loginForm` ve rehber gizlensin, yalnız sıfırlama formu kalsın | `#loginResetPanel`, **`#loginForm`'un içinde** (`index.html:1634 → 1672`). `#loginForm`'u gizlersek sıfırlama paneli de kaybolur. | `#loginForm > :not(#loginResetPanel)` gizlenir (§8). |
| S4 | `#assignModal` | Gerçek kimlik **`#assignInventoryModal`**; JS ile `document.body`'ye enjekte edilir (`inventory-management.js:387-501`). | `#assignInventoryModal` + yeni sınıf kancaları. |
| S5 | `enhanceBentoTable` listesine tablolar eklensin | Liste `admin-dashboard.js:2139` içinde (**HF-1'in dosyası**). `#tablePersonel`, `#locationTableBody`, `#adminDefProductTypeTableBody`, `#adminDefUnitTableBody`, `#adminDefTemplateTableBody`, `#ebysDocumentTypesBody` **zaten listede**. `#invAssignmentTable` dinamik çizildiği için `DOMContentLoaded`'da bulunamaz. | Liste **değişmez**. Zimmet tablosu kendi `data-bento`/`data-label` niteliklerini yazar (§6). |
| S6 | "dosya planı ve üst yazı şablonları tabloları" bento olsun | Bu tablolar `src/ui/ebys-catalog-ui.js` tarafından çizilir (`modern-card table-responsive` içinde `modern-table`); dosya HF-3 sınırı dışında ve tablolar bento seçici listesinde yok. | **Yalnız CSS** ile (sarma + kaydırma + koyu tema). Kart (bento) dönüşümü bu pakette yapılamaz → §10'da açık soru. |
| S7 | `.kpi-container` `≤768px`'te taşıyor | `admin-add-style.css:2416/2553` `flex-direction: column` kuralı **ölü**: `style.css:1455` (daha geç yüklenir) `display: grid; repeat(3, 1fr)` tanımlıyor. 3 kart 390px'te 3 sütun kalıyor. | Yalnız bu kapsayıcıya `kpi-container--trio` sınıfı eklenir; mobilde 2+1 ızgara (§3). Ölü kurallara dokunulmaz. |

---

## 1. Kök neden özeti (kodu okuyarak bulundu — CTO tarayıcıda doğrulayacak)

| Kalem | Kök neden | Kanıt |
|---|---|---|
| Radar `ⓘ` / `×` yamuk | `.ops-radar-icon-btn` `padding`/`margin` tanımlamıyor → `style.css:740` `button { padding: 6px 12px; margin: 0 4px }` 34px daireye uygulanıyor. Aynı kural `.ops-radar-seg-btn` ve `.ops-radar-btn`'a `margin: 0 4px` ekleyerek segment genişliğini şişiriyor. | `admin-add-style.css:3183-3193`, `style.css:740-750` |
| Radar araç çubuğu koyu tema | Koyu kurallar sabit slate hex (`#0f172a`, `#334155`) kullanıyor; Space Titanium token'ları (`--color-surface-alt: #172030`, `--color-border: #253045`) değil. `.ops-radar-seg-btn.is-active` için koyu kural **yok**; `.ops-radar-help/-chip/-btn/-icon-btn/-table` metinleri de açık tema renginde. | `admin-add-style.css:3366-3376`, `dark-theme.css:147-160` |
| `.kpi-container` mobil | S7 | — |
| `.sync-status` taşma | `.status-right` satır içi `display:flex`, **sarma yok**; `.action-buttons` (4 öğe, satır içi `gap:10px`) + `.status-mobile-controls` + `.sync-status` + her `.btn-status-action`'da `margin-right:8px`. `#syncText` mobilde zaten gizli ama `#lastSyncTime` ("Just now") ve boşluklar kalıyor. `dark-theme.css:1452-1505` aynı medya sorgusunu **3 kez** `!important` ile tekrarlıyor. | `admin.html:351-407`, `admin-add-style.css:2440-2482`, `dark-theme.css:1451-1505` |
| `purchaseModal` mobil | (a) `.modern-modal-content { overflow:hidden }` (`style.css:1116`) `.modal-content { overflow-y:auto }`'u (`:1070`) eziyor (aynı özgüllük, sonraki kazanır) + `max-height:90vh` → uzun form **kırpılıyor**, Kaydet'e ulaşılamıyor. (b) Satır içi `max-width:650px; margin:50px auto`. (c) `p-4` (`!important`) ve `.modern-modal-header { padding:20px 30px !important }` mobilde ferahlığı yiyor. (d) `purchase-print.css:1` `.purchase-items-table { min-width: 940px }` + `td:first-child { min-width:180px }` → kalem tablosu zorunlu yatay kaydırma. Not: `admin.html` `mobile-responsive.css`'i **yüklemiyor**. | `admin.html:2525-2526`, `style.css:1070,1116`, `purchase-print.css:1-5` |
| `#tablePersonel` / Tanımlar | `style.css:523` `.modern-table td:last-child { display:flex !important; flex-direction:row; min-width:130px }` — **sarma yok**; "Düzenle · Geçici PIN · Askıya Al" tek satıra sıkışıp üst üste biniyor (global `button { margin: 0 4px }` ekliyor). `ID: … · UID: …` `<small>` (display:block) boşluksuz uzun metin. Alt sekme şeridi satır içi `width: fit-content`. Kart gövdelerinde satır içi `min-height: 400px/300px` mobilde boş alan bırakıyor. | `style.css:513-554`, `personel.js:41-59` (okundu), `admin.html:1537-1538, 1579, 1824` |
| Zimmet tablosu | Tablo/kart/sarmalayıcıda kimlik yok; bento sınıfı ve `data-*` yok; tüm `th/td` satır içi stilli (mobilde yatay kaydırma). Filtre `select`'leri 13px (iOS zoom), arama `min-width:200px`; zimmet modal satırı satır içi `grid 1fr 1fr 80px 36px` → 390px'te seçimler ~95px. | `inventory-management.js:232-255, 346-379, 561` |
| Login scroll | Giriş kartı `max-height: min(760px, …)` + `overflow-y:auto`; sıfırlama paneli (~280px) `#loginForm` içine **ekleniyor**, form + alt düğmeler yerinde kalıyor → kart sınırı aşıyor. Sıfırlama alanları (`#loginResetPri`, `#loginResetNote`) `login-redesign.css` alan stillerinden **yoksun** (koyu temada varsayılan görünüm). | `index.html:1665-1703`, `login-redesign.css:47-64, 138-170` |

---

## 2. Kalem 1 — Radar (`#opsRadarModal`) + Hızlı Çıkış Tarih/Saat

**Dosya:** `admin-add-style.css` (yalnız).

### 1a · `ⓘ` ve `×` hizalama (`admin-add-style.css:3183`)
`.ops-radar-icon-btn` bloğuna eklenir:
```css
  display: inline-flex !important;
  align-items: center;
  justify-content: center;
  padding: 0 !important;
  margin: 0 !important;
  line-height: 1 !important;
```
Ek: `.ops-radar-seg-btn, .ops-radar-btn { margin: 0 }` (global `0 4px` boşluğu kalkar; segmentler `gap`'le ayrılır).
`≤768px` bloğuna (`:3378`): `.ops-radar-icon-btn { width: 40px; height: 40px }` — dokunma hedefi.

### 1b · Araç çubuğu koyu tema (Space Titanium)
Mevcut sabit-hex koyu kuralları (`:3371-3376`) **token'lı** sürümle değiştirilir; eksikler eklenir:

| Seçici (`[data-theme="dark"]` altında) | Karar |
|---|---|
| `.ops-radar-seg` | `background: var(--color-surface-alt); border-color: var(--color-border)` |
| `.ops-radar-seg-btn` | `color: #cbd5e1` (net açık gri) |
| `.ops-radar-seg-btn:hover:not(.is-active)` | `background: rgba(148,163,184,.12); color:#f1f5f9` |
| `.ops-radar-seg-btn.is-active` | `background: rgba(96,165,250,.16); color:#bfdbfe; box-shadow: inset 0 0 0 1px rgba(96,165,250,.45)` |
| `.ops-radar-search` | `background: var(--color-surface-alt); border-color: var(--color-border); color:#f1f5f9` |
| `.ops-radar-search::placeholder` | `color:#94a3b8; opacity:1` |
| `.ops-radar-search:focus` | `border-color:#60a5fa; box-shadow:0 0 0 3px rgba(96,165,250,.25); outline:none` |
| `.ops-radar-note`, `.ops-radar-help`, `.ops-radar-chip`, `.ops-radar-btn`, `.ops-radar-icon-btn`, `.ops-radar-empty`, `.ops-radar-table-wrap` | zemin `--color-surface-alt`, kenar `--color-border`, metin `#e2e8f0` |
| `.ops-radar-sub`, `.ops-radar-intro`, `.ops-radar-chip-label` | `color:#a8b5c8` (≥ AA) |
| `.ops-radar-table thead th` / `tbody td, strong` | başlık `#94a3b8`, gövde `#e2e8f0` (bento koyu kuralları `:2683-2701` zaten zemin/kenarı veriyor; yalnız radar-özel metin renkleri eklenir) |
| `.ops-radar-btn-primary` | `background:#2563eb; border-color:#2563eb; color:#fff` (koyuda da okunur) |

Mobil araç çubuğu (`≤768px`): `.ops-radar-toolbar { flex-direction: column; align-items: stretch }`, `.ops-radar-seg { display:flex; width:100% }`, `.ops-radar-seg-btn { flex:1 1 0; min-height:40px; white-space:nowrap }`, `.ops-radar-search { flex:1 1 100%; font-size:16px; min-height:42px }` (iOS zoom yok).

**Kontrast hedefi:** tüm radar metinleri koyu zeminde ≥ 4.5:1 (CTO ölçer; tahmini 6–11:1).

### 1c · Hızlı Çıkış Masası kompakt tarih/saat (HF-1 sınıfları için stil)
HF-1 `renderQuickExitDesk()` içinde `.qe-dt > .qe-date + .qe-time` üretecek. Yalnız stil tanımlanır (yapı HF-1'in):
```css
.qe-dt { display:inline-flex; flex-direction:column; gap:1px; min-width:0; line-height:1.15; }
.qe-date { font-size:.78rem; font-weight:700; color:var(--color-text); white-space:nowrap; }
.qe-time { font-size:.68rem; font-weight:600; color:var(--color-text-muted); font-variant-numeric:tabular-nums; white-space:nowrap; }
[data-theme="dark"] .qe-date { color:#e2e8f0; }
[data-theme="dark"] .qe-time { color:#94a3b8; }
```
Bento kartında (`#quickExitDeskBody`, `Tarih` `meta` çipi) iki satır aynen kalır; taşma olmaz. **Sözleşme:** HF-1 farklı ad kullanırsa bu stil etkisiz kalır, zarar vermez.

---

## 3. Kalem 2 — `.kpi-container` + navbar `.sync-status`

### 2a · Satın Alma & Servis KPI (`admin.html:1419`, `admin-add-style.css`)
- HTML: `class="kpi-container mt-2"` → `class="kpi-container kpi-container--trio mt-2"` (diğer KPI kapsayıcıları etkilenmez).
- CSS (`(0,2,0)` özgüllük; yükleme sırasından bağımsız `style.css` grid'ini ezer):
```css
@media (max-width: 768px) {
  .kpi-container.kpi-container--trio { grid-template-columns: repeat(2, minmax(0,1fr)); gap: 10px; }
  .kpi-container--trio .dashboard-card { min-width:0; padding:12px; }
  .kpi-container--trio .dashboard-card:last-child { grid-column: 1 / -1; }   /* 3. kart tam genişlik */
  .kpi-container--trio .dashboard-card i { margin-right:10px; font-size:20px; flex:0 0 auto; }
  .kpi-container--trio .dashboard-info { min-width:0; }
  .kpi-container--trio .dashboard-title { font-size:.64rem; line-height:1.25; overflow-wrap:anywhere; }
  .kpi-container--trio .dashboard-value { font-size:1.35rem; }
}
@media (max-width: 340px) { .kpi-container.kpi-container--trio { grid-template-columns: 1fr; } }
```
- Koyu tema: `dark-theme.css:436` yalnız `.dashboard-card` zeminini veriyor; `.card-blue/-yellow/-green` değer/ikon renkleri (`#1d4ed8`, `#b45309`) koyu zeminde düşük kontrastlı. `[data-theme="dark"] .kpi-container--trio .card-blue i, … .dashboard-value { color:#93c5fd }` (sarı `#fcd34d`, yeşil `#86efac`) — **yalnız bu kapsayıcıda**; diğer kartlara yayılmaz.

### 2b · `.sync-status` kompakt hap (`admin.html:401-406`, `admin-add-style.css:2440-2482`)
`#syncText` metni `firebase-handler.js:333` tarafından `LIVE SYNC` ↔ `YETKİ YOK` olarak değiştirildiği için **sabit "LIVE" span'ı eklenmez** (durum yalan söylerdi). Bunun yerine:
- HTML: `.sync-status`'a yalnız `title="Canlı veri eşitleme durumu"` (sabit) eklenir.
- `admin-add-style.css` `≤768px`:
  - Mevcut `#syncText { display:none }` (`:2480`) **kaldırılır**; yerine `#syncText { display:inline !important; font-size:.62rem !important; letter-spacing:.04em !important; max-width:11ch; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }`.
  - `#lastSyncTime { display:none !important }`.
  - `.admin-status-bar .status-right { flex:1 1 auto; min-width:0; justify-content:flex-end; flex-wrap:wrap; row-gap:6px; gap:6px !important }`.
  - `.admin-status-bar .action-buttons { margin-right:0 !important; gap:6px !important }` (satır içi `gap:10px` / `me-3` için `!important`).
  - `.admin-status-bar .btn-status-action { margin-right:0 !important }`.
  - `.admin-status-bar .sync-status { flex:0 0 auto; margin-left:auto; padding:6px 10px !important; gap:6px !important }`.
- **Garanti:** `flex-wrap` yedeği sayesinde sığmazsa pill alt satıra iner; **yatay taşma oluşmaz** (`scrollWidth <= innerWidth`). Tahmini 390px yük: ≈ 300–326px / 342px kullanılabilir.
- `dark-theme.css` 3× tekrarlanan `!important` blokları (`:1451-1505`) **silinmez** (kapsam dışı risk); yeni kurallar `.admin-status-bar .…` ile (özgüllük 0,3,0 + gerektiği yerde `!important`) onların üstüne çıkar.

---

## 4. Kalem 3 — `#purchaseModal` tam mobil (`admin.html`, `admin-add-style.css`, `dark-theme.css`)

Modal `purchase-servises.js:1158` ile `display:block` açılır → ortalama `margin:auto` ile yapılır (JS'e dokunulmaz, satır içi `display:none; background` **korunur**).

**HTML (`admin.html:2525-2526`):** iç `div`'den satır içi `style="max-width:650px; margin:50px auto;"` çıkarılır; `class="modal-content modern-modal-content purchase-modal-card"` olur (`#purchaseModal` zaten kimlikli).

**CSS (`admin-add-style.css`, yeni bölüm "HF-3 · purchaseModal"):**
```css
#purchaseModal > .modal-content {            /* masaüstü + mobil ortak */
  width: min(96vw, 680px); max-width: 680px;
  max-height: 92dvh; margin: 4dvh auto;
  overflow-y: auto; overscroll-behavior: contain;   /* .modern-modal-content overflow:hidden'ını ezer */
}
@media (max-width: 768px) {
  #purchaseModal > .modal-content { padding: 14px; margin: 2dvh auto; }
  #purchaseModal .modern-modal-header { padding: 0 0 10px !important; }
  #purchaseModal .modal-body { padding: 10px 0 !important; }            /* p-4 !important'ı ezer */
  #purchaseModal .form-control, #purchaseModal .form-select, #purchaseModal textarea
    { font-size: 16px !important; min-height: 44px; }                    /* iOS zoom yok */
  #purchaseModal .modern-modal-footer { position: sticky; bottom: 0; padding: 10px 0 0; background: var(--color-surface); border-top: 1px solid var(--color-border-light); }
  #purchaseModal .modern-modal-footer .btn, #purchaseModal .btn-modern-save { min-height: 44px; width: 100%; }
}
```
**Kalem satırları (`PurchaseItemsUI` — `purchase-items-ui.js:153-157`, 9 sütun; yalnız CSS ile kart):**
```css
@media (max-width: 768px) {
  #purItemsEditor .table-responsive { overflow: visible; }
  #purItemsEditor .purchase-items-table, #purItemsEditor .purchase-items-table tbody { display:block; min-width:0 !important; width:100%; }
  #purItemsEditor .purchase-items-table thead { display:none; }          /* girişlerde aria-label zaten var */
  #purItemsEditor .purchase-items-table tbody tr { display:grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap:8px 10px; padding:12px; margin-bottom:10px;
      border:1px solid var(--color-border-light); border-radius:12px; background:var(--color-surface-alt); }
  #purItemsEditor .purchase-items-table tbody td { display:block; min-width:0 !important; padding:0 !important; border:0 !important; }
  #purItemsEditor .purchase-items-table tbody td::before { display:block; margin-bottom:3px; font-size:.66rem; font-weight:700; letter-spacing:.05em; text-transform:uppercase; color:var(--color-text-muted); }
  /* sütun sırası sözleşmesi: 1 açıklama · 2 tür · 3 miktar · 4 birim · 5 fiyat · 6 para · 7 KDV · 8 toplam · 9 çıkar */
  … td:nth-child(1)::before{content:"Mal / hizmet"}  td:nth-child(2)::before{content:"Ürün türü"}  td:nth-child(3)::before{content:"Miktar"}
  … td:nth-child(4)::before{content:"Birim"} td:nth-child(5)::before{content:"Birim fiyat"} td:nth-child(6)::before{content:"Para"}
  … td:nth-child(7)::before{content:"KDV %"} td:nth-child(8)::before{content:"Toplam"}
  … td:nth-child(1), td:nth-child(2), td:nth-child(9) { grid-column: 1 / -1; }
  … td input, td select { width:100%; min-width:0 !important; font-size:16px; min-height:40px; }
  … td:nth-child(9) button { width:100%; min-height:40px; }
  #purItemsEditor .d-flex.justify-content-between { flex-wrap: wrap; gap: 8px; }   /* "+ Kalem ekle" ve "Hesaplananı kullan" satırları */
}
```
`#purItemsEditor` (özgüllük 1,x,x) `purchase-print.css`'in `min-width:940px / td min-width` kurallarını ezer. **Sözleşme:** sütun sırası `purchase-items-ui.js:42-54`'e bağlı; sıra değişirse etiketler kayar (§11 risk R3).

**Koyu tema (`dark-theme.css`):** `[data-theme="dark"] #purItemsEditor tbody tr { background: var(--color-surface-alt); border-color: var(--color-border-light) }`, `#purItemsEditor .bg-light { background: var(--color-surface-alt) !important; color: var(--color-text) !important }` (özet kutusu `bg-light`), modal gövde/alt çubuk token zeminleri.

---

## 5. Kalem 4 — `#shelfMatrixTab` ikon + Servis Takip düğmesi (`admin.html`)

- **`:1914`** → `<h2><i class="fas fa-warehouse me-2" aria-hidden="true"></i>Depo Raf Haritası</h2>` (sidebar `:299-300` ile aynı ikon).
- **`:1478` Servis Takip başlığı:** `<h6 class="modern-card-title">` içine düğme koymak başlığın erişilebilir adını bozar ("Servis Takip Servise Kaydı Aç"). Bu yüzden başlık **h6 olarak kalır**, bir satır sarmalayıcı eklenir:
```html
<div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-2">
    <h6 class="modern-card-title m-0"><i class="fas fa-truck-fast me-2 text-warning"></i> Servis Takip</h6>
    <button type="button" class="btn btn-sm btn-outline-warning rounded-pill px-3"
        onclick="window.openDirectServiceRecordModal && window.openDirectServiceRecordModal()">
        <i class="fas fa-tools me-1" aria-hidden="true"></i>Servise Kaydı Aç</button>
</div>
```
Görev metnindeki düğme niteliği/`onclick` birebir korunur; tek fark flex satırının başlığı sarması. `m-0` + `mb-2` ile dikey ritim `.modern-card-title` ile aynı kalır (CTO görsel kontrol). **Sözleşme:** `window.openDirectServiceRecordModal` HF-1'de tanımlanır; yoksa `&&` koruması sessizce hiçbir şey yapmaz. AGENTS.md: panel değil, mevcut kartın eylemi — ek açıklama gerekmez.

---

## 6. Kalem 5 — Zimmet tablosu + sekme + `#assignInventoryModal` (`inventory-management.js`, `admin-add-style.css`)

### 5a · Kapsayıcı kimlikleri (`inventory-management.js:232-255`)
```html
<div id="invTableCard" class="inv-table-card" style="…mevcut…">
  <div id="invTableWrap" class="table-responsive" style="overflow-x:auto;">
    <table id="invAssignmentTable" class="modern-table admin-bento-table" role="table" style="width:100%; font-size:13px;">
      <thead role="rowgroup"><tr role="row">  <th role="columnheader" …> … </th>
```
- `border-collapse:collapse` satır içi stili **çıkarılır** (`modern-table`/bento `separate` düzeni uygulansın; diğer admin tablolarıyla aynı görünüm). Masaüstünde satır kenarlıkları bento kuralıyla (`border-bottom` td) gelir.
- `th/td` satır içi `padding/text-align` stilleri çıkarılır → hizalama `text-center`/`text-end` yardımcı sınıfları ve bento masaüstü kurallarıyla sağlanır. `<tr>` satırındaki `onmouseover/onmouseout` süslemesi bento `tr:hover td` ile aynı sonuç verdiğinden kaldırılır.
- `<tbody id="invTableBody">` aynen kalır (başka kod buna bağlı).

### 5b · `renderTable()` hücre nitelikleri (`:346-379`)
Sabit/literal niteliklerle (enterpolasyon yok):

| Sütun | `data-bento` | `data-label` | Not |
|---|---|---|---|
| Personel | `meta` | `Personel` | tam genişlik çip (`td[data-label="Personel"]`) |
| Ürün / SN | `title` | `Ürün / SN` | kart başlığı — ortak sezgiyle (`BENTO_TITLE_LABEL` `ürün…`) **tutarlı**; ileride HF-1 tabloyu seçici listesine eklese bile rol değişmez |
| Adet / Talep Türü / Öncelik / Tarih·İade | `meta` | sütun adı | 2'li çip ızgarası |
| Durum | `status` | `Durum` | başlık satırında sağda rozet |
| İşlem | `actions` | `İşlem` | alt şerit |
Tüm `td`'ye `role="cell"`, `tr`'ye `role="row"` (blok görünümde tablo anlamı korunur). Boş / yükleniyor satırları: `<tr class="bento-empty-row" role="row"><td colspan="8" data-bento="empty" role="cell">`.

### 5c · CSS (`admin-add-style.css`, "HF-3 · Zimmet")
- `#invAssignmentTable td[data-bento="actions"] > div { flex-direction:row !important; flex-wrap:wrap; width:100%; align-items:stretch }`; içteki düğmeler `flex:1 1 auto; min-height:40px; margin-top:0 !important` (satır içi `margin-top:4px` için `!important`).
- `#invAssignmentTable td[data-label="Personel"], td[data-bento="title"] + … { flex-basis:100% }` (Ürün başlığı + Durum rozeti üst satırda; Personel çipi ikinci satırda tam genişlik).
- KPI ızgarası: `<div>`'e `class="inv-kpi-grid"`; `≤480px` `grid-template-columns: repeat(2,minmax(0,1fr)) !important; gap:10px !important`; kart iç dolgu/rakam boyutu küçülür.
- Filtre barı: `<div>`'e `id="invFilterBar" class="inv-filter-bar"`; `≤768px` `display:grid; grid-template-columns:1fr 1fr`, arama `grid-column:1/-1`, tüm `select/input` `width:100%; min-width:0; font-size:16px !important; min-height:44px !important`.
- Üst eylem düğmeleri: kapsayıcıya `class="inv-head-actions"`; `≤480px` düğmeler `flex:1 1 calc(50% - 5px); justify-content:center`.
- Koyu tema: tablo zemini/kenarı bento + token kurallarından gelir (`:2683-2703`); eklenecek ek yok.

### 5d · `#assignInventoryModal` (`:392-498, 561`)
Satır içi stiller korunur (masaüstü değişmez); yalnız **sınıf kancaları** eklenir: kaplama `assign-modal-overlay`, kart `assign-modal-card`, tür/öncelik ızgarası `assign-type-grid`, alt düğmeler `assign-modal-actions`; satır `class="assign-product-row"` zaten var. CSS (`≤768px`, satır içi için `!important`):
```css
.assign-modal-overlay { align-items:flex-end !important; padding:0 !important; }                /* alt çekmece, radar deseniyle aynı */
.assign-modal-card { width:100% !important; max-width:100% !important; max-height:94dvh !important; border-radius:18px 18px 0 0 !important; }
.assign-type-grid { grid-template-columns:1fr !important; }
.assign-product-row { grid-template-columns:minmax(0,1fr) 44px !important; }
.assign-product-row > .assign-warehouse-sel, .assign-product-row > .assign-product-sel, .assign-product-row > .assign-dev-ids { grid-column:1 / -1; }
.assign-modal-card select, .assign-modal-card input, .assign-modal-card textarea { font-size:16px !important; min-height:44px; }
.assign-modal-actions { flex-direction:column-reverse; } .assign-modal-actions > button { width:100%; min-height:44px; justify-content:center; }
```
Sürüm notu: pastel düğmeler (`#f0fdf4`, `#eff6ff`, `#eef2ff`) koyu temada açık çip olarak kalır; okunabilir ama tema-uyumlu değil → **kapsam dışı P2** (§10-Q4).

---

## 7. Kalem 6 — `#definitionsTab` + `#tablePersonel` (`admin.html`, `admin-add-style.css`)

### 6a · Alt sekme şeridi (`admin.html:1537-1564`)
- Sarmalayıcıdan satır içi `width: fit-content` çıkarılır; `id="defNavBar" class="def-nav-bar mb-4 d-flex flex-wrap gap-2 p-1"` (diğer satır içi renk/kenar korunur).
- CSS:
```css
.def-nav-bar { width: fit-content; max-width: 100%; }
@media (max-width: 768px) {
  .def-nav-bar { width:100%; flex-wrap:nowrap !important; overflow-x:auto; -webkit-overflow-scrolling:touch; scroll-snap-type:x proximity; scrollbar-width:thin; overscroll-behavior-x:contain; }
  .def-nav-bar .def-nav-btn { flex:0 0 auto; white-space:nowrap; min-height:40px; scroll-snap-align:start; }
}
```
- `switchDefTab` (`admin.html:1850`) sonuna 1 satır: `trigger?.scrollIntoView?.({ inline: 'center', block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })` — seçilen sekme şeritte görünür kalır.
- `.def-nav-btn.active` satır içi `<style>` bloğu (`:1841`) korunur.

### 6b · Başlık alanları
`#definitionsTab .admin-section-header` `≤768px`: `flex-wrap:wrap; align-items:flex-start !important; gap:10px 12px; padding:14px 16px`; ilk `div` `flex:1 1 100%; min-width:0`; düğme/`.d-flex` grupları `flex:1 1 auto`; `.btn, .section-guide-link { min-height:40px }`; `h2 { font-size:1.1rem }`. Başlık + buton temiz alt alta/sarar.

### 6c · Tüm Tanımlar tabloları (masaüstü + tablet + mobil ortak düzeltme)
```css
#definitionsTab .modern-table { table-layout: auto; }
#definitionsTab .modern-table th, #definitionsTab .modern-table td { overflow-wrap: anywhere; min-width: 0; }
#definitionsTab .modern-table td:last-child { flex-wrap: wrap !important; gap: 6px !important; justify-content: flex-start; min-width: 120px; }  /* style.css:523 nowrap kök nedeni */
#definitionsTab .modern-table td .edit-btn, #definitionsTab .modern-table td .delete-btn, #definitionsTab .modern-table td button { margin: 0 !important; }
#definitionsTab .modern-table td small { overflow-wrap: anywhere; }
@media (max-width: 768px) { #definitionsTab .table-responsive { min-height: 0 !important; } }   /* satır içi min-height:300/400 */
```
Bu tek kural seti `#locationTableBody`, `#adminDefProductTypeTableBody`, `#adminDefUnitTableBody`, `#adminDefTemplateTableBody`, `#ebysDocumentTypesBody`, `#tablePersonel` **ve** `ebys-catalog-ui.js` ile çizilen dosya planı / üst yazı şablonları tablolarını kapsar. Mobil kart dönüşümü ilk altısında mevcut `admin-bento-table` altyapısıyla zaten var; son ikisi için S6.

### 6d · `#tablePersonel` ek kurallar
- `#tablePersonel td small { display:block; line-height:1.35; margin-top:2px; overflow-wrap:anywhere }` — `ID: … · UID: …` sarar.
- Mobil (`≤768px`) `td[data-bento="actions"]`: `display:flex; flex-wrap:wrap; gap:6px`; `.edit-btn { flex:1 1 calc(50% - 6px); min-height:40px; margin:0; justify-content:center; white-space:nowrap }`; tek kalan son düğme `:nth-child(odd):last-child { flex-basis:100% }` → `Düzenle · Geçici PIN / Askıya Al` (2+1), üst üste binme yok. `Hesap Aç` (hesap hücresi) `margin:0`.
- Hesap hücresi (PRI/e-posta benzeri uzun metin) `overflow-wrap:anywhere`.
- `personel.js` markup'ı değişmez (sınıf/nitelik yok); kurallar yalnız `#tablePersonel` kapsamına bağlı.

### 6e · Koyu tema (Tanımlar)
`.modern-table` koyu kuralları (`dark-theme.css:249-271`) mevcut. Eklenecek:
- `[data-theme="dark"] #definitionsTab .text-dark { color: var(--color-text) !important }` — "🛡️ DEMİRBAŞ OLARAK TANIMLA" etiketi (`admin.html:1621`) koyu zeminde okunmuyor (Bootstrap `.text-dark !important`).
- `[data-theme="dark"] #definitionsTab .def-nav-bar { background: var(--color-surface-alt) !important; border-color: var(--color-border) !important }` (satır içi `var(--color-surface, #fff)`).

---

## 8. Kalem 7 — `#loginModal` hiçbir şartta scroll oluşturmaz (`index.html`, `login-redesign.css`, `style.css`)

> HF-2'nin `staff-lifecycle-panel.js` / `auth-engine.js` dosyalarına **dokunulmaz**. Mevcut `#loginResetPanel.hidden`, `#loginResetToggleBtn`, `#loginResetCancelBtn` kancaları kullanılır (`staff-lifecycle-panel.js:344-356`, okundu).

### 7a · Görünüm yer değiştirme (in-place view switch)
**`index.html` (`:1672`)** — `#loginResetPanel`'in ilk çocuğu olarak "← Giriş Ekranına Dön":
```html
<button type="button" id="loginResetBackBtn" class="login-reset-back"><i class="fas fa-arrow-left" aria-hidden="true"></i> Giriş Ekranına Dön</button>
```
`#loginResetPanel`'e `role="group" aria-label="Şifre sıfırlama talebi"`.

**`index.html` — tek satırlık kanca (modal'dan sonra küçük `<script>`):**
```js
(function () {
  const modal = document.getElementById('loginModal'), panel = document.getElementById('loginResetPanel');
  const back = document.getElementById('loginResetBackBtn'), toggle = document.getElementById('loginResetToggleBtn');
  if (!modal || !panel) return;
  let wasOpen = false;
  const sync = () => {
    const open = !panel.hidden;
    modal.classList.toggle('is-reset-mode', open);
    if (wasOpen && !open && toggle) toggle.focus();            // geri dönünce odak tetikleyicide
    wasOpen = open;
  };
  new MutationObserver(sync).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
  sync();
  const close = () => { const c = document.getElementById('loginResetCancelBtn'); if (c) c.click(); else { panel.hidden = true; if (toggle) toggle.setAttribute('aria-expanded', 'false'); } };
  if (back) back.addEventListener('click', close);
  panel.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
})();
```
**Neden `:has()` değil, sınıf?** `:has(#loginResetPanel:not([hidden]))` Chromium'da tam destekli; ancak desteklemeyen tarayıcıda (Firefox < 121, Safari < 15.4, kiosk/eski kurumsal tarayıcılar) seçici listesindeki tek bir `:has()` **tüm kuralı geçersiz kılar** → sıfırlama modu hiç çalışmaz. Gözlemci HF-2 dosyalarıyla çakışmaz (yalnız `hidden` niteliğini okur) ve her tarayıcıda çalışır. İsterseniz `@supports selector(:has(*))` ile aynı kuralın `:has` ikizi de eklenebilir (§10-Q1).

**`login-redesign.css` — yer değiştirme kuralları:**
```css
#loginModal.is-reset-mode #loginForm > :not(#loginResetPanel) { display: none !important; }   /* alanlar, giriş, VEYA, Yönetici Paneli */
#loginModal.is-reset-mode .login-icon-box,
#loginModal.is-reset-mode .login-description { display: none; }
#loginModal.is-reset-mode #loginResetPanel { margin: 0; padding: 0; border: 0; background: transparent; }
```
Sıfırlama paneli satır içi stilleri sınıflara taşınır (`login-reset-panel/-head/-intro/-help/-actions/-btn/-btn--primary`) ve `--login-*` token'larını kullanır (açık + koyu). `#loginResetPri`, `#loginResetNote` mevcut `#login-pri` alan kuralına (`:138-170`) eklenir (aynı zemin/kenar/odak). AGENTS.md uyumu: kısa görünür açıklama (`Kurumsal kimliğinizle…`) ve `Bilgi` düğmesiyle açılan uzun yardım **korunur**.

### 7b · Sıfır scroll için kart ölçeklemesi
Yükseklik odaklı, **sürekli ölçekleyen** özel özellikler (kademe sıçraması yok); `dvh` desteklemeyen tarayıcı için önce `vh`:
```css
#loginModal.login-modal-v3 {
  --lg-pad-y: clamp(14px, 3.4dvh, 34px);
  --lg-gap:   clamp(8px,  1.7dvh, 16px);
  --lg-field: clamp(42px, 6dvh,   54px);
  --lg-btn:   clamp(42px, 5.8dvh, 52px);
  padding: max(12px, env(safe-area-inset-top,0px)) max(12px, env(safe-area-inset-right,0px)) max(12px, env(safe-area-inset-bottom,0px)) max(12px, env(safe-area-inset-left,0px));
}
#loginModal.login-modal-v3 > .login-card-v3 { max-height: calc(100dvh - 24px - env(safe-area-inset-top,0px) - env(safe-area-inset-bottom,0px)); }
```
`.login-inner-body` dikey dolgusu `--lg-pad-y`, `#loginForm` ve `.modern-input-group` boşlukları `--lg-gap`, alan yüksekliği `--lg-field`, düğme `--lg-btn`, alt bilgi dolgusu `clamp(8px, 1.4dvh, 15px)`.
Yükseklik eşikleri:
- `max-height: 700px` → `.login-icon-box` gizlenir (süs; `aria-hidden`).
- `max-height: 600px` → `.login-description` **görsel olarak gizlenir** (sr-only tekniği; `aria-describedby` hedefi olduğu için `display:none` yapılmaz).
- `max-height: 500px` ve yatay → iki sütun: `.login-inner-body { display:grid; grid-template-columns: minmax(0,.9fr) minmax(0,1.1fr); column-gap:24px; align-items:center }` (sol: eyebrow + başlık, sağ: `#loginForm`), kart `width:min(100%,760px)`, "VEYA" ayırıcı ve alt bilgi gizlenir, sıfırlama modunda `.login-reset-intro` sr-only.

**Tahmini içerik yüksekliği (390×… 360×640 dikey; ön hesap, CTO ölçer):**

| Görünüm | 390×844 | 375×667 | 360×640 | 1366×~650 (masaüstü) |
|---|---|---|---|---|
| Normal giriş | ~650 / 782 ✅ | ~480 / 639 ✅ | ~480 / 612 ✅ | kademe 700/600 devreye girer ✅ |
| Sıfırlama (Bilgi kapalı) | ~490 ✅ | ~490 / 639 ✅ | ~490 / 612 ✅ | ✅ |
| Sıfırlama (Bilgi açık) | ~565 ✅ | ~565 / 639 ✅ | ~565 / 612 ✅ | ✅ |

> Tablodaki sayılar kod okumasından yapılmış **ön hesaptır** (tarayıcıda ölçülmedi; "içerik / kullanılabilir alan", px). Asıl doğrulama CTO'nun G1/G2 ölçümüdür; sapma çıkarsa `--lg-*` `clamp()` sınırları ve `700px/600px` eşikleri ayarlanır.

**Desteklenen ölçüm matrisi ve istisna:** (1) Sanal klavye **kapalıyken** ölçülür — klavye açılınca görünür alan fiziksel olarak küçülür ve tarayıcı odaklı alanı kaydırır; bu kapsam dışıdır. (2) Yatay telefon `≤500px` yükseklikte "Bilgi" kutusu açıkken içerik ~339px'e çıkar ve ~323px'e sığmaz; bu tek durumda kart içi kaydırma **yedek** olarak kalır (kırpmak Gönder düğmesini erişilemez yapar). §10-Q2'de onayınıza sunuldu.

`style.css:1396` `#loginModal .modal-content { width:350px; … gap:0; display:flex !important }` (oturum kilidi) ve `:1154-1190` `login-redesign.css`'in `!important`'larıyla zaten ezildiğinden `style.css` bu kalemde **değişmez** (dosya sınırı içinde ama dokunma gereği yok).

---

## 9. CTO Denetçisi için ölçülebilir kabul kriterleri

Viewport'lar: **390×844**, **375×667**, **360×640**, **768×1024**, **1366×768**, **1920×1080**, **667×375** (yatay). Her biri **Platinum (açık)** ve **Space Titanium (koyu)**.

| # | Kriter | Ölçüm |
|---|---|---|
| A1 | Radar `ⓘ`/`×` dairesel ve ortalı | `getBoundingClientRect` ikon merkezi ≈ buton merkezi (±1px), `getComputedStyle().padding === '0px'` |
| A2 | Radar araç çubuğu koyu: metin/arka plan kontrastı | tüm metinler ≥ 4.5:1; `.is-active` `rgba(96,165,250,.16)` |
| A3 | `.qe-*` taşma yok | Hızlı Çıkış kartında `scrollWidth <= clientWidth` |
| B1 | `.kpi-container--trio` 390'da 2 + tam genişlik 1 | `grid-template-columns` 2 iz; son kart `grid-column: 1/-1`; kart taşması yok |
| B2 | Navbar taşmıyor | `document.documentElement.scrollWidth <= innerWidth` (360, 375, 390, 768) |
| C1 | `purchaseModal` | kart `max-height ≤ 92dvh`, gövde kaydırılabilir, **Kaydet görünür/erişilebilir**; kalem satırı kartı 2 sütun; `input` `font-size` 16px; düğmeler ≥ 40px; yatay taşma 0 |
| D1 | Raf Haritası başlığında `fa-warehouse` | sidebar ikonuyla aynı sınıf |
| D2 | `Servise Kaydı Aç` | başlıkla aynı satırda, dar ekranda sarar; `openDirectServiceRecordModal` tanımlıysa çalışır |
| E1 | Zimmet kimlikleri | `#invTableCard`, `#invTableWrap.table-responsive`, `#invAssignmentTable.modern-table.admin-bento-table` mevcut |
| E2 | Zimmet mobil kart | her `td`'de `data-bento`/`data-label`; 390'da `table.scrollWidth <= clientWidth`; KPI/filtre/`#assignInventoryModal` taşması 0 |
| E3 | Masaüstü eşdeğerliği | 1366×768'de zimmet tablosu sütunları kırılmıyor, satır yüksekliği kabul edilebilir |
| F1 | Sekme şeridi | 390'da `#defNavBar` `scrollWidth > clientWidth` ama **sayfa** taşmıyor; aktif sekme görünür |
| F2 | `#tablePersonel` | işlem düğmeleri `getBoundingClientRect` çakışması yok; `ID/UID` metni sarıyor; 390'da sayfa taşması 0 |
| F3 | Diğer Tanımlar tabloları | 390'da yatay sayfa taşması 0; koyu temada metin kontrastı ≥ 4.5:1 |
| G1 | Login — normal | `#loginModal` ve `.login-card-v3` için `scrollHeight <= clientHeight` (klavye kapalı) |
| G2 | Login — sıfırlama | `#loginResetToggleBtn` tıklanınca `#loginModal.is-reset-mode`; `#loginForm` çocukları + "VEYA" + Yönetici Paneli **görünmez**; yalnız sıfırlama formu + "← Giriş Ekranına Dön"; `scrollHeight <= clientHeight` |
| G3 | Login — geri dönüş | "← Giriş Ekranına Dön" / `Vazgeç` / `Esc` → normal görünüm, odak `#loginResetToggleBtn`'da |
| H | Güvenlik kapısı | `npm run lint:xss` → `0 İZİNSİZ`; mevcut birim testler etkilenmez (JS değişimi yalnız `inventory-management.js` şablonları) |

---

## 10. Açık sorular / onay noktaları (varsayılan = planda yazılı olan)

| # | Soru | Varsayılan |
|---|---|---|
| Q1 | Login yer değiştirme: **sınıf + `MutationObserver`** (öneri) mi, yoksa görev metnindeki saf CSS `:has()` mi? İkisi birlikte (`@supports selector(:has(*))` ikizi) de olur. | Sınıf + gözlemci |
| Q2 | Yatay telefonda (`≤500px` yükseklik) "Bilgi" kutusu açıkken kart içi scroll **istisnası** kabul mü? Fiziksel olarak sığmıyor. | Evet, yalnız bu tek durum |
| Q3 | `#ebysFilePlanPanel` / `#ebysTemplatePanel` tablolarının **mobil kart (bento)** görünümü için HF-1'den (`admin-dashboard.js`) veya `ebys-catalog-ui.js` sahibinden ayrı bir iş mi açılsın? Bu pakette yalnız CSS sarma/kaydırma yapılır. | Ayrı iş (kapsam dışı) |
| Q4 | Zimmet sekmesi ve `#assignInventoryModal` içindeki **pastel açık düğmeler** (`Tutanak`, `Geçmiş`, `Yeni`, `Yeni Ürün`) koyu temaya sınıflandırılsın mı? | Bu pakette yok (P2) |
| Q5 | Mobilde `#lastSyncTime` ("Just now") gizlenmesi kabul mü? Genişlik için gerekli; `title` ipucu eklenir. | Evet |

---

## 11. Riskler ve geri alma

| # | Risk | Önlem / geri alma |
|---|---|---|
| R1 | Zimmet tablosunda satır içi stillerin çıkarılması masaüstü görünümü değiştirebilir (ayrık satır boşlukları `border-spacing: 0 10px` yerine bento `separate/0`) | Bento sınıfı diğer admin tablolarında aynı masaüstü görünümü veriyor; E3 kriteri; geri alma: tablo sınıfından `admin-bento-table` çıkarmak yeterli |
| R2 | `dark-theme.css` 3× tekrarlı `!important` durum çubuğu blokları yeni mobil kuralları ezebilir | Yeni seçiciler `.admin-status-bar .…` (0,3,0) + gerektiği yerde `!important`; B2 kriteri CTO'da doğrulanır |
| R3 | `PurchaseItemsUI` sütun sırası değişirse `::before` etiketleri kayar | Sözleşme §4'te yazılı; `purchase-items-ui.js` sahibi (HF-1 değil, ortak) sırayı değiştirirse buradaki 8 kural güncellenir |
| R4 | `MutationObserver`/sınıf yaklaşımı `#loginResetPanel.hidden` mantığını HF-2 değiştirirse kopar | Kanca yalnız `hidden` niteliğine bağlı; değişirse tek satır (`sync`) güncellenir; `is-reset-mode` yokken eski davranış (panel formun altında) korunur — işlevsel kayıp yok |
| R5 | HF-1 `qe-*` sınıf adlarını değiştirir | §2 · 1c stili etkisiz kalır; zarar yok |
| R6 | Görev metnindeki varsayımların (S1–S7) yanlış anlaşılması | §0 tablosu — onay isteği |

**Uygulama sırası (onaydan sonra, CTO atomik commit için önerilen sınırlar):**
1. `admin-add-style.css` radar (1a, 1b, 1c) + KPI/durum çubuğu CSS (2a, 2b) + `admin.html` işaretlemesi (KPI sınıfı, `sync-status title`).
2. `purchaseModal` (`admin.html` + `admin-add-style.css` + `dark-theme.css`).
3. `admin.html` kalem 4 (raf ikonu + Servise Kaydı Aç) + Tanımlar sekme şeridi / başlıklar / tablo CSS (kalem 6).
4. `inventory-management.js` + zimmet CSS (kalem 5).
5. `index.html` + `login-redesign.css` (kalem 7).

---

## 12. Uygulama notları (CTO onayından sonra) — plandan ayrışmalar

**Durum:** 🟢 Uygulandı · test koşturulmadı (yalnız CSS süslü parantez dengesi ve `node --check` söz dizimi denetimi yapıldı).
**CTO kararları:** Q1 sınıf + `MutationObserver` **ve** `@supports selector(:has(*))` ikizi · Q2 yalnız yatay + "Bilgi" açık iç kart emniyeti · Q3 CSS bu pakette (seçici ekleme HF-1'de) · Q4 pastel düğmeler koyu temaya alındı · Q5 `#lastSyncTime` mobilde gizli, `title` ipucunda korunuyor.

| # | Plan | Uygulamada | Neden |
|---|---|---|---|
| U1 | Servis başlığı sarmalayıcısında `m-0`, `mb-2` | `service-card-head` sınıfı (+ CSS) | **`admin.html` Bootstrap yüklemiyor**; yardımcı sınıflar `admin-add-style.css`'te el yapımı ve `m-0`, `p-1`, `.col-md-*`, `.g-3` **tanımlı değil** |
| U2 | `purchaseModal` için `p-4 !important`'ı ezme | `#purchaseModal .modal-body { padding … !important }` korundu ama gerekçe değişti | `.p-4` admin CSS'inde `!important` değil; zararsız |
| U3 | `purchaseModal` satırları Bootstrap `col-md-*` ile yığılıyor varsayımı | `≤768px` için `#purchaseModal .row` **tek sütun ızgara** (`[class*="col-"] → 1/-1`) | `.col-md-*` hiçbir CSS'te yok; masaüstü düzenine dokunulmadı |
| U4 | `#definitionsTab .text-dark` ve `#purItemsEditor .bg-light` koyu kuralları | **Eklenmedi** | `dark-theme.css:885-891` zaten `[data-theme="dark"] .bg-light/.text-dark` veriyor |
| U5 | `#lastSyncTime` için yalnız `title="…"` | `title` + `admin.html`'de metni `title`'a yansıtan küçük `MutationObserver` betiği | Q5: son eşitleme zamanı kaybolmasın; `#lastSyncTime`'ı yazan dosya HF-1'de, orası değişmedi |
| U6 | `style.css` değişebilir | **Dokunulmadı** | Gerek olmadı (özgüllük ID/sınıf ile çözüldü) |
| U7 | Yatay telefon sıfırlama modunda `.login-reset-intro` görsel gizleme | **Görünür bırakıldı** (yalnız `0.72rem`) | AGENTS.md "kısa ve görünür açıklama" ilkesi |
| U8 | Zimmet `colspan` boş satırı | `#invAssignmentTable td[data-bento="empty"] { display: table-cell !important }` (+ mobil `block`) ve `#definitionsTab` masaüstünde `td[colspan]` | `.modern-table td:last-child { display:flex !important }` colspan'lı son hücreyi tek sütuna hapsediyordu |
| U9 | Koyu temada sıfırlama durum metni | `#loginResetStatus[style*="220, 38, 38"]` vb. koyu tema kuralları | `staff-lifecycle-panel.js` (HF-2) rengi satır içi yazıyor; JS'e dokunmadan AA kontrast |

**Dokunulan dosyalar (yeni dosya yok; `EXPECTED_COUNT = 140` etkilenmedi):** `admin.html`, `index.html`, `admin-add-style.css`, `dark-theme.css`, `login-redesign.css`, `src/modules/admin/inventory-management.js`.

**CTO için ek kontrol noktaları:** (1) B2 — 360/375/390px'te `scrollWidth <= innerWidth` (sarma yedeği devrede olabilir; hap ikinci satıra inebilir) (2) C1 — `purchaseModal` açıkken `.modal-content` kaydırılıyor mu ve Kaydet erişilebilir mi (3) G1/G2 — login ölçümleri **sanal klavye kapalıyken**; yüksekliklere göre ön hesaplar §8'deki tabloda (4) HF-1 `qe-*` sınıf adlarını ve `#ebysFilePlanPanel table` / `#ebysTemplatePanel table` seçicilerini ekledikten sonra Hızlı Çıkış ve dosya planı kartlarını birlikte gözden geçirin.
