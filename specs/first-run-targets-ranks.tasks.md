# Breakdown: first-run-targets-ranks

Ordered bottom-up so shared files are touched once. Each task lists its files and the tests that prove it.
Checkboxes track the autonomous implementation run.

## T1 — Rank model core (C)
- [x] `src/core/progression.ts`: 8 tiers (+Champion), drop `sr` from `Progression`, add `progressPct`,
      `delta` as %-points, `tierOf` returns `progressPct`, new `winrateToSr` ceiling.
- [x] `test/vantageCore.test.ts` progression block: fix `toEqual`/`sr`/`winrateToSr(0.5)`/`tierOf(4900)`;
      add Champion / division-ordering / progressPct-bounds / delta-sign cases.
- Proves: C1, C2, C3, C5 (core).

## T2 — Rank contract + core matchDetail (C)
- [x] `src/core/matchDetail.ts`: `competitiveOf` emits `progressPct`/`delta`.
- [x] `src/shared/contract/matchDetail.ts`: `competitive` type drops `sr`, adds `progressPct`.
- [x] `test/matchDetail.test.ts`: add `progressPct ∈ [0,100]` assertion.
- Depends: T1.

## T3 — Demo preference core + config + contract (A/B)
- [x] `src/core/demoPreference.ts` (NEW): `DemoPreference`, `effectiveDemo`.
- [x] `src/shared/contract/appSettings.ts`: `AppUiSettings.demoPreference`.
- [x] `src/main/config/appConfig.ts`: `UiConfig.demoPreference` + `DEFAULTS.ui`.
- [x] `src/shared/contract/dashboard.ts`: `DashboardData.demoPreference` + `hasRealHistory`.
- [x] `test/demoPreference.test.ts` (NEW): `effectiveDemo` truth table.
- [x] `test/config/appConfig.test.ts`: back-compat + no-clobber.

## T4 — Targets gating + dashboardData threading (B)
- [x] `src/core/targets/scoring.ts`: `buildTargets(games, demo, authored?)` → `[]` in real mode.
- [x] `src/core/dashboardData.ts`: `computeDashboard` takes the `demo` context object; gates targets;
      outputs `isSample`/`demoPreference`/`hasRealHistory`.
- [x] `test/reviewPipeline.test.ts`: update `buildTargets` + `computeDashboard` calls; add B1/B2/B3.
- [x] `test/vantageCore.test.ts`: update `computeDashboard` calls; assert new fields.
- Depends: T3.

## T5 — Main plumbing (A/B)
- [x] `src/main/dataProvider.ts`: `isSample()`/`games()`/`demoContext()` via `effectiveDemo`.
- [x] `src/main/dashboard/provider.ts`: `demoContext()` on the interface.
- [x] `src/main/dashboard/ipcHandlers.ts`: pass `provider.demoContext()` to `computeDashboard`.
- [x] `src/main/index.ts`: `appSettings.get/apply` demoPreference branch; reconcile tray/status copy.
- Depends: T3, T4.

## T6 — Editable grades contract + core (D)
- [x] `src/shared/contract/matchDetail.ts`: `MatchDetail.review?: MatchReview`.
- [x] `src/core/matchDetail.ts`: `review: game.review` passthrough.
- [x] `test/matchDetail.test.ts`: review present/absent passthrough.

## T7 — Shared review controls component (D)
- [x] `renderer/src/components/reviewControls.ts` (NEW): `targetGradeRow`, `mentalFlagsRow`.
- [x] `renderer/src/views/review.ts`: consume the extracted factories (no behavior change; keyboard intact).

## T8 — Match-detail editor + ranks display (C/D — same file)
- [x] `renderer/src/views/matchDetail.ts`: thread `ctx` through `sections/header`; Edit-tracking modal
      (save/clear via existing bridge, `gradedThisSession` sync, `ctx.refresh()`); competitive section uses
      `progressPct`; keyboard-shortcut suppression while modal open.

## T9 — Remaining renderer (A/B/C)
- [x] `renderer/src/app/firstRunPrompt.ts` (NEW) + `shell.ts` wiring + migration-gate fix + sidebar % .
- [x] `renderer/src/app/onboarding.ts`: conditional step 2, `openOnboarding(demoActive)`.
- [x] `renderer/src/views/settings.ts`: demo toggle + O4 hint.
- [x] `renderer/src/views/targets/index.ts` + `library.ts`: empty state.
- [x] `renderer/src/views/overview.ts`: rank KPI %.
- [x] `renderer/src/app/shell.ts`: sidebar rank % (if not done in T8 scope).

## T10 — Preview mock + docs + full verify
- [x] `renderer/preview/preview.ts`: mock parity (`demoPreference`, `setAppSettings`, demo ctx).
- [x] Docs: `README.md`, `specs/screen-overview.spec.md`, `specs/screen-matches.spec.md`,
      `docs/onboarding/03-codebase-tour.md`.
- [x] `npm run typecheck` (main + renderer), `npm test`, `npm run build` (preload bundle) all green.
- [x] Preview smoke: first-run prompt, empty targets, Champion rank, edit-tracking round-trip.

## Adversarial review (post-implementation)
- [x] Workflow: fan-out reviewers (correctness, guardrails/CSP, contract-typing, tests, UX) → verify → fix.
