import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  planDataMigration,
  isVantageDataDir,
  HISTORY_DB_FILE,
  MANUAL_LOG_FILE,
  OUTBOX_FILE,
  RANK_ANCHORS_FILE,
  LEGACY_HISTORY_JSON_FILE,
  type DataArtifactPresence,
} from '../src/core/dataMigration';
import { migrateDataFolder, type Relocatable, type AdoptableStore } from '../src/store/dataMigration';
import { HistoryStore, DB_FILE } from '../src/store/history';
import type { GameRecord } from '../src/core/analytics';
import { DatabaseSync } from 'node:sqlite';

const fromDir = path.resolve('from');
const toDir = path.resolve('to');

/** All artifacts absent by default; tests flip on what they need. */
function presence(overrides: Partial<DataArtifactPresence> = {}): DataArtifactPresence {
  return {
    historyDb: false,
    manualLog: false,
    outbox: false,
    rankAnchors: false,
    legacyHistoryJson: false,
    ...overrides,
  };
}

describe('planDataMigration', () => {
  it('lists exactly the present files, skipping missing optionals', () => {
    const plan = planDataMigration(presence({ historyDb: true, manualLog: true }), fromDir, toDir);
    expect(plan.ops.map((op) => op.name)).toEqual([HISTORY_DB_FILE, MANUAL_LOG_FILE]);
  });

  it('skips every optional artifact when only history.db is present', () => {
    const plan = planDataMigration(presence({ historyDb: true }), fromDir, toDir);
    expect(plan.ops).toHaveLength(1);
    expect(plan.ops[0]).toMatchObject({ name: HISTORY_DB_FILE, kind: 'file', optional: false });
  });

  it('lists nothing when no artifacts are present', () => {
    const plan = planDataMigration(presence(), fromDir, toDir);
    expect(plan.ops).toEqual([]);
  });

  it('includes every artifact, in order, when all are present', () => {
    const plan = planDataMigration(
      presence({
        historyDb: true,
        manualLog: true,
        outbox: true,
        rankAnchors: true,
        legacyHistoryJson: true,
      }),
      fromDir,
      toDir
    );
    expect(plan.ops.map((op) => op.name)).toEqual([
      HISTORY_DB_FILE,
      MANUAL_LOG_FILE,
      OUTBOX_FILE,
      RANK_ANCHORS_FILE,
      LEGACY_HISTORY_JSON_FILE,
    ]);
  });

  it('orders history.db first and the legacy backup last', () => {
    const plan = planDataMigration(
      presence({ historyDb: true, legacyHistoryJson: true, outbox: true }),
      fromDir,
      toDir
    );
    expect(plan.ops[0].name).toBe(HISTORY_DB_FILE);
    expect(plan.ops[plan.ops.length - 1].name).toBe(LEGACY_HISTORY_JSON_FILE);
  });

  it('marks history.db as non-optional and every other artifact as optional', () => {
    const plan = planDataMigration(
      presence({
        historyDb: true,
        manualLog: true,
        outbox: true,
        rankAnchors: true,
        legacyHistoryJson: true,
      }),
      fromDir,
      toDir
    );
    const byName = Object.fromEntries(plan.ops.map((op) => [op.name, op]));
    expect(byName[HISTORY_DB_FILE].optional).toBe(false);
    expect(byName[MANUAL_LOG_FILE].optional).toBe(true);
    expect(byName[OUTBOX_FILE].optional).toBe(true);
    expect(byName[RANK_ANCHORS_FILE].optional).toBe(true);
    expect(byName[LEGACY_HISTORY_JSON_FILE].optional).toBe(true);
  });

  it('marks every artifact as kind "file"', () => {
    const plan = planDataMigration(presence({ historyDb: true, manualLog: true }), fromDir, toDir);
    const byName = Object.fromEntries(plan.ops.map((op) => [op.name, op]));
    expect(byName[HISTORY_DB_FILE].kind).toBe('file');
    expect(byName[MANUAL_LOG_FILE].kind).toBe('file');
  });

  it('joins fromDir/toDir onto each artifact name for from/to paths', () => {
    const plan = planDataMigration(presence({ historyDb: true, manualLog: true }), fromDir, toDir);
    const byName = Object.fromEntries(plan.ops.map((op) => [op.name, op]));
    expect(byName[HISTORY_DB_FILE].from).toBe(path.join(fromDir, HISTORY_DB_FILE));
    expect(byName[HISTORY_DB_FILE].to).toBe(path.join(toDir, HISTORY_DB_FILE));
    expect(byName[MANUAL_LOG_FILE].from).toBe(path.join(fromDir, MANUAL_LOG_FILE));
    expect(byName[MANUAL_LOG_FILE].to).toBe(path.join(toDir, MANUAL_LOG_FILE));
  });
});

