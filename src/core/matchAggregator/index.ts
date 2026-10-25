/** Public surface of the match aggregator; import from 'src/core/matchAggregator', not from its siblings. */

// Stateful GEP-stream accumulator (+ the shared match-boundary predicates)
export { MatchAggregator, RESUME_MAX_AGE_MS, isMatchStartMessage, isMatchInProgressMessage, isMatchEndMessage, isRoundStartMessage, isRoundEndMessage } from './aggregator';
export type { AggregatorCheckpoint, MatchAggregatorOptions } from './aggregator';

// Pure GEP value coercion (parseRoster is also exercised directly by tests)
export { parseRoster, asObject, asString, asNumber, partyCountFromInfo } from './gepValues';
