import { describe, it, expect } from 'vitest';
import { leaverFlags, hasLeaver, mergeLeaver } from '../src/core/leaver';
import { sourceOf, isAutoTracked } from '../src/core/source';
import { mentalSummary } from '../src/core/mental';
import type { GameRecord } from '../src/core/analytics';

describe('leaverFlags', () => {
  it('nothing set → neither team', () => {
    expect(leaverFlags(undefined)).toEqual({ myTeam: false, enemyTeam: false });
    expect(leaverFlags({})).toEqual({ myTeam: false, enemyTeam: false });
  });

  it('legacy single leaver flag counts as a my-team leaver', () => {
    expect(leaverFlags({ leaver: true })).toEqual({ myTeam: true, enemyTeam: false });
  });

  it('team-specific flags are read independently', () => {
    expect(leaverFlags({ leaverEnemyTeam: true })).toEqual({ myTeam: false, enemyTeam: true });
    expect(leaverFlags({ leaverMyTeam: true, leaverEnemyTeam: true })).toEqual({ myTeam: true, enemyTeam: true });
  });

  it('hasLeaver / mergeLeaver combine sources', () => {
    expect(hasLeaver({ leaverEnemyTeam: true })).toBe(true);
    expect(hasLeaver({})).toBe(false);
    expect(mergeLeaver({ myTeam: true, enemyTeam: false }, { myTeam: false, enemyTeam: true }))
      .toEqual({ myTeam: true, enemyTeam: true });
  });
});

describe('sourceOf', () => {
  it('prefers the explicit source', () => {
    expect(sourceOf({ source: 'gep', matchId: 'manual-123' })).toBe('gep');
    expect(sourceOf({ source: 'manual', matchId: 'abc' })).toBe('manual');
  });

  it('infers manual from a manual-prefixed id, else gep', () => {
    expect(sourceOf({ matchId: 'manual-1700000000000' })).toBe('manual');
    expect(sourceOf({ matchId: 'manual-notion-x' })).toBe('manual');
    expect(sourceOf({ matchId: 'pseudo-abc-123' })).toBe('gep');
    expect(isAutoTracked({ matchId: 'pseudo-abc-123' })).toBe(true);
  });
});

describe('mentalSummary — leaver team breakdown', () => {
  const g = (mental: GameRecord['mental']): GameRecord => ({
    matchId: 'm', timestamp: 0, account: 'Main', role: 'damage', map: 'Ilios',
    result: 'Win', gameType: 'Competitive', heroes: [], mental,
  });

  it('counts my-team and enemy-team leavers separately, with a combined total', () => {
    const s = mentalSummary([
      g({ leaverMyTeam: true }),
      g({ leaverEnemyTeam: true }),
      g({ leaver: true }), // legacy → my team
      g({ leaverMyTeam: true, leaverEnemyTeam: true }),
      g({}),
    ]);
    expect(s.flags.leaverMyTeam).toBe(3); // two explicit + one legacy
    expect(s.flags.leaverEnemyTeam).toBe(2);
    expect(s.flags.leaver).toBe(4); // games with any leaver
  });

  it('OR-merges the quick-log flags and the Review flags without double counting', () => {
    const game: GameRecord = {
      ...g({ leaverMyTeam: true }),
      review: { at: 1, grades: {}, flags: { leaverMyTeam: true, leaverEnemyTeam: true } },
    };
    const s = mentalSummary([game]);
    expect(s.flags.leaverMyTeam).toBe(1);
    expect(s.flags.leaverEnemyTeam).toBe(1);
    expect(s.flags.leaver).toBe(1);
  });
});
