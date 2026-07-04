import type { GameRecord } from './analytics';
import { battleTagName, type RosterPlayer } from './model';
import type { PlayerEncounter } from '../shared/contract';

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

/** Normalized identity (shared `battleTagName` form). Empty → no identity. */
function nameKey(player: RosterPlayer): string {
  return battleTagName(player.battleTag ?? '');
}

function displayName(player: RosterPlayer, fallback = 'Unknown'): string {
  return player.battleTag?.trim() || fallback;
}
