# H6b · Kurum Künyesi, Dosya Planı ve Üst Yazı Şablonları — walkthrough

12 Kasım 2026. Dal `feat/v3.6-raf-sayim-envanter-no-mobil-form`, HEAD `60afe00`. Çalışma yerel ağaçta, commit edilmedi (aynı ağaçta paralel EBYS çalışması var).

## Kapsam

Planın G06 boşluğu (`2026-11-07_EBYS_Plan_Kod_Kiyaslamasi_ve_Tamamlama_Plani.md`, H6): kurum künyesi, yönetilen dosya planı ve sürümlü üst yazı şablonu. Ana ilke **değişmezlik**: evrak tanımın kendisine bağlanmaz, **kopyasını** taşır. Kopya, değiştirilemeyen sürüm kaydına (`ebysVersions`, kurallarda update/delete kapalı) mühürlenir. Bu yüzden tanım sonradan değişse ya da pasife alınsa da dondurulmuş evrak ve başlatılmış süreç etkilenmez.

## Veri modeli (yeni koleksiyonlar; silme yok)

| Koleksiyon | İçerik | Yazma | Okuma |
|---|---|---|---|
| `ebysOrganizations/primary` | Kurum adı, kodu (2–12 büyük harf/rakam), adres, telefon, e-posta, web, `revision` | Yönetici; her güncelleme revizyon +1 | Tüm üyeler |
| `ebysOrganizationRevisions/{n}` | Künyenin her revizyonunun değiştirilemez kopyası | Yönetici, yalnız oluşturma; künyeyle aynı commit'te | Tüm üyeler |
| `ebysFilePlans/{kod}` | Kod (belge kimliği = kod, değiştirilemez), ad, `active`, `revision` | Yönetici; pasifleştirme var, silme yok | Tüm üyeler |
| `ebysLetterTemplates/{uuid}` | Şablon ailesi: ad, `active`, `currentRevision` | Yönetici | Tüm üyeler |
| `ebysLetterTemplateRevisions/{uuid}_{n}` | Şablon sürümü: ad, konu, metin (değiştirilemez) | Yönetici, yalnız oluşturma; sürüm atlanamaz | Tüm üyeler |

Evrakın taşıdığı kopyalar (yalnız satın almaya bağlı olmayan genel evrak):

| Alan | Nerede | Kural |
|---|---|---|
| `institutionSnapshot` (künye alanları + kaynak revizyon) | `ebysDrafts` → `ebysVersions` | Yeni taslak, künye tanımlıysa onun **birebir** kopyasını almak zorunda. Kurum kodu künyeden gelir. Mevcut taslak kopyasını değiştiremez. Künyeden önce açılmış taslağa sonradan kopya eklenmez (geriye dönük uyum). |
| `metadata.filePlanTitle` (isteğe bağlı) | `ebysDrafts.metadata` → `ebysVersions.metadataSnapshot` | Taslakta yalnız biçim denetlenir. Sürüm yazılırken plan kaydının kodu ve adı birebir eşleşmeli. Serbest metin kodlu eski evraklar etkilenmez. |
| `letterTemplate` (`templateId`, `revision`, `name`) | `ebysDrafts` → `ebysVersions` | Taslakta biçim denetlenir. Sürüm yazılırken bağlı şablon sürümü var olmalı ve adı eşleşmeli. |

Pasif plan ya da şablonu **yeni seçimde** servis reddeder. Seçimden sonra pasife alınan tanımla hazırlanmış taslak yine dondurulabilir.

### Neden plan ve şablon denetimi sürüm anında?

Personelin taslak güncellemesi, kural ifade bütçesinin (istek başına 1000) birkaç ifade altında çalışıyor. Bu ölçüldü: HEAD kurallarında personel taslağı oluşturma ve güncelleme geçiyor. Plan denetiminin yalnız `get` + 2 karşılaştırması bile güncellemeyi sınırın üstüne çıkarıyor; denetim saplamayla değiştirilince test geçiyor. Bu yüzden katalog eşleşmesi, resmî kaydın oluştuğu sürüm yazımında zorunlu tutuldu (`ecVersionPlanOk`, `ecVersionTemplateOk`). Taslak yazarına özeldir. Servis atlatılarak taslağa uydurma bir plan ya da şablon adı yazılabilir, ama bu taslak dondurulamaz (kural testi bunu doğruluyor). Künye kopyası taslak oluşturmada zorunludur, çünkü bu yol bütçeye sığıyor.

## Değişiklikler

