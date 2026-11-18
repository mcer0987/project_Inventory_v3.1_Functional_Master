# EBYS H1 walkthrough ve self-proof

9 Kasım 2026. A kabulü iki sürüm yolunda demo tarayıcıyla doğrulandı. H1 kişisel kopya ve ayrı yerel kurtarma akışları aynı çalışma ağacında tamamlandı. İlk bildirimin görüldüğü oturumun kök nedeni belirlenemedi. Yeni aktif görevde eski metin son kabul koşusunda tekrar etmedi.

## Değişiklik kapsamı

- A. `admin.html`, `ebys-documents.css`, `ebys-documents-ui.js` ve `ebys-process-ui.js` içinde KPI yerleşimi, sayım durumu ve kontrol düğmesi. `ebys-q0-ui.test.mjs` yeni KPI DOM yapısını kullanıyor.
- H1. `ebys-document-service.js` kişisel kopya kapsamı ve şema 2 manifestosu. `admin.html` ve `ebys-documents-ui.js` kişisel kopya etiketi ve indirme durumu. `tools/ebys-local-recovery.mjs` ayrı demo operatör aracı.
- Rehber. `ebys-showcase-modal.js` ve `2026-11-07_EBYS_Rehberi_Revizyon_Taslagi.md` güncel/geçmiş sürüm, sayaç ve kişisel kopya açıklamaları.
- H1 testleri `tests/rules/ebys-processes.test.mjs` içinde. H0 Rules ve süreç servisi değişikliklerinin başlangıç hali `scratch/ebys-kabul-evidence/baseline.patch` içinde. H1 öncesi diff ve kaynak kopyaları `scratch/ebys-h1-evidence/` içinde. Test toplamları mevcut H0/Q0 çalışmalarını içerir.

## Self-proof

| İddia | Önce | Sonra ve kanıt |
|---|---|---|
| Kişisel QR kapsamı | A7 kayıtları dışa aktarımda yoktu. | Sahip olunan evrakların kamusal QR kayıtları var. Görevli, yabancı personel ve yönetici rollerinde mevcut erişim sınırları korundu. Özel rezervasyon sahibin dosyasında ve admin istemci okumasında yok. Eksik projeksiyon `partial` olarak işaretli. |
| Tarih ve işlem sınırı | Tür bilgisi ve sınırlı dışa aktarım sözleşmesi yoktu. | Zaman damgası saniye/nanosaniye olarak doğrulandı. Belge sınırı, oturum değişimi ve süreç revizyonu değişimi dosya üretimini durduruyor. |
| QR kurtarma | Ayrı doğrulamalı kurum provası yoktu. | Normal servislerle üretilen geçerli, iptal ve arşiv QR kayıtları ikinci demo projeye aktarıldı. Anonim kayıt yalnız beklenen beş alanı döndürüyor. Listeleme, özel rezervasyon ve içerik erişimi reddediliyor. |
| Sürüm ve kimlik | Prova kanıtı yoktu. | Geri yüklenen geçmiş V1 metni ile V2 metni ayrı. V1 karar sahibinin V2 erişimi reddedildi. Birim bağlamı korundu ve personel kodu paket dışında kaldı. |
| Bozuk paket ve tekrar | Genel overwrite yolu EBYS kurtarması olarak kullanılmıyordu. | Eksik rezervasyon/olay, bozuk tarih/özet/ilişki, yinelenen ID, yarım paket, yanlış kök ve dolu hedef reddedildi. Önizleme sıfır yazma. Açık uygulamada tüm paket tek create-only commit ile yazıldı. |

H1 test adları ve ölçüm satırı `scratch/ebys-h1-evidence/rules-verified.log` içinde. A tarayıcı adımları ve kanıtları ayrı kullanıcı kabul walkthrough belgesinde.

## Kullanım ve sınırlar

