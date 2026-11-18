# H4 — Satın alma–evrak servis köprüsü ve kurtarma

Çalıştırma ayarı: **GPT-6.1 Sol — Çok yüksek efor (`xhigh`)**. Alt ajan veya yeni sohbet başlatma. Model adını ürün, branch veya commit metnine koyma.

## Rol, çalışma alanı ve başlangıç

Bu projede uygulayıcı geliştiricisin. H3-A sözleşmesi ve kabul edilmiş H3-B saf yardımcıları üzerine H4'ü uygula. Hedef, yeni satın alma kaydının tek EBYS belgesi/sürümü/karar motoruyla güvenli servis ilişkisini kurmaktır. **Yeni yolu kullanıcıya açma; H5 ekran/çıktı ve H6a personel giriş yolunu bu görevde uygulama.**

Klasör: `C:\Users\med3pol\Documents\project_Inventory`.
Beklenen dal: `feat/v3.4-ebys-tamamlama-h0`. Son incelenmiş HEAD: `883da91e947152d41dd6f56cbb8b6b27c1dbf10b`; H0–H3-B yerel çalışma ağacında. Kullanıcı bu arada ara yayın commit'i verdiyse onun doğrulanmış devamını kullan; eski HEAD'e dönme.

Önce `AGENTS.md`, branch, HEAD, status ve diff'i incele. Başlangıç patch/hash'lerini `scratch/ebys-h4-evidence/` altına kaydet. H0–H3-B ve bağımsız stok seri numarası değişikliklerini koru, kendi diff'in diye raporlama. Reset/clean/stash, branch/worktree değişimi, commit/push/merge/deploy, canlı Firebase yazımı veya backfill yok. Beklenmedik taban farkı varsa önce somut farkı bildir; yalnız çalışma ağacının kirli olması engel değildir.

## Okunacak belgeler

`audits/audit-reports/` altında:

- `2026-11-10_EBYS_H3_B_Teslim_Kontrolu.md`
- `2026-11-09_EBYS_H3_A_Veri_ve_Servis_Sozlesmesi.md` — özellikle §2–8.
- `2026-11-09_EBYS_H3_A_Walkthrough.md` ve `2026-11-09_EBYS_H3_A_Legacy_Birim_Esleme_Analizi.md`.
- `2026-11-10_EBYS_H3_B_Implementation_Plan.md` ve `2026-11-10_EBYS_H3_B_Walkthrough.md`.
- `2026-11-07_EBYS_Spark_Model_Dokumantasyon_ve_Rehber_Plani.md` ve rehber revizyon taslağı.
- H0 süre sözleşmesi, Q0 okuma bütçesi ve H1 kurtarma plan/walkthrough belgeleri.

Kod: `src/utils/ebys-purchase-schema.js`, `purchase-money.js`, `ebys-document-schema.js`, `ebys-process-schema.js`; `src/services/ebys-document-service.js`, `ebys-process-service.js`, `ebys-execution-service.js`, `purchase-servises.js`, `firebase-handler.js`; `firestore.rules`, H1 `tools/ebys-local-recovery.mjs`, mevcut Rules/birim testleri ve `tests/prototypes/ebys-h3/`.

Eski üst seviye planda H5'e yazılmış karar entegrasyonunun **servis/Rules kısmı**, kabul edilen H3-A §8 ile H4 kapsamındadır. H5 kullanıcı ekranı, onay deneyimi, çıktı ve görünür rehber entegrasyonudur. Ortak yayın kapısı değişmez: H4+H5+H6a kabul edilmeden yeni satın alma yolu açılmaz.

## 1. Önce uygulama planı

`audits/audit-reports/2026-11-10_EBYS_H4_Implementation_Plan.md` oluştur. Yazılacak/değişecek dosyalar, API sözleşmeleri, atomik işlem okuma/yazma listeleri, sorgu sınırları, test matrisi, yedek/restore ve geri dönüş koşulları açık olsun. Dosyayı hazırlayıp onay için beklemeden bu yetkili kapsamı uygula.

## 2. Servis köprüsü

