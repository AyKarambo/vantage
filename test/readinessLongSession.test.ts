/**
 * T6 / #307 — the personal long-session threshold for the readiness load family.
 *
 * "Long" is long FOR THIS PLAYER: the P90 of their own session lengths over the last 30 days
 * (never below the 2.5h floor, and exactly the floor with fewer than 10 sessions). Only a session
 * that ended on the reference day or the day before counts, and the penalty grows continuously
 * from 0 at the threshold (strict >) to the cap (8) at 1.5 × the threshold.
 *
 * Fixture arithmetic: a session's minutes = (perDay − 1) × gapMin + 12 (the first game's default
 * duration), and the gap stays under the 90-minute session split so each day is ONE session.
 */
import { describe, it, expect } from 'vitest';
import { computeReadiness, READINESS_TUNING as T } from '../src/core/readiness';
import { dayOrdinal } from '../src/core/readiness/day';
import { detectSessions, type ReadinessSession } from '../src/core/readiness/sessions';
import { loadState, personalLongSessionMinutes, type LoadState } from '../src/core/readiness/signals';
import { loadParts } from '../src/core/readiness/score';
import { ts, span, CALM } from './readinessFixtures';

interface Shape {
  perDay: number;
  gapMin: number;
}

// Session shapes (minutes). All stay below absElevatedPerDay (6 games/day), so volume arms stay silent.
const S36: Shape = { perDay: 3, gapMin: 12 }; // a short evening
const S78: Shape = { perDay: 7, gapMin: 11 };
const S150: Shape = { perDay: 7, gapMin: 23 }; // exactly the floor
const S156: Shape = { perDay: 7, gapMin: 24 }; // 6 minutes over the floor
const S180: Shape = { perDay: 8, gapMin: 24 }; // 3.0h
const S200: Shape = { perDay: 5, gapMin: 47 };
const S210: Shape = { perDay: 4, gapMin: 66 }; // 3.5h
const S225: Shape = { perDay: 4, gapMin: 71 }; // 1.5 × the floor
const S264: Shape = { perDay: 5, gapMin: 63 }; // 4.4h
const S300: Shape = { perDay: 5, gapMin: 72 }; // 5.0h

/** One session per day in [from, to]. */
const sessionsOn = (from: number, to: number, shape: Shape) => span(from, to, { ...shape, mental: CALM });

/** A reference day far enough in that a 30-day window plus a 2-week span fit before it. */
const R = 40;
const refOrd = dayOrdinal(ts(R));

/**
 * The regular: in the 30 days before R, 21 short evenings and 9 long (4.4h) sessions, the last of them two
 * days back (so the day before R is short and cannot outrank today's session). Sorted, 30 sessions →
 * nearest-rank P90 is index ceil(27) − 1 = 26, which is a 264-minute one.
 */
const regular = (): ReturnType<typeof sessionsOn> => [
  ...sessionsOn(R - 30, R - 11, S36),
  ...sessionsOn(R - 10, R - 2, S264),
  ...sessionsOn(R - 1, R - 1, S36),
];

/** A steady, fully populated chronic window (20 prior days of short evenings) so the overload trust gate is open and no other arm nears its cap. */
const populated = (): ReturnType<typeof sessionsOn> => sessionsOn(R - 20, R - 1, S36);

/** The long-session penalty a LoadState charges, isolated by differencing against the same load without it. */
function longSessionPenalty(load: LoadState): number {
  const without: LoadState = { ...load, longSession: null, recentLongSession: false };
  return loadParts(load, 0, 1).overloadPen - loadParts(without, 0, 1).overloadPen;
}

const sessionOf = (endOrdinal: number, minutes: number): ReadinessSession => ({
  startedAt: 0,
  endedAt: 0,
  games: 1,
  minutes,
  endOrdinal,
});

describe('T6 fixtures — session shapes are the minutes they claim', () => {
  it.each([
    [S36, 36], [S78, 78], [S150, 150], [S156, 156], [S180, 180], [S200, 200],
    [S210, 210], [S225, 225], [S264, 264], [S300, 300],
  ])('%j is one session of %d minutes', (shape, minutes) => {
    const sessions = detectSessions(sessionsOn(0, 0, shape));
    expect(sessions).toHaveLength(1);
    expect(sessions[0].minutes).toBe(minutes);
  });
});

