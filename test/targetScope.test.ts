import { describe, it, expect } from 'vitest';
import type { GameRecord } from '../src/core/analytics';
import type { Result } from '../src/core/model';
import { matchInTargetScope } from '../src/core/targets';

let seq = 0;
function game(p: Partial<GameRecord> = {}): GameRecord {
  seq += 1;
  return {
    matchId: `m-${seq}`,
    timestamp: 2000 + seq,
    account: 'Main',
    role: 'damage',
    map: 'Ilios',
    result: 'Win' as Result,
    gameType: 'Competitive',
    heroes: ['Tracer'],
    ...p,
  };
}

describe('matchInTargetScope', () => {
  it('an empty scope object matches every game', () => {
    expect(matchInTargetScope(game(), {})).toBe(true);
    expect(matchInTargetScope(game({ role: 'support', heroes: ['Ana'] }), {})).toBe(true);
  });

  it('both fields absent matches every game', () => {
    expect(matchInTargetScope(game({ role: 'openQ', heroes: ['Bastion', 'Tracer'] }), { roleScope: undefined, heroScope: undefined })).toBe(true);
  });

  it('hero scope matches when the hero is anywhere in game.heroes, not just index 0', () => {
    const g = game({ heroes: ['Bastion', 'Tracer'] });
    expect(matchInTargetScope(g, { heroScope: ['Tracer'] })).toBe(true);
  });

  it('hero scope folds casing / accents / punctuation via heroMatchKey', () => {
    const g = game({ heroes: ['Tracer'] });
    expect(matchInTargetScope(g, { heroScope: ['tracer'] })).toBe(true);
  });

  it('hero scope with multiple scoped heroes matches if any one of them is played', () => {
    const g = game({ heroes: ['Bastion', 'Tracer'] });
    expect(matchInTargetScope(g, { heroScope: ['Widowmaker', 'Tracer'] })).toBe(true);
  });

  it('hero scope with no match anywhere in game.heroes is false', () => {
    const g = game({ heroes: ['Bastion', 'Tracer'] });
    expect(matchInTargetScope(g, { heroScope: ['Widowmaker'] })).toBe(false);
  });

  it('role scope matches game.role exactly; a different role is false', () => {
    expect(matchInTargetScope(game({ role: 'damage' }), { roleScope: 'damage' })).toBe(true);
    expect(matchInTargetScope(game({ role: 'support' }), { roleScope: 'damage' })).toBe(false);
  });

  it('game.role === "openQ" with a role scope set is always false', () => {
    expect(matchInTargetScope(game({ role: 'openQ' }), { roleScope: 'damage' })).toBe(false);
    expect(matchInTargetScope(game({ role: 'openQ' }), { roleScope: 'tank' })).toBe(false);
    expect(matchInTargetScope(game({ role: 'openQ' }), { roleScope: 'support' })).toBe(false);
  });

  it('both role and hero scope set is an AND — one holding alone is false', () => {
    const g = game({ role: 'damage', heroes: ['Tracer'] });
    expect(matchInTargetScope(g, { roleScope: 'damage', heroScope: ['Tracer'] })).toBe(true);
    expect(matchInTargetScope(g, { roleScope: 'support', heroScope: ['Tracer'] })).toBe(false);
    expect(matchInTargetScope(g, { roleScope: 'damage', heroScope: ['Widowmaker'] })).toBe(false);
  });
});
