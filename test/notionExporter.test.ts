import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { NotionExporter, gameToMatchRecord, exportMental } from '../src/notion/notionExporter';
import { NotionWriter } from '../src/notion/notionWriter';
import { NotionImporter, NOTION_IMPROVEMENT_TARGET_ID } from '../src/notion/notionImporter';
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

describe('NotionWriter — page parent', () => {
  it('parents on the database id when no data source id is known (pre-validation fallback)', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'page-id' });
    const client = { pages: { create } } as any;
    const writer = new NotionWriter(client, 'db');
    await writer.createMatchPage({ record: gameToMatchRecord(game('m1')) });
    expect(create.mock.calls[0][0].parent).toEqual({ database_id: 'db' });
  });

  it('parents on the resolved data source id once validation has run', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'page-id' });
    const client = { pages: { create } } as any;
    const writer = new NotionWriter(client, 'db', false, new Set(), false, 'ds-id');
    await writer.createMatchPage({ record: gameToMatchRecord(game('m1')) });
    expect(create.mock.calls[0][0].parent).toEqual({ data_source_id: 'ds-id' });
  });
});

const SUBJECTIVE = new Set(['Comms', 'Improvement Target', 'Leaver', 'Tilt', 'Toxic Mates']);
function captureCreate() {
  const create = vi.fn().mockResolvedValue({ id: 'page-id' });
  return { create, client: { pages: { create } } as any };
}

describe('NotionWriter — subjective columns', () => {
  it('writes Comms/Improvement Target/Leaver/Tilt into their columns when present and set', async () => {
    const { create, client } = captureCreate();
    const writer = new NotionWriter(client, 'db', false, SUBJECTIVE);
    await writer.createMatchPage({
      record: gameToMatchRecord(game('m1')),
      mental: { positiveComms: true, tilt: true, leaverMyTeam: true },
      improvementGrade: 'partial',
    });
    const props = create.mock.calls[0][0].properties;
    expect(props['Comms']).toEqual({ select: { name: 'positive' } });
    expect(props['Improvement Target']).toEqual({ select: { name: 'partially' } }); // 'partial' → 'partially'
    expect(props['Leaver']).toEqual({ select: { name: 'team' } });
    expect(props['Tilt']).toEqual({ checkbox: true });
    expect(props).not.toHaveProperty('Toxic Mates'); // not flagged → not written
  });

  it('omits every subjective column the database does not define (default empty set)', async () => {
    const { create, client } = captureCreate();
    const writer = new NotionWriter(client, 'db'); // no writable columns
    await writer.createMatchPage({
      record: gameToMatchRecord(game('m1')),
      mental: { positiveComms: true, tilt: true },
      improvementGrade: 'hit',
    });
    const props = create.mock.calls[0][0].properties;
    for (const name of ['Comms', 'Improvement Target', 'Leaver', 'Tilt', 'Toxic Mates']) {
      expect(props).not.toHaveProperty(name);
    }
  });

  it('maps the enemy-team leaver and the missed grade correctly', async () => {
    const { create, client } = captureCreate();
    const writer = new NotionWriter(client, 'db', false, SUBJECTIVE);
    await writer.createMatchPage({
      record: gameToMatchRecord(game('m1')),
      mental: { leaverEnemyTeam: true },
      improvementGrade: 'missed',
    });
    const props = create.mock.calls[0][0].properties;
    expect(props['Leaver']).toEqual({ select: { name: 'enemy' } });
    expect(props['Improvement Target']).toEqual({ select: { name: 'missed' } });
    expect(props).not.toHaveProperty('Tilt');
  });
});

describe('exportMental', () => {
  it('merges the quick-log mental and the Review flags, folding the legacy leaver', () => {
    const g = {
      ...game('m1'),
      mental: { positiveComms: true },
      review: { at: 1, grades: {}, flags: { tilt: true, leaver: true } },
    } as GameRecord;
    expect(exportMental(g)).toEqual({ tilt: true, positiveComms: true, leaverMyTeam: true });
  });

  it('is undefined when nothing was flagged', () => {
    expect(exportMental(game('m1'))).toBeUndefined();
  });
});

