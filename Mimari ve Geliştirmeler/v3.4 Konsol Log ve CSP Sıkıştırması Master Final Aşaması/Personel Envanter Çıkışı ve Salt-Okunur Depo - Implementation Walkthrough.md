# Personel Envanter Çıkışı ve Salt-Okunur Depo — Implementation Walkthrough

> **Tarih:** 05.11.2026
> **Dal:** `feat/v3.4-ebys-asama-5` (başlangıç HEAD `8350f91`; değişiklikler commit edilmedi)
> **Durum:** Uygulandı; kural, birim ve tarayıcı testleri geçti. **Canlıya yayın yapılmadı.** Yayında önce Firestore kuralları, sonra hosting gider (bkz. §7).
> **Kapsam:** "Envanter Çıkışı Yap" ekranının 10 kişilik BT ekibine açılması, "Alan Kişi" seçimi, "ITSM / Gerekçe" etiketi, depoların personel için salt-okunur olması, sağ tık ve geliştirici aracı kısayollarının engellenmesi.

## İçindekiler

1. [Talepler ve karşılıkları](#1-talepler-ve-karşılıkları)
2. [Kullanıcının gördüğü davranış](#2-kullanıcının-gördüğü-davranış)
3. [Güvenlik modeli: personel neden yalnız sarf çıkarabilir](#3-güvenlik-modeli-personel-neden-yalnız-sarf-çıkarabilir)
4. [Teknik akış](#4-teknik-akış)
5. [Değiştirilen ve eklenen dosyalar](#5-değiştirilen-ve-eklenen-dosyalar)
6. [Test ve doğrulama](#6-test-ve-doğrulama)
7. [Yayın adımları](#7-yayın-adımları)
8. [Sınırlar ve bilinen konular](#8-sınırlar-ve-bilinen-konular)
9. [Yerel test walkthrough](#9-yerel-test-walkthrough)

---

## 1. Talepler ve karşılıkları

| # | Talep | Sonuç |
|---|---|---|
| 1 | "SN / BioPro / Itsm" sütunu "ITSM / Gerekçe" olsun | B3 tablosu, kart detayı, Excel raporu sütunu, çıkış modalı ve uyarı metinleri değişti. |
| 2 | Yönetici çıkış yaparken "Alan Kişi" aranarak seçilebilsin | Aranabilir personel listesi eklendi (ad, kurumsal kimlik veya birim ile). Varsayılan değer yine yöneticinin kendisi. Kayıt seçilen kişinin envanterine yazılıyor. |
| 3 | Toplu çıkış modalındaki etiket de güncellensin | Güncellendi. Toplu çıkışa da aynı kişi seçici eklendi. |
| 4 | Çıkış ekranı personele açılsın; personel demirbaş çıkaramasın | Giriş hesabı olan personel sarf malzeme çıkışı yapabiliyor. Demirbaş ürünler listede kilitli görünüyor ve "Envanter Talep Et" yönlendirmesi gösteriliyor. Kısıt **Firestore kurallarında da** uygulanıyor. |
| 5 | Talepler admin ve muhammed.cer hesabında görünsün | **Geliştirme gerekmedi**, kodda doğrulandı (§2.4). |
| 6 | Diğer kullanıcılar B1/B2'yi yalnız görüntülesin; depo çubuğu (`uab-bar`) pasif olsun ve uyarı versin | Personelde çubuktaki tüm düğmeler pasif görünüyor ve tıklanınca tek bir açıklayıcı uyarı çıkıyor. Satır işlem menüsü (FAB / mobil alt menü) de salt-okunur oldu. |
| 7 | Depolarda sağ tık ve geliştirici araçları engellensin | `index.html`'de sağ tık menüsü ve geliştirici aracı / kaynak görüntüleme kısayolları kapatıldı. Tarayıcının kendi menüsünden açılan geliştirici araçları web sayfasınca engellenemez (§8). |

## 2. Kullanıcının gördüğü davranış

### 2.1 Personel (BT ekibi, giriş hesabı olan personel)

- **Envanter Takibi › Envanter Çıkışı Yap** ve **Toplu Çıkış Yap** artık açılıyor. Modalın başında rolüne göre kısa bir açıklama var: *"Sarf malzeme çıkışı yapabilirsiniz; stok düşer ve çıkış sizin adınıza kaydedilir. Demirbaş ürünler için 'Envanter Talep Et' ile yöneticiye talep gönderin."*
- **Ürün arama:** Demirbaş ürünler listede görünüyor ama soluk ve kilitli. Altında *"🛡️ Demirbaş — yalnız yönetici çıkış yapar; 'Envanter Talep Et' kullanın."* yazıyor. Tıklanınca bu açıklama uyarı olarak gösteriliyor.
- **Türü tanımsız ürün:** Ürünün türü "Ürün Türleri" listesinde birebir bulunmuyorsa ürün yine kilitli. Çıkışı yönetici yapıyor (§3).
- **Alan Kişi:** Personelin kendi adı, değiştirilemiyor.
- **Toplu çıkış:** Tek seferde en fazla **6 farklı ürün** eklenebiliyor (§3.3).
- **B1 / B2 depolar:** Çubuğun başında "🔒 Yalnız görüntüleme" rozeti var, düğmeler soluk. Tıklanınca şu uyarı çıkıyor: *"Depolar personel için yalnız görüntülenebilir. Sarf malzeme çıkışı için 'Envanter Takibi' sekmesindeki 'Envanter Çıkışı Yap' düğmesini kullanın."* Satıra tıklayınca stok, düzenleme ve silme düğmeleri yerine aynı yönlendirme görünüyor.

### 2.2 Yönetici (admin@medipol.local ve canlı yönetici hesabı)

- **Ürün kapsamı:** Önceki gibi her ürün (demirbaş dahil) çıkarılabiliyor.
- **Alan Kişi seçimi:** Alanda başlangıçta yöneticinin adı yazılı. Alana tıklanınca metin seçili hâle geliyor; yazmaya başlanınca liste açılıyor.
  - Arama ad, kurumsal kimlik (ör. `bora.k`) veya birim ile yapılabiliyor.
  - Liste fareyle ya da ok tuşları + Enter ile kullanılabiliyor.
  - Pasif personel listede çıkmıyor.
  - Listede olmayan bir ad yazılırsa çıkış kaydedilmiyor; *"Alan Kişi'yi listeden seçin"* uyarısı gösteriliyor.
- **Kayıt kime yazılıyor:** Çıkış kaydının `personelId` ve `alanKisi` alanları seçilen kişiye yazılıyor. Bu yüzden ürün, o kişinin **Kişi Envanteri**'nde görünüyor.
- **Depo:** Yönetici için hiçbir şey değişmedi; çubuk ve satır menüsü tam yetkiyle çalışıyor.

### 2.3 "ITSM / Gerekçe"

- **Değişen yerler:** B3 tablosu başlığı, mobil kart detayı, B3 Excel raporu sütunu, çıkış modalı, toplu çıkış modalı ve sarf uyarı metni.
- **Dokunulmayan yer:** "Gelen Talepler" tablosundaki aynı adlı başlık. O tablo talebin kendi alanını gösteriyor ve talep kapsamında değildi.
- **Veri:** Alan veride `sn` olarak kalıyor. Eski kayıtlar olduğu gibi okunuyor.

### 2.4 Taleplerin görünürlüğü (geliştirme gerekmedi)

- **Kayıt:** "Envanter Talep Et", `requests` koleksiyonuna kayıt yazıyor. Talepler herkese aynı dinleyiciyle geliyor; kurallar okuma iznini tüm üyelere veriyor.
- **Ekranlar:** Index'teki **Gelen Talepler** sekmesi `validateAdminAction()` → `isDbAdmin()` ile, admin panelindeki talep tablosu da (`renderAdminRequestTable`) kişiye göre süzülmeden listeliyor.
- **muhammed.cer:** Hesap `inventoryLiveAdmin` yetkisiyle canlı yönetici olarak tanımlı (`scratch/live-admin-candidate/activate.cjs`). Canlı kökte `isDbAdmin()` bu hesap için de `true` dönüyor. Talepler hem admin hem muhammed.cer hesabında görünüyor.

## 3. Güvenlik modeli: personel neden yalnız sarf çıkarabilir

Arayüzdeki kilit tek başına yeterli değil: personel tarayıcı konsolundan Firestore'a doğrudan yazabilir. Bu yüzden aynı kural **üç yerde** uygulanıyor:

1. **Arayüz:** `ExitPolicy.eligibility` uygun olmayan ürünü seçtirmiyor.
2. **Veri katmanı:** `runStockOps` personel için yalnız denetlenmiş bir çıkış planını kabul ediyor (`ExitPolicy.checkStaffPlan`).
3. **Firestore kuralları:** Sunucu, personelin yazmasını aşağıdaki ölçütlerle doğruluyor. Kesin karar burada.

### 3.1 "Sarf mı demirbaş mı" kararı

Uygulamada demirbaş bilgisi önce ürün türü tanımından (`productTypes`) okunuyor; tür tanımı, üründeki bayraktan önce geliyor. Kurallar ürün türünü adına göre arayamıyor, çünkü tür kayıtlarının kimlikleri rastgele (`pt_<zaman>`). Çözüm şöyle:

- Personel çıkışında b3 kaydına türün kimliği yazılıyor (`urunTuruId`).
- Kural o tür kaydını okuyor ve iki koşulu birlikte arıyor:
  - Türün adı ile ürünün `tür` alanı, baş/son boşluklar atılarak **birebir** aynı olmalı.
  - Türün `isDemirbas` alanı tam olarak `false` olmalı.
- Ad eşleşmezse (büyük/küçük harf farkı dahil) ya da tür tanımsızsa karar verilemiyor ve çıkış reddediliyor. Bu bilerek seçilmiş güvenli taraf. İstemci aynı ölçütü önceden uyguladığı için personel formu doldurmadan nedeni görüyor.

### 3.2 Stok düşümünün kayda bağlanması

Personelin iki yazması **aynı işlemde** (transaction) yapılıyor ve birbirine bağlı:

- **Ürün güncellemesi** (`staffExitStockOk`) yalnız şunları değiştirebiliyor:
  - adet; yalnız **azalma** olarak ve 0'ın altına inmeden,
  - `lastUpdate`,
  - stok 0'a inerken `durumu`/`status` = "Tükendi" ve önceki durum (`stokOncekiDurum`),
  - yeni bir `sonCikisId`.

  `sonCikisId`, işlem öncesinde **olmayan**, işlem sonrasında ise şu bilgileri taşıyan bir b3 kaydını göstermek zorunda: bu ürün, bu depo, **düşülen adet kadar** adet ve **oturumun kendi uid'si**.
- **b3 oluşturma** (`staffExitB3Ok`) şu koşulların hepsini arıyor:
  - tip yalnız `cikis`; `isDemirbas: false`;
  - talebe/zimmete bağlı alanlar boş;
  - alan listesi kapalı (bilinmeyen alan yok); metinlerde HTML etiketi yok;
  - alan kişi (`personelId`) oturumdaki personelin kendisi; `islemYapanUid` oturumun uid'si;
  - ürün işlem sonunda bu kayda bağlı ve aradaki adet farkı kayıttaki adetle aynı.

Bu bağ sayesinde personel; kayıtsız stok düşemiyor, düşmeden kayıt yazamıyor, adetleri tutarsız yazamıyor, eski bir kaydı yeniden kullanamıyor, stok artıramıyor ve ürünün başka bir alanını değiştiremiyor. Bunların her biri emülatörde ayrı bir test olarak reddediliyor (§6).

**Değişmeyenler:** Bakım modu, personel erişim kilidi ve hesap–personel eşlemesi denetimleri aynen geçerli.

### 3.3 Toplu çıkışta 6 kalem sınırı

Kurallar her kalem için birkaç belge okuyor. Firestore bir isteğin okuyabileceği belge sayısını sınırlıyor. Emülatör ölçümünde 7 kalem geçti, 8 kalem reddedildi. İstemci bir kalem pay bırakarak personel toplu çıkışını **6 farklı ürünle** sınırlıyor. Yönetici bu sınırdan etkilenmiyor.

### 3.4 Raf sayaçları

Raf sayaçları (`shelves`) kurallarca yalnız yöneticiye yazılabiliyor; personel çıkışında bunlar güncellenmiyor.

- **Ne zaman sapma olur:** Yalnız ürünün adedi **0'a indiğinde**. Bu durumda o rafın sayacı bir fazla kalıyor (raf olduğundan dolu görünüyor).
- **Etkisi:** Kapasite açısından güvenli taraf; rafa fazla ürün yerleştirilmiyor.
- **Düzeltme:** WMS'teki "Raf sayaçlarını eşitle" işlemi bu sapmayı düzeltiyor (§8).

## 4. Teknik akış

```
Personel "Çıkışı Onayla"
  └─ inventory-logic._performExit / script.js saveCartExit
       ├─ ExitPolicy.eligibility(ürün, productTypes)   → uygun değilse uyarı, dur
       ├─ ExitReceiver.resolve(...)                    → personel: kendisi | yönetici: seçilen kişi
       ├─ Schema.buildB3Entry({... urunTuruId, islemYapanUid, isDemirbas:false})
       └─ runExitTransaction / runStockOps(..., { staffExit: true })
            ├─ ExitPolicy.checkStaffPlan(stok, kayıtlar) → yalnız düşüm + ürün başına tek 'cikis' kaydı
            └─ Firestore transaction: ürün yaması + sonCikisId, b3 kaydı (raf sayacı yok)
                 └─ firestore.rules: staffExitStockOk + staffExitB3Ok
```

Yönetici akışı değişmedi; yalnız `alanKisi` / `personelId` artık seçilen kişiden geliyor ve kayda `islemYapanUid` ekleniyor.

## 5. Değiştirilen ve eklenen dosyalar

Tam fark: `Personel Envanter Çıkışı - degisiklikler.diff` (bu klasörde).

| Dosya | Değişiklik |
|---|---|
| `firestore.rules` | `staffExitStockOk`, `staffExitB3Ok`, `b3Doc`. b1/b2 için personel güncellemesi ve b3 için personel oluşturma izinleri eklendi. Diğer izinler değişmedi. |
| `src/utils/exit-policy.js` (yeni) | Saf çıkış politikası: `eligibility`, `checkStaffPlan`, `STAFF_MAX_ITEMS = 6`. |
| `src/ui/person-picker.js` (yeni) | Erişilebilir, aranabilir personel seçici (`PersonPicker`) ve alan kişi kurulum/çözümü (`ExitReceiver`). Yalnız güvenli DOM yöntemleri kullanılıyor. |
| `src/ui/staff-guards.js` (yeni) | Personelde depo çubuğu engeli ve `staff-readonly` görünümü. Sayfada sağ tık ile F12, Ctrl/Cmd+Shift+I/J/C/K, Ctrl/Cmd+U ve Cmd+Option+I/J/C/U kısayolları engelleniyor. |
| `src/services/firebase-handler.js` | `canExitStock()` ve `EXIT_STAFF_MESSAGE` eklendi. `runStockOps` `staffExit` modu: politika denetimi, ürün yamasına `sonCikisId`, raf sayacı atlama. b3 güncellemesinde isteğe bağlı alanlar tanınıyor. |
| `src/utils/schema.js` | b3 isteğe bağlı alanları `urunTuruId` ve `islemYapanUid`. b1/b2 isteğe bağlı alanı `sonCikisId`. |
| `src/modules/inventory-logic.js` | Tekil çıkış personel/yönetici ayrımı, alan kişi çözümü, personel için `staffExit`. |
| `src/ui/ui-components.js` | Çıkış modalı personele açıldı. Rol notu, ürün seçiminde politika denetimi, FAB ve mobil alt menü personelde salt-okunur. |
| `script.js` | Ürün aramasında kilitli satır. Toplu çıkış: personel erişimi, politika, 6 kalem sınırı, alan kişi seçimi, `staffExit`. Etiketler "ITSM / Gerekçe" oldu. |
| `index.html` | Etiketler, rol notları, gizli `exitPersonId` / `cartPersonId` alanları, B3 yardım metni ve yeni betiklerin bağlantıları. |
| `style.css` | Rol notu, kişi listesi, kilitli ürün satırı, salt-okunur depo çubuğu ve rozet stilleri. |
| `src/ui/device-ids.js` | Yalnız yorumdaki etiket. |
| `tests/rules/staff-exit.test.mjs` (yeni) | 30 kural testi (olumlu yol, kötü niyetli varyasyonlar, kalem sınırı). |
| `tests/unit/exit-policy.test.mjs` (yeni), `tests/unit/stock-schema.test.mjs` | Politika birim testleri; isteğe bağlı alan listesi güncellendi. |
| `scratch/staff-exit-ui.cjs` (yeni), `scratch/hosting-files.js` | Uçtan uca tarayıcı + kural tekrarı betiği. Yayın listesinde beklenen dosya sayısı 92'den 95'e çıktı. |

## 6. Test ve doğrulama

Komut çıktıları: `Personel Envanter Çıkışı - Test Kanıtları.txt` (bu klasörde).

| Kontrol | Sonuç |
|---|---|
| `tests/rules/staff-exit.test.mjs` (Firestore emülatörü) | 30 / 30 geçti |
| Tüm kural paketi `npm run test:rules` (yeni dosya dahil) | 294 / 294 geçti; mevcut güvencelerde gerileme yok |
| `npm run test:unit` | 298 / 298 geçti |
| `npm run lint:xss` | İZİNSİZ 0 |
| `node scratch/hosting-files.js` | 95 dosya, yalnız uygulama dosyaları |
| `scratch/staff-exit-ui.cjs` (Chrome + emülatör) | Geçti, `pageerror = 0` |
| Önceki tarayıcı kontrolleri (B3 responsive, EBYS Rehberi) | Geçti |

`scratch/staff-exit-ui.cjs` iki aşamalı çalışıyor:

1. **Tarayıcı:** Gerçek `index.html` ve gerçek modüllerle personel ve yönetici akışları oynatılıyor. Yalnız Firebase katmanı, kayıt yakalayan bir saplamayla değiştiriliyor.
2. **Emülatör:** Arayüzün personel çıkışında **ürettiği gerçek kayıt**, personel kimliğiyle kurallara karşı yazılıyor. Böylece istemcinin ürettiği kayıt biçimiyle kuralın beklediği biçimin birebir uyduğu kanıtlanıyor. Başka kişi adına, demirbaş ürüne ve yönetici biçimli kayıt denemeleri reddediliyor.

Bu betik çalışırken yönetici kişi seçicisinde gerçek bir hata yakalanıp düzeltildi: fareyle odaklanınca seçili metin kayboluyor, yazılanlar mevcut adın sonuna ekleniyordu.

**Yapılmayanlar:** Canlı Firebase ile uçtan uca deneme yapılmadı. Testlerde canlı yönetici (muhammed.cer) oturumu, `isDbAdmin()` saplamasıyla temsil edildi.

## 7. Yayın adımları

1. **Önce kurallar:** `firebase deploy --only firestore:rules`. Yeni kurallar yalnız izin **ekliyor**; eski istemciler etkilenmiyor. Bu yüzden önce kurallar gidiyor.
2. **Sonra hosting:** Önce `node scratch/hosting-files.js` çalıştırılıyor (95 dosya), ardından `firebase deploy --only hosting`. Hosting kurallardan önce giderse personelin çıkışı sunucuda "yetki yok" ile reddedilir; veri bozulmaz.
3. **Ön koşul — ürün türleri:** Personelin çıkaracağı sarf ürünlerin türü, **Ürün Türleri** listesinde aynı yazımla ve "Demirbaş" işaretsiz bulunmalı. Ürün listesi yayın öncesinde kontrol edilmeli.
4. **Ön koşul — hesaplar:** BT ekibindeki kişilerin personel giriş hesabı açık olmalı ve personel erişim kilidi (`accessGate/staff`) açık kalmalı.

## 8. Sınırlar ve bilinen konular

- **"BT ekibi" tanımı:** Kurallarda ve arayüzde çıkış yetkisi, **giriş hesabı olan her personele** veriliyor; kişi bazlı ayrı bir bayrak yok. Bugün giriş hesabı yalnız BT ekibine açıldığı için sonuç "10 kişilik BT ekibi" ile aynı. Hesap BT dışından birine açılırsa o kişi de sarf çıkışı yapabilir. Kişi bazlı bir yetki gerekirse sonraki adımda personel kaydına bir alan eklenmesi önerilir.
- **Geliştirici araçları:** Web sayfası F12 gibi kısayolları ve sağ tıkı engelleyebilir. Ancak tarayıcı menüsünden (⋮ › Diğer araçlar › Geliştirici araçları) açılan aracı ya da tarayıcı uzantılarını **hiçbir sayfa engelleyemez**. Asıl koruma Firestore kuralları; bu engel yalnız kolay erişimi kapatıyor.
- **Engelin kapsamı:** Engel `index.html`'de yönetici dahil **herkes** için geçerli. Yönetici panelinde (`admin.html`) uygulanmadı. Yöneticiyi index'te muaf tutmak tek satırlık bir değişiklik.
- **Raf sayacı:** Personel çıkışında stok 0'a inerse ilgili raf sayacı bir fazla kalıyor (§3.4). Yönetici WMS'te "Raf sayaçlarını eşitle" işlemini düzenli olarak çalıştırmalı.
- **Tür adı eşleşmesi:** Türü katalogla birebir eşleşmeyen sarf ürünleri personel çıkaramıyor; arayüz bunu açıkça söylüyor. Yönetici ürünün türünü düzelttiğinde personel çıkışı açılıyor.
- **"Gelen Talepler":** Tablodaki "SN / BioPro / Itsm" başlığı bilerek değiştirilmedi (talep kapsamı dışında).
- **Satır menüsü:** Personelde depo satırına tıklanınca açılan menü salt-okunur. Satır seçimi görsel olarak çalışmaya devam ediyor.

## 9. Yerel test walkthrough

**Hazırlık:** `inventory_demo` kökünde en az bir sarf ürünü (türü "Ürün Türleri"nde demirbaş olmayan bir tür) ve bir demirbaş ürün bulunmalı. Bir personel giriş hesabı ve yönetici parolası gerekiyor.

**Personel olarak** (kurumsal kimlik + kod ile giriş):

1. **B1 Depo**'yu açın. Çubuğun başında "🔒 Yalnız görüntüleme" rozeti görünmeli ve düğmeler soluk olmalı. "Ürün Ekle"ye tıklayın: salt-okunur uyarısı çıkmalı ve modal açılmamalı.
2. Bir satıra tıklayın. Stok/düzenleme düğmeleri yerine yönlendirme notu görünmeli.
3. Sayfada sağ tıklayın ve F12, Ctrl+Shift+I, Ctrl+U deneyin. Hiçbiri tepki vermemeli.
4. **Envanter Takibi › Envanter Çıkışı Yap**'ı açın. Rol notu görünmeli, "Alan Kişi" sizin adınız olmalı ve değiştirilememeli.
5. Bir demirbaş arayın. Satır kilitli olmalı; tıklayınca "Envanter Talep Et" yönlendirmesi çıkmalı.
6. Bir sarf ürünü seçin, "ITSM / Gerekçe" ve not girip onaylayın. Stok düşmeli ve B3'te kayıt "Alan Kişi = siz" olarak görünmeli.
7. **Toplu Çıkış Yap**'ta 7. farklı ürünü eklemeyi deneyin. "En fazla 6" uyarısı çıkmalı.
8. **Envanter Talep Et** ile bir demirbaş için talep gönderin.

**Yönetici olarak:**

1. **Gelen Talepler** sekmesinde ve admin panelindeki talep tablosunda personelin talebini görün. muhammed.cer ile girildiğinde de aynı talepler görünmeli.
2. **Envanter Çıkışı Yap**'ta "Alan Kişi"ye tıklayıp başka bir personelin adını veya kurumsal kimliğini yazın. Listeden seçin (ok tuşları + Enter ile de olur) ve onaylayın. Kayıt o kişinin **Kişi Envanteri**'nde görünmeli.
3. "Alan Kişi"ye listede olmayan bir ad yazıp onaylayın. "Listeden seçin" uyarısı çıkmalı ve kayıt oluşmamalı.
4. B1'de çubuğun ve satır menüsünün tam yetkiyle çalıştığını doğrulayın.
5. Personel bir ürünü 0'a indirdiyse WMS'te **Raf sayaçlarını eşitle**'yi çalıştırın.
