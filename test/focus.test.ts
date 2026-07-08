import { describe, it, expect } from 'vitest';
import { focusEntries, focusTrend, linkFocusTargets, type GameRecord } from '../src/core/analytics';
import { NOTION_IMPROVEMENT_TARGET_ID, type AuthoredTarget } from '../src/core/targets';
import { computeDashboard } from '../src/core/dashboardData';
import type { Result } from '../src/core/model';

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

  it('is undefined when a half has no decided games — draws must not fabricate a 0% baseline', () => {
    // Earlier half: 3 draws (no decided games at all). Recent half: 2L 1W.
    const drawsThenLosses = [0, 1, 2].map((i) => at(i, 'Draw'))
      .concat([3, 4].map((i) => at(i, 'Loss')), [at(5, 'Win')]);
    expect(focusTrend(drawsThenLosses)).toBeUndefined();

    // Mirror: recent half is all draws.
    const lossesThenDraws = [0, 1].map((i) => at(i, 'Loss')).concat([at(2, 'Win')])
      .concat([3, 4, 5].map((i) => at(i, 'Draw')));
    expect(focusTrend(lossesThenDraws)).toBeUndefined();
  });

  it('reads flat at an exact 5-point move despite IEEE-754 float wobble', () => {
    // Earlier half: 10W/10L (50%). Recent half: 11W/9L (55%) — exactly a 5-point
    // move, which in raw floats is 0.050000000000000044 (> 0.05) without rounding.
    const earlier = Array.from({ length: 20 }, (_, i) => at(i, i < 10 ? 'Win' : 'Loss'));
    const recent = Array.from({ length: 20 }, (_, i) => at(20 + i, i < 11 ? 'Win' : 'Loss'));
    expect(focusTrend([...earlier, ...recent])).toBe('flat');
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

describe('linkFocusTargets', () => {
  let tSeq = 0;
  function target(name: string, p: Partial<AuthoredTarget> = {}): AuthoredTarget {
    tSeq += 1;
    return {
      id: `t${tSeq}`, name, mode: 'self', rule: 'You grade it',
      createdAt: T0, isActive: true, ...p,
    };
  }
  const at = (i: number, result: Result, p: Partial<GameRecord> = {}): GameRecord =>
    game({ result, timestamp: T0 + i * HOUR, ...p });
  /** A single map entry to link against. */
  const entriesFor = (games: GameRecord[]) => focusEntries(games).filter((e) => e.dimension === 'map');

  it('links by case-insensitive name substring and computes the since-flagged delta', () => {
    // Before the flag: 1W4L (20%). Since: 3W1L (75%). Flag at i=5. Net stays 1.
    const games = [
      at(0, 'Win', { map: "King's Row" }), ...[1, 2, 3, 4].map((i) => at(i, 'Loss', { map: "King's Row" })),
      ...[5, 6, 7].map((i) => at(i, 'Win', { map: "King's Row" })), at(8, 'Loss', { map: "King's Row" }),
    ];
    const t = target("practice KING'S ROW: warm up unranked + review one replay", { activatedAt: T0 + 5 * HOUR });
    const [linked] = linkFocusTargets(entriesFor(games), [t], games);
    expect(linked.progress).toMatchObject({
      targetId: t.id, targetName: t.name, since: T0 + 5 * HOUR, gamesSince: 4, deltaPts: 55,
    });
  });

  it('falls back to createdAt when activatedAt is absent', () => {
    const games = [0, 1, 2].map((i) => at(i, 'Loss', { map: 'Busan' }));
    const t = target('Practice Busan: warm up', { createdAt: T0 + 1 * HOUR });
    const [linked] = linkFocusTargets(entriesFor(games), [t], games);
    expect(linked.progress?.since).toBe(T0 + 1 * HOUR);
    expect(linked.progress?.gamesSince).toBe(2);
    expect(linked.progress?.deltaPts).toBeUndefined(); // 1 decided game before < 3
  });

  it('never links inactive, archived, non-matching or Notion-bookkeeping targets', () => {
    const games = [0, 1, 2].map((i) => at(i, 'Loss', { map: 'Oasis' }));
    const targets = [
      target('Practice Oasis', { isActive: false }),
      target('Practice Oasis', { archivedAt: T0 }),
      target('Practice Ilios'),
      { ...target('Practice Oasis'), id: NOTION_IMPROVEMENT_TARGET_ID },
    ];
    const [entry] = linkFocusTargets(entriesFor(games), targets, games);
    expect(entry.progress).toBeUndefined();
  });

  it('picks the most recently flagged target when several match', () => {
    const games = [0, 1, 2].map((i) => at(i, 'Loss', { map: 'Junkertown' }));
    const older = target('Practice Junkertown v1', { activatedAt: T0 + 1 * HOUR });
    const newer = target('Practice Junkertown v2', { activatedAt: T0 + 2 * HOUR });
    const [linked] = linkFocusTargets(entriesFor(games), [older, newer], games);
    expect(linked.progress?.targetId).toBe(newer.id);
  });

  it('counts gamesSince over the full history, not the filtered range', () => {
    // Entry derived from a narrow range; allGames holds older + newer games too.
    const rangeGames = [10, 11, 12].map((i) => at(i, 'Loss', { map: 'Hollywood' }));
    const allGames = [
      ...[0, 1].map((i) => at(i, 'Loss', { map: 'Hollywood' })), // before the flag
      ...[5, 6].map((i) => at(i, 'Win', { map: 'Hollywood' })), // since, outside range
      ...rangeGames,
    ];
    const t = target('Practice Hollywood', { activatedAt: T0 + 4 * HOUR });
    const [linked] = linkFocusTargets(entriesFor(rangeGames), [t], allGames);
    expect(linked.progress?.gamesSince).toBe(5);
  });

  it('draws are not decided games for the delta gate', () => {
    const games = [
      at(0, 'Win', { map: 'Nepal' }), at(1, 'Loss', { map: 'Nepal' }), at(2, 'Draw', { map: 'Nepal' }),
      ...[3, 4, 5, 6].map((i) => at(i, 'Loss', { map: 'Nepal' })),
    ];
    const t = target('Practice Nepal', { activatedAt: T0 + 3 * HOUR });
    const [linked] = linkFocusTargets(entriesFor(games), [t], games);
    // Before: W L D → only 2 decided; since: 4 losses. No delta, but progress rides.
    expect(linked.progress?.gamesSince).toBe(4);
    expect(linked.progress?.deltaPts).toBeUndefined();
  });

  it('matches across apostrophe styles and role display labels', () => {
    // Curly apostrophe in the target name still links the straight-quoted key…
    const mapGames = [0, 1, 2].map((i) => at(i, 'Loss', { map: "King's Row" }));
    const curly = target('Practice King’s Row: warm up unranked');
    expect(linkFocusTargets(entriesFor(mapGames), [curly], mapGames)[0].progress?.targetId).toBe(curly.id);
    // …and a role prefill written with the display label links the openQ key.
    const roleGames = [0, 1, 2, 3, 4].map((i) => at(i, 'Loss', { role: 'openQ', map: `M${i}` }));
    const label = target('Practice Open Q: warm up unranked + review one replay');
    const entries = focusEntries(roleGames).filter((e) => e.dimension === 'role');
    expect(linkFocusTargets(entries, [label], roleGames)[0].progress?.targetId).toBe(label.id);
  });

  it('links hero and role entries too', () => {
    const games = [
      ...[0, 1, 2].map((i) => at(i, 'Loss', { heroes: ['Ana'], map: `H${i}` })),
      ...[3, 4, 5, 6, 7].map((i) => at(i, 'Loss', { role: 'support', map: `R${i}` })),
    ];
    const entries = focusEntries(games);
    const linked = linkFocusTargets(entries, [target('Practice Ana: aim drills'), target('Fix my SUPPORT games')], games);
    expect(linked.find((e) => e.dimension === 'hero' && e.key === 'Ana')?.progress).toBeDefined();
    expect(linked.find((e) => e.dimension === 'role' && e.key === 'support')?.progress).toBeDefined();
    expect(linked.find((e) => e.dimension === 'map')?.progress).toBeUndefined();
  });
});

describe('dashboard focusItems payload', () => {
  const demo = { active: false, preference: 'off' as const, hasRealHistory: true };
  const at = (i: number, result: Result, p: Partial<GameRecord> = {}): GameRecord =>
    game({ result, timestamp: T0 + i * HOUR, ...p });

  it('ships the cross-dimension list on DashboardData', () => {
    const games = run(6, ['Loss', 'Loss', 'Loss', 'Loss', 'Loss', 'Win'], {
      map: 'Midtown', role: 'tank', heroes: ['Reinhardt'],
    });
    const d = computeDashboard(games, { days: 'all' }, demo);
    expect(d.focusItems.map((e) => e.dimension).sort()).toEqual(['hero', 'map', 'role']);
    expect(d.focusItems.every((e) => e.net > 0)).toBe(true);
  });

  it('ranks over the filtered range but tracks progress over the full history', () => {
    const now = Date.now();
    const DAY = 86400000;
    const rec = (daysAgo: number, result: Result): GameRecord =>
      game({ result, map: 'Colosseo', heroes: [], timestamp: now - daysAgo * DAY });
    const games = [
      // Old games (outside a 7-day window): 4 decided losses before the flag.
      rec(40, 'Loss'), rec(39, 'Loss'), rec(38, 'Loss'), rec(37, 'Loss'),
      // Recent games (inside the window): 1W3L → in-range net 2.
      rec(3, 'Win'), rec(2, 'Loss'), rec(1, 'Loss'), rec(0.5, 'Loss'),
    ];
    const target: AuthoredTarget = {
      id: 'tg1', name: 'Practice Colosseo: warm up unranked', mode: 'self', rule: 'You grade it',
      createdAt: now - 30 * DAY, isActive: true,
    };
    const d = computeDashboard(games, { days: 7 }, demo, { targets: [target] });
    const entry = d.focusItems.find((e) => e.key === 'Colosseo');
    // Ranking sees only the 4 in-range games…
    expect(entry).toMatchObject({ dimension: 'map', games: 4, net: 2 });
    // …but the linked-target progress runs over the full history.
    expect(entry?.progress).toMatchObject({ targetId: 'tg1', gamesSince: 4, deltaPts: 25 });
  });

  it('is empty when nothing is net-losing', () => {
    const d = computeDashboard(run(4, ['Win'], { map: 'Esperanca' }), { days: 'all' }, demo);
    expect(d.focusItems).toEqual([]);
  });
});
