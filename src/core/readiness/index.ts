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
import { EMPTY_CONTEXT, mainAccountOf, type ReadinessContext } from './performance';
import type {
  ReadinessBand,
  ReadinessConfidence,
  ReadinessConfidenceGate,
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
  ReadinessConfidenceGate,
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

/** A gate label's share of the player's own numbers: an unmet one never rounds up to its own bar ("50% (needs 50%)"). */
function gatePct(have: number, need: number): string {
  const rounded = Math.round(have * 100);
  return have >= need ? `${rounded}%` : `${Math.min(rounded, Math.round(need * 100) - 1)}%`;
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

// The surfaced load numbers describe the last active day (their documented meaning — e.g.
// consecutiveDays "ending at the last active day"); rest days are reported by restDays.
function toLoad(state: StateAt): ReadinessLoad {
  const load = state.last.load;
  return {
    acutePerDay: load.acutePerDay,
    chronicPerDay: load.chronicPerDay,
    ratio: load.ratio,
    consecutiveDays: load.consecutiveDays,
    activeDaysPerWeek: load.activeDaysPerWeek,
    restDays: state.restDays,
    lastSessionGames: load.lastSessionGames,
    lastSessionMinutes: load.lastSessionMinutes,
  };
}

function toSubscores(state: StateAt): ReadinessSubscores {
  return {
    load: { delta: round1(state.deltas.load), available: true, coverage: round2(state.blend) },
    // Coverage is data quality, read from the same last-active-day frame as the confidence gates,
    // so the subscore tiles and the confidence line never show two different numbers.
    performance: { delta: round1(state.deltas.perf), available: state.perf.available, coverage: round2(state.last.perf.statCoverage) },
    subjective: { delta: round1(state.deltas.subj), available: state.subj.available, coverage: state.last.mental.coverage },
  };
}

const round1 = (n: number): number => Math.round(n * 10) / 10;
const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * The four conditions `'high'` confidence needs, each with the player's own numbers —
 * the single source of truth for both the confidence tier and the readiness screen's
 * "why not high" explanation. Everything reads the LAST ACTIVE day's frame (the session
 * the read rests on) and only the recent 7/21-day windows: total history size never
 * enters, so a big history alone does not raise confidence.
 *
 * The comparable-games gate also carries the manual-regime cap — high confidence is
 * something only live match stats can buy, whatever the mental-log coverage. Structurally
 * redundant today (statCoverage ≥ statCoverageHigh ⇒ b = 1, never 'manual'), but a pinned
 * invariant that survives any future retuning where the other gates alone might lift a
 * stats-free read. The account-mix gate reads the rank-weighted `mainShare`, so a second
 * account at the main's own level never counts as "mixed".
 */
function confidenceGatesFor(state: StateAt): ReadinessConfidenceGate[] {
  const { last } = state;
  const activeDays = last.load.chronicActiveDays;
  const coverage = last.perf.statCoverage;
  const mainShare = last.perf.mainShare;
  const wrSample = last.perf.wrDip !== null;
  return [
    {
      key: 'active-days',
      met: activeDays >= T.confidenceActiveDays,
      label: `played on ${activeDays} of the last ${T.chronicDays} days (needs ${T.confidenceActiveDays})`,
    },
    {
      key: 'comparable-games',
      met: coverage >= T.statCoverageHigh && state.regime !== 'manual',
      label: `${gatePct(coverage, T.statCoverageHigh)} of your recent games have comparable live stats (needs ${pct(T.statCoverageHigh)})`,
    },
    {
      key: 'winrate-sample',
      met: wrSample,
      label: wrSample
        ? 'enough decided games on one account to compare your winrate'
        : `not enough decided games on one account to compare your winrate (needs ${T.wrMinDecidedAcute} this week and ${T.wrMinDecidedBase} in the two weeks before)`,
    },
    {
      key: 'account-mix',
      met: mainShare >= T.accountMixBar,
      label: `${gatePct(mainShare, T.accountMixBar)} of this week's read comes from your main account (needs ${pct(T.accountMixBar)})`,
    },
  ];
}

/**
 * Confidence reflects the data quality of the OBJECTIVE inputs first — a stats-rich GEP
 * history reaches high confidence without any mental logging; any unmet gate caps it at
 * medium. `'low'` is the thin-data floor: almost no comparable stats and no self-report to
 * lean on.
 */
function confidenceFor(state: StateAt, gates: ReadinessConfidenceGate[]): ReadinessConfidence {
  if (gates.every((g) => g.met)) return 'high';
  // Data quality describes the session the read rests on: the last active day's frame.
  const { last } = state;
  if (last.perf.statCoverage < T.statCoverageLow && last.mental.coverage < T.mentalMinCoverage && last.subj.sliderDiff === null) {
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
          'Ease back in: an aim warmup and a couple of unranked games before you play ranked. Short, regular sessions rebuild sharpness faster than one big comeback grind.',
        headline: `${state.restDays} days since your last game — expect some rust.`,
      };
    case 'fresh': {
      const base = state.heavy && state.restDays >= T.restFullRecoverDays ? 'Recovered — back to fresh.' : "You're fresh — good to go.";
      // A genuinely fired load streak (C8) can still coexist with a green
      // band — the other families offset it. Say so instead of a flat "good
      // to go" beside a 'high' signal that reads as its opposite.
      if (!state.streakFired) return { recommendation: 'none', recommendationText: '', headline: base };
      return {
        recommendation: 'ease-up',
        recommendationText: `You're fresh today, but ${state.load.consecutiveDays} days in a row without a rest day recently is worth breaking up before it catches up with you.`,
        headline: `${base} Still, ${state.load.consecutiveDays} days without a rest day is worth a break.`,
      };
    }
    case 'steady':
      if (!state.streakFired) return { recommendation: 'none', recommendationText: '', headline: 'Steady — nothing flagged.' };
      return {
        recommendation: 'ease-up',
        recommendationText: `Results are holding, but you've played ${state.load.consecutiveDays} days in a row without a rest day — a day off soon keeps it that way.`,
        headline: `Steady — results are holding, but ${state.load.consecutiveDays} days without a rest day is worth a break.`,
      };
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

/** The mirror of {@link declineLabel}: which metrics carry a form above the player's own baseline. */
function goodFormLabel(state: StateAt): string {
  const names: Record<string, string> = {
    deaths: 'deaths down',
    damage: 'damage up',
    eliminations: 'elims up',
    healing: 'healing up',
  };
  const parts = Object.entries(state.perf.metricMeans)
    .filter(([, mean]) => (mean as number) >= 0.3)
    .sort((a, b) => (b[1] as number) - (a[1] as number))
    .slice(0, 2)
    .map(([m]) => names[m]);
  const what = parts.length ? ` — ${parts.join(', ')}` : '';
  return `playing above your own recent baseline${what}`;
}

/** Hours to one decimal ('5.0h') — the long-session signal names both the session and the bar it crossed. */
const hoursLabel = (minutes: number): string => `${(minutes / 60).toFixed(1)}h`;

function longSessionLabel(ls: { minutes: number; threshold: number }): string {
  return ls.threshold > T.sessionLongMinutes
    ? `a ${hoursLabel(ls.minutes)} session — longer than ${Math.round(T.longSessionPercentile * 10)} in 10 of your sessions (~${hoursLabel(ls.threshold)})`
    : `a ${hoursLabel(ls.minutes)} session — over ${hoursLabel(T.sessionLongMinutes)}`;
}

function buildSignals(state: StateAt): ReadinessSignal[] {
  const { load, mental, outcome, perf, subj } = state;
  const out: ReadinessSignal[] = [];

  // Load/performance state is evaluated as-of the last active day. Once the
  // layoff has passed the rust threshold that state has long been rested off —
  // surfacing "22 days in a row" under a Rusty verdict would read as its opposite.
  const loadCurrent = state.restDays < T.rustDays;

  if (loadCurrent && load.consecutiveDays >= T.loadedDays) {
    // 'high' reads off whether the streak actually cost the score anything
    // (C8) — `load.consecutiveDays >= T.sustainedDays` alone let a long but
    // CALM streak (no volume/ratio surge, so the score's own streak penalty
    // never fires) render as a red-severity alarm next to a green verdict.
    out.push(state.streakFired
      ? { key: 'consecutive-days', label: `${load.consecutiveDays} days in a row without a rest day`, severity: 'high' }
      : { key: 'consecutive-days', label: `${load.consecutiveDays} days in a row — a calm habit, but a rest day still helps`, severity: 'watch' });
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
  if (loadCurrent && load.longSession && load.longSession.severity > 0) {
    out.push({ key: 'long-session', label: longSessionLabel(load.longSession), severity: 'watch' });
  }

  // Objective performance vs the player's own baselines (the new primary family).
  if (loadCurrent && perf.declineFired) {
    out.push({ key: 'perf-decline', label: declineLabel(state), severity: 'high' });
  }
  // A significant dip is always named; whether it costs points depends on whether the player's
  // own stats back it up (see the corroboration note in performance.ts), and the label says which.
  if (loadCurrent && perf.wrSignificant && perf.wrDip !== null) {
    const points = Math.round(perf.wrDip * 100);
    out.push({
      key: 'winrate-dip',
      label: perf.wrPenalty > 0
        ? `winrate ${points} points below your usual recently`
        : `winrate ${points} points below your usual recently — your stats are holding, so it doesn't count against you`,
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
  // Pushed after target-focus on purpose: both are 'ok' notes and the list keeps
  // only the top five, so the newer note must never displace the dampener's.
  if (loadCurrent && perf.bonus > 0) {
    out.push({ key: 'good-form', label: goodFormLabel(state), severity: 'ok' });
  }
  if (loadCurrent && perf.stillLearning.length > 0) {
    out.push({
      key: 'still-learning',
      label: `still learning ${perf.stillLearning.slice(0, 3).join(', ')} — early games there don't count against you`,
      severity: 'ok',
    });
  }
  // Several accounts, one player. Both notes are gated on there being a real main account AND
  // real alt games in the window, so neither can claim a weighting that was not applied (with
  // altShare 0 the damper is exactly 1). A materially MIXED window — main-account share below the
  // bar — gets the confidence-lowering note; otherwise a quieter one names the main account. Read
  // off the session the read rests on and the rank-weighted share the confidence gate uses (see
  // `confidenceGatesFor`), so the note and the gate can never disagree.
  const { mainAccount: main, altShare, mainShare } = state.last.perf;
  const weighted = loadCurrent && main !== null && altShare > 0;
  if (loadCurrent && mainShare < T.accountMixBar) {
    out.push({
      key: 'mixed-accounts',
      label: weighted
        ? `recent games span multiple accounts — ${main} carries the read, the rest count for less`
        : 'recent games span multiple accounts — the read is less precise',
      severity: 'ok',
    });
  } else if (weighted) {
    out.push({
      key: 'alt-weighted',
      label: `${main} is your main account — games on your other accounts move this read less`,
      severity: 'ok',
    });
  }

  // A data-quality note, so it reads the session the read rests on (like confidence).
  if (state.last.mental.coverage < T.mentalMinCoverage) {
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

function insufficientSummary(
  headline: string,
  trend: ReadinessTrendPoint[],
  unlock?: ReadinessSummary['unlock'],
  mainAccount: string | null = null,
): ReadinessSummary {
  return {
    band: 'insufficient-data',
    score: null,
    confidence: 'low',
    confidenceGates: [],
    headline,
    recommendation: 'none',
    recommendationText: '',
    signals: [],
    load: emptyLoad(),
    subscores: emptySubscores(),
    driver: 'neutral',
    regime: 'manual',
    trend,
    mainAccount,
    ...(unlock ? { unlock } : {}),
  };
}

// A long-stale history used to read as "fresh — rested", which hid the real
// story: rest past the recovery window is detraining. The verdict is honest
// about the rust while the load numbers stay empty (a weeks-old baseline says
// nothing about today's fitness).
function staleSummary(restDays: number, trend: ReadinessTrendPoint[], mainAccount: string | null): ReadinessSummary {
  return {
    band: 'rusty',
    score: null,
    confidence: 'low',
    confidenceGates: [],
    headline: `No games in ${restDays} days — fully rested, but expect rust.`,
    recommendation: 'ramp-back-up',
    recommendationText:
      'Ease back in: an aim warmup and a couple of unranked games before you play ranked. Short, regular sessions rebuild sharpness faster than one big comeback grind.',
    signals: [
      { key: 'rust-gap', label: `${restDays} days since your last game — sharpness decays after ~4`, severity: 'high' },
    ],
    load: emptyLoad(restDays),
    subscores: emptySubscores(),
    driver: 'rust',
    regime: 'manual',
    trend,
    mainAccount,
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
  if (games.length === 0) {
    return insufficientSummary('Log a few games to unlock readiness.', [],
      { games: 0, minGames: T.minGames, days: 0, minSpanDays: T.minSpanDays });
  }

  // Cheap enough to compute up front, and useful even in every early-return
  // band below (W2) — Settings → Accounts wants to know the main account as
  // soon as one has a real lead, not only once the full score unlocks.
  const mainAccount = mainAccountOf(games);

  const trend = buildTrend(games, nowOrdinal, ctx);
  const firstOrdinal = dayOrdinal(games[0].timestamp);
  const lastOrdinal = dayOrdinal(games[games.length - 1].timestamp);
  const spanDays = lastOrdinal - firstOrdinal;
  const restDaysNow = Math.max(0, nowOrdinal - lastOrdinal);

  if (spanDays < T.minSpanDays || games.length < T.minGames) {
    return insufficientSummary('Keep logging games (and your mental state) to unlock readiness.', trend,
      { games: games.length, minGames: T.minGames, days: spanDays, minSpanDays: T.minSpanDays }, mainAccount);
  }
  if (restDaysNow >= T.staleDays) {
    return staleSummary(restDaysNow, trend, mainAccount);
  }

  const state = computeStateAt(games, nowOrdinal, ctx);
  const band = bandForState(state);
  const advice = adviceFor(band, state);

  const confidenceGates = confidenceGatesFor(state);

  return {
    band,
    score: scoreFromState(state),
    confidence: confidenceFor(state, confidenceGates),
    confidenceGates,
    headline: advice.headline,
    recommendation: advice.recommendation,
    recommendationText: advice.recommendationText,
    signals: buildSignals(state),
    load: toLoad(state),
    subscores: toSubscores(state),
    driver: state.driver,
    regime: state.regime,
    trend,
    mainAccount: state.last.perf.mainAccount,
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
