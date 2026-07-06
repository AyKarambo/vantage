/**
 * Editable master-data model — the effective catalog of heroes, maps and
 * seasons plus the user's override deltas. Pure types, no I/O (Guardrail 3).
 *
 * The effective data is `DEFAULT_MASTER_DATA ⊕ MasterDataOverrides`: the defaults
 * ship compiled into the app (the offline snapshot); the overrides are the only
 * thing persisted, as *deltas* keyed by stable identity — so a hand-added entry
 * that a later app version ships as a built-in dedupes, and edits survive across
 * updates instead of freezing a stale full list.
 */
import type { Role } from '../model';
import type { MapMode } from '../maps';

/** A hero's role — the map/typeahead never surfaces `openQ` (that's a queue, not a role). */
export type HeroRole = Exclude<Role, 'openQ'>;

export interface HeroEntry {
  name: string;
  role: HeroRole;
}

export interface MapEntry {
  name: string;
  mode: MapMode;
  /** In the current competitive map pool. Gates new-match suggestions only. */
  isActive: boolean;
}

export interface SeasonEntry {
  /** Season start instant (UTC ms) — the stable identity. */
  start: number;
  label: string;
}

export interface MasterData {
  heroes: HeroEntry[];
  maps: MapEntry[];
  seasons: SeasonEntry[];
}

/** A partial hero override; `removed` tombstones a built-in out of the effective list. */
export interface HeroPatch {
  name?: string;
  role?: HeroRole;
  removed?: boolean;
}

export interface MapPatch {
  name?: string;
  mode?: MapMode;
  isActive?: boolean;
  removed?: boolean;
}

export interface SeasonPatch {
  start?: number;
  label?: string;
  removed?: boolean;
}

/**
 * The persisted deltas. Keys are stable identities: hero → trimmed name,
 * map → `normalizeMapName`, season → `S:<iso>` of the start. An `added` entry
 * and an `edited` built-in are the same shape (a patch upserted onto the
 * default-or-empty base); a `removed` entry is a tombstone.
 */
export interface MasterDataOverrides {
  heroes: Record<string, HeroPatch>;
  maps: Record<string, MapPatch>;
  seasons: Record<string, SeasonPatch>;
}

/** A fresh, empty override set — the pre-edit baseline. */
export function emptyOverrides(): MasterDataOverrides {
  return { heroes: {}, maps: {}, seasons: {} };
}

export interface HeroChange {
  from: HeroEntry;
  to: HeroEntry;
}

export interface MapChange {
  from: MapEntry;
  to: MapEntry;
}

/**
 * The result of an Update fetch+diff — additions and changes the user reviews.
 * Seasons never appear (no API); `isActive` is never a change (excluded from the
 * map diff), so an Update run never proposes reverting a user's pool toggle.
 */
export interface UpdatePreview {
  heroes: { additions: HeroEntry[]; changes: HeroChange[] };
  maps: { additions: MapEntry[]; changes: MapChange[] };
}

/** The subset of a preview the user accepted — folded back into the overrides. */
export interface AcceptedUpdate {
  heroes: HeroEntry[];
  maps: MapEntry[];
}

/** Fetched catalog from the Update source, already parsed/validated. */
export interface FetchedCatalog {
  heroes: HeroEntry[];
  maps: MapEntry[];
}

/** True when a preview proposes nothing — the "already up to date" case (AC 9). */
export function isPreviewEmpty(p: UpdatePreview): boolean {
  return (
    p.heroes.additions.length === 0 &&
    p.heroes.changes.length === 0 &&
    p.maps.additions.length === 0 &&
    p.maps.changes.length === 0
  );
}