describe('T6 — personalLongSessionMinutes (nearest-rank P90, floored)', () => {
  const ref = 100;

  it('takes the nearest-rank P90 of the window: ceil(0.9 × n) − 1 into the ascending lengths', () => {
    // n = 10 → index 8 (the 9th smallest); input order must not matter.
    const ten = [290, 200, 260, 210, 280, 220, 250, 230, 240, 270].map((m, i) => sessionOf(ref - 1 - i, m));
    expect(personalLongSessionMinutes(ten, ref)).toBe(280);
    // n = 20 of 160..350 step 10 → index 17.
    const twenty = Array.from({ length: 20 }, (_, i) => sessionOf(ref - 1 - i, 160 + i * 10));
    expect(personalLongSessionMinutes(twenty, ref)).toBe(330);
  });

  it('never goes below the sessionLongMinutes floor', () => {
    const shortOnes = Array.from({ length: 12 }, (_, i) => sessionOf(ref - 1 - i, 78));
    expect(personalLongSessionMinutes(shortOnes, ref)).toBe(T.sessionLongMinutes);
  });

  it('is exactly the floor with fewer than longSessionMinSessions sessions, however long they are', () => {
    const nine = Array.from({ length: T.longSessionMinSessions - 1 }, (_, i) => sessionOf(ref - 1 - i, 300));
    expect(personalLongSessionMinutes(nine, ref)).toBe(T.sessionLongMinutes);
    expect(personalLongSessionMinutes([...nine, sessionOf(ref - 10, 300)], ref)).toBe(300);
    expect(personalLongSessionMinutes([], ref)).toBe(T.sessionLongMinutes);
  });

  it('counts sessions ending from refOrdinal − 30 to refOrdinal − 1 only', () => {
    // Nine in-window 300s: the tenth session decides whether the window reaches the minimum count.
    const nine = Array.from({ length: 9 }, (_, i) => sessionOf(ref - 2 - i, 300));
    const counted = (endOrdinal: number): number =>
      personalLongSessionMinutes([...nine, sessionOf(endOrdinal, 300)], ref);
    expect(counted(ref - 1)).toBe(300); // yesterday: in
    expect(counted(ref - T.longSessionWindowDays)).toBe(300); // 30 days back: in
    expect(counted(ref)).toBe(T.sessionLongMinutes); // today: not part of the baseline
    expect(counted(ref - T.longSessionWindowDays - 1)).toBe(T.sessionLongMinutes); // 31 days back: out
  });
});

describe('T6 AC10 — the threshold is personal: a regular long-session player is not penalized for their normal', () => {
  it('a 3.5h session against a 4.4h P90 is below the bar: severity 0, no penalty, no signal', () => {
    const games = [...regular(), ...sessionsOn(R, R, S210)];
    const load = loadState(games, refOrd);
    expect(load.longSession).toEqual({ minutes: 210, threshold: 264, severity: 0 });
    expect(load.recentLongSession).toBe(false);
    expect(load.highLoad).toBe(false); // the old flat 2.5h rule would have lit this
    expect(longSessionPenalty(load)).toBe(0);

    const r = computeReadiness(games, ts(R, 22));
    expect(r.signals.some((s) => s.key === 'long-session')).toBe(false);
  });

  it('a 5h session crosses it: severity (300 − 264) / (0.5 × 264) ≈ 0.273, penalty 8 × severity, label names 4.4h', () => {
    const games = [...regular(), ...sessionsOn(R, R, S300)];
    const load = loadState(games, refOrd);
    expect(load.longSession?.minutes).toBe(300);
    expect(load.longSession?.threshold).toBe(264);
    expect(load.longSession?.severity).toBeCloseTo((300 - 264) / (T.longSessionRampShare * 264), 10);
    expect(load.longSession!.severity).toBeGreaterThan(0);
    expect(load.longSession!.severity).toBeLessThanOrEqual(1);
    expect(load.recentLongSession).toBe(true);
    expect(load.highLoad).toBe(true);

    const pen = longSessionPenalty(load);
    expect(pen).toBeCloseTo(T.longSessionPen * load.longSession!.severity, 10);
    expect(pen).toBeGreaterThan(0);
    expect(pen).toBeLessThanOrEqual(T.longSessionPen);

    const r = computeReadiness(games, ts(R, 22));
    const signal = r.signals.find((s) => s.key === 'long-session');
    expect(signal?.severity).toBe('watch');
    expect(signal?.label).toContain('4.4h');
    expect(signal?.label).toBe('a 5.0h session — longer than 9 in 10 of your sessions (~4.4h)');
  });

  it('the 5h session lowers the readiness score below the 3.5h one (the penalty reaches the verdict)', () => {
    const at210 = computeReadiness([...regular(), ...sessionsOn(R, R, S210)], ts(R, 22));
    const at300 = computeReadiness([...regular(), ...sessionsOn(R, R, S300)], ts(R, 22));
    expect(at300.score!).toBeLessThan(at210.score!);
  });
});

