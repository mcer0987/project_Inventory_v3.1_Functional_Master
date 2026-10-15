# Faz 5 Kapanış Walkthrough — Tamamlama: Eksik Özellikler ve UX

> **Tarih:** 15.10.2026 · **Dal:** `feat/phase-5-completion-and-ux` → `master` (`--no-ff`, merge commit `73834eb`)
> **Deploy hotfix'i:** `d153c66` (master)
> **Denetim:** Bağımsız Faz 5 denetimi ilk turda 68/100 · NO-GO (P0, P1) → düzeltme turu sonrası **GO**.
> **Ayrıntılar:** `Faz 5 Tur K1/K2/K3 Walkthrough.md`, `Faz 5 Denetim Düzeltmeleri (P0-P1) Walkthrough.md`

## 1. Turlar ve teslim edilenler

| Tur | Plan maddesi | Teslim edilen |
|---|---|---|
| **K1** | 5.1 · ZIM-04 | Resmi zimmet tutanağı PDF motoru: kanonik belge nesnesi (`zimmet-belge/1`, `assignment-service.js`), jsPDF + AutoTable, gömülü Roboto (Türkçe glif garantisi, tembel yükleme), dinamik "Teslim Eden", sayfa taşma koruması; personel "Zimmet Tutanağımı İndir" ve admin satır içi tutanak. |
| **K2** | 5.8 · 5.10 · INV-05/06/07 | B1/B2 şema sözleşmesi (`validateB1/B2`; `applyItemOps`/`runStockOps`/`saveData` muhafızı); hurdaya ayırma akışı (atomik stok düşümü + `b3 tip:'hurda'` + açık servis kaydını kapatma); B1↔B2 kısmi sevk; sayfalama ve "Sadece Aktifler" filtresinin canlı güncellemede kararlılığı. |
| **K3** | 5.2 · 5.3 · 5.5 (VIP-08) · 5.6 (ADM-05) · 5.7 | Özel İzleme Paneli'nin kendini silmesi onarıldı; admin'de çalışan hızlı personel/ürün ekleme; merkezi `AppModules.AdminTabs` kanca sicili (üç monkey-patch kaldırıldı); birleşik kanonik yedekleme servisi (`v3.2`, ortam/root denetimi, önizlemeli geri yükleme); VIP sağlık döngüsü yalnız sekme görünürken. |
| **K3.5** | saha talepleri · VIP-09 | `admin-system-control.js` mojibake temizliği; sidebar sadeleştirme; "Operasyon Merkezi" (ad, taşma, dark mode); gelecek widget yer tutucuları. |
| **Denetim düzeltmesi P0** | ADM-06 (veri bütünlüğü) | `src/services/atomic-writer.js`: tek batch'e sığmayan geri yükleme/içe aktarma için günlüklü (WAL) iki aşamalı yazma. Parça sayacı veriyle aynı batch'te yazılır; hata olursa yazılan parçalar geri alınır; geri alma da düşerse kilit ve günlük sunucuda kalır ve ilk yönetici oturumunda `recover()` tamamlar. Geri yükleme `restoreCollections` ile yapılır (sunucudan taze plan, tam değiştirme). |
| **Denetim düzeltmesi P1** | 5.8 ek · B1/B2 sözleşmesi | `saveData`'daki K2 istisnası ve `stockLegacy` gevşetmesi kaldırıldı; `Schema.toCanonicalStock` tek kanonik kurucu; CSV/Excel içe aktarma yeniden yazıldı (`stock-import.js`: başlık eşleme, tam sözleşme, tek hatalı satırda hiç yazma yok, `atomicInsertItems`); çalışmayan CSV dalı ve `pdf-generator.js`'teki çakışan eski `importExcel` giderildi. |
| **Deploy hotfix'i** | kapanış | `firebase.json` ve `.dockerignore`: `repomix-output*` dışlandı (yerel depo dökümünün yayına sızması engellendi). `Dockerfile` + `.dockerignore`: `pdf-fonts/` imaja alındı (Docker'da tutanak fontları 404 veriyordu). `scratch/hosting-files.js`: `pdf-fonts` beklenen kümede ve toplam sayı **52**'ye sabitlendi. |

