# Faz 5 Denetim Düzeltmeleri (P0 · P1) — Walkthrough

Bağımsız Faz 5 (K1–K3) mimari denetimi 68/100 ile **NO-GO** verdi; iki kritik açık bu turda kapatıldı.
Dal: `feat/phase-5-completion-and-ux`. Faz 4B sahiplik denetimi bilinçli olarak kapsam dışı.

## P0 — Yedek geri yüklemede kısmi kalıcı yazım

**Sorun.** `restoreFromText` → `saveData` → 490'lık **bağımsız** batch'ler. 1. batch commit olup 2. batch düşerse
Firestore'da yarım veri kalıyordu; hata dalı yalnız `window.data = prev` ile istemci belleğini geri alıyordu.
Ek olarak `saveData` `merge: true` yazdığı için geri yüklenen doküman, sunucudaki fazla alanları da taşıyordu
(birebir geri yükleme değildi).

**Kısıt.** Firestore istemci SDK'sında 500 işlemden büyük atomik yazma yok. Tek batch'e sığmayan bir işi doğal olarak
atomik yapmanın yolu yok; "hepsi ya da hiçbiri" garantisi bir protokolle kurulmalı.

**Çözüm — `src/services/atomic-writer.js` (günlüklü iki aşamalı yazma + telafi + kurtarma).**

| Aşama | Ne yazılır | Garanti |
|---|---|---|
| Tek batch'e sığan iş (≤ 450 işlem, ≤ 8 MB) | Tek `writeBatch` | Firestore'un kendi atomikliği; günlük yok |
| 1. Hazırlık | `[günlük başlığı {state:'preparing'} + admin_settings.restoreLock]` tek batch, ardından dokunulacak her dokümanın **önceki hâli** günlük parçalarına (≤ ~900 KB/doküman, string) | Hiç veri yazılmadı; hata → günlük ve kilit temizlenir |
| 2. Uygulama | Her veri parçası, başlığın `committedChunks` sayacıyla **aynı batch'te** | Sunucudaki başlık, hangi parçaların yazıldığını her an kesin bilir |
| 3. Hata | 0..k parçaları (k dahil — yanıtı kaybolmuş commit'e karşı) önceki hâline geri yazılır; yeniden denemeli, idempotent | Firestore işlem öncesi hâlinde |
| 4. Kapanış | Günlük parçaları + başlık silinir, kilit kalkar | — |
| Geri alma da yapılamazsa | Günlük + kilit **sunucuda kalır** (`rollback-pending`) | Veritabanı kilitli; ilk yönetici oturumunda `recover()` geri almayı tamamlar (sekme çökmesi dahil) |

Kilit (`admin_settings.restoreLock`) tüm istemcilerin zaten dinlediği dokümanda; kilit varken kilitli koleksiyonlara
giden `saveData` / `applyItemOps` / `runStockOps` yazmaları Firestore'a gönderilmez (`bulk-locked`). Yönetici sekmesi
kilidi görünce, iş sahibi 2 dakikadır ilerlemiyorsa kurtarmayı otomatik çalıştırır.

Geri yükleme artık `window.restoreCollections(target)` ile yapılır: plan `_dbMirror`'dan değil **sunucudan taze**
okunur, yazma **tam değiştirme** (merge yok), değişmeyen doküman yazılmaz (Timestamp türü korunur). CSV/Excel içe
aktarma da aynı motoru kullanır (`window.atomicInsertItems`).

**Sınır (dürüst not).** Kilit, mevcut bakım modu gibi istemci tarafı bir kilittir; Firestore kuralları kilidi
uygulamaz. Kurtarmayı tetiklemek için bir yönetici oturumunun açılması gerekir; o zamana kadar ilgili koleksiyonlar
yazmaya kapalıdır (yarım veri hiçbir zaman kilitsiz ve görünmez kalmaz).

## P1 — B1/B2 toplu yazma yolunda sözleşme boşluğu

**Sorun.** K2'de `saveData` b1/b2 yeni kayıtlarını tam `set` sözleşmesinden geçirmiyordu (yalnız eski alan adı
denetimi), çünkü içe aktarma `rafNo`, `limit`, isDemirbas'sız kayıt üretiyordu. Ayrıca:
- İki `importExcel` vardı; `pdf-generator.js`'teki eski kopya admin.html'de `script.js`'ten sonra yüklendiği için
  kanonik olanın üzerine biniyordu (name/type/shelf/status/qty, yalnız bellek).
