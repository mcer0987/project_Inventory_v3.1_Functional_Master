# İP-4 VIP Konsol ve Heatmap Yaşam Döngüsü — Implementation Walkthrough

> **Tarih:** 13.11.2026
> **Dal:** `feat/v3.6-raf-sayim-envanter-no-mobil-form`
> **Durum:** Uygulandı; XSS lint kapısı (İZİNSİZ 0) ve birim testleri (gerçek Chrome DOM testi dahil) geçti. **Canlıya yayın yapılmadı.**
> **Kapsam:** Yalnız `admin.html` ekranındaki VIP Sistem Kontrol Merkezi (Faz 5 · K3'te optimize edilen Konsol / Heatmap bileşeni):
> - VIP sekmesi kapalıyken ya da tarayıcı sekmesi arka plandayken çalışan timer / `requestAnimationFrame` / CSS animasyonu kalmaması;
> - Konsol ve Heatmap akışında `innerHTML` birleştirmelerinin DOM API ile değiştirilmesi, bellek tavanları;
> - `admin.html` ve `index.html`'e dokunulmadı; dış kütüphane eklenmedi; Firebase SDK çağrısı yapılmadı.
> **Plan:** [00 Uygulama Planı ve Mimari Uyum İncelemesi](./00%20Uygulama%20Planı%20ve%20Mimari%20Uyum%20İncelemesi.md) · İP-4 bölümü.

## İçindekiler

1. [Talepler ve karşılıkları](#1-talepler-ve-karşılıkları)
2. [Kullanıcının gördüğü davranış](#2-kullanıcının-gördüğü-davranış)
3. [Kök neden analizi](#3-kök-neden-analizi)
4. [Teknik akış](#4-teknik-akış)
5. [Değişen dosyalar](#5-değişen-dosyalar)
6. [Test ve doğrulama](#6-test-ve-doğrulama)
7. [Yayın adımları](#7-yayın-adımları)
8. [Sınırlar ve bilinen konular](#8-sınırlar-ve-bilinen-konular)
9. [Yerel test walkthrough](#9-yerel-test-walkthrough)

---

## 1. Talepler ve karşılıkları

| # | Talep | Sonuç |
|---|---|---|
| 1 | VIP paneli kapalıyken arka planda `requestAnimationFrame`, `setInterval` ya da CPU tüketen timer kalmasın; varsa temizleme mekanizması | Sağlık döngüsü (VIP-08) zaten kapanıyordu; teyit edildi. Sayaç animasyonlarına rAF tutamacı ve `cancelAnimationFrame` eklendi (VIP-12). Sekme gizliyken `resize` dinleyicisi erken döner (VIP-11). Sekmenin dışında kalan aktivite panelinin sonsuz CSS animasyonu panel kapalıyken duraklatıldı (VIP-15). |
| 2 | Konsol/Heatmap akışındaki `innerHTML` birleştirmeleri `DocumentFragment` / `textContent` / `join('')` ile optimize edilsin; dinamik HTML basılan her yerde `escapeHtml` | Konsol satırı `createElement` + `textContent` ile kurulur; `innerHTML` sink'i kalktı. Heatmap `createElementNS` + `DocumentFragment` + `replaceChildren` ile çizilir; `<title>` ve etiketler `textContent`. Terminal temizleme `replaceChildren()`. Kalan `innerHTML` yazımları yalnız sabit metin ya da `escapeHtml`'li mevcut şablonlardır. |
| 3 | Vanilla JS dışında kütüphane yok; doğrudan Firebase SDK çağrısı yok | Yeni bağımlılık yok. Dokunulan bloklarda Firebase çağrısı yok. |
| 4 | Full rewrite yasak; UTF-8 korunur | Yalnız hedef bloklar değişti. Satır sonları LF olarak korundu (`git diff --stat`: JS 156 satır, CSS 5 satır). |
| 5 | `npm run lint:xss` → İZİNSİZ 0, sink sayısında düşüş | 212 → **209 sink**, İZİNSİZ **0** (bkz. §6). |

## 2. Kullanıcının gördüğü davranış

- VIP sekmesi ve terminal görünümü aynıdır: ikon, saat damgası, mesaj ve filtre/sayaç rozetleri değişmedi.
- Çok uzun bir log mesajı (örneğin büyük bir nesne dökümü) 2000 karakterden sonra `… [N karakter kısaltıldı]` ile biter. Tarayıcı konsolundaki asıl çıktı kısaltılmaz.
- VIP sekmesi kapalıyken gelen loglar birikir; sekmeye dönüldüğünde terminal bir kez en alta kayar.
- Operasyon raporu sayaçları, sekme görünmüyorsa animasyonsuz son değeri gösterir; görünürken eskisi gibi akar. Sekme hızlıca kapatılıp açıldığında sayaçlar titremez.
- Sağlık kartındaki "Veri Boyutu" ve "DOM düğümü" ölçümleri 5 saniyede bir tazelenir; çalışma süresi ve oturum sayacı saniyede bir.
- Heatmap görünümü ve dilim renkleri aynıdır.

## 3. Kök neden analizi

| Kod | Bulgu | Etki |
|---|---|---|
| VIP-11 | `_appendLog` her `console.*` çağrısında (VIP hiç açılmamışken bile) `innerHTML` şablonu ayrıştırıyor, 150 tavanı için `querySelectorAll` tarıyor ve `scrollHeight` okuyordu; mesaj uzunluğu sınırsızdı; `_runtimeErrors` sınırsız büyüyordu; `resize` dinleyicisi sekme gizliyken localStorage tarıyordu. | Arka planda gereksiz DOM/layout işi; uzun oturumda bellek artışı. |
| VIP-12 | `_animateCountUp` her sekme girişinde 6 rAF döngüsü açıyor, tutamaç saklamıyordu. | Hızlı tekrar girişte aynı öğeye iki döngü; sekme kapanınca döngü bitene dek sürüyordu. |
| VIP-13 | Sağlık tiki her saniye `JSON.stringify(window.data)` + `Blob` + `querySelectorAll('*')` çalıştırıyordu. | Sekme görünürken sürekli CPU. |
| VIP-14 | Heatmap SVG string birleştirme + `innerHTML` ile basılıyordu. | `escapeHtml`'e bağımlı sink; DOM API ile sink'e gerek yok. |
| VIP-15 | `#userActivityPanel` `#systemControlTab` dışında, ekran dışına park edilmiş ve `display:flex`; `.uap-live-dot` sonsuz animasyonu admin sayfası açıldığı andan itibaren tikliyordu. | VIP hiç açılmamışken bile her karede animasyon zamanlayıcısı. |

Teyit edilen temiz noktalar: sağlık/oturum `setInterval`'i sekme çıkışında ve `visibilitychange`'de kapanıyor (VIP-08); `#systemControlTab` içindeki matrix/radar/kart animasyonları `display:none` ile duruyor; sidebar efektleri `vip-active` sınıfı kalkınca bitiyor; radar nokta dinleyicileri remove+add korumalı.

## 4. Teknik akış

**Konsol akışı (`_appendLog`)**
1. Mesaj `_MAX_LOG_MSG_CHARS` (2000) ile kesilir.
2. `div.log-entry` → `i.fas.log-icon` + `span.timestamp` + `span.log-msg` düğümleri `createElement` / `textContent` ile kurulur (sınıf adları aynı).
3. Tavan `terminal.childElementCount > _MAX_LOG_ENTRIES` iken `firstElementChild.remove()`.
4. Kaydırma yalnız `_isVipTabVisible()` iken; aksi halde `_terminalScrollPending` işaretlenir, `_initVipPanel` dönüşünde ve `visibilitychange`'de `_flushTerminalScroll()` bir kez kaydırır.
5. `window.error` / `unhandledrejection` kayıtları `_pushRuntimeError` ile son 50 ile sınırlanır.

**Sayaç animasyonları (`_animateCountUp`)**
- `_countUpFrames: Map<elementId, rafHandle>`; aynı öğede yeni animasyon öncekini `cancelAnimationFrame` ile keser.
- Sekme görünmüyorsa animasyonsuz son değer yazılır.
- `_stopHealthLoop()` artık önce `_cancelCountUps()` çağırır; bu fonksiyon sekme çıkışında (`AdminTabs.onAny`) ve `document.hidden` olduğunda çalışır.

**Sağlık tiki**
- `_updateSystemHealth(full)`: `full=false` iken veri boyutu ve DOM düğüm ölçümleri atlanır. Interval içinde `full = ticks % _HEAVY_HEALTH_EVERY(5) === 0`; açık tazelemelerde (sekme girişi, görünürlüğe dönüş) `full=true`.
- `resize` → `_onViewportResize`: sekme gizliyken erken döner; `_initVipPanel` yeniden girişte `_updatePlatformInfo()` ile bir kez tazeler.

**Heatmap (`_renderHeatmap`)**
- `createElementNS('http://www.w3.org/2000/svg', …)` ile `path` (+ `title`), `text.hm-label`, `text.hm-center-text` düğümleri bir `DocumentFragment`'a eklenir; `svg.replaceChildren(frag)`. Yay matematiği (`_arcPath`), renk sınıfları ve eşikler değişmedi.

**CSS**
- `#userActivityPanel:not(.panel-open) .uap-live-dot { animation-play-state: paused; }`

**Teşhis:** `AppModules.VipHealth` → `isRunning()`, `ticks()`, `countUpsActive()`, `terminalEntries()`, `runtimeErrors()`.

## 5. Değişen dosyalar

| Dosya | Değişiklik |
|---|---|
| `src/modules/admin/admin-system-control.js` | Tavan sabitleri ve `_pushRuntimeError`; `_appendLog` DOM API + kesme + kaydırma erteleme; `_flushTerminalScroll`; `vipClearTerminal` → `replaceChildren()`; `_countUpFrames` / `_cancelCountUps` / `_animateCountUp`; `_updateSystemHealth(full)` + `_HEAVY_HEALTH_EVERY`; `_stopHealthLoop` sayaç iptali; `_onViewportResize`; `VipHealth` teşhis alanları; `_initVipPanel` dönüşünde platform tazeleme + kaydırma; `_renderHeatmap` DocumentFragment. Yerel `_escapeHtml` yardımcısı (artık kullanılmıyor) kaldırıldı. |
| `admin-system-control.css` | VIP-15 kuralı (5 satır). |
| `tests/unit/vip-console-lifecycle.test.mjs` | Yeni: gerçek Chrome (puppeteer) DOM testi, 4 senaryo. |
| Bu klasör | Bu walkthrough, `İP-4 - Test Kanıtları.txt`, plan ve kontrol listesine İP-4 bölümleri. |

## 6. Test ve doğrulama

Ham çıktılar `İP-4 - Test Kanıtları.txt` dosyasındadır.

- `npm run lint:xss`: önce `212 sink · 1026 dinamik ifade · İZİNSİZ 0`; sonra `209 sink · 1022 dinamik ifade · İZİNSİZ 0`.
- `node --test tests/unit/vip-console-lifecycle.test.mjs`: 4/4 geçti.
  1. VIP-08/12: yüklemede döngü kapalı; sekme açılınca interval + rAF aktif; çıkışta ikisi de sıfır; hızlı tekrar girişte öğe başına en fazla bir rAF.
  2. VIP-11: 200 log → 150 kayıt; 5000 karakter → kesilmiş; `<img onerror>` mesajı düğüm üretmez, metin olarak aynen görünür; ikon/saat/mesaj yapısı korunur; 80 hata → 50 kayıt.
  3. VIP-14: `innerHTML` setter'ı gözlenerek SVG'ye hiç `innerHTML` yazılmadığı; 5 `path` + `title`, etiketler, merkez metni `['5','kayit']`, SVG ad alanı.
  4. VIP-15: panel kapalıyken `animation-play-state: paused`, `.panel-open` ile `running`.
- `npm run test:unit`: tüm paket geçti (bkz. kanıt dosyası).

## 7. Yayın adımları

1. Statik dosyalar: `src/modules/admin/admin-system-control.js`, `admin-system-control.css` (ek derleme yok).
2. Firestore kuralı, indeks ya da şema değişikliği yok.
3. Yayın sonrası: VIP sekmesini açıp kapatın; `AppModules.VipHealth.isRunning()` kapalıyken `false`, `countUpsActive()` `0` olmalı.

## 8. Sınırlar ve bilinen konular

- Konsol kancası tasarım gereği sayfa genelinde çalışmaya devam eder (VIP açılmadan önce üretilen loglar terminalde görünsün diye); yalnız maliyeti düşürüldü, akış tamamen durdurulmadı.
- Görünür durumdaki kart efektleri (`backdrop-filter: blur(40px)`, kart başına `rotateCardGlow` / `hologramScan` sonsuz animasyonları) bu görevin kapsamı dışında kaldı; sekme gizliyken zaten durmaktadır.
- God-Eye mesaj / force-logout fonksiyonlarındaki dinamik Firestore import'u mevcut durumdur; dokunulmadı.
- `admin.html:95` oturum süresi sayacı ve `admin-dashboard.js` saat sayacı VIP bileşeni değildir; kapsam dışı.

## 9. Yerel test walkthrough

1. `npm run lint:xss` → son satırda `İZİNSİZ 0`.
2. `node --test --test-reporter=spec tests/unit/vip-console-lifecycle.test.mjs` (Chrome ya da Edge kurulu olmalı; yol için `CHROME_EXECUTABLE_PATH` verilebilir).
3. Uygulamada: yönetim panelinde VIP sekmesini açın, kapatın; tarayıcı konsolunda `AppModules.VipHealth.isRunning()` → `false`, `countUpsActive()` → `0`.
4. VIP kapalıyken konsola `console.log('x'.repeat(5000))` yazın; VIP'i açın: terminal son satıra kaymış, mesaj `… [3000 karakter kısaltıldı]` ile bitmiş olmalı.
5. HEATMAP düğmesine basın: donut çizilir; Elements panelinde `path` öğeleri içinde `<title>` görünür.
