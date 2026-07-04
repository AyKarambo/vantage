/**
 * Domain types for the Overwatch → Notion Gametracker sync.
 *
 * These are intentionally free of any Electron / Overwolf / Notion imports so the
 * whole `core/` layer stays pure and unit-testable.
 */

// Vocabularies
export type { Role, Result, LogFilter } from './enums';

// GEP wire shape
export type { GepMessage } from './gep';

// Match record trio
export type { RosterPlayer, MatchRecord, HeroStat } from './match';
export { emptyMatch } from './match';

// BattleTag identity
export { battleTagName } from './battleTag';
