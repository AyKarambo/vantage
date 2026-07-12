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

// @overwolf/ow-cli 0.1.x writes to ~/.ow-cli/credentials; the dev-mode docs name
// ~/.ow/credentials. Check both, in that order, so this survives a CLI path change.
const CREDENTIAL_FILES = [
  path.join(homedir(), '.ow-cli', 'credentials'),
  path.join(homedir(), '.ow', 'credentials'),
];
// Standalone dev-key token files (just the token, nothing else).
const DEV_KEY_FILES = [
  path.join(homedir(), '.ow-cli', 'dev-key'),
  path.join(homedir(), '.ow', 'dev-key'),
];

/** Parse the ow-cli INI-ish credentials file into { profile: { key: value } }. */
function parseCredentials(text) {
  const profiles = {};
  let current = '';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const header = line.match(/^\[(?<name>\w+)\]$/);
    if (header) {
      current = header.groups.name;
      profiles[current] = {};
      continue;
    }
    const eq = line.indexOf('=');
    if (eq > 0 && current) profiles[current][line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return profiles;
}

/** A dev key on disk: a `devKey=` line in a credentials file, or a dev-key token file. */
function devKeyFromFile(profile) {
  for (const file of CREDENTIAL_FILES) {
    if (!existsSync(file)) continue;
    try {
      const token = parseCredentials(readFileSync(file, 'utf8'))[profile]?.devKey;
      if (token) return { token, file: `${file} [${profile}] devKey` };
    } catch (err) {
      console.warn(`[ow-dev] could not read ${file}: ${err.message}`);
    }
  }
  for (const file of DEV_KEY_FILES) {
    if (!existsSync(file)) continue;
    try {
      const token = readFileSync(file, 'utf8').trim();
      if (token) return { token, file };
    } catch (err) {
      console.warn(`[ow-dev] could not read ${file}: ${err.message}`);
    }
  }
  return null;
}

/** First credentials file that yields `profile` with email+apiKey, or null. */
function apiKeyFromFile(profile) {
  for (const file of CREDENTIAL_FILES) {
    if (!existsSync(file)) continue;
    try {
      const creds = parseCredentials(readFileSync(file, 'utf8'))[profile];
      if (creds?.email && creds?.apiKey) return { ...creds, file };
    } catch (err) {
      console.warn(`[ow-dev] could not read ${file}: ${err.message}`);
    }
  }
  return null;
}

/** Put dev credentials into the env ow-electron reads. Returns a status string or null. */
function ensureDevCredentials() {
  if (process.env.OW_DEV_KEY) return 'env: OW_DEV_KEY (dev key, bearer)';
  if (process.env.OW_CLI_EMAIL && process.env.OW_CLI_API_KEY) return 'env: OW_CLI_EMAIL + OW_CLI_API_KEY (api key)';

  const profile = process.env.OW_PROFILE || 'default';

  const dev = devKeyFromFile(profile);
  if (dev) {
    process.env.OW_DEV_KEY = dev.token;
    return `file: ${dev.file} (dev key, bearer)`;
  }

  const api = apiKeyFromFile(profile);
  if (api) {
    process.env.OW_CLI_EMAIL ??= api.email;
    process.env.OW_CLI_API_KEY ??= api.apiKey;
    return `file: ${api.file} [${profile}] (api key: ${api.email})`;
  }
  return null;
}

const source = ensureDevCredentials();
if (source) {
  console.log(`[ow-dev] Dev Mode credentials from ${source}`);
} else {
  console.warn('[ow-dev] No Dev Mode credentials found.');
  console.warn('[ow-dev]   Dev key:  set OW_DEV_KEY, or put the token in ~/.ow-cli/dev-key');
  console.warn('[ow-dev]   API key:  run `ow config`, or set OW_CLI_EMAIL + OW_CLI_API_KEY');
  console.warn('[ow-dev]   Without one, ow-electron skips the gaming packages and GEP will not attach.');
}

const args = process.argv.slice(2);

// `--check`: report status and exit without launching the app.
if (args.includes('--check')) {
  process.exit(source ? 0 : 1);
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
