# Faz 4 · Tur J3 Walkthrough (Oturum, vize ve admin güvenliği — 4.4)

> **Tarih:** 05.10.2026 · **Branch:** `feat/phase-4-security-and-rules` (merge edilmedi, **canlıya deploy edilmedi**)
> **Firebase:** gerçek projede yalnız `inventory_demo` okundu/yazıldı (işaretli test kayıtları, artık 0) ve demo kopyası emülatöre çekildi. Admin oturumu gerektiren her adım emülatörde, sahte `emu01` hesabıyla. Canlı `lifeserver_master` ve `inventory_v2`'ye dokunulmadı.
> **Durum (§7.2):** Uygulandı + otomatik testlerle doğrulandı.
> **Bulgular:** AUTH-05, AUTH-06, SEC-02 (arayüz) · T3, T4 · maskeleme çiftleri M8, M9, M10, M11.

## Commit'ler
| Hash | Özet |
|---|---|
| `6e51d4d` | **fix(auth)** — tek `endAdminSession`, sekmeye bağlı admin oturumu, sanal "Admin"in kaldırılması, admin.html kapısı, depolama bayrakları → `isDbAdmin`, parola geçiş kuralı |
| `39796c1` | **chore(test)** — `j3SessionVisa` akış senaryosu |
| *(bu commit)* | Walkthrough + smoke kanıtları + `audits/` baseline güncellemesi |

`git diff --stat 336d75e..39796c1`: 12 dosya, +574 / −272 — `security.js` 125 · `timer.js` 123 (−dead UI kodu) · `firebase-handler.js` 105 · `admin.html` 99 · `auth-engine.js` 98 · `session-store.js` 42 · `alert.js` 15 · `script.js` 9 · `index.html` 8 · `admin-dashboard.js` 6 · `ui-components.js` 4; araç: `flow-tests.js` +212.

## 1 — Tek sonlandırma yolu: `SecurityConfig.endAdminSession(reason)`
Zincir: zamanlayıcılar → `clearSession()` → `await signOut` (yerel kalıcılığa dönerek) → `onAppLogout` → sayfaya göre arayüz (admin.html: kilit kartı, `'logout'` ise `index.html`; index: `main.js` giriş ekranını açar). Eşzamanlı çağrılar aynı işi bekler (aralık kontrolü ve zamanlayıcı aynı anda tetiklenebiliyor).

| Yol | Önce | Şimdi |
|---|---|---|
| admin.html aralık kontrolü (vize doldu) | Yalnız kilit kartı; admin token'ı kartın arkasında geçerli | `endAdminSession('expired')`; vize silinmişse de (başka sekmeden çıkış) kilitler |
| `checkAdminAuth` (açılışta dolmuş vize) | `admin_auth` silinip index'e; Firebase oturumu yaşıyordu | `endAdminSession('expired')` → kilit kartı |
| "Güvenli Çıkış" (`adminLogout`) | Yalnız `admin_auth` silinip kart açılıyordu | `endAdminSession('lock')` → "Oturum Kilitlendi" |
| Kilit kartı "Oturumu Kapat" | Kendi `clearSession` + `logout` kopyası | `endAdminSession('logout')` → index |
| `timer.js` zaman aşımı (admin.html) | `signOut` beklenmeden kart | `await endSession(...)` → aynı zincir |
| index çıkışı (`handleLogout`) ve force logout | Ayrı kopya zincir | Aynı zincir; force logout yedeği de |

Kilit kartı neden metni taşır: "Oturum Süresi Doldu" / "Oturum Kilitlendi" / "Yönetici Girişi Gerekli" / "Oturum Sona Erdi". Hatalı parola artık `alert()` yerine kartın içinde gösteriliyor.

## 2 — Kalıcılık (AUTH-05)
- `authenticate`: `setPersistence(browserSessionPersistence)` → `signInWithEmailAndPassword`. Başarısız denemede anonim oturum yerel kalıcılığa geri alınır.
- Çıkış: önce `signOut`, sonra `browserLocalPersistence`. Sıra bilinçli: `setPersistence` mevcut kullanıcıyı taşır; admin oturumu bir an bile localStorage'a (öteki sekmelerin gördüğü yere) yazılmasın.
- Anonim oturum her açılışta (`signInAnonymously` öncesi) yerel kalıcılıkta açılır → personel davranışı değişmez.
- **Testin yakaladığı hata ve düzeltmesi:** varsayılan `getAuth` açılışta önce IndexedDB'ye bakıyor. Başka bir sekmenin anonim oturumu orada olunca aynı sekmedeki admin oturumu F5'te yok sayılıp **siliniyordu** (ilk koşuda `reloadSameTab.isDbAdmin=false`). Auth artık `initializeAuth(app, { persistence: [session, local, indexedDB] })` ile açılıyor. J3 öncesi istemcilerin IndexedDB'de bıraktığı oturumlar da okunuyor (bayat sayılıp kapatılmaları için, bkz. §3).

