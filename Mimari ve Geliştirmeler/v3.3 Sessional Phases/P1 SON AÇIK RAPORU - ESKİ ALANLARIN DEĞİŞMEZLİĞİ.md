# P1 SON AÇIK RAPORU — Eski Alanların Değişmezliği (saveData)

**Branch:** `feat/phase-7-logging-and-ux` (yerel; commit / push / deploy yok)
**Kapsam:** Astra'nın son denetiminde bulunan sözleşme açığı — `saveData`'nın eski biçimli b1/b2 kayıt yolu.

---

## 1. Açık

`src/services/firebase-handler.js` `saveData` içinde, sözleşmeye henüz uymayan (eski biçimli) bir b1/b2 kaydı tam yeniden yazılırken `checked` kümesi şöyle kuruluyordu:

- kayıtta OLMAYAN alan → denetlenir,
- kayıtta OLAN ve sözleşmede yeri olan alan → değeri değiştiyse denetlenir,
- kayıtta OLAN ama sözleşme dışı (eski/bilinmeyen) alan → **değeri ne olursa olsun denetimden çıkarılır.**

Sonuç: "eski alan korunabilir" kuralı, "eski alan doğrulanmadan **değiştirilebilir**" kuralına dönüşmüştü. Eski B1 kaydında `qty: 5` → `qty: -10` yapıldığında `checked = {}` kalıyor, şema muhafızı boş bir yama görüyor ve eksi bakiye Firestore'a yazılıyordu.

## 2. Düzeltme

**Karar tek bir saf fonksiyonda:** `Schema.legacyStockPatch(col, prev, next)` (`src/utils/schema.js`) → `{ checked, frozen }`.

| Durum | Sonuç |
|---|---|
| Kayıtta olmayan yeni alan | `checked` → `validateB1/B2({partial:true})` |
| Sözleşme alanı, değeri değişmiş | `checked` → `validateB1/B2({partial:true})` |
| Sözleşme alanı, değeri aynı | yazılır, denetime gerek yok |
| Sözleşme dışı eski alan, değeri **aynı** | korunur (salt-okunur) |
| Sözleşme dışı eski alan, değeri **değişmiş** | `frozen` → **tüm çağrı reddedilir** |

**`saveData`:** `frozen` boş değilse, döngü içinde **anında** `schema-violation` döner. Bu noktada henüz hiçbir `writeBatch` kurulmamıştır; bakım/kilit denetimleri ve yazma bloğu bunun **sonrasındadır**. Alan silinmez, eski değere döndürülmez, dönüştürülmez. Hata ayrıntısı hangi alanın neden reddedildiğini taşır (`details.frozen: [{key, before, after}]`).

**Değişmeyenler:**
- Sözleşmeye uyan kayıtlar: önceki gibi `{ ...prev, ...yeni }` tam sözleşmeden geçer.
- Yeni kayıtlar: önceki gibi tam `set` sözleşmesi.
- b3 eski kayıt yolu: davranış birebir aynı (yalnız yeni alan adları denetlenir) — bu açığın kapsamı b1/b2 idi.

## 3. Diff (yalnız bu değişiklik)

Çalışma ağacında aynı dosyalarda önceki aşamalardan commit edilmemiş değişiklikler de bulunduğu için `git diff` bu değişikliği ayrı göstermez. Aşağıdaki diff yalnız bu açığın düzeltmesidir (satır sonları LF'ye normalize edildi; `firebase-handler.js` diskte CRLF'dir ve öyle kaldı).

