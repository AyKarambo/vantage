import { describe, it, expect, vi } from 'vitest';
import { NotionAdmin } from '../src/notion/notionAdmin';
import { MAP_MODES } from '../src/core/maps';

/** A minimal mock of the `@notionhq/client` surface NotionAdmin touches. */
function mockClient(overrides: Partial<Record<string, any>> = {}) {
  return {
    search: vi.fn(),
    databases: {
      create: vi.fn(),
      retrieve: vi.fn(),
    },
    dataSources: {
      retrieve: vi.fn(),
      update: vi.fn(),
    },
    pages: {
      create: vi.fn(),
    },
    ...overrides,
  } as any;
}

describe('NotionAdmin.listDatabases', () => {
  it('follows has_more/next_cursor pagination, searching data_source', async () => {
    const client = mockClient();
    client.search
      .mockResolvedValueOnce({
        results: [{
          id: 'ds-1', title: [{ plain_text: 'Gametracker' }], url: 'https://notion.so/db-1',
          parent: { type: 'database_id', database_id: 'db-1' },
        }],
        has_more: true,
        next_cursor: 'cursor-1',
      })
      .mockResolvedValueOnce({
        results: [{
          id: 'ds-2', title: [{ plain_text: 'Archive' }], url: 'https://notion.so/db-2',
          parent: { type: 'database_id', database_id: 'db-2' },
        }],
        has_more: false,
        next_cursor: null,
      });

    const admin = new NotionAdmin(client);
    const databases = await admin.listDatabases();

    expect(client.search).toHaveBeenCalledTimes(2);
    expect(client.search).toHaveBeenNthCalledWith(1, expect.objectContaining({
      filter: { property: 'object', value: 'data_source' },
      start_cursor: undefined,
    }));
    expect(client.search).toHaveBeenNthCalledWith(2, expect.objectContaining({
      start_cursor: 'cursor-1',
    }));
    expect(databases).toEqual([
      { id: 'db-1', title: 'Gametracker', url: 'https://notion.so/db-1' },
      { id: 'db-2', title: 'Archive', url: 'https://notion.so/db-2' },
    ]);
  });

  it('dedupes multiple data sources under the same parent database, first wins', async () => {
    const client = mockClient();
    client.search.mockResolvedValue({
      results: [
        {
          id: 'ds-1', title: [{ plain_text: 'Gametracker (first source)' }], url: 'https://notion.so/db-1',
          parent: { type: 'database_id', database_id: 'db-1' },
        },
        {
          id: 'ds-2', title: [{ plain_text: 'Gametracker (second source)' }], url: 'https://notion.so/db-1-alt',
          parent: { type: 'database_id', database_id: 'db-1' },
        },
      ],
      has_more: false,
      next_cursor: null,
    });

    const admin = new NotionAdmin(client);
    const databases = await admin.listDatabases();

    expect(databases).toEqual([{ id: 'db-1', title: 'Gametracker (first source)', url: 'https://notion.so/db-1' }]);
  });

  it('skips a result with no parent.database_id (partial response from a restricted token)', async () => {
    const client = mockClient();
    client.search.mockResolvedValue({
      results: [
        { id: 'ds-orphan', title: [{ plain_text: 'Orphan' }], url: 'https://notion.so/orphan' },
        {
          id: 'ds-2', title: [{ plain_text: 'Gametracker' }], url: 'https://notion.so/db-2',
          parent: { type: 'database_id', database_id: 'db-2' },
        },
      ],
      has_more: false,
      next_cursor: null,
    });

    const admin = new NotionAdmin(client);
    const databases = await admin.listDatabases();

    expect(databases).toEqual([{ id: 'db-2', title: 'Gametracker', url: 'https://notion.so/db-2' }]);
  });
});