## 3 — Sanal "Admin"in kaldırılması (M9) ve admin.html kapısı (M8)
- `checkAuth`: `isDbAdmin → setActiveUser({name:'Admin'})` + `adminVizesi` yazımı ve DOMContentLoaded'daki depolama bayrağından "Admin" çizimi kaldırıldı. Admin oturumu yalnız **geçerli vize + parola sonrası atanmış kimlikle** geçerli. Biri eksikse `endAdminSession('stale')` Firebase oturumunu da kapatıyor (M9). Giriş sürerken (`onAuthStateChanged` vize yazılmadan önce tetikleniyor) karar `SecurityConfig.isSignInPending()` ile erteleniyor.
- Parola **girildikten sonra** kimlik atayan yollar (index girişi, kilit açma, bakım girişi) tek yardımcıyı kullanıyor: `resolveAdminIdentity()`. Önce personeldeki yönetici kaydı, yoksa **"Yönetici"** etiketi. Navbar'daki "Panele Geç" düğmesi Firebase admin oturumunda da görünüyor (yalnız ada bakmıyor).
- `checkAdminAuth` (M8): vize yoksa index. Vize dolmuşsa `expired`. Geçerli vize varsa oturum hazır olunca:
  - Firebase admin değilse kilit kartı. Paylaşılan vize **silinmez**, çünkü öteki sekmedeki gerçek admin onu kullanıyor.
  - Admin ama kimlik/vize eksikse `stale`.

## 4 — Tek vize ve kilitte veri akışı (T4, M10)
- Vize biçimi (`admin_auth`) yalnız `session-store.js`'te: `getAdminVisaRemaining / hasValidAdminVisa / grantAdminVisa / extendAdminVisa / clearAdminVisa`. Vizeyi tek yer yazar, `authenticate` (oturumla aynı anda). Kopyalar kaldırıldı: `auth-engine`, `admin.html`, `alert.js` ve ölü `loginAsAdmin`. Süre tek: `ADMIN_SESSION_MS` (10 dk).
- `timer.js`: yalnız **geçerli** vize etkinlikle uzar, dolmuş vize `endAdminSession('expired')` çağırır. Kilit kartı açıkken etkinlik ne vizeyi uzatır ne zamanlayıcı kurar.
- M10:
  - Senkron hangi oturum için başlatıldıysa (`_syncUid`) ona bağlı. Çıkış/kilit sonrası gelen **yeni anonim** oturum, ölmüş senkronu devralmaz, yeniden başlatır.
  - `onAppLogout` yeni anonim oturumla zaten çalışan senkronu durdurmaz.
  - Kilit açılınca `ensureRealtimeSync()` çağrılır: senkron durmuşsa ya da reddedilmiş dinleyici varsa yeniden başlatır, sağlıklıysa dokunmaz.
  - Gerekçe: anonim → admin geçişinde Firestore aynı dinleyicileri yeni kimlikle sürdürüyor. Her kilit döngüsünde tüm koleksiyonları ikinci kez okumak Spark kotasına yük.

## 5 — Depolama bayrakları → `isDbAdmin`
`script.js` sepet araması (demirbaş), `ui-components.js` çıkış modalı demirbaş muhafızı, `firebase-handler.js` bakım muafiyeti (artık `admin_auth` süresine değil Firebase admin oturumuna bağlı, kuralla aynı). `edm-workflow.js` şablon kaydı J1'de bağlanmıştı. Uygulama kodunda `adminVizesi` okuması kalmadı. Yalnız eski istemcilerden kalan anahtarı silen iki satır duruyor.

## 6 — Parola alanları ve geçiş kuralı (M11 · SEC-02 arayüz)
- `index.html` giriş alanı ve bakım alanında `maxlength="5"` kalktı. "5 haneli kodu giriniz" → "personel kodunuzu ya da yönetici parolasını giriniz". Kilit alanı "Yönetici parolası".
- `SecurityConfig.normalizeAdminPassword`: 5 karakter → eski `"0"+kod` (bugünkü canlı parola çalışmaya devam eder) · ≥12 → olduğu gibi · 6-11 → ağa gitmeden "Yönetici parolası en az 12 karakter olmalıdır." · diğerleri → hatalı parola.
- Yapıştırma (parola yöneticisi) yalnız admin kilit alanında açık (`_dx._s(id, { allowPaste: true })`). Personel kodu alanında eski davranış kalıyor.
- Eski dal, sahibinin rotasyon teyidinden sonra Faz 4 kapanış hotfix'inde kaldırılır (plan §3 J3.7). **Parola deploy günü döndürülür** (T14).

