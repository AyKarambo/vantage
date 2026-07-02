import { winLoss, type GameRecord } from './analytics';

/**
 * Rank/SR progression — a heuristic. The sanctioned Overwolf feed does not
 * expose SR, so this projects a believable rank from recent form. It is a
 * model for the UI, not ground truth, and is intentionally easy to swap out
 * once a real SR source exists.
 */

export interface Progression {
  sr: number;
  tier: string;
  division: number;
  /** SR change across the range, signed. */
  delta: number;
}

const TIERS = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Master', 'Grandmaster'];
const TIER_SPAN = 500; // sr per tier
const DIV_SPAN = 100; // sr per division (5 → 1)

/** Map an overall winrate onto a plausible SR, anchored at 50% ≈ 2500. */
export function winrateToSr(winrate: number): number {
  return clamp(Math.round(2500 + (winrate - 0.5) * 4200), 300, 4900);
}

export function tierOf(sr: number): { tier: string; division: number } {
  const idx = clamp(Math.floor(sr / TIER_SPAN), 0, TIERS.length - 1);
  const within = sr - idx * TIER_SPAN;
  const division = clamp(5 - Math.floor(within / DIV_SPAN), 1, 5);
  return { tier: TIERS[idx], division };
}

export function progression(games: GameRecord[]): Progression {
  const overall = winLoss(games);
  const sr = winrateToSr(overall.winrate);
  const { tier, division } = tierOf(sr);

  // Delta: compare the older and newer halves of the range by winrate.
  const sorted = [...games].sort((a, b) => a.timestamp - b.timestamp);
  const mid = Math.floor(sorted.length / 2);
  const older = winrateToSr(winLoss(sorted.slice(0, mid)).winrate);
  const newer = winrateToSr(winLoss(sorted.slice(mid)).winrate);
  const delta = sorted.length >= 4 ? newer - older : 0;

  return { sr, tier, division, delta };
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
