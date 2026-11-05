import { describe, it, expect, vi } from 'vitest';
import {
  canTrain, DEFAULT_SESSION_MODE, effectiveSessionMode, executionScore, isTrainingMatch, normalizeSessionMode,
  practiceFocusOn, splitByMode, stampSessionMode, trainingSummary,
} from '../src/core/practice';
import { computeDashboard } from '../src/core/dashboardData';
import { DEFAULT_COACHING, normalizeCoachingSettings } from '../src/core/coachingSettings';
import { applyManualPatch } from '../src/core/manualPatch';
import type { GameRecord, MatchReview } from '../src/core/analytics';
import type { AuthoredTarget } from '../src/core/targets';
import { createMatchPipeline, type MatchPipelineDeps } from '../src/main/matchPipeline';
import { createDataProvider, type DataProviderDeps } from '../src/main/dataProvider';
import type { AppConfig } from '../src/main/config';

/**
 * Session mode — Stats ↔ Training (issue #342): the persisted switch, its
 * opt-in auto-reset, the per-match stamp written at persist time, and the
 * execution reads the Matches training view renders.
 */

const MIN = 60_000;
const NOW = 1_800_000_000_000;

describe('normalizeSessionMode', () => {
  it('defaults to Stats and rejects junk', () => {
    expect(normalizeSessionMode(undefined)).toEqual(DEFAULT_SESSION_MODE);
    expect(normalizeSessionMode({ mode: 'practice', since: 'x' })).toEqual({ mode: 'stats', since: 0 });
    expect(normalizeSessionMode({ mode: 'training', since: 123.4 })).toEqual({ mode: 'training', since: 123 });
  });
});

describe('effectiveSessionMode', () => {
  const on = { mode: 'training' as const, since: NOW - 60 * MIN };
  const opts = { autoReset: true, gapMinutes: 180, now: NOW };

  it('Stats stays Stats; Training stays on without auto-reset, however long the pause', () => {
    expect(effectiveSessionMode({ mode: 'stats', since: 0 }, opts)).toBe('stats');
    expect(effectiveSessionMode({ mode: 'training', since: NOW - 3 * 86_400_000 }, { ...opts, autoReset: false })).toBe('training');
  });

  it('auto-reset keeps Training through an unbroken sitting', () => {
    expect(effectiveSessionMode(on, { ...opts, matchTimes: [NOW - 40 * MIN, NOW - 20 * MIN] })).toBe('training');
  });

  it('auto-reset lapses once a pause longer than the gap starts a new sitting', () => {
    const since = NOW - 10 * 60 * MIN;
    // Switched on, played two games, then a 4h pause up to now.
    expect(effectiveSessionMode({ mode: 'training', since }, { ...opts, matchTimes: [since + 20 * MIN, since + 40 * MIN] })).toBe('stats');
  });

  it('a lapsed Training session is not revived by later games', () => {
    const since = NOW - 10 * 60 * MIN;
    // A gap of 5h after the switch, then games right up to now.
    const times = [since + 300 * MIN, NOW - 30 * MIN, NOW - 5 * MIN];
    expect(effectiveSessionMode({ mode: 'training', since }, { ...opts, matchTimes: times })).toBe('stats');
  });

  it('games from before the switch never count', () => {
    expect(effectiveSessionMode(on, { ...opts, matchTimes: [NOW - 900 * MIN] })).toBe('training');
  });
});

describe('stampSessionMode', () => {
  const g = { matchId: 'a' } as GameRecord;
  it('stamps only Training, never overwrites, and leaves a stats game untouched', () => {
    expect(stampSessionMode(g, 'training').sessionMode).toBe('training');
    expect(stampSessionMode(g, 'stats')).toBe(g);
    expect('sessionMode' in stampSessionMode(g, 'stats')).toBe(false);
    const already = { ...g, sessionMode: 'training' as const };
    expect(stampSessionMode(already, 'training')).toBe(already);
  });

  it('a manual patch reclassifies both ways', () => {
    const rec = { ...g } as GameRecord;
    applyManualPatch(rec, { sessionMode: 'training' });
    expect(isTrainingMatch(rec)).toBe(true);
    applyManualPatch(rec, { sessionMode: null });
    expect(isTrainingMatch(rec)).toBe(false);
    expect('sessionMode' in rec).toBe(false);
  });
});

