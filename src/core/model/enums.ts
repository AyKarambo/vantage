/**
 * Closed string-literal vocabularies shared across the domain layer. Kept
 * separate from the record shapes so `import type` sites that only need a
 * vocabulary don't pull in the record interfaces.
 */

/** Notion `Role` select options. */
export type Role = 'damage' | 'tank' | 'support' | 'openQ';

/** Notion `Result` select options. */
export type Result = 'Win' | 'Loss' | 'Draw';
