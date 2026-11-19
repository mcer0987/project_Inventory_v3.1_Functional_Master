# İP-7 Yönetici Yetkisi Verme Süreci (Aşama A) — Implementation Walkthrough

> **Tarih:** 19.11.2026
> **Dal:** `feat/v3.7-ebys-h5-h7-yazisma-takip` (taban HEAD `5704310`)
> **Durum:** Aşama A uygulandı; kalite kapılarının hepsi geçti ve commit ile mühürlendi. `git push` ve `firebase deploy` yapılmadı.
> **Kapsam:** Her iki ekran. `admin.html` (VIP › "👑 Yönetici Yetkileri" paneli) ve iki sayfada oturum / yetki dinleyicisi (`session-store.js`, `firebase-handler.js`). Plan bölümleri `7a`, `7b`, `7c`, `7d`, `7f`. **`7e` (Aşama B — eski `inventoryLiveAdmin` yolunun kaldırılması) kapsam dışıdır;** claim desteği kurallarda ve istemcide aynen korundu.
> **Plan:** [İP-7 · Yönetici Yetkisi Verme Süreci — Uygulama Planı.md](./İP-7%20·%20Yönetici%20Yetkisi%20Verme%20Süreci%20—%20Uygulama%20Planı.md) (K1 yalnız ana yönetici · K2 claim geçişte korunur · K3 ortam başına ayrı).
> **Başlangıç ölçümü (HEAD, temiz worktree):** `test:unit` 398/398 · `test:rules` 412/412 · `lint:xss` 0 izinsiz · hosting 129/129.

## İçindekiler

