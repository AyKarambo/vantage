---
slug: log-match-improvements-2
status: planned
updated: 2026-07-07
---

# Techplan: Log Match screen improvements (round 2)

**Reads:** `specs/log-match-improvements-2.spec.md` (approved).

## Spec correction (minor)

The spec's performance-slider bullet says "light/dark and CVD-palette aware." This app has **no
light theme** — `renderer/styles/tokens.css` defines one dark `:root` palette plus a colorblind
variant under `html[data-cvd]` (no `prefers-color-scheme`/`[data-theme]` anywhere). The slider only
needs to be **CVD-aware** (react to the same palette swap winrate colors already do via
`theme.ts`'s `PALETTE`/`wrHue`). Noted here rather than reopening the spec gate for a wording fix.

## Architecture & Approach

Five independent-but-adjacent changes to the same modal/components. Order below is dependency order
(data model → shared components → call sites → settings → tests/docs).

### 1. Map field → locked combobox

Extend `typeahead.ts` (currently free-text-always, single caller: `log-match.ts`'s map field) rather
than building a new component:

- New `TypeaheadOpts` fields: `searchSuggestions?: readonly string[]` (pool used once the user has
  typed a query; falls back to `suggestions` when omitted — so every other/future caller is
  unaffected), `mutedItems?: ReadonlySet<string>` (renders those entries with an `is-muted` class,
  sunk to the bottom of the filtered list), `strict?: boolean` (new blur behavior below).
- `refilter()`: the *empty-query* branch keeps using `opts.suggestions` (unchanged — this is
  `mapSuggestions(ctx)`, recent-then-active, exactly as today). The *typed-query* branch filters over
  `opts.searchSuggestions ?? opts.suggestions` — for the map field this will be the full active+
  inactive name list, muted-set = inactive names.
  Sorting: starts-with, then contains (as today), with a **stable** secondary sort sinking any
  `mutedItems` member to the end of the (already-capped) list.
- Track a `committed` variable (module-local to the closure), seeded from `opts.value`, updated by
  `pick()`. Replace the current unconditional
  `input.addEventListener('blur', () => setTimeout(closeList, 100))` with a strict-aware version:
  after the same 100ms delay (unchanged — it must still let a `mousedown` pick land first), when
  `opts.strict` — if the typed text case-insensitively matches an entry in
  `searchSuggestions ?? suggestions`, commit and normalize casing to the canonical entry; otherwise
  revert `input.value` to `committed` and fire `opts.onChange(committed)` so the caller's state can
  never drift out of sync with what's displayed. Non-strict callers (none today, but the option
  defaults `false`) keep the exact current behavior.
- `log-match.ts`: add `allMapNames(ctx)` (all `ctx.data.masterData.maps` names, sorted) next to the
  existing `mapSuggestions(ctx)`; pass `searchSuggestions: allMapNames(ctx)`,
  `mutedItems: new Set(ctx.data.masterData.maps.filter(m => !m.isActive).map(m => m.name))`,
  `strict: true` into the map field's `typeahead({...})` call. `resolveMap()` stays **unchanged** —
  it already resolves against the full (active+inactive) `ctx.data.masterData.maps` list, which is
  now guaranteed to match whatever strict mode committed.
- **Save-blocked-while-invalid:** track a small reactive `updateSaveEnabled()` closure (toggles
  `.disabled` on both the "Save ⏎" and "Save & next" buttons) called from the map field's `onChange`
  and after every strict-blur revert. Enabled iff `resolveMap()` is non-null. This replaces the
  current "error only surfaces at save time" behavior with continuous validity, while keeping the
  existing inline `mapError` message for the (now much rarer) case someone still manages to submit
  via Enter mid-edit.
- CSS: add `.typeahead-item.is-muted { opacity: 0.55; }` to `components.css` next to the existing
  `.typeahead-item` rules — same visual language `mdRow`'s `muted` param already uses for inactive
  maps in the Settings editor.

### 2. Hero picker → most-played shortlist + search

New pure core function, new bridge call, extended shared component:

- `src/core/analytics/heroSuggestions.ts` (new, pure/Electron-free): `mostPlayedHeroes(games:
  GameRecord[], account: string, role: Role): string[]` — for `role === 'openQ'`, tallies hero
  occurrences across **every** game for that account regardless of recorded role (Open Queue players
  still favor the same heroes whatever role they land); otherwise tallies only games where
  `g.account === account && g.role === role`. Returns hero names sorted by descending count (ties
  broken alphabetically for determinism). This mirrors `heroStats()`'s counting semantics (each hero
  in `g.heroes` counts once per game) without the stat-rollup overhead `heroStats()` carries.
