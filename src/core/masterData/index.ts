/**
 * Public surface of the editable master-data domain. Import from
 * `'core/masterData'`, not from the individual files.
 */
export type {
  HeroRole,
  HeroEntry,
  MapEntry,
  SeasonEntry,
  MasterData,
  HeroPatch,
  MapPatch,
  SeasonPatch,
  MasterDataOverrides,
  HeroChange,
  MapChange,
  UpdatePreview,
  AcceptedUpdate,
  FetchedCatalog,
} from './types';
export { emptyOverrides, isPreviewEmpty } from './types';
export { heroKey, mapKey, seasonKey } from './keys';
export { classifyGamemodes } from './modeMap';
export { parseOverfastHeroes, parseOverfastMaps } from './overfast';
export {
  mergeHeroes,
  mergeMaps,
  mergeSeasons,
  mergeSeasonStarts,
  mergeMasterData,
  effectiveSeasonStarts,
} from './merge';
export { diffMasterData } from './diff';
export { makeMapMode, type MapModeResolver } from './resolver';
export {
  upsertHeroOverride,
  removeHeroOverride,
  upsertMapOverride,
  removeMapOverride,
  upsertSeasonOverride,
  removeSeasonOverride,
  applyAccepted,
} from './apply';
export { DEFAULT_MASTER_DATA, defaultMasterData } from './defaults';
