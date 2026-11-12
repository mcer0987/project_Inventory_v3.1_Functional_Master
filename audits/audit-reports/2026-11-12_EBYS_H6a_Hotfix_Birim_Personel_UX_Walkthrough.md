# H6a hotfix doğrulaması ve Birim/Personel Yönetimi UX yenilemesi — walkthrough

12 Kasım 2026. Dal `feat/v3.6-raf-sayim-envanter-no-mobil-form`, HEAD `60afe00`. Çalışma yerel dalda, commit edilmedi.

## Kapsam

İki ayrı parça:

**(1) H6a hotfix görevi — iddia koddan doğrulanamadı.** Görev, `ebys-documents-ui.js`'teki "İlgili Birim" alanının serbest metin olduğunu ve bu yüzden Aşama 6 havale eşlemesinin (ebysExecutionPolicies) çalışmadığını iddia ediyordu. İnceleme sonucu: bu alan zaten `<select>`, değeri birim `id`'si, `ebys-document-schema.js:19` bunu `unitId` olarak kaydediyor, `firestore.rules` birimin var/aktif olduğunu zorunlu kılıyor, `ebys-execution-service.js:44` havale politikasını aynı `unitId` ile eşliyor. Bu zincire dokunulmadı.

Gerçek, daha küçük açık bir önceki turda yazılan `ebys-purchase-ui.js`'deydi: satın alma formundaki `#purUnit` seçicisi (ayrı bir ekran, `purchase-servises.js`) değeri **birim adı** taşıyordu; `resolveUnitId` adla arıyordu — aynı adlı iki birimde yanlış birime havale riski. Düzeltme: `_fillNamedSelect` artık her `<option>`'a birimin kalıcı ID'sini `data-unit-id` olarak yazıyor; `resolveUnitId` önce seçili option'ın dataset'inden ID okuyor, yalnız ID yoksa isme düşüyor.

**(2) Birim Yönetimi tablosunun UX'i (kullanıcı tespiti, ekran görüntüsüyle).** Tek `<td>` içinde üç ayrı liste üst üste biniyordu: eski `personnel` (ad dizisi), eski `personnelIds` (birimin kendi dizisi) ve gerçek EBYS yönlendirme kaynağı olan `personel.unitId` bazlı bağ. 20+ personelli birimde hücre okunmaz hale geliyordu.

Kod incelemesiyle doğrulandı: `personnelIds` hiçbir Rules/servis/havale/rota yolunda **okunmuyor** — yalnız kendi yazım doğrulamasında (var mı / pasif mi) ve bu tablo hücresinde kullanılıyordu; `resolveLegacyNames` adlı bir göç yardımcısı da yazılmış ama hiçbir üretim ekranından çağrılmıyordu (yalnız kendi birim testinde). Kullanıcı onayıyla: yeni "+ Personel Ekle" aksiyonu **gerçek bağı** (`personel.unitId`) değiştirir; eski `personnelIds` temizlenmedi, yalnız düzenleme modalında "eski kayıt" olarak kalmaya devam ediyor.

## Yapılan değişiklikler

| Dosya | Değişiklik |
|---|---|
| `src/services/purchase-servises.js` | `_fillNamedSelect` artık `data-unit-id` yazıyor (ID varsa); `fillPurchaseSelects` değişmedi. |
| `src/ui/ebys-purchase-ui.js` | `resolveUnitId` önce seçili option'ın dataset'inden ID okuyor; isme yalnız ID yoksa düşüyor. |
| `src/modules/edm-workflow.js` | `renderUnitManagement` yeniden yazıldı: birim hücresi (ad + rozet + kısaltılmış ID + kopyala düğmesi), personel hücresi (yalnız gerçek `unitId` bağı, 3'ten fazlaysa `<details>` ile katlanır). Yeni `window.openUnitPersonnelPicker` / `_searchUnitPersonnelPicker` / `_assignPersonnelToUnit` — mevcut arama kalıbı ve `EBYSDefinitions.savePersonnel` servisi yeniden kullanıldı, yeni bir yazım yolu icat edilmedi. `.um-modal` paylaşılan CSS sınıfı (önceki `#unitModal`'a özel stil artık iki modal arasında paylaşılıyor). |
| `style.css` | `.btn-action.btn-success`, `.unit-personnel-list`/`.unit-personnel-details` — küçük, var olan token'ları kullanan eklemeler. |
| `index.html`, `admin.html` | Birim/Personel ekranlarına kısa görünür açıklama + rehber tetikleyici düğmesi (AGENTS.md gereği); birim tablosu başlıkları güncellendi; yeni CSS/JS script-tag'leri eklendi. |
| `src/ui/unit-showcase-modal.js` + `.css` (yeni) | "Birim Yönetimi Rehberi" — Zimmet Rehberi (`zim-showcase-modal.js`) iskeleti ve CSS kalıbı (`un-sc-` öneki) aynen tekrar kullanıldı; içerik (hiyerarşi, gerçek bağ, ekleme/çıkarma, pasifleştirme, SSS) tamamen yeni. |
| `src/ui/personnel-showcase-modal.js` + `.css` (yeni) | "Personel Yönetimi Rehberi" — aynı iskelet, `pr-sc-` öneki; içerik (kalıcı ID/UID/PRI farkı, birim ataması, hesap durumu rozetleri, pasifleştirme, SSS) yeni. |

