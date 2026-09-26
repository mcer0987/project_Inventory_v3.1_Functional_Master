# [Sprint 2] - Zimmet PDF Geliştirme Planı

Bu plan, Sprint 2 envanter/zimmet yönetimi kapsamındaki son kalan görev olan **[I] Zimmet PDF — Resmi Zimmet Formu** özelliğini tamamlamayı hedefler. Geliştirme, personelin elindeki tüm aktif (iade edilmemiş) zimmetlerin dökümünü içeren resmi ve imzalanabilir bir teslim/zimmet formu üretilmesini sağlayacaktır.

Ayrıca süreçte gözden geçirdiğimiz ve `inventory-management.js` içinde yer alan `deviceHistory` modülündeki ufak bir yazım hatası (`ev.urun` -> `ev.ürün`) giderilmiştir.

---

## User Review Required

> [!NOTE]
> - **Kapsam:** Zimmet PDF formu, ilgili personelin **yalnızca iade edilmemiş (aktif)** zimmet kayıtlarını (`iadeEdildi: false`) listeler.
> - **Tasarım:** Belge üst bilgisi (T.C. Medipol Üniversitesi/Hastanesi), belge detayları (tarih, personel adı, teslim eden yönetici), ürünlerin tablosu (sıra no, ürün tanımı, seri no, adet, zimmet tarihi), yasal taahhüt metni ve alt kısımda ıslak imza alanlarını ("Teslim Alan" ve "Teslim Eden") barındırır.
> - **Dosya Bağımlılığı:** `pdf-generator.js` dosyası `index.html`'de yüklüyken `admin.html`'de yüklü değildi. Admin panelinde de çalışması için `admin.html`'in sonuna eklenecektir.

---

## Open Questions

Herhangi bir açık soru bulunmamaktadır. Zimmet teslim belgesi standart kurumsal form formatına göre tasarlanacaktır.

---

## Proposed Changes

### [Component] Zimmet PDF Yönetimi

#### [MODIFY] [pdf-generator.js](file:///c:/Users/muhammed.cer/Desktop/project_Inventory/pdf-generator.js)
- `window.generatePersonnelZimmetPDF(personnelName)` adında yeni bir küresel fonksiyon eklenecektir.
- Bu fonksiyon:
  - `window.inventoryManagementModule.getNormalizedAssignments()` üzerinden tüm zimmetleri alır.
  - İlgili personelin aktif (`personel === personnelName && !iadeEdildi`) zimmetlerini filtreler.
  - Eğer aktif zimmeti yoksa bir uyarı gösterir.
  - `jsPDF` ve `autoTable` kütüphanelerini kullanarak profesyonel, Medipol kurum şablonuna uygun bir PDF taslağı hazırlar.
  - Alt kısma teslim alan personel ve teslim eden (aktif kullanıcı) için ıslak imza çizgileri ve yasal sorumluluk taahhüdünü ekler.
  - `Zimmet_Belgesi_[PersonelAdı].pdf` ismiyle otomatik indirir.

#### [MODIFY] [inventory-management.js](file:///c:/Users/muhammed.cer/Desktop/project_Inventory/inventory-management.js)
- `renderTable` fonksiyonunda, her satırdaki "İşlem" (Action) hücresine eğer zimmet aktifse bir "Zimmet Formu" (PDF İndirme) butonu eklenecektir.
- Modül nesnesine (`window.inventoryManagementModule`) sarmalayıcı (wrapper) olarak `generatePersonnelZimmetPDF(personnelName)` fonksiyonu tanımlanacaktır:
  ```javascript
  generatePersonnelZimmetPDF: function (personnelName) {
    if (typeof window.generatePersonnelZimmetPDF === 'function') {
      window.generatePersonnelZimmetPDF(personnelName);
    } else {
      if (typeof showAppAlert === 'function') showAppAlert('PDF Oluşturucu kütüphanesi yüklenemedi!', 'error');
    }
  }
  ```

#### [MODIFY] [admin.html](file:///c:/Users/muhammed.cer/Desktop/project_Inventory/admin.html)
- Sayfa sonundaki script yükleme alanında `inventory-management.js`'den hemen önce veya sonra `pdf-generator.js` dosyası dahil edilecektir:
  ```html
  <script src="pdf-generator.js"></script>
  ```

---

## Verification Plan

### Manual Verification
1. **Admin Panel -> Envanter Yönetimi** sekmesine gidilir.
2. Aktif zimmeti olan bir personelin satırındaki **Zimmet Formu** butonuna tıklanır.
3. PDF belgesi otomatik olarak indirilir.
4. İndirilen PDF açılarak aşağıdaki detaylar doğrulanır:
   - Başlık ve kurum adı doğru mu?
   - Personelin ad-soyadı ve aktif zimmetli ürünleri (ürün adı, adet, seri no, tarih) tabloda eksiksiz listeleniyor mu?
   - Sorumluluk taahhüt metni ve ıslak imza alanları ("Teslim Alan: [Personel]" ve "Teslim Eden: [Admin]") düzgün yerleştirilmiş mi?
5. Aktif zimmeti olmayan (veya tüm zimmetleri iade edilmiş) durumlar test edilir (buton zaten görünmeyecektir).
