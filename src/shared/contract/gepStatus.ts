/**
 * The live connection/data-flow status payload: what the status-bar indicator,
 * its details popover, and the tray icon render. Pushed on every state change
 * and pulled once on renderer mount/focus.
 */
import type { GepHealthState } from '../../core/gepHealth';
import type { ServiceStatusLevel } from '../../core/gepService';

export type { GepHealthState } from '../../core/gepHealth';
export type { ServiceStatusLevel } from '../../core/gepService';

export interface GepStatusPayload {
  state: GepHealthState;
  /** Which sensor feeds the app; only 'gep' can ever be connected/live. */
  sensor: 'gep' | 'counterwatch';
  attachedAt: number | null;
  lastEventAt: number | null;
  eventsThisSession: number;
  matchInProgress: boolean;
  /** Pass-through of the feed's last error (e.g. elevation required). */
  lastError?: string;
  /**
   * Overwolf's *service* status for Overwatch's game events (from their public
   * status feed) — orthogonal to {@link state} (our local connection). Absent
   * until the first poll resolves; `'unknown'` when the feed can't be read, in
   * which case the app makes NO outage claim. Drives the outage banner.
   */
  serviceStatus?: ServiceStatusLevel;
  /** Overwolf's `maintenance_msg` when the service isn't `ok`. */
  serviceMessage?: string;
  /** The loaded GEP package version (e.g. '309.0.0'); changes when Overwolf ships a fix. */
  gepPackageVersion?: string;
  /** A fixed GEP package is staged and needs a restart to apply (drives the "restart to apply" prompt). */
  updateStaged?: boolean;
}
