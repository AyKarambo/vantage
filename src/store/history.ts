import * as fs from 'fs';
import * as path from 'path';
import type { GameRecord, MatchReview } from '../core/analytics';

/**
 * Durable history of every analyzed game (the dataset behind the dashboard).
 * Separate from the Notion outbox, which only tracks export/dedupe state.
 */
export class HistoryStore {
  private readonly file: string;
  private readonly tmp: string;
  private games: GameRecord[];

  constructor(dir: string) {
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'history.json');
    this.tmp = path.join(dir, 'history.tmp.json');
    this.games = this.load();
  }

  all(): GameRecord[] {
    return [...this.games];
  }

  has(matchId: string): boolean {
    return this.games.some((g) => g.matchId === matchId);
  }

  /** Append a game (ignored if its match id is already stored). */
  add(game: GameRecord): boolean {
    if (this.has(game.matchId)) return false;
    this.games.push(game);
    this.save();
    return true;
  }

  count(): number {
    return this.games.length;
  }

  /** Append end-of-match capture paths to a stored game; false if the id is unknown. */
  addScreenshots(matchId: string, screenshots: string[]): boolean {
    const game = this.games.find((g) => g.matchId === matchId);
    if (!game || !screenshots.length) return false;
    game.screenshots = [...(game.screenshots ?? []), ...screenshots];
    this.save();
    return true;
  }

  /** Attach (or replace) the manual review on a stored game; false if the id is unknown. */
  setReview(matchId: string, review: MatchReview): boolean {
    const game = this.games.find((g) => g.matchId === matchId);
    if (!game) return false;
    game.review = review;
    this.save();
    return true;
  }

  /**
   * Bulk review import (one atomic save) for the legacy-localStorage migration.
   * Never overwrites an existing review; unknown match ids are skipped.
   */
  setReviews(entries: Array<{ matchId: string; review: MatchReview }>): { imported: number; skipped: number } {
    let imported = 0;
    let skipped = 0;
    for (const { matchId, review } of entries) {
      const game = this.games.find((g) => g.matchId === matchId);
      if (!game || game.review) {
        skipped++;
        continue;
      }
      game.review = review;
      imported++;
    }
    if (imported) this.save();
    return { imported, skipped };
  }

  private load(): GameRecord[] {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return Array.isArray(parsed) ? (parsed as GameRecord[]) : [];
    } catch {
      return [];
    }
  }

  private save(): void {
    fs.writeFileSync(this.tmp, JSON.stringify(this.games), 'utf8');
    fs.renameSync(this.tmp, this.file);
  }
}
