/**
 * The dev-mode authentication status payload: whether a dev-mode launch was
 * attempted, and the runtime-verified outcome of that attempt. Pushed on every
 * state change and pulled once on renderer mount/focus.
 */
import type { DevModeAuthOutcome } from '../../core/devMode';

export type { DevModeAuthOutcome };

export interface DevModeAuthStatusPayload {
  /** Was a dev-mode launch attempted this run (toggle-on or --force)? False ⇒ badge stays hidden, `outcome` is meaningless. */
  attempted: boolean;
  /** Settles at most once per process run; never changes again afterward. */
  outcome: DevModeAuthOutcome;
  /** Populated once outcome !== 'pending' — same text sent to the terminal log. */
  detail?: string;
}