describe('NotionAdmin.listParentPages', () => {
  it('searches for pages and extracts titles from the title property', async () => {
    const client = mockClient();
    client.search.mockResolvedValue({
      results: [{
        id: 'page-1',
        url: 'https://notion.so/page-1',
        properties: { Name: { type: 'title', title: [{ plain_text: 'Overwatch' }] } },
      }],
      has_more: false,
      next_cursor: null,
    });

    const admin = new NotionAdmin(client);
    const pages = await admin.listParentPages();

    expect(client.search).toHaveBeenCalledWith(expect.objectContaining({
      filter: { property: 'object', value: 'page' },
    }));
    expect(pages).toEqual([{ id: 'page-1', title: 'Overwatch', url: 'https://notion.so/page-1' }]);
  });
});

describe('NotionAdmin.createGametracker', () => {
  it('creates Maps DB, then one page per MAP_MODES key, then Gametracker with the relation — in order', async () => {
    const callOrder: string[] = [];
    const client = mockClient();
    client.databases.create.mockImplementation(async (args: any) => {
      const isMaps = args.title[0].text.content === 'Maps';
      callOrder.push(isMaps ? 'create-maps-db' : 'create-gametracker-db');
      return isMaps
        ? { id: 'maps-db-id', url: 'https://notion.so/maps-db', data_sources: [{ id: 'maps-ds-id' }] }
        : { id: 'gametracker-db-id', url: 'https://notion.so/gametracker-db', data_sources: [{ id: 'gametracker-ds-id' }] };
    });
    client.pages.create.mockImplementation(async () => {
      callOrder.push('create-map-page');
      return { id: `page-${callOrder.length}` };
    });

    const admin = new NotionAdmin(client);
    const result = await admin.createGametracker('parent-page-id');

    const mapModeCount = Object.keys(MAP_MODES).length;
    const mapPageCalls = callOrder.filter((c) => c === 'create-map-page');
    expect(mapPageCalls).toHaveLength(mapModeCount);

    // Order: Maps DB create, then all map pages, then Gametracker DB create.
    expect(callOrder[0]).toBe('create-maps-db');
    expect(callOrder[callOrder.length - 1]).toBe('create-gametracker-db');
    expect(callOrder.slice(1, -1).every((c) => c === 'create-map-page')).toBe(true);

    // Map pages are parented on the Maps data source, not the database.
    const mapPageArgs = client.pages.create.mock.calls[0][0];
    expect(mapPageArgs.parent).toEqual({ type: 'data_source_id', data_source_id: 'maps-ds-id' });

    // Properties nest under initial_data_source; the Gametracker's relation points
    // at the Maps data source id (not the database id).
    const mapsCreateArgs = client.databases.create.mock.calls[0][0];
    expect(mapsCreateArgs.initial_data_source.properties).toEqual({ Name: { title: {} } });
    const gametrackerCreateArgs = client.databases.create.mock.calls[1][0];
    expect(gametrackerCreateArgs.initial_data_source.properties.Map.relation).toEqual({
      data_source_id: 'maps-ds-id', single_property: {},
    });

    // Returned ids/urls stay database-level — config semantics unchanged.
    expect(result).toEqual({
      gametrackerDatabaseId: 'gametracker-db-id',
      gametrackerUrl: 'https://notion.so/gametracker-db',
      mapsDatabaseId: 'maps-db-id',
      mapsUrl: 'https://notion.so/maps-db',
    });
  });

  it('throws before creating any Map pages or the Gametracker db when the Maps create response has no data sources', async () => {
    const client = mockClient();
    client.databases.create.mockResolvedValue({ id: 'maps-db-id', url: 'https://notion.so/maps-db', data_sources: [] });

    const admin = new NotionAdmin(client);
    await expect(admin.createGametracker('parent-page-id')).rejects.toThrow(/no visible data sources/);

    expect(client.pages.create).not.toHaveBeenCalled();
    expect(client.databases.create).toHaveBeenCalledTimes(1); // only the Maps create, not Gametracker
  });
});

