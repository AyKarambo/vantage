/**
 * The truthful connection/data-flow model behind the live status indicator.
 * "Attached" and "alive" are deliberately distinct states: the feed is only
 * ever shown as receiving data when events demonstrably arrived, and a silent
 * feed during a running match surfaces as an explicit warning ('stale') —
 * the silent-failure case the indicator exists to catch.
 *
 * Pure and Electron-free (no timers, `now` is always passed in) — the main
 * process folds raw GEP signals through `reduceGepSignal` and derives the
 * displayed state with `gepHealth`, mirroring the `breakReminder` pattern.
 */

export type GepHealthState = 'no-game' | 'connected' | 'live' | 'stale';

/** Mid-match silence before the feed is flagged as stale. */
export const STALE_AFTER_MS = 60_000;

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
 * - attached, match running, silence ≥ threshold → 'stale' (the warning)
 * - attached, match running, events recent → 'live'
 * - attached, no match in progress → 'connected' (never claims data flows)
 */
export function gepHealth(t: GepHealthTrack, now: number): GepHealthState {
  if (t.attachedAt === null) return 'no-game';
  if (!t.matchInProgress) return 'connected';
  const silence = now - (t.lastEventAt ?? t.attachedAt);
  return silence >= STALE_AFTER_MS ? 'stale' : 'live';
}
