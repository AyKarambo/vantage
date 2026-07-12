import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HistoryStore, DB_FILE } from '../src/store/history';
import type { GameRecord } from '../src/core/analytics';
import { NOTION_IMPROVEMENT_TARGET_ID } from '../src/core/targets';
import { resolveMapId } from '../src/core/resolvers/mapId';

// SQLite keeps the file open (and locked, on Windows), so every store instance
// and temp dir created here is tracked and torn down after each test.
const tmpDirs: string[] = [];
const stores: HistoryStore[] = [];
function tmp(prefix = 'vantage-hsql-'): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}
function open(dir: string): HistoryStore {
  const s = new HistoryStore(dir);
  stores.push(s);
  return s;
}
afterEach(() => {
  for (const s of stores) { try { s.close(); } catch { /* already closed */ } }
  stores.length = 0;
  for (const d of tmpDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  tmpDirs.length = 0;
});

const g = (p: Partial<GameRecord>): GameRecord => ({
  matchId: 'm', timestamp: 0, account: 'Main', role: 'damage', map: 'Ilios',
  result: 'Win', gameType: 'Competitive', heroes: [], ...p,
});

describe('HistoryStore (SQLite) — reresolve backfill', () => {
  it('re-resolves a stored numeric map id to a name, idempotently, only rewriting changed rows', () => {
    const dir = tmp();
    const h = open(dir);
    h.addMany([
      g({ matchId: 'a', map: '1207' }), // raw GEP id → Nepal
      g({ matchId: 'b', map: "King's Row" }), // already a name → untouched
    ]);
    const remap = () => h.reresolve((game) => ({ map: resolveMapId(game.map) }));
    expect(remap()).toBe(1); // only 'a' changed
    expect(remap()).toBe(0); // idempotent — a re-run rewrites nothing
    h.close();

    // Reopen the same dir → the resolved map persisted in the `data` JSON, not just the column.
    const re = open(dir);
    const byId = Object.fromEntries(re.all().map((x) => [x.matchId, x]));
    expect(byId.a.map).toBe('Nepal');
    expect(byId.b.map).toBe("King's Row");
  });
});

describe('HistoryStore (SQLite) — core interface', () => {
  it('add returns true once, false on a duplicate id; has() tracks membership', () => {
    const h = open(tmp());
    expect(h.add(g({ matchId: 'a' }))).toBe(true);
    expect(h.add(g({ matchId: 'a' }))).toBe(false);
    expect(h.has('a')).toBe(true);
    expect(h.has('nope')).toBe(false);
    expect(h.count()).toBe(1);
  });

  it('all() returns games in insertion order and edits keep their position', () => {
    const h = open(tmp());
    h.addMany([g({ matchId: 'a' }), g({ matchId: 'b' }), g({ matchId: 'c' })]);
    h.editManual('a', { map: 'Nepal' }); // an edit must not move 'a' to the end
    expect(h.all().map((x) => x.matchId)).toEqual(['a', 'b', 'c']);
    expect(h.all()[0].map).toBe('Nepal');
  });

  it('editManual sets, updates, clears (null) and leaves (undefined) performance', () => {
    const h = open(tmp());
    h.add(g({ matchId: 'a' }));
    expect(h.editManual('a', { performance: 72 })).toBe(true);
    expect(h.all()[0].performance).toBe(72);
    h.editManual('a', { performance: 90 });
    expect(h.all()[0].performance).toBe(90);
    h.editManual('a', { map: 'Nepal' }); // unrelated patch key leaves performance untouched
    expect(h.all()[0].performance).toBe(90);
    h.editManual('a', { performance: null });
    expect(h.all()[0].performance).toBeUndefined();
  });

  it('addScreenshots appends, and is false for unknown id or empty list', () => {
    const h = open(tmp());
    h.add(g({ matchId: 'a', screenshots: ['one.png'] }));
    expect(h.addScreenshots('a', ['two.png'])).toBe(true);
    expect(h.all()[0].screenshots).toEqual(['one.png', 'two.png']);
    expect(h.addScreenshots('a', [])).toBe(false);
    expect(h.addScreenshots('nope', ['x.png'])).toBe(false);
  });

  it('clearReview removes a review and is false when there is none', () => {
    const h = open(tmp());
    h.add(g({ matchId: 'a', review: { at: 1, grades: { t1: 'hit' }, flags: {} } }));
    expect(h.clearReview('a')).toBe(true);
    expect(h.all()[0].review).toBeUndefined();
    expect(h.clearReview('a')).toBe(false);
  });

  it('losslessly round-trips a fully-populated record through the JSON blob', () => {
    const rich: GameRecord = {
      matchId: 'rich', timestamp: 1_700_000_000_000, account: 'Main', role: 'support',
      map: 'Nepal', result: 'Loss', gameType: 'Competitive', source: 'gep', srDelta: -19,
      durationMinutes: 12.5, heroes: ['Ana', 'Kiriko'],
      perHero: [{ hero: 'Ana', role: 'support', eliminations: 10, deaths: 3, assists: 20, damage: 5000, healing: 9000, mitigation: 0 }],
      roster: [{ battleTag: 'Me#1', heroName: 'Ana', isLocal: true }],
      finalScore: '2-1', screenshots: ['a.png'],
      mental: { tilt: true, positiveComms: true },
      review: { at: 1_700_000_001_000, grades: { t1: 'hit' }, flags: { toxicMates: true } },
      importedAt: 1_700_000_002_000,
    };
    const h = open(tmp());
    h.add(rich);
    expect(h.all()[0]).toEqual(rich);
  });
});

describe('HistoryStore (SQLite) — durability & persistence', () => {
  it('committed data survives a close + reopen (never falls back to empty)', () => {
    const dir = tmp();
    const first = open(dir);
    first.addMany([g({ matchId: 'a', srDelta: 22 }), g({ matchId: 'b' })]);
    first.close();
    const reopened = open(dir);
    expect(reopened.count()).toBe(2);
    expect(reopened.all().find((x) => x.matchId === 'a')?.srDelta).toBe(22);
  });
});

describe('HistoryStore (SQLite) — relocate', () => {
  it('moves the database file and reads from the new location', () => {
    const a = tmp();
    const b = tmp();
    const s = open(a);
    s.addMany([g({ matchId: 'x' }), g({ matchId: 'y' })]);
    s.relocate(b);
    expect(fs.existsSync(path.join(a, DB_FILE))).toBe(false);
    expect(fs.existsSync(path.join(b, DB_FILE))).toBe(true);
    expect(s.all().map((r) => r.matchId)).toEqual(['x', 'y']);
    const fresh = open(b);
    expect(fresh.count()).toBe(2);
  });

  it('stays fully usable after relocating (round-trip a -> b -> a)', () => {
    const a = tmp();
    const b = tmp();
    const s = open(a);
    s.add(g({ matchId: 'x' }));
    s.relocate(b);
    s.add(g({ matchId: 'y' })); // writable at the new location
    expect(fs.existsSync(path.join(a, DB_FILE))).toBe(false); // source cleaned up
    s.relocate(a); // and back again — reopen path exercised twice
    expect(s.all().map((r) => r.matchId)).toEqual(['x', 'y']);
    expect(fs.existsSync(path.join(b, DB_FILE))).toBe(false);
  });

  it('refuses to overwrite a database already present in the target folder', () => {
    const a = tmp();
    const b = tmp();
    const existing = open(b);
    existing.add(g({ matchId: 'keep' }));
    existing.close();
    const s = open(a);
    s.add(g({ matchId: 'x' }));
    expect(() => s.relocate(b)).toThrow(/already exists/);
    // Original still usable and intact after the refused move.
    expect(s.count()).toBe(1);
  });
});

describe('HistoryStore (SQLite) — mergeImported', () => {
  it('applies the bookkeeping grade onto a local match with no review, and does not stamp importedAt', () => {
    const h = open(tmp());
    h.add(g({ matchId: 'a' }));
    const imported = g({
      matchId: 'a',
      review: { at: 2000, grades: { [NOTION_IMPROVEMENT_TARGET_ID]: 'missed' }, flags: {} },
    });
    const { merged, skipped } = h.mergeImported([imported]);
    expect(merged).toBe(1);
    expect(skipped).toBe(0);
    const stored = h.all()[0];
    expect(stored.review).toEqual({ at: 2000, grades: { [NOTION_IMPROVEMENT_TARGET_ID]: 'missed' }, flags: {} });
    expect(stored.importedAt).toBeUndefined();
  });

  it('adopts the imported mental record wholesale when the local match has none', () => {
    const h = open(tmp());
    h.add(g({ matchId: 'a' }));
    const imported = g({ matchId: 'a', mental: { tilt: true, positiveComms: true } });
    const { merged } = h.mergeImported([imported]);
    expect(merged).toBe(1);
    expect(h.all()[0].mental).toEqual({ tilt: true, positiveComms: true });
  });

  it('leaves an existing local review and mental untouched (local wins wholesale) — counts as skipped', () => {
    const h = open(tmp());
    h.add(g({
      matchId: 'a',
      review: { at: 500, grades: { 't-1': 'hit' }, flags: {} },
      mental: { tilt: false },
    }));
    const imported = g({
      matchId: 'a',
      review: { at: 2000, grades: { [NOTION_IMPROVEMENT_TARGET_ID]: 'missed' }, flags: {} },
      mental: { tilt: true },
    });
    const { merged, skipped } = h.mergeImported([imported]);
    expect(merged).toBe(0);
    expect(skipped).toBe(1);
    const stored = h.all()[0];
    expect(stored.review).toEqual({ at: 500, grades: { 't-1': 'hit' }, flags: {} });
    expect(stored.mental).toEqual({ tilt: false });
  });

  it('skips unknown matchIds without throwing', () => {
    const h = open(tmp());
    const { merged, skipped } = h.mergeImported([g({ matchId: 'ghost', mental: { tilt: true } })]);
    expect(merged).toBe(0);
    expect(skipped).toBe(1);
    expect(h.count()).toBe(0);
  });

  it('runs as one transaction over multiple entries, applying only the eligible ones', () => {
    const h = open(tmp());
    h.addMany([
      g({ matchId: 'a' }), // will gain a grade
      g({ matchId: 'b', review: { at: 1, grades: { 't-1': 'hit' }, flags: {} } }), // local wins, skipped
    ]);
    const { merged, skipped } = h.mergeImported([
      g({ matchId: 'a', review: { at: 2000, grades: { [NOTION_IMPROVEMENT_TARGET_ID]: 'hit' }, flags: {} } }),
      g({ matchId: 'b', review: { at: 2000, grades: { [NOTION_IMPROVEMENT_TARGET_ID]: 'missed' }, flags: {} } }),
    ]);
    expect(merged).toBe(1);
    expect(skipped).toBe(1);
    expect(h.all().find((x) => x.matchId === 'a')?.review?.grades[NOTION_IMPROVEMENT_TARGET_ID]).toBe('hit');
    expect(h.all().find((x) => x.matchId === 'b')?.review?.grades).toEqual({ 't-1': 'hit' });
  });
});
