import { describe, it, expect } from 'vitest';
import { currentSession, dayKey, groupByDay, groupBySitting, sessionDebrief, sessionHistory, streakStats } from '../src/core/analytics';
import type { GameRecord, HeroStat } from '../src/core/analytics';
import type { Result, Role } from '../src/core/model';
import { NOTION_IMPROVEMENT_TARGET_ID, type AuthoredTarget } from '../src/core/targets';

const NOW = Date.UTC(2026, 6, 4, 15, 0, 0); // Jul 4, 15:00 UTC (dayKey buckets by UTC day)

function game(p: Partial<GameRecord> & { timestamp: number; result: Result }): GameRecord {
  return {
    matchId: Math.random().toString(36).slice(2),
    account: 'Main',
    role: 'damage' as Role,
    map: 'Ilios',
    gameType: 'Competitive',
    heroes: ['Tracer'],
    ...p,
  };
}

const hoursAgo = (h: number): number => NOW - h * 3_600_000;

function measuredTarget(rule: string, p: Partial<AuthoredTarget> = {}): AuthoredTarget {
  return { id: 't', name: 't', mode: 'measured', rule, createdAt: 0, isActive: true, ...p };
}
function hero(p: Partial<HeroStat> = {}): HeroStat {
  return { hero: 'Tracer', role: 'damage', eliminations: 0, deaths: 0, assists: 0, damage: 0, healing: 0, mitigation: 0, ...p };
}

describe('groupByDay', () => {
  it('groups under Today/Yesterday/date labels with per-day W–L tallies', () => {
    const rows = [
      { timestamp: hoursAgo(1), result: 'Win' },
      { timestamp: hoursAgo(2), result: 'Loss' },
      { timestamp: hoursAgo(3), result: 'Win' },
      { timestamp: hoursAgo(24), result: 'Loss' }, // yesterday 15:00
      { timestamp: hoursAgo(26), result: 'Loss' },
      { timestamp: hoursAgo(24 * 5), result: 'Win' }, // 5 days back
    ];
    const groups = groupByDay(rows, NOW);
    expect(groups.map((g) => g.label)).toEqual(['Today', 'Yesterday', dayKey(hoursAgo(24 * 5))]);
    expect(groups[0]).toMatchObject({ wins: 2, losses: 1 });
    expect(groups[1]).toMatchObject({ wins: 0, losses: 2 });
    expect(groups[2].items).toHaveLength(1);
  });

  it('respects the midnight boundary (23:59 vs 00:01 land in different groups)', () => {
    const midnight = Date.UTC(2026, 6, 4, 0, 0, 0);
    const rows = [
      { timestamp: midnight + 60_000, result: 'Win' },   // today 00:01
      { timestamp: midnight - 60_000, result: 'Loss' },  // yesterday 23:59
    ];
    const groups = groupByDay(rows, NOW);
    expect(groups.map((g) => g.label)).toEqual(['Today', 'Yesterday']);
  });

  it('orders newest day first and newest row first within a day', () => {
    const rows = [
      { timestamp: hoursAgo(5), result: 'Win' },
      { timestamp: hoursAgo(1), result: 'Loss' },
    ];
    const [today] = groupByDay(rows, NOW);
    expect(today.items[0].timestamp).toBe(hoursAgo(1));
  });

  it('returns no groups for no rows', () => {
    expect(groupByDay([], NOW)).toEqual([]);
  });

  it('counts draws separately rather than dropping them from the tally (M3)', () => {
    const rows = [
      { timestamp: hoursAgo(1), result: 'Win' },
      { timestamp: hoursAgo(2), result: 'Loss' },
      { timestamp: hoursAgo(3), result: 'Draw' },
    ];
    const [today] = groupByDay(rows, NOW);
    expect(today).toMatchObject({ wins: 1, losses: 1, draws: 1 });
    expect(today.items).toHaveLength(3);
  });

  it('sums only the rows with a known srDelta into srNet, and counts them in srKnown (M3)', () => {
    const rows = [
      { timestamp: hoursAgo(1), result: 'Win', srDelta: 20 },
      { timestamp: hoursAgo(2), result: 'Loss', srDelta: -8 },
      { timestamp: hoursAgo(3), result: 'Win' }, // no srDelta logged
    ];
    const [today] = groupByDay(rows, NOW);
    expect(today.srNet).toBe(12);
    expect(today.srKnown).toBe(2);
  });

  it('leaves srNet undefined — never a fabricated 0 — when no row in the day logged an srDelta', () => {
    const rows = [
      { timestamp: hoursAgo(1), result: 'Win' },
      { timestamp: hoursAgo(2), result: 'Loss' },
    ];
    const [today] = groupByDay(rows, NOW);
    expect(today.srNet).toBeUndefined();
    expect(today.srKnown).toBe(0);
  });
});

