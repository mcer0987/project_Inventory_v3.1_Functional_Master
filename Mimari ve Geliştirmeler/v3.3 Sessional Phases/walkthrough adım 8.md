# v3.3 Geliştirme Walkthrough'u — Faz 8: "Ürünü Kopyala" (Clone/Duplicate)

> **Kapsam:** B1 (Sarf) ve B2 (Demirbaş) depolarında, mevcut bir ürünün alanlarını yeni bir kayda taşıyarak hızlı ürün girişi yapan "Kopyala" özelliği.
> **Çalışma dalı:** `feat/phase-7-logging-and-ux`
> **İlişkili belgeler:** [walkthrough adım 7.md](./walkthrough%20ad%C4%B1m%207.md), [Weekly](./Weekly)

## 1. Kısa uygulama raporu

- Satır seçimiyle açılan masaüstü FAB (Floating Action Bar) ve mobil Bottom Sheet'teki işlem butonları arasına, "Düzenle" ile "Sevk" arasına **Kopyala** (`fa-copy`) butonu eklendi.
- `UIComponents.openProductModal()` fonksiyonuna üçüncü bir mod eklendi: `'clone'`. Bu mod, `'edit'` ile aynı alan doldurma mantığını kullanır (raf/sütun/tür/ad/marka/adet/durum/açıklama/demirbaş checkbox) ama:
  - Modal başlığını `📋 Ürün Kopyala: [Ürün Adı]` yapar.
  - `form.dataset.editId`'yi **asla** yazmaz (siler) — bu sayede `saveProduct()` "düzenleme" yolunu değil "yeni kayıt" yolunu izler ve `window.makeId()` ile daima yeni bir id üretir. Orijinal kaydın üzerine yazılması teknik olarak imkânsız hale getirildi (id bağı hiç kurulmuyor).
  - `form.dataset.isCloning = 'true'` bayrağını set eder; bu bayrak yalnız iptal emniyet kilidi için kullanılır, kayıt mantığına karışmaz.
- `UIComponents.cloneProduct(depo, id)` köprüsü eklendi (`window.cloneProduct` olarak bağlandı) — butonlar bunu çağırır, dahili olarak `openProductModal('clone', id, depo)`'yu tetikler.
- **İptal emniyet kilidi:** `script.js`'teki `closeProductModal()` artık `async`; `productForm.dataset.isCloning === 'true'` iken çarpı butonuna, modal dışına tıklamaya çalışıldığında `showCustomConfirm('Kopyalamayı İptal Et', 'Kopyalama işlemi iptal edilecek. Devam etmek istiyor musunuz?')` ile onay ister:
  - Onaylanırsa bayrak temizlenir ve modal kapanır.
  - Vazgeçilirse modal **açık kalır**, hiçbir şey sıfırlanmaz.
