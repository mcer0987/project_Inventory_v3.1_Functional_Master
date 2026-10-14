# Faz 5 Tur K2: Envanter Hareketleri, Hurda Akışı ve B1/B2 Sözleşmesi (5.8/5.10)

## Özet
B3'te 3.6'da kapatılan "dört ayrı şema, hiçbir yazma doğrulanmıyor" sorununun aynısı B1/B2 depolarında da vardı; bu turda
kapatıldı. Ayrıca H4'ten Faz 5'e ertelenen iki açık karar uygulandı: depolar arası (B1↔B2) sevkte artık kalemin tamamı
değil, seçilen adet taşınabiliyor (INV-06); "Hurda / Atık" hedefi — sevk listesinde duran ama her zaman "Geçersiz hedef"
veren ölü seçenek — artık gerçek, atomik bir hurdaya ayırma akışı. Son olarak B1 tablosunun sayfalama ve durum filtresi
canlı güncellemelerde kendini sıfırlayan/ gözden kaçıran iki ayrı kararlılık hatası giderildi (INV-05, INV-07).

## Değişiklikler ve Commit'ler
* **Dal:** `feat/phase-5-completion-and-ux`
* **Değişen dosyalar:** `src/utils/schema.js`, `src/services/firebase-handler.js`, `filter-module.js`,
  `src/ui/table-engine.js`, `src/modules/main.js`, `src/ui/ui-components.js`, `src/services/assignment-service.js`,
  `scratch/flow-tests.js`, `tests/unit/stock-schema.test.mjs` (yeni)

## 1. B1/B2 Şema Sözleşmesi (5.8)
`schema.js`'e B3'teki desenin birebir aynısı eklendi: `B1_KEYS`/`B2_KEYS` kanonik alan listesi, `B1_LEGACY_KEYS`/
`B2_LEGACY_KEYS` (eski İngilizce takma adlar: `name/type/shelf/qty`, B2'de ayrıca `status` B1 için eski sayılır çünkü
yalnız B2 taşır), `validateB1`/`validateB2`. B2'nin kendine özgü kuralı: hem `durumu` hem `status` birlikte zorunlu
(saveProduct ikisini de yazıyor, gerçek alan adı denetimiyle doğrulandı).

`firebase-handler.js`'teki B3 muhafızı (`_b3Violation`/`_b3GuardError`) genelleştirildi: `_schemaViolation`/
`_schemaGuardError` artık `b3`, `b1` ve `b2` için aynı iki aşamalı deseni uygular ('set' → tam sözleşme, 'update' →
yalnız bilinen alan adı). Kanca hem `applyItemOps` hem `runStockOps` hem de eski monolitik `saveData()` yoluna
eklendi — tıpkı istenen gibi.

**Bilinçli bir istisna:** `saveData()`'nın eski toplu yolunda (CSV/Excel içe aktarma, tür adı toplu değişikliği gibi)
B1/B2 için tam `'set'` sözleşmesi ZORLANMADI — yalnız eski alan adı denetimi yapılır. Neden: canlı CSV içe aktarma kodu
(`script.js`) bugün `isDemirbas` alanını hiç yazmıyor ve `rafNo` adında kanonik olmayan fazladan bir alan ekliyor; tam
sözleşme zorlansaydı bu çalışan (though eksiksiz olmayan) özellik ilk kullanımda kırılırdı. Yeni atomik yol
(`applyItemOps`/`runStockOps` — `confirmTransfer`, hurda, `saveAssignment`) tam sözleşmeyi zaten zorunlu kılıyor; CSV
içe aktarmanın kendisini düzeltmek bu turun kapsamı dışında bırakıldı ve sahibine ayrıca bildirilmelidir.

## 2. Hurdaya Ayırma Akışı (5.10)
"Hurda / Atık" zaten sevk/transfer hedef listesindeydi (`confirmTransfer`'daki `else` dalı her zaman "Geçersiz hedef."
diyordu). Yeni `scrap` dalı, external/service sevkiyle aynı desenle kuruldu:
- Yalnız seçilen adet depodan düşer (`runStockOps` ile atomik).
- Demirbaşta adet kadar cihaz kimliği zorunlu (`AssignmentService.checkDeviceIds`); her cihaz için ayrı, kanonik bir
  B3 kaydı (`Schema.buildB3Entry({ tip: 'hurda', ... })`, adet=1). Sarfta tek kayıt (adet = seçilen).
