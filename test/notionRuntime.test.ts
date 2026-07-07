import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// `notionRuntime.ts` reaches the Notion token/config edge through `./config`,
// which itself imports `electron` (safeStorage/app.getPath) — mock the whole
// module so this test drives NotionRuntime without an Electron runtime.
const tokenState = { token: undefined as string | undefined };
vi.mock('../src/main/config', () => ({
  getNotionToken: () => tokenState.token,
  setNotionToken: (t: string) => {
    tokenState.token = t;
  },
  clearNotionToken: () => {
    tokenState.token = undefined;
  },
  saveLocalNotionConfig: vi.fn(),
  notionDatabaseSource: () => 'selected',
}));

// `NotionAdmin.validate` is the network-touching call this runtime caches —
// stub the class so `rebuild()`/`validateConfigured()` run against a fixed
// diagnostics result instead of a real Notion client.
const validateMock = vi.fn();
const ensureColumnsMock = vi.fn();
vi.mock('../src/notion/notionAdmin', () => ({
  NotionAdmin: vi.fn().mockImplementation(function (this: any) {
    this.validate = validateMock;
    this.ensureColumns = ensureColumnsMock;
    this.listDatabases = vi.fn().mockResolvedValue([]);
    this.listParentPages = vi.fn().mockResolvedValue([]);
  }),
}));

// MapsCache.load() is called fire-and-forget from rebuild(); stub it inert.
vi.mock('../src/notion/mapsCache', () => ({
  MapsCache: vi.fn().mockImplementation(function (this: any) {
    this.load = vi.fn().mockResolvedValue(undefined);
    this.resolve = vi.fn().mockResolvedValue({ matched: false });
  }),
}));

// Spy on the exporter's construction — the most direct way to prove
// NotionRuntime threads authored-target ids and the ledger (outbox +
// legacyLookup) into it, without needing a real network-touching export.
const exporterCtor = vi.fn();
vi.mock('../src/notion/notionExporter', () => ({
  NotionExporter: vi.fn().mockImplementation(function (this: any, ...args: any[]) {
    exporterCtor(...args);
    this.export = vi.fn().mockResolvedValue({ ok: 0, failed: 0, skipped: 0 });
  }),
}));

// `cleanupDuplicates()` (and `import()`) call real `@notionhq/client` methods
// (`pages.update`, `dataSources.query`) on `this.client` — mock the SDK's
// `Client` class so those calls hit test doubles instead of the network.
// `notionImporter`/`notionExporter` are separately mocked above, so this only
// needs to satisfy `NotionRuntime`'s own direct client usage.
const clientMocks = {
  pagesUpdate: vi.fn().mockResolvedValue(undefined),
  dataSourcesQuery: vi.fn().mockResolvedValue({ results: [], has_more: false, next_cursor: null }),
  databasesRetrieve: vi.fn().mockResolvedValue({ data_sources: [{ id: 'src-1' }] }),
  // `NotionImporter.discoverMapsSourceId` reads this off the Gametracker schema;
  // `{ type: 'rich_text' }` (not a relation) makes discovery a no-op, matching
  // these fixtures' unrelated `Map` column.
  dataSourcesRetrieve: vi.fn().mockResolvedValue({ properties: { Map: { type: 'rich_text' } } }),
};
vi.mock('@notionhq/client', () => ({
  Client: vi.fn().mockImplementation(function (this: any) {
    this.pages = { update: clientMocks.pagesUpdate };
    this.dataSources = { query: clientMocks.dataSourcesQuery, retrieve: clientMocks.dataSourcesRetrieve };
    this.databases = { retrieve: clientMocks.databasesRetrieve };
  }),
}));

import { NotionRuntime, type NotionRuntimeDeps } from '../src/main/notionRuntime';
import { OutboxStore } from '../src/store/outbox';
import type { SubjectiveColumnDiag } from '../src/shared/contract';

