/**
 * Merge the compiled defaults with the user's override deltas into one effective
 * `MasterData`. This is the single place identity, tombstones and the
 * `isActive` default live, so every consumer sees the same effective catalog.
 */
import { seasonEntriesFromStarts } from '../season';
import type {
  HeroEntry,
  HeroPatch,
  MapEntry,
  MapPatch,
  MasterData,
  MasterDataOverrides,
  SeasonEntry,
  SeasonPatch,
} from './types';
import { heroKey, mapKey, seasonKey } from './keys';

export function mergeHeroes(defaults: readonly HeroEntry[], overrides: Record<string, HeroPatch>): HeroEntry[] {
  const map = new Map<string, HeroEntry>();
  for (const h of defaults) map.set(heroKey(h.name), { ...h });
  for (const [key, patch] of Object.entries(overrides)) {
    if (patch.removed) {
      map.delete(key);
      continue;
    }
    const base = map.get(key);
    const name = patch.name ?? base?.name ?? key;
    const role = patch.role ?? base?.role;
    if (!role) continue; // an addition with no role is invalid — skip rather than fabricate
    map.set(key, { name, role });
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function mergeMaps(defaults: readonly MapEntry[], overrides: Record<string, MapPatch>): MapEntry[] {
  const map = new Map<string, MapEntry>();
  for (const m of defaults) map.set(mapKey(m.name), { ...m, isActive: m.isActive ?? true });
  for (const [key, patch] of Object.entries(overrides)) {
    if (patch.removed) {
      map.delete(key);
      continue;
    }
    const base = map.get(key);
    const name = patch.name ?? base?.name;
    if (!name) continue;
    const mode = patch.mode ?? base?.mode ?? 'Unknown';
    // Missing/undefined isActive ⇒ active (AC 30 — pre-feature overrides need no migration).
    const isActive = patch.isActive ?? base?.isActive ?? true;
    map.set(key, { name, mode, isActive });
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The effective, ascending, de-duplicated season start instants. Kept separate
 * from labels because `season.ts` derives labels over the *whole* list.
 */
export function mergeSeasonStarts(
  defaultStarts: readonly number[],
  overrides: Record<string, SeasonPatch>,
): number[] {
  const byKey = new Map<string, number>();
  for (const s of defaultStarts) byKey.set(seasonKey(s), s);
  for (const [key, patch] of Object.entries(overrides)) {
    if (patch.removed) {
      byKey.delete(key);
      continue;
    }
    const start = patch.start ?? byKey.get(key);
    if (start == null) continue;
    byKey.set(seasonKey(start), start);
  }
  return [...byKey.values()].sort((a, b) => a - b);
}

export function mergeSeasons(
  defaultStarts: readonly number[],
  overrides: Record<string, SeasonPatch>,
): SeasonEntry[] {
  const starts = mergeSeasonStarts(defaultStarts, overrides);
  return seasonEntriesFromStarts(starts).map((entry) => {
    const patch = overrides[seasonKey(entry.start)];
    return patch?.label ? { ...entry, label: patch.label } : entry;
  });
}

export function mergeMasterData(defaults: MasterData, overrides: MasterDataOverrides): MasterData {
  return {
    heroes: mergeHeroes(defaults.heroes, overrides.heroes),
    maps: mergeMaps(defaults.maps, overrides.maps),
    seasons: mergeSeasons(defaults.seasons.map((s) => s.start), overrides.seasons),
  };
}

/** The effective season starts (for injecting into `season.ts` helpers). */
export function effectiveSeasonStarts(defaults: MasterData, overrides: MasterDataOverrides): number[] {
  return mergeSeasonStarts(defaults.seasons.map((s) => s.start), overrides.seasons);
}
