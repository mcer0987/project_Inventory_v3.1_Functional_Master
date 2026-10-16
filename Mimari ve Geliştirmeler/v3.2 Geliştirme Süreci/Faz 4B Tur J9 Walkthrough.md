# Faz 4B Tur J9: Sahiplik Alanları, Veri Göçü ve Kod Özeti Hazırlığı (4.6 · K4)

## Özet
J10 kuralları "bu kayıt kimin?" sorusunu ancak kayıtta bir **Firebase Auth uid**'si varsa cevaplayabilir. Bu tur:
1. Yeni kayıtlara sahiplik uid'lerini ekler ve bunları **değiştirilemez** yapar (istemci muhafızı + Firestore kuralı).
2. Eski kayıtlar için VIP **Sahiplik Göç Aracı**'nı ekler.
3. ~~J10 için tuzlu, KDF'li kod özeti~~ — GPT-6 kararıyla iptal edildi (bkz. §3).

GPT-6 denetim kuralları (UID kaynağı, göç aracının güvenliği) bağlayıcı kabul edildi.
Dal: `feat/phase-4b-identity-model`.

## 1. Sahiplik alanları

| Koleksiyon | Alan | Tür | Ne zaman yazılır |
|---|---|---|---|
| `requests` | `personelUid` | **sahiplik — değişmez** | Personel kendi hesabıyla talep açınca |
| `purchaseOrders` | `createdByUid` | **sahiplik — değişmez** | Personel kendi hesabıyla satın alma açınca |
| `tasks` | `creatorUid` | **sahiplik — değişmez** | Görevi açan hesap (personel ya da yönetici) |
| `tasks` | `assigneeUid` | türetilmiş | Oluşturma / yeniden atama (havuz → null) |
| `workflowTemplates.steps[]`, `purchaseOrders.workflow.steps[]` | `userUid` | türetilmiş | Şablon kaydı / akış başlatma |

**UID kaynağı (kural 1):** Uid'ler yalnız Auth'tan gelir.
- **Oturumun kendi uid'si:** `selfUid` yalnız personel hesabı oturumunda dolu, ve hesabın aktif kullanıcının personel kaydına bağlı olması gerekir. `actorUid` ise ek olarak yönetici hesabını da kabul eder.
- **J7'de Auth'un döndürdüğü `personel.uid`:** Ancak `authEmail` personel id'siyle tutarlıysa ve uid başka bir personelde yoksa güvenilir.
- Addan uid türetilmez. Ad, yalnız **tek** bir personeli işaret ediyorsa o personelin hesabına götürür.
- Belirsiz ad, hesapsız personel ve sistem/rol/havuz değerleri (`Admin`, `Sistem`, `pool`…) için uid **yazılmaz**, alan null kalır.
- Anonim (eski yol) ve yönetici oturumunda açılan talepte `personelUid` yazılmaz; göç aracı sonradan doldurur.

**Atanan ve onaylayıcı neden değiştirilebilir:** Görev yeniden atanabilir, şablon düzenlenebilir. Bu alanlar her seferinde
güncel personelden yeniden hesaplanır. Değişmez olan, kaydın **sahibi**dir.

### Değiştirilemezlik: iki katman
- **İstemci (`Ownership.ownerGuard`)**, veri katmanının üç yazma yolunda çalışır: `saveData`, `applyItemOps`, `runStockOps`.
  - Dolu sahiplik alanını farklı bir değerle yazmak → `owner-immutable` (yönetici dahil).
  - Tam yazmada alan gönderilmemiş ya da boş/null → eski değer **taşınır**; eski bir yerel kopya sahipliği silemez.
  - Var olan kayda ilk yazım yalnız yöneticiye açık → `owner-first-write`.
  - Yeni kayıtta yalnız oturumun kendi uid'si yazılabilir → `owner-uid-mismatch`.
  - Modül yüklenmemişse bu koleksiyonlara yazma kapalı (güvenli varsayılan).
