import type { GameRecord } from '../analytics';
import type { SessionCheckIn } from '../checkIn';
import type { CoachingSettings } from '../coachingSettings';

/**
 * The sitting / check-in / break context every practice read (issue #321)
 * shares. Sittings follow the Mental screen's 90-minute convention (the same
 * gap {@link ../mentalAnalytics tiltBySessionPosition} walks), always over the
 * UNFILTERED history so a filter scopes which games aggregate without
 * renumbering anyone's sittings.
 */

/** Gap (minutes) between match ends that starts a new sitting — Mental's convention. */
export const PRACTICE_SITTING_GAP_MINUTES = 90;

/** A game with no logged duration is assumed this long when estimating when it started. */
const DEFAULT_GAME_MINUTES = 12;

/** Every sitting in chronological order, each its games oldest first. A strictly larger gap than `gapMinutes` starts a new one. */
export function sittingsOf(games: readonly GameRecord[], gapMinutes = PRACTICE_SITTING_GAP_MINUTES): GameRecord[][] {
  const sorted = [...games].sort((a, b) => a.timestamp - b.timestamp);
  const gapMs = gapMinutes * 60_000;
  const out: GameRecord[][] = [];
  let current: GameRecord[] = [];
  for (const g of sorted) {
    const prev = current[current.length - 1];
    if (prev && g.timestamp - prev.timestamp > gapMs) {
      out.push(current);
      current = [];
    }
    current.push(g);
  }
  if (current.length) out.push(current);
  return out;
}

/**
 * The check-in that belongs to a sitting: the LATEST one at or before its
 * first game, still within the gap — the same matching rule
 * {@link ../mentalAnalytics tiltByCheckIn} uses, except that here it applies
 * to every game of the sitting rather than only game 1. `checkIns` must be
 * sorted oldest first.
 */
export function checkInForSitting(
  first: GameRecord,
  sortedCheckIns: readonly SessionCheckIn[],
  gapMinutes = PRACTICE_SITTING_GAP_MINUTES,
): SessionCheckIn | undefined {
  const gapMs = gapMinutes * 60_000;
  let found: SessionCheckIn | undefined;
  for (const c of sortedCheckIns) {
    if (c.at > first.timestamp) break;
    if (first.timestamp - c.at <= gapMs) found = c;
  }
  return found;
}

/**
 * Whether the gap BEFORE `game` reads as a break under automatic detection:
 * from the previous game's end to this game's estimated start (its end minus
 * its duration) is at least `breakMinutes`. A sitting's first game has no gap
 * to read (`prev` null → false). Ignores the player's own mark — see
 * {@link breakBefore} for the effective read.
 */
export function autoBreakBefore(game: GameRecord, prev: GameRecord | null, settings: CoachingSettings): boolean {
  if (settings.breakDetection !== 'auto' || !prev) return false;
  const start = game.timestamp - (game.durationMinutes ?? DEFAULT_GAME_MINUTES) * 60_000;
  return start - prev.timestamp >= settings.breakMinutes * 60_000;
}

/**
 * The effective break read for the gap before `game`: the player's own mark
 * on the review wins (`true` adds a break, `false` removes an auto-detected
 * one); otherwise automatic detection, or no break at all in manual mode.
 */
export function breakBefore(game: GameRecord, prev: GameRecord | null, settings: CoachingSettings): boolean {
  const mark = game.review?.breakBefore;
  if (mark !== undefined) return prev !== null && mark;
  return autoBreakBefore(game, prev, settings);
}

/** One game's place in its sitting, as the practice reads see it. */
export interface GameContext {
  /** 1-based game number within the sitting. */
  position: number;
  /** A break happened somewhere earlier in this sitting (before this game). */
  afterBreak: boolean;
  /** Games played in a row without a break, this one included (resets after a break). */
  run: number;
  /** The check-in that preceded this game's sitting, if any. */
  checkIn?: SessionCheckIn;
}

/** {@link GameContext} for every game in `all`, keyed by matchId. */
export function gameContexts(
  all: readonly GameRecord[],
  checkIns: readonly SessionCheckIn[],
  settings: CoachingSettings,
  gapMinutes = PRACTICE_SITTING_GAP_MINUTES,
): Map<string, GameContext> {
  const sortedCheckIns = [...checkIns].sort((a, b) => a.at - b.at);
  const out = new Map<string, GameContext>();
  for (const sitting of sittingsOf(all, gapMinutes)) {
    const checkIn = checkInForSitting(sitting[0], sortedCheckIns, gapMinutes);
    let afterBreak = false;
    let run = 0;
    sitting.forEach((g, i) => {
      if (breakBefore(g, i ? sitting[i - 1] : null, settings)) {
        afterBreak = true;
        run = 0;
      }
      run += 1;
      out.set(g.matchId, { position: i + 1, afterBreak, run, ...(checkIn ? { checkIn } : {}) });
    });
  }
  return out;
}
