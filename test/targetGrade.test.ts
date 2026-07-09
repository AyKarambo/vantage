import { describe, it, expect } from 'vitest';
import { aggregateGrade } from '../src/core/analytics';

describe('aggregateGrade', () => {
  it('returns undefined for an empty list', () => {
    expect(aggregateGrade([])).toBeUndefined();
  });

  it('passes a single grade through unchanged', () => {
    expect(aggregateGrade(['hit'])).toBe('hit');
    expect(aggregateGrade(['partial'])).toBe('partial');
    expect(aggregateGrade(['missed'])).toBe('missed');
  });

  it('averages a hit + a missed to partial (order-independent)', () => {
    expect(aggregateGrade(['hit', 'missed'])).toBe('partial');
    expect(aggregateGrade(['missed', 'hit'])).toBe('partial');
  });

  it('rounds down: hit + partial reads partial, not hit', () => {
    expect(aggregateGrade(['hit', 'partial'])).toBe('partial');
  });

  it('rounds down: partial + missed reads missed, not partial', () => {
    expect(aggregateGrade(['partial', 'missed'])).toBe('missed');
  });

  it('keeps a uniform set at its own grade', () => {
    expect(aggregateGrade(['hit', 'hit', 'hit'])).toBe('hit');
    expect(aggregateGrade(['missed', 'missed'])).toBe('missed');
  });

  it('rounds a three-grade mix down toward the worse side', () => {
    expect(aggregateGrade(['hit', 'partial', 'missed'])).toBe('partial'); // 1.0
    expect(aggregateGrade(['hit', 'hit', 'missed'])).toBe('partial'); // 1.33 → floor
    expect(aggregateGrade(['missed', 'missed', 'hit'])).toBe('missed'); // 0.66 → floor
  });
});
