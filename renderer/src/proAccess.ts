import type { ProAccess } from '../../src/shared/contract';
import type { ViewId } from './store';

/**
 * Vantage Pro in the renderer (#337) — the pure half, so it is unit-testable
 * under the node test env. The payload already withholds Pro data; these only
 * decide what the shell shows in its place.
 */

/** The Pro screens: their nav items carry a badge, and they open on a lock page without access. */
export type ProView = 'readiness' | 'mental' | 'targets';

/** A routed view → the Pro screen it belongs to (the target drill-down is part of Targets). */
export function proViewOf(view: ViewId): ProView | null {
  if (view === 'readiness' || view === 'mental' || view === 'targets') return view;
  if (view === 'targetDetail') return 'targets';
  return null;
}

/**
 * Whether `view` opens on the lock page. A lapsed subscriber keeps a read-only
 * Targets screen; Readiness and Mental lock for every non-full tier.
 */
export function isLockedView(view: ViewId, access: ProAccess): boolean {
  const pro = proViewOf(view);
  if (!pro) return false;
  return pro === 'targets' ? access.targets === 'locked' : !access.full;
}

/** Whether a nav item shows the "Pro" badge — every Pro screen, whenever access isn't full. */
export function showsProBadge(view: ViewId, access: ProAccess): boolean {
  return proViewOf(view) === view && !access.full;
}

/** Whether the Targets screens render without any create/edit/activate/grade control. */
export function targetsReadOnly(access: ProAccess): boolean {
  return access.targets === 'read-only';
}

/** The purchase buttons can't work until a real source exists (the Overwolf source is pending DevRel); a developer key has nothing to buy. */
export function purchaseAvailable(access: ProAccess): boolean {
  return access.source !== 'none' && access.source !== 'developer';
}

/** Whole days left until `until`, rounded up (a trial ending in 3h still reads "1 day left"). */
export function daysLeft(until: number | undefined, now: number): number | null {
  if (until === undefined) return null;
  return Math.max(0, Math.ceil((until - now) / 86_400_000));
}

/** One short line for the tier — the Settings status and the lock page share it. */
export function tierLabel(access: ProAccess, now: number): string {
  switch (access.tier) {
    case 'trial': {
      const left = daysLeft(access.until, now);
      return left === null ? 'Vantage Pro trial' : `Vantage Pro trial · ${left} ${left === 1 ? 'day' : 'days'} left`;
    }
    case 'pro': return 'Vantage Pro';
    case 'lapsed': return 'Vantage Pro ended — your data is kept';
    default: return 'Free';
  }
}

/** The Settings detail line under the tier: dates for pro/trial, the kept-data note for lapsed, what Pro adds for free. */
export function tierDetail(access: ProAccess): string {
  const date = (ms: number): string => new Date(ms).toLocaleDateString();
  switch (access.tier) {
    case 'pro':
      if (access.until !== undefined) return `Renews/ends on ${date(access.until)}`;
      if (access.graceEndsAt !== undefined) return `Works offline until ${date(access.graceEndsAt)} without a re-check`;
      return 'Your subscription is active.';
    case 'trial':
      return access.until !== undefined ? `Trial ends on ${date(access.until)}` : 'Your trial is active.';
    case 'lapsed':
      return 'Your targets, grades and mental history are kept — renew to use them again.';
    default:
      return 'Readiness, Targets, Mental analytics and the MCP server. Tracking, stats and matches stay free.';
  }
}
