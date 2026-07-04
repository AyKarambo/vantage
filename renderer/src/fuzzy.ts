/**
 * A tiny hand-rolled fuzzy matcher for the command palette — subsequence
 * matching with word-start and prefix bonuses. No dependency, deliberately
 * simple: good ranking for short UI strings, not a search engine.
 */

/**
 * Score `query` against `text`. Higher is better; null = no match.
 * Every query char must appear in order; contiguous runs, word starts and a
 * text-prefix match score higher, longer texts score slightly lower.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase().trim();
  const t = text.toLowerCase();
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
export function fuzzyRank<T>(query: string, items: T[], textOf: (item: T) => string): T[] {
  return items
    .map((item) => ({ item, score: fuzzyScore(query, textOf(item)) }))
    .filter((r): r is { item: T; score: number } => r.score !== null)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.item);
}
