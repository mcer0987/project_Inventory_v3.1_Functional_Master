# H2 walkthrough ve self-proof

Dal `feat/v3.4-ebys-tamamlama-h0`, HEAD `883da91`. H2 öncesi diff, dosya kopyaları ve hash'ler `scratch/ebys-h2-evidence/` altında.

| İddia | Önce | Sonra | Kontrol ve kanıt |
|---|---|---|---|
| Hosting | 108 dosya, kurtarma aracı pakette | 107 dosya, `tools/**` hariç | `hosting-before.log` ve `hosting.log`. H1 paketleme bulgusu kapandı. |
| Belge türleri | Üç defter sonraki aşama olarak etiketliydi | Dört tür kullanımda. Olur adımı ve üst yazı alanı kendi kullanım yerleriyle gösteriliyor | Katalog render ve satın alma şablonu testi. `browser.log`, `unit.log`. |
| Evrak ve iş durumu | Başlık filtresinde İcrada seçeneği vardı | Evrak durumu filtresi, eski kayıt etiketi ve İcra Takibi yönlendirmesi. Dondurulan kaydın rota ayrıntısı Süreç durumu ekranında | Kaynak farkı. Filtre yalnız başlık durumunu kullanır. Eski durum etiket haritasında kalır. |
| Rehber ve klavye | Ekran ayrımı dağınıktı | Başlangıç ekranı, sayfa kapsamı, toplamlar ve icra takibi tek yardım maddesinde | Gerçek admin/index HTML ve yerel CSS ile 1280 açık ve 390 koyu headless kontrolü. Enter ile yardım açıldı, Escape ile rehber kapandı. |
| Çağrı bütçesi | Q0 görünürlük ve sayaç modeli | Ek Firestore çağrısı 0 | Değişiklikler etiket ve görünümle sınırlı. Q0 çağrı ve dinleyici testleri `unit.log` içinde geçti. Canlı kullanım ölçülmedi. |
| H0 ve H1 | Çalışma ağacındaki önceki teslimler | Rules, süreç servisi, süre şeması, evrak servisi ve kurtarma aracı aynı hash | `hash-check.log` ve birleşik Rules regresyonu. |

H2 dosyaları `firebase.json`, `admin.html`, katalog ve katalog UI, evrak defteri UI, rehber UI, rehber taslağı ve katalog birim testi. Ayrıca H2 planı ve bu rapor eklendi. Satın alma formunun mevcut tek tür seçimi ve şablon kodları korunuyor.

`npm.cmd run test:unit` 339/339, `npm.cmd run test:rules` 357/357, `npm.cmd run lint:xss` 0 izinsiz ifade, Hosting 107/107 ve `git diff --check` geçti. Komutların çıkış kodu 0. Tarayıcı kontrolü headless DOM/CSS ile yapıldı. H2 kapsamında Auth oturumuyla görsel manuel tur yapılmadı. Rules testi ayrı demo emülatörde çalıştı.

Manuel kontrol. Tanımlar tablosunda üç defteri bulun. Satın alma formunda tür listesini açın. Defterde Evrak durumu ile İcra Takibi'ni karşılaştırın. Rehberde ekran yönlerini ve sayfa kapsamını kontrol edin.
