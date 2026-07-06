/**
 * Pure id-derivation, grouping and canonical-row selection for Notion
 * Gametracker duplicate handling — client-free like `gametrackerSchema.ts` so
 * it can be unit tested directly and shared by the importer, the exporter's
 * create-guard and the opt-in cleanup action (`specs/notion-sync-dedup.spec.md`).
 *
 * The single id-derivation rule (`effectiveMatchId`) is extracted from the
 * importer's inline logic (`notionImporter.ts`'s `toGame`,
 * `matchId = pickText(...) || 'manual-notion-' + page.id sans dashes`) so
 * every caller that needs to know "what match id does this row represent"
 * agrees, including hand-added rows whose `Match ID` cell is empty.
 */

/** Minimal projection of a raw Notion Gametracker page needed for dedup. */
export interface RowRef {
  pageId: string;
  matchIdText?: string;
  createdTime?: string;
}

/**
 * The match id a Gametracker row represents: its `Match ID` cell text when
 * non-empty (surrounding whitespace-only text counts as absent), else the id
 * the importer would generate for it — `'manual-notion-' + pageId` with
 * dashes stripped. Mirrors `notionImporter.ts`'s `toGame` exactly so import,
 * export create-guard and cleanup all key off the same id for a given row.
 */
export function effectiveMatchId(pageId: string, matchIdText?: string): string {
  const text = matchIdText?.trim();
  return text || `manual-notion-${pageId.replace(/-/g, '')}`;
}

/**
 * The page id embedded in a `manual-notion-<32 hex>` match id, restored to
 * the dashed 8-4-4-4-12 UUID form Notion page ids use — else `undefined`.
 * Strict on purpose: only exactly 32 hex characters after the prefix count
 * (a GEP match id, a legacy `manual-<timestamp>` id, or a malformed/wrong-
 * length suffix are never derivable and must not be mistaken for one).
 */
export function embeddedPageId(matchId: string): string | undefined {
  const match = /^manual-notion-([0-9a-f]{32})$/i.exec(matchId);
  if (!match) return undefined;
  const hex = match[1].toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Project a raw Notion page (as returned by `dataSources.query` /
 * `pages.retrieve`) down to the fields dedup needs: `id`, `created_time`, and
 * the `Match ID` rich_text joined to plain text — mirrors `notionImporter.ts`'s
 * `pickText` reader exactly (`plain_text` preferred, falling back to
 * `text.content`, joined and trimmed).
 */
export function rowRefOf(page: any): RowRef {
  const pageId = String(page?.id ?? '');
  const createdTime = page?.created_time ?? undefined;
  const richText = page?.properties?.['Match ID']?.rich_text;
  const matchIdText = Array.isArray(richText)
    ? richText.map((t: any) => t.plain_text ?? t.text?.content ?? '').join('').trim()
    : '';
  return { pageId, createdTime, ...(matchIdText ? { matchIdText } : {}) };
}

/**
 * Group rows by {@link effectiveMatchId}. Every row lands in some group, so
 * singleton groups (no duplicate) are included alongside groups of 2+ —
 * callers filter for `size > 1` when they only care about duplicates.
 */
export function groupByEffectiveMatchId(rows: RowRef[]): Map<string, RowRef[]> {
  const groups = new Map<string, RowRef[]>();
  for (const row of rows) {
    const id = effectiveMatchId(row.pageId, row.matchIdText);
    const group = groups.get(id);
    if (group) group.push(row);
    else groups.set(id, [row]);
  }
  return groups;
}

/**
 * Deterministically pick the one row in a duplicate group that should survive
 * as canonical, in precedence order:
 *
 * 1. The row whose `pageId` (dashes stripped) is embedded in the group's
 *    effective match id — the original hand-added row a `manual-notion-*`
 *    copy was derived from, which may carry hand-authored extra columns.
 * 2. The row matching `opts.ledgeredPageId`, when supplied — what the local
 *    ledger already points at.
 * 3. The earliest `createdTime` (ISO string comparison; rows missing
 *    `createdTime` sort last), tiebroken by lexicographically smallest
 *    `pageId` so the result is stable regardless of input order.
 *
 * `rows` must be non-empty; the single-row case simply returns that row.
 */
export function pickCanonicalRow(rows: RowRef[], opts?: { ledgeredPageId?: string }): RowRef {
  if (rows.length === 1) return rows[0];

  const effectiveId = effectiveMatchId(rows[0].pageId, rows[0].matchIdText);
  const embedded = embeddedPageId(effectiveId);
  if (embedded) {
    const byEmbedded = rows.find((r) => r.pageId === embedded);
    if (byEmbedded) return byEmbedded;
  }

  if (opts?.ledgeredPageId) {
    const byLedger = rows.find((r) => r.pageId === opts.ledgeredPageId);
    if (byLedger) return byLedger;
  }

  return [...rows].sort((a, b) => {
    const aTime = a.createdTime ?? '';
    const bTime = b.createdTime ?? '';
    // Missing createdTime sorts last: an empty string is lexicographically
    // smaller than any real ISO timestamp, so invert the comparison for it.
    if (!aTime && bTime) return 1;
    if (aTime && !bTime) return -1;
    if (aTime !== bTime) return aTime < bTime ? -1 : 1;
    return a.pageId < b.pageId ? -1 : a.pageId > b.pageId ? 1 : 0;
  })[0];
}
