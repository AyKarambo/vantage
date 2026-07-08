/**
 * Readiness & training-load coach — public API.
 *
 * `computeReadiness(games, now?, ctx?)` turns a player's whole match history,
 * their self-reported mental flags, and their active improvement targets into a
 * single, honest readiness verdict: a composite score, a band derived from it,
 * the three subscore pulls, the top contributing signals, a rest
 * recommendation, and a trend for the chart. It is a heuristic wellness nudge,
 * NOT a diagnosis (see the spec's evidence base). Pure and provably total —
 * degenerate inputs never throw.
 */

import type { GameRecord } from '../analytics';
import { READINESS_TUNING as T, DEFAULT_READINESS, normalizeReadiness } from './constants';
import { dayOrdinal, ordinalToKey } from './day';
import { gamesByDay } from './sessions';
import { bandForState, computeStateAt, scoreAt, scoreFromState, type StateAt } from './score';
import { EMPTY_CONTEXT, type ReadinessContext } from './performance';
import type {
  ReadinessBand,
  ReadinessConfidence,
  ReadinessDriver,
  ReadinessLoad,
  ReadinessRecommendation,
  ReadinessSignal,
  ReadinessSubscores,
  ReadinessSummary,
  ReadinessTrendPoint,
} from './types';

export type {
  ReadinessBand,
  ReadinessConfidence,
  ReadinessDriver,
  ReadinessLoad,
  ReadinessRecommendation,
  ReadinessRegime,
  ReadinessSignal,
  ReadinessSettings,
  ReadinessSubscore,
  ReadinessSubscores,
  ReadinessSummary,
  ReadinessTrendPoint,
} from './types';
export { DEFAULT_READINESS, normalizeReadiness, READINESS_TUNING } from './constants';
export { detectSessions } from './sessions';
export { localDayKey, dayOrdinal } from './day';
export { EMPTY_CONTEXT } from './performance';
export type { ReadinessContext } from './performance';
// Readiness help wiki (readiness-help-docs) — curated scenario library, the
// nearest-scenario matcher, and the personalized score walkthrough. Pure data +
// derivations over ReadinessSummary; none of this touches the compute engine.
export { CURATED_SCENARIOS, bandGroupFor } from './scenarios';
export type { CuratedScenario, ScenarioGroup, ScenarioSignature, BandGroup } from './scenarios';
export { matchScenarios } from './nearestScenario';
export type { ScenarioMatch, ScenarioMatchResult } from './nearestScenario';
export { deriveWalkthrough } from './walkthrough';
export type { WalkthroughDerivation, FamilyPull, PullFamily, PullDirection } from './walkthrough';

function pct(frac: number): string {
  return `${Math.round(frac * 100)}%`;
}

function emptyLoad(restDays = 0): ReadinessLoad {
  return {
    acutePerDay: 0,
    chronicPerDay: 0,
    ratio: 1,
    consecutiveDays: 0,
    activeDaysPerWeek: 0,
    restDays,
    lastSessionGames: 0,
    lastSessionMinutes: null,
  };
}

function emptySubscores(): ReadinessSubscores {
  return {
    load: { delta: 0, available: false },
    performance: { delta: 0, available: false, coverage: 0 },
    subjective: { delta: 0, available: false, coverage: 0 },
  };
}

function toLoad(state: StateAt): ReadinessLoad {
  return {
    acutePerDay: state.load.acutePerDay,
    chronicPerDay: state.load.chronicPerDay,
    ratio: state.load.ratio,
    consecutiveDays: state.load.consecutiveDays,
    activeDaysPerWeek: state.load.activeDaysPerWeek,
    restDays: state.restDays,
    lastSessionGames: state.load.lastSessionGames,
    lastSessionMinutes: state.load.lastSessionMinutes,
  };
}

function toSubscores(state: StateAt): ReadinessSubscores {
  return {
    load: { delta: round1(state.deltas.load), available: true, coverage: round2(state.blend) },
    performance: { delta: round1(state.deltas.perf), available: state.perf.available, coverage: round2(state.perf.statCoverage) },
    subjective: { delta: round1(state.deltas.subj), available: state.subj.available, coverage: state.mental.coverage },
  };
}

const round1 = (n: number): number => Math.round(n * 10) / 10;
const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Confidence now reflects the coverage of the OBJECTIVE inputs first — a
 * stats-rich GEP history reaches high confidence without any mental logging;
 * a heavily account-mixed acute window caps it at medium.
 */
