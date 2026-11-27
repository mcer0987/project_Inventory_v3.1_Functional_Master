# v3.8 Hotfix (`HF-1` · `HF-2` · `HF-3`) — Lokal Test Senaryosu (`hf--scenerio`)

> **Ortam Kuralı:** Testleri yalnız `http://localhost` veya `http://127.0.0.1` (`inventory_demo` kökü) üzerinden çalıştırın. Test boyunca `firebase deploy` veya canlı sistem (`lifeserver_master`) işlemi yapılmaz.

---

## Ön Hazırlık
1. Tarayıcıda `http://127.0.0.1:5000/index.html` (veya lokal sunucu portu) ile açın, ardından **Yönetici Paneli** (`admin.html`) ve `F12` Geliştirici Araçları (Konsol + Mobil `390×844` cihaz modu) arasında geçiş yapmaya hazır olun.
2. Konsolda kırmızı hata (`pageerror` / beklenmeyen `console.error`) olmadığını gözlemleyin.

---

## Senaryo 1 — Radar Sıfır-Scroll Sıçraması, `ⓘ`/`×` Hizası & Dark Toolbar (`HF-1` & `HF-3`)
1. `admin.html` ana sayfasında sayfayı aşağı kaydırarak **Operasyon Merkezi** radar kartlarını görünür konuma getirin (`window.scrollY > 0`).
2. Dört radar kartının (**Aktif Zimmet & İade**, **Hurda & Servis**, **Kritik Sipariş İhtiyacı**, **AI Sarf Tüketim & Tahminleme**) her birine sırayla tıklayın.
   - **Beklenen:** Arka plandaki sayfa yukarı sıçramaz (`window.scrollY` sabit kalır), `#opsRadarModal` penceresi anında ekranın tam ortasında açılır ve arka plan kaydırması kilitlenir.
3. Pencere başlığındaki **`ⓘ` (Bilgi)** ve **`×` (Kapat)** düğmelerine yakından bakın.
   - **Beklenen:** Her iki ikon çerçevesinin tam merkezindedir; kayma veya yamuk hiza yoktur.
4. Üst sağdan temayı **Karanlık (Dark)** moda alın ve **AI Sarf Tüketim & Tahminleme** radarını açın.
   - **Beklenen:** `30 Gün / 60 Gün / 90 Gün` ve `Tümü / Kritik / Uyarı / Güvende / Yetersiz` araç çubuğu (`.ops-radar-toolbar`) tam koyu tema yüzey ve kontrastıyla görünür; beyaz kutu sızıntısı yoktur.

---

## Senaryo 2 — Sınırsız (`1..N`) Toplu EBYS Aktarımı & `⏳ Talebi Açık` Rozeti (`HF-1`)
1. **AI Sarf Tüketim & Tahminleme Motoru** (veya **Kritik Sipariş İhtiyacı**) radarını açın.
2. Sol sütundaki onay kutularından **4 veya daha fazla** kalem seçin (3 kalem sınırının üstüne çıkın).
3. Alt çubuktaki **"📦 Tamamını Tek Kalemde Birleştir & EBYS Talebi Aç (N Kalem)"** düğmesine tıklayın.
   - **Beklenen:** `#purchaseModal` açılır; kalem editöründe **1 adet konsolide satır** (`Toplu Sarf Malzeme İhtiyacı (N Kalem)` · Adet: `1`) yer alır, `#purDesc` (Açıklama) alanında ise seçilen tüm kalemlerin isim, mevcut stok ve önerilen adet dökümü eksiksiz görünür.
4. Bir birim ve tahmini tutar girip talebi kaydedin (veya **EBYS süreciyle gönder** ile başlatın), ardından radarı yeniden açın.
   - **Beklenen:** İlgili sarf malzeme satırında yeşil **`⏳ Talebi Açık · <Durum>`** rozeti görünür ve üst araç çubuğunda **"Açık Taleplileri Gizle (N)"** filtresi belirir.

---

## Senaryo 3 — Hızlı Çıkış Masası Tarih/Saat, Sidebar İkon Eşliği & "Servise Kaydı Aç" (`HF-1` & `HF-3`)
1. Sol menüden **Hızlı Envanter Çıkış Masası** (`productTypeSettings`) sekmesine geçin.
   - **Beklenen:** Tablodaki tarih ve saat bilgisi tek uzun satır yerine iki kompakt satırda (`.qe-date` üstte, `.qe-time` daha küçük/soluk altta) görünür ve `<td>` hücresi dışına taşmaz.
2. Başta **Hızlı Envanter Çıkış Masası**, **Tanımlar**, **Zimmet Yönetimi** ve **Satın Alma & Servis** olmak üzere sekmelerdeki `panel-intro` kutularına bakın.
   - **Beklenen:** Intro kutusundaki ikon, sol menüdeki (`sidebar`) ilgili sekme ikonuyla birebir aynıdır.
