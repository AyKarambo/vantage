import { winLoss, type GameRecord } from '../analytics';
import { clamp01, type TargetMode, type TargetSummary } from './types';

/**
 * The demo path for Improvement Targets: a representative sample library,
 * grounded in the current dataset so it feels real when the player has no
 * authored targets yet.
 */

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

/** Representative demo target library for {@link buildTargets} when the player hasn't authored any targets. */
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
