# Aşama 4 — Bağımsız mimari ve güvenlik denetimi

Tarih: 2 Kasım 2026. Dal: `feat/v3.4-ebys-asama-4`. HEAD: `d2b117a`.
Kapsam: Yerel Aşama 4 uygulaması ve UI/UX revizyonu; Aşama 1 sözleşmesi ve Aşama 4 uygulama raporuyla karşılaştırma.

## [MİMARİ VE VERİ BÜTÜNLÜĞÜ]

**Teknik Aşama 4 kabulü ve Aşama 5 geliştirmesine geçiş: GO.** İncelenen geçerli ortam köklerinde (`lifeserver_master`, `inventory_demo`) değişmezlik, yazar izolasyonu ve korelasyon şartlarını aşan P0/P1 bulunmadı. Bu karar canlı deploy onayı değildir.

- `ebysDocuments`, `ebysDrafts`, `ebysVersions`, `ebysRegistrationIds`, işlem ve olay koleksiyonları genel `knownCol`/`COLLECTIONS` okuma-yazma kanallarına eklenmemiş. Taslak içerik, yönlendirme başlığı ve dondurulmuş içerik ayrı kaynaklarda. Admin başlık listesi içerik okuma yetkisi kazandırmıyor.
- `firestore.rules:766` komutu yeni operation kaydına; `:784` başlık geçişini revizyon, durum, sürüm/rezervasyon ve komuta bağlıyor. `:845` ve devamı operation/event kayıtlarını başlıkla eşliyor. Servis aynı transaction içinde ilgili yazmaları yapıyor. Revizyonsuz yan yazma, bağımsız sahte kayıt ve taslaktan farklı içerik/üstveriyle sürüm üretimi reddedildi.
- `firestore.rules:831` sürümlerde ve `:843` rezervasyonlarda update/delete işlemlerini kapatıyor. Ek testte admin-yazarın tam `setDoc` overwrite'ı, aynı içerikle overwrite'ı ve atomik delete+set girişimi de reddedildi; eski veri aynı kaldı. Firebase Admin SDK/IAM yöneticileri bu istemci Rules sınırının kapsamı değildir; sunucu yönetim yetkilerine karşı mutlak değişmezlik iddiası yoktur.
- `src/utils/ebys-document-schema.js:37` üreticisi 16 kriptografik rastgele bayt kullanıyor. `src/services/ebys-document-service.js:76` numara rezervasyonunu başlık ve günlükle atomik yazıyor. Aynı evrak için eşzamanlı iki ayrı kayıt komutundan yalnız biri başarıyla rezervasyon ayırdı; tek numara kaldı. Rastgele çakışma olasılığı matematiksel olarak sıfır değildir; çakışmanın mevcut rezervasyonu ezmesine izin verilmedi. Farklı yazar çakışmasındaki yeniden deneme eksikliği aşağıdaki P2'dir.
- `src/services/ebys-document-service.js:68` `id = versionId = processId` yazar; `firestore.rules:823` bu eşitliği zorunlu tutar. Başlık da aynı sürüme bağlıdır. Yanlış processId ile dondurma reddedildi. Aşama 5 deterministik kişi-görev kayıtları için uygun temel vardır. Süreç/görev oluşturma ve görevden okuma hakkı henüz uygulanmış sayılmaz; bu aşamada bunlara genel yazma/okuma izni açılmamıştır.
- SHA-256 gerçek servis testinde kanonik içerik/üstveri/ekler hesabıyla eşleşti. Rules özetin biçimini kontrol ediyor ve içeriği kayıtlı taslağa eşliyor; özeti kriptografik olarak yeniden hesaplamıyor. Rapor bu sınırı açıkça belirtiyor. Sonraki aşama bunu e-imza veya güvenilir dış doğrulama kanıtı olarak kullanmamalı.

## [GÜVENLİK VE XSS ANALİZİ]

**Yazar izolasyonu geçti.** `firestore.rules:765`, `:811` ve `:828` taslak/sürüm erişimini geçerli ortam üyeliği ve `ownerUid == request.auth.uid` koşuluna bağlıyor. Başka admin, bağlı başka personel ve anonim kullanıcı ile doğrudan içerik okuması reddedildi. Başka yazarı filtreleyen query reddedildi; diğer personelin kendi export'u hedef yazarın taslak/sürümünü getirmedi. Başlık sahipliği değiştirme ve sahte görev yazma da mevcut testlerde reddedildi.

