import { describe, it, expect } from 'vitest';
import {
  winLoss, byMap, byRole, byHero, focusBy, trend, heroStats, heroDetail, weightedWinLoss, type GameRecord,
} from '../src/core/analytics';
import { generateSampleGames } from '../src/core/sampleData';
import { PLAYED_TIME_ESTIMATE, setupMinutes } from '../src/core/playedTime';
import type { HeroStat, Result, Role } from '../src/core/model';
import { computeDashboard } from '../src/core/dashboardData';
import { buildTargets, NOTION_IMPROVEMENT_TARGET_ID, type AuthoredTarget } from '../src/core/targets';

function game(p: Partial<GameRecord> & { result: Result; map: string; role: Role }): GameRecord {
  return {
    matchId: Math.random().toString(36).slice(2),
    timestamp: Date.parse('2026-06-01T12:00:00Z'),
    account: 'Karambo',
    gameType: 'Competitive',
    heroes: ['Tracer'],
    ...p,
  };
}

describe('winLoss', () => {
  it('counts and computes winrate excluding draws', () => {
    const games = [
      game({ result: 'Win', map: 'A', role: 'damage' }),
      game({ result: 'Win', map: 'A', role: 'damage' }),
      game({ result: 'Loss', map: 'A', role: 'damage' }),
      game({ result: 'Draw', map: 'A', role: 'damage' }),
    ];
    const wl = winLoss(games);
    expect(wl).toMatchObject({ games: 4, wins: 2, losses: 1, draws: 1 });
    expect(wl.winrate).toBeCloseTo(2 / 3);
  });
  it('handles empty input', () => {
    expect(winLoss([]).winrate).toBe(0);
  });
});

describe('grouping', () => {
  const games = [
    game({ result: 'Win', map: "King's Row", role: 'tank' }),
    game({ result: 'Loss', map: "King's Row", role: 'tank' }),
    game({ result: 'Win', map: 'Busan', role: 'support' }),
  ];
  it('byMap / byRole produce per-key win/loss sorted by volume', () => {
    const m = byMap(games);
    expect(m[0].key).toBe("King's Row");
    expect(m[0].games).toBe(2);
    const r = byRole(games);
    expect(r.find((x) => x.key === 'tank')?.losses).toBe(1);
  });
  it('byHero counts a game toward each hero played', () => {
    const g = [game({ result: 'Win', map: 'A', role: 'damage', heroes: ['Tracer', 'Genji'] })];
    const h = byHero(g);
    expect(h.map((x) => x.key).sort()).toEqual(['Genji', 'Tracer']);
    expect(h[0].wins).toBe(1); // equal split without hero minutes: 0.5 each, rounded for display
    expect(h[0].winrate).toBe(1);
  });

  it('byHero credits each hero by its time share (career-profile rule), rounding the counts', () => {
    // Tracer 6 min + Genji 2 min in one won game → 0.75 + 0.25 of a win; a
    // second, lost game on Tracer alone is a whole loss.
    const games = [
      game({ result: 'Win', map: 'A', role: 'damage', heroes: ['Tracer', 'Genji'], durationMinutes: 8, playedMinutes: 8,
        perHero: [line('Tracer', { minutes: 6 }), line('Genji', { minutes: 2 })] }),
      game({ result: 'Loss', map: 'A', role: 'damage', heroes: ['Tracer'], durationMinutes: 8, playedMinutes: 8,
        perHero: [line('Tracer', { minutes: 8 })] }),
    ];
    const h = Object.fromEntries(byHero(games).map((x) => [x.key, x]));
    expect(h.Tracer).toMatchObject({ games: 2, wins: 1, losses: 1, draws: 0 }); // 1.75 / 0.75 / 1 rounded
    expect(h.Tracer.winrate).toBeCloseTo(0.75 / 1.75, 9);
    // A quarter of a game still shows as one game — "0 games · 100%" is not a
    // row anyone can read — and the parts add up to it.
    expect(h.Genji).toMatchObject({ games: 1, wins: 1, losses: 0, draws: 0 });
    expect(h.Genji.winrate).toBe(1); // the winrate still comes from the fractional credit
    expect(byHero(games).map((x) => x.key)).toEqual(['Tracer', 'Genji']); // most credit first
  });

  it('weightedWinLoss tallies fractional credit and computes winrate from it', () => {
    const win = game({ result: 'Win', map: 'A', role: 'damage' });
    const loss = game({ result: 'Loss', map: 'A', role: 'damage' });
    const draw = game({ result: 'Draw', map: 'A', role: 'damage' });
    const wl = weightedWinLoss([{ game: win, weight: 0.75 }, { game: loss, weight: 0.5 }, { game: draw, weight: 0.5 }]);
    // 1.75 games → 2, and the parts are allocated to sum to exactly that:
    // largest remainder first (0.75 win), then one of the two 0.5s (losses
    // before draws on the tie). Rounded on their own, all three would be 1.
    expect(wl).toMatchObject({ games: 2, wins: 1, losses: 1, draws: 0 });
    expect(wl.winrate).toBeCloseTo(0.75 / 1.25, 9);
    expect(weightedWinLoss([]).winrate).toBe(0);
  });

  it('rounded counts always add up to the rounded game count', () => {
    const win = game({ result: 'Win', map: 'A', role: 'damage' });
    const loss = game({ result: 'Loss', map: 'A', role: 'damage' });
    // The half-and-half case the old independent rounding got wrong: one win
    // and one loss at half credit each is ONE game, not one win AND one loss.
    const even = weightedWinLoss([{ game: win, weight: 0.5 }, { game: loss, weight: 0.5 }]);
    expect(even.games).toBe(1);
    expect(even.wins + even.losses + even.draws).toBe(1);
    expect(even.winrate).toBe(0.5);
    for (const w of [0.1, 0.25, 1 / 3, 0.5, 0.75, 0.9]) {
      const wl = weightedWinLoss([{ game: win, weight: w }, { game: loss, weight: w }, { game: game({ result: 'Draw' }), weight: w }]);
      expect(wl.wins + wl.losses + wl.draws).toBe(wl.games);
    }
  });
});

