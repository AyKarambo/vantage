/**
 * Deep-tier copy — the "for the curious" sentences that quote real mechanics.
 * Pure string builders that interpolate {@link deepConstants}, so the exact
 * numbers are DERIVED from the engine and asserted by the drift guard (both the
 * constants AND the rendered prose). DOM-free; the article `deep()` builders
 * render these as plain text.
 *
 * Numbers are framed as the STATS regime, with an explicit "manual widens" note,
 * so a manual-log user is never misled by a bound that doesn't apply to them.
 */

import { deepConstants as dc } from './deepConstants';

export const deepCopy = {
  /** Verdict / "what moves the score" deep tier: the anchor + the three family caps. */
  anchorAndCaps(): string {
    return (
      `Everyone starts at a neutral ${dc.anchor}, and three families push it from there. ` +
      `At full live-stat coverage the caps are asymmetric: training load −${dc.loadCapDown}/+${dc.loadCapUp}, ` +
      `performance vs your baseline −${dc.perfCapDown}/+${dc.perfCapUp}, and self-report −${dc.subjCapDown}/+${dc.subjCapUp}. ` +
      `On manual logs the self-report floor widens to −${dc.subjCapDownManual} so a feeling can still move a score the stats can't see.`
    );
  },

  /** Training-load deep tier: the acute:chronic ratio bands. */
  loadRatio(): string {
    return (
      `Recent volume is compared to your own rolling baseline as a ratio. ` +
      `At or below ${dc.ratioFreshMax}× (with low volume) you read fresh; ${dc.ratioElevated}× is "elevated" and ${dc.ratioHigh}× is "high" — ` +
      `only a genuine surge above your norm costs points, because habit is not risk.`
    );
  },

  /** Performance deep tier: sustained-decline (CUSUM) detection. */
  declineDetection(): string {
    return (
      `A dip only counts when it is SUSTAINED, not one bad game. A one-sided tally adds up how far each game falls below your baseline ` +
      `(ignoring the first ${dc.cusumSlack} of noise) and only fires once it crosses ${dc.cusumThreshold} across at least ${dc.evidenceMinGames} recent games. ` +
      `Heroes inside their first ${dc.heroLearnGames} games are exempt — early games learning something new never count against you.`
    );
  },

  /** Subjective deep tier: the tilt caps, both regime endpoints. */
  tiltCaps(): string {
    return (
      `Self-report is deliberately weak: with full live stats the tilt penalty is capped at ${dc.tiltPenCap} points. ` +
      `On manual logs it widens to ${dc.tiltPenCapManual}, but a feeling never outweighs the objective evidence.`
    );
  },

  /** Guardrails deep tier: the deliberate-practice dampener + the outcome cap. */
  dampenerAndOutcomeCap(): string {
    return (
      `Two guardrails keep the score fair. When you're actively hitting improvement targets, a results dip is halved (×${dc.dampFactor}) — ` +
      `you're worse because you're practising. And losing alone is capped at ${dc.wrPenaltyCap} points: you can play your best and lose a pile of coin flips.`
    );
  },

  /** Trend / supercompensation deep tier: rest bonus, rust decay + floor. */
  restAndRust(): string {
    return (
      `Rest follows a curve, not a line. A few days off build a bonus up to +${dc.restRecoveryCap} (the supercompensation peak), ` +
      `then sharpness decays about ${dc.rustDecayPerDay} points a day, treated as rusty from day ${dc.rustDays}, and floored at ${dc.rustFloor} — a long break reads dull, never wrecked.`
    );
  },

  /** Trend deep tier: the rank-gated consistency nudge. */
  rankNudge(): string {
    return (
      `Playing few days a week only earns a nudge when your tracked rank has provably not climbed for about ${dc.rankStagnationWindowDays} days ` +
      `(it needs a window of at least ${dc.rankEvidenceMinDays} days with ${dc.rankEvidenceMinDeltas}+ logged SR changes, and no account gaining ${dc.rankClimbMinPoints}+ points). ` +
      `Below ${dc.lowFrequencyDaysPerWeek} active days a week it adds at most a ${dc.freqPenCap}-point nudge — never an alarm.`
    );
  },
} as const;
