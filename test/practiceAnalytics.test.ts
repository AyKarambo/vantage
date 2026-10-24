import { describe, it, expect } from 'vitest';
import {
  executionOf, executionByTarget, factorHeadline, factorTable, sittingExecution, sittingRecap, tiltByCheckInField, weakestDays,
  type FactorEntry, type FactorRow,
} from '../src/core/practice';
import { DEFAULT_COACHING } from '../src/core/coachingSettings';
import { computeDashboard } from '../src/core/dashboardData';
import type { GameRecord, MatchReview, TargetGrade } from '../src/core/analytics';
import type { SessionCheckIn } from '../src/core/checkIn';
import type { Result } from '../src/core/model';

// ---- fixtures ---------------------------------------------------------------

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 10, 17, 0);
let seq = 0;

interface Opts {
  result?: Result;
  grade?: TargetGrade;
  target?: string;
  performance?: number;
  review?: Partial<MatchReview>;
  tilt?: boolean;
}

/** A 10-minute game ending `endMin` minutes after T0. */
function game(endMin: number, o: Opts = {}): GameRecord {
  const grades: Record<string, TargetGrade> = o.grade ? { [o.target ?? 'a']: o.grade } : {};
  const hasReview = o.grade || o.review;
  return {
    matchId: `pa${seq++}`,
    timestamp: T0 + endMin * MIN,
    account: 'Main',
    role: 'damage',
    map: 'Ilios',
    result: o.result ?? 'Win',
    gameType: 'Competitive',
    heroes: ['Genji'],
    durationMinutes: 10,
    ...(o.performance !== undefined ? { performance: o.performance } : {}),
    ...(o.tilt ? { mental: { tilt: true } } : {}),
    ...(hasReview ? { review: { at: 1, grades, flags: {}, ...o.review } } : {}),
  };
}

const self = new Set(['a', 'b']);
const ids = (gs: GameRecord[]): Set<string> => new Set(gs.map((g) => g.matchId));
const row = (t: FactorEntry[], f: string, level: string): FactorRow | undefined =>
  t.find((e) => e.key === f)?.rows.find((r) => r.key === level);

// ---- execution ----------------------------------------------------------------

describe('executionOf', () => {
  it('scores hit = 1, partial = ½, missed = 0 (AC12)', () => {
    const gs: GameRecord[] = [];
    for (let i = 0; i < 21; i++) gs.push(game(i, { grade: 'hit' }));
    for (let i = 0; i < 9; i++) gs.push(game(100 + i, { grade: 'partial' }));
    for (let i = 0; i < 12; i++) gs.push(game(200 + i, { grade: 'missed' }));
    const t = executionOf(gs, self);
    expect([t.hits, t.partials, t.misses, t.attempts]).toEqual([21, 9, 12, 42]);
    expect(Math.round(t.score! * 100)).toBe(61);
  });

  it('ignores measured / unknown targets and reads null with nothing graded', () => {
    expect(executionOf([game(0, { grade: 'hit', target: 'measured-x' })], self).score).toBeNull();
  });
});

describe('sittingExecution', () => {
  it('one row per sitting with graded games, W–L alongside', () => {
    const gs = [
      game(0, { grade: 'hit' }), game(12, { grade: 'missed', result: 'Loss' }),
      game(300), // no grade: its sitting is skipped
      game(600, { grade: 'partial' }),
    ];
    const rows = sittingExecution(gs, ids(gs), self);
    expect(rows.map((r) => r.score)).toEqual([0.5, 0.5]);
    expect([rows[0].wins, rows[0].losses]).toEqual([1, 1]);
  });
});

// ---- factor table ----------------------------------------------------------------

describe('factorTable', () => {
  it('a check-in applies to every game of the sitting it preceded (AC18)', () => {
    const gs = [game(10), game(22), game(34), game(46), game(400)];
    const checkIns: SessionCheckIn[] = [{ at: T0, mood: 'calm', sleep: 'poor' }];
    const t = factorTable(gs, ids(gs), checkIns, DEFAULT_COACHING, self);
    expect(row(t, 'sleep', 'poor')!.games).toBe(4);
    expect(row(t, 'mood', 'calm')!.games).toBe(4);
  });

  it('splits breaks and game number from match times (AC21)', () => {
    // games 1–3 back to back, a 17-minute pause, then games 4–5
    const withBreak = [game(0), game(12), game(24), game(51), game(63)];
    // a separate 5-game sitting with no pause
    const noBreak = [500, 512, 524, 536, 548].map((m) => game(m));
    const all = [...withBreak, ...noBreak];
    const t = factorTable(all, ids(all), [], DEFAULT_COACHING, self);
    expect(row(t, 'breaks', 'tookBreak')!.games).toBe(2);
    expect(row(t, 'breaks', 'noBreak4')!.games).toBe(2);
    expect(row(t, 'position', '4+')!.games).toBe(4);
  });

  it('leaves out factors nobody answered', () => {
    const gs = [game(0)];
    const keys = factorTable(gs, ids(gs), [], DEFAULT_COACHING, self).map((e) => e.key);
    expect(keys).not.toContain('sleep');
    expect(keys).toContain('position');
  });
});