- CSV dalı dosyayı ArrayBuffer okuyup metin gibi bölmeye çalıştığı için **hiç çalışmıyordu**.
- Sayı olmayan adet sessizce 0, eksik marka "Unbranded", eksik tür "Sarf" uyduruluyordu.

**Çözüm.**
- `Schema.toCanonicalStock(p, col)` — tek kanonik stok kurucusu: takma adların değeri kanonik alana taşınır
  (`rafNo/shelf → raf`, `name → ürün`, `qty → adet` …), takma ad silinir; `isDemirbas` boolean değilse
  `Schema.isDemirbas` kuralıyla üretilir; b2'de `durumu/status` birbirinden tamamlanır. Değer uydurmaz.
- `src/utils/stock-import.js` — RFC 4180 CSV (`, ; sekme`, UTF-8 / Windows-1254), başlık eşleme (Türkçe/İngilizce,
  aksan duyarsız), satır doğrulama, her kayıt `validateB1/B2` **tam sözleşmesi**. Tek hatalı satır → hiçbir şey yazılmaz.
- `importExcel` (script.js): StockImport → önizleme onayı (kaç demirbaş/sarf, uyarılar) → `atomicInsertItems`
  (yalnız yeni kayıtlar; depodaki mevcut kayıtlar yeniden yazılmaz). Eski `pdf-generator.js` kopyası kaldırıldı.
- `saveData`: yeni b1/b2 dokümanı tam `set` sözleşmesinden geçer; kanonik bir kayıt bu yoldan kanonik olmayana
  dönüştürülemez (merge sonrası hâl denetlenir). `stockLegacy` gevşetme bayrağı kaldırıldı — hiçbir yazma yolu eksik
  alanlı b1/b2 yazamaz. Eski biçimli mevcut dokümanlarda (göç edilmemiş) yalnız yeni alan adı denetimi sürer (b3 ile aynı).
- Geri yükleme: eski yedeklerdeki b1/b2 kayıtları önizlemeden önce kanonikleştirilir (önizlemede uyarı), ardından
  aynı tam sözleşmeden geçer.

## Testler

| Komut | Sonuç | Kapsam |
|---|---|---|
| `npm run test:unit` | 53/53 | motor (her parçada kısmi batch hatası, yanıtı kaybolan commit, geri alma hatası → kurtarma, sekme çökmesi, hazırlık hatası, temizliği yarım iş, şema reddi, Timestamp kodlama), içe aktarma, toCanonicalStock, yedek kanonikleştirme |
| `npm run test:atomic:emu` | 5/5 | Firestore emülatörü + üretim kuralları: 1200 dokümanlık çok parçalı geri yükleme, **gerçek sunucu reddi** (2. parçada 1 MiB üstü doküman) → geri alındı, yanıtı kaybolan commit, bağlantı kopması → kurtarma, yönetici olmayan oturum reddi |
| `node scratch/flow-tests.js --emu p5AuditAtomicImport` | ok | Tarayıcı + gerçek admin oturumu, firebase-handler köprüleri: 900 kayıtta gerçek sunucu reddi → `rolled-back`, 600 kayıt günlüklü ekleme, 600 kayıt atomik geri yükleme ile silme; kilit/günlük temiz |
| `node scratch/flow-tests.js p5AuditAtomicImport k3BackupAndVipLoop b1WriteContract b2WriteContract hotfixBulkLock hotfixB3Guard` | ok | Gerçek UI `importExcel` (CSV/XLSX), saveData sözleşmesi, kilit, geri yükleme akışı; sayfa hatası 0, CSP ihlali 0 |
| `npm run test:rules` | 72/72 | Kurallar değişmedi (regresyon) |
| `npm run lint:xss` | izinsiz 0 | — |
