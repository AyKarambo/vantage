/**
 * Overwatch map → game-mode lookup. Shared by the sample generator and the
 * analytics/dashboard layer so "by game mode" grouping and per-match mode tags
 * come from one table. Pure data, no I/O.
 */
import { normalizeMapName } from './resolvers/map';

export type MapMode = 'Push' | 'Hybrid' | 'Escort' | 'Control' | 'Flashpoint' | 'Clash' | 'Unknown';

export const MAP_MODES: Record<string, MapMode> = {
  'New Queen Street': 'Push', Colosseo: 'Push', 'Esperança': 'Push', Runasapi: 'Push', 'Redwood Dam': 'Push',
  "King's Row": 'Hybrid', Midtown: 'Hybrid', Eichenwalde: 'Hybrid', Hollywood: 'Hybrid', Numbani: 'Hybrid', 'Blizzard World': 'Hybrid', Paraíso: 'Hybrid', 'Neon Junktion': 'Hybrid',
  'Circuit Royal': 'Escort', Dorado: 'Escort', Havana: 'Escort', Junkertown: 'Escort', Rialto: 'Escort', 'Route 66': 'Escort', 'Shambali Monastery': 'Escort', 'Watchpoint: Gibraltar': 'Escort',
  'Antarctic Peninsula': 'Control', Busan: 'Control', Ilios: 'Control', 'Lijiang Tower': 'Control', Nepal: 'Control', Oasis: 'Control', Samoa: 'Control',
  'New Junk City': 'Flashpoint', Suravasa: 'Flashpoint', Aatlis: 'Flashpoint',
  Hanaoka: 'Clash', 'Throne of Anubis': 'Clash',
};

/**
 * Maps that exist only in Overwatch's Stadium mode. They never appear in Quick
 * Play / Competitive, so they're kept out of the competitive pool and are never
 * re-introduced by the online Update (Settings → "Update from online source").
 */
export const STADIUM_ONLY_MAPS: readonly string[] = [
  'Arena Victoriae',
  'Gogadoro',
  'Place Lacroix',
  'Wuxing University',
];

const STADIUM_ONLY_KEYS: ReadonlySet<string> = new Set(STADIUM_ONLY_MAPS.map(normalizeMapName));

/** Whether a map is Stadium-only (matched on the normalized name, so API casing/spacing variants count). */
export function isStadiumOnlyMap(name: string): boolean {
  return STADIUM_ONLY_KEYS.has(normalizeMapName(name));
}

export function mapMode(name: string): MapMode {
  return MAP_MODES[name] ?? 'Unknown';
}

/**
 * A few Overwatch maps are reported by GEP as a numeric internal map id rather
 * than a display name — Neon Junktion, for instance, arrives as `"4140"`, which
 * then leaks straight through capture into history and the UI. Map those known
 * ids back to Vantage's canonical map name so live capture, storage, analytics
 * and Notion export all agree.
 *
 * Extend this table as new numeric-id maps surface in real captures (every raw
 * GEP message is logged by the app, so the id is easy to read off).
 */
export const GEP_MAP_ID_NAMES: Record<string, string> = {
  '4140': 'Neon Junktion',
};

/**
 * Normalize a raw GEP-reported map value to a canonical map name. A known numeric
 * GEP map id is translated to its name; any other value (already a real name) is
 * returned unchanged. `undefined`/empty passes through so callers keep their own
 * fallback (e.g. `?? 'Unknown'`).
 */
export function resolveGepMapName(raw: string | undefined): string | undefined {
  if (!raw) return raw;
  return GEP_MAP_ID_NAMES[raw.trim()] ?? raw;
}
