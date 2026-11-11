# H3-A Walkthrough ve self-proof

Başlangıç 9 Kasım, tamamlanma 10 Kasım 2026. **Sonuç: H3-A kanıtlandı; H3-B'nin sınırlı şema uygulamasına hazır.** Bu sonuç ürün köprüsünün açıldığı veya bütün H3/H4/H5'in bittiği anlamına gelmez.

Dal `feat/v3.4-ebys-tamamlama-h0`, HEAD `883da91e947152d41dd6f56cbb8b6b27c1dbf10b` değişmedi. Commit/push/merge/deploy, canlı okuma/yazma veya manuel emülatör müdahalesi yapılmadı. H0/Q0/H1/H2 çalışma ağacı korundu.

## 1. Teslim ve değişiklik sınırı

Ürün kodu yerine 11 izole prototip dosyası eklendi:

- `tests/prototypes/ebys-h3/build-rules.mjs`, `extension.rules`, `candidate-loader.mjs`: hash kontrollü tam Rules adayı ve değişmemiş testlere yükleme.
- `harness.mjs`, `prototype.test.mjs`, `run.mjs`, `emulator.json`: gerçek SDK transaction kanıtı ve ayrı demo koşucu.
- `legacy-units.mjs`, `legacy-units.test.mjs`: salt okunur yerel JSON eşleme analizi.
- `check-baseline.mjs`, `README.md`: değişmeme kanıtı ve yeniden çalıştırma.

Raporlar: H3-A Implementation Plan, Veri ve Servis Sözleşmesi, Legacy Birim Eşleme Analizi, bu Walkthrough; ayrıca `2026-11-10_EBYS_H3_B_Yeni_Sohbet_Gorev_Promptu.md`. Mevcut `2026-11-07_EBYS_Rehberi_Revizyon_Taslagi.md` içine henüz uygulanmamış 5 sade kullanım adımı eklendi. Ürün rehberi değiştirilmedi.

`scratch/ebys-h3a-evidence/` ignored kanıt alanıdır. Önceden var olan 15 tracked dosyalık H0–H2 diff'i H3-A değişikliği değildir. **350 başlangıç dosyası SHA-256 karşılaştırmasında değişiklik 0**; sonuç `baseline-verification.json`.

Kaynak Rules SHA-256:
`b73a9f2dd06044a12cfcefc3da11341fc6cc1df3e3a56ae8d14769666c9a562e`

Son aday SHA-256:
`1eac059a27c66bcc6c166019c3f9afee99e1d027cad5122b02ce7e9f5a951c9f`

Üretim dosyası ile fark `candidate.patch`; yamaların beklenen metin/eşleşme sayısı `rules-patches.json`. Kaynak hash veya yama eşleşmesi değişirse üretici durur. Boş Rules dosyasına bağımsız izin bloğu eklenerek test yapılmadı.

## 2. Nihai test sonuçları

| Denetim | Sonuç | Çıkış | Günlük (`scratch/ebys-h3a-evidence/`) |
|---|---|---:|---|
| H3 prototipi: 19 Rules/SDK senaryosu + 1 yerel eşleme testi | **20/20** | 0 | `prototype-final.log` |
| Değişmemiş mevcut testler, tam aday Rules ile | **357/357** | 0 | `candidate-regression.log` |
| `npm.cmd run test:unit` | **339/339** | 0 | `full-unit.log` |
| `npm.cmd run test:rules`, özgün ürün Rules'u ile | **357/357** | 0 | `full-rules.log` |
| `npm.cmd run lint:xss` | **0 izinsiz ifade**; 989 dinamik ifade tarandı | 0 | `lint-xss.log` |
| `node scratch/hosting-files.js` | **107/107**; prototip yayında değil | 0 | `hosting.log` |
| `git diff --check` | Geçti | 0 | `diff-check.log` |
| Başlangıç dosyası hash karşılaştırması | **350/350 aynı** | 0 | `baseline-verification.json` |

Ek test bağımlılığı kurulmadı. Üretimde Firebase 10.7.1 importları; prototipte kurulu test SDK'sı **12.19.0** kullanıldı. Auth claim'leri Rules test ortamından gelir; gerçek Auth oturumu/tarayıcı kabulü değildir. İşlem, görev ve icra servislerinin gerçek kaynakları VM içinde kullanılır. Yalnız yeni süreç bağı ve ilk finans hook'u VM'de eklenir; yeni save/freeze prototip uygulamasıdır. HTML/CSS değişikliği ve görsel kabul yoktur.

## 3. İddia → kanıt matrisi

