# Tech Plan: first-run-targets-ranks

Companion to [`first-run-targets-ranks.spec.md`](./first-run-targets-ranks.spec.md). Synthesized from a
4-area design pass, each adversarially stress-tested. The critiques are folded in as the **Gotchas**
list below — every item there is a verified compile/test/correctness break the naive design missed.

## Architecture summary

All four features fit inside the **existing IPC channel set** — **zero new channels**:

- **Ranks (C):** pure recompute in `src/core/progression.ts`; `Progression` and `MatchDetail.competitive`
  are always derived from `GameRecord[]`, never persisted → a breaking *shape* change with **no migration**,
  only atomic consumer updates.
- **Demo (A) + empty targets (B):** one new persisted field `ui.demoPreference` (tri-state), surfaced
  through the **existing** `getAppSettings`/`setAppSettings` channels (write) and a new read-only field on
  `DashboardData` (read). A single pure `effectiveDemo()` core helper drives both the badge and the data.
- **Editable grades (D):** `saveReview`/`clearReview` already overwrite unconditionally → **no new write
  path**. Only read-surfacing (`MatchDetail.review`) + a UI-composition refactor.

### Implementation order (strict, bottom-up — shared files edited once)

`core → contract → main plumbing → build/preload verify → renderer → tests alongside each`.
The hot shared files (`dataProvider.ts`, `dashboardData.ts`, `matchDetail.ts`, `contract/*`) are each
edited **once** with the union of all features' changes.

---

## Feature C — Rank model (`Progression`)

**`src/core/progression.ts`** (do first, zero deps):
- `TIERS` → 8 entries: append `'Champion'` after `'Grandmaster'`.
- `Progression` becomes `{ tier: string; division: number; progressPct: number; delta: number }`.
  **Drop `sr`** from the public type (keep the scalar as a local only). `delta` is now **signed
  percentage-points** (documented).
- Constants: `TIER_SPAN = 500`, `DIV_SPAN = 100`, `MAX_RATING = TIERS.length * TIER_SPAN - 1` (= 3999).
- `winrateToSr(w)` → `clamp(round(w * TIERS.length * TIER_SPAN), 0, MAX_RATING)` (linear full-ladder;
  100% → top of Champion, 0% → Bronze 5, monotonic). Kept exported for tests; **internal, not displayed.**
- `tierOf(sr)` returns `{ tier, division, progressPct }` where
  `progressPct = ((within % DIV_SPAN) / DIV_SPAN) * 100` (0–100). `idx` clamps to `TIERS.length - 1` (= 7,
  Champion) — this is the one-line fix that makes Champion reachable (C5).
- `progression(games)`: compute scalar internally; `delta = sorted.length >= 4 ? ((newer - older) / DIV_SPAN) * 100 : 0`;
  return the new shape (no `sr`). Extend the module doc comment (8 tiers, percent progress, heuristic).

**`src/core/matchDetail.ts`** `competitiveOf()`: emit `progressPct`/`delta` from `progression`'s new
shape instead of `sr`/`delta`. Reuse `progression`'s math — do **not** hand-roll a second percentage.

**`src/shared/contract/matchDetail.ts`**: `MatchDetail.competitive` inline type →
`{ note; tier?; division?; progressPct?; delta? }` (drop `sr`). `Progression` re-export line unchanged
(shape flows through).

**Renderer:**
- `renderer/src/views/overview.ts`: Rank KPI `value` from `int(d.progression.sr)` → percent readout of
  `d.progression.progressPct` (reuse `pct(x/100)` helper); delta dir/text uses `d.progression.delta`
  (now %), rendered `${signed(Math.round(delta))}%`.
- `renderer/src/views/matchDetail.ts` `competitiveSection()`: delete the local `(c.sr % 100)/100`; use
  `c.progressPct != null ? c.progressPct/100 : null` for the `statBar` `frac`; `valueText` →
  `` `${Math.round(c.progressPct!)}%` ``; delta line → `` `${signed(Math.round(c.delta))}%` ``.
- `renderer/src/app/shell.ts` sidebar account card: `rankLabel(tier, division)` unchanged, but per C4 add a
  terse `NN%` progress suffix next to the label (small, no full bar — keep the compact card uncluttered).
- `renderer/src/format.ts`: `rankLabel` is a bare template (`${tier} ${division}`) — **no tier table**,
  Champion renders fine; confirm only. Optional tiny helper reused for the `%` delta string.

**Rank tests** (`test/vantageCore.test.ts` progression block + `test/matchDetail.test.ts`):
- Existing `tierOf(...).toEqual({tier,division})` (lines ~64–66) now **fail on the added `progressPct`
  key** — rewrite as property assertions or include `progressPct`.
