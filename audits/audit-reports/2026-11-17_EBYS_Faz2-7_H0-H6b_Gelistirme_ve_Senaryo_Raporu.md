# EBYS Aşama 2–7 ve H0–H6b — Geliştirme Özeti ve Canlı Teyit Senaryoları

**Tarih:** 17 Kasım 2026 · **Kaynak:** `audits/audit-reports/` altındaki ilgili uygulama/denetim raporları (Aşama 2-7: 13 dosya, H0-H4: 24 dosya) + bu oturumda doğrudan yapılan/okunan H5, H6a, H6a-hotfix, H6b çalışması.
**Yöntem:** Belge okuması; bu rapor kod değiştirmez, canlı veri okumaz. Her madde ilgili uygulama/denetim raporuna dayanır; "Somut senaryo" satırları ekranda gerçekten teyit edilebilecek, belgede geçen buton/ekran adlarıyla yazıldı.
**Kronolojik sıra not:** Belgelerdeki bağımlılık notlarına göre gerçek sıra **Aşama 2→3→4→5→6→7 → H0 → Q0 → Kullanıcı Kabul (U1-U4) → H1 → H2 → H3-A → H3-B → H4 → H5 → H6a → H6a-hotfix / H6b**'dir (H6a-hotfix ve H6b aynı ağaçta paralel yürüdü).

---

## Aşama 2 — Tanımlar: kurum, birim, personel ilişkisi

**Ne eklendi:** Birimlere kalıcı ID, kurum ID, kod, üst birim, `active`; personele kalıcı ID, Auth UID, birincil birim, görev/unvan. Silme → "Pasifleştir"e çevrildi (fiziksel silme herkese, admin dahil, kapalı). Birim hiyerarşisi (üst birim, döngü, kurum bağı, en fazla 4 seviye) servis + Rules ile denetleniyor.

**Somut senaryo:**
- Admin › Tanımlar › bir birimi düzenle → modalda kalıcı ID, kurum ID, kod, üst birim, "Aktif" kutusu görünmeli.
- "Sil" yerine "Pasifleştir" davranışı: basınca kayıt kaybolmaz, `active:false` olur; "Aktif" kutusuyla geri açılabilir.
- Aynı adlı iki personel, birim katılımcı aramasında ayrı ID/UID etiketiyle ayrı gösterilir.
- Pasif birime yeni personel/alt birim bağlama reddedilir; satın alma formunda pasif birimler yeni seçimde çıkmaz, eski kayıtlarda görünmeye devam eder.

**Düzeltilen bulgu:** P2-4 (Aşama 3 denetiminde) — ilk commit personel modalı bağlantı hunk'larını eksik bırakmıştı; yerelde doğrulanıp kapatıldı.

## Aşama 3 — Satın alma: çok kalemli ve dövizli

**Ne eklendi:** Satın Alma Talepleri (EBYS) formunda kalem tablosu (açıklama, tür, miktar, birim, birim fiyat, TRY/USD/EUR, KDV), pilot üst sınır **3 kalem**. İlk onayda kur/tarih/kaynak zorunlu; `reportingTotalTRY` o anda donuyor, sonradan kur değişse bile sabit kalıyor. Eski tek-ürünlü kayıtlar göçsüz, sanal tek kalemle gösteriliyor.

**Somut senaryo:**
- Yeni talepte kalem ekle (ör. 2 adet 100 TRY + 1 adet USD kalemi) → toplamların para birimi bazında canlı hesaplandığını gör.
- Kur/tarih/kaynak girilmeden onaylama reddedilir; girilip onaylanınca TRY karşılığı donuyor.
- Yönetici genel kuru sonradan değiştirse de (USD 30→40), bu talebin Detay/Yazdır önizlemesindeki TL karşılığı **değişmiyor**.

