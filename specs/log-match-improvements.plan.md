# Techplan: Log Match screen improvements

Derived from [log-match-improvements.spec.md](log-match-improvements.spec.md). Grounded in a
parallel codebase survey (comms/`positiveComms` consumers, the rank-anchor/protection flow,
renderer composition primitives, the contract/provider/test path).

## Architecture & Approach

Five feature slices, ordered foundation-first (core/contract → notion → renderer → docs). The two
model-level changes (comms tone, negative-% anchor protection) are deliberately **legacy-compatible
and helper-centralized** so the blast radius stays small and readers never diverge.

### A. Comms tone (replaces `positiveComms`, keeps it readable)

- Add `export type CommsTone = 'positive' | 'banter' | 'abusive'` and `comms?: CommsTone` to
  `MatchMental` (`src/core/analytics/types.ts`). **Keep `positiveComms?: boolean`** as a documented
  legacy field so stored records still typecheck and read correctly.
- New pure helper module `src/core/comms.ts`:
  - `commsTone(m?: MatchMental | null): CommsTone | undefined` → `m?.comms ?? (m?.positiveComms ? 'positive' : undefined)`
  - `isPositiveComms(m)` → `commsTone(m) === 'positive'`
  - `isAbusiveComms(m)` → `commsTone(m) === 'abusive'`
- Route **every read** of the positive signal through `isPositiveComms` so legacy `positiveComms:true`
  and new `comms:'positive'` are equivalent: `mental.ts` (posShare, rowFlags), `session.ts` recap loop
  (special-case the `positiveComms` key), `readiness/signals.ts` `positiveFlagged`,
  `notion/notionExporter.ts` `exportMental`.
- **New writes** set `comms` only (the log form). Review/matchDetail keep writing the legacy
  `positiveComms` boolean for their binary "good comms" chip — fully supported by the helper, so those
  screens need no behavioral change (only a small read/normalize tweak, below).
- **Surfacing `abusive`:** add `'abusive'` to `MatchFlagKey` (`src/core/mental.ts`) and an
  `abusive: number` counter to `MentalSummary.flags`. `rowFlags` emits `positiveComms` (compat) and
  `abusive`. TypeScript will force `FLAG_LABELS` entries in `renderer/src/views/matches.ts` and
  `renderer/src/views/mental.ts` (a `flagBox` for abusive, negative framing). `banter` is neutral —
  stored + round-tripped but not counted/surfaced (keeps the change minimal per spec resolved-Q6).
- **Calm formula unchanged** beyond the key: `posShare = (#comms==='positive')/n`; abusive/banter are
  simply non-positive, so they no longer add to calm — no touch to tilt/toxic scoring.

### B. Multi-hero capture

- Add `heroes?: string[]` to `ManualMatchInput` and (for contract consistency) `MatchEditInput`
  (`src/shared/contract/inputs.ts`). Keep the legacy `hero?: string`.
- `dataProvider.ts` `logMatch`: `heroes: input.heroes ?? (input.hero ? [input.hero] : [])`.
  `editMatch`: honor `input.heroes` when provided (undefined = unchanged, `[]` = clear), else fall back
  to the existing single-`hero` coercion. Downstream aggregation (`byHero`, `heroStats`) already counts
  each hero in `heroes[]` — no change.
- Renderer: replace the single-hero typeahead with a **role-filtered toggle-chip grid** (the existing
  `flagsBlock` idiom + the `chip()` primitive). Rendered set = `union(heroesForRole(role), alreadyPicked)`
  so switching role keeps off-role picks visible/removable; Open Queue → all heroes. Selection held in a
  `Set<string>`; repainted on role change.

### C. Role filter + Open Queue

- Add Open Queue to the log form's role control: `ROLE_LABELS` gains `{ 'Open Queue': 'openQ' }`; the
  role `choiceSegment` renders 4 options. `heroesForRole('openQ')` returns `ALL_HEROES`; others return
  `HEROES_BY_ROLE[role]` (from `src/core/heroes.ts`). On role change → repaint the hero grid.

### D. SR preset + wheel + Set-current toggle + negative-% protection

- **Core:** `stateFromAnchor` (`src/core/rank/engine.ts`) becomes:
  ```ts
  const p = clamp(anchor.progressPct, -100, 100);
  return { tier, division: clamp(anchor.division,1,5), progressPct: p, protected: p < 0, needsReanchor: false };
  ```
  This is the only clamp on the anchor path; every other link already passes negatives verbatim. The
  existing "malformed anchor" test still passes (250→100, protected:false).
