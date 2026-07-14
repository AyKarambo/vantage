import { describe, it, expect } from 'vitest';
import { DEFAULT_GRADING_SETTINGS, normalizeGradingSettings } from '../src/core/gradingSettings';
import { DEFAULT_PARTIAL_MARGIN } from '../src/core/targets';

describe('gradingSettings', () => {
  it('defaults the partial margin to the shared 20% constant', () => {
    expect(DEFAULT_GRADING_SETTINGS.partialMargin).toBe(0.2);
    expect(DEFAULT_GRADING_SETTINGS.partialMargin).toBe(DEFAULT_PARTIAL_MARGIN);
  });

  it('passes a valid margin through, rounded to whole percentage points', () => {
    expect(normalizeGradingSettings({ partialMargin: 0.25 }).partialMargin).toBe(0.25);
    expect(normalizeGradingSettings({ partialMargin: 0.153 }).partialMargin).toBe(0.15);
  });

  it('clamps out-of-range margins into 0..0.5', () => {
    expect(normalizeGradingSettings({ partialMargin: -1 }).partialMargin).toBe(0);
    expect(normalizeGradingSettings({ partialMargin: 5 }).partialMargin).toBe(0.5);
  });

  it('falls back to the default for missing / non-finite input', () => {
    expect(normalizeGradingSettings(undefined).partialMargin).toBe(0.2);
    expect(normalizeGradingSettings({}).partialMargin).toBe(0.2);
    expect(normalizeGradingSettings({ partialMargin: NaN }).partialMargin).toBe(0.2);
    expect(normalizeGradingSettings({ partialMargin: Infinity }).partialMargin).toBe(0.2);
  });
});
