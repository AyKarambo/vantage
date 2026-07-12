import { describe, it, expect } from 'vitest';
import { resolveMapId, MAP_ID_TO_NAME } from '../src/core/resolvers/mapId';
import { MAP_MODES } from '../src/core/maps';

describe('resolveMapId', () => {
  it('resolves the documented map id 1207 to Nepal (string or number)', () => {
    expect(resolveMapId('1207')).toBe('Nepal');
    expect(resolveMapId(1207)).toBe('Nepal');
  });

  it("resolves King's Row and folds its Winter variant to the base map", () => {
    expect(resolveMapId('212')).toBe("King's Row");
    expect(resolveMapId('1713')).toBe("King's Row");
  });

  it('passes an already-resolved name through unchanged', () => {
    expect(resolveMapId('Nepal')).toBe('Nepal');
    expect(resolveMapId("King's Row")).toBe("King's Row");
  });

  it('keeps an unknown numeric id (graceful degrade, resolvable later)', () => {
    expect(resolveMapId('999999')).toBe('999999');
  });

  it('returns undefined for empty/nullish', () => {
    expect(resolveMapId(undefined)).toBeUndefined();
    expect(resolveMapId(null)).toBeUndefined();
    expect(resolveMapId('')).toBeUndefined();
  });

  it('every table name is a canonical map known to MAP_MODES (spelling guard)', () => {
    for (const name of Object.values(MAP_ID_TO_NAME)) {
      expect(MAP_MODES[name], `"${name}" not a canonical MAP_MODES key`).toBeDefined();
    }
  });
});
