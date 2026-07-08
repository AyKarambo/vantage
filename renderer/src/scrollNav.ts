/**
 * Scroll-navigation math for the global list shortcuts (Ctrl+Home / Ctrl+End /
 * PageUp / PageDown, issue #72). Pure and DOM-free apart from the one thin
 * {@link resolveScroller} wrapper, so the decidable logic runs under the node
 * vitest environment — same pattern as `winrateScheme.ts`.
 */

/** What a navigation key asks of the active scroller. */
export type ScrollAction = 'top' | 'bottom' | 'page-up' | 'page-down';

/** The three measurements the math needs — structurally satisfied by any HTMLElement. */
export interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/** Overflow check only — what {@link pickScroller} needs from a candidate. */
export interface ScrollerCandidate {
  scrollHeight: number;
  clientHeight: number;
}

/** Pixels of the previous page kept visible when paging (classic pager overlap). */
export const PAGE_OVERLAP = 40;

/**
 * How far one PageUp/PageDown travels: a viewport minus {@link PAGE_OVERLAP}
 * so the previous page's last lines remain as context; tiny panes fall back to
 * half a viewport rather than a degenerate (or negative) step.
 */
export function pageStep(clientHeight: number): number {
  return Math.max(clientHeight - PAGE_OVERLAP, Math.ceil(clientHeight / 2));
}

/** The clamped target `scrollTop` for an action — never negative, never past the end. */
export function nextScrollTop(action: ScrollAction, m: ScrollMetrics): number {
  const max = Math.max(0, m.scrollHeight - m.clientHeight);
  switch (action) {
    case 'top': return 0;
    case 'bottom': return max;
    case 'page-up': return Math.max(0, m.scrollTop - pageStep(m.clientHeight));
    case 'page-down': return Math.min(max, m.scrollTop + pageStep(m.clientHeight));
  }
}

/**
 * The views whose real scroller is an inner element rather than the shell's
 * `.content` host: Heroes' sticky-header table (`components/table.ts`) and the
 * Logs tail. Extend this selector when a new view brings its own scroller.
 */
export const INNER_SCROLLER_SELECTOR = '.table-wrap, .log-lines';

/**
 * Selection rule: the candidate that owns the most scrollable content wins,
 * with the host as the baseline. An inner scroller (Heroes' capped table, the
 * Logs tail) takes the keys only when it overflows AND has more room to scroll
 * than the host — so a chart card toggled to "view as table" inside a long
 * dashboard doesn't steal paging from the page itself, while on Heroes the
 * table (which holds virtually all the scrollable content) still wins even if
 * `.content` overflows by a few pixels. Ties keep the host.
 */
export function pickScroller<T extends ScrollerCandidate>(inner: Iterable<T>, host: T): T {
  let best = host;
  let bestSurplus = Math.max(0, host.scrollHeight - host.clientHeight);
  for (const el of inner) {
    const surplus = el.scrollHeight - el.clientHeight;
    if (surplus > bestSurplus) {
      best = el;
      bestSurplus = surplus;
    }
  }
  return best;
}

/** Resolve the ACTIVE view's real scroll container inside the content host. */
export function resolveScroller(host: HTMLElement): HTMLElement {
  return pickScroller(host.querySelectorAll<HTMLElement>(INNER_SCROLLER_SELECTOR), host);
}
