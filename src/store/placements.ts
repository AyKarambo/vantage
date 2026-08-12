import * as fs from 'fs';
import * as path from 'path';
import type { Role } from '../core/model';
import { rankKey } from '../core/rank';
import type { PlacementRun } from '../core/placements';

/** The full on-disk shape: runs and per-track declined-season bookkeeping, both keyed by {@link rankKey}. */
interface PlacementState {
  runs: Record<string, PlacementRun>;
  declined: Record<string, number[]>;
}

/**
 * Durable per-(account, role) placement-run tracking — the "10 fresh matches
 * after a season reset" bookkeeping the calculated-rank engine can't derive on
 * its own (it needs a `startedAt` and per-match predictions, both entered by
 * the player). Same shape as the other stores: a single JSON file with atomic
 * writes, dir-injected and Electron-free so it stays unit-testable. Sibling of
 * {@link ./rankAnchors RankAnchorStore}, which this mirrors closely.
 */
export class PlacementStore {
  private file: string;
  private tmp: string;
  private state: PlacementState;

  constructor(dir: string) {
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'placements.json');
    this.tmp = path.join(dir, 'placements.tmp.json');
    this.state = this.load();
  }

  /** Every stored run. */
  allRuns(): PlacementRun[] {
    return Object.values(this.state.runs);
  }

  /** The run for one (account, role), if any. */
  getRun(account: string, role: Role): PlacementRun | undefined {
    return this.state.runs[rankKey(account, role)];
  }

  /** Set (or replace) the run for its (account, role). */
  setRun(run: PlacementRun): PlacementRun {
    this.state.runs[rankKey(run.account, run.role)] = run;
    this.save();
    return run;
  }

  /** Drop the run for an (account, role). Returns whether anything was removed. */
  removeRun(account: string, role: Role): boolean {
    const key = rankKey(account, role);
    if (!(key in this.state.runs)) return false;
    delete this.state.runs[key];
    this.save();
    return true;
  }

  /** Reset-season starts already declined for a track ("not now" on the placement prompt). */
  declinedFor(account: string, role: Role): number[] {
    return this.state.declined[rankKey(account, role)] ?? [];
  }

  /** Record a decline for a track's season start. Idempotent — no duplicate entries. */
  addDeclined(account: string, role: Role, seasonStart: number): void {
    const key = rankKey(account, role);
    const existing = this.state.declined[key] ?? [];
    if (existing.includes(seasonStart)) return;
    this.state.declined[key] = [...existing, seasonStart];
    this.save();
  }

  /** Drop every run and decline record keyed to an account (across roles) — the
   *  placement half of deleting a detected account. Returns how many entries were removed. */
  removeAccount(account: string): number {
    let changed = 0;
    for (const run of Object.values(this.state.runs)) {
      if (run.account !== account) continue;
      delete this.state.runs[rankKey(run.account, run.role)];
      changed++;
    }
    for (const key of Object.keys(this.state.declined)) {
      if (keyAccount(key) !== account) continue;
      delete this.state.declined[key];
      changed++;
    }
    if (changed) this.save();
    return changed;
  }

  /** Move every run and decline record from one account label to another (account rename support). */
  relabel(from: string, to: string): number {
    if (from === to) return 0;
    let changed = 0;
    for (const run of Object.values(this.state.runs)) {
      if (run.account !== from) continue;
      delete this.state.runs[rankKey(from, run.role)];
      run.account = to;
      this.state.runs[rankKey(to, run.role)] = run;
      changed++;
    }
    for (const key of Object.keys(this.state.declined)) {
      if (keyAccount(key) !== from) continue;
      this.state.declined[rankKey(to, keyRole(key))] = this.state.declined[key];
      delete this.state.declined[key];
      changed++;
    }
    if (changed) this.save();
    return changed;
  }

  /**
   * Re-point this store at a new directory and reload its state from there —
   * the backing for the user-configurable data location (spec Area C). Plain
   * JSON file, no handle to close: the migration executor copies
   * `placements.json` before calling this; `relocate` just repoints and re-reads.
   */
  relocate(newDir: string): void {
    fs.mkdirSync(newDir, { recursive: true });
    this.file = path.join(newDir, 'placements.json');
    this.tmp = path.join(newDir, 'placements.tmp.json');
    this.state = this.load();
  }

  private load(): PlacementState {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<PlacementState>;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return emptyState();

      const rawRuns = parsed.runs;
      const runs: Record<string, PlacementRun> = {};
      if (rawRuns && typeof rawRuns === 'object' && !Array.isArray(rawRuns)) {
        for (const [key, run] of Object.entries(rawRuns as Record<string, any>)) {
          if (!run || typeof run !== 'object') continue;
          // A run missing its identity fields can't be keyed or used — drop it
          // rather than keep it half-formed. Everything else is spread through
          // as-is (not whitelist-projected, unlike RankAnchorStore.map()'s
          // deliberate whitelist) so unknown/forward-compat fields round-trip.
          if (!run.account || !run.role || typeof run.startedAt !== 'number') continue;
          runs[key] = { ...run, predictions: run.predictions ?? {} };
        }
      }

      const rawDeclined = parsed.declined;
      const declined: Record<string, number[]> = {};
      if (rawDeclined && typeof rawDeclined === 'object' && !Array.isArray(rawDeclined)) {
        for (const [key, seasons] of Object.entries(rawDeclined as Record<string, unknown>)) {
          declined[key] = Array.isArray(seasons) ? seasons.filter((s) => typeof s === 'number') : [];
        }
      }

      return { runs, declined };
    } catch {
      return emptyState();
    }
  }

  private save(): void {
    fs.writeFileSync(this.tmp, JSON.stringify(this.state, null, 2), 'utf8');
    fs.renameSync(this.tmp, this.file);
  }
}

function emptyState(): PlacementState {
  return { runs: {}, declined: {} };
}

// `declined` is keyed by `rankKey` (`account::role`) but has no record to read
// `account`/`role` back off of, unlike `runs` — split the key the same way
// {@link ../core/readiness/rankTrend rankTrendFor} does (role is the segment
// after the last `::`, tolerant of an account name that itself contains it).
function keyAccount(key: string): string {
  const sep = key.lastIndexOf('::');
  return sep >= 0 ? key.slice(0, sep) : key;
}

function keyRole(key: string): Role {
  const sep = key.lastIndexOf('::');
  return (sep >= 0 ? key.slice(sep + 2) : key) as Role;
}
