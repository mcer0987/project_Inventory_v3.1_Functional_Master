---
trigger: always_on
priority: 3
---

# Execution Protocol — How Agents Work

> Defines HOW tasks are executed. This file is the lowest-priority rule layer.
> Must comply with 01-constitution.md and 02-agent-roles.md.
> Priority: 3rd (below Constitution and Agent Roles).

---

## 1. Task Execution Flow (Universal)

Every task — whether a bug fix, new feature, or refactor — MUST follow this sequence:

### Step 1 — Analyze Before Acting

- Read the relevant existing files completely.
- Identify the exact scope of change (which files, which functions).
- Assess potential side effects on other modules.

### Step 2 — Present a Plan

Before writing any production code, provide a concise plan:

```
## Implementation Plan
1. [First action — e.g., "Add a getFilteredProducts() function in /services/inventory.js"]
2. [Second action — e.g., "Wire the filter to the UI via a new render call in /ui/productTable.js"]
3. [Risk note — e.g., "Existing sort order relies on array indices; new filter must preserve __index"]
```

- Wait for user acknowledgment before proceeding to implementation.
- Exception: If the user explicitly says "just do it" or the change is a single-line fix, you may proceed directly.

### Step 3 — Implement Targeted Changes

- Output ONLY the specific code blocks that need modification.
- NEVER rewrite an entire file from scratch.
- Apply the `// [WHY]` / `// [HOW]` comment standard (Constitution §9).
- Follow the SoC rules (Constitution §3) — no mixing data and view logic.
- Use `window.AppEnv.COLLECTION_ROOT` for all Firebase paths (Constitution §8).

### Step 4 — Side-Effect Check

After implementation, briefly state:
- Which other files/functions might be affected.
- Whether any existing tests or validations need updating.
- Any follow-up tasks required.

---

## 2. Bug Fix Flow (Extended)

When fixing a reported bug or error, follow the universal flow above with these additions:

### 2.1 Root Cause Analysis

Before the plan, explicitly state the root cause:
```
## Root Cause
[1-2 sentences identifying WHY the bug occurs]
```

### 2.2 Targeted Fix

- Modify only the minimal code necessary.
- Do NOT refactor surrounding code "while you're at it" unless explicitly asked.
- Preserve existing variable names and patterns.

### 2.3 Verification Statement

After the fix, provide:
```
## Verification
- The fix addresses [specific symptom].
- Tested scenario: [what was checked].
- No regression in: [what was verified to still work].
```

---

## 3. New Feature Flow (Extended)

When building a new feature, follow the universal flow with these additions:

### 3.1 Architecture Check

Before the plan, confirm:
- Which layer(s) the feature touches (Data / View / Utility).
- Which agent is responsible (per 02-agent-roles.md).
- Whether new files need to be created (follow directory structure in Constitution §4).

### 3.2 Implementation Plan (Detailed)

```
## Architecture Check
- Layers: [Data] / [View] / [Utility]
- Responsible Agent: [Agent Name]
- New files: [list or "None"]

## Implementation Plan
1. [Data layer action — if applicable]
2. [View layer action — if applicable]
3. [Integration point — how it connects to existing code]
4. [Risk: potential side effects or breaking changes]
```

### 3.3 Module Registration

If the feature introduces a new module:
- Register it under `window.AppModules.[ModuleName]`.
- Import and initialize it in `app.js`.
- Follow the namespace strategy (Constitution §2).

---

## 4. Bulk Operations Protocol

For any operation that modifies or deletes multiple records:

1. **Use V2 Batch Architecture** — `window.saveData` or `deleteItem` (Constitution §6).
2. **Present a confirmation summary** before execution:
   ```
   ## Bulk Operation Summary
   - Operation: [Update / Delete]
   - Records affected: [count]
   - Batch count: [calculated chunks]
   - Risk: [any irreversible consequences]
   ```
3. Wait for explicit user confirmation (e.g., via `showCustomConfirm` in-app, or chat acknowledgment).
4. NEVER execute raw `deleteDoc` loops or unstructured batch operations.