describe('isVantageDataDir', () => {
  it('is true iff history.db is present', () => {
    expect(isVantageDataDir(presence({ historyDb: true }))).toBe(true);
    expect(isVantageDataDir(presence({ historyDb: false }))).toBe(false);
  });

  it('is true even when history.db is the only artifact present', () => {
    expect(isVantageDataDir({ historyDb: true })).toBe(true);
  });

  it('is false when every other artifact is present but history.db is not', () => {
    const files = presence({
      manualLog: true,
      outbox: true,
      rankAnchors: true,
      legacyHistoryJson: true,
    });
    expect(isVantageDataDir(files)).toBe(false);
  });
});

// --- migrateDataFolder (fs executor) ---------------------------------------

const tmpDirs: string[] = [];
const openStores: HistoryStore[] = [];
function tmp(prefix = 'vantage-migrate-'): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}
function historyAt(dir: string): HistoryStore {
  const h = new HistoryStore(dir);
  openStores.push(h);
  return h;
}
afterEach(() => {
  for (const s of openStores) { try { s.close(); } catch { /* already closed */ } }
  openStores.length = 0;
  for (const d of tmpDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  tmpDirs.length = 0;
});

const g = (p: Partial<GameRecord>): GameRecord => ({
  matchId: 'm', timestamp: 0, account: 'Main', role: 'damage', map: 'Ilios',
  result: 'Win', gameType: 'Competitive', heroes: [], ...p,
});

/** A trivial Relocatable fake standing in for the JSON side-stores until they
 *  gain a real `relocate` (Wave 1's `W1-C2`). Records the
 *  directory it was last pointed at and, when constructed with a source dir
 *  holding a file, actually moves that file — enough to exercise the
 *  executor's copy/commit/delete + rollback paths without depending on
 *  not-yet-landed store methods. */
function fakeStore(fileName: string, dir: string): Relocatable & { calls: string[]; file: () => string } {
  const calls: string[] = [];
  let currentDir = dir;
  return {
    calls,
    file: () => path.join(currentDir, fileName),
    relocate(newDir: string) {
      calls.push(newDir);
      currentDir = newDir;
    },
  };
}

describe('migrateDataFolder — copy-verify-commit', () => {
  it('moves all present files into an empty target and persists the folder', () => {
    const a = tmp();
    const b = tmp();
    const history = historyAt(a);
    history.addMany([g({ matchId: 'x' }), g({ matchId: 'y' })]);
    fs.writeFileSync(path.join(a, 'manual.json'), '{"targets":[]}');

    let persisted: string | undefined;
    const manual = fakeStore('manual.json', a);
    const result = migrateDataFolder({
      fromDir: a,
      toDir: b,
      stores: { history, manualLog: manual },
      persistFolder: (dir) => { persisted = dir; },
    });

    expect(result).toEqual({ ok: true });
    expect(persisted).toBe(b);
    expect(fs.existsSync(path.join(b, DB_FILE))).toBe(true);
    expect(fs.existsSync(path.join(a, DB_FILE))).toBe(false);
    expect(fs.existsSync(path.join(b, 'manual.json'))).toBe(true);
    expect(manual.calls).toEqual([b]);
    expect(history.all().map((r) => r.matchId)).toEqual(['x', 'y']);
  });

  it('is a no-op-but-successful switch when the source has nothing to move', () => {
    const a = tmp();
    const b = tmp();
    const history = historyAt(a);
    let persisted: string | undefined;
    const result = migrateDataFolder({
      fromDir: a,
      toDir: b,
      stores: { history },
      persistFolder: (dir) => { persisted = dir; },
    });
    expect(result).toEqual({ ok: true });
    expect(persisted).toBe(b);
  });

  it('persists the new folder pointer before deleting history.db\'s original (crash guarantee)', () => {
    // Regression for the commit-ordering bug: history.db's original used to be
    // deleted *inside* HistoryStore.relocate, before persistFolder ran — so a
    // crash between the two left fromDir's history.db already gone but the
    // pointer never updated. It must now be deleted only after persistFolder
    // returns.
    const a = tmp();
    const b = tmp();
    const history = historyAt(a);
    history.add(g({ matchId: 'x' }));

    let originalExistedAtPersistTime: boolean | undefined;
    const result = migrateDataFolder({
      fromDir: a,
      toDir: b,
      stores: { history },
      persistFolder: () => {
        originalExistedAtPersistTime = fs.existsSync(path.join(a, DB_FILE));
      },
    });

    expect(result).toEqual({ ok: true });
    expect(originalExistedAtPersistTime).toBe(true);
    // And by the time the executor returns, the deferred delete has run.
    expect(fs.existsSync(path.join(a, DB_FILE))).toBe(false);
    expect(fs.existsSync(path.join(b, DB_FILE))).toBe(true);
  });
});

describe('migrateDataFolder — mid-copy failure', () => {
  it('leaves the source intact and removes any partial target copies on failure', () => {
    const a = tmp();
    const b = tmp();
    const history = historyAt(a);
    history.add(g({ matchId: 'x' }));
    fs.writeFileSync(path.join(a, 'manual.json'), 'data');
    // rankAnchors.json is a file the plan expects to copy after manual.json;
    // make the *directory* it copies into unusable by pre-creating the
    // destination path as a directory with the same name, so the copy of
    // rankAnchors.json throws (EISDIR on copyFileSync).
    fs.writeFileSync(path.join(a, 'rankAnchors.json'), 'data');
    fs.mkdirSync(path.join(b, 'rankAnchors.json'), { recursive: true });

    const result = migrateDataFolder({
      fromDir: a,
      toDir: b,
      stores: { history },
      persistFolder: () => { throw new Error('must not persist on failure'); },
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
    // Source fully intact.
    expect(fs.existsSync(path.join(a, DB_FILE))).toBe(true);
    expect(fs.existsSync(path.join(a, 'manual.json'))).toBe(true);
    expect(fs.existsSync(path.join(a, 'rankAnchors.json'))).toBe(true);
    expect(history.count()).toBe(1);
    // No stale successfully-copied file left behind in the target either.
    expect(fs.existsSync(path.join(b, DB_FILE))).toBe(false);
    expect(fs.existsSync(path.join(b, 'manual.json'))).toBe(false);
  });
});

describe('migrateDataFolder — refuses non-adopt into a folder with existing data', () => {
  it('refuses when the target already holds history.db and adopt is not set', () => {
    const a = tmp();
    const b = tmp();
    const history = historyAt(a);
    history.add(g({ matchId: 'x' }));
    const existing = historyAt(b);
    existing.add(g({ matchId: 'keep' }));
    existing.close();

    let persisted = false;
    const result = migrateDataFolder({
      fromDir: a,
      toDir: b,
      stores: { history },
      persistFolder: () => { persisted = true; },
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/already contains Vantage data/i);
    expect(persisted).toBe(false);
    // Old location untouched and still the live one.
    expect(fs.existsSync(path.join(a, DB_FILE))).toBe(true);
    expect(history.count()).toBe(1);
  });
});

describe('migrateDataFolder — adopt', () => {
  it('repoints without copying or deleting either side', () => {
    const a = tmp();
    const b = tmp();
    // history.db already exists at `b` (the folder being adopted), so the
    // history handle must use its dedicated `adopt` — not `relocate`, which
    // deliberately refuses a target that already holds a database. Simulated
    // here with an AdoptableStore fake standing in for the composition root's
    // real adopt-capable history handle (a distinct operation from
    // HistoryStore.relocate; see the `AdoptableStore` doc comment).
    fs.mkdirSync(b, { recursive: true });
    fs.writeFileSync(path.join(b, DB_FILE), 'existing-db-bytes');
    const calls: Array<{ op: string; dir: string }> = [];
    const history: AdoptableStore = {
      relocate: (dir) => calls.push({ op: 'relocate', dir }),
      adopt: (dir) => calls.push({ op: 'adopt', dir }),
    };

    let persisted: string | undefined;
    const result = migrateDataFolder({
      fromDir: a,
      toDir: b,
      stores: { history },
      adopt: true,
      persistFolder: (dir) => { persisted = dir; },
    });

    expect(result).toEqual({ ok: true, adopted: true });
    expect(persisted).toBe(b);
    expect(calls).toEqual([{ op: 'adopt', dir: b }]);
    // Neither side touched: no copy into `a`, no delete of the pre-existing db at `b`.
    expect(fs.existsSync(path.join(b, DB_FILE))).toBe(true);
    expect(fs.readFileSync(path.join(b, DB_FILE), 'utf8')).toBe('existing-db-bytes');
    expect(fs.existsSync(a)).toBe(true);
  });

  it('falls back to relocate for a store with no dedicated adopt', () => {
    const a = tmp();
    const b = tmp();
    fs.mkdirSync(b, { recursive: true });
    fs.writeFileSync(path.join(b, DB_FILE), 'existing-db-bytes');
    const historyCalls: string[] = [];
    const history: AdoptableStore = {
      relocate: () => { /* n/a for this test */ },
      adopt: (dir) => historyCalls.push(dir),
    };
    const manual = fakeStore('manual.json', a);

    const result = migrateDataFolder({
      fromDir: a,
      toDir: b,
      stores: { history, manualLog: manual },
      adopt: true,
      persistFolder: () => {},
    });

    expect(result.ok).toBe(true);
    // manual has no `adopt`, so the executor falls back to its plain relocate.
    expect(manual.calls).toEqual([b]);
  });
});

describe('migrateDataFolder — non-writable target', () => {
  it('rejects with a clear error and leaves the old location active', () => {
    const a = tmp();
    const history = historyAt(a);
    history.add(g({ matchId: 'x' }));
    // A file (not a directory) at the target path makes mkdir/writes fail.
    const blocked = tmp();
    const target = path.join(blocked, 'not-a-dir');
    fs.writeFileSync(target, 'blocker');

    let persisted = false;
    const result = migrateDataFolder({
      fromDir: a,
      toDir: target,
      stores: { history },
      persistFolder: () => { persisted = true; },
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
    expect(persisted).toBe(false);
    expect(fs.existsSync(path.join(a, DB_FILE))).toBe(true);
    expect(history.count()).toBe(1);
  });
});

describe('migrateDataFolder — leftovers', () => {
  it('reports { ok: true, leftovers: N } when an original cannot be deleted after commit', () => {
    const a = tmp();
    const b = tmp();
    const history = historyAt(a);
    history.add(g({ matchId: 'x' }));

    // Force a genuine OS-level lock on the original manual.json for the
    // duration of the executor's post-commit delete attempt, using a second
    // node:sqlite handle opened directly on that path (a plain open() handle
    // doesn't reliably block delete on this platform — Node opens files with
    // FILE_SHARE_DELETE by default — but SQLite's own file locking does, which
    // is exactly the real-world "a store handle is still open" scenario this
    // path exists for; see HistoryStore.relocate's use of the same locking
    // behavior). Content doesn't matter — sqlite overwrites the header.
    const manualPath = path.join(a, 'manual.json');
    const lock = new DatabaseSync(manualPath);
    lock.exec('CREATE TABLE t (a INTEGER)');
    const stubborn: Relocatable = { relocate: () => { /* no-op */ } };
    try {
      const result = migrateDataFolder({
        fromDir: a,
        toDir: b,
        stores: { history, manualLog: stubborn },
        persistFolder: () => {},
      });
      expect(result.ok).toBe(true);
      expect(result.leftovers).toBe(1);
      // The leftover original is still there; the migrated copy is intact.
      expect(fs.existsSync(manualPath)).toBe(true);
      expect(fs.existsSync(path.join(b, 'manual.json'))).toBe(true);
    } finally {
      lock.close();
    }
  });
});
