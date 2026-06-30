import type { GepMessage } from '../core/model';

export interface SimOptions {
  battleTag: string;
  map: string;
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Builds the GEP message sequence for one finished competitive match, identical
 * in shape to what the live Game Events Provider emits. Used by dev simulation
 * mode to exercise the real pipeline (aggregator → resolve → filter → dedupe →
 * Notion write) without needing the live game feed.
 */
export function buildCompetitiveMatch(opts: SimOptions, matchId: string): GepMessage[] {
  const info = (feature: string, key: string, value: unknown): GepMessage => ({
    kind: 'info',
    feature,
    key,
    value,
  });
  const event = (key: string): GepMessage => ({ kind: 'event', feature: 'match_info', key, value: true });

  return [
    event('match_start'),
    info('game_info', 'battle_tag', opts.battleTag),
    info('game_info', 'game_type', 'Competitive'),
    info('game_info', 'game_queue_type', 'role'),
    info('game_info', 'party_player_count', 2),
    info('match_info', 'map', opts.map),
    info('match_info', 'pseudo_match_id', matchId),
    info(
      'roster',
      'roster_0',
      JSON.stringify({
        name: opts.battleTag,
        hero: 'Tracer',
        role: 'damage',
        kills: 23,
        deaths: 7,
        assists: 9,
        damage: 11000,
        healing: 0,
        mitigation: 0,
      }),
    ),
    // an enemy/teammate row that must be ignored
    info('roster', 'roster_1', JSON.stringify({ name: 'Someone#1234', hero: 'Mercy', kills: 3 })),
    info('match_info', 'round_outcome', 'win'),
    info('match_info', 'round_outcome', 'loss'),
    info('match_info', 'round_outcome', 'win'),
    info('match_info', 'match_outcome', 'Victory'),
    event('match_end'),
  ];
}

/**
 * Feeds a simulated competitive match into the live pipeline via `feed`, one GEP
 * message at a time. The Match ID is prefixed `SIM-` so the resulting test row is
 * easy to find and delete.
 */
export async function runSimulation(
  feed: (msg: GepMessage) => void,
  log: (msg: string) => void,
  opts: SimOptions,
): Promise<void> {
  const matchId = `SIM-${Date.now()}`;
  const messages = buildCompetitiveMatch(opts, matchId);
  log(`simulation: feeding ${messages.length} messages for ${matchId} (${opts.battleTag} on ${opts.map})`);
  for (const msg of messages) {
    feed(msg);
    await delay(120);
  }
  log(`simulation: match_end sent for ${matchId} — Notion write should follow`);
}
