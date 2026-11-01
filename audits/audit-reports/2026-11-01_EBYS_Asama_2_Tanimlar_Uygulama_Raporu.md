# EBYS Aşama 2 — Tanımlar uygulama raporu

**Tarih:** 1 Kasım 2026  
**Dal:** `feat/v3.4-ebys`  
**Plan commit'i:** `299e2fc` — yalnız onaylanan üç tasarım belgesi.  
**Uygulama:** Yerel çalışma ağacında; bu aşamanın kodu commit edilmedi. Aşama/commit onayı bekleniyor. Deploy ve canlı veri işlemi yok.  
**Durum:** Uygulandı, aşağıdaki yerel kontroller geçti; üretim doğrulaması ve tam UAT sonucu değildir.

## 1. Yapılan geliştirmeler

### Birimler

- `units` kayıtlarına `parentUnitId`, `organizationId`, `code`, `active`, `personnelIds`, `revision` desteği eklendi. Var olan ID değiştirilmez; yeni birimler UUID alır.
- Düzenleme modalında kalıcı ID, kurum ID, kod, üst birim ve aktiflik alanları var. Bir kez verilmiş kurum bağlantısını değiştirmek ayrı taşıma gerektirir; bu ekranda salt okunur olur.
- Yeni servis hedef birimi transaction ile günceller. Bütün koleksiyonu eski UI snapshot'ıyla yeniden yazmaz; eski/özel alanları korur. Açılıştan sonra revizyon değişmişse kaydı reddeder.
- Hiyerarşide eksik üst birim, kendi kendine bağlantı, döngü ve farklı kurum bağlantısı servis/Rules ile reddedilir. Üst zincir Rules'da en fazla dört üst birimle sınırlandırılmıştır; servis değişiklik sonrasında okuduğu grafı da denetler.
- Pasif birime yeni alt birim veya yeni personel bağlantısı kurulamaz. Önceden var olan bağlar tarihsel gösterim için korunur.

### Personel kimliği ve görev ilişkisi

- Mevcut `personel.id` kalıcı personel kimliği olarak korundu; ikinci bir yapay kimlik katmanı oluşturulmadı. UID mevcut Auth hesabının bağıdır ve tanım düzenlemesiyle değiştirilmez.
- Her iki sayfanın personel modalına kalıcı ID, UID, birincil `unitId`, `jobTitle` ve aktiflik alanları eklendi. Görev/unvan açıklayıcı veridir; yazılması erişim rolü kazandırmaz.
- Eski `birim` metni uyumluluk alanı olarak tutulur. Yeni birim bağlantısı ID seçicisinden yapılır; bağlantısız eski kayıtların adları sessizce başka birime eşlenmez.
- Aynı adlı kişiler birim katılımcı aramasında ID ve UID ile ayrı gösterilir. Seçim ID ile kaydedilir; iki aynı ad tek kişiye indirgenmez.
- Personelin birincil birimi `personel.unitId` üzerindedir. Birim ekranındaki `personnelIds` ek katılımcı listesidir; bu ekran kişiyi sessizce başka birincil birime taşımaz. Eski `units.personnel` ad listesi tarihsel uyumluluk olarak korunur ve modalda ayrı etiketlenir.
- Personel düzenlemesi de transaction kullanır; güncel kayıt ile birleşir ve açılış revizyonu değişmişse çatışma bildirir.

### Pasifleştirme ve erişim

- Birim ve personelde Sil eylemleri Pasifleştir oldu; `active:false` yazılır, ID/UID ve tarihsel ilişkiler saklanır. Düzenle ekranındaki Aktif kutusuyla yeniden etkinleştirilebilir.
- Firestore kuralları admin dahil `units/personel` fiziksel silmelerini ve var olan ID değişimini reddeder; bağlı personel UID'si değiştirilemez.
- `staffPersonOk`, `active:false` personelin uygulama verisini okumasını/yazmasını engeller. Eski kayıtta `active` yoksa etkin sayılır; legacy hesaplar bundan dolayı kapanmaz.
- Bu yöntem Auth hesabını silmez veya token iptal servisi çalıştırmaz. Kişi Auth'ta oturum açabilse de pasifken uygulama verisine erişemez. Daha önce indirilmiş verinin uzaktan silinmesi taahhüt edilmez.