describe('currentSession', () => {
  it('joins games across midnight when consecutive gaps stay within the threshold', () => {
    const games = [
      game({ timestamp: Date.UTC(2026, 6, 3, 23, 30, 0), result: 'Win' }),
      game({ timestamp: Date.UTC(2026, 6, 4, 0, 45, 0), result: 'Loss' }), // 75 min gap, crosses midnight
    ];
    const now = Date.UTC(2026, 6, 4, 1, 0, 0);
    expect(currentSession(games, now, 180)).toMatchObject({ games: 2, wins: 1, losses: 1 });
  });

  it('splits off the trailing group when a gap exceeds the threshold', () => {
    const games = [
      game({ timestamp: hoursAgo(10), result: 'Loss' }),
      game({ timestamp: hoursAgo(9), result: 'Loss' }),
      // gap > 3h threshold here
      game({ timestamp: hoursAgo(2), result: 'Win' }),
      game({ timestamp: hoursAgo(1), result: 'Win' }),
    ];
    expect(currentSession(games, NOW, 180)).toMatchObject({ games: 2, wins: 2, losses: 0 });
  });

  it('returns null once the elapsed time since the last game exceeds the threshold', () => {
    const games = [game({ timestamp: hoursAgo(4), result: 'Win' })];
    expect(currentSession(games, NOW, 180)).toBeNull();
  });

  it('returns the session when elapsed time since the last game is within the threshold, even from a previous calendar day', () => {
    const games = [game({ timestamp: hoursAgo(2), result: 'Win' })];
    expect(currentSession(games, NOW, 180)).toMatchObject({ games: 1, wins: 1 });
  });

  it('returns null for no games', () => {
    expect(currentSession([], NOW, 180)).toBeNull();
  });

  it('keeps a gap exactly equal to the threshold in the same session, but splits one unit past it', () => {
    const gapMs = 180 * 60_000;
    const joined = [
      game({ timestamp: NOW - gapMs, result: 'Loss' }),
      game({ timestamp: NOW, result: 'Win' }),
    ];
    expect(currentSession(joined, NOW, 180)).toMatchObject({ games: 2, wins: 1, losses: 1 });

    const split = [
      game({ timestamp: NOW - gapMs - 60_000, result: 'Loss' }),
      game({ timestamp: NOW, result: 'Win' }),
    ];
    expect(currentSession(split, NOW, 180)).toMatchObject({ games: 1, wins: 1, losses: 0 });
  });
});

