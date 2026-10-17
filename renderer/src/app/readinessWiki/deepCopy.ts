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

  /** Performance deep tier: the form curve (sustained slumps and good stretches). */
  declineDetection(): string {
    return (
      `A dip only counts when it is SUSTAINED, not one bad game. Your form is a running average of how each game compares with your baseline, ` +
      `where every new game moves it ${dc.formLambda} of the way — so one game can never tip it. Inside ±${dc.formDeadband} it is ordinary variance; ` +
      `below that it costs points, above it it earns a small bonus, and both need at least ${dc.evidenceMinGames} recent games. ` +
      `It reads your CURRENT form, so the cost goes away as soon as your games are back at your usual. ` +
      `A game where you swapped heroes still counts, for the hero you mostly played: that hero needs at least ${dc.dominantHeroSharePct}% of your time in the game, and it is scored on its own stats over its own minutes. ` +
      `Games that don't record time per hero are left out, so nothing is guessed. ` +
      `Heroes inside their first ${dc.heroLearnGames} games are exempt — counted across ALL your accounts, because hero experience is yours, not the account's — ` +
      `so early games learning something new never count against you.`
    );
  },

  /** Performance deep tier: several accounts, one player — the main account carries the verdict, rank-aware alt weighting. */
  accountWeighting(): string {
    return (
      `Play on more than one account and the one you have played most lately is your main — it carries the verdict. ` +
      `Every check below runs on all your games the same way; what changes is how much each alt game is worth. ` +
      `An alt game counts in FULL as long as it was played within ${dc.altRankCloseGapDivisions} divisions of the rank you've usually held over your last ${dc.mainRankWindowDays} days — that's not smurfing, it's the same level on a second account. ` +
      `Only once the gap passes ${dc.altRankSmurfGapDivisions} divisions below your usual rank does it bottom out, at ×${dc.altRankFloorWeight}; in between, it tapers. ` +
      `Playing at or above your usual rank on an alt is never penalised, whatever the reason. ` +
      `That applies to credit as much as to blame: an alt week can neither cost nor earn what the same week on your main would. ` +
      `Falls back to a flat ×${dc.altAccountWeight} wherever a rank can't be read at all — no anchor set on one side or the other. ` +
      `Stats are still compared to each account's own usual, so an alt's lobbies never skew your main's baseline.`
    );
  },

  /** Subjective deep tier: the tilt caps, both regime endpoints. */
  tiltCaps(): string {
    return (
      `Self-report is deliberately weak: with full live stats the tilt penalty is capped at ${dc.tiltPenCap} points. ` +
      `On manual logs it widens to ${dc.tiltPenCapManual}, but a feeling never outweighs the objective evidence.`
    );
  },

  /** Guardrails deep tier: the deliberate-practice dampener + the winrate significance/corroboration rules + the outcome cap. */
  dampenerAndOutcomeCap(): string {
    return (
      `Two guardrails keep the score fair. When you're actively hitting improvement targets, a results dip is halved (×${dc.dampFactor}) — ` +
      `you're worse because you're practising. And a losing stretch has to prove itself: your winrate must sit at least ${dc.wrDipMinPoints} points under your usual ` +
      `and at least ${dc.wrSignificanceZ} standard errors away (the swing luck alone makes at your sample size), so a few coin-flip losses never count. ` +
      `Even then, with live stats it only costs points to the extent your own form is down too — matchmaking pulls every winrate toward 50%, ` +
      `so losses while your stats hold are a note, not a penalty. ` +
      `With live stats, losing alone can never move the score more than ${dc.wrPenaltyCap} points. ` +
      `On manual logs there are no stats to check it against, so a real dip counts on its own, up to ${dc.wrPenaltyCapManual}.`
    );
  },

  /** Training-load deep tier: the personal long-session bar and its ramp. */
  longSessions(): string {
    return (
      `Session length is judged against your own habits. A session is long once it runs longer than ${dc.longSessionPercentile}% of your own sessions from the last ${dc.longSessionWindowDays} days, ` +
      `and never below ${dc.longSessionFloorHours} hours — that is also the bar until you have ${dc.longSessionMinSessions} sessions in that window to learn from. ` +
      `Only a session from today or yesterday counts. The cost ramps up from 0 at that bar to ${dc.longSessionPen} points at ${dc.longSessionRampMultiple}× it, ` +
      `so there is no cliff, and someone who regularly plays long isn't penalised for their normal.`
    );
  },

  /** Verdict deep tier: the four gates behind 'high' confidence. */
  confidenceGates(): string {
    return (
      `High confidence needs all four of these, judged on your recent games only: you played on at least ${dc.confidenceActiveDays} of the last ${dc.confidenceWindowDays} days; ` +
      `at least ${dc.statCoverageHighPct}% of your last week's games have live stats to compare; ` +
      `enough decided games on one account to compare your winrate (${dc.wrMinDecidedAcute}+ this week and ${dc.wrMinDecidedBase}+ in the two weeks before); ` +
      `and at least ${dc.accountMixBarPct}% of this week's read comes from your main account — an alt at your main's level counts as your main. ` +
      `Miss any one and it stays at medium (or low, with almost no comparable stats). ` +
      `How much history you have in total doesn't count, so a long history alone never raises it. The Readiness screen lists whichever gates you're missing.`
    );
  },

  /** Trend / supercompensation deep tier: rest bonus (used up over the first games), rust decay + floor. */
  restAndRust(): string {
    return (
      `Rest follows a curve, not a line. A few days off build a bonus up to +${dc.restRecoveryCap} (the supercompensation peak), ` +
      `then sharpness decays about ${dc.rustDecayPerDay} points a day, treated as rusty from day ${dc.rustDays}, and floored at ${dc.rustFloor} — a long break reads dull, never wrecked. ` +
      `That bonus is waiting on the morning of a play day, and it is used up over your first games, not by the first one: ` +
      `it fades across about ${dc.restCarryPct}% of the games you usually play in a day, never fewer than ${dc.restCarryMinGames} or more than ${dc.restCarryMaxGames}.`
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