/** A minimal Gametracker row for dedup/cleanup fixtures — mirrors `dedup.ts`'s `rowRefOf` projection. */
function row(id: string, opts: { matchId?: string; createdTime?: string } = {}) {
  return {
    id,
    created_time: opts.createdTime ?? '2024-01-01T00:00:00.000Z',
    properties: {
      'Match ID': { rich_text: opts.matchId ? [{ plain_text: opts.matchId }] : [] },
    },
  };
}

/** A full Gametracker row `NotionImporter` can map into a game — minimal but importable. */
function importerRow(id: string, opts: { matchId?: string; createdTime?: string } = {}) {
  return {
    id,
    created_time: opts.createdTime ?? '2024-01-01T00:00:00.000Z',
    properties: {
      Result: { select: { name: 'Win' } },
      Role: { select: { name: 'damage' } },
      Map: { relation: [] },
      Account: { select: null },
      'Hero(es) Played': { multi_select: [] },
      'Game Type': { select: null },
      'Match ID': { rich_text: opts.matchId ? [{ plain_text: opts.matchId }] : [] },
      'Played At': { type: 'date', date: null },
      Name: { title: [] },
      Leaver: { type: 'select', select: null },
      Tilt: { type: 'checkbox', checkbox: false },
      'Toxic Mates': { type: 'checkbox', checkbox: false },
      Comms: { type: 'select', select: null },
      'Improvement Target': { type: 'select', select: null },
    },
  };
}

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'notion-runtime-'));
}

function baseDeps(overrides: Partial<NotionRuntimeDeps> = {}): NotionRuntimeDeps {
  const outbox = new OutboxStore(tmpDir());
  return {
    outbox,
    config: () => ({
      notion: { gametrackerDatabaseId: 'db-1', mapsDatabaseId: '', gametrackerUrl: '' },
      mapAliases: {},
    }) as any,
    reloadConfig: vi.fn(),
    trackedGames: () => 0,
    importedMatches: () => 0,
    onTokenState: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  tokenState.token = undefined;
  validateMock.mockReset();
  ensureColumnsMock.mockReset().mockResolvedValue([]);
  exporterCtor.mockReset();
  clientMocks.pagesUpdate.mockReset().mockResolvedValue(undefined);
  clientMocks.dataSourcesQuery.mockReset().mockResolvedValue({ results: [], has_more: false, next_cursor: null });
  clientMocks.databasesRetrieve.mockReset().mockResolvedValue({ data_sources: [{ id: 'src-1' }] });
  clientMocks.dataSourcesRetrieve.mockReset().mockResolvedValue({ properties: { Map: { type: 'rich_text' } } });
});

/** Build + `rebuild()` a runtime with a token, validated so `gametrackerSourceId` is cached
 *  (lets cleanup/import page directly via `dataSources.query` without a `databases.retrieve` hop). */
async function connectedRuntime(deps: Partial<NotionRuntimeDeps> = {}): Promise<NotionRuntime> {
  validateMock.mockResolvedValue({
    ok: true, missing: [], mismatched: [], title: 'Gametracker',
    hasPlayedAt: false, hasSrDelta: false,
    subjectiveColumns: [], subjectiveColumnDiagnostics: [],
    mapRelationDbId: undefined,
    dataSourceId: 'src-1',
    provisionPlan: { toCreate: {}, blocked: [] },
  });
  const runtime = new NotionRuntime(baseDeps(deps));
  tokenState.token = 'secret-token';
  runtime.rebuild();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  return runtime;
}

