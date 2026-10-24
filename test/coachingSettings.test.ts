import { describe, it, expect } from 'vitest';
import { normalizeCoachingSettings, DEFAULT_COACHING } from '../src/core/coachingSettings';

describe('normalizeCoachingSettings', () => {
  it('has the documented defaults', () => {
    expect(DEFAULT_COACHING).toEqual({
      practiceFocus: 'auto',
      checkInQuestions: { sleep: false, energy: false, ate: false },
      focusStickiness: 'sitting',
      breakDetection: 'auto',
      breakMinutes: 15,
    });
    expect(normalizeCoachingSettings(undefined)).toEqual(DEFAULT_COACHING);
    expect(normalizeCoachingSettings({})).toEqual(DEFAULT_COACHING);
  });

  it('falls back to defaults for garbage input', () => {
    expect(normalizeCoachingSettings(null)).toEqual(DEFAULT_COACHING);
    expect(normalizeCoachingSettings('nope')).toEqual(DEFAULT_COACHING);
    expect(normalizeCoachingSettings({ practiceFocus: 'x' })).toEqual(DEFAULT_COACHING);
    expect(normalizeCoachingSettings({ focusStickiness: 3, breakDetection: {} })).toEqual(DEFAULT_COACHING);
    expect(normalizeCoachingSettings({ breakMinutes: '30' })).toEqual(DEFAULT_COACHING);
    expect(normalizeCoachingSettings({ breakMinutes: NaN })).toEqual(DEFAULT_COACHING);
    expect(normalizeCoachingSettings({ breakMinutes: Infinity })).toEqual(DEFAULT_COACHING);
    expect(normalizeCoachingSettings({ checkInQuestions: 'yes' })).toEqual(DEFAULT_COACHING);
  });

  it('keeps valid enum values', () => {
    expect(normalizeCoachingSettings({ practiceFocus: 'off', focusStickiness: 'sticky', breakDetection: 'manual' }))
      .toMatchObject({ practiceFocus: 'off', focusStickiness: 'sticky', breakDetection: 'manual' });
  });

  it('clamps and rounds breakMinutes', () => {
    expect(normalizeCoachingSettings({ breakMinutes: 2 }).breakMinutes).toBe(5);
    expect(normalizeCoachingSettings({ breakMinutes: 99 }).breakMinutes).toBe(60);
    expect(normalizeCoachingSettings({ breakMinutes: 14.6 }).breakMinutes).toBe(15);
  });

  it('merges partial checkInQuestions over defaults and coerces non-booleans to false', () => {
    expect(normalizeCoachingSettings({ checkInQuestions: { sleep: true } as never }).checkInQuestions)
      .toEqual({ sleep: true, energy: false, ate: false });
    expect(normalizeCoachingSettings({ checkInQuestions: { sleep: 'true', energy: 1, ate: true } as never }).checkInQuestions)
      .toEqual({ sleep: false, energy: false, ate: true });
  });
});
