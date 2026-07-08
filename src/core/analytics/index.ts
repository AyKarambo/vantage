/** Public surface of the analytics layer; import from 'src/core/analytics', not from its siblings. */

// Vocabulary types
export type {
  HeroStat, MatchMental, CommsTone, TargetGrade, MatchReview, GameRecord,
  WinLoss, Group, FocusItem, FocusDimension, FocusTrend, FocusProgress, FocusEntry,
  HeroSummary, Streak,
} from './types';

// Grouping + win/loss aggregation
export {
  winLoss, groupBy, byMap, byRole, byAccount, byHero, byMode, focusBy, trend, dayKey,
} from './grouping';

// Cross-dimension focus ranking (the Focus screen's "work on these" hub)
export { focusEntries, focusTrend, focusGamesFor } from './focus';

// Per-hero stat rollups
export { heroStats } from './heroStats';

// Self-rated performance rollups (0–100 slider; issue #44)
export { performanceStats } from './performanceStats';
export type { PerformanceStats, PerformanceBucket, PerformanceTrendPoint } from './performanceStats';

// Most-played-heroes ranking (Log Match hero-picker shortlist)
export { mostPlayedHeroes } from './heroSuggestions';

// Session, streak & drill-down reads
export { streak, currentSession, calendar, heroDetail, groupByDay, sessionRecap } from './session';
export type { DayGroup, SessionRecap } from './session';

// Temporal splits (time of day, session position, fade detection)
export { byTimeOfDay, bySessionPosition, sessionFade } from './temporal';
export type { SessionFade } from './temporal';
