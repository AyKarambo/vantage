/**
 * A map-name → mode resolver built from an effective map catalog. Shared by the
 * dashboard and match-detail pipelines so both resolve modes from the same
 * (possibly user-edited) table, with an `Unknown` fallback for names not present
 * (e.g. legacy GEP names) — matching the old `mapMode()` behavior.
 */
import type { MapMode } from '../maps';
import type { MapEntry } from './types';

export type MapModeResolver = (name: string) => MapMode;

export function makeMapMode(maps: readonly MapEntry[]): MapModeResolver {
  const table = new Map(maps.map((m) => [m.name, m.mode]));
  return (name: string) => table.get(name) ?? 'Unknown';
}
