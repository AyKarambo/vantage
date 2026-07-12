/**
 * Pure account-management helpers shared by main and the browser preview
 * (Electron-free, unit-tested): the union/de-dup that turns the configured
 * roster plus the accounts detected in history into one manageable list, the
 * "is this a configured/known account" test, the auto-switch decision, and the
 * legacy-Unknown recovery lookup.
 */
import type { RosterPlayer } from './model';
import { resolveAccount } from './resolvers/account';

/** The account a match with no captured (or unmapped) BattleTag is stored under. */
export const UNKNOWN_ACCOUNT = 'Unknown';

/**
 * How an entry in the account manager is keyed:
 *  - `configured` — a real `battleTag → label` mapping in the user's config.
 *  - `unlabeled`  — a raw BattleTag seen in history but never labelled.
 *  - `unknown`    — the {@link UNKNOWN_ACCOUNT} bucket (no tag to key on).
 * Only `configured` accounts can be renamed; detected accounts are label-or-delete.
 */
export type AccountKind = 'configured' | 'unlabeled' | 'unknown';

/** One row of the manageable account list (superset of the on-wire AccountSummary). */
export interface AccountListEntry {
  battleTag: string;
  label: string;
  kind: AccountKind;
  /** How many stored games are attributed to this account. */
  games: number;
}

/**
 * Merge the configured accounts (`battleTag → label`) with the distinct accounts
 * actually seen in history, so the manager lists BOTH the accounts you've named
 * and the ones only detected in play (the {@link UNKNOWN_ACCOUNT} bucket plus raw
 * BattleTags). De-dup uses {@link resolveAccount} matching: a history account that
 * resolves to a configured label is NOT a separate entry — its games roll into
 * that configured row. Configured rows come first (config order), detected rows
 * after (first-seen order).
 *
 * @param configured     the config `battleTag → label` map.
 * @param historyAccounts one `GameRecord.account` value per stored game.
 */
export function mergeAccountList(
  configured: Record<string, string>,
  historyAccounts: Iterable<string>,
): AccountListEntry[] {
  // Count games per distinct stored account value (first-seen order preserved).
  const counts = new Map<string, number>();
  for (const account of historyAccounts) {
    if (!account) continue;
    counts.set(account, (counts.get(account) ?? 0) + 1);
  }

  // One configured entry per battleTag; index the first entry for each label so
  // resolved history games can roll their counts into it.
  const configuredEntries: AccountListEntry[] = Object.entries(configured).map(
    ([battleTag, rawLabel]) => ({ battleTag, label: rawLabel || battleTag, kind: 'configured', games: 0 }),
  );
  const byLabel = new Map<string, AccountListEntry>();
  for (const entry of configuredEntries) {
    if (!byLabel.has(entry.label)) byLabel.set(entry.label, entry);
  }

  const detected: AccountListEntry[] = [];
  for (const [account, games] of counts) {
    const resolved = resolveToConfiguredLabel(account, configured);
    const target = resolved !== undefined ? byLabel.get(resolved) : undefined;
    if (target) {
      // De-dup: this history value belongs to a configured account — roll its
      // games into that row rather than listing it separately.
      target.games += games;
      continue;
    }
    detected.push({
      battleTag: account,
      label: account,
      kind: account === UNKNOWN_ACCOUNT ? 'unknown' : 'unlabeled',
      games,
    });
  }

  return [...configuredEntries, ...detected];
}

/**
 * The configured label an account value belongs to, or `undefined` if none.
 * History stores the RESOLVED account (the label), so the primary match is an
 * exact configured-label (map value) hit; a raw BattleTag falls back to
 * {@link resolveAccount}'s exact/case-insensitive/name-only key matching. This
 * two-step is why a stored label like `"Main"` (which shares no name with its
 * `"Player#1234"` battleTag) is still recognised as configured.
 */
export function resolveToConfiguredLabel(
  account: string | undefined,
  accounts: Record<string, string>,
): string | undefined {
  if (!account) return undefined;
  for (const label of Object.values(accounts)) {
    if (label === account) return label;
  }
  return resolveAccount(account, accounts);
}

/** Whether `account` maps to a configured/known account (see {@link resolveToConfiguredLabel}). */
export function isConfiguredAccount(account: string | undefined, accounts: Record<string, string>): boolean {
  return resolveToConfiguredLabel(account, accounts) !== undefined;
}

/** The account just logged, as pushed to the renderer with {@link GameLoggedPayload}. */
export interface LoggedAccount {
  account: string;
  /** True when {@link account} maps to a configured/known account. */
  configured: boolean;
}

/**
 * Decide whether logging a match should switch the dashboard's account filter to
 * the account just played. Only when the current selection is a SPECIFIC account
 * (never "All accounts"), the logged account is configured/known, and it actually
 * differs from what's selected — so the view follows you onto the account you're
 * grinding without ever hijacking an "all accounts" or unmapped view.
 */
export function shouldAutoSwitch(current: string, logged: LoggedAccount): boolean {
  if (current === 'all') return false;
  if (!logged.configured || !logged.account) return false;
  return logged.account !== current;
}

/** The tracked (local) player's BattleTag from a stored roster, if the feed captured one. */
export function localBattleTag(roster: RosterPlayer[] | undefined): string | undefined {
  return roster?.find((p) => p.isLocal && p.battleTag)?.battleTag;
}

/**
 * The configured label a legacy `Unknown` row can be re-attributed to: the local
 * roster BattleTag resolved against the current accounts map, when it maps to a
 * configured account. `undefined` when there's no recoverable tag or it still
 * doesn't map — those rows stay Unknown.
 */
export function recoverableAccount(
  roster: RosterPlayer[] | undefined,
  accounts: Record<string, string>,
): string | undefined {
  return resolveAccount(localBattleTag(roster), accounts);
}
