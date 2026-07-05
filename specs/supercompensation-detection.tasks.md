# Tasks: Readiness & training-load coach (`supercompensation-detection`)

**Techplan:** `specs/supercompensation-detection.techplan.md`. Ordered so each slice is independently testable. Definition of Done gates (npm test + typecheck) run at the end of each major slice.

## Slice 1 — Core readiness model (pure, TDD)
1. `src/core/readiness/constants.ts` — `READINESS_TUNING` (all thresholds + rationale), `DEFAULT_READINESS`, `normalizeReadiness`, `RESET_HOUR`.
2. `src/core/readiness/types.ts` — all readiness types (§4).
3. `src/core/readiness/day.ts` — `localDayStamp`/`dayOrdinal`/`localDayKey` (local 04:00, DST-safe).
4. `src/core/readiness/sessions.ts` — `detectSessions` (gap-based; minutes = span + first-game duration), per-day counts.
5. `src/core/readiness/signals.ts` — `loadState`/`mentalState`/`outcomeState` at a reference time; flag-based tilt denominators; ratio neutralized on thin chronic support.
6. `src/core/readiness/score.ts` — `readinessScoreAt`, `bandFor(state, restDays)`.
7. `src/core/readiness/index.ts` — `computeReadiness(games, now?)` orchestrator (input cleaning → gates → state@ref → band → score → rec → confidence → signals → trend), barrel exports, `insufficient`/`stale` canonical builders (also the try/catch fallback shape).
8. `test/readiness.test.ts` — full plan (§6): totality, A–J, thin-history, boundaries, trend. **`npm test` green.**

## Slice 2 — Contract + read-model
9. `src/shared/contract/dashboard.ts` — add `readiness`, `readinessSettings` to `DashboardData`.
10. `src/shared/contract/api.ts` — `getReadiness`/`setReadiness` + channels.
11. `src/shared/contract/index.ts` — re-export readiness types.
12. `src/core/dashboardData.ts` — `ManualData.readiness?`; `readiness: safeReadiness(all)`; `readinessSettings: manual?.readiness ?? DEFAULT_READINESS`. **typecheck (main).**

## Slice 3 — Main wiring + persistence + launch toast
13. `src/main/config/appConfig.ts` (+ `index.ts`) — `readiness` on `AppConfig`/`DEFAULTS`/`loadConfig`; `saveLocalReadiness`.
14. `src/main/dataProvider.ts` — `persistReadiness`; `getReadiness`/`setReadiness`.
15. `src/main/dashboard/provider.ts` — add to `DataProvider`.
16. `src/main/dashboard/ipcHandlers.ts` — register handlers; thread `readiness` into `computeDashboard`.
17. Launch toast in the composition root (opt-in, default off). **typecheck (main).**

## Slice 4 — Renderer
18. `renderer/src/store.ts` — `ViewId` + `valid`.
19. `renderer/src/charts/plots/readinessChart.ts` (+ barrel) — trend line + band zones + captioned schematic.
20. `renderer/src/components/readinessSettingsEditor.ts` — enable + launch-toast chips.
21. `renderer/src/views/readiness.ts` — verdict / why / load / chart / honesty-note; low-confidence suppresses score; `highlight` support.
22. `renderer/src/app/shell.ts` — import, `VIEWS`, NAV item.
23. `renderer/src/views/overview.ts` — compact readiness card (gated on enabled) → `navigate('readiness')`.
24. `renderer/src/views/settings.ts` — Readiness card.
25. `renderer/preview/preview.ts` — mocks + localStorage + thread into `computeDashboard`. **typecheck (renderer) + `npm run preview` smoke.**

## Slice 5 — Docs, review, verify
26. `README.md` (Screens + Architecture); `docs/onboarding/03-codebase-tour.md` if applicable.
27. **`npm test` + `npm run typecheck` both clean.**
28. Adversarial code-review pass on the diff; fix findings.
29. Preview verification (band renders; honesty note present; disabled hides surfaces).

## Slice 6 — PR
30. Commit, push, open PR with summary + evidence-base note + guardrail check.
