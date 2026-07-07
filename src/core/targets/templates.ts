/**
 * Curated starter library for the Targets builder — a "Start from a template"
 * chip row picks one of these to prefill name/mode/rule. Measured `rule` strings
 * use the exact `${stat} ${op} ${value}` format the builder writes and its edit
 * round-trip regex parses (see `renderer/src/views/targets/builder.ts`); stats
 * are drawn from the builder's `STATS` list so every measured template round-trips.
 */
import type { TargetMode } from './types';

export interface TargetTemplate {
  name: string;
  mode: TargetMode;
  rule: string;
  /** One-line coaching context, shown as the chip's `title` tooltip. */
  blurb: string;
}

export const TARGET_TEMPLATES: TargetTemplate[] = [
  // Process fundamentals (self-rated) — the coaching hierarchy: patience →
  // positioning → ult economy → cooldown value → target selection.
  {
    name: 'Wait for the fifth',
    mode: 'self',
    rule: 'You grade it',
    blurb: "Don't open fights 4v5 — staggered entries lose won fights.",
  },
  {
    name: 'Improve cover usage',
    mode: 'self',
    rule: 'You grade it',
    blurb: "Use cover between engagements and before you commit — don't fight in the open.",
  },
  {
    name: 'Track one enemy ult',
    mode: 'self',
    rule: 'You grade it',
    blurb: 'Each fight, know one key enemy ult — ult economy wins "unwinnable" fights.',
  },
  {
    name: 'Value every cooldown',
    mode: 'self',
    rule: 'You grade it',
    blurb: 'Spend big cooldowns for a clear payoff, not on reflex.',
  },
  {
    name: 'Target the right one',
    mode: 'self',
    rule: 'You grade it',
    blurb: 'Commit to the highest-value reachable target, not the closest.',
  },
  // Measured stat floors (auto-graded from per-10-minute stats) — role tagged
  // in the name since a raw stat floor only makes sense for one role.
  {
    name: 'Cut the feeding',
    mode: 'measured',
    rule: 'Deaths ≤ 3',
    blurb: 'A death floor (per 10) — uptime, not frags, drives ult charge.',
  },
  {
    name: 'DPS: 9k damage floor',
    mode: 'measured',
    rule: 'Damage ≥ 9000',
    blurb: 'Keep pressure up on a rough night — ~9k/10 is a solid DPS floor at most ranks.',
  },
  {
    name: 'Support: healing floor',
    mode: 'measured',
    rule: 'Healing ≥ 8000',
    blurb: "A healing baseline so you're contributing, not just self-pocketing.",
  },
  {
    name: 'Tank: mitigation floor',
    mode: 'measured',
    rule: 'Mitigation ≥ 7000',
    blurb: "Eat the damage your team would've taken — mitigation is your scoreboard.",
  },
];
