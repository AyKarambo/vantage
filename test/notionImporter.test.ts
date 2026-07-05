import { describe, it, expect, vi } from 'vitest';
import { NotionImporter, NOTION_IMPROVEMENT_TARGET_ID, notionImprovementTarget } from '../src/notion/notionImporter';

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
}) {
  return {
    id: p.id ?? 'page-1',
    created_time: '2024-01-01T00:00:00.000Z',
    properties: {
      Result: { select: p.result === undefined ? { name: 'Win' } : p.result === null ? null : { name: p.result } },
      Role: { select: p.role === undefined ? { name: 'damage' } : p.role === null ? null : { name: p.role } },
      Map: { relation: p.mapId ? [{ id: p.mapId }] : [] },
      Account: { select: p.account ? { name: p.account } : null },
      'Hero(es) Played': { multi_select: (p.heroes ?? []).map((name) => ({ name })) },
      'Game Type': { select: null },
      'Match ID': { rich_text: [] },
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

/**
 * Mock @notionhq client. `query` dispatches on database_id; `retrieve` returns
 * the Gametracker schema whose `Map` relation points at MAPS (unless overridden).
 */
function mockClient(opts: {
  gametracker: any[];
  maps?: any[];
  mapRelationDbId?: string | null; // null → Map isn't a relation (no discovery)
}) {
  const retrieve = vi.fn().mockResolvedValue({
    properties: {
      Map:
        opts.mapRelationDbId === null
          ? { type: 'rich_text' }
          : { type: 'relation', relation: { database_id: opts.mapRelationDbId ?? MAPS } },
    },
  });
  const query = vi.fn(async ({ database_id }: any) => ({
    results: database_id === MAPS ? opts.maps ?? [] : opts.gametracker,
    has_more: false,
    next_cursor: null,
  }));
  return { client: { databases: { retrieve, query } } as any, retrieve, query };
}

describe('NotionImporter — map resolution', () => {
  it('discovers the Maps database from the schema and resolves relations when mapsDatabaseId is unset', async () => {
    const { client, retrieve } = mockClient({
      gametracker: [row({ mapId: 'm-ilios' }), row({ id: 'page-2', mapId: 'm-kr' })],
      maps: [mapPage('m-ilios', 'Ilios'), mapPage('m-kr', "King's Row")],
    });
    // No mapsDatabaseId passed — the user's real situation.
    const { games, failed } = await new NotionImporter(client, GT).import();

    expect(retrieve).toHaveBeenCalledWith({ database_id: GT });
    expect(failed).toBe(0);
    expect(games.map((g) => g.map)).toEqual(['Ilios', "King's Row"]);
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

  it('notionImprovementTarget seeds a stable, active self-target', () => {
    const t = notionImprovementTarget(1234);
    expect(t).toMatchObject({ id: NOTION_IMPROVEMENT_TARGET_ID, mode: 'self', isActive: true, createdAt: 1234 });
  });
});
