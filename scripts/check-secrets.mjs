// Pre-commit secret guard — scans STAGED additions for high-signal secret patterns and
// blocks the commit if any match. A mechanical backstop for CLAUDE.md guardrail #2
// ("no secrets in git"); not a full secret scanner.
//
// Enable once per clone:  git config core.hooksPath .githooks
// (invoked by .githooks/pre-commit)
//
// The pattern list and the pure line-scanning logic are exported so they can be unit
// tested (test/checkSecrets.test.ts) without staging real git content; the CLI
// behaviour below (git plumbing, console output, exit codes) is unchanged.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Secret-shaped content patterns to flag in added diff lines.
 * @type {{name: string, re: RegExp}[]}
 */
export const PATTERNS = [
  { name: 'TOTP enrollment URI', re: /otpauth:\/\// },
  { name: 'private key block', re: /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/ },
  { name: 'signing credential value', re: /ES_(?:TOTP_SECRET|PASSWORD)\s*[:=]\s*['"]?\S/ },
  { name: 'Notion token', re: /\b(?:ntn|secret)_[A-Za-z0-9]{32,}/ },
  // OW_CLI_EMAIL/OW_CLI_API_KEY/OW_BUILD_KEY are the credentials app-builder-lib's
  // Overwolf signer reads from the environment (see scripts/ow-build-env.mjs). The
  // `(?!\$)` guard keeps this from tripping on a variable reference such as
  // publish-release.ps1's `$env:OW_BUILD_KEY = $owEnv.buildKey` — only a literal
  // value (not a `$`-prefixed variable) after the `:`/`=` counts as a match.
  { name: 'Overwolf build/API credential value', re: /OW_(?:BUILD_KEY|CLI_API_KEY)\s*[:=]\s*['"]?(?!\$)\S/ },
];

// Paths where these tokens legitimately appear as prose / regex patterns (never real
// secrets): the signing docs' history section, this scanner, and the hook itself.
//
// The test exemptions are narrow on purpose. These three suites test credential
// resolution and secret scanning, so their fixtures MUST contain secret-shaped strings
// (`OW_BUILD_KEY: 'env-build-key'`); without the exemption the guard fires on honest work
// and teaches contributors to reach for `--no-verify`, which costs more than it protects.
// Listed file-by-file rather than exempting `test/` wholesale, so a real secret pasted
// into any other test is still caught.
export const ALLOW = [
  /^docs\//,
  /^scripts\/check-secrets\.mjs$/,
  /^\.githooks\//,
  /^test\/checkSecrets\.test\.ts$/,
  /^test\/owBuildEnv\.test\.ts$/,
  /^test\/owCredentials\.test\.ts$/,
];

/**
 * Scan the added (`+`) lines of a unified diff — as produced by
 * `git diff --cached -U0 --diff-filter=ACM` — for secret-shaped content,
 * skipping allow-listed paths.
 * @param {string} diffText unified diff text
 * @returns {string[]} findings, one per match: "<file>: possible <pattern name>"
 */
export function findSecrets(diffText) {
  const findings = [];
  let file = null;
  for (const line of diffText.split(/\r?\n/)) {
    const header = /^\+\+\+ b\/(.+)$/.exec(line);
    if (header) {
      file = header[1];
      continue;
    }
    if (!file || line[0] !== '+' || line.startsWith('+++')) continue;
    if (ALLOW.some((re) => re.test(file))) continue;
    for (const p of PATTERNS) {
      if (p.re.test(line)) findings.push(`${file}: possible ${p.name}`);
    }
  }
  return findings;
}

function main() {
  const git = (args) => execFileSync('git', args, { encoding: 'utf8' });
  const findings = [];

  // 1. Block newly-added private-key bundles by extension.
  const staged = git(['diff', '--cached', '--name-only', '--diff-filter=ACM'])
    .split(/\r?\n/)
    .filter(Boolean);
  for (const f of staged) {
    if (/\.(pfx|p12)$/i.test(f)) findings.push(`${f}: adds a private-key bundle — keep it out of git`);
  }

  // 2. Scan added lines of non-allowlisted files for secret-shaped content.
  const diff = git(['diff', '--cached', '-U0', '--diff-filter=ACM']);
  findings.push(...findSecrets(diff));

  if (findings.length) {
    console.error('\n✖ check-secrets blocked this commit:\n');
    for (const f of [...new Set(findings)]) console.error(`  - ${f}`);
    console.error('\nRemove the secret (store it in a password manager). If it is a false positive,');
    console.error('adjust scripts/check-secrets.mjs, or bypass with `git commit --no-verify` as a last resort.\n');
    process.exit(1);
  }
}

// Run the CLI only when invoked directly (not when imported by the test).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
