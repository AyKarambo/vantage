import { describe, it, expect } from 'vitest';
import { rovingTarget, tabStopIndex } from '../renderer/src/components/rovingFocus';
import { searchTopHero } from '../renderer/src/components/heroPicker';

/** #340 — the Log Match / Edit Match keyboard flow's pure pieces. */
describe('rovingTarget', () => {
  it('steps right and left, wrapping at both ends', () => {
    expect(rovingTarget(0, 'ArrowRight', 3)).toBe(1);
    expect(rovingTarget(2, 'ArrowRight', 3)).toBe(0);
    expect(rovingTarget(0, 'ArrowLeft', 3)).toBe(2);
    expect(rovingTarget(1, 'ArrowLeft', 3)).toBe(0);
  });

  it('jumps to the ends with Home / End', () => {
    expect(rovingTarget(1, 'Home', 4)).toBe(0);
    expect(rovingTarget(1, 'End', 4)).toBe(3);
  });

  it('leaves every other key alone — ↑/↓ belong to target grading', () => {
    expect(rovingTarget(0, 'ArrowDown', 3)).toBeNull();
    expect(rovingTarget(0, 'ArrowUp', 3)).toBeNull();
    expect(rovingTarget(0, 'Tab', 3)).toBeNull();
    expect(rovingTarget(0, 'w', 3)).toBeNull();
  });

  it('does nothing for an empty group', () => {
    expect(rovingTarget(0, 'ArrowRight', 0)).toBeNull();
  });
});

describe('tabStopIndex', () => {
  const item = (selected: boolean, disabled = false) => ({ selected, disabled });

  it('lands on the current choice', () => {
    expect(tabStopIndex([item(false), item(true), item(false)])).toBe(1);
  });

  it('falls back to the first enabled button when nothing is selected', () => {
    expect(tabStopIndex([item(false, true), item(false), item(false)])).toBe(1);
  });

  it('skips a selected but disabled button', () => {
    expect(tabStopIndex([item(false), item(true, true)])).toBe(0);
  });

  it('is -1 when every button is disabled', () => {
    expect(tabStopIndex([item(false, true)])).toBe(-1);
  });
});

describe('searchTopHero', () => {
  const pool = ['Ana', 'Genji', 'Hanzo', 'Juno', 'Kiriko'];

  it('prefers a name that starts with the query over one that contains it', () => {
    expect(searchTopHero(pool, 'an')).toBe('Ana');
  });

  it('falls back to a contains-match, case-insensitively', () => {
    expect(searchTopHero(pool, 'NZ')).toBe('Hanzo');
  });

  it('returns nothing for a blank query or no match', () => {
    expect(searchTopHero(pool, '  ')).toBeUndefined();
    expect(searchTopHero(pool, 'zzz')).toBeUndefined();
  });
});
