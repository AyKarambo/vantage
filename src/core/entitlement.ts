/**
 * Vantage Pro entitlement (spec #337) — pure and Electron-free, so the main
 * process, the IPC contract and the tests share one definition of "who gets
 * what". The main process feeds it whatever an `EntitlementSource` last reported
 * (cached on disk) plus `now`; nothing here talks to the network.
 *
 * Gating is honor-system by design: the code is open source and a fork can drop
 * the gate. This module only has to be *correct*, not tamper-proof.
 */

const DAY_MS = 86_400_000;

/** How long a confirmed Pro state survives without a successful re-check. */
export const PRO_GRACE_MS = 7 * DAY_MS;

/** Length of the Tebex plan trial — the source reports `validUntil`, this is only the simulator's default. */
export const TRIAL_MS = 14 * DAY_MS;

/**
 * What a source reported at its last successful check, as cached by main.
 * `plan` is the raw subscription state; the tier is derived from it and `now`.
 */
export interface EntitlementRecord {
  plan: 'none' | 'trial' | 'pro';
  /** End of the trial / paid period, epoch ms. Absent = open-ended (renews). */
  validUntil?: number;
  /** When the source last answered, epoch ms. Absent = never checked. */
  lastCheckedAt?: number;
  /** Whether this account ever held a paid plan — turns "no plan" into `lapsed` instead of `free`. */
  everPro?: boolean;
  /** When access was last observed to lapse — the start of the staleness pause (see {@link resumeActivation}). */
  lapsedSince?: number;
}

export type ProTier = 'free' | 'trial' | 'pro' | 'lapsed';

export interface Entitlement {
  tier: ProTier;
  /** End of the current trial / paid period, when known. */
  until?: number;
  /** For `pro`: the moment the offline grace runs out without a re-check. */
  graceEndsAt?: number;
}

/** Which kind of source produced the record — the UI says "coming soon" while it is `none`. */
export type EntitlementSourceKind = 'none' | 'simulated' | 'overwolf';

/**
 * Everything the app needs to gate on, shipped in the dashboard payload.
 * `full` = every Pro feature works (trial, pro, or the demo dataset — the demo
 * *is* the preview). `targets` is `read-only` only for a lapsed subscriber.
 */
export interface ProAccess {
  tier: ProTier;
  full: boolean;
  targets: 'full' | 'read-only' | 'locked';
  /** True when access is full only because the demo dataset is showing. */
  demo: boolean;
  until?: number;
  graceEndsAt?: number;
  source: EntitlementSourceKind;
}

/** The empty record a fresh install starts from — resolves to `free`. */
export const NO_ENTITLEMENT: EntitlementRecord = { plan: 'none' };

/** Derive the tier from the cached record. Total: a malformed record reads as `free`. */
export function resolveTier(record: EntitlementRecord | undefined, now: number): Entitlement {
  const r = record ?? NO_ENTITLEMENT;
  const lapsedOrFree: Entitlement = { tier: r.everPro ? 'lapsed' : 'free' };
  if (r.plan === 'none') return lapsedOrFree;

  const expired = r.validUntil !== undefined && now >= r.validUntil;
  if (r.plan === 'trial') {
    // A trial has a fixed end the source already told us, so it runs to that
    // end offline (no 7-day re-check); once it ends it simply ends: back to free.
    if (expired || r.validUntil === undefined || r.lastCheckedAt === undefined) return lapsedOrFree;
    return { tier: 'trial', until: r.validUntil };
  }

  // plan === 'pro'
  if (expired || !withinGrace(r, now)) return { tier: 'lapsed' };
  return { tier: 'pro', until: r.validUntil, graceEndsAt: (r.lastCheckedAt ?? now) + PRO_GRACE_MS };
}

function withinGrace(r: EntitlementRecord, now: number): boolean {
  return r.lastCheckedAt !== undefined && now - r.lastCheckedAt <= PRO_GRACE_MS;
}

export function isProTier(tier: ProTier): boolean {
  return tier === 'trial' || tier === 'pro';
}

export function proAccess(
  entitlement: Entitlement,
  demoActive: boolean,
  source: EntitlementSourceKind,
): ProAccess {
  const paid = isProTier(entitlement.tier);
  const full = paid || demoActive;
  return {
    tier: entitlement.tier,
    full,
    targets: full ? 'full' : entitlement.tier === 'lapsed' ? 'read-only' : 'locked',
    demo: demoActive && !paid,
    ...(entitlement.until !== undefined ? { until: entitlement.until } : {}),
    ...(entitlement.graceEndsAt !== undefined ? { graceEndsAt: entitlement.graceEndsAt } : {}),
    source,
  };
}

/**
 * Dev-only `OW_PRO_SIMULATE=free|trial|pro|lapsed` → a synthetic record that
 * resolves to that tier at `now`. Anything else (or unset) → `undefined`.
 */
export function parseProSimulation(
  env: Record<string, string | undefined>,
  now: number,
): EntitlementRecord | undefined {
  switch (env.OW_PRO_SIMULATE?.trim().toLowerCase()) {
    case 'free': return { plan: 'none', lastCheckedAt: now };
    case 'trial': return { plan: 'trial', validUntil: now + TRIAL_MS, lastCheckedAt: now };
    case 'pro': return { plan: 'pro', lastCheckedAt: now, everPro: true };
    case 'lapsed': return { plan: 'none', lastCheckedAt: now, everPro: true, lapsedSince: now };
    default: return undefined;
  }
}

/**
 * Fold a fresh source answer into the cached record, tracking the lapse window:
 * `lapsedSince` is stamped when access stops and cleared when it returns, and
 * `everPro` is sticky. Returns the next record plus, on a lapsed→pro return,
 * the pause to apply to active targets' staleness clocks.
 */
export function nextRecord(
  prev: EntitlementRecord,
  fresh: EntitlementRecord,
  now: number,
): { record: EntitlementRecord; resumedFrom?: number } {
  const everPro = Boolean(prev.everPro || fresh.everPro || fresh.plan === 'pro');
  const wasFull = isProTier(resolveTier(prev, now).tier);
  const nowFull = isProTier(resolveTier({ ...fresh, everPro }, now).tier);
  const base: EntitlementRecord = { ...fresh, everPro, lastCheckedAt: fresh.lastCheckedAt ?? now };
  delete base.lapsedSince;
  if (!nowFull) return { record: { ...base, lapsedSince: prev.lapsedSince ?? (wasFull || everPro ? now : undefined) } };
  return prev.lapsedSince !== undefined && !wasFull
    ? { record: base, resumedFrom: prev.lapsedSince }
    : { record: base };
}

/**
 * Pause a target's staleness clock across a lapse: shift its activation
 * forward by the time access was missing, so a lapse never makes a target
 * stale (spec §5). Never moves the clock backwards, and never past `resumedAt`
 * (the pause only counts the lapse time after activation).
 */
export function resumeActivation(activatedAt: number, lapsedSince: number, resumedAt: number): number {
  return activatedAt + Math.max(0, resumedAt - Math.max(lapsedSince, activatedAt));
}
