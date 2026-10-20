# Faz 4B Kapanış Walkthrough — Kimlik Modeli, PRI Göçü, Aşama B Kuralları ve Zero-Trust Doğrulamaları

> **Okuyucu:** proje sahibi ve canlı göçü yürütecek yönetici. Bu belge Faz 4B'yi kapatır. İçinde iki şey var: PRI kimlik
> mimarisinin nasıl çalıştığı ve **canlı ortamda** uygulanacak adım adım runbook.
>
> Tur ayrıntıları: [Faz 4B Tur J10](Faz%204B%20Tur%20J10%20Walkthrough.md) (PRI ve Aşama B),
> [Faz 4B Tur J11](Faz%204B%20Tur%20J11%20Walkthrough.md) (P0 kilidi ve J11–J11.7 denetim düzeltmeleri, teslim raporu),
> [Faz 4B Mega Fix](Faz%204B%20Mega%20Fix%20Walkthrough.md) (tasarım notları, devir notu).
> Yayın komutları: [Faz 4A Deploy Runbook](Faz%204A%20Deploy%20Runbook.md).

## Durum

| | |
|---|---|
| Dal | `feat/phase-4b-identity-model` → `master` (`--no-ff` merge) |
| Son güvenlik commit'i | `e643949` (J11.7) |
| Kod | Merge ile `master`'da; deploy'a hazır |
| Deploy ve canlı göç | **Yapılmadı.** Aşağıdaki runbook ile, sahibin kararıyla yapılacak. |
| Bağımsız denetim | J11 57 → J11.5 76 → J11.6 84 → J11.7 teslim edildi. Nihai GO / NO-GO kararı denetçinindir. |

**Son ölçülen test sonuçları** (J11.7, emülatör):

| Paket | Sonuç |
|---|---|
| unit | 122/122 |
| rules | 207/207 |
| staff emülatörü | 15/15 |
| ownership emülatörü | 17/17 |
| atomic emülatörü | 5/5 |
| E2E (temiz emülatör + tohum) | 55/55; 0 CSP ihlali, 0 sayfa hatası |
| XSS | 0 izinsiz |
| hosting | 55 dosya |

---

## 1. PRI kimlik mimarisi — nasıl çalışır

**Kimlik.** Her personelin bir **kurumsal kimliği (PRI)** vardır: `ad.soyad` biçiminde, Türkçe harflerden arındırılmış, küçük harf.
- Örnek: "Ayşe Yılmaz" → `ayse.yilmaz`.
- Aynı PRI başka personelde varsa sonuna sayı eklenir (`ayse.yilmaz2`).
- PRI'yi yönetici atar ya da önerilen değeri kabul eder. Hesap açıldıktan sonra PRI kilitlenir.

**Hesap.** PRI'ye karşılık bir Firebase Auth hesabı açılır:
- e-posta: `<pri>@staff.medipol.local`
- parola: `giriş kodu + "Mdp!"`

Kod ve PRI yöneticiye **bir kez** gösterilir. Kod veritabanında saklanmaz; eski kayıtlardaki kodlar Kod Temizliği ile silinir.

**Giriş (zero-lookup).**
- Giriş ekranında iki kutu var: kurumsal kimlik ve kod.
- İstemci girişten **önce veritabanını hiç okumaz**; doğrudan `signInWithEmailAndPassword` çağırır.
- Bilinmeyen kimlik ile yanlış kod aynı mesajı verir. Böylece bir hesabın var olup olmadığı dışarıya sızmaz.
- Girişten sonra:
  1. Erişim kilidi okunur.
  2. Oturum uid ile personel kaydına bağlanır.
- Yönetici girişi değişmedi.

**Kurallar personeli nasıl tanır** (Aşama B, `isStaff`):
1. **Kilit açık:** `${root}/accessGate/items/staff.staffAccessEnabled === true`.
2. **Oturum:** e-posta / parola oturumu ve `<pri>@staff.medipol.local` deseninde e-posta.
3. **Eşleme:** `staffAccounts/{uid}` → `{ personelId, pri }`. Bunu yalnız yönetici yazar.
4. **Personel kaydı:** eşlemenin gösterdiği kayıtta aynı `uid` ve aynı `pri`.

Dört koşuldan biri tutmazsa kullanıcı personel sayılmaz. Ziyaretçi (oturumsuz ya da bağsız hesap) hiçbir şey okuyamaz.

