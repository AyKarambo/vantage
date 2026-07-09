// Pre-commit secret guard — scans STAGED additions for high-signal secret patterns and
// blocks the commit if any match. A mechanical backstop for CLAUDE.md guardrail #2
// ("no secrets in git"); not a full secret scanner.
//
// Enable once per clone:  git config core.hooksPath .githooks
// (invoked by .githooks/pre-commit)
import { execFileSync } from 'node:child_process';

const PATTERNS = [
  { name: 'TOTP enrollment URI', re: /otpauth:\/\// },
  { name: 'private key block', re: /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/ },
  { name: 'signing credential value', re: /ES_(?:TOTP_SECRET|PASSWORD)\s*[:=]\s*['"]?\S/ },
  { name: 'Notion token', re: /\b(?:ntn|secret)_[A-Za-z0-9]{32,}/ },
];

// Paths where these tokens legitimately appear as prose / regex patterns (never real
// secrets): the signing docs' history section, this scanner, and the hook itself.
const ALLOW = [/^docs\//, /^scripts\/check-secrets\.mjs$/, /^\.githooks\//];

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
let file = null;
for (const line of diff.split(/\r?\n/)) {
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

if (findings.length) {
  console.error('\n✖ check-secrets blocked this commit:\n');
  for (const f of [...new Set(findings)]) console.error(`  - ${f}`);
  console.error('\nRemove the secret (store it in a password manager). If it is a false positive,');
  console.error('adjust scripts/check-secrets.mjs, or bypass with `git commit --no-verify` as a last resort.\n');
  process.exit(1);
}
