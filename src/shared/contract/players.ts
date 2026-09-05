/**
 * The Players screen payloads — the filter-scoped directory of everyone the
 * tracked player has met, derived at query time from the rosters already stored
 * on match history. Local, GEP-only, never exported (guardrail 5).
 */
import type { DashboardFilters } from './dashboard';

/**
 * Sortable column. These values ARE the renderer's table column keys, so there
 * is no translation table to drift out of step.
 */
export type PlayerSortKey = 'name' | 'games' | 'with' | 'vs' | 'lastSeen';

/** One row of the Players list. */
export interface PlayerListRow {
  /** Normalized identity (the part before `#`, lowercased) — the merge key. */
  key: string;
  /** Best display name (prefers the FIRST `#`-tagged BattleTag seen). */
  name: string;
  /** Shared games inside the filter scope; each game counted once. */
  games: number;
  /** W/L where they were on YOUR team (team relation known). */
  sameTeam: { wins: number; losses: number };
  /** W/L where they were on the ENEMY team (team relation known). */
  enemyTeam: { wins: number; losses: number };
  lastSeen: number;
  /**
   * Two DIFFERENT `#`-tags were folded into this row. Identity is keyed on the
   * part before `#`, so `Nova#1111` and `Nova#2222` merge — this flag says the
   * merge is actually showing, i.e. the row may be more than one person.
   */
  ambiguous: boolean;
}

export interface PlayerListQuery {
  filters: DashboardFilters;
  search?: string;
  /** Minimum shared games in scope (the chip floor). */
  minGames?: number;
  sort?: PlayerSortKey;
  /** 1 = ascending (↑), -1 = descending (↓) — matches the table's indicator. */
  dir?: 1 | -1;
}

export interface PlayerList {
  /** Capped and already ordered by main — the renderer must NOT re-sort these. */
  rows: PlayerListRow[];
  /** Players matching search + minGames in this scope, UNCAPPED. */
  matched: number;
  /** Distinct players in this scope BEFORE search + minGames. */
  totalInScope: number;
  /** The cap that produced `rows`, echoed so no caption hardcodes it. */
  cap: number;
  /** Competitive games walked in this scope, and how many carried a roster. */
  scannedGames: number;
  gamesWithRoster: number;
  /**
   * Echo of what was applied. The header arrow and every caption paint from
   * THIS, never from renderer-local state, so they cannot describe an order the
   * rows are not actually in.
   */
  sort: PlayerSortKey;
  dir: 1 | -1;
  appliedSearch: string;
  appliedMinGames: number;
  scope: Required<DashboardFilters>;
}
