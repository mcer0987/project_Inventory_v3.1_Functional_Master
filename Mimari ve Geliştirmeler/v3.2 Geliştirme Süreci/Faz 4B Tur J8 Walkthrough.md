# Faz 4B Tur J8: Hibrit Giriş ve UI (4.6 · K4)

## Özet
Personel giriş ekranı J7'de açılan hesaplara bağlandı. Hesabı olan personel artık **kendi Firebase Auth hesabıyla**
(e-posta/parola) oturum açar; hesabı olmayan personel eski yoldan (kod + anonim oturum) çalışmaya devam eder. Aynı kodu
paylaşan kişiler giriş yapamaz. Hesapla girilen oturum **sayfa yenilemede korunur (K5)**. Giriş kodu artık oturum nesnesine,
localStorage'a ve yeni satın alma belgelerine yazılmaz; personel tablosunda yalnız yönetici görür. Firestore kuralları
DEĞİŞMEDİ (Aşama A). Dal: `feat/phase-4b-identity-model`.

## 1. `STAFF_AUTH_MODE`
`system_config/admin_settings.staffAuthMode` (tüm istemciler bu dokümanı zaten dinliyor; yalnız admin yazar), okuma
`Session.getStaffAuthMode()`; eksik/geçersiz → **`hybrid`**. VIP → Sistem Aksiyonları → **"Giriş Modu"** düğmesi sunucudaki
modu gösterir ve onayla bir sonrakine geçirir; "yalnız hesap"a geçerken hesabı olmayan ve kodu ortak personel sayısını uyarır.

| Mod | Hesabı olan | Hesabı olmayan |
|---|---|---|
| `anonymous` | eski yol (hesap kullanılmaz) | eski yol |
| `hybrid` (varsayılan) | hesapla giriş | eski yol |
| `accounts` | hesapla giriş | **giremez** ("hesabınız henüz tanımlı değil") |

## 2. Giriş akışı (`handleLogin` → `completeStaffLogin`)
Karar saf fonksiyonda: `StaffCodeRegistry.planStaffLogin({ personel, code, mode })` (birim testli).
1. Kod `resolveLoginCode` ile çözülür. **Birden fazla eşleşme → red**: "Giriş yapılamadı, lütfen yöneticiye başvurun." +
   denetim günlüğüne `login-ambiguous / blocked` (kodun kendisi yazılmaz). İlk eşleşmeye asla düşülmez.
2. Hesap yolu: **ANA** Auth örneğinde, yerel kalıcılıkla `signInWithEmailAndPassword(authEmail, kod + "Mdp!")`
   (`window.signInStaffAccount`). Anonim oturum yerini personel hesabına bırakır; Firestore dinleyicileri yeni kimlikle
   sürer. Girişten sonra **hesabın uid'i `personel.uid` ile doğrulanır** — eşleşmezse oturum hemen kapatılır, red +
   `login-uid-mismatch` denetim kaydı.
3. Hesapla giriş başarısızsa (`accountFailurePolicy`): hibritte yalnız kimlik bilgisi uyuşmazlığı (hesap parolası kodla
   senkron değil) eski yola düşer — Aşama A'nın güvenlik seviyesi zaten budur; kota / ağ / devre dışı hesap her modda
   reddedilir (eski yola düşmek sorunu gizlerdi). `accounts` modunda uyuşmazlık da red + `login-account-out-of-sync`.
4. Eski yol: önceki bir personel hesabı oturumu açık kaldıysa kapatılır, anonim oturumla devam edilir.

## 3. Yenilemede oturum (K5)
`checkAuth` personel **hesabı** oturumunu tanır (`Session.isStaffAccountSession`: e-posta/parola + `@staff.medipol.local`).
Kimlik Firebase'in kendi kalıcılığından gelir ve personel listesinde **uid ile** bulunur — localStorage'daki `activeUser`'a
güvenilmez, yeniden yazılır. Personel listesi henüz gelmediyse ilk personel snapshot'ında yeniden denenir. uid hiçbir
personele bağlı değilse (silinmiş personel, yabancı hesap) ya da mod `anonymous`'a alındıysa oturum kapatılır. Anonim
(eski yol) oturum bilinçli olarak eskisi gibi yenilemede geri yüklenmez. Hareketsizlik zamanlayıcısı (timer.js) personel
hesabı oturumunu da kapatır (paylaşılan cihaz riski).

## 4. Giriş kodu istemcide
| Önce | Şimdi |
|---|---|
| `setActiveUser(personel)` kodu localStorage'a (XOR maske güvenlik değil) ve `window.currentUser`'a yazıyordu | `Session.sanitizeUser`: `code`/`password`/`token` hiçbir zaman saklanmaz; J8 öncesi oturumlar okunurken ayıklanıp yeniden yazılır |
| Yeni satın alma talebi `createdBy = giriş kodu` (herkesin okuduğu belgeye) | `createdBy = personel id` (J9 `createdByUid` ekler) |
| "Kendi talebim" filtresi yalnız `createdBy === kod` | id **veya** talep eden adı (sahiplik denetimiyle aynı politika); kodla açılmış eski talepler adla eşleşir |
| Personel tablosunda kod herkese | yalnız Firebase admin oturumunda; diğerlerinde `•••••` |

