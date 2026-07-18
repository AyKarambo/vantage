/**
 * Latches the dev-mode auth outcome and publishes it once. Unlike
 * `gepStatusMonitor.ts`'s continuous feed-liveness tracking — which
 * re-evaluates a rolling state on every signal and dedups against the
 * last-published key — dev-mode auth is decided *once*, early in process
 * startup, and never changes again for the rest of the run. So there's no
 * dedup key, no staleness clock, no `start()`/tick loop: just a one-shot
 * latch that the first `resolve()` call wins, plus an optional timeout guard
 * for the case where neither a `ready` nor a `failed-to-initialize` event
 * ever arrives.
 */
import type { DevModeAuthOutcome, DevModeAuthStatusPayload } from '../shared/contract';

export interface DevModeAuthMonitorDeps {
  /** Whether a dev-mode launch was attempted this run (from core/devMode.ts's computeDevModeAttempted). */
  attempted: boolean;
  log(scope: string, message: string, fields?: unknown): void;
  publish(payload: DevModeAuthStatusPayload): void;
}

export interface DevModeAuthMonitor {
  /**
   * Idempotent — the FIRST call wins; every subsequent call (whether from a
   * late event or a now-pointless timeout) is a silent no-op. Also cancels
   * any timer armed by `armTimeout()`.
   */
  resolve(outcome: 'confirmed' | 'failed', detail: string): void;
  /**
   * Arms a real `setTimeout` that calls `resolve('failed', ...)` with a
   * timeout-detail string if nothing else has resolved by then. No-ops
   * immediately if the monitor is already resolved when called (defensive —
   * shouldn't happen given call-site discipline, but must not throw or
   * double-arm).
   */
  armTimeout(ms: number): void;
  /** Current snapshot as a DevModeAuthStatusPayload. */
  current(): DevModeAuthStatusPayload;
}

export function createDevModeAuthMonitor(deps: DevModeAuthMonitorDeps): DevModeAuthMonitor {
  let outcome: DevModeAuthOutcome = 'pending';
  let detail: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const payload = (): DevModeAuthStatusPayload => ({
    attempted: deps.attempted,
    outcome,
    detail,
  });

  const resolve = (next: 'confirmed' | 'failed', nextDetail: string): void => {
    if (outcome !== 'pending') return;
    outcome = next;
    detail = nextDetail;
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    deps.log('devModeAuth', `dev-mode auth ${next}: ${nextDetail}`);
    deps.publish(payload());
  };

  return {
    resolve,
    armTimeout(ms) {
      if (outcome !== 'pending') return;
      timer = setTimeout(() => {
        resolve('failed', `timed out after ${ms / 1000}s waiting to confirm Dev Mode authentication`);
      }, ms);
      timer.unref?.();
    },
    current: payload,
  };
}
