# ESM Modüler Mimariye Geçiş Planı (v3.1)

## Arka Plan & Risk Analizi

`script.js` şu anda **4828 satır**, **203 KB** bir monolith yapısındadır. Doğrudan ES Module split yapılması yerine **Hibrit Katmanlı Geçiş** stratejisi önerilmektedir. Bunun 3 kritik sebebi vardır:

---

## User Review Required

> [!CAUTION]
> **Kırıcı Bağımlılıklar (Breaking Dependencies) Tespit Edildi**
>
> `script.js` içindeki fonksiyonlar diğer dosyalara da sızdırılmış durumdadır:
> - `todo-module.js` → `renderMyTasksTab`, `checkPendingTasks`
> - `edm-workflow.js` → `renderMyApprovals`
> - `purchase-servises.js` → `renderPurchaseModule`, `renderMyRequestsTable`
> - `admin-dashboard.js` → `renderDashboard`, `renderHistory`
> - `filter-module.js` → `getProcessedData`, `sortTable`
>
> Bu bağımlılıklar `window.functionName` atamaları üzerinden çalışmaktadır. Gerçek `export`/`import` döngüsüne geçmek bu dosyaları da **refactor gerektirir**.

> [!WARNING]
> **`firebase-handler.js` halihazırda ES Module** (`type="module"`) olarak yüklenmektedir. Yeni modüllerin `firebase-handler.js`'den `import` yapabilmesi için bu dosyada `export` ifadesinin eklenmesi gerekmektedir. Bu, `window.fireDb`'ye bağımlı eski tüm modülleri etkiler.

> [!IMPORTANT]
> **`index.html` karma yapısı**: Şu anda `script.js` klasik `<script>` ile yüklenmektedir. Onu `type="module"` yapmak **inline `onclick` attribute binding'lerini kırar** (ES Module strict-mode + scoping). Bu yüzden `window.functionName` atamaları `type="module"` olan dosyalarda bile zorunlu olarak **korunacaktır**.

---

## Hibrit Katmanlı Geçiş Stratejisi

Tek seferde tam rewrite yapmak yerine, sistemi **çalışır tutarak aşamalı olarak modüle etme** yapılacaktır.

```
script.js (monolith)
     │
     ├──► [PHASE 1] Utility slice (utils.js)
     ├──► [PHASE 2] Auth slice (auth-engine.js)  
     ├──► [PHASE 3] Table slice (table-engine.js)
     └──► [PHASE 4] Inventory slice (inventory-logic.js)
```

Her modül şu prensibi takip eder:
1. Yeni dosyaya **ES Module** olarak yazılır (`export const`)
2. `window.xyz` bağlamaları HTML `onclick` gerektiren her fonksiyon için **korunur**
3. Modül `type="module"` ile `main.js` tarafından import edilir
4. `script.js`'deki orijinal fonksiyon bloğu `// [MIGRATED → module.js]` yorum ile işaretlenir ve silinmez (rollback güvenliği için)

---

## Proposed Changes

### Phase 0 — Hazırlık

#### [MODIFY] [firebase-handler.js](file:///c:/Users/muhammed.cer/Desktop/project_Inventory/firebase-handler.js)
- `COLLECTION_ROOT` ve `fireDb` sabitlerini sadece `window`'a değil, aynı zamanda `export const` ile dışa aktarıyoruz. Bu, yeni modüllerin `window.fireDb` yerine `import` üzerinden erişmesini sağlar. `runStockTransaction` mantığına **dokunulmayacak**.
- `saveData` ve `runStockTransaction` zaten `window` üzerinde; export da eklenir.

---

### Phase 1 — `utils.js` (Yardımcı Fonksiyonlar)

#### [NEW] [utils.js](file:///c:/Users/muhammed.cer/Desktop/project_Inventory/utils.js)

Taşınacak fonksiyonlar:
| Fonksiyon | Satır | Bağımlılık |
|---|---|---|
| `getTurkiyeSaati()` | L23 | `TZ` sabiti |
| `getTurkiyeTarihi()` | L28 | `TZ` sabiti |
| `tsToTurkiye()` | L33 | `TZ` sabiti |

`window.getTurkiyeSaati`, `window.getTurkiyeTarihi`, `window.tsToTurkiye` atamaları korunur (diğer modüllerde kullanımı var).

---

### Phase 2 — `auth-engine.js` (Kimlik Doğrulama Motoru)

#### [NEW] [auth-engine.js](file:///c:/Users/muhammed.cer/Desktop/project_Inventory/auth-engine.js)

Taşınacak fonksiyonlar:
| Fonksiyon | Satır | Bağımlılık |
|---|---|---|
| `window.checkIsAdmin()` | L98 | `window.userAuth` |
| `checkAuth()` (inner function → DOMContentLoaded) | L154 | `updateNavbarUI`, `switchTab` |
| `validateAdminAction()` | L299 | `checkIsAdmin`, `showAppAlert` |
| `window.handleLogin()` | L2634 | `SecurityConfig`, `window.data`, `switchTab`, `setupUI` |
| `window.updateNavbarUI()` | L2494 | DOM manipulation |
| `window.checkAdminAndGo()` | L4342 | `SecurityConfig` |

> [!NOTE]
> `handleLogin` `SecurityConfig` nesnesine bağımlıdır. `security.js` dosyası hâlâ klasik `<script>` ile yüklenmekte olup `window.SecurityConfig` üzerinden erişilmektedir. Bağımlılık `window.SecurityConfig` referansı korunacak.

---

### Phase 3 — `table-engine.js` (Tablo Render Motoru)

#### [NEW] [table-engine.js](file:///c:/Users/muhammed.cer/Desktop/project_Inventory/table-engine.js)

