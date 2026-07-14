/**
 * The pure "should we notify, and with what text" decision for a GEP service
 * status change. Fires ONCE per meaningful transition:
 *  - up → outage   → a "down" notification,
 *  - outage → up   → a "restored" notification.
 * Transitions to/from `unknown` (feed unreachable, no authoritative reading)
 * NEVER notify — the app must not assert an outage without evidence. Since the
 * caller passes the previous and current status on every publish, an unchanged
 * band yields `null`, which is what keeps it to one notification per transition.
 */
import type { ServiceStatus } from './types';

export interface GepNotification {
  title: string;
  body: string;
}

type Band = 'up' | 'outage' | 'none';

function band(s: ServiceStatus | null | undefined): Band {
  const level = s?.level;
  if (level === 'ok') return 'up';
  if (level === 'down' || level === 'degraded') return 'outage';
  return 'none'; // unknown / absent → no claim
}

export function decideGepNotification(
  prev: ServiceStatus | null | undefined,
  next: ServiceStatus | null | undefined,
): GepNotification | null {
  const a = band(prev);
  const b = band(next);
  if (a === b) return null;

  if (a === 'up' && b === 'outage') {
    return {
      title: 'Overwatch events are down',
      body: next?.message
        ? `Overwolf: ${next.message}. Vantage will resume tracking automatically once it's fixed.`
        : "Overwolf's game-event feed is down for Overwatch — this is on their side. Vantage resumes tracking automatically when it's fixed.",
    };
  }
  if (a === 'outage' && b === 'up') {
    return {
      title: 'Overwatch events restored',
      body: "Overwolf's game-event feed is back — Vantage is tracking again.",
    };
  }
  // Any transition involving `none` (unknown) makes no claim.
  return null;
}

/**
 * The status to carry forward as the notification baseline. Keeps the last
 * AUTHORITATIVE reading (ok/degraded/down) across an `unknown` (a feed hiccup),
 * so a real down→recovery transition is never masked by a transient failure:
 * `down → unknown → ok` still diffs `down → ok` and fires "restored".
 */
export function nextNotifyBaseline(
  prev: ServiceStatus | null | undefined,
  next: ServiceStatus | null | undefined,
): ServiceStatus | null {
  return next && next.level !== 'unknown' ? next : (prev ?? null);
}
