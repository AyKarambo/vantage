import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HistoryStore } from '../src/store/history';
import { RankAnchorStore } from '../src/store/rankAnchors';
import type { GameRecord } from '../src/core/analytics';

let dir: string;
const opened: HistoryStore[] = [];
// SQLite locks the file open on Windows, so every store instance must be closed
// before the temp dir is removed.
const hist = (d = dir): HistoryStore => { const s = new HistoryStore(d); opened.push(s); return s; };
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vantage-store-')); });
afterEach(() => {
  for (const s of opened) { try { s.close(); } catch { /* already closed */ } }
  opened.length = 0;
  fs.rmSync(dir, { recursive: true, force: true });
});

const g = (p: Partial<GameRecord>): GameRecord => ({
  matchId: 'm', timestamp: 0, account: 'Main', role: 'damage', map: 'Ilios',
  result: 'Win', gameType: 'Competitive', heroes: [], ...p,
});

describe('HistoryStore manual-layer edits', () => {
  it('addMany dedups by matchId and saves once', () => {
    const h = hist();
    expect(h.addMany([g({ matchId: 'a' }), g({ matchId: 'b' })])).toEqual({ imported: 2, skipped: 0 });
    expect(h.addMany([g({ matchId: 'b' }), g({ matchId: 'c' })])).toEqual({ imported: 1, skipped: 1 });
    expect(h.count()).toBe(3);
  });

  it('editManual patches provided keys and deletes on null (clearing srDelta)', () => {
    const h = hist();
    h.add(g({ matchId: 'a', srDelta: 22, mental: { tilt: true } }));
    h.editManual('a', { srDelta: -10, map: 'Nepal' });
    expect(h.all()[0]).toMatchObject({ srDelta: -10, map: 'Nepal', mental: { tilt: true } });
    h.editManual('a', { srDelta: null });
    expect(h.all()[0].srDelta).toBeUndefined();
  });

  it('editManual returns false for an unknown id', () => {
    const h = hist();
    expect(h.editManual('nope', { map: 'x' })).toBe(false);
  });

  it('relabelAccount rewrites every matching game and persists', () => {
    const h = hist();
    h.addMany([g({ matchId: 'a', account: 'Main' }), g({ matchId: 'b', account: 'Main' }), g({ matchId: 'c', account: 'Alt' })]);
    expect(h.relabelAccount('Main', 'MainDPS')).toBe(2);
    expect(hist().all().filter((x) => x.account === 'MainDPS')).toHaveLength(2);
    expect(h.relabelAccount('Ghost', 'X')).toBe(0);
  });

  it('removeImported drops only imported games (keeps live/manual), reporting the removed set', () => {
    const h = hist();
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
    expect(hist().importedCount()).toBe(0);
    expect(h.removeImported()).toEqual([]);
  });
});

describe('HistoryStore.adopt', () => {
  it('points at a directory that already holds its own history.db, with no copy and no delete of either side', () => {
    const a = dir;
    const b = fs.mkdtempSync(path.join(os.tmpdir(), 'vantage-store-adopt-'));
    try {
      const h = hist(a);
      h.add(g({ matchId: 'original' }));

      const other = hist(b);
      other.add(g({ matchId: 'adopted' }));
      other.close();

      h.adopt(b);
      expect(h.all().map((r) => r.matchId)).toEqual(['adopted']);
      // Neither side was touched: `a`'s original db is untouched, `b`'s db is
      // untouched (no overwrite) — this is a pure repoint, not a move/copy.
      expect(fs.existsSync(path.join(a, 'history.db'))).toBe(true);
      expect(fs.existsSync(path.join(b, 'history.db'))).toBe(true);

      // The handle is fully usable at the new location afterwards.
      h.add(g({ matchId: 'new-at-b' }));
      expect(hist(b).all().map((r) => r.matchId).sort()).toEqual(['adopted', 'new-at-b']);
    } finally {
      // `h` and the two ad-hoc `b` handles above are all tracked in `opened`
      // and closed by the outer afterEach before this runs... except this
      // finally runs *inside* the same test, before afterEach — close them
      // here so the temp dir removal below doesn't hit a Windows file lock.
      for (const s of opened) { try { s.close(); } catch { /* already closed */ } }
      fs.rmSync(b, { recursive: true, force: true });
    }
  });

  it('throws when the target has no history.db to adopt (adoption never creates one)', () => {
    const h = hist();
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'vantage-store-adopt-empty-'));
    try {
      expect(() => h.adopt(empty)).toThrow(/no history database/i);
      // The store stays usable at its original location after a refused adopt.
      h.add(g({ matchId: 'still-here' }));
      expect(h.count()).toBe(1);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe('HistoryStore.relocate — deferDelete', () => {
  it('leaves the original file in place and returns a cleanup thunk instead of deleting immediately', () => {
    const a = dir;
    const b = fs.mkdtempSync(path.join(os.tmpdir(), 'vantage-store-defer-'));
    try {
      const h = hist(a);
      h.add(g({ matchId: 'x' }));

      const cleanup = h.relocate(b, { deferDelete: true });
      expect(typeof cleanup).toBe('function');
      // Original is still there — deletion was deferred, not skipped.
      expect(fs.existsSync(path.join(a, 'history.db'))).toBe(true);
      expect(fs.existsSync(path.join(b, 'history.db'))).toBe(true);
      expect(h.all().map((r) => r.matchId)).toEqual(['x']);

      // Running the thunk performs the deferred delete and reports success.
      expect(cleanup!()).toBe(true);
      expect(fs.existsSync(path.join(a, 'history.db'))).toBe(false);
    } finally {
      // `h` now holds its open handle against `b` (post-relocate) — close it
      // (via the shared `opened` list) before removing `b`, or the SQLite
      // lock blocks the Windows directory removal.
      for (const s of opened) { try { s.close(); } catch { /* already closed */ } }
      fs.rmSync(b, { recursive: true, force: true });
    }
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

  it('relocate re-points and reloads from the new dir', () => {
    const s = new RankAnchorStore(dir);
    s.set({ account: 'Main', role: 'tank', tier: 'Gold', division: 3, progressPct: 40, setAt: 1 });

    const newDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vantage-store-anchors-new-'));
    try {
      fs.copyFileSync(path.join(dir, 'rankAnchors.json'), path.join(newDir, 'rankAnchors.json'));
      s.relocate(newDir);

      expect(s.get('Main', 'tank')).toMatchObject({ tier: 'Gold' });
      s.set({ account: 'Alt', role: 'damage', tier: 'Bronze', division: 5, progressPct: 0, setAt: 2 });
      expect(new RankAnchorStore(newDir).get('Alt', 'damage')).toBeTruthy();
      // relocate itself doesn't touch the old dir's file (copy/delete is the
      // migration executor's job).
      expect(new RankAnchorStore(dir).get('Alt', 'damage')).toBeUndefined();
    } finally {
      fs.rmSync(newDir, { recursive: true, force: true });
    }
  });
});
