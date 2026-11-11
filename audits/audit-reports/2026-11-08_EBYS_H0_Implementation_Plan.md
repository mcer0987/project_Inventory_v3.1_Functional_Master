# H0 Implementation Plan — görev süresi / saat sınırı

Tarih: 8 Kasım 2026. Kapsam: yalnız H0. Bu belge üretim değişikliğinden önce hazırlanmıştır; gerçekleşen sonuçlar Walkthrough'da verilecektir.

## Başlangıç ve korunan dosyalar

- Çalışma yeri: `C:\Users\med3pol\Documents\project_Inventory`.
- Dal: `feat/v3.4-ebys-tamamlama-h0`; HEAD: `883da91e947152d41dd6f56cbb8b6b27c1dbf10b` doğrulandı.
- `git status --short --branch`, `git rev-parse HEAD`, `git worktree list`, kök `AGENTS.md` okundu. Başka çalışma alanında geliştirme yapılmayacak.
- Başlangıçtaki dört izlenmeyen belge (7 Kasım plan/kod kıyası, Spark planı, rehber taslağı ve 8 Kasım görev promptu) kullanıcı dosyalarıdır; değiştirilmeyecek.
- Görev promptu, üç bağlam belgesi, Aşama 1 teknik sözleşmesi ve Aşama 5 görev/erişim raporlarının ilgili bölümleri incelendi.
- `scratch/ebys-h0-evidence/` mevcut ignore kapsamındadır; yeni ignore kuralı eklenmeyecek. Loglara ek olarak kalıcı raporda komutlar ve sonuçlar bulunacak.

## Kök neden ve henüz kanıtlanmayanlar

Normal görev `validFrom: serverTimestamp()` ve `validUntil: Timestamp.fromMillis(Date.now() + 90 gün)` gönderiyor. Rules, bitişi `request.time + 90 gün` ile sınırlıyor. İleri istemci saati bu üst sınırı aşabilir. Geri saat ise erişim süresini kısaltır. Bu kaynak düzeyinde iki saatli sözleşmedir.

Önceki 89 günlük teşhis kalıcı çözüm değildir. Önceki 16 Rules hatasının tümünün aynı nedenden çıktığı, gerçek cihaz/emülatör saat farkı ve canlıdaki yaygınlık henüz kanıtlanmış değildir. İzole VM saatinde ±30 saniye / ±120 saniye ile gerçek servis ve Rules üzerinde aynı regresyonlar önce ve sonra koşturulacaktır. Sistem saati değiştirilmeyecek; servis iş mantığı testte değiştirilmeyecek.

## Seçilen sözleşme

| Tür | Başlangıç / bitiş | Aktivasyonda doğrulama | Okuma / karar |
|---|---|---|---|
| Yeni normal görev | `validFrom = serverTimestamp()`, `validForSeconds = 7776000`, `validUntil = null` | Başlangıç `request.time`; süre tam sayı, 1..7776000; mutlak bitiş ile birlikte kullanılamaz | `validFrom <= request.time < validFrom + süre` |
| Açık tarihli vekâlet | `validFrom = serverTimestamp()`, `validUntil = seçilen tarih`; süre alanı yok | Başlangıç `request.time`; tarih gelecekte ve en fazla 90 gün; yalnız admin, gerekçe ve kişi bağı | `validFrom <= request.time < validUntil` |
| Eski normal / vekâlet | Süre alanı yok, mevcut iki timestamp | Eski istemci yazımı aynı eski 90 gün kontrolünden geçer | Mevcut başlangıç ve bitiş; alan eksikliği sürenin yenilenmesi anlamına gelmez |

Yeni sözleşme alanın varlığıyla ayrılır: hatalı/null süre alanı eski yola düşmez. Vekâlet göreli süreyi kullanamaz. Normal görev için eski istemci uyumlu mutlak bitiş yolu da korunur; eski istemcinin saat hatası bu eski yazım yolunda devam edebilir. Yeni istemci bütün normal aktivasyonlarda (ilk, sonraki, ardışık/tekrar gelen kişi) yeni yolu kullanır. Kapanan görev zaman alanları aynen korunur; normal yeni aktivasyonda eski kararlar korunur ve yeni sunucu başlangıcı kaydedilir. Yönetici tarafından açık yeniden atama mevcut davranıştır; süresi dolan görev kendiliğinden yenilenmez.

`dueAt`, 1–720 saatlik hedef tamamlanma göstergesidir; erişim süresi değildir. Hesabı değiştirilmez. Vekâletin kullanıcı tarafından seçilen kesin bitişi ve asıl kişi/gerçek aktör ayrımı korunur. Yetki daima Rules tarafından verilir; UI'daki bitiş hesabı yalnız görünüm içindir.

Elendi: 89 gün veya rastgele tolerans (saat farkını çözmez); `request.time` kaldırma/sınırsız süre (yetki genişletir); ek zaman servisi/Cloud Functions (Spark ve kapsam dışı); bütün verileri dönüştürme (gerekli değil); yalnız UI/retry düzeltmesi (sunucu reddini çözmez).

## Yetki matrisi

| Aktör / durum | Korunan sonuç |
|---|---|
| Aktif, başlamış ve süresi devam eden görevli | Yalnız görev sürümünü okur ve beklenen revision ile karar verir |
| Gelecek imzacı / ilgisiz personel | İçerik ve erken görev yazımı reddedilir |
| Süresi dolmuş veya henüz başlamamış görevli, geçmiş karar yok | İçerik ve karar reddedilir; refresh süreyi yenilemez |
| Önceden onay/red kararı olan kişi | Yalnız karar verdiği sabit sürüme geçmiş erişim; yeni sürüme erken erişim yok |
| Yazar | Mevcut sahiplik erişimi ve gerekçeli geri çekme; kendi rotasına atanamaz |
| Admin | Mevcut yönetim ve açık tarihli devir; salt admin olmak içerik erişimi sağlamaz |
| Yetkisiz kişi | Süre/görevli değiştiremez; operationId veya retry yetki yaratmaz |

