import { describe, it, expect } from 'vitest';
import { focusEntries, focusTrend, heroForm, linkFocusTargets, type GameRecord } from '../src/core/analytics';
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

describe('focusEntries — maps-only', () => {
  it('flags a net-losing map only, even when the same games also net-lose a hero and role', () => {
    // 6 games, 5L 1W, all on one map / one hero / one role → only the map surfaces.
    const games = run(6, ['Loss', 'Loss', 'Loss', 'Loss', 'Loss', 'Win'], {
      map: 'Midtown', role: 'tank', heroes: ['Reinhardt'],
    });
    const entries = focusEntries(games);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      dimension: 'map', key: 'Midtown', net: 4, games: 6, wins: 1, losses: 5,
    });
  });

  it('produces no rows when only a hero/role is net-losing and no single map reaches the floor', () => {
    // role tank / hero Reinhardt are net-losing overall (5L1W) but spread one
    // game per map, so no map individually reaches the 3-game floor.
    const results: Result[] = ['Loss', 'Loss', 'Loss', 'Loss', 'Loss', 'Win'];
    const games = results.map((result, i) =>
      game({ result, map: `Solo-${i}`, role: 'tank', heroes: ['Reinhardt'] }));
    expect(focusEntries(games)).toHaveLength(0);
  });

  it('excludes maps at or below net 0', () => {
    const games = [
      ...run(4, ['Win', 'Win', 'Win', 'Loss'], { map: 'Busan' }), // net -2
      ...run(4, ['Win', 'Win', 'Loss', 'Loss'], { map: 'Oasis' }), // net 0
    ];
    expect(focusEntries(games)).toHaveLength(0);
  });

  it('drops the Unknown map bucket — a missing map id cannot surface as a row', () => {
    const games = run(5, ['Loss'], { map: '' });
    expect(focusEntries(games)).toHaveLength(0);
  });

  it('respects the map minimum-game floor of 3', () => {
    const two = run(2, ['Loss'], { map: 'Ilios' });
    expect(focusEntries(two)).toHaveLength(0);

    const three = [...two, game({ result: 'Loss', map: 'Ilios' })];
    const entries = focusEntries(three);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ dimension: 'map', key: 'Ilios', net: 3 });
  });

  it('ranks by the sample-aware deficit (H1) — an equal net at fewer games can outrank one at more games when its per-game loss rate is worse', () => {
    const games = [
      ...run(6, ['Loss', 'Loss', 'Loss', 'Loss', 'Loss', 'Win'], { map: 'P' }), // net 4, 6g, 83% loss rate
      ...run(4, ['Loss', 'Loss', 'Loss', 'Win'], { map: 'Q' }), // net 2, 4g
      ...run(8, ['Loss', 'Loss', 'Loss', 'Loss', 'Loss', 'Loss', 'Win', 'Win'], { map: 'R' }), // net 4, 8g, 75% loss rate — ties P on raw net
    ];
    const entries = focusEntries(games).filter((e) => e.dimension === 'map');
    // P and R tie on raw net (4); P's worse per-game loss rate (5/6 vs 6/8)
    // gives it the bigger Wilson-based deficit despite the smaller sample —
    // net alone (the old rule) would have put R first.
    expect(entries.map((e) => e.key)).toEqual(['P', 'R', 'Q']);
  });

  it('caps each dimension at 6, not the list overall (H1 — three short sections, not one long one)', () => {
    // 13 net-losing maps (3 losses each) exceed the per-dimension cap.
    const games = Array.from({ length: 13 }, (_, m) => run(3, ['Loss'], { map: `Map-${m}` })).flat();
    const mapEntries = focusEntries(games).filter((e) => e.dimension === 'map');
    expect(mapEntries).toHaveLength(6);
  });

  it('carries net SR alongside net wins (C2), excluding suppressed placement matches, without changing the ranking', () => {
    const games = [
      game({ result: 'Loss', map: 'Ilios', srDelta: -20, matchId: 'm1' }),
      game({ result: 'Loss', map: 'Ilios', srDelta: -18, matchId: 'm2' }),
      game({ result: 'Win', map: 'Ilios', srDelta: 999, matchId: 'p1' }), // placement, excluded from srNet
    ];
    const [ilios] = focusEntries(games, { suppressed: new Set(['p1']) }).filter((e) => e.dimension === 'map');
    expect(ilios).toMatchObject({ net: 1, srNet: -38, srLogged: 2 });
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

  it('rides on focusEntries rows with enough games, alongside the point delta behind it (H2 trendPts)', () => {
    const losses = [0, 1, 2, 3].map((i) => at(i, 'Loss', { map: 'Dorado' }));
    const wins = [4, 5, 6].map((i) => at(i, 'Win', { map: 'Dorado' }));
    const entry = focusEntries([...losses, ...wins]).find((e) => e.key === 'Dorado');
    expect(entry?.net).toBe(1);
    expect(entry?.trend).toBe('improving');
    expect(entry?.trendPts).toBeGreaterThan(0); // recent half beat the earlier half

    const three = [0, 1, 2].map((i) => at(i, 'Loss', { map: 'Numbani' }));
    const noTrend = focusEntries(three).find((e) => e.key === 'Numbani');
    expect(noTrend?.trend).toBeUndefined();
    expect(noTrend?.trendPts).toBeUndefined();
  });
});