| İddia / önce | Adayda kanıt ve test adı | Sonuç |
|---|---|---|
| Ürün Rules'u yeni şemayı açmıyor | `H3 base kurallar yeni şemayı açmaz; aday aynı tabandan gelir` | Özgün şema bağlı başlık yazımını reddetti; yeni yol yalnız adayda açıldı |
| Birim adı kalıcı kimlik değil | `H3 gerçek sahip, ortak birim, kayıt/dondurma ve küçük tarihsel künye`; yerel dokuz sınıf testi | UUID talep ve ortak birim ID; yeniden adlandırma eski sürümü değiştirmedi |
| Pasif/eksik/başka kök ve sahte ad/sahip engeli | `H3 pasif/eksik/farklı kök birim; sahte ad ve başka owner bağları reddedilir` | Ret; gerçek personel yazarla meşru oluşturma geçti |
| Talep ve başlık ayrı ayrı kalamaz | `H3 yarım bağ veya farklı yol ID atomik reddedilir; kayıt kalmaz` | Eksik yazım/different ID reddi ve bağımsız incelemede artık kayıt yok |
| Genel allow yeni motoru atlayamaz | `H3 owner ve admin için eski overwrite/motor değişimi/silme kapalı` | Motoru silme, legacy yapma, full-set, eski workflow yazma ve silme her iki aktörde reddedildi |
| İlk olumlu karar finansı zorunlu kılar | `H3 tek adım ilk=son onay: finans + iş tek atomik işlem; yönetici içerik alamaz` | TRY/USD/EUR üç kalem; **2.317,23 TRY**; tek finans + pending icra; admin özel içerik/finans alamadı |
| İlk/ara/son ve tekrarlayan kişi | `H3 altı adım...`; `H3 A-B-A-A...` | Altı adım bitti; A'nın 0/2/3 kararları korundu; gelecekteki F finans alamadı |
| Eksik/sahte finans veya icra tesadüfen kabul edilmez | `H3 finans/iş eksik, çapraz finans yolu, yanlış kur/digest tüm transactionı reddeder` | Beş kötü payload atomik reddedildi, süreç revision 1 kaldı |
| Ekranda görülen kur sessizce değişmez | `H3 onaydan önce kur değişirse yeni tutarı sessizce onaylamaz` | Bayat önizleme servisçe; eski kur enjekte edilen yazım Rules'ça reddedildi |
| İade/red finans oluşturmaz; TRY kur istemez | `H3 TRY yalnız kur ayarı istemez; red/iade finans üretmez` | Kur kaydı silinmiş demoda TRY geçti; ilk red/iade için mali kayıt yok |
| V1/V2 erişimi ve mali tarihçe ayrı | `H3 iade yeni sürüm: ilk mali kayıt sabit; eski imzacı V2 fiyatını alamaz` | V2 yeni kurla; V1 byte/veri eşit kaldı; eski imzacı V2 fiyatı/metni alamadı |
| Vekilin kimliği gerçek aktör | `H3 vekil ilk karar ve finans aktörüdür; asıl görevli sırası olmadan okuyamaz` | Aktör B; karar vermemiş asıl A mali kayda erişemedi |
| Tekrarlanan komut yeni sonuç üretmez | `H3 aynı operationId iki paralel karar tek sonuç...`; `H3 aynı taslak iki çağrı tek bağ...` | İki paralel çağrı aynı sonuç; farklı payload reddi; stale revision/dondurma yarışında tek geçerli sonuç |
| İcrasız son onay yok | `H3 havale yok/pasif sorumlu son onayı atomik durdurur` | Eksik tanım/pasif kişi son onayı durdurdu |
| Stok, iade ve bildirim sınırı | `H3 icra kabul/iade/havale; sahte stok ve bildirimsiz kapanış reddi` | İade ile eski icracı finans erişimini kaybetti; yeniden havale/kabul geçti; sahte stok ve bildirimsiz kapanış reddedildi; doğru kapanış closed |
| Şema ve kaynak bağı yan yazımla aşılamaz | `H3 taslak atlatma, sahte künye/sürüm ve bağımsız finans yazımı reddedilir` | Eksik/boş kalem, yanlış tür, bağımsız taslak/finans, sahte birim künyesi/ödenek ve başka kök reddedildi |
| Geri çekme geçmişi korur | `H3 geri çekme mali geçmişi korur; yeni görev ve icra üretmez` | Önceki karar sahibi finansı okudu; sıradaki kişi erişemedi, icra işi oluşmadı |
| Mevcut satın alma/envanter/QR/kurtarma bozulmaz | Değişmemiş tam `tests/rules/*.test.mjs` + aday | Legacy 10 adımlı en ağır akışlar dahil 357/357 |

Fixture yazımı için Rules devre dışı bağlam kullanılır; test edilen komutlar normal yetkili SDK bağlamındadır. Yokluk kontrolü için kullanılan ayrı inceleme okuması, kullanıcı okuma yetkisi kanıtı olarak sayılmaz.

## 4. Bütçe incelemesi ve düzeltilen adaylar

