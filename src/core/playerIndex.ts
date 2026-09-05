import type { GameRecord } from './analytics';
import { battleTagName, type RosterPlayer } from './model';
import { DEFAULT_MASTER_DATA, makeMapMode, type MapModeResolver } from './masterData';
import { roleOfHero } from './heroes';
import { resolveRole } from './resolvers/role';
import type { EnteringRank } from './rank';
import type {
  PlayerEncounter, PlayerListQuery, PlayerListRow, PlayerMatchHistory, PlayerRecord,
  PlayerSharedMatch, PlayerSortKey, SharedMatchRank,
} from '../shared/contract';

/**
 * Player-encounter index, derived at query time from the rosters stored on the
 * match history — no separate store, no migration. Everything here is local
 * data the game itself showed on the TAB screen (guardrail #5: never exported).
 */

/**
 * Players from `match` the user has met in other stored games. Excludes the
 * tracked player, tolerates matches without rosters, and matches names
 * case-insensitively on the part before `#` (GEP sometimes drops the
 * discriminator). Sorted by most encounters, then most recent.
 *
 * `results` is the tracked player's COMBINED record across those games;
 * `sameTeam`/`enemyTeam` split it by team relation, which is only knowable when
 * the feed reported a team for both rows. The two splits therefore need not add
 * up to `encounters` — `relationKnown` says how many games they cover, so a
 * caller can tell "never on their team" from "never knew".
 */
export function playerHistory(all: GameRecord[], match: GameRecord): PlayerEncounter[] {
  const targets = (match.roster ?? []).filter((p) => !p.isLocal && nameKey(p));
  if (!targets.length) return [];

  const found = new Map<string, PlayerEncounter>();
  for (const game of all) {
    if (game.matchId === match.matchId || !game.roster?.length) continue;
    const local = game.roster.find((p) => p.isLocal);
    const seen = new Set<string>(); // count each shared match once per player
    for (const other of game.roster) {
      if (other.isLocal) continue;
      const key = nameKey(other);
      if (!key || seen.has(key)) continue;
      const target = targets.find((t) => nameKey(t) === key);
      if (!target) continue;
      seen.add(key);
      const entry = found.get(key) ?? {
        name: displayName(target),
        encounters: 0,
        lastSeen: 0,
        results: { wins: 0, losses: 0 },
        sameTeam: { wins: 0, losses: 0 },
        enemyTeam: { wins: 0, losses: 0 },
        relationKnown: 0,
      };
      entry.encounters += 1;
      entry.lastSeen = Math.max(entry.lastSeen, game.timestamp);
      // Prefer the full battleTag over a bare name, wherever one shows up.
      if (!entry.name.includes('#')) entry.name = displayName(other, entry.name);
      if (game.result === 'Win') entry.results!.wins += 1;
      else if (game.result === 'Loss') entry.results!.losses += 1;
      // Team relation only when the feed reported a team for BOTH rows —
      // otherwise "with" and "vs" would be a guess, and telling those apart is
      // the entire point of the split (mirrors playerRecords).
      if (local?.team != null && other.team != null) {
        entry.relationKnown += 1;
        const side = other.team === local.team ? entry.sameTeam : entry.enemyTeam;
        if (game.result === 'Win') side.wins += 1;
        else if (game.result === 'Loss') side.losses += 1;
      }
      found.set(key, entry);
    }
  }

  return [...found.values()].sort((a, b) => b.encounters - a.encounters || b.lastSeen - a.lastSeen);
}

/**
 * Every stored match the tracked player shared with `name` (matches with/against
 * them), newest first, plus a W/L summary split by team relation. Keyed by the
 * same normalized identity as {@link playerHistory}; returns `null` when the name
 * has no identity or no shared match exists. Local, GEP-only, never exported.
 */
