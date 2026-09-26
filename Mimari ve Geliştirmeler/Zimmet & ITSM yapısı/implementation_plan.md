# Admin Paneli "Envanter Yönetimi" (Zimmet & ITSM) Ekranı Revize Geliştirme Planı

Bu plan, envanter zimmetleme, talep etme ve yönetim süreçlerini IT Service Management (ITSM) standartlarına yaklaştıracak şekilde detaylandırmayı ve bu geliştirmeleri tamamen modüler, sürdürülebilir bir yapıda ayrı bir JavaScript dosyası (`inventory-management.js`) üzerinden yönetmeyi amaçlamaktadır.

---

## User Review Required

> [!IMPORTANT]
> - **Modüler Yapı (`inventory-management.js`)**: Yönetilebilirliği artırmak ve `admin-dashboard.js` dosyasının aşırı büyümesini engellemek için tüm yönetim, zimmet, iade, Excel raporlama ve UI oluşturma işlevleri yeni oluşturulacak `inventory-management.js` dosyasında kapsüllenecektir.
> - **ITSM Talep Akışı Geliştirmesi**: Envanter talep etme modalı (`requestModal`) genişletilerek **Talep Türü** (Kalıcı Zimmet, Geçici Zimmet / Ödünç, Sarf Malzeme İhtiyacı), **Öncelik Seviyesi** (Düşük, Orta, Yüksek, Kritik) ve geçici zimmetler için **Planlanan İade Tarihi** alanları eklenecektir. Bu alanlar Firestore'da `requests` dokümanı altına yazılacak ve ITSM raporlamalarında kullanılacaktır.
> - **Zimmet Durumu & Depoya İade Akışı**: Zimmetten düşülen (iade alınan) cihazlar için depoya geri alım aşamasında yöneticinin seçtiği depoya (B1/B2) stok iadesi yapılacak, ilgili talep veya `b3` çıkış logundaki kayıt iade edildi olarak işaretlenecektir (`returned` / `iadeEdildi: true`).

---

## Proposed Changes

### 1. Envanter Talep Formunun ITSM Uyumlu Yapılması

#### [MODIFY] [index.html](file:///c:/Users/muhammed.cer/Desktop/project_Inventory/index.html)
- `requestForm` içerisine yeni form alanları eklenecektir:
  - **Talep Türü Dropdown** (`id="reqType"`, `onchange="window.onReqTypeChange()"`): Kalıcı Zimmet, Geçici Zimmet, Sarf Malzeme İhtiyacı seçenekleri.
  - **Öncelik Seviyesi Dropdown** (`id="reqPriority"`): Düşük, Orta, Yüksek, Kritik seçenekleri.
  - **Planlanan İade Tarihi Div** (`id="reqReturnDateContainer"`): Sadece "Geçici Zimmet" seçildiğinde görünür olan `input type="date" id="reqReturnDate"`.

#### [MODIFY] [script.js](file:///c:/Users/muhammed.cer/Desktop/project_Inventory/script.js)
- **`window.openRequestModal(isEdit)`**: Form resetlenirken yeni dropdown alanları varsayılana getirilecek ("Kalıcı Zimmet", "Orta") ve iade tarihi alanı gizlenecektir.
- **`window.onReqTypeChange()`**: Seçilen talep türü "Geçici Zimmet" ise iade tarihi alanını gösterip `required` yapacak, aksi halde gizleyip temizleyecektir.
- **`window.saveRequest(e)`**:
  - Formdan `reqType`, `reqPriority` ve `reqReturnDate` değerlerini okuyacak.
  - Firestore'a kaydedilecek `newRequest` nesnesine `talepTuru`, `oncelik` ve `iadeTarihi` (seçilmişse) parametrelerini ekleyecektir.
- **`window.editPersonnelInventoryRequest(index)`**:
  - Düzenleme (Revize) modunda form doldurulurken, `reqType`, `reqPriority` ve `reqReturnDate` alanlarını Firestore'daki veriye göre set edecek ve `window.onReqTypeChange()` fonksiyonunu çağıracaktır.

---

### 2. Modüler Zimmet Mantığının Kurulması

