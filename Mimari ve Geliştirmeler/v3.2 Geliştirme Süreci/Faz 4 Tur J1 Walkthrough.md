# Faz 4 · Tur J1 Walkthrough (Rules v2 Aşama A + istemci hizalaması)

> **Tarih:** 01.10.2026 · **Branch:** `feat/phase-4-security-and-rules` (merge edilmedi, **canlıya deploy edilmedi**)
> **Firebase:** Rules v2 **yalnız emülatörde** yüklü; gerçek projede yayındaki kurallar değişmedi (TEYİT 0.2c ile aynı). Gerçek demo testleri `inventory_demo`'da; `lifeserver_master` ve `inventory_v2`'ye dokunulmadı.
> **Durum (§7.2):** Uygulandı + otomatik testlerle doğrulandı. Kurallar deploy günü yeni istemciyle **aynı komutta** yayınlanacak (plan §8, M16).

## Commit'ler
| Hash | Madde | Özet |
|---|---|---|
| `99946ee` | 4.1 + 4.2 · RULE-01/02 (kısmi), RULE-05, T1, T7, T8 · M1-M5 | `firestore.rules` → Rules v2 Aşama A + istemci hizalaması (maskeleme çiftleri aynı commit'te) + kural matrisi 70 senaryo |
| `65b7b31` | test | Akış testlerinin Rules v2'ye uyarlanması (`asAdmin`), yeni `j1RulesAlignment` senaryosu |
| *(bu commit)* | docs | Bu walkthrough + kanıtlar |

## Rules v2 Aşama A (`firestore.rules`)
Plan §4 taslağı uygulandı; iki ek (testlerden çıktı, aşağıda):
- **Kökler:** tek joker `/{root}/{col}/items/{docId}` + `validRoot` = `lifeserver_master`, `inventory_demo` (T1). Ayrı kök blokları ve kök `/system_config` bloğu kaldırıldı.
- **Bilinen koleksiyonlar:** firebase-handler `COLLECTIONS` + `system_config` + `workflowTemplates`; listede olmayan koleksiyon admin için de kapalı.
- **Admin:** e-posta **ve** `password` sağlayıcısı (anonim token'da e-posta iddiası geçmez); bakımdan etkilenmez; etiket kuralına tabi değil (kaçış istemcide).
- **Personel (anonim):** yalnız `purchaseOrders`, `requests`, `tasks` oluştur/güncelle; `assignments` ve `serviceRecords` çıkarıldı (T7: personel yazıcısı yok, doğrulandı); bakım açıkken yazamaz (`maintenanceOn`, +1 okuma); `textOk` koleksiyona özgü üst seviye alanlarda etiket reddi.
- **Silme:** personel yalnız `tasks`; **KJ-5:** yalnız `inventory_demo`'da `__flowtest__` işaretli `requests/purchaseOrders/assignments/serviceRecords`.
- **auditLogs (KJ-7):** yalnız ekleme; `hasOnly` alan listesi, `result` enum, `ts == request.time`, `uid == auth.uid`, metinlerde etiket reddi; okuma admin; update/delete herkes için kapalı.
- **KJ-2:** `inventory_v2` yalnız admin okur/yazar. **V1** kilidi korundu.

**Plan taslağından farklar:** (a) `isTestDoc` işaret alanlarına `baslik` ve `name` eklendi — akış testleri işareti bu alanlarda da yazıyor (`ebysApprovalGuard` eski `baslik` alanı); eksik olduğunda temizlik reddedildi ve sonraki tüm senaryolar zincirleme düştü. (b) Demo istisnasında `resource != null` — var olmayan doküman silinirken değerlendirme hatası yerine düz ret.

## İstemci hizalaması (maskeleme çiftleri M1-M5)
`git diff --stat 6001f77..65b7b31`: `firestore.rules` 127 · `scratch/flow-tests.js` 116 · `firebase-handler.js` 35 · `html.js` 28 · `purchase-servises.js` 19 · `session-store.js` 14 · `tests/rules/rules.test.mjs` 13 · `edm-workflow.js` 8 · `script.js` 6 · `inventory-logic.js` 4 · `index.html` 4 · `todo-module.js` 3 · `personel.js` 3 · `package.json` 2 · `inventory-management.js` 1 · `tests/rules/firebase.rules-test.json` (yeni)

| # | Değişiklik | Dosya |
|---|---|---|
| ortak | `requireDbAdmin(eylem)` — iki sayfada; admin değilse "🔒 … yönetici oturumu gerektirir" + false. `window.isDbAdmin` üzerinden (tek tanım) | `session-store.js` |
| M1 | `deletePurchaseRequest`: sahibine tanınan silme izni kalktı → yalnız admin; personele "İptal Et ile geri çekebilirsiniz" | `purchase-servises.js` |
| M1 | `deleteRequest`, `deleteSelectedRequests`: fonksiyon içi kapı (bugüne kadar yalnız arayüz kapılıydı) | `script.js` |
| M1 | `toggleWatch` (FAB'da personele görünüyordu), `importExcel` + B1/B2 içe aktarma etiketleri (B2 kapısızdı; B1 dosya seçiciyi yine açıyordu — artık `preventDefault`) | `inventory-logic.js`, `script.js`, `index.html` |
| M5 | `updateServiceStatus`, `removeAssignment` (depoya dönmeyen dal kapısızdı) | `purchase-servises.js`, `inventory-management.js` |
| + | Admin'e ait diğer yazıcılar: `saveUnitData`, `deleteUnit`, `deleteWorkflowTemplate`, `addPersonel`, `editPersonel`, `deletePersonel`; `saveTemplateData`'nın `localStorage.admin_auth` kontrolü → `isDbAdmin` | `edm-workflow.js`, `script.js`, `personel.js` |
| M2 | Veri katmanı: `permission-denied` → bakım açıksa `maintenance` ("🛠️ Sistem bakımda…"), değilse `forbidden` ("🔒 Kayıt reddedildi: yetki yok ya da etiket benzeri '<'"); gerçek sebep **bir kez** gösterilir (çağıranların `writeOk` → genel "kaydedilemedi" mesajı artık sebebi gizlemiyor). Bakımda personel yazması Firestore'a hiç gönderilmez — kural yayınlanmadan da aynı davranış (RULE-05 istemci aynası) | `firebase-handler.js` (`saveData`, `applyItemOps`) |
| M3 | `hasTagLike` / `guardTagLike` (kuraldaki desenin aynısı); kayıttan **önce**, alan adıyla uyarı: talep (Ürün, Gerekçe/Not), satın alma (Ürün/Hizmet, Açıklama — dosya yüklemeden önce), görev (Başlık, Açıklama — yeni + düzenleme) | `html.js`, `inventory-logic.js`, `purchase-servises.js`, `todo-module.js` |
| M4 | Demo test temizliği: KJ-5 kural istisnası (yukarıda) | `firestore.rules` |

`runStockOps` zaten yalnız admin (H3); `forbidden` kodu onunla tutarlı.

## Doğrulama altyapısı ekleri
- `test:rules` artık ayrı bir emülatör yapılandırmasıyla çalışır (`tests/rules/firebase.rules-test.json`, port 8180): uygulama emülatörü (`npm run emu`, 8080) açıkken de koşulabilir.
- Akış testleri: `__ft.asAdmin(fn)` — emülatörde **gerçek admin oturumu** (Rules v2), gerçek demoda yayındaki eski kurallar nedeniyle yalnız istemci kapısı taklidi. Uyarlanan senaryolar: `adminRequestActions` (silme admin olarak), `unitManagement` ve `personnelById` (yazmalar zaten taklit; `isDbAdmin` taklidi eklendi), `xssAdminPanel` (emülatörde yükler admin olarak yazılır + personelin etiketli yazmasının reddi ölçülür).

## Kanıt
**1. Kural matrisi** — `scratch/baseline/2026-10-01T09-25-47_p4-j1-rules/`
| Kurallar | Sonuç |
|---|---|
| Rules v2 (`firestore.rules`) | **70/70 ✔** (J0'daki 65 + 5 yeni: şablon okuma, personel güncelleme reddi, görev güncellemesinde etiket reddi, KJ-5 açıklama alanı, sayısal alanda hata vermeyen işaret kontrolü) |
| Yayındaki kurallar (karşılaştırma) | 42/70 — 28 kırmızı = Rules v2'nin kapattığı açıklar |

**2. Smoke** — emülatör (Rules v2) `…/2026-10-01T06-05-55_p4-j1_emu`, gerçek demo `…/2026-10-01T06-06-18_p4-j1`: iki sayfada pageerror 0, "Veri Çekildi" 13/13, çift yükleme yok; tek console.error bilinen favicon 404 — baseline ile aynı.

**3. Akış suite'i** — **36/36** senaryo, iki ortamda da `FAILED` yok, pageerror 0, ön/son temizlik 0 artık:
- Emülatör (Rules v2) ve gerçek demo (yayındaki kurallar, yeni istemci).
- J0 çıktılarıyla normalize karşılaştırma — tüm farklar beklenen:
  | Senaryo | Fark | Neden |
  |---|---|---|
  | `hotfixB3Guard` | `write-failed` → `forbidden` | M2 kod eşlemesi (izin reddi artık sınıflandırılıyor) |
  | `systemConfigScope` (emü) | kök `system_config` okuma `ALLOWED` → `permission-denied` | Kök blok kaldırıldı (uygulama okumuyor) |
  | `xssAdminPanel` | `anonPayloadRejected: forbidden` (emü) | Rules v2 etiket reddi; yükler admin yazdığında da hiçbir ekranda çalışmadı (`xssExecuted 0`, `injectedImgElements 0`) |
  | `tur3AdminPanel` (emü) | ret metni | Emülatör kural ayrıntısını yazıyor; kod aynı |
  | `hotfixDeviceUsesMemo` | süreler | Ölçüm |

**4. `j1RulesAlignment` (emülatör, Rules v2)**
| Kontrol | Sonuç |
|---|---|
| Personel satın alma / talep silme (UI fonksiyonu) | kayıt yerinde ✔, "🔒 Talep silme yöneticiye aittir…" / "…yönetici oturumu gerektirir" |
| Personel takip (b1) | değişmedi ✔, "🔒 Ürün takibi…" |
| Kapıyı atlayan doğrudan yazma: `assignments`, işaretsiz talep silme | `forbidden` ✔, kayıt yerinde, tek anlaşılır mesaj |
| İşaretli demo kaydı silme | serbest ✔ (KJ-5) |
| Form: `<img onerror>` notu | kayıt yok ✔, "'Gerekçe / Not' alanında…" uyarısı |
| Form: `vida <5mm, a < b` | kaydedildi ✔ |
| Doğrudan etiketli yazma | `forbidden` ✔ |
| Bakım açıkken personel güncellemesi | `maintenance` ✔, "🛠️ Sistem bakımda…"; bakım kapanınca `ok` |
| Admin oturumu: takip, satın alma silme, işaretsiz talep silme | ✔ / ✔ / ✔ |

## Sahibinin elle doğrulaması (localhost, emülatör — önerilen)
`npm run emu` → `npm run emu:seed` → `http://127.0.0.1:<port>/index.html?emu=1`:
1. Kod girip (demo personel kodu) bir talebin notuna `<b>deneme</b>` yaz → kaydetmeden uyarı; `< 5 adet` yaz → kaydedilir.
2. FAB'dan bir ürünü "Takip" et → "🔒 Ürün takibi yönetici oturumu gerektirir".
3. Yönetici Paneli → kod `emu01` → B1'de takip / talep silme çalışır.

## Bilinen / sonraki
- **Gerçek demo ve canlı hâlâ eski kurallarda** (deploy Faz 4 sonu). Yeni istemci eski kurallarla da çalışıyor (gerçek demo suite'i 36/36): kapılar yalnız daha erken ve anlaşılır reddediyor.
- Deploy sonrası gerçek demo üzerindeki akış testlerinde yönetici senaryoları (`asAdmin`) taklitle çalışamaz; o noktadan sonra yönetici senaryoları `--emu` ile koşulur (walkthrough J6'da not).
- Aşama A sınırlamaları (plan §4): personel kodları okunabilir, personel dokümanlarında sahiplik yok, ziyaretçi = personel → Faz 4B.
- J2: XSS'in tamamı (19 sink, 8 inline handler, onay/uyarı API'si, xss-lint).
