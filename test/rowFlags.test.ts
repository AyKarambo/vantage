import { describe, it, expect } from 'vitest';
import { rowFlags } from '../src/core/mental';
import { computeDashboard } from '../src/core/dashboardData';
import type { GameRecord } from '../src/core/analytics';
import type { Result, Role } from '../src/core/model';

// ---- fixtures -------------------------------------------------------------

function game(p: Partial<GameRecord> & { result: Result; map: string; role: Role }): GameRecord {
  return {
    matchId: Math.random().toString(36).slice(2),
    timestamp: Date.now(),
    account: 'Main',
    gameType: 'Competitive',
    heroes: ['Tracer'],
    ...p,
  };
}

const base = { result: 'Win' as Result, map: 'Ilios', role: 'damage' as Role };

describe('rowFlags', () => {
  it('mental-only flag is carried through', () => {
    const g = game({ ...base, mental: { tilt: true } });
    expect(rowFlags(g)).toEqual({ tilt: true });
  });

  it('review-only flag is carried through', () => {
    const g = game({ ...base, review: { at: 1, grades: {}, flags: { toxicMates: true } } });
    expect(rowFlags(g)).toEqual({ toxicMates: true });
  });

  it('both sources on one game OR-merge without duplication', () => {
    const g = game({
      ...base,
      mental: { tilt: true },
      review: { at: 1, grades: {}, flags: { tilt: true, positiveComms: true } },
    });
    expect(rowFlags(g)).toEqual({ tilt: true, positiveComms: true });
  });

  it('legacy leaver flag merges to "leaver"', () => {
    const g = game({ ...base, mental: { leaver: true } });
    expect(rowFlags(g)).toEqual({ leaver: true });
  });

  it('my-team leaver flag merges to "leaver"', () => {
    const g = game({ ...base, mental: { leaverMyTeam: true } });
    expect(rowFlags(g)).toEqual({ leaver: true });
  });

  it('enemy-team leaver flag (from review) merges to "leaver"', () => {
    const g = game({ ...base, review: { at: 1, grades: {}, flags: { leaverEnemyTeam: true } } });
    expect(rowFlags(g)).toEqual({ leaver: true });
  });

  it('positiveComms flag is carried through', () => {
    const g = game({ ...base, mental: { positiveComms: true } });
    expect(rowFlags(g)).toEqual({ positiveComms: true });
  });

  it('unflagged game returns undefined', () => {
    expect(rowFlags(game({ ...base }))).toBeUndefined();
    expect(rowFlags(game({ ...base, mental: {} }))).toBeUndefined();
    expect(rowFlags(game({ ...base, review: { at: 1, grades: {}, flags: {} } }))).toBeUndefined();
  });
});

describe('computeDashboard — MatchRow.flags', () => {
  const demo = { active: false, preference: 'off' as const, hasRealHistory: true };

  it('a flagged fixture game carries flags on its MatchRow; an unflagged one omits the key', () => {
    const flagged = game({ ...base, matchId: 'flagged-1', mental: { tilt: true } });
    const clean = game({ ...base, matchId: 'clean-1', timestamp: flagged.timestamp - 1000 });
    const d = computeDashboard([flagged, clean], { days: 'all' }, demo);

    const flaggedRow = d.matches.find((m) => m.matchId === 'flagged-1');
    const cleanRow = d.matches.find((m) => m.matchId === 'clean-1');

    expect(flaggedRow?.flags).toEqual({ tilt: true });
    expect(cleanRow).not.toHaveProperty('flags');
  });
});
