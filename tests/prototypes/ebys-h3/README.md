# H3-A isolated proof

This is **not production code**. Product files and `firestore.rules` stay untouched. Run from the repository root; use only the demo project and dedicated test ports below.

```powershell
node tests/prototypes/ebys-h3/build-rules.mjs
npx.cmd --no-install firebase emulators:exec --config tests/prototypes/ebys-h3/emulator.json --only firestore --project demo-ebys-h3 "node tests/prototypes/ebys-h3/run.mjs"
node tests/prototypes/ebys-h3/legacy-units.mjs
```

`run.mjs` requires `FIRESTORE_EMULATOR_HOST=127.0.0.1:8283`. Hub/logging ports: 4423/4523. Do not point these tests at the interactive 8080/9099 emulator. The test environment installs full Rules before any tested request. `withSecurityRulesDisabled` is used only for fixture setup and independent inspection of an absent record; normal commands use authenticated SDK contexts.

- `build-rules.mjs` verifies the full source SHA-256, verifies every patch's exact match count, and generates candidate Rules plus a patch manifest under ignored `scratch/ebys-h3a-evidence/`.
- `extension.rules` contains new-pointer/financial validation. The builder additionally guards every generic purchase write path and separates author editing from process/closing transitions without removing their checks.
- `harness.mjs` uses the installed Firebase SDK, existing schema/money/EBYS service source and real transactions. It adds a first-finance hook and process purchase ID **in VM memory**. New save/freeze are prototype implementations. Production SDK is 10.7.1; installed test SDK is 12.19.0. The prototype does not prove browser integration or the production-SDK transport.
- `prototype.test.mjs` exercises normal staff authors, different approvers, history, finance, atomicity, concurrency and execution. A rejected request containing an expression/access budget error fails its negative test.
- `candidate-loader.mjs` redirects only reads of the root Rules file in the **test process**. Existing `tests/rules/*.test.mjs` files run unchanged against the full candidate. No test is skipped to obtain a green result.
- `legacy-units.mjs` is a local JSON analyzer with no database dependency or write mode.

Evidence: `prototype-final.log`, `candidate-regression.log`, `run-results.json`, `measurements.json`, `coverage.json`, and emulator logs. Measurements count SDK document calls/write preparations, including retries/rejected preparations; they do not count billing or the exact Rules expression budget. Coverage is aggregate coverage, not a per-request counter.

Source Rules hash in the builder intentionally becomes stale if a later task changes production Rules. Rebase/review the exact patch before changing that expected hash. Never silently refresh it or deploy the candidate file.