```diff
--- a/src/utils/schema.js
+++ b/src/utils/schema.js
@@ -306,6 +306,39 @@
         return spec.required.concat(spec.optional);
     }
 
+    // Değer eşitliği: undefined → "" (saveData'nın _clean'i ile aynı), nesne anahtar sırası önemsiz.
+    function _sameValue(a, b) {
+        const norm = v => JSON.stringify(v === undefined ? '' : v, (k, x) => {
+            if (x === undefined) return '';
+            if (x && typeof x === 'object' && !Array.isArray(x)) return Object.keys(x).sort().reduce((o, key) => { o[key] = x[key]; return o; }, {});
+            return x;
+        });
+        return norm(a) === norm(b);
+    }
+
+    /**
+     * Sözleşmeye henüz uymayan (eski biçimli) bir b1/b2 kaydının tam yeniden yazımı (saveData) için muhafız planı.
+     * [WHY]: v3.3 P1 (Astra) — eski yol, kayıtta zaten bulunan sözleşme dışı alanları denetimden tümüyle çıkarıyordu; "eski
+     *        alan korunabilir" kuralı farkında olmadan "eski alan doğrulanmadan DEĞİŞTİRİLEBİLİR" oluyordu (qty: 5 → -10
+     *        hiçbir denetime girmeden Firestore'a yazılıyordu).
+     * [HOW]: Sözleşme dışı (eski/bilinmeyen) bir alan YALNIZ değeri aynen kalıyorsa korunur; değeri değişmişse 'frozen'
+     *        listesine girer ve çağıran işlemi REDDETMELİDİR (silme, eski değere döndürme ya da dönüştürme yapılmaz).
+     *        Yeni eklenen alanlar ve değeri değişen sözleşme alanları 'checked'e girer ve validateB1/B2({partial:true})
+     *        ile denetlenir. Saf fonksiyon: yazma yapmaz.
+     * @returns {{checked:object, frozen:{key:string, before:*, after:*}[]}}
+     */
+    function legacyStockPatch(col, prev, next) {
+        const known = stockKnownKeys(col);
+        const checked = {}, frozen = [];
+        Object.entries(next || {}).forEach(([k, v]) => {
+            const existed = prev && Object.prototype.hasOwnProperty.call(prev, k);
+            if (!existed) { checked[k] = v; return; }
+            if (_sameValue(prev[k], v)) return;
+            if (known.includes(k)) checked[k] = v;
+            else frozen.push({ key: k, before: prev[k], after: v });
+        });
+        return { checked, frozen };
+    }
 
     // [WHY]: Faz 5 denetimi (P1) — b1/b2 tam 'set' sözleşmesi saveData'da esnetilmişti, çünkü CSV/Excel içe aktarma
     //        "rafNo" (b1/b2'de alanın adı 'raf'), "limit" gibi alanlarla ve isDemirbas'sız kayıt üretiyordu; eski yedeklerde de
@@ -609,7 +642,7 @@
         makeId, normName, idToTs, isDemirbas, normalizeStock, findStock, isSelfApproval,
         B3_SCHEMA_VERSION, B3_KEYS, B3_LEGACY_KEYS, B3_TIP, STOK_DISI,
         buildB3Entry, normalizeB3, toCanonicalB3, validateB3,
-        B1_KEYS, B1_LEGACY_KEYS, B2_KEYS, B2_LEGACY_KEYS, B1_OPTIONAL_KEYS, B2_OPTIONAL_KEYS, stockKnownKeys,
+        B1_KEYS, B1_LEGACY_KEYS, B2_KEYS, B2_LEGACY_KEYS, B1_OPTIONAL_KEYS, B2_OPTIONAL_KEYS, stockKnownKeys, legacyStockPatch,
         validateB1, validateB2, toCanonicalStock,
         SHELF_COLLECTION, SHELF_DEPOTS, SHELF_DEFAULT_CAPACITY, SHELF_MIN_CAPACITY, SHELF_MAX_CAPACITY, SHELF_CODE_MAX_LENGTH,
         SHELF_KEYS, normShelfCode, isValidShelfCode, itemShelfCode, isSlotOccupying, computeUsedSlots, slotUsageByShelf,
--- a/src/services/firebase-handler.js
+++ b/src/services/firebase-handler.js
@@ -750,20 +750,31 @@
         // kanonik olmayana dönüştürülemez: saveData merge yazdığı için kaydın yazma SONRASI hâli tam sözleşmeyle denetlenir.
         if (colName === 'b3' || colName === 'b1' || colName === 'b2') {
             const stock = colName !== 'b3';
-            const guard = _schemaGuardError(writes.map(w => {
+            // v3.3 P1 (Astra): eski biçimli b1/b2 kaydında sözleşme dışı alanlar SALT-OKUNURDUR — yalnız değeri aynen
+            // kalıyorsa korunur. Değeri değişen bir eski alan (ör. qty: 5 → -10) tüm çağrıyı reddeder; hiçbir batch
+            // kurulmaz. Alan silinmez, eski değere döndürülmez, dönüştürülmez (bkz. Schema.legacyStockPatch).
+            const prepared = [];
+            for (const w of writes) {
                 const prev = mirrorById.get(w.key);
-                if (!prev) return { op: 'set', col: colName, id: w.key, data: w.data };
+                if (!prev) { prepared.push({ op: 'set', col: colName, id: w.key, data: w.data }); continue; }
                 if (stock && !_stockViolation({ op: 'set', col: colName, data: prev })) {
-                    return { op: 'set', col: colName, id: w.key, data: { ...prev, ...w.data } };
+                    prepared.push({ op: 'set', col: colName, id: w.key, data: { ...prev, ...w.data } });
+                    continue;
                 }
-                // Sözleşmeye henüz uymayan (eski biçimli) kayıt: kayıtta ZATEN olan eski/bilinmeyen alan adına göz yumulur
-                // (göç edilmemiş veri düzenlenebilsin), ama yeni eklenen her alan VE değişen her sözleşme alanı (b1/b2: tip
-                // dahil) denetlenir — değişen alanın yanlış tipi bu yoldan da geçemez.
-                const known = stock ? window.Schema.stockKnownKeys(colName) : [];
-                const checked = Object.fromEntries(Object.entries(w.data).filter(([k, v]) => !(k in prev)
-                    || (known.includes(k) && _stableStringify(_clean({ v: prev[k] })) !== _stableStringify({ v }))));
-                return { op: 'update', col: colName, id: w.key, data: checked };
-            }), opts);
+                if (!stock) {
+                    // b3 eski kayıt yolu değişmedi: yalnız yeni eklenen alan adları denetlenir.
+                    prepared.push({ op: 'update', col: colName, id: w.key, data: Object.fromEntries(Object.entries(w.data).filter(([k]) => !(k in prev))) });
+                    continue;
+                }
+                const { checked, frozen } = window.Schema.legacyStockPatch(colName, prev, w.data);
+                if (frozen.length) {
+                    return fail('schema-violation',
+                        `${colName} kaydı şema sözleşmesine uymuyor (update ${w.key}): sözleşme dışı eski alan değiştirilemez: ${frozen.map(f => f.key).join(', ')}`,
+                        { collection: colName, id: w.key, op: 'update', errors: frozen.map(f => `eski alan değiştirilemez: ${f.key}`), frozen });
+                }
+                prepared.push({ op: 'update', col: colName, id: w.key, data: checked });
+            }
+            const guard = _schemaGuardError(prepared, opts);
             if (guard) return fail(guard.code, guard.message, guard.details);
         }
         // Faz 4B · J9: sahiplik alanları (personelUid/createdByUid/creatorUid) değiştirilemez; tam yazmada eski değer taşınır.
```

