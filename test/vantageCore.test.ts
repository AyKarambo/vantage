import { describe, it, expect } from 'vitest';
import type { GameRecord } from '../src/core/analytics';
import type { Result, Role } from '../src/core/model';
import { mapMode } from '../src/core/maps';
import { mentalSummary } from '../src/core/mental';
import { progression, winrateToSr, tierOf } from '../src/core/progression';
import { sampleTargets } from '../src/core/targets';
import { computeDashboard, applyFilters } from '../src/core/dashboardData';
import { generateSampleGames } from '../src/core/sampleData';

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
    expect(m.flags).toEqual({ tilt: 2, toxicMates: 1, leaver: 1, positiveComms: 1 });
    expect(m.winWhenCalm).toBe(1); // both calm games were wins
    expect(m.winWhenTilted).toBe(0); // both tilted games were losses
    expect(m.calm).toBeGreaterThanOrEqual(0);
    expect(m.tilted).toBeLessThanOrEqual(100);
  });
});

describe('progression', () => {
  it('anchors 50% winrate near 2500 SR', () => {
    expect(winrateToSr(0.5)).toBe(2500);
    expect(winrateToSr(0.6)).toBeGreaterThan(winrateToSr(0.5));
    expect(winrateToSr(0.4)).toBeLessThan(winrateToSr(0.5));
  });

  it('maps SR to tier and division', () => {
    expect(tierOf(2200)).toEqual({ tier: 'Diamond', division: 3 });
    expect(tierOf(2000)).toEqual({ tier: 'Diamond', division: 5 });
    expect(tierOf(0)).toEqual({ tier: 'Bronze', division: 5 });
    const gm = tierOf(4900);
    expect(gm.tier).toBe('Grandmaster');
  });

  it('derives a plausible progression from a sample season', () => {
    const p = progression(generateSampleGames(120, 3));
    expect(p.sr).toBeGreaterThan(300);
    expect(p.sr).toBeLessThan(4900);
    expect(p.division).toBeGreaterThanOrEqual(1);
    expect(p.division).toBeLessThanOrEqual(5);
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
    const d = computeDashboard(all, { days: 'all' }, true);
    expect(d.isSample).toBe(true);
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
