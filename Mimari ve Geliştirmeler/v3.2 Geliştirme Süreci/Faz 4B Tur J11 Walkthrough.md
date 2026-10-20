# Faz 4B Tur J11 Walkthrough — Teslim ve Denetim Raporu

> **Okuyucu:** proje sahibi ve bağımsız denetçi. Bu dosya J11'in **teslim raporudur** (madde 9). Ayrıntılı tasarım notları,
> geri çekilen sonuçlar ve Faz 2 devir notu [Faz 4B Mega Fix Walkthrough](Faz%204B%20Mega%20Fix%20Walkthrough.md)'tadır.
> Bu rapordaki her sayı, aşağıda kimliği verilen kod üzerinde gerçekten koşulan bir testten gelir. Koşulmayan bir test geçti
> olarak yazılmamıştır.

## 0. Test edilen kod

| | |
|---|---|
| Dal | `feat/phase-4b-identity-model` |
| Taban commit | `d35c919e318e1237d566c2529e25ab4f9c11d351` (J10 · "enterprise PRI identity model…") |
| **Son test edilen commit (J11.5)** | **`6958aa352813025e6476b4ede6d5f976c021d831`**: J11'in üstünde, bağımsız denetimin 3 zero-trust bulgusunun düzeltmesi. Ayrıntı ve sonuçlar **§11**'de. Push / merge / deploy yapılmadı. |
| **Test edilen J11 commit'i** | **`06afc6f53da260bdc829e04b8b709c68fb2d706e`** — yalnız bu dalda, yerel commit. Push, merge ve deploy **yapılmadı**; üçü de proje sahibinin onayını bekliyor (madde 10). Testler commit'ten hemen önce aynı çalışma ağacında koşuldu; commit'ten sonra J11 dosyalarında çalışma ağacıyla fark kalmadığı `git diff HEAD` ile doğrulandı. Bu rapor ve Mega Fix dosyası ayrı bir belge commit'iyle eklendi. |
| Test tarihi | 20.10.2026, yerel makine (Windows 11), Firebase Emulator (Firestore + Auth) |
| Gerçek ortam | **Dokunulmadı.** Canlı (`lifeserver_master`) ve demo (`inventory_demo`) projelerine hiçbir test yazmadı. Deploy ya da göç yapılmadı. |

**J11'in değiştirdiği dosyalar** (`git diff d35c919 06afc6f --stat`: 19 dosya; raporlar ayrı belge commit'inde):

| Dosya | J11 değişikliği |
|---|---|
| `firestore.rules` | P0 kilidi ve kanıt şeması; P1 #5 ve #7 kimlik / olay bütünlüğü; P1 #6 istisnasının kaldırılması |
| `src/services/firebase-handler.js` | Kilit API'si ve dinleyicisi; transaction'lı hesap bağlama; iki aşamalı kod temizliği |
| `src/services/staff-provisioning.js` | Hata türleri; taşıma kurtarması (`move-resumed`); `createFirestoreLinker` |
| `src/utils/ownership.js` | Kapanış denetimi; sahiplik sorunu sınıflandırma; yeni `planCodeCleanse`; `selfName` |
| `src/modules/auth-engine.js` | Girişten sonra kilit okuması ve kapalı mesajı |
| `src/modules/admin/admin-system-control.js` | VIP Personel Erişim Kilidi aracı; kod temizliği engelleri ve gerçek sonuca göre başlık |
| `admin.html` | VIP kilit düğmesi |
| `src/modules/edm-workflow.js` | Aktör adı `selfName`; onay / red kayıtlarında `uid` |
| `src/services/purchase-servises.js`, `src/modules/inventory-logic.js`, `todo-module.js` | Görünen kimlik `selfName` |
| `scratch/flow-tests.js`, `scratch/emu-seed.mjs` | Emülatör temizliği, gerçek kimlikle yazma, `j11ApprovalAudit`; açık kilit tohumu |
| `tests/rules/rules.test.mjs`, `tests/unit/ownership.test.mjs`, `tests/unit/staff-provisioning.test.mjs`, `tests/integration/ownership.emu.test.mjs`, `tests/integration/staff-provisioning.emu.test.mjs` | Yeni ve güncellenen testler |
| **Yeni:** `Faz 4B Mega Fix Walkthrough.md`, bu dosya, `scratch/_budget.sh` | Rapor ve ifade bütçesi ölçüm aracı |

**J11'e ait olmayan çalışma ağacı değişiklikleri:** Aşağıdakiler J11 başlamadan önce de çalışma ağacında değişmiş ya da
silinmiş durumdaydı. J11 bunlara dokunmadı ve **commit'e alınmadı**; çalışma ağacında olduğu gibi duruyorlar. Ne yapılacağına
sahip karar vermeli.
- `style.css`, `admin-add-style.css`
- `.github/agents/*.agent.md` (3 dosya, silinmiş)
- `.github/instructions/Global_Architecture_Rules.instructions.md` (silinmiş)
- `Mimari ve Geliştirmeler/Proje Vision_ UniversalDB Logic State`
- `scratch/flow-emu.out` (eski bir test çıktısı)

---

## 1. Bulgular, kök nedenler ve cerrahi değişiklikler

### P0 · Göç sırasında personel veri sızıntısı penceresi

- **Kök neden:** J10 kurallarında (`allow read: … member(root)`) bağlı her personel bütün personel kayıtlarını okuyabiliyordu.
  Kod temizliği bitene kadar bu kayıtlarda düz metin `code` alanı da vardı. Kod + `"Mdp!"`, Firebase Auth parolasıdır; yani
  bu okuma, başka bir personelin hesabını ele geçirmek anlamına geliyordu. Göçün bitip bitmediğini gösteren bir durum yoktu;
  kurallar da koleksiyonu tarayıp "temizlik bitti mi" diye bakamaz.
