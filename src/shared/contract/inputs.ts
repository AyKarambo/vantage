/**
 * Manual-entry inputs of the IPC contract: everything the player authors by
 * hand (logged matches, improvement targets, reviews) that crosses the bridge
 * inbound. Electron-free so main, preload and the renderer bundle can all
 * share it.
 */
import type { Role, Result } from '../../core/model';
import type { MatchMental, TargetGrade } from '../../core/analytics';
import type { TargetMode } from '../../core/targets';

/** A manually-logged match, captured in the Log Match card. */
export interface ManualMatchInput {
  result: Result;
  role: Role;
  map: string;
  hero?: string;
  gameType: string;
  /** Manual after-game flags (tilt / comms / leaver-team / etc.), if any. */
  mental?: MatchMental;
  /** Which account this was played on; falls back to the first configured account. */
  account?: string;
  /** Signed skill-rating % for this competitive match (e.g. +22, -19). */
  srDelta?: number;
  /** Optional target grades captured inline while logging. */
  grades?: Record<string, TargetGrade>;
}

/**
 * An edit to a stored match's manual layer, from the Matches drill-down. Only
 * provided fields change. The game-derived facts (result/role/map/hero/gameType)
 * are honoured for hand-logged matches and ignored for auto-tracked ones (their
 * facts stay locked); mental / srDelta / grades apply to any match.
 */
export interface MatchEditInput {
  matchId: string;
  result?: Result;
  role?: Role;
  map?: string;
  /** Single hero; '' clears the hero list. Hand-logged only. */
  hero?: string;
  gameType?: string;
  mental?: MatchMental;
  srDelta?: number;
  grades?: Record<string, TargetGrade>;
}

/** A new improvement target authored in the Targets builder. */
export interface AuthoredTargetInput {
  name: string;
  mode: TargetMode;
  rule: string;
}

/** An edit to an existing target — lifecycle state and accrued grades are kept. */
export interface TargetEditInput {
  id: string;
  name: string;
  mode: TargetMode;
  rule: string;
}

/** A Review-screen read (target grades + feel flags) for one tracked match. */
export interface ReviewInput {
  matchId: string;
  grades: Record<string, TargetGrade>;
  flags: MatchMental;
}
