/**
 * Personal per-10-minute stat baselines for the objective-performance subscore.
 *
 * Buckets are PER ACCOUNT (a smurf's easy-lobby numbers must never inflate the
 * main account's baseline), keyed by hero with a per-role fallback. Only games
 * with real `perHero` stats and a usable PLAYED time qualify — single-hero
 * games, and multi-hero games for their DOMINANT hero (see `per10SourceOf`).
 * The per-10 divisor is the time the player could actually fight — measured
 * from the round events on newer captures, estimated from the wall clock on
 * older ones (see `../playedTime`) — so a bucket built from both eras stays
 * comparable. A multi-hero game counts for its dominant hero when per-hero
 * minutes exist: newer captures record them, so that hero's own stats over its
 * own minutes are as clean as a one-hero game. Games without per-hero minutes
 * stay excluded: mixing attributed with unattributed rows inside one bucket
 * would bias it (the display-side `heroStats` accepts that bias for table
 * completeness; a decline detector must not).
 *
 * Hero EXPERIENCE (`heroLifetime`, the learning-window input) is the one map
 * that pools ACROSS accounts: how many games a player has on a hero is a
 * property of the player, not of the account they queued on.
 */

import type { GameRecord, HeroStat } from '../analytics';
import { heroCredits, playedMinutesOf } from '../playedTime';
import { READINESS_TUNING as T } from './constants';
import { dayOrdinal } from './day';
import { meanSd, type MeanSd } from './stats';

export type MetricKey = 'eliminations' | 'deaths' | 'damage' | 'healing';
export const METRIC_KEYS: MetricKey[] = ['eliminations', 'deaths', 'damage', 'healing'];

export type Per10 = Record<MetricKey, number>;

/** One game that qualifies for per-10 decline detection. */
export interface QualifyingGame {
  ordinal: number;
  timestamp: number;
  account: string;
  hero: string;
  role: string;
  per10: Per10;
}

export interface BaselineStats {
  /** Baseline games available (before the acute window, capped at baseWindowGames). */
  n: number;
  metrics: Record<MetricKey, MeanSd>;
}

export interface Baselines {
  /** All qualifying games, ascending by timestamp. */
  qualifying: QualifyingGame[];
  /** `${account}|${hero}` → qualifying games, ascending. */
  heroBuckets: Map<string, QualifyingGame[]>;
  /** `${account}|${role}` → qualifying games, ascending. */
  roleBuckets: Map<string, QualifyingGame[]>;
  /**
   * hero → lifetime games on that hero ACROSS ALL ACCOUNTS (any game listing the
   * hero — experience, not just qualifying). Keyed by hero alone on purpose: the
   * learning-window exemption asks "has this player learned this hero", and 244
   * games on the main make the same hero on an alt a hero they know.
   */
  heroLifetime: Map<string, number>;
}

export const heroKey = (account: string, hero: string): string => `${account}|${hero}`;
export const roleKey = (account: string, role: string): string => `${account}|${role}`;

/** What feeds a game's per-10 rates: one hero, that hero's stat row, and the minutes it was played. */
export interface Per10Source {
  hero: string;
  row: HeroStat;
  /** The per-10 divisor: the game's played minutes (single hero) or the hero's share of them (dominant hero). */
  minutes: number;
}

/**
 * The hero, stat row and played minutes a game contributes to per-10 rates, or
 * null when it cannot feed them (strict hygiene, plan §2.2). Nothing is
 * fabricated; two shapes qualify, each needing at least `minPer10Minutes` of
 * PLAYED time (measured or estimated by `playedMinutesOf`) on the hero scored:
 *  - SINGLE hero: one hero and one real `perHero` row, scored over the game's
 *    played minutes.
 *  - DOMINANT hero: a swap-heavy game whose rows ALL carry per-hero minutes and
 *    whose top hero holds at least `dominantHeroShare` of them, scored on its
 *    own stats over its own played minutes (the game's played time × its share).
 *    Rows without minutes (older captures, or an edited record whose evenly
 *    split rows are no longer the feed's) stay out — nothing is inferred.
 */
