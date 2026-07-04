/**
 * The live connection/data-flow status payload: what the status-bar indicator,
 * its details popover, and the tray icon render. Pushed on every state change
 * and pulled once on renderer mount/focus.
 */
import type { GepHealthState } from '../../core/gepHealth';

export type { GepHealthState } from '../../core/gepHealth';

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
}
