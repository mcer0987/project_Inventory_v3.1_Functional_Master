# ═══════════════════════════════════════════════════════════════════════════
# ANTIGRAVITY ERP — SİSTEM ANALİZ RAPORU (Part 1 — 20 Dosya)
# Hazırlayan: AI Hakem Asistanı | Muhammed'in Talebi Üzerine
# Tarih: Haziran 2025
# Scope: İlk 20 dosyanın tam taraması + mimari, güvenlik, performans değerlendirmesi
# ═══════════════════════════════════════════════════════════════════════════

---
## 1. DOSYA ENVENTÖRÜ VE ROL DAĞILIMI

### 📄 HTML GİRİŞ NOKTALARI (2)
| Dosya | Boyut | Rol |
|-------|-------|-----|
| `index.html` | ~88 KB | Personel ana sayfası. Login Modal, Launchpad, B1/B2/B3 depoları, talep modülleri, todo, çıkış formları, tüm CDN importları burada. |
| `admin.html` | ~113 KB | Admin dashboard. Chart.js grafikleri, satın alma, zimmet yönetimi, system control, backup/restore. `type="module"` ile firebase-handler import ediyor. |

### 🔥 ÇEKİRDEK MOTOR (5)
| Dosya | Satır | Rol | Yükleme |
|-------|-------|-----|---------|
| `script.js` | **4829** | Ana uygulama motoru. Auth flow, tab routing, render (tablo+kart), arama, sıralama, paginasyon, CRUD, çıkış, sepet, FAB/BottomSheet, tooltip sistemi. | `<script>` (global) |
| `firebase-handler.js` | **428** | Firebase V2 veri katmanı. Realtime sync (onSnapshot), batch write (chunked 490), diffing, transaction (stok), anonim auth fallback, migration utility. | `<script type="module">` |
| `security.js` | **37** | "Görünmez E-posta İllüzyonu" — admin@medipol.local + padded password ile Firebase Email/Password auth. | `<script>` (global) |
| `timer.js` | **243** | Oturum zamanlayıcı. 3dk (depo) / 10dk (admin) oturum süresi, modal açıkken erteleme, uyarı, timeout logout. | `<script>` (global) |
| `launchpad.js` | **~1200** | Zero Page / Launchpad. Apple/Linear hissi, bento grid, skeleton loading, bio-scan giriş, parallax (pasif), gate (auth/no-auth). | `<script>` (global) |

### 🛠️ ADMIN MODÜLLERİ (7)
| Dosya | Satır | Rol | Yükleme |
|-------|-------|-----|---------|
| `admin-dashboard.js` | **1917** | Dashboard grafikleri (Chart.js), kritik stok, ürün türü CRUD, talep onay/red, LoadingCoordinator, customConfirmAlert, bulkAddB2Items. | `<script type="module">` |
| `admin-system-control.js` | **~800** | VIP Kontrol Merkezi: Console interceptor, sistem sağlık monitörü, operasyon raporu, SortableJS sürükle-bırak, debug paneli, oturum widget'ı. | `<script>` (IIFE) |
| `admin-purchase-render.js` | **140** | Admin satın alma tablosu render. Workflow durum badge'leri (Başlatılmadı/Tamamlandı/Reddedildi/Askıya Alındı/Onay Bekliyor). | `<script>` (global) |
| `admin-sitemap.js` | **157** | Geliştirici kılavuzu. Tüm modüllerin interaktif dokümantasyonunu modal içinde gösterir. | `<script>` (global) |
| `admin-backup.js` | **136** | Firebase backup export (JSON) ve import/restore. | `<script>` (global) |
| `inventory-management.js` | **1042** | Zimmet yönetimi: Normalize edilmiş assignments, KPI kartları, filtreleme, iade, Excel raporu. | `<script type="module">` |
| `purchase-servises.js` | **1553** | Satın alma/EBYS: Modal, form, dosya upload (Firebase Storage), durum badge'leri, sayfalama. | `<script type="module">` |

