# Faz 4B Tur J7: Hesap Altyapısı ve Provisioning (4.6 · K4)

## Özet
Aşama B'nin ilk adımı: her personele kendi Firebase Auth hesabı açılabiliyor. Personel ekleme/düzenleme akışları ve
VIP panelindeki yeni **Auth Göç Aracı** hesapları admin oturumunu düşürmeden açar ve personel kaydına bağlar.
**Bu turda giriş ekranı, giriş akışı ve Firestore kuralları DEĞİŞMEDİ** — hesaplar açılır ama henüz giriş için
kullanılmaz (J8). Dal: `feat/phase-4b-identity-model` (master `00a87bd`'den).

## Hesap modeli

| | Değer | Not |
|---|---|---|
| E-posta | `p<personelId>@staff.medipol.local` | Sentetik, doğrulanmaz. Güvenli olmayan id'ler (büyük harf, boşluk, Türkçe harf, `/`) `p.` + UTF-8 onaltılık kodlanır: Firebase e-postaları harf duyarsız olduğu için `Ab` ve `ab` aksi hâlde aynı hesaba düşerdi. Güvenli id `.` içermediğinden iki biçim asla çakışmaz. |
| Parola | giriş kodu + `Mdp!` | Kod, girişle birebir aynı normalizasyondan geçer (`completeStaffLogin`: kırpılmış, `p.code === code` → harf duyarlı). Dolgu gizli DEĞİLDİR; yalnız Firebase'in ≥ 6 karakter kuralını karşılar. Kod en az 4 karakter olmalı (mevcut tüm kodlar 5). |
| Bağlama | `personel.uid`, `authEmail`, `authProvisionedAt` | Admin yazması (`updateItem`). Önce hesap, sonra bağlama: bağlama düşerse yeniden çalıştırma hesabı "zaten var" bulur, aynı parolayla uid'i alıp bağlar. |

## İkincil app örneği (admin oturumu düşmez)
Ana Auth örneğiyle `createUserWithEmailAndPassword` çağrılırsa Firebase yeni hesapla **oturum açar**. Hesaplar bu yüzden
ayrı bir `initializeApp(firebaseConfig, 'provisioner')` örneğinde, **bellek içi kalıcılıkla** (`inMemoryPersistence`)
açılır: ikincil oturum tarayıcı depolamasına yazılmaz, sekmeler arası sızmaz, her işlemden sonra `signOut` edilir.
Emülatör modunda ikincil örnek de Auth emülatörüne bağlanır.

## Değişiklikler
- **`src/services/staff-provisioning.js`** (yeni): saf çekirdek (`staffEmail`, `staffPassword`, `planProvisioning`,
  `provisionOne`, `provisionMissing`, `describe`) + Firebase bağdaştırıcısı (`createAuthProvisioner`, fonksiyonlar enjekte
  edilir → node'da gerçek SDK ile test edilebilir). Kota (`too-many-requests`) veya kapalı sign-up toplu işi durdurur ve
  kalan sayıyı bildirir; açılmış olanlar bağlı kalır, yeniden çalıştırma kaldığı yerden devam eder.
- **`firebase-handler.js`**: `window.provisionStaffAccount(person)`, `window.provisionMissingStaffAccounts()` — yalnız
  Firebase admin oturumu.
- **Personel akışları**: `addPersonel` (index) ve `_saveQuickPersonnel` (admin hızlı ekleme) kayıttan hemen sonra hesap
  açar (id önceden üretilir). `editPersonel` hesabı olmayan kişiye hesap açar (kod düzenlemede değişmez). Hesap açılamazsa
  personel kaydı yine geçerlidir; kullanıcı uyarılır ("VIP → Auth Göç Aracı ile tekrar denenebilir").
- **VIP · Sistem Aksiyonları → "Auth Göç Aracı"**: önizleme (hesabı olan / açılacak / açılamayacak + nedeni, aynı kodu
  paylaşan kişi sayısı) → onay → ilerleme düğme üzerinde → özet + VIP terminal logu. Giriş kodları ve parolalar hiçbir
  önizlemeye, uyarıya, loga ya da konsola yazılmaz.
- **Testler**: `tests/unit/staff-provisioning.test.mjs` (13), `tests/integration/staff-provisioning.emu.test.mjs` (7,
  `npm run test:staff:emu`, Auth + Firestore emülatörü, üretim kuralları REST ile yüklenir), flow `j7StaffProvisioning`.
  `k3AdminTabHooks` ve `personnelById` admin kapısını taklit ettikleri için hesap açma köprüsü de yakalanır (aksi hâlde
  `--emu` olmadan koşulduğunda gerçek projeye hesap açma isteği giderdi).
- `scratch/hosting-files.js`: `EXPECTED_COUNT` 52 → 53 (yeni modül); `test:atomic:emu` yalnız kendi dosyasını koşar.

## Test sonuçları

| Paket | Sonuç |
|---|---|
| `npm run test:unit` | 66/66 (yeni 13) |
| `npm run test:staff:emu` (yeni) | 7/7 |
| `npm run test:atomic:emu` | 5/5 |
| `npm run test:rules` | 72/72 (kurallar değişmedi) |
| `node scratch/flow-tests.js --emu` | 51/51 (yeni `j7StaffProvisioning`) · 0 sayfa hatası · 0 CSP ihlali |
| `npm run lint:xss` | 0 izinsiz (44 dosya) |
| `node scratch/hosting-files.js` | 53/53 ✔ |

Emülatörde kanıtlananlar: hesap açma boyunca admin oturumu **aynı uid** ile sürer ve kurallar onu hâlâ admin sayar;
açılan her hesapla e-posta/parola girişi personel kaydındaki uid'yi verir (`sign_in_provider: password`); dolgusuz kod
parola değildir; ikinci koşu hiçbir hesap açmaz; silinmiş bağ aynı uid'le onarılır; kodu değişmiş kişi `conflict` olur;
**Aşama A kuralları personel hesabına admin yetkisi vermez** (personel/b1 yazamaz) — J7 hiçbir yetki genişletmez.

## J8–J10 için kararlar ve riskler

1. **J10 · `isStaff()` yalnız alan adına bakmamalı (kritik).** E-postalar doğrulanmaz; istemci tarafı hesap açma açık
   olduğu sürece (J7 bunu gerektirir) herkes kendine `…@staff.medipol.local` hesabı açabilir — emülatör testi bunu
   kanıtlıyor. Plan §6'daki "sağlayıcı `password` ve `@staff.` alanı — ek okuma yok" tanımı bu yüzden yetersiz. Öneri:
   `isStaff()` personel kaydındaki `uid`'yi doğrulasın (e-postanın yerel kısmından personel id'si → `get(...).data.uid ==
   request.auth.uid`, istek başına +1 okuma) ya da göç bitince Console'da sign-up kapatılıp yeni hesaplar yerel
   `firebase-admin` betiğiyle açılsın.
2. **Firebase Console ön koşulu.** Authentication → Settings → User actions → "Enable create (sign-up)" açık olmalı;
   kapalıysa araç `signup-disabled` ile durur ve bunu söyler. Canlı projede bu ayar bu oturumda doğrulanamadı.
3. **Kota.** Firebase istemci tarafı hesap açmayı IP başına sınırlar; toplu araç `too-many-requests`'te durur ve
   yeniden çalıştırılınca kalanları açar.
4. **Personel silme hesabı silmez.** İstemci SDK'sı başka kullanıcıyı silemez; plan bunu yerel `firebase-admin` betiğine
   bırakıyor (kod sıfırlama ile birlikte — bu turda yazılmadı). J10'dan önce gerekli: silinen personelin hesabı (1. madde
   uygulanmazsa) personel sayılmaya devam ederdi.
5. **Kod değişikliği.** Kod bugün düzenlemede salt okunur. Değişirse hesap parolası eski kalır → araç `conflict` raporlar;
   sıfırlama yine `firebase-admin` betiğinin işi.
6. **Kod uzunluğu.** Plan 5 → 8 karakter öneriyor; J7 parolayı koddan türettiği için güvenlik kodun arama uzayına bağlı.
   Giriş girdisini etkilediği için bu tura alınmadı (UI kapsam dışı) — J8 kararı.
7. **Aynı kodu paylaşan personel.** Hesaplar id başına açıldığı için sorun yok; ancak J8'in "kod → personel → e-posta"
   eşlemesi belirsiz kalır. Araç önizlemede sayıyı gösterir (kodu göstermeden); J8'den önce tekilleştirilmeli.