function confidenceFor(state: StateAt): ReadinessConfidence {
  const statCoverage = state.perf.statCoverage;
  const high =
    state.load.chronicActiveDays >= T.confidenceActiveDays &&
    statCoverage >= T.statCoverageHigh &&
    state.perf.wrDip !== null &&
    state.perf.maxAccountShare >= T.accountMixBar;
  // Manual regime caps confidence at medium, whatever the mental-log coverage — high confidence is
  // something only live match stats can buy. Structurally redundant today ('high' already requires
  // statCoverage ≥ statCoverageHigh ⇒ b = 1, never 'manual'), but a pinned invariant that survives any
  // future confidence retuning where wr-sample adequacy alone might otherwise lift a stats-free read.
  if (high && state.regime !== 'manual') {
    return 'high';
  }
  if (statCoverage < T.statCoverageLow && state.mental.coverage < T.mentalMinCoverage && state.subj.sliderDiff === null) {
    return 'low';
  }
  return 'medium';
}

interface Advice {
  recommendation: ReadinessRecommendation;
  recommendationText: string;
  headline: string;
}

function adviceFor(band: ReadinessBand, state: StateAt): Advice {
  switch (band) {
    case 'in-the-hole':
      return {
        recommendation: 'rest-1-2-days',
        recommendationText:
          'Take 1–2 full days off. Your load is high and your results are trending below your own baseline — rest should let your form rebound.',
        headline: "You're grinding into the hole.",
      };
    case 'loaded':
      return {
        recommendation: 'ease-up',
        recommendationText: 'Heavy load. A lighter session or a day off soon keeps you out of the hole.',
        headline: "You're carrying a heavy load.",
      };
    case 'recovering':
      return { recommendation: 'none', recommendationText: '', headline: "You've rested — readiness is rebuilding." };
    case 'rusty':
      return {
        recommendation: 'ramp-back-up',
        recommendationText:
          'Ease back in: an aim warmup and a couple of unranked games before you queue ranked. Short, regular sessions rebuild sharpness faster than one big comeback grind.',
        headline: `${state.restDays} days since your last game — expect some rust.`,
      };
    case 'fresh':
      return {
        recommendation: 'none',
        recommendationText: '',
        headline: state.heavy && state.restDays >= T.restFullRecoverDays ? 'Recovered — back to fresh.' : "You're fresh — good to go.",
      };
    case 'steady':
      return { recommendation: 'none', recommendationText: '', headline: 'Steady — nothing flagged.' };
    default:
      return { recommendation: 'none', recommendationText: '', headline: 'Keep logging to unlock readiness.' };
  }
}

const SEVERITY_RANK: Record<ReadinessSignal['severity'], number> = { high: 0, watch: 1, ok: 2 };

/** Human-readable direction words for the decline signal, from mean aligned z per metric. */
function declineLabel(state: StateAt): string {
  const names: Record<string, [string, string]> = {
    deaths: ['deaths up', 'deaths down'],
    damage: ['damage down', 'damage up'],
    eliminations: ['elims down', 'elims up'],
    healing: ['healing down', 'healing up'],
  };
  const parts = Object.entries(state.perf.metricMeans)
    .filter(([, mean]) => (mean as number) <= -0.3)
    .sort((a, b) => (a[1] as number) - (b[1] as number))
    .slice(0, 2)
    .map(([m]) => names[m][0]);
  const what = parts.length ? parts.join(', ') : 'output below your usual';
  return `${what} vs your own baseline — sustained across your recent games`;
}

