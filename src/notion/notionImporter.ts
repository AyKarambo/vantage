import { Client } from '@notionhq/client';
import type { GameRecord, MatchMental, MatchReview, TargetGrade } from '../core/analytics';
import type { Result, Role } from '../core/model';
import { NOTION_IMPROVEMENT_TARGET_ID } from '../core/targets';
import { gameTypeLabel } from '../core/matchFilter';
import { resolveDataSourceId } from './dataSourceResolver';
import { queryDataSourcePages } from './pageScan';
import { effectiveMatchId, groupByEffectiveMatchId, pickCanonicalRow, rowRefOf } from './dedup';

/**
 * Reads rows from a Notion Gametracker database back into local {@link GameRecord}s
 * — the inverse of {@link NotionWriter}. Best-effort and per-row isolated: a row
 * that can't be mapped is counted as failed, not fatal. A hand-added row (no
 * Match ID) becomes a manual (◎) record keyed by the derived
 * `manual-notion-<page id>` id ({@link effectiveMatchId}); a row carrying a real
 * GEP Match ID restores as an auto-tracked (⚡) record.
 *
 * Each game also carries the Notion `pageId` it was read from (`page.id`), so
 * callers can thread it into `OutboxStore.recordImported` — an imported-then-
 * edited row updates its existing page in place instead of being re-created by
 * a later export.
 *
 * Two duplicate-handling passes run after the row-by-row mapping
 * (`specs/notion-sync-dedup.spec.md`):
 *  - **Canonical dedupe.** When several rows share an effective match id (the
 *    shape existing duplicates have: an original hand row + a re-created copy
 *    whose `Match ID` cell embeds the hand row's derived id), only the
 *    canonical row's game is returned — picked via {@link pickCanonicalRow},
 *    preferring whichever page the local ledger already points at
 *    (`ledgeredPageIdFor`) when the embedded-id rule doesn't resolve it. The
 *    rest are dropped from `games` and counted in `duplicates`, never stamped.
 *  - **Match ID write-back.** Each *returned* game whose row had no `Match ID`
 *    text gets that cell stamped with its derived id via `pages.update`, so a
 *    future ledger loss can still find the row (AC1). Per-row try/catch: a
 *    failed stamp changes nothing else about the row's import (AC2) — it is
 *    not counted in `failed`.
 */
export interface ImportOutcome {
  games: Array<GameRecord & { pageId: string }>;
  failed: number;
  /** Redundant copies collapsed into their canonical row across all groups —
   *  see the canonical-dedupe pass above. 0 when no row shared a match id. */
  duplicates: number;
}

const ROLES: Role[] = ['tank', 'damage', 'support', 'openQ'];
const RESULTS: Result[] = ['Win', 'Loss', 'Draw'];

/** Notion's per-match "Improvement Target" select → our TargetGrade. */
const IMPROVEMENT_GRADES: Record<string, TargetGrade> = { hit: 'hit', partially: 'partial', missed: 'missed' };

/**
 * The internal id the imported per-match "Improvement Target" grade is stored
 * under (`review.grades[NOTION_IMPROVEMENT_TARGET_ID]`) — re-exported here for
 * back-compat with existing importers of this module. The canonical definition
 * now lives in `src/core/targets` (`notionBookkeeping.ts`) so pure `core/` code
 * (aggregation, merge) can reference it without importing the Notion edge.
 */
export { NOTION_IMPROVEMENT_TARGET_ID };

export class NotionImporter {
  // Per-instance memo of resolveDataSourceId results, keyed by the configured id.
  // Both `discoverMapsSourceId` and `queryAll` need the Gametracker id resolved
  // (schema discovery reads the Map relation off it; the row query pages it), so
  // without this an import would call `databases.retrieve` for the same id twice.
  private readonly resolvedIds = new Map<string, string>();

  constructor(
    private readonly client: Client,
    private readonly gametrackerDatabaseId: string,
    private readonly mapsDatabaseId?: string,
    /**
     * Ledger lookup consulted for canonical-row selection when a duplicate
     * group's embedded-id rule doesn't resolve it (`pickCanonicalRow`'s second
     * precedence tier) — `NotionRuntime` passes `outbox.pageIdFor(id, dbId)`.
     * Optional so existing call sites (and tests) that don't care about the
     * ledger-preference tiebreak keep compiling unchanged.
     */
    private readonly ledgeredPageIdFor?: (matchId: string) => string | undefined,
  ) {}

