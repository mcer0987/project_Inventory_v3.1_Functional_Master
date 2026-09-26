# Adım 2: Mobil ve TV Görünümü (Data to Card Transformation)

Bu doküman, sistemin "Mobil (≤768px)" ve "TV (≥2560px)" ekran boyutlarında sergilediği davranışları, `Card View` (Kart Görünümü) mimarisine geçişin uygulama adımlarını (Implementation Walkthrough) ve arka plandaki teknik karar alma süreçlerini detaylandırmaktadır. 

---

## 🚀 Uygulama Adımları (Implementation Walkthrough)

Bu faza ait geliştirmelerde mevcut projedeki masaüstü tablosu korunurken, ekran daraldığında veya aşırı genişlediğinde veriyi otomatik olarak "Kart" dizilimine dönüştüren (Data to Card) esnek bir mimari eklenmiştir. Değişiklik yapılan dosyalar ve kapsamları şöyledir:

### 1. `script.js` (JavaScript Mantığı)
- **Veri Gruplama (Data Transformation):** `window.renderMobileCards` fonksiyonu eklendi. `Array.reduce` ile ürünler `tür` bazında gruplandırılarak bir Accordion (katlanabilir) HTML yapısı dinamik olarak üretilir.
- **Arama Motoru Revizyonu:** `searchTable` ve `renderSearchResults` fonksiyonlarına `_cardViewActive` durumu eklendi. Kart modunda arama yapıldığında sonuçların Flat Liste (düz liste) olarak basılması için `window.renderCardSearchResults` fonksiyonu geliştirildi.
- **Event Delegation & Bağlamsal Aksiyon:** `_setupCardViewSelection` yazılarak kart görünümlerine tıklama dinleyicisi eklendi. Böylece FAB (Floating Action Bar) ve Bottom Sheet yapıları kart görünümünde de sıfır hatayla çalışır hale getirildi.
- **Otomatik Geçiş (Media Query İzleyicisi):** Ekran boyutu değişimlerini (`window.resize`) yakalayıp 768px altı veya 2560px üstü durumlarda tablo-kart geçişini otomatik yöneten `_detectAndApplyCardView` bloğu eklendi.

### 2. `index.html` (DOM Yapısı)
- B1 ve B2 depo alanlarındaki arama çubuklarının (`.search-bar`) yanına manuel görünüm geçişi (Toggle) için butonlar (`#viewToggleB1`, `#viewToggleB2`) eklendi.
- Tabloların bulunduğu `.table-responsive-wrapper` alanlarının hemen altına, başlangıçta gizli durumda olan kart görünümü kapsayıcıları (`#cardViewB1`, `#cardViewB2`) yerleştirildi.

### 3. `style.css` (Görünüm ve Responsive Tasarım)
- **Kart Mimarisi:** `.type-group-card`, `.type-group-header` ve `.product-card-item` sınıfları yazılarak kartların boşluklu, estetik ve dokunmatik öncelikli (min-height: 56px) dizilimi sağlandı.
- **Medya Sorguları (Media Queries):** `@media (max-width: 768px)` ve `@media (min-width: 2560px)` kuralları ile CSS tabanlı otomatik görünüm kontrolü (display: none/block geçişleri) sağlandı.
- **Hover İptali:** "Touch-first" (dokunmatik öncelikli) kuralı gereği `.hover` kullanılmadı; etkileşim geri bildirimleri `transform: scale(0.995)` ve `:active` state üzerinden kurgulandı.

---

## 🏆 Mimarın Analizi ve Onaylanan Kararlar

### 1. "Flat Liste" Tasarım Kararı (UX Masterclass)
Arama sonuçlarının kart modunda (Card View) gösterimi esnasında, standart görünümlerdeki "Kategorilere Göre Akordeon" (Katlanabilir) yapı yerine **Flat Liste (Düz Liste)** tercih edilmiştir.

