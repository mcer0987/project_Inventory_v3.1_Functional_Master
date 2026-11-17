Markdown · onboarding-engineer.md

# Medipol Envanter Takip Sistemi — Prompt Engineer Onboarding

**Proje:** Medipol Üniversitesi İçin Kurumsal Demirbaş ve Envanter Takip Sistemi\
**Versiyon:** v3.6 (Phase 5 tamamlandı, EBYS veri yönetimi)\
**Yazılı Dil:** Türkçe (belgeler, kodlar ve yorumlar)\
**Son Güncelleme:** 12 Kasım 2026

---

## 📋 İlgili Markdown Dosyaları (Okuma Sırası)

### 1. Temel İlkeler ve Mimarı Anayasa

- **`Global-Architecture.md`** — Projenin genetik kodu: 4 egemen sütun (Dijital İkiz, Kod Kanundur, Değişmez Denetim, Vendor Bağımsızlığı) + 5 Altın Kural. **BUNU OKUYUN İLK.**
- **`AGENTS.md`** — Arayüz geliştirme ilkeleri: her panelde kısa açıklama, yardım düğmesi, kullanıcı yararına odaklanma.

### 2. Geliştirme Ortamı ve Test

- **`DOCKER_GUIDE.md`** — Docker, nginx, üretim dağıtımı. Gereksinimler (Node.js 20+, JDK 21, Java), emülatörle geliştirme.
- **`EMULATOR_GUIDE.md`** — Localhost'ta Firebase emülatörü çalıştırma (8080/9099), test verisi yükleme, otomatik akış testleri.
- **`audits/README.md`** — Test matrisleri ve doğrulama komutları.

### 3. Mimari Evreleri ve Kararlar

- **`Mimari ve Geliştirmeler/v3 Geliştirme Süreci/`** — v3.0 ... v3.6 aşamalarının walkthroughları:
  - `V3 Phase 0_ Elite Backend & Data Architecture.md` — Veri katmanı
  - `v3 Phase 1_walkthrough Architecture & Mobile Responsiveness.md` — Mobil yanıt verme
  - `v3 Phase 4_ Antigravity — Analiz ve İş Planı Raporu.md` — Karmaşık durumlar
  - `v3 Phase 5_Değişiklik ve Entegrasyon Walkthrough.md` — Entegrasyon kararları
  - `v3 Phase 6_vipCleanDuplicates ve filter-module walkthrough.md` — Veri temizliği

### 4. Sistem Yaşı ve EBYS (Evrak Yönetimi)

- **`audits/audit-reports/2026-11-12_EBYS_H6b_Kunye_Dosya_Plani_Sablon_Walkthrough.md`** — Kurum künyesi, dosya planı, üst yazı şablonları (son eklenen katmanlar)
- **`audits/audit-reports/2026-11-12_EBYS_H6a_Hotfix_Birim_Personel_UX_Walkthrough.md`** — Demirbaş envanter no otomasyonu, plaka görünürlüğü

### 5. ITSM Entegrasyonu (Gelecek Evreleri)

- **`Mimari ve Geliştirmeler/Zimmet & ITSM yapısı/`** — Zimmet (cihaz atama) ve ITSM entegrasyon planı.

---

## 🏛️ Projenin Dört Temel Sütunu (Mimarı Anayasa)

### 1️⃣ Dijital İkiz ve Varlık Egemenliği (Digital Twin & Sovereign Asset)

- **İlke:** Demirbaş sıradan bir "stok satırı" değil, **Dijital İkiz** (fiziksel cihazın dijital temsilatçısı).
- **Uygulama:**
  - Seri No (SN) ve Envanter No ile tekilleştirme
  - Adet = 1 kuralı (en az birinde)
  - Yaşam döngüsü: `IN_POOL` → `ASSIGNED` → `IN_SERVICE` → `SCRAPPED`
  - Değişmez denetim geçmişi (tüm transferler kaydedilir)