  async import(): Promise<ImportOutcome> {
    // The Map column is a relation into the Maps data source; resolving it to a
    // name needs that data source's id. Prefer an explicitly configured one, but
    // fall back to reading it off the Gametracker schema — most users only ever
    // pick their Gametracker database, leaving mapsDatabaseId unset, in which case
    // every map would otherwise import as "Unknown". Best-effort: a missing or
    // undiscoverable Maps relation was never fatal to the import.
    const mapsSourceId = this.mapsDatabaseId || (await this.discoverMapsSourceId());
    const mapsById = mapsSourceId ? await this.loadMapNames(mapsSourceId) : {};
    // Unlike map discovery, a Gametracker resolution failure (bad token,
    // unshared/deleted database, network outage) must PROPAGATE out of import() —
    // `NotionRuntime.import` already try/catches this into `{ error }`, which the
    // sync card renders red, restoring the pre-migration surfaced-failure behavior.
    const pages = await this.queryAll(this.gametrackerDatabaseId);
    // Keyed by pageId so the canonical-dedupe pass below can map a picked
    // RowRef (built straight off the raw page, like the exporter/cleanup do)
    // back to its already-mapped game without re-mapping the page.
    const mapped = new Map<string, { game: GameRecord; hadMatchIdText: boolean }>();
    const rows: ReturnType<typeof rowRefOf>[] = [];
    let failed = 0;
    for (const page of pages) {
      try {
        const { game, hadMatchIdText } = toGame(page, mapsById);
        if (game) {
          mapped.set(String(page.id), { game, hadMatchIdText });
          rows.push(rowRefOf(page));
        } else failed++;
      } catch {
        failed++;
      }
    }

    // Canonical dedupe: several rows can share an effective match id (an
    // original hand row + a re-created copy). Keep only the canonical row's
    // game per group; count the rest as duplicates instead of importing them.
    const games: Array<GameRecord & { pageId: string }> = [];
    let duplicates = 0;
    for (const [matchId, group] of groupByEffectiveMatchId(rows)) {
      const canonical =
        group.length === 1
          ? group[0]
          : pickCanonicalRow(group, { ledgeredPageId: this.ledgeredPageIdFor?.(matchId) });
      duplicates += group.length - 1;
      const entry = mapped.get(canonical.pageId)!;
      games.push({ ...entry.game, pageId: canonical.pageId });
    }

    await this.stampMatchIds(games, mapped);

    return { games, failed, duplicates };
  }

  /**
   * Best-effort write-back (AC1/AC2): stamps the derived `manual-notion-*` id
   * into a returned row's `Match ID` cell when it had none. Per-row try/catch
   * — a failed stamp must not fail the row's import or be counted in
   * `failed` (the row already imported successfully; only the write-back is
   * skipped). Never called for rows dropped as duplicates or rows whose cell
   * already carried text.
   */
  private async stampMatchIds(
    games: Array<GameRecord & { pageId: string }>,
    mapped: Map<string, { game: GameRecord; hadMatchIdText: boolean }>,
  ): Promise<void> {
    for (const g of games) {
      const entry = mapped.get(g.pageId);
      if (!entry || entry.hadMatchIdText) continue;
      try {
        await this.client.pages.update({
          page_id: g.pageId,
          properties: { 'Match ID': { rich_text: [{ text: { content: g.matchId } }] } },
        } as any);
      } catch {
        // Best-effort: a stamp failure never affects the row's import outcome.
      }
    }
  }

  /**
   * Resolve `id` via the per-instance memo, then page through the shared
   * {@link queryDataSourcePages} loop with the already-resolved data source
   * id — the memo-free `queryAllPages` would re-resolve on every call,
   * defeating the "one `databases.retrieve` per configured id" guarantee
   * (see `resolvedIds`).
   */
  private async queryAll(id: string): Promise<any[]> {
    const dataSourceId = await this.resolve(id);
    return queryDataSourcePages(this.client, dataSourceId);
  }

  /** `resolveDataSourceId`, memoized per configured id so it only runs once per import. */
  private async resolve(id: string): Promise<string> {
    const cached = this.resolvedIds.get(id);
    if (cached) return cached;
    const resolved = await resolveDataSourceId(this.client, id);
    this.resolvedIds.set(id, resolved);
    return resolved;
  }

