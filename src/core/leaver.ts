import type { MatchMental } from './analytics';

/** Normalised leaver read: which team(s) had a player leave. */
export interface LeaverFlags {
  myTeam: boolean;
  enemyTeam: boolean;
}

/**
 * Resolve the team-specific leaver flags from a mental self-report, folding the
 * legacy single `leaver` boolean into a my-team leaver (that's how it was
 * historically logged). Pure and I/O-free.
 */
export function leaverFlags(mental?: MatchMental | null): LeaverFlags {
  if (!mental) return { myTeam: false, enemyTeam: false };
  const legacy = Boolean(mental.leaver);
  return {
    myTeam: Boolean(mental.leaverMyTeam) || legacy,
    enemyTeam: Boolean(mental.leaverEnemyTeam),
  };
}

/** True when either team had a leaver (across the merged sources). */
export function hasLeaver(mental?: MatchMental | null): boolean {
  const f = leaverFlags(mental);
  return f.myTeam || f.enemyTeam;
}

/** OR-merge two leaver reads (e.g. the quick-log flags and the Review flags). */
export function mergeLeaver(a: LeaverFlags, b: LeaverFlags): LeaverFlags {
  return { myTeam: a.myTeam || b.myTeam, enemyTeam: a.enemyTeam || b.enemyTeam };
}
