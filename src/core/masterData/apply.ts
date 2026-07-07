/**
 * Turn editor intents (upsert/remove an entry, accept an Update) into new
 * override deltas. Keeping this pure and identity-aware means the renderer only
 * ever sends whole entries; the delta bookkeeping (patch vs tombstone vs
 * drop-when-back-to-default) lives here and is unit-tested.
 */
import type {
  AcceptedUpdate,
  HeroEntry,
  MapEntry,
  MasterData,
  MasterDataOverrides,
  SeasonEntry,
} from './types';
import { heroKey, mapKey, seasonKey } from './keys';

function findHero(defaults: MasterData, key: string): HeroEntry | undefined {
  return defaults.heroes.find((h) => heroKey(h.name) === key);
}
function findMap(defaults: MasterData, key: string): MapEntry | undefined {
  return defaults.maps.find((m) => mapKey(m.name) === key);
}
function findSeason(defaults: MasterData, key: string): SeasonEntry | undefined {
  return defaults.seasons.find((s) => seasonKey(s.start) === key);
}

export function upsertHeroOverride(
  overrides: MasterDataOverrides,
  defaults: MasterData,
  entry: HeroEntry,
): MasterDataOverrides {
  const key = heroKey(entry.name);
  const def = findHero(defaults, key);
  const heroes = { ...overrides.heroes };
  if (def && def.name === entry.name && def.role === entry.role) delete heroes[key];
  else heroes[key] = { name: entry.name, role: entry.role };
  return { ...overrides, heroes };
}

export function removeHeroOverride(
  overrides: MasterDataOverrides,
  defaults: MasterData,
  name: string,
): MasterDataOverrides {
  const key = heroKey(name);
  const heroes = { ...overrides.heroes };
  // A default is tombstoned; a purely user-added entry just drops its patch.
  if (findHero(defaults, key)) heroes[key] = { removed: true };
  else delete heroes[key];
  return { ...overrides, heroes };
}

export function upsertMapOverride(
  overrides: MasterDataOverrides,
  defaults: MasterData,
  entry: MapEntry,
): MasterDataOverrides {
  const key = mapKey(entry.name);
  const def = findMap(defaults, key);
  const maps = { ...overrides.maps };
  if (def && def.name === entry.name && def.mode === entry.mode && (def.isActive ?? true) === entry.isActive) {
    delete maps[key];
  } else {
    maps[key] = { name: entry.name, mode: entry.mode, isActive: entry.isActive };
  }
  return { ...overrides, maps };
}

export function removeMapOverride(
  overrides: MasterDataOverrides,
  defaults: MasterData,
  name: string,
): MasterDataOverrides {
  const key = mapKey(name);
  const maps = { ...overrides.maps };
  if (findMap(defaults, key)) maps[key] = { removed: true };
  else delete maps[key];
  return { ...overrides, maps };
}

export function upsertSeasonOverride(
  overrides: MasterDataOverrides,
  defaults: MasterData,
  entry: SeasonEntry,
): MasterDataOverrides {
  const key = seasonKey(entry.start);
  const def = findSeason(defaults, key);
  const seasons = { ...overrides.seasons };
  if (def && def.label === entry.label) delete seasons[key];
  else seasons[key] = { start: entry.start, label: entry.label };
  return { ...overrides, seasons };
}

export function removeSeasonOverride(
  overrides: MasterDataOverrides,
  defaults: MasterData,
  id: string,
): MasterDataOverrides {
  const seasons = { ...overrides.seasons };
  if (findSeason(defaults, id)) seasons[id] = { removed: true };
  else delete seasons[id];
  return { ...overrides, seasons };
}

/**
 * Fold an accepted Update into the overrides: hero/map additions and changes
 * become upserts. Accepted map entries already carry the preserved `isActive`
 * (additions → true, changes → the user's current flag), so this never resets a
 * pool toggle (AC 28/29).
 */
export function applyAccepted(
  overrides: MasterDataOverrides,
  defaults: MasterData,
  accepted: AcceptedUpdate,
): MasterDataOverrides {
  let next = overrides;
  for (const h of accepted.heroes) next = upsertHeroOverride(next, defaults, h);
  for (const m of accepted.maps) next = upsertMapOverride(next, defaults, m);
  return next;
}
