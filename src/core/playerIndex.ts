import type { GameRecord } from './analytics';
import { battleTagName, type RosterPlayer } from './model';
import { DEFAULT_MASTER_DATA, makeMapMode, type MapModeResolver } from './masterData';
import type { PlayerEncounter, PlayerMatchHistory, PlayerSharedMatch } from '../shared/contract';

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
 */
export function playerHistory(all: GameRecord[], match: GameRecord): PlayerEncounter[] {
  const targets = (match.roster ?? []).filter((p) => !p.isLocal && nameKey(p));
  if (!targets.length) return [];

  const found = new Map<string, PlayerEncounter>();
  for (const game of all) {
    if (game.matchId === match.matchId || !game.roster?.length) continue;
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
      };
      entry.encounters += 1;
      entry.lastSeen = Math.max(entry.lastSeen, game.timestamp);
      // Prefer the full battleTag over a bare name, wherever one shows up.
      if (!entry.name.includes('#')) entry.name = displayName(other, entry.name);
      if (game.result === 'Win') entry.results!.wins += 1;
      else if (game.result === 'Loss') entry.results!.losses += 1;
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

    matches.push({
      matchId: game.matchId,
      timestamp: game.timestamp,
      map: game.map,
      mapType: mapModeOf(game.map),
      result: game.result,
      ...(relation !== undefined ? { sameTeam: relation } : {}),
      ...(them.heroName ? { hero: them.heroName } : {}),
      account: game.account,
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

/** Normalized identity (shared `battleTagName` form). Empty → no identity. */
function nameKey(player: RosterPlayer): string {
  return battleTagName(player.battleTag ?? '');
}

function displayName(player: RosterPlayer, fallback = 'Unknown'): string {
  return player.battleTag?.trim() || fallback;
}
