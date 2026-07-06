import { describe, it, expect, vi } from 'vitest';
import { NotionImporter, NOTION_IMPROVEMENT_TARGET_ID } from '../src/notion/notionImporter';
import { NOTION_IMPROVEMENT_TARGET_ID as CORE_NOTION_IMPROVEMENT_TARGET_ID } from '../src/core/targets';
import * as notionImporterModule from '../src/notion/notionImporter';

const GT = 'gametracker-db';
const MAPS = 'maps-db';

/** A Gametracker row; every field optional so each test states only what it exercises. */
function row(p: {
  id?: string;
  result?: string | null;
  role?: string | null;
  mapId?: string;
  account?: string;
  name?: string;
  heroes?: string[];
  leaver?: 'team' | 'enemy' | null;
  tilt?: boolean;
  toxicMates?: boolean;
  comms?: string | null;
  improvement?: string | null;
  matchId?: string;
  playedAt?: string;
  createdTime?: string;
}) {
  return {
    id: p.id ?? 'page-1',
    created_time: p.createdTime ?? '2024-01-01T00:00:00.000Z',
    properties: {
      Result: { select: p.result === undefined ? { name: 'Win' } : p.result === null ? null : { name: p.result } },
      Role: { select: p.role === undefined ? { name: 'damage' } : p.role === null ? null : { name: p.role } },
      Map: { relation: p.mapId ? [{ id: p.mapId }] : [] },
      Account: { select: p.account ? { name: p.account } : null },
      'Hero(es) Played': { multi_select: (p.heroes ?? []).map((name) => ({ name })) },
      'Game Type': { select: null },
      'Match ID': { rich_text: p.matchId ? [{ plain_text: p.matchId }] : [] },
      'Played At': { type: 'date', date: p.playedAt ? { start: p.playedAt } : null },
      Name: { title: p.name ? [{ plain_text: p.name }] : [] },
      Leaver: { type: 'select', select: p.leaver ? { name: p.leaver } : null },
      Tilt: { type: 'checkbox', checkbox: Boolean(p.tilt) },
      'Toxic Mates': { type: 'checkbox', checkbox: Boolean(p.toxicMates) },
      Comms: { type: 'select', select: p.comms ? { name: p.comms } : null },
      'Improvement Target': { type: 'select', select: p.improvement ? { name: p.improvement } : null },
    },
  };
}

/** Map DB page: id → title. */
function mapPage(id: string, title: string) {
  return { id, properties: { Name: { type: 'title', title: [{ plain_text: title }] } } };
}

const GT_DS = 'gametracker-ds';
const MAPS_DS = 'maps-ds';

/**
 * Mock @notionhq client for the v5 (database → data source) shape. `GT` and
 * `MAPS` are database ids; `databases.retrieve` resolves each to its data
 * source id (GT_DS / MAPS_DS), `dataSources.query` dispatches on the resolved
 * data_source_id, and `dataSources.retrieve` returns the Gametracker schema
 * whose `Map` relation points at MAPS_DS (unless overridden).
 */
function mockClient(opts: {
  gametracker: any[];
  maps?: any[];
  mapRelationDbId?: string | null; // null → Map isn't a relation (no discovery)
}) {
  // `databases.retrieve` only knows the two configured database ids (GT, MAPS);
  // an already-resolved data source id (e.g. the discovered MAPS_DS) rejects, so
  // `resolveDataSourceId` falls through to `dataSources.retrieve` for it — the
  // "id that is already a data-source id" path exercised for real by the resolver.
  const databasesRetrieve = vi.fn(async ({ database_id }: any) => {
    if (database_id === GT) return { data_sources: [{ id: GT_DS }] };
    if (database_id === MAPS) return { data_sources: [{ id: MAPS_DS }] };
    throw new Error(`not a database id: ${database_id}`);
  });
  const dataSourcesRetrieve = vi.fn(async ({ data_source_id }: any) => {
    if (data_source_id === GT_DS) {
      return {
        properties: {
          Map:
            opts.mapRelationDbId === null
              ? { type: 'rich_text' }
              : { type: 'relation', relation: { data_source_id: opts.mapRelationDbId ?? MAPS_DS } },
        },
      };
    }
    return { id: data_source_id }; // resolver's "already a data source id" fallback
  });
  const query = vi.fn(async ({ data_source_id }: any) => ({
    results: data_source_id === MAPS_DS ? opts.maps ?? [] : opts.gametracker,
    has_more: false,
    next_cursor: null,
  }));
  return {
    client: { databases: { retrieve: databasesRetrieve }, dataSources: { query, retrieve: dataSourcesRetrieve } } as any,
    retrieve: dataSourcesRetrieve,
    databasesRetrieve,
    query,
  };
}

