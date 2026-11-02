# EBYS — UAT form, personel hesabı ve belge türü düzeltmeleri

**Dal:** `feat/v3.4-ebys` · **Durum:** Yerel çalışma ağacı, commit/deploy yapılmadı.

## 1. Kalemler, ödenek ve eski adet alanı

**Son UAT kabulü:** Proje sahibi manuel testi tamamladı. Üstteki `purQty` alanı iki formdan kaldırıldı; eski kayıt miktarı korunur. Tahmini USD/EUR kurları Operasyon Merkezi'nden yönetilir. Dövizli belgenin ilk onayında güncel ayar sunucudan okunur ve tarih/kaynağıyla belgeye sabitlenir; ayrıca kur giriş penceresi açılmaz. TRY talepleri kur ayarı gerektirmez. Aşağıdaki ilk uygulama notlarının kur girişi ve gizli adet alanına ilişkin bölümleri bu kararla güncellenmiştir.

Yerel UAT için `node scratch/emu-ensure-uat.mjs` mevcut emülatör verisini silmeden hesap ve Test birimi ekler. Ortak parola kutusu tarayıcının yerleşik maskelemesini kullanır; seçip üzerine yazma hatası giderildi.

**Bilinen sınır:** Mevcut satın alma Rules yolu 1000 ifade sınırına yakındır. Kur snapshot alanlarının zorunluluğu ve değişmezliği denetlenir; yönetici kur belgesiyle birebir eşleşme Rules düzeyinde henüz doğrulanmaz. Bu kontrol için ayrıca sadeleştirme gerekir. Son doğrulama: birim 280/280, Rules 228/228, XSS 0; commit öncesi manuel UAT tamamlandı.

- Yeni kalemli talepte üstteki `ADET` alanı gizlidir; miktar her kalemde tutulur. Kalemsiz eski kayıt düzenlenirken eski adet alanı görünür ve eski kayıt şemasında kalır.
- Yalnız TRY kalemlerinde planlanan ödenek, BigInt kuruş hesabındaki genel toplamdan otomatik doldurulur. Kullanıcı tutarı değiştirirse manuel mod korunur; “Hesaplananı kullan” ile otomatik değere dönebilir.
- Dövizli kalemlerde kullanılan USD/EUR için *tahmini* TRY kurları girilirse planlanan ödenek otomatik hesaplanır. Kullanıcı tahmini kur girmeden de TRY ödeneğini elle yazabilir. Tahmini kurlar `budgetEstimateRates` içinde saklanır ve **ilk onay kuru değildir**; ilk onayda kur, tarih ve kaynak ayrıca alınarak `exchangeRate` snapshot'ı yazılır.
- `budgetMode` (`auto`/`manual`) ve `documentTypeCode` yeni kalemli kayıtlarla saklanır. Eski kayıtlar sessizce dönüştürülmez. Onaylanmış içerikte bu alanların değiştirilmesi engellenir.

## 2. Belge türü ve süreç eşlemesi

“Belge / Ürün Türü” alanı belge türüne ayrıldı. Kalemlerdeki ürün/hizmet kategorisi yerinde kalır; `tur` eski ekran uyumu için ilk kalemin kategorisini taşır. Satın alma formunda yalnız `PURCHASE_REQUEST` (Satın Alma Talebi) seçilebilir. Tanımlar > Belge Türleri tablosunda Gelen Evrak, Giden Evrak, İç Yazışma, Olur/Onay Belgesi ve Üst Yazı ayrı süreç yollarıyla gösterilir. Bunlar şimdilik planlıdır; kendi kayıt/imza/dağıtım akışları yapılmadan satın alma formundan başlatılamaz. Yeni iş akışı şablonları belge türü koduyla kaydedilir; eski kodsuz şablonlar satın alma uyumu için bu türde kabul edilir.

