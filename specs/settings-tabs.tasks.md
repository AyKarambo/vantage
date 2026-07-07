# Settings View Tabs — Tasks

Spec: [settings-tabs.spec.md](settings-tabs.spec.md) · Plan: [settings-tabs.plan.md](settings-tabs.plan.md)

Each task keeps `renderer/src/views/settings.ts` compiling and functioning after it lands — extraction happens incrementally via imports, so `npm run typecheck` / `npm test` stay green at every step until the final task moves the file into its new home.

- [x] **1. Extract `accountsCard()` into `settings/accounts.ts`**
  - **Goal:** Move the Accounts card (list + rank editing) out of `settings.ts` into its own module.
  - **Files:** new `renderer/src/views/settings/accounts.ts`; edit `renderer/src/views/settings.ts` (import `accountsCard` from `./settings/accounts` instead of defining it inline).
  - **Check:** `npm run typecheck` and `npm test` pass; Settings view in `npm run preview` still shows Accounts unchanged.
  - **Size:** S

- [x] **2. Extract `appBehaviorCard(ctx)` into `settings/appBehavior.ts`**
  - **Goal:** Move the window-behavior card (close-to-tray, run at login) into its own module.
  - **Files:** new `renderer/src/views/settings/appBehavior.ts`; edit `renderer/src/views/settings.ts`.
  - **Check:** typecheck/tests pass; App Behavior card unchanged in preview.
  - **Size:** S

- [x] **3. Extract `diagnosticsCard()` into `settings/diagnostics.ts`**
  - **Goal:** Move the log-level/log-viewer card into its own module.
  - **Files:** new `renderer/src/views/settings/diagnostics.ts`; edit `renderer/src/views/settings.ts`.
  - **Check:** typecheck/tests pass; Diagnostics card unchanged in preview.
  - **Size:** S

- [x] **4. Extract `dataLocationCard(ctx)` into `settings/dataLocation.ts`**
  - **Goal:** Move the data-folder-location card into its own module.
  - **Files:** new `renderer/src/views/settings/dataLocation.ts`; edit `renderer/src/views/settings.ts`.
  - **Check:** typecheck/tests pass; Data Location card unchanged in preview.
  - **Size:** S

- [x] **5. Extract `heroSection` and `mapSection` into `settings/masterData/`**
  - **Goal:** Move the Hero and Map CRUD table renderers out of `settings.ts`, unchanged in behavior.
  - **Files:** new `renderer/src/views/settings/masterData/heroSection.ts`, `renderer/src/views/settings/masterData/mapSection.ts`; edit `renderer/src/views/settings.ts` (import both, still used by the still-inline `masterDataCard`).
  - **Check:** typecheck/tests pass; hero add/edit/remove and map add/edit/remove/active-toggle still work in preview.
  - **Size:** S

- [x] **6. Extract `seasonSection` into `settings/masterData/seasonSection.ts`**
  - **Goal:** Move the Season CRUD + online-update diff/accept-discard UI into its own module.
  - **Files:** new `renderer/src/views/settings/masterData/seasonSection.ts`; edit `renderer/src/views/settings.ts`.
  - **Check:** typecheck/tests pass; season add/edit/remove and the update-diff preview flow still work in preview.
  - **Size:** M

- [x] **7. Extract `openUpdatePreview` modal into `settings/masterData/updatePreview.ts`**
  - **Goal:** Move the "update from online source" preview/accept modal into its own module.
  - **Files:** new `renderer/src/views/settings/masterData/updatePreview.ts`; edit `renderer/src/views/settings.ts`.
  - **Check:** typecheck/tests pass; clicking "Update" on master data still opens the diff modal and applies picks correctly.
  - **Size:** S

- [x] **8. Extract `masterDataCard(ctx)` shell into `settings/masterData/index.ts`**
  - **Goal:** Move the remaining master-data shell (local `data` state, `apply()`, update button/`runUpdate()`, composing hero/map/season sections) into its own module, exported as `masterDataCard(ctx)` for now (renamed to `masterDataTab` in task 10 when tab wiring lands).
  - **Files:** new `renderer/src/views/settings/masterData/index.ts`; edit `renderer/src/views/settings.ts` (import `masterDataCard` from `./settings/masterData` instead of defining it inline).
  - **Check:** typecheck/tests pass; Master Data section behaves identically end-to-end in preview.
  - **Size:** M

- [x] **9. Extract remaining top-level composition into `settings/general.ts`**
  - **Goal:** Move the non-master-data composition (Accounts, Coaching `grid-2`, App Behavior, inline Appearance card, Diagnostics, Data Location) into `generalTab(ctx)`.
  - **Files:** new `renderer/src/views/settings/general.ts`; edit `renderer/src/views/settings.ts` (top-level `settings()` now calls `generalTab(ctx)` and `masterDataCard(ctx)` instead of inlining every card).
  - **Check:** typecheck/tests pass; Settings view renders identically to before (single scroll, no tabs yet) in preview.
  - **Size:** S

- [x] **10. Move `settings.ts` into `settings/index.ts` and wire up tabs**
  - **Goal:** Delete the flat `renderer/src/views/settings.ts`; create `renderer/src/views/settings/index.ts` as the new `settings(ctx)` entry point — `viewHead`, a `segmented()` control (`General` / `Master Data`), local `tab` state defaulting to `'general'`, and a `draw()` function (matching `matchDetail.ts`'s `perHeroSection` pattern) that renders `generalTab(ctx)` or `masterDataTab(ctx)` (renamed from `masterDataCard`) into the body.
  - **Files:** new `renderer/src/views/settings/index.ts`; delete `renderer/src/views/settings.ts`; rename `masterDataCard` → `masterDataTab` in `settings/masterData/index.ts`.
  - **Check:** typecheck/tests pass; Settings opens on General tab; clicking "Master Data" swaps the body to the master-data sections and back.
  - **Size:** M

- [x] **11. Final acceptance walkthrough**
  - **Goal:** Confirm the whole feature meets every acceptance criterion end-to-end, not just per-file.
  - **Files:** none (verification only, via `npm run preview`).
  - **Check:** AC1 (tab control defaults to General) · AC2 (General tab content matches pre-refactor Settings minus master data) · AC3 (Master Data tab content/behavior unchanged) · AC4 (editing on one tab doesn't newly break switching back, beyond the pre-existing refresh-remount behavior noted in the plan's Risks section) · AC5 (navigating away to another sidebar view and back reopens on General) · AC6 (`npm test` + `npm run typecheck` green) · AC7 (`wc -l` on every file under `renderer/src/views/settings/` stays roughly ≤200 lines).
  - **Size:** S

## Consistency gate

| Acceptance criterion (spec) | Covered by task(s) |
|---|---|
| AC1 — tab control renders, defaults to General | 10, 11 |
| AC2 — General tab content/behavior unchanged | 1, 2, 3, 4, 9, 11 |
| AC3 — Master Data tab content/behavior unchanged | 5, 6, 7, 8, 11 |
| AC4 — switching tabs doesn't newly lose state | 10, 11 |
| AC5 — re-entering Settings always resets to General | 10, 11 |
| AC6 — typecheck + tests pass, no regressions | every task's Check, 11 |
| AC7 — no file exceeds ~200 lines | 1–10 (extraction sizing), 11 (verification) |

No acceptance criteria are without a task, and no task traces to something outside the plan's affected-files list — no gaps, no scope creep.
