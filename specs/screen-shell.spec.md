# Screen spec: Application shell (cross-screen behaviors)

**Source:** `renderer/src/app/shell.ts`, `renderer/src/app/palette.ts`, `renderer/src/fuzzy.ts`, `renderer/src/shortcuts.ts`, `renderer/src/gepStatus.ts`, `src/core/gepHealth.ts`, `src/main/gepStatusMonitor.ts`, `src/core/rankDisplay.ts` (`rankParts`), `renderer/src/components/toast.ts`, `popover.ts`, `skeleton.ts`, `renderer/src/app/log-match.ts`, `renderer/src/store.ts`, `renderer/src/prefs.ts`, `renderer/src/main.ts`.

**Shared context:** The shell owns everything that is not a screen: the frameless titlebar, the sidebar (nav groups, Review pending badge, "Today's session" card), the global filter-bar host, the content host with the refresh model, and the status bar. Screens render from a `DashboardData` snapshot via `ViewContext` and never own global chrome. This is the referenced home for the shell-level behaviors the per-screen specs point at.

## Intent

One behavior layer that makes the app *feel* like a polished daily companion: a command palette so everything is reachable from the keyboard, a central shortcut registry with honest guards, a **truthful** connection indicator (attached ≠ alive), a toast/undo feedback layer, and a refresh model that never flickers loaded data away.

## Sidebar & navigation

