# İP-8 EBYS Katalog Seed Verisi — Implementation Walkthrough

> **Tarih:** 17.11.2026
> **Dal:** `refactor/v3.7-script-soc-ayristirmasi` (HEAD `56680ed`)
> **Durum:** Script'ler yazıldı ve **yerel emülatörde uçtan uca doğrulandı** (20/20 dosya planı, 5/5 şablon, 0 pageerror). **Canlıya henüz uygulanmadı** — kod değişikliği yok, yalnız veri; production'a admin kimlik bilgim olmadığı için kullanıcı kendi oturumunda çalıştıracak.
> **Kapsam:** H6b (Kurum Künyesi/Dosya Planı/Üst Yazı Şablonları) canlıya alındıktan sonra boş kalan katalog için gerçek seed verisi + birim/atama tasarım sorusu + VIP panel için 3. parti bağımlılık listesi (yalnız metin).
> **Detaylı analiz ve tam liste:** [`audits/audit-reports/2026-11-17_EBYS_Katalog_Seed_ve_Birim_Tasarim_Notu.md`](../../audits/audit-reports/2026-11-17_EBYS_Katalog_Seed_ve_Birim_Tasarim_Notu.md)

## 1. Talepler ve karşılıkları

| # | Talep | Sonuç |
|---|---|---|
| 1 | Gerçek hayatta çalışacak ≥15 dosya planı kodunu canlıya ekletecek script | 20 kod, `scratch/ebys-seed/seed-file-plans.js` |
| 2 | Nasıl çalıştığının ve ne için gerektiğinin açıklanması | Script başlığında [WHY]/[HOW] + audits belgesinde ayrıntı |
| 3 | 5 gerçek EBYS senaryosu şablonu ekleyen script | `scratch/ebys-seed/seed-letter-templates.js` |
| 4 | Birim ataması mı, global mi, kişisel üretim mi daha sağlıklı | Yazılı analiz: Dosya Planı global kalmalı; şablonlar şimdilik global/admin-küratörlü, kişisel ihtiyaç doğarsa yön `ebysDrafts`'ın `ownerUid` örüntüsü (birim değil) |
| 5 | VIP panele sunulacak 3. parti API/bağımlılık listesi | Üç gruba ayrılmış liste (gerçek API / CDN / yerel); kullanıcı kararıyla VIP paneline gerçek kart olarak **eklenmedi**, yalnız metin |

## 2. Kullanıcının gördüğü davranış

Admin panel → **Tanımlar** sekmesi → Dosya Planı listesinde 20 kod (000–900), Üst Yazı Şablonları listesinde 5 şablon (Bilgi Talebi, Görevlendirme Yazısı, Toplantı Daveti, Cevabi Yazı, Olur Yazısı) görünür hâle gelir. Script'ler çalıştırılmadan önce katalog boştu.

## 3. Teknik akış

İki script de tarayıcı konsolu script'idir (Node değil — `window.AppModules.EBYSCatalog` yalnız admin.html'de, admin oturumuyla yüklü). Ham Firestore yazması yapmazlar; var olan, zaten rules'tan geçen servis fonksiyonlarını çağırırlar:

- `EBYSCatalog.saveFilePlan({code,title}, {create:true})` — her kod kendi transaction'ı; revizyon/`serverTimestamp()` servis tarafından atanır (`src/services/ebys-catalog-service.js:58-72`). Kod zaten varsa o satır hatayla reddedilir, script durmaz.
- `EBYSCatalog.saveTemplate({name,subject,content})` — `id` verilmediği için her çağrı yeni bir şablon/ilk sürüm oluşturur (`src/services/ebys-catalog-service.js:81-98`). **İdempotent değildir** — ikinci çalıştırmada aynı 5 şablon tekrar eklenir.

Her iki script de sonunda `console.table` ile özet, `[seed] N/M eklendi` ile sayaç basar.

## 4. Değişen dosyalar

