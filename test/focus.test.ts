import { describe, it, expect } from 'vitest';
import { focusEntries, focusTrend, type GameRecord } from '../src/core/analytics';
import type { Result, Role } from '../src/core/model';

const T0 = Date.parse('2026-06-01T12:00:00Z');
const HOUR = 3600000;

let seq = 0;
function game(p: Partial<GameRecord> & { result: Result }): GameRecord {
  seq += 1;
  return {
    matchId: `m${seq}`,
    timestamp: T0 + seq * HOUR,
    account: 'Karambo',
    role: 'damage',
    map: `Filler-${seq}`,
    gameType: 'Competitive',
    heroes: [],
    ...p,
  };
}

/** n games with the same shape; results cycle through the given list. */
function run(n: number, results: Result[], p: Partial<GameRecord>): GameRecord[] {
  return Array.from({ length: n }, (_, i) => game({ result: results[i % results.length], ...p }));
}

describe('focusEntries — cross-dimension merge', () => {
  it('flags net-losing maps, heroes and roles, each tagged by dimension', () => {
    // 6 games, 5L 1W, all on one map / one hero / one role → all three flagged.
    const games = run(6, ['Loss', 'Loss', 'Loss', 'Loss', 'Loss', 'Win'], {
      map: 'Midtown', role: 'tank', heroes: ['Reinhardt'],
    });
    const entries = focusEntries(games);
    expect(entries.map((e) => `${e.dimension}:${e.key}`).sort()).toEqual(
      ['hero:Reinhardt', 'map:Midtown', 'role:tank'],
    );
    for (const e of entries) expect(e).toMatchObject({ net: 4, games: 6, wins: 1, losses: 5 });
  });

  it('excludes groups at or below net 0', () => {
    const games = [
      ...run(4, ['Win', 'Win', 'Win', 'Loss'], { map: 'Busan' }), // net -2
      ...run(4, ['Win', 'Win', 'Loss', 'Loss'], { map: 'Oasis' }), // net 0
    ];
    expect(focusEntries(games)).toHaveLength(0);
  });

  it('respects per-dimension minimum-game floors (map/hero 3, role 5)', () => {
    // 4 losses on the same role but scattered maps/heroes: nothing reaches its
    // floor (role needs 5). A 5th loss flags the role — and only the role.
    const four = Array.from({ length: 4 }, (_, i) =>
      game({ result: 'Loss', role: 'support', map: `M${i}`, heroes: [`H${i}`] }));
    expect(focusEntries(four)).toHaveLength(0);

    const five = [...four, game({ result: 'Loss', role: 'support', map: 'M9', heroes: ['H9'] })];
    const entries = focusEntries(five);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ dimension: 'role', key: 'support', net: 5 });
  });

  it('ranks by net descending, ties broken by more games', () => {
    const games = [
      // Everything on role openQ, balanced to net 0 overall so no role entry.
      ...run(6, ['Loss', 'Loss', 'Loss', 'Loss', 'Loss', 'Win'], { map: 'P', role: 'openQ' }), // map P: net 4, 6g
      ...run(4, ['Loss', 'Loss', 'Loss', 'Win'], { map: 'Q', role: 'openQ' }), // map Q: net 2, 4g
      // hero H: net 4 but 8 games → outranks P on the tie.
      ...Array.from({ length: 8 }, (_, i) =>
        game({ result: i < 6 ? 'Loss' : 'Win', role: 'openQ', map: `R${i % 4}`, heroes: ['H'] })),
      // R0..R3 get 2 games each (2L or 1L1W) — R0/R1 are 2 losses but <3 games.
      ...run(14, ['Win'], { role: 'openQ' }), // balance openQ to net 0 (19L vs 16W → need 3W more)
      ...run(3, ['Win'], { role: 'openQ' }),
    ];
    const entries = focusEntries(games);
    expect(entries.map((e) => `${e.dimension}:${e.key}`)).toEqual(['hero:H', 'map:P', 'map:Q']);
  });

  it('caps the merged list at 12', () => {
    // 13 net-losing maps (3 losses each) → maps alone exceed the cap; roles pile on top.
    const games = Array.from({ length: 13 }, (_, m) => run(3, ['Loss'], { map: `Map-${m}` })).flat();
    expect(focusEntries(games)).toHaveLength(12);
  });

  it('counts a game toward every hero played in it and ignores the Unknown bucket', () => {
    const games = run(3, ['Loss'], { heroes: ['Ana', 'Zenyatta'], map: 'Z' });
    const entries = focusEntries(games);
    const heroes = entries.filter((e) => e.dimension === 'hero').map((e) => e.key).sort();
    expect(heroes).toEqual(['Ana', 'Zenyatta']);
    // heroes: [] games never produce an 'Unknown' hero entry.
    const noHeroes = run(3, ['Loss'], { heroes: [], map: 'Y' });
    expect(focusEntries(noHeroes).some((e) => e.dimension === 'hero')).toBe(false);
  });
});

describe('focusTrend', () => {
  const at = (i: number, result: Result, p: Partial<GameRecord> = {}): GameRecord =>
    game({ result, timestamp: T0 + i * HOUR, ...p });

  it('reads improving when the recent half beats the earlier half', () => {
    const games = [0, 1, 2, 3].map((i) => at(i, 'Loss')).concat([4, 5, 6, 7].map((i) => at(i, 'Win')));
    expect(focusTrend(games)).toBe('improving');
  });

  it('reads declining when the recent half falls off', () => {
    const games = [0, 1, 2].map((i) => at(i, 'Win')).concat([3, 4, 5].map((i) => at(i, 'Loss')));
    expect(focusTrend(games)).toBe('declining');
  });

  it('reads flat inside the ±5-point dead-band', () => {
    const games = [
      at(0, 'Win'), at(1, 'Loss'), at(2, 'Loss'),
      at(3, 'Win'), at(4, 'Loss'), at(5, 'Loss'),
    ];
    expect(focusTrend(games)).toBe('flat');
  });

  it('needs at least 6 games', () => {
    expect(focusTrend([0, 1, 2, 3, 4].map((i) => at(i, 'Loss')))).toBeUndefined();
  });

  it('sorts by timestamp, not input order', () => {
    const games = [4, 5, 6, 7].map((i) => at(i, 'Win')).concat([0, 1, 2, 3].map((i) => at(i, 'Loss')));
    expect(focusTrend(games)).toBe('improving');
  });

  it('rides on focusEntries rows with enough games', () => {
    const losses = [0, 1, 2, 3].map((i) => at(i, 'Loss', { map: 'Dorado' }));
    const wins = [4, 5, 6].map((i) => at(i, 'Win', { map: 'Dorado' }));
    const entry = focusEntries([...losses, ...wins]).find((e) => e.key === 'Dorado');
    expect(entry?.net).toBe(1);
    expect(entry?.trend).toBe('improving');

    const three = [0, 1, 2].map((i) => at(i, 'Loss', { map: 'Numbani' }));
    const noTrend = focusEntries(three).find((e) => e.key === 'Numbani');
    expect(noTrend?.trend).toBeUndefined();
  });
});
