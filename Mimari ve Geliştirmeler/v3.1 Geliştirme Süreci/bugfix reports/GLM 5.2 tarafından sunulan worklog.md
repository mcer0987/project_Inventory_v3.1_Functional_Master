# Proje Worklog — Medipol Envanter Takip Sistemi (Manifesto Denetimi)

Bu worklog, kullanıcının çok-ajanlı geliştirme sürecinde paylaştığı 10 JavaScript
dosyasının ve manifesto metninin denetiminden doğan bulguları ve süreç iyileştirme
planını içerir. Bu dosya **kullanıcının kendi projesi** hakkındadır; sandbox'taki
Next.js demo projesiyle ilgili değildir.

---
Task ID: 1
Agent: Z.ai Code (Ana Asistan — Manifesto Denetimi)
Task: Kullanıcının 7 ajanlı (Sonnet/Qwen/Gemini Flash/DeepSeek/Llama/Laguna/Gemini Pro)
geliştirme sürecinde paylaştığı manifesto + 10 JS dosyasını tek elden denetle;
hataları ve sorunları listele; süreç iyileştirme planı üret.

Work Log:
- /home/z/my-project/upload/ klasöründeki 10 dosya okundu (firebase-handler.js,
  auth-engine.js, security-biometrics.js doğrudan; diğer 7 dosya Explore sub-agent ile).
- Manifesto kuralları (Vanilla JS, Firebase v10, window.AppModules, /ui vs /services
  ayrımı, // [WHY] + // [HOW] zorunlu, mutation-free state) baz alınarak 6 boyutta
  denetim yapıldı: Mimari, Güvenlik, Kod Kalitesi, Bağımlılık, Ölçeklenebilirlik,
  Dokümantasyon.
- Toplam ~10.388 satır kod incelendi; 50+ somut bulgu tespit edildi (15 CRITICAL/HIGH).

Stage Summary (özet — detaylar kullanıcıya rapor olarak sunuldu):
- 6 CRITICAL güvenlik/zamanlama hatası: biyometrik fallback herhangi 5 haneli kodu
  kabul ediyor; XOR+base64 "şifreleme" statik salt ile; admin yetkisi 'Muhammed Cer'
  string karşılaştırması ile; admin_auth expiry 3 dk / 10 dk / 3 saat olarak 3 yerde;
  script.js undefined `data`/`db` referansları; admin-dashboard.js:188 getFirestore()
  appsiz çağrısı.
- Manifesto uyumsuzluğu: /ui dosyaları Firebase yazıyor (ui-components.js:362,
  admin-dashboard.js:588/626/698, purchase-servises.js komple). window.AppModules
  yarım bırakılmış — script.js:131-287'deki tüm köprüler ölü kod.
- God-file: edm-workflow.js 2.568 satır — state machine + algoritma + Firebase + UI
  tek dosyada; tüm ajan sınırlarını ihlal ediyor.
- Duplikasyon: closePurchaseModal 3 yerde, showCustomConfirm 2 yerde,
  openNewPurchaseModal 2 yerde tanımlı; window.data 4 farklı şekille init ediliyor.
- Performans: innerHTML += forEach içinde (admin-dashboard.js:279/481/511);
  onSnapshot her tetikte tam tablo re-render (patch altyapısı var ama kullanılmıyor).
- Süreç: 6/10 dosyada header yok; // [WHY]/[HOW] tutarsız; [BUGFIX] Bug N
  işaretleri merkezi takipsiz; [DECOMMISSIONED] no-op fonksiyonlar birikmiş.

Önerilen 4 fazlı iyileştirme planı (kullanıcı raporunda detaylı):
- Faz 1 (Acil, 1-2 gün): Kritik güvenlik + runtime crash onarımları
- Faz 2 (Kısa, 1 hafta): Ajan sınır ihlallerini düzelt, duplikasyonları temizle
- Faz 3 (Orta, 2-3 hafta): window.AppModules'i tutarlı hale getir, ESM stratejisi
  karar ver, god-file'ları parçala
- Faz 4 (Uzun, 1+ ay): Sunucu tabanlı yetkilendirme (Custom Claims), patch-based
  DOM güncelleme, CI/lint entegrasyonu

Ayrıca manifesto kendisi de revizyona ihtiyaç duyuyor: ajan rol çakışmaları
(Sonnet hem mimari hem /services; DeepSeek algoritma ama edm-workflow'da UI üretüyor),
Merkezi Sözlük eksikliği, "executor/auditor" çatışması (Qwen yazar, Llama denetler
ama merge öncesi gate yok), ve otomatik uygulanabilirlik kontrolü yok.

Unresolved issues / risks:
- Kullanıcının gerçek kod tabanına erişimimiz yok (sadece 10 örnek dosya). Tüm
  rapor bu örnekleme dayalı; HTML/CSS ve birkaç modül hariç tutulduğu için
  dependency graph eksik olabilir.
- Firestore Security Rules dosyaları yüklenmedi; anonim auth + muhtemel gevşek
  kurallar kombinasyonu en büyük dışsal risk.
- Cron tabanlı webDevReview, kullanıcıyı yanıltmamak için AÇILMADI — sandbox
  Next.js projesi, kullanıcının analiz ettiği vanilla JS projesiyle alakasız.
  Kullanıcı isterse kendi projesi için manuel denetim döngüsü isteyebilir.
