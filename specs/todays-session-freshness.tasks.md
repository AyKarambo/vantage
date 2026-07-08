# Tasks: todays-session-freshness

Implements [todays-session-freshness.plan.md](todays-session-freshness.plan.md) /
[todays-session-freshness.spec.md](todays-session-freshness.spec.md). Ordered by dependency —
core logic first, then the settings plumbing chain, then renderer, then verification.

- [x] **T1 — `SessionSettings` core module**
  - **Goal**: introduce the new, independent, user-configurable session-gap setting as a
    pure, tested core module.
  - **Files**: `src/core/sessionSettings.ts` (new), `test/sessionSettings.test.ts` (new).
  - **Check**: `normalizeSessionSettings`/`clampGapMinutes` unit tests pass — out-of-range
    values clamp both directions (below 15, above 720), missing/non-numeric input falls back
    to `DEFAULT_SESSION_SETTINGS` (`{ gapMinutes: 180 }`).
  - **Size**: S

- [x] **T2 — Replace `latestSession()` with gap-based `currentSession()`**
  - **Goal**: fix the core staleness bug — session membership becomes gap-based (a pause
    longer than the threshold starts a new session) instead of calendar-day-based.
  - **Files**: `src/core/analytics/session.ts` (delete `latestSession`, add
    `currentSession`), `src/core/analytics/index.ts` (barrel export swap),
    `test/sessionReads.test.ts` (new `describe('currentSession', ...)` block).
  - **Check**: unit tests pass for — games spanning midnight with gaps ≤ threshold → one
    session; a gap exceeding the threshold → only the trailing group returned; elapsed time
    since the last game exceeding the threshold → `null`; elapsed time within the threshold →
    populated result even from a previous calendar day; no games → `null`; a gap exactly
    equal to the threshold stays in the same session (matches the `detectSessions`/
    `bySessionPosition` strict-`>` convention).
  - **Size**: M

- [x] **T3 — Shared contract: `SessionSettings` + IPC surface + `Session` doc update**
  - **Goal**: expose the new setting and updated session semantics across the typed IPC
    boundary.
  - **Files**: `src/shared/contract/index.ts` (re-export), `src/shared/contract/api.ts`
    (`OwStatsApi.getSessionSettings`/`setSessionSettings` + `IPC_CHANNELS` entries),
    `src/shared/contract/dashboard.ts` (`DashboardData.sessionSettings` field, `Session`
    doc-comment update — no shape change).
  - **Check**: `npm run typecheck` passes; the `satisfies Record<...>` guard in `api.ts`
    compiles (fails to build if the method/channel pairing is incomplete).
  - **Depends on**: T1 (imports `SessionSettings`).
  - **Size**: S

- [x] **T4 — Main: persist `SessionSettings` (provider + config)**
  - **Goal**: persist the session-gap setting to `config.local.json` end-to-end, mirroring
    `BreakReminderSettings`/`ReadinessSettings`.
  - **Files**: `src/main/dashboard/provider.ts` (`DataProvider` interface),
    `src/main/dataProvider.ts` (impl + `deps.persistSessionSettings`),
    `src/main/config/appConfig.ts` (`AppConfig`/`DEFAULTS`/`loadConfig()` entries),
    `src/main/index.ts` (`persistSessionSettings` deps wiring — follow
    `persistReadiness`/`persistBreakReminder`, **not** the dead `saveLocalReadiness` helper).
  - **Check**: `npm run typecheck` clean; manual round-trip — setting a value, restarting the
    app, and confirming the persisted value survives (`config.local.json` under
    `%APPDATA%/ow.vantage` gains a `sessionSettings` key).
  - **Depends on**: T3.
  - **Size**: M

- [x] **T5 — Main: IPC handler registration + `computeDashboard` threading**
  - **Goal**: wire the new settings through IPC so the renderer can read/write them via
    `bridge`, and so `computeDashboard` receives the persisted value.
  - **Files**: `src/main/dashboard/ipcHandlers.ts` (`handle(ch.getSessionSettings, ...)` /
    `handle(ch.setSessionSettings, ...)`; thread `sessionSettings: provider.getSessionSettings()`
    into the `manual` object passed to `computeDashboard`).
  - **Check**: `npm run typecheck` clean; `bridge.getSessionSettings()`/`setSessionSettings()`
    resolve correctly from the renderer (verified alongside T9).
  - **Depends on**: T4.
  - **Size**: S

- [x] **T6 — Wire `computeDashboard`: account-scoped, gap-based, configurable `session`**
  - **Goal**: make the dashboard's `session` field reflect the new behavior — gap-based,
    account-scoped (not role/date-scoped), threshold from the persisted setting.
  - **Files**: `src/core/dashboardData.ts` (`ManualData.sessionSettings?`; account-scoping
    ternary + `currentSession(...)` call replacing `latestSession(games)`;
    `sessionSettings: manual?.sessionSettings ?? DEFAULT_SESSION_SETTINGS` in the returned
    `DashboardData`), `test/vantageCore.test.ts` (new coverage).
  - **Check**: tests pass for — account filter `'all'` lets a cross-account game within the
    gap join the session; a specific account excludes a temporally-adjacent
    *different*-account game even though it's within the gap window; a role or date-range
    filter change does not affect the computed session; `sessionSettings` round-trips through
    `ManualData` into `DashboardData`.
  - **Depends on**: T1, T2, T3.
  - **Size**: M

