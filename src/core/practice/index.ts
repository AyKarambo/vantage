/**
 * Public surface of the practice layer (issue #321); import from '../practice', not from its siblings.
 */
export {
  PRACTICE_SITTING_GAP_MINUTES, sittingsOf, checkInForSitting, autoBreakBefore, breakBefore, gameContexts,
  type GameContext,
} from './sittings';
export { focusOf, hasFocusChoice, practiceFocusOn, focusPreselection, focusPreselector, focusGamesSince } from './focus';
export {
  executionOf, executionByTarget, sittingExecution, factorTable, factorHeadline, weakestDays, sittingRecap, tiltByCheckInField,
  FACTOR_LEVELS, FACTOR_LABELS, HEADLINE_MIN_GAP, WEAK_DAY_MIN_RATED,
  type ExecutionTally, type SittingExecution, type FactorKey, type FactorRow, type FactorEntry,
  type FactorHeadline, type WeakDay, type SittingRecap, type PracticeSummary,
} from './analytics';
