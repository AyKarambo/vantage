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

/**
 * The parts a rank surface renders INSTEAD OF {@link RankParts} while a
 * track's placement run is open (a `DashboardData.placements` entry with
 * `completed === false`). Overwatch itself shows no ±%, no rank-protection
 * shield and no ladder-movement arrow during placements — the player doesn't
 * have a rank yet, only a match count and, once one placement match has
 * posted, a same-screen *prediction* the game itself marks as unofficial.
 * `PlacementParts` mirrors that on purpose: there is no shield/bufferPctText/
 * movementDir equivalent here, so a surface branches on "is this track's run
 * open" and picks one shape or the other rather than layering placement text
 * onto `rankParts`'s output.
 */
export interface PlacementParts {
  /** "Placements 4/10" — always present, even before any match has a prediction. */
  counter: string;
  /** "Platinum 4 (predicted)" — present only once a placement match has posted a prediction. */
  predictionLabel?: string;
  /**
   * "confirm your rank" — present only once the run's matches are all
   * counted but the player hasn't confirmed the real rank Overwatch
   * revealed yet (mirrors the contract's `awaitingRank`). Mutually
   * exclusive with `predictionLabel`: the run is over, so the in-run guess
   * is stale and showing it would present it as the outcome.
   */
  awaitingLabel?: string;
}

/**
 * Decompose an open placement run into the shared display parts; see
 * {@link PlacementParts}. `awaitingRank` overrides the prediction: once the
 * run has counted out and is only waiting on the player to confirm the
 * revealed rank, `awaitingLabel` is set and `predictionLabel` is omitted
 * even when a `prediction` is still passed in, so a surface can't be made to
 * show the in-run guess as if it were the confirmed result.
 */
export function placementParts(
  counted: number,
  target: number,
  prediction?: { tier: string; division: number },
  awaitingRank = false,
): PlacementParts {
  const parts: PlacementParts = { counter: `Placements ${counted}/${target}` };
  if (awaitingRank) {
    parts.awaitingLabel = 'confirm your rank';
  } else if (prediction) {
    parts.predictionLabel = `${rankLabelOf(prediction.tier, prediction.division)} (predicted)`;
  }
  return parts;
}

/**
 * The account-switcher popover shows one rank per account; an open
 * placement run makes that number provisional (or, once awaiting, correct
 * but unconfirmed), so this rolls an account's open runs into one short
 * suffix appended after its real rank rather than letting the switcher show
 * a rank the header itself no longer trusts (AC8). Completed runs are
 * ignored — they already resolved to a real rank and need no suffix.
 * Structural param, not `PlacementRunSummary`: `src/core/` must not depend
 * on `src/shared/contract/` (the contract imports core, not the reverse),
 * and this only needs a few of that DTO's fields.
 */
export function accountPlacementNote(
  runs: readonly { counted: number; target: number; completed: boolean; awaitingRank: boolean }[],
): string | undefined {
  const open = runs.filter((r) => !r.completed);
  if (open.length === 0) return undefined;
  if (open.some((r) => r.awaitingRank)) return 'confirm your rank';
  if (open.length === 1) return `placements ${open[0].counted}/${open[0].target}`;
  return `${open.length} tracks in placements`;
}
