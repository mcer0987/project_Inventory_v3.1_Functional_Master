---
trigger: always_on
---

---
trigger: always_on
priority: 1
---

# Constitution — Immutable System Principles

> This file is the single source of truth. No other rule file may contradict these principles.
> Priority: HIGHEST. All agents must read this file first.

---

## 1. Technology Stack

- **Language:** Pure Vanilla JavaScript (ES6+). No TypeScript compilation required.
- **Runtime:** Browser-native. No build tools (webpack, vite, etc.).
- **Backend:** Firebase SDK v10 (modular API with `import { ... } from "firebase/firestore"`).
- **Frameworks:** FORBIDDEN — React, Vue, Angular, Svelte, or any heavy DOM library. Do not suggest them.

## 2. Namespace Strategy

- All business logic MUST be exported into the `window.AppModules` namespace.
  ```js
  window.AppModules.Inventory = { getProducts, updateStock, ... };
  window.AppModules.Ticketing = { createTicket, resolveTicket, ... };
  ```
- **The Bridge (Legacy Exception):** You may ONLY assign functions to the global `window` object if they are explicitly triggered by HTML inline `onclick` attributes or legacy scripts. This is the ONLY exception to the namespace rule.

## 3. Separation of Concerns (SoC)

| Layer | Directory | Allowed | Forbidden |
|-------|-----------|---------|-----------|
| **Data** | `/services` | Firebase queries (`getDocs`, `doc`, `updateDoc`, `deleteDoc`, `setDoc`) | DOM manipulation, HTML injection, CSS, `document.*` |
| **View** | `/ui` or `/components` | DOM manipulation, HTML rendering, event listeners, CSS classes | Direct Firebase SDK calls, API endpoints |
| **Utility** | `/utils` | Formatting (dates, currency, strings), validation helpers, pure functions | Firebase calls, DOM manipulation |
| **Orchestrator** | `app.js` | Module initialization, cross-module coordination, event wiring | Business logic implementation |

## 4. Directory Structure

```
/services/          → Firebase CRUD, queries, batch operations
/ui/  or /components/ → Tables, forms, modals, layout, rendering
/utils/             → Shared helper functions (formatting, validation)
app.js              → Main orchestrator — imports and wires all modules
```

## 5. Mutation-Free State Management

- NEVER mutate `window.data` arrays directly for UI filtering or searching.
- Use non-destructive filter hooks (e.g., `.filter()`, `.map()`) that return new arrays.
- Always preserve the `__index` property on data items to ensure UI actions (Edit, Delete) target the correct original record.

## 6. V2 Batch Compliance & Deletion Safeguards

- For bulk database operations and deletions, strictly use the established V2 Batch architecture (`window.saveData` or `deleteItem`).
- These leverage atomic chunking (500-document limit protection per batch).
- NEVER execute unstructured raw `deleteDoc` loops.
- Always present an interactive summary confirmation (`showCustomConfirm`) before permanent removals.

## 7. Milimetric Heuristic Deduplication

- When implementing duplicate cleaning or automated item matching (especially for consumables/sarf):
  - Items are considered duplicates ONLY if they share an **identical valid Serial Number**.
  - OR match milimetrically across **ALL non-ID fields** (including timestamps, notes, and staff info).
- Partial matches or single-field overlaps do NOT qualify as duplicates.

## 8. ZERO-TRUST Environment Configuration

- Always use `window.AppEnv.COLLECTION_ROOT` for Firebase collection paths.
- NEVER hardcode collection names like `"inventory_v2"` or `"inventory_demo"`.
- Example:
  ```js
  // WRONG
  const ref = doc(db, "inventory_v2", productId);
  // CORRECT
  const ref = doc(db, window.AppEnv.COLLECTION_ROOT, productId);
  ```

## 9. Code Documentation Standard

Every new critical function or logic block MUST include these header comments:

```js
// [WHY]: <Brief architectural reason — why does this exist?>
// [HOW]: <Brief operational logic — how does it work?>
function handleBatchUpdate(items) { ... }
```

## 10. File Integrity Rule

- NEVER rewrite an entire file from scratch.
- Only output the targeted code blocks that need modification.
- Always analyze the existing architecture and file paths before introducing new code.
- Maintain existing variable naming conventions unless explicitly asked to rename.