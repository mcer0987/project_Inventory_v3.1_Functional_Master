# Envanter Import Güvenliği ve Envanter No — Implementation Walkthrough

> **Tarih:** 01.11.2026  
> **Durum:** Uygulandı; yerel testler tamamlandı. Deploy yapılmadı.  
> **Kapsam:** B1/B2 Excel/CSV import, Envanter No ile tekrar kontrolü, ürün modalı ve görünüm tutarlılığı.  
> **Kullanıcı kararı:** Envanter No her B1/B2 import satırında zorunlu; aynı numarayla gelen kayıt eklenmez, mevcut kayıt değiştirilmez ve atlananlar raporlanır.

## İçindekiler

1. [Kullanıcı talepleri](#1-kullanıcı-talepleri)
2. [Uygulanan davranış](#2-uygulanan-davranış)
3. [Import akışı ve teknik kararlar](#3-import-akışı-ve-teknik-kararlar)
4. [Önceki import ve modal iyileştirmeleri](#4-önceki-import-ve-modal-iyileştirmeleri)
5. [Değiştirilen dosyalar](#5-değiştirilen-dosyalar)
6. [Test ve doğrulama](#6-test-ve-doğrulama)
7. [Sınırlar ve açık teknik risk](#7-sınırlar-ve-açık-teknik-risk)
8. [Yerel test walkthrough](#8-yerel-test-walkthrough)

---

## 1. Kullanıcı talepleri

Kullanıcı, B1/B2 Excel importunda aynı ürünlerin farklı Firestore ID'leriyle tekrar tekrar eklenmesini önlemek için Envanter No'yu sabit eşleştirme anahtarı olarak seçti. Uygulama kararı şu şekilde netleştirildi:

- **Kapsam:** B1 ve B2; import kontrolü iki depo arasında da yapılır.
- **Mevcut numarayla tekrar:** Yeni kayıt ekleme; mevcut ürünü koru, alanlarını güncelleme ve tekrar satırını raporla.
- **Eksik numara:** Import satırını kabul etme; dosyada hata varsa kısmi import yapma.
- **Dosyanın kendi içindeki tekrar:** Aynı normalize edilmiş numara iki satırda bulunursa tüm dosyayı reddet.
- **Ürün görünürlüğü:** Envanter No tabloda/kartta, Excel raporunda ve ürün düzenleme modalında görülebilsin.
- **Ürün türü ve raf iyileştirmeleri:** Önceki taleplerde onaylanan mevcut ürün türü kataloğu kontrolü ve dinamik raf seçenekleri korunur.

## 2. Uygulanan davranış

### Excel/CSV içe aktarma

1. Satırdaki Envanter No başlığı tanınan alias'lardan biriyle eşleştirilir.
2. Envanter No boşsa satır hatası verilir. Import doğrulaması dosya çapında olduğu için **hiçbir satır yazılmaz**.
3. Import dosyasında numara tekrarı varsa (harf büyüklüğü/boşluk farkları normalize edildikten sonra) dosya reddedilir.
4. Önizlemede, uygulamanın yüklü B1 ve B2 verilerinde bulunan numaralar gösterilir ve muhtemel tekrarlar ekleme sayısından çıkarılır.
5. Onaydan sonra `atomicImportStock`, sunucudaki B1 ve B2 koleksiyonlarını tekrar okuyup aynı kontrolü taze veriye karşı yürütür.
6. Eşleşen numaralar için eski belgeye yazma yapılmaz. Farklı ürün adı, raf, adet gibi alanlar bulunursa alan farkları tekrar raporuna eklenir; otomatik güncelleme yapılmaz.
7. Import sonuç mesajı eklenen yeni kayıt ve atlanan tekrar sayılarını ayrı bildirir.

### Envanter No karşılaştırma kuralı

`Schema.normDeviceId` karşılaştırma anahtarı olarak kullanılır:

- Harf büyüklüğü etkisizdir.
- Baştaki/aradaki/sondaki boşluklar kaldırılır.
- Tire ve diğer noktalama işaretleri korunur; örneğin `ENV-1` ile `ENV1` farklı anahtarlardır.
- Kayıtların görünen Envanter No değeri değiştirilmez; normalize edilmiş değer yalnızca karşılaştırmada kullanılır.

### Ürün formu ve gösterimler

- Envanter No B1 ve B2 tablo satırına eklendi.
- Mobil kart görünümünde Envanter No gösterilir; arama alanı numarayla aramayı da destekler.
- Ürün ekle/düzenle modalı Envanter No alanını okur ve kaydeder. Kopyalama (clone) sırasında mevcut ürünün Envanter No'su yeni kopyaya taşınmaz.
- Modal kayıt öncesi yüklü B1/B2 listelerinde numara çakışmasını kontrol eder.
- B1 ve B2 Excel raporlarına `Envanter No` sütunu eklendi.

### Stok transferi

- Envanter No taşıyan bir ürün tam transfer edildiğinde numara hedef kayda taşınır.
- Envanter No taşıyan üründe kısmi transfer reddedilir; tekil kimlik iki ayrı stok belgesine kopyalanamaz.

## 3. Import akışı ve teknik kararlar

### Modül akışı

```text
Excel / CSV dosyası
  -> script.js: importExcel
  -> src/utils/stock-import.js: başlık eşleme + satır doğrulama + canonical records
  -> önizleme: yerel B1/B2 listeleriyle bilgilendirme
  -> admin onayı
  -> src/services/firebase-handler.js: atomicImportStock
       -> B1 + B2 + raf kataloğunu sunucudan oku
       -> Envanter No tekrarlarını yeniden kontrol et
       -> tekrarları dışarıda bırak
       -> kalan kayıt ve raf değişikliklerini aynı atomik işte planla
  -> sonuç/atlanan tekrar bildirimi
```

### Sunucu tarafı import kontrolü

`atomicImportStock` şimdi hem `b1` hem `b2` kayıtlarını taze okur. Firestore belge kimliği varsa, kaydın `data.id` alanı boş/eski olsa bile karşılaştırma raporunda belge kimliği kullanılır. Filtrelenen yeni kayıtlar ve yalnız o kayıtlara ait raf istekleri `planImportEntries` fonksiyonuna gönderilir. Böylece tekrarlanan bir satır için boş raf yaratılmaz veya raf sayacı artırılmaz.

Importa doğrudan API üzerinden girilmesi de boş ve dosya içi tekrar Envanter No kontrollerini atlayamaz: `atomicImportStock` kayıtları yazmadan önce `validateImportInventoryNumbers` doğrulamasını ayrıca çalıştırır.

### Tam atomiklik ve yarış koşulu ayrımı

Ürün ekleme ile raf oluşturma/sayaç güncellemesi mevcut `AtomicWriter` işinde hepsi-ya-da-hiçbiri olarak kalır. Ancak B1/B2 tekrar taraması, yazma planı kurulurken yapılan sunucu okumasıdır; Envanter No için Firestore seviyesinde benzersiz indeks/rezervasyon belgesi veya iki koleksiyonu kapsayan transaction garantisi değildir. Ayrıntı için [§7](#7-sınırlar-ve-açık-teknik-risk) bölümüne bakın.

## 4. Önceki import ve modal iyileştirmeleri

Önceki onaylı B1/B2 import çalışmasının ilgili davranışları:

- `Raf/Shelf` Excel başlığı `raf` alanına eşlenir.
- Raf yazımında nokta/tire/boşluk gibi biçim farkı için mevcut raf adayları bulunursa yöneticiye seçim penceresi gösterilir. Tek aday önseçilebilir; birden fazla aday otomatik seçilmez. Seçim yalnız o import için geçerlidir.
- Importla otomatik yaratılan raf varsayılan kapasitesi **12**'dir; genel/elle raf ekleme varsayılanı **5** olarak kalır.
- Dolu veya pasif raf davranışı ve raf kapasite sayacı import onayındaki önizleme ile sunucuda taze planlamada tutarlı tutulur.
- Dolu Ürün Türü alanı katalogda tek bir kanonik türe eşleşmelidir. Bilinmeyen veya birden fazla kayıtla eşleşen türde dosya durdurulur. Boş tür alanı önceki davranışla opsiyonel kalır.
- Ürün modalı yalnız sabit raf seçeneklerini değil, ilgili depodaki kayıtlı rafları ve mevcut ürünün rafını da listeler.
- Import rehberi Envanter No'nun B1/B2 için zorunlu olduğunu, kayıtların değiştirilmeyeceğini ve tekrarların atlanacağını açıklar.

Bu walkthrough, önceki tamamlanmış davranışları tekrar tasarlamaz; son Envanter No değişikliğiyle birlikte importun bütün ilgili davranışlarını kayda geçirir.

## 5. Değiştirilen dosyalar

### Uygulama dosyaları

| Etiket | Dosya | Değişiklik |
|---|---|---|
| `[SCHEMA]` | [`src/utils/schema.js`](../../src/utils/schema.js) | `envanterNo` alanını B1 ve B2 ortak opsiyonel stok alanı yaptı; alanın string tipi mevcut sözleşme doğrulamasına tabi. |
| `[IMPORT]` | [`src/utils/stock-import.js`](../../src/utils/stock-import.js) | Envanter No normalizasyonu, boş/tekrarlı numara doğrulaması, mevcut kayıt karşılaştırma/filtreleme yardımcıları ve B1/B2 kayıtlarına numara yazma. |
| `[IMPORT]` | [`script.js`](../../script.js) | İçe aktarma rehberi, yerel önizleme ve tekrar raporu, import sonrası ekleme/atlama sonucu; B1/B2 Excel raporlarına Envanter No sütunu. |
| `[FIRESTORE]` | [`src/services/firebase-handler.js`](../../src/services/firebase-handler.js) | `atomicImportStock` içinde B1/B2'yi sunucudan taze okuyarak tekrar kontrolü ve atlanan kayıt sonuçları. |
| `[UI]` | [`index.html`](../../index.html) | B1/B2 tablo başlıklarına ve ürün modalına Envanter No alanı. |
| `[UI]` | [`src/ui/table-engine.js`](../../src/ui/table-engine.js) | Tablo/kart render'ı ve arama davranışına Envanter No. |
| `[UI]` | [`src/ui/ui-components.js`](../../src/ui/ui-components.js) | Ürün modalı düzenlemede Envanter No'yu doldurma, kopyalamada boş başlatma. |
| `[SAVE]` | [`src/modules/inventory-logic.js`](../../src/modules/inventory-logic.js) | Modal kaydından Envanter No alma ve B1/B2 yerel listelerinde tekrar kontrolü. |
| `[TRANSFER]` | [`src/services/stock-ledger.js`](../../src/services/stock-ledger.js) | Tam transferde Envanter No'yu koruma; numaralı ürünün kısmi transferini reddetme. |

### Test dosyaları

| Etiket | Dosya | Kapsam |
|---|---|---|
| `[TEST: SCHEMA]` | [`tests/unit/stock-schema.test.mjs`](../../tests/unit/stock-schema.test.mjs) | B1/B2 ortak alan sözleşmesi ve tip kontrolleri. |
| `[TEST: IMPORT]` | [`tests/unit/stock-import.test.mjs`](../../tests/unit/stock-import.test.mjs) | Zorunlu alan, dosya içi tekrar, mevcut kayıt eşleşmesi ve B1/B2 importu. |
| `[TEST: IMPORT ATOMIC]` | [`tests/unit/import-shelf-atomic.test.mjs`](../../tests/unit/import-shelf-atomic.test.mjs) | Tekrar importu, çapraz depo eşleşmesi, mevcut veriyi koruma ve raf planıyla entegrasyon. |
| `[TEST: TRANSFER]` | [`tests/unit/stock-ledger.test.mjs`](../../tests/unit/stock-ledger.test.mjs) | Tam transferde numara korunması ve kısmi transfer engeli. |
| `[TEST: LEGACY SAVE]` | [`tests/unit/savedata-legacy-guard.test.mjs`](../../tests/unit/savedata-legacy-guard.test.mjs) | Eski B1 belgesine ortak alan ekleme/değiştirme davranışı. |
| `[TEST: FIRESTORE EMULATOR]` | [`tests/integration/atomic-writer.emu.test.mjs`](../../tests/integration/atomic-writer.emu.test.mjs) | Atomik import / raf işleyişi için test verisinin zorunlu Envanter No ile uyumu. |

> Yukarıdaki liste bu iş için düzenlenen dosyaları gösterir; aynı çalışma ağacında başka bir çalışma tarafından değiştirilmiş diğer dosyalar bu walkthrough kapsamına dahil değildir. Özellikle alakasız EBYS/satın alma/rules değişiklikleri bu iş kapsamında sahiplenilmemiştir.

## 6. Test ve doğrulama

| Komut | Sonuç |
|---|---|
| `npm run test:unit` | **273/273 geçti.** |
| `npm run lint:xss` | **İzinsiz XSS sink: 0.** |
| `npm run test:atomic:emu` | **10/10 geçti.** |
| `git diff --check` | Hata yok; yalnız mevcut `admin.html` satır sonu uyarısı görüldü. |
| `npm run test:rules` | **221/223 geçti; 2 senaryo başarısız.** Hatalar EBYS workflow ve satın alma senaryolarında Firestore Rules 1000 ifade sınırı (`maximum of 1000 expressions`) kaynaklıydı; Envanter No test senaryoları değildi. Bu test sonucu başarılı kabul edilmemelidir. |

Atomik emülatör testi, stok import işleminin mevcut kurallarla raf ve ürün yazma davranışını doğruladı. Ancak bu test, Envanter No benzersizliği için eşzamanlı import yarışı olmadığını kanıtlamaz.

## 7. Sınırlar ve açık teknik risk

### Firestore seviyesinde kesin benzersizlik henüz yok

- Import önizlemesi tarayıcıdaki yüklenmiş B1/B2 verisini kullanır; kullanıcıya erken uyarı içindir.
- Commit öncesi `atomicImportStock` güncel B1/B2 koleksiyonlarını tekrar okur. Bu, bayat UI verisine dayalı karar riskini azaltır.
- Buna rağmen iki yönetici aynı Envanter No'yu aynı anda import ederse, iki sunucu okuması da henüz kayıt görmeyebilir ve iki yazma da başarılı olabilir. Okuma ve yazma arasında veritabanı düzeyinde benzersiz rezervasyon yoktur.
- Modalın tekrar kontrolü de yüklü `window.data` listesine dayanır; tek başına sunucu tarafı benzersizlik garantisi değildir.
- Eski kayıtlardaki Envanter No tekrarları otomatik temizlenmez. Import eşleşen kayıtların tamamını raporlar; mevcut veriyi değiştirmez.

**Tam garanti için olası sonraki tasarım:** Normalize edilmiş Envanter No'dan deterministik ID'li bir indeks/rezervasyon belgesi üretmek ve bu belgeyi stok kaydıyla aynı Firestore transaction'ında oluşturmak/güncellemek; mevcut B1/B2 numaraları için önceden indeks göçü yapmak. Bu değişiklik bu uygulamada yapılmadı.

### Mevcut numarasız ürünler

Eski ürün kayıtlarında Envanter No boş kalabilir; ürün modalı manuel düzenlemede alanı zorunlu kılmaz. Fakat yeni Excel import satırlarında numara zorunludur. Bir Excel'i güncellediğinizde eski bir numarayı başka ürüne atamak mevcut veri taramasında tekrar olarak raporlanır.

## 8. Yerel test walkthrough

1. Geliştirme ortamında yönetici oturumuyla B1 veya B2 import rehberini açın.
2. Excel/CSV'de `Envanter No` (ve tanınan alias'larından biri) sütununu ekleyin; her dolu ürün satırına ayrı ve dolu numara verin.
3. Bir satırdaki numarayı boş bırakıp import deneyin. Beklenen: satır hatası ve hiçbir kayıt yazılmaması.
4. İki satırda aynı numarayı, yalnız harf büyüklüğü/boşluk farkıyla kullanın. Beklenen: dosya içi tekrar hatası, kısmi import yok.
5. İlk kez kullanılan numaralarla import edin. Beklenen: onay ekranında eklenecek kayıt sayısı; commit sonrası B1/B2 tablosunda Envanter No.
6. Aynı Excel'i yeniden import edin. Beklenen: aynı kayıtların eklenmemesi, mevcut kayıtların değişmemesi, tekrarların raporlanması.
7. Önce B1'e eklediğiniz numarayı B2 importunda kullanın (veya tersi). Beklenen: çapraz depo eşleşmesi nedeniyle atlanması.
8. Mevcut Envanter No ile farklı ürün adı/adet gönderin. Beklenen: farkların raporlanması; depodaki ürünün değiştirilmemesi.
9. Ürün modalını açıp Envanter No alanını doğrulayın; aynı numarayı başka bir ürüne kaydetmeyi deneyin. Beklenen: yüklü kayıtlardaki eşleşme için uyarı.
10. Envanter No'lu ürünü tam transfer edin ve sonra kısmi transfer deneyin. Beklenen: tam transferde numaranın korunması; kısmi transferin reddedilmesi.

---

**Sonuç:** Import tekrarlarında Envanter No ile mevcut kaydı koruyan ve kullanıcıya raporlayan akış tamamlandı. Mevcut test/doğrulama sonuçları yukarıda kayıtlıdır. Firestore seviyesinde eşzamanlı benzersizlik tasarımı ve `npm run test:rules` içindeki iki ifade bütçesi hatası ayrı takip edilmelidir.
