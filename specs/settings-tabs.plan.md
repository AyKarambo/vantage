# Settings View Tabs — Technical Plan

Spec: [settings-tabs.spec.md](settings-tabs.spec.md)

## Architecture & Approach

Convert `renderer/src/views/settings.ts` (584 lines, currently a flat stack of inline card functions) into a folder-based view, following the existing precedent set by `renderer/src/views/targets/` and `renderer/src/views/notion/` (both already `index.ts` + sibling card-module files).

`renderer/src/views/settings/index.ts` becomes the new `settings(ctx): HTMLElement` entry point. It:
1. Renders `viewHead(...)` (unchanged).
2. Renders a `segmented()` tab control with two options, `'general'` and `'masterData'`, labelled "General" and "Master Data".
3. Owns a local `let tab: 'general' | 'masterData' = 'general'` closure variable (fresh on every call — i.e. every invocation of `settings(ctx)` starts on "General"), a `body` container, and a `draw(next)` function that sets `tab = next` and `render(body, next === 'general' ? generalTab(ctx) : masterDataTab(ctx))` — the exact pattern already used by `perHeroSection` in `matchDetail.ts` (segmented control in a card's `actions` slot, `onChange` = the same `draw` used for the initial paint).
4. Calls `draw('general')` once eagerly to paint the initial body, matching `perHeroSection`'s `draw(perHero[0].hero)` bootstrap call.

No new `ViewId`, no shell/routing changes, no store persistence for `tab` — satisfies AC1 and AC5.

Each existing inline card function is extracted verbatim (logic unchanged) into its own sibling file, grouped by tab:

- **General tab** (`generalTab(ctx)` in `settings/general.ts`): composes `accountsCard()`, the Coaching `grid-2` card (`breakReminderEditor(ctx)` + `readinessSettingsEditor(ctx)`), `appBehaviorCard(ctx)`, the inline Appearance card, `diagnosticsCard()`, and `dataLocationCard(ctx)` — same order, same markup as today, just under one function instead of top-level `settings()`.
- **Master Data tab** (`masterDataTab(ctx)` in `settings/masterData/index.ts`): the existing `masterDataCard(ctx)` body (state, `apply()`, update-preview flow), rendered as the tab's content instead of as one card among many.

## Affected Files/Modules

New folder `renderer/src/views/settings/` (deletes `renderer/src/views/settings.ts`):

| File | Contents | Approx. lines |
|---|---|---|
| `settings/index.ts` | `settings(ctx)`: viewHead, tab state, segmented control, `draw()` | ~60 |
| `settings/general.ts` | `generalTab(ctx)`: composes the cards below | ~40 |
| `settings/accounts.ts` | `accountsCard()` (+ any rank-edit modal helper it uses) | ~140 |
| `settings/appBehavior.ts` | `appBehaviorCard(ctx)` | ~55 |
| `settings/diagnostics.ts` | `diagnosticsCard()` | ~20 |
| `settings/dataLocation.ts` | `dataLocationCard(ctx)` | ~75 |
| `settings/masterData/index.ts` | `masterDataTab(ctx)` (formerly `masterDataCard`): owns `data`, `apply()`, update button/`runUpdate()`, composes hero/map/season sections | ~90 |
| `settings/masterData/heroSection.ts` | `heroSection(entries, apply)` | ~25 |
| `settings/masterData/mapSection.ts` | `mapSection(entries, apply)` | ~30 |
| `settings/masterData/seasonSection.ts` | `seasonSection(entries, apply)` | ~95 |
| `settings/masterData/updatePreview.ts` | `openUpdatePreview(preview, onApplied)` modal | ~45 |

Every file stays well under the ~200-line guideline in AC7. The Appearance card (small, stateless beyond direct `isColorblind()`/`setColorblind()`/`store.rerender()` calls) stays inline inside `general.ts` rather than becoming its own file — not worth a dedicated module.

Import path adjustments needed (mirroring how `targets/` and `notion/` already do this): every extracted file moves one directory deeper than `views/settings.ts` was (two deeper for `masterData/*`), so relative imports like `../dom`, `../../src/shared/contract`, `../bridge`, `../components/primitives`, `./view` need an extra `../` (two extra for `masterData/*`, e.g. `./view` → `../view`, `../dom` → `../../dom`).

No other modules need to change. Confirmed via search: no test file imports `views/settings.ts` or its internals directly (`appsettings.test.ts` / `breakReminder.test.ts` test unrelated main-process/shared settings modules), so no test updates are required for AC6's "no regressions" — `npm test`/`npm run typecheck` just need to pass after the move.

## Data Model / Interfaces

No changes to `ViewContext`, `ViewRender`, or any shared-contract type. `masterDataTab(ctx)` keeps using `ctx.data.masterData` exactly as `masterDataCard(ctx)` does today. No new IPC surface.

## Test Strategy

- `npm run typecheck` — verifies the extracted files' relative imports and types resolve correctly (main + renderer tsconfigs), covers AC6.
- `npm test` — full vitest suite must stay green; since no existing tests touch `views/settings.ts` internals, this is a regression check, not new coverage (AC6).
- Manual verification via `npm run preview` (browser harness, no Overwolf runtime needed) walking through AC1–AC4:
  - Settings opens on General tab, shows all non-master-data cards.
  - Clicking "Master Data" shows Heroes/Maps/Seasons sections with working CRUD and the season update/diff-preview flow.
  - Edit a hero, confirm the tab body still reflects the edit (via each section's own `apply()`/repaint, unchanged from today).
  - Navigate to another sidebar view and back to Settings — confirm it reopens on General.
- No new automated tests are required by the spec (this is a structural refactor with no new logic), but it's worth adding one light smoke test if the project's testing conventions call for view-level tests — check with the user before adding, since AC6 only requires "no regressions," not new coverage.

## Risks & Alternatives

- **Tab-reset-on-refresh interaction:** `masterDataTab`'s `apply()` calls `void store.refresh()` after a mutation. Because `store.refresh()` fetches a fresh `DashboardData` object and `shell.ts`'s `renderContent()` re-invokes `VIEWS[state.view](ctx)` whenever the data snapshot's object identity changes (`shell.ts:285-330`), editing a hero/map/season will cause `settings(ctx)` to be fully re-created — which resets the local `tab` variable back to `'general'`, snapping the user off the Master Data tab right after they edit something there.
  - This is **not a new failure mode**: every other piece of local UI state in `settings.ts` today (e.g. the add-hero-form's `role` selector, the add-map-form's `mode` selector) is already wiped out by this same refresh-driven remount — it's a pre-existing characteristic of this view's architecture, not something the tab refactor introduces. Adding the active tab as one more piece of local state that behaves the same way is consistent, not a regression, and matches the user's explicit choice ("reset to first tab every time") more strongly than expected.
  - Alternative considered and rejected: hold `tab` in a module-level variable outside `settings(ctx)` so it survives the remount. Rejected because (a) `ViewRender` has no unmount lifecycle, so there's no reliable way to distinguish "remounted after a same-view refresh" from "remounted after navigating away and back" — a module-level variable would end up persisting across genuine navigation too, contradicting the user's explicit choice of "always reset"; and (b) it would be a broader behavioral change (introducing session persistence) beyond the scope of a pure structural refactor.
  - Flagging this now so the user can weigh in during review if the snap-back-after-edit feels worse in practice than it reads on paper — it's a one-line change to switch strategies later if so.
- **Import path churn:** moving to a folder adds a directory level to every relative import in every extracted file. Mechanical but easy to get wrong; typecheck will catch it immediately, so this is low risk, just needs care during implementation.
- **Alternative implementation rejected (from spec's resolved questions):** keeping everything in one `settings.ts` with inline tab state was considered and explicitly rejected in the spec in favor of extraction, so not re-litigated here.
