import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { NotionExporter } from '../src/notion/notionExporter';
import { OutboxStore } from '../src/store/outbox';
import type { GameRecord } from '../src/core/analytics';

function game(matchId: string): GameRecord {
  return {
    matchId,
    timestamp: Date.now(),
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
});
