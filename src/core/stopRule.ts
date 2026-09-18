import type { Group } from './analytics';
import { sessionFade } from './analytics';
import { COST_MIN_SAMPLE, type TiltPositionBucket } from './mentalAnalytics';
import type { BreakReminderSettings } from './breakReminder';

/**
 * Turns the tilt-by-session and winrate-fade reads into one concrete "when to
 * stop" sentence (S10 phase 1) — Mental, the Overview Mental card and the idle
 * Live screen all showed the ingredients (a fade point on Trends, a tilt peak
 * on Mental, a break-reminder threshold in Settings) on three different
 * screens with no rule combining them into an actual plan.
 */
export interface StopRule {
  /** The session position ('1'..'6+') to stop at/after, when one is readable. */
  position: string | null;
  /** The break reminder's configured threshold, when the reminder is on. */
  afterLosses: number | null;
  /** The one-line coach sentence — null when neither ingredient has a read. */
  sentence: string | null;
}

/**
 * `position` prefers the tilt-by-session peak over the winrate fade: tilt IS
 * the mental-state signal this rule exists to act on, and a winrate dip can
 * have causes a stop rule can't fix (a rough matchup, an off night on a
 * specific hero) where a rising tilt rate is squarely a "stop now" read.
 * Falls back to the fade point only when tilt has no sample-gated peak.
 */
export function stopRule(
  sessionPosition: Group[],
  tiltBySession: readonly TiltPositionBucket[],
  breakReminder: BreakReminderSettings,
): StopRule {
  const tiltPeak = [...tiltBySession]
    .filter((b) => b.games >= COST_MIN_SAMPLE && b.tilted > 0)
    .sort((a, b) => b.rate - a.rate)[0];
  const fade = sessionFade(sessionPosition);
  const position = tiltPeak?.key ?? fade?.position ?? null;
  const afterLosses = breakReminder.enabled ? breakReminder.afterLosses : null;

  if (position === null && afterLosses === null) {
    return { position: null, afterLosses: null, sentence: null };
  }
  const lossClause = afterLosses ? `${afterLosses} loss${afterLosses === 1 ? '' : 'es'} in a row` : null;
  const positionClause = position ? `end after game ${position}` : null;
  const sentence = positionClause && lossClause
    ? `Your stop rule: ${positionClause} or ${lossClause}.`
    : `Your stop rule: ${positionClause ?? lossClause}.`;
  return { position, afterLosses, sentence };
}
