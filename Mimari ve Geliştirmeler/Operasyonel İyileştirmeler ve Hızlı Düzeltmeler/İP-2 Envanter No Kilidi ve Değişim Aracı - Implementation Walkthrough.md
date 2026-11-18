# İP-2 Envanter No Kilidi ve Değişim Aracı — Implementation Walkthrough

> **Tarih:** 11.11.2026
> **Dal:** `feat/v3.6-raf-sayim-envanter-no-mobil-form` (İP-1 sonrası `78c4149`)
> **Durum:** Uygulandı; birim, kural, emülatör ve tarayıcı testleri geçti. **Canlıya yayın yapılmadı.** Yayında önce Firestore kuralları, sonra hosting gider (§7).
> **Kapsam:**
> - Ürün modalında Envanter No sağ üstte, değiştirilemeyen "demirbaş plakası" olur.
> - Dolu numaranın tek değişim yolu Operasyon Merkezi'ndeki araçtır: arama → "Bu mu?" → tüm bilgilerin olduğu pencere → yeni numara.
> - Kilit kurallarda da zorlanır; cihaz geçmişi eski numaranın kayıtlarını da gösterir.
> **Plan:** [00 Uygulama Planı ve Mimari Uyum İncelemesi](./00%20Uygulama%20Planı%20ve%20Mimari%20Uyum%20İncelemesi.md) · İP-2 bölümü.

## İçindekiler