**P0 erişim kilidi (fail-closed).**
- **Varsayılan kapalı:** kilit belgesi yoksa, alan yoksa, tipi yanlışsa ya da değeri `false` ise kilit kapalıdır. Kapalıyken
  hiçbir personel okuyamaz ve yazamaz; yönetici etkilenmez.
- **Kilit açılırken kurallar şunları ister:**
  - sekiz kapanış sayacının hepsi 0;
  - `changedAt` sunucu saati;
  - `changedBy` açanın kendi uid'si;
  - `version` 1.
- **Kapatma** her zaman serbesttir. Kilit kök başına ayrıdır: `lifeserver_master` ve `inventory_demo`.

**Zero-trust doğrulamaları (J11–J11.7):**
- **Görünen kimlik alanları** oturum sahibinin gerçek kaydına bağlı: talep sahibi, oluşturan, onaylayan, aktör.
- **Onay adımı:**
  - Yalnız sırası gelmiş onaylayıcı karar verebilir ve yalnız `pending` durumdaki adım için.
  - Akış durumu, durum makinesinin tek meşru sonraki durumuna geçer.
  - Eklenen history / akış kaydının sayısı, türü, uid'si ve gerekçesi gerçek istemcinin ürettiğiyle aynı olmalı.
- **Talep sahibi:**
  - Yalnız istemcinin ürettiği olay türlerini, kendi uid'siyle ekleyebilir.
  - Başlatma, iptal ve geri çekme kayıtları zorunludur.
  - `workflow.currentState` alanını sahte bir değere çekemez.
- **Kod Temizliği** hiçbir değeri otomatik `unknown` yapmaz. İki aşamada çalışır:
  1. Geri alınabilir dönüşümler, AtomicWriter ile hepsi-ya-da-hiçbiri.
  2. Kod silme, en son ve yeniden çalıştırılabilir biçimde.
- **Kodlar silinmeden önce durur.** Çözülemeyen ya da çakışan her `createdBy` bir engeldir; kod sahibinin kendi id'si / adıyla
  aynıysa da engel oluşur.

---

## 2. Canlı ortam runbook'u

> **Kural:** Her adım kök başına uygulanır: canlı alan adından `lifeserver_master`, demo / localhost'tan `inventory_demo`. Bir adım
> yarıda kalırsa **yeniden çalıştırmak güvenlidir**. Tüm araçlar idempotent; yarım işi tamamlar, iki kez yazmaz. Kilit hiçbir
> adımda kendiliğinden açılmaz.

### Adım 0 — Hazırlık (deploy'dan önce, canlıya dokunmadan)

| # | İş | Beklenen |
|---|---|---|
| 0.1 | `git checkout master` · `git log -1`: Faz 4B merge commit'i | `feat(phase-4b): complete identity model…` |
| 0.2 | `node scratch/hosting-files.js` | `✔ Yalnız uygulama dosyaları yayınlanacak.` · **55** dosya (kök 20, src 32, pdf-fonts 3). Faz 4A runbook'undaki "47" sayısı eskidi. |
| 0.3 | İsteğe bağlı prova: önizleme kanalı (Faz 4A 0.12) | Canlıya dokunmaz |
| 0.4 | **DB snapshot** (VIP, Faz 4A Adım 1) | İndirilmiş yedek |
| 0.5 | Personele kesinti duyurusu | Deploy'dan kilit açılana kadar personel giremez (tasarım gereği) |

### Adım 1 — Kilit kontrolü (deploy'dan ÖNCE, Firebase Console → Firestore)

| # | Kontrol | Beklenen / yapılacak |
|---|---|---|
| 1.1 | `lifeserver_master/accessGate/items/staff` | **Olmamalı.** Varsa silinir. Bugünkü kurallar bu yola istemciden yazmaya izin vermez; yalnız Console ya da admin SDK ile oluşmuş olabilir. |
| 1.2 | `inventory_demo/accessGate/items/staff` | Aynı |
| 1.3 | Authentication: `p…@staff.medipol.local` (J7 adresli) hesaplar var mı? | Yoksa taşıma adımı hiç çalışmaz. Varsa taşıma `updateEmail` ister; "Email enumeration protection" açıksa araç açık bir mesajla durur. Bu durumda koruma taşıma süresince kapatılır. |

**Neden önce?** Kilit belgesi deploy'dan önce `true` olarak duruyorsa, yeni kurallar yayına girdiği anda personel, kodlar henüz
silinmemişken listeyi okuyabilir. 1.1 ve 1.2 bu açığı kapatır.

### Adım 2 — Deploy (sahibin onayıyla)

