# İP-7 · Yönetici Yetkisi Verme Süreci — Uygulama Planı

> **Tarih:** 17.11.2026
> **Dal:** `refactor/v3.7-script-soc-ayristirmasi` (v3.6 klasörünün devamı; çalışma ağacındaki kullanıcı değişikliklerine dokunulmaz, yalnız kendi hunk'larımız commit'lenir)
> **Durum:** Plan — onay bekliyor
> **Belge yeri (onaydan sonra ilk iş):** bu plan `Mimari ve Geliştirmeler/v3.6 Raf yönetimi ve sayım, Envanter No kilidi, mobil ürün formu/İP-7 Yönetici Yetkisi Verme Süreci - Uygulama Planı.md` olarak kopyalanır. 00 plana İP-7 satırı ve Kontrol Listesi'ne İP-7 bölümü eklenir.

## Bağlam

- **İhtiyaç:** muhammed.cer PRI'li personel hesabına yönetici yetkisi verilecek. Bu iş, betikle değil, panelden yürüyen kalıcı bir operasyon süreci olacak.
- **Bugün yetki nasıl veriliyor:** Yönetici yetkisi iki yoldan geliyor.
  - **Ana yönetici hesabı:** `admin@medipol.local`, kurallarda sabit yazılı.
  - **Canlı yönetici yetkisi:** `inventoryLiveAdmin` adlı Firebase yetki iddiası. Bunu repo dışındaki, artık diskte olmayan bir Admin SDK betiği yazıyordu (`scratch/live-admin-candidate/activate.cjs`).
- **Bugünkü eksikler:**
  - Panelden yetki verilemiyor, geri alınamıyor.
  - İz kalmıyor.
  - Yetki verilmiş herhangi bir yönetici `staffAccounts` eşlemesini ve personel kayıtlarını yazabildiği için kuralda "sahip" kavramı yok.

**Onaylanan kararlar (17.11.2026):**

| # | Karar |
|---|---|
| K1 | Yetkiyi **yalnız ana yönetici** (`admin@medipol.local`) verir ve geri alır. Yetki verilen hiçbir personel, muhammed.cer dahil, başkasına yönetici yetkisi veremez, alamaz, değiştiremez. |
| K2 | Eski `inventoryLiveAdmin` yetkisi **yeni sisteme taşınır**. Geçiş süresince kurallar ikisini de tanır. muhammed.cer'e yeni yetki verilip canlıda doğrulandıktan sonra eski yol kurallardan ve istemciden kaldırılır (Aşama B). |
| K3 | Yetki **ortam başına ayrıdır**: canlı (`lifeserver_master`) ve demo (`inventory_demo`) için ayrı verilir. |

## Mimari uyum incelemesi