#### [NEW] [inventory-management.js](file:///c:/Users/muhammed.cer/Desktop/project_Inventory/inventory-management.js)
Tüm zimmet ve envanter yönetim mantığını barındıracak, global `window.inventoryManagementModule` nesnesini oluşturacak yeni dosya.
- **`window.inventoryManagementModule`** yapısı:
  ```javascript
  window.inventoryManagementModule = {
      state: {
          searchTerm: '',
          typeFilter: 'all',
          assignTypeFilter: 'all',
          priorityFilter: 'all',
          sortOrder: 'newest'
      },
      // 📊 UI RENDER METOTLARI
      renderAdminInventoryTab: function() { ... }, // HTML şablonu, KPI kartları, filtreler ve zimmet tablosu
      updateKPIs: function(assignments) { ... },  // Toplam zimmetli, geçici ödünç, kalıcı zimmet ve bekleyen talep sayaçları
      
      // 🔄 VERİ BİRLEŞTİRME VE NORMALİZASYON
      getNormalizedAssignments: function() { ... }, // requests (completed) ve b3 verilerini ortak şemada birleştirir

      // ➕ ZİMMET EKLEME / ATAMA İŞLEMLERİ (MODAL)
      openAssignModal: function() { ... },     // Zimmet yap modalını açar, personelleri çeker
      addAssignRow: function() { ... },        // Modala dinamik ürün satırı ekler
      removeAssignRow: function(btn) { ... },  // Eklenen satırı kaldırır
      onWarehouseChange: function(select) { ... }, // Seçilen depoya göre ürün listesini doldurur
      onProductChange: function(select) { ... },   // Seçilen ürünün stok sınırını ayarlar
      saveAssignment: async function() { ... },    // B1/B2 stok düşümü yapar, b3'e atama kaydı yazar ve Firebase'e kaydeder

      // ➖ ZİMMETTEN DÜŞME VE İADE
      removeAssignment: async function(id, sourceTable) { ... }, // Zimmetten düşme akışını başlatır
      
      // 📥 DIŞA AKTARIM
      exportToExcel: function() { ... } // Filtrelenmiş güncel zimmet listesini SheetJS ile Excel'e döker
  };
  ```
- **`window.showAdminTab` Interceptor'ı**:
  - `edm-workflow.js` dosyasındaki hook yapısına benzer şekilde, `window.showAdminTab` fonksiyonu sarılacak ve `tabId === 'inventoryManagementTab'` durumunda `window.inventoryManagementModule.renderAdminInventoryTab()` fonksiyonunu tetikleyecektir.

---

### 3. Yönetici Paneli Arayüz Entegrasyonu

#### [MODIFY] [admin.html](file:///c:/Users/muhammed.cer/Desktop/project_Inventory/admin.html)
- **Sidebar Navigasyonu**:
  - "TODO Paneli" butonunun altına "Envanter Yönetimi" (`nav-inventoryManagement`) menü seçeneği (`fa-boxes` ikonu ile) eklenecektir:
    `<div class="nav-item" onclick="showAdminTab('inventoryManagementTab')"><i class="fas fa-boxes" style="color: var(--color-success);"></i> <span>Envanter Yönetimi</span></div>`
- **Tab İçeriği Konteyneri**:
  - Diğer tabların yanına `id="inventoryManagementTab" class="admin-tab-content" style="display:none;"` div'i eklenecektir. (İçerik dinamik olarak `inventory-management.js` tarafından premium bir arayüzle çizilecektir).
- **Zimmet Ekleme Modalı Yapısı**:
  - Toplu zimmetleme ve geçici zimmet atamaları için `id="assignInventoryModal" class="modal"` eklenecektir.
- **Script Dosyasının Yüklenmesi**:
  - Body kapanışından önce `<script type="module" src="inventory-management.js?v=1.0.0"></script>` eklenecektir.

#### [MODIFY] [firebase-handler.js](file:///c:/Users/muhammed.cer/Desktop/project_Inventory/firebase-handler.js)
- Real-time listener tetiklendiğinde:
  - Eğer aktif sekme `inventoryManagementTab` ise `window.inventoryManagementModule.renderAdminInventoryTab()` çağrılarak ekrandaki verilerin anlık sünkronize olması sağlanacaktır.

---

## Verification Plan

### Automated / Manual Tests
1. **ITSM Talep Girişi Doğrulaması**:
   - Personel paneliyle giriş yapılıp "Envanter Talep Et" butonuna basılacak.
   - Açılan modalda "Geçici Zimmet" seçildiğinde "Planlanan İade Tarihi" giriş alanının görünür olduğu ve zorunlu tutulduğu test edilecek.
   - Talep gönderildiğinde Firestore'daki `requests` dokümanında `talepTuru`, `oncelik` ve `iadeTarihi` alanlarının doğru yazıldığı doğrulanacaktır.
2. **Modüler Tab ve UI Doğrulaması**:
   - Admin panelinde sol menüdeki "Envanter Yönetimi" butonuna tıklanacak. Sekmenin donmadan yüklendiği ve KPI sayaçlarının güncel olduğu kontrol edilecektir.
3. **Zimmet Atama Modalı (Zimmet Yap)**:
   - Admin paneli üzerinden "Toplu Zimmet Yap" butonuna basılacak. Personel seçilip B1 deposundan 1 adet bilgisayar kalıcı zimmet olarak, B2 deposundan 1 adet test telefonu geçici zimmet olarak atanacaktır.
   - Stokların düştüğü, `b3` logunun oluştuğu ve personelin Kendi Envanteri sayfasında bu cihazların listelendiği doğrulanacaktır.
4. **Zimmet İade Akışı**:
   - Zimmetli bir ürün "Zimmetten Düş" butonuyla kaldırılacaktır.
   - Depoya iade sorusuna "Evet" seçilerek B1 deposu belirtilecek, depodaki stok adedinin arttığı ve zimmet listesinde durumunun iade edildiği doğrulanacaktır.
5. **Excel Çıktısı**:
   - "Rapor Al (Excel)" butonuna basılarak inen Excel dosyasında aramalar ve filtreler uygulanmış listenin doğru kolonlarla aktarıldığı teyit edilecektir.
