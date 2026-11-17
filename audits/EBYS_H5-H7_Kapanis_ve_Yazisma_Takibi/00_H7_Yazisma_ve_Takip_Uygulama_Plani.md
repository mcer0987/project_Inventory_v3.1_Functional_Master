# H7 · Yazışma ve Takip — Uygulama Planı

**Tarih:** 17 Kasım 2026 · **Durum:** Plan onaylandı (kararlar aşağıda). Uygulama, Bölüm A kapanış paketleri bittikten sonra başlar.
**Kaynaklar:** `.agents/rules/constitution.md`; `audits/audit-reports/2026-10-30_v3.4_EBYS_Genisleme_Is_Plani.md`; `2026-11-07_EBYS_Plan_Kod_Kiyaslamasi_ve_Tamamlama_Plani.md` (G07/G09/G14, H7); `2026-11-07_EBYS_Spark_Model_Dokumantasyon_ve_Rehber_Plani.md`; H4, H6a-hotfix ve H6b walkthrough'ları.

## İçindekiler

1. Önkoşul: Bölüm A kapanışı
2. Onaylanan kararlar
3. Temel tasarım kararı: mevcut kurallara ek ifade yok
4. Dilimler (D0–D7)
5. Firestore Rules ve ifade bütçesi
6. Spark uyumu
7. Kalan riskler ve sınırlar
8. Kalite kapıları

## 1. Önkoşul: Bölüm A kapanışı

H5 + H6a birleşik kabul kontrolünde altı pürüz bulundu (A-1 … A-6). Paket 1 bunlardan A-1, A-2, A-4, A-5 ve A-6'yı kapattı (bkz. `01_...Walkthrough.md`). **A-3 (personelin `index.html` üzerindeki kendi evrak çalışma alanı) açık.** H7'nin D2 cevap yazısı akışı, personelin giden evrak oluşturabilmesine bağlı olduğu için A-3 kapanmadan D2 başlamaz.

## 2. Onaylanan kararlar

| # | Karar |
|---|---|
| 1 | Bölüm A pürüzleri H7'den önce ayrı paketlerle kapatılır. |
| 2 | Cevap evrakı `outgoing` veya `internal` olabilir. |
| 3 | Mükerrer kayıt **uyarı** verir; kullanıcı açık onayla ("Yine de kaydet") devam edebilir. Engel yoktur. |
| 4 | Gönderim kaydını evrak sahibi, yönetici ve aktif icra sorumlusu girebilir. |
| 5 | Plan ve walkthrough belgeleri `audits/EBYS_H5-H7_Kapanis_ve_Yazisma_Takibi/` klasöründe tutulur. |

## 3. Temel tasarım kararı: mevcut kurallara ek ifade yok

H7'nin bütün verisi üç yeni, değiştirilemeyen koleksiyonda tutulur ve her biri **kendi transaction'ında** yazılır. `ebysDraftOk`, `ebysVersionOk` ve `ebysDocuments` kurallarına **sıfır ifade** eklenir.

- H6b ölçümü, personel taslak güncellemesinin 1.000 ifade sınırının yalnız birkaç ifade altında çalıştığını gösterdi.
- Gönderim kaydı onaydan sonra oluşur; değiştirilemeyen sürüme zaten giremez.
- Cevap bağının sürüme mühürlü kanıtı, cevap gövdesine eklenen **"İlgi:"** satırıdır. Gövde içerik özetine (SHA-256) ve doğrulama QR'ına dahildir.

## 4. Dilimler

