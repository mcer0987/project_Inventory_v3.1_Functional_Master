# EBYS Aşama 3 — denetim düzeltme raporu

**Dal:** `feat/v3.4-ebys` · **HEAD:** `5be0579` · **Durum:** Yerel değişiklikler; commit ve deploy yok.

## Düzeltmeler

| Bulgu | Uygulama ve kanıt |
|---|---|
| P1-1 İlk onay kuru | İlk onayda döviz kuru, tarih, kaynak ve TRY karşılığı hem personel hem yönetici yazımında zorunlu. Eksik kullanılan kur ve kaynak reddediliyor. Kuralın sabit şeması için kullanılmayan USD/EUR oranları nötr `1` tutuluyor; ayrıntı ve çıktıda yalnız kullanılan kurlar gösteriliyor. Manuel girilen kullanılan oranlar snapshot olarak saklanıyor. |
| P1-2 Legacy düzenleme | `items` içermeyen kayıt, sanal kalemi yalnız görüntüler. Açıklama, konu, miktar, birim ve diğer eski alanlar düzenlenirken fiyat/KDV aranmaz; kayıt kendiliğinden kalemli şemaya geçirilmez. İzole tarayıcı deneyi yazmayı ve `items` alanının yokluğunu doğruladı. |
| P2-1 Toplam tutarlılığı | Yazdırma satırları ve özet aynı `PurchaseMoney.calculate()` sonucundan geliyor. Motor satırları BigInt kuruş hesabıyla yeniden üretiyor; saklanan hatalı `totalPrice` ekrana basılmıyor. Kasıtlı `999` satır örneği `10.00` satır ve `10.00` genel toplam verdi. |
| P2-2 Pasif atama | Yeni akış çözümlemesi ve iki personel araması `active:false` kayıtları dışlıyor. Şablon kaydında tekrar çözümleme var; yeni UID çözümü pasif kayıtları atlayıp tarihsel sahiplik çözümünü koruyor. Birim servis transaction'ı yeni pasif personel bağını reddediyor. |
| P2-3 Sayı girdisi | Kalem formu ham ondalık metni koruyor; üstel gösterim, sayısal olmayan metin ve miktarda üç, fiyat/KDV'de iki basamaktan fazla ondalık giriş `setCustomValidity` ve saf hesap kontrolüyle kaydedilmiyor. |
| P2-4 Personel ekranı | Aşama 2'nin `5be0579` commit'i servis/UI dosyalarını içeriyor fakat `script.js` personel modalı açma, ekleme ve düzenleme bağlantılarının üç hunk'ını içermiyor. Bu üç hunk yerelde doğrulandı; Aşama 2 raporunun eski commit durumu düzeltildi. Ortak dosyadaki stok/içe aktarma hunks'ları EBYS teslimine dahil edilmemeli. |

## Doğrulama

- `npm run test:unit`: 279/279 geçti.
- `npm run test:rules`: 228/228 geçti (24 suite).
- `npm run lint:xss`: izinsiz ifade 0.
- `node scratch/ebys-stage2-ui.cjs`: 6 kontrol, pageerror 0.
- `node scratch/ebys-stage3-ui.cjs`: 9 kontrol, pageerror 0.
- `node scratch/ebys-audit-fix-ui.cjs`: legacy düzenleme, satır/genel toplam ve hatalı sayı için 3 kontrol; pageerror 0.
- `node scratch/ebys-audit-fix-workflow.cjs`: pasif atama reddi ve aktif kişi kabulü geçti.
- `git diff --check`: hata yok.

**Kural logu:** `scratch/ebys-audit-fix-rules.log` · **Unit logu:** `scratch/ebys-audit-fix-unit.log`.

## Teslim sınırı

`script.js` içindeki personel hunk'ları güncel diff'te 550, 569 ve 593. satırlarda; aynı dosyanın 1469. satırından sonrası stok/içe aktarma işidir. Commit için seçmeli staging gerekir; bu çalışma hiçbir commit oluşturmadı ve diğer işlere ait kirli çalışma ağacını değiştirmedi.

Yeni akış seçimi uygulamada pasif kişiyi reddediyor; mevcut Firestore kuralı doğrudan SDK ile yazılmış her on adımın personel aktifliğini tek tek doğrulamıyor. Firestore belge erişim/ifade sınırı nedeniyle bunun sunucu tarafında tam kapanışı ayrı bir atama sicili tasarımı gerektirir. Aynı şekilde kural kalem sayısı ve temel alanları denetler; tüm ondalık ölçek doğrulaması form ve hesap motorundadır. Bu iki doğrudan SDK sınırı bağımsız son onayda açıkça değerlendirilmelidir.
