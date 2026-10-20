# Faz 4B Tur J10: Aşama B Kuralları ve Kilit Vurma (4.6 · K4) — PRI revizyonu

## Özet
Personel kimliği artık yalnız **Firebase Auth** hesabından gelir. Anonim oturum kaldırıldı. Bu tur:
1. Girişi **kurumsal kimlik (PRI) + kod** biçimine çevirir. Giriş ekranında iki kutu vardır; veritabanından hiçbir şey okunmadan
   doğrudan `signInWithEmailAndPassword(<pri>@staff.medipol.local, kod + "Mdp!")` çağrılır.
2. Düz metin kodları veritabanından silen VIP **Kod Temizliği** aracını ekler. Kodlar artık personel kaydına yazılamaz.
3. Firestore kurallarını **Aşama B**'ye taşır:
   - Personel = PRI e-postalı hesap + yöneticinin yazdığı hesap eşlemesi + personel kaydında aynı uid ve aynı PRI.
   - Ziyaretçi hiçbir şey okuyamaz (KVKK).
   - Sahiplik zorunlu.
   - Onay adımını yalnız sırası gelmiş onaylayıcı ve yalnız kendi adımında değiştirebilir.

   Bu kurallar kötü niyetli testlerle kanıtlandı.

> **Revizyon notu:** J10'un ilk sürümündeki oturumsuz "adını seç" listesi (giriş rehberi, `staffDirectory`) KVKK ve kullanım
> gerekçesiyle **iptal edildi**. Yerine PRI geldi. Rehberin istemci kodu, kuralı ve testleri kaldırıldı.

GPT-6 "Sıfır Tolerans" maddeleri bağlayıcı kabul edildi: `STAFF_AUTH_MODE` sabit `accounts`, anonim sağlayıcı kapalı varsayılır.
Dal: `feat/phase-4b-identity-model`.

## 1. Kurumsal kimlik (PRI)

**Üretim kuralı** (`StaffProvisioning.generateStaffPri`, `window.generateStaffPri`):
- Türkçe harfler arındırılır (ç→c, ğ→g, ı/İ→i, ö→o, ş→s, ü→u; diğer aksanlar da atılır), küçük harfe çevrilir. `"İ".toLowerCase()`
  tuzağı yoktur.
- İki kelimeli adda `ad.soyad`; daha uzun adda ilk ve son kelime. Örnekler: "Ayşe Yılmaz" → `ayse.yilmaz`, "Mehmet Ali Yılmaz" →
  `mehmet.yilmaz`. Tek kelimede kendisi ("Seher" → `seher`). Kelime içindeki noktalama atılır.
- Başka personelde varsa sonuna artan numara eklenir: `ayse.yilmaz2`, `ayse.yilmaz3`…
- Biçim: `a-z`, `0-9`, parçalar arasında `.` `_` `-`; en fazla 64 karakter. Kuraldaki desenle aynıdır; birim testi ikisini
  karşılaştırır.

**Yönetici ekranları:**
- "Yeni Personel" (index) ve hızlı ekleme (yönetici paneli): ad yazıldıkça PRI önerilir. Yönetici kutuyu elle değiştirirse öneri
  artık üzerine yazmaz. Başka personelin PRI'si reddedilir.
- Düzenleme: hesap açılmamışsa PRI değiştirilebilir. Hesap açıksa PRI kilitlidir, çünkü hesabın e-postasıdır ve istemciden
  değiştirilemez.
- Personel tablosu: "Kurumsal Kimlik / Hesap" sütunu gösterir: PRI, ✓, "Hesap Aç" ya da "⚠ göç bekliyor".
- Kod ve PRI yöneticiye **bir kez** gösterilir ("Giriş Kodu" penceresi, "Kodu aldım"). Kod saklanmaz.

**Hesap e-postası:** `<pri>@staff.medipol.local`.

## 2. Giriş ekranı

- **İki kutu:** Kurumsal kimlik (metin, placeholder `ad.soyad`) ve giriş kodu (`type="password"`, maskeli). Liste, açılır menü
  ya da arama kutusu yoktur.
- **Akış:** PRI, üretimdeki normalizasyonla okunur (boşluk kırpılır, Türkçe harf arındırılır, küçük harf); sonra doğrudan
  `signInWithEmailAndPassword` çağrılır. Girişten önce Firestore'a hiç istek gitmez (akış testi bunu ölçer). Kullanıcının istediği
  `pri.trim().toLowerCase()` formülünün üst kümesidir: "İsmail.Kaya" gibi yazımlar da doğru hesaba gider.
