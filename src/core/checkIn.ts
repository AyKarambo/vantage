/**
 * A one-click "how are you feeling right now" read, logged before queuing —
 * not derived from any game (S10 phase 2). Kept separate from
 * `GameRecord.mental` (the post-game self-report): this exists specifically
 * to test whether a player's OWN sense of their state BEFORE a sitting
 * predicts how that sitting actually goes, which a post-game flag can't
 * answer on its own.
 */
export type CheckInMood = 'calm' | 'edgy' | 'tilted';

export const CHECK_IN_MOODS: readonly CheckInMood[] = ['calm', 'edgy', 'tilted'];

/** Optional check-in question: how the player slept. */
export type CheckInSleep = 'poor' | 'ok' | 'good';

export const CHECK_IN_SLEEP: readonly CheckInSleep[] = ['poor', 'ok', 'good'];

/** Optional check-in question: how alert the player feels. */
export type CheckInEnergy = 'foggy' | 'ok' | 'sharp';

export const CHECK_IN_ENERGY: readonly CheckInEnergy[] = ['foggy', 'ok', 'sharp'];

export interface SessionCheckIn {
  /** When the check-in was logged. */
  at: number;
  mood: CheckInMood;
  /** Optional question, switched on in Settings › Coaching. Never read by readiness. */
  sleep?: CheckInSleep;
  /** Optional question, switched on in Settings › Coaching. Never read by readiness. */
  energy?: CheckInEnergy;
  /** Optional question ("have you eaten?"), switched on in Settings › Coaching. Never read by readiness. */
  ate?: boolean;
  /**
   * "Today's focus": the targets the player wants to work on. Pre-selects the
   * focus on Review for the sitting this check-in precedes only.
   */
  focusTargetIds?: string[];
}

/** What the renderer sends to log a check-in; `at` is stamped by the receiver. */
export interface CheckInInput {
  mood: CheckInMood;
  sleep?: CheckInSleep;
  energy?: CheckInEnergy;
  ate?: boolean;
  focusTargetIds?: string[];
}

/** Copy for each mood, shared by every surface that offers the check-in. */
export const CHECK_IN_LABELS: Record<CheckInMood, string> = {
  calm: 'Calm',
  edgy: 'Edgy',
  tilted: 'Tilted',
};

export const CHECK_IN_SLEEP_LABELS: Record<CheckInSleep, string> = {
  poor: 'Poor',
  ok: 'OK',
  good: 'Good',
};

export const CHECK_IN_ENERGY_LABELS: Record<CheckInEnergy, string> = {
  foggy: 'Foggy',
  ok: 'OK',
  sharp: 'Sharp',
};

/**
 * Validate an untrusted (IPC) check-in. Null when the mood isn't a real one;
 * otherwise copies only the valid optional fields — absent or invalid ones are
 * omitted, never defaulted, so a mood-only check-in stays `{ at, mood }`.
 */
export function normalizeCheckIn(input: unknown, at: number): SessionCheckIn | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  if (!CHECK_IN_MOODS.includes(raw.mood as CheckInMood)) return null;
  const entry: SessionCheckIn = { at, mood: raw.mood as CheckInMood };
  if (CHECK_IN_SLEEP.includes(raw.sleep as CheckInSleep)) entry.sleep = raw.sleep as CheckInSleep;
  if (CHECK_IN_ENERGY.includes(raw.energy as CheckInEnergy)) entry.energy = raw.energy as CheckInEnergy;
  if (typeof raw.ate === 'boolean') entry.ate = raw.ate;
  if (Array.isArray(raw.focusTargetIds)) {
    const ids = raw.focusTargetIds.filter((id): id is string => typeof id === 'string');
    if (ids.length) entry.focusTargetIds = ids;
  }
  return entry;
}

/**
 * How long a logged check-in still reads as "for the sitting about to start"
 * before the prompt returns. Deliberately the same value
 * `tiltByCheckIn`'s own default `gapMinutes` uses (`src/core/mentalAnalytics.ts`)
 * — the UI's "is my check-in still active" question and the analytics'
 * "did a check-in precede this sitting" question are the same question, so
 * the two independently-hardcoded 90s that answer it are kept equal on
 * purpose rather than sharing one import across a component/analytics
 * boundary that otherwise has no reason to know about the other.
 */
export const CHECK_IN_FRESH_MINUTES = 90;