/** A per-hero line with the counting stats zeroed unless given. */
function line(hero: string, p: Partial<HeroStat> = {}): HeroStat {
  return { hero, role: 'damage', eliminations: 0, deaths: 0, assists: 0, damage: 0, healing: 0, mitigation: 0, ...p };
}

describe('focusBy', () => {
  it('ranks net-losing keys first and respects minGames', () => {
    const games = [
      ...Array(4).fill(0).map(() => game({ result: 'Loss', map: 'WeakMap', role: 'damage' })),
      ...Array(1).fill(0).map(() => game({ result: 'Win', map: 'WeakMap', role: 'damage' })),
      ...Array(4).fill(0).map(() => game({ result: 'Win', map: 'StrongMap', role: 'damage' })),
    ];
    const focus = focusBy(games, (g) => g.map, 3);
    expect(focus[0].key).toBe('WeakMap');
    expect(focus[0].net).toBe(3); // 4 losses - 1 win
    // a map with <3 games is excluded
    expect(focusBy([game({ result: 'Loss', map: 'Rare', role: 'tank' })], (g) => g.map, 3)).toHaveLength(0);
  });
});

describe('trend', () => {
  it('buckets by day in chronological order', () => {
    const d1 = Date.parse('2026-06-01T10:00:00Z');
    const d2 = Date.parse('2026-06-02T10:00:00Z');
    const games = [
      game({ result: 'Win', map: 'A', role: 'damage', timestamp: d2 }),
      game({ result: 'Loss', map: 'A', role: 'damage', timestamp: d1 }),
    ];
    const t = trend(games, 'day');
    expect(t.map((x) => x.key)).toEqual(['2026-06-01', '2026-06-02']);
  });
});

