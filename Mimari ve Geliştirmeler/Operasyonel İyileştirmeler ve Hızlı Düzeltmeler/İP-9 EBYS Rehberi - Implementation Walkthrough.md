# İP-9 EBYS Rehberi (Standart Kullanıcı İçin) — Implementation Walkthrough

> **Tarih:** 18.11.2026
> **Dal:** `feat/v3.7-ebys-h5-h7-yazisma-takip` (HEAD `1b99b57`; H0–H8 kapandıktan sonraki ilk UX paketi)
> **Durum:** Uygulandı; tarayıcı doğrulaması ve tüm kalite kapıları geçti, commit ile mühürlendi.
> **Kapsam:** Yalnız içerik/UX — veri sözleşmesi, `firestore.rules`, `/services/` katmanı değişmedi. `src/ui/ebys-showcase-modal.js` + `.css` (her iki ekran ortak: `index.html` standart personel, `admin.html` yönetici) ve rehber taslak belgesi.
> **Plan:** `İP-9 · EBYS Rehberi (Standart Kullanıcı İçin) — Uygulama Planı.md` (bu klasörde) birebir uygulandı; plandaki "İsteğe bağlı/düşük öncelikli" sekme sırası değişikliği de uygulandı.

## İçindekiler

1. [Talepler ve karşılıkları](#1-talepler-ve-karşılıkları)
2. [Kullanıcının gördüğü davranış](#2-kullanıcının-gördüğü-davranış)
3. [Teknik akış](#3-teknik-akış)
4. [Değişen dosyalar](#4-değişen-dosyalar)
5. [Test ve doğrulama](#5-test-ve-doğrulama)
6. [Sınırlar ve bilinen konular](#6-sınırlar-ve-bilinen-konular)
7. [Yerel test walkthrough](#7-yerel-test-walkthrough)

---

## 1. Talepler ve karşılıkları

| # | Talep (plandan) | Sonuç |
|---|---|---|
| 9a | Aşama 4'teki işlevsiz "Akışı oynat" animasyonu kaldırılsın; adımlar animasyonsuz, net ve okunur gösterilsin | `renderBooks()`'tan `play()`/`setStage()`/`timer` ve `root._cleanup` kaldırıldı. `select(id)` artık yalnız defter kartının `is-selected`/`aria-pressed` durumunu ve `aria-live` detay metnini günceller. `.ebys-sc-flow-dot` ve bağlantı çizgisinin varsayılan rengi, önceden yalnız `is-active`/`is-done` sınıflarıyla gelen canlı vurguya (accent renk, dolu arka plan) sabitlendi; artık hiçbir durum sınıfına ihtiyaç duymadan her zaman net görünür. |
| 9b | Aşama 3'teki işlevsiz kur simülatörü kaldırılsın; statik fatura/mini-kart/SSS korunsun | `renderPurchase()`'dan "Kur güncellemesini simüle et" butonu, `current` state'i ve `.ebys-sc-rate-now` canlı satırı kaldırıldı. `KUR DONDURULDU` damgalı fatura, iki sabit kur kutusu ve 3 mini-kart aynen korundu. |
| 9d | "Onay/İmza" ile "İcra" farkı ve "Havale" kavramı açıkça tanımlansın | `renderExecution()`'ın `sectionHead` lead metni güçlendirildi: *"Onay/imza, evrakın içeriğini uygun bulduğunuzu gösterir. İcra ise onaylanan işin gerçekte yapılmasıdır… Evrak, icra bitmeden kapanmaz."* Admin/personel dallanmasından **önce** her iki tarafa da görünen bir "Havale nedir?" `.ebys-sc-feature` kartı eklendi. |
| 9c | Aşama 6'ya Aşama 5 kalıbıyla işlevsel bir icra karar simülasyonu eklensin; standart personel tarafında her zaman görünür olsun | `renderExecutionSimulation()` yeni fonksiyonu `.ebys-sc-chain`/`.ebys-sc-sim-log`/`.ebys-sc-actions` ve `el`/`icon`/`badge`/`button` yardımcılarını yeniden kullanarak **Kabul bekliyor → İcrada → Tamamlandı** (alternatif dal: **İade edildi**) durum makinesini uyguluyor. "Kabul Et", "Tamamla" (İşlem sonucu + Kanıt referansı metin girişleriyle), "Gerekçeyle iade et", "Baştan başlat" düğmeleri var. `!isAdmin` dalında (yani `index.html`'de, `#ebysExecutionAdmin` yokken) her zaman görünür; `admin.html`'de hiç render edilmez. |
| 9c erişilebilirlik notu | Simülasyona eklenen `<input>` alanları odak hapsinden atlanmasın | `build()` içindeki Tab/Shift+Tab odak hapsi seçicisine `input:not([disabled])` eklendi. |
| 9c erişilebilirlik notu | Koyu temayla uyumlu sade input stili | `#ebysShowcaseModal` token'larını kullanan `.ebys-sc-input`/`.ebys-sc-fields`/`.ebys-sc-field` sınıfları eklendi; odak halkası mevcut `:focus-visible` listesine katıldı. |
| Kronolojik sekme sırası | `SECTIONS` iş akışının gerçek sırasına dizilsin | `org(2) → purchase(3) → books(4) → sign(5) → execution(6) → verification(7) → faq` sırasına değiştirildi. `openShowcase(sectionId)` id bazlı çalıştığı için `index.html` (`purchase`, `books`) ve `admin.html` (`books`) çağrıları etkilenmedi. |
| Dilim 2 | Rehber taslak belgesi güncel ürün gerçekliğiyle hizalansın | `2026-11-07_EBYS_Rehberi_Revizyon_Taslagi.md` güncellendi: tüm "Planlanan H3/H4/H5/H6a/H6b/H7 — henüz ürün özelliği değil" ifadeleri kaldırıldı; H6b (Tanımlar → Kurum Künyesi/Dosya Planı/Üst Yazı Şablonları), H7 (Cevap yazısı hazırla, İlgi: satırı, mükerrer onay kutusu, Gönderim Takibi, sunucu filtreleri), "Evraklarım (EBYS)" ekranı ve Onay/İcra/Havale ayrımı gerçek ekran/düğme adlarıyla yazıldı. |

## 2. Kullanıcının gördüğü davranış

### 2.1 Sekmeler artık kronolojik

Rehber hangi düğmeden açılırsa açılsın (`index.html`'de Satın Alma veya Evraklarım bölümünden, `admin.html`'de kenar çubuğundan), sol/üst sekme listesi artık şu sırada: **Kurumsal Yapı (Aşama 2) → Satın Alma (Aşama 3) → Evrak Defterleri (Aşama 4) → İmza Süreci (Aşama 5) → İcra ve Kapanış (Aşama 6) → QR ve Doğrulama (Aşama 7) → SSS**. Açılış sekmesi değişmedi (Satın Alma'dan "purchase", Evraklarım/kenar çubuğundan "books" ile açılır); yalnız diğer sekmelere gidiş sırası kronolojik.

### 2.2 Evrak Defterleri (Aşama 4) — sade, animasyonsuz

"Akışı oynat" butonu kayboldu. Bir defter kartına tıklandığında artık yalnız o kart vurgulanır ve altındaki açıklama metni günceller; "Taslaktan resmi kayda" panelindeki 3 adım (Taslak → Onaya sun/Dondur → Resmi kayıt) her zaman aynı net, vurgulu (mor çerçeveli, dolu arka planlı) biçimde görünür — önceden yalnız animasyon oynatıldığında kısa süreliğine vurgulanıyordu, geri kalan zamanda soluk griydi.

### 2.3 Satın Alma (Aşama 3) — sade, statik

"Kur güncellemesini simüle et" butonu ve tıklandıkça değişen "Güncel: …" satırı kayboldu. Kur sabitleme paneli artık yalnız iki sabit kutu (USD/EUR "Sabitlenen kur") ve altında statik bir açıklama cümlesi gösteriyor. Fatura tablosu, `KUR DONDURULDU` damgası ve 3 mini-kart değişmedi.

### 2.4 İcra ve Kapanış (Aşama 6) — kavram + simülasyon

Başlık metni artık Onay/İmza ile İcra arasındaki farkı açıkça söylüyor. Hemen altında, hem yönetici hem personel görünümünde aynı "Havale nedir?" kartı var. Ardından rol kartları (önceden olduğu gibi); **yalnız standart personel görünümünde** ("Evraklarım"den veya `index.html`'den açıldığında) kartların altına "Deneyin: örnek icra kararı" başlıklı yeni bir simülasyon paneli eklendi:

1. Panel üç durumlu bir zincir gösterir: **Kabul bekliyor** (başlangıçta vurgulu) → **İcrada** → **Tamamlandı**.
2. **Kabul Et** tıklanınca "İcrada" vurgulanır, iki metin alanı (İşlem sonucu, Kanıt referansı) etkinleşir, `aria-live` metni *"İş şu an sizde ve İcrada durumunda…"* der.
3. Alanlar doldurulup **Tamamla**'ya basılınca üç durum da yeşil/"Tamamlandı" olur; `aria-live` metni girilen sonucu ve kanıt referansını kelimesi kelimesine tekrar eder (*"…Sonuç: Teslim edildi, tutanak imzalandı. Kanıt referansı: Tutanak No: 2026/88."*).
4. **Gerekçeyle iade et** (yalnız "İcrada" durumundayken etkin) zinciri turuncu "İade edildi" durumuna çevirir ve *"…iş gerekçeyle yöneticiye geri döndü."* mesajı gösterir.
5. **Baştan başlat** zinciri ve iki metin alanını sıfırlar.

Yönetici görünümünde (`admin.html`, `#ebysExecutionAdmin` mevcutken) bu panel hiç render edilmez; yalnız mevcut 4 yönetici kartı görünür.

## 3. Teknik akış

### 3.1 Dosya değişiklikleri

- `src/ui/ebys-showcase-modal.js` — `SECTIONS` sırası, `renderBooks()`, `renderPurchase()`, yeni `EXECUTION_STAGES`/`renderExecutionSimulation()`, `renderExecution()` ve odak hapsi seçicisi değişti.
- `src/ui/ebys-showcase-modal.css` — `.ebys-sc-flow-dot`/`.ebys-sc-flow-step::after` varsayılan (durağan) stile çevrildi, artık kullanılmayan `.is-active`/`.is-done` flow seçicileri ve `.ebys-sc-rate-now*` kaldırıldı, `.ebys-sc-rate` 2 sütuna indirildi, yeni `.ebys-sc-fields`/`.ebys-sc-field`/`.ebys-sc-input` eklendi.

### 3.2 Neden `innerHTML` yok, XSS riski yok

Tüm yeni düğümler (`resultField`, `evidenceField`, "Havale nedir?" kartı, simülasyon paneli) mevcut `el()`/`icon()`/`badge()`/`button()` yardımcılarıyla `createElement`/`textContent`/`setAttribute` üzerinden üretildi; hiçbir yerde şablon dizgisiyle HTML birleştirilmedi. `lint:xss` bunu doğruluyor (bkz. §5).

### 3.3 Odak hapsi değişikliği neden gerekli

`build()` içindeki `Tab`/`Shift+Tab` dinleyicisi, diyalog içindeki odaklanabilir öğeleri `querySelectorAll('button:not([disabled]), summary, [tabindex="0"], a[href]')` ile buluyordu — `<input>` bu listede yoktu. İcra simülasyonu artık etkin durumda iki `<input>` içerdiğinden (ve bu alanlar DOM sırasında "Tamamla"/"Gerekçeyle iade et" düğmelerinden önce geldiğinden), seçiciye `input:not([disabled])` eklenmeden klavye kullanıcısı bu alanlara `Tab` ile gelebilse de hapis mantığının "ilk/son öğe" hesabı yanlış olabilirdi. Düzeltme sonrası hapis listesi etkin input'ları da kapsıyor (bkz. §5.1 tarayıcı testi).

## 4. Değişen dosyalar

| Dosya | Değişiklik |
|---|---|
| [src/ui/ebys-showcase-modal.js](../../src/ui/ebys-showcase-modal.js) | 9a/9b/9c/9d içerik ve etkileşim değişiklikleri, `SECTIONS` sırası, odak hapsi seçicisi |
| [src/ui/ebys-showcase-modal.css](../../src/ui/ebys-showcase-modal.css) | Flow dot/line varsayılan stili, `.ebys-sc-rate-now*` temizliği, yeni input stilleri |
| [Mimari ve Geliştirmeler/v3.5 EBYS Geliştirme Süreci/EBYS_H0-H8_Tamamlama_ve_Kapanis/2026-11-07_EBYS_Rehberi_Revizyon_Taslagi.md](../v3.5%20EBYS%20Geli%C5%9Ftirme%20S%C3%BCreci/EBYS_H0-H8_Tamamlama_ve_Kapanis/2026-11-07_EBYS_Rehberi_Revizyon_Taslagi.md) | "Planlanan" ifadeleri kaldırıldı; H6b/H7/Evraklarım/İcra-Havale bölümleri gerçek ekran adlarıyla yeniden yazıldı |
| [scratch/ebys-showcase-ui.cjs](../../scratch/ebys-showcase-ui.cjs) | Kaldırılan butonların yerine yeni kronolojik sekme, icra simülasyonu ve odak hapsi testleri (scratch, git'e dahil) |
| Bu belge (yeni) | Walkthrough |

`node scratch/hosting-files.js` dosya sayısı **129** olarak kaldı (yeni JS/CSS uygulama dosyası eklenmedi; İP-9 kapsam sınırına uygun).

## 5. Test ve doğrulama

### 5.1 Tarayıcı doğrulaması — `node scratch/ebys-showcase-ui.cjs`

Betik güncellendi (kaldırılan Aşama 3/4 butonlarını değil, yeni kronolojik sırayı, Aşama 6 simülasyonunu ve odak hapsini doğrular) ve çalıştırıldı:

```
EBYS Rehberi: kronolojik sekmeler, defter seçimi (animasyonsuz), imza simülasyonu, satın alma (statik kur),
Aşama 6 icra simülasyonu (Kabul Et/Tamamla/İade, <input> odak hapsinde), Esc/odak dönüşü, koyu tema,
telefon tek kolon. pageerror=0
```

Kapsanan kontroller: `index.html` iki tetikleyici (`purchase`, `books`); sekme sırası tam 7 başlık; `#ebysScTab-purchase` ilk odak; defter seçiminde `.ebys-sc-flow-step` sınıflarının hiç `is-done`/`is-active` taşımaması (animasyon kodu tamamen kaldırıldığının kanıtı); "Akışı oynat" butonunun yokluğu; imza simülasyonu (değişmedi, referans); satın almada "Kur güncellemesini simüle et" ve `.ebys-sc-rate-now` yokluğu; Aşama 6'da "Havale nedir?" kartı ve lead metni; Kabul Et → girişler etkinleşir → Tamamla → 3 düğüm `is-done` ve `aria-live` metninde girilen değerler; Baştan başlat → Kabul Et → Gerekçeyle iade et → `is-returned`; etkin `<input>`'un odak hapsi seçicisinde bulunduğunun doğrudan DOM sorgusuyla kanıtı + gerçek `Shift+Tab` sonrası odağın modal içinde kaldığı; `admin.html` koyu temada `.ebys-sc-chain` hiç render edilmediği (yönetici tarafında simülasyon yok) ve "Havale tanımını hazırlayın" kartının varlığı; 390px telefon genişliğinde tek kolon, yatay taşma yok, icra sekmesinde Kabul Et sonrası ekran görüntüsü.

Ekran görüntüleri geçici `scratch/ebys-showcase-shots/` klasörüne alındı ve doğrulama sonrası silindi (scratch dışına ham dosya bırakılmadı).

### 5.2 Kalite kapıları — gerçek çıktılar

| Kapı | Komut | Sonuç |
|---|---|---|
| Yayın dosyası sayısı | `node scratch/hosting-files.js` | `Yayınlanacak dosya: 129 (kök: 23, src/: 95, pdf-fonts/: 3) · beklenen: 129` → `✔ Yalnız uygulama dosyaları yayınlanacak.` |
| XSS lint | `npm run lint:xss` | `104 dosya · 209 sink · 296 HTML şablonu · 1027 dinamik ifade` → `güvenli 1008 · izinli (xss-ok) 19 · İZİNSİZ 0` |
| Birim testleri | `npm run test:unit` | `tests 398 · pass 398 · fail 0 · cancelled 0` |
| Satır sonu | `git ls-files --eol -m` | Değişen 3 takip edilen dosya (`ebys-showcase-modal.js/.css`, rehber taslağı) hepsi `i/lf w/lf`. CSS dosyası Edit sırasında bir kez `w/crlf`'ye düştü, `\r\n` → `\n` dönüştürülüp düzeltildi. |

`test:rules` bu görevde çalıştırılmadı: değişiklikler yalnız statik rehber içeriğidir, `firestore.rules`/servis katmanına dokunulmadı (görevin kapsam sınırı); H8 walkthrough'unda kural paketi zaten yeşil olarak kanıtlanmıştı.

## 6. Sınırlar ve bilinen konular

- `scratch/ebys-showcase-ui.cjs`'deki eski sürümde sekme başlıkları listesi (`s.tabs`) gerçek 7 sekmeye karşı yalnız 5 başlıkla karşılaştırılıyordu ve `index.html` tetikleyici sayısı hatalı biçimde `1` olarak bekleniyordu (gerçekte 2 — Satın Alma ve Evraklarım). Bu, betiğin bir süredir hiç çalıştırılmadan bırakıldığını gösteriyor; İP-9 kapsamında düzeltildi.
- İP-9 planındaki "İsteğe bağlı, düşük öncelikli" admin havale simülasyonu (sorumlu seç → havale et → personelin kabul/tamamlama durumunu izle) bu pakette **uygulanmadı** — admin zaten "bilgili" kitle sayıldığından plan bunu düşük öncelikli bırakmıştı; istenirse ayrı bir pakette eklenebilir.
- `test:rules` ve emülatör bu görevde çalıştırılmadı (kapsam dışı — bkz. §5.2).

## 7. Yerel test walkthrough

```bash
# Tarayıcı doğrulaması (ekran görüntüleri bir geçici klasöre yazılır, inceleyip silinebilir)
mkdir -p scratch/ebys-showcase-shots
node scratch/ebys-showcase-ui.cjs scratch/ebys-showcase-shots
rm -rf scratch/ebys-showcase-shots

# Kalite kapıları
node scratch/hosting-files.js
npm run lint:xss
npm run test:unit
git ls-files --eol -m
```

Gerçek tarayıcıda manuel kontrol için: `index.html` → Satın Alma sekmesindeki veya "Evraklarım (EBYS)" başlığının yanındaki **EBYS Rehberi** düğmesi; `admin.html` → kenar çubuğunun altındaki **EBYS Rehberi** düğmesi. İcra ve Kapanış sekmesine gidip (personel tarafında) "Deneyin: örnek icra kararı" panelini deneyin.
