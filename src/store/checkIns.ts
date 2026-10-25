import type { SessionCheckIn } from '../core/checkIn';
import type { JsonDoc, JsonDocs } from './jsonDocs';

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
 * Same on-disk shape as the other stores: a single JSON document, atomic
 * writes, location-injected and Electron-free so it stays unit-testable.
 */
export class CheckInStore {
  private readonly doc: JsonDoc;
  private state: SessionCheckIn[];

  constructor(docs: JsonDocs) {
    this.doc = docs('checkIns.json');
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
    this.doc.write(this.state);
    return entry;
  }

  /**
   * Re-point this store at a new directory and reload from there — the
   * backing for the user-configurable data location (spec Area C), same
   * contract as the other stores' `relocate`.
   */
  relocate(newDir: string): void {
    this.doc.relocate(newDir);
    this.state = this.load();
  }

  private load(): SessionCheckIn[] {
    const parsed = this.doc.read();
    return Array.isArray(parsed) ? parsed : [];
  }
}
