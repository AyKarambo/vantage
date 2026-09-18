import { describe, it, expect } from 'vitest';
import { selectMatches } from '../src/core/dashboardData';
import type { GameRecord } from '../src/core/analytics';
import type { Result } from '../src/core/model';

let seq = 0;
function game(timestamp: number): GameRecord {
  seq += 1;
  return {
    matchId: `m${seq}`, timestamp, account: 'Main', role: 'damage', map: 'Ilios',
    result: 'Win' as Result, gameType: 'Competitive', heroes: [],
  };
}

describe('selectMatches (M1)', () => {
  it('sorts newest-first and caps at the limit, regardless of input order', () => {
    const games = [game(1000), game(3000), game(2000)];
    const { rows, matched } = selectMatches(games, { limit: 2 });
    expect(rows.map((g) => g.timestamp)).toEqual([3000, 2000]);
    expect(matched).toBe(3);
  });

  it('"matched" counts the whole eligible set, not just the returned page — a page and its denominator can never disagree', () => {
    const games = Array.from({ length: 10 }, (_, i) => game(1000 + i));
    const { rows, matched } = selectMatches(games, { limit: 3 });
    expect(rows).toHaveLength(3);
    expect(matched).toBe(10);
  });

  it('with "before", only returns games strictly older than the cutoff — the next page never re-includes the last row of the previous one', () => {
    const games = [game(1000), game(2000), game(3000), game(4000)];
    const { rows, matched } = selectMatches(games, { before: 3000, limit: 10 });
    expect(rows.map((g) => g.timestamp)).toEqual([2000, 1000]);
    expect(matched).toBe(2);
  });

  it('never mutates the input array', () => {
    const games = [game(1000), game(3000), game(2000)];
    const original = [...games];
    selectMatches(games, { limit: 10 });
    expect(games).toEqual(original);
  });

  it('an empty input returns an empty page with matched: 0', () => {
    expect(selectMatches([], { limit: 10 })).toEqual({ rows: [], matched: 0 });
  });
});
