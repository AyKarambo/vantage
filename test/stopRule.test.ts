import { describe, it, expect } from 'vitest';
import { stopRule } from '../src/core/stopRule';
import type { Group } from '../src/core/analytics';
import type { TiltPositionBucket } from '../src/core/mentalAnalytics';
import { DEFAULT_BREAK_REMINDER } from '../src/core/breakReminder';

const pos = (key: string, wins: number, losses: number): Group =>
  ({ key, games: wins + losses, wins, losses, draws: 0, winrate: wins / (wins + losses) });

const tilt = (key: string, games: number, tilted: number): TiltPositionBucket =>
  ({ key, games, tilted, rate: tilted / games });

describe('stopRule', () => {
  it('combines a sample-gated tilt peak with the break reminder threshold', () => {
    const r = stopRule(
      [pos('1', 8, 2), pos('2', 8, 2), pos('3', 3, 7)],
      [tilt('1', 10, 0), tilt('2', 10, 1), tilt('3', 10, 6)],
      DEFAULT_BREAK_REMINDER,
    );
    expect(r.position).toBe('3');
    expect(r.afterLosses).toBe(2);
    expect(r.sentence).toBe('Your stop rule: end after game 3 or 2 losses in a row.');
  });

  it('prefers the tilt peak over the winrate fade when both are readable', () => {
    const r = stopRule(
      [pos('1', 8, 2), pos('2', 8, 2), pos('3', 2, 8)], // fades at 3
      [tilt('1', 10, 0), tilt('2', 10, 0), tilt('3', 10, 0), tilt('4', 10, 7)], // tilts at 4
      DEFAULT_BREAK_REMINDER,
    );
    expect(r.position).toBe('4');
  });

  it('falls back to the winrate fade when tilt has no sample-gated peak', () => {
    const r = stopRule(
      [pos('1', 8, 2), pos('2', 8, 2), pos('3', 2, 8)],
      [tilt('1', 2, 0), tilt('2', 2, 0), tilt('3', 2, 2)], // under COST_MIN_SAMPLE
      DEFAULT_BREAK_REMINDER,
    );
    expect(r.position).toBe('3');
  });

  it('drops the loss clause when the break reminder is off', () => {
    const r = stopRule(
      [pos('1', 8, 2), pos('2', 8, 2), pos('3', 2, 8)],
      [],
      { enabled: false, afterLosses: 2 },
    );
    expect(r.afterLosses).toBeNull();
    expect(r.sentence).toBe('Your stop rule: end after game 3.');
  });

  it('returns no sentence with neither a position nor an active reminder', () => {
    const r = stopRule([], [], { enabled: false, afterLosses: 2 });
    expect(r).toEqual({ position: null, afterLosses: null, sentence: null });
  });

  it('states only the loss clause when no position is readable', () => {
    const r = stopRule([], [], DEFAULT_BREAK_REMINDER);
    expect(r.sentence).toBe('Your stop rule: 2 losses in a row.');
  });
});