- **Gelecek:** NFC/IoT + blockchain NFT (Varlık Pasaportu)

### 2️⃣ "Kod Kanundur" ve Katı Sözleşmeler (Code is Law & Strict Contracts)

- **İlke:** İş kuralları arayüzdeki butonların insafına bırakılamaz. **Veritabanı kapısında kilitlenir.**
- **Uygulama:**
  - `schema.js` içinde sözleşmeler: `validateB1`, `validateB2`, `validateB3`
  - Firestore kuralları: Zero-Trust denetim (`firestore.rules`)
  - Her yazma: şema doğrulaması + kural matrisi
- **Gelecek:** Akıllı sözleşmeler (Smart Contracts) — insan müdahalesi yok.

### 3️⃣ İnkar Edilemez ve Değiştirilemez Denetim (Immutable Auditability)

- **İlke:** Kurumdaki geçmiş değişmez. Her onay, ret, transfer, silme **inkar edilemez kanıt** bırakır.
- **Uygulama:**
  - `auditLogs` koleksiyonu (yazılır ama güncellenemez/silemez)
  - Her işlem: zaman damgası, kullanıcı, eski/yeni değer
  - Admin dahil **kimse silinemez**
- **Gelecek:** Sıfır Bilgi İspatları (ZK-SNARK) — denetim kanıtı, ticari sırlar saklanarak.

### 4️⃣ Sağlayıcı Bağımsızlığı (Vendor-Agnostic / Local-First)

- **İlke:** Bugün Firebase, yarın GunDB/IPFS/SQLite olabilir. Mimari **soyutlanmış** kalmalı.
- **Uygulama:**
  - UI ve modüller doğrudan Firebase çağrı yapmaz
  - Tüm veri: `/services/` katmanı (Data Access Layer) üzerinden
  - Servisler swappable: Firebase → GunDB gibi
- **Gelecek:** P2P merkezi sunucusuz dağıtık ERP.

---

## ⚙️ Beş Altın Kural

1. **Ayrık Sorumluluk:** UI çizer, servis işler, kural zorlar. Bir katman diğerine sorumluluk taşımaz.
2. **Fail-Closed Güvenlik:** Belirsiz durumda **RED** ver, asla "belki" diyerek kapı açma.
3. **Geriye Dönük Saygı:** Canlı sistemde çalışan insanlar var. Şema bozacak değişiklik yok; göç aracı iste.
4. **Performans & Hafiflik:** Vanilla JS + no frameworks. O(N) sorgular yerine O(1) indeksli çözüm.
5. **Sözleşme Dokunulmazlığı:** Testler (unit, rules) ölümcül. Testi gevşetmezsin, kodu mükemmelleştirirsin.

---

## 🛠️ Kullanılan Teknoloji Stack

### Frontend

| Bileşen | Seçim | Neden |
| --- | --- | --- |
| **Framework** | Vanilla JS (ES6+) | Hafif, hızlı, vendor lock-in yok |
| **UI State** | `window.AppModules.*` | Global namespace kirliliği olmaz |
| **DOM API** | `textContent`, `dataset`, `querySelector` | XSS güvenli, doğrudan erişim |
| **CSS** | Vanilla + tema değişkenleri (`--primary-color` vb.) | Responsive + dark mode |
| **Styling Approach** | Inline `<style>` + modüler CSS dosyaları | Bağlam yönetimi kolay |

### Backend (Veritabanı & Kimlik)

| Katman | Seçim | Ne İçin |
| --- | --- | --- |
| **Veritabanı** | Firestore (NoSQL, gerçek zamanlı) | Sub-koleksiyon, transaction, real-time listener |
| **Kimlik** | Firebase Auth | Kurumsal SSO, session yönetimi |
| **Kurallar** | `firestore.rules` (DSL) | Zero-Trust, istemci güvenilmez |
| **Emülatör** | Firebase Local Emulator Suite | Localhost test, veri isolation |