- **Değişiklik:**
  - `firestore.rules`: `isStaff(root) = staffAccessOpen(root) && staffIdentity(root)`. Kilit `${root}/accessGate/items/staff`
    belgesindedir ve yalnız `staffAccessEnabled === true` (bool) iken açıktır; belge yoksa kapalıdır. Kanıt şeması
    `gateBaseOk` / `closureOk` / `gateWriteOk` fonksiyonlarındadır.
  - Personelin her yolu `isStaff` ya da `member` üzerinden geçer: okuma, liste, yazma, silme ve denetim günlüğü.
  - İstemci: `readStaffAccessGate`, `verifyStaffAccessClosure`, `openStaffAccess`, `closeStaffAccess`, kilit dinleyicisi ve
    `revokeStaffAccess` (`firebase-handler.js`); girişten sonra kilit okuması (`auth-engine.js` `completeStaffLogin`); VIP
    aracı (`vipStaffAccessGate`).
  - Kapanış denetimi: `Ownership.planStaffAccessClosure`, sekiz sayaç.
- **Korunanlar:** Zero-lookup giriş (girişten önce veritabanı okunmaz), PRI `ad.soyad` kimliği, 5 karakterlik kod + `"Mdp!"`
  yöntemi. Yönetici kilitten etkilenmez.

### P1 · J7 hesap taşıma kurtarması ve idempotency

- **Kök neden:**
  - `moveLegacyAccount` her denemede **eski** adresle giriş yapıyordu. Auth tarafında taşıma tamamlanıp Firestore bağı
    düştüğünde, ikinci koşu "parola eşleşmiyor" çakışmasına düşüyordu ve hesap bir daha bağlanamıyordu.
  - Bağlama iki ayrı yazmaydı; ikincisi düşerse yarım bağ kalıyordu.
  - Hata türleri ayrılmıyordu; ağ koptuğunda toplu iş durmuyordu.
- **Değişiklik** (`staff-provisioning.js`):
  - `errorKind` hataları türlere ayırır.
  - `moveLegacyAccount` kurtarma yolu: eski adres kabul etmezse PRI adresiyle **yalnız giriş** denenir. Bulunan uid personel
    kaydındakiyle birebir aynıysa bağ tamamlanır (`move-resumed`); aynı değilse hiçbir şey yazılmaz (`conflict`).
  - `createFirestoreLinker`: eşleme ve personel bağı tek transaction'dır. Ön koşullar transaction içinde taze okunur. Kayıt
    başka bir uid'ye bağlıysa ya da eşleme başka bir personeli gösteriyorsa hiçbir şey yazılmaz.
  - `applyAccounts` ağ, kota ya da yetki hatasında durur.

### P1 #4 · Sahiplik göçü ve kod temizliği sırası

- **Kök neden:** `personel.code`, `purchaseOrders.createdBy` dönüşümünden **önce** siliniyordu. Ara bir batch düşerse yeniden
  çalıştırma kodu bilemiyordu ve çözülebilir sahiplik kalıcı olarak `'unknown'` oluyordu. Ayrıca `ready` kontrolü çözülemeyen
  sahiplik kayıtlarını görmüyordu ve yazma hepsi-ya-da-hiçbiri değildi.
- **Değişiklik:**
  - `Ownership.classifyOwnershipIssues`, `planCodeCleanse` (engeller, otomatik `'unknown'` yok, koddan bağımsız fingerprint),
    `codeCleanseSteps`, `deleteCodesForward`.
  - `firebase-handler.applyCodeCleanse`, iki aşamalı:
    1. Sunucudan taze okuma ve fingerprint denetimi.
    2. Geri alınabilir dönüşümler, mevcut **AtomicWriter** ile hepsi-ya-da-hiçbiri.
    3. `personel.code` silme **en son**, ileri yönlü ve idempotent.

### P1 #5 · Onay adımı ve denetim geçmişi bütünlüğü

