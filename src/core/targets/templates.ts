/**
 * Curated target library behind the Targets page's "Target library" card — the
 * catalog a player browses (and can add straight into their own targets) rather
 * than authoring a target from scratch. The four categories mirror a decision-
 * timing split: Mechanics (alone in the practice range), Macro (during the
 * fight), Strategy (before the fight), Training (how you practise). Measured
 * `rule` strings use the exact `${stat} ${op} ${value}` format the builder
 * writes and its edit round-trip regex parses (see
 * `renderer/src/views/targets/builder.ts`); stats are drawn from
 * {@link MEASURED_STATS} so every measured entry round-trips.
 */
import type { TargetMode } from './types';

export interface TargetTemplate {
  name: string;
  mode: TargetMode;
  rule: string;
  /** One-line coaching context — shown as always-visible copy under the entry's
   *  name in the Target library card (not a hover tooltip). */
  blurb: string;
}

/** The four decision-timing groupings the Target library is organized under. */
export type TargetCategory = 'Mechanics' | 'Macro' | 'Strategy' | 'Training';

/** Which role(s) a library entry is written for — 'All Roles' when it applies universally. */
export type LibraryRole = 'Tank' | 'DPS' | 'Support' | 'All Roles';

export interface TargetLibraryEntry extends TargetTemplate {
  category: TargetCategory;
  role: LibraryRole;
}

/** Category ids in library display order, with the one-line scope shown under each heading. */
export const TARGET_CATEGORIES: ReadonlyArray<{ id: TargetCategory; scope: string }> = [
  { id: 'Mechanics', scope: 'Aim, movement, raw execution — what you can drill alone.' },
  { id: 'Macro', scope: 'Decisions during the fight — cooldowns, focus, staying alive.' },
  { id: 'Strategy', scope: 'Decided before the fight — ult economy, engages, picks.' },
  { id: 'Training', scope: 'How you practise — habits that make the rest stick.' },
];

export const TARGET_LIBRARY: readonly TargetLibraryEntry[] = [
  // Mechanics — aim, movement, raw execution; drillable alone in the practice range.
  {
    name: 'Crosshair at head height',
    mode: 'self',
    rule: 'You grade it',
    category: 'Mechanics',
    role: 'All Roles',
    blurb: 'Park your crosshair where heads will appear — corners, ledges, high ground — not on the floor.',
  },
  {
    name: 'Move while you shoot',
    mode: 'self',
    rule: 'You grade it',
    category: 'Mechanics',
    role: 'DPS',
    blurb: 'Strafe unpredictably through every duel — standing still to aim is how you get punished.',
  },
  {
    name: 'Track, don\'t flick',
    mode: 'self',
    rule: 'You grade it',
    category: 'Mechanics',
    role: 'DPS',
    blurb: 'Hold smooth tracking through strafes and jumps; save flicks for when they\'re forced.',
  },
  {
    name: 'DPS: 9k damage floor',
    mode: 'measured',
    rule: 'Damage ≥ 9000',
    category: 'Mechanics',
    role: 'DPS',
    blurb: 'Keep pressure up on a rough night — ~9k/10 is a solid DPS floor at most ranks.',
  },
  {
    name: 'Support: healing floor',
    mode: 'measured',
    rule: 'Healing ≥ 8000',
    category: 'Mechanics',
    role: 'Support',
    blurb: "A healing baseline so you're contributing, not just self-pocketing.",
  },
  // Macro — decisions during the fight: cooldowns, focus, staying alive.
  {
    name: 'Value every cooldown',
    mode: 'self',
    rule: 'You grade it',
    category: 'Macro',
    role: 'All Roles',
    blurb: 'Spend big cooldowns for a clear payoff, not on reflex.',
  },
  {
    name: 'Target the right one',
    mode: 'self',
    rule: 'You grade it',
    category: 'Macro',
    role: 'All Roles',
    blurb: 'Commit to the highest-value reachable target, not the closest.',
  },
  {
    name: 'Improve cover usage',
    mode: 'self',
    rule: 'You grade it',
    category: 'Macro',
    role: 'All Roles',
    blurb: "Use cover between engagements and before you commit — don't fight in the open.",
  },
  {
    name: 'Cut the feeding',
    mode: 'measured',
    rule: 'Deaths ≤ 3',
    category: 'Macro',
    role: 'All Roles',
    blurb: 'A death floor (per 10) — uptime, not frags, drives ult charge.',
  },
  {
    name: 'Tank: mitigation floor',
    mode: 'measured',
    rule: 'Mitigation ≥ 7000',
    category: 'Macro',
    role: 'Tank',
    blurb: "Eat the damage your team would've taken — mitigation is your scoreboard.",
  },
  // Strategy — decided before the fight: ult economy, engages, picks.
  {
    name: 'Track one enemy ult',
    mode: 'self',
    rule: 'You grade it',
    category: 'Strategy',
    role: 'All Roles',
    blurb: 'Each fight, know one key enemy ult — ult economy wins "unwinnable" fights.',
  },
  {
    name: 'Wait for the fifth',
    mode: 'self',
    rule: 'You grade it',
    category: 'Strategy',
    role: 'All Roles',
    blurb: "Don't open fights 4v5 — staggered entries lose won fights.",
  },
  {
    name: 'Play the win condition',
    mode: 'self',
    rule: 'You grade it',
    category: 'Strategy',
    role: 'All Roles',
    blurb: 'Before each round, name how this map is won — then pick and play toward it.',
  },
  {
    name: 'Swap with purpose',
    mode: 'self',
    rule: 'You grade it',
    category: 'Strategy',
    role: 'All Roles',
    blurb: 'Change heroes when the matchup demands it — a counterpick is a decision, not a defeat.',
  },
  // Training — how you practise; habits that make the rest stick.
  {
    name: 'Warm up before ranked',
    mode: 'self',
    rule: 'You grade it',
    category: 'Training',
    role: 'All Roles',
    blurb: 'Ten minutes of aim and movement warmup before your first competitive game.',
  },
  {
    name: 'Review one loss per session',
    mode: 'self',
    rule: 'You grade it',
    category: 'Training',
    role: 'All Roles',
    blurb: 'Watch one replay of a loss and name a single fixable mistake — yours, not your team\'s.',
  },
  {
    name: 'One focus at a time',
    mode: 'self',
    rule: 'You grade it',
    category: 'Training',
    role: 'All Roles',
    blurb: 'Pick a single improvement focus per session and grade only that — scattered attention trains nothing.',
  },
  {
    name: 'Stop at two losses',
    mode: 'self',
    rule: 'You grade it',
    category: 'Training',
    role: 'All Roles',
    blurb: 'End the session after two straight losses — tilted games teach tilted habits.',
  },
];
