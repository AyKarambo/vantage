/**
 * The dev-mode auth decision layer: whether a dev-mode launch was attempted,
 * whether it can/did succeed, and what the sidebar badge should show for it.
 * ow-electron's Dev Mode authenticates an *unpackaged* build using Overwolf
 * dev credentials in the environment — a dev key over Bearer (`OW_DEV_KEY`),
 * or an email + API-key pair over Key (`OW_CLI_EMAIL` + `OW_CLI_API_KEY`).
 * owepm reads these at process start (injected by `scripts/ow-dev.mjs`); it is
 * never true for a packaged/installed build, where Dev Mode cannot activate.
 *
 * Pure (guardrail 3): every function here takes explicit input — no Electron,
 * no IO, no ambient env/timer reads.
 */
export interface DevModeInput {
  /** `app.isPackaged` — true for an installed/packaged build. */
  packaged: boolean;
  /** The credential env vars owepm reads (a subset of `process.env`). */
  env: {
    OW_DEV_KEY?: string;
    OW_CLI_EMAIL?: string;
    OW_CLI_API_KEY?: string;
  };
}

/**
 * Whether owepm's credential env vars resolve to a usable dev-mode credential:
 * a dev key over Bearer (`OW_DEV_KEY`), or an email + API-key pair over Key
 * (`OW_CLI_EMAIL` + `OW_CLI_API_KEY`) — presence only, not proof of successful
 * authentication. Used to decide whether a dev-mode auth attempt can possibly
 * succeed before waiting on it (see `decideDevModeAuthStrategy`).
 */
export function hasDevCredentials(env: DevModeInput['env']): boolean {
  const hasDevKey = Boolean(env.OW_DEV_KEY);
  const hasApiKey = Boolean(env.OW_CLI_EMAIL) && Boolean(env.OW_CLI_API_KEY);
  return hasDevKey || hasApiKey;
}

/**
 * Whether a dev-mode launch was *attempted* this run — a different question
 * from `hasDevCredentials`'s "are credentials present". `OW_DEV_MODE_ATTEMPT`
 * is stamped by `scripts/ow-dev.mjs` to reflect the launcher's `enabled` flag
 * (Settings toggle on, or forced via `--force`), regardless of whether
 * credentials actually resolved. A toggle-on-but-no-credentials-found launch
 * still counts as "attempted": it's what lets the badge later show an
 * explicit failure instead of silently staying hidden, which is the
 * distinction `decideDevModeAuthStrategy` and `classifyDevModeBadge` need.
 * Synchronous and stable for the whole process life (unlike the auth
 * *outcome*, which resolves later) — safe to read once, e.g. into `AppInfo`.
 * Never true for a packaged/installed build.
 */
export function computeDevModeAttempted(input: {
  packaged: boolean;
  env: { OW_DEV_MODE_ATTEMPT?: string };
}): boolean {
  if (input.packaged) return false;
  return input.env.OW_DEV_MODE_ATTEMPT === '1';
}

/**
 * The runtime-verified outcome of a dev-mode auth attempt, as reported by
 * ow-electron's package manager:
 * - 'pending' — attempted, but ow-electron hasn't yet confirmed success or
 *   failure. The badge must stay hidden (never green) while pending.
 * - 'confirmed' — the package manager reported the `gep` package `ready`.
 * - 'failed' — either `failed-to-initialize` fired, a 15s timeout elapsed
 *   with neither event, or no dev credentials were resolvable at all despite
 *   an attempt.
 */
export type DevModeAuthOutcome = 'pending' | 'confirmed' | 'failed';

/**
 * Pure decision table for how to pursue dev-mode auth verification, given
 * what's known at wiring time:
 * - not attempted → `'not-attempted'`: no dev-mode launch was intended this
 *   run; nothing more to do, the badge stays hidden forever.
 * - attempted, no credentials → `'immediate-fail-no-credentials'`: an attempt
 *   was intended but there's nothing to authenticate with — fail immediately
 *   rather than wait 15s for an event that structurally cannot fire.
 * - attempted, credentials present, packages unavailable →
 *   `'immediate-fail-no-packages'`: credentials exist but `overwolf.packages`
 *   itself isn't available at wiring time — fail immediately rather than hang.
 * - attempted, credentials present, packages available → `'listen'`: the
 *   normal path — attach `packages.on('ready'|'failed-to-initialize')`
 *   listeners and arm a 15s timeout.
 */
export function decideDevModeAuthStrategy(input: {
  attempted: boolean;
  hasCredentials: boolean;
  packagesAvailable: boolean;
}): 'not-attempted' | 'immediate-fail-no-credentials' | 'immediate-fail-no-packages' | 'listen' {
  if (!input.attempted) return 'not-attempted';
  if (!input.hasCredentials) return 'immediate-fail-no-credentials';
  if (!input.packagesAvailable) return 'immediate-fail-no-packages';
  return 'listen';
}

/**
 * The dev-mode badge's displayed state:
 * - 'hidden' — no attempt this run, or an attempt is still pending.
 * - 'authenticated' — auth outcome confirmed.
 * - 'failed' — auth outcome failed.
 */
export type DevModeBadgeState = 'hidden' | 'authenticated' | 'failed';

/**
 * Pure rule mapping attempt + outcome to the badge's displayed state:
 * - not attempted → `'hidden'`
 * - outcome 'confirmed' → `'authenticated'`
 * - outcome 'failed' → `'failed'`
 * - outcome 'pending' → `'hidden'` — CRITICAL: the badge must never show
 *   green/authenticated before the outcome is actually confirmed. This is the
 *   core bug this feature fixes: the old badge showed "on" based on
 *   credential presence alone, not proof of successful authentication.
 */
export function classifyDevModeBadge(input: { attempted: boolean; outcome: DevModeAuthOutcome }): DevModeBadgeState {
  if (!input.attempted) return 'hidden';
  if (input.outcome === 'confirmed') return 'authenticated';
  if (input.outcome === 'failed') return 'failed';
  return 'hidden';
}