describe('NotionRuntime — diagnostics cache reaches status()', () => {
  it('caches validate()\'s subjectiveColumnDiagnostics and surfaces them on status()', async () => {
    const diagnostics: SubjectiveColumnDiag[] = [
      { column: 'Comms', status: 'available' },
      { column: 'Improvement Target', status: 'wrong-type', actualType: 'rich_text' },
      { column: 'Leaver', status: 'near-miss', actualName: 'leaver ' },
      { column: 'Tilt', status: 'missing' },
      { column: 'Toxic Mates', status: 'missing' },
    ];
    validateMock.mockResolvedValue({
      ok: true, missing: [], mismatched: [], title: 'Gametracker',
      hasPlayedAt: true, hasSrDelta: true,
      subjectiveColumns: ['Comms'],
      subjectiveColumnDiagnostics: diagnostics,
      mapRelationDbId: undefined,
      dataSourceId: 'src-1',
      provisionPlan: { toCreate: {}, blocked: [] },
    });

    const runtime = new NotionRuntime(baseDeps());
    tokenState.token = 'secret-token';
    runtime.rebuild();
    // rebuild() kicks off validateConfigured() without awaiting it internally;
    // flush microtasks so the cached result lands before status() reads it.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const status = runtime.status();
    expect(status.subjectiveColumns).toEqual(diagnostics);
    expect(status.shapeValid).toBe(true);
  });

  it('leaves subjectiveColumns undefined when nothing has been validated yet', () => {
    const runtime = new NotionRuntime(baseDeps());
    // No token set → rebuild() short-circuits before ever validating.
    runtime.rebuild();

    const status = runtime.status();
    expect(status.subjectiveColumns).toBeUndefined();
  });
});

describe('NotionRuntime — schema auto-provisioning on validate', () => {
  /** A `NotionAdmin.validate` result with the fields `validateConfigured` reads; override per case. */
  function validateResult(overrides: Record<string, any> = {}) {
    return {
      ok: true, missing: [], mismatched: [], title: 'Gametracker',
      hasPlayedAt: false, hasSrDelta: false,
      subjectiveColumns: [], subjectiveColumnDiagnostics: [],
      mapRelationDbId: undefined, dataSourceId: 'src-1',
      provisionPlan: { toCreate: {}, blocked: [] },
      ...overrides,
    };
  }

  /** Drain the async validate→provision→re-validate chain kicked off (unawaited) by rebuild(). */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  async function run(): Promise<NotionRuntime> {
    const runtime = new NotionRuntime(baseDeps());
    tokenState.token = 'secret-token';
    runtime.rebuild();
    await settle();
    return runtime;
  }

  it('creates missing columns then re-validates so they are writable this session (AC1/AC2)', async () => {
    validateMock
      // First validate: a required column and an optional one are missing, with a plan to add them.
      .mockResolvedValueOnce(validateResult({
        ok: false, missing: ['Result'], hasSrDelta: false,
        provisionPlan: { toCreate: { Result: { select: {} }, 'SR Delta': { number: {} } }, blocked: [] },
      }))
      // Re-validate after provisioning: the schema is now healed.
      .mockResolvedValueOnce(validateResult({ ok: true, hasSrDelta: true, subjectiveColumns: ['Comms'] }));
    ensureColumnsMock.mockResolvedValue(['Result', 'SR Delta']);

    const runtime = await run();

    expect(ensureColumnsMock).toHaveBeenCalledWith('src-1', { Result: { select: {} }, 'SR Delta': { number: {} } });
    expect(validateMock).toHaveBeenCalledTimes(2); // validate → provision → re-validate
    const status = runtime.status();
    expect(status.shapeValid).toBe(true); // no more "Database is missing" — the sync proceeds
    expect(status.schemaProvision).toEqual({ created: ['Result', 'SR Delta'] });
    expect(status.connected).toBe(true);
    // The exporter was rebuilt off the HEALED validation — with no shape issues,
    // so the "Database is missing" short-circuit is disarmed (the mirror of AC5:
    // this proves the heal actually reached buildExporter, not just status).
    expect(exporterCtor).toHaveBeenCalled();
    const [, , , shapeIssuesArg] = exporterCtor.mock.calls.at(-1)!;
    expect(shapeIssuesArg).toBeUndefined();
  });

  it('makes no schema write and no re-validate when the database is already complete (AC3)', async () => {
    validateMock.mockResolvedValue(validateResult()); // empty toCreate

    const runtime = await run();

    expect(ensureColumnsMock).not.toHaveBeenCalled();
    expect(validateMock).toHaveBeenCalledTimes(1);
    expect(runtime.status().schemaProvision).toBeUndefined();
  });

  it('reports a provisioning failure and still builds the exporter for existing columns (AC5)', async () => {
    validateMock.mockResolvedValue(validateResult({
      ok: false, missing: ['Result'],
      provisionPlan: { toCreate: { Result: { select: {} } }, blocked: [] },
    }));
    ensureColumnsMock.mockRejectedValue(new Error('insufficient permissions to edit the schema'));

    const runtime = await run();

    const status = runtime.status();
    expect(status.schemaProvision?.error).toContain('insufficient permissions');
    expect(status.schemaProvision?.created).toEqual([]);
    // Re-validate is never reached (ensureColumns threw) — only the first validate ran.
    expect(validateMock).toHaveBeenCalledTimes(1);
    // No crash: the still-missing required column keeps the shape invalid, but the
    // exporter is built so the sync runs for the columns that do exist.
    expect(status.shapeValid).toBe(false);
    expect(status.shapeIssues).toContain('Result');
    expect(status.connected).toBe(true);
    // The exporter must be built WITH the shape issues (ctor arg 3), so a sync
    // short-circuits ("Database is missing: Result") instead of writing every row
    // against a DB still missing the required column. `status.shapeIssues` alone
    // is read from a different field and does not prove what buildExporter received.
    expect(exporterCtor).toHaveBeenCalled();
    const [, , , shapeIssuesArg] = exporterCtor.mock.calls.at(-1)!;
    expect(shapeIssuesArg).toContain('Result');
  });

  it('does not provision when there is no data source id (nothing to update against)', async () => {
    validateMock.mockResolvedValue(validateResult({
      ok: false, dataSourceId: undefined,
      provisionPlan: { toCreate: { Result: { select: {} } }, blocked: [] },
    }));

    const runtime = await run();

    expect(ensureColumnsMock).not.toHaveBeenCalled();
    expect(validateMock).toHaveBeenCalledTimes(1);
    expect(runtime.status().schemaProvision).toBeUndefined();
  });
});

