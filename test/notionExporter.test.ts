import { describe, it, expect, vi } from 'vitest';
import { APIResponseError, APIErrorCode } from '@notionhq/client';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { NotionExporter, gameToMatchRecord, exportMental } from '../src/notion/notionExporter';
import { NotionWriter } from '../src/notion/notionWriter';
import { NotionImporter } from '../src/notion/notionImporter';
import { NOTION_IMPROVEMENT_TARGET_ID } from '../src/core/targets';
import { OutboxStore } from '../src/store/outbox';
import type { GameRecord, MatchReview } from '../src/core/analytics';

function game(matchId: string, overrides: Partial<GameRecord> = {}): GameRecord {
  return {
    matchId,
    timestamp: Date.now(),
    account: 'Main',
    role: 'damage',
    map: 'Ilios',
    result: 'Win',
    gameType: 'Competitive',
    heroes: ['Tracer'],
    ...overrides,
  } as GameRecord;
}

function review(grades: MatchReview['grades'], flags: MatchReview['flags'] = {}): MatchReview {
  return { at: Date.now(), grades, flags };
}

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'owsync-'));
}

/** A no-op writer/maps stand-in so tests only assert on the calls they care about. */
function stubWriter() {
  return {
    createMatchPage: vi.fn().mockResolvedValue('new-page-id'),
    updateMatchPage: vi.fn().mockResolvedValue(undefined),
    stampMatchId: vi.fn().mockResolvedValue(undefined),
  } as unknown as NotionWriter;
}
function stubMaps() {
  return { resolve: vi.fn().mockResolvedValue({ matched: false, pageId: undefined }) } as any;
}

