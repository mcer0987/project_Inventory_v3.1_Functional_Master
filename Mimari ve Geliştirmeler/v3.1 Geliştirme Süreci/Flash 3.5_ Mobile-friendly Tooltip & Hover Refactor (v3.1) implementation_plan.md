# Mobile-friendly Tooltip, Hover & Navbar Responsiveness Refactor (v3.1)

## Background
The application currently faces several UX and layout challenges on mobile devices:
1. **Tooltips on Hover**: The table row tooltips (displaying "Last Update") are triggered by `mouseenter`/`mousemove` which fails on touch viewports and degrades experience.
2. **Global Horizontal Overflow**: The layout overflows `100vw` on mobile screens, causing a global horizontal scroll bug.
3. **Navbar Scrollbar**: The horizontal tab navbar bar displays visual scrollbars that break the native-like experience.
4. **Passive Row Visibility**: Passive table rows (`.passive-row`) lack sufficient visual distinction on mobile devices since hover styles are not visible.
5. **Tactile Feedback**: Interactive buttons on the floating actions bar (FAB) and bottom sheet lack high-quality native tap-scaling animations.

---

## User Review Required

> [!IMPORTANT]
> **Mobile UI Modification**:
> If the viewport width is $\le 768\text{px}$:
> - The hover-based tooltip is disabled.
> - An info icon (`i.fa-info-circle`) is rendered inline next to the quantity. When clicked, a mobile alert (`showAppAlert`) displays the update timestamp.
> - The global horizontal page overflow is suppressed.
> - The navigation tab bar (.tabs) becomes horizontally scrollable without visual scrollbars, and buttons are guaranteed to not shrink.

---

## Open Questions

None. The requirements are fully detailed.

---

## Proposed Changes

### 1. `script.js` — Mobile Tooltip Integration

#### [MODIFY] [script.js](file:///c:/Users/muhammed.cer/Desktop/project_Inventory/script.js)

- Update `window.showRowTooltip` to check if `window.innerWidth <= 768`. If true, return immediately (disable hover).
- Implement `window.showMobileTooltip(event, updateDate)` to stop event propagation and call `showAppAlert`.
- In both `renderTable` and `renderSearchResults`, check if `window.innerWidth <= 768`. If true:
  - Add an inline info icon next to the quantity value that triggers `window.showMobileTooltip(event, '${updateDate}')` on click.
  - Apply `js-qty-cell` class consistently.

---

### 2. `style.css` — Responsive Layout & Tactile Buttons

#### [MODIFY] [style.css](file:///c:/Users/muhammed.cer/Desktop/project_Inventory/style.css)

- Add global overflow-x rules to block page-level horizontal scrolls:
  ```css
  html, body, .inventory-screen, .launchpad-container {
      overflow-x: hidden;
  }
  ```
- In the mobile media query `@media (max-width: 768px)`:
  - Add a rule to hide the scrollbar for the `.tabs` navbar:
    ```css
    .tabs::-webkit-scrollbar {
        display: none;
    }
    ```
  - Ensure all tab buttons inside `.tabs` have `flex-shrink: 0 !important;` and `white-space: nowrap;`.
  - Style `tr.passive-row` and `.passive-row` with `opacity: 0.6 !important;` to ensure they are visually distinct without mouse hover.
- Standardize tactile button feedback in `style.css`:
  - Update `.fab-btn:active` and `.bs-action-btn:active` to `transform: scale(0.95)`.
  - Ensure all related control close buttons (`.fab-close-btn:active`, `.bs-close-btn:active`) scale to `0.95`.

---

## Verification Plan

### Manual Verification
1. **Desktop Check**: Open on a desktop screen. Hover over a table row and verify the standard tooltip still appears and follows the cursor.
2. **Mobile Check**: Resize the window to mobile width ($\le 768\text{px}$):
   - Verify that the whole page does not scroll horizontally (global scroll bug fixed).
   - Check that the navigation tabs bar scrolls smoothly left-to-right without visual scrollbars, and no buttons are shrunk/squeezed.
   - Verify that passive rows are automatically dimmed with 0.6 opacity.
   - Click the info icon next to a quantity value and confirm that the update date alert appears.
3. **Tactile Check**: Simulate mobile touch. Tap and hold buttons in the Bottom Sheet/FAB to check that they animate down to `0.95` scale.
