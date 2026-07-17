// Overwolf CLI credential resolution — shared between the Dev Mode launcher
// (scripts/ow-dev.mjs) and the release/publish flow. Pure file-reading +
// precedence logic only: no process.env mutation, no spawning ow-electron, no
// Vantage config reads (that stays in ow-dev.mjs's devModeEnabled()).
//
// Credential sources, in priority order (unchanged from ow-dev.mjs's original
// inline implementation — see that file's header comment for the full story):
//   1. env OW_DEV_KEY                          (dev key, Bearer)
//   2. env OW_CLI_EMAIL + OW_CLI_API_KEY       (API key, Key)
//   3. a dev key on disk — a `devKey=` line in ~/.ow-cli/credentials (or ~/.ow/…),
//      or a standalone token file ~/.ow-cli/dev-key (or ~/.ow/dev-key)
//   4. an API key on disk — email+apiKey in the [default] (or $OW_PROFILE) profile
//      of the credentials file
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

// @overwolf/ow-cli 0.1.x writes to ~/.ow-cli/credentials; the dev-mode docs name
// ~/.ow/credentials. Check both, in that order, so this survives a CLI path change.
export const CREDENTIAL_FILES = [
  path.join(homedir(), '.ow-cli', 'credentials'),
  path.join(homedir(), '.ow', 'credentials'),
];
// Standalone dev-key token files (just the token, nothing else).
export const DEV_KEY_FILES = [
  path.join(homedir(), '.ow-cli', 'dev-key'),
  path.join(homedir(), '.ow', 'dev-key'),
];

/** Parse the ow-cli INI-ish credentials file into { profile: { key: value } }. */
export function parseCredentials(text) {
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

/**
 * A dev key on disk: a `devKey=` line in a credentials file, or a dev-key token file.
 * @param {string} profile credentials-file section to read the `devKey=` line from
 * @param {string[]} [credentialFiles] override for tests; defaults to CREDENTIAL_FILES
 * @param {string[]} [devKeyFiles] override for tests; defaults to DEV_KEY_FILES
 * @returns {{token: string, file: string}|null}
 */
export function devKeyFromFile(profile, credentialFiles = CREDENTIAL_FILES, devKeyFiles = DEV_KEY_FILES) {
  for (const file of credentialFiles) {
    if (!existsSync(file)) continue;
    try {
      const token = parseCredentials(readFileSync(file, 'utf8'))[profile]?.devKey;
      if (token) return { token, file: `${file} [${profile}] devKey` };
    } catch (err) {
      console.warn(`[ow-dev] could not read ${file}: ${err.message}`);
    }
  }
  for (const file of devKeyFiles) {
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

/**
 * First credentials file that yields `profile` with email+apiKey, or null.
 * @param {string} profile credentials-file section to read
 * @param {string[]} [credentialFiles] override for tests; defaults to CREDENTIAL_FILES
 * @returns {{email: string, apiKey: string, file: string}|null}
 */
export function apiKeyFromFile(profile, credentialFiles = CREDENTIAL_FILES) {
  for (const file of credentialFiles) {
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

/**
 * Resolve Overwolf CLI credentials from env then disk, in priority order,
 * WITHOUT mutating `process.env` — callers assign the result themselves. This
 * purity is what lets tests avoid the real `~/.ow-cli/` (inject `credentialFiles`
 * / `devKeyFiles`) and lets other consumers (e.g. the release/publish flow)
 * reuse the same precedence chain.
 * @param {{profile?: string, env?: NodeJS.ProcessEnv, credentialFiles?: string[], devKeyFiles?: string[]}} [opts]
 * @returns {{devKey?: string, email?: string, apiKey?: string, source: string}|null}
 */
export function resolveOwCredentials(opts = {}) {
  const env = opts.env || process.env;
  const profile = opts.profile || env.OW_PROFILE || 'default';
  const credentialFiles = opts.credentialFiles || CREDENTIAL_FILES;
  const devKeyFiles = opts.devKeyFiles || DEV_KEY_FILES;

  if (env.OW_DEV_KEY) {
    return { devKey: env.OW_DEV_KEY, source: 'env: OW_DEV_KEY (dev key, bearer)' };
  }
  if (env.OW_CLI_EMAIL && env.OW_CLI_API_KEY) {
    return {
      email: env.OW_CLI_EMAIL,
      apiKey: env.OW_CLI_API_KEY,
      source: 'env: OW_CLI_EMAIL + OW_CLI_API_KEY (api key)',
    };
  }

  const dev = devKeyFromFile(profile, credentialFiles, devKeyFiles);
  if (dev) {
    return { devKey: dev.token, source: `file: ${dev.file} (dev key, bearer)` };
  }

  const api = apiKeyFromFile(profile, credentialFiles);
  if (api) {
    return { email: api.email, apiKey: api.apiKey, source: `file: ${api.file} [${profile}] (api key: ${api.email})` };
  }

  return null;
}