### 🧩 YARDIMCI MODÜLLER (6)
| Dosya | Satır | Rol | Yükleme |
|-------|-------|-----|---------|
| `dark-mode-toggle.js` | **68** | Flicker-free dark/light toggle. localStorage tabanlı. Chart.js resize trigger. | `<script>` (IIFE+global fn) |
| `alert.js` | **157** | `showAppAlert()` — Toast bildirimler. `showCustomConfirm()` — Promise-bazlı onay kutusu. `showSuccessBanner()`. | `<script>` (global) |
| `todo-module.js` | **~1000** | Görev yönetimi: Admin/Personel TODO, hatırlatıcılar, filtreleme, CRUD. | `<script>` (window.todoModule objesi) |
| `db.js` | **45** | IndexedDB wrapper (legacy). `saveToDB()` ve `loadFromDB()`. | `<script>` (global) |
| `data-loader.js` | **6** | Statik B1 seed verisi (2 laptop kaydı). Legacy. | `<script>` (global) |
| `edm-workflow.js` | **~2000** | EBYS İş Akışı Motoru: Template CRUD, workflow state machine (Başlat/Onay/Red/Askıya Al/Durdur), personel atama. | `<script type="module">` |

---
## 2. MİMARİ GENEL BAKIŞ

```
┌─────────────────────────────────────────────────────────────────┐
│                        TARAYICI (SPA)                          │
│                                                                 │
│  index.html (Personel)              admin.html (Admin)          │
│  ┌──────────────────────┐          ┌───────────────────────┐   │
│  │ script.js (Motor)    │          │ admin-dashboard.js    │   │
│  │ launchpad.js         │          │ inventory-management  │   │
│  │ timer.js             │          │ purchase-servises.js  │   │
│  │ todo-module.js       │          │ edm-workflow.js       │   │
│  │ alert.js             │          │ admin-system-control  │   │
│  │ dark-mode-toggle.js  │          │ admin-purchase-render │   │
│  └──────────┬───────────┘          └──────────┬────────────┘   │
│             │                                 │                  │
│  ┌──────────┴─────────────────────────────────┴──────────┐     │
│  │              firebase-handler.js (ES MODULE)           │     │
│  │  • startRealtimeSync() — 13 koleksiyon dinler         │     │
│  │  • saveData() — Diffing + Chunked Batch (490)         │     │
│  │  • runStockTransaction() — Atomik stok güncelleme     │     │
│  │  • onInventoryDataUpdated — PubSub Event               │     │
│  └──────────────────────┬────────────────────────────────┘     │
│                         │                                       │
│  ┌──────────────────────┴────────────────────────────────┐     │
│  │              security.js                               │     │
│  │  • authenticate() — "Görünmez E-posta İllüzyonu"      │     │
│  │  • admin@medipol.local + padded password               │     │
│  └───────────────────────────────────────────────────────┘     │
│                                                                 │
│  ┌───────────────────────────────────────────────────────┐     │
│  │              VERİ AKIŞI                                │     │
│  │  Firebase Auth → onAuthStateChanged → startRealtimeSync│     │
│  │  onSnapshot → window.data[col] → CustomEvent dispatch  │     │
│  │  UI modülleri event dinler → render fonksiyonları     │     │
│  └───────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    │   Firebase V2     │
                    │ ┌───────────────┐ │
                    │ │ Firestore      │ │
                    │ │ inventory_v2/ │ │
                    │ │   b1/items   │ │
                    │ │   b2/items   │ │
                    │ │   b3/items   │ │
                    │ │   personel/  │ │
                    │ │   purchaseOr│ │
                    │ │   tasks/     │ │
                    │ │   requests/  │ │
                    │ │   ...        │ │
                    │ ├───────────────┤ │
                    │ │ Storage       │ │
                    │ │ (dosya upload)│ │
                    │ ├───────────────┤ │
                    │ │ Auth          │ │
                    │ │ (Email/Pwd +  │ │
                    │ │  Anonymous)   │ │
                    │ └───────────────┘ │
                    └───────────────────┘
```

### VERİ YAPISI (Firestore)
- **Root**: `inventory_v2/{collectionName}/items/{docId}`
- **Koleksiyonlar**: b1, b2, b3, personel, productTypes, purchaseOrders, serviceRecords, staff, units, locations, tasks, requests, assignments
- **Sistem Ayarları**: `system_config/admin_settings` (admin hash), `settings/productTypes`
- **Workflow**: `workflowTemplates/` (EBYS şablonları)

---
## 3. GLOBAL STATE HARİTASI (window.* namespace)

