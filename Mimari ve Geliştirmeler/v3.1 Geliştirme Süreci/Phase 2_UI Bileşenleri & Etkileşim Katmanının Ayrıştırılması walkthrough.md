# Walkthrough - Modular ESM Refactoring (Phases 1-5) & AppModules Namespace Strategy (v3.1)

Bu rapor, Medipol Envanter Takip Sistemi **v3.1 ESM Modüler Mimari Geçiş Süreci** kapsamında başarıyla tamamlanan **Phase 5 (UI Bileşenleri & Etkileşim Katmanının Ayrıştırılması)** ile önceki adımların bütünsel mimari özetini sunmaktadır.

---

## 🛡️ 1. Mimari Rol & Yetki Sınırları Teyidi
Bu süreçte belirlenen katman disiplinine (Separation of Concerns & Contract-First Development) milimetrik olarak uyulmuştur:
- **Data/Service Katmanı (`/services`, `inventory-logic.js`)**: Doğrudan Firebase SDK sorgularını (`saveData`, `runStockTransaction`) yönetir.
- **UI/View Katmanı (`ui-components.js`, `table-engine.js`)**: Saf DOM manipülasyonu, Modal açma/kapatma, FAB (Floating Action Bar), Bottom Sheet ve satır seçim durumlarını yönetir; asla doğrudan Firebase sorgusu çalıştırmaz.
- **Geri Uyumluluk Köprüleri (Compatibility Bridges)**: HTML şablonlarındaki inline `onclick` olaylarının kırılmaması için tüm modül fonksiyonları `window.AppModules.UI` namespace'ine bağlandıktan sonra `window.fonksiyonAdi = UIComponents.fonksiyonAdi.bind(UIComponents)` şeklinde global köprülere bağlanmıştır.

---

## 📦 2. Phase 5: `ui-components.js` Ayrıştırma Detayları

Monolith `script.js` içerisinden kullanıcı arayüzü etkileşimi (UI Interaction), Modal kontrolleri ve bağlamsal eylem çubukları tamamen ayrılarak `ui-components.js` modülüne taşınmıştır.

### A. Çıkarılan ve Namespace'e Bağlanan Fonksiyonlar (`UIComponents` -> `window.AppModules.UI`)

| Kategori | Çıkarılan Metotlar | Mimari Görevi & Mekanizma (`[WHY]` / `[HOW]`) |
| :--- | :--- | :--- |
| **Ürün Modalları** | `openProductModal`<br>`handleTypeChange`<br>`selectProduct` | Ürün ekleme/düzenleme pencerelerini açar, aktif sekmeye göre Konum/Raf/Tür dropdown'larını doldurur. Düzenleme modunda `window.data` üzerinden demirbaş durumunu okur ve form elemanlarını senkronize eder. |
| **Sevk & Transfer Modalları** | `openTransferModal`<br>`handleTransferTargetChange`<br>`confirmTransfer`<br>`closeTransferModal` | Depolar arası iç transfer (B1 ↔ B2) veya dış birim/servis sevk taleplerini yönetir. Hedefe göre dinamik form seçeneklerini açar. |
| **Zimmet / Çıkış Modalları** | `openExitModal`<br>`closeExitModal` | Envanter çıkışı (zimmet) ekranını açar. Demirbaş ürün seçildiğinde **Zero-Trust Yetki Koruması** uygular (sadece Admin çıkış yapabilir). |
| **Talep Modalları** | `openRequestModal`<br>`closeRequestModal` | Personel envanter talep ekranlarını açar, ITSM talep türü (Kalıcı/Geçici Zimmet) ve öncelik alanlarını yönetir. |
| **Genel Modallar** | `openModal(id)`<br>`closeModal(id)` | Proje genelindeki modallar için ID bazlı merkezi görünürlük denetleyicisi sağlar. |
| **FAB & Contextual Action Bar** | `setupRowSelection`<br>`updateFloatingBar`<br>`clearRowSelection` | **Event Delegation** ile tablo `tbody` elemanına tek bir tıklama dinleyicisi kurar (`tbody._fabListenerAttached`). Seçili satır sayısına (`window._selectedRows.size`) göre tekil işlemleri veya toplu işlem butonlarını gösterir (**Contextual Intelligence**). |
| **Mobil Alt Panel (Bottom Sheet)** | `showMobileBottomSheet`<br>`closeMobileBottomSheet` | Mobil görünümde (`<= 768px`) seçilen satır için ekrandan taşmayan dokunmatik dostu aksiyon panelini açar. |
| **Toplu İşlemler** | `_bulkDeleteSelected` | V2 Batch mimarisine uygun şekilde seçili kayıtları yüksek indexten düşük indexe doğru sıralayıp siler ve `window.saveData` üzerinden kalıcı kaydı tetikler. |

---

## 🔗 3. Bağımlılık & Modül Yükleme Zinciri (`index.html` & `main.js`)

Phase 5 ile birlikte sistemin modül bağımlılık zinciri sıfır yarış durumu (zero race-condition) garantisiyle yapılandırılmıştır:

1. **`index.html` Script Yükleme Sırası**:
   ```html
   <script type="module" src="table-engine.js?v=3.1.0"></script>
   <script type="module" src="inventory-logic.js?v=3.1.0"></script>
   <!-- Phase 5: ui-components.js strictly inventory-logic.js sonrasında yüklenir -->
   <script type="module" src="ui-components.js?v=3.1.0"></script>
   <script type="module" src="self-approval-reporter.js?v=3.1.0"></script>
   <script src="script.js?v=1.0.5"></script>
   ```

2. **`modules/main.js` Merkezi Orchestrator**:
   - `window.AppModules` nesnesi en üstte başlatılarak modüller sırasıyla kayda alınmıştır:
     - `window.AppModules.Utils = Utils;`
     - `window.AppModules.Auth = Auth;`
     - `window.AppModules.Table = TableEngine;`
     - `window.AppModules.Inventory = InventoryLogic;`
     - `window.AppModules.UI = UIComponents;` *(Phase 5)*
     - `window.AppModules.SelfApproval = SelfApproval;`

---

## 🧪 4. Doğrulama ve Test Sonuçları

- **Event Delegation Korunumu**: `setupRowSelection` fonksiyonu, mevcut tablo satırlarının `tr.selectable-row` yapısını bozmadan `e.target.closest('tr.selectable-row')` mantığıyla tam olarak çalışır durumda tutulmuştur.
- **Context Preservation (`.bind`)**: Tüm global köprüler (`window.openProductModal` vb.), `UIComponents` bağlamını (`this`) kaybetmeyecek şekilde `.bind(UIComponents)` ile esnekleştirilmiştir.
- **Zero-Trust & Durum Yönetimi**: `window._selectedRows = new Set()` global belleği modül ilk yüklendiğinde güvenli bir şekilde `if (!window._selectedRows)` kontrolüyle başlatılmış, bellek sızıntısı veya state sıfırlanma riski ortadan kaldırılmıştır.