**DOM sınırı geçti.** `src/ui/ebys-documents-ui.js:6` ortak üretici `textContent` kullanır; form `value`, önizleme yine metin düğümleriyle kurulur. KPI `:17` metin olarak yazılır. Konu, muhatap ve gövdeye şema katmanı atlanarak `<svg onload>`/`<img onerror>` girdileri verildi: önizlemede metin göründü, img/svg DOM öğesi oluşmadı, JavaScript çalışmadı.

`src/ui/ebys-documents-ui.js:132` sabit metni `showCustomConfirm` üzerinden geçirir; `{html:true}` kullanılmaz. `src/utils/alert.js:169` varsayılan metin yoludur. Gerçek kurumsal onay kutusunda iptal, formu değerleri korunarak geri getirdi; kabul, dondurma yoluna geçti.

Tam admin HTML'si ve yerel stillerle ortalanmış modal, iki kolon, 85vh sınırı, X/Escape/backdrop kapanışı, mobil tek kolon, kayıt sonrası kapanma, KPI gösterimi ve çıktı önizleme geçti. Görsel `scratch/ebys-stage4-audit-form.png` ayrıca incelendi. Tam yerleşim testinde dokuz sekme ana kapsayıcı içinde; altı sekme geçişi doğru, pageerror 0.

Oturum/dinleyici cleanup çağrısında satırlar ve açık evrak diyalogları kaldırılıyor. Bu kanıt izole UI fixture'ına aittir; gerçek Firebase Auth hesap geçişiyle uçtan uca UAT yapılmadı. Sunucudaki içerik izolasyonu ayrıca gerçek Rules emülatöründe sınandı.

## [KRİTİK BULGULAR]

### P0 / P1

Denetlenen Aşama 4 kapsamında saptanmadı. Bu sonuç yalnız incelenen kod ve test senaryolarını kapsar; bütün uygulama için sınırsız güvenlik veya regresyonsuzluk garantisi değildir.

### A4-01 — P2: Başka yazara ait rezervasyonla çakışmada yeniden deneme çalışmıyor

Kaynak: `src/services/ebys-document-service.js:87`, `:95`; `firestore.rules:834`.

Mevcut rezervasyon başka personele aitse `tx.get()` `permission-denied` ile durur. Servis yalnız `registration-collision` mesajını yeniden dener. Böylece rapordaki en fazla beş aday denemesi bu yazarlar arası durumda gerçekleşmez.

Kanıt: `scratch/ebys-stage4-audit-probes.test.mjs` son testi. Numara üreticisine yalnız testte başka yazarın mevcut numarası ilk aday olarak verildi. Bağlı personelin kayıt komutu `permission-denied` aldı; üretici çağrı sayısı 1, yeni belge numarası boş kaldı. Önceki rezervasyonun sahibi/belge bağlantısı değişmedi.

Etki: Veri ezilmesi veya içerik sızıntısı yok; çok düşük olasılıklı çakışma halinde kayıt işlemi kontrollü yeni aday yerine başarısız olur. Rastgele çakışma olasılığı ile hata yolunun eksikliği ayrı değerlendirilmiştir. Tek admin UAT'ında aynı yazar çakışmasının yeniden denemesi mevcut testte çalışmaktadır.

Kapanış: Başkasının rezervasyon içeriğini açmadan, çakışmayı güvenli biçimde yeni adayla ele alan bir rezervasyon/yeniden deneme sözleşmesi kur. Tüm `permission-denied` hatalarını körlemesine tekrar deneme; gerçek yetki reddi ile aday çakışmasının ayrımı korunmalı. İki farklı bağlı yazar, eşzamanlı komut ve immutable overwrite testlerini birlikte çalıştır.

### A4-02 — P2 / yayın engeli: Hosting kontrolü hâlâ başarısız

Kaynak: `scratch/hosting-files.js` beklenen dosya sayısı; `firebase.json` yayın kapsamı.

Bu denetimde **86** dosya bulundu, beklenen **81**. Desen dışı üç dosya `release-journal/index.html`, `release-journal/journal.js`, `release-journal/style.css`. Kalan iki dosyalık sayım farkı çalışma ağacındaki `src/modules/manual-exits.js` ve `src/utils/manual-exit-schema.js` ekleriyle uyumludur; bunlar EBYS denetim kapsamı dışındadır. Uygulama raporundaki 84 sayısı güncel ortak ağaç için artık geçerli değildir.

Etki: Yayın paketi kapısı yeşil değildir. Bu fark EBYS'nin yaratmış olduğu güvenlik açığı olarak sınıflandırılmadı; ancak mevcut ağaç için deploy GO verilemez.