### Veri Katmanı

| Dosya | Görev |
| --- | --- |
| `src/services/firebase-handler.js` | Firebase SDK başlatma, ortam seçimi (demo vs. live) |
| `src/utils/schema.js` | Sözleşme doğrulaması (B1/B2/B3 kuralları) |
| `src/services/*-service.js` | CRUD + iş mantığı (assignment, purchase, etc.) |

### Testing

| Araç | Seviye | Komut |
| --- | --- | --- |
| **Birim testler** | Pure functions | `npm run test:unit` (391/391) |
| **Kural testleri** | Firestore DSL | `npm run test:rules` (403/403) |
| **XSS denetimi** | Security | `npm run lint:xss` (0 unauthorized) |
| **Akış testleri** | E2E (UI + DB) | `node scratch/flow-tests.js --emu` (54 senaryo) |

### Deployment

| Ortam | Araç | Portlar |
| --- | --- | --- |
| **Geliştirme** | `npm run emu` + `npm run serve` | 5500 (web), 8080 (DB), 9099 (auth) |
| **Docker (prod)** | nginx + Alpine Linux | 8088 (default) veya custom |
| **Firestore kuralları** | `firebase deploy --only firestore:rules` | — |

---

## 🔐 Sistem Kısıtlamaları ve Kararlar

### Firestore Expression Budget

- **Sınır:** 1000 ifade/istek
- **Karar:** Demirbaş müdürü taslak yazarken plan + şablon doğrulaması bütçeyi aşar
- **Çözüm:** Doğrulama sürüm yazımına ertelendi (`ecVersionPlanOk`, `ecVersionTemplateOk`)

### Değişmezlik İlkesi (Immutability)

- Dondurulmuş evrak (`ebysVersions`) güncellenemez/silinemez → kural seviyesinde `allow update, delete: if false;`
- Evrak katalogu (künye, plan, şablon) kopyası taslak oluşturmada **zorunlu** → sonra tanımlar değişse de evrak değişmez
- Tarih damgası ve revizyon gereklidir (conflict detection için)

### Adet = 1 Kuralı

- Demirbaş (adet=1) olmazsa cihaz atama (`zimmet`) yasak
- Sarf ürünler (adet>1) toplu atanabilir ama seri sayısı eksiktir
- Cihaz geçmişi yalnız tek seri no ile takip edilir

### Denetim Kaydı Güvenliği

- `auditLogs`: yazılır ama güncellenemez/silinemez (kural katı)
- Admin dahil kimse değiştiremez
- Zaman damgası server-side (istemci saatine güven yok)

### Veri Migrasyonu

- Şema değişiklikleri canlıya yapılmadan göç aracı yazılır
- Eski veriler uyum katmanı (`schema.compatibility`) ile tutulur
- Breaking change **yok** (test: `npm run test:rules`)

### Firestore Koleksiyonları (Sabit)

```
├── users/{userId}                        # Kimlik ve roller
├── departments/{deptId}                  # Kurumsal birim
├── products/{productId}                  # Ürün kataloğu
├── assignments/{id}                      # Demirbaş ataması (zimmet)
├── transfers/{id}                        # Cihaz hareketi (çıkış, sevk, etc.)
├── auditLogs/{id}                        # İnkar edilemez log
├── ebysOrganizations/primary             # Kurum künye (H6b)
├── ebysOrganizationRevisions/{rev}       # Künye versiyonu (H6b)
├── ebysFilePlans/{code}                  # Dosya planı (H6b)
├── ebysLetterTemplates/{uuid}            # Üst yazı şablonu (H6b)
├── ebysLetterTemplateRevisions/{uuid}_{n} # Şablon versiyonu (H6b)
└── ebysDrafts/{id}                       # Evrak taslağı
    └── ebysVersions/{versionId}          # Dondurulmuş evrak (değişmez)
```

---

## 📐 Kod Organizasyonu

