# Görev Listesi — Envanter Yönetimi ITSM Modülü

## ✅ Sprint 1 — Tamamlandı

- [x] **ITSM Talep Akışı Geliştirmeleri**
  - [x] `index.html` — Talep Türü, Öncelik, Planlanan İade Tarihi alanları eklendi
  - [x] `script.js` — `openRequestModal` yeni alanları sıfırlıyor
  - [x] `script.js` — `onReqTypeChange` geçici zimmet → iade tarihi göster/zorunlu kıl
  - [x] `script.js` — `saveRequest` ITSM alanlarını (talepTuru, oncelik, iadeTarihi) Firestore'a kaydediyor
  - [x] `script.js` — `editPersonnelInventoryRequest` düzenleme formunda yeni alanları dolduruyor

- [x] **Admin Arayüzü Entegrasyonu**
  - [x] `admin.html` — Sol menüye "Envanter Yönetimi" (fa-boxes) nav butonu eklendi
  - [x] `admin.html` — `#inventoryManagementTab` div eklendi
  - [x] `admin.html` — `inventory-management.js` type="module" olarak yüklendi

- [x] **Yeni Modül: `inventory-management.js`**
  - [x] `window.inventoryManagementModule` global yapısı tanımlandı
  - [x] `showAdminTab` interceptor (edm-workflow pattern'ine uygun)
  - [x] `getNormalizedAssignments` — requests + b3 birleştirme
  - [x] `renderAdminInventoryTab` — KPI kartları, filtreler, tablo
  - [x] `applyFilters` — arama, tür, öncelik, sıralama
  - [x] `updateKPIs` — toplam/geçici/kalıcı/iade/bekleyen sayaçları
  - [x] `openAssignModal` / `closeAssignModal` — dinamik inject, personel doldurma
  - [x] `addAssignRow` / `removeAssignRow` — çoklu satır
  - [x] `onWarehouseChange` — depo seçince ürünleri doldurur
  - [x] `saveAssignment` — B1/B2 stok düşümü + B3 zimmet kaydı
  - [x] `removeAssignment` — iadeEdildi işaretleme + depoya iade
  - [x] `exportToExcel` — SheetJS ile filtrelenmiş Excel raporu

- [x] **Firestore Canlı Güncelleme**
  - [x] `firebase-handler.js` — requests/b3/b1/b2 listener'ına tab aktifken render desteği

---

## 🔜 Sprint 2 — Planlanan (Öncelik Sırasına Göre)

### 🔴 Kritik — Canlıya Çıkmadan Önce

- [x] **[A] Zimmet modalına SN alanı ekle**
  - `inventory-management.js` → `addAssignRow` → Her satıra Seri No / SN text input eklendi
  - `saveAssignment` → b3Entry'ye `item.sn` değeri yazılıyor

- [x] **[B] Demirbaş filtresi — sadece isDemirbas:true zimmetlenebilir**
  - `onWarehouseChange()` → `.filter(p => isDemirbas === true && adet > 0)`
  - `saveAssignment` b3Entry → `isDemirbas: true` olarak kaydediliyor

- [x] **[C] Talep onayında SN girme alanı**
  - `script.js` → `confirmRequest()` → `showCustomPrompt` / `window.prompt` ile SN alınıyor
  - SN hem `request.sn`'e hem B3 `exitEntry.sn`'e yazılıyor
  - B3 kaydına `alanKisi`, `tarih`, `talepTuru`, `oncelik`, `iadeEdildi:false` eklendi

- [x] **[D] "Teslim Aldım" → Otomatik Zimmet**
  - `script.js` → `receiveProduct()` → B3'e `iadeEdildi:false` zimmet kaydı yazılıyor
  - `alreadyInB3` kontrolü ile çift yazım önleniyor (confirmRequest + receiveProduct)

### 🟡 Kısa Vade

- [x] **[E] Zimmet Modalında "Hızlı Personel Ekle" kısa yolu**
  - Personel select yanına `[+ Yeni]` butonu eklendi
  - `quickAddPersonnel()` → `openPersonelModal()` açılır, kapanınca select otomatik güncellenir

- [x] **[F] Zimmet Modalında "Hızlı Ürün Ekle" kısa yolu**
  - Ürün satırları başlığına `[Yeni Ürün]` butonu eklendi
  - `quickAddProduct()` → `openProductModal()` açılır, kapanınca depo select'leri yenilenir

- [x] **[G] SN Bazlı Cihaz Geçmişi Modalı**
  - Zimmet tablosunda SN olan satırlara `[Geçmiş]` butonu eklendi
  - `showDeviceHistory(sn)` fonksiyonu: assignments + b3 + requests üç kaynağı aynı SN için tarar
  - Kronolojik timeline modal'da görüntülenir (kaç kişide dolastı, ne zaman iade edildi)

- [x] **[H] `assignments` Firebase Koleksiyonu**
  - `firebase-handler.js` → `window.data` init + `saveData collections[]` + listener
  - `inventory-management.js` `saveAssignment()` → her zimmet B3'e EK olarak `assignments` koleksiyonuna da yazdırılıyor
  - Firebase'de `/inventory/assignments` dokümanı oluştu, SN/personel/tarih bazlı sorgulama mümkün

- [ ] **[I] Zimmet PDF — Resmi Zimmet Formu**
  - Personel bazlı zimmet belgesi (kişi adı, ürün listesi, SN'ler, tarihler, imza alanı)
  - `pdf-generator.js` ile entegre

---

## 📊 Mevcut Veri Mimarisi (Referans)

```
Firebase: inventory koleksiyonu
  ├── b1.items[]     → Depo 1 ürünleri
  ├── b2.items[]     → Depo 2 ürünleri
  ├── b3.items[]     → Çıkış/Zimmet logları (alanKisi varsa zimmet)
  ├── requests.items[] → Personel talepleri (talepTuru, oncelik, iadeTarihi YENİ)
  └── personel.items[] → Personel listesi
```
