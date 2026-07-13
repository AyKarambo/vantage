/**
 * Overwatch GEP delivers `match_info.map` as a NUMERIC map id — documented
 * behaviour, e.g. `1207 = Nepal` (Overwolf ships the id→name table). This resolves
 * those ids to the app's canonical map names (see `src/core/maps.ts`). Seasonal /
 * event variants are folded to their base map so per-map analytics don't fragment.
 * A value that is already a name, or an id not in the table, passes through
 * unchanged — unknown maps degrade gracefully and stay resolvable later. Pure data.
 *
 * Source: https://dev.overwolf.com/ow-electron/live-game-data-gep/supported-games/overwatch/
 */

/** Overwolf Overwatch map-id → canonical map name (variant ids folded to the base map). */
export const MAP_ID_TO_NAME: Record<string, string> = {
  // Hybrid
  '212': "King's Row", '1713': "King's Row", // + Winter
  '687': 'Hollywood', '1707': 'Hollywood', // + Halloween
  '1677': 'Eichenwalde', '2036': 'Eichenwalde', // + Halloween
  '1886': 'Blizzard World', '2651': 'Blizzard World', // + Winter
  '468': 'Numbani',
  '2892': 'Midtown',
  '2360': 'Paraíso',
  '4140': 'Neon Junction',
  // Control
  '1634': 'Lijiang Tower', '1719': 'Lijiang Tower', // + Lunar New Year
  '3314': 'Antarctic Peninsula',
  '2018': 'Busan',
  '1645': 'Ilios',
  '1207': 'Nepal',
  '1694': 'Oasis',
  '3776': 'Samoa',
  // Escort
  '2087': 'Circuit Royal',
  '707': 'Dorado',
  '2628': 'Havana',
  '1878': 'Junkertown',
  '2161': 'Rialto',
  '1467': 'Route 66',
  '3205': 'Shambali Monastery',
  '388': 'Watchpoint: Gibraltar',
  // Push
  '2868': 'Colosseo',
  '3411': 'Esperança',
  '2795': 'New Queen Street',
  '3762': 'Runasapi',
  // Flashpoint
  '3603': 'New Junk City',
  '3390': 'Suravasa',
  '3893': 'Aatlis',
  // Clash
  '4439': 'Hanaoka',
  '4448': 'Throne of Anubis',
};

/**
 * Legacy / variant map-NAME spellings that fold to the current canonical name, so
 * a value already stored (or reported) under an old spelling still resolves. Numeric
 * ids live in {@link MAP_ID_TO_NAME} above.
 */
export const MAP_NAME_ALIASES: Record<string, string> = {
  'Neon Junktion': 'Neon Junction', // older builds spelled it with a 'k'
};

/**
 * Resolve a GEP `match_info.map` value: a numeric id → its canonical name; a legacy
 * name spelling → the canonical one; a value already canonical, or a numeric id not
 * in the table, passes through unchanged.
 */
export function resolveMapId(value: string | number | undefined | null): string | undefined {
  if (value === undefined || value === null) return undefined;
  const s = String(value).trim();
  if (s === '') return undefined;
  if (/^\d+$/.test(s)) return MAP_ID_TO_NAME[s] ?? s;
  return MAP_NAME_ALIASES[s] ?? s;
}
