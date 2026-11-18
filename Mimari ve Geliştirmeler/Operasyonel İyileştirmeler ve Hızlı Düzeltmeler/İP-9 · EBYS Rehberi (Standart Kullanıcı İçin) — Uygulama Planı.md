# İP-9 · EBYS Rehberi (Standart Kullanıcı İçin) — Uygulama Planı

> **Tarih:** 18.11.2026
> **Dal:** `feat/v3.7-ebys-h5-h7-yazisma-takip` (v3.6 klasörünün devamı; çalışma ağacındaki kullanıcı değişikliklerine dokunulmaz, yalnız kendi hunk'larımız commit'lenir)
> **Durum:** Plan — onay bekliyor (kullanıcı talimatı: "bekleteceğim", henüz uygulamaya geçilmeyecek)
> **Kapsam:** Yalnız içerik/UX — veri sözleşmesi, kural, servis katmanı değişmiyor; `src/ui/ebys-showcase-modal.js` + `.css`

## Bağlam

EBYS geliştirmesi şu ana kadar ağırlıklı admin panel perspektifinden yapıldı ve test edildi. Gerçek kullanımda
standart bir personel de `index.html` üzerinden aynı EBYS ekranlarına (onaylar, icra işlerim, evrak
bildirimlerim, satın alma) erişecek — ve bu kişi EBYS'yi hiç bilmeyebilir; "icra" ya da "havale" gibi
terimlerle hiç karşılaşmamış olabilir. Kullanıcının isteği: mevcut rehberi (`src/ui/ebys-showcase-modal.js`)
saf İÇERİK olarak incelemek — bu rehber, tamamen deneyimsiz bir kullanıcıyı EBYS arayüzünün tamamında baştan
sona yönlendirebilecek kapasitede mi?

Kullanıcının belirlediği ölçütler (birebir):
- **"Rehber boğmamalı. Ama havada da bırakmamalı."** Mevcut yoğunluk/tempo beğeniliyor — korunacak.
- İnteraktiflik var olduğu her yerde gerçekten işlevsel olmalı; işlevsel olmayacaksa hiç eklenmemeli. **Aşama
  5 iyi örnek.** Aşama 3'ün kur simülatörü ve Aşama 4'ün "akışı oynat" butonu kötü örnekler — ya işlevsel
  hale getirilecek ya da tamamen kaldırılacak, ara yol yok.
- Hedef kitle "standart kullanıcı" — bilgili/admin biri için değil.

Dosya tamamen okunarak (482 satır) aşağıdaki bulgular ve öneriler çıkarıldı.

## Bulgular

### 1) Aşama 5 (İmza Süreci) neden iyi — referans ölçüt
`renderSign()` kullanıcıya gerçek bir karar verdiriyor (Onayla / İade et / Baştan başlat) ve her kararın
sonucunu canlı değişen durumlarla, `aria-live` metniyle ve zincir görseliyle gösteriyor. Bu üç karar, gerçek
"Bana Gelen Onaylar" ekranındaki üç gerçek seçenekle birebir örtüşüyor. İnteraktiflik, kullanıcının gerçek
hayatta yapacağı seçimi birebir prova ettiriyor — işlevsel olmasının sebebi bu.

### 2) Aşama 4 (Evrak Defterleri) — "Akışı oynat" neden kötü
`renderBooks()` içindeki `play()`/`setStage()` yalnız 3 sabit adımı (Taslak → Dondur → Resmi kayıt) 900ms
aralıklarla sırayla "aydınlatan" bir animasyon. Kullanıcı hiçbir karar vermiyor, hiçbir dal/sonuç yok; adımlar
zaten hemen altında düz metin liste olarak tam açıklamasıyla duruyor. Buton, statik içeriğin tekrarından başka
bir şey katmıyor.

### 3) Aşama 3 (Satın Alma) — kur simülatörü neden kötü
"Kur güncellemesini simüle et" butonu USD/EUR kurunu sabit bir oranla (%3,5 / %2,8) artırıp "güncel kurla
toplam şu olurdu, ama belgede bu kalır" diyor. Aynı tek gerçek ("kur ilk onayda sabitlenir, sonrası
etkilemez") zaten üç ayrı yerde statik anlatılıyor: mini-kart ("Kur dondurma"), fatura üzerindeki "KUR
DONDURULDU" damgası + tooltip ve SSS'teki "Dövizli talebin tutarı kur değişince değişir mi?" sorusu. Buton
yeni bir anlayış katmıyor, yalnız aynı cümleyi sayılarla tekrar ediyor.

