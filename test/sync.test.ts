import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SyncService, type Notifier } from '../src/main/sync';
import { OutboxStore } from '../src/store/outbox';
import { emptyMatch, type MatchRecord } from '../src/core/model';
import type { AppConfig } from '../src/main/config';
import type { NotionWriter } from '../src/notion/notionWriter';
import type { MapsCache } from '../src/notion/mapsCache';

let dir: string;
const config = {
  logFilter: 'Everything',
  accounts: {},
  mapAliases: {},
  notion: {},
} as unknown as AppConfig;

const silentNotifier: Notifier = { notify: () => {}, notifyError: () => {} };
const okMaps = { resolve: async () => ({ matched: true, pageId: 'p1' }) } as unknown as MapsCache;

function competitiveMatch(id: string): MatchRecord {
  return { ...emptyMatch(id), gameType: 'Competitive', mapName: "King's Row", outcome: 'Victory' };
}

async function waitFor(cond: () => boolean, ms = 500): Promise<void> {
  const start = Date.now();
  while (!cond() && Date.now() - start < ms) await new Promise((r) => setTimeout(r, 5));
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'owsync-sync-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('SyncService durability', () => {
  it('keeps a match in the outbox when the write fails, then writes it on retry', async () => {
    const outbox = new OutboxStore(dir);
    let calls = 0;
    const writer = {
      createMatchPage: async () => {
        calls++;
        if (calls === 1) throw new Error('Notion down');
        return 'page-id';
      },
    } as unknown as NotionWriter;

    const sync = new SyncService(config, outbox, silentNotifier);
    sync.setNotion(writer, okMaps);

    await sync.handleRecord(competitiveMatch('m1'));
    // first write failed → still queued, not processed
    expect(calls).toBe(1);
    expect(outbox.pending().map((r) => r.matchId)).toEqual(['m1']);
    expect(outbox.isProcessed('m1')).toBe(false);

    await sync.flushPending();
    // retry succeeded → dequeued + marked processed
    expect(calls).toBe(2);
    expect(outbox.pending()).toHaveLength(0);
    expect(outbox.isProcessed('m1')).toBe(true);
  });

  it('writes once on success and never re-writes a processed match', async () => {
    const outbox = new OutboxStore(dir);
    let calls = 0;
    const writer = {
      createMatchPage: async () => {
        calls++;
        return 'page-id';
      },
    } as unknown as NotionWriter;

    const sync = new SyncService(config, outbox, silentNotifier);
    sync.setNotion(writer, okMaps);

    await sync.handleRecord(competitiveMatch('m2'));
    await sync.handleRecord(competitiveMatch('m2')); // duplicate emission
    await sync.flushPending();

    expect(calls).toBe(1);
    expect(outbox.isProcessed('m2')).toBe(true);
    expect(outbox.pending()).toHaveLength(0);
  });

  it('does not double-write when an immediate write and a retry race', async () => {
    const outbox = new OutboxStore(dir);
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const writer = {
      createMatchPage: async () => {
        calls++;
        await gate; // hold the write open
        return 'page-id';
      },
    } as unknown as NotionWriter;

    const sync = new SyncService(config, outbox, silentNotifier);
    sync.setNotion(writer, okMaps);

    const immediate = sync.handleRecord(competitiveMatch('m3')); // starts write, blocks on gate
    await sync.flushPending(); // concurrent — must be skipped by the in-flight guard
    release();
    await immediate;

    expect(calls).toBe(1);
    expect(outbox.isProcessed('m3')).toBe(true);
    expect(outbox.pending()).toHaveLength(0);
  });

  it('queues matches when Notion is not configured, then flushes once it is', async () => {
    const outbox = new OutboxStore(dir);
    const sync = new SyncService(config, outbox, silentNotifier);

    await sync.handleRecord(competitiveMatch('m4')); // no token yet
    expect(outbox.pending().map((r) => r.matchId)).toEqual(['m4']);
    expect(outbox.isProcessed('m4')).toBe(false);

    let calls = 0;
    const writer = {
      createMatchPage: async () => {
        calls++;
        return 'page-id';
      },
    } as unknown as NotionWriter;
    sync.setNotion(writer, okMaps); // setNotion auto-flushes pending
    await waitFor(() => outbox.isProcessed('m4'));

    expect(calls).toBe(1);
    expect(outbox.isProcessed('m4')).toBe(true);
    expect(outbox.pending()).toHaveLength(0);
  });
});
