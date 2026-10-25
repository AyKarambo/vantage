import { asBool, asNumber, asObject } from './matchAggregator/gepValues';

/**
 * When the match clock runs inside a GEP round — shared by the live board and
 * the recorded match length so the two can't disagree.
 *
 * GEP's round change is ~1 s (`round_end` → next `round_start`), but the hero
 * select / setup that follows lives INSIDE the new round: real captures
 * (2026-10-25) show 37–53 s of silence after every later `round_start`, ended by
 * a roster burst in which the opponents' heroes appear for the first time — the
 * moment the doors open. The clock stays stopped until then. The FIRST round of
 * a match is different: its hero select falls before `round_start` (the 28 s
 * after `match_start`), so its clock starts at `round_start` as before.
 *
 * Pure and Electron-free (guardrail #3).
 */

/**
 * How long after a later round's `round_start` the clock starts anyway when no
 * reveal arrives (a feed without roster, a lost burst) — above every reveal in
 * the captures, so the clock can't stay stopped for a whole round.
 */
export const DOORS_FALLBACK_MS = 75_000;

/** The round fields the clock reads. */
export interface ClockRound {
  startedAt: number;
  endedAt?: number;
  /** The round began behind a round change: the clock waits for the doors. */
  waitsForDoors?: boolean;
  /** ms epoch the opponents' heroes first appeared in this round (doors open). */
  doorsAt?: number;
}

/** ms epoch the clock starts in `round` — its start, or the doors for a later round. */
export function clockStartOf(round: ClockRound): number {
  if (!round.waitsForDoors) return round.startedAt;
  return round.doorsAt ?? round.startedAt + DOORS_FALLBACK_MS;
}

/** Clock time a CLOSED round contributes, in ms (0 for one that ended before its doors opened). */
export function roundClockMs(round: ClockRound & { endedAt: number }): number {
  return Math.max(0, round.endedAt - clockStartOf(round));
}

/**
 * True when a raw `roster_N` value shows an OPPONENT with a hero — GEP keeps
 * the opponents' `hero_id` at 0 through hero select and setup and reports it
 * only once the doors open. The documented `is_teammate` flag decides the side;
 * without it, a `team` other than the local player's.
 */
export function revealsOpponentHero(value: unknown, localTeam?: number): boolean {
  const obj = asObject(value);
  if (!obj) return false;
  const heroId = asNumber(obj.hero_id);
  if (heroId === undefined || heroId <= 0) return false;
  if (asBool(obj.is_local)) return false;
  const teammate = asBool(obj.is_teammate);
  if (teammate !== undefined) return !teammate;
  const team = asNumber(obj.team);
  return team !== undefined && localTeam !== undefined && team !== localTeam;
}

/** Mark the open round's doors as open when `value` reveals an opponent. Same reference when nothing changed. */
export function noteDoors<R extends ClockRound>(round: R | undefined, value: unknown, now: number, localTeam?: number): R | undefined {
  if (!round || round.endedAt !== undefined || !round.waitsForDoors || round.doorsAt !== undefined) return round;
  return revealsOpponentHero(value, localTeam) ? { ...round, doorsAt: now } : round;
}