### Faz 5 planından kapsam dışında kalanlar
Tur walkthrough'larında aşağıdakilerin uygulandığına dair kayıt yok; Faz 6 planlamasında ele alınmalı:
- **5.4** Satın alma: tek renderer + gerçek sayfalama, tek `getPurchaseStatus`, KPI'lar (EBYS-10, 11, 19).
- **5.5**'in VIP-08 dışındaki kalemleri: konsol yakalayıcı tamponlama, hata listesi sınırı, heatmap anahtarı, God-Eye presence (VIP-11, VIP-03).
- **5.6**'nın ADM-05 dışındaki kalemleri: Kritik Stok data-attribute, stub butonlar (ADM-08).
- **5.9** TODO ve zimmet ekran cilası (TODO-05, ZIM-07).

## 2. Kabul edilmiş riskler

| Risk | Karar |
|---|---|
| Bakım modunda Firebase admin oturumu yazmaya devam eder; toplu yazma kilidi (`restoreLock`) bakım modu gibi istemci tarafında uygulanır, Firestore kuralları zorlamaz. Eşzamanlı ikinci bir admin teorik olarak çakışabilir. | Sistemde tek admin olduğu için **Kabul Edilmiş Operasyonel Risk** (sahibi). |
| Yarım kalmış toplu yazmanın geri alınması bir yönetici oturumunun açılmasını gerektirir; o zamana kadar kilitli koleksiyonlar yazmaya kapalıdır. | Tasarım gereği: yarım veri hiçbir zaman kilitsiz ve görünmez kalmaz. |
| Faz 4B sahiplik denetimi (personelin requests/purchaseOrders dokümanları). | Bilinçli olarak ertelendi; sıradaki iş. |

## 3. Nihai test metrikleri (master)

| Paket | Sonuç | Faz 5 boyunca |
|---|---|---|
| `npm run test:unit` | **53/53** | K1 14 → K2 22 → K3 28 → P0-P1 53 |
| `npm run test:atomic:emu` (yeni · Firestore emülatörü + üretim kuralları) | **5/5** | — |
| `npm run test:rules` | **72/72** | 72/72 (kurallar değişmedi) |
| `node scratch/flow-tests.js --emu` (tam paket) | **50/50** · 0 sayfa hatası · 0 CSP ihlali | K2 47 → K3 49 → P0-P1 50 |
| `npm run lint:xss` | **0 izinsiz** (43 dosya, 194 sink) | 41 → 43 dosya |
| `node scratch/hosting-files.js` | **52/52** ✔ (kök 20, src 29, pdf-fonts 3) | hotfix öncesi 53 (repomix sızıntısı) ✖ |

Öne çıkan senaryolar:
- Kısmi batch hatası her parçada ayrı ayrı sınandı.
- Yanıtı kaybolan commit, geri alma sırasında bağlantı kopması ve sekme çökmesi senaryolarının üçünde de kurtarma çalıştı.
- Emülatörde 1200 dokümanlık (500 sınırının üstü) geri yükleme sınandı: ortadaki parçada **gerçek sunucu reddi** (1 MiB üstü doküman) sonrası veri tamamen eski hâline döndü.
- Tarayıcıda gerçek admin oturumuyla üç senaryo geçti:
  - 900 kayıtta sunucu reddi → `rolled-back`
  - 600 kaydın günlüklü eklenmesi
  - 600 kaydın atomik geri yüklemeyle silinmesi

Doğrulanamayan: Docker imajı bu oturumda derlenemedi (Docker daemon çalışmıyordu). `Dockerfile` / `.dockerignore`
değişikliği deploy öncesi `docker build` + `node scratch/docker-check.js` ile doğrulanmalı.

## 4. Deploy notları
- `pdf-fonts/OFL.txt` Firebase Hosting'de yayınlanır. nginx imajında dosya bulunur ama `.txt` engeli nedeniyle HTTP'den 404 döner; bu zararsızdır (fontların çalışması etkilenmez).
- `repomix-output.xml` git dışı yerel bir dosyadır; artık hosting ve Docker'dan dışlanıyor, ama `.gitignore`'da değildir.
- `firebase deploy` öncesi runbook Adım 0: `node scratch/hosting-files.js` → beklenen çıktı `52 · ✔`.
