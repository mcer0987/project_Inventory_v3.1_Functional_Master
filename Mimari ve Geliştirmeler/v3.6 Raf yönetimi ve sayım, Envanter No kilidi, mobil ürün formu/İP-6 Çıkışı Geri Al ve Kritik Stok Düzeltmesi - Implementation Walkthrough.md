# İP-6 Çıkışı Geri Al ve Kritik Stok Düzeltmesi — Implementation Walkthrough

> **Tarih:** 16.11.2026
> **Dal:** `refactor/v3.7-script-soc-ayristirmasi` (HEAD `56680ed`; v3.6 İP-1..4'ün devamı olarak bu klasörde tutuluyor)
> **Durum:** Uygulandı; birim testleri ve XSS lint geçti. **Canlıya yayın yapılmadı.**
> **Kapsam:**
> - Her b3 çıkış satırındaki "Çıkışı Geri Al" butonu (önceden yalnız "geliştirme aşamasında" diyen bir bildirimdi) artık gerçekten çalışıyor: demirbaş çıkışını geri alır, stoğu ve envanter no'yu aynı satıra geri yazar.
> - Kritik Stok Takibi tablosundaki "fantom TÜKENDİ" alarmı düzeltildi: servise/zimmete/çıkışa/hurdaya giden tek bir demirbaş birimi artık kendi başına yanlış bir "tükendi" grubu oluşturmuyor.
> **Plan:** kullanıcı diyaloğunda onaylanan plan (bu oturumda), ayrı bir "00 Uygulama Planı" güncellemesi yapılmadı.

## İçindekiler

1. [Talepler ve karşılıkları](#1-talepler-ve-karşılıkları)
2. [Kullanıcının gördüğü davranış](#2-kullanıcının-gördüğü-davranış)
3. [Teknik akış](#3-teknik-akış)
4. [Değişen dosyalar](#4-değişen-dosyalar)
5. [Test ve doğrulama](#5-test-ve-doğrulama)
6. [Sınırlar ve bilinen konular](#6-sınırlar-ve-bilinen-konular)
7. [Yerel test walkthrough](#7-yerel-test-walkthrough)

---

## 1. Talepler ve karşılıkları

| # | Talep | Sonuç |
|---|---|---|
| 1 | Envanter no'lu bir demirbaş çıkış/sevk/zimmet ile depodan ayrılınca "tükendi (0 adet)" görünsün | Zaten doğru çalışıyordu: `computeStockPatch` her üç yolda da aynı transaction'da adet'i düşürüp durumu otomatik "Tükendi" yapıyor. Kod değişikliği gerekmedi; bu davranış doğrulandı. |
| 2 | Geri geldiğinde (zimmetten düş, çıkışı geri al, servisten döndü) tekrar "var" olsun | Zimmet ve servis dönüşü zaten doğru çalışıyordu (satır hiç silinmediği için aynı `productId`'ye `+adet` yazmak yetiyor). **Çıkışı geri alma hiç yoktu** — buton vardı ama placeholder'a bağlıydı; şimdi gerçek bir servis fonksiyonuna bağlandı. |
| 3 (ek, kullanıcı tespiti) | Kritik Stok Takibi servise giden cihazları sayıma dahil etmesin | Asıl sorun "dahil etmek" değil, servise/zimmete/çıkışa giden **tek bir** demirbaş biriminin kendi başına ayrı bir "TÜKENDİ" grup/alarm satırı oluşturmasıydı (tür+durum gruplamasının yan etkisi). Bu grup artık hiç oluşturulmuyor. |

## 2. Kullanıcının gördüğü davranış

### 2.1 Çıkış geçmişi (B3 tablosu/kartları)

| Satır durumu | "Geri Al" butonu |
|---|---|
| Demirbaş çıkışı, henüz geri alınmamış, bağlı depo satırı var | Aktif. Tıklanınca onay penceresi: *"'{ürün}' ({envanterNo}) çıkışı geri alınacak; {depo}'ya +1 adet olarak eklenecek. Onaylıyor musunuz?"* |
| Zaten geri alınmış | Pasif, ipucu: *"Bu çıkış zaten geri alınmış."* |
| Sarf (demirbaş olmayan) çıkış | Pasif, ipucu: *"Sarf malzeme çıkışı geri alınamaz."* |
| Zimmet veya hurda satırı | Pasif, ipucu: *"Yalnız çıkış kayıtları buradan geri alınır (zimmet: 'Zimmetten Düş')."* |
| Stok dışı (bağlı depo satırı olmayan) kayıt | Pasif, ipucu: *"Stok dışı girilmiş kayıt; geri alınacak depo satırı yok."* |

Onaylanınca: ilgili depo satırının adedi +1 olur (0 ise otomatik "Kullanıma Hazır"a döner), b3 kaydı `iadeEdildi:true` işaretlenir (bir daha geri alınamaz), çıkış tablosu ve ilgili depo tablosu yeniden çizilir.

### 2.2 Kritik Stok Takibi (Yönetim Paneli)

Önce: 3 adet "Projektör" (hepsi "Kullanıma Hazır") kayıtlıyken birini servise gönderince tablo hem doğru "Projektör (Kullanıma Hazır): 2 adet" satırını, hem de yanlış bir "Projektör (Tükendi): 0/3 — TÜKENDİ" alarm satırını gösteriyordu.

Sonra: servise/zimmete/çıkışa/hurdaya giden ve bu yüzden otomatik "Tükendi"/"Tükendi / Pasif" durumuna düşen satırlar sayıma hiç girmiyor; yalnız gerçekten tüm birimleri gitmiş bir tür (elinde hiç "Kullanıma Hazır" kaydı kalmamış) hâlâ doğru şekilde kritik/tükendi görünüyor.

## 3. Teknik akış

### 3.1 Çıkışı Geri Al

1. `window.undoExit(b3Id)` (`src/ui/movement-table.js`) — admin doğrulaması, kaydı bulur, onay penceresi gösterir.
2. `AssignmentService.planUndoExit(b3Id, { tarih })` (`src/services/assignment-service.js`) — saf plan fonksiyonu, `planClose` ("Zimmetten Düş") ile birebir aynı kalıp: kayıt var mı, tip `cikis` mı, zaten iade edilmiş mi, demirbaş mı, bağlı depo satırı var mı, satırın rafı sayımda mı — herhangi biri uygun değilse açıklayıcı hata döner.
3. Başarılıysa `window.runStockOps({ stock: [{col, id, delta:+1}], writes: [{op:'update', col:'b3', id, fields:{iadeEdildi:true, iadeEdildiTarihi, iadeDepo}}] })` — stok ve b3 güncellemesi tek Firestore transaction'ında, var olan atomik stok motoru üzerinden (yeni bir yazma yolu icat edilmedi).
4. `computeStockPatch` (`firebase-handler.js`, değişmedi) adet 0→1 geçişinde durumu otomatik eski haline döndürür.

### 3.2 Kritik Stok filtresi

`renderCriticalStockTable` (`src/modules/admin/admin-dashboard.js`) artık `STOCK_AUTO_EMPTY` (`firebase-handler.js`'ten import, `['Tükendi', 'Tükendi / Pasif']`) içindeki durumlardaki satırları tamamen atlıyor — var olan "Pasif" filtresiyle aynı yerde, aynı desenle.

### 3.3 Defansif düzeltme

`receiveFromService` (`src/services/purchase-servises.js`) artık `sn`/`envanterNo`'yu geri yüklenen kayıttan silmiyor. Normal akışta etkisizdi (satır hiç silinmediği için bu alan zaten kullanılmıyordu); yalnız satırın gerçekten silinip `createIfMissing` ile yeniden oluşturulduğu nadir durumda kilitli envanter no'nun kaybolmasını önler.

## 4. Değişen dosyalar

- `src/services/assignment-service.js` — yeni `planUndoExit`, dışa açıldı.
- `src/ui/movement-table.js` — yeni `window.undoExit`; `_b3ActionButtons` artık `row` alıyor ve uygun olmayan satırlarda butonu nedenle birlikte pasifleştiriyor.
- `src/services/purchase-servises.js` — `receiveFromService`'te sn/envanterNo silme satırı kaldırıldı.
- `src/modules/admin/admin-dashboard.js` — `STOCK_AUTO_EMPTY` import edildi; kritik stok filtresine eklendi.
- `tests/unit/script-bridge-contract.test.mjs` — yeni `undoExit` adı sözleşme listelerine eklendi.

## 5. Test ve doğrulama

Ayrıntılar `İP-6 - Test Kanıtları.txt` içinde. Özet: `npm run lint:xss` 0 izinsiz; `npm run test:unit` 395/395 (köprü sözleşmesi testi dahil); `npm run test:rules` değişmemiş (bu iş Rules'a dokunmuyor) — regresyon kontrolü için ayrıca koşuldu.

## 6. Sınırlar ve bilinen konular

- Çok-birimli (adet>1) partilerde tek bir envanterNo'nun parti içinden "canlı" izlenmesi kapsam dışı — bugünkü şema bu alanı yalnız adet≤1 satırlarda tutuyor.
- Hurda (`tip:'hurda'`) kayıtları bilinçli olarak geri alınamaz kalmaya devam ediyor.
- "Arızalı" gibi elle girilmiş (otomatik olmayan) durumlar kritik stok filtresinden etkilenmiyor; bu kasıtlı (fiziken bozuk duran stok gerçek bir ilgi konusu).

## 7. Yerel test walkthrough

1. B1/B2'de aynı türden 3 demirbaş oluştur (hepsi "Kullanıma Hazır", farklı envanter no).
2. Kritik Stok Takibi'nde bu tür için alarm olmadığını doğrula (3 ≥ limit).
3. Bir tanesini Sevk Et → Servis ile gönder. Depo satırı adet 1→0, durum "Tükendi" olur (konsoldan/kayıttan kontrol edilebilir).
4. Kritik Stok Takibi'ni yenile: "Tükendi" alarmı GÖRÜNMEMELİ (2 tanesi hâlâ "Kullanıma Hazır"). Düzeltme öncesi bu adımda yanlış bir alarm çıkıyordu.
5. B3 (Çıkış/Hareket) tablosunda bu türden ayrı bir demirbaşı normal Envanter Çıkışı ile çıkar (adet 1→0).
6. B3 satırında "Geri Al" düğmesine bas → onay penceresini onayla. Depo satırı adet 0→1'e döner, durum eski haline ("Kullanıma Hazır") döner, buton artık pasif ve "zaten geri alınmış" ipucu gösterir.
7. Aynı demirbaşı sarf bir ürünle karşılaştır: sarf çıkışında "Geri Al" baştan pasif ("sarf malzeme çıkışı geri alınamaz").
8. Rafı sayıma alınmış bir demirbaşın çıkışında "Geri Al" denendiğinde "rafı sayımda" hatası alınmalı.
