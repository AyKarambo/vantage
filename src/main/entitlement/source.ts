import type { EntitlementRecord, EntitlementSourceKind } from '../../core/entitlement';
import type { ProAction, ProActionResult } from '../../shared/contract';

/**
 * Where a Vantage Pro entitlement comes from (spec #337). The real one —
 * Overwolf OIDC login + the Tebex subscription status — lands once Overwolf
 * DevRel issues the client registration (Resolved #15); everything else in the
 * app only ever sees this interface, so plugging it in touches nothing else.
 */
export interface EntitlementSource {
  readonly kind: EntitlementSourceKind;
  /** Ask the source for the current state. `undefined` = it could not answer (offline): keep the cache. */
  check(): Promise<EntitlementRecord | undefined>;
  /** Start a trial, open the checkout, or open subscription management. */
  action(kind: ProAction): Promise<ProActionResult>;
}

/**
 * The release default until the Overwolf source exists: nobody has Pro, and
 * every purchase action says it isn't available yet. Answers `none` (rather
 * than `undefined`) so a stale simulated cache can't outlive a switch back.
 */
export const noneSource: EntitlementSource = {
  kind: 'none',
  check: async () => ({ plan: 'none' }),
  action: async () => ({ ok: false, reason: 'unavailable' }),
};

/**
 * Dev only (`OW_PRO_SIMULATE`): always reports the given record, stamped as
 * checked just now (a long-running simulated Pro never drifts into the grace
 * end); actions succeed without doing anything.
 */
export function simulatedSource(record: EntitlementRecord): EntitlementSource {
  return {
    kind: 'simulated',
    check: async () => ({ ...record, lastCheckedAt: Date.now() }),
    action: async () => ({ ok: true }),
  };
}
