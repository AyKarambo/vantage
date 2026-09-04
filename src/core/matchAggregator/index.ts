/** Public surface of the match aggregator; import from 'src/core/matchAggregator', not from its siblings. */

// Stateful GEP-stream accumulator (+ the shared match-boundary predicates)
export { MatchAggregator, isMatchStartMessage, isMatchEndMessage, isRoundStartMessage, isRoundEndMessage } from './aggregator';
export type { MatchAggregatorOptions } from './aggregator';

// Pure GEP value coercion (parseRoster is also exercised directly by tests)
export { parseRoster, asObject, asString, asNumber } from './gepValues';
