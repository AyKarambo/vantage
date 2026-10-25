import { emptyOverrides, type MasterDataOverrides } from '../core/masterData';
import type { JsonDoc, JsonDocs } from './jsonDocs';

/**
 * Durable master-data overrides — the user's add/edit/remove deltas over the
 * compiled default catalog. Same shape as the other stores: one JSON file with
 * atomic writes, location-injected and Electron-free so it stays unit-testable.
 *
 * Only the *deltas* are persisted (never the full effective list), so a new app
 * version's changed built-ins always show through and edits survive updates
 * (spec AC 16/17). The core `mergeMasterData` folds these onto the defaults.
 */
export class MasterDataStore {
  private readonly doc: JsonDoc;
  private state: MasterDataOverrides;

  constructor(docs: JsonDocs) {
    this.doc = docs('masterData.json');
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
    this.doc.relocate(newDir);
    this.state = this.load();
  }

  private load(): MasterDataOverrides {
    try {
      const parsed = (this.doc.read() ?? {}) as Partial<MasterDataOverrides>;
      return normalize(parsed);
    } catch {
      return emptyOverrides();
    }
  }

  private save(): void {
    this.doc.write(this.state);
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