İlk adayın geçmediği sonuçlar saklandı; yeşil sonuca katılmadı:

1. Kalem doğrulaması taslak metin doğrulamasına eklenince 1000 ifade sınırı aşıldı. Kalem doğrulaması, aynı transaction'da yazılması zorunlu işaretçi kuralına taşındı. Taslak → yeni başlık revision → işaretçi revision bağı atlanamıyor. Alan güvenliği kaldırılmadı.
2. Başlık güncellemesindeki yazar düzenlemesi ve süreç/kapanış dalları birlikte değerlendirildiğinde bazı saldırı retleri bütçe hatasına dönüştü. Token/closed/yalnız durum geçişi/yazar düzenlemesi komutları ayrı koşullu dallara ayrıldı; her dalın asıl güvenlik kontrolleri korundu.
3. Yeni motor kapısını eski genel allow dallarının önüne eklemek eski ağır talepleri bozdu: ilk tam regresyon 344/357, sonraki daraltma 348/357. Son adayda dört özgün satın alma ifadesi hash kontrollü kaynaktan çıkarılıp **tek motor/rol dağıtıcısında** kullanılıyor. Personel dalındaki sabit koleksiyon koşulları sadeleştirildi; gerçek sahip koşulu aynı `createdByUid` karşılaştırmasıdır. Eski oluşturmadaki hesabın personel ID'si bir kez çözülüp hem ad hem createdBy kontrolünde kullanılır; ad/UID denetimi çıkarılmadı. Sonuç 357/357.
4. Aynı taslak için iki eşzamanlı çağrıda kayıp/yarışan cevap, aynı operation kaydının sunucudan yeniden okunup owner/komut/payload hash'inin doğrulanmasıyla çözülür. Yetki veya farklı payload hatası başarıya çevrilmez.

`prototype-01.log`–`prototype-06.log`, `candidate-regression-first/second/third.log`, `legacy-budget-01.log` gelişim kanıtıdır; **nihai kabul günlükleri değildir**. `prototype-02.log` Windows iç shell'de test adı filtresinin tırnaklama hatasıdır; çalışmış test diye sayılmadı.

Nihai prototipte bütün beklenen `permission-denied` hataları ifade/erişim bütçesi mesajına karşı ayrıca denetlenir. `prototype-final-emulator.log` ve `candidate-regression-emulator.log` taramasında **1000 ifade / erişim sınırı aşımı mesajı bulunmadı**. Başarısız bir adayın sırf reddedilmesi güvenlik başarısı sayılmadı.

**Kesin ifade sayısı ölçülmedi.** `coverage.json` kaynak kapsamı/değerlendirme sonuçlarıdır; tek istekteki ifade veya faturalanan okuma sayacı değildir. Altı adım, ilk=son, üç kalem, normal personel, vekil ve eski 10 adımlı akış testlerinin geçmesi sınanmış uçlar için kanıttır; olası bütün veri boyutlarının matematik ispatı değildir.

## 5. Gerçek SDK çağrıları ve Spark maliyeti

`measurements.json`: SDK belge okuma çağrıları, transaction'a hazırlanan yazımlar ve deneme sayısı. Aşağıdakiler nihai koşumdaki tek denemelerdir; Rules bağımlı okumalarını, başka ekranları veya faturalandırmayı kapsamaz.

| Komut | SDK okuma | Hazırlanan yazma | Gerçekleşen yazma |
|---|---:|---:|---:|
| Yeni taslak + talep bağı | 4 | 5 | 5 |
| Dondurma | 4 | 4 | 4 |
| 1 / 2 / 4 / 6 adımlı süreci başlatma | 5 / 6 / 8 / 10 | 4 | 4 |
| İlk=son olumlu karar + finans + icra | 10 | 7 | 7 |
| Altı adımda ilk olumlu karar | 8 | 6 | 6 |
| Ara karar (farklı kişi) | 5 | 5 | 5 |
| Son karar (finans zaten var) | 7 | 6 | 6 |
| Aynı karar operation tekrarı | 1 | 0 | 0 |
| Aynı taslak operation tekrarı | 4 | 0 | 0 |
| Beş kötü ilk/son karar yazımı | 11 | 6 veya 7 | **0** |
| İcra tamamlama | 2 | 4 | 4 |

Okuma/yazma yolları ham ölçümde tek tek bulunur. Taslak: operation/başlık/birim/işaretçi okunur; işaretçi/başlık/taslak/operation/event yazılır. İlk/son kararda bunların yerine process-operation/süreç/görev/başlık/havale/birim/personel/sürüm/mali kayıt/kur okunur; finans/süreç/görev/başlık/icra/operation/event yazılır.