  private async loadMapNames(mapsSourceId: string): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const page of await this.queryAll(mapsSourceId)) out[page.id] = titleOf(page);
    return out;
  }

  /**
   * The data source the Gametracker's `Map` relation points at, read straight off
   * the Gametracker schema. Lets map resolution work without a separately
   * configured mapsDatabaseId. Best-effort: undefined if the column is missing,
   * isn't a relation, or the retrieve fails (unlike `queryAll`, this must NOT
   * propagate — a missing/undiscoverable Maps relation was never fatal). Prefers
   * `data_source_id` (v5), falls back to `database_id` — `resolveDataSourceId`
   * (via `queryAll`) accepts either.
   */
  private async discoverMapsSourceId(): Promise<string | undefined> {
    try {
      const sourceId = await this.resolve(this.gametrackerDatabaseId);
      const source: any = await this.client.dataSources.retrieve({ data_source_id: sourceId });
      const mapProp = source?.properties?.['Map'];
      return mapProp?.type === 'relation'
        ? (mapProp.relation?.data_source_id ?? mapProp.relation?.database_id ?? undefined)
        : undefined;
    } catch {
      return undefined;
    }
  }
}

/**
 * Map one Gametracker page to a GameRecord; null when it can't be mapped
 * meaningfully. Also reports `hadMatchIdText` — whether the row's `Match ID`
 * cell carried non-blank text BEFORE this import — so the caller can decide
 * whether the row needs its id stamped back (write-back never touches a row
 * that already had one, and never touches a row dropped as a duplicate).
 */
function toGame(page: any, mapsById: Record<string, string>): { game: GameRecord | null; hadMatchIdText: boolean } {
  const props = page?.properties ?? {};

  const result = RESULTS.find((r) => r === pickSelect(props['Result']));
  if (!result) return { game: null, hadMatchIdText: false }; // Result is essential — a row without it is not a match.

  const roleSel = (pickSelect(props['Role']) ?? '').toLowerCase();
  const role = ROLES.find((r) => r.toLowerCase() === roleSel) ?? 'damage';
  const account = pickSelect(props['Account']) || 'You';
  const heroes = pickMulti(props['Hero(es) Played']);
  const gameTypeSel = pickSelect(props['Game Type']);
  const gameType = gameTypeSel ? gameTypeLabel(gameTypeSel) : 'Competitive';
  const mapRel = pickRelationId(props['Map']);
  const map = (mapRel && mapsById[mapRel]) || mapFromTitle(props['Name']) || 'Unknown';
  const matchIdText = pickText(props['Match ID']);
  const hadMatchIdText = matchIdText.length > 0;
  const matchId = effectiveMatchId(String(page.id), matchIdText);
  // Prefer the real match-end time from `Played At` (written by the exporter, or
  // filled in by hand). Only when it's absent does the row's Notion creation time
  // stand in — which is minute-truncated and really means "when this row was
  // typed", so it's the fallback, not the source of truth.
  // Clamp to now: a future-dated Played At (typo, timezone slip, or a row someone
  // pre-filled ahead of playing) must not produce a future-stamped local record —
  // readiness silently drops those and the Matches list would pin it forever.
  const timestamp = Math.min(pickDate(props['Played At']) ?? (Date.parse(page.created_time ?? '') || Date.now()), Date.now());
  const durationMinutes = pickNumber(props['Match Duration (min)']);
  const finalScore = pickText(props['Final Score']);
  const srDelta = pickNumber(props['SR Delta']);

  const stats = {
    eliminations: pickNumber(props['Eliminations']),
    deaths: pickNumber(props['Deaths']),
    assists: pickNumber(props['Assists']),
    damage: pickNumber(props['Damage']),
    healing: pickNumber(props['Healing']),
    mitigation: pickNumber(props['Mitigation']),
  };
  // A single-hero row can carry its aggregate stats as one per-hero line; a
  // multi-hero row can't be split, so its stats stay on the (unavailable) feed.
  const perHero = heroes.length === 1 && Object.values(stats).some((v) => v != null)
    ? [{
        hero: heroes[0], role,
        eliminations: stats.eliminations ?? 0, deaths: stats.deaths ?? 0, assists: stats.assists ?? 0,
        damage: stats.damage ?? 0, healing: stats.healing ?? 0, mitigation: stats.mitigation ?? 0,
      }]
    : undefined;

  // The subjective self-report the user filled in on the row: leaver (split by
  // team), tilt, toxic mates, positive comms. Lives on `mental` so it counts in
  // the mental summary without marking the game "reviewed".
  const mental = mentalFrom(props);
  // The per-match improvement grade becomes a Review grade against the single
  // imported target (see NOTION_IMPROVEMENT_TARGET_ID). Attaching a review marks
  // the game graded, which is correct — the user already graded it in Notion.
  const grade = IMPROVEMENT_GRADES[(pickSelect(props['Improvement Target']) ?? '').toLowerCase()];
  const review: MatchReview | undefined = grade
    ? { at: timestamp, grades: { [NOTION_IMPROVEMENT_TARGET_ID]: grade }, flags: {} }
    : undefined;

  // Provenance follows the Match ID, not a hard-coded 'manual': a hand-added row
  // (no Match ID → a `manual-notion-*` id) is manual, but an app-exported
  // auto-tracked match carries its real GEP id and must restore as 'gep' so its
  // game-derived facts stay locked in the editor (matching `sourceOf`).
  const source: 'manual' | 'gep' = matchId.startsWith('manual') ? 'manual' : 'gep';

  const game: GameRecord = {
    matchId,
    timestamp,
    account,
    role,
    map,
    result,
    gameType,
    source,
    heroes,
    ...(durationMinutes != null ? { durationMinutes } : {}),
    ...(srDelta != null ? { srDelta } : {}),
    ...(finalScore ? { finalScore } : {}),
    ...(perHero ? { perHero } : {}),
    ...(mental ? { mental } : {}),
    ...(review ? { review } : {}),
  };
  return { game, hadMatchIdText };
}