- [x] **T7 — Renderer: relabel session card**
  - **Goal**: "Today's session" → "Current session"; "No games today yet" → "No current
    session yet".
  - **Files**: `renderer/src/app/shell.ts` (`sessionCardEl` header, `sessionSummary()`
    empty-state text).
  - **Check**: `npm run preview` — header and empty-state copy updated; no other change to
    `sessionSummary()`'s rendering logic.
  - **Size**: S

- [x] **T8 — Renderer: account chip shows "All accounts" clearly**
  - **Goal**: fix the sidebar account chip so selecting "All accounts" is visually
    unambiguous instead of silently showing the most-played account's name.
  - **Files**: `renderer/src/app/shell.ts` (`renderSidebar`'s `displayName` computation).
  - **Check**: `npm run preview` — with the account filter set to "All accounts", the chip
    reads "All accounts" (avatar "A"); with a specific account selected, the chip is
    unchanged from today.
  - **Size**: S

- [x] **T9 — Renderer: session-gap Settings editor**
  - **Goal**: let the user view/change the session-gap threshold from Settings → General →
    Coaching.
  - **Files**: `renderer/src/components/sessionSettingsEditor.ts` (new — preset
    `segmented<T>()` control, values 30/60/90/120/180/240/360 minutes),
    `renderer/src/views/settings/general.ts` (mount as a fourth entry in the "Coaching"
    card; update the card's `sub` copy).
  - **Check**: `npm run preview` — changing the preset calls `bridge.setSessionSettings`,
    persists, and the sidebar card's session boundary reflects the new threshold after
    `ctx.refresh()`.
  - **Depends on**: T5.
  - **Size**: M

- [x] **T10 — Preview-harness parity**
  - **Goal**: keep `npm run preview` functional and representative of real-app behavior for
    the new setting.
  - **Files**: `renderer/preview/preview.ts` (mirrored `getSessionSettings`/
    `setSessionSettings` stub; thread `sessionSettings` into the harness's own
    `computeDashboard()` call).
  - **Check**: `npm run preview` loads without error; the T9 editor works end-to-end in the
    browser harness, not just the real app.
  - **Depends on**: T3, T6.
  - **Size**: S

- [x] **T11 — README update**
  - **Goal**: keep user-visible-behavior docs in sync (Definition of Done).
  - **Files**: `README.md`.
  - **Check**: README's dashboard/sidebar and settings sections describe "Current session"
    and the new session-gap control.
  - **Size**: S

- [x] **T12 — Full verification pass**
  - **Goal**: confirm the Definition of Done end-to-end before calling the feature complete.
  - **Files**: none (verification only).
  - **Check**: `npm test` green; `npm run typecheck` clean (main + renderer); manual preview
    walkthrough of every Given/When/Then in the spec's Acceptance Criteria, including the
    empty-state render when `session` is `null` and the confirmation that readiness's own
    fatigue/long-session detection is unaffected by the new setting.
  - **Depends on**: all prior tasks.
  - **Size**: S

## Consistency Gate

Every spec acceptance criterion maps to at least one task:

| Acceptance criterion | Task(s) |
|---|---|
| Session boundary — cross-midnight gaps ≤ threshold → one session | T2 |
| Session boundary — gap > threshold → only trailing group | T2 |
| Session boundary — elapsed since last game > threshold → empty state | T2, T12 (render check) |
| Session boundary — elapsed ≤ threshold → shows stats even from a prior day | T2 |
| Configurable threshold — Settings change persists and reflects on next refresh | T9, T4, T5, T6 |
| Configurable threshold — default is 180 min | T1 |
| Configurable threshold — readiness's fatigue detection unaffected | T6 (no coupling introduced), T12 (confirmation) |
| Card label — header reads "Current session" | T7 |
| Account filter scope — "All accounts" allows any account's games | T6 |
| Account filter scope — specific account excludes other accounts' games | T6 |
| Account filter scope — role/date filters don't affect the session | T6 |
| Account chip clarity — "All accounts" shown literally | T8 |
| Account chip clarity — specific account unchanged | T8 |

**No gaps.** Every criterion has at least one owning task.

**No scope creep**, but note five tasks don't map 1:1 to an Acceptance Criteria row because
they're supporting infrastructure the Constraints/Definition-of-Done section requires rather
than user-facing behavior of their own:
- **T3, T4, T5, T10** — the contract/persistence/IPC/preview-parity chain. None of these are
  independently observable behavior; they exist because the "Configurable threshold" criteria
  (via T9) can't function end-to-end without them. This mirrors exactly how
  `BreakReminderSettings`/`ReadinessSettings` are wired today — removing any one link breaks
  the persistence round-trip.
- **T11, T12** — required by the spec's own Constraints section ("README updated", `npm test`
  green, `npm run typecheck` clean), not by a Given/When/Then row.

No revision to the spec or plan is needed before implementation.
