📋 MEDIPOL ENVANTER SİSTEMİ — Tek Elden Manifesto & Kod Denetim Raporu

Merhaba. Manifestonuzu aldım, 10 JS dosyanızı (~10.388 satır) satır satır inceledim. Aşağıda tek bir listeleme yapmadan önce, manifesto ile gerçek kod arasındaki uçurumu kategorize ediyorum. Her bulgu: Dosya:Satır + neden sorun + çözüm yönü şeklinde.
🚨 BÖLÜM A — KRİTİK GÜVENLİK ZAFİYETLERİ (Hemen Düzelt)
A1. 🔴 Biyometrik fallback her 5 haneli kodu kabul ediyor

security-biometrics.js:92-110
js
 
  
 
 
const userCode = prompt('...güvenlik kodunu giriniz:');
if (userCode && userCode.length === 5) {   // ← 12345, aaaaa, 00000 hepsi GEÇER
    resolve(true);
}
 
 

Sorun: WebAuthn olmayan cihazlarda (çoğu masaüstü tarayıcı) 2FA tamamen bypass ediliyor. Yukarıdaki expectedCode === challengeCode branch'i ise ölü kod — sessionStorage'a neredeyse hiç yazılmayan bir değer, o an üretilen rastgele kodla karşılaştırılıyor.
Çözüm: expectedCode'u generateBiometricChallenge() ile üretip kullanıcıya bant dışı (e-posta/SMS) gösterin; userCode === expectedCode kontrolü yapın.
A2. 🔴 XOR + base64 = "şifreleme" değil

security-biometrics.js:4-23, 121-153
js
 
  
 
 
const BIOMETRIC_SALT = 'x9k2mP@7vQ3sT1wZ';  // kaynak kodda sabit
function _xorEncrypt(data, salt) { /* charCode XOR */ }
export function maskUserData(obj) { return btoa(_xorEncrypt(...)); }
 
 

Sorun: XOR + statik salt + base64, kaynak kodu okuyan herkes (yani herkes — public web) tarafından geri çevrilir. secureStore('activeUser', ...) bu "maskeleme" ile localStorage'a yazıyor. DevTools konsolundan unmaskUserData(localStorage.getItem('activeUser')) yazmak yeterli.
Çözüm: localStorage'a sadece non-sensitive session ID koyun; user objesi memory'de tutsun. Gerçek şifreleme sunucu tarafında, per-session key ile yapılmalı.
A3. 🔴 Admin yetkisi string karşılaştırmasıyla veriliyor

auth-engine.js:191, 396 ve alert.js:230-231
js
 
  
 
 
const isAdmin = (user.name === 'Muhammed Cer' || user.name === 'Admin');
user = window.data.personel.find(p => p.name === 'Muhammed Cer' || p.name === 'Admin');
 
 

Sorun: DevTools'tan localStorage.setItem('activeUser', JSON.stringify({name:'Admin'})) yazmak tüm admin akışını atlatır.
Çözüm: Admin yetkisi Firebase Custom Claims ile sunucuda verilip her korumalı işlemde user.getIdTokenResult() ile doğrulanmalı. Client-side name kontrolü tamamen kaldırılmalı.
A4. 🔴 admin_auth expiry 3 farklı yerde 3 farklı değer

firebase-handler.js:83 (3 dk) · auth-engine.js:464, 567 (10 dk) · alert.js:225 (180 dk = 3 saat)
Sorun: Aynı localStorage anahtarı için 3 farklı süre. alert.js'taki adminBypassMaintenance yolu tek kod girişiyle 3 saat admin oturumu veriyor — "vize" konseptiyle çelişiyor.
Çözüm: Tek sabit: auth-engine.js'te export const ADMIN_SESSION_MS = 5 * 60 * 1000; her yerden import edilsin.
A5. 🔴 Anonim auth + muhtemel gevşek Firestore kuralları

firebase-handler.js:516-519 — sayfayı ziyaret eden herkes anonim oturum açıp personel, purchaseOrders, units, locations koleksiyonlarını dinliyor.
Sorun: Firestore Security Rules dosyaları yüklenenler arasında yok. Kurallar gevşekse, URL'yi bilen herkes tüm personel ve satın alma geçmişini çekiyor.
Çözüm: Anonim auth sadece personel koleksiyonunu (login için) okusun; diğer her şey gerçek authentication sonrası açılsın. Kuralları mutlaka ekleyin.
A6. 🔴 innerHTML ile güvenilmeyen veri enjeksiyonu (Stored XSS)

