import { winLoss, type GameRecord } from './analytics';

/**
 * Improvement Targets — the flexible, user-defined focus system. A target is
 * either self-rated (◎ you grade it after the game) or measured (⚡ bound to a
 * stat and auto-graded).
 *
 * Persisting user-authored targets and per-game grades is a future step (the
 * manual-logging pipeline). Until then {@link sampleTargets} produces a
 * representative library, grounded in the current dataset so hit-rates and the
 * "does it move your winrate" split feel real rather than hand-typed.
 */

export type TargetMode = 'self' | 'measured';

/** A target the player authored in the builder and saved to their library. */
export interface AuthoredTarget {
  id: string;
  name: string;
  mode: TargetMode;
  scope: 'match' | 'season';
  rule: string;
  createdAt: number;
}

export interface TargetSummary {
  id: string;
  name: string;
  mode: TargetMode;
  rule: string;
  hitRate: number; // 0..1
  hits: number;
  attempts: number;
  winWhenHit: number; // 0..1
  winWhenMissed: number; // 0..1
  spark: number[];
  scope: 'match' | 'season';
}

interface TargetSeed {
  id: string;
  name: string;
  mode: TargetMode;
  rule: string;
  scope: 'match' | 'season';
  /** Fraction of attempts hit — the target's difficulty. */
  difficulty: number;
  /** How much hitting it lifts winrate above the player's baseline. */
  lift: number;
}

const SEEDS: TargetSeed[] = [
  { id: 't-ult', name: 'Hold ult until first pick', mode: 'self', rule: 'You grade it', scope: 'season', difficulty: 0.58, lift: 0.11 },
  { id: 't-trade', name: 'Trade before you die', mode: 'measured', rule: 'Deaths ≤ 4', scope: 'season', difficulty: 0.47, lift: 0.14 },
  { id: 't-comms', name: 'Comms = callouts only', mode: 'self', rule: 'You grade it', scope: 'season', difficulty: 0.71, lift: 0.06 },
  { id: 't-dmg', name: '9k+ dmg / 10 min', mode: 'measured', rule: 'Damage ≥ 9,000', scope: 'season', difficulty: 0.52, lift: 0.09 },
];

export function sampleTargets(games: GameRecord[]): TargetSummary[] {
  const base = winLoss(games).winrate || 0.5;
  const attempts = Math.max(8, Math.min(games.length, 21));

  return SEEDS.map((s) => {
    const hits = Math.round(attempts * s.difficulty);
    const winWhenHit = clamp01(base + s.lift);
    const winWhenMissed = clamp01(base - s.lift * 0.6);
    return {
      id: s.id,
      name: s.name,
      mode: s.mode,
      rule: s.rule,
      hitRate: s.difficulty,
      hits,
      attempts,
      winWhenHit,
      winWhenMissed,
      spark: buildSpark(s.difficulty, s.id),
      scope: s.scope,
    };
  });
}

/**
 * The Targets library shown on the dashboard: the player's own authored targets
 * when they have any, otherwise the representative sample library (demo mode).
 */
export function buildTargets(games: GameRecord[], authored?: AuthoredTarget[]): TargetSummary[] {
  if (authored && authored.length) {
    const base = winLoss(games).winrate || 0.5;
    return [...authored].sort((a, b) => b.createdAt - a.createdAt).map((t) => authoredSummary(t, base));
  }
  return sampleTargets(games);
}

/**
 * Map an authored target to a library row. No per-match grades are tracked yet,
 * so a freshly authored target starts with no attempts and its win-splits sit at
 * the player's baseline until real data accrues.
 */
function authoredSummary(t: AuthoredTarget, base: number): TargetSummary {
  return {
    id: t.id,
    name: t.name,
    mode: t.mode,
    rule: t.rule,
    hitRate: 0,
    hits: 0,
    attempts: 0,
    winWhenHit: base,
    winWhenMissed: base,
    spark: Array(8).fill(0),
    scope: t.scope,
  };
}

/** Deterministic 8-point trend around the target's difficulty. */
function buildSpark(difficulty: number, seed: string): number[] {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const out: number[] = [];
  for (let i = 0; i < 8; i++) {
    h = (h * 1103515245 + 12345) & 0x7fffffff;
    const wobble = ((h % 100) / 100 - 0.5) * 0.3;
    const ramp = (i / 7) * 0.2 - 0.1;
    out.push(Number(clamp01(difficulty + wobble + ramp).toFixed(3)));
  }
  return out;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
