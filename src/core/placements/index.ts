/** Public surface of the placement-run tracker; import from 'src/core/placements'. */

export { PLACEMENT_RUN_LENGTH } from './types';
export type { PredictedRank, PlacementRun } from './types';
export {
  countedMatches, trackMatchesFrom, runProgress, isRunComplete, isAwaitingRank, hasDrifted,
  suppressedMatchIds, shouldOfferRun,
} from './engine';
