# Faz 4 · Tur J4 Walkthrough (Self-approval iş kuralı, denetim günlüğü, biyometrik — 4.7 + 4.5)

> **Tarih:** 05.10.2026 · **Branch:** `feat/phase-4-security-and-rules` (merge edilmedi, **canlıya deploy edilmedi**)
> **Firebase:** gerçek projede yalnız `inventory_demo` kullanıldı (işaretli test kayıtları, artık 0). Denetim günlüğüne gerçek projede **hiç yazılmadı**: günlük kalıcı ve kural gereği silinemez. Günlük yazma, admin parola doğrulaması ve geri okuma emülatörde, sahte `emu01` hesabıyla yapıldı. Canlı `lifeserver_master` ve `inventory_v2`'ye dokunulmadı.
> **Durum (§7.2):** Uygulandı + otomatik testlerle doğrulandı.
> **Bulgular:** EBYS-04, EBYS-05, AUTH-03 · T6 · KJ-3, KJ-7 · maskeleme çiftleri M12, M13, M14.

## Commit'ler
| Hash | Özet |
|---|---|
| `680489c` | **fix(ebys)** — self-approval iş kuralında (iki sayfa), `auditLogs`, rapor ekranı, biyometrik yedek yolunun kaldırılması |
| `3c02c26` | **chore(test)** — `j4SelfApproval` senaryosu, rapor sorgusu kural testleri, gerçek demoda günlük yazımının bellekte toplanması |
| *(bu commit)* | Walkthrough + smoke kanıtları + `audits/` baseline + plan notu (4.5) |

`git diff --stat 3ea81c5..3c02c26`: 14 dosya, +569 / −418. Uygulama:
- `self-approval-reporter.js` 424 (−monkey-patch + sessionStorage günlüğü)
- `security.js` +112
- `security-biometrics.js` −110 (sahte yedek yol)
- `firebase-handler.js` +53
- `schema.js` +24
- `script.js` +13
- `admin-backup.js` 12
- `edm-workflow.js` +10
- `session-store.js` 8
- `admin.html` +5
- `auth-engine.js` 4
- `admin-main.js` +1

Araçlar: `flow-tests.js` +205 · `rules.test.mjs` +6.

## 1 — Self-approval iş mantığında (EBYS-04, T6, M12)
- **Tek politika:** `Schema.isSelfApproval({ actor, record, kind })`.
  - Talep: `personelId` → eski kod → Türkçe güvenli ad. İki tarafta da id varsa ad benzerliği karar vermez.
  - Satın alma: açanın kodu (`createdBy`) ya da adı (`createdByName` / `talepEden` / şablondan açılanlarda `createdBy`).
- **Uygulama noktası (iki sayfada):** `confirmRequest` (script.js) ve `approveStep` (edm-workflow.js), yetki kontrolünden sonra `SecurityConfig.guardSelfApproval`'ı çağırır:
  - **Personel** kendi kaydını onaylamaya çalışırsa işlem durur, `blocked` yazılır. Talepte onay penceresi hiç açılmaz.
  - **Admin** kendi kaydında parolasını yeniden girer (KJ-3, `reauthenticateWithCredential`, 3 deneme).
    - Vazgeçerse ya da 3 deneme başarısız olursa `cancelled` yazılır.
    - `approved` yalnız **kayıt başarılı olduktan sonra** yazılır; kayıt başarısızsa `cancelled` ("parola doğrulandı ama kayıt başarısız").
  - Talepte parola sorusu, stok/kimlik seçiminden sonra ve yazmadan hemen önce gelir. Günlükteki "approved" böylece gerçek bir onaya karşılık gelir.
- **T6:** `confirmRequest` artık kendi içinde yönetici kapılı (`requireDbAdmin('Talep onayı')`). Bugüne kadar yalnız düğme admin'e görünüyordu.
- **M12:** `self-approval-reporter.js`'teki `window.confirmRequest` / `window.approveStep` sarmalayıcıları kaldırıldı. Bunlar yalnız index'te ve yalnız window üzerinden yapılan çağrıda çalışıyordu; admin.html'de hiç yoktu. Modül artık yalnız rapor arayüzü.

