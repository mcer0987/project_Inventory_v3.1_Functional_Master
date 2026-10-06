# Faz 4 · Tur J0 Walkthrough (doğrulama altyapısı: Emulator, kural testleri, emülatör modu)

> **Tarih:** 01.10.2026 · **Branch:** `feat/phase-4-security-and-rules` (master `2e8ae8f`'den; merge edilmedi, **canlıya deploy edilmedi**)
> **Firebase:** gerçek projede yalnız `inventory_demo` okundu/test edildi; canlı `lifeserver_master`'a ve `inventory_v2`'ye dokunulmadı · kurallar **yayınlanmadı** (yalnız emülatörde)
> **Durum (§7.2):** Uygulandı + otomatik testlerle doğrulandı. Kod davranışı değişmedi (emülatör modu yalnız `localhost` + `?emu=1`).

## Kararlar (sahibi, 30.09.2026)
KJ-1 (a): Firestore/Auth Emulator; JDK 21 (Temurin 21.0.12) sahibi tarafından kuruldu. H1 karar 5 ("Emulator yok") Faz 4 için güncellendi.

## Commit'ler
| Hash | Özet |
|---|---|
| `6ac3d2f` | Faz 4 Uygulama Planı + sahibinin kararları (KJ-1…7) ve TEYİT 0.2a/0.2c/0.2d |
| `9afa389` | Emülatör ve kural testi araçları: devDependencies (`firebase-tools` 15.32, `@firebase/rules-unit-testing` 5, `firebase` 12), `firebase.json` emülatör bölümü (`tests/**` hosting dışı), npm betikleri, kural test matrisi, tohum betiği |
| `3a16ea1` | Uygulamanın emülatör modu (`firebase-handler.js`) + smoke/flow `--emu` + emülatöre özel admin girişi + `j0Emulator` senaryosu |
| *(bu commit)* | `test:rules` glob düzeltmesi (Node 26 `--test` klasörü dosya sanıyordu), SDK ret uyarılarının susturulması, kanıtlar ve bu walkthrough |

`git diff --stat 6ac3d2f..3a16ea1`: `.gitignore` +3 · `firebase.json` 24 · `package.json` 13 · `package-lock.json` (bağımlılıklar) · `scratch/emu-seed.mjs` +105 · `scratch/flow-tests.js` 46 · `scratch/smoke-test.js` 15 · `src/services/firebase-handler.js` 28 · `tests/rules/rules.test.mjs` +169

## Neler eklendi
**Kural testleri** — `tests/rules/rules.test.mjs`, **65 senaryo** (plandaki "75" yanlış sayımdı), plan §4 Aşama A hedefi ve Ek D'den: kökler ve okuma (tanımsız kök, bilinmeyen koleksiyon, V1 kilidi, KJ-2), admin kimliği (başka e-posta, anonim sağlayıcıyla sahte admin e-postası), personel yazma yetkisi (10 admin koleksiyonu, T7), silme (KJ-5 dahil), bakım modu (kök ayrımı dahil), etiket reddi (10 alan + `<5mm` serbest), denetim günlüğü (KJ-7 şema, değişmezlik). `RULES_FILE=...` ile başka kural dosyası denenebilir.

**Emülatör modu** — `firebase-handler.js`: yalnız `localhost`/`127.0.0.1` **ve** `?emu=1` ile; sekme boyunca `sessionStorage`'da kalır (index → admin geçişi), `?emu=0` kapatır. `connectFirestoreEmulator` / `connectAuthEmulator` ilk işlemden önce; `window.AppEnv.EMULATOR`; ENV_GUARD logu `inventory_demo @ EMULATOR (127.0.0.1)`. Uygulamanın tüm Firestore/Auth erişimleri aynı örnek üzerinden (`getAuth(app)`, `getFirestore()`) olduğundan tek bağlantı yeterli (taramayla doğrulandı).

**Tohum** — `scratch/emu-seed.mjs`: `pull` gerçek `inventory_demo`'yu anonim oturumla **salt-okunur** çeker → `scratch/emu-data/inventory_demo.json` (git dışı: demo personel kodları içerir); `push` çalışan emülatöre kural atlamalı yazar ve Auth emülatöründe **yalnız emülatörde geçerli** admin hesabını açar (kod `emu01`; gerçek parola değildir, gerçek kimlik bilgisi hiçbir betiğe girmez — §7.5).

**Akış testleri** — `--emu`: uygulama emülatörde; `__ft.adminLogin()` / `__ft.backToAnonymous()` yalnız emülatörde çalışır (gerçek projede hata fırlatır). Admin oturumu isteyen akışlar ilk kez otomatik test edilebiliyor.

## Sahibi / geliştirici için kullanım
```
npm run test:rules                 # kural matrisi (emülatörü kendisi açar/kapatır)
npm run emu                        # ayrı terminalde: Firestore 8080 + Auth 9099
npm run emu:pull                   # gerektiğinde: demo'nun güncel kopyası (salt-okunur)
npm run emu:seed                   # emülatöre yükle + EMU admin
node scratch/smoke-test.js <etiket> --emu
node scratch/flow-tests.js --emu [senaryo…]
# Tarayıcıda: http://127.0.0.1:<port>/index.html?emu=1  → yönetici girişi kodu: emu01
```
Not: Bu makinede PATH'te Oracle Java 8 girdisi önde olabilir; `java -version` 21 göstermiyorsa terminali yeniden açın veya `JAVA_HOME`'u Temurin 21'e verin.

## Kanıt
**1. Kural baseline'ı (mevcut `firestore.rules`)** — `scratch/baseline/2026-10-01T08-30-38_p4-j0-rules/rules-baseline.txt`: **65 senaryo · 39 ✔ · 26 ✖**. Kırmızılar bugün yayındaki kuralların (TEYİT 0.2c: Console ile birebir aynı) gerçek açıklarıdır:
| Grup | Kırmızı | Ne demek |
|---|---|---|
| Silme | anonim talep silemez · anonim satın alma silemez · KJ-5 işaretsiz demo kaydı · KJ-5 canlı kök | Kod girmemiş herhangi bir ziyaretçi talep ve satın almaları siliyor (RULE-02) |
| Bakım | bakımda anonim talep oluşturamaz · görev silemez | Bakım yalnız istemci tarafında (RULE-05) |
| Etiket | 10 alanın tamamı | `<img onerror>` her personel-yazılabilir alana kaydediliyor (SEC-01 savunma derinliği yok) |
| T7 | anonim `assignments` / `serviceRecords` yazamaz | Hiçbir personel akışı yazmıyor ama kural izin veriyor |
| Kökler | bilinmeyen koleksiyon · `inventory_v2` anonim okuma · kök `system_config` | Kural joker (`{col}/{document=**}`) her koleksiyonu açıyor; eski kök personele açık |
| Kimlik | anonim sağlayıcı + admin e-postası | Kural yalnız e-postaya bakıyor (gerçek anonim token'da e-posta olmaz; savunma derinliği) |
| auditLogs | geçerli ekleme · anonim okuyamaz · admin güncelleyemez/silemez | Koleksiyon kuralı henüz yok (J1/J4) |

J1 kabulü: aynı matris **65/65 yeşil**.

**2. Smoke** — normal mod `scratch/baseline/2026-09-30T14-22-36_p4-j0` ve emülatör `…/2026-10-01T05-31-30_p4-j0_emu`: index pageerror 0 / console.error 0 / "Veri Çekildi" 13; admin pageerror 0 / console.error 1 (bilinen favicon 404) / 13 — Faz 3.5 baseline'ı (`2026-09-30T12-26-52_p3-5-hotfix`) ile **birebir aynı**; çift yükleme yok.

**3. `j0Emulator`** — anonim başlangıç ✔ · tohum b1 = 2 ✔ · anonim b1 yazma `permission-denied` ✔ · emülatör admin girişi ✔ · `isDbAdmin()` true ✔ · admin b1 yaz/sil `ALLOWED` ✔ · anonim oturuma dönüş ✔ · çıkış sonrası senkron yeniden başladı ✔.

**4. Eşdeğerlik** — tam suite iki kez: gerçek demo (35/35, pageerror 0) ve emülatör (35/35, pageerror 0). Çıktılar normalize edilerek karşılaştırıldı: **32 senaryo birebir aynı**; farklar yalnız
- `hotfixDeviceUsesMemo`: süre ölçümleri (ms),
- `j0Emulator`: gerçek modda `skipped` (beklenen),
- `tur3AdminPanel`: aynı reddin mesaj metni — emülatör izin reddine kural ayrıntısını ekliyor (`PERMISSION_DENIED: Property email is undefined…`), gerçek proje genel metin veriyor; hata kodu ikisinde de `permission-denied`. **Sonuç:** testler mesaja değil koda bakmalı (mevcutlar öyle).

Test artığı: iki çalıştırmada da `__flowtest__` kaydı 0; sahibinin demo kayıtları değişmedi.

## Bilinen / J1'e
- J1: `firestore.rules` → Rules v2 Aşama A (plan §4) + istemci hizalaması (M1-M5); emülatör uygulamayı yeni kurallarla açar (`npm run emu` her başlatmada `firestore.rules`'ı okur), flow suite `--emu` ile yeni kurallarda, gerçek demo üzerinde eski (yayındaki) kurallarda koşar.
- `firestore-debug.log` emülatör tarafından kökte üretiliyor (`*.log` zaten git dışı).
- npm 11 `allowScripts` uyarısı (`re2`, `protobufjs` vb. kurulum betikleri çalıştırılmadı): emülatör ve testler bunlarsız çalışıyor; müdahale gerekmedi.
