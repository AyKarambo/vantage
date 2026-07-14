import { net } from 'electron';
import { parseServiceStatus, type ServiceStatus } from '../core/gepService';

/**
 * Outbound GET of Overwolf's PUBLIC per-game GEP status feed (guardrail 5): the
 * only new network path besides Notion + OverFast. It sends NO personal/account/
 * match data — the game id is the sole parameter, in the URL path. Lives in the
 * main process (the renderer is CSP-locked); parsing is delegated to the pure
 * `core/gepService` parser, which never throws.
 */

const DEFAULT_TIMEOUT_MS = 10_000;
const STATUS_BASE = 'https://game-events-status.overwolf.com';

/** Overwolf's per-game status endpoint for a numeric game id. */
export function statusUrl(gameId: number): string {
  return `${STATUS_BASE}/${gameId}_prod.json`;
}

/**
 * Fetch + parse the GEP service status for `gameId`. Throws on a transport
 * error/timeout/non-2xx so the poller can back off; a 2xx with an unreadable
 * body parses to `{ level: 'unknown' }` (no outage claim).
 */
export async function fetchServiceStatus(gameId: number, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<ServiceStatus> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await net.fetch(statusUrl(gameId), {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for the GEP status feed`);
    return parseServiceStatus(await res.json());
  } catch (err) {
    if (controller.signal.aborted) throw new Error(`Timed out after ${timeoutMs}ms fetching the GEP status feed`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
