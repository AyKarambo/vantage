/** Public surface of the match aggregator; import from 'src/core/matchAggregator', not from its siblings. */

// Stateful GEP-stream accumulator
export { MatchAggregator } from './aggregator';

// Pure GEP value coercion (parseRoster is also exercised directly by tests)
export { parseRoster, asObject, asString, asNumber } from './gepValues';
