import { dayKey, dayPartAt, sessionPositionGroups, winLoss, type GameRecord, type SessionPositionOpts } from './analytics';
import type { SessionCheckIn } from './checkIn';
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

/** One day of the tilt-rate trend. */
export interface TiltTrendPoint {
  /** UTC calendar-day key (YYYY-MM-DD), the shared day-bucketing convention. */
  date: string;
  /** Games played that day. */
  games: number;
  /** Games flagged tilted that day (either source). */
  tilted: number;
  /** tilted / games, 0..1. */
  rate: number;
}

/** Per-day tilt rate over an (already filtered) game set, ascending by date. */
export function tiltTrend(games: GameRecord[]): TiltTrendPoint[] {
  const byDay = new Map<string, { games: number; tilted: number }>();
  for (const g of games) {
    const key = dayKey(g.timestamp);
    const slot = byDay.get(key) ?? { games: 0, tilted: 0 };
    slot.games += 1;
    if (isTilted(g)) slot.tilted += 1;
    byDay.set(key, slot);
  }
  return [...byDay.entries()]
    .map(([date, s]) => ({ date, games: s.games, tilted: s.tilted, rate: s.tilted / s.games }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** The coach's read of the tilt-rate trend; null = not enough data to claim one. */
export type TiltTrendDirection = 'improving' | 'worsening' | 'flat';

/**
 * The tilt-trend verdict (S9) — the direction PLUS the two half-rates it was
 * computed from, so the read can state the actual move ("18% → 29%") instead
 * of just its sign.
 */
export interface TiltTrendRead {
  direction: TiltTrendDirection;
  /** Tilt rate over the earlier half of the range, 0..1. */
  earlyRate: number;
  /** Tilt rate over the recent half of the range, 0..1. */
  lateRate: number;
  /**
   * Flagged (tilted) games across BOTH halves (F6) — the 5-games-per-half
   * gate above only guards the RATE being meaningful; a 5-and-5-game split
   * can still turn on as few as 1 or 2 actual tilt flags, which is not
   * enough sample to hang an imperative "Worsening — shorter sessions" on.
   */
  flaggedGames: number;
}

/** Tilt-rate move (0..1) the halves must differ by before the trend leaves 'flat'. */
const TREND_DEAD_ZONE = 0.03;

/**
 * Compare the tilt rate of the earlier half of the range against the recent
 * half (split by game count, on day boundaries). Both halves must carry at
 * least `minGames` games — else null, no claim. Moves within the 3-point dead
 * zone read as 'flat'; a lower recent rate is 'improving'.
 */
export function tiltTrendDirection(
  points: TiltTrendPoint[],
  minGames: number = COST_MIN_SAMPLE,
): TiltTrendRead | null {
  if (points.length < 2) return null;
  const total = points.reduce((n, p) => n + p.games, 0);
  const early: TiltTrendPoint[] = [];
  const late: TiltTrendPoint[] = [];
  let seen = 0;
  for (const p of points) {
    // Assign by the day's own midpoint, not its start — otherwise a final day
    // that alone carries more than half the range's games gets pulled wholly
    // into `early` (since `seen` before it is still under the midpoint),
    // leaving `late` empty and the read null even on well-sampled ranges.
    (seen + p.games / 2 < total / 2 ? early : late).push(p);
    seen += p.games;
  }
  const a = halfRate(early);
  const b = halfRate(late);
  if (a.games < minGames || b.games < minGames) return null;
  const delta = b.rate - a.rate;
  const direction: TiltTrendDirection = Math.abs(delta) <= TREND_DEAD_ZONE ? 'flat' : delta < 0 ? 'improving' : 'worsening';
  return { direction, earlyRate: a.rate, lateRate: b.rate, flaggedGames: a.tilted + b.tilted };
}

function halfRate(points: TiltTrendPoint[]): { games: number; tilted: number; rate: number } {
  const games = points.reduce((n, p) => n + p.games, 0);
  const tilted = points.reduce((n, p) => n + p.tilted, 0);
  return { games, tilted, rate: games ? tilted / games : 0 };
}

/** Tilt rate at one session position ('1'..'5', '6+'). */
export interface TiltPositionBucket {
  key: string;
  /** Games aggregated at this position. */
  games: number;
  /** How many of them were flagged tilted (either source). */
  tilted: number;
  /** tilted / games, 0..1. */
  rate: number;
}

/**
 * Tilt rate by game number within a sitting — the "stop after game N" read
 * (issue #70 C). Same numbering as the winrate analytic
 * ({@link sessionPositionGroups}): pass the UNFILTERED history plus
 * `opts.include` so filters scope which games aggregate without renumbering
 * anyone's sittings. Empty buckets omitted; order 1 → 6+.
 */
export function tiltBySessionPosition(
  games: GameRecord[],
  opts: SessionPositionOpts = {},
): TiltPositionBucket[] {
  return sessionPositionGroups(games, opts).map(({ key, games: gs }) => {
    const tilted = gs.reduce((n, g) => n + (isTilted(g) ? 1 : 0), 0);
    return { key, games: gs.length, tilted, rate: tilted / gs.length };
  });
}

/** Tilt rate at one time-of-day bucket, or one map, or one after-a-loss/win split — the "when do I tilt" triggers (S9). */
export interface TiltBucket {
  key: string;
  games: number;
  tilted: number;
  rate: number;
}

const toBucket = (key: string, gs: GameRecord[]): TiltBucket => {
  const tilted = gs.reduce((n, g) => n + (isTilted(g) ? 1 : 0), 0);
  return { key, games: gs.length, tilted, rate: gs.length ? tilted / gs.length : 0 };
};

/**
 * Tilt rate on a sitting's FIRST game, split by whichever pre-session
 * check-in (S10 phase 2) immediately preceded it — "does queuing tilted
 * actually cost you?" A check-in "belongs" to a sitting when it's the most
 * recent one at or before that sitting's first game, within `opts.gapMinutes`
 * (same 90-minute default and convention as {@link tiltBySessionPosition}) —
 * a check-in older than that gap is treated as having never been acted on,
 * same as any check-in through the current data model applies to at most the
 * ONE sitting it precedes. Sittings with no qualifying check-in bucket under
 * `'none'`, giving the mood buckets a real baseline to compare against.
 * Numbered over the UNFILTERED history like every sibling here; `opts.include`
 * scopes which of those first games aggregate without renumbering sittings.
 */
export function tiltByCheckIn(
  games: GameRecord[],
  checkIns: readonly SessionCheckIn[],
  opts: SessionPositionOpts = {},
): TiltBucket[] {
  const gapMs = (opts.gapMinutes ?? 90) * 60_000;
  const firstGames = sessionPositionGroups(games, opts).find((b) => b.key === '1')?.games ?? [];
  const sorted = [...checkIns].sort((a, b) => a.at - b.at);
  const buckets = new Map<string, GameRecord[]>();
  for (const g of firstGames) {
    // The LATEST check-in at or before this game, still within the gap window
    // — a walk rather than a single lookup, since an older, still-qualifying
    // check-in must not win over a fresher one closer to kickoff.
    let mood: string | null = null;
    for (const c of sorted) {
      if (c.at > g.timestamp) break;
      if (g.timestamp - c.at <= gapMs) mood = c.mood;
    }
    const key = mood ?? 'none';
    (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(g);
  }
  const order = ['calm', 'edgy', 'tilted', 'none'];
  return order.filter((k) => buckets.has(k)).map((k) => toBucket(k, buckets.get(k)!));
}

/** Same local day-part boundaries {@link ../analytics byTimeOfDay} uses, so "it's evening" never means a different window here. */
const DAY_PART_ORDER = ['Morning', 'Afternoon', 'Evening', 'Night'];

/** Tilt rate by local day-part (S9) — "do I tilt more at night?" Empty buckets omitted; order Morning → Night. */
export function tiltByTimeOfDay(games: GameRecord[]): TiltBucket[] {
  const buckets = new Map<string, GameRecord[]>();
  for (const g of games) {
    const part = dayPartAt(new Date(g.timestamp).getHours());
    (buckets.get(part) ?? buckets.set(part, []).get(part)!).push(g);
  }
  return DAY_PART_ORDER.filter((k) => buckets.has(k)).map((k) => toBucket(k, buckets.get(k)!));
}

/**
 * Tilt rate in games whose PREVIOUS game in the same sitting was a win vs a
 * loss (S9) — "do I tilt more right after a loss?" Reuses the same gap-based
 * sitting boundary {@link sessionPositionGroups} walks (a strictly larger gap
 * starts a new sitting), so a sitting's first game never counts — it has no
 * prior game in the sitting to react to — and a previous DRAW is skipped
 * (neither a win nor a loss to react to). `opts.include` scopes which games
 * are BUCKETED without renumbering anyone's sittings, same convention as
 * {@link tiltBySessionPosition}.
 */
export function tiltAfterResult(games: GameRecord[], opts: SessionPositionOpts = {}): { afterWin: TiltBucket; afterLoss: TiltBucket } {
  const sorted = [...games].sort((a, b) => a.timestamp - b.timestamp);
  const gapMs = (opts.gapMinutes ?? 90) * 60_000;
  const afterWin: GameRecord[] = [];
  const afterLoss: GameRecord[] = [];
  let prev: GameRecord | null = null;
  for (const g of sorted) {
    const sameSitting = prev !== null && g.timestamp - prev.timestamp <= gapMs;
    const included = !opts.include || opts.include.has(g.matchId);
    if (sameSitting && included) {
      if (prev!.result === 'Win') afterWin.push(g);
      else if (prev!.result === 'Loss') afterLoss.push(g);
    }
    prev = g;
  }
  return { afterWin: toBucket('afterWin', afterWin), afterLoss: toBucket('afterLoss', afterLoss) };
}

/** Tilt rate by map, top `min`-game-floor by top-3-by-rate (S9) — "which maps tilt me?" */
export function tiltByMap(games: GameRecord[], min = 3): TiltBucket[] {
  const buckets = new Map<string, GameRecord[]>();
  for (const g of games) (buckets.get(g.map) ?? buckets.set(g.map, []).get(g.map)!).push(g);
  return [...buckets.entries()]
    .map(([key, gs]) => toBucket(key, gs))
    .filter((b) => b.games >= min)
    .sort((a, b) => b.rate - a.rate)
    .slice(0, 3);
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