Belge türü ve dosya planı kodu aynı şey değildir. Devlet Arşivleri Başkanlığı rehberi, kurum ihtiyaçlarına göre belge türlerinin dosya kodları altında ayrıca tanımlanmasını belirtir; bu pilot katalog mevzuata tam uyum beyanı değildir. Kaynak: [Dosya Planları Rehberi](https://www.devletarsivleri.gov.tr/varliklar/dosyalar/formlar/dosyaplan%C4%B1rehberi1.1.pdf), [Saklama Süreli Standart Dosya Planı](https://www.devletarsivleri.gov.tr/varliklar/goruntuler/haberler/image/SSDP.PDF%20%282024%20V.4%29.pdf).

Sonraki evrak aşamasında katalog Firestore tanımına, sürümlü şablon bağına, dosya planı koduna ve kurum onayına taşınmalı. Giden/gelen/olur türlerinin gerçek süreçleri o aşamada kurulmalı.

## 3. Yerel personel hesabı testi

`localhost` sunucusu tek başına Firebase emülatörü değildir. Uygulama yalnız `?emu=1` ile hem Auth hem Firestore emülatörlerine bağlanır. Farklı parolalı mevcut PRI hesabına el koyma veya UID'yi silme yoluna gidilmez; kullanıcıya ortamı açıklayan mesaj eklendi.

1. Ayrı terminalde `npm run emu`, diğerinde `npm run serve`.
2. `http://127.0.0.1:5500/index.html?emu=1` adresini açın. Konsol `ACTIVE DATABASE ROOT: inventory_demo @ EMULATOR` göstermeli.
3. Emülatör zaten tohumlandıysa `scratch/emu-seed.mjs` içindeki `flow.personel` ve `flow.onaylayici` hesaplarını kullanın. Tohumlama gerekiyorsa `node scratch/emu-seed.mjs push` **emülatör verisini sildiği** için yalnız mevcut yerel test verisi gerekmiyorsa çalıştırılmalı; canlı köke yazmaz.
4. Aynı PRI ile yeni hesap açmak yerine mevcut bağlı test personellerini akışa atayın. Yeni personel gerekiyorsa benzersiz PRI seçin.

Sırası gelmeyen personelin “Bana Gelen Onaylar” listesinde talebi görmemesi beklenen UI davranışıdır. Yetki olumsuz testi için ilgili personel hesabında liste boşluğunu, ardından sıradaki hesapta onay düğmesini doğrulayın. Doğrudan SDK yetki testi emülatör Rules paketindedir.

## Doğrulama

- `npm run test:unit`: 280/280 geçti.
- `npm run test:staff:emu`: 15/15 geçti. Eski UID kaldırma senaryoları, Aşama 2'nin UID değişmezlik kuralına uygun olarak yalnız test tohumu yoluyla kuruluyor.
- `node scratch/ebys-stage3-ui.cjs`: TRY otomatik ödenek, USD tahmini kur, manuel geçiş, üç para birimli örnek, belge türü ve eski detay kontrolleri geçti; pageerror 0.
- `npm run lint:xss`: izinsiz ifade 0.
- `npm run test:rules`: 228/228 geçti; yanlış belge türüyle yeni satın alma kaydı reddedildi, on adımlı eski akış korundu. Tam log: `scratch/ebys-uat-fixes-rules.log`.
- `git diff --check`: hata yok.

**Yayın kapısı:** `scratch/hosting-files.js` yeni iki uygulama dosyası için beklenen sayıyı 76'ya çıkardı. Çalışma ağacındaki ilgisiz `release-journal/` üç dosyası nedeniyle gerçek sayı 79; hosting beyaz liste kontrolü hâlâ başarısız. Deploy yapılmadı.

**Kural sınırı:** Pilot kuralları belge türü kodunu yeni kayıt ve kalem içeriği yazımında denetler. Sadece kod alanını değiştiren doğrudan SDK taslak güncellemesi, mevcut on adımlı akışın 1000 ifade sınırı nedeniyle ayrıca kapatılmadı. Uygulama arayüzünde böyle bir geçiş bulunmaz; genel belge türü sicili ve kurala dayalı süreç eşlemesi sonraki evrak aşamasının kabul kapısıdır.