alert.js:58, 139 · purchase-servises.js:36, 392, 398, 402 · admin-dashboard.js:285-292, 1574
Sorun: Firestore'dan gelen item.evrakNo, item.talepEden, item.urun, file.name gibi alanlar HTML'e direkt interpolate ediliyor. Bir personel <img src=x onerror=alert(1)> adında ürün eklerse, admin paneli açıldığı an XSS çalışır.
Çözüm: Tüm veri interpolasyonu için textContent veya escapeHtml() yardımcı fonksiyonu. onclick="openWatchDetail(${JSON.stringify(item)})" (admin-dashboard.js:1574) yerine data-* attribute + addEventListener.
🏗️ BÖLÜM B — MANİFESTO MİMARİ İHLALLERİ (Ajan Sınır Çakışmaları)
İhlal
	
Dosya
	
Hangi Ajanın Sınırı
	
Gerçek Sahip
/ui dosyası Firebase yazıyor	ui-components.js:362 (confirmTransfer)	Gemini Flash / Laguna	Sonnet (/services)
/ui dosyası Firebase yazıyor	admin-dashboard.js:588, 626, 698 (addDoc/updateDoc/deleteDoc)	Gemini Flash	Sonnet
productTypes root koleksiyona yazıyor (env-guard bypass)	admin-dashboard.js:588, 626, 698	—	DeepSeek (kurallar)
God-file: 2.568 satır	edm-workflow.js (tümü)	Tüm ajanlar	Parçalanmalı
/services dosyası HTML üretiyor	purchase-servises.js:381-503	Sonnet	Laguna
prompt() red akışında	edm-workflow.js:1027	DeepSeek (algoritma)	Gemini Flash (UI)
alert.js admin authenticate ediyor	alert.js:214-241 (adminBypassMaintenance)	Gemini Flash	Sonnet
edm-workflow.js state machine + Firebase + UI tek dosyada	edm-workflow.js:1527 (WorkflowEngine) + :646 (viewWorkflow HTML) + :2283 (setDoc)	Karışık	3'e bölünmeli
  
B1. 🔴 edm-workflow.js — Manifestonun En Büyük İhlali

Tek dosyada dört ajanın sorumluluğu var:

     DeepSeek (algoritma): WorkflowEngine, ParallelWorkflowEngine, WorkflowRollbackManager (state machine + transition engine)
     Sonnet (/services): setDoc/deleteDoc ile Firebase yazma (satır 2283, 2319)
     Gemini Flash (UI): viewWorkflow, renderManualSteps, renderMyApprovals (modal HTML üretimi)
     Laguna (/components): Personel arama dropdown UI (satır 448)

Çözüm: 

     /services/workflow-engine.js → DeepSeek
     /services/workflow-repo.js → Sonnet
     /ui/workflow-ui.js → Gemini Flash + Laguna

B2. 🔴 window.AppModules yarım bırakılmış — script.js köprüleri ölü kod

script.js:131-287'de onlarca köprü var:
js
 
  
 
 
window.checkIsAdmin = window.checkIsAdmin || function () {
    return window.AppModules?.Auth?.checkIsAdmin ? window.AppModules.Auth.checkIsAdmin() : false;
};
 
 

Ama hiçbir dosya AppModules.Auth, AppModules.Table, AppModules.Inventory, AppModules.Utils'i set etmiyor. Sadece ui-components.js:741 AppModules.UI'yi set ediyor. Yani tüm köprüler false/no-op fallback'e düşüyor. Bu "ne var ne yok güvenli çağır" deseni, aslında manifestonun uygulanmadığını gizleyen bir duman perdesi.

Çözüm: İki seçenek:

    Tut: Her dosya AppModules.{Namespace} set etsin; script.js köprüleri kalsın.
    Sil: AppModules konseptini bırak; her dosya window.* kullanmaya devam etsin ama bu defa header'da dependency listesi yazsın (auth-engine.js gibi).

B3. 🔴 ESM / klasik script karma — dual-exposure kaosu

     ESM (import/export): firebase-handler.js, auth-engine.js, ui-components.js, admin-dashboard.js, edm-workflow.js, purchase-servises.js
     Klasik (window.X =): alert.js, script.js
     İkisi birden (export const X = window.X =): firebase-handler.js:381, 592, security-biometrics.js

Daha kötüsü: admin-dashboard.js:336 dosya ortasında import { onSnapshot as onDocSnapshot } çağrısı yapıyor — bu geçersiz ESM; gerçek module loader bunu reddeder.

