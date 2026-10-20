# Faz 4B Mega Fix Walkthrough — Tur J11: Denetim Düzeltmeleri

> **Tek dosya kuralı:** Faz 4B mega fix için ayrı düzeltme dosyası açılmaz. Her faz bitince o fazı yapan ajan bu dosyayı
> günceller: kendi bölümünü doldurur, **Durum** tablosunu ve **Zincir devir notu**nu yeniler.

Dal: `feat/phase-4b-identity-model`. J11 kodu ve testleri J10'un (`d35c919`) üstünde yerel commit
**`06afc6f53da260bdc829e04b8b709c68fb2d706e`** olarak duruyor. Push, merge, deploy ve gerçek ortamda göç **yapılmadı**; hepsi
proje sahibinin ayrı onayını bekliyor (madde 10). Teslim ve denetim raporu:
[Faz 4B Tur J11 Walkthrough](Faz%204B%20Tur%20J11%20Walkthrough.md).

Bağımsız denetim kararı (J10): **57/100 — NO-GO**.

## Durum

| Faz | Kapsam | Sahibi | Durum |
|---|---|---|---|
| Faz 0 | Keşif, kök neden, tasarım kararları | Opus | ✅ Tamam |
| Faz 1 · Tur 1 | **P0** göç sırasındaki veri sızıntısı penceresi · **P1** hesap taşıma hata kurtarması | Opus | ✅ Tamam |
| Faz 1 · Tur 2 | **P1 #4** sahiplik göçü / kod temizliği sırası · **P1 #5** onay adımı ve denetim geçmişi bütünlüğü | Sonnet (aynı oturum, model geçişi sahip tarafından) | ✅ Tamam — iki sonucu Tur 3'te düzeltildi (aktör bağı uygulanabilir çıktı; kod silme ayrı aşamaya alındı) |
| Faz 1 · Tur 3 | **P1 #6** demo test silme istisnası · **P1 #7** talep sahibi / katılımcı kimliği · **P1 #8** kalite kapısı · P1 #4 ve P1 #5 düzeltmeleri | Opus | ✅ Tamam — tüm regresyon paketleri yeşil (akış 54/54) |
| Faz 1 · Tur 4 | Bağımsız denetim: **P1 #5** "aynı sayıda sahte içerik" kapanışı (eski adım `pending`, olay türü / uid / gerekçe bağı) · **madde 9** teslim raporu ([Faz 4B Tur J11 Walkthrough](Faz%204B%20Tur%20J11%20Walkthrough.md)) | Opus | ✅ Tamam — tarih alanı açık risk olarak kaldı |
| Faz 1 · madde 10 | Yetki ve son karar: yalnız bu dal; başarısızlıkta güvenli kalma tablosu; J11 yerel commit `06afc6f`; bağımsız denetime teslim | Opus | ✅ Teslim edildi — push / merge / deploy / göç sahibin onayında |
| Faz 2 | Kalan denetim bulguları | Sonnet | ⏳ Bekliyor — bkz. Zincir devir notu |
| Faz 3 | Gerçek ortamda göç ve kilidin açılması (runbook) | Sahip + ajan | ⏳ Bekliyor (onay gerekir) |

---

## Faz 0 — Keşif ve tasarım kararları

### Bulgular ve kök nedenler

| Bulgu | Kök neden (J10 kodu) |
|---|---|
| **P0** · Kod temizliği bitene kadar bağlı her personel bütün personel kayıtlarını, düz metin `code` alanıyla birlikte okuyabiliyor. Kod + `"Mdp!"` = Firebase Auth parolası, yani hesap ele geçirilebilir. | `firestore.rules`: `allow read: … member(root)`. Göçün bitip bitmediğini bilen bir durum yok. Kurallar koleksiyonu tarayıp "temizlik bitti mi" diye bakamaz. |
| **P1** · J7 hesabı PRI adresine taşınıp Firestore bağı düşerse yeniden çalıştırma takılıyor. | `moveLegacyAccount` her seferinde **eski** adresle giriş yapmaya çalışıyor. Auth tarafı zaten taşınmış olduğu için giriş reddediliyor, sonuç "eski hesabın parolası eşleşmiyor" çakışması. Hesap taşınmış ama hiçbir zaman bağlanamıyor. |
| P1 (ek) · `_linkStaffAccount` iki ayrı yazma yapıyor. | Önce `staffAccounts` eşlemesi, sonra `updateItem('personel')`. İkincisi düşerse yarım bağ kalıyor. Eşlemenin başka bir personeli gösterip göstermediği denetlenmeden üzerine yazılıyor. |
| P1 (ek) · Hata türleri karışık. | Ağ, yetki, yanlış kod, çakışma, kota ve devre dışı hesap aynı `error` / `conflict` sonucuna düşüyor. Ağ koptuğunda toplu iş durmuyor, her satırı ayrı ayrı düşürüyor. |

### Tasarım kararları

**P0 — erişim kilidi**

1. **Konum:** `${root}/accessGate/items/staff`, ayrı bir koleksiyon. `system_config/admin_settings` seçilmedi, çünkü:
   - O doküman bakım modu, force logout, restore kilidi gibi birçok yoldan yazılıyor.
   - Kilidin kendine özgü bir kanıt şeması var.
   - `accessGate` `knownCol` listesinde **yok**. Bu yüzden genel "admin her şeyi yazar" bloğu kanıt şemasını atlayamıyor.
   - Yedek / geri yükleme (`COLLECTIONS`) bu koleksiyona dokunmuyor.
2. **Tek kaynak:** `isStaff(root) = staffAccessOpen(root) && staffIdentity(root)`. Personelin her yolu `isStaff` ya da `member`
   üzerinden geçer: okuma, liste, iş akışı yazmaları, görev silme, denetim günlüğü ve demo temizlik istisnası. Kilit hepsini aynı
   noktadan kapatır. `staffIdentity` yalnız kilit dokümanını okumak için kullanılır, veri erişimi için değil.
3. **Fail-closed:** Kilit yalnız `staffAccessEnabled === true` (bool) ise açıktır. Şu durumların hepsinde kapalıdır:
   - Doküman yok.
   - Alan yok ya da adı yanlış.
   - Alan `"true"` (metin), `1`, `null` ya da harita.
   - Alan `false`.
4. **Açma yalnız kanıtla:** Kural şunları zorunlu tutar:
   - Sekiz denetim sayısı. Hepsi 0, eksik ya da fazla anahtar yok.
   - `changedAt == request.time` (sunucu saati).
   - `changedBy == auth.uid`.
   - `version == 1`.
   - Etiketsiz `reason`.

   **Kapatma** kanıt istemez. **Silme** kapatma sayılır.
5. **Bilinçli sınırlama:** Kurallar kanıttaki sayıların gerçekten sunucudan sayıldığını doğrulayamaz. Yönetici güvenilir taraftır
   (J10 sınırlama 1). Tek istemci yolu `openStaffAccess()`. Bu fonksiyon denetimi **yeniden** çalıştırır ve önizlemeye güvenmez.

**P1 — taşıma kurtarması**

- Eski adres kodu kabul etmezse hedef PRI adresiyle **yalnız giriş** denenir; hiçbir şey değiştirilmez. Bulunan uid personel
  kaydındakiyle **birebir** aynıysa eksik bağ tamamlanır (`move-resumed`). Aynı değilse hiçbir şey yazılmaz (`conflict` /
  `uid-mismatch`). Yeni hesap açılmaz, başka hesaba bağlanmaz, uid değiştirilmez.
- Bağlama tek bir Firestore transaction'ıdır. İki işi birlikte yapar: eşlemeyi yazar ve personel bağını kurar. Bu yazmalar ya birlikte
  olur ya hiç olmaz. Ön koşullar transaction içinde taze okunur.

---

## Faz 1 — Uygulama

### P0 · Personel erişim kilidi

**Kurallar** ([firestore.rules](../../firestore.rules)):

| Parça | Ne yapar |
|---|---|
| `staffIdentity(root)` (satır 44) | J10'un `isStaff`'ı. Eşleme yolu `let` ile bir kez hesaplanır, `personelId` tip denetimi `staffPersonOk` içinde yapılır. Kilit +1 okuma getirdiği için ifade bütçesi geri kazanıldı. |
| `staffGate` / `staffAccessOpen` / `isStaff` (62–66) | Tek kaynaklı kilit kapısı. |
| `gateBaseOk` / `closureOk` / `gateWriteOk` (272–292) | Kanıt şeması. |
| `match /{root}/accessGate/items/{gateId}` (294) | Yalnız `staff` dokümanı. Okuma: yönetici ve kimliği doğrulanmış personel. Yazma ve silme: yalnız yönetici. |

