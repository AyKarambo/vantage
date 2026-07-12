import { describe, it, expect } from 'vitest';
import { resolveGepMapName, GEP_MAP_ID_NAMES, mapMode } from '../src/core/maps';

describe('resolveGepMapName', () => {
  it('translates a known numeric GEP map id to its canonical name', () => {
    expect(resolveGepMapName('4140')).toBe('Neon Junktion');
  });

  it('trims surrounding whitespace before matching a numeric id', () => {
    expect(resolveGepMapName('  4140 ')).toBe('Neon Junktion');
  });

  it('returns a real map name unchanged', () => {
    expect(resolveGepMapName("King's Row")).toBe("King's Row");
    expect(resolveGepMapName('Neon Junktion')).toBe('Neon Junktion');
  });

  it('passes undefined/empty through so callers keep their own fallback', () => {
    expect(resolveGepMapName(undefined)).toBeUndefined();
    expect(resolveGepMapName('')).toBe('');
  });

  it('every mapped id points at a map Vantage knows the game mode for', () => {
    for (const name of Object.values(GEP_MAP_ID_NAMES)) {
      expect(mapMode(name)).not.toBe('Unknown');
    }
  });
});