- `winrateToSr(0.5)` and `tierOf(4900)` Grandmaster assertions change (4900 > new ceiling) — update values.
- Any `p.sr` read (line ~73) — remove (field dropped); assert `p.progressPct` (0–100) and `p.division` (1–5).
- NEW: Champion reachable at top of ladder (C1); division 5=lowest / 1=highest across ≥2 tiers incl.
  Champion (C2); `progressPct` ∈ [0,100] over a full sweep (C3); `delta` sign flips with older/newer halves.
- `test/matchDetail.test.ts`: add `progressPct ∈ [0,100]` assertion to the competitive-section test
  (there is **no** existing `.sr` assertion to replace — only add).

---

## Feature A + B — Demo preference + honest empty targets

**`src/core/demoPreference.ts`** (NEW, pure — mirrors the `breakReminder.ts` cross-cutting-type precedent):
```ts
export type DemoPreference = 'unset' | 'on' | 'off';
/** Effective demo display: only when the user opted in AND has no real history (A6). */
export function effectiveDemo(pref: DemoPreference, historyCount: number): boolean {
  return pref === 'on' && historyCount === 0;
}
```

**`src/shared/contract/appSettings.ts`**: `AppUiSettings` gains `demoPreference: DemoPreference`
(import the type from `../../core/demoPreference`).

**`src/main/config/appConfig.ts`**: `UiConfig` gains `demoPreference: DemoPreference`;
`DEFAULTS.ui.demoPreference = 'unset'`. **No** `loadConfig`/`saveLocalUiConfig` change — the existing
`ui: { ...DEFAULTS.ui, ...(local.ui ?? {}) }` spread back-fills old `config.local.json` to `'unset'`.

**`src/main/index.ts`** — composition root `appSettings.get()` / `apply()` closures (**hand-branched per
field** — the design that said it "rides for free" was wrong): add `demoPreference` to the `get()` return
literal (`config.ui.demoPreference`) and an `apply()` branch
(`if (patch.demoPreference !== undefined) { saveLocalUiConfig({ demoPreference: patch.demoPreference }); config = loadConfig(); }`),
plus include it in the returned `AppUiSettings` literal. Reconcile `tray0Status()`/`statusText()` demo
copy: only say "showing demo data" when `config.ui.demoPreference === 'on' && history.count() === 0`;
otherwise "No games yet."

**`src/shared/contract/dashboard.ts`**: `DashboardData` gains `demoPreference: DemoPreference` (read path
for the first-run prompt) and `hasRealHistory: boolean` (for the migration gate + Settings O4 hint).
`isSample` stays; its documented meaning becomes **effective demo** (`effectiveDemo(...)`).

**`src/core/dashboardData.ts`** `computeDashboard`: replace the 3rd param `isSample: boolean` with a
single **demo context object** to avoid param creep and double-derivation:
```ts
demo: { active: boolean; preference: DemoPreference; hasRealHistory: boolean }
```
Set `isSample: demo.active`, `demoPreference: demo.preference`, `hasRealHistory: demo.hasRealHistory` on
the output; gate targets via `buildTargets(games, demo.active, manual?.targets)`.

**`src/core/targets/scoring.ts`** `buildTargets(games, demo: boolean, authored?)`:
```ts
if (authored && authored.length) return authored.sort(...).map(...);
if (demo) return sampleTargets(games);
return [];                       // real mode, no authored → honestly empty (B1)
```

**`src/main/dataProvider.ts`**: compute the A6 boolean **once**.
- `isSample()` → `effectiveDemo(getConfig().ui.demoPreference, history.count())`.
- `games()` → `history.count() ? history.all() : (getConfig().ui.demoPreference === 'on' ? sampleGames() : [])`.
- Add `demoContext()` → `{ active: isSample(), preference: getConfig().ui.demoPreference, hasRealHistory: history.count() > 0 }`.

**`src/main/dashboard/ipcHandlers.ts`** `getDashboard`: pass `provider.demoContext()` as the demo arg to
`computeDashboard` (replacing `provider.isSample()`).

**`src/main/dashboard/provider.ts`**: add `demoContext(): DemoContext` to the `DataProvider` interface
(type defined in contract or core; reuse the `{active,preference,hasRealHistory}` shape).

**Renderer:**
- `renderer/src/app/firstRunPrompt.ts` (NEW): `openFirstRunPrompt(onDone)` — a blocking `overlay--center`
  modal (same primitives as `onboarding.ts`), two buttons: **Load demo data** → `bridge.setAppSettings({ demoPreference: 'on' })`;
  **Start fresh** → `... 'off'`. Then `store.refresh()`, close, `onDone()`. Escape defaults to **off**
  (never silently show fabricated data).
