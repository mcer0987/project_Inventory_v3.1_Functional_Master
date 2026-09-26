# 🚀 ITSM & Envanter Yönetim Sistemi - Geliştirme Raporu

Bu doküman, sistem üzerinde yapılan son mimari iyileştirmeleri, arayüz modernizasyonlarını ve eklenen VIP yönetim modümlerini özetlemektedir.

---

## 🛠️ YENİ EKLENEN ÖZELLİKLER & MODÜLLER

### 1. B1 Depo Durum Filtresi Modülü (`filter-module.js`)
* **Bağımsız Mimarî:** `script.js` dosyasının boyutunu artırmamak adına sıfırdan bağımsız bir `filter-module.js` oluşturulmuştur.
* **Zararsız State Yönetimi (Mutation-Free):** Orijinal `window.data.b1` dizisi asla değiştirilmez. Filtreleme işlemi, `window.getProcessedData` içerisine eklenen `window.getFilteredB1Data` kancası (hook) üzerinden sadece görünüm ve arama sonuçlarını hedef alır.
* **Modern Arayüz (UAB Tasarımı):** B1 arama çubuğunun yanına `class="uab-btn-outline"` ile uyumlu, modern bir durum filtresi seçeneği (`#b1StatusFilter`) eklenmiştir:
  * 🟢 **Sadece Aktifler (Varsayılan):** Durumu "Pasif" olan tüm kayıtları tablodan, kartlardan ve arama sonuçlarından gizler.
  * ⚪ **Hepsini Göster:** Aktif ve pasif tüm envanteri listeler.
  * 🔴 **Sadece Pasifler:** Yalnızca pasif duruma alınmış envanteri listeler.

### 2. VIP Tekerrür Kayıtları Temizleyici (`vipCleanDuplicates`)
* **Milimetrik Eşleşme Mantığı (Heuristic):** Sarf malzemelerinin benzer isimlerden dolayı yanlışlıkla silinmesini engellemek için çok sıkı bir kontrol algoritmaları geliştirildi:
  * Ya **Seri Numarası** (`seriNo`, `serialNo`, `sn`) birebir aynı olmalı,
  * Ya da `id` ve önbellek index (`__index`, `_repo` vb.) alanları hariç, **TÜM alanlar** (timestamp, not, alan kişi, tarih, raf vb.) milimetrik eşleşmelidir.
* **V2 Batch Veritabanı Uyumu:** Rastgele `deleteDoc` çağrıları yerine projenin yerleşik V2 Batch mimarisi olan `window.saveData` altyapısına sadık kalınmıştır. Bu sayede 500 işlem limiti koruması ve atomic chunk senkronizasyonu sağlanmıştır.
* **Özel Onay Mekanizması:** İşlem başlamadan önce tüm depolar (`B1`, `B2`, `B3`) taranır ve admin kullanıcısına SweetAlert / Custom Confirm ile `"Bulunan Birebir Kopya (Tekerrür) Sayısı: X - Silmek istiyor musunuz?"` sorusu yöneltilir.

### 3. Oturum Giriş ve Ekran Kilitlenme Çözümü
* **Cam Efektli (Glassmorphism) Bariyer:** Oturum açılmamışken envanter arayüzü gizlenmek (`display: none !important`) yerine arka planda cam gibi görünür (`filter: blur(12px)`), ancak girişler engellenir (`pointer-events: none`). Oturum açıldığında bulanıklık kalkarak akıcı bir UX sağlar.
* **Giriş Kodu Obfuscation Desteği:** Güvenlik katmanlarının input kimliğini değiştirmesi ihtimaline karşın CSS seçicileri hem `#loginCode` hem de `#access-val-node` elemanlarını kapsayacak şekilde modernize edilmiştir.

---

## 📁 DEĞİŞTİRİLEN VE OLUŞTURULAN DOSYALAR

| Dosya Adı | Değişiklik Türü | Açıklama |
| :--- | :--- | :--- |
| `filter-module.js` | **[YENİ]** | B1 pasif ürün filtrelemesini zararsız state yönetimiyle sağlayan bağımsız modül. |
| `index.html` | **[DÜZELTME]** | B1 arama çubuğuna `#b1StatusFilter` seçeneği eklendi ve `filter-module.js` dahil edildi. |
| `script.js` | **[DÜZELTME]** | `window.getProcessedData` fonksiyonu içine `window.getFilteredB1Data` kancası (hook) eklendi. |
| `admin.html` | **[DÜZELTME]** | VIP Sistem Aksiyonları paneline mor renkli "Tekerrürleri Temizle" butonu eklendi. |
| `admin-system-control.js` | **[DÜZELTME]** | `window.vipCleanDuplicates` fonksiyonu milimetrik kontrol algoritmalarıyla tanımlandı. |

---

## 🧪 DOĞRULAMA VE TEST PLANLARI

1. **B1 Filtre Doğrulaması:**
   * B1 sekmesindeyken durum filtresi değiştirildiğinde tablonun/kartların anında filtrelendiği gözlemlenmelidir.
   * Filtre "Sadece Aktifler" konumundayken arama yapıldığında pasif ürünlerin arama sonuçlarına gelmediği doğrulanmalıdır.
2. **Tekerrür Temizliği Doğrulaması:**
   * Yönetici panelinden "Tekerrürleri Temizle" butonuna basıldığında önce tarama yapıldığı ve tespit edilen kopya sayısının Custom Confirm modalı ile gösterildiği doğrulanmalıdır.
   * Onay verildikten sonra kopyaların silinerek başarı mesajı/bildirimi gösterildiği teyit edilmelidir.