describe('executionScore / trainingSummary', () => {
  it('scores Hit 1 / Partial ½ / Miss 0, averaged; null with nothing graded', () => {
    expect(executionScore(['hit', 'partial', 'missed'])).toBe(0.5);
    expect(executionScore(['hit', 'hit'])).toBe(1);
    expect(executionScore([])).toBeNull();
  });

  it('summarises a sitting over its training rows and self-rated targets only', () => {
    const self = new Set(['a', 'b']);
    const rows = [
      { sessionMode: 'training', targetGrades: { a: 'hit' as const, m: 'missed' as const } },
      { sessionMode: 'training', targetGrades: { a: 'hit' as const, b: 'partial' as const } },
      { sessionMode: 'training', targetGrades: { a: 'missed' as const } },
      { sessionMode: 'training' },
      { targetGrades: { a: 'missed' as const } }, // a stats game — ignored
    ];
    const s = trainingSummary(rows, self);
    expect(s).toMatchObject({ games: 4, graded: 3, hits: 2, partials: 1, misses: 1, attempts: 4, targetIds: ['a', 'b'] });
    expect(s.score).toBeCloseTo(2.5 / 4);
  });

  it('splitByMode keeps order', () => {
    const rows = [{ id: 1, sessionMode: 'training' }, { id: 2 }, { id: 3, sessionMode: 'training' }];
    const { training, stats } = splitByMode(rows);
    expect(training.map((r) => r.id)).toEqual([1, 3]);
    expect(stats.map((r) => r.id)).toEqual([2]);
  });
});

describe('canTrain / practiceFocusOn', () => {
  it('Training needs an active, non-archived self-rated target', () => {
    expect(canTrain([])).toBe(false);
    expect(canTrain([{ isActive: true, mode: 'measured' }, { isActive: true, archivedAt: 1 }])).toBe(false);
    expect(canTrain([{ isActive: true, mode: 'self' }])).toBe(true);
  });

  it('a Training session turns practice focus on even when the setting says off', () => {
    expect(practiceFocusOn({ practiceFocus: 'off' }, [], 'training')).toBe(true);
    expect(practiceFocusOn({ practiceFocus: 'off' }, [], 'stats')).toBe(false);
    expect(practiceFocusOn({ practiceFocus: 'auto' }, [], 'training')).toBe(true);
  });

  it('the auto-reset setting defaults off and only accepts true', () => {
    expect(DEFAULT_COACHING.trainingAutoReset).toBe(false);
    expect(normalizeCoachingSettings({ trainingAutoReset: 'yes' }).trainingAutoReset).toBe(false);
    expect(normalizeCoachingSettings({ trainingAutoReset: true }).trainingAutoReset).toBe(true);
  });
});

// ---- computeDashboard wiring ----------------------------------------------------

function game(id: string, minAgo: number, p: Partial<GameRecord> = {}): GameRecord {
  return {
    matchId: id, timestamp: Date.now() - minAgo * MIN, account: 'Main', role: 'damage', map: 'Ilios',
    result: 'Loss', gameType: 'Competitive', heroes: ['Genji'], durationMinutes: 10, srDelta: -20, ...p,
  };
}
const review = (grades: MatchReview['grades']): MatchReview => ({ at: 1, grades, flags: {} });
const authored = (id: string): AuthoredTarget => ({ id, name: id, mode: 'self', rule: 'r', createdAt: 0, activatedAt: 0, isActive: true });
const demo = { active: false, preference: 'off' as const, hasRealHistory: true };