- `renderer/src/app/shell.ts` constructor: remove the unconditional `if (shouldOnboard()) openOnboarding()`.
  Add a `firstRunHandled = false` field; in `onState`, once `state.data` exists and `!firstRunHandled`,
  set the flag and: if `data.demoPreference === 'unset'` → `openFirstRunPrompt(() => { if (shouldOnboard()) openOnboarding(data.isSample); })`;
  else if `shouldOnboard()` → `openOnboarding(data.isSample)`.
- **Fix migration gate** (`shell.ts` ~line 184): change `!state.data.isSample` → `state.data.hasRealHistory`
  so legacy-review import never fires for fresh-start/`unset` users with zero real games.
- `renderer/src/app/onboarding.ts`: `openOnboarding(demoActive: boolean)` — build `const steps = stepsFor(demoActive)`
  once at the top; rename every `STEPS` reference (`draw`, `dots`, `onKey` bounds) to `steps`. Step 2 uses
  demo copy when `demoActive`, fresh-start copy otherwise (A7). Update all call sites of `openOnboarding`
  (constructor + Help link + any keyboard shortcut) to pass the flag.
- `renderer/src/views/settings.ts`: add a demo-data toggle (chip, `apply({ demoPreference })` via
  `bridge.setAppSettings`, same toast/Undo pattern as `closeToTray`), with an O4 hint line shown when
  `ctx.data.hasRealHistory` ("applies only while you have no tracked games").
- `renderer/src/views/targets/index.ts` + `library.ts`: when `!ctx.data.isSample && ctx.data.targets.length === 0`,
  render an `emptyState()` card inviting the user to create their first target instead of an empty library
  shell (B4). Review's `activeStrip()` "none yet — add some on the Targets page" copy already works.
- `renderer/src/store.ts` `statusText()`: keep using `d.isSample` (now correct meaning) for the demo suffix.

**`renderer/preview/preview.ts`** (second `OwStatsApi` mock, in typecheck scope): add `demoPreference` to its
`appSettings` literal + `setAppSettings` mock; pass a `demo` context (`{active:true,preference:'on',hasRealHistory:false}`)
to its `computeDashboard` mock call. Optional `?demo=off` query param to preview empty states.

**Demo/targets tests:**
- `test/demoPreference.test.ts` (NEW): `effectiveDemo` truth table (unset/off/on × empty/non-empty).
- `test/reviewPipeline.test.ts`: update `buildTargets(...)` calls to `(games, demo, authored?)`; update the
  **two `computeDashboard(...)` calls (lines ~172, 185)** to the new demo-object signature. NEW: B1
  `buildTargets(games, false)` → `[]`; B2 `buildTargets(games, true)` → sample (len 4); B3 authored wins
  in both modes.
- `test/vantageCore.test.ts`: update `computeDashboard(...)` calls to the demo object; assert `d.demoPreference`
  and `d.hasRealHistory`; the length-4 sample assertion now needs `demo.active = true`.
- `test/config/appConfig.test.ts` (extend/NEW): old `config.local.json` without `ui.demoPreference` loads as
  `'unset'`; `saveLocalUiConfig({demoPreference})` doesn't clobber `closeToTray`/`windowBounds`.

---

## Feature D — Editable per-match manual tracking

**`src/shared/contract/matchDetail.ts`**: add `review?: MatchReview` to `MatchDetail` (reuse the existing
barreled `MatchReview` type — extend the existing `MatchMental` import line).

**`src/core/matchDetail.ts`**: add `review: game.review,` passthrough next to the existing `mental:` line.
**No signature change** (avoids breaking the 9 two-arg test call sites + preview mock). **No `activeTargets`
on the payload** — the editor reads `ctx.data.targets` (already loaded, already the active set), matching
Review's own `d.targets.filter(t => t.isActive && !t.archivedAt)`.

**`renderer/src/components/reviewControls.ts`** (NEW — extract *before* touching the editor):
- `targetGradeRow(t: TargetSummary, initial: TargetGrade | undefined, onChange): { el; set }` — ported from
  review.ts `gradeRow`+`gradeControl`, generalized to seed `initial`. Returns `{ el, set }` for **every**
  branch (the keyboard hook depends on `set`). Measured targets render the **same** gradeable control as
  today (no read-only badge — no auto-scoring exists in core; D5 kept as status-quo, see Gotchas).
