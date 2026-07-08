# Spec: todays-session-freshness

The sidebar's "Today's session" card goes stale: once the player stops playing, it keeps
showing the last day's recap under the "Today's session" label indefinitely, updating only
when a new game is logged. This redefines "session" as gap-based (like the readiness feature
already uses internally) rather than calendar-day-based, with a new user-configurable
threshold, fixing the staleness and the wrong day/timezone unit at the same time.

## Intent (WHAT & WHY)

The sidebar's "Today's session" card is meant to recap the player's current play session
(W–L, streak, top maps) right now. Its data comes from `latestSession()`
(`src/core/analytics/session.ts`), which finds the most recent calendar day that has *any*
games and unconditionally treats it as "today" — it never checks whether that day is
actually today. Once the player stops playing, the card keeps showing that stale day's
recap under the "Today's session" label indefinitely, and only updates when a new game is
logged and pushes the "most recent day" forward. This silently misrepresents old data as
current, which undermines the trust the coaching feature depends on.

Separately, "one calendar day" is the wrong unit for "a session" to begin with — a late-night
session spanning past midnight should read as one session, not get split or misattributed to
the wrong day. The fix redefines "session" using the same gap-based model the readiness
feature already uses internally (a pause longer than a threshold ends a session), but exposes
the threshold as a new, user-configurable setting dedicated to this card.

Because the current session is now scoped by the account filter, the player needs to be able
to tell which account scope is active just by looking at the sidebar. Today the account chip
never actually displays "All accounts" — `renderer/src/app/shell.ts`'s `displayName` falls
back to the most-played account's name whenever the filter is "all", so the chip always shows
*some* specific account's name regardless of which mode is active. That's confusing on its own,
and actively misleading now that it also determines which games feed the current-session card.

## In-Scope

- Redefine the sidebar card's "current session" as the trailing run of games with no gap
  longer than a configurable threshold between consecutive games, ending at the most recent
  game.
- The card shows a session as "current" only when the elapsed time since the very last game
  is within that same threshold; otherwise, no active session (existing empty state, reworded
  to fit — see Resolved Questions).
- New, independent, user-configurable setting: the session-gap threshold, defaulting to
  **3 hours (180 minutes)**. Persisted like other user settings (mirrors the
  `ReadinessSettings`/`BreakReminderSettings` pattern), decoupled from
  `READINESS_TUNING.sessionGapMinutes` (which stays fixed at 90 minutes for fatigue
  detection).
- Relabel the sidebar card header from **"Today's session"** to **"Current session"**.
- The replacement for `latestSession()` takes a `now` reference parameter, mirroring the
  existing `groupByDay`/`sessionRecap` pattern in the same file — testable, not
  ambient-clock-dependent.
- Unit tests for the new/changed pure logic under `src/core/` (closing the existing
  zero-coverage gap on this function).
- Fix the sidebar account chip so it clearly displays **"All accounts"** when that's the
  active filter, instead of silently substituting a specific account's name.

## Out-of-Scope

- Changing readiness's own `sessionGapMinutes` (90 min) fatigue/long-session detection, or
  its `resetHour`/local-day concept — unrelated, unaffected.
- Changing the Overview's "yesterday" recap card (`sessionRecap`) or the Matches screen's day
  grouping (`groupByDay`) — both are already correctly calendar-day- and `now`-aware; out of
  scope.
- Adding a periodic/background timer so the card re-checks independent of the app's existing
  refresh triggers (see Resolved Questions — a default assumption, flagged for override).
- A UI to browse past sessions — only the current/most-recent session is shown, same as
  today.
- Any change to how matches are logged, recorded, or timestamped.
- Redesigning the account switcher popover itself — it already correctly shows and highlights
  "All accounts" as a menu entry; only the closed-state chip label is wrong.
- Changing what the rank line under the account name shows (it stays the most-played
  account's rank even under "All accounts" — unrelated pre-existing behavior, not addressed
  here).

## Constraints

- **Guardrail 3** — new/changed logic lives under `src/core/`, pure, Electron-free, `now`
  passed as a parameter (no ambient `Date.now()` inside the pure helper).
- New setting persists via the existing local config/settings mechanism, not through Notion
  export (**Guardrail 5**).
- Typed IPC contract — the new setting field is added to the shared contract; no `any`
  crossing the boundary.
