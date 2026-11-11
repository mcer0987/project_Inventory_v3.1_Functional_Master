# H3-B walkthrough ve doğrulama

10 Kasım 2026. **H3-B şema hazırlığı tamamlandı.** Yeni yardımcılar yalnız birim testlerinden çağrılıyor. Satın alma ile İç Yazışmalar arasındaki köprünün kullanıcıya açılması H4/H5 kabulüne bağlı.

## Başlangıç ve paket farkı

Dal `feat/v3.4-ebys-tamamlama-h0` ve HEAD `883da91e947152d41dd6f56cbb8b6b27c1dbf10b` doğrulandı. H3-A nihai tablosu 20/20 prototip, 357/357 aday Rules ve 357/357 özgün Rules sonucu veriyordu. H3-A hash listesine göre başlangıçta stokla ilgili altı mevcut fark vardı. Bunlar `script.js`, `src/services/stock-ledger.js`, `src/utils/schema.js`, `src/utils/stock-import.js`, `tests/unit/stock-import.test.mjs` ve `tests/unit/stock-schema.test.mjs`. H3-B boyunca bu altı dosya başlangıç hash'leriyle eşleşti.

| H3-B dosyası | Değişiklik |
|---|---|
| `src/utils/ebys-purchase-schema.js` | Saf kimlik, işaretçi, teklif, tarihsel birim künyesi, digest, kur ve finans doğrulaması |
| `tests/unit/ebys-purchase-schema.test.mjs` | 12 odaklı test |
| `scratch/hosting-files.js` | 107 → 108. Mevcut Hosting desenine giren tek ek dosya şema modülü |
| `2026-11-07_EBYS_Rehberi_Revizyon_Taslagi.md` | Planlanan yardım metninde ödenek, ilk olumlu karar ve önceki sürüm açıklamaları |
| H3-B uygulama planı ve bu rapor | Koddan önce uygulama planı, koddan sonra test ve kapsam kanıtı |

Kanıt dizini `scratch/ebys-h3b-evidence/`. `baseline.patch`, `baseline-status.txt` ve `baseline-sha256.json` başlangıç durumunu gösterir. `package.patch` yalnız tablodaki altı dosyanın farkını içerir. `baseline-verification.json` başlangıçtaki 554 dosyadan 552'sinin aynı olduğunu, değişen iki başlangıç dosyasının rehber taslağı ve Hosting sayacı olduğunu ve dört yeni dosyayı gösterir. Firestore Rules ve 13 servis dosyasının önceki ve sonraki SHA-256 değerleri eşleşti. Rules SHA-256 değeri `b73a9f2dd06044a12cfcefc3da11341fc6cc1df3e3a56ae8d14769666c9a562e`.

## İddia ve test kanıtı

Aşağıdaki test adları `tests/unit/ebys-purchase-schema.test.mjs` içindedir. Her satırın sonucu `focused-unit.log` dosyasında yer alır.

| İddia | Test adı | Sonuç |
|---|---|---|
| String ve sayısal ID ayrı değerlendirilir. Baştaki sıfırlar ve gerçek yol korunur. | `legacy kimlikleri kayıpsız çözer, geçersiz girdileri ayırır` | Geçti |
| Aynı ad, pasif veya eksik kaynak ve farklı kök doğru sınıflanır. Tek aday otomatik yazım vermez. | `legacy birim sınıfları kök ve belge yoluyla çözülür, ad eşleşmesi yazma yetkisi vermez` | Geçti |
| Seçenekler aynı adı ayırır. Birim künyesi ve işaretçi, kaynak adı/kodu sonradan değişse de aynı kalır. | `saf seçim verisi eşadlı birimleri ayırır ve künye kaynaktan bağımsızdır` | Geçti |
| Kalemsiz eski talep, sanal kalemle fiyat ve KDV zorunluluğu olmadan okunur. | `kalemsiz legacy kayıt fiyat/KDV uydurmadan okunur, kayıt değişmez` | Geçti |
| Bilinmeyen motor, eksik alan, fazla alan, yanlış sahip ve işaretçide eski workflow reddedilir. | `işaretçi alanları, motoru ve yol sahibi kesin doğrulanır` | Geçti |
| Talep ve evrak aynı P'ye, sürüm ve süreç ayrı V'ye bağlanır. Eski V için güncel başlık revizyonu şart koşulmaz. | `P, V, kök ve sahip zinciri tarihsel sürümü güncel revizyona eşitlemeden denetlenir` | Geçti |
| TRY/USD/EUR toplamları yeniden hesaplanır. Otomatik ve manuel ödenek tutarları ayrı korunur. | `üç dövizde yarım kuruş ve KDV yuvarlanır, ödenek teklif toplamından ayrıdır` | 0,18 TRY, 24,26 USD, 36,40 EUR. Manuel ödenek 2.600,25 TRY |
| 1–3 kalem, alan türleri, ondalık hassasiyeti, kalem ve para birimi toplam sınırları doğrulanır. | `yeni teklif kalem, şekil, tür, hassasiyet ve üst sınır hatalarını reddeder` | Geçti |
| Kurun oranı, tarihi veya kaynağı değişirse sonuç ayrışır. Eksik ve bozuk kaynak ayrı döner. | `kur gözlemi değişen oranı, tarihi ve kaynağı ayırır, ayar üstverisi karşılaştırılmaz` | Geçti |
| Mali payload kendi P/V yoluna ve sürüm özetine bağlıdır. TRY-only biçimi ayrı doğrulanır. İlk adımda sadece `approved` olumlu karardır. | `nested finans yalnız bağlı sürümü ve hesaplanan TRY toplamını kabul eder` | 2.305,28 TRY. Red ve iade finans koşulunu sağlamadı |
| Şema 1 özeti aynı kalır. Şema 2 zarfı metin, üstveri, boş ek listesi, teklif ve birim künyesini kapsar. | `şema 1 hash geriye uyumlu, şema 2 zarfı teklif ve künyeyi kapsar` | Geçti |
| Yeni birim adı ve kur V2'de kullanılır. V1'in zarfı, özeti ve finansı aynı kalır. | `iade sonrası V2 ve yeni kur V1 zarfını ve önceki finansı değiştirmez` | V1 2.305,28 TRY, V2 2.365,94 TRY. Finans değişimi içerik özetine girmez |