- **Mesajlar:**

| Durum | Mesaj |
|---|---|
| Kimlik boş | "Kurumsal kimliğinizi (ad.soyad) girin" + yönetici ipucu |
| Biçim hatalı | "Kurumsal kimlik ad.soyad biçiminde olmalı" (ağa gitmez) |
| Bilinmeyen kimlik **ya da** yanlış kod | Aynı mesaj: "Kurumsal kimlik ya da giriş kodu hatalı" (hesabın varlığı sızdırılmaz) |
| `too-many-requests` | "Çok fazla deneme…" (Firebase'in kendi deneme sınırı) |
| `user-disabled` | "Giriş hesabınız devre dışı" |
| ağ hatası | "Sunucuya bağlanılamadı" |
| hesap personel kaydına bağlı değil | Oturum kapatılır, "yöneticiye başvurun" |

- **Başarılı giriş:** oturum uid ile personel kaydına bağlanır (K5). Kod oturumda ve yerel depoda yoktur. Kimlik kutusu temizlenir;
  çıkışta da temizlenir, böylece ortak bilgisayarda bir sonraki kişi önceki kimliği görmez.
- **Yönetici girişi değişmedi:** kimlik kutusu boş bırakılır, parola kod kutusuna yazılır, "Yönetici Paneli"ne basılır. Üçüncü bir
  kutu eklenmedi.
- **Kaldırılanlar:** `signInAnonymously`, J8 hibrit / anonim modları, VIP "Giriş Modu", J10 ilk sürümündeki giriş rehberi.

## 3. Mevcut kayıtların göçü — VIP "PRI / Hesap Göç Aracı"

J7'nin "Auth Göç Aracı" bu sihirbaza dönüştü ve J9 aracının kurallarına uyar:

| Kural | Uygulama |
|---|---|
| Önizleme yazmaz | Kişi kişi atanacak PRI ve işlem gösterilir; kod gösterilmez. |
| İşlemler | **PRI yaz** (eksik / geçersiz / çakışan; bağlı hesabınki korunur) · **hesap aç** (`<pri>@`, kayıttaki eski kodla) · **J7 hesabını taşı** (`p<id>@` → `<pri>@`, `updateEmail` ile, **uid korunur**: J9 sahiplik alanları kopmaz) · **eşlemeyi yenile** (bağlı personel) · kod yoksa yalnız PRI yazılır, hesap tablodan "Hesap Aç" ile açılır · tutarsız bağa dokunulmaz. |
| Eşzamanlı değişiklik | Uygulama personel listesini sunucudan taze okur; önizlemeden sonra değiştiyse hiç yazmadan durur. |
| Yanlış hesap taşınmaz | Eski adresle girilen hesabın uid'si personel kaydındakiyle aynı değilse e-posta **değiştirilmeden** durur (birim testinde bulunup düzeltildi). |
| Kısmi hata gizlenmez | Durum başına sayı, durma nedeni, denenmeyen sayısı ve sorunlu kişiler listelenir. Yeniden çalıştırmak güvenlidir. |
| Durdurucular | Kota (`too-many-requests`), kapalı sign-up ve projede doğrulamasız e-posta değişikliğinin kapalı olması (bkz. Açık işler). |

**Kuralların kimlik eşlemesi:** `${root}/staffAccounts/items/{uid}` → `{ personelId, pri }`. Hesap açılırken / taşınırken /
yenilenirken yönetici yazar. Önce eşleme, sonra personel kaydı yazılır.

## 4. Kod temizliği (değişmedi)
- Yeni personelin kodu kayda yazılmaz.
- VIP **Kod Temizliği**: `personel.code` ve `requests.personelKodu` alanlarını siler; kod taşıyan `purchaseOrders.createdBy` alanını
  personel id'sine çevirir.
- Önizleme yazmaz. Önkoşullar:
  - Tüm personelin hesabı **PRI adresinde** olmalı (J7 adresinde kalan hesap engeldir).
  - Sahiplik göçü bitmiş olmalı.
- Kurallar personel kaydına kod yazılmasını reddeder (yönetici dahil).
- **Sıra önemli:** J7 hesabının taşınması eski kodu gerektirir. PRI / Hesap Göçü, Kod Temizliğinden **önce** yapılmalıdır.

## 5. Kurallar · Aşama B

| Konu | Kural |
|---|---|
| Personel kimliği | `isStaff`: e-posta/parola oturumu; e-posta `<pri>@staff.medipol.local` deseninde; `staffAccounts/{auth.uid}` eşlemesi var; eşlemenin gösterdiği personel kaydında `uid == auth.uid` **ve** `pri == e-postadaki PRI`. |
| Okuma | Yalnız yönetici ve bağlı personel. **Oturumsuz ziyaretçi hiçbir şey okuyamaz** (personel dahil). Giriş rehberi kaldırıldı; `staffDirectory` için kural yok, herkese kapalı. |
| Hesap eşlemesi | `staffAccounts` yalnız yönetici okur/yazar. Personel kendi eşlemesini yazamaz. |
| Talep / satın alma / görev / onay adımı / sahiplik / kod / denetim günlüğü | J10 ilk sürümüyle aynı (değişmedi). |

**Kimlik için yeni kötü niyetli testler** (hepsi reddedilir):
- PRI addan tahmin edilip hesap önceden açılmış (eşleme yok).
- Eşleme kalmış ama personel kaydındaki bağ kaldırılmış.
- Eşleme silinmiş bir personeli gösteriyor.
- uid ve eşleme doğru ama e-postadaki PRI farklı.
- Taşınmamış J7 adresi (`p<id>@`).
- Kendine hesap açan kişinin kendini eşlemeye ya da personel kaydına uid yazmaya çalışması.
- Oturumsuz ziyaretçinin personel kaydını ya da listesini okuması.

**Onay adımı testleri** (15) PRI kimliğiyle aynen geçiyor.

**Bilinçli sınırlamalar:**
1. Yönetici yazmaları kısıtlanmaz (göç, geri yükleme); istemci muhafızından geçer.
2. Onaylayıcı uid'lerini akışı başlatan talep sahibi yazar. Ad ↔ uid eşleşmesi kuralla doğrulanamaz. Öneri (J11): adımlar
   yönetici şablonuna karşı denetlensin.
3. Geçmiş ve akış kayıtlarının içeriği doğrulanmaz; yalnız sona ekleme zorunludur. Adım durumu ve `durum` sahtelenemez.
4. Personel tüm personel listesini okur; temizlik yapılana kadar düz metin kodlar da buna dahil. Deploy'dan hemen sonra Kod
   Temizliği yapılmalı.
5. Maliyet: personel isteği başına +2 doküman okuması (eşleme + personel); personel yazmasında bakım modu için +1.
6. **Yeni (PRI'ye özgü):**
   - PRI addan tahmin edilebilir. İstemciden hesap açma açıkken biri, personelin hesabı açılmadan önce o adresi kendine
     alabilir. Bu kişi hiçbir şey okuyamaz ve kendini eşleyemez (kanıtlandı). Gerçek personelin hesabı ise "çakışma" ile açılamaz;
     yönetici farklı bir PRI seçer.
   - Kimlik tahmin edilebildiği için güvenlik koddan gelir. Firebase'in IP başına deneme sınırı vardır. Kodlar 5 karakterlik
     karışık harf-rakam (≈ 28 milyon olasılık). Yalnız rakamdan oluşan 5 haneli kodlar (100 bin olasılık) önerilmez.

## 6. Değişen dosyalar (PRI revizyonu)
- `staff-provisioning.js`:
  - PRI çekirdeği: `foldTr`, `normalizePri`, `generateStaffPri`, `validatePri`.
  - `staffEmail(pri)` / `accountEmailOf`; J7 adresini tanımak için `legacyStaffEmail`.
  - `moveLegacyAccount`, `planAccounts`, `applyAccounts`; ikincil örnekte `moveAccount`.
  - Rehber kaldırıldı.
- `firebase-handler.js`:
  - Eşleme + bağlama.
  - `planStaffAccounts` / `applyStaffAccounts` (taze okuma, parmak izi).
  - Rehber kaldırıldı; `updateEmail` içe aktarıldı.
- `auth-engine.js`: giriş bloğu (PRI + kod). `main.js`: çıkışta kimlik kutusu temizlenir.
- `index.html`: iki kutulu giriş; personel modalında PRI alanı.
- `script.js`, `personel.js`, `inventory-management.js`: PRI önerisi, doğrulama, kilit, tablo.
- `admin-system-control.js`, `admin.html`: PRI / Hesap Göç Aracı.
- `ownership.js`: hesap tutarlılığı PRI adresine göre; parmak izinde PRI.
- `firestore.rules`: `isStaff` (eşleme + uid + PRI), `staffAccounts`; `staffDirectory` kaldırıldı.
- Testler:
  - Birim (PRI, göç planı, kural deseni eşliği).
  - Kurallar (+11 PRI / KVKK testi).
  - Personel ve sahiplik emülatör testleri.
  - `emu-seed.mjs`: PRI'li hesaplar + eşleme; `--legacy`.
  - `flow-tests.js`: giriş düzeneği, `j7`, `j10StaffLogin`, `hotfixLoginFocus`, `j6*`, `j9`, `j10CodeCleanse`.
- Yeni dosya yok; yayın listesi 55.

## Test sonuçları (PRI revizyonu)

| Paket | Sonuç |
|---|---|
| `npm run test:unit` | 96/96 (yeni: PRI üretimi / doğrulaması, kural deseni eşliği, göç planı, J7 taşıma, uid denetimi) |
| `npm run test:rules` | 128/128 (rehber testleri çıktı; +11 PRI eşlemesi / KVKK / kötü niyetli kimlik; onay adımı testleri aynen) |
| `npm run test:staff:emu` | 10/10. Gerçek Auth emülatöründe: J7 hesabı `updateEmail` ile uid korunarak taşındı; eski adres giriş vermiyor. |
| `npm run test:ownership:emu` / `test:atomic:emu` | 6/6 · 5/5 |
| `npm run lint:xss` / `hosting-files.js` | 0 izinsiz · 55/55 |
| `node scratch/flow-tests.js --emu` | **Bu revizyonda koşulmadı** (test sahibine bırakıldı). Senaryolar PRI'ye uyarlandı; J10 ilk sürümünde 54/54 idi. |
| `node scratch/flow-tests.js` (gerçek demo) | Koşulmadı: bulutta J10 yok. Yayından sonra `FT_STAFF_PRI` / `FT_STAFF_CODE` ile. |

## Yayın sırası ve açık işler
1. **Deploy:** Kurallar ve istemci **aynı anda** yayınlanır (`npx firebase deploy --only firestore:rules,hosting`; Faz 4A Deploy
   Runbook adımlarıyla), sahibinin onayıyla. Eski istemci anonim oturuma dayandığı için yeni kurallarla çalışmaz.
2. **PRI / Hesap Göç Aracı** (yönetici paneli → VIP): tüm personele PRI ve `<pri>@` hesap. Hesap açma için kayıttaki eski kodlar
   kullanılır. Kodu olmayan personel için tablodan "Hesap Aç" yapılır.
   - **Önce kontrol:** Firebase Console → Authentication'da `p…@staff.medipol.local` hesapları var mı? J7–J10 hiç yayınlanmadığı
     için büyük olasılıkla yoktur; yoksa taşıma adımı hiç çalışmaz.
   - Varsa taşıma `updateEmail` ister. Projede "Email enumeration protection" açıksa araç açık bir mesajla durur. O zaman ya bu
     koruma taşıma süresince kapatılır ya da taşıma `firebase-admin` betiğiyle yapılır.
3. **Sahiplik Göç Aracı** çalıştırılır.
4. **Kod Temizliği** hemen ardından yapılır (sınırlama 4).
5. **Console:** Anonymous sağlayıcı kapatılır. E-posta ile hesap açma **açık kalmalı**, çünkü "Yeni Personel" hesabı istemciden
   açıyor. Kalan riskler: Auth kotası ve PRI'nin önceden alınması (sınırlama 6). Kapatılacaksa hesap açma bir sunucu fonksiyonuna
   taşınmalıdır.
6. **Kodunu unutan personel:** İstemciden parola sıfırlanamaz. Uid'yi koruyan bir `firebase-admin` betiği gerekir
   (`updateUser(uid, { password })`). **J11 / yayın öncesi.**
7. `scratch/emu-seed.mjs pull` gerçek demoyu anonim oturumla okuyor. Aşama B yayınlanınca çalışmaz; bir personel / yönetici
   girişine çevrilmeli.
8. J9'dan devreden iki iş kurallarla zorlanmıyor: şablon erişim listesi (`auth`, adlarla) ve paralel onay yapıları.
