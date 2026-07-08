import { describe, it, expect } from 'vitest';
import { mentalCosts, COST_MIN_SAMPLE } from '../src/core/mentalAnalytics';
import { isTilted } from '../src/core/mental';
import type { GameRecord, MatchMental } from '../src/core/analytics';
import type { Result, Role } from '../src/core/model';

// ---- fixtures ---------------------------------------------------------------

function game(p: Partial<GameRecord> & { result: Result }): GameRecord {
  return {
    matchId: Math.random().toString(36).slice(2),
    timestamp: Date.now(),
    account: 'Main',
    role: 'damage' as Role,
    map: 'Ilios',
    gameType: 'Competitive',
    heroes: ['Tracer'],
    ...p,
  };
}

/** A game flagged only via the Review screen (no quick-log self-report). */
function reviewed(result: Result, flags: MatchMental, p: Partial<GameRecord> = {}): GameRecord {
  return game({ result, review: { at: Date.now(), grades: {}, flags }, ...p });
}

// ---- isTilted ----------------------------------------------------------------

describe('isTilted', () => {
  it('reads the quick-log flag, the review flag, and their OR-merge', () => {
    expect(isTilted(game({ result: 'Win', mental: { tilt: true } }))).toBe(true);
    expect(isTilted(reviewed('Win', { tilt: true }))).toBe(true);
    expect(isTilted(game({ result: 'Win', mental: { tilt: true }, review: { at: 1, grades: {}, flags: { tilt: true } } }))).toBe(true);
    expect(isTilted(game({ result: 'Win' }))).toBe(false);
    expect(isTilted(game({ result: 'Win', mental: { toxicMates: true } }))).toBe(false);
  });
});

// ---- mentalCosts --------------------------------------------------------------

describe('mentalCosts — tilt split', () => {
  it('splits winrate calm vs tilted, OR-merging quick-log and review sources', () => {
    const games = [
      game({ result: 'Win', mental: { tilt: true } }),
      reviewed('Loss', { tilt: true }), // review-only tilt still counts tilted
      game({ result: 'Win' }),
      game({ result: 'Win' }),
      game({ result: 'Loss' }),
    ];
    const c = mentalCosts(games);
    expect(c.tilt.tilted.decided).toBe(2);
    expect(c.tilt.tilted.winrate).toBe(0.5);
    expect(c.tilt.calm.decided).toBe(3);
    expect(c.tilt.calm.winrate).toBeCloseTo(2 / 3);
  });

  it('excludes draws from decided samples on both sides', () => {
    const games = [
      game({ result: 'Draw', mental: { tilt: true } }),
      game({ result: 'Win', mental: { tilt: true } }),
      game({ result: 'Draw' }),
      game({ result: 'Loss' }),
    ];
    const c = mentalCosts(games);
    expect(c.tilt.tilted.decided).toBe(1);
    expect(c.tilt.calm.decided).toBe(1);
  });
});

describe('mentalCosts — comms split', () => {
  it('buckets by tone, resolving legacy positiveComms and review flags', () => {
    const games = [
      game({ result: 'Win', mental: { comms: 'positive' } }),
      game({ result: 'Win', mental: { positiveComms: true } }), // legacy shape
      reviewed('Loss', { comms: 'abusive' }),
      game({ result: 'Loss', mental: { comms: 'abusive' } }),
      game({ result: 'Win', mental: { comms: 'banter' } }), // neutral: neither side
      game({ result: 'Win' }), // untoned: neither side
    ];
    const c = mentalCosts(games);
    expect(c.comms.positive.decided).toBe(2);
    expect(c.comms.positive.winrate).toBe(1);
    expect(c.comms.abusive.decided).toBe(2);
    expect(c.comms.abusive.winrate).toBe(0);
  });

  it('counts a source-conflicted game (positive vs abusive) once, as positive', () => {
    const conflicted = game({
      result: 'Win',
      mental: { comms: 'positive' },
      review: { at: 1, grades: {}, flags: { comms: 'abusive' } },
    });
    const c = mentalCosts([conflicted]);
    expect(c.comms.positive.decided).toBe(1);
    expect(c.comms.abusive.decided).toBe(0);
  });
});