```
project_Inventory/
├── index.html                    # Ana sayfa (personel/kullanıcı)
├── admin.html                    # Yönetici paneli
├── style.css                     # Global stiller + tema
│
├── src/
│   ├── utils/
│   │   ├── schema.js            # B1/B2/B3 doğrulama (pure)
│   │   ├── ebys-document-schema.js  # Evrak şeması (H6b)
│   │   └── ebys-catalog-schema.js   # Katalog (künye, plan, şablon) (H6b)
│   │
│   ├── services/
│   │   ├── firebase-handler.js  # SDK init + env seçimi
│   │   ├── auth-service.js      # Giriş + session
│   │   ├── assignment-service.js   # Zimmet (atama) işlemleri
│   │   ├── transfer-service.js  # Çıkış, sevk, hurda, vb.
│   │   ├── purchase-servises.js # Satın alma akışı (typo: servises)
│   │   ├── ebys-document-service.js # Evrak taslak yazı (H6b)
│   │   ├── ebys-catalog-service.js  # Katalog save/load (H6b)
│   │   └── backup-service.js    # Yedekleme
│   │
│   ├── modules/
│   │   ├── admin/               # Yönetici sayfası
│   │   │   ├── admin-main.js
│   │   │   ├── admin-purchase-render.js
│   │   │   └── inventory-management.js
│   │   │
│   │   ├── edm-workflow.js       # EBYS evrak akışı
│   │   ├── filter-module.js      # Arama ve filtreleme
│   │   └── purchase-module.js    # Satın alma modülü
│   │
│   └── ui/
│       ├── ebys-documents.css         # Evrak form stilleri (H6b)
│       ├── ebys-documents-ui.js       # Evrak editörü (H6b)
│       ├── ebys-definitions-ui.js     # Katalog panelleri (H6a/H6b)
│       ├── ebys-catalog-ui.js         # Künye/Plan/Şablon rendereri (H6b)
│       ├── device-ids.js              # Cihaz seri numaraları (H6a)
│       ├── ui-components.js           # Form bileşenleri (plaka, vb.)
│       ├── personnel-showcase-modal.js # Personel detay (H6a)
│       ├── unit-showcase-modal.css/js # Birim detay (H6a)
│       ├── ebys-purchase-ui.js        # Satın alma arayüzü (H6a)
│       └── development-notice.js      # Geliştirme notu (H6a)
│
├── firestore.rules              # Zero-Trust kurallı matrix
├── firebase.json                # Firebase config
│
├── tests/
│   ├── unit/                    # Şema testleri
│   │   ├── schema.test.mjs
│   │   ├── ebys-catalog-schema.test.mjs
│   │   └── …
│   └── rules/                   # Firestore DSL testleri
│       ├── firestore.test.mjs
│       └── ebys-catalog.test.mjs
│
├── scratch/                     # Geçici scriptler
│   ├── flow-tests.js            # 54 otomatik senaryosu
│   ├── emu-seed.mjs             # Test verisi yükleme
│   ├── docker-check.js          # Docker durumu
│   └── hosting-files.js         # Deployment kontrol
│
└── Mimari ve Geliştirmeler/     # Dokümantasyon ve planlar
    ├── v3 Geliştirme Süreci/    # Phase walkthroughları
    ├── Zimmet & ITSM yapısı/    # Gelecek evreleri
    └── AI_STUDIO_AUDITOR_PLAYGROUND.md  # Audit notu
```

---

## 📝 Geliştirme Sürecinin Anahtarları

### Sorunu Anlama Sırası

1. **Global-Architecture.md oku** — 4 sütun ve 5 kural. Bunu yapmazsan sonrası anlamsız.
2. **İlgili phase walkthroughı oku** — Karar neden alındığını anla.
3. **Kodu oku** — Karar kodda nasıl görünüyor?
4. **Testleri oku** — Test ne istediğini göster.

### Yeni Feature Eklemesi

