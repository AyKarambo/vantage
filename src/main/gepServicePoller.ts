import type { ServiceStatus } from '../core/gepService';

/**
 * Polls Overwolf's GEP service-status feed on an adaptive cadence and pushes each
 * reading to the status monitor. Self-scheduling (setTimeout, not setInterval) so
 * the interval can adapt per cycle: slow while healthy, faster while degraded (to
 * catch recovery quickly), exponential backoff on failure. The timer is `unref`'d
 * so it never keeps the process alive. On any fetch error it reports `unknown` —
 * the app makes NO outage claim when the feed can't be read (guardrail).
 */

const HEALTHY_MS = 5 * 60_000; // relaxed cadence when all is well
const DEGRADED_MS = 90_000; // poll faster while degraded so recovery is caught quickly
const BACKOFF_START_MS = 30_000;
const BACKOFF_MAX_MS = 15 * 60_000;
const INITIAL_DELAY_MS = 2_000; // let the app settle before the first poll

export interface GepServicePollerDeps {
  /** The status fetch edge (throws on transport failure). */
  fetchStatus(): Promise<ServiceStatus>;
  /** Sink for each reading — typically the status monitor's setServiceStatus. */
  onStatus(status: ServiceStatus): void;
  log(scope: string, message: string, fields?: Record<string, string | number | boolean>): void;
}

export interface GepServicePoller {
  /** Begin polling; returns a stop function. */
  start(): () => void;
}

export function createGepServicePoller(deps: GepServicePollerDeps): GepServicePoller {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let backoff = 0;

  const schedule = (ms: number): void => {
    if (stopped) return;
    timer = setTimeout(() => void tick(), ms);
    timer.unref?.();
  };

  const tick = async (): Promise<void> => {
    if (stopped) return;
    try {
      const status = await deps.fetchStatus();
      backoff = 0;
      deps.onStatus(status);
      // Healthy/unknown → relaxed cadence; degraded/down → fast so we notice recovery.
      schedule(status.level === 'degraded' || status.level === 'down' ? DEGRADED_MS : HEALTHY_MS);
    } catch (err) {
      // Feed unreachable — make no outage claim; report 'unknown' and back off.
      deps.onStatus({ level: 'unknown' });
      deps.log('status', `gep status poll failed: ${String((err as { message?: string })?.message ?? err)}`);
      backoff = backoff ? Math.min(backoff * 2, BACKOFF_MAX_MS) : BACKOFF_START_MS;
      schedule(backoff);
    }
  };

  return {
    start() {
      stopped = false;
      schedule(INITIAL_DELAY_MS);
      return () => {
        stopped = true;
        if (timer) clearTimeout(timer);
      };
    },
  };
}