describe('sessionDebrief (S3)', () => {
  it('is null with no games at all', () => {
    expect(sessionDebrief([], [], NOW)).toBeNull();
  });

  it('summarizes the trailing gap-based sitting, not a calendar day — a game 2 days back in a DIFFERENT sitting is excluded', () => {
    const games = [
      game({ timestamp: hoursAgo(28), result: 'Loss' }),
      // gap > 180min threshold here — the sitting boundary, not midnight
      game({ timestamp: hoursAgo(24), result: 'Win' }),
      game({ timestamp: hoursAgo(23), result: 'Win' }),
      game({ timestamp: hoursAgo(50), result: 'Loss' }), // a much older, separate sitting — excluded
    ];
    const r = sessionDebrief(games, [], NOW, 180)!;
    expect(r).toMatchObject({ wins: 2, losses: 0, net: 2, games: 2 });
    expect(r.startedAt).toBe(hoursAgo(24));
    expect(r.endedAt).toBe(hoursAgo(23));
  });

  it('reports closed only once the trailing sitting has aged past the gap', () => {
    const stillOpen = [game({ timestamp: hoursAgo(2), result: 'Win' })];
    expect(sessionDebrief(stillOpen, [], NOW, 180)!.closed).toBe(false);

    const closed = [game({ timestamp: hoursAgo(4), result: 'Win' })];
    expect(sessionDebrief(closed, [], NOW, 180)!.closed).toBe(true);
  });

  it('a sitting spanning midnight stays one block (the bug the UTC-day recap had)', () => {
    const games = [
      game({ timestamp: Date.UTC(2026, 6, 3, 23, 30, 0), result: 'Win' }),
      game({ timestamp: Date.UTC(2026, 6, 4, 0, 45, 0), result: 'Loss' }), // 75 min later, crosses midnight
    ];
    const now = Date.UTC(2026, 6, 4, 4, 0, 0);
    expect(sessionDebrief(games, [], now, 180)).toMatchObject({ games: 2, wins: 1, losses: 1 });
  });

  it('names best/worst map only with ≥2 distinct maps', () => {
    const oneMap = [game({ timestamp: hoursAgo(1), result: 'Win', map: 'Ilios' })];
    expect(sessionDebrief(oneMap, [], NOW)!.bestMap).toBeUndefined();

    const twoMaps = [
      game({ timestamp: hoursAgo(2), result: 'Win', map: 'Ilios' }),
      game({ timestamp: hoursAgo(1), result: 'Loss', map: 'Numbani' }),
    ];
    const r = sessionDebrief(twoMaps, [], NOW)!;
    expect(r.bestMap).toBe('Ilios');
    expect(r.worstMap).toBe('Numbani');
  });

  it('returns the top heroes played, most-played first', () => {
    const games = [
      game({ timestamp: hoursAgo(3), result: 'Win', heroes: ['Tracer'] }),
      game({ timestamp: hoursAgo(2), result: 'Win', heroes: ['Tracer'] }),
      game({ timestamp: hoursAgo(1), result: 'Loss', heroes: ['Genji'] }),
    ];
    const r = sessionDebrief(games, [], NOW)!;
    expect(r.heroes[0]).toMatchObject({ hero: 'Tracer', games: 2, winrate: 1 });
    expect(r.heroes[1]).toMatchObject({ hero: 'Genji', games: 1, winrate: 0 });
  });

  it('sums SR deltas logged in the sitting; absent when none were', () => {
    const logged = [
      game({ timestamp: hoursAgo(2), result: 'Win', srDelta: 25 }),
      game({ timestamp: hoursAgo(1), result: 'Loss', srDelta: -18 }),
    ];
    const r = sessionDebrief(logged, [], NOW)!;
    expect(r.srDelta).toBe(7);
    expect(r.srDeltaGames).toBe(2);

    const none = [game({ timestamp: hoursAgo(1), result: 'Win' })];
    expect(sessionDebrief(none, [], NOW)!.srDelta).toBeUndefined();
  });

  it('lists competitive matches in the sitting with no review at all as ungraded', () => {
    const games = [
      game({ timestamp: hoursAgo(2), result: 'Win' }), // no review — ungraded
      game({ timestamp: hoursAgo(1), result: 'Loss', review: { at: NOW, grades: {}, flags: {} } }), // reviewed (even with no grades)
    ];
    const r = sessionDebrief(games, [], NOW)!;
    expect(r.ungradedMatchIds).toEqual([games[0].matchId]);
  });

  it('merges quick-log and review flags without double-counting one game', () => {
    const games = [
      game({
        timestamp: hoursAgo(1), result: 'Loss',
        mental: { tilt: true },
        review: { at: NOW, grades: {}, flags: { tilt: true, leaver: true } },
      }),
    ];
    const r = sessionDebrief(games, [], NOW)!;
    expect(r.flags.tilt).toBe(1);
    expect(r.flags.leaver).toBe(1);
  });

  it('computes target hit-rate over graded reviews; absent with no grades', () => {
    const graded = [
      game({
        timestamp: hoursAgo(2), result: 'Win',
        review: { at: NOW, grades: { a: 'hit', b: 'missed' }, flags: {} },
      }),
      game({
        timestamp: hoursAgo(1), result: 'Loss',
        review: { at: NOW, grades: { a: 'hit' }, flags: {} },
      }),
    ];
    expect(sessionDebrief(graded, [], NOW)!.targetHitRate).toBeCloseTo(2 / 3);

    const ungraded = [game({ timestamp: hoursAgo(1), result: 'Win' })];
    expect(sessionDebrief(ungraded, [], NOW)!.targetHitRate).toBeUndefined();
  });

  it('excludes the hidden Notion-import bookkeeping grade from target hit-rate (spec B2)', () => {
    // A match reviewed in-app (one authored target, hit) that ALSO carries the
    // hidden bookkeeping grade from a Notion import (missed) — the bookkeeping
    // grade must not count as an attempt or a hit.
    const mixed = [
      game({
        timestamp: hoursAgo(1), result: 'Win',
        review: { at: NOW, grades: { a: 'hit', [NOTION_IMPROVEMENT_TARGET_ID]: 'missed' }, flags: {} },
      }),
    ];
    expect(sessionDebrief(mixed, [], NOW)!.targetHitRate).toBe(1); // 1/1, not 1/2

    // A match with ONLY the bookkeeping grade (pure Notion import, no in-app
    // review) contributes no attempts at all — targetHitRate stays absent.
    const onlyBookkeeping = [
      game({
        timestamp: hoursAgo(1), result: 'Win',
        review: { at: NOW, grades: { [NOTION_IMPROVEMENT_TARGET_ID]: 'hit' }, flags: {} },
      }),
    ];
    expect(sessionDebrief(onlyBookkeeping, [], NOW)!.targetHitRate).toBeUndefined();
  });

  it('folds in an active measured target\'s auto-graded value alongside self-rated grades', () => {
    const games = [
      // Self-rated target 'a': hit. Measured target 'm' auto-grades from
      // stats: Deaths ≤ 3, this match's per-10 deaths = 2*10/10 = 2 → hit.
      game({
        timestamp: hoursAgo(1), result: 'Win', durationMinutes: 10, playedMinutes: 10,
        perHero: [hero({ deaths: 2 })],
        review: { at: NOW, grades: { a: 'hit' }, flags: {} },
      }),
    ];
    const measured = measuredTarget('Deaths ≤ 3', { id: 'm' });
    const r = sessionDebrief(games, [measured], NOW)!;
    expect(r.targetHitRate).toBe(1); // 2/2 — both the self-rated and the auto-graded hit

    // A measured target the match can't evaluate (no perHero stats) contributes
    // no attempt, same as evaluateMeasured's own 'no-stat' skip.
    const noStat = [game({ timestamp: hoursAgo(1), result: 'Win', review: { at: NOW, grades: { a: 'hit' }, flags: {} } })];
    expect(sessionDebrief(noStat, [measured], NOW)!.targetHitRate).toBe(1); // still just 1/1 from the self grade
  });

  it('ignores a measured target that has since gone inactive or archived', () => {
    const games = [
      game({
        timestamp: hoursAgo(1), result: 'Win', durationMinutes: 10, playedMinutes: 10,
        perHero: [hero({ deaths: 2 })],
      }),
    ];
    const inactive = measuredTarget('Deaths ≤ 3', { id: 'm', isActive: false });
    expect(sessionDebrief(games, [inactive], NOW)!.targetHitRate).toBeUndefined();
  });
});

