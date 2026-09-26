# Phase 1 Walkthrough: Global State Cleanup & Bug Fixes

This walkthrough details the steps taken to resolve architectural vulnerabilities and critical functional bugs in the system.

## 1. Global State Cleanup (`edm-workflow.js`)
> [!WARNING]
> Previously, states like `window.tempManualSteps`, `window.tempTplSteps`, and `window.isManualMode` were attached directly to the global `window` object. This created a high risk of **Race Conditions** and namespace collision.

**What was done:**
- Encapsulated all standalone variables into a central `WorkflowState` constant.
- Updated dozens of references like `window.tempManualSteps.splice` to point to `WorkflowState.tempManualSteps`.
- Retained the global exposure of functions (`window.addManualStep`) strictly to keep HTML inline `onclick` events functional.

## 2. IIFE Closure for Cart (`script.js`)
> [!TIP]
> To prevent access to the cart state from unauthorized outside functions, we utilized an **Immediately Invoked Function Expression (IIFE)**.

**What was done:**
- `window.cartItems` was completely removed. 
- A private variable `let cartItems = [];` was introduced within the IIFE.
- Only the UI interaction methods (`addToCart`, `removeFromCart`, `openCartModal`, `saveCartExit`) were left on the `window` object, granting them exclusive closure access to `cartItems`.

## 3. Firebase `saveData` ID Formatting Fix (`firebase-handler.js`)
> [!CAUTION]
> A critical failure occurred when creating purchase requests: `TypeError: n.indexOf is not a function`. The database aborted all saves.

**What was done:**
- Discovered that Firebase Firestore's `doc()` requires path segments to strictly be strings.
- In `saveData`, modified lines inserting `id` and `item.id` to explicitly cast to `String()`.
- Added inline comments labeled `[FIX]` to prevent future developers from reversing the architectural pattern.

## 4. Phase 2: Performance Bottlenecks & Reflow Elimination (`script.js`)
> [!IMPORTANT]
> The previous `renderTable`, `renderSearchResults`, and `renderExitTable` functions invoked `tbody.insertRow()` inside `forEach` loops. This forced the browser to pause and recalculate the layout (Reflow) on every single iteration, leading to massive UI lag during large inventory datasets.

**What was done:**
- Replaced the iterative `insertRow()` layout with a map/join architecture (`.map(item => '<tr>...</tr>').join('')`).
- Appended the finalized large HTML string via a single `insertAdjacentHTML('beforeend', ...)` or `innerHTML` execution to optimize performance down to a single DOM paint.
- Protected event listener integrity: The `row.onmouseenter` and similar tooltips events were extracted into global scope (`window.showRowTooltip`) and injected straight into the HTML string (`onmouseenter="..."`) so that functionality isn't lost during the batch render.

## 5. Phase 2 Addendum: Optimistic UI Navbar Render (`script.js`)
> [!TIP]
> Previously, the top Navbar (`#userDisplay`) remained hidden on reload until the async `window.userAuth` connected to Firebase and returned the profile data. This created a visual bottleneck (FOUC).

**What was done:**
- Added an Optimistic Render logic chunk at the very beginning of the `DOMContentLoaded` event.
- It instantly reads the `localStorage.getItem('activeUser')` and fires `updateNavbarUI()` immediately without waiting for Firebase.
- Kept the Firebase `window.userAuth` object strictly to govern DB security barriers and Login Modal closures.

## 6. Phase 3: Removing Mutation Anti-Pattern in Render Functions
> [!CAUTION]
> The UI function `renderAdminDashboard` was actively checking and updating workflow states, then invoking `window.saveData(window.data)` upon every render. This created severe performance issues, infinite render loops, and broke the functional programming principle that renders must be pure.

**What was done:**
- Stripped the data sanitization loop out of `admin-purchase-render.js`'s `renderAdminDashboard`.
- Refactored `fixAllWorkflowData` inside `edm-workflow.js` to only execute a targeted `saveData('purchaseOrders', ...)` instead of writing the whole state.
- Set up an event listener (`onInventoryDataUpdated`) in `edm-workflow.js` to run the migration silently in the background exactly *once*, right after Firebase completes the initial data fetch.

## 7. Phase 4: Atomic Firebase Transactions (Race Condition Fix)
> [!WARNING]
> Stock deduction (`addExit`) and manual stock updates (`updateStock`) were previously computing the new stock level locally and overwriting the database via `saveData()`. This allowed Race Conditions where two simultaneous operations would overwrite each other, causing corrupted inventory totals.

**What was done:**
- Created `window.runStockTransaction(colName, docId, delta)` in `firebase-handler.js` utilizing Firestore's atomic `runTransaction`.
- Replaced the local memory mutations in `script.js` with direct API calls to the new Transaction Service.
- Removed the broad `saveData(window.data)` calls. Operations now only trigger `saveData('b3', window.data.b3)` strictly for appending the exit logs without overwriting the atomic stock state.
- Embedded error interception (`throw new Error`) to instantly block negative stock calculations and trigger a visual warning (`showAppAlert`) for the user.
