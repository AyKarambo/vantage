import { describe, it, expect } from 'vitest';
import { createDispatcher, McpOpError } from '../src/main/mcp/dispatch';
import type { DataProvider } from '../src/main/dashboard/provider';
import type { GameRecord } from '../src/core/analytics';
import type { AuthoredTarget } from '../src/core/targets';
import type { PendingMatch } from '../src/shared/contract';
import type { Result, Role } from '../src/core/model';
import { DEFAULT_MASTER_DATA, type MasterData } from '../src/core/masterData';
import { DEFAULT_BREAK_REMINDER } from '../src/core/breakReminder';
import { DEFAULT_STALENESS } from '../src/core/staleness';
import { DEFAULT_READINESS } from '../src/core/readiness';
import { DEFAULT_SESSION_SETTINGS } from '../src/core/sessionSettings';
import { DEFAULT_GRADING_SETTINGS } from '../src/core/gradingSettings';

/**
 * The op table is the entire attack surface the MCP bridge exposes, so these
 * tests assert two things: that each op reaches the right DataProvider call
 * (no second write path), and that bad input is refused BEFORE any provider
 * method runs (AC 10 — "nothing is persisted").
 */

function game(p: Partial<GameRecord> & { result: Result; map: string; role: Role }): GameRecord {
  return {
    matchId: 'm-1',
    timestamp: Date.parse('2026-06-01T12:00:00Z'),
    account: 'Karambo',
    gameType: 'Competitive',
    heroes: ['Tracer'],
    ...p,
  };
}

function pending(matchId: string): PendingMatch {
  return {
    matchId, map: "King's Row", heroes: ['Tracer'], role: 'damage',
    account: 'Karambo', timestamp: Date.parse('2026-06-02T12:00:00Z'), rosterCount: 10,
  };
}

function target(id: string): AuthoredTarget {
  return { id, name: 'Use cover', mode: 'manual' as AuthoredTarget['mode'], rule: 'stay behind cover' };
}

/** Records every provider call so a test can assert what was (and wasn't) hit. */
interface Log { calls: string[] }

function setup(over: {
  games?: GameRecord[];
  pending?: PendingMatch[];
  targets?: AuthoredTarget[];
  demo?: boolean;
} = {}) {
  const log: Log = { calls: [] };
  const note = (name: string) => log.calls.push(name);
  const master: MasterData = DEFAULT_MASTER_DATA;
  const partial: Partial<DataProvider> = {
    games: () => over.games ?? [],
    pendingMatches: () => over.pending ?? [],
    manualTargets: () => over.targets ?? [],
    demoContext: () => ({ active: over.demo ?? false, preference: 'off', hasRealHistory: true }),
    effectiveMasterData: () => master,
    getBreakReminder: () => DEFAULT_BREAK_REMINDER,
    getStaleness: () => DEFAULT_STALENESS,
    getReadiness: () => DEFAULT_READINESS,
    getSessionSettings: () => DEFAULT_SESSION_SETTINGS,
    getGrading: () => DEFAULT_GRADING_SETTINGS,
    rankAnchorMap: () => ({}),
    getRanks: () => { note('getRanks'); return []; },
    getGepStatus: () => { note('getGepStatus'); return { state: 'idle' } as never; },
    logMatch: (input) => { note(`logMatch:${input.result}:${input.role}:${input.map}`); return { matchId: 'new-1' }; },
    editMatch: () => note('editMatch'),
    saveReview: () => note('saveReview'),
    clearReview: () => note('clearReview'),
    saveTarget: () => note('saveTarget'),
    updateTarget: () => note('updateTarget'),
    setTargetActive: (id, active) => note(`setTargetActive:${id}:${active}`),
    setTargetArchived: (id, archived) => note(`setTargetArchived:${id}:${archived}`),
    deleteTarget: (id) => note(`deleteTarget:${id}`),
    deactivateAllTargets: () => note('deactivateAllTargets'),
    resolvePendingMatch: (id, r) => note(`resolvePendingMatch:${id}:${r}`),
    dismissPendingMatch: (id) => note(`dismissPendingMatch:${id}`),
  };
  return { dispatch: createDispatcher(partial as DataProvider), log };
}

/** Assert the op throws McpOpError with `code`, and that nothing was persisted. */
function expectRefusal(fn: () => unknown, code: string, log: Log): void {
  expect(fn).toThrowError(McpOpError);
  try { fn(); } catch (err) {
    expect((err as McpOpError).code).toBe(code);
  }
  expect(log.calls).toEqual([]);
}

describe('reads', () => {
  it('wraps every read in an envelope carrying the demo flag', () => {
    const { dispatch } = setup({ demo: true });
    for (const op of ['dashboard', 'ranks', 'masterData', 'status'] as const) {
      expect(dispatch(op, {})).toMatchObject({ demo: true });
    }
  });

  it('reports demo:false for real history', () => {
    const { dispatch } = setup({ demo: false });
    expect(dispatch('ranks', {})).toMatchObject({ demo: false });
  });

  it('routes reads to the provider', () => {
    const { dispatch, log } = setup();
    dispatch('ranks', {});
    dispatch('status', {});
    expect(log.calls).toEqual(['getRanks', 'getGepStatus']);
  });

  it('returns null data (not an error) for an unknown match or player', () => {
    const { dispatch } = setup({ games: [game({ result: 'Win', map: 'A', role: 'damage' })] });
    expect(dispatch('matchDetail', { matchId: 'nope' })).toMatchObject({ data: null });
    expect(dispatch('playerHistory', { name: 'Nobody#0000' })).toMatchObject({ data: null });
  });

  it('rejects a missing or blank required argument', () => {
    const { dispatch, log } = setup();
    expectRefusal(() => dispatch('heroDetail', {}), 'invalid-input', log);
    expectRefusal(() => dispatch('heroDetail', { hero: '  ' }), 'invalid-input', log);
    expectRefusal(() => dispatch('playerHistory', { name: 42 }), 'invalid-input', log);
  });

  it('rejects a non-object filters value', () => {
    const { dispatch, log } = setup();
    expectRefusal(() => dispatch('dashboard', { filters: 'season' }), 'invalid-input', log);
  });
});