- **SR field (Change mode):** a `srDeltaInput` that presets to `+25/−25/0` from the result and supports
  mouse-wheel ±1. State: `srDelta: string`, `srEdited: boolean`. On result change, if `!srEdited`, set
  the preset and repaint. Typing/wheeling sets `srEdited=true`. Wheel handler attached with
  `{ passive:false }` + `preventDefault()` so the modal doesn't scroll; blank stays "no SR".
- **Mode toggle:** a `segmented` "Change (±%)" / "Set current rank" in the rank block (`paintRank`).
  - Change mode: SR delta field; plus the existing first-match "set once" anchor picker when
    `!hasAnchor` (baseline needed).
  - Set-current mode: the tier/division/% picker only (reusing `anchorTier/anchorDivision/anchorPct`
    state), % placeholder hints negatives = protection. Hide the delta field.
- **Save (`persist`):**
  - Change mode: `srDelta` from the field (blank = omit); first-match anchor as today.
  - Set-current mode: **omit `srDelta`** and call `bridge.setRankAnchor({...entered, progressPct})`
    (negative allowed) — re-anchors to the entered current rank. No delta means no double-count
    regardless of match/anchor timestamp ordering. Works for first-match (sets baseline) and drift
    correction (re-anchor) alike.
- **Settings parity:** `openSetRank` (`settings.ts`) already forwards `Number(pct)||0` negative-safe and
  shows 🛡 in `ranksLine`; just update the `numField` placeholder to signal negatives.
- **Protection display gaps:** add a 🛡 indicator to the sidebar rank line (`renderer/src/app/shell.ts`
  `rankLine`) and the Overview KPI (`renderer/src/views/overview.ts` `rankKpi`) so a negative anchor
  never shows as a bare unexplained `-19%`.

### E. Notion round-trip

- `notionWriter.ts` `subjectiveProps`: map `commsTone(mental)` → `select('positive'|'banter'|'abusive')`,
  clear when undefined.
- `notionImporter.ts` `mentalFrom`: map `pickSelect(props['Comms'])` → `comms` for
  `positive|banter|abusive`, **tolerating legacy `'banther'` → `banter`**.
- `notionExporter.ts` `exportMental`: merge the tone from `game.mental` + `game.review?.flags` (prefer a
  defined tone; `positive` from legacy `positiveComms`) onto `mental.comms`.
- `notionBookkeeping.ts`: replace `'positiveComms'` with `'comms'` in the hardcoded signature key list
  and the `mergedMentalForSignature` copy, so a comms-tone change re-triggers sync.
- Optional polish: seed `COMMS_OPTIONS` in `buildGametrackerProperties` so a fresh auto-created DB shows
  all three options. (Include if low-risk.)

### F. Sample data + docs

- `sampleData/generate.ts`: replace the `positiveComms` boolean with a weighted random `comms` tone
  (mostly positive/none, some banter, rare abusive).
- Update README / relevant docs for the new log-card behavior.

## Affected Files/Modules

**Core (pure, tested):**
- `src/core/analytics/types.ts` — `CommsTone`, `MatchMental.comms`.
- `src/core/comms.ts` — **new** helpers.
- `src/core/mental.ts` — `MatchFlagKey += 'abusive'`, `MentalSummary.flags.abusive`, posShare/rowFlags via helper.
- `src/core/analytics/session.ts` — recap positive read via helper.
- `src/core/readiness/signals.ts` — `positiveFlagged` via helper.
- `src/core/rank/engine.ts` — `stateFromAnchor` negative → protected.
- `src/core/sampleData/generate.ts` — random comms tone.
- `src/core/targets/notionBookkeeping.ts` — signature key list.

**Contract / main:**
- `src/shared/contract/inputs.ts` — `heroes?: string[]` on both inputs.
- `src/main/dataProvider.ts` — `logMatch`/`editMatch` heroes mapping (mental/comms auto-passes).

**Notion:**
- `src/notion/notionWriter.ts`, `notionImporter.ts`, `notionExporter.ts` (+ maybe `gametrackerSchema.ts`).

