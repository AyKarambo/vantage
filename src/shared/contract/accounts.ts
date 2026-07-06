/**
 * Account + rank DTOs of the IPC contract. Accounts are a `battleTag → label`
 * mapping (the label doubles as the in-app display name and the Notion `Account`
 * select value). Rank is tracked per (account × role, Open Queue included).
 * Electron-free so main, preload and the renderer bundle can all share it.
 */
import type { Role } from '../../core/model';

/** One tracked account. */
export interface AccountSummary {
  battleTag: string;
  label: string;
}

/** Create or edit an account. `previousBattleTag` renames the key (removes the old entry). */
export interface AccountInput {
  battleTag: string;
  label: string;
  previousBattleTag?: string;
}

/** Set (or replace) the one-time rank anchor for an (account, role). */
export interface RankAnchorInput {
  account: string;
  role: Role;
  tier: string;
  division: number;
  progressPct: number;
}

/** The computed live rank for one anchored (account, role). */
export interface RankSummary {
  account: string;
  role: Role;
  tier: string;
  division: number;
  /**
   * Meaningless while `needsReanchor` is true (the % is unknown post-demotion). Can be
   * negative while `protected` is true — the rank-protection buffer's carry, mirroring
   * the live client's own negative display.
   */
  progressPct: number;
  /** Holding the division after a loss that would have dropped it (rank protection). */
  protected: boolean;
  /** A protected loss demoted; the new intra-division % awaits the next log/edit. */
  needsReanchor: boolean;
}