Çözüm: Tek strateji seçin. <script type="module"> + saf ESM öneririm; tüm window.* pollution temizlensin.
🐛 BÖLÜM C — RUNTIME CRASH & KOD HATALARI
C1. 🔴 script.js undefined değişkenlere referans veriyor
js
 
  
 
 
// script.js:437 (addPersonel)
window.saveData(data);   // ← `data` undefined; `window.data` olmalı

// script.js:447 (editPersonel)
window.saveData(data);   // ← aynı bug

// script.js:1218 (loadFromDB)
if (!db) { setTimeout(() => window.loadFromDB(storeName).then(resolve), 100); }
// ← `db` hiçbir yerde tanımlı değil; sonsuz polling

// script.js:1235 (initData)
data = loadData();   // ← strict mode'da ReferenceError
 
 

Sorun: addPersonel ve editPersonel runtime'da ReferenceError fırlatır, personel yönetimi sessizce kırılır. loadFromDB/initData görünüyor ki IndexedDB döneminden kalma ölü kod.
Çözüm: data → window.data; loadFromDB/initData/loadData tamamen silinsin.
C2. 🔴 admin-dashboard.js:186-189 appsiz getFirestore() çağrısı
js
 
  
 
 
if (!window.fireDb) {
    window.fireDb = getFirestore();   // ← "No Firebase App['[DEFAULT]'] initialized" hatası
}
 
 

firebase-handler.js initializeFirestore(app, {...}) kullanıyor (default app yok). Bu satır çalışırsa patlar. Çözüm: Blok silinsin; window.fireDb tek source of truth.
C3. 🔴 Triple-duplicate fonksiyonlar (load-order ruleti)

     closePurchaseModal: purchase-servises.js:1000 + :1563 + edm-workflow.js:66 — 3 farklı versiyon, son yüklenen kazanır.
     showCustomConfirm: alert.js:125 + script.js:1168 — alert.js versiyonunda btnType parametresi yok ama referans veriyor (ölü branch).
     openNewPurchaseModal: purchase-servises.js:54 + edm-workflow.js:55 — farklı davranış.
     window.data init: script.js:32 + firebase-handler.js:131 + admin-dashboard.js:182 + purchase-servises.js:18 — 4 farklı şema.

Çözüm: Her fonksiyon tek canonical dosyada; window.data sadece firebase-handler.js'te (veya yeni state.js) init edilsin.
C4. 🔴 State mutation — manifesto "mutation-free" diyor, kod tam tersini yapıyor

firebase-handler.js:183-185
js
 
  
 
 
window.data[colName] = items;   // ← her snapshot'ta tam dizi değişimi
 
 

changesPayload (satır 167-175) zaten toplanıyor ama state mutasyonu için kullanılmıyor. Manifesto "mutation-free (__index preserved)" diyor — bu direkt ihlal.
Çözüm: Patch-based state güncelleme: changes.forEach(c => patchItem(c)).
C5. 🔴 Patch altyapısı var ama hiçbir consumer kullanmıyor

firebase-handler.js:195-201 isPatch ve changes dispatch ediyor. Ama:

     purchase-servises.js:1623-1632 her event'te renderServicesModule() (tam tablo rebuild) çağırıyor.
     admin-dashboard.js:144-147 her event'te renderDashboardStats + renderCriticalStockTable çağırıyor.

