/**
 * A tiny hand-rolled fuzzy matcher for the command palette — subsequence
 * matching with word-start and prefix bonuses. No dependency, deliberately
 * simple: good ranking for short UI strings, not a search engine.
 */

/**
 * Strip diacritics for comparison ("Esperança" → "esperanca") via Unicode
 * NFD decomposition — a base letter plus its combining accent marks split
 * apart, so dropping the U+0300-U+036F combining-mark block removes the
 * accent and leaves the plain letter. Comparison-only: canonical names are
 * still displayed/stored with their real accents.
 */
function foldAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Score `query` against `text`. Higher is better; null = no match.
 * Every query char must appear in order; contiguous runs, word starts and a
 * text-prefix match score higher, longer texts score slightly lower. Accents
 * are folded before matching, so "esperanca" finds "Esperança".
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = foldAccents(query.toLowerCase().trim());
  const t = foldAccents(text.toLowerCase());
  if (!q) return 0;

  let score = 0;
  let ti = 0;
  let lastHit = -2;
  for (const ch of q) {
    if (ch === ' ') continue; // spaces in the query separate words, not chars
    let found = -1;
    for (let i = ti; i < t.length; i++) {
      if (t[i] === ch) {
        found = i;
        break;
      }
    }
    if (found === -1) return null;
    score += 1;
    if (found === lastHit + 1) score += 2; // contiguous run
    if (found === 0 || t[found - 1] === ' ' || t[found - 1] === '-') score += 3; // word start
    lastHit = found;
    ti = found + 1;
  }
  if (t.startsWith(q)) score += 5;
  return score - t.length * 0.01;
}

/** Rank `items` by fuzzy score of `query` against their `textOf`; drops non-matches. */
export function fuzzyRank<T>(query: string, items: readonly T[], textOf: (item: T) => string): T[] {
  return items
    .map((item) => ({ item, score: fuzzyScore(query, textOf(item)) }))
    .filter((r): r is { item: T; score: number } => r.score !== null)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.item);
}

/** A fuzzy match confident enough to auto-commit without the player picking it. */
const NEAR_MISS_MIN_SCORE = 4;
/** How much the top match must beat the runner-up by to still count as unambiguous. */
const NEAR_MISS_MARGIN = 3;
/**
 * Below this many typed characters, auto-committing is refused outright even
 * with a clean score — a short prefix ("o") legitimately scores high against
 * a name that starts with it ("Oasis") without the player having typed enough
 * to mean it, so length is its own floor rather than only score+margin.
 */
const NEAR_MISS_MIN_LENGTH = 4;

/**
 * Resolve near-miss typed text onto exactly one confident, unambiguous entry
 * of `pool` — a missing apostrophe ("kings row" → "King's Row"), a dropped
 * accent ("esperanca" → "Esperança") — or `null` when the text is too short
 * to commit to, nothing scores high enough, or two candidates are too close
 * to call. Pure; the strict typeahead (see {@link ../components/typeahead})
 * is the one caller, on blur, once an exact match has already failed.
 */
export function resolveNearMiss(raw: string, pool: readonly string[]): string | null {
  if (raw.trim().length < NEAR_MISS_MIN_LENGTH) return null;
  const ranked = pool
    .map((s) => ({ s, score: fuzzyScore(raw, s) }))
    .filter((r): r is { s: string; score: number } => r.score !== null)
    .sort((a, b) => b.score - a.score);
  const [top, second] = ranked;
  if (!top || top.score < NEAR_MISS_MIN_SCORE) return null;
  if (second && top.score - second.score < NEAR_MISS_MARGIN) return null;
  return top.s;
}