- **Kök neden:** `appendOnly` yalnız eski kayıtların korunduğunu denetliyordu. Sırası gelen onaylayıcı:
  - istediği sayıda sahte kayıt ekleyebiliyordu (Tur 2'de kapatıldı);
  - kayda başkasının adını yazabiliyordu (Tur 3'te kapatıldı);
  - kayıt sayısı doğru ama içeriği sahte bir olay yazabiliyordu (bağımsız denetim bulgusu; **Tur 4'te kapatıldı**);
  - `currentStep`'in geride kaldığı bozuk bir kayıtta verilmiş bir kararın üzerine yazabiliyordu (**Tur 4'te kapatıldı**).
- **Değişiklik** (`poApprovalOk`, `poRejectAkisOk`):
  - Eski adım `pending` olmalı.
  - Eklenen kayıt sayısı birebir: onayda +1 history +1 akış, redde +1 history +3 akış.
  - Aktör adı `staffName`'e bağlı.
  - Yeni history kaydı `action == 'transition'` ve `uid == request.auth.uid` taşımalı. Onayda `to != 'cancelled'`; redde
    `to == 'cancelled'` ve `note == 'Reddedildi: ' + gerekçe`.
  - Akış kayıtları `edm-workflow.js`'in ürettiği sırada olmalı ve olay türleri `islem` önekleriyle denetlenir. Her kayıt
    `uid` taşır; gerekçe her kayıtta adımın `note` alanıyla aynıdır ve boş olamaz.
  - Onayda adımın notu değişmez; redde `currentState == 'cancelled'` olmalı.
  - İstemci (`edm-workflow.js`) `transitionWorkflowState` kaydına ve onay / red akış kayıtlarına `uid` yazar.
- **Ek `get()` yok.** `uid` yalnız `request.auth.uid` ile karşılaştırılır; ad, `isStaff`'ın zaten okuduğu iki belgeden gelir.

### P1 #6 · Demo test silme istisnası

- **Kök neden:** `inventory_demo`'da bağlı her personel, metin alanında `__flowtest__` geçen **her** belgeyi silebiliyordu.
  İşaret personelin kendi yazdığı alanlarda aranıyordu; bakım modu da denetlenmiyordu. Zimmet ve servis kayıtları da bu
  yolla silinebiliyordu.
- **Değişiklik:** Kural ve `isTestDoc` / `marked` fonksiyonları kaldırıldı. Test temizliği yalnız emülatörde, Node tarafında
  ve kuralları atlayan yönetim erişimiyle yapılır (`flow-tests` `cleanupMarked`).

### P1 #7 · Talep sahibi ve workflow katılımcı kimliği

- **Kök neden:** Kurallar yalnız sahiplik uid'sini doğruluyordu. Görünen kimlik alanları istemcinin yazdığı gibi kabul
  ediliyordu: `personel`, `personelId`, `talepEden`, `createdByName`, `createdBy`, `creatorId`, adım `user`, `actor`,
  `yapan`.
- **Değişiklik:**
  - `staffPid` / `staffName` eklendi; bunları `requestCreateOk`, `poCreateOk`, `poDraftOk`, `poWithdrawOk`, `poApprovalOk`
    ve görev kuralları kullanır.
  - İstemci bu alanları `Ownership.selfName()`'den yazar. Birim testi, istemci fonksiyonunun kural metniyle eşdeğerliğini
    denetler.

### P1 #8 · Kalite kapısı

Bütün regresyon paketleri emülatörde koşuldu (bkz. §3). Beklentiler gevşetilmedi:
- Akış testlerinde sahte görünen kimlikle yazan 5 senaryo, gerçek kimlikle yazacak şekilde düzeltildi.
- Gerçek istemci ile gerçek kuralların onay / red uyumunu doğrulayan `j11ApprovalAudit` senaryosu eklendi.

---

## 2. Önce başarısız, sonra geçer

Aynı (güncel) test dosyaları iki kod sürümüne karşı koşuldu: **taban commit `d35c919`** (J11 öncesi) ve **J11 çalışma
ağacı**. Taban sürümü `git archive` ile ayrı bir klasöre çıkarıldı; güncel testler oraya kopyalandı.

| Paket | Taban `d35c919` (önce) | J11 (sonra) | Nasıl okunmalı |
|---|---|---|---|
| Rules (`npm run test:rules`) | **153/189 — 36 başarısız** | **189/189** | **Temiz davranış kanıtı.** Yalnız kural dosyası farklı, testler aynı. Başarısızlıklar aşağıdaki tabloda. |
| Unit (`npm run test:unit`) | **93/110 — 17 başarısız** | **110/110** | Başarısızların hepsi J11 testleri: P1 hesap taşıma / `errorKind` / `createFirestoreLinker`, P1 #4 `planCodeCleanse`, P0 kapanış denetimi, `selfName`. Bir kısmı tabanda olmayan fonksiyonu çağırdığı için düşüyor. |
| Auth + Firestore emülatörü (`test:staff:emu`) | 1/15 | **15/15** | **Davranış kanıtı sayılmaz.** Ortak test düzeneği J11'in `createFirestoreLinker`'ını kullandığı için (8 kez "is not a function"), J10'un kendi testleri de tabanda düşüyor. |
| Firestore emülatörü (`test:ownership:emu`) | 7/16 | **16/16** | **Tek başına davranış kanıtı sayılmaz.** 9 başarısızın hepsi J11 testi (2 P0, 7 P1 #4). Bir kısmı tabanda olmayan `codeCleanseSteps` / `planStaffAccessClosure` fonksiyonlarını çağırıyor (`TypeError`). J10'dan kalan 7 test tabanda da geçiyor. |

Rules başarısızlıklarının dağılımı (taban kurallar, güncel testler):

| Blok | Tabanda başarısız | Gösterdiği |
|---|---|---|
| P0 · varsayılan kapalı | 11 / 11 | Kilit yok, `false`, yanlış tip ya da başka kökte açıkken personel okuyup yazabiliyordu; göç yarıdayken kodlu kayıt okunabiliyordu. |
| P0 · kilit kapalıyken yönetici / açma-kapatma | 1 + 3 | Kilit belgesi ve kanıt şeması tabanda yok. |
| P1 #5 · kayıt sayısı (Tur 2) | 3 | Sahte **ek** history / akış kaydı kabul ediliyordu. |
| P1 #5 · aynı sayıda farklı içerik (Tur 4) | 6 | Bkz. aşağıdaki Tur 3 karşılaştırması. |
| P1 #6 · demo silme istisnası | 3 | Personel işaretli belgeyi, kendi işaretlediği talebi ve bakım modunda bile siliyordu. |
| P1 #7 · görünen kimlik | 9 | Başkası adına talep / satın alma, sahte onaylayıcı, sahte aktör, oluşturan adını değiştirme kabul ediliyordu. |

Akış (E2E) testi tabana karşı koşulmadı. Taban istemci ile güncel senaryolar uyumsuz; örneğin `j11ApprovalAudit` taban
istemcide olmayan `uid` alanlarını bekler. Bu yüzden önce / sonra karşılaştırması rules ve birim düzeyinde yapıldı.

**Tur 4 için ayrıca:** Yeni "aynı sayıda farklı içerik" rules bloğu, **Tur 3 kurallarına** karşı koşuldu. Bunun için yalnız
`poApprovalOk` gövdesi Tur 3 hâline döndürüldü. Sonuç: 6 test başarısız oldu, aynı testler J11 kurallarıyla geçti.
- Tur 3'te başarısız olan testler:
  - eski adım `pending` değil;
  - onay history türü / uid / aktör / `to`;
  - onay akış türü / uid / aktör;
  - onayda adım notu;
  - red akış sırası / türü / gerekçesi / uid'si;
  - red history ve durum, boş gerekçe.
- "Eski kayıtların tarihi / aktörü / içeriği değiştirilemez" testi Tur 3'te de geçiyordu. Bu durum zaten `appendOnly` ile
  kapalıydı; test regresyon için eklendi ve "Tur 4'te kapatıldı" diye sayılmadı.

---

## 3. Test sonuçları (J11 çalışma ağacı, 20.10.2026)

| Paket | Komut | Sonuç |
|---|---|---|
| Unit | `npm run test:unit` | **110/110** |
| Rules | `npm run test:rules` | **189/189** |
| Auth + Firestore emülatörü | `npm run test:staff:emu` | **15/15** |
| Sahiplik / kod temizliği emülatörü | `npm run test:ownership:emu` | **16/16** |
| AtomicWriter emülatörü | `npm run test:atomic:emu` | **5/5** |
| E2E (Puppeteer + emülatör) | `npm run emu:seed` → `node scratch/flow-tests.js --emu` | **55/55**, 0 CSP ihlali, 0 sayfa hatası, test sonu temizlik 1 kayıt |
| XSS | `npm run lint:xss` | 46 dosya · 193 sink · **0 izinsiz** (15 izinli) |
| Hosting | `node scratch/hosting-files.js` | **55/55** dosya, yalnız uygulama dosyaları |

**E2E notu (gizlenmedi).** Tam paket iki kez koşuldu:
1. **İlk koşu: 53/55.** Bu koşu, aynı emülatörde önceki tam koşudan sonra **yeniden tohumlamadan** yapıldı.
   - `j10CodeCleanse` açık mesajla durdu: "emülatörde temizlenecek kod yok — kodlar önceki bir koşuda silinmiş".
   - `j7StaffProvisioning`'in `loginUidMatches` denetimi `false` döndü. Bu denetim, kodu duran bir personel kaydı arar
     (`flow-tests.js` 4167. satır, `p.uid && staffPassword(p.code)`). Önceki koşunun kod temizliğinden sonra böyle kayıt
     kalmadığı için `false` döner.
2. **Doğrulama koşusu: 55/55.** Neden ortam dışı sayılmadan önce doğrulandı: emülatör süreçleri durduruldu, emülatör temiz
   başlatıldı, `npm run emu:seed` çalıştırıldı ve paket **hiçbir kod değişikliği yapılmadan** yeniden koşuldu.

Kural: tam E2E paketi her koşudan önce temiz emülatör + tohum ister (`j10CodeCleanse` kodları siler).

**İfade bütçesi (1000 ifade sınırı).** Ölçüm `scratch/_budget.sh` ile yapıldı. Pay, `isStaff`'a eklenebilen `&& request.time
!= null` sayısıdır.

| İstek | Pay |
|---|---|
| 10 adımlı akış başlatma | 3–5 (Tur 3 ile aynı) |
| 10. adımın onayı | 12'den fazla |
| 10. adımın reddi | 6–8 |

Onayın maliyeti adım sayısına neredeyse bağlı değil: Tur 3 kurallarında 2 adımlı onayın payı da 10–11 idi. Tur 4'ün
denetimleri bu bütçeye `textOk` onay dalından çıkarılarak sığdırıldı. Onaylayıcı `textOk`'un baktığı hiçbir alanı
değiştiremez (`affectedKeys().hasOnly(['workflow','durum','akis'])`).

---

## 4. İstenen üç kanıt

**4.1 P0 varsayılan kapalı.**
- Rules — `KİLİT DOKÜMANI YOK (deploy sonrası ilk an): hiçbir personel hiçbir yolu kullanamaz — canlı ve demo`.
- Rules — kilit `false`, yanlış tip (`"true"`, `1`, `null`, harita) ya da eksik alan: personel kapalı.
- Rules — kilit başka kökte açık: bu kökte kapalı (kök başına kilit).
- Rules — `GÖÇ YARIDA (kodlar personel kaydında duruyor): personel kodlu kaydı da listeyi de okuyamaz`.
- Gerçek Auth + Firestore emülatörü — `J11 · P0: kilit yok (deploy sonrası varsayılan) → personel PRI + kodla giriş yapar ama
  HİÇBİR ŞEY okuyamaz/yazamaz; yalnız kilit durumunu okur`.
- Kilit kapalıyken yönetici göçü yapar: `J11 · P0 — kilit kapalıyken yönetici göçü yapar` bloğu (PRI / hesap göçü, sahiplik
  göçü, kod temizliği, bakım modu).
- Kilit yalnız doğrulanmış kapanışla açılır:
  - kanıtsız açılamaz;
  - sekiz sayaçtan herhangi biri 1 ise açılamaz;
  - eksik / fazla anahtar, istemci saati, başkası adına imza ya da yanlış sürüm reddedilir;
  - personel kilidi açamaz.
- Emülatör — `J11 · P0: göçün üç adımı bitince kapanış doğrulanır → kilit kanıtla açılır → personel okur; geri gelen tek kod
  denetimi yeniden kapatır`.
- Repoda kilidi kendiliğinden açan bir yol yoktur. Tek istisna `scratch/emu-seed.mjs`'tir ve yalnız emülatöre yazar.

**4.2 Yanlış UID'ye bağlama reddedilir.**
- Emülatör — `J11 · P1: kurtarmada PRI adresindeki hesap BAŞKA uid → conflict; personel kaydı ve eşlemeler değişmez, yeni
  hesap açılmaz`.
- Emülatör — `J11 · P1: bağlayıcı, başka personele eşlenmiş uid'yi ikinci bir personele bağlamaz (transaction içi denetim)`.
- Unit — `createFirestoreLinker: kayıt başka uid'ye bağlıysa / eşleme başka personeli gösteriyorsa / kayıt yoksa hiçbir şey
  yazılmaz`.
- Unit — `P1: kurtarmada PRI adresindeki hesabın uid'si personeldekiyle aynı değilse HİÇBİR bağ yazılmaz (conflict)`.
- Emülatör — `PRI addan tahmin edilip hesap önceden açılmışsa → conflict; o hesap hiçbir şey okuyamaz ve kendini
  eşleyemez`.

**4.3 Kısmi batch sonrası yeniden çalıştırma veri kaybetmez.**
- Hesap göçü — `J11 · P1 KABUL: J7 taşıması Auth tarafında tamamlanıp Firestore bağı REDDEDİLİNCE ikinci koşu aynı uid ile
  tamamlar (move-resumed)` (emülatör). Unit testinde ağ kopması ve yetki reddi senaryoları da var.
- Sahiplik göçü — `emülatör: kısmi hata (2. parça düşer) gizlenmez; yazılanlar kalıcı, kalanlar yazılmadı; yeniden koşu
  tamamlar`.
- Kod temizliği, aşama 1 — "commit gönderilmeden" ve "commit uygulanıp yanıt kaybolunca" ayrı ayrı test edildi. İkinci
  dönüşüm parçası düşerse hepsi geri alınır ve kodlar silinmez. Yeniden çalıştırma `createdBy`'ı doğru kişinin id'sine çözer;
  sonuç `'unknown'` olmaz. Üçüncü koşuda yapılacak iş yoktur.
- Kod temizliği, aşama 2 — kod silme yarıda kalırsa dönüşümler kalıcı ve doğru kalır. İlerleme gerçek değeriyle raporlanır;
  yeniden çalıştırma kalan kodları siler.
- Eski hatanın bıraktığı yarım durum otomatik `'unknown'` yapılmaz; engel olarak raporlanır ve hiçbir şey yazılmaz.

---

## 5. Güvenli göç sırası, kilit ve kilidin açılma koşulları

**Kilit modeli:**
- **Varsayılan kapalı.** Kural yayına girdiği anda kilit belgesi yoksa personel erişimi kapalıdır. Bu yüzden kilidin
  devrede olmadığı bir geçiş penceresi oluşmaz.
- **Açma** yalnız yönetici tarafından, VIP → Personel Erişim Kilidi → "Erişimi Aç" ile yapılır. Bu işlem:
  - kapanış denetimini sunucudan yeniden okuyarak çalıştırır;
  - sekiz sayacın hepsi 0 değilse yazmaz;
  - yarım kalmış bir toplu yazma kilidi varsa reddeder.
- **Kurallar da kanıtı ister:** sekiz anahtar, hepsi 0; `changedAt == request.time`; `changedBy == auth.uid`; `version == 1`.
- **Sekiz sayaç:** `personelCodes`, `requestCodes`, `purchaseOrderCodes`, `accountsMissing`, `accountsInconsistent`,
  `accountMapMismatch`, `ownershipPending`, `ownershipUnresolved`.
- **Kapatma** her zaman serbesttir ve kanıt istemez; belgeyi silmek kapatma sayılır. Açık personel oturumları dinleyiciyle
  kesilir.

**Sıra** (her adım kök başına: `lifeserver_master` ve `inventory_demo` ayrı ayrı):

0. **Deploy öncesi:** İki kökte de `accessGate/items/staff` belgesi **olmamalı**. Varsa silinir.
1. Personele kesinti duyurulur.
2. **Deploy:** Kurallar ve istemci aynı anda yayınlanır. Bu adım sahibin onayıyla, Faz 4A Deploy Runbook'a göre yapılır.
3. **Doğrulama:** VIP aracında "KAPALI (kilit kaydı yok — varsayılan)" görülmeli. Test personeli kapalı mesajını almalı.
4. **Göç** (kilit kapalı kalır): PRI / Hesap Göç Aracı → Sahiplik Göç Aracı → Kod Temizliği. Kod Temizliği, sahiplik
   sorunları çözülmeden çalışmaz.
5. **Kapanış:** Sekiz sayaç 0 → "Erişimi Aç".
6. **Duman testi:** Bir personel girer, okur, talep açar, bir onay verir.

**Geri dönüş:** Kurallar J10'a ya da Aşama A'ya **geri alınmamalıdır**; bu, kilidi kaldırır. Acil durumda "Erişimi Kapat"
kullanılır.

---

## 6. Yarım kalan göç ve başarısız geri alma için yönetici kurtarması

| Durum | Ne olur | Yönetici ne yapar |
|---|---|---|
| PRI / Hesap göçü ağ, kota ya da yetki hatasıyla durdu | İş durur, satır türüyle raporlanır. Auth tarafında tamamlanmış taşıma kaybolmaz. | Aracı yeniden çalıştırır. Yarım taşınmış hesap `move-resumed` ile aynı uid'ye bağlanır. |
| Hesap `conflict` / `uid-mismatch` | Hiçbir şey yazılmaz. | Kaydı elle inceler. Uid değiştirme ya da yeniden bağlama aracı **yok** (kasıtlı; parola sıfırlama da kapsam dışı — sahip kararı). |
| Sahiplik göçünün bir parçası düştü | Yazılanlar kalıcı ve doğrudur; kalanlar raporlanır. | Yeniden çalıştırır; yalnız boş alanlar yazılır. |
| Kod temizliği aşama 1 düştü | AtomicWriter yazılanları geri alır; veritabanı işlem öncesi hâlindedir. Sonuç "✗ hiçbir şey yazılmadı". | Yeniden çalıştırır. |
| Kod temizliği aşama 1'de **geri alma da** tamamlanamadı (`rollback-pending`) | Günlük ve toplu yazma kilidi (`restoreLock`) sunucuda kalır. İstemci veri katmanı kilitli koleksiyonlara (talepler, satın almalar) yazmayı ve yeni toplu işleri durdurur. Bu kilit kurallarda değil, istemcidedir. Başlık "⚠ Yarıda kaldı — kilitli". | Aynı yönetici sekmesi açık kalırsa kurtarma 30 sn sonra kendiliğinden denenir; sonraki her yönetici oturumunda da kilit görülünce denenir. Başarısız olursa 60 sn arayla tekrarlanır (`recoverBulkWrite` → `AtomicWriter.recover`). Kurtarma idempotenttir. Bittikten sonra Kod Temizliği yeniden çalıştırılır. |
| Kod temizliği aşama 2 (kod silme) yarıda kaldı | Dönüşümler kalıcı ve doğrudur, kalan kod sayısı raporlanır. Başlık "⚠ kısmen tamamlandı". | Yeniden çalıştırır; yalnız kalan kodlar silinir. |
| Önizlemeden sonra veri değişti | `changed-since-preview`, hiçbir şey yazılmaz. | Yeniden önizler. |
| J11 öncesi hatanın bıraktığı yarım durum | `purchaseOrderUnresolved` engeli. | İlgili `createdBy` değerini elle düzeltir. |

Bu adımların hiçbirinde kilit kendiliğinden açılmaz. Kapanış denetimi geçene kadar personel erişimi kapalı kalır.

---

## 7. Başarısızlık anında güvenli kalma

Hedef yalnız yeşil test değil; bir şey ters gittiğinde sistemin **kapalı ve tutarlı** kalması. Güvenlik kararı her zaman
**sunucudaki kurallardadır**. İstemci yalnız kullanıcı deneyimini ve kurtarmayı yönetir.

| Başarısızlık | Sonuç (güvenli taraf) | Kanıt |
|---|---|---|
| Kilit belgesi yok, alan eksik ya da yanlış tipte | Personel hiçbir şey okuyamaz, yazamaz | Rules: P0 varsayılan kapalı bloğu (11 test); emülatör: `kilit yok (deploy sonrası varsayılan)` |
| Girişte kilit okunamadı (ağ hatası, `unknown`) | İstemci girişi engellemez, ama veri gelmez: kural kilidi sunucuda değerlendirir; dinleyici reddi kilit belgesinden yorumlanır | `auth-engine.js` 515. satır (`unknown` dışındaki kapalı durumlar girişi keser); `firebase-handler.js` `readStaffAccessGate`, `_resolveStaffDenial` |
| Oturum açıkken kilit kapandı | Yeni okumalar sunucuda hemen reddedilir; istemci dinleyicisi oturumu keser ve belleği temizler | Emülatör: `kilit açıkken okuyan oturum, kilit kapanınca YENİ okumada hemen reddedilir` |
| Kural değerlendirme hatası (olmayan belgeye `get()`, dizin dışı erişim, 1000 ifade sınırı) | Firestore bunu **ret** sayar; hiçbir dal hatayla açılmaz | Firestore kural semantiği; 11 adımlı başlatma testi reddedilir; 10 adımlı başlatma / onay / red bütçe testleri geçer (§3) |
| Hesap göçünde ağ / kota / yetki hatası | Toplu iş durur, satır türüyle raporlanır; yarım taşınan hesap yeniden çalıştırmada aynı uid'ye bağlanır | Unit: `applyAccounts — ağ hatası … iş durur`, `… yetkiden reddedilince … iş DURUR`; emülatör: `move-resumed` |
| Bağlama sırasında yanlış uid / başka personele ait eşleme | Hiçbir şey yazılmaz (transaction içi taze okuma) | §4.2 |
| Bağlama transaction'ı commit edilemedi | Eşleme ve personel bağı birlikte yazılmaz; yeniden çalıştırma idempotent | Unit: `createFirestoreLinker: … commit düşerse ikisi de yazılmaz` |
| Toplu yazma ortasında sunucu reddi / bağlantı kopması / kaybolan yanıt | Yazılan parçalar geri alınır; geri alma yapılamazsa kilit kalır ve sonraki yönetici oturumu `recover` ile işlem öncesine döner | Atomic emülatör: 5 test (sunucu reddi, kaybolan yanıt, bağlantı kopması → kilitli → recover, yönetici olmayan oturum) |
| Kod temizliği yarıda kaldı | Aşama 1 hepsi-ya-da-hiçbiri; aşama 2 ileri yönlü; kod kaybı ya da `'unknown'` yok; kilit kendiliğinden açılmaz | §4.3; emülatör P1 #4 testleri |
| Önizlemeden sonra veri değişti (eşzamanlı yönetici) | Hiçbir şey yazılmaz (`changed-since-preview`) | Emülatör: fingerprint testi |
| Personel sahte onay / sahte kimlik / sahte olay yazmaya çalıştı | Kural reddeder; sunucu belgesi değişmez; istemci "başarılı" göstermez | Rules: P1 #5 / #7 blokları; E2E: `j11ApprovalAudit` (`forbidden`, sunucu değişmedi) |
| Reddedilen yazma sonrası yerel kopya | Yerel kopya sunucu hâline döner; başarı mesajı gösterilmez | E2E: `j10CodeCleanse` (`rewriteDenied`, `localRevertedAfterDenied`); `approveStep` / `rejectStep` `saved === false` → hata uyarısı ve geri alma |
| Personel kaydı silindi ya da hesap bağı kaldırıldı | Kimlik gerektiren hiçbir yazma yapılamaz; erişim biter | Rules: `personel kaydı silinmiş / eşleme bozuk hesap …`; emülatör: `bağ kaldırılınca … erişim biter` |

---

## 8. Açık riskler, kapsam dışı sertleştirmeler ve doğrulanamayan varsayımlar

**Açık riskler** (kapatılmadı; ayrıntılar Mega Fix dosyasının "Açık riskler" bölümünde):

1. **Yeni kaydın zaman damgası istemci saatidir.** Onay ve akış kayıtlarına eklenen yeni kaydın `date` / `tarih` /
   `timestamp` alanı sunucuda doğrulanmaz; rules testi `SINIRLAMA (açık risk)` bunu belgeler. Eski kayıtların tarihi
   değiştirilemez. Sunucu saatli iz için `auditLogs` kullanılabilir. Faz 2'ye öneri: dizi dışında bir harita alanında
   `request.time`; bu, veri katmanında sentinel desteği ister.
2. **Onayda history `from` / `to` alanları ve adım tipi metni serbest.** Karar alanları (`status`, `currentStep`, `finished`,
   `durum`) bağlıdır.
3. **Kurallar kanıt sayılarının gerçekten sunucudan sayıldığını doğrulayamaz.** Yönetici güvenilir taraftır; istemci yolu
   (VIP aracı) sahte kanıt yazamaz.
4. **Açık dinleyiciler.** Emülatörde kilit kapandıktan sonra açık dinleyiciye veri gelmedi. Üretimde bu varsayılmadı;
   istemci oturumu ayrıca keser.
5. **Onaylayıcı adı ↔ uid eşleşmesi akış başlarken doğrulanmaz, karar anında doğrulanır.** Sahte etiketli bir adım
   onaylanamaz, yalnız yöneticiye kalır.
6. **J11 öncesi kayıtlar.** Eski `createdByName` ya da adım adı personel kaydındaki addan farklıysa, sahibin taslak işlemi ya
   da onaylayıcının onayı reddedilir (güvenli tarafta). Canlı göçten önce bunları sayan bir ön denetim önerilir.
7. **Kesinti.** Deploy'dan kilit açılana kadar personel sistemi kullanamaz (tasarım gereği).

**Kabul edilen / kapsam dışı (sahip kararı, 19.10.2026):**
- **Geçmiş sızıntı riski.** Canlı kullanıcı sayısı kısıtlı olduğu için kabul edildi.
- **Yönetici kurtarma / kod sıfırlama.** Kasıtlı olarak kapsam dışı; kodunu unutan personel operasyonel olarak ele alınır.

**Kapsam dışı sertleştirmeler (Faz 2 önerisi):**
- Kod temizliğinden önce iç içe alanlarda kod kopyası taraması.
- Kilit açıkken kapanış denetimini yeniden çalıştırma.
- Onaylayıcı listesini yönetici şablonuna bağlama (şablon yetkisi şu an yalnız istemcide).
- Gözlemsel akış senaryolarına açık iddialar ekleme.
- Kilit kapalı giriş mesajı ve VIP kilit aracı için akış senaryoları.

**Doğrulanamayan varsayımlar:**
- **Emülatör ile üretim aynı davranıyor.** Kural değerlendirmesi, `get()` önbelleği ve 1000 ifade sınırı üretimde de
  emülatördeki gibi kabul edildi. Bütçe payları emülatör ölçümüdür.
- **Gerçek veride ad biçimleri.** Gerçek `personel` kayıtlarında `name` / `adSoyad` / `ad` alanlarının mevcut onaylayıcı
  adlarıyla uyumlu olduğu canlı veride doğrulanmadı (6. maddeye bakın).
- **Gerçek ortamda kilit belgesi.** Canlı ve demo projelerinde `accessGate` belgesinin bugün olmadığı, bugünkü kuralların bu
  koleksiyona yazmaya izin vermemesine dayanılarak çıkarıldı. Deploy'dan önce Console'da bakılmalı (runbook 0. adım).
- **Hosting.** Hosting yalnız dosya listesiyle doğrulandı (55/55). Gerçek deploy yapılmadı.

---

## 9. Denetçi için yeniden üretim

Hiçbiri gerçek Firebase projesine yazmaz. `test:*:emu` ve `test:rules` kendi geçici emülatörlerini açar; E2E için emülatör
ayrıca açılır.

```bash
git checkout 6958aa352813025e6476b4ede6d5f976c021d831   # J11.5 (son); yalnız J11 için: 06afc6f
npm run test:unit
npm run test:rules
npm run test:staff:emu
npm run test:ownership:emu
npm run test:atomic:emu
npm run lint:xss
node scratch/hosting-files.js
# E2E: ayrı terminalde `npm run emu`; her tam koşudan ÖNCE temiz emülatör + tohum (j10CodeCleanse kodları siler)
npm run emu:seed
node scratch/flow-tests.js --emu                     # tam paket (55)
node scratch/flow-tests.js --emu j11ApprovalAudit    # yalnız gerçek istemci onay / red denetimi
# İfade bütçesi (10 adımlı başlatma / onay / red)
bash scratch/_budget.sh firestore.rules "0 3 6 9"
```

Önce / sonra karşılaştırması: taban commit `d35c919`'un `src`, `tests`, `pdf-fonts`, `firestore.rules`, `package.json` ve
`firebase.json` dosyaları ayrı bir klasöre çıkarılır (`git archive d35c919 …`). Güncel `tests/` dosyaları üzerine kopyalanır
ve aynı komutlar orada koşulur.

## 10. Proje sahibinin kararını bekleyenler

1. **Push / merge / deploy.** J11 ve J11.5 yalnız yerel `feat/phase-4b-identity-model` dalında commit'li (`06afc6f`, `6958aa3`). Deploy, §5'teki
   sırayla ve kurallar + istemci birlikte yapılmalı.
2. **Gerçek ortamda göç.** §5 adım 4–5; kök başına (canlı ve demo ayrı).
3. **Açık risk 1 (yeni kaydın tarihi istemci saati).** Kabul mü, yoksa Faz 2'de sunucu saatli karar alanı (`kararlar.<adım>.at
   == request.time` ve veri katmanında sentinel desteği) mı?
4. **J11 öncesi kayıtlarda ad uyuşmazlığı (açık risk 6).** Canlı göçten önce uyuşmayan `createdByName` ve adım adlarını sayan
   bir ön denetim yapılsın mı?
5. **J11'e ait olmayan çalışma ağacı değişiklikleri** (§0): commit'e alınacak mı, atılacak mı?
6. **Kapsam dışı sertleştirmeler** (§8): hangileri Faz 2'ye alınacak?

---

## 11. Tur J11.5 — Zero-Trust sözleşme düzeltmeleri (bağımsız denetim, 76/100)

Commit: **`6958aa352813025e6476b4ede6d5f976c021d831`** (J11 `06afc6f`'in üstünde; yalnız bu dal, yerel). Denetçinin üç bulgusu
önce koddan doğrulandı, sonra düzeltildi. Her biri için yazılan testler, düzeltme **öncesi** koda karşı da koşuldu.

### 11.1 Eski kod tespiti — biçime bağlı açık (P1)

- **Doğrulama:** `ownership.js` `planCodeCleanse`, kod sayılmayan değerleri `/^[A-Za-z0-9]{4,12}$/` ile ayırıyordu. Sahibinin
  kodu silinmiş bir eski `createdBy` değeri tireli ya da özel karakterliyse (`ab-12`) "tanınmayan metin" sayılıp
  atlanıyordu. `planStaffAccessClosure` aynı tespiti kullandığı için `purchaseOrderCodes` 0 çıkıyor ve kapanış temiz
  görünüyordu.
- **`staff-code-registry.js`:** Bu dosyada böyle bir tespit regex'i **yok**; yalnız kod doğrulaması var (boş / boşluk / en kısa
  uzunluk / çakışma). Değişiklik gerekmedi.
- **Düzeltme:** Biçime bakılmaz. `createdBy` şunlardan birine çözülemiyorsa **engeldir** (`purchaseOrderUnresolved` → kapanışta
  `purchaseOrderCodes`):
  - personel id'si;
  - bilinen bir ad;
  - sistem / rol / havuz değeri (`unknown`, `Admin`, `pool`, `system`, `Yönetici` …).

  Değer bugün tekil bir personelin koduysa eskisi gibi o personelin id'sine çözülür. Rapor değeri içermez. VIP etiketi
  "kodlu ya da çözülemeyen 'oluşturan' alanı" olarak güncellendi.
- **Meşru değerler engellenmez:** İstemcinin yazdığı değerler personel id'si (`_purchaseRequester`), şablondan açılanlarda ad
  ve yöneticinin personel kaydı yoksa `"unknown"`'dır. Bir test bunların hiçbirinin engel olmadığını doğrular.
- **Operasyonel etki (gizlenmedi):** Canlı veride çözülemeyen bir `createdBy` varsa kilit, yönetici kaydı düzeltene kadar
  açılmaz. Bu, fail-closed tasarımın beklenen sonucudur. Emülatördeki demo kopyasında böyle bir kayıt çıkmadı
  (`j10CodeCleanse` geçti); canlı veride göçten önce VIP Kod Temizliği önizlemesi bunu gösterir.

### 11.2 Onaylayıcının `currentState` manipülasyonu (P1)

- **Doğrulama:** `poApprovalOk`'un onay dalı `nwf.currentState`'i hiç sınırlamıyordu; onaylayıcı meşru bir onayla birlikte
  durumu `cancelled` ya da `suspended` yazabiliyordu. Red dalı zaten `cancelled` istiyordu.
- **Düzeltme:** Onaydan sonraki durum, `approveStep`'in durum makinesinin **tek meşru ardılına** bağlandı. Kural, sunucudaki
  eski durumu şu tabloyla eşler; kümeye üyelikten daha sıkıdır.

  | Adım | Eski durum | Yeni durum |
  |---|---|---|
  | Son adım | herhangi biri | `completed` |
  | Ara adım | `initiation`, boş ya da hatalı `completed` (istemci `initiation`'a onarır) | `manager_approval` |
  | Ara adım | `manager_approval` | `hr_approval` |
  | Ara adım | `hr_approval` | `finance_approval` |
  | Ara adım | `finance_approval` | `director_approval` |
  | Ara adım | `director_approval` | `initiation` (istemci önce `completed`'a geçer, `fixWorkflowCurrentStep` döndürür) |

  Tabloda olmayan bir eski durum reddedilir. Alanı silmek de reddedilir.

### 11.3 Talep sahibinin sahte olay / uid eklemesi (P1)

- **Doğrulama:** `appendOneBy` yalnız eklenen kaydın aktör adını denetliyordu. Sahip kendi taslağına kendi adıyla
  "✅ Onaylandı" akış kaydı, `transition` / `approved` history kaydı ya da başkasının uid'sini taşıyan kayıt ekleyebiliyordu.
- **Düzeltme:** `appendOneBy` yerine `ownerEventOk` geldi. Eklenen tek kayıt şunları taşımak zorunda:
  - sahibin adı;
  - `uid == request.auth.uid` (ek `get()` yok);
  - işlemin istemcide ürettiği türlerden biri:

  | İşlem | History türü | Akış türü (`islem`) |
  |---|---|---|
  | Oluşturma (`poCreateOk`) | kayıt yok | "Talep Oluşturuldu" |
  | Taslak düzenleme / ek silme | **kayıt eklenemez** | "Talep güncellendi" / "Ek dosya silindi" |
  | Akış başlatma | `create` | "İş akışı başlatıldı" |
  | İptal | **kayıt eklenemez** | "Talep İptal Edildi" |
  | Geri çekme (`poWithdrawOk`) | `withdraw` | "Talep Geri Çekildi (Taslak Moduna Alındı)" |

  Türler, kod tabanındaki tüm `islem:` / `action:` yazanları taranarak çıkarıldı. İstemci bu kayıtların hepsine `uid` yazıyor
  (`purchase-servises.js` 6 yer, `edm-workflow.js` 3 yer). Yalnız **yeni** kayıtlar denetlenir; eski kayıtlar değişmez.

### 11.4 İfade bütçesi

Sahibin olay denetimi ilk denemede 10 adımlı başlatmayı ek koşul olmadan bile 1000 ifade sınırının üstüne çıkardı. Bu ölçümle
yakalandı; test gevşetilmedi.

**Çözüm:** Sahibin satın alma yolunda `textOk` (9 etiket regex'i) yalnız `textOk`'un baktığı alanlardan biri değişiyorsa
çalışır. Başlatma, geri çekme ve iptal bu alanlara dokunmaz. Değişmeyen değer sahibin bu yazmada getirdiği yeni metin
olmadığı için etiket savunması aynı kalır. Bu alanlardan birini değiştiren düzenleme tam `textOk`'tan geçer.

| İstek | J11 payı | J11.5 payı |
|---|---|---|
| 10 adımlı başlatma | 3–5 | **12'den fazla** |
| 10. adım onayı | 12'den fazla | **12'den fazla** |
| 10. adım reddi | 6–8 | **6–8** |

### 11.5 Sonuçlar (J11.5 commit'i, 20.10.2026; hepsi emülatörde)

| Paket | J11 | J11.5 | Düzeltme öncesi koda karşı (yeni testler) |
|---|---|---|---|
| `npm run test:rules` | 189 | **197/197** | Önceki kurallarla 189/197: **başarısız 8 testin 8'i de J11.5 testi** (madde 2: 3, madde 3: 5) |
| `npm run test:unit` | 110 | **114/114** | Önceki `ownership.js` ile 23/25: tireli kod engeli ve kapanış engeli testleri başarısız. Meşru değer ve bugünkü özel karakterli kod testleri iki sürümde de geçiyor (regresyon koruması). |
| `test:staff:emu` / `test:ownership:emu` / `test:atomic:emu` | 15 / 16 / 5 | **15/15 · 16/16 · 5/5** | — |
| E2E `flow-tests --emu` (temiz emülatör + tohum) | 55 | **55/55**, 0 CSP ihlali, 0 sayfa hatası | — |
| `lint:xss` · `hosting-files` | 0 · 55 | **0 izinsiz · 55/55** | — |

**E2E — `j11ApprovalAudit` genişletildi** (gerçek istemci + gerçek kurallar):
- **Sahip, kendi taslağında:** sahte "✅ Onaylandı" olayı, başkasının uid'siyle olay ve sahte `transition` history kaydı
  denendi. Üçü de `forbidden`.
- **Onaylayıcı:** içeriği, sayısı, uid'si ve aktörü meşru olan bir onayı `currentState: 'cancelled'` ve `'suspended'` ile
  denedi. İkisi de `forbidden`; sunucu değişmedi.
- **Gerçek `approveStep`:** sonuç `manager_approval`.
- **Gerçek `rejectStep`:** sonuç `cancelled`.

### 11.6 Kalan / yeni açık noktalar

1. **Sahibin taslak, iptal ve geri çekme yolunda `currentState` serbest.** Bu yollar karar vermez; akış başlamamış ya da
   taslağa dönmüştür. Onay dalı bağlıdır. Denetçinin bulgusu onaylayıcıya yönelikti; bu yol kapsam dışı bırakıldı ve
   istenirse aynı tabloyla bağlanabilir.
2. **Yeni kaydın tarihi istemci saati** (§8 açık risk 1) değişmedi.
3. **Yalnız yeni kayıtlar denetlenir.** J11.5 öncesi uid'siz kayıtlar geçerli kalır; eski kayıtlar değiştirilemez
   (`appendOnly`).
4. **Canlı veride çözülemeyen `createdBy`.** Kilidin açılmasını engeller (11.1). Yönetici elle düzeltir.
