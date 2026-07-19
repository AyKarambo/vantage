import type {
  DashboardFilters, DashboardData, HeroDetail, MatchDetail, PlayerMatchHistory,
  RankSummary, MasterData, GepStatusPayload,
  ManualMatchInput, MatchEditInput, ReviewInput, AuthoredTargetInput, TargetEditInput,
} from '../contract';
import type { Result } from '../../core/model';

/**
 * The typed contract between the MCP stdio bridge and the running app, kept in
 * `shared/` for the same reason `shared/contract` exists: both sides of a
 * process boundary must agree on one definition, and neither may smuggle `any`
 * across it.
 *
 * This is deliberately NOT the MCP tool surface. Tool names, descriptions and
 * zod schemas live in the bridge (`src/mcp/`); this is the narrower wire
 * vocabulary the app is willing to answer. Keeping them separate means the MCP
 * SDK never has to be imported into the app process at all.
 */

/**
 * Every read is wrapped so the demo/sample state travels WITH the payload
 * (spec #174 AC 6). Vantage serves generated sample matches when demo mode is
 * on, and a coach reasoning over fabricated history without knowing it is a
 * trust failure, not a cosmetic one — so the flag is structural rather than
 * something a caller has to remember to ask for separately.
 */
export interface ReadEnvelope<T> {
  /** True when `data` is generated sample data, not real tracked history. */
  demo: boolean;
  data: T;
}

/** Args + result type for every op the bridge may ask the app to perform. */
export interface McpOpMap {
  // ---- reads ----
  dashboard: { args: { filters?: DashboardFilters }; result: ReadEnvelope<DashboardData> };
  heroDetail: { args: { hero: string; filters?: DashboardFilters }; result: ReadEnvelope<HeroDetail> };
  matchDetail: { args: { matchId: string; filters?: DashboardFilters }; result: ReadEnvelope<MatchDetail | null> };
  playerHistory: { args: { name: string }; result: ReadEnvelope<PlayerMatchHistory | null> };
  ranks: { args: Record<string, never>; result: ReadEnvelope<RankSummary[]> };
  masterData: { args: Record<string, never>; result: ReadEnvelope<MasterData> };
  status: { args: Record<string, never>; result: ReadEnvelope<GepStatusPayload> };

  // ---- additive writes (manual/authored layer only) ----
  logMatch: { args: { input: ManualMatchInput }; result: { matchId: string } };
  editMatch: { args: { input: MatchEditInput }; result: null };
  saveReview: { args: { input: ReviewInput }; result: null };
  saveTarget: { args: { input: AuthoredTargetInput }; result: null };
  updateTarget: { args: { input: TargetEditInput }; result: null };
  setTargetActive: { args: { id: string; active: boolean }; result: null };
  setTargetArchived: { args: { id: string; archived: boolean }; result: null };
  resolvePending: { args: { matchId: string; result: Result }; result: null };

  // ---- destructive writes (confirmation-gated) ----
  deleteTarget: { args: { id: string }; result: null };
  dismissPending: { args: { matchId: string }; result: null };
  deactivateAllTargets: { args: Record<string, never>; result: null };
  clearReview: { args: { matchId: string }; result: null };
}

export type McpOp = keyof McpOpMap;
export type McpArgs<K extends McpOp> = McpOpMap[K]['args'];
export type McpResult<K extends McpOp> = McpOpMap[K]['result'];

/** Reads: never mutate, always demo-flagged. */
export const READ_OPS = [
  'dashboard', 'heroDetail', 'matchDetail', 'playerHistory', 'ranks', 'masterData', 'status',
] as const satisfies readonly McpOp[];

/** Writes that only ever ADD or amend — safe to run without confirmation. */
export const ADDITIVE_WRITE_OPS = [
  'logMatch', 'editMatch', 'saveReview', 'saveTarget', 'updateTarget',
  'setTargetActive', 'setTargetArchived', 'resolvePending',
] as const satisfies readonly McpOp[];

/**
 * Writes that destroy or bulk-reset user data. These are the ops that must not
 * run without explicit confirmation (spec #174 AC 12).
 */
export const DESTRUCTIVE_OPS = [
  'deleteTarget', 'dismissPending', 'deactivateAllTargets', 'clearReview',
] as const satisfies readonly McpOp[];

/** Every op the bridge may issue — the exhaustive allowlist. */
export const ALL_OPS = [...READ_OPS, ...ADDITIVE_WRITE_OPS, ...DESTRUCTIVE_OPS] as const;

const READ_SET: ReadonlySet<string> = new Set(READ_OPS);
const DESTRUCTIVE_SET: ReadonlySet<string> = new Set(DESTRUCTIVE_OPS);
const ALL_SET: ReadonlySet<string> = new Set(ALL_OPS);

export function isMcpOp(op: string): op is McpOp {
  return ALL_SET.has(op);
}

export function isReadOp(op: McpOp): boolean {
  return READ_SET.has(op);
}

export function isDestructiveOp(op: McpOp): boolean {
  return DESTRUCTIVE_SET.has(op);
}

/** A write op is anything that isn't a read — the demo guard keys off this. */
export function isWriteOp(op: McpOp): boolean {
  return !READ_SET.has(op);
}

/**
 * Failure kinds the app reports back. Deliberately a closed set: the bridge
 * turns each into a specific, actionable message for the model, and an
 * unclassified failure must not read as "your input was wrong".
 */
export type McpErrorCode =
  /** The app isn't running, or the endpoint is switched off. */
  | 'not-running'
  /** Arguments failed validation — nothing was persisted. */
  | 'invalid-input'
  /** A referenced match/hero/target doesn't exist. */
  | 'not-found'
  /** A destructive op was called without explicit confirmation. */
  | 'needs-confirmation'
  /** Demo/sample data is active, so writes are refused. */
  | 'demo-mode'
  /** Anything else — an actual bug, surfaced honestly rather than as user error. */
  | 'internal';

export interface McpRequest {
  id: number;
  op: McpOp;
  args: unknown;
}

export type McpResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: { code: McpErrorCode; message: string } };

/** Build a failure response without hand-assembling the shape at each site. */
export function mcpError(id: number, code: McpErrorCode, message: string): McpResponse {
  return { id, ok: false, error: { code, message } };
}
