import { describe, it, expect } from 'vitest';
import { resolveGepMapName, GEP_MAP_ALIASES, mapMode } from '../src/core/maps';

describe('resolveGepMapName', () => {
  it('translates a known numeric GEP map id to its canonical name', () => {
    expect(resolveGepMapName('4140')).toBe('Neon Junction');
  });

  it('folds the legacy "Neon Junktion" (k) spelling to the canonical "Neon Junction"', () => {
    expect(resolveGepMapName('Neon Junktion')).toBe('Neon Junction');
  });

  it('trims surrounding whitespace before matching', () => {
    expect(resolveGepMapName('  4140 ')).toBe('Neon Junction');
  });

  it('returns a canonical map name unchanged', () => {
    expect(resolveGepMapName("King's Row")).toBe("King's Row");
    expect(resolveGepMapName('Neon Junction')).toBe('Neon Junction');
  });

  it('passes undefined/empty through so callers keep their own fallback', () => {
    expect(resolveGepMapName(undefined)).toBeUndefined();
    expect(resolveGepMapName('')).toBe('');
  });

  it('every alias points at a map Vantage knows the game mode for', () => {
    for (const name of Object.values(GEP_MAP_ALIASES)) {
      expect(mapMode(name)).not.toBe('Unknown');
    }
  });
});