- `saveProduct()` (başarılı kayıt, kopyalama dahil) **onay sormadan** doğrudan kaydeder; başarılı kayıttan hemen sonra `isCloning` bayrağı temizlenip `closeProductModal()` çağrılır — böylece "Kaydet" akışı asla emniyet kilidine takılmaz (madde 3'teki "Kaydet'e basılırsa onay sormadan normal kayıt yapılsın" kuralı).

### B2 (Demirbaş) "Seri No" istisnası hakkında not

Görev tanımında, B2 ürünü kopyalanırken seri numarası (`sn`) alanının boş bırakılması isteniyordu (aynı seri numarasıyla ikinci cihaz açılamaz kuralı gereği). Kod tabanı incelendiğinde **ürün ekleme/düzenleme formunda (`#productModal` / `#productForm`) böyle bir seri no alanı bulunmadığı** doğrulandı:

- `src/utils/schema.js`'teki `B1_KEYS`/`B2_KEYS` sözleşmeleri (`id, sütun, raf, tür, ürün, marka, adet, durumu, (status), açıklama, isDemirbas, lastUpdate`) herhangi bir `sn` alanı içermiyor.
- `sn`/`envanterNo` alanları yalnızca **çıkış (b3/zimmet) kayıtlarında**, cihaz bazlı teslim akışında (`src/ui/device-ids.js`, `buildB3Entry`) var — ürünün depo envanteri (B1/B2) seviyesinde değil.

Bu nedenle kopyalama akışında temizlenecek somut bir `sn` alanı yoktur; kopyalanan B2 kaydı, orijinal gibi stoktaki bir demirbaş tanımı olarak açılır ve seri no ataması (varsa) yine çıkış/zimmet akışında cihaz bazında yapılmaya devam eder. İleride ürün tanımına kalıcı bir "envanter/seri no" alanı eklenirse, bu fonksiyon (`openProductModal('clone', …)` içindeki B2 dalı) o alanı temizleyecek şekilde genişletilmelidir.

## 2. Değişen dosyalar

| Dosya | Değişiklik |
|---|---|
| `src/ui/ui-components.js` | `openProductModal()`'a `'clone'` modu eklendi (başlık, alan doldurma, `editId` BAĞLANMAZ, `isCloning` bayrağı); yeni `cloneProduct(depo, id)` metodu ve `window.cloneProduct` köprüsü eklendi; FAB (`updateFloatingBar`) ve mobil Bottom Sheet (`showMobileBottomSheet`) buton listelerine "Kopyala" eklendi. |
| `script.js` | `closeProductModal()` `async` yapıldı; `isCloning` bayrağı set iken kapatmadan önce `showCustomConfirm` ile onay istenir; onaylanmazsa modal açık kalır. |
| `src/modules/inventory-logic.js` | `saveProduct()` başarılı kayıttan sonra `isCloning` bayrağını temizler (Kaydet akışında onay sorulmaması için). |
| `style.css` | `.fab-btn-clone` ve `.bs-btn-clone` renk/stil sınıfları eklendi (mevcut FAB/Bottom Sheet buton şablonuyla tutarlı). |
| `scratch/flow-tests.js` | Yeni `cloneProduct` senaryosu eklendi: kopyalama doldurma, id bağlanmaması, `makeId()` ile yeni kayıt, B2'de alınan alanlar, iptal emniyet kilidi (Vazgeç/Onayla), normal düzenleme kapatmasının onay istemediği doğrulanır. |

## 3. Korunan davranış ve sınırlar

- `saveProduct()`'ın mevcut düzenleme/yeni-kayıt ayrım mantığı (`isEdit` → `updateItem`, aksi halde `appendItem` + `makeId()`) değiştirilmedi; kopyalama yalnızca "her zaman yeni kayıt" yolunu kullanır.
- `Schema.validateB1`/`validateB2` sözleşmelerine dokunulmadı; kopyalanan ürün normal "yeni ürün ekle" ile aynı alan kümesini gönderir, dolayısıyla aynı doğrulamadan geçer.
- `escapeHtml` kullanımı korunmuştur; yeni buton metinleri sabit string'dir, kullanıcı verisi `innerHTML` ile basılmamıştır (modal başlığı `title.innerText` ile, XSS'e kapalı).
- `admin.html`'de `#productModal` hiç yüklenmediği için (mevcut mimari notu, `inventory-management.js` içinde belgelenmiş) bu özellik yalnızca `index.html` (B1/B2 depo sayfası) kapsamındadır.
- Bu görev kapsamı dışındaki, çalışma ağacında halihazırda bulunan ilişkisiz değişikliklere dokunulmadı.

## 4. Doğrulama

| Komut/Senaryo | Sonuç |
|---|---|
| `npm run lint:xss` | Başarılı — 203 sink, izinsiz sink: 0 |
| `node --test tests/unit/stock-schema.test.mjs` | Başarılı — 8/8 test geçti (validateB1/B2 sözleşmeleri etkilenmedi) |
| `node scratch/flow-tests.js cloneProduct --emu` | Başarılı — Firebase emülatörü (Firestore+Auth) üzerinde: modal başlığı/alan doldurma, `editId` bağlanmaması, `appendItem` ile yeni id üretimi (orijinal id gönderilmedi), B2 kopyasında seri no alanı olmadığının doğrulanması, Vazgeç→modal açık kalır, Onayla→modal kapanır ve bayrak temizlenir, normal "Düzenle" kapatmasının onay istemediği — tüm alt kontroller beklenen sonucu verdi. |
| `node scratch/flow-tests.js idBasedProductOps --emu` | Başarılı — mevcut id-bazlı ürün akışları (düzenleme, sevk, çıkış, toplu işlemler) regresyonsuz çalışmaya devam ediyor. |

## 5. Sonuç

B1/B2 depolarında operasyonel hızı artıracak "Ürünü Kopyala" özelliği eklendi: tek tıkla, orijinal ürünün alanlarıyla önceden doldurulmuş yeni bir ürün formu açılıyor, kayıt daima `makeId()` ile yepyeni bir doküman olarak oluşuyor ve kazara veri kaybını önlemek için kopyalama modunda özel bir iptal onayı devrede. Mevcut şema sözleşmeleri, XSS koruması ve id-bazlı diğer ürün akışları değişmeden korundu.