describe('sessionHistory (S4)', () => {
  it('returns no sittings for no games', () => {
    expect(sessionHistory([], 180)).toEqual([]);
  });

  it('splits into sittings on the gap and returns them newest-first', () => {
    const games = [
      game({ timestamp: hoursAgo(50), result: 'Loss' }),
      game({ timestamp: hoursAgo(49), result: 'Win' }),
      // gap > 180min here
      game({ timestamp: hoursAgo(2), result: 'Win' }),
      game({ timestamp: hoursAgo(1), result: 'Win' }),
    ];
    const rows = sessionHistory(games, 180);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ games: 2, wins: 2, losses: 0, net: 2 }); // most recent sitting first
    expect(rows[0].startedAt).toBe(hoursAgo(2));
    expect(rows[0].endedAt).toBe(hoursAgo(1));
    expect(rows[1]).toMatchObject({ games: 2, wins: 1, losses: 1, net: 0 });
  });

  it('minutes spans first-game-start to last-game-end — a single 15-minute game reads as 15, not 0', () => {
    const solo = [game({ timestamp: hoursAgo(1), result: 'Win', durationMinutes: 15 })];
    expect(sessionHistory(solo, 180)[0].minutes).toBe(15);

    const two = [
      game({ timestamp: hoursAgo(1), result: 'Win', durationMinutes: 10 }),
      game({ timestamp: hoursAgo(1) + 20 * 60_000, result: 'Loss' }),
    ];
    expect(sessionHistory(two, 180)[0].minutes).toBe(30); // 20min span + the first game's own 10min
  });

  it('counts tilt from quick-log or review without double-counting one game', () => {
    const games = [
      game({ timestamp: hoursAgo(2), result: 'Loss', mental: { tilt: true } }),
      game({ timestamp: hoursAgo(1), result: 'Loss', review: { at: NOW, grades: {}, flags: { tilt: true } } }),
    ];
    expect(sessionHistory(games, 180)[0].tiltCount).toBe(2);
  });

  it('sums SR delta, excluding suppressed (placement) games from the sum', () => {
    const games = [
      game({ timestamp: hoursAgo(2), result: 'Win', srDelta: 25, matchId: 'p1' }),
      game({ timestamp: hoursAgo(1), result: 'Loss', srDelta: -18, matchId: 'm2' }),
    ];
    const suppressed = new Set(['p1']);
    const r = sessionHistory(games, 180, suppressed)[0];
    expect(r.srDelta).toBe(-18); // p1's +25 excluded — a placement SR isn't comparable
    expect(r.srDeltaGames).toBe(1);
  });

  it('reports the top map and average self-rating', () => {
    const games = [
      game({ timestamp: hoursAgo(3), result: 'Win', map: 'Ilios', performance: 80 }),
      game({ timestamp: hoursAgo(2), result: 'Win', map: 'Ilios', performance: 60 }),
      game({ timestamp: hoursAgo(1), result: 'Loss', map: 'Busan' }), // unrated
    ];
    const r = sessionHistory(games, 180)[0];
    expect(r.topMap).toBe('Ilios');
    expect(r.avgRating).toBe(70);
  });

  it('reports the streak as it stood at the END of the sitting', () => {
    const games = [
      game({ timestamp: hoursAgo(3), result: 'Loss' }),
      game({ timestamp: hoursAgo(2), result: 'Win' }),
      game({ timestamp: hoursAgo(1), result: 'Win' }),
    ];
    expect(sessionHistory(games, 180)[0].streak).toEqual({ type: 'W', count: 2 });
  });
});

