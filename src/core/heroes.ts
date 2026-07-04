/**
 * The canonical Overwatch 2 hero list — the single source of truth for the
 * quick-log typeahead and the sample-data generator's hero pools. Pure data;
 * heroes GEP reports that aren't listed here still flow through everywhere
 * (the list assists input, it never gates it).
 */
import type { Role } from './model';

export const HEROES_BY_ROLE: Record<Exclude<Role, 'openQ'>, readonly string[]> = {
  tank: [
    'D.Va', 'Doomfist', 'Hazard', 'Junker Queen', 'Mauga', 'Orisa', 'Ramattra',
    'Reinhardt', 'Roadhog', 'Sigma', 'Winston', 'Wrecking Ball', 'Zarya',
  ],
  damage: [
    'Ashe', 'Bastion', 'Cassidy', 'Echo', 'Freja', 'Genji', 'Hanzo', 'Junkrat',
    'Mei', 'Pharah', 'Reaper', 'Sojourn', 'Soldier: 76', 'Sombra', 'Symmetra',
    'Torbjörn', 'Tracer', 'Venture', 'Widowmaker',
  ],
  support: [
    'Ana', 'Baptiste', 'Brigitte', 'Illari', 'Juno', 'Kiriko', 'Lifeweaver',
    'Lúcio', 'Mercy', 'Moira', 'Wuyang', 'Zenyatta',
  ],
};

/** Every hero, flat and alphabetical — the typeahead's base list. */
export const ALL_HEROES: readonly string[] = Object.values(HEROES_BY_ROLE)
  .flat()
  .sort((a, b) => a.localeCompare(b));
