/**
 * The single, shared rank renderer — pure structured *parts* that every rank
 * surface (sidebar, Overview KPI, Settings pills, match-detail, switcher popover)
 * composes into its own layout, so protection and progress read identically
 * everywhere. Pure and Electron-free: it takes plain numbers and returns strings,
 * so both main and the renderer can use it and it stays unit-testable.
 */

/** "Gold 3", "Master 2" — the tier + division label, one source of truth. */
export const rankLabelOf = (tier: string, division: number): string => `${tier} ${division}`;

/** A rank's anchor→now movement direction on the Overview KPI. */
export type RankMovementDir = 'up' | 'down' | 'neutral';

/**
 * A net move within ±this many ladder %-points of the anchor reads as neutral
 * (no arrow / flat). The ladder scale is 100 %-points per division, so this is a
 * tenth of a division: small enough that any real ranked climb or slide — even a
 * single won or lost match (~±20–25 pts) — still shows a truthful direction, but
 * a net-zero history (and sub-match jitter) never fakes one.
 */
export const RANK_MOVEMENT_NEUTRAL_THRESHOLD = 10;

/** Classify a signed anchor→now ladder %-point movement into a direction. */
export function movementDirOf(movement: number): RankMovementDir {
  if (movement > RANK_MOVEMENT_NEUTRAL_THRESHOLD) return 'up';
  if (movement < -RANK_MOVEMENT_NEUTRAL_THRESHOLD) return 'down';
  return 'neutral';
}

/** The rank inputs a surface has; `movement` is Overview-KPI-only (see {@link RankParts.movementDir}). */
export interface RankPartsInput {
  tier: string;
  division: number;
  /** 0..100 within the division, or negative while `protected` (the buffer). */
  progressPct: number;
  /** In rank protection — holding the division on a negative buffer carry. */
  protected: boolean;
  /**
   * Signed anchor→now movement in ladder %-points (positive = climbed). Supply
   * it ONLY where a movement arrow is wanted (the Overview Rank KPI); omit it
   * everywhere else so {@link RankParts.movementDir} stays undefined and no
   * arrow renders.
   */
  movement?: number;
}

/** The structured pieces each rank surface composes; see {@link rankParts}. */
export interface RankParts {
  /** "Gold 3" / "Master 2". */
  rankLabel: string;
  /** Draw the 🛡 protection shield (true iff `protected`). */
  shield: boolean;
  /** Progress-or-buffer text: "45%" normally, "-11%" while protected. */
  bufferPctText: string;
  /** Movement arrow direction — present only when `movement` was supplied. */
  movementDir?: RankMovementDir;
}

/**
 * Decompose a rank into the shared display parts. `movementDir` is populated
 * only when `movement` is supplied, so a caller that omits it (every surface but
 * the Overview KPI) renders no arrow.
 */
export function rankParts(input: RankPartsInput): RankParts {
  const parts: RankParts = {
    rankLabel: rankLabelOf(input.tier, input.division),
    shield: input.protected,
    bufferPctText: `${Math.round(input.progressPct)}%`,
  };
  if (input.movement !== undefined) parts.movementDir = movementDirOf(input.movement);
  return parts;
}
