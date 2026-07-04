import { describe, it, expect } from 'vitest';
import { matchToGame } from '../src/core/gameRecord';
import type { MatchRecord } from '../src/core/model';

const base = (p: Partial<MatchRecord> = {}): MatchRecord => ({
  matchId: 'm-1',
  battleTag: 'Karambo#21234',
  mapName: "King's Row",
  outcome: 'Victory',
  queueType: 'role',
  heroRole: 'damage',
  gameType: 'Competitive',
  heroes: ['Tracer'],
  eliminations: 20,
  deaths: 5,
  assists: 7,
  damage: 9000,
  healing: 0,
  mitigation: 0,
  startedAt: 1_000_000,
  endedAt: 1_600_000,
  durationMinutes: 10,
  ...p,
});

const ACCOUNTS = { 'Karambo#21234': 'Main' };

describe('matchToGame', () => {
  it('returns null without an outcome (current behavior preserved)', () => {
    expect(matchToGame(base({ outcome: undefined }), ACCOUNTS)).toBeNull();
    expect(matchToGame(base({ outcome: 'in_progress' }), ACCOUNTS)).toBeNull();
  });

  it('maps and resolves the core fields', () => {
    const game = matchToGame(base(), ACCOUNTS);
    expect(game).toMatchObject({
      matchId: 'm-1',
      timestamp: 1_600_000,
      account: 'Main',
      role: 'damage',
      map: "King's Row",
      result: 'Win',
      gameType: 'Competitive',
      durationMinutes: 10,
      heroes: ['Tracer'],
    });
  });

  it('synthesizes a single-hero perHero line from match totals', () => {
    const game = matchToGame(base(), ACCOUNTS);
    expect(game?.perHero).toEqual([{
      hero: 'Tracer', role: 'damage',
      eliminations: 20, deaths: 5, assists: 7, damage: 9000, healing: 0, mitigation: 0,
    }]);
  });

  it('does not synthesize perHero for multi-hero games without a breakdown', () => {
    const game = matchToGame(base({ heroes: ['Tracer', 'Genji'] }), ACCOUNTS);
    expect(game?.perHero).toBeUndefined();
  });

  it('passes finalScore and the retained roster through', () => {
    const roster = [
      { battleTag: 'Karambo#21234', heroName: 'Tracer', kills: 20, isLocal: true },
      { battleTag: 'Someone#1234', heroName: 'Mercy', kills: 3 },
    ];
    const game = matchToGame(base({ finalScore: '2–1', roster }), ACCOUNTS);
    expect(game?.finalScore).toBe('2–1');
    expect(game?.roster).toEqual(roster);
  });

  it('leaves v2 fields absent on records that never carried them', () => {
    const game = matchToGame(base(), ACCOUNTS);
    expect(game?.finalScore).toBeUndefined();
    expect(game?.roster).toBeUndefined();
  });

  it('falls back to the battleTag when no account mapping matches', () => {
    const game = matchToGame(base(), {});
    expect(game?.account).toBe('Karambo#21234');
  });

  it('uses the injected clock when the record has no endedAt', () => {
    const game = matchToGame(base({ endedAt: undefined }), ACCOUNTS, () => 42);
    expect(game?.timestamp).toBe(42);
  });
});
