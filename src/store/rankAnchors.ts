import type { Role } from '../core/model';
import {
  attachAdjustments, rankKey, type RankAdjustment, type RankAdjustmentDraft, type RankAnchor, type RankAnchorMap,
} from '../core/rank';
import type { JsonDoc, JsonDocs } from './jsonDocs';

/** A stored anchor plus the (account, role) it belongs to. */
export interface AnchorRecord extends RankAnchor {
  account: string;
  role: Role;
}

/**
 * Durable per-(account, role) rank anchors — the one-time "this is my rank now"
 * reading the calculated-rank engine replays SR deltas from. Same shape as the
 * other stores: a single JSON file with atomic writes, location-injected and
 * Electron-free so it stays unit-testable.
 */
export class RankAnchorStore {
  private readonly doc: JsonDoc;
  private state: Record<string, AnchorRecord>;
  /**
   * Rank adjustments (cheater compensation, manual corrections) — kept beside
   * the anchors in their own `rankAdjustments.json`, a plain array. Separate
   * from the anchor records so re-anchoring a track never touches them: the
   * engine simply ignores the ones at/before the new anchor (see
   * {@link ../core/rank attachAdjustments}).
   */
  private readonly adjDoc: JsonDoc;
  private adjustments: RankAdjustment[];
  private seq = 0;

  constructor(docs: JsonDocs) {
    this.doc = docs('rankAnchors.json');
    this.adjDoc = docs('rankAdjustments.json');
    this.state = this.load();
    this.adjustments = this.loadAdjustments();
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
    // Each anchor carries the adjustments after it, so every forward replay
    // (live rank, Matches "Rank at start", match detail, chart) honours them.
    return attachAdjustments(out, this.adjustments);
  }

  /** Every stored rank adjustment, newest first. */
  listAdjustments(): RankAdjustment[] {
    return [...this.adjustments].sort((a, b) => b.at - a.at);
  }

  /** Store a new adjustment (the id is assigned here) and return it. */
  addAdjustment(draft: RankAdjustmentDraft): RankAdjustment {
    const record: RankAdjustment = { id: `adj-${Date.now().toString(36)}-${(this.seq++).toString(36)}`, ...draft };
    this.adjustments.push(record);
    this.saveAdjustments();
    return record;
  }

  /**
   * Put a previously removed adjustment back under its own id — the toast's
   * Undo. A record whose id is already stored is left alone (idempotent, which
   * a repeated backup import relies on too). Returns whether it was added.
   */
  restoreAdjustment(record: RankAdjustment): boolean {
    if (this.adjustments.some((a) => a.id === record.id)) return false;
    this.adjustments.push({ ...record });
    this.saveAdjustments();
    return true;
  }

  /** Remove one adjustment by id; returns the removed record, or null when it wasn't there. */
  removeAdjustment(id: string): RankAdjustment | null {
    const i = this.adjustments.findIndex((a) => a.id === id);
    if (i < 0) return null;
    const [removed] = this.adjustments.splice(i, 1);
    this.saveAdjustments();
    return removed;
  }

  /** Set (or replace) the anchor for an (account, role). */
  set(record: AnchorRecord): AnchorRecord {
    this.state[rankKey(record.account, record.role)] = record;
    this.save();
    return record;
  }

  /**
   * Drop the anchor for a single (account, role). Returns whether one was there.
   *
   * Exists for the placement-run undo: a run started on a track that had no
   * anchor snapshots `null`, and restoring that snapshot has to mean "no anchor"
   * again — not "leave whatever the run's completion wrote". Without a per-track
   * delete, resetting such a run would strand a rank the player never set.
   */
  remove(account: string, role: Role): boolean {
    const key = rankKey(account, role);
    if (!(key in this.state)) return false;
    delete this.state[key];
    this.save();
    return true;
  }

  /** Drop every anchor keyed to an account (across roles) — the rank-anchor half
   *  of deleting a detected account. Returns how many anchors were removed. */
  removeAccount(account: string): number {
    let changed = 0;
    for (const a of Object.values(this.state)) {
      if (a.account !== account) continue;
      delete this.state[rankKey(a.account, a.role)];
      changed++;
    }
    if (changed) this.save();
    const before = this.adjustments.length;
    this.adjustments = this.adjustments.filter((a) => a.account !== account);
    if (this.adjustments.length !== before) this.saveAdjustments();
    return changed;
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
    let moved = 0;
    for (const a of this.adjustments) {
      if (a.account !== from) continue;
      a.account = to;
      moved++;
    }
    if (moved) this.saveAdjustments();
    return changed;
  }

  /**
   * Re-point this store at a new directory and reload its anchors from there —
   * the backing for the user-configurable data location (spec Area C). Plain
   * JSON file, no handle to close: the migration executor copies
   * `rankAnchors.json` before calling this; `relocate` just repoints and re-reads.
   */
  relocate(newDir: string): void {
    this.doc.relocate(newDir);
    this.adjDoc.relocate(newDir);
    this.state = this.load();
    this.adjustments = this.loadAdjustments();
  }

  private load(): Record<string, AnchorRecord> {
    try {
      const parsed = (this.doc.read() ?? {}) as Record<string, AnchorRecord>;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  private save(): void {
    this.doc.write(this.state);
  }

  private loadAdjustments(): RankAdjustment[] {
    try {
      const parsed = this.adjDoc.read();
      return Array.isArray(parsed)
        ? parsed.filter((a): a is RankAdjustment =>
          typeof a === 'object' && a !== null && typeof a.id === 'string' && typeof a.account === 'string'
          && typeof a.role === 'string' && typeof a.at === 'number' && typeof a.deltaPct === 'number')
        : [];
    } catch {
      return [];
    }
  }

  private saveAdjustments(): void {
    this.adjDoc.write(this.adjustments);
  }
}
