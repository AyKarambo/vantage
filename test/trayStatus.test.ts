import { describe, it, expect } from 'vitest';
import { liveTrayLabel, sessionTrayLabel } from '../src/core/trayStatus';

describe('liveTrayLabel (S5)', () => {
  it('is null with no live match', () => {
    expect(liveTrayLabel(undefined, Date.now())).toBeNull();
  });

  it('states the map and elapsed minutes', () => {
    const now = Date.parse('2026-09-19T12:30:00Z');
    const startedAt = now - 12 * 60_000;
    expect(liveTrayLabel({ map: 'Ilios', startedAt }, now)).toBe('Live: Ilios · started 12m ago');
  });

  it('falls back to a generic label when the map is not yet known', () => {
    const now = Date.now();
    expect(liveTrayLabel({ startedAt: now - 60_000 }, now)).toBe('Live: match in progress · started 1m ago');
  });

  it('never reports negative minutes for clock skew (now slightly before startedAt)', () => {
    const now = Date.now();
    expect(liveTrayLabel({ map: 'Ilios', startedAt: now + 5000 }, now)).toBe('Live: Ilios · started 0m ago');
  });
});

describe('sessionTrayLabel (S5)', () => {
  it('is null with no open sitting', () => {
    expect(sessionTrayLabel(undefined)).toBeNull();
  });

  it('states the sitting record', () => {
    expect(sessionTrayLabel({ wins: 3, losses: 1 })).toBe('This sitting: 3–1');
  });

  it('handles a winless sitting', () => {
    expect(sessionTrayLabel({ wins: 0, losses: 2 })).toBe('This sitting: 0–2');
  });
});
