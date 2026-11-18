# H0 Walkthrough — görev süresi ve self-proof

Tarih: 8 Kasım 2026. Sonuç: **H0 tamamlandı**; hedefli testler, tam takımlar ve son taze saat koşusu geçti. Yayın/commit yapılmadı.

## Başlangıç ve gerçek kapsam

`C:\Users\med3pol\Documents\project_Inventory`, `feat/v3.4-ebys-tamamlama-h0`, HEAD `883da91e947152d41dd6f56cbb8b6b27c1dbf10b` doğrulandı. Başka worktree kullanılmadı; checkout/reset/stash/clean yapılmadı. Başlangıçtaki dört izlenmeyen kullanıcı belgesi değiştirilmedi. `AGENTS.md` ilkelerine uyuldu; yeni panel eklenmedi.

Implementation Plan üretim düzeltmesinden önce yazıldı. Ardından yalnız test VM'sinin Date sınıfına kontrollü kayma eklendi. Eski servis ve Rules henüz değiştirilmemişken dört başlangıç ve iki sonraki-adım senaryosu çalıştırıldı. Servis kaynak metnindeki süreyi regex ile değiştirme, 89 gün veya rastgele tolerans kullanılmadı. VM yükleyicisinin mevcut import/export uyarlaması dışında iş mantığı değiştirilmiyor; SDK/emülatör/sistem saati kaydırılmıyor.

Kök neden kaynak ve deneyle doğrulandı: normal görevde başlangıç sunucu saati, bitiş istemci saati +90 gündü. İleri saat üst sınırı aşıyordu. Gerçek cihaz/sunucu saat farkı ölçülmedi; canlıda oluşma sıklığı ve önceki rapordaki 16 hatanın tamamının kökeni bu çalışmayla belirlenmiş değildir.

## Veri akışı ve değişen dosyalar

| Dosya | Gerçek değişiklik |
|---|---|
| `src/services/ebys-process-service.js` | Normal aktivasyonda `validFrom: serverTimestamp()`, `validForSeconds: 7776000`, `validUntil: null`; açık tarihli vekâlette yalnız seçilen `validUntil`. `dueAt` hesabı aynı. |
| `firestore.rules` | `etDuration` ve `etTimeLive`; yeni alan whitelist'i; normal göreli süre / eski mutlak süre ayrımı. Göreli süre tam sayı ve 1..7776000; vekâlet göreli süre kullanamaz. `request.time` kontrolü ve geçiş/aktör/kişi/revision/olay bağları korunur. |
| `src/utils/ebys-process-schema.js` | Süre sabiti ve yalnız görünüm için `taskExpiryMillis`; süre alanı varsa geçersiz değerde eski bitişe düşmez. |
| `src/ui/ebys-process-ui.js` | Kartların bitişini her iki şema için ortak yardımcıyla çözer. Yeni normal görevin `validUntil:null` olması düğmeleri yanlışlıkla kapatmaz. |
| `src/ui/ebys-showcase-modal.js` | Aynı vekâlet kartına süre sonunda yönetime başvurma ve otomatik asıl kişiye dönmeme açıklaması. Görsel yapı/CSS aynı. |
| `tests/rules/ebys-processes.test.mjs` | 17 yeni test; eski süre-dolmuş testindeki normal görev fixture'ı gerçek vekâletle değiştirildi; izole Date desteği. Toplam 29 → 46. |
| `tests/unit/ebys-process-schema.test.mjs` | Üç yeni süre/sınır/uyumluluk testi. Dosya 2 → 5, bütün birim takımı 324 → 327. |
| İki H0 raporu | Implementation Plan ve bu Walkthrough. |

Son diff: **7 izlenen dosyada +259 / −9 satır**, ayrıca yukarıdaki iki yeni rapor. `git diff --check` exit 0. Başlangıçtaki dört kullanıcı belgesi ve HEAD aynı kaldı; yeni raporlar henüz izlenmeyen dosyalardır, stage/commit yapılmadı.