- **Sunucu (`firestore.rules`)**, personel yazmaları için:
  - `ownerOnCreate`: yeni kayıtta alan yok ya da `request.auth.uid`.
  - `ownerUnchanged`: güncellemede alan aynen kalır; değiştirilemez, silinemez, sonradan eklenemez.
  - Yönetici kuralı bilerek kısıtlanmadı: göç aracı ve yedekten geri yükleme yönetici yazmasıyla çalışır. Yönetici yazmaları
    istemci muhafızından geçer; yedekten geri yükleme, yedeği birebir geri getirmek için muhafızı bilinçli olarak atlar.
  - Eski istemcilerle uyumlu: J9 öncesi istemci sahiplik alanı yazmaz ve yerel kopyası snapshot'tan geldiği için alanı korur.

## 2. VIP · Sahiplik Göç Aracı (kural 2)

| Kural | Uygulama |
|---|---|
| Yalnız yönetici | `planOwnershipMigration` / `applyOwnershipMigration` Firebase admin oturumu ister. Kurallar da personelin ilk yazımını reddeder (emülatörde kanıtlandı). |
| Önizleme yazmaz | Plan yerel veriden saf fonksiyonla çıkar. Test, önizleme sırasında hiçbir yazma fonksiyonunun çağrılmadığını sayar. |
| Çift isimde eşleme yok | Ad birden fazla personeli işaret ediyorsa (Türkçe harf katlamasıyla, ör. "ALİ VELİ" = "Ali Veli") `ambiguous` raporlanır, dokunulmaz. Kaynaklar farklı kişileri gösteriyorsa (eski kod A, ad B) `conflict`. |
| Eşzamanlı değişiklik | 1) Uygulama başında personel listesi sunucudan taze okunur, önizlemedekinden farklıysa **hiç yazmadan** durur. 2) Kayıtlar 100'lük `runTransaction` parçalarıyla yazılır: her kayıt transaction içinde yeniden okunur ve plan taze veriyle yeniden hesaplanır; önizlemedekiyle aynı değilse kayıt atlanır (`changed-since-preview`). Silinen ve bu arada doldurulan kayıtlar da atlanır. 3) Dayanılan personel kayıtları da transaction içinde doğrulanır. |
| Kısmi başarısızlık gizlenmez | Bir parça düşerse durur. Sonuç ekranı ve dönüş değeri **yazılan / atlanan (nedeniyle) / düşen / denenmeyen** sayılarını ayrı verir. Yazılanlar kalıcıdır; aracı yeniden çalıştırmak kalanları tamamlar. |
| Batch sınırı | Transaction başına en fazla 100 yazma (Firestore sınırı 500). |
| İdempotent | Dolu uid'ye asla dokunulmaz; ikinci çalıştırma 0 kayıt planlar. Dolu uid bugünkü hesaptan farklıysa `mismatch` olarak raporlanır, değiştirilmez. |