describe('NotionAdmin.validate', () => {
  it('two-steps databases.retrieve → dataSources.retrieve and maps the payload through the schema module', async () => {
    const client = mockClient();
    client.databases.retrieve.mockResolvedValue({
      title: [{ plain_text: 'Gametracker' }],
      data_sources: [{ id: 'ds-id' }],
    });
    client.dataSources.retrieve.mockResolvedValue({
      properties: {
        Name: { type: 'title' },
        Source: { type: 'select' },
        // Result intentionally omitted → missing.
        Account: { type: 'select' },
        Role: { type: 'select' },
        Map: { type: 'relation' },
        'Hero(es) Played': { type: 'multi_select' },
        Eliminations: { type: 'rich_text' }, // wrong type → mismatched
        Deaths: { type: 'number' },
        Assists: { type: 'number' },
        Damage: { type: 'number' },
        Healing: { type: 'number' },
        Mitigation: { type: 'number' },
        'Match Duration (min)': { type: 'number' },
        'Group Size': { type: 'number' },
        'Game Type': { type: 'select' },
        'Queue Type': { type: 'select' },
        'Final Score': { type: 'rich_text' },
        Battletag: { type: 'rich_text' },
        'Match ID': { type: 'rich_text' },
      },
    });

    const admin = new NotionAdmin(client);
    const result = await admin.validate('db-id', { requireMapRelation: true });

    expect(client.databases.retrieve).toHaveBeenCalledWith({ database_id: 'db-id' });
    expect(client.dataSources.retrieve).toHaveBeenCalledWith({ data_source_id: 'ds-id' });
    expect(result.title).toBe('Gametracker');
    expect(result.dataSourceId).toBe('ds-id');
    expect(result.ok).toBe(false);
    expect(result.missing).toContain('Result');
    expect(result.mismatched).toContain('Eliminations');
  });

  it('surfaces the present subjective columns and the Map relation target (data_source_id)', async () => {
    const client = mockClient();
    client.databases.retrieve.mockResolvedValue({
      title: [{ plain_text: 'Gametracker' }],
      data_sources: [{ id: 'ds-id' }],
    });
    client.dataSources.retrieve.mockResolvedValue({
      properties: {
        Map: { type: 'relation', relation: { data_source_id: 'maps-ds-99', database_id: 'maps-db-99' } },
        Comms: { type: 'select' },
        Tilt: { type: 'checkbox' },
        Leaver: { type: 'rich_text' }, // wrong type → not writable, excluded
      },
    });

    const admin = new NotionAdmin(client);
    const result = await admin.validate('db-id');

    expect(result.subjectiveColumns.sort()).toEqual(['Comms', 'Tilt']);
    expect(result.mapRelationDbId).toBe('maps-ds-99');
  });

  it('surfaces each subjective select column\'s option names (so the writer can echo a "none" option)', async () => {
    const client = mockClient();
    client.databases.retrieve.mockResolvedValue({
      title: [{ plain_text: 'Gametracker' }],
      data_sources: [{ id: 'ds-id' }],
    });
    client.dataSources.retrieve.mockResolvedValue({
      properties: {
        Comms: { type: 'select', select: { options: [{ name: 'positive' }, { name: 'None' }] } },
        'Improvement Target': { type: 'select', select: { options: [{ name: 'hit' }, { name: 'None' }] } },
        Leaver: { type: 'rich_text' }, // wrong type → contributes no options
      },
    });

    const admin = new NotionAdmin(client);
    const result = await admin.validate('db-id', { requireMapRelation: false });

    expect(result.subjectiveSelectOptions).toEqual({
      Comms: ['positive', 'None'],
      'Improvement Target': ['hit', 'None'],
    });
  });

  it('returns per-column subjective diagnostics: wrong-type (actualType), near-miss (actualName), missing, available', async () => {
    const client = mockClient();
    client.databases.retrieve.mockResolvedValue({
      title: [{ plain_text: 'Gametracker' }],
      data_sources: [{ id: 'ds-id' }],
    });
    client.dataSources.retrieve.mockResolvedValue({
      properties: {
        Comms: { type: 'rich_text' }, // wrong-type
        'improvement target': { type: 'select' }, // near-miss (wrong case) for Improvement Target
        // Leaver: absent, no near-miss → missing
        Tilt: { type: 'checkbox' }, // available
        // Toxic Mates: absent, no near-miss → missing
      },
    });

    const admin = new NotionAdmin(client);
    const result = await admin.validate('db-id');

    expect(result.subjectiveColumnDiagnostics).toEqual(
      expect.arrayContaining([
        { column: 'Comms', status: 'wrong-type', actualType: 'rich_text' },
        { column: 'Improvement Target', status: 'near-miss', actualName: 'improvement target' },
        { column: 'Leaver', status: 'missing' },
        { column: 'Tilt', status: 'available' },
        { column: 'Toxic Mates', status: 'missing' },
      ]),
    );
    expect(result.subjectiveColumnDiagnostics).toHaveLength(5);
  });

  it('skips dataSources.retrieve and returns empty properties when the database has no data sources', async () => {
    const client = mockClient();
    client.databases.retrieve.mockResolvedValue({ title: [{ plain_text: 'Empty' }], data_sources: [] });

    const admin = new NotionAdmin(client);
    const result = await admin.validate('db-id', { requireMapRelation: false });

    expect(client.dataSources.retrieve).not.toHaveBeenCalled();
    expect(result.dataSourceId).toBeUndefined();
    expect(result.ok).toBe(false); // required properties are all missing
  });

  it('returns a provisionPlan listing the Vantage columns missing from the live schema', async () => {
    const client = mockClient();
    client.databases.retrieve.mockResolvedValue({ title: [{ plain_text: 'Sparse' }], data_sources: [{ id: 'ds-id' }] });
    // Only a title column exists — every other Vantage column is missing.
    client.dataSources.retrieve.mockResolvedValue({ properties: { Name: { type: 'title' } } });

    const admin = new NotionAdmin(client);
    const result = await admin.validate('db-id', { requireMapRelation: false });

    // The plan proposes creating the scalar/subjective columns (never Name/Map).
    expect(result.provisionPlan.toCreate).toHaveProperty('SR Delta');
    expect(result.provisionPlan.toCreate).toHaveProperty('Comms');
    expect(result.provisionPlan.toCreate).not.toHaveProperty('Name');
    expect(result.provisionPlan.toCreate).not.toHaveProperty('Map');
    expect(result.provisionPlan.blocked).toEqual([]);
  });
});