## 2. Legacy satın alma davranışının korunması

- `purchaseOrders`, gömülü `workflow`, geçmiş adlar veya eski talepler için veri göçü yapılmadı.
- Yeni birim/personel servis testi, birim adı ve personel ilişkisi değişirken örnek satın alma kaydının birebir aynı kaldığını gerçek emülatör okumalarıyla doğruladı.
- Mevcut satın alma formunda yeni seçim listesi pasif birimleri dışlar. Detay/düzenleme sırasında kayıttaki eski ad, artık listede olmasa da mevcut seçenek koruma yolu üzerinden gösterilir.
- Mevcut Rules paketindeki talep açma, manuel/şablon başlatma, sahiplik, sıralı onay/red, geri çekme ve 10 adımlı tam akış kontrolleri geçti.
- Pasif personelin devam eden bir akıştaki görevi otomatik başka kişiye aktarılmaz. Var olan yönetici/yeniden başlatma yolu korunur; vekâlet ve yeni görev yönlendirme sonraki aşamanın konusudur.

Bu kontroller, test edilen davranışlar için uyumluluk kanıtıdır; her gerçek kayıt ve tüm kullanıcı senaryoları için mutlak garanti değildir.

## 3. Test sonuçları ve kanıtlar

| Kontrol | Sonuç | Kanıt |
|---|---|---|
| Tüm birim testleri | 271/271 geçti; hata 0 | `scratch/ebys-stage2-unit.log` |
| Yeni saf şema testleri | 5/5 geçti | `scratch/ebys-stage2-unit-targeted.log` |
| Firestore Rules emülatörü | 223/223 geçti; hata 0 | `scratch/ebys-stage2-rules.log` |
| XSS taraması | 916 dinamik ifade, izinsiz 0 | `scratch/ebys-stage2-xss.log` |
| Yerel tarayıcı DOM/gerçek modal handler kontrolü | 6 kontrol geçti, pageerror 0 | `scratch/ebys-stage2-ui-approved.log` |
| Değişen JS sözdizimi ve diff boşluk kontrolü | Geçti | `node --check` ve `git diff --check` |
| Hosting dosya kontrolü | Yayın öncesi açık iş: beklenen 71, görülen 74 | `scratch/ebys-stage2-hosting.log` |

Rules testleri yalnız demo emülatör projelerinde koştu; canlı kök üzerinde gerçek okuma/yazma yapılmadı. Yeni dört Rules/servis test grubu; hiyerarşi döngüsü (aynı batch dahil), silme engeli, ID/UID koruması, personel pasifleştirme, yetkisiz rol/atama, yanlış ortam ve gerçek servis transaction'larını kapsıyor.

İlk emülatör koşularında yeni kontroller mevcut 10 adımlı akışın 1000 ifade sınırını aştı. Kimlik kaydı tek kez okunup aynı UID/PRI ve aktiflik kontrolüyle değerlendirilecek şekilde düzenlendi. Son koşuda bütün paket geçti; başarısız ara koşular nihai sonuç diye sunulmadı.

Tarayıcı kontrolü iki sayfada ortak kullanılan gerçek personel/birim modal açma fonksiyonlarını, DOM alanlarını ve servis çağrısı bağını izole HTML'de çalıştırır. Aynı adlı kişi seçimi, pasif birim seçimi, eski isim listesi, ID/UID alanları ve HTML metninin çalıştırılmadan gösterilmesi kontrol edildi. Bu kontrol tam uygulama yüklenmesi veya gerçek Firebase Auth ile uçtan uca UAT değildir; transaction/Rules ayrıca gerçek emülatörde test edildi. Konsol/çift yükleme için tam uygulama smoke baseline karşılaştırması bu tur yapılmadı.

Yapılandırılmış kanıt: `audits/test-baselines/2026-11-01_EBYS_Asama_2_Kanit.json`. Kaynak ve log SHA-256 özetleri test edilen çalışma ağacını tanımlar. Tüm birim paketi ortak çalışma ağacında koştuğundan eşzamanlı diğer değişiklikleri de içerir; ayrı çalışma ağacı izolasyonu iddiası yoktur.

