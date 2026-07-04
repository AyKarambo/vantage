/**
 * The Gametracker database shape — pure, Electron- and Notion-client-free so it
 * can be unit tested directly and shared by both auto-create
 * (`NotionAdmin.createGametracker`) and validation (`NotionAdmin.validate`).
 *
 * `REQUIRED_PROPERTIES` is exactly what `NotionWriter.createMatchPage` writes
 * (`src/notion/notionWriter.ts`) — the source of truth for the schema is the
 * writer, not the other way around. Extra user columns (the subjective
 * Leaver/Comms/Tilt fields the writer's docstring mentions) are tolerated by
 * validation; `Map` is only required when a maps database is configured, since
 * the writer already skips that relation when no map page id is available.
 */

/** Notion property type, keyed by the property name `NotionWriter` writes. */
export const REQUIRED_PROPERTIES: Record<string, string> = {
  Name: 'title',
  Source: 'select',
  Account: 'select',
  Role: 'select',
  Result: 'select',
  Map: 'relation',
  'Hero(es) Played': 'multi_select',
  Eliminations: 'number',
  Deaths: 'number',
  Assists: 'number',
  Damage: 'number',
  Healing: 'number',
  Mitigation: 'number',
  'Match Duration (min)': 'number',
  'Group Size': 'number',
  'Game Type': 'select',
  'Queue Type': 'select',
  'Final Score': 'rich_text',
  Battletag: 'rich_text',
  'Match ID': 'rich_text',
};

const SOURCE_OPTIONS = ['Auto', 'Manual'];
const RESULT_OPTIONS = ['Win', 'Loss', 'Draw'];
const ROLE_OPTIONS = ['tank', 'damage', 'support', 'openQ'];

function selectOptions(names: string[]): { options: Array<{ name: string }> } {
  return { options: names.map((name) => ({ name })) };
}

/**
 * Build the `properties` payload for `databases.create`, pre-seeding the select
 * options the app writes so a fresh database matches the export schema exactly.
 * The `Map` relation is included only when a Maps database id is supplied —
 * `databases.create` has no concept of an "optional" relation target.
 */
export function buildGametrackerProperties(mapsDatabaseId?: string): Record<string, unknown> {
  const props: Record<string, unknown> = {
    Name: { title: {} },
    Source: { select: selectOptions(SOURCE_OPTIONS) },
    Account: { select: {} },
    Role: { select: selectOptions(ROLE_OPTIONS) },
    Result: { select: selectOptions(RESULT_OPTIONS) },
    'Hero(es) Played': { multi_select: {} },
    Eliminations: { number: {} },
    Deaths: { number: {} },
    Assists: { number: {} },
    Damage: { number: {} },
    Healing: { number: {} },
    Mitigation: { number: {} },
    'Match Duration (min)': { number: {} },
    'Group Size': { number: {} },
    'Game Type': { select: {} },
    'Queue Type': { select: {} },
    'Final Score': { rich_text: {} },
    Battletag: { rich_text: {} },
    'Match ID': { rich_text: {} },
  };
  if (mapsDatabaseId) {
    props['Map'] = { relation: { database_id: mapsDatabaseId, single_property: {} } };
  }
  return props;
}

export interface ShapeValidation {
  ok: boolean;
  missing: string[];
  mismatched: string[];
}

/**
 * Compare a database's live `properties` (as returned by `databases.retrieve`)
 * against `REQUIRED_PROPERTIES`. Extra user columns are always tolerated.
 * `Map` is only required when `opts.requireMapRelation` is true (i.e. a Maps
 * database is configured) — otherwise its absence is not reported as missing.
 */
export function validateGametrackerShape(
  properties: Record<string, { type?: string } | undefined>,
  opts: { requireMapRelation?: boolean } = {},
): ShapeValidation {
  const missing: string[] = [];
  const mismatched: string[] = [];
  const requireMapRelation = opts.requireMapRelation ?? true;

  for (const [name, expectedType] of Object.entries(REQUIRED_PROPERTIES)) {
    if (name === 'Map' && !requireMapRelation) continue;
    const actual = properties[name];
    if (!actual) {
      missing.push(name);
      continue;
    }
    if (actual.type !== expectedType) {
      mismatched.push(name);
    }
  }

  return { ok: missing.length === 0 && mismatched.length === 0, missing, mismatched };
}
