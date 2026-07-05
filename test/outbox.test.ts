import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { OutboxStore } from '../src/store/outbox';
import { emptyMatch } from '../src/core/model';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'owsync-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('OutboxStore', () => {
  it('tracks processed ids and dedupes', () => {
    const store = new OutboxStore(dir);
    expect(store.isProcessed('m1')).toBe(false);
    store.markProcessed('m1');
    store.markProcessed('m1'); // idempotent
    expect(store.isProcessed('m1')).toBe(true);
  });

  it('persists across instances', () => {
    new OutboxStore(dir).markProcessed('m2');
    expect(new OutboxStore(dir).isProcessed('m2')).toBe(true);
  });

  it('queues and removes pending matches', () => {
    const store = new OutboxStore(dir);
    store.enqueue(emptyMatch('m3'));
    store.enqueue(emptyMatch('m3')); // no dupes
    expect(store.pending()).toHaveLength(1);
    store.remove('m3');
    expect(store.pending()).toHaveLength(0);
  });

  it('trims the processed list to the cap', () => {
    const store = new OutboxStore(dir, 3);
    ['a', 'b', 'c', 'd'].forEach((id) => store.markProcessed(id));
    expect(store.isProcessed('a')).toBe(false); // evicted
    expect(store.isProcessed('d')).toBe(true);
  });

  it('markManyProcessed marks a batch, dedupes, and persists once', () => {
    const store = new OutboxStore(dir);
    store.markProcessed('m1');
    store.markManyProcessed(['m1', 'm2', 'm3']); // m1 already present
    expect(['m1', 'm2', 'm3'].every((id) => store.isProcessed(id))).toBe(true);
    // Persisted (single atomic save) and readable by a fresh instance.
    expect(new OutboxStore(dir).isProcessed('m3')).toBe(true);
  });

  it('markManyProcessed respects the cap', () => {
    const store = new OutboxStore(dir, 3);
    store.markManyProcessed(['a', 'b', 'c', 'd']);
    expect(store.isProcessed('a')).toBe(false); // evicted
    expect(store.isProcessed('d')).toBe(true);
  });
});
