---
slug: log-match-improvements-2
status: done
updated: 2026-07-07
---

# Tasks: Log Match screen improvements (round 2)

Reads: `specs/log-match-improvements-2.spec.md`, `specs/log-match-improvements-2.plan.md`.
Ordered so each task only depends on earlier ones (data model → main → renderer components → call
sites → docs/verification).

## Data model & core

- [x] **T1 — `mostPlayedHeroes` pure function**
  - Goal: rank a account+role's played heroes by descending play count (Open Queue = all roles).
  - Files: `src/core/analytics/heroSuggestions.ts` (new), `test/heroSuggestions.test.ts` (new).
  - Check: `npm test` — ties break alphabetically; `openQ` aggregates across roles; a hero played
    twice in one multi-hero game counts twice; unknown account/role returns `[]`.
  - Size: S

- [x] **T2 — `GameRecord.performance` + `HistoryStore.editManual` patch type**
  - Goal: add the optional 0–100 field to the core record and let `editManual` patch it
    (set/clear/leave-unchanged), no SQLite schema change.
  - Files: `src/core/analytics/types.ts`, `src/store/history.ts` (type signature only),
    `test/historyStore.test.ts` (extend).
  - Check: `npm test` — `editManual({ performance: n })` sets it, `{ performance: null }` clears it,
    omitting it leaves it unchanged; `rowValues`/`SCHEMA_SQL` untouched (no new column).
  - Size: S

- [x] **T3 — `performance` on the match-detail read**
  - Goal: the pure `matchDetail()` read function surfaces `performance` when present.
  - Files: `src/core/matchDetail.ts`, `src/shared/contract/matchDetail.ts`,
    `test/matchDetail.test.ts` (extend).
  - Check: `npm test` — a game with `performance` set surfaces it on the DTO; one without omits it.
  - Size: S

## Contract & main process

- [x] **T4 — Contract: `performance` fields + `mostPlayedHeroes` API method**
  - Goal: `ManualMatchInput.performance?: number`, `ReviewInput.performance?: number`,
    `MatchEditInput.performance?: number | null`; `OwStatsApi.mostPlayedHeroes()` +
    `IPC_CHANNELS.mostPlayedHeroes`.
  - Files: `src/shared/contract/inputs.ts`, `src/shared/contract/api.ts`.
  - Check: `npm run typecheck` clean (main + renderer) — no other file changes yet, so this task's
    own compile will show every call site that still needs updating (expected, fixed in later
    tasks).
  - Size: S

- [x] **T5 — Wire `mostPlayedHeroes` in main**
  - Goal: `DataProvider.mostPlayedHeroes()` computed over unfiltered `deps.history.all()`, per
    account+role, registered on the IPC channel.
  - Files: `src/main/dashboard/provider.ts`, `src/main/dataProvider.ts`,
    `src/main/dashboard/ipcHandlers.ts`.
  - Check: `npm test` (extend a `dataProvider`-level test or add one) — matches `mostPlayedHeroes()`
    (T1) applied to the full unfiltered history, not scoped by any current filter.
  - Size: M

- [x] **T6 — Thread `performance` through `logMatch`/`editMatch`/`saveReview`**
  - Goal: main-process writes persist `performance` the same way `srDelta` does.
  - Files: `src/main/dataProvider.ts`.
  - Check: `npm test` — logging with a performance value stores it; editing sets/clears it; saving a
    review with a performance value stores it onto the match (independent of `grades`/`flags`).
  - Size: S

- [x] **T7 — Preview harness parity**
  - Goal: `npm run preview` keeps working for every changed/new API — mirror T5/T6 in the mock
    bridge (`matchDetail`/`heroDetail`/`getDashboard` already reuse the real core functions, so only
    the manual-write handlers + a new `mostPlayedHeroes` mock need edits).
  - Files: `renderer/preview/preview.ts`.
  - Check: manual — `npm run preview`, log a match with a performance rating and multiple heroes,
    confirm it round-trips through review/match-detail in the harness.
  - Size: S

## Renderer components

- [x] **T8 — `typeahead.ts`: strict + muted + search-pool options**
  - Goal: add `searchSuggestions`, `mutedItems`, `strict` — default behavior for the existing (only)
    caller stays byte-identical until it opts in.
  - Files: `renderer/src/components/typeahead.ts`, `renderer/styles/components.css`
    (`.typeahead-item.is-muted`).
  - Check: `npm run typecheck`; manual preview check deferred to T12 (no caller uses the new options
    yet).
  - Size: M