describe('focusEntries — hero and role dimensions (H1)', () => {
  it('surfaces a net-losing hero once it reaches the 8-game floor', () => {
    const games = run(8, ['Loss', 'Loss', 'Loss', 'Loss', 'Loss', 'Loss', 'Win', 'Win'], { heroes: ['Ana'] });
    const ana = focusEntries(games).find((e) => e.dimension === 'hero' && e.key === 'Ana');
    expect(ana).toMatchObject({ net: 4, games: 8, wins: 2, losses: 6 });
  });

  it('does not surface a hero below the 8-game floor', () => {
    const games = run(7, ['Loss'], { heroes: ['Zarya'] });
    expect(focusEntries(games).some((e) => e.dimension === 'hero')).toBe(false);
  });

  it('credits a swap game to EVERY hero played in it, in full — not split like the Heroes table\'s time-share credit', () => {
    const games = run(8, ['Loss'], { heroes: ['Ana', 'Kiriko'] }); // every game is a 2-hero swap
    const entries = focusEntries(games);
    expect(entries.find((e) => e.dimension === 'hero' && e.key === 'Ana')).toMatchObject({ games: 8, losses: 8 });
    expect(entries.find((e) => e.dimension === 'hero' && e.key === 'Kiriko')).toMatchObject({ games: 8, losses: 8 });
  });

  it('surfaces a net-losing role once it reaches the 8-game floor', () => {
    const games = run(8, ['Loss', 'Loss', 'Loss', 'Loss', 'Loss', 'Win', 'Win', 'Win'], { role: 'tank' });
    const tank = focusEntries(games).find((e) => e.dimension === 'role' && e.key === 'tank');
    expect(tank).toMatchObject({ net: 2, games: 8 });
  });

  it('caps each dimension at 6 independently, not the combined list (three short sections)', () => {
    const games = Array.from({ length: 7 }, (_, i) => run(8, ['Loss'], { heroes: [`Hero-${i}`] })).flat();
    const heroEntries = focusEntries(games).filter((e) => e.dimension === 'hero');
    expect(heroEntries).toHaveLength(6);
  });

  it('ranks in-pool rows above out-of-pool ones regardless of score (H1)', () => {
    const games = [
      ...run(3, ['Loss', 'Loss', 'Loss'], { map: 'Hanamura' }), // net 3, marked out of pool
      ...run(3, ['Loss', 'Loss', 'Win'], { map: 'Numbani' }), // net 1, in pool — smaller deficit but sorts first
    ];
    const isMapActive = (m: string) => m !== 'Hanamura';
    const entries = focusEntries(games, { isMapActive }).filter((e) => e.dimension === 'map');
    expect(entries.map((e) => e.key)).toEqual(['Numbani', 'Hanamura']);
    expect(entries.find((e) => e.key === 'Numbani')?.inPool).toBe(true);
    expect(entries.find((e) => e.key === 'Hanamura')?.inPool).toBe(false);
  });

  it('defaults every entry to in-pool when no lookup is supplied', () => {
    const games = run(3, ['Loss'], { map: 'Busan' });
    const busan = focusEntries(games).find((e) => e.dimension === 'map');
    expect(busan?.inPool).toBe(true);
  });
});

