import { describe, it, expect } from 'vitest';
import { mostPlayedHeroes } from '../src/core/analytics';
import type { GameRecord, Result, Role } from '../src/core/analytics';

function game(p: Partial<GameRecord> & { result: Result; role: Role; heroes: string[] }): GameRecord {
  return {
    matchId: Math.random().toString(36).slice(2),
    timestamp: Date.parse('2026-06-01T12:00:00Z'),
    account: 'Karambo',
    map: 'Numbani',
    gameType: 'Competitive',
    ...p,
  };
}

describe('mostPlayedHeroes', () => {
  it('ranks by descending play count for the given account+role', () => {
    const games: GameRecord[] = [
      game({ result: 'Win', role: 'damage', heroes: ['Tracer'] }),
      game({ result: 'Win', role: 'damage', heroes: ['Tracer'] }),
      game({ result: 'Loss', role: 'damage', heroes: ['Genji'] }),
    ];
    expect(mostPlayedHeroes(games, 'Karambo', 'damage')).toEqual(['Tracer', 'Genji']);
  });

  it('breaks ties alphabetically', () => {
    const games: GameRecord[] = [
      game({ result: 'Win', role: 'support', heroes: ['Moira'] }),
      game({ result: 'Win', role: 'support', heroes: ['Ana'] }),
    ];
    expect(mostPlayedHeroes(games, 'Karambo', 'support')).toEqual(['Ana', 'Moira']);
  });

  it('scopes to the exact recorded role for non-openQ roles', () => {
    const games: GameRecord[] = [
      game({ result: 'Win', role: 'tank', heroes: ['Reinhardt'] }),
      game({ result: 'Win', role: 'damage', heroes: ['Tracer'] }),
    ];
    expect(mostPlayedHeroes(games, 'Karambo', 'tank')).toEqual(['Reinhardt']);
    expect(mostPlayedHeroes(games, 'Karambo', 'damage')).toEqual(['Tracer']);
  });

  it('openQ aggregates across every recorded role for the account', () => {
    const games: GameRecord[] = [
      game({ result: 'Win', role: 'tank', heroes: ['Reinhardt'] }),
      game({ result: 'Win', role: 'damage', heroes: ['Tracer'] }),
      game({ result: 'Win', role: 'damage', heroes: ['Tracer'] }),
    ];
    expect(mostPlayedHeroes(games, 'Karambo', 'openQ')).toEqual(['Tracer', 'Reinhardt']);
  });

  it('counts a hero once per game it appears in, not once per game overall', () => {
    const games: GameRecord[] = [
      game({ result: 'Win', role: 'damage', heroes: ['Tracer', 'Genji'] }),
      game({ result: 'Win', role: 'damage', heroes: ['Tracer'] }),
    ];
    expect(mostPlayedHeroes(games, 'Karambo', 'damage')).toEqual(['Tracer', 'Genji']);
  });

  it('ignores other accounts and returns [] for one with no games', () => {
    const games: GameRecord[] = [game({ result: 'Win', role: 'damage', heroes: ['Tracer'], account: 'Other' })];
    expect(mostPlayedHeroes(games, 'Karambo', 'damage')).toEqual([]);
  });
});
