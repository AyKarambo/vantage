/**
 * The compiled-in default master-data snapshot — assembled from the existing
 * static tables so there is one source of truth, and shipped with the app as
 * the offline baseline the Update feature degrades to (spec AC 13).
 *
 * Maps known to be withheld from the competitive pool at release ship
 * `isActive:false` (spec AC 31). These are legacy 2CP maps Vantage doesn't model
 * a mode for, so they carry `Unknown` and simply don't appear in new-match
 * suggestions until Blizzard reworks and re-adds them (at which point the user
 * flips them active and sets the mode).
 */
import { HEROES_BY_ROLE } from '../heroes';
import { MAP_MODES, type MapMode } from '../maps';
import { SEASON_STARTS, seasonEntriesFromStarts } from '../season';
import type { HeroEntry, HeroRole, MapEntry, MasterData } from './types';

/** Maps that exist in the game but are out of the competitive pool at release. */
const WITHHELD_MAPS: ReadonlyArray<{ name: string; mode: MapMode }> = [
  { name: 'Paris', mode: 'Unknown' },
  { name: 'Horizon Lunar Colony', mode: 'Unknown' },
];

function defaultHeroes(): HeroEntry[] {
  const out: HeroEntry[] = [];
  for (const [role, names] of Object.entries(HEROES_BY_ROLE) as [HeroRole, readonly string[]][]) {
    for (const name of names) out.push({ name, role });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function defaultMaps(): MapEntry[] {
  const out: MapEntry[] = Object.entries(MAP_MODES).map(([name, mode]) => ({
    name,
    mode,
    isActive: true,
  }));
  for (const w of WITHHELD_MAPS) {
    if (!out.some((m) => m.name === w.name)) out.push({ name: w.name, mode: w.mode, isActive: false });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Immutable default catalog — deep-cloned per call so consumers can't mutate it. */
export function defaultMasterData(): MasterData {
  return {
    heroes: defaultHeroes(),
    maps: defaultMaps(),
    seasons: seasonEntriesFromStarts(SEASON_STARTS),
  };
}

/** Shared default snapshot. Treat as read-only. */
export const DEFAULT_MASTER_DATA: MasterData = defaultMasterData();
