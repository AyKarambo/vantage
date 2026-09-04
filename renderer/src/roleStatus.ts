/**
 * The one-line status for a single (account, role) track — whichever of "no
 * rank yet", "ranked", or "in placements" applies. Shared by Settings →
 * Accounts (one row per role, with action buttons) and the account-switcher
 * popover (a compact per-role listing, read-only) so the "which state wins"
 * branching lives in exactly one place instead of being copied per surface.
 */
import type { PlacementRunSummary, RankSummary, Role } from '../../src/shared/contract';
import { placementParts, rankParts } from '../../src/core/rankDisplay';

export type RoleStatusTone = 'rank' | 'placed' | 'placement' | 'empty';

export interface RoleStatus {
  text: string;
  /**
   * 'rank' — an ordinary calculated rank. 'placed' — same, but this track's
   * anchor came from a COMPLETED placement run (callers may want to note that
   * without hiding the rank itself, unlike the old static "Placements complete"
   * text). 'placement' — an OPEN run, counting or awaiting. 'empty' — neither.
   */
  tone: RoleStatusTone;
}

/**
 * `run` is only ever passed OPEN (`!run.completed`) — a completed run's story is
 * already told by `rank` (the anchor it wrote), so the caller filters it out
 * before calling this, exactly as the old `ranksLine`/`placementRow` split did.
 */
export function roleStatus(
  rank: Pick<RankSummary, 'tier' | 'division' | 'progressPct' | 'protected'> | undefined,
  openRun: Pick<PlacementRunSummary, 'counted' | 'target' | 'latestPrediction' | 'awaitingRank'> | undefined,
  wasPlaced = false,
): RoleStatus {
  if (openRun) {
    const pp = placementParts(openRun.counted, openRun.target, openRun.latestPrediction, openRun.awaitingRank);
    const suffix = pp.predictionLabel ?? pp.awaitingLabel;
    return { text: suffix ? `${pp.counter} · ${suffix}` : pp.counter, tone: 'placement' };
  }
  if (rank) {
    const p = rankParts(rank);
    return { text: `${p.rankLabel} · ${p.bufferPctText}${p.shield ? ' 🛡' : ''}`, tone: wasPlaced ? 'placed' : 'rank' };
  }
  return { text: 'No rank yet', tone: 'empty' };
}

/**
 * The fixed order every per-role listing walks — queue order as the game shows
 * it, Open Queue last. Settings → Accounts uses it both for the compact
 * per-account summary and for the manage-ranks modal's four rows.
 */
export const ROLE_ORDER: readonly Role[] = ['tank', 'damage', 'support', 'openQ'];

/**
 * Two-to-four-letter role tags for the compact per-account summary, where a
 * full "Support" or "Open Queue" beside a rank and a % would push a four-role
 * account onto a third line.
 */
export const ROLE_SHORT: Readonly<Record<Role, string>> = { tank: 'Tank', damage: 'Dmg', support: 'Sup', openQ: 'OQ' };

/**
 * Tier names too long for a chip. Only these three are shortened — the rest
 * (Bronze … Master) already fit, and abbreviating "Diamond" to "Dia" reads
 * worse than the space it saves.
 */
const TIER_SHORT: Readonly<Record<string, string>> = { Platinum: 'Plat', Grandmaster: 'GM', Champion: 'Champ' };

/** "Grandmaster" → "GM"; unmapped tiers pass through unchanged. */
export const tierShort = (tier: string): string => TIER_SHORT[tier] ?? tier;

/** One chip of {@link accountRoleSummary}. */
export interface RoleSummaryChip {
  role: Role;
  /** e.g. `Dmg · GM 4 · 16%`, `Sup · Placements 3/10`, `Tank · Placements 10/10 · confirm rank`. */
  text: string;
  tone: RoleStatusTone;
}

/**
 * The compact per-role summary the accounts list shows for one account — one
 * chip per role the account TRACKS (a rank anchor and/or a placement run), in
 * {@link ROLE_ORDER}. Untracked roles produce nothing: the list is a glance,
 * and padding a one-role account with three "no rank yet" chips would say
 * less, not more. An empty result means "no rank set yet" for the account.
 *
 * Deliberately terser than {@link roleStatus}: a run's prediction is dropped
 * (only the counter, plus "confirm rank" once it is waiting on the player)
 * and long tier names are shortened via {@link tierShort}. The full text
 * lives in the manage-ranks modal, one click away.
 *
 * Takes any mix of accounts and filters by `account` itself, so a caller can
 * hand it the whole `getRanks()` / `getPlacements()` result.
 */
export function accountRoleSummary(
  account: string,
  ranks: readonly Pick<RankSummary, 'account' | 'role' | 'tier' | 'division' | 'progressPct' | 'protected'>[],
  placements: readonly Pick<PlacementRunSummary, 'account' | 'role' | 'counted' | 'target' | 'completed' | 'awaitingRank'>[],
): RoleSummaryChip[] {
  const chips: RoleSummaryChip[] = [];
  for (const role of ROLE_ORDER) {
    const rank = ranks.find((r) => r.account === account && r.role === role);
    const run = placements.find((p) => p.account === account && p.role === role);
    const openRun = run && !run.completed ? run : undefined;
    if (openRun) {
      const counter = `Placements ${openRun.counted}/${openRun.target}`;
      const text = openRun.awaitingRank ? `${counter} · confirm rank` : counter;
      chips.push({ role, text: `${ROLE_SHORT[role]} · ${text}`, tone: 'placement' });
      continue;
    }
    if (rank) {
      const p = rankParts(rank);
      const label = `${tierShort(rank.tier)} ${rank.division} · ${p.bufferPctText}${p.shield ? ' 🛡' : ''}`;
      chips.push({ role, text: `${ROLE_SHORT[role]} · ${label}`, tone: run?.completed ? 'placed' : 'rank' });
    }
    // Neither: untracked, no chip.
  }
  return chips;
}
