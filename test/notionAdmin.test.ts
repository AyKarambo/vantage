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
    pages: {
      create: vi.fn(),
    },
    ...overrides,
  } as any;
}

describe('NotionAdmin.listDatabases', () => {
  it('follows has_more/next_cursor pagination', async () => {
    const client = mockClient();
    client.search
      .mockResolvedValueOnce({
        results: [{ id: 'db-1', title: [{ plain_text: 'Gametracker' }], url: 'https://notion.so/db-1' }],
        has_more: true,
        next_cursor: 'cursor-1',
      })
      .mockResolvedValueOnce({
        results: [{ id: 'db-2', title: [{ plain_text: 'Archive' }], url: 'https://notion.so/db-2' }],
        has_more: false,
        next_cursor: null,
      });

    const admin = new NotionAdmin(client);
    const databases = await admin.listDatabases();

    expect(client.search).toHaveBeenCalledTimes(2);
    expect(client.search).toHaveBeenNthCalledWith(1, expect.objectContaining({
      filter: { property: 'object', value: 'database' },
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
        ? { id: 'maps-db-id', url: 'https://notion.so/maps-db' }
        : { id: 'gametracker-db-id', url: 'https://notion.so/gametracker-db' };
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

    // The Gametracker DB's relation points at the Maps DB id.
    const gametrackerCreateArgs = client.databases.create.mock.calls[1][0];
    expect(gametrackerCreateArgs.properties.Map.relation.database_id).toBe('maps-db-id');

    expect(result).toEqual({
      gametrackerDatabaseId: 'gametracker-db-id',
      gametrackerUrl: 'https://notion.so/gametracker-db',
      mapsDatabaseId: 'maps-db-id',
      mapsUrl: 'https://notion.so/maps-db',
    });
  });
});

describe('NotionAdmin.validate', () => {
  it('maps a retrieve payload through the schema module', async () => {
    const client = mockClient();
    client.databases.retrieve.mockResolvedValue({
      title: [{ plain_text: 'Gametracker' }],
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
    expect(result.title).toBe('Gametracker');
    expect(result.ok).toBe(false);
    expect(result.missing).toContain('Result');
    expect(result.mismatched).toContain('Eliminations');
  });

  it('surfaces the present subjective columns and the Map relation target', async () => {
    const client = mockClient();
    client.databases.retrieve.mockResolvedValue({
      title: [{ plain_text: 'Gametracker' }],
      properties: {
        Map: { type: 'relation', relation: { database_id: 'maps-db-99' } },
        Comms: { type: 'select' },
        Tilt: { type: 'checkbox' },
        Leaver: { type: 'rich_text' }, // wrong type → not writable, excluded
      },
    });

    const admin = new NotionAdmin(client);
    const result = await admin.validate('db-id');

    expect(result.subjectiveColumns.sort()).toEqual(['Comms', 'Tilt']);
    expect(result.mapRelationDbId).toBe('maps-db-99');
  });
});