describe('NotionImporter — map resolution', () => {
  it('discovers the Maps database from the schema and resolves relations when mapsDatabaseId is unset', async () => {
    const { client, retrieve, databasesRetrieve } = mockClient({
      gametracker: [row({ mapId: 'm-ilios' }), row({ id: 'page-2', mapId: 'm-kr' })],
      maps: [mapPage('m-ilios', 'Ilios'), mapPage('m-kr', "King's Row")],
    });
    // No mapsDatabaseId passed — the user's real situation.
    const { games, failed } = await new NotionImporter(client, GT).import();

    expect(retrieve).toHaveBeenCalledWith({ data_source_id: GT_DS });
    expect(failed).toBe(0);
    expect(games.map((g) => g.map)).toEqual(['Ilios', "King's Row"]);
    // Discovery and the row query both need GT resolved — the per-instance memo
    // means only one databases.retrieve call for it, not two.
    expect(databasesRetrieve.mock.calls.filter(([{ database_id }]: any) => database_id === GT)).toHaveLength(1);
  });

  it('uses an explicitly configured mapsDatabaseId without discovering', async () => {
    const { client, retrieve } = mockClient({
      gametracker: [row({ mapId: 'm-ilios' })],
      maps: [mapPage('m-ilios', 'Ilios')],
    });
    const { games } = await new NotionImporter(client, GT, MAPS).import();

    expect(retrieve).not.toHaveBeenCalled(); // discovery skipped
    expect(games[0].map).toBe('Ilios');
  });

  it('falls back to the row title, then "Unknown", when the relation cannot be resolved', async () => {
    const { client } = mockClient({
      gametracker: [
        row({ id: 'titled', mapId: undefined, name: "Karambo · damage · Hollywood · Win" }),
        row({ id: 'bare', mapId: undefined, name: '' }),
      ],
      mapRelationDbId: null, // Map isn't a relation → no discovery, empty mapsById
    });
    const { games } = await new NotionImporter(client, GT).import();
    const byId = Object.fromEntries(games.map((g) => [g.matchId.includes('titled') ? 'titled' : 'bare', g.map]));
    expect(byId.titled).toBe('Hollywood');
    expect(byId.bare).toBe('Unknown');
  });

  it('rejects when the Gametracker id cannot be resolved (unreachable database)', async () => {
    const client = {
      databases: { retrieve: vi.fn().mockRejectedValue(new Error('object_not_found')) },
      dataSources: {
        retrieve: vi.fn().mockRejectedValue(new Error('not a data source either')),
        query: vi.fn(),
      },
    } as any;

    await expect(new NotionImporter(client, GT).import()).rejects.toThrow('object_not_found');
    expect(client.dataSources.query).not.toHaveBeenCalled();
  });
});

describe('NotionImporter — match time', () => {
  it('prefers the Played At date over the Notion row-creation time', async () => {
    const { client } = mockClient({
      gametracker: [row({ playedAt: '2026-05-01T12:34:00.000Z', createdTime: '2026-07-05T09:00:00.000Z' })],
      maps: [],
    });
    const [g] = (await new NotionImporter(client, GT).import()).games;
    expect(g.timestamp).toBe(Date.parse('2026-05-01T12:34:00.000Z'));
  });

  it('falls back to created_time when Played At is unset (legacy / hand-added rows)', async () => {
    const { client } = mockClient({
      gametracker: [row({ createdTime: '2026-03-18T16:48:00.000Z' })],
      maps: [],
    });
    const [g] = (await new NotionImporter(client, GT).import()).games;
    expect(g.timestamp).toBe(Date.parse('2026-03-18T16:48:00.000Z'));
  });

  it('clamps a future-dated Played At to now, matching the manual-log clamp', async () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const { client } = mockClient({
      gametracker: [row({ playedAt: future })],
      maps: [],
    });
    const [g] = (await new NotionImporter(client, GT).import()).games;
    expect(g.timestamp).toBeLessThanOrEqual(Date.now());
  });
});

describe('NotionImporter — source provenance', () => {
  it('treats a hand-added row (no Match ID) as manual', async () => {
    const { client } = mockClient({ gametracker: [row({ id: 'abc-def' })], maps: [] });
    const [g] = (await new NotionImporter(client, GT).import()).games;
    expect(g.source).toBe('manual');
    expect(g.matchId).toBe('manual-notion-abcdef');
  });

  it('restores a row carrying a real GEP Match ID as auto-tracked (gep)', async () => {
    const { client } = mockClient({ gametracker: [row({ matchId: '1432799173' })], maps: [] });
    const [g] = (await new NotionImporter(client, GT).import()).games;
    expect(g.source).toBe('gep');
    expect(g.matchId).toBe('1432799173');
  });
});

