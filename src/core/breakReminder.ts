// Streak lives in core/analytics — core types flow core → shared, never back.
import type { Streak } from './analytics';

/**
 * "Time for a break?" reminder — a pure state machine over the current win/loss
 * streak. Fires when the streak is a loss streak at or past the configured
 * threshold, re-firing every further `afterLosses` losses so a longer tilt
 * spiral keeps getting nudged; re-arms as soon as the streak stops being a
 * loss streak (a win, or no decided games).
 *
 * Pure and Electron-free, like the rest of `core/` — the main process holds the
 * state and calls `nextBreakReminder` after every recorded game.
 */

export interface BreakReminderSettings {
  enabled: boolean;
  /** Consecutive losses before firing; clamped to 1..10. */
  afterLosses: number;
}

export const DEFAULT_BREAK_REMINDER: BreakReminderSettings = { enabled: true, afterLosses: 2 };

/** 0 = armed (nothing fired yet for the current streak). */
export interface BreakReminderState {
  firedAtCount: number;
}

export const INITIAL_BREAK_REMINDER_STATE: BreakReminderState = { firedAtCount: 0 };

/** Clamp a threshold to the supported 1..10 range. */
export function clampAfterLosses(n: number): number {
  return Math.max(1, Math.min(10, Math.round(n)));
}

export function normalizeBreakReminder(s: Partial<BreakReminderSettings> | undefined): BreakReminderSettings {
  return {
    enabled: s?.enabled ?? DEFAULT_BREAK_REMINDER.enabled,
    afterLosses: clampAfterLosses(s?.afterLosses ?? DEFAULT_BREAK_REMINDER.afterLosses),
  };
}

/**
 * Given the current streak and settings, decide whether to fire the reminder
 * now and return the next state.
 *
 * - Re-arms (firedAtCount → 0) whenever the streak type is not 'L' (a win or no
 *   decided games breaks a loss spiral).
 * - Fires the first time `count` reaches the threshold, then again every further
 *   `afterLosses` losses (threshold, threshold + afterLosses, …).
 * - Never fires twice for the same count, and never fires when disabled.
 */
export function nextBreakReminder(
  streak: Streak,
  settings: BreakReminderSettings,
  state: BreakReminderState,
): { fire: boolean; state: BreakReminderState } {
  if (streak.type !== 'L') return { fire: false, state: INITIAL_BREAK_REMINDER_STATE };

  const { enabled, afterLosses } = normalizeBreakReminder(settings);
  if (!enabled) return { fire: false, state };

  const threshold = afterLosses;
  if (streak.count < threshold) return { fire: false, state };

  const stepsPast = streak.count - threshold;
  if (stepsPast % afterLosses !== 0) return { fire: false, state };
  if (state.firedAtCount === streak.count) return { fire: false, state };

  return { fire: true, state: { firedAtCount: streak.count } };
}
