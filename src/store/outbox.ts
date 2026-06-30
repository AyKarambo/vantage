import * as fs from 'fs';
import * as path from 'path';
import type { MatchRecord } from '../core/model';

interface OutboxState {
  /** Matches awaiting a successful Notion write (retry queue). */
  pending: MatchRecord[];
  /** Match ids already written to Notion (dedupe), most-recent last. */
  processed: string[];
}

/**
 * Tiny durable store backed by a single JSON file with atomic writes.
 *
 * Deliberately not SQLite: this app logs a handful of matches a day, so a JSON
 * file gives the same durability + dedupe without a native build step. Takes a
 * directory in the constructor (no Electron import) so it is unit-testable.
 */
export class OutboxStore {
  private readonly file: string;
  private readonly tmp: string;
  private state: OutboxState;

  constructor(dir: string, private readonly maxProcessed = 5000) {
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'outbox.json');
    this.tmp = path.join(dir, 'outbox.tmp.json');
    this.state = this.load();
  }

  isProcessed(matchId: string): boolean {
    return this.state.processed.includes(matchId);
  }

  markProcessed(matchId: string): void {
    if (this.isProcessed(matchId)) return;
    this.state.processed.push(matchId);
    if (this.state.processed.length > this.maxProcessed) {
      this.state.processed = this.state.processed.slice(-this.maxProcessed);
    }
    this.save();
  }

  /** Queue a match for (re)try. No-op if already queued. */
  enqueue(record: MatchRecord): void {
    if (this.state.pending.some((r) => r.matchId === record.matchId)) return;
    this.state.pending.push(record);
    this.save();
  }

  remove(matchId: string): void {
    const before = this.state.pending.length;
    this.state.pending = this.state.pending.filter((r) => r.matchId !== matchId);
    if (this.state.pending.length !== before) this.save();
  }

  pending(): MatchRecord[] {
    return [...this.state.pending];
  }

  private load(): OutboxState {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw) as Partial<OutboxState>;
      return {
        pending: Array.isArray(parsed.pending) ? parsed.pending : [],
        processed: Array.isArray(parsed.processed) ? parsed.processed : [],
      };
    } catch {
      return { pending: [], processed: [] };
    }
  }

  private save(): void {
    fs.writeFileSync(this.tmp, JSON.stringify(this.state, null, 2), 'utf8');
    fs.renameSync(this.tmp, this.file);
  }
}