### 4) Asıl eksik: "icra" ve "havale" hiçbir yerde standart kullanıcıya açıkça tanımlanmıyor
- Aşama 6 başlığı ("Son onayla sorumluya bir iş açılır...") icra'nın ne olduğunu değil, nasıl işlediğini
  anlatıyor. İmza/onay ile icra arasındaki fark ("onay = uygun buldum" vs "icra = iş gerçekte yapıldı") hiç
  açıkça söylenmiyor.
- "Havale" kelimesi yalnız admin kartlarında ("Havale tanımını hazırlayın", "Yeniden Havale Et") ve SSS'te
  kullanılıyor, ama hiçbir yerde tanımlanmıyor.
- Buna karşılık Aşama 6 ve 7 zaten `document.getElementById('ebysExecutionAdmin')` kontrolüyle admin/personel
  içeriğini ayırıyor — yani mimari zaten "index'te de bu panel var" ihtiyacını kısmen karşılıyor; eksik olan
  tanım/kavram açıklığı, yapı değil.

### 5) Aşama 6'da hiç interaktif simülasyon yok — ihtiyaç tam burada
Aşama 5'in aksine Aşama 6 yalnız okunur mini-kartlardan oluşuyor; "kabul et / tamamla / iade et" kararlarını
deneyimleterek öğretmiyor. Kullanıcının en çok "bilemez" dediği kavram icra olduğuna göre, interaktifliğin
gerçekten gerekli olduğu yer burası — Aşama 5'teki kalıp doğrudan uygulanabilir.

### 6) İkincil/düşük öncelik: sekme sırası
Sekme sırası `Aşama4 → 5 → 6 → 7 → 3 → 2 → SSS` — kronolojik değil. Baştan sona okuyan gerçek bir acemi
kullanıcı, "birim nedir / talep nasıl açılır" (Aşama 2/3) bilgisinden önce "evrak kayıt defteri / imza /
icra" ile karşılaşıyor. Kullanıcı bunu ayrı belirtmedi ama "rehber havada bırakmamalı" ölçütüyle doğrudan
ilgili; düşük riskli, isteğe bağlı bir öneri.

## Uygulama adımları

### 9a · Aşama 4 — gereksiz animasyonu kaldır
`src/ui/ebys-showcase-modal.js` → `renderBooks()`: "Akışı oynat" butonunu, `play()`/`setStage()`/`timer`
mekanizmasını kaldır. Adım listesi (`flow`) doğrudan nötr/tam halde gösterilsin (animasyonsuz). `select('incoming')`
çağrısındaki `play()` tetiklemesi de kaldırılır.

### 9b · Aşama 3 — gereksiz simülasyonu kaldır
`renderPurchase()`: "Kur güncellemesini simüle et" butonunu, `current` state'ini ve `rateRow().now` canlı-kur
gösterimini kaldır. Statik fatura tablosu + "KUR DONDURULDU" damgası + mini-kartlar + SSS zaten aynı gerçeği
net anlatıyor.

