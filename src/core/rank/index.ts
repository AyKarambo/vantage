/** Public surface of the calculated-rank engine; import from 'src/core/rank'. */

export type {
  RankPosition, RankAnchor, RankState, RankMatchInput, RankAnchorMap,
} from './types';
export { rankKey } from './types';
export { TIERS, applyMatch, computeRank, stateFromAnchor } from './engine';
export { competitiveComps, currentRank } from './timeline';