// --- Notion property readers (inverse of notionWriter's builders) -------------

function pickSelect(prop: any): string | undefined {
  return prop?.select?.name ?? undefined;
}
function pickMulti(prop: any): string[] {
  return Array.isArray(prop?.multi_select) ? prop.multi_select.map((o: any) => o.name).filter(Boolean) : [];
}
function pickNumber(prop: any): number | undefined {
  return typeof prop?.number === 'number' ? prop.number : undefined;
}
function pickText(prop: any): string {
  return (prop?.rich_text ?? []).map((t: any) => t.plain_text ?? t.text?.content ?? '').join('').trim();
}
function pickRelationId(prop: any): string | undefined {
  return Array.isArray(prop?.relation) && prop.relation.length ? prop.relation[0].id : undefined;
}
/** A Notion date property → epoch ms, or undefined when unset/unparseable. */
function pickDate(prop: any): number | undefined {
  const start = prop?.date?.start;
  if (!start) return undefined;
  const ms = Date.parse(start);
  return Number.isNaN(ms) ? undefined : ms;
}
function pickCheckbox(prop: any): boolean {
  return prop?.checkbox === true;
}
/**
 * The imported after-game self-report. `Leaver` is a select (team|enemy) mapped
 * onto the two team-specific flags; `Comms` only contributes when positive (the
 * model tracks positive comms, not the negative variants). Undefined when the
 * row flagged nothing, so blank rows don't carry an empty mental object.
 */
function mentalFrom(props: any): MatchMental | undefined {
  const mental: MatchMental = {};
  const leaver = pickSelect(props['Leaver']);
  if (leaver === 'team') mental.leaverMyTeam = true;
  if (leaver === 'enemy') mental.leaverEnemyTeam = true;
  if (pickCheckbox(props['Tilt'])) mental.tilt = true;
  if (pickCheckbox(props['Toxic Mates'])) mental.toxicMates = true;
  if (pickSelect(props['Comms']) === 'positive') mental.positiveComms = true;
  return Object.keys(mental).length ? mental : undefined;
}
function titleOf(page: any): string {
  for (const value of Object.values<any>(page?.properties ?? {})) {
    if (value?.type === 'title') {
      const text = (value.title ?? []).map((t: any) => t.plain_text ?? '').join('').trim();
      if (text) return text;
    }
  }
  return '';
}
/** Fallback: the row title is "who · role · mapName · result" — pull the map part. */
function mapFromTitle(prop: any): string | undefined {
  const title = (prop?.title ?? []).map((t: any) => t.plain_text ?? '').join('').trim();
  const parts = title.split(' · ');
  return parts.length >= 4 ? parts[parts.length - 2] : undefined;
}