Prototip transaction `maxAttempts=3`; çakışmada bir komutun SDK hazırlıkları üç katına çıkabilir, hata sonrası bir doğrulama okuması eklenebilir. Kayıt numarası için mevcut servisin 5 aday döngüsü korunur; onu tek deneme sayılarıyla sınırlıymış gibi sunmuyoruz. Yeni sürekli listener/polling/sayaç sayısı **0**; UI henüz bağlanmadı.

Yapısal Rules incelemesinde başarılı taslak isteğinin bağımlılık birleşimi yaklaşık 9, ilk=son kararın 16 farklı belge yoludur: üyelik belgeleri, evrak/süreç/görev, operasyon/olay, mali kaynak, politika, birim ve icracı hesabı. **Bu, `get`/`getAfter` çağrı sayısı veya garantili üst sınır değildir**; önce/sonra görüntüleri ve önbellek davranışı ayrı hesaplanır. Gerçek atomik isteklerin emülatörden geçmesi, 10/20 erişim sınırını bu senaryolarda geçmediklerinin kanıtıdır. Kaynak: [Firestore Rules erişim sınırları](https://firebase.google.com/docs/firestore/security/rules-conditions#access_call_limits).

Mevcut EBYS yaşam döngüsüne göre taslak bağında +1, ilk olumlu kararda +1 yazma eklenir. Eski satın alma formunun tek kayıt maliyetiyle tüm EBYS yaşam döngüsünü eşdeğer saymıyoruz. Tek adımlı yeni işin taslak+dondurma+başlatma+onay+kabul+kapanış toplamı 26 yazmadır; kesin numara, QR, ek düzenleme ve diğer ekranlar hariçtir. Örneğin 100 böyle iş 2.600 yazma eder; kurumun diğer modülleri aynı kotayı kullanır. Firestore ücretsiz günlük 50.000 okuma/20.000 yazma sınırı EBYS'ye ayrı tahsis edilmiş bütçe değildir. [Resmî kota](https://firebase.google.com/docs/firestore/quotas).

Toplu backfill, yeni canlı sayaç, finans collection-group taraması veya otomatik dış hizmet eklenmedi. Gelecek ekranlarda sayfa sınırı ve açık kullanıcı isteği korunmalıdır.

## 6. Yeniden çalıştırma

Repo kökünde, ayrı test portları boşken:

```powershell
node tests/prototypes/ebys-h3/build-rules.mjs
npx.cmd --no-install firebase emulators:exec --config tests/prototypes/ebys-h3/emulator.json --only firestore --project demo-ebys-h3 "node tests/prototypes/ebys-h3/run.mjs"
node tests/prototypes/ebys-h3/legacy-units.mjs
node tests/prototypes/ebys-h3/check-baseline.mjs
npm.cmd run test:unit
npm.cmd run test:rules
npm.cmd run lint:xss
node scratch/hosting-files.js
git diff --check
```

Prototip Firestore 8283 / hub 4423 / logging 4523 kullanır; test ortamı Rules'u yüklemeden test komutu çalışmaz. Ürün Rules testleri mevcut 8180/4410/4510 koşucusundadır. Kullanıcının 8080/9099 ortamı temizlenmez. İleride gerçek Rules tabanı değişince hash kilidini körlemesine güncelleme; aday yamayı yeniden incele.

## 7. Açık sınırlar ve devir

- Gerçek Firebase kotası, fatura, Auth oturumlu arayüz ve üretim SDK 10.7.1 uçtan uca testi yapılmadı.
- Yeni nested finansın H1 export/restore genişletmesi henüz uygulanmadı. Şema 1'in mevcut kurtarma testi geçti; bu şema 2 restore kanıtı değildir. H4/H5'te yayın kapısıdır.
- Mevcut Rules aritmetik/SHA-256 hesaplarını tekrar üretmez; kaynak bağını/immutable sürümü/atomik kararı korur. Matematik doğruluğu için mevcut istemci BigInt motoru ve pilot sınırı geçerlidir. Tam sunucu muhasebe garantisi verilmez.
- Yeni kurum sicili, ek dosya, e-posta/KEP/e-imza, fiyatlı hizmet ve yeni token koleksiyonu yoktur. Başka ürün kararı bu paket içine sokulmadı.
- **H3-B** saf şema ve kimlik hazırlığıdır; yeni talep oluşturma/Rules/UI köprüsü açılmaz. Sonraki görev metni `2026-11-10_EBYS_H3_B_Yeni_Sohbet_Gorev_Promptu.md`; çalışma ayarı kullanıcı tercihiyle Sol / yüksek efor. Çıktısı implementation plan + testler + walkthrough/self-proof olarak yeniden incelenecek.

Ürün dosyalarını değiştirmeden prototype/rapor dosyalarıyla geri alınabilir bir teslim yapılmıştır. Yeni motoru açmak veya oluşmuş yeni verileri eski Rules'a geri döndürmek bu teslimin yetkisinde değildir.
