import { describe, it, expect, vi } from 'vitest';
import { createDataProvider, type DataProviderDeps } from '../src/main/dataProvider';
import type { GameRecord, MatchReview } from '../src/core/analytics';
import type { CheckInInput, SessionCheckIn } from '../src/core/checkIn';

const game = (review?: MatchReview): GameRecord => ({
  matchId: 'manual-1', timestamp: 1, account: 'Main', role: 'damage', map: 'Ilios',
  result: 'Win', gameType: 'Competitive', source: 'manual', heroes: [],
  ...(review ? { review } : {}),
});

describe('saveReview — focus & break mark', () => {
  function harness() {
    const setReview = vi.fn(() => true);
    const deps = {
      history: { setReview, editManual: vi.fn() },
      getConfig: () => ({ accounts: { main: 'Main' } }),
    } as unknown as DataProviderDeps;
    return { provider: createDataProvider(deps), setReview };
  }

  it('round-trips focusTargetIds and breakBefore', () => {
    const { provider, setReview } = harness();
    provider.saveReview({ matchId: 'm1', grades: {}, flags: {}, focusTargetIds: ['t-1'], breakBefore: false });
    expect(setReview).toHaveBeenCalledWith('m1', expect.objectContaining({ focusTargetIds: ['t-1'], breakBefore: false }));
  });

  it('keeps a deliberate empty focus list', () => {
    const { provider, setReview } = harness();
    provider.saveReview({ matchId: 'm1', grades: {}, flags: {}, focusTargetIds: [] });
    expect(setReview.mock.calls[0][1]).toHaveProperty('focusTargetIds', []);
  });

  it('filters non-string focus ids and ignores a non-boolean breakBefore (untrusted IPC)', () => {
    const { provider, setReview } = harness();
    provider.saveReview({
      matchId: 'm1', grades: {}, flags: {},
      focusTargetIds: ['t-1', 7, null] as unknown as string[], breakBefore: 'yes' as unknown as boolean,
    });
    const review = setReview.mock.calls[0][1] as MatchReview;
    expect(review.focusTargetIds).toEqual(['t-1']);
    expect(review).not.toHaveProperty('breakBefore');
  });

  it('adds neither key when absent', () => {
    const { provider, setReview } = harness();
    provider.saveReview({ matchId: 'm1', grades: {}, flags: {} });
    const review = setReview.mock.calls[0][1] as MatchReview;
    expect(review).not.toHaveProperty('focusTargetIds');
    expect(review).not.toHaveProperty('breakBefore');
  });
});

describe('logMatch — focus & break mark', () => {
  function harness() {
    const recorded: GameRecord[] = [];
    const deps = {
      recordGame: (g: GameRecord) => { recorded.push(g); },
      getConfig: () => ({ accounts: { main: 'Main' } }),
    } as unknown as DataProviderDeps;
    return { provider: createDataProvider(deps), recorded };
  }
  const base = { result: 'Win', role: 'damage', map: 'Ilios', gameType: 'Quick Play' } as const;

  it('stores a review for "Nothing specific" even with no grades', () => {
    const { provider, recorded } = harness();
    provider.logMatch({ ...base, focusTargetIds: [] });
    expect(recorded[0].review).toMatchObject({ grades: {}, focusTargetIds: [] });
  });

  it('stores focus and break mark alongside grades', () => {
    const { provider, recorded } = harness();
    provider.logMatch({ ...base, grades: { 't-1': 'hit' }, focusTargetIds: ['t-1'], breakBefore: true });
    expect(recorded[0].review).toMatchObject({ grades: { 't-1': 'hit' }, focusTargetIds: ['t-1'], breakBefore: true });
  });

  it('creates a review for a break mark alone', () => {
    const { provider, recorded } = harness();
    provider.logMatch({ ...base, breakBefore: false });
    expect(recorded[0].review).toMatchObject({ breakBefore: false });
    expect(recorded[0].review).not.toHaveProperty('focusTargetIds');
  });

  it('still stores no review when nothing review-like was provided', () => {
    const { provider, recorded } = harness();
    provider.logMatch({ ...base });
    expect(recorded[0]).not.toHaveProperty('review');
  });
});

describe('editMatch — keeps focus & break mark', () => {
  it('preserves focusTargetIds / breakBefore when re-stamping the review', () => {
    const patches: Array<Partial<GameRecord>> = [];
    const g = game({ at: 1, grades: { 't-1': 'hit' }, flags: {}, focusTargetIds: ['t-1'], breakBefore: true });
    const deps = {
      history: { all: () => [g], editManual: (_id: string, p: Partial<GameRecord>) => { patches.push(p); } },
      getConfig: () => ({ accounts: { main: 'Main' } }),
    } as unknown as DataProviderDeps;
    createDataProvider(deps).editMatch({ matchId: 'manual-1', mental: { tilt: true } });
    expect(patches[0].review).toMatchObject({
      grades: { 't-1': 'hit' }, flags: { tilt: true }, focusTargetIds: ['t-1'], breakBefore: true,
    });
  });
});

describe('recordCheckIn', () => {
  function harness() {
    const added: SessionCheckIn[] = [];
    const deps = {
      checkIns: { all: () => added, add: (e: SessionCheckIn) => { added.push(e); return e; } },
      getConfig: () => ({ accounts: {} }),
    } as unknown as DataProviderDeps;
    return { provider: createDataProvider(deps), added };
  }

  it('rejects an invalid mood and stores nothing', () => {
    const { provider, added } = harness();
    expect(() => provider.recordCheckIn({ mood: 'furious' } as unknown as CheckInInput)).toThrow('Invalid check-in');
    expect(added).toEqual([]);
  });

  it('stores a valid check-in with its optional answers', () => {
    const { provider, added } = harness();
    provider.recordCheckIn({ mood: 'calm', sleep: 'good', focusTargetIds: ['t-1'] });
    expect(added[0]).toMatchObject({ mood: 'calm', sleep: 'good', focusTargetIds: ['t-1'] });
    expect(typeof added[0].at).toBe('number');
  });
});