describe('groupBySitting (S4)', () => {
  const at = (i: number, result: Result): { timestamp: number; result: Result } => ({ timestamp: hoursAgo(i), result });

  it('joins rows across midnight when consecutive gaps stay within the threshold — the bug day-grouping had', () => {
    const rows = [
      { timestamp: Date.UTC(2026, 6, 3, 23, 30, 0), result: 'Win' as Result },
      { timestamp: Date.UTC(2026, 6, 4, 0, 45, 0), result: 'Loss' as Result }, // 75min later, crosses midnight
    ];
    const groups = groupBySitting(rows, 180, Date.UTC(2026, 6, 4, 4, 0, 0));
    expect(groups).toHaveLength(1);
    expect(groups[0].items).toHaveLength(2);
  });

  it('splits on a gap exceeding the threshold, newest sitting first', () => {
    const rows = [at(7, 'Win'), at(6, 'Loss'), at(1, 'Win'), at(0.5, 'Win')];
    const groups = groupBySitting(rows, 180, NOW);
    expect(groups).toHaveLength(2);
    expect(groups[0].items).toHaveLength(2); // the two recent games
    expect(groups[1].items).toHaveLength(2); // the two older games
    expect(groups[0].wins).toBe(2);
    expect(groups[1]).toMatchObject({ wins: 1, losses: 1 });
  });

  it('labels the sitting containing `now` as "Today\'s session" only while it is still open', () => {
    const open = groupBySitting([at(1, 'Win')], 180, NOW);
    expect(open[0].label).toBe('Today’s session');

    const closed = groupBySitting([at(4, 'Win')], 180, NOW); // 4h ago, past the 3h gap
    expect(closed[0].label).not.toBe('Today’s session');
  });

  it('returns no groups for no rows', () => {
    expect(groupBySitting([], 180, NOW)).toEqual([]);
  });

  it('carries the same draws/srNet/srKnown tally as groupByDay (M3)', () => {
    const rows = [
      { timestamp: hoursAgo(1), result: 'Win' as Result, srDelta: 15 },
      { timestamp: hoursAgo(2), result: 'Draw' as Result },
      { timestamp: hoursAgo(3), result: 'Loss' as Result, srDelta: -20 },
    ];
    const [sitting] = groupBySitting(rows, 180, NOW);
    expect(sitting).toMatchObject({ wins: 1, losses: 1, draws: 1, srNet: -5, srKnown: 2 });
  });
});

