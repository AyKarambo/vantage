import { describe, it, expect } from 'vitest';
import {
  emptyOverrides,
  applyAccepted,
  upsertHeroOverride,
  removeHeroOverride,
  upsertMapOverride,
  removeMapOverride,
  upsertSeasonOverride,
  mergeMasterData,
  type MasterData,
} from '../src/core/masterData';

const defaults: MasterData = {
  heroes: [
    { name: 'Ana', role: 'support' },
    { name: 'Mei', role: 'damage' },
  ],
  maps: [
    { name: 'Ilios', mode: 'Control', isActive: true },
    { name: 'Midtown', mode: 'Hybrid', isActive: true },
  ],
  seasons: [{ start: Date.parse('2025-01-01'), label: '2025 Season 1' }],
};

describe('hero overrides', () => {
  it('stores a role change as a patch, and drops it when reverted to default (AC 11)', () => {
    let ov = upsertHeroOverride(emptyOverrides(), defaults, { name: 'Mei', role: 'tank' });
    expect(ov.heroes.Mei).toEqual({ name: 'Mei', role: 'tank' });
    expect(mergeMasterData(defaults, ov).heroes.find((h) => h.name === 'Mei')?.role).toBe('tank');
    ov = upsertHeroOverride(ov, defaults, { name: 'Mei', role: 'damage' });
    expect(ov.heroes.Mei).toBeUndefined();
  });

  it('keeps orphaned old entry when a rename is added (AC 12)', () => {
    // A rename = accept the new name; the old one is untouched (orphan) until removed.
    const ov = applyAccepted(emptyOverrides(), defaults, {
      heroes: [{ name: 'Mei-Ling', role: 'damage' }],
      maps: [],
    });
    const merged = mergeMasterData(defaults, ov);
    expect(merged.heroes.some((h) => h.name === 'Mei-Ling')).toBe(true);
    expect(merged.heroes.some((h) => h.name === 'Mei')).toBe(true); // orphan retained
  });

  it('tombstones a default on remove, drops a user-add on remove', () => {
    const tomb = removeHeroOverride(emptyOverrides(), defaults, 'Ana');
    expect(tomb.heroes.Ana).toEqual({ removed: true });
    const added = upsertHeroOverride(emptyOverrides(), defaults, { name: 'Ghost', role: 'tank' });
    const dropped = removeHeroOverride(added, defaults, 'Ghost');
    expect(dropped.heroes.Ghost).toBeUndefined();
  });
});

describe('map overrides & accepted updates', () => {
  it('accepts a new map as active (AC 29)', () => {
    const ov = applyAccepted(emptyOverrides(), defaults, {
      heroes: [],
      maps: [{ name: 'Aatlis', mode: 'Flashpoint', isActive: true }],
    });
    expect(mergeMasterData(defaults, ov).maps.find((m) => m.name === 'Aatlis')?.isActive).toBe(true);
  });

  it('preserves an inactive flag when accepting a mode change (AC 28)', () => {
    // User marks Midtown inactive, then accepts a mode correction.
    let ov = upsertMapOverride(emptyOverrides(), defaults, { name: 'Midtown', mode: 'Hybrid', isActive: false });
    ov = applyAccepted(ov, defaults, {
      heroes: [],
      maps: [{ name: 'Midtown', mode: 'Clash', isActive: false }],
    });
    const midtown = mergeMasterData(defaults, ov).maps.find((m) => m.name === 'Midtown');
    expect(midtown).toEqual({ name: 'Midtown', mode: 'Clash', isActive: false });
  });

  it('drops a map patch when toggled back to the default', () => {
    let ov = upsertMapOverride(emptyOverrides(), defaults, { name: 'Ilios', mode: 'Control', isActive: false });
    expect(ov.maps.ilios).toBeDefined();
    ov = upsertMapOverride(ov, defaults, { name: 'Ilios', mode: 'Control', isActive: true });
    expect(ov.maps.ilios).toBeUndefined();
  });

  it('removes a user-added map cleanly', () => {
    let ov = upsertMapOverride(emptyOverrides(), defaults, { name: 'Custom', mode: 'Push', isActive: true });
    ov = removeMapOverride(ov, defaults, 'Custom');
    expect(ov.maps).toEqual({});
  });
});

describe('season overrides', () => {
  it('adds a user season and can relabel it', () => {
    const start = Date.parse('2025-06-01');
    const ov = upsertSeasonOverride(emptyOverrides(), defaults, { start, label: 'Summer Split' });
    const merged = mergeMasterData(defaults, ov);
    expect(merged.seasons.find((s) => s.start === start)?.label).toBe('Summer Split');
  });
});
