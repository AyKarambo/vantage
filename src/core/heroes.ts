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

/**
 * Fold a hero name to an identity key that survives GEP casing, accents and
 * punctuation (Lúcio matches lucio, D.Va matches dva, "Soldier: 76" matches
 * soldier76), so a role can be looked up regardless of how the feed spells it.
 * Decomposes accents (NFD) and keeps only ASCII letters/digits — implemented by
 * codepoint so no combining-mark literals live in source.
 */
export function heroMatchKey(name: string): string {
  let out = '';
  for (const ch of name.toLowerCase().normalize('NFD')) {
    const c = ch.codePointAt(0) ?? 0;
    const isLetter = c >= 0x61 && c <= 0x7a; // a-z
    const isDigit = c >= 0x30 && c <= 0x39; // 0-9
    if (isLetter || isDigit) out += ch;
  }
  return out;
}

const ROLE_BY_HERO: ReadonlyMap<string, Exclude<Role, 'openQ'>> = new Map(
  (Object.entries(HEROES_BY_ROLE) as [Exclude<Role, 'openQ'>, readonly string[]][])
    .flatMap(([role, heroes]) => heroes.map((hero) => [heroMatchKey(hero), role] as const)),
);

/**
 * Pure hero to role lookup: inverts {@link HEROES_BY_ROLE} keyed by
 * {@link heroMatchKey}. Returns `undefined` for an unknown hero (never guessed) —
 * callers show the neutral role. Used to derive a scoreboard row's role when GEP
 * omitted `heroRole`.
 */
export function roleOfHero(hero: string | undefined): Exclude<Role, 'openQ'> | undefined {
  if (!hero) return undefined;
  return ROLE_BY_HERO.get(heroMatchKey(hero));
}
