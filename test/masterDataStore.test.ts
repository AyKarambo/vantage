import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MasterDataStore } from '../src/store/masterData';
import { emptyOverrides } from '../src/core/masterData';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vantage-md-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('MasterDataStore', () => {
  it('starts empty and round-trips overrides (AC 7)', () => {
    const store = new MasterDataStore(dir);
    expect(store.all()).toEqual(emptyOverrides());
    store.replace({ heroes: { Mei: { role: 'tank' } }, maps: {}, seasons: {} });
    // A fresh instance reads the persisted file.
    const reopened = new MasterDataStore(dir);
    expect(reopened.all().heroes.Mei).toEqual({ role: 'tank' });
  });

  it('relocates the backing file to a new dir (AC 17)', () => {
    const store = new MasterDataStore(dir);
    store.replace({ heroes: {}, maps: { ilios: { isActive: false } }, seasons: {} });
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'vantage-md2-'));
    // Simulate the migration copy, then relocate.
    fs.copyFileSync(path.join(dir, 'masterData.json'), path.join(dir2, 'masterData.json'));
    store.relocate(dir2);
    expect(store.all().maps.ilios).toEqual({ isActive: false });
    fs.rmSync(dir2, { recursive: true, force: true });
  });

  it('recovers from a corrupt file as empty overrides', () => {
    fs.writeFileSync(path.join(dir, 'masterData.json'), '{ not json', 'utf8');
    expect(new MasterDataStore(dir).all()).toEqual(emptyOverrides());
  });

  it('normalizes a partial payload', () => {
    fs.writeFileSync(path.join(dir, 'masterData.json'), JSON.stringify({ heroes: { X: { role: 'tank' } } }), 'utf8');
    const all = new MasterDataStore(dir).all();
    expect(all.heroes.X).toBeDefined();
    expect(all.maps).toEqual({});
    expect(all.seasons).toEqual({});
  });
});
