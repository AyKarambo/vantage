import * as fs from 'fs';
import * as path from 'path';
import type { SessionCheckIn } from '../core/checkIn';

/**
 * How many check-ins to keep. A check-in only ever matters for the ONE
 * sitting it immediately precedes ({@link ../core/mentalAnalytics tiltByCheckIn}'s
 * gap window), so this is generous headroom for the trend read on Mental
 * (S10 phase 2) rather than a number anyone is expected to approach —
 * several years of daily play, at most one relevant check-in per sitting.
 */
const MAX_CHECK_INS = 500;

/**
 * Durable pre-session mood check-ins ("Calm / Edgy / Tilted", logged before
 * queuing) — a plain, revision-stamped array rather than keyed storage like
 * {@link ./rankAnchors RankAnchorStore} or {@link ./placements PlacementStore},
 * since a check-in isn't attached to any existing entity (account, role,
 * match) — it precedes the sitting it eventually gets matched against.
 * Same on-disk shape as the other stores: a single JSON file, atomic writes,
 * dir-injected and Electron-free so it stays unit-testable.
 */
export class CheckInStore {
  private file: string;
  private tmp: string;
  private state: SessionCheckIn[];

  constructor(dir: string) {
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'checkIns.json');
    this.tmp = path.join(dir, 'checkIns.tmp.json');
    this.state = this.load();
  }

  /** Every stored check-in, oldest first. */
  all(): SessionCheckIn[] {
    return [...this.state];
  }

  /** Append a check-in, trimming the oldest entries past {@link MAX_CHECK_INS}. */
  add(entry: SessionCheckIn): SessionCheckIn {
    this.state.push(entry);
    this.state.sort((a, b) => a.at - b.at);
    if (this.state.length > MAX_CHECK_INS) this.state = this.state.slice(this.state.length - MAX_CHECK_INS);
    this.save();
    return entry;
  }

  /**
   * Re-point this store at a new directory and reload from there — the
   * backing for the user-configurable data location (spec Area C), same
   * contract as the other stores' `relocate`.
   */
  relocate(newDir: string): void {
    fs.mkdirSync(newDir, { recursive: true });
    this.file = path.join(newDir, 'checkIns.json');
    this.tmp = path.join(newDir, 'checkIns.tmp.json');
    this.state = this.load();
  }

  private load(): SessionCheckIn[] {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private save(): void {
    fs.writeFileSync(this.tmp, JSON.stringify(this.state, null, 2), 'utf8');
    fs.renameSync(this.tmp, this.file);
  }
}
