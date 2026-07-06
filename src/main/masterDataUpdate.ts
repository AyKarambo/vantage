import { net } from 'electron';
import { parseOverfastHeroes, parseOverfastMaps, type FetchedCatalog } from '../core/masterData';

/**
 * The one new outbound path besides Notion (spec Guardrail 5): a user-initiated
 * GET of the public OverFast catalog. It sends NO personal/account/match data —
 * just two bare GETs — and lives in the main process because the renderer is
 * CSP-locked. Parsing/validation is delegated to the pure core parsers, which
 * reject malformed payloads so nothing garbage reaches the preview (AC 14).
 */

const DEFAULT_TIMEOUT_MS = 10_000;

/** GET a URL as JSON with an abort-based timeout; throws on non-2xx or timeout. */
async function getJson(url: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await net.fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
    return await res.json();
  } catch (err) {
    if (controller.signal.aborted) throw new Error(`Timed out after ${timeoutMs}ms fetching ${url}`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch and validate the OverFast heroes + maps catalog from `baseUrl`
 * (configurable; defaults set in appsettings). Throws on network/timeout/HTTP
 * error or an unusable payload — the caller falls back to the compiled snapshot
 * and surfaces a clear message (spec AC 13).
 */
export async function fetchOverfast(baseUrl: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<FetchedCatalog> {
  const base = baseUrl.replace(/\/+$/, '');
  const [heroesRaw, mapsRaw] = await Promise.all([
    getJson(`${base}/heroes`, timeoutMs),
    getJson(`${base}/maps`, timeoutMs),
  ]);
  return { heroes: parseOverfastHeroes(heroesRaw), maps: parseOverfastMaps(mapsRaw) };
}
