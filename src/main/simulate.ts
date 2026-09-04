import type { GepMessage } from '../core/model';

export interface SimOptions {
  battleTag: string;
  map: string;
}

/** One simulated GEP message and when it fires, in ms after `match_start`. */
export interface SimStep {
  at: number;
  msg: GepMessage;
}

/**
 * Real-capture pacing of a competitive match (ms after `match_start`):
 * `round_start` ~28 s in (hero select), `match_outcome` a few ms before the
 * final `round_end`, `match_end` ~40 s after it (POTG + scoreboard). The round
 * itself is a believable ~8 minutes so, replayed at real speed, its play
 * window clears every mode's setup lock and the aggregator measures a
 * positive played time.
 */
export const SIM_TIMING = {
  roundStartMs: 28_000,
  roundEndMs: 28_000 + 8 * 60_000,
  outcomeBeforeRoundEndMs: 3,
  matchEndAfterRoundEndMs: 40_000,
} as const;

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Builds the timed GEP message sequence for one finished competitive match,
 * identical in shape (and order) to what the live Game Events Provider emits,
 * including the `round_start` / `round_end` events the played-time measurement
 * hangs on. `match_end` is always the last step.
 */
export function buildCompetitiveTimeline(opts: SimOptions, matchId: string): SimStep[] {
  const info = (at: number, feature: string, key: string, value: unknown): SimStep => ({
    at,
    msg: { kind: 'info', feature, key, value },
  });
  const event = (at: number, key: string, value: unknown = true): SimStep => ({
    at,
    msg: { kind: 'event', feature: 'match_info', key, value },
  });
  const { roundStartMs, roundEndMs, outcomeBeforeRoundEndMs, matchEndAfterRoundEndMs } = SIM_TIMING;

  return [
    event(0, 'match_start'),
    info(100, 'game_info', 'battle_tag', opts.battleTag),
    info(200, 'game_info', 'game_type', 'Competitive'),
    info(300, 'game_info', 'game_queue_type', 'role'),
    info(400, 'game_info', 'party_player_count', 2),
    info(500, 'match_info', 'map', opts.map),
    info(600, 'match_info', 'pseudo_match_id', matchId),
    // Hero select ends: the first (and, for the simulation, only) round begins.
    // Real captures deliver the round events with a null value.
    event(roundStartMs, 'round_start', null),
    info(
      roundStartMs + 5 * 60_000,
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
    info(roundStartMs + 5 * 60_000 + 100, 'roster', 'roster_1', JSON.stringify({ name: 'Someone#1234', hero: 'Mercy', kills: 3 })),
    info(roundStartMs + 6 * 60_000, 'match_info', 'round_outcome', 'win'),
    info(roundStartMs + 7 * 60_000, 'match_info', 'round_outcome', 'loss'),
    info(roundEndMs - 1_000, 'match_info', 'round_outcome', 'win'),
    // The outcome lands a few ms BEFORE the final round_end, as captured live.
    info(roundEndMs - outcomeBeforeRoundEndMs, 'match_info', 'match_outcome', 'Victory'),
    event(roundEndMs, 'round_end', null),
    event(roundEndMs + matchEndAfterRoundEndMs, 'match_end'),
  ];
}

/**
 * The bare message sequence of {@link buildCompetitiveTimeline} (timing
 * dropped) — what the recorder tests and the roster-retention tests feed
 * through the aggregator with an injected clock.
 */
export function buildCompetitiveMatch(opts: SimOptions, matchId: string): GepMessage[] {
  return buildCompetitiveTimeline(opts, matchId).map((s) => s.msg);
}

/**
 * Speed-up applied to the simulated timeline by default: the ~9-minute match
 * plays out in about ten seconds. `OW_SYNC_SIM_SPEED=1` replays it at real
 * speed, so the ~8-minute round clears the setup lock and the played-time path
 * (rounds → `playedMinutes` → per-10) is exercised exactly as live.
 */
export const DEFAULT_SIM_SPEED = 60;

function simSpeedFromEnv(): number {
  const raw = Number(process.env.OW_SYNC_SIM_SPEED);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_SIM_SPEED;
}

/**
 * Feeds a simulated competitive match into the live pipeline via `feed`, one GEP
 * message at a time, paced by the timeline's offsets divided by `speed`. The
 * Match ID is prefixed `SIM-` so the resulting test row is easy to find and
 * delete.
 */
export async function runSimulation(
  feed: (msg: GepMessage) => void,
  log: (msg: string) => void,
  opts: SimOptions,
  speed: number = simSpeedFromEnv(),
): Promise<void> {
  const matchId = `SIM-${Date.now()}`;
  const steps = buildCompetitiveTimeline(opts, matchId);
  const last = steps[steps.length - 1];
  log(`simulation: feeding ${steps.length} messages for ${matchId} (${opts.battleTag} on ${opts.map}) at ${speed}× speed (~${Math.round(last.at / speed / 1000)} s)`);
  let prev = 0;
  for (const step of steps) {
    const wait = Math.max(0, (step.at - prev) / speed);
    if (wait) await delay(wait);
    prev = step.at;
    feed(step.msg);
  }
  log(`simulation: match_end sent for ${matchId} — Notion write should follow`);
}
