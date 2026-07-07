/**
 * Objective-performance subscore: winrate vs the player's own per-account
 * baseline + per-10 stat decline vs per-hero (fallback per-role) baselines,
 * accumulated by a one-sided CUSUM so only sustained evidence — one long
 * marathon session, or several sessions — ever fires. Includes the
 * target-focus dampener (the deliberate-practice "learning dip" exemption).
 *
 * Anti-false-alarm guarantees (by construction, see constants):
 * - a single winsorized game contributes at most zWinsor − cusumSlack < cusumThreshold;
 * - the decline index needs ≥ evidenceMinGames counted games regardless of C;
 * - buckets below statMinGames are inert; trust ramps in with no cliff;
 * - a hero-mix change never reads as decline (per-hero buckets + mix-overlap guard).
 */

import type { GameRecord, TargetGrade } from '../analytics';
import type { AuthoredTarget } from '../targets/types';
import { NOTION_IMPROVEMENT_TARGET_ID } from '../targets/notionBookkeeping';
import { winLoss } from '../analytics';
import { READINESS_TUNING as T } from './constants';
import { dayOrdinal } from './day';
import {
  baselineFor,
  buildBaselines,
  heroKey,
  heroMixOverlap,
  METRIC_KEYS,
  roleKey,
  type MetricKey,
  type QualifyingGame,
} from './baselines';
import { clamp, winsorizedZ } from './stats';
import { blendFor } from './regime';

/** The pure inputs the readiness engine needs beyond the games themselves. */
export interface ReadinessContext {
  /** The player's authored improvement targets (active-ness/creation filtered inside). */
  targets: AuthoredTarget[];
}

export const EMPTY_CONTEXT: ReadinessContext = { targets: [] };

export interface PerfState {
  /** Whether any objective component had usable data. */
  available: boolean;
  /** Share of acute games qualifying for per-10 stats (feeds confidence). */
  statCoverage: number;
  /** Largest single account's share of the acute window (1 = single-account). */
  maxAccountShare: number;
  declineFired: boolean;
  /** Peak of the one-sided CUSUM accumulator over the acute window. */
  cusumMax: number;
  /** Counted (trusted, non-learning) qualifying acute games. */
  countedGames: number;
  statPenalty: number;
  /** Pooled per-account winrate dip (baseline − acute), null when under-sampled. */
  wrDip: number | null;
  wrPenalty: number;
  bonus: number;
  /** Positive evidence of hitting active targets (regardless of tilt). */
  targetEvidence: boolean;
  /** Dampener actually applied (evidence present AND tilt not elevated). */
  dampened: boolean;
  /** Heroes skipped by the learning-window exemption (deduped). */
  stillLearning: string[];
  /** Mean sign-aligned z per metric over counted games (negative = worse than usual). */
  metricMeans: Partial<Record<MetricKey, number>>;
  /** Objective decline detected — gates the subjective agree/disagree split. */
  objectiveAdverse: boolean;
  /** Regime blend b ∈ [0,1]: share of the acute window with comparable per-10 coverage (1 = full stats, 0 = manual). */
  blend: number;
  /** Sum of per-game trust weights behind `blend` (the continuous coverage numerator). */
  blendCoverage: number;
  /** Final perfDelta ∈ [perfDeltaMin, perfDeltaMax]. */
  delta: number;
}

export const EMPTY_PERF: PerfState = {
  available: false, statCoverage: 0, maxAccountShare: 1, declineFired: false, cusumMax: 0,
  countedGames: 0, statPenalty: 0, wrDip: null, wrPenalty: 0, bonus: 0, targetEvidence: false,
  dampened: false, stillLearning: [], metricMeans: {}, objectiveAdverse: false, blend: 0, blendCoverage: 0, delta: 0,
};

const GRADE_CREDIT: Record<TargetGrade, number> = { hit: 1, partial: 0.5, missed: 0 };

const trustFor = (n: number): number => clamp((n - T.statMinGames) / T.statTrustRamp, 0, 1);