1. Kurallar ve istemci **aynı komutla** yayınlanır: `npx firebase deploy --only firestore:rules,hosting`. Faz 4A Adım 2'deki
   adımlar izlenir.
2. **Hemen doğrulama:**
   - Yönetici paneli → VIP → **Personel Erişim Kilidi**: "KAPALI (kilit kaydı yok — varsayılan)" görünmeli.
   - Bir test personeliyle giriş: "Personel erişimi şu an kapalı (sistem geçişi sürüyor)" mesajı görünmeli.
3. Faz 4A Adım 3 (yönetici parolası) ve Adım 4 (5 dakikalık canlı doğrulama) uygulanır.

### Adım 3 — Auth göçü: VIP → PRI / Hesap Göç Aracı

1. **Önizleme.** Hiçbir şey yazmaz. Kişi başına atanacak PRI ve yapılacak işlem görünür: PRI yaz / hesap aç / J7 hesabını taşı /
   eşlemeyi yenile. Kod gösterilmez.
2. **Uygula.**
   - Ağ, kota ya da yetki hatasında iş **durur**, satırlar hata türüyle raporlanır. Bağlantı gelince yeniden çalıştırılır.
     Auth tarafında tamamlanmış ama bağı düşmüş taşımalar `move-resumed` ile aynı uid'ye bağlanır.
   - `conflict` / `uid-mismatch` satırlarına hiçbir şey yazılmaz. Yönetici kaydı inceler; çoğu zaman farklı bir PRI seçer.
     Uid değiştirme ya da yeniden bağlama aracı **yok** (kasıtlı).
   - Kodu olmayan personel için tablodan "Hesap Aç" yapılır.
3. **Bitiş ölçütü:** Personel Erişim Kilidi ekranında `accountsMissing`, `accountsInconsistent` ve `accountMapMismatch`
   sayaçları 0.

### Adım 4 — Sahiplik göçü: VIP → Sahiplik Göç Aracı

1. **Önizleme.** Hiçbir şey yazmaz.
2. **Uygula.**
   - Yalnız boş sahiplik alanlarına uid yazılır: `personelUid`, `createdByUid`, `creatorUid`. Dolu uid hiçbir zaman
     değiştirilmez.
   - Önizlemeden sonra değişen kayıt atlanır (`changed-since-preview`).
   - Personel listesi önizlemeden sonra değiştiyse araç hiç yazmadan durur.
   - Bir parça düşerse yazılanlar kalıcıdır, kalanlar raporlanır; yeniden çalıştırma tamamlar.
3. **Çözülemeyen sahiplik** (belirsiz ad, hesapsız sahip) elle düzeltilir.
4. **Bitiş ölçütü:** `ownershipPending` ve `ownershipUnresolved` 0.

### Adım 5 — Kod Temizliği: VIP → Kod Temizliği

1. **Önizleme ve engeller.** Engel varken "Uygula" çalışmaz; sunucu da `not-ready` ile reddeder. Engeller:
   - hesabı olmayan ya da tutarsız personel (Adım 3);
   - bekleyen ya da çözülemeyen sahiplik (Adım 4);
   - **`purchaseOrderUnresolved`** — yönetici kaydı elle düzeltmeden geçilmez:
     - `createdBy` hiçbir personel id'sine, ada, sistem değerine ya da bugünkü bir koda çözülemiyor (eski ya da tireli kod,
       silinmiş personel);
     - aynı kod birden fazla personelde ortak;
     - **kod / kimlik çakışması:** bir personelin geçerli kodu başka bir personelin id'si / adı ya da `admin` gibi bir sistem
       değeri;
     - **kod / görünür kimlik çakışması:** kod sahibinin kendi id'si ya da adıyla aynı.

   > **Kod / görünür kimlik çakışmasında sahip kararı gerekir.** Bu personelin parolası (kod + "Mdp!") görünür bir kimlikten
   > tahmin edilebilir. `createdBy` dönüşümü bunu çözmez; kodun silinmesi de Auth parolasını değiştirmez. Parola yenileme kapsam
   > dışıdır (bkz. §3).
