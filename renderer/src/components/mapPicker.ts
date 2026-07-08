/**
 * The strict map combobox shared by the quick-log card and the match-detail
 * editor: a locked typeahead whose committed value can only ever be a known
 * map name. Browse mode (empty query, on focus) lists recently-played maps
 * first from the ACTIVE competitive pool only — a map rotated out of the pool
 * is hidden from suggestions (log spec AC 21) but stays reachable by typing
 * its name (AC 22), just muted/deprioritized rather than hidden. The paired
 * {@link resolveMapName} is the save-time guard both surfaces validate with.
 */
import { typeahead } from './typeahead';

/** The slice of a master-data map entry the picker needs. */
export interface MapPickerEntry {
  name: string;
  isActive: boolean;
}

export interface MapPickerOpts {
  /** The committed value the field opens with ('' when logging fresh). */
  value: string;
  /** Every known map (active + inactive) — the search pool. */
  maps: ReadonlyArray<MapPickerEntry>;
  /** Map names from match history, newest first (duplicates fine) — ranks browse mode. */
  recentMaps: readonly string[];
  onChange: (value: string) => void;
}

/**
 * Resolve free-typed map text onto the known map list (case-insensitive).
 * Resolution is NOT gated by `isActive`: a user backfilling a game on a map
 * that has since rotated out of the pool must still be able to type it and log
 * it — only the browse suggestions hide inactive maps.
 */
export function resolveMapName(raw: string, maps: ReadonlyArray<MapPickerEntry>): string | null {
  const q = raw.trim().toLowerCase();
  if (!q) return null;
  return maps.map((m) => m.name).find((m) => m.toLowerCase() === q) ?? null;
}

/**
 * Browse order: recently-played first, then the rest — built from the active
 * pool only, so a rotated-out map never shows up unprompted.
 */
function browseSuggestions(maps: ReadonlyArray<MapPickerEntry>, recentMaps: readonly string[]): string[] {
  const active = maps
    .filter((m) => m.isActive)
    .map((m) => m.name)
    .sort((a, b) => a.localeCompare(b));
  const activeSet = new Set(active);
  const recent: string[] = [];
  for (const name of recentMaps) if (activeSet.has(name) && !recent.includes(name)) recent.push(name);
  const rest = active.filter((m) => !recent.includes(m));
  return [...recent, ...rest];
}

export function mapPicker(opts: MapPickerOpts): HTMLElement {
  return typeahead({
    value: opts.value,
    placeholder: 'start typing — recent maps listed first',
    suggestions: browseSuggestions(opts.maps, opts.recentMaps),
    // Every known map (active + inactive), sorted — the search pool, so a
    // rotated-out map is still reachable by typing its name.
    searchSuggestions: opts.maps.map((m) => m.name).sort((a, b) => a.localeCompare(b)),
    mutedItems: new Set(opts.maps.filter((m) => !m.isActive).map((m) => m.name)),
    strict: true,
    showOnFocus: true,
    inputClass: 'vt-input',
    onChange: opts.onChange,
  });
}
