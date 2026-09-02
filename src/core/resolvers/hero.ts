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
 *
 * GEP's own "not revealed" sentinel (`hero_name: "UNKNOWN"`, seen on a real
 * teardown/masked-roster capture) is treated the same as nullish -> undefined,
 * not title-cased into a fake hero literally named "Unknown".
 */
export function resolveHeroName(value: string | undefined | null): string | undefined {
  if (value === undefined || value === null) return undefined;
  const s = value.trim();
  if (s === '') return undefined;
  const key = heroKey(s);
  if (key === 'UNKNOWN') return undefined;
  return CANONICAL_BY_KEY[key] ?? titleCase(s);
}

/**
 * A hero's DEPLOYABLE, when `value` names one rather than a player.
 *
 * Overwatch's kill feed reports destroying a turret, pylon or trap as a kill
 * event like any other — victim `Takigano`, victim hero `Illari Healing Pylon`.
 * Counted naively that inflates the elimination tally in every single match, and
 * it is not an elimination: nobody died.
 *
 * The discriminator is structural rather than a hard-coded list of deployables
 * that would go stale on every hero release: a deployable is named
 * `<known hero> <thing>`, so it starts with a hero's key and is strictly longer.
 * There are no prefix collisions between hero names (checked across all 53), so
 * this can't misread one hero as another's deployable.
 *
 * A name that matches no hero at all returns `undefined` — deliberately treated
 * as a player, not a deployable. A brand-new hero GEP knows before this build
 * does should still have their deaths counted; the failure mode is a real
 * elimination counted as one, not a pylon counted forever.
 */
export function deployableOf(value: string | undefined | null): { hero: string; label: string } | undefined {
  if (value === undefined || value === null) return undefined;
  const key = heroKey(value);
  if (!key || CANONICAL_BY_KEY[key]) return undefined; // empty, or the hero themselves
  for (const [heroKeyed, hero] of Object.entries(CANONICAL_BY_KEY)) {
    if (key.length <= heroKeyed.length || !key.startsWith(heroKeyed)) continue;
    // Recover the readable tail from the ORIGINAL string rather than the
    // stripped key, so "Healing Pylon" keeps its spacing and casing.
    const tail = titleCase(value.trim()).slice(hero.length).trim();
    return { hero, label: tail || 'deployable' };
  }
  return undefined;
}
