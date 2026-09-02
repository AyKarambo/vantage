/**
 * Renderer-side mirror of the in-progress match, fed by the `onLiveMatch` push.
 * The Live view and the sidebar's live dot both render from this.
 *
 * Push-only, unlike {@link ./gepStatus}: there is no snapshot pull, because the
 * monitor publishes a phase change the instant it happens and a match that is
 * already running keeps ticking, so a window opened mid-match is at most one
 * throttle window behind. Adding a pull would mean a second contract method
 * whose answer arrives later than the push it races.
 */
import type { LiveMatchPayload } from '../../src/shared/contract';
import { bridge } from './bridge';

type Listener = (s: LiveMatchPayload | null) => void;

let current: LiveMatchPayload | null = null;
const listeners = new Set<Listener>();
let started = false;

/** Start the feed (idempotent). Call once from the shell. */
export function initLiveMatch(): void {
  if (started) return;
  started = true;
  bridge.onLiveMatch((s) => {
    current = s;
    for (const fn of listeners) fn(current);
  });
}

/** The current live match, or null before the first push of the session. */
export function getLiveMatch(): LiveMatchPayload | null {
  return current;
}

export function subscribeLiveMatch(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