- `mentalFlagsRow(flags: MatchMental, initial?: MatchMental): HTMLElement` — the four flag chips, seeded.
- Same markup/classes (`.review-target`, `.segmented`, `.review-flags`, `.chip`) so Review CSS + H/P/M/S
  keyboard keep working.

**`renderer/src/views/review.ts`**: delete local `gradeRow`/`GRADES`/`gradeControl`/`flagChip`; import and
compose the extracted factories. `kbHook.grade` keeps calling `rows[i].set(g)`.

**`renderer/src/views/matchDetail.ts`**:
- Thread `ctx` through `sections(d)` → `header(d)` (both signatures gain `ctx: ViewContext`).
- Add an **Edit tracking** `button()` (card action) that opens `openTrackingEditor(ctx, d)`.
- `openTrackingEditor`: `openModal` composing `ctx.data.targets.filter(active).map(t => targetGradeRow(t, d.review?.grades[t.id], cb))`
  + `mentalFlagsRow(flags, d.review?.flags)`. **Save** → `bridge.saveReview({ matchId, grades, flags })`,
  `gradedThisSession.add(matchId)`, toast, close, `ctx.refresh()`. **Clear review** (only when `d.review`) →
  `bridge.clearReview(matchId)`, `gradedThisSession.delete(matchId)`, close, `ctx.refresh()`.
- Redraw after save relies on `ctx.refresh()` replacing the `DashboardData` reference → shell re-invokes
  `VIEWS.matchDetail(ctx)` → a fresh `bridge.matchDetail()` fetch. (There is no mount-level refetch hook;
  this is the only mechanism and it works because of the store's key-based re-render.)
- **Keyboard collision**: the shell's global matchDetail `←`/`→`/`Escape` shortcuts must not fire while the
  modal is open — gate them on "no overlay open" (inspect `overlay.ts` for an open-count/flag; add one if
  absent) so stepping doesn't navigate away underneath the modal.

**Grades tests** (`test/matchDetail.test.ts`): assert `matchDetail()` passes `game.review` through unchanged
when present and `undefined` when absent.

---

## Gotchas (verified by the adversarial pass — do not skip)

1. `src/main/index.ts` `appSettings.get()/apply()` are **hand-branched per field**; `demoPreference` needs an
   explicit branch + return-literal entry or it silently never round-trips (and the required-field literal
   won't compile).
2. `renderer/preview/preview.ts` is a **second `OwStatsApi` mock in typecheck scope** — its `AppUiSettings`
   literal and `computeDashboard` mock call both need the new fields, or `npm run typecheck` fails.
3. `test/reviewPipeline.test.ts` has **two `computeDashboard` call sites** (~172, 185) beyond
   `vantageCore.test.ts` — signature change breaks them; `npm test` fails if missed.
4. `tierOf(...).toEqual({tier,division})` tests break on the **added `progressPct` key** regardless of
   numeric retuning; `p.sr` reads break on the dropped field. Rewrite in the same commit.
5. **Migration gate**: `!isSample` no longer means "has real history" under the tri-state — re-gate
   `migrateLegacyReviews` on `hasRealHistory` (else fresh-start users trigger legacy import with 0 games).
6. **`measured` targets have zero auto-scoring anywhere in `src/core`** — keep them manually gradeable
   (status quo). Do **not** add a read-only "auto" badge (breaks grading, implies nonexistent automation).
   True measured auto-scoring is **out of scope**; note the D5 deviation in the final report.
7. `onboarding.ts` `STEPS` is a **module-const closed over by `draw/dots/onKey`** — making step 2 conditional
   is a full "STEPS → local `steps` array" rewrite + `openOnboarding` signature change at all call sites,
   not a one-line splice.
8. **`isSample`/`demo.active` single source**: compute the A6 boolean once in `dataProvider`, thread the one
   value; never re-derive it in `computeDashboard`.
9. **`gradedThisSession`** (`renderer/src/reviews.ts`): the new detail Clear/Save must keep it in sync
   (delete on clear, add on save) to match Review's Undo semantics within a session.
10. **Preload/build**: all changes are types/data — no new runtime import into `preload.ts`. Verify with a
    full `npm run build` (not `tsc` alone) so the esbuild preload bundle stays intact (per 0b59709).

## Definition of Done (from the spec)

`npm test` green · `npm run typecheck` clean (main + renderer) · `npm run build` clean (preload bundle) ·
new pure-core tests (progression, `effectiveDemo`, `buildTargets` gating, `matchDetail.review`) · no `any`
across IPC · README + affected screen specs updated (`screen-overview`, `screen-matches`,
`docs/onboarding/03-codebase-tour`) · none of the 5 guardrails weakened.