1. [Talepler ve karşılıkları](#1-talepler-ve-karşılıkları)
2. [Kullanıcının gördüğü davranış](#2-kullanıcının-gördüğü-davranış)
3. [Güvenlik modeli (kurallar)](#3-güvenlik-modeli-kurallar)
4. [Teknik akış (istemci)](#4-teknik-akış-istemci)
5. [Kural bütçesi: ölçüm ve yeniden sıralamalar](#5-kural-bütçesi-ölçüm-ve-yeniden-sıralamalar)
6. [Değişen dosyalar](#6-değişen-dosyalar)
7. [Test ve doğrulama](#7-test-ve-doğrulama)
8. [Plandan bilinçli farklar](#8-plandan-bilinçli-farklar)
9. [Sınırlar ve bilinen konular](#9-sınırlar-ve-bilinen-konular)
10. [Yayın adımları ve sonraki adım (Aşama B)](#10-yayın-adımları-ve-sonraki-adım-aşama-b)
11. [Yerel test walkthrough](#11-yerel-test-walkthrough)

---

## 1. Talepler ve karşılıkları

| # | Talep | Sonuç |
|---|---|---|
| 7a | `isAdmin(root)`'a belge yetkisi dalı (iki kökte), claim dalı korunur | `isPrimaryAdmin() || ((claim dalı) || adminGranted == true) && isStaff(root)`. Claim dalı `lifeserver_master`'a bağlı kaldı. `isStaff` zinciri `isAdmin`'i çağırmaz (döngü yok). |
| 7a | `regularStaff`: yetkili personel personel yolundan değil yönetici yolundan yazar | `isStaff && adminGranted != true && (!claim || !isAdmin)`. Aynı eşleme belgesi; ek belge erişimi yok. |
| 7a | `staffAccounts` bloğu: `read` / `create` / `update` / `delete` ayrı | `read`: kendi eşlemesi ya da yönetici. `create`: yönetici, yetki alanı yok. `update`: yetki alanları değişiyorsa yalnız `isPrimaryAdmin() && adminGrantWriteOk`; değişmiyorsa ana yönetici ya da (yönetici ve eşleme yetkisiz). `delete`: ana yönetici ya da (yönetici ve eşleme yetkisiz). |
| 7a | `adminGrantWriteOk`: şekil, sunucu saati, yazan, gerekçe 5–300, denetim kimliği 1–80, eşleme kaydırılamaz, `auth_time` ≤ 10 dk, aynı commit denetim kaydı, verilirken personel taze | Hepsi uygulandı (`grantAuditOk`, `grantPersonOk` yardımcılarıyla). `auth_time` emülatörde saniye (int) olarak geliyor — §7.3. |
| 7a | Personel `update` koruması: yetkilinin `pri` / `authEmail` / `active` alanını yalnız ana yönetici değiştirir | `personelGrantGuardOk` — belge erişimi yalnız bu üç alan değişirken; `uid` boşsa ya da eşleme yoksa / yetkisizse serbest. |
| 7b | Saf çekirdek `src/utils/admin-grants.js` → `window.AppModules.AdminGrants` | `AUDIT_TYPES`, `AUDIT_LABELS`, `ADMIN_FIELDS`, `eligibility`, `grantState`, `validateReason`, `planGrant`, `planRevoke` + panel için `adminRows`, `candidates`, `matchesQuery`. Firestore / DOM yok. |
| 7c | `session-store.js`: `setStaffAdminGrant`, `isDbAdmin` genişler, `canManageAdmins`, çıkışta temizlik | Uygulandı. `liveAdminSession` (claim) aynen korundu. `getStaffAdminGrant()` panel / teşhis için eklendi. |
| 7c | `firebase-handler.js` `onAuthStateChanged`: kendi eşlemesini `getDocFromServer` ile oku, `onSnapshot` ile dinle, `onAdminGrantChanged` yayınla; `onAuthReady` okumadan **sonra** | Uygulandı. Claim okuması ile eşleme okuması paralel (`Promise.all`); `window.userAuth`, `whenAuthReady`, `onAuthReady` ve `whenAuthKnown` ikisi bittikten sonra. |
| 7c | `staff-provisioning.js` bağlayıcı `{ merge: true }`; yetkili eşlemeye ek yönetici dokunursa anlaşılır hata | `t.set(..., { merge: true })`. Yeni `admin-protected` türü: toplu göç aracında satır sonucu `conflict` olur, iş durmaz. |
| 7c | Servis `src/services/admin-grant-service.js` (`10.7.1` CDN içe aktarması) | `listAdminGrants`, `listGrantedMappings`, `grantAdmin`, `revokeAdmin` → `window.AppModules.AdminGrantService`. Bağımlılıklar `createAdminGrantService(deps)` ile verilebilir (emülatör testi aynı dosyayı kullanır). |
| 7c | Güvenlik Raporu: iki yeni tür için okunur etiket, adet yerine anlamlı gösterim | "Yönetici Yetkisi Verildi / Geri Alındı" ve "(Yetki yok → Yönetici)". Diğer türler eskisi gibi. |
| 7d | `admin.html` VIP düğmesi `#vipAdminGrantsBtn`, script yüklemeleri | Düğme "Personel Erişim Kilidi"nin hemen altında. `admin-grants.js` `<head>`'de `ownership.js`'ten sonra; panel `admin-system-control.js`'ten sonra; servis `admin-main.js` içinden. |
| 7d | `index.html` uyumu | `admin-grants.js` `<head>`'e eklendi (rapor etiketleri iki sayfada aynı). `auth-engine.js` `onAdminGrantChanged`'de "Panele Geç" ve `.admin-only` öğelerini yeniden çizer, vizeyi yazar / siler. |
| 7d | `admin-system-control.js`: açıcı + yetki düşünce kilit | `window.vipAdminGrants(btn)`; `onAdminGrantChanged` → panel kapanır, `showAdminLock('not-admin')`. |
| 7d | Panel: kısa açıklama, ⓘ yardım, iki bölüm, salt okunur kip, test kancaları | §2.1. `#adminGrantPanel[data-mode=owner|readonly][data-state]`, `data-role` kancaları. DOM API + `textContent`, `innerHTML` yok. |
| 7f | `EXPECTED_COUNT` 129 → 132 | Açıklama satırıyla güncellendi; `132 / 132`. |

## 2. Kullanıcının gördüğü davranış

### 2.1 Ana yönetici — VIP › 👑 Yönetici Yetkileri

Pencerenin üstünde her zaman görünen kısa açıklama: *"Personel hesaplarına yönetici yetkisi verir ya da geri alır. Yetkiyi yalnız ana yönetici hesabı değiştirebilir; verilen yöneticiler başkasına yetki veremez. Her değişiklik Güvenlik Raporu'na kaydedilir."* Altında ortam adı (ör. `lifeserver_master`) ve **ⓘ Nasıl çalışır?** düğmesi. Düğme şu konuları anlatan yardım alanını açar:

- kimler yönetici yapılabilir (aktif personel + PRI hesabı),
- yetkinin ortam başına ayrı olduğu,
- yetkinin hemen geçerli olduğu,
- askıya alma (pasifleştirme, bağın bozulması, erişim kilidi),
- **bir ek yöneticinin Erişim Kilidi'ni kapatmasının kendisi dahil bütün ek yöneticileri askıya aldığı**,
- geri almanın etkisi, parola doğrulaması ve betikle verilmiş eski yetkinin bu listede görünmediği.

Personel Erişim Kilidi kapalıysa kırmızı bir uyarı bandı gösterilir: bütün ek yöneticiler askıdadır.

**Bölüm 1 · Mevcut yöneticiler.** İlk satır sabittir: "Ana yönetici · admin@medipol.local · Ana yönetici (değiştirilemez)". Sonra her ek yönetici için şu sütunlar:

- Ad, PRI,
- Durum: **Aktif** ya da **Askıda** ve nedeni (personel pasif / kimlik eşlemesi uyuşmuyor / erişim kilidi kapalı / kayıt yok),
- Veren, tarih, gerekçe,
- **Yetkiyi geri al** düğmesi. Düğme hedef kişinin adını gösteren bir form açar. Gerekçe 5–300 karakter olmalı, sayaç ve hata canlı görünür. "Geri al"dan sonra parola sorulur.

**Bölüm 2 · Yetki ver.**

- Ad ya da PRI ile aranır; Türkçe harf farkı gözetilmez ("şule" = "SULE").
- Uygun kişiler listenin başındadır.
- Uygun olmayanlar soluk görünür, seçilemez ve nedeni altında yazar. Nedenler: "Personel pasif…", "Kurumsal kimlikle (PRI) açılmış giriş hesabı yok…", "Giriş hesabı PRI adresinde değil…", "Kimlik eşlemesi uyuşmuyor…", "Zaten yönetici."
- Kişi seçilip gerekçe yazılınca **Yönetici yap** etkinleşir. Ardından parola doğrulaması gelir ve sonuç mesajı görünür. Liste sunucudan yeniden okunur.

### 2.2 Ek yönetici (yetkili personel)

- **Girişte** "Panele Geç" görünür. Personel `index.html`'de giriş yapar; eşleme `onAuthReady`'den önce okunduğu için `auth-engine` doğru kararı verir.
- **`admin.html`'de** yönetici işlemlerini yapar.
- **Yönetici Yetkileri** penceresi salt okunur açılır. Üstte "🔒 Yetkileri yalnız ana yönetici değiştirebilir…" notu vardır. Geri al düğmesi ve "Yetki ver" bölümü yoktur; yalnız "Kapat" ve "Nasıl çalışır?" düğmeleri kalır.
- **Yetki geri alındığında ya da askıya düştüğünde:**
  - açık `admin.html` sekmesi beklemeden kilitlenir: panel kapanır, "Yönetici Girişi Gerekli" kilit kartı ve uyarı çıkar;
  - `index.html`'de "Panele Geç" kaybolur, yönetici vizesi silinir ve uyarı gösterilir.

  Kurallar zaten bir sonraki yazımı reddeder; token yenilemesi beklenmez.

### 2.3 Güvenlik Raporu

Yetki kayıtları "İşlem Türü" sütununda **Yönetici Yetkisi Verildi** ya da **Yönetici Yetkisi Geri Alındı** olarak görünür. Kayıtta adet yoktur. "Ürün / Talep" sütununda kişi (PRI) ve **(Yetki yok → Yönetici)** ya da **(Yönetici → Yetki yok)** yazar. Gerekçe sonuç rozetinin altında görünür.

## 3. Güvenlik modeli (kurallar)

Yetki, `{root}/staffAccounts/items/{uid}` belgesindedir. Bu belgeyi `isStaff` zaten her personel isteğinde okur. Yetki alanları ya hep birlikte bulunur ya hiç bulunmaz: `adminGranted`, `adminChangedAt`, `adminChangedBy`, `adminReason`, `adminAuditId`.

| Saldırı / hata | Kapı |
|---|---|
| Ek yönetici başkasına (ya da kendine) yetki verir | Yetki alanı değişimi yalnız `isPrimaryAdmin()`. Ek yönetici yetkili bir eşlemeyi hiç güncelleyemez ve silemez; yetki alanlı yeni eşleme oluşturulamaz (ana yönetici dahil). |
| Ek yönetici başka bir yöneticiyi dolaylı yoldan düşürür (pasifleştirme, PRI / e-posta değişimi) | `personelGrantGuardOk`: yetkili kaydın `pri` / `authEmail` / `active` alanı yalnız ana yönetici tarafından değişir. `jobTitle` gibi diğer alanlar serbest. |
| İz bırakmadan yetki değişimi | Aynı commit'te denetim kaydı: kimlik commit öncesinde **yok**, sonrasında doğru tür, `refCol`, `refId == uid`, yazan uid ve `approved` ile **var** (`envanterNoAuditOk` deseni). |
| Açık bırakılmış ana yönetici oturumundan yetki verme | İstemci her değişiklikte parolayı yeniden sorar. Kural, `auth_time`'ın 10 dakikadan eski olmamasını şart koşar. |
| Yetki verildikten sonra eşlemenin başka kişiye kaydırılması | Yetki yazımında `personelId`, `pri` ve `linkedAt` değişemez. Verilirken personel kaydı taze okunur: aynı `uid`, aynı `pri`, aktif. Yetki `isStaff` zinciriyle birlikte geçerlidir; zincir koparsa yetki askıya alınır. |
| Yetkinin ortamlar arasında taşınması | Belge köke göre okunur (K3); demoda verilen yetki canlıda geçmez. Bu, kural testiyle kanıtlandı. |

**Okuma:** Kişi yalnız kendi eşlemesini okur. Bu, kilit kapalıyken de geçerlidir; istemci askıyı böyle görür. Başkasının eşlemesi ve liste sorgusu yalnız yöneticiye açıktır.

**`member()` eşdeğerliği:** `isAdmin`'in ana yönetici dışındaki iki dalı (claim ve belge yetkisi) `isStaff`'ı zaten gerektirir. Bu yüzden `isAdmin || isStaff ≡ isPrimaryAdmin || isStaff`. Anlam değişmez; personel isteklerinde yetki dalının `get()`'i hiç değerlendirilmez (§5).

## 4. Teknik akış (istemci)

**Oturum açılışı** (`firebase-handler.js` → `onAuthStateChanged`):

1. Personel oturumunda iki okuma paralel yapılır:
   - claim jetonu (yalnız canlı kök, Aşama B'ye kadar);
   - `staffAccounts/items/{uid}`, `getDocFromServer` ile.
2. Oturum değişmediyse `setFirebaseAuthClaims` ve `setStaffAdminGrant` çağrılır, ardından `_watchOwnAdminGrant` başlar.
3. Sonra `window.userAuth` atanır; `whenAuthReady` / `onAuthReady` / `whenAuthKnown` çözülür. Bu yüzden `signInStaffAccount` dönene kadar yetki bilinir (`auth-engine` "Panele Geç" ve `checkAdminAuth` doğru karar verir).
4. Okuma düşerse yetki yok sayılır (fail-closed). Dinleyici gelince düzelir.

**Dinleyici:** Yalnız sunucu anlık görüntüsü değerlendirilir; önbellekten gelen atlanır.

1. `isDbAdmin()` kararı değişirse `onAdminGrantChanged` yayınlanır (`{ uid, isAdmin, adminGranted }`).
2. Senkron çalışıyorsa veri dinleyicileri yeni role göre yeniden kurulur. Örneğin `returnRequests` ve satın alma dinleyicileri yöneticide tam, personelde kişisel kurulur.
3. Kullanıcı değişince ya da çıkışta abonelik kapanır. `clearSession` de grant durumunu siler.

**Yetki verme** (`admin-grant-service.js`):

1. `canManageAdmins()` denetlenir. Toplu yazma kilidi (`window.isBulkWriteLocked(['personel','staffAccounts'])`) ve bakım modu yoksa, gerekçe de geçerliyse devam edilir.
2. `SecurityConfig.promptAdminReauth`: parola yeniden doğrulanır, jeton tazelenir.
3. Tek transaction çalışır:
   - personel ve eşleme sunucudan taze okunur;
   - `AdminGrants.planGrant` uygunluğu yeniden denetler;
   - `t.update(eşleme, yama)` (`adminChangedAt = serverTimestamp()`);
   - `t.set(auditLogs/{önceden üretilmiş kimlik}, buildAuditRecord(..., { id }))`.

Denetim kimliği transaction'dan önce bir kez üretilir; yeniden denemelerde değişmez. Kural reddi şu anlaşılır iletiye çevrilir: "Kurallar yazımı reddetti. Parola doğrulaması 10 dakikadan eski olabilir…". Geri alma aynı sıradadır; kişi kaydı silinmiş ya da pasif olsa da geri alınabilir.

**PRI / Hesap Göç Aracı (bağlayıcı):**

- Eşleme `merge` ile yazılır; PRI değişiminde yetki alanları silinmez.
- Ek yönetici, yetkili bir eşlemeye ya da kişinin kimlik alanına dokunmaya kalkarsa iş transaction yazılmadan durur. Kural reddi de aynı koda (`admin-protected`) çevrilir.
- Toplu göçte bu satır `conflict` olarak raporlanır, kalan satırlar işlenir.

## 5. Kural bütçesi: ölçüm ve yeniden sıralamalar

**Sorun.** Plandaki biçim doğrudan uygulandığında temiz tabanda yeşil olan 412 kural testinin 12'si **"maximum of 1000 expressions"** ile düştü. Düşenler:

- 10 adımlı satın alma başlatma / onay,
- EBYS H4 satın alma transaction'ları,
- katalog şablon testleri.

Sebep: `isAdmin` her personel çağrısında yeni bir `get()` dalı değerlendiriyordu. Firestore'da 1000 ifade sınırı istek (commit) başınadır ve çok belgeli transaction'larda bütün belgelerin kuralları toplanır.

**Ölçüm** (emülatör, personel oturumu, canlı kök; ifade k kez tekrarlanıp ikili aramayla sınıra kadar zorlandı; geçici betik, repo dışında):

| İfade | Çağrı başına ≈ ifade |
|---|---|
| eski `isAdmin` (HEAD) | 45 |
| plandaki biçim (+ `adminGranted` dalı) | 67 |
| yalnız eşleme `get()` + alan karşılaştırması | 24 |
| `isPrimaryAdmin()` | 20 |
| **seçilen biçim** (ana yönetici önce, claim jetonla erken düşer, tek `get`) | **59** |

**Yapılan bütçe düzeltmeleri.** Hepsi anlamca eşdeğerdir: `allow` sonucu değişmez; `||`/`&&` yalnız yer değiştirdi.

1. **`member()`**: `isPrimaryAdmin() || isStaff(root)`. Eşdeğerliği §3'te gösterildi. Personel başına çağrı ≈ 25 ifade ucuzladı (HEAD'den de ucuz).
2. **Eski (legacy) `purchaseOrders` rol seçimi**: `isAdmin ? yönetici : personel` yerine `isPrimaryAdmin() ? yönetici : (personel || (isAdmin && yönetici))`. Personelin başarılı yolunda `isAdmin` hiç çalışmaz. Ek yönetici aynı zamanda personeldir; personel dalının izin verdiği yazım ona zaten açıktır. Yorumu kurala yazıldı.
3. **Okuma kuralları** (`ebysDocuments`, `ebysRegistrationIds`, `purchaseHistory`, `purchaseAccess`, `ebysProcesses`, `ebysTasks`): `!exists || isAdmin || sahip == uid …` sırası `!exists || sahip == uid … || isAdmin` oldu. Transaction okumaları commit'te yeniden değerlendirildiği için bu sıra da bütçeye girer.
4. **`purchaseHistory` / `purchaseAccess` yazımları**: `isAdmin || X` → `X || isAdmin`. `lpProofRead` önüne `isPrimaryAdmin()` kondu; ana yönetici pahalı kanıtı değerlendirmez.
5. **`epUpdate` devretme dalı**: dal koşullu ifadeye alındı (`n.lastCommand == 'delegate' ? … : false`).
   - **Bulgu:** Reddedilecek (hatalı) bir karar transaction'ında motor `&&` zincirini kısa devre etmeden değerlendiriyor. `isAdmin` yalnız sona taşındığında aşım sürdü; koşullu ifadeye alınınca ret nedeni HEAD ile aynı oldu ("evaluation error", bütçe değil).
   - **Yöntem:** Bu nokta, `isAdmin` çağrı yerleri satır aralıklarıyla eski biçime döndürülerek (ikiye bölme) bulundu.

Sonuç: `test:rules` **438/438** (412 mevcut + 26 yeni). Mevcut testlerin hiçbirinde beklenen değişmedi; bilinçli olarak değişen tek test için §8'e bakın.

## 6. Değişen dosyalar

| Dosya | Değişiklik |
|---|---|
| [firestore.rules](../../firestore.rules) | `isAdmin`, `regularStaff`, `member`, `staffAccounts` bloğu (`grantFieldsChanged`, `adminGrantWriteOk`, `grantAuditOk`, `grantPersonOk`), personel koruması (`grantedAccount`, `personelGrantGuardOk`), §5 bütçe sıralamaları |
| [src/utils/admin-grants.js](../../src/utils/admin-grants.js) | **yeni** — saf çekirdek (`window.AppModules.AdminGrants`) |
| [src/services/admin-grant-service.js](../../src/services/admin-grant-service.js) | **yeni** — liste / ver / geri al servisi (`window.AppModules.AdminGrantService`) |
| [src/ui/admin-grant-panel.js](../../src/ui/admin-grant-panel.js) | **yeni** — VIP paneli (`window.AppModules.AdminGrantPanel`) |
| [src/utils/session-store.js](../../src/utils/session-store.js) | `setStaffAdminGrant`, `getStaffAdminGrant`, `canManageAdmins`; `isDbAdmin` belge yetkisi; `clearSession` temizliği |
| [src/services/firebase-handler.js](../../src/services/firebase-handler.js) | Kendi eşlemesini okuma/dinleme, `onAdminGrantChanged`, `window.isBulkWriteLocked` köprüsü, bağlayıcıya `canEditAdminAccount` |
| [src/services/staff-provisioning.js](../../src/services/staff-provisioning.js) | Bağlayıcı `merge`, `admin-protected` hata türü ve satır sonucu |
| [src/modules/admin/admin-system-control.js](../../src/modules/admin/admin-system-control.js) | `window.vipAdminGrants`, `onAdminGrantChanged` → panel kapanır + `showAdminLock('not-admin')` |
| [src/modules/admin/admin-main.js](../../src/modules/admin/admin-main.js) | Servis içe aktarması |
| [src/modules/auth-engine.js](../../src/modules/auth-engine.js) | `onAdminGrantChanged` → vize, navbar ("Panele Geç"), `setupUI` (`.admin-only`) |
| [src/modules/self-approval-reporter.js](../../src/modules/self-approval-reporter.js) | İki yeni tür için okunur etiket ve "(eski → yeni)" gösterimi |
| [admin.html](../../admin.html) | `#vipAdminGrantsBtn`, `admin-grants.js` ve `admin-grant-panel.js` yüklemeleri |
| [index.html](../../index.html) | `admin-grants.js` yüklemesi (CRLF korundu) |
| [scratch/hosting-files.js](../../scratch/hosting-files.js) | `EXPECTED_COUNT` 129 → 132 |
| [tests/rules/admin-grants.test.mjs](../../tests/rules/admin-grants.test.mjs) | **yeni** — 26 kural testi (plan senaryoları 1–9) |
| [tests/rules/rules.test.mjs](../../tests/rules/rules.test.mjs) | Eşleme okuma testi İP-7'ye göre güncellendi (§8) |
| [tests/unit/admin-grants.test.mjs](../../tests/unit/admin-grants.test.mjs) | **yeni** — 8 birim testi |
| [tests/unit/session-store.test.mjs](../../tests/unit/session-store.test.mjs) | +3 test (grant, `canManageAdmins`, çıkış) |
| [tests/unit/staff-provisioning.test.mjs](../../tests/unit/staff-provisioning.test.mjs) | Sahte transaction `merge`'i tanır; +2 test |
| [tests/integration/staff-provisioning.emu.test.mjs](../../tests/integration/staff-provisioning.emu.test.mjs) | +2 senaryo: gerçek `grantAdmin` / `revokeAdmin` ve ek yönetici reddi |
| Bu belge, [00 Uygulama Planı](./00%20Uygulama%20Planı%20ve%20Mimari%20Uyum%20İncelemesi.md), [v3.6 Kontrol Listesi](./v3.6%20Kontrol%20Listesi.md) | Walkthrough, İP-7 satırı, elle test bölümü |

## 7. Test ve doğrulama

### 7.1 Kalite kapıları — gerçek çıktılar

| Kapı | Komut | Sonuç |
|---|---|---|
| Yayın dosyası sayısı | `node scratch/hosting-files.js` | `Yayınlanacak dosya: 132 (kök: 23, src/: 98, pdf-fonts/: 3) · beklenen: 132` → `✔ Yalnız uygulama dosyaları yayınlanacak.` |
| XSS lint | `npm run lint:xss` | `107 dosya · 209 sink · 298 HTML şablonu · 1031 dinamik ifade` → `güvenli 1012 · izinli (xss-ok) 19 · İZİNSİZ 0` |
| Birim testleri | `npm run test:unit` | `tests 411 · pass 411 · fail 0` (taban 398 + 13 yeni) |
| Kural testleri | `npm run test:rules` | `tests 438 · suites 47 · pass 438 · fail 0` (taban 412 + 26 yeni) |
| Personel / Auth emülatörü | `npm run test:staff:emu` | `pass 17 · fail 0` (15 mevcut + 2 yeni İP-7 senaryosu) |
| Satır sonu | `git ls-files --eol -m` | Değişen her dosya index'teki biçimde (`index.html` `i/crlf w/crlf`, diğerleri `i/lf w/lf`). `firebase-handler.js`, `staff-provisioning.js` ve `session-store.test.mjs` çalışma kopyasında gizli CRLF / karışık taşıyordu; index'teki LF'ye döndürüldü. Yeni dosyalar LF. |

### 7.2 Yeni testler

- **Kural** (`tests/rules/admin-grants.test.mjs`, plan senaryoları):
  1. **Verme:** Audit'li verme ✓. Audit yok, tür / `refCol` / `refId` / sonuç yanlış, var olan kimlik ✗. Gerekçe 4 / 301 karakter ya da etiketli ✗. Başkası adına imza ✗.
  2. **K3:** Canlıda verilen yetki canlıda yönetici yazımı açar, demoda açmaz; demoda ayrıca verilince açar. Yetkili kişi denetim günlüğünü ve eşleme listesini okur; sıradan personel okuyamaz.
  3. **K1:** Ek yönetici şunları yapamaz: başkasına audit'li yetki, kendi eşlemesinde herhangi bir değişiklik ya da kendi yetkisini geri alma, yetki alanlı `create` (ana yönetici dahil ✗), yetkili eşlemeyi silme, `personelId` değiştirme. Yetkisiz eşlemelerde yönetici yetkileri sürer ✓. Ana yönetici aynı yazımda `personelId` / `pri` kaydıramaz.
  4. **Kimlik alanları:** Ek yönetici başka yöneticinin `active` / `pri` / `authEmail` alanını yazamaz ✗, `jobTitle` yazar ✓. Yetkisiz personeli pasifleştirir ✓. Ana yönetici yetkiliyi pasifleştirir ✓.
  5. **Geri alma:** Yönetici yazımı bir sonraki istekte ✗; personel okuması ve kendi talebi ✓. Geri alma yalnız "geri alındı" türlü kayıtla.
  6. **Askı:** Personel pasif ✗. Kilit kapalı ✗, açılınca yetki geri gelir ✓. Askıdaki yetki geri alınabilir ✓.
  7. **Uygun olmayan kişi:** Pasif kişiye, uid'i uyuşmayan kişiye ve eşleme PRI'si farklı kişiye yetki ✗. Aynı yazımda `pri` değişimi ✗. İstemci saati ✗. Bilinmeyen ek alan ya da eksik yetki alanı ✗.
  8. **Taze doğrulama:** `auth_time` 11 dk ✗, 9 dk ✓, yok (0) ✗. Bayat oturum yetkisiz eşlemeyi yine düzenler.
  9. **Okuma:** Kendi eşlemesi ✓ (kilit kapalıyken de), başkasınınki ✗, liste ✗. Ek yönetici herkesinkini okur.
  10. **Gerileme:** Mevcut 412 test değişmeden geçer (§5).
- **Birim:**
  - `admin-grants.test.mjs`: sabitler; `eligibility` altı kodu; `grantState` aktif / askı nedenleri / yok; gerekçe sınırları; `planGrant` / `planRevoke` alanları ve hata kodları; panel verisi ve Türkçe arama.
  - `session-store.test.mjs`: yetki aynı oturuma bağlı, köke bağlı değil; yalnız `true` bool; `canManageAdmins` yalnız ana yönetici; `clearSession`. Claim testi korundu.
  - `staff-provisioning.test.mjs`: `merge` yetki alanlarını korur; `admin-protected` (erken durdurma ve kural reddinin çevrilmesi); toplu iş durmaz.
- **Entegrasyon** (`staff-provisioning.emu.test.mjs`, gerçek Auth + Firestore emülatörü, üretim kuralları; servis dosyası CDN içe aktarması npm `firebase/firestore`'a yönlendirilerek yüklenir):
  - **Ana yönetici senaryosu:** `listAdminGrants` adayı uygun gösterir. `grantAdmin` önce parolayı yeniden doğrular, sonra transaction'ı yazar: eşleme alanları ve "verildi" kaydı oluşur. Yetkili personel kendi eşlemesini okur ve yönetici yazımı yapar. İkinci verme `already-admin` döner. `revokeAdmin` sonrası yönetici yazımı bir sonraki istekte reddedilir, personel okuması sürer; iki denetim kaydı vardır.
  - **Ek yönetici senaryosu:**
    - İstemci kapısı (`canManageAdmins` false) parola sormadan durur.
    - Kapı atlatılınca kural reddeder; ileti "Kurallar yazımı reddetti…" olur. Kendi yetkisini geri alamaz.
    - Bağlayıcıyla kendi kimlik alanına dokunamaz (`admin-protected`).

### 7.3 `auth_time` gözlemi (emülatör)

- **Kural emülatörü** (`@firebase/rules-unit-testing`): Sahte jetonda varsayılan `auth_time = iat = 0` (1970). Bu yüzden `auth_time` vermeyen oturum reddedilir. `auth_time` saniye cinsinden tamsayı olarak kurala geçer: `request.time.toMillis() - auth_time * 1000 <= 600000`. 9 dakika önce doğrulanmış oturum geçti, 11 dakika önce doğrulanmış oturum reddedildi.
- **Auth emülatörü** (gerçek akış): `reauthenticateWithCredential` jetondaki `auth_time`'ı tazeliyor. Test çıktısı:
  `[İP-7 gözlem] Auth emülatörü auth_time: giriş 2026-11-19T06:42:24.000Z → yeniden doğrulama 2026-11-19T06:42:38.000Z`
- Beklenmedik bir uyuşmazlık görülmedi. Plandaki "emülatör desteklemezse yalnız istemci adımı kalır" geri dönüşüne gerek kalmadı.

### 7.4 Panel duman testi (gerçek Chrome, sahte servis)

Panel gerçek Chrome'da Puppeteer ile, Firestore'suz sahte bir servisle sınandı (geçici betik, repo dışında). Sonuç: `pageerror = 0`.

- **Sahip kipi:** `data-mode=owner`. Açıklama metni birebir. Yardım alanı kapalı açılır, düğmeyle 8 madde gösterir. Ana yönetici satırı var.
- **Adaylar:** uygun / pasif / zaten yönetici, doğru `disabled` durumlarıyla.
- **Arama:** "şule" 1 sonuç.
- **Gerekçe:** 4 karakterde düğme kapalı ve "Gerekçe en az 5 karakter olmalı." görünür. Geçerli gerekçede düğme açılır.
- **Yetki verme:** "✓ … yönetici yapıldı" mesajı; liste yenilenir.
- **Geri alma:** Parolada vazgeçilince "✗ Parola doğrulamasından vazgeçildi; yetki değişikliği yapılmadı." Başarılı geri almada satır kaybolur. Esc pencereyi kapatır.
- **Salt okunur kip:** not var; geri al düğmesi ve "Yetki ver" bölümü yok. Yalnız "Kapat" ve "Nasıl çalışır?" düğmeleri kalır.
- **390 px:** yatay sayfa taşması yok. İlk denemede tablo sütunları üst üste biniyordu; tablo yatay kaydırılan bir kaba alınarak düzeltildi.

## 8. Plandan bilinçli farklar

| Konu | Plan / görev | Uygulama | Neden |
|---|---|---|---|
| Toplu yazma kilidi | `window._bulkLockBlocks?.()` | `window.isBulkWriteLocked(['personel','staffAccounts'])` | `_bulkLockBlocks` modüle özeldi, `window`'da yoktu. Alt çizgili özel adı dışa açmak yerine aynı fonksiyonu adlandırılmış bir köprüyle açtık. |
| Parola doğrulaması | `window.reauthenticateAdmin?.()` | `SecurityConfig.promptAdminReauth` | `window.reauthenticateAdmin` yok. Pencere içeride `SecurityConfig.reauthenticateAdmin`'i çağırır (3 deneme, Vazgeç / Esc). Servise `reauth` bağımlılığı olarak verilir; testte gerçek `reauthenticateWithCredential` kullanılır. |
| `listAdminGrants` okuması | `where adminGranted == true` + personel | Tüm `staffAccounts` + personel + erişim kilidi | "Yetki ver" bölümündeki uygunluk her personelin eşlemesini ister. Liste yetkili ve geri alınmış kayıtları da net döndürür. Yalnız yetkilileri isteyen hafif sorgu `listGrantedMappings()` olarak ayrıca var. |
| Kural bütçesi | — | `member()`, legacy `purchaseOrders`, okuma sıraları, `epUpdate` devretme dalı | §5. Anlamca eşdeğer; ölçümle gerekçelendirildi. |
| Mevcut test değişikliği (KURAL 5) | — | `rules.test.mjs`: "eşlemeyi yalnız admin okur ve yazar" → "eşlemeyi yalnız admin yazar; personel yalnız KENDİ eşlemesini okur (İP-7)" | Plan bilinçli olarak genişletiyor (istemci yetkiyi kendi eşlemesinden öğrenir). Personelin başkasının eşlemesini ve listeyi okuyamadığı ayrıca test edildi. |
| Claim'li hesabın panelde görünmesi | "Eski yöntem (betik)" uyarılı satır | Satır yok; yardım alanında not var | İstemci başkasının claim'ini okuyamaz. Plan "ayrıntı Aşama B'de" diyor. |
| Bakım modunda yetki değişikliği | İstemci kapısı | İstemci durdurur; kural bakımdan bağımsız | Görev metnindeki istemci kapısı. Ana yönetici yazımları kuralda bakımdan etkilenmez (mevcut ilke). |

## 9. Sınırlar ve bilinen konular

- **Aşama B yapılmadı.** `inventoryLiveAdmin` claim dalı (kurallar), `liveAdminSession` / `setFirebaseAuthClaims` (istemci) ve `getIdTokenResult` çağrısı geçiş için yerinde. Claim testi (`rules.test.mjs` "canlı yönetici rolü…", `session-store.test.mjs`) yeşil.
- **Tarayıcı uçtan uca akış (emülatör, `?emu=1`) bu oturumda elle yürütülmedi.** Paylaşılan çalışma ağacındaki emülatör kullanıcının verisiyle çalışıyor olabilir; yeniden tohumlanmadı. Planın üç tarayıcı adımı [v3.6 Kontrol Listesi](./v3.6%20Kontrol%20Listesi.md) › İP-7 bölümüne eklendi. Panelin kendisi gerçek Chrome'da sahte servisle sınandı (§7.4); servis ve kurallar emülatörde gerçek SDK ile sınandı (§7.2).
- **Ek yönetici kilit kartı:** `admin.html` kilit kartı (`unlockAdmin`) ana yönetici parolasıyla oturum açar. Ek yöneticinin oturumu kilitlenirse `index.html`'den yeniden girmesi gerekir. Bu, claim'li yönetici için de bugünkü davranıştır; İP-7 kapsamında değişmedi.
- **Okuma maliyeti:** Panel her açılışta ve her değişiklikten sonra personel listesini ve tüm eşlemeleri sunucudan okur (≈ 2 × personel sayısı). Ekip küçük; Spark kotasında önemsiz.
- **Kural bütçesi payı:** Ek yönetici, yönetici yollarında `isAdmin` başına ≈ 59 ifade harcar (ana yönetici ≈ 20; eski claim'li yönetici de benzerdi). Ağır yönetici transaction'larının ek yönetici ile denenmesi Kontrol Listesi'ne yazıldı.
- **Toplu yazma kilidi istemci kapısıdır;** kural `staffAccounts` için `restoreLock`'a bakmaz. Yetki yazımı zaten ana yöneticiye ve audit'e bağlıdır.

## 10. Yayın adımları ve sonraki adım (Aşama B)

Yalnız kullanıcı onayıyla yapılır; bu işte push ve deploy yapılmadı.

1. **Aşama A:**
   - Önce `firestore.rules`, sonra hosting yayınlanır. Kurallar geriye uyumludur: claim dalı durduğu için muhammed.cer'in mevcut erişimi kesilmez.
   - Hosting önce yayınlanırsa da oturum bozulmaz. Eski kurallar personelin kendi eşlemesini okumasına izin vermez; okuma reddi yakalanır ve yetki yok sayılır (fail-closed).
   - Canlıda ana yönetici VIP › 👑 Yönetici Yetkileri'nden muhammed.cer'e gerekçe ve parolayla yetki verir.
   - Doğrulama: muhammed.cer yeniden girer, "Panele Geç" görünür, panel salt okunur açılır. Güvenlik Raporu'nda "Yönetici Yetkisi Verildi" kaydı görünür.
2. **Aşama B (sonraki görev, `7e`):**
   - Önce hosting yayınlanır: istemcide `getIdTokenResult` / `setFirebaseAuthClaims` / `liveAdminSession` kaldırılır.
   - Sonra kurallar yayınlanır: `isAdmin` ve `regularStaff` claim dalları kaldırılır.
   - Claim testi ret bekleyecek şekilde değiştirilir (KURAL 5, gerekçeli).

## 11. Yerel test walkthrough

```bash
# Kalite kapıları
node scratch/hosting-files.js
npm run lint:xss
npm run test:unit
npm run test:rules          # 8180 portlu ayrı emülatör; çalışan geliştirme emülatörüne dokunmaz
npm run test:staff:emu      # 8280 / 9299 portlu ayrı Auth + Firestore emülatörü
git ls-files --eol -m
```

Tarayıcıda elle (emülatör, `http://127.0.0.1:5500/index.html?emu=1`): adımlar [v3.6 Kontrol Listesi](./v3.6%20Kontrol%20Listesi.md) › "İP-7 · Yönetici Yetkileri" bölümünde.
