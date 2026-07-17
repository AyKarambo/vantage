// Resolve the three env vars ow-electron-builder's Overwolf signer needs, and
// report them as JSON — so the release/publish flow (scripts/publish-release.ps1,
// task T4) can consume the result without reimplementing any resolution logic.
//
// The stable @overwolf/app-builder-lib@26.9.0 signs the build against Overwolf's
// backend. Its signer (node_modules/@overwolf/app-builder-lib/out/codeSign/
// owBuildCertificateSigner.js) reads exactly OW_CLI_EMAIL, OW_CLI_API_KEY and
// OW_BUILD_KEY from process.env. Without them it only logs a warning and ships an
// UNSIGNED package (GEP then refuses to load for end users) — so the publish flow
// needs to fail fast, with a clear message, *before* burning a build on that.
//
// Email + apiKey reuse scripts/lib/owCredentials.mjs's precedence chain (env, then
// the ow-cli credentials file) — note a *dev key* is NOT a build credential; a
// devKey-only resolution does not satisfy OW_CLI_EMAIL/OW_CLI_API_KEY here. The
// build key is new logic, resolved the same way as owCredentials.mjs's standalone
// dev-key token file:
//   1. env OW_BUILD_KEY
//   2. a standalone token file ~/.ow-cli/build-key (or ~/.ow/build-key)
//
// Secrets: the --json output necessarily carries the resolved values (that's the
// point — publish-release.ps1 assigns them to $env: vars). Every OTHER output path
// (the default human-readable summary, warnings) must name only the missing
// variables, never a value.
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiKeyFromFile } from './lib/owCredentials.mjs';

// Standalone build-key token files (just the token, nothing else) — same
// two-location pattern as owCredentials.mjs's DEV_KEY_FILES.
export const BUILD_KEY_FILES = [
  path.join(homedir(), '.ow-cli', 'build-key'),
  path.join(homedir(), '.ow', 'build-key'),
];

/**
 * Resolve the Overwolf build key: env OW_BUILD_KEY first, then the first
 * non-empty standalone token file. Pure/injectable so tests never touch the
 * real ~/.ow-cli.
 * @param {{env?: NodeJS.ProcessEnv, buildKeyFiles?: string[]}} [opts]
 * @returns {string|undefined}
 */
export function resolveBuildKey(opts = {}) {
  const env = opts.env || process.env;
  const buildKeyFiles = opts.buildKeyFiles || BUILD_KEY_FILES;

  if (env.OW_BUILD_KEY) return env.OW_BUILD_KEY;

  for (const file of buildKeyFiles) {
    if (!existsSync(file)) continue;
    try {
      const token = readFileSync(file, 'utf8').trim();
      if (token) return token;
    } catch (err) {
      console.warn(`[ow-build-env] could not read ${file}: ${err.message}`);
    }
  }
  return undefined;
}

/**
 * Resolve all three credentials ow-electron-builder's signer needs and report
 * which are missing by env-var name (never a value), so callers can fail fast
 * without ever logging a secret.
 *
 * Deliberately does NOT go through `resolveOwCredentials`: that function answers
 * Dev Mode's question ("which single credential should ow-electron authenticate
 * with?"), where a dev key legitimately wins and short-circuits the rest. The
 * builder's question is different — it needs the email+apiKey PAIR, and a dev key
 * is simply irrelevant to it. Routing through the dev-mode chain made any dev key
 * on the machine (env or `~/.ow-cli/dev-key`, which this repo's own onboarding
 * docs tell you to create) suppress an `ow config` API key sitting in the very
 * same file, aborting the release with "run `ow config`" — advice the user had
 * already followed. `apiKeyFromFile` is the primitive that answers this question;
 * call it directly.
 * @param {{env?: NodeJS.ProcessEnv, profile?: string, credentialFiles?: string[], buildKeyFiles?: string[]}} [opts]
 * @returns {{email?: string, apiKey?: string, buildKey?: string, missing: string[]}}
 */
export function resolveBuildEnv(opts = {}) {
  const env = opts.env || process.env;
  const profile = opts.profile || env.OW_PROFILE || 'default';

  // Env wins only as a complete pair, mirroring how ow-dev.mjs treats these two;
  // a half-set environment falls back to the file rather than resolving to a
  // mismatched email/key from two different sources.
  let email;
  let apiKey;
  if (env.OW_CLI_EMAIL && env.OW_CLI_API_KEY) {
    email = env.OW_CLI_EMAIL;
    apiKey = env.OW_CLI_API_KEY;
  } else {
    const fromFile = apiKeyFromFile(profile, opts.credentialFiles);
    email = fromFile?.email;
    apiKey = fromFile?.apiKey;
  }
  const buildKey = resolveBuildKey({ env, buildKeyFiles: opts.buildKeyFiles });

  const missing = [];
  if (!email) missing.push('OW_CLI_EMAIL');
  if (!apiKey) missing.push('OW_CLI_API_KEY');
  if (!buildKey) missing.push('OW_BUILD_KEY');

  const result = { missing };
  if (email) result.email = email;
  if (apiKey) result.apiKey = apiKey;
  if (buildKey) result.buildKey = buildKey;
  return result;
}

function main() {
  const info = resolveBuildEnv({ env: process.env });

  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(info)}\n`);
    return;
  }

  if (info.missing.length) {
    console.error(`[ow-build-env] missing: ${info.missing.join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log('[ow-build-env] OW_CLI_EMAIL, OW_CLI_API_KEY and OW_BUILD_KEY all resolved.');
  }
}

// Run the CLI only when invoked directly (not when imported by the test).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
