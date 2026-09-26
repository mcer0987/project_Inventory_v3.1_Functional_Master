# Environment Isolation & B3 Schema Standardization (v3.1)

## Background
The system runs against a single hardcoded `"inventory_v2"` Firestore root in `firebase-handler.js`, `admin-backup.js`, and `runStockTransaction`. Any test run on `localhost` or a `demo` URL writes directly to **production data**. The `saveExit` function also uses client-side stock math instead of the atomic `runStockTransaction`, creating a race-condition vulnerability.

---

## User Review Required

> [!CAUTION]
> `saveExit` currently performs **client-side stock deduction** (lines 1447–1470 in `script.js`). Replacing this with `runStockTransaction` will make multi-quantity exits atomic but **requires that every item in B2/B1 has a valid Firestore `id` field**. Items missing an `id` will throw a transaction error. Confirm this is acceptable before proceeding.

> [!WARNING]
> The `COLLECTION_ROOT` constant is resolved at **page load time** from `window.location.hostname`. This means a dev build served on a custom domain that doesn't contain "demo" will still target `inventory_v2`. Ensure staging/demo hosts are correctly named (e.g. `demo.medipol-envanter.web.app`).

---

## Open Questions

> [!IMPORTANT]
> **Q1 – `admin-backup.js` scope**: `restoreFirebaseBackup` uses the hardcoded path `doc(window.fireDb, "inventory_v2", ...)` via `window.FirebaseModules`. Should the env-guard also wrap backup/restore to prevent accidentally restoring into production from localhost?  
> **Recommended:** Yes — the `COLLECTION_ROOT` guard should apply here too.

---

## Proposed Changes

---

### 1. `firebase-handler.js` — ENV_GUARD + Dynamic COLLECTION_ROOT

#### [MODIFY] [firebase-handler.js](file:///c:/Users/muhammed.cer/Desktop/project_Inventory/firebase-handler.js)

**a) Add `COLLECTION_ROOT` constant** — right after the Firebase import block (before `firebaseConfig`):

```js
// [ENV_GUARD] v3.1 Environment Isolation:
// WHY: Hardcoding "inventory_v2" means any localhost test writes to live production data.
// HOW: hostname check at load-time. "demo" substrings cover staging URLs like demo.*.web.app.
const COLLECTION_ROOT = (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname.includes('demo')
) ? "inventory_demo" : "inventory_v2";

console.log(`🚀 ACTIVE DATABASE ROOT: ${COLLECTION_ROOT}`); // [ENV_GUARD]
window.COLLECTION_ROOT = COLLECTION_ROOT; // Exposed for admin-backup.js and other modules
```

**b) Replace all hardcoded `"inventory_v2"` strings** in the following locations inside `firebase-handler.js`:

| Line | Current | Replacement |
|------|---------|-------------|
| 122 | `collection(fireDb, "inventory_v2", colName, "items")` | `collection(fireDb, COLLECTION_ROOT, colName, "items")` |
| 123 | `` `inventory_v2/${colName}/items` `` | `` `${COLLECTION_ROOT}/${colName}/items` `` |
| 380 | `doc(fireDb, "inventory_v2", colName, ...)` | `doc(fireDb, COLLECTION_ROOT, colName, ...)` |
| 401 | `doc(fireDb, "inventory_v2", colName, ...)` | `doc(fireDb, COLLECTION_ROOT, colName, ...)` |
| 505 | `doc(fireDb, "inventory_v2", colName, ...)` | `doc(fireDb, COLLECTION_ROOT, colName, ...)` |
| 533 | `doc(fireDb, "inventory_v2", colName, ...)` | `doc(fireDb, COLLECTION_ROOT, colName, ...)` |

**c) Standardize `saveData`** — add an `[ENV_GUARD]` inline comment at the batch write entry point to confirm which root is being written to.

---

### 2. `admin-backup.js` — ENV_GUARD for Restore

#### [MODIFY] [admin-backup.js](file:///c:/Users/muhammed.cer/Desktop/project_Inventory/admin-backup.js)

Replace the hardcoded `"inventory_v2"` on **line 124** with `(window.COLLECTION_ROOT || "inventory_v2")` to inherit the environment decision from `firebase-handler.js`.

---

### 3. `script.js` — B3 Schema Standardization & `saveExit` Atomic Refactor

#### [MODIFY] [script.js](file:///c:/Users/muhammed.cer/Desktop/project_Inventory/script.js)

**Target: `addExit` (lines 517–579)**

The current `exitEntry` object uses legacy/inconsistent property names (`ürün`, `tür`, `not`, `personel`, `raf`). Standardize to the B3 schema:

```js
// BEFORE (non-standard):
{ id, raf, ürün, tür, sn, not, personel, tarih, kaynakDepo }

// AFTER (B3 Standard):
{ id, rafNo, urunAciklama, urunTuru, sn, not, alanKisi, tarih, isDemirbas, kaynakDepo, adet }
```

**Target: `saveExit` (lines 1422–1521)**

- Remove the client-side stock math block (lines 1447–1473).
- Replace with `await window.runStockTransaction(repo, product.id, -requestedQty)`.
- Change `await window.saveData(window.data)` → `await window.saveData('b3', window.data.b3)` (targeted write, prevents race-condition double-save).
- Add `[ENV_GUARD]` inline comment at the saveData call.

---

## Verification Plan

### Automated Tests
- No automated test runner in this project.

### Manual Verification
1. Serve on `localhost` → Open browser console → Confirm log: `🚀 ACTIVE DATABASE ROOT: inventory_demo`
2. Confirm Firestore console: all writes land under `inventory_demo/`, not `inventory_v2/`
3. Perform a stock exit → confirm `runStockTransaction` atomic log appears, not client-side math
4. On production URL → confirm log shows `inventory_v2`
5. Verify `b3Entry` saved to Firestore contains keys: `urunAciklama`, `urunTuru`, `adet`, `alanKisi`, `kaynakDepo`, `isDemirbas`