## 2 — Denetim günlüğü (KJ-7, M14)
- `firebase-handler.js` → `appendAuditLog(entry)`: yalnız `setDoc` ile yeni id (`al_…`), yani yalnız ekleme.
  - Alanlar kuraldaki listeyle birebir: `{id, type, refCol, refId, item, qty, actorName, actorPersonelId, uid, authKind, result, reason, page, ts: serverTimestamp()}`.
  - `uid` ve `authKind` oturumdan gelir (`anonymous` / `admin`), `page` sayfadan (`index` / `admin`).
  - Metinlerde "<" yerine "‹" yazılır: kural etiketli metni reddediyor, kayıt bu yüzden düşmesin.
- **Kota ve yetki:** `COLLECTIONS`'a eklenmedi. Sürekli dinleyici yok; personel okuyamadığı için izin hatası da yok.
- **M14:**
  - `saveData` yalnız COLLECTIONS'ı yazdığı için günlüğe dokunamıyor (testle doğrulandı).
  - Yedek al / içe aktar / geri yükle artık yalnız COLLECTIONS anahtarlarını kapsıyor. Elle eklenmiş bir `auditLogs` dizisi geri yüklemede yazılmaz.
  - `clearSession` günlük anahtarına dokunmuyor; eski sessionStorage anahtarı kullanılmıyor.

## 3 — Rapor ekranı (EBYS-05)
- "Güvenlik Raporu" açılışta `fetchAuditLogs(200)` ile tek seferlik okur (`orderBy ts desc, limit 200`).
- Sütunlar: tarih, işlem, kayıt ve adet, kullanıcı (oturum türü · sayfa), sonuç rozeti (Engellendi / Onaylandı (parola doğrulandı) / Vazgeçildi) + neden. Bütün alanlar kaçırılıyor.
- **Düğme:**
  - index navbar'ında ada göre değil Firebase admin oturumuna göre çıkıyor. Eskiden "Muhammed Cer" adlı personel görüyor, "Yönetici" kimlikli admin göremiyordu.
  - admin.html üst çubuğunda kalkan simgesiyle sabit (modül `admin-main.js` ile iki sayfada yüklü).
  - Rapor admin oturumu olmadan açılmıyor; kural da yalnız admin'e okuma veriyor.
- Kural matrisine rapor sorgusu eklendi: admin çalıştırır ✔, anonim çalıştıramaz ✖ → **72/72**.

## 4 — Biyometrik (4.5 · AUTH-03, M13)
- `ENABLE_BIOMETRIC_LOGIN=false` artık tek yerde, Session Store'da; `auth-engine` buradan okuyor.
- `verifyBiometrics` bayrak kapalıyken her zaman `false` döner. Açık olsa bile yedek yolu yok: donanım yoksa, hata ya da iptal durumunda `false`.
- Kaldırılanlar:
  - `_fallbackChallenge`: her 5 karakterlik girdiyi kabul eden `prompt`.
  - `generateBiometricChallenge`.
  - `authenticateWith2FA`: 5 karakter karşılaştırıp aynı yedek yola düşüyordu; çağıranı yoktu.
- Plan notu eklendi: gerçek WebAuthn kaydı (K2-b) yapılmadı. Sunucusuz mimaride sonuç istemcide değerlendirildiği için yalnız bir UX kapısı olurdu.

## Kanıt
| Kontrol | Sonuç |
|---|---|
| Akış suite'i — emülatör (Rules v2) | **39/39**, `FAILED` yok, pageerror 0, artık 0. J3'ün 38 senaryosunun çıktısı **birebir aynı**, uyarlanan ikisi dahil (yalnız süre ölçümleri farklı) |
| Akış suite'i — gerçek demo | **39/39**, `FAILED` yok, pageerror 0, artık 0. 38 senaryo J3 ile birebir aynı. Günlük çağrıları bellekte, gerçek projeye yazılan günlük kaydı 0 |
| `j4SelfApproval` — iki ortam | Statik: sarmalayıcı yok, sessionStorage günlüğü yok, yedek prompt yok, kontrol iki fonksiyonda, yedek COLLECTIONS'la sınırlı, rapor admin.html'de yüklü ✔<br>Personel: kendi satın alma adımı → yazma 0, adım bekliyor, `blocked` ✔ · kendi talebi → pencere açılmadı, `blocked` ✔ · başkasının talebi → yönetici kapısı, günlük yok ✔<br>Biyometrik `false`, prompt 0 ✔ · "Muhammed Cer" adlı personelde rapor düğmesi yok, rapor reddedildi ✔ |
| `j4SelfApproval` — yalnız emülatör | Ayrıntı aşağıda |
| Kural matrisi | **72/72** |
| xss-lint | İzinsiz **0**, 14 gerekçeli istisna (194 sink; rapor rozeti sınıfı da kaçırıldı) |
| Smoke | Emülatör `scratch/baseline/2026-10-05T11-36-16_p4-j4_emu`, gerçek `…/2026-10-05T11-36-42_p4-j4`: pageerror 0, "Veri Çekildi" 13/13, tek console.error bilinen favicon 404 |