**Kapanış denetimi** (`Ownership.planStaffAccessClosure`, [ownership.js](../../src/utils/ownership.js)): Saf fonksiyondur. Çağıran
taraf altı koleksiyonu sunucudan okur. Rapora kod değeri girmez.

| Anahtar | Sayılan | Kapatan adım |
|---|---|---|
| `personelCodes` | `personel.code` dolu | Kod Temizliği |
| `requestCodes` | `requests.personelKodu` dolu | Kod Temizliği |
| `purchaseOrderCodes` | Kod biçimli eski `purchaseOrders.createdBy` (`planCodeCleanse` ile aynı tespit) | Kod Temizliği |
| `accountsMissing` | Giriş hesabı olmayan personel | PRI / Hesap Göçü ya da "Hesap Aç" |
| `accountsInconsistent` | Paylaşılan uid ya da PRI adresinde olmayan hesap (J7 adresi dahil) | PRI / Hesap Göçü |
| `accountMapMismatch` | Bağlı personelin `staffAccounts` eşlemesi yok, başka personeli ya da başka bir PRI'yi gösteriyor | PRI / Hesap Göçü (eşlemeyi yeniler) |
| `ownershipPending` | Sahiplik Göç Aracı'nın hâlâ yazacağı kayıt | Sahiplik Göçü |
| `ownershipUnresolved` | Sahiplik alanı çözülemeyen kayıt (`personelUid` / `createdByUid` / `creatorUid`; sistem / rol değerleri hariç). Ayrıca dolu uid'si bugünkü hesaptan farklı her alan. | Elle düzeltme ya da silme |

Onay adımı ya da atanan uid'si çözülemeyen kayıtlar **uyarıdır**, engel değildir; o adımları yalnız yönetici onaylar. Bayat
eşleme engel değildir, çünkü kural personel kaydındaki uid'yi de ister.

**İstemci** ([firebase-handler.js](../../src/services/firebase-handler.js), dosya sonu "Personel erişim kilidi"):

- `readStaffAccessGate()`: kilit durumunu sunucudan okur. Dönen değer `open | closed | missing | invalid | denied | unknown` olabilir;
  `open` dışındaki her durum kapalı demektir.
- `verifyStaffAccessClosure()`: yönetici içindir. Altı koleksiyonu `getDocsFromServer` ile okur, sonra kapanış denetimini çalıştırır.
- `openStaffAccess()`: yönetici içindir. Denetimi yeniden çalıştırır; sekiz sayının hepsi 0 değilse **yazmaz**. Yarım kalmış
  bir restore kilidi (`restoreLock`) varsa açmayı reddeder.
- `closeStaffAccess()`: kilidi her zaman kapatır.
- **Kilit dinleyicisi** (`startRealtimeSync` → C2): yönetici panelinde durumu gösterir. Kilit kapanınca personel oturumunu
  `revokeStaffAccess` ile keser. Önbellekten gelen "doküman yok" anlık görüntüsüne göre karar verilmez.
- `revokeStaffAccess(reason)` sırasıyla şunları yapar:
  1. Dinleyicileri durdurur.
  2. Bellekteki veriyi siler (`window.data` dizileri, `_dbMirror`).
  3. Oturumu kapatır.
  4. Oturum kurulmuşsa sayfayı yeniden yükler; ekrandaki kayıtlar da gider ve mesaj yenilemeden sonra gösterilir.
- `reportListenerError`: personel oturumunda gelen ilk izin reddinde nedeni kilit dokümanından öğrenir:
  - Kilit kapalıysa: "Personel erişimi şu an kapalı (sistem geçişi sürüyor)".
  - Kural kimliği tanımıyorsa: "hesabınız bağlı değil".
  - Ağ hatası gibi belirsiz durumlarda: bant gösterilir.
- **Giriş** ([auth-engine.js](../../src/modules/auth-engine.js) `completeStaffLogin`): zero-lookup korunur; girişten önce
  veritabanı okunmaz. Firebase Auth girişinden **sonra** kilit okunur. Kapalıysa oturum sessizce kesilir, veri ekrana hiç gelmez
  ve giriş ekranında neden yazılır.

**Yönetici aracı:** VIP → **Personel Erişim Kilidi** ([admin-system-control.js](../../src/modules/admin/admin-system-control.js)
`vipStaffAccessGate`, [admin.html](../../admin.html) `#vipStaffGateBtn`).
- Ekranda şunlar görünür: kilit durumu, sekiz denetim, her denetimin ilk 10 sorunlu kaydı ve çözüm adımı, uyarı sayısı.
- "Erişimi Aç" yalnız sekiz denetimin hepsi 0 iken etkindir. "Erişimi Kapat" her zaman kullanılabilir.
- Uygulama günlüğüne kayıt düşer. DOM API kullanılır (innerHTML yok).

**Önceden indirilmiş veri:** Kilit, kapalıyken yeni okumaları engeller. Açıkken okunmuş veriyi geri alamaz. Bu yüzden kilit, kodlar
silinmeden **önce** açılmamalıdır; kapanış denetimi bunu zorlar. Ayrıca bkz. Açık riskler 1.

### P1 · Hesap taşıma hata kurtarması / idempotency

[staff-provisioning.js](../../src/services/staff-provisioning.js):

- **`errorKind(e)`** hataları türlere ayırır:
  - `rate-limited`
  - `network`
  - `permission-denied`
  - `wrong-password`
  - `email-in-use`
  - `user-disabled`
  - `operation-not-allowed`
  - `requires-recent-login`
  - `uid-mismatch`
  - `not-found`
  - `unknown`

  Başarısız satır sonuçları `kind` alanı taşır.
- **`moveLegacyAccount`** kurtarma yolunu içerir (bkz. Faz 0). Olası durumlar: `moved`, `move-resumed`, `conflict`, `disabled`,
  `error`, `link-failed`, `invalid`.
- **Toplu işi durduranlar:**
  - Kota → `rate-limited`.
  - Ağ → `network`. Hesap sunucuda açılmış ya da taşınmış olabilir; yeniden çalıştırma kaldığı yerden tamamlar.
  - Yetki → `permission-denied`. Bağ yazılırken alınırsa satır raporlanır ve iş durur.
  - Kapalı sign-up ve doğrulamasız e-posta değişikliği.

  Kişiye özgü hatalar satır sonucu olarak kalır: yanlış kod, çakışma, devre dışı hesap.
- **`createFirestoreLinker`** tek transaction'dır. Hiçbir şey yazmadığı durumlar:
  - Personel kaydı başka bir uid'ye bağlı → `uid-mismatch`.
  - Eşleme başka bir personeli gösteriyor → `uid-mismatch`.
  - Kayıt yok → `not-found`.

  Değişmeyen alanları yazmaz. Tarayıcı (`firebase-handler._linkStaffAccount`) ve emülatör testi **aynı kodu** kullanır.
- `_requireProvisioningAdmin`: personel koleksiyonunda yarım kalmış bir restore kilidi varsa hesap işlemi yapılmaz. Bağlama
  transaction'ı veri katmanının dışında olduğu için bu denetim eklendi.
- Göç aracı yeni durumları gösterir: "taşıması tamamlanan (bağ onarıldı)", "devre dışı hesap" ve satırdaki `[kind]`.

### P1 #4 · Sahiplik göçü / kod temizliği sırası (Tur 2, Tur 3'te düzeltildi)

**Doğrulama:** Bulgunun üç parçası da koddan doğrulandı:
1. **Sıra yanlıştı.** `personel.code`, `purchaseOrders.createdBy` dönüşümünden önce siliniyordu. Personel batch'i geçip sonraki
   batch düşerse yeniden çalıştırma, kodu artık silinmiş personel listesiyle hesaplıyordu. Çözülebilir `createdBy` kodları
   kalıcı olarak `'unknown'` oluyordu.
2. **`planCodeCleanse.ready` eksikti.** Yalnız hesapsız personele ve bekleyen sahiplik göçüne bakıyordu; sahipliği çözülemeyen
   kayıtlar (`ownershipIssues`) varken de plan hazır sayılıyordu.
3. **Yazma hepsi-ya-da-hiçbiri değildi.** Ara batch düşerse yazılanlar kalıcı, kalanlar yazılmamış oluyordu.