1000+ item'da (v3.1 ölçeği) bu UI jank'i üretir.
Çözüm: patchDOMForCollection(colName, changes) (script.js:182'de köprü var ama bağlı fonksiyon yok) gerçek implemente edilsin; data-id attribute ile tek satır güncelleme.
C6. 🟠 Performans: innerHTML += forEach içinde

admin-dashboard.js:279-314, 481-507, 511-540 — her iterasyonda tüm tablo yeniden parse + reflow. 100 kayıtta 100 reflow.
Çözüm: rows.push(...) → tableBody.innerHTML = rows.join('').
C7. 🟠 Diğer kalite sorunları (özet)

     setInterval(updateUI, 1000) ID'si saklanmıyor → memory leak (admin-dashboard.js:1721)
     window.onload = (admin-dashboard.js:1664) önceki handler'ı eziyor
     substr deprecated (firebase-handler.js:437,556, edm-workflow.js:1564,1934,2422, script.js:458)
     13-element koleksiyon listesi 3 yerde hardcoded (firebase-handler.js:156,399,539)
     purchase-servises.js:344-345 debug filter: if (item.evrakNo?.includes('8146')) — production kodunda spesifik evrak no'ya koşullanmış debug
     admin-dashboard.js:932-990 60 satır yorum satırı renderCriticalStockTable — git history'de olmalı, source'da değil
     admin-dashboard.js:1940-1948 [DECOMMISSIONED] no-op fonksiyon + hemen tetikleme — absürt

🔗 BÖLÜM D — DOSYALARARASI BAĞIMLILIK KAOSU
D1. 🔴 Her dosya window.* okuyor, neredeyse hiçbiri header'da bildirmiyor

auth-engine.js header'ı (satır 17-23) tek örnek — bağımlılıkları listeliyor. Diğer 9 dosya gizli runtime bağımlılıklarıyla dolu. purchase-servises.js okuyor: window.saveData, window.currentUser, window.data, window.uploadFiles, window.renderPurchaseModule, window.WorkflowEngine, window.isAdminPanel, ve çıplak globaller: showAppAlert, showCustomConfirm, refreshUI.
D2. 🔴 getFirestore isim çakışması

edm-workflow.js:5 const getFirestore = () => window.fireDb; tanımlıyor. Bu, admin-dashboard.js:3'te SDK'dan import edilen getFirestore'u gölgeliyor. Copy-paste yapılırsa sessizce kırılır — admin-dashboard.js:188 hatasının (C2) bir nedeni de bu.
D3. 🟠 Monkey-patching window.showAdminTab

edm-workflow.js:2332-2338 orijinali yakalayıp sarmalıyor. Load-order'a bağımlı — admin-dashboard.js sonra yüklenirse orijinal kayboluyor. Event tabanlı yapı (zaten var olan onInventoryDataUpdated) kullanılmalı.
D4. 🟠 saveData overloading — tip imzası yok

saveData(window.data) (tam obje) ve saveData('purchaseOrders', window.data.purchaseOrders) (hedefli) — iki form. Yorumla dokümante, imzayla değil. Yanlış çağırırsanız sessizce yanlış yere yazıyor.
Çözüm: saveAll(data) + saveCollection(colName, items) — iki ayrı fonksiyon.
📊 BÖLÜM E — DOKÜMANTASYON & SÜRDÜRÜLEBİLİRLİK
E1. 🔴 6/10 dosyada header yok

purchase-servises.js, edm-workflow.js, admin-dashboard.js, admin-purchase-render.js, alert.js, security-biometrics.js — purpose/dependencies/exports/agent owner bilgisi yok. Yeni bir ajan edm-workflow.js'i anlamak için 2.568 satır okumak zorunda.
Standart: auth-engine.js ve ui-components.js header'ları model alın — Purpose + Dependencies + Exports + Agent Owner + [DECOMMISSIONED] notları.
E2. 🟠 // [WHY] / // [HOW] tutarsız

     firebase-handler.js, auth-engine.js, ui-components.js: neredeyse her fonksiyonda var ✓
     purchase-servises.js: sadece Bug-4 fix bloğunda (40+ fonksiyondan 1'inde)
     alert.js: 2 fonksiyonda
     admin-dashboard.js: neredeyse hiç yok
     Format bile 3 çeşit: // [WHY]: (firebase-handler), * [WHY]: (JSDoc, auth-engine), // [WHY] (kolonsuz, edm-workflow)

E3. 🟠 [BUGFIX] Bug N merkezi takipsiz

"Bug 1"–"Bug 8" işaretleri dosyalara serpiştirilmiş ama CHANGELOG.md yok. purchase-servises.js:48'deki "Bug 4" ile edm-workflow.js:17'deki "Bug 2" aynı numaralama mı? Belli değil.
Çözüm: CHANGELOG.md açın; Bug N → açıklama → commit map'leyin. Veya Bug N sonekini bırakıp sadece [BUGFIX] kısa_açıklama kullanın.
E4. 🟠 [DECOMMISSIONED] no-op birikimi

auth-engine.js:292, 338, 475 + admin-dashboard.js:1940-1948 + firebase-handler.js:243. admin-dashboard.js:1940 özellikle absürt: no-op fonksiyon tanımlanıp hemen çağrılıyor.
Çözüm: Silin. HTML'de hala onclick referansı varsa, console.warn("v3.2'de kaldırıldı, HTML güncelleyin") stub'ı kalsın.
E5. 🟡 Dosya adı typo: purchase-servises.js

"services" olmalı. Dahası edm-workflow.js:143 bu dosyayı ebys-workflow.js olarak yorumluyor — var olmayan bir isim. Migration/arama zaman kaybı.
🎯 BÖLÜM F — SÜREÇ İYİLEŞTİRME PLANI (4 Faz)
🚨 FAZ 1 — Acil Stabilizasyon (1-2 gün, tek ajan bile yapabilir)

Hedef: Production crash ve kritik güvenlik açıkları.

    A1 fix: security-biometrics.js:92-110 — fallback akışını expectedCode ile gerçek karşılaştırmaya çevir.
    A3 fix: Tüm user.name === 'Muhammed Cer' kontrollerini kaldır; Firebase Custom Claims geçişi başlat (backend tarafında).
    A4 fix: ADMIN_SESSION_MS sabitini auth-engine.js'te tanımla; 4 yeri import et.
    C1 fix: script.js:437, 447 → window.data; loadFromDB/initData/loadData ölü kodu sil.
    C2 fix: admin-dashboard.js:186-189 blok sil.
    C3 fix: closePurchaseModal, showCustomConfirm, openNewPurchaseModal duplikasyonlarını tek canonical versiyonda birleştir.
    A5 doğrula: Firestore Security Rules'ı getir ve denetle; anonim auth'ın kapsamını daralt.

🛠️ FAZ 2 — Ajan Sınır İhlallerini Düzeltme (1 hafta)

Hedef: Manifestonun /ui ↔ /services ayrımı gerçek olsun.

    B1 parçalama: edm-workflow.js (2.568 satır) → 3 dosya:
         /services/workflow-engine.js (DeepSeek: state machine + transition)
         /services/workflow-repo.js (Sonnet: Firebase read/write)
         /ui/workflow-ui.js (Gemini Flash + Laguna: modal/render)
    B2 parçalama: purchase-servises.js → purchaseService.js (data) + purchaseRender.js (UI).
    ui-components.js:362 (confirmTransfer): /services/transfer.js'e taşı; UI sadece form state toplasın.
    admin-dashboard.js:588/626/698 (productTypes CRUD): /services/product-types.js'e taşı; critically COLLECTION_ROOT/items pattern'ine geçir (env-guard bypass'ı kapat).
    alert.js:214-241 (adminBypassMaintenance): auth-engine.js'e taşı; alert.js sadece toast/modal render yapsın.
    A6 fix: Tüm innerHTML interpolasyonlarına escapeHtml() uygula; onclick inline yerine addEventListener.

🏗️ FAZ 3 — Mimari Tutarlılık (2-3 hafta)

Hedef: window.AppModules konsepti gerçek çalışsın, ESM stratejisi netleşsin.

    Karar ver: AppModules live mı dead mi?
         Live: Her dosya AppModules.{Namespace} set etsin; script.js köprüleri dokunmatik kalsın.
         Dead: AppModules konseptini resmen kaldır; her dosya window.X = kullanır ama header'da dependency listesi yazar.
    ESM stratejisi: <script type="module"> + saf import/export. Tüm window.X = X dual-exposure kaldırılsın. admin-dashboard.js:336'daki geçersiz mid-file import düzeltilsin.
    saveData overloading ayrımı: saveAll() + saveCollection().
    window.data tek source: state.js modülü, tam şema ile init etsin; diğer dosyalar sadece okusun.
    C4/C5 patch altyapısı: patchDOMForCollection gerçek implemente edilsin; onInventoryDataUpdated consumer'ları e.detail.changes kullansın, tam re-render yapmasın.
    C6 performans: innerHTML += → rows.join('').
    Header standardı: 6 headerless dosyaya auth-engine.js modelinde header ekle.
    [BUGFIX] Bug N ve [DECOMMISSIONED] temizliği: CHANGELOG.md + ölü no-op'lar silinsin.

🚀 FAZ 4 — Ölçeklenebilirlik ve Otomasyon (1+ ay)

Hedef: Manifesto otomatik uygulanabilir hale gelsin.

    Lint kuralı: ESLint custom rule — /ui/**/*.js içinde setDoc/updateDoc/deleteDoc/writeBatch import yasak.
    Lint kuralı: // [WHY] ve // [HOW] olmayan fonksiyonlarda warning.
    Pre-merge gate: Llama (Security Auditor) sadece review yapar ama merge yetkisi yok. CI pipeline'da Llama otomatik çalışsın, bulgular varsa PR block.
    CI: bun run lint + test + typecheck (JSDoc ts checked) her PR'da.
    Firebase Functions: Admin yetkilendirme, e-posta gönderimi (EmailJS yerine), kritik işlemler sunucuda.
    13+ onSnapshot listener konsolidasyonu: İlgili koleksiyonları tek sorguda birleştir; includeMetadataChanges: false.
    edm-workflow.js:1166 itiraf: renderMyApprovals doğru evine (yeni my-approvals.js) taşınır.

📝 BÖLÜM G — MANİFESTONUN KENDİSİNDEKİ SORUNLAR

Manifesto iyi niyetli ama uygulanabilirlik açısından zayıf. Düzeltme önerileri:
G1. Ajan rol çakışmaları

     Sonnet hem "Master Architect" hem /services sahibi hem de "futuristic UI/UX overarching designs". Bu üç farklı kafa modu. Öneri: UI/UX vizyonunu Gemini Pro (CTO) veya ayrı bir "Design Architect" rolüne ver; Sonnet sadece /services + app.js'te kalsın.
     DeepSeek "ABSOLUTELY NO UI/UX interaction" diyor ama edm-workflow.js'te state machine üretiyor ve aynı dosyada UI var. Öneri: DeepSeek'in output'u zorunlu olarak ayrı dosyaya yazılsın (örn. /algorithms/*.js); UI dosyaları DeepSeek output'unu sadece import edebilir.
     Qwen "primary executor" + "do not invent architectural rules" ama Llama "auditor, not initial creator". Qwen yazıyor, Llama denetliyor — ama merge öncesi gate manifesto'da tanımlı değil. Öneri: "Llama onayı olmadan Qwen commit edemez" kuralı net yazılsın.

G2. Eksik: Merkezi Sözlük (Naming Convention)

Manifesto window.AppModules diyor ama alt namespace'leri (Auth, Table, Inventory, Utils, UI, Services...) listelemiyor. Bu yüzden her dosya kendi keyfince window.* atıyor. Öneri: Manifestoya ek —
text
 
  
 
 
window.AppModules = {
  Auth, Services, UI, Components, Utils, Algorithms, Config
}
 
 

Her dosya bir namespace'in altına yazmak zorunda.
G3. Eksik: Dependency Declaration Zorunluluğu

Sadece auth-engine.js header'da dependency listeliyor. Öneri: Manifestoya:

     

    "Her dosyanın ilk 30 satırında DEPENDENCIES (window.*): bloğu ZORUNLU. Listede olmayan window.* değişkeni okumak lint hatası."

G4. Eksik: "3-Step Plan" formatı net değil

Manifesto "Always provide a 3-step plan before execution" diyor ama format vermiyor. Öneri:
text
 
  
 
 
## 3-STEP PLAN
1. [Hedef dosya/değişiklik] — Hangi ajanın sınırı
2. [Etki edilecek bağımlılıklar]
3. [Test/görev yöntemi]
 
 
G5. Eksik: Testing Protokolü

Hiçbir yerde "bu değişikliği nasıl doğrularız" yok. Llama "Unit Tests" diyor ama framework belirtilmemiş. Öneri: Vanilla JS için Vitest + jsdom; Firebase için Firebase Emulator Suite.
G6. Çakışan "Save Token" stratejisi

Manifesto "Gemini Flash saves Sonnet's token usage" diyor ama aynı zamanda "DO NOT touch /services folder or execute updateDoc/deleteDoc" diyor. Flash read-only verification yapıyor, yani. Sorun: Read-only bir ajan "frontend execution" yapamaz (frontend execution = DOM mutation = state change). Öneri: "Read-only verification + reporting" ile "frontend execution" ayrı maddeler; Flash sadece ilki.
G7. Eksik: Conflict Resolution Protocol

"Gemini 3.1 Pro: deadlock analysis, inter-agent conflict resolution" diyor ama ne zaman çağrılacağı tanımsız. Öneri: "İki ajan aynı dosyaya değişiklik önerirse → PR blocker → Gemini Pro otomatik çağrılır."

⚠️ Önemli Not

Bu rapor sadece yüklediğiniz 10 dosyaya dayanır. HTML/CSS ve belirttiğiniz "birkaç modül" hariç tutulduğundan, dependency graph eksik olabilir. En kritik dışsal risk: Firestore Security Rules dosyaları yüklenmedi — anonim auth + muhtemel gevşek kurallar kombinasyonu (A5) independent olarak doğrulanmalıdır.