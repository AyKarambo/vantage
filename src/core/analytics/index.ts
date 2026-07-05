/** Public surface of the analytics layer; import from 'src/core/analytics', not from its siblings. */

// Vocabulary types
export type {
  HeroStat, MatchMental, TargetGrade, MatchReview, GameRecord,
  WinLoss, Group, FocusItem, HeroSummary, Streak,
} from './types';

// Grouping + win/loss aggregation
export {
  winLoss, groupBy, byMap, byRole, byAccount, byHero, byMode, focusBy, trend, dayKey,
} from './grouping';

// Per-hero stat rollups
export { heroStats } from './heroStats';

// Session, streak & drill-down reads
export { streak, latestSession, calendar, heroDetail, groupByDay, sessionRecap } from './session';
export type { DayGroup, SessionRecap } from './session';

// Temporal splits (time of day, session position, fade detection)
export { byTimeOfDay, bySessionPosition, sessionFade } from './temporal';
export type { SessionFade } from './temporal';
