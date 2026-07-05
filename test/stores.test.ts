import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HistoryStore } from '../src/store/history';
import { RankAnchorStore } from '../src/store/rankAnchors';
import type { GameRecord } from '../src/core/analytics';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vantage-store-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const g = (p: Partial<GameRecord>): GameRecord => ({
  matchId: 'm', timestamp: 0, account: 'Main', role: 'damage', map: 'Ilios',
  result: 'Win', gameType: 'Competitive', heroes: [], ...p,
});

describe('HistoryStore manual-layer edits', () => {
  it('addMany dedups by matchId and saves once', () => {
    const h = new HistoryStore(dir);
    expect(h.addMany([g({ matchId: 'a' }), g({ matchId: 'b' })])).toEqual({ imported: 2, skipped: 0 });
    expect(h.addMany([g({ matchId: 'b' }), g({ matchId: 'c' })])).toEqual({ imported: 1, skipped: 1 });
    expect(h.count()).toBe(3);
  });

  it('editManual patches provided keys and deletes on null (clearing srDelta)', () => {
    const h = new HistoryStore(dir);
    h.add(g({ matchId: 'a', srDelta: 22, mental: { tilt: true } }));
    h.editManual('a', { srDelta: -10, map: 'Nepal' });
    expect(h.all()[0]).toMatchObject({ srDelta: -10, map: 'Nepal', mental: { tilt: true } });
    h.editManual('a', { srDelta: null });
    expect(h.all()[0].srDelta).toBeUndefined();
  });

  it('editManual returns false for an unknown id', () => {
    const h = new HistoryStore(dir);
    expect(h.editManual('nope', { map: 'x' })).toBe(false);
  });

  it('relabelAccount rewrites every matching game and persists', () => {
    const h = new HistoryStore(dir);
    h.addMany([g({ matchId: 'a', account: 'Main' }), g({ matchId: 'b', account: 'Main' }), g({ matchId: 'c', account: 'Alt' })]);
    expect(h.relabelAccount('Main', 'MainDPS')).toBe(2);
    expect(new HistoryStore(dir).all().filter((x) => x.account === 'MainDPS')).toHaveLength(2);
    expect(h.relabelAccount('Ghost', 'X')).toBe(0);
  });

  it('removeImported drops only imported games (keeps live/manual), reporting the removed set', () => {
    const h = new HistoryStore(dir);
    h.addMany([
      g({ matchId: 'live', importedAt: undefined }),          // live-tracked / hand-logged
      g({ matchId: 'imp1', importedAt: 1_700_000_000_000 }),  // imported
      g({ matchId: 'imp2', importedAt: 1_700_000_000_000 }),  // imported
    ]);
    expect(h.importedCount()).toBe(2);
    const removed = h.removeImported();
    expect(removed.map((r) => r.matchId).sort()).toEqual(['imp1', 'imp2']);
    expect(h.all().map((x) => x.matchId)).toEqual(['live']);
    expect(h.importedCount()).toBe(0);
    // Persisted (survives a reload) and a second call is a no-op.
    expect(new HistoryStore(dir).importedCount()).toBe(0);
    expect(h.removeImported()).toEqual([]);
  });
});

describe('RankAnchorStore', () => {
  it('sets, reads and maps anchors by account+role', () => {
    const s = new RankAnchorStore(dir);
    s.set({ account: 'Main', role: 'tank', tier: 'Gold', division: 3, progressPct: 40, setAt: 100 });
    expect(s.get('Main', 'tank')).toMatchObject({ tier: 'Gold', division: 3 });
    expect(s.map()['Main::tank']).toEqual({ tier: 'Gold', division: 3, progressPct: 40, setAt: 100 });
    expect(new RankAnchorStore(dir).get('Main', 'tank')).toBeTruthy(); // persisted
  });

  it('relabel moves anchors to the new account label and re-keys them', () => {
    const s = new RankAnchorStore(dir);
    s.set({ account: 'Main', role: 'tank', tier: 'Gold', division: 3, progressPct: 40, setAt: 1 });
    s.set({ account: 'Main', role: 'support', tier: 'Silver', division: 2, progressPct: 10, setAt: 1 });
    s.set({ account: 'Alt', role: 'damage', tier: 'Bronze', division: 5, progressPct: 0, setAt: 1 });
    expect(s.relabel('Main', 'MainDPS')).toBe(2);
    expect(s.get('Main', 'tank')).toBeUndefined();
    expect(s.get('MainDPS', 'tank')).toMatchObject({ tier: 'Gold', account: 'MainDPS' });
    expect(s.map()['MainDPS::support']).toBeTruthy();
    expect(s.get('Alt', 'damage')).toBeTruthy();
  });
});