## Kanıt
| Kontrol | Sonuç |
|---|---|
| Akış suite'i — emülatör (Rules v2) | **38/38**, `FAILED` yok, pageerror 0, artık 0. J2'nin 37 senaryosunun çıktısı birebir aynı (yalnız süre ölçümleri farklı) |
| Akış suite'i — gerçek demo | **38/38**, `FAILED` yok, pageerror 0, artık 0. 37 senaryo J2 ile birebir aynı |
| `j3SessionVisa` — iki ortam | Statik: `maxlength` yok, "5 haneli" yok, `adminVizesi` okuması yok, sanal "Admin" yok, `loginAsAdmin` yok ✔. Birim: kural tablosu, 6-11 karakter ağa gitmeden ret (oturum ve vize değişmedi), dolmuş vize uzamıyor, zamanlayıcı → `expired`, `logout('force_logout')` → `endAdminSession` ✔. Bayrak + vize varken sanal "Admin" yok ✔. admin.html oturumsuz → "Yönetici Girişi Gerekli", vize korunuyor ✔. Dolmuş vizeyle açılış → kilit, vize silindi ✔ |
| `j3SessionVisa` — yalnız emülatör | Ayrıntı aşağıda |
| Smoke | Emülatör `scratch/baseline/2026-10-05T08-22-34_p4-j3_emu`, gerçek `…/2026-10-05T08-23-05_p4-j3`. pageerror 0, "Veri Çekildi" 13/13, çift yükleme yok, tek console.error bilinen favicon 404. Admin ekran görüntüsü artık kilit kartı gösteriyor (smoke'ta admin oturumu yok; M8'in görsel kanıtı) |
| xss-lint | İzinsiz **0**, 14 gerekçeli istisna. Sink 194 → 192 (timer.js'teki ölü arayüz kodu silindi) |
| Kural matrisi | **70/70** (kurallar değişmedi) |

`j3SessionVisa` emülatör adımları:
1. "Yönetici Paneli" → admin.html: admin, oturum `sessionStorage`'da, localStorage'da yok.
2. Aynı profilde yeni sekme (tarayıcı kapat-aç eşdeğeri): index anonim ve giriş ister; admin.html "Yönetici Girişi Gerekli". İlk sekme admin kalıyor.
3. Aynı sekmede F5: admin korunuyor.
4. Vize dolumu: kilit kartı ve `userAuth.isAnonymous === true`. Kilitliyken fare/klavye vizeyi canlandırmıyor.
5. Kilit açma:
   - 6-11 karakter reddediliyor.
   - `emu01` ile açılıyor; senkron `running`, `denied` boş.
   - Admin'in b1'e yazdığı kayıt dinleyiciye ulaşıyor ve siliniyor.
6. Parola geçici olarak ≥12 karaktere döndürülüyor. "Güvenli Çıkış" → signOut + "Oturum Kilitlendi". Eski kod reddediliyor, uzun parola ile açılıyor. Parola geri alınıyor (`restored`).
7. F5 + dolmuş vize, admin token'ı canlıyken: signOut + kilit.
8. "Oturumu Kapat" → index: anonim, kimlik ve vize yok, anonim oturum yerel kalıcılıkta.
9. J3 öncesi istemcinin kalıcı IndexedDB admin oturumu: açılışta bayat sayılıyor → anonim, navbar yok, giriş ekranı.

## Bilinen / sonraki
- **Aynı tarayıcıda ikinci sekme:** admin girişi ya da çıkışı, öteki sekmelerin anonim oturumunu yeniler. Firebase `setPersistence` mevcut kullanıcıyı taşıyor. O sekmede açık personel oturumu varsa giriş ekranına düşer. J3 öncesinde durum daha ağırdı: o sekmeler admin oturumunu devralıyordu.
- **Vize tarayıcı genelinde** (`localStorage`). Bir sekmedeki çıkış (`clearSession`), öteki admin sekmesini de kilitler. Güvenli yön; bilinçli bırakıldı.
- **Kilit kartının arkası:** bulanık panelde anonim oturumun okuyabildiği veri akmaya devam ediyor (Rules v2 Aşama A'da personel de okuyabiliyor). Etkileşim kapalı.
- `admin-system-control.js` VIP oturum widget'ı `admin_auth`'u yalnız geri sayım ve güvenlik çubuğu **gösterimi** için okuyor; yetki kararı değil. Dosyada önceden var olan çift kodlanmış (mojibake) yorumlar nedeniyle bu turda dokunulmadı.
- Kalan isim tabanlı kapılar J4'te: self-approval "Güvenlik Raporu", navbar düğmesinin ad kısmı.
- **J4:** self-approval iş kuralı (`confirmRequest`/`approveStep`), `auditLogs`, biyometrik yedek yolunun kapatılması (M12, M13, M14).

## Sahibinin elle doğrulaması (localhost, önerilen)
1. `npm run emu` + `npm run emu:seed` → `http://127.0.0.1:<port>/index.html?emu=1` → `emu01` ile "Yönetici Paneli". Panel açılır, F5'te açık kalır.
2. Tarayıcıyı tamamen kapatıp açın → `admin.html?emu=1` "Yönetici Girişi Gerekli" kartını gösterir, index personel girişi ister.
3. Panelde "Güvenli Çıkış" → kart. Konsolda `window.userAuth.isAnonymous` → `true`. `emu01` ile açın → veriler canlı akmaya devam eder.
4. Kilit kartına 8 karakter yazın → "en az 12 karakter" uyarısı, ağ isteği yok.
5. Gerçek demoda (emülatörsüz) bugünkü 5 haneli yönetici kodu aynen çalışmalı (geçiş dalı).
