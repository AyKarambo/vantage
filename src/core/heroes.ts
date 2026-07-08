/**
 * The canonical Overwatch hero list — the single source of truth for the
 * quick-log typeahead and the sample-data generator's hero pools. Pure data;
 * heroes GEP reports that aren't listed here still flow through everywhere
 * (the list assists input, it never gates it).
 */
import type { Role } from './model';

export const HEROES_BY_ROLE: Record<Exclude<Role, 'openQ'>, readonly string[]> = {
  tank: [
    'D.Va', 'Domina', 'Doomfist', 'Hazard', 'Junker Queen', 'Mauga', 'Orisa',
    'Ramattra', 'Reinhardt', 'Roadhog', 'Sigma', 'Winston', 'Wrecking Ball',
    'Zarya',
  ],
  damage: [
    'Anran', 'Ashe', 'Bastion', 'Cassidy', 'Echo', 'Emre', 'Freja', 'Genji',
    'Hanzo', 'Junkrat', 'Mei', 'Pharah', 'Reaper', 'Shion', 'Sierra', 'Sojourn',
    'Soldier: 76', 'Sombra', 'Symmetra', 'Torbjörn', 'Tracer', 'Vendetta',
    'Venture', 'Widowmaker',
  ],
  support: [
    'Ana', 'Baptiste', 'Brigitte', 'Illari', 'Jetpack Cat', 'Juno', 'Kiriko',
    'Lifeweaver', 'Lúcio', 'Mercy', 'Mizuki', 'Moira', 'Wuyang', 'Zenyatta',
  ],
};

/** Every hero, flat and alphabetical — the typeahead's base list. */
export const ALL_HEROES: readonly string[] = Object.values(HEROES_BY_ROLE)
  .flat()
  .sort((a, b) => a.localeCompare(b));