| # | Konu | İlke | Karar |
|---|---|---|---|
| 1 | Cloud Functions yok (Spark). Yetki iddiası istemciden yazılamaz. | Spark planı | Yetki, **Firestore'da kuralların okuduğu bir alanda** tutulur. İstemci transaction'ı yazar, kurallar doğrular. |
| 2 | Kural bütçesi sıkışık: 1000 ifade sınırı ve istek başına belge erişimi (`firestore.rules:54`, `:769-773`). | KURAL 4 | Bayrak, `staffAccounts/items/{uid}` belgesine konur. Bu belgeyi `staffIdentity` zaten her personel isteğinde `get()` ile okuyor. Aynı yolun ikinci `get()`'i ek erişim sayılmaz. **Personel isteklerine ek belge okuması yok.** Ayrı bir `adminGrants` koleksiyonu her istekte +1 okuma getirirdi; bu yüzden reddedildi. |
| 3 | Bugün her yönetici `staffAccounts` belgesini yazabiliyor; bayrağı kendine ya da başkasına koyabilirdi. | Sütun 2 (kapı veritabanında) | Yetki alanlarını yalnız `isPrimaryAdmin()` değiştirebilir. Ek yönetici yetkili bir eşlemeyi güncelleyemez ve silemez. Yeni eşlemeyi yetki alanlarıyla oluşturamaz. |
| 4 | Ek yönetici, başka bir yöneticinin personel kaydını pasifleştirerek ya da PRI'sini değiştirerek **dolaylı yoldan yetkisini düşürebilirdi**. | K1 | Kurallarda, yetkili kişinin personel kaydında `pri`, `authEmail` ve `active` alanlarını yalnız ana yönetici değiştirebilir. Belge erişimi yalnız bu alanlar değişirken yapılır; diğer personel yazımlarının bütçesi değişmez. |
| 5 | Yetki değişikliği iz bırakmalı ve inkâr edilememeli. | Sütun 1 ve 3 | Değişiklik, **aynı commit'te** oluşturulan denetim kaydıyla yapılır. Desen `envanterNoAuditOk` (`firestore.rules:528`) ile aynı: `!exists` + `getAfter`, tür, `refId == uid`, yazan uid. |
| 6 | Bayrak yazıldıktan sonra kimlik eşlemesi başka bir kişiye kaydırılabilirdi. | Fail-closed | Yetki verilirken personel kaydı taze okunur: `uid` aynı, `active`, `pri` eşleşmeli. Aynı yazımda `personelId` ve `pri` değişemez. Yetki, `isStaff` zinciriyle (erişim kilidi, uid, PRI, aktiflik) birlikte geçerli olur; zincirden biri koparsa yetki **kendiliğinden askıya alınır**. |
| 7 | `createFirestoreLinker`, PRI değişince eşlemeyi `t.set` ile **baştan yazıyor** (`staff-provisioning.js:422`). Bu, yetki alanlarını silerdi. | KURAL 3 | `t.set(..., { merge: true })`. Ek yönetici yetkili bir eşlemeye dokunursa kural reddeder; araç bu durumda anlaşılır bir hata verir. |
| 8 | Yetki claim'de değil, belgede. Geri alma, token yenilenmesini beklemeden **bir sonraki istekte** geçerli olur. | — | Bu, claim'e göre bir kazanç. İstemci kendi eşlemesini dinler ve yetki düşünce paneli kilitler. |
| 9 | Ana yönetici oturumu açık bırakılmış bir cihazda yetki verilebilirdi. | Step-up | İstemci önce `reauthenticateAdmin` (`security.js:85`) ister. Kural da `request.auth.token.auth_time` en çok 10 dakika önce olmalı der. Emülatörde doğrulanır; desteklenmezse yalnız istemci adımı kalır ve walkthrough'a yazılır. |

**Uyumlu olanlar:**
- SDK yalnız `src/services` içinde kalır. UI, `window.*` servislerini çağırır.
- Yeni yardımcılar `window.AppModules.AdminGrants` altına girer.
- Arayüz DOM API ve `escapeHtml` ile yazılır; `lint:xss` temiz kalır.
- Yeni fonksiyonlarda `[WHY]`/`[HOW]` yorumu bulunur (`.agents/rules/constitution.md`).

## Veri sözleşmesi — `{root}/staffAccounts/items/{uid}`

Mevcut alanlar: `personelId`, `pri`, `linkedAt`. Bunlara isteğe bağlı yetki alanları eklenir. Alanlar ya hep birlikte bulunur ya hiç bulunmaz.

| Alan | Tip | Kural |
|---|---|---|
| `adminGranted` | bool | `true` verildi, `false` geri alındı. Belge kalır, geçmiş denetim kaydındadır. |
| `adminChangedAt` | timestamp | `== request.time` |
| `adminChangedBy` | string | `== request.auth.uid` (ana yönetici) |
| `adminReason` | string | 5–300 karakter, `noTag` |
| `adminAuditId` | string | 1–80 karakter, yeni kimlik. Aynı commit'teki denetim kaydını gösterir. |

Denetim kaydı türleri: `yonetici-yetkisi-verildi` ve `yonetici-yetkisi-geri-alindi`.
- `refCol: 'staffAccounts'`, `refId: uid`, `item`: kişi adı, `reason`: gerekçe.
- `fromValue`/`toValue`: `'yok'`/`'yonetici'`.
- `auditLogs` `hasOnly` listesi **değişmez**.

## Uygulama adımları

### 7a · Kurallar (`firestore.rules`)

- **`isAdmin(root)` (:28):** yeni dal eklenir: `|| (get(staffAccount(root)).data.get('adminGranted', false) == true && isStaff(root))`.
  - Her iki geçerli kökte çalışır.
  - Geçiş süresince claim dalı aynen kalır.
- **`regularStaff` (:78):** `&& get(staffAccount(root)).data.get('adminGranted', false) != true` eklenir. Aynı belge olduğu için ek erişim yok.
- **`staffAccounts` bloğu (:799)** bölünür:
  - `read`: yönetici **ya da** `uid == request.auth.uid`. Kişi yalnız kendi eşlemesini okur; istemci yetkiyi böyle öğrenir.
  - `create`: yönetici, yetki alanları **olmadan**.
  - `update`:
    - Yetki alanları değişmiyorsa: yönetici, eski belge yetkili ise yalnız ana yönetici.
    - Değişiyorsa: yalnız `isPrimaryAdmin()` ve `adminGrantWriteOk`. Bu kontrol şunlara bakar: şekil, sunucu saati, `auth_time` tazeliği, `personelId`/`pri` değişmemiş, audit `getAfter`; verilirken personel kaydı `uid`, `active` ve `pri` ile eşleşir.
  - `delete`: ana yönetici ya da yetkisiz eşleme.
