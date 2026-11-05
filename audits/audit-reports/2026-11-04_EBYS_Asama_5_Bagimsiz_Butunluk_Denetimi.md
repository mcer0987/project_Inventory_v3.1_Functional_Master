# v3.4 EBYS — Aşama 5 bağımsız güvenlik ve kod bütünlüğü denetimi

Tarih: 2026-11-04. Dal: `feat/v3.4-ebys-asama-5`. HEAD: `8a61a7ad4b5c49e6c467510e7e9a1e79cf8ec26d`.

**Karar: NO-GO — 80/100.** Bir P1 ve iki P2 doğrulandı; P0 tespit edilmedi. Puan nitel mühendislik değerlendirmesidir; test başarı yüzdesi değildir. P1 finans bulgusu kapanmadan Aşama 5 kabulü/yayını önerilmez.

Denetim mevcut çalışma ağacında yapıldı. Dalda önceden bulunan, EBYS dışı geliştirmeleri de içeren commit edilmemiş değişiklikler korunmuştur. `firestore.rules`, `ebys-process-service.js`, `ebys-process-ui.js`, `purchase-access.js` ve `ebys-document-service.js` denetim sırasında HEAD ile aynıydı. Bu denetim üretim kodunu değiştirmedi; yalnız rapor, kanıt ve bağımsız test dosyaları oluşturdu. Commit/deploy yapılmadı. Sonuçlar yerel kurallara aittir; canlı dağıtımın aynı dosyaları kullandığı ayrıca iddia edilmez.

## [KURAL SIZDIRMAZLIK VE EXPLOIT ANALİZİ]

### Doğrulanan korumalar

- `firestore.rules:831–835`: sürüm okuması yazar veya `epAccess` üzerinden verilir; sürüm update/delete kapalıdır. Yeni koleksiyonlar genel `knownCol` izinlerine dahil değildir.
- `firestore.rules:925–930`: deterministik görev yolu, aktif süreç/görev eşleşmesi ve sunucu zamanı veya gerçek karar geçmişiyle erişim verir. Gelecek imzacının tekil sürüm okuması, belge kimliğiyle daraltılmış sürüm sorgusu ve geniş görev/sürüm sorguları reddedildi.
- `firestore.rules:978–990`, `1006–1014`, `1021–1044`: süreç revizyonu, mevcut aktif aktör, işlem/olay ve görev değişiklikleri atomik bağlanır. `decisionsByStep` yalnız mevcut adım için büyüyebilir; aktör, asıl kişi, sürüm ve karar zamanı birebir doğrulanır. Geçerli bir karar işleminin içine eklenen sahte gelecek karar, başka aktör/asıl kişi ve yanlış `hasDecision` bayrağı reddedildi. Önceki kararın değiştirilmesi ve tek başına görev yaratma mevcut testlerde reddedilir.
- `firestore.rules:1031–1035`: yeni aktif görevin başlangıcı `request.time`, bitişi en fazla sunucu zamanından 90 gün sonradır. Delegasyonda `assigneeUid` gerçek vekil; `principalUid` rota kişisidir. Gerçek vekâlet sonrası süre sonu geçirilmiş görev için okuma, karar ve aynı kararda süreyi uzatma saldırıları reddedildi. İstemci saati tek başına `request.time` koşulunu değiştiremez.
- Normal ilk onaydan sonra satın alma kur alanlarının değiştirilmesi mevcut testlerde reddedildi. `purchaseFinance` update/delete doğrudan kapalıdır (`firestore.rules:891`). Buna rağmen ilk snapshot'ın hangi talebe ait olduğu A5-01 nedeniyle güvenilir değildir.

### İfade ve erişim bütçesi

Tam Rules paketindeki altı farklı imzacı, personel yazar, manuel/şablon rota ve ardışık kararlar geçti. Ek denetimde aynı UID'ye altı ardışık karar ve altı adımlı rotanın son adımında geçmiş kararı bulunan kişiye vekâlet + terminal red geçti. Bu işlemler gerçek emülatör kuralları altında yürütüldü; işlem yazmaları için güvenlik kuralları devre dışı bırakılmadı. Devre dışı bağlam yalnız test başlangıç verisi ve süre sonu fixture'ı için kullanıldı.