export function playerMatchHistory(
  all: GameRecord[],
  name: string,
  mapModeOf: MapModeResolver = makeMapMode(DEFAULT_MASTER_DATA.maps),
  ranks?: ReadonlyMap<string, EnteringRank>,
): PlayerMatchHistory | null {
  const key = battleTagName(name ?? '');
  if (!key) return null;

  let display = (name ?? '').trim();
  let lastSeen = 0;
  const results = { wins: 0, losses: 0 };
  const sameTeam = { wins: 0, losses: 0 };
  const enemyTeam = { wins: 0, losses: 0 };
  const matches: PlayerSharedMatch[] = [];

  for (const game of all) {
    if (!game.roster?.length) continue;
    const them = game.roster.find((p) => !p.isLocal && nameKey(p) === key);
    if (!them) continue;
    const local = game.roster.find((p) => p.isLocal);
    // Team relation only when both teams were reported by the feed.
    const relation = local?.team != null && them.team != null ? them.team === local.team : undefined;

    // The SAME derivation the match-detail scoreboard uses for a non-local row:
    // GEP's own heroRole first, the hero table second, never guessed. Reusing it
    // is what stops the table and the scoreboard disagreeing about a role.
    const theirRole = resolveRole(undefined, them.heroRole) ?? roleOfHero(them.heroName);
    const rank = sharedMatchRank(ranks?.get(game.matchId));
    matches.push({
      matchId: game.matchId,
      timestamp: game.timestamp,
      map: game.map,
      mapType: mapModeOf(game.map),
      result: game.result,
      ...(relation !== undefined ? { sameTeam: relation } : {}),
      ...(them.heroName ? { hero: them.heroName } : {}),
      ...(theirRole ? { theirRole } : {}),
      account: game.account,
      role: game.role,
      heroes: game.heroes,
      ...(rank ? { rank } : {}),
    });

    lastSeen = Math.max(lastSeen, game.timestamp);
    // Prefer a full battleTag over a bare name, wherever one shows up.
    if (them.battleTag?.includes('#') && !display.includes('#')) display = them.battleTag.trim();
    if (game.result === 'Win') {
      results.wins += 1;
      if (relation === true) sameTeam.wins += 1;
      else if (relation === false) enemyTeam.wins += 1;
    } else if (game.result === 'Loss') {
      results.losses += 1;
      if (relation === true) sameTeam.losses += 1;
      else if (relation === false) enemyTeam.losses += 1;
    }
  }

  if (!matches.length) return null;
  matches.sort((a, b) => b.timestamp - a.timestamp);
  return { name: display || 'Unknown', encounters: matches.length, lastSeen, results, sameTeam, enemyTeam, matches };
}

/**
 * Collapse a core entering-rank cell to the wire shape. 'calculated' and
 * 'reconstructed' become one 'derived' badge: the reader cannot act on the
 * difference, and `protected` — the one thing that distinguishes them — is
 * deliberately not on the wire, so nothing built on this DTO can draw a shield
 * it has no way to know. `progressPct` passes through VERBATIM, negatives
 * included (a protection carry), exactly as the stored column already does.
 */
function sharedMatchRank(cell: EnteringRank | undefined): SharedMatchRank | undefined {
  if (!cell) return undefined;
  const note: SharedMatchRank['note'] =
    cell.note === 'calculated' || cell.note === 'reconstructed' ? 'derived' : cell.note;
  if (!cell.position) return { note };
  const { tier, division, progressPct } = cell.position;
  return { note, tier, division, progressPct };
}

/** Normalized identity (shared `battleTagName` form). Empty → no identity. */
function nameKey(player: RosterPlayer): string {
  return battleTagName(player.battleTag ?? '');
}

function displayName(player: RosterPlayer, fallback = 'Unknown'): string {
  return player.battleTag?.trim() || fallback;
}

/**
 * Your record WITH and AGAINST each of `names`, in one pass over history.
 *
 * The live-match screen asks this for a whole roster at once — up to nine
 * players, on every roster tick. {@link playerMatchHistory} answers the same
 * question for one name but walks the entire history to do it, so nine of them
 * is nine full walks per tick; this walks once for all of them.
 *
 * Deliberately a leaner shape than {@link playerMatchHistory}: no per-match
 * list. A live board shows "3W–1L with · 0W–2L vs", and shipping every shared
 * match for nine players just to render two counters would be the bulk of the
 * payload. Clicking a name still opens the full history through the existing
 * per-player read.
 *
 * Names with no shared match are simply absent from the result, so a caller can
 * tell "never met" from "met, no decided games" (the latter returns a record
 * with zeroes — a draw counts as an encounter but moves no W/L).
 */
