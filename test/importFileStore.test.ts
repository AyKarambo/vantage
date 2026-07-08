import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { HistoryStore, DB_FILE } from '../src/store/history';
import type { GameRecord } from '../src/core/analytics';

// SQLite locks the file open on Windows, so every store instance must be closed
// before the temp dir is removed (see stores.test.ts).
let dir: string;
const opened: HistoryStore[] = [];
const hist = (d = dir): HistoryStore => { const s = new HistoryStore(d); opened.push(s); return s; };
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vantage-import-store-')); });
afterEach(() => {
  for (const s of opened) { try { s.close(); } catch { /* already closed */ } }
  opened.length = 0;
  fs.rmSync(dir, { recursive: true, force: true });
});

const g = (p: Partial<GameRecord>): GameRecord => ({
  matchId: 'm', timestamp: 0, account: 'Lampenlicht', role: 'tank', map: 'Ilios',
  result: 'Win', gameType: 'Competitive', heroes: [], ...p,
});

describe('HistoryStore — import provenance is source-scoped', () => {
  it('clears file-imports independently of Notion imports, live, and hand-logged games', () => {
    const h = hist();
    h.addMany([
      g({ matchId: 'live', importedAt: undefined }),                                      // live / hand-logged
      g({ matchId: 'notion1', importedAt: 1_700_000_000_000, importSource: 'notion' }),   // Notion import
      g({ matchId: 'legacy', importedAt: 1_700_000_000_000 }),                            // legacy Notion (no importSource)
      g({ matchId: 'file1', importedAt: 1_700_000_000_001, importSource: 'file' }),       // file import
      g({ matchId: 'file2', importedAt: 1_700_000_000_001, importSource: 'file' }),       // file import
    ]);

    // COALESCE(importSource,'notion') buckets the legacy row with Notion.
    expect(h.importedCount('file')).toBe(2);
    expect(h.importedCount('notion')).toBe(2);

    const removedFile = h.removeImported('file');
    expect(removedFile.map((r) => r.matchId).sort()).toEqual(['file1', 'file2']);
    // Notion, legacy, and live all survive a file-only wipe.
    expect(h.all().map((x) => x.matchId).sort()).toEqual(['legacy', 'live', 'notion1']);
    expect(h.importedCount('file')).toBe(0);
    expect(h.importedCount('notion')).toBe(2);

    // A subsequent Notion wipe leaves only the live row.
    const removedNotion = h.removeImported('notion');
    expect(removedNotion.map((r) => r.matchId).sort()).toEqual(['legacy', 'notion1']);
    expect(h.all().map((x) => x.matchId)).toEqual(['live']);
  });

  it('round-trips importSource through the data blob (survives a reload)', () => {
    const h = hist();
    h.add(g({ matchId: 'file1', importedAt: 1_700_000_000_001, importSource: 'file' }));
    h.close();
    expect(hist().all()[0].importSource).toBe('file');
  });
});

describe('HistoryStore — migration adds importSource to a pre-column database', () => {
  it('ALTERs an existing games table that lacks the column, then clears legacy imports as Notion', () => {
    // Hand-build a database with the pre-importSource schema (no importSource column).
    const dbPath = path.join(dir, DB_FILE);
    const legacy = g({ matchId: 'legacy-imp', importedAt: 1_700_000_000_000 });
    const raw = new DatabaseSync(dbPath);
    raw.exec(`CREATE TABLE games (
      matchId TEXT PRIMARY KEY, timestamp INTEGER NOT NULL, account TEXT, role TEXT, map TEXT,
      result TEXT, gameType TEXT, source TEXT, srDelta REAL, durationMinutes REAL, importedAt INTEGER,
      data TEXT NOT NULL
    );`);
    raw.prepare(
      'INSERT INTO games (matchId, timestamp, importedAt, data) VALUES (?, ?, ?, ?)',
    ).run(legacy.matchId, legacy.timestamp, legacy.importedAt!, JSON.stringify(legacy));
    raw.close();

    // Opening through HistoryStore runs the additive migration.
    const h = hist();
    const cols = h.all(); // proves the store opened without error post-migration
    expect(cols.map((r) => r.matchId)).toEqual(['legacy-imp']);
    // The legacy import (importSource NULL) is reachable via the 'notion' scope.
    expect(h.importedCount('notion')).toBe(1);
    expect(h.importedCount('file')).toBe(0);
    expect(h.removeImported('notion').map((r) => r.matchId)).toEqual(['legacy-imp']);
    expect(h.count()).toBe(0);
  });
});
