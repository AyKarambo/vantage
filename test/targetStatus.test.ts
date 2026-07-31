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
    const sentence = targetStatusSentence({ attempts: 0, hitRate: 0, learning: curve({ phase: 'paying-off' }) });
    expect(sentence).toBe('New — grade it after your next game.');
  });

  it('every phase yields a non-empty, pairwise-distinct sentence', () => {
    const sentences = ALL_PHASES.map((phase) =>
      targetStatusSentence({ attempts: 10, hitRate: 0.5, learning: curve({ phase, decidedSince: 7 }) }),
    );
    for (const s of sentences) expect(s.length).toBeGreaterThan(0);
    expect(new Set(sentences).size).toBe(sentences.length);
  });

  it('gathering sentence contains the actual decidedSince and MIN_VERDICT', () => {
    const sentence = targetStatusSentence({
      attempts: 10, hitRate: 0.5, learning: curve({ phase: 'gathering', decidedSince: 7 }),
    });
    expect(sentence).toContain('7');
    expect(sentence).toContain(String(MIN_VERDICT));
  });

  it('no-learning fallback: hitRate bands map to three distinct sentences', () => {
    const high = targetStatusSentence({ attempts: 10, hitRate: 0.75 });
    const mid = targetStatusSentence({ attempts: 10, hitRate: 0.5 });
    const low = targetStatusSentence({ attempts: 10, hitRate: 0.1 });
    expect(new Set([high, mid, low]).size).toBe(3);
    for (const s of [high, mid, low]) expect(s.length).toBeGreaterThan(0);
  });

  it('never leaks stats jargon — no "CI", "baseline", "n=", "rolling"', () => {
    const jargon = /\bCI\b|baseline|n=|rolling/i;
    const all = [
      targetStatusSentence({ attempts: 0, hitRate: 0 }),
      ...ALL_PHASES.map((phase) => targetStatusSentence({ attempts: 10, hitRate: 0.5, learning: curve({ phase, decidedSince: 7 }) })),
      targetStatusSentence({ attempts: 10, hitRate: 0.75 }),
      targetStatusSentence({ attempts: 10, hitRate: 0.5 }),
      targetStatusSentence({ attempts: 10, hitRate: 0.1 }),
    ];
    for (const s of all) expect(s).not.toMatch(jargon);
  });
});
