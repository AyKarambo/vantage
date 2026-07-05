import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { NotionExporter, gameToMatchRecord } from '../src/notion/notionExporter';
import { NotionWriter } from '../src/notion/notionWriter';
import { OutboxStore } from '../src/store/outbox';
import type { GameRecord } from '../src/core/analytics';

function game(matchId: string, timestamp = Date.now()): GameRecord {
  return {
    matchId,
    timestamp,
    account: 'Main',
    role: 'damage',
    map: 'Ilios',
    result: 'Win',
    gameType: 'Competitive',
    heroes: ['Tracer'],
  } as GameRecord;
}

describe('NotionExporter validation short-circuit', () => {
  it('returns an error and calls neither the writer nor the maps cache when shape issues are cached', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'owsync-'));
    const outbox = new OutboxStore(dir);
    const writer = { createMatchPage: vi.fn() } as any;
    const maps = { resolve: vi.fn() } as any;

    const exporter = new NotionExporter(writer, maps, outbox, ['Result', 'Map']);
    const result = await exporter.export([game('m1')]);

    expect(result).toEqual({ ok: 0, failed: 0, skipped: 0, error: 'Database is missing: Result, Map' });
    expect(writer.createMatchPage).not.toHaveBeenCalled();
    expect(maps.resolve).not.toHaveBeenCalled();

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('exports normally when no shape issues are cached', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'owsync-'));
    const outbox = new OutboxStore(dir);
    const writer = { createMatchPage: vi.fn().mockResolvedValue('page-id') } as any;
    const maps = { resolve: vi.fn().mockResolvedValue({ matched: false }) } as any;

    const exporter = new NotionExporter(writer, maps, outbox);
    const result = await exporter.export([game('m2')]);

    expect(result).toEqual({ ok: 1, failed: 0, skipped: 0 });
    expect(writer.createMatchPage).toHaveBeenCalledTimes(1);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('skips games already marked processed by an import (import → sync is idempotent)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'owsync-'));
    const outbox = new OutboxStore(dir);
    // An import marks its rows processed so a later Sync does not re-write them.
    outbox.markManyProcessed(['manual-notion-abc', 'gep-123']);
    const writer = { createMatchPage: vi.fn().mockResolvedValue('page-id') } as any;
    const maps = { resolve: vi.fn().mockResolvedValue({ matched: false }) } as any;

    const exporter = new NotionExporter(writer, maps, outbox);
    const result = await exporter.export([game('manual-notion-abc'), game('gep-123')]);

    expect(result).toEqual({ ok: 0, failed: 0, skipped: 2 });
    expect(writer.createMatchPage).not.toHaveBeenCalled(); // no duplicate rows written back

    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('NotionWriter — Played At round-trip', () => {
  it('carries the match end time so a Played At-capable database round-trips it', () => {
    const rec = gameToMatchRecord(game('m1', Date.parse('2026-05-01T12:34:00.000Z')));
    expect(rec.endedAt).toBe(Date.parse('2026-05-01T12:34:00.000Z'));
  });

  it('writes Played At when the database has the column', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'page-id' });
    const client = { pages: { create } } as any;
    const writer = new NotionWriter(client, 'db', true);
    await writer.createMatchPage({ record: gameToMatchRecord(game('m1', Date.parse('2026-05-01T12:34:00.000Z'))) });
    const props = create.mock.calls[0][0].properties;
    expect(props['Played At']).toEqual({ date: { start: '2026-05-01T12:34:00.000Z' } });
  });

  it('omits Played At when the database lacks the column (default), so pages.create never sends it', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'page-id' });
    const client = { pages: { create } } as any;
    const writer = new NotionWriter(client, 'db'); // hasPlayedAt defaults false
    await writer.createMatchPage({ record: gameToMatchRecord(game('m1')) });
    expect(create.mock.calls[0][0].properties).not.toHaveProperty('Played At');
  });
});
