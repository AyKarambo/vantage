import { describe, it, expect } from 'vitest';
import { TARGET_TEMPLATES } from '../src/core/targets';

// Source of truth for these two constants is renderer/src/views/targets/builder.ts
// (STATS list and the edit() round-trip regex). That file is not imported here —
// it pulls in ../../dom, which touches `document` at import time and has no place
// in a core-logic vitest run — so the contract is duplicated and locked by this test.
const BUILDER_STATS = ['Deaths', 'Eliminations', 'Assists', 'Damage', 'Healing', 'Mitigation', 'KDA'];
const BUILDER_RULE_RE = /^(.+) (≤|≥|=) (.+)$/;

describe('TARGET_TEMPLATES', () => {
  it('has a handful of curated entries', () => {
    expect(TARGET_TEMPLATES.length).toBeGreaterThanOrEqual(5);
    expect(TARGET_TEMPLATES.length).toBeLessThanOrEqual(8);
  });

  it('every template has a non-empty name and blurb', () => {
    for (const t of TARGET_TEMPLATES) {
      expect(t.name.trim().length).toBeGreaterThan(0);
      expect(t.blurb.trim().length).toBeGreaterThan(0);
    }
  });

  it('every template has a valid mode', () => {
    for (const t of TARGET_TEMPLATES) {
      expect(['self', 'measured']).toContain(t.mode);
    }
  });

  it('self-rated templates use the exact grading rule string', () => {
    for (const t of TARGET_TEMPLATES.filter((x) => x.mode === 'self')) {
      expect(t.rule).toBe('You grade it');
    }
  });

  it('measured templates round-trip through the builder\'s parse regex with a known stat and finite value', () => {
    for (const t of TARGET_TEMPLATES.filter((x) => x.mode === 'measured')) {
      const match = t.rule.match(BUILDER_RULE_RE);
      expect(match, `rule "${t.rule}" must match ${BUILDER_RULE_RE}`).not.toBeNull();
      const [, stat, op, value] = match!;
      expect(BUILDER_STATS).toContain(stat);
      expect(['≤', '≥', '=']).toContain(op);
      expect(Number.isFinite(Number(value.replace(/,/g, '')))).toBe(true);
    }
  });

  it('has both self and measured modes represented', () => {
    const modes = new Set(TARGET_TEMPLATES.map((t) => t.mode));
    expect(modes.has('self')).toBe(true);
    expect(modes.has('measured')).toBe(true);
  });

  it('has no duplicate names', () => {
    const names = TARGET_TEMPLATES.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
