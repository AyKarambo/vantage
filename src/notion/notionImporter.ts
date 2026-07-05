import { Client } from '@notionhq/client';
import type { GameRecord, MatchMental, MatchReview, TargetGrade } from '../core/analytics';
import type { Result, Role } from '../core/model';
import type { AuthoredTarget } from '../core/targets';
import { gameTypeLabel } from '../core/matchFilter';

/**
 * Reads rows from a Notion Gametracker database back into local {@link GameRecord}s
 * — the inverse of {@link NotionWriter}. Best-effort and per-row isolated: a row
 * that can't be mapped is counted as failed, not fatal. Rows are keyed by their
 * stored Match ID for de-duplication upstream; a hand-added row (no Match ID)
 * becomes a manual (◎) record with a fresh `manual-notion-*` id, while a row
 * carrying a real GEP Match ID restores as an auto-tracked (⚡) record.
 */
export interface ImportOutcome {
  games: GameRecord[];
  failed: number;
}

const ROLES: Role[] = ['tank', 'damage', 'support', 'openQ'];
const RESULTS: Result[] = ['Win', 'Loss', 'Draw'];

/** Notion's per-match "Improvement Target" select → our TargetGrade. */
const IMPROVEMENT_GRADES: Record<string, TargetGrade> = { hit: 'hit', partially: 'partial', missed: 'missed' };

/**
 * The single generic target the imported per-match "Improvement Target" grades
 * attach to. Notion tracks one improvement grade per match rather than our named
 * multi-target model, so the import maps them all onto this one authored target;
 * {@link notionImprovementTarget} seeds it so the grades surface on the dashboard.
 */
export const NOTION_IMPROVEMENT_TARGET_ID = 'notion-improvement-target';

/** The authored target the imported improvement grades are scored against. */
export function notionImprovementTarget(createdAt: number): AuthoredTarget {
  return {
    id: NOTION_IMPROVEMENT_TARGET_ID,
    name: 'Improvement Target',
    mode: 'self',
    rule: 'Imported from Notion — did you hit your improvement focus this match?',
    createdAt,
    isActive: true,
  };
}

export class NotionImporter {
  constructor(
    private readonly client: Client,
    private readonly gametrackerDatabaseId: string,
    private readonly mapsDatabaseId?: string,
  ) {}

  async import(): Promise<ImportOutcome> {
    // The Map column is a relation into the Maps database; resolving it to a name
    // needs that database's id. Prefer an explicitly configured one, but fall back
    // to reading it off the Gametracker schema — most users only ever pick their
    // Gametracker database, leaving mapsDatabaseId unset, in which case every map
    // would otherwise import as "Unknown".
    const mapsDbId = this.mapsDatabaseId || (await this.discoverMapsDbId());
    const mapsById = mapsDbId ? await this.loadMapNames(mapsDbId) : {};
    const pages = await this.queryAll(this.gametrackerDatabaseId);
    const games: GameRecord[] = [];
    let failed = 0;
    for (const page of pages) {
      try {
        const game = toGame(page, mapsById);
        if (game) games.push(game);
        else failed++;
      } catch {
        failed++;
      }
    }
    return { games, failed };
  }

  private async queryAll(databaseId: string): Promise<any[]> {
    const results: any[] = [];
    let cursor: string | undefined;
    do {
      const res: any = await this.client.databases.query({
        database_id: databaseId,
        start_cursor: cursor,
        page_size: 100,
      });
      results.push(...(res.results ?? []));
      cursor = res.has_more ? res.next_cursor ?? undefined : undefined;
    } while (cursor);
    return results;
  }

  private async loadMapNames(mapsDatabaseId: string): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const page of await this.queryAll(mapsDatabaseId)) out[page.id] = titleOf(page);
    return out;
  }

  /**
   * The database the Gametracker's `Map` relation points at, read straight off
   * the Gametracker schema. Lets map resolution work without a separately
   * configured mapsDatabaseId. Best-effort: undefined if the column is missing,
   * isn't a relation, or the retrieve fails.
   */
  private async discoverMapsDbId(): Promise<string | undefined> {
    try {
      const db: any = await this.client.databases.retrieve({ database_id: this.gametrackerDatabaseId });
      const mapProp = db?.properties?.['Map'];
      return mapProp?.type === 'relation' ? mapProp.relation?.database_id ?? undefined : undefined;
    } catch {
      return undefined;
    }
  }
}

/** Map one Gametracker page to a GameRecord; null when it can't be mapped meaningfully. */
function toGame(page: any, mapsById: Record<string, string>): GameRecord | null {
  const props = page?.properties ?? {};

  const result = RESULTS.find((r) => r === pickSelect(props['Result']));
  if (!result) return null; // Result is essential — a row without it is not a match.

  const roleSel = (pickSelect(props['Role']) ?? '').toLowerCase();
  const role = ROLES.find((r) => r.toLowerCase() === roleSel) ?? 'damage';
  const account = pickSelect(props['Account']) || 'You';
  const heroes = pickMulti(props['Hero(es) Played']);
  const gameTypeSel = pickSelect(props['Game Type']);
  const gameType = gameTypeSel ? gameTypeLabel(gameTypeSel) : 'Competitive';
  const mapRel = pickRelationId(props['Map']);
  const map = (mapRel && mapsById[mapRel]) || mapFromTitle(props['Name']) || 'Unknown';
  const matchId = pickText(props['Match ID']) || `manual-notion-${String(page.id).replace(/-/g, '')}`;
  // Prefer the real match-end time from `Played At` (written by the exporter, or
  // filled in by hand). Only when it's absent does the row's Notion creation time
  // stand in — which is minute-truncated and really means "when this row was
  // typed", so it's the fallback, not the source of truth.
  const timestamp = pickDate(props['Played At']) ?? (Date.parse(page.created_time ?? '') || Date.now());
  const durationMinutes = pickNumber(props['Match Duration (min)']);
  const finalScore = pickText(props['Final Score']);

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

  return {
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
    ...(finalScore ? { finalScore } : {}),
    ...(perHero ? { perHero } : {}),
    ...(mental ? { mental } : {}),
    ...(review ? { review } : {}),
  };
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
