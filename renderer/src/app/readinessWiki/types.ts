/**
 * Shared shapes for the readiness help wiki. The drawer HOST (index.ts) owns
 * navigation state and injects a {@link WikiNav} into every page/article builder,
 * so content modules never import the host — keeping the dependency edges
 * one-directional (host → content).
 */

export type WikiArticleId = 'verdict' | 'what-moves-the-score' | 'training-load' | 'readiness-trend';
export type WikiTier = 'plain' | 'how-it-works' | 'deep';

export type WikiRoute =
  | { view: 'overview' }
  | { view: 'article'; id: WikiArticleId; tier: WikiTier }
  | { view: 'scenarios' }
  | { view: 'personalized' };

/** Navigation callbacks the host injects into content builders. */
export interface WikiNav {
  /** Push a page onto the stack. */
  goto(route: WikiRoute): void;
  /** Replace the current page (e.g. switching tiers without deepening the stack). */
  replace(route: WikiRoute): void;
  /** Pop one page. */
  back(): void;
  /** Reset to the Overview landing. */
  home(): void;
  /** Close the whole drawer. */
  close(): void;
}

/** One wiki article, revealed simple-first across three tiers. */
export interface WikiArticle {
  id: WikiArticleId;
  title: string;
  /** One-line description for the Overview index. */
  blurb: string;
  plain(nav: WikiNav): Node;
  howItWorks(nav: WikiNav): Node;
  deep(nav: WikiNav): Node;
}
