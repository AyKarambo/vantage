import { describe, it, expect } from 'vitest';
import {
  winLoss, byMap, byRole, byHero, focusBy, trend, heroStats, type GameRecord,
} from '../src/core/analytics';
import { generateSampleGames } from '../src/core/sampleData';
import type { Result, Role } from '../src/core/model';
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
    expect(h[0].wins).toBe(1);
  });
});

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
      game({ result: 'Win', map: 'A', role: 'support', heroes: ['Ana'], durationMinutes: 10,
        perHero: [{ hero: 'Ana', role: 'support', eliminations: 10, deaths: 4, assists: 20, damage: 5000, healing: 12000, mitigation: 0 }] }),
      game({ result: 'Loss', map: 'B', role: 'support', heroes: ['Ana'], durationMinutes: 10,
        perHero: [{ hero: 'Ana', role: 'support', eliminations: 6, deaths: 6, assists: 16, damage: 4000, healing: 9000, mitigation: 0 }] }),
    ];
    const [ana] = heroStats(games);
    expect(ana.hero).toBe('Ana');
    expect(ana.games).toBe(2);
    expect(ana.winrate).toBe(0.5);
    expect(ana.totals.healing).toBe(21000);
    expect(ana.kda).toBeCloseTo((16 + 36) / 10);
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