1. **Şema doğrulaması:** `src/utils/schema.js` içinde kontrat tanımla.
2. **Servis katmanı:** `src/services/*-service.js` içinde işlemler.
3. **Kural denetimi:** `firestore.rules` içinde Zero-Trust kuralları.
4. **UI:** `src/ui/*-ui.js` içinde form/panel çiz.
5. **Test:** `tests/` içinde birim + kural + E2E testleri.
6. **Ölüm:** Commit **öncesinde** testlerin tümü yeşil olmalı.

### Hata Giderme İpuçları

- **"Yetki hatası" (403):** `firestore.rules` içinde kural yok veya eksik. F12 konsolda "Missing or insufficient permissions" var mı?
- **"Şema hatası":** `schema.js` içinde doğrulama başarısız. Error metin nedir? Sınırı mı aştı?
- **"Emülatör bağlanmıyor":** `npm run emu` açık mı? `http://127.0.0.1:4000` açılıyor mu (kontrol paneli)?
- **"Test başarısız":** `npm run test:rules` detaylı hata verir. Scenario adı nedir?

---

## 🎯 H6b (Son Eklenen Katmanlar) Özet

### Kurum Künyesi (Organization Profile)

- **Koleksiyon:** `ebysOrganizations/primary` + `ebysOrganizationRevisions/{n}`
- **Alan:** kod, ad, adres, telefon, e-posta, web, revision
- **Kural:** Yönetici yazarsa revizyon kaydı yapılır; kopya evrak oluşturmada taşınır
- **UI:** Tanımlar sekmesi → "Kurum Künyesi" → doğru/gözden geçir/tarih

### Dosya Planı (Filing Plan)

- **Koleksiyon:** `ebysFilePlans/{kod}`
- **Alan:** kod (değişmez), ad, aktif/pasif, revision
- **Kural:** Pasif plan yeni seçimde reddedilir ama seçimden sonra pasife alınan taslak dondurulabilir
- **UI:** Tanımlar sekmesi → "Dosya Planı" → tablo + pasife al/ad düzelt

### Üst Yazı Şablonu (Letter Template)

- **Koleksiyonlar:** `ebysLetterTemplates/{uuid}` + `ebysLetterTemplateRevisions/{uuid}_{n}`
- **Alan:** ad, konu, metin (metin değişmez = yeni sürüm)
- **Kural:** Her kayıt yeni sürüm; eski sürümler okunur ama silinmez
- **UI:** Tanımlar sekmesi → "Üst Yazı Şablonları" → sürüm geçmişi

### Evrak Kopyaları

- **Taslak:** `ebysDrafts` → `metadata.filePlanTitle` + `letterTemplate` + `organizationCode`
- **Dondurulmuş:** `ebysVersions` → `metadataSnapshot` + `letterTemplateSnapshot` + `institutionSnapshot`
- **Garanti:** Donmuş evrak tanımdan bağımsız; yalnız o andaki kopyasını taşır

---

## 🚀 İlk 3 Adım (Başlamak için)

1. **Global-Architecture.md'yi oku** (20 dakika)
2. **Emülatör başlat:**

   ```bash
   npm install                   # Bir kez
   npm run emu &                 # Terminal 1
   npm run emu:seed              # Terminal 2
   npm run serve                 # Terminal 3
   ```
3. **`http://127.0.0.1:5500/index.html?emu=1` aç ve gez**
   - Yönetici: `emu-yonetici-0001`
   - Personel: `flow.personel` / `ftkod77`

Sorular? Kodu oku, tesfleri çalıştır, belgeler arasında linkler izle.

**Yönetmelik:** Kod ve belgeler güncellenirken birlikte güncellenir. Eski belge = eski karar; yeni kod = yeni karar.

---

**Son Karar:** Proje Vanilla JS + Firestore ile yazılıp yazılmaya **devam edecektir.** Web3/P2P geçiş gelecekte; bugün Foundation mühürlendi (v3.2).