export function per10SourceOf(g: GameRecord): Per10Source | null {
  if (!g.perHero?.length) return null;
  const played = playedMinutesOf(g);
  if (played === null) return null;

  if (g.heroes.length === 1 && g.perHero.length === 1) {
    return played >= T.minPer10Minutes ? { hero: g.heroes[0], row: g.perHero[0], minutes: played } : null;
  }

  // Same-hero swap segments merge into one credit, so a Tracer → Genji → Tracer
  // game reads as the two heroes it was, not three.
  const credits = heroCredits(g);
  if (credits.length === 0 || !credits.every((c) => typeof c.stats.minutes === 'number')) return null;
  // A listed hero with no stat row would leave its time unaccounted for and
  // inflate the top hero's share, so the split must cover every hero played.
  if (g.heroes.some((h) => !credits.some((c) => c.hero === h))) return null;
  const top = credits.reduce((a, b) => (b.share > a.share ? b : a));
  if (top.share < T.dominantHeroShare || !((top.stats.minutes ?? 0) > 0)) return null;
  const minutes = played * top.share;
  return minutes >= T.minPer10Minutes ? { hero: top.hero, row: top.stats, minutes } : null;
}

/**
 * The per-10 divisor for a game — the played minutes of the hero it is scored
 * on — or null when the game cannot feed per-10 rates (see {@link per10SourceOf}).
 */
export function per10MinutesOf(g: GameRecord): number | null {
  return per10SourceOf(g)?.minutes ?? null;
}

/** Whether a game qualifies for the per-10 decline component. */
export function qualifiesForPer10(g: GameRecord): boolean {
  return per10SourceOf(g) !== null;
}

function toQualifying(g: GameRecord, source: Per10Source): QualifyingGame {
  const { row } = source;
  const scale = 10 / source.minutes;
  return {
    ordinal: dayOrdinal(g.timestamp),
    timestamp: g.timestamp,
    account: g.account,
    hero: source.hero,
    role: g.role,
    per10: {
      eliminations: row.eliminations * scale,
      deaths: row.deaths * scale,
      damage: row.damage * scale,
      healing: row.healing * scale,
    },
  };
}

/** Single pass over (cleaned, ascending) games → all baseline buckets. */
export function buildBaselines(games: GameRecord[]): Baselines {
  const qualifying: QualifyingGame[] = [];
  const heroBuckets = new Map<string, QualifyingGame[]>();
  const roleBuckets = new Map<string, QualifyingGame[]>();
  const heroLifetime = new Map<string, number>();

  for (const g of games) {
    for (const hero of g.heroes) {
      heroLifetime.set(hero, (heroLifetime.get(hero) ?? 0) + 1);
    }
    const source = per10SourceOf(g);
    if (source === null) continue;
    const q = toQualifying(g, source);
    qualifying.push(q);
    const hk = heroKey(q.account, q.hero);
    const rk = roleKey(q.account, q.role);
    (heroBuckets.get(hk) ?? heroBuckets.set(hk, []).get(hk)!).push(q);
    (roleBuckets.get(rk) ?? roleBuckets.set(rk, []).get(rk)!).push(q);
  }

  return { qualifying, heroBuckets, roleBuckets, heroLifetime };
}

/**
 * Per-metric baseline over the trailing window of bucket games STRICTLY BEFORE
 * `acuteStartOrdinal` — uncoupled: the acute window never contaminates its own
 * baseline (the ACWR mathematical-coupling lesson from the research).
 */
export function baselineFor(bucket: QualifyingGame[] | undefined, acuteStartOrdinal: number): BaselineStats {
  const prior = (bucket ?? []).filter((q) => q.ordinal < acuteStartOrdinal);
  const window = prior.slice(-T.baseWindowGames);
  const metrics = {} as Record<MetricKey, MeanSd>;
  for (const m of METRIC_KEYS) {
    metrics[m] = meanSd(window.map((q) => q.per10[m]));
  }
  return { n: window.length, metrics };
}

/**
 * Hero-mix overlap between a role bucket's acute games and its baseline window,
 * as Σ_h min(shareAcute, shareBaseline) — 1 = identical mix, 0 = disjoint. A
 * role-fallback comparison below `mixOverlapMin` is skipped: a change in WHICH
 * heroes are played must never read as a performance decline.
 */
export function heroMixOverlap(acute: QualifyingGame[], baseline: QualifyingGame[]): number {
  if (acute.length === 0 || baseline.length === 0) return 0;
  const share = (list: QualifyingGame[]): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const q of list) counts.set(q.hero, (counts.get(q.hero) ?? 0) + 1);
    const total = list.length;
    const shares = new Map<string, number>();
    for (const [hero, n] of counts) shares.set(hero, n / total);
    return shares;
  };
  const a = share(acute);
  const b = share(baseline);
  let overlap = 0;
  for (const [hero, sa] of a) overlap += Math.min(sa, b.get(hero) ?? 0);
  return overlap;
}