describe('NotionExporter validation short-circuit', () => {
  it('returns an error and calls neither the writer nor the maps cache when shape issues are cached', async () => {
    const dir = tmpDir();
    const outbox = new OutboxStore(dir);
    const writer = stubWriter();
    const maps = stubMaps();

    const exporter = new NotionExporter(writer, maps, outbox, ['Result', 'Map']);
    const result = await exporter.export([game('m1')]);

    expect(result).toEqual({ ok: 0, failed: 0, skipped: 0, error: 'Database is missing: Result, Map' });
    expect(writer.createMatchPage).not.toHaveBeenCalled();
    expect(maps.resolve).not.toHaveBeenCalled();

    fs.rmSync(dir, { recursive: true, force: true });
  });

  // The data-loss guard: "we couldn't check the shape" is NOT "the shape is fine".
  // The writer's capabilities (Played At, SR Delta, the Map relation, the subjective
  // columns) are only known from a validate that succeeded, so exporting without one
  // writes rows missing those fields — and the ledger below would then make every
  // later sync skip them, leaving Notion permanently wrong. Refusing is recoverable.
  it('refuses to export when the shape could not be verified, and writes nothing', async () => {
    const dir = tmpDir();
    const outbox = new OutboxStore(dir);
    const writer = stubWriter();
    const maps = stubMaps();

    const exporter = new NotionExporter(
      writer, maps, outbox, undefined, undefined, undefined, undefined, undefined, undefined,
      "Couldn't verify your Notion database — check your internet connection.",
    );
    const result = await exporter.export([game('m1')]);

    expect(result.unavailable).toBe(true);
    expect(result.ok).toBe(0);
    expect(result.error).toMatch(/internet connection/i);
    expect(writer.createMatchPage).not.toHaveBeenCalled();
    expect(writer.updateMatchPage).not.toHaveBeenCalled();
    // Nothing ledgered either — the game must still be exportable once the shape
    // can actually be verified, rather than silently marked as done.
    expect(outbox.pageIdFor('m1')).toBeUndefined();
    expect(outbox.signatureFor('m1')).toBeUndefined();

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('exports normally when no shape issues are cached', async () => {
    const dir = tmpDir();
    const outbox = new OutboxStore(dir);
    const writer = stubWriter();
    const maps = stubMaps();

    const exporter = new NotionExporter(writer, maps, outbox);
    const result = await exporter.export([game('m2')]);

    expect(result).toEqual({ ok: 1, failed: 0, skipped: 0, updated: 0, recreated: 0 });
    expect(writer.createMatchPage).toHaveBeenCalledTimes(1);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('skips games already in the ledger with an unchanged signature (idempotent re-sync)', async () => {
    const dir = tmpDir();
    const outbox = new OutboxStore(dir);
    outbox.recordExport('gep-123', { pageId: 'page-1', signature: JSON.stringify({ grade: null, flags: [] }) });
    const writer = stubWriter();
    const maps = stubMaps();

    const exporter = new NotionExporter(writer, maps, outbox);
    const result = await exporter.export([game('gep-123')]);

    expect(result).toEqual({ ok: 0, failed: 0, skipped: 1, updated: 0, recreated: 0 });
    expect(writer.createMatchPage).not.toHaveBeenCalled();
    expect(writer.updateMatchPage).not.toHaveBeenCalled();

    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('NotionExporter — DoD regression: aggregate grade + positiveComms reach the create', () => {
  // Regression for the pre-fix bug: the old exporter read only
  // `review.grades[NOTION_IMPROVEMENT_TARGET_ID]` (an internal slot in-app
  // reviews never populate) and was create-only, so a reviewed match's grade
  // and Comms flag never reached Notion. Run against the unfixed exporter and
  // this assertion fails (both properties stay empty); the fix (aggregate-grade
  // derivation via `aggregateImprovementGrade`) makes it pass.
  it('a single authored target graded hit + positiveComms → create writes Improvement Target=hit, Comms=positive', async () => {
    const dir = tmpDir();
    const outbox = new OutboxStore(dir);
    const create = vi.fn().mockResolvedValue({ id: 'new-page-id' });
    const client = { pages: { create } } as any;
    const SUBJECTIVE = new Set(['Comms', 'Improvement Target']);
    const writer = new NotionWriter(client, 'db', false, SUBJECTIVE);
    const maps = stubMaps();

    const g = game('gep-1', {
      review: review({ 't-1': 'hit' }, { positiveComms: true }),
    });
    const exporter = new NotionExporter(writer, maps, outbox, undefined, () => new Set(['t-1']));
    const result = await exporter.export([g]);

    expect(result.ok).toBe(1);
    const props = create.mock.calls[0][0].properties;
    expect(props['Improvement Target']).toEqual({ select: { name: 'hit' } });
    expect(props['Comms']).toEqual({ select: { name: 'positive' } });

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('three targets hit/hit/missed → create writes Improvement Target=partially', async () => {
    const dir = tmpDir();
    const outbox = new OutboxStore(dir);
    const create = vi.fn().mockResolvedValue({ id: 'new-page-id' });
    const client = { pages: { create } } as any;
    const writer = new NotionWriter(client, 'db', false, new Set(['Improvement Target']));
    const maps = stubMaps();

    const g = game('gep-2', {
      review: review({ 't-1': 'hit', 't-2': 'hit', 't-3': 'missed' }),
    });
    const exporter = new NotionExporter(writer, maps, outbox, undefined, () => new Set(['t-1', 't-2', 't-3']));
    await exporter.export([g]);

    const props = create.mock.calls[0][0].properties;
    expect(props['Improvement Target']).toEqual({ select: { name: 'partially' } });

    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('NotionExporter — authoredTargetIds is read live per export() call', () => {
  // Regression: buildExporter used to snapshot authoredTargetIds at
  // rebuild/validate time, so a target authored after startup stayed invisible
  // (fell back to the hidden bookkeeping slot) until the next rebuild. The
  // exporter now takes a GETTER and re-reads it on every export() call — this
  // proves a target added between two exports on the SAME exporter instance is
  // picked up without reconstructing it.
  it('a target authored between two export() calls is honored on the second call without rebuilding the exporter', async () => {
    const dir = tmpDir();
    const outbox = new OutboxStore(dir);
    const create = vi.fn().mockResolvedValue({ id: 'page-id' });
    const update = vi.fn().mockResolvedValue(undefined);
    const client = { pages: { create, update } } as any;
    const writer = new NotionWriter(client, 'db', false, new Set(['Improvement Target']));
    const maps = stubMaps();

    // Live-mutable set, like a real `authoredTargetIds()` dep would read from
    // a store: starts without 't-new'.
    let authored = new Set(['t-1']);
    const exporter = new NotionExporter(writer, maps, outbox, undefined, () => authored);

    // First export: 't-new' isn't authored yet, so its grade falls back to the
    // hidden bookkeeping slot and doesn't affect the aggregate (no authored
    // target graded at all → grade is undefined/null).
    const g1 = game('gep-new', { review: review({ 't-new': 'hit' }) });
    await exporter.export([g1]);
    expect(create.mock.calls[0][0].properties['Improvement Target']).toBeUndefined();

    // Author 't-new' — no exporter rebuild, just the live set changing.
    authored = new Set(['t-1', 't-new']);

    // Second export of the SAME match: now that 't-new' is authored, its 'hit'
    // grade must reach the aggregate and produce an update (signature changed).
    await exporter.export([g1]);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0].properties['Improvement Target']).toEqual({ select: { name: 'hit' } });

    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('NotionExporter — update on sync', () => {
  it('already-exported match with a changed signature → updateMatchPage called once, createMatchPage not, updated:1', async () => {
    const dir = tmpDir();
    const outbox = new OutboxStore(dir);
    outbox.recordExport('gep-3', { pageId: 'existing-page', signature: JSON.stringify({ grade: null, flags: [] }) });
    const writer = stubWriter();
    const maps = stubMaps();

    // The review is now complete: grades aggregate to `partially`, positiveComms set —
    // the signature changes from the empty baseline above.
    const g = game('gep-3', {
      review: review({ 't-1': 'hit', 't-2': 'missed' }, { positiveComms: true }),
    });
    const exporter = new NotionExporter(writer, maps, outbox, undefined, () => new Set(['t-1', 't-2']));
    const result = await exporter.export([g]);

    expect(writer.updateMatchPage).toHaveBeenCalledTimes(1);
    expect(writer.updateMatchPage).toHaveBeenCalledWith('existing-page', expect.anything());
    expect(writer.createMatchPage).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: 0, failed: 0, skipped: 0, updated: 1, recreated: 0 });

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('removing positiveComms and syncing sends Comms: { select: null } on the update', async () => {
    const dir = tmpDir();
    const outbox = new OutboxStore(dir);
    // Baseline: previously exported with positiveComms set.
    const withComms = JSON.stringify({ grade: null, flags: ['positiveComms'] });
    outbox.recordExport('gep-4', { pageId: 'existing-page', signature: withComms });

    const create = vi.fn();
    const update = vi.fn().mockResolvedValue(undefined);
    const client = { pages: { create, update } } as any;
    const writer = new NotionWriter(client, 'db', false, new Set(['Comms']));
    const maps = stubMaps();

    // positiveComms no longer set → signature changes, update must clear the cell.
    const g = game('gep-4');
    const exporter = new NotionExporter(writer, maps, outbox);
    const result = await exporter.export([g]);

    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0].properties['Comms']).toEqual({ select: null });
    expect(create).not.toHaveBeenCalled();
    expect(result.updated).toBe(1);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('idempotency: two syncs with no local change → second sync writes 0 updates', async () => {
    const dir = tmpDir();
    const outbox = new OutboxStore(dir);
    const create = vi.fn().mockResolvedValue({ id: 'page-a' });
    const update = vi.fn().mockResolvedValue(undefined);
    const client = { pages: { create, update } } as any;
    const writer = new NotionWriter(client, 'db', false, new Set(['Comms', 'Improvement Target']));
    const maps = stubMaps();

    const g = game('gep-5', { review: review({ 't-1': 'hit' }, { positiveComms: true }) });
    const exporter = new NotionExporter(writer, maps, outbox, undefined, () => new Set(['t-1']));

    const first = await exporter.export([g]);
    expect(first.ok).toBe(1);

    const second = await exporter.export([g]);
    expect(second).toEqual({ ok: 0, failed: 0, skipped: 1, updated: 0, recreated: 0 });
    expect(update).not.toHaveBeenCalled();

    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('NotionExporter — page-gone recreate', () => {
  function apiError(code: APIErrorCode) {
    return new APIResponseError({
      code,
      status: code === APIErrorCode.ObjectNotFound ? 404 : 400,
      message: 'gone',
      headers: {} as any,
      rawBodyText: '',
      additional_data: undefined,
      request_id: undefined,
    });
  }

  it('object_not_found (permanently deleted/unshared) → recreates, recreated:1', async () => {
    const dir = tmpDir();
    const outbox = new OutboxStore(dir);
    outbox.recordExport('gep-6', { pageId: 'gone-page', signature: JSON.stringify({ grade: null, flags: [] }) });
    const update = vi.fn().mockRejectedValue(apiError(APIErrorCode.ObjectNotFound));
    const create = vi.fn().mockResolvedValue({ id: 'recreated-page' });
    const client = { pages: { create, update } } as any;
    const writer = new NotionWriter(client, 'db', false, new Set(['Comms']));
    const maps = stubMaps();

    const g = game('gep-6', { mental: { positiveComms: true } });
    const exporter = new NotionExporter(writer, maps, outbox);
    const result = await exporter.export([g]);

    expect(create).toHaveBeenCalledTimes(1);
    expect(result.recreated).toBe(1);
    expect(outbox.pageIdFor('gep-6')).toBe('recreated-page');

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('validation_error + retrieve reports in_trash:true (archived/UI-deleted row) → recreates, recreated:1', async () => {
    const dir = tmpDir();
    const outbox = new OutboxStore(dir);
    outbox.recordExport('gep-7', { pageId: 'trashed-page', signature: JSON.stringify({ grade: null, flags: [] }) });
    const update = vi.fn().mockRejectedValue(apiError(APIErrorCode.ValidationError));
    const create = vi.fn().mockResolvedValue({ id: 'recreated-page-2' });
    const retrieve = vi.fn().mockResolvedValue({ in_trash: true });
    const client = { pages: { create, update, retrieve } } as any;
    const writer = new NotionWriter(client, 'db', false, new Set(['Comms']));
    const maps = stubMaps();

    const g = game('gep-7', { mental: { positiveComms: true } });
    const exporter = new NotionExporter(
      writer, maps, outbox, undefined, () => new Set(), { client, gametrackerDatabaseId: 'db' },
    );
    const result = await exporter.export([g]);

    expect(retrieve).toHaveBeenCalledWith({ page_id: 'trashed-page' });
    expect(create).toHaveBeenCalledTimes(1);
    expect(result.recreated).toBe(1);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('validation_error on a live page (e.g. bad property) → failed, no recreate', async () => {
    const dir = tmpDir();
    const outbox = new OutboxStore(dir);
    outbox.recordExport('gep-8', { pageId: 'live-page', signature: JSON.stringify({ grade: null, flags: [] }) });
    const update = vi.fn().mockRejectedValue(apiError(APIErrorCode.ValidationError));
    const create = vi.fn();
    const retrieve = vi.fn().mockResolvedValue({ in_trash: false, archived: false });
    const client = { pages: { create, update, retrieve } } as any;
    const writer = new NotionWriter(client, 'db', false, new Set(['Comms']));
    const maps = stubMaps();

    const g = game('gep-8', { mental: { positiveComms: true } });
    const exporter = new NotionExporter(
      writer, maps, outbox, undefined, () => new Set(), { client, gametrackerDatabaseId: 'db' },
    );
    const result = await exporter.export([g]);

    expect(create).not.toHaveBeenCalled();
    expect(result.failed).toBe(1);
    expect(result.recreated).toBe(0);

    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('NotionExporter — legacy backfill', () => {
  it('legacy processed row: hand row (empty Match ID) found by scan → updateMatchPage once + stamped, createMatchPage not, updated:1, ledger recorded (AC3)', async () => {
    const dir = tmpDir();
    const outbox = new OutboxStore(dir);
    // Simulate a pre-ledger outbox.json: only the old processed[] list, no records.
    fs.writeFileSync(path.join(dir, 'outbox.json'), JSON.stringify({ processed: ['manual-notion-abc123abc123abc123abc123abc123ab'] }));
    const reloaded = new OutboxStore(dir);

    const create = vi.fn();
    const update = vi.fn().mockResolvedValue(undefined);
    // The scan returns the id-less hand row this legacy id derives from: no
    // `Match ID` rich_text at all — the old per-id filter-query mock shape is
    // retired along with `findLegacyPage`.
    const query = vi.fn().mockResolvedValue({
      results: [{ id: 'abc123ab-c123-abc1-23ab-c123abc123ab', properties: {} }],
      has_more: false,
      next_cursor: null,
    });
    const client = { pages: { create, update }, dataSources: { query } } as any;
    const writer = new NotionWriter(client, 'db', false, new Set(['Comms']));
    const maps = stubMaps();

    // Reviewed offline since the legacy export: carries a positiveComms flag now.
    const g = game('manual-notion-abc123abc123abc123abc123abc123ab', { mental: { positiveComms: true } });
    const exporter = new NotionExporter(
      writer, maps, reloaded, undefined, () => new Set(), { client, gametrackerDatabaseId: 'db', dataSourceId: 'db-ds' },
    );
    const result = await exporter.export([g]);

    expect(update).toHaveBeenCalledTimes(1);
    const updateCall = update.mock.calls[0][0];
    expect(updateCall.page_id).toBe('abc123ab-c123-abc1-23ab-c123abc123ab');
    // Adoption heals the id-less hand row: the update payload stamps Match ID.
    expect(updateCall.properties['Match ID']).toEqual({
      rich_text: [{ text: { content: 'manual-notion-abc123abc123abc123abc123abc123ab' } }],
    });
    expect(create).not.toHaveBeenCalled();
    expect(result.updated).toBe(1);
    expect(reloaded.pageIdFor('manual-notion-abc123abc123abc123abc123abc123ab')).toBe('abc123ab-c123-abc1-23ab-c123abc123ab');
    expect(reloaded.signatureFor('manual-notion-abc123abc123abc123abc123abc123ab')).toBe(
      JSON.stringify({ grade: null, flags: ['positiveComms'] }),
    );

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('legacy processed row: scan finds nothing relevant → createMatchPage called, recreated:1', async () => {
    const dir = tmpDir();
    const outbox = new OutboxStore(dir);
    fs.writeFileSync(path.join(dir, 'outbox.json'), JSON.stringify({ processed: ['gep-legacy-2'] }));
    const reloaded = new OutboxStore(dir);

    const create = vi.fn().mockResolvedValue({ id: 'new-legacy-page' });
    const update = vi.fn();
    const query = vi.fn().mockResolvedValue({ results: [], has_more: false, next_cursor: null });
    const client = { pages: { create, update }, dataSources: { query } } as any;
    const writer = new NotionWriter(client, 'db', false, new Set(['Comms']));
    const maps = stubMaps();

    const g = game('gep-legacy-2');
    const exporter = new NotionExporter(
      writer, maps, reloaded, undefined, () => new Set(), { client, gametrackerDatabaseId: 'db', dataSourceId: 'db-ds' },
    );
    const result = await exporter.export([g]);

    expect(create).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
    expect(result.recreated).toBe(1);
    expect(reloaded.pageIdFor('gep-legacy-2')).toBe('new-legacy-page');

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('legacy processed row whose page already carries Match ID text → updated in place, no stamp', async () => {
    const dir = tmpDir();
    const outbox = new OutboxStore(dir);
    fs.writeFileSync(path.join(dir, 'outbox.json'), JSON.stringify({ processed: ['gep-legacy-texted'] }));
    const reloaded = new OutboxStore(dir);

    const create = vi.fn();
    const update = vi.fn().mockResolvedValue(undefined);
    const query = vi.fn().mockResolvedValue({
      results: [{
        id: 'found-page-texted',
        properties: { 'Match ID': { rich_text: [{ plain_text: 'gep-legacy-texted' }] } },
      }],
      has_more: false,
      next_cursor: null,
    });
    const client = { pages: { create, update }, dataSources: { query } } as any;
    const writer = new NotionWriter(client, 'db', false, new Set(['Comms']));
    const maps = stubMaps();

    const g = game('gep-legacy-texted', { mental: { positiveComms: true } });
    const exporter = new NotionExporter(
      writer, maps, reloaded, undefined, () => new Set(), { client, gametrackerDatabaseId: 'db', dataSourceId: 'db-ds' },
    );
    const result = await exporter.export([g]);

    expect(update).toHaveBeenCalledTimes(1);
    const updateCall = update.mock.calls[0][0];
    expect(updateCall.page_id).toBe('found-page-texted');
    expect(updateCall.properties).not.toHaveProperty('Match ID');
    expect(create).not.toHaveBeenCalled();
    expect(result.updated).toBe(1);

    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('NotionExporter — create-guard (no blind creates for unledgered matches)', () => {
  it('AC4: unledgered manual-notion match found by its embedded page id (id-less row) → adopted (update, no create), stamped', async () => {
    const dir = tmpDir();
    const outbox = new OutboxStore(dir); // no ledger record at all — as after ledger loss
    const matchId = 'manual-notion-abc123abc123abc123abc123abc123ab';
    const pageId = 'abc123ab-c123-abc1-23ab-c123abc123ab';

    const create = vi.fn();
    const update = vi.fn().mockResolvedValue(undefined);
    // Scan returns the hand row this id derives from, with an empty Match ID cell.
    const query = vi.fn().mockResolvedValue({ results: [{ id: pageId, properties: {} }], has_more: false, next_cursor: null });
    const client = { pages: { create, update }, dataSources: { query } } as any;
    const writer = new NotionWriter(client, 'db', false, new Set(['Comms']));
    const maps = stubMaps();

    const g = game(matchId, { mental: { positiveComms: true } });
    const exporter = new NotionExporter(
      writer, maps, outbox, undefined, () => new Set(), { client, gametrackerDatabaseId: 'db', dataSourceId: 'db-ds' },
    );
    const result = await exporter.export([g]);

    expect(create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
    const updateCall = update.mock.calls[0][0];
    expect(updateCall.page_id).toBe(pageId);
    expect(updateCall.properties['Match ID']).toEqual({ rich_text: [{ text: { content: matchId } }] });
    expect(result.updated).toBe(1);
    expect(result.ok).toBe(0);
    expect(outbox.pageIdFor(matchId)).toBe(pageId);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('AC5: unledgered GEP match found by Match ID text → adopted (update, no create), NOT stamped', async () => {
    const dir = tmpDir();
    const outbox = new OutboxStore(dir); // no ledger record — as after ledger loss
    const matchId = 'gep-lost-1';
    const pageId = 'existing-gep-page';

    const create = vi.fn();
    const update = vi.fn().mockResolvedValue(undefined);
    const query = vi.fn().mockResolvedValue({
      results: [{ id: pageId, properties: { 'Match ID': { rich_text: [{ plain_text: matchId }] } } }],
      has_more: false,
      next_cursor: null,
    });
    const client = { pages: { create, update }, dataSources: { query } } as any;
    const writer = new NotionWriter(client, 'db', false, new Set(['Comms']));
    const maps = stubMaps();

    const g = game(matchId, { mental: { positiveComms: true } });
    const exporter = new NotionExporter(
      writer, maps, outbox, undefined, () => new Set(), { client, gametrackerDatabaseId: 'db', dataSourceId: 'db-ds' },
    );
    const result = await exporter.export([g]);

    expect(create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
    const updateCall = update.mock.calls[0][0];
    expect(updateCall.page_id).toBe(pageId);
    expect(updateCall.properties).not.toHaveProperty('Match ID'); // already had text — not re-stamped
    expect(result.updated).toBe(1);
    expect(outbox.pageIdFor(matchId)).toBe(pageId);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('adopting an id-less row with NOTHING to push (empty signature) only stamps Match ID — never blanks the row\'s subjective cells', async () => {
    const dir = tmpDir();
    const outbox = new OutboxStore(dir); // ledger lost — the spec\'s motivating case
    const matchId = 'manual-notion-abc123abc123abc123abc123abc123ab';
    const pageId = 'abc123ab-c123-abc1-23ab-c123abc123ab';

    const create = vi.fn();
    const update = vi.fn().mockResolvedValue(undefined);
    const query = vi.fn().mockResolvedValue({ results: [{ id: pageId, properties: {} }], has_more: false, next_cursor: null });
    const client = { pages: { create, update }, dataSources: { query } } as any;
    // Comms/Tilt writable — exactly the columns updateMatchPage\'s forUpdate
    // contract would blank (`select: null` / `checkbox: false`) and destroy the
    // user\'s hand-filled values on a row the app has never written to.
    const writer = new NotionWriter(client, 'db', false, new Set(['Comms', 'Tilt']));
    const maps = stubMaps();

    const g = game(matchId); // no review, no mental → EMPTY export signature
    const exporter = new NotionExporter(
      writer, maps, outbox, undefined, () => new Set(), { client, gametrackerDatabaseId: 'db', dataSourceId: 'db-ds' },
    );
    const result = await exporter.export([g]);

    expect(create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
    const props = update.mock.calls[0][0].properties;
    // The stamp-only write: Match ID and NOTHING else — no blanked selects/checkboxes.
    expect(Object.keys(props)).toEqual(['Match ID']);
    expect(props['Match ID']).toEqual({ rich_text: [{ text: { content: matchId } }] });
    expect(result).toEqual({ ok: 1, failed: 0, skipped: 0, updated: 0, recreated: 0 });
    expect(outbox.pageIdFor(matchId)).toBe(pageId);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('adopting a texted row with nothing to push writes nothing at all — ledger baseline only', async () => {
    const dir = tmpDir();
    const outbox = new OutboxStore(dir);
    const matchId = 'gep-lost-empty';
    const pageId = 'existing-gep-page-2';

    const create = vi.fn();
    const update = vi.fn();
    const query = vi.fn().mockResolvedValue({
      results: [{ id: pageId, properties: { 'Match ID': { rich_text: [{ plain_text: matchId }] } } }],
      has_more: false,
      next_cursor: null,
    });
    const client = { pages: { create, update }, dataSources: { query } } as any;
    const writer = new NotionWriter(client, 'db', false, new Set(['Comms']));
    const maps = stubMaps();

    const g = game(matchId); // empty signature, row already self-identifying
    const exporter = new NotionExporter(
      writer, maps, outbox, undefined, () => new Set(), { client, gametrackerDatabaseId: 'db', dataSourceId: 'db-ds' },
    );
    const result = await exporter.export([g]);

    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: 1, failed: 0, skipped: 0, updated: 0, recreated: 0 });
    expect(outbox.pageIdFor(matchId)).toBe(pageId);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('AC6: nothing found in the scan → createPage runs as today', async () => {
    const dir = tmpDir();
    const outbox = new OutboxStore(dir);
    const create = vi.fn().mockResolvedValue({ id: 'brand-new-page' });
    const update = vi.fn();
    const query = vi.fn().mockResolvedValue({ results: [], has_more: false, next_cursor: null });
    const client = { pages: { create, update }, dataSources: { query } } as any;
    const writer = new NotionWriter(client, 'db', false, new Set(['Comms']));
    const maps = stubMaps();

    const g = game('gep-genuinely-new');
    const exporter = new NotionExporter(
      writer, maps, outbox, undefined, () => new Set(), { client, gametrackerDatabaseId: 'db', dataSourceId: 'db-ds' },
    );
    const result = await exporter.export([g]);

    expect(create).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
    expect(result.ok).toBe(1);
    expect(outbox.pageIdFor('gep-genuinely-new')).toBe('brand-new-page');

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('the scan runs at most once per export() call, even across several unledgered games', async () => {
    const dir = tmpDir();
    const outbox = new OutboxStore(dir);
    const create = vi.fn().mockResolvedValue({ id: 'p-new' });
    const update = vi.fn().mockResolvedValue(undefined);
    const query = vi.fn().mockResolvedValue({ results: [], has_more: false, next_cursor: null });
    const client = { pages: { create, update }, dataSources: { query } } as any;
    const writer = new NotionWriter(client, 'db', false, new Set(['Comms']));
    const maps = stubMaps();

    const games = [game('gep-multi-1'), game('gep-multi-2'), game('gep-multi-3')];
    const exporter = new NotionExporter(
      writer, maps, outbox, undefined, () => new Set(), { client, gametrackerDatabaseId: 'db', dataSourceId: 'db-ds' },
    );
    const result = await exporter.export(games);

    // One page of results ⇒ the loop's pagination call count is exactly the
    // number of pages fetched, not one per game — the scan itself runs once.
    expect(query).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(3);
    expect(result.ok).toBe(3);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('the index is rebuilt on a second export() call, not reused stale from the first', async () => {
    const dir = tmpDir();
    const outbox = new OutboxStore(dir);
    const create = vi.fn().mockResolvedValue({ id: 'p-new' });
    const update = vi.fn();
    const query = vi.fn().mockResolvedValue({ results: [], has_more: false, next_cursor: null });
    const client = { pages: { create, update }, dataSources: { query } } as any;
    const writer = new NotionWriter(client, 'db', false, new Set(['Comms']));
    const maps = stubMaps();

    const exporter = new NotionExporter(
      writer, maps, outbox, undefined, () => new Set(), { client, gametrackerDatabaseId: 'db', dataSourceId: 'db-ds' },
    );

    await exporter.export([game('gep-call-1')]);
    await exporter.export([game('gep-call-2')]);

    // Each export() call gets its own fresh scan — two calls, two scans.
    expect(query).toHaveBeenCalledTimes(2);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('AC12: ledgered + unchanged signature → skipped, the scan is never run', async () => {
    const dir = tmpDir();
    const outbox = new OutboxStore(dir);
    const emptySig = JSON.stringify({ grade: null, flags: [] });
    outbox.recordExport('gep-unchanged', { pageId: 'page-unchanged', signature: emptySig });

    const create = vi.fn();
    const update = vi.fn();
    const query = vi.fn().mockResolvedValue({ results: [], has_more: false, next_cursor: null });
    const client = { pages: { create, update }, dataSources: { query } } as any;
    const writer = new NotionWriter(client, 'db', false, new Set(['Comms']));
    const maps = stubMaps();

    const g = game('gep-unchanged');
    const exporter = new NotionExporter(
      writer, maps, outbox, undefined, () => new Set(), { client, gametrackerDatabaseId: 'db', dataSourceId: 'db-ds' },
    );
    const result = await exporter.export([g]);

    expect(result).toEqual({ ok: 0, failed: 0, skipped: 1, updated: 0, recreated: 0 });
    expect(query).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('no legacyLookup supplied → the guard is skipped entirely, blind-creates as before (documented degradation)', async () => {
    const dir = tmpDir();
    const outbox = new OutboxStore(dir);
    const writer = stubWriter();
    const maps = stubMaps();

    // No legacyLookup argument at all.
    const exporter = new NotionExporter(writer, maps, outbox);
    const result = await exporter.export([game('gep-no-lookup')]);

    expect(writer.createMatchPage).toHaveBeenCalledTimes(1);
    expect(writer.updateMatchPage).not.toHaveBeenCalled();
    expect(result.ok).toBe(1);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('scan failure on an unledgered match → counted as failed, never falls back to create (a duplicate is worse than a retryable failure)', async () => {
    const dir = tmpDir();
    const outbox = new OutboxStore(dir);
    const create = vi.fn();
    const update = vi.fn();
    const query = vi.fn().mockRejectedValue(new Error('network error'));
    const client = { pages: { create, update }, dataSources: { query } } as any;
    const writer = new NotionWriter(client, 'db', false, new Set(['Comms']));
    const maps = stubMaps();

    const g = game('gep-scan-fails');
    const exporter = new NotionExporter(
      writer, maps, outbox, undefined, () => new Set(), { client, gametrackerDatabaseId: 'db', dataSourceId: 'db-ds' },
    );
    const result = await exporter.export([g]);

    expect(create).not.toHaveBeenCalled();
    expect(result.failed).toBe(1);
    expect(result.ok).toBe(0);

    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('NotionExporter — progress tick accounting', () => {
  it('tick includes updated+recreated, so an update-heavy sync reaches done === total by the last tick', async () => {
    const dir = tmpDir();
    const outbox = new OutboxStore(dir);
    const emptySig = JSON.stringify({ grade: null, flags: [] });
    outbox.recordExport('gep-u1', { pageId: 'p1', signature: emptySig });
    outbox.recordExport('gep-u2', { pageId: 'p2', signature: emptySig });
    const writer = stubWriter();
    const maps = stubMaps();

    // Both matches changed since their last export (positiveComms now set) →
    // both land in `updated`, not `ok`/`failed`/`skipped`.
    const g1 = game('gep-u1', { mental: { positiveComms: true } });
    const g2 = game('gep-u2', { mental: { positiveComms: true } });
    const exporter = new NotionExporter(writer, maps, outbox);

    const ticks: Array<{ done: number; total: number }> = [];
    const result = await exporter.export([g1, g2], (done, total) => ticks.push({ done, total }));

    expect(result.updated).toBe(2);
    expect(ticks).toHaveLength(2);
    // Progress must advance on each tick and finish at done === total, not
    // stall at 0 because "updated" outcomes were excluded from the tally.
    expect(ticks[0]).toEqual({ done: 1, total: 2 });
    expect(ticks[1]).toEqual({ done: 2, total: 2 });

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('a legacy-backfilled match is not reprocessed (or re-ticked) by the main loop — no double-count', async () => {
    const dir = tmpDir();
    const outbox = new OutboxStore(dir);
    fs.writeFileSync(path.join(dir, 'outbox.json'), JSON.stringify({ processed: ['gep-legacy-3'] }));
    const reloaded = new OutboxStore(dir);

    const create = vi.fn().mockResolvedValue({ id: 'fresh-page-1' });
    const update = vi.fn().mockResolvedValue(undefined);
    const query = vi.fn().mockResolvedValue({
      results: [{ id: 'found-page-3', properties: { 'Match ID': { rich_text: [{ plain_text: 'gep-legacy-3' }] } } }],
      has_more: false,
      next_cursor: null,
    });
    const client = { pages: { create, update }, dataSources: { query } } as any;
    const writer = new NotionWriter(client, 'db', false, new Set(['Comms']));
    const maps = stubMaps();

    // A second, ordinary (non-legacy) match tracked alongside it.
    const legacyGame = game('gep-legacy-3', { mental: { positiveComms: true } });
    const freshGame = game('gep-fresh-1');
    const exporter = new NotionExporter(
      writer, maps, reloaded, undefined, () => new Set(), { client, gametrackerDatabaseId: 'db', dataSourceId: 'db-ds' },
    );

    const ticks: Array<{ done: number; total: number }> = [];
    const result = await exporter.export([legacyGame, freshGame], (done, total) => ticks.push({ done, total }));

    // total is games actually attempted (2), not games.length + legacyProcessed().length (3).
    expect(ticks.every((t) => t.total === 2)).toBe(true);
    expect(ticks).toHaveLength(2);
    expect(ticks.at(-1)).toEqual({ done: 2, total: 2 });
    // The legacy match was resolved exactly once (by the backfill); the main
    // loop must not touch it a second time.
    expect(update).toHaveBeenCalledTimes(1);
    expect(result.updated).toBe(1); // legacy-3's backfill outcome
    expect(result.ok).toBe(1); // fresh-1's ordinary create
    expect(create).toHaveBeenCalledTimes(1);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('a legacy id with no matching game is not attempted and does not inflate total', async () => {
    const dir = tmpDir();
    const outbox = new OutboxStore(dir);
    // 'gep-gone' was legacy-processed but is no longer in the tracked set at all.
    fs.writeFileSync(path.join(dir, 'outbox.json'), JSON.stringify({ processed: ['gep-gone'] }));
    const reloaded = new OutboxStore(dir);
    const writer = stubWriter();
    const maps = stubMaps();

    const g = game('gep-only');
    const exporter = new NotionExporter(writer, maps, reloaded);

    const ticks: Array<{ done: number; total: number }> = [];
    const result = await exporter.export([g], (done, total) => ticks.push({ done, total }));

    // total reflects only the one game actually attempted, not 1 + 1 (the
    // phantom legacy id that was never ticked).
    expect(ticks).toHaveLength(1);
    expect(ticks[0]).toEqual({ done: 1, total: 1 });
    expect(result.ok).toBe(1);

    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('NotionExporter — ledger database affinity', () => {
  it('a ledger record from the previously-configured database is not reused after switching databases: creates fresh + re-stamps', async () => {
    const dir = tmpDir();
    const outbox = new OutboxStore(dir);
    // Exported into the OLD database.
    outbox.recordExport('gep-db1', { pageId: 'old-db-page', signature: 'old-sig', databaseId: 'db-old' });
    const writer = stubWriter();
    const maps = stubMaps();

    // Exporter now configured against the NEW database.
    const exporter = new NotionExporter(writer, maps, outbox, undefined, undefined, undefined, 'db-new');
    const g = game('gep-db1');
    const result = await exporter.export([g]);

    // Must NOT update the old database's page — must create fresh in the new one.
    expect(writer.updateMatchPage).not.toHaveBeenCalled();
    expect(writer.createMatchPage).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(1);
    expect(result.updated).toBe(0);

    // The ledger record is re-stamped with the new database and the new page id.
    expect(outbox.pageIdFor('gep-db1', 'db-new')).toBe('new-page-id');
    expect(outbox.pageIdFor('gep-db1', 'db-old')).toBeUndefined();

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('a ledger record with no stamped databaseId (pre-migration) still updates in place against the current database', async () => {
    const dir = tmpDir();
    const outbox = new OutboxStore(dir);
    // Pre-migration record: no databaseId at all.
    outbox.recordExport('gep-legacy-db', { pageId: 'existing-page', signature: JSON.stringify({ grade: null, flags: [] }) });
    const writer = stubWriter();
    const maps = stubMaps();

    const exporter = new NotionExporter(writer, maps, outbox, undefined, undefined, undefined, 'db-current');
    const g = game('gep-legacy-db', { mental: { positiveComms: true } }); // content changed → update path
    const result = await exporter.export([g]);

    expect(writer.updateMatchPage).toHaveBeenCalledWith('existing-page', expect.anything());
    expect(writer.createMatchPage).not.toHaveBeenCalled();
    expect(result.updated).toBe(1);
    // Now stamped with the current database on this write.
    expect(outbox.pageIdFor('gep-legacy-db', 'db-current')).toBe('existing-page');

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('same database on every sync → ordinary update-in-place behavior is unaffected', async () => {
    const dir = tmpDir();
    const outbox = new OutboxStore(dir);
    outbox.recordExport('gep-same-db', { pageId: 'stable-page', signature: 'old-sig', databaseId: 'db-1' });
    const writer = stubWriter();
    const maps = stubMaps();

    const exporter = new NotionExporter(writer, maps, outbox, undefined, undefined, undefined, 'db-1');
    const g = game('gep-same-db', { mental: { positiveComms: true } });
    const result = await exporter.export([g]);

    expect(writer.updateMatchPage).toHaveBeenCalledWith('stable-page', expect.anything());
    expect(writer.createMatchPage).not.toHaveBeenCalled();
    expect(result.updated).toBe(1);

    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('NotionWriter — Played At round-trip', () => {
  it('carries the match end time so a Played At-capable database round-trips it', () => {
    const rec = gameToMatchRecord(game('m1', { timestamp: Date.parse('2026-05-01T12:34:00.000Z') }));
    expect(rec.endedAt).toBe(Date.parse('2026-05-01T12:34:00.000Z'));
  });

  it('writes Played At when the database has the column', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'page-id' });
    const client = { pages: { create } } as any;
    const writer = new NotionWriter(client, 'db', true);
    await writer.createMatchPage({ record: gameToMatchRecord(game('m1', { timestamp: Date.parse('2026-05-01T12:34:00.000Z') })) });
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
    expect(exportMental(g)).toEqual({ tilt: true, comms: 'positive', leaverMyTeam: true });
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
    const g = game('gep-777', { timestamp: Date.parse('2026-05-01T12:00:00.000Z') });
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
    expect(back.mental).toMatchObject({ comms: 'positive', tilt: true, leaverMyTeam: true });
    expect(back.review?.grades[NOTION_IMPROVEMENT_TARGET_ID]).toBe('partial');
  });

  it('round-trips SR delta and final score, and drops local-only fields', async () => {
    const { create, client } = captureCreate();
    create.mockResolvedValue({ id: 'created-page' });
    const writer = new NotionWriter(client, 'gt-db', true, SUBJECTIVE, true); // hasSrDelta = true
    const g = {
      ...game('gep-778', { timestamp: Date.parse('2026-05-02T09:00:00.000Z') }),
      srDelta: -19,
      finalScore: '2-1',
      // Documented local-only fields that must NOT survive the round-trip.
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

describe('NotionExporter — captures the first per-game failure reason (no silent "0 synced, N failed")', () => {
  it('classifies an offline failure and exposes a friendly, non-String(err) reason while still counting every failure', async () => {
    const dir = tmpDir();
    const outbox = new OutboxStore(dir);
    const create = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    const client = { pages: { create } } as any;
    const writer = new NotionWriter(client, 'db', false, new Set());
    const maps = stubMaps();

    const games = [game('g1'), game('g2'), game('g3')];
    const exporter = new NotionExporter(writer, maps, outbox);
    const result = await exporter.export(games);

    // The loop keeps going — every game is still counted as failed, not
    // silently abandoned after the first error.
    expect(result.failed).toBe(3);
    expect(result.ok).toBe(0);
    // The reason rides the existing `error` channel (same one the pre-loop
    // shape-mismatch short-circuit uses), classified and friendly.
    expect(result.error).not.toContain('TypeError');
    expect(result.error).not.toContain('fetch failed');
    expect(result.error).toMatch(/internet connection/i);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('keeps the FIRST failure\'s reason even when a later failure is a different kind', async () => {
    const dir = tmpDir();
    const outbox = new OutboxStore(dir);
    const create = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed')) // g1: offline
      .mockRejectedValueOnce(Object.assign(new Error('denied'), { status: 401, code: 'unauthorized' })); // g2: auth
    const client = { pages: { create } } as any;
    const writer = new NotionWriter(client, 'db', false, new Set());
    const maps = stubMaps();

    const games = [game('g1'), game('g2')];
    const exporter = new NotionExporter(writer, maps, outbox);
    const result = await exporter.export(games);

    expect(result.failed).toBe(2);
    // Still the first (offline) reason, not overwritten by the second (auth) one.
    expect(result.error).toMatch(/internet connection/i);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('a successful export alongside a failed one still reports the failure reason without hiding the successes', async () => {
    const dir = tmpDir();
    const outbox = new OutboxStore(dir);
    const create = vi
      .fn()
      .mockResolvedValueOnce({ id: 'page-ok' })
      .mockRejectedValueOnce(new TypeError('fetch failed'));
    const client = { pages: { create } } as any;
    const writer = new NotionWriter(client, 'db', false, new Set());
    const maps = stubMaps();

    const games = [game('g-ok'), game('g-fail')];
    const exporter = new NotionExporter(writer, maps, outbox);
    const result = await exporter.export(games);

    expect(result.ok).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.error).toMatch(/internet connection/i);

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
