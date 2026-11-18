# H8 · Birleşik Kabul, Kurtarma Tamamlama ve Spark Kapanış Kanıtı — walkthrough

**Tarih:** 18 Kasım 2026 · **Dal:** `feat/v3.7-ebys-h5-h7-yazisma-takip` · **Durum:** Uygulandı, tüm kalite kapıları yeşil ve commit ile mühürlendi.
**Kapsam:** H6b (katalog) ve H7 (yazışma) koleksiyonlarının kişisel kopya manifestosuna ve kurumsal kurtarma aracına eklenmesi; emülatörde tek uçtan uca birleşik kabul ve kurtarma testi; Spark okuma/yazma ölçümü; H0–H8 kapanış matrisi.
**Kapsam dışı:** İP-9 rehber sadeleştirmesi (`src/ui/ebys-showcase-modal.js`, `2026-11-07_EBYS_Rehberi_Revizyon_Taslagi.md`), Aşama 8 (e-imza, EYP, KEP, e-Devlet/kurum API), Storage dosya yükleme, `firebase deploy`, `git push`.

## İçindekiler

1. [Değişen ve eklenen dosyalar](#1-değişen-ve-eklenen-dosyalar)
2. [Dilim 1 · Kişisel kopya manifestosu ve kurumsal kurtarma aracı](#2-dilim-1--kişisel-kopya-manifestosu-ve-kurumsal-kurtarma-aracı)
3. [Dilim 2 · Emülatörde birleşik kabul ve kurtarma testi](#3-dilim-2--emülatörde-birleşik-kabul-ve-kurtarma-testi)
4. [Negatif güvenlik ve kurtarma bulguları](#4-negatif-güvenlik-ve-kurtarma-bulguları)
5. [Ölçümler ve Spark kota değerlendirmesi](#5-ölçümler-ve-spark-kota-değerlendirmesi)
6. [Kalite kapıları](#6-kalite-kapıları)
7. [Bilinen sınırlar ve açık riskler](#7-bilinen-sınırlar-ve-açık-riskler)
8. [H0–H8 nihai kapanış matrisi](#8-h0h8-nihai-kapanış-matrisi)
9. [Yerelde yeniden çalıştırma](#9-yerelde-yeniden-çalıştırma)

## 1. Değişen ve eklenen dosyalar

| Dosya | Durum | Değişiklik |
|---|---|---|
| `src/services/ebys-document-service.js` | Değişti | `EBYS_COLLECTION_REGISTRY` listesine 5 H6b katalog koleksiyonu eklendi. `exportOwnDocuments()` bu 5 koleksiyonu manifestoda `excluded` / `institutional-catalog-definition` olarak işaretliyor. |
| `tools/ebys-local-recovery.mjs` | Değişti | Katalog ve yazışma şemaları sandbox'a yüklendi. `recoveryCollections` listesine 8 koleksiyon eklendi (H6b 5 + H7 3). `validateLinks` artık `async`; yeni `validateCatalog` ve `validateCorrespondence` denetimleri eklendi. |
| `tests/rules/helpers/ebys-purchase-harness.mjs` | Değişti | `actor()` bağlamı katalog ve yazışma şema/servislerini de yüklüyor (`catalog`, `correspondence`). Spark ölçümü için `getDocsFromServer` sarmalandı (`metrics.queries`). Mevcut H4 testleri değişmeden geçiyor. |
| `tests/rules/ebys-h8-acceptance.test.mjs` | Yeni | Tek bütünleşik kabul + kurtarma testi (bkz. §3). |
| `Mimari ve Geliştirmeler/…/2026-11-18_EBYS_H8_Birlesik_Kabul_ve_Kurtarma_Walkthrough.md` | Yeni | Bu belge. |
| `scratch/ebys-h8-evidence/recovery-measurements.json` | Yeni (git dışı, `scratch/` yok sayılır) | Test çıktısı: belge sayıları, capture/preview/restore istatistikleri, senaryo bazlı Spark özeti. |

Kurallar (`firestore.rules`), indeksler, arayüz ve rehber dosyaları değişmedi. Satır sonları LF olarak korundu (`git ls-files --eol -m`: üç değişen dosya `i/lf w/lf`).

## 2. Dilim 1 · Kişisel kopya manifestosu ve kurumsal kurtarma aracı

### 2.1 Kişisel kopya (`exportOwnDocuments`)

Kişisel evrak kopyası kurum tanımlarını kopyalamaz. Evrakın kullandığı künye, dosya planı adı ve şablon sürümü zaten taslak ve sürüm kaydının içinde kopya olarak bulunur. Manifesto artık kayıt defterindeki her EBYS koleksiyonunun durumunu gösteriyor:

| Koleksiyon grubu | Manifestodaki durum |
|---|---|
| `ebysOrganizations`, `ebysOrganizationRevisions`, `ebysFilePlans`, `ebysLetterTemplates`, `ebysLetterTemplateRevisions` | `excluded` · kapsam `institutional-catalog` · gerekçe `institutional-catalog-definition` |
| `ebysReplyLinks` | `included` · cevabın veya hedefin sahibi |
| `ebysDispatches` | `included` · evrak sahibi veya kaydı giren |
| `ebysIncomingKeys` | `excluded` · `derived-lookup-key` (önceden olduğu gibi) |

H1/H4/A6/H7 testleri değişmeden geçti.

### 2.2 Kurumsal kurtarma aracı (`tools/ebys-local-recovery.mjs`)

Kurtarma paketi artık H6b ve H7 kayıtlarını da taşıyor. Geri yüklemeden önce bunların bütünlüğü denetleniyor. Bu kayıtlar pakette yoksa yeni denetimler hiçbir şey yapmaz, bu yüzden eski H1/H4 paketleri aynı şekilde çalışır.

| Kayıt | Denetim |
|---|---|
| `ebysOrganizations` | `id = primary`, geçerli `updatedAt`, `revision ≥ 1`, `normalizeProfile` geçer; `1..revision` arası her revizyon pakette var. |
| `ebysOrganizationRevisions` | `id = String(revision)`, geçerli `createdAt`, `normalizeProfile(profile)` geçer; güncel künyenin revizyonunu aşamaz; güncel revizyonun profili künyeyle birebir aynı. |
| `ebysFilePlans` | `id = code`, iki tarih geçerli, `revision ≥ 1`, `normalizeFilePlan` geçer. |
| `ebysLetterTemplates` | UUID kimlik, iki tarih geçerli, `currentRevision` ve `revision ≥ 1`; `1..currentRevision` arası sürümlerin hepsi var; güncel sürümün adı şablon adıyla aynı. |
| `ebysLetterTemplateRevisions` | `id = revisionId(templateId, revision)`, geçerli `createdAt`, `normalizeTemplate` geçer; üst şablonun `currentRevision` değerini aşamaz. |
| Taslak/sürüm katalog kopyaları | `institutionSnapshot` → ilgili künye revizyonu var, 6 alan birebir aynı. `letterTemplate` → şablon sürümü var, ad aynı. Sürüm (v1) `filePlanTitle` → `normalizeFilePlan` geçerli, plan kaydı var; plan güncellenmemişse (`revision === 1`) ad birebir aynı (`revision > 1` ise tarihsel ad `contentDigest` ile mühürlüdür). Taslakta yalnız planın varlığı aranır. |
| `ebysReplyLinks` | `normalizeReplyLink` geçer, `id = replyDocumentId`; cevap `outgoing/internal` ve sahibi tutarlı; hedef `incoming`, kayıt numaralı, dondurulmuş, sahibi tutarlı; hedef sürüm hedef evraka ait; `replyToSummary` hedef sürümün üstverisiyle birebir (`canonical`). |
| `ebysIncomingKeys` | 64 hex anahtar, `id = key`; evrak `incoming`, sahip/birim/kayıt no eşleşiyor; anahtar, evrakın taslak veya sürümlerinden birinin üstverisinden `incomingDuplicateKey` ile yeniden üretilebiliyor. |
| `ebysDispatches` | `id` tutarlı, `normalizeDispatch(d, createdAt günü)` geçer (gönderim tarihi kayıt gününden sonra olamaz); evrak `outgoing`, kayıt numaralı, onaylı/kapalı/arşivde; sürüm o evraka ait. |

`validateLinks` artık `async`, çünkü `incomingDuplicateKey` SHA-256'yı Web Crypto ile hesaplıyor. `captureRecovery` ve `restoreRecovery` bu fonksiyonu `await` ile çağırıyor.

**`MAX_DOCUMENTS`:** Birleşik senaryonun paketi **114 belge** (73.158 bayt). 300 sınırının yaklaşık %38'i kullanılıyor, bu yüzden sınır değiştirilmedi.

## 3. Dilim 2 · Emülatörde birleşik kabul ve kurtarma testi

`tests/rules/ebys-h8-acceptance.test.mjs` tek bir test içinde gerçek servisleri (vm) ve `firestore.rules` kurallarını Firestore emülatöründe (`127.0.0.1:8180`) çalıştırıyor. Kaynak proje `demo-ebys-h8-source`, hedef proje `demo-ebys-h8-target`. Test, `incoming__unit` (sorumlu `e`) ve `outgoing__unit` (sorumlu `f`) icra politikalarını kendisi ekliyor. Anahtar biçimi `ebys-execution-service.js` içindeki `policyKey(kind, unitId)` ile aynı.

| Adım | Ne doğrulanıyor |
|---|---|
| 1 · H6b katalog | Yönetici künye v1 (`MED`), dosya planı `100` ve üst yazı şablonu v1 kaydediyor. Personel plan yazmaya çalışınca reddediliyor. |
| 2 · Satın alma | 3 kalemli TRY/USD/EUR talep: taslak → kesin kayıt → dondurma → 2 adımlı sıralı rota (paraf + onay). Önizleme 2.317,23 TRY. İlk olumlu kararda kur kilitleniyor (USD 35, EUR 40). Kur 37/42'ye değişip ikinci onay verildikten sonra mali kayıt birebir aynı kalıyor. Son onayda tek icra işi açılıyor (`worker`); iş kabul edilip tamamlanıyor. QR üretiliyor, yönetici arşivliyor (QR durumu `archived`). |
| 3 · Gelen evrak | Şablon + plan + künye v1 kopyasıyla taslak oluşturuluyor; kesin kayıt alınıyor; `registerIncomingKey` sonucu `registered`. Evrak donduruluyor, onaylanıyor, icra (`e`) tamamlanıyor, durum `closed`. |
| 3 · Mükerrer koruması | İkinci aktör (`c`) `"  SAĞLIK BAKANLIĞI. "` / `e.12345-67` / aynı tarihle sorgulayınca `duplicate: true` alıyor ve aynı anahtar dönüyor. Dönen kayıtta yalnız 5 alan var, içerik yok. Kendi gelen evrakı için `registerIncomingKey` sonucu `already-taken`. Anahtarın üzerine doğrudan yazma `permission-denied` ile reddediliyor; anahtar ilk evrakı göstermeye devam ediyor. |
| Künye v2 | Yönetici künyeyi v2'ye güncelliyor (adres). Yeni evrak v2 kopyasını alıyor. |
| 4 · Cevap + gönderim | "İlgi:" satırlı giden cevap taslağı (künye v2 + plan + şablon). `createReplyLink` özeti hedef sürümle birebir; tekrar çağrı aynı bağı döndürüyor; başka aktörün yanlış yöndeki bağ denemesi reddediliyor. Kesin kayıt → dondurma → 2 adımlı onay → `internally_approved` → icra sorumlusu `f` atanıyor. `f` `hand` ve `kep` başlangıç kayıtlarını, sahip `d` gerekçeli `correction` kaydını giriyor. Aynı `operationId` ile tekrar çağrı ikinci kayıt açmıyor; aynı kimlikle farklı içerik reddediliyor; ileri tarih ve gerekçesiz düzeltme reddediliyor. `listDispatches` = 3. İcra tamamlanıyor, QR üretiliyor. |
| Plan güncellemesi | Plan `100` pasife alınıyor (revizyon 2, ad aynı). Dondurulmuş gelen evrak sürümü birebir aynı ve künye v1 kopyasını taşıyor; künye revizyon 1 kaydı değişmemiş. |
| 5 · Kişisel kopya | Yazar (`d`): kayıt defterindeki bütün EBYS koleksiyonları manifestoda var; 5 katalog koleksiyonu `excluded`; `ebysReplyLinks` 1, `ebysDispatches` 3 (`included`); QR yalnız kendi evrakı. Gönderimi giren (`f`): `ebysDispatches` 2. Satın alma sahibi: `schemaVersion 3`, `referenced 2 / included 2`, mali kayıt USD 35, QR `archived`. |
| 6 · Kurtarma provası | `captureRecovery` paketinde katalog sayıları `[1, 2, 1, 1, 1]`, H7 sayıları `[1, 1, 3]`, satın alma `1 + 1`. Önizlemede yazma yok. 9 bozuk paket reddediliyor (§4). `restoreRecovery({ apply: true })` 114 belgeyi yazıyor. Hedefte `getPurchaseView` (kilitli kur), `getReplyContext` (iki yön), `listDispatches` (3), `loadCatalog` (künye r2, pasif plan, şablon r1) ve `checkIncomingDuplicate` çalışıyor. Anonim kullanıcı iki QR kaydını yalnız 5 alanla okuyabiliyor; cevap bağı ve gönderim kaydı anonime kapalı. Dolu hedefe ikinci yazma `Hedef dolu` ile reddediliyor. |

## 4. Negatif güvenlik ve kurtarma bulguları

Her bozuk paketin özeti test içinde yeniden hesaplanıyor. Böylece ret özet uyuşmazlığından değil, hedeflenen bütünlük denetiminden geliyor. Her senaryo kendi hata mesajıyla eşleştiriliyor.

| # | Bozulma | Beklenen ret mesajı | Sonuç |
|---|---|---|---|
| 1 | `ebysOrganizationRevisions/1` pakette yok | `Eksik paket ilişkisi: ebysOrganizationRevisions` | Reddedildi |
| 2 | Güncel künye revizyonu (r2) profili tahrif | `…güncel künyeyle uyuşmuyor` | Reddedildi |
| 3 | Eski künye revizyonu (r1) profili tahrif | `…künye kopyası revizyonla uyuşmuyor` | Reddedildi |
| 4 | `ebysLetterTemplateRevisions` pakette yok | `Eksik paket ilişkisi: ebysLetterTemplateRevisions` | Reddedildi |
| 5 | `ebysFilePlans/100` (`revision: 1`) başlığı sürümdeki `filePlanTitle` ile uyuşmuyor | `…dosya planı katalogla uyuşmuyor` | Reddedildi |
| 6 | `ebysReplyLinks.replyToSummary.subject` tahrif | `…İlgi özeti hedef sürümle uyuşmuyor` | Reddedildi |
| 7 | `ebysIncomingKeys` anahtarı başka bir hash ile değiştirildi | `…üstverisinden üretilmemiş` | Reddedildi |
| 8 | `ebysDispatches.documentId` gelen evraka çevrildi | `Gönderim kaydının evrakı geçersiz` | Reddedildi |
| 9 | `ebysDispatches.sentDate` = kayıt günü + 1 | `Gönderim kaydı geçersiz` | Reddedildi |

Canlı kural tarafında doğrulanan retler: personelin dosya planı yazması, başka aktörün mükerrer anahtarını ezmesi, anonimin cevap bağı ve gönderim kaydı okuması `permission-denied` ile reddedildi. Servis tarafında reddedilenler: farklı içerikle aynı gönderim kimliği, ileri tarihli gönderim, gerekçesiz düzeltme, gelen evrakı cevap olarak bağlama.

## 5. Ölçümler ve Spark kota değerlendirmesi

Kaynak: `scratch/ebys-h8-evidence/recovery-measurements.json` (son çalışma `2026-11-18T11:40:17Z`; tek başına ve tam paketle yapılan iki çalışmada değerler aynı çıktı).

### 5.1 Kurtarma aracı (REST, yalnız emülatör)

| Aşama | İstek | Okunan belge | Yazılan belge |
|---|---|---|---|
| `capture` (iki eşleşen tarama + bağlı satın alma kayıtları) | 64 | 228 | 0 |
| `preview` (boş hedef denetimi) | 32 | 0 | 0 |
| `restore` (tek atomik commit + yazma sonrası tarama) | 65 | 114 | 114 |

Paket: 114 belge, 73.158 bayt (sınırlar: 300 belge, 8 MB).

### 5.2 Senaryo bazlı servis okuma/yazma

Bu sayılar servisin yaptığı tekil okumaları, transaction okumalarını ve sorgu sonuçlarını (boş sorgu = 1) ve kesinleşen yazmaları içerir. Test doğrulama okumaları dahil değildir.

| Senaryo | Okuma | Yazma | Transaction |
|---|---|---|---|
| H6b katalog (künye v1+v2, plan + pasifleştirme, şablon) | 7 | 8 | 5 |
| Satın alma → onay → kur kilidi → icra → QR → arşiv (kur değişimi dahil) | 49 | 42 | 10 |
| Gelen evrak → kayıt → anahtar → onay → icra | 34 | 29 | 8 |
| Mükerrer kontrolü + ikinci kayıt + `already-taken` | 11 | 8 | 3 |
| Cevap + bağ + onay + 3 gönderim (tekrar ve retler dahil) + icra + QR | 67 | 40 | 17 |
| Kişisel kopya (3 kullanıcı) | 103 | 0 | 0 |
| Geri yüklenen hedefte okumalar | 18 | 0 | 0 |
| **Servis toplamı** | **289** | **127** | |
| Kurtarma provası (capture + preview + restore) | 342 | 114 | |
| **Genel toplam** | **631** | **241** | |

### 5.3 Spark günlük kota değerlendirmesi

Spark sınırları günlük **50.000 okuma** ve **20.000 yazma**dır.

- Birleşik senaryonun tamamı (4 evrak, katalog, kişisel kopya, kurtarma provası dahil) günlük okuma kotasının **%1,26**'sını (631 / 50.000), yazma kotasının **%1,21**'ini (241 / 20.000) kullanıyor.
- Kurtarma provası, kişisel kopya ve hedef okumaları hariç beş iş akışı (katalog, satın alma, gelen, mükerrer, cevap + gönderim) 168 okuma / 127 yazma tutuyor. Okuma kotası bu akış setinden günde yaklaşık **297** tane, yazma kotası yaklaşık **157** tane karşılar. Yazma tarafı önce dolar. Tek evrak başına yazma yaklaşık 29 (gelen) ile 42 (satın alma) arasında olduğundan, günlük üst sınır yazma kotasıyla kabaca **475–690 tam evrak yaşam döngüsü**dür.
- Kurtarma aracı yalnız `127.0.0.1` emülatörüne bağlanır, canlı kotayı harcamaz. Kurum ölçeği 300 belgeye ulaştığında bile bir prova yaklaşık 600 okuma + 300 yazmadır.
- **Not:** Rules `get()` / `exists()` erişimleri üretimde ayrıca okuma olarak faturalanır, emülatör ölçümüne girmez. Yeni H7 kuralları istek başına 1–3 `get` kullanır (`ebysReplyLinkOk` 3, `ebysDispatchOk` 1–2, `ebysIncomingKeyOk` 1). Kötü durum üst sınırı şöyle hesaplanır: 416 servis işleminin (289 okuma + 127 yazma) her biri istek başına 20 belge erişimi sınırını doldursa 8.320 ek okuma çıkar. Toplam ≈ 8.951 okuma, günlük kotanın **%17,9**'u olur. Gerçek değer bunun çok altındadır. Kurtarma aracı emülatörün `owner` jetonuyla REST üzerinden çalışır ve kuralları değerlendirmez, bu yüzden kural maliyeti yoktur.

## 6. Kalite kapıları

| Kapı | Komut | Gerçek sonuç |
|---|---|---|
| Yayın dosyaları | `node scratch/hosting-files.js` | `Yayınlanacak dosya: 129 (kök: 23, src/: 95, pdf-fonts/: 3) · beklenen: 129` · `✔ Yalnız uygulama dosyaları yayınlanacak.` |
| XSS lint | `npm run lint:xss` | `104 dosya · 209 sink · 296 HTML şablonu · 1027 dinamik ifade` · `güvenli 1008 · izinli (xss-ok) 19 · İZİNSİZ 0` |
| Birim testleri | `npm run test:unit` | `tests 398 · pass 398 · fail 0` |
| Kural testleri | `npm run test:rules` | `tests 412 · suites 39 · pass 412 · fail 0` (yeni H8 testi dahil, 58 sn) |

## 7. Bilinen sınırlar ve açık riskler

1. **Dosya planı revizyon kontrolü (§7.1 bulgusu çözüldü):** `ebysFilePlans` üzerinde ad değişikliği veya pasife alma yapıldığında `revision` artar (`revision > 1`). Kurtarma doğrulaması `normalizeFilePlan` şemasını her zaman denetler; güncel ad eşleşmesini yalnız `plan.revision === 1` iken zorlar, `plan.revision > 1` iken tarihsel plan adı `contentDigest` ile doğrulanır. Böylece plan adı sonradan güncellenmiş sağlam bir kurtarma paketi reddedilmez. (Not: Katalog tarafında ayrı bir `ebysFilePlanRevisions` koleksiyonu gerekirse sonraki iyileştirmede eklenebilir.)
2. **Mükerrer anahtarının doğruluğu** kural tarafında denetlenemez (H7 planı §7). Kurtarma aracı bu açığı artık paket düzeyinde kapatıyor: anahtar, evrakın üstverisinden yeniden üretilemiyorsa paket reddediliyor.
3. **Spark ölçümü** emülatör tabanlıdır. Rules `get()` maliyeti §5.3'teki üst sınırla tahmin edildi, canlıda ölçülmedi.
4. `ebysIncomingKeys` kişisel kopyada kapsam dışı kalmaya devam ediyor (`derived-lookup-key`). Anahtar yalnız kurumsal kurtarma paketinde taşınıyor.

## 8. H0–H8 nihai kapanış matrisi

| Paket | Konu | Durum | Kanıt / kayıt |
|---|---|---|---|
| H0 | Görev süresi / saat sınırı | ✅ Kapandı | `2026-11-08_EBYS_H0_Walkthrough.md`, `…_Teslim_Kontrolu.md` |
| Q0 | Kuyruk / defter performansı ve görünürlük | ✅ Kapandı | `2026-11-08_EBYS_Q0_Walkthrough.md`, `…_Teslim_Kontrolu.md` |
| H1 | Kişisel kopya ve kurumsal QR / demo kurtarma | ✅ Kapandı; H8'de H6b/H7 kapsamı eklendi | `2026-11-09_EBYS_H1_Walkthrough.md`, `…_Teslim_Kontrolu.md` |
| H2 | Belge türleri, durum etiketleri | ✅ Kapandı | `2026-11-09_EBYS_H2_Walkthrough.md`, `…_Teslim_Kontrolu.md` |
| H3-A | Satın alma veri ve servis sözleşmesi | ✅ Kapandı | `2026-11-09_EBYS_H3_A_Walkthrough.md` |
| H3-B | Satın alma kuralları | ✅ Kapandı | `2026-11-10_EBYS_H3_B_Walkthrough.md`, `…_Teslim_Kontrolu.md` |
| H4 | Satın alma görünümü, tekrar deneme, V1/V2 kurtarma | ✅ Kapandı | `2026-11-10_EBYS_H4_Walkthrough.md` |
| H5 | Satın alma formu ↔ yeni servis | ✅ Kapandı | `a313ef5` (A-1…A-6 birleşik kabul kapanışı), `01_Bolum_A_Paket_1_…_Walkthrough.md` |
| H6a | EBYS kuyruk / karar arayüzü | ✅ Kapandı | `a313ef5`, `2026-11-12_EBYS_H6a_Hotfix_Birim_Personel_UX_Walkthrough.md` |
| H6b | Künye, dosya planı, üst yazı şablonu | ✅ Kapandı; H8'de kişisel kopya ve kurtarma kapsamı tamamlandı | `ec605a8`, `2026-11-12_EBYS_H6b_…_Walkthrough.md` |
| H7 | Yazışma ve takip (cevap bağı, mükerrer, gönderim, filtreler) | ✅ Kapandı (D0–D6); D7 rehber kısmı İP-9'a devredildi | `8bdb49b`, `00_H7_Yazisma_ve_Takip_Uygulama_Plani.md` |
| H8 | Birleşik kabul, kurtarma, Spark kanıtı | ✅ Kapandı | Bu belge, `tests/rules/ebys-h8-acceptance.test.mjs`, `scratch/ebys-h8-evidence/recovery-measurements.json` |

**Kalan açık kapılar (H0–H8 dışı, ayrı fazlar):**

| Kapı | Açıklama |
|---|---|
| İP-9 | `src/ui/ebys-showcase-modal.js` rehber sadeleştirmesi ve `2026-11-07_EBYS_Rehberi_Revizyon_Taslagi.md` güncellemesi (H7 D7'nin rehber kısmı dahil). |
| Canlı yayın | `firestore.rules`, `firestore.indexes.json` ve hosting yayını. Kurallar istemciden önce yayınlanmalı. Bu görevde yayın yapılmadı. |
| Aşama 8 | Gerçek e-imza, EYP, KEP, e-Devlet / kurum API entegrasyonları ve Storage dosya yükleme. Spark sınırı dışında, ayrı faz. |

## 9. Yerelde yeniden çalıştırma

```bash
# Yalnız H8 testi (emülatör otomatik açılıp kapanır, port 8180)
npx firebase emulators:exec --config tests/rules/firebase.rules-test.json --only firestore --project demo-rules-test \
  "node --test --test-reporter=spec tests/rules/ebys-h8-acceptance.test.mjs"

# Tüm kapılar
node scratch/hosting-files.js && npm run lint:xss && npm run test:unit && npm run test:rules
```

Test yalnız `demo-ebys-h8-source` ve `demo-ebys-h8-target` demo projelerine yazar. Çalışan bir yerel geliştirme emülatörünün (8080) verisine dokunmaz.
