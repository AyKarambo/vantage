import { describe, it, expect } from 'vitest';
import { DEFAULT_MASTER_DATA, defaultMasterData } from '../src/core/masterData';
import { HEROES_BY_ROLE } from '../src/core/heroes';
import { MAP_MODES } from '../src/core/maps';
import { SEASON_STARTS } from '../src/core/season';

describe('default master-data snapshot', () => {
  it('lists every current map as active', () => {
    for (const name of Object.keys(MAP_MODES)) {
      const entry = DEFAULT_MASTER_DATA.maps.find((m) => m.name === name);
      expect(entry, name).toBeDefined();
      expect(entry?.isActive, name).toBe(true);
    }
  });

  it('ships known-withheld maps inactive (AC 31)', () => {
    for (const name of ['Paris', 'Horizon Lunar Colony']) {
      const entry = DEFAULT_MASTER_DATA.maps.find((m) => m.name === name);
      expect(entry, name).toBeDefined();
      expect(entry?.isActive, name).toBe(false);
    }
  });

  it('covers every hero from HEROES_BY_ROLE with a valid role', () => {
    const total = Object.values(HEROES_BY_ROLE).reduce((n, p) => n + p.length, 0);
    expect(DEFAULT_MASTER_DATA.heroes.length).toBe(total);
    for (const h of DEFAULT_MASTER_DATA.heroes) {
      expect(['tank', 'damage', 'support']).toContain(h.role);
    }
  });

  it('derives one labelled season per known start', () => {
    expect(DEFAULT_MASTER_DATA.seasons.length).toBe(SEASON_STARTS.length);
    for (const s of DEFAULT_MASTER_DATA.seasons) {
      expect(s.label.length).toBeGreaterThan(0);
      expect(Number.isFinite(s.start)).toBe(true);
    }
    expect(DEFAULT_MASTER_DATA.seasons[DEFAULT_MASTER_DATA.seasons.length - 1].label).toBe('2026 Season 3');
  });

  it('returns a fresh, independent copy each call', () => {
    const a = defaultMasterData();
    a.maps[0].isActive = false;
    expect(defaultMasterData().maps[0].isActive).toBe(true);
  });
});