| Dilim | İçerik | Dosyalar |
|---|---|---|
| **D0 · Bütçe ölçümü** | H6b'nin saplama yöntemiyle mevcut en ağır yolların payı ölçülür: katalog kopyalı genel taslak (oluşturma/güncelleme), 3 kalemli satın alma dondurma, kayıt numarası alma. Yeni üç kuralın en kötü yolu da ölçülür. Sonuç bu plana eklenir. | yalnız `tests/rules/` |
| **D1 · Saf şema** | Gönderim kanalları (`hand`, `post`, `courier`, `kep`, `email`, `other`) ve Türkçe etiketleri; gönderim kaydı doğrulaması (tarih gelecekte olamaz, referans ≤120, not ≤500, HTML yok); mükerrer anahtarı normalizasyonu (tr-TR küçük harf, boşluk/noktalama sadeleştirme); "İlgi:" satırı biçimlendirici; cevap özeti. | yeni `src/utils/ebys-correspondence-schema.js` + birim testi |
| **D2 · Gelen–cevap bağı** | `ebysReplyLinks/{cevapEvrakId}` (yalnız oluşturma): `replyToDocumentId`, `replyToOwnerUid`, `replyOwnerUid`, `replyToSummary` (kayıt no, dış sayı, tarih, muhatap). **Rules:** isteyen cevap evrakının yazarıdır; cevap `outgoing`/`internal` ve taslak/kayıtlı; hedef `incoming` ve kayıt numaralı; yazan hedefin sahibi, yönetici ya da aktif icra sorumlusu (`ejVersionAccess`); özet, hedef sürümün üstverisiyle birebir eşleşir. Okuma yalnız iki tarafın sahibine ve yöneticiye açık. **Arayüz:** gelen evrakta ve İcra İşlerim kartında "Cevap yazısı hazırla" → muhatap, konu ve İlgi satırı dolu yeni taslak. İlk kayıttan sonra bağ ayrı transaction'da kurulur; başarısızsa görünür "Bağı yeniden kur" düğmesi. Her iki evrakta "İlgi / Cevaplar" bölümü (pencere açılınca tek sorgu). | yeni `src/services/ebys-correspondence-service.js`, `src/ui/ebys-correspondence-ui.js`; `firestore.rules` yeni blok |
| **D3 · Mükerrer uyarısı** | `ebysIncomingKeys/{sha256}` (ilk yazan kazanır, yalnız oluşturma): `documentId`, `unitId`, `createdAt`. Gelen evrak kesin kayıt aldıktan sonra ayrı transaction'da yazılır. Formda muhatap + dış sayı + tarih dolunca tek okumayla kontrol; eşleşmede yalnız kayıt tarihi ve birim gösterilir, içerik/konu/kişi gösterilmez. Kullanıcı "Yine de kaydet" ile devam eder. Tekil okuma üyelere açık, listeleme kapalı. | aynı servis/arayüz; Rules yeni blok |
| **D4 · Manuel gönderim** | `ebysDispatches/{operationId}` (yalnız ekleme): kanal, kullanıcının beyan ettiği gönderim tarihi, dış referans/takip no, not, işlemi yapan, `versionId`; düzeltme için `correction` türü ve gerekçe. **Rules:** evrak `outgoing`, kayıt numaralı, durumu onaylandı/kapandı/arşivde, `versionId` güncel sürüm; yazan sahip, yönetici veya aktif icra sorumlusu; tarih gelecekte olamaz; güncelleme/silme kapalı. **Arayüz:** "Onaylandı · gönderim kaydı yok" ile "Gönderildi (manuel kayıt) · kanal · tarih · ref" ayrımı; tekrar gönderim ayrı satır; uyarı: "Sistem e-posta/KEP göndermez; bu kayıt KEP delili değildir." | aynı servis/arayüz; Rules yeni blok |
| **D5 · Sunucu filtreleri ve arama** | Durum ve birim filtresi sunucu sorgusuna taşınır (50'lik sayfalama korunur). Kayıt numarası tam eşleşmeyle bulunur. Metin süzme yalnız açık sayfada kalır ve etiketi bunu söyler; konu/tam metin araması desteklenmez ve açıkça yazılır. Yönetici + personel için durum, birim ve ikisinin birlikte kullanımına 6 bileşik indeks. Kural değişmez. | `ebys-document-service.js` (`listDocuments`), `ebys-documents-ui.js`, `firestore.indexes.json`, `admin.html`/`index.html` |
| **D6 · Kopya ve yayın** | Bağ ve gönderim koleksiyonları kişisel kopyaya ve `EBYS_COLLECTION_REGISTRY`'ye eklenir; mükerrer anahtarları sürümlerden yeniden üretilebildiği için kopyada "türetilmiş, kapsam dışı" işaretlenir. `scratch/hosting-files.js` +3. Rules istemciden önce yayınlanır. | `ebys-document-service.js`, `scratch/hosting-files.js` |
| **D7 · Rehber ve walkthrough** | `ebys-showcase-modal.js`: Evrak Defterleri bölümüne "Gelen evraka cevap", "Mükerrer uyarısı", "Gönderim kaydı"; arama SSS'i yeni kapsama göre düzeltilir. Yeni panellerde kısa açıklama + yardım düğmesi (AGENTS.md). | rehber modalı, HTML |

## 5. Firestore Rules ve ifade bütçesi

- Yeni üç blok kendi isteğinde değerlendirilir; mevcut kaydet/dondur/numara al işlemlerinin 1.000 ifade ve 20 belge erişimi bütçesi değişmez.
- Tahmini en kötü yol: cevap bağı ~6 belge erişimi; gönderim ~3–4; mükerrer anahtarı 1. D0'da emülatörde ölçülür.
- Kısmi durum (taslak var, bağ yok) sabit kimliklerle güvenli tekrar denemeyle kapatılır: bağ kimliği = cevap evrak kimliği, anahtar kimliği = özet, gönderim kimliği = bekleyen işlem kimliği.
- **Yedek seçenek (önerilmiyor):** Cevap bağı sürüme alan olarak mühürlenecekse `ebysDraftOk`/`ebysVersionOk`'a ~4–5 ifadelik kopya karşılaştırması eklenir (H6b `institutionSnapshot` kalıbı). Hedef doğrulaması dondurma işleminin 20 erişimlik bütçesine girer; yalnız D0 yeterli pay gösterirse.

## 6. Spark uyumu

Cloud Function, sürekli dinleyici, dış e-posta/KEP, OCR, tam metin araması ve Storage kullanılmaz. Okumalar yalnız pencere açılınca (1–2 sorgu) veya kullanıcı alanları doldurunca (mükerrer kontrolü, 1 okuma) yapılır.

## 7. Kalan riskler ve sınırlar

- Rules mükerrer anahtarının doğru hesaplandığını denetleyemez (tr-TR normalizasyon eşliği riskli). Sahte anahtar en fazla yanlış uyarı üretir. Anahtar tahmin edilebilir; açığa çıkan bilgi yalnız evrakın varlığı, tarih ve birimdir.
- H7 öncesi gelen evraklar mükerrer uyarısına dahil değildir (yönetici taslakları okuyamadığı için tarayıcıdan geriye dönük doldurulamaz).
- Gönderim durumu evrak defteri satırında değil, evrak penceresinde görünür (başlık kurallarına dokunmamak için).
- Yalnız normalize edilmiş tam eşleşme uyarı verir; "T.C. Sağlık Bakanlığı" ile "Sağlık Bakanlığı" farklı sayılır.

## 8. Kalite kapıları (her dilimde)

`npm run test:unit` · `npm run test:rules` · `npm run lint:xss` · `node scratch/hosting-files.js`

Yeni Rules testleri: yetkisiz bağ, başkasının evrakına gönderim, gelecek tarihli gönderim, güncelleme/silme reddi, mükerrer anahtarın ikinci kez yazılamaması, 60 kayıtla ikinci sayfada sunucu filtresi, mevcut en ağır yolların yeşil kalması.
