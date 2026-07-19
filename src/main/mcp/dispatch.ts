import type { DataProvider } from '../dashboard/provider';
import { dashboardRead, heroDetailRead, matchDetailRead, playerHistoryRead } from '../dashboard/reads';
import type { McpOp, McpOpMap, McpErrorCode, ReadEnvelope } from '../../shared/mcp/ops';
import type { DashboardFilters, ManualMatchInput, MatchEditInput, ReviewInput, AuthoredTargetInput, TargetEditInput } from '../../shared/contract';
import type { Result, Role } from '../../core/model';

/**
 * The op table: the ONLY thing the MCP bridge can make the app do.
 *
 * Every entry routes to the same `reads.ts` compositions and `DataProvider`
 * methods the renderer uses — there is no second data path and no second
 * writer. An operation that isn't in this table cannot be performed, which is
 * what makes the out-of-scope list (Notion, tokens, settings, data folder,
 * account deletion, log export) enforceable rather than merely documented.
 */

/** A failure with a classified code; the pipe server maps it to an McpResponse. */
export class McpOpError extends Error {
  constructor(readonly code: McpErrorCode, message: string) {
    super(message);
    this.name = 'McpOpError';
  }
}

const RESULTS: ReadonlySet<string> = new Set<Result>(['Win', 'Loss', 'Draw']);
const ROLES: ReadonlySet<string> = new Set<Role>(['damage', 'tank', 'support', 'openQ']);

function asObject(value: unknown, what: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new McpOpError('invalid-input', `${what} must be an object`);
  }
  return value as Record<string, unknown>;
}

function reqString(o: Record<string, unknown>, key: string): string {
  const v = o[key];
  if (typeof v !== 'string' || !v.trim()) {
    throw new McpOpError('invalid-input', `\`${key}\` must be a non-empty string`);
  }
  return v;
}

function reqBool(o: Record<string, unknown>, key: string): boolean {
  const v = o[key];
  if (typeof v !== 'boolean') throw new McpOpError('invalid-input', `\`${key}\` must be a boolean`);
  return v;
}

/** Filters are optional and pass through to the same resolver the UI uses. */
function optFilters(o: Record<string, unknown>): DashboardFilters | undefined {
  const v = o.filters;
  if (v === undefined || v === null) return undefined;
  return asObject(v, '`filters`') as DashboardFilters;
}

function reqResult(o: Record<string, unknown>, key: string): Result {
  const v = reqString(o, key);
  if (!RESULTS.has(v)) {
    throw new McpOpError('invalid-input', `\`${key}\` must be one of Win, Loss, Draw`);
  }
  return v as Result;
}

function reqRole(o: Record<string, unknown>, key: string): Role {
  const v = reqString(o, key);
  if (!ROLES.has(v)) {
    throw new McpOpError('invalid-input', `\`${key}\` must be one of damage, tank, support, openQ`);
  }
  return v as Role;
}

/** The `input` sub-object carried by the write ops. */
function reqInput(args: unknown): Record<string, unknown> {
  return asObject(asObject(args, 'arguments').input, '`input`');
}

export interface Dispatcher {
  (op: McpOp, args: unknown): unknown;
}