**Düzeltilen bulgular (aynı gün):** P1-1 (kur zorunlu değildi), P1-2 (legacy kayıt zorla yeni şemaya geçebiliyordu), P2-1 (yazdırma/özet toplam tutarsızlığı), P2-2 (pasif personele yeni atama), P2-3 (geçersiz ondalık girişi).

## Aşama 4 — Evrak Kayıt Defteri (Gelen/Giden/İç Yazışma)

**Ne eklendi:** Admin › Talepler ve Süreçler altına Evrak Kayıt Defteri; üst yazı formu; `saveDraft→freezeVersion` ile SHA-256 özetli değişmez sürüm; sayaçsız kriptografik kayıt no (`EBYS-{KURUM}-{YYMMDD}-{32HEX}`); KPI kartları (Toplam/Taslak/Kayıtlı/Dondurulan).

**Somut senaryo:**
- Evrak Kayıt Defteri › İç Yazışmalar › **Yeni evrak** → doldur → **Taslağı kaydet**.
- Taslağı aç → **Kesin kayıt numarası al** → **Onaya sun / Dondur** → gövde artık düzenlenemez; **Çıktı önizleme**'de kayıt no ve "sürüm 1" görünür.
- KPI sayıları gerçek sunucu sorgusundan geliyor, liste yenilenince güncelleniyor.
- Yazar olmayan biri içeriği SDK'dan okumaya çalışırsa reddedilir.

