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
import type { ServiceStatus } from '../core/gepService';
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
  /** Overwolf's service (outage) status from the status feed; null = not yet polled. */
  setServiceStatus(status: ServiceStatus | null): void;
  /** The loaded GEP package version (from the package manager). */
  setGepPackageVersion(version: string | undefined): void;
  /** Whether a fixed GEP package is staged and awaiting a restart. */
  setUpdateStaged(staged: boolean): void;
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
  let serviceStatus: ServiceStatus | null = null;
  let gepPackageVersion: string | undefined;
  let updateStaged = false;
  // Composite dedup key: publish whenever ANY visible dimension changes, not just
  // the connection state — service status, staged update and package version all
  // ride the same payload, so a change in any of them must fan out.
  let publishedKey: string | null = null;
  let publishedState: GepHealthState | null = null;

  const payload = (): GepStatusPayload => ({
    state: gepHealth(track, now()),
    sensor: deps.sensor,
    attachedAt: track.attachedAt,
    lastEventAt: track.lastEventAt,
    eventsThisSession: track.eventsThisSession,
    matchInProgress: track.matchInProgress,
    ...(lastError ? { lastError } : {}),
    ...(serviceStatus ? { serviceStatus: serviceStatus.level } : {}),
    ...(serviceStatus?.message ? { serviceMessage: serviceStatus.message } : {}),
    ...(gepPackageVersion ? { gepPackageVersion } : {}),
    ...(updateStaged ? { updateStaged: true } : {}),
  });

  const dedupKey = (p: GepStatusPayload): string =>
    `${p.state}|${p.serviceStatus ?? '-'}|${p.serviceMessage ?? '-'}|${p.updateStaged ? 1 : 0}|${p.gepPackageVersion ?? '-'}`;

  const evaluate = (): void => {
    const p = payload();
    const key = dedupKey(p);
    if (key === publishedKey) return;
    deps.log('status', `feed ${publishedState ?? 'init'} → ${p.state}`, {
      matchInProgress: track.matchInProgress,
      eventsThisSession: track.eventsThisSession,
      ...(p.serviceStatus ? { service: p.serviceStatus } : {}),
      ...(p.updateStaged ? { updateStaged: true } : {}),
      ...(track.lastEventAt ? { sinceLastEventMs: now() - track.lastEventAt } : {}),
    });
    publishedKey = key;
    publishedState = p.state;
    deps.publish(p);
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
    setServiceStatus(next) {
      serviceStatus = next;
      evaluate();
    },
    setGepPackageVersion(version) {
      gepPackageVersion = version;
      evaluate();
    },
    setUpdateStaged(next) {
      updateStaged = next;
      evaluate();
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
