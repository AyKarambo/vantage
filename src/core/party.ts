/**
 * Party tracking: who the player queued with, and the effective group size
 * derived from it. Pure and I/O-free.
 */
import type { GameRecord } from './analytics/types';
import { battleTagName, type MatchParty, type RosterPlayer } from './model';
import { sittingsOf } from './practice/sittings';

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

/**
 * Party size for a game: members + 1 when a party is recorded, else the raw
 * GEP count, else Solo. Solo is the default — nothing recorded and no group
 * detected means you queued alone; the picker's Solo chip only exists to
 * correct a group GEP detected when you were in fact alone.
 */
export function effectiveGroupSize(g: Pick<GameRecord, 'party' | 'groupSize'>): number {
  return g.party ? g.party.members.length + 1 : g.groupSize ?? 1;
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
 * Whether a party of `members` is a believable label for an unlabelled game —
 * the test behind carrying a group across one sitting. The GEP-reported group
 * size must agree when there is one, and when the roster tells teams apart
 * every member must be on the player's team. With neither a roster nor a group
 * size there is nothing to check against, so nothing carries.
 */
export function partyFits(
  game: Pick<GameRecord, 'party' | 'groupSize' | 'roster'>,
  members: readonly string[],
): boolean {
  if (game.party || !members.length) return false;
  if (game.groupSize !== undefined && game.groupSize !== members.length + 1) return false;
  if (!game.roster?.length) return game.groupSize !== undefined;
  // Same caution as autoParty: a roster that has teams but no known local team
  // can't say which side a name was on.
  const local = game.roster.find((p) => p.isLocal);
  if (local?.team === undefined && game.roster.some((p) => p.team !== undefined)) return false;
  const team = new Set(ownTeammates(game.roster).map(partyKey));
  return members.every((m) => team.has(partyKey(m)));
}

/**
 * The group to carry onto a freshly captured `game` from earlier in the same
 * sitting: the latest game before it with a recorded party. An explicit Solo
 * there carries nothing, and neither does a party that doesn't {@link partyFits fit}.
 */
export function carriedParty(history: readonly GameRecord[], game: GameRecord): MatchParty | undefined {
  if (game.party) return undefined;
  const sitting = sittingsOf([...history.filter((g) => g.matchId !== game.matchId), game])
    .find((s) => s.some((g) => g.matchId === game.matchId)) ?? [];
  const prev = sitting.filter((g) => g.timestamp < game.timestamp && g.party).pop();
  if (!prev?.party?.members.length || !partyFits(game, prev.party.members)) return undefined;
  return { members: [...prev.party.members], source: 'auto' };
}

/**
 * The unlabelled games of `matchId`'s sitting that should take on the party the
 * player just set there: walking outward from it in both directions, every
 * neighbour the party {@link partyFits fits}, stopping at the first game that
 * already has a party or doesn't fit (the group changed there).
 */
export function sittingPartyFill(all: readonly GameRecord[], matchId: string, members: readonly string[]): string[] {
  if (!members.length) return [];
  const sitting = sittingsOf(all).find((s) => s.some((g) => g.matchId === matchId));
  if (!sitting) return [];
  const at = sitting.findIndex((g) => g.matchId === matchId);
  const out: string[] = [];
  for (const step of [-1, 1]) {
    for (let i = at + step; i >= 0 && i < sitting.length && partyFits(sitting[i], members); i += step) {
      out.push(sitting[i].matchId);
    }
  }
  return out;
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
