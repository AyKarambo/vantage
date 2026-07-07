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
  /** Legacy single hero. Superseded by {@link heroes}; still accepted. */
  hero?: string;
  /** Heroes played this match (the card allows several). Takes precedence over {@link hero}. */
  heroes?: string[];
  gameType: string;
  /** Manual after-game flags (tilt / comms / leaver-team / etc.), if any. */
  mental?: MatchMental;
  /** Which account this was played on; falls back to the first configured account. */
  account?: string;
  /** Signed skill-rating % for this competitive match (e.g. +22, -19). */
  srDelta?: number;
  /** Self-rated performance for this match, 0-100, if the player rated it. */
  performance?: number;
  /** Optional target grades captured inline while logging. */
  grades?: Record<string, TargetGrade>;
  /**
   * When the match actually ended (epoch ms) — set when backfilling a game
   * logged after the fact. Omitted = "just now". Clamped to the past by the
   * receiver so a skewed clock can never produce future-stamped history.
   */
  playedAt?: number;
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
  /** Replacement hero list. Takes precedence over {@link hero}; `[]` clears. Hand-logged only. */
  heroes?: string[];
  mental?: MatchMental;
  /** New SR %, or `null` to clear it; `undefined` leaves it unchanged. */
  srDelta?: number | null;
  /** New performance rating (0-100), or `null` to clear it; `undefined` leaves it unchanged. */
  performance?: number | null;
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
  /** Self-rated performance for this match, 0-100, if the player rated it. */
  performance?: number;
}
