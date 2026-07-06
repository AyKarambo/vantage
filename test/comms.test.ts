import { describe, it, expect } from 'vitest';
import { commsTone, isPositiveComms, isAbusiveComms } from '../src/core/comms';

describe('commsTone', () => {
  it('prefers the new comms tone', () => {
    expect(commsTone({ comms: 'banter' })).toBe('banter');
    expect(commsTone({ comms: 'abusive' })).toBe('abusive');
    expect(commsTone({ comms: 'positive' })).toBe('positive');
  });

  it('falls back to the legacy positiveComms boolean', () => {
    expect(commsTone({ positiveComms: true })).toBe('positive');
    expect(commsTone({ positiveComms: false })).toBeUndefined();
  });

  it('lets an explicit tone win over the legacy flag', () => {
    expect(commsTone({ comms: 'abusive', positiveComms: true })).toBe('abusive');
  });

  it('is undefined when nothing is reported', () => {
    expect(commsTone(undefined)).toBeUndefined();
    expect(commsTone(null)).toBeUndefined();
    expect(commsTone({})).toBeUndefined();
    expect(commsTone({ tilt: true })).toBeUndefined();
  });
});

describe('isPositiveComms / isAbusiveComms', () => {
  it('reads positive from both the new tone and the legacy flag', () => {
    expect(isPositiveComms({ comms: 'positive' })).toBe(true);
    expect(isPositiveComms({ positiveComms: true })).toBe(true);
    expect(isPositiveComms({ comms: 'banter' })).toBe(false);
    expect(isPositiveComms({ comms: 'abusive' })).toBe(false);
    expect(isPositiveComms(undefined)).toBe(false);
  });

  it('reads abusive only from the new tone', () => {
    expect(isAbusiveComms({ comms: 'abusive' })).toBe(true);
    expect(isAbusiveComms({ comms: 'positive' })).toBe(false);
    expect(isAbusiveComms({ positiveComms: true })).toBe(false);
    expect(isAbusiveComms(undefined)).toBe(false);
  });
});
