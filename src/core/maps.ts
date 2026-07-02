/**
 * Overwatch 2 map → game-mode lookup. Shared by the sample generator and the
 * analytics/dashboard layer so "by game mode" grouping and per-match mode tags
 * come from one table. Pure data, no I/O.
 */
export type MapMode = 'Push' | 'Hybrid' | 'Escort' | 'Control' | 'Flashpoint' | 'Clash' | 'Unknown';

export const MAP_MODES: Record<string, MapMode> = {
  'New Queen Street': 'Push', Colosseo: 'Push', 'Esperança': 'Push', Runasapi: 'Push',
  "King's Row": 'Hybrid', Midtown: 'Hybrid', Eichenwalde: 'Hybrid', Hollywood: 'Hybrid', Numbani: 'Hybrid', 'Blizzard World': 'Hybrid', Paraíso: 'Hybrid',
  'Circuit Royal': 'Escort', Dorado: 'Escort', Havana: 'Escort', Junkertown: 'Escort', Rialto: 'Escort', 'Route 66': 'Escort', 'Shambali Monastery': 'Escort', 'Watchpoint: Gibraltar': 'Escort',
  'Antarctic Peninsula': 'Control', Busan: 'Control', Ilios: 'Control', 'Lijiang Tower': 'Control', Nepal: 'Control', Oasis: 'Control', Samoa: 'Control',
  'New Junk City': 'Flashpoint', Suravasa: 'Flashpoint', Aatlis: 'Flashpoint',
  Hanaoka: 'Clash', 'Throne of Anubis': 'Clash',
};

export function mapMode(name: string): MapMode {
  return MAP_MODES[name] ?? 'Unknown';
}
