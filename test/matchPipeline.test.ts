import { describe, it, expect } from 'vitest';
import { createMatchPipeline, type MatchPipelineDeps } from '../src/main/matchPipeline';
import type { AppConfig } from '../src/main/config';
import type { GameRecord } from '../src/core/analytics';
import type { MatchRecord, Result } from '../src/core/model';

/** A full AppConfig for the pipeline's getConfig() dep — no Electron involved. */
function appConfig(p: Partial<AppConfig> = {}): AppConfig {
  return {
    overwatchGameId: 10844,
    logFilter: 'Competitive',
    runAtLogin: false,
    sensor: 'gep',
    notion: { gametrackerDatabaseId: '', mapsDatabaseId: '', gametrackerUrl: '' },
    accounts: { 'Player#1234': 'Main' },
    mapAliases: {},
    breakReminder: { enabled: true, afterLosses: 2 },
    ...p,
  };
}

function game(p: Partial<GameRecord> & { matchId: string; result: Result }): GameRecord {
  return {
    timestamp: Date.now(),
    account: 'Main',
    role: 'damage',
    map: 'Ilios',
    gameType: 'Competitive',
    heroes: ['Tracer'],
    ...p,
  };
}

/** An aggregated capture record that matchToGame can fully resolve. */
function capturedMatch(matchId: string): MatchRecord {
  return {
    matchId,
    battleTag: 'Player#1234',
    mapName: 'Ilios',
    outcome: 'victory',
    queueType: 'role',
    heroRole: 'damage',
    gameType: 'competitive',
    heroes: ['Tracer'],
    endedAt: 1_000,
  };
}

/** In-memory stand-in for the HistoryStore slice the pipeline needs. */
function fakeHistory() {
  const games: GameRecord[] = [];
  const attached: Array<{ matchId: string; screenshots: string[] }> = [];
  return {
    games,
    attached,
    add(g: GameRecord): boolean {
      if (games.some((x) => x.matchId === g.matchId)) return false;
      games.push(g);
      return true;
    },
    all(): GameRecord[] {
      return [...games];
    },
    addScreenshots(matchId: string, screenshots: string[]): boolean {
      if (!games.some((x) => x.matchId === matchId) || !screenshots.length) return false;
      attached.push({ matchId, screenshots });
      return true;
    },
  };
}

/** Drive createMatchPipeline with plain-object fakes and record every side effect. */
function harness(config: AppConfig = appConfig()) {
  const history = fakeHistory();
  const notifications: Array<{ title: string; body: string }> = [];
  const captures: Array<{ matchId: string; onSaved: (relPaths: string[]) => void }> = [];
  const deps: MatchPipelineDeps = {
    history,
    aggregator: { handle: () => null },
    screenshots: {
      capture: (matchId, onSaved) => {
        captures.push({ matchId, onSaved });
      },
    },
    getConfig: () => config,
    notify: (title, body) => {
      notifications.push({ title, body });
    },
    log: () => {},
  };
  return { pipeline: createMatchPipeline(deps), history, notifications, captures };
}

describe('createMatchPipeline — recordGame dedupe', () => {
  it('adds a new game and returns false without double-adding on a duplicate matchId', () => {
    const { pipeline, history } = harness();
    expect(pipeline.recordGame(game({ matchId: 'm-1', result: 'Win' }))).toBe(true);
    expect(pipeline.recordGame(game({ matchId: 'm-1', result: 'Loss' }))).toBe(false);
    expect(history.games).toHaveLength(1);
    expect(history.games[0].result).toBe('Win'); // the duplicate never replaced the original
  });
});

describe('createMatchPipeline — break reminder', () => {
  it('notifies after the configured loss streak, holds cadence, and re-arms after a win', () => {
    const { pipeline, notifications } = harness();

    pipeline.recordGame(game({ matchId: 'l-1', result: 'Loss', timestamp: 1_000 }));
    expect(notifications).toHaveLength(0);
    pipeline.recordGame(game({ matchId: 'l-2', result: 'Loss', timestamp: 2_000 }));
    expect(notifications).toHaveLength(1);
    expect(notifications[0].title).toBe('Time for a break?');
    expect(notifications[0].body).toContain('2 losses in a row');

    // Re-fire cadence is every further afterLosses losses: quiet at 3, again at 4.
    pipeline.recordGame(game({ matchId: 'l-3', result: 'Loss', timestamp: 3_000 }));
    expect(notifications).toHaveLength(1);
    pipeline.recordGame(game({ matchId: 'l-4', result: 'Loss', timestamp: 4_000 }));
    expect(notifications).toHaveLength(2);

    // A win re-arms the reminder; a fresh loss streak fires again at the threshold.
    pipeline.recordGame(game({ matchId: 'w-1', result: 'Win', timestamp: 5_000 }));
    pipeline.recordGame(game({ matchId: 'l-5', result: 'Loss', timestamp: 6_000 }));
    expect(notifications).toHaveLength(2);
    pipeline.recordGame(game({ matchId: 'l-6', result: 'Loss', timestamp: 7_000 }));
    expect(notifications).toHaveLength(3);
  });

  it('holds its fired state across calls — a Draw mid-streak does not re-fire', () => {
    // A Draw is excluded from streak(), so the loss count stays at the fired
    // threshold. Only the closure-held reminderState (firedAtCount) prevents a
    // re-fire here — this fails if the pipeline resets its state per call.
    const { pipeline, notifications } = harness();
    pipeline.recordGame(game({ matchId: 'l-1', result: 'Loss', timestamp: 1_000 }));
    pipeline.recordGame(game({ matchId: 'l-2', result: 'Loss', timestamp: 2_000 }));
    expect(notifications).toHaveLength(1);
    pipeline.recordGame(game({ matchId: 'd-1', result: 'Draw', timestamp: 3_000 }));
    expect(notifications).toHaveLength(1);
  });

  it('never notifies when the reminder is disabled', () => {
    const { pipeline, notifications } = harness(
      appConfig({ breakReminder: { enabled: false, afterLosses: 2 } }),
    );
    pipeline.recordGame(game({ matchId: 'l-1', result: 'Loss', timestamp: 1_000 }));
    pipeline.recordGame(game({ matchId: 'l-2', result: 'Loss', timestamp: 2_000 }));
    pipeline.recordGame(game({ matchId: 'l-3', result: 'Loss', timestamp: 3_000 }));
    expect(notifications).toHaveLength(0);
  });
});

describe('createMatchPipeline — addMatch screenshots', () => {
  it('resolves the record into history and attaches captured screenshots via the callback', () => {
    const { pipeline, history, captures } = harness();

    pipeline.addMatch(capturedMatch('gep-1'));
    expect(history.games).toHaveLength(1);
    expect(history.games[0]).toMatchObject({ matchId: 'gep-1', result: 'Win', account: 'Main' });
    expect(captures).toHaveLength(1);
    expect(captures[0].matchId).toBe('gep-1');

    // The capture completes later; its saved paths land on the stored game.
    captures[0].onSaved(['gep-1/end-of-match.png']);
    expect(history.attached).toEqual([
      { matchId: 'gep-1', screenshots: ['gep-1/end-of-match.png'] },
    ]);
  });

  it('never schedules a capture for a duplicate match', () => {
    const { pipeline, captures } = harness();
    pipeline.addMatch(capturedMatch('gep-1'));
    pipeline.addMatch(capturedMatch('gep-1'));
    expect(captures).toHaveLength(1);
  });
});