describe('NotionRuntime — authored ids + ledger reach the exporter', () => {
  it('constructs NotionExporter with the outbox ledger and authoredTargetIds()', async () => {
    validateMock.mockResolvedValue({
      ok: true, missing: [], mismatched: [], title: 'Gametracker',
      hasPlayedAt: false, hasSrDelta: false,
      subjectiveColumns: ['Improvement Target'],
      subjectiveColumnDiagnostics: [],
      mapRelationDbId: undefined,
      dataSourceId: 'src-1',
      provisionPlan: { toCreate: {}, blocked: [] },
    });

    const outbox = new OutboxStore(tmpDir());
    // Pre-seed the ledger so a real exporter would see an existing pageId for
    // this match (Decision A.1: matchId -> pageId persistence reused for
    // `pages.update`) — proves the *same* outbox instance reaches the exporter.
    outbox.recordExport('m1', { pageId: 'existing-page-1', signature: 'old-signature' });

    let authoredTargetIds = new Set(['t-123']);
    const runtime = new NotionRuntime(baseDeps({
      outbox,
      authoredTargetIds: () => authoredTargetIds,
    }));
    tokenState.token = 'secret-token';
    runtime.rebuild();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(exporterCtor).toHaveBeenCalled();
    const [, , outboxArg, , authoredIdsArg, legacyLookupArg, configuredDatabaseIdArg] = exporterCtor.mock.calls.at(-1)!;
    expect(outboxArg).toBe(outbox);
    expect(outboxArg.pageIdFor('m1')).toBe('existing-page-1');
    // authoredIdsArg is a GETTER, not a snapshot — the exporter re-reads it on
    // every export() call, so a target authored after rebuild is still visible.
    expect(typeof authoredIdsArg).toBe('function');
    expect(authoredIdsArg()).toEqual(new Set(['t-123']));
    authoredTargetIds = new Set(['t-123', 't-456']);
    expect(authoredIdsArg()).toEqual(new Set(['t-123', 't-456']));
    expect(legacyLookupArg).toMatchObject({ gametrackerDatabaseId: 'db-1', dataSourceId: 'src-1' });
    // The currently-configured database id reaches the exporter too, so it can
    // detect ledger records left over from a previously-configured database.
    expect(configuredDatabaseIdArg).toBe('db-1');
  });

  it('defaults authoredTargetIds to an empty set when the dep is not wired', async () => {
    validateMock.mockResolvedValue({
      ok: true, missing: [], mismatched: [], title: 'Gametracker',
      hasPlayedAt: false, hasSrDelta: false,
      subjectiveColumns: [],
      subjectiveColumnDiagnostics: [],
      mapRelationDbId: undefined,
      dataSourceId: 'src-1',
      provisionPlan: { toCreate: {}, blocked: [] },
    });

    const runtime = new NotionRuntime(baseDeps());
    tokenState.token = 'secret-token';
    runtime.rebuild();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(exporterCtor).toHaveBeenCalled();
    const [, , , , authoredIdsArg] = exporterCtor.mock.calls.at(-1)!;
    expect(typeof authoredIdsArg).toBe('function');
    expect(authoredIdsArg()).toEqual(new Set());

    const status = runtime.status();
    expect(status.connected).toBe(true);
  });
});