function buildSignals(state: StateAt): ReadinessSignal[] {
  const { load, mental, outcome, perf, subj } = state;
  const out: ReadinessSignal[] = [];

  // Load/performance state is evaluated as-of the last active day. Once the
  // layoff has passed the rust threshold that state has long been rested off —
  // surfacing "22 days in a row" under a Rusty verdict would read as its opposite.
  const loadCurrent = state.restDays < T.rustDays;

  if (loadCurrent && load.consecutiveDays >= T.loadedDays) {
    out.push({
      key: 'consecutive-days',
      label: `${load.consecutiveDays} days in a row without a rest day`,
      severity: load.consecutiveDays >= T.sustainedDays ? 'high' : 'watch',
    });
  }
  if (loadCurrent && load.acutePerDay >= T.absElevatedPerDay) {
    out.push({
      key: 'games-per-day',
      label: `${load.acutePerDay} games/day recently`,
      severity: load.acutePerDay >= T.absHighPerDay ? 'high' : 'watch',
    });
  }
  if (loadCurrent && load.ratioTrusted && load.ratio >= T.ratioElevated) {
    out.push({
      key: 'load-ratio',
      label: `recent load ${load.ratio.toFixed(2)}× your baseline`,
      severity: load.ratio >= T.ratioHigh ? 'high' : 'watch',
    });
  }
  if (loadCurrent && load.recentLongSession) {
    out.push({ key: 'long-session', label: 'a session over 2.5h recently', severity: 'watch' });
  }

  // Objective performance vs the player's own baselines (the new primary family).
  if (loadCurrent && perf.declineFired) {
    out.push({ key: 'perf-decline', label: declineLabel(state), severity: 'high' });
  }
  if (loadCurrent && perf.wrPenalty > 0 && perf.wrDip !== null) {
    out.push({
      key: 'winrate-dip',
      label: `winrate ${Math.round(perf.wrDip * 100)} points below your usual recently`,
      severity: 'watch',
    });
  }
  if (loadCurrent && perf.dampened && perf.statPenalty + perf.wrPenalty > 0) {
    out.push({
      key: 'target-focus',
      label: "dip softened — you're hitting your active improvement targets",
      severity: 'ok',
    });
  }
  if (loadCurrent && perf.stillLearning.length > 0) {
    out.push({
      key: 'still-learning',
      label: `still learning ${perf.stillLearning.slice(0, 3).join(', ')} — early games there don't count against you`,
      severity: 'ok',
    });
  }
  if (loadCurrent && perf.maxAccountShare < T.accountMixBar) {
    out.push({
      key: 'mixed-accounts',
      label: 'recent games span multiple accounts — the read is less precise',
      severity: 'ok',
    });
  }

  if (mental.coverage < T.mentalMinCoverage) {
    out.push({ key: 'low-coverage', label: 'log your mental state to sharpen this read', severity: 'ok' });
  } else if (loadCurrent && mental.fatigued) {
    out.push({ key: 'tilt', label: `tilt on ${pct(mental.acuteTilt)} of your recent logged games`, severity: 'high' });
  }
  if (loadCurrent && subj.sliderPen > 0 && subj.sliderDiff !== null) {
    out.push({
      key: 'slider-low',
      label: `you've rated your own play ~${Math.round(subj.sliderDiff)} points below your usual`,
      severity: 'watch',
    });
  }

  // Outcomes are a weak, corroborating signal — capped at 'watch' so a losing
  // streak never renders a red-tier alarm while the band is green/amber.
  if (loadCurrent && outcome.lossStreak >= 3) {
    out.push({ key: 'loss-streak', label: `${outcome.lossStreak} losses in a row (recent results)`, severity: 'watch' });
  }

  // Undertraining — the inverse risk. A long gap decays sharpness; a thin weekly
  // rhythm is not enough stimulus to actually improve. Never fired together: the
  // gap signal owns the layoff case, the frequency nudge the "plays rarely" case.
  // The frequency nudge additionally requires PROVEN rank stagnation (spec §7b):
  // with no rank evidence, or while any account is climbing, it stays silent —
  // the app never encourages volume for its own sake.
  if (state.restDays >= T.rustDays) {
    out.push({
      key: 'rust-gap',
      label: `${state.restDays} days since your last game — sharpness decays after ~4`,
      severity: state.restDays >= T.rustSevereDays ? 'high' : 'watch',
    });
  } else if (
    state.rankTrend === 'stagnant' &&
    load.chronicActiveDays > 0 &&
    load.activeDaysPerWeek < T.lowFrequencyDaysPerWeek
  ) {
    // One decimal, not Math.round — rounding 2.7 up to the threshold value (3)
    // would flag the exact frequency the tuning calls sufficient.
    const rate = load.activeDaysPerWeek.toFixed(1).replace(/\.0$/, '');
    out.push({
      key: 'low-frequency',
      label: `ranks not climbing over ~2 weeks at only ~${rate} active day${rate === '1' ? '' : 's'}/week — a bit more regular practice may be the missing stimulus`,
      severity: load.activeDaysPerWeek < T.lowFrequencyWatchPerWeek ? 'watch' : 'ok',
    });
  }

  return out.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]).slice(0, 5);
}

