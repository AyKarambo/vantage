import { describe, it, expect } from 'vitest';
import {
  mentalCosts, tiltAfterResult, tiltByCheckIn, tiltByMap, tiltBySessionPosition, tiltByTimeOfDay, tiltTrend, tiltTrendDirection, COST_MIN_SAMPLE,
} from '../src/core/mentalAnalytics';
import { isTilted } from '../src/core/mental';
import type { GameRecord, MatchMental } from '../src/core/analytics';
import type { SessionCheckIn } from '../src/core/checkIn';
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

  it('reads a clearly falling tilt rate as improving, with both half-rates', () => {
    const points = tiltTrend([...dayGames('2026-07-01', 6, 4), ...dayGames('2026-07-02', 6, 0)]);
    expect(tiltTrendDirection(points)).toEqual({ direction: 'improving', earlyRate: 4 / 6, lateRate: 0, flaggedGames: 4 });
  });

  it('reads a clearly rising tilt rate as worsening', () => {
    const points = tiltTrend([...dayGames('2026-07-01', 6, 0), ...dayGames('2026-07-02', 6, 4)]);
    expect(tiltTrendDirection(points)).toEqual({ direction: 'worsening', earlyRate: 0, lateRate: 4 / 6, flaggedGames: 4 });
  });

  it('reads a move inside the dead zone as flat', () => {
    // 1/6 vs 1/6 — identical halves, well inside the 3-point dead zone.
    const points = tiltTrend([...dayGames('2026-07-01', 6, 1), ...dayGames('2026-07-02', 6, 1)]);
    expect(tiltTrendDirection(points)).toEqual({ direction: 'flat', earlyRate: 1 / 6, lateRate: 1 / 6, flaggedGames: 2 });
  });

  it('splits halves by game count, not by day count', () => {
    // Day 1 carries 10 of 15 games — it IS the early half; days 2-3 form the
    // late half (5 games). Early rate 0.5, late rate 0 → improving.
    const points = tiltTrend([
      ...dayGames('2026-07-01', 10, 5),
      ...dayGames('2026-07-02', 1, 0),
      ...dayGames('2026-07-03', 4, 0),
    ]);
    expect(tiltTrendDirection(points)?.direction).toBe('improving');
  });

  it('still reads a direction when the LATER day dominates the game count', () => {
    // Day 2 carries 7 of 13 games — more than half — so it must land in the
    // late half rather than swallowing the split into `early` and returning
    // null. Early (day 1) rate 1, late (day 2) rate 0 → improving.
    const points = tiltTrend([...dayGames('2026-07-01', 6, 6), ...dayGames('2026-07-02', 7, 0)]);
    expect(tiltTrendDirection(points)?.direction).toBe('improving');
  });

  it('flaggedGames (F6) sums tilted games across both halves, independent of the game-count gate', () => {
    // A big enough sample (10 + 10 games) to clear the 5-per-half gate, but
    // only 1 flagged game per half — a real move should still not read as
    // confidently sampled at the flag level.
    const points = tiltTrend([...dayGames('2026-07-01', 10, 1), ...dayGames('2026-07-02', 10, 1)]);
    expect(tiltTrendDirection(points)?.flaggedGames).toBe(2);
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

// ---- tiltByCheckIn (S10 phase 2) ------------------------------------------------

const checkIn = (at: number, mood: SessionCheckIn['mood']): SessionCheckIn => ({ at, mood });

describe('tiltByCheckIn', () => {
  it('buckets each sitting\'s first game by the check-in that immediately preceded it', () => {
    const games = [
      ...sitting(T0, 2, [1], 'a'), // opens tilted, checked in tilted
      ...sitting(T0 + 24 * 60 * MIN, 2, [], 'b'), // opens clean, checked in calm
    ];
    const checkIns = [
      checkIn(T0 - 10 * MIN, 'tilted'),
      checkIn(T0 + 24 * 60 * MIN - 5 * MIN, 'calm'),
    ];
    const t = tiltByCheckIn(games, checkIns);
    expect(t).toEqual([
      { key: 'calm', games: 1, tilted: 0, rate: 0 },
      { key: 'tilted', games: 1, tilted: 1, rate: 1 },
    ]);
  });

  it('buckets a sitting with no preceding check-in under "none"', () => {
    const games = sitting(T0, 1, [1]);
    const t = tiltByCheckIn(games, []);
    expect(t).toEqual([{ key: 'none', games: 1, tilted: 1, rate: 1 }]);
  });

  it('ignores a check-in outside the gap window (default 90 minutes)', () => {
    const games = sitting(T0, 1);
    const t = tiltByCheckIn(games, [checkIn(T0 - 91 * MIN, 'edgy')]);
    expect(t).toEqual([{ key: 'none', games: 1, tilted: 0, rate: 0 }]);
  });

  it('ignores a check-in logged AFTER the game it would otherwise match', () => {
    const games = sitting(T0, 1);
    const t = tiltByCheckIn(games, [checkIn(T0 + MIN, 'tilted')]);
    expect(t).toEqual([{ key: 'none', games: 1, tilted: 0, rate: 0 }]);
  });

  it('picks the LATEST qualifying check-in when several precede the same game', () => {
    const games = sitting(T0, 1);
    const t = tiltByCheckIn(games, [checkIn(T0 - 80 * MIN, 'tilted'), checkIn(T0 - 10 * MIN, 'calm')]);
    expect(t).toEqual([{ key: 'calm', games: 1, tilted: 0, rate: 0 }]);
  });

  it('only ever looks at position-1 games — a check-in never attaches to game 2+', () => {
    // A check-in that lands right before game 2 of a sitting (not game 1) must
    // never pull that sitting's continuation games into a mood bucket.
    const games = sitting(T0, 2);
    const t = tiltByCheckIn(games, [checkIn(T0 + 25 * MIN, 'edgy')]);
    expect(t).toEqual([{ key: 'none', games: 1, tilted: 0, rate: 0 }]);
  });

  it('numbers over ALL games while include scopes which position-1 games aggregate', () => {
    const a = sitting(T0, 1, [1], 'a');
    const b = sitting(T0 + 24 * 60 * MIN, 1, [], 'b');
    const t = tiltByCheckIn([...a, ...b], [checkIn(T0 - MIN, 'tilted')], { include: new Set([a[0].matchId]) });
    expect(t).toEqual([{ key: 'tilted', games: 1, tilted: 1, rate: 1 }]);
  });

  it('is empty for no games and for no position-1 games at all', () => {
    expect(tiltByCheckIn([], [])).toEqual([]);
  });
});

// ---- "when do I tilt" triggers (S9) --------------------------------------------

/** A game at a given local hour, on a fixed UTC-noon-anchored day so getHours() is deterministic-ish across runs. */
function atHour(hour: number, tilted = false, map = 'Ilios'): GameRecord {
  const d = new Date(2026, 6, 1, hour, 0, 0);
  return game({ result: 'Win', timestamp: d.getTime(), map, ...(tilted ? { mental: { tilt: true } } : {}) });
}

describe('tiltByTimeOfDay', () => {
  it('buckets by local day-part in Morning → Night order, empty buckets omitted', () => {
    const t = tiltByTimeOfDay([atHour(8), atHour(9, true), atHour(23, true)]);
    expect(t).toEqual([
      { key: 'Morning', games: 2, tilted: 1, rate: 0.5 },
      { key: 'Night', games: 1, tilted: 1, rate: 1 },
    ]);
  });

  it('is empty for no games', () => {
    expect(tiltByTimeOfDay([])).toEqual([]);
  });
});

describe('tiltAfterResult', () => {
  it('buckets a game by the PREVIOUS game in the same sitting, skipping a sitting-opener', () => {
    const games = [
      game({ result: 'Win', matchId: 'a1', timestamp: T0 }), // opener — no prior game
      game({ result: 'Win', matchId: 'a2', timestamp: T0 + 30 * MIN, mental: { tilt: true } }), // after a win
      game({ result: 'Loss', matchId: 'a3', timestamp: T0 + 60 * MIN }), // after a win
    ];
    const r = tiltAfterResult(games);
    expect(r.afterWin).toEqual({ key: 'afterWin', games: 2, tilted: 1, rate: 0.5 });
    expect(r.afterLoss).toEqual({ key: 'afterLoss', games: 0, tilted: 0, rate: 0 });
  });

  it('buckets games after a loss separately, and skips a new sitting boundary', () => {
    const games = [
      game({ result: 'Loss', matchId: 'b1', timestamp: T0 }),
      game({ result: 'Win', matchId: 'b2', timestamp: T0 + 30 * MIN, mental: { tilt: true } }), // after a loss
      // > 90 min gap: new sitting, so this one has no prior game in ITS sitting
      game({ result: 'Win', matchId: 'b3', timestamp: T0 + 200 * MIN }),
    ];
    const r = tiltAfterResult(games);
    expect(r.afterLoss).toEqual({ key: 'afterLoss', games: 1, tilted: 1, rate: 1 });
    expect(r.afterWin).toEqual({ key: 'afterWin', games: 0, tilted: 0, rate: 0 });
  });

  it('scopes bucketing via include without breaking sitting adjacency', () => {
    const games = [
      game({ result: 'Loss', matchId: 'c1', timestamp: T0 }),
      game({ result: 'Win', matchId: 'c2', timestamp: T0 + 30 * MIN, mental: { tilt: true } }),
    ];
    const r = tiltAfterResult(games, { include: new Set(['c2']) });
    expect(r.afterLoss).toEqual({ key: 'afterLoss', games: 1, tilted: 1, rate: 1 });
  });

  it('is zeroed for no games', () => {
    const r = tiltAfterResult([]);
    expect(r.afterWin).toEqual({ key: 'afterWin', games: 0, tilted: 0, rate: 0 });
    expect(r.afterLoss).toEqual({ key: 'afterLoss', games: 0, tilted: 0, rate: 0 });
  });
});

describe('tiltByMap', () => {
  it('ranks maps by tilt rate, floored at the min-games threshold, top 3', () => {
    const games = [
      atHour(10, true, 'Ilios'), atHour(11, true, 'Ilios'), atHour(12, false, 'Ilios'), // 2/3
      atHour(10, true, 'Oasis'), atHour(11, false, 'Oasis'), atHour(12, false, 'Oasis'), // 1/3
      atHour(10, true, 'Busan'), atHour(11, false, 'Busan'), // 1/2, under default min of 3 — excluded
    ];
    const t = tiltByMap(games);
    expect(t).toEqual([
      { key: 'Ilios', games: 3, tilted: 2, rate: 2 / 3 },
      { key: 'Oasis', games: 3, tilted: 1, rate: 1 / 3 },
    ]);
  });

  it('is empty for no games', () => {
    expect(tiltByMap([])).toEqual([]);
  });
});
