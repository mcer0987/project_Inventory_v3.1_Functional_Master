# Phase 1 Architectural Blueprint

## 1. `edm-workflow.js` State Module
All state concerning workflow templates and manual processes is now stored in a singleton representation:

```javascript
const WorkflowState = {
    tempManualSteps: [],
    tempTplSteps: [],
    tempTplAuth: [],
    currentEditingTemplateId: null,
    isManualMode: true,
    selectedTemplateId: null
};
```
**Architecture Rule:** Functions may be globally accessible, but variable state MUST NOT be. The `WorkflowState` object enforces clean encapsulation while letting `window.*` event handlers (for modals and templates) operate safely without risking concurrent overwrites.

## 2. `script.js` Shopping Cart Closure

**Architecture Rule:** Enforced strict separation via an IIFE (Immediately Invoked Function Expression).

```javascript
(function() {
    // Private State
    let cartItems = [];

    // Publicly Available Handlers
    window.openCartModal = function() { ... };
    window.addToCart = function(res) { ... };
    window.removeFromCart = function(index) { ... };
    window.renderCartItems = function() { ... };
    window.updateCartQty = function(idx, val) { ... };
    window.saveCartExit = async function() { ... };
})();
```
This isolates `cartItems`, making it impossible for any other module outside this closure to modify the array directly.

## 3. Firebase ID Strategy
**Architecture Rule:** Firestore expects strict typing on document IDs. Number-based keys lead to a catastrophic crash (`n.indexOf is not a function`).

In `firebase-handler.js`, the operation blocks explicitly map object IDs into `String()` structures:
```javascript
doc(fireDb, "inventory_v2", colName, "items", String(id))
```
This ensures zero crashes during save, edit, and deletion ops via `saveData`.

## 4. Performance: Batch DOM Rendering (`script.js`)
**Architecture Rule:** In Pure JavaScript, iterative DOM manipulation loops (`+=` or `insertRow()`) destroy rendering performance. Always manipulate strings/arrays in memory and batch-update the DOM once.

```javascript
const rowsHtml = displayData.map((item) => {
    // 1. Build row strings with inline variables and events
    return `<tr data-index="${idx}" onmouseenter="window.showRowTooltip(event)">...</tr>`;
});

// 2. Batch inject once to trigger only 1 Reflow cycle.
tbody.insertAdjacentHTML('beforeend', rowsHtml.join(''));
```

## 5. UI Architecture: Optimistic Rendering
**Architecture Rule:** Decouple critical security state blocks (Firebase async connection) from purely visual layout decisions. UI components that have local memory caches should paint themselves immediately upon hydration, providing users with instant feedback.

```javascript
document.addEventListener('DOMContentLoaded', () => {
    // Optimistic Cache Paint (Instant)
    const cachedUser = localStorage.getItem('activeUser');
    if (cachedUser) updateNavbarUI(JSON.parse(cachedUser));

    // Security Gate (Async)
    const checkAuth = () => {
        if (window.userAuth) {
           // Establish secure connection and finalize hidden systems.
        }
    };
});
```

## 6. Functional Integrity: Pure Render Operations
**Architecture Rule:** A render function must accept data and return UI (HTML/DOM nodes). It must **NEVER** manipulate the original dataset (Mutation) or dispatch network write commands (`saveData`).

Data sanitization and backward compatibility logic (Migrations) should be hooked into the data-fetching layer (Pub/Sub Event `onInventoryDataUpdated`), executing only once per session to avoid side-effects during standard UI interactions.

## 7. Data Consistency: Atomic Firebase Transactions
**Architecture Rule:** Shared mutable states (like product inventory quantity) MUST NEVER be calculated client-side and forced via `set/update`. All math operations must occur in a Server-Side Transaction to lock the document and prevent Race Conditions.

```javascript
await runTransaction(fireDb, async (transaction) => {
    const docSnap = await transaction.get(docRef);
    const data = docSnap.data();
    
    // Server-side calculation & Validation Lock
    if (data.qty + delta < 0) throw new Error("Yetersiz Stok");
    
    transaction.update(docRef, { qty: data.qty + delta });
});
```