describe('heroStats', () => {
  it('aggregates exact per-hero stats and winrate', () => {
    const games: GameRecord[] = [
      game({ result: 'Win', map: 'A', role: 'support', heroes: ['Ana'], durationMinutes: 10, playedMinutes: 10,
        perHero: [{ hero: 'Ana', role: 'support', eliminations: 10, deaths: 4, assists: 20, damage: 5000, healing: 12000, mitigation: 0 }] }),
      game({ result: 'Loss', map: 'B', role: 'support', heroes: ['Ana'], durationMinutes: 10, playedMinutes: 10,
        perHero: [{ hero: 'Ana', role: 'support', eliminations: 6, deaths: 6, assists: 16, damage: 4000, healing: 9000, mitigation: 0 }] }),
    ];
    const [ana] = heroStats(games);
    expect(ana.hero).toBe('Ana');
    expect(ana.games).toBe(2);
    expect(ana.winrate).toBe(0.5);
    expect(ana.totals.healing).toBe(21000);
    expect(ana.kda).toBeCloseTo((16 + 36) / 10);
    expect(ana.per10?.healing).toBe(10500); // 21000 × 10 / 20 played minutes
  });

  it('per-10 divides by the measured PLAYED time, not the wall-clock duration', () => {
    const games: GameRecord[] = [
      game({ result: 'Win', map: 'Ilios', role: 'support', heroes: ['Ana'], durationMinutes: 12, playedMinutes: 10,
        perHero: [line('Ana', { role: 'support', eliminations: 10, healing: 12000 })] }),
    ];
    const [ana] = heroStats(games);
    expect(ana.per10?.eliminations).toBe(10); // 10 × 10 / 10 played — not 8.3 over the 12-minute wall clock
    expect(ana.per10?.healing).toBe(12000);
  });

  it('ESTIMATE PATH: a legacy 10-minute Ilios capture without playedMinutes divides by 10 − 68/60 − setupMinutes(Control, 2.5)', () => {
    const games: GameRecord[] = [
      game({ result: 'Win', map: 'Ilios', role: 'support', heroes: ['Ana'], durationMinutes: 10,
        perHero: [line('Ana', { role: 'support', eliminations: 10, healing: 12000 })] }),
    ];
    const outside = (PLAYED_TIME_ESTIMATE.preRoundSeconds + PLAYED_TIME_ESTIMATE.postMatchSeconds) / 60;
    const played = 10 - outside - setupMinutes('Control', 2.5);
    const [ana] = heroStats(games);
    expect(ana.per10?.eliminations).toBe(Math.round(10 * 10 / played * 10) / 10);
    expect(ana.per10?.healing).toBe(Math.round(12000 * 10 / played));
    expect(ana.per10!.healing).toBeGreaterThan(12000);
  });

  it('honours a custom map-mode resolver for the estimate (user-catalog maps)', () => {
    const games: GameRecord[] = [
      game({ result: 'Win', map: 'Somewhere New', role: 'damage', heroes: ['Tracer'], durationMinutes: 12,
        perHero: [line('Tracer', { damage: 12000 })] }),
    ];
    const asPush = heroStats(games, { mapModeOf: () => 'Push' })[0].per10!.damage;
    const asEscort = heroStats(games, { mapModeOf: () => 'Escort' })[0].per10!.damage;
    expect(asEscort).toBeGreaterThan(asPush); // Escort's setup locks shorten the divisor further
  });

  it('credits games and wins by time share (Tracer 6 min / Genji 2 min in a won 8-minute game → 0.75 / 0.25)', () => {
    const games: GameRecord[] = [
      game({ result: 'Win', map: 'A', role: 'damage', heroes: ['Tracer', 'Genji'], durationMinutes: 8, playedMinutes: 8,
        perHero: [line('Tracer', { minutes: 6, eliminations: 12 }), line('Genji', { minutes: 2, eliminations: 4 })] }),
    ];
    const s = Object.fromEntries(heroStats(games).map((h) => [h.hero, h]));
    expect(s.Tracer.creditedGames).toBeCloseTo(0.75, 9);
    expect(s.Tracer.creditedWins).toBeCloseTo(0.75, 9);
    expect(s.Genji.creditedGames).toBeCloseTo(0.25, 9);
    expect(s.Genji.creditedWins).toBeCloseTo(0.25, 9);
    // Displayed counts are the rounded credit; the winrate comes from the fraction.
    expect(s.Tracer).toMatchObject({ games: 1, wins: 1, losses: 0, draws: 0, winrate: 1 });
    expect(s.Genji).toMatchObject({ games: 1, wins: 1, losses: 0, draws: 0, winrate: 1 });
    // Per-10 still divides by each hero's own played minutes.
    expect(s.Tracer.per10?.eliminations).toBe(20); // 12 × 10 / 6
    expect(s.Genji.per10?.eliminations).toBe(20); // 4 × 10 / 2
  });

  it('accumulates fractional credit across games and orders by the unrounded credit', () => {
    const games: GameRecord[] = [
      game({ result: 'Win', map: 'A', role: 'damage', heroes: ['Tracer', 'Genji'], durationMinutes: 8, playedMinutes: 8,
        perHero: [line('Tracer', { minutes: 6 }), line('Genji', { minutes: 2 })] }),
      game({ result: 'Loss', map: 'A', role: 'damage', heroes: ['Tracer', 'Genji'], durationMinutes: 8, playedMinutes: 8,
        perHero: [line('Tracer', { minutes: 2 }), line('Genji', { minutes: 6 })] }),
      game({ result: 'Draw', map: 'A', role: 'damage', heroes: ['Genji'], durationMinutes: 8, playedMinutes: 8,
        perHero: [line('Genji', { minutes: 8 })] }),
    ];
    const s = heroStats(games);
    expect(s.map((h) => h.hero)).toEqual(['Genji', 'Tracer']); // 2.0 vs 1.0 games of credit
    const genji = s[0];
    expect(genji.creditedGames).toBeCloseTo(2, 9); // 0.25 + 0.75 + 1
    expect(genji.creditedWins).toBeCloseTo(0.25, 9);
    expect(genji.creditedLosses).toBeCloseTo(0.75, 9);
    expect(genji).toMatchObject({ games: 2, wins: 0, losses: 1, draws: 1 });
    expect(genji.winrate).toBeCloseTo(0.25, 9);
    const tracer = s[1];
    expect(tracer).toMatchObject({ games: 1, wins: 1, losses: 0, draws: 0 }); // 0.75 win + 0.25 loss, rounded
    expect(tracer.winrate).toBeCloseTo(0.75, 9);
  });

  it('falls back to an equal split of the credit when hero minutes are missing', () => {
    const games: GameRecord[] = [
      game({ result: 'Win', map: 'A', role: 'damage', heroes: ['Tracer', 'Genji'] }), // manual-style: no perHero at all
    ];
    const s = Object.fromEntries(heroStats(games).map((h) => [h.hero, h]));
    expect(s.Tracer.creditedGames).toBe(0.5);
    expect(s.Genji.creditedWins).toBe(0.5);
    expect(s.Tracer.per10).toBeNull(); // no usable time → no rate
  });

  it('merges same-hero swap segments so a hero used twice in one match counts once', () => {
    const games: GameRecord[] = [
      game({ result: 'Win', map: 'A', role: 'damage', heroes: ['Tracer', 'Genji'], durationMinutes: 10, playedMinutes: 10,
        perHero: [
          { hero: 'Tracer', role: 'damage', eliminations: 5, deaths: 1, assists: 2, damage: 2000, healing: 0, mitigation: 0, minutes: 3 },
          { hero: 'Genji', role: 'damage', eliminations: 4, deaths: 2, assists: 1, damage: 1500, healing: 0, mitigation: 0, minutes: 2 },
          { hero: 'Tracer', role: 'damage', eliminations: 7, deaths: 1, assists: 3, damage: 3000, healing: 0, mitigation: 0, minutes: 5 },
        ] }),
    ];
    const byHeroName = Object.fromEntries(heroStats(games).map((h) => [h.hero, h]));
    expect(byHeroName.Tracer.games).toBe(1); // not 2 — swap segments merged (0.8 of the game, rounded)
    expect(byHeroName.Tracer.creditedGames).toBeCloseTo(0.8, 9); // 8 of 10 minutes
    expect(byHeroName.Tracer.totals.damage).toBe(5000);
  });
});

