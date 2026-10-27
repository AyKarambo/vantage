import { battleTagName } from '../core/model';
import type { FriendEntry } from '../shared/contract';
import type { JsonDoc, JsonDocs } from './jsonDocs';

/** One stored friend, keyed by {@link battleTagName}. */
interface StoredFriend {
  /** Display spelling — prefers the `#`-tagged form when one has been seen. */
  name: string;
  addedAt: number;
}

/**
 * Durable "friends" tags: players the user has marked on the Players screen.
 * Keyed by the player-index name key ({@link battleTagName}: the part before
 * `#`, lowercased) so `Alice#1234` and `Alice` are the same friend, matching
 * `PlayerListRow.key`. Local-only by design — friends are never exported to
 * Notion (guardrail 5). Same on-disk shape as the other stores: one JSON file,
 * atomic tmp+rename writes, location-injected and Electron-free.
 */
export class FriendStore {
  private readonly doc: JsonDoc;
  private state: Record<string, StoredFriend>;

  constructor(docs: JsonDocs, private readonly now: () => number = () => Date.now()) {
    this.doc = docs('friends.json');
    this.state = this.load();
  }

  /** Every friend, sorted by display name (case-insensitive). */
  list(): FriendEntry[] {
    return Object.entries(this.state)
      .map(([key, f]) => ({ key, name: f.name }))
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.key.localeCompare(b.key));
  }

  /** The friend name keys, for O(1) membership checks against `PlayerListRow.key`. */
  keys(): Set<string> {
    return new Set(Object.keys(this.state));
  }

  /**
   * Mark (`friend: true`) or unmark a player and return the new list. An empty
   * key is a no-op. Re-marking an existing friend keeps its `addedAt` and only
   * upgrades the stored spelling to a `#`-tagged one (the more specific name).
   */
  set(name: string, friend: boolean): FriendEntry[] {
    const key = battleTagName(name);
    if (!key) return this.list();
    if (friend) {
      const existing = this.state[key];
      const display = name.trim();
      if (!existing) {
        this.state[key] = { name: display, addedAt: this.now() };
      } else if (display.includes('#') && !existing.name.includes('#')) {
        existing.name = display;
      } else {
        return this.list();
      }
    } else {
      if (!(key in this.state)) return this.list();
      delete this.state[key];
    }
    this.save();
    return this.list();
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

  private load(): Record<string, StoredFriend> {
    try {
      const parsed = this.doc.read() ?? {};
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      const out: Record<string, StoredFriend> = {};
      for (const [key, v] of Object.entries(parsed as Record<string, Partial<StoredFriend>>)) {
        if (key && v && typeof v.name === 'string') out[key] = { name: v.name, addedAt: Number(v.addedAt) || 0 };
      }
      return out;
    } catch {
      return {};
    }
  }

  private save(): void {
    this.doc.write(this.state);
  }
}