Yeni test dosyası: `tests/unit/savedata-legacy-guard.test.mjs` (13 test).

## 4. Test sonuçları

### Yeni testler — `tests/unit/savedata-legacy-guard.test.mjs`

İki katman:
1. **Saf karar fonksiyonu** `Schema.legacyStockPatch`.
2. **GERÇEK `saveData`**: `src/services/firebase-handler.js` olduğu gibi Node'da yüklenir; yalnız Firebase CDN modülleri, her `writeBatch` ve `commit` çağrısını sayan bir taklitle değiştirilir. "Commit çalışmadı" iddiası bu sayaçlarla doğrulanır (`batches === 0`, `commits === 0`).

```
✔ legacyStockPatch: değişmeyen eski alan korunur (frozen yok), değişen kanonik alan checked'e girer
✔ legacyStockPatch: eski alanın değeri değişirse frozen'e girer (qty: 5 → -10); checked'e sızmaz
✔ legacyStockPatch: eski alan "silinmiş gibi" boşaltılırsa (undefined/"") da değişikliktir → frozen
✔ legacyStockPatch: kayıtta OLMAYAN yeni alan (B1'e envanterNo) checked'e girer — validateB1 reddeder
✔ legacyStockPatch: eski B1 kaydında ZATEN olan envanterNo'nun değeri değişirse frozen (B1 için sözleşme dışı)
✔ legacyStockPatch: nesne değerlerinde anahtar sırası değişikliği "değişiklik" sayılmaz
✔ saveData: eski qty: 5 KORUNURKEN ürün adı değişikliği KABUL edilir (yazma yapılır, qty aynen kalır)
✔ saveData: qty: 5 → -10 anında REDDEDİLİR — hiçbir batch kurulmaz, hiçbir commit çalışmaz
✔ saveData: qty değişikliği MEŞRU bir değişiklikle (ürün adı) birlikte gelse de TÜM çağrı reddedilir
✔ saveData: eski B1 kaydına YENİ envanterNo REDDEDİLİR — commit yok
✔ saveData: eski B1 kaydında zaten bulunan envanterNo DEĞİŞTİRİLİRSE REDDEDİLİR — commit yok
✔ saveData: değişen KANONİK alanın yanlış tipi (adet: -3) eski kayıtta da reddedilir — commit yok
✔ saveData: çok kayıtlı çağrıda TEK bir dondurulmuş alan ihlali tüm çağrıyı durdurur (kısmi yazma yok)
ℹ tests 13
ℹ suites 0
ℹ pass 13
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 269.2112
```

