import * as fs from 'fs';
import * as path from 'path';
import type { AuthoredTarget, TargetMode } from '../core/targets';
import type { Role } from '../core/model';

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
  private file: string;
  private tmp: string;
  private state: ManualState;

  constructor(dir: string) {
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'manual.json');
    this.tmp = path.join(dir, 'manual.tmp.json');
    this.state = this.load();
  }

  /** Snapshot of every authored target. */
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

  /** Permanently delete a target by id (no-op if unknown). */
  removeTarget(id: string): void {
    const before = this.state.targets.length;
    this.state.targets = this.state.targets.filter((t) => t.id !== id);
    if (this.state.targets.length !== before) this.save();
  }

  /** Edit name/mode/rule (and measured scope) in place — createdAt and lifecycle
   *  state are preserved so accrued grades keep counting across edits. An absent
   *  `roleScope`/`heroScope` in the patch clears any previously-saved scope
   *  (e.g. switching a measured target back to self-rated). */
  updateTarget(
    id: string,
    patch: { name: string; mode: TargetMode; rule: string; roleScope?: Role; heroScope?: string },
  ): void {
    const t = this.state.targets.find((x) => x.id === id);
    if (!t) return;
    t.name = patch.name;
    t.mode = patch.mode;
    t.rule = patch.rule;
    if (patch.roleScope != null) t.roleScope = patch.roleScope;
    else delete t.roleScope;
    if (patch.heroScope != null) t.heroScope = patch.heroScope;
    else delete t.heroScope;
    this.save();
  }

  /** Toggle whether the target is graded on the Review screen. Activating (re)stamps
   *  `activatedAt` so the staleness clock restarts on each rotation into the active set. */
  setActive(id: string, active: boolean): void {
    const t = this.state.targets.find((x) => x.id === id);
    if (!t || t.isActive === active) return;
    t.isActive = active;
    if (active) t.activatedAt = Date.now();
    this.save();
  }

  /** Deactivate every active target in a single write — the "start a fresh focus" reset. */
  deactivateAll(): void {
    let changed = false;
    for (const t of this.state.targets) {
      if (t.isActive) {
        t.isActive = false;
        changed = true;
      }
    }
    if (changed) this.save();
  }

  /** Archive (soft-remove, restorable) or restore a target. */
  setArchived(id: string, archived: boolean): void {
    const t = this.state.targets.find((x) => x.id === id);
    if (!t) return;
    if (archived) t.archivedAt = Date.now();
    else delete t.archivedAt;
    this.save();
  }

  /**
   * Re-point this store at a new directory and reload its targets from there —
   * the backing for the user-configurable data location (spec Area C). Plain
   * JSON file, no handle to close: the migration executor copies `manual.json`
   * before calling this; `relocate` just repoints and re-reads.
   */
  relocate(newDir: string): void {
    fs.mkdirSync(newDir, { recursive: true });
    this.file = path.join(newDir, 'manual.json');
    this.tmp = path.join(newDir, 'manual.tmp.json');
    this.state = this.load();
  }

  private load(): ManualState {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<ManualState>;
      const targets = Array.isArray(parsed.targets) ? parsed.targets : [];
      // Legacy records predate the active flag (→ active) and the activatedAt
      // stamp (→ their creation time, so the staleness clock has a starting point).
      return {
        targets: targets.map((t) => ({
          ...t,
          isActive: t.isActive ?? true,
          activatedAt: t.activatedAt ?? t.createdAt,
        })),
      };
    } catch {
      return { targets: [] };
    }
  }

  private save(): void {
    fs.writeFileSync(this.tmp, JSON.stringify(this.state, null, 2), 'utf8');
    fs.renameSync(this.tmp, this.file);
  }
}
