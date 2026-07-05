import type { GameRecord } from './analytics';

/**
 * Whether a record was hand-logged (◎ manual) or auto-tracked from the GEP feed.
 * Uses the explicit `source` when present; otherwise infers from the matchId —
 * manual logs (and Notion imports) use a `manual`-prefixed id, everything else
 * comes from the live pipeline. Pure and I/O-free.
 */
export function sourceOf(game: Pick<GameRecord, 'source' | 'matchId'>): 'manual' | 'gep' {
  if (game.source) return game.source;
  return game.matchId.startsWith('manual') ? 'manual' : 'gep';
}

/** True when the record's game-derived facts are locked in the match editor. */
export function isAutoTracked(game: Pick<GameRecord, 'source' | 'matchId'>): boolean {
  return sourceOf(game) === 'gep';
}