export function playerRecords(all: GameRecord[], names: readonly string[]): PlayerRecord[] {
  const wanted = new Map<string, PlayerRecord>();
  for (const raw of names) {
    const key = battleTagName(raw ?? '');
    if (!key || wanted.has(key)) continue;
    wanted.set(key, {
      key,
      name: (raw ?? '').trim() || 'Unknown',
      encounters: 0,
      lastSeen: 0,
      sameTeam: { wins: 0, losses: 0 },
      enemyTeam: { wins: 0, losses: 0 },
    });
  }
  if (!wanted.size) return [];

  for (const game of all) {
    if (!game.roster?.length) continue;
    const local = game.roster.find((p) => p.isLocal);
    // Count each shared match once per player, even if the feed reported them
    // in two slots (mirrors playerHistory's per-game `seen` guard).
    const counted = new Set<string>();
    for (const other of game.roster) {
      if (other.isLocal) continue;
      const key = nameKey(other);
      const rec = key ? wanted.get(key) : undefined;
      if (!rec || counted.has(key)) continue;
      counted.add(key);
      rec.encounters += 1;
      rec.lastSeen = Math.max(rec.lastSeen, game.timestamp);
      // Prefer a full battleTag over a bare name, wherever one turns up.
      if (!rec.name.includes('#') && other.battleTag?.includes('#')) rec.name = other.battleTag.trim();
      // Team relation only when the feed reported a team for BOTH rows —
      // otherwise "with" and "vs" would be a guess, and this whole feature is
      // about telling those two apart.
      if (local?.team == null || other.team == null) continue;
      const side = other.team === local.team ? rec.sameTeam : rec.enemyTeam;
      if (game.result === 'Win') side.wins += 1;
      else if (game.result === 'Loss') side.losses += 1;
    }
  }

  return [...wanted.values()]
    .filter((r) => r.encounters > 0)
    .sort((a, b) => b.encounters - a.encounters || b.lastSeen - a.lastSeen);
}

/**
 * Max rows one Players page carries. Lives here, one function away from the
 * `matched` count it truncates, so the two can never disagree — the same
 * discipline as `dashboardData`'s ROW_CAP. Coupled to the fact that `dataTable`
 * renders every row into the DOM with its own click listener and nothing in the
 * renderer virtualizes.
 */
export const PLAYER_ROW_CAP = 200;

export interface PlayerDirectory {
  /** Every distinct player met, games desc → lastSeen desc → key asc. */
  players: PlayerListRow[];
  /** Games walked (already filter-scoped by the caller). */
  scannedGames: number;
  /** How many carried a usable roster — 0 means "no roster data at all". */
  gamesWithRoster: number;
}

const defaultPlayerOrder = (a: PlayerListRow, b: PlayerListRow): number =>
  b.games - a.games || b.lastSeen - a.lastSeen || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/**
 * Every player met across `games`, aggregated in ONE pass — the Players screen.
 *
 * Deliberately takes no query, floor, sort or cap: those change per keystroke
 * and per header click, and keying the walk on them is exactly what would stop
 * it being memoizable at the edge. Scope is the CALLER's job — hand it a
 * filtered slice and it aggregates that slice; filter resolution stays at the
 * edge (guardrail 3).
 *
 * The accumulation is duplicated from {@link playerRecords} rather than
 * extracted: that function runs on every live roster tick and is not worth
 * disturbing for this. The "agrees with playerRecords" unit test is what keeps
 * the two in step.
 */
export function playerDirectory(games: readonly GameRecord[]): PlayerDirectory {
  const rows = new Map<string, PlayerListRow>();
  /** First full `#`-tag seen per key (lowercased) — drives `ambiguous`. */
  const firstTag = new Map<string, string>();
  let gamesWithRoster = 0;
  for (const game of games) {
    if (!game.roster?.length) continue;
    gamesWithRoster += 1;
    const local = game.roster.find((p) => p.isLocal);
    const counted = new Set<string>(); // one encounter per game per player
    for (const other of game.roster) {
      if (other.isLocal) continue;
      const key = nameKey(other);
      if (!key || counted.has(key)) continue;
      counted.add(key);
      let row = rows.get(key);
      if (!row) {
        row = {
          key,
          name: displayName(other),
          games: 0,
          lastSeen: 0,
          sameTeam: { wins: 0, losses: 0 },
          enemyTeam: { wins: 0, losses: 0 },
          ambiguous: false,
        };
        rows.set(key, row);
      }
      row.games += 1;
      if (game.timestamp > row.lastSeen) row.lastSeen = game.timestamp;
      const tag = other.battleTag?.trim();
      if (tag?.includes('#')) {
        const canon = tag.toLowerCase();
        const seen = firstTag.get(key);
        if (seen === undefined) {
          firstTag.set(key, canon);
          // First #-tag wins, so the displayed name is stable across reads.
          if (!row.name.includes('#')) row.name = tag;
        } else if (seen !== canon) {
          // Two real tags folded into one row by the name-before-# merge.
          row.ambiguous = true;
        }
      }
      // Team relation only when the feed reported a team for BOTH rows —
      // otherwise "with" and "vs" would be a guess (mirrors playerRecords).
      if (local?.team == null || other.team == null) continue;
      const side = other.team === local.team ? row.sameTeam : row.enemyTeam;
      if (game.result === 'Win') side.wins += 1;
      else if (game.result === 'Loss') side.losses += 1;
    }
  }
  return {
    players: [...rows.values()].sort(defaultPlayerOrder),
    scannedGames: games.length,
    gamesWithRoster,
  };
}

