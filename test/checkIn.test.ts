import { describe, it, expect } from 'vitest';
import { normalizeCheckIn } from '../src/core/checkIn';

describe('normalizeCheckIn', () => {
  it('rejects a missing or invalid mood', () => {
    expect(normalizeCheckIn({ mood: 'angry' }, 1)).toBeNull();
    expect(normalizeCheckIn({}, 1)).toBeNull();
    expect(normalizeCheckIn(null, 1)).toBeNull();
    expect(normalizeCheckIn('calm', 1)).toBeNull();
  });

  it('keeps a mood-only check-in to exactly { at, mood } (no extra keys)', () => {
    const entry = normalizeCheckIn({ mood: 'calm' }, 5);
    expect(entry).toEqual({ at: 5, mood: 'calm' });
    expect(Object.keys(entry!)).toEqual(['at', 'mood']);
  });

  it('keeps every valid optional field', () => {
    expect(normalizeCheckIn(
      { mood: 'edgy', sleep: 'poor', energy: 'sharp', ate: false, focusTargetIds: ['t-1', 't-2'] }, 9,
    )).toEqual({ at: 9, mood: 'edgy', sleep: 'poor', energy: 'sharp', ate: false, focusTargetIds: ['t-1', 't-2'] });
  });

  it('drops invalid sleep / energy / ate rather than defaulting them', () => {
    const entry = normalizeCheckIn({ mood: 'calm', sleep: 'great', energy: 3, ate: 'yes' }, 1);
    expect(entry).toEqual({ at: 1, mood: 'calm' });
    expect(Object.keys(entry!)).toEqual(['at', 'mood']);
  });

  it('filters non-strings out of focusTargetIds and omits an empty list', () => {
    expect(normalizeCheckIn({ mood: 'calm', focusTargetIds: ['a', 2, null, 'b'] }, 1)?.focusTargetIds).toEqual(['a', 'b']);
    expect(normalizeCheckIn({ mood: 'calm', focusTargetIds: [] }, 1)).toEqual({ at: 1, mood: 'calm' });
    expect(normalizeCheckIn({ mood: 'calm', focusTargetIds: [1] }, 1)).toEqual({ at: 1, mood: 'calm' });
    expect(normalizeCheckIn({ mood: 'calm', focusTargetIds: 'a' }, 1)).toEqual({ at: 1, mood: 'calm' });
  });
});
