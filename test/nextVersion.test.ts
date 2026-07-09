import { describe, it, expect } from 'vitest';
import { detectBumpLevel, bumpVersion } from '../scripts/next-version.mjs';

describe('detectBumpLevel', () => {
  it('treats feat: as minor', () => {
    expect(detectBumpLevel('feat: add heatmap')).toBe('minor');
    expect(detectBumpLevel('feat(trends): add heatmap')).toBe('minor');
  });

  it('treats fix/chore/docs and unknown types as patch', () => {
    expect(detectBumpLevel('fix: correct rank parse')).toBe('patch');
    expect(detectBumpLevel('chore: bump deps')).toBe('patch');
    expect(detectBumpLevel('docs: tidy readme')).toBe('patch');
    expect(detectBumpLevel('wip on stuff')).toBe('patch');
  });

  it('treats a type!: subject as major', () => {
    expect(detectBumpLevel('feat!: drop legacy store')).toBe('major');
    expect(detectBumpLevel('refactor(core)!: rename ids')).toBe('major');
  });

  it('treats a BREAKING CHANGE footer as major (with or without hyphen)', () => {
    expect(detectBumpLevel('feat: x\n\nBREAKING CHANGE: drops config')).toBe('major');
    expect(detectBumpLevel('fix: y\n\nBREAKING-CHANGE: drops config')).toBe('major');
  });

  it('major wins over minor/patch across many commits', () => {
    const log = ['fix: a', 'feat: b', 'feat!: c'].join('\n\n');
    expect(detectBumpLevel(log)).toBe('major');
  });

  it('minor wins over patch when no breaking change is present', () => {
    const log = ['fix: a', 'chore: b', 'feat: c'].join('\n\n');
    expect(detectBumpLevel(log)).toBe('minor');
  });

  it('only matches the conventional prefix at the start of a line', () => {
    // "feat" mentioned mid-sentence must not trigger a minor bump.
    expect(detectBumpLevel('fix: mention the feat: token in prose')).toBe('patch');
  });
});

describe('bumpVersion', () => {
  it('bumps each level and zeroes the lower parts', () => {
    expect(bumpVersion('1.2.3', 'major')).toBe('2.0.0');
    expect(bumpVersion('1.2.3', 'minor')).toBe('1.3.0');
    expect(bumpVersion('1.2.3', 'patch')).toBe('1.2.4');
  });

  it('works from the 0.0.0 floor (no tags yet)', () => {
    expect(bumpVersion('0.0.0', 'patch')).toBe('0.0.1');
    expect(bumpVersion('0.0.0', 'minor')).toBe('0.1.0');
    expect(bumpVersion('0.0.0', 'major')).toBe('1.0.0');
  });

  it('rejects a malformed base version', () => {
    expect(() => bumpVersion('1.x', 'patch')).toThrow();
  });
});