**Çözüm:**
- **`Ownership.classifyOwnershipIssues`** (yeni, paylaşılan): `planMigration().issues`'ı ikiye ayırır.
  - Engelleyici: sahiplik alanının kendisi çözülemiyor ya da `mismatch`.
  - Uyarı: onay adımı veya atanan alanı çözülemiyor (`system` değerleri hariç).

  `planStaffAccessClosure` (P0) ve `planCodeCleanse` aynı sınıflandırmayı kullanır.
- **`Ownership.planCodeCleanse`:**
  - `ownershipIssues` artık sayı değil, dizi. Engelleyici satırlar `blockers.ownershipUnresolved`'a düşer ve plan hazır sayılmaz.
  - Tekil bir personele indirgenemeyen `createdBy` (hiç kimsenin kodu değil ya da birden fazla kişide ortak) artık **otomatik
    `'unknown'` yapılmaz**. `blockers.purchaseOrderUnresolved`'a düşer; yönetici kaydı elle düzeltmeden temizlik çalışmaz.
  - `fingerprint` planın kendi (kod içermeyen) çıktısından kurulur. Kodun değeri fingerprint'e girmez.
- **`firebase-handler.applyCodeCleanse` — iki aşama** (Faz 5 AtomicWriter yeniden kullanıldı, yeni yazma motoru yok):
  0. Personel, talepler ve satın almalar sunucudan **taze** okunur, plan yeniden hesaplanır. Önizlemeden sonra veri değiştiyse
     (`changed-since-preview`) ya da plan hazır değilse (`not-ready`) hiçbir şey yazılmaz.
  1. **Geri alınabilir dönüşümler** AtomicWriter ile hepsi-ya-da-hiçbiri yazılır: önce `purchaseOrders.createdBy` (personel
     koduna ihtiyaç duyar), sonra `requests.personelKodu`. Ara parça düşerse yazılanlar da geri alınır.
  2. **`personel.code` en son ve ayrı yazılır** (`Ownership.deleteCodesForward`). İleri yönlü ve idempotent çalışır; yarıda
     kalırsa yeniden çalıştırma kalanları siler.
- **İkinci aşamanın neden ayrı olduğu (Tur 3 bulgusu):** Tur 2'de kod silme de AtomicWriter'ın günlüklü işlemindeydi. Tur 3'ün
  emülatör testi, kod silme parçası sunucuda uygulanıp yanıt kaybolduğunda şunu gösterdi:
  - AtomicWriter `personel.code`'u geri yazmaya çalışıyor.
  - Kurallar silinmiş kodun yeniden yazılmasını reddettiği için geri alma **hiç tamamlanamıyor** (`rollback-pending`).
  - Kilit ve günlük takılı kalıyor; kurtarma da her seferinde aynı yerde düşüyor.

  Geri alınamaz adım bu yüzden günlüğün dışına alındı.
- **Kısmi sonuç başarı gibi gösterilmez.** Hata yolunda gerçek kalıcı durum sunucudan yeniden okunur ve raporlanır (bekleyen
  dönüşüm sayısı, kalan kod sayısı). VIP ekranının başlığı da duruma göre değişir:
  - `✓ tamamlandı`
  - `⚠ kısmen tamamlandı`
  - `⚠ yarıda kaldı — kilitli`
  - `✗ hiçbir şey yazılmadı`
  - `⚠ sonuç kesin değil`
- **`planStaffAccessClosure`:** `purchaseOrderCodes` sayısı elle çözülmesi gereken kayıtları da içerir. P0 kilidi, temizlik
  gerçekten bitmeden açılamaz.

**Kabul kriteri — gerçek Firestore + üretim kuralları** (`tests/integration/ownership.emu.test.mjs`):
- Birinci aşamanın ikinci parçası düşerse ("commit gönderilmedi" ve "uygulandı, yanıt kayboldu" ayrı ayrı):
  - Hiçbir alan kalıcı değişmez; kodlar silinmez.
  - Günlük ve kilit temizlenir.
  - Yeniden çalıştırma `createdBy`'ı doğru kişinin id'sine çözer (`'unknown'` değil). Üçüncü koşuda yapılacak iş yoktur.
- İkinci aşama yarıda kalırsa:
  - Dönüşümler kalıcı ve doğrudur.
  - İlerleme gerçek değeriyle raporlanır.
  - Yeniden çalıştırma kalan kodları siler, dönüşümleri tekrar yapmaz.
- Eski hatanın bıraktığı yarım durum (kodlar silinmiş, `createdBy` dönüşmemiş) otomatik `'unknown'` yapılmaz; engel olarak
  raporlanır.