function buildTrend(games: GameRecord[], nowOrdinal: number, ctx: ReadinessContext): ReadinessTrendPoint[] {
  const byDay = gamesByDay(games);
  const points: ReadinessTrendPoint[] = [];
  for (let d = nowOrdinal - T.trendDays + 1; d <= nowOrdinal; d += 1) {
    // ctx passes through verbatim: perfState filters targets by createdAt ≤ each
    // day's ordinal, and grade evidence only exists on games ≤ that day — so the
    // dampener never applies to trend days before the target/grades existed.
    points.push({ date: ordinalToKey(d), score: scoreAt(games, d, ctx), games: byDay.get(d) ?? 0 });
  }
  return points;
}

function insufficientSummary(headline: string, trend: ReadinessTrendPoint[]): ReadinessSummary {
  return {
    band: 'insufficient-data',
    score: null,
    confidence: 'low',
    headline,
    recommendation: 'none',
    recommendationText: '',
    signals: [],
    load: emptyLoad(),
    subscores: emptySubscores(),
    driver: 'neutral',
    regime: 'manual',
    trend,
  };
}

// A long-stale history used to read as "fresh — rested", which hid the real
// story: rest past the recovery window is detraining. The verdict is honest
// about the rust while the load numbers stay empty (a weeks-old baseline says
// nothing about today's fitness).
function staleSummary(restDays: number, trend: ReadinessTrendPoint[]): ReadinessSummary {
  return {
    band: 'rusty',
    score: null,
    confidence: 'low',
    headline: `No games in ${restDays} days — fully rested, but expect rust.`,
    recommendation: 'ramp-back-up',
    recommendationText:
      'Ease back in: an aim warmup and a couple of unranked games before you queue ranked. Short, regular sessions rebuild sharpness faster than one big comeback grind.',
    signals: [
      { key: 'rust-gap', label: `${restDays} days since your last game — sharpness decays after ~4`, severity: 'high' },
    ],
    load: emptyLoad(restDays),
    subscores: emptySubscores(),
    driver: 'rust',
    regime: 'manual',
    trend,
  };
}

/**
 * Compute a player's readiness verdict from their whole history. `now` is
 * injectable for tests; `ctx` carries the improvement targets the dampener
 * needs (not derivable from `GameRecord` alone).
 */
export function computeReadiness(
  input: GameRecord[],
  now: number = Date.now(),
  ctx: ReadinessContext = EMPTY_CONTEXT,
): ReadinessSummary {
  // Input cleaning: drop future-stamped games, de-dupe by matchId, sort ascending.
  const seen = new Set<string>();
  const games = input
    .filter((g) => typeof g.timestamp === 'number' && g.timestamp <= now)
    .filter((g) => {
      if (seen.has(g.matchId)) return false;
      seen.add(g.matchId);
      return true;
    })
    .sort((a, b) => a.timestamp - b.timestamp);

  const nowOrdinal = dayOrdinal(now);
  if (games.length === 0) return insufficientSummary('Log a few games to unlock readiness.', []);

  const trend = buildTrend(games, nowOrdinal, ctx);
  const firstOrdinal = dayOrdinal(games[0].timestamp);
  const lastOrdinal = dayOrdinal(games[games.length - 1].timestamp);
  const spanDays = lastOrdinal - firstOrdinal;
  const restDaysNow = Math.max(0, nowOrdinal - lastOrdinal);

  if (spanDays < T.minSpanDays || games.length < T.minGames) {
    return insufficientSummary('Keep logging games (and your mental state) to unlock readiness.', trend);
  }
  if (restDaysNow >= T.staleDays) {
    return staleSummary(restDaysNow, trend);
  }

  const state = computeStateAt(games, nowOrdinal, ctx);
  const band = bandForState(state);
  const advice = adviceFor(band, state);

  return {
    band,
    score: scoreFromState(state),
    confidence: confidenceFor(state),
    headline: advice.headline,
    recommendation: advice.recommendation,
    recommendationText: advice.recommendationText,
    signals: buildSignals(state),
    load: toLoad(state),
    subscores: toSubscores(state),
    driver: state.driver,
    regime: state.regime,
    trend,
  };
}

/** Alias mirroring the `mentalSummary`/`sessionRecap` naming used elsewhere. */
export const readinessSummary = computeReadiness;

/** Defensive wrapper for edge callers (dashboard read-model, launch toast) — never throws. */
export function safeReadiness(
  input: GameRecord[],
  now: number = Date.now(),
  ctx: ReadinessContext = EMPTY_CONTEXT,
): ReadinessSummary {
  try {
    return computeReadiness(input, now, ctx);
  } catch {
    return insufficientSummary('Readiness unavailable.', []);
  }
}