- New IPC surface (mirrors the existing `listAccounts`/`getRanks` pattern the log-match modal already
  fetches up front): `OwStatsApi.mostPlayedHeroes(): Promise<Record<string, Partial<Record<Role,
  string[]>>>>` — channel `hero:most-played`. Computed in `dataProvider.ts` over **all** of
  `deps.history.all()` (unfiltered — like `reviewInbox`, a durable all-time signal, not scoped to
  whatever the global dashboard filter currently shows), for every `(account, role)` pair that has
  at least one game, via the new core function. `DataProvider` interface gets
  `mostPlayedHeroes(): Record<string, Partial<Record<Role, string[]>>>`; `ipcHandlers.ts` wires
  `handle(ch.mostPlayedHeroes, () => provider.mostPlayedHeroes())`.
- `openLogMatch`'s existing `Promise.all([bridge.listAccounts(), bridge.getRanks()])` becomes a
  3-way `Promise.all([..., bridge.mostPlayedHeroes()])`; the result threads into `buildForm` as a
  new param `mostPlayed: Record<string, Partial<Record<Role, string[]>>>`.
- `heroPicker.ts`: extend `paintHeroChips`'s signature with a 5th, optional `opts?: { shortlist?:
  readonly string[]; search?: boolean }`. When omitted (every current call — `matchDetail.ts`'s
  editor), behavior is **byte-identical** to today (full role-filtered grid, no search box). When
  `opts.shortlist` is given (log-match only): the chip pool is `shortlist` (already the right size —
  capped by the caller) unioned with `selected` (so already-picked heroes stay visible/removable, same
  guarantee as today), plus, when `opts.search` is true, a small text input above the grid that
  live-filters `heroesForRole(role, heroes)` (the *full* eligible pool, unchanged helper) as the user
  types, rendering matches as the same toggleable chip — clicking one toggles it into `selected`
  exactly like a shortlist chip. Search box clears on role change (repaint).
- `log-match.ts`: `paintHeroes()` computes `const limit = prefs.get('suggestedHeroCount') ??
  DEFAULT_SUGGESTED_HEROES /* 6 */`, `const shortlist = (mostPlayed[state.account]?.[state.role] ??
  []).slice(0, limit)`, and calls `paintHeroChips(heroHost, state.heroes, state.role,
  ctx.data.masterData.heroes, { shortlist, search: true })`. Re-painted on role change (existing
  trigger) **and** on account change (`accountField`'s `onChange` now also calls `paintHeroes()`,
  alongside its existing `paintRank()` call) since the shortlist is account-scoped.

### 3. Suggested-hero-count setting

- `prefs.ts`: add `suggestedHeroCount: number` to `PrefsShape`. No special-case in `get`/`set` needed
  (plain passthrough, unlike `matchColumns`/`filterPresets`) — a missing key just reads `undefined`
  and callers apply the `6` default themselves, matching how `minGames` already behaves for its
  consumer.
- `settings.ts`: new small card `quickLogCard(ctx)` (placed next to `masterDataCard`, since both are
  about the logging experience — the existing "Appearance"/"App behavior" cards are about unrelated
  concerns) with a single bounded numeric input (clamp 3–15, same shape as
  `breakReminder`'s `clampAfterLosses` helper but simpler — a local `clamp(n, 3, 15)`), defaulting the
  displayed value to `prefs.get('suggestedHeroCount') ?? 6`, writing via `prefs.set` on change, no
  `store.refresh()` needed (log-match reads the pref fresh each time it opens).

### 4. Rank — Set-current prefill + wheel parity

- `log-match.ts`: `paintRank()`'s `'set-current'` branch currently always renders `rankPicker()`
  seeded from `state.anchorTier/anchorDivision/anchorPct`'s current in-memory values (Gold/3/'' at
  form init, never re-seeded on toggle). Add a `seedAnchorFromRanks()` step, called when the user
  switches `srMode` to `'set-current'` (in the `segmented` control's `onChange`, *before* `paintRank()`
  repaints) and once at form build time if the initial mode were ever `'set-current'` (it isn't
  today, but keeps the function correct if that changes): look up `ranks.find(r => r.account ===
  state.account && r.role === state.role)`; if found, set
  `state.anchorTier/anchorDivision/anchorPct` from it (mirroring `openSetRank()`'s `seed()` in
  `settings.ts:519-527` — `pct` blank when `needsReanchor`, else `String(Math.round(progressPct))`);
  if not found, leave the existing Gold/3/blank defaults untouched (first-time-anchor case,
  unchanged).
- Also re-seed on **account or role change** while already in `set-current` mode (so switching either
  re-prefills for the new (account, role) pair rather than keeping a stale value) — call the same
  `seedAnchorFromRanks()` from `accountField`'s and `roleField`'s `onChange` handlers, gated on
  `state.srMode === 'set-current'`.
- Wheel parity: factor the existing wheel handler out of `srDeltaInput()` into a small
  `attachWheelNudge(el: HTMLInputElement, get: () => string, set: (v: string) => void): void` helper
  (same `passive: false` + `preventDefault` + ±1-per-tick logic, generalized over the state getter/
  setter instead of hardcoding `state.srDelta`/`state.srEdited`). `srDeltaInput()` becomes a thin
  wrapper calling it with `state.srDelta`. `rankPicker()`'s % input additionally calls
  `attachWheelNudge(pctInput, () => state.anchorPct, (v) => (state.anchorPct = v))` — no `srEdited`-
  style edit-tracking needed here (unlike the delta field, the % field has no "preset to re-apply"
  behavior to protect).

### 5. Performance slider

New shared component, new optional field threaded through the manual-write paths, no migration.

- **Data model** (`src/core/analytics/types.ts`): add `performance?: number` to `GameRecord` (top-
  level, beside `srDelta` — a fact about the match, not nested under `review`). Integer 0–100;
  absent = unset. No `MatchReview` change — Review's save flow will pass `performance` as its own
  top-level patch key (see below), not inside `grades`/`flags`.
- **Contract** (`src/shared/contract/inputs.ts`): add optional `performance?: number` to
  `ManualMatchInput` and `ReviewInput` (never need to "clear" a value that didn't exist yet at
  log/review time — omitting the field is enough). `MatchEditInput` gets `performance?: number |
  null` instead — same shape `srDelta` already has (`null` clears, `undefined` leaves unchanged, a
  number sets), since the match-detail editor's slider needs an explicit clear that survives
  "`undefined` = unchanged" (see Risks).
- **Store** (`src/store/history.ts`): `HistoryStore.editManual`'s patch type widens from `Partial<Pick<
  GameRecord, 'result'|'role'|'map'|'heroes'|'gameType'|'mental'|'review'>> & { srDelta?: number |
  null }` to also include `performance?: number | null` (same null-clears/undefined-leaves-unchanged
  semantics as `srDelta`, reusing the exact generic loop in `editManual` — **no method body change
  needed**, only the type signature, since the loop already does `if (v === null) delete
  target[k]; else if (v !== undefined) target[k] = v` generically over `Object.entries(patch)`).
  `rowValues`/`updateValues`/`SCHEMA_SQL` are **untouched** — `performance` rides in the `data` JSON
  blob exactly like `mental`/`review` today, no new column.
- **Main process** (`src/main/dataProvider.ts`):
  - `logMatch`: thread `...(input.performance != null ? { performance: input.performance } : {})`
    into the `deps.recordGame({...})` call, same pattern as `srDelta`.
  - `editMatch`: `if (input.performance !== undefined) patch.performance = input.performance;`
    (mirrors the `srDelta` line just above it).
  - `saveReview`: currently only calls `deps.history.setReview(...)`. Add:
    `if (input.performance !== undefined) deps.history.editManual(input.matchId, { performance:
    input.performance });` right after the `setReview` call, so Review's save can set/update the
    match-level field alongside the grades/flags in the same user action (two store calls, same tick
    — acceptable, `setReview`/`editManual` are independent fields on the same row).
- **New shared component** `renderer/src/components/performanceSlider.ts`:
  `performanceSlider(value: number | undefined, onChange: (v: number | undefined) => void):
  HTMLElement` — a native `<input type="range" min="0" max="100" step="1">` plus a small "Clear" (×)
  button, wrapped like `statBar` (a labeled track). Unset state: the input renders with a distinct
  `is-unset` class (CSS: track rendered as the plain `--track` color with **no** colored fill/thumb
  emphasis — e.g. reduced-opacity thumb — and a "Not rated" text readout instead of a number) and a
  hidden clear button; first `input` event commits a real value (defaults the thumb to the clicked/
  dragged position — native range-input behavior already does this, no special-case needed) and
  reveals the clear button, which resets to unset and re-hides itself. Fill color computed via
  `wrHsl(value / 100)` from `theme.ts` (reusing the existing continuous ramp exactly as resolved),
  applied to a `background` on a `::-webkit-slider-runnable-track` / an overlay div (native range
  inputs can't be styled with a partial-fill background portably without a bit of CSS trickery —
  simplest robust approach: a `<div class="track">` + `<div class="track-fill">` pair *underneath* a
  transparent-track `<input type=range>` positioned on top via CSS grid/absolute overlay, exactly
  mirroring `statBar`'s existing track/track-fill markup so the same CSS class names apply and it's
  visually consistent with every other bar in the app). CVD-awareness is automatic — `wrHsl`
  already reads the module-level `cvd` flag in `theme.ts`, no extra plumbing.
- **Call sites:**
  - `log-match.ts`: new `state.performance: number | undefined` (starts `undefined`); a
    `performanceBlock = field(optionalLabel('Performance', '— how did you play?'),
    performanceSlider(state.performance, (v) => (state.performance = v)))`, added to the form beside
    `targetsBlock`. On save, threads `...(state.performance != null ? { performance: state.performance
    } : {})` into the `bridge.logMatch({...})` call.
  - `review.ts`'s `expanded()`: new local `let performance: number | undefined;` alongside
    `grades`/`flags`; a new `section('◎ How you played', performanceSlider(performance, (v) =>
    (performance = v)))`; `doSave()`'s `bridge.saveReview({ matchId, grades, flags, ...(performance
    != null ? { performance } : {}) })`.
  - `matchDetail.ts`'s `openMatchEditor()`: seed `let performance: number | null | undefined =
    d.performance;` (needs `MatchDetail`'s DTO to carry the current value — see below), a
    `performanceSlider(performance ?? undefined, (v) => (performance = v ?? null))` row in the
    editor (the slider's clear button routes to `v === undefined`, mapped to `null` so `save()` sends
    an explicit clear rather than "leave unchanged" — see Risks), and `save()`'s
    `bridge.editMatch({ ..., performance })`.
  - `src/core/matchDetail.ts` (the pure `matchDetail()` read function, not the renderer view of the
    same name) and `MatchDetail` DTO (`src/shared/contract/matchDetail.ts`): add `performance?:
    number` so the editor can prefill it. Read straight off the `GameRecord`.

## Affected Files/Modules

- `renderer/src/components/typeahead.ts` — strict/muted/search-pool options.
- `renderer/src/components/heroPicker.ts` — shortlist+search option on `paintHeroChips`.
- `renderer/src/components/performanceSlider.ts` — **new**.
- `renderer/src/app/log-match.ts` — map field wiring, hero picker wiring, rank prefill + wheel parity,
  performance field, save-enabled gating.
- `renderer/src/views/review.ts` — performance section + save payload.
- `renderer/src/views/matchDetail.ts` — performance row in the editor + save payload.
- `renderer/src/views/settings.ts` — new `quickLogCard`.
- `renderer/src/prefs.ts` — `suggestedHeroCount`.
- `renderer/styles/components.css` — `.typeahead-item.is-muted`, performance-slider styles.
- `src/core/analytics/heroSuggestions.ts` — **new** (`mostPlayedHeroes`).
- `src/core/analytics/types.ts` — `GameRecord.performance`.
- `src/core/matchDetail.ts`, `src/shared/contract/matchDetail.ts` — `performance` on the detail DTO.
- `src/shared/contract/inputs.ts` — `performance` on `ManualMatchInput`/`MatchEditInput`/`ReviewInput`.
- `src/shared/contract/api.ts` — `mostPlayedHeroes` method + `IPC_CHANNELS` entry.
- `src/main/dashboard/ipcHandlers.ts` — wire the new channel.
- `src/main/dashboard/provider.ts` — `DataProvider.mostPlayedHeroes`.
- `src/main/dataProvider.ts` — `mostPlayedHeroes` impl; `logMatch`/`editMatch`/`saveReview` thread
  `performance`.
- `src/store/history.ts` — `editManual` patch-type widening only.
- `test/` — new/updated vitest files (see Test Strategy).
- `README.md` — user-visible additions (locked map picker, hero shortlist + setting, rank prefill,
  performance slider).

## Data Model / Interfaces

```ts
// src/core/analytics/types.ts
interface GameRecord {
  // ...unchanged...
  performance?: number; // 0-100 integer, optional, self-rated
}

