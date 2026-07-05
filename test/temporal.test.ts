import { describe, it, expect } from 'vitest';
import { byTimeOfDay, bySessionPosition, sessionFade } from '../src/core/analytics';
import type { GameRecord } from '../src/core/analytics';
import type { Result, Role } from '../src/core/model';

// Local-time fixtures in a DST-stable window (June 2026), mirroring readiness.test.ts.
const MIN = 60_000;
let seq = 0;

function at(day: number, hour: number, min = 0): number {
  return new Date(2026, 5, 1 + day, hour, min, 0).getTime();
}

function game(p: Partial<GameRecord> & { timestamp: number }): GameRecord {
  return {
    matchId: p.matchId ?? `t${seq++}`,
    account: 'Main',
    role: 'damage' as Role,
    map: 'Ilios',
    result: 'Win' as Result,
    gameType: 'Competitive',
    heroes: ['Tracer'],
    ...p,
  };
}

/** `n` games starting at (day, hour), `stepMin` apart. */
function run(day: number, hour: number, n: number, result: Result = 'Win', stepMin = 12): GameRecord[] {
  return Array.from({ length: n }, (_, i) => game({ timestamp: at(day, hour) + i * stepMin * MIN, result }));
}

describe('byTimeOfDay', () => {
  it('buckets local hours into day parts and omits empty buckets', () => {
    const games = [
      ...run(0, 9, 2), // Morning
      ...run(0, 13, 3, 'Loss'), // Afternoon
      ...run(1, 19, 1), // Evening
    ];
    const parts = byTimeOfDay(games);
    expect(parts.map((p) => p.key)).toEqual(['Morning', 'Afternoon', 'Evening']);
    expect(parts[0].games).toBe(2);
    expect(parts[1].losses).toBe(3);
  });

  it('night wraps midnight: 23:00 and 02:00 land in the same bucket', () => {
    const parts = byTimeOfDay([game({ timestamp: at(0, 23) }), game({ timestamp: at(1, 2) })]);
    expect(parts).toHaveLength(1);
    expect(parts[0].key).toBe('Night');
    expect(parts[0].games).toBe(2);
  });

  it('boundary hours: 5:00 is Morning, 12:00 Afternoon, 17:00 Evening, 22:00 Night', () => {
    const keys = (hr: number) => byTimeOfDay([game({ timestamp: at(0, hr) })])[0].key;
    expect(keys(5)).toBe('Morning');
    expect(keys(12)).toBe('Afternoon');
    expect(keys(17)).toBe('Evening');
    expect(keys(22)).toBe('Night');
    expect(keys(4)).toBe('Night');
  });

  it('empty input → empty output', () => {
    expect(byTimeOfDay([])).toEqual([]);
  });
});

describe('bySessionPosition', () => {
  it('numbers games within a sitting and pools 6+ together', () => {
    const games = run(0, 18, 8); // one 8-game session
    const buckets = bySessionPosition(games);
    expect(buckets.map((b) => b.key)).toEqual(['1', '2', '3', '4', '5', '6+']);
    expect(buckets.find((b) => b.key === '6+')!.games).toBe(3); // games 6, 7, 8
  });

  it('a gap larger than 90 minutes starts a new session (position resets)', () => {
    const games = [...run(0, 10, 2), ...run(0, 14, 2)]; // 10:00–10:12, then 14:00–14:12
    const buckets = bySessionPosition(games);
    expect(buckets.find((b) => b.key === '1')!.games).toBe(2);
    expect(buckets.find((b) => b.key === '2')!.games).toBe(2);
    expect(buckets.some((b) => b.key === '3')).toBe(false);
  });

  it('a session can span midnight without splitting', () => {
    const games = [game({ timestamp: at(0, 23, 30) }), game({ timestamp: at(1, 0, 15) })];
    const buckets = bySessionPosition(games);
    expect(buckets.map((b) => b.key)).toEqual(['1', '2']);
  });

  it('unsorted input is handled', () => {
    const games = run(0, 18, 3).reverse();
    const buckets = bySessionPosition(games);
    expect(buckets.map((b) => b.key)).toEqual(['1', '2', '3']);
  });

  it('empty input → empty output', () => {
    expect(bySessionPosition([])).toEqual([]);
  });
});

describe('sessionFade', () => {
  const bucket = (key: string, wins: number, losses: number) => ({
    key, games: wins + losses, wins, losses, draws: 0,
    winrate: wins + losses ? wins / (wins + losses) : 0,
  });

  it('flags the first late position clearly below the games-1–2 baseline', () => {
    const fade = sessionFade([
      bucket('1', 7, 3), // 70%
      bucket('2', 6, 4), // 60% → baseline 65%
      bucket('3', 5, 4), // 55.6% ≤ 65% − 8pts → first fade position
      bucket('4', 2, 8), // 20%
    ]);
    expect(fade).not.toBeNull();
    expect(fade!.position).toBe('3');
    expect(fade!.baseline).toBeCloseTo(0.65, 2);
  });

  it('needs enough early games to trust a baseline', () => {
    expect(sessionFade([bucket('1', 3, 1), bucket('2', 2, 1), bucket('3', 0, 8)])).toBeNull();
  });

  it('needs enough games in the late bucket', () => {
    expect(sessionFade([bucket('1', 8, 2), bucket('2', 7, 3), bucket('5', 0, 3)])).toBeNull();
  });

  it('no fade when late-session winrate holds up', () => {
    expect(sessionFade([bucket('1', 6, 4), bucket('2', 6, 4), bucket('3', 6, 4), bucket('4', 7, 3)])).toBeNull();
  });
});
