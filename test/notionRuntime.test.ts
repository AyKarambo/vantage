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
vi.mock('../src/notion/notionAdmin', () => ({
  NotionAdmin: vi.fn().mockImplementation(function (this: any) {
    this.validate = validateMock;
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

import { NotionRuntime, type NotionRuntimeDeps } from '../src/main/notionRuntime';
import { OutboxStore } from '../src/store/outbox';
import type { SubjectiveColumnDiag } from '../src/shared/contract';

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
  exporterCtor.mockReset();
});

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

describe('NotionRuntime — authored ids + ledger reach the exporter', () => {
  it('constructs NotionExporter with the outbox ledger and authoredTargetIds()', async () => {
    validateMock.mockResolvedValue({
      ok: true, missing: [], mismatched: [], title: 'Gametracker',
      hasPlayedAt: false, hasSrDelta: false,
      subjectiveColumns: ['Improvement Target'],
      subjectiveColumnDiagnostics: [],
      mapRelationDbId: undefined,
      dataSourceId: 'src-1',
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
