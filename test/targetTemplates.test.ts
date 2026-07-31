import { describe, it, expect } from 'vitest';
import {
  TARGET_CATEGORIES, TARGET_LIBRARY, MEASURED_STATS, parseMeasuredRule,
} from '../src/core/targets';

// Source of truth for these two constants is renderer/src/views/targets/builder.ts
// (STATS list and the edit() round-trip regex). That file is not imported here —
// it pulls in ../../dom, which touches `document` at import time and has no place
// in a core-logic vitest run — so the contract is duplicated and locked by this test.
const BUILDER_STATS = ['Deaths', 'Eliminations', 'Assists', 'Damage', 'Healing', 'Mitigation', 'KDA'];
const BUILDER_RULE_RE = /^(.+) (≤|≥|=) (.+)$/;

describe('TARGET_LIBRARY', () => {
  it('every entry has a non-empty name and blurb', () => {
    for (const t of TARGET_LIBRARY) {
      expect(t.name.trim().length).toBeGreaterThan(0);
      expect(t.blurb.trim().length).toBeGreaterThan(0);
    }
  });

  it('every entry has a valid mode', () => {
    for (const t of TARGET_LIBRARY) {
      expect(['self', 'measured']).toContain(t.mode);
    }
  });

  it('self-rated entries use the exact grading rule string', () => {
    for (const t of TARGET_LIBRARY.filter((x) => x.mode === 'self')) {
      expect(t.rule).toBe('You grade it');
    }
  });

  it('measured entries round-trip through the builder\'s parse regex with a known stat and finite value', () => {
    for (const t of TARGET_LIBRARY.filter((x) => x.mode === 'measured')) {
      const match = t.rule.match(BUILDER_RULE_RE);
      expect(match, `rule "${t.rule}" must match ${BUILDER_RULE_RE}`).not.toBeNull();
      const [, stat, op, value] = match!;
      expect(BUILDER_STATS).toContain(stat);
      expect(['≤', '≥', '=']).toContain(op);
      expect(Number.isFinite(Number(value.replace(/,/g, '')))).toBe(true);
    }
  });

  it('has both self and measured modes represented', () => {
    const modes = new Set(TARGET_LIBRARY.map((t) => t.mode));
    expect(modes.has('self')).toBe(true);
    expect(modes.has('measured')).toBe(true);
  });

  it('has no duplicate names', () => {
    const names = TARGET_LIBRARY.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('every measured entry\'s stat is a recognized measured stat', () => {
    for (const t of TARGET_LIBRARY.filter((x) => x.mode === 'measured')) {
      const parsed = parseMeasuredRule(t.rule);
      expect(parsed).not.toBeNull();
      expect(MEASURED_STATS).toContain(parsed!.stat);
    }
  });

  it('every entry\'s category is one of the four TARGET_CATEGORIES ids', () => {
    const ids = new Set(TARGET_CATEGORIES.map((c) => c.id));
    for (const t of TARGET_LIBRARY) {
      expect(ids.has(t.category)).toBe(true);
    }
  });

  it('every category has at least 4 entries', () => {
    for (const { id } of TARGET_CATEGORIES) {
      const count = TARGET_LIBRARY.filter((t) => t.category === id).length;
      expect(count).toBeGreaterThanOrEqual(4);
    }
  });

  it('every role is represented across the library', () => {
    const roles = new Set(TARGET_LIBRARY.map((t) => t.role));
    for (const role of ['Tank', 'DPS', 'Support', 'All Roles'] as const) {
      expect(roles.has(role)).toBe(true);
    }
  });
});

describe('TARGET_CATEGORIES', () => {
  it('has exactly the four categories, in order', () => {
    expect(TARGET_CATEGORIES.map((c) => c.id)).toEqual(['Mechanics', 'Macro', 'Strategy', 'Training']);
  });

  it('every category has a non-empty scope blurb', () => {
    for (const c of TARGET_CATEGORIES) {
      expect(c.scope.trim().length).toBeGreaterThan(0);
    }
  });
});
