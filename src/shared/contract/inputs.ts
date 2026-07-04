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
  /** Manual after-game flags (tilt / comms / etc.), if the player added any. */
  mental?: MatchMental;
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
