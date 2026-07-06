import { describe, it, expect } from 'vitest';
import { dayKey, groupByDay, sessionRecap } from '../src/core/analytics';
import type { GameRecord } from '../src/core/analytics';
import type { Result, Role } from '../src/core/model';
import { NOTION_IMPROVEMENT_TARGET_ID } from '../src/core/targets';

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
});

describe('sessionRecap', () => {
  it('is null when yesterday had no games', () => {
    expect(sessionRecap([game({ timestamp: hoursAgo(1), result: 'Win' })], NOW)).toBeNull();
  });

  it('summarizes yesterday only: W–L, net, winrate, game count', () => {
    const games = [
      game({ timestamp: hoursAgo(24), result: 'Win' }),
      game({ timestamp: hoursAgo(25), result: 'Win' }),
      game({ timestamp: hoursAgo(26), result: 'Loss' }),
      game({ timestamp: hoursAgo(1), result: 'Loss' }),   // today — excluded
      game({ timestamp: hoursAgo(50), result: 'Loss' }),  // 2 days ago — excluded
    ];
    const r = sessionRecap(games, NOW)!;
    expect(r).toMatchObject({ wins: 2, losses: 1, net: 1, games: 3 });
    expect(r.date).toBe(dayKey(hoursAgo(24)));
  });

  it('names best/worst map only with ≥2 distinct maps', () => {
    const oneMap = [game({ timestamp: hoursAgo(24), result: 'Win', map: 'Ilios' })];
    expect(sessionRecap(oneMap, NOW)!.bestMap).toBeUndefined();

    const twoMaps = [
      game({ timestamp: hoursAgo(24), result: 'Win', map: 'Ilios' }),
      game({ timestamp: hoursAgo(25), result: 'Loss', map: 'Numbani' }),
    ];
    const r = sessionRecap(twoMaps, NOW)!;
    expect(r.bestMap).toBe('Ilios');
    expect(r.worstMap).toBe('Numbani');
  });

  it('merges quick-log and review flags without double-counting one game', () => {
    const games = [
      game({
        timestamp: hoursAgo(24), result: 'Loss',
        mental: { tilt: true },
        review: { at: NOW, grades: {}, flags: { tilt: true, leaver: true } },
      }),
    ];
    const r = sessionRecap(games, NOW)!;
    expect(r.flags.tilt).toBe(1);
    expect(r.flags.leaver).toBe(1);
  });

  it('computes target hit-rate over graded reviews; absent with no grades', () => {
    const graded = [
      game({
        timestamp: hoursAgo(24), result: 'Win',
        review: { at: NOW, grades: { a: 'hit', b: 'missed' }, flags: {} },
      }),
      game({
        timestamp: hoursAgo(25), result: 'Loss',
        review: { at: NOW, grades: { a: 'hit' }, flags: {} },
      }),
    ];
    expect(sessionRecap(graded, NOW)!.targetHitRate).toBeCloseTo(2 / 3);

    const ungraded = [game({ timestamp: hoursAgo(24), result: 'Win' })];
    expect(sessionRecap(ungraded, NOW)!.targetHitRate).toBeUndefined();
  });

  it('excludes the hidden Notion-import bookkeeping grade from target hit-rate (spec B2)', () => {
    // A match reviewed in-app (one authored target, hit) that ALSO carries the
    // hidden bookkeeping grade from a Notion import (missed) — the bookkeeping
    // grade must not count as an attempt or a hit.
    const mixed = [
      game({
        timestamp: hoursAgo(24), result: 'Win',
        review: { at: NOW, grades: { a: 'hit', [NOTION_IMPROVEMENT_TARGET_ID]: 'missed' }, flags: {} },
      }),
    ];
    expect(sessionRecap(mixed, NOW)!.targetHitRate).toBe(1); // 1/1, not 1/2

    // A match with ONLY the bookkeeping grade (pure Notion import, no in-app
    // review) contributes no attempts at all — targetHitRate stays absent.
    const onlyBookkeeping = [
      game({
        timestamp: hoursAgo(24), result: 'Win',
        review: { at: NOW, grades: { [NOTION_IMPROVEMENT_TARGET_ID]: 'hit' }, flags: {} },
      }),
    ];
    expect(sessionRecap(onlyBookkeeping, NOW)!.targetHitRate).toBeUndefined();
  });
});
