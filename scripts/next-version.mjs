// Compute the next release version from git tags + Conventional Commits.
//
// Tag-driven, same rules the old auto-release workflow ran inline in bash: take the
// latest `v*` tag as the base (0.0.0 if none), scan the commit subjects/bodies since it,
// and bump — a `type!:` subject or `BREAKING CHANGE` footer -> major, a `feat:` -> minor,
// anything else -> patch. This module only COMPUTES; applying the version (npm version)
// and tagging live in scripts/publish-release.ps1.
//
// The bump/parse logic is pure and unit-tested (test/nextVersion.test.ts); the git I/O is
// a thin wrapper. Zero dependencies, pure Node ESM.
//
// CLI:
//   node scripts/next-version.mjs            -> "0.2.0"        (bare version, scriptable)
//   node scripts/next-version.mjs --tag      -> "v0.2.0"
//   node scripts/next-version.mjs --json     -> {"lastTag":…,"base":…,"level":…,"version":…,"tag":…}
//   node scripts/next-version.mjs --check    -> human summary, exit 0 (CI-informational; never mutates)
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * Determine the SemVer bump level from a block of commit messages.
 * @param {string} commitLog concatenated commit subjects + bodies (e.g. `git log --format=%B`)
 * @returns {'major'|'minor'|'patch'}
 */
export function detectBumpLevel(commitLog) {
  const lines = commitLog.split(/\r?\n/);
  const breaking =
    /BREAKING[ -]CHANGE/.test(commitLog) || lines.some((l) => /^[a-z]+(\([^)]*\))?!:/i.test(l));
  if (breaking) return 'major';
  if (lines.some((l) => /^feat(\([^)]*\))?:/i.test(l))) return 'minor';
  return 'patch';
}

/**
 * Apply a bump level to a `major.minor.patch` base version.
 * @param {string} base e.g. "0.1.0"
 * @param {'major'|'minor'|'patch'} level
 * @returns {string} the bumped version
 */
export function bumpVersion(base, level) {
  const [major, minor, patch] = base.split('.').map(Number);
  if ([major, minor, patch].some(Number.isNaN)) throw new Error(`next-version: bad base version "${base}"`);
  if (level === 'major') return `${major + 1}.0.0`;
  if (level === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/**
 * Compute the next release version from the repo's tags + commit history.
 * @param {{cwd?: string}} [opts]
 * @returns {{lastTag: string|null, base: string, level: 'major'|'minor'|'patch', version: string, tag: string}}
 */
export function computeNextVersion({ cwd = process.cwd() } = {}) {
  let lastTag = '';
  try {
    lastTag = git(['describe', '--tags', '--match', 'v*', '--abbrev=0'], cwd);
  } catch {
    lastTag = ''; // no v* tag yet
  }
  const base = lastTag ? lastTag.replace(/^v/, '') : '0.0.0';
  const range = lastTag ? `${lastTag}..HEAD` : 'HEAD';
  const log = git(['log', range, '--format=%B'], cwd);
  const level = detectBumpLevel(log);
  const version = bumpVersion(base, level);
  return { lastTag: lastTag || null, base, level, version, tag: `v${version}` };
}

function main() {
  const flag = process.argv[2];
  const info = computeNextVersion();
  if (flag === '--json') {
    process.stdout.write(`${JSON.stringify(info)}\n`);
  } else if (flag === '--tag') {
    process.stdout.write(`${info.tag}\n`);
  } else if (flag === '--check') {
    process.stdout.write(
      `next release: ${info.tag} (${info.level}) — from ${info.lastTag ?? '<no tag>'} (base ${info.base})\n`
    );
  } else {
    process.stdout.write(`${info.version}\n`);
  }
}

// Run the CLI only when invoked directly (not when imported by the test).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
