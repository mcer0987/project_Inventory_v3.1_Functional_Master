# Faz 4A · Canlı Yayın (Deploy) Runbook'u

> **Mühür:** 06.10.2026 · Faz 4 Uygulama Planı §8'in uygulanabilir hali. Bu belge değişirse tarih ve gerekçe aşağıya eklenir.
> **Kim uygular:** Proje sahibi (insan operatör). Ajan deploy etmez; adımlar sahibinin açık kararıyla yürür.
> **Ne yayınlanır:** `master`'daki Faz 4A (J0–J6) — Rules v2 Aşama A **ve** yeni istemci, **aynı komutla** (M16). Storage yok (TEYİT 0.2d).
> **Süre:** hazırlık ~20 dk (bir gün önce) + yayın günü ~15 dk (yedek 3 · deploy 2 · parola 2 · doğrulama 5 · tampon 3).
> **Sır kuralı:** Parola, token veya hash bu belgeye, sohbete, commit'e ya da ekran görüntüsüne **yazılmaz**. Ajana yalnız §7'deki teyit cümlesi iletilir.

---

## Neden bu sıra (tek paragraf)
- **Kurallar ve istemci birlikte gitmeli (M16).** Eski istemci yeni kurallarla çalışırsa personelin silme yolu ve bakım davranışı kırılır.
- **Ters durum güvenli.** Yeni istemci eski kurallarla sorunsuz çalışır; bu kombinasyon akış testlerinin "gerçek demo" koşusunda her turda 40+ senaryoyla sınandı.
- **Geri almada önce kurallar, sonra hosting.** Bu sırayla site her an çalışır durumda kalır.
- **Parola ≥12 karaktere ancak yeni istemci yayındayken döner (M17 / T14).** Eski arayüz 5 karakterden fazlasını kabul etmez; parolayı önce döndürmek admin'i dışarıda bırakır.

---

## Adım 0 — Hazırlık (bir gün önce) ve kalkış kontrolü

| # | İş | Beklenen |
|---|---|---|
| 0.1 | `feat/phase-4-security-and-rules` dalının `master`'a merge'ü (sizin onayınızla; komut: Kapanış Walkthrough §8) | `git log -1 master` → merge commit'i |
| 0.2 | Temiz `master` çalışma kopyası: `git checkout master && git status` | `nothing to commit, working tree clean` |
| 0.3 | `npm ci` | hatasız |
| 0.4 | Kapı testleri:<br>`npm run test:rules`<br>`npm run lint:xss`<br>`node scratch/smoke-test.js deploy-oncesi` | **72/72** · İZİNSİZ **0** · pageerror 0 + "CSP uygulanıyor ✔ · CSP ihlali: 0" |
| 0.5 | (Önerilir) tam akış: `npm run flow` | `FAILED` yok, `csp violations: 0` |
| 0.6 | **Yayınlanacak dosyalar:** `node scratch/hosting-files.js`. `firebase deploy` git'i değil **klasörü** yükler | `✔ Yalnız uygulama dosyaları yayınlanacak.` (47 dosya). `✖` görürseniz **durun**: listede çıkan dosyayı silin ya da `firebase.json` ignore'a ekleyin |
| 0.7 | **TEYİT 0.2c tekrarı:** Console → Firestore Database → **Rules** sekmesindeki metin, 30.09'daki yayın metniyle aynı mı (`git show 2e8ae8f:firestore.rules`)? Arada Console'dan elle bir değişiklik yapıldıysa deploy onu **ezer** | Aynı |
| 0.8 | Console → Authentication → **Sign-in method**: *Email/Password* ve *Anonymous* açık | İkisi de **Enabled** |
| 0.9 | Yeni admin parolasını **çevrimdışı** belirleyin: **en az 12 karakter**, kurumsal parola kasasında saklayın. Başına `0` **eklenmez** (o kural yalnız eski 5 haneli kod içindir) | Kasada kayıtlı |
| 0.10 | CLI erişimi: `npx firebase login` → `npx firebase use medipol-inventory-v3` | `Now using project medipol-inventory-v3` |
| 0.11 | Personele kısa duyuru: "HH:MM'de 15 dk bakım; açık sekmeleri o saatten sonra yenileyin" | — |

### 0.12 — Prova (önerilir, canlıya dokunmaz)
Firebase Hosting'in **önizleme kanalı**, gerçek Hosting başlıklarını (CSP, SRI) gerçek alan adında denemenizi sağlar. Kanal adında `demo` geçtiği için uygulama **`inventory_demo`** köküne bağlanır (adı `demo` içeren alan adı → demo kökü). Kurallar proje genelidir ve bu adımda değişmez: yeni istemci eski kurallarla çalışır, testlerde sınanan kombinasyon budur.

```bash
npx firebase hosting:channel:deploy demo-faz4a --expires 1d
# çıktıdaki URL: https://medipol-inventory-v3--demo-faz4a-<rastgele>.web.app
```

URL'de:
1. F12 → Konsol'da `ACTIVE DATABASE ROOT: inventory_demo` yazmalı.
2. Kırmızı `Refused to …` / `Content Security Policy` satırı olmamalı.
3. Personel girişi ve talep ekranı açılmalı.