/** Evaluate the objective-performance subscore as-of `refOrdinal` (the last active day). */
export function perfState(
  games: GameRecord[],
  refOrdinal: number,
  ctx: ReadinessContext,
  fatigued: boolean,
): PerfState {
  const acuteStart = refOrdinal - T.acuteMentalDays + 1;
  const acuteGames = games.filter((g) => {
    const ord = dayOrdinal(g.timestamp);
    return ord >= acuteStart && ord <= refOrdinal;
  });
  if (acuteGames.length === 0) return EMPTY_PERF;

  // Account concentration of the acute window (confidence input).
  const perAccount = new Map<string, number>();
  for (const g of acuteGames) perAccount.set(g.account, (perAccount.get(g.account) ?? 0) + 1);
  const maxAccountShare = Math.max(...perAccount.values()) / acuteGames.length;

  const baselines = buildBaselines(games);
  const acuteQualifying = baselines.qualifying.filter((q) => q.ordinal >= acuteStart && q.ordinal <= refOrdinal);

  // Role-fallback mix guard, computed once per (account,role) present in the acute window.
  const roleOverlap = new Map<string, number>();
  for (const q of acuteQualifying) {
    const rk = roleKey(q.account, q.role);
    if (roleOverlap.has(rk)) continue;
    const bucket = baselines.roleBuckets.get(rk) ?? [];
    const baselineWindow = bucket.filter((b) => b.ordinal < acuteStart).slice(-T.baseWindowGames);
    const acuteRole = bucket.filter((b) => b.ordinal >= acuteStart && b.ordinal <= refOrdinal);
    roleOverlap.set(rk, heroMixOverlap(acuteRole, baselineWindow));
  }

  // --- per-10 decline: winsorized z per metric → weighted game score → one-sided CUSUM ---
  let cusum = 0;
  let cusumMax = 0;
  let countedGames = 0;
  let blendCoverage = 0;
  let gameScoreSum = 0;
  const stillLearning = new Set<string>();
  const metricSums: Partial<Record<MetricKey, { sum: number; n: number }>> = {};

  for (const q of acuteQualifying) {
    const lifetime = baselines.heroLifetime.get(heroKey(q.account, q.hero)) ?? 0;
    if (lifetime < T.heroLearnGames) {
      stillLearning.add(q.hero);
      continue;
    }
    const heroBase = baselineFor(baselines.heroBuckets.get(heroKey(q.account, q.hero)), acuteStart);
    let base = heroBase;
    if (heroBase.n < T.statMinGames) {
      const roleBase = baselineFor(baselines.roleBuckets.get(roleKey(q.account, q.role)), acuteStart);
      const overlap = roleOverlap.get(roleKey(q.account, q.role)) ?? 0;
      if (roleBase.n < T.statMinGames || overlap < T.mixOverlapMin) continue; // silently inert
      base = roleBase;
    }
    const trust = trustFor(base.n);
    if (trust <= 0) continue;

    let weighted = 0;
    let weightSum = 0;
    for (const m of METRIC_KEYS) {
      const b = base.metrics[m];
      if (b.mean < T.metricSkipMin[m]) continue; // role-inapplicable / degenerate metric
      const z = winsorizedZ(q.per10[m], b, T.sdFloorFrac, T.zWinsor);
      const aligned = m === 'deaths' ? -z : z; // deaths: lower is better
      const w = T.metricWeights[m];
      weighted += aligned * w;
      weightSum += w;
      const slot = (metricSums[m] ??= { sum: 0, n: 0 });
      slot.sum += aligned;
      slot.n += 1;
    }
    if (weightSum === 0) continue;

    const g = (weighted / weightSum) * trust;
    countedGames += 1;
    // Blend numerator: the game's own trust weight (not a binary +1), so a hero crossing the
    // baseline trust floor bleeds coverage in gradually instead of reclassifying its whole cohort
    // at once — keeps b continuous in the day index (R1). At full coverage trust=1 ⇒ this equals
    // countedGames ⇒ b is unchanged, preserving the b=1 bit-identity.
    blendCoverage += trust;
    gameScoreSum += g;
    cusum = Math.max(0, cusum + (-g - T.cusumSlack));
    cusumMax = Math.max(cusumMax, cusum);
  }

  // Coverage = games that were actually COMPARABLE (trusted bucket, past the
  // learning window) — not merely stat-carrying. A flex player whose buckets
  // never fill must read as low-coverage, not high-confidence.
  const statCoverage = countedGames / acuteGames.length;
  const blend = blendFor(blendCoverage, acuteGames.length);

  const declineFired = cusumMax >= T.cusumThreshold && countedGames >= T.evidenceMinGames;
  const statPenalty = declineFired
    ? Math.min(T.statPenaltyCap, T.statPenaltyBase + T.statPenaltySlope * (cusumMax - T.cusumThreshold))
    : 0;

  const meanGameScore = countedGames > 0 ? gameScoreSum / countedGames : 0;
  const bonus =
    cusumMax === 0 && countedGames >= T.evidenceMinGames && meanGameScore > T.perfBonusMinZ
      ? Math.min(T.perfBonusCap, T.perfBonusCap * (meanGameScore - T.perfBonusMinZ))
      : 0;

  // --- winrate vs own baseline, per account, pooled by acute sample size ---
  const baseStart = refOrdinal - T.chronicDays + 1;
  let dipWeighted = 0;
  let dipWeight = 0;
  for (const account of perAccount.keys()) {
    const acuteWl = winLoss(acuteGames.filter((g) => g.account === account));
    const acuteDecided = acuteWl.wins + acuteWl.losses;
    if (acuteDecided < T.wrMinDecidedAcute) continue;
    const baseGames = games.filter((g) => {
      if (g.account !== account) return false;
      const ord = dayOrdinal(g.timestamp);
      return ord >= baseStart && ord < acuteStart; // uncoupled: baseline excludes the acute window
    });
    const baseWl = winLoss(baseGames);
    if (baseWl.wins + baseWl.losses < T.wrMinDecidedBase) continue;
    dipWeighted += (baseWl.winrate - acuteWl.winrate) * acuteDecided;
    dipWeight += acuteDecided;
  }
  const wrDip = dipWeight > 0 ? dipWeighted / dipWeight : null;
  // Manual regime PROMOTES the results arm — cap only. The ceiling lerps 15 → 30 by (1−b); the
  // firing threshold (wrDipMin) and slope (wrPenaltySlope) stay regime-invariant, so `objectiveAdverse`
  // never flips with b and ordinary winrate noise never reddens (only a genuinely deep, sustained dip
  // reaches the promoted ceiling). At b=1: cap = wrPenaltyCap exactly ⇒ bit-identical.
  const wrCap = T.wrPenaltyCap + T.wrManualCapBoost * (1 - blend);
  const wrPenalty =
    wrDip !== null && wrDip >= T.wrDipMin
      ? Math.min(wrCap, (wrDip - 0.05) * T.wrPenaltySlope)
      : 0;

  // --- target-focus dampener (deliberate-practice exemption) ---
  // Day-gated on BOTH ends: a target only counts from its creation day, and an
  // archival only stops it from the archival day onward — archiving a finished
  // target today must never retroactively strip past trend days' dampening
  // (review finding: `!archivedAt` alone re-scored history on archival).
  //
  // SELF-RATED (◎) targets only: measured (⚡) targets auto-grade from match
  // stats with no deliberate-practice act behind them, and scoring/export
  // deliberately IGNORE their stored `review.grades` so the two grading paths
  // can't double-count (`targets/scoring.ts`) — the dampener mirrors both
  // rules. An auto-hit easy measured target must never buy dampening on
  // autopilot.
  const activeTargets = ctx.targets.filter(
    (t) =>
      t.isActive &&
      t.mode !== 'measured' &&
      (!t.archivedAt || dayOrdinal(t.archivedAt) > refOrdinal) &&
      t.id !== NOTION_IMPROVEMENT_TARGET_ID &&
      dayOrdinal(t.createdAt) <= refOrdinal,
  );
  let gradedGames = 0;
  let creditSum = 0;
  if (activeTargets.length > 0) {
    for (const g of acuteGames) {
      const grades = g.review?.grades;
      if (!grades) continue;
      const credits = activeTargets
        .map((t) => grades[t.id])
        .filter((gr): gr is TargetGrade => gr !== undefined)
        .map((gr) => GRADE_CREDIT[gr]);
      if (credits.length === 0) continue;
      gradedGames += 1; // one game = one unit of evidence, however many targets it grades
      creditSum += credits.reduce((a, b) => a + b, 0) / credits.length;
    }
  }
  const targetEvidence = gradedGames >= T.dampMinGraded && creditSum / Math.max(1, gradedGames) >= T.dampHitRate;
  const dampened = targetEvidence && !fatigued;

  const penalty = (dampened ? T.dampFactor : 1) * (statPenalty + wrPenalty);
  const delta = clamp(bonus - penalty, T.perfDeltaMin, T.perfDeltaMax);

  const metricMeans: Partial<Record<MetricKey, number>> = {};
  for (const m of METRIC_KEYS) {
    const slot = metricSums[m];
    if (slot && slot.n > 0) metricMeans[m] = slot.sum / slot.n;
  }

  return {
    available: countedGames > 0 || wrDip !== null,
    statCoverage,
    maxAccountShare,
    declineFired,
    cusumMax,
    countedGames,
    statPenalty,
    wrDip,
    wrPenalty,
    bonus,
    targetEvidence,
    dampened,
    stillLearning: [...stillLearning],
    metricMeans,
    objectiveAdverse: declineFired || wrPenalty > 0,
    blend,
    blendCoverage,
    delta,
  };
}
