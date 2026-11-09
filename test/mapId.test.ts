import { describe, it, expect } from 'vitest';
import { resolveMapId, MAP_ID_TO_NAME } from '../src/core/resolvers/mapId';
import { MAP_MODES, isStadiumOnlyMap } from '../src/core/maps';

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

  it('resolves Neon Junction (GEP id 4140) and folds the legacy "Neon Junktion" spelling', () => {
    expect(resolveMapId('4140')).toBe('Neon Junction');
    expect(resolveMapId('Neon Junktion')).toBe('Neon Junction');
    expect(resolveMapId('Neon Junction')).toBe('Neon Junction');
  });

  it('resolves Aatlis (GEP id 3893)', () => {
    expect(resolveMapId('3893')).toBe('Aatlis');
  });

  it('resolves Watchpoint: Grímsvötn (GEP id 5050, string or number)', () => {
    expect(resolveMapId('5050')).toBe('Watchpoint: Grímsvötn');
    expect(resolveMapId(5050)).toBe('Watchpoint: Grímsvötn');
  });

  it('returns undefined for empty/nullish', () => {
    expect(resolveMapId(undefined)).toBeUndefined();
    expect(resolveMapId(null)).toBeUndefined();
    expect(resolveMapId('')).toBeUndefined();
  });

  // Named in Overwolf's table, game mode not yet verified — see mapId.ts.
  const UNCLASSIFIED = new Set(['Thames District', 'Powder Keg Mine', 'Serenza']);

  it('every table name is a canonical map known to MAP_MODES, a Stadium map, or a listed unclassified one (spelling guard)', () => {
    for (const name of Object.values(MAP_ID_TO_NAME)) {
      const known = MAP_MODES[name] !== undefined || isStadiumOnlyMap(name) || UNCLASSIFIED.has(name);
      expect(known, `"${name}" not a canonical map`).toBe(true);
    }
  });

  it('resolves the newer ids: Redwood Dam, re-issued ids, sub-areas and Stadium maps', () => {
    expect(resolveMapId('4704')).toBe('Redwood Dam');
    expect(resolveMapId('4784')).toBe('Esperança');
    expect(resolveMapId('4949')).toBe('Samoa');
    expect(resolveMapId('5195')).toBe('Lijiang Tower'); // Night Market sub-area
    expect(resolveMapId('4981')).toBe('Wuxing University');
    expect(isStadiumOnlyMap(resolveMapId('4698')!)).toBe(true);
    expect(isStadiumOnlyMap(resolveMapId('4778')!)).toBe(true);
  });
});
