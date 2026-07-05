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

  /** Snapshot of every stored game. */
  all(): GameRecord[] {
    return [...this.games];
  }

  /** True if a game with this match id is already stored. */
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

  /** Append many games in one atomic save, skipping ids already stored. */
  addMany(games: GameRecord[]): { imported: number; skipped: number } {
    let imported = 0;
    let skipped = 0;
    for (const game of games) {
      if (this.has(game.matchId)) {
        skipped++;
        continue;
      }
      this.games.push(game);
      imported++;
    }
    if (imported) this.save();
    return { imported, skipped };
  }

  /**
   * Patch a stored game's manual-layer fields in place (result/role/map/heroes/
   * gameType for hand-logged matches; mental/srDelta/review for any). Only the
   * provided keys change; false if the id is unknown. The caller is responsible
   * for not passing game-derived facts for auto-tracked (GEP) records.
   */
  editManual(
    matchId: string,
    patch: Partial<Pick<GameRecord, 'result' | 'role' | 'map' | 'heroes' | 'gameType' | 'mental' | 'srDelta' | 'review'>>,
  ): boolean {
    const game = this.games.find((g) => g.matchId === matchId);
    if (!game) return false;
    const target = game as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined) target[k] = v;
    }
    this.save();
    return true;
  }

  /** Total number of stored games. */
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

  /** Remove a game's review (the undo of a first-time save); false if there was none. */
  clearReview(matchId: string): boolean {
    const game = this.games.find((g) => g.matchId === matchId);
    if (!game?.review) return false;
    delete game.review;
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