2. **Uygula** iki aşamada çalışır:
   1. **Geri alınabilir dönüşümler** (`purchaseOrders.createdBy` → personel id'si, `requests.personelKodu` silme): AtomicWriter
      ile hepsi-ya-da-hiçbiri.
   2. **`personel.code` silme**, en son ve ileri yönlü.
3. **Sonuç başlıkları:**

   | Başlık | Anlamı ve yapılacak |
   |---|---|
   | `✓ tamamlandı` | Bitti |
   | `✗ hiçbir şey yazılmadı` | 1. aşama geri alındı; yeniden çalıştırın |
   | `⚠ kısmen tamamlandı` | 2. aşama yarıda; yeniden çalıştırın, yalnız kalan kodlar silinir |
   | `⚠ yarıda kaldı — kilitli` | Geri alma tamamlanamadı (`rollback-pending`); bkz. aşağıdaki kurtarma |
   | `⚠ sonuç kesin değil` | Sonuç doğrulanamadı; önizlemeyi yeniden açıp durumu kontrol edin |

   **`rollback-pending` kurtarması:** Yönetici sekmesi açık kalırsa kurtarma 30 sn sonra kendiliğinden denenir; sonraki her
   yönetici oturumunda da kilit görülünce denenir (`recoverBulkWrite`). Bitince Kod Temizliği yeniden çalıştırılır.
4. **Bitiş ölçütü:** `personelCodes`, `requestCodes` ve `purchaseOrderCodes` 0.

### Adım 6 — Kilidi açma: VIP → Personel Erişim Kilidi

1. Sekiz denetimin hepsi **0** olmalı. Her denetimin ilk 10 sorunlu kaydı ve çözüm adımı ekranda görünür.
2. **"Erişimi Aç".** Denetim sunucudan **yeniden** okunarak çalıştırılır; önizlemeye güvenilmez. Sayılardan biri 0 değilse ya da
   yarım bir toplu yazma kilidi varsa yazmaz. Kurallar kanıtın şeklini ayrıca doğrular.
3. **Kök başına** yapılır: canlı alan adından `lifeserver_master`, demo alan adından `inventory_demo`.

### Adım 7 — Duman testi ve Console

1. Bir personel girer ve verileri görür.
2. Talep açar.
3. Satın alma talebinde akış başlatır.
4. Onaylayıcı kendi oturumunda onaylar; başka bir talepte reddeder.
5. **Console → Authentication:**
   - **Anonymous** sağlayıcı kapatılır.
   - E-posta ile hesap açma **açık kalır**, çünkü "Yeni Personel" hesabı istemciden açıyor.

### Acil durum ve geri dönüş

- **"Erişimi Kapat"** her zaman kullanılabilir. Açık personel oturumları dinleyiciyle kesilir.
- **Kuralları J10'a ya da Aşama A'ya geri ALMAYIN.** Bu, kilidi kaldırır. Kodlar veritabanında durduğu sürece kural geri dönüşü
  yalnız Faz 4B kurallarına yapılır.
- Hosting geri dönüşü: Faz 4A Adım 5.

---

## 3. Açık riskler ve sahip kararları

1. **Kodu kendi id'si ya da adıyla aynı olan personel** (Adım 5). Parola tahmin edilebilir. Engel kilidi açtırmaz, ama çözüm
   (parola / hesap yenileme) kapsam dışı ve sahip kararıdır.
   - Kişi düzeyinde tespit yok: böyle bir kod hiçbir `createdBy`'da geçmiyorsa engellenmez.
2. **Kodunu unutan personel.** İstemciden parola sıfırlanamaz (kasıtlı kapsam dışı). Uid'yi koruyan bir `firebase-admin` betiği
   gerekir.
3. **Yeni kaydın tarihi istemci saatidir.** Onay ve akış kayıtlarında sunucu saati doğrulanmaz. Sayı, tür, aktör ve uid
   doğrulanır.
4. **Kanıt sayıları kurallarca doğrulanamaz.** Yönetici güvenilir taraftır; Console'dan sahte bir "0" kanıtı yazılabilir.
5. **Kilit açıldıktan sonra yeniden denetim yok.** Yedekten geri gelen bir kod kopyası kilidi kendiliğinden kapatmaz. Kapanış
   ekranı yeniden açıldığında sayılır.
6. **Kesinti.** Deploy'dan kilit açılana kadar personel sistemi kullanamaz (tasarım gereği).
7. **Bütçe.** 1000 ifade sınırına kalan pay:

   | İstek (10 adım) | Pay |
   |---|---|
   | Başlatma | 6–8 |
   | Onay | 12'den fazla |
   | Red | 6–8 |

   Bu yollara yeni koşul eklenmeden önce `bash scratch/_budget.sh` ile ölçüm şart.

Ayrıntılı liste: [Faz 4B Tur J11 Walkthrough](Faz%204B%20Tur%20J11%20Walkthrough.md) §8, §11.6, §12.5, §13.4.