`Evrak kopyasını indir` görünür işleminden alınan dosya mevcut yetki kapsamındadır. Anahtarın bilindiği kamusal QR kaydı alınır. Kurum kurtarma paketi ayrı hazırlanır. Kişisel şema 2 içindeki `$firestoreTimestamp` değeri `[seconds, nanoseconds]` olarak ayrıştırılabilir. Kişisel kopya ardışık okumalardır. Başlık ve süreç revizyonları tekrar kontrol edilir. Dosya tüm koleksiyonların tek bir anlık görüntüsünü temsil etmez.

Kişisel kopya için üst sınır 400 istek ve 500 dönen belge. Sınır tespiti için liste sorgusu en fazla bir ek kayıt döndürebilir. Sınıra gelince dosya üretilmez. Kamusal kayıtlar tekilleştirilir. Ölçüm alanları SDK çağrılarını ve dönen belgeleri sayar. Rules bağımlı okumaları, boş sorgular ve ücretlendirme bu ölçümden ayrı.

Operatör aracına açılan ayrı demo emülatörünün portu verilmelidir. Aşağıda örnek port 8180. Kaynak yazmaları durdurulur ve iki eşleşen tarama alınır. Hedefte önizleme çalıştırılır, ardından boş ve durgun hedefte açık yazma komutu kullanılır.

```powershell
node tools/ebys-local-recovery.mjs capture 127.0.0.1:8180 demo-ebys-source inventory_demo scratch/demo-ebys-recovery.json --quiescent
node tools/ebys-local-recovery.mjs restore 127.0.0.1:8180 demo-ebys-target inventory_demo scratch/demo-ebys-recovery.json
node tools/ebys-local-recovery.mjs restore 127.0.0.1:8180 demo-ebys-target inventory_demo scratch/demo-ebys-recovery.json --quiescent --apply
```

Prova sınırı 300 belge ve 8 MiB. Tarih, ID, özgün sürüm, olay ve QR kimlikleri korunur. Bağlı stok hareketi varsa eşleşen hedef dayanağı gerekir. Stok hareketi, Auth hesabı ve ek dosya baytları paketin dışında. Birim, personel, hesap eşleme ve erişim kapısı alanları EBYS için gerekli bağlamla sınırlı. Eşleşen taramalar operatörün durgun kaynak koşuluna dayanır. Paket SHA-256 özeti bütünlük kontrolüdür. Operatör kaynak ve paketin kaynağını ayrıca doğrular. Gerçek kurtarma işletimi için yetkili kimlik, hesap eşlemeleri, bakım penceresi ve bütünlük provası ayrıca hazırlanmalıdır.

## Test sonuçları

| Test | Sonuç | Günlük |
|---|---|---|
| Tarayıcı A kabulü | İki sürüm akışı ve KPI/kontrol düğmesi geçti | `scratch/ebys-kabul-evidence/browser-acceptance.log` |
| `npm.cmd run test:unit` | 339/339 | `scratch/ebys-h1-evidence/unit.log` |
| `npm.cmd run test:rules` | 357/357 | `scratch/ebys-h1-evidence/rules-verified.log` |
| `npm.cmd run lint:xss` | 0 izinsiz ifade | `scratch/ebys-h1-evidence/xss.log` |
| `git diff --check` | Geçti | Çalışma ağacı kontrolü |

Prova ölçümü. 92 kayıt için kaynak iki taramada 44 istek ve 184 dönen belge. Önizleme 22 istek, 0 belge yazımı. Geri yükleme ve kontrol 45 istek, 92 dönen ve 92 yazılan belge. Bunlar izole demo sayaçlarıdır.

Manuel tekrar. İade edilen bir evrakı yeni gövdeyle dondurun ve yeni rotayı başlatın. Yeni görevde yeni sürümü, geçmiş kararda eski sürümü açın. KPI toplamının yeni sürümle artmadığını ve yenileme saatini doğrulayın. Evrak kopyasını indirip dahil edilen ve eksik kalan kayıtları kontrol edin.
