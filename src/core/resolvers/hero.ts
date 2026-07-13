import { ALL_HEROES } from '../heroes';

/**
 * GEP reports hero names in ALL CAPS — "ANA", "RAMATTRA", "WRECKING BALL",
 * "D.VA" — which do not match the canonical proper-case names the rest of
 * Vantage (and the user's logged history) key on. Resolve them back to canonical
 * spelling so live-captured heroes line up with existing data and master lists.
 *
 * Matching is diacritic- and punctuation-insensitive, so "LUCIO" -> "Lúcio",
 * "TORBJORN" -> "Torbjörn", "SOLDIER: 76" -> "Soldier: 76", and "D.VA"/"DVA" ->
 * "D.Va". A hero not in the table (a brand-new release GEP knows before this
 * build does) falls back to Title Case so it still reads correctly and flows
 * through — heroes.ts assists input, it never gates it.
 */

/** Uppercase, strip diacritics and every non-alphanumeric char -> a stable match key. */
export function heroKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // combining diacritical marks (é -> e, ö -> o)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/** Canonical hero name indexed by its match key — built once from the hero list. */
const CANONICAL_BY_KEY: Record<string, string> = Object.fromEntries(
  ALL_HEROES.map((name) => [heroKey(name), name]),
);

/** Title-case a whitespace-separated token stream: "WRECKING BALL" -> "Wrecking Ball". */
function titleCase(raw: string): string {
  return raw.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
}

/**
 * Resolve a GEP hero name to its canonical spelling. Nullish/empty -> undefined;
 * a known hero (any casing/punctuation) -> its canonical name; anything else ->
 * Title Case, so an unlisted hero still reads well instead of shouting.
 */
export function resolveHeroName(value: string | undefined | null): string | undefined {
  if (value === undefined || value === null) return undefined;
  const s = value.trim();
  if (s === '') return undefined;
  return CANONICAL_BY_KEY[heroKey(s)] ?? titleCase(s);
}