describe('mentalCosts — toxic-teammates split', () => {
  it('splits with vs without, OR-merged across sources', () => {
    const games = [
      game({ result: 'Loss', mental: { toxicMates: true } }),
      reviewed('Loss', { toxicMates: true }),
      game({ result: 'Win' }),
      game({ result: 'Win' }),
    ];
    const c = mentalCosts(games);
    expect(c.toxic.with.decided).toBe(2);
    expect(c.toxic.with.winrate).toBe(0);
    expect(c.toxic.without.decided).toBe(2);
    expect(c.toxic.without.winrate).toBe(1);
  });
});

describe('mentalCosts — leaver swing (three-way)', () => {
  it('buckets my-team / none / enemy, folding the legacy leaver flag into my-team', () => {
    const games = [
      game({ result: 'Loss', mental: { leaverMyTeam: true } }),
      game({ result: 'Loss', mental: { leaver: true } }), // legacy → my team
      reviewed('Loss', { leaverMyTeam: true }), // review source
      game({ result: 'Win', mental: { leaverEnemyTeam: true } }),
      game({ result: 'Win' }),
      game({ result: 'Loss' }),
    ];
    const c = mentalCosts(games);
    expect(c.leaver.myTeam.decided).toBe(3);
    expect(c.leaver.myTeam.winrate).toBe(0);
    expect(c.leaver.enemy.decided).toBe(1);
    expect(c.leaver.enemy.winrate).toBe(1);
    expect(c.leaver.none.decided).toBe(2);
    expect(c.leaver.none.winrate).toBe(0.5);
  });

  it('classifies a both-teams-leaver game on the my-team (cost) side only', () => {
    const both = game({ result: 'Loss', mental: { leaverMyTeam: true, leaverEnemyTeam: true } });
    const c = mentalCosts([both]);
    expect(c.leaver.myTeam.decided).toBe(1);
    expect(c.leaver.enemy.decided).toBe(0);
    expect(c.leaver.none.decided).toBe(0);
  });
});

describe('mentalCosts — performance split', () => {
  it('averages only rated games per side, 1 decimal', () => {
    const games = [
      game({ result: 'Win', performance: 80 }),
      game({ result: 'Loss', performance: 71 }),
      game({ result: 'Win' }), // unrated calm game — must not drag the average
      game({ result: 'Loss', mental: { tilt: true }, performance: 40 }),
      game({ result: 'Loss', mental: { tilt: true } }), // unrated tilted game
    ];
    const c = mentalCosts(games);
    expect(c.performance.calm).toEqual({ avg: 75.5, rated: 2 });
    expect(c.performance.tilted).toEqual({ avg: 40, rated: 1 });
  });

  it('reports null averages (never 0) when a side has no rated games', () => {
    const c = mentalCosts([game({ result: 'Win' })]);
    expect(c.performance.calm).toEqual({ avg: null, rated: 0 });
    expect(c.performance.tilted).toEqual({ avg: null, rated: 0 });
  });
});

describe('mentalCosts — empty input', () => {
  it('returns zeroed sides for no games', () => {
    const c = mentalCosts([]);
    expect(c.tilt.calm).toEqual({ winrate: 0, decided: 0 });
    expect(c.tilt.tilted).toEqual({ winrate: 0, decided: 0 });
    expect(c.leaver).toEqual({
      none: { winrate: 0, decided: 0 },
      myTeam: { winrate: 0, decided: 0 },
      enemy: { winrate: 0, decided: 0 },
    });
    expect(c.performance.calm).toEqual({ avg: null, rated: 0 });
  });

  it('exports the tilt-tax gating convention (5 per side)', () => {
    expect(COST_MIN_SAMPLE).toBe(5);
  });
});
