import { describe, it, expect } from 'vitest';
import { findSecrets, PATTERNS, ALLOW } from '../scripts/check-secrets.mjs';

/** Build a minimal unified diff adding `lines` to `file`, matching what
 * `git diff --cached -U0 --diff-filter=ACM` produces — the shape findSecrets() parses. */
function diffFor(file: string, lines: string[]): string {
  const hunk = `@@ -0,0 +1,${lines.length} @@\n`;
  return `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n${hunk}${lines.map((l) => `+${l}`).join('\n')}\n`;
}

describe('findSecrets — Overwolf build/API credential pattern', () => {
  it('flags a hardcoded OW_BUILD_KEY literal (= form, unquoted)', () => {
    const findings = findSecrets(diffFor('scripts/foo.mjs', ['OW_BUILD_KEY=abc123']));
    expect(findings).toEqual(['scripts/foo.mjs: possible Overwolf build/API credential value']);
  });

  it('flags a hardcoded OW_CLI_API_KEY literal (= form, quoted)', () => {
    const findings = findSecrets(diffFor('scripts/foo.mjs', ['OW_CLI_API_KEY="abc123"']));
    expect(findings).toEqual(['scripts/foo.mjs: possible Overwolf build/API credential value']);
  });

  it('flags the : (object-property) form for either variable', () => {
    expect(findSecrets(diffFor('scripts/foo.mjs', ["OW_BUILD_KEY: 'abc123'"]))).toHaveLength(1);
    expect(findSecrets(diffFor('scripts/foo.mjs', ["OW_CLI_API_KEY: 'abc123'"]))).toHaveLength(1);
  });

  it('does not flag a bare mention of the variable name in prose or code', () => {
    expect(findSecrets(diffFor('scripts/foo.mjs', ['// see OW_BUILD_KEY for details']))).toEqual([]);
    expect(
      findSecrets(diffFor('scripts/foo.mjs', ['if (env.OW_BUILD_KEY) return env.OW_BUILD_KEY;']))
    ).toEqual([]);
    expect(
      findSecrets(diffFor('scripts/foo.mjs', ["missing.push('OW_CLI_API_KEY');"]))
    ).toEqual([]);
  });

  it('does not flag the real publish-release.ps1 lines that assign from a variable', () => {
    // Exact lines from scripts/publish-release.ps1 — these read $owEnv fields, they
    // never contain a literal secret, so the scanner must not fire on them.
    const lines = [
      '$env:OW_CLI_EMAIL = $owEnv.email',
      '$env:OW_CLI_API_KEY = $owEnv.apiKey',
      '$env:OW_BUILD_KEY = $owEnv.buildKey',
      "foreach ($v in 'OW_CLI_EMAIL', 'OW_CLI_API_KEY', 'OW_BUILD_KEY', 'OW_REQUIRE_SIGNING') {",
    ];
    expect(findSecrets(diffFor('scripts/publish-release.ps1', lines))).toEqual([]);
  });

  it('does not flag scripts/ow-build-env.mjs-style reads/resolution code', () => {
    const lines = [
      'if (env.OW_BUILD_KEY) return env.OW_BUILD_KEY;',
      "if (!buildKey) missing.push('OW_BUILD_KEY');",
      "if (!apiKey) missing.push('OW_CLI_API_KEY');",
    ];
    expect(findSecrets(diffFor('scripts/ow-build-env.mjs', lines))).toEqual([]);
  });

  it('respects the docs/ allowlist for these variable names too', () => {
    expect(findSecrets(diffFor('docs/onboarding/01-getting-started.md', ['OW_BUILD_KEY=abc123']))).toEqual(
      []
    );
  });
});

describe('findSecrets — pre-existing patterns keep working', () => {
  it('still flags the legacy ES_TOTP_SECRET literal', () => {
    expect(findSecrets(diffFor('scripts/x.mjs', ['ES_TOTP_SECRET=abcdef']))).toEqual([
      'scripts/x.mjs: possible signing credential value',
    ]);
  });

  it('still flags the legacy ES_PASSWORD literal (quoted, colon form)', () => {
    expect(findSecrets(diffFor('scripts/x.mjs', ['ES_PASSWORD: "hunter2"']))).toHaveLength(1);
  });

  it('still flags an otpauth:// TOTP enrollment URI', () => {
    expect(findSecrets(diffFor('scripts/x.mjs', ['const uri = "otpauth://totp/x";']))).toEqual([
      'scripts/x.mjs: possible TOTP enrollment URI',
    ]);
  });

  it('still flags a PEM private key header', () => {
    expect(findSecrets(diffFor('scripts/x.mjs', ['-----BEGIN PRIVATE KEY-----']))).toEqual([
      'scripts/x.mjs: possible private key block',
    ]);
  });

  it('still flags a Notion integration token', () => {
    const token = `secret_${'a'.repeat(32)}`;
    expect(findSecrets(diffFor('scripts/x.mjs', [`const t = "${token}";`]))).toEqual([
      'scripts/x.mjs: possible Notion token',
    ]);
  });
});

describe('exports used by the scanner', () => {
  it('PATTERNS includes the new Overwolf credential entry alongside the untouched legacy ones', () => {
    const names = PATTERNS.map((p) => p.name);
    expect(names).toContain('Overwolf build/API credential value');
    expect(names).toContain('signing credential value');
    expect(names).toContain('TOTP enrollment URI');
    expect(names).toContain('private key block');
    expect(names).toContain('Notion token');
  });

  it('ALLOW still covers docs/, the scanner itself, and .githooks/', () => {
    expect(ALLOW.some((re) => re.test('docs/onboarding/01-getting-started.md'))).toBe(true);
    expect(ALLOW.some((re) => re.test('scripts/check-secrets.mjs'))).toBe(true);
    expect(ALLOW.some((re) => re.test('.githooks/pre-commit'))).toBe(true);
  });
});