describe('NotionRuntime.clearExports', () => {
  it('drops each matchId\'s ledger record via outbox.clearExport', () => {
    const outbox = new OutboxStore(tmpDir());
    outbox.recordExport('a', { pageId: 'page-a', signature: 'sig-a' });
    outbox.recordExport('b', { pageId: 'page-b', signature: 'sig-b' });

    const runtime = new NotionRuntime(baseDeps({ outbox }));
    runtime.clearExports(['a', 'b']);

    expect(outbox.pageIdFor('a')).toBeUndefined();
    expect(outbox.pageIdFor('b')).toBeUndefined();
  });

  it('is a no-op for matchIds with no ledger record', () => {
    const outbox = new OutboxStore(tmpDir());
    const runtime = new NotionRuntime(baseDeps({ outbox }));

    expect(() => runtime.clearExports(['never-exported'])).not.toThrow();
    expect(outbox.pageIdFor('never-exported')).toBeUndefined();
  });
});

describe('NotionRuntime.import — ledger-aware canonical dedupe', () => {
  it('ledgers only the canonical page of a duplicate group and reports duplicates', async () => {
    // A hand row (page-hand, empty Match ID) plus its re-created copy (page-copy,
    // whose Match ID embeds page-hand's id) — the shape existing duplicates have.
    const handId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const copyMatchId = `manual-notion-${handId.replace(/-/g, '')}`;
    clientMocks.dataSourcesQuery.mockResolvedValue({
      results: [
        importerRow(handId, { createdTime: '2024-01-01T00:00:00.000Z' }),
        importerRow('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', { matchId: copyMatchId, createdTime: '2024-01-02T00:00:00.000Z' }),
      ],
      has_more: false,
      next_cursor: null,
    });

    const outbox = new OutboxStore(tmpDir());
    const runtime = await connectedRuntime({ outbox });
    const result = await runtime.import();

    expect(result.unavailable).toBeUndefined();
    expect(result.error).toBeUndefined();
    expect(result.duplicates).toBe(1);
    expect(result.games).toHaveLength(1);
    expect(result.games[0].pageId).toBe(handId);
    // Only the canonical (hand) page gets ledgered — the redundant copy's page
    // id never reaches the ledger.
    expect(outbox.pageIdFor(result.games[0].matchId)).toBe(handId);
  });

  it('returns duplicates: 0 and ledgers normally when no row shares a match id', async () => {
    clientMocks.dataSourcesQuery.mockResolvedValue({
      results: [importerRow('page-solo', { matchId: 'gep-match-1' })],
      has_more: false,
      next_cursor: null,
    });

    const outbox = new OutboxStore(tmpDir());
    const runtime = await connectedRuntime({ outbox });
    const result = await runtime.import();

    expect(result.duplicates).toBe(0);
    expect(result.games).toHaveLength(1);
    expect(outbox.pageIdFor('gep-match-1')).toBe('page-solo');
  });
});

