import { net } from 'electron';
import { gepStatusFeedUrl, parseServiceStatus, type GepStatusEnv, type ServiceStatus } from '../core/gepService';

/**
 * Outbound GET of Overwolf's PUBLIC per-game GEP status feed (guardrail 5): the
 * only new network path besides Notion + OverFast. It sends NO personal/account/
 * match data — the game id is the sole parameter, in the URL path. Lives in the
 * main process (the renderer is CSP-locked); the URL choice and the parsing are
 * both delegated to pure `core/gepService` helpers, and the parser never throws.
 */

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Fetch + parse the GEP service status for `gameId` from `env`'s feed. Throws on
 * a transport error/timeout/non-2xx so the poller can back off; a 2xx with an
 * unreadable body parses to `{ level: 'unknown' }` (no outage claim).
 *
 * `env` must match the environment the app's gaming packages actually load from —
 * see `core/gepService/feedUrl.ts`. Reading `prod` while running in Dev Mode is
 * how the app once reported an outage that wasn't happening.
 */
export async function fetchServiceStatus(
  gameId: number,
  env: GepStatusEnv,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<ServiceStatus> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await net.fetch(gepStatusFeedUrl(gameId, env), {
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
