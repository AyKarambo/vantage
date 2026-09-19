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

export interface SessionCheckIn {
  /** When the check-in was logged. */
  at: number;
  mood: CheckInMood;
}

/** Copy for each mood, shared by every surface that offers the check-in. */
export const CHECK_IN_LABELS: Record<CheckInMood, string> = {
  calm: 'Calm',
  edgy: 'Edgy',
  tilted: 'Tilted',
};

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
