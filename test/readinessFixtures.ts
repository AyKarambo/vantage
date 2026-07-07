/**
 * Shared fixture builders for the readiness test suites. Timestamps are built
 * from LOCAL Date values in a DST-stable window (June–July 2026), so
 * day-ordinal math is consistent regardless of the CI runner's timezone.
 * (Not a .test.ts file — vitest does not collect it.)
 */

import type { GameRecord, MatchMental, TargetGrade } from '../src/core/analytics';
import type { Result, Role } from '../src/core/model';
import type { AuthoredTarget } from '../src/core/targets';

export const MIN = 60_000;
let seq = 0;

export function ts(dayIndex: number, hour = 14, min = 0): number {
  return new Date(2026, 5, 1 + dayIndex, hour, min, 0).getTime();
}

export function game(p: Partial<GameRecord> & { timestamp: number }): GameRecord {
  return {
    matchId: p.matchId ?? `f${seq++}`,
    account: 'Main',
    role: 'damage' as Role,
    map: 'Ilios',
    result: 'Win' as Result,
    gameType: 'Competitive',
    heroes: ['Tracer'],
    ...p,
  };
}

export const TILT: MatchMental = { tilt: true };
export const CALM: MatchMental = { tilt: false, positiveComms: true };

export interface SpanOpts {
  perDay: number;
  result?: Result;
  mental?: MatchMental;
  gapMin?: number;
  hour?: number;
  account?: string;
  role?: Role;
}

/** Build `perDay` games on each day in [fromDay, toDay]. */
export function span(fromDay: number, toDay: number, opts: SpanOpts): GameRecord[] {
  const { perDay, result = 'Win', mental, gapMin = 12, hour = 14, account = 'Main', role } = opts;
  const out: GameRecord[] = [];
  for (let d = fromDay; d <= toDay; d += 1) {
    for (let i = 0; i < perDay; i += 1) {
      out.push(game({ timestamp: ts(d, hour) + i * gapMin * MIN, result, mental, account, ...(role ? { role } : {}) }));
    }
  }
  return out;
}

export interface StatOpts extends SpanOpts {
  hero?: string;
  damage?: number;
  deaths?: number;
  elims?: number;
  healing?: number;
  /** durationMinutes; default 10 so per-game totals read directly as per-10 rates. */
  duration?: number;
}

/** Like span(), but each game is single-hero with real perHero stats + duration. */
export function statSpan(fromDay: number, toDay: number, o: StatOpts): GameRecord[] {
  const { hero = 'Tracer', damage = 8000, deaths = 5, elims = 20, healing = 0, duration = 10 } = o;
  return span(fromDay, toDay, o).map((g) => ({
    ...g,
    heroes: [hero],
    durationMinutes: duration,
    perHero: [{ hero, role: g.role, eliminations: elims, deaths, assists: 5, damage, healing, mitigation: 0 }],
  }));
}

/** Attach a Review (grades + neutral flags) to a game. */
export function graded(g: GameRecord, grades: Record<string, TargetGrade>): GameRecord {
  return { ...g, review: { at: g.timestamp + MIN, grades, flags: g.mental ?? {} } };
}

/** An authored improvement target, active by default. */
export function target(id: string, createdAtDay: number, p: Partial<AuthoredTarget> = {}): AuthoredTarget {
  return {
    id,
    name: id,
    mode: 'self',
    rule: 'test rule',
    createdAt: ts(createdAtDay, 9),
    isActive: true,
    ...p,
  };
}
