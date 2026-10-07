import { describe, it, expect } from 'vitest';
import { compareGepVersions, isGepOutdated, decideOutdatedNotification } from '../src/core/gepService';

describe('compareGepVersions / isGepOutdated', () => {
  it('compares numerically per segment, not as strings', () => {
    expect(compareGepVersions('315.0.1', '315.0.2')).toBeLessThan(0);
    expect(compareGepVersions('315.0.10', '315.0.2')).toBeGreaterThan(0);
    expect(compareGepVersions('315.0.2', '315.0.2')).toBe(0);
    expect(compareGepVersions('315', '315.0.0')).toBe(0);
    expect(compareGepVersions('316.0.0', '315.9.9')).toBeGreaterThan(0);
  });

  it('flags only a readable loaded version below a readable minimum', () => {
    expect(isGepOutdated('315.0.1', '315.0.2')).toBe(true);
    expect(isGepOutdated('315.0.2', '315.0.2')).toBe(false);
    expect(isGepOutdated('316.0.0', '315.0.2')).toBe(false);
    // The placeholder minimum Overwolf uses while a game is hard-disabled still counts.
    expect(isGepOutdated('315.0.1', '600.0.0')).toBe(true);
  });

  it('never claims outdated when either side is missing or unreadable', () => {
    expect(isGepOutdated(undefined, '315.0.2')).toBe(false);
    expect(isGepOutdated('315.0.1', undefined)).toBe(false);
    expect(isGepOutdated('beta', '315.0.2')).toBe(false);
  });
});

describe('decideOutdatedNotification', () => {
  it('fires once on current → outdated, naming both versions', () => {
    const n = decideOutdatedNotification(false, true, '315.0.1', '315.0.2');
    expect(n?.body).toContain('315.0.2');
    expect(n?.body).toContain('315.0.1');
  });

  it('stays silent while still outdated, on recovery, and when current', () => {
    expect(decideOutdatedNotification(true, true, '315.0.1', '315.0.2')).toBeNull();
    expect(decideOutdatedNotification(true, false, '315.0.2', '315.0.2')).toBeNull();
    expect(decideOutdatedNotification(false, false, '315.0.2', '315.0.2')).toBeNull();
  });
});
