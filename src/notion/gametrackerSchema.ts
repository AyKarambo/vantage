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
 * The `select` option NAMES the live schema defines for each subjective column
 * that is a `select` (guarded on `type === 'select'`, so a wrong-typed column
 * contributes nothing). Keyed by canonical column name, verbatim from
 * `properties[col].select.options[].name` — casing preserved so the writer can
 * echo a discovered "None"/"none"/"N/A" back exactly (spec E1). Columns absent,
 * wrong-typed, or with no options are simply omitted from the map.
 */
export function subjectiveSelectOptions(
  properties: Record<string, { type?: string; select?: { options?: Array<{ name?: string }> } } | undefined>,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [column, expectedType] of Object.entries(OPTIONAL_SUBJECTIVE_PROPERTIES)) {
    if (expectedType !== 'select') continue;
    const prop = properties[column];
    if (prop?.type !== 'select') continue;
    const names = (prop.select?.options ?? [])
      .map((o) => o?.name)
      .filter((n): n is string => typeof n === 'string');
    out[column] = names;
  }
  return out;
}

/**
 * The discovered option NAME to write when a subjective select has no value — the
 * first option whose name is `none` case-insensitively (trimmed), returned
 * VERBATIM so the writer echoes the database's own casing (e.g. `None`). Undefined
 * when the column offers no such option, in which case the writer keeps today's
 * omit-on-create / blank-on-update behaviour and NEVER auto-creates the option
 * (spec E2). Deliberately narrow — only literal `none`, not `n/a`/`no`/etc — to
 * avoid mislabelling a user's own option as the unset sentinel.
 */
export function noneLikeOption(optionNames: readonly string[] | undefined): string | undefined {
  return (optionNames ?? []).find((name) => name.trim().toLowerCase() === 'none');
}

/** Notion property type, keyed by the property name, as returned by `dataSources.retrieve`. */
export type SubjectiveColumnStatus = 'available' | 'wrong-type' | 'near-miss' | 'missing';

/** Diagnostic for one subjective column, from live Gametracker schema discovery. */
export interface SubjectiveColumnDiag {
  /** Canonical column name, e.g. 'Comms'. */
  column: string;
  status: SubjectiveColumnStatus;
  /** The live property's actual type, when `status` is 'wrong-type'. */
  actualType?: string;
  /** The live property's actual name, when `status` is 'near-miss'. */
  actualName?: string;
}

/**
 * Classify ONE column purely from schema discovery (no writes, no per-match
 * data), against its expected Notion type: `available` (present with the right
 * type, so it *can* be written), `wrong-type` (present but the wrong Notion
 * type), `near-miss` (absent under the canonical name, but a live property name
 * matches after trimming whitespace and case-folding), or `missing` (absent, no
 * near-miss). Deliberately schema-level only — per-match "no value" is a
 * separate, sync-time skip reason (spec A3's third reason). Shared by
 * {@link diagnoseSubjectiveColumns} and {@link planColumnProvision} so the two
 * never diverge on what "present / wrong / near / absent" means.
 */
export function classifyColumn(
  properties: Record<string, { type?: string } | undefined>,
  column: string,
  expectedType: string,
): SubjectiveColumnDiag {
  const actual = properties[column];
  if (actual) {
    if (actual.type === expectedType) return { column, status: 'available' };
    return { column, status: 'wrong-type', actualType: actual.type };
  }
  // Absent under the canonical name — look for a live property whose name only
  // differs by whitespace/case (a rename the user probably meant). Last such
  // match wins, matching the historical inline behavior.
  const target = column.trim().toLowerCase();
  let nearMissName: string | undefined;
  for (const name of Object.keys(properties)) {
    if (name.trim().toLowerCase() === target) nearMissName = name;
  }
  if (nearMissName && nearMissName !== column) {
    return { column, status: 'near-miss', actualName: nearMissName };
  }
  return { column, status: 'missing' };
}

