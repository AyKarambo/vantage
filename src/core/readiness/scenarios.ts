/**
 * Curated scenario library for the readiness help wiki — a deliberately TRIMMED
 * set of archetype "player stories" (9, not the full 29-scenario catalog) that
 * teach how the model behaves without overloading a casual reader. Single source
 * of truth for the renderer (browsable library + "you're closest to…"), the
 * nearest-scenario matcher, and the drift-guard test.
 *
 * Pure data + types — no engine math, no DOM. The full engine-verified catalog
 * lives in `specs/readiness-data-regimes.scenarios.md` and its regression pins in
 * `test/readinessScenarios.test.ts`; this file is the user-facing, plain-language
 * subset, re-authored (not copied) so tier-1 copy carries no jargon.
 */

import type { ReadinessBand, ReadinessRegime } from './types';

/** The four plain-language buckets the library groups archetypes into. */
export type ScenarioGroup = 'healthy' | 'recovery' | 'overload' | 'guardrail';

/**
 * Matcher bucket — the seven display bands collapsed so a live read is only ever
 * compared against archetypes in the same qualitative state (a "loaded" user
 * never matches a "fresh" archetype). `insufficient-data` never reaches the
 * matcher (it short-circuits on a null score), so it maps to a harmless default.
 */
export type BandGroup = 'green' | 'recovering' | 'rusty' | 'loaded' | 'in-the-hole';

export function bandGroupFor(band: ReadinessBand): BandGroup {
  switch (band) {
    case 'fresh':
    case 'steady':
      return 'green';
    case 'recovering':
      return 'recovering';
    case 'rusty':
      return 'rusty';
    case 'loaded':
      return 'loaded';
    case 'in-the-hole':
      return 'in-the-hole';
    default:
      return 'green'; // insufficient-data — unreachable (matcher short-circuits first)
  }
}

/**
 * How a live `ReadinessSummary` is matched to an archetype. The `bandGroup` is
 * the hard filter; the `centroid` (the three family deltas normalized by their
 * caps) only ORDERS survivors; `regime` is a soft tiebreak; `requiresSignal`
 * hard-excludes the archetype unless that signal is actually present live.
 */
export interface ScenarioSignature {
  bandGroup: BandGroup;
  /** Normalized family-delta centroid: load/40, perf/45, subj/15 (the stats-regime caps). */
  centroid: { load: number; perf: number; subj: number };
  /** Soft tiebreak — a small distance penalty when the live regime differs. */
  regime?: ReadinessRegime;
  /** Hard filter — only a candidate when `summary.signals` carries this key. */
  requiresSignal?: string;
}

export interface CuratedScenario {
  /** Stable key (often mirrors a catalog fixture id). */
  id: string;
  group: ScenarioGroup;
  /** Plain-language heading. */
  title: string;
  /** One-sentence plain explanation — no jargon. */
  plain: string;
  /** The single lesson the archetype carries. */
  teaches: string;
  /** Browsable in the library but never offered as a live "you're closest to…" match. */
  libraryOnly?: boolean;
  match: ScenarioSignature;
}

/**
 * The curated 9. Live-matchable ones carry medium/high-confidence signatures; the
 * two `libraryOnly` recovery archetypes read low-confidence in practice (nothing
 * to reconstruct), so they teach only through the browsable library.
 */
export const CURATED_SCENARIOS: readonly CuratedScenario[] = [
  // --- healthy / your normal ---
  {
    id: 'evening-hobbyist-calm',
    group: 'healthy',
    title: 'The steady hobbyist',
    plain: 'A few games most evenings with the odd rest day — calm and consistent.',
    teaches: 'A regular, rested rhythm is the healthy baseline: nothing to fix.',
    match: { bandGroup: 'green', regime: 'manual', centroid: { load: -0.03, perf: 0, subj: 0 } },
  },
  {
    id: 'measured-grind-green',
    group: 'healthy',
    title: 'The measured grinder',
    plain: 'Ten games a day, day after day — and the live stats show it isn’t dragging your play.',
    teaches: 'Habit isn’t risk: when your results can be measured, a heavy routine that isn’t hurting your numbers costs nothing.',
    match: { bandGroup: 'green', regime: 'stats', centroid: { load: 0, perf: 0, subj: 0 } },
  },

  // --- rest, recovery & undertraining (library-only: these read low-confidence live) ---
  {
    id: 'rest-day-3-supercompensation-peak',
    group: 'recovery',
    title: 'The supercompensation peak',
    plain: 'After a hard stretch, three full days off — and you come back sharper than before.',
    teaches: 'Rest doesn’t just undo fatigue; a few days off can lift you above your old baseline. This is the top of that curve.',
    libraryOnly: true,
    match: { bandGroup: 'green', regime: 'manual', centroid: { load: 0.625, perf: 0, subj: 0 } },
  },
  {
    id: 'eight-day-layoff-rust',
    group: 'recovery',
    title: 'The long layoff',
    plain: 'Eight days without a game — fully rested, but a little rusty.',
    teaches: 'Past a few days, more rest stops helping and sharpness fades. A long break reads dull, never wrecked.',
    libraryOnly: true,
    match: { bandGroup: 'rusty', regime: 'manual', centroid: { load: -0.875, perf: 0, subj: 0 } },
  },

  // --- overload → amber → red ---
  {
    id: 'grind-all-manual',
    group: 'overload',
    title: 'The unmeasured grind',
    plain: 'Ten games a day with no rest — and no live stats, so the app can only see the exposure.',
    teaches: 'When results can’t be measured, sheer volume without rest becomes the evidence — one warning sign, so it stops at amber.',
    match: { bandGroup: 'loaded', regime: 'manual', centroid: { load: -0.4, perf: 0, subj: 0 } },
  },
  {
    id: 'grind-wr-slump-red',
    group: 'overload',
    title: 'Grinding through a slump',
    plain: 'A hard grind AND a real dip in your wins — two warning signs at once.',
    teaches: 'It takes two independent signs — heavy load and a genuine results dip — to reach the red “in the hole”.',
    match: { bandGroup: 'in-the-hole', regime: 'manual', centroid: { load: -0.525, perf: -0.556, subj: 0 } },
  },
  {
    id: 'grind-tilt-slider-red',
    group: 'overload',
    title: 'Grinding while tilted',
    plain: 'Your results are fine, but you’re grinding, tilted, and rating your own play far below usual.',
    teaches: 'Red doesn’t need bad results — heavy load plus clearly elevated tilt is enough on its own.',
    match: { bandGroup: 'in-the-hole', regime: 'manual', centroid: { load: -0.525, perf: 0, subj: -1.56 } },
  },

  // --- guardrails ---
  {
    id: 'all-loss-week-outcome-cap',
    group: 'guardrail',
    title: 'A brutal losing week',
    plain: 'A week of losses with your stats holding steady — the score dips, but only so far.',
    teaches: 'Losing alone is capped: you can play your best and lose a pile of coin flips, so results never sink the score by themselves.',
    match: { bandGroup: 'loaded', regime: 'stats', centroid: { load: 0, perf: -0.333, subj: 0 } },
  },
  {
    id: 'grind-wr-slump-dampened',
    group: 'guardrail',
    title: 'Worse because you’re practising',
    plain: 'The same slump — but you’re deliberately hitting your improvement targets.',
    teaches: 'Practising something new makes you temporarily worse on purpose, so a dip is softened while you’re on target.',
    match: { bandGroup: 'loaded', regime: 'manual', centroid: { load: -0.525, perf: -0.278, subj: 0 }, requiresSignal: 'target-focus' },
  },
] as const;