- [x] **T9 — `heroPicker.ts`: shortlist + search option**
  - Goal: `paintHeroChips` accepts an optional `{ shortlist?, search? }`; omitted ⇒ identical to
    today (protects `matchDetail.ts`'s existing call).
  - Files: `renderer/src/components/heroPicker.ts`.
  - Check: `npm run typecheck`; `matchDetail.ts`'s existing (unchanged) call site keeps compiling
    with no behavior change.
  - Size: M

- [x] **T10 — New `performanceSlider` component**
  - Goal: a 0–100 range control with a distinct unset state, clear affordance, and a
    winrate-ramp-colored fill (`wrHsl`), CVD-aware.
  - Files: `renderer/src/components/performanceSlider.ts` (new), `renderer/styles/components.css`.
  - Check: `npm run typecheck`; manual preview check deferred to T15/T16/T17 (no caller yet).
  - Size: M

## Settings

- [x] **T11 — Suggested-hero-count setting**
  - Goal: a persisted client pref (default 6, clamped 3–15) and a Settings control for it.
  - Files: `renderer/src/prefs.ts`, `renderer/src/views/settings.ts` (new `quickLogCard`).
  - Check: manual — Settings shows the control, changing it persists across a reload of the preview
    harness.
  - Size: S

## Log Match card

- [x] **T12 — Map field → locked combobox**
  - Goal: wire T8's new options into the map field; block Save while unresolved.
  - Files: `renderer/src/app/log-match.ts`.
  - Check: manual (`npm run preview`) — typing garbage then blurring reverts; typing an exact known
    name (active or inactive) commits; inactive names appear muted once searched but not in the
    empty-query browse list; Save is disabled while the field holds no committed value.
  - Size: M

- [x] **T13 — Hero picker: most-played shortlist wiring**
  - Goal: fetch `mostPlayedHeroes()` alongside accounts/ranks; shortlist sized by the T11 setting;
    re-rank on account or role change; search reaches the full pool.
  - Files: `renderer/src/app/log-match.ts`.
  - Check: manual — shortlist shrinks to N, changes when switching account/role, search surfaces
    heroes outside the shortlist and toggles them the same as a shortlist chip.
  - Size: M

- [x] **T14 — Rank: Set-current prefill + wheel parity**
  - Goal: seed tier/division/% from the account+role's existing anchor on entering Set-current mode
    (and on account/role change while in it); extract the wheel-nudge helper and apply it to the %
    field too.
  - Files: `renderer/src/app/log-match.ts`.
  - Check: manual — an account+role with an existing rank shows it (not Gold/3/blank) when switching
    to Set-current; one with no anchor still shows the old defaults; scrolling over the % field
    nudges ±1 without scrolling the modal.
  - Size: S

- [x] **T15 — Performance slider in Log Match**
  - Goal: add the field to the card and thread it into the save payload.
  - Files: `renderer/src/app/log-match.ts`.
  - Check: manual — rate a match, save, confirm it's visible on reopening the same match's detail.
  - Size: S

## Review & match-detail

- [x] **T16 — Performance slider in Review**
  - Goal: add a "How you played" section to the grading card; thread into `saveReview`.
  - Files: `renderer/src/views/review.ts`.
  - Check: manual — grade a pending game with a rating, confirm it persists.
  - Size: S

- [x] **T17 — Performance slider in match-detail editor**
  - Goal: show/edit/clear the current rating in the "Edit match" modal.
  - Files: `renderer/src/views/matchDetail.ts`.
  - Check: manual — open a rated match, change the rating, save, reopen and confirm; clear it and
    confirm it reads as unset again.
  - Size: S

## Docs & final verification

- [x] **T18 — README updates**
  - Goal: document the locked map picker, hero shortlist + its setting, rank prefill, and the
    performance slider as user-visible changes (DoD requirement).
  - Files: `README.md`.
  - Check: reads accurately against the shipped behavior.
  - Size: S

- [x] **T19 — Full verification pass**
  - Goal: everything green together, not just per-task.
  - Files: none (verification only).
  - Check: `npm test` and `npm run typecheck` both clean; manual preview walkthrough of every
    Acceptance Criterion in the spec.
  - Size: S

## Consistency gate (spec ↔ plan ↔ tasks)

Every spec Acceptance Criterion group maps to at least one task:

| Spec AC group | Tasks |
|---|---|
| Map field — locked combobox | T8, T12 |
| Hero picker — most-played shortlist + search | T1, T5, T7, T9, T13 |
| Suggested hero count setting | T11 |
| Rank — Set current rank prefill (+ wheel parity) | T14 |
| Performance slider | T2, T3, T4, T6, T7, T10, T15, T16, T17 |
| Regression (`npm test` + `npm run typecheck`) | T19 |

No task traces to zero criteria: T18 (README) and T19 (verification) both trace to the spec's
**Constraints/DoD** section (README updates, both commands green) rather than a numbered AC — not
scope creep, just DoD bookkeeping. No gaps identified.
