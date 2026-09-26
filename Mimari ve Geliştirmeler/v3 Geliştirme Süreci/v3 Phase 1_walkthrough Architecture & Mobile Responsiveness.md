# v3 - Architecture & Mobile Responsiveness Walkthrough

Bu belge, v3 geliştirmeleri kapsamında yapılan "Sıfır Güven (Zero-Trust)", "Touch-First (Dokunmatik Öncelikli)" ve "Contextual Action (Bağlamsal Aksiyon)" mimari kararlarını ve bu mimariyi ayakta tutan kod bloklarının teknik detaylarını açıklamaktadır. 

Amaç, ileride yapılacak UI ve Data değişikliklerinde mimarinin nasıl işlediğini referans almak ve Responsive tasarım kurallarını ihlal etmemektir.

---

## 1. Mimari Kararlar (Architecture Decisions)

> [!IMPORTANT]
> **Touch-First & Hover-Free UX:**
> Mobil kullanımın ön planda tutulması sebebiyle, kritik hiçbir buton veya aksiyon (İşlemler) `.hover` CSS seçicisi ile gizlenip gösterilmez. Tüm etkileşimler dokunma (Click/Tap) üzerinden tetiklenir. Görsel geri bildirim, butonların `transform: scale(0.93)` gibi `:active` (dokunma anı) durumlarıyla sağlanır.

> [!TIP]
> **Bağlamsal Zeka (Contextual Intelligence):**
> Kullanıcının "seçtiği satır sayısına" göre arayüz tepki verir. Tek bir satır seçilmişse Artır, Azalt, Düzenle gibi tekil işlemler gösterilirken; birden fazla satır seçilmişse bu tekil işlemler **gizlenir** ve sadece Toplu Sil, Toplu Sevk gibi anlamlı (bağlamsal) işlemler kullanıcıya sunulur.

> [!WARNING]
> **Event Delegation & DOM Performance:**
> Tabloda 1000 satır veri olduğunda, her satırın içindeki butona `onclick` bağlamak bellek şişmesine (memory leak) neden olur. Bu mimaride tekil tıklama dinleyicileri (listener) sadece **tablonun `<tbody>` etiketine** bir kez bağlanır (Event Delegation). Tıklanan elementin hangi satır olduğu, satıra gömülen `data-*` nitelikleriyle okunur.

---

## 2. İlgili Fonksiyonlar ve Teknik Analizleri

