# Screen spec: Settings (`settings`)

**Source:** `renderer/src/views/settings.ts`, `renderer/src/components/breakReminderEditor.ts`, `renderer/src/components/logLevelToggle.ts`, `renderer/src/theme.ts`, `src/shared/contract/appSettings.ts`, `src/main/config/appConfig.ts` · reverse-engineered 2026-07-04 after the ui-qol / live-status / debug-log batch (PR #8)
**Provenance tags:** [explicit] stated in code/comments · [inferred] reconstructed from behavior · [spec] intent from the 2026-07-04 feature specs (`ui-qol.spec.md`, `debug-log.spec.md`)

**Shared context:** Sidebar entry under the **App** group. Renders from a `DashboardData` snapshot via `ViewContext` for the break-reminder state; the app-behavior and about cards fetch async from the bridge. Not affected by the global filter bar.

## Intent (WHAT & WHY)

[spec] The canonical app-behavior home (`ui-qol` #10): one sidebar place consolidating the coaching nudge, window behavior, appearance, and diagnostics — instead of settings scattered across screens. The Mental screen keeps its inline break-reminder editor (same component, same persisted config); Settings is where a user *looks* for settings.

## In-Scope

- **Coaching** card: the shared break-reminder editor (`components/breakReminderEditor.ts` — on/off chip + threshold select, 1–5 losses, select disabled while off). [explicit] Edits persist via `setBreakReminder`, apply immediately, and show an Undo toast that restores the previous settings. The reminder mechanism itself is owned by `screen-mental.spec.md`.
- **App behavior** card ([explicit] loaded async via `getAppSettings`; persisted by the main process as `AppUiSettings`):
  - **Close-to-tray** chip — "✕ keeps Vantage in the tray" vs "✕ quits Vantage"; when on, closing the window keeps tracking games in the background.
  - **Run at login** chip — starts the app hidden in the tray at Windows login so it never steals focus from a game.
  - [explicit] Each change applies immediately via `setAppSettings` and shows an Undo toast reverting to the prior value.
- **Appearance** card: colorblind-safe palette chip. [explicit] Toggling swaps the win/loss green–red encoding for blue–orange everywhere — the JS chart palette and the CSS custom properties (`html[data-cvd]`) in one switch — persisted as a renderer pref and applied at bundle load, before the first render.
- **Diagnostics** card (the `debug-log` surface):
  - Log-level toggle (`components/logLevelToggle.ts`) switching the main-process logger between `info` and `debug` for this session.
  - **Open log viewer** button → the Logs screen (`screen-logs.spec.md`).
  - About line — "Vantage `<version>` · support: `<email>`" via `getAppInfo`.

## Out-of-Scope

- Notion token/database management (own screen — `screen-notion.spec.md`).
- Filter presets (owned by the global filter bar — see `screen-shell.spec.md` context).
- An "open logs folder" shortcut ([spec] considered and not selected in `debug-log.spec.md`).
- Editing window bounds — size/position/maximized state persist automatically in the main process and never cross the bridge (`appSettings.ts` docblock).

## Constraints

- [explicit] App-behavior settings live in main-process config (`config.local.json`, `AppConfig.ui`), **not** renderer localStorage — they must apply before the renderer exists (window restore, tray-first launch). The colorblind toggle is renderer-side (`prefs.colorblind`).
- [spec] Settings changes are reversible → they execute immediately with an Undo toast; no confirmation modals here.
- [spec] The debug log-level toggle is session-scoped: it resets to `info` on app restart (`debug-log.spec.md`, resolved question 3).
- [explicit] Works in the browser preview except the main-process settings, which the preview mocks/no-ops (`ui-qol.spec.md` constraint).

## Acceptance Criteria (current behavior)

- Given the Settings screen renders, then Coaching, App behavior, Appearance, and Diagnostics cards are present; App behavior shows "Loading…" until `getAppSettings` resolves.
- Given I toggle the break reminder or change its threshold here, then the same persisted setting the Mental screen edits is updated, an Undo toast appears, and Undo restores the previous value (both screens reflect it on refresh).
- Given I toggle close-to-tray, then the chip re-renders to the new state, a toast describes the new behavior with an Undo action, and ✕ thereafter minimizes to the tray instead of quitting (or vice versa).
- Given I toggle run-at-login, then the setting persists in main-process config and an Undo toast appears.
- Given I enable the colorblind palette, then every chart and win/loss-coloured stat switches to the blue–orange encoding without a restart, and the choice survives relaunch.
- Given I flip the log level to `debug`, then subsequent GEP events produce `debug` summaries in the log (visible in the viewer); after an app restart the level is `info` again.
- Given a click on "Open log viewer", then the Logs screen opens.
- Given `getAppInfo` resolves, then the About line shows the running version and support contact.

## Known gaps (intent ≠ code)

None identified — behavior matches the feature-spec intent. One addition beyond it:

- [inferred] **Run-at-login is an extra.** `ui-qol` #10 enumerated break reminder, close-to-tray, colorblind, and the log toggle/viewer; the run-at-login chip shipped alongside close-to-tray as a natural companion (same `AppUiSettings` persistence). Documented here as intended behavior, not scope creep to revert.

## Open Questions

None.
