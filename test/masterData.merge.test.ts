import { describe, it, expect } from 'vitest';
import {
  emptyOverrides,
  mergeHeroes,
  mergeMaps,
  mergeSeasons,
  mergeMasterData,
  type MapEntry,
  type HeroEntry,
  type MasterData,
} from '../src/core/masterData';

const heroes: HeroEntry[] = [
  { name: 'Ana', role: 'support' },
  { name: 'Mei', role: 'damage' },
];
const maps: MapEntry[] = [
  { name: "King's Row", mode: 'Hybrid', isActive: true },
  { name: 'Ilios', mode: 'Control', isActive: true },
];

describe('mergeHeroes', () => {
  it('adds a new hero', () => {
    const out = mergeHeroes(heroes, { Venture: { name: 'Venture', role: 'damage' } });
    expect(out.find((h) => h.name === 'Venture')?.role).toBe('damage');
  });

  it('applies a role edit as a patch (AC 2/11 forward-only)', () => {
    const out = mergeHeroes(heroes, { Mei: { role: 'tank' } });
    expect(out.find((h) => h.name === 'Mei')?.role).toBe('tank');
  });

  it('removes via tombstone (AC 3)', () => {
    const out = mergeHeroes(heroes, { Ana: { removed: true } });
    expect(out.some((h) => h.name === 'Ana')).toBe(false);
  });

  it('dedupes a user-add that later ships as a default (AC 16)', () => {
    // Mei is already a default; an override keyed the same collapses to one row.
    const out = mergeHeroes(heroes, { Mei: { name: 'Mei', role: 'damage' } });
    expect(out.filter((h) => h.name === 'Mei').length).toBe(1);
  });

  it('ignores an addition with no role', () => {
    const out = mergeHeroes(heroes, { Ghost: { name: 'Ghost' } });
    expect(out.some((h) => h.name === 'Ghost')).toBe(false);
  });
});

describe('mergeMaps', () => {
  it('missing isActive defaults to active (AC 30)', () => {
    const out = mergeMaps(maps, { ilios: { mode: 'Control' } });
    expect(out.find((m) => m.name === 'Ilios')?.isActive).toBe(true);
  });

  it('honors an explicit inactive toggle (AC 26)', () => {
    const out = mergeMaps(maps, { ilios: { isActive: false } });
    const ilios = out.find((m) => m.name === 'Ilios');
    expect(ilios?.isActive).toBe(false);
    expect(ilios?.mode).toBe('Control'); // mode preserved from base
  });

  it('edits a mode while keeping active state', () => {
    const out = mergeMaps(maps, { ilios: { mode: 'Push' } });
    const ilios = out.find((m) => m.name === 'Ilios');
    expect(ilios?.mode).toBe('Push');
    expect(ilios?.isActive).toBe(true);
  });

  it('adds a brand-new map', () => {
    const out = mergeMaps(maps, { aatlis: { name: 'Aatlis', mode: 'Flashpoint', isActive: true } });
    expect(out.find((m) => m.name === 'Aatlis')?.mode).toBe('Flashpoint');
  });

  it('removes via tombstone', () => {
    const out = mergeMaps(maps, { ilios: { removed: true } });
    expect(out.some((m) => m.name === 'Ilios')).toBe(false);
  });

  it('applies overrides on top of changed defaults (AC 17)', () => {
    // A later app version changes the built-in mode; the user's inactive toggle still applies.
    const changedDefaults: MapEntry[] = [{ name: 'Ilios', mode: 'Flashpoint', isActive: true }];
    const out = mergeMaps(changedDefaults, { ilios: { isActive: false } });
    const ilios = out.find((m) => m.name === 'Ilios');
    expect(ilios?.mode).toBe('Flashpoint'); // new default mode shows through
    expect(ilios?.isActive).toBe(false); // user edit still applies
  });
});

describe('mergeSeasons', () => {
  const s1 = Date.parse('2025-01-01');
  const s2 = Date.parse('2025-03-05');
  const reset = Date.parse('2026-02-10'); // a known default reset (RESET_SEASON_STARTS)

  it('adds a user season and applies a custom label', () => {
    const out = mergeSeasons([s1], { [`S:${new Date(s2).toISOString().slice(0, 10)}`]: { start: s2, label: 'My Split' } });
    expect(out.map((s) => s.start)).toContain(s2);
    expect(out.find((s) => s.start === s2)?.label).toBe('My Split');
  });

  it('removes a default season via tombstone', () => {
    const key = `S:${new Date(s1).toISOString().slice(0, 10)}`;
    const out = mergeSeasons([s1, s2], { [key]: { removed: true } });
    expect(out.some((s) => s.start === s1)).toBe(false);
  });

  it('a default reset season keeps isReset through mergeSeasons/mergeMasterData', () => {
    const out = mergeSeasons([s1, reset], {});
    expect(out.find((s) => s.start === reset)?.isReset).toBe(true);
    expect(out.find((s) => s.start === s1)?.isReset).toBeFalsy();

    const merged = mergeMasterData(
      { heroes, maps, seasons: [{ start: s1, label: 'S1' }, { start: reset, label: 'S2', isReset: true }] },
      { ...emptyOverrides() },
    );
    expect(merged.seasons.find((s) => s.start === reset)?.isReset).toBe(true);
  });

  it('a patch can turn a default reset season off', () => {
    const key = `S:${new Date(reset).toISOString().slice(0, 10)}`;
    const out = mergeSeasons([s1, reset], { [key]: { isReset: false } });
    expect(out.find((s) => s.start === reset)?.isReset).toBeFalsy();
  });

  it('a patch can turn isReset on for a non-reset season', () => {
    const key = `S:${new Date(s1).toISOString().slice(0, 10)}`;
    const out = mergeSeasons([s1, reset], { [key]: { isReset: true } });
    expect(out.find((s) => s.start === s1)?.isReset).toBe(true);
  });

  it('a user-added season can carry isReset', () => {
    const key = `S:${new Date(s2).toISOString().slice(0, 10)}`;
    const out = mergeSeasons([s1], { [key]: { start: s2, label: 'My Split', isReset: true } });
    expect(out.find((s) => s.start === s2)?.isReset).toBe(true);
  });
});

describe('mergeMasterData', () => {
  it('merges all three categories together', () => {
    const defaults: MasterData = { heroes, maps, seasons: [{ start: Date.parse('2025-01-01'), label: 'S' }] };
    const out = mergeMasterData(defaults, {
      ...emptyOverrides(),
      heroes: { Venture: { name: 'Venture', role: 'damage' } },
      maps: { ilios: { isActive: false } },
    });
    expect(out.heroes.some((h) => h.name === 'Venture')).toBe(true);
    expect(out.maps.find((m) => m.name === 'Ilios')?.isActive).toBe(false);
  });
});
