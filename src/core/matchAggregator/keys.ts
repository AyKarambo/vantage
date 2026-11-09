/**
 * The `K` table: every GEP feature/key spelling the aggregator matches on,
 * centralized in one place. Internal to the matchAggregator package — not part
 * of its public surface.
 *
 * NOTE: GEP feature/key spellings for Overwatch can shift between game patches.
 * All names we depend on are centralized in the `K` table below so they are easy to
 * adjust after inspecting a real capture (every raw message is logged by the app).
 */
export const K = {
  gameInfo: 'game_info',
  matchInfo: 'match_info',
  roster: 'roster',
  battleTag: 'battle_tag',
  gameType: 'game_type',
  queueType: 'game_queue_type',
  gameState: 'game_state',
  partySize: 'party_player_count',
  map: 'map',
  pseudoMatchId: 'pseudo_match_id',
  matchId: 'match_id',
  outcome: 'match_outcome',
  roundOutcome: 'round_outcome',
  /** `match_info.round_start` / `round_end` events — delimit the GEP rounds the played time is measured from. */
  roundStart: 'round_start',
  roundEnd: 'round_end',
  /** `game_info.game_mode` — tracked into `gepExtras`, not evaluated. */
  gameMode: 'game_mode',
  /** `gep_internal.version_info` — the GEP package version. */
  gepInternal: 'gep_internal',
  versionInfo: 'version_info',
  /** `kill.objective_kills` info-update. */
  killFeature: 'kill',
  objectiveKills: 'objective_kills',
  /** `match_info` events, tracked into `gepExtras`, not evaluated. */
  respawn: 'respawn',
  revive: 'revive',
  /** GEP 312+: the player quit the game / to desktop. */
  gameExit: 'game_exit',
  eliminations: 'eliminations',
  deaths: 'deaths',
  assists: 'assists',
  damage: 'damage',
  healing: 'healing',
  mitigation: 'mitigation',
  score: 'score',
} as const;