### 9c · Aşama 6 — Aşama 5 kalıbını izleyen yeni karar simülasyonu (personel görünümü)
Mevcut `ebys-sc-chain` / `ebys-sc-sim-log` / `ebys-sc-actions` CSS sınıfları ve `button()`/`badge()`
yardımcıları aynen yeniden kullanılacak (yeni CSS gerekmiyor). Durum sırası: **Kabul bekliyor → İcrada →
Tamamlandı**; eylemler: **"Kabul Et"**, **"Tamamla"** (gerçek formdaki "sonuç" + "kanıt referansı" alanlarını
andıran kısa bir metin girişiyle), **"Gerekçeyle iade et"** (alternatif dal). Her adımda `aria-live` metni
sonucu açıklasın (ör. "İş tamamlandı; evrak kapandı, yazara bildirim gitti." / "İş yöneticiye geri döndü;
yeniden havale edilecek."). Bu, kullanıcının en çok yabancı olduğu kavramı (icra) Aşama 5'teki kadar somut
deneyimletir.

### 9d · "İcra" ve "havale" kavramlarını açıkça tanımla
`renderExecution()`'ın `sectionHead` lead metnini, imza/onay ile icra arasındaki farkı açıkça söyleyecek
şekilde güçlendir (ör. "Onay/imza, evrakın içeriğini uygun bulduğunuzu gösterir. İcra ise onaylanan işin
gerçekte yapılmasıdır — ürünün teslim edilmesi, talep edilen işlemin tamamlanması gibi. Evrak, icra bitmeden
kapanmaz."). Admin/personel dallanmasından önce, her iki kitleye de görünecek kısa bir "Havale nedir?"
mini-kartı ekle (ör. "Son onaydan sonra işi kimin yürüteceği havale ile belirlenir: yönetim işi ilgili birime
veya sorumluya yönlendirir. Standart kullanıcı olarak yalnız bu seçimin sonucunu — size atanan işi —
görürsünüz."). Bu, AGENTS.md ilkesiyle uyumlu: açıklama işlemin sonucunu anlatıyor, uygulama detayına
girmiyor.

## İsteğe bağlı / düşük öncelikli (ayrı onay gerekebilir)

- **Sekme sırasını kronolojik yap:** `org(2) → purchase(3) → books(4) → sign(5) → execution(6) →
  verification(7) → faq`. `SECTIONS` dizisindeki sırayı değiştirmek yeterli; her sekme `id` ile bağımsız
  render edildiği için sıra değişikliği başka bir şeyi bozmaz. `openShowcase(sectionId)` çağıran yerler id'ye
  göre çalıştığından etkilenmez.
- **Admin tarafı için küçük bir "havale" simülasyonu** (sorumlu seç → havale et → personelin kabul/tamamlama
  durumunu izle) — admin zaten "bilgili" kitlede sayıldığından öncelik düşük; yalnız istenirse eklenir.

## Kapsam dışı (değiştirilmeyecek)

- `renderSign()` (Aşama 5) — referans kalite, dokunulmuyor.
- Aşama 2 (org ağacı), Aşama 7 (QR) ve SSS — mevcut yoğunluk yeterli.
- Modal kabuğu / erişilebilirlik altyapısı (focus trap, Esc, dikey tablist) — değişmiyor.
- Veri sözleşmesi, servisler, kurallar — bu iş yalnız statik rehber içeriğine dokunur, hiçbir Firestore
  okuma/yazma davranışı değişmez (modal zaten veri okumuyor/yazmıyor).

## Değişecek dosyalar

| Dosya | Değişiklik |
|---|---|
| `src/ui/ebys-showcase-modal.js` | `renderBooks`, `renderPurchase`, `renderExecution` içerik/etkileşim düzenlemesi; (isteğe bağlı) `SECTIONS` sırası |
| `src/ui/ebys-showcase-modal.css` | Yeni sınıf **eklenmez** (mevcut `ebys-sc-chain`/`ebys-sc-sim-log`/`ebys-sc-actions` yeniden kullanılır); yalnız kaldırılan elemanların artık kullanılmayan stilleri varsa temizlenir |

## Test ve doğrulama

- Rehberi hem `index.html` hem `admin.html` üzerinden (`?emu=1` gerekmez, modal veri okumuyor) açıp Aşama 3,
  4, 6 sekmelerini gözden geçir: kaldırılan butonlar yok, yeni icra simülasyonu Aşama 5 ile aynı hissi veriyor
  mu kontrol et.
- Klavye gezinmesi (ok tuşları, Tab/Shift+Tab focus trap) yeni eklenen buton/alanlarla birlikte hâlâ çalışıyor
  mu test et.
- `npm run lint:xss` (yeni DOM düğümleri yine `el()/icon()/badge()/button()` ile, innerHTML yok).
- `npm run test:unit` (regresyon; bu dosyada birim testi yoksa bütçe değişmediğini doğrulamak için genel koşum yeterli).

## Walkthrough ve commit (onaydan sonra)

- Onay gelince `İP-9 EBYS Rehberi - Implementation Walkthrough.md` ve gerekirse `İP-9 - Test Kanıtları.txt`
  aynı klasöre eklenir (mevcut İP-1..8 biçimiyle aynı).
- Tek commit yeterli görünüyor (yalnız içerik/UX, veri katmanı yok): `fix(ebys): rehberi standart kullanıcı
  için netleştir (İP-9)` — Aşama 3/4'teki işlevsiz etkileşimlerin kaldırılması, Aşama 6'ya işlevsel simülasyon
  eklenmesi, icra/havale tanımlarının netleştirilmesi.
- Her commit için yalnız kendi hunk'larımız geçici index ile commit'lenir; Co-Authored-By satırı eklenmez.
