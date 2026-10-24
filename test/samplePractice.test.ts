import { describe, it, expect } from 'vitest';
import { generateSampleGames, samplePracticeLayer } from '../src/core/sampleData';
import { computeDashboard } from '../src/core/dashboardData';

const NOW = Date.now();

describe('samplePracticeLayer (#321)', () => {
  it('is deterministic and leaves the generated season untouched', () => {
    const games = generateSampleGames();
    const before = JSON.stringify(games);
    const a = samplePracticeLayer(games, NOW);
    const b = samplePracticeLayer(games, NOW);
    expect(JSON.stringify(games)).toBe(before);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.games.map((g) => g.matchId)).toEqual(games.map((g) => g.matchId));
  });

  it('grades older games with a focus target and keeps the last two days ungraded', () => {
    const { games, checkIns } = samplePracticeLayer(generateSampleGames(), NOW);
    const graded = games.filter((g) => g.review);
    expect(graded.length).toBeGreaterThan(20);
    expect(graded.every((g) => g.review!.focusTargetIds?.length === 1)).toBe(true);
    expect(games.filter((g) => NOW - g.timestamp < 2 * 86_400_000).every((g) => !g.review)).toBe(true);
    expect(checkIns.some((c) => c.sleep && c.energy && c.ate !== undefined)).toBe(true);
  });
});

describe('computeDashboard on demo data (AC26)', () => {
  it('fills every practice read and keeps the demo Review inbox', () => {
    const games = generateSampleGames();
    const d = computeDashboard(games, { days: 'all' }, { active: true, preference: 'on' as const, hasRealHistory: false });
    expect(d.practice.on).toBe(true);
    expect(d.practice.execution.attempts).toBeGreaterThan(0);
    expect(d.practice.sittings.length).toBeGreaterThan(0);
    expect(d.practice.factors.map((f) => f.key)).toEqual(expect.arrayContaining(['sleep', 'energy', 'mood', 'ate', 'position']));
    expect(d.practice.weakestDays.length).toBeGreaterThan(0);
    expect(d.tiltBySleep.length).toBeGreaterThan(0);
    expect(d.reviewInbox.length).toBeGreaterThan(0);
  });
});
