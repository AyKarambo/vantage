/**
 * Parse Overwolf's public per-game status JSON (e.g.
 * `https://game-events-status.overwolf.com/10844_prod.json`) into a
 * {@link ServiceStatus}. Pure and totally defensive: the input is untrusted
 * remote JSON, so this NEVER throws — anything it can't read authoritatively
 * becomes `unknown` (the app then makes no outage claim, per guardrail).
 *
 * Overwolf's documented shape: a top-level numeric `state`
 * (0 unsupported · 1 green · 2 yellow · 3 red), optional `maintenance_msg`,
 * `disabled` / `disabled_electron` booleans, and a `features[]` array whose
 * entries carry `keys[]` with their own per-key `state`. The top-level state is
 * authoritative; a degraded feature key can only WORSEN an otherwise-ok reading,
 * never upgrade it.
 */
import type { ServiceStatus, ServiceStatusLevel } from './types';

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Overwolf's numeric state code → level; anything unexpected → `unknown`. */
function mapState(n: number): ServiceStatusLevel {
  if (n === 1) return 'ok';
  if (n === 2) return 'degraded';
  if (n === 3) return 'down';
  return 'unknown'; // 0 = unsupported, or an unexpected code
}

/** Worst per-feature key state (0 when none found). Fully guarded against shape drift. */
function worstFeatureState(features: unknown): number {
  if (!Array.isArray(features)) return 0;
  let worst = 0;
  for (const f of features) {
    if (!isObj(f) || !Array.isArray(f.keys)) continue;
    for (const k of f.keys) {
      if (isObj(k) && typeof k.state === 'number' && k.state > worst) worst = k.state;
    }
  }
  return worst;
}

export function parseServiceStatus(raw: unknown): ServiceStatus {
  if (!isObj(raw)) return { level: 'unknown' };

  const message =
    typeof raw.maintenance_msg === 'string' && raw.maintenance_msg.trim()
      ? raw.maintenance_msg.trim()
      : undefined;

  // An explicit disable is an unambiguous outage regardless of the state code.
  if (raw.disabled === true || raw.disabled_electron === true) {
    return message ? { level: 'down', message } : { level: 'down' };
  }

  // An UNPUBLISHED entry is not an authoritative reading and must not be read as
  // one. Overwatch is live proof: `10844_prod.json` returns `published: false` with
  // a blanket `state: 3` across all 25 keys, while `10844_dev.json` returns
  // `published: true, state: 1` — green. The prod entry is a placeholder Overwolf
  // hasn't published, not an outage, and reading it literally made the app announce
  // a GEP outage that was not happening. That false claim is precisely what the
  // `unknown` level exists to prevent (see ./types.ts).
  //
  // Only an explicit `false` suppresses: a payload that omits `published` entirely
  // is still trusted, so this can't silently mute a real outage on a game whose
  // feed lacks the field.
  if (raw.published === false) return { level: 'unknown' };

  if (typeof raw.state !== 'number') return { level: 'unknown' };

  let level = mapState(raw.state);
  // Per-feature keys can only worsen an ok/degraded top-level reading.
  if (level === 'ok' || level === 'degraded') {
    const worst = worstFeatureState(raw.features);
    if (worst === 3) level = 'down';
    else if (worst === 2 && level === 'ok') level = 'degraded';
  }

  return message && level !== 'ok' ? { level, message } : { level };
}
