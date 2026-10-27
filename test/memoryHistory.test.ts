import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { GameRecord } from '../src/core/analytics';
import type { MatchRecord } from '../src/core/model';
import { HistoryStore } from '../src/store/history';
import { MemoryHistoryStore, type HistoryPort } from '../src/store/memoryHistory';
import type { JsonDoc } from '../src/store/jsonDocs';

function game(matchId: string, patch: Partial<GameRecord> = {}): GameRecord {
  return {
    matchId, timestamp: 1000, account: 'Main', role: 'damage', map: 'Ilios', result: 'Win',
    gameType: 'Competitive', heroes: ['Genji'], ...patch,
  };
}

/**
 * One script of every operation, run against both stores. The in-memory store
 * exists so the preview and tests can run the real provider; it is only useful
 * while it answers exactly like the SQLite one.
 */
function exercise(h: HistoryPort): unknown[] {
  const out: unknown[] = [];
  out.push(h.add(game('a')), h.add(game('a')));
  out.push(h.addMany([game('b', { account: 'Alt' }), game('a'), game('c', { importedAt: 5, importSource: 'file' })]));
  out.push(h.addMany([game('d', { importedAt: 7 })]));
  out.push(h.editManual('a', { srDelta: 12, performance: 3 }), h.editManual('a', { performance: null }), h.editManual('zz', { srDelta: 1 }));
  out.push(h.setReview('b', { at: 1, grades: { t: 'hit' }, flags: {} }), h.setReview('zz', { at: 1, grades: {}, flags: {} }));
  out.push(h.setReviews([
    { matchId: 'b', review: { at: 2, grades: {}, flags: {} } },
    { matchId: 'c', review: { at: 2, grades: {}, flags: {} } },
    { matchId: 'zz', review: { at: 2, grades: {}, flags: {} } },
  ]));
  out.push(h.clearReview('c'), h.clearReview('c'));
  out.push(h.mergeImported([game('a', { mental: { tilt: true } }), game('zz')]));
  out.push(h.relabelAccount('Alt', 'Alt2'), h.relabelAccount('Nope', 'X'));
  out.push(h.importedCount('file'), h.importedCount('notion'), h.lastImportedAt('file'), h.lastImportedAt('notion'));
  out.push(h.removeImported('notion').map((g) => g.matchId));
  out.push(h.deleteMatch('c')?.matchId, h.deleteMatch('c'));
  out.push(h.count(), h.has('b'), h.has('c'));
  const pending = (id: string, endedAt: number) => ({ matchId: id, endedAt, heroes: [], roster: [] }) as unknown as MatchRecord;
  out.push(h.addPending(pending('p2', 20)), h.addPending(pending('p1', 10)), h.addPending(pending('p1', 10)));
  out.push(h.allPending().map((p) => p.matchId), h.hasPending('p1'), h.pendingCount());
  out.push(h.takePending('p1')?.matchId, h.takePending('p1'), h.removePending('p2'), h.removePending('p2'));
  out.push(h.deleteByAccount('Alt2'));
  out.push(h.all());
  return out;
}

const tmpDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'vantage-memhist-'));

describe('MemoryHistoryStore', () => {
  it('answers every operation exactly like the SQLite HistoryStore', () => {
    const sqlite = new HistoryStore(tmpDir());
    try {
      expect(exercise(new MemoryHistoryStore())).toEqual(exercise(sqlite));
    } finally {
      sqlite.close();
    }
  });

  it('bumps its revision on every write, and a caller mutating a read never reaches the stored rows', () => {
    const h = new MemoryHistoryStore();
    const r0 = h.revision();
    h.add(game('a'));
    expect(h.revision()).not.toBe(r0);
    h.all()[0].account = 'mutated';
    h.add(game('b'));
    expect(h.all()[0].account).toBe('Main');
  });

  it('persists through its document and reloads from it', () => {
    let saved: unknown;
    const doc: JsonDoc = { read: () => saved, write: (v) => { saved = JSON.parse(JSON.stringify(v)); }, clear: () => {}, relocate: () => {} };
    new MemoryHistoryStore(doc).add(game('a'));
    expect(new MemoryHistoryStore(doc, [game('seed')]).all().map((g) => g.matchId)).toEqual(['a']);
    expect(new MemoryHistoryStore(undefined, [game('seed')]).all().map((g) => g.matchId)).toEqual(['seed']);
  });
});
