# Faz 4 Uygulama Planı — Yetki ve Güvenlik

> **Tarih:** 30.09.2026 · **Branch:** `feat/phase-4-security-and-rules` (master `2e8ae8f`'den; dalda yalnız plan notu `c89ad3a`)
> **Durum:** ✅ ONAYLANDI (sahibi, 30.09.2026) — KJ-1…KJ-7 önerildiği gibi (a); TEYİT 0.2a/0.2c/0.2d alındı (§7.1).
> **Faz 4A (J0–J6) TAMAMLANDI — 06.10.2026.** Merge'e hazır (sahibinin onayıyla), canlıya deploy edilmedi. Kapanış: `Faz 4 Kapanış Walkthrough.md` · Yayın: `Faz 4A Deploy Runbook.md` (§8'in mühürlü hali).
> **Referans:** Master Plan Faz 4 (4.1-4.8), Ek C (Rules v2), Ek D (Yetki matrisi), Bulgu Kataloğu. Bu plandaki dosya:satır referansları 30.09 tarihli kod taramasından (üç paralel tarama + elle doğrulama) alındı.

## 0. Başlangıç durumu
- Faz 3 + 3.5, master'a `--no-ff` ile merge edildi (`2e8ae8f`, 30.09). Faz 4 dalı açık; tekrar merge gerekmiyor.
- Canlı: `lifeserver_master` (28.09'dan beri), localhost: `inventory_demo`, eski: `inventory_v2` (canlı kullanmıyor, veri korunuyor).
- Canlı deploy Faz 4 sonuna ertelendi (plan notu `c89ad3a`). **Rules v2 ve yeni istemci aynı deploy'da yayınlanır** (§8).

## 1. Taramada çıkan ve Ek C/D'yi değiştiren tespitler

| # | Tespit | Kanıt | Plana etkisi |
|---|---|---|---|
| T1 | Ek C'deki `validRoot` listesi `['inventory_v2','inventory_demo']`; **canlı kök `lifeserver_master` yok** | `firebase-handler.js:41-46` | Taslak olduğu gibi yayınlanırsa canlı site tamamen kilitlenir → §4'te düzeltildi |
| T2 | Firestore kuralları **proje geneli**; `inventory_demo` için "deneme" yayını canlıyı da etkiler. Emulator yok (H1 karar 5), Java 1.8 kurulu (güncel Emulator için yetersiz) | `firebase.json`, `package.json` | Kural doğrulaması ancak Emulator ile güvenli → **KJ-1** |
| T3 | Admin Firebase oturumu kalıcı (persistence ayarı hiç yok); vize dolunca 4 yolun hiçbiri `signOut` çağırmıyor; `checkAuth` kalıcı oturumdan sanal "Admin" üretiyor | `auth-engine.js:231-319`; `admin.html:58-67`; `firebase-handler.js:97-112`; `admin-dashboard.js:1625-1632` | 4.4'ün kapsamı doğrulandı; ayrıca `adminLogout` ("Güvenli Çıkış") da `signOut` etmiyor |
| T4 | `timer.js:52-63` süresi **dolmuş** vizeyi etkinlikle uzatıyor; `alert.js:225` bakım bypass'ında vize 180 dk | timer.js, alert.js | Tek `ADMIN_SESSION_MS` + yalnız geçerli vize uzar |
| T5 | Biyometrik bayrak kapalı ama **self-approval sarmalayıcısı bayrağı yok sayıyor**; `_fallbackChallenge` her 5 karakteri kabul ediyor | `self-approval-reporter.js:353-364, 423-434`; `security-biometrics.js:84` | 4.5 ve 4.7 aynı turda (maskeleme çifti) |
| T6 | `confirmRequest`'in kendi içinde admin / self-approval kontrolü yok; `approveStep`'te adım sahibi kontrolü var, `isDbAdmin` bunu atlıyor; self-approval yalnız index'te (monkey-patch), admin.html'de hiç yok | `script.js:750-821`; `edm-workflow.js:970-993`; `main.js:17` | 4.7 kapsamı doğrulandı |
| T7 | `assignments` ve `serviceRecords` için **personel oturumundan hiçbir yazma yolu yok** (yalnız admin.html) | inventory-management.js:653, 739; purchase-servises.js:748-973 | Ek C uyarısındaki önkoşul sağlandı → J1'de personel listesinden çıkarılır |
| T8 | Personel oturumundan kurala takılacak yazmalar: `toggleWatch` (b1/b2), `importExcel` (B2 etiketi hiç kapılı değil), `deletePurchaseRequest` (sahibine silme izni veriyor), `deleteRequest`/`deleteSelectedRequests` (kendi içinde admin kontrolü yok) | inventory-logic.js:239-255; script.js:1295-1352, 844-853, 1557-1571; purchase-servises.js:1482-1498 | J1'de istemci kapıları ile kural aynı commit'te |
| T9 | XSS: kayıt verisini kaçışsız basan **19 sink** (9'u admin oturumunda). Personelin bugün yazabildiği veriden beslenenler: `getStatusBadge` adım kişisi (`purchase-servises.js:315` → 469, 604), servis kaydı açıklaması (`:887`), `#${item.id}` (`edm-workflow.js:1391`) | XSS taraması | 4.3 gerçek kapsamı: 19 sink + 8 inline handler |
| T10 | Fiilen çalışan `showCustomConfirm` zaten `textContent` (script.js:1397 alert.js:127'yi eziyor). Tek HTML bekleyen çağıran — TODO "Ata" diyaloğu (`todo-module.js:659`) — **bugün bozuk** | script.js, todo-module.js | Tek tanım + `{html:true}` / Node desteği; TODO ata aynı commit'te onarılır |
| T11 | Kurallarda iç içe diziler denetlenemez: `tasks.checklist[].text`, `interactions[].message`, `purchaseOrders.workflow.steps[].note`, `akis[].not`, `files[].name` | alan taraması | `noTag` yalnız üst seviye alanları kapsar; birincil savunma istemci kaçışıdır (belgelenir) |
| T12 | Akış testleri anonim oturumla `inventory_demo`'da gerçek silme yapıyor (temizlik, `saveDataV2`, `hotfixBulkLock`); Rules v2 yayınlanınca kırılır | flow-tests.js:36-39, 2257-2268 | **KJ-5** (demo kökünde test işaretli silme) |
| T13 | Faz 0 TEYİT 0.2a (parola), 0.2c (canlıdaki kurallar), 0.2d (plan/Storage) belgelerde hâlâ açık | Faz 0 raporu §1 | §7 sahibinin işleri; 0.2c deploy öncesi zorunlu |
| T14 | Admin parolası `"0" + 5 hane` biçiminde (`security.js:15`); Auth proje geneli → parolayı ≥12 karaktere **erken** döndürmek, yayındaki eski arayüzde (maxlength 5) admin'i kilitler | security.js | Parola rotasyonu deploy ile aynı gün (§8) |
| T15 | `sortablejs@latest` sabitlenmemiş CDN sürümü (tedarik zinciri) | admin.html:31 | J5'te sürüm sabitleme |

## 2. Tur haritası

| Tur | Kapsam | Bulgular | Efor | Önkoşul |
|---|---|---|---|---|
| **J0** | Doğrulama altyapısı: Firestore Emulator + kural test iskeleti (Ek D senaryoları, mevcut kurallarda kırmızı baseline); uygulamayı emülatöre bağlayan yerel mod | OPS (Faz 7) | M (~1 gün) | KJ-1, JDK 21 |
| **J1** | 4.1 matris onayı + **4.2 Rules v2 Aşama A** + istemci hizalaması | RULE-01 (kısmi), RULE-02 (kısmi), RULE-05, T7, T8 | M-L (~1,5 gün) | J0, TEYİT 0.2c |
| **J2** | **4.3 XSS'in tamamı**: 19 sink, 8 inline handler, onay/uyarı API'si, XSS regresyon kapısı | SEC-01, EBYS-03, ADM-01, TODO-04 artığı | L (~2 gün) | – |
| **J3** | **4.4 Oturum ve vize**: tek `endAdminSession`, `browserSessionPersistence`, sanal Admin'in kaldırılması, depolama bayrağı kontrolleri, 5 hane sınırı | AUTH-05, AUTH-06, SEC-02 (arayüz) | M (~1,5 gün) | – |
| **J4** | **4.7 Self-approval iş kuralı + 4.5 biyometrik**: kontrol `confirmRequest`/`approveStep` içinde, `auditLogs` koleksiyonu, rapor ekranı, biyometrik yedek yolunun kapatılması | EBYS-04, EBYS-05, AUTH-03 | M (~1 gün) | J1 (auditLogs kuralı), J3 |
| **J5** | **4.8 Dağıtım sertleştirme**: firebase.json başlıkları + CSP, nginx/Docker, CDN sürüm sabitleme, EmailJS, Storage kuralları (K11'e bağlı) | SEC-03, SEC-05, ARC-08, OPS-04 | M (~1 gün) | TEYİT 0.2d |
| **J6** | Kapanış: Ek A regresyonu (Güvenlik bölümü dahil), walkthrough, merge hazırlığı, **deploy runbook'u** | – | S-M (~0,5 gün) | J0-J5 |
| **J7-J10** | **Faz 4B — Aşama B** (4.6 · K4): personel başına Auth hesabı; ayrı alt plan (§6) | RULE-02, AUTH-07, AUTH-09 | L (~4-6 gün) | Faz 4A deploy'u + 1 hafta saha |

**Toplam Aşama A:** ~8,5 iş günü. Turlar sırayla ilerler; her tur kendi commit'leri, akış testleri ve walkthrough'u ile kapanır (§7.1-7.2).

---

## 3. Turların ayrıntısı

### J0 — Doğrulama altyapısı
**Neden önce:** Kurallar proje geneli olduğundan (T2), Emulator olmadan tek doğrulama yolu canlıya yayın olur.
1. `package.json` → devDependencies: `firebase-tools`, `@firebase/rules-unit-testing`; betikler `npm run test:rules` (`firebase emulators:exec --only firestore "node --test tests/rules"`), `npm run smoke`, `npm run flow`.
2. `firebase.json` → `emulators: { firestore: { port: 8080 }, auth: { port: 9099 }, ui: { enabled: false } }`.
3. `tests/rules/rules.test.mjs` (node:test): Ek D satırlarından senaryolar — anonim / admin / oturumsuz × koleksiyon × işlem; bakım modu açık/kapalı; `noTag` (`<img` ret, `<5mm` serbest); geçersiz kök; `auditLogs` yalnız ekleme. **Önce mevcut kurallara karşı çalıştırılır** → kırmızı baseline kayda geçer (bugün anonim talep silebiliyor vb.).
4. **Uygulamanın emülatör modu (yerel):** `firebase-handler.js` yalnız `localhost/127.0.0.1` + `?emu=1` iken `connectFirestoreEmulator` / `connectAuthEmulator`; ENV_GUARD logu `inventory_demo @ emulator` yazar. Emülatördeki sahte admin hesabı betikle oluşturulur (gerçek kimlik bilgisi yok → §7.5 ile uyumlu). Kazanç: **admin oturumu gerektiren akışlar ilk kez otomatik test edilebilir** ve Rules v2 yayınlanmadan uçtan uca denenir.
5. `flow-tests.js`'e `--emu` bayrağı: aynı senaryolar emülatörde, admin senaryoları dahil.
- *Kabul:* `npm run test:rules` çalışıyor (mevcut kurallarda beklenen kırmızılar listeli); `?emu=1` ile index ve admin açılıyor, smoke metrikleri baseline ile aynı.

### J1 — Rules v2 Aşama A + istemci hizalaması (4.1 + 4.2)
1. **Ek D onayı (4.1)**: Bu planın onayı Ek D'nin Aşama A satırlarını da onaylar; "Ziyaretçi ✗" satırları Aşama B hedefidir (Aşama A'da kod girmemiş ziyaretçi ile personel aynı anonim oturumu taşır — dürüstçe belgelenir).
2. `firestore.rules` → §4'teki taslak (T1 düzeltmesi, bilinen koleksiyon listesi, `assignments`/`serviceRecords` personel listesinden çıkar, silme yalnız `tasks`, bakım modu, `noTag`, `auditLogs`, `inventory_v2` KJ-2'ye göre, kök `/system_config` bloğu kaldırılır — uygulama okumuyor).
3. **İstemci hizalaması (aynı commit, maskeleme çiftleri M1-M5):**
   - `deletePurchaseRequest`: sahibinin silme izni kalkar → yalnız `isDbAdmin`; personele "Talebi iptal edebilirsiniz; silme yöneticiye aittir".
   - `deleteRequest`, `deleteSelectedRequests`, `updateServiceStatus`, `removeAssignment`'ın `applyItemOps` dalı, `saveUnitData/deleteUnit`, `deleteWorkflowTemplate`, `addPersonel/editPersonel/deletePersonel`: fonksiyon içinde `isDbAdmin` (bugün yalnız arayüz kapılı).
   - `toggleWatch` ve `importExcel` (B1 + B2 etiketleri): personelde "Bu işlem için yönetici yetkisi gerekir" (bugün kural reddi genel hata olarak düşüyor).
   - Bakım modu: `permission-denied` + `window.data.config.maintenance === true` → "Sistem bakımda: kayıt yapılamıyor" (genel "kaydedilemedi" yerine).
   - `noTag` ön doğrulaması: `html.js` → `hasTagLike(text)` (kuraldaki regex'in aynısı); talep, görev ve satın alma formları kayıttan **önce** kullanıcıya alan adıyla uyarır.
   - Test temizliği: KJ-5'e göre demo istisnası veya temizliğin emülatöre taşınması.
4. Kural testleri yeşile döner; flow suite hem gerçek `inventory_demo` (eski kurallar yayında) hem emülatör (yeni kurallar) üzerinde koşar.
- *Kabul:* `test:rules` tamamen yeşil; emülatör modunda personel: talep oluştur/geri çek/gönder/teslim al ✓, görev CRUD ✓, satın alma talebi + onay ✓, talep/satın alma silme ✗ (anlaşılır mesajla), bakımda yazma ✗ (bakım mesajıyla), admin her şey ✓.

### J2 — XSS'in tamamı (4.3)
1. **Sinkler (19)**, önce personelin yazabildiği veri:
   - `purchase-servises.js:315` `getStatusBadge` adım kişisi (→ 469, 604 · admin'de canlı), `:887` `originalData.açıklama`, `edm-workflow.js:1391` `#${item.id}`.
   - Admin yazımlı veri (savunma derinliği; Aşama B'de personel yazabilir hale gelebilir): `table-engine.js` `_buildRowInnerHtml` (L50-67), `renderCardSearchResults` (L353-357), `renderMobileCards` (L446-468); `admin-dashboard.js:1021-1022` (kritik stok), `:1481` (özel izleme), `:1807` (mahal `title`), `:1406` (ölü, yine de); `edm-workflow.js:481-484, 1624-1625, 2269` (personel adları); `ui-components.js:180-183` (ürün türü `option`); `auth-engine.js:193` (navbar adı); `script.js:1285` (PDF popup `document.write`).
   - Hata metinleri: `admin-system-control.js:361`, `edm-workflow.js:1442`.
   - **Kural:** Kaçış, ham kayıt alanının şablona girdiği noktada yapılır; birleştirilmiş HTML (ör. `getStatusBadge` çıktısı) tekrar kaçırılmaz (M7 · çift kaçış `&amp;amp;` riski).
2. **Inline handler'lar (8) → `data-id` + delegation:** `admin-dashboard.js:1034` (kritik grup anahtarı), `:1473/1498/1499` (tüm kaydın JSON'u → yalnız `data-id`, kayıt `window.data`'dan id ile çözülür), `edm-workflow.js:478, 1621` (personel adı), `table-engine.js:45, 88` (tarih). Yardımcı: `html.js` → `bindActions(container, {action: fn})` — tek dinleyici, `closest('[data-action]')`, `dataset.id`; örnek desen `ui-components.js:647-680`. `jsArg` kullanan 92 handler güvenli; dönüşümleri **KJ-6**.
3. **Onay/uyarı API'si:** `showCustomConfirm` tek tanım (alert.js; script.js kopyası kaldırılır — global ad kuralı): varsayılan `textContent` + `pre-line`; `message` bir `Node` ise `appendChild`; `{html:true}` yalnız sabit metinler için. `showAppAlert(message, type, {html})` aynı sözleşme (bugün çağıran yok). `showSuccessBanner` (çağıranı yok) `textContent`'e. **Aynı commit:** TODO "Ata" diyaloğu `Node` ile onarılır (`todo-module.js:659, 667`), `:774`'teki 4 argümanlı çağrı düzeltilir (M6).
4. **Regresyon kapısı:** `scratch/xss-lint.js` — `innerHTML`/`insertAdjacentHTML`/`document.write` içinde `${…}` olup `escapeHtml(`/`jsArg(`/`esc(` ile sarılmayanları sayar; izinli istisnalar satır sonu `// xss-ok: <neden>` ile. Sayı smoke raporuna eklenir, **artarsa tur kapanmaz**. `xssAdminPanel` senaryosu b1/b2, personel, servis kaydı ve mahal yüklerini de kapsar (admin yazımları emülatör modunda).
- *Kabul:* `<img src=x onerror=alert(1)>` ve `"><svg onload=…>` yükleri hiçbir ekranda çalışmıyor (index + admin, masaüstü + mobil kart); xss-lint = 0 izinsiz sink; TODO ata çalışıyor.

### J3 — Oturum ve vize (4.4)
1. **Tek sonlandırma yolu:** `SecurityConfig.endAdminSession(reason)` = `clearSession()` → `await signOut` → `onAppLogout` yayını → sayfaya göre kilit kartı / `index.html`. Bağlanan yollar: `admin.html:58-67` (aralık kontrolü), `firebase-handler.js:97-112` (`checkAdminAuth` süre dolumu), `admin-dashboard.js:1625-1632` ("Güvenli Çıkış"), `timer.js:167-178` (şimdi `await`'li), `firebase-handler.js:165-166` (force logout yedeği).
2. **Kalıcılık:** `SecurityConfig.authenticate` → `setPersistence(auth, browserSessionPersistence)` sonra `signInWithEmailAndPassword`; çıkışta anonim oturumdan önce `browserLocalPersistence`'a dönülür (personel davranışı değişmez).
3. **Tek süre:** `ADMIN_SESSION_MS` (10 dk) — `auth-engine.js:464, 567`, `alert.js:225` (180 dk!), ölü `loginAsAdmin` (`firebase-handler.js:82-95`, silinir) hepsi Session Store'dan okur. `timer.js:52-63` yalnız `expiry > now` ise uzatır; değilse `endAdminSession('expired')`. Kilit kartı açıkken etkinlik vizeyi uzatmaz.
4. **Sanal Admin:** `auth-engine.js` `checkAuth`'taki `isDbAdmin → setActiveUser({name:'Admin'})` kaldırılır. Geçerli vize + kimlik yoksa kalıcı admin oturumu "bayat" sayılır → `endAdminSession('stale')` (M9). Parola **girildikten sonra** kimlik atayan yedekler (`auth-engine.js:483-485`, `alert.js:234`, `admin.html:81`) kalır, "Yönetici" etiketiyle.
5. **admin.html kapısı:** `checkAdminAuth` yalnız `admin_auth` süresine değil, auth hazır olduğunda `isDbAdmin()`'e de bakar; değilse kilit kartı (yeni sekmede oturum yok → yeniden parola; M8).
6. **Depolama bayrağına dayanan yetki kontrolleri → `isDbAdmin`:** `script.js:970`, `ui-components.js:512-513` (demirbaş çıkış muhafızı `adminVizesi` ile atlanabiliyor), `edm-workflow.js:2333` (şablon kaydı), `firebase-handler.js:412-419` (bakım muafiyeti). İsim tabanlı "Güvenlik Raporu" kapısı J4'te.
7. **Parola alanları (SEC-02 arayüz):** `index.html:1211` ve `:191` `maxlength="5"` kalkar; metinler "5 haneli" yerine "kod / parola". `security.js:15` geçiş kuralı: 5 karakter → eski `"0"+kod` biçimi, ≥12 → olduğu gibi, 6-11 → "Yönetici parolası en az 12 karakter" (M11). Admin alanında yapıştırmaya izin (parola yöneticisi); personel kodunda mevcut davranış kalır. Eski dal, sahibinin rotasyon teyidinden sonra Faz 4 kapanış hotfix'inde kaldırılır.
- *Kabul (Ek A):* tarayıcı kapat-aç → admin oturumu yok, index personel girişi ister; vize dolumu → Firebase oturumu kapalı (konsolda `userAuth.isAnonymous === true`); kilit kartından açma → canlı veri akmaya devam ediyor; "Güvenli Çıkış" → `signOut`; F5 süresi dolmuş vizeyi canlandırmıyor; 12+ karakterli parola emülatör hesabında çalışıyor.

### J4 — Self-approval iş kuralı + biyometrik (4.7 + 4.5)
1. **Tek politika:** `schema.js` → `isSelfApproval({actor, record, kind})` (ad normalizasyonu + `personelId` + kod; `requests.personel/personelId`, `purchaseOrders.createdBy/createdByName`).
2. **Uygulama noktası:** `confirmRequest` (`script.js:750`) ve `approveStep` (`edm-workflow.js:986`) içinde, iki sayfada da:
   - `confirmRequest` başına `isDbAdmin` (bugün yok — T6).
   - Personel kendi kaydını onaylayamaz → engel + günlük `result:'blocked'`.
   - Admin kendi kaydı → **KJ-3** (öneri: `reauthenticateWithCredential` ile parola yeniden doğrulama → `approved`; vazgeçerse `cancelled`).
   - `self-approval-reporter.js`'teki monkey-patch sarmalayıcıları **aynı commit'te** kaldırılır (M12); modül yalnız günlük yazıcı + rapor arayüzü olur.
3. **Denetim günlüğü:** `firebase-handler.js` → `appendAuditLog(entry)` (servis katmanı, yalnız `setDoc` create; `COLLECTIONS`'a **eklenmez** — personel okuyamaz, dinleyici izin hatası vermesin). Kayıt: `{id, type, refCol, refId, item, qty, actorName, actorPersonelId, uid, authKind, result, reason, page, ts: serverTimestamp()}`. sessionStorage anahtarı ve `clearSession`'daki silme kalkar; `saveData`, yedek al/geri yükle `auditLogs`'a dokunmaz (M14).
4. **Rapor ekranı:** açılışta `getDocs(orderBy ts desc, limit 200)` (sürekli dinleyici yok → kota dostu); buton `isDbAdmin` ile, **admin.html navbar'ında da**; rozet `result` enum'una göre; satın almada `urun`/`adet` alanları (EBYS-05 artıkları).
5. **Biyometrik (4.5 · K2):** `ENABLE_BIOMETRIC_LOGIN=false` Session Store'a taşınır (tek bayrak, auth-engine buradan okur); `verifyBiometrics` bayrak kapalıyken `false` döner, `_fallbackChallenge` (her 5 karakteri kabul eden prompt) kaldırılır (M13). Gerçek WebAuthn kaydı (K2-b) bu fazda yapılmaz; sunucusuz ortamda yalnız bir UX kapısı olacağı plan notuna yazılır.
> **J4 notu (05.10.2026 · 4.5):** Biyometrik bayrak kapalı kaldı; yedek yol kaldırıldı. Gerçek WebAuthn kaydı (K2-b) yapılmadı: sunucusuz mimaride doğrulama sonucu istemcide değerlendirilir, yani yalnız bir UX kapısı olur (yetki sağlamaz; yetki Firebase oturumu + kurallardır). Admin'in kendi kaydını onaylaması parola yeniden doğrulamasıyla (KJ-3).
- *Kabul:* personel kendi satın alma adımını onaylayamıyor → `auditLogs`'ta `blocked` kaydı; admin kendi talebinde parola ister, doğru parolayla onaylar → `approved`; rapor ekranı iki sayfada da kayıtları gösteriyor, sekme kapatınca kaybolmuyor; `auditLogs` update/delete admin dahil reddediliyor (rules testi).

### J5 — Dağıtım sertleştirme (4.8)
1. **firebase.json:** ignore listesi Faz 0'da tamam; son kontrol + `tests/**`, `storage.rules`, `*.ps1`. Başlıklar (tüm yollar): `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`, **CSP**:
   ```
   default-src 'self';
   script-src 'self' 'unsafe-inline' https://www.gstatic.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net;
   style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com;
   font-src 'self' https://cdnjs.cloudflare.com data:;
   img-src 'self' data: blob: https://firebasestorage.googleapis.com;
   connect-src 'self' https://*.googleapis.com https://firebasestorage.googleapis.com https://api.emailjs.com wss://*.firebaseio.com;
   frame-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
   ```
   `'unsafe-inline'` zorunlu: yüzlerce satır içi handler ve inline module var (KJ-6 Faz 6'da kaldırılmasının yolunu açar). Asıl kazanç: `connect-src` veri sızdırmayı, `object-src/base-uri/frame-ancestors` enjeksiyon yan kanallarını kapatır. Nihai liste J5'in ilk adımında gerçek istek günlüğünden çıkarılır (M15).
2. **Yerel CSP doğrulaması:** smoke/flow betikleri puppeteer istek yakalamayla HTML yanıtlarına aynı başlığı ekler; `securitypolicyviolation` sayısı rapora girer, **tam suite 0 ihlal** → KJ-4.
3. **CDN:** `sortablejs@latest` → sabit sürüm; iki sayfadaki `jspdf-autotable` (3.8.2 / 3.5.28) ve font-awesome sürümleri eşitlenir; kullanılmayan `firebase-*-compat` (index.html:11-12) kaldırılır (hiçbir yer `firebase.*` kullanmıyor). SRI isteğe bağlı (sabit sürümlerde eklenebilir).
4. **nginx/Docker (SEC-03):** engeller `location ^~ /backup/` vb. (regex JS kuralından önce kazanır); güvenlik başlıkları + CSP ortak `include` ile her location'da; JS/CSS `no-cache` (hash'siz dosyalara 1 yıl `immutable` kalkar); `X-XSS-Protection` kaldırılır; `50x.html` eklenir veya yönerge kaldırılır; `.dockerignore`'a `backup_txt/`, `tests/`, `firebase.json`, `storage.rules`.
5. **EmailJS (SEC-05):** kod tarafında değişiklik gerekmez (anahtar zaten public); sahibi EmailJS panelinde izinli alan adını canlı alan adıyla sınırlar, aylık kota/rate limit açar, şablonda `{{ }}` (kaçışlı) kullanıldığını teyit eder (§7).
6. **Storage (OPS-04 · K11):** TEYİT 0.2d'ye bağlı. Storage aktifse `storage.rules`: `purchaseFiles/{file}` — okuma `signedIn`, yazma `signedIn && size < 10 MB && contentType` beyaz listesi, silme admin; `firebase.json`'a `storage` hedefi. Aktif değilse EBYS-14 zaten açık hata veriyor; kural yazılmaz, not düşülür.
- *Kabul:* CSP ihlali 0 (index + admin, Ek A akışları); `nginx -t` geçiyor; docker imajında `backup*`, `scratch`, `*.md` yok.

### J6 — Kapanış
Ek A tam liste (Güvenlik bölümü dahil) + `test:rules` + flow suite (gerçek demo + emülatör) + smoke + xss-lint + CSP sayacı; walkthrough (commit hash'leri, `git diff --stat`, kanıt); master planın Faz 4 satırlarına durum; merge hazırlığı; §8 runbook sahibine.

---

## 4. Rules v2 · Aşama A — güncellenmiş taslak
Ek C'den farklar: T1 (`lifeserver_master`), bilinen koleksiyon listesi, koleksiyona özgü `textOk`, `auditLogs`, `inventory_v2` (KJ-2), demo test istisnası (KJ-5), kök `/system_config` kaldırıldı.

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function signedIn() { return request.auth != null; }
    function isAdmin()  { return signedIn() && request.auth.token.get('email', '') == 'admin@medipol.local'
                                 && request.auth.token.firebase.sign_in_provider == 'password'; }
    function validRoot(r)     { return r in ['lifeserver_master', 'inventory_demo']; }
    function knownCol(c)      { return c in ['b1','b2','b3','personel','productTypes','purchaseOrders','serviceRecords',
                                             'staff','units','locations','tasks','requests','assignments',
                                             'system_config','workflowTemplates']; }
    function staffWritable(c) { return c in ['purchaseOrders', 'requests', 'tasks']; }

    function maintenanceOn(r) {
      let p = /databases/$(database)/documents/$(r)/system_config/items/admin_settings;
      return exists(p) && get(p).data.get('maintenance', false) == true;
    }

    // XSS savunma derinliği: "<harf", "</", "<!", "<?" reddedilir; "<5mm", "a < b" serbest.
    // Yalnız üst seviye alanlar (iç içe diziler kurallarla denetlenemez — birincil savunma istemci kaçışı).
    function noTag(v) { return !(v is string) || !v.matches('(?s).*<[a-zA-Z/!?].*'); }
    function textOk(c, d) {
      return noTag(d.get('id', ''))
        && (c != 'requests' || (noTag(d.get('ürün','')) && noTag(d.get('urun','')) && noTag(d.get('not',''))
             && noTag(d.get('personel','')) && noTag(d.get('talepTuru','')) && noTag(d.get('oncelik',''))))
        && (c != 'tasks' || (noTag(d.get('title','')) && noTag(d.get('description','')) && noTag(d.get('priority',''))
             && noTag(d.get('assigneeId','')) && noTag(d.get('creatorId',''))))
        && (c != 'purchaseOrders' || (noTag(d.get('urun','')) && noTag(d.get('aciklama','')) && noTag(d.get('talepEden',''))
             && noTag(d.get('birim','')) && noTag(d.get('tur','')) && noTag(d.get('evrakNo',''))
             && noTag(d.get('oncelik','')) && noTag(d.get('createdByName',''))));
    }

    // KJ-5: yalnız demo kökünde, akış testi işaretli dokümanların temizliği
    function isTestDoc(d) {
      return d.get('ürün','').matches('.*__flowtest__.*') || d.get('urun','').matches('.*__flowtest__.*')
          || d.get('not','').matches('.*__flowtest__.*')  || d.get('sn','').matches('.*__flowtest__.*');
    }

    match /{root}/{col}/items/{docId} {
      allow read:  if validRoot(root) && knownCol(col) && signedIn();
      allow write: if validRoot(root) && knownCol(col) && isAdmin();

      // Personel (Aşama A'da anonim oturum): yalnız iş akışı koleksiyonları
      allow create, update: if validRoot(root) && signedIn() && !isAdmin()
        && staffWritable(col) && !maintenanceOn(root) && textOk(col, request.resource.data);

      // Silme: personel yalnız görev; talepler/satın almalar/zimmet/servis admin'e ait
      allow delete: if validRoot(root) && signedIn() && col == 'tasks' && !maintenanceOn(root);
      allow delete: if root == 'inventory_demo' && signedIn()
        && col in ['requests','purchaseOrders','assignments','serviceRecords'] && isTestDoc(resource.data);
    }

    // Denetim günlüğü: yalnız ekleme; admin dahil kimse düzeltemez/silemez (4.7)
    match /{root}/auditLogs/items/{logId} {
      allow read:   if validRoot(root) && isAdmin();
      allow create: if validRoot(root) && signedIn()
        && request.resource.data.keys().hasOnly(['id','type','refCol','refId','item','qty','actorName',
             'actorPersonelId','uid','authKind','result','reason','page','ts'])
        && request.resource.data.result in ['blocked', 'approved', 'cancelled']
        && request.resource.data.ts == request.time
        && request.resource.data.uid == request.auth.uid
        && noTag(request.resource.data.get('item','')) && noTag(request.resource.data.get('actorName',''))
        && noTag(request.resource.data.get('reason',''));
      allow update, delete: if false;
    }

    // KJ-2 (öneri): eski canlı kök yalnız admin'e açık (yedek/göç için)
    match /inventory_v2/{document=**} { allow read, write: if isAdmin(); }

    // V1 arşiv kilidi
    match /inventory/{document=**} { allow read, write: if false; }
  }
}
```
**Bilinçli sınırlamalar (Aşama B'de kapanır):** personel koleksiyonu (düz metin `code`) oturumlu herkese okunur — giriş istemci tarafında bu listeyle yapılıyor; personel `requests`/`purchaseOrders` dokümanlarında sahiplik denetimi yok (konsoldan başkasının talebini "approved" yapmak mümkün); kod girmemiş ziyaretçi = personel. **Maliyet:** personelin her yazması bakım dokümanı için +1 okuma.

## 5. Maskeleme çiftleri (Faz 4 · aynı commit)

| # | Tur | Birinci taraf | Açığa çıkan / eşlik eden |
|---|---|---|---|
| M1 | J1 | Personel silme yetkisi kuralda kapanır | `deletePurchaseRequest` sahibi silme izni + `deleteRequest(s)` fonksiyon içi `isDbAdmin` + anlaşılır mesaj |
| M2 | J1 | `maintenanceOn` kuralı | Bakımda yazma reddi "bakım" mesajıyla (genel hata değil) |
| M3 | J1 | `noTag` kuralı | İstemci ön doğrulaması `hasTagLike` (aynı regex), alan adıyla uyarı |
| M4 | J1 | Anonim silme kapanır | Akış testi temizliği (KJ-5 demo istisnası veya emülatör) |
| M5 | J1 | `assignments`/`serviceRecords` personelden çıkar | `updateServiceStatus` ve `removeAssignment` dalında `isDbAdmin` (personel yazıcısı olmadığı doğrulandı — T7) |
| M6 | J2 | `showCustomConfirm` tek tanım, varsayılan metin | TODO "Ata" diyaloğu (Node mesaj) — bugün bozuk, aynı commit'te çalışır |
| M7 | J2 | Kaçış eklenmesi | Birleştirilmiş HTML'in (rozet vb.) tekrar kaçırılmaması — çift kaçış |
| M8 | J3 | `browserSessionPersistence` | admin.html'in yeni sekmede/doğrudan açılışta `isDbAdmin` kapısı → kilit kartı |
| M9 | J3 | Sanal "Admin" kaldırılır | Bayat admin Firebase oturumunun `signOut` edilmesi (yoksa kimliksiz DB-admin kalır) |
| M10 | J3 | Kilitte `signOut` | Kilit açılınca dinleyicilerin yeniden başlaması (Faz 1.7/3.8 mekanizması) + çıkışta local persistence'a dönüş |
| M11 | J3 | `maxlength=5` kalkar | `security.js` `"0"+` geçiş kuralı (bugünkü parola çalışmaya devam eder) |
| M12 | J4 | Monkey-patch sarmalayıcılar kalkar | Kontrolün `confirmRequest` + `approveStep` içinde olması |
| M13 | J4 | Biyometrik yedek kapanır | Admin self-approval doğrulaması parola yeniden doğrulamasıyla (KJ-3) |
| M14 | J4 | `auditLogs` değişmez | `saveData`/yedek/geri yükleme `auditLogs`'u dışarıda bırakır; `clearSession` günlük silmez |
| M15 | J5 | CSP `connect-src` | Kullanılan her kaynak (Firestore, Auth, Storage, EmailJS, CDN) listede; yerel ihlal sayacı 0 |
| M16 | Deploy | Rules v2 | Yeni istemci aynı deploy'da (eski istemci yeni kurallarda personel akışlarını kırar) |
| M17 | Deploy | Parola ≥12 rotasyonu | J3 kodunun yayında olması (T14) |

## 6. Faz 4B — Aşama B: Personel kimlik modeli (4.6 · K4) özeti
**Hedef:** Anonim oturumu kapatmak; personel başına Firebase Auth hesabı (Spark'ta ücretsiz) ile kuralların sahiplik denetlemesi. Faz 4A deploy'undan ve bir haftalık sahadan sonra, kendi ayrıntılı planıyla.

| Tur | İçerik |
|---|---|
| **J7 · Hesap altyapısı** | Hesap e-postası `p<personelId>@staff.medipol.local` (sentetik, doğrulanmaz); parola = giriş kodu + dolgu (Firebase ≥6); **kod uzunluğu 5 → 8'e çıkarılması önerilir** (Firebase deneme kısıtlaması + daha büyük arama uzayı). Oluşturma: admin panelinde ikincil app instance'ı (`initializeApp(config, 'provisioner')`) → `createUserWithEmailAndPassword` (admin oturumu düşmez) → `personel.uid`. Kod sıfırlama / hesap silme: sahibinin makinesinde yerel `firebase-admin` Node betiği (servis hesabı anahtarı repoya girmez, Blaze gerekmez) |
| **J8 · Hibrit giriş** | `STAFF_AUTH_MODE: 'anonymous' → 'hybrid' → 'accounts'`. Hibritte giriş önce hesapla, yoksa eski kod eşleşmesiyle; Aşama A kuralları yürürlükte. K5 (yenilemede oturum) kendiliğinden gelir. Personel `code` alanı istemciden artık okunmaz |
| **J9 · Sahiplik alanları + göç** | `requests.personelUid`, `purchaseOrders.createdByUid`, `workflow.steps[].userUid`, `tasks.assigneeUid/creatorUid`; VIP'te önizlemeli ve snapshot'lı tek seferlik göç (id/ad eşleşmesiyle). `createdBy`'daki giriş kodu sızıntısı biter |
| **J10 · Rules Aşama B + kapanış** | `isStaff()` (sağlayıcı `password` ve `@staff.` alanı — ek okuma yok; admin rolü bugünkü e-posta ile, çok rollü ihtiyaç doğarsa `roles/{uid}`); `requests` update yalnız sahibi ve `affectedKeys().hasOnly([...])`; `purchaseOrders` onayı `steps[currentStep].userUid == auth.uid`; `tasks` atanmış/oluşturan; `personel` kodları kalkar (yalnız admin okur hassas alanları); Console'da anonim auth kapatılır; Ek D "Ziyaretçi ✗" sütunu gerçek olur |

**Riskler:** her personel için bir kez hesap açılışı (toplu açma betiği önerilir); kod unutma = admin sıfırlaması; paylaşılan cihazda K5 → personel oturumu için de süre sınırı. **Efor:** L, ~4-6 gün.

## 7. Kararlar ve sahibinin işleri

**Karar gereken (onayla birlikte):**

| # | Konu | Seçenekler | Önerim |
|---|---|---|---|
| KJ-1 | Kural doğrulama ortamı | (a) Firestore/Auth Emulator (JDK 21 kurulumu + `firebase-tools` devDependency, yerel ve ücretsiz); (b) Emulator'süz, doğrudan yayın | **(a)** — kurallar proje geneli; (b) canlıda deneme demek. H1 karar 5'in Faz 4 için güncellenmesi |
| KJ-2 | `inventory_v2` (eski canlı kök) | (a) Yalnız admin okur/yazar; (b) Tam kilit; (c) Bugünkü gibi | **(a)** — veri korunur, yedek/göç mümkün, personel erişimi kapanır |
| KJ-3 | Admin kendi talebini/adımını onaylarsa | (a) Parola ile yeniden doğrulama + günlük; (b) Tamamen yasak | **(a)** — sistemde tek admin var; (b) admin'in kendi talebini hiç kapatamaması demek |
| KJ-4 | CSP yayını | (a) Doğrudan uygula (yerelde tam suite 0 ihlal ile); (b) Önce Report-Only | **(a)** — rapor uç noktası olmadığı için Report-Only ihlalleri kimse görmez; geri alma bir hosting rollback'i |
| KJ-5 | Demo kökünde test işaretli dokümanlar için silme istisnası | (a) Evet (yalnız `inventory_demo`, `__flowtest__` işaretli); (b) Hayır, temizlik emülatörde | **(a)** — gerçek demo üzerindeki akış testleri çalışmaya devam eder; canlı köke etkisi yok |
| KJ-6 | Inline handler dönüşümü | (a) J2'de yalnız kaçışsız 8 + yeni kod için `data-action` standardı; 92 `jsArg`'li handler Faz 6'da (CSP `unsafe-inline`'ı kaldırmanın önkoşulu); (b) Hepsi J2'de | **(a)** — 92'si bugün güvenli; toplu dönüşüm 10 dosyada regresyon riski, tek kazancı CSP |
| KJ-7 | `auditLogs` create kuralı | (a) Şema doğrulamalı (§4); (b) Yalnız `signedIn()` | **(a)** — talimattaki `signedIn()` korunur, üzerine alan listesi / sunucu zamanı / `uid` eşleşmesi: anonim oturumdan sahte "approved" kaydı veya XSS yükü yazılamaz |

**Sahibinin (insan operatör) işleri:**
1. **TEYİT 0.2c** — J1 bitmeden: Console'da yayındaki kuralları yerel `firestore.rules` ile karşılaştırın; Console'da elle yapılmış bir değişiklik varsa deploy onu ezer.
2. **TEYİT 0.2d** — J5 öncesi: plan (Spark/Blaze) ve Storage durumu (K11).
3. **TEYİT 0.2a** — admin parolası Faz 0'da döndürüldü mü? Deploy günü ≥12 karakterli yeni parolaya geçiş (§8). Parola hiçbir yere yazılmaz (§7.5).
4. KJ-1 onaylanırsa JDK 21 kurulumu (ajan komutu verir; kurulum sizin onayınızla).
5. EmailJS paneli: izinli alan adı, kota/rate limit, şablonda `{{ }}`.

### 7.1 Sahibinin kararları ve teyitleri (30.09.2026)
| # | Sonuç |
|---|---|
| KJ-1…KJ-7 | Tümü **(a)**: Emulator (JDK 21) · `inventory_v2` yalnız admin · admin self-approval parola yeniden doğrulamasıyla · CSP yerelde 0 ihlalden sonra doğrudan · demo `__flowtest__` silme istisnası · J2'de yalnız riskli 8 handler · `auditLogs` şema doğrulamalı |
| TEYİT 0.2a | Faz 0'da admin parolası Console'da yeni kodla (`"0"` + 5 hane) döndürüldü, yerel giriş doğrulandı. ≥12 karaktere geçiş deploy günü (§8 adım 3) |
| TEYİT 0.2c | Console'da yayındaki kurallar yerel `firestore.rules` ile birebir aynı; elle yapılmış değişiklik yok |
| TEYİT 0.2d | Spark planı; **Storage aktif değil** → J5'te `storage.rules` yazılmaz, EBYS-14'ün açık hata politikası geçerli; CSP'den Storage kaynakları J5'teki istek günlüğüne göre çıkarılır |

## 8. Yayın (deploy) runbook'u — Faz 4 sonu, sahibinin onayıyla
> **06.10.2026:** Uygulanabilir ve mühürlü hali → [Faz 4A Deploy Runbook.md](Faz%204A%20Deploy%20Runbook.md) (hazırlık + önizleme provası, snapshot, tek komut deploy, parola, 9 maddelik canlı doğrulama, sıralı geri alma, teyit cümlesi). Aşağıdaki özet onun kaynağıdır.
1. VIP → DB snapshot (`lifeserver_master`).
2. `firebase deploy --only firestore:rules,hosting` (**tek komut**: kurallar ve istemci birlikte — M16). Storage aktif değil (TEYİT 0.2d).
3. **Hemen** Console → Authentication → admin parolası ≥12 karaktere (M17); eski parola reddedilmeli.
4. Canlı doğrulama (5 dk): personel girişi + talep oluştur; admin girişi + onay; kod girmeden konsoldan talep silme denemesi → reddedilmeli; tarayıcı kapat-aç → admin oturumu yok.
5. **Geri alma:** Console → Firestore Rules geçmişinden önceki sürüm + Hosting → Release history → rollback (ikisi birlikte).
6. Bir hafta saha gözlemi → Faz 4B planı.

## 9. Kapsam dışı / bilinçli ertelenenler
- Gerçek WebAuthn kaydı (K2-b) — isteğe bağlı, Faz 4B sonrası.
- 92 `jsArg`'li handler'ın delegation'a dönüşümü ve CSP'den `'unsafe-inline'`'ın kalkması — Faz 6 (KJ-6).
- Giriş kodunu konsola yazan log (SEC-07) — Faz 6 (J3'te dokunulan satırlardaysa orada kaldırılır).
- XOR maskeleme (SEC-06, K3-a) — değişmez; güvenlik aracı sayılmaz.

## Faz 4 kabul (Master Plan + Ek A · Güvenlik)
- [x] `npm run test:rules` yeşil (Ek D Aşama A satırlarının tamamı) — 72/72
- [x] `<img src=x onerror=alert(1)>` içeren talep/görev/satın alma/zimmet/servis/ürün/personel kaydı hiçbir ekranda script çalıştırmıyor; xss-lint 0 — J2
- [x] Anonim oturum talepleri/satın almaları silemiyor; bakımda personel yazamıyor, admin yazabiliyor — J1, J6
- [x] Tarayıcı kapat-aç sonrası admin oturumu yok; vize dolumu Firebase oturumunu kapatıyor — J3
- [x] Self-approval iki sayfada iş kuralında; günlük `auditLogs`'ta, sekme kapanınca kaybolmuyor — J4
- [x] CSP ihlali 0; smoke metrikleri baseline'ı aşmıyor — J5, J6 (akış 41/41 ×2)

---
*Onayınızla J0'dan başlanır. Her tur sonunda walkthrough sunulur; deploy yalnız §8 ve açık onayınızla yapılır.*