Kapanış: Her dosyanın yayın kapsamını kararlaştır; bilinçli ekler için manifest/sayımı eşleştir ve kontrolü yeniden çalıştır. Dosyaları bu denetimde silme veya sayıyı sırf testi geçirmek için değiştirme yapılmadı.

### Aşama 5 öncesi açık uygulama kapıları

- Süreç kaydı sürümün mevcut korelasyon ID'siyle oluşturulmalı; immutable sürümün `processId` alanı sonradan yamalanmamalı.
- Görev yaratma, sıra değişimi, geçmiş karar erişimi ve sahte görev engeli birlikte `getAfter()` ve olumsuz emülatör testleriyle kanıtlanmalı.
- `listDocuments()` personel dalı (`src/services/ebys-document-service.js:106`) yalnız ownerUid + limit uygular; kind/cursor kullanmaz. Bugünkü kayıt defteri admin ekranındadır. Bu servisi ileride personel yön sekmeleri/sayfalaması için doğrudan kullanmadan sorgu ve index sözleşmesi tamamlanmalı.
- Tüm kullanıcılarla gerçek Auth/Firestore bağlantılı UAT ve canlı indeks hazırlığı ayrı yayın kapısıdır. Emülatör başarısı canlı indekslerin kurulmuş olduğunu göstermez.

## Kanıtlar ve denetim sınırı

| Kontrol | Nihai gözlem | Kanıt |
|---|---|---|
| `npm run test:unit` | 286 geçti, 0 hata | `scratch/ebys-stage4-audit-unit.log` |
| `npm run test:rules` | 237 geçti, 24 suite, 0 hata | `scratch/ebys-stage4-audit-rules.log` |
| XSS taraması | 65 dosya, 932 dinamik ifade; izinsiz 0 | `scratch/ebys-stage4-audit-xss.log` |
| Ek Rules/servis senaryoları | 12/12; 7 mevcut + 5 ek | `scratch/ebys-stage4-audit-probes.log` |
| UI/UX + zararlı metin deneyi | Geçti, pageerror 0, zararlı kod çalışması 0 | `scratch/ebys-stage4-audit-ui.log` |
| Tam admin yerleşimi | 9 sekme/6 geçiş geçti, pageerror 0 | `scratch/ebys-stage4-audit-layout.log` |
| Hosting | Başarısız; 86/81 | `scratch/ebys-stage4-audit-hosting.log` |
| `git diff --check` | Hata yok | Komut çıktısı |

Ek emülatör paketindeki son test, P2 çakışma hatasını yeniden ürettiği için geçer; bu davranışın kabul testi değildir. Diğer ek testler beklenen ret veya tekil başarılı kayıt sonucunu doğrular.

İlk tam Rules komutu dolu yerel port nedeniyle test başlamadan durdu; ikinci koşu 237/237 geçti. İlk ek UI deneyindeki test sorgusu `$eval` yerine `$$eval` gerektirdiği için düzeltildi; uygulama kodu değiştirilmedi. Nihai UI koşusu geçti. Testler demo emülatörleri ve izole yerel Chrome üzerinde yapıldı; canlı veri okunmadı/yazılmadı.

Çalışma ağacı eşzamanlı envanter/manuel çıkış değişikliklerini de içeriyor. Paket sayıları bu güncel ortak ağacı yansıtır. EBYS modülleri ve kuralların EBYS bölümü ayrıca incelendi; kapsam dışı düzenlemeler geri alınmadı. Tamamen temiz/izole checkout'ta yayın testi yapıldığı iddia edilmez. Kanıt manifestosu rapor anındaki kaynak/log hash'lerini tutar; satır numaraları bu yerel ağaç içindir.

## [NİHAİ KARAR VE PUAN]

**GO — Aşama 4 teknik kabulü ve Aşama 5 geliştirmesine geçiş. Puan: 92/100.**

Puanlama: veri bütünlüğü ve değişmezlik 29/30 (yazarlar arası çakışma hata yolu), yazar izolasyonu 30/30, DOM/UI güvenliği 20/20, teslim/yayın kanıtı 13/20 (Hosting kapısı ve gerçek Auth ile tam UAT eksikliği). Bu bir denetim değerlendirmesidir; istatistiksel güvenlik ölçümü değildir.

**Canlı deploy: NO-GO.** Hosting kapısı kapatılıp gerçek oturumlu UAT ve indeks/yayın kontrolleri tamamlanmadan yayın kabulü verilmez. Bu denetim kaynak kod düzeltmesi, commit veya deploy yapmadı. Teslim: rapor, ek denetim testleri, loglar, görsel ve `audits/test-baselines/2026-11-02_EBYS_Asama_4_Denetim_Kanit.json`.