## Dosyalar ve uygulama sırası

1. Bu planı yaz. Test VM yükleyicisine yalnız izole Date desteği ve dört saat matrisi testi ekle; eski üretim dosyalarıyla kırmızı/yeşil sonuçları kaydet.
2. `src/services/ebys-process-service.js`: normal görevde göreli süreyi kullan; açık tarihli devirde süre alanını yazma.
3. `firestore.rules`: tek süre penceresi yardımcısı, tip/üst sınır ve başlangıç denetimi; aktivasyonda göreli normal/eski mutlak/devir ayrımı. Yeni belge erişimi ekleme.
4. `src/utils/ebys-process-schema.js`: her iki şemayı gösterim için çözen, geçersizde kapalı kalan bitiş hesabı. `src/ui/ebys-process-ui.js` bu hesabı kullansın; yeni görevi bitmiş sanmasın.
5. Birim ve Rules testleri: aynı saat matrisi, süre/bitiş sınırları, eski kayıtlar, gerçek vekil, doğrudan saldırılar, geçmiş erişim ve concurrency. Eski yanıltıcı 'vekil' fixture'ı gerçek vekâletle doğrula.
6. `src/ui/ebys-showcase-modal.js`: yalnız ilgili süre/vekâlet açıklamasını gerekirse tamamla; görsel düzeni koru.
7. Hedefli testler, ardından `npm.cmd run test:unit`, `npm.cmd run test:rules`, `npm.cmd run lint:xss`; sonuç ve loglarla Walkthrough yaz.

## Spark ve Rules bütçesi

Yeni koleksiyon, sunucu, zaman servisi, dinleyici veya ek SDK okuma/yazma yok. Aynı görev belgesinde küçük sayı alanı tutulur. Süre yardımcısı yalnız bellekteki görev alanlarını kullanır; yeni `get/exists/getAfter` çağrısı yok. Başlangıç 4 yazma, farklı kişiye ara karar 5, aynı kişiye ara karar 4, vekâlet 5, terminal karar+icra 6 yazma olarak kalır. Gerçek faturalandırma/kota kullanımı bu yerel testte ölçülmeyecek.

1000 ifade / belge erişim sınırlarını azaltılmış yetki kontrolleriyle aşma yok. Altı farklı kişi, altı adım ve ardışık aynı kişi olumlu testleri gerçek sınırlarla çalışacak. Olumsuz testlerin retleri için emülatör debug logunda bütçe aşımı ayrıca taranacak; kesin ifade sayısı ölçülmezse raporda sayısal iddia olmayacak.

## Test matrisi ve kabul

- ±30 saniye ve ±2 dakika: ilk görev, A→B→A→A geçişleri; gelecek kişi okuyamaz, geçmiş kararlar korunur. Değerler ağ gecikmesinden büyük, kısa gündelik sapmaları belirginleştirecek şekilde seçildi.
- Yeni görev süresi: sıfır, negatif, kesir, metin, null, >90 gün, iki bitiş türünü birlikte kullanma; sahte başlangıç; vekâleti göreli süreye çevirme reddi. Aynı transaction'ın geçerli kontrolü başarıyla tamamlanmalı.
- Kontrollü fixture: süreden hemen önce/bitimde saf hesap testi; 90 günün güvenli iki tarafında gerçek Rules erişim/karar; gelecekte başlangıç; eski görev etkin/dolmuş; gerçek süresi dolmuş vekil.
- Yetkisiz süre/görevli değişikliği; süresi dolan görevle aynı/farklı operationId tekrarları; bayat revision, farklı aktör/içerik reddi; aynı operationId/içerik eşzamanlı tek sonuç.
- Mevcut iade, geri çekme, geçmiş v1 / yeni v2 erişimi, son onay/icra, stok, envanter ve QR/arşiv testleri tam takımda korunur.
- Hedefli önce/sonra ve kapanış komutlarında gerçek sayı, exit code, log yolu. Taze emülatörde yalnız saat matrisi bir kez daha koşabilir. Port çakışırsa mevcut süreç durdurulmaz.

## Geri dönüş ve kapsam dışı

Yerel değişiklikler dosya bazında gözden geçirilebilir; kullanıcı dosyalarına reset/clean uygulanmaz. Yayın yapılmayacak. Gelecekte yayın sırası yeni Rules → yeni istemci olmalıdır; eski Rules yeni göreli görevleri okuyup karar veremez. Göreli görevler varken eski Rules'a kör geri dönüş yapılamaz. Eski istemci yeni Rules ile eski görevleri kullanabilir; yeni göreli görevi spread ile kapatabilir fakat eski UI `validUntil=null` kaydını süresi dolmuş gösterebilir. Bu yüzden eski sekmeler yenilenmeli; gerektiğinde ileri uyumlu Rules ve yeni şemayı okuyabilen istemci korunarak normal yeni görev üretimi durdurulmalıdır. Veri topluca dönüştürülmez.

Q0, sorgu optimizasyonu, satın alma köprüsü, yedekleme, diğer H paketleri ve envanter iş mantığı kapsam dışı. Commit/push/merge/deploy/canlı veri değişikliği yok. Tarayıcı UAT yapılmazsa açık kalan manuel kontrol olarak raporlanacak.
