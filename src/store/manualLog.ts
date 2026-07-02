import * as fs from 'fs';
import * as path from 'path';
import type { AuthoredTarget } from '../core/targets';

interface ManualState {
  /** Improvement targets the player authored in the builder. */
  targets: AuthoredTarget[];
}

/**
 * Durable store for the manual (◎) data the game can't detect — currently the
 * player's authored improvement targets. Manually-logged matches themselves are
 * appended to {@link ../store/history HistoryStore} as real GameRecords (so they
 * feed every dashboard stat, including the mental composite via `GameRecord.mental`).
 *
 * Same shape as HistoryStore/OutboxStore: a single JSON file with atomic writes,
 * dir-injected and Electron-free so it stays unit-testable.
 */
export class ManualStore {
  private readonly file: string;
  private readonly tmp: string;
  private state: ManualState;

  constructor(dir: string) {
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'manual.json');
    this.tmp = path.join(dir, 'manual.tmp.json');
    this.state = this.load();
  }

  targets(): AuthoredTarget[] {
    return [...this.state.targets];
  }

  /** Upsert a target by id (edit if it already exists, else append). */
  addTarget(target: AuthoredTarget): AuthoredTarget {
    const idx = this.state.targets.findIndex((t) => t.id === target.id);
    if (idx >= 0) this.state.targets[idx] = target;
    else this.state.targets.push(target);
    this.save();
    return target;
  }

  removeTarget(id: string): void {
    const before = this.state.targets.length;
    this.state.targets = this.state.targets.filter((t) => t.id !== id);
    if (this.state.targets.length !== before) this.save();
  }

  private load(): ManualState {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<ManualState>;
      return { targets: Array.isArray(parsed.targets) ? parsed.targets : [] };
    } catch {
      return { targets: [] };
    }
  }

  private save(): void {
    fs.writeFileSync(this.tmp, JSON.stringify(this.state, null, 2), 'utf8');
    fs.renameSync(this.tmp, this.file);
  }
}
