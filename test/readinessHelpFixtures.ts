/**
 * Fixtures for the readiness help-wiki suites (matcher / walkthrough / scenario
 * drift). Each mirrors an engine-verified story from readinessScenarios.test.ts,
 * paired with the curated archetype a live read of it should match (`curatedId`,
 * or `null` when the read is data-suppressed and personalization must stay off).
 * (Not a .test.ts file — vitest does not collect it.)
 */

import { span, statSpan, graded, target, ts, TILT, CALM } from './readinessFixtures';
import type { GameRecord } from '../src/core/analytics';
import type { ReadinessContext } from '../src/core/readiness';

export interface HelpFixture {
  story: string;
  /** Expected nearest curated archetype, or null when the read is data-suppressed. */
  curatedId: string | null;
  games: GameRecord[];
  now: number;
  ctx: ReadinessContext;
  expect: { band: string; regime: string; confidence: string };
}

export const HELP_FIXTURES: Record<string, HelpFixture> = {
  'evening-hobbyist-calm': {
    story: 'Calm evening hobbyist with a weekly rest day',
    curatedId: 'evening-hobbyist-calm',
    games: (() => {
      const g: GameRecord[] = [];
      for (let d = 0; d <= 24; d += 1) {
        if (d === 6 || d === 13 || d === 20) continue;
        g.push(...span(d, d, { perDay: 3, mental: CALM }));
      }
      return g;
    })(),
    now: ts(24, 20),
    ctx: { targets: [] },
    expect: { band: 'fresh', regime: 'manual', confidence: 'medium' },
  },

  'grind-all-gep': {
    story: 'High-volume grind, fully measured (b=1)',
    curatedId: 'measured-grind-green',
    games: statSpan(0, 29, { perDay: 10, hero: 'Tracer', result: 'Win', mental: CALM }),
    now: ts(29, 20),
    ctx: { targets: [] },
    expect: { band: 'steady', regime: 'stats', confidence: 'high' },
  },

  'stats-grinder-habit-b1': {
    story: 'Habit-is-not-risk grinder at full stats coverage',
    curatedId: 'measured-grind-green',
    games: statSpan(0, 34, { perDay: 10 }),
    now: ts(34, 20),
    ctx: { targets: [] },
    expect: { band: 'steady', regime: 'stats', confidence: 'high' },
  },

  'grind-all-manual': {
    story: 'No-rest manual grind — exposure only, stops at amber',
    curatedId: 'grind-all-manual',
    games: span(0, 35, { perDay: 10, result: 'Win', mental: CALM }),
    now: ts(35, 20),
    ctx: { targets: [] },
    expect: { band: 'loaded', regime: 'manual', confidence: 'medium' },
  },

  'grind-wr-slump-red': {
    story: 'Grind + real winrate slump: two adverse families → red',
    curatedId: 'grind-wr-slump-red',
    games: [
      ...span(0, 28, { perDay: 5, result: 'Win', mental: CALM }),
      ...span(0, 28, { perDay: 5, result: 'Loss', mental: CALM, hour: 18 }),
      ...span(29, 35, { perDay: 2, result: 'Win', mental: CALM }),
      ...span(29, 35, { perDay: 8, result: 'Loss', mental: CALM, hour: 18 }),
    ],
    now: ts(35, 20),
    ctx: { targets: [] },
    expect: { band: 'in-the-hole', regime: 'manual', confidence: 'medium' },
  },

  'grind-tilt-slider-red': {
    story: 'Grind + tilt + low self-rating → red via the fatigued gate',
    curatedId: 'grind-tilt-slider-red',
    games: [
      ...span(0, 28, { perDay: 10, result: 'Win', mental: CALM }).map((g) => ({ ...g, performance: 70 })),
      ...span(29, 35, { perDay: 10, result: 'Win', mental: TILT }).map((g) => ({ ...g, performance: 40 })),
    ],
    now: ts(35, 20),
    ctx: { targets: [] },
    expect: { band: 'in-the-hole', regime: 'manual', confidence: 'medium' },
  },

  'all-loss-week-outcome-cap': {
    story: 'A week of pure losses — the 15-point outcome cap',
    curatedId: 'all-loss-week-outcome-cap',
    games: [
      ...statSpan(0, 27, { perDay: 3, hero: 'Tracer', result: 'Win', damage: 8000, deaths: 5, elims: 20 }),
      ...statSpan(28, 34, { perDay: 3, hero: 'Tracer', result: 'Loss', damage: 8000, deaths: 5, elims: 20 }),
    ],
    now: ts(34, 20),
    ctx: { targets: [] },
    expect: { band: 'loaded', regime: 'stats', confidence: 'high' },
  },

  'grind-wr-slump-dampened': {
    story: 'Same slump while hitting targets: dampener lifts red to amber',
    curatedId: 'grind-wr-slump-dampened',
    games: [
      ...span(0, 28, { perDay: 5, result: 'Win', mental: CALM }),
      ...span(0, 28, { perDay: 5, result: 'Loss', mental: CALM, hour: 18 }),
      ...span(29, 35, { perDay: 2, result: 'Win', mental: CALM }).map((g) => graded(g, { 't-vod-review': 'hit' })),
      ...span(29, 35, { perDay: 8, result: 'Loss', mental: CALM, hour: 18 }),
    ],
    now: ts(35, 20),
    ctx: { targets: [target('t-vod-review', 0, { mode: 'self' })] },
    expect: { band: 'loaded', regime: 'manual', confidence: 'medium' },
  },

  // --- data-suppressed reads: personalization must stay OFF (matcher/walkthrough → null) ---

  'rest-day-3-supercompensation-peak': {
    story: 'Three rest days after a grind — the peak, but low-confidence',
    curatedId: null,
    games: span(0, 34, { perDay: 8 }),
    now: ts(37, 20),
    ctx: { targets: [] },
    expect: { band: 'fresh', regime: 'manual', confidence: 'low' },
  },

  'eight-day-layoff-rust': {
    story: 'Eight-day layoff — rusty, low-confidence',
    curatedId: null,
    games: span(0, 30, { perDay: 4 }),
    now: ts(38, 20),
    ctx: { targets: [] },
    expect: { band: 'rusty', regime: 'manual', confidence: 'low' },
  },

  'young-account-insufficient-gate': {
    story: 'Brand-new account — the insufficient-data gate',
    curatedId: null,
    games: span(0, 9, { perDay: 2 }),
    now: ts(9, 20),
    ctx: { targets: [] },
    expect: { band: 'insufficient-data', regime: 'manual', confidence: 'low' },
  },
};

/** Fixtures whose live read should yield a personalized match (medium/high confidence). */
export const MATCHABLE_FIXTURES = Object.entries(HELP_FIXTURES).filter(([, f]) => f.curatedId !== null);
/** Fixtures whose live read is data-suppressed (matcher/walkthrough must return null). */
export const SUPPRESSED_FIXTURES = Object.entries(HELP_FIXTURES).filter(([, f]) => f.curatedId === null);
