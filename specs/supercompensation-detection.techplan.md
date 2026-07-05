# Techplan: Readiness & training-load coach (`supercompensation-detection`)

**Spec:** `specs/supercompensation-detection.spec.md` (approved 2026-07-05).
**Status:** ready for implementation. Grounded in a verbatim integration scan of the codebase and **hardened against an adversarial design critique** (3 lenses: AC-conformance, edge-case, research-honesty) — see §9 for the defects fixed.

This plan resolves the spec's Open Questions with concrete, conservative, centrally-tunable defaults, and specifies the module layout, algorithm, and exact file-by-file changes.

---

## 1. Architecture decisions (how it plugs in)

- **Readiness rides on `DashboardData`, not a bespoke query.** `mental`, `session`, `breakReminder` are already fields on it. We add `readiness: ReadinessSummary` and `readinessSettings: ReadinessSettings`, both populated in `computeDashboard()`. No new read channel for the verdict.
- **Verdict computed from the UNFILTERED `all` games** (like `reviewInbox`/`recap`) — *fatigue is a property of the person*, so it ignores the account/role/mode/days filter. (Spec RQ 6.)
- **State is evaluated as-of the player's last active moment**, then **rest-days modulate it** (recovery). This is the key structural fix: the verdict is not diluted or erased by the current partial day, so the red "in-the-hole" band is actually reachable while a player is grinding, and de-escalates cleanly once real rest days pass.
- **Local day boundary with a 04:00 reset** (`localDayStamp(ts, resetHour=4)`), **not** UTC. Fatigue is about the player's day/night; a late-night session must count as one day. This reverses the earlier UTC lean and honors the spec's local-day constraint. Sessions are additionally gap-based (timezone-independent). It's DST-safe (recomputed per timestamp) and test-deterministic (fixtures built from local `Date` bucket consistently regardless of CI timezone). This is readiness-local and deliberately distinct from the app's UTC `dayKey` used elsewhere.
- **Settings mirror `breakReminder` end-to-end** — `ReadinessSettings { enabled, launchToast }`, `DEFAULT_READINESS`, `getReadiness`/`setReadiness` IPC, surfaced on `DashboardData.readinessSettings`.
- **Launch toast** = an opt-in (default off) main-process step at startup reusing the existing `notify(title, body)` seam.
- **Core stays pure** (`src/core/readiness/`), Electron-free, unit-tested. **Provably total**: degenerate inputs never throw; the `readinessSummary(all)` call site in `dashboardData.ts` is additionally wrapped in a defensive fallback so a readiness bug can never blank the whole dashboard.

---

## 2. Module layout — `src/core/readiness/`

