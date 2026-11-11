# EBYS H1 teslim kontrolü ve H2 geçiş kararı

Tarih: 9 Kasım 2026.

## Karar

A kullanıcı kabulü revizyonları ve H1, belgelenmiş demo/pilot kapsamıyla teknik olarak kabul edilebilir. H2'ye geçiş uygundur. Yayın öncesinde kapatılması gereken bir paketleme bulgusu vardır: yerel kurtarma aracı Hosting kapsamına giriyor. Bu bulgu H2 görev belgesinin ilk maddesine alınmıştır; bu incelemede uygulama kodu veya yayın ayarı değiştirilmedi.

## Dal ve teslimin yeri

- Çalışma klasörü: `C:\Users\med3pol\Documents\project_Inventory`.
- Dal: `feat/v3.4-ebys-tamamlama-h0`.
- HEAD: `883da91e947152d41dd6f56cbb8b6b27c1dbf10b`.
- Dal doğru birleşik tabandır. Adındaki `h0`, yalnız H0 içerdiği anlamına gelmez. H0/Q0/A kabulü/H1 değişiklikleri bu dalın yerel çalışma ağacındadır; henüz commit edilmemiştir.
- İnceleme başlangıcındaki izlenen diff: 11 dosya, +708/-78. Bu sayı H0/Q0/H1 toplamıdır; izlenmeyen raporları, UI test dosyasını ve `tools/ebys-local-recovery.mjs` dosyasını kapsamaz. H1'e ait bağımsız commit diff'i gibi sunulmamalıdır.

## İnceleme ve kanıt

Referans sohbet `01a1bed6-e8f5-72d3-b159-28f3e3d7555a` araçla okundu. A ve H1 planları/walkthrough belgeleri, gerçek servis değişikliği, yerel kurtarma aracı, ilgili testler ve ham günlükler incelendi.

| Kontrol | Sonuç / kanıtın türü |
|---|---|
| A kabulü: yeni aktif V2, geçmiş V1, sıra dışı erişim reddi | Teslimdeki gerçek form/HTML/CSS + demo Auth/Firestore köprüsü kodu ve başarılı günlüğü incelendi. Bu incelemede tarayıcı provası tekrar çalıştırılmadı. |
| Yeniden kontrol düğmesi, KPI yerleşimi ve son kontrol saati | Kaynak diff'i ve A kabul kanıtları uyumlu. Sürüm artışının evrak sayısını artırmadığı test edilmiş. |
| H0 sözleşmesinin korunması | `firestore.rules`, `ebys-process-service.js`, `ebys-process-schema.js` SHA-256 değerleri Q0 başlangıcındaki H0 kopyalarıyla aynı. H1 kuralları gevşetmemiş. |
| Kişisel kopya ve özel token sınırı | Yetkili başlıklardaki tokenlardan kamusal kayıt okuma; özel rezervasyonun hariç olduğunun manifestoda belirtilmesi; rol ve sınır testleri doğrulandı. |
| Demo kurtarma ve erişim | Üç H1 testi bu incelemede yeniden çalıştırıldı: **3/3 geçti**. 92 kayıt geri yüklendi; geçerli/iptal/arşiv QR ve eski/yeni sürüm erişim sınırları korundu. |
| Tam birim takımı | Teslim günlüğü: **339/339**, hata/atlanan test yok. Bu incelemede tam takım yeniden çalıştırılmadı. |
| Tam Rules takımı | Teslim günlüğü: **357/357**, hata/atlanan test yok. Bu incelemede hedefli H1 koşusu yapıldı. |
| XSS | Teslim günlüğü: **0 izinsiz ifade**. |
| Diff biçimi | Bu incelemede `git diff --check` geçti. |
| Hosting paketi | Bu incelemede **başarısız**, çıkış kodu 1: 107 yerine 108 dosya; beklenmeyen dosya `tools/ebys-local-recovery.mjs`. |

Yeni hedefli kanıt: `scratch/ebys-h1-review-evidence/h1-rules.log`.

```powershell
npx.cmd --no-install firebase emulators:exec --config tests/rules/firebase.rules-test.json --only firestore --project demo-rules-test "node --test --test-reporter=spec --test-name-pattern=H1 tests/rules/ebys-processes.test.mjs"
```

