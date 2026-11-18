# Q0 teslim kontrolü

8 Kasım 2026. Karar: **Düzeltme gerekli; H1'e geçiş henüz uygun değil.**

Ana klasörde `feat/v3.4-ebys-tamamlama-h0`, HEAD `883da91` üzerindeki teslim incelendi. Implementation Plan, Walkthrough, Q0 başlangıç kopyalarıyla üretilen diff, gerçek UI kaynakları, test dosyası ve günlükler karşılaştırıldı. Mevcut günlükler 332/332 birim ve 354/354 Rules sonucunu destekliyor. Tam test takımları bu kontrol turunda yeniden çalıştırılmadı.

Olumlu: kart başına süreç aboneliği kaldırılmış; konu/sürüm/durum açık isteğe bağlanmış; toplamlar snapshot başına sorgulanmıyor. H0 kaynaklarının korunması ve yeni Rules/veri yazımı eklenmemesi teslimle uyumlu. Bu kazanımlar korunmalı.

## Q0-R1 — P2: Görünürlük değişiminde kaydedilmemiş karar notu kayboluyor

`src/ui/ebys-process-ui.js` içindeki `registerQueue` görünürlük kontrolü, `document.hidden` olduğunda `stopQueue` çağırıyor. Bu fonksiyon bütün `.ebys-document-dialog` öğelerini kaldırıyor. Oturum değişikliği veya yetki kaybı gerekmeksizin yalnız başka tarayıcı sekmesine geçmek, açık karar penceresini ve girilmiş notu yok ediyor. Ortak CSS seçicisi ilgisiz EBYS pencerelerini de etkileyebilir.

Hedefli headless Chrome kontrolünde gerçek `EBYSProcessUI.open` ile karar formu açıldı, not yazıldı, görünürlük olayı üretildi. Veri erişimi kontrollü fixture'dır; gerçek Auth/HTML/CSS UAT değildir.

| Aynı senaryo | Gizlenmeden önce | Gizlendikten sonra |
|---|---|---|
| Q0 öncesi H0 UI kopyası | Kaydedilmemiş karar notu | Aynı not formda duruyor |
| Q0 teslimi | Kaydedilmemiş karar notu | Modal kaldırılmış, not yok |

Çözüm ilkesi: sorguyu durdurma ile formu yok etme ayrılmalı. Görünürlük değişimi kullanıcı girdisini sessizce silemez. Oturum kapanması/değişimi veya gerçek yetki kaybında gizlilik temizliği korunmalı. Dönüşte güncel görev/yetki doğrulanmadan eski duruma dayanarak karar verilmemeli; görünmezken otomatik kayıt yapılmamalı.

## Q0-R2 — P2: Defter gizli sayfada abone kalıyor

`src/ui/ebys-documents-ui.js` uygulama içi admin sekmesi değişimini işliyor, fakat tarayıcı görünürlük değişimini işlemiyor. `registerSyncListener` ortak kayıt mekanizması da bunu kendiliğinden sağlamıyor.

Aynı fixture'da defter başlatıldı: etkin dinleyici 1. `document.hidden=true` ve `visibilitychange` sonrası etkin dinleyici yine 1. Görev kuyruğundaki gizlenme testi defterin bu eksikliğini kapsamıyor.

Çözüm: görünür uygulama paneli + görünür tarayıcı sayfası + geçerli oturum birlikte yönetilmeli. Gizlenince defter aboneliği bırakılmalı; dönüşte yalnız tek abonelik açılmalı. Sayaç/yanıt nesilleri ve açık editörün kaydedilmemiş girdileri güvenle korunmalı. Her görünürlük olayında gereksiz dört toplam sorgusu eklenmemeli.

## Yeniden üretme kanıtı

- Betik: `scratch/ebys-q0-review/reproduce.mjs`
- Sonuç: `scratch/ebys-q0-review/results.json`
- Komut: `node scratch/ebys-q0-review/reproduce.mjs`
- Exit: 0. Üç senaryoda pageerror: boş. Betik davranışı kaydeder; eski hatalı sonuçlar assertion olarak sabitlenmemiştir.

Betik mevcut testin fixture hazırlığını kullanır; Q0 öncesi/sonrası gerçek UI modülüyle karar penceresini açar. Üretim dosyaları değiştirilmedi. Düzeltmeden sonra kalıcı regresyon testleri asıl test takımına eklenmelidir; geçici inceleme betiği tek başına kapanış kanıtı olmaz.

Ek not: yeni birim testi Chrome yolunu Windows kurulumuna sabitliyor. Bu ortamda çalışsa da farklı makinede test taşınabilirliği sınırlı. Düzeltmede mevcut tarayıcı çözümleme yaklaşımı veya açık executablePath ortam seçeneği değerlendirilip raporlanmalı; tarayıcı bulunamadığında sessiz test atlama yapılmamalı.

Q0-R1/R2 kapandıktan sonra yeniden kontrol ve H1 promptu hazırlanabilir. Commit/deploy yapılmadı. Gerçek sayfanın görsel/klavye ve Auth+emülatör kabulü ayrıca açıktır.
