import { describe, it, expect } from 'vitest';
import type { GameRecord } from '../src/core/analytics';
import type { Result, Role } from '../src/core/model';
import { mapMode } from '../src/core/maps';
import { mentalSummary } from '../src/core/mental';
import { progression, winrateToSr, tierOf } from '../src/core/progression';
import { sampleTargets } from '../src/core/targets';
import { computeDashboard, applyFilters } from '../src/core/dashboardData';
import { generateSampleGames } from '../src/core/sampleData';
import { DEFAULT_BREAK_REMINDER } from '../src/core/breakReminder';

function game(p: Partial<GameRecord> & { result: Result; map: string; role: Role }): GameRecord {
  return {
    matchId: Math.random().toString(36).slice(2),
    timestamp: Date.now(),
    account: 'Main',
    gameType: 'Competitive',
    heroes: ['Tracer'],
    ...p,
  };
}

describe('mapMode', () => {
  it('resolves known maps and falls back to Unknown', () => {
    expect(mapMode("King's Row")).toBe('Hybrid');
    expect(mapMode('Ilios')).toBe('Control');
    expect(mapMode('Colosseo')).toBe('Push');
    expect(mapMode('Nonexistent Map')).toBe('Unknown');
  });

  it('resolves the newer maps so imports do not bucket them as Unknown', () => {
    expect(mapMode('Neon Junktion')).toBe('Hybrid');
    expect(mapMode('Redwood Dam')).toBe('Push');
    expect(mapMode('Place Lacroix')).toBe('Push');
    expect(mapMode('Wuxing University')).toBe('Control');
    expect(mapMode('Gogadoro')).toBe('Control');
    expect(mapMode('Arena Victoriae')).toBe('Control');
  });
});

describe('mentalSummary', () => {
  it('is empty for no games', () => {
    const m = mentalSummary([]);
    expect(m.calm).toBe(0);
    expect(m.tilted).toBe(0);
    expect(m.flags.tilt).toBe(0);
  });

  it('counts flags and splits winrate by tilt', () => {
    const games = [
      game({ result: 'Win', map: 'Ilios', role: 'damage', mental: { tilt: false, positiveComms: true } }),
      game({ result: 'Win', map: 'Ilios', role: 'damage', mental: { tilt: false } }),
      game({ result: 'Loss', map: 'Ilios', role: 'damage', mental: { tilt: true, toxicMates: true } }),
      game({ result: 'Loss', map: 'Ilios', role: 'damage', mental: { tilt: true, leaver: true } }),
    ];
    const m = mentalSummary(games);
    expect(m.flags).toEqual({ tilt: 2, toxicMates: 1, leaver: 1, leaverMyTeam: 1, leaverEnemyTeam: 0, positiveComms: 1 });
    expect(m.winWhenCalm).toBe(1); // both calm games were wins
    expect(m.winWhenTilted).toBe(0); // both tilted games were losses
    expect(m.calm).toBeGreaterThanOrEqual(0);
    expect(m.tilted).toBeLessThanOrEqual(100);
  });
});

