/**
 * The slice of Notion's page payloads Vantage reads, typed structurally. The
 * API sends only the field matching each property's `type`, so every field is
 * optional — readers narrow instead of trusting an `any`.
 */

/** A rich-text run (title or rich_text cell). */
export interface NotionRichText {
  plain_text?: string;
  text?: { content?: string };
}

/** One property value on a page. */
export interface NotionPropertyValue {
  type?: string;
  title?: NotionRichText[];
  rich_text?: NotionRichText[];
  select?: { name?: string } | null;
  multi_select?: Array<{ name?: string }>;
  number?: number | null;
  relation?: Array<{ id: string }>;
  date?: { start?: string } | null;
  checkbox?: boolean;
}

/** A page (database row) as a query returns it. */
export interface NotionPage {
  id: string;
  created_time?: string;
  last_edited_time?: string;
  archived?: boolean;
  in_trash?: boolean;
  properties?: Record<string, NotionPropertyValue | undefined>;
}

/** The plain text of a rich-text array, trimmed. */
export function plainText(runs: NotionRichText[] | undefined): string {
  return (runs ?? []).map((t) => t.plain_text ?? t.text?.content ?? '').join('').trim();
}

/** A page's title — the text of its `title`-type property; '' when it has none. */
export function pageTitle(page: Pick<NotionPage, 'properties'> | undefined): string {
  for (const value of Object.values(page?.properties ?? {})) {
    if (value?.type === 'title') {
      const text = plainText(value.title);
      if (text) return text;
    }
  }
  return '';
}