- Bu işlem yeni bir `B3_TIP.HURDA` ('hurda') değeriyle; `buildB3Entry`/`normalizeB3`/`validateB3` üçü de güncellendi
  (demirbaş kuralları — kimlik zorunlu, adet 1 — hurda için de geçerli).
- Bu ürüne/cihaza ait AÇIK (kapanmamış) servis kaydı varsa, aynı transaction'da kapatılır (`kapandi:true`,
  `durum:'Hurdaya Ayrıldı'`). Demirbaşta eşleşme cihaz kimliğine göre (yalnız scrap edilen SN/Envanter No); sarfta
  ürün id'sine göre. *(Not: `checkDeviceIds` zaten "serviste olan cihaz tekrar çıkışa verilemez" dediği için, demirbaşta
  scrap edilen SN'in AYNI ANDA açık bir servis kaydında olması gerçek kullanımda mümkün değildir — bu yüzden eşleşme
  esasen sarf/aggregate senaryoda devreye girer; demirbaşta ileride farklı bir SN'in kapanmış eski kaydına dokunmaz.)*
- Hurdaya ayırma işlemi geri alınamaz olduğu için ayrıca bir onay diyaloğu (`showCustomConfirm`) eklendi.
- Cihaz Geçmişi'nde (`AssignmentService.getDeviceHistory`) hurda hareketi artık "♻️ Hurdaya Ayrıldı" etiketiyle ayrı
  gösteriliyor (önceden "📤 Envanter çıkışı" ile karışırdı).

## 3. B1 ↔ B2 Kısmi Sevk İyileştirmesi (5.8 · INV-06)
`confirmTransfer`'ın `internal` dalı tamamen yeniden yazıldı. Eskiden kalemin TAMAMI taşınıyordu (37 adetlik satırdan
1 tanesi B2'ye gidecekse bile 37'si gidiyordu) ve hedef kaydı kaynaktan `{...originalItem}` ile kopyalanıyordu (B2'nin
ayrıca tuttuğu `status` alanı kaynakta yoksa hedefte de oluşmuyordu — yeni B1/B2 sözleşmesini ihlal ederdi).

Artık: seçilen adet < mevcut stoksa kaynaktan yalnız o kadarı düşülür (`update`), hedefte YENİ id'li, yalnız kanonik
alanlarla kurulmuş bir kayıt açılır. Adet tüm stoksa eski davranış (kaynak silinir, aynı id hedefte yaşar) korunur.
**Kasıtlı olarak demirbaş kimlik girişi istenmez** — sahibinin Faz 5 Orkestrasyon Planı §5.8'deki kararı: B1/B2 taşıma
bir *konum değişikliğidir*, cihaz kimliği zaten B3/servis kayıtlarında tutulur; B1/B2 dokümanının kendisi hiçbir zaman
SN/Envanter No taşımaz (doğrulandı).

## 4. Sayfalama ve Filtreleme Kararlılığı (5.8 · INV-05/INV-07)
Üç ayrı kök neden bulundu ve düzeltildi:
1. **`main.js:onInventoryDataUpdated`** — "sadece değişti" olmayan her canlı güncelleme (ekleme/silme/karışık parti)
   `renderTable(depo)`'yu customLimit'siz çağırıyor, bu da `_currentPage`'i 1'e sıfırlıyordu ("Daha Fazla Yükle" ile
   açılan sayfalar kapanıyordu). Artık mevcut sayfa × sayfa boyutu kadar satır `customLimit` olarak geçiriliyor;
   `renderTable` bu durumda sayfayı sıfırlamıyor.
2. **`filter-module.js`** — "Sadece Aktifler" filtresi tam `durum === 'Pasif'` eşleşmesi yapıyordu; `computeStockPatch`'in
   yazdığı bileşik durum metni ("Tükendi / Pasif") yakalanmıyordu. Yeni paylaşılan `window.isPassiveStatus()` alt dize
   eşleşmesi yapıyor (hem filtre hem tüm satır/kart stil işaretlemeleri aynı fonksiyonu kullanıyor).