describe('additive writes', () => {
  it('logMatch validates the game facts and delegates', () => {
    const { dispatch, log } = setup();
    const res = dispatch('logMatch', {
      input: { result: 'Win', role: 'damage', map: "King's Row", gameType: 'Competitive' },
    });
    expect(res).toEqual({ matchId: 'new-1' });
    expect(log.calls).toEqual(['logMatch:Win:damage:King\'s Row']);
  });

  it('logMatch refuses an invalid result or role before touching the store', () => {
    const base = { role: 'damage', map: 'A', gameType: 'Competitive' };
    let s = setup();
    expectRefusal(() => s.dispatch('logMatch', { input: { ...base, result: 'Victory' } }), 'invalid-input', s.log);
    s = setup();
    expectRefusal(() => s.dispatch('logMatch', { input: { ...base, result: 'Win', role: 'dps' } }), 'invalid-input', s.log);
    s = setup();
    expectRefusal(() => s.dispatch('logMatch', { input: { result: 'Win', role: 'damage', gameType: 'Competitive' } }), 'invalid-input', s.log);
  });

  it('editMatch and saveReview reject an unknown match id as not-found', () => {
    const s = setup({ games: [game({ result: 'Win', map: 'A', role: 'damage', matchId: 'known' })] });
    expectRefusal(() => s.dispatch('editMatch', { input: { matchId: 'ghost' } }), 'not-found', s.log);
    const s2 = setup({ games: [game({ result: 'Win', map: 'A', role: 'damage', matchId: 'known' })] });
    expectRefusal(() => s2.dispatch('saveReview', { input: { matchId: 'ghost', grades: {}, flags: {} } }), 'not-found', s2.log);
  });

  it('editMatch delegates for a known match', () => {
    const { dispatch, log } = setup({ games: [game({ result: 'Win', map: 'A', role: 'damage', matchId: 'known' })] });
    dispatch('editMatch', { input: { matchId: 'known', result: 'Loss' } });
    expect(log.calls).toEqual(['editMatch']);
  });

  it('target ops reject an unknown target id', () => {
    const s = setup({ targets: [target('t-1')] });
    expectRefusal(() => s.dispatch('updateTarget', { input: { id: 'nope', name: 'x', mode: 'manual', rule: 'y' } }), 'not-found', s.log);
    const s2 = setup({ targets: [target('t-1')] });
    expectRefusal(() => s2.dispatch('setTargetActive', { id: 'nope', active: true }), 'not-found', s2.log);
  });

  it('setTargetActive/Archived require a boolean', () => {
    const s = setup({ targets: [target('t-1')] });
    expectRefusal(() => s.dispatch('setTargetActive', { id: 't-1', active: 'yes' }), 'invalid-input', s.log);
  });

  it('setTargetActive delegates with the parsed flag', () => {
    const { dispatch, log } = setup({ targets: [target('t-1')] });
    dispatch('setTargetActive', { id: 't-1', active: false });
    expect(log.calls).toEqual(['setTargetActive:t-1:false']);
  });

  it('resolvePending checks the PENDING store, not history', () => {
    const s = setup({ games: [game({ result: 'Win', map: 'A', role: 'damage', matchId: 'in-history' })] });
    // A match already in history is not a pending one — resolving it is a
    // category error, and must not silently fall through to the pipeline.
    expectRefusal(() => s.dispatch('resolvePending', { matchId: 'in-history', result: 'Win' }), 'not-found', s.log);

    const ok = setup({ pending: [pending('p-1')] });
    ok.dispatch('resolvePending', { matchId: 'p-1', result: 'Draw' });
    expect(ok.log.calls).toEqual(['resolvePendingMatch:p-1:Draw']);
  });
});

describe('destructive writes reach the right provider call', () => {
  it('deleteTarget / dismissPending / deactivateAll / clearReview delegate', () => {
    const { dispatch, log } = setup({
      games: [game({ result: 'Win', map: 'A', role: 'damage', matchId: 'known' })],
      pending: [pending('p-1')],
      targets: [target('t-1')],
    });
    dispatch('deleteTarget', { id: 't-1' });
    dispatch('dismissPending', { matchId: 'p-1' });
    dispatch('deactivateAllTargets', {});
    dispatch('clearReview', { matchId: 'known' });
    expect(log.calls).toEqual([
      'deleteTarget:t-1', 'dismissPendingMatch:p-1', 'deactivateAllTargets', 'clearReview',
    ]);
  });

  it('still enforces not-found', () => {
    const s = setup({ targets: [target('t-1')] });
    expectRefusal(() => s.dispatch('deleteTarget', { id: 'ghost' }), 'not-found', s.log);
  });
});
