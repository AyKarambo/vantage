/**
 * Settings for the practice-focus layer of Mental/Review (issue #321): whether
 * practice mode shows, which optional check-in questions are asked, how long a
 * chosen focus target sticks on Review, and how breaks between games are
 * detected. Never read by readiness.
 */

export type PracticeFocusMode = 'auto' | 'on' | 'off';
export type FocusStickiness = 'game' | 'sitting' | 'sticky';
export type BreakDetection = 'auto' | 'manual';

export interface CheckInQuestions {
  sleep: boolean;
  energy: boolean;
  ate: boolean;
}

export interface CoachingSettings {
  /** Whether practice mode shows: automatic, always, or never. */
  practiceFocus: PracticeFocusMode;
  /** Which optional check-in questions are asked. */
  checkInQuestions: CheckInQuestions;
  /** How long a chosen focus target sticks: one game, the sitting, or until changed. */
  focusStickiness: FocusStickiness;
  /** Whether breaks between games are detected automatically or logged by hand. */
  breakDetection: BreakDetection;
  /** Gap that counts as a break when detection is automatic; minutes (5..60). */
  breakMinutes: number;
}

export const DEFAULT_COACHING: CoachingSettings = {
  practiceFocus: 'auto',
  checkInQuestions: { sleep: false, energy: false, ate: false },
  focusStickiness: 'sitting',
  breakDetection: 'auto',
  breakMinutes: 15,
};

const clampBreakMinutes = (n: number): number => Math.max(5, Math.min(60, Math.round(n)));

const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;

/** Coerce a partial/untrusted settings object into a valid, clamped one. */
export function normalizeCoachingSettings(s: Partial<CoachingSettings> | undefined | unknown): CoachingSettings {
  const raw = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
  const q = (raw.checkInQuestions && typeof raw.checkInQuestions === 'object'
    ? raw.checkInQuestions
    : {}) as Record<string, unknown>;
  const minutes = typeof raw.breakMinutes === 'number' && Number.isFinite(raw.breakMinutes)
    ? clampBreakMinutes(raw.breakMinutes)
    : DEFAULT_COACHING.breakMinutes;
  return {
    practiceFocus: oneOf(raw.practiceFocus, ['auto', 'on', 'off'], DEFAULT_COACHING.practiceFocus),
    checkInQuestions: {
      sleep: q.sleep === true,
      energy: q.energy === true,
      ate: q.ate === true,
    },
    focusStickiness: oneOf(raw.focusStickiness, ['game', 'sitting', 'sticky'], DEFAULT_COACHING.focusStickiness),
    breakDetection: oneOf(raw.breakDetection, ['auto', 'manual'], DEFAULT_COACHING.breakDetection),
    breakMinutes: minutes,
  };
}
