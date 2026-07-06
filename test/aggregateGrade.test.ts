import { describe, it, expect } from 'vitest';
import { aggregateImprovementGrade, matchExportSignature, NOTION_IMPROVEMENT_TARGET_ID } from '../src/core/targets';
import type { GameRecord, MatchReview } from '../src/core/analytics';

const BOOKKEEPING = NOTION_IMPROVEMENT_TARGET_ID;

function review(grades: MatchReview['grades'], flags: MatchReview['flags'] = {}): MatchReview {
  return { at: Date.now(), grades, flags };
}

function game(overrides: Partial<GameRecord> = {}): GameRecord {
  return {
    matchId: 'm1',
    timestamp: Date.now(),
    account: 'Main',
    role: 'damage',
    map: 'Ilios',
    result: 'Win',
    gameType: 'Competitive',
    heroes: ['Tracer'],
    ...overrides,
  };
}

describe('aggregateImprovementGrade', () => {
  const visibleTargetIds = new Set(['t-1', 't-2', 't-3']);

  it('all hit -> hit', () => {
    const r = review({ 't-1': 'hit', 't-2': 'hit' });
    expect(aggregateImprovementGrade(r, { visibleTargetIds, bookkeepingId: BOOKKEEPING })).toBe('hit');
  });

  it('all missed -> missed', () => {
    const r = review({ 't-1': 'missed', 't-2': 'missed' });
    expect(aggregateImprovementGrade(r, { visibleTargetIds, bookkeepingId: BOOKKEEPING })).toBe('missed');
  });

  it('mixed grades -> partial', () => {
    const r = review({ 't-1': 'hit', 't-2': 'hit', 't-3': 'missed' });
    expect(aggregateImprovementGrade(r, { visibleTargetIds, bookkeepingId: BOOKKEEPING })).toBe('partial');
  });

  it('single graded target passes through unchanged', () => {
    const r = review({ 't-1': 'hit' });
    expect(aggregateImprovementGrade(r, { visibleTargetIds, bookkeepingId: BOOKKEEPING })).toBe('hit');

    const r2 = review({ 't-1': 'missed' });
    expect(aggregateImprovementGrade(r2, { visibleTargetIds, bookkeepingId: BOOKKEEPING })).toBe('missed');
  });

  it('any partial among the mix -> partial', () => {
    const r = review({ 't-1': 'hit', 't-2': 'partial' });
    expect(aggregateImprovementGrade(r, { visibleTargetIds, bookkeepingId: BOOKKEEPING })).toBe('partial');
  });

  it('excludes the internal bookkeeping id from aggregation', () => {
    // Only a bookkeeping grade plus one visible 'missed' grade: the aggregate
    // must consider the visible grade alone (single passthrough), not mix in
    // the hidden id.
    const r = review({ [BOOKKEEPING]: 'hit', 't-1': 'missed' });
    expect(aggregateImprovementGrade(r, { visibleTargetIds, bookkeepingId: BOOKKEEPING })).toBe('missed');
  });

  it('falls back to the bookkeeping grade only when there are no visible authored grades', () => {
    const r = review({ [BOOKKEEPING]: 'partial' });
    expect(aggregateImprovementGrade(r, { visibleTargetIds, bookkeepingId: BOOKKEEPING })).toBe('partial');
  });

  it('precedence: in-app aggregate wins over the bookkeeping grade when both are present', () => {
    const r = review({ [BOOKKEEPING]: 'missed', 't-1': 'hit', 't-2': 'hit' });
    expect(aggregateImprovementGrade(r, { visibleTargetIds, bookkeepingId: BOOKKEEPING })).toBe('hit');
  });

  it('undefined when neither a visible grade nor a bookkeeping grade exists', () => {
    const r = review({});
    expect(aggregateImprovementGrade(r, { visibleTargetIds, bookkeepingId: BOOKKEEPING })).toBeUndefined();
  });

  it('undefined when the review itself is undefined', () => {
    expect(aggregateImprovementGrade(undefined, { visibleTargetIds, bookkeepingId: BOOKKEEPING })).toBeUndefined();
  });

  it('ignores grades for targets not in the visible set (e.g. a deleted target)', () => {
    const r = review({ 'deleted-target': 'hit' });
    expect(aggregateImprovementGrade(r, { visibleTargetIds, bookkeepingId: BOOKKEEPING })).toBeUndefined();
  });
});

describe('matchExportSignature', () => {
  it('is deterministic: same grade + same flags -> same string', () => {
    const g = game({ mental: { positiveComms: true } });
    const s1 = matchExportSignature(g, 'hit');
    const s2 = matchExportSignature(g, 'hit');
    expect(s1).toBe(s2);
  });

  it('flips when the grade is set', () => {
    const g = game();
    const before = matchExportSignature(g, undefined);
    const after = matchExportSignature(g, 'hit');
    expect(after).not.toBe(before);
  });

  it('flips when the grade is cleared', () => {
    const g = game();
    const set = matchExportSignature(g, 'hit');
    const cleared = matchExportSignature(g, undefined);
    expect(cleared).not.toBe(set);
  });

  it('flips when a mental flag is set', () => {
    const before = matchExportSignature(game(), 'hit');
    const after = matchExportSignature(game({ mental: { positiveComms: true } }), 'hit');
    expect(after).not.toBe(before);
  });

  it('flips when a mental flag is cleared', () => {
    const set = matchExportSignature(game({ mental: { positiveComms: true } }), 'hit');
    const cleared = matchExportSignature(game(), 'hit');
    expect(cleared).not.toBe(set);
  });

  it('is stable regardless of which of the two mental sources the flag came from', () => {
    const fromMental = matchExportSignature(game({ mental: { tilt: true } }), undefined);
    const fromReview = matchExportSignature(
      game({ review: { at: Date.now(), grades: {}, flags: { tilt: true } } }),
      undefined,
    );
    expect(fromMental).toBe(fromReview);
  });
});