export function createDispatcher(provider: DataProvider): Dispatcher {
  /** Demo/sample state travels with every read (AC 6). */
  const wrap = <T>(data: T): ReadEnvelope<T> => ({ demo: provider.demoContext().active, data });

  /**
   * Resolve a match id against stored history. The provider's own `editMatch`
   * silently no-ops on an unknown id (dataProvider.ts) — fine for a UI that can
   * only offer real rows, wrong for a model that can invent one. Checking here
   * turns "nothing happened" into an honest `not-found`.
   */
  const assertMatch = (matchId: string): void => {
    if (!provider.games().some((g) => g.matchId === matchId)) {
      throw new McpOpError('not-found', `no stored match with id \`${matchId}\``);
    }
  };

  const assertPending = (matchId: string): void => {
    if (!provider.pendingMatches().some((m) => m.matchId === matchId)) {
      throw new McpOpError('not-found', `no pending ("needs result") match with id \`${matchId}\``);
    }
  };

  const assertTarget = (id: string): void => {
    if (!provider.manualTargets().some((t) => t.id === id)) {
      throw new McpOpError('not-found', `no target with id \`${id}\``);
    }
  };

  const handlers: { [K in McpOp]: (args: unknown) => McpOpMap[K]['result'] } = {
    // ---- reads ----
    dashboard: (args) => wrap(dashboardRead(provider, optFilters(asObject(args, 'arguments')))),
    heroDetail: (args) => {
      const a = asObject(args, 'arguments');
      return wrap(heroDetailRead(provider, reqString(a, 'hero'), optFilters(a)));
    },
    matchDetail: (args) => {
      const a = asObject(args, 'arguments');
      return wrap(matchDetailRead(provider, reqString(a, 'matchId'), optFilters(a)));
    },
    playerHistory: (args) => wrap(playerHistoryRead(provider, reqString(asObject(args, 'arguments'), 'name'))),
    ranks: () => wrap(provider.getRanks()),
    masterData: () => wrap(provider.effectiveMasterData()),
    status: () => wrap(provider.getGepStatus()),

    // ---- additive writes ----
    logMatch: (args) => {
      const i = reqInput(args);
      // Validate the facts that make a match a match; everything optional
      // (mental, srDelta, performance, playedAt) is left to the same coercion
      // the Log Match card goes through, including the playedAt past-clamp.
      const input: ManualMatchInput = {
        ...(i as unknown as ManualMatchInput),
        result: reqResult(i, 'result'),
        role: reqRole(i, 'role'),
        map: reqString(i, 'map'),
        gameType: reqString(i, 'gameType'),
      };
      return provider.logMatch(input);
    },
    editMatch: (args) => {
      const i = reqInput(args);
      const matchId = reqString(i, 'matchId');
      assertMatch(matchId);
      if (i.result !== undefined) reqResult(i, 'result');
      if (i.role !== undefined) reqRole(i, 'role');
      provider.editMatch(i as unknown as MatchEditInput);
      return null;
    },
    saveReview: (args) => {
      const i = reqInput(args);
      const matchId = reqString(i, 'matchId');
      assertMatch(matchId);
      provider.saveReview(i as unknown as ReviewInput);
      return null;
    },
    saveTarget: (args) => {
      const i = reqInput(args);
      reqString(i, 'name');
      reqString(i, 'mode');
      reqString(i, 'rule');
      provider.saveTarget(i as unknown as AuthoredTargetInput);
      return null;
    },
    updateTarget: (args) => {
      const i = reqInput(args);
      const id = reqString(i, 'id');
      assertTarget(id);
      reqString(i, 'name');
      reqString(i, 'mode');
      reqString(i, 'rule');
      provider.updateTarget(i as unknown as TargetEditInput);
      return null;
    },
    setTargetActive: (args) => {
      const a = asObject(args, 'arguments');
      const id = reqString(a, 'id');
      assertTarget(id);
      provider.setTargetActive(id, reqBool(a, 'active'));
      return null;
    },
    setTargetArchived: (args) => {
      const a = asObject(args, 'arguments');
      const id = reqString(a, 'id');
      assertTarget(id);
      provider.setTargetArchived(id, reqBool(a, 'archived'));
      return null;
    },
    resolvePending: (args) => {
      const a = asObject(args, 'arguments');
      const matchId = reqString(a, 'matchId');
      assertPending(matchId);
      provider.resolvePendingMatch(matchId, reqResult(a, 'result'));
      return null;
    },

    // ---- destructive writes (the confirmation gate wraps these) ----
    deleteTarget: (args) => {
      const id = reqString(asObject(args, 'arguments'), 'id');
      assertTarget(id);
      provider.deleteTarget(id);
      return null;
    },
    dismissPending: (args) => {
      const matchId = reqString(asObject(args, 'arguments'), 'matchId');
      assertPending(matchId);
      provider.dismissPendingMatch(matchId);
      return null;
    },
    deactivateAllTargets: () => {
      provider.deactivateAllTargets();
      return null;
    },
    clearReview: (args) => {
      const matchId = reqString(asObject(args, 'arguments'), 'matchId');
      assertMatch(matchId);
      provider.clearReview(matchId);
      return null;
    },
  };

  return (op, args) => handlers[op](args);
}
