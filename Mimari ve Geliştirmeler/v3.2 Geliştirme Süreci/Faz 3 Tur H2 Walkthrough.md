# Faz 3 · Tur H2 Walkthrough (tek-doküman API, id tabanlı işlemler, strict varsayılan)

> **Tarih:** 28.09.2026 · **Branch:** `refactor/phase-3-data-layer` (H1'in üstünde; henüz merge edilmedi, **canlıya deploy edilmedi**)
> **Firebase:** `medipol-inventory-v3` · testler yalnız `inventory_demo` · canlı `lifeserver_master` ve eski `inventory_v2`'ye dokunulmadı · kill switch / force logout tetiklenmedi (kural 7.5)
> **Durum (§7.2):** Uygulandı + otomatik testlerle doğrulandı. Admin yazmaları (b1/b2/b3, personel, birim, mahal) sahibi tarafından elle doğrulanmalı.

## Kapsam
Plan 3.2 (tek-doküman API) + 3.3'ün id kısmı + Faz 2'den devredilen maddeler (karar: "Faz 3'ün ilk önceliği"): ITSM-07, INV-02 (kalan) / DATA-06, DATA-01 (FAB, Bottom Sheet, silme, takip), ADM-07, DATA-14, EBYS-17, EBYS-12, EBYS-14, VIP-07, TODO-04. Sonunda karar 1: **strict varsayılan**. INV-04 (sepet) ve servisten dönüş atomikliği H3'te.

## Commit'ler
| Hash | Madde | Özet |
|---|---|---|
| `8c174fe` | 3.2 | `applyItemOps` (tek writeBatch = Firestore'da atomik, çok koleksiyonlu) + `upsertItem` (birleştirmesiz tam doküman), `appendItem` (makeId, tekrar id reddi), `updateItem(s)` (yalnız verilen alanlar), `removeItem`, `bulkRemove`, `findItem` |
| `b4289db` | DATA-06, INV-02, DATA-01 | Satır/kart/checkbox `data-id`; FAB, Bottom Sheet, silme, takip, stok ±, düzenle, sevk, pasife al, çıkış, b3 sil/PDF, "Taleplerim" işlemleri id ile ve tek doküman. Sevk = "hedefe ekle + kaynaktan sil" tek atomik batch. Çıkışta b3 yazılamazsa stok geri alınır. b3 satır silme artık onay istiyor |
| `db0be49` | ITSM-07 | Personel düzenle/sil id ile; düzenleme yalnız adı yazar (id ve diğer alanlar korunur); onaylı silme; tablo kaçışlı |
| `e9e6285` | ADM-07 (+ölü kod) | Kritik stok grubu silme id ile, B1+B2 tek batch; toplu B2 ekleme tek batch. Çağrılmayan, eski şemayla tüm veritabanını yazan `addRequest`, `submitRequest`, `updateRequestStatus` (sabit "Muhammed Cer"), `renderRequestAction` kaldırıldı |
| `b5b4e65` | EBYS-17, EBYS-12, DATA-14 | Onay/red/durdur/başlat başarısız olursa talep eski haline döner; id'siz eski akışa kalıcı id; sahip-veya-admin kontrolü (geri çek, iptal, düzenle, sil, ek sil); görüntüleme modunda ek silme yok; görüntüleme yalnız değişince ve yalnız o talebi yazar; göç yalnız admin'de; akış yazmaları birleştirmesiz (eski alt alanlar kalmaz) |
| `19af79a` | EBYS-14, VIP-07, TODO-04 | Başarısız yüklemede sahte ek yok ("eksik eklerle kaydedilsin mi?"); kill switch butonu sunucudaki gerçek durumu gösterir, geçiş onaylı, uyarı metni düzeltildi; TODO-04 C6'da zaten kapanmış (test eklendi) |
| `6bcc885` | Karar 1 | `saveData`/`applyItemOps` varsayılan strict; `writeOk()`; genel `unhandledrejection` yakalayıcısı |

## Maskeleme çiftleri
| Çift | Nasıl ele alındı |
|---|---|
| İndeksten id'ye ⇄ tekrar id | `makeId` (H1) önce geldi; render'lar `data-id` taşır |
| EBYS-17 yarım değişiklik ⇄ saveData v2 fark yazması | v2, bellekteki yarım hali sonraki herhangi bir kayıtta kalıcı yapardı → işlem öncesi kopya, başarısızlıkta geri dönüş (aynı commit) |
| DATA-14 "yalnız değişince yaz" ⇄ tam yeniden yazmanın bayat kaydı farkında olmadan düzeltmesi | Onarım (`fixWorkflowCurrentStep`) korunur, yalnız değişince o talep yazılır; göç admin oturumunda |
| Strict varsayılan ⇄ `=== false` ile telafi yapan çağıranlar | 44 çağrı mekanik olarak `writeOk(...)`'a dönüştürüldü (telafi mantığı birebir aynı); sonucu kontrol etmeyenler genel yakalayıcıda kullanıcıya hata gösterir |

## Strict varsayılan — ne değişti
- Başarısız yazma artık **hiçbir yerde sessizce "başarılı" görünmez**: sonucu kontrol eden çağıranlar kendi mesajını gösterir ve telafisini yapar; kontrol etmeyenler (TODO kayıtları, Excel içe aktarma vb.) durur ve "Kayıt yapılamadı: …" uyarısı çıkar. Önceden bu çağıranlar başarısız kayıttan sonra da başarı mesajı gösteriyordu (DATA-02'nin son kalıntısı).
- `{strict:false}` yalnız testlerde ve bilinçli `false` bekleyen yerlerde.

## Kanıt
Test senaryoları (`scratch/flow-tests.js`):
| Senaryo | Doğrulanan |
|---|---|
| `itemApi` | ekle / tekrar id reddi / kısmi güncelleme diğer alanları korur / upsert kaldırılan alanı siler / requests+tasks tek batch / **b1 içeren batch'in tamamı reddedilir** (sunucu ve bellek değişmez) / sil / toplu sil / bilinmeyen koleksiyon |
| `idBasedProductOps` | Seçimle işlem arasında listenin başına kayıt eklenir; **tüm işlemler yine doğru ürüne** gider (silme, takip, düzenleme yalnız form alanları, checkbox id'leriyle pasife alma, çıkış stok + b3 productId, sevk set b2 + delete b1 tek çağrı, toplu silme, b3 silme) |
| `personnelById` | kaçış; kaydırma sonrası düzenleme yalnız ad; iptal edilen silme yazmaz; kod tekrarı reddi |
| `adminBulkOps` | onay sırasında kayıt eklense de grup silme tam hedef id'ler, tek çağrı; toplu ekleme tek batch |
| `ebysH2` | geçiş hatası ve kayıt hatasında talep değişmez; eski L2 onayı L1'e dokunmaz, L2'ye `workflow_<id>`; görüntüleme yazmaz; göç personelde çalışmaz; yabancı geri çekme/ek silme reddi; görüntülemede ek silme butonu yok; sahip geri çekmesinde eski `suspendedAt` silinir, geçmiş korunur; ek url ile silinir |
| `h2Leftovers` | başarısız yükleme + Hayır → kayıt yok; + Evet → 0 ek, "simulated" yok; bozuk görevler çizilir; kill switch snapshot'ı izler, iptal edilen geçiş yazmaz |
| `saveDataV2` | H1 kontrolleri + strict varsayılan: `writeOk` false/true; yakalanmayan hata genel uyarıyı gösterir |

Tam suite: **20/20**, `pageerror` 0 · smoke: `p3-h2` index/admin `pageerror` 0, "Veri Çekildi" 13/13 · `inventory_demo` test artığı: **0**

## Davranış değişiklikleri (kullanıcıya görünür)
- b3 (çıkış) satırını silmek artık onay istiyor; stok değişmez.
- Satın alma talebini yalnız açan kişi veya yönetici geri çekebilir / iptal edebilir / düzenleyebilir / ekini silebilir; talebi silme: yönetici her talep, sahibi yalnız akışı başlamamış talep.
- Görüntüleme modunda ek silinemez; akış devam ederken ek silinemez.
- Dosya yüklenemezse talep otomatik "sahte ekle" kaydedilmez; kullanıcıya sorulur.
- Kill switch geçişi onay istiyor; buton sayfa açılışında gerçek durumu gösteriyor.
- Başarısız her kayıt kullanıcıya hata olarak görünür.

## Sahibinin elle doğrulaması (localhost, admin)
1. B1'de bir ürünü FAB ile düzenle / takibe al / sil → yalnız o ürün etkilenir (konsolda `applyItemOps: b1 1↑` vb.).
2. İki ürünü seçip "Toplu Sil" → onay → ikisi silinir.
3. Bir ürünü B2'ye iç sevk et → B1'den kalkar, B2'de görünür (tek işlem).
4. Personel adını düzenle → oturum kodu ve diğer alanlar korunur.
5. Kritik stok panelinde bir grubu sil → yalnız o grubun ürünleri gider.
6. Bir satın alma talebini başka bir personel oturumuyla geri çekmeyi dene → "işlem yetkiniz yok".
7. VIP → kill switch butonu mevcut durumu gösterir; tıklayınca onay sorar (Vazgeç ile çık).

## Bilinen / H3'e
- Sepet çıkışı (`saveCartExit`, INV-04) ve servisten dönüş (`receiveFromService`, EBYS-21) hâlâ çok adımlı; stok + b3 tek transaction H3 (3.4).
- Personel sarf çıkışının yalnız admin'e bağlanması (karar 3) H3'te, atomik çıkışla birlikte.
- TODO modülü görevleri bellekte değiştirip sonra kaydediyor; başarısız kayıtta bellekteki değişiklik kalır (Faz 5, TODO refaktörü).
- `_purFilesHTML` ek listesi renkleri dark temada sabit (G4 yalnız geçmiş listesini kapsadı).
- K11: Storage'ın mevcut planda çalışıp çalışmadığı hâlâ açık.