describe('streakStats (C7)', () => {
  it('returns zeroed streaks and no days for no games', () => {
    const s = streakStats([]);
    expect(s).toMatchObject({ longestWin: 0, longestLoss: 0 });
    expect(s.bestDay).toBeUndefined();
    expect(s.worstDay).toBeUndefined();
  });

  it('finds the longest win and loss runs anywhere in range, draws breaking neither', () => {
    // W W W L L Draw W L L L L — longest win run 3, longest loss run 4 (the draw doesn't reset it)
    const results: Result[] = ['Win', 'Win', 'Win', 'Loss', 'Loss', 'Draw', 'Win', 'Loss', 'Loss', 'Loss', 'Loss'];
    const games = results.map((result, i) => game({ timestamp: hoursAgo(20 - i), result }));
    const s = streakStats(games);
    expect(s.longestWin).toBe(3);
    expect(s.longestLoss).toBe(4);
  });

  it('finds the best and worst single calendar day by net wins − losses', () => {
    const games = [
      // "Today" (hoursAgo 1-3): 3W 0L, net +3 — the best day.
      game({ timestamp: hoursAgo(1), result: 'Win' }),
      game({ timestamp: hoursAgo(2), result: 'Win' }),
      game({ timestamp: hoursAgo(3), result: 'Win' }),
      // A day 26h back: 1W 3L, net −2 — the worst day.
      game({ timestamp: hoursAgo(26), result: 'Win' }),
      game({ timestamp: hoursAgo(27), result: 'Loss' }),
      game({ timestamp: hoursAgo(28), result: 'Loss' }),
      game({ timestamp: hoursAgo(29), result: 'Loss' }),
    ];
    const s = streakStats(games);
    expect(s.bestDay).toMatchObject({ date: dayKey(hoursAgo(1)), net: 3, wins: 3, losses: 0 });
    expect(s.worstDay).toMatchObject({ date: dayKey(hoursAgo(26)), net: -2, wins: 1, losses: 3 });
  });
});
