import { TIERS } from './engine';
import type { RankPosition } from './types';

/**
 * A monotonic scalar for a ladder position — the reversible representation the
 * backward rank reconstruction (see {@link ./reconstruct}) works in. The forward
 * engine ({@link ./engine}) only replays deltas onto an anchor and can't run in
 * reverse (rank protection is lossy), so historical "rank as of this match"
 * needs a plain linear scale we can add to and subtract from.
 *
 * Bronze 5 0% = 0 … Champion 1 100% = {@link MAX_POINTS}. 100 points per
 * division, 5 divisions per tier (division 5 lowest → 1 highest). A negative
 * `progressPct` (rank-protection carry) simply lowers the scalar. Pure/I-O-free.
 */

const POINTS_PER_DIVISION = 100;
const DIVISIONS_PER_TIER = 5;
const POINTS_PER_TIER = POINTS_PER_DIVISION * DIVISIONS_PER_TIER; // 500
/** Champion 1, 100% — the ladder ceiling. */
const MAX_POINTS =
  (TIERS.length - 1) * POINTS_PER_TIER + (DIVISIONS_PER_TIER - 1) * POINTS_PER_DIVISION + 100;

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
const tierIdx = (tier: string): number => {
  const i = TIERS.indexOf(tier);
  return i < 0 ? 0 : i;
};

/**
 * The scalar for a ladder position. `progressPct` is added verbatim, so a
 * protection carry (e.g. -19) yields a scalar just below the division's base.
 */
export function rankToPoints(pos: RankPosition): number {
  const div = clamp(pos.division, 1, DIVISIONS_PER_TIER);
  return tierIdx(pos.tier) * POINTS_PER_TIER + (DIVISIONS_PER_TIER - div) * POINTS_PER_DIVISION + pos.progressPct;
}

/**
 * Inverse of {@link rankToPoints}, clamped into the valid ladder range. The
 * ceiling is special-cased so the maximum scalar reads as Champion 1 / 100%
 * rather than overflowing into a non-existent ninth tier.
 */
export function pointsToRank(points: number): RankPosition {
  const p = clamp(Math.round(points), 0, MAX_POINTS);
  if (p >= MAX_POINTS) return { tier: TIERS[TIERS.length - 1], division: 1, progressPct: 100 };
  const divIndexGlobal = Math.floor(p / POINTS_PER_DIVISION); // 0..39
  const ti = clamp(Math.floor(divIndexGlobal / DIVISIONS_PER_TIER), 0, TIERS.length - 1);
  const withinTier = divIndexGlobal - ti * DIVISIONS_PER_TIER; // 0..4
  return {
    tier: TIERS[ti],
    division: DIVISIONS_PER_TIER - withinTier, // 5..1
    progressPct: p - divIndexGlobal * POINTS_PER_DIVISION, // 0..99
  };
}
