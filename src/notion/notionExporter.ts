import { emptyMatch, type MatchRecord, type Result } from '../core/model';
import type { GameRecord, MatchMental } from '../core/analytics';
import { leaverFlags, mergeLeaver } from '../core/leaver';
import { NotionWriter } from './notionWriter';
import { NOTION_IMPROVEMENT_TARGET_ID } from './notionImporter';
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

  /** Export each game not already in the outbox; per-game failures are counted, not thrown. */
  async export(
    games: GameRecord[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<{ ok: number; failed: number; skipped: number; error?: string }> {
    if (this.shapeIssues && this.shapeIssues.length) {
      return { ok: 0, failed: 0, skipped: 0, error: `Database is missing: ${this.shapeIssues.join(', ')}` };
    }
    let ok = 0;
    let failed = 0;
    let skipped = 0;
    for (const game of games) {
      if (this.outbox.isProcessed(game.matchId)) {
        skipped++;
        onProgress?.(ok + failed + skipped, games.length);
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
          mental: exportMental(game),
          improvementGrade: game.review?.grades?.[NOTION_IMPROVEMENT_TARGET_ID],
        });
        this.outbox.markProcessed(game.matchId);
        ok++;
      } catch {
        failed++;
      }
      onProgress?.(ok + failed + skipped, games.length);
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
    // The match-end time, so a `Played At`-capable database round-trips it back
    // on import instead of the row-creation time.
    endedAt: game.timestamp,
    mapName: game.map,
    outcome: resultToOutcome(game.result),
    heroRole: game.role,
    gameType: game.gameType,
    heroes: game.heroes,
    durationMinutes: game.durationMinutes,
    // Carry the round score and SR change through — both have Notion columns and
    // importer readers, so they round-trip (finalScore was silently dropped before).
    finalScore: game.finalScore,
    srDelta: game.srDelta,
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

/**
 * The after-game self-report to export, merged from both places it can live: the
 * quick-log `mental` and the Review screen's `review.flags`. Leaver is normalised
 * to the team-specific flags (folding the legacy single flag). Undefined when the
 * player flagged nothing, so a blank match writes no subjective columns.
 */
export function exportMental(game: GameRecord): MatchMental | undefined {
  const a = game.mental;
  const b = game.review?.flags;
  if (!a && !b) return undefined;
  const leaver = mergeLeaver(leaverFlags(a), leaverFlags(b));
  const mental: MatchMental = {};
  if (a?.tilt || b?.tilt) mental.tilt = true;
  if (a?.toxicMates || b?.toxicMates) mental.toxicMates = true;
  if (a?.positiveComms || b?.positiveComms) mental.positiveComms = true;
  if (leaver.myTeam) mental.leaverMyTeam = true;
  if (leaver.enemyTeam) mental.leaverEnemyTeam = true;
  return Object.keys(mental).length ? mental : undefined;
}
