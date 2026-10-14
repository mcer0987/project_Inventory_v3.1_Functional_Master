# Faz 5 Orkestrasyon ve Uygulama Planı — Tamamlama: Eksik Özellikler, Raporlama ve UX

> **Tarih:** 06.10.2026 · **Branch:** `feat/phase-5-completion-and-ux` (master üzerinden açılacak)  
> **Referanslar:** `v3.2 Master Stabilizasyon Planı.md` (§5 Faz 5), Bulgu Kataloğu (ZIM-04, ADM-05, ADM-06, VIP-08 vb.), Gemini Pro Faz 3 Denetim Notları (B1/B2 Sözleşmesi).  
> **Durum:** 📋 YÜRÜTME REHBERİ — Modeller bu belgedeki görev dağılımı ve tur sırasına göre çalışacaktır.

---

## 1. Model Rol Dağılımı ve Görev Matrisi

| Model | Rolü | Sorumlu Olduğu Alanlar |
|---|---|---|
| **Claude Opus** | **Master Architect (Veri & Mantık)** | B1/B2 Şema Sözleşmesi, Hurda Akışı, Kısmi Sevk, `assignment-service` PDF veri motoru, Birleşik Yedekleme Servisi, VIP optimizasyonu. |
| **Claude Sonnet** | **UI/UX & Document Engine** | `pdf-generator.js` (jsPDF AutoTable Türkçe fontlu tasarım), Özel İzleme Paneli onarımı (ADM-05), Hızlı CRUD köprüleri, CSS/Tema cilaları. |
| **Gemini Flash** | **Fast QA & Visual/DOM Auditor** | K1 turu sonrası PDF çıktı denetimi, layout thrashing, DOM şişmesi ve CSP uyum kontrolü. |
| **Gemini Pro** | **Security & Logic Auditor** | K4 turu kapanışında B1/B2 sözleşme testi sızdırmazlığı, Hurda veri bütünlüğü ve nihai merge denetimi. |

---

## 2. Tur Haritası ve Görevler

### TUR K1: Resmi Zimmet PDF Motoru ve Raporlama (5.1, ZIM-04)
* **Claude Opus:**
  - `assignment-service.js` içine `generatePersonnelZimmetData(personelId)` ekler (aktif zimmetleri ve cihaz kimliklerini kanonik şemadan çeker).
* **Claude Sonnet:**
  - `pdf-generator.js`'i baştan tasarlar: jsPDF AutoTable ile Türkçe TTF font entegrasyonu, sahte verilerin silinmesi, kurumsal Medipol teslim-tesellüm tutanağı şablonu, imza blokları ve ITSM takip no.
* **Denetim (Gemini Flash):** PDF görsel ve Türkçe karakter çıktısı onayı.

---

### TUR K2: Envanter Hareketleri, Hurda Akışı ve B1/B2 Sözleşmesi (5.8, 3.6 Eki, H4 Kararları)
* **Claude Opus (Veri Mimarisi):**
  - **B1/B2 Şema Sözleşmesi:** `schema.js` içine `validateB1` ve `validateB2` kuralları; test suite'e `b1WriteContract` ve `b2WriteContract` testleri.
  - **Hurdaya Ayırma Akışı (Scrap):** B2 demirbaşının resmi tutanakla hurdaya ayrılması (stok düşümü + `b3` logu `tip: 'hurda'` + servis kaydı kapatma).
  - **Kısmi Sevk İyileştirmesi (INV-06):** Kalemin tamamı yerine seçilen adedin transferi.
  - **Sayfalama & Filtreleme (INV-05, INV-07):** Canlı senkronda 1. sayfaya sıfırlanma pürüzünün giderilmesi.

---

### TUR K3: Admin Paneli, VIP Performansı ve UX Cilaları (5.3, 5.5, 5.6, 5.7, 5.9)
* **Claude Opus:**
  - **Birleşik Yedekleme Servisi (5.3 - ADM-06):** Tek kanonik `{version: '3.2', root, timestamp, data}` formatı, önizlemeli geri yükleme.
  - **VIP Optimizasyonu (5.5 - VIP-08):** VIP kapalıyken 1 sn'lik CPU tüketen sağlık döngüsünün durdurulması.
* **Claude Sonnet:**
  - **Özel İzleme Paneli (ADM-05):** `renderCustomWatchDashboard` tablosunun kaybolma hatasının çözülmesi.
  - **Hızlı Ürün/Personel Ekleme (5.2 - ZIM-05):** Modal içi hızlı ekleme butonlarının onarılması.
  - **Admin Tab Kancaları (5.7 - ARC-07):** `AppModules.AdminTabs.onShow` kanca standardı.
  - **TODO ve Ekran Cilaları (5.9):** Eksik rozetler ve dark-theme kontrastları.

---

### TUR K4: Bağımsız Denetim, Regresyon ve Kapanış
* **Gemini Pro:** B1/B2 sözleşmeleri ve Hurda akışı için derin güvenlik/mimari denetim raporu.
* **Claude Opus:** Ek A regresyon testleri (41/41) ve `master`'a `--no-ff` merge.