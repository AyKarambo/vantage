/**
 * Stable identity keys for master-data entries. Kept in one tiny module so
 * merge, diff and apply all agree on what "the same hero/map/season" means.
 */
import { normalizeMapName } from '../resolvers/map';

/** Hero identity — the trimmed display name. */
export function heroKey(name: string): string {
  return name.trim();
}

/** Map identity — the normalized name (apostrophes/casing/spacing folded). */
export function mapKey(name: string): string {
  return normalizeMapName(name);
}

/** Season identity — `S:<iso-date>` of the UTC start instant. */
export function seasonKey(start: number): string {
  return `S:${new Date(start).toISOString().slice(0, 10)}`;
}
