/**
 * Translate the OverFast API's game-mode strings into Vantage's `MapMode`
 * union. OverFast's `/maps` returns a `gamemodes: string[]` per map (lowercase
 * keys like `push`, `flashpoint`); it also lists arcade-only maps we don't
 * track. Vantage owns this mapping table (spec Resolved Q6) so a new official
 * competitive mode we don't yet recognize surfaces as `Unknown` for the user to
 * set, rather than being guessed.
 */
import type { MapMode } from '../maps';

/** OverFast gamemode key → Vantage competitive `MapMode`. */
const COMP_MODES: Record<string, MapMode> = {
  push: 'Push',
  hybrid: 'Hybrid',
  escort: 'Escort',
  assault: 'Unknown', // legacy 2CP — not a tracked competitive mode
  control: 'Control',
  flashpoint: 'Flashpoint',
  clash: 'Clash',
};

/** Arcade / non-competitive modes whose maps we ignore entirely. */
const ARCADE_MODES = new Set<string>([
  'deathmatch',
  'teamdeathmatch',
  'elimination',
  'capturetheflag',
  'ctf',
  'freeforall',
  'practicerange',
  'skirmish',
  'lockon',
  'petitesss', // any oddball keys stay dropped
]);

export interface ClassifiedMap {
  mode: MapMode;
  /** Whether the map should enter the catalog at all (false = arcade-only). */
  keep: boolean;
}

/**
 * Classify a map from its OverFast gamemodes: the first recognized competitive
 * mode wins; a map that is purely arcade is dropped (`keep:false`); anything
 * else (unknown but plausibly a new comp mode, or no modes listed) is kept as
 * `Unknown` and surfaced for the user to correct (AC 10).
 */
export function classifyGamemodes(gamemodes: readonly string[]): ClassifiedMap {
  const norm = gamemodes.map((g) => g.toLowerCase().trim()).filter(Boolean);
  for (const g of norm) {
    const mode = COMP_MODES[g];
    if (mode && mode !== 'Unknown') return { mode, keep: true };
  }
  if (norm.length > 0 && norm.every((g) => ARCADE_MODES.has(g) || COMP_MODES[g] === 'Unknown')) {
    return { mode: 'Unknown', keep: false };
  }
  return { mode: 'Unknown', keep: true };
}
