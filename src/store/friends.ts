import * as fs from 'fs';
import * as path from 'path';
import { battleTagName } from '../core/model';
import type { FriendEntry } from '../shared/contract';

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
 * atomic tmp+rename writes, dir-injected and Electron-free.
 */
export class FriendStore {
  private file: string;
  private tmp: string;
  private state: Record<string, StoredFriend>;

  constructor(dir: string, private readonly now: () => number = () => Date.now()) {
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'friends.json');
    this.tmp = path.join(dir, 'friends.tmp.json');
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
    fs.mkdirSync(newDir, { recursive: true });
    this.file = path.join(newDir, 'friends.json');
    this.tmp = path.join(newDir, 'friends.tmp.json');
    this.state = this.load();
  }

  private load(): Record<string, StoredFriend> {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
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
    fs.writeFileSync(this.tmp, JSON.stringify(this.state, null, 2), 'utf8');
    fs.renameSync(this.tmp, this.file);
  }
}