// src/shared/contract/inputs.ts
interface ManualMatchInput { /* ... */ performance?: number; }
interface MatchEditInput   { /* ... */ performance?: number | null; } // null clears, like srDelta
interface ReviewInput      { /* ... */ performance?: number; }

// src/shared/contract/matchDetail.ts
interface MatchDetail { /* ... */ performance?: number; }

// src/shared/contract/api.ts
interface OwStatsApi {
  /** Per-account, per-role most-played hero names (desc by play count), for the log-match shortlist. */
  mostPlayedHeroes(): Promise<Record<string, Partial<Record<Role, string[]>>>>;
}
// IPC_CHANNELS.mostPlayedHeroes = 'hero:most-played'

// src/core/analytics/heroSuggestions.ts (new)
function mostPlayedHeroes(games: GameRecord[], account: string, role: Role): string[];

// renderer/src/prefs.ts
interface PrefsShape { /* ... */ suggestedHeroCount: number; }

// renderer/src/components/typeahead.ts
interface TypeaheadOpts {
  // ...unchanged...
  searchSuggestions?: readonly string[];
  mutedItems?: ReadonlySet<string>;
  strict?: boolean;
}

// renderer/src/components/heroPicker.ts
function paintHeroChips(
  host: HTMLElement, selected: Set<string>, role: Role, heroes: HeroEntry[],
  opts?: { shortlist?: readonly string[]; search?: boolean },
): void;

