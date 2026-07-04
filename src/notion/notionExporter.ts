import { emptyMatch, type MatchRecord, type Result } from '../core/model';
import type { GameRecord } from '../core/analytics';
import { NotionWriter } from './notionWriter';
import { MapsCache } from './mapsCache';
import type { OutboxStore } from '../store/outbox';

/** On-demand export of analyzed games to the Notion Gametracker (one of several outputs). */
export class NotionExporter {
  constructor(
    private readonly writer: NotionWriter,
    private readonly maps: MapsCache,
    private readonly outbox: OutboxStore,
    /** Cached shape-validation issues (e.g. from `rebuildNotion`'s async validate); short-circuits the export when set. */
    private readonly shapeIssues?: string[],
  ) {}

  async export(games: GameRecord[]): Promise<{ ok: number; failed: number; skipped: number; error?: string }> {
    if (this.shapeIssues && this.shapeIssues.length) {
      return { ok: 0, failed: 0, skipped: 0, error: `Database is missing: ${this.shapeIssues.join(', ')}` };
    }
    let ok = 0;
    let failed = 0;
    let skipped = 0;
    for (const game of games) {
      if (this.outbox.isProcessed(game.matchId)) {
        skipped++;
        continue;
      }
      try {
        const map = await this.maps.resolve(game.map);
        await this.writer.createMatchPage({
          record: gameToMatchRecord(game),
          account: game.account,
          role: game.role,
          result: game.result,
          mapPageId: map.pageId,
        });
        this.outbox.markProcessed(game.matchId);
        ok++;
      } catch {
        failed++;
      }
    }
    return { ok, failed, skipped };
  }
}

/** Flatten a GameRecord (with per-hero rows) into the MatchRecord the writer expects. */
export function gameToMatchRecord(game: GameRecord): MatchRecord {
  const totals = (game.perHero ?? []).reduce(
    (acc, h) => ({
      eliminations: acc.eliminations + h.eliminations,
      deaths: acc.deaths + h.deaths,
      assists: acc.assists + h.assists,
      damage: acc.damage + h.damage,
      healing: acc.healing + h.healing,
      mitigation: acc.mitigation + h.mitigation,
    }),
    { eliminations: 0, deaths: 0, assists: 0, damage: 0, healing: 0, mitigation: 0 },
  );
  const hasStats = (game.perHero?.length ?? 0) > 0;
  return {
    ...emptyMatch(game.matchId),
    mapName: game.map,
    outcome: resultToOutcome(game.result),
    heroRole: game.role,
    gameType: game.gameType,
    heroes: game.heroes,
    durationMinutes: game.durationMinutes,
    eliminations: hasStats ? totals.eliminations : undefined,
    deaths: hasStats ? totals.deaths : undefined,
    assists: hasStats ? totals.assists : undefined,
    damage: hasStats ? totals.damage : undefined,
    healing: hasStats ? totals.healing : undefined,
    mitigation: hasStats ? totals.mitigation : undefined,
  };
}

function resultToOutcome(result: Result): string {
  return result === 'Win' ? 'Victory' : result === 'Loss' ? 'Defeat' : 'Draw';
}