- **Genel blok, personel `update` (:731):** `pri`, `authEmail` ya da `active` değişiyorsa ve kaydın `uid`'sinin eşlemesi yetkiliyse yalnız ana yönetici yazabilir. Belge yoksa (`exists`) serbest kalır.

### 7b · Saf çekirdek (`src/utils/admin-grants.js` → `window.AppModules.AdminGrants`)

- `eligibility(person, mapping, accountEmail)` şunlardan birini döndürür: `ok`, `inactive`, `no-account`, `pri-mismatch`, `map-mismatch` ya da `already-admin`. Her biri için Türkçe açıklama verir.
- `grantState(mapping, person, gateOpen)` şunlardan birini döndürür: `active`, `suspended` (personel pasif ya da kilit kapalı; nedeniyle) ya da `none`.
- `planGrant` / `planRevoke`: yazılacak alanları ve denetim girdisini kurar, gerekçeyi doğrular. SDK'ya dokunmaz.
- `AUDIT_TYPES` ve etiketler.

### 7c · Servis (`src/services/admin-grant-service.js`)

- `listAdminGrants()`: `staffAccounts where adminGranted == true` + personel eşlemesi, taze okuma. Tek alan indeksi otomatiktir.
- `grantAdmin(personelId, reason)` / `revokeAdmin(uid, reason)`:
  - İstemci kapısı: `isPrimaryDbAdmin()` (`session-store.js:88`).
  - Ardından `reauthenticateAdmin()`.
  - `_bulkLockBlocks` ve bakım kontrolü.
  - `runTransaction`: personel ve eşleme taze okunur → `planGrant` → `t.update(eşleme)` + `t.set(auditLogs, buildAuditRecord(..., { id }))`. `buildAuditRecord` (`firebase-handler.js:184`) presetId ile çağrılır.
- **`firebase-handler.js` `onAuthStateChanged` (:1152):** personel oturumunda iki kökte de kendi eşlemesi `getDoc` ile okunur ve `session.setStaffAdminGrant(user, data)` çağrılır.
  - Ardından `onSnapshot` ile eşleme dinlenir. Yetki düşünce `onAdminGrantChanged` olayı yayınlanır.
  - `onAuthReady` bu okumadan **sonra** çözülür. Böylece `auth-engine.js:540` "Panele Geç" kararı doğru verir.
- **`session-store.js`:**
  - `isDbAdmin()` = ana yönetici || (geçiş) claim || `grantSession === window.userAuth`.
  - Yeni `canManageAdmins()` = `isPrimaryDbAdmin()`.
  - Çıkışta durum temizlenir.
- **`staff-provisioning.js:422`:** `t.set(..., { merge: true })`.

### 7d · Arayüz (`src/ui/admin-grant-panel.js` + `admin.html` VIP sekmesi)

- **VIP sekmesine "👑 Yönetici Yetkileri" düğmesi** eklenir; `vipStaffGateBtn` deseniyle açılan bir pencere açar (`admin-system-control.js:1418`).
- **Görünür kısa açıklama (AGENTS.md):** "Personel hesaplarına yönetici yetkisi verir ya da geri alır. Yetkiyi yalnız ana yönetici hesabı değiştirebilir; verilen yöneticiler başkasına yetki veremez. Her değişiklik Güvenlik Raporu'na kaydedilir."
- **ⓘ Nasıl çalışır?** düğmesi yardım alanını açar. Anlatılanlar:
  - Uygun kişi koşulları: aktif personel, kurumsal kimlikte (PRI) açılmış hesap.
  - Ortam başına ayrı olduğu.
  - Yetkinin hemen geçerli olduğu.
  - Personel pasifleşir ya da erişim kilidi kapanırsa yetkinin askıya alındığı.
  - Geri almanın etkisi.
  - Şifre doğrulaması.
- **Bölüm 1 · Mevcut yöneticiler:** Ad, PRI, durum (Aktif / Askıda + neden), veren, tarih, gerekçe. Satır başına **"Yetkiyi geri al"** düğmesi (gerekçe zorunlu).
  - Ana yönetici satırı sabit gösterilir: "Ana yönetici (değiştirilemez)".
  - Geçiş sırasında claim'li hesap "Eski yöntem (betik) — panelden yetki verin, sonra eski yöntem kaldırılacak" uyarısıyla görünür. Claim istemcide yalnız kendi oturumunda okunabildiği için bu satır yalnız bilinen eşlemeden gösterilir. Ayrıntı Aşama B'de.
