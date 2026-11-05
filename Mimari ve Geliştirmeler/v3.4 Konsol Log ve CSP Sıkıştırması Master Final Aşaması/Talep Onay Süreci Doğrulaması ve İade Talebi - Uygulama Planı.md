# Talep Onay Süreci ve İade Talebi — Uygulama Planı (Revizyon 2)

> **Tarih:** 05.11.2026 · **Revizyon 2:** ürün sahibinin 05.11.2026 kararları işlendi
> **Dal:** `feat/v3.4-ebys-asama-5` (HEAD `8350f91`)
> **Durum:** **ONAY BEKLİYOR — henüz uygulanmadı.** Kod değişikliği onaydan sonra başlar. Bu revizyon için koda dokunulmadı.
> **Ekler:**
> - `Talep Onay Süreci - Test Kanıtları.txt` (mevcut sürecin doğrulama çıktıları)
> - `scratch/request-flow-e2e.cjs` (uçtan uca test; bu planla genişletilecek)

## İçindekiler

1. [Kararlar ve revizyon özeti](#1-kararlar-ve-revizyon-özeti)
2. [Mevcut sürecin doğrulama özeti](#2-mevcut-sürecin-doğrulama-özeti)
3. [B-1 · Sarf malzeme = tüketim çıkışı](#3-b-1--sarf-malzeme--tüketim-çıkışı)
4. [B-2 · Red gerekçesi](#4-b-2--red-gerekçesi)
5. [B-3 · Onay / teslim bekleyen işlemler için rozet](#5-b-3--onay--teslim-bekleyen-işlemler-için-rozet)
6. [Yeni · Bekleyen talep rozeti (admin üst çubuğu)](#6-yeni--bekleyen-talep-rozeti-admin-üst-çubuğu)
7. [B-4 · Taslak talepler — öneri](#7-b-4--taslak-talepler--öneri)
8. [Teknik düzeltmeler (B-5, B-6) ve sütun adı](#8-teknik-düzeltmeler-b-5-b-6-ve-sütun-adı)
9. [Envanter iade talebi](#9-envanter-iade-talebi)
10. [Test planı](#10-test-planı)
11. [Uygulama sırası ve tahmini iş](#11-uygulama-sırası-ve-tahmini-iş)
12. [Onay listesi](#12-onay-listesi)

---

## 1. Kararlar ve revizyon özeti

| Konu | Karar (05.11.2026) | Plandaki karşılığı |
|---|---|---|
| B-1 Sarf | Tüketim çıkışı sayılsın | Sarf onayı zimmet değil, çıkış kaydı yazar. Mevcut sarf zimmetleri tek seferlik, önizlemeli göçle düzeltilir (§3). |
| B-2 Red | Personele red gerekçesi gönderilebilsin | Red penceresinde zorunlu gerekçe; personel Taleplerim'de görür (§4). |
| B-3 Ayrım | Admin onayı / tamamlanması bekleyen işlemler rozetle ayrılsın (Taleplerim'deki "bekliyor" deseni gibi) | Zimmet ekranında ve Kişi Envanteri'nde durum rozetleri (§5). |
| Yeni rozet | Bekleyen talepler için `admin-nav-todo-badge` benzeri rozet; yer için `btn-security-report` gizlenebilir | Admin üst çubuğunda "Bekleyen Talepler" rozeti; güvenlik raporu Sistem Kontrol sekmesine taşınır, erişim kaybolmaz (§6). |
| B-4 Taslak | Öneri istendi | Taslaklar yönetici listelerinden çıkarılsın; başlıkta yalnız sayaç kalsın (§7). |
| İade — hasar | Hasar varsa admin karar verir | İade onay penceresinde "cihaz durumu" ve "depoya alınsın mı" admin kararı (§9.5). |
| İade — depo | Admin cihazı teslim alırsa depo sorulsun (özel pencere), sonra stoğa düşsün | Özel iade onay penceresi; depo seçimi; stok, zimmet kapanışı ve iade kaydı tek işlemde (§9.5). |
| İade — liste | İadeler listeden kalkmasın; admin görüntüleyebilsin, rapor alabilsin, isterse ek onayla silebilsin | Tamamlanan iadeler tabloda kalır; "Görüntüle", "İade Tutanağı", "Sil" (çift onaylı) (§9.6). |
| Sütun adı (4) | Uygun, olsun | "Gelen Talepler"deki ikinci sütun **"ITSM / Seri No"** olur (§8). |
| İadeyi kimler işler (3) | Yanıt verilmedi | **Varsayılan:** yalnız yöneticiler (admin + canlı yönetici muhammed.cer). Farklıysa §12'de belirtin. |

## 2. Mevcut sürecin doğrulama özeti

Mevcut süreçte **hata yok**. Ayrıntı ve komut çıktıları `Talep Onay Süreci - Test Kanıtları.txt` içinde.

- Gerçek kod ve emülatörde kural tekrarıyla 14 yazmanın tamamı geçti.
- Onay stoktan düşüyor ve kişiye zimmet kaydı açıyor; demirbaşta cihaz başına kayıt ve Seri No / Envanter No zorunlu.
- Red stok ve zimmete dokunmuyor.
- Zimmet admin ekranına onay anında düşüyor; Kişi Envanteri'ne "Teslim Aldım" ile geçiyor.
- "Zimmetten Düş" stoğu iade ediyor.
- Personelin yetkisiz denemeleri reddediliyor.

Bu revizyon, bulunan aksamaları (B-1…B-6) ve yeni özellikleri kapsar.

## 3. B-1 · Sarf malzeme = tüketim çıkışı

**Bugün:** `confirmRequest` her onayda `tip: 'zimmet'` yazıyor. Tükenen sarf kişinin Kişi Envanteri'nde ve zimmet tutanağında süresiz kalıyor.

**Yeni davranış:**

1. **Onay:** Seçilen stok kalemi ya da talep sarfsa (`Schema.isDemirbas` false), onay `tip: 'cikis'` yazar. Kayıtta `requestId`, alan kişi ve onaylayan bulunur.
   - Kayıt B3 "Envanter Takibi"nde görünür.
   - Kişi Envanteri'ne, zimmet tutanağına ve admin Zimmet ekranına **girmez**.
   - Demirbaş onayı değişmez.
2. **Teslim:** Sarf talebinde de "Teslim Aldım" kalır ve talebi kapatır (personel teslim bilgisi korunur). "Taleplerim"de sarf satırı "Tüketim çıkışı" notuyla gösterilir.
3. **Mevcut kayıtlar — tek seferlik göç** (admin › Sistem Kontrol, mevcut göç araçlarının deseni):
   - Önizleme: hangi kişide kaç sarf zimmeti var, toplam adet.
   - Onayla: `tip: 'zimmet'` → `'cikis'`. Yalnız `isDemirbas === false` ve iade edilmemiş kayıtlar değişir.
   - İşlem aynı veriyle ikinci kez çalıştırılırsa hiçbir şey değiştirmez (idempotent). Denetim günlüğüne yazılır.
4. **Etki:** Stok değişmez. Bu kayıtlar artık "Zimmetten Düş" önermez.

**Dosyalar:** `script.js` (onay), yeni göç fonksiyonu (`src/modules/admin/` altında), `assignment-service.js` dokunulmaz.

## 4. B-2 · Red gerekçesi

1. **Red penceresi:** "Reddet" tıklanınca özel bir pencere açılır (EBYS'deki karar penceresi düzeninde).
   - Talep özeti görünür.
   - **Gerekçe zorunlu:** en fazla 1000 karakter, HTML etiketi yasak. Hazır seçenekler sunulur ("Stokta yok", "Bütçe uygun değil", "Mükerrer talep", "Bilgi eksik", "Diğer") ve serbest açıklama eklenir.
2. **Kayıt:** Talebe `redGerekcesi`, `rejectedBy`, `rejectedAt` alanları **yalnız bu alanlar olarak** yazılır (`updateItem`; B-5 de böylece kapanır).
3. **Personel:** Taleplerim'de "REDDEDİLDİ" rozetinin altında gerekçe görünür (`textContent` ile güvenli).
4. **Yönetici tabloları:** Gelen Talepler ve admin Bekleyen Envanter Talepleri'nde reddedilen satırda gerekçe ipucu metni olarak görünür.
5. **Kurallar:** Değişiklik yok. Yönetici yazıyor; personel bu alanı değiştiremiyor (`requestUpdateOk` listesinde yok). Kural testi eklenir.

## 5. B-3 · Onay / teslim bekleyen işlemler için rozet

Amaç: tamamlanmamış işlem, tamamlanmış zimmetten ilk bakışta ayrılsın. Rozet dili, personelin Taleplerim'de gördüğüyle aynı olacak (`status-badge-pill` sınıfları).

**Durumlar ve göründükleri yerler:**

| Durum | Rozet | Zimmet ekranı (admin) | Kişi Envanteri (personel) |
|---|---|---|---|
| Talep onaylandı, personel teslim almadı | ⏳ **Teslim Bekliyor** (sarı) | Evet | Ayrı bir "Teslim bekleyenler" satır grubu |
| Teslim alındı / doğrudan zimmet | 📌 **Zimmetli** (mavi) | Evet | Normal satır |
| İade talebi gönderildi, admin onayı bekliyor | ↩️ **İade Onayı Bekliyor** (turuncu) | Evet | Satırda rozet; "İade Talebi" düğmesi yerine |
| İade edildi | ✅ **İade Edildi** (yeşil) | Evet | Görünmez (üzerinden düşmüştür) |

**Ek davranışlar:**

- **Zimmet ekranı:** Durum filtresine "Teslim Bekliyor" ve "İade Onayı Bekliyor" seçenekleri eklenir. KPI kartlarına "Teslim bekleyen" sayısı eklenir.
- **Kişi Envanteri:** Teslim bekleyen kalem varsa üstte kısa bir açıklama görünür: *"Onaylanan N kalem teslim almanızı bekliyor; 'Taleplerim'den 'Teslim Aldım' deyin."* Taleplerim'e bağlantı verilir.
- **Zimmet tutanağı:** Kuralı değişmez; yalnız teslim alınanları basar.
- **Veri:** Rozetler mevcut alanlardan türetilir (`teslimAlindi`, `iadeEdildi`, iade talebinin durumu). Yeni veri yazılmaz.

## 6. Yeni · Bekleyen talep rozeti (admin üst çubuğu)

**Amaç:** Yeni bir envanter talebi ya da iade talebi geldiğinde yönetici, tabloya gitmeden geldiğini ve kaç tane beklediğini görsün.

1. **Yer:** `admin.html` › `.action-buttons.me-3`, mevcut görev rozetinin (`admin-nav-todo-badge`) hemen yanında. Aynı bileşen ve stil kullanılır (`todo-nav-badge-container`, `todo-nav-badge`).
   - İkon: 📨 (`fa-inbox`).
   - Kimlik: `admin-nav-request-badge`, sayaç `admin-nav-request-count`.
2. **Sayı:** Bekleyen envanter talepleri + bekleyen iade talepleri. Taslaklar ve işlenmişler sayılmaz.
   - İpucu metninde kırılım görünür: "3 envanter talebi · 1 iade talebi bekliyor".
   - Sayı 0 ise rozet pasif görünür (`is-passive`, görev rozetiyle aynı).
3. **Canlı güncelleme:** `requests` ve `returnRequests` her güncellendiğinde (`onInventoryDataUpdated`) sayı yeniden hesaplanır.
   - Sayı **arttığında** rozet kısa bir nabız animasyonu yapar. "Hareketi azalt" tercihi olan kullanıcıda animasyon kapalı.
   - Ekran okuyucu için `aria-live="polite"` ile "Yeni talep geldi" bildirilir.
4. **Tıklayınca:** "Talep ve Süreçler" sekmesi açılır ve "📨 Bekleyen Envanter Talepleri" kartına kaydırılır.
5. **Yer açma — `btn-security-report`:** Üst çubuktan kaldırılır. Güvenlik raporuna erişim **kaybolmasın** diye düğme **Sistem Kontrol (VIP)** sekmesinin başına "Güvenlik Raporu (kendi kendini onaylama denetimi)" olarak taşınır. Index'teki yönetici navbar düğmesi değişmez.
6. **Index (isteğe bağlı, önerilen):** Yönetici oturumunda "Gelen Talepler" sekme düğmesinin üzerinde aynı sayaç küçük bir rozet olarak gösterilsin. Tek ek satır; aynı sayaç fonksiyonu kullanılır.

## 7. B-4 · Taslak talepler — öneri

**Bugün:** Personelin göndermediği (ya da geri çektiği) taslaklar iki yerde görünüyor:

- index "Gelen Talepler": `draft` durumu ve "İşlem Yapıldı" yazısıyla (yanıltıcı),
- admin "Bekleyen Envanter Talepleri": "TASLAK" rozetiyle.

**Öneri: taslaklar yönetici listelerinden çıkarılsın.**

- **Gerekçe:**
  - Taslak, personelin henüz karar vermediği, kendine ait bir çalışmadır; yönetici üzerinde işlem yapamaz (kurallar onay/red'i yalnız bekleyen talepte kabul eder).
  - Listede durması hem kalabalık yaratıyor hem "işlenmiş" izlenimi veriyor.
  - Geri çekilen talep yöneticinin gözünden kaybolmaz: personel yeniden gönderdiğinde "Beklemede" olarak tekrar listeye ve §6 rozetine düşer.
- **Görünürlük kaybı olmasın diye:** Tablo başlığında küçük, tıklanamaz bir bilgi satırı kalır: *"Personelin gönderilmemiş N taslak talebi var (listelenmez)."*
- **Değişmeyenler:** Personelin Taleplerim ekranı ve taslağı düzenleme / gönderme akışı.
- **Alternatif (önerilmez):** Taslakları tabloda bırakıp "Gönderilmedi" rozeti ve işlem sütununda "—" göstermek. Görünürlük artar ama kalabalık sürer.

## 8. Teknik düzeltmeler (B-5, B-6) ve sütun adı

- **B-5:** Red artık yalnız değişen alanları yazar (§4). Eşzamanlı düzenlemeyi ezme riski kalkar.
- **B-6:** Talebe bağlı zimmet/çıkış kaydı zaten varsa onay durur ve uyarır: *"Bu talebe bağlı kayıt zaten var; stok düşülmedi."* Stok yeniden düşülmez.
- **Sütun adı:** "Gelen Talepler" tablosunda `ITSM / Gerekçe` → **`ITSM / Seri No`** (karar 4). Onayda bu alana demirbaşın seri numaraları ya da ITSM bilgisi yazılıyor. B3 ve çıkış ekranlarındaki "ITSM / Gerekçe" etiketi değişmez.

## 9. Envanter iade talebi

### 9.1 Kapsam

- Karar 1 gereği sarf artık zimmet olmadığı için iade talebi **yalnız demirbaş zimmetleri** içindir.
- Her zimmet kaydı tek cihazdır; talep cihaz başına açılır.

### 9.2 Veri modeli — yeni koleksiyon `returnRequests`

- **Neden ayrı koleksiyon:** `requests` içine konsaydı, onaylanan iade zimmet servisinde **yeni zimmet** gibi görünürdü.
- **Belge kimliği:** `ret_<zimmetId>`. Aynı cihaz için tek açık talep olur; reddedilen talep aynı belgeyle yeniden gönderilir.

| Alan | Yazan | Açıklama |
|---|---|---|
| `id`, `zimmetId` | Personel | b3 zimmet kaydı |
| `personelId`, `personel`, `personelUid` | Personel | Oturumla aynı olmak zorunda |
| `urun`, `sn`, `envanterNo`, `kaynakDepo`, `productId` | Personel | Talep anındaki görünüm (rapor için) |
| `gerekce`, `aciklama` | Personel | Gerekçe zorunlu: "Ayrılış / görev değişikliği", "Arıza", "İhtiyaç kalmadı", "Değişim", "Diğer" |
| `bildirilenDurum` | Personel | Personelin beyanı: "Çalışır", "Arızalı", "Hasarlı", "Eksik parça" |
| `durum` | İkisi | `Beklemede` → `approved` / `rejected`; personel geri çekerse `withdrawn` |
| `tarih`, `ts` | Personel | Oluşturma zamanı |
| `teslimAlindi`, `iadeDepo`, `adminCihazDurumu`, `adminNotu`, `onaylayan`, `onayTarihi` | Yönetici | Onay kararı (§9.5) |
| `redGerekcesi`, `reddeden`, `redTarihi` | Yönetici | Red kararı |

### 9.3 Firestore kuralları

- **Okuma:** Yönetici tümünü; personel yalnız kendininkini (`personelUid == auth.uid`).
- **Personel oluşturma:** Belge kimliği `ret_` + `zimmetId` ve `durum: 'Beklemede'` olmalı. Ayrıca:
  - sahiplik alanları oturumla aynı olmalı (`staffPid`, `staffName`);
  - `get(b3/zimmetId)` kaydı `tip == 'zimmet'`, `isDemirbas == true`, `personelId == staffPid`, `iadeEdildi != true` olmalı;
  - metinler etiketsiz ve sınırlı, alan listesi kapalı; bakım modu kapalı.
- **Personel güncelleme:**
  - `Beklemede → withdrawn` (geri çekme);
  - `rejected → Beklemede` (yeniden gönderme; yalnız gerekçe, açıklama, beyan ve tarih değişebilir).
- **Yönetici onayı:** `approved` yazılırken aynı işlemde zimmet kapanmış olmalı: `getAfter(b3/zimmetId).iadeEdildi == true`. Zimmet kapanmadan iade "onaylandı" görünemez.
- **Yönetici silme:** Yalnız `approved` / `rejected` / `withdrawn` durumdaki kayıt silinebilir. Bekleyen talep silinemez; önce karar verilir.
- **Liste güncellemeleri:** `knownCol` listesine, `COLLECTIONS` listesine, yedekleme/geri yükleme kapsamına ve yayın dosya listesine eklenir.

### 9.4 Personel arayüzü (index › Kişi Envanteri)

- **Satır düğmesi:** Demirbaş satırlarında **"İade Talebi"** düğmesi. Açık talep varsa yerine ↩️ "İade Onayı Bekliyor" rozeti görünür.
- **Talep penceresi:**
  - Ürün / SN / Env. No salt okunur;
  - gerekçe, cihaz durumu beyanı, açıklama;
  - üstte kısa açıklama: *"Talebiniz yöneticiye gider. Yönetici cihazı teslim aldığında üzerinizden düşer ve iade tutanağı oluşur."*
- **Yeni alt bölüm "İade Taleplerim":**
  - Durum rozeti; red gerekçesi; onaylananda "İade Tutanağı" düğmesi.
  - Bekleyen talep **geri çekilebilir**, reddedilen talep **yeniden gönderilebilir**.
- **AGENTS.md uyumu:** Her yeni bölümde görünür kısa açıklama ve bilgi düğmesiyle açılan yardım alanı.

### 9.5 Yönetici onayı — özel iade penceresi

Kararlar: hasar durumunda admin karar verir; cihaz teslim alındıysa depo sorulur ve stoğa düşer.

"Onayla"ya basınca açılan **İade Onayı** penceresi:

1. **Özet:** Personel, ürün, SN / Env. No, personelin gerekçesi ve **beyan ettiği durum** (ör. "Hasarlı").
2. **"Cihazı teslim aldınız mı?"**
   - **Evet, teslim aldım** →
     - **Cihaz durumu (admin kararı):** Sağlam / Arızalı / Hasarlı / Eksik parça. Varsayılan, personelin beyanı.
     - **"Hangi depoya alınsın?"** B1 / B2 seçimi; ürünün kaynak deposu ön seçili gelir.
     - **"Stoğa ekle"** seçeneği: sağlamda işaretli gelir. Arızalı / hasarlıda **admin işaretleyip işaretlememeye karar verir.**
       - İşaretliyse ürün kalemine +1.
       - İşaretsizse stok değişmez; cihaz depoda fiziken durur ve durumu iade tutanağına ve nota yazılır. Servis / hurda süreci gerekiyorsa admin mevcut sevk akışıyla ayrıca başlatır.
   - **Hayır, teslim almadan kapat** (ör. kayıp, personel ayrıldı): Depo sorulmaz, stok değişmez. **Açıklama zorunlu.** Zimmet kapanır, tutanakta "Teslim alınmadan kapatıldı" yazar.
3. **Admin notu:** İsteğe bağlı; iade tutanağına girer.
4. **Kayıt — tek işlem** (`runStockOps` ya da `applyItemOps`; ya hepsi ya hiçbiri):
   - stoğa eklenecekse stok +1;
   - b3 zimmet kapanışı (`iadeEdildi`, `iadeDepo`, `iadeEdildiTarihi`);
   - iade talebi `approved` + karar alanları;
   - cihaz bağlı talebin son açık cihazıysa talebin `iadeEdildi` alanı.
5. **Ortak kapanış mantığı:** "Zimmetten Düş" (`inventory-management.removeAssignment`) içindeki kapanış mantığı paylaşılan bir plan fonksiyonuna taşınır (`AssignmentService.planClose`). İki yol aynı kodu kullanır. Doğrudan "Zimmetten Düş" de aynı özel pencereyi kullanır; bugünkü basit depo sorusu kalkar.
6. **Red:** Zorunlu gerekçeyle (§4'teki pencere bileşeni). Zimmet değişmez.
7. **Kendi iadesini onaylama:** Yöneticinin kendi iade talebinde mevcut parola doğrulaması (`guardSelfApproval`) uygulanır.

### 9.6 Yönetici tabloları — iki yerde, aynı modül

Ortak modül `src/modules/return-requests.js`; index ve admin sayfaları aynı tabloyu ve işlemleri kullanır.

- **Yerler:**
  - **index › Gelen Talepler:** mevcut tablonun altında ikinci tablo, **"Gelen İade Talepleri"**;
  - **admin › Talep ve Süreçler › 📨 Bekleyen Envanter Talepleri:** aynı kartta ikinci tablo, **"İade Talepleri"** (ayrı sayaç). İşlemler buradan da yapılabilir.
- **Sütunlar:** Tarih · Personel · Ürün · SN / Env. No · Gerekçe · Beyan / Admin kararı · Durum · İşlem.
- **İadeler listeden kalkmaz (karar):** Tamamlanan, reddedilen ve geri çekilen talepler tabloda kalır. Tablonun üstünde durum süzgeci var: "Bekleyen" (varsayılan) / "Tamamlanan" / "Tümü". Bekleyenler her zaman en üstte.
- **İşlemler:**
  - *Bekleyen:* Onayla (§9.5) · Reddet.
  - *Tamamlanan / reddedilen:* **Görüntüle** (detay penceresi: tüm alanlar, karar, tarihler, kim) · **İade Tutanağı** (yalnız onaylananda) · **Sil**.
- **Sil — ek onay (karar):**
  1. İlk onay penceresi: *"Bu iade kaydı listeden kalıcı olarak silinecek. Cihazın zimmet kapanışı ve stok hareketi geri alınmaz."*
  2. İkinci adım: admin kaydı tanıtan kısa ifadeyi (ör. cihazın Env. No'su) yazar ve "Kalıcı olarak sil"e basar.
  - Silme denetim günlüğüne yazılır.
  - Bekleyen talep silinemez (kural da reddeder).
- **Boş tablo metni:** *"Personelin üzerindeki demirbaşı iade etmek için gönderdiği talepler burada listelenir. Onayladığınızda cihaz kişinin üzerinden düşer; teslim aldıysanız seçtiğiniz depoya eklenir."*

### 9.7 İade tutanağı (PDF)

- **Veri:** `AssignmentService.generateReturnData(returnRequestId)`. Mevcut belge sözleşmesi (`envelope` / `belgeRow`) kullanılır:
  - `tur: 'iade'`, belge no `IT-…`;
  - kalem durumu "iade", iade tarihi, depo;
  - personelin gerekçesi ve beyanı, **admin cihaz durumu kararı**, stoğa eklenip eklenmediği, admin notu;
  - teslim eden (personel) ve teslim alan (onaylayan) imza alanları.
- **Çıktı:** `pdf-generator.js` › `generateReturnPDF(id)`. Zimmet tutanağıyla aynı görsel düzen, başlık "Envanter İade Tutanağı".
- **Erişim:**
  - iki yönetici tablosu;
  - personelin "İade Taleplerim" bölümü;
  - admin Zimmet ekranındaki "İade Edildi" satırları. Talepsiz "Zimmetten Düş" ile kapananlar da kapsanır; veri b3 kapanışından üretilir.
- **Silinen kayıt:** İade talebi silinse de b3 kapanışı durduğu için Zimmet ekranından tutanak yine alınabilir (talebe ait gerekçe alanları olmadan).

## 10. Test planı

| Katman | Kapsam |
|---|---|
| Kural testleri | `returnRequests`: oluşturma (kendi aktif demirbaş zimmeti); reddedilenler: başkasının / iade edilmiş / sarf / zimmet olmayan kayıt, ikinci açık talep, sahiplik sahteciliği, etiketli metin. Geri çekme / yeniden gönderme. Personel onaylayamaz / reddedemez / silemez. Yönetici onayı zimmet kapanmadan reddedilir, kapanışla aynı işlemde geçer. Bekleyen talep silinemez. Bakım modu ve erişim kilidi. Red gerekçesi personel tarafından değiştirilemez. |
| Birim testleri | Sarf onayı = çıkış; demirbaş onayı = zimmet. Sarf göçü (önizleme, idempotent, iade edilmiş kayda dokunmaz). `planClose` (stoğa ekle / ekleme / teslim alınmadan kapat; çok cihazlı talebin son cihazı). `generateReturnData` sözleşmesi. Bekleyen sayaç (taslak ve işlenmiş sayılmaz). Rozet durum türetme. |
| Uçtan uca (`scratch/request-flow-e2e.cjs`) | Sarf onayı → B3 çıkışı, Kişi Envanteri'nde yok. Red penceresi → gerekçe Taleplerim'de. Teslim Bekliyor rozeti → teslim → Zimmetli. Üst çubuk rozeti 0 → 1 → 0 ve tıklama yönlendirmesi. Taslak listede yok, sayaç satırı var. İade talebi → iki tabloda → onay (teslim alındı, hasarlı, stoğa ekleme kararı) → zimmet kapandı, stok kararla uyumlu, tutanak verisi. İade listede kalıyor → çift onaylı silme. Tüm yazmaların emülatörde kimliğiyle tekrarı. |
| Gerileme | Mevcut birim ve kural paketleri, XSS kapısı, yayın dosya listesi, önceki tarayıcı kontrolleri. |

## 11. Uygulama sırası ve tahmini iş

| Faz | İçerik | Tahmin |
|---|---|---|
| 1 | B-2 red penceresi + gerekçe (B-5 dahil), B-4 taslak süzme, B-6, sütun adı | 0,5 gün |
| 2 | B-1 sarf = çıkış + sarf göç aracı | 0,5–1 gün |
| 3 | B-3 durum rozetleri (Zimmet ekranı, Kişi Envanteri) + §6 bekleyen talep rozeti, güvenlik raporunun taşınması | 0,5–1 gün |
| 4 | İade: koleksiyon + kurallar + kural testleri | 1 gün |
| 5 | İade: personel arayüzü, ortak yönetici modülü (iki tablo, görüntüle / sil), iade onay penceresi, `planClose` paylaşımı | 1,5–2 gün |
| 6 | İade tutanağı PDF + Zimmet ekranı bağlantıları | 0,5 gün |
| 7 | Uçtan uca test, walkthrough ve test kanıtları; yayın (önce kurallar, sonra hosting) | 0,5 gün |

**Toplam:** yaklaşık 5–6 gün. Faz 1–3 bağımsız yayınlanabilir; iade fazları (4–6) birlikte yayınlanır.

**Yayın notları:**

- Sarf göçü canlı veride çalıştırılmadan önce önizleme çıktısı sizinle paylaşılır.
- Kurallar yalnız izin ekler; önce kurallar yayınlanır.

## 12. Onay listesi

Onay için maddeleri işaretleyin; değiştirmek istediğiniz maddeyi belirtin.

- [ ] §3 Sarf = tüketim çıkışı + mevcut sarf zimmetleri için önizlemeli tek seferlik göç
- [ ] §4 Red penceresi: zorunlu gerekçe + hazır seçenekler; personel Taleplerim'de görür
- [ ] §5 Durum rozetleri: Teslim Bekliyor / Zimmetli / İade Onayı Bekliyor / İade Edildi
- [ ] §6 Admin üst çubuğunda bekleyen talep rozeti; güvenlik raporu Sistem Kontrol (VIP) sekmesine taşınır
- [ ] §6.6 (isteğe bağlı) Index "Gelen Talepler" sekme düğmesinde de sayaç
- [ ] §7 Taslaklar yönetici listelerinden çıkarılır, başlıkta yalnız sayaç kalır
- [ ] §8 Sütun adı "ITSM / Seri No"
- [ ] §9.5 İade onay penceresi: teslim alındı mı → admin cihaz durumu kararı → depo seçimi → stoğa ekle (hasarlıda admin kararı) / teslim almadan kapat
- [ ] §9.6 İadeler listede kalır; Görüntüle / İade Tutanağı / çift onaylı Sil (ikinci adımda Env. No yazılır); bekleyen talep silinemez
- [ ] §9.6 "Zimmetten Düş" de aynı iade onay penceresini kullanır
- [ ] Karar 3 varsayılanı: iade taleplerini yalnız yöneticiler işler
