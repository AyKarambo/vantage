import * as fs from 'fs';
import type { GameRecord } from '../core/analytics';
import type { HistoryStore } from './history';

/**
 * One-time import of a legacy `history.json` into the SQLite-backed
 * {@link HistoryStore}. Idempotent and safe to run on every launch:
 *
 * - no-op if the store already has rows (a prior run, or a DB synced in);
 * - no-op if the legacy file is absent, unreadable, corrupt, or not an array;
 * - **never modifies or deletes `history.json`** — it stays as a frozen backup.
 *
 * Returns how many games were imported (0 when skipped).
 */
export function migrateJsonHistory(store: HistoryStore, legacyJsonPath: string): { migrated: number } {
  if (store.count() > 0) return { migrated: 0 };

  let games: GameRecord[];
  try {
    const parsed = JSON.parse(fs.readFileSync(legacyJsonPath, 'utf8'));
    if (!Array.isArray(parsed)) return { migrated: 0 };
    games = parsed as GameRecord[];
  } catch {
    return { migrated: 0 };
  }

  if (!games.length) return { migrated: 0 };
  return { migrated: store.addMany(games).imported };
}
