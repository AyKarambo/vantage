import { describe, it, expect } from 'vitest';
import { selectMatches, matchesFilter } from '../src/core/dashboardData';
import type { GameRecord } from '../src/core/analytics';
import type { Result } from '../src/core/model';

let seq = 0;
function game(timestamp: number, over: Partial<GameRecord> = {}): GameRecord {
  seq += 1;
  return {
    matchId: `m${seq}`, timestamp, account: 'Main', role: 'damage', map: 'Ilios',
    result: 'Win' as Result, gameType: 'Competitive', heroes: [],
    ...over,
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

describe('matchesFilter (M2)', () => {
  const mapModeOf = (map: string): string => (map === 'Ilios' ? 'Control' : map === 'Dorado' ? 'Escort' : 'Unknown');

  it('with no filter fields set, returns every game unchanged', () => {
    const games = [game(1000, { result: 'Win' }), game(2000, { result: 'Loss' })];
    expect(matchesFilter(games, mapModeOf, {})).toEqual(games);
  });

  it('results is a multi-select OR — a game matching ANY listed result passes', () => {
    const win = game(1000, { result: 'Win' });
    const loss = game(2000, { result: 'Loss' });
    const draw = game(3000, { result: 'Draw' });
    const out = matchesFilter([win, loss, draw], mapModeOf, { results: ['Win', 'Draw'] });
    expect(out.map((g) => g.matchId)).toEqual([win.matchId, draw.matchId]);
  });

  it('mapTypes is a multi-select OR over the RESOLVED map type, not the raw map name', () => {
    const ilios = game(1000, { map: 'Ilios' }); // Control
    const dorado = game(2000, { map: 'Dorado' }); // Escort
    const out = matchesFilter([ilios, dorado], mapModeOf, { mapTypes: ['Control'] });
    expect(out.map((g) => g.matchId)).toEqual([ilios.matchId]);
  });

  it('search matches the map, account, or any hero — case-insensitive substring', () => {
    const byMap = game(1000, { map: 'Ilios', account: 'Main', heroes: ['Tracer'] });
    const byAccount = game(2000, { map: 'Dorado', account: 'Smurf99', heroes: ['Genji'] });
    const byHero = game(3000, { map: 'Dorado', account: 'Main', heroes: ['Kiriko'] });
    const none = game(4000, { map: 'Dorado', account: 'Main', heroes: ['Genji'] });
    expect(matchesFilter([byMap, byAccount, byHero, none], mapModeOf, { search: 'ilios' }).map((g) => g.matchId))
      .toEqual([byMap.matchId]);
    expect(matchesFilter([byMap, byAccount, byHero, none], mapModeOf, { search: 'SMURF' }).map((g) => g.matchId))
      .toEqual([byAccount.matchId]);
    expect(matchesFilter([byMap, byAccount, byHero, none], mapModeOf, { search: 'kiri' }).map((g) => g.matchId))
      .toEqual([byHero.matchId]);
  });

  it('a blank/whitespace-only search is a no-op, same as omitting it', () => {
    const games = [game(1000), game(2000)];
    expect(matchesFilter(games, mapModeOf, { search: '   ' })).toEqual(games);
  });

  it('combines result, map type, and search as an AND across dimensions', () => {
    const match = game(1000, { result: 'Loss', map: 'Ilios', account: 'Main', heroes: ['Ana'] });
    const wrongResult = game(2000, { result: 'Win', map: 'Ilios', account: 'Main', heroes: ['Ana'] });
    const wrongMap = game(3000, { result: 'Loss', map: 'Dorado', account: 'Main', heroes: ['Ana'] });
    const out = matchesFilter([match, wrongResult, wrongMap], mapModeOf, {
      results: ['Loss'], mapTypes: ['Control'], search: 'ana',
    });
    expect(out.map((g) => g.matchId)).toEqual([match.matchId]);
  });

  it('never mutates the input array', () => {
    const games = [game(1000, { result: 'Win' }), game(2000, { result: 'Loss' })];
    const original = [...games];
    matchesFilter(games, mapModeOf, { results: ['Win'] });
    expect(games).toEqual(original);
  });
});
