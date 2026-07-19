import { describe, it, expect } from 'vitest';
import { createDispatcher, McpOpError } from '../src/main/mcp/dispatch';
import { READ_OPS, ADDITIVE_WRITE_OPS, DESTRUCTIVE_OPS, type McpOp } from '../src/shared/mcp/ops';
import type { DataProvider } from '../src/main/dashboard/provider';
import { DEFAULT_MASTER_DATA } from '../src/core/masterData';
import { DEFAULT_BREAK_REMINDER } from '../src/core/breakReminder';
import { DEFAULT_STALENESS } from '../src/core/staleness';
import { DEFAULT_READINESS } from '../src/core/readiness';
import { DEFAULT_SESSION_SETTINGS } from '../src/core/sessionSettings';
import { DEFAULT_GRADING_SETTINGS } from '../src/core/gradingSettings';

/**
 * Demo mode serves generated sample matches. A coach must be able to READ them
 * (clearly flagged), but must never WRITE against them — that would mix real
 * authored data into a fabricated season. AC 6 + AC 11.
 *
 * The write list is derived from the op contract rather than hand-listed, so a
 * future op added to ADDITIVE_WRITE_OPS/DESTRUCTIVE_OPS is covered here the day
 * it is added instead of quietly bypassing the guard.
 */

/** Provider that fails loudly if any mutating method is reached. */
function provider(demo: boolean): { p: DataProvider; mutations: string[] } {
  const mutations: string[] = [];
  const forbid = (name: string) => () => { mutations.push(name); return undefined as never; };
  const partial: Partial<DataProvider> = {
    games: () => [],
    pendingMatches: () => [],
    manualTargets: () => [],
    demoContext: () => ({ active: demo, preference: demo ? 'on' : 'off', hasRealHistory: !demo }),
    effectiveMasterData: () => DEFAULT_MASTER_DATA,
    getBreakReminder: () => DEFAULT_BREAK_REMINDER,
    getStaleness: () => DEFAULT_STALENESS,
    getReadiness: () => DEFAULT_READINESS,
    getSessionSettings: () => DEFAULT_SESSION_SETTINGS,
    getGrading: () => DEFAULT_GRADING_SETTINGS,
    rankAnchorMap: () => ({}),
    getRanks: () => [],
    getGepStatus: () => ({ state: 'idle' }) as never,
    logMatch: forbid('logMatch') as never,
    editMatch: forbid('editMatch'),
    saveReview: forbid('saveReview'),
    clearReview: forbid('clearReview'),
    saveTarget: forbid('saveTarget'),
    updateTarget: forbid('updateTarget'),
    setTargetActive: forbid('setTargetActive'),
    setTargetArchived: forbid('setTargetArchived'),
    deleteTarget: forbid('deleteTarget'),
    deactivateAllTargets: forbid('deactivateAllTargets'),
    resolvePendingMatch: forbid('resolvePendingMatch'),
    dismissPendingMatch: forbid('dismissPendingMatch'),
  };
  return { p: partial as DataProvider, mutations };
}

/** Minimal well-formed args per op, so a refusal can't be confused with a validation error. */
const ARGS: Record<McpOp, unknown> = {
  dashboard: {},
  heroDetail: { hero: 'Tracer' },
  matchDetail: { matchId: 'm-1' },
  playerHistory: { name: 'A#1' },
  ranks: {},
  masterData: {},
  status: {},
  logMatch: { input: { result: 'Win', role: 'damage', map: 'A', gameType: 'Competitive' } },
  editMatch: { input: { matchId: 'm-1' } },
  saveReview: { input: { matchId: 'm-1', grades: {}, flags: {} } },
  saveTarget: { input: { name: 'n', mode: 'manual', rule: 'r' } },
  updateTarget: { input: { id: 't-1', name: 'n', mode: 'manual', rule: 'r' } },
  setTargetActive: { id: 't-1', active: true },
  setTargetArchived: { id: 't-1', archived: true },
  resolvePending: { matchId: 'p-1', result: 'Win' },
  deleteTarget: { id: 't-1' },
  dismissPending: { matchId: 'p-1' },
  deactivateAllTargets: {},
  clearReview: { matchId: 'm-1' },
};

const WRITE_OPS: readonly McpOp[] = [...ADDITIVE_WRITE_OPS, ...DESTRUCTIVE_OPS];

describe('demo mode refuses every write', () => {
  it.each(WRITE_OPS)('%s is refused with demo-mode and mutates nothing', (op) => {
    const { p, mutations } = provider(true);
    const dispatch = createDispatcher(p);
    let code: string | undefined;
    try { dispatch(op, ARGS[op]); } catch (err) {
      code = err instanceof McpOpError ? err.code : 'not-an-McpOpError';
    }
    expect(code).toBe('demo-mode');
    expect(mutations).toEqual([]);
  });

  it('refuses before validation, so a bad payload still reports demo-mode', () => {
    // The user's actionable problem is "demo is on", not "your argument was
    // malformed" — reporting the latter would send the model down a dead end.
    const { p } = provider(true);
    let code: string | undefined;
    try { createDispatcher(p)('logMatch', { input: {} }); } catch (err) {
      code = err instanceof McpOpError ? err.code : undefined;
    }
    expect(code).toBe('demo-mode');
  });
});

describe('demo mode still allows reads', () => {
  it.each(READ_OPS)('%s succeeds and is flagged demo:true', (op) => {
    const { p } = provider(true);
    expect(createDispatcher(p)(op, ARGS[op])).toMatchObject({ demo: true });
  });
});

describe('with real history', () => {
  it('writes are not blocked', () => {
    const { p, mutations } = provider(false);
    const dispatch = createDispatcher(p);
    dispatch('logMatch', ARGS.logMatch);
    expect(mutations).toEqual(['logMatch']);
  });

  it('reads are flagged demo:false', () => {
    const { p } = provider(false);
    expect(createDispatcher(p)('ranks', {})).toMatchObject({ demo: false });
  });
});
