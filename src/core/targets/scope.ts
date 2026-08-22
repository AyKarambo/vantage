/**
 * Scope-eligibility for improvement targets — a coarse, per-match "is this game
 * in scope" check shared by self-mode targets' stats and the Review screen.
 * Deliberately simpler than {@link ./measured matchStatValue}'s per-hero-row
 * math: no minutes, no per-hero stats, just the match's `role` and `heroes`.
 */
import type { GameRecord } from '../analytics';
import type { Role } from '../model';
import { heroMatchKey } from '../heroes';

/** Optional role/hero scope for a target. Both absent/empty = unscoped (matches every game). */
export interface TargetScope {
  roleScope?: Role;
  heroScope?: string[];
}

/**
 * Whether `game` falls inside `scope`. `roleScope` must equal `game.role`
 * exactly (an `openQ` game never equals a specific role, so it's excluded with
 * no separate check). `heroScope` matches if any scoped hero appears anywhere
 * in `game.heroes`, folded via {@link heroMatchKey} on both sides. Both set is
 * an AND. Unscoped (neither set) is always `true`.
 */
export function matchInTargetScope(game: Pick<GameRecord, 'heroes' | 'role'>, scope: TargetScope): boolean {
  const { roleScope, heroScope } = scope;

  if (roleScope != null && game.role !== roleScope) return false;

  if (heroScope != null && heroScope.length > 0) {
    const scopedKeys = new Set(heroScope.map(heroMatchKey));
    if (!game.heroes.some((h) => scopedKeys.has(heroMatchKey(h)))) return false;
  }

  return true;
}
