import { describe, it, expect } from 'vitest';
import {
  DEFAULT_BREAK_REMINDER, INITIAL_BREAK_REMINDER_STATE, clampAfterLosses,
  nextBreakReminder, normalizeBreakReminder, type BreakReminderState,
} from '../src/core/breakReminder';
import { streak } from '../src/core/analytics';
import type { GameRecord } from '../src/core/analytics';
import type { Result, Role } from '../src/core/model';

function game(p: Partial<GameRecord> & { result: Result; timestamp: number }): GameRecord {
  return {
    matchId: Math.random().toString(36).slice(2),
    account: 'Main',
    role: 'damage' as Role,
    map: 'Ilios',
    gameType: 'Competitive',
    heroes: ['Tracer'],
    ...p,
  };
}

/** Build a sequence of games from oldest → newest results, one per minute. */
function games(results: Array<'W' | 'L' | 'D'>): GameRecord[] {
  return results.map((r, i) =>
    game({
      timestamp: i * 60_000,
      result: r === 'W' ? 'Win' : r === 'L' ? 'Loss' : 'Draw',
    }),
  );
}

/** Fold `nextBreakReminder` over a sequence of streaks, as main.ts would after
 *  each recorded game — returns which steps fired. */
function runSequence(resultSeq: Array<'W' | 'L' | 'D'>, settings = DEFAULT_BREAK_REMINDER): boolean[] {
  let state: BreakReminderState = INITIAL_BREAK_REMINDER_STATE;
  const fires: boolean[] = [];
  for (let i = 1; i <= resultSeq.length; i++) {
    const gs = games(resultSeq.slice(0, i));
    const s = streak(gs);
    const { fire, state: next } = nextBreakReminder(s, settings, state);
    state = next;
    fires.push(fire);
  }
  return fires;
}

describe('DEFAULT_BREAK_REMINDER', () => {
  it('is on, after 2 losses', () => {
    expect(DEFAULT_BREAK_REMINDER).toEqual({ enabled: true, afterLosses: 2 });
  });
});

describe('clampAfterLosses / normalizeBreakReminder', () => {
  it('clamps below range up to 1', () => {
    expect(clampAfterLosses(0)).toBe(1);
    expect(clampAfterLosses(-5)).toBe(1);
  });

  it('clamps above range down to 10', () => {
    expect(clampAfterLosses(99)).toBe(10);
  });

  it('rounds fractional thresholds', () => {
    expect(clampAfterLosses(2.6)).toBe(3);
  });

  it('normalizes a partial settings object against the defaults', () => {
    expect(normalizeBreakReminder(undefined)).toEqual(DEFAULT_BREAK_REMINDER);
    expect(normalizeBreakReminder({ enabled: false })).toEqual({ enabled: false, afterLosses: 2 });
    expect(normalizeBreakReminder({ afterLosses: 0 })).toEqual({ enabled: true, afterLosses: 1 });
  });
});

describe('nextBreakReminder', () => {
  it('does not fire before the threshold (a single loss, N=2)', () => {
    const fires = runSequence(['L']);
    expect(fires).toEqual([false]);
  });

  it('fires exactly at the threshold (L,L with N=2)', () => {
    const fires = runSequence(['L', 'L']);
    expect(fires).toEqual([false, true]);
  });

  it('does not re-fire on the very next loss past threshold — re-fire cadence is every further N losses', () => {
    // L,L,L,L: fires at 2 and 4 for N=2 (pinned re-fire-every-N behaviour).
    const fires = runSequence(['L', 'L', 'L', 'L']);
    expect(fires).toEqual([false, true, false, true]);
  });

  it('re-fire cadence is pinned at every further afterLosses losses for larger N', () => {
    const settings = { enabled: true, afterLosses: 3 };
    // Fires at 3 and 6.
    const fires = runSequence(['L', 'L', 'L', 'L', 'L', 'L'], settings);
    expect(fires).toEqual([false, false, true, false, false, true]);
  });

  it('re-arms after a win (L,L,W,L,L fires twice)', () => {
    const fires = runSequence(['L', 'L', 'W', 'L', 'L']);
    expect(fires).toEqual([false, true, false, false, true]);
  });

  it('draws neither extend nor reset the loss streak', () => {
    // streak() filters draws out entirely, so L,D,L is just two losses in a row.
    const fires = runSequence(['L', 'D', 'L']);
    expect(fires).toEqual([false, false, true]);
  });

  it('never fires when disabled', () => {
    const settings = { enabled: false, afterLosses: 2 };
    const fires = runSequence(['L', 'L', 'L', 'L'], settings);
    expect(fires).toEqual([false, false, false, false]);
  });

  it('re-arms (fire: false, state reset) on a win or no-decided-games streak', () => {
    const armed = nextBreakReminder({ type: 'W', count: 1 }, DEFAULT_BREAK_REMINDER, { firedAtCount: 4 });
    expect(armed).toEqual({ fire: false, state: INITIAL_BREAK_REMINDER_STATE });

    const none = nextBreakReminder({ type: 'none', count: 0 }, DEFAULT_BREAK_REMINDER, { firedAtCount: 2 });
    expect(none).toEqual({ fire: false, state: INITIAL_BREAK_REMINDER_STATE });
  });

  it('clamps an out-of-range threshold before evaluating (0 -> 1)', () => {
    const result = nextBreakReminder({ type: 'L', count: 1 }, { enabled: true, afterLosses: 0 }, INITIAL_BREAK_REMINDER_STATE);
    expect(result.fire).toBe(true);
  });

  it('clamps an out-of-range threshold before evaluating (99 -> 10)', () => {
    const result = nextBreakReminder({ type: 'L', count: 9 }, { enabled: true, afterLosses: 99 }, INITIAL_BREAK_REMINDER_STATE);
    expect(result.fire).toBe(false); // clamped threshold is 10, count is 9
  });
});