- Tercihen `src/services/ebys-purchase-service.js` içinde `createPurchaseDocument`, `savePurchaseDraft`, `freezePurchaseVersion`, `getPurchaseView` benzeri açık API'ler oluştur; mevcut komut/işlem günlüğü modelini yeniden kullan. İsimleri gerekçeyle uyarlayabilirsin.
- Aynı izinli kökte P = `purchaseOrders/items/P` işaretçi yolu = `ebysDocuments/items/P` ana evrak yolu. V ayrı UUID; `ebysVersions/items/V` ve `ebysProcesses/items/V` aynı V. Üçüncü bağ/rezervasyon koleksiyonu ekleme.
- İlk taslak işaretçi+başlık+taslak+operation+event atomik oluşur. Başkasının mevcut kaydına sonradan bağ takma. Owner gerçek Auth UID'sidir; UI argümanı yetki değildir.
- İşaretçi H3-B'nin dar alanlarını taşır; içerik, kalem, kur veya `workflow` kopyalama. Taslak kaydında revizyon/expectedRevision korunur. İşaretçinin revizyonu son taslak kaydıdır; her kararda senkron yazma ekleme.
- Dondurmada teklif taslaktan birebir, küçük birim künyesi aynı kökteki aktif ortak `units` belgesinden gelir. H3-B helpers ve tek `PurchaseMoney` motorunu kullan. Saf yardımcıdaki genel zaman damgası kontrolünü sunucu zamanı doğrulaması yerine sayma.
- Birim kaynağının gerçek belge yolunu ayrı koru. `{id: snap.id, ...snap.data()}` kaynaklı ID ezilmesini yeni adaptöre taşıma. Legacy ortak liste sözleşmesini geniş refactor ile bozma; yeni ayrı birim kataloğu/sürekli dinleyici ekleme.
- Şema 2 hash zarfını kullan, şema 1 hash davranışını koru. Tarihsel sürüm okunurken güncel birim aktifliği/adı veya currentVersionId içerik kaynağı olmasın.
- Görünüm adaptörü legacy ve yeni kayıtları ayırsın; yetkili nokta okumalarıyla taslak/sabit sürüm/varsa finans görünümü versin. Gizli içeriği genel satın alma listesine taşımadan, geçmiş görev için istenen V'ye bağlı kal. Yetki reddini “boş kayıt” diye yutma.

## 3. Tek karar otoritesi ve ilk onay finansı

- Yeni motor `ebys-v1`, şema 2. Motoru olmayan/`legacy` eski talepler aynı davranışta kalır. Bilinmeyen veya sonradan değiştirilmiş motor reddedilir.
- Mevcut EBYS `startProcess`/`decideTask`/iade/geri çekme akışını genişlet; ikinci karar motoru yazma. Eski `purchaseOrders.workflow` yolu yeni işaretçiye, admin dahil, yazamaz/ezemez/silemez. Generic allow dallarını da incele.
- İlk olumlu karar `currentStep==0 && approved`: `/R/purchaseFinance/items/P/versions/V` create-only kaydı aynı transaction'da zorunlu. İlk iade/red finans üretmez. Tek adımlı rotada finans+son karar+deterministik icra işi atomik olsun. Legacy parent finans belgesi anlamı değişmez.
- Kur mevcut `system_config/items/ebys_rates` kaynağından alınır. Kullanıcının gördüğü rates/date/source ile transaction'da taze okunan kaynak farklıysa anlaşılır “tutar değişti, tekrar inceleyin” sonucu dön; onayı tamamlamış gibi davranma. Kaynak yoksa döviz onayı başarısız; TRY-only sözleşmesini koru. Bu aşamada yeni UI ekleme; H5'in tüketebileceği dar servis sonucu/hata sözleşmesi üret.
- Rules kaynak kur/tarih/kaynağı, P/V/owner/operation/actor bağını doğrulasın. Finans immutable; V2 kendi finansını yaratır, V1 değişmez. Sürüm hash'i sonradan finansı içine almış sayılmaz.
- Aynı operationId+payload tekrarında aynı sonucu döndür; farklı payload/revizyonun önceki başarıyı kullanmasını engelle. Kimlikleri transaction retry içinde yeniden üretme. Birinci başarılı işlem sonrası hata telafisi gerekiyorsa sunucudan taze okuyup aynı aktör ve payload eşitliğini doğrula; bütün permission-denied hatalarını başarıya çevirme.
- Son onay mevcut havale politikasından tek icra işi açar; onay ≠ icra ≠ stok. Stok üretme veya stok servislerini değiştirme.

## 4. Rules ve Spark bütçesi

- H3-A aday kurallarını tasarım/kanıt kaynağı olarak incele; bütün dosyayı ürün Rules üzerine kopyalama. Güncel stok/iade/QR/arşiv ve H0 süre güvenliğini koruyarak cerrahi entegrasyon yap.
- Create-only bağ, immutable sürüm/finans, taslak sahibinin erişimi, sırası gelmeyen kişi reddi, geçmiş kararın yalnız kendi V'sine erişimi ve süreli vekâlet korunur. Salt admin rolü başkasının özel içeriğini açmaz.
- İfade sınırı ve atomik erişim bütçesi için H3-A komut/motor dal ayrımını koru. Olay veya yetki kontrolünü test geçsin diye çıkarma. Başarılı pozitif senaryolar da bütçe içinde geçmeli.
- Yeni polling, kart başına otomatik okuma/listener, global tarama/collection-group, sayaç, token koleksiyonu, dış kur servisi, Cloud Functions/Blaze, dosya yükleme/Base64 ek yolu veya yeni bağımlılık yok.
- Her komutun SDK get/yazı sayısını gerçek servis üzerinden ölç, retry etkisini ayrı belirt; fatura/Rules bağımlı okuma sayısı diye sunma. H3-A taslak 5 yazı, dondurma 4 yazı, ilk-son onay 7 yazı örneklerinden sapmayı gerekçelendir; bunlar günlük kota garantisi değildir.

## 5. Yedek ve kurtarma bu pakette tamamlanacak

