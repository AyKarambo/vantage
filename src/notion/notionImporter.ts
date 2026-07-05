import { Client } from '@notionhq/client';
import type { GameRecord } from '../core/analytics';
import type { Result, Role } from '../core/model';
import { gameTypeLabel } from '../core/matchFilter';

/**
 * Reads rows from a Notion Gametracker database back into local {@link GameRecord}s
 * — the inverse of {@link NotionWriter}. Best-effort and per-row isolated: a row
 * that can't be mapped is counted as failed, not fatal. Imported rows are treated
 * as manual (◎) and keyed by their stored Match ID for de-duplication upstream.
 */
export interface ImportOutcome {
  games: GameRecord[];
  failed: number;
}

const ROLES: Role[] = ['tank', 'damage', 'support', 'openQ'];
const RESULTS: Result[] = ['Win', 'Loss', 'Draw'];

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
  const timestamp = Date.parse(page.created_time ?? '') || Date.now();
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

  return {
    matchId,
    timestamp,
    account,
    role,
    map,
    result,
    gameType,
    source: 'manual',
    heroes,
    ...(durationMinutes != null ? { durationMinutes } : {}),
    ...(finalScore ? { finalScore } : {}),
    ...(perHero ? { perHero } : {}),
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