| Global Değişken | Tanımlandığı Dosya | Amaç |
|----------------|-------------------|------|
| `window.data` | firebase-handler.js, script.js, admin-dashboard.js, purchase-servises.js | **MERKEZİ VERİ DEPOSU** — Tüm koleksiyon verileri burada. Çoklu tanım riski var. |
| `window.userAuth` | firebase-handler.js | Firebase Auth kullanıcı objesi (null = anonim) |
| `window.currentUser` | script.js | Kullanıcı adı/role bilgisi (localStorage'dan) |
| `window.firebaseApp` | firebase-handler.js | Firebase App instance |
| `window.fireDb` | firebase-handler.js, admin-dashboard.js | Firestore instance (duplicate assignment) |
| `window.isFirebaseLoaded` | firebase-handler.js, script.js | Veri yüklendi flag'i |
| `window._dbMirror` | firebase-handler.js | Firebase'den gelen verinin deep copy'si (diffing için) |
| `window.fbFunctions` | firebase-handler.js, admin-dashboard.js | Firebase modül referansları (duplicate) |
| `window.FirebaseModules` | admin-dashboard.js | Firestore fonksiyon referansları (doc, setDoc, updateDoc...) |
| `window.isAdminPanel` | script.js, admin-purchase-render.js | Admin sayfası kontrolü |
| `window._cardViewActive` | script.js | Kart/Tablo görünüm state'i |
| `window._selectedRows` | script.js | Seçili satırlar set'i |
| `window._launchpadTriggered` | script.js, timer.js | Launchpad tek seferlik tetikleme |
| `window._launchpadGateInitDone` | script.js | Launchpad gate init guard |
| `window.SessionConfig` | timer.js | Oturum süre ayarları |
| `window.sessionTimer` | timer.js | Oturum zamanlayıcı referansı |
| `window.SecurityConfig` | security.js | Auth fonksiyonları |
| `window.purchaseState` | purchase-servises.js | Satın alma sayfalama state'i |
| `window.inventoryManagementModule` | inventory-management.js | Zimmet modülü (IIFE pattern) |
| `window.todoModule` | todo-module.js | Görev modülü (IIFE pattern) |
| `window.LoadingCoordinator` | admin-dashboard.js | Admin yükleme koordinatörü |
| `window.WorkflowEngine` | edm-workflow.js | EBYS workflow state machine |

---
## 4. 🚨 KRİTİK GÜVENLİK AÇIKLARI

### [S-01] 🔴 API KEY AÇIĞI — firebase-handler.js:23-31
```javascript
const firebaseConfig = {
    apiKey: "AIzaSyBU2JiWfVpbPqL6MPD7phiGdxbolttHA68",
    authDomain: "medipol-envanter.firebaseapp.com",
    // ...
};
```
**Risk**: API key client-side'te. Firebase Security Rules ile kısıtlansa bile, projectId açıkta.
**Soru**: Firestore Security Rules'u gördüm mü? Rules'da anonymous read izni var mı? Eğer varsa, herhangi biri anonim olarak tüm veriyi okuyabilir.

### [S-02] 🔴 "GÖRÜNMEZ E-POSTA İLLÜZYONU" GÜVENLİK ZAFİYETİ — security.js:11-17
```javascript
const adminEmail = "admin@medipol.local";
const paddedPassword = "0" + password;
await signInWithEmailAndPassword(auth, adminEmail, paddedPassword);
```
**Risk 1**: Admin e-postası kaynak kodunda açıkta. Herkes bu bilgiye erişebilir.
**Risk 2**: "0" padding stratejisi geri-dönüşülebilir. `password = realPassword.substring(1)` ile orijinal şifre elde edilir.
**Risk 3**: Firebase Auth şifre politikası "en az 6 karakter" zorunluluğu için padding yapıldığı yazıyor, ama bu yüzden 5 haneli şifrenin önüne "0" konuluyor → Toplam 6 karakter. Saldırgan deneme alanını biliyor.
**Soru Muhammed**: Bu "Görünmez E-posta" yaklaşımı Blaze planını atlatmak için mi? Neden Custom Token veya Cloud Functions çözümü değerlendirilmedi? Ücretsiz (Spark) planda signInWithEmailAndPassword zaten çalışıyor, padding'e gerek yok — doğru mu anlıyorum?

### [S-03] 🟡 ADMIN HASH KARŞILAŞTIRMASI CLIENT-SIDE — firebase-handler.js:44
```javascript
if (hashedInput === SecurityConfig.getAdminHash()) {
```
**Risk**: Hash karşılaştırması client-side. Kaynak kodu incelenerek `SecurityConfig.getAdminHash()` dönen değer görülebilir. Doğrudan hash'i localStorage'a yazarak bypass edilebilir.
**Not**: `loginAsAdmin` fonksiyonu firebase-handler.js içinde tanımlı ama `SecurityConfig.getAdminHash()` fonksiyonu güvenlik dosyasında yok (security.js'de sadece `authenticate` ve `logout` var). Bu bir **undefined function hatası** olabilir. Muhammed, `getAdminHash` ve `hash` fonksiyonları hangi dosyada tanımlı?

### [S-04] 🟡 ANONİM AUTH FALLBACK — firebase-handler.js:321-327
```javascript
await signInAnonymously(auth);
```
**Risk**: Auth başarısız olursa sistem otomatik anonim oturum açıyor. Anonim oturum hangi yetkilerle Firestore'a erişiyor? Eğer read-only değilse, anonim kullanıcı yazma yapabilir.
**Soru**: Security Rules'da anonymous auth için yazma engellenmiş mi?

### [S-05] 🟡 BACKUP RESTORE YOLU YANLIŞ — admin-backup.js:121-125
```javascript
await setDoc(doc(window.fireDb, key, id), item);
```
**Bug**: Restore fonksiyonu `inventory_v2/{col}/items/{id}` yolu yerine `inventory_v2/{col}/{id}` (alt koleksiyon atlıyor) yazıyor. Bu, restore edilen verilerin normal akışta hiç okunamamasına sebep olur. Ayrıca `window.FirebaseModules` bağımlılığı var ama bu obje sadece admin-dashboard.js'te tanımlı (module scope).

### [S-06] 🟡 XSS RİSKİ — Çoklu Dosya
Template literal'lerde kullanıcı girdisi doğrudan HTML'e enjekte ediliyor:
```javascript
// script.js:1101
data-name="${(item.ürün || item.name || '-').replace(/"/g, '&quot;')}"
// Sadece çift tırnak escape edilmiş, <script> ve onclick injection'a karşı koruma yok.
```
**Soru**: Ürün adına `<img src=x onerror=alert(1)>` yazılırsa ne olur?

### [S-07] 🟡 TIMING ATTACK RİSKİ — timer.js:17-24
```javascript
const isActuallyAdmin = isAdminPath || isAdminAuth;
```
**Risk**: `isAdminPath` sadece URL kontrolü ile admin olunabiliyor. `admin.html` sayfasına direkt erişim + `admin_auth` localStorage'a manuel yazma ile yetki aşılabilir. Gerçek koruma Firebase Auth'ta ama bu kontrol zayıf.

---
## 5. 🔧 MİMARİ VE KOD KALİTESİ SORUNLARI

### [A-01] 🔴 4829 SATIRLIK MONOLİT — script.js
**Sorun**: Tek dosyada auth, routing, render, CRUD, arama, sıralama, paginasyon, kart görünüm, tooltip, sepet, FAB, PDF export, Excel export hepsi bir arada. SRP (Single Responsibility Principle) ihlali.
**Etki**: Bakım zorluğu, merge çakışması riski, test edilememe.
**Öneri**: En azından şu modüllere ayır:
- `auth-flow.js` — Login/logout/checkAuth
- `table-renderer.js` — renderTable, renderExitTable, pagination
- `card-view.js` — Kart görünüm sistemi
- `search-sort.js` — Arama, sıralama, filtreleme
- `exit-cart.js` — Çıkış ve sepet modülleri
- `product-crud.js` — Ürün ekleme/düzenleme/silme

### [A-02] 🔴 GLOBAL STATE KİRİLİĞİ — window.* AŞIRI KULLANIMI
**Sorun**: 20+ global değişken. İsim çakışması, debug zorluğu, test edilememe.
**Özel Not**: `window.data` en az 4 dosyada (`firebase-handler.js`, `script.js`, `admin-dashboard.js`, `purchase-servises.js`) yeniden tanımlanıyor/controls ediliyor. Bu, izlenemeyen yan etkilere sebep olabilir.

### [A-03] 🟡 KARIŞIK MODÜL SİSTEMLERİ
**Sorun**: Aynı projede 3 farklı yükleme stratejisi:
1. `<script>` (global) — script.js, timer.js, security.js, alert.js
2. `<script type="module">` (ES Module) — firebase-handler.js, admin-dashboard.js, edm-workflow.js, purchase-servises.js, inventory-management.js
3. `window.xxx = { ... }` (Namespace IIFE) — todo-module.js, inventory-management.js

**Etki**: Yükleme sırası belirsizliği. Module dosyalar global scope'a yazdığı için module avantajı sıfırlanıyor. Import/export anlamsızlaşıyor.

### [A-04] 🟡 DUPLİKATE KOD ve TANIMLAR
| Sorun | Konum | Detay |
|-------|-------|-------|
| `var data = window.data;` 2 kez | script.js:44,46 | Redundant declaration |
| `window.fbFunctions` 2 kez tanımlı | firebase-handler.js:333, admin-dashboard.js:173 | İkinci tanım birinciyi ezer |
| `window.fireDb` 2 kez atanıyor | firebase-handler.js:86, admin-dashboard.js:178 | Gereksiz re-assignment |
| `window.isAdminPanel = true` 2 kez | admin-purchase-render.js:139, admin-dashboard.js:170 | Redundant |
| `window.data` init 3+ kez | script.js:93-95, admin-dashboard.js:180-182, purchase-servises.js:18-19,45-46 | Her dosya kendi init'ini yapıyor |
| `console.log("🚀")` ve `console.log("🚀 purchase-services.js yüklendi")` | purchase-servises.js:23,41 | Production'da kalacak debug logları |
| `renderTable` innerHTML bloğu | script.js:1074-1092 vs 1274-1292 | Aynı tablo HTML yapısı 2 kez yazılmış (DRY ihlali) |

### [A-05] 🟡 B3 GİRİŞ ŞEMASI UYUMSUZLUĞU
**`addExit()` (script.js:607-617)**:
```javascript
{ id, raf, ürün, tür, sn, not, personel, tarih, kaynakDepo }
```
**`saveExit()` (script.js:1540-1552)**:
```javascript
{ id, rafNo, urunTuru, urunAciklama, sn, adet, not, alanKisi, tarih, isDemirbas, kaynakDepo }
```
**Sorun**: Aynı B3 koleksiyonuna 2 farklı şema ile yazılıyor. Bu, `renderExitTable()`'da alan eksikliği ve `inventory-management.js`'in normalizasyonunda veri kaybına yol açar. **Bu kesinlikle birleştirilmelidir.**

### [A-06] 🟡 LOADER KOORDİNATÖRÜ EŞLEŞME HATASI — admin-dashboard.js:90
```javascript
expectedCollections: ["b1", "b2", "b3", "requests", "purchaseOrders", "serviceRecords", "settings"]
```
Fakat `firebase-handler.js:110`'daki koleksiyon listesi:
```javascript
['b1', 'b2', 'b3', 'personel', 'productTypes', 'purchaseOrders', 'serviceRecords', 'staff', 'units', 'locations', 'tasks', 'requests', 'assignments']
```
`personel`, `productTypes`, `staff`, `units`, `locations`, `tasks`, `assignments` LoadingCoordinator'da yok. `settings` ise firebase-handler'da yok (ayrı bir onSnapshot ile dinleniyor — admin-dashboard.js:336). Bu uyuşmazlık, admin panelinin **zaman aşımına uğramasına (4sn fallback)** ve "zorla açılmasına" sebep olabilir.

### [A-07] 🟡 `showCustomConfirm` BUG — alert.js:131
```javascript
function showCustomConfirm(title, message) {
    // ...
    if(btnType === 'danger') {  // ← btnType TANIMSIZ!
```
`btnType` parametresi fonksiyon imzasında yok. Bu her çağrıda `ReferenceError` fırlatır. Muhammed, bu fonksiyonu sonradan mı ekledin? `btnType` parametresini eklemeyi unutmuş olabilirsin.

---
## 6. ⚡ PERFORMANS SORUNLARI

### [P-01] 🔴 INNERHTML OVERKILL
Neredeyse tüm render fonksiyonları `tbody.innerHTML = rowsHtml.join('')` kullanıyor. 1000+ ürün olduğunda:
- Tüm DOM ağacı yok olup yeniden oluşturulur
- Scroll pozisyonu kaybolur
- Event listener'lar yeniden bağlanır
- Tarayıcı reflow/repaint maliyeti artar

**Öneri**: `DocumentFragment` + `createElement` veya en azından `requestAnimationFrame` ile bölünmüş render.

### [P-02] 🟡 DEEP COPY HER SNAPSHOT'TA — firebase-handler.js:138
```javascript
window._dbMirror[colName] = JSON.parse(JSON.stringify(items));
```
13 koleksiyon × her değişiklikte O(n) stringify/parse. Büyük veri setlerinde (1000+ ürün) bu ciddi CPU tüketir.

### [P-03] 🟡 saveData TOPLU YAZMA — firebase-handler.js:205-293
`saveData(window.data)` çağrıldığında TÜM koleksiyonlar taranır, diff bulunur ve değişenler yazılır. Tek bir ürün güncellemek bile 13 koleksiyon döngüsü başlatır. Targeted save (`saveData('b1', data)`) var ama birçok yerde hala `saveData(window.data)` kullanılıyor.

### [P-04] 🟡 CHART.JS MEMORY LEAK RİSKİ
`demirbasChartInstance` ve `statsChartInstance` admin-dashboard.js'te yönetiliyor. Ama `renderExitCharts` ve diğer chart render fonksiyonlarında instance yönetimi görmedim. Admin panelinde sekme geçişleri sırasında canvas yeniden oluşturuluyor olabilir.

### [P-05] 🟡 EDM-WORKFLOW BAĞIMSIZ FIRESTORE INSTANCE — edm-workflow.js:3
```javascript
import { doc, setDoc, getDocs, collection, onSnapshot, getFirestore } from "https://...";
const db = getFirestore();
```
`window.fireDb` varken yeni bir `getFirestore()` çağrısı. Gereksiz bağlantı ve potansiyel yapı uyuşmazlığı.

---
## 7. 🧩 VERİ BÜTÜNLÜĞÜ SORUNLARI

### [D-01] 🔴 ÇİFT YAZMA BUG'İ — saveExit() vs addExit()
- `addExit()` (script.js:580): `runStockTransaction()` kullanıyor (atomik) + `saveData('b3', ...)` (hedefli)
- `saveExit()` (script.js:1485): Client-side stok güncelleme + `saveData(window.data)` (TÜM veriyi yazıyor)
- `saveCartExit()` (script.js:1737): Client-side stok güncelleme + `saveData(window.data)` (TÜM veriyi yazıyor)

**Sorun**: `saveExit` ve `saveCartExit` transaction KULLANMIYOR. İki personel aynı anda çıkış yaparsa race condition oluşur.

### [D-02] 🟡 ID ÇAKIŞMA RİSKİ
```javascript
id: Date.now()           // script.js:607, 1541
id: Date.now() + Math.random()  // script.js:1772
id: 'temp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5)  // firebase-handler.js:255
```
3 farklı ID üretim stratejisi. `Date.now()` milisaniye hassasiyetinde — hızlı ardışık işlemlerde çakışma olası. Özellikle `saveCartExit`'te `Date.now() + Math.random()` kullanılıyor ama `Math.random()` float toplaması güvenilir değil.

### [D-03] 🟡 ALAN ADI UYUMSUZLUKLARI
| Anlam | Kullanılan Değişkenler | Dosyalar |
|-------|----------------------|----------|
| Ürün adı | `ürün`, `name`, `urunAciklama` | script.js, inventory-management.js |
| Miktar | `adet`, `qty`, `sarfAdet` | script.js, inventory-management.js |
| Durum | `durumu`, `status` | script.js (b1=durumu, b2=status) |
| Kişi | `personel`, `alanKisi`, `talepEden` | script.js, inventory-management.js |
| Depo | `kaynakDepo`, `sourceRepo` | script.js, inventory-management.js |
| Tür | `tür`, `type`, `prodType`, `urunTuru` | script.js, admin-dashboard.js |

Bu uyumsuzluk normalizasyon fonksiyonlarını karmaşıklaştırıyor ve veri kaybına sebep olabilir.

### [D-04] 🟡 ONAY DURUMU KARMAŞASI
```javascript
const rawDurum = (req.durum || '').trim().toUpperCase();
const isCompleted = rawDurum === 'COMPLETED' || rawDurum === 'TESLİM ALINDI' || rawDurum === 'TESLIM ALINDI';
const isApproved = rawDurum === 'APPROVED' || rawDurum === 'ONAYLANDI';
```
Türkçe/İngilizce karışık durum string'leri. `TESLİM ALINDI` ve `TESLIM ALINDI` (dotsiz İ) ayrı tutulmuş. Bu, Türkçe locale'e bağlı hatalara sebep olabilir.

---
## 8. 🗂️ LEGACY / ÖLÜ KOD

| Dosya | Sorun | Öneri |
|-------|-------|-------|
| `data-loader.js` | 2 satırlık statik seed verisi. Firebase migration'dan sonra anlamsız. | Kaldır |
| `db.js` | IndexedDB wrapper. Artık tüm veri Firebase'de. `window.db` tanımı `fireDb` ile çakışabilir. | Kaldır veya izole et |
| `script.js:1867-1990` | ~120 satırlık yorumlanmış (commented-out) PDF export kodu | Temizle |
| `script.js:1-2` | "GELİŞTİRME MODU" yorum satırları — canlıya alırken silinmeli uyarısı var | Canlıya almadan önce kaldır |
| `admin-backup.js:restoreFirebaseBackup` | `window.FirebaseModules` bağımlılığıyla bozuk restore fonksiyonu | Düzelt veya kaldır |
| `edm-workflow.js:332` | `window.WorkflowEngine?.states?.COMPLETED` — optional chaining ile boş referans kontrolü | Doğru ama states tanımlı mı? |

---
## 9. 📊 YÜKLENME SIRASI ANALİZİ (index.html bazlı)

```
1. dark-mode-toggle.js     ← İlk: data-theme ayarla (flicker prevention)
2. todo-module.js          ← window.todoModule tanımla
3. launchpad.js            ← window.initLaunchpadGate tanımla
4. db.js                   ← IndexedDB aç (asenkron)
5. data-loader.js          ← b1Data statik veri (kullanılmıyor?)
6. alert.js                ← showAppAlert, showCustomConfirm
7. script.js               ← DOMContentLoaded'da checkAuth() çalıştır
8. timer.js                ← window.addEventListener('load') ile timer başlat
9. firebase-handler.js     ← (module) Firebase init + onAuthStateChanged
   └─ Auth başarılı → startRealtimeSync()
   └─ Auth başarısız → signInAnonymously()
```

**Potansiyel Sorun**: `script.js` DOMContentLoaded'da `window.userAuth` bekliyor ama `firebase-handler.js` (module) async yükleniyor. `userAuth` henüz null olduğunda checkAuth() çalışabilir. Bu durumda sistem "no-auth" gate'i gösterir, sonra Firebase auth gelince tekrar tetiklenmesi gerekir — ama ikinci tetikleme mekanizması net görünmüyor.

---
## 10. 🎯 HAKEM ÖNCELİK MATRİSİ

| Öncelik | ID | Kategori | Konu | Etki |
|---------|-----|----------|------|------|
| **P0** | S-02 | Güvenlik | "Görünmez E-posta" auth mekanizması zayıf | Yetki aşımı |
| **P0** | D-01 | Veri | saveExit/saveCartExit transaction kullanmıyor | Race condition → negatif stok |
| **P0** | A-05 | Veri | B3 giriş şeması uyumsuzluğu (addExit vs saveExit) | Veri bütünlüğü |
| **P0** | A-07 | Bug | showCustomConfirm btnType tanımsız → ReferenceError | Onay kutusu çöküyor |
| **P1** | S-03 | Güvenlik | getAdminHash() tanımlı değil (undefined) | Admin login bozuk olabilir |
| **P1** | S-05 | Güvenlik | Backup restore yanlış yol yazıyor | Restore çalışmıyor |
| **P1** | A-06 | Mimari | LoadingCoordinator koleksiyon listesi uyuşmuyor | Admin panel timeout |
| **P1** | D-02 | Veri | ID çakışma riski (Date.now()) | Veri kaybı |
| **P1** | P-03 | Performans | saveData(window.data) tüm koleksiyonları tarar | Gereksiz ağ trafiği |
| **P2** | A-01 | Mimari | script.js 4829 satır monolit | Bakım zorluğu |
| **P2** | A-02 | Mimari | 20+ global değişken | İsim çakışması |
| **P2** | P-01 | Performans | innerHTML ile full DOM rebuild | Büyük veri setlerinde yavaşlama |
| **P2** | D-03 | Veri | Alan adı uyumsuzlukları (ürün/name/adet/qty) | Normalizasyon hataları |
| **P3** | A-04 | Kalite | Duplicate tanımlar ve dead code | Okunabilirlik |
| **P3** | S-06 | Güvenlik | XSS riski (template literal) | Potansiyel script injection |
| **P3** | P-02 | Performans | JSON deep copy her snapshot'ta | CPU tüketimi |

---
## 11. MUHAMMED'E SORULAR (Hakem Modu — Aktif Sorgulama)

1. **`SecurityConfig.getAdminHash()` ve `SecurityConfig.hash()` fonksiyonları nerede tanımlı?** security.js'de sadece `authenticate` ve `logout` var. `loginAsAdmin` (firebase-handler.js:44) bu fonksiyonları çağırıyor ama tanımsız olabilir. Bu fonksiyonları göndermeyi unuttun mu yoksa başka bir dosyada mı?

2. **Firestore Security Rules'ı paylaşır mısın?** Anonim auth'un ne yapabildiğini bilmeden güvenlik analizi tamamlanamaz.

3. **`saveExit()` ve `saveCartExit()` neden `runStockTransaction()` kullanmıyor?** `addExit()` transaction kullanırken diğer iki çıkış fonksiyonu client-side güncelleme yapıyor. Bu bilinçli bir karar mı?

4. **B3 şemasını standardize etmeye hazır mısın?** `addExit` ve `saveExit` tamamen farklı field isimleri kullanıyor. Bu, zimmet modülünün (`inventory-management.js`) normalizasyonunu zorlaştırıyor.

5. **`showCustomConfirm`'a `btnType` parametresi eklemedin mi?** alert.js:131'de `btnType === 'danger'` kontrolü var ama parametre fonksiyon imzasında yok. Bu çalışıyor mu yoksa hiç test edilmedi mi?

6. **Legacy dosyalar (`db.js`, `data-loader.js`) hala kullanılıyor mu?** Eğer değilse, neden projede duruyorlar? Temizlemek istiyor musun?

7. **Module system kararın ne?** Bazı dosyalar ES Module, bazıları global script. Standardize etmek istiyor musun? Tüm dosyaları ES Module'a çevirmek yükleme sırası problemlerini çözebilir ama mevcut global bağımlılıkları kırar.

---
## 12. ÖZET

Antigravity ERP, **Vanilla JS + Firebase V2** teknoloji yığınıyla inşa edilmiş, fonksiyonel açıdan zengin bir envanter yönetim sistemidir. 20 dosya, ~15.000+ satır kod, 13 Firestore koleksiyonu, EBYS workflow motoru, Chart.js dashboard'ları, dark mode, responsive kart/tablo görünümü, sepet sistemi, görev yönetimi ve yedekleme özellikleri içeriyor.

**Güçlü Yanlar**:
- Firebase Realtime Sync ile anlık veri güncelleme
- Atomik transaction ile stok yönetimi (kısmen)
- Sub-collection mimarisi (ölçeklenebilir)
- PubSub event sistemi (onInventoryDataUpdated)
- Chunked batch write (500 limit aşımı önlenmiş)
- LoadingCoordinator ile admin panel yükleme optimizasyonu

**Kritik Eksikler**:
- Auth mekanizması zayıf (client-side hash, sabit e-posta)
- Race condition (saveExit/saveCartExit)
- Veri şeması uyumsuzlukları (B3, alan isimleri)
- 4829 satırlık monolit (script.js)
- Global state kirliliği
- Backup restore bozuk

**Sonraki Adım**: 10 dosyalık ikinci partın incelemesi için bu raporu referans al. P0 ve P1 maddeler ikinci part öncesi veya eşzamanlı olarak ele alınmalı.

---
*Bu rapor, gelecek tüm taleplerde otomatik referans olarak kullanılacaktır.*