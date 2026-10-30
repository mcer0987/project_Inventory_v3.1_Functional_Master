# SAHA HOTFIX RAPORU — Excel Import ve Demirbaş (B2) Mimarisi

**Branch:** `feat/phase-7-logging-and-ux` (yerel; push/deploy yok)
**Kapsam:** Canlıya çıkmadan ve Astra'nın bağımsız denetiminden önce, saha operasyonlarından gelen 4 maddelik cerrahi düzeltme.
**İlke:** "Şemayı esnetmek yerine, veritabanını doğru kurgulamak" — hiçbir sözleşme (B1_KEYS/B2_KEYS) gevşetilmedi; yeni alan ve davranışlar mevcut sözleşmenin **isteğe bağlı** genişleme noktalarına eklendi.

---

## 1) Envanter Numarası (Demirbaş Kimliği) Entegrasyonu

- **`src/utils/schema.js`**: `envanterNo` **`B2_KEYS`'e DEĞİL**, `STOCK_OPTIONAL_KEYS`'e eklendi (`['isWatched', 'envanterNo']`). Tip denetimi (string) `_validateStock`'a eklendi.
  - **Neden `B2_KEYS` değil:** `B2_KEYS` her tam B2 `set` işleminde ZORUNLUDUR — oraya eklemek `saveProduct`, `atomicInsertItems`, `restoreCollections` gibi bu alanı henüz göndermeyen TÜM mevcut B2 yazma yollarını anında kırardı. `STOCK_OPTIONAL_KEYS` hem `set` hem `update` sözleşmesinde "varsa kabul, yoksa zorunlu değil" davranışı sağlar — geriye dönük uyumlu, sıfır kırılma.
- **`src/utils/stock-import.js`**: `FIELD_ALIASES.envanterNo` eklendi (`Envanter No`, `Envanter Numarası`, vb. başlıklar tanınır). Satır işlenirken yalnız `col === 'b2'` ise `draft.envanterNo` yazılır; B1 için sütun **tanınır** (yanlışlıkla "sütun tanınmadı" uyarısı basılmaz) ama değer hiçbir yere kaydedilmez.

## 2) Excel Import Raf Mantığı — Auto-Create & Overflow

Önceki (Aşama 6) "katalogda yoksa her zaman Havuz" kuralının **yerine** geçti:

