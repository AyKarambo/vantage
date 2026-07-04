import { winLoss, type GameRecord, type TargetGrade } from './analytics';

/**
 * Improvement Targets — the flexible, user-defined focus system. A target is
 * either self-rated (◎ you grade it after the game) or measured (⚡ bound to a
 * stat). Both are graded on the Review screen today; grades persist on the
 * match record (`GameRecord.review`) and drive the hit-rates, sparklines and
 * win-splits below. {@link sampleTargets} produces a representative library
 * for demo mode, grounded in the current dataset so it feels real.
 */

export type TargetMode = 'self' | 'measured';

/** A target the player authored in the builder and saved to their library. */
export interface AuthoredTarget {
  id: string;
  name: string;
  mode: TargetMode;
  /** Legacy field kept for old manual.json files; new writes are always 'season'. */
  scope?: 'match' | 'season';
  rule: string;
  createdAt: number;
  /** Active targets are the ones graded on the Review screen. */
  isActive: boolean;
  /** Set = hidden from the library and the active set, restorable. */
  archivedAt?: number;
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
  isActive: boolean;
  archivedAt?: number;
}

interface TargetSeed {
  id: string;
  name: string;
  mode: TargetMode;
  rule: string;
  /** Fraction of attempts hit — the target's difficulty. */
  difficulty: number;
  /** How much hitting it lifts winrate above the player's baseline. */
  lift: number;
}

const SEEDS: TargetSeed[] = [
  { id: 't-ult', name: 'Hold ult until first pick', mode: 'self', rule: 'You grade it', difficulty: 0.58, lift: 0.11 },
  { id: 't-trade', name: 'Trade before you die', mode: 'measured', rule: 'Deaths ≤ 4', difficulty: 0.47, lift: 0.14 },
  { id: 't-comms', name: 'Comms = callouts only', mode: 'self', rule: 'You grade it', difficulty: 0.71, lift: 0.06 },
  { id: 't-dmg', name: '9k+ dmg / 10 min', mode: 'measured', rule: 'Damage ≥ 9,000', difficulty: 0.52, lift: 0.09 },
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
      isActive: true,
    };
  });
}

/**
 * The Targets library shown on the dashboard: the player's own authored targets
 * when they have any (archived included — flagged via `archivedAt` so the
 * renderer can hide them behind a Restore affordance), otherwise the sample
 * library (demo mode). Archiving every target must not resurrect the demo data.
 */
export function buildTargets(games: GameRecord[], authored?: AuthoredTarget[]): TargetSummary[] {
  if (authored && authored.length) {
    const base = winLoss(games).winrate || 0.5;
    return [...authored].sort((a, b) => b.createdAt - a.createdAt).map((t) => authoredSummary(t, games, base));
  }
  return sampleTargets(games);
}

/**
 * Score an authored target from the Review-screen grades stored on the games.
 * An attempt is any grade for this target; a hit is a 'hit' grade ('partial'
 * counts as an attempt, not a hit). Win-splits fall back to the player's
 * baseline while a side has no games.
 */
function authoredSummary(t: AuthoredTarget, games: GameRecord[], base: number): TargetSummary {
  const graded = games
    .filter((g) => g.review?.grades[t.id] !== undefined)
    .sort((a, b) => a.timestamp - b.timestamp);
  const grades = graded.map((g) => g.review!.grades[t.id]);
  const hits = grades.filter((g) => g === 'hit').length;
  const hitGames = graded.filter((g) => g.review!.grades[t.id] === 'hit');
  const missGames = graded.filter((g) => g.review!.grades[t.id] !== 'hit');

  return {
    id: t.id,
    name: t.name,
    mode: t.mode,
    rule: t.rule,
    hitRate: grades.length ? hits / grades.length : 0,
    hits,
    attempts: grades.length,
    winWhenHit: hitGames.length ? winLoss(hitGames).winrate : base,
    winWhenMissed: missGames.length ? winLoss(missGames).winrate : base,
    spark: gradeSpark(grades),
    isActive: t.isActive,
    archivedAt: t.archivedAt,
  };
}

/** Last-8 attempts chronologically (hit→1, partial→0.5, missed→0), left-padded with 0. */
function gradeSpark(grades: TargetGrade[]): number[] {
  const recent = grades.slice(-8).map((g) => (g === 'hit' ? 1 : g === 'partial' ? 0.5 : 0));
  return [...new Array<number>(8 - recent.length).fill(0), ...recent];
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
