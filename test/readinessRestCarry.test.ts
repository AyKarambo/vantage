/**
 * Session-bound rest bonus — the morning-to-live crossfade (readiness-score-accuracy, issue #307).
 *
 * The morning read of a play day holds the rest effect of the gap since the previous
 * active day. Switching to the live read used to happen all at once with the first game —
 * a median 18-point cliff on a real history, win or lose. The score now crossfades from the
 * morning read to the live read over the first N games, N = half the player's usual games
 * per active day (3–10). Rest days keep their own recovery curve: a surge fades over 1–2
 * rest days (supercompensation), not overnight.
 */
import { describe, it, expect } from 'vitest';
import { computeReadiness, READINESS_TUNING as T } from '../src/core/readiness';
import { restCarryGames } from '../src/core/readiness/score';
import { ts, statSpan, span } from './readinessFixtures';
import type { GameRecord } from '../src/core/analytics';

/** Score after each of the first `n` games of `day` (index 0 = before the first game). */
function scoresThroughDay(history: GameRecord[], day: number, n: number, opts: Parameters<typeof statSpan>[2] = {}): number[] {
  const today = statSpan(day, day, { perDay: n, ...opts });
  const out: number[] = [];
  for (let k = 0; k <= n; k += 1) {
    const r = computeReadiness([...history, ...today.slice(0, k)], ts(day, 23, 30));
    out.push(r.score!);
  }
  return out;
}

describe('restCarryGames — N follows the player\'s own norm (AC9)', () => {
  it('is half the usual games per active day, clamped to 3–10', () => {
    expect(restCarryGames(12)).toBe(6);
    expect(restCarryGames(2)).toBe(T.restCarryMinGames); // 3
    expect(restCarryGames(0)).toBe(T.restCarryMinGames);
    expect(restCarryGames(40)).toBe(T.restCarryMaxGames); // 10
    expect(T.restCarryMinGames).toBe(3);
    expect(T.restCarryMaxGames).toBe(10);
  });
});

describe('the morning rest bonus is used up over the first N games (AC8)', () => {
  // A calm stats player: 12 games every day for three weeks (habit, not a surge), identical
  // stats (form 0), all wins (no winrate dip), no mental logs — nothing but the rest effect moves.
  const history = statSpan(0, 20, { perDay: 12 });

  it('last game yesterday (+12 this morning), N = 6: one game keeps 5/6 of the bonus, six games use it up', () => {
    const s = scoresThroughDay(history, 21, 7);
    expect(s[0]).toBe(T.baseScore + 12); // 87 — the morning read
    expect(s[1]).toBeGreaterThanOrEqual(T.baseScore + 10); // ≥ 85 — 12 × 5/6
    expect(s).toEqual([87, 85, 83, 81, 79, 77, 75, 75]);
  });

  it('one game never removes the whole bonus, whatever its result', () => {
    const lost = scoresThroughDay(history, 21, 1, { result: 'Loss' });
    expect(lost[0] - lost[1]).toBeLessThanOrEqual(Math.ceil(12 / 6));
  });
});

describe('rest days keep their recovery curve; the first game crossfades into the live read', () => {
  it('a three-day surge still weighs on the first rest day — recovery takes 1–2 days, not one night', () => {
    const history = [...span(0, 24, { perDay: 4 }), ...span(25, 27, { perDay: 10 })];
    const surgeEnd = computeReadiness(history, ts(27, 23, 30)).score!;
    const restDay1 = computeReadiness(history, ts(28, 20)).score!;
    const restDay2 = computeReadiness(history, ts(29, 20)).score!;
    expect(restDay1).toBeGreaterThan(surgeEnd); // rest helps...
    expect(restDay1).toBeLessThanOrEqual(T.baseScore); // ...but one night does not erase the surge
    expect(restDay2).toBeGreaterThan(restDay1); // a second rest day lifts it further (rest curve)
  });

  it('after a three-day surge, the first game moves the score by little more than one share of the bonus', () => {
    // 4/day habit, a 10/day surge for three days, one rest day, then play resumes.
    const history = [...span(0, 24, { perDay: 4 }), ...span(25, 27, { perDay: 10 })];
    const before = computeReadiness(history, ts(29, 10)).score!; // day 29 morning, restDays 2
    const after = computeReadiness([...history, ...span(29, 29, { perDay: 1 })], ts(29, 20)).score!;
    // N = round(0.5 × usual) — a one-game step can cost at most bonus / N plus that game's own load.
    expect(Math.abs(before - after)).toBeLessThanOrEqual(Math.ceil(24 / 3) + 3);
  });

  it('the recovering band still describes the session the player last played', () => {
    const history = span(0, 34, { perDay: 8 });
    const r = computeReadiness(history, ts(35, 20));
    expect(r.band).toBe('recovering');
  });
});

describe('heavy load is still flagged (AC19)', () => {
  it('≥ 20 games/day for three days above the own norm still reaches the −40 load floor', () => {
    const games = [...statSpan(0, 24, { perDay: 4 }), ...statSpan(25, 27, { perDay: 22 })];
    const r = computeReadiness(games, ts(27, 23, 30));
    expect(r.subscores.load.delta).toBe(T.loadDeltaMin); // −40
    expect(['loaded', 'in-the-hole']).toContain(r.band);
    expect(r.score!).toBeLessThanOrEqual(T.amberCut);
  });
});
