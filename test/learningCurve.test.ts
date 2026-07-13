import { describe, it, expect } from 'vitest';
import { targetLearningCurve, wilson, type LearningPhase } from '../src/core/targets';
import type { AuthoredTarget } from '../src/core/targets';
import type { GameRecord } from '../src/core/analytics';
import type { Result } from '../src/core/model';

let seq = 0;
const game = (timestamp: number, result: Result): GameRecord => ({
  matchId: `m${++seq}`,
  timestamp,
  account: 'Main',
  role: 'damage',
  map: 'Ilios',
  result,
  gameType: 'Competitive',
  heroes: ['Tracer'],
});

/** Build games at consecutive timestamps from a W/L/D string. */
const run = (results: string, startTs: number): GameRecord[] =>
  [...results].map((c, i) => game(startTs + i, c === 'W' ? 'Win' : c === 'L' ? 'Loss' : 'Draw'));

const selfTarget = (over: Partial<AuthoredTarget> = {}): AuthoredTarget => ({
  id: 'T', name: 'focus', mode: 'self', rule: '', createdAt: 0, isActive: true, activatedAt: 100, ...over,
});

const ALL_PHASES: LearningPhase[] = ['gathering', 'no-baseline', 'building', 'climbing', 'paying-off', 'steady'];

describe('targetLearningCurve', () => {
  it('never fabricates a baseline: too few pre-flag games → baseline null, phase no-baseline', () => {
    const t = selfTarget();
    const games = [...run('WLW', 1), ...run('WLWLWLWLWLWL', 100)]; // 3 pre-flag decided, 12 since
    const c = targetLearningCurve(games, t);
    expect(c.baseline).toBeNull();
    expect(c.baseline).not.toBe(0.5); // the named trap — never the global/0.5 default
    expect(c.dipDepth).toBeNull();
    expect(c.reboundPts).toBeNull();
    expect(c.phase).toBe('no-baseline');
  });

  it('baseline = winrate over the last pre-flag decided games; draws and since-games excluded', () => {
    const t = selfTarget();
    const games = [...run('WWWLLL', 1), ...run('D', 50), ...run('WLWLWLWLWLWL', 100)];
    const c = targetLearningCurve(games, t);
    expect(c.baselineDecided).toBe(6); // the pre-flag draw is not counted
    expect(c.baseline).toBeCloseTo(0.5); // 3 wins / 6 decided
  });

  it('stays "gathering" until MIN_RENDER decided since flag, and gives no verdict until MIN_VERDICT', () => {
    const t = selfTarget();
    const base = run('WWWLLWWLL', 1); // 9 pre-flag decided → baseline present
    expect(targetLearningCurve([...base, ...run('WLWL', 100)], t).phase).toBe('gathering'); // 4 < MIN_RENDER
    expect(targetLearningCurve([...base, ...run('WLWLWLWLWL', 100)], t).phase).toBe('gathering'); // 10 < MIN_VERDICT
  });

  it('rolling point is null until ROLL_MIN decided games accrue, then non-null', () => {
    const t = selfTarget();
    const c = targetLearningCurve([...run('WWWWWLLLLL', 1), ...run('WLWLWLWLWLWL', 100)], t);
    expect(c.points[0].roll).toBeNull(); // 1 decided
    expect(c.points[3].roll).toBeNull(); // 4 decided
    expect(c.points[4].roll).not.toBeNull(); // the 5th decided → first non-null
    expect(c.points[4].rollDecided).toBe(5);
  });

  it('a draw advances the index but never enters the rolling denominator', () => {
    const t = selfTarget();
    const c = targetLearningCurve([...run('WWWWWLLLLL', 1), ...run('WWWWWDW', 100)], t);
    const draw = c.points[5];
    const beforeDraw = c.points[4];
    expect(draw.result).toBe('Draw');
    expect(draw.index).toBe(6);
    expect(draw.rollDecided).toBe(beforeDraw.rollDecided); // draw added no decided game
    expect(draw.roll).toBe(beforeDraw.roll);
  });

  it('locates a trough below baseline with a positive dip depth', () => {
    const t = selfTarget();
    const c = targetLearningCurve([...run('WWWWWWWWLL', 1), ...run('LLLLLWWWWWWWWWW', 100)], t);
    expect(c.troughIndex).not.toBeNull();
    expect(c.dipDepth).not.toBeNull();
    expect(c.dipDepth!).toBeGreaterThan(0);
  });

  it('rebound needs a SUSTAINED return above baseline after a real dip → paying-off', () => {
    const t = selfTarget();
    const c = targetLearningCurve([...run('WWWWWLLLLL', 1), ...run('LLLLLLWWWWWWWWWWWWWW', 100)], t);
    expect(c.baseline).toBeCloseTo(0.5);
    expect(c.reboundIndex).not.toBeNull();
    expect(c.phase).toBe('paying-off');
    expect(c.reboundPts!).toBeGreaterThan(0);
  });

  it('NEVER produces a negative/red verdict — a deep sustained dip is "building", not "declining"', () => {
    const t = selfTarget();
    const c = targetLearningCurve([...run('WWWWWWWWWW', 1), ...run('LLLLLLLLLLLLLLL', 100)], t);
    expect(ALL_PHASES).toContain(c.phase);
    expect(c.phase).toBe('building'); // below baseline, no rebound — the worst reachable state
  });

  it('property: every phase is in the enum and a below-baseline verdict is only building/climbing', () => {
    const t = selfTarget();
    for (const since of ['LLLLLLLLLLLL', 'WWWWWWWWWWWW', 'WLWLWLWLWLWL', 'LLLLLLWWWWWWWWWW', 'WWWWWWLLLLLL']) {
      const c = targetLearningCurve([...run('WWWWWLLLLL', 1), ...run(since, 100)], t);
      expect(ALL_PHASES).toContain(c.phase);
      // A verdict-eligible target sitting below baseline with no rebound is only ever
      // building or climbing — never a red / "declining" verdict.
      if (c.baseline != null && c.decidedSince >= 12 && c.reboundIndex == null && (c.reboundPts ?? 0) < 0) {
        expect(['building', 'climbing']).toContain(c.phase);
      }
    }
  });
});

describe('wilson', () => {
  it('is a small-sample-honest interval, clamped to [0,1]', () => {
    const w = wilson(8, 10);
    expect(w.low).toBeGreaterThan(0.4);
    expect(w.low).toBeLessThan(0.55);
    expect(w.high).toBeGreaterThan(0.9);
    expect(w.high).toBeLessThanOrEqual(1);
  });

  it('returns the full [0,1] range for n=0 and stays clamped at the extremes', () => {
    expect(wilson(0, 0)).toEqual({ low: 0, high: 1 });
    const perfect = wilson(6, 6);
    expect(perfect.high).toBeLessThanOrEqual(1);
    expect(perfect.low).toBeGreaterThanOrEqual(0);
    expect(perfect.low).toBeGreaterThan(0.5); // 6/6 is confidently above a coin flip
  });
});