`j4SelfApproval` emülatör adımları:
1. index, admin kendi talebi:
   - Yanlış 12+ karakterli parola ağda reddedildi ("2 deneme hakkı kaldı"). Vazgeç → yazma 0, `cancelled`.
   - Doğru parola → onay yazıldı, `approved`.
2. admin.html'de ayrı sekmede gerçek giriş yolu: kendi satın alma adımı parola ile onaylandı → `approved`.
3. Uygulamadan günlüğü güncelleme ve silme denemesi (admin dahil): iki kez `permission-denied`.
4. Etiketli metin günlüğe düştü ("‹img…"). Raporda enjekte `img` 0.
5. admin.html'de açılan rapor bu koşunun 6 kaydını üç rozetle gösterdi:
   - `blocked` ×2 (index, anonim)
   - `cancelled` ×2
   - `approved` ×2 (index ve admin.html)
   - 14 alanın hepsi mevcut, `ts` sunucu zamanı.

## Test sırasında yakalanan tuzak (uygulama değil, test)
`confirmRequest` artık yönetici kapılı olduğu için iki eski senaryoda yönetici adımları `isDbAdmin` yamasıyla koşuyor. İlk denemede yama açıkken `ft.asAdmin()` gerçek giriş/çıkış yaptı:
1. Çıkışta gelen anonim oturum `checkAuth`'ta yamalı `isDbAdmin()=true` ile "bayat admin" sayıldı (J3 · M9).
2. Oturum kapatılıp yeniden açıldı ve bu bir döngüye dönüştü. Suite oturumsuz kaldı, emülatörü de yordu.

Düzeltme: yama `asAdmin`'den önce kaldırılıyor; nedeni commit'te ve test yorumunda yazılı. Gerçek kullanımda `isDbAdmin` gerçek oturumdan okunduğu için bu durum oluşmaz.

## Bilinen / sonraki
- Günlük, onay yazması başarılı olduktan sonra ayrı bir yazma olarak düşüyor. Aynı transaction'da değil, çünkü `auditLogs` COLLECTIONS dışında. Günlük yazılamazsa admin "Onay verildi ancak denetim günlüğüne yazılamadı" uyarısı görüyor.
- Personel engeli personelin kendi anonim oturumuyla yazılıyor. Kural `uid == request.auth.uid` ve sunucu zamanı istediği için sahte "approved" kaydı ya da başkası adına kayıt yazılamıyor. Personel yine de kendi adına **ek** `blocked` / `cancelled` kaydı ekleyebilir (Aşama A sınırı; Faz 4B'de personel başına hesapla daralır).
- Admin parola sorusu tarayıcının parola yöneticisi tarafından doldurulabilir (`type=password`, `autocomplete=current-password`). Bu bilinçli bir tercih; yeniden doğrulama "oturumu açık bırakılmış cihaz"a karşı koruma sağlıyor.
- **J5:** dağıtım sertleştirme (CSP, başlıklar, nginx/Docker, CDN sabitleme, EmailJS, Storage).

## Sahibinin elle doğrulaması (localhost, önerilen)
1. `npm run emu` + `npm run emu:seed` → `index.html?emu=1` → `emu01` ile admin.
2. "Güvenlik Raporu" düğmesi index navbar'ında ve admin.html üst çubuğunda görünür.
3. Personel olarak (kodla giriş) kendi açtığınız satın alma talebinde onay adımı sizdeyse "Onayla" → "Kendi kaydınızı onaylayamazsınız".
4. Admin olarak raporu açın → kayıt "Engellendi" rozetiyle görünür. Sekmeyi/tarayıcıyı kapatıp açın: kayıt duruyor.
5. Admin kimliğinizle açılmış bir talebi onaylayın → parola sorulur. Vazgeç → "Vazgeçildi"; doğru parola → "Onaylandı (parola doğrulandı)".
