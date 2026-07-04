# Screen spec: Application shell (cross-screen behaviors)

**Source:** `renderer/src/app/shell.ts`, `renderer/src/app/palette.ts`, `renderer/src/fuzzy.ts`, `renderer/src/shortcuts.ts`, `renderer/src/gepStatus.ts`, `src/core/gepHealth.ts`, `src/main/gepStatusMonitor.ts`, `renderer/src/components/toast.ts`, `renderer/src/components/popover.ts`, `renderer/src/components/skeleton.ts`, `renderer/src/app/log-match.ts`, `renderer/src/store.ts`, `renderer/src/prefs.ts`, `renderer/src/main.ts` · reverse-engineered 2026-07-04 after the ui-qol / live-status / debug-log batch (PR #8)
**Provenance tags:** [explicit] stated in code/comments · [inferred] reconstructed from behavior · [spec] intent from the 2026-07-04 feature specs (`ui-qol.spec.md`, `live-status.spec.md`, `debug-log.spec.md`)

**Shared context:** The shell owns everything that is not a screen: the frameless titlebar, the sidebar (nav groups, Review pending badge, "Today's session" card), the global filter-bar host, the content host with the refresh model, and the status bar. Screens render from a `DashboardData` snapshot via `ViewContext` and never own global chrome. This spec is the referenced home for the shell-level behaviors the per-screen specs point at.

## Intent (WHAT & WHY)

[spec] One behavior layer that makes the app *feel* like a polished daily companion: a command palette so everything is reachable from the keyboard, a central shortcut registry with honest guards, a **truthful** connection indicator (attached ≠ alive — a wrong "receiving" is worse than no indicator), a toast/undo feedback layer, and a refresh model that never flickers loaded data away.

## In-Scope

**Command palette** (`Ctrl+K`, or the titlebar "Search or log a match" button):
- [explicit] Item groups, in curated default order: **Action** (Log match · Keyboard shortcuts · Replay the intro tour), **Screen** (every sidebar entry), **Map** (each map in the current snapshot → Maps view with `{ highlight }`), **Hero** (each hero with stats → hero drill-down drawer), **Match** (the 30 most recent rows of the current snapshot → match detail; hero names, game type, and account are matchable keywords).
- [explicit] Hand-rolled fuzzy ranking (`fuzzy.ts`), max 12 results; the empty query shows the curated order with actions first, so `Ctrl+K` → `Enter` still logs a match (the old Ctrl+K muscle-memory).
- [explicit] Fully keyboard-driven: type to filter, ↑/↓ to move (wraps), Enter to run, Escape closes; mouse hover moves the selection. Guarded against double-open; opens only once a data snapshot exists.

**Shortcut registry** (`shortcuts.ts`):
- [explicit] Declarative bindings (`combo`, `description`, `group`, optional `when` / `allowInInput` / `hidden`) dispatched by a single window `keydown` listener. Guards on every binding: never fires while an input/textarea/select/contenteditable has focus, and never while an overlay or popover is open — except bindings marked `allowInInput` (Ctrl+K).
- [explicit] The `?` cheatsheet overlay renders itself from the registrations, grouped, in registration order.
- Registered by the shell: `Ctrl+K` (palette), `?` (cheatsheet), `Ctrl+1…9` (sidebar order, first nine entries), `Escape` (back to Matches, only on a match detail), `←`/`→` (older/newer match, only on a match detail). The Review screen registers `H`/`P`/`M`/`S` (see `screen-review.spec.md`).

**Status-bar connection indicator** (the renderer surface of `live-status.spec.md`):
- [explicit] Dot + label rendering the four-state model from `src/core/gepHealth.ts` (`no-game` · `connected` · `live` · `stale`), with deliberately truthful labels: "No game" · "Connected — waiting for events" · "Receiving data" · "⚠ No data for Ns" (stale, with live seconds-of-silence). A non-GEP sensor (`counterwatch`, demo/no-live-feed runs) always renders the no-game dot with "No live feed" — it can never claim Connected or Live.
- [explicit] Click opens a live-updating details popover: state, last event (relative time), events this session, match-in-progress flag, feed attach time, and the feed's last error when present; relative times re-render on a 10s tick while open.
- [explicit] Renderer mirror (`gepStatus.ts`): one snapshot pull at startup and on window focus (in case pushes were dropped), then push updates over `onGepStatus`. The main-process monitor (`gepStatusMonitor.ts`) re-evaluates on every feed signal and on a 15s tick, so mid-match staleness is detected at most ~15s after the 60s silence deadline; every state transition is logged (see `debug-log.spec.md`) and mirrored onto the tray icon + tooltip (main process, `live-status.spec.md`).

**Toast + undo layer** (`components/toast.ts`):
- [explicit] One host stacking toasts bottom-right, `aria-live="polite"`; default TTL 6s (spec floor: ≥5s), hover pauses the timer; optional single action button. [spec] Reversible actions execute immediately and offer **Undo** in the toast (review save, target archive, settings changes); only permanent target delete keeps a confirmation modal.

**Flicker-free refresh model** (`store.ts` + shell content host):
- [explicit] Cold start renders skeleton cards; every later refetch (filter change, window focus, manual retry) keeps the current snapshot rendered with a small busy indicator until the new one lands. A failed background refresh keeps the stale data visible and shows a "⚠ stale — retry" link; a failed cold start renders an inline error card with **Retry**.
- [explicit] The content host re-renders only when the snapshot, route, params, or an explicit `rerender()` epoch changes — status-bar-only updates never redraw the content.
- [explicit] Window focus triggers a background refetch (stale-while-revalidate for newly tracked games).

**View restore & scroll memory:**
- [explicit] The active top-level view persists (`prefs.view`) and is restored on launch; a match detail persists as `matches` (the app never reopens on `matchDetail`).
- [explicit] Per-route scroll positions are remembered in-session and restored when navigating back (notably Matches ↔ matchDetail); a data refresh on the same route keeps the current scroll.

**Status text:** [explicit] "N games · updated Xm ago" is re-derived every 60s while idle, so the relative time never lies.

**Quick-log modal** (`app/log-match.ts` — opened from the Overview CTA or the palette's Log match action):
- [explicit] Prefills **role and mode** from the last logged match (`prefs.logPrefill`); result/map/hero always start fresh; mental flags start **empty** (no pre-checked "Positive comms" bias).
- [explicit] The hero field is a typeahead over the canonical hero list (`src/core/heroes.ts`) plus any hero already present in the player's data; free text stays allowed.
- [explicit] "Save ⏎" and "Save & next" (reopens the modal for the next game); saving shows a confirmation toast and refreshes the dashboard.

**Accessibility & motion:** [explicit] visible `:focus-visible` rings on interactive elements; `prefers-reduced-motion` disables transitions/animations (`base.css`).

**Error forwarding:** [explicit] uncaught renderer errors and unhandled rejections are forwarded over `logRendererError` into the main-process release log (`renderer/src/main.ts`), so field problems are diagnosable from the Logs screen.

## Out-of-Scope

- Tray-icon rendering and window-bounds/close-to-tray mechanics — main-process; specified in `live-status.spec.md` and surfaced in `screen-settings.spec.md`.
- Palette search across *all* historical matches — [spec] confirmed out of scope; the palette searches the current snapshot only (its 30 most recent match rows).
- Light theme, responsive/mobile layout, localization ([spec] reaffirmed).

## Constraints

- **Guardrail #4 (CSP, single bundle):** the fuzzy matcher, palette, popover, toasts, and skeletons are hand-rolled `components/` primitives — zero new runtime dependencies.
- [explicit] Connection staleness derives only from sanctioned GEP signals (guardrail #1); the state model is pure and Electron-free in `src/core/gepHealth.ts` (`STALE_AFTER_MS = 60_000`, a named constant, not user-configurable), unit-tested in `test/gepHealth.test.ts`.
- [explicit] The staleness clock only runs while a match is in progress; between matches the state decays to Connected, and any event flips Stale → Live immediately. `live` is only ever shown mid-match with recent events.
- [explicit] All shell UI preferences (view, log prefill, presets, recap-shown, colorblind) go through the one typed `prefs` facade over localStorage; storage failures degrade silently to defaults.
- [explicit] The preview harness simulates all four connection states via `?gep=live|stale|connected|no-game` (or `?gep=cycle`), so the indicator is testable without a game.

## Acceptance Criteria (current behavior)

- Given the app is open with data, when I press Ctrl+K (even while an input has focus) and type "ana", then the palette lists the hero Ana → Enter opens the hero drawer; typing "trends" surfaces the Trends screen; an empty query lists Log match first so Enter logs a match.
- Given the palette lists a map, when I select it, then the app navigates to Maps and that map's bar is scrolled into view and flashed (see `screen-maps.spec.md`).
- Given focus is not in a text field and no overlay is open, when I press Ctrl+3, then the third sidebar view opens; `?` opens the cheatsheet listing every visible registered shortcut by group.
- Given a match detail is open, then Esc returns to Matches and ←/→ step to the older/newer match in the filtered list.
- Given OW2 is not running, then the indicator shows "No game"; given GEP attaches with no events, "Connected — waiting for events" (never a data-flowing claim); given mid-match events, "Receiving data"; given a match in progress and 60s of silence, "⚠ No data for Ns" with a warning treatment — recovering to Live on the next event without user interaction.
- Given demo data / a non-GEP sensor, then the indicator reads "No live feed" and never shows Connected or Live.
- Given a click on the indicator, then the popover shows state, last-event relative time, session event count, match-in-progress, and attach time, updating live while open.
- Given data is loaded and the window regains focus, when the refetch runs, then the previous content stays visible (no blank/loading swap) with a busy indicator; given the refetch fails, the data stays with a "⚠ stale — retry" link; given a cold-start failure, an error card with Retry renders.
- Given I quit on Heroes, when I relaunch, then Heroes is active; given I quit on a match detail, then Matches is active.
- Given I scroll the Matches list, open a match detail, and press Esc, then the list is restored at the same scroll position (same session).
- Given my last logged match was Support/Competitive, when I open Log match, then role=Support and mode=Competitive are prefilled, no mental flag is pre-checked, and typing "zar" in the hero field suggests Zarya, selectable by keyboard.
- Given the renderer throws an uncaught error, then it appears in the main-process log with a `renderer` scope.

## Known gaps (intent ≠ code)

- [spec] **Palette actions are a subset of the ui-qol spec's list.** `ui-qol.spec.md` #1 names "sync Notion, toggle break reminder, open log viewer" as palette actions; the shipped actions are Log match, Keyboard shortcuts, and Replay the intro tour. The Notion, Settings, and Logs *screens* are reachable as Screen entries (so "open log viewer" is one fuzzy match away), but there is no direct sync-Notion or toggle-break-reminder action.
- [spec] **Quick-log prefill omits the account.** `ui-qol.spec.md` #2 promises role, mode, **and account** prefill; the modal has no account field at all, so only role and mode are remembered (`prefs.logPrefill`). Nothing exists for an account prefill to act on.

## Open Questions

None — palette ranking details were left as implementer's choice ([spec] not gated), and the four state labels were settled during implementation ("Connected — waiting for events" wording).