Normal ilk görev, sonraki kişi, A→B→A ve A→A aktivasyonları aynı `task()` yolunu kullanır. Her yeni meşru aktivasyon yeni sunucu başlangıcı alır; geçmiş kararlar silinmez. Aynı görevin sırf okunması/yeniden denemesi başlangıcı değiştirmez. Süresi dolmuş görevin kararı reddedilir; yönetici açık yeniden atama yapabilir (önceki davranış). Yeni sürenin bitişi `validFrom + validForSeconds` üzerinden sunucuda değerlendirilir: başlangıç dahil, bitiş hariçtir.

Firebase'ın [Request.time sözleşmesi](https://firebase.google.com/docs/reference/rules/rules.firestore.Request#time), `serverTimestamp()` yazımının `request.time` ile aynı olmasını tanımlar. Bu özellik yeni sözleşmenin dayanağıdır; gerçek Rules emülatör testleri uygulamayı ayrıca doğrular.

## Self-proof tablosu

Günlüklerin kökü: `C:\Users\med3pol\Documents\project_Inventory\scratch\ebys-h0-evidence\`. Tablodaki kısa yollar bu köke göredir. Önce sütununda **çalıştırılmadı**, o güvenlik kontrolünün bu tur eski kodla ayrıca çalıştırılmadığı anlamına gelir; önce/sonra kanıtı saat regresyonları için kurulmuştur.

| İddia → gerçek test adı | Önce | Sonra | Günlük |
|---|---|---|---|
| `H0 saat matrisi -120s: ilk görev ve A-B-A-A geçişleri` | Geçti | Geçti | `before-clock.log` → `after-h0.log` |
| `H0 saat matrisi -30s: ilk görev ve A-B-A-A geçişleri` | Geçti | Geçti | Aynı |
| `H0 saat matrisi 30s: ilk görev ve A-B-A-A geçişleri` | İlk görev `permission-denied` | Geçti | Aynı |
| `H0 saat matrisi 120s: ilk görev ve A-B-A-A geçişleri` | İlk görev `permission-denied` | Geçti | Aynı |
| `H0 adım saati 30s: mevcut görevden sonraki aktivasyon` | İlk görev -120s ile açıldı, ilk karar/sonraki aktivasyon reddedildi | Geçti | `before-transition.log` → `after-h0.log` |
| `H0 adım saati 120s: mevcut görevden sonraki aktivasyon` | Aynı hata | Geçti | Aynı |
| `H0 normal görev sunucu başlangıcıyla sınırlıdır; hedef süre ve devir bitişi ayrıdır` | Çalıştırılmadı | Geçti; yeni normal alanları, gerçek devir bitişi, aktör/asıl kişi ve sonraki normal görev doğrulandı | `after-h0.log` |
| `H0 geçersiz süre ve sahte başlangıç aktivasyonu atomik reddedilir` | Çalıştırılmadı | Geçti; 0, negatif, kesir, metin, null, >90 gün, çift bitiş, sahte geçmiş/gelecek başlangıç reddedildi; aynı fixture'ın geçerli işlemi geçti | `after-h0.log` |
| `H0 vekâlet geçmiş, 90 günü aşan veya göreli bitişle açılamaz` | Çalıştırılmadı | Geçti; tüm saldırılar atomik reddedildi, sonra gerçek devir ve karar geçti | `after-h0.log` |
| `H0 görevli, süre veya şema doğrudan değiştirilerek yetki uzatılamaz` | Çalıştırılmadı | Geçti; görevli/ilgisiz personel/admin doğrudan süre/başlangıç/görevli/şema değiştiremedi; geçerli karar geçti | `after-h0.log` |
| `H0 göreli pencere 90 gün bitiminden önce: gerçek Rules okuma ve karar` | Çalıştırılmadı | Geçti; fixture bitişten 60s önce, okuma/karar başarılı | `after-h0.log` |
| `H0 göreli pencere 90 gün bitiminden sonra: gerçek Rules okuma ve karar` | Çalıştırılmadı | Geçti; fixture bitişten 60s sonra, okuma ve aynı operationId ile iki karar denemesi reddedildi | `after-h0.log` |
| `H0 göreli pencere henüz başlamamış: gerçek Rules okuma ve karar` | Çalıştırılmadı | Geçti; başlangıç 60s ileride, okuma/karar reddedildi | `after-h0.log` |
| `H0 eski validUntil görevi çalışır ve sonraki adım yeni süreyi alır` | Çalıştırılmadı | Geçti; canlı eski görevin kararı ve yeni şemalı sonraki görev, geçmiş erişim | `after-h0.log` |
| `H0 eski validUntil görevi dolmuşsa açılmaz` | Çalıştırılmadı | Geçti; eski süreli kayıt içerik/karar alamadı | `after-h0.log` |
| `H0 eski istemci mutlak süre yazımı yeni Rules ile uyumludur` | Çalıştırılmadı | Geçti; eski biçimli payload yazımı/okuma/karar. Eski tarayıcı paketiyle UAT değildir | `after-h0.log` |
| `H0 süresi dolmuş vekil okuyamaz/karar veremez; personel kendisine vekâlet tanımlayamaz` | Bu tur eski kodla çalıştırılmadı | Geçti; gerçek vekil önce okuyabildi, fixture süresi dolunca vekil/asıl kişi okuyamadı; iki karar denemesi de reddedildi, operation sonucu oluşmadı | `after-h0.log` |
| `H0 işlem tekrarı farklı aktöre veya içeriğe başarı kazandırmaz` | Çalıştırılmadı | Geçti; iki aynı çağrı tek karar olayı; farklı aktör/içerik ve bayat revision reddi | `after-h0.log` |
| `paraf sonrası iade ve ikinci sürüm: eski içerik korunur, yeni sürüm yalnız yeni atamayla açılır` | Bu tur eski kodla çalıştırılmadı | Geçti; A yalnız karar verdiği v1'i okudu, v2'ye sırası gelmeden erişemedi; iade eden B'nin v1 erişimi kapandı | `full-rules.log` |
| `altı adımlı rota ve aynı kişiye ardışık görev, bütçe içinde tek revizyonla ilerler` ve `bağsız hesap atanamaz; personel yazar altı farklı UID ile bütçe içinde süreç başlatır` | Bu tur eski kodla çalıştırılmadı | İkisi de geçti; manuel/şablon rota ve tüm altı adım gerçek Rules sınırlarıyla | `full-rules.log` |
| Birim: `H0 yeni görev süresi sunucu başlangıcından hesaplanır; dueAt yetkiyi değiştirmez` | Çalıştırılmadı | Geçti; başlangıç−1ms, başlangıç, bitiş−1ms, tam bitiş, bitiş+1ms | `schema-unit.log`, `full-unit.log` |

±30s ve ±120s ağ gecikmesinden belirgin büyük, gündelik kısa saat sapmasını ortaya çıkaran test değerleridir. Tam bitiş anı saf hesapla; gerçek Rules ise güvenli 60 saniyelik iki taraftaki fixture'larla sınandı. Emülatörün `request.time` değeri yapay olarak ayarlanmadı; tam bitiş nanosanisinde gerçek istek yapıldığı iddia edilmez. Rules kapalı bağlam yalnız fixture hazırladı; kanıtlanan kullanıcı işlemleri gerçek kurallarla yürüdü.

## Koşular, komutlar ve sonuçlar

| Koşu | Exit | Test / geçti / hata / atlandı | Kanıt |
|---|---:|---|---|
| Eski kod, başlangıç saat matrisi | 1 | 4 / 2 / 2 / 0 | `before-clock.log`, `before-clock.exit.txt`, `before-clock-firestore.log` |
| Eski kod, sonraki-adım saati | 1 | 2 / 0 / 2 / 0 | `before-transition.log`, `.exit.txt`, `before-transition-firestore.log` |
| İlk düzeltilmiş süreç dosyası | 1 | 46 / 45 / 1 / 0 | `after-process.log`, `.exit.txt`, `after-process-firestore.log` |
| Düzeltilmiş H0 seçimi | 0 | 18 / 18 / 0 / 0 | `after-h0.log`, `.exit.txt`, `after-h0-firestore.log` |
| Hedefli şema birimi | 0 | 5 / 5 / 0 / 0 | `schema-unit.log`, `.exit.txt` |
| `npm.cmd run test:unit` | 0 | **327 / 327 / 0 / 0** | `full-unit.log`, `.exit.txt` |
| `npm.cmd run test:rules` | 0 | **354 / 354 / 0 / 0**, 34 suite | `full-rules.log`, `.exit.txt`, `full-rules-firestore.log` |
| `npm.cmd run lint:xss` | 0 | 84 dosya, 208 sink, 989 dinamik ifade; **0 izinsiz** | `lint-xss.log`, `.exit.txt` |
| Son taze saat seçimi | 0 | **6 / 6 / 0 / 0** | `fresh-clock.log`, `.exit.txt`, `fresh-clock-firestore.log` |

İlk süreç koşusundaki tek hata, yeni kanıt sorgusunun `ebysProcessEvents` için sadece processId süzmesi nedeniyleydi. Rules sahip/aktör kapsamı gerektiriyor; sorguya `ownerUid == owner` eklendi. Beklenti zayıflatılmadı, yetki açılmadı. Düzeltilmiş test H0 ve tam takımda geçti. Tam takım başarısızlığa kadar tekrar edilmedi; asıl tam Rules komutu bir kez çalıştırıldı.

İlk hazırlık denemesi kullanıcı `.config/configstore/firebase-tools.json` erişiminde EPERM ile test başlatamadan durdu (araç çıktısı; ayrıca ham log saklanmadı). Sonraki hazırlık koşusunda Windows'a iletilen tek tırnaklı filtre gerçek testleri seçmedi; `setup-no-matching-tests.log` dosyasında yalnız dosya düzeyinde 1 başarı var, **H0 kanıtı değildir**. Filtre daha sonra boşluksuz regex ile düzeltildi. Bu hazırlıklar başarı sayısına dahil edilmedi.

Tekrar çalıştırma (PowerShell, çalışma kökünde):

```powershell
$env:XDG_CONFIG_HOME = Join-Path (Get-Location) 'scratch/ebys-h0-evidence/cli-config'
$env:CI = 'true'
# Önce koşularında üretim dosyaları hâlâ 883da91 idi; bugünkü kod aynı komutlarda yeşil olmalıdır.
npx.cmd --no-install firebase emulators:exec --config tests/rules/firebase.rules-test.json --only firestore --project demo-rules-test "node --test --test-reporter=spec --test-name-pattern=H0.*saat.*matrisi tests/rules/ebys-processes.test.mjs"
npx.cmd --no-install firebase emulators:exec --config tests/rules/firebase.rules-test.json --only firestore --project demo-rules-test "node --test --test-reporter=spec --test-name-pattern=H0.*adım.*saati tests/rules/ebys-processes.test.mjs"
# İlk after-process koşusu:
npx.cmd --no-install firebase emulators:exec --config tests/rules/firebase.rules-test.json --only firestore --project demo-rules-test "node --test --test-reporter=spec tests/rules/ebys-processes.test.mjs"
# H0 kanıtı ve kapanış:
npx.cmd --no-install firebase emulators:exec --config tests/rules/firebase.rules-test.json --only firestore --project demo-rules-test "node --test --test-reporter=spec --test-name-pattern=H0 tests/rules/ebys-processes.test.mjs"
node --test --test-reporter=spec tests/unit/ebys-process-schema.test.mjs
npm.cmd run test:unit
npm.cmd run test:rules
npm.cmd run lint:xss
# Yalnız altı saat senaryosu, son taze emülatör:
npx.cmd --no-install firebase emulators:exec --config tests/rules/firebase.rules-test.json --only firestore --project demo-rules-test "node --test --test-reporter=spec --test-name-pattern=H0.*saa tests/rules/ebys-processes.test.mjs"
```

Her koşuda çıktı `*> scratch/ebys-h0-evidence/<ad>.log` ile kaydedildi; `$LASTEXITCODE` yan `.exit.txt` dosyasına yazıldı. Filtreli koşularda yalnız seçilen testler sayılır; seçilmeyen testler Node çıktısında skipped olarak görünmez. Asıl kapanış takımlarında atlanan/iptal/todo 0'dır.

Portlar başlamadan kontrol edildi; 8180/4410/4510 boştu. Varsayılan test config'i değişmedi, başkasının emülatörü durdurulmadı. CLI `demo-rules-test`, testlerin kendi `demo-*` projectId'leri ve `inventory_demo` fixture'ları kullanıldı; canlı proje/veri kullanılmadı. CLI'nin ilk kuralsız başlangıç uyarısı config'in boş firestore bölümü yüzündendir: her test ortamı `initializeTestEnvironment({firestore:{rules: readFileSync('firestore.rules')}})` ile gerçek kuralları testlerden önce yükler. Ret testleri bu yüklemeyle çalışır. Çoklu demo projectId uyarısı mevcut takım düzenidir.

## Yetki ve bütçe değerlendirmesi

H0 koşusunun debug günlüğünde `maximum of 1000`, belge erişim üst sınırı ve fazla çağrı kalıpları tarandı: **0 eşleşme**. Ham sonuç `h0-budget-scan.json`; kaynak `after-h0-firestore.log`. H0 retleri bütçe aşımına dayanmıyor. Hatalı aktivasyon/devir fixture'larının hemen ardından aynı fixture'da geçerli işlem başarıyla tamamlandı; süre sonu testlerinde ret öncesi gerçek süreç/devir kuruldu.

İlk bütün süreç koşusunun debug logunda bazı H0 dışı bozuk atomik işlem senaryolarında 1000 ifade uyarıları görüldü. Bunlar H0 retlerinin güvenlik kanıtı olarak kullanılmadı. Bütün negatif testlerde bütçe uyarısı sıfırdır iddiası yoktur. Altı kişi/adım dahil meşru olumlu akışların tümü gerçek sınırlarla geçti. Kesin ifade sayacı, faturalandırma, canlı kota ve tam Rules değerlendirme çağrı sayıları ölçülmedi.

Yeni Rules yardımcıları yalnız eldeki görev alanlarını kullanır; yeni `get/exists/getAfter` yok. Ek SDK okuma/yazma, koleksiyon, dinleyici, sunucu, Storage veya ücretli hizmet yok. Aşağıdaki değerler başarılı ilk denemenin **kaynak kodundan sayımıdır**, fatura/telemetri ölçümü değildir; retry ve Rules bağımlı okumaları hariçtir. H0 öncesi/sonrası aynıdır:

| İşlem | SDK transaction okumaları | Belge yazmaları |
|---|---:|---:|
| N adımlı normal başlatma | 4+N (şablon seçilirse +1) | 4 |
| Farklı kişiye ara karar | 5 | 5 |
| Aynı kişiye ardışık ara karar | 4 | 4 |
| Yönetici vekâleti | 5 | 5 |
| İade/red / yazar geri çekme | 4 | 5 |
| Son onay + icra | Birime özel politika 7, tür varsayılanı 8 | 6 |

## Eski kayıt, eski istemci ve geri dönüş

- Süre alanı bulunmayan eski görev eski `validUntil` ile okunur; aktif kayıt karar verebilir, dolmuş kayıt yeni şema bahanesiyle açılmaz. Toplu dönüşüm yok.
- Normal sonraki aktivasyon yeni göreli şemaya geçer; aynı kişi yeniden geldiğinde karar geçmişi korunur. Eski kararın v1 erişimi, v2 için yetki vermez.
- Yeni Rules eski mutlak süre yazımını aynı 90 gün sınırıyla kabul eder. Uyumluluk testi eski payload biçimini sınar; eski tarayıcı build'ini çalıştırmaz. Eski istemcinin saat hatası eski yazım yolunda sürebilir.
- Eski servis mevcut görevi spread ile kapattığında alanı koruyabilir, ancak eski UI `validUntil:null` kaydını dolmuş gösterebilir. Yeni sekme/istemci kullanılması gerekir. Eski istemciyle uçtan uca UAT yapılmadı.
- Gelecekte yayın kararı verilirse önce yeni Rules, sonra istemci gerekir. Göreli kayıtlar varken eski Rules'a kör geri dönüş yapılamaz; ileri uyumlu okuma/karar desteği korunmalıdır. Bu görevde deploy veya özellik anahtarı değişmedi.

## Rehber kontrolü ve manuel kabul

`src/ui/ebys-showcase-modal.js` içindeki **Süreli vekâlet** kartı mevcut görsel yapıda korundu; yalnız şu bilgi eklendi: “Süre dolduysa yöneticinizden görev durumunu kontrol etmesini isteyin; görev kendiliğinden asıl kişiye dönmez.” Gerçek davranış: süresi biten vekil karar/içerik alamaz, admin açık yeniden atama yapabilir. Teknik saat/Rules/koleksiyon terimi eklenmedi; statik rehbere sorgu eklenmedi.

`src/ui/ebys-process-ui.js` içindeki “Süre dolunca görev otomatik asıl kişiye dönmez; yeniden atama gerekir. En fazla 90 gün yetki verilebilir.” ve “Bu pencereyi kapatmak süreci iptal etmez.” metinleri kaynakla uyumludur; değiştirilmedi. Hedef süre ile erişim süresi ayrı kaldı. Yeniden açmak veya sayfayı yenilemek sürenin yenilenmesi değildir.

Bu tur **tarayıcı açılmadı**: açık/koyu tema, dar ekran, klavye, gerçek görev kartı etkileşimi ve görsel taşma kontrolü yapılmadı. Rehber/düğme yolları kaynak üzerinden karşılaştırıldı. Yeni panel ve uzun yardım akışı eklenmedi. Önerilen manuel kontrol (yalnız test ortamında):

1. A→B→A→A rotası başlatın; A görevinde hedef süre ve karar düğmelerini görün, B'nin henüz metni açamadığını kontrol edin.
2. İlk üç kararı sırayla verin; A'nın tekrar gelen görevlerinde önceki kararlarının kaldığını kontrol edin.
3. Ayrı bir görevde yönetici açık bitiş tarihiyle vekil atasın; asıl kişi yerine vekilin karar verebildiğini ve gerçek aktör kaydını kontrol edin.
4. Süresi bitmiş test fixture'ını açın; yenilemenin içerik/karar yetkisini açmadığını kontrol edin, rehberde yönetime başvurma bilgisini okuyun.
5. İade sonrası yeni sürüm hazırlayın; eski karar sahibinin yalnız eski sürümü açabildiğini, pencereyi kapatmanın süreci geri çekmediğini kontrol edin.

## Kabul ve kalan riskler

H0 teknik kabulü: önce kırmızı olan ileri-saat oluşturma/adım senaryoları şimdi yeşil; hedefli güvenlik, eski kayıt, geçmiş sürüm ve tam envanter regresyonları geçti. Manuel görsel kabul ve canlı kota/yayın doğrulaması bu teslimin kanıtı değildir.

UI'daki süre/gün gösterimi hâlâ cihaz saatine bağlıdır; tam bitiş çevresinde görsel etiket ile sunucu kararı farklılaşabilir. Yetkiyi sunucu uygular. Vekâlet açık mutlak tarih sözleşmesini korur; tam 90 günlük üst sınıra yakın seçimlerde eski yerel ön doğrulama/cihaz sapması etkisi bu H0 normal-görev düzeltmesinin kapsamında değiştirilmedi. `dueAt` ve icra hedef zamanları da mevcut istemci hesabını korur.

Q0 için yalnız not: görev kartı başına mevcut `watchTaskContext` dinleyicileri ve sayaç sorguları bu pakette değiştirilmedi; bütçe telemetrisi ayrıca ölçülmelidir. Yedek/kurtarma, satın alma köprüsü, diğer H paketleri ve kurumsal vekâlet genişlemesi uygulanmadı. Commit, push, merge, deploy ve canlı veri değişikliği yapılmadı; H0 tesliminden sonra durulur.
