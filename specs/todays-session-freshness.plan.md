# Techplan: todays-session-freshness

Implements [todays-session-freshness.spec.md](todays-session-freshness.spec.md). Replaces the
calendar-day-based `latestSession()` with a gap-based `currentSession()`, adds a new
independent, user-configurable `SessionSettings.gapMinutes` (default 180), and relabels the
sidebar card.

## Architecture & Approach

### Core: replace `latestSession()` with a gap-based `currentSession()`

`src/core/analytics/session.ts:26-32`'s `latestSession()` is deleted outright (zero callers
outside `dashboardData.ts:98` and the barrel re-export — confirmed by grep, no
backwards-compat shim needed per project convention). It's replaced by:

```ts
export function currentSession(
  games: GameRecord[],
  now: number = Date.now(),
  gapMinutes: number = 180,
): Session | null {
  if (!games.length) return null;
  const sorted = [...games].sort((a, b) => a.timestamp - b.timestamp);
  const gapMs = gapMinutes * 60_000;
  let trailing: GameRecord[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].timestamp - sorted[i - 1].timestamp > gapMs) trailing = [];
    trailing.push(sorted[i]);
  }
  const last = trailing[trailing.length - 1];
  if (now - last.timestamp > gapMs) return null; // the trailing sitting has since closed
  return { date: dayKey(last.timestamp), ...winLoss(trailing), streak: streak(trailing), topMaps: byMap(trailing).slice(0, 3) };
}
```

This is a single forward pass over the sorted history (O(n log n) sort + O(n) scan), resetting
the `trailing` accumulator — not appending to a growing sessions array — every time a gap
exceeds the threshold, so only the most recent sitting's games are ever retained in memory.
Same shape (`WinLoss` + `date`/`streak`/`topMaps`) as today's `Session` contract type, so no
contract *shape* change — only its semantics and doc comment change (§Data Model).

**This is the third independent gap-based-session implementation in this codebase**, and that's
consistent with existing precedent rather than a new problem to solve:
- `src/core/readiness/sessions.ts:25-60` (`detectSessions`, gap default 90 via
  `READINESS_TUNING.sessionGapMinutes`) — returns ALL historical sessions with duration, for
  readiness's fatigue signals.
- `src/core/analytics/temporal.ts:32-33,55-75` (`bySessionPosition`, local
  `SESSION_GAP_MINUTES = 90` literal, independently parameterizable via
  `opts.gapMinutes`) — buckets games by their position-within-sitting, for the "stop before
  game N" coach signal. **This is the closest sibling** — same file family
  (`core/analytics/`), same forward-sorted-ascending-scan style, and already proves the
  project's convention of *not* sharing one canonical session-splitting function across
  features that need different output shapes.
- The new `currentSession()` is a fourth, purpose-built variant (recap of only the trailing
  sitting, not history-wide splitting or position-numbering). It does **not** import
  `detectSessions` from `core/readiness` — `core/analytics` has no existing dependency on
  `core/readiness`, and adding one would be a new backwards edge between sibling `core/`
  modules for a two-line loop that's cheaper to fork than to couple to.
- `bySessionPosition`'s 90-minute convention and readiness's 90-minute convention are both
  untouched by this work — a third, independent gap value for the sidebar card is consistent
  with how the other two already coexist without sharing a constant.

### New settings type: `SessionSettings`

New file `src/core/sessionSettings.ts`, mirroring `src/core/breakReminder.ts`'s flat,
single-file, one-numeric-field shape (the established template for "add one user-configurable
number"):

```ts
export interface SessionSettings {
  /** Pause after which the sidebar's current session is considered over; minutes. */
  gapMinutes: number;
}
export const DEFAULT_SESSION_SETTINGS: SessionSettings = { gapMinutes: 180 };
export const clampGapMinutes = (n: number): number => Math.max(15, Math.min(720, Math.round(n)));
export function normalizeSessionSettings(s: Partial<SessionSettings> | undefined): SessionSettings {
  return {
    gapMinutes: typeof s?.gapMinutes === 'number' ? clampGapMinutes(s.gapMinutes) : DEFAULT_SESSION_SETTINGS.gapMinutes,
  };
}
```

Bounds (15 min – 12 h) are a plan-level default with no spec mandate beyond "default 180,
configurable" — adjustable at implementation/review with no downstream impact (only
`clampGapMinutes` changes).