/**
 * Classify each of the 5 optional subjective columns from schema discovery —
 * a thin wrapper over {@link classifyColumn} across
 * {@link OPTIONAL_SUBJECTIVE_PROPERTIES}.
 */
export function diagnoseSubjectiveColumns(
  properties: Record<string, { type?: string } | undefined>,
): SubjectiveColumnDiag[] {
  return Object.entries(OPTIONAL_SUBJECTIVE_PROPERTIES).map(([column, expectedType]) =>
    classifyColumn(properties, column, expectedType),
  );
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

/**
 * The `dataSources.update` property-create payloads for every Gametracker column
 * Vantage can add to an *existing* data source — the single source of truth for
 * "what a missing Vantage column looks like". It is everything the
 * create-from-scratch schema defines ({@link buildGametrackerProperties}) EXCEPT
 * the two columns that can't be added additively — the `Name` **title** (a data
 * source already has exactly one title; a second can't be created) and the `Map`
 * **relation** (a relation needs a target data source, so it stays the
 * create/auto-provision-DB flow's job) — PLUS the 5 optional subjective columns
 * the writer fills in when present ({@link OPTIONAL_SUBJECTIVE_PROPERTIES}).
 * `Map` is absent for free (no maps id is passed); only `Name` is dropped
 * explicitly. Select options for Source/Role/Result stay pre-seeded (inherited
 * from `buildGametrackerProperties`) so a provisioned select matches the writer's
 * option names. A future field addition is one new entry here.
 */
export const PROVISIONABLE_PROPERTIES: Record<string, unknown> = (() => {
  const props = { ...buildGametrackerProperties() };
  delete props['Name'];
  return {
    ...props,
    Comms: { select: {} },
    'Improvement Target': { select: {} },
    Leaver: { select: {} },
    Tilt: { checkbox: {} },
    'Toxic Mates': { checkbox: {} },
  };
})();

/**
 * The Notion property type a create payload declares — its single top-level key
 * (`{ number: {} }` → `'number'`, `{ select: { options } }` → `'select'`). Lets
 * {@link planColumnProvision} derive expected types straight from the manifest,
 * with no parallel type table to keep in sync.
 */
export function expectedTypeOf(payload: unknown): string {
  return Object.keys(payload as Record<string, unknown>)[0];
}

/** The columns a validation should create vs. surface, from schema discovery. */
export interface ColumnProvisionPlan {
  /**
   * Genuinely-missing Vantage columns → their additive `dataSources.update`
   * create payload. Empty when the schema is already complete (idempotent).
   */
  toCreate: Record<string, unknown>;
  /**
   * Columns present-but-wrong-type or shadowed by a near-miss name — Vantage must
   * NOT create over these (a destructive retype / a confusing duplicate). Surfaced
   * to the user via the existing diagnostics, never touched.
   */
  blocked: SubjectiveColumnDiag[];
}

/**
 * Pure schema diff: classify every {@link PROVISIONABLE_PROPERTIES} column against
 * a database's live `properties` and split into what to create vs. what to leave
 * alone. `available` (present, right type) → nothing (idempotent); `missing` →
 * `toCreate` with its payload; `wrong-type` / `near-miss` → `blocked`. Client-free
 * so it unit-tests directly and drives the provisioning step at the edge.
 */
export function planColumnProvision(
  properties: Record<string, { type?: string } | undefined>,
): ColumnProvisionPlan {
  const toCreate: Record<string, unknown> = {};
  const blocked: SubjectiveColumnDiag[] = [];
  for (const [column, payload] of Object.entries(PROVISIONABLE_PROPERTIES)) {
    const diag = classifyColumn(properties, column, expectedTypeOf(payload));
    if (diag.status === 'missing') toCreate[column] = payload;
    else if (diag.status === 'wrong-type' || diag.status === 'near-miss') blocked.push(diag);
  }
  return { toCreate, blocked };
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
