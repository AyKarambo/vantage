import { describe, it, expect } from 'vitest';
import { diffMasterData, isPreviewEmpty, type MasterData } from '../src/core/masterData';

const effective: MasterData = {
  heroes: [
    { name: 'Ana', role: 'support' },
    { name: 'Doomfist', role: 'tank' },
  ],
  maps: [
    { name: 'Ilios', mode: 'Control', isActive: true },
    { name: 'Midtown', mode: 'Hybrid', isActive: false }, // user toggled inactive
  ],
  seasons: [],
};

describe('diffMasterData', () => {
  it('reports hero additions and role changes (AC 5)', () => {
    const preview = diffMasterData(effective, {
      heroes: [
        { name: 'Ana', role: 'support' },
        { name: 'Venture', role: 'damage' }, // new
        { name: 'Doomfist', role: 'damage' }, // role changed
      ],
      maps: [],
    });
    expect(preview.heroes.additions.map((h) => h.name)).toEqual(['Venture']);
    expect(preview.heroes.changes).toEqual([
      { from: { name: 'Doomfist', role: 'tank' }, to: { name: 'Doomfist', role: 'damage' } },
    ]);
  });

  it('reports map additions and mode changes', () => {
    const preview = diffMasterData(effective, {
      heroes: [],
      maps: [
        { name: 'Aatlis', mode: 'Flashpoint', isActive: true }, // new
        { name: 'Ilios', mode: 'Push', isActive: true }, // mode changed
      ],
    });
    expect(preview.maps.additions.map((m) => m.name)).toEqual(['Aatlis']);
    expect(preview.maps.changes.length).toBe(1);
    expect(preview.maps.changes[0].to.mode).toBe('Push');
  });

  it('never treats an isActive difference as a change (AC 27)', () => {
    // Midtown is inactive locally; the fetched copy is active but same mode.
    const preview = diffMasterData(effective, {
      heroes: [],
      maps: [{ name: 'Midtown', mode: 'Hybrid', isActive: true }],
    });
    expect(preview.maps.changes).toEqual([]);
    expect(preview.maps.additions).toEqual([]);
  });

  it('preserves the local isActive on a proposed mode change (AC 28)', () => {
    const preview = diffMasterData(effective, {
      heroes: [],
      maps: [{ name: 'Midtown', mode: 'Clash', isActive: true }],
    });
    expect(preview.maps.changes[0].to).toEqual({ name: 'Midtown', mode: 'Clash', isActive: false });
  });

  it('does not downgrade a known mode to Unknown', () => {
    const preview = diffMasterData(effective, {
      heroes: [],
      maps: [{ name: 'Ilios', mode: 'Unknown', isActive: true }],
    });
    expect(preview.maps.changes).toEqual([]);
  });

  it('is empty when everything matches (AC 9)', () => {
    const preview = diffMasterData(effective, {
      heroes: [
        { name: 'Ana', role: 'support' },
        { name: 'Doomfist', role: 'tank' },
      ],
      maps: [{ name: 'Ilios', mode: 'Control', isActive: true }],
    });
    expect(isPreviewEmpty(preview)).toBe(true);
  });
});