export interface PlayerSelection {
  search: string;
  minGames: number;
  sort: PlayerSortKey;
  dir: 1 | -1;
  limit: number;
}

/**
 * Every sortable key → its numeric rank, or `null` when the row has no evidence
 * for it. `name` sorts on text and is branched on first in {@link comparePlayers};
 * its entry exists so this record stays exhaustive over `PlayerSortKey` and can
 * double as the untrusted-key guard in {@link normalizePlayerSelection}.
 */
const RANKERS: Record<PlayerSortKey, (r: PlayerListRow) => number | null> = {
  name: () => 0,
  games: (r) => r.games,
  with: (r) => winrateOf(r.sameTeam),
  vs: (r) => winrateOf(r.enemyTeam),
  lastSeen: (r) => r.lastSeen,
};

/**
 * Winrate, or null when nothing was decided — never 0, which would let a player
 * you have no decided games with top a "best record together" sort.
 */
function winrateOf(w: { wins: number; losses: number }): number | null {
  const n = w.wins + w.losses;
  return n ? w.wins / n : null;
}

/** Total and locale-free, so the cap always cuts at the same row. */
const tieBreak = (a: PlayerListRow, b: PlayerListRow): number =>
  b.games - a.games || b.lastSeen - a.lastSeen || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/** `dir: 1` = ascending (the ↑ header indicator), `-1` = descending. */
function comparePlayers(a: PlayerListRow, b: PlayerListRow, sort: PlayerSortKey, dir: 1 | -1): number {
  if (sort === 'name') {
    const na = a.name.toLowerCase();
    const nb = b.name.toLowerCase();
    return na === nb ? tieBreak(a, b) : na < nb ? -dir : dir;
  }
  const ra = RANKERS[sort](a);
  const rb = RANKERS[sort](b);
  if (ra === null || rb === null) {
    // Unknown sinks in BOTH directions — a player you have no decided games
    // with has no record together, and must never lead either ordering.
    return ra === rb ? tieBreak(a, b) : ra === null ? 1 : -1;
  }
  return ra === rb ? tieBreak(a, b) : ra < rb ? -dir : dir;
}

/** Untrusted IPC args in → a selection that cannot misbehave. */
export function normalizePlayerSelection(q: PlayerListQuery | undefined): PlayerSelection {
  const raw = typeof q?.search === 'string' ? q.search : '';
  const min = Number(q?.minGames);
  return {
    search: raw.trim().toLowerCase().slice(0, 64),
    minGames: Number.isFinite(min) ? Math.max(1, Math.trunc(min)) : 1,
    sort: q?.sort != null && q.sort in RANKERS ? q.sort : 'games',
    dir: q?.dir === 1 ? 1 : -1,
    limit: PLAYER_ROW_CAP,
  };
}

/**
 * Filter → sort → cap. `matched` is taken from the SAME array the slice comes
 * from, one line apart, so a page and its denominator cannot disagree. Never
 * mutates `players` (it is the memoized aggregate).
 *
 * Sorting happens HERE, over the whole matched set, and only then is the page
 * cut. Sorting a capped page instead would silently mean "the top 200 by games,
 * re-ordered" while claiming to be "the 200 most recent".
 */
export function selectPlayers(
  players: readonly PlayerListRow[],
  sel: PlayerSelection,
): { rows: PlayerListRow[]; matched: number } {
  const q = sel.search;
  // The identity form of the query, so typing a discriminator degrades to the
  // base name — correct, since the index merges Nova#1111 with Nova#2222 into
  // one row. The raw query still matches the displayed tag, so `#11` can still
  // discriminate.
  const qKey = q ? battleTagName(q) : '';
  const matches = players.filter((p) =>
    p.games >= sel.minGames
    && (!q || (qKey !== '' && p.key.includes(qKey)) || p.name.toLowerCase().includes(q)));
  matches.sort((a, b) => comparePlayers(a, b, sel.sort, sel.dir));
  return { rows: matches.slice(0, sel.limit), matched: matches.length };
}
