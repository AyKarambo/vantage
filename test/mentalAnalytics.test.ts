import { describe, it, expect } from 'vitest';
import { mentalCosts, tiltBySessionPosition, tiltTrend, tiltTrendDirection, COST_MIN_SAMPLE } from '../src/core/mentalAnalytics';
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

// ---- tiltTrend ----------------------------------------------------------------

/** ms epoch for a UTC calendar day + hour — dayKey buckets in UTC. */
const utc = (day: string, hour = 12): number => Date.parse(`${day}T${String(hour).padStart(2, '0')}:00:00Z`);

/** n games on one UTC day, the first `tilted` of them tilt-flagged. */
function dayGames(day: string, n: number, tilted: number): GameRecord[] {
  return Array.from({ length: n }, (_, i) =>
    game({
      result: 'Win',
      timestamp: utc(day, 10) + i * 60_000,
      ...(i < tilted ? { mental: { tilt: true } } : {}),
    }));
}

describe('tiltTrend', () => {
  it('buckets per UTC day, ascending, with tilted counts and rates', () => {
    const games = [
      ...dayGames('2026-07-02', 4, 1),
      ...dayGames('2026-07-01', 2, 2), // out of order on purpose
    ];
    const t = tiltTrend(games);
    expect(t).toEqual([
      { date: '2026-07-01', games: 2, tilted: 2, rate: 1 },
      { date: '2026-07-02', games: 4, tilted: 1, rate: 0.25 },
    ]);
  });

  it('OR-merges the review tilt flag into the daily rate', () => {
    const t = tiltTrend([reviewed('Loss', { tilt: true }, { timestamp: utc('2026-07-01') })]);
    expect(t).toEqual([{ date: '2026-07-01', games: 1, tilted: 1, rate: 1 }]);
  });

  it('is empty for no games', () => {
    expect(tiltTrend([])).toEqual([]);
  });
});

describe('tiltTrendDirection', () => {
  it('returns null when either half is thinner than the gate', () => {
    // 4 + 4 games: both halves under the 5-game gate → no claim.
    const thin = tiltTrend([...dayGames('2026-07-01', 4, 4), ...dayGames('2026-07-02', 4, 0)]);
    expect(tiltTrendDirection(thin)).toBeNull();
    // Single day → fewer than 2 points → no claim either.
    expect(tiltTrendDirection(tiltTrend(dayGames('2026-07-01', 20, 10)))).toBeNull();
  });

  it('reads a clearly falling tilt rate as improving', () => {
    const points = tiltTrend([...dayGames('2026-07-01', 6, 4), ...dayGames('2026-07-02', 6, 0)]);
    expect(tiltTrendDirection(points)).toBe('improving');
  });

  it('reads a clearly rising tilt rate as worsening', () => {
    const points = tiltTrend([...dayGames('2026-07-01', 6, 0), ...dayGames('2026-07-02', 6, 4)]);
    expect(tiltTrendDirection(points)).toBe('worsening');
  });

  it('reads a move inside the dead zone as flat', () => {
    // 1/6 vs 1/6 — identical halves, well inside the 3-point dead zone.
    const points = tiltTrend([...dayGames('2026-07-01', 6, 1), ...dayGames('2026-07-02', 6, 1)]);
    expect(tiltTrendDirection(points)).toBe('flat');
  });

  it('splits halves by game count, not by day count', () => {
    // Day 1 carries 10 of 15 games — it IS the early half; days 2-3 form the
    // late half (5 games). Early rate 0.5, late rate 0 → improving.
    const points = tiltTrend([
      ...dayGames('2026-07-01', 10, 5),
      ...dayGames('2026-07-02', 1, 0),
      ...dayGames('2026-07-03', 4, 0),
    ]);
    expect(tiltTrendDirection(points)).toBe('improving');
  });
});

// ---- tiltBySessionPosition -----------------------------------------------------

const MIN = 60_000;
const T0 = Date.parse('2026-07-01T18:00:00Z');

/** A sitting: games spaced 30 min apart starting at `start`; `tiltedAt` = 1-based positions flagged tilted. */
function sitting(start: number, n: number, tiltedAt: number[] = [], idPrefix = 's'): GameRecord[] {
  return Array.from({ length: n }, (_, i) =>
    game({
      result: 'Win',
      matchId: `${idPrefix}${start}-${i + 1}`,
      timestamp: start + i * 30 * MIN,
      ...(tiltedAt.includes(i + 1) ? { mental: { tilt: true } } : {}),
    }));
}

describe('tiltBySessionPosition', () => {
  it('rates tilt per position across sittings, in 1 → 6+ order', () => {
    const games = [
      ...sitting(T0, 3, [3], 'a'), // sitting 1: tilt at game 3
      ...sitting(T0 + 24 * 60 * MIN, 3, [3], 'b'), // sitting 2 (next day): tilt at game 3
    ];
    const t = tiltBySessionPosition(games);
    expect(t.map((b) => b.key)).toEqual(['1', '2', '3']);
    expect(t[0]).toEqual({ key: '1', games: 2, tilted: 0, rate: 0 });
    expect(t[2]).toEqual({ key: '3', games: 2, tilted: 2, rate: 1 });
  });

  it('a gap larger than 90 minutes starts a new sitting; up to 90 continues it', () => {
    const games = [
      // Game A, then B exactly 90 min later (same sitting), then C 91 min after B (new sitting).
      game({ result: 'Win', matchId: 'A', timestamp: T0 }),
      game({ result: 'Win', matchId: 'B', timestamp: T0 + 90 * MIN, mental: { tilt: true } }),
      game({ result: 'Win', matchId: 'C', timestamp: T0 + 181 * MIN }),
    ];
    const t = tiltBySessionPosition(games);
    expect(t).toEqual([
      { key: '1', games: 2, tilted: 0, rate: 0 }, // A and C both sit at position 1
      { key: '2', games: 1, tilted: 1, rate: 1 }, // B continues A's sitting
    ]);
  });

  it('pools positions 6 and beyond into the 6+ bucket', () => {
    const t = tiltBySessionPosition(sitting(T0, 8, [6, 7, 8]));
    const last = t[t.length - 1];
    expect(last.key).toBe('6+');
    expect(last).toEqual({ key: '6+', games: 3, tilted: 3, rate: 1 });
  });

  it('numbers positions over ALL games while include scopes aggregation', () => {
    const all = sitting(T0, 3, [3]);
    // Filter keeps only the third game of the sitting: it must still count at
    // position 3 — never renumbered to 1 — and the other buckets must vanish.
    const t = tiltBySessionPosition(all, { include: new Set([all[2].matchId]) });
    expect(t).toEqual([{ key: '3', games: 1, tilted: 1, rate: 1 }]);
  });

  it('OR-merges the review tilt flag', () => {
    const t = tiltBySessionPosition([reviewed('Loss', { tilt: true }, { timestamp: T0 })]);
    expect(t).toEqual([{ key: '1', games: 1, tilted: 1, rate: 1 }]);
  });

  it('is empty for no games', () => {
    expect(tiltBySessionPosition([])).toEqual([]);
  });
});