### `window.setupRowSelection(tableContainer)`
**Konum:** `script.js`  
**Görevi:** Tablolara Event Delegation (Olay Temsili) yöntemiyle tıklama dinleyicisi bağlar.
- Her render işleminden (ister normal ister arama) sonra çağrılır.
- **Güvenlik Kilidi:** `tbody._fabListenerAttached = true;` flag'i ile bir tabloya yanlışlıkla iki kez tıklama dinleyicisi eklenmesini engeller.
- **Mantık:** Tıklanan element `checkbox` ise işlemi ezer (çünkü checkbox kendi state'ini yönetir). Tıklanan alan bir `<tr>` ise, o satırın dataset'inden `depo`, `index`, `id` bilgilerini alır, global `window._selectedRows` kümesine (Set) ekler. Ardından ekranı tazelemek için `updateFloatingBar()`'ı çağırır.

### `window.updateFloatingBar()`
**Konum:** `script.js`  
**Görevi:** Masaüstü görünümlerinde ekranın altında beliren (Floating Action Bar - FAB) menüyü yönetir.
- Global `_selectedRows` objesinin büyüklüğünü (size) okur.
- Eğer **1 kayıt seçiliyse:** O kaydın bağlı olduğu nesneyi çeker, Takipte mi (isWatched) vb. kontrolleri yapıp tüm aksiyonları bar içine HTML string olarak basar.
- Eğer **1'den fazla kayıt seçiliyse:** O zaman zeka devreye girer. Düzenle ve Stok hareketleri gibi "tekil" işlemler kapatılır. Bunun yerine `_bulkDeleteSelected` (Toplu Sil) ve "Toplu Sevk" butonları üretilir. 

### `window.showMobileBottomSheet(itemData)` & `closeMobileBottomSheet()`
**Konum:** `script.js`  
**Görevi:** Ekran genişliği 768px ve altında olduğunda (Mobil), tıklanan satır için alttan kayarak açılan dokunmatik paneli (Bottom Sheet) yönetir.
- Masaüstündeki FAB, mobilde darlığa sebep olacağı için bu mimari kurgulanmıştır. 
- Fonksiyon, dışarıdan seçilen ürün datasını alır, ilgili DOM elementlerinin (bsProductName, bsButtons) içeriğini doldurur ve CSS class'ı (`bs-active`) tetikleyerek ekranı yukarı kaydırır.
- Kullanıcı boş bir yere bastığında veya kapattığında, `closeMobileBottomSheet()` çalışır; menüyü kapatır ve `clearRowSelection()` çağırarak satırın seçim (mavi) rengini temizler.

---

## 3. Arama Mimarisi (Search Logic) ve State Korunması

> [!CAUTION]
> Firebase `onSnapshot` tetiklendiğinde (başka biri veri girdiğinde veya siz stok değiştirdiğinizde), tablonun tamamen sıfırdan çizilmesi gerekir. Eğer bu anda kullanıcı bir şey aratmışsa, tablonun resetlenmesi kullanıcının aramasını (UX) bozar. 

### `renderTable(depo)` (Arama Kontrolcüsü)
**Konum:** `script.js`  
**Görevi:** Tabloyu çizerken aramayı muhafaza eder (State Preservation).
- `renderTable` fonksiyonu ilk çalıştığında şu kontrolü yapar:
  ```javascript
  const searchInput = document.getElementById(`search${depo.toUpperCase()}`);
  if (searchInput && searchInput.value.trim() !== "" && !append) {
      window.searchTable(depo);
      return;
  }
  ```
- Bu kod bloğu, aktif bir arama varsa, tabloyu standart olarak çizmeyi iptal eder ve render işlemini `searchTable` fonksiyonuna delege eder.

### `renderSearchResults(depo, results)`
**Konum:** `script.js`  
**Görevi:** Arama filtresinden dönen sonuçları, ana tablonun **Touch-First** mimarisiyle birebir aynı formatta (İşlem butonu olmadan, `selectable-row` ve `data-*` class'larıyla) HTML olarak çizer.
- Çizim tamamlandıktan hemen sonra `window.setupRowSelection(tableContainer)` fonksiyonunu tetikleyerek arama sonuçlarının da tıklanabilir (FAB açılabilir) hale gelmesini sağlar.

---

## 4. CSS (Style) Mimarisi ve Mobil Responsive Çözümü

### `.table-responsive-wrapper` (Yatay Scroll Koruyucu)
**Konum:** `style.css` & `index.html`
- **Neden Kullanıldı?** Eski yapıda 10-11 sütunlu tablolar (B1, B2 vb.), telefondan girildiğinde ekranın sağa doğru kaymasına, dolayısıyla sitenin genel düzeninin yırtılmasına (viewport taşması) neden oluyordu. Bu yırtılma, `fixed` olarak ayarlanan Bottom Sheet'in konumunu bozuyordu.
- **Nasıl Çalışır?** İlgili HTML `<table id="tableB1">` blokları, `<div class="table-responsive-wrapper">` isimli div içerisine alınmıştır.
- `overflow-x: auto; max-width: 100vw;` CSS özelliği sayesinde tablolar sayfa bütünlüğünü bozmaz, kendi çerçeveleri içinde yatay kaydırılabilir hale gelmiştir.
- `-webkit-overflow-scrolling: touch;` ile iOS cihazlarda yağ gibi kayması (momentum scrolling) sağlanmıştır.

### `#floatingActionBar` & `.bs-container`
**Konum:** `style.css`
- **Glassmorphism:** FAB çubuğunda yarı saydam karanlık cam efekti kullanılarak (backdrop-filter: blur) arkaplandaki tablo verilerinin estetik bir şekilde okunabilmesi sağlanmıştır.
- **Transition (Animasyon):** Hover (üzerine gelince tetiklenen efekt) yerine, sadece state değişiklikleri (`.fab-visible` classının eklenmesi) ile CSS üzerinden `transform: translateY` uygulanır ve bar pürüzsüz bir biçimde belirir.
- **Bottom Sheet Z-Index:** Mobil panelin tüm uygulamanın üstünde kalmasını garanti etmek için özel olarak `z-index: 9999` ve `position: fixed` olarak perçinlenmiştir.
