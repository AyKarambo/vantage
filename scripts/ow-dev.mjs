// Dev Mode launcher: put dev credentials into the env vars ow-electron actually
// reads, then launch `ow-electron .`.
//
// Why this exists — the trap that made GEP "fail authentication":
// ow-electron's Dev Mode credential check (owepm `buildAppInfo`) reads credentials
// ONLY from process.env — a DEV key via OW_DEV_KEY (Bearer auth), OR an API key via
// OW_CLI_EMAIL + OW_CLI_API_KEY (Key auth). It does NOT read the file that
// `ow config` writes. So running `ow config` alone leaves the runtime with empty
// credentials and the gaming packages (GEP, Overlay, Recorder) never load.
//
// A DEV key and an API key are NOT interchangeable: a dev key sent as OW_CLI_API_KEY
// is rejected 401 ("invalid verification"). This launcher keeps them separate and
// prefers the dev key, so `npm start` / `npm run dev` "just work" — without secrets
// in git.
//
// Credential sources, in priority order:
//   1. env OW_DEV_KEY                          (dev key, Bearer)
//   2. env OW_CLI_EMAIL + OW_CLI_API_KEY       (API key, Key)
//   3. a dev key on disk — a `devKey=` line in ~/.ow-cli/credentials (or ~/.ow/…),
//      or a standalone token file ~/.ow-cli/dev-key (or ~/.ow/dev-key)  → OW_DEV_KEY
//   4. an API key on disk — email+apiKey in the [default] (or $OW_PROFILE) profile
//      of the credentials file                → OW_CLI_EMAIL + OW_CLI_API_KEY
//
// `node scripts/ow-dev.mjs --check` reports which source resolved and exits without
// launching — handy for confirming dev-mode auth is wired before starting the app.
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { resolveOwCredentials } from './lib/owCredentials.mjs';

/**
 * The app's persisted Dev Mode toggle (config.local.json → ui.devMode), set from
 * the in-app Settings screen. Absent/unreadable ⇒ enabled (preserves prior
 * behavior); an explicit `false` is the off switch. config.local.json lives in
 * Electron's userData for `ow.vantage` (= %APPDATA%\ow.vantage on Windows).
 */
function devModeEnabled() {
  const roaming = process.env.APPDATA || path.join(homedir(), 'AppData', 'Roaming');
  const configFile = path.join(roaming, 'ow.vantage', 'config.local.json');
  try {
    const config = JSON.parse(readFileSync(configFile, 'utf8'));
    return config?.ui?.devMode !== false;
  } catch {
    return true;
  }
}

/** Put dev credentials into the env ow-electron reads. Returns a status string or null. */
function ensureDevCredentials() {
  const result = resolveOwCredentials({ env: process.env });
  if (!result) return null;
  if (result.devKey) process.env.OW_DEV_KEY ??= result.devKey;
  if (result.email) process.env.OW_CLI_EMAIL ??= result.email;
  if (result.apiKey) process.env.OW_CLI_API_KEY ??= result.apiKey;
  return result.source;
}

const enabled = devModeEnabled();
let source = null;
if (!enabled) {
  // Turned off in Settings (ui.devMode:false): launch WITHOUT dev credentials so
  // owepm skips the gaming packages. Strip any inherited creds too, so an env var
  // set in this shell can't override the app's off switch.
  delete process.env.OW_DEV_KEY;
  delete process.env.OW_CLI_EMAIL;
  delete process.env.OW_CLI_API_KEY;
  console.log('[ow-dev] Dev Mode is OFF (ui.devMode:false in Settings) — launching without dev credentials; GEP will not attach.');
} else {
  source = ensureDevCredentials();
  if (source) {
    console.log(`[ow-dev] Dev Mode credentials from ${source}`);
  } else {
    console.warn('[ow-dev] No Dev Mode credentials found.');
    console.warn('[ow-dev]   Dev key:  set OW_DEV_KEY, or put the token in ~/.ow-cli/dev-key');
    console.warn('[ow-dev]   API key:  run `ow config`, or set OW_CLI_EMAIL + OW_CLI_API_KEY');
    console.warn('[ow-dev]   Without one, ow-electron skips the gaming packages and GEP will not attach.');
  }
}

const args = process.argv.slice(2);

// `--check`: report status and exit without launching. Exit 1 only when Dev Mode
// is enabled but no credentials resolved (a real misconfiguration); an
// intentional OFF state exits 0.
if (args.includes('--check')) {
  process.exit(enabled && !source ? 1 : 0);
}

// Resolve the ow-electron bin explicitly so this works both via npm (which puts
// node_modules/.bin on PATH) and when run standalone.
const binName = process.platform === 'win32' ? 'ow-electron.cmd' : 'ow-electron';
const localBin = path.join(process.cwd(), 'node_modules', '.bin', binName);
const owElectron = existsSync(localBin) ? localBin : 'ow-electron';

const forwarded = args.length ? args : ['.'];
const child = spawn(owElectron, forwarded, { stdio: 'inherit', shell: true, env: process.env });
child.on('close', (code) => process.exit(code ?? 0));
child.on('error', (err) => {
  console.error(`[ow-dev] failed to launch ow-electron: ${err.message}`);
  process.exit(1);
});
