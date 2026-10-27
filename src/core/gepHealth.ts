/**
 * The truthful connection/data-flow model behind the live status indicator.
 * "Attached" and "alive" are deliberately distinct states: the feed is only
 * ever shown as receiving data when events demonstrably arrived, and a silent
 * feed during a running match surfaces as an explicit warning ('stale') —
 * the silent-failure case the indicator exists to catch. A feed that has sent
 * nothing at all since attaching surfaces as 'silent' (see SILENT_AFTER_ATTACH_MS).
 *
 * Pure and Electron-free (no timers, `now` is always passed in) — the main
 * process folds raw GEP signals through `reduceGepSignal` and derives the
 * displayed state with `gepHealth`, mirroring the `breakReminder` pattern.
 */

import type { GepNotification } from './gepService';
import { isMatchEndMessage, isMatchInProgressMessage, isMatchStartMessage } from './matchAggregator';
import type { GepMessage } from './model';

export type GepHealthState = 'no-game' | 'connected' | 'silent' | 'live' | 'stale';

/** Mid-match silence before the feed is flagged as stale. */
export const STALE_AFTER_MS = 60_000;

/**
 * Time after attaching with not one event before the feed is flagged as
 * 'silent'. A healthy feed speaks within seconds: attaching to a running game
 * replays its state in ~0.1s, and a fresh launch reports `party_player_count`
 * and `battle_tag` once the main menu loads (~6s in the 2026-10-27 logs). A
 * zero-event attach is GEP's game plugin failing to load ('start-error' in
 * Overwolf's gep.log): GEP still reports the game detected and the features
 * armed, so without this the indicator read "Connected" for a dead feed
 * (2026-10-26 and 2026-10-27, each fixed only by restarting Vantage).
 */
export const SILENT_AFTER_ATTACH_MS = 120_000;

/** Everything the health derivation needs, folded from the raw feed signals. */
export interface GepHealthTrack {
  /** When GEP attached to the running game; null = not attached. */
  attachedAt: number | null;
  lastEventAt: number | null;
  eventsThisSession: number;
  matchInProgress: boolean;
}

export const INITIAL_GEP_TRACK: GepHealthTrack = {
  attachedAt: null,
  lastEventAt: null,
  eventsThisSession: 0,
  matchInProgress: false,
};

export type GepSignal =
  | { kind: 'attached' }
  | { kind: 'detached' }
  | { kind: 'event' }
  | { kind: 'match-start' }
  | { kind: 'match-end' };

/**
 * Classify one GEP message as a feed signal. `game_state = match_in_progress`
 * counts as a match start too: when the app (or GEP) attaches to a match
 * already running, the `match_start` event fired before anyone was listening,
 * and without this the indicator would claim "connected" — no match — for the
 * whole match while its events stream in. In a normal match it lands right
 * after `match_start`, where re-marking the match as running changes nothing.
 */
export function gepSignalOf(msg: GepMessage): 'match-start' | 'match-end' | 'event' {
  if (isMatchStartMessage(msg) || isMatchInProgressMessage(msg)) return 'match-start';
  if (isMatchEndMessage(msg)) return 'match-end';
  return 'event';
}

/** Fold one raw feed signal into the track. Match boundaries are events too. */
export function reduceGepSignal(t: GepHealthTrack, signal: GepSignal, now: number): GepHealthTrack {
  switch (signal.kind) {
    case 'attached':
      return { ...INITIAL_GEP_TRACK, attachedAt: now };
    case 'detached':
      return { ...INITIAL_GEP_TRACK };
    case 'event':
      return { ...t, lastEventAt: now, eventsThisSession: t.eventsThisSession + 1 };
    case 'match-start':
      return { ...t, matchInProgress: true, lastEventAt: now, eventsThisSession: t.eventsThisSession + 1 };
    case 'match-end':
      return { ...t, matchInProgress: false, lastEventAt: now, eventsThisSession: t.eventsThisSession + 1 };
  }
}

/**
 * Derive the displayed state:
 * - not attached → 'no-game'
 * - attached, zero events for ≥ SILENT_AFTER_ATTACH_MS → 'silent' (dead feed)
 * - attached, match running, silence ≥ threshold → 'stale' (the warning)
 * - attached, match running, events recent → 'live'
 * - attached, no match in progress → 'connected' (never claims data flows)
 */
export function gepHealth(t: GepHealthTrack, now: number): GepHealthState {
  if (t.attachedAt === null) return 'no-game';
  if (t.eventsThisSession === 0 && now - t.attachedAt >= SILENT_AFTER_ATTACH_MS) return 'silent';
  if (!t.matchInProgress) return 'connected';
  const silence = now - (t.lastEventAt ?? t.attachedAt);
  return silence >= STALE_AFTER_MS ? 'stale' : 'live';
}

/**
 * One notification when the feed turns 'silent'. The banner carries the state
 * in the window; this reaches a user who is in the game, not looking at it.
 * Staying silent, or recovering, notifies nothing.
 */
export function decideSilentNotification(
  prev: GepHealthState | null,
  next: GepHealthState,
): GepNotification | null {
  if (prev === 'silent' || next !== 'silent') return null;
  return {
    title: 'Vantage gets no game data',
    body: 'Overwatch was detected, but Overwolf has sent no game events since. '
      + 'Restart Vantage to reconnect. Overwatch can stay open.',
  };
}