describe('FocusEntry.heroes — per-map hero record (H2)', () => {
  it('attaches each of the top heroes\' OWN per-game win/loss, sorted by game count', () => {
    const games = [
      ...run(3, ['Loss'], { map: 'Ilios', heroes: ['Ana'] }),
      ...run(2, ['Win'], { map: 'Ilios', heroes: ['Kiriko'] }),
      ...run(1, ['Loss'], { map: 'Ilios', heroes: ['Mercy'] }),
    ];
    const ilios = focusEntries(games).find((e) => e.dimension === 'map' && e.key === 'Ilios');
    expect(ilios?.heroes).toEqual([
      { hero: 'Ana', wins: 0, losses: 3 },
      { hero: 'Kiriko', wins: 2, losses: 0 },
      { hero: 'Mercy', wins: 0, losses: 1 },
    ]);
  });

  it('caps the per-map record at the top 3 heroes by game count', () => {
    const games = [
      ...run(4, ['Loss'], { map: 'Busan', heroes: ['A'] }),
      ...run(3, ['Loss'], { map: 'Busan', heroes: ['B'] }),
      ...run(2, ['Loss'], { map: 'Busan', heroes: ['C'] }),
      ...run(1, ['Loss'], { map: 'Busan', heroes: ['D'] }),
    ];
    const busan = focusEntries(games).find((e) => e.dimension === 'map' && e.key === 'Busan');
    expect(busan?.heroes?.map((h) => h.hero)).toEqual(['A', 'B', 'C']);
  });

  it('is absent (undefined) on hero and role entries — only maps carry a per-hero record', () => {
    const games = run(8, ['Loss'], { heroes: ['Ana'], role: 'support' });
    const entries = focusEntries(games);
    expect(entries.find((e) => e.dimension === 'hero')?.heroes).toBeUndefined();
    expect(entries.find((e) => e.dimension === 'role')?.heroes).toBeUndefined();
  });
});

