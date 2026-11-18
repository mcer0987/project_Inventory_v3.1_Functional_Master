# İP-3 Mobil ve Dokunmatik Ürün Formu — Implementation Walkthrough

> **Tarih:** 11.11.2026
> **Dal:** `feat/v3.6-raf-sayim-envanter-no-mobil-form` (İP-2 sonrası `d51ab28`)
> **Durum:** Uygulandı; birim (gerçek tarayıcı dahil) ve uygulama içi mobil görünüm testleri geçti. **Canlıya yayın yapılmadı.**
> **Kapsam:** Ürün Ekle/Düzenle modalında (ve yönetim panelindeki hızlı ürün kartında):
> - klavye açıkken alanlar arasında kolay geçiş;
> - odaklanan alanın klavyenin üstünde görünür kalması;
> - Kaydet'e kaydırmadan ulaşma.
> **Plan:** [00 Uygulama Planı ve Mimari Uyum İncelemesi](./00%20Uygulama%20Planı%20ve%20Mimari%20Uyum%20İncelemesi.md) · İP-3 bölümü.

## İçindekiler

1. [Talepler ve karşılıkları](#1-talepler-ve-karşılıkları)
2. [Kullanıcının gördüğü davranış](#2-kullanıcının-gördüğü-davranış)
3. [Teknik akış](#3-teknik-akış)
4. [Değişen dosyalar](#4-değişen-dosyalar)
5. [Test ve doğrulama](#5-test-ve-doğrulama)
6. [Yayın adımları](#6-yayın-adımları)
7. [Sınırlar ve bilinen konular](#7-sınırlar-ve-bilinen-konular)
8. [Yerel test walkthrough](#8-yerel-test-walkthrough)

---

## 1. Talepler ve karşılıkları

| # | Talep | Sonuç |
|---|---|---|
| 1 | Bir alandayken sonraki alana kolayca geçilebilsin | Klavyedeki tuş **"İleri / Sonraki"** olur (`enterkeyhint`); son alanda **"Bitti"**. Enter bir sonraki alana geçer, yalnız son alanda kaydeder. Önceden herhangi bir alanda Enter formu hemen gönderiyordu. |
| 2 | Klavye ekranın yarısını kaplıyor; klavyeyi kapatıp kaydırıp yeniden açmak gerekiyor | Dokunmatik cihazda klavyenin hemen üstünde **‹ Önceki · Sonraki › · Kaydet** çubuğu. Düğmeler klavyeyi kapatmaz. Klavye açılınca pencere görünür alana sığar ve odaklanan alan ortalanır. |
| 3 | Deneyim güzelleşsin | Seçim kutuları üstte, yazılan alanlar art arda: **Ürün Adı → Marka → Adet → Açıklama**. Adet sayısal klavye açar. Başlık (plaka ile) ve kapatma düğmesi kaydırmada görünür kalır. Klavye kapalıyken Kaydet altta sabit, açıkken çubukta. Etikete dokununca alan seçilir. |

## 2. Kullanıcının gördüğü davranış

**Telefonda Ürün Ekle:**
1. Ürün Adı'na dokunun; klavye açılır, çubuk klavyenin üstünde belirir.
2. Pencere görünür alana kayar: başlık ve plaka sıkışık biçimde üstte, ürün adı ortada.
3. Klavyedeki "İleri" ya da çubuktaki "Sonraki ›" ile Marka → Adet (sayısal klavye) → Açıklama sırasıyla gelir. Alan değişirken klavye kapanmaz.
4. Son alanda klavyede "Bitti" ya da çubukta "Kaydet". "‹ Önceki" geri döner; ilk alanda "Önceki", son alanda "Sonraki" pasiftir.
5. Alan dışına dokununca çubuk kaybolur ve pencere eski yerleşimine döner.

**Diğer bağlamlar:**
- **Masaüstü:** çubuk açılmaz. Enter'ın sonraki alana geçmesi dışında davranış değişmedi.
- **Yönetim paneli › Envanter Yönetimi › Yeni Ürün Ekle** (hızlı kart): aynı geçiş ve çubuk. Kart görünür alana sığar.

## 3. Teknik akış

| Parça | Ayrıntı |
|---|---|
| `src/ui/form-keyboard-nav.js` (`window.AppModules.FormKeyboardNav`) | `attach(form)` bir kez bağlanır. **Gezilecek alanlar:** görünür, etkin, salt okunur olmayan input/select/textarea; onay kutusu ve kilitli plaka atlanır. **`enterkeyhint`:** odak her geldiğinde yeniden hesaplanır, çünkü plakanın kilitli/yazılabilir durumu alan kümesini değiştirir. **Enter:** metin alanında `preventDefault`; sonraki alan varsa odak, yoksa `requestSubmit` (tarayıcı doğrulaması korunur). |
| Dokunmatik çubuk | Yalnız `(pointer: coarse)`. Tek ve paylaşılan bir öğedir. `pointerdown`/`mousedown` engellenir, böylece odak (ve klavye) formda kalır. Konum `barOffset(innerHeight, visualViewport)` ile `translateY(-…)`. |
| Görünür alana sığdırma | `visualViewport` boyutu `--vv-h` / `--vv-top` olarak yazılır. Görünür alan 120 px'ten fazla küçüldüyse modal `.kb-open` alır. Mobil CSS modalı görünür alanın üstüne hizalar ve yüksekliği klavye + çubuk kadar kısaltır. Görünür alan değişince odaklı alan `scrollIntoView({block:'center'})` ile ortalanır (azaltılmış hareket tercihinde animasyonsuz). |
| Yapışkan başlık ve kapat düğmesi | Başlık (`.product-modal-header`) `position: sticky`. Kapat `×` sıfır yükseklikli yapışkan bir blok olarak yer kaplamadan başlığın üstünde durur; kaydırma kabında `absolute` olsaydı içerikle birlikte kayardı. |
| Kaydet | Klavye kapalıyken altta yapışkan. Açıkken formdaki Kaydet gizlenir; Kaydet çubuktadır. |
| Bilinçli tercih | Genel viewport meta'ya `interactive-widget=resizes-content` **eklenmedi**: uygulamanın sabit alt gezintisini klavyenin üstüne taşırdı. Çözüm yalnız formun bulunduğu pencereyle sınırlı. |

## 4. Değişen dosyalar

| Dosya | Değişiklik |
|---|---|
| `src/ui/form-keyboard-nav.js` (yeni) | Gezinme yardımcısı; `nextField` ve `barOffset` saf. |
| `index.html` | Alan sırası (Durumu seçimlerle üstte), etiketlerde `for`, Adet'te `inputmode="numeric"` / `min` / `step`, `autocapitalize`; betik yüklenir. |
| `admin.html` | Betik yüklenir. |
| `src/ui/ui-components.js` | Ürün modalı açılınca `FormKeyboardNav.attach`. |
| `src/modules/admin/inventory-management.js` | Hızlı ürün kartı: `attach`, `.quick-product-card`, `data-kb-modal`. |
| `style.css` | Çubuk (açık/koyu tema, azaltılmış hareket) ve hızlı ürün kartı. |
| `mobile-responsive.css` | Klavye açıkken modal yerleşimi, yapışkan başlık/kapat/Kaydet, sıkışık plaka. |
| `scratch/hosting-files.js` | Beklenen yayın dosyası 110 → 111. |
| `tests/unit/form-keyboard-nav.test.mjs` (yeni) | 2 saf test + 2 gerçek tarayıcı testi (Puppeteer). |

## 5. Test ve doğrulama

### 5.1 Komutlar

| Komut | İP-2 sonrası | İP-3 sonrası |
|---|---|---|
| `npm run test:unit` | 375/375 | **382/382** (4 yeni form testi; kalan fark paralel çalışmanın testleri) |
| `npm run test:rules` | 398/398 | **398/398** |
| `npm run lint:xss` | 0 izinsiz | **0 izinsiz** |
| Hosting (bu commit'in dosyaları) | 110 | **111** |

### 5.2 Birim testi (gerçek tarayıcı) — `form-keyboard-nav.test.mjs` 4/4

| Kontrol | Sonuç |
|---|---|
| `nextField`: ileri/geri, sınırlar, listede olmayan alan | ✔ |
| `barOffset`: klavye kapalı 0; açık 444 px; kaydırılmış görünür alan | ✔ |
| Enter zinciri: salt okunur, onay kutusu ve gizli alan atlanır; `enterkeyhint` next/done; son alana kadar gönderim yok, son alanda bir kez | ✔ |
| Dokunmatik: çubuk görünür, klavyede `translateY(-444px)`, modal `.kb-open`, `--vv-h: 400px`; Sonraki/Önceki/Kaydet dokunuşla çalışır; odak çıkınca kapanır | ✔ |

### 5.3 Uygulama içi (index/admin, 390×844 dokunmatik, klavye taklidi) — 11/11

| Kontrol | Sonuç |
|---|---|
| Alan sırası: plaka → Sütun → Raf → Tür → Durumu → Ürün Adı → Marka → Adet → Açıklama | ✔ |
| `enterkeyhint`: next … done | ✔ |
| Adet sayısal klavye (`inputmode=numeric`) | ✔ |
| Klavye açık: pencere görünür alanın içinde, çubuğun üstünde (üst 8, alt 354; çubuk 365–420) | ✔ |
| Odaklı alan görünür alanda (161–201) | ✔ |
| Yapışkan başlık görünür; klavye açıkken Kaydet çubukta, formdaki gizli | ✔ |
| Enter ve "Sonraki" alanı ilerletir, klavye açık kalır, alan görünür | ✔ |
| Son alana kadar kayıt yok; son alanda Enter kaydeder | ✔ |
| Masaüstü: çubuk ve klavye düzeni devreye girmez | ✔ |
| Admin hızlı ürün kartı: klavye düzeni, çubuk, `enterkeyhint` | ✔ |
| Sayfa hatası yok | ✔ |

Görünüm, mobilde klavye açık/kapalı ve masaüstünde ekran görüntüleriyle kontrol edildi.

## 6. Yayın adımları

Yalnız hosting değişikliği; kural değişikliği yok. `node scratch/hosting-files.js` → `firebase deploy --only hosting`. **Bu teslimde yayın yapılmadı.**

## 7. Sınırlar ve bilinen konular

- **Headless tarayıcıda ekran klavyesi açılamaz;** klavye `visualViewport` taklidiyle sınandı. Gerçek Android/iPhone'da elle deneme önerilir (§8).
- **iOS Safari'nin kendi ‹ › Bitti çubuğu** da görünür; uygulamanın çubuğu onun üstünde durur ve Kaydet'i de içerir.
- **Seçim kutuları** (Sütun, Raf, Tür, Durumu) yerel seçici açar. "Sonraki" bir seçim kutusuna gelirse odaklar; Android'de seçici dokunuşla açılır.
- **Paralel çalışma notu:** bu commit yalnız İP-3 parçalarını içerir. Çalışma ağacındaki `development-notice`, satın alma dosya alanı, giriş seçenekleri, EBYS tanımları ve ilgili testler commit'e alınmadı. `development-notice.js` ile yayın sayacı 112 olmalıdır; o değişikliğin kendi commit'inde güncellenmelidir.

## 8. Yerel test walkthrough

1. `npm run serve` → telefonda aynı ağdan ya da Chrome DevTools cihaz kipinde (`Ctrl+Shift+M`, iPhone) `index.html?emu=1`. Yönetici girişi.
2. **B1 › Ürün Ekle:**
   1. Ürün Adı'na dokunun.
   2. Klavyedeki "İleri" ile Marka → Adet (sayı klavyesi) → Açıklama; son tuş "Bitti".
   3. Çubuktaki ‹ Önceki / Sonraki › / Kaydet ile aynı yolu deneyin; klavye kapanmamalı.
3. **Gerçek cihazda:** klavye açıkken alanın klavyenin arkasında kalmadığını, başlığın ve × düğmesinin göründüğünü kontrol edin.
4. **Masaüstünde:** Enter'ın sonraki alana geçtiğini, son alanda kaydettiğini doğrulayın.