- **Bölüm 2 · Yetki ver:** aranabilir personel seçimi. Uygun olmayanlar soluk görünür ve nedeni yazılır (`eligibility`). Gerekçe alanı → **"Yönetici yap"** → şifre doğrulaması → sonuç mesajı.
- **Ek yönetici paneli açarsa:** liste salt okunurdur. Üstte "Yetkileri yalnız ana yönetici değiştirebilir" notu çıkar; düğmeler yoktur.
- **Yetki düşünce:** `onAdminGrantChanged` → `admin.html` `showAdminLock('not-admin')` çalışır, index'te `.admin-only` gizlenir.
- **Güvenlik Raporu:** iki yeni tür için okunur etiket.
- **Test kancaları:** `#adminGrantPanel[data-mode=owner|readonly]`, `data-role`.

### 7e · Aşama B — eski yetkinin kaldırılması (ayrı commit, muhammed.cer canlıda yeni yetkiyle doğrulandıktan sonra)

- `firestore.rules`:
  - `isAdmin` içindeki `inventoryLiveAdmin` dalı kaldırılır.
  - `regularStaff` içindeki claim kısa yolu kaldırılır.
- `session-store.js`:
  - `setFirebaseAuthClaims` ve `liveAdminSession` kaldırılır.
- `firebase-handler.js`:
  - `getIdTokenResult` çağrısı kaldırılır.
- Testler: claim testi (`rules.test.mjs:1548`) artık **ret** bekler. Bu bilinçli bir sıkılaştırmadır ve walkthrough'da gerekçesiyle yazılır (KURAL 5). `session-store.test.mjs:62-78` buna göre güncellenir.
- Token'daki eski claim zararsız kalır; kurallar artık okumaz. Admin SDK ile temizlik isteğe bağlıdır ve kapsam dışıdır.

### 7f · Altyapı

- `scratch/hosting-files.js` `EXPECTED_COUNT` 126 → **129** (3 yeni dosya) ve açıklama satırı.
- `admin.html` script etiketleri (CSP uyumlu, mevcut sırayla).

## Değişecek dosyalar

| Dosya | Değişiklik |
|---|---|
| `firestore.rules` | `isAdmin`, `regularStaff`, `staffAccounts` bloğu, personel koruması, `adminGrantWriteOk` |
| `src/utils/session-store.js` | grant durumu, `canManageAdmins`, (B) claim'in kaldırılması |
| `src/services/firebase-handler.js` | kendi eşlemesini okuma/dinleme, (B) `getIdTokenResult`'ın kaldırılması |
| `src/services/staff-provisioning.js` | `set` → `merge` |
| `src/utils/admin-grants.js` | **yeni**: saf çekirdek |
| `src/services/admin-grant-service.js` | **yeni**: transaction servisleri |
| `src/ui/admin-grant-panel.js` | **yeni**: panel |
| `admin.html`, `src/modules/admin/admin-system-control.js` | VIP düğmesi, kilit olayı |
| Güvenlik Raporu etiketleri | iki yeni denetim türü |
| `scratch/hosting-files.js` | 126 → 129 |
| Testler | aşağıda |

## Test ve doğrulama

**Başlangıç ölçümü** önce alınır: `npm run test:unit`, `npm run test:rules`, `npm run lint:xss`, hosting sayımı.

**Kural testleri** (`tests/rules/admin-grants.test.mjs`, yeni):
1. Ana yönetici, aktif ve PRI'si eşleşen personele audit'li yetki verir → ✓. Audit yok / tür yanlış / `refId` farklı / eski kimlik → ✗.
2. Yetkili personel canlıda **ve** demoda (yalnız kendi kökünde) yönetici yazımı yapar → ✓. Diğer kökte ✗ (K3).
3. **Ek yönetici başkasına yetki veremez:** başka eşlemede `adminGranted:true` → ✗. Kendi eşlemesinde değişiklik → ✗. Yetki alanlı yeni eşleme `create` → ✗. Yetkili eşlemeyi silme / `personelId` değiştirme → ✗.
4. Ek yönetici, başka bir yöneticinin personel kaydında `active:false` / `pri` / `authEmail` yazamaz → ✗. Aynı kayıtta `jobTitle` yazabilir → ✓. Ana yönetici yazabilir → ✓.
5. Geri alma → bir sonraki istekte yönetici yazımı ✗, normal personel yetkileri ✓.
6. Askıya alma: personel pasif / erişim kilidi kapalı → yönetici yazımı ✗.
7. Pasif ya da `uid` uyuşmayan personele yetki verme → ✗. Aynı yazımda `pri` değişimi → ✗. `adminChangedAt` istemci saati → ✗.
8. `auth_time` 10 dakikadan eski → ✗ (emülatör destekliyorsa).
9. Kişi kendi eşlemesini okur → ✓. Başkasınınkini okuyamaz → ✗.
10. **Bütçe gerilemesi:** mevcut tüm kural testleri, özellikle 10 adımlı satın alma onayı ve personel SARF çıkışı, değişmeden geçer.