Sorun varsa canlı deploy'a **geçmeyin**. Kanal bir gün sonra kendiliğinden silinir.

---

## Adım 1 — DB snapshot (VIP)

1. **Canlı** siteyi açın, admin olarak girin → **Sistem Kontrol (VIP)** sekmesi → **Sistem Aksiyonları** kartı → **"1-Tık DB Snapshot"**.
2. İnen `ITSM_Backup_YYYY-AA-GG.json` dosyasını çevrimdışı bir konuma kopyalayın (USB / kurumsal arşiv). Dosya canlı veridir: e-postayla paylaşmayın.
3. Dosyanın dolu olduğunu doğrulayın (proje klasöründe):
   ```bash
   node -e "const d=require(process.argv[1]);for(const[k,v] of Object.entries(d))if(Array.isArray(v))console.log(k.padEnd(16),v.length)" ./ITSM_Backup_YYYY-AA-GG.json
   ```
   Beklenen: `b1`, `b2`, `b3`, `personel`, `requests`, `purchaseOrders`… koleksiyonları, bugünkü canlı sayılarla. Bu sayıları teyit cümlesi (§7) için not edin.

**Durma kriteri:** dosya inmiyor veya koleksiyonlar boş → deploy'a geçmeyin.

Spark planında Firestore'un yönetilen dışa aktarımı (gcloud export) yoktur; bu yüzden snapshot uygulamanın kendi yedeğidir.

---

## Adım 2 — Tek komutla yayın (M16)

```bash
git log -1 --oneline                                   # merge commit'i (Adım 0.1)
node scratch/hosting-files.js                          # ✔ (son kontrol)
npx firebase deploy --only firestore:rules,hosting
```

Beklenen çıktı:
- `cloud.firestore: rules file firestore.rules compiled successfully`
- `firestore: released rules firestore.rules to cloud.firestore`
- `hosting[medipol-inventory-v3]: found 47 files in .`
- `release complete`
- `✔  Deploy complete!`
- `Hosting URL: …`

| Durum | Ne yapılır |
|---|---|
| Kurallar derlenmiyor | Hiçbir şey yayınlanmaz. **Durun**, çıktıyı ajana iletin |
| Kurallar yayınlandı ama hosting yüklemesi koptu (ağ) | Aynı komutu **hemen bir kez daha** çalıştırın. Yine olmazsa Adım 5'teki geri alma (önce kurallar) |
| `found N files`, N ≠ 47 | Adım 0.6'yı atladınız; yayın tamamlandıysa listeyi kontrol edin, fazladan dosya varsa ignore'a ekleyip yeniden deploy edin |

Saati not edin (teyit cümlesi).

---

## Adım 3 — Admin parolasını hemen ≥12 karaktere döndürün (M17)

1. Firebase Console → **Build → Authentication → Users** → `admin@medipol.local` → **⋮** → **"Edit / Şifreyi değiştir"**.
   **"Reset password" değil:** o e-posta gönderir ve `.local` alan adına e-posta ulaşmaz (Faz 0 · 0.2a ile aynı yol).
2. Adım 0.9'daki **≥12 karakterli** parolayı olduğu gibi yazın → Kaydet.
3. Canlı sitede doğrulayın:
   - **Yönetici Paneli → yeni parola** → admin.html açılmalı.
   - **Eski 5 haneli kod** → reddedilmeli ("Admin yetkisi yok").
   - 6-11 karakterli bir deneme → ağa gitmeden "en az 12 karakter" uyarısı.
4. Başka bir cihazda açık eski admin oturumu varsa kapatın. Kuşkuluysanız Console'da kullanıcıyı **Disable** → hemen **Enable** edin; bu tüm oturumları düşürür.

**Durma kriteri:** yeni parolayla giriş olmuyor. Önce yazımı kontrol edin; olmuyorsa Console'da parolayı tekrar ayarlayın. Hâlâ olmuyorsa Adım 5.

---

## Adım 4 — 5 dakikalık canlı doğrulama

Tarayıcı: Chrome, gizli pencere (önbellek ve eski oturum taşımaz). F12 açık.

