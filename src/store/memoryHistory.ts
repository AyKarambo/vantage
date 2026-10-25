import type { GameRecord, MatchReview } from '../core/analytics';
import type { MatchRecord } from '../core/model';
import { mergeImportedIntoLocal } from '../core/notionMerge';
import type { HistoryStore } from './history';
import type { JsonDoc } from './jsonDocs';
import { applyManualPatch, type ManualPatch } from './manualPatch';

/** The history operations the app's edges use — what both history stores provide. */
export type HistoryPort = Pick<
  HistoryStore,
  | 'all' | 'has' | 'add' | 'addMany' | 'editManual' | 'deleteByAccount' | 'deleteMatch' | 'relabelAccount'
  | 'count' | 'revision' | 'importedCount' | 'lastImportedAt' | 'removeImported'
  | 'setReview' | 'clearReview' | 'clearReviews' | 'setReviews' | 'mergeImported'
  | 'addPending' | 'allPending' | 'hasPending' | 'takePending' | 'removePending' | 'pendingCount'
>;

interface MemoryState {
  games: GameRecord[];
  pending: MatchRecord[];
}

const importedFrom = (g: GameRecord, source: 'notion' | 'file'): boolean =>
  g.importedAt != null && (g.importSource ?? 'notion') === source;

/**
 * {@link HistoryStore}'s semantics without SQLite: insertion order, insert-or-
 * ignore on `matchId`, the same review/import/pending rules — so the browser
 * preview (and tests) run the real provider against it. Optionally persisted
 * through a {@link JsonDoc}; reads hand out copies, like rows parsed from the DB.
 */
export class MemoryHistoryStore implements HistoryPort {
  private state: MemoryState;
  private changes = 0;
  private cache: { changes: number; games: GameRecord[] } | null = null;

  constructor(private readonly doc?: JsonDoc, seed: GameRecord[] = []) {
    const stored = doc?.read() as Partial<MemoryState> | undefined;
    this.state = {
      games: Array.isArray(stored?.games) ? stored.games : seed.map(clone),
      pending: Array.isArray(stored?.pending) ? stored.pending : [],
    };
  }

  all(): GameRecord[] {
    if (this.cache?.changes !== this.changes) this.cache = { changes: this.changes, games: this.state.games.map(clone) };
    return this.cache.games;
  }

  has(matchId: string): boolean {
    return this.find(matchId) !== undefined;
  }

  add(game: GameRecord): boolean {
    if (this.has(game.matchId)) return false;
    this.state.games.push(clone(game));
    this.commit();
    return true;
  }

  addMany(games: GameRecord[]): { imported: number; skipped: number } {
    let imported = 0;
    for (const g of games) if (this.add(g)) imported++;
    return { imported, skipped: games.length - imported };
  }

  editManual(matchId: string, patch: ManualPatch): boolean {
    return this.update(matchId, (g) => { applyManualPatch(g, patch); return true; });
  }

  deleteByAccount(account: string): number {
    return this.removeWhere((g) => g.account === account).length;
  }

  deleteMatch(matchId: string): GameRecord | undefined {
    return this.removeWhere((g) => g.matchId === matchId)[0];
  }

  relabelAccount(from: string, to: string): number {
    if (from === to) return 0;
    const games = this.state.games.filter((g) => g.account === from);
    for (const g of games) g.account = to;
    if (games.length) this.commit();
    return games.length;
  }

  count(): number {
    return this.state.games.length;
  }

  revision(): string {
    return `mem:${this.changes}`;
  }

  importedCount(source: 'notion' | 'file'): number {
    return this.state.games.filter((g) => importedFrom(g, source)).length;
  }

  lastImportedAt(source: 'notion' | 'file'): number | undefined {
    const stamps = this.state.games.filter((g) => importedFrom(g, source)).map((g) => g.importedAt!);
    return stamps.length ? Math.max(...stamps) : undefined;
  }

  removeImported(source: 'notion' | 'file'): GameRecord[] {
    return this.removeWhere((g) => importedFrom(g, source));
  }

  setReview(matchId: string, review: MatchReview): boolean {
    return this.update(matchId, (g) => { g.review = review; return true; });
  }

  clearReview(matchId: string): boolean {
    return this.update(matchId, (g) => {
      if (!g.review) return false;
      delete g.review;
      return true;
    });
  }

  clearReviews(matchIds: readonly string[]): void {
    for (const id of matchIds) this.clearReview(id);
  }

  setReviews(entries: Array<{ matchId: string; review: MatchReview }>): { imported: number; skipped: number } {
    let imported = 0;
    for (const { matchId, review } of entries) {
      const ok = this.update(matchId, (g) => {
        if (g.review) return false;
        g.review = review;
        return true;
      });
      if (ok) imported++;
    }
    return { imported, skipped: entries.length - imported };
  }

  mergeImported(entries: GameRecord[]): { merged: number; skipped: number } {
    let merged = 0;
    for (const imported of entries) {
      const ok = this.update(imported.matchId, (local) => {
        const patch = mergeImportedIntoLocal(local, imported);
        if (!patch) return false;
        if (patch.review !== undefined) local.review = patch.review;
        if (patch.mental !== undefined) local.mental = patch.mental;
        return true;
      });
      if (ok) merged++;
    }
    return { merged, skipped: entries.length - merged };
  }

  addPending(rec: MatchRecord): boolean {
    if (this.hasPending(rec.matchId)) return false;
    this.state.pending.push(clone(rec));
    this.state.pending.sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0));
    this.commit();
    return true;
  }

  allPending(): MatchRecord[] {
    return this.state.pending.map(clone);
  }

  hasPending(matchId: string): boolean {
    return this.state.pending.some((p) => p.matchId === matchId);
  }

  takePending(matchId: string): MatchRecord | undefined {
    const i = this.state.pending.findIndex((p) => p.matchId === matchId);
    if (i < 0) return undefined;
    const [rec] = this.state.pending.splice(i, 1);
    this.commit();
    return rec;
  }

  removePending(matchId: string): boolean {
    return this.takePending(matchId) !== undefined;
  }

  pendingCount(): number {
    return this.state.pending.length;
  }

  private find(matchId: string): GameRecord | undefined {
    return this.state.games.find((g) => g.matchId === matchId);
  }

  /** Run `change` on the stored record; it returns whether it changed anything. */
  private update(matchId: string, change: (g: GameRecord) => boolean): boolean {
    const game = this.find(matchId);
    if (!game || !change(game)) return false;
    this.commit();
    return true;
  }

  private removeWhere(pred: (g: GameRecord) => boolean): GameRecord[] {
    const removed = this.state.games.filter(pred);
    if (!removed.length) return [];
    this.state.games = this.state.games.filter((g) => !pred(g));
    this.commit();
    return removed.map(clone);
  }

  private commit(): void {
    this.changes++;
    this.doc?.write(this.state);
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