- Raf katalogda **VARSA** ve bu içe aktarmayla birlikte kapasiteyi aşmıyorsa → kanonik koda yazılır.
- Raf katalogda **YOKSA** (ve bu içe aktarmada o koda şimdiye kadar yerleşenler varsayılan kapasiteden [`capacity: 5`] azsa) → ürün o koda yazılır; kod `shelvesToCreate` listesine eklenir. **Havuz'a düşmez.**
- Raf (var olan ya da yeni) **DOLU**ysa → o satır Havuz'a (`raf:''`) alınır, hata değil **uyarı** düşer: *"X adet ürün, hedef raf dolu olduğu için havuza alındı."*
- Slot işgal etmeyen (adet 0 / pasif) satırlar kapasite denetiminden ve otomatik yaratmadan muaftır — gereksiz raf yaratılmaz.
- **`script.js` → `importExcel`**: `window.data.shelves`'ten depoya özel `shelfCapacityInfo` (kanonik kod → `{capacity, usedSlots}`) kurulur ve `buildStockRecords`'a geçirilir. Onay diyaloğu artık hem "🆕 N yeni raf otomatik oluşturulacak" hem (varsa) "⚠️ N ürün havuza alındı" bilgisini gösterir. Yeni raflar `atomicInsertItems` **BAŞARIYLA yazıldıktan SONRA** `saveShelfCapacity` ile yaratılır (sıralama bilinçli: `saveShelfCapacity`'nin `countUsage`'ı sunucudan taze okur, ürünler o an zaten orada olduğu için sayaç ilk seferde doğru hesaplanır — ayrı bir Sync turuna gerek kalmaz). Tek bir rafın yaratılması başarısız olsa bile ürün yazımı geri alınmaz; başarısız kodlar kullanıcıya bildirilir (WMS'ten manuel eklenebilir).

## 3) B2 (Demirbaş) Excel Export ve Kritik Stok Mantığı

- **Excel Export**: B1'deki "Excel Rapor" butonu B2 tablosuna da eklendi (`index.html`). `script.js → exportToExcel`'in jenerik dalı, `depo === 'b2'` olduğunda satıra `"Envanter No"` sütununu ekleyecek şekilde güncellendi; B1/Sarf raporunda bu sütun hiç görünmez.
- **Kritik Stok Mantığı (Tür bazlı)**: `src/modules/admin/admin-dashboard.js` incelendi — `window.renderCriticalStockTable`'ın (tek aktif implementasyon; dosyada bir de hiç çalışmayan, tamamen yorum bloğuna alınmış ÖLÜ bir eski kopyası var, dokunulmadı) demirbaş ürünleri zaten `tür` (yoksa ad) bazında gruplayıp (`demirbas_${tür}_${durum}`) grup toplam adedini grup limitiyle karşılaştırdığı doğrulandı. **Bu gereksinim zaten karşılanıyordu, kod değişikliği gerekmedi.**
  - Dürüst bir nüans: gruplama **depolar arası** (b1+b2 birleşik), depo bazlı değil. Bu, "o depodaki" ifadesinin olası depo-özel okumasından farklı ama daha güvenli bir tasarım (az sayma riski yok); bilinçli olarak değiştirilmedi.
- **`limit` zorunlu değil**: Hem Excel import (`stock-import.js`) hem de B2 UI formunda `limit` alanı zaten şartsız biçimde yalnızca "değer varsa" işleniyordu — B2 için ayrıca zorunlu kılan bir kontrol bulunmadı; dolayısıyla ek bir gevşetme gerekmedi. Ayrıca kod tabanında "tür bazlı limit tanımlama" için `#productTypeModal` adlı bir arayüz parçası bulundu ama `onsubmit="saveProductType(event)"` fonksiyonu **hiçbir yerde tanımlı değil** — bu, bu hotfix'ten bağımsız, önceden var olan ölü/kırık bir markup; kapsam dışı bırakıldı ve dokunulmadı.

## 4) Dağıtım Sayacı (hosting-files.js)

`expected()` regex'i kök `manifest.json` (PWA) ve `src/` altı `.css` dosyalarını (WMS `shelf-matrix.css`) kapsayacak şekilde genişletildi; `EXPECTED_COUNT` 53 → **63**'e güncellendi (canlı çalıştırmayla doğrulandı: *"✔ Yalnız uygulama dosyaları yayınlanacak."*).

---

## Test Sonuçları

| Komut | Sonuç |
|---|---|
| `npm run test:unit` | **199/199 geçti** (6 yeni test eklendi: Auto-Create/Overflow senaryoları + Envanter No eşleme/izolasyon) |
| `npm run lint:xss` | **Temiz** — 907 dinamik ifade, 0 izinsiz |
| `node scratch/flow-tests.js p5AuditAtomicImport --emu` | **Geçti** — gerçek emülatör üzerinden Auto-Create (R-4 → otomatik yaratma, Havuz'a düşmez) ve Overflow (dolu R-FULL → Havuz, uyarı) senaryoları UI akışıyla kanıtlandı |
| `npm run test:ledger:emu` | **26/26 geçti** — raf sayacı/transaction motoru bu hotfix'ten etkilenmedi |
| `node scratch/flow-tests.js --emu` (tam paket) | Daha önce bilinen, bu oturumla **ilgisiz** 3 hata dışında temiz: `j3SessionVisa`, `j4SelfApproval`, `j6PostLogoutRelogin` — bunlar `auth-engine.js`'teki committed olmayan, bu hotfix kapsamında değiştirilmeyen önceki değişikliklerden kaynaklanıyor (önceki oturumda da aynı 3 hata tespit edilip onaylanmıştı) |

**`tests/unit/stock-import.test.mjs`** Aşama 6'nın artık geçersiz `knownShelfCodes` tabanlı 5 testi, yeni `shelfCapacityInfo` tabanlı Auto-Create/Overflow davranışını kapsayan 9 testle değiştirildi; ayrıca Envanter No için 3 yeni test eklendi.

**`scratch/flow-tests.js`** `p5AuditAtomicImport`'taki eski "R-4 katalogda yok → Havuz" varsayımı güncellendi: artık R-4'ün Auto-Create ile yazıldığı (ve `saveShelfCapacity`'nin doğru çağrıldığı) ile ayrı olarak DOLU bir rafın (R-FULL) gerçekten Havuz'a düştüğü iki ayrı senaryo olarak kanıtlanıyor.

---

## Dokunulmayan / Bilinçli Olarak Değiştirilmeyen Noktalar

- `admin-dashboard.js`'teki kritik stok motoru (zaten doğru).
- `#productTypeModal` / `saveProductType` — önceden var olan ölü kod, bu hotfix'in kapsamı dışında.
- Tür bazlı kritik stok limitinin depo-bağımsız (cross-depot) toplanması — mevcut davranış korundu, daha güvenli kabul edildi.

Hiçbir şey commit/push/deploy edilmedi; tüm değişiklikler yerel çalışma dizininde. Astra'nın bağımsız denetimine hazır.