**Renderer:**
- `renderer/src/app/log-match.ts` — multi-hero grid, Open Queue role, SR preset/wheel, Set-current toggle, comms switch, `mentalFrom`.
- `renderer/styles/components.css` — comms switch color classes.
- `renderer/src/views/settings.ts` — anchor % placeholder hint.
- `renderer/src/app/shell.ts`, `renderer/src/views/overview.ts` — 🛡 in rank line/KPI.
- `renderer/src/views/matchDetail.ts` — read-side comms pill via helper; normalize comms→positiveComms for the binary editor chip.
- `renderer/src/views/matches.ts`, `renderer/src/views/mental.ts` — `FLAG_LABELS` + abusive box (compiler-forced).

**Tests:** `test/mentalSummary.test.ts`, `test/rowFlags.test.ts`, `test/readiness.test.ts`,
`test/rank.test.ts`, `test/logMatchProvider.test.ts`, `test/notionExporter.test.ts`,
`test/notionImporter.test.ts`, `test/vantageCore.test.ts` (+ new `test/comms.test.ts`).

## Data Model / Interfaces

```ts
// analytics/types.ts
export type CommsTone = 'positive' | 'banter' | 'abusive';
export interface MatchMental {
  tilt?: boolean;
  toxicMates?: boolean;
  leaver?: boolean;
  leaverMyTeam?: boolean;
  leaverEnemyTeam?: boolean;
  /** @deprecated legacy — read via commsTone(); new writes use `comms`. */
  positiveComms?: boolean;
  comms?: CommsTone;
}

// contract/inputs.ts
interface ManualMatchInput { /* … */ hero?: string; heroes?: string[]; /* … */ }
interface MatchEditInput   { /* … */ hero?: string; heroes?: string[]; /* … */ }

// mental.ts
export type MatchFlagKey = 'tilt' | 'toxicMates' | 'leaver' | 'positiveComms' | 'abusive';
// MentalSummary.flags gains `abusive: number`
```

`stateFromAnchor`: negative anchor `progressPct` preserved (clamped `[-100,100]`), `protected = p < 0`.

## Test Strategy

- **comms helpers** (`test/comms.test.ts`): `commsTone` prefers `comms`, falls back to legacy
  `positiveComms`; `isPositiveComms`/`isAbusiveComms` for each tone + legacy.
- **mental composite** (`mentalSummary`, `rowFlags`): a `comms:'positive'` game and a legacy
  `positiveComms:true` game score identically (posShare/calm); `comms:'abusive'` increments
  `flags.abusive` and emits a row flag but does not raise calm; `banter` is neutral.
- **readiness**: `positiveFlagged` true for both `comms:'positive'` and legacy.
- **rank** (`rank.test.ts`): a `progressPct:-19` anchor → `protected:true, progressPct:-19`; a
  subsequent loss demotes / a win pays down the carry (via existing `applyMatch`); malformed
  upper-bound clamp still passes.
- **provider** (`logMatchProvider.test.ts`): `logMatch({ heroes:['Tracer','Widowmaker'] })` →
  `recorded[0].heroes` deep-equals; `logMatch({ mental:{ comms:'abusive' } })` → stored on the record;
  legacy `{ hero:'Tracer' }` still → `['Tracer']`.
- **notion**: export writes `Comms` select for each tone + clears when none; import maps
  `positive|banter|abusive|banther`; legacy `positiveComms:true` still exports `'positive'`; signature
  changes when the tone changes.
- All acceptance criteria trace to at least one test or a manual preview check (see tasks
  consistency gate).

## Risks & Alternatives

- **Risk: read-site divergence** — a missed `positiveComms` read would drop new-record positives.
  *Mitigation:* centralize via `isPositiveComms`; grep for `positiveComms` after the change; the
  `MatchFlagKey` `Record`s compiler-force the UI label sites.
- **Risk: Notion test surface** (`notionExporter.test.ts` is large). *Mitigation:* the tone maps 1:1
  onto the existing single-branch logic; update fixtures alongside.
- **Risk: negative `progressPct` in `statBar`** (matchDetail division bar) producing a negative fill.
  *Note:* this already happens for mid-timeline protected losses today; verify `statBar` clamps `frac`
  (clamp at the call site if not) — no regression introduced, just made reachable from anchors.
- **Alt considered — derive a per-match delta for Set-current** (instead of re-anchor): rejected in the
  spec; re-anchor is simpler, protection-native, and unifies with Settings' Set-rank.
- **Alt considered — extend `typeahead` with an `onPick` for a hero multi-select**: rejected in favor of
  the zero-shared-component toggle-chip grid; role filtering makes the chip count manageable.
