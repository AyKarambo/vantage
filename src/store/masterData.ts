import * as fs from 'fs';
import * as path from 'path';
import { emptyOverrides, type MasterDataOverrides } from '../core/masterData';

/**
 * Durable master-data overrides — the user's add/edit/remove deltas over the
 * compiled default catalog. Same shape as the other stores: one JSON file with
 * atomic writes, dir-injected and Electron-free so it stays unit-testable.
 *
 * Only the *deltas* are persisted (never the full effective list), so a new app
 * version's changed built-ins always show through and edits survive updates
 * (spec AC 16/17). The core `mergeMasterData` folds these onto the defaults.
 */
export class MasterDataStore {
  private file: string;
  private tmp: string;
  private state: MasterDataOverrides;

  constructor(dir: string) {
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'masterData.json');
    this.tmp = path.join(dir, 'masterData.tmp.json');
    this.state = this.load();
  }

  /** The current override deltas (a defensive shallow copy). */
  all(): MasterDataOverrides {
    return { heroes: { ...this.state.heroes }, maps: { ...this.state.maps }, seasons: { ...this.state.seasons } };
  }

  /** Replace the whole override set (the provider computes the next set via core `apply.ts`). */
  replace(next: MasterDataOverrides): MasterDataOverrides {
    this.state = normalize(next);
    this.save();
    return this.all();
  }

  /**
   * Re-point at a new directory and reload — backing for the user-configurable
   * data location. The migration executor copies `masterData.json` first;
   * `relocate` just repoints and re-reads.
   */
  relocate(newDir: string): void {
    fs.mkdirSync(newDir, { recursive: true });
    this.file = path.join(newDir, 'masterData.json');
    this.tmp = path.join(newDir, 'masterData.tmp.json');
    this.state = this.load();
  }

  private load(): MasterDataOverrides {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<MasterDataOverrides>;
      return normalize(parsed);
    } catch {
      return emptyOverrides();
    }
  }

  private save(): void {
    fs.writeFileSync(this.tmp, JSON.stringify(this.state, null, 2), 'utf8');
    fs.renameSync(this.tmp, this.file);
  }
}

/** Coerce a possibly-partial/corrupt payload into a well-formed override set. */
function normalize(raw: Partial<MasterDataOverrides> | null | undefined): MasterDataOverrides {
  const obj = (v: unknown): Record<string, any> =>
    v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {};
  return {
    heroes: obj(raw?.heroes),
    maps: obj(raw?.maps),
    seasons: obj(raw?.seasons),
  };
}