## Kapsam dışı (bilinçli)

- `personnelIds` dizisinin veya `resolveLegacyNames`'in temizlenmesi/bağlanması — kullanıcı onayı yalnız görüntüleme kaynağını netleştirmeyi istedi.
- Birim hiyerarşisinin ayrı bir ağaç görünümüne taşınması.

## Testler ve bilinen, ilgisiz bir kırmızı

`npm run lint:xss`: 94 dosya, 1024 dinamik ifade, **0 izinsiz**. `npm run test:unit`: **386/386**.

`npm run test:rules`: çalışma ağacında **başka bir oturumun eşzamanlı sürdürdüğü** bir işten (yeni `src/services/ebys-catalog-service.js`, `src/utils/ebys-catalog-schema.js`, `tests/rules/ebys-catalog.test.mjs`, değişmiş `firestore.rules` — hiçbiri bu turda dokunulmadı/stage edilmedi) `tests/rules/ebys-catalog.test.mjs:145` testi `PERMISSION_DENIED` ile kırmızı çıkıyor. Bu dosya/özellik grubu H6a/UX değişiklik setinin dışındadır; benim değişikliklerim ne Rules'a ne de servis katmanına dokunuyor (yalnız DOM render + iki yeni statik rehber modalı). Aynı makinede ilk koştuğum (bu turun UX değişikliklerinden hemen önceki) `test:rules` denemesi geçici port çakışmasıyla hiç başlayamamıştı (8180/4410/4510 anlık doluydu, ikinci denemede boştu) — bu da ayrı, ilgisiz bir ortam meselesiydi.

Not: `git diff --stat` bu dosyalarda (ve dokunmadığım dosyalarda da) binlerce satır değişmiş gösteriyor; bu CRLF/LF normalizasyon uyuşmazlığından kaynaklanan bilinen bir ortam durumu (`core.autocrlf` için hem `true` hem `false` kayıtlı), gerçek içerik değişikliği değil — git config'e dokunulmadı.

## Ek tur — rehber düğmesi sadeleştirme ve Personel Tanımları tutarsızlığı

Kullanıcı geri bildirimi: (1) rehber tetikleyici düğmeleri EBYS Rehberi ile görsel olarak birebir aynıydı (mor, animasyonlu sparkle ikonu) — modallara dokunulmadı, yalnız düğmeler `style.css`'teki yeni sade `.section-guide-link` sınıfına çevrildi (nötr renk, animasyonsuz `fa-circle-question`); konum admin tarafında onaylandığı için değiştirilmedi.

(2) Ekran görüntüleriyle gösterildi: admin "Personel Tanımları" tablosu birim bilgisini eski `item.birim` (serbest metin) alanından gösteriyor, yeni "Birim / Departman Listesi" ise yalnız gerçek `item.unitId` bağını sayıyordu — aynı kişi (ör. "Ahmet Serhat Dursun") birinde "Bilgi Teknolojileri"nde görünüp diğerinde hiç görünmüyordu, çünkü yalnız eski metin alanı doluydu, gerçek `unitId` boştu. `personel.js`'teki hücre artık Birim Yönetimi ile aynı gerçek kaynağı kullanıyor: `unitId` varsa güncel birim adı (canlı, `window.data.units`'ten), yoksa "Birim ataması yok" + varsa eski metin yalnız ikinci planda not olarak. Anlamsız "Birim ID: eski ad kaydı" ifadesi kaldırıldı.

`npm run lint:xss`: 95 dosya, 0 izinsiz. `npm run test:unit`: 391/391 (sayı artışı eşzamanlı oturumun eklediği testlerden, bu turla ilgisiz).

## Manuel doğrulama adımları

1. `index.html` → Birim / Departman Listesi: tek, az ve çok (3+) personelli birimlerde hücre düzenini kontrol et; `<details>` katlanması.
2. "+ Personel Ekle" ile aktif bir kişiyi başka bir birime ata; tablo ve Personel Tanımları tablosu yenileniyor mu.
3. Pasif birimde "+ Personel Ekle" ve pasif birime atama reddi.
4. "Birim Yönetimi Rehberi" / "Personel Yönetimi Rehberi" düğmeleri (`index.html`, `admin.html`) — Esc, Tab odak hapsi, ok tuşlarıyla sekme gezintisi.
5. Satın alma formunda EBYS gönderimi: aynı adlı iki birim olsa bile seçili `<option>`'ın `data-unit-id`'si doğru birime havale ediyor mu (dataset üzerinden manuel DOM kontrolü).
