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

/** Ungated access — what `computeDashboard` stamps before the edge narrows it. */
export const FULL_PRO_ACCESS: ProAccess = { tier: 'pro', full: true, targets: 'full', demo: false, source: 'none' };

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
  const graceEndsAt = graceEnd(r);
  if (expired || graceEndsAt === undefined || now > graceEndsAt) return { tier: 'lapsed' };
  return { tier: 'pro', until: r.validUntil, graceEndsAt };
}

/** When a cached paid plan's offline grace runs out without a re-check. */
function graceEnd(r: EntitlementRecord): number | undefined {
  return r.plan === 'pro' && r.lastCheckedAt !== undefined ? r.lastCheckedAt + PRO_GRACE_MS : undefined;
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

export const PRO_TIERS: readonly ProTier[] = ['free', 'trial', 'pro', 'lapsed'];

/** A tier name from untrusted input (env var, IPC); anything else → `undefined`. */
export function parseProTier(value: unknown): ProTier | undefined {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return (PRO_TIERS as readonly string[]).includes(v) ? (v as ProTier) : undefined;
}

/** A synthetic record that resolves to `tier` at `now` — for the dev override and the simulator. */
export function simulatedRecord(tier: ProTier, now: number): EntitlementRecord {
  switch (tier) {
    case 'free': return { plan: 'none', lastCheckedAt: now };
    case 'trial': return { plan: 'trial', validUntil: now + TRIAL_MS, lastCheckedAt: now };
    case 'pro': return { plan: 'pro', lastCheckedAt: now, everPro: true };
    case 'lapsed': return { plan: 'none', lastCheckedAt: now, everPro: true, lapsedSince: now };
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
  // Access can run out with no check in between (grace or paid period ended
  // while the app sat idle): date that lapse from the record itself, not `now`.
  const lapsedFrom = prev.lapsedSince ?? (wasFull ? undefined : expiredAt(prev));
  if (!nowFull) return { record: { ...base, lapsedSince: lapsedFrom ?? (wasFull || everPro ? now : undefined) } };
  return lapsedFrom !== undefined && !wasFull
    ? { record: base, resumedFrom: lapsedFrom }
    : { record: base };
}

/** When a cached paid plan stopped granting access by itself — period end or grace end, whichever came first. */
function expiredAt(r: EntitlementRecord): number | undefined {
  if (r.plan !== 'pro') return undefined;
  const ends = [r.validUntil, graceEnd(r)].filter((t): t is number => t !== undefined);
  return ends.length ? Math.min(...ends) : undefined;
}

/**
 * The next moment the tier changes by time alone (trial/period end, grace
 * end), so a running app can re-render then instead of at the next check.
 */
export function nextTierChange(record: EntitlementRecord, now: number): number | undefined {
  const at = [record.validUntil, graceEnd(record)]
    .filter((t): t is number => t !== undefined && t > now);
  return at.length ? Math.min(...at) : undefined;
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