describe('factorHeadline', () => {
  const r = (key: string, rated: number, avg: number): FactorRow =>
    ({ key, games: rated, execution: null, attempts: 0, avgRating: avg, rated, winrate: 0.5, decided: rated });

  it('names the factor with the biggest gap between sampled levels (AC20)', () => {
    const h = factorHeadline([
      { key: 'sleep', source: 'checkIn', rows: [r('good', 14, 71), r('poor', 9, 49)] },
      { key: 'ate', source: 'checkIn', rows: [r('yes', 20, 62), r('no', 10, 58)] },
    ]);
    expect(h!.factor).toBe('sleep');
    expect(h!.gap).toBe(22);
    expect([h!.high.key, h!.low.key]).toEqual(['good', 'poor']);
  });

  it('never reads a level under the floor, nor a gap under 10 (AC19/AC20)', () => {
    expect(factorHeadline([{ key: 'sleep', source: 'checkIn', rows: [r('good', 14, 71), r('poor', 4, 30)] }])).toBeNull();
    expect(factorHeadline([{ key: 'ate', source: 'checkIn', rows: [r('yes', 20, 62), r('no', 10, 55)] }])).toBeNull();
  });
});

// ---- weakest days ----------------------------------------------------------------

describe('weakestDays', () => {
  it('lists the lowest-rated days with plain fact tags (AC22)', () => {
    const DAY = 24 * 60;
    const gs: GameRecord[] = [];
    const ratings = [70, 40, 65, 55, 80];
    ratings.forEach((rating, d) => {
      for (let i = 0; i < (d === 1 ? 6 : 3); i++) gs.push(game(d * DAY + i * 12, { performance: rating }));
    });
    const checkIns: SessionCheckIn[] = [{ at: T0 + DAY * MIN - MIN, mood: 'calm', sleep: 'poor' }];
    const days = weakestDays(gs, ids(gs), checkIns, DEFAULT_COACHING, self);
    expect(days.map((d) => d.avgRating)).toEqual([40, 55, 65]);
    expect(days[0].tags).toEqual(expect.arrayContaining(['slept poor', 'calm check-in', 'no break in 6 games']));
  });

  it('skips days with fewer than 3 rated games', () => {
    const gs = [game(0, { performance: 10 }), game(12, { performance: 10 })];
    expect(weakestDays(gs, ids(gs), [], DEFAULT_COACHING, self)).toEqual([]);
  });
});

// ---- sitting recap ------------------------------------------------------------------

describe('sittingRecap', () => {
  it('summarises the newest fully reviewed sitting (AC15)', () => {
    const gs = [
      game(0, { grade: 'hit', performance: 70 }),
      game(12, { grade: 'partial', performance: 60, result: 'Loss' }),
      game(24, { grade: 'hit', performance: 74 }),
    ];
    const checkIns: SessionCheckIn[] = [{ at: T0 - 20 * MIN, mood: 'calm', sleep: 'ok' }];
    const r = sittingRecap(gs, checkIns, self)!;
    expect(r.games).toBe(3);
    expect(r.execution.score).toBeCloseTo(2.5 / 3);
    expect(r.avgRating).toBe(68);
    expect([r.wins, r.losses]).toEqual([2, 1]);
    expect(r.checkIn?.sleep).toBe('ok');
  });

  it('waits until every game of the sitting has a review', () => {
    const gs = [game(0, { grade: 'hit' }), game(12)];
    expect(sittingRecap(gs, [], self)).toBeNull();
  });
});

// ---- tilt by check-in field --------------------------------------------------------

describe('tiltByCheckInField', () => {
  it('buckets every game of a checked-in sitting by the answer', () => {
    const gs = [game(10, { tilt: true }), game(22), game(500)];
    const checkIns: SessionCheckIn[] = [{ at: T0, mood: 'edgy', sleep: 'poor' }];
    expect(tiltByCheckInField(gs, ids(gs), checkIns, 'sleep')).toEqual([{ key: 'poor', games: 2, tilted: 1, rate: 0.5 }]);
    expect(tiltByCheckInField(gs, ids(gs), checkIns, 'energy')).toEqual([]);
  });
});

// ---- readiness stays objective ------------------------------------------------------

describe('readiness', () => {
  it('is identical whatever the check-ins say (AC23)', () => {
    const gs: GameRecord[] = [];
    const start = Date.now() - 20 * 30 * MIN;
    for (let i = 0; i < 20; i++) {
      gs.push({ ...game(0, { performance: 50 + (i % 5) * 5, result: i % 3 ? 'Win' : 'Loss' }), timestamp: start + i * 30 * MIN });
    }
    const demo = { active: false, preference: 'off' as const, hasRealHistory: true };
    const good: SessionCheckIn[] = [{ at: start - MIN, mood: 'calm', sleep: 'good', energy: 'sharp', ate: true }];
    const bad: SessionCheckIn[] = [{ at: start - MIN, mood: 'tilted', sleep: 'poor', energy: 'foggy', ate: false }];
    const r1 = computeDashboard(gs, { days: 'all' }, demo, { checkIns: good }).readiness;
    const r2 = computeDashboard(gs, { days: 'all' }, demo, { checkIns: bad }).readiness;
    expect(r2.score).toBe(r1.score);
    expect(r2.band).toBe(r1.band);
    expect(r2.signals).toEqual(r1.signals);
  });
});

describe('review fixes (#321)', () => {
  it('a recap of a sitting still in progress is marked open', () => {
    const gs = [game(0, { grade: 'hit' })];
    expect(sittingRecap(gs, [], self, T0 + 30 * MIN)!.closed).toBe(false);
    expect(sittingRecap(gs, [], self, T0 + 200 * MIN)!.closed).toBe(true);
  });

  it('tallies execution per target', () => {
    const gs = [game(0, { grade: 'hit' }), game(12, { grade: 'partial' }), game(24, { grade: 'missed', target: 'b' })];
    const by = executionByTarget(gs, self);
    expect(by.a.score).toBe(0.75);
    expect(by.b.score).toBe(0);
  });
});
