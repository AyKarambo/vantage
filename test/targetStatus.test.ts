import { describe, it, expect } from 'vitest';
import { targetStatusSentence, MIN_VERDICT, type LearningPhase, type TargetLearningCurve } from '../src/core/targets';

const ALL_PHASES: LearningPhase[] = ['gathering', 'no-baseline', 'building', 'climbing', 'paying-off', 'steady'];

/** Type-complete TargetLearningCurve with sensible defaults; override phase/decidedSince. */
const curve = (over: Partial<TargetLearningCurve> = {}): TargetLearningCurve => ({
  targetId: 'T',
  mode: 'self',
  since: 0,
  baseline: 0.5,
  baselineDecided: 20,
  points: [],
  decidedSince: 12,
  dipDepth: null,
  troughIndex: null,
  reboundIndex: null,
  reboundPts: null,
  execCurrent: null,
  execRising: false,
  execLeads: false,
  phase: 'steady',
  ...over,
});

type SentenceInput = Parameters<typeof targetStatusSentence>[0];

/** `targetStatusSentence` with safe defaults for the R6 fields (no learning
 *  curve, no decided games on either side) — so every pre-existing test only
 *  has to state what it actually varies, and the lift/habit branches (R6)
 *  never fire by accident in a test that isn't about them. */
const sentence = (over: Partial<SentenceInput> = {}): string => targetStatusSentence({
  mode: 'self', attempts: 10, hitRate: 0.5,
  winWhenHit: 0.5, winWhenMissed: 0.5, hitDecided: 0, missDecided: 0,
  ...over,
});