describe('progression', () => {
  it('maps winrate monotonically across the ladder, top → Champion', () => {
    expect(winrateToSr(0.6)).toBeGreaterThan(winrateToSr(0.5));
    expect(winrateToSr(0.4)).toBeLessThan(winrateToSr(0.5));
    expect(tierOf(winrateToSr(1)).tier).toBe('Champion'); // C1/C5: Champion reachable, no clamp to GM
    expect(tierOf(winrateToSr(0)).tier).toBe('Bronze');
  });

  it('maps a rating to tier, division (1–5, 5=lowest) and a 0–100 progress percent', () => {
    const diamond = tierOf(2200);
    expect(diamond.tier).toBe('Diamond');
    expect(diamond.division).toBe(3);
    expect(tierOf(0)).toMatchObject({ tier: 'Bronze', division: 5 });
    const champ = tierOf(3999);
    expect(champ.tier).toBe('Champion');
    expect(champ.division).toBe(1);
    // C2: exact tier-floor + division boundaries (5=lowest band, 1=highest).
    expect(tierOf(499)).toMatchObject({ tier: 'Bronze', division: 1 });
    expect(tierOf(500)).toMatchObject({ tier: 'Silver', division: 5 });
    expect(tierOf(999)).toMatchObject({ tier: 'Silver', division: 1 });
    expect(tierOf(1000)).toMatchObject({ tier: 'Gold', division: 5 });
    expect(tierOf(2099).division).toBe(5);
    expect(tierOf(2100).division).toBe(4);
  });

  it('keeps progressPct within [0,100) across the whole ladder (C3)', () => {
    for (let sr = 0; sr <= 3999; sr += 37) {
      const { division, progressPct } = tierOf(sr);
      expect(division).toBeGreaterThanOrEqual(1);
      expect(division).toBeLessThanOrEqual(5);
      expect(progressPct).toBeGreaterThanOrEqual(0);
      expect(progressPct).toBeLessThan(100); // integer within-division rating < 100 → caps at 99
    }
    // Pin the formula at a known point: top of a division reads ~99%.
    expect(tierOf(2099).progressPct).toBeCloseTo(99, 5);
    expect(tierOf(2000).progressPct).toBeCloseTo(0, 5);
  });

  it('derives a plausible progression from a sample season', () => {
    const p = progression(generateSampleGames(120, 3));
    expect(p.progressPct).toBeGreaterThanOrEqual(0);
    expect(p.progressPct).toBeLessThanOrEqual(100);
    expect(p.division).toBeGreaterThanOrEqual(1);
    expect(p.division).toBeLessThanOrEqual(5);
    expect(p.tier).toBeTypeOf('string');
  });

  it('reports a signed delta in percentage points when the newer half climbs or falls', () => {
    const t = (ts: number, result: Result): GameRecord => game({ result, map: 'Ilios', role: 'damage', timestamp: ts });
    // Older half all losses, newer half all wins → positive delta.
    // Older half 0% (rating 0), newer half 100% (rating 3999) → +3999/DIV_SPAN*100.
    // Pins the magnitude, so a wrong divisor or a dropped ×100 is caught, not just the sign.
    const climbing = [t(1, 'Loss'), t(2, 'Loss'), t(3, 'Win'), t(4, 'Win')];
    expect(progression(climbing).delta).toBeCloseTo(3999, 0);
    const falling = [t(1, 'Win'), t(2, 'Win'), t(3, 'Loss'), t(4, 'Loss')];
    expect(progression(falling).delta).toBeCloseTo(-3999, 0);
    // Fewer than 4 games → no delta.
    expect(progression([t(1, 'Win'), t(2, 'Loss')]).delta).toBe(0);
  });
});

describe('sampleTargets', () => {
  it('produces a bounded, well-formed library', () => {
    const targets = sampleTargets(generateSampleGames(120, 5));
    expect(targets).toHaveLength(4);
    for (const t of targets) {
      expect(t.hitRate).toBeGreaterThanOrEqual(0);
      expect(t.hitRate).toBeLessThanOrEqual(1);
      expect(t.winWhenHit).toBeGreaterThanOrEqual(0);
      expect(t.winWhenHit).toBeLessThanOrEqual(1);
      expect(t.hits).toBeLessThanOrEqual(t.attempts);
      expect(t.spark.length).toBe(8);
      expect(['self', 'measured']).toContain(t.mode);
    }
  });
});

describe('computeDashboard', () => {
  const all = generateSampleGames(180, 7);

  it('returns the full contract shape', () => {
    const d = computeDashboard(all, { days: 'all' }, { active: true, preference: 'on', hasRealHistory: false });
    expect(d.isSample).toBe(true);
    expect(d.demoPreference).toBe('on');
    expect(d.hasRealHistory).toBe(false);
    expect(d.overall.games).toBe(180);
    expect(d.matches.length).toBeGreaterThan(0);
    expect(d.matches.length).toBeLessThanOrEqual(150);
    expect(d.matches[0].mapType).toBeTypeOf('string');
    expect(d.byMapType.length).toBeGreaterThan(0);
    expect(d.mental.flags).toBeDefined();
    expect(d.targets).toHaveLength(4);
    expect(d.progression.tier).toBeTypeOf('string');
    expect(d.greetingName).toBeTypeOf('string');
  });

  it('defaults breakReminder when ManualData omits it', () => {
    const d = computeDashboard(all, { days: 'all' }, { active: true, preference: 'on', hasRealHistory: false });
    expect(d.breakReminder).toEqual(DEFAULT_BREAK_REMINDER);
  });

  it('threads a provided breakReminder through unchanged', () => {
    const custom = { enabled: false, afterLosses: 5 };
    const d = computeDashboard(all, { days: 'all' }, { active: true, preference: 'on', hasRealHistory: false }, { breakReminder: custom });
    expect(d.breakReminder).toEqual(custom);
  });

  it('applyFilters narrows by account, role and mode', () => {
    const byAccount = applyFilters(all, { account: 'Main' });
    expect(byAccount.every((g) => g.account === 'Main')).toBe(true);

    const byRole = applyFilters(all, { role: 'tank' });
    expect(byRole.every((g) => g.role === 'tank')).toBe(true);

    const byMode = applyFilters(all, { mode: 'Competitive' });
    expect(byMode.every((g) => g.gameType === 'Competitive')).toBe(true);
  });

  it('respects the day window', () => {
    const recent = applyFilters(all, { days: 7 });
    const cutoff = Date.now() - 7 * 86400000;
    expect(recent.every((g) => g.timestamp >= cutoff)).toBe(true);
    expect(recent.length).toBeLessThanOrEqual(all.length);
  });
});
