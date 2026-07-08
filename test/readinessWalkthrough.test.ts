/**
 * T3 — personalized score walkthrough (AC6c / AC7). The 75-anchor step-through
 * must rebuild the score the view shows (within the ±1 rounding residual the
 * pre-rounded deltas allow), and it must return null on data-suppressed reads
 * rather than fabricate a walkthrough.
 */
import { describe, it, expect } from 'vitest';
import { computeReadiness, deriveWalkthrough, READINESS_TUNING as T } from '../src/core/readiness';
import type { ReadinessSummary } from '../src/core/readiness';
import { span, ts, CALM } from './readinessFixtures';
import { MATCHABLE_FIXTURES, SUPPRESSED_FIXTURES } from './readinessHelpFixtures';

/** A minimal ReadinessSummary carrying just the fields deriveWalkthrough reads,
 *  for exercising the reconstruction arithmetic (incl. the 0/100 clamp) directly. */
function synthSummary(load: number, performance: number, subjective: number): ReadinessSummary {
  const bare = Math.round(75 + load + performance + subjective);
  const score = Math.min(100, Math.max(0, bare));
  const band = score <= 40 ? 'in-the-hole' : score >= 76 ? 'fresh' : 'loaded';
  return {
    band, score, confidence: 'high', headline: '', recommendation: 'none', recommendationText: '',
    signals: [], driver: 'neutral', regime: 'stats',
    load: { acutePerDay: 0, chronicPerDay: 0, ratio: 1, consecutiveDays: 0, activeDaysPerWeek: 0, restDays: 0, lastSessionGames: 0, lastSessionMinutes: null },
    subscores: {
      load: { delta: load, available: true, coverage: 1 },
      performance: { delta: performance, available: true, coverage: 1 },
      subjective: { delta: subjective, available: true, coverage: 1 },
    },
    trend: [],
  };
}

describe('deriveWalkthrough — reconstruction fidelity', () => {
  for (const [key, f] of MATCHABLE_FIXTURES) {
    it(`${key} — 75 + Δ rebuilds the shown score (±1)`, () => {
      const r = computeReadiness(f.games, f.now, f.ctx);
      const w = deriveWalkthrough(r);
      expect(w, `${key} should derive`).not.toBeNull();

      const { anchor, deltas, reconstructed, shown, roundingResidual } = w!.reconstruction;
      expect(anchor).toBe(T.baseScore); // 75
      expect(shown).toBe(r.score);
      expect(deltas.load).toBe(r.subscores.load.delta);
      expect(deltas.performance).toBe(r.subscores.performance.delta);
      expect(deltas.subjective).toBe(r.subscores.subjective.delta);

      // The displayed deltas are one-decimal rounded while the engine rounds the
      // raw sum once, so identity holds only within ±1.
      expect(Math.abs(roundingResidual)).toBeLessThanOrEqual(1);
      expect(Math.abs(shown - reconstructed)).toBeLessThanOrEqual(1);
      expect(roundingResidual).toBe(shown - reconstructed);
      // None of the matchable catalog reads sit at the 0/100 boundary.
      expect(w!.reconstruction.clamped).toBeNull();

      // Narrative uses the three families with a sane direction each.
      expect(w!.narrative.pulls.map((p) => p.family)).toEqual(['load', 'performance', 'subjective']);
      for (const p of w!.narrative.pulls) {
        expect(p.direction).toBe(p.delta >= 1 ? 'up' : p.delta <= -1 ? 'down' : 'flat');
      }
    });
  }
});

describe('deriveWalkthrough — data-suppressed reads return null', () => {
  for (const [key, f] of SUPPRESSED_FIXTURES) {
    it(`${key} → null (no fabricated walkthrough)`, () => {
      const r = computeReadiness(f.games, f.now, f.ctx);
      expect(deriveWalkthrough(r)).toBeNull();
    });
  }
});

describe('deriveWalkthrough — the 0/100 clamp is surfaced, not hidden', () => {
  it('pieces summing below 0 → clamped "low", shown 0', () => {
    const w = deriveWalkthrough(synthSummary(-40, -45, -15))!;
    expect(w).not.toBeNull();
    expect(w.reconstruction.shown).toBe(0);
    expect(w.reconstruction.clamped).toBe('low');
    // The residual can't explain a clamp on its own — the note must come from `clamped`.
    expect(w.reconstruction.roundingResidual).toBe(0);
  });

  it('pieces summing above 100 → clamped "high", shown 100', () => {
    const w = deriveWalkthrough(synthSummary(25, 8, 8))!;
    expect(w.reconstruction.shown).toBe(100);
    expect(w.reconstruction.clamped).toBe('high');
  });

  it('an ordinary read is not marked clamped', () => {
    expect(deriveWalkthrough(synthSummary(-5, 0, -3))!.reconstruction.clamped).toBeNull();
  });
});

describe('deriveWalkthrough — a matcher-suppressed read can still get a walkthrough', () => {
  it('rusty, medium-confidence: matcher returns null (no archetype) but the score still breaks down', () => {
    const games = span(0, 20, { perDay: 4, mental: CALM });
    const r = computeReadiness(games, ts(27, 20), { targets: [] });
    const w = deriveWalkthrough(r);
    expect(w).not.toBeNull();
    expect(w!.reconstruction.shown).toBe(r.score);
  });
});
