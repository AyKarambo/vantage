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

describe('dashboard — awaiting rank', () => {
  const tenGames = () => Array.from({ length: 10 }, (_, i) => g(i + 1));

  it('is true once a run counts its full target but the revealed rank is not confirmed yet', () => {
    const d = computeDashboard(tenGames(), { days: 'all' }, demo, {
      rankAnchors: anchors,
      placementRuns: [run()],
    });
    expect(d.placements[0]).toMatchObject({ counted: 10, target: 10, completed: false, awaitingRank: true });
  });

  it('is false mid-run', () => {
    const games = [g(1), g(2), g(3), g(4)];
    const d = computeDashboard(games, { days: 'all' }, demo, {
      rankAnchors: anchors,
      placementRuns: [run()],
    });
    expect(d.placements[0]).toMatchObject({ counted: 4, target: 10, awaitingRank: false });
  });

  it('is false once the run is completed', () => {
    const games = tenGames();
    const d = computeDashboard(games, { days: 'all' }, demo, {
      rankAnchors: anchors,
      placementRuns: [run({ completedAt: T0, completedMatchIds: games.map((x) => x.matchId) })],
    });
    expect(d.placements[0]).toMatchObject({ completed: true, awaitingRank: false });
  });

  it('rebuilding the dashboard never flips completed or moves the anchor on its own (AC10)', () => {
    const opts = { rankAnchors: anchors, placementRuns: [run()] };
    const first = computeDashboard(tenGames(), { days: 'all' }, demo, opts);
    const second = computeDashboard(tenGames(), { days: 'all' }, demo, opts);
    expect(first.placements[0]).toMatchObject({ completed: false, awaitingRank: true });
    expect(second.placements[0]).toMatchObject({ completed: false, awaitingRank: true });
    expect(second.primaryRank).toEqual(first.primaryRank);
  });
});

describe('dashboard — an open run also masks the readiness rank trend', () => {
  /**
   * The wiring test for the mask. `rankTrendFor` treats a logged ±% as evidence
   * of movement, and `stagnant` is the ONLY state that lets the undertraining
   * nudge fire — so without the suppressed set threaded into readiness, a track
   * the app is showing as `Placements N/10` (no rank at all) could still be told
   * to play more on the strength of deltas every rank surface is ignoring.
   *
   * Timestamps are relative to NOW because `computeDashboard` evaluates
   * readiness at `Date.now()`; the T0-based fixtures above are years stale to it.
   */
  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.now();
  /** Weekend-shaped low-volume history with net-flat logged SR — the stagnant shape. */
  const recentGames = (): GameRecord[] => {
    const out: GameRecord[] = [];
    let n = 0;
    for (const daysAgo of [23, 22, 16, 15, 9, 8, 2, 1]) {
      for (let i = 0; i < 5; i++) {
        out.push(g(0, {
          matchId: `r-${n}`,
          timestamp: now - daysAgo * DAY + i * 60_000,
          srDelta: n % 2 === 0 ? 20 : -20,
        }));
        n++;
      }
    }
    return out;
  };
  const recentAnchors = { 'Main::tank': { tier: 'Gold', division: 3, progressPct: 50, setAt: now - 30 * DAY } };
  const lowFrequency = (d: ReturnType<typeof computeDashboard>): boolean =>
    d.readiness.signals.some((s) => s.key === 'low-frequency');

  it('fires the rank-gated nudge on logged deltas with no run open', () => {
    const d = computeDashboard(recentGames(), { days: 'all' }, demo, { rankAnchors: recentAnchors });
    expect(lowFrequency(d)).toBe(true);
  });

  it('and goes silent once those same matches sit inside an OPEN placement run', () => {
    const games = recentGames();
    const d = computeDashboard(games, { days: 'all' }, demo, {
      rankAnchors: recentAnchors,
      placementRuns: [run({ startedAt: games[0].timestamp })],
    });
    expect(lowFrequency(d)).toBe(false);
  });

  it('a COMPLETED run stops masking — its matches are real evidence again', () => {
    const games = recentGames();
    const d = computeDashboard(games, { days: 'all' }, demo, {
      rankAnchors: recentAnchors,
      placementRuns: [run({
        startedAt: games[0].timestamp,
        completedAt: now,
        completedMatchIds: games.slice(0, 10).map((x) => x.matchId),
      })],
    });
    expect(lowFrequency(d)).toBe(true);
  });
});
