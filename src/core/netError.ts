/**
 * Pure network-error classification. Every network failure in this app — the
 * OverFast master-data fetch (`main/masterDataUpdate.ts`), the GEP status feed
 * (`main/statusFeed.ts`), and the Notion SDK calls (`notion/*`, `main/notionRuntime.ts`)
 * — otherwise reaches the user as a raw `String(err)` (or worse, mislabelled). This
 * module says "you're offline" (or timed out, or denied, or not found, or the
 * remote is down) once, correctly, in one place; later tasks wire the main
 * process and renderer to it instead of stringifying errors themselves.
 *
 * Structural only: errors are classified by duck-typing on `status` / `code` /
 * `name` / `message` (and one level into `cause`, where undici nests the real
 * errno for a wrapped `fetch failed`). The Notion SDK's error shapes
 * (`APIResponseError` carries a numeric `status` and a string `code` such as
 * `unauthorized` or `object_not_found`) are matched the same way — this file
 * never imports `@notionhq/client` (guardrail 3: `core/` stays Electron/Notion-free).
 *
 * Like `gepService/parse.ts`, this is totally defensive: the input is whatever
 * a `catch` block handed it — an `Error`, a plain object, `undefined`, a string,
 * anything — so it NEVER throws. Anything it can't classify becomes `unknown`.
 */

/** The kinds of network failure this app distinguishes for the user. */
export type NetErrorKind = 'offline' | 'timeout' | 'auth' | 'notFound' | 'server' | 'unknown';

/** Errno-style codes meaning the transport never completed (no route to the host). */
const OFFLINE_ERRNO_CODES = new Set(['ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN', 'ENETUNREACH']);

/** Notion `APIErrorCode` values that mean the token/integration was denied. */
const NOTION_AUTH_CODES = new Set(['unauthorized', 'restricted_resource']);

/** Notion `APIErrorCode` values that mean the object no longer exists / isn't shared. */
const NOTION_NOT_FOUND_CODES = new Set(['object_not_found']);

/** Notion `APIErrorCode` values that mean the failure is on Notion's side. */
const NOTION_SERVER_CODES = new Set(['internal_server_error', 'service_unavailable']);

/** Matches the `HTTP <code> <statusText> for <url>` shape thrown by masterDataUpdate.ts / statusFeed.ts. */
const HTTP_STATUS_IN_MESSAGE = /\bHTTP (\d{3})\b/;

/** Matches the `Timed out after <ms>ms fetching ...` shape those same modules throw on abort. */
const TIMED_OUT_IN_MESSAGE = /\btimed out\b/i;

/**
 * Chromium's own network errors. Electron's `net.fetch` — which is what
 * `main/masterDataUpdate.ts` and `main/statusFeed.ts` use — rejects with the RAW
 * ClientRequest error, i.e. an `Error` whose message is `net::ERR_...`. It does NOT
 * wrap it in undici's `TypeError('fetch failed', { cause })`; that shape belongs to
 * Node's global fetch, which this app doesn't use for these calls. Without these two
 * patterns the app's only non-Notion outbound path classified a plain offline failure
 * as `unknown` — the exact case this module exists for.
 */
const CHROMIUM_TIMEOUT = /net::ERR_(?:TIMED_OUT|CONNECTION_TIMED_OUT)\b/i;
const CHROMIUM_OFFLINE =
  /net::ERR_(?:NAME_NOT_RESOLVED|NAME_RESOLUTION_FAILED|INTERNET_DISCONNECTED|NETWORK_CHANGED|CONNECTION_REFUSED|CONNECTION_RESET|CONNECTION_ABORTED|CONNECTION_CLOSED|CONNECTION_FAILED|ADDRESS_UNREACHABLE|PROXY_CONNECTION_FAILED)\b/i;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function asNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * Read a string field off `err`, falling back to the same field on `err.cause`
 * one level down — undici's `TypeError('fetch failed')` nests the real errno
 * (`{ code: 'ENOTFOUND', ... }`) there instead of putting it on the outer error.
 */
function fieldOrCause(err: Record<string, unknown>, field: 'code' | 'name' | 'message'): string {
  const own = asString(err[field]);
  if (own) return own;
  return isRecord(err.cause) ? asString(err.cause[field]) : '';
}

