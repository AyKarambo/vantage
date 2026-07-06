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

/**
 * The optional date column carrying the real match-end time so it survives the
 * export→import round-trip. Not in {@link REQUIRED_PROPERTIES}: databases that
 * predate it (and hand-made ones) still validate and still export — they simply
 * fall back to the row's `created_time` on import. New auto-created databases
 * include it (see {@link buildGametrackerProperties}), and a user may add it by
 * hand to control the imported match date.
 */
export const PLAYED_AT_PROPERTY = 'Played At';

/** Whether a database's live properties include a usable `Played At` date column. */
export function hasPlayedAtColumn(properties: Record<string, { type?: string } | undefined>): boolean {
  return properties[PLAYED_AT_PROPERTY]?.type === 'date';
}

/**
 * The optional number column carrying the signed competitive SR change per match,
 * so it survives the export→import round-trip. Like {@link PLAYED_AT_PROPERTY} it's
 * Vantage-authored and optional — not in {@link REQUIRED_PROPERTIES}, so databases
 * without it still validate and export (they just skip the value). New auto-created
 * databases include it (see {@link buildGametrackerProperties}).
 */
export const SR_DELTA_PROPERTY = 'SR Delta';

/** Whether a database's live properties include a usable `SR Delta` number column. */
export function hasSrDeltaColumn(properties: Record<string, { type?: string } | undefined>): boolean {
  return properties[SR_DELTA_PROPERTY]?.type === 'number';
}

/**
 * Optional "subjective" columns the {@link ../notion/notionImporter NotionImporter}
 * *reads* but the auto-created schema doesn't define — a user adds these to their
 * own Gametracker by hand. The exporter writes them only when the target database
 * actually has the column (with the right type), because `pages.create` rejects an
 * undefined property. Names and types mirror the importer's readers exactly, so the
 * export→import round-trip is symmetric.
 */
export const OPTIONAL_SUBJECTIVE_PROPERTIES: Record<string, string> = {
  Comms: 'select',
  'Improvement Target': 'select',
  Leaver: 'select',
  Tilt: 'checkbox',
  'Toxic Mates': 'checkbox',
};

/** The subjective columns present (with their expected type) in a live schema. */
export function presentSubjectiveColumns(
  properties: Record<string, { type?: string } | undefined>,
): string[] {
  return Object.entries(OPTIONAL_SUBJECTIVE_PROPERTIES)
    .filter(([name, type]) => properties[name]?.type === type)
    .map(([name]) => name);
}

/**
 * The data source a `Map` relation column points at, if present — lets the exporter
 * resolve maps without a separately configured `mapsDatabaseId` (mirrors the
 * importer's `discoverMapsSourceId`). Undefined when Map is absent or not a relation.
 * Prefers `data_source_id` (the v5 field); falls back to `database_id` for shapes
 * that only carry the legacy field — `resolveDataSourceId` accepts either kind of id.
 */
export function mapRelationSourceId(
  properties: Record<string, { type?: string; relation?: { data_source_id?: string; database_id?: string } } | undefined>,
): string | undefined {
  const map = properties['Map'];
  return map?.type === 'relation' ? (map.relation?.data_source_id ?? map.relation?.database_id ?? undefined) : undefined;
}

function selectOptions(names: string[]): { options: Array<{ name: string }> } {
  return { options: names.map((name) => ({ name })) };
}

/**
 * Build the `properties` payload for `initial_data_source.properties`, pre-seeding
 * the select options the app writes so a fresh database matches the export schema
 * exactly. The `Map` relation is included only when a Maps data source id is
 * supplied — `databases.create` has no concept of an "optional" relation target.
 */
export function buildGametrackerProperties(mapsDataSourceId?: string): Record<string, unknown> {
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
    [PLAYED_AT_PROPERTY]: { date: {} },
    [SR_DELTA_PROPERTY]: { number: {} },
  };
  if (mapsDataSourceId) {
    props['Map'] = { relation: { data_source_id: mapsDataSourceId, single_property: {} } };
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
