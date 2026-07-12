/**
 * Account + rank DTOs of the IPC contract. Accounts are a `battleTag → label`
 * mapping (the label doubles as the in-app display name and the Notion `Account`
 * select value). Rank is tracked per (account × role, Open Queue included).
 * Electron-free so main, preload and the renderer bundle can all share it.
 */
import type { Role } from '../../core/model';
import type { AccountKind } from '../../core/accountsManage';

/**
 * One row of the account manager. Beyond the configured `battleTag → label`
 * mapping this now also carries accounts only DETECTED in history (a raw
 * BattleTag never labelled, or the `Unknown` bucket), so they can be managed:
 * `kind` discriminates them and `games` is how many stored matches are
 * attributed to the account.
 */
export interface AccountSummary {
  battleTag: string;
  label: string;
  kind: AccountKind;
  games: number;
}

/**
 * Pushed to the renderer (via `onGameLogged`) whenever a competitive match is
 * newly recorded (live or hand-logged). Carries the account it landed on and
 * whether that account maps to a configured/known account, so the renderer can
 * auto-switch the dashboard's account filter onto it.
 */
export interface GameLoggedPayload {
  matchId: string;
  account: string;
  /** True when {@link account} maps to a configured/known account. */
  configured: boolean;
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
   * 0..100 within the division; can go negative while `protected` is true — the
   * rank-protection buffer's carry, mirroring the live client's own negative display.
   */
  progressPct: number;
  /** Holding the division after a loss that would have dropped it (rank protection). */
  protected: boolean;
}
