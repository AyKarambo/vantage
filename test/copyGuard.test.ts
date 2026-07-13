import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

/**
 * Guards Area I's copy cleanup: About/onboarding/README/docs must never again
 * claim a ban-risk guarantee. "account-safe" stays fine everywhere — it's a
 * neutral descriptor, not a promise — this only flags the stronger phrasing.
 *
 * Scanned paths are deliberately narrow: `renderer/`, `README.md`, `CLAUDE.md`
 * and `docs/` are the user- and contributor-facing surfaces Area I rewrote.
 * `specs/` is intentionally excluded (specs describe intent/history and may
 * legitimately narrate the old wording as something that was removed), and
 * `test/` is excluded so this file can name the very phrases it forbids
 * without failing on itself.
 */

const ROOT = path.resolve(__dirname, '..');

const SCAN_TARGETS = ['renderer', 'README.md', 'CLAUDE.md', 'docs'].map((p) => path.join(ROOT, p));

// Only text-ish files are worth reading — binary assets (icons, screenshots)
// live under docs/ and renderer/ too and would just be wasted, garbled reads.
const TEXT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.md', '.html', '.css', '.json', '.txt']);

const BAN_PHRASE = /ban risk|zero-ban-risk guarantee/i;

/** Recursively collect every text-ish file under `target` (or `[target]` if
 *  it's already a file). */
function collectTextFiles(target: string): string[] {
  const stat = fs.statSync(target);
  if (stat.isFile()) {
    return TEXT_EXTENSIONS.has(path.extname(target)) ? [target] : [];
  }
  const out: string[] = [];
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    // Skip dependencies and build output — this guard checks authored copy, not
    // compiled bundles (renderer/dist, the renderer/preview harness), which are
    // gitignored and can carry a stale copy of pre-cleanup source.
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'preview') continue;
    out.push(...collectTextFiles(path.join(target, entry.name)));
  }
  return out;
}

describe('copy guard — no ban-risk guarantee language', () => {
  it('never reintroduces "ban risk" / "zero-ban-risk guarantee" in renderer/, README.md, CLAUDE.md, or docs/', () => {
    const offenders: string[] = [];
    for (const target of SCAN_TARGETS) {
      if (!fs.existsSync(target)) continue;
      for (const file of collectTextFiles(target)) {
        const text = fs.readFileSync(file, 'utf8');
        if (BAN_PHRASE.test(text)) offenders.push(path.relative(ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
