# EBYS Katalog Seed Script'leri ve Birim/Atama Tasarım Notu

| Alan | Değer |
|---|---|
| Tarih | 17.11.2026 |
| Dal | `refactor/v3.7-script-soc-ayristirmasi` (HEAD `56680ed`) |
| Kapsam | H6b (Kurum Künyesi / Dosya Planı / Üst Yazı Şablonları) canlı test sonrası: gerçek seed verisi, tasarım sorusu, VIP panel için 3. parti bağımlılık listesi |
| Yöntem | Statik okuma (`src/utils/ebys-catalog-schema.js`, `src/services/ebys-catalog-service.js`, `src/ui/ebys-catalog-ui.js`, `firestore.rules`), Explore ajanıyla VIP panel ve `units` kullanımının repo genelinde taranması |
| Durum | Script'ler yazıldı (`scratch/ebys-seed/`, commit'e dahil değil — `.gitignore:73` `/scratch/`). Birim sorusu ve API listesi yalnız bu belgede; kod değişikliği yapılmadı. |

## 1. Zemin (kod okumasıyla doğrulanan gerçekler)

- `src/utils/ebys-catalog-schema.js`, `src/services/ebys-catalog-service.js`, `src/ui/ebys-catalog-ui.js` içinde **birim/unit hiç geçmiyor** — Dosya Planı ve Üst Yazı Şablonları şu an tamamen global.
- Yazma API'si hazır: `window.AppModules.EBYSCatalog.saveFilePlan({code,title},{create:true})` ve `.saveTemplate({name,subject,content})` (`src/services/ebys-catalog-service.js:58-72,81-98`). Her ikisi de transaction içinde revizyon/`serverTimestamp()`'ı kendisi yönetir.
- Alan sınırları (`src/utils/ebys-catalog-schema.js:10` `LIMITS`, `firestore.rules` `ecPlanOk`/`ecTemplateOk`): plan kodu `^[0-9A-Za-z][0-9A-Za-z.-]{0,39}$`, plan adı ≤160, şablon adı ≤120, konu ≤240, içerik ≤40000 karakter.
- `units`/`unitId` tüm uygulamada yalnız **personel/EBYS görev atama** amaçlı (`src/utils/ebys-definitions-schema.js`, `src/ui/ebys-definitions-ui.js`, `firestore.rules:1274-1295` `ejTarget`/`ejPolicy`). **Hiçbir yerde "birime göre oku/seç" kısıtlaması yok** — `personel` ve `units`'in kendisi bile `firestore.rules:718`'deki genel `member(root)` kuralıyla tüm personele açık okunuyor. Tek emsal `ejTarget`: yazma anında görevlinin gerçekten o birimde olup olmadığını doğrular — bir görünürlük filtresi değil.
- Tek "kişiye özel/gizli içerik" emsali: `ebysDrafts` + `ebysOwn()` (`firestore.rules:977,1109-1115`) — taslak yalnız sahibine (`ownerUid`) görünür, dondurulup paylaşılana kadar.
- VIP panelde (`src/modules/admin/admin-system-control.js`) statik başlık+açıklama listesi deseni: "Debug & Hata Takip" kartı (`admin.html:2112-2129`, `_renderDebugPanel()` admin-system-control.js:386-427) — sabit bir diziyi `innerHTML` şablonuna döken en basit örnek. Bu oturumda **kullanılmadı** (kullanıcı kararı: şimdilik yalnız metin liste istendi).
- Gerçek 3. parti host listesi `firebase.json`'daki CSP başlığından (ground truth): `connect-src` → `firestore.googleapis.com`, `identitytoolkit.googleapis.com`, `securetoken.googleapis.com`, `api.emailjs.com`; `script-src`/`font-src` → `www.gstatic.com`, `cdnjs.cloudflare.com`, `cdn.jsdelivr.net`. Font Awesome `assets/fontawesome/` altında **yerel** (CDN değil).

## 2. Seed script'leri

`scratch/ebys-seed/seed-file-plans.js` ve `scratch/ebys-seed/seed-letter-templates.js` — ikisi de **tarayıcı konsolu** script'i (Node değil; `window.AppModules.EBYSCatalog` yalnız admin.html'de, admin oturumuyla yüklü). Çalıştırma: admin.html → F12 → Console → script'i yapıştır → Enter. `.gitignore:73`'teki `/scratch/` kuralı yüzünden commit/push'a dahil olmazlar.