---

## 5. Refactoring Protocol

When asked to refactor existing code:

1. **Analyze first** — read the entire target file and its dependents.
2. **Propose a diff-style plan** — show what will change, not the entire new file.
3. **Get explicit confirmation** before applying.
4. **Preserve behavior** — refactoring must NOT change external behavior.
5. **One module at a time** — do not refactor multiple modules in a single response unless explicitly asked.

---

## 6. Prohibited Actions

The following actions are ALWAYS forbidden, regardless of context:

| Action | Reason |
|--------|--------|
| Rewriting an entire file from scratch | Violates Constitution §10 |
| Mixing Firebase calls in `/ui` files | Violates Constitution §3 |
| Mixing DOM manipulation in `/services` files | Violates Constitution §3 |
| Mutating `window.data` directly | Violates Constitution §5 |
| Hardcoding collection paths | Violates Constitution §8 |
| Executing raw `deleteDoc` loops | Violates Constitution §6 |
| Skipping the plan step on non-trivial changes | Violates this file §1 |
| Working outside your agent domain | Violates 02-agent-roles.md |
| Omitting `// [WHY]` / `// [HOW]` on new functions | Violates Constitution §9 |
| Claiming "verified"/"completed" without evidence | Violates this file §7.2 |
| Writing files with PowerShell `Set-Content`/`Add-Content`/`Out-File` without `-Encoding utf8` | Violates this file §7.3 |
| Fixing one half of a masking pair in isolation | Violates this file §7.4 |
| Writing passwords, hashes, salts or tokens to terminal, logs, walkthroughs or commit messages | Violates this file §7.5 |

---

## 7. Process Safety Rules (v3.2 Phase 0)

> Added after the v3.2 audit (root cause KN-7: behaviour lost during migrations went unnoticed).

### 7.1 Atomic Commits
- Every task = its own commit on the active phase branch (`<type>/phase-N-<topic>`). Never commit directly to `master`.
- Commit message: Conventional Commits (`fix(scope): …`, `chore(scope): …`). No secrets.
- Every walkthrough MUST list: commit hash(es), changed file list (`git diff --stat`), and the branch name.

### 7.2 Definition of "Verified" / "Completed"
A task may be reported as verified/completed ONLY when all three are attached:
1. The code change (commit hash).
2. Observed result of the related Regression List (Plan Ek A) items. State what was actually seen, not what is expected.
3. Evidence: console output excerpt and/or screenshot, plus smoke-test metrics (error count, duplicate-load count) compared with the Phase 0 baseline.
Without evidence, the status is "implemented, not verified".

### 7.3 Character Encoding (OPS-03 / VIP-09)
- Prefer editor tools (Edit/Write) for source files.
- In Windows PowerShell 5.1, `Set-Content`, `Add-Content` and `Out-File` MUST be called with `-Encoding utf8`. Without it, the default ANSI code page (cp1254) corrupts Turkish characters.
- Bulk regex replacements require a dry-run preview before writing.

### 7.4 Masking Pairs
If fixing bug A exposes bug B (see Master Plan §5.0 list, e.g. INV-01⇄INV-02, EBYS-01⇄EBYS-02, VIP-04⇄VIP-06⇄VIP-03), both MUST be fixed in the same commit. Do not ship half a pair.

### 7.5 Secrets & Live-System Safety
- Never request, print, or store passwords, hashes, salts, or tokens. Human operators confirm credential changes with a confirmation sentence only.
- Test only via `http://localhost` or `http://127.0.0.1` (→ `inventory_demo`). Never via `file://` or a LAN IP (→ live `inventory_v2`).
- Until Phase 2.5 is completed: do not trigger VIP "Tekerrürleri Temizle", kill switch, force logout, or system message, not even on localhost (`system_config` is not environment-scoped).
- No `firebase deploy` of any target until the owner explicitly approves (planned: end of Phase 2).