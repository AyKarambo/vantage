import { describe, it, expect } from 'vitest';
import { normalizeSessionSettings, DEFAULT_SESSION_SETTINGS } from '../src/core/sessionSettings';

describe('normalizeSessionSettings', () => {
  it('fills defaults for missing fields', () => {
    expect(normalizeSessionSettings(undefined)).toEqual(DEFAULT_SESSION_SETTINGS);
    expect(normalizeSessionSettings({})).toEqual(DEFAULT_SESSION_SETTINGS);
  });

  it('clamps out-of-range and rounds fractional values', () => {
    expect(normalizeSessionSettings({ gapMinutes: 0 })).toEqual({ gapMinutes: 15 });
    expect(normalizeSessionSettings({ gapMinutes: -100 })).toEqual({ gapMinutes: 15 });
    expect(normalizeSessionSettings({ gapMinutes: 9999 })).toEqual({ gapMinutes: 720 });
    expect(normalizeSessionSettings({ gapMinutes: 179.6 })).toEqual({ gapMinutes: 180 });
  });
});