describe('NotionRuntime.cleanupDuplicates', () => {
  it('is unavailable with no client', async () => {
    const runtime = new NotionRuntime(baseDeps());
    const result = await runtime.cleanupDuplicates();
    expect(result).toEqual({ archived: 0, kept: 0, failed: 0, unavailable: true });
  });

  it('is unavailable with a client but no configured database', async () => {
    const runtime = await connectedRuntime({
      config: () => ({ notion: { gametrackerDatabaseId: '', mapsDatabaseId: '', gametrackerUrl: '' }, mapAliases: {} }) as any,
    });
    const result = await runtime.cleanupDuplicates();
    expect(result).toEqual({ archived: 0, kept: 0, failed: 0, unavailable: true });
  });

  it('archives the redundant row of a dup pair, stamps + re-ledgers the canonical, leaves a unique row untouched', async () => {
    const handId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const copyId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    const copyMatchId = `manual-notion-${handId.replace(/-/g, '')}`;
    const uniqueId = 'unique-page';

    clientMocks.dataSourcesQuery.mockResolvedValue({
      results: [
        row(handId, { createdTime: '2024-01-01T00:00:00.000Z' }), // empty Match ID — the hand row
        row(copyId, { matchId: copyMatchId, createdTime: '2024-01-02T00:00:00.000Z' }), // redundant copy
        row(uniqueId, { matchId: 'gep-match-unrelated' }),
      ],
      has_more: false,
      next_cursor: null,
    });

    const outbox = new OutboxStore(tmpDir());
    // Ledger previously pointed at the redundant copy (e.g. import ledgered it
    // before this dedup pass existed) — `repointExport` only ever moves an
    // EXISTING record, so seed one to exercise that re-pointing.
    outbox.recordExport(copyMatchId, { pageId: copyId, signature: 'sig', databaseId: 'db-1' });
    const runtime = await connectedRuntime({ outbox });
    const result = await runtime.cleanupDuplicates();

    expect(result).toEqual({ archived: 1, kept: 1, failed: 0 });
    // Exactly one archive call, for the redundant copy — the canonical and the
    // unique row are never sent `in_trash`.
    expect(clientMocks.pagesUpdate).toHaveBeenCalledWith(expect.objectContaining({ page_id: copyId, in_trash: true }));
    expect(clientMocks.pagesUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ page_id: uniqueId }));
    expect(clientMocks.pagesUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ page_id: handId, in_trash: true }));
    // Canonical row lacked a Match ID cell, so cleanup stamps it with the
    // group's effective id.
    expect(clientMocks.pagesUpdate).toHaveBeenCalledWith({
      page_id: handId,
      properties: { 'Match ID': { rich_text: [{ text: { content: copyMatchId } }] } },
    });
    // Ledger re-pointed at the surviving canonical page.
    expect(outbox.pageIdFor(copyMatchId, 'db-1')).toBe(handId);
  });

  it('does not stamp the canonical row when it already carries Match ID text', async () => {
    const rowAId = 'page-a';
    const rowBId = 'page-b';
    clientMocks.dataSourcesQuery.mockResolvedValue({
      results: [
        row(rowAId, { matchId: 'gep-1', createdTime: '2024-01-01T00:00:00.000Z' }),
        row(rowBId, { matchId: 'gep-1', createdTime: '2024-01-02T00:00:00.000Z' }),
      ],
      has_more: false,
      next_cursor: null,
    });

    const runtime = await connectedRuntime();
    const result = await runtime.cleanupDuplicates();

    expect(result).toEqual({ archived: 1, kept: 1, failed: 0 });
    // Canonical (earliest createdTime, rowA) already had Match ID text — no
    // stamp call for it, only the archive of rowB.
    expect(clientMocks.pagesUpdate).toHaveBeenCalledTimes(1);
    expect(clientMocks.pagesUpdate).toHaveBeenCalledWith(expect.objectContaining({ page_id: rowBId, in_trash: true }));
  });

  it('isolates a failed archive: other groups still process, failed is counted', async () => {
    const groupAHand = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    const groupACopy = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
    const groupBRow1 = 'group-b-row1';
    const groupBRow2 = 'group-b-row2';

    clientMocks.dataSourcesQuery.mockResolvedValue({
      results: [
        row(groupAHand, { createdTime: '2024-01-01T00:00:00.000Z' }),
        row(groupACopy, { matchId: `manual-notion-${groupAHand.replace(/-/g, '')}`, createdTime: '2024-01-02T00:00:00.000Z' }),
        row(groupBRow1, { matchId: 'gep-2', createdTime: '2024-01-01T00:00:00.000Z' }),
        row(groupBRow2, { matchId: 'gep-2', createdTime: '2024-01-02T00:00:00.000Z' }),
      ],
      has_more: false,
      next_cursor: null,
    });
    clientMocks.pagesUpdate.mockImplementation(async (args: any) => {
      if (args.page_id === groupACopy && args.in_trash) throw new Error('archive failed');
      return undefined;
    });

    const runtime = await connectedRuntime();
    const result = await runtime.cleanupDuplicates();

    expect(result.kept).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.archived).toBe(1); // group B's redundant row archived fine
  });

  it('reports a whole-scan error without archiving anything', async () => {
    clientMocks.dataSourcesQuery.mockRejectedValue(new Error('network down'));

    const runtime = await connectedRuntime();
    const result = await runtime.cleanupDuplicates();

    expect(result.archived).toBe(0);
    expect(result.kept).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.error).toContain('network down');
    expect(clientMocks.pagesUpdate).not.toHaveBeenCalled();
  });

  it('a ledger repoint failure mid-loop neither aborts the remaining groups nor discards the archive counts', async () => {
    // Rows already archived in Notion must never be reported as archived: 0 —
    // the ledger write (outbox.json on disk) can fail independently of the
    // Notion calls (disk full, file lock), and it sits between groups in the
    // loop.
    const groupAHand = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
    const groupACopy = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
    clientMocks.dataSourcesQuery.mockResolvedValue({
      results: [
        row(groupAHand, { createdTime: '2024-01-01T00:00:00.000Z' }),
        row(groupACopy, { matchId: `manual-notion-${groupAHand.replace(/-/g, '')}`, createdTime: '2024-01-02T00:00:00.000Z' }),
        row('group-b-row1', { matchId: 'gep-3', createdTime: '2024-01-01T00:00:00.000Z' }),
        row('group-b-row2', { matchId: 'gep-3', createdTime: '2024-01-02T00:00:00.000Z' }),
      ],
      has_more: false,
      next_cursor: null,
    });

    const outbox = new OutboxStore(tmpDir());
    vi.spyOn(outbox, 'repointExport').mockImplementation(() => {
      throw new Error('EBUSY: outbox.json locked');
    });
    const runtime = await connectedRuntime({ outbox });
    const result = await runtime.cleanupDuplicates();

    // Both groups fully processed despite every repoint throwing.
    expect(result).toEqual({ archived: 2, kept: 2, failed: 0 });
  });
});

