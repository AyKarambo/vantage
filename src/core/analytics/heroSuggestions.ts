/**
 * Per-account "most played heroes" ranking — the shortlist behind the Log
 * Match hero picker. Pure and I/O-free so it is fully unit-testable and
 * reusable in the renderer.
 */
import type { GameRecord } from './types';
import type { Role } from '../model';

/**
 * Hero names for `account` (and, unless `role` is `'openQ'`, `role`), ranked
 * by descending play count — each hero in a game's `heroes` list counts once
 * per game, mirroring {@link ./heroStats heroStats}'s counting semantics.
 * `openQ` aggregates across every recorded role for the account (Open Queue
 * players still favor the same heroes whatever role they land on). Ties break
 * alphabetically for determinism.
 */
export function mostPlayedHeroes(games: GameRecord[], account: string, role: Role): string[] {
  const scoped = games.filter((g) => g.account === account && (role === 'openQ' || g.role === role));
  const counts = new Map<string, number>();
  for (const g of scoped) {
    for (const hero of g.heroes) counts.set(hero, (counts.get(hero) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([hero]) => hero);
}
