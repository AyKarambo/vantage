/**
 * Objective-performance subscore: winrate vs the player's own per-account
 * baseline + per-10 stat decline vs per-hero (fallback per-role) baselines,
 * accumulated by a one-sided CUSUM so only sustained evidence — one long
 * marathon session, or several sessions — ever fires. Includes the
 * target-focus dampener (the deliberate-practice "learning dip" exemption).
 *
 * Several accounts, one player. Every detector below — the CUSUM, its gates,
 * the coverage sums, the regime blend, the pooled winrate dip — is computed
 * ACCOUNT-BLIND: one game is one game, on the main or an alt alike, so none of
 * these anti-false-alarm guarantees ever depend on which account played them.
 * The MAIN account (most games among those played recently — see
 * `mainAccountOf`) is only used at the very end, to size ONE damper
 * (`altGameWeight` / `altDamp`) applied once to the finished delta.
 *
 * That damper is rank-aware, not a flat per-account discount: an alt game
 * close to the rank the main usually plays at counts fully — a second account
 * at your own level isn't smurfing — and only a genuine gap below that usual
 * rank tapers it down, to a floor for a clearly mismatched account (see
 * `rankProximityWeight`). Baselines stay strictly per account; hero EXPERIENCE
 * (the learning window) pools across accounts because it belongs to the
 * player, not the account. A single-account history — or one where every alt
 * game reads as rank-close — has altDamp = 1 and is bit-identical to the
 * unweighted engine.
 *
 * Anti-false-alarm guarantees (by construction, see constants):
 * - a single winsorized game contributes at most zWinsor − cusumSlack < cusumThreshold, on any
 *   account (the CUSUM is account-blind);
 * - the decline index needs ≥ evidenceMinGames counted games regardless of C — an unweighted,
 *   account-blind count;
 * - buckets below statMinGames are inert; trust ramps in with no cliff;
 * - a hero-mix change never reads as decline (per-hero buckets + mix-overlap guard);
 * - the alt damper can only pull the finished delta TOWARD neutral (0 ≤ altDamp ≤ 1), never past it.
 */

import type { GameRecord, TargetGrade } from '../analytics';
import type { AuthoredTarget } from '../targets/types';
import type { RankAnchorMap, RankPosition } from '../rank/types';
import { NOTION_IMPROVEMENT_TARGET_ID } from '../targets/notionBookkeeping';
import { winLoss } from '../analytics';
import { UNKNOWN_ACCOUNT } from '../accountsManage';
import { rankToPoints } from '../rank/scalar';
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
  /**
   * Per-(account::role) rank anchors — evidence input for the rank-gated undertraining
   * nudge (spec §7b). Absent ⇒ trend `unknown` ⇒ the nudge stays silent.
   */
  rankAnchors?: RankAnchorMap;
  /**
   * Match ids whose stored ±% must be ignored — the same read-time mask every
   * rank surface applies (see {@link ../placements/engine suppressedMatchIds}).
   * A match inside an OPEN placement run has no settled rank yet, so its delta
   * is neither movement nor evidence of stagnation. Absent ⇒ nothing masked.
   */
  suppressed?: ReadonlySet<string>;
}

export const EMPTY_CONTEXT: ReadinessContext = { targets: [] };

export interface PerfState {
  /** Whether any objective component had usable data. */
  available: boolean;
  /** Weighted share of acute evidence qualifying for per-10 stats (feeds confidence). */
  statCoverage: number;
  /**
   * Largest single account's RAW share of the acute window (1 = single-account). A confidence
   * input, deliberately unweighted: alt down-weighting changes how much alt games MOVE the
   * read, not how sure the read is.
   */
  maxAccountShare: number;
  /** The main account (most games, among those played recently; tie: most recent game, then lexical). Null with no acute games. */
  mainAccount: string | null;
  /** RAW share of the acute window played on a different, resolved account. 0 for a single account, for unresolved captures, and when there is no main. Just "is there alt activity at all" — see `altDamp` for how much it actually costs. */
  altShare: number;
  /** The actual multiplier applied to the subscore (1 = untouched): the mean per-game weight over the acute window, where a main-account game is always 1 and an alt game is full weight when rank-close to the main's usual rank, tapering to `altAccountWeight` for a genuine gap. */
  altDamp: number;
  declineFired: boolean;
  /** Peak of the one-sided CUSUM accumulator over the acute window. */
  cusumMax: number;
  /** Counted (trusted, non-learning) qualifying acute games — WEIGHTED: an alt-account game counts altAccountWeight. */
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
  /** Sum of per-game (weight × trust) behind `blend` (the continuous coverage numerator). */
  blendCoverage: number;
  /** Final perfDelta ∈ [perfDeltaMin, perfDeltaMax]. */
  delta: number;
}

