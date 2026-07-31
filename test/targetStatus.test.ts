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

describe('targetStatusSentence', () => {
  it('attempts 0 → the starter sentence, even when a learning curve is present', () => {
    const sentence = targetStatusSentence({ mode: 'self', attempts: 0, hitRate: 0, learning: curve({ phase: 'paying-off' }) });
    expect(sentence).toBe('New — grade it after your next game.');
  });

  it('attempts 0 on a measured target never says "grade it" — it grades itself', () => {
    const sentence = targetStatusSentence({ mode: 'measured', attempts: 0, hitRate: 0 });
    expect(sentence).toBe('New — auto-graded from your next game.');
    expect(sentence).not.toContain('grade it');
  });

  it('every phase yields a non-empty, pairwise-distinct sentence', () => {
    const sentences = ALL_PHASES.map((phase) =>
      targetStatusSentence({ mode: 'self', attempts: 10, hitRate: 0.5, learning: curve({ phase, decidedSince: 7 }) }),
    );
    for (const s of sentences) expect(s.length).toBeGreaterThan(0);
    expect(new Set(sentences).size).toBe(sentences.length);
  });

  it('gathering with a baseline counts down to MIN_VERDICT', () => {
    const sentence = targetStatusSentence({
      mode: 'self', attempts: 10, hitRate: 0.5, learning: curve({ phase: 'gathering', decidedSince: 7 }),
    });
    expect(sentence).toContain('7');
    expect(sentence).toContain(String(MIN_VERDICT));
  });

  it('gathering WITHOUT a baseline promises no countdown — the 12-game verdict never applies', () => {
    const sentence = targetStatusSentence({
      mode: 'self', attempts: 2, hitRate: 0.5,
      learning: curve({ phase: 'gathering', decidedSince: 3, baseline: null, baselineDecided: 0 }),
    });
    expect(sentence).toContain('3');
    expect(sentence).not.toContain(String(MIN_VERDICT));
    // singular form for a single game
    const one = targetStatusSentence({
      mode: 'self', attempts: 1, hitRate: 0.5,
      learning: curve({ phase: 'gathering', decidedSince: 1, baseline: null, baselineDecided: 0 }),
    });
    expect(one).toContain('1 game ');
  });

  it('no-learning fallback: each band maps to its sentence, boundaries inclusive', () => {
    const at = (hitRate: number): string => targetStatusSentence({ mode: 'self', attempts: 10, hitRate });
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

  it('never leaks stats jargon — no "CI", "baseline", "n=", "rolling"', () => {
    const jargon = /\bCI\b|baseline|n=|rolling/i;
    const all = [
      targetStatusSentence({ mode: 'self', attempts: 0, hitRate: 0 }),
      targetStatusSentence({ mode: 'measured', attempts: 0, hitRate: 0 }),
      ...ALL_PHASES.map((phase) => targetStatusSentence({ mode: 'self', attempts: 10, hitRate: 0.5, learning: curve({ phase, decidedSince: 7 }) })),
      targetStatusSentence({
        mode: 'self', attempts: 2, hitRate: 0.5,
        learning: curve({ phase: 'gathering', decidedSince: 3, baseline: null, baselineDecided: 0 }),
      }),
      targetStatusSentence({ mode: 'self', attempts: 10, hitRate: 0.75 }),
      targetStatusSentence({ mode: 'self', attempts: 10, hitRate: 0.5 }),
      targetStatusSentence({ mode: 'self', attempts: 10, hitRate: 0.1 }),
    ];
    for (const s of all) expect(s).not.toMatch(jargon);
  });
});