describe('computeDashboard — session mode (#342)', () => {
  const games = [
    game('t1', 30, { sessionMode: 'training', review: review({ a: 'hit' }) }),
    game('s1', 60),
  ];

  it('rows carry the stamp; stats rows stay exactly as before', () => {
    const d = computeDashboard(games, { days: 'all' }, demo, { targets: [authored('a')] });
    const byId = new Map(d.matches.map((m) => [m.matchId, m]));
    expect(byId.get('t1')!.sessionMode).toBe('training');
    expect('sessionMode' in byId.get('s1')!).toBe(false);
    // The result and ±% are still tracked on a training row.
    expect(byId.get('t1')!.result).toBe('Loss');
    expect(byId.get('t1')!.srDelta).toBe(-20);
  });

  it('reports the effective mode and turns practice focus on while training', () => {
    const coaching = { ...DEFAULT_COACHING, practiceFocus: 'off' as const };
    const stats = computeDashboard(games, { days: 'all' }, demo, { targets: [authored('a')], coaching });
    expect(stats.sessionMode.mode).toBe('stats');
    expect(stats.practice.on).toBe(false);
    const training = computeDashboard(games, { days: 'all' }, demo, {
      targets: [authored('a')], coaching, sessionMode: { mode: 'training', since: Date.now() - 5 * MIN },
    });
    expect(training.sessionMode.mode).toBe('training');
    expect(training.practice.on).toBe(true);
  });

  it('rank and Trends are unaffected by the mode', () => {
    const plain = computeDashboard(games.map(({ sessionMode: _s, ...g }) => g), { days: 'all' }, demo, { targets: [authored('a')] });
    const marked = computeDashboard(games, { days: 'all' }, demo, {
      targets: [authored('a')], sessionMode: { mode: 'training', since: Date.now() - 5 * MIN },
    });
    expect(marked.overall).toEqual(plain.overall);
    expect(marked.trend).toEqual(plain.trend);
    expect(marked.rankTrend).toEqual(plain.rankTrend);
    expect(marked.accountRanks).toEqual(plain.accountRanks);
    expect(marked.readiness).toEqual(plain.readiness);
    expect(marked.session).toEqual(plain.session);
    expect(marked.overall.games).toBe(2);
  });
});

// ---- persist-time stamping (main) ----------------------------------------------

function pipelineHarness(sessionMode: AppConfig['sessionMode'], autoReset = false) {
  const games: GameRecord[] = [];
  const config = {
    accounts: {}, breakReminder: { enabled: false, afterLosses: 3 },
    coaching: { ...DEFAULT_COACHING, trainingAutoReset: autoReset },
    sessionSettings: { gapMinutes: 180 }, sessionMode,
  } as unknown as AppConfig;
  const deps = {
    history: {
      add: (g: GameRecord) => (games.some((x) => x.matchId === g.matchId) ? false : (games.push(g), true)),
      all: () => [...games],
    },
    aggregator: { handle: () => null },
    getConfig: () => config,
    notify: () => {},
    log: () => {},
  } as unknown as MatchPipelineDeps;
  return { pipeline: createMatchPipeline(deps), games };
}

describe('match pipeline — stamps at persist time', () => {
  const g = (id: string): GameRecord => game(id, 0);

  it('stamps a game recorded while Training is on', () => {
    const { pipeline, games } = pipelineHarness({ mode: 'training', since: Date.now() - 10 * MIN });
    pipeline.recordGame(g('a'));
    expect(games[0].sessionMode).toBe('training');
  });

  it('leaves a Stats game unstamped', () => {
    const { pipeline, games } = pipelineHarness({ mode: 'stats', since: 0 });
    pipeline.recordGame(g('a'));
    expect('sessionMode' in games[0]).toBe(false);
  });

  it('does not stamp once the opt-in auto-reset has lapsed Training', () => {
    const { pipeline, games } = pipelineHarness({ mode: 'training', since: Date.now() - 600 * MIN }, true);
    pipeline.recordGame(g('a'));
    expect('sessionMode' in games[0]).toBe(false);
  });
});

describe('data provider — setSessionMode / setMatchSessionMode', () => {
  function providerHarness() {
    const config = { accounts: {}, sessionMode: { mode: 'stats', since: 0 } } as unknown as AppConfig;
    const persistConfig = vi.fn();
    const editManual = vi.fn((id: string) => id !== 'demo-1');
    const deps = {
      history: { count: () => 0, all: () => [], editManual },
      getConfig: () => config,
      persistConfig,
    } as unknown as DataProviderDeps;
    return { provider: createDataProvider(deps), config, persistConfig, editManual };
  }

  it('persists the switch with the time it was flipped', () => {
    const { provider, config, persistConfig } = providerHarness();
    const out = provider.setSessionMode('training');
    expect(out.mode).toBe('training');
    expect(out.since).toBeGreaterThan(0);
    expect(config.sessionMode).toEqual(out);
    expect(persistConfig).toHaveBeenCalledWith({ sessionMode: out });
  });

  it('reclassifies each stored match once; a demo match counts 0', () => {
    const { provider, editManual } = providerHarness();
    expect(provider.setMatchSessionMode({ matchIds: ['a', 'a', 'b', 'demo-1'], mode: 'training' })).toEqual({ updated: 2 });
    expect(editManual).toHaveBeenCalledWith('a', { sessionMode: 'training' });
    provider.setMatchSessionMode({ matchIds: ['a'], mode: 'stats' });
    expect(editManual).toHaveBeenLastCalledWith('a', { sessionMode: null });
  });
});