Koşu 8180 test portunu kullandı; manuel 8080/9099 emülatörü sıfırlanmadı veya durdurulmadı. Başlangıçtaki kuralsız emülatör uyarısı testin kuralsız yürüdüğü anlamına gelmiyor: test başlangıcında `initializeTestEnvironment` ile gerçek `firestore.rules` yükleniyor; normal kullanıcı ve anonim erişim retleri test ediliyor.

Yeni provada da ölçüm: kaynak iki taramada 44 istek / 184 dönen belge; önizleme 22 istek / 0 yazma; uygulama ve kontrol 45 istek / 92 okunan ve 92 yazılan belge. Bunlar fatura veya canlı kota ölçümü değildir.

## Açık bulgu: yerel araç yayın paketine giriyor

`firebase.json` Hosting kökünü `.` olarak tanımlıyor, fakat `tools/**` hariç değil. `node scratch/hosting-files.js` bu nedenle doğru biçimde duruyor. Kanıt: `scratch/ebys-h1-review-evidence/hosting.log`.

Önerilen dar kapanış: `tools/**` dizinini Hosting ignore listesine eklemek; mevcut 107 dosyalık uygulama beklentisini artırmamak ve aracı uygulama dosyası olarak beyaz listeye almamak. Aracın kendisinde canlı kimlik bilgisi saptanmadı; loopback/demo kısıtı var. Bulgu, doğrulanmış bir canlı veri sızıntısı iddiası değildir. Yerel operatör aracının gereksiz yayımlanması ve mevcut yayın kapısının kırılmasıdır.

## Kabulün sınırları

- İlk kullanıcı oturumundaki eski metnin nedeni bulunmuş değildir. İki ayrı form yolunda hata yeniden üretilmemiş, doğru sürüm gösterimi kanıtlanmıştır; kök neden düzeltildi denmemelidir.
- Tarayıcı kanıtı gerçek EBYS form/servislerini kullanıyor; genel oturum/açılış kabuğu test köprüsüyle değiştirilmiş ve SDK 12.19.0 kullanılmış. Ürünün SDK 10.7.1 ile tam açılış yolu veya canlı kabulü sayılmaz.
- Kurtarma aracı yalnız loopback/demo hedef ve `inventory_demo` için, 300 kayıt / 8 MiB sınırında çalışıyor. Auth hesabı, ek dosya baytı ve stok hareketi üretmiyor. Kurumun gerçek afet kurtarma işletimi tamamlandı iddiası yok; G04'ün işletim kısmı H8'de kalır.
- Kişisel kopya tek bir atomik kurum görüntüsü değildir. Başlık/süreç değişim kontrolleri ve sınırlar var; özel rezervasyonları içermez. Bu ayrım kullanıcı metnine taşınmış.

## Sonraki paket ve efor

Sıradaki paket **H2 — belge türleri, durum adları ve rehber**. Önce yukarıdaki Hosting bulgusu kapatılır. Sonra G05 ve G09'un yanlış etiket/sayfa kapsamı kısmı düzeltilir. Sorgu/state-machine değişikliği, yeni dinleyici ve satın alma köprüsü eklenmez; gerçek icra durumu mevcut İcra Takibi ekranından izlenir.

Öneri: **GPT-6.1 Sol / Düşük (low)**. Önceden onaylanan efor matrisindeki H2 puanı 0/0/1/0 = 1 korunur: yetki, atomiklik veya kalıcı veri değişikliği yok. Bu, projeye özgü iş kapsamı değerlendirmesidir; ölçülmüş model performansı veya ücret hesabı değildir. Resmî [OpenAI efor açıklaması](https://developers.openai.com/api/docs/guides/reasoning) düşük eforu sınırlı uygulama işleri için destekler. H2 sırasında servis/Rules değişikliği gerektiği ortaya çıkarsa işi sessizce büyütmek yerine ayrı bulgu olarak bırakmak gerekir.

Tam görev: `2026-11-09_EBYS_H2_Yeni_Sohbet_Gorev_Promptu.md`.

Bu incelemede commit, push, merge, deploy veya canlı veri işlemi yapılmadı.