describe('heroDetail', () => {
  const games = (): GameRecord[] => [
    game({ result: 'Win', map: 'Ilios', role: 'damage', heroes: ['Tracer', 'Genji'], timestamp: 3, durationMinutes: 8, playedMinutes: 8,
      perHero: [line('Tracer', { minutes: 6, eliminations: 12 }), line('Genji', { minutes: 2, eliminations: 4 })] }),
    game({ result: 'Loss', map: 'Ilios', role: 'damage', heroes: ['Tracer'], timestamp: 2, durationMinutes: 8, playedMinutes: 8,
      perHero: [line('Tracer', { minutes: 8, eliminations: 10 })] }),
    game({ result: 'Loss', map: 'Busan', role: 'damage', heroes: ['Genji'], timestamp: 1, durationMinutes: 8, playedMinutes: 8,
      perHero: [line('Genji', { minutes: 8, eliminations: 6 })] }),
  ];

  it('credits overall and per-map by the hero share, consistent with the table; recent lists whole games', () => {
    const d = heroDetail(games(), 'Tracer');
    expect(d.overall).toMatchObject({ games: 2, wins: 1, losses: 1, draws: 0 }); // 1.75 / 0.75 / 1 rounded
    expect(d.overall.winrate).toBeCloseTo(0.75 / 1.75, 9);
    expect(d.byMap).toEqual([{ key: 'Ilios', games: 2, wins: 1, losses: 1, draws: 0, winrate: d.overall.winrate }]);
    expect(d.recent.map((r) => r.timestamp)).toEqual([3, 2]); // newest first, whole games
    expect(d.stats?.winrate).toBeCloseTo(d.overall.winrate, 9); // the drawer and the table agree
    expect(d.stats?.per10?.eliminations).toBe(Math.round(22 * 10 / 14 * 10) / 10); // 22 elims over 6 + 8 played minutes
  });

  it('a short swap earns only its fraction of the game', () => {
    const d = heroDetail(games(), 'Genji');
    expect(d.overall.winrate).toBeCloseTo(0.25 / 1.25, 9); // 0.25 of a win vs a whole loss
    expect(d.overall).toMatchObject({ games: 1, wins: 0, losses: 1 }); // 1.25 → 1, 0.25 → 0
    expect(d.byMap.map((m) => m.key)).toEqual(['Busan', 'Ilios']); // 1.0 vs 0.25 of credit
    expect(d.byMap[1]).toMatchObject({ games: 1, wins: 1, winrate: 1 }); // a quarter of a game still reads as one
    expect(d.recent).toHaveLength(2);
  });

  it('is empty for a hero never played', () => {
    const d = heroDetail(games(), 'Ana');
    expect(d.overall).toEqual({ games: 0, wins: 0, losses: 0, draws: 0, winrate: 0 });
    expect(d.byMap).toEqual([]);
    expect(d.stats).toBeNull();
  });
});