**Düzeltilen bulgular:** A4-01 (numara çakışmasında retry eksikti → 5 denemeye çıkarıldı, Aşama 5'te), A4-02 (Hosting dosya sayısı tutmuyordu → düzeltildi).

## Aşama 5 — Bana Gelen Onaylar, sürüm bazlı yetki

**Ne eklendi:** `ebysProcesses`/`ebysTasks` (deterministik görev), rota başlatma/karar/vekâlet/geri çekme API'leri. Bana Gelen Onaylar artık yetkili görev sorgusundan besleniyor; yeniden sunum = yeni sürüm/süreç.

**Somut senaryo:**
- Dondurulmuş evrakta **Süreç durumu** → imzacı ekle (A: Paraf, B: Onay) → **Süreci başlat**.
- B hesabı, Bana Gelen Onaylar › **Evrak görevlerim**'de A karar vermeden evrakı görmemeli; A onaylayınca B'nin görevi belirir.
- B **Yazara iade et** + gerekçe → yazar **Geri dönen evraklarım**'da görür, icra açılmaz; **Yeni sürüm hazırla** ile devam eder.
- A'nın **"Karar verdiğim sürümü aç"** düğmesi yalnız kendi karar verdiği sürümü açar (yeni sürüme erişemez).

**Düzeltilen bulgular (P1!):** A5-01 — finans snapshot kontrolü yazılabilir `id`'den hesaplanıyordu, eski/düşük kurlu talebe referans vererek güncel kur denetimi atlatılabiliyordu; aynı aşama kapanmadan düzeltildi. A5-02 (geri çekmede geçmiş erişim yanlış kapanıyordu), A5-03 (hata dalında dinleyici sızıntısı).

## Aşama 6 — Havale ve icra

**Ne eklendi:** Havale Tanımları (evrak türü + birim → icra birimi/sorumlu/hedef süre); son onaydan sonra otomatik tek icra işi; İcra Takibi / İcra İşlerim ekranları.

**Somut senaryo:**
- Yönetici **İcra Takibi › Havale Tanımları**'nda tür+birim+sorumlu+süre tanımlar.
- Son onaydan sonra iş "Kabul bekliyor"; sorumlu **İcra İşlerim › Görevi aç › Kabul Et**.
- **Tamamla** (sonuç+kanıt) → iş "Tamamlandı", evrak "Kapandı"; yazar **Evrak Bildirimlerim**'de bildirim görür.
- İade edilen iş yönetici **"Havale Bekleyen İadeler"**de görünür, **Yeniden Havale Et** ile başka kişiye gider.

**Düzeltilen bulgular:** A6-01 (çift sekmeden kapanışta başarılı işlem hata gibi görünüyordu), A6-02 (yedekleme 5 yeni icra koleksiyonunu kapsamıyordu) — aynı gün KESİN GO'ya yükseltildi.

## Aşama 7 — Doğrulama QR ve arşiv

**Ne eklendi:** Kapalı/arşivlenmiş, kesin numaralı evraklar için Doğrulama QR'ı; anonim `verify.html` yalnız 5 alan gösterir (evrak no, kayıt tarihi, konu özeti, durum, SHA-256).

**Somut senaryo:**
- Kapalı evrakta **Doğrulama QR'ı oluştur** → **Çıktı önizleme → Yazdır**'da QR görünür.
- QR linkini anonim pencerede aç → yalnız 5 alan görünür, evrak gövdesi/kişi adı görünmez.
- Yönetici **Arşivle** → bağlantı "Arşivde" gösterir; **Doğrulamayı iptal et** → "İptal" gösterir.

6 Kasım'da `medipol-inventory-v3`'e canlı yayın yapıldığı belgelenmiş (Aşama 1-7 için).

---

## H0 — Görev süresi/saat sınırı düzeltmesi

**Ne eklendi:** Normal görevlerde süre artık `validFrom: serverTimestamp()` + 90 gün göreli; açık vekâletler mutlak tarihte kalmaya devam ediyor (istemci saati ileri giderse eski yöntem 90 günü aşabiliyordu).

**Somut senaryo:**
- A→B→A→A rotası: A'da hedef süre ve karar düğmeleri; B henüz içeriği açamaz.
- Süresi bitmiş görevde "yöneticinizden durumu kontrol etmesini isteyin" uyarısı.
- İade sonrası yeni sürümde eski karar sahibi yalnız eski sürümü açabilir.

*Açık not: görsel/klavye UAT yapılmadı.*

## Q0 — Kuyruk/defter performans ve görünürlük (R1/R2 dahil)

**Ne eklendi:** Kart başına dinleyici kaldırıldı (isteğe bağlı "Konu/sürüm/durum" düğmesi); defter toplamları ilk açılış + açık **"Toplamları yenile"** ile.

**Somut senaryo:**
- "Bana Gelen Onaylar"da kart ayrıntı düğmesiyle bilgi aç.
- Karar formuna not yazıp sekme değiştir, dönünce not ve düğmeler korunmalı (otomatik gönderim yok) — Q0-R1.
- Defterde "Toplamları yenile"ye basmadan sayfa değiştir; toplamlar otomatik yenilenmemeli — Q0-R2.

## Kullanıcı Kabul — U1-U4

**Ne eklendi:** (U1) "Durumu yeniden kontrol et" ilk açılışta gizli; (U2) EBYS KPI bloğu defterden ayrılıp öne taşındı; (U3) iade sonrası sürüm ayrımı doğrulandı; (U4) "Toplamları yenile" geri bildirimi netleşti.

**Somut senaryo:**
- Normal açılışta "Durumu yeniden kontrol et" gizli, yalnız hata durumunda çıkar.
- Admin'de EBYS KPI bloğu artık defterin hemen önünde ayrı blok; 390px/koyu temada taşmıyor.
- v1 oluştur → iade ettir → v2 ile yeni rota: yeni görevli v2/yeni metin, eski karar sahibi yalnız v1/eski metin görür; sırası gelmeyen `permission-denied` alır.

*Not: "eski metin görme" ilk şikâyeti yeniden üretilemedi — canlı teyitte U3 özenle tekrarlanmalı.*

## H1 — Kişisel kopya (export) ve kurumsal QR/demo kurtarma

**Ne eklendi:** `ebys-document-service.js`'e kişisel kopya kapsamı (400 istek/500 belge sınırı). `tools/ebys-local-recovery.mjs` — ayrı demo/operatör CLI aracı (ürün ekranı değil).

**Somut senaryo:**
- Sahip olunan evrakta "Evrak kopyasını indir" → inen dosya yalnız sahip olunan + kamusal QR kayıtlarını içerir.

*Bulgu (H2'de kapandı):* `ebys-local-recovery.mjs` yanlışlıkla Hosting paketine giriyordu.

## H2 — Belge türleri, evrak durumu etiketleri, rehber

**Ne eklendi:** H1 Hosting bulgusu kapandı; belge türü desteği satın alma seçilebilirliğinden ayrıldı; defterde yanıltıcı "İcrada" filtresi kaldırılıp başlık "Evrak durumu" oldu, İcra Takibi'ne yönlendirme eklendi.

**Somut senaryo:**
- Tanımlar tablosunda üç/dört defteri bul.
- Defterde başlığın "Evrak durumu" olduğunu, İcra Takibi yönlendirmesinin göründüğünü doğrula.

*Açık not: Auth oturumlu görsel kabul yapılmadı, yalnız headless tarayıcı kanıtı var.*

## H3-A, H3-B, H4 — **Canlıda test edilecek yeni ekran YOK**

Üçü de görünür UI üretmedi; bilinçli olarak öyle tasarlandı ("Kullanıcıya yeni talep yolu H5/H6a kabulünden sonra açılacak" — H4 walkthrough'u):
- **H3-A** (9-10 Kasım): birim kimliği/tek onay motoru tasarımı — yalnız izole prototip + 3 tasarım raporu, ürün koduna dokunmadı.
- **H3-B** (10 Kasım): `ebys-purchase-schema.js` — saf yardımcı modül, hiçbir ürün ekranından çağrılmıyordu.
- **H4** (10 Kasım): `createPurchaseDocument`/`savePurchaseDraft`/`freezePurchaseVersion`/`getPurchaseView`/`getPurchaseApprovalPreview` servis + Rules köprüsü — belgede açıkça "yeni ürün düğmesi, DOM bağı veya otomatik okuma eklenmez."

**Bu üçü için tek anlamlı canlı kontrol:** mevcut satın alma ve EBYS ekranlarının hiçbir görünür fark olmadan eskisi gibi çalışması (regresyon).

---

## H5 — Satın alma formu ↔ yeni servis bağlantısı *(bu oturumda yapıldı; ayrı audit dosyası yazılmadı)*

**Ne eklendi:** H4'teki dormant servisler (`createPurchaseDocument`, `freezePurchaseVersion`) ilk kez UI'dan çağrıldı. Satın alma modalına (`index.html`, `admin.html`) **"EBYS süreciyle gönder"** düğmesi eklendi; mevcut kalem editörünü (`purchase-items-ui.js`) aynen kullanıyor. Liste satırlarına `engineVersion==='ebys-v1'` için **"EBYS"** rozeti eklendi.

**Somut senaryo:**
- Satın Alma Talepleri'nde "Yeni Talep" aç, kalem(ler) gir, **"EBYS süreciyle gönder"**'e bas → onay rotası seçme penceresi (süreç başlatma) açılmalı.
- Liste satırında bu talebin yanında küçük **"EBYS"** rozeti görünmeli; eski (legacy) talepler rozetsiz, eskisi gibi görünmeye devam etmeli.

## H6a — Dormant EBYS kuyruk/karar UI'ının bağlanması *(bu oturumda yapıldı; ayrı audit dosyası yazılmadı)*

**Ne eklendi:** `ebys-process-ui.js` (272 satır, zaten yazılmıştı) hiçbir HTML'e script-tag ile eklenmemişti — `#ebysMyTasks`/`#ebysMyReturned` tamamen boştu. Script-tag eklendi; "Bana Gelen Onaylar"daki iki bölüme (EBYS Evrakı / Satın Alma Talebi) ayırt edici rozet eklendi; legacy `approveStep`/`rejectStep`/`stopWorkflow` butonlarına görsel disabled/spinner çifte-işlem koruması eklendi.

**Somut senaryo:**
- "Bana Gelen Onaylar"da artık "Evrak görevlerim" ve "Geri dönen evraklarım" bölümleri **dolu/çalışır** durumda (önceden kalıcı olarak boştu).
- Bölüm başlıklarında 📄 EBYS / 🧾 Satın Alma rozetleri görünür.
- Bir onay/red butonuna basınca buton anlık olarak devre dışı kalıp spinner gösterir (art arda iki tıklamada tek işlem olur).

## H6a-hotfix — Birim/Personel Yönetimi UX *(12 Kasım, `2026-11-12_EBYS_H6a_Hotfix_Birim_Personel_UX_Walkthrough.md`)*

**Ne eklendi:** Birim tablosundaki "üç liste üst üste" karmaşası giderildi; yalnız gerçek bağ (`personel.unitId`) gösteriliyor, 3+ kişide `<details>` ile katlanıyor. Yeni **"+ Personel Ekle"** hızlı aksiyonu. İki yeni rehber modalı: "Birim Yönetimi Rehberi", "Personel Yönetimi Rehberi". Personel Tanımları tablosundaki birim hücresi de aynı gerçek kaynağa göre düzeltildi.

**Somut senaryo:**
- Birim Yönetimi tablosunda bir birim satırında **"Personel Ekle"** → arama → kişi seç → tablo ve Personel Tanımları tablosu güncellenir.
- Birim adının yanındaki küçük kopyala ikonuyla kalıcı ID panoya kopyalanır.
- Başlıklardaki sade **"❓ Rehber"** düğmesiyle ilgili rehber modalı açılır.
- Personel Tanımları'nda bir kişinin birim hücresi, birim ataması yoksa "Birim ataması yok" der (eski "Birim ID: eski ad kaydı" ifadesi kalkmıştır).

## H6b — Kurum Künyesi, Dosya Planı, Üst Yazı Şablonları *(12 Kasım, `2026-11-12_EBYS_H6b_...Walkthrough.md`, paralel oturum)*

**Ne eklendi:** Kurum künyesi (ad/kod/adres vb.), yönetilen dosya planı, sürümlü üst yazı şablonları — evrak bunların **kopyasını** dondurulmuş sürüme mühürler (tanım sonradan değişse de evrak etkilenmez).

**Somut senaryo:**
- Admin › Tanımlar'da yeni **"Kurum Künyesi"**, **"Dosya Planı"**, **"Üst Yazı Şablonları"** alt sekmeleri görünür; her birinde kısa açıklama + "Nasıl çalışır?" yardımı.
- Yeni evrak formunda kurum kodu artık künyeden gelir ve kilitlidir; dosya planı yalnız aktif planlardan seçilir; **"Şablondan doldur"** ile şablon metni forma dolar.
- Künye/şablon sonradan değişse/pasife alınsa bile, önceden dondurulmuş bir evrakın önizlemesi **eski** künye/şablon bilgisini göstermeye devam eder.

---

## Genel gözlem

- Hiçbir fazda P0 (kritik/engelleyici) bulgu yok; en ciddi bulgu Aşama 5'teki **A5-01** (finans kur denetimi atlatılabiliyordu) idi, aynı aşama kapanmadan düzeltildi.
- H3-A/H3-B/H4 bilinçli olarak sıfır görünür değişiklikle teslim edildi — bu üçü için canlı teyit yalnız "hiçbir şey bozulmadı" kontrolü olmalı.
- H5/H6a (bu oturum) ve H6a-hotfix/H6b (12 Kasım) ile artık H0-H4'te hazırlanan servis katmanı ilk kez gerçek arayüzden kullanılabilir durumda; canlı teyitte bu beşi en çok dikkat gerektiren, en yeni ve en az "defalarca denetlenmiş" kısım.
- Gerçek e-imza/KEP/e-Devlet entegrasyonu ve bulut dosya eki hâlâ kapsam dışı (ileri faz); Aşama 7 QR'ı resmî e-imza yerine geçmez.