This is a **brand-new top-level settings group**, not a new field on `ReadinessSettings` (per
the spec's resolved decision to keep it independent), so it needs the full wiring chain a new
settings group requires — see Affected Files below. `core/analytics/session.ts` does **not**
import this new module; `currentSession()`'s `gapMinutes` parameter takes a plain number with
its own literal default (180) for standalone callability/testability, matching how
`bySessionPosition` doesn't import `READINESS_TUNING` either despite a conceptually related
constant. `computeDashboard` is the only place that resolves the *configured* value and passes
it in explicitly.

### `computeDashboard` wiring — account-scoped, but not role/date-scoped

`src/core/dashboardData.ts:98` currently calls `session: latestSession(games)` — `games` is the
**user-filtered** subset (account/role/days; `dashboardData.ts:55`). Per spec (Account filter
scope), the replacement is scoped by account only:

```ts
const sessionGames = filters.account && filters.account !== 'all'
  ? all.filter((g) => g.account === filters.account)
  : all;
session: currentSession(sessionGames, Date.now(), sessionSettings.gapMinutes),
```

`all` is competitive-only but otherwise unfiltered (`dashboardData.ts:54`); the ternary mirrors
the existing account-scoping idiom already used one line earlier for `primaryAccount`
(`dashboardData.ts:61`: `filters.account && filters.account !== 'all' ? filters.account :
topAccount(all)`), just keeping the *set* of that account's games rather than resolving to a
single account name. Role and date-range filters (`filters.role`, `filters.days`) are
deliberately **not** applied — a role switch mid-session, or an unrelated "last 7 days"/season
filter, must not fragment or hide an in-progress sitting. `Date.now()` is passed explicitly,
matching the `readiness`/`recap` convention two lines away (`readiness: safeReadiness(all,
Date.now(), ...)` at line 126) rather than relying on `currentSession`'s default-parameter
clock.

Because the session is account-scoped, `store.setFilters()` (`store.ts:129-133`) changing the
account filter *does* need to change what the card shows (and does, for free — one
`getDashboard` call recomputes the whole snapshot); changing role or date-range filters
recomputes the snapshot too but leaves `session` unchanged, same as `readiness`/`recap` today.

`sessionSettings` is resolved next to the other settings echoes already in `computeDashboard`,
via `ManualData` (`dashboardData.ts:26-36`, gains `sessionSettings?: SessionSettings`) and a
`?? DEFAULT_SESSION_SETTINGS` fallback, mirroring `readinessSettings: manual?.readiness ??
DEFAULT_READINESS` (line 127). `DashboardData` gains a `sessionSettings: SessionSettings`
field (echoed back, same pattern as `readinessSettings`) so the new Settings editor can read
the current value without a second round trip.

### Settings plumbing (new top-level group — full chain)

Following the exact chain the settings-persistence research traced for
`Readiness`/`BreakReminder`/`Staleness`:

1. **Contract** (`src/shared/contract/`): `index.ts` re-exports `SessionSettings` from
   `../../core/sessionSettings`; `api.ts` adds `getSessionSettings()`/`setSessionSettings()` to
   `OwStatsApi` (~lines 84-87 region) and `'settings:get-session'`/`'settings:set-session'` to
   `IPC_CHANNELS` (~lines 205-206 region) — the `satisfies Record<...>` at line 234 forces this
   pairing at compile time; `dashboard.ts` adds `sessionSettings: SessionSettings` (~line 142
   region).
2. **Main — provider seam**: `src/main/dashboard/provider.ts` adds `getSessionSettings()` /
   `setSessionSettings()` to the `DataProvider` interface (~lines 86-89 region).
   `src/main/dataProvider.ts` implements them (`normalize → assign → persist → return`,
   mirroring lines 305-311) and adds `persistSessionSettings` to the `deps` interface
   (~line 67 region).
3. **Main — IPC registration**: `src/main/dashboard/ipcHandlers.ts` adds
   `handle(ch.getSessionSettings, ...)` / `handle(ch.setSessionSettings, ...)` (~lines 175-177
   region) and threads `sessionSettings: provider.getSessionSettings()` into the `manual`
   object passed to `computeDashboard` inside the `getDashboard` handler (~lines 70-84 region).
4. **Main — config**: `src/main/config/appConfig.ts` adds `sessionSettings: SessionSettings`
   to the `AppConfig` interface (~lines 50-83), seeds `DEFAULTS.sessionSettings` (~lines
   85-97), and adds the three-layer merge line in `loadConfig()` (~lines 122-137) — **do not**
   model the new `persistSessionSettings` after `saveLocalReadiness`
   (`src/main/config/appConfig.ts:183-188`); that helper is dead code (nothing calls it — the
   live path is the generic `saveLocalConfig` patch). Follow `persistReadiness`/
   `persistBreakReminder` in `src/main/index.ts:282-284` instead:
   `persistSessionSettings: (sessionSettings) => saveLocalConfig({ sessionSettings }),`.
5. **preload.ts / bridge.ts**: no edits. Both are fully generic over `IPC_CHANNELS`/
   `OwStatsApi` (`src/main/preload.ts:10-15`, `renderer/src/bridge.ts:19-34`) — the new methods
   exist automatically once the contract carries them.
6. **Preview harness**: `renderer/preview/preview.ts` needs a mirrored `getSessionSettings`/
   `setSessionSettings` stub (backed by an in-memory var, matching the existing
   readiness/break-reminder stubs around lines 551-568) and must pass a `sessionSettings`
   value into its own `computeDashboard()` call (~line 273) — otherwise `npm run preview`
   breaks for the new editor and the card silently uses the bare-literal 180 default instead
   of the previewed value.

### Account chip: show "All accounts" clearly

`renderer/src/app/shell.ts:362` (`renderSidebar`):

```ts
const displayName = (d && d.filters.account !== 'all' ? d.filters.account : d?.greetingName) ?? 'Vantage';
```

`d?.greetingName` (`dashboardData.ts:93`, `topAccount(all)`) is a **fallback to the
most-played account's name**, so today the chip never actually reads "All accounts" — it
always shows some specific account, whichever filter is active. Fix: special-case the "all"
branch to a literal label instead of falling through to `greetingName`:

```ts
const displayName = d
  ? (d.filters.account !== 'all' ? d.filters.account : 'All accounts')
  : 'Vantage';
```

Downstream of this, `avatarEl.textContent = displayName.charAt(0).toUpperCase()` (line 363)
naturally becomes `'A'` for "All accounts" — an acceptable, low-risk side effect (no special
icon needed; consistent with how every other account name already reduces to its first
letter). `accountSubEl`/`rankLine(d)` (line 365) is untouched per spec (Out-of-Scope) — it
keeps showing the most-played account's rank underneath, same as today, whether "all" or a
specific account is the label above it. `d.greetingName` itself is unaffected and keeps
serving its other purpose (e.g. any welcome-text usage elsewhere) — only this one call site's
fallback changes.

### Renderer (session card)

- **`renderer/src/app/shell.ts:125`** — header text `"Today's session"` → `"Current session"`.
- **`renderer/src/app/shell.ts:447`** — empty-state text `'No games today yet'` →
  `'No current session yet'`. No other change to `sessionSummary()` (`shell.ts:439-448`): it
  only reads `.games`/`.wins`/`.losses`/`.winrate`, all still present on the `Session` shape.
- **New `renderer/src/components/sessionSettingsEditor.ts`**, modeled directly on
  `breakReminderEditor.ts` (no enable/disable toggle needed — this setting always applies, so
  it's just the value control): a `segmented<T>()` control (the exported, reusable one at
  `renderer/src/components/primitives/controls.ts:37-58` — **not** `log-match.ts`'s local
  unexported `choiceSegment` duplicate) with presets `30m / 1h / 1.5h / 2h / 3h / 4h / 6h`
  (values `30/60/90/120/180/240/360`, so the 180-minute default lands on a real option), wired
  as:
  ```ts
  const set = (patch: Partial<SessionSettings>): void => {
    void bridge.setSessionSettings({ ...s, ...patch }).then(() => ctx.refresh());
  };
  ```
- **Mount point**: `renderer/src/views/settings/general.ts:50-54`, as a fourth entry in the
  existing "Coaching" card alongside `breakReminderEditor`/`readinessSettingsEditor`/
  `stalenessEditor`; update the card's `sub` copy. No second inline mount on another screen
  (unlike readiness/break-reminder's "two surfaces" pattern) — out of scope per spec, and
  `stalenessEditor` already establishes that Settings-only is a legitimate pattern here.

## Affected Files/Modules

- `src/core/analytics/session.ts` — delete `latestSession`, add `currentSession`.
- `src/core/analytics/index.ts:25` — barrel: drop `latestSession` export, add `currentSession`.
- `src/core/sessionSettings.ts` — **new**: `SessionSettings`, `DEFAULT_SESSION_SETTINGS`,
  `clampGapMinutes`, `normalizeSessionSettings`.
- `src/core/dashboardData.ts` — `ManualData` gains `sessionSettings?`; `session:`/
  `sessionSettings:` fields in `computeDashboard`'s return (lines ~98, ~127 region).
- `src/shared/contract/index.ts` — re-export `SessionSettings`.
- `src/shared/contract/api.ts` — `OwStatsApi` + `IPC_CHANNELS` entries for get/set.
- `src/shared/contract/dashboard.ts` — `Session` doc comment update (no shape change);
  `DashboardData.sessionSettings: SessionSettings`.
- `src/main/dashboard/provider.ts` — `DataProvider` interface entries.
- `src/main/dataProvider.ts` — provider impl + `deps.persistSessionSettings`.
- `src/main/dashboard/ipcHandlers.ts` — handler registration + `manual` threading.
- `src/main/config/appConfig.ts` — `AppConfig`/`DEFAULTS`/`loadConfig()` entries.
- `src/main/index.ts` — `persistSessionSettings` deps wiring (~lines 282-284 region).
- `renderer/src/app/shell.ts` — header + empty-state copy (lines ~125, ~447); account-chip
  `displayName` fallback fixed to show "All accounts" literally (line ~362).
- `renderer/src/components/sessionSettingsEditor.ts` — **new**.
- `renderer/src/views/settings/general.ts` — mount the new editor (lines ~50-54).
- `renderer/preview/preview.ts` — mirrored get/set stub + `sessionSettings` in its
  `computeDashboard()` call (~lines 273, 551-568 region).
- `test/sessionReads.test.ts` — drop/replace any `latestSession` coverage (there is none
  today — confirmed zero existing references), add a `describe('currentSession', ...)` block.
- `test/vantageCore.test.ts` — where `computeDashboard`/`applyFilters` are exercised today
  (confirmed no existing `session`/`latestSession` assertions there to break, but add
  coverage for the new account-scoping behavior per Test Strategy).
- New settings-normalize test (mirroring the existing break-reminder/readiness/staleness
  normalize tests) for `normalizeSessionSettings`/`clampGapMinutes`.
- README — the sidebar card's behavior and the new Settings → General → Coaching control are
  user-visible (per Definition of Done).

_No change needed:_ `src/core/readiness/**` (constant/algorithm untouched, confirmed no
`sessionGapMinutes` reuse), `src/core/analytics/temporal.ts` (`bySessionPosition`'s own
90-minute convention untouched), `src/core/analytics/grouping.ts` (`dayKey`/`winLoss`/`byMap`
reused as-is, no edits), `src/main/preload.ts`, `renderer/src/bridge.ts`,
`renderer/src/store.ts` (no new refresh trigger — see Risks).

## Data Model / Interfaces

- `SessionSettings { gapMinutes: number }` — new, `src/core/sessionSettings.ts`. Default
  `{ gapMinutes: 180 }`, clamped `[15, 720]`.
- `Session` (`src/shared/contract/dashboard.ts:26-30`) — **unchanged shape**
  (`WinLoss & { date: string; streak: Streak; topMaps: Group[] }`), doc comment updated from
  "One day's recap" to describe the gap-based current sitting; `date` now means "the calendar
  day of the most recent game in the current sitting" rather than "the day this session is
  about" — not rendered anywhere today (`sessionSummary` doesn't use it), so this is a
  harmless semantic narrowing, not a breaking change.
- `DashboardData.sessionSettings: SessionSettings` — new field, echoes the persisted setting
  back for the editor (mirrors `readinessSettings`).
- `currentSession(games: GameRecord[], now?: number, gapMinutes?: number): Session | null` —
  new public export from `src/core/analytics` (replaces `latestSession`).

## Test Strategy

Each maps to a spec acceptance criterion:

- **Cross-midnight, gaps ≤ threshold → one session.** Games at 23:30 and 00:45 (gap 75 min,
  threshold 180) → single `currentSession` result including both.
- **Gap > threshold → only the trailing group.** Three games, then a gap exceeding the
  threshold, then two more games → result reflects only the last two.
- **Elapsed-since-last-game > threshold → null.** Last game 4 hours ago, threshold 180 min →
  `currentSession(...)` returns `null` (drives the empty state).
- **Elapsed-since-last-game ≤ threshold → populated result**, even when the game was logged on
  a previous calendar day (the core staleness-bug regression test).
- **No games at all → null** (existing edge case, unchanged from `latestSession`).
- **Gap exactly equal to the threshold stays in the same session** — locks in the same
  strict-`>` convention `detectSessions`/`bySessionPosition` already use, as its own explicit
  test (the three implementations aren't shared code, so this guards against silent drift).
- Fixture style: extend `test/sessionReads.test.ts`'s existing `NOW`/`game()`/`hoursAgo()`
  conventions (UTC-based, explicit `now` argument every call — never the `Date.now()`
  default) with a new `describe('currentSession', ...)` block; borrow
  `test/readinessFixtures.ts`'s `span(fromDay, toDay, { gapMin })` technique if a
  multi-session fixture reads more clearly built that way.
- **`normalizeSessionSettings`/`clampGapMinutes`** — unit tests mirroring the existing
  break-reminder/readiness/staleness normalize-function tests (out-of-range clamps both
  directions, non-numeric/missing input falls back to default).
- **`computeDashboard` integration — account scope.** With account filter `'all'`, a game on
  a different tracked account within the gap threshold still joins the current session. With
  the account filter set to a specific account, a temporally-adjacent game on a *different*
  account is excluded (doesn't extend or count toward the session), even though it would
  otherwise be within the gap window. With a role or date-range filter active (account
  `'all'` or a specific account), the session is unaffected by that filter — a session
  spanning multiple roles, or older than the selected date range, still shows in full.
  Also assert `sessionSettings` round-trips through `ManualData`.
- **Manual verification**: `npm run preview` — confirm the sidebar card shows "Current
  session" / the empty state correctly, the new Settings → General → Coaching control persists
  a changed gap value and the card reflects it on next refresh, and the account chip reads
  "All accounts" when that filter is active and a specific account's name otherwise.

## Risks & Alternatives

- **Account-scoped but role/date-unscoped (see Architecture) is a resolved design decision**
  (spec: Account filter scope), not the plan's original "fully unfiltered `all`" proposal —
  revised after review. Rejected alternatives: (a) fully filtered `games` (today's literal
  behavior) — makes an in-progress sitting flicker in/out of existence based on unrelated
  role/date filter choices; (b) fully unfiltered `all` — would let two different tracked
  accounts' games merge into one "session," which doesn't reflect how a single sitting
  actually maps to account identity.
- **No periodic refresh timer** (per the spec's resolved default): a session that has gone
  stale (elapsed > threshold) keeps showing until the next `store.refresh()` trigger (app
  open, window focus, filter change, post-action refresh) rather than the instant the
  threshold elapses. Unchanged from the spec's stated assumption; no new `setInterval` is
  introduced. If this needs revisiting, it's a `renderer/src/app/shell.ts` addition near the
  existing 60-second status-label tick (`shell.ts:167-170`), independent of everything else in
  this plan.
- **Three independent gap-session implementations now exist** (`detectSessions`,
  `bySessionPosition`, `currentSession`), each with its own literal/constant. Rejected
  alternative: unify them behind one shared helper — rejected because each already has a
  different, incompatible output shape and consumer, unifying would touch readiness's
  fatigue-sensitive code for no requested benefit, and the codebase already models this exact
  "independent parallel conventions" shape today (`bySessionPosition` vs. `detectSessions`)
  without issue.
- **Settings card placement** ("Coaching" card in Settings → General) is a plan-level default,
  not spec-mandated — low risk to relocate later since it's a single mount-point line.
- **Preview-harness parity is easy to forget**: since `computeDashboard` is also called
  directly from `renderer/preview/preview.ts` and from tests, a missed `sessionSettings` stub
  there won't fail typecheck (optional/defaulted field) but will silently desync the previewed
  behavior from real-app behavior — called out explicitly as its own Affected Files entry to
  avoid that trap.
