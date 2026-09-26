# Bug Fix Plan — Checkpoint 9 (5 Critical Issues)

*Active Role: Gemini Sub-Agent (Interaction & Security)*

Raporlanan 5 hatanın kök nedenleri analiz edildi. Tüm düzeltmeler View/Interaction katmanına aittir — Firebase servis katmanı (`/services`) dokunulmayacak.

---

## Köken Analizi

### 🔴 Bug 1 & 3 — JSON.parse + liveTime/liveDate (Zincir Hata)

**Kök Neden:** `admin-dashboard.js:1660`'ta `JSON.parse(user)` herhangi bir try-catch olmadan çağrılıyor. `localStorage`'da `activeUser` verisi bozuksa (boş string, `"undefined"` string'i vb.) `SyntaxError` fırlatıyor. Bu exception aynı callback içindeki bir sonraki satırı (`startAdminStatusTimer()`) da çalıştırmıyor.

```
DOMContentLoaded → JSON.parse() THROWS → startAdminStatusTimer() ÇAĞRILMIYOR → liveTime/liveDate güncellenmez
```

**Aynı bug `script.js:509`'da da var:** `renderMyRequestsTable()` içinde JSON.parse try-catch'siz çağrılıyor.

---

### 🔴 Bug 2 — `admin-dashboard.js:1660` (JSON.parse SyntaxError)

Yukarıdakiyle aynı hata. **Bug 1 ve Bug 3 ile zincirleme** — tek düzeltme üçünü de kapatır.

---

### 🔴 Bug 4 — Satın Alma & Servis tabloları render edilmiyor

**Kök Neden:** `admin-dashboard.js`'deki `showAdminTab(tabId)` fonksiyonu (satır 1201-1254), `purchaseTab` için **hiç bir `else if` bloğu içermiyor**. Tab görünür hale gelir ama `renderServicesModule()` çağrılmaz.

Mevcut durum:
```js
if (tabId === 'dashboard-content') { ... }
else if (tabId === 'productTypeSettings') { ... }
else if (tabId === 'definitionsTab') { ... }
else if (tabId === 'todoTab') { ... }
// ← 'purchaseTab' YOXDUR!
```

---

### 🔴 Bug 5 — Admin → Tanımlar → İş Akışları boş liste

**Kök Neden:** `admin.html` içindeki inline `switchDefTab(tabId)` fonksiyonu, alt sekmeleri switch ederken sadece DOM görünürlük değişikliği yapıyor — hiçbir alt sekme için render çağrısı yok. `defTab-workflows` açıldığında `renderTemplateList()` çağrılmadığı için `adminDefTemplateTableBody` boş kalıyor. Aynı durum `units` ve `products` alt sekmeleri için de geçerli.

---

## Değişiklik Planı

### 1. `admin-dashboard.js` — 2 Düzeltme

#### [MODIFY] — DOMContentLoaded handler (Satır 1658-1662)

```diff
- document.addEventListener("DOMContentLoaded", () => {
-     const user = localStorage.getItem("activeUser");
-     if (user) updateNavbarUI(JSON.parse(user));
-     startAdminStatusTimer();
- });
+ document.addEventListener("DOMContentLoaded", () => {
+     try {
+         const user = localStorage.getItem("activeUser");
+         if (user) updateNavbarUI(JSON.parse(user));
+     } catch (e) {
+         console.warn('⚠️ [admin-dashboard] activeUser parse hatası:', e.message);
+     }
+     startAdminStatusTimer(); // try-catch dışında → her zaman çalışır
+ });
```

#### [MODIFY] — `showAdminTab` fonksiyonu (Satır 1248 civarı, `todoTab` bloğunun ardı)

```diff
  } else if (tabId === 'todoTab') {
      requestAnimationFrame(() => {
          setTimeout(() => {
              if (typeof window.renderTodoTab === 'function') window.renderTodoTab();
          }, 0);
      });
  }
+ } else if (tabId === 'purchaseTab') {
+     requestAnimationFrame(() => {
+         setTimeout(() => {
+             if (typeof window.renderServicesModule === 'function') window.renderServicesModule();
+         }, 0);
+     });
+ }
```

---

### 2. `script.js` — JSON.parse Güvenlik Patchı (Satır 505-510)

```diff
  function renderMyRequestsTable() {
      const tbody = document.querySelector('#tableMyRequests tbody');
      if (!tbody) return;
      tbody.innerHTML = '';
-     const currentUser = JSON.parse(localStorage.getItem('activeUser'));
-     if (!currentUser) return;
+     let currentUser = null;
+     try { currentUser = JSON.parse(localStorage.getItem('activeUser')); } catch(e) { /* bozuk JSON */ }
+     if (!currentUser) return;
```

---

### 3. `admin.html` — `switchDefTab` inline script (Satır 969-982)

```diff
  function switchDefTab(tabId) {
      document.querySelectorAll('.def-tab-content').forEach(el => el.style.display = 'none');
      document.getElementById('defTab-' + tabId).style.display = 'block';
      document.querySelectorAll('.def-nav-btn').forEach(btn => btn.classList.remove('active'));
      event.target.classList.add('active');
+
+     // 💡 [FIX-BUG5]: Alt sekme geçişlerinde ilgili render fonksiyonlarını tetikle
+     if (tabId === 'workflows' && typeof window.renderTemplateList === 'function') {
+         window.renderTemplateList();
+     } else if (tabId === 'units' && typeof window.renderUnitManagement === 'function') {
+         window.renderUnitManagement();
+     } else if (tabId === 'products' && typeof window.renderProductTypesTable === 'function') {
+         window.renderProductTypesTable();
+     } else if (tabId === 'mahal' && typeof window.renderLocationsTable === 'function') {
+         window.renderLocationsTable();
+     }
+
      if (typeof window.TipManager === 'object' && ...) { ... }
  }
```

---

## Etkilenen Dosyalar

| Dosya | Değişiklik Türü | Satır(lar) |
|---|---|---|
| [admin-dashboard.js](file:///c:/Users/muhammed.cer/Desktop/project_Inventory/admin-dashboard.js) | MODIFY | 1658-1662, 1247-1249 |
| [script.js](file:///c:/Users/muhammed.cer/Desktop/project_Inventory/script.js) | MODIFY | 505-510 |
| [admin.html](file:///c:/Users/muhammed.cer/Desktop/project_Inventory/admin.html) | MODIFY | 969-982 |

> [!NOTE]
> `edm-workflow.js`, `purchase-servises.js`, `firebase-handler.js` — **hiç dokunulmayacak.** Tüm değişiklikler sadece View/Interaction katmanındadır.

## Doğrulama

- Bug 1: `renderMyRequestsTable()` çağrıldığında konsol hatası yok
- Bug 2&3: Admin paneli açıldığında `liveTime` ve `liveDate` güncelleniyor
- Bug 4: "Talep Ve Süreçler" sekmesine tıklandığında tablolar dolu görünüyor (KPI sayaçlarıyla eşleşiyor)
- Bug 5: "Tanımlar → İş Akışları" sub-tabına tıklandığında şablon listesi render ediliyor