| Dosya | Değişiklik |
|---|---|
| `src/utils/ebys-catalog-schema.js` (yeni) | Saf doğrulama: künye, plan kodu ve plan seçenekleri (pasif ya da eski değer korunur), şablon, `applyTemplate`. |
| `src/services/ebys-catalog-service.js` (yeni) | `loadCatalog`, `saveProfile` (+ revizyon kaydı), `saveFilePlan`, `setFilePlanActive`, `saveTemplate` (her kayıt yeni sürüm), `setTemplateActive`, sürüm listeleri. Her yazma tek transaction ve beklenen revizyon denetimi içerir; bayat ekran üzerine yazamaz. |
| `src/ui/ebys-catalog-ui.js` (yeni) | Tanımlar sekmesindeki üç panelin çizimi (DOM API + `textContent`). |
| `src/utils/ebys-document-schema.js` | `normalize` isteğe bağlı `filePlanTitle`; `institutionSnapshot`, `templateRef`, `sameRef`. |
| `src/services/ebys-document-service.js` | Genel taslak kaydında katalog kopyaları (künye transaction içinde okunur; değişen plan veya şablon seçimi aktif tanımla doğrulanır). Dondurmada kopyalar sürüme geçer; plan ve şablon için açık hata mesajlı ön denetim yapılır. `reopenDraft` şablon bağını taşır. |
| `src/ui/ebys-documents-ui.js` | Evrak formu: kurum kodu künyeden ve kilitli, künye notu, "Şablondan doldur" (önceki metne dönüş, bağı kaldırma), dosya planı seçimi (katalog yoksa serbest kod), dondurulmuş evrakta plan kodu–adı. Önizleme başlığı evrakın kendi künye kopyasından gelir. Katalog yüklenemezse form eski davranışla açılır. |
| `src/ui/ebys-documents.css` | Panel ve not stilleri (tema değişkenleri). |
| `admin.html` | Tanımlar: "Kurum Künyesi", "Dosya Planı", "Üst Yazı Şablonları" alt sekmeleri. Her panelde kısa açıklama + "Nasıl çalışır?" yardımı (AGENTS.md). Sekme çubuğu dar ekranda satır kırar. |
| `src/modules/admin/admin-main.js` | Katalog arayüzü importu. |
| `firestore.rules` | `ec*` blokları (yukarıdaki tablo); `ebysMetadata`, `ebysDraftOk`, `ebysVersionOk` anahtar kümeleri genişledi. |
| `tests/rules/ebys-catalog.test.mjs` (yeni) | Gerçek servisler (vm) + kurallar: 5 senaryo. |
| `tests/unit/ebys-catalog-schema.test.mjs` (yeni) | Saf şema: 5 test. |
| `scratch/hosting-files.js` | `EXPECTED_COUNT` 111 → 114 (3 yeni yayın dosyası). |

`index.html` değişmedi: evrak formu ortak modüldür (`ebys-documents-ui.js`) ve iki sayfada aynı kodla çalışır.

## Doğrulama

| Komut | Sonuç |
|---|---|
| `npm run test:unit` | 391/391 |
| `npm run test:rules` (emülatör) | 403/403 (yeni 5 dahil) |
| `npm run lint:xss` | izinsiz 0 (güvenli 1005, izinli 19) |
| Tarayıcı (çalışan emülatör, yalnız `H6B` kayıtları, sonunda temizlik) | 13/13 |

Tarayıcıda doğrulananlar:
- Künye kaydı ve revizyon geçmişi.
- Plan ekleme ve pasife alma; şablon sürüm 1 → 2 (sürüm 1 değişmedi).
- Evrak formunda kilitli kurum kodu; yalnız aktif planlar; şablonun güncel sürümü.
- Taslağa üç kopyanın yazılması.
- Künye değiştirilip şablon pasife alındıktan sonra dondurmada sürüm eski künye ve şablon sürümünü taşıyor.
- Önizleme başlığı güncel künyeden değil, evrakın kopyasından geliyor.
- Sayfa hatası yok.

## Yayın notu

**Kurallar istemciden önce yayınlanmalı.** Yeni istemci taslak kaydında `ebysOrganizations/primary` belgesini transaction içinde okur. Eski kurallarda bu koleksiyon tanımsız olduğu için okuma reddedilir ve yeni evrak açılamaz. Bu emülatörde HEAD kurallarıyla gözlendi.

## Kapsam dışı / sonraki adım

- **Satın almaya bağlı evrak** (`purchaseOrderId`) bu pakette kopya taşımaz; kurallar bunu açıkça reddeder. Sözleşmesi (`poVersionShape`, `purchaseDigestEnvelope`) ayrıdır ve aynı ağaçta paralel H5 çalışması sürüyor.
- **İçerik özeti:** `contentDigest` formülü değişmedi (içerik + üstveri + ekler). Künye ve şablon bağı özetin dışında; değişmezlikleri, değiştirilemeyen sürüm kaydıyla sağlanıyor. Doğrulama QR'ında künyenin gösterilmesi ayrı bir karardır.
- **Yedekleme:** yeni katalog koleksiyonları `EBYS_COLLECTION_REGISTRY`'ye eklenmedi; kurum yedeği/kurtarma işi (G04/H8) kapsamında ele alınmalı.