- **Nav items** carry an `icon` that is either a text glyph (`◈`, `⚑`, `▤`, …) or an inline-SVG **`Node`** (`NavItem.icon: string | Node`); e.g. **Targets** uses a goal-flag SVG icon rather than a glyph.
- **Account chip** (top-left): shows the active account (the selected account filter, or the most-played one when viewing "all accounts") with its rank composed through the shared rank renderer (`rankParts`) — the tier/division label, buffer/progress %, and a 🛡 shield when protected (no movement arrow; that's Overview-KPI-only). It falls back to the winrate heuristic only when the account has no anchor. Clicking the chip (`role="button"`, Enter/Space) opens an **account switcher** popover: **All accounts** + every account in the snapshot (the active one checked, each rendered with the same shared rank parts), then **Manage accounts →** (jumps to Settings). Switching re-scopes the whole dashboard via the global account filter and re-points the rank line.

## Command palette (`Ctrl+K`, or the titlebar "Search or log a match" button)

- Item groups, in curated default order: **Action** (Log match · Keyboard shortcuts · Replay the intro tour), **Screen** (every sidebar entry), **Map** (each map → Maps view with `{ highlight }`), **Hero** (each hero with stats → hero drill-down drawer), **Match** (the 30 most recent rows → match detail; hero names, game type, and account are matchable keywords).
- Hand-rolled fuzzy ranking (`fuzzy.ts`), max 12 results; the empty query shows the curated order with actions first, so `Ctrl+K` → `Enter` still logs a match.
- Fully keyboard-driven: type to filter, ↑/↓ to move (wraps), Enter to run, Escape closes; mouse hover moves the selection. Guarded against double-open; opens only once a data snapshot exists.

## Shortcut registry (`shortcuts.ts`)

- Declarative bindings (`combo`, `description`, `group`, optional `when` / `allowInInput` / `hidden`) dispatched by one window `keydown` listener. Guards on every binding: never fires while an input/textarea/select/contenteditable has focus, and never while an overlay or popover is open — except bindings marked `allowInInput` (Ctrl+K).
- Registered by the shell: `Ctrl+K` (palette), `?` (cheatsheet), `Ctrl+1…9` (first nine sidebar entries), `Escape` (back to Matches, only on a match detail), `←`/`→` (older/newer match, only on a match detail). The Review screen registers `H`/`P`/`M`/`S` (see `screen-review.spec.md`).
- The `?` cheatsheet overlay renders itself from the registrations, grouped, in registration order, with comfortable padding and aligned key badges.

## Status-bar connection indicator

- Dot + label rendering the four-state model from `src/core/gepHealth.ts` (`no-game` · `connected` · `live` · `stale`) with truthful labels: "No game" · "Connected — waiting for events" · "Receiving data" · "⚠ No data for Ns" (stale, with live seconds-of-silence). A non-GEP sensor (`counterwatch`, demo/no-live-feed runs) always renders the no-game dot with "No live feed" — it can never claim Connected or Live.
- Click opens a live-updating details popover: state, last event (relative time), events this session, match-in-progress flag, feed attach time, and the feed's last error when present; relative times re-render on a 10s tick while open.
- Renderer mirror (`gepStatus.ts`): one snapshot pull at startup and on window focus, then push updates over `onGepStatus`. The main-process monitor re-evaluates on every feed signal and on a 15s tick; every transition is logged and mirrored onto the tray icon + tooltip.

## Toast + undo layer (`components/toast.ts`)

- One host stacking toasts bottom-right, `aria-live="polite"`; default TTL 6s (floor ≥5s), hover pauses the timer; optional single action button. Reversible actions execute immediately and offer **Undo** (review save, target archive, rank/settings changes); only permanent target delete and account-data deletion keep a confirmation modal.

## Flicker-free refresh model (`store.ts` + content host)

- Cold start renders skeleton cards; every later refetch (filter change, window focus, manual retry) keeps the current snapshot rendered with a small busy indicator until the new one lands. A failed background refresh keeps the stale data with a "⚠ stale — retry" link; a failed cold start renders an inline error card with **Retry**.
- The content host re-renders only when the snapshot, route, params, or an explicit `rerender()` epoch changes — status-bar-only updates never redraw the content. Window focus triggers a background refetch (stale-while-revalidate for newly tracked games).

## Global filter bar (`views/view.ts` `filterBar`, rendered above every screen)

- **Role · Season** selects. There is no Mode filter (the app is competitive-only everywhere) and no Account control in the bar (account selection lives in the sidebar switcher; `account` stays in filter state/IPC, just not as a bar control). Persisted across launches (`vantageFilters` localStorage); old persisted `mode` keys are ignored on load.
- **Season entries:** `Last 7 days`, `Last 30 days`, one entry per season with ≥1 competitive match (current season always included), newest first, then `All time` (`src/core/season.ts`).
- **Reset chip:** when any filter differs from the defaults (role=all, days=30), a "Reset (N)" chip restores the defaults in one click (the active account is left untouched — that's the switcher's job).
- **Presets:** up to 2 saved filter combinations as one-click chips (auto-named, e.g. "Support · 30d"); "+ save preset" appears while the current combination is non-default and unsaved; right-click removes a preset. Persisted via `prefs.filterPresets`.
- **Per-view suppression:** `FILTERLESS_VIEWS` in `shell.ts` (currently just `readiness`) hides the filter bar for a view whose data is intentionally unscoped by any filter or the account switcher (see `readiness-score-rework.spec.md`).

## View restore, scroll memory & status text

- The active top-level view persists (`prefs.view`) and is restored on launch; a match detail persists as `matches` (the app never reopens on `matchDetail`).
- Per-route scroll positions are remembered in-session and restored when navigating back (notably Matches ↔ matchDetail); a data refresh on the same route keeps the current scroll.
- Status text "N games · updated Xm ago" is re-derived every 60s while idle, so the relative time never lies.

## Quick-log modal (`app/log-match.ts`, opened from the Overview CTA or the palette's Log match action)

- Prefills **role** from the last logged match (`prefs.logPrefill`); result/map/hero always start fresh; mental flags start empty. Every quick-logged match is sent as `gameType: 'Competitive'` (there is no mode picker).
- The hero field is a typeahead over the canonical hero list (`src/core/heroes.ts`) plus any hero already in the player's data; free text stays allowed.
- Active improvement targets are listed with optional inline 3-way grading; a competitive log can also enter the match's SR %.
- "Save ⏎" and "Save & next" (reopens for the next game); saving shows a confirmation toast and refreshes the dashboard.

## Accessibility, motion & error forwarding

- Visible `:focus-visible` rings on interactive elements; `prefers-reduced-motion` disables transitions/animations.
- Uncaught renderer errors and unhandled rejections are forwarded over `logRendererError` into the main-process release log, so field problems are diagnosable from the Logs screen.

## Out-of-Scope

- Tray-icon rendering and window-bounds/close-to-tray mechanics — main-process (surfaced in `screen-settings.spec.md`).
- Palette search across *all* historical matches — the palette searches the current snapshot only (its 30 most recent match rows).
- Light theme, responsive/mobile layout, localization.

## Constraints

- **Guardrail #4 (CSP, single bundle):** the fuzzy matcher, palette, popover, toasts, and skeletons are hand-rolled `components/` primitives — zero new runtime dependencies.
- Connection staleness derives only from sanctioned GEP signals (guardrail #1); the state model is pure and Electron-free in `src/core/gepHealth.ts` (`STALE_AFTER_MS = 60_000`), unit-tested. The staleness clock runs only while a match is in progress; `live` is only ever shown mid-match with recent events.
- All shell UI preferences (view, log prefill, presets, recap-shown, winrate scheme) go through the one typed `prefs` facade over localStorage; storage failures degrade silently to defaults.
- The preview harness simulates all four connection states via `?gep=live|stale|connected|no-game` (or `?gep=cycle`).
