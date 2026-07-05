/**
 * Gap-based session detection (timezone-independent) and per-day game counts.
 *
 * A session is a run of games with less than `sessionGapMinutes` between
 * consecutive match-end timestamps. Because timestamps are match-END times, a
 * session's raw span undercounts real time-on-task by roughly one game, so
 * `minutes` adds the first game's duration back.
 */

import type { GameRecord } from '../analytics';
import { READINESS_TUNING } from './constants';
import { dayOrdinal } from './day';

export interface ReadinessSession {
  startedAt: number;
  endedAt: number;
  games: number;
  /** Estimated real time-on-task in minutes (span + first-game duration). */
  minutes: number;
  /** Local day ordinal of the session's last game. */
  endOrdinal: number;
}

/** Split games into sessions (input need not be sorted). */
export function detectSessions(
  games: GameRecord[],
  gapMinutes: number = READINESS_TUNING.sessionGapMinutes,
): ReadinessSession[] {
  if (games.length === 0) return [];
  const sorted = [...games].sort((a, b) => a.timestamp - b.timestamp);
  const gapMs = gapMinutes * 60_000;
  const sessions: ReadinessSession[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  let count = 0;

  const flush = (last: GameRecord): void => {
    const span = (last.timestamp - start.timestamp) / 60_000;
    const firstDuration = start.durationMinutes ?? READINESS_TUNING.defaultGameMinutes;
    sessions.push({
      startedAt: start.timestamp,
      endedAt: last.timestamp,
      games: count,
      minutes: Math.round(span + firstDuration),
      endOrdinal: dayOrdinal(last.timestamp),
    });
  };

  for (const g of sorted) {
    if (g.timestamp - prev.timestamp > gapMs) {
      flush(prev);
      start = g;
      count = 0;
    }
    count += 1;
    prev = g;
  }
  flush(prev);
  return sessions;
}

/** Games per local day ordinal, for the games in `games`. */
export function gamesByDay(games: GameRecord[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const g of games) {
    const ord = dayOrdinal(g.timestamp);
    counts.set(ord, (counts.get(ord) ?? 0) + 1);
  }
  return counts;
}
