Active Role: Gemini Flash / Inspector — Fast QA & DOM Verification (Auditor / Zero-Trust)

Medipol Envanter/EBYS (project_Inventory) anayasasına ve salt-okunur QA kısıtlamalarına tam uyularak; hiçbir dosyada değişiklik yapılmadan, canlı veritabanına ve /services katmanına yazma işlemi yürütülmeden Zimmet PDF Çıktısı (ZIM-04) ve Admin Özel İzleme Tablosu (ADM-05) mimari, DOM kancaları ve birim test seviyesinde denetlenmiştir.

1. Zimmet PDF & Türkçe Font Denetimi (ZIM-04 + AUTH-01 Maskeleme Çifti)
A. TTF Font Gömme (addFileToVFS / addFont / setFont) Mekanizması
Font Dosyaları ve VFS Kaydı:
Roboto-Regular.js: Base64 formatındaki TrueType font verisi IIFE içinde jsPDFAPI.events.push(['addFonts', callAddFont]) mekanizmasıyla kaydedilir. Belge örneği oluşturulduğunda this.addFileToVFS('Roboto-Regular.ttf', font) ve this.addFont('Roboto-Regular.ttf', 'Roboto', 'normal') çağrılır.
Roboto-Bold.js: Aynı izole yapıda this.addFileToVFS('Roboto-Bold.ttf', font) ve this.addFont('Roboto-Bold.ttf', 'Roboto', 'bold') çağrılır. VFS dosya adları çakışmaz.
Tembel Yükleme (Lazy-Loading):
pdf-generator.js#L14-L30: ensureZimmetFonts() fonksiyonu, font scriptlerini yalnızca PDF oluşturma butonu tetiklendiğinde dinamik olarak DOM'a ekler (loadScriptOnce). Sayfa ilk açılış yükünü şişirmez.
Yazı Tipi Tanımları:
pdf-generator.js#L38, L64, L101-L102, L253, L274: Tüm başlıklar, hücreler, imza blokları ve sayfa numaraları doc.setFont('Roboto', 'normal') veya doc.setFont('Roboto', 'bold') ile çizilir; Helvetica gibi Türkçe glifleri bozan çekirdek fontlar tamamen devre dışıdır.
Karakter Seti Doğrulaması:
tests/unit/pdf-fonts.test.mjs#L71-L93: Font ikililerinin Windows Unicode cmap tabloları (Format 4 / Format 12) doğrudan bayt düzeyinde taranmakta olup; ı (U+0131), İ (U+0130), ş (U+015F), Ş (U+015E), ğ (U+011F), Ğ (U+011E), ü (U+00FC), Ü (U+00DC), ö (U+00F6), Ö (U+00D6), ç (U+00E7), Ç (U+00C7) harflerinin tümünün glif karşılıkları doğrulanmıştır.
B. Personel & Teslim Eden Veri Güvenilirliği (AUTH-01 Maskeleme Önlemi)
Kanonik Veri Ayrımı:
src/services/assignment-service.js#L333-L344: findPerson(personelId) personeli doğrudan veritabanındaki personel koleksiyonundan çözümler. personBlock() yalnızca id, adSoyad ve birim alanlarını döner; personelin gizli giriş kodu (code) veya parolası nesneye alınmaz.
src/services/assignment-service.js#L359-L366: issuerOf(raw, req, fallbackDate) teslim eden yetkili bilgisini; raw.onaylayan -> raw.approvedBy -> req.approvedBy -> onay notu sırasıyla gerçek hareket/onay kaydından çeker.
src/services/assignment-service.js#L412-L418: Belge üstverisinde duzenleyen: txt(duzenleyen, window.currentUser && window.currentUser.name) olarak geçerli oturum yöneticisi atanır; teslimEdenler ise b3/talep onayını veren gerçek yöneticilerdir.
pdf-generator.js#L147-L148: İmzaya basılan yetkili docData.belge.teslimEdenler[0], personel ise docData.personel.adSoyaddır. Eski sabit veriler (örn. ONUR POLAT, sabit ticket 223531 vb.) tamamen kaldırılmıştır.
Her İki Ekrandaki DOM Tetikleyicileri:
Personel Ekranı (index.html): index.html#L870
<button class="b3-action-btn btn-action-primary" type="button" onclick="window.generatePersonnelZimmetPDF(window.getActiveUser() && window.getActiveUser().id)">
window.getActiveUser() ile aktif oturumdaki personelin kimliği aktarılır.
Yönetici Ekranı (admin.html): src/modules/admin/inventory-management.js#L288-L295
Admin Zimmet sekmesinde her satırda onclick="window.generatePersonnelZimmetPDF('${a.personelId}')" butonu oluşturulur ve admin.html:3116'daki pdf-generator.js kütüphanesini çağırır.
2. Admin Özel İzleme Tablosu Denetimi (ADM-05)
A. DOM İskeleti ve Seçici Uyumu
Hedef DOM Tablosu:
admin.html#L557-L566:
html
<table id="customWatchTable" class="table table-sm table-hover mb-0">
    <thead class="bg-light sticky-top">
        <tr>
            <th>Ürün</th>
            <th class="text-center">Stok</th>
            <th>Durum</th>
        </tr>
    </thead>
    <tbody></tbody>
