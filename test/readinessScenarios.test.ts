/**
 * Scenario catalog — 26 engine-verified player stories pinning WHEN the readiness
 * model produces WHICH score. Each was hand-computed from READINESS_TUNING first,
 * then verified against the real engine (twice: by its designing agent and by an
 * independent re-run) — so a failure here means the CALCULATION changed, not the
 * fixture. Human-readable companion tables: specs/readiness-data-regimes.scenarios.md.
 */
import { describe, it, expect } from 'vitest';
import { computeReadiness } from '../src/core/readiness';
import { ts, span, statSpan, graded, target, TILT, CALM } from './readinessFixtures';
import type { GameRecord } from '../src/core/analytics';
import type { AuthoredTarget } from '../src/core/targets';

interface Scenario {
  id: string;
  /** One-line player story (see the scenarios doc for the full narrative). */
  story: string;
  expect: { score: number | null; band: string; regime: string; confidence: string };
  fixture: () => { games: GameRecord[]; now: number; targets: AuthoredTarget[] };
}

const SCENARIOS: Scenario[] = [
  // --- regime-contrast ---
  {
    id: "grind-all-manual",
    story: "The grind the engine can only see as exposure (b=0)",
    expect: {"score":59,"band":"loaded","regime":"manual","confidence":"medium"},
    fixture: () => {
      const games = span(0, 29, { perDay: 10, result: 'Win', mental: CALM });
      const now = ts(29, 20);
      return { games, now, targets: [] };
    },
  },
  {
    id: "grind-all-gep",
    story: "The identical grind, fully measured (b=1)",
    expect: {"score":75,"band":"steady","regime":"stats","confidence":"high"},
    fixture: () => {
      const games = statSpan(0, 29, { perDay: 10, hero: 'Tracer', result: 'Win', mental: CALM });
      const now = ts(29, 20);
      return { games, now, targets: [] };
    },
  },
  {
    id: "grind-half-half-saturates",
    story: "Half GEP is already full stats (coverage target saturates b)",
    expect: {"score":75,"band":"steady","regime":"stats","confidence":"high"},
    fixture: () => {
      const games = [
        ...span(0, 29, { perDay: 5, result: 'Win', mental: CALM }),
        ...statSpan(0, 29, { perDay: 5, hero: 'Tracer', result: 'Win', mental: CALM, hour: 18 }),
      ];
      const now = ts(29, 20);
      return { games, now, targets: [] };
    },
  },
  {
    id: "grind-true-hybrid",
    story: "Genuine hybrid: 30% coverage, 40% of the manual arm (b=0.6)",
    expect: {"score":69,"band":"steady","regime":"hybrid","confidence":"medium"},
    fixture: () => {
      const games = [
        ...span(0, 29, { perDay: 7, result: 'Win', mental: CALM }),
        ...statSpan(0, 29, { perDay: 3, hero: 'Tracer', result: 'Win', mental: CALM, hour: 18 }),
      ];
      const now = ts(29, 20);
      return { games, now, targets: [] };
    },
  },
  {
    id: "grind-gep-outage-day5",
    story: "Mid-grind GEP outage: the score drifts as the window forgets",
    expect: {"score":68,"band":"steady","regime":"hybrid","confidence":"medium"},
    fixture: () => {
      const games = [
        ...statSpan(0, 25, { perDay: 10, hero: 'Tracer', result: 'Win', mental: CALM }),
        ...span(26, 30, { perDay: 10, result: 'Win', mental: CALM }),
      ];
      const now = ts(30, 20);
      return { games, now, targets: [] };
    },
  },
  // --- recovery-rust ---
  {
    id: "grinder-plus-one-rest-day",
    story: "Heavy grinder, one rest day in",
    expect: {"score":60,"band":"recovering","regime":"manual","confidence":"low"},
    fixture: () => {
      const games = [...span(0, 24, { perDay: 4 }), ...span(25, 27, { perDay: 10 })];
      const now = ts(28, 20);
      const targets = [];
      return { games, now, targets };
    },
  },
  {
    id: "grinder-supercompensation-peak",
    story: "Same grinder, three rest days: the peak",
    expect: {"score":100,"band":"fresh","regime":"manual","confidence":"low"},
    fixture: () => {
      const games = [...span(0, 24, { perDay: 4 }), ...span(25, 27, { perDay: 10 })];
      const now = ts(30, 20);
      const targets = [];
      return { games, now, targets };
    },
  },
  {
    id: "eight-day-layoff-rust",
    story: "Eight-day layoff: rust decay",
    expect: {"score":40,"band":"rusty","regime":"manual","confidence":"low"},
    fixture: () => {
      const games = span(0, 30, { perDay: 4 });
      const now = ts(38, 20);
      const targets = [];
      return { games, now, targets };
    },
  },
  {
    id: "weekend-only-consistency-nudge",
    story: "Weekend-only player: consistency nudge",
    expect: {"score":72,"band":"fresh","regime":"manual","confidence":"medium"},
    fixture: () => {
      const weekendDays = [5, 6, 12, 13, 19, 20, 26, 27];
      const games = weekendDays.flatMap((d) => span(d, d, { perDay: 5, mental: CALM }));
      const now = ts(27, 20);
      const targets = [];
      return { games, now, targets };
    },
  },
  {
    id: "young-account-insufficient-gate",
    story: "Young account: the insufficient-data gate",
    expect: {"score":null,"band":"insufficient-data","regime":"manual","confidence":"low"},
    fixture: () => {
      const games = span(0, 9, { perDay: 2 });
      const now = ts(9, 20);
      const targets = [];
      return { games, now, targets };
    },
  },
  // --- everyday-green ---
  {
    id: "weekend-warrior",
    story: "Weekend-only player stays fresh, with a tiny consistency nudge",
    expect: {"score":72,"band":"fresh","regime":"manual","confidence":"low"},
    fixture: () => {
      const games = [5, 6, 12, 13, 19, 20, 26, 27].flatMap((d) => span(d, d, { perDay: 5 }));
      const now = ts(27, 20);
      const targets = [];
      return { games, now, targets };
    },
  },
  {
    id: "evening-hobbyist-calm",
    story: "Evening hobbyist with a weekly rest day reads fresh mid-rhythm",
    expect: {"score":74,"band":"fresh","regime":"manual","confidence":"medium"},
    fixture: () => {
      const games = [];
      for (let d = 0; d <= 24; d += 1) {
        if (d === 6 || d === 13 || d === 20) continue;
        games.push(...span(d, d, { perDay: 3, mental: CALM }));
      }
      const now = ts(24, 20);
      const targets = [];
      return { games, now, targets };
    },
  },
  {
    id: "stats-grinder-habit-b1",
    story: "High-volume grinder at full stats coverage: habit is not risk",
    expect: {"score":75,"band":"steady","regime":"stats","confidence":"high"},
    fixture: () => {
      const games = statSpan(0, 34, { perDay: 10 });
      const now = ts(34, 20);
      const targets = [];
      return { games, now, targets };
    },
  },
  {
    id: "rest-day-1-recovering",
    story: "First rest day after a heavy stretch: bonus nearly cancels the residual load",
    expect: {"score":74,"band":"recovering","regime":"manual","confidence":"low"},
    fixture: () => {
      const games = span(0, 34, { perDay: 8 });
      const now = ts(35, 20);
      const targets = [];
      return { games, now, targets };
    },
  },
  {
    id: "rest-day-3-supercompensation-peak",
    story: "Three rest days after the grind: the supercompensation peak (score 100)",
    expect: {"score":100,"band":"fresh","regime":"manual","confidence":"low"},
    fixture: () => {
      const games = span(0, 34, { perDay: 8 });
      const now = ts(37, 20);
      const targets = [];
      return { games, now, targets };
    },
  },
  // --- modifiers-edges ---
  {
    id: "slider-dip-below-own-average",
    story: "Rating yourself 20 points below your own average",
    expect: {"score":64,"band":"fresh","regime":"manual","confidence":"medium"},
    fixture: () => {
      const games = [
        ...span(0, 28, { perDay: 4 }).map((g) => ({ ...g, performance: 70 })),
        ...span(29, 35, { perDay: 4 }).map((g) => ({ ...g, performance: 50 })),
      ];
      const now = ts(35, 20);
      const targets = [];
      return { games, now, targets };
    },
  },
  {
    id: "chronic-pessimist-non-fire",
    story: "The chronic pessimist rates everything 40 — and stays neutral",
    expect: {"score":70,"band":"fresh","regime":"manual","confidence":"medium"},
    fixture: () => {
      const games = [
        ...span(0, 28, { perDay: 4 }).map((g) => ({ ...g, performance: 40 })),
        ...span(29, 35, { perDay: 4 }).map((g) => ({ ...g, performance: 40 })),
      ];
      const now = ts(35, 20);
      const targets = [];
      return { games, now, targets };
    },
  },
  {
    id: "tilt-agree-gate-shrinks",
    story: "Tilt penalty shrinks x0.3 once the winrate dip already tells the story",
    expect: {"score":36,"band":"loaded","regime":"manual","confidence":"medium"},
    fixture: () => {
      const games = [
        ...span(0, 27, { perDay: 4, result: 'Win', mental: CALM }),
        ...span(28, 34, { perDay: 4, result: 'Loss', mental: TILT }),
      ];
      const now = ts(34, 20);
      const targets = [];
      return { games, now, targets };
    },
  },
  {
    id: "all-loss-week-outcome-cap",
    story: "A week of pure losses costs exactly the 15-point outcome cap",
    expect: {"score":60,"band":"loaded","regime":"stats","confidence":"high"},
    fixture: () => {
      const games = [
        ...statSpan(0, 27, { perDay: 3, hero: 'Tracer', result: 'Win', damage: 8000, deaths: 5, elims: 20 }),
        ...statSpan(28, 34, { perDay: 3, hero: 'Tracer', result: 'Loss', damage: 8000, deaths: 5, elims: 20 }),
      ];
      const now = ts(34, 20);
      const targets = [];
      return { games, now, targets };
    },
  },
  {
    id: "all-draws-week-silent-results",
    story: "An all-draws week: results go silent, exposure still accrues",
    expect: {"score":56,"band":"loaded","regime":"manual","confidence":"medium"},
    fixture: () => {
      const games = [
        ...span(0, 28, { perDay: 8, result: 'Win', mental: CALM }),
        ...span(29, 35, { perDay: 8, result: 'Draw', mental: CALM }),
      ];
      const now = ts(35, 20);
      const targets = [];
      return { games, now, targets };
    },
  },
  {
    id: "deaths-improve-damage-fall",
    story: "Playing scared (damage down 30%, deaths down): the passivity guard reads it as decline (owner revision 2026-07-08)",
    expect: {"score":45,"band":"loaded","regime":"stats","confidence":"high"},
    fixture: () => {
      const games = [
        ...statSpan(0, 27, { perDay: 3, hero: 'Tracer', damage: 8000, deaths: 5, elims: 20 }),
        ...statSpan(28, 34, { perDay: 3, hero: 'Tracer', damage: 5600, deaths: 4, elims: 20 }),
      ];
      const now = ts(34, 20);
      const targets = [];
      return { games, now, targets };
    },
  },
  {
    id: "deaths-improve-output-holds",
    story: "Deaths down while output HOLDS: genuine positioning improvement keeps full credit",
    expect: {"score":75,"band":"fresh","regime":"stats","confidence":"high"},
    fixture: () => {
      const games = [
        ...statSpan(0, 27, { perDay: 3, hero: 'Tracer', damage: 8000, deaths: 5, elims: 20 }),
        ...statSpan(28, 34, { perDay: 3, hero: 'Tracer', damage: 8000, deaths: 4, elims: 20 }),
      ];
      const now = ts(34, 20);
      const targets = [];
      return { games, now, targets };
    },
  },
  // --- amber-red-paths ---
  {
    id: "manual-grind-amber",
    story: "No-rest manual grind: one adverse family stops at amber",
    expect: {"score":54,"band":"loaded","regime":"manual","confidence":"medium"},
    fixture: () => {
      const games = span(0, 35, { perDay: 10, result: 'Win', mental: CALM });
      const now = ts(35, 20);
      return { games, now, targets: [] };
    },
  },
  {
    id: "grind-wr-slump-red",
    story: "Grind + real winrate slump: two adverse families unlock red",
    expect: {"score":29,"band":"in-the-hole","regime":"manual","confidence":"medium"},
    fixture: () => {
      const games = [
        ...span(0, 28, { perDay: 5, result: 'Win', mental: CALM }),
        ...span(0, 28, { perDay: 5, result: 'Loss', mental: CALM, hour: 18 }),
        ...span(29, 35, { perDay: 2, result: 'Win', mental: CALM }),
        ...span(29, 35, { perDay: 8, result: 'Loss', mental: CALM, hour: 18 }),
      ];
      const now = ts(35, 20);
      return { games, now, targets: [] };
    },
  },
  {
    id: "grind-wr-slump-dampened",
    story: "Same slump while hitting your targets: dampener halves the penalty, red lifts to amber",
    expect: {"score":42,"band":"loaded","regime":"manual","confidence":"medium"},
    fixture: () => {
      const tgt = target('t-vod-review', 0, { mode: 'self' });
      const games = [
        ...span(0, 28, { perDay: 5, result: 'Win', mental: CALM }),
        ...span(0, 28, { perDay: 5, result: 'Loss', mental: CALM, hour: 18 }),
        ...span(29, 35, { perDay: 2, result: 'Win', mental: CALM }).map((g) => graded(g, { 't-vod-review': 'hit' })),
        ...span(29, 35, { perDay: 8, result: 'Loss', mental: CALM, hour: 18 }),
      ];
      const now = ts(35, 20);
      return { games, now, targets: [tgt] };
    },
  },
  {
    id: "grind-tilt-slider-red",
    story: "Grind + tilt + low self-rating: red through the fatigued gate, no bad results needed",
    expect: {"score":31,"band":"in-the-hole","regime":"manual","confidence":"medium"},
    fixture: () => {
      const games = [
        ...span(0, 28, { perDay: 10, result: 'Win', mental: CALM }).map((g) => ({ ...g, performance: 70 })),
        ...span(29, 35, { perDay: 10, result: 'Win', mental: TILT }).map((g) => ({ ...g, performance: 40 })),
      ];
      const now = ts(35, 20);
      return { games, now, targets: [] };
    },
  },
  {
    id: "stats-marathon-decline-red",
    story: "Stats-regime (b=1) red: marathon session + per-10 CUSUM decline + losses",
    expect: {"score":16,"band":"in-the-hole","regime":"stats","confidence":"high"},
    fixture: () => {
      const BASE = { hero: 'Tracer', damage: 9000, deaths: 4, elims: 22 };
      const games = [
        ...statSpan(0, 25, { perDay: 2, result: 'Win', ...BASE }),
        ...statSpan(0, 25, { perDay: 2, result: 'Loss', hour: 15, ...BASE }),
        ...statSpan(27, 29, { perDay: 2, result: 'Win', ...BASE }),
        ...statSpan(27, 29, { perDay: 2, result: 'Loss', hour: 15, ...BASE }),
        ...statSpan(30, 30, { perDay: 10, result: 'Loss', gapMin: 16, hero: 'Tracer', damage: 8100, deaths: 5, elims: 20 }),
      ];
      const now = ts(30, 20);
      return { games, now, targets: [] };
    },
  },
];

describe('readiness scenario catalog (engine-verified)', () => {
  for (const s of SCENARIOS) {
    it(`${s.id} — ${s.story}`, () => {
      const { games, now, targets } = s.fixture();
      const r = computeReadiness(games, now, { targets });
      expect(r.score).toBe(s.expect.score);
      expect(r.band).toBe(s.expect.band);
      expect(r.regime).toBe(s.expect.regime);
      expect(r.confidence).toBe(s.expect.confidence);
    });
  }
});