describe('NotionImporter — role and result mapping', () => {
  it('maps each Notion Role select value to the matching role', async () => {
    const { client } = mockClient({
      gametracker: [
        row({ id: 'a', role: 'tank' }),
        row({ id: 'b', role: 'damage' }),
        row({ id: 'c', role: 'support' }),
        row({ id: 'd', role: 'openQ' }),
      ],
      maps: [],
    });
    const { games } = await new NotionImporter(client, GT).import();
    expect(games.map((g) => g.role)).toEqual(['tank', 'damage', 'support', 'openQ']);
  });

  it('defaults a missing/blank Role to damage rather than dropping the row', async () => {
    const { client } = mockClient({ gametracker: [row({ role: null })], maps: [] });
    const { games, failed } = await new NotionImporter(client, GT).import();
    expect(failed).toBe(0);
    expect(games[0].role).toBe('damage');
  });

  it('counts a row with no Result as failed, never as a match', async () => {
    const { client } = mockClient({ gametracker: [row({ result: null })], maps: [] });
    const { games, failed } = await new NotionImporter(client, GT).import();
    expect(games).toHaveLength(0);
    expect(failed).toBe(1);
  });
});

describe('NotionImporter — mental self-report', () => {
  it('splits the Leaver select into the team-specific flags', async () => {
    const { client } = mockClient({
      gametracker: [row({ id: 'mine', leaver: 'team' }), row({ id: 'theirs', leaver: 'enemy' })],
      maps: [],
    });
    const [mine, theirs] = (await new NotionImporter(client, GT).import()).games;
    expect(mine.mental).toEqual({ leaverMyTeam: true });
    expect(theirs.mental).toEqual({ leaverEnemyTeam: true });
  });

  it('maps Tilt/Toxic Mates checkboxes and positive Comms onto mental', async () => {
    const { client } = mockClient({
      gametracker: [row({ tilt: true, toxicMates: true, comms: 'positive' })],
      maps: [],
    });
    const [g] = (await new NotionImporter(client, GT).import()).games;
    expect(g.mental).toEqual({ tilt: true, toxicMates: true, positiveComms: true });
  });

  it('treats non-positive Comms as no positive-comms flag', async () => {
    const { client } = mockClient({
      gametracker: [row({ id: 'a', comms: 'abusive' }), row({ id: 'b', comms: 'banther' }), row({ id: 'c', comms: 'none' })],
      maps: [],
    });
    const games = (await new NotionImporter(client, GT).import()).games;
    expect(games.every((g) => g.mental === undefined)).toBe(true);
  });

  it('leaves mental undefined when the row flagged nothing', async () => {
    const { client } = mockClient({ gametracker: [row({})], maps: [] });
    const [g] = (await new NotionImporter(client, GT).import()).games;
    expect(g.mental).toBeUndefined();
  });
});

describe('NotionImporter — improvement grade', () => {
  it('maps the Improvement Target select onto a review grade for the imported target', async () => {
    const { client } = mockClient({
      gametracker: [
        row({ id: 'h', improvement: 'hit' }),
        row({ id: 'p', improvement: 'partially' }),
        row({ id: 'm', improvement: 'missed' }),
      ],
      maps: [],
    });
    const games = (await new NotionImporter(client, GT).import()).games;
    expect(games.map((g) => g.review?.grades[NOTION_IMPROVEMENT_TARGET_ID])).toEqual(['hit', 'partial', 'missed']);
    // The grade marks the game reviewed; its flags stay empty (mental lives on `mental`).
    expect(games[0].review?.flags).toEqual({});
  });

  it('attaches no review for "none" or a blank Improvement Target, so the game stays gradable', async () => {
    const { client } = mockClient({
      gametracker: [row({ id: 'none', improvement: 'none' }), row({ id: 'blank', improvement: null })],
      maps: [],
    });
    const games = (await new NotionImporter(client, GT).import()).games;
    expect(games.every((g) => g.review === undefined)).toBe(true);
  });

  it('carries both mental flags and a review grade on one row without conflict', async () => {
    const { client } = mockClient({
      gametracker: [row({ tilt: true, leaver: 'enemy', improvement: 'hit' })],
      maps: [],
    });
    const [g] = (await new NotionImporter(client, GT).import()).games;
    expect(g.mental).toEqual({ tilt: true, leaverEnemyTeam: true });
    expect(g.review?.grades[NOTION_IMPROVEMENT_TARGET_ID]).toBe('hit');
  });

  it('re-exports the same internal id core/targets defines — no local synthetic-target factory', () => {
    expect(NOTION_IMPROVEMENT_TARGET_ID).toBe(CORE_NOTION_IMPROVEMENT_TARGET_ID);
    expect((notionImporterModule as Record<string, unknown>)['notionImprovementTarget']).toBeUndefined();
  });
});

