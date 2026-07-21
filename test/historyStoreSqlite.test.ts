import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HistoryStore, DB_FILE } from '../src/store/history';
import type { GameRecord } from '../src/core/analytics';
import type { MatchRecord } from '../src/core/model';
import { NOTION_IMPROVEMENT_TARGET_ID } from '../src/core/targets';
import { resolveMapId } from '../src/core/resolvers/mapId';
import { recoverableAccount } from '../src/core/accountsManage';

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

const pm = (p: Partial<MatchRecord>): MatchRecord => ({
  matchId: 'm', battleTag: 'Player#1234', mapName: 'Ilios', queueType: 'role',
  heroRole: 'damage', gameType: 'competitive', heroes: ['Tracer'], ...p,
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
      finalScore: '2-1',
      mental: { tilt: true, positiveComms: true },
      review: { at: 1_700_000_001_000, grades: { t1: 'hit' }, flags: { toxicMates: true } },
      importedAt: 1_700_000_002_000,
    };
    const h = open(tmp());
    h.add(rich);
    expect(h.all()[0]).toEqual(rich);
  });
});

describe('HistoryStore (SQLite) — pending (no-outcome) holding store', () => {
  it('addPending inserts once and dedupes by matchId; hasPending/pendingCount track membership', () => {
    const h = open(tmp());
    expect(h.addPending(pm({ matchId: 'a', endedAt: 10 }))).toBe(true);
    expect(h.addPending(pm({ matchId: 'a', endedAt: 99 }))).toBe(false); // same id → ignored
    expect(h.hasPending('a')).toBe(true);
    expect(h.hasPending('nope')).toBe(false);
    expect(h.pendingCount()).toBe(1);
    // The dedupe never overwrote the original row's data.
    expect(h.allPending()[0].endedAt).toBe(10);
  });

  it('allPending returns held records ordered by endedAt, and never touches games/count', () => {
    const h = open(tmp());
    h.addPending(pm({ matchId: 'late', endedAt: 3_000 }));
    h.addPending(pm({ matchId: 'early', endedAt: 1_000 }));
    h.addPending(pm({ matchId: 'mid', endedAt: 2_000 }));
    expect(h.allPending().map((r) => r.matchId)).toEqual(['early', 'mid', 'late']);
    // Pending rows are a SEPARATE table — they never enter the analyzable history.
    expect(h.count()).toBe(0);
    expect(h.all()).toHaveLength(0);
  });

  it('takePending returns then removes the record; a second take is undefined', () => {
    const h = open(tmp());
    h.addPending(pm({ matchId: 'a', endedAt: 5, heroes: ['Ana'] }));
    const taken = h.takePending('a');
    expect(taken?.matchId).toBe('a');
    expect(taken?.heroes).toEqual(['Ana']);
    expect(h.hasPending('a')).toBe(false);
    expect(h.pendingCount()).toBe(0);
    expect(h.takePending('a')).toBeUndefined();
    expect(h.takePending('never')).toBeUndefined();
  });

  it('removePending deletes a held match and returns a boolean; a removed id disappears from allPending/hasPending', () => {
    const h = open(tmp());
    h.addPending(pm({ matchId: 'a', endedAt: 10 }));
    h.addPending(pm({ matchId: 'b', endedAt: 20 }));
    // Removes the row without returning it (the dismiss path).
    expect(h.removePending('a')).toBe(true);
    expect(h.hasPending('a')).toBe(false);
    expect(h.allPending().map((r) => r.matchId)).toEqual(['b']);
    expect(h.pendingCount()).toBe(1);
    // A second remove (or an unknown id) is a no-op → false.
    expect(h.removePending('a')).toBe(false);
    expect(h.removePending('never')).toBe(false);
    // A dismissed match never leaks into the analyzable history.
    expect(h.count()).toBe(0);
  });

  it('a removePending survives close + reopen — the removed row does not come back', () => {
    const dir = tmp();
    const first = open(dir);
    first.addPending(pm({ matchId: 'gone', endedAt: 1 }));
    first.addPending(pm({ matchId: 'stays', endedAt: 2 }));
    expect(first.removePending('gone')).toBe(true);
    first.close();
    const reopened = open(dir);
    expect(reopened.allPending().map((r) => r.matchId)).toEqual(['stays']);
  });

  it('losslessly round-trips a rich MatchRecord and survives close + reopen for un-taken rows', () => {
    const dir = tmp();
    const first = open(dir);
    const rich = pm({
      matchId: 'rich', endedAt: 1_700_000_000_000, outcome: undefined,
      heroes: ['Ana', 'Kiriko'], roster: [{ battleTag: 'Me#1', heroName: 'Ana', isLocal: true }],
      eliminations: 12, deaths: 4, durationMinutes: 11.5, finalScore: '2-2',
    });
    first.addPending(rich);
    first.addPending(pm({ matchId: 'b', endedAt: 20 }));
    first.close();

    const reopened = open(dir);
    expect(reopened.pendingCount()).toBe(2);
    expect(reopened.allPending().find((r) => r.matchId === 'rich')).toEqual(rich);
    // A taken row is gone after reopen; the untouched one persists.
    reopened.takePending('b');
    reopened.close();
    const again = open(dir);
    expect(again.allPending().map((r) => r.matchId)).toEqual(['rich']);
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

describe('HistoryStore (SQLite) — deleteByAccount (F3)', () => {
  it('irreversibly removes only the rows stored under the exact account value, reporting the count', () => {
    const dir = tmp();
    const h = open(dir);
    h.addMany([
      g({ matchId: 'a', account: 'Rando#4521' }),
      g({ matchId: 'b', account: 'Rando#4521' }),
      g({ matchId: 'c', account: 'Karambo' }),
      g({ matchId: 'd', account: 'Unknown' }),
    ]);
    expect(h.deleteByAccount('Rando#4521')).toBe(2);
    expect(h.all().map((x) => x.matchId).sort()).toEqual(['c', 'd']);
    // A second call is a no-op.
    expect(h.deleteByAccount('Rando#4521')).toBe(0);
    // Persisted across a close + reopen.
    h.close();
    expect(open(dir).all().map((x) => x.matchId).sort()).toEqual(['c', 'd']);
  });

  it('deletes the Unknown bucket without touching a configured account of another name', () => {
    const h = open(tmp());
    h.addMany([g({ matchId: 'u1', account: 'Unknown' }), g({ matchId: 'u2', account: 'Unknown' }), g({ matchId: 'k', account: 'Karambo' })]);
    expect(h.deleteByAccount('Unknown')).toBe(2);
    expect(h.all().map((x) => x.account)).toEqual(['Karambo']);
  });
});

describe('HistoryStore (SQLite) — deleteMatch', () => {
  it('removes exactly the one row, returns it, and is a no-op on a second call', () => {
    const dir = tmp();
    const h = open(dir);
    h.addMany([g({ matchId: 'a' }), g({ matchId: 'b' }), g({ matchId: 'c' })]);
    expect(h.deleteMatch('b')?.matchId).toBe('b');
    expect(h.all().map((x) => x.matchId)).toEqual(['a', 'c']);
    // Idempotent — the id is already gone, so nothing comes back.
    expect(h.deleteMatch('b')).toBeUndefined();
    expect(h.all().map((x) => x.matchId)).toEqual(['a', 'c']);
  });

  it('returns undefined for an id that was never stored, without touching history', () => {
    const h = open(tmp());
    h.add(g({ matchId: 'a' }));
    expect(h.deleteMatch('never-existed')).toBeUndefined();
    expect(h.count()).toBe(1);
  });

  it('takes the whole record with it — the delete survives a close + reopen', () => {
    const dir = tmp();
    const h = open(dir);
    h.addMany([
      g({ matchId: 'keep' }),
      g({ matchId: 'bogus', map: 'Unknown', review: { at: 1, grades: {}, flags: { tilt: true } }, srDelta: -25 }),
    ]);
    expect(h.deleteMatch('bogus')).toBeDefined();
    h.close();
    const re = open(dir);
    expect(re.all().map((x) => x.matchId)).toEqual(['keep']);
    expect(re.has('bogus')).toBe(false);
  });

  it('hands back a record complete enough to restore the game exactly', () => {
    const dir = tmp();
    const h = open(dir);
    const original = g({
      matchId: 'bogus', map: 'Unknown', result: 'Loss', srDelta: -25, source: 'gep',
      heroes: ['Tracer'], review: { at: 7, grades: { t1: 'hit' }, flags: { tilt: true } },
    });
    h.add(original);

    const removed = h.deleteMatch('bogus');
    expect(removed).toEqual(original);
    expect(h.count()).toBe(0);

    // Feeding it straight back reconstructs the row byte-for-byte — this is
    // what makes the delete's Undo a real restore rather than a re-log.
    expect(h.add(removed!)).toBe(true);
    h.close();
    expect(open(dir).all()).toEqual([original]);
  });

  it('leaves the separate pending holding store alone', () => {
    const h = open(tmp());
    // Same id in both tables — possible when a replay re-holds an already
    // recorded match. Deleting the history row must not silently drop the
    // pending one (the provider decides that, not the store).
    h.add(g({ matchId: 'dup' }));
    h.addPending(pm({ matchId: 'dup' }));
    expect(h.deleteMatch('dup')).toBeDefined();
    expect(h.count()).toBe(0);
    expect(h.hasPending('dup')).toBe(true);
    expect(h.pendingCount()).toBe(1);
  });
});

describe('HistoryStore (SQLite) — Unknown-account recovery (F1) via reresolve', () => {
  const localRoster = (battleTag: string) => [
    { battleTag: 'Enemy#1', heroName: 'Reaper' },
    { battleTag, heroName: 'Ana', isLocal: true },
  ];
  // The startup recovery pass: re-attribute an 'Unknown' row from its local
  // roster BattleTag, expressed through the general reresolve() primitive.
  const recover = (accounts: Record<string, string>) => (game: GameRecord) =>
    game.account === 'Unknown' ? { account: recoverableAccount(game.roster, accounts) } : {};

  it('re-attributes Unknown rows whose local roster tag now maps to a configured account', () => {
    const h = open(tmp());
    h.addMany([
      g({ matchId: 'a', account: 'Unknown', roster: localRoster('Karambo#21234') }),
      g({ matchId: 'b', account: 'Unknown', roster: localRoster('Karambo#21234') }),
    ]);
    expect(h.reresolve(recover({ 'Karambo#21234': 'Karambo' }))).toBe(2);
    expect(h.all().every((x) => x.account === 'Karambo')).toBe(true);
  });

  it('leaves Unknown rows whose tag maps to nothing, and is idempotent', () => {
    const h = open(tmp());
    h.addMany([
      g({ matchId: 'a', account: 'Unknown', roster: localRoster('Karambo#21234') }),
      g({ matchId: 'b', account: 'Unknown' }), // no roster → not recoverable
      g({ matchId: 'c', account: 'Unknown', roster: localRoster('Stranger#9') }), // no config mapping
    ]);
    const accounts = { 'Karambo#21234': 'Karambo' };
    expect(h.reresolve(recover(accounts))).toBe(1);
    // b and c stay Unknown; a became Karambo.
    expect(h.all().find((x) => x.matchId === 'a')?.account).toBe('Karambo');
    expect(h.all().filter((x) => x.account === 'Unknown').map((x) => x.matchId).sort()).toEqual(['b', 'c']);
    // Idempotent: the recovered row is no longer Unknown, so a re-run changes nothing.
    expect(h.reresolve(recover(accounts))).toBe(0);
  });

  it('only touches Unknown rows — never a configured account already attributed', () => {
    const h = open(tmp());
    h.add(g({ matchId: 'k', account: 'Karambo', roster: localRoster('Karambo#21234') }));
    expect(h.reresolve(recover({ 'Karambo#21234': 'Alt' }))).toBe(0); // 'k' isn't Unknown, so it's untouched
    expect(h.all()[0].account).toBe('Karambo');
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