export const EMPTY_PERF: PerfState = {
  available: false, statCoverage: 0, maxAccountShare: 1, mainAccount: null, altShare: 0, altDamp: 1, declineFired: false, cusumMax: 0,
  countedGames: 0, statPenalty: 0, wrDip: null, wrPenalty: 0, bonus: 0, targetEvidence: false,
  dampened: false, stillLearning: [], metricMeans: {}, objectiveAdverse: false, blend: 0, blendCoverage: 0, delta: 0,
};

const GRADE_CREDIT: Record<TargetGrade, number> = { hit: 1, partial: 0.5, missed: 0 };

const trustFor = (n: number): number => clamp((n - T.statMinGames) / T.statTrustRamp, 0, 1);

/**
 * The player's MAIN account: the one they play most, whose games carry the
 * objective read at full weight. Three rules make that pick stable and honest:
 *
 *  - the {@link UNKNOWN_ACCOUNT} bucket never competes (it is unresolved
 *    captures, not an account);
 *  - only accounts played since `activeFromOrdinal` are candidates, so a
 *    lifetime lead on an abandoned account cannot demote the account the
 *    player has actually moved to (all accounts compete when none qualify);
 *  - the leader must be ahead by {@link READINESS_TUNING.mainAccountLeadMargin};
 *    below it there is NO main, and every game weighs 1 (see `altGameWeight`).
 *
 * That margin matters more than it did for a flat per-account weight: the main
 * doesn't just decide WHO gets damped, it supplies the RANK every alt game is
 * measured against. Two accounts near a game-count tie but at genuinely
 * different ranks would otherwise swap which one supplies that reference from
 * a single game — and unlike a flat weight, that swap is not symmetric (the
 * higher-ranked account reads as "at or above main" either way, so only the
 * LOWER-ranked one's damping depends on which side of the tie it lands). The
 * margin keeps that reference stable through an ordinary near-even split.
 *
 * A count tied exactly at the top always fails the margin regardless of which
 * account a tie-break would have preferred, so there is deliberately no
 * recency/lexical tie-break here — it could never change the outcome. Null for
 * an empty history.
 */
export function mainAccountOf(
  games: ReadonlyArray<Pick<GameRecord, 'account' | 'timestamp'>>,
  opts: { activeFromOrdinal?: number } = {},
): string | null {
  const tally = new Map<string, { games: number; active: boolean }>();
  for (const g of games) {
    // The Unknown bucket is captures whose BattleTag never resolved, not an
    // account someone plays — it must never win the crown and hand every real
    // account the alt weight.
    if (g.account === UNKNOWN_ACCOUNT) continue;
    const active = opts.activeFromOrdinal === undefined || dayOrdinal(g.timestamp) >= opts.activeFromOrdinal;
    const t = tally.get(g.account);
    if (t) {
      t.games += 1;
      t.active = t.active || active;
    } else {
      tally.set(g.account, { games: 1, active });
    }
  }
  // Only accounts still in play can be the main: an account abandoned months
  // ago keeps a lifetime lead forever, which would quietly demote everything
  // the player actually plays now to alt weight.
  const live = [...tally.entries()].filter(([, s]) => s.active);
  const pool = live.length ? live : [...tally.entries()];
  const ranked = pool.sort(([, a], [, b]) => b.games - a.games);
  if (!ranked.length) return null;
  const [name, top] = ranked[0];
  const runnerUp = ranked[1]?.[1].games ?? 0;
  return top.games >= runnerUp * (1 + T.mainAccountLeadMargin) ? name : null;
}

/** Median rank scalar (see `../rank/scalar`) among `games`' `rankAtStart` snapshots, or null with none. */
function medianRankPoints(games: ReadonlyArray<Pick<GameRecord, 'rankAtStart'>>): number | null {
  const points = games
    .map((g) => g.rankAtStart)
    .filter((r): r is RankPosition => r != null)
    .map(rankToPoints)
    .sort((a, b) => a - b);
  if (!points.length) return null;
  const mid = Math.floor(points.length / 2);
  return points.length % 2 === 1 ? points[mid] : (points[mid - 1] + points[mid]) / 2;
}