**Birim testleri** (`tests/unit/admin-grants.test.mjs`, `session-store.test.mjs` eki): uygunluk nedenleri, plan alanları, gerekçe sınırları, `isDbAdmin`/`canManageAdmins` durumları, çıkışta temizlik. Ayrıca `staff-provisioning` testinde merge davranışı.

**Entegrasyon:** `test:staff:emu`'ya senaryo eklenir: Auth + Firestore emülatörü, gerçek `grantAdmin`/`revokeAdmin` transaction'ı, ek yöneticinin aynı servisi çağırınca reddedilmesi.

**Tarayıcı (emülatör, `?emu=1`):**
1. Ana yönetici VIP › Yönetici Yetkileri'ni açar. Açıklama ve yardım görünür. `flow.personel`'e gerekçe ve şifreyle yetki verir; Güvenlik Raporu'nda kayıt görünür.
2. `flow.personel` gizli pencerede girer, "Panele Geç" çıkar, panel açılır. Yönetici Yetkileri salt okunurdur, düğme yoktur. Konsoldan doğrudan yazma denemesi `permission-denied` verir.
3. Ana yönetici yetkiyi geri alır. `flow.personel` penceresi kilitlenir.

**Kapanış:** `npm run test:all`, hosting sayımı, `git ls-files --eol -m` (satır sonu kontrolü).

## Yayın adımları (yalnız kullanıcı onayıyla; push ve deploy bu işte yapılmaz)

1. **Aşama A:**
   - Önce kurallar, sonra hosting yayınlanır. Kurallar geriye uyumludur; claim dalı durduğu için muhammed.cer'in mevcut erişimi kesilmez.
   - Canlıda ana yönetici panelden muhammed.cer'e yetki verir.
   - Doğrulama: muhammed.cer yeniden girer, panel açılır, Güvenlik Raporu'nda kayıt vardır.
2. **Aşama B:**
   - Önce hosting, sonra kurallar yayınlanır. İstemci claim'e bakmayı bırakır; kurallar claim'i tanımayı bırakır.
   - muhammed.cer'in erişimi yeni yetkiyle devam eder.

## Bilinçli sınırlar

- **Ana yönetici hesabının kendisi panelden yönetilmez.** Parolası tek "sahip" anahtarıdır; kaybı ya da devri bu işin dışındadır.
- **Ek yönetici, Personel Erişim Kilidi'ni kapatabilir** (mevcut acil durum davranışı korunur). Kapatma bütün ek yöneticileri, kendisi dahil, askıya alır; yalnız ana yönetici kapanış kanıtıyla yeniden açabilir. Panelde bu uyarı gösterilir.
- **Ek yöneticinin diğer yönetici yetkileri değişmez:** stok, personel ekleme, onaylar ve diğerleri. Bu iş yalnız yetki dağıtımını kilitler.
- **Rol kademesi yok:** salt okunur yönetici, birim yöneticisi gibi kademeler bu işin kapsamında değil.

## Walkthrough ve commit

- `İP-7 Yönetici Yetkisi Verme Süreci - Implementation Walkthrough.md` iş başında açılır, iş ilerledikçe güncellenir, testlerle kapanır. Biçim mevcut walkthrough'larla aynıdır.
- Gerekirse `İP-7 - Test Kanıtları.txt`.
- **Commit 1:** `feat(yetki): ana yöneticinin verdiği yönetici yetkisi (İP-7 Aşama A)` (kod, testler, walkthrough).
- **Commit 2:** `refactor(yetki): eski inventoryLiveAdmin yolu kaldırıldı (İP-7 Aşama B)`.
- Her commit için yalnız kendi hunk'larımız geçici index ile commit'lenir. Kullanıcının değişiklik yaptığı `admin-dashboard.js`, servisler ve testlere dokunulmaz. Co-Authored-By satırı eklenmez.
