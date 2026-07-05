import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HistoryStore } from '../src/store/history';
import { migrateJsonHistory } from '../src/store/historyMigration';
import type { GameRecord } from '../src/core/analytics';

const tmpDirs: string[] = [];
const stores: HistoryStore[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'vantage-hmig-'));
  tmpDirs.push(d);
  return d;
}
function open(dir: string): HistoryStore {
  const s = new HistoryStore(dir);
  stores.push(s);
  return s;
}
function seedLegacy(dir: string, games: unknown): string {
  const p = path.join(dir, 'history.json');
  fs.writeFileSync(p, typeof games === 'string' ? games : JSON.stringify(games), 'utf8');
  return p;
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

describe('migrateJsonHistory', () => {
  it('imports a legacy history.json faithfully and leaves the file untouched', () => {
    const dir = tmp();
    const legacy = seedLegacy(dir, [
      g({ matchId: 'a', srDelta: 22, review: { at: 1, grades: { t1: 'hit' }, flags: { tilt: true } } }),
      g({ matchId: 'b', mental: { toxicMates: true } }),
    ]);
    const store = open(dir);

    expect(migrateJsonHistory(store, legacy).migrated).toBe(2);
    expect(store.count()).toBe(2);
    expect(store.all().find((x) => x.matchId === 'a')?.srDelta).toBe(22);
    expect(store.all().find((x) => x.matchId === 'a')?.review?.grades.t1).toBe('hit');
    expect(store.all().find((x) => x.matchId === 'b')?.mental?.toxicMates).toBe(true);

    // history.json is a frozen backup — never modified or deleted.
    expect(fs.existsSync(legacy)).toBe(true);
    expect(JSON.parse(fs.readFileSync(legacy, 'utf8'))).toHaveLength(2);
  });

  it('is idempotent — a second run imports nothing', () => {
    const dir = tmp();
    const legacy = seedLegacy(dir, [g({ matchId: 'a' })]);
    const store = open(dir);
    expect(migrateJsonHistory(store, legacy).migrated).toBe(1);
    expect(migrateJsonHistory(store, legacy).migrated).toBe(0);
    expect(store.count()).toBe(1);
  });

  it('is a no-op when the store already has data (never mixes in stale JSON)', () => {
    const dir = tmp();
    const legacy = seedLegacy(dir, [g({ matchId: 'fromjson' })]);
    const store = open(dir);
    store.add(g({ matchId: 'live' }));
    expect(migrateJsonHistory(store, legacy).migrated).toBe(0);
    expect(store.all().map((x) => x.matchId)).toEqual(['live']);
  });

  it('tolerates a missing, corrupt, or non-array legacy file', () => {
    const dir = tmp();
    const store = open(dir);
    expect(migrateJsonHistory(store, path.join(dir, 'absent.json')).migrated).toBe(0);
    expect(migrateJsonHistory(store, seedLegacy(dir, 'not json {')).migrated).toBe(0);
    expect(migrateJsonHistory(store, seedLegacy(dir, { not: 'an array' })).migrated).toBe(0);
    expect(store.count()).toBe(0);
  });
});