- Sahipsiz talep varken plan hazır değildir.
- Eşzamanlı değişiklikte fingerprint değişir.
- Personel oturumu temizlik yazamaz.
- Tarayıcıda gerçek yol: `flow-tests` `j10CodeCleanse` (8 alan iki aşamada yazıldı, kodlar silindi, uid'ler korundu).

### P1 #5 · Onay adımı ve denetim geçmişi bütünlüğü (Tur 2 + Tur 3 düzeltmesi)

**Doğrulama:**
- **Kayıt sayısı ve biçimi doğrulanmıyordu.** `appendOnly` yalnız eski kayıtların önek olarak korunduğunu kontrol ediyordu.
  Sırası gelmiş bir onaylayıcı sınırsız sayıda sahte `history` / `akis` kaydı ekleyebiliyordu.
- **`edm-workflow.js` incelendi.** `approveStep` tam +1 history +1 akis üretiyor; `rejectStep` tam +1 history +3 akis üretiyor
  (red, state geçişi ve modal kaydı). Körlemesine "tek kayıt" şartı konmadı.
- **Aktör alanları serbest metindi.** `actor` / `yapan`, istemcideki `window.currentUser.name`'den yazılıyordu ve kural hiç
  doğrulamıyordu.
- **Bayat onay ve ikinci kez onay mimari olarak engelliydi.** `cs` her zaman sunucudaki güncel `currentStep`'ten okunuyor.
  Davranış açık testlerle kanıtlandı.

**Çözüm (`poApprovalOk`):**
- Eklenen kayıt sayısı birebir: onayda +1 history +1 akis, redde +1 history +3 akis.
- Adımın `actor`'u, yeni history kaydının `actor`'u ve yeni akış kayıtlarının hepsinin `yapan`'ı onaylayanın **gerçek adı**
  olmalı. Gerçek ad `staffName` ile bulunur: `staffAccounts/{uid}` → `personel/{pid}` → `name` / `adSoyad` / `ad`, kırpılmış.
  Bu iki belgeyi `isStaff` zaten okuyor; Firestore aynı istekte önbelleğe aldığı için yeni okuma yok.
- İstemci (`approveStep`, `rejectStep`, akış başlatma, şablondan akış, satın alma düzenleme / iptal / geri çekme / ek silme)
  aktör adını artık `Ownership.selfName()`'den yazar. Bu fonksiyon kuralla aynı kaynak ve önceliği kullanır; birim testi kural
  metniyle eşdeğerliği denetler.

> **Tur 2'deki yanlış sonuç geri çekildi.** Tur 2'de "aktör bağı tek bir `get()` eklenince bile 1000 ifade sınırını aşıyor,
> uygulanamaz" yazılmıştı. Bu **yanlıştı**. O denemelerde test fikstürü adımın onaylayıcısını `'Bora'` adıyla yazıyordu, oysa
> personel kaydı `'Bora Kaya'`. Karşılaştırma bu yüzden **false** dönüyordu. Reddedilen istekte kurallar tüm alternatif yolları
> değerlendirdiği için de 1000 ifade hatası, yan etki olarak görünüyordu.
>
> Tur 3'te aynı kontrol, doğru değer döndüğünde 165/165 test ile (10 adımlı senaryo dahil) bütçe içinde geçti. Fikstürler gerçek
> personel adlarına çevrildi. Ders: reddedilen bir istekte görülen "1000 ifade" hatası bütçe sorununun kanıtı değildir; önce
> değerin doğru olduğu doğrulanmalı.

**Kalan bilinçli sınırlama:** `date` / `tarih` / `timestamp` istemci saatidir. Mevcut kayıtlar ISO / tr-TR metin olarak okunuyor;
`request.time` zorunlu kılınırsa çalışan akış kırılır. Kayıt sayısı, sırası ve aktörü artık sunucuda zorlanıyor; zaman damgası
zorlanmıyor.

#### Tur 4 · Bağımsız denetim: "aynı sayıda ama sahte içerikli olay" kapatıldı

**Denetim bulgusu doğrulandı.** Tur 3 kuralları eklenen kaydın yalnız **sayısını** ve **aktör adını** denetliyordu. Aynı
onaylayıcı, sayısı doğru ama içeriği sahte bir olay yazabiliyordu. Tur 3 kurallarında kabul edilen örnekler:
- Onayda "❌ REDDEDİLDİ" akış kaydı.
- `action: 'rollback'` history kaydı.
- Red gerekçesinden farklı bir `not`.
- Redde `'completed'` durumuna geçen history kaydı.

Ayrıca güncellenen adımın **eski** durumu denetlenmiyordu. `currentStep`'in geride kaldığı bozuk bir kayıtta, onaylanmış bir
adım yeniden onaylanabiliyor ya da reddedilebiliyordu.

**Çözüm (`poApprovalOk` + yeni `poRejectAkisOk`):**

| Denetim | Onay | Red |
|---|---|---|
| Eski adım durumu | `pending` (alan yoksa `pending` sayılır) | aynı |
| Yeni history kaydı | `action == 'transition'`, `uid == request.auth.uid`, `to != 'cancelled'` | `action == 'transition'`, `uid`, `to == 'cancelled'`, `note == 'Reddedildi: ' + gerekçe` |
| Yeni akış kayıtları | 1 kayıt: `islem` "✅ Onaylandı: …", `uid` | 3 kayıt, rejectStep sırasıyla: "❌ REDDEDİLDİ: …" / "🔄 State Geçişi: …" / "❌ Reddedildi: …"; üçünde de `uid`; `not` alanları gerekçeye bağlı |
| Adım alanları | `note` değişmez | `note` (gerekçe) boş olamaz; `currentState == 'cancelled'` |

- **UID temelli denetim (ek `get()` yok):** İstemci yeni history kaydına (`transitionWorkflowState`) ve onay / red akış
  kayıtlarına `uid: window.userAuth.uid` yazar. Kural bunu yalnız `request.auth.uid` ile karşılaştırır. Aynı adlı iki personel
  olsa da kaydı yazanın kim olduğu uid ile ayrılır.
- **Bütçe nasıl sağlandı:** Yeni denetimler ilk denemede 2 adımlı onayı bile 1000 ifade sınırının üstüne çıkardı. Tur 3'te
  2 adımlı onayın payı da yalnız 10–11 koşuldu; maliyet adım sayısından bağımsız. Çözüm olarak `textOk` (9 etiket regex'i)
  onay dalından çıkarıldı. Onaylayıcı `textOk`'un baktığı alanların hiçbirini değiştiremiyor (`affectedKeys().hasOnly(['workflow',
  'durum','akis'])`), yani orada bu denetim gereksizdi. Sahibin, talebin ve görevin yollarında `textOk` aynen duruyor.
  `poUpdateOk` kaldırıldı; sahip / onaylayıcı ayrımı update kuralında `?:` ile yapılıyor (`poOwnerUpdateOk`).
- **Değerlendirilip uygulanmayanlar** (açık risk olarak raporlandı, "tamamlandı" değil):
  - *Yeni kaydın tarihini sunucu saatine bağlamak.* Dizi içinde `serverTimestamp` kullanılamıyor; veri katmanı da yazmadan önce
    JSON kopyası alıyor (`_clean`), bu da sentinel değerleri siler. `trans_<ms>` kimliğini `request.time` ile pencere içinde
    karşılaştırmak mümkün, ama istemci saati kaymış cihazlarda meşru onayı reddeder.
  - *Onayda history `from` / `to` değerlerini akış durumuna bağlamak.* İstemcinin durum döngüsü 6 ve daha fazla adımlı akışta
    `completed`'a geçiyor, ardından `fixWorkflowCurrentStep` durumu `initiation`'a döndürüyor. Bu bağ meşru akışı kırar.
  - *Onay akış kaydındaki adım tipi.* `islem` metni "✅ Onaylandı: " önekiyle denetleniyor; ardından gelen adım tipi serbest.

**Kanıt:**
- Yeni rules bloğunda 9 test var: "J11 · P1 #5 kapanışı — aynı sayıda farklı içerikli history / akış olayı". Ayrıca 10 adımlı
  red için bir bütçe testi eklendi.
  - Testler **Tur 3 kurallarıyla** koşuldu: 6 test başarısız oldu (pending, onay history, onay akış, onay notu, red akış, red
    history).
  - Aynı testler **yeni kurallarla** geçti.
  - Eski kayıtların tarihini, aktörünü ya da içeriğini değiştirme testi iki kural setinde de geçiyor. Bu durum zaten
    `appendOnly` ile kapalıydı; test regresyon için eklendi.
- Tarayıcıda gerçek istemciyle: `flow-tests` **`j11ApprovalAudit`** (yeni, yalnız emülatör).
  - Talep sahibi 2 adımlı akışı başlatır.
  - Onaylayıcı kendi oturumunda önce aynı sayıda ama sahte içerikli bir onay yazmayı dener. Sonuç `forbidden`; sunucudaki
    belge değişmez.
  - Ardından adım 1'i **gerçek** `approveStep` ile onaylar, adım 2'yi **gerçek** `rejectStep` ile reddeder.
  - Her adım sunucudaki belgeden okunarak doğrulanır: uid'ler, olay türleri, gerekçe ve `cancelled` durumu.
- `SINIRLAMA (açık risk)` testi, geçmiş tarihli **yeni** bir kaydın kabul edildiğini **belgeler**. Bu sınırlama kapatılmış
  sayılmaz.

### P1 #6 · Demo test silme istisnası (Tur 3)

**Doğrulama:** `inventory_demo` kökünde bağlı **her** personel, `__flowtest__` içeren herhangi bir belgeyi silebiliyordu
(requests, purchaseOrders, assignments, serviceRecords, tasks).
- Bakım modu kontrol edilmiyordu.
- İşaret, personelin yazabildiği metin alanlarında aranıyordu. Personel kendi talebinin `not` alanına işaret yazıp talebi
  silebiliyordu.
- Zimmet ve servis kayıtları da bu yolla silinebiliyordu.

**Çözüm:**
- Kural ve `isTestDoc` / `marked` fonksiyonları **kaldırıldı**. Test temizliği yalnız yönetici oturumuyla yapılabilir.
- `scratch/flow-tests.js`: temizlik sayfadan (personel oturumu) değil Node tarafından yapılıyor (`cleanupMarked`). Yalnız
  emülatörün kabul ettiği kural-atlatan yönetim erişimi (`Authorization: Bearer owner`) kullanılıyor; gerçek projede bunun
  anlamı yok.
- Gerçek demoda temizlik yapılmıyor ve bu açıkça yazdırılıyor. Yönetici kimlik bilgisi betiklere girmiyor; gerçek veri test
  kolaylığı için değiştirilmiyor.
- `j1RulesAlignment` artık işaretli demo kaydını personelin **silemediğini** doğruluyor (`forbidden`, kayıt yerinde).

### P1 #7 · Talep sahibi ve workflow katılımcı kimliği (Tur 3)

**Doğrulama:** Kurallar yalnız sahiplik uid'sini doğruluyordu.
- `personel`, `personelId`, `talepEden`, `createdByName`, `createdBy` ve `creatorId` istemcinin yazdığı gibi kabul ediliyordu.
- Taslakta sahibi bu alanları değiştirebiliyordu.
- Onaylayıcı adı ile `userUid` eşleşmesi hiçbir yerde denetlenmiyordu.

**Çözüm (kurallar)** — kimlik kaynağı `staffAccounts/{uid}` ve `personel/{pid}`. Bu belgeleri `isStaff` zaten okuyor; O(N)
sorgu yok.

| Yol | Kural |
|---|---|
| `requestCreateOk` | `personel == staffName` ve `string(personelId) == staffPid`. Sayısal eski id'ler metin eşlemesiyle eşleşir. Güncellemede bu alanlar zaten değiştirilemez (`hasOnly`). |
| `poCreateOk` | `createdByName == talepEden == staffName`, `string(createdBy) == staffPid`. Yeni talep geçmişsiz başlar; en fazla tek akış kaydı taşır, o da sahibin adıyla. "Onaylandı" yazan sahte geçmişle talep açılamaz. |
| `poDraftOk` / `poWithdrawOk` | `createdBy` / `createdByName` / `talepEden` değişmez. Her işlem en fazla bir history ve bir akış kaydı ekler (`appendOneBy`). Eklenen kayıt sahibin adını taşır. |
| `poApprovalOk` | Sıradaki adımın görünen onaylayıcısı (`steps[cs].user`) onaylayanın gerçek adıyla aynı olmalı (tam ya da küçük harf eşitliği). |
| Görev oluşturma / `taskUpdateOk` | `creatorId == staffName`; oluşturan sonradan değiştiremez. |

`poDraftOk` / `poWithdrawOk`'ta sahibin adı olarak kayıttaki `createdByName` kullanılır: J11 sonrası her talepte `poCreateOk` bu
alanı `staffName`'e bağlıyor ve alan değiştirilemiyor. Bunun nedeni 10 adımlı başlatma isteğinin bütçesinin ek bir `staffName`
okumasını kaldırmaması (bkz. bütçe notu).

**Sahte onaylayıcı:** Talep sahibi bir adıma "Bora Kaya" adını yazıp başka birinin uid'sini koyarsa, o uid'nin sahibi adımı
**onaylayamaz**; yalnız yönetici onaylayabilir. Bu kontrol akış başlarken değil **karar anında** zorunlu tutulur:
- Başlatmada her adım için iki belge okuması gerekir; 10 adımda 20 ek `get()` eder ve istek başına 10 `get()` sınırını aşar.
- İstemci `_resolveWorkflowSteps` ile adı personel kaydındaki biçime zaten normalize eder.

**Ele alınan senaryolar** (`tests/rules/rules.test.mjs`, J11 · P1 #7 bloğu):
- Başkasının adıyla ya da personel id'siyle talep: reddedilir.
- Eksik ya da boş kimlik: reddedilir.
- Sayısal id ve `adSoyad` şeması: kabul edilir.
- Taslakta kimlik değiştirme: reddedilir.
- Başkası adına akış kaydı ya da çoklu kayıt: reddedilir.
- Meşru iptal ve geri çekme: kabul edilir.
- Sahte onaylayıcı: reddedilir.
- Sahte aktör (onay ve red): reddedilir.
- İkinci kez onay: reddedilir.
- Aynı isimli iki personel: yalnız adımdaki uid'nin sahibi onaylar.
- Eksik uid: yalnız yönetici onaylar.
- Görev oluşturanı değiştirme: reddedilir.
- Silinmiş personel kaydıyla yazma: reddedilir.

**İstemci:** Talep, satın alma ve görev oluşturma ile akış kayıtları görünen adı `Ownership.selfName()`'den yazar.

**Kalan sınırlar (raporlanan):**
- **J11 öncesi açılmış talepler.** Bu taleplerdeki `createdByName` geriye dönük doğrulanmaz. Sahibin kaydedilmiş adıyla
  uyuşmazsa sahibin taslak işlemleri reddedilir; yönetici yapabilir.
- **Eski akış adımları.** Görünen adı personel kaydındakinden farklı olan adımlar personel tarafından onaylanamaz, yönetici
  onaylar (güvenli tarafta başarısız olur).
- **Şablon bağı yok.** Manuel iş akışı meşru bir özellik olduğu için onaylayıcı listesi yönetici şablonuna bağlanmadı. Şablon
  yetkisi (`checkTemplateAuth`) hâlâ yalnız istemcide.

### P1 #8 · Kalite kapısı (Tur 3)

Bütün regresyon paketleri Tur 3 değişikliklerinden sonra koşuldu (aşağıdaki tablo). Akış testleri ilk koşuda 5 senaryoda
başarısız oldu. Nedenleri senaryoların `setActiveUser({ name: 'Flow Test __flowtest__' })` ile **görünen kimliği sahteleyip** o
adla yazmasıydı; yani yeni kuralların engellemesi gereken davranışın kendisiydi.

Beklentiler gevşetilmedi:
- Senaryolar oturumun gerçek kimliğiyle yazacak şekilde düzeltildi (`__ft.realIdentity()`).
- Gözlemsel senaryoların (iddiası olmayan) çıktıları ayrıca okunup gerçek başarı doğrulandı.
- `j6EkASession`'ın yazma yoklamasındaki bir düzenleme hatam (`.then` zincirini yoruma düşüren satır sonu yorumu) bulunup
  düzeltildi.

**Ortam notu:** 8080'deki Firestore emülatörü 15.10'dan kalma **öksüz** bir Java süreciydi. Üst süreci yoktu ve Auth emülatörü
(9099) çoktan kapanmıştı. Tur 2'de görülen akış testi kopmalarının nedeni buydu. Süreç durduruldu; emülatörler `npm run emu` ile
temiz başlatıldı ve tohumlandı.

J10 PRI şartları ayrıca doğrulandı:
- Girişten önce Firestore okunmaz (`j10StaffLogin`).
- Sahte `@staff` hesabı reddedilir (rules).
- F5 sonrası oturum geri yüklenir (`j6EkASession.sessionAfterReload`).
- Yönetici girişi çalışır (`j0Emulator`, `j3SessionVisa`).

### Değişen dosyalar

| Dosya | Değişiklik |
|---|---|
| `firestore.rules` | **Tur 1:** P0 kilidi, kanıt şeması, `accessGate`. **Tur 2:** onay adımında kayıt sayısı. **Tur 3:** `staffPid` / `staffName`; talep, satın alma ve görev kimlik bağları; onay anında aktör ve görünen onaylayıcı bağı; `appendOneBy`; demo silme istisnası kaldırıldı; bütçe: `?:` dağıtım, tek `get()` (`exists` kaldırıldı — olmayan belgede hata = ret), satır içi `freshSteps` ve `'pending'` eşitliği. **Tur 4:** `poApprovalOk` eski adım `pending`, history / akış olay türü, uid ve red gerekçesi bağı; `poRejectAkisOk`; onay dalında `textOk` yok; `poUpdateOk` → update kuralında `?:` + `poOwnerUpdateOk`. |
| `src/services/firebase-handler.js` | **Tur 1:** kilit API'si ve dinleyicisi, transaction'lı bağlama. **Tur 2–3:** iki aşamalı `applyCodeCleanse`, hata yolunda sunucu durumu okuma, `_runBulk` `extraGuard`. |
| `src/utils/ownership.js` | **Tur 1:** `planStaffAccessClosure`. **Tur 2:** `classifyOwnershipIssues`, yeni `planCodeCleanse`. **Tur 3:** `codeCleanseSteps`, `deleteCodesForward`, `selfName`. |
| `src/services/staff-provisioning.js` | *(Tur 1)* `errorKind`, taşıma kurtarması, `createFirestoreLinker`. |
| `src/modules/edm-workflow.js` | **Tur 3:** onay / red / başlatma / şablon geçmişinde aktör `selfName`. **Tur 4:** `transitionWorkflowState` kaydına ve onay / red akış kayıtlarına `uid`. |
| `src/services/purchase-servises.js` | **Tur 3:** talep eden / oluşturan adı ve düzenleme / iptal / geri çekme / ek silme kayıtlarında `selfName`. |
| `src/modules/inventory-logic.js`, `todo-module.js` | **Tur 3:** talep sahibi adı ve görev oluşturanı `selfName`. |
| `src/modules/auth-engine.js`, `admin.html` | *(Tur 1)* kilit okuması, VIP düğmesi. |
| `src/modules/admin/admin-system-control.js` | **Tur 1:** erişim kilidi aracı. **Tur 2–3:** kod temizliği engelleri ve gerçek sonuca göre başlık. |
| `scratch/flow-tests.js` | **Tur 3:** temizlik Node tarafına taşındı (yalnız emülatör); `realIdentity`; KJ-5 beklentisi tersine çevrildi; j1 / j6 yoklamaları gerçek kimlikle. **Tur 4:** `j11ApprovalAudit` senaryosu, `emuDoc` (sunucu okuması). |
| `scratch/_budget.sh` | **Tur 3–4:** ifade bütçesi ölçüm aracı (başlatma / onay / red, 10 adım). |
| `scratch/emu-seed.mjs` | *(Tur 1)* kilit açık tohum. |
| Testler | rules, unit (ownership, staff-provisioning), integration (ownership, staff-provisioning) |

Yeni yayın dosyası yok; yayın listesi 55/55.

### Test sonuçları (yerel — hepsi gerçekten koşuldu)

| Paket | J10 | Tur 1 | Tur 2 | Tur 3 | **Tur 4 (20.10.2026)** |
|---|---|---|---|---|---|
| `npm run test:unit` | 96 | 107 | 109 | 110/110 | **110/110** |
| `npm run test:rules` | 128 | 161 | 165 | 179/179 | **189/189** |
| `npm run test:staff:emu` | 10 | 15 | 15 | 15/15 | **15/15** |
| `npm run test:ownership:emu` | 6 | 8 | 8 | 16/16 | **16/16** |
| `npm run test:atomic:emu` | 5 | 5 | 5 | 5/5 | **5/5** |
| `node scratch/flow-tests.js --emu` | 53 | koşulmadı | 38/54 (ortam) | 54/54 | **55/55** (temiz emülatör + tohum); 0 CSP ihlali, 0 sayfa hatası |
| `npm run lint:xss` · `hosting-files.js` | 0 · 55 | aynı | aynı | 0 · 55/55 | **0 izinsiz · 55/55** |

**Tur 4 E2E notu:** Tohumlanmadan yapılan ilk tam koşu 53/55 verdi. `j10CodeCleanse` ve `j7StaffProvisioning`, bir önceki
koşunun sildiği kodlara bağlı. Emülatör temiz başlatılıp tohumlandıktan sonra, kod değişikliği olmadan 55/55 alındı.
Ayrıntı ve taban commit'e karşı önce / sonra karşılaştırması:
[Faz 4B Tur J11 Walkthrough](Faz%204B%20Tur%20J11%20Walkthrough.md) §2–3.

**İfade bütçesi (1000 ifade sınırı, Tur 3 ölçümü):** Ölçüm, `isStaff`'a `&& request.time != null` eklenerek istek başına ayrı
ayrı yapıldı (`scratch/_budget.sh`).
- 10 adımlı akış **başlatma**: pay **3 koşul**.
- 10. adımın **onayı**: pay **10–13 koşul**.
- J10'da her ikisinde de pay 12'den fazlaydı. Fark P0 kilidi ve kimlik kontrollerinden geliyor.
- **Tur 4 ölçümü:** başlatma 3–5 (değişmedi), onay 12'den fazla, red 6–8 (ilk ölçüm). Ayrıntı: devir notu §4.1.

Tur 3'te başlatma isteğini sığdırmak için yapılan tasarruflar (hepsi aynı güvenlik anlamını korur):
- Koleksiyon dağıtımı `?:` ile.
- `exists()` + `get()` çiftleri tek `get()`. Olmayan belgede `get()` hata verir, hata reddetmedir; "yoksa kapalı" korunur.
- `freshSteps` satır içi ve `status == 'pending'`. Bu daha sıkı bir koşul: istemci her adımı `pending` başlatır, taslakta adım
  listesi boştur.
- Taslakta sahibin adı için saklı `createdByName`.

**Açık dinleyici gözlemi (emülatör):** Kilit kapandıktan sonra yazılan veri açık personel dinleyicisine ulaşmadı. Üretimde
garanti varsayılmaz; istemci kilit dinleyicisi oturumu ayrıca keser.

---

## P0 runbook — deploy öncesi ve sonrası güvenli kilit sırası

Kilidin "etkinleştirilmesi" gereken bir adım **yoktur**. Kural yayına girdiği anda kilit dokümanı yoksa erişim kapalıdır. Bu
yüzden kilidin devrede olmadığı bir geçiş penceresi oluşmaz. Risk yalnız kilit dokümanının deploy'dan **önce** `true` olarak
var olmasıdır; 0. adım bunu dışlar.

0. **Deploy öncesi** (Firebase Console → Firestore): `lifeserver_master/accessGate/items/staff` ve
   `inventory_demo/accessGate/items/staff` dokümanları **olmamalı**. Bugünkü kurallarda bu koleksiyon için eşleşen kural yok,
   yani istemciden yazılamaz; yalnız Console ya da admin SDK ile oluşabilir. Varsa deploy'dan önce silinir.
1. Personele kesinti duyurulur. Kilit açılana kadar personel girişi "Personel erişimi şu an kapalı (sistem geçişi sürüyor)" mesajı
   alır.
2. **Deploy:** kurallar ve istemci **aynı anda** yayınlanır: `npx firebase deploy --only firestore:rules,hosting` (Faz 4A Deploy
   Runbook adımlarıyla, sahibin onayıyla).
3. **Hemen doğrulama:** Yönetici paneli → VIP → **Personel Erişim Kilidi** → "KAPALI (kilit kaydı yok — varsayılan)" görülmeli.
   İstenirse "Erişimi Kapat" ile açık bir kapalı kaydı yazılır (kim ve ne zaman izi kalır). Bir test personeliyle giriş yapılıp
   kapalı mesajı görülmeli.
4. **Göç** (yönetici; kilit kapalı kalır): VIP → **PRI / Hesap Göç Aracı** → **Sahiplik Göç Aracı** → **Kod Temizliği**. Yarıda
   kalan adım yeniden çalıştırılır; P1 sayesinde yarım taşınmış hesaplar `move-resumed` ile tamamlanır.
5. **Kapanış:** VIP → **Personel Erişim Kilidi**. Sekiz denetimin hepsi 0 olmalı; "Erişimi Aç" denetimi sunucuda yeniden çalıştırır
   ve geçerse açar. Bu işlem **kök başına** yapılır: canlı alan adından `lifeserver_master`, localhost / demo alan adından
   `inventory_demo` ayrı ayrı açılır.
6. **Duman testi:** Bir personel girer, okur, talep açar.

**Geri dönüş ve uyarılar:**
- Acil durumda "Erişimi Kapat" her zaman kullanılabilir. Açık personel oturumları dinleyiciyle kapanır.
- Kuralları J10'a (kilitsiz) ya da Aşama A'ya geri almak kilidi **kaldırır**. Kodlar veritabanında durduğu sürece kural geri dönüşü
  yalnız J11 kurallarına yapılmalıdır.
- Emülatör: `npm run emu` açıkken kural dosyası yeniden yüklenir. Sahibin çalışan emülatöründe kilit dokümanı yoksa personel
  girişi artık kapalı mesajı verir. Çözüm: `npm run emu:seed` (kilidi açık yazar) ya da VIP aracı.

---

## Zincir devir notu — Faz 2 (Sonnet)

**1. P0 kilidinin durumu**
- Kodda varsayılan **KAPALI**: doküman yoksa kapalıdır. Repodaki hiçbir yol kilidi kendiliğinden açmaz; tek açma yolu
  `openStaffAccess()` (VIP aracı).
- Gerçek ortamlarda (canlı ve demo) kilit dokümanı yok. J11 kuralları yayınlandığı anda kilit kapalı olur.
- Yalnız `scratch/emu-seed.mjs` normal modda emülatöre **açık** kilit yazar. `--legacy` modunda yazmaz.
- Testlerde:
  - `tests/rules` ve `ownership.emu` `beforeEach` içinde kilidi **açık** tohumlar; kapalı senaryolar ayrı `describe` / test bloklarındadır.
  - `staff-provisioning.emu` ilk iki testte kilidi kapalı tutar, sonra `seedGate(true)` ile açar.

**2. `staffAccessEnabled` şeması: nerede, nasıl okunur**
- Yol: `${COLLECTION_ROOT}/accessGate/items/staff`.
- Alanlar:

  | Alan | Tip / değer |
  |---|---|
  | `staffAccessEnabled` | bool |
  | `changedAt` | sunucu saati |
  | `changedBy` | uid |
  | `reason` | metin, ≤ 300, etiketsiz |
  | `version` | 1 |
  | `closure` | açarken zorunlu: sekiz anahtar, hepsi 0 |

- Kuralda okuma: `staffAccessOpen(root)`. Personel verisine dokunan **her** kural `isStaff` / `member` kullanmalı. Yalnız kilit
  dokümanının kendisi `staffIdentity` ile okunur.
- İstemcide okuma:
  - `window.readStaffAccessGate()`: sunucudan okur.
  - `window.getStaffAccessGateState()`: son anlık görüntü.
  - `window.renderStaffGateStatus(gate)`: kanca.
- Kanıt anahtarlarının iki kopyası var: `Ownership.CLOSURE_CHECKS` ve `firestore.rules` `closureOk`. Birim testi bu ikisini kural
  dosyasından okuyarak eşler; birini değiştiren ikisini birden değiştirmelidir.

**3. Faz 1'in Faz 2 dosyalarında bıraktığı değişiklikler**

- `firestore.rules`:
  - `isStaff` artık iki parçalı (kilit + kimlik). J10'un `isStaff`'ı `staffIdentity` adını aldı.
  - `staffPersonOk` `pid is string` denetimini içeriyor.
  - Yeni fonksiyonlar `gateBaseOk`, `closureOk`, `gateWriteOk` ve yeni `accessGate` bloğu.
- `firebase-handler.js`:
  - `reportListenerError`: personel oturumunda her ret `_resolveStaffDenial`'a gider. Eski "yalnız `personel` reddi → bağlı değil"
    davranışı bunun içine taşındı.
  - `startRealtimeSync`'e C2 kilit dinleyicisi eklendi.
  - `_linkStaffAccount` transaction'lı; `updateItem` yerine `_applyLocal` ile yerel kopyaya işler.
  - `_requireProvisioningAdmin` restore kilidine bakıyor. Bu, `planStaffAccounts` önizlemesini de etkiler.
  - Dosya sonunda yeni bölüm: "Personel erişim kilidi".
- `staff-provisioning.js`:
  - `provisionOne` ağ hatasında artık `ProvisioningStop('network')` fırlatır (önce `error` dönüyordu). Tek hesap açmada
    `provisionStaffAccount` bunu `status: 'stopped'` olarak döndürür.
  - Yeni durumlar: `move-resumed` ve `disabled`.
- `auth-engine.js` `completeStaffLogin`: giriş sonrası kilit okuması ve `_LOGIN_MSG.gateClosed`.
- `admin-system-control.js`:
  - `_PAW_STATUS` güncellendi.
  - `vipStaffAccessGate` eklendi (Kill Switch bloğunun hemen üstünde).

**4. Rules çakışma noktaları (Tur 3 ve Tur 4 ile güncellendi)**
1. **İfade bütçesi.** Ölçüm Tur 4'te yenilendi, `scratch/_budget.sh` ile istek başına ayrı ayrı (pay = `isStaff`'a eklenebilen
   `&& request.time != null` sayısı):
   - 10 adımlı **başlatma** (`poDraftOk` + `freshSteps`): pay **3–5 koşul** (Tur 3 ile aynı; değişmedi).
   - 10. adımın **onayı** (`poApprovalOk`): pay **12'den fazla** (Tur 3: 10–13; `textOk` onay dalından çıktığı için arttı).
   - 10. adımın **reddi** (`poApprovalOk` + `poRejectAkisOk`): pay **6–8 koşul** (Tur 4'te ilk kez ölçüldü).
   - **Onayın maliyeti adım sayısına neredeyse bağlı değil.** Tur 3 kurallarında 2 adımlı onayın payı da 10–11 koşuldu. Bütçenin
     çoğunu sabit kısımlar tüketiyor: kimlik, kilit, bakım ve `textOk`.

   Başlatma, onay ya da red yoluna yeni bir koşul eklemeden önce mutlaka ölçün: `bash scratch/_budget.sh <kural-kopyası> "0 3 6 9"`.
   - **Tur 2'deki "tek `get()` bile bütçeyi aşıyor" sonucu YANLIŞTI ve geri çekildi.** Aynı istekte `isStaff`'ın zaten okuduğu
     belgeler önbellektedir; `staffName` ile onay yolu bütçeye sığıyor. Reddedilen isteklerde kurallar alternatif yolları da
     değerlendirdiği için "1000 ifade" hatası çıkabilir. Bu hata, değerin yanlış olduğu bir karşılaştırmanın yan etkisi
     olabilir; önce değer doğrulanmalı.
   - Başlatma yolunun asıl maliyeti `freshSteps`: adım başına 4–6 koşul. `textOk` ikinci büyük kalem. Tur 3 tasarrufları:
     `?:` dağıtım, `exists`'siz `get()`, satır içi `freshSteps`, `'pending'` eşitliği, `appendOneBy`, taslakta saklı
     `createdByName`.
   - J10 sınırlama 2 (onaylayıcıların yönetici şablonuna karşı denetimi) uygulanmadı:
     - Manuel iş akışı meşru bir özellik.
     - Başlatma yolunda pay 3 koşul; adım başına `get()` istek başına 10 `get()` sınırını da aşar.

     Bunun yerine onaylayıcı adı ↔ uid bağı **karar anında** zorlanıyor.
2. `accessGate` `knownCol` listesine **eklenmemeli**. Eklenirse genel admin yazma bloğu kanıt şemasını atlar.
3. Yeni bir personel yolu eklenirse (yeni koleksiyon, yeni `match`), mutlaka `isStaff` ya da `member` kullanılmalı.
   `staffIdentity` kullanılırsa kilit atlanır.
4. `auditLogs` create `member()` üzerinden kilitten geçer. Kilit kapalıyken personelin self-approval kaydı da yazılamaz; bu
   bilinçli bir tercih.
5. Bakım modu (`maintenanceOn`) kilitten bağımsızdır; kilit kapalıyken değerlendirilmez. İkisini birleştirmeyin.
6. **Kayıt sayısı bağı.** `poApprovalOk`'taki onay +1/+1 ve red +1/+3 sınırları ile `appendOneBy`'ın "işlem başına en fazla bir
   kayıt" kuralı, `edm-workflow.js` / `purchase-servises.js`'in ürettiği kayıt sayısına bağlıdır. `akis.push` / `history.push`
   sayısı değişirse kural da güncellenmeli. Rules testleri ve akış testleri bu bağı yakalar.
   - **Tur 4 ile içerik bağı da eklendi.** Kural artık bu kayıtların **metnine ve sırasına** da bağlı:
     - `islem` önekleri: "✅ Onaylandı: ", "❌ REDDEDİLDİ: ", "🔄 State Geçişi: ", "❌ Reddedildi: ".
     - `not` / `note` biçimleri: "Reddedildi: " + gerekçe.
     - `uid` alanı.
     - History `action: 'transition'`.

     `approveStep` / `rejectStep` / `transitionWorkflowState`'te bu metinlerden biri değişirse aynı değişiklik
     `poApprovalOk` / `poRejectAkisOk`'a da yapılmalı. Değişiklik `flow-tests` `j11ApprovalAudit` ile doğrulanmalı (gerçek
     istemci + gerçek kurallar).
   - **`textOk` onay dalında çalışmaz.** Onaylayıcının değiştirebildiği alanlara (`hasOnly` listesi) metin alanı eklenirse,
     `textOk` o dala geri konmalı ya da yeni alan ayrıca denetlenmeli.
7. **Kimlik bağı (Tur 3).**
   - Görünen kimlik alanları (`personel`, `personelId`, `talepEden`, `createdByName`, `createdBy`, `creatorId`, `actor`,
     `yapan`, onay anında `steps[cs].user`) kurallarda `staffName` / `staffPid` ile doğrulanıyor.
   - İstemcide bu alanları yazan her yeni yol `Ownership.selfName()` kullanmalı. Aynı kaynak ve öncelik: `name` → `adSoyad` →
     `ad`, kırpılmış. Birim testi kural metniyle eşdeğerliği denetler.
   - Sahte etkin kullanıcıyla (`setActiveUser` fikstürü) yazan test yazılmamalı; `__ft.realIdentity()` kullanılmalı.
8. **`freshSteps` artık `status == 'pending'` istiyor.** Eskiden "approved/rejected olmayan" her durum kabul ediliyordu.
   Personelin başlattığı ya da taslakta tuttuğu adımlar `pending` olmalı; istemci zaten böyle yazıyor.
9. **Test temizliği.** `inventory_demo`'da personelin işaretli belge silme istisnası yok. Yeni akış testleri temizliği Node
   tarafındaki `cleanupMarked`'a bırakmalı (yalnız emülatör).

**5. Yönetici kurtarma / kod sıfırlama — KASITLI OLARAK KAPSAM DIŞI (proje sahibi onayı, 19.10.2026)**

Proje sahibi uid korumalı parola sıfırlamasının bu fazda **eklenmeyeceğini** teyit etti; bu bir eksik değil, bilinçli bir kapsam
kararıdır. Cloud Functions / Blaze ve yeni bağımlılık (`firebase-admin` + servis hesabı anahtarı) bu turda **kapsam dışı** kalmaya
devam ediyor. Faz 2 bu konuda yeni bir çözüm önermemeli; aşağıdaki tablo yalnız kayıt amaçlıdır.

| İhtiyaç | Bugün | Engel |
|---|---|---|
| Kodunu unutan personel (uid korunarak sıfırlama) | **Yok — kasıtlı.** | Firebase Console e-posta/parola kullanıcısına doğrudan parola koyamaz, yalnız sıfırlama e-postası gönderir. Adresler sentetik olduğu için (`@staff.medipol.local`) bu e-posta ulaşmaz. Tek yol `firebase-admin` `updateUser(uid, { password })` — servis hesabı anahtarı ve yerel betik ister. Sahip bu yolu **istemiyor**; operasyonel çözüm (örn. personeli yeniden kod temizliği öncesi duruma almak, yöneticinin personeli elle yeniden taşıması) sahada ele alınacak. |
| Kayıtta kodu olmayan J7 hesabının taşınması (`planAccounts` → `blocked`) | Yok — aynı kapsam dışı karar. | Aynı: `firebase-admin` `updateUser(uid, { email })`. |
| "Email enumeration protection" açıkken J7 taşıması | Araç `email-change-blocked` ile durur. | Koruma taşıma süresince Console'dan kapatılır ya da `firebase-admin` kullanılır (yine kapsam dışı). |
| Ele geçirildiğinden şüphelenilen hesabın acil kapatılması | **Var:** Console → Authentication → kullanıcıyı devre dışı bırak (uid korunur). Araç bu hesabı `disabled` olarak raporlar. Ayrıca VIP → "Erişimi Kapat" tüm personeli keser. | Tek hesap için istemci yolu yok; yukarıdaki kapsam dışı kararla tutarlı. |
| Hesabı silip yeniden açmak | **Yapılmamalı:** uid değişir, J9 sahiplik alanları sahipsiz kalır. P1 kodu bunu hiçbir durumda yapmaz. | — |

**6. Faz 2 için önerilen işler (bu turun kapsamı dışında kaldı)**
- **Kod kopyası taraması.** Kod Temizliği'nden **önce** çalışan, iç içe alanlarda da kod kopyası arayan bir tarama. Kodlar
  silindikten sonra hangi değerin kod olduğu artık bilinemez. Demo dökümünde başka kopya bulunmadı (taranan: tüm koleksiyonlar,
  iç içe tüm metin değerleri); canlıda da yapılmalı.
- **Açık kilitte yeniden denetim.** Kilit açıldıktan sonra kapanış denetimi yeniden çalışmaz. Yönetici yedekten ya da elle bir
  kod kopyası geri yazarsa kilit açık kalır; kurallar yalnız `personel.code` yazımını engeller. İsteğe bağlı: VIP aracına
  "açıkken yeniden denetle" uyarısı.
- **Akış testi senaryoları.** `scratch/flow-tests.js`'e şunlar eklenmeli:
  - Kilit kapalıyken giriş mesajı.
  - Oturum açıkken kilidin kapanması (yeniden yükleme + mesaj).
  - VIP Personel Erişim Kilidi aracı.
  - Sahte onaylayıcı adımının arayüzde personelce onaylanamaması.
- **Eski veride ad uyuşmazlığı.** J11 öncesi açılmış satın almalarda `createdByName`, eski akış adımlarında `steps[].user`
  personel kaydındaki addan farklıysa sahibin taslak işlemleri ya da onaylayıcının onayı reddedilir (güvenli tarafta). Canlı
  göçten önce bunları sayan bir ön denetim önerilir.
- **Gözlemsel akış senaryoları.** Bir kısmı iddia içermiyor (yalnız çıktı döndürüyor), bu yüzden kayıt reddedilse de "geçti"
  görünebiliyor. Tur 3'te etkilenenlerin çıktısı elle okundu. Bu senaryolara açık iddia eklemek kalite kapısını güçlendirir.

---

## Açık riskler (denetçi için)

> **Proje sahibi kararı (19.10.2026):** Canlıda kullanan kişi sayısı kısıtlı; aşağıdaki 1. madde ("geçmiş sızıntı") bu nedenle
> **kabul edilmiş risk** olarak işaretlendi, ek işlem istenmiyor. Yönetici kurtarma / kod sıfırlama da (bkz. Faz 2 devir notu §5)
> kasıtlı olarak kapsam dışı bırakıldı. İkisi de aşağıda **kayıt amacıyla** duruyor; Faz 2 bunlar için yeni iş açmamalı.

1. **(KABUL EDİLDİ — sahip onayı) Kodlar daha önce açığa çıkmış olabilir.** J10 öncesi kurallarda (Aşama A, `99946ee`) her
   oturumlu (anonim dahil) istemci personel listesini okuyabiliyordu. Canlıda o sürüm yayındaysa bugünkü kodlar teorik olarak
   sızmış sayılırdı. Sahip, kullanıcı sayısının kısıtlı olması nedeniyle bunu gerçek bir risk olarak görmüyor ve kodların
   şimdiden yenilenmesini istemiyor. Kilit yine de **yeni** sızıntıyı önlüyor; bu madde yalnız geçmişe dönük teorik pencereyle
   ilgili ve kapatıldı.
2. **Kanıt sayıları kurallarca doğrulanamaz.** Yönetici güvenilir taraftır. Konsoldan sahte "0" kanıtı yazılabilir; istemci yolu
   (VIP aracı) yazamaz.
3. **Açık dinleyiciler.** Emülatörde kapanıştan sonra veri gelmediği kanıtlandı. Üretimde açık bir dinleyicinin sunucuda hemen
   kesileceği garanti varsayılmadı.
   - İstemci kilit dinleyicisi oturumu keser, ancak kötü niyetli bir istemci bunu yok sayabilir.
   - O durumda üst sınır bir sonraki yeniden yetkilendirmedir (token yenilemesi, yaklaşık 1 saat).
   - Kilit kapanış denetimi geçmeden açılmadığı için bu pencere yalnız "kilit açıldıktan sonra yeniden kapatma" senaryosunda
     anlamlıdır.
4. **Kesinti.** Deploy'dan kilit açılana kadar personel sistemi kullanamaz (tasarım gereği).
5. **(KASITLI KAPSAM DIŞI — sahip onayı) Yönetici kurtarma / kod sıfırlama yok.** Ayrıntı: Faz 2 devir notu §5. Yeni bağımlılık
   (`firebase-admin`) istenmediği için bu tur hiçbir çözüm önermiyor; kodunu unutan personel operasyonel olarak ele alınacak.
6. **(Tur 3'te KAPATILDI) Onay/red aktör taklidi.** Tur 2'de "bütçe nedeniyle uygulanamaz" diye raporlanmıştı; bu yanlıştı (bkz.
   P1 #5). Adım, history ve akış kayıtlarındaki aktör artık onaylayanın gerçek personel adına bağlı.
7. **(AÇIK — Tur 4'te yeniden değerlendirildi) Yeni kaydın zaman damgası istemci saatidir.** Onay ve akış kayıtlarına eklenen
   **yeni** kaydın `date` / `tarih` / `timestamp` alanı sunucuda doğrulanmaz. Geçmiş tarihli yeni kayıt kabul edilir (rules
   testi `SINIRLAMA (açık risk)` bunu belgeler).
   - Sunucuda doğrulananlar: kayıt sayısı ve sırası, olay türü, aktör adı, `uid`, red gerekçesi ve eski adımın `pending` olması.
     **Eski** kayıtların tarihi de değiştirilemez (`appendOnly`).
   - Neden kapatılamadı: dizi içinde `serverTimestamp` yok, veri katmanı JSON kopyası alıyor. `trans_<ms>` kimliğini
     `request.time` ile karşılaştırmak, saati kaymış cihazlarda meşru onayı reddeder.
   - Sunucu saatli iz gerekiyorsa `auditLogs` (`ts == request.time`) kullanılmalı. Alternatif olarak, dizi dışında bir harita
     alanına (`kararlar.<adım>.at == request.time`) yazmak mümkün; bu veri katmanında sentinel desteği ister ve Faz 2'ye önerilir.
10. **(AÇIK) Onayda history `from` / `to` serbest; adım tipi metni serbest.** Onayda yeni history kaydının `to` değeri yalnız
    `'cancelled'` olamaz; `from` denetlenmez. Gerekçe: istemcinin durum döngüsü 6 ve daha fazla adımlı akışta `completed`'a
    geçip `initiation`'a döner, bu yüzden değer akış durumuna bağlanamaz. Akış kaydının `islem` metninde önek denetlenir; adım
    tipi kısmı serbesttir. Bu alanlar karar mantığını etkilemez; karar `steps[cs].status`, `currentStep`, `finished` ve `durum`
    alanlarından okunur ve bunların hepsi bağlıdır.
8. **Onaylayıcı adı ↔ uid akış başlarken doğrulanmaz.** Karar anında doğrulanır: sahte etiketli bir adım onaylanamaz ve akış o
   adımda yöneticiye kalır. Talep sahibi bu yolla akışı kilitleyebilir, ama sahte bir onay üretemez.
9. **J11 öncesi kayıtlar.** Görünen kimlik alanları geriye dönük doğrulanmaz. Sahiplik göçü ve kapanış denetimi sahiplik
   uid'lerini doğrular, ad alanlarını doğrulamaz.
