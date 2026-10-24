/**
 * Party tracking: who the player queued with, and the effective group size
 * derived from it. Pure and I/O-free.
 */
import type { GameRecord } from './analytics/types';
import { battleTagName, type MatchParty, type RosterPlayer } from './model';

export type { MatchParty } from './model';

/** Identity key for a party member: the BattleTag name, lowercased and without `#tag`. */
export function partyKey(name: string): string {
  return battleTagName(name);
}

/** Trim names, drop empties, and dedupe by {@link partyKey} (first spelling and order win). */
export function normalizeMembers(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    const key = partyKey(name);
    if (!name || !key || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** Party size for a game: members + 1 when a party is recorded, else the raw GEP count. */
export function effectiveGroupSize(g: Pick<GameRecord, 'party' | 'groupSize'>): number | undefined {
  return g.party ? g.party.members.length + 1 : g.groupSize;
}

/**
 * Non-local roster players on the local player's team. With no local entry or
 * an unknown local team, every non-local player is returned.
 */
export function ownTeammates(roster: readonly RosterPlayer[] | undefined): string[] {
  if (!roster) return [];
  const local = roster.find((p) => p.isLocal);
  const team = local?.team;
  const names: string[] = [];
  for (const p of roster) {
    if (p.isLocal) continue;
    if (team !== undefined && p.team !== team) continue;
    const name = p.battleTag?.trim();
    if (name) names.push(name);
  }
  return normalizeMembers(names);
}

/**
 * Label an unlabelled game from remembered friends: when the friends found on
 * the player's team account for the whole GEP-reported party, that's the party.
 * Returns undefined when already labelled, solo/unknown, or the count doesn't add up.
 */
export function autoParty(
  game: Pick<GameRecord, 'party' | 'groupSize' | 'roster'>,
  friendKeys: ReadonlySet<string>,
): MatchParty | undefined {
  if (game.party || game.groupSize === undefined || game.groupSize < 2) return undefined;
  // ownTeammates falls back to the whole roster when the local team is unknown,
  // which is fine for offering picker candidates but not for recording a party:
  // if the roster tells teams apart at all, a friend could be on the other side.
  const local = game.roster?.find((p) => p.isLocal);
  if (local?.team === undefined && game.roster?.some((p) => p.team !== undefined)) return undefined;
  const friends = ownTeammates(game.roster).filter((n) => friendKeys.has(partyKey(n)));
  if (friends.length !== game.groupSize - 1) return undefined;
  return { members: friends, source: 'auto' };
}

/**
 * Map an untyped party input (IPC / preview) onto the stored shape: `null`
 * clears, `{ members }` becomes a hand-authored party (`source: 'manual'`, names
 * trimmed and deduped; an empty list is an explicit Solo), anything absent or
 * malformed is `undefined` = leave the stored party alone. Non-string members
 * are dropped rather than rejecting the whole save.
 */
export function partyFromInput(raw: unknown): MatchParty | null | undefined {
  if (raw === null) return null;
  if (typeof raw !== 'object') return undefined;
  const members = (raw as { members?: unknown }).members;
  if (!Array.isArray(members)) return undefined;
  return { members: normalizeMembers(members.filter((m): m is string => typeof m === 'string')), source: 'manual' };
}