## 4. Değişen dosyalar ve sorumluluk sınırı

Yeni uygulama dosyaları:

- `src/utils/ebys-definitions-schema.js`: saf hiyerarşi/ilişki ve legacy isim çözümleme.
- `src/services/ebys-definitions.js`: transaction tabanlı birim/personel kaydı ve pasifleştirme.
- `src/ui/ebys-definitions-ui.js`: DB çağrısı içermeyen ortak DOM alanları ve ID ile personel seçimi.

Mevcut dosyalardaki hedefli değişiklikler:

- `index.html`, `admin.html`: ortak şema/UI betiklerinin yüklenmesi.
- `src/modules/edm-workflow.js`: birim modalı/çizimi ve servis entegrasyonu; satın alma onay motoru değiştirilmedi.
- `personel.js`: ID/UID/birim/görev gösterimi ve pasifleştirme.
- `script.js`: yalnız personel modalı açma ve personel ekleme/düzenlemede yeni servise geçiş.
- `src/services/purchase-servises.js`: yeni seçimlerde pasif birimleri dışlama; eski değer koruması sürer.
- `firestore.rules`: hiyerarşi, tanım kimliği, aktiflik ve silme engelleri.
- `scratch/hosting-files.js`: üç yeni uygulama dosyası için beklenen sayı 68 → 71.

Yeni test/kanıt araçları: `tests/unit/ebys-definitions.test.mjs`, `tests/rules/ebys-definitions.test.mjs`, `scratch/ebys-stage2-ui.cjs`, bu rapor ve yapılandırılmış kanıt dosyası.

Çalışma ağacında başka işlere ait `script.js` stok içe aktarma bölümü, `src/utils/stock-import.js`, `src/ui/ui-components.js`, ilgili stok testleri ve başka yeni testler bulunuyor. Bunlar EBYS kapsamında değiştirilmedi/geri alınmadı. `script.js` ortak dosyadır; gelecekte kod commit'i hazırlanırken yalnız bu aşamanın personel hunks'ları seçilmeli. `git add .` kullanılmamalı.

## 5. Sınırlar, yan etkiler ve sonraki kapı

- Kurum ID bu aşamada hiyerarşinin kurum anahtarıdır; kurum künyesi CRUD ekranı ve evrak süreçleri henüz yoktur. Görev/unvan gerçek yetki veya vekâlet rolü değildir.
- Yeni hiyerarşi dört üst birim sınırı taşır. Kurum bağı verilmiş birimin kurumlar arası taşınması ayrı geçiş gerektirir; serbest taşıma yapılmaz.
- Eski personel adları otomatik toplu eşlenmedi. ID bağlantıları yönetici tarafından seçilir; tarihsel isim listeleri bilerek korunur.
- Silme yasağı nedeniyle eski genel silme/geri yükleme araçlarının personel veya birimleri fiziksel kaldırmaya çalışan işlemleri kurallarca reddedilir. Bu araçların EBYS için restore politikası ayrıca gözden geçirilmelidir; izin açarak silme yasağı aşılmadı.
- Hosting kontrolünde mevcut `release-journal/index.html`, `release-journal/journal.js`, `release-journal/style.css` beklenen yayın listesinde yok. Bu dosyalar bu geliştirmede oluşturulmadı; onların yayın politikası düzeltilmeden hosting kalite kapısı geçmiyor. Yerel Aşama 2 testlerini engellemiyor; bu tur deploy yapılmadı.
- Dosya ekleri, belge süreçleri ve gerçek imza bu aşamanın uygulama kapsamı değildir.

**Kabul için sunulan sonuç:** Aşama 2 yerel uygulaması ve belirtilen testler hazır. Aşama kod commit'i için proje sahibi onayı; tam uygulama UAT/yayın için ilgili sonraki kontroller bekleniyor. Sonraki ürün paketi Aşama 3 kalemli satın alma/döviz tasarımıdır; para politikası kesinleşmeden uygulanmaz.