## Koşum sonuçları

| Komut / denetim | Sonuç | Çıkış | Kanıt dizinindeki günlük |
|---|---:|---:|---|
| `node --test --test-reporter=spec tests/unit/ebys-purchase-schema.test.mjs` | 12/12 | 0 | `focused-unit.log` |
| `npm.cmd run test:unit` | 352/352 | 0 | `unit.log` |
| `npm.cmd run test:rules` ilk deneme | Profil altındaki Firebase CLI yapılandırmasına erişim hatası. Test başlamadı | 1 | `rules.log` |
| Aynı Rules komutu, kanıt dizinindeki yerel `XDG_CONFIG_HOME` ve `CI=true` ile | 357/357 | 0 | `rules-local-config.log` |
| `npm.cmd run lint:xss` | 989 dinamik ifadede 0 izinsiz | 0 | `lint-xss.log` |
| `node scratch/hosting-files.js` | 108/108, başlangıçta 107/107 | 0 | `hosting.log`, `hosting-before.log` |
| `git diff --check` | Geçti. Mevcut satır sonu uyarıları günlükte | 0 | `diff-check.log` |
| H3-B dosyalarının ayrı boşluk denetimi ve başlangıç hash karşılaştırması | Geçti | 0 | `package-diff-check.json`, `baseline-verification.json` |

Rules koşucusu `demo-rules-test` için Firestore 8180, hub 4410 ve logging 4510 portlarını kullandı. Koşucu boş kuralla başladığına ilişkin başlangıç uyarısı veriyor. Test grupları repo içindeki `firestore.rules` dosyasını test ortamına açıkça yüklüyor. Manuel 8080/9099 ortamında reset veya seed çalıştırılmadı.

Ürün referans taraması yalnız modülün kendi `AppModules` kaydını buldu. Yeni modülde Firebase SDK, ağ isteği, sorgu, yazma, dinleyici veya DOM erişimi bulunmadı. Paket kaynaklı ek Firestore okuma, yazma ve dinleyici sayısı **0**. [Tarama günlüğü](../../scratch/ebys-h3b-evidence/zero-product-calls.log)

## H4'e devir

1. Birim adaptörü kök ve belge yolu kimliğini gerçek belge referansından taşımalı. Bugünkü ortak birim dinleyicisinde gövdedeki `id` yol kimliğini ezebiliyor. Künye mevcut serbest kurum kodunu taşır.
2. Servis ve Rules birlikte talep, başlık ve sürüm bağını, gerçek sahipliği, tek motoru ve erişimi korumalı. İşaretçi revizyonu son taslak kaydına aittir. Paraf, onay ve olur adımları aynı ilk olumlu karar koşuluna tabidir. Kur önizlemesi güncel kaynakla karşılaştırıldıktan sonra finans, yalnız bu kararla aynı atomik işlemde yazılmalı.
3. Yedek kapsamı, yetkili P/V çiftleri ve nested finans için tam yol, motor/şema sürümü ve eksik kayıt durumlarını taşımalı. Restore provasında sahiplik, gerçek sürüm hash'i, finans bağı ve erişim sınırları doğrulanmalı. Eski finansın üst belge yolu korunmalı.
4. H5 kullanıcı akışı ve çıktı kabulünde teklif ile ilk onay finansı ayrı gösterilmeli. Kamusal QR kapsamı mevcut sınırda kalmalı. Kullanıcı rehberindeki planlanan yardım, ekran ve kurtarma kabulünden sonra yayımlanabilir.

Bu paketin geri dönüşü için yeni modül, test ve H3-B raporları kaldırılabilir, rehber taslağındaki üç adım ve Hosting beklentisi önceki haline getirilebilir. Veri geri yazımı gerekmez.
