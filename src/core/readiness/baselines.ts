/**
 * Personal per-10-minute stat baselines for the objective-performance subscore.
 *
 * Buckets are PER ACCOUNT (a smurf's easy-lobby numbers must never inflate the
 * main account's baseline), keyed by hero with a per-role fallback. Only
 * single-hero games with real `perHero` stats and a usable duration qualify —
 * per-hero playtime inside a multi-hero match is not recorded, so any per-10
 * attribution there would be systematically biased (unlike the display-side
 * `heroStats`, which accepts that bias for table completeness).
 */

import type { GameRecord } from '../analytics';
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
  /** `${account}|${hero}` → lifetime games on that hero (any game listing the hero — experience, not just qualifying). */
  heroLifetime: Map<string, number>;
}

export const heroKey = (account: string, hero: string): string => `${account}|${hero}`;
export const roleKey = (account: string, role: string): string => `${account}|${role}`;

/** Whether a game qualifies for the per-10 decline component (strict hygiene, plan §2.2). */
export function qualifiesForPer10(g: GameRecord): boolean {
  return (
    g.heroes.length === 1 &&
    g.perHero?.length === 1 &&
    typeof g.durationMinutes === 'number' &&
    g.durationMinutes >= T.minPer10Minutes
  );
}

function toQualifying(g: GameRecord): QualifyingGame {
  const row = g.perHero![0];
  const scale = 10 / g.durationMinutes!;
  return {
    ordinal: dayOrdinal(g.timestamp),
    timestamp: g.timestamp,
    account: g.account,
    hero: g.heroes[0],
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
      const key = heroKey(g.account, hero);
      heroLifetime.set(key, (heroLifetime.get(key) ?? 0) + 1);
    }
    if (!qualifiesForPer10(g)) continue;
    const q = toQualifying(g);
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
