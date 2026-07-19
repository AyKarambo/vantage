import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer } from '../src/mcp/server';
import { registerReadTools } from '../src/mcp/readTools';
import { registerWriteTools } from '../src/mcp/writeTools';
import type { PipeClient } from '../src/mcp/pipeClient';
import { createDispatcher } from '../src/main/mcp/dispatch';
import {
  ALL_OPS, READ_OPS, ADDITIVE_WRITE_OPS, DESTRUCTIVE_OPS,
  isMcpOp, isReadOp, isWriteOp, isDestructiveOp, type McpOp,
} from '../src/shared/mcp/ops';
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
 * The boundary audit. The spec puts a lot of the app deliberately OUT of scope
 * — Notion and every other outbound path, the Notion token, the Overwolf dev
 * key, app settings, the data folder, account deletion, log export. Prose in an
 * issue does not enforce that; this file does.
 *
 * It fails loudly if someone later adds an op or a tool that crosses the line,
 * which is the point: the surface should only ever grow on purpose.
 */

const MATCH_ID = 'm-1';
const TARGET_ID = 't-1';
const PENDING_ID = 'p-1';

/** Valid arguments for every op, so each one genuinely executes. */
const ARGS: Record<McpOp, unknown> = {
  dashboard: {},
  heroDetail: { hero: 'Tracer' },
  matchDetail: { matchId: MATCH_ID },
  playerHistory: { name: 'Ana#1234' },
  ranks: {},
  masterData: {},
  status: {},
  logMatch: { input: { result: 'Win', role: 'damage', map: 'A', gameType: 'Competitive' } },
  editMatch: { input: { matchId: MATCH_ID } },
  saveReview: { input: { matchId: MATCH_ID, grades: {}, flags: {} } },
  saveTarget: { input: { name: 'n', mode: 'self', rule: 'r' } },
  updateTarget: { input: { id: TARGET_ID, name: 'n', mode: 'self', rule: 'r' } },
  setTargetActive: { id: TARGET_ID, active: true },
  setTargetArchived: { id: TARGET_ID, archived: true },
  resolvePending: { matchId: PENDING_ID, result: 'Win' },
  deleteTarget: { id: TARGET_ID, confirm: true },
  dismissPending: { matchId: PENDING_ID, confirm: true },
  deactivateAllTargets: { confirm: true },
  clearReview: { matchId: MATCH_ID, confirm: true },
};

/**
 * Every DataProvider method the MCP surface must never reach. Touching one is a
 * scope breach, so each throws a marker the test can recognise.
 */
const FORBIDDEN = [
  // Outbound / Notion (guardrail 5)
  'exportToNotion', 'notionStatus', 'setNotionToken', 'clearNotionToken', 'listNotionDatabases',
  'listNotionPages', 'selectNotionDatabase', 'createNotionDatabase', 'importNotion',
  'deleteImportedMatches', 'cleanupNotionDuplicates',
  // Secrets + settings
  'setDevKey', 'getAppSettings', 'setAppSettings', 'getLogEntries', 'getLogLevel', 'setLogLevel',
  'exportLogBundle', 'logRendererError',
  // Data location / file import
  'getDataLocation', 'chooseDataFolder', 'setDataFolder', 'chooseFirstRunDataFolder',
  'importFromFile', 'deleteFileImports', 'fileImportedCount',
  // Accounts (deletion is irreversible) + master-data mutation + bulk review import
  'listAccounts', 'saveAccount', 'deleteAccount', 'deleteDetectedAccount', 'setRankAnchor',
  'importReviews', 'masterDataUpsertHero', 'masterDataRemoveHero', 'masterDataUpsertMap',
  'masterDataRemoveMap', 'masterDataUpsertSeason', 'masterDataRemoveSeason',
  'masterDataFetchUpdate', 'masterDataApplyUpdate',
  // Process control
  'applyGepUpdate', 'openExternal',
] as const;

const BREACH = 'SCOPE-BREACH';