/**
 * Weight for a game played on an alt account, from how far BELOW `mainPoints`
 * (the main's usual rank scalar) `altPoints` sits. Only a gap BELOW costs
 * anything — playing at or above your main's level on a second account isn't
 * smurfing, whatever the reason for the second account. Full weight inside
 * `altRankCloseGap` (mid/high Master reads as the same level as low
 * Grandmaster); the floor at/beyond `altRankSmurfGap` (a couple of tiers down
 * is a genuinely different game); linear in between.
 */
function rankProximityWeight(mainPoints: number, altPoints: number): number {
  const gap = Math.max(0, mainPoints - altPoints);
  if (gap <= T.altRankCloseGap) return 1;
  if (gap >= T.altRankSmurfGap) return T.altRankFloorWeight;
  const t = (gap - T.altRankCloseGap) / (T.altRankSmurfGap - T.altRankCloseGap);
  return 1 - t * (1 - T.altRankFloorWeight);
}

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

  // Account concentration of the acute window (confidence input) — RAW counts on purpose: how
  // SURE the read is does not change with the weighting below, only how much each game moves it.
  const perAccount = new Map<string, number>();
  for (const g of acuteGames) perAccount.set(g.account, (perAccount.get(g.account) ?? 0) + 1);
  const maxAccountShare = Math.max(...perAccount.values()) / acuteGames.length;

  // MAIN-ACCOUNT WEIGHTING lives at the very end of this function, as one damper on the finished
  // subscore — deliberately NOT as a per-game weight inside the accumulators below. A weight
  // inside a one-sided CUSUM scales its recovery steps as well as its adverse ones, so playing
  // WELL on an alt between two poor main games would push the accumulator up and fire a decline
  // the unweighted engine never saw; weights inside the coverage sums likewise drag the regime
  // blend toward 'manual' and switch on the very caps this is meant to avoid. Damping the result
  // instead keeps every anti-false-alarm guarantee below bit-identical for everyone, and can only
  // ever move the read TOWARD neutral — which is what "alt games count less" has to mean.
  //
  // Derived over the games up to this day, and only from accounts played inside the chronic
  // window — the same span the load family calls "your norm".
  const mainAccount = mainAccountOf(games, { activeFromOrdinal: refOrdinal - T.chronicDays + 1 });
  // Unresolved captures are unattributed evidence, not a second account: they must not read as
  // "your other accounts" for someone who only has one.
  const isAlt = (account: string): boolean =>
    mainAccount !== null && account !== mainAccount && account !== UNKNOWN_ACCOUNT;
  const altShare = acuteGames.filter((g) => isAlt(g.account)).length / acuteGames.length;

  // How much an alt game's evidence actually counts, per game: full weight when
  // it was played at (or above) the rank the MAIN account usually sits at — a
  // second account at the same level isn't smurfing — tapering down as the gap
  // below that usual rank grows (see rankProximityWeight). "Usual" is the median
  // rank held going into the main's own games over a trailing window
  // (rankAtStart; a single hot or cold streak shouldn't move the goalposts), not
  // today's number alone. Falls back to the flat altAccountWeight wherever a
  // rank can't be read — no anchor set on one side or the other — which is
  // exactly the number this replaces, so missing rank data degrades to the old
  // behaviour rather than to no damping at all.
  const rankWindowStart = refOrdinal - T.mainRankWindowDays + 1;
  const inRankWindow = (g: Pick<GameRecord, 'timestamp'>): boolean => {
    const ord = dayOrdinal(g.timestamp);
    return ord >= rankWindowStart && ord <= refOrdinal;
  };
  const mainRankPoints = mainAccount === null
    ? null
    : medianRankPoints(games.filter((g) => g.account === mainAccount && inRankWindow(g)));
  const altAccountRankPoints = new Map<string, number | null>();
  const altGameWeight = (g: GameRecord): number => {
    if (!isAlt(g.account)) return 1;
    if (mainRankPoints === null) return T.altAccountWeight;
    if (g.rankAtStart) return rankProximityWeight(mainRankPoints, rankToPoints(g.rankAtStart));
    if (!altAccountRankPoints.has(g.account)) {
      altAccountRankPoints.set(g.account, medianRankPoints(games.filter((x) => x.account === g.account && inRankWindow(x))));
    }
    const altPoints = altAccountRankPoints.get(g.account) ?? null;
    return altPoints === null ? T.altAccountWeight : rankProximityWeight(mainRankPoints, altPoints);
  };

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
    // Hero experience pools ACROSS accounts: 244 Genji games on the main and 6 on an alt is a
    // Genji player on the alt too — the learning exemption must never fire there.
    const lifetime = baselines.heroLifetime.get(q.hero) ?? 0;
    if (lifetime < T.heroLearnGames) {
      stillLearning.add(q.hero);
      continue;
    }
    // Baselines stay strictly per account: the alt's numbers are compared to the alt's own usual.
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

    // Pass 1: aligned z per active metric (deaths sign-flipped: lower is better).
    const active: Array<{ m: MetricKey; aligned: number; w: number }> = [];
    for (const m of METRIC_KEYS) {
      const b = base.metrics[m];
      if (b.mean < T.metricSkipMin[m]) continue; // role-inapplicable / degenerate metric
      const z = winsorizedZ(q.per10[m], b, T.sdFloorFrac, T.zWinsor);
      const aligned = m === 'deaths' ? -z : z; // deaths: lower is better
      active.push({ m, aligned, w: T.metricWeights[m] });
      const slot = (metricSums[m] ??= { sum: 0, n: 0 });
      slot.sum += aligned; // raw, ungated — the decline label must stay truthful about direction
      slot.n += 1;
    }
    if (active.length === 0) continue;

    // Passivity guard (spec §7a): deaths' FAVORABLE credit only holds while output holds.
    // outputZ = weight-normalized mean of the non-death active metrics; the credit ramps
    // 1 → 0 as outputZ falls 0 → −passivityRampZ, and the deaths WEIGHT leaves the blend
    // with it, so a scared game scores as its pure output decline. Graduated in BOTH
    // dimensions: over output (the ramp above) and over deaths-favorability (0 → full as
    // deathsAligned grows 0 → passivityDeathsRampZ) — deaths exactly at baseline keeps
    // full weight, so strictly-fewer deaths can never score worse than baseline deaths
    // (review finding: a binary aligned>0 gate flipped verdicts on 0.01 deaths/10).
    // Deaths above baseline keeps full adverse weight in every context. For SUPPORT games
    // (healing active) the healing channel alone can vouch for output: a Mercy whose
    // healing holds at baseline while she stops battle-dueling is doing her job, not
    // playing scared — without this, a floor-inflated damage z fires a false decline on
    // a genuine style shift (the exact false alarm Resolved #8 rejected). With no active
    // output metrics there is no evidence of passivity, so credit stands.
    let outWeighted = 0;
    let outWeightSum = 0;
    let healingAligned: number | null = null;
    for (const a of active) {
      if (a.m === 'deaths') continue;
      if (a.m === 'healing') healingAligned = a.aligned;
      outWeighted += a.aligned * a.w;
      outWeightSum += a.w;
    }
    const outputZ = outWeightSum > 0 ? outWeighted / outWeightSum : 0;
    const outputHoldZ = healingAligned !== null ? Math.max(outputZ, healingAligned) : outputZ;

    let weighted = 0;
    let weightSum = 0;
    for (const a of active) {
      let factor = 1;
      if (a.m === 'deaths' && a.aligned > 0 && outWeightSum > 0) {
        const outFactor = clamp(1 + outputHoldZ / T.passivityRampZ, 0, 1);
        const deathsEngage = clamp(a.aligned / T.passivityDeathsRampZ, 0, 1);
        factor = 1 - (1 - outFactor) * deathsEngage;
      }
      weighted += a.aligned * a.w * factor;
      weightSum += a.w * factor;
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
  // never fill must read as low-coverage, not high-confidence. Unweighted, like
  // everything else here: which account a game was played on says nothing about
  // whether its stats are comparable.
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
  // MAIN-ACCOUNT DAMPER (see the note where `altGameWeight` is derived). The
  // whole subscore — reward and punishment alike — lerps toward neutral with
  // the AVERAGE per-game weight over the acute window: every main-account game
  // counts as 1, an alt game close in rank to the main counts close to 1 too,
  // and only a genuine rank gap pulls its game down toward altAccountWeight.
  // altDamp = 1 (single account, no clear main, or every alt game rank-close)
  // ⇒ bit-identical.
  const altDamp = acuteGames.reduce((sum, g) => sum + altGameWeight(g), 0) / acuteGames.length;
  const delta = clamp(altDamp * (bonus - penalty), T.perfDeltaMin, T.perfDeltaMax);

  const metricMeans: Partial<Record<MetricKey, number>> = {};
  for (const m of METRIC_KEYS) {
    const slot = metricSums[m];
    if (slot && slot.n > 0) metricMeans[m] = slot.sum / slot.n;
  }

  return {
    available: countedGames > 0 || wrDip !== null,
    statCoverage,
    maxAccountShare,
    mainAccount,
    altShare,
    altDamp,
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
