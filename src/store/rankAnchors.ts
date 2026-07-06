import * as fs from 'fs';
import * as path from 'path';
import type { Role } from '../core/model';
import { rankKey, type RankAnchor, type RankAnchorMap } from '../core/rank';

/** A stored anchor plus the (account, role) it belongs to. */
export interface AnchorRecord extends RankAnchor {
  account: string;
  role: Role;
}

/**
 * Durable per-(account, role) rank anchors — the one-time "this is my rank now"
 * reading the calculated-rank engine replays SR deltas from. Same shape as the
 * other stores: a single JSON file with atomic writes, dir-injected and
 * Electron-free so it stays unit-testable.
 */
export class RankAnchorStore {
  private file: string;
  private tmp: string;
  private state: Record<string, AnchorRecord>;

  constructor(dir: string) {
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'rankAnchors.json');
    this.tmp = path.join(dir, 'rankAnchors.tmp.json');
    this.state = this.load();
  }

  /** Every stored anchor. */
  all(): AnchorRecord[] {
    return Object.values(this.state);
  }

  /** The anchor for one (account, role), if set. */
  get(account: string, role: Role): AnchorRecord | undefined {
    return this.state[rankKey(account, role)];
  }

  /** Anchors keyed for the rank engine (see {@link ../core/rank currentRank}). */
  map(): RankAnchorMap {
    const out: RankAnchorMap = {};
    for (const a of Object.values(this.state)) {
      out[rankKey(a.account, a.role)] = { tier: a.tier, division: a.division, progressPct: a.progressPct, setAt: a.setAt };
    }
    return out;
  }

  /** Set (or replace) the anchor for an (account, role). */
  set(record: AnchorRecord): AnchorRecord {
    this.state[rankKey(record.account, record.role)] = record;
    this.save();
    return record;
  }

  /** Move every anchor from one account label to another (keeps rank tracks intact on rename). */
  relabel(from: string, to: string): number {
    if (from === to) return 0;
    let changed = 0;
    for (const a of Object.values(this.state)) {
      if (a.account !== from) continue;
      delete this.state[rankKey(from, a.role)];
      a.account = to;
      this.state[rankKey(to, a.role)] = a;
      changed++;
    }
    if (changed) this.save();
    return changed;
  }

  /**
   * Re-point this store at a new directory and reload its anchors from there —
   * the backing for the user-configurable data location (spec Area C). Plain
   * JSON file, no handle to close: the migration executor copies
   * `rankAnchors.json` before calling this; `relocate` just repoints and re-reads.
   */
  relocate(newDir: string): void {
    fs.mkdirSync(newDir, { recursive: true });
    this.file = path.join(newDir, 'rankAnchors.json');
    this.tmp = path.join(newDir, 'rankAnchors.tmp.json');
    this.state = this.load();
  }

  private load(): Record<string, AnchorRecord> {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Record<string, AnchorRecord>;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  private save(): void {
    fs.writeFileSync(this.tmp, JSON.stringify(this.state, null, 2), 'utf8');
    fs.renameSync(this.tmp, this.file);
  }
}