3. **`table-engine.js:patchDOMForCollection`** — canlı "yalnız değişti" güncellemesi satırı DOM'da bırakıp yalnız
   stilini değiştiriyordu; bir ürün patch sırasında Pasif'e düşünce "Sadece Aktifler" görünümünde satır yanlışlıkla
   görünür kalıyordu. Artık aktif filtreye göre satır/kart artık görünür olmayacaksa DOM'dan kaldırılıyor (tam
   `renderTable` ile tutarlı); filtre "Tümü" ise hiçbir satır kaldırılmıyor (yalnız stil, regresyon testiyle doğrulandı).
   Ayrıca "Daha Fazla Yükle" butonunun toplam sayısı artık FİLTRELENMİŞ listeye göre hesaplanıyor (önceden ham/filtresiz
   uzunluk kullanıyordu, pasif karışık listelerde buton yanlış görünüp kayboluyordu).

## Test Sonuçları
| Suite | Sonuç |
|---|---|
| `npm run test:unit` (22 test: K1'in 14'ü + yeni `stock-schema.test.mjs`'in 8'i) | ✅ 22/22 |
| `npm run test:rules` | ✅ 72/72 |
| `flow-tests.js --emu` (47 senaryo: `b1WriteContract`, `b2WriteContract`, `k2TableUx` dahil) | ✅ 47/47, exit 0, 0 sayfa hatası, 0 CSP ihlali |
| `npm run lint:xss` | ✅ 0 izinsiz sink |

`b1WriteContract`/`b2WriteContract`, gerçek `saveProduct` (ekleme/düzenleme), `confirmTransfer`'ın internal (tam +
kısmi) ve scrap kollarını GERÇEK UI fonksiyonlarıyla sürüp yalnız atomik yazıcıları (appendItem/updateItem/
applyItemOps/runStockOps) yakalayıcıyla değiştirir; her üretilen kayıt `Schema.validateB1/B2/B3`'ten geçirilir. `b2`
testinde ayrıca, scrap edilen cihazlarla AYNI SN'e sahip OLMAYAN bir açık servis kaydının yanlışlıkla kapatılmadığı
(seçiciliğin productId değil cihaz kimliğine göre olduğu) doğrulanır. `k2TableUx` gerçek `main.js` olay yöneticisini
(`onInventoryDataUpdated`) ve gerçek `table-engine.js` render/patch yollarını sürer.

## Sahibinin Doğrulama Adımları
1. Herhangi bir B1/B2 ürününde **Sevk/Transfer** modalını açın, hedef olarak diğer depoyu (B1↔B2) seçin; artık bir
   "adet" alanı göreceksiniz — stoktan AZ bir adet girip onaylayın: kaynakta kalan adedin azaldığını, hedefte YENİ bir
   satırın o adetle açıldığını doğrulayın.
2. Aynı modalde hedef olarak **"Hurda / Atık"** seçin; demirbaşsa cihaz kimliği (Seri No/Envanter No) isteyecek. Adet
   girip onaylayın (geri alınamaz uyarısını onaylayın) — stoktan düştüğünü, B3 Envanter Çıkış tablosunda yeni bir
   hareketin (Cihaz Geçmişi'nde "♻️ Hurdaya Ayrıldı") göründüğünü doğrulayın.
3. B1 sekmesinde "Sadece Aktifler" filtresiyle "Daha Fazla Yükle"ye birkaç kez basıp sayfayı ilerletin; başka bir
   cihazdan/ sekmeden aynı depoya küçük bir değişiklik yapın (ör. yeni ürün ekleyin) — sayfanın BAŞA SIFIRLANMADIĞINI
   doğrulayın.
4. Bir B1 ürününün durumunu "Tükendi / Pasif" yapıp "Sadece Aktifler" filtresindeyken listeden kaybolduğunu; filtreyi
   "Tümü"ne alınca göründüğünü (gri/pasif stilde) doğrulayın.