Taşınacak fonksiyonlar:
| Fonksiyon | Satır | Bağımlılık |
|---|---|---|
| `window.renderTable()` | L974 | `window.data`, `getProcessedData`, `tsToTurkiye` |
| `window.renderSearchResults()` | L1204 | `window.data`, `tsToTurkiye` |
| `window.renderCardSearchResults()` | L1304 | `window.data` |
| `window.renderMobileCards()` | L764 | `window.data` |
| `window.searchTable()` | L1171 | `renderTable`, `renderSearchResults` |
| `window.changePage()` | L1097 | `renderTable` |
| `window.sortTable()` | L4281 | `getProcessedData`, `renderTable` |
| `window.getProcessedData()` | L4243 | `window.data`, sort state |
| `window.patchDOMForCollection()` | L4542 | DOM |
| `window.showRowTooltip/moveRowTooltip/hideRowTooltip/showMobileTooltip` | L674 | DOM |
| `window.toggleCardView()` | L726 | `renderTable`, `renderMobileCards` |

**Ortak state** (`currentSortColumn`, `isAscending`, `currentPage`) bu modüle taşınır. `window` üzerinden de expose edilir.

---

### Phase 4 — `inventory-logic.js` (Envanter İş Mantığı)

#### [NEW] [inventory-logic.js](file:///c:/Users/muhammed.cer/Desktop/project_Inventory/inventory-logic.js)

Taşınacak fonksiyonlar:
| Fonksiyon | Satır | Bağımlılık |
|---|---|---|
| `window.addExit()` | L517 | `runStockTransaction`, `saveData`, `window.data`, B3 schema |
| `window.saveExit()` | L1464 | `runStockTransaction`, `saveData` |
| `window.updateStock()` | L2326 | `runStockTransaction` |
| `window.deleteItem()` | L1130 | `saveData`, `window.data` |
| `window.bulkDelete()` | L1820 | `saveData`, `window.data` |
| `window.saveProduct()` | L1425 | `saveData`, `window.data` |
| `window.toggleWatch()` | L4295 | `saveData`, `window.data` |
| `window.receiveProduct()` | L3451 | `saveData` |
| `window.deleteB3Row()` | L4199 | `saveData` |

> [!NOTE]
> `runStockTransaction` ve `saveData` `firebase-handler.js`'de tanımlanmıştır ve `window` üzerinden erişilmektedir. Yeni modülde `window.runStockTransaction` / `window.saveData` referansları kullanılacaktır (ya da `import`). `COLLECTION_ROOT` mantığına kesinlikle dokunulmayacaktır.

---

### Phase 5 — `ui-components.js` (Modal / FAB / BottomSheet Katmanı)

#### [NEW] [ui-components.js](file:///c:/Users/muhammed.cer/Desktop/project_Inventory/ui-components.js)

Taşınacak fonksiyonlar:
| Fonksiyon | Satır |
|---|---|
| `window.openProductModal()` | L3925 |
| `window.openTransferModal()` | L4062 |
| `window.confirmTransfer()` | L4117 |
| `window.closeTransferModal()` | L4195 |
| `window.openModal()` | L453 |
| `closeModal()` | L475 |
| `window.openExitModal()` | L2951 |
| `window.openRequestModal()` | L2848 |
| `window.handleTypeChange()` | L3910 |
| `window.selectProduct()` | L489 |
| FAB / Bottom Sheet — `clearRowSelection`, `updateFloatingBar`, `showMobileBottomSheet`, `closeMobileBottomSheet` | L4700+ |

---

### Phase 6 — `main.js` (Merkezi Orchestrator)

#### [MODIFY] [modules/main.js](file:///c:/Users/muhammed.cer/Desktop/project_Inventory/modules/main.js)
Mevcut `main.js` dosyası var; yeni modülleri buradan import edip init fonksiyonlarını çağıracağız.

```javascript
import { initAuth } from '../auth-engine.js';
import { initTableEngine } from '../table-engine.js';
import { initInventoryLogic } from '../inventory-logic.js';
import { initUIComponents } from '../ui-components.js';

// PubSub router da buraya taşınır
```

#### [MODIFY] [index.html](file:///c:/Users/muhammed.cer/Desktop/project_Inventory/index.html)
- Yeni modül `<script>` tagları `type="module"` olarak eklenir.
- `script.js?v=1.0.5` **silinmez** — geçiş süreci boyunca paralel çalışır. Tüm fonksiyonlar taşındıktan sonra son adımda kaldırılır.

---

## PubSub (`onInventoryDataUpdated`) Korunması

`window.addEventListener('onInventoryDataUpdated', ...)` bloğu **`main.js`'e** taşınır. Bu listener çeşitli modüllerin render fonksiyonlarını çağırmaktadır. `main.js` tüm modülleri import ettiğinden, bu router burada kalacak ve tüm render fonksiyonlarına erişimi olacaktır.

```javascript
// main.js içinde
window.addEventListener('onInventoryDataUpdated', (e) => {
    const col = e.detail.collection;
    if (col === 'b1' || col === 'b2') renderTable(col);
    // ... diğer routing
});
```

---

## Verification Plan

### Her Phase Sonrası
1. Sayfayı `localhost`'ta açıp konsolda hata olmaması.
2. B1/B2 tablosunun doğru render edilmesi.
3. Login / Logout akışının çalışması.
4. Stok artır/azalt işleminin atomik çalışması (B1'de bir ürünün stok sayısının değişmesi).
5. Bottom Sheet / FAB butonlarının mobilde tetiklenmesi.

### Final Check
- `network tab`'ta tüm modüllerin 200 ile yüklendiğini doğrula.
- `console` panelinde `🚀 ACTIVE DATABASE ROOT` logunun doğru koleksiyonu gösterdiğini teyit et.
