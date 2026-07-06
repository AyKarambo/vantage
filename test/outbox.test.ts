import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { OutboxStore } from '../src/store/outbox';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'owsync-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('OutboxStore', () => {
  it('recordExport round-trips through pageIdFor/signatureFor', () => {
    const store = new OutboxStore(dir);
    expect(store.pageIdFor('m1')).toBeUndefined();
    expect(store.signatureFor('m1')).toBeUndefined();
    store.recordExport('m1', { pageId: 'page-1', signature: 'sig-1' });
    expect(store.pageIdFor('m1')).toBe('page-1');
    expect(store.signatureFor('m1')).toBe('sig-1');
  });

  it('recordExport persists across instances', () => {
    new OutboxStore(dir).recordExport('m2', { pageId: 'page-2', signature: 'sig-2' });
    const reopened = new OutboxStore(dir);
    expect(reopened.pageIdFor('m2')).toBe('page-2');
    expect(reopened.signatureFor('m2')).toBe('sig-2');
  });

  it('clearExport removes a record', () => {
    const store = new OutboxStore(dir);
    store.recordExport('m3', { pageId: 'page-3', signature: 'sig-3' });
    expect(store.pageIdFor('m3')).toBe('page-3');
    store.clearExport('m3');
    expect(store.pageIdFor('m3')).toBeUndefined();
    expect(store.signatureFor('m3')).toBeUndefined();
  });

  it('clearExport is a no-op for an unknown matchId', () => {
    const store = new OutboxStore(dir);
    expect(() => store.clearExport('nope')).not.toThrow();
  });

  it('recordImported stores a full ledger record', () => {
    const store = new OutboxStore(dir);
    store.recordImported('m4', { pageId: 'page-4', signature: 'sig-4' });
    expect(store.pageIdFor('m4')).toBe('page-4');
    expect(store.signatureFor('m4')).toBe('sig-4');
    expect(store.legacyProcessed()).not.toContain('m4');
  });

  it('legacy { processed: [id] } loads and legacyProcessed() returns ids with no ledger record', () => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'outbox.json'),
      JSON.stringify({ processed: ['old-1', 'old-2'] }),
      'utf8',
    );
    const store = new OutboxStore(dir);
    expect(store.legacyProcessed().sort()).toEqual(['old-1', 'old-2']);

    // Once a ledger record exists for one of them (e.g. backfilled), it drops out.
    store.recordExport('old-1', { pageId: 'page-1', signature: 'sig-1' });
    expect(store.legacyProcessed()).toEqual(['old-2']);
  });

  it('starts with an empty ledger and no legacy ids when the file is missing', () => {
    const store = new OutboxStore(dir);
    expect(store.legacyProcessed()).toEqual([]);
  });

  it('relocate re-points and reloads from the new dir', () => {
    const store = new OutboxStore(dir);
    store.recordExport('m1', { pageId: 'page-1', signature: 'sig-1' });

    const newDir = fs.mkdtempSync(path.join(os.tmpdir(), 'owsync-new-'));
    try {
      fs.copyFileSync(path.join(dir, 'outbox.json'), path.join(newDir, 'outbox.json'));
      store.relocate(newDir);

      expect(store.pageIdFor('m1')).toBe('page-1');
      store.recordExport('m2', { pageId: 'page-2', signature: 'sig-2' });
      expect(new OutboxStore(newDir).pageIdFor('m2')).toBe('page-2');
      // relocate itself doesn't touch the old dir's file (copy/delete is the
      // migration executor's job).
      expect(new OutboxStore(dir).pageIdFor('m2')).toBeUndefined();
    } finally {
      fs.rmSync(newDir, { recursive: true, force: true });
    }
  });
});

describe('OutboxStore — database affinity', () => {
  it('a record stamped with a different databaseId reads as not-in-the-ledger', () => {
    const store = new OutboxStore(dir);
    store.recordExport('m1', { pageId: 'page-1', signature: 'sig-1', databaseId: 'db-old' });

    // Same database → visible as usual.
    expect(store.pageIdFor('m1', 'db-old')).toBe('page-1');
    expect(store.signatureFor('m1', 'db-old')).toBe('sig-1');

    // Different (newly configured) database → treated as not-in-the-ledger.
    expect(store.pageIdFor('m1', 'db-new')).toBeUndefined();
    expect(store.signatureFor('m1', 'db-new')).toBeUndefined();
  });

  it('a record with no stamped databaseId (pre-migration) matches whatever database is asked about', () => {
    const store = new OutboxStore(dir);
    store.recordExport('m1', { pageId: 'page-1', signature: 'sig-1' }); // no databaseId

    expect(store.pageIdFor('m1', 'db-a')).toBe('page-1');
    expect(store.pageIdFor('m1', 'db-b')).toBe('page-1');
    expect(store.signatureFor('m1', 'db-a')).toBe('sig-1');
  });

  it('re-recording with a new databaseId re-stamps the record (adopts the new database)', () => {
    const store = new OutboxStore(dir);
    store.recordExport('m1', { pageId: 'page-1', signature: 'sig-1', databaseId: 'db-old' });
    expect(store.pageIdFor('m1', 'db-new')).toBeUndefined(); // old DB, stale for the new one

    // Exporter creates a fresh page in the new database and re-records against it.
    store.recordExport('m1', { pageId: 'page-2', signature: 'sig-2', databaseId: 'db-new' });
    expect(store.pageIdFor('m1', 'db-new')).toBe('page-2');
    expect(store.pageIdFor('m1', 'db-old')).toBeUndefined(); // now stale for the old one
  });

  it('when the caller never passes a databaseId at all, affinity checking is disabled (matches prior behavior)', () => {
    const store = new OutboxStore(dir);
    store.recordExport('m1', { pageId: 'page-1', signature: 'sig-1', databaseId: 'db-old' });
    expect(store.pageIdFor('m1')).toBe('page-1');
    expect(store.signatureFor('m1')).toBe('sig-1');
  });
});
