import { describe, it, expect } from 'vitest';
import type { GameRecord } from '../src/core/analytics';
import { manualGameRecord, matchEditPatch, reviewMarks } from '../src/core/matchEdit';
import type { ManualMatchInput } from '../src/shared/contract';

const NOW = 1_800_000_000_000;

function game(patch: Partial<GameRecord> = {}): GameRecord {
  return {
    matchId: 'm1', timestamp: NOW - 60_000, account: 'Main', role: 'damage', map: 'Ilios', result: 'Win',
    gameType: 'Competitive', heroes: ['Genji', 'Tracer'], source: 'gep', ...patch,
  };
}

describe('reviewMarks', () => {
  it('keeps only a string focus list and a boolean break mark', () => {
    expect(reviewMarks({ focusTargetIds: ['t1', 3, 't2'], breakBefore: true })).toEqual({ focusTargetIds: ['t1', 't2'], breakBefore: true });
    expect(reviewMarks({ focusTargetIds: 't1', breakBefore: 'yes' })).toEqual({});
  });

  it('keeps an empty focus list — "Nothing specific" is a deliberate choice', () => {
    expect(reviewMarks({ focusTargetIds: [] })).toEqual({ focusTargetIds: [] });
  });
});

describe('manualGameRecord', () => {
  const input: ManualMatchInput = { result: 'Win', role: 'tank', map: 'Nepal', gameType: 'Competitive', hero: 'Sigma' };

  it('builds a manual record, falling back to the default account and the single hero', () => {
    const g = manualGameRecord(input, { matchId: 'manual-1', now: NOW, account: 'Main' });
    expect(g).toMatchObject({ matchId: 'manual-1', timestamp: NOW, account: 'Main', source: 'manual', heroes: ['Sigma'] });
    expect(g.review).toBeUndefined();
  });

  it('clamps a played-at time to the past', () => {
    expect(manualGameRecord({ ...input, playedAt: NOW + 5_000 }, { matchId: 'x', now: NOW, account: 'Main' }).timestamp).toBe(NOW);
    expect(manualGameRecord({ ...input, playedAt: NOW - 5_000 }, { matchId: 'x', now: NOW, account: 'Main' }).timestamp).toBe(NOW - 5_000);
  });

  it('makes a review from grades, a focus choice or a break mark — not from nothing', () => {
    const at = { matchId: 'x', now: NOW, account: 'Main' };
    expect(manualGameRecord({ ...input, grades: { t1: 1 }, mental: { tilted: true } }, at).review)
      .toEqual({ at: NOW, grades: { t1: 1 }, flags: { tilted: true } });
    expect(manualGameRecord({ ...input, focusTargetIds: [] }, at).review).toEqual({ at: NOW, grades: {}, flags: {}, focusTargetIds: [] });
    expect(manualGameRecord({ ...input, breakBefore: false }, at).review).toEqual({ at: NOW, grades: {}, flags: {}, breakBefore: false });
    expect(manualGameRecord({ ...input, grades: {} }, at).review).toBeUndefined();
  });
});

describe('matchEditPatch', () => {
  it('stamps factsEditedAt when a fact changes on an auto-tracked match', () => {
    expect(matchEditPatch(game(), { matchId: 'm1', result: 'Loss' }, NOW)).toEqual({ result: 'Loss', factsEditedAt: NOW });
  });

  it('does not stamp it for an unchanged fact, a hero re-order, or a manual match', () => {
    expect(matchEditPatch(game(), { matchId: 'm1', result: 'Win', heroes: ['Tracer', 'Genji'] }, NOW).factsEditedAt).toBeUndefined();
    expect(matchEditPatch(game({ source: 'manual' }), { matchId: 'm1', result: 'Loss' }, NOW).factsEditedAt).toBeUndefined();
  });

  it('never counts the annotation layer as a fact', () => {
    const patch = matchEditPatch(game(), { matchId: 'm1', srDelta: 18, performance: 4, mental: { tilted: true } }, NOW);
    expect(patch.factsEditedAt).toBeUndefined();
    expect(patch).toMatchObject({ srDelta: 18, performance: 4, mental: { tilted: true } });
  });

  it('honours the played-at time on manual matches only, clamped to the past', () => {
    expect(matchEditPatch(game(), { matchId: 'm1', playedAt: NOW - 1 }, NOW).timestamp).toBeUndefined();
    expect(matchEditPatch(game({ source: 'manual' }), { matchId: 'm1', playedAt: NOW + 1 }, NOW).timestamp).toBe(NOW);
  });

  it('stores a plausible played-minutes correction, clears on null, ignores nonsense', () => {
    expect(matchEditPatch(game(), { matchId: 'm1', playedMinutes: 14 }, NOW).playedMinutesOverride).toBe(14);
    expect(matchEditPatch(game(), { matchId: 'm1', playedMinutes: null }, NOW)).toHaveProperty('playedMinutesOverride', null);
    expect(matchEditPatch(game(), { matchId: 'm1', playedMinutes: 500 }, NOW)).not.toHaveProperty('playedMinutesOverride');
  });

  it('re-stamps an existing review so its flags follow the mental edit, keeping its marks', () => {
    const reviewed = game({ review: { at: 1, grades: { t1: 1 }, flags: { tilted: true }, breakBefore: true }, mental: { tilted: true } });
    expect(matchEditPatch(reviewed, { matchId: 'm1', mental: {} }, NOW).review)
      .toEqual({ at: NOW, grades: { t1: 1 }, flags: {}, breakBefore: true });
  });

  it('never marks an unreviewed match reviewed without grades', () => {
    expect(matchEditPatch(game(), { matchId: 'm1', mental: { tilted: true } }, NOW).review).toBeUndefined();
  });
});
