/**
 * The sidebar's top-left account chip — name, avatar glyph and rank sub-line —
 * as pure text, so the "what does the corner say" rules are unit-testable
 * without a DOM and the shell only has to paint three strings.
 *
 * PINNED to an account, the chip is that account: its name, its initial, and
 * the role-prefixed rank line (`Dmg · GM 4 · 16%`). A manual choice is never
 * silently overridden.
 *
 * UNPINNED ("All accounts"), the chip used to borrow the most recently played
 * account's NAME so the corner read as "what am I doing right now" — but that
 * made the chip claim a scope it did not have: the dashboard behind it covered
 * every account while the chip named one. Now the name is the literal
 * "All accounts" under a fixed glyph that can't be misread as an initial, and
 * the sub-line ATTRIBUTES the rank to its account instead
 * (`Karambo · Dmg · GM 4 · 16%`). `primaryRank` already resolves to
 * the most recently played account (see dashboardData's mostRecentAccount), so
 * nothing is re-derived here. With no rank to attribute at all (a brand-new
 * profile) it falls back to a neutral account count rather than the winrate
 * heuristic — a heuristic over every account at once belongs to nobody.
 */
import type { PlacementRunSummary, Role } from '../../src/shared/contract';
import { rankLabel } from './format';
import { shortRankLabelOf } from '../../src/core/rankDisplay';
import { ROLE_SHORT, roleStatus } from './roleStatus';

/** The unpinned scope's headline. */
export const ALL_ACCOUNTS_LABEL = 'All accounts';
/** The unpinned avatar glyph: reads as "everything", never as somebody's initial. */
export const ALL_ACCOUNTS_GLYPH = '∗';

/** The slice of the dashboard snapshot the chip reads — structural, so tests
 *  need no full DashboardData and the shell can pass the real one unchanged. */
export interface SidebarChipInput {
  filters: { account: string };
  options: { accounts: readonly string[] };
  primaryRank?: { account: string; role: Role; tier: string; division: number; progressPct: number; protected: boolean };
  placements: readonly Pick<PlacementRunSummary, 'account' | 'role' | 'completed' | 'counted' | 'target' | 'latestPrediction' | 'awaitingRank'>[];
  progression: { tier: string; division: number; progressPct: number };
}

export interface SidebarChip {
  /** 'account' — pinned to one account; 'all' — unpinned; 'none' — no snapshot yet. */
  scope: 'account' | 'all' | 'none';
  /** The chip's headline: the pinned account, or {@link ALL_ACCOUNTS_LABEL}. */
  name: string;
  /** The avatar's single character. */
  glyph: string;
  /** The rank sub-line beneath the name — abbreviated to fit the 108px column. */
  sub: string;
  /**
   * The same line with FULL tier names, for the element's `title`. The sub-line
   * is clamped to two lines and the tooltip is the escape hatch that clamp
   * relies on, so it must not shrink along with the thing it exists to expand.
   */
  subFull: string;
}

/** What the chip says for a snapshot (or for none, before the first load). */
export function sidebarChip(d: SidebarChipInput | null | undefined): SidebarChip {
  if (!d) return { scope: 'none', name: 'Vantage', glyph: 'V', sub: '—', subFull: '—' };
  if (d.filters.account !== 'all') {
    const name = d.filters.account;
    return {
      scope: 'account', name, glyph: name.charAt(0).toUpperCase(),
      sub: rankLine(d), subFull: rankLine(d, false),
    };
  }
  return {
    scope: 'all', name: ALL_ACCOUNTS_LABEL, glyph: ALL_ACCOUNTS_GLYPH,
    sub: allAccountsLine(d), subFull: allAccountsLine(d, false),
  };
}

/**
 * The sidebar rank line: the user's real anchored rank when they've set one,
 * otherwise the winrate-derived heuristic estimate. Showing the heuristic while
 * an anchor exists was the "says Platinum 1 even though I set my rank" bug.
 *
 * Prefixed with the role name: `primaryRank` resolves to whichever role was
 * most recently played (see dashboardData), so without the prefix the number
 * alone wouldn't say which of an account's roles it belongs to.
 *
 * While the anchored (account, role) track is in an OPEN placement run, the
 * computed rank above is stale/meaningless (Overwatch shows no ±% or protection
 * during placements) — this shows `Placements N/10` (+ the latest prediction,
 * when one exists) instead, via the shared roleStatus/placementParts.
 */
export function rankLine(d: SidebarChipInput, short = true): string {
  const r = d.primaryRank;
  if (r) {
    const openRun = d.placements.find((p) => p.account === r.account && p.role === r.role && !p.completed);
    // No `movement` passed through roleStatus's rankParts call — the sidebar
    // shows no arrow (that's the Overview KPI's job).
    //
    // `short` goes STRUCTURALLY into roleStatus rather than being applied to its
    // output afterwards. This used to substring-replace the long label out of an
    // already-composed string, with a needle rebuilt from `rankLabelOf` — so any
    // change to that shape would have made the replace silently no-op and
    // reverted the chip to long names, with nothing failing to say so.
    const status = roleStatus(r, openRun, false, short);
    return `${ROLE_SHORT[r.role]} · ${status.text}`;
  }
  const label = short ? shortRankLabelOf : rankLabel;
  return `${label(d.progression.tier, d.progression.division)} · ${Math.round(d.progression.progressPct)}%`;
}

/**
 * The unpinned sub-line: {@link rankLine} attributed to the account it belongs
 * to, because the headline above it no longer names one. Without any rank to
 * attribute, a plain account count.
 */
export function allAccountsLine(d: SidebarChipInput, short = true): string {
  return d.primaryRank
    ? `${d.primaryRank.account} · ${rankLine(d, short)}`
    : accountCountLine(d.options.accounts.length);
}

/** `0 → "No accounts yet"`, `1 → "1 account"`, `n → "n accounts"`. */
export function accountCountLine(n: number): string {
  if (n === 0) return 'No accounts yet';
  return n === 1 ? '1 account' : `${n} accounts`;
}