| İstenen kanıt | Test |
|---|---|
| Eski `qty: 5` korunurken ürün adı değişikliği KABUL | ✔ yazma yapıldı, `qty` 5 olarak kaldı |
| `qty: 5 → -10` anında RET | ✔ `schema-violation`, `frozen: [qty, 5, -10]` |
| Eski B1 kaydına `envanterNo` değişikliği RET | ✔ yeni eklenirse (`envanterNo yalnız B2`) ve kayıtta zaten varsa (`eski alan değiştirilemez`) |
| Red durumunda hiçbir Firestore commit'i çalışmaz | ✔ her red testinde `writeBatch` 0, `commit` 0 |

### Karşı-olgu (açığın gerçekten yakalandığının kanıtı)
Aynı test dosyası, düzeltmeden **önceki** guard bloğuyla geçici olarak çalıştırıldı (sonra düzeltme geri konuldu):

```
✔ saveData: eski qty: 5 KORUNURKEN ürün adı değişikliği KABUL edilir
✖ saveData: qty: 5 → -10 anında REDDEDİLİR — hiçbir batch kurulmaz, hiçbir commit çalışmaz
✖ saveData: qty değişikliği MEŞRU bir değişiklikle (ürün adı) birlikte gelse de TÜM çağrı reddedilir
✔ saveData: eski B1 kaydına YENİ envanterNo REDDEDİLİR — commit yok
✖ saveData: eski B1 kaydında zaten bulunan envanterNo DEĞİŞTİRİLİRSE REDDEDİLİR — commit yok
✔ saveData: değişen KANONİK alanın yanlış tipi (adet: -3) eski kayıtta da reddedilir — commit yok
✖ saveData: çok kayıtlı çağrıda TEK bir dondurulmuş alan ihlali tüm çağrıyı durdurur (kısmi yazma yok)
ℹ pass 9
ℹ fail 4
```

Eski kodla `qty: -10` gerçekten commit ediliyordu; düzeltmeyle 13/13.

### Regresyon

| Komut | Sonuç |
|---|---|
| `npm run test:unit` | **243/243** (13 yeni) |
| `npm run lint:xss` | Temiz (0 izinsiz) |
| `npm run test:ledger:emu` | **26/26** |
| `npm run test:atomic:emu` | **10/10** |
| `npm run test:rules` | **218/218** |
| `node scratch/flow-tests.js --emu` (tam paket) | `b1WriteContract`, `b2WriteContract`, `p5AuditAtomicImport` dahil temiz. Yalnız önceden bilinen, ilgisiz 3 hata: `j3SessionVisa`, `j4SelfApproval`, `j6PostLogoutRelogin` (`auth-engine.js`'teki bu çalışmaya ait olmayan değişiklikler). Temel çizgiyle aynı. |

## 5. Bilinen sonuç — karar gerektiren tek nokta

Uygulama kodunda b1/b2'ye `saveData` ile yazan **tek** çağıran, ürün türü yeniden adlandırmasıdır: `syncProductTypesToProducts` (`src/modules/admin/admin-dashboard.js:1483`). Bu fonksiyon kanonik `tür` alanının yanında eski `type` ve sözleşme dışı `prodType` alanlarını da yeni ada çevirir.

- Yeni kuralla, eski adı `type` ya da `prodType` alanında taşıyan **eski biçimli** bir kayıt varsa, o deponun tür yeniden adlandırması `schema-violation` ile **tümüyle reddedilir** (hiçbir şey yazılmaz). Bu, istenen davranıştır (eski alan sessizce değiştirilmez), ama kullanıcıya "tür güncellenemedi" olarak görünür.
- Demo verisinde (`scratch/emu-data/inventory_demo.json`) bu alanları taşıyan kayıt yok; etkilenmiyor. Canlı veri (`lifeserver_master`) taranmadı.
- Talimat gereği (yalnız guard, otomatik dönüştürme yok) çağırana dokunulmadı. Öneri: `syncProductTypesToProducts` yalnız kanonik `tür` alanını güncellesin; eski `type`/`prodType` taşıyan kayıtlar ayrıca bir göçle kanonikleştirilsin.

## 6. Değişen dosyalar
- `src/utils/schema.js` — `legacyStockPatch` (+ `_sameValue`), dışa aktarma
- `src/services/firebase-handler.js` — `saveData` eski b1/b2 kayıt yolu
- `tests/unit/savedata-legacy-guard.test.mjs` — yeni
