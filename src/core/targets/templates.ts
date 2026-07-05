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
  {
    name: 'Trade before you die',
    mode: 'measured',
    rule: 'Deaths ≤ 4',
    blurb: 'Cheap deaths bleed ult economy — die less, trade more.',
  },
  {
    name: 'Hold ult until first pick',
    mode: 'self',
    rule: 'You grade it',
    blurb: 'Banking ult for the opening pick swings fights before they start.',
  },
  {
    name: 'Callouts only — no tilt talk',
    mode: 'self',
    rule: 'You grade it',
    blurb: 'Keep comms information-only; tilt talk costs focus, not just vibes.',
  },
  {
    name: 'Warm up before ranked',
    mode: 'self',
    rule: 'You grade it',
    blurb: 'A few minutes of aim/movement warm-up before queueing pays off all session.',
  },
  {
    name: 'Review one loss per session',
    mode: 'self',
    rule: 'You grade it',
    blurb: 'One replayed loss beats ten unreviewed ones — find the repeatable mistake.',
  },
  {
    name: '9k damage per 10',
    mode: 'measured',
    rule: 'Damage ≥ 9000',
    blurb: 'A damage floor keeps you contributing even on a rough fight night.',
  },
];