describe('NotionAdmin.ensureColumns', () => {
  it('makes no network call and returns [] when there is nothing to create (idempotent)', async () => {
    const client = mockClient();
    const admin = new NotionAdmin(client);

    const created = await admin.ensureColumns('ds-id', {});

    expect(client.dataSources.update).not.toHaveBeenCalled();
    expect(created).toEqual([]);
  });

  it('issues one additive dataSources.update with the given payload and returns the created names', async () => {
    const client = mockClient();
    client.dataSources.update.mockResolvedValue({});
    const admin = new NotionAdmin(client);

    const toCreate = { 'SR Delta': { number: {} }, Tilt: { checkbox: {} } };
    const created = await admin.ensureColumns('ds-id', toCreate);

    expect(client.dataSources.update).toHaveBeenCalledTimes(1);
    expect(client.dataSources.update).toHaveBeenCalledWith({ data_source_id: 'ds-id', properties: toCreate });
    expect(created.sort()).toEqual(['SR Delta', 'Tilt']);
  });

  it('propagates a schema-edit failure to the caller (runtime decides the fallback)', async () => {
    const client = mockClient();
    client.dataSources.update.mockRejectedValue(new Error('insufficient permissions'));
    const admin = new NotionAdmin(client);

    await expect(admin.ensureColumns('ds-id', { 'SR Delta': { number: {} } })).rejects.toThrow(/insufficient permissions/);
  });
});
