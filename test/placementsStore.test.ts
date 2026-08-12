import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PlacementStore } from '../src/store/placements';
import type { PlacementRun } from '../src/core/placements';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vantage-placements-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const run = (p: Partial<PlacementRun> = {}): PlacementRun => ({
  account: 'Main',
  role: 'tank',
  startedAt: 1000,
  preRunAnchor: null,
  predictions: {},
  ...p,
});

describe('PlacementStore', () => {
  it('starts empty for a fresh/empty dir', () => {
    const s = new PlacementStore(dir);
    expect(s.allRuns()).toEqual([]);
    expect(s.getRun('Main', 'tank')).toBeUndefined();
    expect(s.declinedFor('Main', 'tank')).toEqual([]);
  });

  it('round-trips a run through save + reload', () => {
    const s = new PlacementStore(dir);
    s.setRun(run({ preRunAnchor: { tier: 'Gold', division: 3, progressPct: 40, setAt: 1 } }));
    expect(s.getRun('Main', 'tank')).toMatchObject({ account: 'Main', role: 'tank' });

    const reopened = new PlacementStore(dir);
    expect(reopened.getRun('Main', 'tank')).toEqual(run({ preRunAnchor: { tier: 'Gold', division: 3, progressPct: 40, setAt: 1 } }));
    expect(reopened.allRuns()).toHaveLength(1);
  });

  it('recovers from corrupt JSON as empty state, without throwing', () => {
    fs.writeFileSync(path.join(dir, 'placements.json'), '{ not json', 'utf8');
    expect(() => new PlacementStore(dir)).not.toThrow();
    const s = new PlacementStore(dir);
    expect(s.allRuns()).toEqual([]);
    expect(s.declinedFor('Main', 'tank')).toEqual([]);
  });

  it('recovers from a top-level array as empty state, without throwing', () => {
    fs.writeFileSync(path.join(dir, 'placements.json'), JSON.stringify([1, 2, 3]), 'utf8');
    expect(() => new PlacementStore(dir)).not.toThrow();
    expect(new PlacementStore(dir).allRuns()).toEqual([]);
  });

  it('defaults a missing predictions field to {}', () => {
    fs.writeFileSync(
      path.join(dir, 'placements.json'),
      JSON.stringify({ runs: { 'Main::tank': { account: 'Main', role: 'tank', startedAt: 1 } }, declined: {} }),
      'utf8',
    );
    const s = new PlacementStore(dir);
    expect(s.getRun('Main', 'tank')?.predictions).toEqual({});
  });

  it('drops a malformed run but keeps sibling runs intact', () => {
    fs.writeFileSync(
      path.join(dir, 'placements.json'),
      JSON.stringify({
        runs: {
          'Main::tank': { account: 'Main', role: 'tank', startedAt: 1 }, // missing predictions, still valid
          'Main::damage': { role: 'damage', startedAt: 1 }, // missing account -> dropped
          'Alt::support': { account: 'Alt', role: 'support' }, // missing startedAt -> dropped
        },
        declined: {},
      }),
      'utf8',
    );
    const s = new PlacementStore(dir);
    expect(s.allRuns()).toHaveLength(1);
    expect(s.getRun('Main', 'tank')).toBeDefined();
    expect(s.getRun('Main', 'damage')).toBeUndefined();
    expect(s.getRun('Alt', 'support')).toBeUndefined();
  });

  it('round-trips an unknown field inside a run through a load/save cycle', () => {
    fs.writeFileSync(
      path.join(dir, 'placements.json'),
      JSON.stringify({
        runs: { 'Main::tank': { account: 'Main', role: 'tank', startedAt: 1, predictions: {}, futureField: 'keep-me' } },
        declined: {},
      }),
      'utf8',
    );
    const s = new PlacementStore(dir);
    expect((s.getRun('Main', 'tank') as any).futureField).toBe('keep-me');

    // Force a save (setRun on a different track) and confirm the field survives the round trip.
    s.setRun(run({ account: 'Alt', role: 'support' }));
    const reopened = new PlacementStore(dir);
    expect((reopened.getRun('Main', 'tank') as any).futureField).toBe('keep-me');
  });

  it('addDeclined is idempotent (no duplicate entries)', () => {
    const s = new PlacementStore(dir);
    s.addDeclined('Main', 'tank', 100);
    s.addDeclined('Main', 'tank', 100);
    s.addDeclined('Main', 'tank', 200);
    expect(s.declinedFor('Main', 'tank')).toEqual([100, 200]);
    expect(new PlacementStore(dir).declinedFor('Main', 'tank')).toEqual([100, 200]); // persisted
  });

  it('removeRun deletes the run and reports whether anything was removed', () => {
    const s = new PlacementStore(dir);
    s.setRun(run());
    expect(s.removeRun('Main', 'tank')).toBe(true);
    expect(s.getRun('Main', 'tank')).toBeUndefined();
    expect(new PlacementStore(dir).getRun('Main', 'tank')).toBeUndefined(); // persisted
    expect(s.removeRun('Main', 'tank')).toBe(false);
  });

  it('removeAccount drops every run and decline record for an account across roles, leaving others', () => {
    const s = new PlacementStore(dir);
    s.setRun(run({ account: 'Rando#4521', role: 'tank' }));
    s.setRun(run({ account: 'Rando#4521', role: 'damage' }));
    s.setRun(run({ account: 'Karambo', role: 'support' }));
    s.addDeclined('Rando#4521', 'tank', 100);
    s.addDeclined('Karambo', 'support', 100);

    expect(s.removeAccount('Rando#4521')).toBe(3); // 2 runs + 1 declined record
    expect(s.getRun('Rando#4521', 'tank')).toBeUndefined();
    expect(s.getRun('Rando#4521', 'damage')).toBeUndefined();
    expect(s.declinedFor('Rando#4521', 'tank')).toEqual([]);
    expect(s.getRun('Karambo', 'support')).toBeDefined();
    expect(s.declinedFor('Karambo', 'support')).toEqual([100]);

    // Persisted, and removing an absent account is a no-op.
    expect(new PlacementStore(dir).getRun('Karambo', 'support')).toBeDefined();
    expect(s.removeAccount('Ghost')).toBe(0);
  });

  it('relabel moves runs and declines to the new account label and re-keys them', () => {
    const s = new PlacementStore(dir);
    s.setRun(run({ account: 'Main', role: 'tank' }));
    s.setRun(run({ account: 'Main', role: 'support' }));
    s.setRun(run({ account: 'Alt', role: 'damage' }));
    s.addDeclined('Main', 'tank', 100);
    s.addDeclined('Alt', 'damage', 100);

    expect(s.relabel('Main', 'MainDPS')).toBe(3); // 2 runs + 1 declined record
    expect(s.getRun('Main', 'tank')).toBeUndefined();
    expect(s.getRun('MainDPS', 'tank')).toMatchObject({ account: 'MainDPS' });
    expect(s.getRun('MainDPS', 'support')).toBeDefined();
    expect(s.declinedFor('Main', 'tank')).toEqual([]);
    expect(s.declinedFor('MainDPS', 'tank')).toEqual([100]);
    expect(s.getRun('Alt', 'damage')).toBeDefined();
    expect(s.declinedFor('Alt', 'damage')).toEqual([100]);

    expect(s.relabel('Ghost', 'Nope')).toBe(0);
    expect(s.relabel('MainDPS', 'MainDPS')).toBe(0);
  });

  it('relocate moves the file to a new dir and reloads from there', () => {
    const s = new PlacementStore(dir);
    s.setRun(run());

    const newDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vantage-placements-new-'));
    try {
      fs.copyFileSync(path.join(dir, 'placements.json'), path.join(newDir, 'placements.json'));
      s.relocate(newDir);

      expect(s.getRun('Main', 'tank')).toBeDefined();
      s.setRun(run({ account: 'Alt', role: 'damage' }));
      expect(new PlacementStore(newDir).getRun('Alt', 'damage')).toBeDefined();
      // relocate itself doesn't touch the old dir's file (copy is the migration executor's job).
      expect(new PlacementStore(dir).getRun('Alt', 'damage')).toBeUndefined();
    } finally {
      fs.rmSync(newDir, { recursive: true, force: true });
    }
  });
});