- `types.ts` — `ReadinessBand`, `ReadinessRecommendation`, `ReadinessSignal`, `ReadinessSummary`, `ReadinessSettings`, `ReadinessTrendPoint`, `ReadinessLoad`, `ReadinessConfidence`.
- `constants.ts` — `DEFAULT_READINESS`, `normalizeReadiness`, and `READINESS_TUNING` (every threshold with a one-line rationale; single source of truth, no magic numbers elsewhere). Reset hour lives here.
- `day.ts` — `localDayStamp(ts, resetHour)` (canonical ms at local-day start), `dayOrdinal(ts)` (integer day index), `localDayKey(ts)` (string). Pure; local-tz-aware; DST-safe.
- `sessions.ts` — `detectSessions(games, gapMinutes): ReadinessSession[]` (gap-based; `minutes = span + firstGameDuration` so END-only timestamps don't under-report), and per-day game counts.
- `signals.ts` — pure extractors evaluated at a given reference time: `loadState(games, ref)`, `mentalState(games, ref)`, `outcomeState(games, ref)`.
- `score.ts` — `readinessScoreAt(games, ref)` → numeric score + intermediates; `bandFor(state, restDays)` (the gated rules).
- `index.ts` — barrel + `computeReadiness(games, now?): ReadinessSummary` (orchestrator), `readinessSummary` alias, `DEFAULT_READINESS`, `normalizeReadiness`.

Consumers import from `../readiness`; pull `GameRecord`/`streak` from `../analytics` only.

---

## 3. The algorithm (hardened)

Every window/threshold is a `READINESS_TUNING` constant (defaults in §3.9). Bias is **hard against false "rest now" alarms** (research: outcomes low-sensitivity; streak effects tiny; ACWR thresholds contested; self-report is the sensitive signal). `now` is injectable; defaults to `Date.now()`.

### 3.0 Input cleaning (first, always)
- Drop games with `timestamp > now` (clock skew / bad import).
- De-duplicate by `matchId`.
- Sort ascending. If the cleaned array is empty → **early-return** the canonical `insufficient-data` summary (no extractors run).

### 3.1 Day & session model
- `dayOrdinal(ts)` via `localDayStamp(ts, RESET_HOUR=4)`: `Date.UTC(localY, localM, localD)` of the reset-shifted local date / 86.4e6 → integer day index. Day differences are exact and DST-safe.
- **Session**: new session when the gap between consecutive match-end timestamps > `SESSION_GAP_MINUTES=90`. `session.minutes = (end-start)/60000 + (firstGame.durationMinutes ?? DEFAULT_GAME_MIN=12)` (END-only stamps otherwise undercount; a single-game session = its duration).
- `activeDayOrdinals` = distinct `dayOrdinal` with ≥1 game. `historySpanDays = lastActiveOrdinal − firstActiveOrdinal` (independent of `now`). `restDays = dayOrdinal(now) − lastActiveOrdinal` (≥ 0 by construction).

### 3.2 Gates before signal work
- **Insufficient**: `historySpanDays < MIN_SPAN_DAYS(14) || totalGames < MIN_GAMES(15)` → `insufficient-data` (score `null`, rec `none`, confidence `low`).
- **Stale**: `restDays >= STALE_DAYS(14)` → band `fresh`, score `null`, confidence `low`, rec `none`, headline "Rested — no games in N days." (Prevents the "confident 100 after quitting" nonsense; a long layoff genuinely means rested-but-unknown.)

### 3.3 Reference time = last active moment
All state signals are computed at `ref = lastActiveTs` (the end of the most recent game), **not** `now`. This makes the verdict reflect the player's condition when they last trained; `restDays` then modulates it (§3.7). Consequence: the red band is reachable during an active grind and isn't silently erased by the current partial day.

### 3.4 Load state (behavioral — primary), at `ref`
- Daily-games series over the `CHRONIC_DAYS=21` day-ordinals ending at `dayOrdinal(ref)` (0 on rest days).
- `chronicActiveDays` = non-zero days in that window. **If `chronicActiveDays < MIN_CHRONIC_ACTIVE_DAYS(7)` → `ratio` is treated as neutral (1.0)** and cannot drive amber/red (kills the thin-history EWMA artifact where a 3-day spike over 18 zero-days mechanically exceeds 1.5).
- Else `acuteLoad = ewma(series, ACUTE_DAYS=3)`, `chronicLoad = ewma(series, CHRONIC_DAYS=21)`, `ratio = round2(acuteLoad / max(chronicLoad, ε))`.
- `acutePerDay` = mean games/day over the last `ACUTE_DAYS` day-ordinals (absolute volume).
- `consecutiveDays` = length of the run of consecutive day-ordinals ending at `lastActiveOrdinal`, each with ≥1 game (independent of `now`).
- `recentLongSession` = any session ending within `ACUTE_MENTAL_DAYS` of `ref` with `minutes >= SESSION_LONG_MINUTES(150)` (≈2.5h — the cognitive-fatigue session length from the research).
- Derived:
  - `highLoad = ratio >= RATIO_ELEVATED(1.3) || acutePerDay >= ABS_ELEVATED_PER_DAY(6) || recentLongSession`
  - `sustainedLoad = consecutiveDays >= SUSTAINED_DAYS(5) && (ratio >= RATIO_HIGH(1.5) || acutePerDay >= ABS_HIGH_PER_DAY(9))`
  — the **absolute arm** (`acutePerDay`) is what lets a *flat, high-volume, never-rests* grinder reach red even though acute≈chronic (ratio≈1.0). `consecutiveDays` alone never causes amber (a normal daily player has a long streak at healthy volume → stays green).

### 3.5 Mental state (self-report — primary, heavily weighted), at `ref`
- Per-game flags OR-merged across `GameRecord.mental` and `review.flags` (per `mental.ts`).
- `flaggedGames(window)` = games carrying ≥1 logged mental flag. **Tilt rate denominators use `flaggedGames`, never decided games** (tilt is per-game regardless of Win/Loss/**Draw** — avoids 0/0 NaN on all-draw windows).
- Acute window = last `ACUTE_MENTAL_DAYS(7)` days; baseline = `CHRONIC_DAYS`.
- `mentalCoverage = flaggedGames(acute) / games(acute)`. If `flaggedGames(acute) === 0` → tilt is **unknown** → `fatigued=false`, confidence `low`.
- `acuteTilt = tiltFlagged(acute) / flaggedGames(acute)`; `baseTilt` likewise over baseline.
- `fatigued = mentalCoverage >= MENTAL_MIN_COVERAGE(0.4) && (acuteTilt >= TILT_ELEVATED_ABS(0.40) || (acuteTilt − baseTilt) >= TILT_ELEVATED_DELTA(0.15))`.

### 3.6 Outcome state (weak — corroboration only)
- `lossStreak = streak(games).count` when type `'L'`; `winrateDip = baseWinrate − acuteWinrate`; `srTrend` = mean `srDelta` over acute **only when present** (else omitted).
- Contributes a **capped** score penalty (`OUTCOME_PENALTY_CAP=8`) and neutral "recent results" signals. **Never enters the band gate** and **outcome signal severity is capped at `watch`** so a losing streak can never render a red-tier chip while the band is green/amber.

### 3.7 Band decision
```
if insufficient            -> 'insufficient-data'   // §3.2
if stale                   -> 'fresh' (low conf)    // §3.2
heavy = (sustainedLoad && fatigued) || highLoad || fatigued
if restDays === 0:                                   // played today (local)
    if sustainedLoad && fatigued -> 'in-the-hole'    // RED
    else if highLoad || fatigued -> 'loaded'         // AMBER
    else                          -> green(§3.8)
else:                                                // restDays >= 1 (resting)
    if heavy -> restDays >= REST_FULL_RECOVER_DAYS(2) ? 'fresh' : 'recovering'
    else     -> green(§3.8)
```
`lastActiveWasHeavy` is now concrete (= `heavy`, evaluated at `ref`). This makes AC-F work: a red-conducive history → 1 rest day → `recovering` → 2 rest days → `fresh`. And AC-B works: moderate play → `heavy=false` → green after a rest day.

### 3.8 Green split (both green; cosmetic label only)
`green = (restDays >= 1 || (ratio <= RATIO_FRESH_MAX(1.15) && acutePerDay <= FRESH_PER_DAY(4))) ? 'fresh' : 'steady'`.

### 3.9 Score, recommendation, confidence
- `score = clamp(round(100 − loadPenalty − mentalPenalty − outcomePenalty + restRecovery), 0, 100)`; `restRecovery` capped at `REST_RECOVERY_CAP(25)`. Score is `null` for insufficient/stale.
- **Recommendation**: `in-the-hole`→`rest-1-2-days` ("Take 1–2 full days off — your load is high and your mental signals are trending down; rest should let your form rebound."); `loaded`→`ease-up`; `recovering`/`fresh`/`steady`/`insufficient-data`→`none` (recovering headline: "You've rested — readiness is rebuilding.").
- **Confidence**: `high` if `chronicActiveDays >= 12 && mentalCoverage >= 0.6`; `low` if insufficient/stale or `mentalCoverage < 0.4`; else `medium`. When confidence is `low`, the **UI suppresses the numeric score** (shows band + "log your mental state to sharpen this") so a crisp number never overclaims precision.

### 3.10 Trend (chart)
`readinessScoreAt(games, endOf(dayOrdinal))` for each of the last `TREND_DAYS(21)` day-ordinals ending at `now`; `{ date, score|null, games }`. Real trajectory, not fabricated. Each point independently total (empty window → `score:null`). O(21·n).

### 3.11 Signals list
Top contributors, most-severe-first, band-driven color: load (`consecutiveDays`, `acutePerDay`/`ratio`, `recentLongSession`), mental (`acuteTilt` vs baseline, coverage caveat), outcome (neutral, ≤ `watch`). Human-readable labels ("6 days in a row without a rest day", "sessions longer than your norm", "tilt on 5 of your last 6 logged games").

---

## 4. `ReadinessSummary` (contract shape)

```ts
export type ReadinessBand = 'fresh' | 'steady' | 'loaded' | 'in-the-hole' | 'recovering' | 'insufficient-data';
export type ReadinessRecommendation = 'none' | 'ease-up' | 'rest-1-2-days';
export type ReadinessConfidence = 'low' | 'medium' | 'high';
export interface ReadinessSignal { key: string; label: string; severity: 'ok' | 'watch' | 'high'; }
export interface ReadinessLoad {
  acutePerDay: number; chronicPerDay: number; ratio: number;
  consecutiveDays: number; restDays: number;
  lastSessionGames: number; lastSessionMinutes: number | null;
}
export interface ReadinessTrendPoint { date: string; score: number | null; games: number; }
export interface ReadinessSummary {
  band: ReadinessBand;
  score: number | null;
  confidence: ReadinessConfidence;
  headline: string;
  recommendation: ReadinessRecommendation;
  recommendationText: string;
  signals: ReadinessSignal[];
  load: ReadinessLoad;
  trend: ReadinessTrendPoint[];
}
export interface ReadinessSettings { enabled: boolean; launchToast: boolean; }
export const DEFAULT_READINESS: ReadinessSettings = { enabled: true, launchToast: false };
```

---

## 5. Exact file-by-file change list

**Core** — (1) `src/core/readiness/{types,constants,day,sessions,signals,score,index}.ts` new. (2) `src/core/dashboardData.ts`: import `readinessSummary`+`DEFAULT_READINESS`; extend `ManualData` with `readiness?: ReadinessSettings`; add `readiness: safeReadiness(all)` (try/catch → insufficient fallback) and `readinessSettings: manual?.readiness ?? DEFAULT_READINESS`.

**Contract** — (3) `dashboard.ts`: import the two readiness types from `../../core/readiness`; add both fields to `DashboardData`. (4) `api.ts`: `getReadiness`/`setReadiness` on `OwStatsApi` + `IPC_CHANNELS` (`settings:get-readiness`/`settings:set-readiness`). (5) `index.ts`: re-export readiness types.

**Main** — (6) `config/appConfig.ts`: `readiness` on `AppConfig`+`DEFAULTS`+`loadConfig` merge line; `saveLocalReadiness`. (7) `config/index.ts`: export it. (8) `dataProvider.ts`: `DataProviderDeps.persistReadiness`; `getReadiness`/`setReadiness`. (9) `dashboard/provider.ts`: add both to `DataProvider`. (10) `dashboard/ipcHandlers.ts`: register both; pass `readiness: provider.getReadiness()` into the `computeDashboard` bag. (11) **Launch toast** in the main composition root (found via `grep nextBreakReminder`/`createDataProvider`): after config+history load, `computeReadiness(history.all())`; if `band==='in-the-hole' && cfg.readiness.enabled && cfg.readiness.launchToast` → `notify(...)` once; wire `persistReadiness`→`saveLocalReadiness`.

**Renderer** — (12) `store.ts`: `'readiness'` into `ViewId` union + `valid` array. (13) `app/shell.ts`: import view, add to `VIEWS`, add NAV item (Insights group, appended). (14) `views/readiness.ts` new. (15) `charts/plots/readinessChart.ts` new (trend line + band zones + tiny captioned supercompensation schematic). (16) `charts/plots/index.ts`: export it. (17) `components/readinessSettingsEditor.ts` new (mirror `breakReminderEditor`). (18) `views/settings.ts`: add Readiness card. (19) `views/overview.ts`: compact readiness card in `bottomRow`, gated on `readinessSettings.enabled`. (20) `renderer/preview/preview.ts`: `getReadiness`/`setReadiness` mocks + localStorage + pass `readiness` into `computeDashboard`.

**Docs & tests** — (21) `README.md` (Screens + Architecture bullets). (22) `docs/onboarding/03-codebase-tour.md` if it enumerates core modules. (23) `test/readiness.test.ts`.

---

## 6. Test plan (`test/readiness.test.ts`)

Local `game()`/`games()` factories; timestamps built from local `Date` day offsets so day math is CI-timezone-robust; `now` explicit.

- `DEFAULT_READINESS`/`normalizeReadiness`.
- **Totality (no throw)**: `[]`, single game, all draws, all one day, all-far-past (stale), future timestamps, duplicate matchIds, duplicate timestamps → each returns a well-formed summary; `computeReadiness([])` and every trend point are total.
- **A insufficient**: span<14 or <15 games → `insufficient-data`, `score===null`.
- **Stale**: enough history but last game ≥14 days ago → `fresh`, `score===null`, confidence `low`.
- **B green**: ~3 weeks moderate consistent play (consecutiveDays≥5, ratio≈1.0, acutePerDay≤4, low/absent tilt), played today → `fresh`/`steady`, rec `none` (the false-amber regression test).
- **C amber via volume**: acute games/day spike (ratio≥1.3 or acutePerDay≥6), low tilt → `loaded`, rec `ease-up`.
- **C amber via session length**: flat games/day but a ≥150-min session → `loaded` (the session-length gate).
- **D red (flat grinder)**: consecutiveDays≥5, acutePerDay≥9, ratio≈1.0, acuteTilt≥0.4 coverage≥0.4, played today → `in-the-hole`, rec `rest-1-2-days` (proves the absolute arm; red not dependent on acceleration).
- **D red (spike)**: consecutiveDays≥5, ratio≥1.5, fatigued → `in-the-hole`.
- **E loss-streak alone**: heavy losing streak, no elevated tilt, moderate load → not red.
- **F recovery**: from a red history, `now`+1 local day (0 games) → `recovering`, rec `none`; `now`+2 days → `fresh`.
- **G ordinary variance**: 4-game losing streak in moderate well-rested play → green/amber, never red.
- **H cross-account**: two accounts same days aggregate (person-level); dedupe by matchId.
- **I sparse mental**: coverage<0.4 under heavy load → ≤ `loaded`, confidence `low`, no crash.
- **J no srDelta**: valid band, no throw.
- **Thin-history artifact**: 15 games in 2 days just past the gate → ratio treated neutral, not red/amber from geometry.
- **Boundaries**: span exactly 14, exactly 15 games, ratio exactly 1.5, consecutiveDays exactly 5 (document/assert inclusivity; ratio rounded to 2dp).
- **Trend**: `TREND_DAYS` points, scores in 0..100 or null.

---

## 7. Resolved Open Questions (from the spec)

- **Thresholds/windows** → the `READINESS_TUNING` defaults (§3), conservative + centrally tunable; flagged in-code as heuristic, not validated for OW2. Red requires *sustained absolute load OR a genuine acute spike* AND self-reported fatigue AND coverage≥0.4.
- **Rest length / readiness-to-return** → default 1–2 days; `recovering` at `restDays≥1` off a heavy state, `fresh` at `restDays≥2`.
- **Minimum history** → `MIN_SPAN_DAYS=14` AND `MIN_GAMES=15`; plus a `STALE_DAYS=14` recency gate.
- **Day-boundary reset hour** → **resolved as LOCAL time with a 04:00 reset** (`RESET_HOUR=4`), reversing the earlier UTC lean; sessions gap-based. Honors the spec's local-day constraint and removes the UTC late-night misattribution.

---

## 8. Definition of Done (per CLAUDE.md)
1. `npm test` green (new `test/readiness.test.ts` + existing suite).
2. `npm run typecheck` clean (main + renderer; preview mock satisfies full `OwStatsApi`).
3. New pure `src/core/readiness/` logic ships with unit tests.
4. README (+ onboarding tour if applicable) updated.
5. No guardrail weakened: GEP-only (post-hoc only), pure core, CSP-friendly single bundle, typed IPC (no `any`), local-first.

---

## 9. Defects fixed after the design critique (traceability)
- **`lastActiveWasHeavy` undefined** → now `heavy` evaluated at `ref` (§3.7).
- **Red unreachable / rest-gate short-circuit** → state evaluated at `ref=lastActiveTs`, restDays modulates (§3.3, §3.7); red fires at `restDays===0`.
- **Flat grinder never red (`ratio≥1.5` only)** → absolute-load arm `acutePerDay≥ABS_HIGH_PER_DAY` in `sustainedLoad` (§3.4).
- **AC-B false amber (`consecutiveDays≥4` alone)** → `consecutiveDays` removed from `highLoad`; only in the red conjunction (§3.4).
- **AC-C session length ungated** → `recentLongSession` added to `highLoad` (§3.4).
- **NaN tilt on all-draws** → tilt denominators use `flaggedGames`, not decided (§3.5).
- **Stale history → confident 100** → `STALE_DAYS` gate → `fresh`/null/low-confidence (§3.2).
- **Thin-history EWMA ratio artifact** → `MIN_CHRONIC_ACTIVE_DAYS` neutralizes `ratio` (§3.4).
- **Future timestamps / dupes** → input cleaning drops future, dedupes matchId (§3.0).
- **UTC session-splitting / local-day ACs** → local 04:00 day boundary (§1, §3.1).
- **Empty/degenerate crashes blank dashboard** → provably-total early returns + `safeReadiness` try/catch at the call site (§1, §3.0, §5).
- **Outcome severity visually overclaims** → outcome signals capped at `watch`; chip color band-driven (§3.6).
- **Low-confidence crisp score** → numeric score suppressed when confidence `low` (§3.9).
```
