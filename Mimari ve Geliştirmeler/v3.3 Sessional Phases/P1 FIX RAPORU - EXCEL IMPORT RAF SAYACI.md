# P1 FIX RAPORU — Excel İçe Aktarma: Kapasite / Sayaç Senkronizasyonu

**Branch:** `feat/phase-7-logging-and-ux` (yerel; commit / push / deploy yok)
**Bulgu (Astra, P1):** `importExcel → atomicInsertItems` ürünleri yazıyor, yeni rafları ayrı bir `saveShelfCapacity` çağrısıyla yaratıyordu; **mevcut rafların `usedSlots` sayacı hiç artmıyordu**. Ardışık içe aktarmalar kapasiteyi deliyor, ayrı yazmalar da "ürün yazıldı ama raf yaratılamadı" kısmi başarısına izin veriyordu.

---

## 1. Kök neden (incelenen yollar)

| Dosya | Bulgu |
|---|---|
| `script.js` `importExcel` | Ürünler `atomicInsertItems` ile, yeni raflar ARDINDAN döngüde `saveShelfCapacity` ile — iki ayrı, birbirinden bağımsız yazma. |
| `firebase-handler.js` `atomicInsertItems` | Yalnız `b1/b2` girdisi üretiyordu; raf koleksiyonu işin dışında. |
| `firebase-handler.js` `saveShelfCapacity` | Yalnız **yeni** rafta kullanımı sayıyor; mevcut rafta sayacı yeniden hesaplamıyor (Astra'nın 4. maddesi). |
| `stock-import.js` | Yerleşim kararı bayat `window.data.shelves` önbelleğine dayanıyordu. |
| `atomic-writer.js` | Girdi modeli (`prev`/`next`, tam belge `set`, geri alma `set(prev)`/`delete`) raf belgesini taşımaya uygundu — **ama** `firestore.rules` bu geri alma yazmalarını reddederdi (aşağıda §3). |

## 2. Çözüm — tek AtomicWriter işi

- **Tek saf plan kuralı** (`StockImport.planShelfPlacement` / `planImportEntries`): onay diyaloğu bunu yerel önbellekle **önizler**; kesin karar commit anında, AtomicWriter'ın `entries(store)` adımında **sunucudan taze okunan raf belgeleriyle** yeniden verilir.
- **Aynı iş kapsamı:** ürün yazmaları + yeni raf belgeleri + mevcut rafların `usedSlots` güncellemesi aynı `AtomicWriter.run` girdi listesinde. İş tek batch'e sığıyorsa tek atomik commit; sığmıyorsa WAL günlüğü + kilit + telafi edici geri alma. Raf girdileri **önce** gelir (çok parçalı işte 1. parça): sayaç kuralı reddederse hiçbir ürün yazılmadan durur.
- **Kapasite gizlenmez:** dolu (ya da zaten aşılmış) rafa giden ürün `raf: ""` (Havuz) olur ve **sayaca eklenmez**; kapasite hiçbir koşulda otomatik artırılmaz. Pasif raf da Havuz'dur (ayrı uyarı).
- **`saveShelfCapacity` içe aktarmadan tamamen çıkarıldı** — sayaç güncellemesi yalnız AtomicWriter'ın parçası.
- **Yeni giriş noktası:** `window.atomicImportStock(col, records, shelfRequests)` (`firebase-handler.js`). `atomicInsertItems` diğer çağıranlar için değişmeden kaldı (ortak id denetimi `_newItemsError`'a çıkarıldı). Toplu yazma şema muhafızı artık raf girdilerini de `Schema.validateShelfDoc` ile doğrular.
- **Sonuç bildirimi gerçeği söyler:** başarı mesajı önizlemeden değil, commit planından üretilir ("N yeni raf oluşturuldu · N rafın sayacı güncellendi · N ürün raf dolu olduğu için Havuz'a alındı").

### Eşzamanlılık (kapasite deliğinin ikinci kapısı)
Taze okuma ile commit arasında bir transfer aynı rafa yazarsa, kör `set` onun sayacını ezer ve kapasite yine delinirdi. Bu yüzden raf girdileri `cas: true` taşır:
- **Tek batch'lik iş:** koşullar ve yazmalar **aynı Firestore transaction'ında** (`store.commitIfUnchanged`) — raf değişmişse `conflict`, hiçbir şey yazılmaz.
- **Günlüklü iş:** kilit alındıktan sonra, ilk veri parçasından önce rafların plandaki hâlde olduğu doğrulanır; değişmişse günlük/kilit temizlenir, `conflict`.
- `atomicImportStock` `conflict`'te taze okumayla **en çok 3 kez** yeniden planlar; olmazsa kullanıcıya "tekrar deneyin" der.

## 3. Kural değişikliği (`firestore.rules`) — neden zorunluydu

Raf belgesi kuralı `updatedAt == request.time` ister ve yalnız **boş** rafın silinmesine izin verir. Geri alma ise rafın **önceki** belgesini (eski zaman damgası) yazar ve bu işte yaratılmış **dolu** rafı siler → ikisi de reddedilir, iş `rollback-pending`'de kilitli kalırdı. Değişiklik:

- `shelfDocOk` = `shelfShapeOk` + sunucu saati + uid (davranış aynı).
- **Yalnız toplu yazma kilidi (`restoreLock`) sürerken:** şekli geçerli raf belgesi zaman/uid kanıtı olmadan yazılabilir ve dolu raf silinebilir. Kod/depo değişmezliği ve şema (fazla alan, kod deseni, kapasite aralığı) kilit altında da geçerlidir. Bu, b1/b2 için zaten var olan geri alma muafiyetiyle aynı desendir.
- Kilitsiz durumda kural öncekiyle aynı sıkılıkta (emülatör testiyle kanıtlandı).

## 4. Kanıtlar

### Birim testleri — `tests/unit/import-shelf-atomic.test.mjs` (yeni, 11 test)
Gerçek `schema.js` + `stock-import.js` + `atomic-writer.js`, `atomicImportStock` ile aynı akış, batch atomikliğini taklit eden bellek-içi depo:

| Astra'nın istediği kanıt | Test |
|---|---|
| `capacity=5, usedSlots=4`: ilk import rafa, ikinci Havuz'a | ✔ 1. import: raf `RAF-A`, sayaç **5** (tek koşullu commit). 2. import: `raf: ""`, raf belgesi **hiç yazılmadı**, sayaç 5'te. |
| Yeni rafa 6 kayıt → 5 raf, 1 Havuz, `usedSlots=5` | ✔ Raf belgesi ürünlerle aynı işte `{capacity:5, usedSlots:5, active:true}`; tam raf sözleşmesinden geçer; sayaç = rafa yerleşen gerçek ürün sayısı. |
| Ara commit hatası → ürün, raf, sayaç birlikte geri alınır | ✔ 3. veri parçası düşer; ara durumda sayacın (2→6) ve yeni rafın **gerçekten yazılmış** olduğu doğrulanır; sonra tüm uygulama verisi işlem öncesiyle **birebir** aynı, günlük ve kilit temiz. |

Ek: yanıtı kaybolan parça da geri alınır · bağlantı koparsa kilit + günlük kalır ve `recover` ürün/raf/sayacı birlikte geri alır · eşzamanlı sayaç değişikliği tek batch'te ve günlüklü işte `conflict` verir, eşzamanlı yazmanın sayacı ezilmez · yeniden denemede kapasite aşılmaz · plan kuralları (raf girdileri önce ve `cas`'lı; aşılmış raf büyütülmez; pasif raf Havuz; başka deponun aynı kodu karışmaz).

### Emülatör — GERÇEK `firestore.rules` altında (`npm run test:atomic:emu`, 5 yeni test)
- capacity=5/usedSlots=4 → 1. import rafa (sayaç 5, gerçek `serverTimestamp`), 2. import Havuz'a, raf belgesi değişmedi.
- Yeni rafa 6 kayıt → 5/1, raf `usedSlots=5` ile yaratıldı.
- **900 kayıtlık günlüklü iş, ortadaki parçada gerçek sunucu reddi (1 MiB üstü belge)** → ürünler, yeni raf ve sayaç birlikte geri alındı; geri alınan raf belgesi `Timestamp` türü dahil birebir aynı; günlük/kilit temiz. (Bu test kural muafiyeti olmadan geçemez.)
- Plan ile commit arasında raf değişirse transaction `conflict` verir, eşzamanlı sayaç ezilmez.
- Kural: kilitsiz eski-zaman-damgalı raf yazımı ve dolu raf silme **reddedilir**; kilit altında izinlidir; kilit altında bile şema bozuk belge ve kod değişikliği reddedilir.

### Tarayıcı akışı — `p5AuditAtomicImport --emu`
Gerçek `importExcel` → **gerçek `atomicImportStock`** (yalnız `AtomicWriter.run` yakalanır): yeni raf + mevcut raf sayacı ürünlerle aynı işte, raf girdileri önce ve `cas`'lı; dolu raf → Havuz; **bayat önizleme** (yerelde boş, sunucuda dolu) → kesin karar sunucudan: Havuz, bildirim gerçeği söylüyor. 0 sayfa hatası, 0 CSP ihlali.

### Regresyon
| Komut | Sonuç |
|---|---|
| `npm run test:unit` | **210/210** |
| `npm run lint:xss` | Temiz (907 dinamik ifade, 0 izinsiz) |
| `npm run test:atomic:emu` | **10/10** (5 mevcut + 5 yeni) |
| `npm run test:ledger:emu` | **26/26** (raf kuralı değişikliği transfer/ürün/sync yollarını bozmadı) |
| `npm run test:rules` | **218/218** |
| `node scratch/flow-tests.js --emu` (tam paket) | Yalnız önceden bilinen, ilgisiz 3 hata: `j3SessionVisa`, `j4SelfApproval`, `j6PostLogoutRelogin` (`auth-engine.js`'teki bu çalışmaya ait olmayan değişiklikler). Koşucu önceki oturumdaki gibi 50. senaryoda (`j6PostLogoutRelogin` sonrası sayfa ayrılması) durur — temel çizgiyle aynı. |

## 5. Kalan sınırlar (dürüst not)

- **Günlüklü (>~440 satır) işte kilit yayılma penceresi:** kilit sunucuda alınır ama diğer sekmelerin `_bulkLockBlocks` denetimi `admin_settings` snapshot'ı ulaşınca devreye girer (milisaniyeler–saniyeler). `cas` doğrulaması kilitten **sonra** yapıldığı için bu pencerede raf değişirse iş başlamadan `conflict` verir; doğrulamadan sonraki çok kısa aralıkta kilidi henüz görmemiş bir sekmenin transferi teorik olarak araya girebilir. Mevcut `restoreCollections` ile aynı garanti düzeyi; Spark planında (Cloud Functions yok) sunucu tarafı kilit zorlaması kurallarla b1/b2 transfer transaction'ına eklenmeden kapatılamaz. Ölçek/olasılık düşük; Aşama 6 "Raf Sayaçlarını Eşitle" aracı uzlaştırma ağıdır.
- **Kök dizinde `saha-hotfix-diff.txt`** (UTF-16 `git diff` dökümü, 08:47) bu çalışmaya ait değil, dokunulmadı. `firebase.json` "ignore"da olmadığı için `node scratch/hosting-files.js` onu "beklenmeyen dosya" olarak işaretliyor — **deploy öncesi silinmeli ya da taşınmalı**, yoksa herkese açık yayınlanır.

## 6. Değişen dosyalar
`src/utils/stock-import.js` (saf plan) · `src/services/atomic-writer.js` (`SERVER_TIME`, `cas`, `commitIfUnchanged`) · `src/services/firebase-handler.js` (`atomicImportStock`, raf şema muhafızı, store bağımlılıkları) · `script.js` (`importExcel` tek atomik yol) · `firestore.rules` (kilit altında raf geri alma muafiyeti) · `pdf-generator.js` (yorum) · `tests/unit/import-shelf-atomic.test.mjs` (yeni) · `tests/integration/atomic-writer.emu.test.mjs` · `scratch/flow-tests.js` (`p5AuditAtomicImport`).
