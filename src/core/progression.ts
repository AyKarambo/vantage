import { winLoss, type GameRecord } from './analytics';

/**
 * Rank progression — a heuristic. The sanctioned Overwolf feed does not expose
 * SR, so this projects a believable rank from recent form. It is a model for
 * the UI, not ground truth, and is intentionally easy to swap out once a real
 * rank source exists.
 *
 * Modern Overwatch 2 shape: eight tiers Bronze→Champion, each split into five
 * divisions (5 = lowest band, 1 = highest), with progress toward the next
 * division shown as a percentage (0–100%) rather than raw points. The internal
 * scalar below is an implementation detail and is never displayed.
 */

export interface Progression {
  tier: string;
  division: number;
  /** Progress toward promotion within the current division, 0–100%. */
  progressPct: number;
  /** Signed change across the range, in percentage points of a division. */
  delta: number;
}

const TIERS = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Master', 'Grandmaster', 'Champion'];
const TIER_SPAN = 500; // internal rating points per tier
const DIV_SPAN = 100; // internal rating points per division (5 → 1)
const MAX_RATING = TIERS.length * TIER_SPAN - 1; // top of Champion 1

/**
 * Map an overall winrate onto the internal rating scale (0 → Bronze 5,
 * 1 → top of Champion). Linear across the full ladder; a heuristic, not SR.
 */
export function winrateToSr(winrate: number): number {
  return clamp(Math.round(winrate * TIERS.length * TIER_SPAN), 0, MAX_RATING);
}

export function tierOf(sr: number): { tier: string; division: number; progressPct: number } {
  const idx = clamp(Math.floor(sr / TIER_SPAN), 0, TIERS.length - 1);
  const within = sr - idx * TIER_SPAN;
  const division = clamp(5 - Math.floor(within / DIV_SPAN), 1, 5);
  const progressPct = ((within % DIV_SPAN) / DIV_SPAN) * 100;
  return { tier: TIERS[idx], division, progressPct };
}

export function progression(games: GameRecord[]): Progression {
  const overall = winLoss(games);
  const { tier, division, progressPct } = tierOf(winrateToSr(overall.winrate));

  // Delta: compare the older and newer halves of the range by winrate,
  // expressed in percentage points of a division (positive = climbing).
  const sorted = [...games].sort((a, b) => a.timestamp - b.timestamp);
  const mid = Math.floor(sorted.length / 2);
  const older = winrateToSr(winLoss(sorted.slice(0, mid)).winrate);
  const newer = winrateToSr(winLoss(sorted.slice(mid)).winrate);
  const delta = sorted.length >= 4 ? ((newer - older) / DIV_SPAN) * 100 : 0;

  return { tier, division, progressPct, delta };
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