function auditProvider(): DataProvider {
  const games: GameRecord[] = [{
    matchId: MATCH_ID, timestamp: Date.parse('2026-06-01T12:00:00Z'), account: 'Karambo',
    gameType: 'Competitive', heroes: ['Tracer'], result: 'Win', map: 'A', role: 'damage',
  }];
  const provider: Record<string, unknown> = {
    games: () => games,
    pendingMatches: (): PendingMatch[] => [{
      matchId: PENDING_ID, map: 'A', heroes: ['Tracer'], role: 'damage',
      account: 'Karambo', timestamp: Date.parse('2026-06-02T12:00:00Z'), rosterCount: 10,
    }],
    manualTargets: (): AuthoredTarget[] => [
      { id: TARGET_ID, name: 'Use cover', mode: 'self', rule: 'r' },
    ],
    demoContext: () => ({ active: false, preference: 'off', hasRealHistory: true }),
    effectiveMasterData: () => DEFAULT_MASTER_DATA,
    getBreakReminder: () => DEFAULT_BREAK_REMINDER,
    getStaleness: () => DEFAULT_STALENESS,
    getReadiness: () => DEFAULT_READINESS,
    getSessionSettings: () => DEFAULT_SESSION_SETTINGS,
    getGrading: () => DEFAULT_GRADING_SETTINGS,
    rankAnchorMap: () => ({}),
    isSample: () => false,
    getRanks: () => [],
    getGepStatus: () => ({ state: 'idle' }),
    getDevModeAuthStatus: () => ({ outcome: 'not-attempted' }),
    getAppInfo: () => ({ version: 'test' }),
    mostPlayedHeroes: () => ({}),
    // permitted writes
    logMatch: () => ({ matchId: 'new-1' }),
    editMatch: () => undefined,
    saveReview: () => undefined,
    clearReview: () => undefined,
    saveTarget: () => undefined,
    updateTarget: () => undefined,
    setTargetActive: () => undefined,
    setTargetArchived: () => undefined,
    deleteTarget: () => undefined,
    deactivateAllTargets: () => undefined,
    resolvePendingMatch: () => undefined,
    dismissPendingMatch: () => undefined,
  };
  for (const name of FORBIDDEN) {
    provider[name] = () => { throw new Error(`${BREACH}: ${name}`); };
  }
  return provider as unknown as DataProvider;
}

describe('the op contract is a clean partition', () => {
  it('splits into reads, additive writes and destructive writes with no overlap', () => {
    const all = [...READ_OPS, ...ADDITIVE_WRITE_OPS, ...DESTRUCTIVE_OPS];
    expect(new Set(all).size).toBe(all.length); // no duplicates
    expect(new Set(ALL_OPS)).toEqual(new Set(all));
  });

  it('classifies every op consistently', () => {
    for (const op of ALL_OPS) {
      expect(isMcpOp(op)).toBe(true);
      expect(isReadOp(op)).toBe(!isWriteOp(op));
      if (isDestructiveOp(op)) expect(isWriteOp(op)).toBe(true);
    }
    expect(READ_OPS.every((o) => isReadOp(o))).toBe(true);
    expect(DESTRUCTIVE_OPS.every((o) => isDestructiveOp(o))).toBe(true);
    expect(ADDITIVE_WRITE_OPS.some((o) => isDestructiveOp(o))).toBe(false);
  });

  it('rejects anything not in the contract', () => {
    for (const op of ['exportNotion', 'setNotionToken', 'setDevKey', 'setDataFolder', '__proto__', '']) {
      expect(isMcpOp(op)).toBe(false);
    }
  });
});

describe('no op reaches an out-of-scope capability', () => {
  it.each(ALL_OPS)('%s touches no forbidden DataProvider method', (op) => {
    const dispatch = createDispatcher(auditProvider());
    // The op may legitimately fail (not-found, validation); it may never fail
    // by having reached something the spec put out of scope.
    try {
      dispatch(op, ARGS[op]);
    } catch (err) {
      expect(String(err)).not.toContain(BREACH);
    }
  });

  it('has no op named after an out-of-scope capability', () => {
    const banned = ['notion', 'token', 'devkey', 'datafolder', 'account', 'logbundle', 'export', 'import'];
    for (const op of ALL_OPS) {
      for (const word of banned) {
        expect(op.toLowerCase(), `op \`${op}\``).not.toContain(word);
      }
    }
  });
});

describe('the advertised MCP surface matches the contract exactly', () => {
  async function tools(): Promise<{ name: string }[]> {
    const client: PipeClient = { call: (async () => null) as PipeClient['call'] };
    const server = buildServer(client, [registerReadTools, registerWriteTools]);
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const mcp = new Client({ name: 'audit', version: '1.0.0' });
    await Promise.all([mcp.connect(ct), server.connect(st)]);
    return (await mcp.listTools()).tools;
  }

  it('exposes exactly one tool per op — no orphans in either direction', async () => {
    const names = (await tools()).map((t) => t.name);
    expect(names).toHaveLength(ALL_OPS.length);
    // An op added to the contract but never surfaced is as much a bug as a
    // tool with no op behind it; this catches both.
    expect(new Set(names).size).toBe(names.length);
  });

  it('namespaces every tool under vantage_', async () => {
    for (const t of await tools()) expect(t.name).toMatch(/^vantage_[a-z_]+$/);
  });

  it('advertises no tool for an out-of-scope capability', async () => {
    const names = (await tools()).map((t) => t.name.toLowerCase());
    // Precise fragments, not loose ones: a bare 'log' would flag
    // vantage_log_match, which is in scope — the out-of-scope thing is the
    // debug-log surface (log bundle/level/entries), not logging a match.
    const banned = [
      'notion', 'token', 'dev_key', 'data_folder', 'delete_account',
      'log_bundle', 'log_level', 'log_entries', 'export', 'import',
    ];
    for (const word of banned) {
      expect(names.filter((n) => n.includes(word)), word).toEqual([]);
    }
  });
});
