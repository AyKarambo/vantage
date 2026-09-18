import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

/**
 * K4: a handful of surfaces bypassed both the CSS custom properties and
 * `PALETTE` with hard-coded rgba()/hex literals for red/green/amber, so under
 * the colour-blind winrate scheme they kept showing red/green regardless —
 * the scatter focus band, "Top priority", the Review grade pills, the active
 * Loss choice border, the stale GEP pulse ring and the window-close hover.
 * Amber specifically carried five unrelated meanings through two different
 * frozen literals. This scans the actual shipped source for their return so
 * a future change can't reintroduce them without deliberately updating this
 * test (and, with it, actually thinking about why).
 *
 * Token DEFINITIONS (tokens.css's own `--warn-soft`/`--warn-border` etc.) are
 * exempted — this guards call sites, not the one legitimate place the value
 * is allowed to exist as a literal.
 */

const RENDERER_SRC = join(__dirname, '..', 'renderer', 'src');
const RENDERER_STYLES = join(__dirname, '..', 'renderer', 'styles');
const EXEMPT_FILES = new Set(['tokens.css']); // the tokens' own definitions

const BANNED_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'loss-ish red rgba(209,104,95,…)', re: /209,\s*104,\s*95/ },
  { name: 'loss-ish red hex #c98079', re: /#c98079/i },
  { name: 'stale win-green rgba(87,166,132,…) (didn\'t even match --win-soft)', re: /87,\s*166,\s*132/ },
  { name: 'amber rgba(214,162,79,…) outside tokens.css', re: /214,\s*162,\s*79/ },
  { name: 'amber rgba(188,169,118,…) outside tokens.css', re: /188,\s*169,\s*118/ },
];

function walk(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p, exts));
    else if (exts.includes(extname(entry))) out.push(p);
  }
  return out;
}

const SOURCE_FILES = [
  ...walk(RENDERER_SRC, ['.ts']),
  ...walk(RENDERER_STYLES, ['.css']),
].filter((f) => !EXEMPT_FILES.has(f.split(/[\\/]/).pop()!));

describe('colour tokens — no hard-coded literals that bypass the winrate scheme (K4)', () => {
  for (const { name, re } of BANNED_PATTERNS) {
    it(`no source file reintroduces ${name}`, () => {
      const offenders = SOURCE_FILES
        .map((f) => ({ f, text: readFileSync(f, 'utf8') }))
        .filter(({ text }) => re.test(text))
        .map(({ f }) => f.replace(join(__dirname, '..') + '\\', '').replace(join(__dirname, '..') + '/', ''));
      expect(offenders).toEqual([]);
    });
  }

  it('no renderer file passes class: \'btn--danger\' directly instead of variant: \'danger\'', () => {
    const offenders = walk(RENDERER_SRC, ['.ts'])
      .filter((f) => readFileSync(f, 'utf8').includes("class: 'btn--danger'"));
    expect(offenders).toEqual([]);
  });
});