**Nasıl çalışır:** Her iki script de `EBYSCatalog` servisinin **var olan** yazma fonksiyonlarını sırayla çağırır (ham Firestore yazması yok); her çağrı kendi transaction'ıdır, revizyon/zaman damgasını servis kendisi atar. Bir kod/isim zaten varsa (`create:true` + mevcut kayıt kontrolü) ilgili satır hatayla reddedilir, script durmaz — `console.table` sonunda hangi kalemin geçtiğini/reddedildiğini gösterir. Script'ler **idempotent** değildir ama **güvenlidir**: ikinci çalıştırmada zaten var olan kodlar "zaten var" hatasıyla atlanır, veri bozulmaz.

**Dosya Planı kodu ne işe yarar:** EBYS'de her evrak, oluşturulurken bir Dosya Planı koduna etiketlenir (`ebysDrafts.metadata.filePlanCode/filePlanTitle`). Bu, evrakın hangi iş/konu kategorisine ait olduğunu belirler; gerçek kurumsal EBYS'lerde arşivleme, saklama süresi ve arama/raporlama bu koda göre yapılır. **UYARI:** Aşağıdaki 20 kod, Türkiye kamu kurumlarının yaygın kullandığı Standart Dosya Planı'nın (000–900 ana grup) genel yapısına dayanır; resmi genelgeyle birebir sayı eşleşmesini ben doğrulayamadım. Kurumunuzun Yazı İşleri/Arşiv biriminin referans aldığı güncel plan varsa canlıya kalıcı olarak işlemeden önce onunla karşılaştırın.

| Kod | Başlık |
|---|---|
| 000 | Genel Yazışmalar |
| 001 | Mevzuat, Yönetmelik, Yönerge |
| 010 | Teşkilat, Görev ve Yetki |
| 020 | Personel Özlük İşlemleri |
| 025 | Atama, Nakil, Görevlendirme |
| 050 | Mali İşler, Bütçe, Muhasebe |
| 100 | Eğitim-Öğretim İşleri |
| 150 | Öğrenci İşleri (Kayıt, Mezuniyet, Burs) |
| 200 | Bilimsel Araştırma Projeleri (BAP) |
| 250 | Akademik Atama ve Yükseltme |
| 300 | Yayın, Basın ve Halkla İlişkiler |
| 400 | Sağlık, İş Sağlığı ve Güvenliği |
| 500 | Taşınır ve Taşınmaz Mal İşlemleri |
| 600 | Satın Alma ve İhale İşlemleri |
| 650 | Sözleşme ve Protokoller |
| 700 | Bilgi İşlem ve Otomasyon |
| 710 | Kütüphane ve Dokümantasyon |
| 750 | Sosyal, Kültürel ve Sportif Faaliyetler |
| 800 | Uluslararası İlişkiler ve Değişim Programları |
| 900 | Arşiv, Dosyalama ve İmha İşlemleri |

**Üst yazı şablonu ne işe yarar:** Yeni bir evrak taslağı açılırken hazır bir metin/konu başlığı seçilebilsin diye (`AppModules.EBYSCatalogSchema.applyTemplate`). 5 şablon, "Resmi Yazışmalarda Uygulanacak Usul ve Esaslar Hakkında Yönetmelik" biçimine uygun; doldurulacak alanlar `[...]` ile işaretli:

1. **Bilgi Talebi** — başka birime/kişiye bilgi istemi
2. **Görevlendirme Yazısı** — personelin görev/komisyona atanması
3. **Toplantı Daveti**
4. **Cevabi Yazı** — gelen yazıya cevap
5. **Olur Yazısı (Onay)** — üst makam onayı

Tam script içerikleri `scratch/ebys-seed/` altındadır (bkz. §4 dosya listesi).

## 3. Birim/atama tasarım sorusu — analiz ve öneri

**Soru:** Dosya planları/şablonlar bir birime mi atanmalı, yoksa herkes görüp seçebilir mi? Admin üretip göndermek yerine her user kendi şablonunu mu üretmeli?

