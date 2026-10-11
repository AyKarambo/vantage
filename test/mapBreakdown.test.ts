import { describe, it, expect } from 'vitest';
import { byMap, groupBy, modeGroups, splitUnknownMap, UNKNOWN_MAP, type GameRecord } from '../src/core/analytics';
import { computeDashboard } from '../src/core/dashboardData';
import { mapMode } from '../src/core/maps';
import type { Result } from '../src/core/model';

const T0 = Date.parse('2026-06-01T12:00:00Z');
const HOUR = 3600000;

let seq = 0;
function game(map: string, result: Result, p: Partial<GameRecord> = {}): GameRecord {
  seq += 1;
  return {
    matchId: `m${seq}`,
    timestamp: T0 + seq * HOUR,
    account: 'Karambo',
    role: 'damage',
    map,
    result,
    gameType: 'Competitive',
    heroes: [],
    ...p,
  };
}

const sample = (): GameRecord[] => [
  game('Nepal', 'Win', { srDelta: 20 }),
  game('Nepal', 'Loss', { srDelta: -22 }),
  game('Ilios', 'Win'),
  game('Dorado', 'Loss', { srDelta: -25 }),
  game('Dorado', 'Draw'),
  game(UNKNOWN_MAP, 'Loss', { srDelta: -25 }),
];

describe('splitUnknownMap', () => {
  it('takes the Unknown bucket out of the maps and reports its games', () => {
    const { maps, unknownGames } = splitUnknownMap(byMap(sample()));
    expect(maps.map((m) => m.key).sort()).toEqual(['Dorado', 'Ilios', 'Nepal']);
    expect(unknownGames).toBe(1);
  });

  it('reports 0 unknown games when every game has a map', () => {
    const { maps, unknownGames } = splitUnknownMap(byMap(sample().filter((g) => g.map !== UNKNOWN_MAP)));
    expect(maps).toHaveLength(3);
    expect(unknownGames).toBe(0);
  });

  it('leaves the other maps untouched', () => {
    const all = byMap(sample());
    const { maps } = splitUnknownMap(all);
    expect(maps).toEqual(all.filter((m) => m.key !== UNKNOWN_MAP));
  });
});

describe('modeGroups', () => {
  it('matches groupBy(mapMode) when no map is left out', () => {
    const games = sample().filter((g) => g.map !== UNKNOWN_MAP);
    expect(modeGroups(byMap(games), mapMode)).toEqual(groupBy(games, (g) => mapMode(g.map)));
  });

  it('carries net SR across the merged maps', () => {
    const games = [game('Nepal', 'Win', { srDelta: 20 }), game('Ilios', 'Loss', { srDelta: -30 }), game('Dorado', 'Win')];
    const control = modeGroups(byMap(games), mapMode).find((g) => g.key === 'Control')!;
    expect(control).toMatchObject({ games: 2, wins: 1, losses: 1, srNet: -10, srLogged: 2 });
  });

  it('leaves srNet absent when no merged map logged a delta', () => {
    const control = modeGroups(byMap([game('Nepal', 'Win'), game('Ilios', 'Loss')]), mapMode)[0];
    expect(control.srNet).toBeUndefined();
  });

  it('excludes draws from the winrate and orders by games', () => {
    const groups = modeGroups(byMap(sample()), mapMode);
    expect(groups.map((g) => g.games)).toEqual([...groups.map((g) => g.games)].sort((a, b) => b - a));
    const escort = groups.find((g) => g.key === 'Escort')!;
    expect(escort).toMatchObject({ games: 2, wins: 0, losses: 1, draws: 1, winrate: 0 });
  });

  it('does not count the Unknown game once it is split out', () => {
    const { maps } = splitUnknownMap(byMap(sample()));
    expect(modeGroups(maps, mapMode).some((g) => g.key === 'Unknown')).toBe(false);
  });
});

describe('dashboard payload', () => {
  const demo = { active: false, preference: 'off', hasRealHistory: true } as Parameters<typeof computeDashboard>[2];

  it('keeps the Unknown game in every total while the maps count excludes it', () => {
    const d = computeDashboard(sample(), { days: 'all' }, demo);
    const { maps, unknownGames } = splitUnknownMap(d.byMap);
    expect(d.overall.games).toBe(6);
    expect(d.matchesTotal).toBe(6);
    expect(maps).toHaveLength(3);
    expect(unknownGames).toBe(1);
    expect(maps.reduce((n, m) => n + m.games, 0) + unknownGames).toBe(d.overall.games);
  });
});
