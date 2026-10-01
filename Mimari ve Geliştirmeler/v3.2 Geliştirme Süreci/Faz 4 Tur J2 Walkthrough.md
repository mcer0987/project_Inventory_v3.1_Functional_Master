# Faz 4 · Tur J2 Walkthrough (XSS'in tamamı — 4.3)

> **Tarih:** 01.10.2026 · **Branch:** `feat/phase-4-security-and-rules` (merge edilmedi, **canlıya deploy edilmedi**)
> **Firebase:** gerçek projede yalnız `inventory_demo` okundu; J2 senaryoları bellek içi veriyle çalışır (Firestore'a yazmaz). Canlı `lifeserver_master` ve `inventory_v2`'ye dokunulmadı.
> **Durum (§7.2):** Uygulandı + otomatik testlerle doğrulandı.
> **Bulgular:** SEC-01, EBYS-03, ADM-01 (kalan render'lar), TODO-04 artığı · KJ-6 (yalnız riskli 8 handler) · maskeleme çiftleri M6, M7.

## Commit'ler
| Hash | Özet |
|---|---|
| `bb69930` | **fix(xss)** — kalan tüm kayıt sink'lerinde `escapeHtml`; 8 riskli handler `data-*` + `bindActions`; tek ve güvenli `showCustomConfirm` + TODO "Ata" onarımı (M6); özel izleme kartlarında depo |
| `91afaf3` | **chore(test)** — AST tabanlı `scratch/xss-lint.js` + öz-test; smoke raporuna lint; `j2XssSurfaces` senaryosu; `acorn`/`acorn-walk` devDependency |
| `7aecb57` | **docs(audits)** — `audits/` kurumsal hafıza klasörü (sahibinin ricası); hosting ve Docker dışı |
| *(bu commit)* | Walkthrough + kanıtlar |

`git diff --stat 5188ea5..7aecb57`: 25 dosya, +955 / −210 — uygulama: `table-engine.js` 100 · `alert.js` 73 · `todo-module.js` 42 · `admin-dashboard.js` 41 · `script.js` 39 (−28 kopya tanım) · `purchase-servises.js` 33 · `edm-workflow.js` 27 · `admin-system-control.js` 26 · `html.js` 23 · `admin-sitemap.js` 14 · `ui-components.js` 13 · `inventory-management.js` 6 · `auth-engine.js` 2 · `system-tips.js` 2; araçlar: `xss-lint.js` +290 · `flow-tests.js` +153 · `smoke-test.js` 9.

## 1 — Kaçışsız sink'ler (planın 19 sink'i ve lint'in bulduğu geri kalanı)
**İlke (M7):** kaçış ham alanın şablona girdiği yerde; birleştirilmiş HTML (rozet, alt şablon çıktısı) tekrar kaçırılmaz.
| Öncelik | Yer | Değişiklik |
|---|---|---|
| Personel-yazılabilir | `purchase-servises.js` `getStatusBadge` | Adım kişisi (`workflow.steps[].user`) rozetin içinde kaçırılır; satın alma ve servis tablosu rozeti olduğu gibi kullanır |
| Personel-yazılabilir | `purchase-servises.js` `viewServiceItem` | `originalData.açıklama`; alan kartı yardımcısı `_fieldHtml` etiketi de kaçırır |
| Personel-yazılabilir | `edm-workflow.js` `renderMyApprovals` | `#${id}` |
| Admin verisi | `table-engine.js` | B1/B2 satırı, arama kartları, mobil kartlar (ürün, marka, raf, sütun, durum, tür, adet), `data-name` (yalnız `"` kaçırılıyordu), tooltip metni (`showRowTooltip` `innerHTML`) |
| Admin verisi | `admin-dashboard.js` | Kritik stok (ad, konum, adet, limit), özel izleme (depo, marka), mahal başlığındaki personel adları, ürün türü seçenekleri |
| Admin verisi | `ui-components.js`, `edm-workflow.js`, `auth-engine.js` | Ürün türü `option`; akış/şablon personel listeleri, şablon yetki listesi; navbar kullanıcı adı |
| Diğer | `script.js` PDF açılır penceresi, VIP hata listesi / God-Eye demo akışı / ısı haritası, site haritası, hata metinleri, sistem ipuçları | Sabit ya da çalışma zamanı metinleri de kaçırılır (gelecekteki veri bağlantısına karşı) |

**Lint ölçümü (aynı kural seti):** J2 öncesi kod (`5188ea5`) **135 izinsiz** → J2 sonu **0 izinsiz**, 14 gerekçeli istisna (sabit sınıf/renk/depo kimliği, içeride kaçıran TODO yardımcıları, onay API'sinin `{html:true}` dalı, düz metin uyarı).

## 2 — 8 riskli inline handler → `data-*` + `bindActions` (KJ-6)
`html.js` → `bindActions(container, { eylem: (el, event) => … })`: kapsayıcıya tek click dinleyicisi; en yakın `[data-action]` çalışır (iç içe eylemde yalnız en içteki — eski `stopPropagation` davranışı); yeniden çizimde çift dinleyici olmaz.
| Eski | Yeni |
|---|---|
| `deleteCriticalGroup('${data.key}')` — anahtar ürün/tür/durum adlarından, kaçışsız | `data-key` |
| `openWatchDetail / requestPurchase / addToOrderList(${JSON.stringify(item)…})` — kaydın tamamı, yalnız `"` kaçırılıyordu (`&quot;` içeren alan JS'e kaçardı) | `data-depo` + `data-id`, kayıt `findItem` ile |
| `selectPersonForWorkflow(i, '${name…}')` — `'` kaçırılıyordu, `"` ve `&#39;` geçiyordu | `data-step` + `data-name` |
| `addPersonnelToTemplate('${name}', …)` — kaçışsız | `data-name` + `data-type` + `data-step` |
| `showMobileTooltip / showRowTooltip(event, '${updateDate}')` (2) | `data-tip` + `this.dataset.tip` (veri JS dizgesine girmez) |
`jsArg` ile kurulmuş 92 handler güvenli; dönüşümleri Faz 6 (CSP `'unsafe-inline'`'ın kaldırılmasıyla birlikte).

## 3 — Onay / uyarı API'si (M6)
- `showCustomConfirm` **tek tanım** (`alert.js`); `script.js`'teki kopya kaldırıldı (hangisinin çalıştığı yükleme sırasına bağlıydı).
- Varsayılan `textContent` (+ satır sonları); `Node` mesajı doğrudan eklenir; `{ html: true }` yalnız sabit metin; `confirmText` / `cancelText` / `danger`. Geri uyum: 3. argüman fonksiyon (callback) veya metin (onay düğmesi) olabilir — `todo-module.js`'teki `('Evet, Göster', 'Daha Sonra')` çağrısı artık gerçekten bu etiketleri gösteriyor; kapanınca varsayılanlar geri gelir.
- **M6 çifti:** TODO "Ata" diyaloğu HTML metniyle çağrılıyordu → güvenli DOM düğümü (seçim kutusu gerçek, onayda atama yapılır). Bugüne kadar bozuktu.
- `showSuccessBanner` → `textContent`. `showAppAlert` zaten metin (değişmedi).

## 4 — XSS regresyon kapısı
`scratch/xss-lint.js` (acorn AST): HTML içeren her şablon dizgesi ve `innerHTML`/`outerHTML`/`insertAdjacentHTML`/`document.write`'a giden her birleştirme. Güvenli sayılan: kaçış çağrıları, sabitler, sayısal ifadeler, kendi şablonu ayrıca denetlenen birleştirilmiş HTML, kapsam duyarlı veri akışında tüm tanımları güvenli yerel değişkenler. İstisna yalnız ifadenin içinde **gerekçeli** `/* xss-ok: … */` ile. Komutlar: `npm run lint:xss`, `npm run lint:xss:self-test`; smoke raporunda `xssLint` alanı.

Geliştirme sırasında lint'te kapatılan iki boşluk: (a) etiketsiz şablonun doğrudan `innerHTML`'e atanması (bu `showSuccessBanner`'ı yakaladı), (b) geri çağrı içindeki tanımların sink kapsamından görünmemesi (yanlış alarm).

## Kanıt
| Kontrol | Sonuç |
|---|---|
| `npm run lint:xss` | 194 sink · 814 ifade · **izinsiz 0** · gerekçeli 14 (`audits/test-baselines/xss-lint-latest.json`) |
| `npm run lint:xss:self-test` | **17/17** |
| `j2XssSurfaces` — index | B1 satırı metin olarak, `data-name` ham değeri birebir taşıyor, tooltip `img` yok; ürün türü seçeneği; navbar metin; akış personel araması eylemi ham adı birebir iletti; onay API'si: metin varsayılan / `{html:true}` / Node / eski düğme etiketi ✔; TODO "Ata": seçim kutusu + doğru atama ✔; **çalışan yük 0, enjekte `img` 0** |
| `j2XssSurfaces` — admin | Kritik stok anahtarı eylemle taşındı; özel izleme kartı depo gösteriyor, iç eylem yalnız kendisi, kayıt id ile çözüldü; servis görüntüleme ve satın alma rozeti metin; şablon personel araması ham adı birebir iletti; **çalışan yük 0, enjekte `img` 0**, pageerror 0 |
| Akış suite'i | **37/37** iki ortamda (emülatör Rules v2 + gerçek demo), `FAILED` yok, pageerror 0, artık 0; J1'deki 35 senaryonun çıktısı iki ortamda da birebir aynı (yalnız süre ölçümleri farklı) |
| Smoke | emülatör `scratch/baseline/2026-10-01T07-12-59_p4-j2_emu`, gerçek `…/2026-10-01T07-17-25_p4-j2`: pageerror 0, "Veri Çekildi" 13/13, çift yükleme yok, tek console.error bilinen favicon 404 |
| Kural matrisi | 70/70 (J1'den değişmedi) |

## Bulunan, J2 kapsamı dışı hata (bildirim)
**Özel İzleme paneli yeniden çizilmiyor** (ADM-05, plan Faz 5.6): `renderCustomWatchDashboard` ilk çizimde `#customWatchTable`'ı kendi kapsayıcısından siliyor; sonraki her çağrı (takip değişikliği, canlı güncelleme) hemen dönüyor — panel sayfa açılışındaki durumda kalıyor. J2'de değiştirilmedi; `j2XssSurfaces` testte eksik öğeyi geri koyarak kaçış/delegation değişikliğini sınıyor ve hatanın varlığını `watchRerenderBug: true` olarak raporluyor. Faz 5.6'da onarılmalı.

## Sahibinin elle doğrulaması (localhost, önerilen)
1. Admin → Tanımlar → Ürün Türleri'ne `<b>Test</b>` adında tür ekleyin → B1 ürün ekle modalında seçenek `<b>Test</b>` olarak (kalın değil) görünür.
2. Bir görevde "Ata" → kişi seçme kutusu görünür, seçip "Ata" → görev atanır.
3. Personel olarak satın alma talebi aç, onaylayıcı adımında kişi adı rozetinde normal görünür.

## Denetim klasörü (sahibinin ricası)
`audits/README.md` — güvenli test kuralları (9 madde), komutlar, güncel baseline, dış denetim raporu adlandırma/yanıt düzeni, bilinen sınırlamalar · `audits/test-baselines/` — Faz 4 baseline özeti + güncel lint çıktısı · `audits/audit-reports/_SABLON.md` — dış denetim rapor şablonu (bulgular + yanıt tablosu). Hosting ve Docker imajı dışında.

## Bilinen / sonraki
- Lint sezgiseldir (adı `…Html`, `rows`, `content` gibi değişkenler ve `icon`/`badge` alanları birleştirilmiş HTML sayılır) — `audits/README.md` §6.
- J3: oturum ve vize (tek `endAdminSession`, `browserSessionPersistence`, sanal "Admin"in kaldırılması, depolama bayrağı kontrolleri, 5 hane sınırı).