Kodla eşleşen diğer eski yollar (`isSelfApproval`, `matchesPerson`, şablon yetkisi) zaten id → kod → ad sırasıyla eşleşiyor;
oturumda kod olmayınca id ve ad yedeği kullanılır.

**Bilinçli sınır:** Giriş anında `code → personel` çözümü için personel listesindeki kodlar hâlâ okunuyor
(`resolveLoginCode`) — Aşama A kuralları personel koleksiyonunu oturumlu herkese açıyor ve sunucusuz bir yapıda kodu hesap
e-postasına çevirmenin başka yolu yok (e-posta personel id'sinden türetiliyor). Bu, J10'un çözmesi gereken asıl sorun
(aşağıda).

## Test sonuçları

| Paket | Sonuç |
|---|---|
| `npm run test:unit` | 86/86 (yeni: `session-store.test.mjs` 4, `planStaffLogin`/`accountFailurePolicy` 3) |
| `npm run test:staff:emu` / `test:atomic:emu` / `test:rules` | 11/11 · 5/5 · 72/72 |
| `node scratch/flow-tests.js --emu` | 53/53 · 0 sayfa hatası · 0 CSP ihlali (7dk 40sn) |
| `node scratch/flow-tests.js` (gerçek demo) | 53/53 · 0 sayfa hatası · 0 CSP ihlali (5dk 37sn) |
| `npm run lint:xss` / `hosting-files.js` | 0 izinsiz · 54/54 |

`j8HybridLogin` gerçek giriş ekranını sürer. **Her iki modda**: ortak kod reddi + `blocked` denetim kaydı (kod içermez),
hesapsız personel hibritte eski yoldan girer, yalnız-hesap modunda reddedilir, oturumda/localStorage'da kod yok, tablo
maskeli. **Emülatörde ayrıca**: hesaplı personel e-posta/parola ile girer (uid = `personel.uid`, admin değil), kurallar
altında talep açar, **F5'te oturum geri gelir** (giriş modalı açılmaz), çıkışta anonime döner, `anonymous` modunda hesap
kullanılmaz. Gerçek demoda personelin hesabı olmadığı için (J7 aracı orada çalıştırılmadı) hesap yolu yalnız emülatörde
sınandı; gerçek demoda davranış değişmedi (hibrit + hesapsız = eski yol).

### Test altyapısı düzeltmeleri (ürün kodu değil)
- **Emülatör bellek dolması:** uzun test oturumunda Firestore emülatörü `OutOfMemoryError` verdi; tüm yazmalar düştü ve
  senaryolar zaman aşımına uğradı. Emülatör `JAVA_TOOL_OPTIONS=-Xmx4g` ile çalıştırılıyor (bkz. `EMULATOR_GUIDE.md`).
- **`j3SessionVisa` yan etkisi:** `logout`'u taklit edilmiş `endAdminSession` ile çağırıp "veriler hazır" bayrağını kapalı
  bırakıyordu; sonraki ana sayfa girişi 15 sn bekleyip düşüyordu (yalnız gerçek demoda görünüyordu). Bayrak geri yükleniyor.
- **Oturum fikstürleri:** `tur3AdminPanel` hedef/kendini hedefleme denetimlerinde koda değil id'ye dayanıyor (oturum artık
  kod taşımıyor).
- **Araçlar:** `flow-tests.js` her senaryo başında ilerleme satırı (`[12/53] … başladı`) ve sonda özet yazar; `--headed`
  ile test Chrome'u görünür açılır. `npm run serve` (`scratch/dev-server.js`) uygulamayı canlıdaki güvenlik başlıklarıyla
  127.0.0.1:5500'de servis eder. `firebase.json`'da Emulator UI açıldı (127.0.0.1:4000). PM/PO için kısa kılavuz:
  `EMULATOR_GUIDE.md`.

## J9–J10 girdileri
1. **J10 · giriş araması (kritik).** Kurallar personel kodlarını gizlediğinde (`personel` kodları kalkar) istemci girilen
   kodu hesaba çeviremez. Seçenekler: (a) e-postayı koddan türetmek — kod değişince e-posta değişir, istemci SDK'sında
   doğrulanmamış e-posta değiştirilemez (J7.5 akışı bozulur); (b) herkese açık "kod özeti → e-posta" dizini — 5 karakterlik
   kod alanı (36⁵ ≈ 60M) çevrimdışı kaba kuvvetle saniyeler içinde çözülür, ancak 8 karakter + yavaş KDF ile makul olur;
   (c) Cloud Function (Blaze) ile sunucu tarafı arama. Karar sahibinin.
2. **J10 · `isStaff()`** yalnız alan adına bakmamalı (J7 raporu): uid personel kaydıyla doğrulanmalı.
3. **J9 · sahiplik alanları:** `createdBy` artık id; `createdByUid`, `requests.personelUid`, adım `userUid` eklenecek ve
   eski kod/ad tabanlı kayıtlar göç edilecek.
4. Hesabı olmayan personel hibritte anonim oturumla çalıştığı için `accounts` moduna geçmeden önce VIP "Auth Göç Aracı" ve
   "Kod Benzersizleştirme" çalıştırılmalı (VIP mod düğmesi uyarır).