describe('targetStatusSentence', () => {
  it('attempts 0 → the starter sentence, even when a learning curve is present', () => {
    expect(sentence({ attempts: 0, hitRate: 0, learning: curve({ phase: 'paying-off' }) }))
      .toBe('New — grade it after your next game.');
  });

  it('attempts 0 on a measured target never says "grade it" — it grades itself', () => {
    const s = sentence({ mode: 'measured', attempts: 0, hitRate: 0 });
    expect(s).toBe('New — auto-graded from your next game.');
    expect(s).not.toContain('grade it');
  });

  it('every phase yields a non-empty, pairwise-distinct sentence', () => {
    const sentences = ALL_PHASES.map((phase) => sentence({ learning: curve({ phase, decidedSince: 7 }) }));
    for (const s of sentences) expect(s.length).toBeGreaterThan(0);
    expect(new Set(sentences).size).toBe(sentences.length);
  });

  it('gathering with a baseline counts down to MIN_VERDICT', () => {
    const s = sentence({ learning: curve({ phase: 'gathering', decidedSince: 7 }) });
    expect(s).toContain('7');
    expect(s).toContain(String(MIN_VERDICT));
  });

  it('gathering WITHOUT a baseline promises no countdown — the 12-game verdict never applies', () => {
    const s = sentence({
      attempts: 2, learning: curve({ phase: 'gathering', decidedSince: 3, baseline: null, baselineDecided: 0 }),
    });
    expect(s).toContain('3');
    expect(s).not.toContain(String(MIN_VERDICT));
    // singular form for a single game
    const one = sentence({
      attempts: 1, learning: curve({ phase: 'gathering', decidedSince: 1, baseline: null, baselineDecided: 0 }),
    });
    expect(one).toContain('1 game ');
  });

  it('no-learning, too few decided games either side: each hit-rate band maps to its sentence, boundaries inclusive', () => {
    const at = (hitRate: number): string => sentence({ hitRate });
    // High band (>= 0.6), including the exact boundary.
    expect(at(0.75)).toContain('strong consistency');
    expect(at(0.6)).toContain('strong consistency');
    // Mid band (>= 0.35), including the exact boundary.
    expect(at(0.5)).toContain('keep at it');
    expect(at(0.35)).toContain('keep at it');
    // Low band (< 0.35), just under the boundary.
    expect(at(0.3499)).toContain('clicking into place');
    expect(at(0.1)).toContain('clicking into place');
  });

  describe('lift-driven verdict (R6) — both sides have >= 8 decided games', () => {
    it('a real positive lift (>= 5 pts) reads "Worth keeping" with the lift and the hit-side sample size', () => {
      const s = sentence({ winWhenHit: 0.62, winWhenMissed: 0.44, hitDecided: 21, missDecided: 9 });
      expect(s).toBe('Worth keeping — +18 pts when you hit it (21 games).');
    });

    it('a lift right at the +5pt threshold still counts as worth keeping (inclusive)', () => {
      const s = sentence({ winWhenHit: 0.55, winWhenMissed: 0.5, hitDecided: 8, missDecided: 8 });
      expect(s).toContain('Worth keeping');
    });

    it('a near-zero or negative lift reads "No effect yet" — never a fabricated number', () => {
      expect(sentence({ winWhenHit: 0.51, winWhenMissed: 0.5, hitDecided: 10, missDecided: 10 }))
        .toBe("No effect yet — hitting it hasn't moved your winrate; consider swapping it.");
      expect(sentence({ winWhenHit: 0.4, winWhenMissed: 0.55, hitDecided: 12, missDecided: 8 }))
        .toContain('No effect yet');
    });

    it('one side just under the 8-decided-game minimum falls back to the hit-rate band, not a lift claim', () => {
      const s = sentence({ hitRate: 0.75, winWhenHit: 0.9, winWhenMissed: 0.1, hitDecided: 20, missDecided: 7 });
      expect(s).toContain('strong consistency');
      expect(s).not.toContain('pts');
    });

    it('a real lift outranks the plain hit-rate band it would otherwise fall into', () => {
      // hitRate alone would land in the mid band ("keep at it"), but a
      // well-evidenced lift is the more useful, and more honest, read.
      const s = sentence({ hitRate: 0.5, winWhenHit: 0.7, winWhenMissed: 0.4, hitDecided: 10, missDecided: 10 });
      expect(s).toContain('Worth keeping');
      expect(s).not.toContain('keep at it');
    });
  });

  describe('"Habit is set" (R6) — essentially automatic, rotate it out', () => {
    it('a very high hit-rate over many attempts recommends rotating, ahead of any lift read', () => {
      const s = sentence({ attempts: 40, hitRate: 0.85, winWhenHit: 0.6, winWhenMissed: 0.3, hitDecided: 30, missDecided: 8 });
      expect(s).toBe('Habit is set — 85% hit over 40 games, rotate it out.');
    });

    it('does not fire below the attempts floor, even at a very high hit-rate', () => {
      const s = sentence({ attempts: 15, hitRate: 0.9 });
      expect(s).not.toContain('rotate it out');
    });

    it('does not fire below the hit-rate floor, even over many attempts', () => {
      const s = sentence({ attempts: 40, hitRate: 0.7, hitDecided: 0, missDecided: 0 });
      expect(s).not.toContain('rotate it out');
    });
  });

  it('never leaks stats jargon — no "CI", "baseline", "n=", "rolling"', () => {
    const jargon = /\bCI\b|baseline|n=|rolling/i;
    const all = [
      sentence({ attempts: 0, hitRate: 0 }),
      sentence({ mode: 'measured', attempts: 0, hitRate: 0 }),
      ...ALL_PHASES.map((phase) => sentence({ learning: curve({ phase, decidedSince: 7 }) })),
      sentence({ attempts: 2, learning: curve({ phase: 'gathering', decidedSince: 3, baseline: null, baselineDecided: 0 }) }),
      sentence({ hitRate: 0.75 }),
      sentence({ hitRate: 0.5 }),
      sentence({ hitRate: 0.1 }),
      sentence({ winWhenHit: 0.62, winWhenMissed: 0.44, hitDecided: 21, missDecided: 9 }),
      sentence({ winWhenHit: 0.51, winWhenMissed: 0.5, hitDecided: 10, missDecided: 10 }),
      sentence({ attempts: 40, hitRate: 0.85, hitDecided: 30, missDecided: 8 }),
    ];
    for (const s of all) expect(s).not.toMatch(jargon);
  });
});