- H1 kişisel kopyasına yetkili işaretçileri ve sabit sürümlerden türetilen P/V için nested finansı sınırlı nokta okumalarıyla ekle. İzin verilmeyen finansı/genel kataloğu tarama. Henüz oluşmamış, erişim reddi ve alınmış kayıt ayrı belirtilsin.
- Manifest tam yol/engine/schema, kapsam, eksik ve alınan adetleri açıkça taşısın. Legacy parent finans ile yeni nested finans karıştırılmasın.
- Operatör paketleme ve yerel restore doğrulamasında P/V/root/owner/motor, canonical digest ve finans referans zinciri doğrulansın. Kullanıcının kişisel JSON'u ayrıcalıklı operatör yedeği gibi sunulmasın.
- Boş, ayrı **demo emülatör** hedefine gerçek export→restore provası yap; V1/V2 finans ve sürüm ayrımı, geçmiş/gelecek imzacı erişimi, kapanmış iş ve kamusal QR sınırlılığı korunsun. Eski şema paketlerinin restore regresyonunu da çalıştır.
- Canlı dump/backfill yapma; mevcut 8080/9099 UAT verisini temizleme. Emülatör sahipliği/portlar belirsizse ayrı test yapılandırması kullan.

## 6. Kullanıcıya açmama ve rehber sınırı

Yeni oluşturma servislerini mevcut ürün butonlarına bağlama; üretimden çağrı yolu oluşturma. Testler gerçek servisleri yalnız izole emülatörde çalıştırsın. UI/yerel depolama anahtarı güvenlik kuralı sayılmaz. H4 ürün kuralları da bu görevde deploy edilmez.

H5 için hangi görünüm/komut sözleşmesinin kullanılacağını raporla. Rehber **taslağına**, planlanan talep→evrak→onay→icra akışını 3–5 sade adımla ekle; şu an kullanılabilen özellik diye ürün rehberine taşıma. Yeni panel yok. Sonraki panelde görünür amaç açıklaması ve uzun adımlar için erişilebilir yardım şartı `AGENTS.md` gereğidir.

## 7. Test ve self-proof

Asgari senaryoları mock kopya işlevler yerine gerçek servis + ürün Rules ile doğrula:

1. Paralel ilk oluşturma/aynı komut tekrarı: tek P, yarım bağ yok. Farklı payload aynı operationId ile reddedilir.
2. Bayat revizyon/dondurma, farklı kök/P/V/owner, başka talebe bağlama, pasif/eksik birim; hiçbir kısmi yazım kalmaz.
3. Legacy kalemsiz/kalemli talep düzenleme ve onay çalışır; eski ve yeni motor birbirinin kaydına yazamaz. Admin tam set/overwrite ve alan silme denemeleri dahil.
4. Üç döviz/manuel ödenek; ilk paraf ve ilk onay finans yaratır, ilk red/iade yaratmaz; değişen/eksik kur reddi atomik. Tek adımlı son onay tek iş oluşturur.
5. V1 iade→V2; eski metin/fiyat/kur sabit, yeni görev yeni sürümü görür; geçmiş görev başka V'yi göremez. H0 süre bitimi, A→B→A→A ve vekil aktör sınırları korunur.
6. Finans/sürüm update/delete, sahte kimlik, yalnız finans yazma, finanssız ilk olumlu karar reddedilir. Aktif/gelecek/geçmiş görevli, icracı, salt admin, yabancı ve anonim erişim matrisi.
7. Export→boş demo restore; eksik/bozuk bağ/hash içeren paket reddi, legacy paket uyumu, QR fiyat/PII sızdırmama.
8. Gerçek modül çağrı sayısı, hata/oturum değişimi ve tekrar kontrolü. Yeni otomatik okuma yok; başarısız komut stok değiştirmez.

Çalıştır: `npm.cmd run test:unit`, `npm.cmd run test:rules`, `npm.cmd run lint:xss`, `node scratch/hosting-files.js`, `git diff --check`; ayrıca ilgili gerçek servis entegrasyon ve restore komutları. Yeni yayın modülü için beklenen Hosting sayısını yalnız gerçek farkla düzelt. Başarısız pozitif akışı reddedilmesi beklenen teste dönüştürme. Bütçe günlüğünün kesin ifade sayısı vermediği yerde sayı uydurma.

## Teslim

`audits/audit-reports/2026-11-10_EBYS_H4_Walkthrough.md` yaz:

- Yalnız H4 dosya/diff özeti; önceki değişikliklerin korunduğu kanıt.
- İddia → gerçek test adı/komut → sonuç → kanıt yolu tablosu ve çıkış kodları.
- Komut bazında SDK okumalar/yazılar; tekrar maliyeti, bilinen pilot sınırları.
- Yeni şema export/restore kanıtı; iki motorun ayrımı ve erişim negatifleri.
- H5/H6a'ya kalan ekran/çıktı/rehber işleri; yeni yolun canlıda açılmadığının kanıtı.
- Oluşmuş yeni kayıtlar varsa eski Rules'a kör dönülemeyeceği, oluşturmayı durdurup mevcut işleri bitirme desteğini koruyan geri dönüş planı.

H4'ü bu kapsamda bitir, raporu sun ve dur. Commit/deploy yapma, H5'e kendiliğinden geçme.