| # | Kontrol | Beklenen |
|---|---|---|
| 4.1 | Canlı adres açılır; Konsol'da `ACTIVE DATABASE ROOT: lifeserver_master`; "✅ Sistem Hazır" | Veri geliyor |
| 4.2 | **CSP:** F12 → **Console**'da kırmızı `Refused to load / connect …` veya `Content Security Policy` satırı **yok**. F12 → **Network** → `index.html` → Response Headers: `content-security-policy`, `x-frame-options: DENY`, `x-content-type-options: nosniff` var | Uyarı yok, başlıklar var |
| 4.3 | **SRI:** Konsol'da `Failed to find a valid digest in the 'integrity' attribute` **yok**; ikonlar (Font Awesome) görünüyor | — |
| 4.4 | **Personel:** gerçek bir personel koduyla giriş → yeni talep. Ürün adı `DEPLOY-TEST GG.AA` olsun | Talep listede |
| 4.5 | **Kod girmeden silme reddi:** "Çıkış Yap" → giriş ekranındayken F12 Console'a yapıştırın (yalnız test talebini hedefler; aşağıdaki kod bloğu) | `permission-denied`. **"SİLİNDİ" görürseniz kurallar yayınlanmamıştır → Adım 5** |
| 4.6 | **Admin:** yeni parola ile giriş → Talepler → `DEPLOY-TEST` talebini **Reddet**, sonra **Sil** | İkisi de çalışır (admin yazma + silme) |
| 4.7 | admin.html üst çubuk → **Güvenlik Raporu** (kalkan) açılır | Liste (boş olabilir) yükleniyor |
| 4.8 | **Paylaşılan bilgisayar:** tarayıcıyı **tamamen** kapatın, açın → doğrudan `…/admin.html` | Kilit kartı ("Yönetici Girişi Gerekli"; vize de dolmuşsa "Oturum Süresi Doldu") ya da index'e yönlendirme — **panel açılmaz**; index personel girişi ister |
| 4.9 | (Varsa) ikinci cihazda personel girişi; admin'in değiştirdiği bir kayıt diğer ekranda kendiliğinden güncellenir | Canlı akış |

Adım 4.5 için Konsol'a yapıştırılacak kod:

```js
const fs = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
const t = (window.data.requests || []).find(r => String(r.ürün).startsWith('DEPLOY-TEST'));
await fs.deleteDoc(fs.doc(window.fireDb, window.COLLECTION_ROOT, 'requests', 'items', String(t.id))).then(() => 'SİLİNDİ — KURAL YOK!', e => e.code);
```

**Bir saat sonra:** sekmeyi açık bıraktığınız oturumda Konsol'a tekrar bakın. Firebase oturum yenilemesi (`securetoken.googleapis.com`) bir CSP uyarısı üretmemeli.

**Geri alma kriterleri:** 4.1, 4.4 veya 4.6'dan biri başarısız; ya da CSP/SRI uyarısı bir özelliği bozuyor. Bunlardan biri varsa ve 2 dakikada çözülemiyorsa → **Adım 5**.

Tek başına "4.5'te SİLİNDİ" görürseniz yalnız kuralları yeniden yayınlamayı deneyin: `npx firebase deploy --only firestore:rules`.

---

## Adım 5 — Geri alma (rollback) — ikisi birlikte, sırası önemli

| Sıra | İş | Neden bu sırada |
|---|---|---|
| 1 | **Kurallar:** Console → Firestore Database → **Rules** → sürüm geçmişi → deploy öncesi sürüm (tarih/saat) → geri yükle / **Publish** | Eski kurallar hem eski hem yeni istemciyle çalışır: site bu arada da çalışır |
| 2 | **Hosting:** Console → Hosting → **Release history** → deploy öncesi sürüm → **⋮ → Rollback** | Eski istemci geri gelir |
| 3 | **Parola:** eski arayüz en fazla 5 karakter alır → Console'da admin parolasını tekrar **`0` + 5 haneli kod** biçimine getirin (Faz 0 · 0.2a yöntemi) | Yapılmazsa admin dışarıda kalır (T14) |
| 4 | Gizli pencerede 4.1 + personel girişi + admin girişi | Eski davranış |
| 5 | Ajana belirtileri iletin: hangi adım, Konsol'daki hata metni (parola/token olmadan) | Düzeltme turu planlanır |

Veri bozulduğundan şüpheleniyorsanız (beklenmez; Faz 4A veri şemasını değiştirmez), Adım 1'deki yedek **ajanla birlikte** ve önizlemeli geri yüklenir. Kendiniz toplu geri yükleme yapmayın.

---

## Adım 6 — Kapanış ve sonraki hafta

- Ajana §7'deki teyidi iletin.
- **1 hafta saha gözlemi.** Bakılacaklar:
  - kullanıcıların "Veri bağlantısı yetkisi yok" bandı görüp görmediği;
  - personelin "Bu işlem için yönetici yetkisi gerekir" mesajına takıldığı akışlar;
  - Güvenlik Raporu kayıtları;
  - Konsol'da CSP uyarısı.
- **Faz 4 kapanış hotfix'i (ajan):**
  - parolanın döndürüldüğü teyit edildikten sonra `security.js`'teki 5 haneli geçiş dalı kaldırılır (M11'in son adımı);
  - aynı turda `.firebaserc`/Console notları güncellenir.
- Ardından **Faz 4B** (personel başına Auth hesabı) ayrıntılı planı.

---

## 7. Teyit cümlesi (ajana yalnız bu iletilir)

```
DEPLOY 4A: Snapshot alındı (<dosya adı>; b1=<n>, b2=<n>, b3=<n>, requests=<n>, purchaseOrders=<n>, personel=<n>).
Deploy tamam (<GG.AA.YYYY SS:DD>, 47 dosya). Admin parolası ≥12 karaktere döndürüldü; eski kod reddedildi.
Doğrulama 4.1–4.9: <✔/✖ listesi>. Konsolda CSP/SRI uyarısı: <yok/var: metin>. Geri alma: <gerekmedi/yapıldı>.
Operatör: <ad soyad / rol>
```
