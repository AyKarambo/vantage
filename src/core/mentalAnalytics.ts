import { winLoss, type GameRecord } from './analytics';
import { isAbusiveComms, isPositiveComms } from './comms';
import { leaverFlags, mergeLeaver } from './leaver';
import { isTilted } from './mental';

/**
 * Mental-impact analytics (issue #70): what tilt, comms tone, toxic teammates
 * and leavers cost in winrate, and how tilt behaves over time and within a
 * sitting. Everything OR-merges the quick-log self-report with the
 * Review-screen flags, like {@link ./mental mentalSummary}. Pure and I/O-free,
 * like the rest of `core/`.
 */

/**
 * Decided samples (or, for the performance split, rated games) a side needs
 * before a delta is worth claiming — the tilt-tax gating convention. The
 * renderer and the derivations here share this single constant so "gated like
 * tilt tax" stays true everywhere.
 */
export const COST_MIN_SAMPLE = 5;

/** One side of a winrate split: decided games (draws excluded) and their winrate. */
export interface WinrateSide {
  /** Wins / decided (0..1); a 0/0 side reads 0 — gate on `decided`, never trust it raw. */
  winrate: number;
  /** Wins + losses behind the winrate (draws never count). */
  decided: number;
}

/** One side of a self-rated-performance split. */
export interface RatedSide {
  /** Mean 0–100 self-rating over the rated games, 1 decimal; null when none are rated. */
  avg: number | null;
  /** Rated games behind the average. */
  rated: number;
}

/**
 * The "What it costs you" card's payload: winrate splits along each mental
 * axis, plus the self-rated-performance split that explains the tilt tax.
 * Sides are raw (winrate + sample); the consumer applies the
 * {@link COST_MIN_SAMPLE} gate.
 */
export interface MentalCosts {
  /** The tilt tax: winrate calm vs tilted. */
  tilt: { calm: WinrateSide; tilted: WinrateSide };
  /**
   * The comms tax: winrate with positive vs abusive comms. A game whose two
   * sources disagree (one says positive, the other abusive) counts as
   * positive; games with neither tone sit in neither side.
   */
  comms: { positive: WinrateSide; abusive: WinrateSide };
  /** The toxic-teammates tax: winrate without vs with toxic mates. */
  toxic: { without: WinrateSide; with: WinrateSide };
  /**
   * The leaver swing, three-way: my-team leaver vs no leaver vs enemy leaver.
   * A game with leavers on BOTH teams counts on the my-team (cost) side;
   * `enemy` is enemy-only.
   */
  leaver: { none: WinrateSide; myTeam: WinrateSide; enemy: WinrateSide };
  /** Mean self-rated performance calm vs tilted — the mechanism behind the tilt tax. */
  performance: { calm: RatedSide; tilted: RatedSide };
}

/** Compute the mental-cost splits over an (already filtered) game set. */
export function mentalCosts(games: GameRecord[]): MentalCosts {
  const calm: GameRecord[] = [];
  const tilted: GameRecord[] = [];
  const positive: GameRecord[] = [];
  const abusive: GameRecord[] = [];
  const toxicWith: GameRecord[] = [];
  const toxicWithout: GameRecord[] = [];
  const leaverNone: GameRecord[] = [];
  const leaverMy: GameRecord[] = [];
  const leaverEnemy: GameRecord[] = [];

  for (const g of games) {
    const m = g.mental ?? {};
    const r = g.review?.flags ?? {};
    (isTilted(g) ? tilted : calm).push(g);
    if (isPositiveComms(m) || isPositiveComms(r)) positive.push(g);
    else if (isAbusiveComms(m) || isAbusiveComms(r)) abusive.push(g);
    (m.toxicMates || r.toxicMates ? toxicWith : toxicWithout).push(g);
    const lv = mergeLeaver(leaverFlags(m), leaverFlags(r));
    (lv.myTeam ? leaverMy : lv.enemyTeam ? leaverEnemy : leaverNone).push(g);
  }

  return {
    tilt: { calm: winrateSide(calm), tilted: winrateSide(tilted) },
    comms: { positive: winrateSide(positive), abusive: winrateSide(abusive) },
    toxic: { without: winrateSide(toxicWithout), with: winrateSide(toxicWith) },
    leaver: { none: winrateSide(leaverNone), myTeam: winrateSide(leaverMy), enemy: winrateSide(leaverEnemy) },
    performance: { calm: ratedSide(calm), tilted: ratedSide(tilted) },
  };
}

function winrateSide(games: GameRecord[]): WinrateSide {
  const wl = winLoss(games);
  return { winrate: wl.winrate, decided: wl.wins + wl.losses };
}

function ratedSide(games: GameRecord[]): RatedSide {
  const rated = games.filter((g) => typeof g.performance === 'number');
  return {
    avg: rated.length ? round1(rated.reduce((a, g) => a + (g.performance ?? 0), 0) / rated.length) : null,
    rated: rated.length,
  };
}

const round1 = (n: number): number => Math.round(n * 10) / 10;