describe('T6 AC11 — the threshold never drops below 2.5h, and needs 10 sessions to be personal', () => {
  it('a P90 of 1.3h over ≥10 sessions: the threshold is the 150-minute floor', () => {
    const games = [...sessionsOn(R - 30, R - 1, S78), ...sessionsOn(R, R, S200)];
    const load = loadState(games, refOrd);
    expect(load.longSession).not.toBeNull();
    expect(load.longSession!.threshold).toBe(T.sessionLongMinutes);
    expect(load.longSession!.severity).toBeCloseTo((200 - 150) / (0.5 * 150), 10);
    expect(longSessionPenalty(load)).toBeCloseTo(T.longSessionPen * ((200 - 150) / 75), 10);
  });

  it('fewer than 10 sessions in the 30 days: the threshold is the floor, even though those sessions were long', () => {
    const games = [...sessionsOn(R - 9, R - 1, S264), ...sessionsOn(R, R, S200)]; // 9 prior + today
    const load = loadState(games, refOrd);
    expect(load.longSession!.threshold).toBe(T.sessionLongMinutes);
    expect(load.longSession!.severity).toBeGreaterThan(0);
  });

  it('sessions older than the 30-day window do not count toward the minimum', () => {
    const games = [
      ...sessionsOn(R - 60, R - 49, S264), // twelve long ones, long gone
      ...sessionsOn(R - 5, R - 1, S264), // only five inside the window
      ...sessionsOn(R, R, S300),
    ];
    const load = loadState(games, refOrd);
    expect(load.longSession!.threshold).toBe(T.sessionLongMinutes);
    expect(load.longSession!.severity).toBe(1);
  });

  it('with no history the long-session signal states the plain 2.5h bar', () => {
    const games = [...sessionsOn(5, 34, S36), ...sessionsOn(35, 35, S180)];
    const r = computeReadiness(games, ts(35, 22));
    expect(r.signals.find((s) => s.key === 'long-session')?.label).toBe('a 3.0h session — over 2.5h');
  });
});

describe('T6 AC12 — only a session from the reference day or the day before counts', () => {
  it('an over-threshold session two days before the reference day (nothing since) costs nothing', () => {
    const games = sessionsOn(R - 2, R - 2, S300);
    const load = loadState(games, refOrd);
    expect(load.longSession).toBeNull();
    expect(load.recentLongSession).toBe(false);
    expect(longSessionPenalty(load)).toBe(0);
  });

  it('a long session five days ago no longer costs a week: shorter sessions since leave severity at 0', () => {
    const games = [...sessionsOn(R - 5, R - 5, S300), ...sessionsOn(R - 1, R, S36)];
    const load = loadState(games, refOrd);
    expect(load.longSession).toEqual({ minutes: 36, threshold: T.sessionLongMinutes, severity: 0 });
    expect(load.recentLongSession).toBe(false);
    expect(longSessionPenalty(load)).toBe(0);
  });

  it('yesterday still counts, and the longest of yesterday and today is the one rated', () => {
    const yesterday = loadState([...sessionsOn(R - 1, R - 1, S300), ...sessionsOn(R, R, S36)], refOrd);
    expect(yesterday.longSession!.minutes).toBe(300);
    expect(yesterday.longSession!.severity).toBe(1);

    const both = loadState([...sessionsOn(R - 1, R - 1, S200), ...sessionsOn(R, R, S300)], refOrd);
    expect(both.longSession!.minutes).toBe(300);
  });

});

describe('T6 — the penalty ramp (strict >, continuous, capped)', () => {
  it('a session exactly at the threshold costs nothing (strict >)', () => {
    // Personal threshold: every prior session is 264 minutes, so P90 = 264 and today's 264 is AT it.
    const personal = loadState([...sessionsOn(R - 30, R - 1, S264), ...sessionsOn(R, R, S264)], refOrd);
    expect(personal.longSession).toEqual({ minutes: 264, threshold: 264, severity: 0 });
    expect(personal.recentLongSession).toBe(false);
    expect(longSessionPenalty(personal)).toBe(0);

    // The floor: a 150-minute session sits exactly on 2.5h.
    const atFloor = loadState(sessionsOn(R, R, S150), refOrd);
    expect(atFloor.longSession).toEqual({ minutes: 150, threshold: 150, severity: 0 });
    expect(atFloor.recentLongSession).toBe(false);
  });

  it('just over the threshold costs only a sliver (no cliff at the edge)', () => {
    const load = loadState([...populated(), ...sessionsOn(R, R, S156)], refOrd);
    expect(load.longSession!.severity).toBeCloseTo(6 / 75, 10);
    expect(load.recentLongSession).toBe(true);
    expect(longSessionPenalty(load)).toBeCloseTo(T.longSessionPen * (6 / 75), 10);
  });

  it('reaches the full cap at 1.5 × the threshold and stays there beyond it', () => {
    const atFull = loadState([...populated(), ...sessionsOn(R, R, S225)], refOrd); // 225 = 150 × 1.5
    expect(atFull.longSession!.severity).toBeCloseTo(1, 10);
    expect(longSessionPenalty(atFull)).toBeCloseTo(T.longSessionPen, 10);

    const beyond = loadState([...populated(), ...sessionsOn(R, R, S300)], refOrd);
    expect(beyond.longSession!.severity).toBe(1);
    expect(longSessionPenalty(beyond)).toBeCloseTo(T.longSessionPen, 10);
  });
});