describe('export → import round-trip', () => {
  it('preserves map, comms, improvement grade, leaver and tilt through Notion', async () => {
    // Export: capture the exact properties the writer sends to pages.create.
    const { create, client } = captureCreate();
    create.mockResolvedValue({ id: 'created-page' });
    const writer = new NotionWriter(client, 'gt-db', true, SUBJECTIVE);
    const g = game('gep-777', Date.parse('2026-05-01T12:00:00.000Z'));
    await writer.createMatchPage({
      record: gameToMatchRecord(g),
      account: 'Main', role: 'damage', result: 'Win',
      mapPageId: 'map-ilios',
      mental: exportMental({ ...g, mental: { positiveComms: true, tilt: true, leaverMyTeam: true } } as GameRecord),
      improvementGrade: 'partial',
    });
    const properties = create.mock.calls[0][0].properties;

    // Import: feed that created page straight back through the importer. `gt-db`
    // and `maps-db` are database ids; `databases.retrieve` resolves each to its
    // (same-named) data source id, and `dataSources.query` dispatches on that.
    const page = { id: 'created-page', created_time: '2026-05-01T12:00:00.000Z', properties };
    const mapsPage = { id: 'map-ilios', properties: { Name: { type: 'title', title: [{ plain_text: 'Ilios' }] } } };
    const retrieve = vi.fn(async ({ database_id }: any) => ({ data_sources: [{ id: `${database_id}-ds` }] }));
    const query = vi.fn(async ({ data_source_id }: any) => ({
      results: data_source_id === 'gt-db-ds' ? [page] : [mapsPage],
      has_more: false,
      next_cursor: null,
    }));
    const importer = new NotionImporter(
      { databases: { retrieve }, dataSources: { query } } as any, 'gt-db', 'maps-db',
    );
    const { games } = await importer.import();

    expect(games).toHaveLength(1);
    const back = games[0];
    expect(back.matchId).toBe('gep-777');
    expect(back.source).toBe('gep');
    expect(back.map).toBe('Ilios');
    expect(back.result).toBe('Win');
    expect(back.role).toBe('damage');
    expect(back.mental).toMatchObject({ positiveComms: true, tilt: true, leaverMyTeam: true });
    expect(back.review?.grades[NOTION_IMPROVEMENT_TARGET_ID]).toBe('partial');
  });

  it('round-trips SR delta and final score, and drops local-only fields', async () => {
    const { create, client } = captureCreate();
    create.mockResolvedValue({ id: 'created-page' });
    const writer = new NotionWriter(client, 'gt-db', true, SUBJECTIVE, true); // hasSrDelta = true
    const g = {
      ...game('gep-778', Date.parse('2026-05-02T09:00:00.000Z')),
      srDelta: -19,
      finalScore: '2-1',
      // Documented local-only fields that must NOT survive the round-trip.
      screenshots: ['shot.png'],
      roster: [{ battleTag: 'Foe#1', heroName: 'Mercy' }],
      importedAt: 1_700_000_000_000,
    } as GameRecord;
    await writer.createMatchPage({
      record: gameToMatchRecord(g),
      account: 'Main', role: 'damage', result: 'Win', mapPageId: 'map-ilios',
    });
    const properties = create.mock.calls[0][0].properties;

    const page = { id: 'created-page', created_time: '2026-05-02T09:00:00.000Z', properties };
    const mapsPage = { id: 'map-ilios', properties: { Name: { type: 'title', title: [{ plain_text: 'Ilios' }] } } };
    const retrieve = vi.fn(async ({ database_id }: any) => ({ data_sources: [{ id: `${database_id}-ds` }] }));
    const query = vi.fn(async ({ data_source_id }: any) => ({
      results: data_source_id === 'gt-db-ds' ? [page] : [mapsPage],
      has_more: false, next_cursor: null,
    }));
    const importer = new NotionImporter(
      { databases: { retrieve }, dataSources: { query } } as any, 'gt-db', 'maps-db',
    );
    const { games } = await importer.import();

    const back = games[0];
    expect(back.srDelta).toBe(-19);
    expect(back.finalScore).toBe('2-1');
    expect(back.screenshots).toBeUndefined();
    expect(back.roster).toBeUndefined();
    expect(back.importedAt).toBeUndefined();
  });
});

describe('NotionWriter — SR Delta', () => {
  it('writes SR Delta when the column exists and the match has an SR change', async () => {
    const { create, client } = captureCreate();
    const writer = new NotionWriter(client, 'db', false, new Set(), true); // hasSrDelta = true
    await writer.createMatchPage({ record: gameToMatchRecord({ ...game('m1'), srDelta: -19 } as GameRecord) });
    expect(create.mock.calls[0][0].properties['SR Delta']).toEqual({ number: -19 });
  });

  it('omits SR Delta when the database lacks the column (default)', async () => {
    const { create, client } = captureCreate();
    const writer = new NotionWriter(client, 'db'); // hasSrDelta defaults false
    await writer.createMatchPage({ record: gameToMatchRecord({ ...game('m1'), srDelta: -19 } as GameRecord) });
    expect(create.mock.calls[0][0].properties).not.toHaveProperty('SR Delta');
  });
});

describe('gameToMatchRecord — carried scalar fields', () => {
  it('carries srDelta and finalScore (finalScore was previously dropped)', () => {
    const rec = gameToMatchRecord({ ...game('m1'), srDelta: 22, finalScore: '2-1' } as GameRecord);
    expect(rec.srDelta).toBe(22);
    expect(rec.finalScore).toBe('2-1');
  });
});
