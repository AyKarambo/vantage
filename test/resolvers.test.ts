import { describe, it, expect } from 'vitest';
import { resolveAccount } from '../src/core/resolvers/account';
import { resolveRole } from '../src/core/resolvers/role';
import { resolveResult } from '../src/core/resolvers/result';
import { buildMapIndex, resolveMap, normalizeMapName } from '../src/core/resolvers/map';

describe('resolveAccount', () => {
  const map = { 'Karambo#21234': 'Karambo', BobRoss: 'BobRoss' };

  it('matches exact battletag', () => {
    expect(resolveAccount('Karambo#21234', map)).toBe('Karambo');
  });
  it('matches case-insensitively', () => {
    expect(resolveAccount('karambo#21234', map)).toBe('Karambo');
  });
  it('matches name-only config against a full tag', () => {
    expect(resolveAccount('BobRoss#9999', map)).toBe('BobRoss');
  });
  it('returns undefined for unknown tag', () => {
    expect(resolveAccount('Stranger#0001', map)).toBeUndefined();
  });
  it('returns undefined for missing tag', () => {
    expect(resolveAccount(undefined, map)).toBeUndefined();
  });
});

describe('resolveRole', () => {
  it('maps open queue to openQ regardless of hero', () => {
    expect(resolveRole('open', 'tank')).toBe('openQ');
  });
  it('maps tank/damage/support', () => {
    expect(resolveRole('role', 'tank')).toBe('tank');
    expect(resolveRole('role', 'damage')).toBe('damage');
    expect(resolveRole('role', 'support')).toBe('support');
  });
  it('normalizes alternate damage spellings', () => {
    expect(resolveRole('role', 'offense')).toBe('damage');
    expect(resolveRole('role', 'DPS')).toBe('damage');
  });
  it('returns undefined for unknown role', () => {
    expect(resolveRole('role', undefined)).toBeUndefined();
    expect(resolveRole('role', 'mystery')).toBeUndefined();
  });
});

describe('resolveResult', () => {
  it('maps victory/defeat/draw', () => {
    expect(resolveResult('Victory')).toBe('Win');
    expect(resolveResult('defeat')).toBe('Loss');
    expect(resolveResult('DRAW')).toBe('Draw');
  });
  it('accepts win/loss/tie spellings', () => {
    expect(resolveResult('win')).toBe('Win');
    expect(resolveResult('lost')).toBe('Loss');
    expect(resolveResult('tie')).toBe('Draw');
  });
  it('returns undefined for unknown', () => {
    expect(resolveResult('???')).toBeUndefined();
  });
});

describe('resolveMap', () => {
  const index = buildMapIndex([
    { pageId: 'p1', name: "King's Row" },
    { pageId: 'p2', name: 'Circuit Royal' },
  ]);

  it('matches despite apostrophe/case differences', () => {
    expect(resolveMap('kings row', index).pageId).toBe('p1');
    expect(resolveMap("KING'S ROW", index).pageId).toBe('p1');
  });
  it('applies aliases', () => {
    expect(resolveMap('KR', index, { KR: "King's Row" }).pageId).toBe('p1');
  });
  it('reports no match for unknown map', () => {
    expect(resolveMap('Nepal', index).matched).toBe(false);
  });
  it('normalizes consistently', () => {
    expect(normalizeMapName("King's Row")).toBe(normalizeMapName('kings row'));
  });
});
