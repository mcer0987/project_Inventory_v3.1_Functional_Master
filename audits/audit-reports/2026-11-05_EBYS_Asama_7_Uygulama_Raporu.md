# v3.4 EBYS Aşama 7 Uygulama Raporu

**Tarih** 5 Kasım 2026  
**Dal** `feat/v3.4-ebys-asama-7`  
**Taban** Aşama 6 kapanış commit’i `4b01e94`  
**Durum** Yerel uygulama ve test paketi incelemeye hazır.

## Uygulama

- Evrak yazarı, kesin kayıt numarası olan kapanmış veya arşivlenmiş evrakı açıp **Doğrulama QR’ı oluştur** işlemini seçer. Web Crypto 16 rastgele bayttan bir anahtar üretir. Özel rezervasyon, evrak başlığı ve kamusal kayıt aynı transaction’da yazılır. Çakışan aday yeniden üretilir. Aynı evrak için eşzamanlı işlem daha önce ayrılan anahtarı döndürür.
- QR, **Çıktı önizleme → Yazdır** görünümünde SVG olarak yer alır. Adresin parça bölümünde yalnız doğrulama anahtarı bulunur. Encoder uygulama içinde çalışır ve çalışma zamanı bağımlılığı gerektirmez.
- `verify.html` anonim olarak `ebysVerifications/items/{token}` yoluna tekil sorgu gönderir. Görünüm kayıt numarası, kayıt tarihi, evrak türünden türetilen güvenli konu özeti, güncel durum ve sabit sürümün kayıtlı SHA-256 özetini gösterir. Kurum içi teyit uyarısı ekranda ve çıktıda bulunur.
- Yönetici **İcra Takibi → Detay → Arşivle** işlemiyle kapalı evrakı arşivler. Evrak başlığı, değiştirilemez arşiv olayı ve varsa geçerli kamusal kayıt birlikte güncellenir. **Doğrulamayı iptal et** aynı anahtarı `İptal` durumuna alır. İptal edilmiş bir doğrulamanın durumu arşivlemede korunur.
- Tam evrak, imza geçmişi ve özel token eşlemesi mevcut özel erişim kapılarında kalır. Kamusal kayıtlar listelenemez. Arşiv olayları bu aşamadan itibaren yapılan arşiv geçişlerinde oluşur.

## Diff özeti

| Alan | Dosyalar |
| --- | --- |
| Doğrulama ve arşiv servisi | `src/services/ebys-verification-service.js`, `src/services/ebys-execution-service.js` |
| Kamusal görünüm, şema ve QR | `verify.html`, `src/ui/ebys-verification-ui.js`, `src/utils/ebys-verification-schema.js`, `src/utils/ebys-verification-qr.js` |
| Evrak çıktısı, yönetici işlemleri ve rehber | `src/ui/ebys-documents-ui.js`, `src/ui/ebys-documents.css`, `src/ui/ebys-execution-ui.js`, `src/ui/ebys-showcase-modal.js` |
| Kurallar, test ve Hosting denetimi | `firestore.rules`, `tests/rules/ebys-processes.test.mjs`, `tests/unit/ebys-verification.test.mjs`, `scratch/hosting-files.js` |

## Doğrulama

- 293 birim testi, 276 Firestore kural testi ve XSS denetimi geçti. Hosting denetimi 99 beklenen dosyayı doğruladı.
- Emülatörde anonim REST ve SDK okuması beş alana sınırlandı. Testler, özel okuma ve listeleme reddi, sahte projeksiyon reddi, token çakışması, eşzamanlı rezervasyon, arşiv olayının zorunlu oluşu, iptal ve arşiv içeriği değişmezliğini kapsadı.
- Tarayıcı kontrolü geçerli, bulunamayan ve bozuk doğrulama yanıtlarını, fazladan alanın ekrana taşınmamasını ve yazdırma şablonundaki QR’ı doğruladı. QR matrisi canlı ve emülatör adresleri ile kapasite sınırında referans kodlayıcıyla birebir karşılaştırıldı. [QR boyutları](https://www.qrcode.com/en/about/version.html) · [Referans kodlayıcı](https://www.nayuki.io/page/qr-code-generator-library)
- Yerel kanıtlar `scratch/asama7-test-all.log` ve `scratch/asama7-browser.log` dosyalarındadır.

## Manuel kabul

Kesin kayıt numarası almış bir evrakı icradan kapatın. Yazar hesabıyla QR oluşturup yazdırma önizlemesini açın. Bağlantıyı oturumsuz sekmede açarak beş alanı kontrol edin. Yönetici hesabıyla arşivleyip aynı bağlantıda **Arşivde** durumunu, ardından doğrulamayı iptal edip **İptal** durumunu doğrulayın.
