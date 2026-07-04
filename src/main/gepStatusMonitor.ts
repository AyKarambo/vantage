/**
 * Watches the GEP feed's *liveness* and publishes the four-state connection
 * status (no-game / connected / live / stale) whenever it changes. The state
 * rules live in `core/gepHealth` (pure, tested); this edge folds the raw
 * signals, runs the staleness clock, and fans changes out to the dashboard
 * push channel, the tray icon, and the release log.
 */
import {
  INITIAL_GEP_TRACK, gepHealth, reduceGepSignal,
  type GepHealthState, type GepHealthTrack,
} from '../core/gepHealth';
import { isMatchEndMessage, isMatchStartMessage } from '../core/matchAggregator';
import type { GepMessage } from '../core/model';
import type { GepStatusPayload } from '../shared/contract';

/** How often the staleness deadline is re-checked between events. */
const TICK_MS = 15_000;

export interface GepStatusMonitorDeps {
  sensor: 'gep' | 'counterwatch';
  /** Sink for state-transition log lines. */
  log(scope: string, message: string, fields?: Record<string, string | number | boolean>): void;
  /** Fan-out on every state change (dashboard push + tray icon). */
  publish(payload: GepStatusPayload): void;
  now?(): number;
}

export interface GepStatusMonitor {
  /** Attach/detach transitions from the GEP status feed (idempotent). */
  setAttached(attached: boolean): void;
  /** Surface the feed's last error string in the payload. */
  setLastError(err: string | undefined): void;
  /** Every normalized GEP message — classifies match boundaries itself. */
  message(msg: GepMessage): void;
  current(): GepStatusPayload;
  /** Start the staleness clock; returns a stop function. */
  start(): () => void;
}

export function createGepStatusMonitor(deps: GepStatusMonitorDeps): GepStatusMonitor {
  const now = deps.now ?? (() => Date.now());
  let track: GepHealthTrack = INITIAL_GEP_TRACK;
  let attached = false;
  let lastError: string | undefined;
  let published: GepHealthState | null = null;

  const payload = (): GepStatusPayload => ({
    state: gepHealth(track, now()),
    sensor: deps.sensor,
    attachedAt: track.attachedAt,
    lastEventAt: track.lastEventAt,
    eventsThisSession: track.eventsThisSession,
    matchInProgress: track.matchInProgress,
    ...(lastError ? { lastError } : {}),
  });

  const evaluate = (): void => {
    const state = gepHealth(track, now());
    if (state === published) return;
    deps.log('status', `feed ${published ?? 'init'} → ${state}`, {
      matchInProgress: track.matchInProgress,
      eventsThisSession: track.eventsThisSession,
      ...(track.lastEventAt ? { sinceLastEventMs: now() - track.lastEventAt } : {}),
    });
    published = state;
    deps.publish(payload());
  };

  return {
    setAttached(next) {
      if (next === attached) return;
      attached = next;
      track = reduceGepSignal(track, { kind: next ? 'attached' : 'detached' }, now());
      evaluate();
    },
    setLastError(err) {
      lastError = err;
    },
    message(msg) {
      const kind = isMatchStartMessage(msg) ? 'match-start'
        : isMatchEndMessage(msg) ? 'match-end'
        : 'event';
      track = reduceGepSignal(track, { kind }, now());
      evaluate();
    },
    current: payload,
    start() {
      // Only staleness can change without a signal; the tick exists to catch
      // the 60s deadline. Detection latency is bounded by TICK_MS.
      const timer = setInterval(evaluate, TICK_MS);
      timer.unref?.();
      return () => clearInterval(timer);
    },
  };
}