Eşleme önceliği şöyle:
- **Talep:** önce `personelId`. Bu alan yetkilidir; listede olmayan bir id ada **düşmez**. Sonra eski `personelKodu`, en son ad.
- **Satın alma:** önce `createdBy` (J8 sonrası personel id'si, J8 öncesi giriş kodu), sonra `createdByName`/`talepEden`.
- **Görev:** `creatorId` / `assigneeId` (adlar).
- **Adımlar:** `user` (ad).

Önizleme koleksiyon özeti, sorun türleri ve sorunlu satırları (kayıt etiketi, alan, neden, adaylar) gösterir. Giriş
kodları hiçbir yerde gösterilmez.

## 3. Kod özeti (iptal edildi)
Bu turda hazırlanan tuzlu PBKDF2 kod özeti yardımcısı (`code-hash.js`) GPT-6 kararıyla **iptal edildi**: Firebase Auth varken
kodun ayrıca Firestore'da özetlenmesi gereksiz bir çift kimlik doğrulama yaratıyordu. J10'da giriş doğrudan Firebase Auth
(`signInWithEmailAndPassword`) ile yapılır. Dosya ve testi commit edilmeden silindi.

## Değişen / yeni dosyalar
- Yeni: `src/utils/ownership.js`, `tests/unit/ownership.test.mjs`, `tests/integration/ownership.emu.test.mjs`
  (`npm run test:ownership:emu`).
- `firebase-handler.js`: muhafız ve göç aracının Firestore bağdaştırıcısı.
- `inventory-logic.js`, `purchase-servises.js`, `todo-module.js`, `edm-workflow.js`: yeni kayıtlarda uid alanları. Satın almada
  sahiplik denetimi önce uid'ye bakar.
- `admin-system-control.js` + `admin.html`: VIP "Sahiplik Göç Aracı".
- `firestore.rules` (+ 27 kural testi).
- `index.html` / `admin.html`: `ownership.js` etiketi. `hosting-files.js`: 54 → 55.

## Test sonuçları

| Paket | Sonuç |
|---|---|
| `npm run test:unit` | 102/102 (yeni: sahiplik 16) |
| `npm run test:rules` | 99/99 (yeni: 27 sahiplik kuralı) |
| `npm run test:ownership:emu` (yeni) | 6/6 |
| `npm run test:staff:emu` / `test:atomic:emu` | 11/11 · 5/5 |
| `node scratch/flow-tests.js --emu` | 54/54 (yeni `j9Ownership`) · 0 sayfa hatası · 0 CSP ihlali |
| `node scratch/flow-tests.js` (gerçek demo) | 54/54 · 0 sayfa hatası · 0 CSP ihlali |
| `npm run lint:xss` / `hosting-files.js` | 0 izinsiz · 55/55 |

**Emülatörde (gerçek Firestore + kurallar) kanıtlananlar:**
- Önizleme yazmıyor.
- Yalnız kesin eşlenen boş alanlara yazılıyor. Eski giriş koduyla açılmış talep doğru kişiye eşleniyor.
- Belirsiz ad, hesapsız personel, "Admin" adıyla açılmış görev ve "Sistem" adımı için uid yazılmıyor.
- Onaylanmış adımın diğer alanları korunuyor.
- Önizlemeden sonra sahibi değişen kayıt atlanıyor.
- Aynı adlı yeni personel eklenince göç hiç yazmadan duruyor.
- 2. parça düşünce ilk parça kalıcı kalıyor, kalanlar yazılmıyor ve yeniden koşu tamamlıyor.
- Personel oturumu göçü çalıştıramıyor (kural reddi).
- Göçten sonra personel sahiplik alanını değiştiremiyor ve tam yazmayla silemiyor.

**Tarayıcıda (`j9Ownership`) kanıtlananlar:**
- Hesaplı personel gerçek formlardan talep, satın alma ve görev açınca uid'ler oturumun Auth uid'si oluyor.
- Tam yazma sahipliği silmiyor.
- Değiştirme denemesi istemcide ve kuralda reddediliyor.
- Yönetici VIP aracıyla eski talebe uid ekliyor; tekrar açınca kayıt listede yok.
- Gerçek demoda yalnız önizleme ve istemci muhafızı sınandı; demoya hiçbir şey yazılmadı.

## J10 girdileri
1. **Giriş tasarımı:** Kodlar gizlenince "kod → kişi" araması istemcide yapılamaz → J10 kararı: önce kişi seçilir, kod Firebase Auth ile doğrulanır.
2. **Onay adımı yetkisi:** `steps[].userUid` türetilmiş ve bir liste içinde. Kurallar liste öğesinin değişmediğini kolayca
   denetleyemez; personel adımı onaylarken başka bir adımın `userUid`'sini değiştirebilir. Onaylar ayrı bir alana ya da
   koleksiyona taşınmalı, ya da kural yalnız `steps[currentStep]` alanlarına izin vermeli.
3. Şablon erişim listesi (`auth`, adlarla) uid'ye taşınmadı. Kurallarla zorlanacaksa J10'da ele alınmalı.
4. Paralel onay yapıları (`parallelConfigs`) şablon arayüzünden üretilmiyor; bu yapılarda uid yok.
5. Hesabı olmayan personel eski yoldan kayıt açmaya devam ettiği sürece göç aracı ara ara çalıştırılmalı (idempotent).
   `accounts` moduna geçince yeni kayıtlar kendiliğinden uid'li olur.
6. **Kural değişikliği deploy gerektirir.** Bu turdaki `firestore.rules` canlıya yalnız `firebase deploy --only firestore:rules`
   ile gider; sahibinin onayıyla yapılmalı.
