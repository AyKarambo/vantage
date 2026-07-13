/**
 * Whether the app is running in ow-electron Dev Mode: an *unpackaged* build whose
 * process was launched with Overwolf dev credentials in the environment — a dev
 * key over Bearer (`OW_DEV_KEY`), or an email + API-key pair over Key
 * (`OW_CLI_EMAIL` + `OW_CLI_API_KEY`). owepm reads these at process start
 * (injected by `scripts/ow-dev.mjs`), so this is a truthful, synchronous read of
 * "dev credentials present AND unpackaged". It is never true for a
 * packaged/installed build, where Dev Mode cannot activate at all.
 *
 * Pure (guardrail 3): takes the packaged flag and an env slice — no Electron, no IO.
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

export function computeDevMode({ packaged, env }: DevModeInput): boolean {
  if (packaged) return false;
  const hasDevKey = Boolean(env.OW_DEV_KEY);
  const hasApiKey = Boolean(env.OW_CLI_EMAIL) && Boolean(env.OW_CLI_API_KEY);
  return hasDevKey || hasApiKey;
}
