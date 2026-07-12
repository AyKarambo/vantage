import { describe, it, expect } from 'vitest';
import { createMatchPipeline, type MatchPipelineDeps } from '../src/main/matchPipeline';
import type { AppConfig } from '../src/main/config';
import type { GameRecord } from '../src/core/analytics';
import type { MatchRecord, Result } from '../src/core/model';

/** A full AppConfig for the pipeline's getConfig() dep — no Electron involved. */
function appConfig(p: Partial<AppConfig> = {}): AppConfig {
  return {
    overwatchGameId: 10844,
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

/**
 * A played competitive match GEP delivered WITHOUT an outcome — matchToGame
 * returns null for it (no win/loss), so the pipeline must hold it as pending.
 */
function noOutcomeMatch(matchId: string, over: Partial<MatchRecord> = {}): MatchRecord {
  const { outcome: _drop, ...rest } = capturedMatch(matchId);
  return { ...rest, ...over };
}

/** In-memory stand-in for the HistoryStore slice the pipeline needs (incl. the pending store). */
function fakeHistory() {
  const games: GameRecord[] = [];
  const pending: MatchRecord[] = [];
  const attached: Array<{ matchId: string; screenshots: string[] }> = [];
  return {
    games,
    pending,
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
    addPending(rec: MatchRecord): boolean {
      if (pending.some((x) => x.matchId === rec.matchId)) return false;
      pending.push(rec);
      return true;
    },
    takePending(matchId: string): MatchRecord | undefined {
      const idx = pending.findIndex((x) => x.matchId === matchId);
      return idx < 0 ? undefined : pending.splice(idx, 1)[0];
    },
  };
}

/** Drive createMatchPipeline with plain-object fakes and record every side effect. */
function harness(config: AppConfig = appConfig()) {
  const history = fakeHistory();
  const notifications: Array<{ title: string; body: string }> = [];
  const captures: Array<{ matchId: string; onSaved: (relPaths: string[]) => void }> = [];
  const logged: string[] = [];
  let pendingSignals = 0;
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
    onGameLogged: (g) => {
      logged.push(g.matchId);
    },
    onPendingChanged: () => {
      pendingSignals++;
    },
  };
  return {
    pipeline: createMatchPipeline(deps),
    history,
    notifications,
    captures,
    logged,
    pendingSignals: () => pendingSignals,
  };
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

describe('createMatchPipeline — competitive capture gate', () => {
  it('drops a quick-play or arcade GEP match before it reaches history', () => {
    const { pipeline, history, notifications } = harness();
    expect(pipeline.recordGame(game({ matchId: 'qp-1', result: 'Win', gameType: 'Unranked' }))).toBe(false);
    expect(pipeline.recordGame(game({ matchId: 'ar-1', result: 'Win', gameType: 'Arcade' }))).toBe(false);
    expect(history.games).toHaveLength(0);
    expect(notifications).toHaveLength(0); // dropped before the break-reminder streak check
  });

  it('writes a competitive GEP match', () => {
    const { pipeline, history } = harness();
    expect(pipeline.recordGame(game({ matchId: 'c-1', result: 'Win', gameType: 'Competitive' }))).toBe(true);
    expect(history.games).toHaveLength(1);
    expect(history.games[0].matchId).toBe('c-1');
  });

  it('always writes a manual log, which is forced competitive', () => {
    const { pipeline, history } = harness();
    expect(pipeline.recordGame(game({ matchId: 'manual-1', result: 'Win', gameType: 'Competitive' }))).toBe(true);
    expect(history.games).toHaveLength(1);
  });

  it('drops a non-competitive match delivered through addMatch (feed path)', () => {
    const { pipeline, history, captures } = harness();
    pipeline.addMatch({ ...capturedMatch('gep-qp'), gameType: 'quickplay' });
    expect(history.games).toHaveLength(0);
    expect(captures).toHaveLength(0); // no screenshot capture scheduled for a dropped game
  });
});

describe('createMatchPipeline — onGameLogged live signal', () => {
  it('fires once per newly-logged competitive game, not for dupes or non-competitive', () => {
    const { pipeline, logged } = harness();

    expect(pipeline.recordGame(game({ matchId: 'c-1', result: 'Win' }))).toBe(true);
    expect(logged).toEqual(['c-1']);

    // Duplicate matchId → no second signal.
    pipeline.recordGame(game({ matchId: 'c-1', result: 'Loss' }));
    expect(logged).toEqual(['c-1']);

    // Non-competitive → dropped before the signal.
    pipeline.recordGame(game({ matchId: 'qp-1', result: 'Win', gameType: 'Unranked' }));
    expect(logged).toEqual(['c-1']);

    // A new competitive game through the feed/addMatch path → fires again.
    pipeline.addMatch(capturedMatch('gep-2'));
    expect(logged).toEqual(['c-1', 'gep-2']);
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

describe('createMatchPipeline — no-outcome matches held for Review', () => {
  it('holds a played competitive match with no GEP outcome (never in history), and notifies', () => {
    const { pipeline, history, notifications, captures } = harness();

    pipeline.addMatch(noOutcomeMatch('gep-no-result'));

    // matchToGame yields null (no win/loss) → the match is held, not dropped.
    expect(history.games).toHaveLength(0);
    expect(history.pending.map((r) => r.matchId)).toEqual(['gep-no-result']);
    // The user is told a result is needed, with the Review-pointing copy.
    expect(notifications).toEqual([
      { title: 'Match needs a result', body: 'A ranked match ended without a result — set win/loss in Review.' },
    ]);
    // No screenshot capture for a match that never reached history.
    expect(captures).toHaveLength(0);
  });

  it('fires onPendingChanged once when a match is held, and dedupes a re-held id', () => {
    const { pipeline, history, pendingSignals } = harness();
    pipeline.addMatch(noOutcomeMatch('gep-no-result'));
    expect(pendingSignals()).toBe(1);
    // A second delivery of the same id is a pending no-op: not re-added, no signal.
    pipeline.addMatch(noOutcomeMatch('gep-no-result'));
    expect(history.pending).toHaveLength(1);
    expect(pendingSignals()).toBe(1);
  });

  it('drops a NON-competitive no-outcome match — not held, no notify', () => {
    const { pipeline, history, notifications, pendingSignals } = harness();
    pipeline.addMatch(noOutcomeMatch('qp-no-result', { gameType: 'quickplay' }));
    expect(history.games).toHaveLength(0);
    expect(history.pending).toHaveLength(0);
    expect(notifications).toHaveLength(0);
    expect(pendingSignals()).toBe(0);
  });

  it('does not hold an empty/aborted competitive capture (nothing was played)', () => {
    const { pipeline, history, notifications } = harness();
    pipeline.addMatch(noOutcomeMatch('gep-empty', { heroes: [], roster: [], eliminations: undefined }));
    expect(history.pending).toHaveLength(0);
    expect(history.games).toHaveLength(0);
    expect(notifications).toHaveLength(0);
  });

  it('resolvePending moves the held match into history with the chosen result, and clears pending', () => {
    const { pipeline, history, logged } = harness();
    pipeline.addMatch(noOutcomeMatch('gep-no-result'));
    expect(history.pending).toHaveLength(1);

    expect(pipeline.resolvePending('gep-no-result', 'Win')).toBe(true);
    // It left the pending store and landed in history as a real, resolved game.
    expect(history.pending).toHaveLength(0);
    expect(history.games).toHaveLength(1);
    expect(history.games[0]).toMatchObject({ matchId: 'gep-no-result', result: 'Win', account: 'Main' });
    // Resolving runs the same path as a live game, so the live signal fires.
    expect(logged).toEqual(['gep-no-result']);
  });

  it('resolvePending maps Loss/Draw onto the raw outcome and returns false for an unknown id', () => {
    const loss = harness();
    loss.pipeline.addMatch(noOutcomeMatch('m-loss'));
    expect(loss.pipeline.resolvePending('m-loss', 'Loss')).toBe(true);
    expect(loss.history.games[0].result).toBe('Loss');

    const draw = harness();
    draw.pipeline.addMatch(noOutcomeMatch('m-draw'));
    expect(draw.pipeline.resolvePending('m-draw', 'Draw')).toBe(true);
    expect(draw.history.games[0].result).toBe('Draw');

    // Unknown id → nothing taken, nothing added.
    expect(draw.pipeline.resolvePending('ghost', 'Win')).toBe(false);
    expect(draw.history.games).toHaveLength(1);
  });
});
