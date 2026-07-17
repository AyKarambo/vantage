/**
 * Which of Overwolf's two published status feeds to read, and where it lives.
 *
 * Overwolf publishes a `dev` and a `prod` feed per game, and for Overwatch they
 * disagree: `10844_prod.json` is an unpublished placeholder (`published: false`,
 * a blanket `state: 3`), while `10844_dev.json` reports the truth (`state: 1`,
 * green). Which one is authoritative depends on which environment the app is
 * actually running against — an unpackaged build with Overwolf dev credentials
 * (Dev Mode) loads its gaming packages from `dev`, so `prod` describes an
 * environment it isn't in.
 *
 * Reading the wrong feed isn't a cosmetic mismatch: it's how the app ended up
 * announcing a GEP outage to a developer whose GEP was fine.
 *
 * Pure (guardrail 3) — the caller decides the environment (see
 * `core/devMode.ts`'s `computeDevMode`); this only knows where each one lives.
 */

/** The environment whose feed we're reading — mirrors ow-electron's own dev/prod split. */
export type GepStatusEnv = 'prod' | 'dev';

const STATUS_BASE = 'https://game-events-status.overwolf.com';

/**
 * Overwolf's per-game status endpoint for a numeric game id, in `env`.
 * @param gameId numeric Overwolf game id (Overwatch = 10844)
 * @param env which environment's feed to read; Dev Mode should read `'dev'`
 */
export function gepStatusFeedUrl(gameId: number, env: GepStatusEnv): string {
  return `${STATUS_BASE}/${gameId}_${env}.json`;
}