/**
 * Classify a caught network error into one of six buckets so the UI can show
 * one correct, actionable message instead of `String(err)`. Never throws —
 * anything that isn't recognizably one of the shapes below (including
 * `null`/`undefined`/a string/a number/a plain `{}`) classifies as `unknown`.
 *
 * See the module doc for the exact shapes this reads. Order matters where
 * shapes could overlap: timeout is checked before the offline errno set (an
 * `ETIMEDOUT` is a timeout, not a generic offline signal), and an HTTP status
 * (own property or parsed out of an `HTTP <code> ...` message) is checked
 * before the narrower Notion `code` strings, which mean the same thing when a
 * status happens not to be present.
 */
export function classifyNetworkError(err: unknown): NetErrorKind {
  if (!isRecord(err)) return 'unknown';

  const code = fieldOrCause(err, 'code');
  const name = fieldOrCause(err, 'name');
  const message = fieldOrCause(err, 'message');

  // Timeout: AbortController-based aborts, the Notion SDK's own client-side
  // timeout, and the plain-Error "Timed out after …" shape our own fetch
  // helpers throw when `controller.signal.aborted`.
  if (
    name === 'AbortError' ||
    name === 'TimeoutError' ||
    name === 'RequestTimeoutError' ||
    code === 'ETIMEDOUT' ||
    code === 'notionhq_client_request_timeout' ||
    CHROMIUM_TIMEOUT.test(message) ||
    TIMED_OUT_IN_MESSAGE.test(message)
  ) {
    return 'timeout';
  }

  // Offline: the transport never completed. Covers bare Node errno objects,
  // undici/Electron's `TypeError: fetch failed` (with the real errno one level
  // down in `cause`, already unwrapped above by `fieldOrCause`), and a raw
  // `getaddrinfo …` message some platforms surface instead of a `code`.
  if (
    OFFLINE_ERRNO_CODES.has(code) ||
    CHROMIUM_OFFLINE.test(message) ||
    /fetch failed/i.test(message) ||
    /getaddrinfo/i.test(message)
  ) {
    return 'offline';
  }

  // HTTP status — either a real `status`/`statusCode` property (Notion's
  // `APIResponseError`) or parsed out of the `HTTP <code> <statusText> for …`
  // message our own `net.fetch` wrappers throw on a non-2xx response.
  const status = asNumber(err.status) ?? asNumber(err.statusCode) ?? parseHttpStatus(message);
  if (status !== undefined) {
    if (status === 401 || status === 403) return 'auth';
    if (status === 404) return 'notFound';
    if (status >= 500 && status < 600) return 'server';
  }

  // No status (or a status this app doesn't specifically bucket): fall back
  // to Notion's structural error `code` strings, which mean the same thing.
  if (NOTION_AUTH_CODES.has(code)) return 'auth';
  if (NOTION_NOT_FOUND_CODES.has(code)) return 'notFound';
  if (NOTION_SERVER_CODES.has(code)) return 'server';

  return 'unknown';
}

/** Pull a 3-digit HTTP status out of an `HTTP 404 Not Found for …`-shaped message, if present. */
function parseHttpStatus(message: string): number | undefined {
  const match = HTTP_STATUS_IN_MESSAGE.exec(message);
  return match ? Number(match[1]) : undefined;
}

/**
 * Compose a short, actionable, blame-free message for a classified network
 * failure. `action` is a short verb phrase naming what was being attempted
 * (e.g. `'update the hero and map list'`, `'sync to Notion'`) and always
 * appears verbatim in the result.
 *
 * Design note (see `core/gepService/types.ts` for the same principle applied
 * to GEP service status): a client can't tell "no internet" apart from "the
 * remote host is down" — both surface identically as a transport failure. The
 * `offline` copy is worded to stay true either way — it names the internet
 * connection (Overwolf's store-review requirement for this class of message)
 * while also allowing for the remote service being unreachable, rather than
 * asserting a cause this code can't actually observe.
 */
export function friendlyNetworkMessage(kind: NetErrorKind, action: string): string {
  switch (kind) {
    case 'offline':
      return `Couldn't ${action} — check your internet connection (the service may also be temporarily unreachable), then try again.`;
    case 'timeout':
      return `Couldn't ${action} — the request took too long to respond. Try again in a moment.`;
    case 'auth':
      return `Couldn't ${action} — access was denied. Check your permissions or sign-in and try again.`;
    case 'notFound':
      return `Couldn't ${action} — what it was looking for wasn't found. It may have been moved or removed.`;
    case 'server':
      return `Couldn't ${action} — the service is having trouble right now. Try again shortly.`;
    case 'unknown':
    default:
      return `Couldn't ${action} — something went wrong. Try again, and check your connection if it keeps happening.`;
  }
}
