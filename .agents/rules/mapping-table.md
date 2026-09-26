# Mapping Table — Old Files → New Structure

> Use this table to migrate your existing Google AI Studio agent prompts to the new 3-file system.
> "Old Location" shows where each rule originally lived. "New Location" is where it now lives.
> Rules that were merged are noted with "MERGED".

---

## Constitution Mapping (01-constitution.md)

| # | Rule | Old Location(s) | New Location | Notes |
|---|------|----------------|--------------|-------|
| 1 | Tech Stack: Vanilla JS + Firebase v10, no frameworks | `my-vision.md` (line 16) | §1 | Was in vision doc, now constitutional |
| 2 | Namespace: `window.AppModules.*` | `laguna-core-rules.md` (line 10), `my-vision.md` (line 18) | §2 | MERGED from 2 sources |
| 3 | Bridge Exception: `window.*` for onclick only | `laguna-core-rules.md` (line 11) | §2 | Kept as-is |
| 4 | SoC: /services = Firebase only, /ui = DOM only | `laguna-core-rules.md` (line 12-15), `project-hierarchy.md` (line 7-10), `my-vision.md` (line 10) | §3 | MERGED from 3 sources |
| 5 | Utility Layer: /utils = pure helpers | `project-hierarchy.md` (line 10) | §3 | Was buried in hierarchy |
| 6 | Directory Tree | `project-hierarchy.md` (line 12-17) | §4 | Moved from separate file |
| 7 | Mutation-Free State: no direct `window.data` mutation | `laguna-core-rules.md` (line 15), `my-vision.md` (line 18) | §5 | MERGED from 2 sources |
| 8 | V2 Batch Compliance: atomic chunking, 500 limit | `my-vision.md` (line 22) | §6 | Was in vision doc |
| 9 | Milimetric Heuristic Deduplication | `my-vision.md` (line 20) | §7 | Was in vision doc |
| 10 | ZERO-TRUST: `window.AppEnv.COLLECTION_ROOT` | `laguna-core-rules.md` (line 22) | §8 | Was in execution rules, promoted to principle |
| 11 | Code Docs: `// [WHY]` / `// [HOW]` | `laguna-core-rules.md` (line 19-21), `my-vision.md` (line 27-28) | §9 | MERGED from 2 sources |
| 12 | File Integrity: never rewrite entire file | `laguna-core-rules.md` (line 18), `project-hierarchy.md` (line 21-22), `my-vision.md` (line 14) | §10 | MERGED from 3 sources |

---

## Agent Roles Mapping (02-agent-roles.md)

| # | Rule | Old Location | New Location | Notes |
|---|------|-------------|--------------|-------|
| 13 | Sonnet role definition | `agent-manifesto.md` (line 19-24) | "Claude 3.5 Sonnet" section | Kept as-is per user request |
| 14 | Gemini Pro role (CTO/Strategic Auditor) | `agent-manifesto.md` (line 26-28) | "Gemini Pro" section | Updated with expanded guardrails |
| 15 | Gemini Flash role (Agile Sub-Agent) | `agent-manifesto.md` (line 30-33) | "Gemini Flash" section | Kept as-is |
| 16 | Nemotron & Tencent (Standby) | `agent-manifesto.md` (line 35-37) | "Standby Agents" section | Kept as-is |
| 17 | Handoff Protocol | `agent-manifesto.md` (line 41-43) | "Handoff Protocol" section | Clarified with numbered steps |
| 18 | Escalation Protocol | `agent-manifesto.md` (line 45-47) | "Escalation Protocol" section | Kept template format |
| 19 | Inter-agent conflict resolution | (NEW — did not exist) | "Conflict Resolution" section | Added as new capability |

---

## Execution Protocol Mapping (03-execution-protocol.md)

| # | Rule | Old Location | New Location | Notes |
|---|------|-------------|--------------|-------|
| 20 | Plan-before-code (3-bullet plan) | `laguna-core-rules.md` (line 23) | §1 Step 2 | Merged into universal flow |
| 21 | Plan.json + approval workflow | `error-loop-protocol.md` (line 8-15) | §1 Step 2 | MERGED — plan.json approach replaced with inline plan (simpler) |
| 22 | Self-test before merge | `error-loop-protocol.md` (line 17-18) | §1 Step 4 (Side-Effect Check) | Adapted to non-IDE context |
| 23 | Root cause analysis for bugs | (PARTIALLY in error-loop-protocol) | §2.1 | Made explicit and required |
| 24 | Verification statement after fix | (NEW — did not exist) | §2.3 | Added as new step |
| 25 | Architecture check for new features | (NEW — did not exist) | §3.1 | Added to prevent domain violations |
| 26 | Module registration for new features | (IMPLIED in my-vision) | §3.3 | Made explicit |
| 27 | Bulk operations + confirmation | `my-vision.md` (line 22) | §4 | Extracted and detailed |
| 28 | Refactoring protocol | `my-vision.md` (line 14, 26) | §5 | Consolidated from multiple sources |
| 29 | Prohibited actions table | (SCATTERED across all files) | §6 | NEW — centralized reference |

---

## Deprecated Files

| Old File | Status | What Happened |
|----------|--------|---------------|
| `laguna-core-rules.md` | **DEPRECATED** | All rules merged into 01-constitution §2,3,5,8,9,10 and 03-execution-protocol §1 |
| `agent-manifesto.md` | **DEPRECATED** | Roles moved to 02-agent-roles. Execution/handoff protocols moved to 02 and 03 |
| `project-hierarchy.md` | **DEPRECATED** | Directory tree → 01-constitution §4. SoC → §3. Constraints → §10 |
| `error-loop-protocol.md` | **DEPRECATED** | Plan approach merged into 03-execution-protocol §1-2. plan.json dropped (too heavy for chat context) |
| `my-vision.md` | **DEPRECATED** | All principles promoted to constitutional status in 01-constitution |
| `Temperature Assist.md` | **MOVED** | Not a project rule. Move to `meta/` directory as a standalone AI Studio utility prompt |

---

## Conflict Resolution Decisions

| Conflict | Old State | Resolution |
|----------|-----------|------------|
| How to handle bug fixes? | `error-loop-protocol` said "write plan.json, wait, test, merge" vs `laguna-core-rules` said "3-bullet plan then code" | **Merged**: Inline plan in chat (no plan.json file needed), + root cause analysis + verification statement. Plan.json dropped as it's impractical in a chat-based agent context. |
| Where does ZERO-TRUST belong? | Was in `laguna-core-rules` as an execution rule | **Promoted** to Constitutional principle (§8) — it's a non-negotiable architectural rule, not a workflow step. |
| Is handoff part of manifesto or execution? | Was in `agent-manifesto` mixed with roles | **Separated**: Role definitions in 02-agent-roles. Execution steps in 03-execution-protocol. |
| What about inter-agent conflicts? | No mechanism existed | **Added**: New "Conflict Resolution" section in 02-agent-roles with escalation to Gemini Pro (CTO). |