describe('heroForm (H6)', () => {
  const at = (i: number, result: Result, p: Partial<GameRecord> = {}): GameRecord =>
    game({ result, timestamp: T0 + i * HOUR, ...p });

  it('returns undefined with no decided games', () => {
    expect(heroForm([at(0, 'Draw'), at(1, 'Draw')])).toBeUndefined();
    expect(heroForm([])).toBeUndefined();
  });

  it('carries results oldest-to-newest and omits the delta when the window covers the whole range', () => {
    const games = [at(2, 'Win'), at(0, 'Loss'), at(1, 'Win')]; // out of order on purpose
    const form = heroForm(games);
    expect(form?.results).toEqual(['Loss', 'Win', 'Win']);
    expect(form?.deltaPp).toBeUndefined();
  });

  it('excludes draws from both the strip and the winrate math', () => {
    const games = [at(0, 'Win'), at(1, 'Draw'), at(2, 'Loss'), at(3, 'Draw')];
    expect(heroForm(games)?.results).toEqual(['Win', 'Loss']);
  });

  it('windows to the last 10 decided games and reports the delta vs the full range', () => {
    // 5 earlier losses, then 10 recent wins: range winrate 10/15, window (last
    // 10, all wins) winrate 100% — a real "earlier" portion exists to compare.
    const earlier = Array.from({ length: 5 }, (_, i) => at(i, 'Loss'));
    const recent = Array.from({ length: 10 }, (_, i) => at(5 + i, 'Win'));
    const form = heroForm([...earlier, ...recent]);
    expect(form?.results).toEqual(Array(10).fill('Win'));
    // Window (last 10, all wins) 100% vs full-range 10/15 ≈ 66.7% → +33.3pp.
    expect(form?.deltaPp).toBeCloseTo(33.3, 1);
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
  /**
   * These linking tests are all about MAP entries specifically (some use
   * hero-shaped names like "Ana"/"Mei" as decoys, purely to test token-run
   * matching) — filtered so a hero/role entry that happens to cross its own
   * floor on the same fixture (H1 added both dimensions) can't shift `[0]`.
   */
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

  it('matches across apostrophe styles', () => {
    // Curly apostrophe in the target name still links the straight-quoted key.
    const mapGames = [0, 1, 2].map((i) => at(i, 'Loss', { map: "King's Row" }));
    const curly = target('Practice King’s Row: warm up unranked');
    expect(linkFocusTargets(entriesFor(mapGames), [curly], mapGames)[0].progress?.targetId).toBe(curly.id);
  });

  it('links a multi-word key even when the target drops the apostrophe', () => {
    // A user who types "Kings Row" (no apostrophe) still links the "King's Row" key.
    const games = [0, 1, 2].map((i) => at(i, 'Loss', { map: "King's Row" }));
    const t = target('Practice Kings Row: warm up unranked');
    expect(linkFocusTargets(entriesFor(games), [t], games)[0].progress?.targetId).toBe(t.id);
  });

  it('does not link a short key that only matches across word boundaries', () => {
    // "Plan a warmup routine" flattens to "…planawarmup…" which *contains* "ana",
    // but token-run matching must not link a map key "Ana" to it.
    const anaGames = [0, 1, 2].map((i) => at(i, 'Loss', { map: 'Ana' }));
    const decoyForAna = target('Plan a warmup routine before ranked');
    expect(linkFocusTargets(entriesFor(anaGames), [decoyForAna], anaGames)[0].progress).toBeUndefined();

    // Same class: "Help me improve aim" flattens to a string containing "mei".
    const meiGames = [0, 1, 2].map((i) => at(i, 'Loss', { map: 'Mei' }));
    const decoyForMei = target('Help me improve aim');
    expect(linkFocusTargets(entriesFor(meiGames), [decoyForMei], meiGames)[0].progress).toBeUndefined();
  });

  it('a map-named active target still links; a hero/role-named legacy target never links (no error)', () => {
    const games = [0, 1, 2].map((i) => at(i, 'Loss', { map: 'Busan', heroes: ['Ana'], role: 'support' }));
    const mapTarget = target('Practice Busan: warm up unranked');
    const legacyHeroRoleTargets = [target('Practice Ana: aim drills'), target('Fix my SUPPORT games')];

    const [linkedToMap] = linkFocusTargets(entriesFor(games), [mapTarget], games);
    expect(linkedToMap.dimension).toBe('map');
    expect(linkedToMap.progress?.targetId).toBe(mapTarget.id);

    const [neverLinked] = linkFocusTargets(entriesFor(games), legacyHeroRoleTargets, games);
    expect(neverLinked.dimension).toBe('map');
    expect(neverLinked.progress).toBeUndefined();
  });
});

describe('dashboard focusItems payload', () => {
  const demo = { active: false, preference: 'off' as const, hasRealHistory: true };
  const at = (i: number, result: Result, p: Partial<GameRecord> = {}): GameRecord =>
    game({ result, timestamp: T0 + i * HOUR, ...p });

  it('ships the map-only focus list on DashboardData', () => {
    const games = run(6, ['Loss', 'Loss', 'Loss', 'Loss', 'Loss', 'Win'], {
      map: 'Midtown', role: 'tank', heroes: ['Reinhardt'],
    });
    const d = computeDashboard(games, { days: 'all' }, demo);
    expect(d.focusItems.every((e) => e.dimension === 'map')).toBe(true);
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

  it('resolves the game mode onto map entries only, from the master-data catalog (H2)', () => {
    const games = run(3, ['Loss'], { map: 'Ilios' }); // a built-in Control map
    const d = computeDashboard(games, { days: 'all' }, demo);
    const ilios = d.focusItems.find((e) => e.key === 'Ilios');
    expect(ilios).toMatchObject({ dimension: 'map', mode: 'Control' });
  });

  it('tags a map outside the current competitive pool as out of pool (H1)', () => {
    const games = run(3, ['Loss'], { map: 'Paris' }); // a legacy 2CP map, isActive:false in the default catalog
    const d = computeDashboard(games, { days: 'all' }, demo);
    const paris = d.focusItems.find((e) => e.key === 'Paris');
    expect(paris?.inPool).toBe(false);
  });

  it('attaches trend and form to heroStats rows, keyed by the hero\'s own games (H6)', () => {
    const losses = [0, 1, 2, 3].map((i) => at(i, 'Loss', { heroes: ['Ana'] }));
    const wins = [4, 5, 6].map((i) => at(i, 'Win', { heroes: ['Ana'] }));
    const d = computeDashboard([...losses, ...wins], { days: 'all' }, demo);
    const ana = d.heroStats.find((h) => h.hero === 'Ana');
    expect(ana?.trend).toBe('improving');
    expect(ana?.form?.results).toEqual(['Loss', 'Loss', 'Loss', 'Loss', 'Win', 'Win', 'Win']);
  });
});
