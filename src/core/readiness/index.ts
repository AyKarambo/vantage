/**
 * Readiness & training-load coach — public API.
 *
 * `computeReadiness(games, now?)` turns a player's whole match history plus their
 * self-reported mental flags into a single, honest readiness verdict: a band, a
 * score, the top contributing signals, a rest recommendation, and a trend for the
 * chart. It is a heuristic wellness nudge, NOT a diagnosis (see the spec's
 * evidence base). Pure and provably total — degenerate inputs never throw.
 */

import type { GameRecord } from '../analytics';
import { READINESS_TUNING as T, DEFAULT_READINESS, normalizeReadiness } from './constants';
import { dayOrdinal, ordinalToKey } from './day';
import { gamesByDay } from './sessions';
import { bandForState, computeStateAt, scoreAt, scoreFromState, type StateAt } from './score';
import type {
  ReadinessBand,
  ReadinessConfidence,
  ReadinessLoad,
  ReadinessRecommendation,
  ReadinessSignal,
  ReadinessSummary,
  ReadinessTrendPoint,
} from './types';

export type {
  ReadinessBand,
  ReadinessConfidence,
  ReadinessLoad,
  ReadinessRecommendation,
  ReadinessSignal,
  ReadinessSettings,
  ReadinessSummary,
  ReadinessTrendPoint,
} from './types';
export { DEFAULT_READINESS, normalizeReadiness, READINESS_TUNING } from './constants';
export { detectSessions } from './sessions';
export { localDayKey, dayOrdinal } from './day';

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

function confidenceFor(state: StateAt): ReadinessConfidence {
  if (state.mental.coverage < T.mentalMinCoverage) return 'low';
  if (state.load.chronicActiveDays >= T.confidenceActiveDays && state.mental.coverage >= T.mentalHighCoverage) {
    return 'high';
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
          'Take 1–2 full days off. Your load is high and your mental signals are trending down — rest should let your form rebound.',
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

function buildSignals(state: StateAt): ReadinessSignal[] {
  const { load, mental, outcome } = state;
  const out: ReadinessSignal[] = [];

  // Load state is evaluated as-of the last active day. Once the layoff has
  // passed the rust threshold that load has long been rested off — surfacing
  // "22 days in a row" under a Rusty verdict would read as its opposite.
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

  if (mental.coverage < T.mentalMinCoverage) {
    out.push({ key: 'low-coverage', label: 'log your mental state to sharpen this read', severity: 'ok' });
  } else if (loadCurrent && mental.fatigued) {
    out.push({ key: 'tilt', label: `tilt on ${pct(mental.acuteTilt)} of your recent logged games`, severity: 'high' });
  }

  // Outcomes are a weak, corroborating signal — capped at 'watch' so a losing
  // streak never renders a red-tier alarm while the band is green/amber.
  if (loadCurrent && outcome.lossStreak >= 3) {
    out.push({ key: 'loss-streak', label: `${outcome.lossStreak} losses in a row (recent results)`, severity: 'watch' });
  }

  // Undertraining — the inverse risk. A long gap decays sharpness; a thin weekly
  // rhythm is not enough stimulus to actually improve. Never fired together: the
  // gap signal owns the layoff case, the frequency nudge the "plays rarely" case.
  if (state.restDays >= T.rustDays) {
    out.push({
      key: 'rust-gap',
      label: `${state.restDays} days since your last game — sharpness decays after ~4`,
      severity: state.restDays >= T.rustSevereDays ? 'high' : 'watch',
    });
  } else if (load.chronicActiveDays > 0 && load.activeDaysPerWeek < T.lowFrequencyDaysPerWeek) {
    // One decimal, not Math.round — rounding 2.7 up to the threshold value (3)
    // would flag the exact frequency the tuning calls sufficient.
    const rate = load.activeDaysPerWeek.toFixed(1).replace(/\.0$/, '');
    out.push({
      key: 'low-frequency',
      label: `only ~${rate} active day${rate === '1' ? '' : 's'}/week — consistency builds skill faster than bingeing`,
      severity: load.activeDaysPerWeek < T.lowFrequencyWatchPerWeek ? 'watch' : 'ok',
    });
  }

  return out.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]).slice(0, 5);
}

function buildTrend(games: GameRecord[], nowOrdinal: number): ReadinessTrendPoint[] {
  const byDay = gamesByDay(games);
  const points: ReadinessTrendPoint[] = [];
  for (let d = nowOrdinal - T.trendDays + 1; d <= nowOrdinal; d += 1) {
    points.push({ date: ordinalToKey(d), score: scoreAt(games, d), games: byDay.get(d) ?? 0 });
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
    trend,
  };
}

/** Compute a player's readiness verdict from their whole history. `now` is injectable for tests. */
export function computeReadiness(input: GameRecord[], now: number = Date.now()): ReadinessSummary {
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

  const trend = buildTrend(games, nowOrdinal);
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

  const state = computeStateAt(games, nowOrdinal);
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
    trend,
  };
}

/** Alias mirroring the `mentalSummary`/`sessionRecap` naming used elsewhere. */
export const readinessSummary = computeReadiness;

/** Defensive wrapper for edge callers (dashboard read-model, launch toast) — never throws. */
export function safeReadiness(input: GameRecord[], now: number = Date.now()): ReadinessSummary {
  try {
    return computeReadiness(input, now);
  } catch {
    return insufficientSummary('Readiness unavailable.', []);
  }
}