describe('sample dataset', () => {
  it('is deterministic and analyzable', () => {
    const a = generateSampleGames(120, 7);
    const b = generateSampleGames(120, 7);
    expect(a.length).toBe(120);
    expect(a[0].matchId).toBe(b[0].matchId); // seeded → reproducible
    const wl = winLoss(a);
    expect(wl.games).toBe(120);
    expect(byMap(a).length).toBeGreaterThan(3);
    expect(heroStats(a).length).toBeGreaterThan(3);
    expect(focusBy(a, (g) => g.map).every((f) => typeof f.net === 'number')).toBe(true);
  });
});

describe('competitive-only scoping (spec D1)', () => {
  it('makes non-competitive rows invisible in counts/stats', () => {
    const comp = [
      game({ result: 'Win', map: 'A', role: 'damage' }),
      game({ result: 'Loss', map: 'A', role: 'damage' }),
    ];
    const nonComp = [
      game({ result: 'Win', map: 'A', role: 'damage', gameType: 'Quick Play' }),
      game({ result: 'Win', map: 'A', role: 'damage', gameType: 'Arcade' }),
    ];
    const demo = { active: false, preference: 'off' as const, hasRealHistory: true };
    const d = computeDashboard([...comp, ...nonComp], { days: 'all' }, demo);
    expect(d.overall.games).toBe(comp.length);
    expect(d.totalGamesAllTime).toBe(comp.length);
    expect(d.options.accounts).toEqual(['Karambo']);
    expect(d.byAccount.reduce((n, g) => n + g.games, 0)).toBe(comp.length);
  });
});

describe('buildTargets excludes the Notion bookkeeping id (spec B2)', () => {
  it('never lists or scores the internal id, even if present in authored targets', () => {
    const visibleTarget: AuthoredTarget = {
      id: 'my-target', name: 'Play off cooldowns', mode: 'self', rule: '', createdAt: 1, isActive: true,
    };
    const bookkeepingTarget: AuthoredTarget = {
      id: NOTION_IMPROVEMENT_TARGET_ID, name: 'Improvement Target', mode: 'self', rule: '', createdAt: 2, isActive: true,
    };
    const games: GameRecord[] = [
      game({
        result: 'Win', map: 'A', role: 'damage',
        review: { at: 1, grades: { 'my-target': 'hit', [NOTION_IMPROVEMENT_TARGET_ID]: 'missed' }, flags: {} },
      }),
    ];
    const summaries = buildTargets(games, false, [visibleTarget, bookkeepingTarget]);
    expect(summaries.map((s) => s.id)).toEqual(['my-target']);
    expect(summaries.find((s) => s.id === NOTION_IMPROVEMENT_TARGET_ID)).toBeUndefined();
    // The visible target's own stats are unaffected by the bookkeeping grade.
    const [visible] = summaries;
    expect(visible.hitRate).toBe(1);
    expect(visible.attempts).toBe(1);
  });
});
