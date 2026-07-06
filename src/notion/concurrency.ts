/**
 * Runs `fn` over `items` with at most `limit` in flight at once, rather than
 * one item after another — used where a fully-sequential `for` loop of
 * Notion API calls would serialize an entire round trip per item (e.g. the
 * importer's Match ID write-back over hundreds of hand-added rows). `fn` is
 * expected to handle its own per-item errors (as `stampMatchIds` already
 * does); a throw here aborts the whole run via `Promise.all`.
 */
export async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (next < items.length) {
      const index = next++;
      await fn(items[index], index);
    }
  });
  await Promise.all(workers);
}