- **Definition of Done**: `npm test` green, `npm run typecheck` clean (main + renderer), the
  new/changed core logic ships with unit tests, README updated (the card's behavior and the
  new setting are user-visible changes).

## Acceptance Criteria

### Session boundary
- **Given** games logged with gaps between consecutive games all ≤ the configured threshold,
  **when** the dashboard computes the current session, **then** all of them are included in
  one session regardless of whether they cross a calendar-day boundary (e.g., games at 23:30
  and 00:45 are one session at the default 3h threshold).
- **Given** the most recent two games are more than the configured threshold apart, **when**
  the dashboard computes the current session, **then** only the games after that gap belong
  to the current session.
- **Given** the elapsed time between the most recent game and now exceeds the configured
  threshold, **when** the sidebar renders, **then** the card shows the empty state, not the
  last session's stats.
- **Given** the elapsed time between the most recent game and now is within the configured
  threshold, **when** the sidebar renders, **then** the card shows that session's W–L, net,
  and winrate — even if the game was logged on a previous calendar day.

### Configurable threshold
- **Given** the Settings screen, **when** the user changes the session-gap setting, **then**
  the value persists and the sidebar card's session boundary reflects it on next refresh.
- **Given** no user override, **when** the app runs, **then** the default threshold is 3
  hours (180 minutes).
- **Given** the session-gap setting is changed, **when** readiness's fatigue/long-session
  detection runs, **then** its behavior is unaffected (still governed by the independent,
  fixed `READINESS_TUNING.sessionGapMinutes`).

### Card label
- **Given** the sidebar, **when** it renders, **then** the header text reads "Current
  session" (not "Today's session").

### Account filter scope
- **Given** the dashboard's account filter is set to "All accounts", **when** the current
  session is computed, **then** games from every tracked account are eligible to form it.
- **Given** the dashboard's account filter is set to a specific account, **when** the current
  session is computed, **then** only that account's games are eligible — a game logged on a
  different account in the same time window doesn't extend or count toward it.
- **Given** the dashboard's role or date-range filter is set to anything other than "all",
  **when** the current session is computed, **then** it is unaffected by that filter — a
  session spanning multiple roles, or extending outside the selected date range, still shows
  in full.

### Account chip clarity
- **Given** the account filter is "All accounts", **when** the sidebar renders, **then** the
  account chip displays "All accounts" — not any specific account's name.
- **Given** the account filter is set to a specific account, **when** the sidebar renders,
  **then** the chip displays that account's name (unchanged from today).

## Resolved Questions

- **Session boundary →** gap-based (a pause longer than the threshold starts a new session),
  not calendar-day-based. Reuses the model already proven in `readiness/sessions.ts`'s
  `detectSessions`, applied independently for this card.
- **Setting scope →** a new, independent, user-configurable setting dedicated to this card.
  Does **not** share or replace readiness's internal `sessionGapMinutes` (90 min, fixed) —
  avoids unintentionally loosening the fatigue model.
- **Default threshold →** 3 hours (180 minutes), user-configurable.
- **Card label →** relabeled to "Current session".
- **Day/timezone boundary →** dropped entirely for this card. The session boundary is purely
  elapsed real time between timestamps (timezone-independent), matching `detectSessions`'s
  existing design. The app's UTC-day convention (`dayKey`, used by Matches grouping and the
  Overview recap) is untouched and stays out of scope.
- **Filter scope →** the current session is scoped by the **account** filter (a specific
  account restricts eligible games to that account; "All accounts" allows any account's
  games). It is **not** scoped by the role or date-range filters — a role switch mid-session,
  or an unrelated "last 7 days"/season filter, must not fragment or hide an in-progress
  sitting.
- **Account chip clarity →** the chip must show "All accounts" literally when that's the
  active filter. Today it always falls back to a specific account's name (the filtered one,
  or the most-played one under "all"), making it impossible to tell which mode is active —
  especially confusing now that the current-session card's contents depend on this choice.
- **Refresh cadence (assumed default) →** No new periodic timer. The card recomputes on the
  dashboard's existing refresh triggers (app open, window focus, filter change, post-action
  refreshes like logging/reviewing a match) — consistent with every other part of the
  dashboard. This means a session that's gone stale (elapsed time > threshold) keeps showing
  until the next such trigger, not the instant the threshold elapses.

## Open Questions

- None blocking, beyond the refresh-cadence assumption noted above.
