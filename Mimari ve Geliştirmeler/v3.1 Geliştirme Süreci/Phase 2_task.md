# ESM Migration Task List

- [x] **Phase 0** — firebase-handler.js export eklemeleri
- [x] **Phase 1** — `utils.js` oluşturuldu
- [x] **Phase 2** — `auth-engine.js` oluşturuldu + handleLogout eklendi
- [x] **Phase 3** — `table-engine.js` oluşturuldu (AppModules.Table namespace strategy)
  - [x] Extract `renderTable`, `renderSearchResults`, `renderCardSearchResults`, `renderMobileCards`, `searchTable`, `changePage`, `sortTable`, `getProcessedData`, `patchDOMForCollection`, `toggleCardView`
  - [x] Extract `showRowTooltip`, `moveRowTooltip`, `hideRowTooltip`, `showMobileTooltip`
  - [x] Namespace: Assign to `window.AppModules.Table`
  - [x] Bridge: Backward compatibility bridges
- [x] **Phase 4** — `inventory-logic.js` oluşturuldu (AppModules.Inventory namespace strategy)
  - [x] Extract `addExit`, `saveExit`, `updateStock`, `deleteItem`, `bulkDelete`, `saveProduct`, `toggleWatch`, `receiveProduct`, `deleteB3Row`
  - [x] Namespace: Assign to `window.AppModules.Inventory`
  - [x] Bridge: Backward compatibility bridges
  - [x] Keep `[ENV_GUARD]` and `COLLECTION_ROOT` logic intact
- [x] **Phase 6** — `main.js` PubSub router güncelleme (window.AppModules initialized at top, imports in correct order, event listener moved here)
- [x] **Self-Approval Guard Modülü** — `self-approval-reporter.js` oluşturuldu
  - [x] Proxy/Wrapper pattern ile `window.confirmRequest` ve `window.approveStep` sarmalandı.
  - [x] Kendi kendini onaylama girişimlerinde admin olmayanları engelleme, adminlere biyometrik (2FA) imza zorunluluğu entegre edildi.
  - [x] Admin Navbar'a 'Güvenlik Raporu' butonu eklendi.
  - [x] Raporların gösterileceği Glassmorphic Audit Raporu ekranı (View/Report layer) geliştirildi.
  - [x] `window.AppModules.SelfApproval` namespace'ine kaydedildi.

- [x] **Phase 5** — `ui-components.js` oluşturuldu (Modals, FAB, BottomSheet, RowSelection)
  - [x] Modal: `openProductModal`, `openTransferModal`, `confirmTransfer`, `closeTransferModal`, `handleTransferTargetChange`
  - [x] Modal: `openExitModal`, `closeExitModal`, `openRequestModal`, `closeRequestModal`
  - [x] Modal: `handleTypeChange`, `selectProduct`, `openModal`, `closeModal` (generic wrappers)
  - [x] FAB: `setupRowSelection` (Event Delegation — tam korundu), `updateFloatingBar`
  - [x] BottomSheet: `showMobileBottomSheet`, `closeMobileBottomSheet`
  - [x] Selection: `clearRowSelection`, `_bulkDeleteSelected`
  - [x] Namespace: `window.AppModules.UI = UIComponents`
  - [x] Legacy bridge'ler: tüm fonksiyonlar `window.XYZ = UIComponents.XYZ.bind(UIComponents)` ile korundu
  - [x] `index.html`'ye script tag eklendi (inventory-logic.js sonrası, self-approval öncesi)
  - [x] `modules/main.js` ve `src/modules/main.js` import blokları güncellendi

- [ ] **Final** — script.js fallback bloklarının temizlenmesi