| Dosya | Not |
|---|---|
| `scratch/ebys-seed/seed-file-plans.js` | Yeni. `.gitignore:73` (`/scratch/`) sayesinde commit/push'a girmiyor — bilinçli, kullanıcı kararı. |
| `scratch/ebys-seed/seed-letter-templates.js` | Yeni, aynı gerekçe. |
| `audits/audit-reports/2026-11-17_EBYS_Katalog_Seed_ve_Birim_Tasarim_Notu.md` | Yeni — tam kod/rules zemini, 20 kodun tam listesi, birim analizi, API listesi. |
| Bu belge | Yeni. |

## 5. Test ve doğrulama

Yerel emülatörde (`npm run emu` zaten çalışıyordu, port 8080/9099/4000/5500), gerçek `admin.html?emu=1` üzerinde, Puppeteer ile admin girişi (`emu-yonetici-0001`) yapılıp iki script sırayla sayfa içinde çalıştırıldı; sonuç `EBYSCatalog.loadCatalog()` ile (bypass yok) geri okunarak doğrulandı:

```
ADMIN LOGIN: ok ✔
seed-file-plans.js       → 20/20 ✔
seed-letter-templates.js → 5/5 ✔
loadCatalog() → filePlanCount:20, templateCount:5
pageerrors: []
```

Emülatörün o anda paralel bir oturum tarafından (aynı veri kökü `inventory_demo` üzerinde salt-okunur bir doğrulama turu için) kullanılmış olabileceği görülmüştü; çalıştırmadan önce aktif bir tarayıcı/Chrome süreci olmadığı teyit edildi, işlem yalnız **ekleme** olduğu için (sil/güncelle yok) çakışma riski düşük kabul edildi.

## 6. Sınırlar ve bilinen konular

- **Canlıya henüz uygulanmadı.** Script'ler değişmeden duruyor; kullanıcı kendi admin oturumunda (canlı admin.html → F12 konsol) çalıştırmalı. Bende production admin kimlik bilgisi yok.
- **Dosya planı kodları yasal olarak doğrulanmadı.** Türkiye kamu kurumlarının yaygın Standart Dosya Planı (000–900) yapısına dayanıyor; resmi genelgeyle birebir sayı eşleşmesi teyit edilmedi — kurumun Yazı İşleri/Arşiv birimiyle karşılaştırılmalı.
- **Şablon script'i idempotent değil.** İkinci çalıştırmadan önce Tanımlar sekmesinden mevcut şablonlar kontrol edilmeli; aksi hâlde aynı 5 şablon tekrar eklenir.
- Birim ataması ve kişisel şablon özelliği **kodlanmadı** — yalnız öneri olarak belgelendi (bkz. audits notu §3).
- VIP paneline API listesi kartı eklenmedi (kullanıcı kararı); istenirse mevcut "Debug & Hata Takip" kartı deseni (`admin-system-control.js:386-427`) izlenerek ayrı bir iş olarak eklenebilir.

## 7. Yerel test walkthrough

1. `npm run emu` + emülatörde admin oturumu açın (kod: `emu-yonetici-0001`).
2. Admin panel → Tanımlar sekmesi → F12 → Console.
3. `scratch/ebys-seed/seed-file-plans.js` içeriğini yapıştırıp çalıştırın → `console.table`'da 20 satır, hepsi "✔ eklendi".
4. `scratch/ebys-seed/seed-letter-templates.js` içeriğini yapıştırıp çalıştırın → 5 satır, hepsi "✔ eklendi".
5. Tanımlar sekmesini yenileyin; Dosya Planı ve Üst Yazı Şablonları listelerinde yeni kayıtları görün.

## 8. Yayın/uygulama adımları (canlı)

Firestore kuralı/şeması değişmedi; yalnız veri eklenecek. Canlı admin.html'de 3. ve 4. adımları (yukarıdaki) aynen uygulayın. Rollback: her iki koleksiyonda silme yok (`allow delete: if false` — firestore.rules `ecPlanOk`/`ecTemplateOk` blokları); yanlış girilen bir kayıt "pasifleştirme" (`setFilePlanActive`/`setTemplateActive`) ile devre dışı bırakılabilir, silinemez.
