import { describe, it, expect } from 'vitest';
import { createDispatcher, McpOpError } from '../src/main/mcp/dispatch';
import { DESTRUCTIVE_OPS, ADDITIVE_WRITE_OPS, READ_OPS, type McpOp } from '../src/shared/mcp/ops';
import type { DataProvider } from '../src/main/dashboard/provider';
import type { GameRecord } from '../src/core/analytics';
import type { AuthoredTarget } from '../src/core/targets';
import type { PendingMatch } from '../src/shared/contract';
import { DEFAULT_MASTER_DATA } from '../src/core/masterData';
import { DEFAULT_BREAK_REMINDER } from '../src/core/breakReminder';
import { DEFAULT_STALENESS } from '../src/core/staleness';
import { DEFAULT_READINESS } from '../src/core/readiness';
import { DEFAULT_SESSION_SETTINGS } from '../src/core/sessionSettings';
import { DEFAULT_GRADING_SETTINGS } from '../src/core/gradingSettings';

/**
 * Destructive ops must not run without explicit confirmation (AC 12).
 *
 * What this enforces, precisely: the app refuses a destructive op whose
 * `confirm` is not exactly `true`. That is NOT the same as user consent — a
 * model can set the flag itself. Real consent comes from the client's approval
 * prompt (driven by the tool's destructiveHint annotation) or elicitation. The
 * flag stops a destructive op being reached incidentally and makes intent
 * explicit at the boundary; the tests below pin that boundary, nothing more.
 */

const MATCH_ID = 'm-1';
const TARGET_ID = 't-1';
const PENDING_ID = 'p-1';

function setup() {
  const mutations: string[] = [];
  const note = (name: string) => () => { mutations.push(name); };
  const games: GameRecord[] = [{
    matchId: MATCH_ID, timestamp: Date.parse('2026-06-01T12:00:00Z'), account: 'Karambo',
    gameType: 'Competitive', heroes: ['Tracer'], result: 'Win', map: 'A', role: 'damage',
  }];
  const targets: AuthoredTarget[] = [
    { id: TARGET_ID, name: 'Use cover', mode: 'manual' as AuthoredTarget['mode'], rule: 'r' },
  ];
  const pendingList: PendingMatch[] = [{
    matchId: PENDING_ID, map: 'A', heroes: ['Tracer'], role: 'damage',
    account: 'Karambo', timestamp: Date.parse('2026-06-02T12:00:00Z'), rosterCount: 10,
  }];
  const partial: Partial<DataProvider> = {
    games: () => games,
    pendingMatches: () => pendingList,
    manualTargets: () => targets,
    demoContext: () => ({ active: false, preference: 'off', hasRealHistory: true }),
    effectiveMasterData: () => DEFAULT_MASTER_DATA,
    getBreakReminder: () => DEFAULT_BREAK_REMINDER,
    getStaleness: () => DEFAULT_STALENESS,
    getReadiness: () => DEFAULT_READINESS,
    getSessionSettings: () => DEFAULT_SESSION_SETTINGS,
    getGrading: () => DEFAULT_GRADING_SETTINGS,
    rankAnchorMap: () => ({}),
    getRanks: () => [],
    getGepStatus: () => ({ state: 'idle' }) as never,
    logMatch: (() => { mutations.push('logMatch'); return { matchId: 'x' }; }) as never,
    editMatch: note('editMatch'),
    saveReview: note('saveReview'),
    clearReview: note('clearReview'),
    saveTarget: note('saveTarget'),
    updateTarget: note('updateTarget'),
    setTargetActive: note('setTargetActive'),
    setTargetArchived: note('setTargetArchived'),
    deleteTarget: note('deleteTarget'),
    deactivateAllTargets: note('deactivateAllTargets'),
    resolvePendingMatch: note('resolvePendingMatch'),
    dismissPendingMatch: note('dismissPendingMatch'),
  };
  return { dispatch: createDispatcher(partial as DataProvider), mutations };
}

/** Valid args per destructive op, minus the confirm flag. */
const DESTRUCTIVE_ARGS: Record<(typeof DESTRUCTIVE_OPS)[number], Record<string, unknown>> = {
  deleteTarget: { id: TARGET_ID },
  dismissPending: { matchId: PENDING_ID },
  deactivateAllTargets: {},
  clearReview: { matchId: MATCH_ID },
};

function codeOf(fn: () => unknown): string | undefined {
  try { fn(); return undefined; } catch (err) {
    return err instanceof McpOpError ? err.code : 'not-an-McpOpError';
  }
}

describe('destructive ops without confirmation', () => {
  it.each(DESTRUCTIVE_OPS)('%s is refused and mutates nothing', (op) => {
    const { dispatch, mutations } = setup();
    expect(codeOf(() => dispatch(op, DESTRUCTIVE_ARGS[op]))).toBe('needs-confirmation');
    expect(mutations).toEqual([]);
  });

  it.each(DESTRUCTIVE_OPS)('%s rejects a falsy or truthy-but-not-true confirm', (op) => {
    const { dispatch, mutations } = setup();
    for (const confirm of [false, 'true', 1, null, undefined, {}]) {
      // Strictly `true` — a stray truthy value must not be mistaken for intent.
      expect(codeOf(() => dispatch(op, { ...DESTRUCTIVE_ARGS[op], confirm }))).toBe('needs-confirmation');
    }
    expect(mutations).toEqual([]);
  });
});

describe('destructive ops with confirm: true', () => {
  it.each(DESTRUCTIVE_OPS)('%s proceeds to the provider', (op) => {
    const { dispatch, mutations } = setup();
    dispatch(op, { ...DESTRUCTIVE_ARGS[op], confirm: true });
    expect(mutations).toHaveLength(1);
  });
});

describe('the gate applies only to destructive ops', () => {
  const NON_DESTRUCTIVE: readonly McpOp[] = [...READ_OPS, ...ADDITIVE_WRITE_OPS];

  it('additive writes and reads never require confirmation', () => {
    const { dispatch } = setup();
    const args: Record<McpOp, unknown> = {
      dashboard: {}, heroDetail: { hero: 'Tracer' }, matchDetail: { matchId: MATCH_ID },
      playerHistory: { name: 'A#1' }, ranks: {}, masterData: {}, status: {},
      logMatch: { input: { result: 'Win', role: 'damage', map: 'A', gameType: 'Competitive' } },
      editMatch: { input: { matchId: MATCH_ID } },
      saveReview: { input: { matchId: MATCH_ID, grades: {}, flags: {} } },
      saveTarget: { input: { name: 'n', mode: 'manual', rule: 'r' } },
      updateTarget: { input: { id: TARGET_ID, name: 'n', mode: 'manual', rule: 'r' } },
      setTargetActive: { id: TARGET_ID, active: true },
      setTargetArchived: { id: TARGET_ID, archived: true },
      resolvePending: { matchId: PENDING_ID, result: 'Win' },
      deleteTarget: {}, dismissPending: {}, deactivateAllTargets: {}, clearReview: {},
    };
    for (const op of NON_DESTRUCTIVE) {
      expect(codeOf(() => dispatch(op, args[op]))).not.toBe('needs-confirmation');
    }
  });
});
