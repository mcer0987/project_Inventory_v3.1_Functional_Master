# `v3.8 Hotfix · HF-2` — Implementation Plan

Active Role: Argon 4 — Kimlik Köprüsü, Anti-Spam Güvenliği & Listener Bütünlüğü

> **Kapsam & İzolasyon:** Bu plan yalnızca `HF-2` sahipliğindeki dosyalara (`script.js`, `personel.js`, `src/services/firebase-handler.js`, `security.js`, `src/utils/staff-lifecycle.js`, `src/services/staff-lifecycle-service.js`, `src/ui/staff-lifecycle-panel.js` ve birim testi `tests/unit/staff-lifecycle.test.mjs`) dokunur. `HF-1` ve `HF-3` dosya kümeleriyle kesişim **sıfırdır**. Yeni üretim dosyası oluşturulmaz (`EXPECTED_COUNT = 140` korunur).

---

## Kök Neden Bulguları

1. **`#tablePersonel` İşlem Düğmelerinin (`Düzenle`, `Geçici PIN`, `Askıya Al`, `Yeniden Aktifleştir`) `admin.html`'de Çalışmaması:**
   - [personel.js](file:///c:/Users/med3pol/Documents/project_Inventory_v3.1_Functional_Master/personel.js) satır içi `onclick="if(validateAdminAction()) ..."` kullanıyor.
   - [script.js](file:///c:/Users/med3pol/Documents/project_Inventory_v3.1_Functional_Master/script.js#L175-L180) içindeki `window.checkIsAdmin` ve `window.validateAdminAction` köprüleri yalnızca `window.AppModules?.Auth` nesnesine bakıyor.
   - Ancak `src/modules/auth-engine.js` yalnız `index.html`'de yüklüdür; `admin.html`'de `window.AppModules.Auth` tanımsız olduğu için `validateAdminAction()` her zaman `false` dönmekte ve tüm buton tıklamalarını sessizce yutmaktadır.

2. **Senaryo 5 Logout Sırasında `⛔ [Güvenlik] purchaseOrders: Firestore okuma yetkisi reddedildi` Konsol Hatası:**
   - [security.js](file:///c:/Users/med3pol/Documents/project_Inventory_v3.1_Functional_Master/security.js#L240-L252) içinde `endAdminSession()` önce `clearSession()` çağırıp ardından asenkron `this.logout()` içinde `await this._auth()` ve `await auth.authStateReady()` bekledikten sonra `stopRealtimeSync()` çağırıyor.
   - Ayrıca [firebase-handler.js](file:///c:/Users/med3pol/Documents/project_Inventory_v3.1_Functional_Master/src/services/firebase-handler.js#L337-L412) içinde `_syncStopping` yalnızca `stopRealtimeSync()` senkron gövdesinde `true` kalıyor; `unsub()` veya `signOut(auth)` sırasında mikro-görev kuyruğundan gelen gecikmeli `onSnapshot` (`purchaseOrders` / `purchaseAccess`) `permission-denied` hatası `_syncStopping === false` gördüğü için `console.error('⛔ [Güvenlik] ...')` basıyor.

3. **Giriş Ekranı Şifre Sıfırlama Taleplerinde İstemci Önü Anti-Spam & Raporlama Eksikliği:**
   - Aynı PRI veya aynı cihazdan art arda tıklamalarda her seferinde Firestore `setDoc` çağrısı deneniyor (`permission-denied` dönse bile ağ isteği gidiyor) ve yönetici ekranında mükerrer deneme sayısı raporlanmıyor.

4. **Lokal Testte (`inventory_demo` @ `127.0.0.1` / `localhost`) Sıfırlama Taleplerinin Listelenmemesi:**
   - Lokal ortamda (`?emu=1` olmadan) bulut Firestore `inventory_demo` köküne bağlanıldığında, `VP-3`'ün yeni `passwordResetRequests` kuralları henüz buluta deploy edilmediği için bulut hem `setDoc` hem `getDocsFromServer` çağrılarını `permission-denied` ile reddediyor.
   - `submitPasswordResetRequest` zero-enumeration gereği `permission-denied`'ı nötr mesajla yuttuğu için talebin kaydedilmediği anlaşılmıyor; `admin.html`'de `listPasswordResetRequests()` da `permission-denied` hatasına düşüyor.

5. **`🔑 Geçici PIN / Giriş Kodu Yenile` Modalı ve Yaşam Döngüsü Kartında Dark Theme Kontrast Sorunu:**
   - [staff-lifecycle-panel.js](file:///c:/Users/med3pol/Documents/project_Inventory_v3.1_Functional_Master/src/ui/staff-lifecycle-panel.js) içinde projede tanımlı olmayan `var(--color-card, #ffffff)` ve `var(--color-input-bg, #fff)` değişkenleri kullanıldığı için `[data-theme="dark"]` altında dahi modal kartları ve form alanları `#ffffff` beyaz zemine düşüyor.

---

## Uygulama Dilimleri

### Dilim 1 — Admin Yetki Köprüsü & `#tablePersonel` Delegasyonu ([script.js](file:///c:/Users/med3pol/Documents/project_Inventory_v3.1_Functional_Master/script.js), [personel.js](file:///c:/Users/med3pol/Documents/project_Inventory_v3.1_Functional_Master/personel.js))
1. **[script.js](file:///c:/Users/med3pol/Documents/project_Inventory_v3.1_Functional_Master/script.js#L175-L180):**
   - `window.checkIsAdmin`: `window.AppModules?.Auth?.checkIsAdmin` yoksa `typeof window.isDbAdmin === 'function' ? window.isDbAdmin() : false` döner.
   - `window.validateAdminAction`: `window.AppModules?.Auth?.validateAdminAction` yoksa `typeof window.requireDbAdmin === 'function' ? window.requireDbAdmin('Bu yönetici işlemi') : false` döner.
2. **[personel.js](file:///c:/Users/med3pol/Documents/project_Inventory_v3.1_Functional_Master/personel.js):**
   - Satır içi `onclick` nitelikleri kaldırılıp CSP uyumlu `data-action` (`personelEdit`, `personelTempPin`, `personelSuspend`, `personelReactivate`, `personelOpenAccount`) + `data-id="${escapeHtml(item.id ?? '')}"` yapısına geçirilir.
   - `window.bindActions(tbody, ...)` ile tek delegasyon kurulur ve her aksiyonda `_guardPersonelAdmin(label)` üzerinden net yetki doğrulaması yapılır.
   - Tablo çizimi sonunda `window.enhanceAdminBentoTables?.()` tetiklenerek mobil Bento `data-label` nitelikleri güncel tutulur.

### Dilim 2 — Logout Sırasında `purchaseOrders` `permission-denied` Yarış Durumunun Kapatılması ([firebase-handler.js](file:///c:/Users/med3pol/Documents/project_Inventory_v3.1_Functional_Master/src/services/firebase-handler.js), [security.js](file:///c:/Users/med3pol/Documents/project_Inventory_v3.1_Functional_Master/security.js))
1. **[security.js](file:///c:/Users/med3pol/Documents/project_Inventory_v3.1_Functional_Master/security.js#L240-L255):**
   - `endAdminSession()` içinde `clearSession()` ve `await this.logout()` çağrılarından hemen önce senkron olarak `window.stopRealtimeSync?.()` çağrılır.
2. **[firebase-handler.js](file:///c:/Users/med3pol/Documents/project_Inventory_v3.1_Functional_Master/src/services/firebase-handler.js#L305-L450):**
   - `_lastSyncStopAt` zaman damgası ve `_syncGeneration` nesil sayacı eklenir.
   - `stopRealtimeSync()` çağrıldığında `_syncGeneration++` ve `_lastSyncStopAt = Date.now()` güncellenir.
   - `reportListenerError(name, err, gen)`: `gen !== _syncGeneration`, `_syncStopping`, `!_syncRunning`, `!window.userAuth`, `!auth.currentUser`, `window.SecurityConfig?._ending` veya `Date.now() - _lastSyncStopAt < 2500` durumunda beklenen oturum kapanışı kabul edilerek `console.error('⛔ [Güvenlik] ...')` ve `#syncPermissionBanner` tetiklenmez.
   - `onAuthStateChanged`: kullanıcı UID değişiminde (`_syncUid !== user.uid`) dinleyicilerin yeni kimlikle temiz yeniden başlatılması garanti edilir.

### Dilim 3 — Şifre Sıfırlama Taleplerinde Sıfır-Maliyetli Anti-Spam & Raporlama ([staff-lifecycle.js](file:///c:/Users/med3pol/Documents/project_Inventory_v3.1_Functional_Master/src/utils/staff-lifecycle.js))
1. **`medipol_reset_guard_v1` Yerel Koruma Motoru (`checkLocalResetGuard`, `recordLocalResetAttempt`, `analyzeResetRequests`):**
   - **Kişi Bazlı 24 Saat Yerel Kilit:** Aynı `pri` için talep gönderildikten sonraki 24 saat boyunca Firestore'a hiç istek atmadan yerelde engeller ve `blockedCount` sayacını artırır.
   - **Cihaz Bazlı Hız Sınırı (Device Flood Protection):** Aynı tarayıcıdan 1 saat içinde en fazla `2` farklı `pri` için talep gönderilebilir; 3. farklı `pri` denemesi sunucuya gitmeden yerelde durdurulur.
   - **Zero-Enumeration Uyumlu Mesaj:** Yerel koruma devreye girdiğinde hesap varlığını sızdırmayan `LOCAL_GUARD_BLOCKED_MESSAGE` döner.
   - **Yönetici Risk Özeti (`analyzeResetRequests`):** Yönetici panelindeki talepleri `localBlockedCount`, kalan bekleme süresi ve toplam engellenen spam tıklama istatistiğiyle zenginleştirir.

### Dilim 4 — Lokal Demo (`inventory_demo` @ `localhost` / `127.0.0.1`) Güvenli Yedekleme Katmanı ([staff-lifecycle-service.js](file:///c:/Users/med3pol/Documents/project_Inventory_v3.1_Functional_Master/src/services/staff-lifecycle-service.js))
1. **`isLocalDemoFallbackAllowed()`:**
   - Yalnızca `COLLECTION_ROOT === 'inventory_demo'` **VE** `hostname ∈ {'localhost', '127.0.0.1'}` iken `true` döner. Canlı `lifeserver_master` kökünde kesinlikle devre dışıdır.
2. **Yerel Demo Yedeği (`medipol_demo_reset_requests_v1`):**
   - Bulut kuralları henüz deploy edilmemişken `submitPasswordResetRequest` sunucudan `permission-denied` alırsa talebi `source: 'local-demo-fallback'` ile yerel demo deposuna kaydeder.
   - `listPasswordResetRequests()` sunucudan `permission-denied` alırsa yerel demo deposundan okur (veya sunucu listesiyle birleştirir).
   - `resolvePasswordResetRequest()` ve `issueTemporaryPinOrReset(..., { resolveResetPri })` yerel demo kaydını da güncelleyerek Senaryo 5–6'nın lokalde uçtan uca test edilmesini sağlar.
   - `listStaffAccountStates()` lokal demo ortamında `permission-denied` alırsa paneli çökertmek yerine güvenli boş harita (`{}`) ve durum bayrağı döner.

### Dilim 5 — `🔑 Geçici PIN` Modalı & Yaşam Döngüsü Kartı Dark Theme Uyumu ([staff-lifecycle-panel.js](file:///c:/Users/med3pol/Documents/project_Inventory_v3.1_Functional_Master/src/ui/staff-lifecycle-panel.js), [staff-lifecycle.test.mjs](file:///c:/Users/med3pol/Documents/project_Inventory_v3.1_Functional_Master/tests/unit/staff-lifecycle.test.mjs))
1. **[staff-lifecycle-panel.js](file:///c:/Users/med3pol/Documents/project_Inventory_v3.1_Functional_Master/src/ui/staff-lifecycle-panel.js):**
   - `getThemePalette()` ile `[data-theme="dark"]` (Space Titanium) ve açık tema (Warm Platinum) için gerçek proje değişkenleri (`--color-surface`, `--color-surface-alt`, `--color-text`, `--color-text-muted`, `--color-border`) ve yüksek kontrastlı `<input>`/`<select>`/`<option>`/`<textarea>` renkleri uygulanır.
   - `.slp-card`, `.slp-modal`, `.slp-input`, `.slp-secret-box`, `.slp-cmd-box`, `.slp-row` sınıfları ve `data-theme` değişim gözlemcisi (`MutationObserver`) eklenir.
   - Yönetici kartında anti-spam engelleme özeti (`🛡️ N mükerrer deneme yerelde engellendi`) ve lokal demo modu rozeti (`[Lokal Demo Modu — Kurallar Deploy Edilene Kadar]`) gösterilir.
2. **[tests/unit/staff-lifecycle.test.mjs](file:///c:/Users/med3pol/Documents/project_Inventory_v3.1_Functional_Master/tests/unit/staff-lifecycle.test.mjs):**
   - Kişi bazlı 24 saat yerel anti-spam kilidi, cihaz bazlı 1 saatte en fazla 2 farklı PRI flood koruması ve `analyzeResetRequests` raporlama testleri eklenir.