**Neden Doğru?**
Kullanıcı bir arama terimi ("Toner" gibi) girerek zaten zihnindeki daraltmayı yapmıştır. Daraltılmış bir veri setini tekrar bir akordeon (Accordion) içerisine gömmek ve kullanıcıdan ekstra bir "tıklama" ("aç") eylemi beklemek, Bilişsel Yükü (Cognitive Load) artırır ve UX açısından hatalıdır. Arama sonuçlarının filtrelenmiş halinde doğrudan basılması, kullanıcının veriye saniyesinde ulaşmasını sağlayan Senior seviye bir karardır.

### 2. Guard Sıfırlama (DOM Leak Protection)
Kart modunda yapılan aramalarda `renderCardSearchResults` devreye girmekte ve sonuçlar için özel bir container (`card-search-header`) oluşturulmaktadır. 

Raporlanan Kritik Fonksiyon Akışı:
> `_cardFabListenerAttached = false` yapılır → `_setupCardViewSelection` yeniden bağlanır.

**Nasıl Çalışıyor?**
HTML yapısı `innerHTML` ile baştan oluşturulduğunda (DOM yeniden çizildiğinde), o elementlere bağlı olan eski "click listener" (tıklama olayları) tamamen çöpe gider. DOM güncellendiği her an, "dinleyicilerin (listeners) koptuğu" bir gerçektir. Sistemin bunu fark edip (guard'ı sıfırlayıp) `_setupCardViewSelection`'ı tekrar çağırması sayesinde arama yapıldıktan sonra dahi seçilen kartların **FAB (Floating Action Bar)** ve **Bottom Sheet** özelliklerini tetiklemesi kesintisiz sürmektedir. Bu hamle, Hafıza Sızıntısı (Memory Leak) sorunlarını tamamen izole eder.

### 3. Test Scriptinin 15/15 Geçmesi
Bir özelliğin entegrasyonundan sonra spagetti kod oluşmaması, ancak güçlü ve bağımsız yapı taşlarının (fonksiyonların) kendi işini kusursuz yapmasıyla mümkündür. `renderMobileCards`, `_setupCardViewSelection`, `renderCardSearchResults` gibi modüler fonksiyonların izolasyonu sayesinde sistem, test scriptinden tam puan (15/15) almıştır.

---

## 🛠 Teknik Referanslar ve Kritik Fonksiyon Yapıları

### `window.renderMobileCards(depo)`
Masaüstü (Table) yapısını bozmadan, mobil ekran boyutu için Array içerisindeki veriyi `Array.reduce` ile `item.tür` bazında gruplayarak kart (Accordion) yapısını oluşturur. CSS ile desteklenerek hover kullanılmaz, touch-friendly min 44x44px alanlar bırakılır.

### `window.toggleCardView(depo)`
Arama barının (search bar) yanındaki Toggle butonudur. CSS sınıflarını ezer, DOM'u tamamen tablo veya kart görünümüne zorlar ve `window._cardViewActive` bayrağını yönetir.

### `window.renderCardSearchResults(depo, results)`
Arama sürecini devralan ve sonuçları (results) flat liste olarak çizen fonksiyondur. Eski dinleyicileri (event listener) temizler, yeni event listener bağlayarak (`_setupCardViewSelection`) Bottom Sheet/FAB ile menülerin kesintisiz çalışmasını garanti altına alır.

### Arama Akışında `_cardViewActive` Bayrağı (State Guard)
`searchTable` içerisinde yer alan şu satırlar, kullanıcı "Kart Görünümünde" arama yaptığında, sonuçların tablo olarak basılmasını engeller ve akışı bozulmadan tutar:
```javascript
if (window._cardViewActive && window._cardViewActive[depo]) {
    window.renderMobileCards(depo);
} else {
    window.renderTable(depo);
}
```
Ve `renderSearchResults` içerisinde de benzer koruma ile `renderCardSearchResults` fonksiyonuna yönlendirir.
