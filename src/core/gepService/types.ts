/**
 * Overwolf GEP *service* status — distinct from the local connection health
 * (`core/gepHealth`). This is the authoritative "is Overwatch's game-event feed
 * up on Overwolf's side" signal, derived from Overwolf's public per-game status
 * JSON. Orthogonal to whether *we* are attached/in a match, so it rides the
 * status payload as its own field rather than folding into `GepHealthState`.
 */

/**
 * - `ok`       — Overwolf reports the feed fully working (status 1 / green).
 * - `degraded` — partial outage (status 2 / yellow, or a degraded feature key).
 * - `down`     — events unavailable (status 3 / red, or disabled).
 * - `unknown`  — no authoritative reading (feed unreachable/unparseable). Never a
 *                basis for a "down" claim — the app makes no outage assertion here.
 */
export type ServiceStatusLevel = 'ok' | 'degraded' | 'down' | 'unknown';

export interface ServiceStatus {
  level: ServiceStatusLevel;
  /** Overwolf's `maintenance_msg`, when present and the feed isn't `ok`. */
  message?: string;
}
