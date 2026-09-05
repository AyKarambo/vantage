/** Public surface of the calculated-rank engine; import from 'src/core/rank'. */

export type {
  RankPosition, RankAnchor, RankState, RankMatchInput, RankAnchorMap,
} from './types';
export { rankKey } from './types';
export { TIERS, applyMatch, computeRank, stateFromAnchor, ladderPoints } from './engine';
export { competitiveComps, currentRank } from './timeline';
export { rankToPoints, pointsToRank } from './scalar';
export { rankAfterMatch, rankEnteringMatch, srDeltaForSetRank } from './reconstruct';
export { enteringRanks, enteringRankAt } from './entering';
export type { EnteringRank, EnteringRankNote, EnteringRanksOptions } from './entering';
