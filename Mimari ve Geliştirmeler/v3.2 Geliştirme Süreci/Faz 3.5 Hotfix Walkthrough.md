# Faz 3.5 · Mimari Sertleştirme (Hotfix) Walkthrough

> **Tarih:** 30.09.2026 · **Branch:** `refactor/phase-3-data-layer` (H4'ün üstünde; merge ve deploy yapılmadı)
> **Tetikleyen:** Faz 3 (H1–H4) bağımsız dış denetimi — atomiklik mimarisi 92/100 onay. İki denetçinin mutabık kaldığı 4 hotfix Faz 4'ten önce kapatıldı.
> **Firebase:** testler yalnız `inventory_demo`; canlı `lifeserver_master` ve `inventory_v2`'ye dokunulmadı.

## Commit'ler
| Hash | Madde | Özet |
|---|---|---|
| `b4e9d76` | 1 · B3 çalışma zamanı muhafızı | b3'e giden her yazma Firestore'a gitmeden denetlenir; ihlalde hiçbir şey yazılmaz (`schema-violation`) |
| `bd99de5` | 2 · Toplu silme eşiği | %20 oran kuralı yalnız 10'dan fazla kayıtlı koleksiyonda; ≤10 kayıtta yalnız mutlak sınır (5) |
| `5cf7f29` | 3 · `activeDeviceUses` önbelleği | Veri revizyonuna bağlı kısa ömürlü önbellek; sevk ekranı ipucu yazma durunca çizilir |
| `d1da5cc` | 4 · Giriş odağı izolasyonu | Odak yalnız kullanıcı sayfayla etkileşmeden önce ve sayfa başına bir kez |

## 1 — B3 çalışma zamanı muhafızı
- **Kapsam talimattan geniş tutuldu:** Talimat `applyItemOps`'u gösteriyordu. Ancak çıkış, sepet, talep onayı ve zimmet b3'ü **`runStockOps`** (transaction) üzerinden yazıyor; yalnız `applyItemOps` korunsaydı asıl yol açık kalırdı. Muhafız üç yolda:

| Yol | Kural |
|---|---|
| `applyItemOps` (+ `upsertItem` / `appendItem` / `updateItem`) | `set` → `Schema.validateB3` tam sözleşme; `update` → yalnız kanonik alan adları; `delete` serbest |
| `runStockOps` / `runExitTransaction` | Aynı kural; ihlalde transaction hiç başlamaz, stok da değişmez |
| `saveData('b3', …)` | Yeni doküman → tam sözleşme; var olan dokümanın değişikliği → yalnız yeni eklenen alan adları (eski biçimli kayıtlar kaydedilebilir kalır) |

- Karışık bir batch'te (ör. requests + hatalı b3) batch'in **tamamı** reddedilir.
- Göç aracı (VIP Şema Göçü) `{ b3Legacy: true }` ile çağırır. Bu bayrak yalnız eski kayıt gevşekliğini açar (deposu bilinmeyen kayıt, kimliksiz eski demirbaş); eksik alan ve eski alan adı yine reddedilir.
- `schema.js` yüklenmemişse b3 yazmaları reddedilir (güvenli taraf).

## 2 — Toplu silme eşiği
`isBulkDeleteBlocked(silinen, toplam)` = `silinen > 1` VE (`silinen > 5` VEYA (`toplam > 10` VE `silinen > toplam × %20`))

| Örnek | Önce | Şimdi |
|---|---|---|
| 4 kayıtlık units'ten 2 | KİLİT (%50) | serbest |
| 10 kayıtlık koleksiyondan 5 | KİLİT | serbest |
| 8 kayıtlık koleksiyondan 6 | KİLİT | KİLİT (> 5) |
| 11 kayıttan 3 | KİLİT | KİLİT (%27) |
| 14 kayıttan 2 | serbest | serbest |

Bilinçli sonuç: ≤10 kayıtlı bir koleksiyonun 5'e kadarı tek çağrıda silinebilir (sahibinin/denetçilerin kararı). Tek kayıt silme ve `allowBulkDelete` değişmedi.

## 3 — `activeDeviceUses` önbelleği
- **Anahtar:**
  - `getDataRevision()`: firebase-handler'da her snapshot, her yerel yazma ve her `saveData` dizi değişiminde artar.
  - b3 / assignments / requests / serviceRecords dizilerinin kimliği.
  - En fazla 2 sn yaşam süresi: `window.data`'yı yerinde değiştiren eski kod için emniyet.
- `{ fresh: true }` önbelleği atlar; `invalidateDeviceUses()` ile temizlenir; `usesStats` ile izlenir.
- **Not (ölçümle doğrulandı):** Bugün kimlik kontrolü tuş başına değil kayıt anında yapılıyor. Asıl maliyet, sepette ve zimmette **her kalem için ayrı tarama** yapılmasıydı; önbellek bunu kaldırdı. Tuş başına çalışan tek iş sevk ekranındaki "önceki servis kayıtları" ipucuydu; o artık yazma durunca (200 ms) çiziliyor.
- **Ölçüm** (600 aktif zimmet + 200 açık servis kaydı): 60 çağrı önbelleksiz **206.7 ms** → önbellekli **0.6 ms** (1 tarama, 60 isabet); 60 cihazlık sepet kaydı 1 tarama, 29 ms.

## 4 — Giriş odağı izolasyonu
- İstenen koşul (`!document.activeElement || activeElement === document.body`) H3'ten (`4224872`) beri vardı.
- Kalan iki açık kapatıldı:
  1. Boş alana tıklama ya da bir tuş odağı `<body>`'de bıraktığı için kod odağı yine kutuya çekiyordu. Artık kullanıcı giriş kutusu dışında herhangi bir etkileşim yaptıysa odak verilmez.
  2. Personel listesinin sonraki her snapshot'ı (ör. yeniden senkron) odağı tekrar çekiyordu. Artık sayfa başına bir kez.

## Kanıt
| Senaryo | Doğrulanan |
|---|---|
| `hotfixB3Guard` | Anonim oturumda: eski biçim / eksik alan / kimliksiz demirbaş / upsert / karışık batch / eski ya da bilinmeyen alanla update / `runStockOps` / `runExitTransaction` / `saveData` → `schema-violation` (hiç gönderilmedi). Geçerli kayıtlar muhafızdan geçip kurallarca reddedildi (`write-failed` / `forbidden`). Göç bayrağı yalnız eski kayıt gevşekliğini açıyor. Hiçbir veri yazılmadı |
| `hotfixBulkLock` | 16 durumluk eşik tablosu; gerçek yazma: 5 kayıtlık requests'ten 2 işaretli kayıt tek çağrıda silindi (eski kural reddederdi) |
| `saveDataV2` (uyarlandı) | Oran kuralı >10 kayıtlı koleksiyonda (15 kayıt, 4 silme) kilitliyor, bayrakla geçiyor. Silme adedi artık koleksiyon büyüklüğünden hesaplanıyor (demo koleksiyonu sahibinin saha testiyle büyümüştü) |
| `hotfixDeviceUsesMemo` | Önbellek isabeti; dizi değişimi, gerçek yazma (revizyon) ve 2 sn sonra yeniden hesap; iade edilen cihaz hemen serbest; 60 cihazlık sepet tek tarama |
| `hotfixLoginFocus` | Etkileşim yok → odak; veri gelmeden tuş/tıklama → odak çalınmaz (odak `<body>`'deyken bile); yeniden senkron → ikinci kez odak yok |
| `h4DeviceIds`, `h4ServiceHistory` (uyarlandı) | İade gerçek veri gibi (yeni dizi) geliyor; ipucu 200 ms sonra çiziliyor |

Tam suite: **34/34 senaryo, pageerror 0** (4 yeni, 3 uyarlandı) · smoke: **index + admin: pageerror 0, "Veri Çekildi" 13/13** (admin tek console.error = favicon 404; `scratch/baseline/2026-09-30T12-26-52_p3-5-hotfix`) · `inventory_demo` test artığı: **0** `__flowtest__` kaydı; sahibinin demo kayıtları (b3 10, requests 3) değişmedi

## Merge hazırlığı
- `master`'da bu branch'te olmayan commit yok; branch 34 commit önde (bu belge dahil 35); `git merge-tree` çakışmasız.
- Önerilen komut (Faz 2 kapanışındaki düzenle):
  `git checkout master && git merge --no-ff refactor/phase-3-data-layer -m "feat(phase-3): data layer hardening (saveData v2, item API, atomic stock, b3 contract, assignment service, device identity, service history, 3.5 hotfixes)"`
- Merge ve deploy sahibinin onayıyla yapılacak. Canlıda deploy sonrası: VIP → Şema Göçü (B3) sahibi tarafından (karar 4); yedek dosyası saklanmalı.
- Açık kararlar (H4'ten): B1↔B2 sevk, Hurda/Atık hedefi.