3. **Satın Alma & Servis** (`purchaseTab`) sekmesinde araç çubuğundaki **"🛠️ Servise Kaydı Aç"** düğmesine tıklayın.
   - **Beklenen:** "Yakında" bilgilendirme/önizleme uyarısı açılır ve hatasız kapanır.

---

## Senaryo 4 — `#tablePersonel` Düğmeleri, Tanımlar/Zimmet Bento & `🔑 Geçici PIN` Dark Tema (`HF-2` & `HF-3`)
1. **Tanımlar** (`definitionsTab`) sekmesine geçip `#tablePersonel` tablosunda bir personelin **`Düzenle`**, **`Geçici PIN`** ve **`Askıya Al`** düğmelerine sırayla tıklayın.
   - **Beklenen:** Hiçbir buton sessizce yutulmaz veya yetki hatasına düşmez; ilgili düzenleme / PIN / askıya alma penceresi açılır.
2. Temayı **Dark** moda alıp herhangi bir aktif personel için **`Geçici PIN`** penceresini açın.
   - **Beklenen:** `🔑 Geçici PIN / Giriş Kodu Yenile` penceresi, üst bilgi kutusu ve `<select>` / `<input>` alanları Space Titanium koyu yüzey (`#161f30` / `#0f172a`) ve yüksek kontrastlı metinle açılır.
3. `F12` ile ekran genişliğini **`390×844` (Mobil)** boyutuna getirin; üst bardaki `.sync-status`, **Satın Alma & Servis** altındaki `.kpi-container--trio`, **Zimmet Yönetimi** (`#invAssignmentTable`), **Tanımlar** (`#tablePersonel`) ve açık `#purchaseModal` pencerelerini kontrol edin.
   - **Beklenen:**
     - `.sync-status` nav dışına taşmaz; mobilde `#lastSyncTime` gizlenerek (`title` tooltip'te korunarak) taşma engellenir.
     - `.kpi-container--trio` ve tablolar yatay taşma olmadan Bento kartlarına dönüşür; butonlar hücre dışına taşmaz.
     - `#purchaseModal` mobilde ekrana tam oturur; kapatma ve form kontrolleri kesilmez.

---

## Senaryo 5 — `#loginModal` Sıfır-Scroll Görünüm Anahtarı (`HF-3`)
1. Oturumu kapatarak `index.html` giriş ekranına dönün (standart masaüstü ve mobil görünüm).
   - **Beklenen:** Normal giriş ekranında `#loginModal` içinde dikey kaydırma çubuğu (`scroll`) oluşmaz; giriş düğmesi tam görünürdür.
2. **"Şifremi Unuttum / Sıfırlama Talebi"** (`#loginResetToggleBtn`) düğmesine tıklayın.
   - **Beklenen:** Üstteki giriş alanları gizlenir, sıfırlama kartı aynı pencerenin içinde sıfır scroll ile açılır.
3. **"Vazgeç"** düğmesine basın.
   - **Beklenen:** Tekrar normal giriş formuna döner; sıfırlama alanı gizlenir ve scroll oluşmaz.

---

## Senaryo 6 — Şifre Sıfırlama Anti-Spam, Lokal Demo Yedeği & Temiz Logout (`HF-2`)
1. `index.html` giriş ekranında şifre sıfırlama kartını açıp bir personel **PRI** girin ve **"Sıfırlama Talebi Gönder"** düğmesine tıklayın (not bırakabilirsiniz).
   - **Beklenen:** Tek tip nötr onay mesajı görünür (`inventory_demo` kuralları henüz buluta deploy edilmemiş olsa bile `localhost` / `127.0.0.1` yerel demo yedeği devreye girer).
2. Aynı **PRI** ile aynı ekrandan art arda 1-2 kez daha **"Sıfırlama Talebi Gönder"** tıklayın; ayrıca isterseniz 1 saat içinde farklı PRI'lerle flood korumasını deneyin.
   - **Beklenen:** Aynı PRI 24 saat boyunca yerelde engellenir (ağa gereksiz yazma isteği atılmaz) ve yine nötr mesaj gösterilir.
3. Yönetici olarak giriş yapıp `admin.html` → **Tanımlar** → **🔑 Şifre Sıfırlama Talepleri & Geçici PIN** kartını kontrol edin.
   - **Beklenen:** Gönderilen talep tabloda görünür (`[Lokal Demo Modu — Kurallar Deploy Edilene Kadar]` etiketiyle) ve engellenen mükerrer tıklamalar **`🛡️ +N mükerrer tık engellendi`** / üst özet rozeti olarak raporlanır.
4. Yönetici panelinden **Çıkış Yap (Logout)** düğmesine tıklayın ve Geliştirici Konsolunu (`Console`) izleyin.
   - **Beklenen:** Çıkış temiz şekilde tamamlanır; konsolda **`⛔ [Güvenlik] purchaseOrders: Firestore okuma yetkisi reddedildi`** hatası **çıkmaz**.