describe('NotionRuntime — cleanup never runs during import/export (AC10)', () => {
  it('import() never archives, even when the database DOES contain duplicates', async () => {
    // The Given of AC10 is "duplicates exist" — a duplicate-free fixture would
    // make the in_trash assertion vacuous (pages.update would never fire for
    // any reason). This import stamps the canonical hand row's Match ID, so
    // pages.update IS exercised — just never with in_trash.
    const handId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    const copyMatchId = `manual-notion-${handId.replace(/-/g, '')}`;
    clientMocks.dataSourcesQuery.mockResolvedValue({
      results: [
        importerRow(handId, { createdTime: '2024-01-01T00:00:00.000Z' }),
        importerRow('dddddddd-dddd-dddd-dddd-dddddddddddd', { matchId: copyMatchId, createdTime: '2024-01-02T00:00:00.000Z' }),
      ],
      has_more: false,
      next_cursor: null,
    });
    const runtime = await connectedRuntime();
    const result = await runtime.import();

    expect(result.duplicates).toBe(1);
    // The write-back stamp fired (proving pages.update was reachable) …
    expect(clientMocks.pagesUpdate).toHaveBeenCalled();
    // … but no call, on any page, ever archives.
    for (const call of clientMocks.pagesUpdate.mock.calls) {
      expect(call[0]).not.toHaveProperty('in_trash');
    }
  });
});
