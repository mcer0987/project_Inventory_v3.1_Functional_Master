# Faz 4A · Kapanış Walkthrough (J0 · J1 · J2 · J3 · J4 · J5 · J6) — Yetki ve Güvenlik

> **Tarih:** 06.10.2026 · **Branch:** `feat/phase-4-security-and-rules` (`master`'dan 2e8ae8f; **merge edilmedi, canlıya deploy edilmedi**)
> **Durum:** Faz 4A uygulandı ve otomatik testlerle doğrulandı. **Merge'e hazır** (sahibinin onayıyla, §8). Canlı yayın: [Faz 4A Deploy Runbook.md](Faz%204A%20Deploy%20Runbook.md).
> **Firebase:** Gerçek projede yalnız `inventory_demo` kullanıldı (işaretli test kayıtları, artık 0). Admin oturumu, VIP komutları ve bakım modu yalnız emülatörde. Canlı `lifeserver_master` ve `inventory_v2`'ye dokunulmadı.
> **Ayrıntı:** her turun kendi walkthrough'u (`Faz 4 Tur J0…J5 Walkthrough.md`); güvenlik baseline'ı `audits/test-baselines/faz4-guvenlik-baseline.md`.

## 1. Özet

Faz 4A, uygulamanın güvenlik zeminini istemci kapılarından **sunucu kuralına ve iş mantığına** taşıdı:
- **Kurallar (J1):** Rules v2 Aşama A.
  - Kod girmemiş bir ziyaretçi artık talep, satın alma, zimmet veya servis kaydı silemez.
  - Bakım modunda personel yazamaz (sunucu tarafında).
  - Etiketli metin kural seviyesinde reddedilir.
  - Canlı kök tanınır; `auditLogs` yalnız eklenebilir.
- **XSS (J2):** kayıt verisini kaçışsız basan 135 nokta 0'a indi; bir AST tabanlı kapı (xss-lint) bunu her koşuda denetliyor.
- **Oturum (J3):**
  - Admin oturumu sekmeye bağlı; tarayıcı kapanınca düşüyor.
  - Vize dolumu, kilit, çıkış ve force logout tek bir sonlandırma yolundan geçiyor ve Firebase oturumunu kapatıyor.
  - Depolama bayrağından "sanal Admin" üretimi yok.
  - Parola alanı ≥12 karaktere hazır.
- **Self-approval (J4):**
  - Kontrol iki sayfada da iş mantığının içinde.
  - Admin kendi kaydı için parolasını yeniden girer.
  - Denetim günlüğü veritabanında; admin dahil kimse günlüğü değiştiremez ya da silemez.
  - Biyometrik sahte yedek yol kaldırıldı.
- **Dağıtım (J5):**
  - CSP ve güvenlik başlıkları eklendi; yerelde 0 ihlal.
  - nginx/Docker sertleştirildi; imaj yalnız uygulama dosyalarını içeriyor.
  - CDN sürümleri sabit, SRI'li.
  - `DOCKER_GUIDE.md` yazıldı.
- **Kapanış (J6):**
  - Ek A'nın oturum, bakım ve VIP maddeleri uçtan uca ve gerçek giriş yoluyla sınandı.
  - Deploy'da yayınlanacak dosyalar listelendi; bir log sızıntısı yakalandı ve kapatıldı.
  - Deploy runbook'u mühürlendi.

## 2. Turlar ve commit'ler

| Tur | Kapsam | Commit'ler | Ayrıntı |
|---|---|---|---|
| Plan | Faz 4 uygulama planı, KJ-1…KJ-7, TEYİT 0.2a/c/d | `c89ad3a`, `6ac3d2f` | `Faz 4 Uygulama Planı.md` |
| **J0** | Firestore/Auth emülatörü, kural test matrisi (yayındaki kurallar: 39/65 baseline), `?emu=1` yerel mod, `--emu` | `9afa389`, `3a16ea1`, `6001f77` | `Faz 4 Tur J0 Walkthrough.md` |
| **J1** | Rules v2 Aşama A + istemci hizalaması (M1–M5); testlerin `asAdmin` yardımcısı | `99946ee`, `65b7b31`, `5188ea5` | `Faz 4 Tur J1 Walkthrough.md` |
| **J2** | XSS'in tamamı: sink'ler, 8 riskli handler → `data-*` + `bindActions`, tek güvenli onay API'si, xss-lint kapısı, `audits/` | `bb69930`, `91afaf3`, `7aecb57`, `336d75e` | `Faz 4 Tur J2 Walkthrough.md` |
| **J3** | Tek `endAdminSession`, sekmeye bağlı admin oturumu, sanal Admin'in kaldırılması, admin.html kapısı, depolama bayrakları → `isDbAdmin`, parola geçiş kuralı | `6e51d4d`, `39796c1`, `3ea81c5` | `Faz 4 Tur J3 Walkthrough.md` |
| **J4** | Self-approval iş kuralında (iki sayfa), `auditLogs` + rapor, admin parola yeniden doğrulaması, biyometrik yedek yolun kaldırılması | `680489c`, `3c02c26`, `7b44263` | `Faz 4 Tur J4 Walkthrough.md` |
| **J5** | CSP + başlıklar, nginx/Docker, CDN sabitleme + SRI, `DOCKER_GUIDE.md` | `c22f0a6`, `fdcdf2c`, `b4b3df4` | `Faz 4 Tur J5 Walkthrough.md` |
| **J6** | Hosting ignore'daki log sızıntısı, `j6EkASession`, `j6CdnLibraries`, `hosting-files.js`, runbook, bu belge | `f9c50a0`, `b6178ff`, `c9fc835`, *(bu commit)* | bu belge |

`git diff --stat master..HEAD`: 113 dosya, +17 443 / −1 396. Dağılım:
- uygulama: 27 dosya, +1 120 / −909
- dağıtım ve kural: 15 dosya, +638 / −292
- test ve araç: 8 dosya, +1 629
- kanıt (`scratch/baseline`): 47 dosya, +2 227
- bağımlılıklar: `package-lock.json` +10 353 (firebase-tools, rules-unit-testing, acorn — yalnız devDependencies; imaja ve Hosting'e girmez)
- belgeler ve walkthrough'lar

## 3. Kapatılan bulgular

| Bulgu | Durum | Nasıl | Tur |
|---|---|---|---|
| **RULE-01** Kurallar özellikleri tanımıyor | ✔ Aşama A | Ek D'ye göre koleksiyon × rol kuralları; istemci kapıları aynı matristen | J1 |
| **RULE-02** Kod girmemiş ziyaretçi silebiliyor, kodları okuyabiliyor | ◐ | Silme kapandı (personel yalnız görev). **Kodların okunabilmesi Aşama B'de kapanır** (personel başına hesap — Faz 4B) | J1 → 4B |
| **RULE-04** `system_config` ortamsız | ✔ | `${root}/system_config/items`; kök blok kaldırıldı | Faz 2 + J1 |
| **RULE-05** Bakım modu yalnız istemcide | ✔ | `maintenanceOn()` kuralı; personel yazması sunucuda reddedilir; anlaşılır mesaj (M2) | J1 |
| **SEC-01 / EBYS-03 / ADM-01** Stored XSS | ✔ | Tüm sink'ler kaçışlı (135 → 0); kural etiketi reddeder; tek güvenli onay API'si | J2 |
| **SEC-02** Zayıf admin parolası / hosting sızıntısı | ✔ (arayüz) / ⏳ (parola) | `maxlength=5` kalktı, ≥12 kuralı, geçiş dalı (M11). **Parola deploy günü döner** (runbook Adım 3) | J3 → deploy |
| **SEC-03** nginx/Docker eksikleri | ✔ | `^~` engeller, her location'da başlıklar, `no-cache` + ETag, beyaz liste imaj, `nginx -t` uyarısız | J5 |
| **SEC-05** EmailJS anahtarı | ✔ (kod) / ⏳ (panel) | Kod değişikliği gerekmez (public key). Alan adı kısıtı ve kota sahibinin işi (`DOCKER_GUIDE.md` §3.5) | J5 |
| **AUTH-03** Biyometrik: kayıt yok, atlatılabilir | ✔ | Bayrak kapalı (tek yerde); her 5 karakteri kabul eden yedek yol kaldırıldı. Gerçek WebAuthn (K2-b) bilinçli ertelendi | J4 |
| **AUTH-05** Admin oturumu kalıcı | ✔ | `browserSessionPersistence`; sekme → yerel → IndexedDB açılış sırası (F5 düzeltmesi); J3 öncesinden kalan kalıcı oturum açılışta kapanır | J3 |
| **AUTH-06** Vize/zaman aşımı tutarsız | ✔ | Tek vize biçimi (session-store), yalnız geçerli vize uzar, kilitte uzamaz, tek sonlandırma yolu | J3 |
| **AUTH-07 / AUTH-09** Personel kimliği | ⏳ | Aşama B (Faz 4B) | 4B |
| **AUTH-08** Kilit kartı akışları | ✔ | Kilitte signOut; kilit açılınca senkron sağlığı (M10); "Oturumu Kapat" → index | J3 |
| **EBYS-04** Self-approval koruması | ✔ | İş kuralında, iki sayfada; personel → `blocked`; admin → parola → `approved`/`cancelled` | J4 |
| **EBYS-05** Güvenlik Raporu görünmüyor, günlük sessionStorage'da | ✔ | `${root}/auditLogs`, tek seferlik okuma; düğme oturuma göre, iki sayfada | J4 |
| **ARC-08** Önbellek ESM ile çelişiyor | ✔ | Hosting ve nginx'te JS/CSS/HTML `no-cache` (ETag doğrulamalı) | J5 |
| **ARC-09** Gereksiz yükler | ✔ | Kullanılmayan firebase compat kaldırıldı; sürümler eşitlendi | J5 |
| **OPS-04** Storage | ✔ (karar) | TEYİT 0.2d: Storage yok → kural yazılmadı, CSP'de Storage yok; yükleme açık hata verir (EBYS-14) | J5 |

**Plan tespitleri (T1–T15):**
- T1 (canlı kök), T6 (onayda yetki), T7/T8 (personel yazıcıları), T9/T10 (XSS, onay API'si), T11 (iç içe diziler → istemci kaçışı; belgelendi), T12 (test temizliği, KJ-5), T13 (TEYİT'ler alındı) ve T15 (`sortablejs@latest`) kapandı.
- T2 (kurallar proje geneli) emülatörle yönetildi; T3/T4 J3'te kapandı; T5 J4'te kapandı.
- **T14 ve M16/M17 deploy günü kapanır** (runbook).

## 4. Maskeleme çiftleri (plan §5)

| # | Çift | Durum |
|---|---|---|
| M1 | Personel silme kuralı ↔ fonksiyon içi `isDbAdmin` + anlaşılır mesaj | ✔ J1 |
| M2 | `maintenanceOn` ↔ "Sistem bakımda" mesajı | ✔ J1 |
| M3 | `noTag` ↔ istemci `hasTagLike` ön doğrulaması | ✔ J1 |
| M4 | Anonim silme kapanır ↔ test temizliği (KJ-5) | ✔ J1 |
| M5 | `assignments`/`serviceRecords` personelden çıkar ↔ fonksiyon kapıları | ✔ J1 |
| M6 | Tek onay API'si ↔ TODO "Ata" diyaloğu onarıldı | ✔ J2 |
| M7 | Kaçış ↔ çift kaçış yok | ✔ J2 |
| M8 | Sekmeye bağlı oturum ↔ admin.html'de `isDbAdmin` kapısı | ✔ J3 |
| M9 | Sanal Admin kalktı ↔ bayat oturum signOut | ✔ J3 |
| M10 | Kilitte signOut ↔ kilit açılınca senkron sağlığı, çıkışta yerel kalıcılık | ✔ J3 |
| M11 | `maxlength=5` kalktı ↔ `"0"+kod` geçiş dalı | ✔ J3 (dal, rotasyon teyidinden sonra kapanış hotfix'inde kalkar) |
| M12 | Sarmalayıcılar kalktı ↔ kontrol iş mantığında | ✔ J4 |
| M13 | Biyometrik yedek kalktı ↔ admin parola yeniden doğrulaması | ✔ J4 |
| M14 | `auditLogs` değişmez ↔ saveData/yedek/geri yükleme dokunmaz | ✔ J4 |
| M15 | CSP `connect-src` ↔ kullanılan her kaynak, yerelde 0 ihlal | ✔ J5 |
| M16 | Rules v2 ↔ yeni istemci aynı deploy'da | ⏳ Deploy (runbook Adım 2) |
| M17 | Parola ≥12 ↔ J3 kodu yayında | ⏳ Deploy (runbook Adım 3) |

## 5. Ek A — Regresyon ve güvenlik kabul matrisi

Gösterim:
- ✔ — otomatik, iki ortamda (gerçek `inventory_demo` + emülatör / Rules v2)
- ✔ᴱ — otomatik, yalnız emülatörde (admin oturumu veya VIP komutu gerektirir; kural 7)
- ◐ — otomatik ama kısmi (mantık sınanıyor, ekran etkileşimi elle)
- 👤 — sahibinin elle doğrulaması (§9)

Senaryo adları `scratch/flow-tests.js`'tedir.

**Giriş / Oturum**

| Madde | Durum | Kanıt |
|---|---|---|
| Personel kodla giriş (biyometriksiz / Windows Hello) | ✔ + 👤 | `j6EkASession.login` (gerçek `handleLogin`); biyometrik adım kapalı (`j4.biometric`) → iki cihaz sınıfında aynı kod yolu. Hello'lu bir cihazda bir kez giriş: 👤 |
| Hatalı kod → mesaj, modal kapanmaz | ✔ | `j6PostLogoutRelogin.wrongCodeAfter4s` — **kapanış hotfix'inde bulundu ve düzeltildi**: mesaj sayfa açılışından 4 sn sonra görünmüyordu (§13) |
| Sayfa yenileme (K5); kilitli bulanık ekran yok | ◐ | `j3.noVirtualAdminIndex` (yenilemede giriş ekranı, sanal kimlik yok); bulanıklık 👤 |
| Çıkış → login → tekrar giriş → canlı veri, yazma, **tüm modallar** | ✔ | `j6EkASession.logout/relogin/afterRelogin` (modal açılıyor, yazma `ok`, senkron çalışıyor) |
| 3 dk zaman aşımı → tekrar giriş → modallar | ✔ | `j6EkASession.timeout/timeoutRelogin` (süre kısaltılarak, gerçek zamanlayıcı) |
| Admin girişi, vize, kilit kartı (aç / oturumu kapat → index) | ✔ᴱ | `j3SessionVisa.emu` (login, expiry, unlock, logoutToIndex); "Ana Sayfaya Dön" düğmesi 👤 |
| Admin zaman aşımı → kilit → aç → canlı veri | ✔ᴱ | `j3SessionVisa.emu.liveDataAfterUnlock` |
| Bakım modu: personel kilitlenir, admin kilitlenmez; bakım ekranından admin girişi | ✔ᴱ | `j6EkASession.maintenance` (gerçek kill switch: staffLocked / adminNotLocked / bypassToAdmin / normalAfterOff); sunucu reddi `j1RulesAlignment` + kural matrisi |
| Force logout bir kez; tekrar girebilir; admin kendini hedefleyemez | ✔ᴱ + ✔ | `j6EkASession.forceLogout` (gerçek VIP komutu); alıcı mantığı `tur3AdminPanel` (iki ortam) |
| Yönetici mesajı hedefe bir kez | ✔ᴱ | `j6EkASession.messageShown / messageNotRepeatedAfterReload` |

**Envanter**

| Madde | Durum | Kanıt |
|---|---|---|
| B1/B2 tablo, arama, sıralama, "Daha fazla yükle"; başka cihazdan değişimde sayfa korunur | ◐ + 👤 | Tablo çizimi `j2XssSurfaces`, hedefli yama `stockCore`; sayfa/sıralama korunumu 👤 |
| B1 durum filtresi; stok hareketi "Pasif"i silmez | ◐ | `stockCore` (durum mantığı saf fonksiyon); filtre arayüzü 👤 |
| Mobil (≤768) otomatik kart + toggle; TV (≥2560) | ◐ | `j6EkASession.mobileCards` (390 px'de otomatik kart, iki ortam); toggle ve TV 👤 |
| FAB tekil/çoklu; Bottom Sheet; ESC | 👤 | Faz 4'te değişmedi |
| Ürün ekle / düzenle / sil / toplu pasif / takip | ◐ | `idBasedProductOps`, `itemApi`, `adminBulkOps`; takip `j1RulesAlignment` (admin gerçek, emülatör) |
| Artır/Azalt atomik, eksi stok engeli, manuel durum korunur | ✔ | `stockCore`, `h3Exits` |
| Sevk; servisten dönüş | ✔ | `h3Assignments`, `h4ServiceHistory`, `h4ServicePanel` |
| Envanter çıkışı tekil + sepet; b3 standart şema | ✔ | `h3Exits`, `b3WriteContract`, `hotfixB3Guard` |
| Excel içe/dışa, PDF rapor | ◐ + 👤 | `j6CdnLibraries` (XLSX ve jsPDF/autoTable 3.8.2 iki sayfada bellekte çalışıyor); gerçek dosya 👤 |

**ITSM / Zimmet**

| Madde | Durum | Kanıt |
|---|---|---|
| Talep oluştur (Kalıcı / Geçici + iade tarihi / Sarf); Taleplerim | ✔ | `saveRequest` |
| Geri çek → taslak → düzenle → gönder (personel) | ✔ | `staffRequestActions` |
| Admin onay (SN) / red / sil; taslak onaylanamaz; SN'de İptal; self-approval engeli | ✔ + ✔ᴱ | `adminRequestActions`, `requestApprovalStock`, `j1RulesAlignment`, `j4SelfApproval` (admin parola yolu ✔ᴱ); **toplu sil** 👤 |
| "Teslim Aldım" → tamamlandı, çift kayıt yok | ✔ | `staffRequestActions.receive` |
| Kişi Envanterim: yalnız aktif zimmetler | ✔ | `h4AssignmentService` |
| Admin Zimmet: KPI, filtre, ata, iade, Excel, cihaz geçmişi, PDF | ◐ | `h3Assignments`, `h4DeviceIds`, `h4ServiceHistory`; KPI/Excel/PDF 👤 |

**EBYS / Satın Alma**

| Madde | Durum | Kanıt |
|---|---|---|
| Yeni talep (form reset); görüntüle → kapat → yeni; düzenle → kapat → yeni | ✔ | `ebysApprovalGuard.newModalReset`, `purchaseTypeSelect`, `tur25Revisions` |
| Dosya yükleme (başarısızlıkta sahte ek yok) | ✔ | EBYS-14 senaryosu (`uploadFiles`); Storage kapalı → açık hata |
| Şablon CRUD, yetki filtresi, akış başlat (boş onaylayıcı engeli) | ◐ | `ebysStartStop`, `ebysH2`; şablon CRUD 👤 |
| Onay/red yalnız sırası gelen; admin.html'den de; geri çek / iptal / durdur; geçmiş | ✔ + ✔ᴱ | `ebysApprovalGuard`, `ebysStartStop`, `ebysH2`; admin.html'den onay `j4SelfApproval.adminPage` ✔ᴱ |
| Bana gelen onaylar, servis kayıtları, KPI, admin satın alma butonları, **Güvenlik Raporu** | ◐ + ✔ᴱ | `ebysWorkflowDisplay`, `h4ServicePanel`; Güvenlik Raporu `j4SelfApproval.report` ✔ᴱ; KPI 👤 |

**Admin / VIP**

| Madde | Durum | Kanıt |
|---|---|---|
| Açılışta bekleme yok; KPI ve grafikler canlı; tema; kritik stok | ◐ | Smoke (admin 13/13 koleksiyon, 0 hata); `j6CdnLibraries.admin.charts` = 2; kritik stok `j2XssSurfaces`; tema 👤 |
| Ürün türleri, birimler, mahaller, şablonlar | ✔ / ◐ | `unitManagement`, `purchaseTypeSelect`, `tur3AdminPanel` (mahal); ürün türü modalı 👤 |
| TODO paneli ve Görevlerim | ◐ | `j2XssSurfaces` (TODO "Ata"); panel 👤 |
| VIP: sağlık, log, radar, mesaj, force logout, heatmap, kill switch, temizleyici, ipuçları | ✔ᴱ / ◐ | `tur3AdminPanel` (temizleyici, radar, launchpad), `j6EkASession` (mesaj, force logout, kill switch); heatmap ve ipuçları 👤 |
| Yedek al / yükle (doğru yol, doğru ortam) | ◐ | M14 kısıtı (`j4.static.backupLimitedToCollections`); "1-Tık DB Snapshot" deploy günü canlıda (runbook Adım 1) |
| Sistem ipuçları sekmeye göre | 👤 | Faz 4'te değişmedi |

**Güvenlik**

| Madde | Durum | Kanıt |
|---|---|---|
| `<img src=x onerror=alert(1)>` hiçbir ekranda çalışmıyor | ✔ | `j2XssSurfaces` + `xssAdminPanel` (çalışan yük 0, enjekte `img` 0), xss-lint izinsiz 0, kural `noTag` |
| Anonim oturum talep / satın alma silemiyor | ✔ | `j1RulesAlignment`, kural matrisi 72/72; canlıda runbook 4.5 |
| Tarayıcı kapat-aç → admin oturumu yok | ✔ᴱ + ✔ | `j3SessionVisa.emu.newTabIndex/newTabAdmin/legacyPersistentAdmin`; oturumsuz kapı iki ortamda; canlıda runbook 4.8 |
| *(Faz 4 ek)* Self-approval iki sayfada, günlük kalıcı ve değiştirilemez | ✔ / ✔ᴱ | `j4SelfApproval` (personel engeli iki ortam; admin yolu, kalıcılık, değiştirilemezlik ✔ᴱ), kural matrisi |
| *(Faz 4 ek)* CSP ihlali 0 | ✔ | Akış 41/41 ×2 ve smoke ×2: 0 ihlal, pozitif kontrol ✔; konteyner `docker-check` ✔ |

**Sayım (39 Ek A maddesi + 2 Faz 4 eki = 41):**
- Otomatik, tam: **25** madde — ✔ 19, ✔ᴱ 6 (kapanış hotfix'iyle +1).
- Otomatik ama kısmi: **14** madde (◐).
- Yalnız elle: **2** madde.

Faz 4'ün kodunu değiştirdiği maddeler otomatik ve yeşil. Tek istisna **yedek al / yükle**: J4'te koleksiyon kısıtı (M14) eklendi; bu kısıt yalnız statik olarak denetleniyor. Gerçek yedek, deploy günü canlıda alınıp içeriği doğrulanıyor (runbook Adım 1).

Elle kalanlar Faz 4'te kodu değişmeyen ekran etkileşimleri. Kütüphane sürüm değişikliğinin (J5) etkisi `j6CdnLibraries` ile örtüldü.

## 6. Faz 4 kabul ölçütleri (Uygulama Planı)

| Ölçüt | Sonuç |
|---|---|
| `npm run test:rules` yeşil (Ek D Aşama A satırlarının tamamı) | ✔ **72/72** |
| `<img src=x onerror=…>` içeren talep/görev/satın alma/zimmet/servis/ürün/personel kaydı script çalıştırmıyor; xss-lint 0 | ✔ çalışan yük 0, enjekte `img` 0; **izinsiz 0** (194 sink, 817 ifade; öz-test 17/17) |
| Anonim oturum talepleri/satın almaları silemiyor; bakımda personel yazamıyor, admin yazabiliyor | ✔ kural matrisi + `j1RulesAlignment` + `j6EkASession.maintenance` |
| Tarayıcı kapat-aç sonrası admin oturumu yok; vize dolumu Firebase oturumunu kapatıyor | ✔ᴱ `j3SessionVisa` (`userAuth.isAnonymous === true`) |
| Self-approval iki sayfada iş kuralında; günlük `auditLogs`'ta, sekme kapanınca kaybolmuyor | ✔ `j4SelfApproval` (başka sekmeden okundu) |
| CSP ihlali 0; smoke metrikleri baseline'ı aşmıyor | ✔ 0 ihlal; smoke pageerror 0, **console.error 0** (J4'te 1'di — favicon), "Veri Çekildi" 13/13 |

## 7. Nihai sağlık metrikleri (06.10.2026)

| Ölçüt | Değer | Kanıt |
|---|---|---|
| Kural matrisi (Rules v2 Aşama A) | **72/72** | `npm run test:rules` |
| Yayındaki kurallar, karşılaştırma için | 42/70 (28 açık deploy'da kapanır) | J1 baseline |
| xss-lint izinsiz / gerekçeli / öz-test | **0** / 14 / 17/17 | `audits/test-baselines/xss-lint-latest.json` |
| Akış suite'i — gerçek demo | **41/41**, FAILED 0, pageerror 0, artık 0, **CSP ihlali 0** | `scratch/emu-data/flow-real-final.out` (git dışı) |
| Akış suite'i — emülatör (Rules v2) | **41/41**, FAILED 0, pageerror 0, artık 0, **CSP ihlali 0** | `scratch/emu-data/flow-emu-final.out` (git dışı) |
| Regresyon | J5'in 39 senaryosu iki ortamda birebir aynı çıktı (yalnız süre ölçümleri farklı) | `diff.cjs` |
| Smoke index / admin | pageerror 0, console.error 0, "Veri Çekildi" 13/13; CSP 0 + pozitif kontrol ✔; nginx = firebase.json ✔ | `scratch/baseline/2026-10-06T12-04-41_p4-final`, `…12-05-07_p4-final_emu` |
| Docker (güncel koddan) | `nginx -t` uyarısız; web kökü 47 dosya; `docker-check` ✔ | `…/2026-10-06T12-04-41_p4-final/docker-check.txt` |
| Hosting'e gidecek dosyalar | **47** (Docker ile aynı küme) | `node scratch/hosting-files.js` |

## 8. Merge hazırlığı (sahibinin onayıyla)

- Dal: `feat/phase-4-security-and-rules`, 25 commit (bu kapanış commit'i dahil); `master` (`2e8ae8f`) dalın atası, yani **çakışma yok**.
- Çalışma ağacı temiz; tüm kanıtlar commit'li. Git dışı tek şey, yerel `scratch/emu-data/` (emülatör verisi ve ham çıktılar, `.gitignore`).
- Önceki fazlar gibi `--no-ff`:
  ```bash
  git checkout master
  git merge --no-ff feat/phase-4-security-and-rules -m "feat(phase-4a): security and rules (Rules v2 Aşama A, XSS, session, self-approval + auditLogs, CSP/nginx/Docker)"
  git log --oneline -1
  ```
- Merge sonrası, deploy'dan önce runbook Adım 0 (kapı testleri + `hosting-files.js`) **master üzerinde** tekrar çalıştırılır.
- **Merge deploy demek değildir.** Canlı site ancak runbook Adım 2 ile değişir.

## 9. Sahibinin elle doğrulaması (merge öncesi, localhost veya önizleme kanalı — ~15 dk)

Faz 4'te kodu değişmeyen ama Ek A'da yer alan ekran etkileşimleri. Her biri bir kez:
2. B1'de arama + sıralama + "Daha fazla yükle"; ikinci sekmeden bir ürünün adedini değiştirin → ilk sekmede sayfa ve sıralama korunur.
3. B1 durum filtresi (aktif / hepsi / pasif); kart görünümü düğmesi; FAB ve Bottom Sheet; ESC.
4. Excel dışa aktar + içe aktar; PDF rapor (index ve admin Zimmet sekmesi).
5. Talepler → toplu sil (admin).
6. Admin Zimmet sekmesi KPI'ları; dashboard grafikleri tema değişiminde yeniden çiziliyor.
7. Şablon oluştur / düzenle / sil; ürün türü ekle (modal kapanıyor).
8. TODO paneli ve Görevlerim rozetleri; VIP heatmap; sistem ipuçları aç/kapa; "Ana Sayfaya Dön".
9. Windows Hello'lu bir cihazda personel girişi (biyometrik istenmemeli).

Sorun çıkarsa ajana bildirin; merge ve deploy bekler.

## 10. Davranış değişiklikleri (kullanıcıya görünür, deploy ile)

- **Personel:**
  - Talep ve satın alma kaydını silemez (iptal edebilir); silme yöneticiye aittir.
  - Bakım modunda kayıt yapılamaz ("Sistem bakımda").
  - Etiket içeren metin kaydedilmez ve alan adıyla uyarılır.
  - Kendi kaydını onaylayamaz.
- **Admin:**
  - Oturum sekmeye bağlı: yeni sekme veya tarayıcı kapanışı parola ister; F5 oturumu korur.
  - Kilit kartı nedene göre başlık gösterir ve signOut eder.
  - Parola alanı ≥12 karakter kabul eder; parola deploy günü değişir.
  - Kendi kaydını onaylarken parola istenir.
  - "Güvenlik Raporu" iki sayfada.
- **Herkes:**
  - CSP nedeniyle tarayıcı izinsiz dış kaynağa bağlanmaz.
  - JS/CSS her açılışta doğrulanır, yeni sürüm hemen gelir.
  - J3 öncesinden kalmış kalıcı admin oturumları ilk açılışta kapanır.

## 11. Açık kalanlar ve sonraki adımlar

| Konu | Nerede |
|---|---|
| Deploy (M16, M17, T14) | Runbook — sahibinin onayıyla |
| 5 haneli parola geçiş dalının kaldırılması | ✔ Kapanış hotfix'i (§13) |
| RULE-02 kalanı, AUTH-07/09 (personel başına hesap, kodların okunamaz olması, anonim auth'un kapanması) | **Faz 4B** (J7–J10), deploy + 1 hafta saha gözleminden sonra |
| `'unsafe-inline'` (92 `jsArg`'li satır içi handler) | Faz 6 (KJ-6) |
| SEC-07 (giriş kodunu konsola yazan log) | Faz 6 |
| ADM-05 Özel İzleme panelinin yeniden çizilmemesi (J2'de bulundu) | Faz 5.6 |
| Gerçek WebAuthn (K2-b) | İsteğe bağlı, Faz 4B sonrası |
| Root'suz nginx imajı | İsteğe bağlı (`DOCKER_GUIDE.md`) |
| EmailJS alan adı kısıtı, kota | Sahibi (EmailJS paneli) |

## 12. Süreç notları

- **Emülatör (KJ-1) Faz 4'ün asıl kazancıydı.** Admin oturumu gerektiren her akış ilk kez otomatik sınandı ve kural değişiklikleri canlıya hiç dokunmadan doğrulandı.
- **Testlerin yakaladığı hatalar:**
  - J3: F5'te admin oturumunun düşmesi (Auth kalıcılık sırası).
  - J4: yamalı test kapısıyla oturum döngüsü (test hatası; uygulama değil).
  - J5: CSP altında testin kendi `eval`'i.
  - J6: Hosting ignore'una uymayan emülatör günlüğü (`firestore-debug.log`) — deploy'da herkese açık yayınlanacaktı.
- **Gerçek demo ile emülatör iki farklı soruyu cevaplıyor.** Gerçek demo "yeni istemci eski kurallarla çalışıyor mu" (deploy sırasındaki ara durum); emülatör "yeni istemci yeni kurallarla çalışıyor mu". İkisi de her turda yeşil kaldı.

## 13. Deploy sonrası — Faz 4 kapanış hotfix'i (07.10.2026)

**Deploy (sahibi, 06–07.10.2026):** Runbook Adım 1–4 canlıda uygulandı:
- snapshot alındı;
- 47 dosya + Rules v2 tek komutla yayınlandı;
- admin parolası ≥12 karaktere döndü; eski 5 haneli kod reddediliyor.

Canlı doğrulamanın tüm maddeleri ✔:
- CSP/SRI uyarısı 0;
- personel talebi;
- kodsuz silme `permission-denied`;
- admin onay/silme;
- Güvenlik Raporu;
- tarayıcı kapat-aç.

Hotfix'in test koşusu da gerçek projede Rules v2'yi bağımsız olarak doğruladı:
- eski kök `system_config` okuması → `permission-denied`;
- personelin etiketli yazması → `forbidden`.

**Saha bulgusu:** çıkıştan hemen sonra, F5'siz yeniden giriş takılıyor; F5 düzeltiyor.

**Kök neden.** Emülatörde 700 ms ağ gecikmesiyle yeniden üretildi; düzeltme öncesi kodla kırmızı, sonrası yeşil.
1. **Görünmeyen mesaj.** `#loginStatus` sayfa açılışından 4 sn sonra `display:none` yapılıyor ve bir daha görünür yapılmıyordu. Bu yüzden şu mesajlar **görünmez kutuya** yazılıyordu: çıkış sonrası "Veriler henüz hazır değil" ve her durumda "❌ Hatalı Giriş Kodu!". Kullanıcı "Giriş"e basıp hiçbir şey görmüyordu. Ek A'da elle doğrulamaya bırakılan "hatalı kod mesajı görünür" maddesi de aslında bozukmuş.
2. **Bekleme yerine ret.** Çıkışın başlattığı anonim oturum + veri yenilemesi canlıda birkaç saniye sürüyor; bu süre dolmadan gelen giriş reddediliyordu.
3. **Teorik yarış (önleyici).** Admin girişi, yoldaki anonim oturumla aynı anda kalıcılık/oturum değiştirebiliyordu.

**Düzeltme:**
- `auth-engine.js`:
  - giriş mesajları her zaman görünür (`setLoginStatus`);
  - personel ve admin girişi, oturum ve personel listesi hazır olana kadar "⏳ Oturum hazırlanıyor" diyerek **bekleyip kendiliğinden devam eder** (en fazla 15 sn, sonra açık hata);
  - çift tıklama tek giriş sayılır.
- `security.js`: `authenticate`, yoldaki anonim oturum yerleşmeden kalıcılık değiştirmez (`waitForAuthSettled`). Kilit açma ve bakım ekranından giriş de bu yoldan geçer.
- `firebase-handler.js`: "Sistem Hazır" yalnız ilk yüklemede gösterilir ve bir giriş mesajının üstüne yazılmaz.
- `main.js`: çıkışta mesaj durumu sıfırlanır.

**5 haneli geçiş dalı (M11) kaldırıldı:**
- Yalnız ≥12 karakter kabul ediliyor.
- Daha kısa her giriş ağa gitmeden "Yönetici parolası en az 12 karakter olmalıdır" ile reddediliyor; eski kodu deneyen yönetici nedenini görür.
- Emülatördeki sahte admin hesabı da ≥12 karaktere taşındı (`emu-yonetici-0001`, yalnız emülatör).

**Test ve kanıt:**
- **Yeni senaryo `j6PostLogoutRelogin`** (yavaş ağ, tek tıklama):
  - Düzeltme öncesi kod: mesaj görünmüyor, personel 0 ms'de reddediliyor, çift tıklama iki kez giriş yapıyor.
  - Düzeltme sonrası:
    - personel ~3,2 sn bekleyip kendiliğinden giriyor;
    - üç admin yolu tek tıklamayla admin oluyor: "Oturumu Kapat" → index, kilit → hemen aç, index'te çıkış;
    - 4 sn sonrası hatalı kod mesajı görünüyor;
    - eski 5 haneli kod reddediliyor.
- **Test ortamı varsayımı güncellendi.** Gerçek demo artık yayındaki Rules v2'ye karşı koşuyor; yardımcılar canlı kuralları yokluyor (`ft.rulesV2`). `xssAdminPanel` gerçek demoda yükün kural tarafından reddedildiğini doğruluyor: yükü yazacak admin oturumu yok; kaçışlı çizim `j2XssSurfaces` ile iki ortamda sınanıyor.
- **Sonuçlar:**

  | Kontrol | Sonuç |
  |---|---|
  | Akış suite'i | **42/42** gerçek demoda, **42/42** emülatörde; FAILED 0, pageerror 0, artık 0, CSP ihlali 0 |
  | Kural matrisi | 72/72 |
  | xss-lint | izinsiz 0 (öz-test 17/17) |
  | Smoke (iki ortam) | pageerror 0, console.error 0, CSP pozitif kontrol ✔ |
  | Hosting | 47 dosya |

- **Regresyon:** önceki 40 senaryonun çıktısı birebir aynı. Farklar yalnız beklenenler: parola kuralı tablosu ve gerçek demoda canlı Rules v2'nin görünmesi.

**Öneri (uygulanmadı):** index'teki ortak giriş alanı, personel kodu için yapıştırmayı engelliyor. Bu yüzden ≥12 karakterli rastgele yönetici parolası parola yöneticisinden yapıştırılamıyor, yalnız elle yazılabiliyor. Kilit kartında yapıştırma açık. Index alanında da açılması istenirse tek satırlık bir değişiklik.