Bu senaryolarda 1000 ifade / belge erişim bütçesi aşımı gözlenmedi. **Kesin ifade sayısı veya kalan güvenlik payı ölçülmedi; bütün olası payload'lar için matematiksel üst sınır kanıtı verilmez.** Firebase, istek başına 1000 ifade; tek işlem için 10, batch/transaction için toplam 20 belge erişim çağrısı sınırı tanımlar. Bazı çağrılar önbellekten karşılanabilir. Bu sınırlar yalnız Spark'a özgü değildir. Kaynak: [Firebase kotaları](https://firebase.google.com/docs/firestore/quotas#security_rules).

## [MİMARİ VE KODLAMA BÜTÜNLÜĞÜ]

- İncelenen yeni süreç servisi veri erişimini ve transaction'ları taşır; `ebys-process-ui.js` servis API'sini çağırır. UI içine Firebase SDK yazması veya servis içine DOM işlemi bulunmadı. Vanilla ESM, No-Build ve `AppModules` yapısı korunuyor.
- `versionId = processId` ve `{processId}__{uid}` görev kimliği tutarlı. Aynı kişinin tekrar atanması ayrı `decisionsByStep` girdileriyle önceki kararı koruyor. Yeni sürümün ayrı süreç/görev kimliği olması eski kararın yeni içeriğe otomatik erişim vermesini engelliyor.
- `purchaseAccess` keşif eşlemesidir; gerçek `purchaseOrders` okuması `lpRead` ile yeniden denetlenir. Bayat eşleme tek başına okuma yetkisi vermez. Ancak geri çekmede geçmiş yetkinin kaybolduğu A5-02 doğrulandı.
- Normal kapanış zincirinde `firebase-handler.js:387–395` kayıtlı unsubscribe fonksiyonlarını çağırır. `purchase-access.js:17` ana ve alt dinleyicileri temizler; `ebys-process-ui.js:164` kuyruk, kart bağlamları ve evrak modallarını kapatır. Kontrollü tarayıcı testinde yeniden çizim eski 50 kart dinleyicisini temizledi; kuyruk kapanışında ana/alt sayaçları sıfırlandı. Gerçek Firebase Auth ile uçtan uca yeniden giriş testi bu denetimde ayrıca yürütülmedi.
- Sorgu hata dalında kart dinleyicileri temizlenmiyor (A5-03). Normal logout temizliğinin çalışması bu hata dalını güvenceye almıyor.
- `npm run lint:xss`: 69 dosya, 204 sink, 947 dinamik ifade, izinsiz 0. Gerçek UI modülüne verilen HTML saldırı metni tarayıcıda düz metin olarak kaldı; `pageerror=0`.

## [AŞAMA PLANI UYUMU]

Zorunlu referans: `2026-10-30_v3.4_EBYS_Genisleme_Is_Plani.md:104–118`; uygulama beyanları: `2026-11-03_EBYS_Asama_5_Uygulama_Raporu.md`.

Aktif görev, paraf/onay/olur ayrımı, gerekçeli red/iade, geri çekme, yeni sürümle yeniden sunma, vekâlet, kişisel kuyruk ve sürüm bazlı yetki Aşama 5 hedeflerine karşılık geliyor. Sürecin `completed`, evrak başlığının `internally_approved` olması kurum içi onayın tamamlanmasıdır; icra tamamlanması olarak değerlendirilmedi.

Havale, icra görevi, outbox/e-posta ve gerçek iş kapanışı Aşama 6; QR/doğrulama Aşama 7; resmi e-imza/KEP/e-Devlet entegrasyonları Aşama 8 kapsamında bırakıldı. Bunlar bulgu değildir. Kabul edilmiş üç kalem sınırı, sunucuda kuruş doğrulaması yapılmaması ve manuel kur beyanı da bulgu değildir. A5-01, manuel kur kullanımını değil, beyan edilen merkezi snapshot sözleşmesinin başka kayıt üzerinden aşılmasını gösterir.

## [BULGULAR TABLOSU]

| Kimlik | Öncelik | Kod | Somut risk ve kanıt |
|---|---|---|---|
| A5-01 | **P1** | `firestore.rules:248–253`, `266–280`, `293–324`, `880–890` | Finans yolu gerçek belge kimliği yerine yazılabilir gövde `id` alanından hesaplanıyor. Başka talebin mevcut finans kaydı ilk onaya dayanak olabiliyor; yeni talebin kendi snapshot'ı ve güncel merkez ayarı denetimi atlanıyor. |
| A5-02 | **P2** | `firestore.rules:334`, `893–900` | Geri çekme `workflow.steps=[]` gerektiriyor; geçmiş okuma yetkisi ise yalnız bu dizideki onay/red statülerinden hesaplanıyor. Önceden onay veren kişinin geçmiş erişimi kayboluyor. |
| A5-03 | **P2** | `src/ui/ebys-process-ui.js:151–161` | Sayfa yükleme hatasında `stopRender` çağrılmadan kartlar DOM'dan kaldırılıyor. Önceki kartların süreç dinleyicileri kapanışa veya sonraki başarılı veriye kadar açık kalıyor. |

### A5-01 — Başka talebin finans snapshot'ını kullanma

Önkoşul: bağlı talep sahibi ve sıradaki yetkili onaylayıcı; bilinen mevcut finans snapshot'ı. Yönetici yetkisi gerekmiyor. Bu bir gelecekteki imzacının sıra atlama açığı değildir; talep kimliği/finans ilişkisi bütünlüğü açığıdır.

Emülatör tekrarı:

1. `historical` talebi normal, kurallara tabi atomik onayla USD=30, tarih `2026-10-01`, kaynak `Eski beyan` snapshot'ı alır.
2. Merkezi ayar USD=40, tarih `2026-11-04`, kaynak `Yeni beyan` olur.
3. Talep sahibi `/purchaseOrders/items/actual-new` yoluna `id: 'historical'` gövdesiyle yeni taslak oluşturur ve normal başlangıç koşullarıyla onaya sunar. İki yazma da Rules tarafından kabul edilir.
4. Sıradaki onaylayıcı doğrudan SDK ile yalnız `actual-new` talebini onaylar; eski snapshot'ın alanlarını gönderir. İşlem kabul edilir.
5. `actual-new.exchangeRate.USD === 30`; `/purchaseFinance/items/actual-new` **yoktur**. Yeni finance yazılmadığından `financeSource` bu onay için çalışmamıştır.

Mevcut immutable finans kaydı değiştirilmedi; yanlış talebe referans verilerek güvenlik koşulu aşıldı. Bu nedenle yalnız `purchaseFinance` update/delete yasağını kontrol etmek yeterli değildir.

Düzeltme kabulü: finans kontrolüne gerçek `docId` aktarılmalı; satın alma gövde kimliği gerçek yol ile bağlanmalı ve değişmez tutulmalı. Eski sayısal kimliklerde uyumlu normalizasyon korunmalı. İlk snapshot gerektiren geçişte aynı talebe ait yeni atomik snapshot zorunlu kılınmalı; farklı/eski kimliğe referans veren doğrudan SDK yazması reddedilmeli. Düzeltilmiş Rules altında ağır legacy onay ve üç kalem testleri yeniden çalıştırılmalı.

### A5-02 — Geri çekmede eski onaylayıcının erişimini kaybetmesi

Emülatörde kalemli TRY talebi normal atomik ilk onaydan geçti. Onaylayıcı talebi okuyabildi. Sahibi geçerli geri çekme işlemini uyguladı. Kur/history kayıtları ve mali içerik korunduğu halde önceki onaylayıcının okuması `permission-denied` oldu. Sebep: yetki için kullanılan adımlar geri çekmede boşaltılıyor. Uygulama raporunun geçmiş onay/red ilişkisiyle erişim beyanı bu dal için sağlanmıyor.

Düzeltme kabulü: geçmiş erişim, temizlenen aktif rota yerine doğrulanmış ve değişmez karar/sürüm kaydına bağlanmalı. Çözüm olarak düzenlenebilir güncel legacy talep bütün eski onaylayıcılara açılmamalı; yalnız karar verdikleri içeriğe erişim korunmalı. Geri çekme → eski onaylayıcı okuması → olası yeni sürümde erişim sınırı için test eklenmeli.

### A5-03 — Kuyruk hatasında boşa çalışan dinleyiciler

Gerçek `ebys-process-ui.js`, sayımlı servis taklitleriyle başsız Chrome'da çalıştırıldı. 50 aktif kart çizildi; yeniden çizim sayıyı 50'de tuttu. Sonraki sayfa isteğinde sorgu hata callback'i çağrıldığında ekranda yalnız hata metni kalmasına rağmen 50 `watchTaskContext` aboneliğinin unsubscribe fonksiyonu çağrılmadı. Kuyruk kapanışında sayı 0'a indi. Bu kontrollü UI yaşam döngüsü kanıtıdır; canlı ağdaki dinleyici sayısı ölçümü değildir.

Düzeltme kabulü: yeni sayfa yüklemesi ve hata durumunda eski `stopRender` çağrılmalı, referansı temizlenmeli; hata/yeniden deneme/oturum kapanışı yolları idempotent temizlenmeli. Spark ortamında gereksiz dinleyici ve okuma yükü oluşması önlenmeli.

## Test ve kanıt kaydı

| Kontrol | Sonuç | Kanıt |
|---|---|---|
| `npm run lint:xss` | Başarılı, izinsiz 0 | `scratch/ebys-stage5-audit-xss.log` |
| `npm run test:unit` | 289/289 | `scratch/ebys-stage5-audit-unit.log` |
| `npm run test:rules` | 261/261 | `scratch/ebys-stage5-audit-rules.log` |
| Ek güvenlik/bütçe senaryoları | 5/5 beklenen davranış | `scratch/ebys-stage5-audit-probes.log` |
| Finans kimliği açığı | Tekrar üretildi | `scratch/ebys-stage5-audit-finance-probes.log` |
| Geri çekmede geçmiş erişim kaybı | Tekrar üretildi | `scratch/ebys-stage5-audit-finance-probes.log` |
| UI yaşam döngüsü ve XSS | Hata dalındaki sızıntı tekrar üretildi; normal kapanış/XSS kontrolü geçti | `scratch/ebys-stage5-audit-lifecycle.log` |

Ek testlerde `AUDIT REPRO` isimli testlerin geçmesi **açığın varlığını doğrular**, güvenli davranış anlamına gelmez. İlk ek koşuda 5 güvenlik/bütçe kontrolü ve 1 açık tekrarı; ikinci koşuda aynı finans açığı ve ek geçmiş erişim tekrarı çalıştırıldı. Toplam 7 benzersiz emülatör senaryosu vardır.

Test ortamı `demo-*` proje kimlikleriyle yalnız yerel emülatördür. CLI'ın başlangıçtaki varsayılan açık kural uyarısından sonra her test ortamı `initializeTestEnvironment({firestore:{rules:readFileSync('firestore.rules')}})` ile incelenen dosyayı yükler. Ret testleri de kuralların etkin olduğunu doğrular. UAT emülatörünün verisi sıfırlanmadı.

Tekrar çalıştırma:

```powershell
npx firebase emulators:exec --config tests/rules/firebase.rules-test.json --only firestore --project demo-stage5-audit 'node --test --test-name-pattern=AUDIT --test-reporter=spec scratch/ebys-stage5-audit-process.test.mjs scratch/ebys-stage5-audit-finance.test.mjs'
node scratch/ebys-stage5-audit-lifecycle.cjs
```

Dosya SHA-256 kayıtları ve test özetleri: `audits/test-baselines/2026-11-04_EBYS_Asama_5_Denetim_Kanit.json`.

## [NİHAİ KARAR VE PUAN]

**NO-GO — 80/100.** Yeni evrak görev motorunun temel yetki izolasyonu ve denenmiş altı adımlı akışları çalışıyor. Buna rağmen satın alma finans sözleşmesi doğrudan SDK ile aşılabildiği için güvenlik kabulü verilemez. A5-01 düzeltmesi ve negatif regresyon testi zorunludur; A5-02/A5-03 de Aşama 5 kapanışında giderilmelidir. Mevcut testlerin yeşil olması, bu üç yeni senaryo nedeniyle mevcut altyapının hiç bozulmadığını teyit etmeye yetmez.
