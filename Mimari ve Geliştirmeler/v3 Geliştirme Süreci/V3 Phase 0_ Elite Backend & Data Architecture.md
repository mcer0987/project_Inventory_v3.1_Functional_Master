# 🏗️ V3 Phase 0: Elite Backend & Data Architecture

## 🔍 Tespit Edilen Sorun ve Kök Neden Analizi

Kullanıcının raporladığı **"Firebase'de inventory_v2 koleksiyonu boş ve farklı cihazlarda eş zamanlı (live) güncellemeler ekrana yansımıyor"** sorunu üzerine sistemin `firebase-handler.js` ve veri yönlendirme (PubSub Router) mimarileri detaylı olarak denetlenmiştir.

Yapılan inceleme sonucunda iki farklı kritik veri kopukluğu tespit edilmiştir:

1. **Migration (Veri Göçü) Eksikliği:**
   `firebase-handler.js` içindeki hem Okuma (`onSnapshot`) hem de Yazma (`saveData`, `runTransaction`) işlemleri **ZATEN DOĞRU YOLA (`inventory_v2`) BAKMAKTADIR**. Kod tarafında eski `inventory` koleksiyonuna yazan hiçbir işlem kalmamıştır. 
   **Sorunun asıl nedeni:** Veritabanını V1'den V2'ye taşıyacak olan "Migration (Göç)" script'inin daha önce hiç tetiklenmemiş olmasıdır. `onSnapshot` doğru koleksiyonu dinliyor ancak `inventory_v2` tamamen boş olduğu için ekrana hiçbir veri gelmiyor (Sistem muhtemelen `localStorage` önbelleğindeki eski veriyi render ediyordu).

2. **Live Sync (Re-Render) Router Kopukluğu:**
   Veri başarılı bir şekilde gelse veya güncellense dahi, `script.js` içerisindeki `onInventoryDataUpdated` dinleyicisi (PubSub Router) B1, B2 ve B3 tablolarını yalnızca **"İlk Yükleme"** (`!window._firstDataRendered`) esnasında ekrana çiziyordu. İkinci veya üçüncü bir canlı güncellemede (örn: mobilden stok düşürülmesi), masaüstü ekranında aktif olarak açık olan sekmenin **re-render (yeniden çizim) tetikleyicisi eksikti**.

---

## 🛠️ Uygulanan Çözümler ve Düzeltmeler

### 1. Canlı Güncelleme (Live Sync) Router'ı Yeniden Yazıldı 
`script.js` içindeki `onInventoryDataUpdated` event listener'ına Contextual Guard (Bağlamsal Koruma) eklendi.

- **B1 ve B2 İçin:** Artık `inventory_v2`'de bir değişiklik olduğunda, kod kullanıcının o an hangi sekmede (`tab-content.active`) olduğunu kontrol eder. Eğer B1 sekmesindeyse ve B1 güncellenmişse sadece B1 tablosunu (veya Kart görünümündeyse kartları) re-render eder.
- **B3 (Envanter Çıkış Yap) İçin:** Aynı şekilde B3 verisi değiştiğinde aktif sekme B3 ise `renderExitTable()` çağrılarak canlı olarak güncellenmesi sağlandı.

**[Neden Önemli?]:** Bu sayede cihazlardan birinde stok eksiltildiğinde, diğer cihazda tablo saniyesinde yenilenerek güncel stoğu gösterir ve "Yarış Durumu (Race Condition)" / Çift Çıkış hataları engellenir.

---

## 🚀 Yürütme: V2 Migration Nasıl Tetiklenecek?

> [!WARNING]
> Mimarinin sağlıklı çalışabilmesi için eski `inventory` koleksiyonundaki tüm verilerin `inventory_v2` alt koleksiyon (sub-collection) mimarisine taşınması ŞARTTIR.

Sistemde bu göç işlemini güvenli ve atomik olarak (Chunk Batching ile) yapacak olan `window.migrateDataFromOldToNew()` fonksiyonumuz zaten `firebase-handler.js` içinde mevcuttur.

Lütfen sistemi tarayıcınızda açın (Admin olarak giriş yapın) ve **Console (F12)** sekmesine geçerek şu komutu çalıştırın:

```javascript
await window.migrateDataFromOldToNew();
```

Bu işlem:
1. Tüm V1 `inventory` verilerinizi okur.
2. Eksik ID'leri `temp_` ile otomatik doldurur.
3. `undefined` gibi Firebase uyumsuz verileri temizler.
4. Verileri 490'lık güvenli paketler halinde (Batch) `inventory_v2` içindeki `[depo_adi]/items/[id]` yapısına taşır.
5. İşlem bittiğinde console'da *"🎉 MIGRATION TAMAMLANDI! Sayfayı yenileyebilirsiniz."* mesajını göreceksiniz.

İşlem tamamlandıktan sonra sayfayı yenilediğinizde, her cihaz artık `inventory_v2`'ye sorunsuz ve canlı olarak yazıp/okumaya başlayacaktır!
