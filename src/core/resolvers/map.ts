/**
 * Resolve a raw GEP map name to a Notion Maps page id.
 *
 * GEP map names don't always match the page `Name` in the Maps DB exactly
 * (apostrophes, casing, "Kings Row" vs "King's Row", etc.), so we:
 *   1. apply explicit user aliases (GEP name → Notion page Name), then
 *   2. compare on a normalized key (lowercased, punctuation/space stripped).
 */

export interface MapMatch {
  matched: boolean;
  pageId?: string;
  /** The Notion page Name we matched against, when matched. */
  notionName?: string;
}

/** Normalize a map name into a comparison key. */
export function normalizeMapName(name: string): string {
  return name
    .toLowerCase()
    .replace(/['’`.:_-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param rawName     map name reported by GEP
 * @param mapsByKey   normalized page Name → pageId (from the Maps DB)
 * @param aliases     optional GEP-name → Notion-page-Name overrides
 */
export function resolveMap(
  rawName: string | undefined,
  mapsByKey: Map<string, { pageId: string; name: string }>,
  aliases: Record<string, string> = {},
): MapMatch {
  if (!rawName) return { matched: false };

  // Apply alias on the raw (case-insensitive) name first.
  const aliased = matchAlias(rawName, aliases) ?? rawName;

  const hit = mapsByKey.get(normalizeMapName(aliased));
  if (hit) return { matched: true, pageId: hit.pageId, notionName: hit.name };

  return { matched: false };
}

function matchAlias(rawName: string, aliases: Record<string, string>): string | undefined {
  if (aliases[rawName]) return aliases[rawName];
  const lower = rawName.toLowerCase();
  for (const [from, to] of Object.entries(aliases)) {
    if (from.toLowerCase() === lower) return to;
  }
  return undefined;
}

/** Build the normalized lookup map from Maps DB rows. */
export function buildMapIndex(
  rows: Array<{ pageId: string; name: string }>,
): Map<string, { pageId: string; name: string }> {
  const index = new Map<string, { pageId: string; name: string }>();
  for (const row of rows) {
    if (row.name) index.set(normalizeMapName(row.name), row);
  }
  return index;
}
