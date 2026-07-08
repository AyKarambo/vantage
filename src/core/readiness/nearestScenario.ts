/**
 * Nearest-scenario matcher — maps a live `ReadinessSummary` to the curated
 * archetype(s) it most resembles ("you're closest to…"), for the personalized
 * wiki article and the scenario library's highlight.
 *
 * Pure and deterministic: same summary in → same result out. It is honest about
 * uncertainty — when there is nothing to reconstruct or compare on (null score,
 * insufficient data, or low confidence, where the crisp score is hidden anyway),
 * it returns `null` rather than guessing. "Feature disabled" is NOT expressed
 * here — a `ReadinessSummary` cannot carry it; the renderer gates that upstream.
 */

import { READINESS_TUNING as T } from './constants';
import type { ReadinessSummary } from './types';
import { CURATED_SCENARIOS, bandGroupFor, type CuratedScenario } from './scenarios';

export interface ScenarioMatch {
  id: string;
  distance: number;
  scenario: CuratedScenario;
}

export interface ScenarioMatchResult {
  primary: ScenarioMatch;
  /** 1–2 next-closest archetypes ("you're also near…"). */
  alternates: ScenarioMatch[];
}

/** Small additive distance penalty when a candidate's regime differs from the live read. */
const REGIME_PENALTY = 0.25;

/**
 * Normalize each family delta by its stats-regime cap magnitude so the three axes
 * are comparable. Divisors are derived from READINESS_TUNING (40/45/15 today); the
 * curated `centroid` values in scenarios.ts are authored on this SAME normalized
 * scale, and the golden matcher test pins the resulting primary — so a retune of
 * the caps can't silently drift the two apart.
 */
function normalized(summary: ReadinessSummary): { load: number; perf: number; subj: number } {
  return {
    load: summary.subscores.load.delta / -T.loadDeltaMin,
    perf: summary.subscores.performance.delta / -T.perfDeltaMin,
    subj: summary.subscores.subjective.delta / -T.subjDeltaMin,
  };
}

function distanceTo(scenario: CuratedScenario, point: { load: number; perf: number; subj: number }, regime: ReadinessSummary['regime']): number {
  const c = scenario.match.centroid;
  const d = Math.hypot(point.load - c.load, point.perf - c.perf, point.subj - c.subj);
  return d + (scenario.match.regime && scenario.match.regime !== regime ? REGIME_PENALTY : 0);
}

/**
 * Rank the curated archetypes against a live read. Returns `null` on
 * data-suppressed states (no honest deltas to match on), else the closest
 * archetype plus 1–2 alternates.
 */
export function matchScenarios(summary: ReadinessSummary): ScenarioMatchResult | null {
  // Data-driven suppression — mirrors the view's own `showScore` gate: a hidden
  // or absent score means there is nothing to reconstruct or match honestly.
  if (summary.score === null || summary.band === 'insufficient-data' || summary.confidence === 'low') {
    return null;
  }

  const point = normalized(summary);
  const signalKeys = new Set(summary.signals.map((s) => s.key));
  const pool = CURATED_SCENARIOS.filter((s) => !s.libraryOnly)
    .filter((s) => !s.match.requiresSignal || signalKeys.has(s.match.requiresSignal));

  const bandGroup = bandGroupFor(summary.band);
  const inBand = pool
    .filter((s) => s.match.bandGroup === bandGroup)
    .map((scenario) => ({ id: scenario.id, scenario, distance: distanceTo(scenario, point, summary.regime) }))
    .sort((a, b) => a.distance - b.distance);

  // No archetype in the SAME qualitative state → nothing honest to compare
  // against, so personalization stays OFF (return null) rather than cross-matching
  // to an opposite-state story. The curated set covers every matchable band-group
  // (green/loaded/in-the-hole) with ≥2 archetypes, so a matched read always yields
  // a primary + 1–2 alternates; a live 'recovering'/'rusty' read (no matchable
  // archetype) suppresses here, exactly like the confidence gate above.
  if (inBand.length === 0) return null;

  const [primary, ...rest] = inBand;
  return { primary, alternates: rest.slice(0, 2) };
}