describe('NotionImporter — page id', () => {
  it('exposes each imported row\'s Notion page id for recordImported', async () => {
    const { client } = mockClient({
      gametracker: [row({ id: 'page-abc', matchId: '1432799173' }), row({ id: 'page-def', matchId: '1432799174' })],
      maps: [],
    });
    const { games } = await new NotionImporter(client, GT).import();
    expect(games.map((g) => g.pageId)).toEqual(['page-abc', 'page-def']);
  });
});

describe('NotionImporter — Match ID write-back (AC1/AC2)', () => {
  it('stamps the derived id onto a hand-added row\'s empty Match ID cell', async () => {
    const pageId = '11111111-1111-1111-1111-111111111111';
    const { client } = mockClient({ gametracker: [row({ id: pageId })], maps: [] });
    const update = vi.fn().mockResolvedValue({});
    (client as any).pages = { update };

    const { games, duplicates } = await new NotionImporter(client, GT).import();

    expect(duplicates).toBe(0);
    expect(games).toHaveLength(1);
    const derivedId = `manual-notion-${pageId.replace(/-/g, '')}`;
    expect(games[0].matchId).toBe(derivedId);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      page_id: pageId,
      properties: { 'Match ID': { rich_text: [{ text: { content: derivedId } }] } },
    });
  });

  it('never stamps a row whose Match ID cell already carries text', async () => {
    const { client } = mockClient({ gametracker: [row({ matchId: '1432799173' })], maps: [] });
    const update = vi.fn().mockResolvedValue({});
    (client as any).pages = { update };

    await new NotionImporter(client, GT).import();

    expect(update).not.toHaveBeenCalled();
  });

  it('imports the row normally even when the stamp write rejects (best-effort)', async () => {
    const pageId = '22222222-2222-2222-2222-222222222222';
    const { client } = mockClient({ gametracker: [row({ id: pageId })], maps: [] });
    const update = vi.fn().mockRejectedValue(new Error('API error'));
    (client as any).pages = { update };

    const { games, failed } = await new NotionImporter(client, GT).import();

    expect(update).toHaveBeenCalledTimes(1);
    expect(failed).toBe(0);
    expect(games).toHaveLength(1);
    expect(games[0].matchId).toBe(`manual-notion-${pageId.replace(/-/g, '')}`);
  });
});

describe('NotionImporter — canonical dedupe + duplicates count (AC8)', () => {
  it('collapses a hand row + its re-created copy into one game under the canonical (hand) pageId', async () => {
    const handPageId = '33333333-3333-3333-3333-333333333333';
    const derivedId = `manual-notion-${handPageId.replace(/-/g, '')}`;
    const { client } = mockClient({
      gametracker: [
        row({ id: handPageId, createdTime: '2026-01-01T00:00:00.000Z' }), // hand row: no Match ID text
        row({ id: 'copy-page', matchId: derivedId, createdTime: '2026-02-01T00:00:00.000Z' }), // re-created copy
      ],
      maps: [],
    });
    const update = vi.fn().mockResolvedValue({});
    (client as any).pages = { update };

    const { games, duplicates } = await new NotionImporter(client, GT).import();

    expect(games).toHaveLength(1);
    expect(games[0].pageId).toBe(handPageId);
    expect(games[0].matchId).toBe(derivedId);
    expect(duplicates).toBe(1);
    // Only the canonical (hand) row is stamped — it had no Match ID text; the
    // copy already carried the id and must never be touched.
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      page_id: handPageId,
      properties: { 'Match ID': { rich_text: [{ text: { content: derivedId } }] } },
    });
  });

  it('prefers the ledgered page over createdTime ordering when neither row embeds the id', async () => {
    // Two rows both carry the SAME Match ID text (neither is derivable back to a
    // pageId via embeddedPageId), so canonical selection falls through to the
    // ledger-preference tier.
    const sharedMatchId = '1432799173';
    const { client } = mockClient({
      gametracker: [
        row({ id: 'older-page', matchId: sharedMatchId, createdTime: '2026-01-01T00:00:00.000Z' }),
        row({ id: 'ledgered-page', matchId: sharedMatchId, createdTime: '2026-02-01T00:00:00.000Z' }),
      ],
      maps: [],
    });
    const update = vi.fn().mockResolvedValue({});
    (client as any).pages = { update };
    const ledgeredPageIdFor = vi.fn((matchId: string) => (matchId === sharedMatchId ? 'ledgered-page' : undefined));

    const { games, duplicates } = await new NotionImporter(client, GT, undefined, ledgeredPageIdFor).import();

    expect(games).toHaveLength(1);
    expect(games[0].pageId).toBe('ledgered-page');
    expect(duplicates).toBe(1);
    // Both rows already carry Match ID text — write-back must never fire.
    expect(update).not.toHaveBeenCalled();
  });
});
