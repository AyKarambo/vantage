# Tech plan — tracking & rank overhaul (+ Notion import, UX fixes)

Consolidated plan for `manual-tracking-and-rank-overhaul`, `notion-import`, and
`ui-fixes-toasts-autolaunch-charts`. Implemented on `feature/manual-tracking-overhaul` in
committed waves, each leaving `npm test` + `npm run typecheck` green.

## Data model (core, pure)
- `MatchMental` (`core/analytics/types.ts`): add `leaverMyTeam?`, `leaverEnemyTeam?`.
  Keep legacy `leaver?` readable; `leaverCount()` helper treats legacy `leaver` as
  my-team.
- `GameRecord`: add `source?: 'manual' | 'gep'` and `srDelta?: number` (signed %-points,
  competitive only). `sourceOf(game)` infers `manual` from a `manual`/`manual-notion`
  matchId prefix for legacy records.
- New `core/rank/`:
  - `types.ts`: `RankAnchor { tier, division, progressPct, setAt }`,
    `RankState { tier, division, progressPct, protected, needsReanchor }`.
  - `engine.ts`: pure ladder math. `applyMatch(state, {result, srDelta})`,
    `computeRank(anchor, comps)`, `rankKey(account, role)`. Promotion carries remainder;
    a loss to ≤0% first enters protection (holds at 0%), a further loss demotes one
    division and sets `needsReanchor`.
  - `timeline.ts`: `competitiveComps(games, account, role, sinceTs)` → ordered
    `{result, srDelta, timestamp}` for one (account, role).
- Tests: `test/rank.test.ts` (promotion, demotion, protection, re-anchor, edit-forward),
  `test/mental.test.ts` extension (leaver team counts).

## Persistence (store, main-only)
- `store/rankAnchors.ts`: `RankAnchorStore` — JSON file `rankAnchors.json`, keyed
  `account::role` → latest `RankAnchor`. `get`, `all`, `set`.
- `store/history.ts`: add `editManual(matchId, patch)` — patch only manual-layer fields
  (result/role/map/heroes/gameType for manual matches; mental/srDelta/review for any);
  and `upsertImported(game)` for Notion import (skip if id exists).
- Accounts stay in `AppConfig.accounts`; add `saveLocalAccounts(map)` helper in
  `config/appConfig.ts`.

## Contract (shared/contract)
- `inputs.ts`: extend `ManualMatchInput` with `account?`, `srDelta?`,
  `grades?: Record<string,TargetGrade>`, and mental gains the leaver-team flags via
  `MatchMental`. Add `MatchEditInput`, `AccountInput`, `RankAnchorInput`.
- `matchDetail.ts`: `MatchDetail` gains `source`, `srDelta`, and richer `competitive`
  (`note: 'calculated'`, `protected`, `needsReanchor`).
- `api.ts`: new methods + channels — `listAccounts`, `saveAccount`, `deleteAccount`,
  `getRankAnchors`, `setRankAnchor`, `editMatch`, `importNotion`.
- New payload types: `AccountSummary`, `RankSummary`, `ImportResult`.

## Main (edges)
- `dataProvider.ts`: implement the new methods over injected deps
  (`rankAnchors`, `history.editManual`, config account writes, `notion.import`).
  `logMatch` now honours `input.account`, persists `srDelta` + grades, and auto-creates an
  anchor prompt path (anchor set is a separate call from the renderer).
- `notion/notionImporter.ts`: query the Gametracker data source, map rows → `GameRecord`,
  dedup by Match ID. Wire into `notionRuntime.import()`.
- `index.ts` composition root: construct `RankAnchorStore`, pass new deps, register the new
  IPC handlers with sender validation (mirror existing dashboard-channel guard).

## Renderer
- `app/log-match.ts`: account picker (defaults last-used), mode-gated SR% input + first-
  time anchor sub-form, leaver split into two chips, active-target inline grading.
- `views/matchDetail.ts` + editor modal: edit the manual layer for any match; lock GEP
  facts on `source === 'gep'`; show calculated rank + protection.
- `views/settings.ts`: Accounts panel (CRUD + per-role rank display + editable anchor);
  remove settings toasts; fix run-at-login checkbox reflection; Notion Import button.
- `charts/plots/lineChart.ts`, `scatterChart.ts` / `styles/app.css`: `max-width: 960px`
  cap on the chart wrappers.

## Sequencing (waves, each committed green)
0. Specs + plan.
1. UX fixes (toasts, run-at-login, chart cap).
2. Data model + rank engine + tests.
3. Leaver split + mental + log-match leaver/targets/SR%.
4. Accounts CRUD + picker + rank anchors + settings ranks panel.
5. Edit-any-match.
6. Notion import.
7. Adversarial review + PR.