</table>
Sekme Gezinmesi ve Tetikleme:
admin.html#L267: Dashboard menüsü onclick="showAdminTab('dashboard-content')" ile tetiklenir.
src/modules/admin/admin-dashboard.js#L1317-L1323: showAdminTab içinde tabId === 'dashboard-content' kontrolüyle window.renderDashboardStats() çağrılır.
src/modules/admin/admin-dashboard.js#L1515-L1517: renderDashboardStats() içinde renderCustomWatchDashboard() çalıştırılır.
src/modules/inventory-logic.js#L298: Stok güncellendiğinde de renderCustomWatchDashboard() otomatik tetiklenir.
B. ADM-05 Regresyon Koruması (Tablonun Silinmemesi ve Kart Kapsayıcısı)
src/modules/admin/admin-dashboard.js#L1661-L1673:
Eski Hata (Faz 4): table.parentElement.innerHTML doğrudan ezilerek kartlar basılıyordu; bu işlem #customWatchTable öğesini DOM'dan tamamen yok ettiği için sonraki çağrılarda document.querySelector('#customWatchTable') null dönüyor ve tablo yenilenmiyordu.
Yeni Mimari (Faz 5 K3):
javascript
const table = document.querySelector('#customWatchTable');
if (!table) return;
let cardContainer = document.getElementById('watchCardsContainer');
if (!cardContainer) {
    table.style.display = 'none';
    cardContainer = document.createElement('div');
    cardContainer.id = 'watchCardsContainer';
    cardContainer.className = 'watch-grid';
    table.insertAdjacentElement('afterend', cardContainer);
}
Tablo öğesi DOM'da gizlenmiş şekilde korunur; kartlar kardeş öğe (watchCardsContainer) içine basılır. Tekrarlı çağrılarda tablo kaybolmaz.
Boş Durum Kontrolü: İzlenen ürün yoksa cardContainer.innerHTML = '<div class="empty-state">İzlenen ürün bulunamadı.</div>' basılır; tablo boş veya bozuk bir arayüze düşmez.
Aksiyon Delegasyonu: src/modules/admin/admin-dashboard.js#L1740-L1744 ile data-action üzerinden watchDetail, watchPurchase, watchOrder fonksiyonları bağlanır.
3. Kalite Kapısı & Test Kanıtı

Testler Node.js test koşucusu üzerinden çalıştırılmıştır:

A. Zimmet PDF, Türkçe Font & Oturum Doğrulama Birim Testleri

Komut: node --test --test-reporter=spec tests/unit/pdf-fonts.test.mjs tests/unit/zimmet-data.test.mjs tests/unit/session-store.test.mjs

text
✔ Roboto-Regular.js: jsPDF.API'ye 'Roboto' / 'normal' olarak kaydolur (5.3803ms)
✔ Roboto-Regular.js: Türkçe harfler (ş,ğ,ı,İ,ö,ü,ç ve büyükleri) cmap'te var (2.9756ms)
✔ Roboto-Bold.js: jsPDF.API'ye 'Roboto' / 'bold' olarak kaydolur (2.3976ms)
✔ Roboto-Bold.js: Türkçe harfler (ş,ğ,ı,İ,ö,ü,ç ve büyükleri) cmap'te var (3.6016ms)
✔ iki ağırlık da aynı VFS adını paylaşmaz (Regular/Bold karışmaz) (4.9888ms)
✔ setActiveUser: giriş kodu (ve parola/token) ne localStorage'a ne window.currentUser'a yazılır (4.6244ms)
✔ getActiveUser: J8 öncesi kodu taşıyan oturum okunurken ayıklanır ve yeniden yazılır (göç) (2.5281ms)
✔ getStaffAuthMode (J10): sabit "accounts" — sunucudaki eski staffAuthMode değeri yok sayılır (2.6982ms)
✔ isStaffAccountSession: yalnız @staff.medipol.local e-posta/parola oturumu; anonim ve admin değil (2.6921ms)
✔ canlı yönetici arayüzü belirteçteki role, aynı oturuma ve canlı köke bağlıdır (2.8792ms)
✔ bilinmeyen / boş personelId → null (23.5876ms)
✔ kalem kümesi = Kişi Envanterim (aktif + teslim alınmış), eskiden yeniye (7.5206ms)
✔ sözleşme: alan seti, tipler, metin alanları boş değil (5.2182ms)
✔ saf veri: JSON eşdeğeri, window.data referansı yok, oturum kodu sızmaz (5.5318ms)
✔ cihaz kimlikleri ve ürün bilgisi kanonik şemadan; eski talep stoktan tamamlanır (6.6856ms)
✔ zimmetleyen yönetici: onaylayan → approvedBy → bağlı talep → eski onay notu (5.4282ms)
✔ belge bloğu: deterministik belge no, İstanbul saati, düzenleyen, özet (5.804ms)
✔ zimmeti olmayan personel: boş kalem listesi, geçerli belge (9.6457ms)
✔ b3 satır belgesi: zimmet, çıkış, iade, eski şema, bilinmeyen id (5.6192ms)
ℹ tests 19
ℹ suites 0
ℹ pass 19
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 393.1432
B. Genel Birim Test Süiti (npm run test:unit) Özeti
Toplam Test: 389
Başarılı (Pass): 389
Başarısız (Fail): 0
Çalışma Süresi: ~45.8 saniye
Sonuç

ZIM-04 (Türkçe karakter garantili A4 resmi zimmet tutanağı & oturum/teslim eden veri doğruluğu) ve ADM-05 (Özel İzleme Paneli DOM kancası ve yeniden çizim kararlılığı) gereksinimlerinin kod sözleşmeleri, DOM yapıları ve birim testler nezdinde sıfır hata ile eksiksiz sağlandığı kanıtlanmıştır.