// renderer/src/components/performanceSlider.ts (new)
function performanceSlider(value: number | undefined, onChange: (v: number | undefined) => void): HTMLElement;
```

## Test Strategy

Pure `core/` logic gets vitest coverage (per DoD); renderer wiring is verified via the browser
preview harness (`npm run preview`) rather than DOM unit tests, matching this codebase's existing
split (no renderer component test files exist today).

- **`test/heroSuggestions.test.ts` (new):** `mostPlayedHeroes` — ranks by descending play count;
  ties break alphabetically; `openQ` aggregates across all roles for the account, other roles filter
  to exact-role games only; an account/role with zero games returns `[]`; a hero played in one game
  with 2 heroes counts once for each hero, not once for the game (mirrors `heroStats` semantics).
- **`test/historyStore.test.ts` (existing, extend):** `editManual` round-trips `performance` — set,
  update, `null` clears, `undefined` leaves unchanged; unaffected by unrelated patch keys.
- **`test/dataProvider*.test.ts` (existing, extend) or new:** `logMatch`/`editMatch`/`saveReview`
  thread `performance` onto the stored `GameRecord` exactly like `srDelta`; `mostPlayedHeroes()`
  provider method matches the pure function over `deps.history.all()` (unfiltered — verify a global-
  filter-like scenario doesn't leak in, since there's no filter parameter to begin with).
- **`test/matchDetail.test.ts` (existing, extend):** the pure `matchDetail()` read surfaces
  `performance` on the DTO when present, omits it when not.
- Existing `heroes.test.ts`/`masterData.defaults.test.ts` need **no changes** — they assert dynamic
  properties of `HEROES_BY_ROLE`/`DEFAULT_MASTER_DATA`, not fixed counts, so the hero-roster-completion
  fix (separate from this spec, tracked in this session already) doesn't touch them.
- No SQLite schema test needed — `rowValues`/`SCHEMA_SQL` are untouched by design.
- Manual verification via `npm run preview` (browser harness, no Overwolf runtime needed): locked map
  combobox (type garbage → blur → reverts; type valid → commits; inactive map searchable/muted; Save
  disabled while unresolved), hero shortlist (shrinks to N, search reaches more, re-ranks on account/
  role switch, setting takes effect), rank prefill (existing anchor shows in Set-current; wheel nudges
  the % field), performance slider (unset state, drag commits, clear resets, color ramp, presence in
  Log Match / Review / match-detail, persists across a save+reopen).

## Risks & Alternatives

- **`MatchEditInput.performance` needs a clear-sentinel** (`number | null`), unlike
  `ManualMatchInput`/`ReviewInput` which never need to "clear" a value that didn't exist yet. Chosen:
  mirror `srDelta`'s existing `number | null` shape for consistency rather than inventing a new
  sentinel convention. Alternative considered — a separate `clearPerformance: boolean` flag — rejected
  as needless surface area when the codebase already has a working precedent.
- **`matchDetail.ts`'s `save()` payload shape:** since `MatchEditInput.performance` is `number | null`
  (clear vs. leave-unchanged both need to be expressible), the editor's local `performance` variable
  is typed `number | null | undefined` — `undefined` only at seed time if the match never had a
  rating, a number once set, `null` once cleared — and `save()` sends it unconditionally rather than
  spreading it in conditionally (unlike the other optional fields), since "don't send it" and
  "clear it" are different intents here.
- **Per-account "most played" needs unfiltered history**, not `ctx.data.heroStats`/`ctx.data.matches`
  (both scoped to the current global dashboard filter, and `matches` may be row-capped). Chosen: a
  small dedicated bridge call computed over `deps.history.all()`, fetched once when the modal opens —
  mirrors the existing `listAccounts`/`getRanks` precedent exactly. Alternative — bundle it into the
  main `DashboardData` payload like `reviewInbox` — rejected: it would recompute for every
  account×role combo on every dashboard refresh (any filter change, any other view's poll) for a
  value only the log-match modal consumes, whereas the modal already does its own upfront fetch.
- **Locked-combobox validation must use the *full* map set, not the browse suggestions** — conflating
  the two in one `suggestions` array would either hide inactive maps from search entirely (regression
  vs. `editable-master-data` AC 21/22) or pollute the empty-query browse list with inactive entries
  (regression vs. AC 21). Chosen: split into `suggestions` (browse) + `searchSuggestions` (typed-query
  validation pool), both optional-compatible with the single existing caller.
  the map field itself already resolves this way (`resolveMap` never depended on `isActive`), so no
  change was needed there beyond the input mechanism.
- **Reusing `paintHeroChips` vs. a new component:** extending it with an optional `opts` (default
  `undefined` = current behavior) keeps `matchDetail.ts`'s editor untouched and avoids duplicating the
  chip-toggle markup/logic in two places. Alternative — a parallel `paintHeroShortlist` — rejected as
  needless duplication for what's fundamentally the same chip grid with a smaller default pool plus a
  filter box.
- **Native `<input type=range>` styling** for the slider needs a track/fill overlay trick (transparent
  native input on top of a `statBar`-style track/fill pair) to get the continuous color ramp — slightly
  more CSS than a from-scratch custom slider, but stays dependency-free, keyboard-accessible (arrow
  keys, Home/End, Page Up/Down all work natively) and CSP-safe for free, which a fully custom
  drag-handler component would have to reimplement.
