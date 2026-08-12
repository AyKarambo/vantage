import { describe, it, expect } from 'vitest';
import { computeDashboard } from '../src/core/dashboardData';
import type { PlacementRun } from '../src/core/placements';
import type { GameRecord } from '../src/core/analytics';
import type { Role } from '../src/core/model';

/**
 * The dashboard payload's half of placements: open runs must not let their
 * matches move the rank, and every run must reach the renderer as a summary so
 * the rank surfaces can say `Placements N/10`.
 */

const T0 = 1_700_000_000_000;
const MINUTE = 60_000;
const demo = { active: false, preference: 'off' as const, hasRealHistory: true };

const g = (n: number, over: Partial<GameRecord> = {}): GameRecord => ({
  matchId: `m-${n}`,
  timestamp: T0 + n * MINUTE,
  account: 'Main',
  role: 'tank' as Role,
  map: 'Ilios',
  result: 'Win',
  gameType: 'Competitive',
  heroes: [],
  srDelta: 20,
  ...over,
} as GameRecord);

const run = (over: Partial<PlacementRun> = {}): PlacementRun => ({
  account: 'Main',
  role: 'tank',
  startedAt: T0,
  preRunAnchor: null,
  predictions: {},
  ...over,
});

/** Anchor set before every game, so unsuppressed deltas would visibly move it. */
const anchors = { 'Main::tank': { tier: 'Gold', division: 3, progressPct: 0, setAt: T0 - MINUTE } };

describe('dashboard — open runs suppress ladder movement', () => {
  it('an open run keeps its matches from moving the rank', () => {
    const games = [g(1), g(2), g(3)];
    const withoutRun = computeDashboard(games, { days: 'all' }, demo, { rankAnchors: anchors });
    const withRun = computeDashboard(games, { days: 'all' }, demo, {
      rankAnchors: anchors,
      placementRuns: [run()],
    });
    // 3 x +20 would climb from Gold 3 0%; inside an open run it must not.
    expect(withoutRun.primaryRank).toMatchObject({ progressPct: 60 });
    expect(withRun.primaryRank).toMatchObject({ tier: 'Gold', division: 3, progressPct: 0, movement: 0 });
  });

  it('a COMPLETED run does not suppress — its anchor already excludes those matches', () => {
    const games = [g(1), g(2), g(3)];
    const d = computeDashboard(games, { days: 'all' }, demo, {
      rankAnchors: anchors,
      placementRuns: [run({ completedAt: T0, completedMatchIds: ['m-1', 'm-2', 'm-3'] })],
    });
    expect(d.primaryRank).toMatchObject({ progressPct: 60 });
  });

  it('leaves a different track alone', () => {
    const games = [g(1), g(2, { role: 'damage' as Role })];
    const both = { ...anchors, 'Main::damage': { tier: 'Gold', division: 3, progressPct: 0, setAt: T0 - MINUTE } };
    const d = computeDashboard(games, { days: 'all', role: 'damage' }, demo, {
      rankAnchors: both,
      placementRuns: [run()], // tank only
    });
    expect(d.primaryRank).toMatchObject({ role: 'damage', progressPct: 20 });
  });
});

describe('dashboard — placement summaries', () => {
  it('reports progress, prediction, completion and drift', () => {
    const games = [g(1), g(2), g(3)];
    const d = computeDashboard(games, { days: 'all' }, demo, {
      rankAnchors: anchors,
      placementRuns: [run({ predictions: { 'm-2': { tier: 'Platinum', division: 4 } } })],
    });
    expect(d.placements).toHaveLength(1);
    expect(d.placements[0]).toMatchObject({
      account: 'Main', role: 'tank', counted: 3, target: 10, completed: false, drifted: false,
    });
    expect(d.placements[0].latestPrediction).toEqual({ tier: 'Platinum', division: 4 });
  });

  it('flags a completed run whose counted matches changed underneath it', () => {
    const games = [g(1), g(2)]; // m-3 has since been deleted
    const d = computeDashboard(games, { days: 'all' }, demo, {
      rankAnchors: anchors,
      placementRuns: [run({ completedAt: T0, completedMatchIds: ['m-1', 'm-2', 'm-3'] })],
    });
    expect(d.placements[0]).toMatchObject({ completed: true, drifted: true });
  });

  it('is empty when no runs are tracked, leaving rank behaviour untouched', () => {
    const games = [g(1), g(2), g(3)];
    const d = computeDashboard(games, { days: 'all' }, demo, { rankAnchors: anchors });
    expect(d.placements).toEqual([]);
    expect(d.primaryRank).toMatchObject({ progressPct: 60 });
  });
});
