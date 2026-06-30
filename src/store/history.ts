import * as fs from 'fs';
import * as path from 'path';
import type { GameRecord } from '../core/analytics';

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
