import { describe, it, expect } from 'vitest';
import { computeReadiness, READINESS_TUNING as T } from '../src/core/readiness';
import { rankTrendFor } from '../src/core/readiness/rankTrend';
import { dayOrdinal } from '../src/core/readiness/day';
import type { RankAnchorMap } from '../src/core/rank';
import type { GameRecord } from '../src/core/analytics';
import { ts, span, CALM } from './readinessFixtures';

/** A weekend-only history: 5 games Sat+Sun each week for four weeks (8 active days, span 23d). */
function weekender(srDeltas?: (i: number) => number): GameRecord[] {
  const days = [5, 6, 12, 13, 19, 20, 26, 27];
  const games = days.flatMap((d) => span(d, d, { perDay: 5, mental: CALM }));
  return srDeltas ? games.map((g, i) => ({ ...g, srDelta: srDeltas(i) })) : games;
}

/** Gold 3, 50%, anchored before the history starts — the fixtures' default account::role. */
const ANCHORS: RankAnchorMap = {
  'Main::damage': { tier: 'Gold', division: 3, progressPct: 50, setAt: ts(0, 9) },
};

const EVAL = ts(27, 20);

describe('rank-gated undertraining nudge (owner revision 2026-07-08)', () => {
  it('no rank data at all ⇒ nudge AND freqPen silent (never encourage volume on zero evidence)', () => {
    const r = computeReadiness(weekender(), EVAL);
    expect(r.signals.some((s) => s.key === 'low-frequency')).toBe(false);
    expect(r.score).toBe(75); // the −3 freqPen is gone too — no invisible score dip
  });

  it('anchor exists but games carry NO srDelta ⇒ unlogged, not stagnant ⇒ still silent', () => {
    const r = computeReadiness(weekender(), EVAL, { targets: [], rankAnchors: ANCHORS });
    expect(r.signals.some((s) => s.key === 'low-frequency')).toBe(false);
    expect(r.score).toBe(75);
  });

  it('evidenced CLIMBING (net-positive logged SR over the window) ⇒ silent — low-volume climbing is the pattern working', () => {
    const r = computeReadiness(weekender(() => 5), EVAL, { targets: [], rankAnchors: ANCHORS });
    expect(r.signals.some((s) => s.key === 'low-frequency')).toBe(false);
    expect(r.score).toBe(75);
  });

  it('evidenced STAGNATION (logged SR, net flat) ⇒ nudge fires with the stagnation copy + capped freqPen', () => {
    const r = computeReadiness(weekender((i) => (i % 2 === 0 ? 20 : -20)), EVAL, { targets: [], rankAnchors: ANCHORS });
    const sig = r.signals.find((s) => s.key === 'low-frequency');
    expect(sig).toBeDefined();
    expect(sig!.label).toContain('ranks flat');
    expect(r.score).toBe(72); // the small freqPen (−3) applies, consistent with the visible signal
  });

  it('evidenced DECLINE (net negative) also counts as not-climbing ⇒ nudge fires', () => {
    const r = computeReadiness(weekender(() => -5), EVAL, { targets: [], rankAnchors: ANCHORS });
    expect(r.signals.some((s) => s.key === 'low-frequency')).toBe(true);
  });
});

describe('rankTrendFor — evidence discipline', () => {
  const at27 = dayOrdinal(ts(27, 20));

  it('returns unknown without anchors', () => {
    expect(rankTrendFor(weekender(() => 5), at27, undefined)).toBe('unknown');
  });

  it('too few srDelta games in the measurable window ⇒ unknown (evidence bar)', () => {
    // Only 3 delta-carrying games inside the 14-day window (the rest unlogged).
    const games = weekender((i) => 5).map((g, i) => (i < 37 ? { ...g, srDelta: undefined } : g));
    expect(rankTrendFor(games, at27, ANCHORS)).toBe('unknown');
  });

  it('an anchor set INSIDE the window measures from its own ground truth', () => {
    const anchors: RankAnchorMap = {
      'Main::damage': { tier: 'Gold', division: 3, progressPct: 50, setAt: ts(18, 9) }, // 10 days before eval
    };
    // Two weekends after the anchor carry deltas: measurable span 10 ≥ 7, deltas 20 ≥ 5.
    expect(rankTrendFor(weekender(() => 5), at27, anchors)).toBe('climbing');
    expect(rankTrendFor(weekender((i) => (i % 2 === 0 ? 20 : -20)), at27, anchors)).toBe('stagnant');
  });

  it('an anchor too fresh for the evidence span ⇒ unknown', () => {
    const anchors: RankAnchorMap = {
      'Main::damage': { tier: 'Gold', division: 3, progressPct: 50, setAt: ts(24, 9) }, // 4-day span < 7
    };
    expect(rankTrendFor(weekender(() => 5), at27, anchors)).toBe('unknown');
  });

  it('ANY climbing account silences, even when another is flat', () => {
    const games = [
      ...weekender((i) => (i % 2 === 0 ? 20 : -20)), // Main flat
      ...span(14, 27, { perDay: 1, account: 'Alt', hour: 19 }).map((g) => ({ ...g, srDelta: 10 })), // Alt climbing
    ];
    const anchors: RankAnchorMap = {
      'Main::damage': { tier: 'Gold', division: 3, progressPct: 50, setAt: ts(0, 9) },
      'Alt::damage': { tier: 'Silver', division: 2, progressPct: 10, setAt: ts(0, 9) },
    };
    expect(rankTrendFor(games, dayOrdinal(ts(27, 20)), anchors)).toBe('climbing');
  });
});
