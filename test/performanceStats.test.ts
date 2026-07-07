import { describe, it, expect } from 'vitest';
import { performanceStats } from '../src/core/analytics';
import { generateSampleGames } from '../src/core/sampleData';
import { safeReadiness } from '../src/core/readiness';
import { isCompetitive } from '../src/core/matchFilter';
import type { GameRecord } from '../src/core/analytics';
import { ts, game, span } from './readinessFixtures';

const rate = (games: GameRecord[], performance: number): GameRecord[] =>
  games.map((g) => ({ ...g, performance }));

describe('performanceStats', () => {
  it('empty / unrated history → zero rated games, null averages, empty buckets', () => {
    const s = performanceStats(span(5, 10, { perDay: 2 }));
    expect(s.ratedGames).toBe(0);
    expect(s.winAvg).toBeNull();
    expect(s.lossAvg).toBeNull();
    expect(s.trend).toHaveLength(0);
    expect(s.byHero).toHaveLength(0);
  });

  it('day-buckets the trend and averages per day', () => {
    const games = [
      ...rate(span(5, 5, { perDay: 2 }), 60),
      ...rate(span(6, 6, { perDay: 2 }), 40),
      ...span(7, 7, { perDay: 2 }), // unrated day → absent from the trend
    ];
    const s = performanceStats(games);
    expect(s.trend).toHaveLength(2);
    expect(s.trend[0].avg).toBe(60);
    expect(s.trend[1].avg).toBe(40);
    expect(s.trend[1].games).toBe(2);
  });

  it('splits win vs loss averages, draws excluded from both', () => {
    const games = [
      ...rate(span(5, 5, { perDay: 2, result: 'Win' }), 70),
      ...rate(span(6, 6, { perDay: 2, result: 'Loss' }), 40),
      ...rate(span(7, 7, { perDay: 2, result: 'Draw' }), 10),
    ];
    const s = performanceStats(games);
    expect(s.winAvg).toBe(70);
    expect(s.lossAvg).toBe(40);
  });

  it('a multi-hero match counts once per hero (whole-count, mirrors byHero)', () => {
    const g = { ...game({ timestamp: ts(5), heroes: ['Tracer', 'Sombra'] }), performance: 80 };
    const s = performanceStats([g]);
    expect(s.byHero.find((b) => b.key === 'Tracer')?.avg).toBe(80);
    expect(s.byHero.find((b) => b.key === 'Sombra')?.avg).toBe(80);
    expect(s.ratedGames).toBe(1);
  });

  it('unrated heroes/maps are ABSENT (empty cell, never 0)', () => {
    const games = [
      { ...game({ timestamp: ts(5), heroes: ['Tracer'] }), performance: 80 },
      game({ timestamp: ts(5, 16), heroes: ['Genji'] }), // unrated
    ];
    const s = performanceStats(games);
    expect(s.byHero.some((b) => b.key === 'Genji')).toBe(false);
  });
});

describe('sample-data harness (demo AC + constants sanity)', () => {
  const sample = generateSampleGames();
  const competitive = sample.filter((g) => isCompetitive(g.gameType));

  it('sample data now carries performance ratings (deterministic)', () => {
    const rated = sample.filter((g) => typeof g.performance === 'number');
    expect(rated.length).toBeGreaterThan(sample.length * 0.4);
    expect(rated.length).toBeLessThan(sample.length * 0.7);
    for (const g of rated) {
      expect(g.performance!).toBeGreaterThanOrEqual(5);
      expect(g.performance!).toBeLessThanOrEqual(95);
    }
    // Determinism: the same seed yields the same ratings.
    const again = generateSampleGames();
    expect(again.map((g) => g.performance)).toEqual(sample.map((g) => g.performance));
  });

  it('performance surfaces are non-empty from sample data', () => {
    const s = performanceStats(competitive);
    expect(s.ratedGames).toBeGreaterThan(20);
    expect(s.trend.length).toBeGreaterThan(5);
    expect(s.winAvg).not.toBeNull();
    expect(s.lossAvg).not.toBeNull();
    expect(s.byHero.length).toBeGreaterThan(3);
    expect(s.byMap.length).toBeGreaterThan(3);
  });

  it('the demo season reads sane: verdict resolves, never red, score in a plausible band', () => {
    const r = safeReadiness(competitive, Date.now(), { targets: [] });
    expect(r.band).not.toBe('in-the-hole'); // the demo player is not in crisis
    if (r.score !== null) {
      expect(r.score).toBeGreaterThanOrEqual(35);
      expect(r.score).toBeLessThanOrEqual(95);
    }
    expect(r.subscores.load.delta).toBeGreaterThanOrEqual(-40);
    expect(r.subscores.performance.delta).toBeGreaterThanOrEqual(-45);
    expect(r.subscores.subjective.delta).toBeGreaterThanOrEqual(-15);
  });
});
