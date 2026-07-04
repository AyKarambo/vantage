# Techplan: UI quality-of-life batch (`ui-qol`)

**Source spec:** `specs/ui-qol.spec.md` (approved 2026-07-04). Item numbers `#1–#27` below refer to
that spec's tables.
**Sequencing:** lands **third** (`debug-log` → `live-status` → `ui-qol`) and reuses their
infrastructure: the `EVENT_CHANNELS` push mechanism (Notion sync progress, #20), the
`logLevelToggle` component and log viewer route (Settings, #10), and `components/popover.ts`
(from live-status). Internally, work is phased by spec tier: **A–F (P1) → G (P2) → H (P3)**; each
phase leaves `npm test` + `npm run typecheck` green and the preview harness working.

## Architecture & Approach

Renderer-heavy, with three main-process touchpoints (window memory, close-to-tray, Notion sync
progress). All new UI composes `components/primitives`; new reusable pieces become components.

### A — Shared infrastructure (P1, enables everything else)

1. **Preferences module — new `renderer/src/prefs.ts`.** One typed localStorage facade
   (get/set/remove with JSON + try/catch, same hardening as `loadFilters()`,
   `store.ts:104-118`) owning every UI-pref key: `vantageView`, `vantageHeroSort`,
   `vantageMinGames`, `vantageLogPrefill`, `vantageFilterPresets`, `vantageRecapShown`,
   `vantageColorblind`. Stops key strings scattering across modules.
2. **Toast host — new `renderer/src/components/toast.ts`.** Module-singleton host element appended
   by the shell (z-index 50, above `.overlay`'s 40); `toast(message, { action?: { label, run },
   ttl = 6000 })` stacks bottom-right, pause-on-hover, and an `aria-live="polite"` region.
   Undo is just `action: { label: 'Undo', run: <inverse bridge call> }` — no framework.
3. **Refresh model — `renderer/src/store.ts` + `app/shell.ts`.** Root cause of both flicker and
   scroll-reset: `renderContent` re-renders the active view on **every** state patch
   (`shell.ts:130-159`), including the `loading: true` patch at refetch start. Change:
   - `AppState` splits `loading` (cold start, `data === null`) from `refreshing` (background).
   - The shell tracks `lastRendered = { data, view, params }` and skips `renderContent` when the
     snapshot reference and route are unchanged — the `refreshing` patch no longer touches the DOM
     (#8), which also stops the focus-refresh scroll reset (groundwork for #24).
   - Busy indicator: `.status-dot` gains an `is-busy` spin/pulse class while `refreshing` (shares
     the dot with live-status; busy is an overlay class, not a fifth state).
   - `refresh()` failure with data on screen → keep data, set `stale: true` → status bar shows a
     "stale data — retry" link (#9); failure with no data → error card with Retry button rendered
     by the shell in place of the view (#9). Skeleton cards (`components/skeleton.ts` — shimmer
     blocks shaped like kpi/card rows) render only while `data === null` (#8).
4. **Shortcut registry — new `renderer/src/shortcuts.ts`.** Central `keydown` dispatcher replacing
   the inline Ctrl+K handler (`shell.ts:207-216`): declarative
   `{ combo, when?: () => boolean, run }[]`, with a global guard that ignores keystrokes when
   `e.target` is an input/textarea/select or an overlay is open (except Esc and Ctrl+K — spec
   constraint). Registers: Ctrl+K → palette (#1), Ctrl+1..9 → NAV order (#12), `?` → cheatsheet
   overlay (#12), Esc → back-from-matchDetail (#12), ←/→ on matchDetail (#13), H/P/M on review
   (#18). The cheatsheet overlay is generated from the registry's own declarations (single source).

### B — Command palette (P1, #1)

New `renderer/src/app/palette.ts` + `renderer/src/fuzzy.ts` (hand-rolled subsequence scorer:
char-order match, bonuses for word starts/prefix, ~40 lines — zero deps per spec constraint).
Opens via `openModal` variant styled as a top-centered panel; input + ranked list; ↑/↓/Enter/Esc.
Three sources, all synchronous over data already in the renderer (no new IPC):
- **Screens:** the `NAV` structure (`shell.ts:37-63`).
- **Actions:** log match (`openLogMatch`), go to Notion sync, toggle break reminder
  (`bridge.setBreakReminder` + toast), open log viewer, replay tour (`openOnboarding`).
- **Data:** from the current `DashboardData` snapshot — maps (`d.maps` → navigate `maps` with new
  `ViewParams.highlight`, view scrolls to + flashes the row), heroes (`d.heroes` rows →
  `openHeroDrawer(ctx, hero)`, exported from `views/heroes.ts:41-46`), recent matches
  (`d.matches` rows → `matchDetail`). Spec limits match search to the current snapshot.
The titlebar button (`shell.ts:105-106`) now opens the palette; its copy stays truthful.

### C — Quick-log memory + hero typeahead (P1, #2 #3)

- `app/log-match.ts`: initial `LogState` (`log-match.ts:41-48`) reads `prefs.vantageLogPrefill`
  (`{ role, mode, account }`, written on every successful `persist()`); result/map/hero always
  fresh; `flags` starts **empty** (drops the pre-checked `'Positive comms'`).
- **Canonical hero list — new `src/core/heroes.ts`** (pure): `HEROES_BY_ROLE` + `ALL_HEROES`,
  extracted from `src/core/sampleData/fixtures.ts:14-19` (fixtures then import from it — one
  source of truth; renderer already imports core modules directly, precedent
  `log-match.ts:12` importing `MAP_MODES`). Typeahead source = `ALL_HEROES ∪ heroes seen in
  d.heroes` (covers new heroes arriving via GEP before the list is updated).
- New `components/typeahead.ts`: input + filtered suggestion dropdown (↑/↓/Enter, mouse), free
  text still allowed (spec). Reused later for account-ish fields if needed.

### D — Persistence & comfort (P1, #4 #5 #6)

- **#4:** `store.ts` initial `view` from `prefs.vantageView` (validated against `VIEWS` keys,
  `matchDetail` coerced to `matches`); `setView` persists.
- **#5:** `styles/base.css`: global `:focus-visible { outline: 2px solid var(--accent);
  outline-offset: 2px }` (+ component-level radius fixes); `@media (prefers-reduced-motion:
  reduce)` zeroing `--dur` and disabling `fade-in`/`rise-in`/pulse animations.
- **#6:** shell `setInterval(60s, unref n/a in DOM — plain interval)` re-deriving the status text
  from `state.data.generatedAt` (extract `statusText()` from `store.ts:99-102` into `format.ts`
  so shell can re-run it without a store patch).

### E — Undo semantics (P1, #7)

- Archive target (`views/targets/library.ts`): immediate `setTargetArchived(id, true)` + toast
  Undo → `setTargetArchived(id, false)`.
- Review save (`views/review.ts:104-112`): before `saveReview`, capture the previous
  `MatchReview` (grades+flags) from the snapshot; toast Undo re-saves the prior review (or, when
  none existed, the spec's "reversible" contract is met by re-marking pending: save an empty
  review is **not** possible — instead Undo calls `saveReview` with the captured previous state
  and removes the id from `gradedThisSession`; for first-time grades the captured state is "no
  review", handled by a new `clearReview(matchId)` provider method — one extra IPC method, listed
  below).
- Settings changes (break reminder, close-to-tray): toast with Undo restoring the previous value.
- Permanent delete keeps the existing `openModal` confirmation (`views/targets/library.ts`).

### F — Settings screen + window comfort (P1 #10, P2 #21 #22)

- New `views/settings.ts`, NAV gains an **App** group (Settings; the Logs entry from debug-log
  stays under Data). Sections composed from `card()`:
  - **Coaching:** the break-reminder editor — extracted from `views/mental.ts:48-70` into
    `components/breakReminderEditor.ts`, used by both Mental (unchanged UX) and Settings (spec
    resolved Q7).
  - **App behavior:** close-to-tray toggle (#22), run-at-login display (read-only note pointing
    at the tray toggle, or a second toggle via a new `setRunAtLogin` passthrough — chosen:
    full toggle, the plumbing already exists as tray handler `onToggleAutoLaunch`,
    `tray.ts:12-21`).
  - **Appearance:** colorblind toggle (#26, P3 — section ships with a placeholder note until H).
  - **Diagnostics:** `logLevelToggle` + "Open log viewer" (from debug-log), app version via new
    `getAppInfo()` invoke (version/support email — small, justified by the support flow).
- **Main-process backing:** `AppConfig` gains `ui: { closeToTray: boolean; windowBounds?: Bounds }`
  (defaults `closeToTray: true` — preserves today's behavior where close leaves the tray app
  running, `index.ts:36`). New invokes `getAppSettings()` / `setAppSettings(patch)` persisting via
  `saveLocalConfig`; the close path (`ipcHandlers.ts:99-101` → `dashboardWindow.ts:30`) branches:
  `closeToTray ? win.close() : app.quit()`.
- **#21 window memory:** `dashboardWindow.ts` — on `close`/debounced `resize`/`move`, persist
  `{ bounds, maximized }` to `ui.windowBounds`; `open()` merges saved bounds with the `WINDOW`
  defaults (`dashboardWindow.ts:12`), clamped to the nearest display work area
  (`screen.getDisplayMatching`) so an unplugged monitor can't strand the window.

### G — P2 batch (#11–#20)

- **#11 empty states:** `matches.ts:15` empty branch checks `d.overall.games === 0` vs
  "games exist outside range" (new cheap `DashboardData.totalGamesAllTime` field computed from the
  unfiltered array `computeDashboard` already receives) → "Show all time" button calls
  `setFilter({ days: 'all' })`; Matches also gets a "Log a match" button.
- **#12** in A (registry). **#13 prev/next:** `matchDetail.ts` — neighbors from
  `ctx.data.matches` order; chevron buttons in `backRow` + ←/→ shortcuts.
- **#14 cross-links:** `matches.ts` row meta — hero names and map become inline link-buttons
  (`stopPropagation` so the row click still opens detail) → `openHeroDrawer` / `navigate('maps',
  { highlight })`.
- **#15 reset chip:** `views/view.ts` `filterBar` compares against `DEFAULTS` (exported from
  `store.ts:42`) → chip "N filters · Reset".
- **#16 day grouping:** pure `groupByDay(rows, now)` helper in `src/core/analytics/session.ts`
  (near `calendar`) returning `{ label, rows, wins, losses }[]` — tested; `matches.ts` renders
  group headers.
- **#17 heroes table:** `components/table.ts` gains `storageKey?` option — when set, initial sort
  loads from prefs and header clicks persist (`prefs.vantageHeroSort`); CSS `thead { position:
  sticky; top: 0 }` inside `.table-wrap` (which gets a max-height); heroes view adds a min-games
  `chip` row (≥1/≥5/≥10 → `prefs.vantageMinGames`) filtering rows before `dataTable`.
- **#18 review grading keys:** `views/review.ts` — expanded item registers a scoped shortcut
  context (H/P/M grade the focused target row, focus advances; visible focus ring from #5);
  auto-advance opens the next inbox item on save.
- **#19 chart tooltips:** extract the scatter/donut tooltip mechanics
  (`scatterChart.ts:64-91`, `donutChart.ts:31-52`) into `charts/tooltip.ts`
  (`attachTooltip(wrap, targets, textFor)`); apply to `lineChart` (converted to return a wrapper
  like scatter — its two call sites updated), `horizontalBars` rows, and `calendarHeatmap` cells
  (replacing `title=`).
- **#20 Notion sync feedback:** exporter reports progress — `NotionExporter.export` gains an
  `onProgress(done, total)` callback, forwarded from `notionRuntime` through a new
  `EVENT_CHANNELS.syncProgress` push; `views/notion/syncCard.ts` renders "Syncing n/total…".
  `lastSyncedAt` persisted via `saveLocalNotionConfig({ lastSyncedAt })` on success, surfaced in
  `NotionStatus`, rendered in `statusCard`.

### H — P3 batch (#23–#27)

- **#23 presets:** two savable slots in `prefs.vantageFilterPresets`; chips in the filter bar
  (save current / apply / clear).
- **#24 scroll memory:** with A's skip-rerender in place, a `Map<ViewId, number>` of
  `contentHost.scrollTop` captured on navigate, restored after render (session-only, not
  persisted).
- **#25 session recap:** pure `sessionRecap(games, now)` in `src/core/analytics/session.ts`
  (previous calendar day's W–L, net, best/worst map, flag counts, target hit-rate) added to
  `DashboardData` as `recap?`; overview renders a dismissible card when `recap` exists and
  `prefs.vantageRecapShown !== todayKey`.
- **#26 colorblind:** `renderer/src/theme.ts` colors become getters over a module-level palette
  switched by `prefs.vantageColorblind` (win/loss → blue `#4f8fd6` / orange `#d68a3a`); CSS side
  via `html[data-cvd]` overriding `--win/--loss` tokens; toggle in Settings triggers
  `store.rerender()` after flipping the attribute + palette. Charts already funnel through
  `theme.ts`/tokens, so no per-chart work; W/L letters already provide the secondary channel in
  rows.
- **#27 chart-as-table:** `components/chartCard.ts` — wraps a chart element + a `rows` spec; a
  small toggle in the card header swaps chart ↔ `dataTable`. Adopted by the four main chart cards
  (overview scatter, maps donut/bars, trends line).

**Guardrail audit:** GEP-only (no new data sources; palette/data search reads existing snapshots) ·
no secrets · core purity (new core: `heroes.ts`, `groupByDay`, `sessionRecap`,
`totalGamesAllTime` — all pure+tested; everything else renderer/edge) · CSP-friendly (no deps, no
remote assets; fuzzy/palette hand-rolled) · local-first (all prefs local; no new outbound paths).

## Affected Files/Modules

**Created (renderer):** `prefs.ts`, `fuzzy.ts`, `shortcuts.ts`, `app/palette.ts`,
`components/toast.ts`, `components/skeleton.ts`, `components/typeahead.ts`,
`components/breakReminderEditor.ts`, `components/chartCard.ts` (H), `charts/tooltip.ts`,
`views/settings.ts`.
**Created (core/test):** `src/core/heroes.ts`; tests listed below.
**Modified (renderer):** `store.ts` (view persistence, refreshing/stale states, error paths),
`app/shell.ts` (skip-rerender, skeletons/error card, ticker, NAV App group, registry wiring,
toast host mount), `app/log-match.ts` (#2 #3), `views/view.ts` (#15), `views/matches.ts`
(#11 #14 #16), `views/matchDetail.ts` (#13), `views/heroes.ts` (export drawer opener, #17),
`views/review.ts` (#7 #18), `views/mental.ts` (extract editor), `views/targets/library.ts` (#7),
`views/maps.ts` (highlight param), `views/notion/syncCard.ts` + `statusCard.ts` (#20),
`components/table.ts` (#17), `charts/plots/lineChart.ts` + `horizontalBars.ts` +
`primitives/stats.ts` heatmap (#19), `theme.ts` (#26), `styles/*.css` (focus, reduced-motion,
sticky thead, toast, palette, skeleton, popover reuse), `preview/preview.ts` (new API mocks).
**Modified (main/shared):** `contract/api.ts` + new `contract/appSettings.ts`
(`getAppSettings`/`setAppSettings`/`getAppInfo`/`clearReview` invokes;
`EVENT_CHANNELS.syncProgress`), `config/appConfig.ts` (`ui` block), `dashboard/provider.ts` +
`ipcHandlers.ts` + `dataProvider.ts` (new members), `dashboard/dashboardWindow.ts` (#21, close
branch), `main/index.ts` (wiring), `store/history.ts` (`clearReview`),
`notion/notionExporter.ts` + `main/notionRuntime.ts` (#20), `core/dashboardData.ts`
(`totalGamesAllTime`, `recap`), `core/analytics/session.ts` (`groupByDay`, `sessionRecap`),
`core/sampleData/fixtures.ts` (import from `core/heroes.ts`).
**Docs:** README (palette, settings, shortcuts), affected `specs/screen-*.spec.md` "Known gaps" /
behavior sections updated per change (spec resolved Q1).

## Data Model / Interfaces

```ts
// src/shared/contract/appSettings.ts
export interface AppUiSettings { closeToTray: boolean }
export interface AppInfo { version: string; supportEmail: string }
interface OwStatsApi {
  getAppSettings(): Promise<AppUiSettings>;
  setAppSettings(patch: Partial<AppUiSettings>): Promise<AppUiSettings>;
  getAppInfo(): Promise<AppInfo>;
  clearReview(matchId: string): Promise<void>;          // undo of a first-time review save
  onSyncProgress(cb: (p: { done: number; total: number }) => void): () => void;
}

// src/main/config/appConfig.ts
export interface AppConfig { /* … */ ui: { closeToTray: boolean; windowBounds?: {
  x: number; y: number; width: number; height: number; maximized: boolean } } }

// src/core additions
export const HEROES_BY_ROLE: Record<Role, readonly string[]>; export const ALL_HEROES: string[];
export interface DayGroup { label: string; wins: number; losses: number; rows: MatchRow[] }
export interface SessionRecap { date: string; wins: number; losses: number; net: number;
  bestMap?: string; worstMap?: string; flags: Record<string, number>; targetHitRate?: number }
export interface DashboardData { /* … */ totalGamesAllTime: number; recap?: SessionRecap }

// renderer/src/store.ts
interface AppState { /* … */ refreshing: boolean; stale: boolean }
```

`NotionStatus` gains `lastSyncedAt?: number`; `NotionConfig` persists it.

## Test Strategy

Pure core additions ship with vitest coverage (Definition of Done rule 3):
- `test/heroes.test.ts` — list integrity (non-empty per role, no duplicates, fixtures reuse it).
- `test/dayGrouping.test.ts` — `groupByDay`: Today/Yesterday/date labels around midnight
  boundaries, per-day W–L tallies, ordering (mirrors the `game()` factory pattern).
- `test/sessionRecap.test.ts` — previous-day selection, best/worst map, empty-day → undefined.
- `test/dashboardData` additions — `totalGamesAllTime` unfiltered while `matches` filtered;
  `recap` presence rules.
- `test/manualLog`/`history` additions — `clearReview` round-trip.
- Contract drift is enforced by `npm run typecheck` (preload/bridge/preview must all implement the
  new members — the repo treats this as a feature).
- Renderer behavior (palette, toasts, shortcuts, skip-rerender) is verified manually against the
  spec's Given/When/Then list via `npm run preview` (all P1 ACs are exercisable there except
  window memory/close-to-tray, which the spec exempts) plus a live-app pass for the main-process
  items. No DOM test harness is introduced (repo convention; revisit only if renderer regressions
  become recurring).

## Risks & Alternatives

- **Skip-rerender (A3) is the highest-risk change:** views capture `ctx.data` per render, so
  skipping renders on no-op patches must never skip a *data* change — guarded by re-rendering
  whenever the `data` reference, `view`, or `params` differ (reference equality is reliable:
  `refresh()` always constructs a fresh object). Toasts/status changes deliberately bypass view
  re-render. Fallback if subtle staleness appears: restrict the skip to `refreshing`-only patches
  (smaller win, same flicker fix).
- **Ctrl+K behavior change** (log modal → palette) breaks a muscle-memory habit; mitigated by the
  palette listing "Log match" as the top default action (empty query), so Ctrl+K→Enter ≈ old
  behavior. Onboarding tour step updated.
- **Undo for first-time review saves** needs `clearReview` — one extra IPC/store method; the
  alternative (treat first saves as non-undoable, toast-only) is the fallback if it proves noisy.
- **`lineChart` return-type change** (bare SVG → wrapper) touches its call sites (overview,
  trends) — mechanical but easy to miss one; typecheck catches it (`SVGElement` vs `HTMLElement`).
- **Notion progress push** couples exporter → runtime → window; alternative was renderer polling a
  progress getter (simpler, laggier). Push chosen since the mechanism exists after debug-log.
- **Colorblind palette in JS `theme.ts`** duplicates the CSS-token switch; kept in sync by making
  `theme.ts` the single palette source and generating the two CSS custom-property values from it
  at build time is *over*-engineering — accepted small duplication, pinned by a comment either side.
- **Scope volume:** 27 items invite drift. The tier contract in the spec is the mitigation —
  phases A–F ship alone if needed; G/H are cuttable without `/revise`.