1. [Talepler ve karşılıkları](#1-talepler-ve-karşılıkları)
2. [Kullanıcının gördüğü davranış](#2-kullanıcının-gördüğü-davranış)
3. [Güvenlik modeli](#3-güvenlik-modeli)
4. [Teknik akış](#4-teknik-akış)
5. [Değişen dosyalar](#5-değişen-dosyalar)
6. [Test ve doğrulama](#6-test-ve-doğrulama)
7. [Yayın adımları](#7-yayın-adımları)
8. [Sınırlar ve bilinen konular](#8-sınırlar-ve-bilinen-konular)
9. [Yerel test walkthrough](#9-yerel-test-walkthrough)

---

## 1. Talepler ve karşılıkları

| # | Talep | Sonuç |
|---|---|---|
| 1 | Ürün Ekle modalında Envanter No sağ üstte, dokunulmaz ve "premium" görünsün; demirbaş olduğu hissedilsin | Başlıkta altın/metal çerçeveli **"DEMİRBAŞ NO" plakası**: tek aralıklı numara, perçin işaretleri, kilit simgesi; açık ve koyu tema. |
| 2 | Kayıtlı ürünün numarası değiştirilemesin | Düzenlemede dolu numara salt okunur ve kilitlidir; ipucu *"Değişim: Yönetim Paneli › Operasyon Merkezi"*. Form numarayı göndermez; defter (`envanter-no-locked`) ve kurallar da reddeder. Numarası boş eski kayıtta **"Numara ata"** ile bir kez atanır. |
| 3 | Değişim için Operasyon Merkezi'nde küçük bir alan | **"🏷️ Envanter No Değişimi"** kartı: kısa açıklama, "Nasıl çalışır?" yardım alanı ve arama kutusu. |
| 4 | Numarayı her depoda, servis ve hurdada arasın | B1/B2 depo satırları, açık servis kayıtları (anlık görüntüdeki numara dahil), hurda kayıtları ve (onaylı karar) aktif zimmetler aranır. Büyük/küçük harf ve boşluk farkı önemsizdir. |
| 5 | "Bu mu?" desin; evet derse ürünün tüm bilgileri açılsın ve yeni numara sorulsun | Her sonuçta "Bu mu?" düğmesi. Açılan pencerede mevcut numara plakası, ürün bilgileri, konum, değişecek kayıtlar, yeni numara (canlı çakışma denetimi) ve gerekçe. İki adımlı onay: *"Onayla: ESKİ → YENİ"*. |
| 6 | (Onaylı karar) Yalnız güncel kayıt değişsin, iz kalsın | Cihazın şu anki kaydı ve bağlı depo satırı değişir. Geçmiş çıkış/zimmet kayıtları ve basılmış tutanaklar eski numarayla kalır. Eski → yeni değer denetim kaydına yazılır; cihaz geçmişi ikisini birlikte gösterir. |

## 2. Kullanıcının gördüğü davranış

### 2.1 Ürün modalı (index.html)

| Durum | Görünüm |
|---|---|
| Ürün Ekle / Kopyala | Plaka yazılabilir. İpucu: *"Bir kez yazılır; kayıttan sonra kilitlenir."* |
| Düzenle, numara dolu | Plaka kilitli (🔒), salt okunur, `aria-readonly`. Kaydet numaraya dokunmaz; diğer alanlar kaydedilir. |
| Düzenle, numara boş ya da "-" | Plakada "—" ve **"Numara ata"** düğmesi. Basınca alan yazılabilir olur; kayıttan sonra kilitlenir. |

- **Mobil (≤600 px):** plaka başlığın altına tam genişlikte iner.
- **Koyu tema:** koyu bronz zemin ve altın yazı.

### 2.2 Operasyon Merkezi › Envanter No Değişimi (admin.html)

1. **Ara:** numarayı yazıp "Ara"ya basın.
   - **Sonuç kartları:** *"📌 Zimmette · Kişi"*, *"🛠️ Serviste · Hedef (durum)"*, *"♻️ Hurda · tarih"*, *"📦 Depoda · B2 · Raf … · N adet"*. Her kartta ürün adı, marka/tür/seri no.
   - **Aynı numara birden fazla yerdeyse:** uyarı çıkar; yönetici değiştireceği kaydı seçer.
   - **Bekleyen iade talebi varsa:** *"bu talep eski numarayla kalır"* uyarısı.
   - **Geçmiş kayıtlar:** "Geçmiş kayıtlar (N) — değişmez" başlığı altında, kapalı.
   - **Eski biçimli zimmet** (b3 ikizi olmayan): "Bu mu?" kapalı, nedeni yazılı.
2. **Bu mu? → pencere:**
   - **Mevcut Demirbaş No plakası** ve ürün bilgileri: ürün, marka, tür, konum, depo/raf/sütun, adet, durum, seri no, açıklama, kişi, servis hedefi, tarih.
   - **Değişecek kayıtlar:** ör. hareket kaydı (b3), zimmet kaydı, B2 depo satırı.
   - **Yeni numara:** yazdıkça denetlenir. Kullanımdaki bir numara kırmızıyla engellenir (*"… şu an kullanımda: Depoda · B2 …"*). Yalnız geçmişte görülen numara turuncu uyarı verir.
   - **Onay:** "Devam" düğmesi *"Onayla: V36-ENV-005 → V36-ENV-555"* olur; ikinci basışta kaydedilir. Kayıt öncesinde numara sunucuda yeniden denetlenir.
   - **Başarı:** *"Envanter No ESKİ → YENİ olarak değiştirildi (3 kayıt). Değişim güvenlik raporuna yazıldı."* Arama yeni numarayla yenilenir.

### 2.3 Cihaz geçmişi

Cihaz geçmişi penceresi (yönetici), numaranın değişim zincirini başlıkta gösterir: *"Envanter No değişim zinciri: … — bu numaraların kayıtları da listelenir"*. Eski numarayla yazılmış hareketler de listelenir.

## 3. Güvenlik modeli

- **Kurallar (`firestore.rules` · `envanterNoChangeOk`):**
  - **Boş numara** (alan yok, `''` ya da `'-'`) bir kez atanabilir.
  - **Dolu numara** yalnız boş olmayan bir değere değişir ve şu koşulların hepsi gerekir:
    - Kayıttaki yeni `sonEnvanterNoDegisimId`, **aynı commit'te oluşturulan** bir denetim kaydını gösterir. Commit öncesinde o kimlikte kayıt yoktur (`!exists`).
    - O kaydın türü `envanter-no-degisim`, `fromValue` eski ham değer, `toValue` yeni değerdir.
    - Kaydı yazan, işlemi yapan kullanıcıdır.
  - Desen personel çıkışındaki `sonCikisId` ile aynıdır.
  - Numara değişmeyen yazımlar ek belge erişimi yapmaz. Geri yükleme kilidi (`restoreLock`) altında kanıt aranmaz.
- **Saldırı senaryoları:** kanıtsız değişim, boşaltma, alanı silme, uyuşmayan kanıt (eski/yeni değer, tür, kimlik) ve önceden var olan kaydı kanıt olarak yeniden kullanma reddedilir (`rules.test.mjs`).
- **Defter:** `planProductSave` dolu numaranın değişimini `envanter-no-locked` ile reddeder. Aynı numaranın yazım farkı yazılmaz. `sonEnvanterNoDegisimId` ürün kaydından yazılamaz.
- **Şema:** `sonEnvanterNoDegisimId` (string) b1/b2 isteğe bağlı alanlarına eklendi; kapalı küme bilinçli olarak genişledi.
- **Değişim yazımı:** şema ve sahiplik muhafızlarından, toplu yazma kilidi ve yönetici ön denetiminden geçer. Denetim kaydı işlemle **aynı transaction'da**, sunucu saatiyle yazılır (Sütun 2-3).
- **Geçmiş korunur (Sütun 1):** geçmiş kayıtlar değişmez; cihaz geçmişi zinciri denetim kayıtlarından kurulur. auditLogs'u yalnız yönetici okur; personel oturumunda geçmiş yalnız güncel numarayla gösterilir.

## 4. Teknik akış

1. **Arama (saf, `inventory-no-rename.js` · `findMatches`):**
   - Numara normalize edilir.
   - **Depo satırı** → `depo`.
   - **b3:** `tip:'zimmet'` ve iade edilmemiş → `zimmet` (varsa `assignments` ikizi); `tip:'hurda'` → `hurda`; diğerleri → geçmiş.
   - **Servis:** `kapandi !== true` ve `envanterNo` ya da `originalData.envanterNo` eşleşirse → `servis`; kapalı olan → geçmiş.
   - **Bağlı depo satırı:** zimmet, servis ve hurda kaydının `productId` + `kaynakDepo` ile bağlı, aynı numaralı depo satırı (adet 0 kalmış) aynı cihazın parçasıdır. Ayrı sonuç olarak listelenmez, hedeflere eklenir.
2. **Yeni numara denetimi:**
   - Canlı veride `checkNewNumber`; kullanımdaysa engel, yalnız geçmişteyse uyarı.
   - Kayıtta ek olarak sunucudan taze, indeksli sorgu: b1, b2, b3, assignments, serviceRecords için `envanterNo in [yazılan, normalize]`, serviceRecords için `originalData.envanterNo in […]`. Transaction içinde sorgu yapılamadığı için öncesinde çalışır.
3. **Yazma (`runInventoryNoRename`):**
   - Denetim kaydı kimliği önceden üretilir.
   - Tek transaction: hedefler taze okunur; plan taze kayıtlarla yeniden kurulur, numara bu arada değiştiyse `conflict`.
   - Depo satırına `envanterNo`, `sonEnvanterNoDegisimId`, `lastUpdate`; b3 ve zimmet ikizine `envanterNo`; servis kaydının `originalData` alanına **tam harita** (nokta yolu değil).
   - Aynı transaction'da denetim kaydı: `fromValue` depo satırının **ham** eski değeridir; kural birebir karşılaştırır.
4. **Sonrası:** yerel bellek ve tablolar güncellenir; eski → yeni eşlemesi cihaz geçmişi zincirine eklenir.

## 5. Değişen dosyalar

| Dosya | Değişiklik |
|---|---|
| `index.html` | Ürün modalı başlığında demirbaş plakası; eski Envanter No alanı kaldırıldı; yeni modül yüklenir. |
| `src/ui/ui-components.js` | `_setAssetPlate`: editable / locked / assignable durumları; "Numara ata". |
| `src/modules/inventory-logic.js` | Kilitli plakada numara gönderilmez. |
| `src/services/stock-ledger.js` | `planProductSave` Envanter No kilidi. |
| `src/utils/schema.js` | `sonEnvanterNoDegisimId` isteğe bağlı string alan. |
| `firestore.rules` | `envanterNoChangeOk` / `envanterNoAuditOk` (`stockUpdateOk` içinde). |
| `src/utils/inventory-no-rename.js` (yeni) | Saf modül: `findMatches`, `checkNewNumber`, `planRename`, eski numara zinciri. |
| `src/services/firebase-handler.js` | `buildAuditRecord` önceden verilen kimlik; `checkInventoryNoAvailable`, `runInventoryNoRename`, `loadInventoryNoAliases`. |
| `src/modules/admin/inventory-no-change.js` (yeni), `admin-main.js`, `admin.html` | Operasyon Merkezi kartı ve değişim penceresi. |
| `src/services/assignment-service.js`, `src/ui/device-ids.js` | Cihaz geçmişinde eski numara zinciri. |
| `style.css` | Plaka (açık/koyu/mobil) ve kart/pencere stilleri. |
| `scratch/hosting-files.js` | Beklenen yayın dosyası 108 → 110. |
| Testler | `inventory-no-rename.test.mjs` (yeni, 7), `stock-ledger.test.mjs`, `stock-schema.test.mjs`, `rules.test.mjs` (6 yeni), `stock-ledger.emu.test.mjs` (1 yeni). |

**Bilinçli test beklentisi değişikliği (KURAL 5):** `stock-schema.test.mjs` kapalı alan kümesine `sonEnvanterNoDegisimId` eklendi; tip testi sayıyı reddeder. Mevcut "B1/B2 envanterNo alanını destekler" testi değişmedi: numarası olmayan kayda ilk atama hâlâ serbesttir.

## 6. Test ve doğrulama

### 6.1 Komutlar

| Komut | İP-1 sonrası | İP-2 sonrası |
|---|---|---|
| `npm run test:unit` | 367/367 | **375/375** |
| `npm run test:rules` | 392/392 | **398/398** |
| `npm run test:ledger:emu` | 31/31 | **32/32** (saf planın yazımları üretim kurallarından geçer) |
| `npm run test:atomic:emu` | 10/10 | **10/10** |
| `npm run lint:xss` | 0 izinsiz | **0 izinsiz** (87 dosya) |
| `node scratch/hosting-files.js` | 108 | **110** (bu commit'in dosyaları) |

### 6.2 Tarayıcı (yerel emülatör, gerçek admin oturumu) — 15/15

| Kontrol | Sonuç |
|---|---|
| Ürün Ekle: plaka yazılabilir | ✔ |
| Düzenle (dolu numara): kilitli, salt okunur, ipucu "Operasyon Merkezi" | ✔ |
| Kilitli plakada alan zorla değiştirilip kaydedilse de numara değişmez; ad değişir | ✔ |
| Servis yolu da dolu numarayı değiştirmez → `envanter-no-locked` | ✔ |
| Boş numara: "Numara ata" ile bir kez atanır | ✔ |
| Kart: kısa açıklama + "Nasıl çalışır?" yardım alanı | ✔ |
| Arama (`" v36-env-005 "`): zimmetteki cihaz tek sonuç; geçmiş çıkış ayrı | ✔ |
| "Bu mu?" → tüm bilgileri ve değişecek 3 kaydı gösteren pencere | ✔ |
| Kullanımdaki numara canlı denetimde engellenir | ✔ |
| İki adımlı onay: "Onayla: V36-ENV-005 → V36-ENV-555" | ✔ |
| b3 zimmet, zimmet ikizi ve bağlı depo satırı yeni numarada; geçmiş çıkış eski numarada | ✔ |
| Denetim kaydı: tür, eski → yeni, gerekçe | ✔ |
| Başarıdan sonra arama yeni numarayla yenilenir | ✔ |
| Cihaz geçmişi: değişim zinciri ve eski numaralı çıkış kaydı | ✔ |
| Sayfa hatası yok | ✔ |

Plaka açık ve koyu temada ekran görüntüsüyle kontrol edildi.

## 7. Yayın adımları

1. **Önce kurallar:** `firebase deploy --only firestore:rules`.
   - Yeni kural, dolu numarayı kanıtsız değiştiren eski istemcileri reddeder; bu bilinçli kilittir.
   - Eski istemcinin ürün formundan numara değiştirme denemesi "yetki/kural" hatası alır. Yayın, kurallar ile hosting arasında kısa sürede tamamlanmalıdır.
2. **Sonra hosting:** `node scratch/hosting-files.js` → `firebase deploy --only hosting`.
3. Veri göçü gerekmez.

**Bu teslimde yayın yapılmadı.**

## 8. Sınırlar ve bilinen konular

- **Kurallar kilidi b1/b2 depo satırında uygular** (cihaz kimliğinin sahibi). b3, assignments ve serviceRecords yönetici yazmalarında alan beyaz listesi olmadığından bu koleksiyonlardaki numara değişimi servis katmanında denetlenir.
- **Bekleyen iade talebi** eski numarayla kalır; iade kuralları yöneticiye yalnız karar alanlarını yazdırır. Pencerede uyarı verilir.
- **Aynı numarayı taşıyan birden fazla depo satırı** (mükerrer) varsa değişim reddedilir; önce mükerrer kayıt düzeltilmelidir.
- **Personel oturumunda cihaz geçmişi zinciri gösterilmez;** auditLogs yalnız yöneticiye açıktır.
- **Paralel çalışma notu:** bu commit yalnız İP-2 parçalarını içerir. Çalışma ağacındaki başka değişiklikler (`development-notice` özelliği, satın alma dosya alanı, giriş seçenekleri, `script.js` arama satırları, EBYS tanımları ve stage edilmiş silmeler) commit'e alınmadı ve olduğu gibi bırakıldı. `development-notice.js` eklendiğinde yayın sayacı 111 olmalıdır; o değişikliğin kendi commit'inde güncellenmelidir.

## 9. Yerel test walkthrough

1. Emülatör ve sunucu: `npm run emu`, `npm run emu:seed`, `npm run serve`. Yönetici girişi: `emu-yonetici-0001`.
2. **index.html › B2 › Ürün Ekle:** sağ üstte "DEMİRBAŞ NO" plakası yazılabilir. Numara girip kaydedin.
3. **Aynı ürünü Düzenle:**
   - Plaka kilitli. Adı değiştirip kaydedin; numara aynı kalır.
   - Numarası boş bir ürünü düzenleyin: "Numara ata" ile numara verin.
4. **Yönetim Paneli › Operasyon Merkezi › Envanter No Değişimi:**
   1. Numarayı arayın ve "Bu mu?"ya basın.
   2. Başka bir ürünün numarasını yazın; kırmızı engel görünmeli.
   3. Boşta bir numara yazın, Devam → Onayla.
5. **Sonucu kontrol edin:**
   - Ürün yeni numarada.
   - Üst çubuk › **Güvenlik Raporu**nda `envanter-no-degisim` kaydı var.
   - Cihaz geçmişinde "değişim zinciri" satırı görünüyor.

## 10. Ek (11.11.2026) — sarf üründe plaka, cihaz satırında otomatik demirbaş no

| Konu | Sonuç |
|---|---|
| Sarf ürün | Envanter No alanı (plaka) gösterilmez ve numara gönderilmez. Karar #isDemirbas kutusundan; tür seçimi kutuyu ayarlar. Tür demirbaşa çevrilince plaka görünür ve yazılabilir olur. Numarası zaten dolu eski bir sarf kaydında veri kaybolmasın diye salt okunur "ENVANTER NO" olarak görünür. |
| Otomatik demirbaş no | Envanter çıkışı, sevk (servis, dış birim, hurda), zimmet, talep onayı ve sepette ürün kaydında numara varsa 1. cihaz satırının Envanter No'su otomatik gelir ve kilitlidir (`DeviceIds.fixedFor` / `render({ fixed })`). Seri No kayıtta varsa ön dolar ve düzeltilebilir. Kayıt anında kilitli satırın değeri ekrandan değil ürün kaydından okunur. Numarası olmayan üründe eski davranış sürer. |
| Test | `device-ids-fixed.test.mjs` (gerçek tarayıcı) 1/1. Emülatörde tarayıcı 8/8: sarf düzenle/ekle plaka gizliliği, demirbaş kilidi, çıkış ve servise sevkte otomatik ve kilitli numara. Gerçek personel hesabıyla (`flow.personel`) sayımdaki raf ürününün görünmemesi ve çıkışın reddi de bu turda doğrulandı. `npm run test:unit` 386/386, `lint:xss` 0 izinsiz. |

## 11. Ek (11.11.2026) — plaka yerine kompakt alan; çok adetli demirbaş

Geri bildirim: plaka büyüktü ve renk temasına uymuyordu; pencereyi genişletip yükseltiyordu. Ayrıca demirbaşlar bazen adet bazlı girilir (ör. 32 adet) ve numaralar envanter çıkışında cihaz başına yazılır.

| Konu | Sonuç |
|---|---|
| Görünüm | Başlıktaki plaka kaldırıldı. Envanter No, Marka'nın altında, formun diğer alanlarıyla aynı görünümde normal bir alan. Kilitliyken etikette 🔒 simgesi var; alan gri ve salt okunur. Renkler tema değişkenlerinden gelir; açık ve koyu temada uyumlu. Operasyon Merkezi penceresindeki numara da sade bir rozet. |
| Tek cihazlık demirbaş (adet 1) | Alan isteğe bağlı bir input gibi davranır: bir kez yazılır, kayıttan sonra kilitlenir. Boş numara "Numara ata" ile bir kez atanır. |
| Çok adetli demirbaş (adet > 1, numarasız) | Alan devre dışı ve boş. İpucu: *"Çok adetli kayıtta girilmez; numaralar çıkış, zimmet ve sevkte cihaz başına yazılır."* Yazılmış değer temizlenir, gönderilmez. Adet 1'e dönünce alan yeniden açılır. Çıkış, zimmet ve sevkte cihaz satırları boş ve yazılabilir gelir; mevcut tekillik denetimi (`checkDeviceIds`) aynen çalışır. |
| Kurallar ve defter | Değişmedi. Dolu numara yine yalnız Operasyon Merkezi'nden ve denetim kaydıyla değişir. |
| Test | Emülatörde tarayıcı 7/7: çok adetli demirbaşta alan devre dışı; numaralı demirbaşta kilit; adet 1 ↔ 32 geçişi; 32 adetlik üründen çıkışta boş ve yazılabilir cihaz satırları; sayfa hatası yok. `npm run test:unit` 386/386, `lint:xss` 0 izinsiz. Masaüstü ve mobil ekran görüntüleri kontrol edildi. |

## 12. Ek (11.11.2026) — bütünlük doğrulaması ve "demirbaş tekrar girilemez" kuralı

**Bulgu ve düzeltme.** Excel importunda Envanter No cihaz numarası değil, **stok satırının kimliğidir**: her satırda zorunludur ve adet 32 olabilir. §10'daki otomatik doldurma bu tür çok adetli satırda numarayı her çıkışta 1. cihaza yazardı. Sonuçta aynı numara farklı cihazların hareket kaydına geçer ve cihaz geçmişi karışırdı. `DeviceIds.fixedFor` artık yalnız tek cihazlık satırda (adet ≤ 1) numara döner. Çok adetli satırda cihaz satırları boş ve elle yazılır; tekillik denetimi her satırda çalışır. Kilitli cihaz satırının altın rengi tema renkleriyle değiştirildi.

**Tekrar giriş kuralının katmanları (değişmedi, doğrulandı):**

| Yol | Koruma | Sonuç |
|---|---|---|
| Ürün Ekle / Numara ata | B1+B2'de aynı numara (büyük/küçük harf ve boşluk farkı yok sayılır) varsa kayıt yapılmaz. Sayımdaki raf ürünleri de denetlenir (gizleme yalnız tabloda). | ✔ |
| Kayıtlı ürün | Numara kilitli; defter ve kurallar denetim kaydı olmadan değişimi reddeder. | ✔ |
| Operasyon Merkezi değişimi | Depo, zimmet, servis ve hurdadaki numaralar engel; sunucuda yeniden denetlenir. | ✔ |
| Excel import | Dosya içinde tekrar reddedilir; sistemde var olan numara atlanır ve raporlanır. v3.6 bu mantığa dokunmadı (yalnız sayımdaki rafa giden satır Havuz'a alınır). | ✔ (birim testleri) |
| Cihaz satırları (çıkış, sevk, zimmet, talep, sepet) | Aynı numara listede iki kez girilemez. Aktif zimmet veya servisteki numara ikinci kez çıkamaz. | ✔ |
| Kısmi transfer | Numaralı satır bölünemez. | ✔ (defter testi) |

**Grafikler.** Demirbaş/sarf çıkış grafikleri hareket kayıtlarındaki tür ve adetten sayılır; Envanter No'ya bağlı değildir, v3.6 dokunmadı. Sayımdaki raf ürünleri `window.data`'da kalır; yalnız tablo ve seçim listelerinden gizlenir.

**Test.**

- **Otomatik paketler:**
  - lint:xss 0 izinsiz
  - birim 386/386
  - kural 398/398
  - defter emülatörü 32/32
  - atomik yazıcı 10/10
  - sahiplik 22/22
  - personel 15/15
- **Tarayıcı (emülatör) 8/8:**
  - kayıtlı numarayla Ürün Ekle ve Numara ata reddedilir;
  - Operasyon Merkezi'nde başka kayıttaki numara engellenir;
  - listede aynı numara ve servisteki numara reddedilir;
  - çok adetli numaralı satırda otomatik dolma yok;
  - tek adetlik satırda var.
- **Uçtan uca akış testleri (`scratch/flow-tests.js --emu`, 56 senaryo):**
  - Düzenekteki giriş yolu, d2b117a'dan beri native olan kod alanına da yazacak şekilde düzeltildi.
  - Çalışma ağacı, commit'li HEAD ve v3.6 öncesi (`bce475c`) ayrı ayrı koşuldu. HEAD'de 17 senaryo düşüyor; v3.6 öncesinde aynı 17'si ve ek 2 senaryo düşüyor. **v3.6 yeni bir hata getirmedi.**
  - 17 eski hata düzenek bakımı işidir: EBYS, oturum ve dosya alanı değişiklikleri teste yansıtılmamış. v3.6 kapsamı dışında.

Elle test için: [v3.6 Kontrol Listesi](./v3.6%20Kontrol%20Listesi.md).