**Mevcut durum:** İkisi de tamamen global; birim kavramı kodda yalnız personel/görev atamasında var, hiçbir okuma/listeleme kısıtlamasında yok (§1).

**Öneri — ikisini ayrı değerlendirmek gerekiyor, cevap farklı:**

- **Dosya Planı: GLOBAL kalmalı.** Gerçek hayatta bir kurumun dosya planı, muhasebedeki hesap planı gibi **tek, kurumsal standart** sınıflandırmadır. Birime bölünürse: (a) aynı konudaki evrak farklı birimlerde farklı kodlanır, arşiv/arama bütünlüğü bozulur; (b) bir birimin kendi kodu olmaz, yalnız ilgili olduğu kodları kullanır — yani "birime atama" kavramı pratikte anlamsızdır, zaten herkes aynı listeden ilgili olanı seçer. Kodda bunu değiştirecek bir şey yapmadım; mevcut global model doğru.

- **Üst yazı şablonları: şimdilik GLOBAL/admin-küratörlü kalmalı, ama sezginiz (admin üretip göndermemeli) kısmen haklı — ve kodda zaten doğru çözümün emsali var.** Resmi kurum yazışmalarında birkaç **standart, kurumsal** şablon (yukarıdaki 5 gibi) her zaman merkezi/admin tarafından tutulur — bunlar "birime özel" değildir, Yazı İşleri'nin belirlediği ortak biçimdir. Ama **kişisel, tekrarlayan** yazı ihtiyacı (bir personelin sürekli attığı aynı tip yazı) gerçek bir senaryo; bunun çözümü "admin her personel için şablon üretip göndersin" değil, zaten var olan `ebysDrafts` + `ownerUid` gizlilik örüntüsünün küçük bir uzantısıdır: personel kendi taslağını "şablonum" olarak işaretleyip saklayabilsin, yalnız kendisi görsün/kullansın. **Bu şimdi inşa edilmedi** — yalnızca öneri; gerçek bir ihtiyaç ortaya çıkarsa ayrı, küçük bir iş paketi olarak ele alınmalı.

- **Sonuç:** Birim ataması alanı Dosya Planı'na ya da Üst Yazı Şablonu'na eklenmemeli (ne kodda bir emsali var ne de gerçek kullanım buna ihtiyaç duyuyor). Kişisel şablon ihtiyacı doğarsa yön `ebysDrafts` örüntüsüdür, birim değil.

## 4. 3. parti API / bağımlılık listesi (VIP panele eklenmedi — yalnız bu belgede)

**A. Gerçek API bağımlılıkları (veri/kimlik alışverişi; sistemin çalışması buna bağlı)**

| Servis | Host | Ne için |
|---|---|---|
| Firebase Firestore | firestore.googleapis.com | Ana veritabanı — tüm envanter, talep, personel, EBYS verisi |
| Firebase Authentication (Identity Toolkit) | identitytoolkit.googleapis.com | Kullanıcı girişi/kayıt |
| Firebase Authentication (Secure Token) | securetoken.googleapis.com | Oturum/token yenileme |
| EmailJS | api.emailjs.com | Tarayıcıdan doğrudan e-posta gönderimi (arşiv/bildirim mailleri) — sunucu taraflı e-posta altyapısı yok |

**B. Yalnız statik kod/kütüphane dağıtan CDN'ler (veri göndermiyor, bir kez indirilip çalışır)**

| Host | Yüklediği kütüphaneler |
|---|---|
| www.gstatic.com | Firebase JS SDK 10.7.1 (modüler `import`) |
| cdn.jsdelivr.net | Chart.js 4.4.1, lz-string 1.5.0, EmailJS tarayıcı SDK'sı 3.12.1, SortableJS 1.15.7 |
| cdnjs.cloudflare.com | jsPDF 2.5.1, jspdf-autotable 3.8.2, xlsx (SheetJS) 0.18.5 |

**C. Yerel/gömülü (dış bağımlılık değil)**

| Ne | Nerede |
|---|---|
| Font Awesome 6.5.2 | `assets/fontawesome/` — CDN'den değil, pakete gömülü |
| Roboto (PDF fontu) | `pdf-fonts/` |
